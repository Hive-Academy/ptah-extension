# TASK_2026_644 batch 1 — Council later rounds reuse live lanes

## Files changed

- `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/references/council.md`
- `.claude/skills/tribunal/references/council.md` (byte-identical to the packaged file)

Not changed: `apps/ptah-docs/src/content/docs/tribunal/council.md`. It describes two paid phases. It does not say later rounds respawn lanes.

Not changed: `agent-lanes/SKILL.md`.

## Before / after

### `council.md` Step 3 (cross-critique)

Before: packets are built, then "Re-spawn each panelist" with the critique prompt. Wait for `<agent-lane-completed>`.

After: Round 2+ reuses each live lane. Send the packet with `ptah_agent_message` and branch on the returned `mode` ([agent-lanes §7](../../agent-lanes/SKILL.md#7-talk-to-a-live-lane)). The lane answers with `ptah_agent_report`. If `mode` is `unsupported` or the lane has ended, resume it per [agent-lanes §5](../../agent-lanes/SKILL.md#5-recover). Respawn only when that resume is unavailable. The critique prompt and the completion-signal wait stay.

### `council.md` Guidance (extra critique round)

Before: add a second critique round for an unresolved split, and tell the user it costs another full panel of calls.

After: same cost sentence, plus "Reuse the live lanes the same way as Step 3." so the extra round does not respawn.

## Remaining `respawn` mentions

`grep` equivalent over packaged and `.claude` copies of `tribunal/` and `orchestration/` (case-insensitive). Each hit is in both trees.

| File | Line | Why it stays |
| --- | --- | --- |
| `tribunal/references/council.md` | 38 | The new fallback: respawn only when §5 resume is unavailable after `unsupported` or an ended lane. |
| `tribunal/references/crucible.md` | 135 | Shipped resume-without-respawn. Round 2+ resumes the executor (agent-lanes §5). Respawn only where it cannot be resumed. Not a per-round respawn loop. |
| `orchestration/references/checkpoints.md` | 624 | Checkpoint SR: a running agent is answered with `ptah_agent_message`. Resume or respawn only after the agent has returned, per agent-lanes. Not a per-round loop. |
| `orchestration/references/fleet.md` | 17 | A worker that was already respawned no-ops when its artifact is complete. Idempotence, not a loop that respawns each round. |

`orchestration/SKILL.md` says "re-spawn" (hyphenated) for a subagent Ptah stopped. That string is outside this grep. It is a stopped-agent handoff, not a per-round lane loop. Left as-is.

No other per-round respawn loop in tribunal or orchestration.

## cmp

`C:\Program Files\Git\usr\bin\cmp.exe -s` on every file under packaged `tribunal/` and `orchestration/` against its `.claude/skills` copy. All identical:

- tribunal: `SKILL.md`, `references/council.md`, `crucible.md`, `forge.md`, `race.md`, `relay.md`, `vendor-panel.md`
- orchestration: `SKILL.md`, `references/agent-catalog.md`, `checkpoints.md`, `fleet.md`, `git-standards.md`, `lane-assignment.md`, `strategies.md`, `task-tracking.md`, `team-leader-modes.md`

## Decisions

- Later Council rounds message the live lane first. Resume (agent-lanes §5) is the fallback when `mode` is `unsupported` or the lane has ended. A fresh respawn happens only when that resume is unavailable, with the packet in the prompt.
- The critique prompt stays the one example of the packet. The §7 mode table is linked, not copied.
- Crucible, checkpoints, and fleet already name respawn as a fallback or as idempotence. Context marks the Crucible and checkpoint messaging work as shipped. They were not rewritten.
- Docs Council was not edited.
- No commit, push, or git history command.
