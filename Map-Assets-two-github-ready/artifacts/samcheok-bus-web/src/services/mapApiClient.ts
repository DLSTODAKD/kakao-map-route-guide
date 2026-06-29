import {
  getTransitPoints,
  getTransitPointArrivals,
  getNearbyBusStops,
  getRealtimeBus,
  type TransitPointsResult,
  type TransitArrivalsResult,
  type NearbyBusStopsResult,
  type RealtimeBusResult,
} from "@workspace/api-client-react";

const MAX_RADIUS = 5000;

export function radiusForLevel(level: number): number {
  if (level <= 3) return 600;
  if (level === 4) return 1000;
  if (level === 5) return 1800;
  if (level === 6) return 3000;
  return MAX_RADIUS;
}

export async function fetchTransitPoints(
  lat: number,
  lng: number,
  radius: number,
): Promise<TransitPointsResult> {
  return getTransitPoints({
    lat,
    lng,
    radius: Math.min(radius, MAX_RADIUS),
    includeBusStops: false,
  });
}

export async function fetchTransitPointArrivals(
  id: string,
): Promise<TransitArrivalsResult> {
  return getTransitPointArrivals(id);
}

export async function fetchNearbyBusStops(
  lat: number,
  lng: number,
  radius = 150,
): Promise<NearbyBusStopsResult> {
  return getNearbyBusStops({ lat, lng, radius });
}

export async function fetchRealtimeBus(
  cityCode: string,
  nodeId: string,
): Promise<RealtimeBusResult> {
  return getRealtimeBus({ cityCode, nodeId });
}
