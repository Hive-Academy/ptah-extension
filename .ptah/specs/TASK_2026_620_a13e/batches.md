# Batches - TASK_2026_620_a13e (Phase 3: bench implementation)

Total tasks: 50 | Batches: 26 | Complete: 0/26

Source plan: `benchmark-design.md` (APPROVED, `benchmark-design-review-r2.md`), §9.1 outline, §6 runner and
scorecard, §7 CI gate. **Paths and host helpers follow `context.md` "619 answers to design §6.6"
(2026-10-06), which override the design.** Outcome harness (design P3-B10) belongs to Phase 5 and is
not decomposed here. Phase 4 fixes are in Appendix A only.

## Recorded defaults (from the orchestrator prompt and 619's answers)

- **Worktree and branch.** One 620 worktree:
  `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench`, branch
  `feat/task-620-memory-skills-bench`, created from `fix/task-619-tool-benchmark` at `d995a1e1a`
  (current tip, newer than `b538e8fb6`). **Precondition before Batch 1 runs: the orchestrator creates
  this worktree** (this decomposition made no git change). Never touch
  `.claude-worktrees/task-619-tool-benchmark`. Lanes never run git; team-leader commits.
- **Rebase points.** When 619 sends the **Batch 4b SHA** (schema), rebase the 620 branch onto it
  before any batch marked `waits: 4b` starts. When 619 sends the **Batch 4c SHA** (helpers), rebase
  again before any batch marked `waits: 4c`. Then keep rebasing until 619 merges. Each rebase reruns
  `npx nx run-many -t typecheck,test,lint -p mcp-bench` before the next batch starts.
- **Paths (619 answer 3).** Code: `tools/mcp-bench/src/memory-skills/`. Committed fixtures:
  `tools/mcp-bench/fixtures/memory-skills/` (synthetic or repository content only). Reports:
  `tools/mcp-bench/reports/memory-skills/` (metrics and run ids only). The only allowed change to
  `tools/mcp-bench/project.json` is to ADD `build-host-memory-skills` (Batch 15) and
  `bench-memory-skills` (Batch 16). Each of those commits is reported to 619. 620 never edits
  `scorecard.types.ts`, `scorecard-writers.ts`, `suite-kinds.ts` (619's), `host-launcher.ts`,
  `bench-host.entry.ts`, `bench-data.ts`.
- **Private data.** The snapshot, session transcripts, the frozen candidate copy, the labelling packet,
  rater notes, the opaque-id to stratum/slug map, real-session cassettes and run artefacts live only
  under `PTAH_MCP_BENCH_DATA_DIR` (default `C:\Users\abdal\AppData\Local\ptah-mcp-bench`). The repo holds
  synthetic or git-derived fixtures, SHA-256 hashes, opaque ids and numeric scores. No committed file
  contains candidate text, transcript text or notes about candidate content.
- **Bench data dir before 4c.** "Can start now" tooling takes the bench data dir as an explicit
  argument and refuses any path under the real `~/.ptah` or the repo. Batch 16 replaces that argument
  default with 619's `resolveBenchDataDir()`. This is a replacement, not a second helper.
- **Verification (every batch, run in the 620 worktree):**
  `npx nx run-many -t typecheck,test,lint -p mcp-bench` (tail the output) and
  `npx prettier --check --ignore-unknown <every changed path>`. `--ignore-unknown` is required because
  prettier exits 2 on `.jsonl` ("No parser could be inferred", verified 2026-10-06). JSONL fixtures are
  validated by their schema spec instead. The commit hook does not check `tools/`. A batch may add a
  scoped run first: `npx nx run mcp-bench:test --testPathPatterns=memory-skills/<dir>`.
- **Executors.** "CLI lane" = one background lane from `ptah_agent_list` at spawn time. Vendor
  choice is the orchestrator's; no vendor is fixed here. "Sub-agent" = in-process `backend-developer`
  (or `devops-engineer` where named). The rule is: lanes for well-specified pure additions,
  sub-agents for work that wires product services, touches private data or needs a judgement call.
- **Phases and reviews.** Every phase uses one execution side. It ends with one code-logic review of
  its combined diff, done from the opposite side: a lane-built phase gets the `code-logic-reviewer`
  sub-agent; a sub-agent-built phase gets a CLI lane reviewer (a vendor different from any implementer
  lane in that phase, where possible). A style review is added only where a phase adds a public
  helper API that other code imports (Phase 3.3).
- **Readiness labels.** Every batch header carries **NOW** (pure additions, may start from
  `d995a1e1a`) or **WAITS: 4b / 4c** (registers kinds, writes scorecards, uses 619 helpers). Batches
  that need human labels carry **BLOCKED-ON-LABELS** for their scored run (the code can still land).

## User activities (not batches; no executor)

| Id | Activity | Input (produced by) | Unblocks |
|---|---|---|---|
| U1 | Skills blind labelling: two human raters × 105 documents on the 471 8-criterion rubric, then third-party adjudication of disagreements (pass/fail differs or totals differ by > 12) | Packet + CSV template (Batch 9) | Batch 25 freeze → `skill.rubric.inter-rater`, `skill.judge-agreement`, `skill.enhancer` verdicts |
| U2 | Accept, edit or reject the drafted memory facts (≥ 110), should-merge / should-not-merge pairs (≥ 40 / ≥ 40), update (≥ 25), temporal (≥ 15) and abstention (≥ 15) cases | Draft file (Batch 10) | Batch 25 freeze → full `gt-memory@v1`, `gt-merge@v1` |
| U3 | Label the matcher sample (≥ 100 (row, fact) pairs, ≥ 40 true matches) | Sample from a replay run (Batch 24) | R-M4 gate for every matcher-based memory suite |
| U4 | Label 20 real held-out sessions (durable facts, sediment lines) and 23 × (5 + 5) trigger prompts | Session sample (Batch 8), authored-skill list | `mem.extraction` real slice, `skill.trigger-eval.human` |

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- `LaneRunnerService` surface used by skill-synthesis is `run()` only. **Verified**: 10 call sites in 7
  files (`archaeology/session-archaeologist.service.ts`, `gates/judge-panel.service.ts`,
  `gates/replay-validator.service.ts`, `gates/trigger-eval.service.ts`, `queue/skill-drain.service.ts`,
  `skill-judge.service.ts`, `skill-synthesizer.service.ts`). The double implements
  `Pick<LaneRunnerService, 'run'>` (Batch 5).
- `ICuratorLLM` = `extract(transcript, signal?, options?)` and
  `resolve(drafts, related, signal?, options?)` (`libs/backend/memory-contracts/src/lib/curator-llm.port.ts:126-148`).
  **Verified**. Cassette keys exclude `signal`/`options` (Batch 5).
- The candidate freeze copy and manifest already exist (`skill-candidates-20261006/`,
  `skill-candidates-20261006.manifest.json`, shape `{source, dirs, files, manifestSha256,
  files_sha256{relPath: sha256}}`). **Verified** on disk. Design's `freeze-candidates.ts` (copy) is
  dropped; Batch 8 verifies the existing manifest instead.
- 619 Batch 4b ships `claim.source` incl. `'ledger'`, `groundTruth.method` enum
  `generated|labelled|seeded|git-history`, `cost.source`, nullable `tokens.billed`, optional
  `suite.projectionSha256` + `computeProjectionSha256`, an isolated test registry
  (619 `batches.md` Task 4b.1, read at `d995a1e1a`; `context.md` answers 4, 7). Unverified until
  the SHA arrives. Batch 12 checks it against the shipped schema.
- 619 Batch 4c ships `assertIsolatedEnvironment()`, `bootCodeExecutionHost({workspace,
  beforeEngineBoot?, afterContainerReady?})`, `resolveBenchDataDir()` (`context.md` answers 1-2).
  Unverified. Batch 15 checks it.
- Seeded sessions produced by the generator are accepted by `curate({transcript})` and by the boot-scan
  JSONL reader. Unverified. Batch 4 checks it with a spec round-trip through the product reader.
- A template-fallback body is identifiable (design §4.1). Unverified. Batch 9 checks it; if it is not
  identifiable, the `fallback` stratum merges into `random`, and the batch report states this.
- `retireAfterDormantDays` default is 30 at the pinned commit (design K2). Batch 22 reads the source.
- Retire/reconcile and `memory.store` `created_at` can be driven by an injected clock or a host fake
  scheduler (design §3.3, §4.4). Batches 18 and 22 check this. A gap is recorded as a Phase 4
  acceptance item, not worked around with wall-clock asserts.
- `ptah-surface-authoring` is still untracked (`git status ??`), so positives = 23 authored skills
  (Q3 default). Batch 9 re-checks this at freeze time.
- Provider auth for local live cassette recording inside the isolated home (design §6.1). Unverified.
  Batch 17 checks it before recording. A missing credential is a run failure, never a skip.

| Risk | Severity | Mitigation |
|---|---|---|
| R1 Design paths (`src/task-620`, `fixtures/task-620`, `build-host-620`, `bench-620`) are superseded by 619 answer 3 | HIGH | All batches use `memory-skills` paths and target names; Batch 15/16 are the only `project.json` touches |
| R2 Design commits `skill-docs.v1.json {opaqueId, stratum, sha256}` and label CSVs with `note`. Stratum in the repo un-blinds raters, and notes about candidates are user data (619 answer 3) | HIGH | Batch 9 keeps the id→stratum/slug map and notes in the bench data dir. Batch 25 commits only `{opaqueId, sha256}` plus numeric scores, and adds the stratum map only after adjudication is complete |
| R3 Design batches P3-B6/B7/B8 exceed 6 files | MEDIUM | Split into Batches 17-23 and 13/16/24 |
| R4 R-M4 fact matcher is in no design batch | MEDIUM | Task 2.2 |
| R5 Design `bench-data-dir.ts` duplicates 619's `resolveBenchDataDir()` | MEDIUM | Not created. "Now" tools take an explicit dir; Task 16.2 switches the default to 619's helper |
| R6 619 owns `src/scorecard/suite-kinds.ts`; a same-named 620 file confuses imports | LOW | 620 file is `memory-skills/scorecard/memory-skills-suite-kinds.ts` and uses 619's isolated test registry (Task 12.1) |
| R7 `projectionSha256` is now an optional core field; design §6.3 also puts it in `funnelDetails` | LOW | Removed from 620 `details` schemas (replace, not accumulate). Task 12.2 uses `computeProjectionSha256` |
| R8 Prettier fails on `.jsonl` | MEDIUM | `--ignore-unknown` in every verification; schema specs validate JSONL |
| R9 Embedding reproducibility win32 → linux breaks `resolve` cassette keys (design §6.2) | MEDIUM | Task 5.1 keys `resolve` on sorted candidate ids. Batch 24 replays on Linux/WSL; misses > 0 make the affected suites local-only, recorded in `known-failures.v1.json` notes |
| R10 Parent-process offline suites could read the real `~/.ptah` (619 answer 6) | HIGH | Task 16.1 read-path guard (repo files + bench data dir only) with a spec that asserts refusal |
| R11 120 s safety cap turns a slow CI case into `fail`, which breaks the R-C4 projection (review r2 new minor) | LOW | Task 16.1 retries a `safety-cap` abort once and records per-case runtime. Batch 24 reports max per-case runtime vs 120 s |
| R12 Snapshot opened by the parent could gain `-shm`/`-wal` sidecars or be mutated | MEDIUM | Task 8.2 opens it `readonly` + `fileMustExist`, hashes before and after, and fails on a change |
| R13 The 563 `net-guard.ts` lives in a spec folder outside `tools/mcp-bench/tsconfig.json` `include` | LOW | Task 14.2 ports it into `memory-skills/runner/net-recorder.ts`. The 563 harness copy is a closed task's artefact and stays |
| R14 Lane-built code passed typecheck/lint/test while hiding cleanup-path errors (619 lesson) | MEDIUM | Each phase reviewer reads cleanup and error paths directly. Each batch acceptance names its error-path spec |
| R15 Design §10.3 finding-16 tag is still `[user-requested]`-adjacent | LOW | Superseded: 619 answer 3 fixes the location. No batch depends on the tag |

Edge cases:

- Zero executed cases ⇒ `na` reason `zero-cases`, never `pass` — Tasks 1.1 (rate helpers return `null`
  on empty denominators), 14.1, 16.1.
- κ on constant vectors, Spearman with ties or constant input, and a missing rater value ⇒ `null`
  with a reason, never `NaN` or 0 — Task 2.1.
- Cassette miss ⇒ typed error ⇒ case `na: cassette-miss`; a suite with any miss cannot pass — Tasks
  5.1, 5.2, 14.1.
- Ground-truth commit newer than the first scored run of that version ⇒ runner refuses — Task 16.1.
- Rater CSV hash ≠ `MANIFEST.json` ⇒ suite fails — Tasks 3.2, 21.1.
- `gt-skill-rubric@v1` trust bar unmet ⇒ `na: ground-truth-untrusted` — Task 21.1.
- Retire/reconcile with a dependency that never resolves ⇒ timeout outcome on the injected clock;
  today the safety cap records `fail` — Task 22.2.
- Over-cap race with no `await` between read and compare-and-set ⇒ `pass` with reason
  `no-interleaving-point` — Task 22.2.
- Workspace roots `''`, `null`, case variant, trailing slash, worktree path — Task 19.2.
- Bench data dir under the real `~/.ptah` or inside the repo ⇒ refused — Tasks 8.1, 16.2.

---

# Phase 3.1 — Pure foundations (CLI lanes; NOW) — review: `code-logic-reviewer` sub-agent

Parallel waves (max 3 lanes): wave 1 {B1, B3, B5}; wave 2 {B2, B4}; wave 3 {B6, B7}.

## Batch 1: Core curation metrics and bootstrap — IN_PROGRESS

- Readiness: **NOW**
- Recommended executor: CLI lane x 1
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential (one lane; the spec files import the two modules)
- Rationale: pure functions with hand-computable fixtures; one self-contained prompt.
- Tasks: 2 | Depends on: none (worktree precondition)
- Phase: 3.1 | Phase review: code-logic (sub-agent), after Batch 7

### Task 1.1: Seeded PRNG and paired bootstrap — IN_PROGRESS

- File: `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\metrics\bootstrap.ts`, `...\metrics\bootstrap.spec.ts`
- Plan reference: benchmark-design.md:64 (R-L4: 10,000 resamples, fixed seed), :113 (R-M6: seed `TASK_2026_620`), :329 (paired over tasks)
- Pattern to follow: `tools/mcp-bench/src/metrics/retrieval-metrics.ts` (619, pure exports + spec)
- Quality requirements: string-seeded PRNG (deterministic across platforms, no `Math.random`);
  `bootstrapInterval(values, {resamples, seed, alpha})` and `pairedBootstrapDelta(a, b, opts)`; an empty
  input returns `null`; identical output across two runs (spec).
- Validation notes: R-M6, edge case "empty denominator".
- Implementation details: no dependencies beyond Node; export types for interval `[lo, hi] | null`.

### Task 1.2: Curation metrics — IN_PROGRESS

- File: `...\metrics\curation-metrics.ts`, `...\metrics\curation-metrics.spec.ts`
- Depends on: Task 1.1
- Plan reference: benchmark-design.md:122-127 (recall, precision with `unlabelled` excluded, FMR,
  over-suppression), :150-155 (update correct/stale/omission/hallucination), :185-187 (false-delete,
  false-retain, archived-then-needed), :138 (merge P/R/F1, duplicate-cluster rate, singleton share)
- Quality requirements: every rate returns `{value: number | null, num, den}` (R-M6); `den = 0` ⇒
  `value: null`; hand-computed fixtures for each function; update classification follows the
  "no superseded marker today ⇒ correct requires v1 absent" rule (:151).
- Validation notes: does not import 619 scorecard types (NOW).
- Implementation details: reuse 619 `retrieval-metrics.ts` for `recallAtK`/`ndcgAtK`; do not
  re-implement them.

### Batch 1 verification

- Every listed file exists with real implementations.
- `npx nx run-many -t typecheck,test,lint -p mcp-bench` passes; `npx prettier --check --ignore-unknown` on the 4 files.
- Spec covers empty denominators and byte-identical bootstrap output across runs.

## Batch 2: Agreement metrics and fact matcher — PENDING

- Readiness: **NOW**
- Recommended executor: CLI lane x 1
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: pure statistics plus a pure matcher; it needs Batch 1's bootstrap for the κ interval.
- Tasks: 2 | Depends on: Batch 1
- Phase: 3.1 | Phase review: (phase-level)

### Task 2.1: Agreement metrics — PENDING

- File: `...\metrics\agreement-metrics.ts`, `...\metrics\agreement-metrics.spec.ts`
- Plan reference: benchmark-design.md:232-241 (Cohen κ pass/fail, Spearman on totals,
  quadratic-weighted κ per criterion, raw agreement, trust bar), :111 (κ with 95% bootstrap interval)
- Quality requirements: constant vectors ⇒ `null` with reason; Spearman uses average ranks for ties;
  κ interval via `bootstrapInterval`; trust-bar evaluator returns each sub-condition with its value
  (full κ ≥ 0.6 and ρ ≥ 0.7; candidates-only ρ ≥ 0.6; anchor ≥ 8/10 within ±8/80).
- Validation notes: edge case κ on constant vectors → `null`.
- Implementation details: inputs keyed by opaque id; mismatched id sets are an error, not a silent inner join.

### Task 2.2: Deterministic fact matcher (R-M4) — PENDING

- File: `...\matching\fact-matcher.ts`, `...\matching\fact-matcher.spec.ts`
- Plan reference: benchmark-design.md:111 (R-M4), :660 (`keyTokens[][]`, `forbiddenTokens[]`)
- Quality requirements: case fold, NFKC, whitespace collapse; every required key-token set matches
  (alternates per set); any forbidden token ⇒ no match; searches `subject + content + chunk text`;
  pure and deterministic.
- Validation notes: R4 (missing from the design outline). The R-M4 human-agreement gate is U3 plus
  Batch 25, not this task.

### Batch 2 verification

- Files exist; `npx nx run-many -t typecheck,test,lint -p mcp-bench`; prettier `--ignore-unknown` on the 4 files.
- Spec: κ constant → null; tie handling; forbidden token blocks a match; Unicode-normalised match.

## Batch 3: Ground-truth label schemas and fixture manifest — PENDING

- Readiness: **NOW**
- Recommended executor: CLI lane x 1
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: zod schemas and a hasher; fully specified by design §10.1 and §4.2.
- Tasks: 2 | Depends on: none
- Phase: 3.1 | Phase review: (phase-level)

### Task 3.1: Label schemas — PENDING

- File: `...\ground-truth\label-schemas.ts`, `...\ground-truth\label-schemas.spec.ts`
- Plan reference: benchmark-design.md:660 (fact record), :134-137 (merge pair), :148 (update case
  with bait v′), :243 (rubric CSV row), :677 (real-session label `{opaqueId, sha256, lineRefs}`), :528 (known-failure entry)
- Quality requirements: zod schemas for fact, merge pair, update case, temporal case, abstention case,
  matcher-sample row, real-session label, rubric score row and adjudication row, known-failure entry
  (`direction` mandatory, `toleranceReason` required when `tolerance ≠ 0`). The **committed** rubric
  row is `opaqueId, raterId, c1..c8, total, pass, ratedAt`, with no `note` column (R2). Notes belong to a
  separate private schema used only in the bench data dir.
- Validation notes: R2; R8 (JSONL is validated here, not by prettier).

### Task 3.2: Fixture manifest hasher — PENDING

- File: `...\ground-truth\fixture-manifest.ts`, `...\ground-truth\fixture-manifest.spec.ts`, `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\fixtures\memory-skills\MANIFEST.json`
- Depends on: Task 3.1
- Plan reference: benchmark-design.md:243, :661 (version = sha256 of canonical JSONL)
- Quality requirements: canonical-JSONL hashing (sorted keys, LF); `buildManifest(dir)` and
  `verifyManifest(dir)` returning per-file mismatches; the initial `MANIFEST.json` lists the files
  present after this batch (none besides itself, or an empty `files` map).
- Validation notes: edge case "CSV hash ≠ manifest ⇒ fail".

### Batch 3 verification

- Files exist; `npx nx run-many -t typecheck,test,lint -p mcp-bench`; prettier `--ignore-unknown` on the 5 files.
- Spec: a known-failure entry without `direction` is rejected; a rubric row with a `note` field is rejected by the committed schema.

## Batch 4: Seeded session generator and worked facts — PENDING

- Readiness: **NOW**
- Recommended executor: CLI lane x 1
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: deterministic generator against a fixed template spec. The one product-coupled check
  (reader round-trip) is a spec assertion the lane can run.
- Tasks: 2 | Depends on: Batches 1 (PRNG), 3
- Phase: 3.1 | Phase review: (phase-level)

### Task 4.1: Generator — PENDING

- File: `...\ground-truth\seeded-session-generator.ts`, `...\ground-truth\seeded-session-generator.spec.ts`
- Plan reference: benchmark-design.md:119 (bait classes a-c, ≥ 1 bait per session), :120 (long-session
  class: ≥ 12 windows, facts in windows 4..n-4), :148 (update pairs in separate dated sessions), :666
- Quality requirements: seeded PRNG from Task 1.1 (import allowed after Batch 1 commits; otherwise
  Batch 4 waits for Batch 1); emits SDK-shaped JSONL lines plus the flattened `transcript` string
  `curate()` accepts; output is byte-identical across two runs; window plan per long session is reported.
- Validation notes: ASSUMPTION "generator output accepted by the product". The spec parses the output
  with the product's transcript reader / `clamp-transcript.ts` and asserts the planned window count
  and the middle-window placement.
- Implementation details: templates and distractor bank are data in Task 4.2 files.

### Task 4.2: Worked facts and distractor bank — PENDING

- File: `...\fixtures\memory-skills\memory-facts.v1.jsonl` (10 worked facts F-001..F-010, git-cited), `...\fixtures\memory-skills\distractors.v1.jsonl`, MODIFY `...\fixtures\memory-skills\MANIFEST.json`
- Depends on: Task 4.1
- Plan reference: benchmark-design.md:649-662 (sources, record fields, git citations only)
- Quality requirements: every fact cites a git artefact (`file:line` at `sourceCommit` or a commit
  SHA); `labeller` = `draft:lane` until U2 accepts (Batch 25 replaces it); validates against Task 3.1; manifest rebuilt.
- Validation notes: no memory-row or pipeline text (R-M1); repository content only (619 answer 3).

### Batch 4 verification

- Files exist; `npx nx run-many -t typecheck,test,lint -p mcp-bench`; prettier `--ignore-unknown` on changed paths.
- Spec: two generator runs are byte-identical; the product reader round-trip passes; `verifyManifest` is clean.

## Batch 5: Record/replay doubles — PENDING

- Readiness: **NOW**
- Recommended executor: CLI lane x 1
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential (both doubles share the cassette store)
- Rationale: the two port surfaces are verified (Assumptions). The key scheme is specified in design §6.2.
- Tasks: 2 | Depends on: none
- Phase: 3.1 | Phase review: (phase-level)

### Task 5.1: Cassette store and `RecordedCuratorLlm` — PENDING

- File: `...\doubles\cassette-store.ts`, `...\doubles\recorded-curator-llm.ts`, `...\doubles\recorded-curator-llm.spec.ts`
- Plan reference: benchmark-design.md:371-374, :112 (R-M5), :379 (cross-platform keys)
- Quality requirements: `implements ICuratorLLM`; record mode wraps a real `ICuratorLLM` and appends
  `{key, method, model, promptSha, response, usage?}`; replay serves by key; `key =
  sha256(method + canonical JSON)` excluding `signal`/`options`; `resolve` keys sort `related` by id
  (R9); a miss throws a typed `CassetteMissError`; it counts calls (used by the rescan invariant); fault
  modes for liveness (throw non-network error, zero drafts, timeout, stalled) are selectable per key.
- Validation notes: R9; edge case cassette miss.

### Task 5.2: `RecordedLaneRunner` — PENDING

- File: `...\doubles\recorded-lane-runner.ts`, `...\doubles\recorded-lane-runner.spec.ts`
- Depends on: Task 5.1
- Plan reference: benchmark-design.md:373-374; Assumptions (verified `run()` surface)
- Quality requirements: structurally `Pick<LaneRunnerService, 'run'>`; same key and miss semantics; a
  pause hook per call (used by the scripted interleaving in Batch 22).
- Implementation details: import the type only from `@ptah-extension/skill-synthesis` (allowed by `type:tool`).

### Batch 5 verification

- Files exist; `npx nx run-many -t typecheck,test,lint -p mcp-bench`; prettier `--ignore-unknown` on the 5 files.
- Spec: record→replay round trip; miss → `CassetteMissError`; `resolve` key is stable under a reordered `related` list.

## Batch 6: Write-side pure baselines — PENDING

- Readiness: **NOW**
- Recommended executor: CLI lane x 1
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: pure policies with exact definitions in the design.
- Tasks: 2 | Depends on: Batch 3 (types)
- Phase: 3.1 | Phase review: (phase-level)

### Task 6.1: Extraction and merge baselines — PENDING

- File: `...\baselines\write-side-baselines.ts`, `...\baselines\write-side-baselines.spec.ts`
- Plan reference: benchmark-design.md:128 (extract-all), :139 (byte-equal subject, never merge,
  tier-1 case-folded window), :156 (latest-chunk-wins), :99 (append-only seed policy)
- Quality requirements: pure; each function documented with the design line it implements; hand fixtures.

### Task 6.2: Pinned OR query builder — PENDING

- File: `...\baselines\fts-or-query.ts`, `...\baselines\fts-or-query.spec.ts`
- Plan reference: benchmark-design.md:85, :159 (pre-473 OR builder, labelled as baseline code)
- Quality requirements: re-implementation of the pre-473 builder; the file header cites the pinned
  commit and source path the lane read via `git show`; the spec pins its output for 5 queries.
- Validation notes: the lane must find the pre-473 commit with `git log` read-only commands only (no
  git writes) and state it in the report.

### Batch 6 verification

- Files exist; `npx nx run-many -t typecheck,test,lint -p mcp-bench`; prettier `--ignore-unknown` on the 4 files.

## Batch 7: Read-side and retention pure baselines — PENDING

- Readiness: **NOW**
- Recommended executor: CLI lane x 1
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: pure policies; file-disjoint from Batch 6, so both run in parallel.
- Tasks: 2 | Depends on: Batch 3 (types)
- Phase: 3.1 | Phase review: code-logic by `code-logic-reviewer` sub-agent over Batches 1-7 combined diff (opposite side to lanes)

### Task 7.1: Read-side baselines — PENDING

- File: `...\baselines\read-side-baselines.ts`, `...\baselines\read-side-baselines.spec.ts`
- Plan reference: benchmark-design.md:156 (raw transcript grep, newest wins), :164 (last-N N = 50;
  grep top-5 by keyword hits; no memory), :95 (grep lines carry ISO timestamps)
- Quality requirements: pure; deterministic tie-break documented.

### Task 7.2: Retention policies — PENDING

- File: `...\baselines\retention-policies.ts`, `...\baselines\retention-policies.spec.ts`
- Plan reference: benchmark-design.md:190 (none, age-only, oracle with useful-by-kind and `hits > 0` protected)
- Quality requirements: policies take `nowMs` explicitly (no `Date.now()`); defaults read from
  `memory-lifecycle-config.ts` (30/60/25,000), not copied as literals.

### Batch 7 verification

- Files exist; `npx nx run-many -t typecheck,test,lint -p mcp-bench`; prettier `--ignore-unknown` on the 4 files.
- After commit: return `NEEDS REVIEW` for Phase 3.1 (Batches 1-7).

---

# Phase 3.2 — Private-data tooling and labelling packet (sub-agent; NOW) — review: CLI lane

## Batch 8: Freeze verification, candidate-row diff, session sampler — PENDING

- Readiness: **NOW**
- Recommended executor: backend-developer sub-agent
- Fallback executor: CLI lane x 1 (with the privacy rules pasted verbatim)
- Execution mode: sequential
- Rationale: it reads the private snapshot and the candidate copy, so data handling needs judgement.
- Tasks: 3 | Depends on: Batch 3
- Phase: 3.2 | Phase review: (phase-level)

### Task 8.1: Verify the existing candidate manifest — PENDING

- File: `...\data\verify-candidate-manifest.ts`, `...\data\verify-candidate-manifest.spec.ts`
- Plan reference: benchmark-design.md:209, :223-224; context.md:187-191 (manifest sha256 `73a184c5…45f3`)
- Quality requirements: reads the manifest format on disk (`{source, dirs, files, manifestSha256,
  files_sha256}`); recomputes every file hash and the manifest hash; reports missing, extra and
  changed files; the bench dir is an explicit argument; it refuses a dir under the real `~/.ptah` or the repo.
- Validation notes: R5 (no second bench-data helper); the copy already exists, so this task does not copy.

### Task 8.2: Candidate-dir vs `skill_candidates` row diff — PENDING

- File: `...\data\candidate-row-diff.ts`, `...\data\candidate-row-diff.spec.ts`
- Plan reference: benchmark-design.md:224
- Quality requirements: opens the snapshot `readonly` + `fileMustExist`; hashes the snapshot before and
  after and fails on a change (R12); writes the diff report only under the bench data dir; the spec
  uses a temp SQLite file.

### Task 8.3: Held-out session sampler — PENDING

- File: `...\data\sample-sessions.ts`, `...\data\sample-sessions.spec.ts`
- Plan reference: benchmark-design.md:671-677 (seed window, eval window, exclusions,
  `sha256("TASK_2026_620:real" + filename)` order, 200 KiB-5 MiB)
- Quality requirements: copies plus a SHA-256 manifest into the bench data dir only; transcript source
  dirs are read-only inputs; the spec asserts nothing is written outside the temp bench dir.
- Validation notes: produces U4's input.

### Batch 8 verification

- Files exist; `npx nx run-many -t typecheck,test,lint -p mcp-bench`; prettier `--ignore-unknown` on the 6 files.
- One local dry run of 8.1 and 8.2 against `C:\Users\abdal\AppData\Local\ptah-mcp-bench\snapshots`. It reports
  2,745 files verified, and the snapshot sha256 is unchanged (`82cd16ac…d575a`).

## Batch 9: Blind labelling packet and CSV template — PENDING

- Readiness: **NOW**
- Recommended executor: backend-developer sub-agent
- Fallback executor: none (private data and blinding judgement; do not move to a lane)
- Execution mode: sequential
- Rationale: stratified sampling from private data, the fallback-identification check, and blinding rules.
- Tasks: 2 | Depends on: Batches 3, 8
- Phase: 3.2 | Phase review: (phase-level)

### Task 9.1: Stratified sample selector — PENDING

- File: `...\labelling\select-rubric-sample.ts`, `...\labelling\select-rubric-sample.spec.ts`
- Plan reference: benchmark-design.md:211-221 (strata and n = 105), :50 (K1), context.md:184-186 (Q3 default)
- Quality requirements: 23 `authored` (git-tracked `.claude/skills/*/SKILL.md` at the pinned commit,
  excluding the 2 promoted and the untracked `ptah-surface-authoring`), 2 `promoted-synthesized`, 10
  `anchor-471` (ids from `TASK_2026_471_b3d1/skill-quality-criteria.md:72-87`), 18 `suggestion`,
  20 `judged-model` (creation week 4 bands × transcript size around the median, `sha256(seed+slug)`
  order per cell), 20 `fallback`, 12 `random`; deterministic.
- Validation notes: ASSUMPTION fallback identifiable (`skill-synthesizer.service.ts` ~`:316-342`). If not
  identifiable, merge into `random` (n stays 105) and say so in the report.

### Task 9.2: Packet builder and CSV template — PENDING

- File: `...\labelling\build-labelling-packet.ts`, `...\labelling\build-labelling-packet.spec.ts`
- Depends on: Task 9.1
- Plan reference: benchmark-design.md:229-231 (blinding), :243 (CSV columns)
- Quality requirements: writes to `<benchData>/labelling/skill-rubric-v1/`: one file per document
  named by opaque id; frontmatter `name` → opaque id; `references/` inlined below a fixed separator
  for every stratum; per-rater shuffle with a recorded seed; `rater-<id>.csv` templates (opaque ids,
  empty score columns, no `note` column); a private `notes-<rater>.csv`; a private
  `id-map.json` (opaqueId → stratum, slug, sha256); a rater instruction sheet quoting the 471 rubric
  (C1-C8, 0-10, pass ≥ 64/80 and no criterion < 6). **Nothing is written to the repo** (R2).
- Validation notes: the spec asserts no stratum, slug or pipeline score appears in any rater-visible file.

### Batch 9 verification

- Files exist; `npx nx run-many -t typecheck,test,lint -p mcp-bench`; prettier `--ignore-unknown` on the 4 files.
- Local run produces 105 packet documents + 2 rater templates in the bench data dir, and
  `git status` in the worktree shows no data file. → hands off to **U1**.

## Batch 10: Memory ground-truth drafting (no repo change) — PENDING

- Readiness: **NOW**
- Recommended executor: CLI lane x 1 (MCP off, no access to `~/.ptah`)
- Fallback executor: researcher-expert sub-agent
- Execution mode: sequential
- Rationale: drafting from git artefacts with citations is well specified, and design §10.1 names a drafting lane.
- Tasks: 1 | Depends on: Batch 3 (schemas), Batch 4 (record format)
- Phase: 3.2 | Phase review: none for this batch (data draft; U2 is the acceptance). The phase review covers Batches 8, 9, 11.

### Task 10.1: Draft facts, merge pairs, update/temporal/abstention cases — PENDING

- File: `<benchData>\drafts\memory-gt-v1.draft.jsonl` (outside the repo; no commit)
- Plan reference: benchmark-design.md:649-662, :134-136, :148, :157, :169
- Quality requirements: ≥ 130 fact drafts (margin over 110) by slice counts at :651-657; ≥ 50/50
  merge pairs; ≥ 30 update, ≥ 18 temporal, ≥ 18 abstention; every item cites a git artefact; excludes
  471/473/563/620 measurement documents; validates against Task 3.1 schemas.
- Validation notes: R-M1. Draft only, so `labeller = draft:lane`. Team-leader verifies the schema and
  citations by sampling 10 items with `git show`. State: COMPLETE with "no commit (bench data only)".

## Batch 11: Synthetic skills fixtures — PENDING

- Readiness: **NOW**
- Recommended executor: backend-developer sub-agent
- Fallback executor: CLI lane x 1
- Execution mode: sequential
- Rationale: fixture scripts must encode the expected feed events per session, which takes design judgement.
- Tasks: 2 | Depends on: Batch 4 (session writer, MANIFEST.json)
- Phase: 3.2 | Phase review: code-logic by a CLI lane over Batches 8, 9, 11 combined diff (opposite side to sub-agents)

### Task 11.1: Funnel session fixture generator — PENDING

- File: `...\ground-truth\skill-session-fixture.ts`, `...\ground-truth\skill-session-fixture.spec.ts`, `...\fixtures\memory-skills\skill-sessions.v1\` (generated, committed)
- Plan reference: benchmark-design.md:261 (30 sessions: 4 routines × 3, 10 non-routine, 8 degraded;
  labels; per-session operation script → expected feed events)
- Quality requirements: synthetic text only; deterministic; each session's script validates; the
  expected event list is derived from the script, never from pipeline output.

### Task 11.2: Planted negative skill documents — PENDING

- File: `...\fixtures\memory-skills\planted-negatives.v1\` (10 documents), MODIFY `...\fixtures\memory-skills\MANIFEST.json`
- Plan reference: benchmark-design.md:254
- Quality requirements: the 5 named degenerate kinds, 2 each; derived only from synthetic text or
  git-tracked authored skills; manifest rebuilt. U1 raters may veto a document at labelling time.

### Batch 11 verification

- Files exist; `npx nx run-many -t typecheck,test,lint -p mcp-bench`; prettier `--ignore-unknown` on changed paths; `verifyManifest` clean.
- After commit: return `NEEDS REVIEW` for Phase 3.2.

---

# Phase 3.3 — Suite kinds and gate logic (CLI lanes; WAITS 4b) — review: `code-logic-reviewer` + `code-style-reviewer` sub-agents (new public helper API)

## Batch 12: Memory/skills suite kinds and projection — PENDING

- Readiness: **WAITS: 4b** (rebase first)
- Recommended executor: CLI lane x 1
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: zod schemas against a shipped core.
- Tasks: 2 | Depends on: 619 Batch 4b SHA; Batch 3
- Phase: 3.3

### Task 12.1: Register kinds — PENDING

- File: `...\scorecard\memory-skills-suite-kinds.ts`, `...\scorecard\memory-skills-suite-kinds.spec.ts`
- Plan reference: benchmark-design.md:381-476 (curation, liveness, rubric, funnel, outcome); context.md answers 4, 7
- Quality requirements: `registerSuiteKind` for each kind, with optional Markdown renderers; drop
  `projectionSha256` from `funnelDetails` (R7); `rubric` uses `raterCount: 2`; specs use 619's
  isolated test registry (R6); valid/invalid `details` per kind.
- Validation notes: check the Assumption against the shipped 4b schema. Any missing core field becomes
  a request to 619 (session in context.md), not a local edit.

### Task 12.2: Deterministic projection — PENDING

- File: `...\scorecard\projection.ts`, `...\scorecard\projection.spec.ts`
- Plan reference: benchmark-design.md:539-545 (R-C4 projection fields and exclusions)
- Quality requirements: builds the projection object and calls 619's `computeProjectionSha256`; the
  spec proves that latency, tokens, run id, timestamps, pid/port and safety-cap timing do not change
  the hash, and that `calls` and per-case outcomes do.

### Batch 12 verification

- `npx nx run-many -t typecheck,test,lint -p mcp-bench`; prettier `--ignore-unknown`;
  `git diff --exit-code <4b SHA> -- tools/mcp-bench/src/scorecard/` is clean.

## Batch 13: Known-failures evaluator and ledger renderer — PENDING

- Readiness: **WAITS: 4b**
- Recommended executor: CLI lane x 1
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: §7 semantics are fully specified; pure over scorecard objects.
- Tasks: 2 | Depends on: Batch 12 (types)
- Phase: 3.3 | Phase review: code-logic + style (sub-agents) over Batches 12-14

### Task 13.1: Known-failures evaluator — PENDING

- File: `...\gate\known-failures.ts`, `...\gate\known-failures.spec.ts`
- Plan reference: benchmark-design.md:528-535
- Quality requirements: one spec case per rule: equal → report; within tolerance → report; better-but-failing → fail "tighten"; worse → fail; unlisted fail → fail; `na` on a CI suite → fail; `zero-cases` → fail; listed-now-passing → fail "remove entry"; cassette miss / guard trip / net hit → fail.

### Task 13.2: Ledger renderer — PENDING

- File: `...\gate\ledger-render.ts`, `...\gate\ledger-render.spec.ts`
- Plan reference: benchmark-design.md:56-101 (columns, R-L2..R-L6 verdict rules)
- Quality requirements: verdict computed by R-L4/R-L5 from scorecard + baselines + MinE; `na` maps
  to `not measurable yet`; invariant rows require a baseline; the "fix or delete" proposal column is
  filled for `no effect`.

### Batch 13 verification

- `npx nx run-many -t typecheck,test,lint -p mcp-bench`; prettier `--ignore-unknown` on the 4 files.

## Batch 14: Net recorder — PENDING

- Readiness: **WAITS: 4b** (only for a consistent base; it has no schema dependency and may run with Batch 12)
- Recommended executor: CLI lane x 1
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Tasks: 1 | Depends on: none in code
- Phase: 3.3 | Phase review: (Batch 13 line)

### Task 14.1: Port the 563 net recorder — PENDING

- File: `...\runner\net-recorder.ts`, `...\runner\net-recorder.spec.ts`
- Plan reference: benchmark-design.md:378; source `.ptah/specs/TASK_2026_563_2939/harness/lib/net-guard.ts:1-25,84` (R13)
- Quality requirements: records outbound attempts in the main thread and worker threads; the run fails on any
  recorded attempt during suite execution; the spec opens a socket and expects a record.

### Batch 14 verification

- `npx nx run-many -t typecheck,test,lint -p mcp-bench`; prettier `--ignore-unknown` on the 2 files. After commit → `NEEDS REVIEW` Phase 3.3.

---

# Phase 3.4 — Host and runner (sub-agent; WAITS 4b + 4c) — review: CLI lane

## Batch 15: Memory-skills bench host — PENDING

- Readiness: **WAITS: 4c** (and 4b)
- Recommended executor: backend-developer sub-agent
- Fallback executor: none recommended (DI overrides, isolation)
- Execution mode: sequential
- Tasks: 2 | Depends on: Batches 5, 12; 619 Batch 4c SHA
- Phase: 3.4

### Task 15.1: Host entry and plan schema — PENDING

- File: `...\host\memory-skills-host.entry.ts`, `...\host\plan.schema.ts`, `...\host\plan.schema.spec.ts`, `...\host\fixture-seeder.ts`, `...\host\fixture-seeder.spec.ts`
- Plan reference: benchmark-design.md:351-367 (R-X2 steps 1-7, non-DB state); context.md answers 1, 5
- Quality requirements: `assertIsolatedEnvironment()` first; reads `PTAH_BENCH_MEMORY_SKILLS_PLAN`;
  seeds fixtures in `beforeEngineBoot` (copied from the bench dir, never opened in place); overrides
  `CURATOR_LLM` / `LANE_RUNNER_SERVICE` in `afterContainerReady`, and nothing else in CI; runs plan
  suites in-process; completion line, then wait for stdin EOF. The seeder refuses any source under the real `~/.ptah`.
- Validation notes: check the 4c Assumption; ASSUMPTION host fake scheduler (used by Batches 18 and 22) is installable per suite.

### Task 15.2: Host build target — PENDING

- File: MODIFY `...\tools\mcp-bench\project.json` (ADD `build-host-memory-skills` only, modelled on `build-host-bundle`)
- Quality requirements: no other line of `project.json` changes (`git diff` shows one added target); team-leader tells 619 the commit SHA.

### Batch 15 verification

- `npx nx run mcp-bench:build-host-memory-skills`; `npx nx run-many -t typecheck,test,lint -p mcp-bench`; prettier `--ignore-unknown`.
- Smoke: `launchBenchHost({hostScript})` with an empty plan passes the guard; `hostExit.kind = clean`.

## Batch 16: Runner CLI and parent read-path guard — PENDING

- Readiness: **WAITS: 4c**
- Recommended executor: backend-developer sub-agent
- Fallback executor: none recommended
- Execution mode: sequential
- Tasks: 2 | Depends on: Batches 13, 14, 15
- Phase: 3.4 | Phase review: code-logic by a CLI lane over Batches 15-16

### Task 16.1: `run-memory-skills` — PENDING

- File: `...\runner\run-memory-skills.ts`, `...\runner\run-memory-skills.spec.ts`, `...\runner\read-path-guard.ts`, `...\runner\read-path-guard.spec.ts`
- Plan reference: benchmark-design.md:358-361, :478-497, :665 (ground-truth commit check); context.md answer 6
- Quality requirements: plan → `launchBenchHost` → offline suites in the parent inside the launcher
  window → 619 writers; the read-path guard allows only committed repo files and the bench dir, and
  refuses the real `~/.ptah` (R10); `cost.source` set per suite; per-case runtime recorded, and a
  `safety-cap` abort is retried once (R11); `--ci` mode enables the net recorder and the
  known-failures evaluator; a ground-truth commit newer than the version's first scored run is refused.

### Task 16.2: Bench target and bench-dir switch — PENDING

- File: MODIFY `...\tools\mcp-bench\project.json` (ADD `bench-memory-skills` only); MODIFY Batch 8/9 entry defaults to `resolveBenchDataDir()` (R5)
- Quality requirements: the explicit-dir guards from Batch 8/9 are replaced by 619's helper (deleted, not kept beside it); report the commit to 619.

### Batch 16 verification

- `npx nx run mcp-bench:bench-memory-skills -- --plan <empty>` completes; `npx nx run-many -t typecheck,test,lint -p mcp-bench`; prettier `--ignore-unknown`. After commit → `NEEDS REVIEW` Phase 3.4.

---

# Phase 3.5 — Memory suites (sub-agent; WAITS 4b + 4c) — review: CLI lane

Batches 17-20 are file-disjoint and may run in parallel (max 3) after Batch 16. Each suite emits
baselines, `cost`, per-case JSONL (`620.case.<kind>.v1`) and a projection hash.

## Batch 17: Extraction and liveness suites — PENDING

- Readiness: **WAITS: 4c** | Executor: backend-developer sub-agent | Fallback: none | Mode: sequential
- Tasks: 2 | Depends on: Batches 1, 2, 4, 5, 6, 16
- Phase: 3.5

### Task 17.1: `mem.extraction` (seeded, long-session) — PENDING

- File: `...\suites\memory\extraction.suite.ts`, `...\suites\memory\extraction.suite.spec.ts`, `...\fixtures\memory-skills\cassettes\memory\extraction.v1.jsonl`
- Plan reference: benchmark-design.md:115-130
- Quality requirements: head/tail vs middle-window recall reported separately; extract-all and
  no-memory baselines; the cassette is recorded locally from synthetic input only, and records its model id.
- Validation notes: ASSUMPTION provider auth in the isolated home; check it before recording.

### Task 17.2: `mem.liveness.fault` and `mem.liveness.rescan` — PENDING

- File: `...\suites\memory\liveness.suite.ts`, `...\suites\memory\liveness.suite.spec.ts`
- Plan reference: benchmark-design.md:195-200
- Quality requirements: fault modes (a)-(d) and the rescan with fixed `fs.utimes`; the expected failures today are recorded, not hidden.

### Batch 17 verification

- `npx nx run-many -t typecheck,test,lint -p mcp-bench`; prettier `--ignore-unknown`; one replay run through `bench-memory-skills` on the 10-fact seed.

## Batch 18: Dedup, rerank, update, temporal, seed — PENDING

- Readiness: **WAITS: 4c** | Executor: backend-developer sub-agent | Mode: sequential
- Tasks: 2 | Depends on: Batches 1, 4, 5, 6, 16
- Phase: 3.5

### Task 18.1: `mem.dedup` + `mem.dedup.rerank` — PENDING

- File: `...\suites\memory\dedup.suite.ts`, `...\suites\memory\dedup.suite.spec.ts`
- Plan reference: benchmark-design.md:132-144
- Validation notes: ASSUMPTION tier-2 configurable (`merge-candidate-collector.ts:134`); if not, record it and do not add a variant.

### Task 18.2: `mem.update`, `mem.temporal`, `mem.update.seed` — PENDING

- File: `...\suites\memory\update.suite.ts`, `...\suites\memory\update.suite.spec.ts`
- Plan reference: benchmark-design.md:146-158
- Validation notes: ASSUMPTION injectable `created_at`; if not injectable, record `created_at` = curation time as a finding.

### Batch 18 verification

- As Batch 17.

## Batch 19: Read side and scope — PENDING

- Readiness: **WAITS: 4c** | Executor: backend-developer sub-agent | Mode: sequential
- Tasks: 2 | Depends on: Batches 1, 2, 7, 16
- Phase: 3.5

### Task 19.1: `mem.search.fts-and`, `mem.injection.recall`, `mem.abstention` — PENDING

- File: `...\suites\memory\read-side.suite.ts`, `...\suites\memory\read-side.suite.spec.ts`
- Plan reference: benchmark-design.md:159, :161-171

### Task 19.2: `mem.scope.write` — PENDING

- File: `...\suites\memory\scope-write.suite.ts`, `...\suites\memory\scope-write.suite.spec.ts`
- Plan reference: benchmark-design.md:173-178
- Quality requirements: the temp git repo and worktree are created under `<benchData>/git-scope/<runId>/` only; never `withPinnedCorpus`.

### Batch 19 verification

- As Batch 17.

## Batch 20: Retention, ranking and snapshot audits — PENDING

- Readiness: **WAITS: 4c** | Executor: backend-developer sub-agent | Mode: sequential
- Tasks: 2 | Depends on: Batches 1, 7, 8, 16
- Phase: 3.5 | Phase review: code-logic by a CLI lane over Batches 17-20

### Task 20.1: `mem.retention.growth`, `mem.retention.lifecycle`, `mem.ranking.roster` — PENDING

- File: `...\suites\memory\retention.suite.ts`, `...\suites\memory\retention.suite.spec.ts`
- Plan reference: benchmark-design.md:180-191
- Quality requirements: injected `nowMs` days 0..180; 9-day stall via the replay double; DB bytes after vacuum per day.

### Task 20.2: `mem.liveness.audit` and `skill.backlog.audit` (local) — PENDING

- File: `...\suites\audits\snapshot-audits.suite.ts`, `...\suites\audits\snapshot-audits.suite.spec.ts`
- Plan reference: benchmark-design.md:202-203, :283-288; R-M1a
- Quality requirements: read-only SQL on a copy in the isolated home; never the product's counters;
  baselines are 471 figures and the 2026-10-06 copy.
- Validation notes: ASSUMPTION `observation_queue.session_id` + `memories.session_id` (0051 schema).

### Batch 20 verification

- As Batch 17. After commit → `NEEDS REVIEW` Phase 3.5.

---

# Phase 3.6 — Skills suites (sub-agent; WAITS 4b + 4c) — review: CLI lane

## Batch 21: Rubric agreement and judge agreement — PENDING

- Readiness: **WAITS: 4c**; scored run **BLOCKED-ON-LABELS** (U1, Batch 25)
- Recommended executor: backend-developer sub-agent | Mode: sequential
- Tasks: 2 | Depends on: Batches 2, 3, 9, 16
- Phase: 3.6

### Task 21.1: `skill.rubric.inter-rater` — PENDING

- File: `...\suites\skills\rubric-agreement.suite.ts`, `...\suites\skills\rubric-agreement.suite.spec.ts`
- Plan reference: benchmark-design.md:226-243
- Quality requirements: recomputes from committed CSVs; CSV hash ≠ manifest ⇒ fail; trust bar unmet or
  CSVs absent ⇒ `na: ground-truth-untrusted`; full set and candidates-only figures. The spec uses synthetic CSVs.

### Task 21.2: `skill.judge-agreement` (local) — PENDING

- File: `...\suites\skills\judge-agreement.suite.ts`, `...\suites\skills\judge-agreement.suite.spec.ts`
- Plan reference: benchmark-design.md:245-257
- Quality requirements: 3 repeats, pinned model + prompt sha256, positive/negative controls, length and
  random baselines, figures with and without `anchor-471`; raw outputs only in the bench dir.

## Batch 22: Funnel suite — PENDING

- Readiness: **WAITS: 4c** | Executor: backend-developer sub-agent | Mode: sequential
- Tasks: 2 | Depends on: Batches 5, 11, 16
- Phase: 3.6

### Task 22.1: Funnel harness, prefilter → judge stages — PENDING

- File: `...\suites\skills\funnel.suite.ts`, `...\suites\skills\funnel-stages.ts`, `...\suites\skills\funnel.suite.spec.ts`
- Plan reference: benchmark-design.md:259-273 (prefilter, archaeology incl. verdict accuracy vs
  majority-class, cluster, draft, judge), :277 (feed-parity, restart), :278 (replay)

### Task 22.2: Promote, retire, delivery, backlog drain — PENDING

- File: `...\suites\skills\funnel-lifecycle.ts`, `...\suites\skills\funnel-lifecycle.spec.ts`, `...\fixtures\memory-skills\cassettes\skills\funnel.v1.jsonl`
- Plan reference: benchmark-design.md:274-282 (scripted interleavings, injected clock), :279
- Validation notes: `retireAfterDormantDays` read from source (K2); the `no-interleaving-point` outcome;
  ASSUMPTION host fake scheduler covers the code, else record it as a Phase 4 acceptance item.

## Batch 23: Slug collisions and human trigger eval — PENDING

- Readiness: **WAITS: 4c**; `skill.trigger-eval.human` scored run **BLOCKED-ON-LABELS** (U4)
- Recommended executor: backend-developer sub-agent | Mode: sequential
- Tasks: 1 | Depends on: Batches 8, 16
- Phase: 3.6 | Phase review: code-logic by a CLI lane over Batches 21-23

### Task 23.1: `skill.namer.collisions` + `skill.trigger-eval.human` — PENDING

- File: `...\suites\skills\namer-and-trigger.suite.ts`, `...\suites\skills\namer-and-trigger.suite.spec.ts`
- Plan reference: benchmark-design.md:290-291
- Quality requirements: collisions are computed on the frozen copy in the bench dir (counts only leave
  it); trigger scoring never calls a model (`trigger-eval.service.ts:16-25`).

### Batch 21-23 verification (each)

- `npx nx run-many -t typecheck,test,lint -p mcp-bench`; prettier `--ignore-unknown`; one replay
  `bench-memory-skills` run per batch, and every funnel stage reports `in`/`out`. After Batch 23 → `NEEDS REVIEW` Phase 3.6.

---

# Phase 3.7 — CI gate and first recorded run (sub-agent; WAITS 4c) — review: CLI lane

## Batch 24: CI workflow, first recorded scorecard, known failures, ledger — PENDING

- Readiness: **WAITS: 4c**
- Recommended executor: devops-engineer sub-agent (workflow), with the backend-developer sub-agent for the local run
- Execution mode: sequential
- Tasks: 3 | Depends on: Batches 17-23
- Phase: 3.7 | Phase review: code-logic by a CLI lane

### Task 24.1: `.github/workflows/memory-skills-bench.yml` — PENDING

- File: `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\.github\workflows\memory-skills-bench.yml`
- Plan reference: benchmark-design.md:509-536; context.md Q5 default
- Quality requirements: non-required; PR paths per :527 (with `tools/mcp-bench/**`) plus nightly;
  network only in the embedder-cache fill step; uploads synthetic artefacts only.

### Task 24.2: First recorded run and known failures — PENDING

- File: `...\fixtures\memory-skills\known-failures.v1.json`, `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\reports\memory-skills\<productVersion>\scorecard.json|md`
- Quality requirements: one CI-mode run on Windows and one on Linux/WSL with the network blocked after the
  cache fill (R9 check); every failing CI suite has an entry with `direction`, tolerance 0 and a ledger
  row; max per-case runtime vs 120 s reported (R11); produces the matcher sample for U3.

### Task 24.3: Ledger — PENDING

- File: `...\reports\memory-skills\feature-evidence.md`
- Quality requirements: rendered by Task 13.2. Rows needing U1-U4 read `not measurable yet` with the reason.

### Batch 24 verification

- `npx prettier --check --ignore-unknown` on the workflow, JSON and MD; `npx nx run-many -t typecheck,test,lint -p mcp-bench`; the workflow passes `actionlint` if it is available, otherwise a manual `workflow_dispatch` on the branch.

---

# Phase 3.8 — Ground-truth freeze (after U1-U4; sub-agent) — review: CLI lane (privacy + manifest)

## Batch 25: Freeze labels and ground truth — PENDING

- Readiness: **BLOCKED-ON-LABELS** (U1, U2, U3; U4 for the real slices)
- Recommended executor: backend-developer sub-agent | Mode: sequential
- Tasks: 2 | Depends on: Batches 3, 4, 9, 10, 21; user activities
- Phase: 3.8

### Task 25.1: Commit accepted memory ground truth — PENDING

- File: MODIFY `...\fixtures\memory-skills\memory-facts.v1.jsonl` (≥ 110 accepted), CREATE `merge-pairs.v1.jsonl`, `matcher-sample.v1.jsonl`, MODIFY `MANIFEST.json`
- Quality requirements: only U2-accepted items, with the labeller id per item; matcher agreement per R-M4 reported (≥ 0.9 raw, κ ≥ 0.8, lower bound ≥ 0.7).

### Task 25.2: Commit skill labels (numeric only) — PENDING

- File: CREATE `...\fixtures\memory-skills\skill-labels.v1.csv`, `skill-adjudication.v1.csv`, `skill-docs.v1.json` (`{opaqueId, sha256}`; stratum added only after adjudication closes, R2), MODIFY `MANIFEST.json`
- Quality requirements: no text columns; Batch 21 rubric suite run reports the trust bar.

## Batch 26: Phase-3 close-out — PENDING

- Readiness: after Batch 25 | Executor: backend-developer sub-agent | Tasks: 1 | Depends on: Batch 25
- Phase: 3.8 | Phase review: CLI lane over Batches 25-26, checking that no committed file contains candidate text, transcript text or notes.

### Task 26.1: Re-run, update known failures and ledger — PENDING

- File: MODIFY `known-failures.v1.json`, `reports\memory-skills\feature-evidence.md`, new scorecard under `reports\memory-skills\`
- Quality requirements: the ratchet is respected (entries only tighten or disappear); every ledger row has a run id or a stated `not measurable yet` reason.

---

## Addendum batches A1, A2, B1, B2 (Codex/terra recording and model-panel labels)

User decisions (2026-10-07): the live recordings use the product's `openai-codex` provider with
`gpt-5.6-terra`; U1-U4 ground truth comes from a cross-family model panel (raters xAI + Google,
adjudicator GLM; no OpenAI lane labels), escalating only if fewer than two eligible families exist;
implementor grok, planner and code reviewer codex (same side, user-pinned). Design:
`design-addendum-codex-recording-and-model-panel.md`; review APPROVED round 1
(`design-addendum-codex-recording-and-model-panel-review.md`). Order: A2, B1, B2 in parallel, then
A1 (it consumes the A2 callback). Recordings and B24 still wait for "619 Batch 11 runs done" and the
rebase on the 619 probe-fix commit. Each batch: one grok lane, at most 40 tool calls, scoped jest only.

### Batch A2: Product provenance taps — PENDING

- Files: the curator `sdk-internal-query.curator-llm.ts` + spec; skill-synthesis `lane-runner.service.ts` + spec.
- Read-only dispatch callback with `resolvedProviderId` / `resolvedModelId` after final route
  resolution, including the ride-active path. Request and result bytes unchanged without a subscriber.

### Batch B1: Panel schemas and import — PENDING

- Files: new `labelling/model-panel.ts` + spec; `ground-truth/label-schemas.ts` + spec; `suites/skills/rubric-ground-truth.ts` + spec.

### Batch B2: Terminology and docs — PENDING

- Files: `suites/skills/trigger-human-eval.ts` + spec; `tools/mcp-bench/README.md`.
- `groundTruth.method` says `model-panel:<families>`, never "human"; display label `skill.trigger-eval.panel`.

### Batch A1: Plan, config and auth recording seam — PENDING

- Files: `runner/runner-plan.ts`, `runner/run-memory-skills.ts` + specs; `host/plan.schema.ts`,
  `host/memory-skills-host.ts`; new `host/recording-bootstrap.ts` + spec; `host/fixture-seeder.ts` + spec;
  `recorder/provider-provenance.ts` + spec.
- Orchestrator addition to review finding N1 (refresh is only detectable after the token server
  already rotated the token): in record mode the settings carrier must also set the Codex OAuth
  token endpoint `ptah.provider.openai-codex.oauthTokenEndpoint` (read by
  `codex-auth.service.ts:517-524` `getOAuthTokenEndpoint`) to an unreachable
  loopback address, so a refresh fails BEFORE it reaches the server; plus hash the isolated
  `auth.json` and discard the staged cassette if it changed.

---

## Appendix A — Phase 4 fixes (not Phase 3 batches) mapped to the metric each must move

| Fix | Must move | Guard |
|---|---|---|
| Item 1 resolve from hybrid search; subject fragmentation; 563 M3-8(b) | `mem.dedup` merge recall ↑ vs byte-equal; duplicate-cluster ↓ | merge precision; calls/merge |
| Item 2 sediment purge + write-time classifier | `mem.extraction` precision, FMR ↑ | durable recall; false-delete |
| Item 3 salience outcome label | `mem.retention.lifecycle` false-delete ↓; `mem.ranking.roster` NDCG ↑ | rows ≤ cap; growth slope |
| Item 4 mine evidence, stop auto-authoring | `skill.funnel.cluster` invariant; human rubric mean ↑ | prefilter recall |
| Item 5 replace judge rubric; 578 P1 positive control | `skill.judge-agreement` ρ ↑, positive control ≥ 90%, saturation ↓ | negative control ≥ 90% |
| Item 6 do not judge fallbacks | `skill.funnel.draft` invariant | judge coverage |
| Item 7 promotion reachability | `skill.funnel.promote`, `skill.funnel.judge` invariants | `skill.funnel.retire` |
| 473 Track B | 5-cluster blind rubric: pass ≥ 2/5 at ≥ 6.0, else retire the generator | rater trust bar |
| 588 archaeology first, ≥ 2 sessions | `skill.funnel.archaeology`, `.cluster` invariants | prefilter recall |
| 563 M4-8(a) / M4-8(c) / relevance | singleton share ↓ / real-slice over-suppression = 0 / `mem.search.fts-and` recall@10 | — / precision / NDCG@10 |
| 578 P1 reconcile delete, retire just-used, reconcile timeout, over-cap race | `skill.funnel.retire` / `.promote` invariants | — |
| Silent extraction loss (#3) | `mem.liveness.fault` pass; unprocessed-deleted = 0 under stall | growth slope |
| M6 update semantics | `mem.update` correct ↑ vs latest-chunk-wins | injection recall |
| M5 keying | `mem.scope.write` non-canonical = 0 | cross-workspace leaks = 0 |
| MIN_SCORE threshold | `mem.abstention` false-injection ↓ | injection recall drop ≤ 5 pts |
| Reranker inert | `mem.dedup.rerank` NDCG@5 +0.05 and variance > 0, or delete | merge P/R |
| Backlog (#9) | `skill.backlog.drain` pass; audit slope ≤ 0, p95 ≤ 14 d | funnel invariants |
| Window clamp (M2 d) / rescan (M2 e) / archaeology quality (S3) | middle-window recall ↑ / rescan new rows = 0 / routine accuracy ↑ vs majority | calls, precision / first-scan recall / degraded detection |
