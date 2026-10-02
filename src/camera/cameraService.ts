export class CameraService {
  private stream: MediaStream | null = null;
  private requestId = 0;

  public get isSupported() {
    return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  }

  public async start(): Promise<MediaStream> {
    if (!this.isSupported) {
      throw new Error('Camera access is not supported in this browser. Use a supported browser over HTTPS or localhost.');
    }

    this.stop();
    const requestId = this.requestId;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
    } catch (error) {
      throw new Error(this.getErrorMessage(error));
    }

    if (requestId !== this.requestId) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('Camera start was cancelled.');
    }

    this.stream = stream;
    return stream;
  }

  public stop() {
    this.requestId += 1;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof DOMException) {
      if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Camera permission denied.';
      if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') return 'No camera was found on this device.';
      if (error.name === 'NotReadableError' || error.name === 'TrackStartError') return 'The camera is unavailable or already in use.';
    }
    return 'Unable to start the camera. Check browser permissions and try again.';
  }
}
