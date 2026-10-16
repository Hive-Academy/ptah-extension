import { appliesLowConfidenceFallback } from '../reasons/confidence';
import type { FallbackCause } from '../reasons/compile-reasons';

/**
 * One validated choice (Requirements 2.6, 4.3, 11.4).
 *
 * An accepted answer names an offered label. Anything else is `bad-output`
 * and the raw text is dropped, so an invented lane or model id cannot
 * appear in the result. A reported confidence below the threshold keeps
 * the offered label as the proposal and falls back.
 */
export interface ChoiceValidation {
  /** Null when the offered label is accepted. */
  readonly cause: FallbackCause | null;
  /** Provider confidence when it is a finite number from 0 to 1. */
  readonly confidence: number | null;
  /**
   * The offered label when the model named one (`accepted` or
   * `low-confidence`). Null when the text was not an offered label, so an
   * invented id is not kept.
   */
  readonly choice: string | null;
  /**
   * Set only for `low-confidence`, and only to an offered label.
   * Invented ids are not copied here.
   */
  readonly proposal: {
    readonly option: string;
    readonly confidence: number | null;
  } | null;
}

export function validateChoiceAnswer(input: {
  readonly choice: string | undefined;
  readonly confidence: number | null;
  readonly offered: ReadonlySet<string>;
}): ChoiceValidation {
  const choice = input.choice;
  if (choice === undefined || !input.offered.has(choice)) {
    return {
      cause: 'bad-output',
      confidence: null,
      choice: null,
      proposal: null,
    };
  }
  const confidence = unitConfidence(input.confidence);
  if (confidence === 'invalid') {
    return {
      cause: 'bad-output',
      confidence: null,
      choice: null,
      proposal: null,
    };
  }
  if (appliesLowConfidenceFallback(confidence)) {
    return {
      cause: 'low-confidence',
      confidence,
      choice,
      proposal: { option: choice, confidence },
    };
  }
  return { cause: null, confidence, choice, proposal: null };
}

/** `null` when the provider reported none. `'invalid'` when the number is unusable. */
function unitConfidence(value: number | null): number | null | 'invalid' {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 1) return 'invalid';
  return value;
}
