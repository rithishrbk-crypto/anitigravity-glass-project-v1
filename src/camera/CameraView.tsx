import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraService } from './cameraService';
import { DetectionOverlay } from '../yolo/DetectionOverlay';
import type { YoloBackend, Detection } from '../yolo/detectionTypes';
import { INFERENCE_INTERVAL_MS, YoloService } from '../yolo/yoloService';
import type { DetectionFrame } from '../decision/decisionTypes';

interface CameraViewProps {
  onDetections?: (frame: DetectionFrame) => void;
  navigationActive: boolean;
}

export function CameraView({ onDetections, navigationActive }: CameraViewProps) {
  const [cameraService] = useState(() => new CameraService());
  const [yoloService] = useState(() => new YoloService());
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<'idle' | 'starting' | 'active'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [yoloStatus, setYoloStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [yoloError, setYoloError] = useState<string | null>(null);
  const [backend, setBackend] = useState<YoloBackend | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [inferenceStats, setInferenceStats] = useState<{ inferenceTimeMs: number; fps: number } | null>(null);
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const requestId = useRef(0);
  const isCameraActive = useRef(false);
  const onDetectionsRef = useRef(onDetections);

  useEffect(() => {
    onDetectionsRef.current = onDetections;
  }, [onDetections]);

  const stopCamera = useCallback(() => {
    isCameraActive.current = false;
    requestId.current += 1;
    cameraService.stop();
    setStream(null);
    setStatus('idle');
    setError(null);
    setYoloStatus('idle');
    setYoloError(null);
    setBackend(null);
    setDetections([]);
    setInferenceStats(null);
    setVideoSize(null);
    onDetectionsRef.current?.({ detections: [], width: 0, height: 0 });
  }, [cameraService]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;
    void video.play().catch(() => {
      if (video.srcObject === stream) setError('Camera preview could not start. Try starting the camera again.');
    });
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  useEffect(() => () => {
    isCameraActive.current = false;
    requestId.current += 1;
    cameraService.stop();
    void yoloService.dispose();
  }, [cameraService, yoloService]);

  useEffect(() => {
    if (!navigationActive && (stream || status === 'starting')) stopCamera();
  }, [navigationActive, status, stopCamera, stream]);

  useEffect(() => {
    if (!stream) return;

    let cancelled = false;
    let inferenceTimer: number | undefined;
    let previousInferenceAt = 0;

    const infer = async () => {
      const video = videoRef.current;
      if (cancelled) return;
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) {
        inferenceTimer = window.setTimeout(infer, INFERENCE_INTERVAL_MS);
        return;
      }

      try {
        const result = await yoloService.detect(video);
        if (cancelled || !isCameraActive.current) return;
        const completedAt = performance.now();
        setDetections(result.detections);
        onDetectionsRef.current?.({
          detections: result.detections,
          width: video.videoWidth,
          height: video.videoHeight,
        });
        setInferenceStats({
          inferenceTimeMs: result.inferenceTimeMs,
          fps: previousInferenceAt ? 1000 / (completedAt - previousInferenceAt) : 0,
        });
        previousInferenceAt = completedAt;
      } catch (inferenceError) {
        if (cancelled) return;
        setYoloStatus('error');
        setYoloError(inferenceError instanceof Error ? inferenceError.message : 'YOLO inference failed.');
        setDetections([]);
        return;
      }

      if (!cancelled) inferenceTimer = window.setTimeout(infer, INFERENCE_INTERVAL_MS);
    };

    void yoloService.load().then((loadedBackend) => {
      if (cancelled) return;
      setBackend(loadedBackend);
      setYoloStatus('ready');
      inferenceTimer = window.setTimeout(infer, 0);
    }).catch((loadError: unknown) => {
      if (cancelled) return;
      setYoloStatus('error');
      setYoloError(loadError instanceof Error ? loadError.message : 'YOLO model could not be loaded.');
    });

    return () => {
      cancelled = true;
      if (inferenceTimer !== undefined) window.clearTimeout(inferenceTimer);
      void yoloService.dispose();
    };
  }, [stream, yoloService]);

  useEffect(() => {
    if (!stream) return;
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return;
    const handleTrackEnded = () => stopCamera();
    videoTrack.addEventListener('ended', handleTrackEnded);
    return () => videoTrack.removeEventListener('ended', handleTrackEnded);
  }, [stream, stopCamera]);

  const startCamera = async () => {
    const currentRequestId = ++requestId.current;
    setStatus('starting');
    setError(null);
    setYoloStatus('idle');
    setYoloError(null);
    setBackend(null);
    setDetections([]);
    setInferenceStats(null);
    setVideoSize(null);

    try {
      const nextStream = await cameraService.start();
      if (currentRequestId !== requestId.current) return;
      isCameraActive.current = true;
      setStream(nextStream);
      setStatus('active');
      setYoloStatus('loading');
    } catch (startError) {
      if (currentRequestId !== requestId.current) return;
      setStatus('idle');
      const message = startError instanceof Error ? startError.message : 'Unable to start the camera. Try again.';
      if (message !== 'Camera start was cancelled.') setError(message);
    }
  };

  return (
    <section className="camera-widget glass-panel" aria-label="Camera preview">
      {stream ? (
        <div
          className={`camera-video-frame ${previewCollapsed ? 'camera-frame-hidden' : ''}`}
          style={videoSize ? { aspectRatio: `${videoSize.width} / ${videoSize.height}` } : undefined}
        >
          <video
            ref={videoRef}
            className="camera-video"
            playsInline
            autoPlay
            muted
            aria-label="Live camera preview"
            onLoadedMetadata={(event) => setVideoSize({
              width: event.currentTarget.videoWidth,
              height: event.currentTarget.videoHeight,
            })}
          />
          {videoSize && (
            <DetectionOverlay
              detections={detections}
              videoWidth={videoSize.width}
              videoHeight={videoSize.height}
            />
          )}
        </div>
      ) : (
        <div className={`camera-placeholder ${previewCollapsed ? 'camera-collapsed' : ''}`}>
          {status === 'starting' ? 'Starting camera…' : 'Camera off'}
        </div>
      )}
      <div className="camera-controls">
        <span className={`camera-status ${status === 'active' ? 'status-good' : ''}`}>
          📷 {status === 'active' ? 'Camera on' : status === 'starting' ? 'Starting…' : 'Camera'}
        </span>
        {status === 'active' && (
          <button type="button" onClick={() => setPreviewCollapsed((collapsed) => !collapsed)} className="camera-action">
            {previewCollapsed ? 'Show' : 'Hide'}
          </button>
        )}
        {status === 'active' ? (
          <button type="button" onClick={stopCamera} className="camera-action">
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={startCamera}
            disabled={status === 'starting' || !cameraService.isSupported || !navigationActive}
            className="camera-action"
          >
            Start Camera
          </button>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
      {stream && (
        <div className="camera-details">
          <p className={yoloStatus === 'ready' ? 'status-good' : yoloStatus === 'error' ? 'status-error' : ''}>
            👁️ YOLO {yoloStatus === 'loading' ? 'Loading...' : yoloStatus === 'ready' ? `Ready (${backend})` : yoloStatus === 'error' ? 'Error' : 'Idle'}
          </p>
          {yoloStatus === 'ready' && (
            <>
              <p>Objects detected: {detections.length}</p>
              {inferenceStats && (
                <p>
                  Inference: {inferenceStats.inferenceTimeMs.toFixed(0)} ms
                  {inferenceStats.fps > 0 && ` · ${inferenceStats.fps.toFixed(1)} FPS`}
                </p>
              )}
            </>
          )}
          {yoloError && <p role="alert" className="status-error">{yoloError}</p>}
        </div>
      )}
      {!cameraService.isSupported && (
        <p role="alert" className="camera-warning">
          Camera access is not supported in this browser.
        </p>
      )}
      {cameraService.isSupported && !navigationActive && status === 'idle' && (
        <p className="camera-hint">Start navigation to use the camera.</p>
      )}
    </section>
  );
}
