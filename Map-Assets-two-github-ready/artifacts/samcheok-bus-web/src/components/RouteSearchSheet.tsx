import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { LocateFixed, Search, ArrowDownUp } from "lucide-react";

export type RouteMode = "auto" | "publictransit" | "car" | "bicycle" | "foot";

const MODE_OPTIONS: { value: RouteMode; label: string; icon: string }[] = [
  { value: "auto", label: "기본", icon: "🗺️" },
  { value: "publictransit", label: "대중교통", icon: "🚌" },
  { value: "car", label: "자동차", icon: "🚗" },
  { value: "bicycle", label: "자전거", icon: "🚲" },
  { value: "foot", label: "도보", icon: "🚶" },
];

interface RouteSearchSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  origin: string;
  destination: string;
  mode: RouteMode;
  useCurrentLocation: boolean;
  hasCurrentLocation: boolean;
  isPending: boolean;
  onOriginChange: (value: string) => void;
  onDestinationChange: (value: string) => void;
  onModeChange: (mode: RouteMode) => void;
  onUseCurrentLocationChange: (value: boolean) => void;
  onSwap: () => void;
  onSearch: () => void;
}

export function RouteSearchSheet({
  open,
  onOpenChange,
  origin,
  destination,
  mode,
  useCurrentLocation,
  hasCurrentLocation,
  isPending,
  onOriginChange,
  onDestinationChange,
  onModeChange,
  onUseCurrentLocationChange,
  onSwap,
  onSearch,
}: RouteSearchSheetProps) {
  const canSearch =
    (useCurrentLocation || origin.trim().length > 0) && destination.trim().length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="top" className="rounded-b-3xl">
        <SheetHeader className="text-left">
          <SheetTitle>길찾기</SheetTitle>
          <SheetDescription>출발지와 도착지, 이동수단을 입력하세요.</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="origin" className="text-sm font-medium text-gray-700">
                출발지
              </Label>
              <button
                type="button"
                onClick={() => onUseCurrentLocationChange(!useCurrentLocation)}
                data-testid="button-use-current-location"
                className={`inline-flex items-center gap-1 text-xs font-medium rounded-full px-2.5 py-1 transition-colors ${
                  useCurrentLocation
                    ? "bg-blue-600 text-white"
                    : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                }`}
              >
                <LocateFixed className="w-3.5 h-3.5" />
                내 위치
              </button>
            </div>
            <Input
              id="origin"
              data-testid="input-origin"
              placeholder={useCurrentLocation ? "현재 위치 사용 중" : "예: 서울역"}
              value={useCurrentLocation ? "현재 위치" : origin}
              disabled={useCurrentLocation}
              onChange={(e) => onOriginChange(e.target.value)}
            />
            {useCurrentLocation && !hasCurrentLocation && (
              <p className="text-xs text-amber-600">
                "내 위치"를 켰지만 아직 위치를 가져오지 못했습니다. 지도의 위치 버튼을 눌러주세요.
              </p>
            )}
          </div>

          <div className="flex justify-center">
            <button
              type="button"
              onClick={onSwap}
              data-testid="button-swap"
              className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-gray-200 text-gray-500 hover:bg-gray-50"
              aria-label="출발지와 도착지 바꾸기"
            >
              <ArrowDownUp className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="destination" className="text-sm font-medium text-gray-700">
              도착지
            </Label>
            <Input
              id="destination"
              data-testid="input-destination"
              placeholder="예: 강남역"
              value={destination}
              onChange={(e) => onDestinationChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSearch && !isPending) onSearch();
              }}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium text-gray-700">이동수단</Label>
            <div className="flex flex-wrap gap-2">
              {MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onModeChange(opt.value)}
                  data-testid={`button-mode-${opt.value}`}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
                    mode === opt.value
                      ? "bg-gray-900 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  <span>{opt.icon}</span>
                  {opt.label}
                </button>
              ))}
            </div>
            {mode === "auto" && (
              <p className="text-xs text-gray-400">
                기본: 대중교통과 자동차 링크를 함께 안내합니다.
              </p>
            )}
          </div>

          <Button
            size="lg"
            className="w-full text-base py-6 font-bold"
            disabled={!canSearch || isPending}
            onClick={onSearch}
            data-testid="button-search"
          >
            {isPending ? (
              "검색 중..."
            ) : (
              <>
                <Search className="mr-2 w-5 h-5" />
                길찾기
              </>
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
