# Batch 38 executor report — N1 RPC and options builder

Executor: backend-developer. Mode: sequential. No commit, batches.md not edited.

## Tasks

- 38.1 `agent:getConfig` / `agent:setConfig` for `subagentPromptCacheTtl`, env override reported — DONE
- 38.2 Builder sets the TTL through the resolver, one INFO line — DONE

## Files

Production:

- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`
  - imports `SUBAGENT_PROMPT_CACHE_TTL_SETTINGS`, `resolveSubagentPromptCacheTtl`, `SubagentPromptCacheTtlSetting` from `@ptah-extension/shared` (no repeated literal union)
  - `isSubagentPromptCacheTtlSetting` guard. setConfig rejects values outside the set with `Unsupported subagentPromptCacheTtl value` before any write (after the codex-budget check, same shape), then writes `agentOrchestration.subagentPromptCacheTtl` through `setAgentCfg`
  - getConfig spreads `getSubagentPromptCacheTtl()`: the stored setting (an invalid hand-edited value reads as `'auto'`) plus `subagentPromptCacheTtlEnvOverride` from the resolver over `process.env.CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` (`'5m'`, `'1h'` or `'invalid'`). The field is absent when the env var is unset or blank.
- MODIFIED `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts`: `KNOWN_CONFIG_KEYS` gains `agentOrchestration.subagentPromptCacheTtl`
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (options part only)
  - `buildFlagSettings(..., subagentPromptCacheTtl?)`: the key is merged only when it is defined, and it is part of the "no opinion" check, so the shared `PTAH_DISABLE_SDK_AUTO_MEMORY` is still returned by identity when no key applies
  - `buildFlagSettingsArg(..., subagentPromptCacheTtl?)` passes it through as the 6th argument
  - new exported `canSpawnSubagents({ tools, disallowedTools })`: false when `Task` or `Agent` is disallowed, or when an explicit tool list has neither
  - constructor: an optional LAST parameter `@inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER, { isOptional: true }) workspace?`. It follows the documented "last and optional" rule, so the positional spec stubs still bind correctly.
  - `build()`: hoists `sessionTools` (the same `claude_code` preset as before). It calls `resolveSubagentPromptCacheTtl({ setting: workspace.getConfiguration('ptah', 'agentOrchestration.subagentPromptCacheTtl', 'auto'), envValue: process.env.CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL, canSpawnSubagents: canSpawnSubagents({ tools: sessionTools }) })` and logs once at INFO: `[SdkQueryOptionsBuilder] subagentPromptCacheTtl effective=<5m|1h> source=<env|setting|auto|sdk-default> sdkOption=<5m|1h|unset>`. It then passes `subagentTtl.sdkValue` as the 6th argument of `buildFlagSettingsArg`.
  - Other callers are unchanged: `sdk-query-runner.service.ts` (`buildFlagSettings(undefined, undefined, capabilityFlags)`) and `ptah-cli-registry.ts` (5 arguments) pass no TTL.

Specs:

- MODIFIED `agent-rpc.handlers.set-config.spec.ts`: new describe for N1. It covers the default `'auto'` matching `FILE_BASED_SETTINGS_DEFAULTS`, and round-trips auto/5m/1h. It checks that 7 invalid values are rejected with no `setConfiguration` call, that a hand-edited invalid value reads as auto, that env 5m/1h/30m is reported as `5m`/`1h`/`invalid`, and that a blank env means no field.
- CREATED `sdk-query-options-builder.subagent-ttl.spec.ts`. It runs the real `build()` and checks:
  - auto + subagent-capable → `'1h'`, read from the setConfig store key
  - `5m` → `'5m'`, and `1h` → `source=setting`
  - an unknown value or a missing workspace reads as auto
  - env `5m` → log `source=env`, while the SDK option still follows the setting
  - an invalid env value is ignored

  It also checks the helpers:
  - `canSpawnSubagents` with the preset, with Task or Agent disallowed, and with an explicit list
  - auto + subagent tool disallowed → `sdk-default`, unset, and the constant returned by identity
  - the internal-query and ptah-cli caller shapes add no key
  - a defined TTL never mutates the constant

- MODIFIED `settings-export.types.spec.ts`: the key is exported.
- MODIFIED existing identity/equality assertions, only where `build()`'s new default legitimately adds `subagentPromptCacheTtl: '1h'`. In every one of them the session runs the `claude_code` preset with nothing disallowed, so `auto` resolves to `1h`:
  - `sdk-query-options-builder.spec.ts:476` and the `ALWAYS` constant in the auto-compact block
  - `sdk-query-options-builder.capabilities.spec.ts:212` ("no capability key"; the TTL is not a capability key)
  - `sdk-query-options-builder.auto-compact-argv.spec.ts` `ALWAYS`. This one runs against the real SDK argv, which also proves the pinned SDK forwards the key to `--settings`.
  - `sdk-query-options-builder.output-style.spec.ts:293`: the source wiring guard now pins the 6-argument call.

  Not changed: `capabilities.spec.ts:451` `toBe(PTAH_DISABLE_SDK_AUTO_MEMORY)` and `output-style.spec.ts:57-65`. They call `buildFlagSettings` directly without a TTL and still pass, which confirms the absence rule.

## Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/rpc-handlers @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime ptah-extension-vscode ptah-electron ptah-cli` → "Successfully ran targets typecheck, lint for 6 projects" (12 tasks). The Nx Cloud 401 notice is unrelated.
- `npx nx run-many -t test -p @ptah-extension/rpc-handlers @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime --maxWorkers=2` → "Successfully ran target test for 3 projects"
- Focused run before the Nx run: `npx jest -c libs/backend/agent-sdk/jest.config.ts --maxWorkers=2 sdk-query-options-builder settings-export` → 8 suites, 189 tests passed
- `git diff -U0` on the builder: the hunks are imports (`:33`, `:43`), `buildFlagSettings` and the new `canSpawnSubagents` (`:383-438`), `buildFlagSettingsArg` (`:695`, `:701`), the constructor tail (`:982`), the TTL block after the auto-compact log (`:1158`), and the `settings:`/`tools:` options lines (`:1272-1282`). No hunk is in `buildSystemPrompt` or its call, and no system-prompt text or input changed.

## AS-N1c — how often `build()` runs

`SessionQueryExecutor.executeQuery` (`session-query-executor.service.ts:176`, the call at `:384`) calls `build()` once per SDK `query()` start: a new session, a resume, or a restart after a config change or dispose. Later turns stream through the same `userMessageStream`, so the TTL is resolved and logged once per query start, not once per turn. A setting change applies from the next query start.

## Deviations / interpretation

1. Setting source: the builder had no settings-store dependency. To "read from the same store key `agent:setConfig` writes", I added `IWorkspaceProvider` as an optional last constructor parameter. That is the same `getConfiguration('ptah', 'agentOrchestration.…')` route `agent:setConfig` uses. This is a constructor change in the builder, outside the options lines the batch names; no system-prompt code is touched. Without the provider (it is not registered), the setting reads as `'auto'`.
2. `canSpawnSubagents` in `build()`: the main session sets `tools: claude_code preset` and no `disallowedTools` (grep `disallowedTools` in `libs/backend` non-spec: only agent-generation frontmatter). So in `build()` the gate is currently always true and `auto` always yields `1h`. The exported `canSpawnSubagents` helper implements the disallowed rule (`Task`/`Agent`) and is specced directly, together with the resolver and `buildFlagSettings`, for the "subagent tool disallowed → unset" case. To hand it the session's options, `tools` was hoisted to `sessionTools`; the value is unchanged.
3. The env var name `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` is a local literal in both the handler and the builder, because shared exports no constant for it. Adding one to shared was outside this batch.

## Out-of-scope observations

- The working tree also holds Batch 39 frontend changes (core/chat) and a `batches.md` edit from other agents. I did not touch them.
