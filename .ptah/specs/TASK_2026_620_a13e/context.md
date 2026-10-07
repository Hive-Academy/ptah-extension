# TASK_2026_620_a13e — Memory and skills: benchmark-first quality program

## Why

The memory and skill trajectories were worked across many tasks and still have no benchmark and no
evidence of quality. Every number to date is a one-off, hand-judged sample on the live database,
and none runs in CI. The 473 relevance set decayed from 16/20 to 9/20 because the memory lifecycle
deleted the rows it was judged on (`TASK_2026_563_2939/test-report.md:403-413`). TASK_2026_619 showed
the same failure for the ptah code tools: "measured" tools lost to plain Grep (6 losses, 2 wins,
1 tie) because the ground truth was easy for the tool to match.

This task is the single owner of memory and skill quality. It was created on 2026-10-06 with the
user's approval to combine the open memory/skills tasks into one.

## Primary intent (acceptance rule for the whole task)

**Every memory and skills feature gets a measurable result and real evidence — not only the new
fixes, but every feature that already shipped.** "Merged with green tests" is not evidence that a
feature works. A feature is only "proven" when the benchmark shows, against a baseline, on ground
truth the feature did not produce, that it moves its metric in the intended direction. A feature
with no measurable effect is reported as such, and the report proposes to fix it or delete it.

The feature evidence ledger (`feature-evidence.md`, one row per feature, refreshed every release)
must cover at least:

| Feature | Shipped in | Claim to prove |
|---|---|---|
| Retention job, stuck-row quarantine, vacuum | 440 (PR #513) | DB growth is bounded; no useful memory is lost |
| Memory age lifecycle (archive, delete), salience for ranking | 443 (PR #521) | Old unused rows leave; rows that are still useful stay; ranking improves vs recency only |
| Skills unblock: manual promote, stricter prefilter, namer | 461 (PR #526) | Prefilter rejects noise and keeps real routines |
| Activity feed correctness | 586 (PR #620) | Feed events match the real event ledger |
| FTS stopwords + AND query; per-subject merge window | 473 Track A | Retrieval relevance vs the old OR query; merge rate |
| Extract prompt durability, searchRich merge candidates, sediment quarantine | 563 (PR #601) | Less sediment written; more correct merges; no over-suppression |
| Skill merge, judge gate, promote on accept, retire unused | 578 (PR #626) | Good skills promote, bad ones do not; retired skills were unused |
| Memory injection into agent context | (existing) | Agent outcomes improve vs no memory |
| Skill injection / triggers | (existing) | Agent outcomes improve vs no skill |

Each row records: metric, ground-truth source, baseline, the measured result with the scorecard
run id, and the verdict (proven / no effect / regressed / not measurable yet). `na` is never a
pass. The tasks 440/443/461/586/563/578/473 are closed as "shipped", not as "proven"; this ledger
is where they become proven or not.

## Method (benchmark first, then fixes)

1. **Forensics.** For each claim the prompts and UI make about memory and skills, quote it
   (file:line), find the real code path, and give the root cause of each failure with evidence.
2. **Benchmark before any fix.** Ground truth must not come from the system under test: seeded
   facts, held-out sessions, a frozen human-labelled set, git history. Always score against a
   baseline ("no memory", "raw transcript grep", "last-N messages"), never an absolute number only.
   Measure quality, tokens, calls, latency and error rate. Use real lifecycle scenarios: new session,
   update/contradiction, deletion, two workspaces, worktrees.
3. **Scorecard per run, kept per release**, and a CI gate in recorded-failure mode first.
4. **Fixes**, each tied to a metric it must move.
5. Orchestration: researcher-expert → Gate SR for any claim that cannot be met → team-leader
   batches → phase reviews from the opposite execution side.

External references: LongMemEval (MIT; taxonomy extraction / multi-session / knowledge update /
temporal / abstention; indexing–retrieval–reading split; recall@k, NDCG@k — do not gate on its
LLM-judge QA accuracy). LocAgent: Acc@k (all-correct) and NDCG@k — recall@k is not a LocAgent
metric; the Loc-Bench dataset has no license tag. Verified details, licenses and borrow decisions
for all references (LoCoMo CC BY-NC 4.0 — do not embed data; HaluMem CC BY-NC-ND — taxonomy only;
mem0 eval inform-only; Voyager/SkillWeaver/AWM/ExpeL/Reflexion give protocols, not metrics) are in
`references.md`. Vendor-reported scores are not evidence.

## Boundary with TASK_2026_619 (do not overlap)

- **619 owns** `ptah_memory_search` as a retrieval tool: workspace scope and isolation,
  worktree-to-repo scope, the spill-root bug, recall@k on seeded facts through the MCP transport.
- **620 owns** what gets written to memory (extraction quality, dedup, contradiction/update,
  retention), the skill trajectory (archaeology, clustering, synthesis, judge, promotion,
  retirement), and whether injected memory and skills improve agent outcomes.
- **Shared infrastructure** (reuse, never fork): `tools/mcp-bench` on branch
  `fix/task-619-tool-benchmark` (commits `122a9dd7b`, `4fc9d147c`) — `retrieval-metrics.ts`,
  `cost-metrics.ts`, the zod scorecard schema (verdict pass/fail/na; "na is never a pass"), the
  pinned-corpus helper, and the headless bench host with HOME/USERPROFILE isolation plus a hash
  check on the real `~/.ptah/state/ptah.sqlite`. A benchmark must never write to the user's real
  database. Schema changes: message session `ptah-ptah-extension-compare-grep-and-our-7799a800005aw2q23htdi0b` first.
- Work in an own worktree and branch. Do not touch `.claude-worktrees/task-619-tool-benchmark`.

**Schema agreement with 619 (2026-10-06):** 619 adds a generic core in `schemaVersion: 1`, in one
batch after its Batch 4 (SHA to follow): `claim {source, ref, text?}`; `suite.kind` + `suite.details`
validated via `registerSuiteKind(kind, zod)`; `groundTruth {id, version, method, raterCount?,
frozenAt?}` + `suite.arm?`; `baselines[]` + `deltas`; `cost {calls, latency_ms{p50,p95}, error_rate,
tokens{result_p50?, input?, output?, billed?}}`; `artifacts[] {kind, path, sha256, schemaId}`;
`run.guardMode: 'hash' | 'process-watch'`. 620 registers its own kinds (`curation`, `rubric`, …) in
its own files and NEVER edits `scorecard.types.ts` / `scorecard-writers.ts`; a missing core field is
requested from 619. 620 branches from `fix/task-619-tool-benchmark` at that SHA and rebases until
619 merges. Pure additions (`curation-metrics.ts`, `agreement-metrics.ts`, frozen corpus, 620
runner) may start now. Every 620 run goes through `launchBenchHost`. `process-watch` fails if a
bench process holds any path under the real `~/.ptah`, so bench fixtures (including any DB
snapshot) must be copied into the isolated home, never opened in place. Bench data lives outside
the repository and outside `~/.ptah`: `%LOCALAPPDATA%\ptah-mcp-bench\snapshots` on Windows,
`~/.cache/ptah-mcp-bench/snapshots` elsewhere, overridable by an env var. The existing snapshot under
`~/.ptah/bench-snapshots` is moved there only with the user's approval. If a 620 suite writes state
other than the DB, tell 619 the paths.

**619 answers to design §6.6 (2026-10-06)** — these override paths in `benchmark-design.md`:
1. 619 Batch 4c exports `assertIsolatedEnvironment()` and `bootCodeExecutionHost({ workspace,
   beforeEngineBoot?, afterContainerReady? })` next to `bench-host.entry.ts`. Seed fixtures in
   `beforeEngineBoot`; override `CURATOR_LLM` / `LANE_RUNNER_SERVICE` in `afterContainerReady`.
   The 620 host still runs via `launchBenchHost({ hostScript })`.
2. Env var `PTAH_MCP_BENCH_DATA_DIR`; helper `resolveBenchDataDir()` in
   `tools/mcp-bench/src/bench-data.ts` (Batch 4c) rejects paths under the real `~/.ptah` or the repo.
3. No separate project. Code in `tools/mcp-bench/src/memory-skills/`; 620 may ADD only the targets
   `build-host-memory-skills` and `bench-memory-skills` to `tools/mcp-bench/project.json` (no other
   change; tell 619 the commit). Committed fixtures in `tools/mcp-bench/fixtures/memory-skills/` ONLY
   if they hold no user data; the frozen candidates and anything from the user's memory DB or
   session transcripts stay in `PTAH_MCP_BENCH_DATA_DIR`, never committed. Committed examples are
   synthetic.
4. `cost.source: 'live' | 'cassette' | 'none'` (required); `tokens.billed` nullable (Batch 4b).
5. Non-DB state list accepted; no guard change.
6. Offline work may run in the parent inside the launcher window, reading only committed repo files
   and `PTAH_MCP_BENCH_DATA_DIR`, never the real `~/.ptah` — the parent checks this itself.
7. Optional `suite.projectionSha256` + `computeProjectionSha256(projection)` (Batch 4b).
Order: 619 sends the Batch 4b SHA (schema), then the Batch 4c SHA (helpers).
- **4b committed: `1ae06c8248de6dc9d64c8ab462f9eb65c4f30fc6`** on `fix/task-619-tool-benchmark`.
  `createScorecardSchema(registry)`, `createSuiteKindRegistry()` (use an isolated registry in specs),
  `registerSuiteKind<D>(kind, zod, renderMarkdown?)`, `computeProjectionSha256(projection)` in
  `suite-kinds.ts`; run `guardMode: 'hash'|'process-watch'|'not-applied'`, `guard`, `hostExit`
  (crash on shutdown is a run fact, not a suite error). 620 rebases onto 4b after wave 1 commits.
- 4c note: `resolveBenchDataDir()` runs in the runner parent and passes the resolved path to the
  child (the child's LOCALAPPDATA points at the temp home).
- **4c committed: `d716e0e8f`** (on 4b). `transport/bench-host-boot.ts`:
  `assertIsolatedEnvironment(env?, probe?)` → `IsolatedPaths {home, userDataPath, dbPath}` or
  `BenchIsolationError`; `bootCodeExecutionHost({ workspace, beforeEngineBoot?, afterContainerReady? })`
  → `BenchHostHandle {port, workspaceRoot, isolation, container, stop()}`. Order: options →
  isolation → `beforeEngineBoot({workspace, isolation})` → engine boot →
  `afterContainerReady(container, {workspaceRoot, isolation})` → MCP start; a failing step throws
  `BenchHostBootError` with `.step` and never starts MCP. `bench-data.ts`:
  `resolveBenchDataDir({ env?, realHome?, repoRoot?, platform?, create? })`, `BENCH_DATA_DIR_ENV`,
  `isPathInside`, `isSamePath`. Known gap until 619 4d.4: junctions/symlinks are not followed — do
  not point `PTAH_MCP_BENCH_DATA_DIR` at a junction. 4d changes shutdown internals only.
- **User instruction 2026-10-07: open a PR when the task is finished.** The 620 branch sits on
  `fix/task-619-tool-benchmark`; if 619 has not merged by then, open the PR against `main` only
  after 619 merges (rebase first), or as a draft PR based on the 619 branch — say which in the PR.
  TASK_2026_621 gets its own PR from `fix/task-621-retention-guard` after its review passes.
- 2026-10-07: Phase 1 committed and rebased onto `d716e0e8f` (B1 `4733c7b21`, B3 `346cfccc1`,
  B5 `817ee839e`, B2 `10abf8578`, B6 `52755452e`, B9 `49f341213`, B8 `60ac44a36`, B11-part
  `2ad65ced6`, B7 `a07178aa6`, B4 `9450ebd17`); 18 suites / 209 tests pass. Orchestrator
  corrections: B1 mergeF1, B2 hand-computed kappa tests, B7 barrel exports + vscode stub (B7 lane
  claimed lint passed; 2 boundary errors). B4 revise round 1 removed a mirrored copy of product
  windowing logic. B10 accepted on the third attempt (in-process curator; two codex attempts
  rejected: commit-subject padding, then single-task/BOM/0 updates): 130 facts from 68 task
  folders, 29/30 updates, 100 merge pairs, 21 temporal, 18 abstention, in the bench data folder;
  11 update v2 sources are uncommitted spec edits — re-verify after they are committed.
- **619 warning 2026-10-07:** `withPinnedCorpus` (`tools/mcp-bench/src/corpus/corpus.ts:30,116-129`)
  force-removes every registered `ptah-mcp-bench-corpus-*` worktree in the OS temp folder at start,
  with no liveness check (fix is 619 Task 9.3, not done). Until then: never run two benches that call
  `withPinnedCorpus` at the same time (620 vs 619, or two 620 runs); generators read a pinned commit
  with `git -C <repo> archive <commit> | tar -x -C <tempdir>` instead. 619 **4d committed
  `f22b604fe`** (additive: `BENCH_BISECT_ENV`, `BenchBisectFlag`, `readBisectFlags()`;
  `resolveBenchDataDir()` now follows junctions/symlinks) — rebase onto it later. Product bug
  TASK_2026_622_2d05: SQLite close crashes (0xC0000409 in `wal_checkpoint(TRUNCATE)`) in 50-80% of
  win32 shutdowns after vec0 writes; runs see it as `hostExit.kind: 'crash-on-shutdown'` — a run
  fact, never a suite error.
- U4 held-out session sample is PROVISIONAL: it was drawn while the eval window was open and
  one pick is this orchestration session's own transcript. Re-run the sampler after the window
  closes (2026-10-07T00:00Z or later) and before U4 labelling starts.
- Phase 1 reviews done: lanes → REVISE (6 major, 9 minor); in-process → REVISE (2 major,
  3 minor). Fixes committed: doubles `4c0db24f2`, data/labelling `22f6cd94b`. Pending: metrics/
  matching/baselines (codex), generator 4/10-12 (opencode after B12).
- Phase 1 reviews were: lane-authored code → `code-logic-reviewer` subagent
  (`code-logic-review-phase1-lanes.md`); in-process code → Glm lane
  (`code-logic-review-phase1-inprocess.md`). Then B11.1, B12–B23.
- Orchestrator correction in Batch 1: `mergeF1` value now computed as `num/den` (was float P/R,
  0.6666666666666665 ≠ 6/9); covered by the Phase-1 code review.

- **2026-10-07 (620 B16 `44a3329c4`, `bench-memory-skills` target; 619 told).** 619 answers to the
  B15/B16 requests: (1) core per-suite schema export, (2) `env` option on `launchBenchHost` (merged
  after isolation; isolation keys refused), (4) bench-host argument/shutdown helper exports — all
  accepted, delivered as a first task of 619 Batch 9 before 620 B24; 619 sends the SHA. Until then
  keep the `suite-result.ts` mirror and the `process.env` save/restore. (3) `guard: { ci: true }` is
  right for the Linux CI job (always `hash`; a concurrent writer under CI is an environment failure);
  a local `--ci` refusal while Ptah.exe is open is by design — local runs use the default guard.
  619 commits since `f22b604fe`: B5 `7e1572272`, B6 `629e4f719` (no scorecard/transport/bench-data
  change). 619's first real bench is Batch 9/11; it messages 620 first.

- **User decisions 2026-10-07, B-P pause switches** (`pause-switches-plan.md`; asked after the plan,
  before its cross-side review finished): (1) read side stays on while paused — saved memories and
  skills are still injected and `ptah_memory_search` still works; pause stops all background capture,
  curation, retention, synthesis, judging and promotion. (2) Delete the dead keys
  `memory.curatorEnabled`, `memory.triggers.preCompact`, `skillSynthesis.triggers.sessionEnd`; the
  per-workspace toggle fix and moving the host-local trigger keys to `~/.ptah/settings.json` are
  follow-ups, not B-P. (3) Manual runs (`memory:runNow`, `runCurator`, `analyzeNow`, `enhanceNow`) are
  refused and greyed out while paused. (4) Electron tray: two items ("Pause memory", "Pause skills"),
  tray always shown (not only with `trayKeepalive`), refreshed when the setting changes elsewhere.
  Orchestrator decision (follows decision 3): `previewEnhancement` (the call the Skills UI really
  uses; `enhanceNow` has no UI caller) is refused while paused too, since it is the same model work.
  Original request: switches visible on the Thoth Memory/Skills settings, stop ALL memory and skills
  work, pause and resume without issues.

Lessons from 619: put `npx prettier --check <changed paths>` in every batch verification (the commit
hook does not check `tools/`). Review lane code directly — typecheck/lint/test passed while
`corpus.ts` hid errors in its cleanup path. The memory DB keys rows by the exact `workspace_root`
string, so a worktree session sees none of the main repository's memories.

## Absorbed scope

| From | Item | Status when absorbed |
|---|---|---|
| 473 Track B | Generator prompt rewrite, new judge rubric, stop judging template fallbacks, wider schema, blind 5-cluster experiment (pass ≥2/5 at ≥6.0, else retire the generator) | Not started |
| 588 (phase 5 of 439) | Archaeology before authoring, reject degraded/no-routine verdicts with a visible reason, cluster across ≥2 sessions, delete the single-session auto-candidate | Not started |
| 563 | Four failed gates (M3-8(b) 7/23 vs 8/23; M4-8(a) singleton share 98.0%→99.2%; M4-8(c) 5 over-suppressions; relevance 9/20 < 16/20). `harness/` (`extract-eval.ts`, `merge-replay.ts`) seeds the memory benchmark | Merged PR #601, gates open |
| 578 P1 | Boot reconcile can delete promoted skill dirs; retirement can retire a just-used skill; judge panel spec has no positive control; reconcile wait has no timeout; over-cap promotion race | Merged PR #626, follow-ups open |
| 471 | Decisions below | Research complete |

Kept separate: 587 (Thoth Overview UI), 535/536/537 (lane intelligence). 536 relates for the
archaeologist and judge services only.

## Decisions carried from TASK_2026_471 (agreed: do not use Jev)

TypeSafe/Jev is **not adopted** anywhere. The D4 Jev-vs-judge experiment is dropped. The
enhancements the 471 research found are in scope here:

1. **Resolve candidates from hybrid search, not exact subject equality.** The resolve candidate
   set used byte-equal subjects (`memory-curator.service.ts:603-612`) (correction from
   `forensics.md`: `resolve-prompt.ts:19` is dead code, not on the live path). Feed it from `searchRich`
   (`memory-search.service.ts:291-310`). 563 shipped part of this (M3); its gate failed, and subject
   fragmentation remains (81 subjects over 284 commitlint rows,
   `471/forensics-memory-quality.md:542-550`).
2. **Corpus sediment.** ~55% ephemeral rows (worktrees, dead branches, timeouts) were never purged.
3. **Salience has no label.** `salienceHint` is self-reported once on insert and ranking acts as a
   recency filter. Build an outcome label from `MemoryUsageRecorder`
   (`memory-contracts/src/lib/tokens.ts:4`) before anyone tunes salience.
4. **Skills: mine evidence, do not auto-author operating manuals.** Single-session and cluster
   drafts score 1.2–2.8/10 on the exemplar rubric vs 8.5–9.8 for authored skills
   (`471/skill-quality-criteria.md:197-215`). Causes: the generator forbids tables and boundaries
   (`skill-synthesizer.service.ts:240-248`), the schema is `{name, description, body}` only
   (`:68-77`), and cluster input is already the shallow candidate bodies
   (`skill-curator.service.ts:464-467`). Recommendation: harvest archaeology friction and failure
   dossiers (`session-verdict.types.ts:64-98`) for human authors.
5. **Replace the judge rubric.** The `generalization` criterion punishes the repo-grounded detail
   that makes skills useful; the rubric does not ask about decision tables, interface contracts,
   failure recovery, `## Never` rules or verification. The 8-criterion exemplar rubric (pass
   ≥64/80, no criterion <6) and a drop-in 5-criterion judge rubric are in
   `471/skill-quality-criteria.md:51-69,274-287`.
6. **Do not judge template fallbacks.** 60 of 105 judged bodies were raw trajectory fallbacks
   (composite 2.93 vs 7.28 for model-synthesized; `471/forensics-skill-funnel.md:369-379`).
7. **Promotion reachability** (`471/forensics-skill-funnel.md:381-387`): connect real invocations
   to the candidate counter, make pre-promotion repetition coherent (derive it from independent
   trajectories), unify the recurrence checks, backfill judge work for the ~2,194 candidates with no
   panel row. Verify which of these 578 already closed before re-opening any.
8. **Invocation telemetry is a behavioural proxy, not a correctness label**
   (`471/implementation-plan.md:52-62`). Any skill-quality claim needs an independent,
   human-assigned label. This constrains the skills benchmark design.
9. Rejected for any model call, still valid as constraints: the trigger-eval scoring path must never
   call a model (`gates/trigger-eval.service.ts:16-25`); the judge panel's scorecard shape must not
   vary (`skill-synthesis/CLAUDE.md`).

## Phases

1. Forensics (claims vs code paths). Output: `forensics.md`.
2. Benchmark design + Gate SR. Output: `benchmark-design.md`. Memory arm (extraction, dedup,
   update/contradiction, deletion, retention; baselines) and skills arm (frozen human-labelled
   exemplar set, rubric agreement, funnel reachability; baselines).
3. Bench implementation on the 619 shared infra + scorecard + CI gate (recorded-failure mode).
4. Fixes, each tied to a metric: items 1–7 above, 473 Track B, 588, 563 gates, 578 P1s.
5. Outcome study: do injected memory and skills improve agent outcomes vs no injection.

## Corrections from forensics.md

- Item 4: the generator prompt does not explicitly forbid tables; it steers to `## Steps` /
  `## Gotchas` only. Treat "forbids tables" as INFERRED.
- All `CLAUDE.md` files were deleted in `7917b193a`; citations to `*/CLAUDE.md` above are historical.
- Item 7: 578 closed none of the five promotion sub-items except, in part, cross-session clustering.
  Verified 2026-10-06: `SkillInvocationTracker.recordInvocation` has no production caller; the
  trigger service's private `recordInvocation` (`skill-trigger.service.ts:625`) writes events only.

## Status

- 2026-10-06: task created. Phase 1 complete: `forensics.md` (subagent), `bench-infra-fit.md`
  (codex), `references.md` (Glm), `ground-truth-sources.md` (opencode). Spot-checks passed (tracker
  has no caller; LoCoMo CC BY-NC 4.0; reversal pair e94159db7→b2c21bfc8; 2,745 candidates, 26
  authored skills). Phase 2 `benchmark-design.md` in progress (software-architect); cross-side
  review by a CLI lane follows, then the user gate.
- Phase 2: `benchmark-design.md` APPROVED by cross-side review (Glm, `benchmark-design-review.md`
  round 1 REVISE → `benchmark-design-review-r2.md` APPROVED; finding 16 tag fixed by orchestrator).
- **User gate 2026-10-06 (user decisions):** design approved for Phase 3. Q1 second rater = a second
  human (real inter-rater kappa). Q2 snapshot move approved. Q4 outcome study full size (~490
  sessions). Orchestrator defaults (user may change): Q3 = 23 authored positives + promoted stratum;
  Q5 = new non-required workflow on relevant PR paths + nightly.
- Bench data folder `C:/Users/abdal/AppData/Local/ptah-mcp-bench/snapshots/`:
  - `ptah-20261006-pre-retention.sqlite` moved there (sha256 verified `82cd16ac…d575a`; original deleted).
  - `skill-candidates-20261006/` frozen copy of `~/.ptah/skills/_candidates` (2,745 dirs, 2,745
    files); manifest `skill-candidates-20261006.manifest.json`, manifest sha256
    `73a184c53aa976ce58f28f527f2d8290ec8a80f4bb242897bfe4f0c24b6745f3`.
- Open incident from forensics: memory extraction stopped 2026-09-24 → 2026-10-01; 59,614
  observations unprocessed; retention deletes unprocessed rows at 14 days. Cause unknown.
- 2026-10-06 snapshot (user-approved, read-only `VACUUM INTO`; live DB not changed):
  `~/.ptah/bench-snapshots/ptah-20261006-pre-retention.sqlite`, 903,127,040 bytes,
  sha256 `82cd16ac39b60699c241286eda2db59b25be70c6aa85480db0be8ae7b77d575a`, schema_migrations 51,
  observation_queue 92,005, memories 26,905, memory_chunks 30,050, observation_quarantine 282.
  Benchmarks open it read-only or copy it; never write to it.

## User decisions 2026-10-07 (session feat/task-620-memory-skills-bench-s2)

- **Model-panel data flow approved ("approve all"):** U1 (105 skill documents), U2 (memory
  ground-truth drafts) and U4 (re-drawn real Claude Code session transcripts) may be sent to the
  panel providers xAI (grok), Google (antigravity) and Ollama Cloud (Glm). Raw packets, answers and
  manifests stay in `C:/Users/abdal/AppData/Local/ptah-mcp-bench`; never commit them.
- **New B24/recording gate (confirmed with the same answer):** 619 will not restart its Batch 11
  full runs, so "619 Batch 11 runs done" is dropped. Gate = 620 rebased onto 619 `181c657ab`
  (done) + message 619 before every 620 bench or recording and wait for its OK + ask the user to
  refresh the Codex login just before the recordings.
- 620 commits since: A1 `595cde626`, rebase fixture fix `012df8123`, S1 (adopt 619 model-panel
  schema) `094331fec`.
