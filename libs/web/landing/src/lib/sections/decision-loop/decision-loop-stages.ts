/** One step of the decision loop. The six labels come from landing-copy.md S3. */
export interface DecisionLoopStage {
  readonly id: string;
  readonly number: string;
  readonly label: string;
}

export const DECISION_LOOP_STAGES: readonly DecisionLoopStage[] = [
  { id: 'classify', number: '01', label: 'Classify type and depth' },
  { id: 'fast-model', number: '02', label: 'Fast model, 3-second abort' },
  { id: 'blend-evidence', number: '03', label: 'Blend 90-day evidence' },
  { id: 'drop-same-family', number: '04', label: 'Drop same-family review' },
  { id: 'routing-reminder', number: '05', label: 'Routing reminder in chat' },
  { id: 'check-files', number: '06', label: 'Check files, feed back' },
] as const;

/** Loop progress at which each step's label comes in, top-down. */
export const STAGE_THRESHOLDS = [0.06, 0.2, 0.36, 0.52, 0.68, 0.82] as const;

export function stageReached(progress: number, index: number): boolean {
  return progress >= (STAGE_THRESHOLDS[index] ?? 0);
}
