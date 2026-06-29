export type TransportMode = "publictransit" | "car" | "bicycle" | "foot";

export const MODE_LABELS: Record<TransportMode, string> = {
  publictransit: "대중교통",
  car: "자동차",
  bicycle: "자전거",
  foot: "도보",
};

export const MODE_ICONS: Record<TransportMode, string> = {
  publictransit: "🚌",
  car: "🚗",
  bicycle: "🚲",
  foot: "🚶",
};

export interface RouteOption {
  mode: TransportMode;
  mode_label: string;
  kakao_map_route_url: string | null;
  kakao_map_app_url: string | null;
  route_link_available: boolean;
}

/** 장소 유형 (전국 장소 해석기) */
export type PlaceIntentType =
  | "station"
  | "terminal"
  | "airport"
  | "hospital"
  | "school"
  | "market"
  | "public_office"
  | "landmark"
  | "generic";

export interface PlaceIntent {
  raw: string;
  normalized: string;
  type: PlaceIntentType;
  strict: boolean;
}

/** parseRouteQuery 결과 (전국 길찾기 자연어 파싱) */
export interface ParsedRouteQuery {
  original_query: string;
  cleaned_query: string;
  detected_mode: TransportMode | null;
  selected_modes: TransportMode[];
  default_mode_used: boolean;
  origin_text: string | null;
  destination_text: string | null;
  parse_confidence: "high" | "medium" | "low";
  parse_error?: string;
}

export interface PlaceCandidate {
  name: string;
  address: string | null;
  road_address?: string | null;
  category?: string | null;
  place_url?: string | null;
  latitude: number | null;
  longitude: number | null;
  source: string;
  confidence: "high" | "medium" | "low";
  score?: number;
  /** 디버그: 점수 산정 근거 */
  score_reason?: string;
}

export interface ScoredCandidate extends PlaceCandidate {
  score: number;
}

/** 버튼 렌더링용 단일 후보 장소 */
export interface ClarificationCandidate {
  candidate_id: string;
  name: string;
  address: string | null;
  category: string | null;
  latitude: number | null;
  longitude: number | null;
  place_url: string | null;
}

/** ambiguous 응답에 포함되는 버튼 렌더링 정보 */
export interface ClarificationInfo {
  target: "origin" | "destination";
  original_query: string;
  message: string;
  candidates: ClarificationCandidate[];
  allow_select_buttons: boolean;
  allow_reject_all: boolean;
}

/** 지도 마커/후보 버튼에서 직접 선택해 넘기는 장소 구조 */
export interface SelectedPlace {
  name: string;
  address: string | null;
  category: string | null;
  latitude: number | null;
  longitude: number | null;
  place_url: string | null;
}

/** 사용자가 버튼 선택 후 재요청할 때 담는 구조 */
export interface ClarificationSelection {
  target: "origin" | "destination";
  selected_place?: SelectedPlace | null;
  reject_all?: boolean;
  rejected_candidates?: Array<{
    name: string;
    address: string | null;
    place_url: string | null;
  }>;
}

/** 사용자의 현재 위치 좌표 (브라우저 Geolocation) */
export interface CurrentLocation {
  latitude: number;
  longitude: number;
}

export interface TransitStop {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  walking_distance_meters: number;
  source: string;
}

export interface TransitRoute {
  provider: string;
  bus_number: string;
  direction: string;
  departure_stop: string;
  arrival_stop: string;
  scheduled_bus_departure_time: string | null;
  wait_time_minutes: number;
  ride_time_minutes: number;
  transfer_count: number;
  confidence: "high" | "medium" | "low";
  raw?: unknown;
}

/** 카카오모빌리티 자동차 길찾기 API 결과 */
export interface CarDirectionsResult {
  available: boolean;
  provider: "kakao_mobility_directions";
  priority: "TIME" | "DISTANCE" | "RECOMMEND";
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

/** TAGO 버스 정류장 (공개 응답 타입) */
export interface TaGoStop {
  name: string;
  node_id: string;
  latitude: number;
  longitude: number;
  /** 내부 조회용 — getCrdntPrxmtSttnList 응답에서 자동 채워짐 */
  city_code?: string;
  distance_meters?: number;
}

/** TAGO 버스 도착 예정 정보 (단일 노선) */
export interface TaGoArrivalItem {
  route_id: string;
  route_number: string;
  arrival_time_minutes: number;
  remaining_stops: number;
  direction: string;
  route_type?: string;
}

/** TAGO API 키별 설정 여부 (true/false만 — 실제 키값 미포함) */
export interface TagoKeyStatus {
  arrival_key_configured: boolean;
  stop_key_configured: boolean;
  route_key_configured: boolean;
}

/** 국토교통부 TAGO 버스 실시간 도착 정보 결과 */
export interface BusRealtimeResult {
  available: boolean;
  provider: "TAGO";
  city_code: string | null;
  keys: TagoKeyStatus;
  departure_stop: TaGoStop | null;
  arrival_stop: TaGoStop | null;
  arrivals: TaGoArrivalItem[];
  checked_at: string;
  message: string;
  error?: string;
}

export interface BusPlanInput {
  query?: string | null;
  origin?: string | null;
  destination?: string | null;
  time?: string | null;
  time_type?: "departure" | "arrival" | null;
  user_type?: "general" | "elderly" | null;
  priority?: "fastest" | "easiest" | "fewest_transfers" | null;
  mode?: TransportMode | null;
  modes?: TransportMode[] | null;
  /** 사용자가 장소 후보를 선택하거나 전부 거부했을 때 담는 구조 */
  clarification_selection?: ClarificationSelection | null;
  /** 브라우저 Geolocation 좌표 — "현재 위치"를 출발지로 사용할 때 */
  current_location?: CurrentLocation | null;
  /** 지도 마커 등에서 직접 선택해 넘긴 출발지 장소 */
  origin_selected_place?: SelectedPlace | null;
  /** 지도 마커 등에서 직접 선택해 넘긴 목적지 장소 */
  destination_selected_place?: SelectedPlace | null;
}

export interface BusPlanResult {
  success: boolean;
  needs_clarification: boolean;
  clarification_question: string | null;
  /** 버튼 렌더링용 구조화 후보 정보 (needs_clarification 시) */
  clarification?: ClarificationInfo | null;
  /** 대표 장소 자동 선택 시 표시할 안내 메모 */
  provider_notes?: string[];
  service_name: string;
  data_source: string;
  provider: string;
  is_mock_data: boolean;
  bus_detail_available: boolean;
  default_mode_used: boolean;
  selected_modes: TransportMode[];
  origin: string | null;
  destination: string | null;
  origin_place: PlaceCandidate | null;
  destination_place: PlaceCandidate | null;
  route_options: RouteOption[];
  /** 자동차 경로 API 결과 (자동차 모드가 포함된 경우) */
  car_directions?: CarDirectionsResult | null;
  /** 버스 실시간 도착 정보 (대중교통 모드가 포함된 경우) */
  bus_realtime?: BusRealtimeResult | null;
  /** 자연어 경로 요약 포함 여부 */
  has_natural_route_summary?: boolean;
  kakao_map_route_url: string | null;
  kakao_map_app_url: string | null;
  route_link_available: boolean;
  route_link_type: string | null;
  /** 디버그: 자연어 파싱 결과 */
  parsed?: ParsedRouteQuery;
  /** 디버그: 출발지 후보 목록 (점수순) */
  origin_candidates?: ScoredCandidate[];
  /** 디버그: 목적지 후보 목록 (점수순) */
  destination_candidates?: ScoredCandidate[];
  /** 레거시 필드 — 항상 null. MCP/OpenAPI 응답 스키마 하위 호환용 */
  departure_stop: string | null;
  arrival_stop: string | null;
  bus_number: string | null;
  direction: string | null;
  scheduled_bus_departure_time: string | null;
  recommended_departure_time: string | null;
  estimated_arrival_time: string | null;
  reminder_time: string | null;
  walk_time_to_stop_minutes: number | null;
  wait_time_minutes: number | null;
  ride_time_minutes: number | null;
  walk_time_to_destination_minutes: number | null;
  transfer_count: number | null;
  safety_buffer_minutes: number | null;
  total_time_min: number | null;
  total_time_max: number | null;
  confidence: string | null;
  message_for_kakao: string;
  warning: string | null;
}
