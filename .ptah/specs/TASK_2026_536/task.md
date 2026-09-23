---
status: planned
type: feature
title: 'Lane trajectories: run skill-synthesis archaeology and judging on CLI lane sessions'
depends_on: [TASK_2026_535]
blocks: [TASK_2026_537]
---

# TASK_2026_536 — Judge lanes from their session trajectories

## Why

We already own a trajectory + judging pipeline, but it only sees Claude SDK
sessions. Lanes are where most delegated work now happens, and we have no
evidence of how each lane / model / role actually behaves. Pointing the existing
pipeline at lane sessions gives (a) lane scorecards for routing and (b) labeled
data to train our own local classifiers (TASK_2026_537) — data that never leaves
the user's machine.

## What exists (reuse, do not duplicate)

- Trajectory: `ExtractedTrajectory`
  (`libs/backend/skill-synthesis/src/lib/trajectory-extractor.ts:76-106`); reads
  Claude JSONL only (`:147-167`), including subagent transcripts via `transcriptPath`.
- Session verdicts: `SessionArchaeologistService.analyze`
  (`archaeology/session-archaeologist.service.ts:324`) → `skill_session_verdicts`
  (migration `0034`: intent, outcome, evidence_class, friction_map, …).
- Judges: `SkillJudgeService` (`skill-judge.service.ts:157`), `JudgePanelService`
  (`gates/judge-panel.service.ts:231`); lane plumbing `LaneRunnerService` /
  `LaneResolverService` (`lanes/lane-runner.service.ts:241`, `lane-resolver.service.ts:192`).
- Entry: `SkillSynthesisService.enqueueAnalyze(sessionId, ws, {transcriptPath, source})`
  (`skill-synthesis.service.ts:498`), RPC `skillSynthesis:analyzeNow`.
- Memory: `MemoryCuratorService.curate` accepts a raw `transcript`
  (`memory-curator.service.ts:116-130, 304`); `ITranscriptReader` port
  (`memory-contracts/src/lib/transcript-reader.port.ts:15`).
- Parent → lanes link: `ptah.sessionMetadata[parent].cliSessions` and, after
  TASK_2026_535, the `lane_runs` table.

## Scope

1. **`ILaneTranscriptReader` port** (one adapter per lane family) that returns a
   normalized transcript for a `lane_runs` row:
   - ptah-cli lanes: Claude JSONL via `sdk_session_id` (already readable).
   - system CLIs: the CLI's own session log located by `cli_session_id`
     (e.g. Codex session JSONL under its home dir; OpenCode's local store); fall
     back to Ptah's captured output `ptah.agentOutput:<agentId>` (capped, see
     `session-metadata-store.ts:104-153`) and mark the transcript `partial`.
   - Read-only, local files only; never upload. Missing/unknown format → NULL
     verdict, not a guess.
2. **Trajectory extraction for lanes**: generalize the extractor input to the
   normalized transcript; keep Claude JSONL path byte-for-byte compatible
   (existing hashes must not change).
3. **Lane verdicts**: run the archaeologist on lane transcripts with lane context
   (task, declared deliverables, verdict, reports, review defects from the parent's
   task folder when present). New table `lane_run_verdicts` keyed by agent_id:
   outcome, evidence_class, friction_map, tool-call count, request count, context
   growth, instruction adherence (scope respected, deliverable written, no git
   history changes), revise_rounds, cost estimate. `NULL` = unjudged.
4. **Triggers**: on lane completion (queue, off the hot path) + manual RPC
   `lanes:analyzeRun` + boot backfill for recent runs. Respect the existing
   synthesis queue, budgets and judge-lane provider settings.
5. **Scorecards**: RPC `lanes:scorecards` aggregating by cli × model × role ×
   task type (task type from the parent task folder's `task.md` frontmatter):
   delivered rate, revise rounds, defect density, mean duration/requests.
6. **Dataset export for classifiers**: `lanes:exportDataset` writes a local JSONL
   of (task text excerpt, task.md type/flags, lane, model, outcome labels) plus the
   `.ptah/specs/**/task.md` history as intake examples. Consumed by TASK_2026_537.

## Out of scope
Routing decisions (TASK_2026_537); any cloud upload; UI beyond a minimal
scorecard table (separate design task with Gate 1.7).

## Acceptance
- A completed codex lane and a completed ptah-cli lane each get a
  `lane_run_verdicts` row from their real transcripts; an unreadable one gets NULL
  with a reason.
- Existing skill-synthesis specs and trajectory hashes unchanged.
- Scorecard RPC returns per-lane aggregates over a seeded fixture set.

## Process
Full orchestration; researcher phase first to document each CLI's transcript
location/format on this machine (cite paths), since that is the main unknown.
