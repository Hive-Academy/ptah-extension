# Code Logic Review — `TASK_2026_555` Batch 4 (D8: spawn reader reads per-CLI settings from the file store)

## Summary

| Metric              | Value     |
| -------------------- | --------- |
| Overall score        | 9/10      |
| Assessment            | APPROVED  |
| Blocking issues       | 0         |
| Serious issues        | 0         |
| Moderate issues       | 1         |
| Failure modes found   | 1 (mitigated, not exploitable through any supported writer) |

## Scope examined

- `libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-spawn-environment.service.ts` (git diff only, 4 hunks: `resolveReasoningEffort` pi branch, `resolveReasoningEffort` codex/copilot fallback, `resolveAutoApprove`, `resolveModel`)
- `libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-spawn-environment.settings-routing.spec.ts` (new, 7 cases), read in full
- Write side: `libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.ts:1019-1130` (`getAgentCfg`/`setAgentCfg`/`migrateAgentOrchestrationSettings`)
- Routing rule: `libs\backend\platform-vscode\src\implementations\vscode-workspace-provider.ts:75-120`, `libs\backend\platform-core\src\file-settings-keys.ts` (`FILE_BASED_SETTINGS_KEYS`, `isFileBasedSettingKey`)
- `apps\ptah-extension-vscode\package.json:252-267` (manifest contributes)
- Whole-repo grep for readers of the nine write-side keys across `libs/` and `apps/` (see "Completeness" below)
- `agent-process-manager.service.ts:296-351` (the sole caller of the three fixed methods)
- Live test execution (see "Verification")

## Five logic questions

### 1. How does this fail silently?

No new silent-failure path is introduced by this diff. The fix itself removes a silent failure: before it, `resolveModel`/`resolveReasoningEffort`/`resolveAutoApprove` called `getConfiguration('ptah.agentOrchestration', '<key>', default)`. Because `section !== 'ptah'`, the routing check at `vscode-workspace-provider.ts:80` (`section === 'ptah' && isFileBasedSettingKey(key)`) was always false for that call, so the read fell through to `vscode.workspace.getConfiguration('ptah.agentOrchestration').get('<key>', default)` — a section with no `contributes.configuration` schema for these keys, which VS Code resolves as `undefined`/default with no error, warning, or thrown exception. A user who set `codexModel` in the UI got the request's own `model` field or nothing, and nothing told them why. The four corrected reads now route through `section === 'ptah'`, and each of the nine affected keys is confirmed present in `FILE_BASED_SETTINGS_KEYS` (`file-settings-keys.ts:162-172`), so the silent-miss path is closed for all nine.

### 2. What user action produces unexpected behaviour?

None identified for the fixed keys. A user who sets a per-CLI model or reasoning effort via `agent:setConfig` and then spawns that CLI now sees the value applied, matching the write. The only unusual action that still produces a surprising (but pre-existing, out-of-diff) result: hand-editing `ptah.agentOrchestration.codexModel` directly in VS Code's settings.json. That key is not declared in `contributes.configuration`, so VS Code already flags it "Unknown Configuration Setting" and it was never a supported input; after this fix it is simply ignored rather than accidentally read. Test 7 of the new spec (`agent-spawn-environment.settings-routing.spec.ts:147-161`) pins this as intended behaviour, not an oversight.

### 3. What input data produces a wrong answer?

None found in the diff's four hunks — each is a mechanical `('ptah.agentOrchestration', key)` → `('ptah', 'agentOrchestration.' + key)` rewrite with the default value unchanged (`''`/`true`), matching the pattern already used by the untouched sibling reads two lines below (`sdkIdleReleaseMs`, `maxConcurrentAgents`, `disabledClis`, `preferredAgentOrder` — service.ts:196-256, `git diff` shows these were already correct and not touched). Verified the interaction between `resolveReasoningEffort`'s UI-driven default and the file-stored fallback still composes correctly: the UI effort (`reasoningSettings.effort.get()`) is checked first for codex/copilot and wins even when a stale/contradicting file value exists (spec case `agent-spawn-environment.settings-routing.spec.ts:111-118`), while `pi` deliberately bypasses the UI driver entirely and reads the file value raw (`service.ts:122-129`, spec case `:120-127`) — this asymmetry is intentional per the existing code comments, not a defect introduced here.

### 4. What happens when a dependency fails?

`IWorkspaceProvider.getConfiguration` is a synchronous, non-throwing call (both `VscodeWorkspaceProvider.getConfiguration` at `vscode-workspace-provider.ts:75-85` and `PtahFileSettingsManager.get` return a default rather than throw). The diff does not add any new I/O, try/catch, or async boundary, so there is no new dependency-failure surface to evaluate for these four hunks specifically.

### 5. What is missing that the requirements never mentioned?

- The task's own BLOCKED check (batch-4-report.md) is thorough and I independently re-verified its two load-bearing claims (see "Completeness" and "BLOCKED check" below) rather than taking the report's word for them.
- Not exercised by the new spec, but low-risk: `resolveModel`'s `cursor`, `antigravity`, and `opencode` branches (`MODEL_CONFIG_KEYS` at `service.ts:37-45`) are covered only by the `codex` case in the new spec; the routing rule is keyed on `isFileBasedSettingKey(key)` and all six model keys are file-routed identically (`file-settings-keys.ts:169-172`), so this is a coverage gap rather than a distinct code path — see Moderate finding below.

## Failure modes

### Direct-`npx jest` invocation fails on unrelated shared-tree contamination

- Trigger: running `npx jest agent-spawn-environment.settings-routing.spec.ts` directly from `libs/backend/cli-agent-runtime` (as instructed) rather than through `nx test`.
- Symptom: `Test suite failed to run` — a `ts-jest` typecheck error in `libs/shared/src/lib/types/rpc.types.ts:3570` (`Property '"auth:deleteStoredKey"' is missing in type ... 'Record<keyof RpcMethodRegistry, true>'`), which prevents the whole cli-agent-runtime test project from compiling under isolated ts-jest.
- Evidence: `git status --porcelain -- libs/shared/src/lib/types/rpc.types.ts` shows this file `M` (modified, uncommitted) — it belongs to another in-flight batch's WIP in this shared worktree, not to the Batch 4 diff. `npx nx test @ptah-extension/cli-agent-runtime --testPathPattern=agent-spawn-environment` (the same invocation the batch-4-report used) succeeds: 69 suites, 1250 passed, 1 skipped — matching the report's own numbers exactly.
- Current handling: not this batch's concern — the file under review does not touch `rpc.types.ts`.
- Recommendation: none for Batch 4. Flagging only so the reviewer record does not read as "the new spec doesn't compile" — it compiles and passes; the direct-jest invocation is sensitive to unrelated WIP in the same tree, which the team-leader should be aware of when serializing batches for commit (Gate G).

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

### Model-key coverage gap in the new spec

- File: `libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-spawn-environment.settings-routing.spec.ts:96-102`
- Only `codex`/`codexModel` is exercised through `resolveModel`. `cursor`, `antigravity`, `opencode`, and `pi` share the exact same `MODEL_CONFIG_KEYS` → `agentOrchestration.<key>` lookup path (`service.ts:165-179`) and are equally file-routed (`file-settings-keys.ts:169-172`), so this is very unlikely to hide a real per-CLI defect — but a future edit that special-cased one of these four CLIs would not be caught by this suite. Minor, since the shared code path is unmistakably the same three lines for all six keys.

## Data flow

1. UI/RPC caller invokes `agent:setConfig` → `setAgentCfg('codexModel', value)` → `workspace.setConfiguration('ptah', 'agentOrchestration.codexModel', value)` (`agent-rpc.handlers.ts:1040-1046`). OK — file-routed by `isFileBasedSettingKey`.
2. `VscodeWorkspaceProvider.setConfiguration` routes to `PtahFileSettingsManager.set` and persists to `~/.ptah/settings.json` (`vscode-workspace-provider.ts:95-110`). OK.
3. A spawn request calls `AgentSpawnEnvironment.resolveModel('codex', requestModel)` (`agent-process-manager.service.ts:296-299`). OK — the caller and the arguments match the method signature.
4. `resolveModel` reads `workspace.getConfiguration('ptah', 'agentOrchestration.codexModel', '')` (post-fix form, `service.ts:172-177`). OK — this is the corrected hunk; `section === 'ptah'` now reaches the same `isFileBasedSettingKey` check as the writer.
5. `VscodeWorkspaceProvider.getConfiguration` matches the same routing predicate and returns the file-stored value (`vscode-workspace-provider.ts:80-81`). OK — writer and reader now agree on the routing key.
6. Value flows into the spawned CLI's launch arguments. Not reviewed in this batch (outside the diff), no gap identified within scope.

No step in this chain loses, duplicates, or reads a stale value within the four corrected reads.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| All nine file-routed keys (`codexModel`, `copilotModel`, `cursorModel`, `antigravityModel`, `opencodeModel`, `piModel`, `codexReasoningEffort`, `copilotReasoningEffort`, `piReasoningEffort`, `copilotAutoApprove`) are reachable through the fixed reader | COMPLETE | None — `AgentSpawnEnvironment` is confirmed the single runtime reader of all nine keys; whole-repo grep found no other reader still using the broken `('ptah.agentOrchestration', key)` split for any of them |
| No user-writable value is dropped by the fix (BLOCKED check) | COMPLETE | None — independently confirmed: `package.json:252-267` contributes only `preferredAgentOrder`/`maxConcurrentAgents`/`sdkIdleReleaseMs`; `migrateAgentOrchestrationSettings` (`agent-rpc.handlers.ts:1076-1129`) moves legacy stateStorage values into the file store via the correct `('ptah', stateKey)` form and never touches VS Code settings.json |
| New spec mirrors the real routing rule and would have failed pre-fix | COMPLETE | None — reproduced independently: stashing only the service.ts hunk and re-running `nx test` fails 5 of the new spec's 7 cases; re-applying the fix restores 69/69 suites passing |
| Defaults unchanged for an unset value | COMPLETE | None — `''`/`true` defaults preserved in the diff; spec case `:139-145` pins `undefined`/`true`/`undefined` |

Implicit requirements not addressed: model-key coverage for `cursor`/`antigravity`/`opencode`/`pi` in the new spec (Moderate finding above); not a functional gap, a spec-coverage one.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Value never written (fresh install) | YES | Falls to declared defaults (`''`/`true`) | None |
| UI effort selection conflicts with file-stored per-CLI effort (codex/copilot) | YES | UI wins by design, tested at `:111-118` | None |
| Pi effort with a UI selection also present | YES | UI selection ignored for pi, raw file value passes through, tested at `:120-127` | None |
| Hand-edited, uncontributed host-config key under the legacy section form | YES (as "not read") | Test `:147-161` pins that the file store, not host config, is authoritative | Documented behaviour change, not a supported input path — no user loses data because no writer ever produced this shape |
| `cursor`/`antigravity`/`opencode` model keys | Untested but not distinct code | Shares `MODEL_CONFIG_KEYS` lookup with `codex` | Coverage gap (Moderate) |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking; the only residual risk is the untested (but code-identical) model-key branches for cursor/antigravity/opencode/pi, which a future divergent edit to one CLI's branch would not catch.
- What a robust implementation would add: one parameterized spec case iterating all six `MODEL_CONFIG_KEYS` entries through `resolveModel`, so a future per-CLI special case can't silently regress without a corresponding red test.
