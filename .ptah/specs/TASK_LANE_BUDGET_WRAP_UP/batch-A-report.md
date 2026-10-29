# Batch A report — budget defaults and settings

## Files changed

Paths relative to the worktree root.

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-budget-guard.ts`: adds `LANE_BUDGET_DEFAULTS`,
  `laneBudgetDefaultsFor(taskKind?)`, `LANE_WRAP_UP_MAX_TOOL_CALLS = 5`,
  `LANE_WRAP_UP_THRESHOLDS` ({6, 6, 3}), `laneBudgetSteerMessage(toolCalls, stopAt)` and a
  `LaneBudgetGuard.thresholds` getter. The header comment is updated.
- `.../cli-agents/lane-budget-guard.spec.ts`: adds the per-kind table, the default row, a row
  for every `OUTCOME_TASK_KINDS` entry, the wrap-up case (5 calls pass, the 6th stops, no
  steer), the new steer text and the getter.
- `.../cli-agents/agent-spawn-environment.service.ts`: deletes `DEFAULT_LANE_GUARD_THRESHOLDS`.
  `resolveLaneGuardThresholds(taskKind?)` reads each key with no default. `null`/`undefined`
  means unset, and an unset key derives from the other one (D1).
- `.../cli-agents/agent-spawn-environment.service.spec.ts`: tests the per-kind defaults, the
  null-as-unset rule, saved values applying to every kind, the derivation each way, the
  smallest pairs, and an invalid value falling back to the kind default with one warning.
  `agent-spawn-environment.settings-routing.spec.ts` does not use the lane-guard keys, so it
  is unchanged.
- `libs/backend/platform-core/src/file-settings-keys.ts` (+ `.spec.ts`): the three keys now
  default to `null`, with a comment that points at `laneBudgetDefaultsFor`.
- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`:
  - `LANE_GUARD_DEFAULTS` is deleted.
  - `getLaneGuard` returns `number | undefined`. It returns `undefined` when the key is
    unset or holds an invalid hand-edited value, so get-config leaves it out.
  - `invalidLaneGuard` checks the pair only when both effective values are known.
  - `laneGuardWriteOrder` writes stop first when the stored steer is unset.
- `.../agent-rpc.handlers.set-config.spec.ts`, `.../agent-rpc.handlers.spec.ts`: specs updated
  as above. The pin against `FILE_BASED_SETTINGS_DEFAULTS` now expects `null`.
- `libs/frontend/chat/src/lib/settings/ptah-ai/lane-guards-settings.logic.ts`:
  `LANE_GUARD_DEFAULTS` is now 100/140/20 (the display value for an unset key), and a new
  `LANE_GUARD_UNSET_HELP` text is added.
- `.../lane-guards-settings.component.ts`: shows the unset-help line under the section intro
  (`data-testid="lane-guards-unset-help"`).
- `.../lane-guards-settings.logic.spec.ts`, `.../lane-guards-settings.component.spec.ts`:
  updated, plus a test for an unset config.

Prettier also reformatted a few lines that were already unformatted in
`agent-rpc.handlers.spec.ts` and in the component template. These are whitespace changes only,
and lint-staged would make them on commit anyway.

## Defaults implemented (`LANE_BUDGET_DEFAULTS`)

| taskKind  | steerAt | stopAt | repeatAt |
| --------- | ------- | ------ | -------- |
| plan      | 80      | 120    | 20       |
| implement | 120     | 160    | 20       |
| review    | 100     | 140    | 20       |
| research  | 100     | 140    | 20       |
| tests     | 120     | 160    | 20       |
| docs      | 60      | 90     | 20       |
| default   | 100     | 140    | 20       |

Wrap-up: `LANE_WRAP_UP_THRESHOLDS = { steerAt: 6, stopAt: 6, repeatAt: 3 }`. The guard checks
stop before steer, so call 6 returns `stop` and never `steer`.

Resolution rules:

- Both unset: the kind default.
- Only steer saved (integer >= 1): stop = ceil(steer × 4/3).
- Only stop saved (integer >= 2): steer = floor(stop × 0.75).
- Both saved: both must be integers >= 1 and stop must be greater than steer.
- Any invalid value: the kind default for the pair, with one warning.
- repeatAt unset: the kind default. repeatAt invalid (below 2 or not an integer): the kind
  default, with one warning.

## How "unset" is detected on each host

All three hosts send `ptah` file-based keys to `PtahFileSettingsManager.get(key, defaultValue)`:

- VS Code: `vscode-workspace-provider.ts:80`.
- Electron: `electron-workspace-provider.ts:95`.
- CLI: `cli-workspace-provider.ts:89`.

`get` returns the stored value when it is not `undefined`, otherwise the caller default when
it is not `undefined`, otherwise the registered `FILE_BASED_SETTINGS_DEFAULTS` entry. The
runtime and the RPC handler now pass no caller default, so a key with nothing stored reads as
the registered `null`. A key the user saved as `null` also reads as `null`. Both count as
unset. These keys never reach `vscode.workspace.getConfiguration`. Also,
`apps/ptah-extension-vscode/package.json` declares none of the three keys (grep found no
match), so no manifest default can mask "unset". Nothing changed there.

## Manager call site

`agent-process-manager.service.ts:1222` calls `resolveLaneGuardThresholds()` with no argument.
The parameter is optional, so this still compiles, and I did not edit the file. Until Batch B
passes `info.taskKind`, every lane gets the default row (100/140/20). Nothing outside the guard
calls `laneBudgetSteerMessage`.

## Verification

VERIFY_RESULT_PLACEHOLDER

## Follow-ups

- There is no "reset to per-kind default" control in the settings UI. Once a value is saved,
  the only way back to unset is to remove the key from `~/.ptah/settings.json`.
  `agent:setConfig` validation also rejects `null`.
- In the UI an unset pair shows as 100/140. Saving a new steer alone sends only steer (stop
  140 did not change), so the runtime derives stop = ceil(steer × 4/3) and the stop field
  keeps showing 140 until a reload. Saving both values together avoids this.
- `libs/shared/src/lib/types/rpc/rpc-agents.types.ts:282-287` still says "Default:
  `FILE_BASED_SETTINGS_DEFAULTS`" for the three get-config fields. It should say "absent when
  unset". That is a shared file, so I left it alone.
- When both values are saved but form a broken pair (hand-edited, stop <= steer), get-config
  reports them as saved while the runtime uses the kind default. This behaved the same way
  before this batch.
