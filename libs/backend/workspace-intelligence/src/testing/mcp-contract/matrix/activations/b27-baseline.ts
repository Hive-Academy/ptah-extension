/**
 * Batch 27's activation fragment — the harness's own baseline. Every
 * activating batch after this one (29b, 30, 30k, 31, 33, 34, 35, 36a-c, 37b)
 * adds its own sibling file here; none of them edit this one or
 * `required-keys.ts` (Lane plan, "`WIT/matrix/required-keys.ts` is written
 * once").
 *
 * This fragment activates:
 * - The ten literal `honesty:<tool>` keys (owner: Batch 27, the whole 22-26b
 *   honesty chain this harness pins).
 * - `syntaxDiagnostics:python|go|csharp` (Batch 25a's Tier-0 syntax-only
 *   diagnostics, the harness's baseline non-TS diagnostics coverage).
 */

import { HONESTY_KEYS } from '../required-keys';
import type { ActivationFragment } from './activation-fragment';

export const ACTIVATION: ActivationFragment = {
  batch: 'b27-baseline',
  keys: [
    ...HONESTY_KEYS,
    'syntaxDiagnostics:python',
    'syntaxDiagnostics:go',
    'syntaxDiagnostics:csharp',
  ],
  /**
   * Declared approximations per key (Batch 27 Task 27.2 quality requirement:
   * "100% recall with only declared approximations"). `syntax-only` names the
   * one approximation Batch 25a's Tier-0 diagnostics make explicit; the
   * honesty keys make none — each is a full contract, not a partial one.
   */
  approximations: {
    'syntaxDiagnostics:python': ['syntax-only'],
    'syntaxDiagnostics:go': ['syntax-only'],
    'syntaxDiagnostics:csharp': ['syntax-only'],
  },
};
