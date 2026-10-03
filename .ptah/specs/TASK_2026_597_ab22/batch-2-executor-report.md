# Batch 2 executor report — TASK_2026_597_ab22

Batch 2: Lane settings types (Codex budget keys and `inherit`). S1a, component 6 part 1.
Executor: backend-developer. Mode: sequential. No commits. No CLI lanes.

## Tasks

### Task 2.1: file-based keys and defaults for the three Codex budget keys — COMPLETE

- `FILE_BASED_SETTINGS_KEYS` gains `agentOrchestration.codexAutoCompactTokens`,
  `agentOrchestration.codexToolOutputTokenLimit` and `agentOrchestration.codexWebSearch`. They sit right after
  `codexAutoApprove`, beside the other `codex*` entries.
- `FILE_BASED_SETTINGS_DEFAULTS` gains `120000`, `2500` and `true` at the same position. A one-line comment says that 0
  means "use the Codex runtime default".
- Spec: a new `describe('Codex lane budget keys (TASK_2026_597)')` block in `file-settings-keys.spec.ts`. It follows
  the `memory lifecycle keys` pattern. For each key it checks the Set entry, `isFileBasedSettingKey` routing, that the
  default is an own property and the exact default value. A second case checks that both numeric defaults are
  non-negative integers.
- No lane-guard keys were added. They belong to Batch 16.

### Task 2.2: RPC types and scoped keys — COMPLETE

- `CLI_REASONING_EFFORT_VALUES` and `PI_REASONING_EFFORT_VALUES` both gain `'inherit'`, placed right after `''`. The
  doc comments say what it means.
- `AgentOrchestrationConfig` gains `codexAutoCompactTokens?: number`, `codexToolOutputTokenLimit?: number` and
  `codexWebSearch?: boolean`, each with a doc comment giving the range, the default and what 0 means.
- `AgentSetConfigParams` gains the same three optional fields.
- `SCOPED_SETTING_KEYS` gains three entries with `{ appScopable: false, supportedTargets: ['global'] }`. They come
  right after `agentOrchestration.codexReasoningEffort`, which uses the same shape as the `codexModel` entry.
- Types only. No runtime logic.

## Verification

`npx nx run-many -t test,lint,typecheck -p @ptah-extension/platform-core @ptah-extension/shared --parallel=2`

```
√  nx run @ptah-extension/shared:test
√  nx run @ptah-extension/shared:typecheck
√  nx run @ptah-extension/platform-core:lint
√  nx run @ptah-extension/platform-core:typecheck
√  nx run @ptah-extension/platform-core:test
NX  Successfully ran targets test, lint, typecheck for 2 projects
Cache: 0/6 hit (0%)
```

Six tasks ran with no cache hits, so the new spec ran. The tail shows 5 lines; the sixth (`shared:lint`) is listed in
the run summary as "6 successful tasks". Nx Cloud printed a 401 "organization disabled" notice. It does not affect the
local run.

`npx nx run-many -t typecheck -p ptah-extension-vscode ptah-electron ptah-cli --parallel=2`

```
√  nx run ptah-extension-vscode:typecheck
√  nx run ptah-electron:typecheck
√  nx run ptah-cli:typecheck
NX  Successfully ran target typecheck for 3 projects
```

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\backend\platform-core\src\file-settings-keys.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\backend\platform-core\src\file-settings-keys.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\shared\src\lib\types\rpc\rpc-agents.types.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\shared\src\lib\types\rpc\rpc-auth.types.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\.ptah\specs\TASK_2026_597_ab22\batch-2-executor-report.md` (this report)

## Plan deviations and decisions

- **The three `AgentOrchestrationConfig` fields are optional (`?`).** The plan only says the type "gains" them.
  Making them required would break code outside this batch, all of it building `AgentOrchestrationConfig` literals:
  - `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:192`, which Batch 3 owns.
  - `libs/frontend/tribunal-panel/src/lib/services/tribunal-discovery.service.spec.ts:25`.
  - The e2e fixtures in `libs/frontend/webview-e2e-harness/.../skills-lane-pickers.e2e.spec.ts:152` and
    `apps/ptah-electron-e2e/src/specs/thoth/skills.spec.ts:151`.

  The type already has optional fields that were added later (`antigravityModel`, `opencodeModel`, `piModel`,
  `piReasoningEffort`). The batches running in parallel also need the tree to keep compiling. Batch 3 always fills the
  three fields in `agent:getConfig`. Batch 3 or Batch 20 may make them required once every producer sets them.

## Risks and edge cases

- **Downstream readers.** Batches 3 and 6 read these types. The names match plan § Contracts (:409-411) exactly, and
  the `SCOPED_SETTING_KEYS` key strings match the file-based keys exactly.
- **Allowlist reuse.** `invalidReasoningEffort` (`agent-rpc.handlers.ts:80-93`) uses the two arrays, so
  `agent:setConfig` accepts `inherit` with no handler change. No existing `agent-rpc*.spec.ts` checks that `inherit` is
  rejected (grep for `inherit`: no matches), so no spec breaks. Batch 3 confirms the accept path.
- **Unrouted-write failure mode.** All three keys are in both the Set and the defaults, and the spec names them
  literally. A key missing from both tables now fails the spec instead of silently dropping writes.
- **Lane-guard keys.** Not added. They belong to Batch 16.
- **Shared types change.** The three-app typecheck passes, as shown above.

## Out-of-scope observations (not touched)

- **Pi gets `inherit` raw until Batch 6 lands.** `agent-spawn-environment.service.ts:122-129` passes
  `agentOrchestration.piReasoningEffort` raw (`piEffort || undefined`). A stored `inherit` would reach
  `pi --thinking inherit` until Batch 6 adds the R2.3 `inherit` resolution. Codex and Copilot are safe in the meantime:
  `mapEffortToCli` maps unknown values, including `inherit`, to `undefined`. Batch 6 must cover the Pi branch.
- **No UI label yet.** `cli-model-effort-popover.component.ts:19-21` has no `inherit` label, so the option shows as the
  raw string `inherit` until Batch 21 adds `inherit: 'Inherit chat effort'`. It still compiles because the labels
  object is `Record<string, string>` with a `?? value` fallback.
- **`KNOWN_CONFIG_KEYS` not updated.** `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts` is listed in
  component 6's file list but is not part of Batch 2, so the three new keys are not there yet. Settings export will
  leave them out until a later batch adds them.
