# Batch 3 report: Ground-truth label schemas and fixture manifest

Status: DONE. Both tasks implemented, verified with typecheck, lint, tests and prettier.

## Task 3.1: Label schemas — DONE

Created `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\ground-truth\label-schemas.ts` and `...\label-schemas.spec.ts` (path prefix per plan-validation R1: `memory-skills` paths, not the design's `task-620`).

Schemas exported (all `z.strictObject`, so unknown keys are rejected — this is what makes a `note` on a committed rubric row a parse failure):

- `factSchema` — design §10.1 record: `id, source, sourceCommit, date, category, statement, keyTokens[][], forbiddenTokens[], question, expectedAnswer, scenarioTags[], bait?, labeller, labelledAt`. `date` is a real-calendar `YYYY-MM-DD` (regex + round-trip refine), `sourceCommit` a lowercase sha (7–40 hex, the repo uses 9-char shas), `keyTokens` is a non-empty array of non-empty alternate-sets (R-M4 "each set lists accepted alternates").
- `mergePairSchema` — `gt-merge@v1` pair: `kind: 'should-merge' | 'should-not-merge'`, `factIds` `[left, right]`, per-side `{session, subject, statement}`, plus citation/labeller metadata. superRefine: a should-merge pair must cite one fact on both sides; a should-not-merge pair must cite two different facts (design §3.2: "the same fact in two sessions" vs "a different fact").
- `updateCaseSchema` — design §3.3: `v1 {value, at}`, `v2 {value, at}`, mandatory `bait` (v′), `slot`, `question`, `expectedAnswer`. superRefine: v1 ≠ v2 values, `v1.at < v2.at` ("curated in date order"), bait distinct from both values.
- `temporalCaseSchema` — date-anchored question; superRefine: the question must contain the case `date`.
- `abstentionCaseSchema` — `baitKind: 'sediment' | 'rejected-hypothesis' | 'corrected-claim'` (the three bait classes, design §3.1) + `question` + citation metadata.
- `matcherSampleRowSchema` — `gt-matcher@v1` (row, fact) pair: `factId`, the row text the matcher reads (`subject`, `content`, `chunk` — chunk may be empty), `humanMatch`, labeller metadata.
- `realSessionLabelSchema` — exactly `{opaqueId, sha256, lineRefs}` (design §10.2: the repo holds only this). `sha256` is a 64-char lowercase hex digest; `lineRefs` are positive 1-based JSONL line numbers, superRefined to unique ascending.
- `rubricScoreRowSchema` (committed) — `opaqueId, raterId, c1..c8, total, pass, ratedAt`, **no `note` column** (R2). superRefine: `total` must be the sum of c1..c8 and `pass` must equal the 471 rule (total ≥ 64/80 and no criterion < 6).
- `privateRubricScoreRowSchema` — the bench-data-dir twin; identical plus optional `note`. This is the "separate private schema" the batch names; it still enforces the rubric integrity rules.
- `adjudicationRowSchema` — `skill-adjudication.v1.csv` row: `opaqueId, adjudicatorId, c1..c8, total, pass, triggers, decidedAt`; `triggers` are `['pass-fail-differs' | 'totals-differ']` (min 1, max 2, no repeats — both disagreement causes from §4.2 can apply); same rubric integrity superRefine.
- `knownFailureEntrySchema` — design §7: `direction: 'higher-is-better' | 'lower-is-better'` mandatory, `tolerance` finite ≥ 0 defaulting to 0, `toleranceReason` required when `tolerance ≠ 0`, plus `suiteId, metric, recordedValue, ledgerRow, since`.
- Shared primitives also exported: `factCategorySchema`, `abstentionBaitKindSchema`, `adjudicationTriggerSchema`, `knownFailureDirectionSchema`, `sha256HexSchema` (reused by Task 3.2).

Spec evidence (all inside the passing `label-schemas.spec.ts` suite): "rejects an entry without a direction" and "rejects a note field on the committed row" cover the batch's two named assertions; further rejection tests cover impossible calendar dates, bad commit shas, unordered `lineRefs`, `total ≠ Σc`, `pass` contradicting the rule, repeated triggers, non-zero tolerance without reason, and strictness (unknown keys) for fact/matcher/known-failure rows. All fixture examples are synthetic (fake ids like `gt-m-001`, fake sha `e94159db7`, fake port numbers); no user data.

## Task 3.2: Fixture manifest hasher — DONE

Created `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\ground-truth\fixture-manifest.ts` and `...\fixture-manifest.spec.ts`, plus the initial manifest `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\fixtures\memory-skills\MANIFEST.json`.

- `canonicalJson(value)` — JSON with object keys sorted at every depth, no whitespace, `undefined` members dropped.
- `canonicalJsonlHash(records)` — the gt `version` hash: every record canonicalized and LF-terminated ("sorted keys, LF"). Spec pins the digest to a hand-built `sha256('{"a":2,"b":1}\n{"z":"x"}\n')` and proves key-order insensitivity.
- `sha256File(path)` — sha256 of raw file bytes (used by the manifest and by later `{opaqueId, sha256}` labels).
- `buildManifest(dir)` — recursive walk; relative `/`-separated sorted paths; root `MANIFEST.json` excluded; non-file/non-dir entries throw (no silent skip). Returns `{schemaVersion: 1, files: {relPath: sha256}}`.
- `readManifest(dir)` / `writeManifest(dir, manifest)` — zod-validated; written as 2-space JSON + trailing newline, following the `writeScorecardJson` precedent.
- `verifyManifest(dir)` — returns `{ok, mismatches}` with per-file `{relPath, kind: 'missing' | 'hash-mismatch' | 'unexpected', expected, actual}`; `ok === (mismatches.length === 0)`.
- Initial committed `MANIFEST.json`: `{"schemaVersion": 1, "files": {}}` — after this batch no fixture file exists besides the manifest itself, so the `files` map is empty (exactly the batch's stated initial state). Later batches (9/11/25) extend it through `writeManifest`.
- zod 4 note: `z.record(value)` no longer compiles (TS2554, 2–3 args required); the manifest uses `z.record(z.string().min(1), sha256HexSchema)`.

## Absolute file paths changed (all created; nothing modified outside the batch)

1. `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\ground-truth\label-schemas.ts`
2. `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\ground-truth\label-schemas.spec.ts`
3. `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\ground-truth\fixture-manifest.ts`
4. `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\ground-truth\fixture-manifest.spec.ts`
5. `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\fixtures\memory-skills\MANIFEST.json`

Prettier `--write` was run once on the four `.ts` files (formatting only, before verification). No other file was touched: not `scorecard.types.ts`, `scorecard-writers.ts`, `host-launcher.ts`, `bench-host.entry.ts`, and not the other lanes' in-flight files (`src/memory-skills/metrics/`, `doubles/`, `labelling/`). Nothing under the real `~/.ptah` was read or written; specs use `os.tmpdir()` scratch dirs only.

## Risks / edge cases handled

- **R2 (committed rows carry no notes; stratum stays out of the repo)** — committed rubric row is strict and rejects a `note` key (spec: "rejects a note field on the committed row"); the private twin is the only schema with `note`. Adjudication row is also note-free and strict.
- **R8 (prettier fails on `.jsonl`)** — verification used `--ignore-unknown` throughout; JSONL record validity lives in the label schemas (this batch) rather than in prettier.
- **"CSV hash ≠ manifest ⇒ fail"** — spec "fails when a CSV hash differs from the manifest" tampers `skill-labels.v1.csv`, asserts `ok: false` and the exact `hash-mismatch` entry, then restores and re-verifies clean. The plan-level edge case "Rater CSV hash ≠ MANIFEST.json ⇒ suite fails" is served by `verifyManifest().ok === false` for any listed file.
- **Missing / unexpected files** — spec covers `kind: 'missing'` (recorded file deleted) and `kind: 'unexpected'` (present file unrecorded); both restore to green afterwards.
- **Committed-fixture drift** — the spec re-reads the committed `fixtures/memory-skills/MANIFEST.json` and asserts every listed file still hashes to its recorded value (subset check, robust to later batches extending the map in their own commits).
- **No user data in committed fixtures** — MANIFEST lists nothing; all spec examples are synthetic.

## Verification output (tailed)

`npx prettier --check --ignore-unknown <the 5 files>` → `All matched files use Prettier code style!`

`npx nx run-many -t typecheck,test,lint -p mcp-bench` (2nd run, after fixes):
```
√  nx run mcp-bench:typecheck
√  nx run mcp-bench:lint
PASS mcp-bench tools/mcp-bench/src/memory-skills/ground-truth/label-schemas.spec.ts (46.032 s)
PASS mcp-bench tools/mcp-bench/src/memory-skills/ground-truth/fixture-manifest.spec.ts (48.237 s)
FAIL mcp-bench tools/mcp-bench/src/corpus/corpus.spec.ts (43.391 s)   [3 jest 5000 ms timeouts]
Test Suites: 1 failed, 12 passed, 13 total
Tests:       3 failed, 151 passed, 154 total
```
The only failing suite is `src/corpus/corpus.spec.ts`, a 619-owned file outside this batch's file list; it fails only at default parallelism while three lanes share this machine. Attribution run `npx nx run mcp-bench:test --testPathPatterns=corpus --runInBand`:
```
PASS mcp-bench tools/mcp-bench/src/corpus/corpus.spec.ts (22.89 s)
√ uses a detached pinned worktree and removes it after a disposable lifecycle copy (3031 ms)
√ preserves a git add error and deletes an unregistered temporary directory (2746 ms)
√ removes only registered stale corpus worktrees at startup (3855 ms)
```
i.e. pre-existing load flakiness (git-worktree tests at the 5 s jest default), not a regression from this batch; not fixed here because the file is outside the batch's file list.

## Not done / notes for the team leader

- `known-failures.v1.json` itself is not created (owned by later batches); Task 3.1 ships only the entry schema, as specified.
- `knownFailureEntry.since` is a non-empty string (commit or ISO date that first recorded the entry) — the design gives no tighter format; tighten when Batch 13/24 writes real entries if needed.
- The committed-fixture spec deliberately does not assert `files: {}` — later fixture batches (9/11/25) extend the manifest, and the spec checks manifest↔disk consistency instead of a frozen snapshot of the map.
- Consider raising the corpus spec's jest timeout (619-owned) if full-suite parallel runs keep flaking under multi-lane load.
