/**
 * TAGO API 인증키 유틸
 *
 * API별 개별 키를 지원하고, 미설정 시 공통 fallback 키를 사용합니다.
 * 키 값은 이 모듈 외부에 절대 노출하지 않습니다.
 */
import type { TagoKeyStatus } from "../types/index.js";

export type { TagoKeyStatus };

export interface TagoKeys {
  arrivalServiceKey: string;
  stopServiceKey: string;
  routeServiceKey: string;
}

/**
 * API별 인증키를 반환합니다.
 * 우선순위: API 전용 키 → TAGO_SERVICE_KEY → PUBLIC_DATA_SERVICE_KEY
 *
 * 주의: 반환값을 로그·응답·외부에 절대 출력하지 마세요.
 */
export function getTagoKeys(): TagoKeys {
  const common =
    process.env["TAGO_SERVICE_KEY"] ||
    process.env["PUBLIC_DATA_SERVICE_KEY"] ||
    "";

  return {
    arrivalServiceKey:
      process.env["TAGO_ARRIVAL_SERVICE_KEY"] || common,
    stopServiceKey:
      process.env["TAGO_STOP_SERVICE_KEY"] || common,
    routeServiceKey:
      process.env["TAGO_ROUTE_SERVICE_KEY"] || common,
  };
}

/**
 * API별 키 설정 여부를 true/false로만 반환합니다.
 * 실제 키 문자열은 절대 반환하지 않습니다.
 */
export function getTagoKeyStatus(): TagoKeyStatus {
  const keys = getTagoKeys();
  return {
    arrival_key_configured: Boolean(keys.arrivalServiceKey),
    stop_key_configured: Boolean(keys.stopServiceKey),
    route_key_configured: Boolean(keys.routeServiceKey),
  };
}
