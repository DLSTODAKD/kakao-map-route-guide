import { useEffect, useState } from "react";
import type {
  NearbyBusStop,
  RealtimeBusResult,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import {
  ExternalLink,
  AlertCircle,
  Bus,
  MapPin,
  Flag,
  Search,
  ChevronLeft,
} from "lucide-react";
import { fetchNearbyBusStops, fetchRealtimeBus } from "@/services/mapApiClient";

export interface ClickedLocation {
  lat: number;
  lng: number;
}

type View = "actions" | "stops" | "arrivals";

interface LocationActionSheetProps {
  location: ClickedLocation | null;
  onOpenChange: (open: boolean) => void;
  onSetOrigin: (location: ClickedLocation) => void;
  onSetDestination: (location: ClickedLocation) => void;
}

function kakaoMapLink(lat: number, lng: number): string {
  return `https://map.kakao.com/link/map/${lat},${lng}`;
}

export function LocationActionSheet({
  location,
  onOpenChange,
  onSetOrigin,
  onSetDestination,
}: LocationActionSheetProps) {
  const open = location !== null;

  const [view, setView] = useState<View>("actions");
  const [stops, setStops] = useState<NearbyBusStop[]>([]);
  const [stopsLoading, setStopsLoading] = useState(false);
  const [stopsMessage, setStopsMessage] = useState<string | null>(null);

  const [selectedStop, setSelectedStop] = useState<NearbyBusStop | null>(null);
  const [arrivals, setArrivals] = useState<RealtimeBusResult | null>(null);
  const [arrivalsLoading, setArrivalsLoading] = useState(false);

  // 새 위치를 열 때마다 내부 상태 초기화.
  useEffect(() => {
    if (location) {
      setView("actions");
      setStops([]);
      setStopsMessage(null);
      setSelectedStop(null);
      setArrivals(null);
    }
  }, [location]);

  const handleFindStops = async () => {
    if (!location) return;
    setView("stops");
    setStopsLoading(true);
    setStopsMessage(null);
    try {
      const res = await fetchNearbyBusStops(location.lat, location.lng, 150);
      setStops(res.stops ?? []);
      setStopsMessage(res.message ?? null);
    } catch {
      setStops([]);
      setStopsMessage("주변 버스정류장을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setStopsLoading(false);
    }
  };

  const handleSelectStop = async (stop: NearbyBusStop) => {
    setSelectedStop(stop);
    setView("arrivals");
    setArrivalsLoading(true);
    setArrivals(null);
    try {
      const res = await fetchRealtimeBus(stop.city_code, stop.node_id);
      setArrivals(res);
    } catch {
      setArrivals(null);
    } finally {
      setArrivalsLoading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <SheetContent side="bottom" className="rounded-t-3xl max-h-[80vh] overflow-y-auto">
        {location && (
          <>
            <SheetHeader className="text-left">
              <SheetTitle className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-blue-600" />
                선택한 지점
              </SheetTitle>
              <SheetDescription>
                {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-3">
              {/* ── 액션 목록 ──────────────────────────────────────────── */}
              {view === "actions" && (
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => onSetOrigin(location)}
                    data-testid="button-loc-set-origin"
                  >
                    <MapPin className="mr-2 w-4 h-4 text-blue-600" />
                    여기를 출발지로
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => onSetDestination(location)}
                    data-testid="button-loc-set-destination"
                  >
                    <Flag className="mr-2 w-4 h-4 text-red-600" />
                    여기를 도착지로
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={handleFindStops}
                    data-testid="button-loc-find-stops"
                  >
                    <Search className="mr-2 w-4 h-4 text-emerald-600" />
                    주변 버스정류장 찾기
                  </Button>
                  <a
                    href={kakaoMapLink(location.lat, location.lng)}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="link-loc-kakao-map"
                  >
                    <Button variant="ghost" className="w-full justify-start text-sm">
                      <ExternalLink className="mr-2 w-4 h-4" />
                      카카오맵에서 보기
                    </Button>
                  </a>
                </div>
              )}

              {/* ── 주변 정류장 목록 ───────────────────────────────────── */}
              {view === "stops" && (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setView("actions")}
                    className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700"
                    data-testid="button-loc-back-actions"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    뒤로
                  </button>

                  {stopsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
                      <Spinner className="w-4 h-4" />
                      주변 버스정류장을 찾는 중...
                    </div>
                  ) : stops.length > 0 ? (
                    <div className="space-y-1.5">
                      {stops.map((stop) => (
                        <button
                          key={stop.node_id}
                          type="button"
                          onClick={() => handleSelectStop(stop)}
                          data-testid={`button-loc-stop-${stop.node_id}`}
                          className="flex w-full items-center justify-between rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2.5 text-left hover:bg-emerald-100 transition-colors"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <Bus className="w-4 h-4 shrink-0 text-emerald-600" />
                            <span className="truncate font-medium text-emerald-900">
                              {stop.name}
                            </span>
                          </span>
                          <span className="text-xs text-emerald-500 shrink-0 ml-2">
                            약 {Math.round(stop.distance_meters)}m
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 rounded-xl bg-gray-50 border border-gray-200 px-3 py-3">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-gray-400" />
                      <p className="text-sm text-gray-600">
                        {stopsMessage ??
                          "주변에서 실시간 정보를 제공하는 버스정류장을 찾지 못했습니다."}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* ── 실시간 도착정보 ────────────────────────────────────── */}
              {view === "arrivals" && selectedStop && (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setView("stops")}
                    className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700"
                    data-testid="button-loc-back-stops"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    정류장 목록
                  </button>

                  <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-900">
                    <Bus className="w-4 h-4" />
                    {selectedStop.name}
                  </p>

                  {arrivalsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
                      <Spinner className="w-4 h-4" />
                      실시간 도착 정보를 불러오는 중...
                    </div>
                  ) : arrivals && arrivals.available && arrivals.arrivals.length > 0 ? (
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
                      <p className="text-xs text-sky-400">
                        국토교통부 TAGO API 기준 · 실제 도착 시간은 달라질 수 있습니다.
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 rounded-xl bg-gray-50 border border-gray-200 px-3 py-3">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-gray-400" />
                      <p className="text-sm text-gray-600">
                        {arrivals?.message ??
                          "도착 정보를 불러오지 못했습니다. 카카오맵에서 확인해 주세요."}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
