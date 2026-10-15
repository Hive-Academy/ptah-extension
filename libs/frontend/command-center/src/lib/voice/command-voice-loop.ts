import { ClaudeRpcService } from '@ptah-extension/core';
import { CommandCenterStore } from '../model/command-center.store';
import { CommandCenterSessionCoordinator } from '../model/session-coordinator';
import { EnergyVad } from './vad';
import {
  PcmCapture,
  type CaptureFactories,
  type PcmClip,
  CaptureError,
} from './pcm-capture';
import { SentenceChunker } from './sentence-chunker';
import { toSpokenText } from './spoken-text';
import { StatusNarrator } from './status-narrator';
import {
  TtsPlaybackQueue,
  type AudioElementFactory,
  browserAudioFactory,
} from './tts-playback-queue';

export interface VoiceLoopOptions {
  readonly sendTranscript: (transcript: string) => Promise<boolean>;
  readonly captureFactories?: CaptureFactories;
  readonly audioFactory?: AudioElementFactory;
  /** The page resolves an ordinary question using its full prompt and question key. */
  readonly answerOrdinaryQuestion?: (transcript: string) => boolean;
  /** Identifies the voice send so a page can correlate its terminal event. */
  readonly onVoiceSend?: (turnToken: number) => void;
  readonly onTurnsAbandoned?: () => void;
  /** Optional echo rejection override; browser AEC plus playback-mode VAD handles the default. */
  readonly isIndependentSpeech?: (samples: Float32Array) => boolean;
  readonly now?: () => number;
}

interface ReplyOrigin {
  readonly endedAt: number;
  readonly barged: boolean;
}

interface PlaybackMark {
  readonly id: number;
  readonly replyId: number;
  readonly text: string;
  origin: ReplyOrigin | null;
}

/** Voice transport for a single Command Center page lifetime. */
export class CommandVoiceLoop {
  private readonly vad = new EnergyVad();
  private readonly narrator = new StatusNarrator();
  private readonly playback: TtsPlaybackQueue;
  private capture: PcmCapture | null = null;
  private active = false;
  private muted = false;
  private busy = false;
  private queuedClip: { clip: PcmClip; origin: ReplyOrigin | null } | null =
    null;
  private currentUtteranceOrigin: ReplyOrigin | null = null;
  private currentReplyOrigin: ReplyOrigin | null = null;
  private readonly playbackMarks: PlaybackMark[] = [];
  private readonly synthesisIds: number[] = [];
  private nextPlaybackId = 0;
  private nextReplyId = 0;
  private turnGeneration: number | null = null;
  private nextVoiceTurnToken = 0;
  private awaitingTurnToken: number | null = null;
  private awaitingBoundary = false;
  private queuedTypedTurns = 0;
  private sendTail: Promise<void> = Promise.resolve();
  private firstReplyAfterStart = true;
  private bargeInOnset = false;
  private bargeInCandidateAt: number | null = null;
  private playbackEpoch = 0;
  private pendingRoster = false;
  private lastReply = '';
  private generation = 0;
  private readonly latencyMarks: {
    kind: 'cold-worker' | 'post-barge-in' | 'warm';
    ms: number;
  }[] = [];

  public constructor(
    private readonly store: CommandCenterStore,
    private readonly coordinator: CommandCenterSessionCoordinator,
    private readonly rpc: ClaudeRpcService,
    private readonly options: VoiceLoopOptions,
  ) {
    this.playback = new TtsPlaybackQueue(
      async (text) => {
        const id = this.synthesisIds.shift();
        try {
          const result = await this.rpc.call(
            'voice:synthesize',
            { text },
            { timeout: 30_000 },
          );
          if (!result.success || !result.data?.ok)
            throw new Error('Speech unavailable');
          const { audioBase64, mimeType } = result.data;
          const binary = atob(audioBase64);
          const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
          return new Blob([bytes], { type: mimeType });
        } catch (error: unknown) {
          if (id !== undefined) this.removePlaybackMark(id);
          throw error;
        }
      },
      (url) => {
        const handle = (options.audioFactory ?? browserAudioFactory)(url);
        const mark = this.playbackMarks.shift();
        const origin = mark?.origin ?? null;
        const epoch = this.playbackEpoch;
        return {
          play: async () => {
            try {
              await handle.play();
            } catch (error: unknown) {
              if (origin && mark) this.transferOrigin(mark.replyId, origin);
              throw error;
            }
            if (origin && epoch === this.playbackEpoch) {
              this.latencyMarks.push({
                kind: origin.barged
                  ? 'post-barge-in'
                  : this.firstReplyAfterStart
                    ? 'cold-worker'
                    : 'warm',
                ms: Math.max(0, this.now() - origin.endedAt),
              });
              this.firstReplyAfterStart = false;
            }
          },
          stop: () => handle.stop(),
          onEnded: (callback, onError) => handle.onEnded(callback, onError),
        };
      },
      () =>
        this.store.setToast({
          message:
            'Speech playback failed. Text is still available; retry voice when ready.',
          tone: 'error',
          action: 'retry-speech',
        }),
    );
  }

  private now(): number {
    return this.options.now?.() ?? performance.now();
  }

  private removePlaybackMark(id: number): void {
    const index = this.playbackMarks.findIndex((mark) => mark.id === id);
    if (index < 0) return;
    const [mark] = this.playbackMarks.splice(index, 1);
    if (mark.origin) this.transferOrigin(mark.replyId, mark.origin);
  }

  private transferOrigin(replyId: number, origin: ReplyOrigin): void {
    const next = this.playbackMarks.find((mark) => mark.replyId === replyId);
    if (next) next.origin = origin;
  }

  private enqueue(
    text: string,
    replyId: number,
    origin: ReplyOrigin | null,
  ): number {
    const id = ++this.nextPlaybackId;
    this.playbackMarks.push({ id, replyId, text, origin });
    this.synthesisIds.push(id);
    this.playback.enqueue(text);
    return id;
  }

  public getLatencyMarks(): readonly {
    kind: 'cold-worker' | 'post-barge-in' | 'warm';
    ms: number;
  }[] {
    return [...this.latencyMarks];
  }

  public async start(): Promise<boolean> {
    if (this.active && !this.muted) return true;
    let config;
    try {
      config = await this.rpc.call(
        'voice:getProviderConfig',
        {},
        { timeout: 10_000 },
      );
    } catch {
      // degradation-audit: reported — provider failure is shown as a safe settings prompt
      this.store.setProvider({ transcription: false, synthesis: false });
      this.store.setToast({
        message: 'Voice provider unavailable. Open voice settings or use text.',
        tone: 'error',
      });
      return false;
    }
    if (!config.success || !config.data?.ok) {
      this.store.setProvider({ transcription: false, synthesis: false });
      this.store.setToast({
        message: 'Voice provider unavailable. Open voice settings or use text.',
        tone: 'error',
      });
      return false;
    }
    const { sttProvider, ttsProvider, local, elevenlabs } = config.data.config;
    const ready = (provider: string, direction: 'stt' | 'tts'): boolean =>
      provider === 'local'
        ? direction === 'stt'
          ? local.sttDownloaded
          : local.ttsDownloaded
        : provider === 'elevenlabs' && elevenlabs.apiKeyConfigured;
    const transcription = ready(sttProvider, 'stt');
    const synthesis = ready(ttsProvider, 'tts');
    this.store.setProvider({ transcription, synthesis });
    if (!transcription || !synthesis) {
      this.store.setToast({
        message:
          'Set up the selected voice providers in voice settings, or use text.',
        tone: 'error',
      });
      return false;
    }
    const generation = ++this.generation;
    const capture = new PcmCapture(
      (samples, timeMs) => this.onFrame(samples, timeMs),
      (clip) => {
        if (clip) void this.onClip(clip);
      },
      this.options.captureFactories,
    );
    try {
      await capture.start();
    } catch (error: unknown) {
      // degradation-audit: reported — typed capture failure is shown to the user with a text fallback
      const reason =
        error instanceof CaptureError ? error.reason : 'unavailable';
      this.store.setToast({
        message: `Microphone ${reason}. Use text or check microphone permissions.`,
        tone: 'error',
      });
      return false;
    }
    if (generation !== this.generation) {
      await capture.stop();
      return false;
    }
    this.capture = capture;
    this.active = true;
    this.muted = false;
    this.firstReplyAfterStart = true;
    this.store.setMuted(false);
    this.coordinator.startVoice();
    return true;
  }

  private onFrame(samples: Float32Array, timeMs: number): void {
    if (!this.active || this.muted) return;
    const playing = this.playback.isPlaying;
    if (!playing && !this.busy && this.store.voiceState() === 'speaking') {
      this.store.setVoiceState('listening');
      this.store.resetLevels();
    }
    const independent =
      !playing || (this.options.isIndependentSpeech?.(samples) ?? true);
    const transition = this.vad.processFrame(samples, timeMs, playing);
    let energy = 0;
    for (const sample of samples) energy += sample * sample;
    const rms = Math.sqrt(energy / samples.length);
    this.store.updateLevels(Math.min(1, rms * 5), playing ? 1 : 0);
    if (
      playing &&
      this.bargeInCandidateAt !== null &&
      timeMs - this.bargeInCandidateAt >= 250 &&
      rms > 0.02 &&
      independent
    ) {
      this.playback.bargeIn();
      this.playbackEpoch++;
      this.playbackMarks.length = 0;
      this.synthesisIds.length = 0;
      this.bargeInOnset = true;
      this.bargeInCandidateAt = null;
    }
    if (transition === 'start') {
      if (playing && !independent) {
        this.vad.reset();
        return;
      }
      if (playing) {
        this.bargeInCandidateAt = timeMs;
      }
      this.bargeInOnset = false;
      this.capture?.beginUtterance();
      this.store.setVoiceState('listening');
    } else if (transition === 'end') {
      if (this.bargeInCandidateAt !== null) {
        this.bargeInCandidateAt = null;
        this.capture?.discardUtterance();
        this.store.setVoiceState('listening');
        this.store.resetLevels();
        return;
      }
      this.bargeInCandidateAt = null;
      this.currentUtteranceOrigin = {
        endedAt: this.now(),
        barged: this.bargeInOnset,
      };
      this.bargeInOnset = false;
      this.capture?.endUtterance();
      this.store.setVoiceState('thinking');
    } else if (transition === 'discard') {
      this.bargeInCandidateAt = null;
      this.bargeInOnset = false;
      this.capture?.discardUtterance();
      this.store.setVoiceState('listening');
      this.store.resetLevels();
    }
  }

  private async onClip(clip: PcmClip): Promise<void> {
    if (!this.active || this.muted) return;
    const origin = this.currentUtteranceOrigin;
    this.currentUtteranceOrigin = null;
    this.bargeInCandidateAt = null;
    if (this.busy) {
      this.queuedClip ??= { clip, origin };
      return;
    }
    this.busy = true;
    this.currentReplyOrigin = origin;
    const turnGeneration = this.generation;
    this.turnGeneration = turnGeneration;
    this.awaitingBoundary = false;
    try {
      const result = await this.rpc.call('voice:transcribe', clip, {
        timeout: 30_000,
      });
      if (turnGeneration !== this.generation) return;
      if (!result.success || !result.data?.ok) {
        this.store.setToast({
          message: 'Transcription failed. Please try again or use text.',
          tone: 'error',
        });
        this.finishTurn();
        return;
      }
      const transcript = result.data.transcript.trim();
      if (!transcript) {
        this.finishTurn();
        return;
      }
      if (this.pendingRoster) {
        this.store.setToast({
          message: 'Confirm or decline the roster on the card.',
          tone: 'error',
        });
        this.finishTurn();
        return;
      }
      if (this.store.pendingInput()?.kind === 'question') {
        if (this.options.answerOrdinaryQuestion?.(transcript)) {
          this.finishTurn();
          return;
        }
        this.store.setToast({
          message: 'Answer the pending question on the page.',
          tone: 'error',
        });
        this.finishTurn();
        return;
      }
      if (this.store.pendingInput()?.kind === 'approval') {
        this.store.setToast({
          message: 'Approve or deny the request on the page.',
          tone: 'error',
        });
        this.finishTurn();
        return;
      }
      const priorSend = this.sendTail;
      let releaseSend: () => void = () => undefined;
      this.sendTail = new Promise<void>((resolve) => {
        releaseSend = resolve;
      });
      await priorSend;
      if (turnGeneration !== this.generation) {
        releaseSend();
        return;
      }
      try {
        const sent = await this.options.sendTranscript(transcript);
        if (turnGeneration !== this.generation) return;
        if (sent) {
          this.awaitingBoundary = true;
          this.awaitingTurnToken = ++this.nextVoiceTurnToken;
          this.options.onVoiceSend?.(this.awaitingTurnToken);
        } else this.finishTurn();
      } finally {
        releaseSend();
      }
    } catch {
      // degradation-audit: reported — transcription failure is shown as a safe text error and creates no turn
      if (turnGeneration === this.generation) {
        this.store.setToast({
          message: 'Voice request failed. Please try again or use text.',
          tone: 'error',
        });
        this.finishTurn();
      }
    }
  }

  public armTypedTurn(): void {
    if (!this.active) return;
    if (this.busy || this.awaitingBoundary) {
      this.queuedTypedTurns++;
      return;
    }
    this.beginAwaitingTurn();
  }

  private beginAwaitingTurn(): void {
    this.turnGeneration = this.generation;
    this.awaitingBoundary = true;
    this.awaitingTurnToken = ++this.nextVoiceTurnToken;
    this.options.onVoiceSend?.(this.awaitingTurnToken);
  }

  /** Called by the page after the assistant stream and its tool calls settle. */
  public onTurnBoundary(assistantText: string, turnToken: number): void {
    if (
      !this.active ||
      turnToken !== this.awaitingTurnToken ||
      this.turnGeneration !== this.generation ||
      !this.awaitingBoundary
    )
      return;
    this.awaitingBoundary = false;
    this.awaitingTurnToken = null;
    this.lastReply = assistantText;
    this.speak(assistantText, 'reply', this.currentReplyOrigin);
    this.currentReplyOrigin = null;
    for (const update of this.narrator.drain()) this.speak(update, 'status');
    this.finishTurn();
  }

  public abandonTurn(turnToken: number): void {
    if (turnToken !== this.awaitingTurnToken) return;
    this.awaitingTurnToken = null;
    this.finishTurn();
  }

  public interruptSpeech(): void {
    this.playback.bargeIn();
    this.playbackEpoch++;
    this.playbackMarks.length = 0;
    this.synthesisIds.length = 0;
    if (!this.busy) this.store.setVoiceState('listening');
  }

  public onProjection(root: string): void {
    this.narrator.observe(root, this.store.nodes());
  }

  public onPendingPrompt(summary: string): void {
    this.speak(summary, 'status');
  }

  public onRosterProposal(summary: string, valid: boolean): void {
    this.pendingRoster = valid;
    if (valid) this.speak(summary, 'status');
  }

  public onRosterResolved(): void {
    this.pendingRoster = false;
  }

  public setRosterPending(pending: boolean): void {
    this.pendingRoster = pending;
  }

  public retrySpeech(): void {
    if (this.lastReply) this.speak(this.lastReply, 'reply');
  }

  private speak(
    text: string,
    kind: 'reply' | 'status',
    origin: ReplyOrigin | null = null,
  ): void {
    const spoken = toSpokenText(text, kind);
    if (!spoken || this.muted || !this.active) return;
    const chunker = new SentenceChunker();
    const replyId = ++this.nextReplyId;
    let first = true;
    for (const chunk of [...chunker.push(spoken), ...chunker.flush()]) {
      this.enqueue(chunk, replyId, first ? origin : null);
      first = false;
    }
    this.store.setVoiceState('speaking');
  }

  private finishTurn(): void {
    if (!this.active) return;
    this.busy = false;
    this.turnGeneration = null;
    this.awaitingBoundary = false;
    this.currentReplyOrigin = null;
    if (this.queuedTypedTurns > 0) {
      this.queuedTypedTurns--;
      this.beginAwaitingTurn();
      return;
    }
    if (this.queuedClip && this.active && !this.muted) {
      const { clip, origin } = this.queuedClip;
      this.queuedClip = null;
      this.currentUtteranceOrigin = origin;
      void this.onClip(clip);
    } else if (
      !this.playback.isPlaying &&
      this.store.voiceState?.() !== 'idle' &&
      this.store.voiceState?.() !== 'stopped'
    ) {
      this.store.setVoiceState(this.muted ? 'muted' : 'listening');
      this.store.resetLevels();
    }
  }

  public async mute(): Promise<void> {
    this.generation++;
    this.options.onTurnsAbandoned?.();
    this.muted = true;
    this.active = false;
    this.busy = false;
    this.queuedClip = null;
    this.playbackMarks.length = 0;
    this.synthesisIds.length = 0;
    this.turnGeneration = null;
    this.awaitingBoundary = false;
    this.awaitingTurnToken = null;
    this.queuedTypedTurns = 0;
    this.currentReplyOrigin = null;
    this.currentUtteranceOrigin = null;
    this.bargeInCandidateAt = null;
    this.playback.mute();
    this.playbackEpoch++;
    this.vad.reset();
    await this.capture?.stop();
    this.capture = null;
    this.coordinator.mute();
    this.store.resetLevels();
  }

  public async stop(): Promise<void> {
    await this.release();
    await this.coordinator.stop();
  }

  public async exit(): Promise<void> {
    await this.release();
  }

  private async release(): Promise<void> {
    this.generation++;
    this.options.onTurnsAbandoned?.();
    this.active = false;
    this.busy = false;
    this.queuedClip = null;
    this.playbackMarks.length = 0;
    this.synthesisIds.length = 0;
    this.turnGeneration = null;
    this.awaitingBoundary = false;
    this.awaitingTurnToken = null;
    this.queuedTypedTurns = 0;
    this.currentReplyOrigin = null;
    this.currentUtteranceOrigin = null;
    this.pendingRoster = false;
    this.bargeInCandidateAt = null;
    this.playback.stopAll();
    this.playbackEpoch++;
    this.vad.reset();
    this.narrator.clear();
    await this.capture?.stop();
    this.capture = null;
    this.store.setVoiceState('idle');
    this.store.resetLevels();
  }
}
