import { useEffect, useRef, useState } from 'react';
import processedData from '../data/processed/campus_navigation.json';
import rawProject1 from '../data/raw/project1_tracks.json';
import rawProject2 from '../data/raw/project2_tracks.json';
import destinations from '../data/destinations.json';
import type { GPSState } from '../gps/gpsService';
import type { RouteResult } from '../routing/routeEngine.ts';

type LatLng = { lat: number; lng: number };
type Overlay = { setMap(map: GoogleMap | null): void };
type GoogleDataLayer = {
  addGeoJson(data: unknown): void;
  setMap(map: GoogleMap | null): void;
  setStyle(style: MapStyle): void;
};
type MapStyle = {
  strokeColor?: string;
  strokeOpacity?: number;
  strokeWeight?: number;
  fillColor?: string;
  fillOpacity?: number;
  clickable?: boolean;
};

interface GoogleMap {
  data: GoogleDataLayer;
  fitBounds(bounds: GoogleBounds, padding?: number): void;
  setCenter(position: LatLng): void;
  setZoom(zoom: number): void;
  getCenter(): LatLng | null;
  getDiv(): HTMLElement;
}

interface GoogleBounds {
  extend(position: LatLng): void;
}

interface GoogleMapOptions {
  center: LatLng;
  zoom: number;
  mapTypeId: 'hybrid';
  mapTypeControl: boolean;
  zoomControl: boolean;
  fullscreenControl: boolean;
  streetViewControl: boolean;
  gestureHandling: 'greedy';
}

interface GooglePolylineOptions {
  map: GoogleMap;
  path: LatLng[];
  strokeColor: string;
  strokeOpacity: number;
  strokeWeight: number;
  zIndex: number;
}

interface GoogleCircleOptions {
  map: GoogleMap;
  center: LatLng;
  radius: number;
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeOpacity: number;
  strokeWeight: number;
  zIndex: number;
}

interface GoogleMarkerOptions {
  map: GoogleMap;
  position: LatLng;
  title: string;
  zIndex: number;
  icon: {
    path: string;
    fillColor: string;
    fillOpacity: number;
    strokeColor: string;
    strokeWeight: number;
    scale: number;
  };
  label?: { text: string; color: string; fontWeight: string; fontSize: string };
}

interface GoogleMapsApi {
  maps: {
    Map: new (element: HTMLElement, options: GoogleMapOptions) => GoogleMap;
    LatLngBounds: new () => GoogleBounds;
    Polyline: new (options: GooglePolylineOptions) => Overlay;
    Circle: new (options: GoogleCircleOptions) => Overlay;
    Marker: new (options: GoogleMarkerOptions) => Overlay;
    Data: new (options?: { map?: GoogleMap }) => GoogleDataLayer;
    event: {
      trigger(target: GoogleMap, eventName: string): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleMapsApi;
    __campusGoogleMapsApiLoaded?: () => void;
    gm_authFailure?: () => void;
  }
}

let mapsApiPromise: Promise<GoogleMapsApi> | null = null;
const authFailureListeners = new Set<() => void>();
let authFailureHandlerInstalled = false;

function subscribeToAuthFailure(onFailure: () => void) {
  authFailureListeners.add(onFailure);
  if (!authFailureHandlerInstalled) {
    const previousHandler = window.gm_authFailure;
    window.gm_authFailure = () => {
      previousHandler?.();
      authFailureListeners.forEach((listener) => listener());
    };
    authFailureHandlerInstalled = true;
  }

  return () => {
    authFailureListeners.delete(onFailure);
  };
}

function loadGoogleMaps(apiKey: string): Promise<GoogleMapsApi> {
  if (window.google?.maps) return Promise.resolve(window.google);
  if (mapsApiPromise) return mapsApiPromise;

  mapsApiPromise = new Promise<GoogleMapsApi>((resolve, reject) => {
    const script = document.createElement('script');
    const scriptUrl = new URL('https://maps.googleapis.com/maps/api/js');
    scriptUrl.searchParams.set('key', apiKey);
    scriptUrl.searchParams.set('v', 'weekly');
    scriptUrl.searchParams.set('loading', 'async');
    scriptUrl.searchParams.set('callback', '__campusGoogleMapsApiLoaded');
    script.async = true;
    script.src = scriptUrl.toString();
    script.onerror = () => reject(new Error('Google Maps could not be loaded.'));
    window.__campusGoogleMapsApiLoaded = () => {
      if (window.google?.maps) resolve(window.google);
      else reject(new Error('Google Maps is unavailable.'));
    };
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    mapsApiPromise = null;
    throw error;
  });

  return mapsApiPromise;
}

interface GoogleCampusMapProps {
  apiKey: string;
  showRawTracks: boolean;
  gps: GPSState;
  route: RouteResult | null;
  onError: () => void;
}

const CAMPUS_CENTER = { lat: 12.3339, lng: 79.7808 };
const CIRCLE_PATH = 'M -1,0 a 1,1 0 1,0 2,0 a 1,1 0 1,0 -2,0';

export function GoogleCampusMap({ apiKey, showRawTracks, gps, route, onError }: GoogleCampusMapProps) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<GoogleMap | null>(null);
  const rawDataLayer = useRef<GoogleDataLayer | null>(null);
  const hasCenteredOnGps = useRef(false);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const unsubscribeAuthFailure = subscribeToAuthFailure(() => {
      if (!cancelled) onError();
    });

    void loadGoogleMaps(apiKey).then((maps) => {
      if (cancelled || !mapElement.current) return;
      const map = new maps.maps.Map(mapElement.current, {
        center: CAMPUS_CENTER,
        zoom: 18,
        mapTypeId: 'hybrid',
        mapTypeControl: true,
        zoomControl: true,
        fullscreenControl: true,
        streetViewControl: false,
        gestureHandling: 'greedy',
      });
      mapInstance.current = map;

      const bounds = new maps.maps.LatLngBounds();
      destinations.forEach((destination) => bounds.extend({ lat: destination.lat, lng: destination.lng }));
      map.fitBounds(bounds, 48);

      map.data.setStyle({
        strokeColor: '#10b981',
        strokeOpacity: 0.95,
        strokeWeight: 4,
        fillOpacity: 0,
        clickable: false,
      });
      map.data.addGeoJson(processedData);

      const rawTracks = new maps.maps.Data();
      rawTracks.setStyle({
        strokeColor: '#ef4444',
        strokeOpacity: 0.65,
        strokeWeight: 3,
        fillOpacity: 0,
        clickable: false,
      });
      rawTracks.addGeoJson(rawProject1);
      rawTracks.addGeoJson(rawProject2);
      rawTracks.setMap(null);
      rawDataLayer.current = rawTracks;

      destinations.forEach((destination, index) => {
        new maps.maps.Marker({
          map,
          position: { lat: destination.lat, lng: destination.lng },
          title: destination.name,
          zIndex: 30 + index,
          icon: {
            path: CIRCLE_PATH,
            fillColor: '#00d2ff',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
            scale: 8,
          },
          label: {
            text: `${index + 1}`,
            color: '#082f49',
            fontWeight: '700',
            fontSize: '11px',
          },
        });
      });

      setMapReady(true);
    }).catch(() => {
      if (!cancelled) onError();
    });

    return () => {
      cancelled = true;
      unsubscribeAuthFailure();
      rawDataLayer.current?.setMap(null);
      mapInstance.current = null;
      rawDataLayer.current = null;
    };
  }, [apiKey, onError]);

  useEffect(() => {
    const map = mapInstance.current;
    const maps = window.google?.maps;
    if (!map || !maps) return;

    const routeLine = route?.found && route.path.length >= 2
      ? new maps.Polyline({
        map,
        path: route.path.map((point) => ({ lat: point.lat, lng: point.lng })),
        strokeColor: '#22d3ee',
        strokeOpacity: 0.98,
        strokeWeight: 6,
        zIndex: 20,
      })
      : null;

    return () => routeLine?.setMap(null);
  }, [mapReady, route]);

  useEffect(() => {
    const map = mapInstance.current;
    const maps = window.google?.maps;
    if (!map || !maps) return;

    const position = gps.position
      ? { lat: gps.position.latitude, lng: gps.position.longitude }
      : null;
    const accuracyCircle = position && gps.position
      ? new maps.Circle({
        map,
        center: position,
        radius: gps.position.accuracy,
        fillColor: '#3b82f6',
        fillOpacity: 0.16,
        strokeColor: '#3b82f6',
        strokeOpacity: 0.75,
        strokeWeight: 1,
        zIndex: 25,
      })
      : null;
    const currentLocation = position
      ? new maps.Marker({
        map,
        position,
        title: 'Current location',
        zIndex: 100,
        icon: {
          path: CIRCLE_PATH,
          fillColor: '#3b82f6',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3,
          scale: 8,
        },
      })
      : null;

    if (position && !hasCenteredOnGps.current) {
      map.setCenter(position);
      map.setZoom(18);
      hasCenteredOnGps.current = true;
    } else if (!position && gps.status === 'idle') {
      hasCenteredOnGps.current = false;
    }

    return () => {
      accuracyCircle?.setMap(null);
      currentLocation?.setMap(null);
    };
  }, [gps.position, gps.status, mapReady]);

  useEffect(() => {
    const map = mapInstance.current;
    const maps = window.google?.maps;
    if (!map || !maps) return;

    const observer = new ResizeObserver(() => {
      const center = map.getCenter();
      maps.event.trigger(map, 'resize');
      if (center) map.setCenter(center);
    });
    observer.observe(map.getDiv());
    return () => observer.disconnect();
  }, [mapReady]);

  useEffect(() => {
    rawDataLayer.current?.setMap(showRawTracks ? mapInstance.current : null);
  }, [mapReady, showRawTracks]);

  return <div ref={mapElement} className="google-map-canvas" role="application" aria-label="Google hybrid campus map" />;
}
