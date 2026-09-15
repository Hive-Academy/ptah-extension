# Task Context - TASK_2026_440_834c

## User Request

Phase 1 of the Thoth rework (umbrella TASK_2026_439_1310). The user reported that memory "is being too
big over time and without an easy and automated way ... old unused memories get removed and proper memory
management gets applied". After the tribunal verdict, the user chose "File tasks + start phase 1".

## Task Type

FEATURE

## Complexity

Medium

## Strategy

FEATURE, Partial depth. The project-manager is skipped because `verdict.md` section A (in this folder) is
the approved requirements source. Flow: software-architect → Gate 2 → team-leader (Mode 1/2/3) → Gate 3 QA.
Branch `feat/task-440-memory-retention`, worktree
`D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention`.

## CLI Lanes

Mode: auto — delegate when it clearly helps.

| Agent | Type | Status | Capabilities |
| ----- | ---- | ------ | ------------ |
| codex | cli | installed | messaging: queue, role delivery: preamble/developer-instructions |
| copilot | cli | disabled (installed) | messaging: queue, role delivery: preamble/task-prompt |
| cursor | cli | not installed | messaging: interrupt, role delivery: preamble/task-prompt |
| antigravity | cli | installed | messaging: none, role delivery: preamble/task-prompt |
| opencode | cli | not installed | messaging: none, role delivery: preamble/task-prompt |
| pi | cli | not installed | messaging: steer, role delivery: preamble/task-prompt |
| ollama cloud | ptah-cli | available | provider: Ollama Cloud, ptahCliId: pc-85830910-3d81-4248-84c1-4fa52752dd19, messaging: queue, role delivery: preamble/system-prompt |
| claude cli | ptah-cli | available | provider: Claude (Subscription), ptahCliId: pc-effaa2c4-0d41-4e95-980a-89d3bf971b4d, messaging: queue, role delivery: preamble/system-prompt |

## Scope (from verdict.md section A — phase 1 only)

In scope:

1. A scheduled, idle/power-gated daily retention job registered in `thoth-runtime`'s cron start (both
   the Electron/VS Code path `start-thoth-cron.ts` and the CLI path `cli-engine/.../thoth-runtime.ts` if
   it registers jobs separately).
2. Purge processed `observation_queue` rows older than 7 days, in bounded batches. Reuse or replace
   `ObservationQueueStore.purgeOlderThan`; no orphan public method may remain.
3. Stuck unprocessed rows older than 14 days: record `session_id`, `kind` and the reason in a small
   bounded ledger, then delete the payload rows. Never set `processed_at` on them.
4. Reclaim pages after deletion without a boot-path full `VACUUM` (use incremental vacuum in larger idle
   steps; `auto_vacuum` mode was set by migration 0009).
5. Pre-migration backup rotation from 3 to 1 (`migration-runner.ts:99`), and bound the `reset` kind.
6. Storage numbers in memory diagnostics: DB bytes, observation rows and bytes split pending / processed /
   reclaimable, oldest pending age, last and next retention run and its result.
7. Reachability proof: a spec that fails if the retention job is not registered at cron start, and an
   integration spec with a fake clock that proves rows actually leave the table.

Out of scope (later phases): the memory age lifecycle and salience change (phase 2), skills (3, 5), UI
feed and Overview (4, 6). The first run on the user's 1.28 GB DB must stay bounded and must not block
boot.

## Conversation Summary

- Tribunal: Council, 2 rounds, codex / antigravity / Ollama Cloud. Retention of 7 days was unanimous.
  Stuck rows: quarantine the metadata and delete the payload, never mark them processed. No full VACUUM in a
  startup migration (boot stalls were removed in TASK_2026_380/383).
- The user already deleted two older pre-migration snapshots manually (about 2 GB).
