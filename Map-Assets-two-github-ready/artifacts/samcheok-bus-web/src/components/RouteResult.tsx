import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Info,
  MapPin,
  X,
} from "lucide-react";

interface RouteOption {
  mode: string;
  mode_label: string;
  kakao_map_route_url: string | null;
  kakao_map_app_url: string | null;
  route_link_available: boolean;
}

interface BusArrivalItem {
  routeNo: string;
  routeType: string;
  estimatedArrivalText: string;
  remainingStopsText: string;
}

interface BusStopRealtime {
  stop: { nodeId: string; nodeName: string; distanceMeters: number };
  arrivals: BusArrivalItem[];
}

interface BusRealtime {
  available: boolean;
  stops: BusStopRealtime[];
  natural_language_summary: string;
}

export interface ClarificationCandidate {
  candidate_id: string;
  name: string;
  address: string | null;
  category: string | null;
  latitude: number | null;
  longitude: number | null;
  place_url: string | null;
}

export interface ClarificationInfo {
  target: "origin" | "destination";
  original_query: string;
  message: string;
  candidates: ClarificationCandidate[];
  allow_select_buttons: boolean;
  allow_reject_all: boolean;
}

const MODE_ICON: Record<string, string> = {
  publictransit: "🚌",
  car: "🚗",
  bicycle: "🚲",
  foot: "🚶",
};

const MODE_TRANSIT_NOTE: Record<string, string> = {
  publictransit: "버스/지하철 노선과 예상 시간은 카카오맵 화면에서 확인해 주세요.",
  car: "자동차 경로와 예상 시간은 카카오맵 화면에서 확인해 주세요.",
  bicycle: "자전거 경로와 예상 시간은 카카오맵 화면에서 확인해 주세요.",
  foot: "도보 경로와 예상 시간은 카카오맵 화면에서 확인해 주세요.",
};

function BusRealtimeCard({ busRealtime }: { busRealtime: BusRealtime }) {
  if (!busRealtime.available) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-gray-600 mb-1">🚌 출발지 인근 실시간 버스 정보</p>
        <p className="text-sm text-gray-500">⚠️ {busRealtime.natural_language_summary}</p>
      </div>
    );
  }

  return (
    <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 space-y-3">
      <p className="text-sm font-semibold text-sky-800">🚌 출발지 인근 실시간 버스 도착 정보</p>
      {(busRealtime.stops ?? []).map((sr) => (
        <div key={sr.stop.nodeId} className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-sky-700">
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            <span className="text-xs font-semibold">
              {sr.stop.nodeName}
              <span className="font-normal text-sky-500 ml-1">(약 {sr.stop.distanceMeters}m)</span>
            </span>
          </div>
          <div className="ml-5 space-y-1">
            {sr.arrivals.slice(0, 3).map((arr, idx) => (
              <div key={`${arr.routeNo}-${idx}`} className="flex items-center justify-between text-xs">
                <span className="font-bold text-sky-900 bg-sky-100 px-1.5 py-0.5 rounded">
                  {arr.routeNo}번
                </span>
                <div className="flex items-center gap-2 text-right">
                  <span className="font-semibold text-sky-800">{arr.estimatedArrivalText}</span>
                  <span className="text-sky-400">{arr.remainingStopsText}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="text-xs text-sky-400 border-t border-sky-100 pt-2">
        국토교통부 TAGO API 기준 · 실제 도착 시간은 교통 상황에 따라 달라질 수 있습니다.
      </p>
    </div>
  );
}

interface RouteResultProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planResult: any;
  isPending: boolean;
  onSelectCandidate: (candidate: ClarificationCandidate) => void;
  onRejectAll: () => void;
}

export function RouteResult({
  open,
  onOpenChange,
  planResult,
  isPending,
  onSelectCandidate,
  onRejectAll,
}: RouteResultProps) {
  if (!planResult) return null;

  const availableOptions: RouteOption[] =
    planResult.route_options?.filter((o: RouteOption) => o.route_link_available) ?? [];
  const busRealtime: BusRealtime | null = planResult.bus_realtime ?? null;
  const hasTransit = planResult.selected_modes?.includes("publictransit");
  const clarificationInfo: ClarificationInfo | null = planResult.clarification ?? null;
  const providerNotes: string[] | undefined = planResult.provider_notes;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl max-h-[85vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>길찾기 결과</SheetTitle>
        </SheetHeader>

        <div className="mt-3 space-y-4">
          {/* 성공 */}
          {planResult.success && (
            <div className="space-y-4">
              <div className="flex items-center justify-center gap-3 text-lg font-semibold flex-wrap text-gray-800">
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-5 h-5 text-blue-500 shrink-0" />
                  <span>{planResult.origin_place?.name ?? planResult.origin ?? "-"}</span>
                </div>
                <span className="text-gray-400 text-xl">→</span>
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-5 h-5 text-red-500 shrink-0" />
                  <span>{planResult.destination_place?.name ?? planResult.destination ?? "-"}</span>
                </div>
              </div>

              {providerNotes && providerNotes.length > 0 && (
                <div className="flex items-start gap-2 bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-3">
                  <Info className="w-4 h-4 shrink-0 mt-0.5 text-indigo-400" />
                  <div className="space-y-0.5">
                    {providerNotes.map((note, i) => (
                      <p key={i} className="text-xs text-indigo-700">{note}</p>
                    ))}
                  </div>
                </div>
              )}

              {planResult.selected_modes && planResult.selected_modes.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap justify-center">
                  <span className="text-sm text-gray-500">이동수단:</span>
                  {planResult.selected_modes.map((m: string) => (
                    <span
                      key={m}
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-700"
                    >
                      {MODE_ICON[m] ?? "🗺️"}{" "}
                      {planResult.route_options?.find((o: RouteOption) => o.mode === m)?.mode_label ?? m}
                    </span>
                  ))}
                  {planResult.default_mode_used && (
                    <span className="text-xs text-gray-400">(이동수단 미지정 — 기본값)</span>
                  )}
                </div>
              )}

              {hasTransit && busRealtime && <BusRealtimeCard busRealtime={busRealtime} />}

              {availableOptions.length > 0 && (
                <div className="space-y-3">
                  {availableOptions.map((opt) => (
                    <div key={opt.mode} className="space-y-1">
                      <a
                        href={opt.kakao_map_route_url!}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid={`button-kakao-map-${opt.mode}`}
                      >
                        <Button size="lg" className="w-full text-base py-6 font-bold">
                          <ExternalLink className="mr-2 w-5 h-5" />
                          {MODE_ICON[opt.mode] ?? "🗺️"} {opt.mode_label} 길찾기 열기
                        </Button>
                      </a>
                      {MODE_TRANSIT_NOTE[opt.mode] && (
                        <p className="text-xs text-gray-400 text-center px-2">
                          {MODE_TRANSIT_NOTE[opt.mode]}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-green-600" />
                <div className="space-y-1">
                  <p className="font-medium">지도 실제 장소 데이터 · 길찾기 링크 생성 완료</p>
                  {busRealtime?.available && (
                    <p className="text-green-700">실시간 버스 정보는 국토교통부 TAGO API 기준입니다.</p>
                  )}
                  <p className="text-green-700">실제 소요시간과 상세 경로는 카카오맵 화면에서 확인해 주세요.</p>
                  <p className="text-green-700">이 서비스는 임의로 경로 정보를 만들어내지 않습니다.</p>
                </div>
              </div>

              {planResult.message_for_kakao && (
                <div className="bg-[#FAE100]/10 border border-[#FAE100]/40 rounded-xl p-5">
                  <p className="text-xs font-semibold text-yellow-700 mb-2">📱 카카오톡 미리보기</p>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap text-gray-800">
                    {planResult.message_for_kakao}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 후보 선택 */}
          {planResult.needs_clarification &&
            clarificationInfo &&
            clarificationInfo.candidates.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-blue-900">추가 정보가 필요합니다</p>
                    <p className="text-blue-800 text-sm mt-0.5">{clarificationInfo.message}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {clarificationInfo.candidates.map((c, i) => (
                    <button
                      key={c.candidate_id}
                      type="button"
                      disabled={isPending}
                      onClick={() => onSelectCandidate(c)}
                      data-testid={`button-candidate-${i}`}
                      className="w-full text-left bg-white border border-blue-200 rounded-xl p-4 hover:bg-blue-50 hover:border-blue-400 active:bg-blue-100 transition-colors disabled:opacity-50"
                    >
                      <div className="flex items-start gap-3">
                        <span className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-gray-900 leading-tight">{c.name}</p>
                          {c.address && (
                            <p className="text-xs text-gray-500 mt-0.5 truncate">{c.address}</p>
                          )}
                          {c.category && (
                            <p className="text-xs text-blue-500 mt-0.5 truncate">{c.category}</p>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                  {clarificationInfo.allow_reject_all && (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={onRejectAll}
                      data-testid="button-reject-all"
                      className="w-full text-left bg-gray-50 border border-gray-200 rounded-xl p-4 hover:bg-gray-100 active:bg-gray-200 transition-colors disabled:opacity-50"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-400 text-white flex items-center justify-center">
                          <X className="w-4 h-4" />
                        </span>
                        <p className="font-medium text-gray-600">전부 아님</p>
                      </div>
                    </button>
                  )}
                </div>
              </div>
            )}

          {/* 텍스트 안내 (후보 없음) */}
          {planResult.needs_clarification &&
            (!clarificationInfo || clarificationInfo.candidates.length === 0) &&
            planResult.clarification_question && (
              <Alert className="border-blue-200 bg-blue-50 text-blue-900">
                <AlertCircle className="h-5 w-5 text-blue-600" />
                <AlertTitle className="text-base font-bold ml-2">추가 정보가 필요합니다</AlertTitle>
                <AlertDescription className="text-sm mt-2 ml-2 whitespace-pre-wrap leading-relaxed">
                  {planResult.clarification_question}
                </AlertDescription>
              </Alert>
            )}

          {/* 실패 */}
          {!planResult.success && !planResult.needs_clarification && (
            <Alert className="border-orange-200 bg-orange-50 text-orange-900">
              <AlertCircle className="h-5 w-5 text-orange-600" />
              <AlertTitle className="text-base font-bold ml-2">안내를 드리기 어렵습니다</AlertTitle>
              <AlertDescription className="text-sm mt-2 ml-2 whitespace-pre-wrap leading-relaxed">
                {planResult.message_for_kakao}
              </AlertDescription>
            </Alert>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
