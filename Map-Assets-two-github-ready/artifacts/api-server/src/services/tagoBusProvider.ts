/**
 * 국토교통부 TAGO 버스 공공데이터 provider
 *
 * 사용 API:
 *  - BusSttnInfoInqireService  (버스정류소정보)
 *  - ArvlInfoInqireService     (버스도착정보)
 *  - BusRouteInfoInqireService (버스노선정보)
 *
 * 주의:
 *  - serviceKey는 반드시 env에서 읽음. 코드에 직접 쓰지 않음.
 *  - 임의로 버스 번호·도착시간을 생성하지 않음.
 *  - API 오류 시 available=false로 안전하게 fallback.
 */
import type { PlaceCandidate, BusRealtimeResult, TaGoStop, TaGoArrivalItem } from "../types/index.js";
import { logger } from "../lib/logger.js";
import { getTagoKeys, getTagoKeyStatus } from "../config/tagoKeys.js";

const BASE_STTN = "https://apis.data.go.kr/1613000/BusSttnInfoInqireService";
const BASE_ARVL = "https://apis.data.go.kr/1613000/ArvlInfoInqireService";
const BASE_ROUTE = "https://apis.data.go.kr/1613000/BusRouteInfoInqireService";

// ── TAGO 실제 지원 도시코드 맵 (getCtyCodeList API 응답 기준, 2024) ───────────
// 주의: 서울(11)은 TAGO API 미지원 (별도 서울 TOPIS API 사용)
// 강릉(32010) 등 강원 일부는 TAGO 시스템에 등록되어 있으나 실시간 데이터 미제공 가능
const REGION_CODE_MAP: Record<string, string> = {
  // 광역시 + 세종
  세종: "12",
  부산: "21",
  대구: "22",
  인천: "23",
  광주: "24",
  대전: "25",
  울산: "26",
  // 경기
  수원: "31010",
  성남: "31020",
  의정부: "31030",
  안양: "31040",
  부천: "31050",
  광명: "31060",
  평택: "31070",
  동두천: "31080",
  안산: "31090",
  고양: "31100",
  과천: "31110",
  구리: "31120",
  남양주: "31130",
  오산: "31140",
  시흥: "31150",
  군포: "31160",
  의왕: "31170",
  하남: "31180",
  용인: "31190",
  파주: "31200",
  이천: "31210",
  안성: "31220",
  김포: "31230",
  화성: "31240",
  "광주(경기)": "31250",
  양주: "31260",
  포천: "31270",
  여주: "31320",
  연천: "31350",
  가평: "31370",
  양평: "31380",
  // 강원 (TAGO 지원 도시만)
  춘천: "32010",
  원주: "32020",
  태백: "32050",
  홍천: "32310",
  철원: "32360",
  양양: "32410",
  // 충북
  청주: "33010",
  충주: "33020",
  제천: "33030",
  보은: "33320",
  옥천: "33330",
  영동: "33340",
  진천: "33350",
  괴산: "33360",
  음성: "33370",
  단양: "33380",
  // 충남
  천안: "34010",
  공주: "34020",
  보령: "34030",
  아산: "34040",
  서산: "34050",
  논산: "34060",
  계룡: "34070",
  금산: "34310",
  부여: "34330",
  서천: "34340",
  청양: "34350",
  태안: "34380",
  당진: "34390",
  // 전북
  전주: "35010",
  군산: "35020",
  익산: "35030",
  정읍: "35040",
  남원: "35050",
  김제: "35060",
  진안: "35320",
  무주: "35330",
  장수: "35340",
  임실: "35350",
  순창: "35360",
  고창: "35370",
  부안: "35380",
  // 전남
  목포: "36010",
  여수: "36020",
  순천: "36030",
  나주: "36040",
  광양: "36060",
  곡성: "36320",
  구례: "36330",
  고흥: "36350",
  장흥: "36380",
  해남: "36400",
  영암: "36410",
  무안: "36420",
  함평: "36430",
  장성: "36450",
  완도: "36460",
  진도: "36470",
  신안: "36480",
  // 경북
  포항: "37010",
  경주: "37020",
  김천: "37030",
  안동: "37040",
  구미: "37050",
  영주: "37060",
  영천: "37070",
  상주: "37080",
  문경: "37090",
  경산: "37100",
  의성: "37320",
  청송: "37330",
  영양: "37340",
  영덕: "37350",
  청도: "37360",
  고령: "37370",
  성주: "37380",
  칠곡: "37390",
  예천: "37400",
  봉화: "37410",
  울진: "37420",
  울릉: "37430",
  // 경남
  창원: "38010",
  진주: "38030",
  통영: "38050",
  사천: "38060",
  김해: "38070",
  밀양: "38080",
  거제: "38090",
  양산: "38100",
  의령: "38310",
  함안: "38320",
  창녕: "38330",
  "고성(경남)": "38340",
  남해: "38350",
  하동: "38360",
  산청: "38370",
  함양: "38380",
  거창: "38390",
  합천: "38400",
  // 제주
  제주: "39",
};

// TAGO API가 실시간 데이터를 제공하지 않는 주요 지역
// (서울은 별도 TOPIS API, 강릉·삼척·속초 등 강원 일부는 TAGO 미등록)
const UNSUPPORTED_REGIONS = new Set(["서울", "강릉", "삼척", "속초", "동해", "평창", "정선", "영월", "횡성", "인제", "화천", "양구"]);

// ── 내부 타입 ─────────────────────────────────────────────────────────────────

interface RawTaGoStop {
  citycode: number | string;
  gpslati: number | string;
  gpslong: number | string;
  nodeid: string;
  nodenm: string;
  nodeno?: number | string;
}

interface RawArrival {
  arrprevstationcnt: number | string;
  arrtime: number | string;
  nodeid: string;
  nodenm: string;
  routeid: string;
  routeno: string;
  routetp?: string;
  vehicletp?: string;
}

interface RawRouteInfo {
  routeid: string;
  routeno: string;
  routetp?: string;
  edndVehicleNm?: string;
  endNodeNm?: string;
  startVehicleNm?: string;
  strtNodeNm?: string;
}

interface TaGoBody<T> {
  items?: { item?: T | T[] | "" | null } | "" | null;
  totalCount?: number | string;
}

interface TaGoResponse<T> {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: TaGoBody<T>;
  };
}

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

export function isTaGoAvailable(): boolean {
  const status = getTagoKeyStatus();
  return status.arrival_key_configured || status.stop_key_configured || status.route_key_configured;
}

/** TAGO API는 결과 1개면 배열 대신 단일 객체를 반환 → 항상 배열로 정규화 */
function toArray<T>(val: T | T[] | "" | null | undefined): T[] {
  if (!val || val === "") return [];
  return Array.isArray(val) ? val : [val];
}

/** 두 점 사이 거리(m) — Haversine */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const d1 = ((lat2 - lat1) * Math.PI) / 180;
  const d2 = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(d1 / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(d2 / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** ISO timestamp → KST HH:MM */
function nowKst(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().replace("T", " ").substring(0, 16) + " KST";
}

/**
 * serviceKey는 encodeURIComponent로 안전하게 처리.
 * 나머지 파라미터는 URLSearchParams에 위임.
 */
function buildUrl(base: string, endpoint: string, key: string, params: Record<string, string>): string {
  const q = new URLSearchParams({ numOfRows: "10", pageNo: "1", _type: "json", ...params });
  return `${base}/${endpoint}?serviceKey=${encodeURIComponent(key)}&${q.toString()}`;
}

async function fetchJson<T>(url: string, label: string): Promise<TaGoResponse<T>> {
  const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
  if (!res.ok) throw new Error(`TAGO ${label} HTTP ${res.status}`);
  return res.json() as Promise<TaGoResponse<T>>;
}

// ── Public: 도시코드 조회 ─────────────────────────────────────────────────────

/**
 * 지역명(자연어)에서 TAGO 도시코드를 찾습니다.
 * fallback map 우선, 없으면 null.
 */
export function getCityCodeByRegion(regionText: string): string | null {
  // 완전 일치 먼저
  if (REGION_CODE_MAP[regionText]) return REGION_CODE_MAP[regionText];
  // 부분 일치 (예: "강릉시" → "강릉")
  for (const [key, code] of Object.entries(REGION_CODE_MAP)) {
    if (regionText.includes(key) || key.includes(regionText)) return code;
  }
  return null;
}

// ── Public: 정류장명 검색 ─────────────────────────────────────────────────────

/**
 * TAGO 버스정류소정보 API로 정류장명 검색 (getSttnNoList).
 * cityCode + nodeNm 필수.
 */
export async function searchBusStopsByName(
  cityCode: string,
  stopName: string,
): Promise<TaGoStop[]> {
  const { stopServiceKey } = getTagoKeys();
  if (!stopServiceKey) return [];
  const url = buildUrl(BASE_STTN, "getSttnNoList", stopServiceKey, { cityCode, nodeNm: stopName });
  try {
    const data = await fetchJson<RawTaGoStop>(url, "정류장명 검색");
    const body = data?.response?.body;
    if (!body?.totalCount || Number(body.totalCount) === 0) return [];
    const items = toArray<RawTaGoStop>((body.items as { item?: RawTaGoStop | RawTaGoStop[] })?.item);
    return items.map((s) => ({
      name: s.nodenm,
      node_id: s.nodeid,
      latitude: Number(s.gpslati),
      longitude: Number(s.gpslong),
      city_code: String(s.citycode ?? cityCode),
    }));
  } catch (err) {
    logger.warn({ err, cityCode, stopName }, "TAGO 정류장명 검색 오류");
    return [];
  }
}

// ── Public: 좌표 기반 근방 정류장 ─────────────────────────────────────────────

/**
 * getCrdntPrxmtSttnList — 좌표 기반 근방 정류장 조회.
 * 응답에 citycode가 포함되어 있어 arrivals 조회에 바로 사용 가능.
 */
export async function findNearbyBusStops(
  lat: number,
  lng: number,
  maxCount = 3,
): Promise<TaGoStop[]> {
  const { stopServiceKey } = getTagoKeys();
  if (!stopServiceKey) return [];
  const url = buildUrl(BASE_STTN, "getCrdntPrxmtSttnList", stopServiceKey, {
    numOfRows: String(Math.max(maxCount, 5)),
    gpsLati: String(lat),
    gpsLong: String(lng),
  });
  try {
    const data = await fetchJson<RawTaGoStop>(url, "근방 정류장 조회");
    const body = data?.response?.body;
    if (!body?.totalCount || Number(body.totalCount) === 0) return [];
    const items = toArray<RawTaGoStop>((body.items as { item?: RawTaGoStop | RawTaGoStop[] })?.item);
    return items.slice(0, maxCount).map((s) => ({
      name: s.nodenm,
      node_id: s.nodeid,
      latitude: Number(s.gpslati),
      longitude: Number(s.gpslong),
      city_code: String(s.citycode),
      distance_meters: Math.round(haversineM(lat, lng, Number(s.gpslati), Number(s.gpslong))),
    }));
  } catch (err) {
    logger.warn({ err, lat, lng }, "TAGO 근방 정류장 조회 오류");
    return [];
  }
}

// ── Public: 버스 도착정보 ─────────────────────────────────────────────────────

/**
 * getSttnAcctoArvlPrearngeInfoList — 정류장별 도착예정 정보.
 */
export async function getBusArrivals(
  cityCode: string,
  nodeId: string,
  maxCount = 10,
): Promise<TaGoArrivalItem[]> {
  const { arrivalServiceKey } = getTagoKeys();
  if (!arrivalServiceKey) return [];
  const url = buildUrl(BASE_ARVL, "getSttnAcctoArvlPrearngeInfoList", arrivalServiceKey, {
    numOfRows: String(maxCount),
    cityCode,
    nodeId,
  });
  try {
    const data = await fetchJson<RawArrival>(url, "도착정보 조회");
    const body = data?.response?.body;
    if (!body?.totalCount || Number(body.totalCount) === 0) return [];
    const items = toArray<RawArrival>((body.items as { item?: RawArrival | RawArrival[] })?.item);
    return items
      .filter((a) => a.routeno && Number(a.arrtime) >= 0)
      .map((a) => {
        const secs = Number(a.arrtime);
        const mins = secs < 60 ? 0 : Math.round(secs / 60);
        return {
          route_id: a.routeid,
          route_number: a.routeno,
          arrival_time_minutes: mins,
          remaining_stops: Number(a.arrprevstationcnt),
          direction: "",           // getRouteInfo로 채울 수 있음 (선택)
          route_type: a.routetp ?? "",
        };
      });
  } catch (err) {
    logger.warn({ err, cityCode, nodeId }, "TAGO 도착정보 조회 오류");
    return [];
  }
}

// ── Public: 노선정보 ──────────────────────────────────────────────────────────

/**
 * getRouteInfoIem — 특정 노선 상세 정보.
 * 방향(종점명)을 가져오는 데 사용.
 */
export async function getRouteInfo(
  cityCode: string,
  routeId: string,
): Promise<{ direction: string; routeType: string } | null> {
  const { routeServiceKey } = getTagoKeys();
  if (!routeServiceKey) return null;
  const url = buildUrl(BASE_ROUTE, "getRouteInfoIem", routeServiceKey, { cityCode, routeId });
  try {
    const data = await fetchJson<RawRouteInfo>(url, "노선정보 조회");
    const body = data?.response?.body;
    if (!body?.totalCount || Number(body.totalCount) === 0) return null;
    const items = toArray<RawRouteInfo>((body.items as { item?: RawRouteInfo | RawRouteInfo[] })?.item);
    const info = items[0];
    if (!info) return null;
    // 종점 차고지명 또는 종점 정류장명을 방향으로 사용
    const direction = info.edndVehicleNm ?? info.endNodeNm ?? "";
    return { direction, routeType: info.routetp ?? "" };
  } catch (err) {
    logger.warn({ err, cityCode, routeId }, "TAGO 노선정보 조회 오류");
    return null;
  }
}

// ── Public: 메인 오케스트레이터 ───────────────────────────────────────────────

/**
 * 출발지·목적지 PlaceCandidate를 받아 TAGO 실시간 버스 정보를 조회합니다.
 *
 * 처리 흐름:
 * 1. 출발지 좌표 → 근방 정류장 조회 (getCrdntPrxmtSttnList)
 * 2. 상위 정류장 → 도착예정 조회 (getSttnAcctoArvlPrearngeInfoList)
 * 3. 목적지 좌표 → 근방 정류장 조회 (arrival_stop 정보용, 선택)
 * 4. 상위 도착편 → 노선정보 조회로 방향 채우기 (getRouteInfoIem, 선택)
 *
 * API 오류 / 지역 미지원 → available=false, 임의 데이터 생성 안 함.
 */
export async function getTaGoBusRealtime(
  origin: PlaceCandidate,
  destination: PlaceCandidate | null,
): Promise<BusRealtimeResult> {
  const checkedAt = nowKst();

  const keyStatus = getTagoKeyStatus();
  if (!keyStatus.stop_key_configured && !keyStatus.arrival_key_configured) {
    return fail("실시간 버스 정보 API 키가 설정되지 않았습니다.", checkedAt, "missing_key");
  }

  const { latitude: oLat, longitude: oLng, name: oName } = origin;
  if (oLat == null || oLng == null) {
    return fail("출발지 좌표 정보가 없어 실시간 버스 정보를 확인하지 못했습니다.", checkedAt, "missing_origin_coords");
  }

  // 1. 출발지 근방 정류장
  const nearbyStops = await findNearbyBusStops(oLat, oLng, 3);
  if (nearbyStops.length === 0) {
    logger.info({ place: oName }, "TAGO: 출발지 근방 정류장 없음");
    return fail("해당 지역의 실시간 버스 정보를 확인하지 못했습니다. 인근 정류장을 찾지 못했습니다.", checkedAt);
  }

  // 2. 도착정보 조회 (상위 2개 정류장에 대해 병렬, city_code 없는 정류장 제외)
  const stopArrivalResults = await Promise.allSettled(
    nearbyStops.slice(0, 2).filter((s) => !!s.city_code).map((stop) =>
      getBusArrivals(stop.city_code!, stop.node_id, 8).then((arrivals) => ({ stop, arrivals })),
    ),
  );

  // 도착정보가 있는 첫 번째 정류장 선택
  let departureStop: TaGoStop | null = null;
  let arrivals: TaGoArrivalItem[] = [];

  for (const result of stopArrivalResults) {
    if (result.status === "fulfilled" && result.value.arrivals.length > 0) {
      departureStop = result.value.stop;
      arrivals = result.value.arrivals;
      break;
    }
  }

  if (!departureStop || arrivals.length === 0) {
    return fail(
      "해당 지역의 실시간 버스 도착 정보를 확인하지 못했습니다. 도착 예정 버스가 없거나 지원되지 않는 지역일 수 있습니다.",
      checkedAt,
    );
  }

  // 3. 목적지 근방 정류장 (arrival_stop — 선택)
  let arrivalStop: TaGoStop | null = null;
  if (destination?.latitude != null && destination.longitude != null) {
    const destStops = await findNearbyBusStops(destination.latitude, destination.longitude, 1).catch(() => []);
    arrivalStop = destStops[0] ?? null;
  }

  // 4. 상위 3개 도착편 노선정보로 방향 보강 (선택, 실패해도 계속)
  const topArrivals = arrivals.slice(0, 3);
  await Promise.allSettled(
    topArrivals.map(async (arr, i) => {
      const info = await getRouteInfo(departureStop!.city_code ?? "", arr.route_id).catch(() => null);
      if (info?.direction) topArrivals[i] = { ...arr, direction: info.direction };
    }),
  );
  // 나머지 arrivals는 그대로 (방향 없이)
  arrivals = [...topArrivals, ...arrivals.slice(3)];

  const cityCode = departureStop.city_code ?? null;
  const message = buildRealtimeMessage(departureStop, arrivals.slice(0, 5));

  return {
    available: true,
    provider: "TAGO",
    city_code: cityCode,
    keys: keyStatus,
    departure_stop: departureStop,
    arrival_stop: arrivalStop,
    arrivals: arrivals.slice(0, 10),
    checked_at: checkedAt,
    message,
  };
}

// ── 내부 헬퍼 ─────────────────────────────────────────────────────────────────

function fail(message: string, checkedAt: string, error?: string): BusRealtimeResult {
  return {
    available: false,
    provider: "TAGO",
    city_code: null,
    keys: getTagoKeyStatus(),
    departure_stop: null,
    arrival_stop: null,
    arrivals: [],
    checked_at: checkedAt,
    message,
    error,
  };
}

function buildRealtimeMessage(stop: TaGoStop, arrivals: (TaGoArrivalItem & { arrival_seconds?: number })[]): string {
  const lines: string[] = [`📍 가까운 출발 정류장: ${stop.name}`];
  if (stop.distance_meters != null) lines[0] += ` (약 ${stop.distance_meters}m)`;
  lines.push("", "현재 확인 가능한 버스:");
  arrivals.forEach((arr, i) => {
    const timeText = arr.arrival_time_minutes === 0 ? "곧 도착" : `약 ${arr.arrival_time_minutes}분 후 도착`;
    lines.push(`${i + 1}. ${arr.route_number}번 버스`);
    lines.push(`   ${timeText} · 남은 정류장: ${arr.remaining_stops}개`);
    if (arr.direction) lines.push(`   방향: ${arr.direction}`);
  });
  return lines.join("\n");
}
