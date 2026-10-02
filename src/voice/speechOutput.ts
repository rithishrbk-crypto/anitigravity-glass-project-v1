/** Browser-only speech synthesis wrapper. It deliberately contains no navigation logic. */
export type SpeechPriority = 'object' | 'information' | 'navigation' | 'critical';

interface QueuedSpeech {
  message: string;
  priority: SpeechPriority;
  sequence: number;
}

const PRIORITY_RANK: Record<SpeechPriority, number> = {
  object: 1,
  information: 2,
  navigation: 3,
  critical: 4,
};

export class SpeechOutputService {
  private muted = false;
  private queue: QueuedSpeech[] = [];
  private activePriority: SpeechPriority | null = null;
  private activeSequence = 0;
  private nextSequence = 0;
  private readonly onError?: (message: string) => void;

  public constructor(onError?: (message: string) => void) {
    this.onError = onError;
  }

  public get isSupported() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) this.stop();
  }

  public speak(message: string, priority: SpeechPriority = 'information'): boolean {
    if (this.muted || !this.isSupported) return false;
    const sequence = ++this.nextSequence;
    if (this.activePriority !== null && PRIORITY_RANK[priority] > PRIORITY_RANK[this.activePriority]) {
      this.activeSequence = 0;
      this.activePriority = null;
      window.speechSynthesis.cancel();
    }
    this.queue = this.queue.filter((item) => PRIORITY_RANK[item.priority] >= PRIORITY_RANK[priority]);
    if (this.queue.length >= 8) {
      const lowestPriority = Math.min(...this.queue.map((item) => PRIORITY_RANK[item.priority]));
      if (lowestPriority > PRIORITY_RANK[priority]) return false;
      const lowestIndex = this.queue.findIndex((item) => PRIORITY_RANK[item.priority] === lowestPriority);
      this.queue.splice(lowestIndex, 1);
    }
    this.queue.push({ message, priority, sequence });
    this.queue.sort((first, second) =>
      PRIORITY_RANK[second.priority] - PRIORITY_RANK[first.priority] || first.sequence - second.sequence,
    );
    this.playNext();
    return true;
  }

  private playNext() {
    if (this.muted || this.activePriority !== null || !this.isSupported || this.queue.length === 0) return;
    const next = this.queue.shift();
    if (!next) return;

    const utterance = new SpeechSynthesisUtterance(next.message);
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find((voice) => voice.lang.toLowerCase().startsWith('en') && voice.localService) ?? voices.find((voice) => voice.lang.toLowerCase().startsWith('en')) ?? null;
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.volume = 1;
    this.activePriority = next.priority;
    this.activeSequence = next.sequence;
    const finish = () => {
      if (this.activeSequence !== next.sequence) return;
      this.activePriority = null;
      this.activeSequence = 0;
      this.playNext();
    };
    utterance.onend = finish;
    utterance.onerror = (event) => {
      if (this.activeSequence !== next.sequence) return;
      if (event.error !== 'canceled' && event.error !== 'interrupted') {
        this.onError?.('Voice output could not be started.');
      }
      finish();
    };
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      finish();
      this.onError?.('Voice output could not be started.');
    }
  }

  public stop() {
    this.queue = [];
    this.activePriority = null;
    this.activeSequence = 0;
    if (this.isSupported) window.speechSynthesis.cancel();
  }
}
