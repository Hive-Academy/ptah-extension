# Issue 1 notes

## Root cause

`agent-process-manager.service.ts:1621-1661` restores a persisted `running` reference as `stopped`; previously it gave no reason or completion time. `agent-events.ts:468-483` skips output persistence while a lane is running, so restored output can be empty. `agent-process-manager.service.ts:642-668` supplied `completedAt ?? startedAt` to the resume gate; without a completion time it used the start time. `lane-resume-gate.ts:247-266` starts fresh when that time is over 600 seconds old. The inactivity watchdog records `timeout` (`agent-process-manager.service.ts:2729-2763`), so it does not explain this restored `stopped` state. A host restart is consistent with the incident, but no incident log proves it occurred.

## Log evidence

`%APPDATA%` is unset in this shell. The user profile contains `C:\Users\abdal\.ptah`; a quick log-name search found archived build/CI logs, but no applicable Electron host lifecycle log. Incident cause remains inferred from code and the reported state.

## Changes

- `libs/shared/src/lib/types/agent-process.types.ts`: add `host-restart` stop reason and persistable reference field.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`: stamp restored running records with reason and completion time; pass an explicit interruption flag into the resume gate.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-resume-gate.ts`: bypass only the idle limit for marked interruptions; retain the context limit.
- `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts`: include stop reason when writing a CLI session reference.
- `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-header.component.ts`: render a human interruption label.
- Corresponding restore, manager, gate, and card specs: pin the marker, timestamps, gate input, idle boundary, and label.

## Decisions

- **Reason representation:** extend the existing `LaneStopReason` with `host-restart` instead of adding another timestamp field. Evidence: status and card already consume `stopReason`; `completedAt` supplies the interruption time. Reversible: yes.
- **Resume policy:** a marked interruption with the matching CLI session ID bypasses the 600-second idle rule with no additional age cap; the context-size rule still applies. Alternatives: preserve 600 seconds or impose 24 hours. Evidence: the old start timestamp and even a delayed restore can exceed 600 seconds despite a valid CLI session. An explicit marker prevents ordinary stopped/completed lanes from bypassing the rule. Reversible: yes.
- **Output snapshots:** defer periodic persistence. Alternative: throttled tail snapshots. Evidence: persistence currently avoids writes for running lanes; a snapshot requires a new timer/write policy and recovery semantics. Reversible: yes.

## Output persistence trade-off

Periodic tail snapshots would preserve some live text across a host restart, but add disk writes for every active lane, persistence cost, and possibly stale text at crash time. A safe implementation needs bounded size, throttling, and lifecycle cleanup. This patch keeps the existing event-driven persistence and records output snapshots as follow-up work.

## Verify results

- `npm run verify -- -p cli-agent-runtime,shared,chat -t lint,typecheck` — PASS: 6 tasks succeeded (4 cached) after correcting a misplaced declaration found by the initial full verify run.
- `npm run verify -- -p cli-agent-runtime -t test -- --testPathPatterns=lane-resume-gate.spec.ts --coverage=false --maxWorkers=2` — PASS: focused resume-gate suite.
- `npm run verify -- -p cli-agent-runtime -t test -- '--testPathPatterns=agent-process-manager.(restore|service).spec.ts' --coverage=false --maxWorkers=2` — BLOCKED: both suites fail before tests run because the worktree Jest mapper points `marked` to absent `node_modules/marked/lib/marked.umd.js`.
- `npm run verify -- -p cli-agent-runtime,shared,chat` — FAIL: initial typecheck error corrected; full test phase had widespread `marked` mapping failures (and unrelated MCP install failures).
- `ptah_get_diagnostics` — unavailable: TypeScript check exceeded the tool's 45-second deadline; scoped verify typecheck passed instead.

## Open questions

- Was this incident actually preceded by a host restart/reload? Applicable host logs were unavailable.
- Should running-output snapshots be added in a separate change after measuring disk cost and desired recovery quality?
