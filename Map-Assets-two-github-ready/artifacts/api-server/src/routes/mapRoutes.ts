import { Router, type IRouter } from "express";
import {
  findTransitPoints,
  getTransitPointArrivals,
  decodeTransitPointId,
} from "../services/transitPointProvider.js";
import { isKakaoAvailable } from "../services/kakaoMapProvider.js";
import {
  getBusArrivals,
  isTaGoAvailable,
  findNearbyBusStops,
} from "../services/tagoBusProvider.js";

const router: IRouter = Router();

const DEFAULT_RADIUS = 1000;
const MAX_RADIUS = 5000;
const NEARBY_DEFAULT_RADIUS = 150;
const NEARBY_MAX_RADIUS = 1000;

// ── GET /api/map/transit-points?lat&lng&radius ───────────────────────────────
router.get("/map/transit-points", async (req, res) => {
  const lat = Number(req.query["lat"]);
  const lng = Number(req.query["lng"]);
  const radiusRaw = Number(req.query["radius"]);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: "lat, lng 쿼리 파라미터가 필요합니다.", example: "/api/map/transit-points?lat=37.55&lng=126.97&radius=1000" });
    return;
  }
  if (!isKakaoAvailable()) {
    res.json({ kakao_active: false, count: 0, points: [], message: "KAKAO_REST_API_KEY가 설정되지 않았습니다." });
    return;
  }

  const radius = Number.isFinite(radiusRaw) ? Math.min(Math.max(radiusRaw, 100), MAX_RADIUS) : DEFAULT_RADIUS;
  const includeBusStopsRaw = String(req.query["includeBusStops"] ?? "").toLowerCase();
  const includeBusStops = includeBusStopsRaw === "true" || includeBusStopsRaw === "1";

  try {
    const points = await findTransitPoints(lat, lng, radius, includeBusStops);
    res.json({ kakao_active: true, center: { lat, lng }, radius, count: points.length, points });
  } catch (err) {
    req.log?.error({ err }, "transit-points error");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /api/realtime/nearby-bus-stops?lat&lng&radius ────────────────────────
// 지도 클릭 좌표 주변의 TAGO 버스정류장 후보를 조회합니다. 임의 생성 없음.
router.get("/realtime/nearby-bus-stops", async (req, res) => {
  const lat = Number(req.query["lat"]);
  const lng = Number(req.query["lng"]);
  const radiusRaw = Number(req.query["radius"]);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({
      error: "lat, lng 쿼리 파라미터가 필요합니다.",
      example: "/api/realtime/nearby-bus-stops?lat=35.18&lng=129.07&radius=150",
    });
    return;
  }
  if (!isTaGoAvailable()) {
    res.json({
      available: false,
      center: { lat, lng },
      radius: NEARBY_DEFAULT_RADIUS,
      count: 0,
      stops: [],
      message: "이 지역의 실시간 버스 정류장 정보는 제공되지 않습니다. (TAGO API 키 미설정)",
    });
    return;
  }

  const radius = Number.isFinite(radiusRaw)
    ? Math.min(Math.max(radiusRaw, 10), NEARBY_MAX_RADIUS)
    : NEARBY_DEFAULT_RADIUS;

  try {
    const found = await findNearbyBusStops(lat, lng, 10);
    const stops = found
      .filter((s) => !!s.city_code && (s.distance_meters ?? Infinity) <= radius)
      .map((s) => ({
        name: s.name,
        node_id: s.node_id,
        city_code: s.city_code!,
        latitude: s.latitude,
        longitude: s.longitude,
        distance_meters: s.distance_meters ?? 0,
      }));
    res.json({
      available: stops.length > 0,
      center: { lat, lng },
      radius,
      count: stops.length,
      stops,
      message:
        stops.length > 0
          ? "주변 버스정류장을 찾았습니다. 정류장을 선택하면 실시간 도착정보를 확인합니다."
          : "이 위치 주변에서 실시간 정보를 제공하는 버스정류장을 찾지 못했습니다. 카카오맵에서 확인해 주세요.",
    });
  } catch (err) {
    req.log?.error({ err }, "nearby-bus-stops error");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /api/map/transit-point/:id/arrivals ──────────────────────────────────
router.get("/map/transit-point/:id/arrivals", async (req, res) => {
  const id = req.params["id"];
  const point = decodeTransitPointId(id);
  if (!point) {
    res.status(400).json({ error: "유효하지 않은 transit point id 입니다." });
    return;
  }
  try {
    const result = await getTransitPointArrivals(point);
    res.json(result);
  } catch (err) {
    req.log?.error({ err }, "transit-point arrivals error");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /api/realtime/bus?cityCode&nodeId ────────────────────────────────────
router.get("/realtime/bus", async (req, res) => {
  const cityCode = (req.query["cityCode"] as string | undefined)?.trim();
  const nodeId = (req.query["nodeId"] as string | undefined)?.trim();

  if (!cityCode || !nodeId) {
    res.status(400).json({ error: "cityCode, nodeId 쿼리 파라미터가 필요합니다.", example: "/api/realtime/bus?cityCode=25&nodeId=DJB8001793" });
    return;
  }
  if (!isTaGoAvailable()) {
    res.json({ available: false, arrivals: [], message: "TAGO API 키가 설정되지 않았습니다." });
    return;
  }
  try {
    const arrivals = await getBusArrivals(cityCode, nodeId, 10);
    res.json({
      available: arrivals.length > 0,
      city_code: cityCode,
      node_id: nodeId,
      count: arrivals.length,
      arrivals,
      message: arrivals.length > 0
        ? "국토교통부 TAGO API 실시간 버스 도착정보입니다."
        : "현재 도착 예정인 버스가 없거나 실시간 정보가 제공되지 않습니다.",
    });
  } catch (err) {
    req.log?.error({ err }, "realtime bus error");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
