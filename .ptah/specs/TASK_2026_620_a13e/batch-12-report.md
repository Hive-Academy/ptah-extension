# Batch 12 report — memory/skills suite kinds and deterministic projection

Executor: backend-developer (fallback executor; CLI lane not used).
Branch/worktree: `feat/task-620-memory-skills-bench` at
`D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench`
(based on 619 `d716e0e8f`, which carries Batch 4b's scorecard core and 4c's host
helpers — the batch's "rebase first" precondition was already met).

## File placement (deviation from the batch text, forced by the 619 boundary)

`batches.md` Task 12.1/12.2 list the files as `...\scorecard\*.ts`. They were
written to `tools/mcp-bench/src/memory-skills/` instead:

- context.md "619 answers to design §6.6" item 3: "No separate project. Code in
  `tools/mcp-bench/src/memory-skills/`".
- The task instruction: implement only in `tools/mcp-bench/src/memory-skills/`
  and never edit or add files under 619's `tools/mcp-bench/src/scorecard/`.
- Batch 12 verification itself requires
  `git diff --exit-code <4b SHA> -- tools/mcp-bench/src/scorecard/` to be clean,
  which adding files there would break.

Everything else in the batch text is followed as written.

## Task 12.1 — Register memory/skills suite kinds

What was done:

- `tools/mcp-bench/src/memory-skills/memory-skills-suite-kinds.ts` (new): the
  five kinds `curation`, `liveness`, `rubric`, `funnel`, `outcome` as
  zod 4.6.5 schemas written against 619's shipped core (benchmark-design.md
  §6.3 sketches, lines 394-475), with one Markdown renderer per kind in the
  shape of 619's `retrieval` renderer (metric table + cost rows + verdict row).
- Registered through 619's registry API — never by editing 619 files:
  `export function registerMemorySkillsSuiteKinds(registry)` registers all five
  via `registry.registerSuiteKind(kind, zod, renderMarkdown?)`, and the module
  self-registers into `defaultSuiteKindRegistry` on import (the same pattern as
  619's `retrieval-suite-kind.ts`, imported by `scorecard.types.ts`).
- Sketch adjustments, each traceable to the shipped core or a stated rule:
  - `funnelDetails` has **no `projectionSha256`** (R7): 619's core owns it on
    the suite (`scorecard.types.ts:56-59`). All details schemas are
    `z.strictObject`, so a stray `projectionSha256` in details is *rejected*,
    not stripped — proven in the spec (details-level and full-scorecard-level).
  - zod 4 two-argument `z.record(z.string(), ...)` (the one-argument sketch form
    does not exist in zod 4; matches 619's `scorecard.types.ts:64`).
  - All numbers `.finite()` so details can always round-trip JSON and survive
    `computeProjectionSha256` (which throws on non-finite).
  - `sha256HexSchema` reused from Batch 3 (`ground-truth/label-schemas.ts:14`)
    for `liveness.snapshotSha256` and `rubric.judge-vs-human.promptSha256` —
    reused, not redefined.
  - Minimal part ≤ whole refinements: `ci95` must be `[low, high]`;
    `anchorStability.withinTolerance ≤ anchorStability.items`.
  - `outcome.deterministic` stays `z.literal(false)` (Phase-5 study is
    stochastic by definition, per §5).
- `tools/mcp-bench/src/memory-skills/memory-skills-suite-kinds.spec.ts` (new),
  30 tests: default-registry registration on import; isolated registry
  (`createSuiteKindRegistry()`, R6) registers exactly the five kinds and rejects
  a duplicate; 8 valid details fixtures; 12 invalid details (one+ per kind,
  including the R7 stray-`projectionSha256` case, unknown discriminators,
  negative counts, non-hex sha, inverted `ci95`, `deterministic: true`); a full
  scorecard parsed through 619's `createScorecardSchema(isolated registry)` —
  **rubric with `groundTruth.raterCount: 2`** (two independent raters,
  design line 231) — plus a clean/dirty pair proving the core propagates
  details rejections; renderer output asserted per kind (headers, real metric
  rows, cost rows, `| Verdict | pass |`).

Evidence (direct jest run, latest):

- `npx jest -c tools/mcp-bench/jest.config.ts <the 2 spec paths> --runInBand`
  → `Test Suites: 2 passed, 2 total`, `Tests: 41 passed, 41 total`.

Core-field check (batch validation note): every field the design needs exists
in the shipped 4b core (`suite.projectionSha256`, `cost.source`
`'live'|'cassette'|'none'`, nullable `tokens.billed`, `groundTruth.raterCount`,
`arm`, `registerSuiteKind`, isolated `createSuiteKindRegistry`,
`computeProjectionSha256`). No missing core field → no 619 request was needed,
and no 619 file was touched.

## Task 12.2 — Deterministic projection (R-C4)

What was done:

- `tools/mcp-bench/src/memory-skills/projection.ts` (new):
  - `RecordedSuiteCase` — the `<suiteId>.cases.jsonl` line shape (design
    §6.4 line 480): the five projected fields plus the recorded-but-never-
    projected `latencyMs`, `error`, `baselineOutcomes`, `cassetteKey`.
  - `ProjectionRunFacts` — `runId`, `startedAt`, `hostPid`, `hostPort`,
    `safetyCapMs`: volatile facts the builder receives and drops wholesale, so
    the exclusion is structural, not conventional.
  - `buildSuiteProjection(input)` — whitelists exactly the design's holding list
    (§7 lines 539-545): `verdict`, `details` quality fields, per-case
    `{caseId, inputSha256, expected, observed, outcome}`, `groundTruth`,
    `cassetteVersion`, and `cost.calls`; rounds every number to 6 decimals
    (recursively, cycle- and undefined-safe) and returns a fresh object.
  - `computeSuiteProjectionSha256(input)` — hands the rounded projection to
    619's `computeProjectionSha256` (canonical sorted-key JSON + SHA-256 stay
    in 619's core; no local copy of the canonicalizer).
- `tools/mcp-bench/src/memory-skills/projection.spec.ts` (new), 11 tests, which
  prove exactly what the batch requires:
  - unchanged hash: `cost.latency_ms` (p50/p95), `cost.error_rate`,
    `cost.tokens.*`; `runId`, `startedAt`, `hostPid`, `hostPort`,
    `safetyCapMs`; per-case `latencyMs`, `error`, `baselineOutcomes`,
    `cassetteKey`; and (documenting the holding list) `claim`, `arm`,
    `baselines`, `deltas`, an already-recorded `projectionSha256`.
  - changed hash: `cost.calls`; per-case `outcome`, `caseId`, `inputSha256`,
    `observed`; `details`, `groundTruth.version`, `cassetteVersion`.
  - rounding to 6 decimals at every depth (`0.6666666666666665` ≡ `0.666667`;
    values that round together hash together; nested arrays included).
  - `NaN` details → `projection cannot contain non-finite numbers` (619's
    error, not a local duplicate); cyclic details → `projection cannot contain
    cycles`; the projection object holds exactly the six whitelisted keys and
    the five projected case fields.
  - the hash is lowercase 64-hex (`/^[0-9a-f]{64}$/`).

Interpretations and risks handled (stated because §7 line 545 is terse):

1. `cost`: only `calls` is projected. The holding list does not include
   `source`/`error_rate`/latency/tokens, and line 545's parenthetical singles
   out `calls` as the one kept field.
2. "safety-cap timing" (§4.4 line 264: a 120 s per-case cap aborts a hung case)
   is modelled as the run fact `safetyCapMs` (dropped), while a cap abort's
   per-case trace lives in the already-dropped `error` field — the projected
   `outcome` stays.
3. Wall-clock-sensitive details fields (`liveness.unprocessedAgeP95Ms`,
   funnel `backlog` ages/slopes) are accepted as-is: §4.4 line 263 requires
   those invariants to run on injected clocks, so their values are
   deterministic when the runner supplies them; the projection hashes whatever
   deterministic details the runner passes (input boundary is the runner's kind
   schema, validated in Task 12.1).
4. Rounding guard: numbers with `|x| ≥ 9e9` pass through unrounded — scaling
   them by 1e6 would cross `Number.MAX_SAFE_INTEGER` and the divide-back could
   corrupt the value; such doubles carry no 6-decimal precision anyway.
5. Case order is preserved (the design canonicalises *keys*, not arrays; suites
   execute sequentially per §6.4), so an execution-order change is a visible
   projection difference rather than a silent match.
6. `na` is never a pass — no verdict logic lives in this batch; verdicts flow
   from 619's core, whose schema forces `naReason` on `na` suites.

## Verification

Commands run (scoped to `mcp-bench` and the four changed files only):

1. `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/memory-skills-suite-kinds.spec.ts tools/mcp-bench/src/memory-skills/projection.spec.ts --runInBand`
   → `Test Suites: 2 passed, 2 total` / `Tests: 41 passed, 41 total`
2. `npx nx test mcp-bench -- --maxWorkers=2` (full project suite, workers
   capped; includes the two new specs plus all Phase-1/619 suites)
   → exit 0, `Run duration: 1m 19s`, `mcp-bench:test 1m 19s` (nx reports no
   failing task)
3. `npx nx run-many -t typecheck,lint -p mcp-bench`
   → exit 0 (`mcp-bench:typecheck 50.8s`; 2 tasks, 0 failures; the batch's
   `typecheck,test,lint` triple is covered by this run plus run 2)
4. `npx eslint <the 4 changed files>`
   → exit 0, no output (0 errors, 0 warnings; the initial run had 7
   `no-empty-function` warnings from `() => {}` no-mutation lambdas, fixed by
   returning `undefined`)
5. `npx prettier --check --ignore-unknown <the 4 changed files>`
   → `All matched files use Prettier code style!`
6. `git diff --exit-code 1ae06c8248de6dc9d64c8ab462f9eb65c4f30fc6 -- tools/mcp-bench/src/scorecard/`
   → exit 0 (clean: 619's scorecard core untouched by this batch)

## Absolute paths changed (all new files; nothing modified, nothing committed)

- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\memory-skills-suite-kinds.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\memory-skills-suite-kinds.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\projection.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\projection.spec.ts`

## Not done (out of scope by design)

- No `project.json` change: the `build-host-memory-skills` / `bench-memory-skills`
  targets belong to the runner batches (context.md item 3 says to tell 619 the
  commit when they are added — not applicable yet).
- No runner wiring: nothing yet calls `registerMemorySkillsSuiteKinds` /
  `computeSuiteProjectionSha256` or writes `suite.projectionSha256` into a
  scorecard; that is the later runner work (the APIs are exported for it).
- Nothing committed (per instructions); no git state-changing command was run.
- Not mine, untouched: an untracked `tools/mcp-bench/src/memory-skills/runner/`
  directory appeared in this worktree during the batch (Batch 14's net-recorder
  area may run alongside Batch 12 per batches.md line 596). The full project
  test run above was green with it present.
