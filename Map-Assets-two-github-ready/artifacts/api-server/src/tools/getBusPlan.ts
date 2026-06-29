import type {
  BusPlanInput,
  BusPlanResult,
  PlaceCandidate,
  ScoredCandidate,
  TransportMode,
  RouteOption,
  ParsedRouteQuery,
  BusRealtimeResult,
  SelectedPlace,
  CurrentLocation,
} from "../types/index.js";
import { parseRouteQuery, validateRouteEndpoints, CURRENT_LOCATION_MESSAGE } from "../services/routeParser.js";
import {
  resolvePlaceStrict,
  resolvePlaceStrictWithExclusions,
  buildAmbiguousQuestion,
  inferPlaceIntent,
  type StrictResolution,
} from "../services/placeResolver.js";
import { createKakaoRouteLinks } from "../services/kakaoMapProvider.js";
import { getTaGoBusRealtime, isTaGoAvailable } from "../services/tagoBusProvider.js";
import { buildKakaoMessage } from "../services/messageService.js";

const SERVICE_NAME = "카카오맵 길찾기 지원";
const DEFAULT_MODES: TransportMode[] = ["car", "publictransit"];

const EXAMPLE_LINES = [
  "예:",
  '"서울역에서 강남역까지"',
  '"운정역에서 홍대입구역까지"',
  '"부산역에서 해운대역까지"',
];

function composeFailure(reason: string, withExamples = true): string {
  const lines = [
    "죄송합니다.",
    "출발지와 목적지를 정확히 확정하지 못했습니다.",
    "",
    reason,
  ];
  if (withExamples) lines.push("", ...EXAMPLE_LINES);
  return lines.join("\n");
}

function baseResult(
  overrides: Partial<BusPlanResult> &
    Pick<BusPlanResult, "data_source" | "message_for_kakao">,
): BusPlanResult {
  return {
    success: false,
    needs_clarification: false,
    clarification_question: null,
    clarification: null,
    provider_notes: undefined,
    service_name: SERVICE_NAME,
    provider: "none",
    is_mock_data: false,
    bus_detail_available: false,
    default_mode_used: false,
    selected_modes: DEFAULT_MODES,
    origin: null,
    destination: null,
    origin_place: null,
    destination_place: null,
    route_options: [],
    car_directions: null,
    bus_realtime: null,
    has_natural_route_summary: false,
    kakao_map_route_url: null,
    kakao_map_app_url: null,
    route_link_available: false,
    route_link_type: null,
    parsed: undefined,
    origin_candidates: undefined,
    destination_candidates: undefined,
    departure_stop: null,
    arrival_stop: null,
    bus_number: null,
    direction: null,
    scheduled_bus_departure_time: null,
    recommended_departure_time: null,
    estimated_arrival_time: null,
    reminder_time: null,
    walk_time_to_stop_minutes: null,
    wait_time_minutes: null,
    ride_time_minutes: null,
    walk_time_to_destination_minutes: null,
    transfer_count: null,
    safety_buffer_minutes: null,
    total_time_min: null,
    total_time_max: null,
    confidence: null,
    warning: null,
    ...overrides,
  };
}

function resolveModes(
  input: BusPlanInput,
  parsed: ParsedRouteQuery,
): { modes: TransportMode[]; defaultModeUsed: boolean } {
  if (input.mode) return { modes: [input.mode], defaultModeUsed: false };
  if (input.modes && input.modes.length > 0) return { modes: input.modes, defaultModeUsed: false };
  return { modes: parsed.selected_modes, defaultModeUsed: parsed.default_mode_used };
}

function buildQuery(input: BusPlanInput): {
  query: string;
  explicitOrigin: string | null;
  explicitDestination: string | null;
} {
  const explicitOrigin = input.origin?.trim() || null;
  const explicitDestination = input.destination?.trim() || null;
  if (input.query && input.query.trim()) {
    return { query: input.query.trim(), explicitOrigin, explicitDestination };
  }
  const o = explicitOrigin ?? "";
  const d = explicitDestination ?? "";
  return { query: `${o}에서 ${d}까지`, explicitOrigin, explicitDestination };
}

/**
 * 사용자가 버튼으로 직접 선택한 장소를 StrictResolution으로 래핑합니다.
 */
function fixedPlaceResolution(
  place: SelectedPlace,
  placeText: string,
): StrictResolution {
  const candidate: ScoredCandidate = {
    name: place.name,
    address: place.address ?? null,
    road_address: null,
    category: place.category ?? null,
    latitude: place.latitude,
    longitude: place.longitude,
    place_url: place.place_url ?? null,
    source: "clarification_selection",
    confidence: "high",
    score: 200,
    score_reason: "user_selected",
  };
  return {
    status: "resolved",
    intent: inferPlaceIntent(placeText),
    selected: candidate,
    candidates: [candidate],
    region_hints: [],
  };
}

/**
 * 브라우저에서 받은 현재 위치 좌표를 검색 없이 StrictResolution으로 래핑합니다.
 */
function currentLocationResolution(loc: CurrentLocation): StrictResolution {
  const candidate: ScoredCandidate = {
    name: "현재 위치",
    address: null,
    road_address: null,
    category: null,
    latitude: loc.latitude,
    longitude: loc.longitude,
    place_url: null,
    source: "current_location",
    confidence: "high",
    score: 200,
    score_reason: "current_location",
  };
  return {
    status: "resolved",
    intent: inferPlaceIntent("현재 위치"),
    selected: candidate,
    candidates: [candidate],
    region_hints: [],
  };
}

const CURRENT_LOCATION_RE = /현재\s*위치|내\s*위치|제\s*위치|여기/;

// 자동차는 카카오맵 링크 전용 (모빌리티 API 미사용)
function resolveDataSource(
  modes: TransportMode[],
  busRealtime: BusRealtimeResult | null,
  busRealtimeAttempted: boolean,
): string {
  const hasTransit = modes.includes("publictransit");
  const busRealtimeAvailable = hasTransit && busRealtime?.available === true;

  if (busRealtimeAvailable) return "kakao_local_api_with_bus_realtime";
  if (hasTransit && busRealtimeAttempted) return "bus_realtime_unavailable";
  if (hasTransit) return "kakao_local_api_with_route_link_only";
  return "kakao_local_api_with_route_link";
}

export async function getBusPlan(input: BusPlanInput): Promise<BusPlanResult> {
  const { query, explicitOrigin, explicitDestination } = buildQuery(input);

  // ── 1단계: 파싱 ──────────────────────────────────────────────────────────
  const parsed = parseRouteQuery(query);
  if (explicitOrigin) parsed.origin_text = explicitOrigin;
  if (explicitDestination) parsed.destination_text = explicitDestination;

  const { modes, defaultModeUsed } = resolveModes(input, parsed);
  parsed.selected_modes = modes;
  parsed.default_mode_used = defaultModeUsed;

  // 현재 위치 좌표가 제공되고 출발지가 비었거나 "현재 위치" 표현이면 좌표를 출발지로 사용
  const currentLoc = input.current_location ?? null;
  const useCurrentLocationOrigin =
    !!currentLoc &&
    (!parsed.origin_text || CURRENT_LOCATION_RE.test(parsed.origin_text));
  if (useCurrentLocationOrigin) {
    parsed.origin_text = "현재 위치";
  }

  let blockingError: string | undefined;
  if (useCurrentLocationOrigin) {
    // 출발지는 좌표로 확정 → 목적지만 검증
    const dest = parsed.destination_text?.trim() ?? "";
    if (!dest) {
      blockingError = "목적지를 인식하지 못했습니다. 목적지를 입력해 주세요.";
    } else if (dest.length <= 1) {
      blockingError = "목적지 이름이 너무 짧습니다. 더 정확한 장소명을 입력해 주세요.";
    }
  } else {
    blockingError = validateRouteEndpoints(parsed.origin_text, parsed.destination_text);
    if (blockingError && parsed.parse_error === CURRENT_LOCATION_MESSAGE) {
      blockingError = CURRENT_LOCATION_MESSAGE;
    }
  }

  if (blockingError) {
    parsed.parse_error = blockingError;
    const msg = composeFailure(blockingError);
    return baseResult({
      needs_clarification: true,
      clarification_question: msg,
      data_source: "needs_clarification",
      default_mode_used: defaultModeUsed,
      selected_modes: modes,
      origin: parsed.origin_text,
      destination: parsed.destination_text,
      parsed,
      message_for_kakao: msg,
    });
  }
  parsed.parse_error = undefined;

  const originText = parsed.origin_text!;
  const destText = parsed.destination_text!;

  // ── 2단계: 장소 해석 ───────────────────────────────────────────────────────
  // clarification_selection + 지도 마커 직접 선택(selected_place) 처리
  const sel = input.clarification_selection ?? null;
  const selOriginFixed = sel?.target === "origin" && !sel.reject_all && sel.selected_place ? sel.selected_place : null;
  const selDestFixed = sel?.target === "destination" && !sel.reject_all && sel.selected_place ? sel.selected_place : null;
  // 지도 마커 등에서 직접 넘긴 장소가 우선
  const originFixed: SelectedPlace | null = input.origin_selected_place ?? selOriginFixed;
  const destFixed: SelectedPlace | null = input.destination_selected_place ?? selDestFixed;
  const isOriginReject = sel?.target === "origin" && sel.reject_all === true;
  const isDestReject = sel?.target === "destination" && sel.reject_all === true;

  const [originRes, destRes] = await Promise.all([
    useCurrentLocationOrigin
      ? Promise.resolve(currentLocationResolution(currentLoc!))
      : originFixed
      ? Promise.resolve(fixedPlaceResolution(originFixed, originText))
      : isOriginReject
      ? resolvePlaceStrictWithExclusions(originText, "origin", sel!.rejected_candidates ?? [])
      : resolvePlaceStrict(originText, "origin"),

    destFixed
      ? Promise.resolve(fixedPlaceResolution(destFixed, destText))
      : isDestReject
      ? resolvePlaceStrictWithExclusions(destText, "destination", sel!.rejected_candidates ?? [])
      : resolvePlaceStrict(destText, "destination"),
  ]);

  const originCandidates = originRes.candidates;
  const destCandidates = destRes.candidates;

  if (originRes.status === "unavailable" || destRes.status === "unavailable") {
    const msg = [
      "현재 장소 검색 서비스를 사용할 수 없습니다.",
      "(카카오 지도 검색 키 미설정 또는 카카오맵 서비스 비활성화)",
      "잠시 후 다시 시도해 주세요.",
    ].join("\n");
    return baseResult({
      needs_clarification: false,
      data_source: "service_unavailable",
      default_mode_used: defaultModeUsed,
      selected_modes: modes,
      origin: originText,
      destination: destText,
      parsed,
      message_for_kakao: msg,
    });
  }

  // reject_all 후 not_found 특별 메시지
  if ((isOriginReject && originRes.status === "not_found") ||
      (isDestReject && destRes.status === "not_found")) {
    const msg = [
      "방금 선택지에 원하는 장소가 없었습니다.",
      "더 정확한 장소명을 입력해 주세요.",
      "",
      "예: 정확한 주소나 건물명을 함께 입력해 보세요.",
    ].join("\n");
    return baseResult({
      needs_clarification: true,
      clarification_question: msg,
      data_source: "needs_clarification",
      default_mode_used: defaultModeUsed,
      selected_modes: modes,
      origin: originText,
      destination: destText,
      parsed,
      message_for_kakao: msg,
    });
  }

  const originIssue = resolutionIssue(originRes, originText, "출발지");
  if (originIssue) {
    return baseResult({
      needs_clarification: true,
      clarification_question: originIssue,
      clarification: originRes.clarification ?? null,
      data_source: originRes.status === "not_found" ? "place_not_found" : "needs_clarification",
      default_mode_used: defaultModeUsed,
      selected_modes: modes,
      origin: originText,
      destination: destText,
      parsed,
      origin_candidates: originCandidates,
      destination_candidates: destCandidates,
      message_for_kakao: originIssue,
    });
  }

  const destIssue = resolutionIssue(destRes, destText, "목적지");
  if (destIssue) {
    return baseResult({
      needs_clarification: true,
      clarification_question: destIssue,
      clarification: destRes.clarification ?? null,
      data_source: destRes.status === "not_found" ? "place_not_found" : "needs_clarification",
      default_mode_used: defaultModeUsed,
      selected_modes: modes,
      origin: originText,
      destination: destText,
      parsed,
      origin_candidates: originCandidates,
      destination_candidates: destCandidates,
      message_for_kakao: destIssue,
    });
  }

  const originPlace = originRes.selected!;
  const destinationPlace = destRes.selected!;

  // 출발지 = 목적지 체크
  const samePlace =
    (originPlace.place_url && originPlace.place_url === destinationPlace.place_url) ||
    (originPlace.latitude != null &&
      originPlace.longitude != null &&
      originPlace.latitude === destinationPlace.latitude &&
      originPlace.longitude === destinationPlace.longitude);

  if (samePlace) {
    const reason = "출발지와 목적지가 같은 장소로 인식되었습니다. 서로 다른 두 장소를 입력해 주세요.";
    const msg = composeFailure(reason);
    return baseResult({
      needs_clarification: true,
      clarification_question: msg,
      data_source: "needs_clarification",
      default_mode_used: defaultModeUsed,
      selected_modes: modes,
      origin: originText,
      destination: destText,
      origin_place: originPlace,
      destination_place: destinationPlace,
      parsed,
      origin_candidates: originCandidates,
      destination_candidates: destCandidates,
      message_for_kakao: msg,
    });
  }

  // ── 3단계: 링크 생성 ───────────────────────────────────────────────────────
  const routeOptions: RouteOption[] = createKakaoRouteLinks(
    originPlace.latitude,
    originPlace.longitude,
    destinationPlace.latitude,
    destinationPlace.longitude,
    modes,
  );
  const hasAnyLink = routeOptions.some((o) => o.route_link_available);
  const primaryOption =
    routeOptions.find((o) => o.mode === "publictransit") ??
    routeOptions.find((o) => o.mode === "car") ??
    routeOptions[0];

  if (!hasAnyLink) {
    const reason = "장소 좌표 정보가 없어 카카오맵 길찾기 링크를 만들 수 없습니다.";
    const msg = composeFailure(reason);
    return baseResult({
      needs_clarification: true,
      clarification_question: msg,
      data_source: "no_coordinate",
      default_mode_used: defaultModeUsed,
      selected_modes: modes,
      origin: originText,
      destination: destText,
      origin_place: originPlace,
      destination_place: destinationPlace,
      route_options: routeOptions,
      parsed,
      origin_candidates: originCandidates,
      destination_candidates: destCandidates,
      message_for_kakao: msg,
    });
  }

  // ── 4단계: 버스 실시간 도착정보 (자동차는 카카오맵 링크 전용) ──────────────
  const hasTransit = modes.includes("publictransit");
  const busRealtimeAttempted = hasTransit && isTaGoAvailable();

  const busRealtime = busRealtimeAttempted
    ? await getTaGoBusRealtime(originPlace, destinationPlace)
    : null;
  const carDirections = null;

  const dataSource = resolveDataSource(modes, busRealtime, busRealtimeAttempted);
  const hasNaturalRouteSummary = busRealtime?.available === true;

  // provider_notes: 자동 선택 시 메모 (출발지 + 목적지 합산)
  const providerNotes = [
    ...(originRes.provider_notes ?? []),
    ...(destRes.provider_notes ?? []),
  ];

  const isElderly = input.user_type === "elderly";
  const partial: Omit<BusPlanResult, "message_for_kakao"> = {
    ...baseResult({ data_source: dataSource, message_for_kakao: "" }),
    success: true,
    needs_clarification: false,
    clarification_question: null,
    clarification: null,
    provider_notes: providerNotes.length > 0 ? providerNotes : undefined,
    provider: "kakao_local_api",
    is_mock_data: false,
    default_mode_used: defaultModeUsed,
    selected_modes: modes,
    origin: originText,
    destination: destText,
    origin_place: originPlace,
    destination_place: destinationPlace,
    route_options: routeOptions,
    car_directions: carDirections,
    bus_realtime: busRealtime,
    has_natural_route_summary: hasNaturalRouteSummary,
    kakao_map_route_url: primaryOption?.kakao_map_route_url ?? null,
    kakao_map_app_url: primaryOption?.kakao_map_app_url ?? null,
    route_link_available: hasAnyLink,
    route_link_type: "kakao_map_route",
    parsed,
    origin_candidates: originCandidates,
    destination_candidates: destCandidates,
  };

  return { ...partial, message_for_kakao: buildKakaoMessage(partial, isElderly) };
}

function resolutionIssue(
  res: StrictResolution,
  placeText: string,
  label: string,
): string | null {
  if (res.status === "resolved" && res.selected) return null;

  if (res.status === "not_found" || res.candidates.length === 0) {
    const reason = `${label} "${placeText}" 장소를 찾지 못했습니다. 더 정확한 장소명(또는 지역명 포함)으로 다시 입력해 주세요.`;
    return composeFailure(reason);
  }

  const prefix = `${label} "${placeText}"의 검색 결과가 명확하지 않습니다.`;
  return [
    "죄송합니다.",
    "출발지와 목적지를 정확히 확정하지 못했습니다.",
    "",
    prefix,
    "",
    buildAmbiguousQuestion(res.candidates),
  ].join("\n");
}

export type { PlaceCandidate, ScoredCandidate };
