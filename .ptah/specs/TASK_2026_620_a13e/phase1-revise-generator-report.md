# Phase 1 revise round 1 — seeded-session generator (TASK_2026_620_a13e)

Fixes findings 4, 10, 11 and 12 of `code-logic-review-phase1-lanes.md` in
`tools/mcp-bench/src/memory-skills/ground-truth/seeded-session-generator.ts` and
its `.spec.ts`. The generator now imports the product barrel
(`@ptah-extension/memory-curator`) at runtime — the spec already loads it under
Jest with the `reflect-metadata` + virtual `vscode` stub pattern
(`retention-policies.spec.ts:1-8`). Fixtures and `MANIFEST.json` are unchanged
(no fixture content changed, so no manifest rebuild was needed). Determinism
kept: two runs still produce identical bytes (spec-pinned). No commit made.

## Finding 4 (major) — middle placements the clamp does not drop

- Change: the hard-coded `maxPlantings = 13 − 8 + 1 = 6` pre-check is deleted.
  The cap is now **derived from the clamp** (`seeded-session-generator.ts`):
  - `maxMiddlePlantings()` at `:340` — derived, not hard-coded: the clamp
    budget is `CURATOR_WINDOW_LIMIT` windows, it keeps
    `ceil(CLAMP_HEAD_SHARE × budget)` head windows and the rest as tail
    (`CLAMP_HEAD_SHARE = 0.25` cited to `clamp-transcript.ts:54`, kept in step
    by hand because the product does not export it), and the build always
    fills at least `LONG_SESSION_WINDOWS` windows, so the last
    guaranteed-dropped window is `LONG_SESSION_WINDOWS − tail` → cap = 4.
  - `MiddleFactSurvivesClampError` at `:323` — the typed error.
  - `assertClampPlacement()` at `:537` (called from `generateLongSeededSession`)
    runs the **real** `clampTranscript` (`:542`) on the finished transcript:
    more middle plantings than the derived cap → typed error; any
    middle-planted statement that survives the clamp → typed error. The
    symmetric head check (a head-planted fact the clamp drops would silently
    break the head-recall baseline) throws a plain generation error.
- New spec: `drops every middle fact at the clamp-derived maximum`
  (`.spec.ts:372`) plants exactly `maxMiddlePlantings()` facts and asserts the
  real product clamp (`clampTranscript` + every `planCuratorWindows` window)
  drops every statement; `rejects more middle plantings than the
  clamp-derived cap` (`:491`) plants cap+1 and expects
  `MiddleFactSurvivesClampError`.
- Note: the build's per-window fill now targets a full window of **filler**
  characters (`fillLongWindow()`, `:513`), so fact turns ride on top of the
  fill without displacing filler draws — which finding 11's controlled
  comparison requires (see below). The fact windows still sit at the head of
  their target windows (4, 5, …), strictly inside the clamp's elided middle.

## Finding 10 — window accounting omitted the role prefix

- Change: `TurnBuilder.turn` now counts the full record — role prefix
  included — in the running length (`seeded-session-generator.ts:835-840`),
  so the tracked length equals the joined transcript's length. `build()`
  computes `plannedWindows` from the finished transcript
  (`Math.ceil(transcript.length / CURATOR_WINDOW_CHARS)`, `:876`) for both
  session kinds; the hard-coded `LONG_SESSION_WINDOWS` report and the
  `currentWindowOf` helper are gone. `LONG_SESSION_WINDOWS` remains only as
  the build-size target.
- New spec: `reports a window plan past the product limit…` now asserts
  `plannedWindows === Math.ceil(transcript.length / CURATOR_TRANSCRIPT_MAX_CHARS)`
  (`.spec.ts:309`, the product's own figure), plus the old bounds (≥ 12,
  > `CURATOR_WINDOW_LIMIT`, facts within 4..n−4, transcript fills ≥ 13
  windows).

## Finding 11 — session id and PRNG streams

- Change: the long-session id now includes the placement —
  `sessionIdOf(seed, identity)` (`:734`) is called with
  `long:<factId>:<date>:<factPlacement>`, so head and middle variants get
  different session ids and (because per-turn uuids derive from
  `${sessionId}:${turnIndex}`) different uuids. The PRNG streams are
  placement-independent: `contentRandom` (`:437`, opener/bait/fillers/closers)
  and `factRandom` (`:440`, fact templates) carry no placement, and the
  filler-only fill target (finding 4 note above) means fact turns never
  displace a filler draw — the two variants of the same plantings differ only
  in where the fact turns sit.
- New spec: `separates the head and middle variants by id with identical
  filler` (`.spec.ts:396`): different session ids, different first-turn
  uuids, identical non-fact turn texts (opener, bait, fillers, closers),
  identical fact turn texts, and the fact turns at different positions.

## Finding 12 — vacuous date validation and the stale barrel comment

- Change: `validatePlanting` round-trip compares the parsed instant like
  `label-schemas.ts:18-22` (`seeded-session-generator.ts:601`):
  `Date.parse(iso)` must be non-NaN **and** `new Date(parsed).toISOString()`
  must equal the input — `2026-02-31` (V8 rolls to March 3) is now rejected.
  The stale comment claiming the barrel cannot load under Jest is deleted:
  `CURATOR_WINDOW_CHARS` (`:54`) and `CURATOR_WINDOW_LIMIT` are now the
  product's own imported figures, so the two can never drift (the spec's
  kept-in-step pins still document the contract).
- New spec: `rejects malformed plantings` adds the `2026-02-31` case
  (`.spec.ts:540`).

## Other

- `parseDistractorBank`'s rethrow now attaches `{ cause: error }` — clears the
  one `preserve-caught-error` warning eslint reported on the file.
- The reader-contract, byte-identity, bait, manifest and fixture tests are
  unchanged and still pass; the product round-trip still runs against the
  real `planCuratorWindows` / `clampTranscript`.

## Verification (output lines)

- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/ground-truth --runInBand`:
  - `PASS mcp-bench tools/mcp-bench/src/memory-skills/ground-truth/seeded-session-generator.spec.ts`
  - `Test Suites: 3 passed, 3 total`
  - `Tests:       75 passed, 75 total`
- `npx eslint tools/mcp-bench/src/memory-skills/ground-truth/seeded-session-generator.ts tools/mcp-bench/src/memory-skills/ground-truth/seeded-session-generator.spec.ts`:
  - no output, `eslint exit: 0` (0 errors, 0 warnings)
- `npx nx run mcp-bench:typecheck` (foreground):
  - ` NX   Successfully ran target typecheck for project mcp-bench`
- `npx prettier --check --ignore-unknown <the 2 changed files>`:
  - `All matched files use Prettier code style!`

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\ground-truth\seeded-session-generator.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\ground-truth\seeded-session-generator.spec.ts`
- `D:\projects\ptah-extension\.ptah\specs\TASK_2026_620_a13e\phase1-revise-generator-report.md` (this report)

## Not done

- Nothing outstanding for findings 4, 10, 11, 12. No fixture or MANIFEST
  change was needed. No commit made (per instructions).
