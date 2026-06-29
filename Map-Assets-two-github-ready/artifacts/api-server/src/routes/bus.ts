import { Router, type IRouter } from "express";
import { getBusPlan } from "../tools/getBusPlan.js";
import { makeElderlyMessage } from "../tools/makeElderlyMessage.js";
import { createDepartureReminder } from "../tools/createDepartureReminder.js";
import { searchPlace, isKakaoAvailable } from "../services/kakaoMapProvider.js";
import { getTaGoBusRealtime, isTaGoAvailable } from "../services/tagoBusProvider.js";
import type { TransportMode } from "../types/index.js";
import {
  GetBusPlanBody,
  MakeElderlyMessageBody,
  CreateDepartureReminderBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

const VALID_MODES = new Set<string>(["publictransit", "car", "bicycle", "foot"]);

function safeMode(v: unknown): TransportMode | undefined {
  if (typeof v === "string" && VALID_MODES.has(v)) return v as TransportMode;
  return undefined;
}

function safeModes(v: unknown): TransportMode[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const filtered = v.filter((m) => typeof m === "string" && VALID_MODES.has(m)) as TransportMode[];
  return filtered.length > 0 ? filtered : undefined;
}

function safeCurrentLocation(v: unknown): { latitude: number; longitude: number } | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const lat = Number(o["latitude"]);
  const lng = Number(o["longitude"]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  return { latitude: lat, longitude: lng };
}

function safeSelectedPlace(v: unknown):
  | { name: string; address: string | null; category: string | null; latitude: number | null; longitude: number | null; place_url: string | null }
  | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o["name"] !== "string" || !o["name"].trim()) return undefined;
  const num = (x: unknown): number | null => {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  };
  const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x : null);
  return {
    name: o["name"],
    address: str(o["address"]),
    category: str(o["category"]),
    latitude: num(o["latitude"]),
    longitude: num(o["longitude"]),
    place_url: str(o["place_url"]),
  };
}

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "map-route-guide",
    mcp: true,
    kakao_active: isKakaoAvailable(),
    kakao_map_js_configured: !!process.env["VITE_KAKAO_JAVASCRIPT_KEY"],
    car_directions_enabled: false,
    tago_active: isTaGoAvailable(),
    version: "1.4.0",
  });
});

router.post("/bus-plan", async (req, res) => {
  try {
    const input = GetBusPlanBody.parse(req.body);
    const mode = safeMode(req.body?.mode);
    const modes = safeModes(req.body?.modes);
    // mode/modes/current_location/선택 장소는 OpenAPI spec 외 필드 → req.body에서 직접 읽음
    const currentLocation = safeCurrentLocation(req.body?.current_location);
    const originSelected = safeSelectedPlace(req.body?.origin_selected_place);
    const destinationSelected = safeSelectedPlace(req.body?.destination_selected_place);
    const result = await getBusPlan({
      ...input,
      mode,
      modes,
      current_location: currentLocation,
      origin_selected_place: originSelected,
      destination_selected_place: destinationSelected,
    });
    res.json(result);
  } catch (err) {
    req.log?.error({ err }, "bus-plan error");
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/elderly-message", async (req, res) => {
  try {
    const input = MakeElderlyMessageBody.parse(req.body);
    const result = makeElderlyMessage(input as Parameters<typeof makeElderlyMessage>[0]);
    res.json(result);
  } catch (err) {
    req.log?.error({ err }, "elderly-message error");
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/reminder", async (req, res) => {
  try {
    const input = CreateDepartureReminderBody.parse(req.body);
    const result = createDepartureReminder(input as Parameters<typeof createDepartureReminder>[0]);
    res.json(result);
  } catch (err) {
    req.log?.error({ err }, "reminder error");
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Debug: Kakao Local API 장소 검색 테스트 ────────────────────────────────
router.get("/debug/kakao-search", async (req, res) => {
  const query = req.query["query"] as string | undefined;
  if (!query) {
    res.status(400).json({ error: "query parameter is required. e.g. ?query=삼척터미널" });
    return;
  }
  if (!isKakaoAvailable()) {
    res.json({
      kakao_active: false,
      message: "KAKAO_REST_API_KEY is not set. Kakao Local API is unavailable.",
      results: [],
    });
    return;
  }
  try {
    const results = await searchPlace(query);
    res.json({ kakao_active: true, query, count: results.length, results });
  } catch (err) {
    req.log?.error({ err }, "debug kakao-search error");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Debug: TAGO 버스 실시간 정보 테스트 ──────────────────────────────────
router.get("/debug/bus-realtime", async (req, res) => {
  const latStr = req.query["lat"] as string | undefined;
  const lngStr = req.query["lng"] as string | undefined;
  const placeQuery = req.query["place"] as string | undefined;

  if (!isTaGoAvailable()) {
    res.json({ active: false, message: "TAGO_SERVICE_KEY / PUBLIC_DATA_SERVICE_KEY is not configured" });
    return;
  }

  if (latStr && lngStr) {
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (isNaN(lat) || isNaN(lng)) {
      res.status(400).json({ error: "lat and lng must be valid numbers" });
      return;
    }
    try {
      const result = await getTaGoBusRealtime(
        { name: `좌표(${lat},${lng})`, address: null, latitude: lat, longitude: lng, source: "debug", confidence: "high" },
        null,
      );
      res.json({ active: true, lat, lng, result });
    } catch (err) {
      req.log?.error({ err }, "debug bus-realtime error");
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (placeQuery?.trim() && isKakaoAvailable()) {
    try {
      const results = await searchPlace(placeQuery.trim(), 1);
      const place = results[0];
      if (!place) {
        res.status(404).json({ error: `장소 "${placeQuery}" 를 찾지 못했습니다.` });
        return;
      }
      const result = await getTaGoBusRealtime(place, null);
      res.json({
        active: true,
        place: { name: place.name, latitude: place.latitude, longitude: place.longitude },
        result,
      });
    } catch (err) {
      req.log?.error({ err }, "debug bus-realtime error");
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  res.status(400).json({
    error: "Provide either ?lat=...&lng=... or ?place=...(requires KAKAO_REST_API_KEY)",
    examples: [
      "/api/debug/bus-realtime?lat=37.7519&lng=128.8760",
      "/api/debug/bus-realtime?place=강릉역",
    ],
  });
});

export default router;
