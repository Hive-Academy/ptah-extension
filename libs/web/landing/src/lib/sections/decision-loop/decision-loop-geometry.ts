/**
 * Stages, coordinates and paths of the decision loop (1080 x 470 SVG space).
 * The six labels come from landing-copy.md S3. A stage may carry one piece of
 * the real settings vocabulary it runs on (decision-model-row,
 * host-routing-setting): the label text of that control, nothing invented.
 */
export interface DecisionLoopCue {
  readonly kind: 'badge' | 'model' | 'toggle';
  readonly text: string;
  /** The Decision model row's state badge; drawn only for `model`. */
  readonly state?: string;
}

export interface DecisionLoopStage {
  readonly id: string;
  readonly number: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly cue?: DecisionLoopCue;
}

export const DECISION_LOOP_STAGES: readonly DecisionLoopStage[] = [
  {
    id: 'classify',
    number: '01',
    label: 'Classify type and depth',
    x: 210,
    y: 115,
    cue: { kind: 'badge', text: 'Decision model' },
  },
  {
    id: 'fast-model',
    number: '02',
    label: 'Fast model, 3-second abort',
    x: 540,
    y: 115,
    cue: { kind: 'model', text: 'Ollama', state: 'ready' },
  },
  { id: 'blend-evidence', number: '03', label: 'Blend 90-day evidence', x: 870, y: 115 },
  { id: 'drop-same-family', number: '04', label: 'Drop same-family review', x: 870, y: 355 },
  {
    id: 'routing-reminder',
    number: '05',
    label: 'Routing reminder in chat',
    x: 540,
    y: 355,
    cue: { kind: 'toggle', text: 'Routing suggestions' },
  },
  { id: 'check-files', number: '06', label: 'Check files, feed back', x: 210, y: 355 },
] as const;

export const STAGE_THRESHOLDS = [0.06, 0.2, 0.36, 0.52, 0.68, 0.82] as const;

export function stageReached(progress: number, index: number): boolean {
  return progress >= (STAGE_THRESHOLDS[index] ?? 0);
}

export const LOOP_PATHS = {
  perimeter: 'M 210 115 H 870 A 120 120 0 0 1 870 355 H 210 A 120 120 0 0 1 210 115 Z',
  leftClosure: 'M 210 355 A 120 120 0 0 1 210 115',
  forward: 'M 210 115 H 870 A 120 120 0 0 1 870 355 H 210',
  feedback: 'M 210 355 C 360 235, 720 235, 870 115',
} as const;

/** Orb position along the forward track, then the 06 -> 03 feedback curve. */
export function orbCoordinates(progress: number): { x: number; y: number } {
  const clamped = Math.max(0, Math.min(1, progress));
  if (clamped <= 0.3) {
    const t = clamped / 0.3;
    return { x: Math.round(210 + t * 660), y: 115 };
  }
  if (clamped <= 0.48) {
    const t = (clamped - 0.3) / 0.18;
    const angle = -Math.PI / 2 + t * Math.PI;
    return {
      x: Math.round(870 + Math.cos(angle) * 120),
      y: Math.round(235 + Math.sin(angle) * 120),
    };
  }
  if (clamped <= 0.78) {
    const t = (clamped - 0.48) / 0.3;
    return { x: Math.round(870 - t * 660), y: 355 };
  }
  const t = (clamped - 0.78) / 0.22;
  const inv = 1 - t;
  const x = inv * inv * inv * 210 + 3 * inv * inv * t * 360 + 3 * inv * t * t * 720 + t * t * t * 870;
  const y = inv * inv * inv * 355 + 3 * inv * inv * t * 235 + 3 * inv * t * t * 235 + t * t * t * 115;
  return { x: Math.round(x), y: Math.round(y) };
}
