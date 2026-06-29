import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { getBusPlan } from "../tools/getBusPlan.js";
import { makeElderlyMessage } from "../tools/makeElderlyMessage.js";
import { createDepartureReminder } from "../tools/createDepartureReminder.js";
import { logger } from "../lib/logger.js";

// ── Shared Zod input schemas ──────────────────────────────────────────────────

const TransportModeZod = z.enum(["publictransit", "car", "bicycle", "foot"]);

const BusPlanInputShape = {
  query: z.string().optional().describe(
    '자연어 쿼리 (전국). e.g. "서울역에서 강남역까지" or "자동차로 부산역에서 해운대역까지"'
  ),
  origin: z.string().optional().describe("출발지 (Departure location)"),
  destination: z.string().optional().describe("목적지 (Destination location)"),
  mode: TransportModeZod.optional().describe(
    "이동수단 한 가지: publictransit(대중교통) | car(자동차) | bicycle(자전거) | foot(도보). 미지정 시 대중교통+자동차 두 개 링크 생성"
  ),
  modes: z.array(TransportModeZod).optional().describe(
    "이동수단 복수 선택 (mode 있으면 무시됨)"
  ),
  time: z.string().optional().describe("출발/도착 시간 (HH:MM 형식)"),
  time_type: z.enum(["departure", "arrival"]).optional().describe("time이 출발 시간인지 도착 시간인지"),
  user_type: z.enum(["general", "elderly"]).optional().describe("사용자 유형 — elderly: 노인 친화형 메시지 (기본: general)"),
};

const RouteOptionZod = z.object({
  mode: TransportModeZod,
  mode_label: z.string(),
  kakao_map_route_url: z.string().nullable(),
  kakao_map_app_url: z.string().nullable(),
  route_link_available: z.boolean(),
});

const CarDirectionsResultZod = z.object({
  available: z.boolean(),
  provider: z.literal("kakao_mobility_directions"),
  priority: z.enum(["TIME", "DISTANCE", "RECOMMEND"]),
  total_distance_meters: z.number().nullable(),
  total_distance_km: z.number().nullable(),
  total_duration_seconds: z.number().nullable(),
  total_duration_minutes: z.number().nullable(),
  estimated_time_text: z.string().nullable(),
  distance_text: z.string().nullable(),
  taxi_fare: z.number().nullable(),
  toll_fare: z.number().nullable(),
  main_roads: z.array(z.string()),
  natural_language_summary: z.string(),
  error: z.string().optional(),
});

const TaGoStopZod = z.object({
  name: z.string(),
  node_id: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  city_code: z.string().optional(),
  distance_meters: z.number().optional(),
});

const TaGoArrivalItemZod = z.object({
  route_id: z.string(),
  route_number: z.string(),
  arrival_time_minutes: z.number(),
  remaining_stops: z.number(),
  direction: z.string(),
  route_type: z.string().optional(),
});

const TagoKeyStatusZod = z.object({
  arrival_key_configured: z.boolean(),
  stop_key_configured: z.boolean(),
  route_key_configured: z.boolean(),
});

const BusRealtimeResultZod = z.object({
  available: z.boolean(),
  provider: z.literal("TAGO"),
  city_code: z.string().nullable(),
  keys: TagoKeyStatusZod,
  departure_stop: TaGoStopZod.nullable(),
  arrival_stop: TaGoStopZod.nullable(),
  arrivals: z.array(TaGoArrivalItemZod),
  checked_at: z.string(),
  message: z.string(),
  error: z.string().optional(),
});

const BusPlanResultZod = z.object({
  success: z.boolean(),
  needs_clarification: z.boolean(),
  clarification_question: z.string().nullable(),
  service_name: z.string().optional(),
  data_source: z.string(),
  provider: z.string(),
  is_mock_data: z.boolean(),
  bus_detail_available: z.boolean(),
  default_mode_used: z.boolean().optional(),
  selected_modes: z.array(TransportModeZod).optional(),
  origin: z.string().nullable(),
  destination: z.string().nullable(),
  origin_place: z.any().nullable(),
  destination_place: z.any().nullable(),
  route_options: z.array(RouteOptionZod).optional(),
  car_directions: CarDirectionsResultZod.nullable().optional(),
  bus_realtime: BusRealtimeResultZod.nullable().optional(),
  has_natural_route_summary: z.boolean().optional(),
  kakao_map_route_url: z.string().nullable().optional(),
  kakao_map_app_url: z.string().nullable().optional(),
  route_link_available: z.boolean().optional(),
  route_link_type: z.string().nullable().optional(),
  departure_stop: z.string().nullable(),
  arrival_stop: z.string().nullable(),
  bus_number: z.string().nullable(),
  direction: z.string().nullable(),
  scheduled_bus_departure_time: z.string().nullable(),
  recommended_departure_time: z.string().nullable(),
  estimated_arrival_time: z.string().nullable(),
  reminder_time: z.string().nullable(),
  walk_time_to_stop_minutes: z.number().nullable(),
  wait_time_minutes: z.number().nullable(),
  ride_time_minutes: z.number().nullable(),
  walk_time_to_destination_minutes: z.number().nullable(),
  transfer_count: z.number().int().nullable(),
  safety_buffer_minutes: z.number().nullable(),
  total_time_min: z.number().nullable(),
  total_time_max: z.number().nullable(),
  confidence: z.string().nullable(),
  message_for_kakao: z.string(),
  warning: z.string().nullable(),
});

const ElderlyMessageInputShape = {
  bus_plan: BusPlanResultZod.describe("get_bus_plan이 반환한 결과 객체"),
  elderly_name: z.string().optional().describe("노인 이름 (선택)"),
  reminder_minutes: z.number().optional().describe("출발 몇 분 전에 알림할지 (기본: 30)"),
};

const DepartureReminderInputShape = {
  bus_plan: BusPlanResultZod.describe("get_bus_plan이 반환한 결과 객체"),
  reminder_minutes: z.number().optional().describe("출발 몇 분 전에 알림할지 (기본: 30)"),
};

// ── JSON Schema for /debug/mcp-tools ─────────────────────────────────────────

const GET_BUS_PLAN_INPUT_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string", description: '자연어 쿼리 (전국). e.g. "서울역에서 강남역까지"' },
    origin: { type: "string", description: "출발지" },
    destination: { type: "string", description: "목적지" },
    mode: { type: "string", enum: ["publictransit", "car", "bicycle", "foot"], description: "이동수단 한 가지 (미지정 시 대중교통+자동차)" },
    modes: { type: "array", items: { type: "string", enum: ["publictransit", "car", "bicycle", "foot"] }, description: "이동수단 복수 선택" },
    time: { type: "string", description: "출발/도착 시간 (HH:MM)" },
    time_type: { type: "string", enum: ["departure", "arrival"] },
    user_type: { type: "string", enum: ["general", "elderly"] },
  },
};

export const MCP_TOOL_DEFINITIONS = [
  {
    name: "get_bus_plan",
    title: "지도 길찾기 링크 생성",
    description:
      "Creates route guidance for Map Route Guide(카카오맵 길찾기 지원). It resolves places using Kakao Local API, creates Kakao Map route links, and when car directions are available, summarizes driving distance and estimated travel time.",
    inputSchema: GET_BUS_PLAN_INPUT_SCHEMA,
    annotations: {
      title: "지도 길찾기 링크 생성",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "make_elderly_message",
    title: "노인 친화형 메시지 변환",
    description:
      "Converts a route link result into an elderly-friendly message for Map Route Guide(카카오맵 길찾기 지원).",
    inputSchema: {
      type: "object",
      required: ["bus_plan"],
      properties: {
        bus_plan: { type: "object", description: "get_bus_plan 반환 결과" },
        elderly_name: { type: "string" },
        reminder_minutes: { type: "number" },
      },
    },
    annotations: { title: "노인 친화형 메시지 변환", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "create_departure_reminder",
    title: "출발 리마인드 메시지 생성",
    description:
      "Creates a reminder message for Map Route Guide(카카오맵 길찾기 지원). It does not send the message.",
    inputSchema: {
      type: "object",
      required: ["bus_plan"],
      properties: {
        bus_plan: { type: "object", description: "get_bus_plan 반환 결과" },
        reminder_minutes: { type: "number" },
      },
    },
    annotations: { title: "출발 리마인드 메시지 생성", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

// ── MCP Server factory ─────────────────────────────────────────────────────
// 주의: MCP 서버 name/식별자에 "kakao" 단어 사용 금지 (PlayMCP 정책)

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "routeGuide",
    version: "1.0.0",
  });

  server.registerTool(
    "get_bus_plan",
    {
      title: "지도 길찾기 링크 생성",
      description:
        "Creates route guidance for Map Route Guide(카카오맵 길찾기 지원). Resolves places using Kakao Local API, creates Kakao Map route links (car is link-only — open Kakao Map for time/distance), and provides real-time bus arrival info (TAGO API) for public transit.",
      inputSchema: BusPlanInputShape,
      annotations: {
        title: "지도 길찾기 링크 생성",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const result = await getBusPlan(args);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        logger.error({ err }, "MCP get_bus_plan error");
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "make_elderly_message",
    {
      title: "노인 친화형 메시지 변환",
      description:
        "Converts a route link result into an elderly-friendly message for Map Route Guide(카카오맵 길찾기 지원).",
      inputSchema: ElderlyMessageInputShape,
      annotations: {
        title: "노인 친화형 메시지 변환",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args) => {
      try {
        const result = makeElderlyMessage(args as Parameters<typeof makeElderlyMessage>[0]);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        logger.error({ err }, "MCP make_elderly_message error");
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "create_departure_reminder",
    {
      title: "출발 리마인드 메시지 생성",
      description:
        "Creates a reminder message for Map Route Guide(카카오맵 길찾기 지원). It does not send the message.",
      inputSchema: DepartureReminderInputShape,
      annotations: {
        title: "출발 리마인드 메시지 생성",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args) => {
      try {
        const result = createDepartureReminder(args as Parameters<typeof createDepartureReminder>[0]);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        logger.error({ err }, "MCP create_departure_reminder error");
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }],
          isError: true,
        };
      }
    }
  );

  return server;
}

// ── Stateless MCP HTTP handler ────────────────────────────────────────────────

export async function mcpHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (req.method === "POST") {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });
      const mcpServer = createMcpServer();
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }
    if (req.method === "GET" || req.method === "DELETE") {
      res.status(405).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Stateless MCP server: only POST is supported" },
        id: null,
      });
      return;
    }
    next();
  } catch (err) {
    logger.error({ err }, "MCP handler error");
    if (!res.headersSent) res.status(500).json({ error: "MCP server error" });
  }
}
