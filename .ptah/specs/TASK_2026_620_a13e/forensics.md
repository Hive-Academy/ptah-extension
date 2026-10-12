# TASK_2026_620_a13e - Phase 1 forensics: memory and skills, claims vs code vs data

Date: 2026-10-06. Code: `main` at `e0ca51e6e` (after PR #601 = 563, PR #626 = 578). Read-only on code.
Labels: **VERIFIED** = I read the file:line or ran the query; **INFERRED** = deduced, not observed. Where a
finding came from a delegated code-reading pass I re-checked the load-bearing lines myself and say so.
`SS` = `libs/backend/skill-synthesis/src/lib`; `MC` = `libs/backend/memory-curator/src/lib`.

## 0. Method and live-data safety

- Real DB `C:\Users\abdal\.ptah\state\ptah.sqlite` (running `Ptah.exe` keeps writing it; WAL advanced during my work).
  I never opened it for write. I opened it with `node:sqlite` `{readOnly:true}` and ran `VACUUM INTO` a copy in
  `%TEMP%\t620\copy620.sqlite` (7.2 s). **Copy SHA-256 `a25d702fd7e38b5ad1700c90d992fb7ee6a30baae3fd1e2a4d6103a1ef676fa6`,
  901,976,064 bytes, `schema_migrations` max = 51.** All numbers below marked "(copy)" come from this copy, taken 2026-10-06 ~22:41.
- Copy row counts at capture: `memories` 26,895 (11,282 archived, 89 quarantined), `memory_chunks` 30,040,
  `observation_queue` 91,783, `skill_candidates` 2,587, `skill_suggestions` 18, `skill_session_verdicts` 260,
  `skill_invocation_events` 5,732, `skill_invocations` 0, `skill_synthesis_queue` 2,753 rows.
- Prior evidence read first (not repeated): 471 forensics (memory, funnel), 563 `test-report.md` + `harness/README.md`,
  578 `future-enhancements.md` + `test-report.md`, 439 `completion-validation.md`/`HANDOFF.md` (for 440/443/461), 586 `test-report.md`.
- Hand-labelling was not done in this phase. Quality heuristics below (SQL LIKE on content/subject) are proxies, labelled as such.
- 619 overlap, noted only: `ptah_memory_search` scope/isolation/spill root; the exact-string `workspace_root` predicate
  (section M5) is the same predicate the MCP tool uses.

## 1. Top failures ranked by impact

| # | Failure | Impact | Evidence |
|---|---|---|---|
| 1 | **Skill learning produces no skill without a human click, and no real use reaches the counter**: automatic promotion unreachable; the only 2 promoted skills are legacy suggestions adopted by 578's reconcile; both have 0 invocation events | The "skills learn from your sessions" claim has no measured effect | S1, S9, copy |
| 2 | **No contradiction/update semantics**: a merge appends a chunk, never supersedes; stale fact stays retrievable and gets its recency refreshed | Wrong answers after a decision changes | M6 |
| 3 | **Extraction silently stopped for ~9 days and nothing alerted**: 59,614 unprocessed observations (65% of the queue, 483 MB = 54% of the DB), 0 memories created 2026-09-24..2026-10-01; retention will purge them at 14 days | Memory write path has silent loss modes; "DB growth is bounded" (440) fails on the observation queue | M2, copy |
| 4 | **Age/cap lifecycle deletes by idleness only** (kind, salience, hits ignored); 42% of memories archived, 91% of archived facts/preferences never used; no spec covers kind | Durable rows lost by default (563 relevance 16/20 -> 9/20) | M4 |
| 5 | **Salience is a saturated, unlabelled number**: 57% of rows since 2026-10-02 have salience 1.00; `hits` records exposure, not usefulness | Ranking claim "salience" is decorative | M7 |
| 6 | **Judge is saturated and un-controlled**: 11/18 suggestions scored exactly 10.0 (incl. cluster of 2 and clusters of 100+); panel has no positive control; replay never produced (NULL passes); 2,347 of 2,587 candidates never judged | Quality gate carries no information | S5, S6, copy |
| 7 | **workspace_root exact-string key, no canonicalisation**: 69 rows keyed `''`, ~300 rows under 14 worktree roots, 60 of those share a subject with the main root | Worktree/path-variant sessions are blind to main-repo memory | M5 |
| 8 | **Resolve/dedup**: subject fragmentation persists (80 commitlint rows / 29 case-folded subjects after quarantine); 563 M3-8(b) gate failed (7/23 vs 8/23); reranker inert (always 1.0) | Duplicates and low merge quality | M3 |
| 9 | **Skills pipeline backlog still grows**: prefilter queued 605 -> 1,193; 677 queued rows >14 days old; 1,869 of 1,891 rejected candidates were rejected by backlog cleanup because no transcript survived | Funnel is a graveyard; judge never runs on most | S4, copy |
| 10 | **Injection claims**: session roster lists 10 subject names only, ranked by salience (comment says "recent"); skills never injected into prompt, only discoverable via `execute_code ptah.skill.list()` or the harness mirror | "Memory/skills help the agent" is unmeasured | I1, I2 |

Claims I could not verify are listed in section 9.

## 2. Memory write side

### M1. Extraction (claim: "extract only DURABLE knowledge")

- Claim: `libs/backend/agent-sdk/src/lib/curator-llm-adapter/extract-prompt.ts:1-3` "extract only DURABLE knowledge ... still be true and
  useful in a future, unrelated conversation"; DO-NOT-EXTRACT list `:54-66`; reuse existing subjects via `mcp__ptah__ptah_memory_search` `:47-52,74-76`.
- Path (VERIFIED): `MemoryTriggerService` -> `MemoryCuratorService.curate` -> `doCurate` (`MC/memory-curator.service.ts:683`) -> windows
  (`CuratorWindowRunner.extractAcrossWindows`) -> `SdkInternalQueryCuratorLlm.extract` (haiku tier, `CURATOR_MAX_TURNS = 6`,
  `sdk-internal-query.curator-llm.ts:204,429`).
- Verdict **PARTIAL, improved by 563**. Descriptive comparison on the copy (SQL proxies, not hand labels; confounded by time, 913 rows
  in the post window across 40 sessions):

  | Window (copy) | rows | event kind | content has `TASK_2026_` or subject `task-2026-%` | content mentions "worktree" | bare repo/product subject |
  |---|---:|---:|---:|---:|---:|
  | created 2026-08-01 .. 2026-09-26 | 14,487 | 24.5% | 21.9% | 8.7% | 0.3% |
  | created 2026-10-02 .. now (after #601 merged 2026-09-27) | 913 | 2.1% | 1.3% | 2.0% | 0.0% |

  (No rows exist between 2026-09-24 and 2026-10-01, see M2.) Direction matches 563's M4 (sediment 20.6% -> 11.7% on its 10-session sample).
  Whether the remaining rows are durable is **not measured**; 563 itself measured 5 real durable losses in session `1359b2b0` (over-suppression), gate M4-8(c) failed.
- Root cause of residual risk: the "reuse existing subject" lever depends on the extractor calling `ptah_memory_search`; 563 evaluated the new
  prompt with MCP **off** (`563/test-report.md:79-80`), so that lever has never been measured. In production MCP is attached when
  `resolveMcpSessionWiring(mcpServerStatus)` resolves (`sdk-internal-query.curator-llm.ts:424`); it is a 619-owned tool (overlap).
- Metric: durable-precision of newly written rows on a frozen hand-labelled sample; durable recall on held-out sessions (see section 7).

### M2. Triggering and silent loss (claim: observations are curated; "no memory is lost")

- VERIFIED (code, `MC/triggers/memory-trigger-config.ts:61-120`, `memory-trigger.service.ts`, `boot-scan-runner.ts:171-199`): triggers = idle 10 min,
  turn threshold 20, session end, PreCompact (coalesced 900 s), commit/cue, boot scan; all share `maxCuratesPerHour = 20`.
- Silent-drop modes, all VERIFIED in code: (a) a non-network extract/resolve failure returns outcome `'ran'` and the trigger marks the
  observations processed (`curator-activity-log.ts:339-366`, `memory-trigger.service.ts:855-867`); (b) a boot-scan session that throws is
  skipped while later successes advance the watermark past it; (c) a `'ran'` pass with zero drafts consumes input; (d) windows beyond 8 lose the middle
  (`clamp-transcript.ts`, 25% head); (e) no transcript-hash dedup, boot scan re-extracts sessions newer than the mtime watermark.
- **Observed outage (copy, VERIFIED data / INFERRED cause):** `observation_queue` has 59,614 rows with `processed_at IS NULL`; captured
  2026-09-22..09-24 (8,421) and 2026-09-28..10-02 (≈ 48,000) are essentially 100% unprocessed, while `memories` has zero rows created 2026-09-24..10-01.
  Extraction processed nothing for ~9 days. Cause not determined (host not running the Thoth runtime, curator disabled, or admission/back-off).
  `memory_retention_state.last_skip_reason = 'foreground-active'`, `attempt_count = 144`. Stuck rows are deleted after `stuckDays = 14`
  (`MC/retention/memory-retention-config.ts:32`), so the unprocessed 09-22/23 rows are about to be destroyed unextracted.
- Same data on 440: `observation_queue` = 483,409,920 of 901,976,064 bytes (54%); 376 MB is `tool_response_text` of `tool-use` rows. DB is 902 MB.
- Metric: `unprocessed_observation_age_p95`, `sessions_with_observations_but_0_memories`, extraction-pass error share, count of `'ran'` passes with an error.
  Ground truth: the `observation_queue` itself and the transcript files (independent of the extractor).

### M3. Dedup / resolve / merge

- Claim (context.md item 1): resolve candidates are byte-equal subjects. **Closed by 473 Track A + 563 M3.** Current code collects candidates via
  `MergeCandidateCollector.collect` (`MC/memory-curator.service.ts:775`, tier 1 case-folded subject window, tier 2 `searchRich` hybrid, bounded:
  `TIER2_PER_DRAFT_LIMIT=5`, total 25, 8 s). The `resolve-prompt.ts:19` the context cites is a **dead duplicate**:
  `MC/curator-llm/resolve-prompt.ts` has no importer (grep: only `agent-sdk/.../resolve-prompt.ts` is used by `sdk-internal-query.curator-llm.ts:40`);
  563 claimed the duplicate was deleted, only the extract one was. Dead code with a stale rule.
- Live resolve prompt (`agent-sdk/.../resolve-prompt.ts:22-27`): merge "when the candidate states the same fact, decision or preference about the same topic".
- Residual failures (VERIFIED, 563 report): M3-8(b) FAIL 7/23 vs 8/23 merge rate (D4 = B variant), 20/23 when tier 2 always runs (D4 = A, +15 LLM calls); merge *quality*
  never scored; **reranker is an inert no-op** (always score 1; `embedder-worker.ts:277-295`, `563/test-report.md:228-252`) — I did not re-run it; INFERRED still present because
  `git log` for that file shows no fix since.
- Current data (copy): 897 of 26,895 memories have >1 chunk (3.3%; 471: 1.7%); 20,497 distinct subjects over 26,895 rows; 17,957 case-folded subjects occur once; commitlint family
  after quarantine = 80 active rows over 29 subjects; 8 exact-duplicate content groups (19 rows).
- Metric: merge precision/recall on a labelled pair set (same-fact vs different-fact pairs), duplicate-cluster rate, `chunks_per_memory` for merged rows; baseline = byte-equal subject match (old path) and "never merge".
  Ground truth: human-labelled pairs from real rows; seeded paraphrases of a known fact.

### M4. Retention / decay / purge (claim, 443: "old unused rows leave, useful ones stay")

- Code (VERIFIED by delegated pass + my spot checks): defaults `enabled: true, archiveAfterDays 30, deleteAfterDays 60, maxPerWorkspace 25,000`
  (`MC/retention/memory-lifecycle-config.ts:12-17`). Archive: `tier='recall' AND last_used_at < now-30d AND pinned=0 AND quarantined_at IS NULL AND not corpus-linked`
  (`memory-lifecycle.store.ts:18-22`); delete after 60 more days; cap eviction by oldest `last_used_at`. **Never reads `kind`, `salience`, `hits` or `expires_at`.**
  The extractor inserts every row as `tier='recall'`, `pinned=0` (`memory-curator.service.ts:864-872`), so every durable row is exposed. `decay_rate` is stored and never read.
- Data (copy): 11,282 of 26,895 archived (42%). Of archived facts+preferences (9,269 non-task), only 689 (7.4%) were ever used (`hits>0`); archived rows average 0.15 hits vs 2.42 for active.
  Only recall of a row (`recordUse`) or a merge un-archives it (`memory.store.ts:678-685,745`). Since "used" means "was injected or returned by a search", rows nobody
  searched for within 30 days are archived regardless of value; a never-asked-about but correct decision is archived and later deleted.
- 563's finding stands: judged-relevant corpus rows disappeared (Track A 16/20 -> 9/20, `563/test-report.md:402-416`). Mechanism per delegated pass: 36,252 -> 26,706 rows
  between 2026-09-19 and 09-26 is most plausibly cap eviction after the first lifecycle run archived idle rows (**INFERRED**; confirm from `memory_retention_state.memories_evicted` history, only the last run is stored).
- No spec asserts that a fact or preference with value survives (`kind` appears in none of the lifecycle specs, grep).
- Orphan checks (copy, VERIFIED): chunks without memory 0; corpus links without memory 0; memories without chunk 0; FK cascade holds.
- Verdict **FAILS** for "useful rows stay"; **HOLDS** for "bounded row count" (cap 25k) but **FAILS** "DB growth is bounded" because the observation queue is the 54% and is not bounded when extraction stalls (M2).
- Metric: canary recall set (seeded durable facts, aged by clock injection) retained after N simulated days; `evicted_with_hits>0`, `archived_then_restored` rate; loss-by-kind. Baseline: no lifecycle; age-only (current); age + hits/salience protected.
  Ground truth: seeded facts with known timestamps; held-out sessions asking about archived content.

### M5. Sediment quarantine and `workspace_root` keying

- Quarantine (VERIFIED): predicate `kind='fact' AND subject LIKE '%commitlint%' AND content LIKE '%scope%'` etc.
  (`0049_memory_sediment_quarantine.ts:34-38`), one-off in the migration, 89 rows; the only writers of `quarantined_at` are 0049 and `restoreQuarantined`. No write-time sediment classifier exists; the only ongoing barrier is the prompt.
  Copy: active rows still carry 2,372 `task-2026-%` subjects, 3,352 `TASK_2026_` content mentions, 1,532 "worktree", 959 "PR #" (the ~55% sediment 471 found is still in the corpus except 89 rows).
- Keying (VERIFIED): write `workspaceRoot: input.workspaceRoot ?? null` (`memory-curator.service.ts:867`); reads are `workspace_root IS ?` exact equality (`MC/memory-search.service.ts:177-186`, `memory.store.ts:461,503`). No normalisation (case, slash, git common-dir).
  Copy: 25,840 rows under `D:\projects\ptah-extension`; **69 rows under `''`** (distinct from NULL: 6 `session_id IS NULL`, and `NULL` scope is a different query); 14 worktree roots hold ~300 rows (`.claude-worktrees/*`, `.claude/worktrees/*`); 60 of those rows have a subject that also exists under the main root.
  Worktree sessions get their own key and see none of the main repo memory (619 owns the search-tool side).
- Metric: share of `workspace_root` values that canonicalise to the same repo (git common-dir, case-insensitive); recall@k of a seeded main-repo fact from a worktree cwd (baseline: 0 today, expected); rows keyed `''`.

### M6. Contradiction / update / temporal (claim, implicit: memory is up to date)

- VERIFIED: no `valid_to`, `superseded_by`, or archive-on-contradiction anywhere in `memory-curator`, `persistence-sqlite` memory migrations, or the adapter (grep empty).
  Resolve sets `mergeTargetId` only for "the same fact"; merge = `appendChunks` (`MC/memory.store.ts:710-791`): a new chunk is inserted, `updated_at`/`last_used_at` bumped, archived tier revived; the parent
  `content`, `subject`, and old chunks are never changed. Search ranks chunks, so a superseded value and its replacement are both retrievable and the stale one is refreshed in recency.
  Only supersede path: setup-wizard seed (`memory-writer.adapter.ts:55-90`).
- Temporal: `created_at`/`updated_at` stored and returned in hits (`memory-search.service.ts:414`); the injected recall block prints only `[subject]: chunk` (`memory-prompt-injector.ts:117-128`), no date.
- Verdict **FAILS** (knowledge-update and temporal-reasoning abilities have no implementation).
- Metric: knowledge-update accuracy (latest value returned, stale value not returned) on seeded fact pairs `(v1 at t1, v2 at t2)` through the real extract->resolve->search path; baselines: "latest chunk wins" and "no memory".

### M7. Salience and the outcome label

- VERIFIED: salience = hint (+ episode boost 0..0.3, `triggers/episode-tracker.ts:185-193`) clamped to [0,1], written once (`memory-curator.service.ts:860-872`, `salience-ranking.ts:11-14`).
  Ranking = `salience*7d-halflife(age) + 0.3*hits/(hits+3) + pinned` (`salience-ranking.ts:1-34`).
- Copy (VERIFIED): rows created since 2026-10-02: 521 of 913 (57%) have salience exactly 1.00 (hint + boost saturate); average 0.941 vs 0.861 before. Overall mean 0.81 (471 measured 0.8124).
- `recordUse` callers (VERIFIED): prompt injection (`memory-prompt-injector.ts:138`), search RPC (`mem-rpc.handlers.ts:156`), get (`memory-rpc.handlers.ts:274`), `ptah.memory` namespace (`memory-namespace.builder.ts:234`). Records exposure only; nothing outcome-based. Injection raises `hits`, `hits` raises rank and un-archives: a self-reinforcing loop (rows injected stay injected). Copy: max hits 238; 39,403 hits over 11,499 rows.
- Context item 3 (build an outcome label from `MemoryUsageRecorder`) - **not done**, and the recorder alone cannot be the label (it counts exposure). Ground truth must be human or follow-up evidence (agent used the fact; user did not correct).

## 3. Skills trajectory (code re-verified at HEAD; data from copy)

Context item 7 status vs 578 (PR #626 changed what happens after the candidate; it did not touch authoring, the success counter or the pre-promotion gates):

| Item 7 sub-item | 578 closed it? | Evidence |
|---|---|---|
| Connect real invocations to the candidate counter | **No** | `SkillInvocationTracker` has no production caller (only DI registration `SS/di/register.ts:83,133`); `evaluate()` called only from it (`skill-invocation-tracker.ts:80`); `incrementSuccess` `skill-candidate.store.ts:1066`. Copy: `success_count` max 0 over 2,587 candidates; `skill_invocations` has 0 rows. Real telemetry lands in `skill_invocation_events` (5,732 rows, 30 slugs, all agents/subagents/prompt-expansion; **0 events for either promoted synthesized skill**). Production promotion paths are `promoteManually` and `promoteSuggestion`. VERIFIED. |
| Coherent pre-promotion repetition (independent trajectories) | **Partly** | Umbrella clustering exists post-hoc (`skill-clustering.service.ts` single-linkage 0.78; `suggestionMinClusterSize = 2` counts members, not sessions; `lifecycle/skill-umbrella-merge.service.ts:424-475`). `source_session_ids` of a candidate is still always one session. Copy: only 1 of 2,587 candidates has >1 session (the 57-session adopted `execute-phase-gated-task`). Single-session auto-candidate still created (`skill-synthesis.service.ts:~890-903`). |
| Unify recurrence checks | **No (worse)** | tracker never passes `contextId` (`skill-invocation-tracker.ts:59`), so `countDistinctContexts` is always 0 and the halving rule (`skill-promotion.service.ts:296-303`) is dead. |
| Backfill judge for candidates without panel row | **No** | No backfill code; `enqueueCandidateGates` (`stage-handlers.service.ts:415`) only on a successful prefilter. Copy: 2,347 of 2,587 candidates have `judge_status IS NULL` (204 scored, 36 unscored); 152 judge-panel rows queued. 578 added a one-time purge (reject, not judge): 1,869 of 1,891 rejected candidates carry `backlog-cleanup: no transcript found / unreadable`. |
| Reject degraded/no-routine verdicts, archaeology before authoring (588) | **No** (588 cancelled as duplicate of 620) | `runPrefilterStage` authors first (`stage-handlers.service.ts:266-293`), archaeology is NIGHTLY-only (`skill-drain.service.ts:396-408`); no-routine prompt says "Generalize... as best you can" (`skill-synthesizer.service.ts:~544-548`). Copy: 260 verdicts; 109 degraded (51 transcript-unreadable, 58 tool-use-unsupported); 105 `unverified`; routine present on only 68 (26%). |
| Do not judge template fallbacks | **No** | fallback body not marked, scored like any (`skill-synthesizer.service.ts:~316-342`). Copy: 103 candidates scored >= 6.0, avg 7.28. |

### S1. Automatic promotion (claim in code docs: "drives the 3-success promotion pipeline", `skill-invocation-tracker.ts:1-12`)

HOLDS only on paper. User accept is the sole live path. Both live promoted skills (`execute-phase-gated-task`, `extract-and-relocate-angular-component-feature`) were promoted by 578's boot reconcile on 2026-10-02 from suggestions accepted before 578 (copy: `judge_score NULL`, trigger/replay NULL). Metric: share of promoted skills reached without a human accept; baseline: 0.

### S2. Prefilter (claim: "stricter prefilter keeps real routines", 461)

VERIFIED: rejects `tooThin` (<2 role turns) and `noWork` (edits>=1 or tool uses>=2 or test passed) on activity counts only (`SS/eligibility/session-work-evidence.ts`, `file-settings-keys.ts:580-581`); no outcome check. Dominance skip needs a registry.
Copy: prefilter `done 392 / skipped 107 / queued 1,193` (was 605 queued in 471). Unmeasured: precision/recall of the prefilter against labelled routine vs non-routine sessions (no ground truth exists). 461's claim has no effect evidence.

### S3. Archaeology

VERIFIED: writes intent/outcome/evidenceClass/routine/frictionMap; degraded rows are recorded "done"; never rejects (`archaeology/session-archaeologist.service.ts`); consumed by synthesizer only if it already ran, by replay (no producer), by gap digest.
Copy numbers above (42% degraded, 40% unverified evidence). Whether `routine` is correct is unmeasured; ground truth = human-labelled sessions (does the session contain a reusable routine, yes/no).

### S4. Queue and backlog

Copy: queued prefilter 1,193 (oldest enqueued before 2026-09-22; 677 queued rows older than 14 days across stages), judge-panel queued 152, trigger-eval queued 152, archaeology queued 132. Candidate creation by week stays 50-470/week in Jul-Aug then collapses to 10-123/week (Sep-Oct) as cleanup rejected the backlog. Drain arithmetic from 471 (one prefilter per workspace per frequent tick) is unchanged in code (not re-read). Metric: queue age p95 and net backlog slope per stage.

### S5. Judge and panel

VERIFIED: five unweighted 1-10 criteria (`skill-judge.service.ts:121-132`); `generalization` still scores 1-3 for retaining file/workspace specifics; judge sees name/description/body only (no session evidence); panel adds a second lens with library neighbours (`gates/judge-lens.ts`, `judge-panel.service.ts:140`). Umbrellas are judged by the single judge, not the panel (`umbrella-merge.service.ts:~447`).
**Saturation (copy, VERIFIED):** of 18 suggestions, 11 have `judge_score = 10` exactly; including a 2-member cluster and the 98/108/111-member clusters; the lowest is 6.2. Self-consistency: the generator and the judge are the same model family (INFERRED).
Positive control still missing (`skill-lifecycle.reachability.integration.spec.ts:609-648` only asserts rejection; no commit since `eb7693b19`).
Metric: judge-vs-human agreement (Cohen's kappa / Spearman) on a frozen set of authored good skills vs generated drafts vs template fallbacks; the 471 exemplar rubric (`471/skill-quality-criteria.md`) is the independent rubric. Baseline: random, and score-by-length.

### S6. Replay, trigger-eval

- Replay: the stage has a handler (`stage-handlers.service.ts:235`) and **no producer**; `replay_confidence` NULL for all 2,587 candidates (copy: `replay` non-null = 0) and NULL passes the gate (`skill-promotion.service.ts:~875`). Cluster hold-out withholds a session from drafting (`gates/cluster-holdout.ts`) for a measurement that never runs. VERIFIED.
- Trigger-eval: holds the "never call a model for scoring" constraint (one lane call for query generation `:597`, scoring is embedder arithmetic); copy: 175 candidates have `trigger_score` (avg 0.67). It is not a promotion gate. Its precision/recall are against queries the same system generated (self-consistency bias, admitted in the file).

### S7. Synthesis (generator)

VERIFIED: schema `{name, description, body}` (+`references[]` for umbrellas) (`skill-synthesizer.service.ts:~60-77`); prompt frames every session as "SUCCESSFUL" regardless of evidence class; cluster input = candidate SKILL.md bodies clipped to 3,000 chars, max 12 (`:~85,89`). 471's claim "forbids tables/boundaries": the prompt prefers "a short ## Steps list" and conciseness; I did not find an explicit prohibition. (Corrects context.md item 4 wording; the quality gap stands.)
Copy: umbrella suggestions are built from dumps if members are fallbacks.

### S8. Retirement and the 578 P1 follow-ups (all re-read at HEAD, delegated pass; line numbers as reported)

OPEN: boot reconcile can delete promoted members' dirs (`skill-curator.service.ts:~440-475,680-690`); `stillRetirable` does not re-check `lastUsedAt` (`lifecycle/skill-retirement.service.ts:269-289`); reconcile wait has no timeout (`skill-curator.service.ts:271`); `start()` interval leak. The over-cap promotion race is narrow (single process has no `await` between read and compare-and-set). Retirement idle clock reads `skill_invocation_events`; the 2 promoted skills have 0 events, so with `retireAfter = 60 d` they become dormant after 30 days of non-use by design: **the lifecycle will retire the only learned skills unless used**, and nothing tells the agent they exist (I2).

### S9. Delivery and telemetry

VERIFIED hops: promotion writes `~/.ptah/skills/<slug>/SKILL.md` (`skill-md-generator.ts:81-83`); repropagation mirrors to `~/.ptah/user/skills` (`apps/ptah-electron/src/activation/skill-repropagation.ts`; copy: both promoted slugs exist under `~/.ptah/user/skills`). Invocation recorded only when `postToolUse.enabled` and the slug is read from `toolInput.command` first token (`skill-trigger.service.ts:~700-705`); if the SDK Skill tool input is `{skill: ...}` nothing is recorded (**INFERRED, needs one live check**). Events are `succeeded:true` by construction (5,730 of 5,732 succeeded). Telemetry is a behavioural proxy, not a correctness label (context item 8).

## 4. Memory and skill claims in prompts, UI and docs

Setup facts (VERIFIED): commit `7917b193a` deleted every `CLAUDE.md`/`AGENTS.md` under `libs/` and `apps/` (the stat includes `libs/backend/skill-synthesis/CLAUDE.md` and `libs/backend/memory-curator/CLAUDE.md`); `context.md:106` cites `skill-synthesis/CLAUDE.md` for the "judge scorecard shape must not vary" constraint, which now lives only in code/specs. `.claude/agents/*`, `.opencode/agent/*`, `.claude/commands/*`, `.claude/skills/*` make no memory/skill-learning claims (generic "not from memory" only).
A delegated pass inventoried 21 claims; I re-checked the load-bearing ones (S1 tracker, S4 prompt consumer, M8 label, M6 cue). 619 owns M1/M2 (core-prompt `ptah_memory_search` instructions), not assessed.

### Skill claims

| # | Claim (file:line) | Real path | Verdict / root cause | Metric |
|---|---|---|---|---|
| C-S1 | "A single workflow that succeeds enough times promotes itself. No review screen, no Accept button" `apps/ptah-docs/src/content/docs/skill-synthesis/index.mdx:10,21`, `how-it-works.mdx:38-60`, `mcp-and-skills/skills.md:107`, `skill-synthesis/src/index.ts:3-4` | automatic path = `SkillPromotionService.evaluate()` (`skill-promotion.service.ts:234`), only caller `SkillInvocationTracker.recordInvocation` (`skill-invocation-tracker.ts:48-80`), which has no production caller | **FAILS** VERIFIED. Producer never wired; `successesToPromote` (settings field `skill-settings-panel.component.ts:32-37`) is a dead knob | promoted rows with automatic mode (expect 0); `success_count>0` rows |
| C-S2 | Empty state: "workflow of at least 5 turns ends with a success marker ... promoted only after repeated successful runs" `skill-candidates-table.component.ts:466-470` | `MIN_ROLE_TURNS_FLOOR = 2`, success marker "NEVER a condition" (`trajectory-extractor.ts:19,120`) | **FAILS** both counts; stale copy | min `turn_count` of captured candidates |
| C-S3 | "any agent can invoke it like a hand-authored skill — same trigger semantics" `skill-synthesis/index.mdx:18`; "no second runtime path" `skills.md:107` | promotion writes `~/.ptah/skills/<slug>`, repropagation (Electron + CLI only; VS Code defaults to NoOp, INFERRED) mirrors to `~/.ptah/user/skills` and workspace `.claude/skills`; `SkillSyncGate` (`harness-sync/src/lib/state/skill-sync-gate.ts:64-80`, `harness-manifest.builder.ts:352-358`) defaults a workspace with no prior owned skills to an empty allowlist | **PARTIAL**: holds for old workspaces / Electron; fails for a new workspace until the user selects the skill; nothing at promotion adds the slug to `enabledSkillSlugs` | per promoted skill: present in a fresh workspace's `.claude/skills`; reach rate = skills with >=1 `tool-use` event (copy: 0 of 2) |
| C-S4 | System prompt "Promoted Skills — ptah.skill ... Use to discover available skills" `vscode-lm-tools/.../ptah-system-prompt.constant.ts:296-308` | `PTAH_SYSTEM_PROMPT` has no runtime consumer (grep: only comments in `enhanced-prompts.service.ts:761`, `ai-provider.types.ts:208`, exports); live core prompt `ptah-core-prompt.ts` has no skill mention; `tool-description.builder.ts` neither | **PARTIAL/FAILS** VERIFIED: agents are never told learned skills exist except via the native Skill listing (C-S3 gate); `ptah.skill.list()` is a raw FS scan that includes dormant skills | `ptah.skill.list` calls per week |
| C-S5 | Counters "Promoted" / "Active skills" `skill-stats-strip.component.ts:55-60`, `skill-pipeline-status.component.ts:219-221` | `SkillCandidateStore.getStats()` (`skill-candidate.store.ts:1675`) counts DB status; diagnostics ignores `_workspaceRoot` (`diagnostics.service.ts:25-26`) | **PARTIAL**: DB rows, includes dormant, manual and accepted, not "delivered" | promoted count vs owned skills in workspace manifest |
| C-S6 | Thoth Skills tile "N pending / candidates to review" `thoth-status.service.ts:521-528` | counts raw per-session captures (cap 1000), not the reviewable queue (suggestions) | **PARTIAL** mislabel. Copy: 694 candidates vs 14 pending suggestions | tile vs pending suggestions |
| C-S7 | "Last analysis / Sessions analyzed today (n accepted, m ineligible)" `skill-pipeline-status.component.ts:130-197` | in-memory `SkillSynthesisService` fields (`skill-synthesis.service.ts:247,1058-1077`) | **PARTIAL**, resets on restart (INFERRED) | post-restart count vs queue rows today |
| C-S8 | "Replay is designed, not running yet" `how-it-works.mdx:106-108` | matches the producer-less stage | **HOLDS** | - |
| C-S9 | "Ptah records when each one is actually used ... >=5 recorded runs -> Curator rewrites it, judge-gated, 24h cooldown" `how-it-works.mdx:118-128`; `MIN_INVOCATIONS_TO_ENHANCE = 5` `skill-enhancer.service.ts:82` | `succeeded` = tool-call success for Skill/Task, hardcoded `true` for prompt-expansion and subagent-stop (`skill-trigger.service.ts:450,518,535,615`) | **PARTIAL**: recording and threshold hold; `succeeded` is not an outcome (copy: 5,730 of 5,732 true) | fraction `succeeded=false` |
| C-S11 | Track 2 "Recommended ... only after you Accept" `index.mdx:23`, `how-it-works.mdx:62-72` | `skill-curator.service.ts:385` -> `promoteSuggestion`; reachability spec | **HOLDS** (INFERRED that the curator pass runs in production; copy shows 14 pending, so yes) | - |
| C-S12 | Marketing "learns your workflows" `apps/ptah-landing-page/src/index.html:48`; "extracts, judges, and promotes repeated session trajectories" `public/llms.txt:12`; docs home `index.mdx:49-51` | = C-S1 | **FAILS** for "promotes repeated trajectories"; works only with a human Accept | = C-S1 |

### Memory claims

| # | Claim (file:line) | Real path | Verdict / root cause | Metric |
|---|---|---|---|---|
| C-M3 | Header "## Recalled Memory Context - facts recalled from your persistent memory based on this session" `agent-sdk/.../memory-prompt-injector.ts:130-131` | `buildBlock` runs once at session-prompt assembly using the first user message only (>= 8 chars, top 5, score >= 0.05) (`sdk-query-options-builder.ts:1793-1798`; `session-query-executor.service.ts:742`) | **HOLDS, narrow**: "this session" = first message; no per-turn refresh; MIN_SCORE 0.05 not calibrated (INFERRED) | injected-block rate; share of injected hits judged relevant |
| C-M4 | Header "Workspace Memory Snapshot - Recent observations curated for this workspace (N)" `memory-prompt-injector.ts:239-247` | `listAll(workspaceRoot, undefined, 10, 0)` ordered by `salienceRankOrderBy` (`memory.store.ts:515`); only `subject` strings cross the boundary | **PARTIAL**: "Recent" is wrong (salience-ranked, subjects only, no dates); on this DB 57% of new rows tie at salience 1.0 so order is near-arbitrary | share of snapshot subjects that are informative; whether agents then search |
| C-M5 | "A curator runs automatically on every context compaction (PreCompact)" `memory/index.mdx:20` vs `how-it-works.md:8-24` | PreCompact auto passes coalesced within 900 s; all paths share 20 passes/hour | **PARTIAL**; the two doc pages contradict | passes per compaction; `rate-limited` events |
| C-M6 | Docs "Prompt submit - your prompt contains a recall cue (this retrieves)" `how-it-works.md:20`; `memory/settings.md:55` | `onUserPromptSubmit` (`memory-trigger.service.ts:481-545`) starts a curate pass (`invokeCurate(..., 'user-cue')`), retrieves nothing | **FAILS** VERIFIED: docs describe retrieval, code curates | `user-cue-trigger` events vs searches in the same turn |
| C-M7 | "Post tool use - A tool call completes" `how-it-works.md:21` | observation enqueued per tool call; a curate starts only on episode recovery or a successful `Bash` matching `COMMIT_PATTERN` | **PARTIAL** | `commit-detect` events vs tool-use observations |
| C-M8 | Thoth tile "N facts" / "M queued for curation" / "All curated" `thoth-status.service.ts:496-507` | `queueLength: stats.recall` (`:310`) = count of recall-tier memories (already curated); "facts" = core+recall+archival incl. events/entities | **FAILS** VERIFIED: label inverted, placeholder metric (type comment `:49-56` admits it). Copy: 15,609 recall rows would read "15.6k queued for curation" while the real unprocessed backlog is 59,614 observations | tile vs pending `observation_queue` |
| C-M9 | Memory tab "Facts, events, and code Thoth has learned across sessions" `memory-curator-tab.component.ts:112` | code symbols come from workspace indexing, not session learning | **PARTIAL** | - |
| C-M10 | "All memory state is in `~/.ptah/ptah.db`" `how-it-works.md:38,66` | real path `~/.ptah/state/ptah.sqlite` (`persistence-sqlite/src/lib/db-path.ts:11-12`) | **FAILS** stale, low impact | - |
| C-M11 | "It remembers your codebase" `index.html:48`; "Persistent memory ... auto-curated" `llms.txt:7,11`; docs home "Decisions from last week still apply this week" `ptah-docs/.../index.mdx:44-47` | roster + first-message search (C-M3/M4), else the agent must choose to call `ptah_memory_search`; "remembers your codebase" is the code-symbol index | **PARTIAL**; no knowledge-update semantics (M6), lifecycle deletes unused rows (M4) | fraction of past-reference prompts followed by a memory search in the same turn |

Injection summary (answers "what gets injected and when"): memory = at session creation only, `[Workspace roster: 10 subject names]` + `[corpus names]` + `[top-5 chunks for the first user message]`, then nothing; thereafter only on-demand via `ptah_memory_search` (619). Skills = never injected into a prompt; they exist only as files the SDK discovers from `.claude/skills` (gated per workspace, C-S3). Neither has an outcome measurement.


## 5. Shipped feature inventory (one row per feature)

Strength scale: **none** = no effect measurement; **weak** = unit/integration tests or one hand-judged sample on the live DB; **moderate** = pre/post on a copy with a recorded method. No feature reaches **strong** (baseline + independent ground truth + CI). "Reach" = does the production path reach the code.

| Feature (shipped in) | Claim and file:line | Reach | Existing evidence (strength) | Metric that proves/disproves | Independent ground truth | Baseline |
|---|---|---|---|---|---|---|
| Retention job, processed purge 7 d, stuck-row quarantine/delete 14 d, vacuum (440, PR #513) | "DB growth bounded; no useful memory lost": `memory-retention-config.ts:31-32`; cron `thoth-runtime/src/lib/memory-retention-job.ts:43` | VERIFIED (job registered; copy `memory_retention_state.last_outcome='completed'`, `stuck_quarantined 134`, `pages_reclaimed 1775`) | unit specs only (weak). Copy contradicts "bounded": `observation_queue` is 483 MB of 902 MB with 59,614 unprocessed rows (M2) | DB bytes vs time under a synthetic session load; unprocessed-observation age p95; useful-row loss via canary recall set | observation_queue and transcript files (not produced by retention); seeded durable facts | current default vs "no retention" growth curve |
| Memory age lifecycle archive/delete, per-workspace cap, ranking-only salience (443, PR #521) | "old unused rows leave, useful ones stay; ranking improves vs recency only": `memory-lifecycle-config.ts:12-17`, `memory-lifecycle.store.ts:12-71`, `salience-ranking.ts:1-34` | VERIFIED (copy: 11,282 archived; deletes by `last_used_at`/`archived_at` only) | weak: specs pin protection of pinned/core/corpus rows; 563 measured relevance 16/20 -> 9/20 after deletions (against). Ranking-vs-recency improvement never measured; salience saturates (M7) | loss-by-kind and archived-then-needed rate; ranking NDCG@k vs pure recency on seeded queries | seeded facts aged by injected clock; human-labelled relevance | (a) no lifecycle, (b) recency-only order |
| Skills unblock: manual promote, stricter prefilter, delete fake creation invocation, one-time backlog cleanup, namer (461, PR #526) | "prefilter rejects noise and keeps real routines": `eligibility/session-work-evidence.ts`; manual gate `skill-promotion.service.ts:206` | VERIFIED manual promote + cleanup; fake-invocation deletion consistent with copy (`skill_invocations` = 0 rows, 2,433 in 471); namer wiring not checked (unverified) | none for "keeps real routines" (activity-count prefilter, no outcome check). Copy: 1,869 candidates rejected by cleanup as "no transcript"; prefilter done 392 / skipped 107 / queued 1,193 | prefilter precision/recall on labelled sessions (routine yes/no); share of retained candidates with a verified outcome | frozen human-labelled session set | accept-all; turn-count heuristic |
| Activity feed correctness (586, PR #620) | "feed events match the real event ledger": 586 `test-report.md` (live push == snapshot wire) | VERIFIED integration through `SkillSynthesisService` ring + RPC | weak: compares live vs snapshot of the same in-memory ring, not the feed vs durable tables; ring resets on restart (INFERRED) | feed events vs rows in `skill_synthesis_queue`/`skill_session_verdicts`/`skill_candidates` for a replayed run | the DB tables written by the pipeline | parity with DB |
| FTS stopwords + AND query; per-subject merge window (473 Track A) | relevance up, merge supply up: `MC/fts-query.util.ts`, `memory.store.ts` `findMergeCandidates` | VERIFIED (BM25 call sites; collector `memory-curator.service.ts:775`) | moderate: 4.5/20 -> 16/20 on 4 hand-judged queries (2026-09-19), judged by the author lane; 16/20 did not reproduce: 9/20 on 2026-09-26 because rows were deleted; merge supply 4 -> 50 measured, merge rate not | recall@k/NDCG@k on seeded facts; merge precision | pinned seeded corpus (not the live DB); human pair labels | old OR query; no merge |
| Extract prompt durability, searchRich merge candidates, sediment quarantine (563, PR #601) | "less sediment, more correct merges, no over-suppression": `agent-sdk/.../extract-prompt.ts:1-66`, `merge-candidate-collector.ts`, `0049` | VERIFIED prompt and collector reach `doCurate`; quarantine is a one-off migration | moderate: 563 harness (10 sessions, 86 calls; sediment 20.6% -> 11.7%, durable 100 -> 105) with 4 failed gates (M4-8(a) share, M4-8(c) 5 over-suppressed, M3-8(b) 7/23 vs 8/23, relevance 9/20). My copy proxy: event share 24.5% -> 2.1%, task-id 21.9% -> 1.3% (913 rows, confounded) | durable precision/recall on held-out sessions; merge precision; over-suppression rate | frozen hand-labelled sessions (563 `m4-draft-classifications.md` is a start) | old prompt (`ebfc73321`); extract-all |
| Skill merge, judge gate, promote on accept, retire unused (578, PR #626) | "good skills promote, bad ones do not; retired skills were unused": `lifecycle/skill-umbrella-merge.service.ts`, `skill-promotion.service.ts`, `lifecycle/skill-retirement.service.ts:269-289` | VERIFIED reachability spec; 578 real-data run adopted 2 legacy suggestions; copy: 18 suggestions, 4 decided | weak: no positive control; judge saturated (11/18 = 10.0); retirement can retire a just-used skill (open); the 2 promoted skills have 0 invocations | judge-vs-human agreement; precision of promoted set on a human rubric; retired-skill last-use gap | the 8-criterion exemplar rubric (471 `skill-quality-criteria.md`) scored by humans | authored skills, random drafts, template fallbacks |
| Memory injection into agent context | roster + first-message recall: `memory-prompt-injector.ts:107-258`, `sdk-query-options-builder.ts:1781-1798` | VERIFIED on the Electron path; CLI/RPC hosts may bind a Null recorder (`register-thoth-libraries.ts:223`) | none for outcomes; `hits` records exposure only | task success / corrections / tokens / turns with injection vs without on replayed tasks | git history and seeded facts: tasks whose correct answer depends on a prior decision | no memory; last-N messages; transcript grep |
| Skill injection / triggers (existing) | native Skill listing via mirror + gate; `ptah.skill` namespace; telemetry `skill-trigger.service.ts` | VERIFIED delivery chain for promoted skills in Electron/CLI; gated per workspace (C-S3); no prompt mention (C-S4) | none for outcomes; telemetry is behavioural (context item 8) | task success/turns/tokens with the skill vs without; trigger precision on labelled prompts | human-labelled "prompt should/should not trigger skill X"; task success judged by tests | no skill; authored skill of the same topic |
| Session-start roster and corpus priming (existing) | `buildSessionStartBlock`, `buildCorpusBlock` `memory-prompt-injector.ts:174-349` | VERIFIED roster; corpus only when `sessionConfig.corpusName` set | none | informativeness of roster subjects; effect on first-turn tool calls | labelled subjects | no roster |
| Curator trigger/admission machinery (existing) | `memory-trigger.service.ts`, `curator-pass-admission.ts` | VERIFIED | many unit specs (weak); the M2 outage shows no end-to-end liveness evidence | sessions with observations vs memories created within T | observation_queue / transcript files | invariant: 0 unprocessed beyond T |
| Skill enhancer (auto-enhance after >= 5 runs) | `skill-enhancer.service.ts:82`, `how-it-works.mdx:118-128` | INFERRED reach (needs promoted skills with >= 5 events; copy: 0 events) | none | quality delta enhanced vs original on the exemplar rubric | human rubric | un-enhanced skill |
| Setup-wizard memory seed (existing) | `memory-writer.adapter.ts:55-90` (only supersede path) | INFERRED | `memory-writer.dedup-parity.spec.ts` (weak) | seeded-fact retrieval and replace correctness | seed manifest | none |

## 6. Benchmark inputs

Ground-truth source inventory and external-reference verification are delegated to `ground-truth-sources.md` and `references.md`. Here: metric, the idea of an independent truth, and a baseline per failure. Rule: nothing may be produced by the feature under test; use seeded facts with injected clocks, held-out sessions, transcript/observation files, git history, and a frozen human-labelled set.

LongMemEval taxonomy (the five abilities confirmed from the arXiv abstract page 2410.10813, fetched 2026-10-06): extraction, multi-session reasoning, temporal reasoning, knowledge updates, abstention. Mapping: extraction = M1/M2; multi-session = M3 and S2; knowledge update = M6; temporal = M6 (no dates in the recall block); abstention = injection of low-score hits (C-M3, MIN_SCORE 0.05).

| Failure | Metric | Independent truth (idea) | Baseline |
|---|---|---|---|
| M1 durable extraction | durable precision, durable recall, over-suppression rate | held-out sessions with human-labelled facts; seeded sessions where facts are authored first | old prompt; extract-all; no memory |
| M2 silent extraction loss | sessions with observations but 0 memories; unprocessed-age p95; error-pass-marked-processed count | observation_queue and transcript files | invariant 0 |
| M3 dedup/resolve | merge precision/recall on labelled pairs; duplicate-cluster rate; calls per merge | human-labelled same/different-fact pairs from real rows; seeded paraphrases | byte-equal subject; never merge; tier-1-only |
| M4 retention | useful-row loss by kind; archived-then-needed rate; DB bytes growth | seeded durable facts with injected clock | no lifecycle; age-only |
| M5 workspace keying | recall of a main-repo fact from a worktree cwd; distinct roots after canonicalisation | git common-dir of each recorded root | exact-string (current) |
| M6 update/contradiction/temporal | knowledge-update accuracy; temporal ordering accuracy | seeded (v1,t1),(v2,t2) pairs through the real pipeline | latest-chunk-wins; no memory |
| M7 salience | rank correlation of salience with an outcome label | later-session evidence (fact reused, not corrected) plus a human-labelled subset | recency only; random |
| S1/S9 promotion reach, telemetry | share promoted without human; reach rate; events per promoted skill; `succeeded=false` share | candidate/event tables vs a labelled "skill really used" subset | 0 today |
| S2/S3 prefilter, archaeology | prefilter precision/recall; verdict accuracy (`routine`, `evidence_class`) | human-labelled routine yes/no sessions; test outcomes in transcripts | accept-all; turn-count heuristic |
| S5/S6 judge, replay | judge-vs-human agreement; score distribution; positive-control pass; replay coverage | human-scored exemplar set (471 rubric): authored, generated, fallback | random; length; authored = ceiling |
| S4 backlog | queue age p95, backlog slope, judged share | queue/candidate tables | invariant |
| Injection (C-M3/M4/C-S3) | task success, corrections, tokens, calls with vs without injection | tasks derived from git history / known prior decisions, scored by tests or labelled answers | no memory/skill; last-N messages; transcript grep |

## 7. Starting point for the benchmark (changes since 471)

- Corpus 36,252 -> 26,895 rows; 42% archived; sediment filtered at write by prompt only.
- Candidates 2,433 -> 2,587: 1,891 rejected (1,869 by cleanup), 694 `candidate`, 2 `promoted`; `skill_invocations` emptied.
- Backlog still grows (prefilter queued 605 -> 1,193).
- 18 suggestions: judged saturated; 2 accepted (legacy), 2 dismissed, 14 pending.

## 8. Corrections to context.md

- Item 4: "generator forbids tables and boundaries (`skill-synthesizer.service.ts:240-248`)": I found no explicit prohibition (it prefers a short `## Steps` list, conciseness, generalisation). Schema and shallow cluster input hold.
- Item 1: the `resolve-prompt.ts:19` it cites is dead code; the live prompt is in `agent-sdk`.
- Item 9: "judge panel scorecard shape must not vary (`skill-synthesis/CLAUDE.md`)" cites a deleted file.
- Item 7: only the one-time unjudged purge (reject, not judge) and the umbrella/suggestion path exist; none of the five sub-items is closed except partly cross-session clustering.

## 9. Unverified and open

- Cause of the 2026-09-24..10-01 extraction outage (host, lane, flag): needs `C:\Users\abdal\AppData\Roaming\Ptah\logs` for those dates.
- Whether 563's cap-eviction explanation of the 36,252 -> 26,706 drop is right (only last-run stats are stored).
- Whether the SDK Skill tool input uses `command` or `skill` (decides if `skill-trigger.service.ts:~700-705` records anything); VS Code `NoOpSkillRepropagation`; whether the reranker is still inert (not re-run); namer wiring (461); `skill-gap-curator` "insert is never called"; the in-memory eligibility histogram reset (C-S7).
- Hand-labelled quality of any row: all sediment/durable figures are SQL proxies.
- The real DB was not hashed before/after; only the copy hash is recorded (the live app writes continuously).
- Line numbers marked `~` or from the delegated code pass were spot-checked only where stated in the text.
- External references (Voyager, AWM, ExpeL, SkillWeaver, Reflexion, LoCoMo, mem0, LocBench): left to `references.md` by instruction; I fetched abstract pages only.
