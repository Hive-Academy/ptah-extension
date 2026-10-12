# Batch 4 report: Seeded session generator and worked facts

Status: DONE. Both tasks implemented; scoped and project verification green.

## Task 4.1: Generator — DONE

Created `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\ground-truth\seeded-session-generator.ts` and `...\seeded-session-generator.spec.ts` (path prefix per plan-validation R1: `memory-skills`, not the design's `task-620`).

- **Determinism**: seeded PRNG is the Task 1.1 FNV-1a-seeded Mulberry32 (`metrics/bootstrap.ts:76-90`), kept in step by hand because that module keeps `seededRandom` private — import is impossible; the identical algorithm is local and cited. Clock is injected (`SeededSessionClock`, default `fixedDailyClock` = 10:00 UTC on the planting date); no `Date.now()`, no `Math.random`, no network, no model. Specs pin byte-identity across two runs for both session kinds (`toStrictEqual` + `jsonl`/`transcript` string equality).
- **Emissions**: per session, `jsonl` (SDK-shaped lines: `type`/`uuid`/`sessionId`/`timestamp`/`cwd` + `message {role, content:[text blocks]}`, the `SessionHistoryMessage` raw shape, `history.types.ts:16-46`) and the flattened `transcript` (`USER: …\n\nASSISTANT: …`, exactly `SdkTranscriptReaderAdapter.read`'s output, `sdk-transcript-reader.adapter.ts:37-39`). One session per planting, so update pairs `(v1 at t1, v2 at t2)` land in two separate dated sessions curated in date order (design :148); the spec pins that with F-005's pair.
- **Bait classes a–c** (design :119): the bank carries sediment lines (task ids, worktree paths, PR numbers, timeouts — the DO-NOT-EXTRACT classes, `agent-sdk/src/lib/curator-llm-adapter/extract-prompt.ts:54-66`), hypotheses stated then rebutted in-session, and assistant claims the user corrects. Every standard session rotates through the three classes (≥ 1 bait per session, asserted); the long session carries a sediment bait in window 1.
- **Long-session class** (design :120): built to plan 13 windows (> 8, "about 12"; 13 gives the clamp's elided middle a margin), `factPlacement: 'middle' | 'head'`: middle plants facts in windows 4..5 (inside 4..n−4), head plants the same facts in window 1 (the head-recall baseline). The window plan is reported per session (`plannedWindows`, `exceedsWindowLimit`, `factWindows`).
- **Product round-trip (the Assumption check)**: the spec asserts the reader contract line by line (uuid matches `LINE_UUID_PATTERN`, roles, no `isMeta`/`isSynthetic`, non-empty content, no `<task-notification>`, timestamps ascending; the flattening reproduces the generator's `transcript` byte for byte) and the curator's window/clamp decisions. **Constraint discovered:** the product's package entries (`@ptah-extension/memory-curator`, `@ptah-extension/agent-sdk`) pull the whole curator graph — whose `import * as vscode from 'vscode'` this project's Jest run cannot resolve (mcp-bench's jest config has no `vscode` mapper; `jest.config.ts` is outside this batch's files) — and `@nx/enforce-module-boundaries` rejects deep lib imports ("Projects cannot be imported by a relative or absolute path"). Following the `fts-or-query.ts` precedent, the spec mirrors `clamp-transcript.ts:125-202` and `transcript-windows.ts:308-341` from the pinned commit bf682eab8 (cited in the spec) and asserts: standard session → 1 window, no clamp; long session → 8 windows, clamp fired, middle facts strictly inside the elided middle (dropped), head-planted facts inside the kept head/first window. The later write-side suites exercise real product code through the spawned 620 host; the Assumption stays open at the host level for Batch 20+.
- Generator constants `CURATOR_WINDOW_CHARS`/`CURATOR_WINDOW_LIMIT` are kept in step by hand with `clamp-transcript.ts:48` / `transcript-windows.ts:55` (the same precedent `transcript-windows.ts` itself uses for `RECORD_SEPARATOR`).

## Task 4.2: Worked facts and distractor bank — DONE

Created `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\fixtures\memory-skills\memory-facts.v1.jsonl`, `...\distractors.v1.jsonl`; modified `...\MANIFEST.json`.

- **10 worked facts F-001..F-010**, every one git-cited (R-M1: `.ptah/specs` file:line at sourceCommit `bf682eab8` — the worktree HEAD, whose dates were read with `git log --diff-filter=A` — or a bare commit sha for the git replacement pairs `b2c21bfc8`/`dc416858e`/`7917b193a` from design :148). Categories cover the whole taxonomy: extraction (F-001, F-003, F-008, F-010), multi-session (F-002, citing both restatements across tasks 377 and 441), temporal (F-004, date-anchored question), update (F-005, F-006, the two design-cited replacement pairs), contradiction (F-007), abstention (F-009, a package version whose expected answer is abstention, with the `bait` field citing DO-NOT-EXTRACT class 3). No memory-row or pipeline text; no 620/471/473/563 measurement documents used as sources (design :659). `labeller = draft:lane`, `labelledAt` fixed at `2026-10-07T00:00:00.000Z` (U2 acceptance replaces it in Batch 25). Every record validates against `factSchema` (Task 3.1) — asserted in the spec, which also pins the seed ids, the draft labeller on the seed rows and the R-M1 citation form.
- **Distractor bank** (`distractors.v1.jsonl`, the Task 4.1 "data in Task 4.2 files"): 11 turn templates (opener/fact/filler-short/filler-long/closer × user/assistant, `{statement}` only on fact slots) + 7 baits (3 sediment, 2 rejected-hypothesis, 2 corrected-claim, each with its in-session rebuttal). All synthetic; no user data. Zod schemas (`distractorRecordSchema`, `turnTemplateRecordSchema`) live in the generator module and are validated by `parseDistractorBank` (a malformed line throws with its 1-based line number).
- **MANIFEST.json** rebuilt through the fixture-manifest helpers' exact format (schemaVersion 1, sha256 per file, 2-space JSON + trailing newline): `distractors.v1.jsonl` and `memory-facts.v1.jsonl` recorded. A full-directory re-hash (the `verifyManifest` check) reported clean.

## Risks and edge cases handled

- A long session accepts only 2..6 distinct plantings (facts must stay inside windows 4..n−4; duplicates rejected — update values belong in separate dated sessions); a bank missing any template slot or bait class is a named construction error; malformed planting dates are rejected as non-calendar dates (regex + `Date` round-trip, mirroring `label-schemas.ts`'s `isoDate` refine); an injected clock returning an invalid instant throws.
- No emitted line starts with `[tool_result`/`[tool_use ` (schema-enforced on bank text), so `compressToolNoise` is the identity on generator output and the spec's window arithmetic equals the product's — asserted.
- The spec's fixture assertions are written to survive later batches: fact count is pinned as "the F-001..F-010 seed is present and unique" (Batch 9 extends to ≥ 110) and the manifest check verifies the two Batch 4 files per-file rather than the whole directory (later batches add their own entries).
- O(n²) window accounting avoided: the builder tracks transcript length incrementally.
- No file under the real `~/.ptah` was read or written; no forbidden file (scorecard.types.ts, scorecard-writers.ts, host-launcher.ts, bench-host.entry.ts) or outside-batch source file was touched.

## Absolute file paths changed

- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\ground-truth\seeded-session-generator.ts` (created)
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\ground-truth\seeded-session-generator.spec.ts` (created)
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\fixtures\memory-skills\memory-facts.v1.jsonl` (created)
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\fixtures\memory-skills\distractors.v1.jsonl` (created)
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\fixtures\memory-skills\MANIFEST.json` (modified)
- `D:\projects\ptah-extension\.ptah\specs\TASK_2026_620_a13e\batch-4-report.md` (this report)

## Verification (output lines)

- `npx jest -c tools/mcp-bench/jest.config.ts ground-truth/seeded-session-generator.spec.ts --runInBand`:
  - `Test Suites: 1 passed, 1 total`
  - `Tests:       22 passed, 22 total` (byte-identity both kinds, reader contract, bait rules, window plan, middle-drop/head-keep, update pairs, manifest, 10 edge-case rejections)
- `npx prettier --check --ignore-unknown <the 3 changed code/manifest paths>`:
  - `All matched files use Prettier code style!` (`.jsonl` fixtures are ignored by `--ignore-unknown`, per the repo's R2/R8 convention)
- Full-directory manifest re-hash (the `verifyManifest` check): `verifyManifest: clean`
- `npx nx run-many -t typecheck,test,lint -p mcp-bench`:
  - `NX   Successfully ran targets typecheck, test, lint for project mcp-bench` (exit code 0; includes the whole mcp-bench suite, so other lanes' in-flight files were also green at this moment)
- `npx tsc --noEmit --project tools/mcp-bench/tsconfig.json` — no output, exit 0.

## Not done

- In-process product imports for the round-trip (see Task 4.1): blocked by the `vscode` resolution gap in mcp-bench's Jest config (not this batch's file to change) and the npm-scope boundary rule; handled with cited pinned-commit mirrors per repo precedent. The Assumption "generator output accepted by the product" therefore stands verified against the reader/clamp/window contracts and the mirrored decisions, and remains to be re-verified end-to-end through the spawned 620 host when Batch 20+ lands.
- Nothing else outstanding; no commit made (per instructions).

## Revise round 1

Defect fixed: the spec's ~100-line mirror of the product clamp/window logic proved nothing about the product. The round-trip now runs against the REAL product code.

Changes:

- `libs/backend/memory-curator/src/index.ts` — added exactly the required exports: `planCuratorWindows`, `CURATOR_MAX_WINDOWS` and the types `CuratorWindow` / `CuratorWindowPlan` from `./lib/curator-llm/transcript-windows` (`clampTranscript` and `CURATOR_TRANSCRIPT_MAX_CHARS` were already exported). Nothing else in that file changed.
- `tools/mcp-bench/src/memory-skills/ground-truth/seeded-session-generator.spec.ts` — deleted every mirror (`HEAD_SHARE`, `BOUNDARY_SEARCH_CHARS`, `RECORD_SEPARATOR`, `markerLength`, `headCut`, `tailCut`, `productClamp`, `productWindowCount`) and imported the real `clampTranscript` / `planCuratorWindows` / `CURATOR_MAX_WINDOWS` / `CURATOR_TRANSCRIPT_MAX_CHARS` from `@ptah-extension/memory-curator`, using the solved pattern from `baselines/retention-policies.spec.ts:1-8`: `import 'reflect-metadata';` and `jest.mock('vscode', () => ({}), { virtual: true });` above the barrel import. Header comment updated accordingly. Every existing test kept its intent, now asserted against the real product code:
  - standard session → `planCuratorWindows` returns exactly 1 window (`windowCount` 1), `clamped` null, `compressedChars === originalChars`, and `clampTranscript` reports `clamped: false`;
  - long middle placement → real planner: 8 windows (`CURATOR_MAX_WINDOWS`), `clamped.clamped` true, `droppedChars > 0`, compression identity, no window text contains either middle fact, and the real `clampTranscript(transcript, CURATOR_TRANSCRIPT_MAX_CHARS × CURATOR_MAX_WINDOWS)` kept text contains neither;
  - long head placement → real planner window 1 text contains both head-planted statements, and both sit inside the first window's character budget;
  - the removed "kept-in-step" check is restored as a REAL product pin: `CURATOR_WINDOW_CHARS === CURATOR_TRANSCRIPT_MAX_CHARS` and `CURATOR_WINDOW_LIMIT === CURATOR_MAX_WINDOWS` — if the product constants change, the spec now fails (the exact weakness the round cited).
- No generator or fixture change: all tests passed against the real product code first run, so no real generator bug was exposed. (One stale sentence remains in the generator's `CURATOR_WINDOW_CHARS` docblock — it still says the spec mirrors the decisions from the pinned commit; the revise instruction allowed no generator change without a real bug, so it is left and noted here.)

Verification (output lines):

- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/ground-truth --runInBand`:
  - `PASS mcp-bench tools/mcp-bench/src/memory-skills/ground-truth/seeded-session-generator.spec.ts`
  - `Test Suites: 3 passed, 3 total`
  - `Tests:       73 passed, 73 total`
- `npx eslint tools/mcp-bench/src/memory-skills/ground-truth/seeded-session-generator.spec.ts libs/backend/memory-curator/src/index.ts` — no output, `eslint exit: 0` (0 errors)
- `npx nx run-many -t typecheck -p mcp-bench @ptah-extension/memory-curator`:
  - `NX   Successfully ran target typecheck for 2 projects`
- `npx prettier --check --ignore-unknown <the 2 changed files>`:
  - `All matched files use Prettier code style!`
- No commit made (per instructions).
