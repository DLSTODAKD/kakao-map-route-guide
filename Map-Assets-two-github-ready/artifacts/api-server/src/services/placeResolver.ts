import type { PlaceCandidate, ScoredCandidate, PlaceIntent, PlaceIntentType, ClarificationInfo } from "../types/index.js";
import { searchPlace, isKakaoAvailable, KakaoServiceError } from "./kakaoMapProvider.js";

// ── 지역명 ───────────────────────────────────────────────────────────────────
const REGION_HINTS: string[] = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
  "수원", "성남", "고양", "용인", "안양", "부천", "안산", "남양주", "화성", "평택",
  "파주", "운정", "김포", "광명", "군포", "의정부", "시흥",
  "용산", "강남", "강북", "마포", "송파", "서초", "종로", "영등포", "구로",
  "해운대", "수영", "동래", "사하", "북구", "남구",
  "강릉", "춘천", "원주", "속초", "동해", "태백", "정선", "영월", "평창", "홍천", "삼척",
  "청주", "충주", "천안", "아산", "전주", "익산", "여수", "순천", "목포",
  "포항", "경주", "구미", "안동", "창원", "김해", "진주", "양산", "거제",
];

export function extractRegionHints(text: string): string[] {
  const found = new Set<string>();
  for (const r of REGION_HINTS) {
    if (text.includes(r)) found.add(r);
  }
  return [...found];
}

// ── 장소 유형 추론 ───────────────────────────────────────────────────────────
const TRANSIT_CONTEXT = /역\s*(?:\d+\s*번?\s*출구|출구|근처|앞|광장|사거리|교차로|\d+번)/;

export function inferPlaceIntent(placeText: string): PlaceIntent {
  const raw = placeText.trim();
  const normalized = raw.replace(/\s+/g, "");

  const build = (type: PlaceIntentType, strict = false): PlaceIntent => ({ raw, normalized, type, strict });

  if (/역$/.test(normalized)) return build("station", true);
  if (TRANSIT_CONTEXT.test(raw) || /입구역/.test(normalized)) return build("station", true);

  if (/터미널/.test(normalized)) return build("terminal");
  if (/공항/.test(normalized)) return build("airport");
  if (/(병원|의료원)/.test(normalized)) return build("hospital");
  if (/(대학교|대학|고등학교|중학교|초등학교|캠퍼스)/.test(normalized)) return build("school");
  if (/시장/.test(normalized)) return build("market");
  if (/(시청|군청|구청|주민센터|행정복지센터)/.test(normalized)) return build("public_office");

  return build("generic");
}

// ── 검색어 후보 생성 ─────────────────────────────────────────────────────────
export function buildSearchQueries(placeText: string, intent: PlaceIntent): string[] {
  const p = placeText.trim();
  let list: string[];
  switch (intent.type) {
    case "station":
      list = [p, `${p} 역`, `${p} 지하철역`, `${p} 기차역`, `${p} 철도역`];
      break;
    case "terminal":
      list = [p, `${p} 터미널`, `${p} 버스터미널`];
      break;
    case "airport":
      list = [p, `${p} 공항`];
      break;
    default:
      list = [p];
  }
  return [...new Set(list.filter((s) => s.trim().length > 0))];
}

// ── 점수화 ───────────────────────────────────────────────────────────────────
function norm(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, "").toLowerCase();
}

const STATION_CATEGORY = /(지하철|전철|기차|철도|고속철도|KTX|SRT)/;
const STATION_BAD_CATEGORY = /(음식점|카페|숙박|주차장|버스정류장|상가|음식|술집|미용|교차로|도로시설|사거리)/;
const STATION_BAD_NAME = /(맛집|카페|호텔|모텔|주차장|버스정류장|정류장|출구|사거리|교차로|오피스텔|아파트|타워|빌딩|상가)/;

function categoryMatchesIntent(category: string, type: PlaceIntentType): boolean {
  switch (type) {
    case "station": return STATION_CATEGORY.test(category);
    case "terminal": return /터미널/.test(category);
    case "airport": return /공항/.test(category);
    case "hospital": return /(병원|의료|의원)/.test(category);
    case "school": return /(학교|대학|교육)/.test(category);
    case "market": return /(시장|상점|상가)/.test(category);
    case "public_office": return /(관공서|공공기관|행정|시청|군청|구청)/.test(category);
    default: return false;
  }
}

export interface ScoreResult {
  score: number;
  reason: string;
}

export function scorePlaceCandidate(
  candidate: Pick<PlaceCandidate, "name" | "address" | "road_address" | "category">,
  placeText: string,
  intent: PlaceIntent,
  context: { regionHints: string[] },
): ScoreResult {
  let score = 0;
  const reasons: string[] = [];
  const add = (n: number, why: string) => { score += n; reasons.push(`${n > 0 ? "+" : ""}${n} ${why}`); };

  const name = (candidate.name ?? "").trim();
  const nameN = norm(name);
  const placeN = norm(placeText);
  const addr = `${candidate.address ?? ""} ${candidate.road_address ?? ""}`;
  const category = candidate.category ?? "";

  if (name === placeText.trim()) add(100, "exact name");
  else if (nameN === placeN) add(90, "no-space match");
  else if (placeN && nameN.includes(placeN)) add(50, "name contains query");
  else if (nameN && placeN.includes(nameN)) add(30, "query contains name");

  if (context.regionHints.some((r) => addr.includes(r))) add(40, "region in address");
  if (categoryMatchesIntent(category, intent.type)) add(40, "category matches intent");

  if (intent.type === "station") {
    if (STATION_CATEGORY.test(category)) add(80, "station category");
    if (placeBaseName(name) === placeN) add(120, "station base == query");
    else if (name === placeText.trim() || nameN === norm(`${placeText}역`)) add(120, "exact station name");
    if (nameN.includes("역")) add(20, "name has 역");
    if (STATION_BAD_CATEGORY.test(category)) add(-120, "non-station category");
    if (STATION_BAD_NAME.test(name)) add(-100, "non-station name");
  }

  if (intent.type === "terminal" && /(터미널|버스터미널|종합버스터미널)/.test(name + category)) add(80, "terminal");
  if (intent.type === "airport" && /공항/.test(name + category)) add(80, "airport");
  if (intent.type === "hospital" && /(병원|의료원)/.test(name + category)) add(60, "hospital");
  if (intent.type === "school" && /(대학교|학교|캠퍼스)/.test(name + category)) add(60, "school");
  if (intent.type === "market" && /시장/.test(name + category)) add(60, "market");

  const related = (placeN && nameN.includes(placeN)) || (nameN && placeN.includes(nameN));
  if (!related) add(-100, "low relevance");

  return { score, reason: reasons.join(", ") };
}

// ── 내부 헬퍼 ─────────────────────────────────────────────────────────────────
function isStationCategory(c: PlaceCandidate): boolean {
  return STATION_CATEGORY.test(c.category ?? "");
}

function hasCoords(c: PlaceCandidate): boolean {
  return c.latitude != null && c.longitude != null;
}

function dedup(cands: PlaceCandidate[]): PlaceCandidate[] {
  const seen = new Set<string>();
  const out: PlaceCandidate[] = [];
  for (const c of cands) {
    const key = c.place_url ? `url:${c.place_url}` : `nm:${norm(c.name)}|${norm(c.address)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function placeBaseName(name: string): string {
  const n = (name ?? "").trim();
  const m = n.match(/^(.*?역)(?:\s|$|[0-9])/);
  if (m && m[1]) return norm(m[1]);
  const firstTok = n.split(/\s+/)[0] ?? n;
  return norm(firstTok);
}

const SAME_PLACE_DELTA = 0.004;

function nearbyCoords(a: PlaceCandidate, b: PlaceCandidate): boolean {
  if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) return false;
  return (
    Math.abs(a.latitude - b.latitude) < SAME_PLACE_DELTA &&
    Math.abs(a.longitude - b.longitude) < SAME_PLACE_DELTA
  );
}

function collapseSamePlace(cands: ScoredCandidate[]): ScoredCandidate[] {
  const kept: ScoredCandidate[] = [];
  for (const c of cands) {
    const base = placeBaseName(c.name);
    const dup = kept.some((k) => placeBaseName(k.name) === base && nearbyCoords(k, c));
    if (!dup) kept.push(c);
  }
  return kept;
}

// ── 대표 장소 / 세부 장소 자동 선택 ─────────────────────────────────────────

// 대학교·캠퍼스 대표 카테고리
const REPRESENTATIVE_UNIVERSITY_RE = /(대학교|캠퍼스)/;
const REPRESENTATIVE_SCHOOL_RE = /학교(?!부속)/;
// 공원 대표 카테고리
const REPRESENTATIVE_PARK_RE = /공원/;

// 세부 시설 카테고리 / 이름 패턴
const SUB_FACILITY_CATEGORY_RE = /(학교부속시설|부속시설)/;
const SUB_FACILITY_NAME_RE = /(과학관|도서관|학당|연구소|기숙사|병원|식당|카페|주차장|정문|후문|기념관|박물관|체육관|강당|행정관|생활관|산학관|공학관|인문관|사회관|법학관|의학관|약학관|예술관|어학원|어학당|국제관|세브란스|사범대|문과대|이과대|경영대|법과대|공과대|의과대|약과대|치과대)/;

// 교차로·입구 suffix
const INTERSECTION_SUFFIX_RE = /(교차로|사거리|삼거리|입구|앞(?:길|거리)?)$/;

function isUniversityRepresentative(c: ScoredCandidate): boolean {
  const cat = c.category ?? "";
  return REPRESENTATIVE_UNIVERSITY_RE.test(cat) || REPRESENTATIVE_SCHOOL_RE.test(cat);
}

function isParkRepresentative(c: ScoredCandidate): boolean {
  const cat = c.category ?? "";
  return REPRESENTATIVE_PARK_RE.test(cat) && !INTERSECTION_SUFFIX_RE.test(c.name ?? "");
}

function isSubFacilityOf(c: ScoredCandidate, parentName: string): boolean {
  const parentN = norm(parentName);
  const cN = norm(c.name ?? "");
  if (!cN.startsWith(parentN) || cN === parentN) return false;
  const suffix = cN.slice(parentN.length);
  const cat = c.category ?? "";
  return SUB_FACILITY_CATEGORY_RE.test(cat) || SUB_FACILITY_NAME_RE.test(suffix) || suffix.length > 0;
}

function isIntersectionVariant(c: ScoredCandidate): boolean {
  return INTERSECTION_SUFFIX_RE.test(c.name ?? "");
}

function isIntersectionVariantOfBase(c: ScoredCandidate, baseName: string): boolean {
  const baseN = norm(baseName);
  const cN = norm(c.name ?? "");
  return cN.startsWith(baseN) && cN.length > baseN.length && INTERSECTION_SUFFIX_RE.test(c.name ?? "");
}

// 사용자가 이미 세부 장소 / 교차로를 직접 입력한 경우 자동 선택 불가
function userSpecifiedSubFacility(placeText: string): boolean {
  return SUB_FACILITY_NAME_RE.test(placeText);
}

function userSpecifiedIntersection(placeText: string): boolean {
  return INTERSECTION_SUFFIX_RE.test(placeText);
}

/**
 * 후보 목록에서 대표 장소를 자동 선택합니다.
 * Case 1: 대학교/캠퍼스 대표 + 나머지 내부 시설
 * Case 2: 공원 대표 + 나머지 교차로/입구 변형
 * Case 3: 모두 교차로/입구 변형만 → 1순위 선택
 */
function tryAutoSelectRepresentative(
  candidates: ScoredCandidate[],
  placeText: string,
): { selected: ScoredCandidate; notes: string[] } | null {
  if (candidates.length < 2) return null;
  if (userSpecifiedSubFacility(placeText)) return null;
  if (userSpecifiedIntersection(placeText)) return null;

  // Case 1: 대학교/캠퍼스
  const universities = candidates.filter(isUniversityRepresentative);
  if (universities.length === 1) {
    const uni = universities[0]!;
    const others = candidates.filter((c) => c !== uni);
    if (others.length > 0 && others.every((c) => isSubFacilityOf(c, uni.name))) {
      return {
        selected: uni,
        notes: [
          `검색 결과 중 대표 장소(${uni.name})를 자동으로 선택했습니다.`,
          `나머지 후보는 내부 시설로 판단하여 제외했습니다.`,
        ],
      };
    }
  }

  // Case 2: 공원
  const parks = candidates.filter(isParkRepresentative);
  if (parks.length === 1) {
    const park = parks[0]!;
    const others = candidates.filter((c) => c !== park);
    if (others.length > 0 && others.every((c) => isIntersectionVariantOfBase(c, park.name))) {
      return {
        selected: park,
        notes: [`공원 대표 장소(${park.name})를 자동으로 선택했습니다.`],
      };
    }
  }

  // Case 3: 모두 교차로/입구 변형
  if (candidates.every(isIntersectionVariant)) {
    const best = candidates[0]!;
    return {
      selected: best,
      notes: [`"${placeText}"의 정확한 장소 대신 가장 가까운 후보(${best.name})를 선택했습니다.`],
    };
  }

  return null;
}

/** ambiguous 결과에 포함할 구조화된 후보 정보를 생성합니다 */
export function buildClarificationInfo(
  target: "origin" | "destination",
  originalQuery: string,
  candidates: ScoredCandidate[],
): ClarificationInfo {
  const label = target === "origin" ? "출발지" : "목적지";
  return {
    target,
    original_query: originalQuery,
    message: `${label} "${originalQuery}"의 검색 결과가 여러 개입니다. 어느 곳을 말씀하시나요?`,
    candidates: candidates.slice(0, 3).map((c, i) => ({
      candidate_id: String(i + 1),
      name: c.name,
      address: c.address ?? null,
      category: c.category ?? null,
      latitude: c.latitude,
      longitude: c.longitude,
      place_url: c.place_url ?? null,
    })),
    allow_select_buttons: true,
    allow_reject_all: true,
  };
}

export type ResolutionStatus = "resolved" | "ambiguous" | "not_found" | "unavailable";

export interface StrictResolution {
  status: ResolutionStatus;
  intent: PlaceIntent;
  selected: ScoredCandidate | null;
  candidates: ScoredCandidate[];
  region_hints: string[];
  clarification?: ClarificationInfo | null;
  provider_notes?: string[];
}

const AUTO_SELECT_MIN_SCORE = 120;
const AUTO_SELECT_MIN_GAP = 25;

/**
 * 출발지/목적지 텍스트를 카카오 Local API로 검색해 엄격하게 해석합니다.
 * 대표 장소 자동 선택 로직을 거친 뒤,
 * 자동 선택 게이트를 모두 통과해야만 resolved, 아니면 ambiguous(clarification 포함).
 */
export async function resolvePlaceStrict(
  placeText: string,
  target: "origin" | "destination" = "destination",
): Promise<StrictResolution> {
  const intent = inferPlaceIntent(placeText);
  const regionHints = extractRegionHints(placeText);

  if (!isKakaoAvailable()) {
    return { status: "unavailable", intent, selected: null, candidates: [], region_hints: regionHints };
  }

  const queries = buildSearchQueries(placeText, intent);
  const raw: PlaceCandidate[] = [];
  try {
    for (const q of queries) {
      const results = await searchPlace(q);
      raw.push(...results);
    }
  } catch (err) {
    if (err instanceof KakaoServiceError) {
      return { status: "unavailable", intent, selected: null, candidates: [], region_hints: regionHints };
    }
    throw err;
  }

  const deduped = dedup(raw);
  const scored: ScoredCandidate[] = deduped
    .map((c) => {
      const { score, reason } = scorePlaceCandidate(c, placeText, intent, { regionHints });
      return { ...c, score, score_reason: reason };
    })
    .sort((a, b) => b.score - a.score);

  const collapsed = collapseSamePlace(scored);
  const candidates = collapsed.slice(0, 5);

  if (candidates.length === 0) {
    return { status: "not_found", intent, selected: null, candidates: [], region_hints: regionHints };
  }

  // 대표 장소 자동 선택 시도 (대학교·공원·교차로 패턴)
  const autoResult = tryAutoSelectRepresentative(candidates, placeText);
  if (autoResult) {
    return {
      status: "resolved",
      intent,
      selected: autoResult.selected,
      candidates,
      region_hints: regionHints,
      provider_notes: autoResult.notes,
    };
  }

  const top = candidates[0]!;
  const second = candidates[1];

  const gateScore = top.score >= AUTO_SELECT_MIN_SCORE;
  const gateGap = !second || top.score - second.score >= AUTO_SELECT_MIN_GAP;
  const gateStation = intent.type !== "station" || isStationCategory(top);
  const gateCoords = hasCoords(top);

  if (gateScore && gateGap && gateStation && gateCoords) {
    return { status: "resolved", intent, selected: top, candidates, region_hints: regionHints };
  }

  const clarification = buildClarificationInfo(target, placeText, candidates);
  return { status: "ambiguous", intent, selected: null, candidates, region_hints: regionHints, clarification };
}

/**
 * rejected_candidates를 제외하고 재검색합니다 (사용자 "전부 아님" 선택 시).
 */
export async function resolvePlaceStrictWithExclusions(
  placeText: string,
  target: "origin" | "destination",
  excludedCandidates: Array<{ name: string; address: string | null; place_url: string | null }>,
): Promise<StrictResolution> {
  const excludedKeys = new Set(
    excludedCandidates.map((c) =>
      c.place_url ? `url:${c.place_url}` : `nm:${norm(c.name)}|${norm(c.address ?? "")}`,
    ),
  );

  const res = await resolvePlaceStrict(placeText, target);
  if (excludedKeys.size === 0) return res;

  const filteredCandidates = res.candidates.filter((c) => {
    const key = c.place_url ? `url:${c.place_url}` : `nm:${norm(c.name)}|${norm(c.address ?? "")}`;
    return !excludedKeys.has(key);
  });

  if (filteredCandidates.length === 0) {
    return { status: "not_found", intent: res.intent, selected: null, candidates: [], region_hints: res.region_hints };
  }

  const top = filteredCandidates[0]!;
  const second = filteredCandidates[1];

  const gateScore = top.score >= AUTO_SELECT_MIN_SCORE;
  const gateGap = !second || top.score - second.score >= AUTO_SELECT_MIN_GAP;
  const gateStation = res.intent.type !== "station" || isStationCategory(top);
  const gateCoords = hasCoords(top);

  if (gateScore && gateGap && gateStation && gateCoords) {
    return { status: "resolved", intent: res.intent, selected: top, candidates: filteredCandidates, region_hints: res.region_hints };
  }

  const clarification = buildClarificationInfo(target, placeText, filteredCandidates);
  return { status: "ambiguous", intent: res.intent, selected: null, candidates: filteredCandidates, region_hints: res.region_hints, clarification };
}

// ── 하위 호환 텍스트 포맷 ─────────────────────────────────────────────────────
export function formatCandidateLine(c: PlaceCandidate, i: number): string {
  const addr = c.address || c.road_address || "주소 정보 없음";
  const cat = c.category || "분류 없음";
  return `${i + 1}. ${c.name} - ${addr} (${cat})`;
}

export function buildAmbiguousQuestion(candidates: PlaceCandidate[]): string {
  const lines = candidates.slice(0, 3).map((c, i) => formatCandidateLine(c, i));
  return [
    "장소가 여러 개로 검색되었습니다.",
    "어느 곳을 말씀하시는 건가요?",
    "",
    ...lines,
    "",
    "정확한 장소명을 다시 입력해 주세요.",
    '예: "운정역에서 홍대입구역까지"',
    '예: "운정중앙역에서 홍대입구역까지"',
  ].join("\n");
}
