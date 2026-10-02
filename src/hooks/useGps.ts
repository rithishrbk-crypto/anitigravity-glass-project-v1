import { useState, useEffect, useCallback } from 'react';
import { gpsService, type GPSState } from '../gps/gpsService';

export function useGps() {
  const [gpsState, setGpsState] = useState<GPSState>(gpsService.getCurrentState());

  useEffect(() => {
    const unsubscribe = gpsService.subscribe((newState) => {
      setGpsState(newState);
    });

    // Cleanup callback on unmount
    return () => {
      unsubscribe();
    };
  }, []);

  const startGps = useCallback(() => {
    gpsService.start();
  }, []);

  const stopGps = useCallback(() => {
    gpsService.stop();
  }, []);

  return {
    ...gpsState,
    startGps,
    stopGps
  };
}
