import type { BusPlanResult, RouteOption, TransportMode, BusRealtimeResult } from "../types/index.js";
import { MODE_ICONS } from "../types/index.js";

const GUIDE_LINES_GENERAL = [
  "안내:",
  "• 장소 정보는 카카오맵 기준입니다.",
  "• 출발지나 목적지가 다르게 보이면 더 정확한 장소명으로 다시 입력해 주세요.",
];

const GUIDE_LINES_TRANSIT = [
  "안내:",
  "• 버스/지하철 노선과 상세 경로는 카카오맵 화면에서 확인해 주세요.",
  "• 이 서비스는 대중교통 경로를 임의로 만들어내지 않습니다.",
];

const GUIDE_LINES_TRANSIT_REALTIME = [
  "안내:",
  "• 실시간 버스 정보는 국토교통부 TAGO API 기준입니다.",
  "• 실제 도착 시간은 교통 상황에 따라 달라질 수 있습니다.",
  "• 환승 정보와 상세 경로는 카카오맵 화면에서 확인해 주세요.",
];

const GUIDE_LINES_CAR = [
  "안내:",
  "• 자동차 경로와 예상 시간은 카카오맵 화면에서 확인해 주세요.",
  "• 장소 정보는 카카오맵 기준입니다.",
];

/** 버스 실시간 정보 블록 (대중교통 섹션에 포함) */
function buildBusRealtimeBlock(br: BusRealtimeResult): string {
  if (!br.available || !br.departure_stop) {
    return ["🕐 실시간 버스 도착 정보", "⚠️ " + br.message].join("\n");
  }

  const stop = br.departure_stop;
  const lines: string[] = ["🕐 출발지 인근 실시간 버스 정보", ""];

  const stopLabel = stop.distance_meters != null
    ? `📍 ${stop.name} (약 ${stop.distance_meters}m)`
    : `📍 ${stop.name}`;
  lines.push(stopLabel);

  for (const arr of br.arrivals.slice(0, 3)) {
    const timeText = arr.arrival_time_minutes === 0 ? "곧 도착" : `약 ${arr.arrival_time_minutes}분`;
    const dirText = arr.direction ? ` (방향: ${arr.direction})` : "";
    lines.push(`  ${arr.route_number}번: ${timeText} · 남은 정류장 ${arr.remaining_stops}개${dirText}`);
  }

  lines.push("", `🕑 조회 시각: ${br.checked_at}`);

  return lines.join("\n");
}

export function buildKakaoMessage(
  plan: Omit<BusPlanResult, "message_for_kakao">,
  isElderly: boolean,
): string {
  if (!plan.success) {
    if (plan.clarification_question) return plan.clarification_question;
    return buildNoLinkMessage();
  }

  const availableOptions = (plan.route_options ?? []).filter((o) => o.route_link_available);
  if (availableOptions.length === 0) return buildNoLinkMessage();

  if (isElderly) return buildElderlyMessage(plan, availableOptions);

  const modes = plan.selected_modes ?? [];
  const isSingleCar = modes.length === 1 && modes[0] === "car";
  const isSingleTransit = modes.length === 1 && (modes[0] === "publictransit" || modes[0] === "foot" || modes[0] === "bicycle");
  const isDefault = plan.default_mode_used;

  if (isSingleCar) {
    return buildCarMessage(plan, availableOptions);
  }
  if (isSingleTransit) {
    return buildTransitLinkMessage(plan, availableOptions, modes[0]);
  }
  if (isDefault) {
    return buildDefaultMixedMessage(plan, availableOptions);
  }

  return buildSuccessMessage(plan, availableOptions);
}

/** 자동차 단독 — 카카오맵 링크 전용 */
function buildCarMessage(
  plan: Omit<BusPlanResult, "message_for_kakao">,
  options: RouteOption[],
): string {
  const originName = plan.origin_place?.name ?? plan.origin ?? "-";
  const destName = plan.destination_place?.name ?? plan.destination ?? "-";
  const carOpt = options.find((o) => o.mode === "car") ?? options[0];

  return [
    "🚗 자동차 길찾기",
    "",
    `출발: ${originName}`,
    `도착: ${destName}`,
    "",
    "아래 링크를 누르면 카카오맵에서",
    "자동차 경로와 예상 시간을 확인할 수 있습니다.",
    "",
    "👉 카카오맵 자동차 길찾기",
    carOpt.kakao_map_route_url ?? "",
    "",
    ...GUIDE_LINES_CAR,
  ].join("\n");
}

/** 대중교통 단독 — 실시간 정보 있으면 포함, 없으면 링크만 */
function buildTransitLinkMessage(
  plan: Omit<BusPlanResult, "message_for_kakao">,
  options: RouteOption[],
  mode: TransportMode,
): string {
  const originName = plan.origin_place?.name ?? plan.origin ?? "-";
  const destName = plan.destination_place?.name ?? plan.destination ?? "-";

  const opt = options.find((o) => o.mode === mode) ?? options[0];
  const url = opt.kakao_map_route_url ?? "";
  const br = plan.bus_realtime;
  const hasRealtime = mode === "publictransit" && br?.available === true && br.departure_stop != null;

  if (mode !== "publictransit") {
    const modeEmoji = mode === "foot" ? "🚶" : mode === "bicycle" ? "🚲" : "🗺️";
    const modeLabel = mode === "foot" ? "도보" : mode === "bicycle" ? "자전거" : mode;
    return [
      `${modeEmoji} ${modeLabel} 길찾기`,
      "",
      `출발: ${originName}`,
      `도착: ${destName}`,
      "",
      "아래 링크를 누르면 카카오맵에서",
      `실제 ${modeLabel} 경로, 예상 시간을 확인할 수 있습니다.`,
      "",
      `👉 ${url}`,
      "",
      ...GUIDE_LINES_GENERAL,
    ].join("\n");
  }

  if (hasRealtime && br) {
    const stop = br.departure_stop!;
    const stopLabel = stop.distance_meters != null
      ? `${stop.name} (약 ${stop.distance_meters}m)`
      : stop.name;

    const lines: string[] = [
      "🚌 실시간 버스 도착 정보",
      "",
      `출발: ${originName}`,
      `도착: ${destName}`,
      "",
      "가까운 출발 정류장:",
      stopLabel,
      "",
      "현재 확인 가능한 버스:",
      "",
    ];

    br.arrivals.slice(0, 5).forEach((arr, i) => {
      const timeText = arr.arrival_time_minutes === 0 ? "곧 도착" : `약 ${arr.arrival_time_minutes}분 후 도착`;
      lines.push(`${i + 1}. ${arr.route_number}번`);
      lines.push(`   ${timeText}`);
      lines.push(`   남은 정류장: ${arr.remaining_stops}개`);
      if (arr.direction) lines.push(`   방향: ${arr.direction}`);
    });

    lines.push(
      "",
      "자세한 전체 경로는 아래 카카오맵 링크에서 확인해 주세요.",
      `👉 ${url}`,
      "",
      "안내:",
      "• 실시간 버스 정보는 TAGO 공공데이터 기준입니다.",
      "• 실제 도착 시간은 교통 상황에 따라 달라질 수 있습니다.",
    );

    return lines.join("\n");
  }

  // 실시간 정보 없음 — 링크만
  return [
    "🚌 대중교통 길찾기",
    "",
    `출발: ${originName}`,
    `도착: ${destName}`,
    "",
    "현재 이 지역의 실시간 버스 정보를 확인하지 못했습니다.",
    "대신 카카오맵에서 실제 대중교통 경로를 확인할 수 있습니다.",
    "",
    `👉 ${url}`,
    "",
    "안내:",
    "• 장소 정보는 카카오맵 기준입니다.",
    "• 버스 노선과 예상 시간은 카카오맵 화면에서 확인해 주세요.",
  ].join("\n");
}

/** 이동수단 미지정 — 자동차 + 대중교통 기본 */
function buildDefaultMixedMessage(
  plan: Omit<BusPlanResult, "message_for_kakao">,
  options: RouteOption[],
): string {
  const originName = plan.origin_place?.name ?? plan.origin ?? "-";
  const destName = plan.destination_place?.name ?? plan.destination ?? "-";
  const carOpt = options.find((o) => o.mode === "car");
  const transitOpt = options.find((o) => o.mode === "publictransit");
  const br = plan.bus_realtime;

  const lines: string[] = [
    "🗺️ 카카오맵 길찾기 지원",
    "",
    `출발: ${originName}`,
    `도착: ${destName}`,
    "",
    "이동수단을 입력하지 않아",
    "자동차와 대중교통 두 가지 경로를 안내합니다.",
    "",
  ];

  if (carOpt) {
    lines.push("🚗 자동차 경로");
    lines.push("카카오맵에서 자동차 경로와 예상 시간을 확인해 주세요.");
    lines.push(`👉 ${carOpt.kakao_map_route_url}`, "");
  }

  if (transitOpt) {
    lines.push("🚌 대중교통 경로");
    if (br?.available) {
      lines.push("", buildBusRealtimeBlock(br), "");
    } else if (br != null) {
      lines.push(`⚠️ ${br.message}`, "");
    } else {
      lines.push("카카오맵에서 버스/지하철 경로와 예상 시간을 확인해 주세요.");
    }
    lines.push(`👉 ${transitOpt.kakao_map_route_url}`, "");
  }

  const noteLines: string[] = [];
  if (br?.available) {
    noteLines.push("• 실시간 버스 정보는 국토교통부 TAGO API 기준입니다.");
  }
  noteLines.push("• 실제 소요시간은 교통 상황에 따라 달라질 수 있습니다.");
  noteLines.push("• 자동차/대중교통 상세 경로와 예상 시간은 카카오맵 화면에서 확인해 주세요.");
  lines.push("안내:", ...noteLines);

  return lines.join("\n");
}

/** 일반 다중 이동수단 (사용자가 여러 개 지정) */
function buildSuccessMessage(
  plan: Omit<BusPlanResult, "message_for_kakao">,
  options: RouteOption[],
): string {
  const originName = plan.origin_place?.name ?? plan.origin ?? "-";
  const destName = plan.destination_place?.name ?? plan.destination ?? "-";

  const blocks: string[] = [];
  for (const opt of options) {
    const icon = MODE_ICONS[opt.mode] ?? "🗺️";
    if (opt.mode === "publictransit" && plan.bus_realtime?.available) {
      const parts = [`${icon} ${opt.mode_label} 길찾기`, "", buildBusRealtimeBlock(plan.bus_realtime), `👉 ${opt.kakao_map_route_url}`];
      blocks.push(parts.join("\n"));
    } else {
      blocks.push(`${icon} ${opt.mode_label} 길찾기\n👉 ${opt.kakao_map_route_url}`);
    }
  }

  return [
    "🗺️ 카카오맵 길찾기 지원",
    "",
    `출발: ${originName}`,
    `도착: ${destName}`,
    "",
    blocks.join("\n\n"),
    "",
    ...GUIDE_LINES_GENERAL,
  ].join("\n");
}

/** 확정 성공 메시지 (노인 친화형) */
function buildElderlyMessage(
  plan: Omit<BusPlanResult, "message_for_kakao">,
  options: RouteOption[],
): string {
  const originName = plan.origin_place?.name ?? plan.origin ?? "-";
  const destName = plan.destination_place?.name ?? plan.destination ?? "-";

  const linkLines: string[] = [];
  for (const opt of options) {
    const icon = MODE_ICONS[opt.mode] ?? "🗺️";
    linkLines.push(`${icon} ${opt.mode_label}: ${opt.kakao_map_route_url}`);
  }

  return [
    "👵 천천히 따라오시면 됩니다.",
    "",
    `출발지는 ${originName}이고,`,
    `도착지는 ${destName}입니다.`,
    "",
    "아래 링크를 누르면 카카오맵에서",
    "길찾기 화면이 열립니다.",
    "",
    ...linkLines,
    "",
    "카카오맵 화면에서",
    "자세한 길과 예상 시간을 확인해 주세요.",
    "",
    "※ 장소 정보는 카카오맵 기준입니다.",
    "※ 출발지나 목적지가 다르면 더 정확한 장소명으로 다시 입력해 주세요.",
  ].join("\n");
}

/** 링크 생성 불가 시 */
function buildNoLinkMessage(): string {
  return [
    "죄송합니다.",
    "출발지와 목적지를 정확히 확정하지 못했습니다.",
    "",
    "출발지와 목적지를 '출발지에서 목적지까지' 형식으로 입력해 주세요.",
    "",
    "예:",
    '"서울역에서 강남역까지"',
    '"운정역에서 홍대입구역까지"',
    '"부산역에서 해운대역까지"',
  ].join("\n");
}

export function buildReminderMessage(plan: BusPlanResult): string {
  const originName = plan.origin_place?.name ?? plan.origin ?? "-";
  const destName = plan.destination_place?.name ?? plan.destination ?? "-";

  const lines: string[] = [
    "⏰ 길찾기 알림",
    "",
    `${originName} → ${destName}`,
    "",
  ];

  const availableOptions = plan.route_options?.filter((o) => o.route_link_available) ?? [];
  if (availableOptions.length > 0) {
    lines.push("카카오맵에서 경로를 미리 확인해 두세요.");
    for (const opt of availableOptions) {
      const icon = MODE_ICONS[opt.mode] ?? "🗺️";
      lines.push(`${icon} ${opt.mode_label}: ${opt.kakao_map_route_url}`);
    }
    lines.push("");
    lines.push("실제 출발 시간과 소요시간은 카카오맵 화면에서 확인해 주세요.");
  } else {
    lines.push("카카오맵 링크를 열어 실제 출발 시간을 확인해 주세요.");
  }

  return lines.join("\n");
}

