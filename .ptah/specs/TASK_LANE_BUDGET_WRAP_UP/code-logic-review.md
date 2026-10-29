# Code Logic Review — `TASK_LANE_BUDGET_WRAP_UP`

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 7/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 1              |
| Moderate issues     | 4              |
| Failure modes found | 5              |

Scope: whole `git diff` read for the cli-agent-runtime, shared types, settings keys, RPC handlers, frontend cards, skills. No tests run (per instruction). Residual uncertainty: the omitted middle of the handlers/UI diffs was skimmed, not line-by-line; `grep` shows no `laneToolCall*` / `tool-call-budget` left outside two negative-assertion specs.

## Five logic questions

1. Silent failure. A host-stopped lane that has a skeleton deliverable (D5 tells lanes to write one early) is now judged `delivered` (`lane-completion-notifier.service.ts` verdictOf, `hostStopped` branch). The verdict is success-looking for a lane that was cut off mid-loop. The envelope only adds the "Stopped by Ptah" line (`lane-completion-envelope.ts` hostStopLine); `nextAction` still says only "read the deliverable files" for `delivered`.
2. Unexpected user action. Caller `stop` on a lane after the guard has stamped `stopReason` but before `stop()` runs cannot interleave (stamp and `stop` are in the same sync segment), so caller vs host is distinguished correctly. A caller stop later gives `failed` (no stopReason) as intended.
3. Wrong answer from data. `delivered` for a looping lane whose file is only headings (above). Also `repeatedCalls` appears in the envelope only when `info.stopReason` is set, fine.
4. Dependency failure. `stopLaneForGuard` swallows a failed `stop()` with an error log only (`agent-process-manager.service.ts` ~1385); unchanged behaviour, not a regression.
5. Missing. No unit test that a persisted old `laneToolCall*` key in the settings file is ignored end to end (only `agent-spawn-environment.service.spec.ts:144` covers the resolver). Old keys stay inert in the file; harmless.

## Failure modes

### Host stop judged delivered on skeleton output
- Trigger: loop stop on a lane that wrote its skeleton file first.
- Symptom: `verdict="delivered"` though the work is unfinished.
- Evidence: `lane-completion-notifier.service.ts` verdictOf (`hostStopped` branch); `.claude/skills/agent-lanes/SKILL.md:136` admits a skeleton "still counts".
- Current handling: stop line only.
- Recommendation: for a host stop, never return `delivered`; use `unverified` (or keep deliverable check but cap at `unverified`) and make `nextAction` mention the stop. Matches D3 wording "judged by deliverables" only loosely, so this is a design call; flag to owner.

### Queued-message drop on non-guard release not reported
- Trigger: `releaseSubprocess` path calls `discardPending` and ignores the returned count (`agent-process-manager.service.ts` ~2570). Signal was already sent by then, so no data lost on the guard path; only a logging asymmetry. Moderate.

### Stale per-record counters on continuation
- Trigger: `tracked.queuedMessagesDropped`, `tracked.repeatedCalls`, `tracked.guardToolCalls` are never cleared in `continueConversation` (~2218-2223). A guard stop makes the lane `stopped`, which `continueConversation` should not accept, so likely unreachable; if a restart path ever re-runs a stopped record, the next envelope carries old values. `info.stopReason` is likewise not cleared there.
- Recommendation: clear all four when the status is reset to running.

### `toolCalls` absent for lanes with no segment stream
- `guard` is created only when `sdkHandle.onSegment` exists (~1216), and restored agents have none, so `toolCalls` is omitted. Consistent with "when the host counted them" in the type doc; acceptable, but D3 says "count at exit" without qualification.

### Envelope wording hard-codes repeat-call
- `hostStopLine` always says "repeated the same call" for any `stopReason`; correct today (single reason), will mislead if a reason is added. Minor.

## Blocking issues

None.

## Serious issues

### Host-stop verdict can say `delivered` for cut-off work
See failure mode 1. File: `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts` (verdictOf). Fix: cap host-stop at `unverified`, or add a "stopped before finishing, verify completeness" line to `nextAction`.

## Moderate and minor issues

- Guard release ordering is correct on all verified paths: `stop` (~2322) releases then `signalLaneCompletion`; timeout/inactivity (~2564, 2679) release before signal; `handleExit` keeps the guard for continuation-capable lanes and `signalLaneCompletion` (~2987) reads the live count first, falling back to `guardToolCalls`. OK.
- `repeatedCalls` / `queuedMessagesDropped` / `stopReason` are populated for the guard stop path before `stop()` (~1373-1380). OK.
- Verdict change: `status === 'stopped' && stopReason !== undefined` correctly separates host from caller stop. OK.
- Stale persisted `stopReason: 'tool-call-budget'` in old stored lane records: the frontend `laneGuardStopText` now returns null for it (no label, no crash); typed as `'repeat-call'` only, so a runtime-only legacy value is untyped. Minor; acceptable.
- `RESUME_GATE_MAX_CONTEXT_TOKENS` 150k and its comment correct; the doc comment in `continueConversation` was reworded awkwardly ("context-size rule" mid-sentence), cosmetic.
- Two skill copies: `.claude/skills/agent-lanes/SKILL.md` and `lane-assignment.md` are byte-identical to their `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/...` copies (verified with `diff`).
- Dead code: no `steerLane`, no steer/stop thresholds, no `tool-call-budget` left. `LaneBudgetThresholds` correctly reduced to `repeatAt`.
- Settings migration: removed keys are dropped from `FILE_BASED_SETTINGS_KEYS`, defaults and export list; old values in an existing settings file are simply never read. RPC `agent:setConfig` no longer accepts them; a stale client sending them gets them ignored (not validated). Fine.

## Data flow

1. Guard counts segments (`LaneBudgetGuard`): OK.
2. Repeat threshold -> `stopLaneForGuard` stamps stopReason, repeatedCalls, drops queue count: OK.
3. `stop()` -> status `stopped` -> `releaseLaneGuard` saves count -> `signalLaneCompletion`: OK.
4. Notifier verdict + envelope: gap = delivered-on-skeleton.
5. Frontend card text via `laneGuardStopText`: OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Remove tool-call budget settings everywhere | COMPLETE | none found |
| stopReason/toolCalls/dropped on signal | COMPLETE | stale counters on re-run; absent for non-streaming lanes |
| Host stop judged by deliverables | COMPLETE | skeleton false-positive |
| Resume gate 150k | COMPLETE | |
| Skill text matches runtime, copies identical | COMPLETE | |
| Subagent budget and Codex adapter unchanged | COMPLETE (diff touches neither) | |

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Caller stop vs host stop | YES | stopReason presence | none |
| Queue non-empty at host stop | YES | count in envelope | none |
| Restored agent | PARTIAL | no guard, no toolCalls | omitted silently |
| Old persisted settings keys | YES | ignored | none |
| Old persisted stopReason value | YES | no label | untyped |

## Verdict

- Recommendation: REVISE (minor)
- Confidence: MEDIUM
- Top risk: a host-stopped looping lane with only a skeleton deliverable is reported `delivered`.
- Robust implementation would add: cap host-stop verdict at `unverified`; clear `guardToolCalls`/`repeatedCalls`/`queuedMessagesDropped`/`stopReason` when a record returns to running; a test for the skeleton plus host-stop case.
