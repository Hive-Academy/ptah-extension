# Tribunal brief — Thoth: memory lifecycle, skill synthesis, and UI

Repository root for this review: `D:\projects\ptah-extension\.claude-worktrees\skill-corpus-tasks` (== origin/main 6349f03ac).
Read-only review. Do not modify, create (except your deliverable), commit or push anything.

## User's complaints (verbatim intent)

1. **Memory grows forever.** "Memory is being too big over time" and there is no easy, automated way for old,
   unused memories to be removed. A proper memory-management lifecycle was promised and does not exist in practice.
2. **Skills.** The pipeline does "huge investigation and recording" but produces poor, session-based output, and
   the user cannot tell whether it works at all.
3. **Thoth UI** (Memory / Skills / Cron / Gateway tabs) is "completely unusable" — the user does not know how to get
   value from it. The **activity log** looks broken or renders repeated components in a bad layout.

## Ground truth measured from the user's live DB (`~/.ptah/state/ptah.sqlite`, 2026-09-14, read-only)

### Storage
- Live DB file: **1.28 GB**. Plus 3 `ptah.pre-migration-*.sqlite` copies (1.0 / 1.0 / 1.18 GB) and 7 dev backups left in
  `~/.ptah/state` — ~3.2 GB of never-cleaned migration snapshots.
- `observation_queue` table: **1,021 MB (~80% of the DB)**, 205,828 rows. **200,725 are already processed**
  (`processed_at IS NOT NULL`), oldest from 2026-06-01; processed `tool_response_text` alone = 756 MB. 5,106 unprocessed,
  oldest 2026-07-28 (stuck ≥ 7 weeks). Kinds: tool-use 156k, file-read 38k, tool-failure 2.7k, user-prompt 4.5k, assistant-turn 4.2k.
- Next largest: memory_chunks vec 54 MB, memories 35 MB, code_symbols vec 25 MB, memory_chunks 14 MB.

### Memories (`memories`, 33,415 rows, 785 sessions, 11 workspaces, since 2026-06-05)
- Tier: 33,413 `recall`, 2 `core` (pinned), **0 `archival`**. `expires_at` set on **0** rows.
- **29,317 (88%) never used** (`last_used_at = created_at`); zero-hit share per type ≈ 87–91%.
- Salience distribution: min ≈ 0.6, bulk 1.1–1.4. `memory-decay.job.ts` only demotes recall→archival
  "when salience < 0.1 AND age(last_used) > halflife" — a threshold the stored salience never reaches, and it never deletes.
- Growth: Jun 14,151 · Jul 8,450 · Aug 4,748 · Sep (14 days) 6,066.
- `scheduled_jobs` holds: daily backup, skills drain (15-min / nightly / weekly), db integrity check. **No memory decay / retention / vacuum job.**

### Skill synthesis
- `skill_candidates`: **2,426 `candidate`, 6 `rejected`, 0 `promoted`** — ever. Judge scored only 105 (scores spread 1–8).
- Candidate names/descriptions are slugified **first user prompts**, e.g. `do-you-have-access-to-the-hubspot-mcp-2`,
  `tribunal-p3-you-are-one-of-three-independent-expert-panelist-4`, `based-on-this-attached-abdelrahaman-resume-...`
  (non-code sessions from other workspaces included; `-2`/`-4` suffixes = duplicates).
- `skill_invocations`: 2,432 rows, **one per candidate, 2,432/2,432 `succeeded=1`** — looks like a synthetic row written at creation, not real usage.
- `skill_synthesis_queue`: done — archaeology 136, prefilter 238, judge-panel 105, trigger-eval 95, embedding 19;
  **queued backlog** — prefilter 423, judge-panel 133, trigger-eval 135, archaeology 102 (oldest queued 2026-08-28);
  skipped 88 "no candidate from this session"; 8 "trigger-eval-prompt-lane-failed".
- `skill_session_verdicts` (136): 56 have null outcome and are `degraded`; nearly all others `evidence_class = unverified`;
  `routine` populated on ~0 rows.
- `skill_registry` 47 rows; `skill_suggestions` 17.

## Code map (start here; follow imports as needed)
- Memory backend: `libs/backend/memory-curator/src/lib/` — `memory-decay.job.ts`, `salience-scorer.ts`, `memory.store.ts`,
  `observation-queue.store.ts`, `memory-writer.adapter.ts`, `triggers/memory-trigger.service.ts`, `triggers/episode-tracker.ts`,
  `curator-llm/*`, `diagnostics.service.ts`.
- Persistence / migrations / backup: `libs/backend/persistence-sqlite/`, `libs/backend/cron-scheduler/`.
- Skills backend: `libs/backend/skill-synthesis/src/lib/` — `skill-synthesis.service.ts`, `queue/skill-drain.service.ts`,
  `queue/stage-handlers.service.ts`, `trajectory-extractor.ts`, `archaeology/session-archaeologist.service.ts`,
  `skill-synthesizer.service.ts`, `naming/candidate-namer.service.ts`, `gates/*` (judge panel, replay, trigger eval),
  `skill-promotion.service.ts`, `skill-invocation-recorder.ts`, `skill-clustering.service.ts`, `skill-cluster-dedup.service.ts`,
  `triggers/skill-trigger.service.ts`.
- UI: `libs/frontend/thoth-shell/`, `libs/frontend/memory-curator-ui/` (incl. `components/diagnostics/event-feed.component.ts`,
  `timeline-view.component.ts`, `memory-curator-tab.component.ts`), `libs/frontend/skill-synthesis-ui/`,
  `libs/frontend/cron-scheduler-ui/`, `libs/frontend/messaging-gateway-ui/`. Find the "activity log" surface yourself
  (search templates for activity / event feed / timeline).
- Per-lib `CLAUDE.md` files describe intended design; compare intent vs code vs the data above.
