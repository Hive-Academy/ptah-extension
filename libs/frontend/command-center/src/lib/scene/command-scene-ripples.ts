import type { SceneInks, SceneVoiceSnapshot } from './command-scene-renderer';

const RIPPLE_LIFE_MS = 1400;
const MAX_RIPPLES = 4;
const MIN_LEVEL = 0.18;
const LISTENING_GAP_MS = 520;
const LISTENING_LEVEL_GAP_MS = 260;
const SPEAKING_GAP_MS = 640;
const SPEAKING_LEVEL_GAP_MS = 220;
const THINKING_GAP_MS = 2400;
const THINKING_STRENGTH = 0.35;
const START_OFFSET = 18;
const TRAVEL = 70;

interface Ripple {
  born: number;
  strength: number;
  ink: string;
}

export class VoiceRippleEmitter {
  private ripples: Ripple[] = [];
  private lastEmit = Number.NEGATIVE_INFINITY;
  private lastState: SceneVoiceSnapshot['voiceState'] | null = null;

  public get count(): number {
    return this.ripples.length;
  }

  public update(
    voice: SceneVoiceSnapshot,
    inks: SceneInks,
    reducedMotion: boolean,
    now: number,
  ): void {
    const state = voice.voiceState;
    if (
      reducedMotion ||
      (state !== 'listening' && state !== 'speaking' && state !== 'thinking')
    ) {
      this.clear();
      return;
    }
    if (now < this.lastEmit) this.clear();
    if (state !== this.lastState) this.clear();
    this.lastState = state;
    this.ripples = this.ripples.filter(
      (ripple) => now - ripple.born < RIPPLE_LIFE_MS,
    );

    if (state === 'thinking') {
      if (now - this.lastEmit >= THINKING_GAP_MS) {
        this.emit(now, THINKING_STRENGTH, inks.run);
      }
    } else {
      const rawLevel =
        state === 'listening' ? voice.inputLevel : voice.outputLevel;
      const level = Number.isFinite(rawLevel)
        ? Math.max(0, Math.min(1, rawLevel))
        : 0;
      const gap =
        state === 'listening'
          ? LISTENING_GAP_MS - level * LISTENING_LEVEL_GAP_MS
          : SPEAKING_GAP_MS - level * SPEAKING_LEVEL_GAP_MS;
      if (level >= MIN_LEVEL && now - this.lastEmit >= gap) {
        this.emit(now, level, state === 'listening' ? inks.done : inks.need);
      }
    }
    while (this.ripples.length > MAX_RIPPLES) this.ripples.shift();
  }

  public draw(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    rootRadius: number,
    now: number,
  ): void {
    const previousLineWidth = context.lineWidth;
    context.setLineDash([]);
    for (const ripple of this.ripples) {
      const progress = Math.max(
        0,
        Math.min(1, (now - ripple.born) / RIPPLE_LIFE_MS),
      );
      const easeOut = 1 - (1 - progress) ** 2;
      context.strokeStyle = ripple.ink;
      context.globalAlpha =
        (1 - progress) ** 1.6 * (0.10 + 0.30 * ripple.strength);
      context.lineWidth = 1 + 1.2 * ripple.strength;
      context.beginPath();
      context.arc(
        x,
        y,
        rootRadius +
          START_OFFSET +
          easeOut * TRAVEL * (0.6 + 0.4 * ripple.strength),
        0,
        Math.PI * 2,
      );
      context.stroke();
    }
    context.globalAlpha = 1;
    context.lineWidth = previousLineWidth;
    context.setLineDash([]);
  }

  public clear(): void {
    if (this.ripples.length) this.ripples = [];
    this.lastEmit = Number.NEGATIVE_INFINITY;
    this.lastState = null;
  }

  private emit(now: number, strength: number, ink: string): void {
    this.ripples.push({ born: now, strength, ink });
    this.lastEmit = now;
  }
}
