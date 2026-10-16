/** Every start is followed by exactly one end or discard, unless reset() is called. */
export type VadTransition = 'start' | 'end' | 'discard' | null;

export interface EnergyVadOptions {
  speechThreshold?: number;
  noiseFloor?: number;
  speechStartMs?: number;
  playbackStartMs?: number;
  silenceHangoverMs?: number;
  minUtteranceMs?: number;
}

/** Frame-driven RMS detector. The caller owns capture and the clock. */
export class EnergyVad {
  private readonly options: Required<EnergyVadOptions>;
  private aboveSince: number | null = null;
  private belowSince: number | null = null;
  private speechSince: number | null = null;
  private lastTime = -Infinity;

  public constructor(options: EnergyVadOptions = {}) {
    this.options = {
      speechThreshold: options.speechThreshold ?? 0.02,
      noiseFloor: options.noiseFloor ?? 0.008,
      speechStartMs: options.speechStartMs ?? 120,
      playbackStartMs: options.playbackStartMs ?? 300,
      silenceHangoverMs: options.silenceHangoverMs ?? 700,
      minUtteranceMs: options.minUtteranceMs ?? 250,
    };
  }

  public get isSpeaking(): boolean {
    return this.speechSince !== null;
  }

  public reset(): void {
    this.aboveSince = null;
    this.belowSince = null;
    this.speechSince = null;
    this.lastTime = -Infinity;
  }

  public processFrame(
    samples: Float32Array,
    timeMs: number,
    playbackMode = false,
  ): VadTransition {
    if (
      !Number.isFinite(timeMs) ||
      timeMs < this.lastTime ||
      samples.length === 0
    ) {
      return null;
    }
    this.lastTime = timeMs;
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const rms = Math.sqrt(sum / samples.length);
    const active =
      rms > Math.max(this.options.noiseFloor, this.options.speechThreshold);
    if (active) {
      this.belowSince = null;
      this.aboveSince ??= timeMs;
      const onset = playbackMode
        ? this.options.playbackStartMs
        : this.options.speechStartMs;
      if (this.speechSince === null && timeMs - this.aboveSince >= onset) {
        this.speechSince = this.aboveSince;
        return 'start';
      }
      return null;
    }
    this.aboveSince = null;
    this.belowSince ??= timeMs;
    if (
      this.speechSince !== null &&
      timeMs - this.belowSince >= this.options.silenceHangoverMs
    ) {
      const valid =
        this.belowSince - this.speechSince >= this.options.minUtteranceMs;
      this.speechSince = null;
      this.belowSince = null;
      return valid ? 'end' : 'discard';
    }
    return null;
  }
}
