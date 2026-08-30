# TASK_2026_357 — Checkpointed fleet workflow

## Background

The 2026-08-28 log-audit fleet (TASK_2026_341..354) ran as a Claude Code
Workflow. Two host crashes showed the failure mode: Workflow resume replays
the longest unchanged PREFIX of agent() calls, and parallel() starts calls in
non-deterministic order, so each resume re-ran finished batch-1 implementers
(three generations, task statuses flipped back to in_progress) and never
reached batch 2. Recovery required abandoning the workflow and driving direct
agents.

Second hazard found: the pre-commit hook (lint-staged) stashes and restores
the working tree; a commit made while an implementer edits files silently
reverts those edits. Third: commitlint rejects subjects > 72 chars, body
lines > 100 chars, and scopes outside the enum in commitlint config.

## Design constraint

Workflow scripts run sandboxed: no fs, no Node APIs, no Date.now. A script
cannot read checkpoints from disk. Therefore:

- The CALLER computes checkpoint state from disk before invoking the
  workflow and passes it as `args` (per task: id, title, area, stage,
  judgeRound).
- Each AGENT persists its artifact before returning (context.md, code +
  task.md status line, judge-round-N.json), and no-ops if the artifact
  already exists — agents have file tools even though the script does not.
- Resume = re-invoke the workflow with freshly computed args. Never rely on
  resumeFromRunId / journal replay.

## Deliverables

1. `.claude/workflows/fleet-fix.js` — parameterized fleet script (codex lane).
2. `.claude/skills/fleet-orchestration/SKILL.md` — operating rules skill
   (ollama-cloud lane).
3. This context.md records the design; the skill records the harness-side
   limitation so nobody relies on journal resume again.

## Acceptance criteria

1. fleet-fix.js parses as a valid workflow script: `export const meta`
   pure literal (name, description, phases), plain JS, no fs/Date/Math.random,
   uses only agent/parallel/pipeline/phase/log/args/budget.
2. Stages are skipped from `args` state: stage 'plan' skipped when
   hasContext; 'implement' skipped when status is in_review/done; judge round
   N skipped when judgeRounds >= N. Every agent() call has a stable label
   `<stage>:<taskId>` and a phase.
3. Agent prompts instruct artifact-first: write the artifact, then return;
   and no-op when the artifact already exists.
4. Judge loop: max 2 rounds, verdict JSON written to
   `.ptah/specs/<id>/judge-round-<n>.json` with {taskId, round, pass,
   defects[], testsRan, mentorNote}; revise stage consumes defects.
5. Batching: tasks carry an `area` string; the script runs tasks with the
   same area sequentially and different areas in parallel (disjoint-lib rule).
6. The script never calls git commit and says so; committing is the
   orchestrator's job in a no-implementer-editing window.
7. Skill passes `npm run validate-skill` (pre-commit hook runs it) and
   documents: prefix-cache limitation, args-checkpoint pattern, disjoint-lib
   batching, commit-window rule (lint-staged stash), commitlint constraints
   (<=72 subject, <=100 body lines, scope enum from the config), judge
   protocol + verdict schema, run-many-not-positional nx test rule.
8. `npx nx run-many -t lint -p` on any touched project stays at 0 errors;
   nothing outside `.claude/workflows/`, `.claude/skills/fleet-orchestration/`
   and this spec folder changes.

## Lanes

- codex (installed CLI) — fleet-fix.js.
- ollama cloud (ptah-cli lane) — SKILL.md.
- Orchestrator (this session) — judge both against the criteria, iterate via
  resume, commit at the end.

## SKILL.md implementation notes

Created `.claude/skills/fleet-orchestration/SKILL.md`. Frontmatter copies the
orchestration skill style: a YAML block with `name` and `description`. The
description lists the trigger phrases: fleet, multi-agent fix, judge loop,
resume workflow. The body has nine sections in the required order: WHEN TO
USE, HARNESS LIMITATION, ARTIFACT CHECKPOINTS, DISJOINT-LIB BATCHING, COMMIT
WINDOW, COMMITLINT GATES, NX TEST RULE, JUDGE PROTOCOL, CLI AGENT LANES. Each
section has a short worked example and stays under ~15 lines. The file is
under 250 lines, ASCII only (no smart quotes, no em dashes), and uses plain
imperative sentences per the STE output style.

## fleet-fix.js implementation notes

Created `.claude/workflows/fleet-fix.js` as a plain-JavaScript, artifact-first
workflow. Caller checkpoints control stage skipping and judge-round resume;
same-area tasks run sequentially while disjoint areas run behind `parallel()`.
Agents persist plan, implementation, revision, and verdict artifacts before
returning, never commit, and re-read files immediately before edits.
