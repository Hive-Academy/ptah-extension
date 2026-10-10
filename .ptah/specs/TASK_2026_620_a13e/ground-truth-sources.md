# Ground-Truth Sources — TASK_2026_620_a13e (memory and skills benchmark)

## Question

- Decision this supports: phase 2 `benchmark-design.md` — which frozen, independent corpora the memory arm and the skills arm score against, and how each is frozen and labelled.
- Question: which sources on this machine yield ground truth the memory/skill system did not produce, how many usable items does each yield, and which sets, scenarios and baselines do they support?
- Bounds: not investigated — external benchmark internals (LongMemEval, LoCoMo, Voyager, etc.; `context.md:57-61` already carries them as unverified), the contents of `~/.ptah/state/ptah.sqlite` (never opened, per scope), session-transcript contents beyond the 2 samples allowed, and the mcp-bench code on `fix/task-619-tool-benchmark` beyond verifying its three commits exist.

Rule applied throughout (context.md:47-49, task scope): ground truth must not be produced by the system under test, and must not be a live-DB sample the lifecycle can delete (the 473 set decayed 16/20 → 9/20 that way, `TASK_2026_563_2939/test-report.md:399-416`).

## Answer

Build the memory arm on a seeded-fact set mined from the **git-tracked `.ptah/specs` corpus plus git-history reversal pairs** — both dated, freezable at a pinned commit, and independent of the memory/skill pipeline — with a **date-split of the 2,899 session JSONLs** as held-out evaluation windows. Build the skills arm on the **26 git-tracked authored skills** (positives) versus a **frozen, hash-manifested sample of the 2,745 live-state synthesized candidates** (negatives), labelled blind by two humans with the existing 471 rubric. Live-database rows are rejected as ground truth: every proposed label is anchored in git or on a frozen copy.

## Evidence

| Claim | Source | Date | Verified how |
| --- | --- | --- | --- |
| 3,747 commits on HEAD; conventional-commit messages with scopes; merges carry `Merge pull request #N from Hive-Academy/<branch>` | `git rev-list --count HEAD`; `git log -n 10`, `git log --merges -n 12` | 2026-10-06 (HEAD) | ran it |
| Same-day reversal pair: "key Antigravity owners on the active Google account" then "key Antigravity owners on the language-server account" | commits `e94159db7` → `b2c21bfc8` | 2026-10-05 | ran `git log -i --grep=...` |
| Replacement pair: "replace retired Ollama Cloud default models" then "offer the new Ollama Cloud defaults in the static catalog" | commits `e102153eb` → `dc416858e` | 2026-10-06 | ran it |
| "docs: remove all CLAUDE.md and AGENTS.md files" | commit `7917b193a` | 2026-09-22 | ran `git show -s` |
| 274 `TASK_*` folders in `.ptah/specs`; 1,932 markdown files; 4,334 git-tracked files under `.ptah/specs` (specs are committed, hence dated) | `Get-ChildItem`/`Select-String` counts; `git ls-files .ptah/specs` | 2026-10-06 | ran it |
| 74 spec files carry `## Decision(s)` / `### Decision` / `Rejected` headers; 28 spec files carry user preference/correction phrasing | `Select-String -List` counts over `.ptah/specs` | 2026-10-06 | ran it (per-file counts; overlap between the two sets not measured) |
| Dated user-decision headers exist, e.g. "## Decisions taken (user, 2026-08-17)" (`TASK_2026_267/context.md:12`), "## Decision taken (2026-08-16)" (`TASK_2026_253/context.md:88`), "## Decision record — 2026-09-19, R2 + notification-center lane" (`TASK_2026_404_6fcd/context.md:86`) | grep over `.ptah/specs` | as quoted in each header | read the grep matches |
| User corrections/preferences in specs: "The user corrected this:" (`TASK_2026_490_583c/context.md:18`); "The user prefers CLI lane execution over subagents" (`TASK_2026_441_7825/task.md:9`); "(2026-10-04, fourth session). The user chose stage S4 … APPROVED these rules" (`TASK_2026_597_ab22/context.md:174-175`); "The user approved five rules for the rest of TASK_2026_597" (`TASK_2026_613_8f34/task.md:20`); "The user chose option 1 (per handler)" (`TASK_2026_599_8684/context.md:11`) | grep over `.ptah/specs` | as quoted | read the grep matches |
| 471's skill-quality-criteria doc is git-dated: entered via `12865f539` (2026-09-19), merged `1f668c9e1` (2026-09-20) | `git log -- <file>` | 2026-09-19 | ran it |
| 26 authored skill dirs in repo `.claude/skills`; 211 git-tracked files; last skills commit `871b0022b` "chore: update subagents and skills" | `Get-ChildItem`; `git ls-files .claude/skills`; `git log -- .claude/skills` | 2026-10-04 (last touch) | ran it |
| 6 CLAUDE.md files remain, all under `tools/hyperframes/**` (project/video docs); the lib-level ones (incl. `skill-synthesis/CLAUDE.md`) were removed by `7917b193a` | glob `**/CLAUDE.md`; `git log -- libs/backend/skill-synthesis/CLAUDE.md`; `git ls-files -- 'tools/hyperframes/**/CLAUDE.md'` (=6) | 2026-09-22 (removal) | ran it |
| 2,745 synthesized candidate dirs at `C:\Users\abdal\.ptah\skills\_candidates\<slug>\SKILL.md`; candidates are written by the pipeline (`registerCandidate`, `skill_candidates` table) and deleted by the cleanup store | `Get-ChildItem` count; `471/skill-quality-criteria.md:95,103` (path quotes); `libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.store.ts:120,147` | 2026-10-06 (count) | ran it / read the citations |
| Session transcripts live at `C:\Users\abdal\.claude\projects\<munged-workspace-root>\<sessionId>.jsonl` (+ `subagents\agent-*.jsonl`); main-repo dir holds 2,576 files (oldest mtime 2026-09-06, newest 2026-10-06); 2,899 JSONLs across all project dirs; 8 ptah session-recovery JSONLs in `C:\Users\abdal\.ptah\tmp\session-recovery-2026-09-09T15-50-39-631Z\` | `Get-ChildItem` counts; glob | 2026-10-06 (count) | ran it |
| JSONL lines carry ISO timestamps and workspace identity (sample 2, worktree session: `"timestamp":"2026-09-08T21:29:35.327Z"`, prompt embeds the worktree path); sample 1 (main-repo session): lines 1-2 are `custom-title`/`agent-name` metadata | sampled 2 files (read 2 lines each) | 2026-09-08 (sample timestamp) | read the samples |
| Real second workspaces with sessions: `D--projects-qa3elhamor` (71), `D--projects-property-hub` (11), `D--projects-website-manager`, `D--projects-seshat`; worktree project dirs hold 7-18 files each | `Get-ChildItem` group counts; glob | 2026-10-06 | ran it |
| `git worktree list`: main + 32 worktrees (33 rows), incl. `.claude-worktrees/task-619-tool-benchmark` (do not touch) | `git worktree list` | 2026-10-06 | ran it |
| 619 shared infra exists on branch `fix/task-619-tool-benchmark`: `122a9dd7b` (batch 1, retrieval+cost metrics), `4fc9d147c` (batch 2, scorecard model + pinned corpus checkout), `b538e8fb6` (batch 3, HTTP transport + isolated cli-headless bench host) | `git log -n 5 fix/task-619-tool-benchmark` | 2026-10-06 (branch tip) | ran it |
| 563 harness never opens the live DB: SHA-256-verified snapshot, online-backup-API working copies under `%TEMP%\mqs-563-eval\`, MCP off, `persistSession: false`; outputs judged by hand into `harness/output/` | `TASK_2026_563_2939/harness/README.md:7-21,88` | undated (task 563, merged PR #601) | read it |
| 473 Track A: 4 queries × 5 rows = 20 hand-judged relevance labels with reasons, 16/20 relevant, baseline 4.5/20; decayed to 9/20 because 10 of 20 rows no longer exist (443 age lifecycle deleted rows after 2026-09-19) | `473/track-a-retrieval-measurement.md:70`; `563/test-report.md:399-416`; `563/harness/output/relevance-main.md:72` (Q4 re-measured 0/5) | 2026-09-19 (471 doc git date) / undated (473, 563 docs) | read them |
| 471 rubric: 8 criteria, pass ≥64/80, no criterion <6; 10 top candidates scored 1.25-2.38/10 vs pipeline judge 7.8-8.4; 16 cluster suggestions 1.5-2.8 vs exemplars 8.5-9.8; invocation telemetry is a behavioural proxy, not a correctness label | `471/skill-quality-criteria.md:51-87,189-200`; `471/implementation-plan.md:52-62` (via `620/context.md:129-131`) | 2026-09-19/20 (git) | read the criteria doc; the implementation-plan claim read via context citation, not directly |

## Source findings

### 1. Git history — yields ~15-25 clean update/contradiction/temporal fact pairs (inferred)

3,747 commits, conventional-commit format (`type(scope): subject`), every commit dated. Merge commits map PR number ↔ branch ↔ task id (last 12 merges: PR #649-#660, 2026-10-05/06). One capped `--grep` pass over update/replacement verbs (`revert|decided|convention|no longer|replaced|instead`, `-n 40`) returned exactly 40 matches, so the real candidate pool is larger; expect low hundreds of verb matches across the full history, filtering down to ~15-25 **clean set-then-replaced pairs** (estimate, inferred). Worked pairs already verified:

- `e94159db7` (2026-10-05) "key Antigravity owners on the active Google account" → `b2c21bfc8` (2026-10-05) "key Antigravity owners on the language-server account" — same-day reversal.
- `e102153eb` (2026-10-06) "replace retired Ollama Cloud default models" → `dc416858e` (2026-10-06) "offer the new Ollama Cloud defaults in the static catalog".
- `7917b193a` (2026-09-22) "docs: remove all CLAUDE.md and AGENTS.md files" — a standing-docs convention reversed.
- `72de6c268` (2026-10-05) "move the HOST_KIND fact into PLATFORM_TOKENS" — convention migration (old magic-string rules are now stale).
- `3129c038a` (2026-10-06) "report GLM-5.3's 1M context window" — factual capability update.

Independence: full — commit messages are human/CI-authored artifacts of real work; the memory/skill pipeline never writes them. Effort: low (read-only `git log`/`git show`).

### 2. `.ptah/specs/TASK_*` — the primary seeded-fact mine (~75 of the ≥100 facts)

274 task folders, 1,932 markdown files, **all committed to git** (4,334 tracked files under `.ptah/specs`) — so every doc has a git commit date plus inline dates, and the whole corpus freezes at any pinned commit. Measured labelable surface:

- **74 files** with `## Decision(s)` / `### Decision` / `Rejected` headers (e.g. `TASK_2026_331/implementation-plan.md:745-803` logs 9 numbered decisions; `TASK_2026_376/context.md:237` "Rejected during the trace — do not re-file"; `TASK_2026_388/implementation-plan.md:47` and `TASK_2026_396/implementation-plan.md:77` "Rejected alternatives").
- **28 files** with explicit user preference / correction / approval phrasing (examples in the evidence table).
- Folder ids are date-ordered (`TASK_2026_253` → 2026-08-16, `267` → 2026-08-17, `276` → 2026-08-18, `404` → 2026-09-19, `597` → 2026-10-04, `620` → 2026-10-06), giving natural temporal splits.

Independence: task working docs are **inputs** to the system (written by user + agent lanes as task artifacts; memory extracts from sessions, not from specs). One carve-out: the measurement docs of 471/473/563 quote live memory rows — exclude those specific documents (their quoted rows are system output). Expected yield: 1-3 labelable facts per decision/preference file → comfortably ≥100 across 471+git (inferred). Effort: medium — each fact needs a human-written expected answer.

### 3. CLAUDE.md and skills — positives and negatives for the skills arm

- **CLAUDE.md: near-zero yield.** Only 6 files remain, all under `tools/hyperframes/**` (video-project docs, not Ptah behavior rules). All lib-level CLAUDE.md/AGENTS.md were removed by `7917b193a` (2026-09-22). Note: `620/context.md:134` still cites `skill-synthesis/CLAUDE.md` as a standing constraint — that citation is stale, which is itself a worked example of why facts need pinned dates.
- **Positives: 26 authored skill dirs** in repo `.claude/skills` (agent-lanes, orchestration, tribunal, fleet-orchestration, ptah-cli-usage, skill-creator, …), 211 git-tracked files, last touched `871b0022b` (2026-10-04). Frozen for free at any pinned commit. 471 scores these exemplars 8.5-9.8/10.
- **Home skills**: 13 SKILL.md under `C:\Users\abdal\.claude\skills` (hyperframes product skills) — third-party installed docs; useful only as an extra hold-out for the prefilter/trigger tests, not as Ptah-quality positives (see Unknowns).
- **Negatives/unknowns: 2,745 synthesized candidate dirs** at `C:\Users\abdal\.ptah\skills\_candidates\<slug>\SKILL.md` — found where the pipeline writes them (path quoted in `471/skill-quality-criteria.md:95,103`; written via `registerCandidate` into the `skill_candidates` table, `skill-synthesis/src/lib/gates/cluster-holdout-end-to-end.spec.ts:93`). These are **live state outside git**: the cleanup store deletes candidate rows (`skill-backlog-cleanup.store.ts:120,147`) and boot reconcile can delete promoted dirs (620 context.md:90, 578 P1). They must be frozen by copy + SHA-256 manifest before labelling. Independence is correct in the benchmark sense: the *artifacts* are system output (that is what is being judged); the *labels* come from humans with the 471 rubric, never from the pipeline's own judge.

### 4. Session transcripts — held-out windows, multi-session facts, abstention

Location: `C:\Users\abdal\.claude\projects\<munged-workspace-root>\<sessionId>.jsonl` (+ `subagents\agent-*.jsonl`). Counts (2026-10-06): main repo dir **2,576** files (mtime window 2026-09-06 → 2026-10-06); **2,899** across all project dirs; plus 8 ptah session-recovery JSONLs in `~\.ptah\tmp\session-recovery-2026-09-09T15-50-39-631Z\`. Content was not read in bulk (per scope); 2 samples confirm the shape: metadata first lines (`custom-title`/`agent-name`/`ai-title`), then operation lines carrying ISO `timestamp` fields and full task prompts that embed the workspace/worktree path.

Held-out split by date (proposal): pick a cutoff, e.g. 2026-10-01 — sessions whose lines all fall before the cutoff form the **seed window** (what memory should have absorbed), sessions after it form the **eval window** (new-session queries). The split keys off the per-line `timestamp` field / file mtime, so it can be built by a streaming scan that never loads message bodies into a labeller. Caveat: sessions are the raw input the memory system extracts from, so they are independent as ground truth only in the "expected memory must be traceable to a session line" sense; exclude any session generated by a benchmark harness itself (the 563 precedent: `persistSession: false`, MCP off — `harness/README.md:19-21`). Effort: high — each fact's provenance must be pinned to a line.

### 5. Existing hand labels — reuse, do not rebuild

- `TASK_2026_471_b3d1/skill-quality-criteria.md` (git-dated 2026-09-19/20): the **8-criterion exemplar rubric** (C1-C8, pass ≥64/80, no criterion <6) at `:51-69`, a drop-in 5-criterion judge rubric at `:259-272`, **10 candidates already scored** (1.25-2.38/10 vs pipeline judge 7.8-8.4, `:76-87`) and **16 cluster suggestions scored** (1.5-2.8 vs exemplars 8.5-9.8, `:189-200`). This is the skills-arm label instrument, already committed.
- `TASK_2026_473_c9f4/track-a-retrieval-measurement.md`: **20 relevance labels** (4 queries × 5 rows) with per-row reasons, 16/20 relevant, vs a 4.5/20 baseline (`:70`). Its decay is documented at `563/test-report.md:399-416` and re-measured post-quarantine in `563/harness/output/relevance-main.md` (Q4 0/5). These 20 questions survive as *questions* with known-then answers; their live-row anchors do not survive (by design, that is the abstention corpus now).
- `TASK_2026_563_2939/harness/`: the DB-safety pattern to reuse — SHA-256-verified snapshot, online-backup working copies under `%TEMP%\mqs-563-eval\`, live DB never opened (`README.md:7-21`), hand-judged outputs committed under `harness/output/`.

### 6. Worktrees and second workspaces — scenario data, not fact data

`git worktree list` shows main + 32 worktrees. `.claude/projects` proves worktree sessions land under their own munged root (`D--projects-ptah-extension--claude-worktrees-*`, 7-18 files each) and four real second workspaces exist (`qa3elhamor` 71, `property-hub` 11, `website-manager`, `seshat`). The memory DB keys rows by exact `workspace_root` (620 context.md:80-81; a worktree row was measured correctly out of scope at `563/test-report.md:407-409`). Independence: full (real roots, real sessions). Effort: low-medium (orchestration, not labelling).

## Proposals

### (a) Seeded-fact set for the memory arm (target ≥100)

Schema per fact: `id | source (file:line or commit) | date | category (extraction / multi-session / knowledge update / temporal / abstention) | expected memory (the row content a correct system holds) | expected answer | scenario tag (new / update / delete / two-workspace / worktree)`.

Composition to reach ≥100 (yields are estimates, inferred from the measured file counts):

| Slice | Count | Category mix |
| --- | --- | --- |
| Spec decision/rejection files (74 measured, sample ~40 files, 1-3 facts each) | 60 | extraction, temporal, knowledge update |
| Spec user preference/correction files (28 measured, all) | 15 | extraction, knowledge update (corrections supersede) |
| Git reversal/replacement pairs | 15 | knowledge update, contradiction |
| Cross-session facts (a rule set in one task, applied in a later task, e.g. 597 → 613) | 10 | multi-session |
| Abstention: questions whose only ground-truth rows were lifecycle-deleted + topics absent from the seed window | 10 | abstention |
| **Total** | **110** | |

Ten worked examples (sources verified in this pass):

| id | source | date | category | expected memory | expected answer |
| --- | --- | --- | --- | --- | --- |
| F-001 | `TASK_2026_441_7825/task.md:9` | 2026-09 (folder window) | extraction | user prefers CLI lane execution over subagents, subagents are the fallback | "The user prefers CLI lane execution; subagents are the fallback." |
| F-002 | `TASK_2026_490_583c/context.md:18` | 2026-10 (folder window) | knowledge update | the user corrected the first synthesis's judging frame ("fit into the existing coding tool") | the corrected framing supersedes; the old framing must not be served as current |
| F-003 | `TASK_2026_597_ab22/context.md:174-175` + `TASK_2026_613_8f34/task.md:20` | 2026-10-04 | multi-session | fourth session of 597: user chose stage S4 and approved five rules; 613 ships them | "Five rules approved on 2026-10-04 for the rest of TASK_2026_597; TASK_2026_613 ships them." (requires joining two tasks) |
| F-004 | `TASK_2026_267/context.md:12` | 2026-08-17 | temporal | "Decisions taken (user, 2026-08-17)" record | answering "what was decided on 2026-08-17" requires the dated record, not any later decision |
| F-005 | `TASK_2026_404_6fcd/context.md:86` | 2026-09-19 | temporal | Decision record 2026-09-19: R2 + notification-center lane | same-shaped dated answer |
| F-006 | commits `e94159db7` → `b2c21bfc8` | 2026-10-05 | knowledge update / contradiction | Antigravity owners keyed on the language-server account (supersedes active-Google-account keying from the same day) | only the newest keying is current; asking the old phrasing must surface the replacement |
| F-007 | commits `e102153eb` → `dc416858e` | 2026-10-06 | knowledge update | retired Ollama Cloud default models replaced by the new defaults in the static catalog | the new defaults are current |
| F-008 | commit `7917b193a` | 2026-09-22 | knowledge update | all CLAUDE.md/AGENTS.md files removed from the repo | "the repo's CLAUDE.md behavior rules were removed on 2026-09-22" — a query citing `skill-synthesis/CLAUDE.md` (as `620/context.md:134` still does) must not be answered from the removed file |
| F-009 | `TASK_2026_376/context.md:237` | 2026-09 (folder window) | abstention (negative) | "Rejected during the trace — do not re-file" list | a question phrased as if a rejected approach were current must surface the rejection, not the approach |
| F-010 | 473 Track A corpus post-lifecycle (`563/test-report.md:404-409`) | after 2026-09-19 | abstention | (none — rows deleted by the 443 age lifecycle) | "not known / no memory" — the designed version of the 16/20 → 9/20 decay |

Answers are graded against the frozen expected answer (string/regex or rubric-checked), never by the pipeline's own judge; per context.md:58-59, do not gate on LLM-judge QA accuracy.

### (b) Frozen human-labelled set for the skills arm

- **Positives**: the 26 repo-authored `.claude/skills` dirs, pinned at a commit (they are tracked — 211 files; last touch `871b0022b`, 2026-10-04). Reconcile the 26-vs-28 count first (see Disagreements).
- **Negatives/unknowns**: a stratified sample of 50-100 of the 2,745 `~\.ptah\skills\_candidates\` bodies, **frozen by copy + per-file SHA-256 manifest** (they are live state; the cleanup store and boot reconcile can delete them). Stratify by pipeline judge-score band where the frozen copy's DB carries scores; always include the 10 candidates 471 already scored, as anchors.
- **How a person labels**: two raters score each document with the 471 8-criterion rubric (`skill-quality-criteria.md:51-69`), **blind to origin** (positives and negatives shuffled into one list), pass ≥64/80 with no criterion <6; a third rater adjudicates disagreements; the frozen artefact is a committed CSV (`rater-id, per-criterion scores, verdict, note`).
- **Inter-rater check**: report raw agreement and Cohen's κ on the pass/fail verdict; require κ ≥ 0.6 before the set is usable; re-rate 471's 10 pre-scored candidates blind to measure rubric stability over time.

### (c) Scenarios (real lifecycle, per context.md:50-51)

1. **New session**: seed facts from the seed window (sessions ≤ cutoff, e.g. 2026-09-30), query in a fresh session after 2026-10-01 with no other context.
2. **Update/contradiction**: seed both facts of F-006/F-007/F-008-style pairs with their dates; query for "current" (newest must win) and for the old phrasing (contradiction resistance). The 471 decisions (judge rubric replaced; Jev not adopted, `620/context.md:96-99`) are additional in-corpus pairs.
3. **Deletion**: the designed version of the 473 decay — seed facts, run the 443 age-lifecycle/retention job on the seeded DB copy, re-query: designed deletions happen, useful rows stay, deleted topics abstain. Runs on the 563 snapshot pattern (SHA-256-verified copy under `%TEMP%`, live DB never opened).
4. **Two workspaces**: seed facts under two real roots (e.g. `D:\projects\ptah-extension` and `D:\projects\qa3elhamor`, which has 71 real sessions); cross-workspace queries must not leak (`workspace_root` keying).
5. **Worktrees**: run a session under a real worktree root (32 exist; worktree sessions demonstrably get their own project dirs) — current design: a worktree sees no main-repo memories (`620/context.md:80-81`, confirmed out-of-scope at `563/test-report.md:407-409`). The bench gates on the designed isolation and measures its recall cost.

All five run on the 619 shared infra (isolated cli-headless bench host, HOME/USERPROFILE isolation, hash check on the real DB — commits `122a9dd7b`, `4fc9d147c`, `b538e8fb6`, verified on the branch); reuse, never fork (`620/context.md:70-76`).

### (d) Baselines each set supports

- **No memory**: same queries against an empty seeded DB / MCP off — measures what the model alone knows plus abstention honesty (F-009/F-010 make this baseline non-trivial).
- **Raw transcript grep**: `rg` over the held-in session JSONL corpus — the baseline that beat the measured tools in 619 (6 losses, 2 wins, 1 tie, `620/context.md:8-10`); the seeded-fact set scores it on recall@k.
- **Last-N messages**: only the last N (e.g. 50) turns of the current session injected — the recency-only baseline; the temporal and multi-session facts are where it must lose.
- **Old OR query** (retrieval arm): the pre-473 FTS OR-query behaviour (baseline 4.5/20, `473/track-a-retrieval-measurement.md:70`) for the AND+top-up comparison.
- Metrics: recall@k / NDCG@k from 619 `retrieval-metrics.ts`; tokens, calls, latency, error rate from `cost-metrics.ts`; scorecard verdicts pass/fail/na ("na is never a pass").

## Options

| Option | Fit here | Cost to adopt | Known failure mode |
| --- | --- | --- | --- |
| Specs + git as the fact mine (recommended) | 274 dated, git-frozen folders; 74+28 labelable files; dated reversal pairs | medium — human writes each expected answer | quoting measurement docs that embed memory rows (system output) — excluded by the carve-out |
| Session-derived facts only | 2,899 transcripts, real multi-session facts | high — every fact's provenance pinned to a line | provenance drift; harness-generated sessions must be excluded (`persistSession: false`) |
| Live-DB relevance rows (rejected) | none — precedent is the 473 decay 16/20 → 9/20 (`563/test-report.md:399-416`) | low to build, decays | rows deleted by the 443 lifecycle; not independent |
| Authored-skill positives vs frozen candidate negatives (recommended, skills arm) | 26 tracked positives; 2,745 negatives; 471 rubric exists | medium — freeze manifest + 2 blind raters | 26-vs-28 count must be reconciled; candidates deletable before freezing |
| Pipeline judge scores as labels (rejected) | judge scored 7.8-8.4 on bodies the human rubric scored 1.25-2.38 (`471:76-87`) | none | circular — the system grades itself; telemetry is a behavioural proxy, not a correctness label |

## Disagreements

- **Authored-skill count**: `471/skill-quality-criteria.md:15` says "28 authored skills" (citing `metrics-authored-skills.md:38-67`) vs 26 dirs on main HEAD today (measured). Git history of `.claude/skills` decides it before freezing.
- **CLAUDE.md standing constraint**: `620/context.md:134` cites `skill-synthesis/CLAUDE.md` as current vs commit `7917b193a` (2026-09-22) removing all CLAUDE.md/AGENTS.md. The commit decides it: the citation is stale, and the benchmark must pin fact dates rather than trust carried citations.
- **Candidate quality**: pipeline judge 7.8-8.4 vs 471 human rubric 1.25-2.38 on the same ten bodies. Decided for the benchmark by role rule: the human rubric is ground truth (invocation telemetry is a behavioural proxy, not a correctness label, `620/context.md:129-131`).
- **473's 16/20 vs 563's 9/20**: not a code disagreement — the corpus decayed (10 of 20 rows deleted; `563/test-report.md:402-415`). Decides the rule: never anchor ground truth to live-DB rows.

## Local consequences

- `benchmark-design.md` (phase 2): the memory arm's fact mine is `.ptah/specs` + git at a pinned commit; the skills arm's positive set is `.claude/skills` at a pinned commit; neither needs the live DB.
- `TASK_2026_620_a13e/forensics.md` (phase 1): `context.md:134`'s citation of `skill-synthesis/CLAUDE.md` should be flagged as stale (removed `7917b193a`, 2026-09-22) if the forensics quotes it as a live constraint.
- The 619 shared infra is confirmed present on `fix/task-619-tool-benchmark` (all three commits); the bench host's HOME/USERPROFILE isolation plus the 563 snapshot hash pattern are the mandatory safety rails for the deletion/retention scenario.
- The 2,745 `~\.ptah\skills\_candidates` dirs must be frozen (copy + SHA-256) before any labelling or the 578-P1 deletion bugs can destroy the negative set mid-benchmark.

## Unknowns

- Exact fact density of the 74 decision-header files (1-3 each is an estimate): smallest experiment — pilot-label 10 files and calibrate.
- Whether every one of the 2,745 candidate dirs holds a readable `SKILL.md` (471 quotes them; some DB rows may lack disk bodies): smallest experiment — walk the frozen copy and diff against the `skill_candidates` row count.
- Whether the 13 home `~\.claude\skills` docs belong in the positive set (they are third-party hyperframes skills; 471's exemplar set is repo-only): decide at benchmark design; if included, label them blind like everything else.
- Timestamp coverage across all main-repo session JSONLs (2 samples only; the sampled operation lines carry ISO timestamps — spot-check message lines when the bench is built).
- The 26-vs-28 authored-skill reconciliation (one `git log -- .claude/skills` pass).
- mcp-bench code quality on the 619 branch was not read (only its commits were verified); its scorecard schema changes must go through the named message session first (`620/context.md:75`).

## Summary table (required)

| source | yields | category | independence from system under test | effort to label |
| --- | --- | --- | --- | --- |
| git history (3,747 commits, dated; PR merges #649-#660 in the last 12) | ~15-25 verified reversal/replacement pairs + convention migrations + PR↔task map (inferred from one capped 40-match grep) | knowledge update, contradiction, temporal | Full — human/CI authored; the memory/skill pipeline never writes commits | Low (read-only `git log`/`git show`) |
| `.ptah/specs/TASK_*` (274 folders, 1,932 md, 4,334 git-tracked files) | ~60-90 facts: 74 files with decision/rejection headers, 28 with user preference/correction phrasing; every fact dated by commit or inline header | extraction, multi-session, temporal, knowledge update | Full for task docs (they are inputs); carve out 471/473/563 measurement docs that quote memory rows | Medium (human writes each expected answer) |
| repo `.claude/skills` (26 authored dirs, 211 tracked files, last touch 2026-10-04) | 26 positive exemplars (471 rubric scores exemplars 8.5-9.8) | skills positives | Full — human-authored, git-frozen | Low (471 rubric already committed) |
| `~\.ptah\skills\_candidates` (2,745 dirs, live state outside git) | 50-100 sampled negatives/unknowns (+ 10 pre-scored anchors from 471) | skills negatives/unknowns | Correct-by-design: artifacts are system output being judged; labels are human (rubric), never the pipeline judge — but deletable until frozen | Medium (freeze manifest + 2 blind raters + κ check) |
| session transcripts `~\.claude\projects\**\*.jsonl` (2,576 main-repo; 2,899 total; mtime 2026-09-06 → 2026-10-06; + 8 ptah recovery JSONLs) | date-split seed/eval windows; cross-session facts; abstention; workspace identity embedded per line | multi-session, extraction, abstention | Full as raw input produced by real work; exclude harness-generated sessions (`persistSession: false`) | High (per-fact provenance to a line) |
| CLAUDE.md files (6 remain, all `tools/hyperframes/**`; lib-level removed `7917b193a`, 2026-09-22) | ~0 exemplars; 1 strong knowledge-update fact (the removal itself) | knowledge update | Full | Low |
| existing hand labels: `471_b3d1/skill-quality-criteria.md` (rubric + 10 scored candidates + 16 cluster suggestions), `473_c9f4/track-a-retrieval-measurement.md` (20 relevance rows + reasons), `563_2939/harness/` (snapshot/backup safety pattern + hand-judged outputs) | ready-made label instrument + 46 pre-labelled items + the DB-safety rails | both arms | Human/prior-role judgement (the pipeline judge disagrees with it by 6+ points on the same items — that gap is the point) | Low (freeze as-is; re-rate blind for stability) |
| second workspaces (`qa3elhamor` 71, `property-hub` 11, `website-manager`, `seshat`) + 32 worktrees (`git worktree list`) | two-workspace isolation and worktree-isolation scenario data | workspace isolation | Full — real roots, real sessions | Low-Medium (orchestration, not labelling) |
| live memory DB rows (rejected) | decays — precedent: 16/20 → 9/20 after the 443 lifecycle deleted rows post-2026-09-19 | n/a (excluded) | Violates the rule — system output, lifecycle-deletable | n/a |
