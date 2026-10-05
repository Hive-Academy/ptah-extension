# CI-FIX-2 executor report — TASK_2026_609_c495

Branch `fix/task-609-subagent-setup`. Not pushed.

## Failure 1: settings-core TC-18 import-scope guard

**Cause.** Commit 15d845bd2 added `SETTINGS_TOKENS` and `type AgentModelSettings` imports from `@ptah-extension/settings-core` to `apps/ptah-electron/src/di/phase-2-libraries.ts` and `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`. It needed them to build the lazy agent-models getter, which is the 4th argument of `createPluginConfigSourceResolver`. The allowlist in `libs/backend/settings-core/src/settings-core.spec.ts:784-822` covers `libs/backend/platform-{electron,cli,vscode}/src/settings/` and `apps/*/src/activation/`. It does not cover `apps/*/src/di/phase-2-libraries.ts`. `libs/backend/cli-engine/` passes because the allowlist names the whole lib (`:809`).

**Fix.** The allowlist was not changed.
- I created `libs/backend/platform-vscode/src/settings/agent-model-settings-getter.ts` and `libs/backend/platform-electron/src/settings/agent-model-settings-getter.ts`. Both sit inside the permitted `src/settings/` directories and export `createAgentModelSettingsGetter(container): () => AgentModelSettings | null`. The getter is lazy: it calls `isRegistered(SETTINGS_TOKENS.AGENT_MODEL_SETTINGS)` and then either resolves the singleton or returns null, the same as the old inline lambda.
- Both new functions are exported from each lib's barrel (`src/index.ts`).
- Both `phase-2-libraries.ts` files no longer import settings-core. They import `createAgentModelSettingsGetter` from their platform lib, which they already imported for the editor launcher, and pass `createAgentModelSettingsGetter(container)` as the 4th argument.
- On the type: I used the `AgentModelSettings` class from settings-core as the return type, not `AgentModelsFactory` from harness-sync. This adds no new dependency edge from the platform libs, because they already depend on settings-core. The apps never name the type, and the type is structurally compatible with `AgentModelsFactory`. Typecheck confirms this.
- I left cli-engine unchanged. It is permitted, and changing it only for symmetry would have meant extra churn in a lib this batch does not own.

**Evidence.** `git grep -n settings-core -- apps/ptah-electron/src/di apps/ptah-extension-vscode/src/di` now finds only the two `container.smoke.spec.ts` files, and both are allowlisted.

**SHA:** `134bdda11` — fix(platform): route the agent-models getter through the platform adapters.

## Failure 2: VS Code rpc-surface "excludes exactly the pre-refactor Electron-only method list"

**Cause.** TASK_2026_609 added four methods to `RPC_METHOD_NAMES` in the `skillSynthesis:*` namespace: `getAgentModels`, `setAgentModel`, `listQuarantinedAgents` and `restoreQuarantinedAgent` (`libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:328-330`). The VS Code host profile never enables the `skillSynthesis` capability, so `deriveRpcSurface` correctly excludes all four. The frozen list in the spec had not been updated to match.

**Decision.** The spec header says what to do (`rpc-surface.spec.ts:12-14`): "When a genuinely new method lands in `RPC_METHOD_NAMES`, exactly one of the two lists must move: add it here if this host cannot serve it." The block comment at `:113-116` also says the whole `skillSynthesis:*` namespace is excluded on VS Code. The B-6 report puts the per-agent model editor only on the desktop Thoth Library Agents tab, so these four methods are Electron-only like the rest of the namespace. I added each one to `VSCODE_EXPECTED_ABSENT_METHODS` in sorted position with a one-line reason. The assertion is unchanged, so the test is not weakened, and the partition test still proves there is no gap or overlap.

**SHA:** `b8f123f2b` — test(ptah-extension-vscode): record the new electron-only skillSynthesis agent methods.

## Checks

| Command | Result |
| --- | --- |
| `npx nx run-many -t typecheck,lint -p settings-core platform-vscode platform-electron ptah-extension-vscode ptah-electron --parallel=2` | Successfully ran typecheck, lint for 5 projects. 9 tasks ran; `ptah-electron` does not define lint. |
| `npx nx test settings-core --maxWorkers=2 --testPathPatterns=settings-core.spec` | 1 suite, 36 passed, TC-18 included |
| `npx nx test ptah-extension-vscode --maxWorkers=2 --testPathPatterns=rpc-surface` | 1 suite, 2 passed |
| `npx nx run-many -t test -p platform-vscode platform-electron --maxWorkers=2` | Successfully ran test for 2 projects |
| `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` | exit 0 (TOTAL 293 unsuppressed, within baselines) |

Commit hooks ran and were not skipped. Commits contain source files only; `.ptah/specs/` and `test-results/` remain untracked.

## Out-of-scope observations

None.
