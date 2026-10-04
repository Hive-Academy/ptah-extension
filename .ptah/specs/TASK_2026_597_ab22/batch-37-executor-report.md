# Batch 37 executor report — N1 setting key and TTL resolver

Executor: backend-developer. Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-597-followups`. No git run.

## Tasks

- 37.1 File-based key `agentOrchestration.subagentPromptCacheTtl` — DONE
- 37.2 `resolveSubagentPromptCacheTtl` pure resolver — DONE

## Files

- MODIFIED `libs/backend/platform-core/src/file-settings-keys.ts` — added the key to `FILE_BASED_SETTINGS_KEYS` (after `agentOrchestration.piModel`) and the default `'auto'` to `FILE_BASED_SETTINGS_DEFAULTS`. Pure additions; no existing line changed (TASK_2026_609 append-only rule).
- MODIFIED `libs/backend/platform-core/src/file-settings-keys.spec.ts` — new describe: key is file-based, default `'auto'`, default is in `SUBAGENT_PROMPT_CACHE_TTL_SETTINGS`, `SCOPED_SETTING_KEYS` entry is global-only.
- MODIFIED `libs/shared/src/lib/types/rpc/rpc-agents.types.ts` — new `SUBAGENT_PROMPT_CACHE_TTL_SETTINGS = ['auto','5m','1h'] as const`, `SubagentPromptCacheTtlSetting`, `SubagentPromptCacheTtl` (`'5m'|'1h'`), `SubagentPromptCacheTtlEnvOverride` (`'5m'|'1h'|'invalid'`). `AgentOrchestrationConfig` gains OPTIONAL `subagentPromptCacheTtl?` and `subagentPromptCacheTtlEnvOverride?`; `AgentSetConfigParams` gains optional `subagentPromptCacheTtl?`.
- MODIFIED `libs/shared/src/lib/types/rpc/rpc-auth.types.ts` — `SCOPED_SETTING_KEYS['agentOrchestration.subagentPromptCacheTtl'] = { appScopable: false, supportedTargets: ['global'] }` (same as the codex keys).
- CREATED `libs/shared/src/lib/utils/subagent-prompt-cache-ttl.ts` — `resolveSubagentPromptCacheTtl({ setting, envValue, canSpawnSubagents })` returning `{ sdkValue, effective, source, envOverride? }`.
- CREATED `libs/shared/src/lib/utils/subagent-prompt-cache-ttl.spec.ts` — 24-row table (setting auto/5m/1h x env unset/5m/1h/invalid x canSpawn) plus unknown-setting and blank-env cases; 34 tests.
- MODIFIED `libs/shared/src/lib/utils/index.ts` — exports the resolver and its two interfaces.

## Resolver rules (as implemented)

- `setting` is `unknown`; anything other than `'5m'`/`'1h'` is treated as `'auto'`.
- `sdkValue` follows the setting only: explicit value, else `'1h'` when `canSpawnSubagents`, else `undefined`.
- Env unset (`undefined` or blank/whitespace): `effective = sdkValue ?? '5m'`, `source` = `setting` / `auto` / `sdk-default`, no `envOverride` key.
- Env exactly `'5m'`/`'1h'`: `effective` = env, `source: 'env'`, `envOverride` = env.
- Env set to anything else (case-sensitive, e.g. `'1H'`, `'2h'`): `envOverride: 'invalid'`, effective/source fall back to the setting path.

## Checks

- `npx nx run-many -t typecheck,lint -p @ptah-extension/shared @ptah-extension/platform-core @ptah-extension/rpc-handlers @ptah-extension/core @ptah-extension/skill-synthesis-ui @ptah-extension/tribunal-panel @ptah-extension/webview-e2e-harness ptah-cli ptah-electron-e2e ptah-extension-vscode ptah-electron ptah-extension-webview` — PASS: "Successfully ran targets typecheck, lint for 12 projects" (24 tasks).
- `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/platform-core @ptah-extension/platform-vscode @ptah-extension/platform-electron @ptah-extension/platform-cli @ptah-extension/tribunal-panel @ptah-extension/skill-synthesis-ui --maxWorkers=2` — 6/7 PASS; platform-electron FAILED first run on `workspace-watch-host.stress.spec.ts` only: "dist/apps/ptah-electron/workspace-watch-host.mjs is missing; run `npx nx run ptah-electron:build-workspace-watch-host` first" (fresh worktree, no build artifact; unrelated to this batch).
- After `npx nx run ptah-electron:build-workspace-watch-host`: `npx nx run @ptah-extension/platform-electron:test --maxWorkers=2` — PASS: Test Suites 37 passed, 2 skipped; Tests 667 passed, 4 skipped, 3 todo.
- Direct spec runs: `subagent-prompt-cache-ttl.spec.ts` 34 passed; `file-settings-keys.spec.ts` 242 passed.

## Deviations

- Added the `SUBAGENT_PROMPT_CACHE_TTL_SETTINGS` const and three named types in `rpc-agents.types.ts` (not explicitly named in the batch). Follows the `CLI_REASONING_EFFORT_VALUES` precedent in the same file; Batch 38's setConfig validation and Batch 40's TTL type can import them instead of repeating the literal union.
- `envValue` blank/whitespace is treated as unset (not `'invalid'`). The batch did not specify blank handling.

## Out-of-scope observations

- `platform-electron:test` depends on a built `workspace-watch-host.mjs`; in a fresh worktree the team-leader's re-run needs `npx nx run ptah-electron:build-workspace-watch-host` first (artifact now exists in this worktree's `dist/`).
