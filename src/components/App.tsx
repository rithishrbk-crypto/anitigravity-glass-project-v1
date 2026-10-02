import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CampusMap } from './CampusMap';
import { useGps } from '../hooks/useGps';
import { useNavigation } from '../hooks/useNavigation';
import { CameraView } from '../camera/CameraView';
import { AnnouncementManager } from '../decision/announcementManager';
import { DecisionEngine } from '../decision/decisionEngine';
import type { DetectionFrame } from '../decision/decisionTypes';
import destinations from '../data/destinations.json';
import { resolveDestinationSpeech, SpeechRecognitionService } from '../voice/speechRecognition.ts';
import { SpeechOutputService, type SpeechPriority } from '../voice/speechOutput.ts';

type VoiceStatus = 'idle' | 'listening' | 'recognized' | 'error';

interface VoiceState {
  status: VoiceStatus;
  transcript: string | null;
  destinationName: string | null;
  error: string | null;
}

const APPROACHING_DISTANCE_METERS = 25;
const OFF_ROUTE_ANNOUNCEMENT_COOLDOWN_MS = 30_000;

export const App: React.FC = () => {
  const [showRawTracks, setShowRawTracks] = useState(false);
  const [voiceOutputError, setVoiceOutputError] = useState<string | null>(null);
  const [speechService] = useState(() => new SpeechRecognitionService());
  const [speechOutput] = useState(() => new SpeechOutputService(setVoiceOutputError));
  const [decisionEngine] = useState(() => new DecisionEngine());
  const [announcementManager] = useState(() => new AnnouncementManager());
  const [voice, setVoice] = useState<VoiceState>({ status: 'idle', transcript: null, destinationName: null, error: null });
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const announcedEvents = useRef(new Set<string>());
  const previousDestinationId = useRef<string | null>(null);
  const completedDestinationId = useRef<string | null>(null);
  const offRouteAnnouncement = useRef({ active: false, sequence: 0, lastSpokenAt: 0 });
  const gps = useGps();
  const nav = useNavigation(gps);

  useEffect(() => () => speechService.stop(), [speechService]);
  useEffect(() => () => speechOutput.stop(), [speechOutput]);
  useEffect(() => {
    if (!speechOutput.isSupported) setVoiceOutputError('Voice output is not supported in this browser.');
  }, [speechOutput]);

  useEffect(() => {
    speechOutput.setMuted(!voiceEnabled);
  }, [speechOutput, voiceEnabled]);

  const speakMessage = useCallback((message: string, priority: SpeechPriority = 'information') => {
    if (!voiceEnabled) return false;
    if (!speechOutput.isSupported) {
      setVoiceOutputError('Voice output is not supported in this browser.');
      return false;
    }
    try {
      if (!speechOutput.speak(message, priority)) {
        setVoiceOutputError('Voice output could not be started.');
        return false;
      }
      setVoiceOutputError(null);
      return true;
    } catch {
      setVoiceOutputError('Voice output could not be started.');
      return false;
    }
  }, [speechOutput, voiceEnabled]);

  const announce = useCallback((event: string, message: string, priority: SpeechPriority = 'navigation') => {
    if (announcedEvents.current.has(event) || !voiceEnabled) return false;
    if (!speakMessage(message, priority)) return false;
    announcedEvents.current.add(event);
    announcementManager.noteNavigationAnnouncement();
    return true;
  }, [announcementManager, speakMessage, voiceEnabled]);

  const handleDetectionFrame = useCallback((frame: DetectionFrame) => {
    const navigationContext = {
      currentLocation: gps.position
        ? { latitude: gps.position.latitude, longitude: gps.position.longitude }
        : null,
      navigationActive: nav.destinationId !== null,
      routeAvailable: Boolean(nav.route?.found),
      distanceToDestination: nav.distanceToDestination,
      offRoute: nav.notice === 'Off route — recalculating.',
      destinationReached: nav.status === 'Destination reached',
      voiceEnabled,
    };
    const decisions = decisionEngine.evaluate(frame, navigationContext);
    const decision = announcementManager.select(decisions, Date.now(), {
      voiceEnabled,
      destinationReached: navigationContext.destinationReached,
      offRoute: navigationContext.offRoute,
    });
    if (decision && speakMessage(decision.message, 'object')) {
      announcementManager.markAnnounced(decision, Date.now());
    }
  }, [
    announcementManager,
    decisionEngine,
    gps.position,
    nav.destinationId,
    nav.distanceToDestination,
    nav.notice,
    nav.route?.found,
    nav.status,
    speakMessage,
    voiceEnabled,
  ]);

  useEffect(() => {
    if (nav.destinationId !== previousDestinationId.current) {
      previousDestinationId.current = nav.destinationId;
      completedDestinationId.current = null;
      announcedEvents.current.clear();
      offRouteAnnouncement.current = { active: false, sequence: 0, lastSpokenAt: 0 };
    }
    const destination = destinations.find((item) => item.id === nav.destinationId);
    if (destination) announce('navigation-started', `Navigation to ${destination.name} started.`);
  }, [announce, nav.destinationId]);

  useEffect(() => {
    const destination = destinations.find((item) => item.id === nav.destinationId);
    if (destination && nav.status === 'Route found' && nav.route?.found) {
      announce('route-found', `Route found. Distance is approximately ${Math.round(nav.route.distance)} meters.`, 'information');
    }
  }, [announce, nav.destinationId, nav.route?.found, nav.route?.distance, nav.status]);

  useEffect(() => {
    const destination = destinations.find((item) => item.id === nav.destinationId);
    if (!destination || nav.distanceToDestination === null) return;
    if (nav.status === 'Destination reached') {
      announce('destination-reached', `You have reached ${destination.name}.`, 'critical');
      if (completedDestinationId.current !== nav.destinationId) {
        completedDestinationId.current = nav.destinationId;
        gps.stopGps();
      }
    }
    else if (gps.position && nav.distanceToDestination <= APPROACHING_DISTANCE_METERS) {
      announce('approaching-destination', `You are approaching ${destination.name}.`, 'navigation');
    }
  }, [announce, gps.position, gps.stopGps, nav.destinationId, nav.distanceToDestination, nav.status]);

  useEffect(() => {
    const offRoute = nav.notice === 'Off route — recalculating.';
    const announcement = offRouteAnnouncement.current;
    if (!offRoute) {
      announcement.active = false;
      return;
    }
    if (!announcement.active) {
      announcement.active = true;
      announcement.sequence += 1;
    }
    if (Date.now() - announcement.lastSpokenAt < OFF_ROUTE_ANNOUNCEMENT_COOLDOWN_MS) return;
    if (announce(`off-route-${announcement.sequence}`, 'You are off route. Recalculating.', 'critical')) {
      announcement.lastSpokenAt = Date.now();
    }
  }, [announce, nav.notice]);

  const stopNavigation = () => {
    announce('navigation-stopped', 'Navigation stopped.', 'navigation');
    gps.stopGps();
    nav.setDestinationId(null);
    announcementManager.clear();
  };

  const selectDestination = (destinationId: string) => {
    completedDestinationId.current = null;
    gps.startGps();
    nav.setDestinationId(destinationId);
  };

  const startVoiceRecognition = () => {
    if (voice.status === 'listening') {
      speechService.stop();
      setVoice((previous) => ({ ...previous, status: 'idle' }));
      return;
    }
    setVoice({ status: 'listening', transcript: null, destinationName: null, error: null });
    speechService.start({
      onResult: (transcript) => {
        const destination = resolveDestinationSpeech(transcript, destinations);
        if (!destination) {
          setVoice({ status: 'error', transcript, destinationName: null, error: 'Destination not recognized. Please say College Entrance, Aavin Canteen, or Medical Hospital.' });
          return;
        }
        selectDestination(destination.id);
        setVoice({ status: 'recognized', transcript, destinationName: destination.name, error: null });
      },
      onError: (_type, error) => setVoice((previous) => ({ ...previous, status: 'error', error })),
      onEnd: () => undefined,
    });
  };

  // Helper to get color for GPS status
  const getGpsStatusColor = () => {
    switch (gps.status) {
      case 'active': return 'text-green-400';
      case 'poor-accuracy': return 'text-yellow-400';
      case 'waiting': return 'text-blue-400';
      case 'denied':
      case 'unavailable':
      case 'error': return 'text-red-500';
      default: return 'text-slate-500';
    }
  };

  const getNavStatusColor = () => {
    switch(nav.status) {
      case 'Route found': return 'text-green-400';
      case 'Destination reached': return 'text-primary neon-text';
      case 'No route available': return 'text-red-500';
      case 'GPS unavailable': return 'text-red-500';
      default: return 'text-slate-400';
    }
  };

  const selectedDestName = destinations.find(d => d.id === nav.destinationId)?.name || 'None';
  const navigationLabel = voice.status === 'listening'
    ? 'Listening for destination...'
    : nav.status === 'Destination reached'
      ? `You have reached ${selectedDestName}`
      : nav.notice?.startsWith('Off route')
        ? 'Off route — recalculating'
        : nav.status === 'No destination'
          ? 'Choose a destination'
          : nav.status === 'Waiting for GPS'
            ? 'Waiting for GPS location'
            : nav.status === 'GPS unavailable'
              ? 'GPS unavailable'
              : nav.status === 'No route available'
                ? 'Route unavailable'
                : nav.status === 'Route found'
                  ? `Navigating to ${selectedDestName}`
                  : nav.destinationId ? 'Calculating route...' : 'Choose a destination';

  return (
    <div className="app-shell">
      
      {/* Header Panel */}
      <header className="app-header glass-panel">
        <div className="brand-lockup">
          <span aria-hidden="true" className="brand-icon">🕶️</span>
          <h1>AI Smart Glasses</h1>
        </div>
        
        {/* Dev Mode Toggle */}
        <div className="header-status">
          <span className={`status-pill ${gps.status === 'active' || gps.status === 'poor-accuracy' ? 'status-good' : gps.status === 'denied' || gps.status === 'unavailable' || gps.status === 'error' ? 'status-error' : ''}`}>
            <span aria-hidden="true">📍</span> GPS {gps.status}
            {gps.position && <span className="status-detail">{gps.position.accuracy.toFixed(0)} m</span>}
          </span>
          <button
            type="button"
            aria-pressed={voiceEnabled}
            onClick={() => setVoiceEnabled((enabled) => !enabled)}
            className={`voice-toggle ${voiceEnabled ? 'voice-enabled' : ''}`}
          >
            {voiceEnabled ? '🔊 Voice On' : '🔇 Voice Off'}
          </button>
        </div>
      </header>

      {/* Main Map Area */}
      <main className="map-stage">
        <div className="map-layer">
          <CampusMap showRawTracks={showRawTracks} gps={gps} route={nav.route} />
        </div>
        <CameraView
          navigationActive={nav.destinationId !== null && nav.status !== 'Destination reached'}
          onDetections={handleDetectionFrame}
        />
        
        {/* Navigation Sidebar / Panel */}
        <div className="control-panel glass-panel">
          
          <div className="navigation-heading">
            <div>
              <p className="eyebrow">Navigation</p>
              <h2 className="navigation-summary" aria-live="polite">{navigationLabel}</h2>
            </div>
            <span className={`navigation-indicator ${nav.status === 'Destination reached' ? 'status-good' : nav.status === 'No route available' || nav.status === 'GPS unavailable' ? 'status-error' : ''}`} aria-hidden="true" />
          </div>

          <div className="destination-picker">
            <h2 className="section-title">Destination</h2>
            <div className="destination-list">
              {destinations.map(dest => (
                <button 
                  key={dest.id}
                  onClick={() => selectDestination(dest.id)}
                  aria-pressed={nav.destinationId === dest.id}
                  className={`destination-button ${
                    nav.destinationId === dest.id 
                      ? 'destination-selected' 
                      : ''
                  }`}
                >
                  <span>{dest.name}</span>
                </button>
              ))}
            </div>
            <div className="voice-controls">
              <button
                type="button"
                onClick={startVoiceRecognition}
                aria-pressed={voice.status === 'listening'}
                className={`microphone-button ${voice.status === 'listening' ? 'is-listening' : ''}`}
              >
                {voice.status === 'listening' ? '🔴 Listening...' : '🎤 Speak Destination'}
              </button>
              {gps.status === 'idle' || gps.status === 'error' || gps.status === 'denied' || gps.status === 'unavailable' ? (
                <button
                  type="button"
                  onClick={() => nav.destinationId ? selectDestination(nav.destinationId) : gps.startGps()}
                  className="navigation-button navigation-start"
                >
                  {nav.destinationId ? 'Resume' : 'Start GPS'}
                </button>
              ) : (
                <button type="button" onClick={stopNavigation} className="navigation-button navigation-stop">
                  Stop navigation
                </button>
              )}
              {(voice.transcript || voice.error || voice.destinationName) && (
                <div className="feedback-messages">
                  {voice.transcript && <p>Recognized: “{voice.transcript}”</p>}
                  {voice.destinationName && <p className="feedback-good">Destination: {voice.destinationName}</p>}
                  {voice.error && <p className="feedback-error">{voice.error}</p>}
                </div>
              )}
              {gps.error && <p className="feedback-error">{gps.error}</p>}
              {voiceOutputError && <p className="feedback-warning">{voiceOutputError}</p>}
            </div>
          </div>

          {/* Route Info Panel */}
          {nav.destinationId && (
            <div className="route-summary">
              {nav.route?.found && <span>Route {nav.route.distance.toFixed(0)} m</span>}
              {nav.distanceToDestination !== null && <span>Destination {nav.distanceToDestination.toFixed(0)} m</span>}
              {nav.distanceToRoute !== null && <span>From route {nav.distanceToRoute.toFixed(0)} m</span>}
              {nav.notice && <p>{nav.notice}</p>}
            </div>
          )}

          {/* Dev Debug Panel */}
          <details className="developer-details">
            <summary>Developer / Debug</summary>
            <div className="developer-content">
              <label className="raw-track-toggle">
                <input
                  type="checkbox"
                  checked={showRawTracks}
                  onChange={(event) => setShowRawTracks(event.currentTarget.checked)}
                />
                Show raw GPS tracks
              </label>
            <div className="text-xs font-mono space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">GPS Stat:</span>
                <span className={getGpsStatusColor()}>{gps.status.toUpperCase()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Lat:</span>
                <span>{gps.position ? gps.position.latitude.toFixed(6) : '---'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Lng:</span>
                <span>{gps.position ? gps.position.longitude.toFixed(6) : '---'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Acc:</span>
                <span>{gps.position ? `${gps.position.accuracy.toFixed(1)}m` : '---'}</span>
              </div>
              <div className="h-px bg-slate-700 my-1"></div>
              <div className="flex justify-between">
                <span className="text-slate-500">Rout Stat:</span>
                <span className={getNavStatusColor()}>{nav.status}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Destination:</span>
                <span>{selectedDestName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Rout Dist:</span>
                <span>{nav.route?.found ? `${nav.route.distance.toFixed(1)}m` : '---'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Dist to Route:</span>
                <span>{nav.distanceToRoute !== null ? `${nav.distanceToRoute.toFixed(1)}m` : '---'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Dist to Dest:</span>
                <span>{nav.distanceToDestination !== null ? `${nav.distanceToDestination.toFixed(1)}m` : '---'}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Nearest path:</span>
                <span>{nav.nearestPathPoint ? `${nav.nearestPathPoint.lat.toFixed(6)}, ${nav.nearestPathPoint.lng.toFixed(6)}` : '---'}</span>
              </div>
              {gps.error && (
                <div className="text-red-400 mt-2 text-xs">{gps.error}</div>
              )}
            </div>
            </div>
          </details>

        </div>
      </main>
      
    </div>
  );
};
