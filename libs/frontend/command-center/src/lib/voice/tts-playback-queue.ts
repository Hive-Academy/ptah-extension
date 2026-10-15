export interface PlaybackHandle {
  play(): Promise<void>;
  stop(): void;
  onEnded(callback: () => void, onError: (error: unknown) => void): void;
}

export type Synthesize = (text: string) => Promise<Blob>;
export type AudioElementFactory = (url: string) => PlaybackHandle;
export type PlaybackFailure = (text: string, error: unknown) => void;

export function browserAudioFactory(url: string): PlaybackHandle {
  const audio = new Audio(url);
  return {
    play: () => audio.play(),
    stop: () => {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    },
    onEnded: (callback, onError) => {
      audio.onended = callback;
      audio.onerror = () => onError(new Error('Audio playback failed'));
    },
  };
}

interface Clip {
  text: string;
  generation: number;
  blob?: Blob;
  failed?: boolean;
  started?: boolean;
}

/** Submission order is preserved even when synthesis finishes out of order. */
export class TtsPlaybackQueue {
  private generation = 0;
  private pending: Clip[] = [];
  private inFlight = 0;
  private current: PlaybackHandle | null = null;
  private currentUrl: string | null = null;
  private playing = false;

  public constructor(
    private readonly synthesize: Synthesize,
    private readonly audioFactory: AudioElementFactory = browserAudioFactory,
    private readonly onFailure: PlaybackFailure = () => undefined,
  ) {}

  public get isPlaying(): boolean {
    return this.playing;
  }

  public enqueue(text: string): void {
    this.pending.push({ text, generation: this.generation });
    this.pump();
  }

  public bargeIn(): void {
    this.stopAll();
  }

  public mute(): void {
    this.stopAll();
  }

  public navigate(): void {
    this.stopAll();
  }

  public stopAll(): void {
    this.generation++;
    this.pending = [];
    this.current?.stop();
    this.current = null;
    this.releaseUrl();
    this.playing = false;
  }

  private pump(): void {
    for (const clip of this.pending) {
      if (this.inFlight >= 2) break;
      if (
        clip.blob ||
        clip.failed ||
        clip.generation !== this.generation ||
        clip.started
      )
        continue;
      clip.started = true;
      this.inFlight++;
      void this.resolveClip(clip);
    }
    this.playNext();
  }

  private async resolveClip(clip: Clip): Promise<void> {
    try {
      const blob = await this.synthesize(clip.text);
      if (clip.generation === this.generation) clip.blob = blob;
    } catch (error: unknown) {
      // degradation-audit: reported — synthesis failure reaches the caller while full text remains available
      if (clip.generation === this.generation) {
        clip.failed = true;
        this.onFailure(clip.text, error);
      }
    } finally {
      this.inFlight--;
      this.pump();
    }
  }

  private playNext(): void {
    if (this.playing) return;
    while (this.pending[0]?.failed) this.pending.shift();
    const clip = this.pending[0];
    if (!clip?.blob) return;
    this.pending.shift();
    const url = URL.createObjectURL(clip.blob);
    this.currentUrl = url;
    this.playing = true;
    let settled = false;
    const finish = (): void => {
      if (settled || clip.generation !== this.generation) return;
      settled = true;
      this.current = null;
      this.releaseUrl();
      this.playing = false;
      this.pump();
    };
    const fail = (error: unknown): void => {
      if (settled || clip.generation !== this.generation) return;
      this.onFailure(clip.text, error);
      finish();
    };
    try {
      const handle = this.audioFactory(url);
      this.current = handle;
      handle.onEnded(finish, fail);
      void handle.play().then(undefined, fail);
    } catch (error: unknown) {
      // degradation-audit: reported — audio factory failure is surfaced and the full text remains available
      fail(error);
    }
  }

  private releaseUrl(): void {
    if (this.currentUrl) URL.revokeObjectURL(this.currentUrl);
    this.currentUrl = null;
  }
}
