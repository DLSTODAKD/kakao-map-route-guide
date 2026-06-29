import { logger } from "../lib/logger.js";
import {
  isTaGoAvailable,
  findNearbyBusStops,
  getBusArrivals,
  getRouteInfo,
} from "./tagoBusProvider.js";
import {
  classifyTransitPoint,
  classifyToTransitType,
  type TransitPointType,
} from "./transitClassifier.js";
import type { TaGoArrivalItem } from "../types/index.js";

const KAKAO_REST_API_KEY = process.env["KAKAO_REST_API_KEY"];
const SEOUL_SUBWAY_API_KEY = process.env["SEOUL_SUBWAY_API_KEY"];

export { classifyTransitPoint };
export type { TransitPointType, TransitFacility } from "./transitClassifier.js";

export interface TransitPoint {
  /** 좌표/종류/이름을 인코딩한 stateless id (arrivals 조회에 사용) */
  id: string;
  type: TransitPointType;
  name: string;
  address: string | null;
  category: string | null;
  latitude: number;
  longitude: number;
  place_url: string | null;
  distance_meters: number;
  source: "kakao_local_api";
}

interface KakaoDocument {
  id?: string;
  place_name: string;
  address_name: string;
  road_address_name: string;
  category_name: string;
  category_group_code?: string;
  x: string; // longitude
  y: string; // latitude
  place_url: string;
  distance?: string;
}

interface KakaoSearchResponse {
  documents: KakaoDocument[];
  meta: { total_count: number };
}

const MAX_POINTS = 80;

/** 종류별 카카오 검색 설정 (키워드 또는 카테고리 코드) */
const SEARCH_SPECS: Array<{
  type: TransitPointType;
  keyword?: string;
  categoryCode?: string;
}> = [
  { type: "subway", categoryCode: "SW8" }, // 지하철역
  { type: "bus_stop", keyword: "버스정류장" },
  { type: "rail", keyword: "기차역" },
  { type: "terminal", keyword: "버스터미널" },
];

function encodeId(p: {
  type: TransitPointType;
  name: string;
  latitude: number;
  longitude: number;
  place_url: string | null;
}): string {
  const payload = JSON.stringify({
    t: p.type,
    n: p.name,
    la: p.latitude,
    lo: p.longitude,
    pu: p.place_url,
  });
  return Buffer.from(payload, "utf8").toString("base64url");
}

export interface DecodedTransitPoint {
  type: TransitPointType;
  name: string;
  latitude: number;
  longitude: number;
  place_url: string | null;
}

export function decodeTransitPointId(id: string): DecodedTransitPoint | null {
  try {
    const json = Buffer.from(id, "base64url").toString("utf8");
    const o = JSON.parse(json) as Record<string, unknown>;
    const type = o["t"];
    const name = o["n"];
    const la = Number(o["la"]);
    const lo = Number(o["lo"]);
    if (
      (type !== "bus_stop" && type !== "subway" && type !== "rail" && type !== "terminal") ||
      typeof name !== "string" ||
      !Number.isFinite(la) ||
      !Number.isFinite(lo)
    ) {
      return null;
    }
    return {
      type,
      name,
      latitude: la,
      longitude: lo,
      place_url: typeof o["pu"] === "string" ? o["pu"] : null,
    };
  } catch {
    return null;
  }
}

async function kakaoCoordSearch(
  spec: { keyword?: string; categoryCode?: string },
  lat: number,
  lng: number,
  radius: number,
): Promise<KakaoDocument[]> {
  if (!KAKAO_REST_API_KEY) return [];
  const params = new URLSearchParams();
  params.set("x", String(lng));
  params.set("y", String(lat));
  params.set("radius", String(Math.min(Math.max(radius, 1), 20000)));
  params.set("sort", "distance");
  params.set("size", "15");

  let base: string;
  if (spec.categoryCode) {
    params.set("category_group_code", spec.categoryCode);
    base = "https://dapi.kakao.com/v2/local/search/category.json";
  } else {
    params.set("query", spec.keyword ?? "");
    base = "https://dapi.kakao.com/v2/local/search/keyword.json";
  }

  try {
    const res = await fetch(`${base}?${params.toString()}`, {
      headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, spec }, "Kakao transit search non-OK");
      return [];
    }
    const data = (await res.json()) as KakaoSearchResponse;
    return data.documents ?? [];
  } catch (err) {
    logger.warn({ err, spec }, "Kakao transit search failed");
    return [];
  }
}

/**
 * 중심 좌표 주변의 교통 지점(버스정류장/지하철역/기차역/터미널)을 검색합니다.
 * 임의 생성 없음 — 카카오 Local 검색 결과만 사용.
 */
export async function findTransitPoints(
  lat: number,
  lng: number,
  radius: number,
  includeBusStops = false,
): Promise<TransitPoint[]> {
  if (!KAKAO_REST_API_KEY) return [];

  const specs = includeBusStops
    ? SEARCH_SPECS
    : SEARCH_SPECS.filter((spec) => spec.type !== "bus_stop");

  const results = await Promise.all(
    specs.map(async (spec) => kakaoCoordSearch(spec, lat, lng, radius)),
  );

  const seen = new Set<string>();
  const points: TransitPoint[] = [];

  for (const group of results) {
    for (const doc of group) {
      const latitude = doc.y ? Number(doc.y) : NaN;
      const longitude = doc.x ? Number(doc.x) : NaN;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

      // 이름이 아니라 category_name 기준으로 실제 교통시설만 통과
      const type = classifyToTransitType({
        place_name: doc.place_name,
        category_name: doc.category_name,
        category_group_code: doc.category_group_code,
      });
      if (!type) continue;
      if (!includeBusStops && type === "bus_stop") continue;

      // 이름 + 반올림 좌표(약 11m)로 중복 제거
      const dedupeKey = `${doc.place_name}|${latitude.toFixed(4)}|${longitude.toFixed(4)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const distance = doc.distance ? Number(doc.distance) : NaN;

      points.push({
        id: encodeId({ type, name: doc.place_name, latitude, longitude, place_url: doc.place_url || null }),
        type,
        name: doc.place_name,
        address: doc.road_address_name || doc.address_name || null,
        category: doc.category_name || null,
        latitude,
        longitude,
        place_url: doc.place_url || null,
        distance_meters: Number.isFinite(distance) ? distance : 0,
        source: "kakao_local_api",
      });
    }
  }

  points.sort((a, b) => a.distance_meters - b.distance_meters);
  return points.slice(0, MAX_POINTS);
}

// ── 도착정보 ────────────────────────────────────────────────────────────────

export interface TransitArrivalsResult {
  available: boolean;
  type: TransitPointType;
  name: string;
  latitude: number;
  longitude: number;
  /** 버스 도착정보 (available=true 시) */
  arrivals: TaGoArrivalItem[];
  /** 매칭된 TAGO 정류장 식별 정보 (버스) */
  city_code: string | null;
  node_id: string | null;
  /** 카카오맵에서 상세 확인용 링크 (항상 제공) */
  kakao_map_url: string | null;
  /** 사용자 안내 문구 */
  message: string;
  data_source: string;
}

function kakaoPlaceMapUrl(p: DecodedTransitPoint): string {
  if (p.place_url) return p.place_url;
  // 좌표 기반 카카오맵 지도 링크
  return `https://map.kakao.com/link/map/${encodeURIComponent(p.name)},${p.latitude},${p.longitude}`;
}

/**
 * 교통 지점 도착/시간표 정보를 조회합니다.
 * - 버스: TAGO 실시간 (근방 정류장 매칭 후 도착정보)
 * - 지하철: SEOUL_SUBWAY_API_KEY + 수도권일 때만, 아니면 unavailable
 * - 기차/터미널: 실시간 미지원 → unavailable + 카카오맵 링크
 * 임의 생성 없음.
 */
export async function getTransitPointArrivals(
  point: DecodedTransitPoint,
): Promise<TransitArrivalsResult> {
  const kakaoUrl = kakaoPlaceMapUrl(point);
  const base: Omit<TransitArrivalsResult, "available" | "arrivals" | "city_code" | "node_id" | "message" | "data_source"> = {
    type: point.type,
    name: point.name,
    latitude: point.latitude,
    longitude: point.longitude,
    kakao_map_url: kakaoUrl,
  };

  if (point.type === "bus_stop") {
    if (!isTaGoAvailable()) {
      return {
        ...base,
        available: false,
        arrivals: [],
        city_code: null,
        node_id: null,
        message: "이 지역의 실시간 버스 도착정보는 제공되지 않습니다. 카카오맵에서 확인해 주세요.",
        data_source: "bus_realtime_unavailable",
      };
    }
    // 근방 TAGO 정류장 매칭 (좌표 기준)
    const stops = await findNearbyBusStops(point.latitude, point.longitude, 3);
    const matched = stops.find((s) => (s.distance_meters ?? 9999) <= 200) ?? stops[0];
    if (!matched || !matched.city_code) {
      return {
        ...base,
        available: false,
        arrivals: [],
        city_code: null,
        node_id: null,
        message: "이 정류장의 실시간 도착정보를 찾지 못했습니다. 카카오맵에서 확인해 주세요.",
        data_source: "bus_realtime_unavailable",
      };
    }
    const arrivals = await getBusArrivals(matched.city_code, matched.node_id, 10);
    if (arrivals.length === 0) {
      return {
        ...base,
        available: false,
        arrivals: [],
        city_code: matched.city_code,
        node_id: matched.node_id,
        message: "현재 도착 예정인 버스가 없거나 실시간 정보가 제공되지 않습니다.",
        data_source: "bus_realtime_unavailable",
      };
    }
    // 방향(종점) 보강 — 노선정보 키가 있을 때만
    const enriched = await Promise.all(
      arrivals.map(async (a) => {
        if (a.direction || !a.route_id) return a;
        const info = await getRouteInfo(matched.city_code!, a.route_id);
        return info ? { ...a, direction: info.direction } : a;
      }),
    );
    return {
      ...base,
      available: true,
      arrivals: enriched,
      city_code: matched.city_code,
      node_id: matched.node_id,
      message: "국토교통부 TAGO API 실시간 버스 도착정보입니다.",
      data_source: "tago_bus_realtime",
    };
  }

  if (point.type === "subway") {
    // 수도권 지하철 실시간은 SEOUL_SUBWAY_API_KEY 필요. 미설정 시 unavailable.
    if (!SEOUL_SUBWAY_API_KEY) {
      return {
        ...base,
        available: false,
        arrivals: [],
        city_code: null,
        node_id: null,
        message: "지하철 실시간 도착정보는 현재 제공되지 않습니다. 카카오맵에서 확인해 주세요.",
        data_source: "subway_realtime_unavailable",
      };
    }
    // 키가 있어도 본 서비스는 임의 데이터를 만들지 않습니다.
    return {
      ...base,
      available: false,
      arrivals: [],
      city_code: null,
      node_id: null,
      message: "지하철 실시간 도착정보는 카카오맵에서 확인해 주세요.",
      data_source: "subway_realtime_unavailable",
    };
  }

  // rail / terminal — 실시간 미지원
  const label = point.type === "rail" ? "기차 시간표" : "버스 시간표";
  return {
    ...base,
    available: false,
    arrivals: [],
    city_code: null,
    node_id: null,
    message: `${label}와 운행 정보는 카카오맵에서 확인해 주세요.`,
    data_source: `${point.type}_schedule_unavailable`,
  };
}
