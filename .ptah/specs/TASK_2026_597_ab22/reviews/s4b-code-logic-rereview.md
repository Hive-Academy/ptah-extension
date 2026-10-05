# Code Logic Re-review — `TASK_2026_597_ab22` (S4-b fix round)

Scope: `git diff da77ce130..73f882d8c -- . ':!.ptah'` (28 files, the fix commit `73f882d8c`). I checked only the targeted findings and any new defect the fixes introduced. Code the fixes did not touch was not re-reviewed.

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Minor issues (new)  | 3        |
| Failure modes found | 0 new    |

Verification: the targeted specs pass. In agent-sdk, `jest no-activity-watchdog session-query-executor.service` ran 3 suites with 62 tests, all passing. In cli-agent-runtime, `jest lane-budget-guard agent-process-manager.guard` ran 2 suites with 21 tests, all passing.

## Per-finding resolution

| Finding | Status | Evidence |
| --- | --- | --- |
| Logic A S1: apply the dwell cap only to coordinator-controlled sessions | RESOLVED | `no-activity-watchdog.ts:219-226`: `compactionDwellRemainingMs()` returns null unless `enforceCompactionDwell()` is true. `session-query-executor.service.ts:263-268`: `controlsSession()` is true only for a known, non-`OBSERVE_ONLY` state. It is wired at `:371`. |
| Logic A S1: the dwell timeout gets its own error text | RESOLVED | `no-activity-watchdog.ts:282` passes the cause (`'compaction-dwell'` or `'no-activity'`). `session-query-executor.service.ts:541-547` (log) and `:570-577` (abort reason) branch on that cause. |
| Logic A S1: an observe-only session keeps the no-timeout behaviour | RESOLVED | `no-activity-watchdog.ts:265`: `'compaction'` is added to the overdue operations whenever a compaction is open, independent of enforcement. With `remainingMs === null`, `dwellExceeded` is false. The callback then reports the session overdue and re-arms at `timeoutMs` (`:270-279`). It never fires `onTimeout`. |
| Logic A S1: removing the try/catch around `getState` is safe | CONFIRMED | `compaction-coordinator.ts:116-118` is only `this.sessions.get(sessionId)?.state` on a private `Map` (`:81`). It does not throw. The tap re-binds its id on every new session id (`session-query-executor.service.ts:303-305`), so a coordinator rekey (`compaction-coordinator.ts:218-222`) does not leave the dwell check reading a stale id. |
| Logic B S1: steer the guard only through `handle.steer` | RESOLVED | `agent-process-manager.service.ts:889-912`: the steer no longer goes through `sendToAgent`, so it cannot queue a turn or interrupt and resume. `steer` is synchronous `(message) => void` (`cli-adapter.interface.ts:128`), so the try/catch covers it. A missing `steer` is logged and the stop threshold still applies. |
| Logic B S2: `reset()` on caller-sent turns | RESOLVED | `agent-process-manager.service.ts:1646` resets the guard in `continueConversation`. `lane-budget-guard.ts:104-109`: `reset()` leaves a guard that has stopped in the stopped state. A lane stopped by the budget guard cannot be continued anyway: the stop path sets `subprocessReleased` (`:1739`/`:1990`), and `continueConversation` throws `released` (`:1604`). |
| Logic B M1: leave file-edit tools out of the repeat check | RESOLVED | `lane-budget-guard.ts:25-32` and `:81-88`. The Codex `file_change` names come from `fileChangeToolName` (`codex-cli.adapter.ts:245-247`): `Write`/`Delete`/`Edit`. The lower-cased match also covers OpenCode's `edit`/`write`. File edits still count toward the budget. |
| Logic B M2: `agent_wait` and the status formatter read `stopReason` | RESOLVED | `agent-wait.tool.ts:243-250` and `mcp-response-formatter.ts:1879-1881`. The record is stamped before `stop` (`agent-process-manager.service.ts:935`). |
| Logic B M4: warn on fallback to defaults | RESOLVED | `agent-spawn-environment.service.ts:215-234`. An absent key resolves to the default, which is valid, so absence does not warn. See Minor N1. |
| Style S1: `stopReason` type collapsed to `string` | RESOLVED | `agent-process.types.ts:171,180`: `LaneStopReason` is a closed union. `lane-budget-guard.ts:22` and the manager (`:37`) use it. |
| Style S2: compaction defaults written in three places | RESOLVED | `compaction-config-provider.ts:145-148` reads `FILE_BASED_SETTINGS_DEFAULTS[key]`. All four keys exist (`file-settings-keys.ts:523-527`). agent-sdk already imports platform-core values at runtime, for example `PLATFORM_TOKENS` in `sdk-agent-adapter.ts:5`. See Minor N2. |
| Style M1: `LaneModelBlockedError` not exported from the barrel | RESOLVED | `cli-agents/index.ts:13`. |
| Style M2: the barrel reaches into a sub-path | RESOLVED | `helpers/index.ts:58-63` re-exports from `compaction/subagent-budget-monitor`. `src/index.ts:215` now imports from `./lib/helpers`. The fix did not add `compaction/index.ts`, which the review suggested as an option; the sub-path leak is gone either way. |
| Logic A M3: the spool writes a `*` `.gitignore`, fail-open | RESOLVED | `spool.ts:146,175-185`. It creates the file exclusively (`wx`), so an existing file is left alone, and every error is swallowed, so the spool itself still proceeds. The directory is the dedicated `.ptah/tmp/mcp-out`, so `*` cannot hide user files. Pruning matches only `SPOOL_FILE_NAME` (`:206`), so `.gitignore` is never pruned. See Minor N3. |
| Visual S1: focus-visible outline on the banner primary buttons | RESOLVED | `session-budget-banner.component.ts:76` and `:113`: both primary buttons have `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content`. |

## New issues introduced by the fixes

All three are Minor. None blocks approval.

- **N1 (Minor). The fallback warn logs the defaults, not the rejected values.** At `agent-spawn-environment.service.ts:220-222,230`, the warn payload carries `d.steerAt`/`d.stopAt`/`d.repeatAt`, but not the invalid `steer`/`stop`/`repeat` that triggered it. A user reading the log cannot see which value was wrong. It also fires on every spawn (`agent-process-manager.service.ts:781`), which is noise only.
- **N2 (Minor). The defaults lookup is not type-checked.** At `compaction-config-provider.ts:148`, `FILE_BASED_SETTINGS_DEFAULTS` is a `Record<string, unknown>` (`file-settings-keys.ts:493`), and the result is cast with `as number`. If a key is misspelled or later removed from platform-core, `readBudget` silently returns `undefined` as a number. Today all four keys are present. An `isSafeInteger` check or a spec pinning the four keys would close this.
- **N3 (Minor). The gitignore catch says "reported" but reports nothing.** At `spool.ts:181-184`, the comment says `degradation-audit: reported`, but non-`EEXIST` failures (`EACCES`, `EROFS`) are dropped without any log. Spooled output then sits unignored with no signal. Fail-open was the requirement, so this is observability only.

Also noted, not a defect: because file-edit calls are now excluded from the repeat check, a lane rewriting one file in a loop is caught only by the tool-call budget stop. The fix accepted this trade-off explicitly (`lane-budget-guard.ts:12-14`).

## Five logic questions (scoped to the fix diff)

1. **Silent failure.** Only N3: a failed `.gitignore` write is invisible. The dwell path now names its own cause, so a dwell abort no longer looks like provider silence.
2. **Unexpected behaviour from a user action.** A lane on a CLI without `steer` (Codex, Cursor, Copilot, OpenCode) never receives the budget steer. It runs to the stop threshold with one warn line. This is the intended result of the S1 fix, not a regression.
3. **Input that gives a wrong answer.** An invalid lane-guard setting falls back correctly, but the log does not name the bad value (N1). A misspelled defaults key would yield `undefined` (N2, latent).
4. **A dependency fails.** The coordinator is absent or released, or the session is unknown: `controlsSession()` returns false (`session-query-executor.service.ts:265-266`), which leaves the session in the observe-only, never-cut mode. This fails safe. A spool `.gitignore` write failure is fail-open by design.
5. **Missing beyond the requirements.** The rejected values in the warn (N1), and a log line for an unexpected gitignore error (N3).

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: an invalid lane-guard setting is warned about without the offending value (N1), which slows diagnosis but never changes behaviour.
- What a robust implementation would add: include the rejected values in the fallback warn; type-guard the `FILE_BASED_SETTINGS_DEFAULTS` lookup; log non-`EEXIST` gitignore failures at debug level.
