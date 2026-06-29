import type { TransitArrivalsResult, TransitPoint } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { ExternalLink, MapPin, AlertCircle, Bus } from "lucide-react";

const TYPE_LABEL: Record<string, string> = {
  bus_stop: "버스정류장",
  subway: "지하철역",
  rail: "기차역",
  terminal: "터미널",
};

const TYPE_EMOJI: Record<string, string> = {
  bus_stop: "🚌",
  subway: "🚇",
  rail: "🚆",
  terminal: "🚍",
};

interface TransitBottomSheetProps {
  point: TransitPoint | null;
  arrivals: TransitArrivalsResult | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onSetOrigin: (point: TransitPoint) => void;
  onSetDestination: (point: TransitPoint) => void;
}

export function TransitBottomSheet({
  point,
  arrivals,
  loading,
  onOpenChange,
  onSetOrigin,
  onSetDestination,
}: TransitBottomSheetProps) {
  const open = point !== null;
  const typeLabel = point ? TYPE_LABEL[point.type] ?? "교통 지점" : "";
  const emoji = point ? TYPE_EMOJI[point.type] ?? "📍" : "";

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <SheetContent side="bottom" className="rounded-t-3xl max-h-[80vh] overflow-y-auto">
        {point && (
          <>
            <SheetHeader className="text-left">
              <SheetTitle className="flex items-center gap-2">
                <span>{emoji}</span>
                <span className="truncate">{point.name}</span>
              </SheetTitle>
            </SheetHeader>

            <div className="mt-1 space-y-4">
              <div className="space-y-1">
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
                  {typeLabel}
                </span>
                {point.address && (
                  <p className="flex items-center gap-1.5 text-sm text-gray-500">
                    <MapPin className="w-3.5 h-3.5 shrink-0" />
                    {point.address}
                  </p>
                )}
              </div>

              {/* 도착정보 영역 */}
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
                  <Spinner className="w-4 h-4" />
                  실시간 정보를 불러오는 중...
                </div>
              ) : arrivals ? (
                arrivals.available && arrivals.arrivals.length > 0 ? (
                  <div className="space-y-2">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-sky-800">
                      <Bus className="w-4 h-4" />
                      실시간 도착 정보
                    </p>
                    <div className="space-y-1.5">
                      {arrivals.arrivals.map((a, i) => (
                        <div
                          key={`${a.route_id}-${i}`}
                          className="flex items-center justify-between rounded-xl bg-sky-50 border border-sky-100 px-3 py-2"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-bold text-sky-900 bg-sky-100 px-2 py-0.5 rounded text-sm shrink-0">
                              {a.route_number}
                            </span>
                            {a.route_type && (
                              <span className="text-xs text-sky-500 truncate">{a.route_type}</span>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <span className="font-semibold text-sky-800 text-sm">
                              {a.arrival_time_minutes}분
                            </span>
                            <span className="text-xs text-sky-400 ml-2">
                              {a.remaining_stops}정거장
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-sky-400">
                      국토교통부 TAGO API 기준 · 실제 도착 시간은 달라질 수 있습니다.
                    </p>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-xl bg-gray-50 border border-gray-200 px-3 py-3">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-gray-400" />
                    <p className="text-sm text-gray-600">{arrivals.message}</p>
                  </div>
                )
              ) : (
                <div className="flex items-start gap-2 rounded-xl bg-gray-50 border border-gray-200 px-3 py-3">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-gray-400" />
                  <p className="text-sm text-gray-600">
                    도착 정보를 불러오지 못했습니다. 카카오맵에서 확인해 주세요.
                  </p>
                </div>
              )}

              {/* 액션 */}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={() => onSetOrigin(point)}
                  data-testid="button-set-origin"
                >
                  출발지로
                </Button>
                <Button
                  variant="outline"
                  onClick={() => onSetDestination(point)}
                  data-testid="button-set-destination"
                >
                  도착지로
                </Button>
              </div>

              {point.place_url && (
                <a
                  href={point.place_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="link-kakao-place"
                >
                  <Button variant="ghost" className="w-full text-sm">
                    <ExternalLink className="mr-1.5 w-4 h-4" />
                    카카오맵에서 보기
                  </Button>
                </a>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
