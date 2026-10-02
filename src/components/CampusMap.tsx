import React, { useCallback, useEffect, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, Marker, Popup, useMap, Circle, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import processedData from '../data/processed/campus_navigation.json';
import rawProject1 from '../data/raw/project1_tracks.json';
import rawProject2 from '../data/raw/project2_tracks.json';
import destinations from '../data/destinations.json';
import { useGps } from '../hooks/useGps';
import type { GPSState } from '../gps/gpsService';
import type { RouteResult } from '../routing/routeEngine.ts';
import { GoogleCampusMap } from './GoogleCampusMap';

// Fix for default Leaflet marker icons in React
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const createCustomIcon = (color: string) => {
  return L.divIcon({
    className: 'custom-marker-icon',
    html: `<div style="background-color: ${color}; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px ${color};"></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12]
  });
};

const createUserPulseIcon = () => {
  return L.divIcon({
    className: 'user-marker-pulse',
    html: `
      <div class="relative flex h-6 w-6 items-center justify-center">
        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
        <span class="relative inline-flex rounded-full h-4 w-4 bg-blue-500 border-2 border-white shadow-[0_0_10px_rgba(59,130,246,0.8)]"></span>
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12]
  });
};

const destinationIcon = createCustomIcon('#00d2ff');
const userIcon = createUserPulseIcon();

interface CampusMapProps {
  showRawTracks: boolean;
  gps: GPSState;
  route: RouteResult | null;
}

// Component to handle auto-fitting bounds to destinations
const MapBoundsFitter = ({ destinations }: { destinations: any[] }) => {
  const map = useMap();
  useEffect(() => {
    if (destinations.length > 0) {
      const bounds = L.latLngBounds(destinations.map(d => [d.lat, d.lng]));
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [map, destinations]);
  return null;
};

// Component to handle one-time centering on user GPS
const GpsCenterHandler = () => {
  const gps = useGps();
  const map = useMap();
  const [hasCentered, setHasCentered] = useState(false);

  useEffect(() => {
    if (gps.position && !hasCentered) {
      map.setView([gps.position.latitude, gps.position.longitude], 18, { animate: true });
      setHasCentered(true);
    }
    // If GPS stops, we can reset this so it centers again on next start
    if (gps.status === 'idle') {
      setHasCentered(false);
    }
  }, [gps.position, gps.status, hasCentered, map]);

  return null;
};

const MapSizeObserver = () => {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const resizeObserver = new ResizeObserver(() => map.invalidateSize({ pan: false, debounceMoveend: true }));
    resizeObserver.observe(container);
    const handleWindowResize = () => map.invalidateSize({ pan: false, debounceMoveend: true });
    window.addEventListener('resize', handleWindowResize);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [map]);

  return null;
};

const LeafletCampusMap: React.FC<CampusMapProps> = ({ showRawTracks, gps, route }) => {
  
  // Center roughly on campus
  const defaultCenter: [number, number] = [12.3339, 79.7808];

  const processedStyle = {
    color: '#10b981', // Emerald green
    weight: 5,
    opacity: 0.8,
    dashArray: '10, 10'
  };

  const rawStyle = {
    color: '#ef4444', // Red
    weight: 3,
    opacity: 0.5
  };

  return (
    <div className="w-full h-full relative z-0">
      <MapContainer 
        center={defaultCenter} 
        zoom={17} 
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.esri.com/">Esri</a>'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />
        
        <MapBoundsFitter destinations={destinations} />
        <GpsCenterHandler />
        <MapSizeObserver />

        {/* Processed Navigation Network */}
        <GeoJSON 
          data={processedData as any} 
          style={processedStyle} 
          onEachFeature={(feature, layer) => {
            if (feature.properties && feature.properties.Name) {
              layer.bindPopup(`<b>${feature.properties.Name}</b><br/>Corrected Path`);
            }
          }}
        />

        {/* Calculated route: drawn above the network and kept distinct from raw GPS tracks. */}
        {route?.found && route.path.length >= 2 && (
          <Polyline
            positions={route.path.map((point) => [point.lat, point.lng] as [number, number])}
            pathOptions={{ color: '#22d3ee', weight: 7, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }}
          />
        )}

        {/* Raw GPS Tracks (Dev Mode) */}
        {showRawTracks && (
          <>
            <GeoJSON 
              data={rawProject1 as any} 
              style={rawStyle}
              onEachFeature={(feature, layer) => {
                if (feature.properties && feature.properties.Name) {
                  layer.bindPopup(`<b>RAW: ${feature.properties.Name}</b>`);
                }
              }}
            />
            <GeoJSON 
              data={rawProject2 as any} 
              style={rawStyle}
              onEachFeature={(feature, layer) => {
                if (feature.properties && feature.properties.Name) {
                  layer.bindPopup(`<b>RAW: ${feature.properties.Name}</b>`);
                }
              }}
            />
          </>
        )}

        {/* Destination Markers */}
        {destinations.map((dest) => (
          <Marker 
            key={dest.id} 
            position={[dest.lat, dest.lng]}
            icon={destinationIcon}
          >
            <Popup className="destination-popup">
              <div className="font-semibold text-lg">{dest.name}</div>
            </Popup>
          </Marker>
        ))}

        {/* User GPS Location */}
        {gps.position && (
          <>
            <Circle
              center={[gps.position.latitude, gps.position.longitude]}
              radius={gps.position.accuracy}
              pathOptions={{ fillColor: '#3b82f6', fillOpacity: 0.2, color: '#3b82f6', weight: 1 }}
            />
            <Marker 
              position={[gps.position.latitude, gps.position.longitude]}
              icon={userIcon}
              zIndexOffset={1000} // Ensure user marker stays on top
            >
              <Popup className="destination-popup">
                <div className="font-semibold">Current Location</div>
                <div className="text-xs mt-1 text-slate-300">
                  Accuracy: {gps.position.accuracy.toFixed(1)}m
                </div>
              </Popup>
            </Marker>
          </>
        )}
      </MapContainer>
    </div>
  );
};

type BasemapState = 'google' | 'fallback';

export const CampusMap: React.FC<CampusMapProps> = (props) => {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? '';
  const [basemap, setBasemap] = useState<BasemapState>(() => apiKey ? 'google' : 'fallback');
  const handleGoogleMapsFailure = useCallback(() => setBasemap('fallback'), []);

  return (
    <div className="campus-map-root">
      {basemap === 'google' ? (
        <GoogleCampusMap
          apiKey={apiKey}
          showRawTracks={props.showRawTracks}
          gps={props.gps}
          route={props.route}
          onError={handleGoogleMapsFailure}
        />
      ) : (
        <LeafletCampusMap {...props} />
      )}
      {basemap === 'fallback' && (
        <div className="basemap-fallback-note" role="status">
          Google Maps unavailable. Showing the backup campus map.
        </div>
      )}
    </div>
  );
};
