import {
  Injectable,
  InjectionToken,
  signal,
  computed,
  inject,
} from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';

export type VoiceInputState = 'idle' | 'recording' | 'transcribing';

export interface VoiceTranscriptionResult {
  readonly ok: boolean;
  readonly transcript?: string;
  readonly error?: string;
}

export interface MediaRecorderFactory {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createRecorder(stream: MediaStream, mimeType?: string): MediaRecorder;
  isTypeSupported(mimeType: string): boolean;
}

const MAX_RECORDING_MS = 120_000;

const TRANSCRIBE_TIMEOUT_MS = 300_000;

const PREFERRED_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm'];

export const MEDIA_RECORDER_FACTORY = new InjectionToken<MediaRecorderFactory>(
  'MEDIA_RECORDER_FACTORY',
  {
    providedIn: 'root',
    factory: () => ({
      getUserMedia: (constraints: MediaStreamConstraints) =>
        navigator.mediaDevices.getUserMedia(constraints),
      createRecorder: (stream: MediaStream, mimeType?: string) =>
        mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream),
      isTypeSupported: (mimeType: string) =>
        typeof MediaRecorder !== 'undefined' &&
        MediaRecorder.isTypeSupported(mimeType),
    }),
  },
);

@Injectable({
  providedIn: 'root',
})
export class VoiceInputService {
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly recorderFactory = inject(MEDIA_RECORDER_FACTORY);

  private readonly _state = signal<VoiceInputState>('idle');
  private readonly _elapsedSeconds = signal(0);
  private readonly _error = signal<string | null>(null);

  readonly state = this._state.asReadonly();
  readonly elapsedSeconds = this._elapsedSeconds.asReadonly();
  readonly error = this._error.asReadonly();
  readonly isRecording = computed(() => this._state() === 'recording');
  readonly isTranscribing = computed(() => this._state() === 'transcribing');
  readonly isBusy = computed(() => this._state() !== 'idle');

  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private mimeType = 'audio/webm';
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;
  private autoStopTimer: ReturnType<typeof setTimeout> | null = null;

  async startRecording(): Promise<void> {
    if (this._state() !== 'idle') return;

    this._error.set(null);
    this.chunks = [];

    try {
      this.stream = await this.recorderFactory.getUserMedia({ audio: true });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Microphone access denied';
      this._error.set(message);
      this.releaseStream();
      return;
    }

    this.mimeType = this.resolveMimeType();
    try {
      this.recorder = this.recorderFactory.createRecorder(
        this.stream,
        this.mimeType || undefined,
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to start recorder';
      this._error.set(message);
      this.releaseStream();
      return;
    }

    this.recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };
    this.recorder.onerror = () => {
      this._error.set('Recording failed');
      this.teardownRecording();
      this._state.set('idle');
    };

    this.recorder.start();
    this._state.set('recording');
    this._elapsedSeconds.set(0);
    this.startTimers();
  }

  async stopRecording(): Promise<VoiceTranscriptionResult | null> {
    if (this._state() !== 'recording' || !this.recorder) {
      this.teardownRecording();
      return null;
    }

    const recorder = this.recorder;
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(this.chunks, { type: this.mimeType }));
      };
      try {
        recorder.stop();
      } catch {
        resolve(new Blob(this.chunks, { type: this.mimeType }));
      }
    });

    this.clearTimers();
    this.releaseStream();
    this.recorder = null;

    if (blob.size === 0) {
      this._state.set('idle');
      const message = 'No audio captured';
      this._error.set(message);
      return { ok: false, error: message };
    }

    this._state.set('transcribing');
    try {
      const result = await this.transcribe(blob);
      this._state.set('idle');
      if (!result.ok && result.error) {
        this._error.set(result.error);
      }
      return result;
    } catch (error: unknown) {
      this._state.set('idle');
      const message =
        error instanceof Error ? error.message : 'Transcription failed';
      this._error.set(message);
      return { ok: false, error: message };
    }
  }

  cancelRecording(): void {
    this.teardownRecording();
    this._state.set('idle');
    this._elapsedSeconds.set(0);
  }

  private async transcribe(blob: Blob): Promise<VoiceTranscriptionResult> {
    const audioBase64 = await this.blobToBase64(blob);
    const result = await this.rpcService.call(
      'voice:transcribe',
      {
        audioBase64,
        mimeType: this.mimeType,
      },
      { timeout: TRANSCRIBE_TIMEOUT_MS },
    );

    if (!result.success || !result.data) {
      return {
        ok: false,
        error: result.error ?? 'Transcription failed',
      };
    }

    const payload = result.data;
    if (payload.ok) {
      return { ok: true, transcript: payload.transcript };
    }
    return { ok: false, error: payload.error };
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const comma = dataUrl.indexOf(',');
        resolve(comma >= 0 ? dataUrl.substring(comma + 1) : '');
      };
      reader.onerror = () =>
        reject(reader.error ?? new Error('Failed to read audio'));
      reader.readAsDataURL(blob);
    });
  }

  private resolveMimeType(): string {
    for (const candidate of PREFERRED_MIME_TYPES) {
      if (this.recorderFactory.isTypeSupported(candidate)) {
        return candidate;
      }
    }
    return '';
  }

  private startTimers(): void {
    this.elapsedTimer = setInterval(() => {
      this._elapsedSeconds.update((value) => value + 1);
    }, 1000);
    this.autoStopTimer = setTimeout(() => {
      void this.stopRecording();
    }, MAX_RECORDING_MS);
  }

  private clearTimers(): void {
    if (this.elapsedTimer) {
      clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
    if (this.autoStopTimer) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }
  }

  private releaseStream(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
  }

  private teardownRecording(): void {
    this.clearTimers();
    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop();
      } catch {
        // recorder already stopped
      }
    }
    this.recorder = null;
    this.releaseStream();
    this.chunks = [];
  }
}
