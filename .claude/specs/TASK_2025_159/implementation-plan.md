# Implementation Plan - TASK_2025_159: CLI Agent MCP Server Access (Premium-Gated)

## Codebase Investigation Summary

### Libraries Analyzed

- **llm-abstraction** (`libs/backend/llm-abstraction/`): CLI adapters (Copilot, Gemini, Codex), AgentProcessManager, CliCommandOptions
- **agent-sdk** (`libs/backend/agent-sdk/`): SdkQueryOptionsBuilder with existing premium gating pattern for Claude SDK
- **vscode-lm-tools** (`libs/backend/vscode-lm-tools/`): CodeExecutionMCP HTTP server, tool definitions, protocol handlers
- **vscode-core** (`libs/backend/vscode-core/`): LicenseService, DI tokens
- **shared** (`libs/shared/`): SpawnAgentRequest, CliType, AgentProcessInfo types

### Patterns Identified

**Premium Gating Pattern** (from `sdk-query-options-builder.ts:522-560`):

```typescript
// Two-check pattern: isPremium AND mcpServerRunning
if (!isPremium) {
  return {};
} // Free tier - disable MCP
if (!mcpServerRunning) {
  return {};
} // Server not running - disable
return { ptah: { type: 'http', url: `http://localhost:${PTAH_MCP_PORT}` } };
```

**Premium Status Resolution** (from `chat-rpc.handlers.ts:90-107`):

```typescript
isPremiumTier(status): boolean {
  return status.tier === 'pro' || status.tier === 'trial_pro' || status.plan?.isPremium === true;
}
isMcpServerRunning(): boolean {
  return this.codeExecutionMcp.getPort() !== null;
}
```

**CLI Adapter Config Write Pattern** (from `gemini-cli.adapter.ts:152-185`):

```typescript
// Adapter writes ~/.gemini/trustedFolders.json before spawn
private async ensureFolderTrusted(folder: string): Promise<void> {
  const geminiDir = join(homedir(), '.gemini');
  await mkdir(geminiDir, { recursive: true });
  await writeFile(trustedPath, JSON.stringify(trustedFolders, null, 2), 'utf8');
}
```

### Integration Points Verified

| Integration                                     | Source                                           | Status                                                        |
| ----------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| `CliCommandOptions.mcpPort`                     | `cli-adapter.interface.ts:27`                    | Exists, optional number                                       |
| `AgentProcessManager.doSpawnSdk()` mcpPort read | `agent-process-manager.service.ts:372-374`       | Reads from vscode config unconditionally                      |
| `CopilotCliAdapter.getMcpArgs()`                | `copilot-cli.adapter.ts:311-351`                 | Exists, uses mcpPort when provided                            |
| `GeminiCliAdapter.runSdk()`                     | `gemini-cli.adapter.ts:194-338`                  | Ignores mcpPort entirely                                      |
| `CodexCliAdapter.runSdk()`                      | `codex-cli.adapter.ts:211-306`                   | Ignores mcpPort entirely                                      |
| `CodeExecutionMCP.getPort()`                    | `code-execution-mcp.service.ts:121-123`          | Returns port or null                                          |
| `LicenseService.verifyLicense()`                | `license.service.ts:246`                         | Returns LicenseStatus with tier                               |
| Codex SDK `config` option                       | `node_modules/@openai/codex-sdk/dist/index.d.ts` | Accepts `CodexConfigObject`, flattens to `--config key=value` |

### External Documentation Verified

| CLI     | MCP Config Format                                                               | Source                                                                                                  |
| ------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Copilot | `--additional-mcp-config '{"mcpServers":{"ptah":{"type":"http","url":"..."}}}'` | [GitHub Docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers) |
| Gemini  | `~/.gemini/settings.json` with `mcpServers.ptah.httpUrl` + `trust: true`        | [Gemini CLI Docs](https://geminicli.com/docs/tools/mcp-server/)                                         |
| Codex   | `[mcp_servers.ptah]` in `.codex/config.toml` with `url = "..."`                 | [Codex MCP Docs](https://developers.openai.com/codex/mcp/)                                              |

---

## Architecture Decisions

### Decision 1: Premium Gating Location

**Chosen Approach**: AgentProcessManager resolves premium gating internally

**Rationale**: The AgentProcessManager already reads `ptah.mcpPort` from VS Code config (line 372-374). It should also resolve whether to _use_ that port. This keeps the gating logic centralized rather than requiring every caller (MCP protocol handler, ptah.agent.spawn namespace, future callers) to pass premium status.

**Implementation**: AgentProcessManager will:

1. Inject `LicenseService` (from `@ptah-extension/vscode-core`) - allowed dependency direction (llm-abstraction depends on vscode-core)
2. Read MCP port from CodeExecutionMCP via the existing VS Code workspace state key `ptah.mcp.port` (set by `http-server.handler.ts:69`) - avoids cross-library import of CodeExecutionMCP
3. Only pass `mcpPort` to adapters when BOTH conditions are met: isPremium AND mcpServerRunning

**Evidence**:

- `http-server.handler.ts:69`: `extensionContext.workspaceState.update('ptah.mcp.port', port)` - port stored in workspace state
- `agent-process-manager.service.ts:100-106`: Already injects Logger and CliDetectionService via TOKENS
- `license.service.ts:246`: `verifyLicense()` returns `LicenseStatus` with `tier` field
- Dependency direction: llm-abstraction -> vscode-core is valid per workspace architecture

**Why not extend SpawnAgentRequest**: Adding `isPremium`/`mcpServerRunning` to SpawnAgentRequest would leak premium concerns into the shared types layer, and every caller would need to resolve license status independently. The process manager is the right choke point.

### Decision 2: MCP Server Running Detection

**Chosen Approach**: Read `ptah.mcp.port` from VS Code workspace state

**Rationale**: `CodeExecutionMCP` stores the active port in `extensionContext.workspaceState.update('ptah.mcp.port', port)` when the server starts and clears it on stop. AgentProcessManager can read this via `vscode.workspace` without importing CodeExecutionMCP (which lives in vscode-lm-tools, a higher-layer library).

**Evidence**: `http-server.handler.ts:69` stores port, `http-server.handler.ts:100` clears on stop

### Decision 3: Copilot MCP Format Validation

**Chosen Approach**: The existing `--additional-mcp-config` format is correct per GitHub docs

**Current format** (copilot-cli.adapter.ts:342-348):

```typescript
const mcpConfig = JSON.stringify({
  mcpServers: { ptah: { type: 'http', url: `http://localhost:${mcpPort}` } },
});
args.push('--additional-mcp-config', mcpConfig);
```

**Verified against**: [GitHub Copilot CLI MCP docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers) confirms `mcpServers` object with `type: "http"` and `url` fields.

**Remaining Copilot issue**: The "Permission denied" error in headless `-p` mode. The `--yolo` flag should cover permissions, and `--disable-mcp-server ptah` + `--additional-mcp-config` should bypass the IDE bridge. The issue may be:

- Copilot CLI version too old (needs 0.0.343+ for `--additional-mcp-config`)
- The `--disable-builtin-mcps` flag may also disable `--additional-mcp-config` servers
- Need end-to-end testing to validate

**Action**: Keep the implementation as-is, add version check logging, and test end-to-end.

### Decision 4: Gemini MCP Configuration

**Chosen Approach**: Write to global `~/.gemini/settings.json`

**Rationale**:

- The Gemini adapter already writes globally to `~/.gemini/trustedFolders.json` (line 152-185)
- Consistent pattern: both config writes happen in `~/.gemini/`
- Avoids workspace-level `.gemini/settings.json` that might conflict with user configs
- `trust: true` is appropriate because we control the MCP server (localhost only)
- Non-destructive: reads existing settings, merges the `ptah` server entry, writes back

**Config format** (from [Gemini CLI docs](https://geminicli.com/docs/tools/mcp-server/)):

```json
{
  "mcpServers": {
    "ptah": {
      "httpUrl": "http://localhost:51820",
      "trust": true,
      "timeout": 30000
    }
  }
}
```

**Cleanup**: Remove the `ptah` key from settings.json on extension deactivation (or leave it -- it's harmless since the server won't be running). Recommendation: leave cleanup to a future task; the server being down means Gemini will just fail to connect, which is a no-op.

### Decision 5: Codex MCP Configuration

**Chosen Approach**: Pass MCP config through Codex SDK's `config` option

**Rationale**: The Codex SDK accepts a `config: CodexConfigObject` that "flattens into dotted paths and serializes values as TOML literals." This means we can pass `mcp_servers.ptah.url` directly through the SDK without writing config files.

**Evidence**: `node_modules/@openai/codex-sdk/dist/index.d.ts`:

```typescript
type CodexOptions = {
  config?: CodexConfigObject; // "Additional --config key=value overrides"
};
```

**Implementation**:

```typescript
const codex = new sdk.Codex({
  config: mcpPort
    ? {
        mcp_servers: {
          ptah: { url: `http://localhost:${mcpPort}` },
        },
      }
    : undefined,
});
```

**Fallback**: If SDK config option doesn't work for MCP servers (some SDKs only pass config to the CLI subprocess), write `.codex/config.toml` in the workspace directory as a fallback. The implementation plan includes this fallback path.

### Decision 6: readOnlyHint Annotations

**Chosen Approach**: Include in this task as a quick enhancement

**Rationale**: Adding `annotations.readOnlyHint` to MCP tool definitions is a 30-minute task that improves tool metadata for all consumers (IDE bridge, CLI adapters). The MCP protocol supports `annotations` on tool definitions per the spec.

**Read-only tools** (9 tools that don't modify workspace):

1. `ptah_workspace_analyze` - reads workspace info
2. `ptah_search_files` - searches files
3. `ptah_get_diagnostics` - reads diagnostics
4. `ptah_lsp_references` - reads references
5. `ptah_lsp_definitions` - reads definitions
6. `ptah_get_dirty_files` - reads dirty file list
7. `ptah_count_tokens` - reads token count
8. `ptah_agent_status` - reads agent status
9. `ptah_agent_read` - reads agent output

**NOT read-only** (modify state):

- `execute_code` - can execute arbitrary code
- `approval_prompt` - triggers UI interaction
- `ptah_agent_spawn` - creates agent processes
- `ptah_agent_steer` - sends input to agent
- `ptah_agent_stop` - kills agent process

### Decision 7: SpawnAgentRequest Type Changes

**Chosen Approach**: Do NOT extend SpawnAgentRequest

**Rationale**: Premium status is an infrastructure concern, not a domain concern. SpawnAgentRequest lives in `libs/shared/` (the foundation layer) and should not contain licensing concepts. The AgentProcessManager is the correct place to resolve premium status.

---

## Component Specifications

### Component 1: Premium-Gated mcpPort in AgentProcessManager

**Purpose**: Ensure CLI subagents only receive MCP server config when the user is premium AND the MCP server is running.

**Pattern**: Mirror `SdkQueryOptionsBuilder.buildMcpServers()` two-check gating
**Evidence**: `sdk-query-options-builder.ts:522-560`

**Responsibilities**:

- Inject LicenseService to check premium status
- Read MCP server running state from VS Code workspace state (`ptah.mcp.port`)
- Only pass `mcpPort` to CLI adapters when both checks pass
- Log gating decisions for debugging

**Files Affected**:

- `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts` (MODIFY)

**Implementation Pattern**:

```typescript
// In doSpawnSdk(), replace unconditional mcpPort read (lines 372-374):
// BEFORE:
const mcpPort = vscode.workspace.getConfiguration('ptah').get<number>('mcpPort', 51820);

// AFTER:
const mcpPort = await this.resolveMcpPort();

// New private method:
private async resolveMcpPort(): Promise<number | undefined> {
  // Check 1: Is user premium?
  const licenseStatus = await this.licenseService.verifyLicense();
  const isPremium = licenseStatus.tier === 'pro' || licenseStatus.tier === 'trial_pro'
    || licenseStatus.plan?.isPremium === true;

  if (!isPremium) {
    this.logger.info('[AgentProcessManager] MCP disabled for CLI agents (not premium)');
    return undefined;
  }

  // Check 2: Is MCP server running?
  // CodeExecutionMCP stores active port in workspace state (http-server.handler.ts:69)
  const folders = vscode.workspace.workspaceFolders;
  // Note: workspaceState is on ExtensionContext, not directly available here.
  // Alternative: read from vscode config + health check, or inject ExtensionContext
  const configuredPort = vscode.workspace.getConfiguration('ptah').get<number>('mcpPort', 51820);

  // Quick health check to verify server is actually running
  try {
    const response = await fetch(`http://localhost:${configuredPort}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (response.ok) {
      this.logger.info('[AgentProcessManager] MCP enabled for CLI agent', { port: configuredPort });
      return configuredPort;
    }
  } catch {
    this.logger.info('[AgentProcessManager] MCP server not running, disabling for CLI agent');
    return undefined;
  }

  return undefined;
}
```

**DI Changes**:

- Add `@inject(TOKENS.LICENSE_SERVICE) private readonly licenseService: LicenseService` to constructor
- Import `LicenseService` from `@ptah-extension/vscode-core` (valid dependency direction)

**Quality Requirements**:

- Must not block agent spawning if license check fails (catch and default to no MCP)
- Health check must have a short timeout (1s) to not delay agent spawn
- Must log gating decisions clearly for debugging

### Component 2: Gemini MCP Configuration

**Purpose**: Configure Gemini CLI to connect to Ptah HTTP MCP server via `~/.gemini/settings.json`.

**Pattern**: Same config-write-before-spawn pattern as `ensureFolderTrusted()`
**Evidence**: `gemini-cli.adapter.ts:152-185`

**Responsibilities**:

- Read existing `~/.gemini/settings.json` (preserve user's other settings)
- Merge `ptah` MCP server entry when `mcpPort` is provided
- Remove `ptah` entry when `mcpPort` is not provided (clean state)
- Write back atomically
- Non-fatal on failure (worst case: Gemini runs without MCP tools)

**Files Affected**:

- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/gemini-cli.adapter.ts` (MODIFY)

**Implementation Pattern**:

```typescript
/**
 * Configure Ptah MCP server in ~/.gemini/settings.json.
 * Merges ptah server entry with existing user config.
 * Non-fatal: errors are silently caught.
 */
private async configureMcpServer(mcpPort?: number): Promise<void> {
  try {
    const geminiDir = join(homedir(), '.gemini');
    const settingsPath = join(geminiDir, 'settings.json');

    // Read existing settings (preserve user's other servers/config)
    let settings: Record<string, unknown> = {};
    try {
      const content = await readFile(settingsPath, 'utf8');
      settings = JSON.parse(content) as Record<string, unknown>;
    } catch {
      // File doesn't exist or invalid JSON -- start fresh
    }

    // Ensure mcpServers object exists
    const mcpServers = (settings['mcpServers'] ?? {}) as Record<string, unknown>;

    if (mcpPort) {
      // Add/update ptah MCP server entry
      mcpServers['ptah'] = {
        httpUrl: `http://localhost:${mcpPort}`,
        trust: true,
        timeout: 30000,
      };
    } else {
      // Remove ptah entry (user is not premium or server not running)
      delete mcpServers['ptah'];
    }

    settings['mcpServers'] = mcpServers;

    await mkdir(geminiDir, { recursive: true });
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch {
    // Non-fatal -- worst case, Gemini runs without MCP tools
  }
}
```

**Integration into runSdk()**:

```typescript
async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
  // Existing: Auto-trust workspace folder
  if (options.workingDirectory) {
    await this.ensureFolderTrusted(options.workingDirectory);
  }

  // NEW: Configure MCP server (or clean up if no port)
  await this.configureMcpServer(options.mcpPort);

  // ... rest of existing runSdk implementation
}
```

**Quality Requirements**:

- Must preserve existing user settings (read-merge-write, not overwrite)
- Must handle missing/malformed JSON gracefully
- Must set `trust: true` to bypass confirmation dialogs in headless mode
- Must use `httpUrl` key (NOT `url`) per Gemini CLI docs

### Component 3: Codex MCP Configuration

**Purpose**: Configure Codex SDK to connect to Ptah HTTP MCP server via the SDK `config` option.

**Pattern**: SDK constructor option injection
**Evidence**: `node_modules/@openai/codex-sdk/dist/index.d.ts` - `CodexOptions.config`

**Responsibilities**:

- Pass MCP server config through `Codex({ config: { mcp_servers: { ptah: { url: "..." } } } })` when mcpPort is provided
- Fall back to writing `.codex/config.toml` if SDK config doesn't work

**Files Affected**:

- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts` (MODIFY)

**Implementation Pattern** (primary: SDK config option):

```typescript
async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
  const sdk = await getCodexSdk();

  // Build Codex SDK options with optional MCP config
  const codexOptions: Record<string, unknown> = {};

  if (options.mcpPort) {
    codexOptions['config'] = {
      mcp_servers: {
        ptah: {
          url: `http://localhost:${options.mcpPort}`,
        },
      },
    };
  }

  const codex = new sdk.Codex(codexOptions);
  // ... rest of existing implementation
}
```

**Fallback** (if SDK config doesn't propagate MCP): Write workspace-level `.codex/config.toml`:

```typescript
private async ensureCodexMcpConfig(workingDirectory: string, mcpPort?: number): Promise<void> {
  if (!mcpPort || !workingDirectory) return;
  try {
    const codexDir = join(workingDirectory, '.codex');
    const configPath = join(codexDir, 'config.toml');

    // Only write if file doesn't exist (don't overwrite user config)
    if (existsSync(configPath)) return;

    await mkdir(codexDir, { recursive: true });
    const tomlContent = `# Auto-generated by Ptah for MCP server access
[mcp_servers.ptah]
url = "http://localhost:${mcpPort}"
`;
    await writeFile(configPath, tomlContent, 'utf8');
  } catch {
    // Non-fatal
  }
}
```

**Quality Requirements**:

- Primary path (SDK config) must be tried first
- Fallback (config file) only used if SDK config doesn't work after testing
- Must not overwrite existing user `.codex/config.toml`
- Config file approach should be noted as potentially needing cleanup

### Component 4: Copilot MCP Validation and Fixes

**Purpose**: Validate and fix the existing Copilot MCP implementation that's getting "Permission denied".

**Pattern**: Existing getMcpArgs() pattern
**Evidence**: `copilot-cli.adapter.ts:311-351`

**Responsibilities**:

- Verify `--additional-mcp-config` JSON format matches latest Copilot CLI docs
- Investigate whether `--disable-builtin-mcps` conflicts with `--additional-mcp-config`
- Add Copilot CLI version logging for debugging
- Test end-to-end in headless mode

**Files Affected**:

- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/copilot-cli.adapter.ts` (MODIFY)

**Suspected Issues and Fixes**:

1. **`--disable-builtin-mcps` may disable ALL MCP servers including additional ones**: Test with and without this flag. If it does, remove `--disable-builtin-mcps` and only use targeted `--disable-mcp-server` for specific servers.

2. **Version requirement**: `--additional-mcp-config` requires Copilot CLI >= 0.0.343. Add version check and log a warning if the installed version is too old.

3. **MCP config key validation**: The format `{ mcpServers: { ptah: { type: 'http', url: '...' } } }` should be verified against the exact Copilot CLI version being used. Some versions may expect `servers` instead of `mcpServers`.

**Implementation changes**:

```typescript
// In getMcpArgs(), replace --disable-builtin-mcps approach:
// BEFORE: args push '--disable-builtin-mcps' always
// AFTER: Only disable specific known-problematic servers

private getMcpArgs(workingDirectory?: string, mcpPort?: number): string[] {
  const serverNames = new Set<string>();

  // Disable the Ptah IDE MCP server (VS Code permission layer blocks headless use)
  serverNames.add('ptah');

  // Collect other MCP servers from config files to disable them
  if (workingDirectory) {
    this.collectServerNames(join(workingDirectory, '.mcp.json'), 'mcpServers', serverNames);
    this.collectServerNames(join(workingDirectory, '.vscode', 'mcp.json'), 'servers', serverNames);
  }

  const args: string[] = [];
  for (const name of serverNames) {
    args.push('--disable-mcp-server', name);
  }

  // Re-add Ptah MCP as direct HTTP connection (bypasses IDE bridge)
  if (mcpPort) {
    const mcpConfig = JSON.stringify({
      mcpServers: {
        ptah: { type: 'http', url: `http://localhost:${mcpPort}` },
      },
    });
    args.push('--additional-mcp-config', mcpConfig);
  }

  return args;
}
```

**Key change**: Remove `--disable-builtin-mcps` from the main arg list (lines 91, 216) and instead only use per-server `--disable-mcp-server` disabling. `--disable-builtin-mcps` is too aggressive and may prevent `--additional-mcp-config` from working.

### Component 5: readOnlyHint Annotations on MCP Tool Definitions

**Purpose**: Add MCP protocol `annotations.readOnlyHint` metadata to tool definitions to help LLM clients understand which tools are safe to call without side effects.

**Pattern**: MCP protocol tool annotations
**Evidence**: No existing annotations in the codebase (verified: grep for `readOnlyHint` found 0 matches)

**Responsibilities**:

- Add `annotations?: { readOnlyHint?: boolean }` to `MCPToolDefinition` type
- Set `readOnlyHint: true` on 9 read-only tools
- Include annotations in tools/list MCP response

**Files Affected**:

- `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts` (MODIFY - add annotations to MCPToolDefinition)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/tool-description.builder.ts` (MODIFY - add annotations to 9 tools)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/protocol-handlers.ts` (MODIFY - include annotations in tools/list response)

**Implementation Pattern**:

```typescript
// In types.ts - extend MCPToolDefinition:
export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

// In tool-description.builder.ts - add to each read-only tool:
export function buildWorkspaceAnalyzeTool(): MCPToolDefinition {
  return {
    name: 'ptah_workspace_analyze',
    description: '...',
    inputSchema: { ... },
    annotations: { readOnlyHint: true },
  };
}
```

**Quality Requirements**:

- Only add `readOnlyHint: true` to genuinely read-only tools
- Must include annotations in the MCP `tools/list` response (protocol-handlers.ts)
- Should not break existing MCP protocol communication

---

## Integration Architecture

### Data Flow: Premium-Gated MCP Port

```
User clicks "Send" in Chat UI
  --> chat-rpc.handlers.ts: resolves isPremium + mcpServerRunning
  --> SdkQueryOptionsBuilder.build(): passes to Claude SDK (existing flow)

Claude SDK spawns subagent via ptah_agent_spawn MCP tool
  --> protocol-handlers.ts: calls ptahAPI.agent.spawn()
  --> AgentProcessManager.spawn()
    --> doSpawnSdk():
      1. NEW: resolveMcpPort() checks premium + MCP running
      2. Passes mcpPort (or undefined) to adapter.runSdk(options)
    --> CLI Adapter:
      - Copilot: getMcpArgs() uses mcpPort for --additional-mcp-config
      - Gemini: configureMcpServer() writes settings.json, uses mcpPort
      - Codex: passes config to SDK constructor with mcp_servers
```

### Dependency Flow

```
AgentProcessManager (llm-abstraction)
  imports: LicenseService (vscode-core)     -- valid: llm-abstraction -> vscode-core
  reads: vscode.workspace state              -- valid: VS Code API
  does NOT import: CodeExecutionMCP          -- correct: avoids vscode-lm-tools dependency

CLI Adapters (llm-abstraction)
  use: CliCommandOptions.mcpPort             -- existing interface
  write: config files via Node.js fs         -- no new dependencies
```

---

## Implementation Tasks

### Phase 1: Premium Gating in AgentProcessManager

**Task 1.1**: Add LicenseService injection to AgentProcessManager

- File: `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts`
- Add `@inject(TOKENS.LICENSE_SERVICE) private readonly licenseService: LicenseService` to constructor
- Import `LicenseService` from `@ptah-extension/vscode-core`
- Import `TOKENS` from `@ptah-extension/vscode-core` (already imported for LOGGER)

**Task 1.2**: Create `resolveMcpPort()` private method

- File: `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts`
- Implement premium check (tier === 'pro' || 'trial_pro' || plan.isPremium)
- Implement health check against `http://localhost:{configuredPort}/health`
- 1-second timeout on health check
- Log gating decision
- Return `number | undefined`

**Task 1.3**: Replace unconditional mcpPort read in doSpawnSdk()

- File: `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts`
- Replace lines 372-374 (unconditional config read) with `await this.resolveMcpPort()`
- Also apply to the CLI subprocess path in `doSpawn()` (non-SDK path, line 230-236)

**Task 1.4**: Register LicenseService token for AgentProcessManager DI

- File: `apps/ptah-extension-vscode/src/di/container.ts` (verify LICENSE_SERVICE token is registered)
- The token should already exist since chat-rpc.handlers.ts uses it

### Phase 2: Gemini MCP Configuration

**Task 2.1**: Add `configureMcpServer()` method to GeminiCliAdapter

- File: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/gemini-cli.adapter.ts`
- Read existing `~/.gemini/settings.json`
- Merge/remove `ptah` MCP server entry based on mcpPort presence
- Write back with `JSON.stringify(settings, null, 2)`
- Wrap in try/catch (non-fatal)

**Task 2.2**: Call `configureMcpServer()` in GeminiCliAdapter.runSdk()

- File: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/gemini-cli.adapter.ts`
- Call after `ensureFolderTrusted()`, before building spawn args
- Pass `options.mcpPort`

### Phase 3: Codex MCP Configuration

**Task 3.1**: Pass MCP config through Codex SDK `config` option

- File: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts`
- Build `CodexOptions` with `config.mcp_servers.ptah.url` when mcpPort provided
- Pass to `new sdk.Codex(codexOptions)` constructor

**Task 3.2**: Update local CodexSdkModule interface to include config option

- File: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts`
- Update `CodexSdkModule.Codex` constructor type to accept `config?: Record<string, unknown>`
- This is already partially typed but may need `config` added

**Task 3.3** (fallback, only if Task 3.1 doesn't work after testing): Write `.codex/config.toml`

- File: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts`
- Add `ensureCodexMcpConfig()` method
- Write TOML config to workspace `.codex/config.toml` only if file doesn't exist
- Call before SDK initialization

### Phase 4: Copilot MCP Fixes

**Task 4.1**: Remove `--disable-builtin-mcps` from Copilot adapter

- File: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/copilot-cli.adapter.ts`
- Remove `'--disable-builtin-mcps'` from both `buildCommand()` (line 90) and `runSdk()` (line 216)
- The per-server `--disable-mcp-server` args from `getMcpArgs()` are sufficient and more targeted

**Task 4.2**: Add version check logging for Copilot CLI

- File: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/copilot-cli.adapter.ts`
- In `detect()`, log the detected version prominently
- If version is parseable and < 0.0.343, log a warning about `--additional-mcp-config` support

**Task 4.3**: End-to-end test Copilot MCP flow

- Manual testing task (not a code change)
- Spawn Copilot with mcpPort set
- Verify Copilot can call ptah_workspace_analyze via HTTP MCP
- Check for "Permission denied" errors in stderr output

### Phase 5: readOnlyHint Annotations

**Task 5.1**: Add `annotations` field to MCPToolDefinition type

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts`
- Add `annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean; }`

**Task 5.2**: Add `readOnlyHint: true` to 9 read-only tool builders

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/tool-description.builder.ts`
- Add `annotations: { readOnlyHint: true }` to:
  - `buildWorkspaceAnalyzeTool()`
  - `buildSearchFilesTool()`
  - `buildGetDiagnosticsTool()`
  - `buildLspReferencesTool()`
  - `buildLspDefinitionsTool()`
  - `buildGetDirtyFilesTool()`
  - `buildCountTokensTool()`
  - `buildAgentStatusTool()`
  - `buildAgentReadTool()`

**Task 5.3**: Include annotations in tools/list MCP response

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/protocol-handlers.ts`
- Verify the tools/list response handler includes the `annotations` field from tool definitions
- May already work if the tool definitions are spread into the response object

---

## Files Affected Summary

### MODIFY

| File                                                                                           | Changes                                                                                   |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts`               | Add LicenseService injection, resolveMcpPort() method, replace unconditional mcpPort read |
| `libs/backend/llm-abstraction/src/lib/services/cli-adapters/gemini-cli.adapter.ts`             | Add configureMcpServer() method, call from runSdk()                                       |
| `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts`              | Pass MCP config through SDK constructor, update local types                               |
| `libs/backend/llm-abstraction/src/lib/services/cli-adapters/copilot-cli.adapter.ts`            | Remove --disable-builtin-mcps, add version logging                                        |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts`                                 | Add annotations field to MCPToolDefinition                                                |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/tool-description.builder.ts` | Add readOnlyHint to 9 tools                                                               |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/protocol-handlers.ts`        | Include annotations in tools/list response                                                |

### NO NEW FILES

All changes are modifications to existing files. No new files needed.

---

## Risk Assessment

### Risk 1: Copilot `--additional-mcp-config` Still Fails (HIGH)

**What could go wrong**: The "Permission denied" error may not be caused by the MCP config format. It could be a deeper Copilot CLI issue with headless mode permissions.

**Mitigation**:

- Task 4.1 removes `--disable-builtin-mcps` which may be the actual culprit
- Task 4.2 adds version logging to identify incompatible CLI versions
- Task 4.3 provides end-to-end testing
- Worst case: Copilot CLI may not support MCP in headless `-p` mode at all (known GitHub issue #1040)

**Fallback**: If Copilot MCP cannot be made to work in headless mode, document the limitation and rely on Copilot's built-in tools instead.

### Risk 2: Gemini settings.json Conflicts (MEDIUM)

**What could go wrong**: User may have their own `~/.gemini/settings.json` with MCP servers configured. Our merge logic could corrupt their settings if the JSON structure is unexpected.

**Mitigation**:

- Read-merge-write pattern preserves all existing keys
- Only touches `mcpServers.ptah` key
- Non-fatal: failure to write settings means Gemini runs without Ptah MCP (acceptable degradation)
- JSON.parse errors handled gracefully (start with fresh object)

### Risk 3: Codex SDK `config` Option May Not Support MCP (MEDIUM)

**What could go wrong**: The `config` option may only pass CLI flags like `--config model=...` and not support nested `mcp_servers` config. The SDK documentation is sparse.

**Mitigation**:

- Task 3.3 provides a fallback: write `.codex/config.toml` in workspace
- The fallback is known to work (Codex CLI reads `.codex/config.toml` from working directory)
- Testing will determine which approach works

### Risk 4: Health Check Adds Latency to Agent Spawn (LOW)

**What could go wrong**: The `fetch()` health check to `localhost:51820/health` adds 0-1000ms to every agent spawn.

**Mitigation**:

- 1-second timeout ensures worst case is bounded
- Health check only runs for premium users (free tier skips it entirely)
- localhost fetch is typically < 10ms
- Could cache the result for 30 seconds if latency is noticeable

### Risk 5: LicenseService.verifyLicense() Cache Miss on First Spawn (LOW)

**What could go wrong**: First agent spawn after extension activation may trigger a full license verification (network call to license server). This adds 0-5 seconds.

**Mitigation**:

- LicenseService has 1-hour cache
- By the time a user spawns an agent, the license has almost certainly been verified already (activation flow)
- `getCachedStatus()` could be used as a fast path (no network call) with verifyLicense() as fallback
- Recommendation: Use `getCachedStatus()` first, fall back to `verifyLicense()` only if cache is null

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- All changes are in backend libraries (llm-abstraction, vscode-lm-tools, vscode-core)
- No frontend/UI changes
- Requires understanding of DI patterns, cross-platform file I/O, MCP protocol
- Requires testing with actual CLI tools installed

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 4-6 hours

**Breakdown**:

- Phase 1 (Premium gating): 1.5 hours -- DI wiring, health check, logging
- Phase 2 (Gemini config): 1 hour -- config read-merge-write, integration
- Phase 3 (Codex config): 1 hour -- SDK option injection, fallback path
- Phase 4 (Copilot fixes): 0.5 hours -- flag removal, version logging
- Phase 5 (readOnlyHint): 0.5 hours -- type extension, 9 tool annotations
- Testing: 0.5-1 hour -- manual end-to-end testing with CLIs

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **All imports exist in codebase**:

   - `LicenseService` from `@ptah-extension/vscode-core` (verified: `license.service.ts`)
   - `TOKENS.LICENSE_SERVICE` from `@ptah-extension/vscode-core` (verify in `di/tokens.ts`)
   - `readFile`, `writeFile`, `mkdir` from `fs/promises` (already imported in gemini adapter)

2. **All patterns verified from examples**:

   - Premium check pattern: `chat-rpc.handlers.ts:90-93`
   - Config write pattern: `gemini-cli.adapter.ts:152-185`
   - SDK option passing pattern: `codex-cli.adapter.ts:211-214`

3. **DI token exists**:

   - Verify `TOKENS.LICENSE_SERVICE` exists in `libs/backend/vscode-core/src/di/tokens.ts`
   - If not, it needs to be added

4. **No hallucinated APIs**:
   - `LicenseService.verifyLicense()`: verified at `license.service.ts:246`
   - `LicenseService.getCachedStatus()`: verified at `license.service.ts:584`
   - `LicenseStatus.tier`: verified at `license.service.ts:87`
   - `LicenseStatus.plan.isPremium`: verified at `license.service.ts:93`
   - `CodexOptions.config`: verified in SDK type definitions

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined per component
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended (backend-developer)
- [x] Complexity assessed (MEDIUM, 4-6 hours)
- [x] No step-by-step implementation (team-leader decomposes into atomic tasks)
- [x] Risk assessment with mitigations
