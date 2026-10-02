import { useCallback, useEffect, useRef, useState } from 'react';
import type { GPSState } from '../gps/gpsService';
import { RoutingGraph } from '../routing/graph.ts';
import { RouteEngine } from '../routing/routeEngine.ts';
import type { NetworkMatch, RouteResult } from '../routing/routeEngine.ts';
import { calculateDistance, distanceToRoute } from '../routing/geoUtils.ts';
import campusNetwork from '../data/processed/campus_navigation.json';
import destinations from '../data/destinations.json';

export const ARRIVAL_RADIUS_METERS = 10;
export const OFF_ROUTE_THRESHOLD_METERS = 10;
export const MAX_NETWORK_SNAP_DISTANCE_METERS = 40;
const ROUTE_REFRESH_DISTANCE_METERS = 25;
const OFF_ROUTE_RECALC_MIN_MOVEMENT_METERS = 5;

export type RouteStatus = 'No destination' | 'Waiting for GPS' | 'GPS unavailable' | 'Route found' | 'No route available' | 'Destination reached';
export interface NavigationState {
  destinationId: string | null;
  status: RouteStatus;
  route: RouteResult | null;
  distanceToRoute: number | null;
  distanceToDestination: number | null;
  nearestPathPoint: NetworkMatch | null;
  notice: string | null;
}

const graph = new RoutingGraph();
try { graph.buildFromGeoJSON(campusNetwork.features); } catch { graph.error = 'The processed walking network could not be read.'; }
const routeEngine = new RouteEngine(graph);

export function useNavigation(gps: GPSState) {
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [navState, setNavState] = useState<NavigationState>({ destinationId: null, status: 'No destination', route: null, distanceToRoute: null, distanceToDestination: null, nearestPathPoint: null, notice: null });
  const lastRouteStart = useRef<{ lat: number; lng: number } | null>(null);
  const reachedDestinationId = useRef<string | null>(null);
  const selectDestination = useCallback((nextDestinationId: string | null) => {
    reachedDestinationId.current = null;
    setDestinationId(nextDestinationId);
  }, []);

  useEffect(() => {
    if (!destinationId) {
      lastRouteStart.current = null;
      setNavState({ destinationId: null, status: 'No destination', route: null, distanceToRoute: null, distanceToDestination: null, nearestPathPoint: null, notice: null });
      return;
    }
    if (reachedDestinationId.current === destinationId) return;
    const destination = destinations.find((item) => item.id === destinationId);
    if (!destination) {
      setNavState((previous) => ({ ...previous, status: 'No route available', notice: 'The selected destination is invalid.' }));
      return;
    }
    if (!gps.position) {
      setNavState((previous) => ({ ...previous, destinationId, status: gps.status === 'denied' || gps.status === 'unavailable' || gps.status === 'error' ? 'GPS unavailable' : 'Waiting for GPS', notice: gps.error }));
      return;
    }

    const user = gps.position;
    const distanceToDestination = calculateDistance(user.latitude, user.longitude, destination.lat, destination.lng);
    if (distanceToDestination <= ARRIVAL_RADIUS_METERS) {
      reachedDestinationId.current = destinationId;
      setNavState((previous) => ({ ...previous, destinationId, status: 'Destination reached', distanceToDestination, distanceToRoute: previous.route ? distanceToRoute(user.latitude, user.longitude, previous.route.path) : null, notice: null }));
      return;
    }

    const movedSinceRouteStart = lastRouteStart.current ? calculateDistance(user.latitude, user.longitude, lastRouteStart.current.lat, lastRouteStart.current.lng) : Infinity;
    const currentRoute = navState.route;
    const currentDistanceToRoute = currentRoute?.found ? distanceToRoute(user.latitude, user.longitude, currentRoute.path) : null;
    const isOffRoute = currentDistanceToRoute !== null && currentDistanceToRoute > OFF_ROUTE_THRESHOLD_METERS && movedSinceRouteStart >= OFF_ROUTE_RECALC_MIN_MOVEMENT_METERS;
    const needsRoute = navState.destinationId !== destinationId || !currentRoute?.found || isOffRoute || movedSinceRouteStart >= ROUTE_REFRESH_DISTANCE_METERS;

    if (!needsRoute) {
      setNavState((previous) => ({ ...previous, distanceToRoute: currentDistanceToRoute, distanceToDestination, notice: gps.status === 'poor-accuracy' ? 'Poor GPS accuracy — route matching may be imprecise.' : null }));
      return;
    }

    const route = routeEngine.calculateRoute(user.latitude, user.longitude, destination.lat, destination.lng, MAX_NETWORK_SNAP_DISTANCE_METERS);
    lastRouteStart.current = { lat: user.latitude, lng: user.longitude };
    setNavState({
      destinationId,
      status: route.found ? 'Route found' : 'No route available',
      route,
      distanceToRoute: route.found ? distanceToRoute(user.latitude, user.longitude, route.path) : null,
      distanceToDestination,
      nearestPathPoint: route.startMatch,
      notice: route.found ? (isOffRoute ? 'Off route — recalculating.' : gps.status === 'poor-accuracy' ? 'Poor GPS accuracy — route matching may be imprecise.' : null) : route.error ?? 'No route is available.'
    });
  }, [destinationId, gps.position, gps.status, gps.error]);

  return { ...navState, setDestinationId: selectDestination };
}
