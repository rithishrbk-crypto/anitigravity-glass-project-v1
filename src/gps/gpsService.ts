export interface GPSPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  timestamp: number;
}

export type GPSStatus = 'idle' | 'waiting' | 'active' | 'poor-accuracy' | 'denied' | 'unavailable' | 'error';

export interface GPSState {
  status: GPSStatus;
  position: GPSPosition | null;
  error: string | null;
}

export class GPSService {
  private watchId: number | null = null;
  private listeners: Set<(state: GPSState) => void> = new Set();
  
  private currentState: GPSState = {
    status: 'idle',
    position: null,
    error: null
  };

  private notify() {
    this.listeners.forEach(callback => callback({ ...this.currentState }));
  }

  public subscribe(callback: (state: GPSState) => void) {
    this.listeners.add(callback);
    callback({ ...this.currentState }); // notify immediately on subscribe
    return () => {
      this.listeners.delete(callback);
    };
  }

  public start() {
    if (!('geolocation' in navigator)) {
      this.currentState = { status: 'unavailable', position: null, error: 'Geolocation is not supported by your browser' };
      this.notify();
      return;
    }

    if (this.watchId !== null) {
      // Already running
      return;
    }

    this.currentState = { ...this.currentState, status: 'waiting', error: null };
    this.notify();

    this.watchId = navigator.geolocation.watchPosition(
      this.handlePosition.bind(this),
      this.handleError.bind(this),
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000
      }
    );
  }

  public stop() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    
    this.currentState = {
      status: 'idle',
      position: null,
      error: null
    };
    this.notify();
  }

  private handlePosition(position: GeolocationPosition) {
    const coords = position.coords;
    
    const isPoorAccuracy = coords.accuracy > 30; // Flag if accuracy is worse than 30 meters
    
    this.currentState = {
      status: isPoorAccuracy ? 'poor-accuracy' : 'active',
      position: {
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: coords.accuracy,
        heading: coords.heading,
        speed: coords.speed,
        timestamp: position.timestamp
      },
      error: null
    };
    
    this.notify();
  }

  private handleError(error: GeolocationPositionError) {
    let status: GPSStatus = 'error';
    let errorMessage = 'An unknown GPS error occurred';

    switch (error.code) {
      case error.PERMISSION_DENIED:
        status = 'denied';
        errorMessage = 'Location permission denied by user';
        break;
      case error.POSITION_UNAVAILABLE:
        status = 'unavailable';
        errorMessage = 'Location information is unavailable';
        break;
      case error.TIMEOUT:
        // If it times out, we're essentially still waiting, or we can treat it as an error
        status = 'waiting';
        errorMessage = 'Location request timed out, trying again...';
        break;
    }

    // Only update if it's a hard error, or if we don't have a position yet
    if (error.code !== error.TIMEOUT || !this.currentState.position) {
       this.currentState = {
         ...this.currentState,
         status,
         error: errorMessage
       };
       this.notify();
    }
  }

  public getCurrentState(): GPSState {
    return { ...this.currentState };
  }
}

// Singleton instance
export const gpsService = new GPSService();
