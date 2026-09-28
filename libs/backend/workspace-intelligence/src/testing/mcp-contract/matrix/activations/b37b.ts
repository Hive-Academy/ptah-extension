/**
 * Batch 37b's activation fragment (Task 37b3.2, landed with Batch 31 on the
 * integration branch): `typeCheck:go`, the opt-in `go vet` checker (37a) as
 * the diagnostics provider runs it (37b1a/37b1b).
 *
 * The key is proved by `HONESTY_CHECKS['typeCheck:go']` in
 * `language-honesty.contract.spec.ts`, which runs the real `GoVetChecker`
 * (real consent store; the Go binary and the process runner injected, as Go
 * is not installed where the specs run) under the real
 * `LanguageAwareDiagnosticsProvider`:
 * - a vet run is never a type-check claim: `checks: 'syntax-only'` and
 *   `go:syntax-only`, never `type-check`;
 * - with consent off or stale nothing is spawned, `goVet` is `unchecked`
 *   with its reason, and the Go file is named in `notChecked`;
 * - findings vet places outside the workspace (`unmapped-findings`) are
 *   counted and their file is named in `notChecked`, never shown as clean.
 *
 * "type check" is the key's name, not a claim: go vet is the only checker
 * Ptah runs (User Decision 19), and it is disclosed as syntax-level.
 */

import type { ActivationFragment } from './activation-fragment';

export const ACTIVATION: ActivationFragment = {
  batch: 'b37b',
  keys: ['typeCheck:go'],
  approximations: {
    'typeCheck:go': ['syntax-only'],
  },
};
