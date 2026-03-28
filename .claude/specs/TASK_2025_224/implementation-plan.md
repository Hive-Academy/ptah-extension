# Implementation Plan - TASK_2025_224: Fix Platform Abstraction Gaps

## Codebase Investigation Summary

### Gap 1: AgentProcessManagerService (llm-abstraction)

**File**: `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts`

**All `vscode.*` usages found** (8 call sites across 5 methods):

| Line      | Call                                                                                                 | Purpose                                        |
| --------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 155-158   | `vscode.workspace.getConfiguration('ptah.agentOrchestration').get<string>(effortKey)`                | Resolve per-CLI reasoning effort               |
| 165-167   | `vscode.workspace.getConfiguration('ptah.agentOrchestration').get<boolean>('copilotAutoApprove')`    | Resolve auto-approve setting                   |
| 312-321   | `vscode.workspace.getConfiguration('ptah.agentOrchestration').get<string>(configKey)`                | Resolve model for CLI subprocess path          |
| 463-475   | `vscode.workspace.getConfiguration('ptah.agentOrchestration').get<string>(configKey)`                | Resolve model for SDK path (duplicate pattern) |
| 1323-1324 | `vscode.workspace.getConfiguration('ptah.agentOrchestration').get<number>('maxConcurrentAgents', 5)` | Get max concurrent agents limit                |
| 1329-1330 | `vscode.workspace.getConfiguration('ptah.agentOrchestration').get<string>('defaultCli')`             | Get preferred CLI                              |
| 1379-1383 | `vscode.workspace.workspaceFolders[0].uri.fsPath`                                                    | Get workspace root                             |
| 1463-1465 | `vscode.workspace.getConfiguration('ptah').get<number>('mcpPort', 51820)`                            | Get MCP port configuration                     |

**Existing pattern to follow**: 20+ services already inject `PLATFORM_TOKENS.WORKSPACE_PROVIDER` and use `IWorkspaceProvider.getConfiguration()` and `getWorkspaceRoot()`. The `IWorkspaceProvider` interface already provides exact replacements for all 8 call sites.

**DI Registration**: `AgentProcessManager` is registered as a singleton at `TOKENS.AGENT_PROCESS_MANAGER` in `libs/backend/llm-abstraction/src/lib/di/register.ts:72-75`. The constructor currently injects `TOKENS.LOGGER`, `TOKENS.CLI_DETECTION_SERVICE`, `TOKENS.LICENSE_SERVICE`, and `TOKENS.SUBAGENT_REGISTRY_SERVICE`.

### Gap 2: CopilotAuthService (agent-sdk)

**File**: `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-auth.service.ts`

**All `vscode.*` usages found** (5 call sites):

| Line  | Call                                                                          | Purpose                                                |
| ----- | ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| 16    | `import * as vscode from 'vscode'`                                            | Top-level import                                       |
| 32-35 | `vscode.extensions.getExtension('ptah-extensions.ptah-extension-vscode')`     | Get extension version for User-Agent header            |
| 163   | `vscode.version`                                                              | Get VS Code version for Editor-Version header          |
| 194   | `vscode.authentication.getSession('github', ['copilot'], { createIfNone })`   | Core auth: Get GitHub OAuth session                    |
| 212   | `vscode.authentication.getSession('github', ['read:user'], { createIfNone })` | Fallback auth: Get GitHub session with read:user scope |

**Reference pattern**: `CodexAuthService` (`libs/backend/agent-sdk/src/lib/codex-provider/codex-auth.service.ts`) is the exact pattern to follow. It has ZERO `vscode` imports and uses file-based auth (`~/.codex/auth.json`) with OAuth token refresh via HTTP. It implements `ICodexAuthService` interface and is fully platform-agnostic.

**Copilot token file locations** (from research document at `.claude/specs/research-copilot-api-integration.md:218-241`):

- Linux/macOS: `~/.config/github-copilot/hosts.json`
- Windows: `%LOCALAPPDATA%/github-copilot/hosts.json`
- XDG override: `$XDG_CONFIG_HOME/github-copilot/hosts.json`
- File format: `{ "github.com": { "oauth_token": "gho_xxxxxxxxxxxx" } }`

**GitHub Device Code OAuth Flow** (standard RFC 8628):

1. POST `https://github.com/login/device/code` with `client_id` and `scope=copilot`
2. Display `user_code` and `verification_uri` to user
3. Poll `https://github.com/login/oauth/access_token` until user completes browser auth
4. Receive `access_token`, exchange for Copilot bearer token via existing `exchangeToken()` method

**Consumers of `ICopilotAuthService`**: Injected via `SDK_TOKENS.SDK_COPILOT_AUTH` in:

- `CopilotTranslationProxy` (copilot-translation-proxy.ts:27)
- `AuthManager` (helpers/auth-manager.ts:82)
- Both consume only the `ICopilotAuthService` interface methods: `login()`, `isAuthenticated()`, `getAuthState()`, `getHeaders()`, `logout()`

### Gap 3: TokenCounterService (workspace-intelligence)

**File**: `libs/backend/workspace-intelligence/src/services/token-counter.service.ts`

**All `vscode.*` usages found** (2 call sites):

| Line    | Call                                                                            | Purpose                                  |
| ------- | ------------------------------------------------------------------------------- | ---------------------------------------- |
| 80-82   | `vscode.lm.selectChatModels({ vendor: 'copilot' })` → `model.countTokens(text)` | Native token counting via VS Code LM API |
| 160-161 | `vscode.lm.selectChatModels({ vendor: 'copilot' })` → `model.maxInputTokens`    | Get model max input tokens               |

**Consumers** (injected via `TOKENS.TOKEN_COUNTER_SERVICE`):

- `WorkspaceIndexerService` (file-indexing/workspace-indexer.service.ts:78)
- `ContextSizeOptimizerService` (context-analysis/context-size-optimizer.service.ts:164)
- `ContextEnrichmentService` (context-analysis/context-enrichment.service.ts:57)
- `PtahApiBuilderService` (vscode-lm-tools, code-execution/ptah-api-builder.service.ts:145)

**Current fallback**: Already has `estimateTokens()` method using `Math.ceil(text.length / 4)` heuristic. The service wraps native counting in try/catch and falls back to estimation.

**NPM package options**: `gpt-tokenizer` (v3.4.0, pure JS, no native deps, supports GPT-2/3/4 BPE tokenizer, has both ESM and CJS exports). This is the recommended choice because:

- Pure JavaScript (no native binary compilation like tiktoken)
- Works identically on VS Code, Electron, and any Node.js runtime
- Accurate BPE tokenizer (not heuristic estimation)
- Maintained and actively developed

### Existing Platform Abstraction Architecture (Evidence)

**Pattern**: Interface in `platform-core` + Token in `platform-core/tokens.ts` + VS Code impl in `platform-vscode` + Electron impl in `platform-electron`

**Interfaces discovered** (8 files in `libs/backend/platform-core/src/interfaces/`):

- `workspace-provider.interface.ts` - IWorkspaceProvider (already exists, covers Gap 1)
- `secret-storage.interface.ts` - ISecretStorage
- `state-storage.interface.ts` - IStateStorage
- `file-system-provider.interface.ts` - IFileSystemProvider
- `user-interaction.interface.ts` - IUserInteraction
- `output-channel.interface.ts` - IOutputChannel
- `command-registry.interface.ts` - ICommandRegistry
- `editor-provider.interface.ts` - IEditorProvider

**Tokens**: 10 tokens in `PLATFORM_TOKENS` (tokens.ts:11-41)

**VS Code implementations**: 9 files in `libs/backend/platform-vscode/src/implementations/`

**Electron implementations**: 8 files in `libs/backend/platform-electron/src/implementations/`

**Registration**: `registerPlatformVscodeServices()` in `libs/backend/platform-vscode/src/registration.ts` and `registerPlatformElectronServices()` in `libs/backend/platform-electron/src/registration.ts`

**VS Code Shim**: `apps/ptah-electron/src/shims/vscode-shim.ts` already shims `vscode.lm.selectChatModels` (line 168-170, returns `[]`), `vscode.authentication.getSession` (line 130, returns `undefined`), `vscode.workspace.getConfiguration` (line 71-78, returns `undefined` for all gets), and `vscode.workspace.workspaceFolders` (line 79, returns `undefined`). These shims prevent crashes but give no-op/undefined behavior. The platform abstraction fix will make these shims unnecessary for the 3 services.

---

## Architecture Decisions

### Decision 1: AgentProcessManagerService - Inject IWorkspaceProvider

**Approach**: Add `@inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER) private readonly workspace: IWorkspaceProvider` to the constructor and replace all 8 `vscode.*` call sites with `IWorkspaceProvider` methods.

**Rationale**: The `IWorkspaceProvider` interface (already at `libs/backend/platform-core/src/interfaces/workspace-provider.interface.ts`) provides exact drop-in replacements:

- `vscode.workspace.workspaceFolders[0].uri.fsPath` -> `this.workspace.getWorkspaceRoot()`
- `vscode.workspace.getConfiguration(section).get(key, default)` -> `this.workspace.getConfiguration(section, key, default)`

**Evidence**: 20+ services already use this pattern (e.g., `WorkspaceService` at workspace-intelligence/workspace.service.ts:161, `ChatRpcHandlers` at rpc-handlers/chat-rpc.handlers.ts:99).

**Risk**: LOW. Pure mechanical replacement. Both VS Code and Electron already have `IWorkspaceProvider` registered.

### Decision 2: CopilotAuthService - File-Based + Device Code Flow

**Approach**: Rewrite `CopilotAuthService` to follow the `CodexAuthService` pattern:

1. **Primary**: Read GitHub token from `~/.config/github-copilot/hosts.json` (cross-platform paths)
2. **Fallback (Electron)**: Implement GitHub Device Code OAuth flow (RFC 8628) for users who have no token file
3. **VS Code enhancement**: In VS Code, try `vscode.authentication.getSession()` first (better UX), then fall back to file-based

**Architecture**: Split into a platform-agnostic `CopilotAuthService` (file + device code) and a `VscodeCopilotAuthService` subclass that adds VS Code native auth. The `ICopilotAuthService` interface remains unchanged.

**This matches the existing strategy**: The `CopilotAuthState` type and `ICopilotAuthService` interface (at `copilot-provider.types.ts:88-99`) already define the contract. Only the implementation changes.

**Evidence**: CodexAuthService (codex-auth.service.ts) proves this pattern works - it reads from `~/.codex/auth.json`, refreshes tokens via HTTP, and has zero VS Code imports.

**Risk**: MEDIUM. Device code flow is new code. Token file path resolution is cross-platform. But the pattern is proven by CodexAuthService and the token exchange logic (`exchangeToken()`) is already working and stays unchanged.

### Decision 3: TokenCounterService - ITokenCounter Interface + gpt-tokenizer

**Approach**:

1. Create `ITokenCounter` interface in `platform-core` with `countTokens()` and `getMaxInputTokens()` methods
2. Add `PLATFORM_TOKENS.TOKEN_COUNTER` token
3. VS Code implementation wraps `vscode.lm.selectChatModels()` (existing behavior)
4. Platform-agnostic fallback uses `gpt-tokenizer` npm package (pure JS BPE tokenizer)
5. Refactor `TokenCounterService` to inject `ITokenCounter` instead of calling `vscode.lm` directly

**Why `gpt-tokenizer` over `js-tiktoken`**: `gpt-tokenizer` is pure JavaScript with no WASM or native dependencies, making it reliable across all platforms (VS Code, Electron, CI). It provides accurate BPE tokenization for GPT-2/3/4 models, which is close enough for Claude token estimation (within ~5% of cl100k_base). The `js-tiktoken` package also works but `gpt-tokenizer` has better CJS/ESM dual support.

**Risk**: LOW. The `TokenCounterService` already has fallback estimation. Adding a proper npm tokenizer just improves accuracy. The VS Code LM API path continues working when available.

### Decision 4: No New Platform Interfaces for Gap 2 (CopilotAuth)

**Rationale**: The CopilotAuthService does NOT need a new platform interface in `platform-core`. Unlike workspace access or file system operations which are fundamentally platform-specific, GitHub authentication is a standard HTTP + file-based flow that works identically on all platforms.

The correct fix is to make `CopilotAuthService` itself platform-agnostic (like `CodexAuthService`), with VS Code getting a thin subclass that adds native auth as a convenience. No new `PLATFORM_TOKENS` entry needed.

---

## Batched Implementation Plan

### Batch 1: AgentProcessManagerService - IWorkspaceProvider Injection

**Dependencies**: None (uses existing infrastructure)
**Risk**: LOW
**Estimated Effort**: 1-2 hours

**Files to modify**:

#### 1.1 `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts`

**Change**: Add IWorkspaceProvider injection, replace all 8 vscode.\* call sites

**Constructor change**:

```typescript
// ADD import
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

// MODIFY constructor - add 5th parameter
constructor(
  @inject(TOKENS.LOGGER) private readonly logger: Logger,
  @inject(TOKENS.CLI_DETECTION_SERVICE) private readonly cliDetection: CliDetectionService,
  @inject(TOKENS.LICENSE_SERVICE) private readonly licenseService: LicenseService,
  @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE) private readonly subagentRegistry: SubagentRegistryService,
  @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER) private readonly workspace: IWorkspaceProvider,
) {
```

**8 replacement sites**:

1. **Line 155-158** (`resolveReasoningEffort`):

```typescript
// BEFORE:
const effort = vscode.workspace.getConfiguration('ptah.agentOrchestration').get<string>(effortKey, '');
// AFTER:
const effort = this.workspace.getConfiguration<string>('ptah.agentOrchestration', effortKey, '') ?? '';
```

2. **Line 165-167** (`resolveAutoApprove`):

```typescript
// BEFORE:
return vscode.workspace.getConfiguration('ptah.agentOrchestration').get<boolean>('copilotAutoApprove', true);
// AFTER:
return this.workspace.getConfiguration<boolean>('ptah.agentOrchestration', 'copilotAutoApprove', true);
```

3. **Line 312-321** (model resolution in doSpawn - CLI path):

```typescript
// BEFORE:
const agentConfig = vscode.workspace.getConfiguration('ptah.agentOrchestration');
const configuredModel = agentConfig.get<string>(configKey, '');
// AFTER:
const configuredModel = this.workspace.getConfiguration<string>('ptah.agentOrchestration', configKey, '') ?? '';
```

4. **Line 463-475** (model resolution in SDK path):

```typescript
// BEFORE:
const agentConfig = vscode.workspace.getConfiguration('ptah.agentOrchestration');
const configuredModel = agentConfig.get<string>(configKey, '');
// AFTER:
const configuredModel = this.workspace.getConfiguration<string>('ptah.agentOrchestration', configKey, '') ?? '';
```

5. **Line 1323-1324** (`getMaxConcurrentAgents`):

```typescript
// BEFORE:
const config = vscode.workspace.getConfiguration('ptah.agentOrchestration');
return config.get<number>('maxConcurrentAgents', 5);
// AFTER:
return this.workspace.getConfiguration<number>('ptah.agentOrchestration', 'maxConcurrentAgents', 5) ?? 5;
```

6. **Line 1329-1330** (`getDefaultCli`):

```typescript
// BEFORE:
const config = vscode.workspace.getConfiguration('ptah.agentOrchestration');
const preferred = config.get<string>('defaultCli');
// AFTER:
const preferred = this.workspace.getConfiguration<string>('ptah.agentOrchestration', 'defaultCli');
```

7. **Line 1379-1383** (`getWorkspaceRoot`):

```typescript
// BEFORE:
const folders = vscode.workspace.workspaceFolders;
if (folders && folders.length > 0) {
  return folders[0].uri.fsPath;
}
return process.cwd();
// AFTER:
return this.workspace.getWorkspaceRoot() ?? process.cwd();
```

8. **Line 1463-1465** (`resolveMcpPort`):

```typescript
// BEFORE:
const configuredPort = vscode.workspace.getConfiguration('ptah').get<number>('mcpPort', 51820);
// AFTER:
const configuredPort = this.workspace.getConfiguration<number>('ptah', 'mcpPort', 51820) ?? 51820;
```

**Final cleanup**: Remove `import * as vscode from 'vscode'` (line 15). This should be the ONLY vscode import in the file.

#### 1.2 Verify no DI registration changes needed

The `AgentProcessManager` is registered as a singleton class (`container.registerSingleton(TOKENS.AGENT_PROCESS_MANAGER, AgentProcessManager)` at register.ts:72-75). tsyringe will automatically resolve the new `@inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)` parameter since `PLATFORM_TOKENS.WORKSPACE_PROVIDER` is registered in Phase 0 of both VS Code and Electron containers. **No DI registration changes needed**.

---

### Batch 2: TokenCounterService - ITokenCounter Abstraction + gpt-tokenizer

**Dependencies**: None (independent of Batch 1)
**Risk**: LOW
**Estimated Effort**: 2-3 hours

#### 2.1 Install `gpt-tokenizer` dependency

```bash
npm install gpt-tokenizer
```

Add to `package.json` dependencies. This is a pure JS package with no native bindings.

#### 2.2 Create `ITokenCounter` interface in `platform-core`

**Create**: `libs/backend/platform-core/src/interfaces/token-counter.interface.ts`

```typescript
/**
 * ITokenCounter - Platform-agnostic token counting interface.
 *
 * Replaces: vscode.lm.selectChatModels() -> model.countTokens()
 *
 * VS Code: Uses native VS Code LM API for accurate model-specific counting.
 * Electron/Other: Uses gpt-tokenizer npm package for BPE tokenization.
 */
export interface ITokenCounter {
  /**
   * Count tokens in the given text.
   *
   * @param text - Text to tokenize
   * @returns Token count
   */
  countTokens(text: string): Promise<number>;

  /**
   * Get the maximum input token count for the active model.
   *
   * @returns Max input tokens, or null if unknown
   */
  getMaxInputTokens(): Promise<number | null>;
}
```

#### 2.3 Add `PLATFORM_TOKENS.TOKEN_COUNTER` token

**Modify**: `libs/backend/platform-core/src/tokens.ts`

```typescript
// ADD after PLATFORM_INFO token (line 40):
/** ITokenCounter — platform-agnostic token counting */
TOKEN_COUNTER: Symbol.for('PlatformTokenCounter'),
```

#### 2.4 Export new interface from `platform-core`

**Modify**: `libs/backend/platform-core/src/index.ts`

```typescript
// ADD:
export type { ITokenCounter } from './interfaces/token-counter.interface';
```

#### 2.5 Create VS Code token counter implementation

**Create**: `libs/backend/platform-vscode/src/implementations/vscode-token-counter.ts`

```typescript
/**
 * VscodeTokenCounter - ITokenCounter implementation using VS Code LM API.
 *
 * Uses vscode.lm.selectChatModels() for accurate model-specific token counting.
 * Falls back to gpt-tokenizer if no models available.
 */
import * as vscode from 'vscode';
import type { ITokenCounter } from '@ptah-extension/platform-core';
import { encode } from 'gpt-tokenizer';

export class VscodeTokenCounter implements ITokenCounter {
  async countTokens(text: string): Promise<number> {
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      if (models.length > 0) {
        return await models[0].countTokens(text);
      }
    } catch {
      // VS Code LM API unavailable, fall through to gpt-tokenizer
    }
    return encode(text).length;
  }

  async getMaxInputTokens(): Promise<number | null> {
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      if (models.length > 0) {
        return models[0].maxInputTokens;
      }
    } catch {
      // VS Code LM API unavailable
    }
    return null;
  }
}
```

#### 2.6 Create Electron/fallback token counter implementation

**Create**: `libs/backend/platform-electron/src/implementations/electron-token-counter.ts`

```typescript
/**
 * ElectronTokenCounter - ITokenCounter implementation using gpt-tokenizer.
 *
 * Pure JavaScript BPE tokenizer. No VS Code dependency.
 * Provides accurate GPT-4 tokenization (~5% margin vs cl100k_base for Claude).
 */
import type { ITokenCounter } from '@ptah-extension/platform-core';
import { encode } from 'gpt-tokenizer';

export class ElectronTokenCounter implements ITokenCounter {
  async countTokens(text: string): Promise<number> {
    return encode(text).length;
  }

  async getMaxInputTokens(): Promise<number | null> {
    // No model discovery available outside VS Code.
    // Return null — callers already handle null (use default budget).
    return null;
  }
}
```

#### 2.7 Register VS Code token counter

**Modify**: `libs/backend/platform-vscode/src/registration.ts`

```typescript
// ADD import:
import { VscodeTokenCounter } from './implementations/vscode-token-counter';

// ADD registration (after Editor Provider, before closing brace):
// Token Counter
container.register(PLATFORM_TOKENS.TOKEN_COUNTER, {
  useValue: new VscodeTokenCounter(),
});
```

#### 2.8 Register Electron token counter

**Modify**: `libs/backend/platform-electron/src/registration.ts`

```typescript
// ADD import:
import { ElectronTokenCounter } from './implementations/electron-token-counter';

// ADD registration (after Editor Provider registration, line 154):
// Token Counter
container.register(PLATFORM_TOKENS.TOKEN_COUNTER, {
  useValue: new ElectronTokenCounter(),
});
```

#### 2.9 Refactor `TokenCounterService` to use `ITokenCounter`

**Modify**: `libs/backend/workspace-intelligence/src/services/token-counter.service.ts`

Replace the vscode import and native counting with ITokenCounter injection:

```typescript
/**
 * Token Counter Service
 *
 * Provides token counting using platform-agnostic ITokenCounter abstraction.
 * VS Code: Uses native LM API. Electron: Uses gpt-tokenizer.
 * Includes LRU caching for repeated counts.
 */
import { injectable, inject } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { ITokenCounter } from '@ptah-extension/platform-core';

// (Remove: import * as vscode from 'vscode')

@injectable()
export class TokenCounterService {
  private cache = new Map<string, CacheEntry>();
  private readonly cacheMaxSize = 1000;
  private readonly cacheTTL = 300000; // 5 minutes

  constructor(
    @inject(PLATFORM_TOKENS.TOKEN_COUNTER)
    private readonly tokenCounter: ITokenCounter,
  ) {}

  async countTokens(text: string, cacheKey?: string): Promise<number> {
    // Check cache first
    if (cacheKey) {
      const cached = this.getCached(cacheKey);
      if (cached !== null) return cached;
    }

    const count = await this.tokenCounter.countTokens(text);

    if (cacheKey) {
      this.setCached(cacheKey, count);
    }
    return count;
  }

  async getMaxInputTokens(): Promise<number | null> {
    return this.tokenCounter.getMaxInputTokens();
  }

  // getCached(), setCached(), clearCache(), dispose() remain UNCHANGED
}
```

The private `countTokensNative()` and `estimateTokens()` methods are removed since the `ITokenCounter` implementation handles the native-vs-fallback decision.

---

### Batch 3: CopilotAuthService - Platform-Agnostic Auth

**Dependencies**: None (independent of Batches 1-2)
**Risk**: MEDIUM
**Estimated Effort**: 4-6 hours

This is the largest batch. The approach follows the proven `CodexAuthService` pattern.

#### 3.1 Create `CopilotFileAuth` utility (file-based token reading)

**Create**: `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-file-auth.ts`

Purpose: Cross-platform GitHub Copilot token file reading, following the CodexAuthService pattern.

```typescript
/**
 * Copilot File Auth - Cross-platform GitHub token reading
 *
 * Reads GitHub OAuth tokens from the standard Copilot config locations:
 * - Linux/macOS: ~/.config/github-copilot/hosts.json
 * - Windows: %LOCALAPPDATA%/github-copilot/hosts.json
 * - XDG override: $XDG_CONFIG_HOME/github-copilot/hosts.json
 *
 * File format:
 * {
 *   "github.com": {
 *     "oauth_token": "gho_xxxxxxxxxxxx"
 *   }
 * }
 *
 * Pattern source: CodexAuthService reads ~/.codex/auth.json (codex-auth.service.ts)
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Shape of the github-copilot/hosts.json file */
export interface CopilotHostsFile {
  [host: string]: {
    oauth_token?: string;
    [key: string]: unknown;
  };
}

/**
 * Get the path to the Copilot hosts.json file.
 * Checks environment variables first, then platform defaults.
 */
export function getCopilotHostsPath(): string {
  // XDG_CONFIG_HOME takes priority (standard on Linux)
  const xdg = process.env['XDG_CONFIG_HOME'];
  if (xdg) {
    return join(xdg, 'github-copilot', 'hosts.json');
  }

  // Windows: %LOCALAPPDATA%/github-copilot/hosts.json
  if (process.platform === 'win32') {
    const localAppData = process.env['LOCALAPPDATA'];
    if (localAppData) {
      return join(localAppData, 'github-copilot', 'hosts.json');
    }
  }

  // Linux/macOS default: ~/.config/github-copilot/hosts.json
  return join(homedir(), '.config', 'github-copilot', 'hosts.json');
}

/**
 * Read the GitHub OAuth token from the Copilot hosts file.
 * Returns null if file doesn't exist or contains no valid token.
 */
export async function readCopilotToken(): Promise<string | null> {
  try {
    const hostsPath = getCopilotHostsPath();
    const raw = await readFile(hostsPath, 'utf-8');
    const hosts = JSON.parse(raw) as CopilotHostsFile;

    // Check github.com entry first
    const githubHost = hosts['github.com'];
    if (githubHost?.oauth_token) {
      return githubHost.oauth_token;
    }

    // Check any host with an oauth_token (for GHES instances)
    for (const host of Object.values(hosts)) {
      if (host?.oauth_token) {
        return host.oauth_token;
      }
    }

    return null;
  } catch {
    // File not found or unreadable
    return null;
  }
}
```

#### 3.2 Create `CopilotDeviceCodeAuth` utility (device code flow)

**Create**: `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-device-code-auth.ts`

Purpose: GitHub Device Code OAuth flow (RFC 8628) for environments without VS Code authentication.

```typescript
/**
 * Copilot Device Code Auth - GitHub Device Code Flow (RFC 8628)
 *
 * For Electron and other non-VS Code environments where the user
 * doesn't have a pre-existing GitHub token file.
 *
 * Flow:
 * 1. POST /login/device/code -> get user_code, verification_uri, device_code, interval
 * 2. Display user_code + verification_uri to user (via IUserInteraction)
 * 3. Poll POST /login/oauth/access_token with device_code until user completes browser auth
 * 4. Return access_token (GitHub OAuth token)
 *
 * The caller then exchanges this token for a Copilot bearer token
 * via the existing exchangeToken() method.
 */
import axios from 'axios';
import type { Logger } from '@ptah-extension/vscode-core';

/** GitHub's OAuth App client ID for Copilot (used by VS Code, opencode, etc.) */
const GITHUB_COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';

/** Device code endpoint */
const DEVICE_CODE_URL = 'https://github.com/login/device/code';

/** Token polling endpoint */
const TOKEN_URL = 'https://github.com/login/oauth/access_token';

/** Maximum polling time before giving up (5 minutes) */
const MAX_POLL_TIME_MS = 5 * 60 * 1000;

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface DeviceCodeCallbacks {
  /** Called with the user code and verification URL for display to the user */
  onUserCode: (userCode: string, verificationUri: string) => void;
  /** Called when the user should open a URL in their browser */
  openBrowser?: (url: string) => Promise<void>;
}

/**
 * Execute the GitHub Device Code OAuth flow.
 *
 * @param logger - Logger for diagnostic output
 * @param callbacks - Callbacks for user interaction (display code, open browser)
 * @returns GitHub OAuth access token, or null if flow was cancelled/timed out
 */
export async function executeDeviceCodeFlow(logger: Logger, callbacks: DeviceCodeCallbacks): Promise<string | null> {
  // Step 1: Request device code
  logger.info('[CopilotDeviceAuth] Starting GitHub device code flow...');

  const { data: deviceCodeResponse } = await axios.post<DeviceCodeResponse>(
    DEVICE_CODE_URL,
    new URLSearchParams({
      client_id: GITHUB_COPILOT_CLIENT_ID,
      scope: 'copilot',
    }),
    {
      headers: { Accept: 'application/json' },
      timeout: 15_000,
    },
  );

  // Step 2: Display code to user
  callbacks.onUserCode(deviceCodeResponse.user_code, deviceCodeResponse.verification_uri);

  // Optionally open browser
  if (callbacks.openBrowser) {
    try {
      await callbacks.openBrowser(deviceCodeResponse.verification_uri);
    } catch {
      // Browser open is best-effort
    }
  }

  // Step 3: Poll for access token
  const pollInterval = Math.max(deviceCodeResponse.interval, 5) * 1000; // minimum 5s
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_POLL_TIME_MS) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    try {
      const { data: tokenResponse } = await axios.post<{
        access_token?: string;
        error?: string;
        error_description?: string;
      }>(
        TOKEN_URL,
        new URLSearchParams({
          client_id: GITHUB_COPILOT_CLIENT_ID,
          device_code: deviceCodeResponse.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
        {
          headers: { Accept: 'application/json' },
          timeout: 15_000,
        },
      );

      if (tokenResponse.access_token) {
        logger.info('[CopilotDeviceAuth] Device code flow completed successfully');
        return tokenResponse.access_token;
      }

      if (tokenResponse.error === 'authorization_pending') {
        // User hasn't completed auth yet, continue polling
        continue;
      }

      if (tokenResponse.error === 'slow_down') {
        // Increase polling interval
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }

      if (tokenResponse.error === 'expired_token') {
        logger.warn('[CopilotDeviceAuth] Device code expired');
        return null;
      }

      if (tokenResponse.error === 'access_denied') {
        logger.warn('[CopilotDeviceAuth] User denied access');
        return null;
      }

      // Unknown error
      logger.warn(`[CopilotDeviceAuth] Unexpected error: ${tokenResponse.error} - ${tokenResponse.error_description}`);
      return null;
    } catch (error) {
      logger.warn(`[CopilotDeviceAuth] Poll request failed: ${error instanceof Error ? error.message : String(error)}`);
      // Continue polling on network errors
    }
  }

  logger.warn('[CopilotDeviceAuth] Device code flow timed out');
  return null;
}
```

#### 3.3 Rewrite `CopilotAuthService` to be platform-agnostic

**Modify**: `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-auth.service.ts`

The rewrite follows the CodexAuthService pattern exactly:

- Remove all `import * as vscode from 'vscode'`
- Use file-based auth (`readCopilotToken()`) as primary
- Use device code flow as fallback for interactive login
- Keep `exchangeToken()` and `refreshToken()` logic unchanged (they're already pure HTTP)
- Inject `PLATFORM_TOKENS.PLATFORM_INFO` to get extension version (replacing `vscode.extensions.getExtension()`)
- Use a fixed editor string instead of `vscode.version` (the header is cosmetic)

**Key changes to the class**:

```typescript
import { injectable, inject } from 'tsyringe';
import axios from 'axios';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IPlatformInfo, IUserInteraction } from '@ptah-extension/platform-core';
import type { ICopilotAuthService, CopilotAuthState, CopilotTokenResponse } from './copilot-provider.types';
import { readCopilotToken } from './copilot-file-auth';
import { executeDeviceCodeFlow, type DeviceCodeCallbacks } from './copilot-device-code-auth';

// NO vscode import

@injectable()
export class CopilotAuthService implements ICopilotAuthService {
  private authState: CopilotAuthState | null = null;
  private refreshPromise: Promise<boolean> | null = null;
  private extensionVersion: string | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.PLATFORM_INFO) private readonly platformInfo: IPlatformInfo,
    @inject(PLATFORM_TOKENS.USER_INTERACTION) private readonly userInteraction: IUserInteraction,
  ) {}

  private getExtensionVersion(): string {
    if (!this.extensionVersion) {
      // Read version from package.json at the extension path
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pkg = require(require('path').join(this.platformInfo.extensionPath, 'package.json'));
        this.extensionVersion = pkg?.version ?? '0.0.0';
      } catch {
        this.extensionVersion = '0.0.0';
      }
    }
    return this.extensionVersion;
  }

  async login(): Promise<boolean> {
    try {
      this.logger.info('[CopilotAuth] Starting authentication...');

      // Strategy 1: Try reading token from Copilot config file
      const fileToken = await readCopilotToken();
      if (fileToken) {
        this.logger.info('[CopilotAuth] Found GitHub token in Copilot config file');
        const exchanged = await this.exchangeToken(fileToken);
        if (exchanged) {
          return true;
        }
        this.logger.warn('[CopilotAuth] File token exchange failed, falling back to device code flow');
      }

      // Strategy 2: GitHub Device Code flow
      this.logger.info('[CopilotAuth] Starting GitHub device code OAuth flow...');
      const deviceToken = await this.executeDeviceCodeLogin();
      if (!deviceToken) {
        return false;
      }

      return this.exchangeToken(deviceToken);
    } catch (error) {
      this.logger.error(`[CopilotAuth] Login failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private async executeDeviceCodeLogin(): Promise<string | null> {
    const callbacks: DeviceCodeCallbacks = {
      onUserCode: (userCode, verificationUri) => {
        // Show the user code to the user via platform-agnostic UI
        this.userInteraction.showInformationMessage(`GitHub Copilot: Enter code ${userCode} at ${verificationUri}`, 'Copy Code');
      },
    };

    return executeDeviceCodeFlow(this.logger, callbacks);
  }

  // getHeaders() updated to remove vscode.version:
  async getHeaders(): Promise<Record<string, string>> {
    const state = await this.getAuthState();
    if (!state) {
      throw new Error('Not authenticated with GitHub Copilot. Call login() first.');
    }

    const version = this.getExtensionVersion();
    return {
      Authorization: `Bearer ${state.bearerToken}`,
      'Content-Type': 'application/json',
      'Openai-Intent': 'conversation-edits',
      'User-Agent': `ptah-extension/${version}`,
      'Editor-Version': `ptah/${version}`,
      'Editor-Plugin-Version': `ptah/${version}`,
      'Copilot-Integration-Id': 'vscode-chat',
      'x-initiator': 'user',
    };
  }

  // isAuthenticated(), getAuthState(), logout() remain UNCHANGED
  // exchangeToken() remains UNCHANGED (already pure HTTP)
  // isTokenExpiringSoon() remains UNCHANGED
  // refreshToken(), doRefreshToken() remain UNCHANGED except:
  //   doRefreshToken() no longer calls getGitHubSession() for refresh fallback.
  //   Instead it tries readCopilotToken() for file-based refresh.
}
```

**Critical detail for `doRefreshToken()`**: The current implementation falls back to `getGitHubSession(false)` (VS Code API) when the cached GitHub token is stale. In the platform-agnostic version, this falls back to `readCopilotToken()` (file-based) instead. If neither works, auth state is cleared and the user must `login()` again.

#### 3.4 Create `VscodeCopilotAuthService` subclass (VS Code-enhanced auth)

**Create**: `libs/backend/agent-sdk/src/lib/copilot-provider/vscode-copilot-auth.service.ts`

This subclass overrides `login()` to try VS Code's native authentication first (better UX in VS Code - seamless OAuth via built-in GitHub auth provider), then falls back to the base class's file + device code flow.

```typescript
/**
 * VS Code-Enhanced Copilot Auth Service
 *
 * Extends the platform-agnostic CopilotAuthService with VS Code's
 * built-in GitHub authentication provider for seamless OAuth login.
 *
 * Priority:
 * 1. vscode.authentication.getSession() (VS Code native - best UX)
 * 2. File-based token from ~/.config/github-copilot/hosts.json (base class)
 * 3. GitHub device code flow (base class fallback)
 */
import * as vscode from 'vscode';
import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IPlatformInfo, IUserInteraction } from '@ptah-extension/platform-core';
import { CopilotAuthService } from './copilot-auth.service';

@injectable()
export class VscodeCopilotAuthService extends CopilotAuthService {
  constructor(@inject(TOKENS.LOGGER) logger: Logger, @inject(PLATFORM_TOKENS.PLATFORM_INFO) platformInfo: IPlatformInfo, @inject(PLATFORM_TOKENS.USER_INTERACTION) userInteraction: IUserInteraction) {
    super(logger, platformInfo, userInteraction);
  }

  override async login(): Promise<boolean> {
    try {
      // Try VS Code native auth first (best UX - seamless OAuth dialog)
      this.logger.info('[VscodeCopilotAuth] Trying VS Code native GitHub auth...');
      const session = await this.getVscodeGitHubSession(true);
      if (session) {
        this.logger.info(`[VscodeCopilotAuth] VS Code GitHub session obtained (account: ${session.account.label})`);
        const exchanged = await this.exchangeToken(session.accessToken);
        if (exchanged) return true;
      }
    } catch (error) {
      this.logger.warn(`[VscodeCopilotAuth] VS Code native auth failed, falling back to base: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Fallback to base class (file + device code flow)
    return super.login();
  }

  private async getVscodeGitHubSession(createIfNone: boolean): Promise<vscode.AuthenticationSession | undefined> {
    // Try 'copilot' scope first
    try {
      const session = await vscode.authentication.getSession('github', ['copilot'], { createIfNone });
      if (session) return session;
    } catch {
      // Fall through to read:user
    }

    // Fallback to 'read:user' scope
    try {
      return await vscode.authentication.getSession('github', ['read:user'], { createIfNone });
    } catch {
      return undefined;
    }
  }
}
```

#### 3.5 Register platform-specific CopilotAuthService implementations

**Modify**: `libs/backend/agent-sdk/src/lib/di/register.ts`

The registration currently does:

```typescript
container.register(SDK_TOKENS.SDK_COPILOT_AUTH, { useClass: CopilotAuthService }, { lifecycle: Lifecycle.Singleton });
```

This needs to become platform-aware. The cleanest approach: `register.ts` always registers the base `CopilotAuthService`. Then the VS Code container (in `apps/ptah-extension-vscode/src/di/container.ts`) overrides with `VscodeCopilotAuthService` after calling `registerSdkServices()`.

**In `libs/backend/agent-sdk/src/lib/di/register.ts`** (line 386-390): No change needed. The base `CopilotAuthService` is now platform-agnostic.

**Modify `CopilotAuthService` constructor** to accept new injections: `PLATFORM_TOKENS.PLATFORM_INFO` and `PLATFORM_TOKENS.USER_INTERACTION`. Since these are registered in Phase 0 of both containers, they resolve automatically.

#### 3.6 Override with VscodeCopilotAuthService in VS Code container

**Modify**: `apps/ptah-extension-vscode/src/di/container.ts`

After the `registerSdkServices(container, logger)` call, add:

```typescript
// Override CopilotAuthService with VS Code-enhanced version (TASK_2025_224)
// The VscodeCopilotAuthService adds native GitHub OAuth via vscode.authentication
import { VscodeCopilotAuthService } from '@ptah-extension/agent-sdk';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';

container.register(SDK_TOKENS.SDK_COPILOT_AUTH, { useClass: VscodeCopilotAuthService }, { lifecycle: Lifecycle.Singleton });
```

This follows the same override pattern used for `ElectronSetupWizardService` (container.ts line 528-530).

#### 3.7 Export new files from agent-sdk barrel

**Modify**: `libs/backend/agent-sdk/src/index.ts`

```typescript
// ADD exports:
export { VscodeCopilotAuthService } from './lib/copilot-provider/vscode-copilot-auth.service';
export { readCopilotToken, getCopilotHostsPath } from './lib/copilot-provider/copilot-file-auth';
export type { CopilotHostsFile } from './lib/copilot-provider/copilot-file-auth';
```

#### 3.8 Update `exchangeToken` visibility

In the rewritten `CopilotAuthService`, `exchangeToken()` needs to be `protected` (instead of `private`) so the `VscodeCopilotAuthService` subclass can call it.

Similarly, `doRefreshToken()` should have a protected helper to try file-based token refresh instead of VS Code session refresh.

---

### Batch 4: Integration Testing and Cleanup

**Dependencies**: Batches 1, 2, 3
**Risk**: LOW
**Estimated Effort**: 1-2 hours

#### 4.1 Update VS Code shim (optional cleanup)

**Modify**: `apps/ptah-electron/src/shims/vscode-shim.ts`

The shim currently has stubs for `vscode.lm`, `vscode.authentication`, `vscode.workspace.getConfiguration`, and `vscode.workspace.workspaceFolders`. After batches 1-3, the three refactored services no longer call these APIs through the shim. However, other code may still hit them, so the shim should remain. No changes needed here.

#### 4.2 Remove APPROVED EXCEPTION comments

After the refactoring, remove the "APPROVED EXCEPTION" comments from the three services since they no longer use VS Code APIs:

- `agent-process-manager.service.ts`: Remove any remaining vscode import comment
- `copilot-auth.service.ts`: Remove the "APPROVED EXCEPTION" comment (line 13-15)
- `token-counter.service.ts`: Remove the "APPROVED EXCEPTION" comment (line 12-14)

#### 4.3 Verify build and tests

```bash
# Type-check all affected libraries
nx run llm-abstraction:typecheck
nx run agent-sdk:typecheck
nx run workspace-intelligence:typecheck
nx run platform-core:typecheck
nx run platform-vscode:typecheck
nx run platform-electron:typecheck

# Run tests
nx test workspace-intelligence
nx test agent-sdk

# Build everything
npm run build:all

# Full quality gates
npm run lint:all
npm run typecheck:all
```

---

## Risk Assessment

| Batch                  | Risk   | Mitigation                                                                                                                                                                                                                                                                          |
| ---------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1: AgentProcessManager | LOW    | Pure mechanical replacement. IWorkspaceProvider already exists and is used by 20+ services. Both VS Code and Electron containers register it.                                                                                                                                       |
| 2: TokenCounterService | LOW    | gpt-tokenizer is a pure JS package with no native dependencies. The existing fallback estimation proves callers handle graceful degradation. VS Code LM API path preserved as primary.                                                                                              |
| 3: CopilotAuthService  | MEDIUM | New device code flow is untested. Token file paths are cross-platform. Mitigation: CodexAuthService proves the file-based pattern works. Device code flow uses standard RFC 8628 protocol supported by GitHub for years. VS Code gets the enhanced subclass preserving existing UX. |
| 4: Integration         | LOW    | Build verification only. No logic changes.                                                                                                                                                                                                                                          |

## Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- All changes are in backend TypeScript libraries (platform-core, platform-vscode, platform-electron, llm-abstraction, agent-sdk, workspace-intelligence)
- No frontend/Angular/UI changes needed
- Involves DI, platform abstraction patterns, HTTP APIs, file I/O
- TypeScript strict mode, tsyringe dependency injection

## Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 8-12 hours total

| Batch                        | Hours |
| ---------------------------- | ----- |
| Batch 1: AgentProcessManager | 1-2   |
| Batch 2: TokenCounterService | 2-3   |
| Batch 3: CopilotAuthService  | 4-6   |
| Batch 4: Integration Testing | 1-2   |

## Files Affected Summary

**CREATE** (6 files):

- `libs/backend/platform-core/src/interfaces/token-counter.interface.ts`
- `libs/backend/platform-vscode/src/implementations/vscode-token-counter.ts`
- `libs/backend/platform-electron/src/implementations/electron-token-counter.ts`
- `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-file-auth.ts`
- `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-device-code-auth.ts`
- `libs/backend/agent-sdk/src/lib/copilot-provider/vscode-copilot-auth.service.ts`

**MODIFY** (9 files):

- `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts`
- `libs/backend/workspace-intelligence/src/services/token-counter.service.ts`
- `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-auth.service.ts` (REWRITE)
- `libs/backend/platform-core/src/tokens.ts`
- `libs/backend/platform-core/src/index.ts`
- `libs/backend/platform-vscode/src/registration.ts`
- `libs/backend/platform-electron/src/registration.ts`
- `libs/backend/agent-sdk/src/index.ts`
- `apps/ptah-extension-vscode/src/di/container.ts`

**DEPENDENCY** (1 new npm package):

- `gpt-tokenizer` (^3.4.0) - Pure JS BPE tokenizer

## Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **All imports exist in codebase**:
   - `PLATFORM_TOKENS.WORKSPACE_PROVIDER` from `@ptah-extension/platform-core` (tokens.ts:25)
   - `IWorkspaceProvider` from `@ptah-extension/platform-core` (interfaces/workspace-provider.interface.ts:9)
   - `IPlatformInfo` from `@ptah-extension/platform-core` (types/platform.types.ts:175)
   - `IUserInteraction` from `@ptah-extension/platform-core` (interfaces/user-interaction.interface.ts:17)

2. **All patterns verified from examples**:
   - IWorkspaceProvider injection: 20+ services use `@inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)`
   - File-based auth: CodexAuthService (codex-auth.service.ts) is the reference
   - Platform registration: See registration.ts in both platform-vscode and platform-electron

3. **No hallucinated APIs**:
   - `IWorkspaceProvider.getConfiguration<T>(section, key, defaultValue)` verified at workspace-provider.interface.ts:34-38
   - `IWorkspaceProvider.getWorkspaceRoot()` verified at workspace-provider.interface.ts:24
   - `IUserInteraction.showInformationMessage()` verified at user-interaction.interface.ts:43-45
   - `gpt-tokenizer.encode()` verified at npm (pure JS BPE tokenizer, returns number[])
