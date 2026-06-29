import type { PlaceCandidate, TransportMode, RouteOption } from "../types/index.js";
import { MODE_LABELS } from "../types/index.js";
import { logger } from "../lib/logger.js";

const KAKAO_REST_API_KEY = process.env["KAKAO_REST_API_KEY"];

export function isKakaoAvailable(): boolean {
  return !!(KAKAO_REST_API_KEY && KAKAO_REST_API_KEY.length > 0);
}

/** Kakao Local API 인증/서비스/네트워크 장애 (검색 결과 없음과 구분) */
export class KakaoServiceError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "KakaoServiceError";
    this.status = status;
  }
}

interface KakaoDocument {
  id?: string;
  place_name: string;
  address_name: string;
  road_address_name: string;
  category_name: string;
  x: string; // longitude (경도)
  y: string; // latitude (위도)
  place_url: string;
}

interface KakaoSearchResponse {
  documents: KakaoDocument[];
  meta: { total_count: number };
}

/**
 * 카카오 Local API 키워드 검색 (전국).
 *
 * 전국 단위 검색이므로 x/y/radius 같은 지역 제한을 사용하지 않습니다.
 * @param keyword 검색어
 * @param size 가져올 결과 수 (1~15, 기본 15)
 */
export async function searchPlace(keyword: string, size = 15): Promise<PlaceCandidate[]> {
  if (!isKakaoAvailable()) return [];

  const params = new URLSearchParams();
  params.set("query", keyword);
  params.set("size", String(Math.min(Math.max(size, 1), 15)));
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` },
    });
  } catch (err) {
    // 네트워크 장애 → 검색 결과 없음(not_found)이 아니라 서비스 장애(unavailable)로 구분
    logger.warn({ err, keyword }, "Kakao place API fetch failed (network)");
    throw new KakaoServiceError("카카오 지도 검색 네트워크 오류");
  }

  if (!res.ok) {
    logger.warn({ status: res.status, keyword }, "Kakao place API non-OK response");
    // 401/403(키·서비스 비활성), 429(쿼터), 5xx(서버) → 서비스 장애로 전파.
    // 그 외(예: 400 잘못된 쿼리)는 검색 결과 없음으로 처리.
    if (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500) {
      throw new KakaoServiceError(`카카오 지도 검색 서비스 오류 (status ${res.status})`, res.status);
    }
    return [];
  }

  const data = (await res.json()) as KakaoSearchResponse;
  return data.documents.map((doc) => ({
    name: doc.place_name,
    address: doc.address_name || null,
    road_address: doc.road_address_name || null,
    category: doc.category_name || null,
    place_url: doc.place_url || null,
    // Kakao API: x = longitude(경도), y = latitude(위도)
    latitude: doc.y ? Number(doc.y) : null,
    longitude: doc.x ? Number(doc.x) : null,
    source: "kakao_local_api",
    confidence: "high" as const,
  }));
}

/**
 * 출발지·목적지 좌표 + 이동수단 목록으로 카카오맵 길찾기 링크를 생성합니다.
 *
 * 웹 URL: https://m.map.kakao.com/scheme/route?sp={lat},{lng}&ep={lat},{lng}&by={mode}
 * 앱 URL: kakaomap://route?sp={lat},{lng}&ep={lat},{lng}&by={mode}
 */
export function createKakaoRouteLinks(
  originLat: number | null,
  originLng: number | null,
  destLat: number | null,
  destLng: number | null,
  modes: TransportMode[],
): RouteOption[] {
  const hasCoords =
    originLat != null && originLng != null &&
    destLat != null && destLng != null;

  return modes.map((mode) => {
    if (!hasCoords) {
      return {
        mode,
        mode_label: MODE_LABELS[mode],
        kakao_map_route_url: null,
        kakao_map_app_url: null,
        route_link_available: false,
      };
    }

    const sp = encodeURIComponent(`${originLat},${originLng}`);
    const ep = encodeURIComponent(`${destLat},${destLng}`);

    return {
      mode,
      mode_label: MODE_LABELS[mode],
      kakao_map_route_url: `https://m.map.kakao.com/scheme/route?sp=${sp}&ep=${ep}&by=${mode}`,
      kakao_map_app_url: `kakaomap://route?sp=${sp}&ep=${ep}&by=${mode}`,
      route_link_available: true,
    };
  });
}
