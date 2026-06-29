/**
 * 지도 교통 마커 분류 로직 (순수 함수, 외부 의존성 없음).
 *
 * 핵심 원칙: place_name 에 "역"/"기차역"/"터미널" 같은 단어가 들어 있어도
 * category_name 이 실제 교통시설이 아니면(편의점·카페 등) 교통 마커에서 제외한다.
 */

/** 지도 마커 내부 종류 */
export type TransitPointType = "bus_stop" | "subway" | "rail" | "terminal";

/** 실제 교통시설 세분류. 교통시설이 아니면 null. */
export type TransitFacility =
  | "subway_station"
  | "rail_station"
  | "express_bus_terminal"
  | "intercity_bus_terminal"
  | "bus_stop";

/** 세분류 → 지도 마커 내부 타입 매핑 */
const FACILITY_TO_TYPE: Record<TransitFacility, TransitPointType> = {
  subway_station: "subway",
  rail_station: "rail",
  express_bus_terminal: "terminal",
  intercity_bus_terminal: "terminal",
  bus_stop: "bus_stop",
};

/** 이름에 교통 키워드가 있어도 교통 마커에서 제외할 비교통 POI 카테고리 */
const EXCLUDED_POI_KEYWORDS = [
  "편의점",
  "음식점",
  "카페",
  "술집",
  "쇼핑",
  "마트",
  "슈퍼",
  "상점",
  "생활",
  "은행",
  "병원",
  "약국",
  "숙박",
  "모텔",
  "호텔",
  "주차장",
  "부동산",
  "학원",
  "미용",
  "세탁",
  "회사",
  "사무실",
] as const;

export function isExcludedPoiCategory(category: string): boolean {
  return EXCLUDED_POI_KEYWORDS.some((keyword) => category.includes(keyword));
}

/** 지하철·전철·도시철도 계열 */
function isSubwayStationCategory(category: string): boolean {
  return ["지하철", "전철", "도시철도"].some((k) => category.includes(k));
}

/** 기차·철도(KTX/SRT 등) 계열 */
function isRailStationCategory(category: string): boolean {
  return ["기차역", "철도역", "KTX", "SRT", "열차", "철도", "기차"].some((k) => category.includes(k));
}

/** 버스터미널 계열 */
function isBusTerminalCategory(category: string): boolean {
  return ["고속버스터미널", "시외버스터미널", "종합버스터미널", "버스터미널"].some((k) =>
    category.includes(k),
  );
}

/** 버스정류장 계열 */
function isBusStopCategory(category: string): boolean {
  return ["버스정류장", "버스정류소", "정류장"].some((k) => category.includes(k));
}

function detectTerminalType(category: string, name: string): TransitFacility {
  const hay = `${category} ${name}`;
  if (hay.includes("시외")) return "intercity_bus_terminal";
  // 고속·종합·일반 버스터미널은 고속버스터미널로 묶는다(기본값)
  return "express_bus_terminal";
}

/**
 * Kakao Local 문서 1건을 실제 교통시설로 분류한다.
 * 이름이 아니라 category_name 을 우선 보고 판정하며, 비교통 POI 는 제외한다.
 */
export function classifyTransitPoint(place: {
  place_name?: string | null;
  category_name?: string | null;
  category_group_code?: string | null;
}): TransitFacility | null {
  const name = place.place_name ?? "";
  const category = place.category_name ?? "";

  // 1) 비교통 POI(편의점·카페 등)는 이름에 교통 키워드가 있어도 제외
  if (isExcludedPoiCategory(category)) return null;

  // 2) 지하철/전철을 기차보다 먼저 판정(공항철도·도시철도 등이 기차로 새지 않도록)
  if (isSubwayStationCategory(category)) return "subway_station";
  if (isRailStationCategory(category)) return "rail_station";
  if (isBusTerminalCategory(category)) return detectTerminalType(category, name);
  if (isBusStopCategory(category)) return "bus_stop";

  // 3) category_name 만으로 교통시설로 확정되지 않으면 마커 제외
  return null;
}

/** 내부 마커 타입으로 변환(교통시설이 아니면 null) */
export function classifyToTransitType(place: {
  place_name?: string | null;
  category_name?: string | null;
  category_group_code?: string | null;
}): TransitPointType | null {
  const facility = classifyTransitPoint(place);
  return facility ? FACILITY_TO_TYPE[facility] : null;
}
