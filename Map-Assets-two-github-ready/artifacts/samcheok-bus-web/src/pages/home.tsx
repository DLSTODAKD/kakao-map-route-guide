import { useCallback, useRef, useState } from "react";
import { useGetBusPlan } from "@workspace/api-client-react";
import type { TransitPoint, TransitArrivalsResult } from "@workspace/api-client-react";
import { useKakaoMaps } from "@/services/kakaoLoader";
import {
  fetchTransitPoints,
  fetchTransitPointArrivals,
  radiusForLevel,
} from "@/services/mapApiClient";
import { MapView } from "@/components/MapView";
import { SearchBar } from "@/components/SearchBar";
import { RouteSearchSheet, type RouteMode } from "@/components/RouteSearchSheet";
import { TransitBottomSheet } from "@/components/TransitBottomSheet";
import {
  LocationActionSheet,
  type ClickedLocation,
} from "@/components/LocationActionSheet";
import {
  RouteResult,
  type ClarificationCandidate,
  type ClarificationInfo,
} from "@/components/RouteResult";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { LocateFixed, MapPinned } from "lucide-react";

const DEFAULT_CENTER = { lat: 37.5547, lng: 126.9707 }; // 서울역
const DEFAULT_LEVEL = 4;

const MODE_PREFIX: Record<RouteMode, string> = {
  auto: "",
  publictransit: "대중교통으로 ",
  car: "자동차로 ",
  bicycle: "자전거로 ",
  foot: "도보로 ",
};

export default function Home() {
  const kakao = useKakaoMaps();
  const kakaoStatus = kakao.status;

  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [points, setPoints] = useState<TransitPoint[]>([]);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const [selectedPoint, setSelectedPoint] = useState<TransitPoint | null>(null);
  const [arrivals, setArrivals] = useState<TransitArrivalsResult | null>(null);
  const [arrivalsLoading, setArrivalsLoading] = useState(false);

  const [routeSheetOpen, setRouteSheetOpen] = useState(false);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [mode, setMode] = useState<RouteMode>("auto");
  const [useCurrentLocation, setUseCurrentLocation] = useState(false);

  // 지도 클릭으로 선택한 출발/도착 좌표 (있으면 검색 시 좌표를 직접 사용).
  const [pickedOrigin, setPickedOrigin] = useState<ClickedLocation | null>(null);
  const [pickedDestination, setPickedDestination] = useState<ClickedLocation | null>(null);
  const [clickedLocation, setClickedLocation] = useState<ClickedLocation | null>(null);

  const [resultOpen, setResultOpen] = useState(false);

  const getBusPlan = useGetBusPlan();
  const planResult = getBusPlan.data as any;

  const viewportReqId = useRef(0);
  const arrivalsReqId = useRef(0);

  const handleViewportChange = useCallback(async (lat: number, lng: number, level: number) => {
    const reqId = ++viewportReqId.current;
    try {
      const res = await fetchTransitPoints(lat, lng, radiusForLevel(level));
      if (reqId !== viewportReqId.current) return; // stale response — ignore
      setPoints(res.points ?? []);
    } catch {
      if (reqId !== viewportReqId.current) return;
      setPoints([]);
    }
  }, []);

  const handleMarkerClick = useCallback(async (point: TransitPoint) => {
    const reqId = ++arrivalsReqId.current;
    setSelectedPoint(point);
    setArrivals(null);
    setArrivalsLoading(true);
    try {
      const res = await fetchTransitPointArrivals(point.id);
      if (reqId !== arrivalsReqId.current) return; // a newer marker was clicked
      setArrivals(res);
    } catch {
      if (reqId !== arrivalsReqId.current) return;
      setArrivals(null);
    } finally {
      if (reqId === arrivalsReqId.current) setArrivalsLoading(false);
    }
  }, []);

  const handleMyLocation = () => {
    if (!("geolocation" in navigator)) {
      setGeoError("이 브라우저에서는 위치 기능을 사용할 수 없습니다.");
      return;
    }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCurrentLocation(c);
        setCenter(c);
        setUseCurrentLocation(true);
        setLocating(false);
      },
      () => {
        setGeoError("위치 권한이 필요합니다. 브라우저에서 위치 접근을 허용해 주세요.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const runSearch = (
    nextOrigin: string,
    nextDestination: string,
    nextMode: RouteMode,
    nextUseCurrentLocation: boolean,
  ) => {
    const originText = nextUseCurrentLocation ? "현재 위치" : nextOrigin.trim();
    const destText = nextDestination.trim();
    if (!destText || (!nextUseCurrentLocation && !originText)) return;

    const query = `${MODE_PREFIX[nextMode]}${originText}에서 ${destText}까지`;
    const body: Record<string, unknown> = { query };
    if (nextMode !== "auto") body.mode = nextMode;
    if (nextUseCurrentLocation && currentLocation) {
      body.current_location = {
        latitude: currentLocation.lat,
        longitude: currentLocation.lng,
      };
    }
    // 지도 클릭으로 선택한 좌표가 있으면 selected_place로 직접 전달 (장소명 "선택한 지점").
    if (!nextUseCurrentLocation && pickedOrigin) {
      body.origin_selected_place = {
        name: "선택한 지점",
        latitude: pickedOrigin.lat,
        longitude: pickedOrigin.lng,
      };
    }
    if (pickedDestination) {
      body.destination_selected_place = {
        name: "선택한 지점",
        latitude: pickedDestination.lat,
        longitude: pickedDestination.lng,
      };
    }

    setRouteSheetOpen(false);
    setResultOpen(true);
    getBusPlan.mutate({ data: body } as any);
  };

  const handleSearch = () => runSearch(origin, destination, mode, useCurrentLocation);

  // 지도 화면으로 돌아갈 때 검색/결과 상태를 초기 상태로 되돌립니다.
  // (지도 중심·현재 위치 정보는 유지)
  const resetSearchState = () => {
    setOrigin("");
    setDestination("");
    setMode("auto");
    setUseCurrentLocation(false);
    setPickedOrigin(null);
    setPickedDestination(null);
    setRouteSheetOpen(false);
    setResultOpen(false);
    getBusPlan.reset();
  };

  const handleSwap = () => {
    if (useCurrentLocation) return;
    setOrigin(destination);
    setDestination(origin);
    setPickedOrigin(pickedDestination);
    setPickedDestination(pickedOrigin);
  };

  // 검색 패널을 취소(닫기)하면 임시 입력만 초기화하고 확정된 planResult는 유지.
  const handleRouteSheetOpenChange = (open: boolean) => {
    if (!open) {
      setOrigin("");
      setDestination("");
      setMode("auto");
      setUseCurrentLocation(false);
      setPickedOrigin(null);
      setPickedDestination(null);
    }
    setRouteSheetOpen(open);
  };

  // 출발/도착지 텍스트를 직접 수정하면 그쪽의 지도클릭 좌표는 무효화.
  const handleOriginChange = (value: string) => {
    setOrigin(value);
    setPickedOrigin(null);
  };
  const handleDestinationChange = (value: string) => {
    setDestination(value);
    setPickedDestination(null);
  };

  const handleMapClick = (lat: number, lng: number) => {
    // 지도 클릭 = 기본 지도 화면 복귀 → 검색/결과 상태 초기화 후 액션 패널 표시.
    resetSearchState();
    setSelectedPoint(null);
    setClickedLocation({ lat, lng });
  };

  const handlePickOrigin = (loc: ClickedLocation) => {
    setPickedOrigin(loc);
    setOrigin("선택한 지점");
    setUseCurrentLocation(false);
    setClickedLocation(null);
    setRouteSheetOpen(true);
  };

  const handlePickDestination = (loc: ClickedLocation) => {
    setPickedDestination(loc);
    setDestination("선택한 지점");
    setClickedLocation(null);
    setRouteSheetOpen(true);
  };

  const handleSetOrigin = (point: TransitPoint) => {
    setOrigin(point.name);
    setPickedOrigin(null);
    setUseCurrentLocation(false);
    setSelectedPoint(null);
    setRouteSheetOpen(true);
  };

  const handleSetDestination = (point: TransitPoint) => {
    setDestination(point.name);
    setPickedDestination(null);
    setSelectedPoint(null);
    setRouteSheetOpen(true);
  };

  const handleSelectCandidate = (candidate: ClarificationCandidate) => {
    const clarification: ClarificationInfo | null | undefined = planResult?.clarification;
    if (!clarification) return;
    getBusPlan.mutate({
      data: {
        query: planResult?.parsed?.original_query ?? `${origin}에서 ${destination}까지`,
        clarification_selection: {
          target: clarification.target,
          selected_place: {
            name: candidate.name,
            address: candidate.address,
            category: candidate.category,
            latitude: candidate.latitude,
            longitude: candidate.longitude,
            place_url: candidate.place_url,
          },
        },
      },
    } as any);
  };

  const handleRejectAll = () => {
    const clarification: ClarificationInfo | null | undefined = planResult?.clarification;
    if (!clarification) return;
    getBusPlan.mutate({
      data: {
        query: planResult?.parsed?.original_query ?? `${origin}에서 ${destination}까지`,
        clarification_selection: {
          target: clarification.target,
          reject_all: true,
          rejected_candidates: clarification.candidates.map((c) => ({
            name: c.name,
            address: c.address,
            place_url: c.place_url,
          })),
        },
      },
    } as any);
  };

  return (
    <div className="relative h-screen w-full overflow-hidden bg-gray-100">
      {/* ── 지도 ─────────────────────────────────────────────────────────── */}
      {kakaoStatus === "ready" ? (
        <MapView
          center={center}
          initialLevel={DEFAULT_LEVEL}
          points={points}
          currentLocation={currentLocation}
          selectedPointId={selectedPoint?.id ?? null}
          onViewportChange={handleViewportChange}
          onMarkerClick={handleMarkerClick}
          onMapClick={handleMapClick}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-gray-100 to-gray-200">
          <div className="text-center px-6 max-w-sm">
            {kakaoStatus === "loading" ? (
              <>
                <Spinner className="w-8 h-8 mx-auto text-gray-400" />
                <p className="mt-3 text-sm text-gray-500">지도를 불러오는 중...</p>
              </>
            ) : (
              <>
                <MapPinned className="w-10 h-10 mx-auto text-gray-400" />
                <p className="mt-3 text-sm font-medium text-gray-600">
                  지도를 표시할 수 없습니다.
                </p>
                {kakao.reason === "missing-key" ? (
                  <p className="mt-2 text-xs text-red-500">
                    VITE_KAKAO_JAVASCRIPT_KEY가 빌드 환경에 없습니다. 배포 빌드
                    환경변수에 카카오 JavaScript 키를 추가해 주세요.
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-amber-600 leading-relaxed">
                    카카오 지도 SDK 도메인 인증에 실패했습니다. 카카오 개발자
                    콘솔의 Web 플랫폼에{" "}
                    <span className="font-semibold break-all">
                      {typeof window !== "undefined"
                        ? window.location.origin
                        : "https://directions-map.replit.app"}
                    </span>{" "}
                    도메인을 등록해 주세요.
                  </p>
                )}
                <p className="mt-2 text-xs text-gray-400">
                  지도 없이도 아래 검색으로 길찾기 링크를 만들 수 있습니다.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── 상단 검색바 ───────────────────────────────────────────────────── */}
      <div className="absolute top-0 inset-x-0 z-20 p-3">
        <div className="mx-auto max-w-xl">
          <SearchBar
            origin={useCurrentLocation ? "현재 위치" : origin}
            destination={destination}
            onClick={() => setRouteSheetOpen(true)}
          />
          {geoError && (
            <div className="mt-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700 shadow-sm">
              {geoError}
            </div>
          )}
        </div>
      </div>

      {/* ── 내 위치 버튼 ─────────────────────────────────────────────────── */}
      <div className="absolute bottom-6 right-4 z-20">
        <Button
          size="icon"
          onClick={handleMyLocation}
          disabled={locating}
          data-testid="button-my-location"
          className="h-12 w-12 rounded-full bg-white text-blue-600 shadow-lg hover:bg-gray-50 border border-gray-200"
          aria-label="내 위치"
        >
          {locating ? (
            <Spinner className="w-5 h-5" />
          ) : (
            <LocateFixed className="w-5 h-5" />
          )}
        </Button>
      </div>

      {/* ── 결과 다시 보기 버튼 ──────────────────────────────────────────── */}
      {planResult && !resultOpen && (
        <div className="absolute bottom-6 left-4 z-20">
          <Button
            onClick={() => setResultOpen(true)}
            data-testid="button-reopen-result"
            className="rounded-full shadow-lg bg-gray-900 text-white hover:bg-gray-800"
          >
            길찾기 결과 보기
          </Button>
        </div>
      )}

      {/* ── 시트들 ───────────────────────────────────────────────────────── */}
      <RouteSearchSheet
        open={routeSheetOpen}
        onOpenChange={handleRouteSheetOpenChange}
        origin={origin}
        destination={destination}
        mode={mode}
        useCurrentLocation={useCurrentLocation}
        hasCurrentLocation={currentLocation !== null}
        isPending={getBusPlan.isPending}
        onOriginChange={handleOriginChange}
        onDestinationChange={handleDestinationChange}
        onModeChange={setMode}
        onUseCurrentLocationChange={(v) => {
          setUseCurrentLocation(v);
          if (v && !currentLocation) handleMyLocation();
        }}
        onSwap={handleSwap}
        onSearch={handleSearch}
      />

      <TransitBottomSheet
        point={selectedPoint}
        arrivals={arrivals}
        loading={arrivalsLoading}
        onOpenChange={() => setSelectedPoint(null)}
        onSetOrigin={handleSetOrigin}
        onSetDestination={handleSetDestination}
      />

      <LocationActionSheet
        location={clickedLocation}
        onOpenChange={() => setClickedLocation(null)}
        onSetOrigin={handlePickOrigin}
        onSetDestination={handlePickDestination}
      />

      <RouteResult
        open={resultOpen && planResult !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            // 결과 패널을 닫고 지도 화면으로 복귀 → 검색/결과 상태 초기화.
            resetSearchState();
          } else {
            setResultOpen(true);
          }
        }}
        planResult={planResult}
        isPending={getBusPlan.isPending}
        onSelectCandidate={handleSelectCandidate}
        onRejectAll={handleRejectAll}
      />
    </div>
  );
}
