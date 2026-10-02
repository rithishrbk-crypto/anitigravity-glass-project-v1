/**
 * Utility functions for geographic calculations and GeoJSON processing
 */

/**
 * Calculates the Haversine distance between two points on the Earth.
 * @returns Distance in meters
 */
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Finds the closest point on a line segment to a target point using equirectangular approximation.
 * Returns the snapped coordinate and the distance to it in meters.
 */
export function snapToSegment(
  targetLat: number, targetLng: number,
  lat1: number, lng1: number,
  lat2: number, lng2: number
): { lat: number, lng: number, distance: number } {
  // Convert to local cartesian (equirectangular approximation)
  // 1 deg lat ~= 111132m. 1 deg lng ~= 111132 * cos(lat)
  const R = 6371e3;
  const latToY = (Math.PI / 180) * R;
  const lngToX = (Math.PI / 180) * R * Math.cos((targetLat * Math.PI) / 180);

  const px = targetLng * lngToX;
  const py = targetLat * latToY;
  const x1 = lng1 * lngToX;
  const y1 = lat1 * latToY;
  const x2 = lng2 * lngToX;
  const y2 = lat2 * latToY;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;

  let t = 0;
  if (lengthSq !== 0) {
    // Dot product to project point onto line
    t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t)); // Clamp to segment
  }

  const snapX = x1 + t * dx;
  const snapY = y1 + t * dy;

  const snapLng = snapX / lngToX;
  const snapLat = snapY / latToY;

  const distance = calculateDistance(targetLat, targetLng, snapLat, snapLng);

  return { lat: snapLat, lng: snapLng, distance };
}

/**
 * Finds the nearest point on a GeoJSON LineString network to the given GPS coordinates.
 */
export function findNearestNetworkPoint(
  lat: number, lng: number, 
  networkFeatures: any[]
): { lat: number, lng: number, distance: number, featureIndex: number, segmentIndex: number } | null {
  
  let bestSnap = null;
  let minDistance = Infinity;

  networkFeatures.forEach((feature, fIdx) => {
    if (feature.geometry.type !== 'LineString') return;
    const coords = feature.geometry.coordinates; // [lng, lat]
    
    for (let i = 0; i < coords.length - 1; i++) {
      const p1 = coords[i];
      const p2 = coords[i+1];
      
      const snap = snapToSegment(lat, lng, p1[1], p1[0], p2[1], p2[0]);
      
      if (snap.distance < minDistance) {
        minDistance = snap.distance;
        bestSnap = {
          lat: snap.lat,
          lng: snap.lng,
          distance: snap.distance,
          featureIndex: fIdx,
          segmentIndex: i
        };
      }
    }
  });

  return bestSnap;
}

/**
 * Calculates the shortest distance from a GPS point to an entire route (array of coordinates).
 * Useful for off-route detection.
 */
export function distanceToRoute(lat: number, lng: number, routePath: {lat: number, lng: number}[]): number {
  if (!routePath || routePath.length === 0) return Infinity;
  if (routePath.length === 1) {
    return calculateDistance(lat, lng, routePath[0].lat, routePath[0].lng);
  }

  let minDistance = Infinity;
  for (let i = 0; i < routePath.length - 1; i++) {
    const p1 = routePath[i];
    const p2 = routePath[i+1];
    const snap = snapToSegment(lat, lng, p1.lat, p1.lng, p2.lat, p2.lng);
    if (snap.distance < minDistance) {
      minDistance = snap.distance;
    }
  }
  return minDistance;
}
