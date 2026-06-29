import type { PlaceCandidate } from "../types/index.js";
import { logger } from "../lib/logger.js";

const KAKAO_MOBILITY_API_KEY = process.env["KAKAO_MOBILITY_API_KEY"];

export function isMobilityAvailable(): boolean {
  return !!(KAKAO_MOBILITY_API_KEY && KAKAO_MOBILITY_API_KEY.length > 0);
}

export type DirectionsPriority = "TIME" | "DISTANCE" | "RECOMMEND";

export interface CarDirectionsResult {
  available: boolean;
  provider: "kakao_mobility_directions";
  priority: DirectionsPriority;
  total_distance_meters: number | null;
  total_distance_km: number | null;
  total_duration_seconds: number | null;
  total_duration_minutes: number | null;
  estimated_time_text: string | null;
  distance_text: string | null;
  taxi_fare: number | null;
  toll_fare: number | null;
  main_roads: string[];
  natural_language_summary: string;
  error?: string;
}

interface KakaoRoute {
  summary?: {
    duration?: number;
    distance?: number;
    fare?: { taxi?: number; toll?: number };
  };
  sections?: Array<{
    roads?: Array<{ name?: string }>;
  }>;
}

interface KakaoDirectionsResponse {
  routes?: KakaoRoute[];
}

/** 초 → "약 N분" 또는 "약 N시간 M분" 텍스트 */
function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `약 ${totalMinutes}분`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `약 ${hours}시간` : `약 ${hours}시간 ${minutes}분`;
}

/** 미터 → "약 N.Nkm" 텍스트 */
function formatDistance(meters: number): string {
  const km = meters / 1000;
  if (km < 1) return `약 ${meters}m`;
  return `약 ${km.toFixed(1)}km`;
}

/** 도로명 추출: sections → roads → name, 중복 제거, 빈 문자열 제거 */
function extractMainRoads(sections: KakaoRoute["sections"]): string[] {
  if (!sections || sections.length === 0) return [];
  const names: string[] = [];
  for (const section of sections) {
    if (!section.roads) continue;
    for (const road of section.roads) {
      const n = road.name?.trim();
      if (n && n.length > 0 && !names.includes(n)) names.push(n);
    }
  }
  // 최대 5개까지만
  return names.slice(0, 5);
}

/**
 * 카카오모빌리티 자동차 길찾기 API 호출.
 *
 * 주의: API는 origin/destination을 longitude,latitude 순으로 받습니다.
 * (카카오맵 URL Scheme과는 반대 — URL Scheme은 latitude,longitude 순)
 */
export async function getCarDirections(
  originPlace: PlaceCandidate,
  destinationPlace: PlaceCandidate,
  priority: DirectionsPriority = "TIME",
): Promise<CarDirectionsResult> {
  const failResult = (summary: string, error?: string): CarDirectionsResult => ({
    available: false,
    provider: "kakao_mobility_directions",
    priority,
    total_distance_meters: null,
    total_distance_km: null,
    total_duration_seconds: null,
    total_duration_minutes: null,
    estimated_time_text: null,
    distance_text: null,
    taxi_fare: null,
    toll_fare: null,
    main_roads: [],
    natural_language_summary: summary,
    error,
  });

  if (!isMobilityAvailable()) {
    return failResult(
      "자동차 상세 경로 정보를 제공하지 못했습니다. 아래 카카오맵 자동차 길찾기 링크에서 확인해 주세요.",
      "KAKAO_MOBILITY_API_KEY not configured",
    );
  }

  const { latitude: oLat, longitude: oLng, name: oName } = originPlace;
  const { latitude: dLat, longitude: dLng, name: dName } = destinationPlace;

  if (oLat == null || oLng == null || dLat == null || dLng == null) {
    return failResult(
      "자동차 경로 API 호출에 필요한 좌표 정보가 없습니다. 카카오맵 자동차 길찾기 링크에서 확인해 주세요.",
      "missing coordinates",
    );
  }

  // Kakao Mobility API: origin/destination은 longitude,latitude 순
  const params = new URLSearchParams({
    origin: `${oLng},${oLat},name=${oName}`,
    destination: `${dLng},${dLat},name=${dName}`,
    priority,
    summary: "false",
  });
  const url = `https://apis-navi.kakaomobility.com/v1/directions?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `KakaoAK ${KAKAO_MOBILITY_API_KEY}` },
    });
  } catch (err) {
    logger.warn({ err, origin: oName, destination: dName }, "Kakao Mobility fetch failed (network)");
    return failResult(
      "자동차 경로 정보를 불러오지 못했습니다. 카카오맵 자동차 길찾기 링크에서 확인해 주세요.",
      err instanceof Error ? err.message : String(err),
    );
  }

  if (!res.ok) {
    logger.warn({ status: res.status, origin: oName, destination: dName }, "Kakao Mobility non-OK");
    return failResult(
      "자동차 경로 API 호출에 실패했습니다. 카카오맵 자동차 길찾기 링크에서 확인해 주세요.",
      `HTTP ${res.status}`,
    );
  }

  let data: KakaoDirectionsResponse;
  try {
    data = (await res.json()) as KakaoDirectionsResponse;
  } catch (err) {
    return failResult(
      "자동차 경로 API 응답을 파싱하지 못했습니다.",
      err instanceof Error ? err.message : String(err),
    );
  }

  const route = data.routes?.[0];
  if (!route?.summary) {
    logger.warn({ data, origin: oName, destination: dName }, "Kakao Mobility: no route summary");
    return failResult(
      "자동차 경로 정보를 불러오지 못했습니다. 카카오맵 자동차 길찾기 링크에서 확인해 주세요.",
      "no route in response",
    );
  }

  const { duration, distance, fare } = route.summary;
  const durationSec = typeof duration === "number" ? duration : null;
  const distanceM = typeof distance === "number" ? distance : null;
  const durationMin = durationSec != null ? Math.round(durationSec / 60) : null;
  const distanceKm = distanceM != null ? Math.round(distanceM / 10) / 100 : null;
  const taxiFare = typeof fare?.taxi === "number" ? fare.taxi : null;
  const tollFare = typeof fare?.toll === "number" ? fare.toll : null;
  const mainRoads = extractMainRoads(route.sections);

  const estimatedTimeText = durationSec != null ? formatDuration(durationSec) : null;
  const distanceText = distanceM != null ? formatDistance(distanceM) : null;

  const summaryLines = [
    `🚗 자동차 최단시간 경로`,
    ``,
    `출발: ${oName}`,
    `도착: ${dName}`,
    ``,
  ];
  if (estimatedTimeText) summaryLines.push(`예상 소요시간: ${estimatedTimeText}`);
  if (distanceText) summaryLines.push(`예상 거리: ${distanceText}`);
  if (mainRoads.length > 0) {
    summaryLines.push(``, `주요 경로:`);
    summaryLines.push(mainRoads.join(" → "));
  }
  summaryLines.push(
    ``,
    `카카오 경로 API 기준으로 자동차 최단시간 경로를 조회했습니다.`,
    `자세한 회전 안내와 실시간 교통 상황은 카카오맵에서 확인해 주세요.`,
  );

  return {
    available: true,
    provider: "kakao_mobility_directions",
    priority,
    total_distance_meters: distanceM,
    total_distance_km: distanceKm,
    total_duration_seconds: durationSec,
    total_duration_minutes: durationMin,
    estimated_time_text: estimatedTimeText,
    distance_text: distanceText,
    taxi_fare: taxiFare,
    toll_fare: tollFare,
    main_roads: mainRoads,
    natural_language_summary: summaryLines.join("\n"),
  };
}
