import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import router from "./routes/index.js";
import { mcpHandler, MCP_TOOL_DEFINITIONS } from "./mcp/server.js";
import { isKakaoAvailable } from "./services/kakaoMapProvider.js";
import { isTaGoAvailable, searchBusStopsByName, findNearbyBusStops, getBusArrivals } from "./services/tagoBusProvider.js";
import { getTagoKeyStatus } from "./config/tagoKeys.js";
import { parseRouteQuery } from "./services/routeParser.js";
import { resolvePlaceStrict } from "./services/placeResolver.js";
import { logger } from "./lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDistPath = path.resolve(__dirname, "public");

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ── 1. Health check ──────────────────────────────────────────────────────────
// 주의: service 이름에 kakao 미포함 (PlayMCP 정책)
app.get("/health", (_req, res) => {
  const tagoKeys = getTagoKeyStatus();
  const tagoActive = tagoKeys.arrival_key_configured || tagoKeys.stop_key_configured || tagoKeys.route_key_configured;
  res.json({
    ok: true,
    service: "map-route-guide",
    mcp: true,
    kakao_active: isKakaoAvailable(),
    kakao_map_js_configured: !!process.env["VITE_KAKAO_JAVASCRIPT_KEY"],
    car_directions_enabled: false,
    tago_active: tagoActive,
    tago_keys: tagoKeys,
    bus_realtime_ready: tagoKeys.arrival_key_configured && tagoKeys.stop_key_configured,
    bus_route_ready: tagoKeys.route_key_configured,
    version: "1.4.0",
  });
});

app.get("/api/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

// ── 2. Debug endpoints ───────────────────────────────────────────────────────
app.get("/debug/mcp-tools", (_req, res) => {
  res.json({ count: MCP_TOOL_DEFINITIONS.length, endpoint: "/api/mcp", tools: MCP_TOOL_DEFINITIONS });
});

// 자연어 파싱 결과 확인
app.get("/debug/parse-route", (req, res) => {
  const query = (req.query["query"] as string | undefined) ?? "";
  if (!query.trim()) {
    res.status(400).json({ error: "query parameter is required. e.g. ?query=서울역에서 강남역까지" });
    return;
  }
  res.json({ parsed: parseRouteQuery(query) });
});

// ── TAGO 디버그 엔드포인트 ────────────────────────────────────────────────────

// TAGO 키 설정 여부 확인 (키 값 자체는 절대 출력하지 않음)
app.get("/debug/tago/status", (_req, res) => {
  const keys = getTagoKeyStatus();
  const tagoActive = keys.arrival_key_configured || keys.stop_key_configured || keys.route_key_configured;
  const busRealtimeReady = keys.arrival_key_configured && keys.stop_key_configured;
  res.json({
    tago_active: tagoActive,
    bus_realtime_ready: busRealtimeReady,
    bus_route_ready: keys.route_key_configured,
    keys,
  });
});

// 정류장명으로 검색 (cityCode + name 필수)
app.get("/debug/tago/stops", async (req, res) => {
  const cityCode = (req.query["cityCode"] as string | undefined) ?? "";
  const name = (req.query["name"] as string | undefined) ?? "";
  const latStr = req.query["lat"] as string | undefined;
  const lngStr = req.query["lng"] as string | undefined;

  if (!isTaGoAvailable()) {
    res.json({ active: false, message: "TAGO_SERVICE_KEY가 설정되지 않았습니다." });
    return;
  }

  if (latStr && lngStr) {
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (isNaN(lat) || isNaN(lng)) {
      res.status(400).json({ error: "lat, lng는 숫자여야 합니다." });
      return;
    }
    try {
      const stops = await findNearbyBusStops(lat, lng, 5);
      res.json({ active: true, lat, lng, count: stops.length, stops });
    } catch (err) {
      logger.error({ err }, "debug tago/stops (nearby) error");
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (!cityCode || !name) {
    res.status(400).json({
      error: "?cityCode=...&name=... 또는 ?lat=...&lng=... 파라미터가 필요합니다.",
      examples: [
        "/debug/tago/stops?cityCode=32010&name=강릉역",
        "/debug/tago/stops?lat=37.7519&lng=128.8760",
      ],
    });
    return;
  }

  try {
    const stops = await searchBusStopsByName(cityCode, name);
    res.json({ active: true, cityCode, name, count: stops.length, stops });
  } catch (err) {
    logger.error({ err }, "debug tago/stops error");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// 정류장 실시간 도착정보 (cityCode + nodeId 필수)
app.get("/debug/tago/arrivals", async (req, res) => {
  const cityCode = (req.query["cityCode"] as string | undefined) ?? "";
  const nodeId = (req.query["nodeId"] as string | undefined) ?? "";

  if (!isTaGoAvailable()) {
    res.json({ active: false, message: "TAGO_SERVICE_KEY가 설정되지 않았습니다." });
    return;
  }

  if (!cityCode || !nodeId) {
    res.status(400).json({
      error: "cityCode와 nodeId 파라미터가 필요합니다.",
      example: "/debug/tago/arrivals?cityCode=32010&nodeId=GGB000011",
    });
    return;
  }

  try {
    const arrivals = await getBusArrivals(cityCode, nodeId, 10);
    res.json({ active: true, cityCode, nodeId, count: arrivals.length, arrivals });
  } catch (err) {
    logger.error({ err }, "debug tago/arrivals error");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// 단일 장소 해석 결과 확인
app.get("/debug/resolve-place", async (req, res) => {
  const place = (req.query["place"] as string | undefined) ?? "";
  if (!place.trim()) {
    res.status(400).json({ error: "place parameter is required. e.g. ?place=서울역" });
    return;
  }
  try {
    const result = await resolvePlaceStrict(place);
    res.json({
      status: result.status,
      intent: result.intent,
      needs_clarification: result.status !== "resolved",
      selected: result.selected,
      region_hints: result.region_hints,
      candidates: result.candidates,
    });
  } catch (err) {
    logger.error({ err }, "debug resolve-place error");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});


// ── 3. MCP endpoints ─────────────────────────────────────────────────────────
app.use("/api/mcp", mcpHandler);
app.use("/mcp", mcpHandler);

// ── 4. REST API routes ───────────────────────────────────────────────────────
app.use("/api", router);

// ── 5. Frontend static files (production only) ───────────────────────────────
if (process.env["NODE_ENV"] === "production" && fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath, { maxAge: "1h" }));
  app.get("/{*path}", (_req, res) => {
    res.sendFile(path.join(frontendDistPath, "index.html"));
  });
} else if (process.env["NODE_ENV"] !== "production") {
  logger.info("Development mode: frontend served by Vite dev server");
}

export default app;
