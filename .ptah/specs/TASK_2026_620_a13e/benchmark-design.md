# TASK_2026_620_a13e — Phase 2: benchmark design (memory + skills) and Gate SR

Date: 2026-10-06. Code read at `main` `e0ca51e6e`. Shared infra read at `fix/task-619-tool-benchmark` tip `b538e8fb6`.
This document is a design. It contains no production code. Phase 3 builds it; Phase 4 fixes are tied to its metrics.

## 0. Conventions

- **Rule labels.** Every rule carries one tag:
  - **[user-requested]**: stated in the Phase 2 request or in `context.md` (primary intent, method, 619 agreement, corrections, absorbed scope).
  - **[project-rule]**: established by repository code, CI or the 619 shared-infra contract as it exists in source.
  - **[proposed]**: introduced by this design; needs no approval beyond the Phase 2 user gate unless listed in section 10.
- **Evidence labels.** **Verified** = file:line opened during this phase. **Assumption** = not verified, with the check that resolves it.
- **Words.** *Seeded* = authored ground truth injected into an isolated home. *Replay* = a recorded model response served by a deterministic double. *Local* = runs on the developer machine with model access. *CI* = runs in GitHub Actions with no network during suite execution and no model call.

## 1. Inputs, spot-checks and corrections

### 1.1 Inputs read

`context.md`, `task.md`, `forensics.md`, `bench-infra-fit.md`, `references.md`, `ground-truth-sources.md` (all in this folder); 471 `skill-quality-criteria.md`; 563 `harness/` (`extract-eval.ts`, `lib/net-guard.ts`, `lib/llm.ts`); 619 branch files below.

### 1.2 Spot-checks of Phase-1 claims this design builds on

| Claim (source) | Check | Result |
|---|---|---|
| 619 infra: `launchBenchHost`, isolation, hash guard (bench-infra-fit) | `git show fix/task-619-tool-benchmark:tools/mcp-bench/src/transport/host-launcher.ts:191-210,254-264` | **Verified.** Temp home created inside `launchBenchHost` (`:262`); env built by `isolatedEnv` from the parent env (`:191-210`). `HostLaunchOptions` has `workspaceRoot`, `hostScript`, `realHome`, timeouts, `keepAlive` only (`:130-145`). No fixture-seeding hook. |
| Scorecard schema shape (bench-infra-fit) | `scorecard.types.ts` on branch | **Verified.** Suite requires `claim` matching `ptah-core-prompt.ts:<line>`, `tool_metrics`/`native_metrics`; `na` needs `naReason`. `registerSuiteKind`, `groundTruth`, `cost.tokens.*`, `artifacts[]`, `guardMode` are **not on the branch yet** (they arrive in 619's agreed core batch). |
| Bench host boots the full CLI engine (bench-infra-fit) | `bench-host.entry.ts:1-40,84-110` | **Verified.** `withEngine` + `startCodeExecutionMcp`; refuses to boot outside the isolated home. |
| `withEngine` accepts a custom bootstrap | `libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts:186,246,533-535`; `CliDIContainer` exported `libs/backend/cli-engine/src/index.ts:15` | **Verified.** A bench host can wrap `CliDIContainer.setup` and override registrations. |
| Curator model seam | `libs/backend/memory-contracts/src/lib/curator-llm.port.ts:126-148` (`ICuratorLLM.extract/resolve`); injected at `libs/backend/memory-curator/src/lib/memory-curator.service.ts:215`; `curate(input)` at `:457` with `transcript?` in `CurateInput` `:131-145` | **Verified.** A deterministic replay double can implement the port. |
| Skills model seam | `SKILL_SYNTHESIS_TOKENS.LANE_RUNNER_SERVICE` `libs/backend/skill-synthesis/src/lib/di/tokens.ts:140`, injected in archaeologist `:311`, judge panel `judge-panel.service.ts:238`, replay validator `:237` | **Verified** token; `LaneRunnerService` is a concrete class, so a double must match its used method surface (**Assumption**, check: list the methods called on `laneRunner` across `skill-synthesis/src/lib`). |
| Lifecycle and retention take an injected clock | `memory-lifecycle.service.ts:80-83` `runStep(budget, nowMs)`; `memory-retention.service.ts:185-188` `run({now})` | **Verified.** Simulated days need no product change. |
| Lifecycle defaults 30/60/25,000 | `memory-lifecycle-config.ts:12-17` | **Verified.** Retention defaults processed 7 d, stuck 14 d: `memory-retention-config.ts:29-34`. **Verified.** |
| Salience formula | `salience-ranking.ts:1-28` | **Verified.** Hyperbolic decay on `lastUsedAt` age, `+0.3*hits/(hits+3)`, `+1` pinned. (Forensics' "7d-halflife(age)" is accurate in effect; the age is since last use, not since creation.) |
| Injection entry points | `libs/backend/agent-sdk/src/lib/helpers/memory-prompt-injector.ts:62` (`MIN_SCORE = 0.05`), `:107` `buildBlock`, `:174` `buildSessionStartBlock`, `:275` `buildCorpusBlock`; called at `sdk-query-options-builder.ts:1781-1798` | **Verified.** |
| No injection toggle | `'memory.enabled'` is a capture toggle only (`memory-trigger-config.ts:18`, `file-settings-keys.ts:369,658`) | **Verified.** The "without memory" arm must be an empty isolated DB, not a setting. |
| `SkillInvocationTracker.recordInvocation` has no production caller | Grep of `libs/` excluding specs | **Verified.** Only `skill-invocation-tracker.ts:48`, DI `register.ts:83,133`, export `index.ts:48`; the trigger service's private `recordInvocation` (`skill-trigger.service.ts:625`) is a different method. |
| Trigger-eval scoring never calls a model | `gates/trigger-eval.service.ts:16-27` | **Verified.** |
| Judge rubric (5 criteria, `generalization` punishes repo detail) | `skill-judge.service.ts:121-132` | **Verified.** |
| 471 8-criterion rubric, pass ≥64/80, no criterion <6, scale 0-10 | `471/skill-quality-criteria.md:51-66` | **Verified.** |
| Retirement idle threshold | `lifecycle/skill-retirement.service.ts:6,46,117,138` | **Verified**: `retireAfterDormantDays`, default 30 (forensics S8 says 60; the 60 belongs to a different key; resolve before writing the retire invariant). |
| Embedder seam | `PERSISTENCE_TOKENS.EMBEDDER` `persistence-sqlite/src/lib/di/tokens.ts:18`; vector path returns `[]` on dimension mismatch `memory-search.service.ts:496-497` | **Verified.** |
| 563 net guard exists | `563/harness/lib/net-guard.ts:1-25,84` | **Verified**: records (does not block) outbound connections in main thread and worker. |
| CI workflow inventory | `.github/workflows/` (21 files); `ci.yml:184,194`; `continue-on-error` precedent `publish-electron.yml:508`; scheduled-job precedent `nightly-coverage.yml:9-11` | **Verified.** |
| Curator token usage not on the port | `curator-llm.port.ts` has no usage field; 563 captured usage by reading SDK stream messages (`563/harness/lib/llm.ts:58-62,248-251`) | **Verified.** |

### 1.3 Corrections and conflicts found in this phase (recorded, not silently resolved)

| # | Position A | Position B | Resolution in this design |
|---|---|---|---|
| K1 | Request and `context.md`: "26 authored positives" | Source: `.claude/skills` has 26 dirs, but `execute-phase-gated-task` (added `b0d6647e0`, 2026-09-22) and `extract-and-relocate-angular-component-feature` are the two pipeline-promoted synthesized skills (forensics S1; their bodies use the generator's `## Steps` shape). `ptah-surface-authoring` is untracked (git status `??`), so it is not git-frozen. | **Positives = 23 human-authored, git-tracked dirs.** The 2 promoted skills form their own stratum `promoted-synthesized` (they are the whole promoted set, so they carry the precision-of-promotion measurement). `ptah-surface-authoring` joins the positives only if committed before the freeze. User confirms in Q3. |
| K2 | Forensics S8: retirement after 60 d | `skill-retirement.service.ts:6,117`: `retireAfterDormantDays`, default 30 | Phase 3 reads both keys and writes the invariant against the value in source at the pinned commit. |
| K3 | `context.md` / prompt: every 620 run goes through `launchBenchHost` | `launchBenchHost` has no hook to put fixtures (seeded DB, candidate dirs) into the temp home before spawn and does not drive curation services | Use the existing `hostScript` option with a 620-owned host entry; the host seeds its own isolated home before engine boot (section 6.1). No change to `host-launcher.ts`. Two 619-shared items are requested, not edited (section 6.6). |
| K4 | Rubric "8-criterion" scored 1-10 (prompt) | 471 rubric scores 0-10 per criterion (`skill-quality-criteria.md:51`) | 0-10, as in source. |
| K5 | 471 rubric is the independent instrument | The rubric was derived from the authored exemplars (`skill-quality-criteria.md:45-55`), so it measures resemblance to those exemplars, not usefulness | Kept as the label instrument [user-requested]; the outcome study (section 5) is the only usefulness evidence. Ledger rows say "rubric-proven", never "useful", unless the outcome study also shows it. |

## 2. Feature evidence ledger — `feature-evidence.md` template

### 2.1 Rules

- R-L1 [user-requested] One row per feature; refreshed every release; columns: metric, ground-truth source, baseline(s), measured result with scorecard run id, verdict.
- R-L2 [user-requested] Verdicts: `proven` / `no effect` / `regressed` / `not measurable yet`. `na` is never a pass, and a suite verdict `na` maps to `not measurable yet`, never to `proven`.
- R-L3 [user-requested] `proven` requires: ground truth the feature did not produce (frozen version id), at least one baseline, and the metric moved in the intended direction.
- R-L4 [proposed] Pre-registered minimum effect (MinE) per row, fixed in the ledger before the first scored run and changed only by a dated ledger edit:
  - `proven`: delta vs **every** listed baseline ≥ MinE in the intended direction, the 95% paired-bootstrap interval (fixed seed, 10,000 resamples, over cases) excludes 0, and no guard metric regresses beyond its tolerance.
  - `no effect`: interval includes 0 or |delta| < MinE.
  - `regressed`: delta beyond MinE in the wrong direction, or a guard metric regressed beyond tolerance.
  - `not measurable yet`: suite not built, ground truth not frozen or not trusted (skills κ bar unmet), production reach = 0 when the claim is about behaviour under use (reach is recorded separately), or the run produced `na`.
- R-L5 [proposed] Invariant suites (liveness, funnel, backlog) have no MinE: `proven` = invariant holds on every case; `regressed` = it held in the previous release scorecard and now fails; otherwise `no effect`. They are **not** exempt from baselines: every invariant row names a real baseline where one exists (a pure policy, an older behaviour, or an earlier snapshot). Where no alternative behaviour exists, the baseline is the **value recorded at freeze** (the `known-failures.v1.json` entry or the first release scorecard), and the row says so.
- R-L5a [proposed] A suite that executes zero cases is `na` (reason `zero-cases`), never `pass`. In CI that fails the job (section 7).
- R-L6 [user-requested] A feature with no measured effect gets a "fix or delete" proposal in its row.
- R-L7 [proposed] The ledger lives at `tools/mcp-bench/reports/task-620/feature-evidence.md` (committed; contains metrics and run ids only, no private data), next to the per-release scorecards (section 6.5).

### 2.2 Template

Columns: `Feature | Shipped in | Claim (verbatim, file:line) | Suite id | Metric (direction) | MinE / guard | Ground truth (id@version) | Baselines | Result (system vs baselines) | Scorecard run id | Verdict | Fix-or-delete proposal`.

### 2.3 Rows (pre-registered; "Result", "Run id", "Verdict" filled by Phase 3)

| Feature (shipped) | Claim to prove | Suite (section) | Metric (direction) | MinE / guard | Ground truth | Baselines | Where it runs |
|---|---|---|---|---|---|---|---|
| Retention job, stuck-row quarantine, vacuum (440, PR #513) | DB growth bounded; no useful memory lost | `mem.retention.growth` (3.7), `mem.liveness.*` (3.8) | (a) DB bytes slope over simulated days 60-180 (→ 0); (b) unprocessed observations deleted while extraction stalled (→ 0); (c) useful seeded rows lost (→ 0) | (a) slope ≤ 1% of day-60 size per 30 d; (b),(c) invariant = 0 | `gt-memory@v1` seeded facts + synthetic observation load | no retention; retention with extraction healthy | CI (replay, no model) |
| Memory age lifecycle archive/delete, cap; salience ranking (443, PR #521) | Old unused rows leave; useful rows stay; ranking beats recency | `mem.retention.lifecycle` (3.7), `mem.ranking.roster` (3.7) | false-delete ↓, false-retain ↓, loss-by-kind; roster NDCG@10 of labelled-useful subjects ↑ | false-delete MinE 10 pts vs age-only; guard: DB rows ≤ cap | `gt-memory@v1` (usefulness = asked later in a held-out question) | no lifecycle; recency-only order; oracle policy (age + hits + kind protected) | CI |
| Skills unblock: manual promote, stricter prefilter, namer, backlog cleanup (461, PR #526) | Prefilter rejects noise and keeps real routines | `skill.funnel.prefilter` (4.4); `skill.namer.collisions` (4.4) | prefilter precision and recall on labelled sessions; slug collision rate (`-2` suffixes) on frozen candidates | MinE 10 pts precision vs accept-all with recall guard ≥ 0.8; collision rate reported | `gt-skill-sessions@v1` (synthetic fixture, CI) + `gt-skill-sessions-real@v1` (human-labelled, local) | accept-all; turn-count heuristic (≥ 2 role turns only) | CI (fixture) + local (real) |
| Activity feed correctness (586, PR #620) | Feed events match the real event ledger | `skill.funnel.feed-parity` (4.4) | missing events, phantom events, wrong order, parity after restart (→ 0) | invariant | **fixture script**: `gt-skill-sessions@v1` declares, per session, the operations the bench causes (enqueue, prefilter verdict, archaeology verdict, candidate, reject with reason, judge row, promote); the expected event list is derived from that script, not from anything the pipeline writes | (a) value recorded at freeze; (b) DB-table parity (the 586 method, kept as a secondary diagnostic only, not ground truth) | CI |
| FTS stopwords + AND query; per-subject merge window (473 Track A) | Retrieval relevance vs old OR query; merge supply/rate | `mem.search.fts-and` (3.3), `mem.dedup` (3.2) | recall@10, NDCG@10 of seeded facts via in-process `searchRich` (`memory-search.service.ts:323`) BM25 leg; merge recall | MinE 10 pts recall@10 vs OR; guard NDCG@10 not lower | `gt-memory@v1` questions | old OR query (pure re-implementation pinned from the pre-473 commit, labelled as baseline code); no merge | CI |
| Extract prompt durability, searchRich merge candidates, sediment quarantine (563, PR #601) | Less sediment written; more correct merges; no over-suppression | `mem.extraction` (3.1), `mem.dedup` (3.2) | extraction precision ↑ (sediment classes), FMR ↑, durable recall not ↓ (over-suppression), merge precision/recall | MinE 10 pts precision; guard: recall drop ≤ 5 pts | `gt-memory@v1` (seeded, replay in CI); `gt-memory-real@v1` (held-out real sessions, local) | old prompt (`ebfc73321`, 563's pinned text); extract-all; byte-equal-subject merge; never merge | CI (replay of recorded current-prompt outputs) + local (live model, both prompts) |
| Skill merge, judge gate, promote on accept, retire unused (578, PR #626) | Good skills promote, bad do not; retired skills were unused | `skill.judge-agreement` (4.3), `skill.funnel.promote/retire` (4.4) | judge-vs-human Spearman, κ; positive-control pass rate; negative-control fail rate; retired-with-recent-use count (→ 0); promoted-dir deleted by reconcile (→ 0) | Spearman MinE: beat length baseline by 0.2; controls ≥ 90%; invariants = 0 | `gt-skill-rubric@v1` (human, κ-trusted) | random scorer; score-by-length; authored = ceiling | judge: local; invariants: CI |
| Memory injection into agent context (existing) | Agent outcomes improve vs no memory | `outcome.memory` (5); proxy `mem.injection.recall` (3.4) | paired task success delta; proxy: needed-fact present in `buildBlock` output | outcome MinE 22 pts (section 5.3; restated after the pilot); proxy MinE 10 pts vs last-N | `gt-outcome-memory@v1` tasks | empty DB (no memory); last-N messages; raw transcript grep | outcome: local inform-only; proxy: CI |
| Skill injection / triggers (existing) | Agent outcomes improve vs no skill | `outcome.skills` (5); `skill.delivery` (4.4) | paired task success delta; delivery: skill present in fresh workspace `.claude/skills` after promotion | outcome MinE 31 pts (section 5.3; restated after the pilot); delivery invariant | `gt-outcome-skills@v1` tasks | no skill dir; authored skill of same topic | outcome: local; delivery: CI |
| Session-start roster and corpus priming (existing) | Roster helps the agent orient | `mem.ranking.roster` (3.7) | share of roster subjects that are labelled-useful seeded facts | MinE 10 pts vs recency-only | `gt-memory@v1` | recency-only; random | CI |
| Curator trigger/admission (existing) | Observations get curated | `mem.liveness.fault` (3.8), `mem.liveness.audit` (3.8) | error passes that mark observations processed (→ 0); sessions with observations but 0 memories after 24 h (→ 0); unprocessed age p95 ≤ 24 h | invariant | fault cases (CI); snapshot audit (local) | fault cases: value recorded at freeze; audit: the previous release snapshot (first: the 2026-10-06 copy, 59,614 unprocessed) | CI + local |
| Skills pipeline backlog / drain (existing; forensics failure #9) | Queued work is drained | `skill.backlog.audit` (4.4), `skill.backlog.drain` (4.4) | queue age p95 per stage ↓; net backlog slope per stage (≤ 0); judged share of candidates ↑; share rejected by cleanup without judging | audit: invariant slope ≤ 0 and p95 ≤ 14 d; drain: invariant | audit: frozen snapshot queue/candidate rows (operational-state carve-out R-M1a); drain: fixture load script | audit: earlier snapshots (471: 605 queued; 2026-10-06 copy: 1,193 queued, 677 > 14 d, 2,347 unjudged); drain: value recorded at freeze | audit: local per release; drain: CI |
| Embedder reranker (existing; forensics M3 "inert, always 1") | Reranking improves merge-candidate order | `mem.dedup.rerank` (3.2) | NDCG@5 of the true merge target in the candidate list; reranker score variance (0 ⇒ inert) | MinE 0.05 NDCG vs no-rerank | `gt-merge@v1` should-merge pairs | no-rerank (identity order) | CI if the reranker model is in the CI cache, else local |
| Knowledge update / contradiction (implicit claim; no feature shipped) | Memory is up to date | `mem.update` (3.3) | correct / stale / omission / hallucination rates | MinE 10 pts correct vs latest-chunk-wins | `gt-memory@v1` update pairs | latest-chunk-wins; no memory; raw grep | CI |
| Temporal (implicit; docs "decisions from last week still apply") | Dated recall | `mem.temporal` (3.3) | date-anchored accuracy; share of injected hits that show a date | MinE 10 pts vs raw grep | `gt-memory@v1` temporal | raw grep (lines carry timestamps); no memory | CI |
| Abstention (implicit; `MIN_SCORE` 0.05) | Injects nothing when nothing is relevant | `mem.abstention` (3.5) | false-injection rate ↓ | MinE 10 pts vs current; guard: injection recall | `gt-memory@v1` abstention | no memory (perfect abstention, zero recall) | CI |
| Workspace/worktree write keying (existing) | Memory follows the repo | `mem.scope.write` (3.6) | rows stored under a non-canonical key for a canonical repo; `''`-keyed rows | invariant = 0 (expected fail today) | temp git repo + worktree in bench data folder | exact-string (current) | CI |
| Skill enhancer (auto-enhance after ≥ 5 runs) | Enhanced skill is better | `skill.enhancer` (4.4) | rubric delta enhanced vs original | MinE 8/80 | `gt-skill-rubric@v1` | un-enhanced skill | `not measurable yet` until promoted skills have ≥ 5 events (copy: 0) |
| Setup-wizard memory seed (existing) | Seeded facts retrievable, replace correctly | `mem.update.seed` (3.3) | correct/stale on seed-then-reseed | invariant | seed manifest fixture | append-only policy (pure: reseed appends, never supersedes) | CI |
| Trigger-eval gate (existing) | Description retrieves for should-trigger prompts | `skill.trigger-eval.human` (4.4) | precision/recall against human-labelled prompts (not self-generated) | report only | `gt-skill-triggers@v1` (human) | self-generated prompts (current) | local |
| Replay stage (existing, no producer) | "Replay is designed, not running yet" (docs) | `skill.funnel.replay` (4.4) | replay coverage (→ documented 0) | invariant: doc matches code | fixture script (no replay producer is scripted, so expected coverage = 0) | value recorded at freeze (coverage 0, all 2,587 candidates NULL on the copy) | CI; verdict `not measurable yet` by design until a producer exists |

## 3. Memory arm

Common rules:

- R-M1 [user-requested] Ground truth never comes from the system under test, and never from live-DB rows the lifecycle can delete.
- R-M1a [proposed] **Operational-state carve-out.** Two audits (`mem.liveness.audit`, `skill.backlog.audit`) measure the age and size of the system's own queues on a frozen snapshot. The quantity under test *is* that stored state; it is not a quality judgement by the system. So "independent ground truth" means: read the rows directly with read-only SQL on a frozen copy, never through the product's own counters, stats or UI (`getStats`, Thoth tiles). No quality claim (correctness, usefulness, parity) may use this carve-out. Feed parity uses the fixture script instead (2.3, 4.4).
- R-M2 [user-requested] Every suite reports at least one baseline; absolute numbers alone are not results.
- R-M3 [proposed] Write-side suites drive the real `MemoryCuratorService.curate({sessionId, workspaceRoot, transcript})` (`memory-curator.service.ts:457`, `:131-145`) inside the 620 host, then read results from the isolated DB through the product stores and `searchRich`. They do not call `ptah_memory_search` over MCP; MCP-transport recall@k is 619's (R-M10).
- R-M4 [proposed] **Fact matcher.** A seeded fact is "present" in a memory row when every required key-token set matches (case-folded, Unicode-normalised, whitespace-collapsed; each set lists accepted alternates) in `subject + content + chunk text`, and no forbidden token for that slot matches. The matcher is pure TypeScript and deterministic. **Before any suite using it gates, the matcher's agreement with a human on ≥ 100 sampled (row, fact) pairs must be ≥ 0.9 raw and κ ≥ 0.8, with the lower bound of the 95% bootstrap interval on κ ≥ 0.7.** κ is always reported with its interval (at n = 60 the interval is about ±0.1, too wide to separate 0.75 from 0.85). The sample is stratified so at least 40 pairs are true matches. The sample and labels are frozen as `gt-matcher@v1`.
- R-M5 [proposed] Model calls in CI are forbidden. CI uses a replay double for `ICuratorLLM` (section 6.2). A cassette miss is a case-level `na` with reason `cassette-miss`; a suite with any miss cannot be `pass`.
- R-M6 [proposed] Every rate is reported with its numerator and denominator, and with a 95% bootstrap interval (seed `TASK_2026_620`).

### 3.1 Extraction (HaluMem-style triple, re-implemented)

- Borrow [user-requested]: taxonomy only (HaluMem CC BY-NC-ND: no code, no data; `references.md` §11).
- Slices:
  - **Seeded** (`gt-memory@v1`, ≥ 110 facts): each fact is stated inside a deterministic templated session (section 5.1 of ground truth below) that also contains **bait**: (a) sediment lines (task ids, worktree paths, PR numbers, timeouts — the classes in the extract prompt's DO-NOT-EXTRACT list, `extract-prompt.ts:54-66` per forensics M1); (b) a hypothesis that is stated and then rejected in-session; (c) an assistant claim the user corrects. ≥ 1 bait per session, ≥ 110 baits total.
  - **Long-session class** (part of `gt-memory@v1`, ≥ 10 sessions, CI). Each session is generated long enough to plan more than 8 curator windows (about 12). It carries ≥ 2 seeded facts in the middle windows (window 4 through window n−4), which `clamp-transcript.ts` drops (forensics M2 mode (d): beyond 8 windows the middle is lost, 25% head). The metric is **middle-window recall**, reported separately from head/tail recall. Expected today: about 0. Baseline: the same facts planted in window 1 (head recall).
  - **Real held-out** (`gt-memory-real@v1`): 20 sessions from the eval window (section 5.2), each human-labelled with its durable facts (expected 2-5 per session) and its sediment lines. Local only.
- Metrics:
  - recall (Memory Integrity) = seeded facts present / seeded facts;
  - precision (Memory Accuracy) = written rows matching a seeded fact / written rows (rows matching nothing and no bait count as **unlabelled**, reported separately and excluded from precision; a human labels them in the real slice);
  - FMR = 1 − (baits written as memory / baits);
  - over-suppression = durable facts the old prompt wrote and the current prompt did not (563 M4-8(c) metric, real slice);
  - by category (extraction, multi-session, update, temporal, abstention) and by sediment class.
- Baselines: **extract-all** (every user and assistant message line becomes a row: recall ceiling, precision floor; pure function, CI); **old prompt** (563's pinned `ebfc73321` prompt text, local live model only — "old curator where possible"); **no memory** (recall 0; present so the table is complete).
- CI vs local: CI replays recorded current-prompt outputs for the seeded slice; this measures the code path from model output to stored row (window planning, resolve, store, sediment handling) with model behaviour held fixed. **The prompt's own effect is measured only locally** (live runs record new cassettes; each cassette set has a version id and the model id). [proposed]
- MCP during extraction: the extractor is meant to call `ptah_memory_search` for subject reuse (forensics M1). Local live runs execute with the 620 host's MCP attached (the 563 eval had it off, `extract-eval.ts:6-9`), so the reuse lever is measured for the first time. [proposed]

### 3.2 Dedup / merge

- Pair set `gt-merge@v1`:
  - **should-merge**: ≥ 40 seeded paraphrase pairs of the same fact in two sessions (paraphrase written by the labeller, different subject wording on purpose to exercise the 81-subjects-over-284-rows fragmentation, `context.md` item 1);
  - **should-not-merge**: ≥ 40 pairs with the same or a near subject and a different fact;
  - **563 replay set**: the 20 `merge-replay.ts` cases (`merge-replay.ts:102-115` per bench-infra-fit), human-labelled TP/FP/TN/FN; inputs copied from the snapshot into the bench data folder (private, local only).
- Metrics: merge precision, merge recall, F1; duplicate-cluster rate (seeded facts represented by > 1 active row after all sessions are curated); singleton-subject share (563 M4-8(a)); model calls per merge.
- Baselines (pure policies over the same drafts, CI): byte-equal subject (the pre-563 path), never merge, tier-1-only (case-folded subject window).
- **Reranker effect** (`mem.dedup.rerank`). Merge precision and recall cannot detect a no-op reranker, because candidate order does not change which candidates the resolve call sees. Forensics M3 records the reranker as always returning 1 (`embedder-worker.ts:277-295`, not re-run). This suite:
  - captures the merge-candidate list for every should-merge pair;
  - computes NDCG@5 of the true merge target in reranked order vs the **no-rerank** baseline (identity order from the collector);
  - reports reranker score variance per list (variance 0 on every list ⇒ inert).
  Expected today: delta 0 and variance 0. The Phase 4 row is "fix or delete the reranker" (9.2). The 563 "tier 2 always" variant is a local configuration run (**Assumption**: tier-2 behaviour is configurable without code change; check `merge-candidate-collector.ts:134` for an option, else it becomes a Phase 4 fix variant, not a baseline).

### 3.3 Knowledge update, contradiction, temporal; FTS AND vs OR

- **Update cases** (`gt-memory@v1`, ≥ 25): pairs `(v1 at t1, v2 at t2)` from git reversal/replacement pairs (e.g. `e94159db7 → b2c21bfc8`, `e102153eb → dc416858e`, `7917b193a`) and spec corrections; each value is planted in a separate seeded session, curated in date order, with a **bait value** v′ (a plausible wrong alternative) planted once as a rejected hypothesis.
- Query: a fixed current-value question per case run through `searchRich` top-10 and through `buildBlock` (what the agent actually sees).
- Outcome per case (HaluMem update triple + one class):
  - **correct**: v2 present and v1 absent or ranked below v2 with a superseded marker (no marker exists today, forensics M6, so today "correct" requires v1 absent);
  - **stale**: v1 present and ranked at or above v2, or v1 present and v2 absent;
  - **omission**: neither present;
  - **hallucination**: v′ present.
  Rates over cases; correct is the headline.
- Baselines: **latest-chunk-wins** (pure policy: among rows matching the slot, keep the newest chunk), **no memory**, **raw transcript grep** (grep the seeded sessions for the slot's key tokens; newest line wins).
- **Temporal cases** (≥ 15): date-anchored questions ("what was decided on 2026-08-17", F-004/F-005 style). Metric: accuracy of the dated fact in top-10, and **date visibility** = share of injected hits whose rendered text contains a date (the recall block prints `[subject]: chunk` only, `memory-prompt-injector.ts:107-128`, forensics M6). Baseline: raw grep (JSONL lines carry ISO timestamps). Clock: seeded sessions are curated under the case's timestamp only if `created_at` can be set from an injected clock (**Assumption**: `memory.store` stamps `Date.now()`; check the insert path; if not injectable the suite measures what the product stores and records `created_at` = curation time as a finding).
- **Seed-then-reseed** (`mem.update.seed`): the setup-wizard supersede path (`memory-writer.adapter.ts:55-90` per forensics) seeded twice with a changed value; invariant: only the new value is retrievable.
- **FTS AND vs OR** (`mem.search.fts-and`): recall@10 and NDCG@10 over the seeded questions using `searchRich` vs the pinned OR builder. Uses 619's `retrieval-metrics.ts` (`recallAtK`, `ndcgAtK`) unchanged [project-rule: reuse, never fork].

### 3.4 Injection recall (deterministic proxy for the outcome study)

- For each outcome-study task (section 5) and each seeded question: call `buildBlock(firstUserMessage, workspaceRoot)` and `buildSessionStartBlock(workspaceRoot)` on the seeded DB; metric = needed-fact present in the injected text (matcher R-M4), Acc@k all-correct rule for multi-fact tasks (LocAgent rule, `references.md` §2).
- Baselines: last-N messages (N = 50 of the seed sessions concatenated, newest last), raw transcript grep (top-5 lines by keyword hits), no memory.
- Deterministic given DB + embedder + query: gateable (section 7).

### 3.5 Abstention

- Cases (≥ 15): (a) questions whose topic is absent from the seeded corpus; (b) near-miss questions (same subject family, fact absent); (c) the 473 Track A questions whose rows the lifecycle deleted (F-010 class) re-expressed against the seeded corpus where their facts are deliberately not seeded.
- Metric: false-injection rate = cases where `buildBlock` returns a non-empty block; mean injected hits per abstention case; score distribution of injected hits vs `MIN_SCORE` 0.05 (`memory-prompt-injector.ts:62`).
- Baseline: no memory (rate 0). Guard: injection recall (3.4) must not drop more than 5 pts when a threshold fix lands.

### 3.6 Workspace and worktree scope (write side only)

- R-M10 [user-requested] Do not duplicate 619: read-side scope, isolation, worktree-to-repo recall and the spill-root bug belong to 619's `ptah_memory_search` suites. 620 references 619's scorecard run id in the ledger for the read side.
- Write-side cases: the 620 host creates a temporary git repository and one `git worktree add` **inside the bench data folder** (never the user's repository; `withPinnedCorpus` already adds a detached worktree to the real repo, so it is not used here) [proposed]. Seeded sessions are curated with `workspaceRoot` = main path, worktree path, a case-variant path, a trailing-slash path, `''`, and `null`.
- Metrics: rows stored under a key that canonicalises (git common-dir, case-folded on win32) to the main repo but differs from the main key; rows keyed `''`; two-workspace write leakage (a row from workspace A carrying B's root) = 0.
- Expected today: non-canonical share > 0 (forensics M5: 69 `''` rows, ~300 rows under 14 worktree roots). Recorded failure until the canonicalisation fix.

### 3.7 Retention, deletion, ranking

- Seeded DB (CI): `gt-memory@v1` facts inserted as rows (not extracted; this suite tests lifecycle, not extraction) with labelled `useful` (asked by a held-out question) or `disposable` (sediment rows labelled by the labeller), kinds fact/preference/event/entity, `last_used_at`/`hits` drawn from the snapshot's measured distributions with a fixed seed, plus a synthetic observation load at the snapshot's measured daily rate.
- Simulation: day 0..180 in 1-day steps calling `MemoryLifecycleService.runStep(budget, nowMs)` and `MemoryRetentionService.run({now})`; seeded "use" events replay the held-out question schedule through `recordUse` (exposure, which is what the product counts).
- Metrics:
  - **false-delete** = useful rows archived and then deleted (or evicted) before their question day; **false-retain** = disposable rows still active after `archiveAfterDays + deleteAfterDays`; both by kind;
  - **archived-then-needed** = useful rows archived on their question day;
  - **unprocessed observations deleted** with an injected 9-day extraction stall (replay double returns the stall outcome) — the M2 outage reproduced deterministically;
  - **DB bytes** per day (file size after the retention vacuum step) for the 440 growth claim;
  - **roster informativeness** (`mem.ranking.roster`): NDCG@10 of `buildSessionStartBlock` subjects against labelled-useful subjects; same for a recency-only order.
- Baselines: no lifecycle; age-only (current); **oracle policy** = age-only with useful-by-kind and `hits > 0` protected, computed as a pure policy over the same rows (shows the ceiling a fix could reach; not a product path) [proposed].
- Expected today: false-delete > 0 (forensics M4), unprocessed deleted > 0 under stall (M2).

### 3.8 Extraction liveness

- **Fault injection (CI, deterministic):** with the replay double forced to (a) throw a non-network error, (b) return zero drafts, (c) time out, (d) a boot-scan session that throws among successes, assert per case: observations stay unprocessed or are re-queued, the pass outcome is not `'ran'` for (a)/(c), and the watermark does not pass a failed session. These encode forensics M2 silent-drop modes (a)-(c) and (b′) as invariants; they are expected to fail today and are the acceptance tests for the liveness fix.
- **Re-scan duplication (CI, deterministic; M2 mode (e): no transcript-hash dedup).** Boot-scan the same seeded transcripts twice. Before the second scan, set file mtimes past the watermark with `fs.utimes` to fixed values, keeping content unchanged. Assert:
  - the second scan writes 0 new rows or chunks;
  - it makes 0 extra model calls (counted by the replay double);
  - duplicate-content groups stay unchanged.
  Baseline: the value recorded at freeze. Expected today: re-extraction > 0.
- Mode (d) is covered by the long-session class in 3.1.
- **Snapshot audit (local; R-M1a carve-out; baseline = previous release snapshot, first = 2026-10-06 copy):** on each release snapshot (copied into the isolated home, opened read-only): `unprocessed_observation_age_p95`, `sessions_with_observations_but_0_memories` older than 24 h, extraction-pass error share, count of `'ran'` passes carrying an error. Ground truth = `observation_queue` and transcript files, not the extractor. **Assumption**: `observation_queue` carries `session_id` and `memories.session_id` is populated for extracted rows (forensics M2 joins them; check the 0051 schema).
- Invariants: p95 ≤ 24 h; sessions-with-observations-but-0-memories (older than 24 h) = 0.

## 4. Skills arm

### 4.1 Frozen labelled set `gt-skill-rubric@v1`

- R-S1 [user-requested] Freeze `~/.ptah/skills/_candidates` by copy + SHA-256 before labelling (2,745 dirs, `context.md` Status).
- R-S2 [user-requested] Invocation telemetry is a behavioural proxy; any skill-quality claim needs an independent human label (`context.md` decision 8).
- Composition (105 documents) [proposed]:

| Stratum | n | Source |
|---|---:|---|
| `authored` | 23 | git-tracked human-authored `.claude/skills/*/SKILL.md` at the pinned commit (K1) |
| `promoted-synthesized` | 2 | `execute-phase-gated-task`, `extract-and-relocate-angular-component-feature` |
| `anchor-471` | 10 | the 10 candidates 471 scored (`skill-quality-criteria.md:72-87`) |
| `suggestion` | 18 | all 18 cluster suggestions on the snapshot |
| `judged-model` | 20 | model-synthesized candidates, stratified by an axis independent of the judge: creation week (4 bands) × transcript size (above/below median), by `sha256(seed + slug)` order within each cell |
| `fallback` | 20 | template-fallback bodies (**Assumption**: a fallback can be identified from body shape or a DB field; check `skill-synthesizer.service.ts` fallback builder ~`:316-342`; if not identifiable, merge into `random`) |
| `random` | 12 | uniform from the remainder, by `sha256(seed + slug)` order |

- Freeze artefacts (bench data folder, never the repo): `candidates-20261006/` copy; `manifest.json` = `{opaqueId, stratum, relPath, sha256, bytes}` per file; the snapshot's `skill_candidates`/`skill_suggestions` rows exported for the sampled ids. The repo holds `skill-docs.v1.json` = `{opaqueId, stratum, sha256}` only.
- Before freezing: walk the copy and diff against `skill_candidates` rows (unknown in `ground-truth-sources.md`); report missing bodies.

### 4.2 Blind labelling protocol and agreement bar

- Instrument [user-requested]: 471 8-criterion rubric, C1-C8 scored 0-10, pass = total ≥ 64/80 and no criterion < 6 (`skill-quality-criteria.md:51-66`).
- Blinding [proposed]: each document rendered as one file named by its opaque id; frontmatter `name` replaced by the opaque id; `references/` files inlined below a fixed separator for every stratum (so presence of references is visible but not the directory layout); order shuffled per rater with a recorded seed. Raters do not see stratum, pipeline score or slug.
- Known blinding limit: the user authored many positives and will recognise them. Therefore agreement is reported on the whole set **and** on the candidates-only subset (80 docs, strata other than `authored`/`promoted-synthesized`), and the ledger uses the candidates-only figures where they differ.
- Raters: two raters label independently; a third adjudicates any item where pass/fail differs or totals differ by > 12. Who the second rater is: Q1. Model raters are not raters [user-requested via R-S2].
- Agreement metrics (`agreement-metrics.ts`, section 6):
  - Cohen's κ on pass/fail;
  - Spearman ρ on totals;
  - quadratic-weighted κ per criterion (diagnostic);
  - raw agreement.
- **Trust bar** [proposed, κ ≥ 0.6 carried from `ground-truth-sources.md` (b)]:
  - full-set κ ≥ 0.6 and ρ ≥ 0.7;
  - candidates-only ρ ≥ 0.6 (κ may be undefined there if all fail, so it is reported with raw agreement);
  - anchor stability: ≥ 8 of the 10 `anchor-471` items re-scored within ±8/80 of 471's committed totals.
  - Until all three hold, every suite that uses `gt-skill-rubric@v1` emits `na` with reason `ground-truth-untrusted`.
- If only one human is available (Q1, option 2): the same rater re-labels after ≥ 14 days with a new shuffle; this is **intra-rater** agreement, labelled as such in `groundTruth.method`, and the trust bar is the same.
- Label storage: `tools/mcp-bench/fixtures/task-620/skill-labels.v1.csv` (`opaqueId, raterId, c1..c8, total, pass, note, ratedAt`) plus `skill-adjudication.v1.csv`; committed with a SHA-256 in `fixtures/task-620/MANIFEST.json`.

### 4.3 Judge-agreement suite `skill.judge-agreement` (local only)

- Run `SkillJudgeService` (rubric `skill-judge.service.ts:121-132`) and `JudgePanelService` (`judge-panel.service.ts:231`) on all 105 documents through the real lane runner, 3 repeats each, pinned model id and prompt SHA-256 recorded.
- Metrics:
  - Spearman(judge composite, human adjudicated total);
  - κ(judge pass at the pipeline threshold, human pass);
  - per-document score SD across repeats;
  - **saturation share** (score = 10.0; forensics S5: 11/18).
- **Positive control**: `authored` stratum must pass the judge gate at ≥ 90%.
- **Negative control**: the `fallback` stratum plus 10 planted degenerate documents (restated user request; raw trajectory dump; empty steps; a correct skill with its trigger description deleted; a body copied from another skill with the name changed) must fail at ≥ 90%. The planted documents are written once by the labeller and frozen in the repo (synthetic, not private) [proposed].
- Baselines: random scorer (expected ρ ≈ 0), **score-by-length** (ρ of body characters vs human total). The judge is "informative" only if ρ beats length by ≥ 0.2.
- Known selection limit: the `anchor-471` stratum (10 docs) was chosen by 471 as the pipeline judge's top scores (`skill-quality-criteria.md:72-87`). Judge-agreement figures are therefore also reported without that stratum. All other strata are selected independently of the judge.
- Gate status: inform-only for CI (LLM judge) [user-requested: do not gate on LLM-judge accuracy, `references.md` recommendations]. Its recorded run is still valid ledger evidence for 578's "judge gate" row (R-L4 applies to the recorded numbers).

### 4.4 Funnel reachability `skill.funnel.*` (CI, replay)

- Fixture `gt-skill-sessions@v1` (synthetic, committed): 30 JSONL sessions in a temp project dir: 12 contain one of 4 routines, each routine repeated across ≥ 2 sessions (3 sessions each); 10 are non-routine (Q&A, aborted, single edit); 8 are degraded (unreadable lines, unsupported tool use). Each session is labelled `routine: id | none` and `degraded: bool`. Each session also carries a **script**: the ordered operations the bench causes for it, from which the expected activity-feed events are derived (ground truth for `feed-parity`, independent of what the pipeline writes). Lane outputs (archaeologist, synthesizer, judge, panel) come from a recorded cassette (section 6.2).
- Determinism of time and concurrency [proposed]:
  - Every time-based invariant (retire idle window, reconcile timeout, queue age) runs on an injected clock or scheduler. Wall-clock durations are never asserted and never written into the deterministic projection (section 7).
  - A real-time safety cap (120 s per case) only aborts a hung case as `fail`, with reason `safety-cap`.
- Stages, counts and invariants (each stage reports `in`, `out`, and per-invariant pass/violations with example ids):

| Stage | Invariant | Source of the rule | Expected today |
|---|---|---|---|
| prefilter | recall on labelled routine sessions ≥ 0.9; precision vs accept-all reported | 461 claim | measure |
| archaeology | runs before authoring for every accepted session; degraded/no-routine verdict ⇒ no candidate, with a visible reason; **verdict accuracy** vs fixture labels: `routine` (id or none) accuracy and `degraded` accuracy, reported with counts (CI measures the recorded cassette output; live accuracy is measured locally on `gt-skill-sessions-real@v1`) | 588 [user-requested, absorbed]; forensics S3 | fail (nightly-only, `skill-drain.service.ts:396-408` per forensics); accuracy: measure (baseline: majority-class "no routine") |
| cluster | a cluster counts ≥ 2 distinct sessions; no single-session auto-candidate | 588 | fail |
| draft | template fallback is marked and never judged | 471 decision 6 | fail |
| judge | every non-fallback draft gets a panel row within one drain cycle (backfill); panel scorecard shape constant | 471 decision 7, decision 9 | fail (2,347 unjudged on the copy) |
| promote | real invocations recorded by the trigger service reach the candidate success counter; distinct contexts counted; ≥ 1 automatic promotion for a routine with 3 recorded successful uses; promoted count ≤ cap when two promotions are interleaved under a **scripted schedule** (below) | 471 decision 7; 578 P1 over-cap race | fail (tracker has no caller) |
| retire | a skill with an invocation event inside `retireAfterDormantDays` (injected clock) is never retired, re-checked at commit time; boot reconcile never deletes a promoted dir; reconcile wait settles with a timeout outcome once the **injected clock** passes the bound while a fake dependency never resolves | 578 P1s | fail (forensics S8; today the wait has no timeout, so the case ends at the safety cap and is recorded as `fail`) |
| delivery | a promoted skill appears in a fresh workspace's `.claude/skills` (Electron/CLI repropagation) | C-S3 | measure |
| feed-parity | feed events = the expected event list derived from the fixture script (no missing, no phantom, scripted order); same after host restart. DB-table parity is reported as a secondary diagnostic only | 586 | measure |
| replay | coverage = 0 and docs say "not running yet" | C-S8 | holds |
| backlog drain (`skill.backlog.drain`) | under a scripted load (sessions enqueued per simulated day at the snapshot's measured weekly rate, the 50-470/week range), with drain ticks on the injected clock: net backlog slope per stage ≤ 0 over 30 simulated days; queue age p95 ≤ 14 simulated days; judged share of non-fallback candidates = 1 at the end | forensics failure #9, S4 | fail (drain arithmetic: one prefilter per workspace per tick, per 471) |

- **Scripted interleaving (over-cap race)** [proposed]: two promotions run with the cap set to current-promoted + 1. The replay double and a store hook pause each promotion at each `await` point before the compare-and-set, and the suite releases them in every order: A-then-B, B-then-A, and alternating at each pause point. The invariant is checked after every schedule. **Assumption**: the promotion path has a pause point the double or a test hook can hold. Forensics S8 says one process has no `await` between read and compare-and-set. If Phase 3 confirms that, the race cannot occur in one process: the case records `pass` with reason `no-interleaving-point` and the 578 P1 row is closed as "not reproducible in one process".
- **Injected clock for retire/reconcile** — **Assumption**: the retirement service and the reconcile wait read time through an injectable clock or scheduler. Check `skill-retirement.service.ts:117-138` and `skill-curator.service.ts:271`. Where they read `Date.now()`/`setTimeout` directly, the 620 host installs a fake-timer scheduler inside the host process for that suite only. If that cannot cover the code, the Phase 4 fix makes the clock injectable as part of its acceptance.
- **Backlog audit** (`skill.backlog.audit`, local per release; R-M1a carve-out) on the frozen snapshot with read-only SQL:
  - queue age p95 per stage (prefilter, archaeology, judge-panel, trigger-eval);
  - net backlog slope per stage from enqueue and done timestamps by week;
  - judged share of candidates;
  - share of candidates rejected by cleanup without a judge row.
  Baselines: 471's figures (605 queued) and the 2026-10-06 copy (1,193 queued prefilter, 677 rows > 14 d, 2,347 of 2,587 unjudged); after that, the previous release snapshot.

- Also measured on the frozen candidates (pure, CI): slug collision rate (namer, 461).
- `skill.trigger-eval.human` (local): human-labelled should/should-not-trigger prompts for the 23 authored skills (5 + 5 each) scored with the existing embedder arithmetic path; compares to the self-generated-prompt score (self-consistency baseline).

### 4.5 Execution-based verification (Voyager / SkillWeaver)

- Adopted only where deterministic [user-requested condition]. Ptah skills are markdown procedures, not executable code; no candidate on the copy declares a machine-checkable verification command. **Not adopted in v1.**
- Recorded option for Phase 4 if 473 Track B's wider schema adds a `verify` field (command + expected exit code against a pinned corpus via `withLifecycleCorpus`): such a skill gets an execution check in `skill.funnel.promote`; skills without one are unaffected [proposed].

## 5. Outcome study (Phase 5, local, inform-only)

### 5.1 Design

- R-O1 [user-requested] With vs without memory / skills injection on a fixed task set; Reflexion-style ablation as the primary comparison (`references.md` §9).
- **Memory arm** `gt-outcome-memory@v1`: 48 tasks run on a `withLifecycleCorpus` copy of the pinned repo. Each task's correct completion depends on a fact decided in a seed-window spec or commit and not derivable from the code at the pinned commit (e.g. "add a provider default following the convention decided in TASK_x", "answer: which account keys Antigravity owners now"). Conditions per task:
  - **M+**: isolated home with the seeded DB (facts curated from the seeded sessions through the current pipeline);
  - **M0**: same home, empty DB with the same schema (no memory; there is no injection toggle);
  - **L50**: last 50 messages of the relevant seed sessions pasted as the first message prefix;
  - **G**: raw transcript grep top-5 lines prepended.
- **Skills arm** `gt-outcome-skills@v1`: 24 tasks whose trigger matches one of 8 authored skills or the 2 promoted skills. Conditions:
  - **S+**: skill dir present in the corpus copy's `.claude/skills`;
  - **S0**: absent;
  - for the 2 promoted skills, also **SA**: the closest authored skill instead.
- Success is scored by a deterministic check written with the task (a test command's exit code, a grep assertion on the diff, or normalised exact/partial-F1 match for answer tasks, LoCoMo style `references.md` §3). No LLM judge [user-requested].
- Recorded per run: success, turns, tool calls, tokens input/output (from SDK result messages, the 563 `llm.ts:248-251` approach), wall time, model id.

### 5.2 Determinism controls

- Pinned model id.
- Fixed corpus commit.
- Isolated home per condition run.
- Task order randomised per repeat with a recorded seed.
- Conditions of one task run back-to-back to limit model-drift confounds.
- 2 repeats per task × condition (aggregated as in 5.3).

### 5.3 Aggregation and sample size

- **Aggregation rule** [proposed]:
  - unit of analysis = task; per task and condition, score `s = mean success over the r = 2 repeats` ∈ {0, 0.5, 1};
  - pairing at task level: `d_task = s(with) − s(without)`;
  - estimate = mean of `d_task`; interval = paired bootstrap over tasks (10,000 resamples, fixed seed).
  - "Reliable success" (both repeats succeed) is reported as a secondary binary view. It does not decide the verdict.
- **MDE under this rule.** MDE ≈ 2.8 × σ_d / √n (α = 0.05 two-sided, power 0.8), with σ_d² = σ²_between + σ²_within / r:
  - With no pilot yet, σ_d² is bounded from a single-run discordant share p ≈ 0.3 (**assumption**), giving σ_d² between 0.15 (all variance within a task, halved by r = 2) and 0.30 (all variance between tasks).
  - Memory, n = 48: MDE ≈ 16-22 pts.
  - Skills, n = 24: MDE ≈ 22-31 pts.
  - Ledger MinE is set at the conservative ends, **22 / 31 pts**.
- **Pilot re-estimate** [proposed]: after the first repeat of all tasks, compute σ_d from the observed per-task differences, then restate the MDE and MinE in the ledger, dated, before the second repeat runs. No `no effect` verdict is read from the study until this restatement exists. If the restated MDE exceeds the MinE by more than 5 pts, the row stays `not measurable yet` (underpowered) instead of `no effect`.
- Session count: memory 48 × 4 × 2 = 384; skills 24 × 2 × 2 + 6 × 2 (SA) = 108. Budget approval: Q4.

### 5.4 Gate or inform

- The agent loop is stochastic and needs model access, so the study is **inform-only** and never a CI gate [proposed].
- Its results still decide the ledger verdict for the two injection rows (recorded run id, paired bootstrap interval).
- The **gateable proxy** is `mem.injection.recall` (3.4): deterministic given DB, embedder and query, and it runs in CI.
- A memory fix may claim "outcome improved" only from this study, and "agent now sees the fact" from the proxy.

## 6. Runner and scorecard

### 6.1 Execution envelope

- R-X1 [user-requested] Every 620 run goes through `launchBenchHost`. Bench processes never open a path under the real `~/.ptah`; fixtures are copied into the isolated home.
- R-X2 [proposed] 620 supplies its own host script through the existing `hostScript` option (`host-launcher.ts:130-145`). The script:
  1. checks isolation the same way 619's entry does;
  2. reads `PTAH_BENCH_620_PLAN` (a JSON plan path inherited through `isolatedEnv`, which spreads the parent env, `host-launcher.ts:191-210`);
  3. copies the plan's fixtures (seeded DB, candidate dirs, session JSONLs) from the bench data folder into the isolated home **before** engine boot;
  4. boots `withEngine` with a bootstrap that wraps `CliDIContainer.setup` and overrides `CURATOR_LLM`, `LANE_RUNNER_SERVICE` and, in CI, nothing else (`with-engine.ts:186,246`);
  5. starts the HTTP MCP so the launcher's readiness probe passes;
  6. executes the plan's suites in-process, writing per-case artefacts to the run directory;
  7. prints a completion line, then waits for stdin EOF.
  The runner (parent) then stops the host, which runs the guard.
- Offline suites (rubric agreement from CSV, pure baseline policies) run in the parent **inside the guarded window** so a run is always one launcher session [proposed]. This reads `context.md`'s "every 620 run goes through `launchBenchHost`" as "every run is enclosed by one launcher session". The reading needs 619's confirmation (6.6 item 6) before P3-B8 builds the runner. If 619 declines, these computations move into the 620 host's plan.
- Guard mode: `process-watch` when 619 ships it; until then `hash`. A local `hash` run with Ptah.exe active will fail closed (`host-launcher.ts:13-18`), so local runs document whether the desktop app was stopped [project-rule].
- Model auth inside the isolated home: **Assumption**. The SDK's credential lookup follows `HOME`, so local live runs need provider auth passed by env (for example an API key variable) or a copied credential file. Check before the first live run; a missing credential is a run-level failure, never a silent skip.
- State the 620 host writes besides the DB (to report to 619 per `context.md`):
  - `<tempHome>/.ptah/skills/_candidates/**`, `<tempHome>/.ptah/skills/<slug>/`, `<tempHome>/.ptah/user/skills/**`;
  - the corpus copy's `.claude/skills/**`;
  - `<benchData>/runs/<runId>/**`;
  - `<benchData>/git-scope/<runId>/` (temp repo + worktree).

### 6.2 Record / replay doubles

- `RecordedCuratorLlm implements ICuratorLLM` (`curator-llm.port.ts:126`):
  - **record** wraps the real adapter and writes `{key, method, model, promptSha, response, usage?}` where `key = sha256(method + canonical JSON of inputs)`;
  - **replay** serves by key; a miss throws a typed error, which the suite maps to `na: cassette-miss`.
- `RecordedLaneRunner`: same scheme for `LANE_RUNNER_SERVICE`. **Assumption** on the method surface (1.2).
- Cassette storage:
  - seeded / synthetic inputs → `tools/mcp-bench/fixtures/task-620/cassettes/<suite>/<cassetteVersion>.jsonl` (committed; contains only synthetic text);
  - real-session inputs → bench data folder (private).
- Embedder in CI: the real embedder with model files restored from a CI cache keyed by model id. Network is allowed only in the cache-fill setup step; suite execution runs with 563's net recorder pattern (`net-guard.ts`), and any recorded outbound attempt fails the run [proposed].
- **Assumption**: embeddings are reproducible enough across win32 (record) and linux (CI) that resolve-candidate lists (part of the cassette key) match. Check: replay the seeded cassettes on Linux once; if the miss rate > 0, cassette keys for `resolve` exclude candidate order (sorted ids), and if misses remain, the affected suites become local-only.

### 6.3 Suite kinds and `details` schemas (registered by 620, in 620's own file)

- R-X3 [user-requested] 620 registers kinds through `registerSuiteKind(kind, zod)` in its own file and never edits `scorecard.types.ts` / `scorecard-writers.ts`. A missing core field is requested from 619 through the named session.
- Generic core fields 620 fills (from the 619 agreement; not yet on the branch):
  - `claim {source, ref, text?}`: ref = the ledger claim's file:line;
  - `suite.kind`, `suite.arm?` (`memory` | `skills` | `outcome`);
  - `groundTruth {id, version, method, raterCount?, frozenAt?}`;
  - `baselines[]`, `deltas`;
  - `cost {calls, latency_ms{p50,p95}, error_rate, tokens{result_p50?, input?, output?, billed?}}`;
  - `artifacts[] {kind, path, sha256, schemaId}`;
  - `run.guardMode`.
- Sketches (zod, illustrative — Phase 3 writes them against the core as shipped):

```ts
const int = z.number().int().nonnegative();
const rate = z.number().min(0).max(1).nullable();
const confusion = z.object({ tp: int, fp: int, fn: int, tn: int.optional(), unlabelled: int.optional() });
const interval = z.tuple([z.number(), z.number()]).nullable();

// kind: 'curation'
export const curationDetails = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('extraction'), slice: z.enum(['seeded', 'real']),
    confusion, recall: rate, precision: rate, f1: rate, fmr: rate, baits: int,
    overSuppression: rate, byCategory: z.record(confusion), bySedimentClass: z.record(int),
    matcher: z.object({ id: z.string(), version: z.string() }), cassette: z.string().nullable() }),
  z.object({ operation: z.literal('dedup'), pairs: confusion, mergePrecision: rate, mergeRecall: rate,
    duplicateClusterRate: rate, singletonSubjectShare: rate, callsPerMerge: z.number().nullable() }),
  z.object({ operation: z.literal('update'), cases: int, correct: rate, stale: rate, omission: rate,
    hallucination: rate, readPath: z.enum(['searchRich', 'buildBlock']) }),
  z.object({ operation: z.literal('temporal'), cases: int, accuracy: rate, dateVisibleShare: rate }),
  z.object({ operation: z.literal('abstention'), cases: int, falseInjectionRate: rate, meanInjectedHits: z.number() }),
  z.object({ operation: z.literal('injection-recall'), cases: int, accAllCorrect: rate, recall: rate, k: int }),
  z.object({ operation: z.literal('retention'), policy: z.enum(['current', 'none', 'age-only', 'oracle']),
    simulatedDays: int, falseDelete: confusion, falseRetain: confusion,
    byKind: z.record(z.object({ falseDelete: int, falseRetain: int })),
    archivedThenNeeded: int, unprocessedObservationsDeleted: int,
    dbBytesByDay: z.array(z.object({ day: int, bytes: int })) }),
  z.object({ operation: z.literal('ranking'), target: z.enum(['roster', 'fts-and']),
    ndcgAt10: rate, recallAt10: rate }),
  z.object({ operation: z.literal('rerank'), lists: int, ndcgAt5: rate, ndcgAt5NoRerank: rate,
    zeroVarianceLists: int }),
  z.object({ operation: z.literal('scope-write'), rowsByKeyClass: z.record(int),
    nonCanonicalShare: rate, emptyRootRows: int, crossWorkspaceLeaks: int }),
]);

// kind: 'liveness'
export const livenessDetails = z.object({
  source: z.enum(['fault-injection', 'rescan', 'snapshot-audit']),
  rescan: z.object({ newRows: int, extraModelCalls: int, duplicateGroupsDelta: int }).nullable(),
  snapshotSha256: z.string().nullable(),
  unprocessedAgeP95Ms: z.number().nullable(),
  sessionsWithObservationsNoMemories: int.nullable(),
  ranPassesWithError: int.nullable(),
  faults: z.array(z.object({ fault: z.string(), expected: z.string(), observed: z.string(), pass: z.boolean() })),
});

// kind: 'rubric'
export const rubricDetails = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('inter-rater'), rubricId: z.literal('471-exemplar-8'), rubricVersion: z.string(),
    raters: z.array(z.string()).min(1), intraRater: z.boolean(), items: int, strata: z.record(int),
    kappaPassFull: z.number().nullable(), spearmanTotalFull: z.number().nullable(),
    spearmanTotalCandidates: z.number().nullable(), rawAgreement: rate, adjudicated: int,
    anchorStability: z.object({ items: int, withinTolerance: int }), trusted: z.boolean() }),
  z.object({ mode: z.literal('judge-vs-human'), judge: z.enum(['skill-judge', 'judge-panel']),
    model: z.string(), promptSha256: z.string(), repeats: int,
    spearman: z.number().nullable(), kappa: z.number().nullable(), meanRepeatSd: z.number().nullable(),
    saturationShare: rate, positiveControl: z.object({ n: int, passRate: rate }),
    negativeControl: z.object({ n: int, failRate: rate }),
    baselines: z.object({ lengthSpearman: z.number().nullable(), randomSpearman: z.number().nullable() }) }),
]);

// kind: 'funnel'
export const funnelDetails = z.object({
  fixtureId: z.string(),
  stages: z.array(z.object({
    stage: z.enum(['prefilter', 'archaeology', 'cluster', 'draft', 'judge', 'promote', 'retire',
      'delivery', 'feed-parity', 'replay', 'backlog-drain']),
    in: int, out: int,
    invariants: z.array(z.object({ id: z.string(), pass: z.boolean(), violations: int,
      exampleIds: z.array(z.string()).max(10) })),
  })),
  precision: rate.optional(), recall: rate.optional(), slugCollisionRate: rate.optional(),
  archaeologyAccuracy: z.object({ routine: rate, degraded: rate, n: int }).optional(),
  backlog: z.array(z.object({ stage: z.string(), ageP95Days: z.number().nullable(),
    slopePerWeek: z.number().nullable(), judgedShare: rate })).optional(), // drain (fixture) or audit (snapshot)
  projectionSha256: z.string(), // section 7, R-C4; every 620 kind carries this field until 619 adds it to the core (6.6 item 7)
});

// kind: 'outcome'
export const outcomeDetails = z.object({
  arm: z.enum(['memory', 'skills']), tasks: int, repeats: int, model: z.string(), deterministic: z.literal(false),
  conditions: z.array(z.object({ id: z.enum(['M+', 'M0', 'L50', 'G', 'S+', 'S0', 'SA']),
    successRate: rate, ci95: interval, turnsP50: z.number().nullable(), tokensInputP50: z.number().nullable() })),
  pairedDelta: z.object({ versus: z.string(), estimate: z.number().nullable(), ci95: interval }).array(),
});
```

### 6.4 Artefacts per case

- One JSONL per suite in `<benchData>/runs/<runId>/<suiteId>.cases.jsonl`, one line per case: `{caseId, inputSha256, expected, observed, outcome, baselineOutcomes, cassetteKey?, latencyMs, error?}`. `schemaId` = `620.case.<kind>.v1`.
- Also per run:
  - the isolated DB after the suite (retention/update suites only), `VACUUM INTO` the run dir, sha256 recorded;
  - rater CSV hashes;
  - raw judge outputs (local);
  - cassette file hash;
  - the plan JSON.
- The committed scorecard references artefacts by sha256 and run-relative path only. Real-session content never enters the scorecard or the repo [user-requested].

### 6.5 Cost and scorecard retention

- Cost per suite:
  - `calls` = model calls + MCP calls;
  - `latency_ms {p50, p95}` per call via 619 `cost-metrics.ts` (`p50Latency`, `p95Latency`, `errorRate`) [project-rule];
  - `tokens.input/output` from recorded usage (cassette `usage`, or SDK result messages in live runs);
  - `tokens.billed` = provider-reported billable total when available.
- A token field that was not captured is `null` and never imputed [proposed]. Replay runs report the recorded usage under `tokens` with `cost.source = 'cassette'` if the core allows a source tag (else note in `naReason` of a separate cost suite; request from 619).
- Per-release scorecards: `tools/mcp-bench/reports/task-620/<productVersion>/scorecard.json|md` (committed; metrics only) [proposed].

### 6.6 Requests to 619 (send via session `ptah-ptah-extension-compare-grep-and-our-7799a800005aw2q23htdi0b`; do not edit)

1. Export the isolation check and engine/MCP boot from `bench-host.entry.ts` (or a small helper module) so the 620 host reuses them instead of copying ~60 lines (reuse, never fork).
2. Confirm or name the bench-data env var and helper (`%LOCALAPPDATA%\ptah-mcp-bench`, `~/.cache/ptah-mcp-bench`; this design writes `PTAH_MCP_BENCH_DATA_DIR` as a placeholder).
3. Agree that 620 adds targets to `tools/mcp-bench/project.json` (`build-host-620`, `bench-620`) or gets its own `project.json` under `tools/mcp-bench-620/` — 619 owns the file.
4. A `cost.source` tag (`live` | `cassette`) and a nullable `tokens.billed`, if not in the core batch.
5. The non-DB state paths listed in 6.1.
6. Confirm that pure offline computations (rubric agreement over committed CSVs, pure baseline policies) may run in the runner process inside the guarded launcher window (6.1), or require them inside the host.
7. A core `suite.projectionSha256` field (the deterministic projection of R-C4), so 620 does not repeat it in every `details` schema.

## 7. CI gate (recorded-failure mode)

- R-C1 [user-requested] CI gate in recorded-failure mode first.
- R-C2 [proposed] CI runs only suites that are deterministic, network-free during execution, and model-free.

| Suite | CI | Local |
|---|---|---|
| `mem.extraction` seeded (replay), `mem.dedup` seeded + pure baselines, `mem.update`, `mem.temporal`, `mem.abstention`, `mem.injection.recall`, `mem.search.fts-and`, `mem.retention.*`, `mem.ranking.roster`, `mem.scope.write`, `mem.liveness.fault`, `mem.update.seed` | yes | yes |
| `skill.funnel.*` (replay, injected clock, scripted interleaving), `skill.backlog.drain`, slug collisions, `mem.liveness.rescan`, long-session class | yes | yes |
| `mem.dedup.rerank` | yes if the reranker model is in the CI cache, else no | yes |
| `skill.backlog.audit` (snapshot) | no | yes, per release |
| `skill.rubric.inter-rater` (pure computation over committed CSVs) | yes (recomputes; fails if CSV hash ≠ manifest) | yes |
| `mem.extraction` real slice, old-prompt baseline, live-cassette recording | no | yes |
| `mem.dedup` 563 replay set (private inputs) | no | yes |
| `mem.liveness.audit` (snapshot) | no | yes, per release |
| `skill.judge-agreement`, `skill.trigger-eval.human` | no | yes |
| `outcome.*` | no | yes (Phase 5) |

- Placement [proposed]: a new workflow `.github/workflows/memory-skills-bench.yml` on pull requests touching `libs/backend/memory-*`, `libs/backend/skill-synthesis/**`, `libs/backend/agent-sdk/src/lib/helpers/memory-prompt-injector.ts`, `libs/backend/agent-sdk/src/lib/curator-llm-adapter/**`, `tools/mcp-bench/**`, plus nightly (precedent `nightly-coverage.yml:9-11`). Not a required check until R-C4. Q5 confirms.
- **Recorded-failure semantics** [proposed], via a committed `tools/mcp-bench/fixtures/task-620/known-failures.v1.json` (`{suiteId, metric, direction: 'higher-is-better' | 'lower-is-better', recordedValue, tolerance, toleranceReason?, ledgerRow, since}`):
  - **direction** is mandatory on every entry. "Worse" means moved against `direction` by more than `tolerance`; "better" means moved with it by more than `tolerance`.
  - **tolerance** defaults to 0 for CI suites, which are deterministic. A non-zero tolerance needs a written `toleranceReason`, so a worsening cannot hide inside an unexplained band.
  - a listed `fail` whose value equals the recorded value (or lies within the stated tolerance) is reported and does not fail the job;
  - a listed `fail` that got **better** but still fails fails the job with "tighten `recordedValue`", so the floor ratchets with every improvement;
  - **zero executed cases ⇒ `na` (reason `zero-cases`) ⇒ fails the job** (R-L5a). A suite whose rates are computed over an empty denominator can never look green;
  - a `fail` not listed, a listed failure that worsened beyond tolerance, a `na` on a CI suite, a cassette miss, a guard trip, or a net-recorder hit **fails the job**;
  - a listed failure that now passes fails the job with "remove the known-failure entry" (ratchet), so the list only shrinks.
- The job uploads the scorecard and case artefacts (synthetic only) as a workflow artefact.
- **Moving a suite from recorded to enforcing** (R-C4) [proposed], all of:
  1. its ground truth is frozen with a version id and, for skills, trusted (4.2);
  2. 10 consecutive nightly runs on `main` produced an identical **deterministic projection** of the suite (determinism proof). The projection is canonical JSON (sorted keys, numbers rounded to 6 decimals), hashed with SHA-256, holding:
     - verdict;
     - `details` quality fields;
     - per-case `{caseId, inputSha256, expected, observed, outcome}`;
     - `groundTruth`;
     - cassette version.
     It **excludes** `cost` (calls are kept, latency and tokens are not), per-case `latencyMs`, run id, timestamps, host pid and port, and safety-cap timing. The runner writes the projection hash into the scorecard so the comparison is a string match;
  3. its known-failure entry is gone (the fix landed, or the user accepted the current value as the floor);
  4. the user approves the flip at a phase gate.
  The workflow then becomes a required check for those suites.
- Local-only suites never enforce; their numbers enter the ledger with run ids.

## 8. Gate SR — claims the benchmark cannot measure as stated

Rule [user-requested]: any claim that cannot be met as stated goes to the user with a rewording or deletion. Claims the benchmark measures (even if they fail today) are listed after the table for completeness.

| # | Claim (file:line, from forensics §4/§5) | Why it cannot be measured as stated | Proposal (user decides) |
|---|---|---|---|
| SR-1 | "learns your workflows" `apps/ptah-landing-page/src/index.html:48`; "extracts, judges, and promotes repeated session trajectories" `public/llms.txt:12`; docs home `index.mdx:49-51` (C-S12) | "Learns" has no observable; automatic promotion is unreachable (tracker has no caller) | Reword: "Proposes skills from repeated sessions for you to review and accept." Restore stronger copy only after `skill.funnel.promote` passes. |
| SR-2 | "A single workflow that succeeds enough times promotes itself. No review screen, no Accept button" `skill-synthesis/index.mdx:10,21`, `how-it-works.mdx:38-60`, `mcp-and-skills/skills.md:107`, `skill-synthesis/src/index.ts:3-4` (C-S1) | Describes a path with no producer; "succeeds" has no outcome signal (`succeeded` is hard-coded true for 3 of 4 event sources, C-S9) | Delete the automatic-promotion paragraphs; keep Track 2 (accept-based) text. |
| SR-3 | Empty state "workflow of at least 5 turns ends with a success marker … promoted only after repeated successful runs" `skill-candidates-table.component.ts:466-470` (C-S2) | Contradicts code (`MIN_ROLE_TURNS_FLOOR = 2`; success marker is never a condition) | Reword to the real rule: "Sessions with at least 2 turns and some real work are captured as candidates. A skill is promoted when you accept it." |
| SR-4 | `PTAH_SYSTEM_PROMPT` "Promoted Skills — ptah.skill … Use to discover available skills" `ptah-system-prompt.constant.ts:296-308` (C-S4) | The constant has no runtime consumer, so no agent ever receives the claim | Delete the dead section (or the constant) in a fix batch; no rewording. |
| SR-5 | "any agent can invoke it like a hand-authored skill — same trigger semantics" `skill-synthesis/index.mdx:18`; "no second runtime path" `skills.md:107` (C-S3) | "Same trigger semantics" has no ground truth; delivery is gated per workspace | Reword: "Accepted skills are copied to your skills folder; in a new workspace, enable them in Skills settings." `skill.delivery` measures the delivery part. |
| SR-6 | "Ptah records when each one is actually used … ≥ 5 recorded runs → Curator rewrites it" `how-it-works.mdx:118-128` (C-S9) | "Actually used" implies outcome; telemetry records invocation only | Reword: "Ptah records each invocation. After 5 invocations…" |
| SR-7 | Counters "Promoted" / "Active skills" `skill-stats-strip.component.ts:55-60`, `skill-pipeline-status.component.ts:219-221` (C-S5) | "Active" is not defined in code (includes dormant, manual, accepted) | Rename to "Promoted (all time)"; add "Delivered to this workspace" only when measured. |
| SR-8 | Thoth tile "N pending / candidates to review" `thoth-status.service.ts:521-528` (C-S6) | Counts raw captures, not the review queue | Reword: "N suggestions to review" sourced from pending suggestions. |
| SR-9 | "Facts, events, and code Thoth has learned across sessions" `memory-curator-tab.component.ts:112` (C-M9) | Code symbols come from indexing, not session learning | Reword: "Facts and events from your sessions, plus the code index of this workspace." |
| SR-10 | "It remembers your codebase" `index.html:48`; "Persistent memory … auto-curated" `llms.txt:7,11`; "Decisions from last week still apply this week" `ptah-docs/.../index.mdx:44-47` (C-M11) | "Remembers" and "still apply" are absolute; no update semantics exist (M6), and the lifecycle deletes unused rows (M4) | Reword: "Keeps notes from your sessions and brings relevant ones into new sessions." Re-add the decision claim only when `mem.update` correct ≥ 0.8. |
| SR-11 | "## Recalled Memory Context - facts recalled … based on this session" `memory-prompt-injector.ts:130-131` (C-M3) | Recall is computed once from the first user message | Reword the header: "recalled for your first message". |
| SR-12 | "Workspace Memory Snapshot - Recent observations curated for this workspace" `memory-prompt-injector.ts:239-247` (C-M4) | Salience-ranked subjects, not recent observations | Reword: "Top memory subjects for this workspace". |
| SR-13 | "A curator runs automatically on every context compaction (PreCompact)" `memory/index.mdx:20` (C-M5) | "Every" is false by design (900 s coalescing, 20 passes/hour); the two doc pages contradict | Reword: "…on context compaction (at most once per 15 minutes)" and align `how-it-works.md`. |
| SR-14 | "Prompt submit — your prompt contains a recall cue (this retrieves)" `how-it-works.md:20`, `memory/settings.md:55` (C-M6) | Code starts a curate pass; nothing retrieves | Reword: "…starts a curation pass" or delete the row. |
| SR-15 | Thoth tile "M queued for curation" / "All curated" `thoth-status.service.ts:496-507` (C-M8) | The number is curated recall-tier rows, the inverse of the label | Fix the source (pending `observation_queue`), or delete the line until fixed. |
| SR-16 | "All memory state is in `~/.ptah/ptah.db`" `how-it-works.md:38,66` (C-M10) | Wrong path (`~/.ptah/state/ptah.sqlite`) | Correct the path. |
| SR-17 | 440 ledger claim "no useful memory is lost" (`context.md` table) | An absolute "no" cannot be shown by a finite benchmark | Restate: "On the seeded benchmark, useful-row loss = 0 over 180 simulated days, and unprocessed observations are not deleted during an extraction stall." |
| SR-18 | 443 ledger claim "rows that are still useful stay" | "Useful" has no production label (salience is unlabelled, M7) | Restate against the seeded usefulness label (3.7). |
| SR-19 | Skill/memory injection "agent outcomes improve" (ledger rows) | Measurable only by the local, stochastic study; never a CI fact | Keep, marked "inform-only evidence, release-scoped". |
| SR-20 | Code doc "drives the 3-success promotion pipeline" `skill-invocation-tracker.ts:1-12` | Describes an unwired path | Fix (wire it, Phase 4 item 7) or delete the class and the dead settings knob `successesToPromote` (`skill-settings-panel.component.ts:32-37`). |

Measured, not SR (the benchmark decides them):
- C-S7 counts reset on restart (`skill.funnel.feed-parity` restart case);
- C-S8 replay "not running yet" (holds);
- C-S11 accept path;
- C-M7 post-tool-use trigger (liveness fault cases);
- 586 feed parity;
- 443 ranking vs recency;
- 563 sediment/merge;
- 578 judge/retire.

## 9. Phase 3 batch outline (for team-leader) and Phase 4 metric map

### 9.1 Phase 3 batches

Branching [user-requested]: a 620 worktree/branch from `fix/task-619-tool-benchmark` at 619's core-schema SHA; rebase until 619 merges; never touch `.claude-worktrees/task-619-tool-benchmark`. B1-B3 may start now from the current branch tip (pure additions). Paths below use `tools/mcp-bench/src/task-620/` (code) and `tools/mcp-bench/fixtures/task-620/` (committed labels and synthetic fixtures) [proposed]; final placement follows 619's answer to 6.6(3).

Common verification for every batch (run in the 620 worktree): `npx nx run mcp-bench:typecheck`, `npx nx run mcp-bench:lint`, the batch's tests, and `npx prettier --check <every changed path>` [user-requested lesson from 619]. The reviewer reads the code directly, including cleanup paths [user-requested lesson].

| Batch | Scope | Files (CREATE unless marked) | Depends on | Verification (in addition to common) |
|---|---|---|---|---|
| P3-B1 Pure metrics | confusion/rates/F1/FMR, update C/S/O/H, false-delete/retain, bootstrap CI (seeded); Cohen κ, quadratic-weighted κ, Spearman with defined missing/constant handling | `src/task-620/metrics/curation-metrics.ts`, `curation-metrics.spec.ts`, `agreement-metrics.ts`, `agreement-metrics.spec.ts` | none | `npx nx run mcp-bench:test --testPathPatterns=task-620/metrics`; hand-computed fixtures incl. κ on constant vectors → null |
| P3-B2 Bench data + freeze tooling | bench-data dir resolution; candidate freeze (copy + SHA-256 manifest + DB-row diff); manifest verifier; transcript-sample copier (563 seed ordering) | `src/task-620/data/bench-data-dir.ts`, `freeze-candidates.ts`, `verify-manifest.ts`, `sample-sessions.ts` + specs | none | tests with temp dirs; one local dry run writing only under the bench data folder; no path under `~/.ptah` opened for write (spec asserts) |
| P3-B3 Ground-truth formats + generator | zod label schemas; deterministic seeded-session generator (templates + distractor bank, seeded PRNG); `MANIFEST.json` hasher; 10 worked facts F-001…F-010 | `src/task-620/fixtures/label-schemas.ts`, `seeded-session-generator.ts` + specs; `fixtures/task-620/memory-facts.v1.jsonl` (seed of 10), `distractors.v1.jsonl`, `MANIFEST.json` | none | generator output byte-identical across two runs (spec); schema validates fixtures |
| P3-B4 Suite kinds | `registerSuiteKind` calls with the 6.3 schemas | `src/task-620/scorecard/suite-kinds.ts`, `suite-kinds.spec.ts` | 619 core SHA | spec: valid/invalid `details` per kind; no diff in `scorecard.types.ts`/`scorecard-writers.ts` (`git diff --exit-code <619 SHA> -- tools/mcp-bench/src/scorecard/`) |
| P3-B5 620 host + doubles | host entry (6.1 plan), `RecordedCuratorLlm`, `RecordedLaneRunner`, plan schema, net recorder reuse; host build target (per 6.6(3)) | `src/task-620/host/bench-620-host.entry.ts`, `recorded-curator-llm.ts`, `recorded-lane-runner.ts`, `plan.schema.ts` + specs; MODIFY `tools/mcp-bench/project.json` only if 619 agrees | P3-B4; 619 export (6.6(1)) | `npx nx run mcp-bench:build-host-620`; a smoke run via `launchBenchHost({hostScript})` on an empty plan passes the guard; replay miss → typed error (spec) |
| P3-B6 Memory suites | 3.1-3.8 suites + pure baselines (extract-all, byte-equal, never-merge, latest-chunk-wins, raw grep, last-N, OR builder, oracle retention) | `src/task-620/suites/memory/*.suite.ts`, `src/task-620/suites/memory/baselines/*.ts` + specs; `fixtures/task-620/cassettes/memory/*.jsonl` | P3-B1, B3, B5 | `npx nx run mcp-bench:test --testPathPatterns=task-620/suites/memory`; one replay run end-to-end via the runner (B8) on the 10-fact seed |
| P3-B7 Skills suites | rubric inter-rater (CSV), judge-agreement (local), funnel fixture + invariants, slug collisions, trigger-eval human | `src/task-620/suites/skills/*.suite.ts` + specs; `fixtures/task-620/skill-sessions.v1/**`, `skill-docs.v1.json`, `planted-negatives.v1/**`, `cassettes/skills/*.jsonl` | P3-B1, B3, B5 | `--testPathPatterns=task-620/suites/skills`; funnel run reports every stage with counts |
| P3-B8 Runner, scorecard, CI | `run-620` CLI (plan → launcher → scorecard via 619 writers), known-failures evaluator, ledger renderer; CI workflow | `src/task-620/runner/run-620.ts`, `known-failures.ts`, `ledger-render.ts` + specs; `fixtures/task-620/known-failures.v1.json`; `.github/workflows/memory-skills-bench.yml`; `reports/task-620/feature-evidence.md` | P3-B6, B7 | `npx nx run mcp-bench:bench-620 -- --ci` locally on Linux or WSL with network blocked after cache fill; known-failures ratchet spec; `npx prettier --check .github/workflows/memory-skills-bench.yml` |
| P3-B9 Labelling + freeze (human, not code) | complete `memory-facts.v1` (≥ 110), `gt-merge@v1`, matcher sample, real-session labels; run the skills blind labelling; adjudicate | data files only under `fixtures/task-620/` (synthetic) and the bench data folder (private); **MODIFIES B3's files** `memory-facts.v1.jsonl` and `MANIFEST.json`, so B9 runs after B3 is committed, never in parallel with it | P3-B2, B3 (files); P3-B1 + P3-B7 (verification) | manifest hashes recorded; κ/ρ computed by B7's rubric suite on B1's metrics; matcher agreement per R-M4 (≥ 100 pairs, κ interval) |
| P3-B10 Outcome harness (Phase 5) | task set, condition runner, deterministic checks | `src/task-620/suites/outcome/*` + `fixtures/task-620/outcome-tasks.v1/**` | P3-B8 | dry run of 2 tasks × all conditions; no CI wiring |

File-disjoint parallel sets: {B1, B2, B3} now; {B6, B7} after B5; B9 is human work alongside B6/B7.

### 9.2 Phase 4: which fix must move which metric

Each fix batch states its target suite and metric in its commit message, and its acceptance is the ledger delta at or above MinE with guards held [user-requested: each fix tied to a metric].

| Fix (source) | Must move | Guard (must not regress) |
|---|---|---|
| Item 1: resolve from hybrid search; subject fragmentation (471) | `mem.dedup` merge recall ↑, duplicate-cluster rate ↓, singleton-subject share ↓ | merge precision; calls per merge |
| Item 2: corpus sediment purge + write-time classifier | `mem.extraction` precision and FMR ↑; snapshot active-sediment share ↓ | seeded durable recall; false-delete |
| Item 3: salience outcome label | `mem.retention.lifecycle` false-delete ↓ toward oracle; `mem.ranking.roster` NDCG ↑ | DB rows ≤ cap; growth slope |
| Item 4: mine evidence, stop auto-authoring manuals | `skill.funnel.cluster` (no single-session candidate); human rubric mean on new drafts ↑ | prefilter recall |
| Item 5: replace judge rubric | `skill.judge-agreement` ρ ↑, positive-control pass ≥ 90%, saturation share ↓ | negative-control fail ≥ 90% |
| Item 6: do not judge template fallbacks | `skill.funnel.draft` invariant; judged-set fallback share = 0 | judge coverage of non-fallbacks |
| Item 7: promotion reachability (connect invocations, coherent repetition, unify recurrence, backfill judge) | `skill.funnel.promote`, `skill.funnel.judge` invariants pass | `skill.funnel.retire` invariants |
| 473 Track B: generator rewrite, new rubric, wider schema, blind 5-cluster experiment | human rubric on 5 blind clusters: pass ≥ 2/5 at ≥ 6.0 normalised, else retire the generator [user-requested rule] | rater trust bar holds |
| 588: archaeology first, reject degraded/no-routine, ≥ 2 sessions per cluster, delete single-session auto-candidate | `skill.funnel.archaeology` and `skill.funnel.cluster` invariants | prefilter recall on routine sessions |
| 563 M3-8(b) merge rate | `mem.dedup` merge recall vs byte-equal baseline | merge precision |
| 563 M4-8(a) singleton share | `mem.dedup` singleton-subject share ↓ | — |
| 563 M4-8(c) over-suppression | `mem.extraction` real-slice over-suppression = 0 of labelled durable facts | precision |
| 563 relevance 9/20 vs 16/20 | `mem.search.fts-and` recall@10 on frozen seeded questions (no live-DB anchors) + 619 read-side recall@k | NDCG@10 |
| 578 P1: boot reconcile deletes promoted dirs | `skill.funnel.retire` "reconcile never deletes promoted" | — |
| 578 P1: retirement retires a just-used skill | `skill.funnel.retire` "recent use never retired" | — |
| 578 P1: judge panel has no positive control | `skill.judge-agreement` positive control present and ≥ 90% | negative control |
| 578 P1: reconcile wait has no timeout | `skill.funnel.retire` "reconcile settles with a timeout outcome on the injected clock while a dependency never resolves" | — |
| 578 P1: over-cap promotion race | `skill.funnel.promote` "count ≤ cap under every scripted interleaving" (or closed as not reproducible in one process, 4.4) | — |
| Forensics #3 silent extraction loss (feeds 440) | `mem.liveness.fault` all pass; `mem.retention.growth` unprocessed-deleted = 0 under stall | growth slope |
| Forensics M6 update semantics | `mem.update` correct ↑, stale ↓ vs latest-chunk-wins | injection recall |
| Forensics M5 keying | `mem.scope.write` non-canonical share = 0 (+ 619 read side) | two-workspace leaks = 0 |
| Abstention threshold (MIN_SCORE) | `mem.abstention` false-injection ↓ | `mem.injection.recall` drop ≤ 5 pts |
| Reranker inert (forensics M3): fix or delete | fix: `mem.dedup.rerank` NDCG@5 ≥ no-rerank + 0.05 and variance > 0; delete: the component is removed and the row closes as "deleted, no effect" | merge precision/recall unchanged |
| Skills backlog growth (forensics failure #9) | `skill.backlog.drain` invariants pass; `skill.backlog.audit` slope ≤ 0 and age p95 ≤ 14 d at the next release | funnel invariants |
| Window clamp loses the middle (M2 mode d) | long-session middle-window recall ↑ toward head recall | calls per session; precision |
| Boot-scan re-extraction (M2 mode e) | `mem.liveness.rescan` new rows = 0, extra calls = 0 | first-scan recall |
| Archaeology verdict quality (S3) | `skill.funnel.archaeology` routine accuracy ↑ vs majority-class baseline (local live run) | degraded detection |

## 10. Ground-truth construction (detail for Phase 3 and the labeller)

### 10.1 Seeded facts `gt-memory@v1` (≥ 110)

- Sources [user-requested], from `ground-truth-sources.md` proposal (a), at a pinned commit:

| Slice | Count | Category |
|---|---:|---|
| `.ptah/specs` decision/rejection files | 60 | extraction, temporal, update |
| `.ptah/specs` user preference/correction files | 15 | extraction, update |
| git reversal/replacement pairs | 15 | update, contradiction |
| cross-task facts | 10 | multi-session |
| abstention | 10 | abstention |

  Excluded: 471/473/563/620 measurement documents that quote memory rows.
- Record per fact: `id, source (file:line or commit), sourceCommit, date, category, statement (as said in a session), keyTokens[][], forbiddenTokens[], question, expectedAnswer, scenarioTags[], bait?, labeller, labelledAt`.
- Frozen id: `gt-memory@v1`; `version` = sha256 of the canonical JSONL; `frozenAt` = commit time of the freezing commit.
- Who labels [proposed]: a drafting lane may propose candidate facts **only from git artefacts with citations**, with MCP off and no access to `~/.ptah`. The user (or a named human labeller) accepts, edits or rejects each, and the labeller id is recorded per fact. A fact without human acceptance is not in the set.
- Independence guarantees [user-requested + proposed]:
  1. every fact cites a git artefact, never a memory row or pipeline output;
  2. labels are committed before the first scored run (the scorecard records both SHAs and the runner refuses a run whose ground-truth commit is newer than the first scored run of that version);
  3. seeded sessions come from the deterministic generator, not from the system;
  4. the matcher is validated against a human (R-M4).

### 10.2 Held-out sessions `gt-memory-real@v1`

- Split by date [proposed]:
  - seed window = main-repo session JSONLs whose lines all fall in 2026-09-06..2026-09-30;
  - eval window = 2026-10-01..2026-10-06 (the freeze date).
  - Sessions after the freeze never enter v1.
  - Excluded: sessions run from a bench temp home, `persistSession: false` harness sessions, and sessions whose cwd is a `.claude-worktrees/task-619*` path.
- Sample: 20 eval-window sessions by `sha256("TASK_2026_620:real" + filename)` order, size 200 KiB-5 MiB (563's filter).
- Copies plus a SHA-256 manifest go to the bench data folder. The repo holds only `{opaqueId, sha256, lineRefs}` labels.

### 10.3 Storage summary

| Item | Location | In repo? |
|---|---|---|
| Seeded facts, distractors, generator templates, matcher sample, merge pairs, funnel fixture, planted negatives, outcome task specs, known-failures, label CSVs, synthetic cassettes, `MANIFEST.json` | `tools/mcp-bench/fixtures/task-620/` | yes [proposed: "labels in the repo" came from the orchestrator's Phase 2 brief, not from the user; the exact path is also proposed] |
| Frozen candidates copy, real-session copies, 563 replay inputs, real-session cassettes, judge raw outputs, DB snapshots, run artefacts | `%LOCALAPPDATA%\ptah-mcp-bench\` (Windows), `~/.cache/ptah-mcp-bench/` (else), env override | no [user-requested] |
| Existing snapshot `~/.ptah/bench-snapshots/ptah-20261006-pre-retention.sqlite` (sha256 `82cd16ac…d575a`) | moved to `…\ptah-mcp-bench\snapshots\` only with approval (Q2) | no |
| Scorecards and ledger | `tools/mcp-bench/reports/task-620/` | yes (metrics only) |

## 11. Open questions for the user (at most 5)

1. **Second rater for the skills labels.**
   - (a) A second human rates all 105 documents (about 3-4 hours) **(Recommended)**: real inter-rater κ.
   - (b) You rate twice, ≥ 14 days apart (intra-rater; weaker, and labelled as such).
   - (c) No agreement check: every rubric-based ledger row stays `not measurable yet`.
2. **Move the 2026-10-06 snapshot** from `~/.ptah/bench-snapshots` to `%LOCALAPPDATA%\ptah-mcp-bench\snapshots` (copy, verify sha256, then delete the original).
   - (a) Approve the move **(Recommended)**: `process-watch` would otherwise fail any run that reads it.
   - (b) Keep it and re-snapshot into the bench folder.
   - (c) Keep it and never use it.
3. **Skills positive set** (conflict K1).
   - (a) 23 human-authored skills; the 2 pipeline-promoted skills get their own stratum; `ptah-surface-authoring` joins only if committed before the freeze **(Recommended)**.
   - (b) All 26 as positives, as originally written.
4. **Outcome study budget (Phase 5).**
   - (a) 48 memory + 24 skills tasks, 2 repeats, about 490 agent sessions; detects ≈ 16-22 / 22-31-point effects, restated after the pilot (5.3) **(Recommended)**.
   - (b) Half size; detects ≈ 31/44 points only.
   - (c) Defer the study; injection rows stay `not measurable yet` except the CI proxy.
5. **CI placement.**
   - (a) A new non-required workflow on relevant PR paths plus nightly, allowed to fill an embedder-model cache with network in the setup step only **(Recommended)**.
   - (b) A job inside `ci.yml`.
   - (c) Nightly only.

Separately, Gate SR (section 8) needs your decision per row: reword as proposed, your own wording, or delete.

## Revision log

Round 1, from `benchmark-design-review.md`. The review's 8 feasibility spot-checks passed, and those parts are kept unchanged.

| # | Severity | Change |
|---|---|---|
| 1 | Blocking | 586 ground truth is now the fixture script's expected event list (2.3 row; 4.4 fixture text and `feed-parity` row). DB-table parity is demoted to a secondary diagnostic. |
| 2 | Blocking | R-L5 now requires a baseline on invariant rows: a real one where it exists, else the value recorded at freeze (2.1). Each of the four rows now has a baseline (2.3): 586 = recorded at freeze; curator trigger = recorded at freeze + previous snapshot; setup-wizard seed = append-only policy; replay = recorded at freeze. |
| 3 | Major | New ledger row "Skills pipeline backlog / drain" (2.3). New `skill.backlog.drain` (CI, scripted load, injected clock) and `skill.backlog.audit` (local, snapshot) in 4.4. New R-M1a carve-out for operational-state audits (3). Phase 4 row (9.2), CI table (7), zod (6.3). |
| 4 | Major | R-C4 step 2 now compares a SHA-256 of a deterministic projection that excludes cost, latency, timestamps and run ids (7). Core-field request 6.6 item 7. |
| 5 | Major | Time-based invariants use an injected clock or fake scheduler. A wall-clock safety cap only aborts a hung case and is excluded from the projection (4.4). The over-cap race uses scripted interleavings, with a stated outcome if no interleaving point exists (4.4). Phase 4 wording updated (9.2). |
| 6 | Major | Aggregation rule stated: per-task mean of repeats, paired at task level, bootstrap. MDE re-derived as 16-22 / 22-31 pts; MinE raised to 22 / 31 (5.3, 2.3, Q4). |
| 7 | Moderate | `mem.dedup.rerank`: NDCG@5 vs no-rerank and score variance (3.2). Ledger row (2.3), fix-or-delete row (9.2), zod (6.3). |
| 8 | Moderate | Archaeology verdict accuracy vs fixture labels, with a majority-class baseline (4.4 table, zod, 9.2). |
| 9 | Moderate | Mode (d): long-session class with middle-window recall (3.1). Mode (e): `mem.liveness.rescan` (3.8). Both in the 9.2 and 7 tables. |
| 10 | Moderate | `direction` is mandatory per known-failure entry. Tolerance defaults to 0 for CI and needs a reason otherwise. An improving-but-failing entry forces tightening (7). |
| 11 | Minor | Zero executed cases ⇒ `na` ⇒ CI fail (R-L5a in 2.1; section 7). |
| 12 | Minor | Pilot re-estimate of σ_d after the first repeat; MDE and MinE restated before any `no effect`; an underpowered result stays `not measurable yet` (5.3). |
| 13 | Minor | Matcher sample ≥ 100 pairs (≥ 40 true matches); κ reported with its interval; lower bound ≥ 0.7 (R-M4). |
| 14 | Minor | P3-B9 now lists P3-B1/P3-B7 as verification dependencies and states that it modifies B3's files after B3 is committed (9.1). |
| 15 | Minor | The runner-process reading is flagged as needing 619 confirmation before P3-B8, with a fallback (6.1; 6.6 item 6). |
| 16 | Minor | Not re-tagged. The Phase 2 request item 5 says "labels in the repo", so the tag is traceable. The citation now names it, and the exact path is marked proposed (10.3). |
| 17 | Minor | `judged-model` is now stratified by creation week × transcript size, independent of the judge (4.1). The judge-selected `anchor-471` stratum is stated as a known limit, and agreement is also reported without it (4.3). |
