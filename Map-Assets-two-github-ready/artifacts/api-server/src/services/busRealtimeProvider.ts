import type { PlaceCandidate } from "../types/index.js";
import { logger } from "../lib/logger.js";

const TAGO_SERVICE_KEY =
  process.env["TAGO_SERVICE_KEY"] ?? process.env["PUBLIC_DATA_SERVICE_KEY"];

const BASE_STTN = "https://apis.data.go.kr/1613000/BusSttnInfoInqireService";
const BASE_ARVL = "https://apis.data.go.kr/1613000/ArvlInfoInqireService";

export function isBusRealtimeAvailable(): boolean {
  return !!(TAGO_SERVICE_KEY && TAGO_SERVICE_KEY.length > 0);
}

// ── Raw TAGO API types ────────────────────────────────────────────────────────

interface TaGoStop {
  citycode: number;
  gpslati: number;
  gpslong: number;
  nodeid: string;
  nodenm: string;
  nodeno: number;
}

interface TaGoArrival {
  arrprevstationcnt: number;
  arrtime: number;
  nodeid: string;
  nodenm: string;
  routeid: string;
  routeno: string;
  routetp: string;
  vehicletp?: string;
}

interface TaGoResponse<T> {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: {
      items?: { item?: T | T[] | "" | null } | "" | null;
      totalCount?: number;
      numOfRows?: number;
      pageNo?: number;
    };
  };
}

// ── Public result types ───────────────────────────────────────────────────────

export interface BusStopInfo {
  nodeId: string;
  nodeName: string;
  cityCode: number;
  latitude: number;
  longitude: number;
  distanceMeters: number;
}

export interface BusArrivalItem {
  routeNo: string;
  routeType: string;
  arrivalSeconds: number;
  remainingStops: number;
  estimatedArrivalText: string;
  remainingStopsText: string;
}

export interface BusStopRealtime {
  stop: BusStopInfo;
  arrivals: BusArrivalItem[];
}

export interface BusRealtimeResult {
  available: boolean;
  provider: "tago_bus_realtime";
  stops: BusStopRealtime[];
  timestamp: string;
  natural_language_summary: string;
  error?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** TAGO API는 결과가 1개면 배열 대신 단일 객체를 반환한다. 항상 배열로 정규화. */
function toArray<T>(val: T | T[] | "" | null | undefined): T[] {
  if (!val || val === "") return [];
  return Array.isArray(val) ? val : [val];
}

/** Haversine 공식으로 두 지점 사이 거리(m) 계산 */
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatArrivalTime(seconds: number): string {
  if (seconds < 60) return "곧 도착";
  const min = Math.round(seconds / 60);
  return `약 ${min}분 후`;
}

function formatRemainingStops(count: number): string {
  if (count <= 0) return "곧 도착";
  return `${count}정류장 전`;
}

/** KST(UTC+9) 기준 HH:MM 형식 */
function nowKstHHMM(): string {
  return new Date(Date.now() + 9 * 3_600_000)
    .toISOString()
    .substring(11, 16);
}

function buildParams(extra: Record<string, string>): URLSearchParams {
  const p = new URLSearchParams({
    serviceKey: TAGO_SERVICE_KEY!,
    numOfRows: "5",
    pageNo: "1",
    _type: "json",
    ...extra,
  });
  return p;
}

// ── API calls ─────────────────────────────────────────────────────────────────

/**
 * 좌표 기반 근방 정류장 목록 조회
 * GET /BusSttnInfoInqireService/getCrdntPrxmtSttnList
 */
async function getNearbyStops(
  lat: number,
  lng: number,
  maxCount = 3,
): Promise<BusStopInfo[]> {
  const params = buildParams({ gpsLati: String(lat), gpsLong: String(lng) });
  const url = `${BASE_STTN}/getCrdntPrxmtSttnList?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  } catch (err) {
    throw new Error(`TAGO 정류장 검색 네트워크 오류: ${err instanceof Error ? err.message : err}`);
  }

  if (!res.ok) throw new Error(`TAGO 정류장 검색 HTTP ${res.status}`);

  const data = (await res.json()) as TaGoResponse<TaGoStop>;
  const body = data?.response?.body;
  if (!body?.totalCount) return [];

  const items = toArray<TaGoStop>(
    (body.items as { item?: TaGoStop | TaGoStop[] })?.item,
  );

  return items.slice(0, maxCount).map((item) => ({
    nodeId: item.nodeid,
    nodeName: item.nodenm,
    cityCode: item.citycode,
    latitude: item.gpslati,
    longitude: item.gpslong,
    distanceMeters: Math.round(haversine(lat, lng, item.gpslati, item.gpslong)),
  }));
}

/**
 * 정류장별 도착예정 정보 조회
 * GET /ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList
 */
async function getStopArrivals(
  cityCode: number,
  nodeId: string,
  maxCount = 5,
): Promise<BusArrivalItem[]> {
  const params = buildParams({
    cityCode: String(cityCode),
    nodeId,
    numOfRows: String(maxCount),
  });
  const url = `${BASE_ARVL}/getSttnAcctoArvlPrearngeInfoList?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  } catch (err) {
    throw new Error(`TAGO 도착정보 네트워크 오류: ${err instanceof Error ? err.message : err}`);
  }

  if (!res.ok) throw new Error(`TAGO 도착정보 HTTP ${res.status}`);

  const data = (await res.json()) as TaGoResponse<TaGoArrival>;
  const body = data?.response?.body;
  if (!body?.totalCount) return [];

  const items = toArray<TaGoArrival>(
    (body.items as { item?: TaGoArrival | TaGoArrival[] })?.item,
  );

  return items
    .filter((item) => item.routeno && item.arrtime >= 0)
    .map((item) => ({
      routeNo: item.routeno,
      routeType: item.routetp || "",
      arrivalSeconds: item.arrtime,
      remainingStops: item.arrprevstationcnt,
      estimatedArrivalText: formatArrivalTime(item.arrtime),
      remainingStopsText: formatRemainingStops(item.arrprevstationcnt),
    }));
}

// ── Main exported function ────────────────────────────────────────────────────

/**
 * 출발지 좌표 기준으로 인근 정류장의 실시간 버스 도착 정보를 조회합니다.
 *
 * - TAGO 서비스 키가 없으면 available=false 즉시 반환.
 * - 정류장/도착정보 조회 실패 시 available=false + error 반환.
 * - 지역 미지원 등으로 결과가 없어도 임의 정보를 만들지 않습니다.
 */
export async function getBusRealtimeForOrigin(
  place: PlaceCandidate,
): Promise<BusRealtimeResult> {
  const ts = new Date().toISOString();

  if (!isBusRealtimeAvailable()) {
    return {
      available: false,
      provider: "tago_bus_realtime",
      stops: [],
      timestamp: ts,
      natural_language_summary: "실시간 버스 정보 API 키가 설정되지 않았습니다.",
      error: "TAGO_SERVICE_KEY / PUBLIC_DATA_SERVICE_KEY not configured",
    };
  }

  const { latitude: lat, longitude: lng, name } = place;

  if (lat == null || lng == null) {
    return {
      available: false,
      provider: "tago_bus_realtime",
      stops: [],
      timestamp: ts,
      natural_language_summary: "출발지 좌표 정보가 없어 실시간 버스 정보를 확인하지 못했습니다.",
      error: "missing coordinates",
    };
  }

  try {
    const nearbyStops = await getNearbyStops(lat, lng, 3);

    if (nearbyStops.length === 0) {
      logger.info({ place: name }, "Bus realtime: no nearby stops found");
      return {
        available: false,
        provider: "tago_bus_realtime",
        stops: [],
        timestamp: new Date().toISOString(),
        natural_language_summary:
          "해당 지역의 실시간 버스 정보를 확인하지 못했습니다. 인근 정류장을 찾지 못했습니다.",
      };
    }

    const stopResults: BusStopRealtime[] = [];
    const queryTs = new Date().toISOString();

    // 최대 2개 정류장만 도착정보 조회 (API 요청 수 절약)
    const stopsToQuery = nearbyStops.slice(0, 2);

    await Promise.allSettled(
      stopsToQuery.map(async (stop) => {
        try {
          const arrivals = await getStopArrivals(stop.cityCode, stop.nodeId, 5);
          if (arrivals.length > 0) {
            stopResults.push({ stop, arrivals });
          }
        } catch (err) {
          logger.warn({ err, nodeId: stop.nodeId, stopName: stop.nodeName }, "Arrival fetch failed for stop");
        }
      }),
    );

    if (stopResults.length === 0) {
      return {
        available: false,
        provider: "tago_bus_realtime",
        stops: [],
        timestamp: queryTs,
        natural_language_summary:
          "해당 지역의 실시간 버스 정보를 확인하지 못했습니다. 도착 예정 버스가 없거나 지원되지 않는 지역일 수 있습니다.",
      };
    }

    // 정류장 거리순 정렬
    stopResults.sort((a, b) => a.stop.distanceMeters - b.stop.distanceMeters);

    const summaryLines: string[] = [];
    for (const sr of stopResults) {
      summaryLines.push(`📍 ${sr.stop.nodeName} (약 ${sr.stop.distanceMeters}m)`);
      for (const arr of sr.arrivals.slice(0, 3)) {
        summaryLines.push(
          `  ${arr.routeNo}번: ${arr.estimatedArrivalText} (${arr.remainingStopsText})`,
        );
      }
    }
    summaryLines.push(`🕑 조회 시각: ${nowKstHHMM()}`);

    return {
      available: true,
      provider: "tago_bus_realtime",
      stops: stopResults,
      timestamp: queryTs,
      natural_language_summary: summaryLines.join("\n"),
    };
  } catch (err) {
    logger.warn({ err, place: name }, "Bus realtime fetch failed");
    return {
      available: false,
      provider: "tago_bus_realtime",
      stops: [],
      timestamp: new Date().toISOString(),
      natural_language_summary:
        "해당 지역의 실시간 버스 정보를 확인하지 못했습니다.",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
