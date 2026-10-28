import { ClaudeRpcService } from '@ptah-extension/core';
import { CommandCenterStore } from '../model/command-center.store';
import { summarizeVoiceProviders } from '../model/voice-provider-summary';
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
  readonly onVoiceSend?: (turnToken: number, minPulseSeq?: number) => void;
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

/** Spec section 4: the agent line lingers after its audio ends, the user line after its send. */
const AGENT_CAPTION_LINGER_MS = 1200;
const USER_CAPTION_LINGER_MS = 800;

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
  private synthesisFailurePending = false;
  private nextPlaybackId = 0;
  private nextReplyId = 0;
  private turnGeneration: number | null = null;
  private nextVoiceTurnToken = 0;
  private awaitingTurnToken: number | null = null;
  private awaitingBoundary = false;
  private readonly queuedTypedTurns: (number | undefined)[] = [];
  private sendTail: Promise<void> = Promise.resolve();
  private firstReplyAfterStart = true;
  private bargeInOnset = false;
  private bargeInCandidateAt: number | null = null;
  private playbackEpoch = 0;
  private pendingRoster = false;
  private lastReply = '';
  private generation = 0;
  private captionTimer: ReturnType<typeof setTimeout> | null = null;
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
        const epoch = this.playbackEpoch;
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
          if (epoch === this.playbackEpoch && this.active && !this.muted) {
            this.synthesisFailurePending = true;
            this.reportSpeechFailure('tts');
          }
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
            // The caption follows the audio: each sentence shows as its clip starts.
            if (
              mark &&
              epoch === this.playbackEpoch &&
              this.active &&
              !this.muted
            )
              this.showCaption('agent', mark.text);
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
      () => {
        if (this.synthesisFailurePending) {
          this.synthesisFailurePending = false;
          return;
        }
        this.reportSpeechFailure('playback');
      },
      (playing) => {
        if (!this.active || this.muted) return;
        if (playing) {
          this.store.setVoiceState('speaking');
        } else if (!this.playback.hasPending) {
          const caption = this.store.caption();
          if (caption)
            this.lingerCaption(
              caption.role === 'agent'
                ? AGENT_CAPTION_LINGER_MS
                : USER_CAPTION_LINGER_MS,
            );
          if (
            this.store.pendingInput() !== null ||
            (!this.busy && !this.awaitingBoundary)
          ) {
            this.store.setVoiceState('listening');
            this.store.resetLevels();
          } else {
            this.store.setVoiceState('thinking');
          }
        }
      },
    );
  }

  private now(): number {
    return this.options.now?.() ?? performance.now();
  }

  private reportSpeechFailure(kind: 'tts' | 'playback'): void {
    const message =
      kind === 'tts'
        ? 'Speech synthesis failed. Text is still available; retry voice when ready.'
        : 'Speech playback failed. Text is still available; retry voice when ready.';
    this.store.setVoiceError?.({ kind, message });
    this.store.setToast({ message, tone: 'error', action: 'retry-speech' });
  }

  private showCaption(role: 'user' | 'agent', text: string): void {
    this.clearCaptionTimer();
    this.store.setCaption(role, text);
  }

  /** The line stays readable for `ms` after its audio or send ends, then fades. */
  private lingerCaption(ms: number): void {
    this.clearCaptionTimer();
    this.captionTimer = setTimeout(() => {
      this.captionTimer = null;
      this.store.clearCaption('fade');
    }, ms);
  }

  /** Barge-in, mute and stop remove the line at once. */
  private cutCaption(): void {
    this.clearCaptionTimer();
    if (this.store.caption()) this.store.clearCaption('cut');
  }

  private clearCaptionTimer(): void {
    if (this.captionTimer === null) return;
    clearTimeout(this.captionTimer);
    this.captionTimer = null;
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

  /** True when a finished reply will be spoken aloud rather than only shown. */
  public get speaksReplies(): boolean {
    return this.active && !this.muted && this.store.provider().synthesis;
  }

  /**
   * Shows an unspoken reply excerpt as the agent caption. It replaces any pending
   * linger, so an earlier user line cannot fade the reply out early, and then
   * lingers and fades like a spoken agent line (no audio end will clear it).
   */
  public showReplyCaption(text: string): void {
    this.showCaption('agent', text);
    this.lingerCaption(AGENT_CAPTION_LINGER_MS);
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
      this.store.setProvider(summarizeVoiceProviders(null));
      this.store.setToast({
        message: 'Voice provider unavailable. Open voice settings or use text.',
        tone: 'error',
      });
      return false;
    }
    if (!config.success || !config.data?.ok) {
      this.store.setProvider(summarizeVoiceProviders(null));
      this.store.setToast({
        message: 'Voice provider unavailable. Open voice settings or use text.',
        tone: 'error',
      });
      return false;
    }
    const summary = summarizeVoiceProviders(config.data.config);
    this.store.setProvider(summary);
    const { transcription, synthesis } = summary;
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
      const voiceError =
        reason === 'denied'
          ? {
              kind: 'mic-denied' as const,
              message: 'Microphone permission was denied.',
            }
          : reason === 'worklet'
            ? {
                kind: 'worklet' as const,
                message: 'Voice capture could not start.',
              }
            : {
                kind: 'mic-unavailable' as const,
                message: 'Microphone is unavailable.',
              };
      this.store.setVoiceError(voiceError);
      this.store.setToast({
        message: voiceError.message,
        tone: 'error',
      });
      return false;
    }
    if (generation !== this.generation) {
      await capture.stop();
      return false;
    }
    this.capture = capture;
    this.store.setVoiceError?.(null);
    this.synthesisFailurePending = false;
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
      this.cutCaption();
      this.playbackEpoch++;
      this.synthesisFailurePending = false;
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
      if (!this.playback.hasPending) this.store.setVoiceState('listening');
    } else if (transition === 'end') {
      if (this.bargeInCandidateAt !== null) {
        this.bargeInCandidateAt = null;
        this.capture?.discardUtterance();
        if (!this.playback.hasPending) this.store.setVoiceState('listening');
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
      if (!this.playback.hasPending) this.store.setVoiceState('listening');
      this.store.resetLevels();
    }
  }

  private async onClip(clip: PcmClip): Promise<void> {
    if (!this.active || this.muted) return;
    const origin = this.currentUtteranceOrigin;
    this.currentUtteranceOrigin = null;
    this.bargeInCandidateAt = null;
    if (this.busy || this.awaitingBoundary) {
      this.queuedClip ??= { clip, origin };
      return;
    }
    this.busy = true;
    this.currentReplyOrigin = origin;
    const turnGeneration = this.generation;
    this.turnGeneration = turnGeneration;
    this.awaitingBoundary = false;
    this.store.setVoiceError?.(null);
    let requestStage: 'stt' | 'chat' = 'stt';
    try {
      const result = await this.rpc.call('voice:transcribe', clip, {
        timeout: 30_000,
      });
      if (turnGeneration !== this.generation) return;
      if (!result.success || !result.data?.ok) {
        this.store.setVoiceError?.({
          kind: 'stt',
          message: 'Transcription failed. Please try again or use text.',
        });
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
      this.showCaption('user', transcript);
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
        requestStage = 'chat';
        const sent = await this.options.sendTranscript(transcript);
        if (turnGeneration !== this.generation) return;
        if (sent) {
          this.awaitingBoundary = true;
          this.awaitingTurnToken = ++this.nextVoiceTurnToken;
          this.options.onVoiceSend?.(this.awaitingTurnToken);
        } else {
          const message = 'Voice request failed. Please try again or use text.';
          this.store.setVoiceError?.({
            kind: 'chat',
            message,
          });
          if (!this.store.toast())
            this.store.setToast({ message, tone: 'error' });
          this.finishTurn();
        }
      } finally {
        releaseSend();
      }
    } catch {
      // degradation-audit: reported — transcription failure is shown as a safe text error and creates no turn
      if (turnGeneration === this.generation) {
        this.store.setVoiceError?.({
          kind: requestStage,
          message:
            requestStage === 'stt'
              ? 'Transcription failed. Please try again or use text.'
              : 'Voice request failed. Please try again or use text.',
        });
        this.store.setToast({
          message: 'Voice request failed. Please try again or use text.',
          tone: 'error',
        });
        this.finishTurn();
      }
    }
  }

  public armTypedTurn(minPulseSeq?: number): void {
    if (!this.active) return;
    if (this.busy || this.awaitingBoundary) {
      this.queuedTypedTurns.push(minPulseSeq);
      return;
    }
    this.beginAwaitingTurn(minPulseSeq);
  }

  private beginAwaitingTurn(minPulseSeq?: number): void {
    this.turnGeneration = this.generation;
    this.awaitingBoundary = true;
    this.awaitingTurnToken = ++this.nextVoiceTurnToken;
    this.options.onVoiceSend?.(this.awaitingTurnToken, minPulseSeq);
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
    if (toSpokenText(assistantText, 'reply'))
      this.speak(assistantText, 'reply', this.currentReplyOrigin);
    else this.speak('The turn finished without a spoken reply.', 'status');
    this.currentReplyOrigin = null;
    for (const update of this.narrator.drain()) this.speak(update, 'status');
    this.finishTurn();
  }

  public abandonTurn(
    turnToken: number,
    outcome?: 'failed' | 'aborted' | 'timed-out',
  ): void {
    if (turnToken !== this.awaitingTurnToken) return;
    this.awaitingTurnToken = null;
    if (outcome === 'failed' || outcome === 'timed-out') {
      const message =
        outcome === 'timed-out'
          ? 'The turn stopped responding. Please try again.'
          : 'The turn could not finish. Please try again.';
      this.store.setVoiceError?.({ kind: 'chat', message });
      this.speak(message, 'status');
    }
    this.finishTurn();
  }

  public interruptSpeech(): void {
    this.playback.bargeIn();
    this.cutCaption();
    this.playbackEpoch++;
    this.synthesisFailurePending = false;
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
    if (this.lastReply) {
      this.store.setVoiceError?.(null);
      this.speak(this.lastReply, 'reply');
    }
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
    if (this.store.voiceState() !== 'speaking')
      this.store.setVoiceState('thinking');
  }

  private finishTurn(): void {
    if (!this.active) return;
    // A user line with no reply on the way lingers briefly, then leaves.
    if (
      this.store.caption()?.role === 'user' &&
      !this.playback.hasPending
    )
      this.lingerCaption(USER_CAPTION_LINGER_MS);
    this.busy = false;
    this.turnGeneration = null;
    this.awaitingBoundary = false;
    this.currentReplyOrigin = null;
    if (this.queuedTypedTurns.length > 0) {
      this.beginAwaitingTurn(this.queuedTypedTurns.shift());
      return;
    }
    if (this.queuedClip && this.active && !this.muted) {
      const { clip, origin } = this.queuedClip;
      this.queuedClip = null;
      this.currentUtteranceOrigin = origin;
      void this.onClip(clip);
    } else if (
      !this.playback.hasPending &&
      this.store.voiceState?.() !== 'idle' &&
      this.store.voiceState?.() !== 'stopped'
    ) {
      this.store.setVoiceState(this.muted ? 'muted' : 'listening');
      this.store.resetLevels();
    }
  }

  public async mute(): Promise<void> {
    if (!this.active && !this.muted) return;
    this.generation++;
    this.options.onTurnsAbandoned?.();
    this.muted = true;
    this.active = false;
    this.resetTurnState();
    this.playback.mute();
    this.cutCaption();
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
    this.muted = false;
    this.store.setMuted(false);
    this.resetTurnState();
    this.pendingRoster = false;
    this.playback.stopAll();
    this.cutCaption();
    this.playbackEpoch++;
    this.vad.reset();
    this.narrator.clear();
    const capture = this.capture;
    this.capture = null;
    this.store.setVoiceState('idle');
    this.store.resetLevels();
    await capture?.stop();
  }

  private resetTurnState(): void {
    this.synthesisFailurePending = false;
    this.busy = false;
    this.queuedClip = null;
    this.playbackMarks.length = 0;
    this.synthesisIds.length = 0;
    this.turnGeneration = null;
    this.awaitingBoundary = false;
    this.awaitingTurnToken = null;
    this.queuedTypedTurns.length = 0;
    this.currentReplyOrigin = null;
    this.currentUtteranceOrigin = null;
    this.bargeInCandidateAt = null;
  }
}
