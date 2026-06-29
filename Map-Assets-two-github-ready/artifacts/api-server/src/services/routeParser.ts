import type { TransportMode, ParsedRouteQuery } from "../types/index.js";

const DEFAULT_MODES: TransportMode[] = ["publictransit", "car"];

export const CURRENT_LOCATION_MESSAGE =
  "현재 위치 정보가 필요합니다. 출발지를 직접 입력해 주세요. 예: 서울역에서 강남역까지";

// ── 이동수단 감지 + 제거 ─────────────────────────────────────────────────────
// 각 패턴은 감지와 제거에 모두 사용. 단어형 표현(버스/지하철 등)은 장소명 안의
// 글자(예: "삼척터미널"의 "터미널")를 깨뜨리지 않도록 경계를 둔다.
interface ModePattern {
  mode: TransportMode;
  re: RegExp;
}

const MODE_PATTERNS: ModePattern[] = [
  { mode: "publictransit", re: /대중교통(?:으로|로)?/g },
  { mode: "publictransit", re: /(?:^|\s)버스(?:로)?(?=\s|$)/g },
  { mode: "publictransit", re: /(?:^|\s)지하철(?:로)?(?=\s|$)/g },
  { mode: "publictransit", re: /(?:^|\s)전철(?:로)?(?=\s|$)/g },
  { mode: "publictransit", re: /publictransit(?:으로|로)?/gi },
  { mode: "car", re: /자동차(?:로)?/g },
  { mode: "car", re: /자가용(?:으로|로)?/g },
  { mode: "car", re: /운전(?:해서|으로|해)?/g },
  { mode: "car", re: /(?:^|\s)차로(?=\s|$)/g },
  { mode: "car", re: /(?:^|\s)car(?:로)?(?=\s|$)/gi },
  { mode: "bicycle", re: /자전거(?:로)?/g },
  { mode: "bicycle", re: /(?:^|\s)bicycle(?:으로|로)?(?=\s|$)/gi },
  { mode: "bicycle", re: /(?:^|\s)bike(?:으로|로)?(?=\s|$)/gi },
  { mode: "foot", re: /도보(?:로)?/g },
  { mode: "foot", re: /걸어서/g },
  { mode: "foot", re: /걸어(?=\s|$)/g },
  { mode: "foot", re: /걷기(?:로)?/g },
  { mode: "foot", re: /(?:^|\s)foot(?:으로|로)?(?=\s|$)/gi },
  { mode: "foot", re: /(?:^|\s)walk(?:으로|로)?(?=\s|$)/gi },
];

function detectAndStripMode(text: string): { cleaned: string; mode: TransportMode | null } {
  let working = ` ${text} `;
  let mode: TransportMode | null = null;
  for (const { mode: m, re } of MODE_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(working)) {
      if (!mode) mode = m;
      re.lastIndex = 0;
      working = working.replace(re, " ");
    }
  }
  return { cleaned: working.replace(/\s+/g, " ").trim(), mode };
}

// ── 불필요 표현 제거 ─────────────────────────────────────────────────────────
const NOISE_PATTERNS: RegExp[] = [
  /지금/g,
  /오늘/g,
  /현재(?!\s*위치)/g,
  /길찾기/g,
  /경로/g,
  /루트/g,
  /최단/g,
  /가장\s*빠른/g,
  /빠른\s*길/g,
  /알려\s*주세요/g,
  /알려줘/g,
  /부탁해(?:요)?/g,
  /가려면/g,
  /가는\s*길/g,
  /가고\s*싶어(?:요)?/g,
  /가야\s*해(?:요)?/g,
  /어떻게\s*가[ㄴ는나요]*/g,
  /얼마나\s*걸려(?:요)?/g,
  /해줘/g,
  /찾아줘/g,
];

function removeNoise(text: string): string {
  let working = text;
  for (const re of NOISE_PATTERNS) {
    re.lastIndex = 0;
    working = working.replace(re, " ");
  }
  return working.replace(/\s+/g, " ").trim();
}

// ── 출발지/목적지 패턴 ───────────────────────────────────────────────────────
const FULL_PATTERNS: RegExp[] = [
  /^(.+?)\s*에서\s*(.+?)\s*까지$/,
  /^(.+?)\s*에서\s*(.+?)\s*(?:으로|로)$/,
  /^(.+?)\s*부터\s*(.+?)\s*까지$/,
  /^(.+?)\s*(?:->|→)\s*(.+?)$/,
];

interface LocationParse {
  origin: string | null;
  destination: string | null;
  confidence: "high" | "medium" | "low";
}

function parseLocations(text: string): LocationParse {
  const t = text.trim();

  for (const re of FULL_PATTERNS) {
    const m = t.match(re);
    if (m) {
      const origin = (m[1] ?? "").trim();
      const destination = (m[2] ?? "").trim();
      if (origin && destination) return { origin, destination, confidence: "high" };
    }
  }

  // 한쪽만 인식 (느슨한 처리)
  const toOnly = t.match(/^(.+?)\s*까지$/);
  const fromOnly = t.match(/^(.+?)\s*에서$/);
  if (toOnly && !fromOnly) {
    return { origin: null, destination: (toOnly[1] ?? "").trim() || null, confidence: "medium" };
  }
  if (fromOnly && !toOnly) {
    return { origin: (fromOnly[1] ?? "").trim() || null, destination: null, confidence: "medium" };
  }

  const both = t.match(/(.+?)\s*에서\s*(.+?)\s*까지/);
  if (both) {
    return {
      origin: (both[1] ?? "").trim() || null,
      destination: (both[2] ?? "").trim() || null,
      confidence: "medium",
    };
  }

  const onlyTo = t.match(/(.+?)\s*까지/);
  if (onlyTo) return { origin: null, destination: (onlyTo[1] ?? "").trim() || null, confidence: "medium" };
  const onlyFrom = t.match(/(.+?)\s*에서/);
  if (onlyFrom) return { origin: (onlyFrom[1] ?? "").trim() || null, destination: null, confidence: "medium" };

  return { origin: null, destination: null, confidence: "low" };
}

// ── 검증 ─────────────────────────────────────────────────────────────────────
const MODE_WORDS = new Set([
  "대중교통", "버스", "지하철", "전철", "자동차", "자가용", "차", "차로",
  "자전거", "도보", "걸어서", "걷기", "운전", "publictransit", "car", "bike", "bicycle", "foot", "walk",
]);
const COMMAND_WORDS = new Set([
  "지금", "현재", "오늘", "길찾기", "경로", "루트", "최단", "출발", "도착", "이동",
]);

function normalize(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

function containsCurrentLocation(s: string): boolean {
  return /여기|현재\s*위치|내\s*위치|제\s*위치/.test(s);
}

function isModeOrCommandWord(s: string): boolean {
  const n = s.replace(/\s+/g, "");
  return MODE_WORDS.has(n) || COMMAND_WORDS.has(n);
}

/**
 * 출발지/목적지 텍스트 자체의 유효성 검사. 파싱 결과뿐 아니라
 * 명시적으로 넘어온 origin/destination 재검증에도 동일하게 사용한다.
 * 문제가 없으면 undefined, 있으면 사용자용 안내 문구를 반환.
 */
export function validateRouteEndpoints(origin: string | null, destination: string | null): string | undefined {
  if (!origin && !destination) {
    return "출발지와 목적지를 모두 인식하지 못했습니다. '출발지에서 목적지까지' 형식으로 입력해 주세요.";
  }
  if (!origin) {
    return "출발지를 인식하지 못했습니다. 출발지와 목적지를 함께 입력해 주세요.";
  }
  if (!destination) {
    return "목적지를 인식하지 못했습니다. 출발지와 목적지를 함께 입력해 주세요.";
  }
  if (containsCurrentLocation(origin) || containsCurrentLocation(destination)) {
    return CURRENT_LOCATION_MESSAGE;
  }
  if (origin.trim().length <= 1) {
    return "출발지 이름이 너무 짧습니다. 더 정확한 장소명을 입력해 주세요.";
  }
  if (destination.trim().length <= 1) {
    return "목적지 이름이 너무 짧습니다. 더 정확한 장소명을 입력해 주세요.";
  }
  if (isModeOrCommandWord(origin)) {
    return "출발지를 장소 이름으로 입력해 주세요.";
  }
  if (isModeOrCommandWord(destination)) {
    return "목적지를 장소 이름으로 입력해 주세요.";
  }
  if (normalize(origin) === normalize(destination)) {
    return "출발지와 목적지가 같습니다. 서로 다른 두 장소를 입력해 주세요.";
  }
  return undefined;
}

/**
 * 자연어 길찾기 질의를 파싱합니다.
 * 이동수단·출발지·목적지를 분리하고, 애매하면 parse_error를 채워 반환합니다.
 */
export function parseRouteQuery(query: string): ParsedRouteQuery {
  const original = query ?? "";
  const trimmed = original.trim();

  const { cleaned: afterMode, mode } = detectAndStripMode(trimmed);
  const selectedModes = mode ? [mode] : DEFAULT_MODES;
  const defaultModeUsed = !mode;

  const base: ParsedRouteQuery = {
    original_query: original,
    cleaned_query: afterMode,
    detected_mode: mode,
    selected_modes: selectedModes,
    default_mode_used: defaultModeUsed,
    origin_text: null,
    destination_text: null,
    parse_confidence: "low",
  };

  // 현재 위치 요청은 출발지/목적지 파싱 전에 별도 처리
  if (containsCurrentLocation(trimmed)) {
    return { ...base, parse_error: CURRENT_LOCATION_MESSAGE };
  }

  const cleaned = removeNoise(afterMode);
  base.cleaned_query = cleaned;

  const { origin, destination, confidence } = parseLocations(cleaned);
  base.origin_text = origin;
  base.destination_text = destination;

  const error = validateRouteEndpoints(origin, destination);
  if (error) {
    return { ...base, parse_confidence: "low", parse_error: error };
  }

  base.parse_confidence = confidence;
  return base;
}
