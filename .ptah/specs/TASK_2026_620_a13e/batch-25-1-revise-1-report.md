# B25.1 REVISE 1 report

## Fixture relabelling

| Fact  | Old → new tokens                                                                | Why                                                              |
| ----- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| F-001 | `auto-promot, promot` → `auto-promote, promote, promotes, promoting, promotion` | Full word-form alternatives match “promoting”.                   |
| F-008 | add `not with subagents`                                                        | Matches the statement’s negated executor wording.                |
| F-016 | `mangle` → `mangling, mangle`; `562` → `562-owned`                              | Matches the stated morphology and compound.                      |
| F-017 | `hash` → `hash, hashing`                                                        | Matches “hashing”.                                               |
| F-019 | `sequential` → `sequential, sequentially`; `withslugl` → `withsluglock`         | Matches the adverb and corrected identifier.                     |
| F-029 | forbidden `a branch per defect` → `one branch per defect`                       | Preserves the rejected variant without forbidding the statement. |
| F-050 | forbidden `isDirectAnthropic` → `direct Anthropic path`                         | Rejects the direct-provider alternative without self-forbidding. |
| F-060 | add `two approved prs`                                                          | Matches “two approved PRs”.                                      |
| F-061 | `disclos` → `disclose, disclosed, disclosure`                                   | Full word forms match “disclosed”.                               |
| F-076 | `warn` → `warn, warns, warning`                                                 | Full word forms match “warns”.                                   |
| F-079 | `deferred` → `deferred, defers`                                                 | Matches “defers”.                                                |
| F-083 | `613` → `task_2026_613`                                                         | Underscore-aware token matches the statement identifier.         |
| F-084 | `533` → `task_2026_533`                                                         | Same identifier-boundary correction.                             |
| F-085 | `585` → `task_2026_585`                                                         | Same identifier-boundary correction.                             |
| F-086 | `588, 578` → `task_2026_588, task_2026_578`                                     | Same identifier-boundary correction.                             |
| F-087 | `595` → `task_2026_595`                                                         | Same identifier-boundary correction.                             |
| F-088 | `377, 441` → `task_2026_377, task_2026_441`                                     | Same identifier-boundary correction.                             |
| F-089 | `562, 561` → `task_2026_562, task_2026_561`                                     | Same identifier-boundary correction.                             |
| F-090 | `511` → `task_2026_511`                                                         | Same identifier-boundary correction.                             |
| F-096 | `304` → `task_2026_304`                                                         | Same identifier-boundary correction.                             |
| F-100 | `resume` → `resume, resumed`                                                    | Matches “resumed”.                                               |
| F-129 | `597` → `task_2026_597`                                                         | Same identifier-boundary correction.                             |

Independent reproduction of `normalizeFactText` plus `containsToken` reports `durable 127 bad []` after relabelling.

## Defect fixes

| Defect   | Fix                                                                                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | `memory-facts.v1.jsonl`: all 22 label-only corrections above; `fixture-manifest.spec.ts`: durable self-match invariant.                   |
| 2        | `read-side.suite.spec.ts:277`: unanswerable is zero and denominator is derived from the compact case count.                               |
| 3        | `read-side.suite.spec.ts:399`: fixture DB row/session now use F-001; F-001 passes under its own workspace key and F-008 remains negative. |
| 4        | `read-side.suite.spec.ts:318`: exact last-N numerator/denominator restored as `9/9`.                                                      |
| 5        | `extraction.suite.spec.ts:345`: long-head equals independently planned `verbatimRecallFor`.                                               |
| 6        | `seeded-session-generator.spec.ts:99`: IDs are unique and equal `F-001..F-130` minus `F-038`.                                             |
| manifest | `MANIFEST.json`: raw-byte SHA-256 recomputed as `5818ce75d416f13c6c43b87a8ac736d2c531d508e4cc4c7f005db0b775485d23`.                       |

## Checks

| Command                                                                                                                                                                                                                                                                                                      | Result                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/ground-truth/fixture-manifest.spec.ts tools/mcp-bench/src/memory-skills/ground-truth/seeded-session-generator.spec.ts tools/mcp-bench/src/memory-skills/suites/memory/read-side.suite.spec.ts --coverage=false --maxWorkers=2` | PASS: 3 suites, 47 tests.                     |
| `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/suites/memory/extraction.suite.spec.ts --coverage=false --maxWorkers=2`                                                                                                                                                        | No final result was available before handoff. |
| `npx tsc -p tools/mcp-bench/tsconfig.json --noEmit`                                                                                                                                                                                                                                                          | No final result was available before handoff. |

Prettier passes for every changed file with an inferred parser. `memory-facts.v1.jsonl` has no inferred Prettier parser; raw JSONL integrity was independently parsed and checked.

The remaining eight mandated Jest specs were not completed before handoff; they must not be treated as passed.

## Decisions

| Decision                                         | Options                         | Evidence                                                                                          | Reversible             |
| ------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------- |
| Relabel instead of change matching or statements | matcher/statements/labels       | Objective requires frozen statements and matcher semantics; all durable self-match independently. | Yes, label-only edits. |
| Use full lexical alternatives                    | stems/full words                | JS word boundaries do not match stems inside inflections.                                         | Yes.                   |
| Use full task identifiers                        | bare numbers/identifier strings | `_` is a JS word character, so bare numbers do not match `TASK_2026_*`.                           | Yes.                   |

## Round 1b — longHead 126/127

The missing long-head fact was **F-029**. Its durable statement self-matched,
but extraction writes the fixture question as the row subject. F-029's question
contains the former forbidden phrase `one branch per defect`; because the
matcher evaluates subject and content together, that phrase rejected F-029's
otherwise correct extracted row. The independent content-only self-match
invariant therefore remained true while long-head recall was 126/127.

`tools/mcp-bench/fixtures/memory-skills/memory-facts.v1.jsonl:29` now forbids
`separate branches per defect`, the equivalent rejected variant that is absent
from both the durable statement and the extractor-supplied question. The raw-byte
fixture SHA-256 in `tools/mcp-bench/fixtures/memory-skills/MANIFEST.json:6` is
updated to `88813d569988bbca6a1fca4afbe380f8d6f803103947280bcb106aeddf94003b`.

### Round 1b checks

| Command | Result |
| --- | --- |
| `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/suites/memory/extraction.suite.spec.ts --coverage=false --maxWorkers=2 > %TEMP%\\b251r1b-jest.txt 2>&1` | PASS: 1 suite, 10 tests. |
| `npx prettier --check tools/mcp-bench/fixtures/memory-skills/MANIFEST.json tools/mcp-bench/src/memory-skills/suites/memory/extraction.suite.spec.ts .ptah/specs/TASK_2026_620_a13e/batch-25-1-revise-1-report.md` | PASS. `memory-facts.v1.jsonl` has no inferred Prettier parser. |
| `npx tsc -p tools/mcp-bench/tsconfig.json --noEmit` | No completed result captured in this lane. |

The fixture-dependent `fixture-manifest`, `seeded-session-generator`, `read-side`, and `retention` Jest specs were not rerun in this round before the tool-call budget; no result is claimed for them.

## Orchestrator verification and follow-ups

- Re-run by the orchestrator on the final working tree: 11 fixture suites / 150 tests pass; `tsc` clean;
  Prettier clean; no BOM; real matcher: 0 of 129 facts fail with `{subject: question, content: statement}`.
- Review: Glm r1 REVISE 5/10 (`code-logic-review-batch-25-1.md`) → Glm r2 APPROVED 9/10
  (`code-logic-review-batch-25-1-r2.md`).
- Follow-ups for B26 (minor, from r2): (1) the self-match invariant in `fixture-manifest.spec.ts:158-159`
  should also use the question as the row subject; (2) stale docblock at
  `extraction.suite.spec.ts:85-91` still names F-005.
