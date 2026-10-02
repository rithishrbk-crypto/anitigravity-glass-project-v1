export interface Destination {
  id: string;
  name: string;
  lat: number;
  lng: number;
  icon: string;
}

export type SpeechRecognitionError = 'unsupported' | 'permission-denied' | 'no-speech' | 'recognition-error';

export interface SpeechRecognitionCallbacks {
  onResult: (transcript: string) => void;
  onError: (error: SpeechRecognitionError, message: string) => void;
  onEnd: () => void;
}

interface RecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<RecognitionResultLike> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechRecognitionWindow = Window & typeof globalThis & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

const aliases: Array<{ destinationId: string; phrases: string[] }> = [
  { destinationId: 'college-entrance', phrases: ['college entrance', 'entrance', 'college'] },
  { destinationId: 'aavin-canteen', phrases: ['aavin canteen', 'aavin', 'canteen'] },
  { destinationId: 'medical-hospital', phrases: ['medical hospital', 'hospital', 'medical'] },
];

export function normalizeDestinationSpeech(transcript: string): string {
  return transcript
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\b(take me to|navigate to|go to|please|can you|could you)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Returns the original destination object, so navigation continues through the existing Stage 3 flow. */
export function resolveDestinationSpeech(transcript: string, destinations: readonly Destination[]): Destination | null {
  const normalized = normalizeDestinationSpeech(transcript);
  for (const { destinationId, phrases } of aliases) {
    if (phrases.some((phrase) => new RegExp(`(^|\\s)${phrase}(?=\\s|$)`).test(normalized))) {
      return destinations.find((destination) => destination.id === destinationId) ?? null;
    }
  }
  return null;
}

const messageForError = (error: string): { type: SpeechRecognitionError; message: string } => {
  if (error === 'not-allowed' || error === 'service-not-allowed') return { type: 'permission-denied', message: 'Microphone permission was denied. Allow microphone access and try again.' };
  if (error === 'no-speech') return { type: 'no-speech', message: 'No speech was detected. Please try again.' };
  return { type: 'recognition-error', message: 'Speech recognition failed. Please try again.' };
};

/** Browser-only, one-shot Web Speech API wrapper with the Chromium webkit fallback. */
export class SpeechRecognitionService {
  private recognition: SpeechRecognitionLike | null = null;
  private listening = false;

  public get isSupported() {
    if (typeof window === 'undefined') return false;
    const browserWindow = window as SpeechRecognitionWindow;
    return Boolean(browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition);
  }

  public start(callbacks: SpeechRecognitionCallbacks): boolean {
    if (!this.isSupported) {
      callbacks.onError('unsupported', 'Speech recognition is not supported by this browser. Try Chrome or Edge.');
      return false;
    }
    this.stop();
    const browserWindow = window as SpeechRecognitionWindow;
    const Recognition = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition!;
    const recognition = new Recognition();
    let receivedResult = false;
    let receivedError = false;
    this.recognition = recognition;
    this.listening = true;
    recognition.lang = 'en-IN';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const result = event.results[0];
      if (!result?.isFinal) return;
      receivedResult = true;
      callbacks.onResult(result[0].transcript.trim());
    };
    recognition.onerror = (event) => {
      receivedError = true;
      const error = messageForError(event.error);
      callbacks.onError(error.type, error.message);
    };
    recognition.onend = () => {
      const wasListening = this.listening;
      this.listening = false;
      this.recognition = null;
      if (wasListening && !receivedResult && !receivedError) callbacks.onError('no-speech', 'No speech was detected. Please try again.');
      callbacks.onEnd();
    };
    try {
      recognition.start();
      return true;
    } catch {
      this.listening = false;
      this.recognition = null;
      callbacks.onError('recognition-error', 'Speech recognition could not start. Please try again.');
      return false;
    }
  }

  public stop() {
    if (!this.recognition) return;
    this.listening = false;
    this.recognition.abort();
    this.recognition = null;
  }
}
