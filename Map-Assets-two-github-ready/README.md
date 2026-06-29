# 카카오맵 길찾기 지원 (Map Route Guide)

사용자가 카카오톡에서 출발지와 목적지를 입력하면 **전국 단위**로 카카오 지도 API에서 장소를 검색하고, 선택한 이동수단에 맞는 카카오맵 길찾기 링크를 생성합니다.
지원 이동수단: 대중교통, 자동차, 자전거, 도보.

이 서버는 카카오맵 화면을 대신 열 수 있는 링크를 생성합니다. 실제 최단 경로 계산, 예상 소요시간, 버스 번호, 실시간 도착 정보는 카카오맵 화면에서 확인합니다.

**엄격한 장소 해석(strict resolver):** 검색 결과가 모호하면 임의로 1순위를 고르지 않고, 사용자에게 다시 물어봅니다(clarification). 잘못된 자동 선택보다 되묻는 것을 우선합니다. 테스트(mock) 데이터 폴백은 없습니다 — 카카오 지도 검색만 사용합니다.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API 서버 실행 (내부 포트 8080)
- `pnpm run typecheck` — 전체 타입체크
- `pnpm --filter @workspace/api-spec run codegen` — OpenAPI → Zod / React Query 훅 재생성
- **필수 env: `KAKAO_REST_API_KEY`** — 없으면 장소 검색 불가(`service_unavailable`). mock 폴백 없음.
  - 키가 있어도 카카오 개발자 콘솔에서 해당 앱의 **카카오맵(지도/로컬) 제품이 활성화**되어 있어야 합니다. 비활성화 시 Local API가 403 `disabled OPEN_MAP_AND_LOCAL service`를 반환합니다.
- **프론트 env: `VITE_KAKAO_JAVASCRIPT_KEY`** — 웹 지도(Kakao Maps JS SDK) 동적 로드용. 클라이언트에 노출됨(JavaScript 키).
  - ⚠️ 카카오 콘솔 > 플랫폼 > Web 에 앱 도메인을 등록해야 지도가 표시됩니다(예: `https://<repl>.replit.dev`, `https://<app>.replit.app`).
  - 미등록 시 SDK가 401 `domain mismatched`를 반환하고, 앱은 지도 없이 검색만 동작(graceful fallback). 키 문제가 아님.
  - `/health` 응답의 `kakao_map_js_configured`로 키 설정 여부 확인.
- **자동차: 링크 전용** — 카카오 모빌리티 API 미사용. 예상 시간/거리는 카카오맵 화면에서 확인. `/health`의 `car_directions_enabled: false`.
- **선택 env: `SEOUL_SUBWAY_API_KEY`** — 수도권 지하철 실시간 도착정보용. 없으면 지하철 마커는 "실시간 정보 미제공" 안내만(임의 데이터 생성 안 함).
- **선택 env: TAGO API 키** — 국토교통부 TAGO 버스 실시간 도착정보 API 키 (API별 개별 키 지원).
  - `TAGO_ARRIVAL_SERVICE_KEY` — 버스도착정보 API (우선)
  - `TAGO_STOP_SERVICE_KEY` — 버스정류소정보 API (우선)
  - `TAGO_ROUTE_SERVICE_KEY` — 버스노선정보 API (우선)
  - `TAGO_SERVICE_KEY` — 공통 fallback (3개 API 모두 동일 키인 경우 이것만 설정해도 됨)
  - `PUBLIC_DATA_SERVICE_KEY` — 최후 fallback
  - 없으면 대중교통 링크만 제공 (`data_source: bus_realtime_unavailable`).
  - 공공데이터포털(data.go.kr) 신청 → 발급된 **일반 인증키(디코딩된 값)** 를 env에 저장.
  - `/health` 응답의 `tago_active`, `tago_keys`, `bus_realtime_ready`, `bus_route_ready`로 설정 여부 확인.
  - TAGO API 지원 지역: 부산·대구·인천·광주·대전·울산·세종 및 경기·충청·전라·경상·제주 주요 시군.
  - 미지원 지역: 서울(별도 TOPIS API), 강릉·삼척·속초 등 강원 일부.

## MCP 서버 엔드포인트

**PlayMCP 등록 정보:**
- MCP 이름 (서버 name): `routeGuide` ← kakao 단어 미포함 (PlayMCP 정책)
- 서비스 표시명: 카카오맵 길찾기 지원
- 등록 URL: `POST https://<your-domain>/api/mcp`
- 전송 프로토콜: StreamableHTTP (MCP 1.0 표준)

**등록된 도구 (tools):**
| 이름 | 설명 |
|------|------|
| `get_bus_plan` | 출발지·목적지 + 이동수단 → 전국 장소 해석 후 카카오맵 길찾기 링크 생성 |
| `make_elderly_message` | 결과 → 노인 친화형 메시지 변환 |
| `create_departure_reminder` | 결과 → 출발 리마인드 문구 생성 |

**로컬 테스트:**
```bash
# 이동수단 미지정 (대중교통+자동차 기본)
curl -X POST localhost:80/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_bus_plan","arguments":{"query":"서울역에서 강남역까지"}}}'

# 자전거 이동수단 명시
curl -X POST localhost:80/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_bus_plan","arguments":{"query":"자전거로 부산역에서 해운대역까지"}}}'
```

## REST API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/health` | 서비스 상태 (`kakao_active`, `kakao_map_js_configured`, `car_directions_enabled:false`, `tago_active`, `mcp`, `version`) |
| POST | `/api/bus-plan` | 길찾기 링크 조회 (선택: `current_location`, `selected_place`) |
| GET | `/api/map/transit-points?lat=&lng=&radius=` | 지도 중심 주변 교통 마커(버스정류장·지하철·기차역·터미널) |
| GET | `/api/map/transit-point/:id/arrivals` | 마커별 실시간 도착정보 (버스 TAGO / 지하철·기차·터미널은 unavailable+링크) |
| GET | `/api/realtime/bus?cityCode=&nodeId=` | TAGO 버스 도착정보 직접 조회 |
| POST | `/api/elderly-message` | 노인 친화형 메시지 변환 |
| POST | `/api/reminder` | 리마인드 메시지 생성 |
| GET | `/api/debug/kakao-search?query=...` | 지도 장소 검색 원본 결과 테스트 |
| GET | `/api/debug/bus-realtime?lat=...&lng=...` | 버스 실시간 도착정보 테스트 (좌표 직접 입력) |
| GET | `/api/debug/bus-realtime?place=...` | 버스 실시간 도착정보 테스트 (장소명으로 검색 후 조회) |
| GET | `/debug/parse-route?query=...` | 자연어 파싱 결과 (`parsed`) |
| GET | `/debug/resolve-place?place=...` | 단일 장소 해석 결과 (`intent`, `selected`, `candidates`) |
| GET | `/debug/mcp-tools` | MCP 도구 목록 + inputSchema |

## 이동수단 (mode) 파라미터

| mode 값 | 표시명 | 자연어 예시 |
|---------|--------|------------|
| `publictransit` | 대중교통 | "대중교통으로", "버스로", "지하철로" |
| `car` | 자동차 | "자동차로", "차로", "자가용으로" |
| `bicycle` | 자전거 | "자전거로" |
| `foot` | 도보 | "도보로", "걸어서" |

이동수단 미지정 시: `publictransit` + `car` 두 가지 링크 자동 생성 (`default_mode_used: true`)

## 처리 흐름 (3단계)

1. **파싱** (`parseRouteQuery`) — 이동수단 추출/제거 → 불필요 표현 제거 → `출발지에서 목적지까지` 패턴 추출 → 검증. 현재 위치 요청·동일 장소·1글자·명령어 등은 `parse_error`로 되묻기.
2. **장소 해석** (`resolvePlaceStrict`) — 출발/목적지를 카카오 Local API로 검색·점수화. 자동 선택 게이트(점수·격차·역 카테고리·좌표)를 모두 통과해야 `resolved`, 아니면 `ambiguous`/`not_found`.
3. **링크 생성** — 좌표로 카카오맵 길찾기 링크 생성 + 카카오톡 메시지 포맷.

## data_source 값 정의

| 값 | 의미 |
|----|------|
| `kakao_local_api_with_bus_realtime` | 대중교통 + TAGO 실시간 버스 정보 성공 |
| `kakao_local_api_with_route_link_only` | 대중교통 모드 + TAGO 키 미설정 (링크만 제공) |
| `bus_realtime_unavailable` | 대중교통 모드 + TAGO API 시도했으나 실패/지원 불가 |
| `kakao_local_api_with_route_link` | 자동차·자전거·도보 등 링크만 생성 (정상 확정) |
| `needs_clarification` | 파싱/해석이 모호하여 사용자에게 되물음 |
| `place_not_found` | 카카오 검색 결과 없음 |
| `service_unavailable` | `KAKAO_REST_API_KEY` 미설정 등으로 검색 불가 |
| `no_coordinate` | 장소는 찾았으나 좌표가 없어 링크 생성 불가 |

## 카카오맵 길찾기 링크

모바일 웹 URL: `https://m.map.kakao.com/scheme/route?sp={lat},{lng}&ep={lat},{lng}&by={mode}`
앱 URL Scheme: `kakaomap://route?sp={lat},{lng}&ep={lat},{lng}&by={mode}`

응답 JSON 주요 필드:
- `service_name`: `"카카오맵 길찾기 지원"`
- `success` / `needs_clarification` / `clarification_question`
- `selected_modes`: 선택된 이동수단 배열
- `default_mode_used`: 이동수단 미지정 여부
- `origin_place` / `destination_place`: 확정된 장소(PlaceCandidate)
- `route_options`: 이동수단별 링크 배열 (`mode`, `mode_label`, `kakao_map_route_url`, `kakao_map_app_url`, `route_link_available`)
- `kakao_map_route_url`: 대표(대중교통 우선) 링크 (하위 호환)
- `origin_candidates` / `destination_candidates`: 디버그용 점수순 후보
- `parsed`: 디버그용 파싱 결과(`ParsedRouteQuery`)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (포트 8080 → 프록시 `/api`)
- Frontend: React + Vite (samcheok-bus-web, `/`)
- MCP: @modelcontextprotocol/sdk, StreamableHTTP (stateless)
- MCP server name: `routeGuide` (PlayMCP 정책: kakao 단어 미포함)
- 검증: Zod (zod/v4)
- Build: esbuild (ESM bundle)
- 버스 실시간: 국토교통부 TAGO API (공공데이터포털) — `busRealtimeProvider.ts`

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI 계약
- `artifacts/api-server/src/tools/` — getBusPlan, makeElderlyMessage, createDepartureReminder
- `artifacts/api-server/src/services/`
  - `kakaoMapProvider.ts` — `searchPlace()` 전국 키워드 검색 + `createKakaoRouteLinks()` (mode별 링크)
  - `routeParser.ts` — `parseRouteQuery()` 자연어 파싱 + 이동수단 추출 + 검증
  - `placeResolver.ts` — `inferPlaceIntent`/`extractRegionHints`/`buildSearchQueries`/`scorePlaceCandidate`/`resolvePlaceStrict`/`buildAmbiguousQuestion`
  - `messageService.ts` — 카카오톡 메시지 포맷 (링크 전용)
- `artifacts/api-server/src/mcp/server.ts` — MCP 서버 (name: routeGuide)
- `artifacts/api-server/src/app.ts` — Express 앱 + 루트 디버그 엔드포인트
- `artifacts/samcheok-bus-web/src/pages/home.tsx` — 웹 UI

## Architecture decisions

- MCP 서버 name/식별자에 "kakao" 단어 미사용 (PlayMCP 정책)
- Contract-first: OpenAPI spec → codegen → Zod + React Query 훅
- mode/modes는 OpenAPI spec 외 필드 → req.body에서 직접 읽음
- 전국 단위 검색: 지역 중심 좌표/반경 제한 없음 (`searchPlace`는 query+size만)
- 엄격 해석: 게이트(점수≥임계·2순위와 격차·역 카테고리·좌표) 모두 통과해야 자동 확정. 아니면 되묻기
- "~역"으로 끝나면 station 의도 → 역 후보를 가산점으로 우선
- 이동수단 미지정 시 DEFAULT_MODES = ["publictransit", "car"]
- Kakao API x=longitude, y=latitude (내부: latitude=Number(y), longitude=Number(x))
- mock/테스트 노선·시간 계산 로직 전면 제거 (링크 생성기 역할에 집중)

## Gotchas

- 키가 있어도 카카오 콘솔에서 **카카오맵(지도/로컬) 제품 비활성화** 시 403 `disabled OPEN_MAP_AND_LOCAL service` → 콘솔에서 활성화 필요 (키 문제 아님)
- 이동수단 단어 제거 시 장소명 보호: `버스`/`지하철`은 단독 토큰일 때만 제거(예: "삼척터미널"의 글자 깨짐 방지)
- MCP tools에 plain `{ type: "string" }` 객체 사용 시 TS 오류 — 반드시 Zod 스키마 사용
- 코드 수정 후 반드시 `cd artifacts/api-server && node build.mjs` 재빌드 필요
- Express 5 wildcard: `"/{*path}"` (path-to-regexp v8)

## User preferences

_없음_
