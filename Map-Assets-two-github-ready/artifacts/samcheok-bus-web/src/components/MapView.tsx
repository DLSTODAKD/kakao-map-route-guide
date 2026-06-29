import { useEffect, useRef } from "react";
import type { TransitPoint } from "@workspace/api-client-react";

interface LatLng {
  lat: number;
  lng: number;
}

interface MapViewProps {
  center: LatLng;
  initialLevel?: number;
  points: TransitPoint[];
  currentLocation: LatLng | null;
  selectedPointId: string | null;
  onViewportChange: (lat: number, lng: number, level: number) => void;
  onMarkerClick: (point: TransitPoint) => void;
  onMapClick?: (lat: number, lng: number) => void;
}

// bus_stop 마커는 표시하지 않습니다 (지도 기본 POI 사용).
const TYPE_STYLE: Record<string, { color: string; emoji: string }> = {
  subway: { color: "#16a34a", emoji: "🚇" },
  rail: { color: "#7c3aed", emoji: "🚆" },
  terminal: { color: "#ea580c", emoji: "🚍" },
};

const ZOOM_GUARD_LEVEL = 6;
const MIN_MOVE_METERS = 300;
const DEBOUNCE_MS = 500;

function haversine(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function buildMarkerElement(
  point: TransitPoint,
  selected: boolean,
  onClick: () => void,
): HTMLElement {
  const style = TYPE_STYLE[point.type] ?? { color: "#6b7280", emoji: "📍" };
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", point.name);
  el.style.cssText = [
    "display:flex",
    "align-items:center",
    "justify-content:center",
    `width:${selected ? 36 : 28}px`,
    `height:${selected ? 36 : 28}px`,
    "border-radius:9999px",
    `background:${style.color}`,
    `border:${selected ? "3px solid #ffffff" : "2px solid #ffffff"}`,
    `box-shadow:0 2px 6px rgba(0,0,0,${selected ? 0.45 : 0.3})`,
    `font-size:${selected ? 18 : 14}px`,
    "line-height:1",
    "cursor:pointer",
    "padding:0",
    `transform:translateY(0) scale(${selected ? 1.05 : 1})`,
    "transition:transform 0.12s ease",
  ].join(";");
  el.textContent = style.emoji;
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return el;
}

export function MapView({
  center,
  initialLevel = 4,
  points,
  currentLocation,
  selectedPointId,
  onViewportChange,
  onMarkerClick,
  onMapClick,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const curLocOverlayRef = useRef<any>(null);
  const lastFetchRef = useRef<{ lat: number; lng: number; level: number } | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  const onViewportChangeRef = useRef(onViewportChange);
  const onMarkerClickRef = useRef(onMarkerClick);
  const onMapClickRef = useRef(onMapClick);
  onViewportChangeRef.current = onViewportChange;
  onMarkerClickRef.current = onMarkerClick;
  onMapClickRef.current = onMapClick;

  // Initialize the map once.
  useEffect(() => {
    if (!containerRef.current || !window.kakao?.maps) return;
    const kakao = window.kakao;

    const map = new kakao.maps.Map(containerRef.current, {
      center: new kakao.maps.LatLng(center.lat, center.lng),
      level: initialLevel,
    });
    mapRef.current = map;

    const emit = () => {
      const c = map.getCenter();
      const level = map.getLevel();
      const lat = c.getLat();
      const lng = c.getLng();
      if (level > ZOOM_GUARD_LEVEL) return;

      const last = lastFetchRef.current;
      const moved = last ? haversine(last.lat, last.lng, lat, lng) : Infinity;
      if (last && moved < MIN_MOVE_METERS && last.level === level) return;

      window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        lastFetchRef.current = { lat, lng, level };
        onViewportChangeRef.current(lat, lng, level);
      }, DEBOUNCE_MS);
    };

    kakao.maps.event.addListener(map, "idle", emit);

    const handleClick = (mouseEvent: any) => {
      const latLng = mouseEvent?.latLng;
      if (!latLng) return;
      onMapClickRef.current?.(latLng.getLat(), latLng.getLng());
    };
    kakao.maps.event.addListener(map, "click", handleClick);

    // Initial fetch (idle won't fire on its own after creation in all cases).
    lastFetchRef.current = { lat: center.lat, lng: center.lng, level: initialLevel };
    onViewportChangeRef.current(center.lat, center.lng, initialLevel);

    return () => {
      window.clearTimeout(debounceRef.current);
      kakao.maps.event.removeListener(map, "idle", emit);
      kakao.maps.event.removeListener(map, "click", handleClick);
      overlaysRef.current.forEach((o) => o.setMap(null));
      overlaysRef.current = [];
      curLocOverlayRef.current?.setMap(null);
      curLocOverlayRef.current = null;
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recenter when the external center prop changes (e.g. my-location button).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.kakao?.maps) return;
    map.panTo(new window.kakao.maps.LatLng(center.lat, center.lng));
  }, [center.lat, center.lng]);

  // Render transit markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.kakao?.maps) return;
    const kakao = window.kakao;

    overlaysRef.current.forEach((o) => o.setMap(null));
    overlaysRef.current = [];

    // bus_stop은 커스텀 마커로 표시하지 않음 (지도 기본 POI 사용).
    points.filter((p) => p.type !== "bus_stop").forEach((point) => {
      const selected = point.id === selectedPointId;
      const el = buildMarkerElement(point, selected, () =>
        onMarkerClickRef.current(point),
      );
      const overlay = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(point.latitude, point.longitude),
        content: el,
        yAnchor: 0.5,
        xAnchor: 0.5,
        zIndex: selected ? 10 : 1,
        clickable: true,
      });
      overlay.setMap(map);
      overlaysRef.current.push(overlay);
    });
  }, [points, selectedPointId]);

  // Render the current-location dot.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.kakao?.maps) return;
    const kakao = window.kakao;

    curLocOverlayRef.current?.setMap(null);
    curLocOverlayRef.current = null;

    if (!currentLocation) return;

    const el = document.createElement("div");
    el.style.cssText = [
      "width:18px",
      "height:18px",
      "border-radius:9999px",
      "background:#2563eb",
      "border:3px solid #ffffff",
      "box-shadow:0 0 0 4px rgba(37,99,235,0.25)",
    ].join(";");

    const overlay = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(currentLocation.lat, currentLocation.lng),
      content: el,
      yAnchor: 0.5,
      xAnchor: 0.5,
      zIndex: 5,
    });
    overlay.setMap(map);
    curLocOverlayRef.current = overlay;
  }, [currentLocation]);

  return <div ref={containerRef} className="absolute inset-0 h-full w-full" />;
}
