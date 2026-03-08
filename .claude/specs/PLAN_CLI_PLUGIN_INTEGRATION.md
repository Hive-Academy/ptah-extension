# Plan 2: Premium Plugin Integration for CLI Adapters (No Workspace Pollution)

## Context

Ptah's plugin system (19 skills, 7 commands across 4 plugins) powers Claude Agent SDK and Ptah CLI but is completely absent from Gemini, Codex, and Copilot. All three CLIs now support the Agent Skills open standard (`SKILL.md`), which our plugins already use. However, **plugins are premium-gated** and must not leave files in the user's workspace.

### Current State

| CLI              | Plugins                     | Skills | Commands | projectGuidance        |
| ---------------- | --------------------------- | ------ | -------- | ---------------------- |
| Claude Agent SDK | Full (native `pluginPaths`) | Full   | Full     | Full                   |
| Ptah CLI         | Full (via SDK)              | Full   | Full     | Full                   |
| Gemini CLI       | None                        | None   | None     | Yes (GEMINI_SYSTEM_MD) |
| Codex CLI        | None                        | None   | None     | Yes (task prompt)      |
| Copilot SDK      | None                        | None   | None     | Yes (systemMessage)    |

### Desired State

All CLIs get full skill/command access + full prompt harness for premium users, using each CLI's native mechanism, without workspace file pollution.

---

## Research Findings: Per-CLI Plugin Mechanisms

### Gemini CLI

- **Extensions**: `gemini extensions link <absolute-path>` — creates symlink in `~/.gemini/extensions/` (NOT in workspace)
- **Skills within extensions**: Extension's `skills/{name}/SKILL.md` auto-discovered
- **Manifest required**: `gemini-extension.json` with name, version, optional mcpServers
- **Also scans**: `~/.agents/skills/` and `~/.gemini/skills/` (user-level, outside workspace)
- Our bundled plugin directories already have the right structure

### Codex CLI

- **User-level skills**: `~/.agents/skills/` (outside workspace, auto-discovered)
- **Symlinks supported**: Codex follows symlinks during skill scanning
- **Config override**: `~/.codex/config.toml` can disable skills but can't add custom paths
- **Resume support**: `codex.resumeThread(threadId)` now available in SDK

### Copilot SDK

- **No native skills API** in `createSession()` — no `plugins` or `skills` parameter
- **systemMessage**: `{ mode: 'append', content: '...' }` — can inject full prompt harness
- **tools**: Can register custom `Tool[]` array
- Custom behavior via **systemMessage** + **tools**, not dedicated skills interface

---

## Implementation Plan

### 2.1 Extend `CliCommandOptions` with `pluginPaths` and `systemPrompt`

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\cli-adapter.interface.ts`

Add to `CliCommandOptions`:

```typescript
readonly pluginPaths?: string[];
readonly systemPrompt?: string;
```

### 2.2 Create shared plugin registration service

**New file**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\cli-plugin-registrar.ts`

Injectable singleton with:

- `registerSkills(pluginPaths, workingDirectory)` → symlinks to `~/.agents/skills/ptah-*`, returns cleanup fn
- `cleanupStaleSymlinks()` → scan `~/.agents/skills/` for stale `ptah-*` symlinks on extension activation
- Uses `junction` symlinks on Windows (no admin needed)

### 2.3 Gemini CLI: Register skills + full prompt harness

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\gemini-cli.adapter.ts`

In `runSdk()`:

1. Call `registerSkills()` for native skill discovery via `~/.agents/skills/`
2. Use `options.systemPrompt` (full harness) instead of just `projectGuidance` for `GEMINI_SYSTEM_MD`
3. Register cleanup on agent exit

### 2.4 Codex CLI: Register skills + full prompt harness

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\codex-cli.adapter.ts`

In `runSdk()`:

1. Call `registerSkills()` for native skill discovery
2. Use `options.systemPrompt` in `buildTaskPrompt()` instead of just `projectGuidance`
3. Register cleanup on agent exit

### 2.5 Copilot SDK: Full prompt harness via systemMessage

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\copilot-sdk.adapter.ts`

In `runSdk()`:

1. Use `options.systemPrompt ?? options.projectGuidance` for `sessionConfig.systemMessage.content`
2. No symlinks needed (Copilot has no native skill discovery mechanism)

### 2.6 Send full prompt harness to all CLIs

Currently CLI agents only receive `projectGuidance` (project-specific section). For premium users, send the **full system prompt** (same as Claude Agent SDK gets):

- `PTAH_CORE_SYSTEM_PROMPT` (core instructions)
- Enhanced prompts (project context, framework guidelines, coding standards)
- Skill catalog (all enabled skill summaries with trigger conditions)
- `PTAH_SYSTEM_PROMPT` (MCP tool documentation, if MCP available)

### 2.7 Pass pluginPaths + systemPrompt from AgentProcessManager

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts`

In spawn flow (premium-gated):

1. Resolve enabled plugin paths via `PluginLoaderService`
2. Assemble full system prompt (reuse from `SdkQueryOptionsBuilder.assembleSystemPromptAppend()`)
3. Pass both as `pluginPaths` + `systemPrompt` in `CliCommandOptions`

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.ts`

Enrich spawn request with `pluginPaths` + `systemPrompt`.

### 2.8 Stale symlink cleanup on extension activation

**File**: `cli-plugin-registrar.ts` + extension activation

`cleanupStaleSymlinks()`: scan `~/.agents/skills/` for `ptah-*` symlinks, remove stale ones. Called on extension activation.

### 2.9 Premium gate enforcement

```typescript
const isPremium = licenseService.verifyLicense().tier === 'pro';
const pluginPaths = isPremium ? pluginLoader.resolvePluginPaths(enabledPluginIds) : undefined;
const systemPrompt = isPremium ? await assembleFullSystemPrompt() : undefined;
```

---

## Strategy Comparison

| Approach                | Gemini                                                | Codex                              | Copilot                              |
| ----------------------- | ----------------------------------------------------- | ---------------------------------- | ------------------------------------ |
| **Skills mechanism**    | `~/.agents/skills/` symlinks                          | `~/.agents/skills/` symlinks       | Full prompt harness in systemMessage |
| **System prompt**       | Full harness via GEMINI_SYSTEM_MD                     | Full harness via buildTaskPrompt() | Full harness via systemMessage       |
| **Workspace pollution** | None                                                  | None                               | None                                 |
| **Skill discovery**     | Native (auto-activate)                                | Native (auto-activate)             | Prompt-based (always available)      |
| **Cleanup**             | Symlink removal on exit + stale cleanup on activation | Same                               | None (session-scoped)                |

---

## Files Modified/Created Summary

| File                               | Change                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------- |
| `cli-adapter.interface.ts`         | Add `pluginPaths` + `systemPrompt` to `CliCommandOptions`                  |
| `agent-process-manager.service.ts` | Resolve pluginPaths + assemble full system prompt (premium-gated)          |
| `agent-namespace.builder.ts`       | Enrich spawn request with pluginPaths + systemPrompt                       |
| `gemini-cli.adapter.ts`            | Register skills via symlinks + use full systemPrompt                       |
| `codex-cli.adapter.ts`             | Register skills via symlinks + use full systemPrompt                       |
| `copilot-sdk.adapter.ts`           | Use full systemPrompt for sessionConfig.systemMessage                      |
| `cli-adapter.utils.ts`             | Update `buildTaskPrompt()` to prefer `systemPrompt` over `projectGuidance` |
| **New**: `cli-plugin-registrar.ts` | Shared plugin registration + stale symlink cleanup                         |

---

## Implementation Order

1. Add `pluginPaths` + `systemPrompt` to `CliCommandOptions`
2. Create `CliPluginRegistrar` service
3. Wire through AgentProcessManager + namespace builder (premium-gated)
4. Update `buildTaskPrompt()` to use `systemPrompt`
5. Gemini adapter: register skills + full systemPrompt
6. Codex adapter: register skills + full systemPrompt
7. Copilot adapter: full systemPrompt in sessionConfig
8. Stale symlink cleanup on extension activation
9. Test all 3 CLIs with premium account

---

## Verification

1. **Premium gate**: Non-premium → no skills, no full prompt → uses projectGuidance as before
2. **Full prompt harness**: Premium → agent receives full system prompt
3. **Gemini/Codex skills**: `~/.agents/skills/ptah-*` symlinks created → CLI discovers skills → cleanup on exit
4. **Copilot skills**: systemMessage includes full harness → agent has skill knowledge
5. **Stale cleanup**: Force-kill → restart → stale ptah-\* symlinks removed
6. **No workspace pollution**: Working directory clean after all tests
7. **Build**: `npm run typecheck:all && npm run lint:all` passes
