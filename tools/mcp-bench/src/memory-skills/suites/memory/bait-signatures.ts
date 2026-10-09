/**
 * Provisional bait signatures for `mem.extraction` (benchmark-design.md 3.1,
 * FMR). `distractors.v1.jsonl` carries no key tokens for its baits, so these
 * definitions say when a stored row restates a bait. They are labelling
 * decisions, not product facts: they belong in the distractor bank and in the
 * `gt-matcher@v1` agreement sample (U3), and move there when Batch 25 freezes
 * the bank. `extraction.suite.spec.ts` pins that each signature matches its
 * own bait text and none matches the in-session rebuttal.
 */

import type { FactMatchDefinition } from '../../matching/fact-matcher';

/**
 * Bait signatures: a bait is "written as memory" when a stored row matches
 * ANY of its definitions (R-M4 matcher semantics). Provisional: they belong in
 * `distractors.v1.jsonl` and in the `gt-matcher@v1` sample (U3). A planted
 * bait without a signature is refused, so FMR can never pass vacuously.
 */
export const BAIT_SIGNATURES: Readonly<
  Record<string, readonly FactMatchDefinition[]>
> = {
  'D-001': [
    { keyTokens: [['task_2026_318', 'task-318']], forbiddenTokens: [] },
    { keyTokens: [['#493', 'pr 493']], forbiddenTokens: [] },
  ],
  'D-002': [
    { keyTokens: [['120000 ms', '120000ms']], forbiddenTokens: [] },
    { keyTokens: [['42 of 47']], forbiddenTokens: [] },
  ],
  'D-003': [
    {
      keyTokens: [['cli_delegation'], ['concurrent', 'cap']],
      forbiddenTokens: [],
    },
    { keyTokens: [['commitlint'], ['scope']], forbiddenTokens: [] },
  ],
  'D-004': [
    {
      keyTokens: [
        ['partial line', 'partial flush', 'mid-flush'],
        ['jsonl', 'corruption', 'truncat'],
      ],
      forbiddenTokens: ['disk', 'log rotation'],
    },
  ],
  'D-005': [
    {
      keyTokens: [['embedder'], ['twice', 'double embed', 'double-embed']],
      forbiddenTokens: ['watermark', 'exactly once'],
    },
  ],
  'D-006': [
    {
      keyTokens: [['eighth window', 'beyond the eighth', 'nothing beyond']],
      forbiddenTokens: ['elided', 'elide', 'middle, not the tail'],
    },
  ],
  'D-007': [
    {
      keyTokens: [['one file per workspace', 'single file', 'appended into']],
      forbiddenTokens: ['per session'],
    },
  ],
};
