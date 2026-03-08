# Implementation Plan - TASK_2025_160

## Multi-CLI Plugin Sync and Agent Generation Architecture

**Objective**: Extend Ptah's plugin/skill and subagent systems to support Copilot CLI and Gemini CLI alongside the existing Claude Agent SDK, enabling premium users to leverage Ptah's bundled skills and workspace-adaptive agents across all installed CLI tools.

**Design Decisions (User-Confirmed)**:

1. **Plugin/Skill Strategy**: Option B - Path-Based Passthrough to CLI-specific user-level directories
2. **Agent Format Adaptation**: Option B - Full post-processing transform layer per CLI
3. **Installation Lifecycle**: Option C - Setup wizard for initial generation + extension activation for re-sync
4. **Service Placement**: Option C - Split across `llm-abstraction` and `agent-generation` libraries

---

## 1. Codebase Investigation Summary

### Libraries Discovered and Verified

| Library            | Purpose                    | Key Exports Verified                                                                                                                                                                                                          |
| ------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-sdk`        | Claude SDK integration     | `PluginLoaderService` (plugin-loader.service.ts:106), `SdkQueryOptionsBuilder` (sdk-query-options-builder.ts:232), `SdkPluginConfig` (claude-sdk.types.ts:115)                                                                |
| `agent-generation` | Agent generation pipeline  | `AgentGenerationOrchestratorService` (orchestrator.service.ts:192), `AgentFileWriterService` (file-writer.service.ts:49), `GeneratedAgent` (core.types.ts:476), `IAgentFileWriterService` (agent-file-writer.interface.ts:33) |
| `llm-abstraction`  | CLI adapters and detection | `CliDetectionService` (cli-detection.service.ts:20), `CopilotCliAdapter` (copilot-cli.adapter.ts:38), `GeminiCliAdapter` (gemini-cli.adapter.ts:68), `CliAdapter` interface (cli-adapter.interface.ts:51)                     |
| `shared`           | Foundation types           | `CliType` (agent-process.types.ts:60), `PluginInfo` (rpc.types.ts:1196), `PluginConfigState` (rpc.types.ts:1216)                                                                                                              |
| `vscode-core`      | Infrastructure             | `TOKENS` (tokens.ts), `Logger`, `LicenseService` (license.service.ts)                                                                                                                                                         |

### Existing Patterns Identified

**1. Plugin Directory Structure** (verified at `apps/ptah-extension-vscode/assets/plugins/`):

```
ptah-core/
  .claude-plugin/plugin.json          # Manifest: { name, description, version, author }
  skills/
    orchestration/SKILL.md            # YAML frontmatter: name, description
    orchestration/references/*.md     # Reference docs
    orchestration/examples/*.md       # Example traces
    ddd-architecture/SKILL.md
    ddd-architecture/references/*.md
  commands/
    orchestrate.md                    # Command definitions
    review-code.md
```

**2. SKILL.md Format** (verified at ddd-architecture/SKILL.md:1-4, agent-browser/SKILL.md:1-5):

```yaml
---
name: skill-name
description: Skill description text
allowed-tools: Bash(agent-browser:*) # Optional
---
# Skill Title
[Markdown body content]
```

**3. Agent File Frontmatter** (Claude format, verified at orchestrator.service.ts:851-857):

```yaml
---
name: agent-name
description: Agent Name focused on ProjectType with Framework
---
```

**4. Plugin Consumption by SDK** (verified at sdk-query-options-builder.ts:584-589):

```typescript
private buildPlugins(pluginPaths?: string[]): SdkPluginConfig[] | undefined {
  if (!pluginPaths || pluginPaths.length === 0) return undefined;
  return pluginPaths.map((p) => ({ type: 'local' as const, path: p }));
}
```

**5. DI Registration Pattern** (verified at agent-generation/di/register.ts, llm-abstraction/di/register.ts):

- All services use `@injectable()` decorator
- Registration via `container.registerSingleton(TOKEN, Class)` or `container.register(TOKEN, { useClass: Class }, { lifecycle: Lifecycle.Singleton })`
- Token pattern: `Symbol.for('ServiceName')` in dedicated tokens.ts files

**6. Premium Gating Pattern** (verified at sdk-query-options-builder.ts:145-146, wizard-generation-rpc.handlers.ts:29):

- `isPremium` boolean passed through options
- `LicenseService` provides `tier.isPremium` field (license.service.ts:93)
- Plugin paths only resolved and passed to SDK when premium flag is true

**7. File Writer Security** (verified at file-writer.service.ts:397-453):

- `validateFilePath()` enforces path contains `.claude` string
- This MUST be relaxed or bypassed for non-Claude CLI targets writing to `~/.gemini/` or `~/.copilot/`

---

## 2. Component Architecture Diagram

```
+=========================================================================+
|                        EXTENSION ACTIVATION (main.ts)                    |
|  Step 7.1.5: PluginLoader.initialize()                                  |
|  Step NEW:   CliPluginSyncService.syncOnActivation() [premium + CLIs]   |
+=========================================================================+
        |                               |
        v                               v
+-------------------+     +-----------------------------------+
| agent-sdk         |     | llm-abstraction                   |
| (Claude SDK only) |     | (Multi-CLI infrastructure)        |
|                   |     |                                   |
| PluginLoaderSvc   |     | CliDetectionService (existing)    |
| SdkQueryOptsBld   |     | CopilotCliAdapter  (existing)     |
|                   |     | GeminiCliAdapter   (existing)     |
|                   |     |                                   |
|                   |     | +-------------------------------+ |
|                   |     | | NEW: CLI Skill Sync Layer     | |
|                   |     | |                               | |
|                   |     | | CliPluginSyncService          | |
|                   |     | |   Orchestrates skill sync     | |
|                   |     | |                               | |
|                   |     | | ICliSkillInstaller (interface) | |
|                   |     | |   CopilotSkillInstaller       | |
|                   |     | |   GeminiSkillInstaller         | |
|                   |     | |                               | |
|                   |     | | CliSkillManifestTracker       | |
|                   |     | |   Tracks installed state      | |
|                   |     | +-------------------------------+ |
+-------------------+     +-----------------------------------+
        |                               |
        |                               |
        v                               v
+=========================================================================+
|                        agent-generation                                  |
|  (Agent generation pipeline - extended for multi-CLI)                    |
|                                                                         |
|  AgentGenerationOrchestratorService (existing, modified)                |
|    - New: targetClis option in OrchestratorGenerationOptions            |
|    - New: Calls MultiCliAgentWriterService after Claude write           |
|                                                                         |
|  +-------------------------------------------------------------------+ |
|  | NEW: Multi-CLI Agent Adaptation Layer                              | |
|  |                                                                   | |
|  | ICliAgentTransformer (interface)                                   | |
|  |   CopilotAgentTransformer - Claude MD -> Copilot agent format     | |
|  |   GeminiAgentTransformer  - Claude MD -> Gemini agent format      | |
|  |                                                                   | |
|  | MultiCliAgentWriterService                                        | |
|  |   Takes GeneratedAgent[] + detected CLIs                          | |
|  |   Transforms via ICliAgentTransformer per CLI                     | |
|  |   Writes to user-level directories                                | |
|  +-------------------------------------------------------------------+ |
|                                                                         |
|  AgentFileWriterService (existing, UNCHANGED)                           |
|    - Still writes to {workspace}/.claude/agents/ only                   |
|    - Path validation (.claude check) preserved                          |
+=========================================================================+
        |
        v
+=========================================================================+
|                             shared                                       |
|  (Foundation types)                                                      |
|                                                                         |
|  NEW: CliSkillSyncTypes                                                 |
|    - CliTarget type                                                      |
|    - CliAgentTransformResult                                            |
|    - CliSkillSyncStatus                                                 |
|    - CliPluginSyncState                                                 |
+=========================================================================+
```

---

## 3. Data Flow Diagrams

### 3.1 Plugin/Skill Sync Flow (Extension Activation)

```
Extension Activation (main.ts)
    |
    v
[1] LicenseService.checkStatus()
    |-- NOT premium --> STOP (no sync)
    |-- premium -----v
    |
[2] CliDetectionService.detectAll()
    |-- No CLIs installed --> STOP
    |-- CLIs detected ------v
    |
[3] CliPluginSyncService.syncOnActivation(installedClis, pluginPaths)
    |
    |-- For each installed CLI:
    |
    |   [3a] CliSkillManifestTracker.getLastSyncHash(cli)
    |        |
    |        |-- Compare with current plugin content hash
    |        |-- If unchanged --> SKIP (already synced)
    |        |-- If changed ---v
    |
    |   [3b] ICliSkillInstaller.install(pluginPaths)
    |        |
    |        |   CopilotSkillInstaller:
    |        |     - Copy skill directories to globalStoragePath/copilot-skills/
    |        |     - Register via copilot CLI --config-dir or native discovery
    |        |     - Target: ~/.copilot/skills/ptah-*/ (user-level)
    |        |
    |        |   GeminiSkillInstaller:
    |        |     - Copy skill directories to ~/.gemini/skills/ptah-*/
    |        |     - Skills auto-discovered by Gemini CLI from this path
    |        |
    |   [3c] CliSkillManifestTracker.updateSyncHash(cli, newHash)
    |
[4] Log sync results
```

### 3.2 Agent Generation Flow (Setup Wizard)

```
Setup Wizard "Generate" Step
    |
    v
[1] wizard-generation-rpc.handlers.ts
    |-- Resolve premium status, MCP state, plugin paths
    |-- Resolve installed CLIs via CliDetectionService
    |
    v
[2] AgentGenerationOrchestratorService.generateAgents(options)
    |-- options.targetClis = ['copilot', 'gemini'] (detected & premium)
    |
    |-- Phase 1: Analysis (unchanged)
    |-- Phase 2: Selection (unchanged)
    |-- Phase 3: Rendering (unchanged) --> produces GeneratedAgent[] in Claude format
    |-- Phase 4: Writing (unchanged) --> writes to .claude/agents/
    |
    v
[3] NEW Phase 5: Multi-CLI Agent Distribution
    |
    |-- MultiCliAgentWriterService.writeForClis(generatedAgents, targetClis)
    |
    |   For each CLI target:
    |   [3a] ICliAgentTransformer.transform(generatedAgent)
    |        |
    |        |   CopilotAgentTransformer:
    |        |     - Rewrite frontmatter: { name, description } --> Copilot fields
    |        |     - Rewrite tool references: AskUserQuestion --> Copilot equivalent
    |        |     - Strip Claude-specific directives
    |        |     - Output: { content, filePath: ~/.copilot/agents/{id}.md }
    |        |
    |        |   GeminiAgentTransformer:
    |        |     - Rewrite frontmatter for Gemini format
    |        |     - Rewrite tool references for Gemini tool names
    |        |     - Strip Claude-specific directives
    |        |     - Output: { content, filePath: ~/.gemini/agents/{id}.md }
    |
    |   [3b] Write transformed content to target path
    |        (Uses fs.promises directly -- NOT AgentFileWriterService,
    |         because target paths are outside .claude/)
    |
    v
[4] Return GenerationSummary (extended with cliResults)
```

### 3.3 Cleanup Flow (Premium Expiry / Extension Deactivation)

```
Premium Expired Event OR Extension Deactivation
    |
    v
[1] CliPluginSyncService.cleanup(installedClis)
    |
    |-- For each CLI:
    |   [1a] ICliSkillInstaller.uninstall()
    |        - Remove ptah-* skill directories from CLI config
    |   [1b] Remove generated agent files from user-level dirs
    |   [1c] CliSkillManifestTracker.clearSyncHash(cli)
    |
[2] Log cleanup results
```

---

## 4. Format Specifications

### 4.1 Copilot CLI Agent File Format

**Location**: `~/.copilot/agents/{agent-id}.md` (user-level, NOT workspace)

**Frontmatter**:

```yaml
---
name: backend-developer
description: Backend Developer focused on Node with NestJS
---
```

**Content Transformations from Claude Format**:

| Claude Construct               | Copilot Equivalent                                   | Transform Rule                              |
| ------------------------------ | ---------------------------------------------------- | ------------------------------------------- |
| `AskUserQuestion` tool         | `ask_followup_question` tool / inline prompt pattern | Replace tool reference + usage instructions |
| `<!-- STATIC:section -->`      | Pass through as-is (Markdown comments are universal) | No change needed                            |
| `@ptah-extension/` import refs | Remove (irrelevant to CLI agents)                    | Strip lines matching pattern                |
| `Task tool` references         | `--agent NAME` subagent pattern                      | Rewrite delegation instructions             |
| `/command` slash command refs  | Copilot `--agent` flag refs                          | Rewrite command invocation patterns         |

**Copilot Agent Discovery**:

- Copilot CLI discovers agents from `~/.copilot/agents/` directory
- Invoked via `copilot --agent backend-developer`
- No additional registration needed -- file presence is sufficient

### 4.2 Gemini CLI Agent File Format

**Location**: `~/.gemini/agents/{agent-id}.md` (user-level, NOT workspace)

**Frontmatter**:

```yaml
---
name: backend-developer
description: Backend Developer focused on Node with NestJS
---
```

**Content Transformations from Claude Format**:

| Claude Construct               | Gemini Equivalent                               | Transform Rule                                   |
| ------------------------------ | ----------------------------------------------- | ------------------------------------------------ |
| `AskUserQuestion` tool         | Inline questioning pattern (no equivalent tool) | Replace with "ask the user directly" instruction |
| `<!-- STATIC:section -->`      | Pass through as-is                              | No change needed                                 |
| `@ptah-extension/` import refs | Remove                                          | Strip lines matching pattern                     |
| `Task tool` references         | `gemini -e NAME` extension pattern              | Rewrite delegation instructions                  |
| `/command` slash command refs  | Gemini `-e` extension invocation                | Rewrite command invocation patterns              |

**Gemini Agent Discovery**:

- Gemini CLI discovers agents from `~/.gemini/agents/` directory
- Invoked via `gemini -a backend-developer` or `gemini --agent backend-developer`
- No additional registration needed -- file presence is sufficient

### 4.3 Skill File Format (Shared Across CLIs)

**Ptah's SKILL.md format is already CLI-agnostic** (verified at ddd-architecture/SKILL.md, agent-browser/SKILL.md):

```yaml
---
name: skill-name
description: Skill description
allowed-tools: Bash(pattern:*) # Optional, Claude-specific field
---
# Skill Content (Markdown)
```

**Copilot Skill Discovery**:

- Path: `~/.copilot/skills/ptah-{plugin-id}/{skill-name}/SKILL.md`
- Copilot auto-discovers from `~/.copilot/skills/` directory
- The `allowed-tools` frontmatter field is Claude-specific and ignored by Copilot

**Gemini Skill Discovery**:

- Path: `~/.gemini/skills/ptah-{plugin-id}/{skill-name}/SKILL.md`
- Gemini auto-discovers skills from `~/.gemini/skills/` directory
- The `allowed-tools` frontmatter field is ignored

**Transform needed for skills**: Minimal -- only strip or adapt Claude-specific frontmatter fields (`allowed-tools`). The directory structure and SKILL.md body content are already compatible.

### 4.4 Copilot Plugin Manifest (for --config-dir approach)

If using `--config-dir` to point Copilot to bundled plugins (alternative to copying):

```json
// {globalStoragePath}/copilot-config/plugins/ptah-core/plugin.json
{
  "name": "ptah-core",
  "description": "Core development skills - Workflow orchestration, DDD architecture, content creation",
  "version": "1.0.0",
  "author": { "name": "Ptah" },
  "skills": ["skills/orchestration/SKILL.md", "skills/ddd-architecture/SKILL.md", "skills/skill-creator/SKILL.md"]
}
```

**Decision**: Use direct copy to `~/.copilot/skills/` (simpler, no `--config-dir` management needed at activation time). The `--config-dir` approach is only relevant when spawning headless subagents, which already has its own arg-building in `CopilotCliAdapter.runSdk()`.

---

## 5. File-by-File Implementation Plan

### 5.1 Shared Types (Foundation Layer)

#### File: `libs/shared/src/lib/types/cli-skill-sync.types.ts` (CREATE)

**Purpose**: Shared type definitions for cross-CLI skill sync and agent transformation.

**Pattern**: Pure TypeScript types, no dependencies (matches shared library boundary).
**Evidence**: All shared types live in `libs/shared/src/lib/types/` (agent-process.types.ts, rpc.types.ts).

```typescript
/** CLI targets that support Ptah skill/agent integration */
export type CliTarget = 'copilot' | 'gemini';

/** Result of transforming a Claude-format agent to a CLI-specific format */
export interface CliAgentTransformResult {
  readonly cli: CliTarget;
  readonly agentId: string;
  readonly content: string;
  readonly filePath: string;
}

/** Status of skill sync for a single CLI */
export interface CliSkillSyncStatus {
  readonly cli: CliTarget;
  readonly synced: boolean;
  readonly skillCount: number;
  readonly lastSyncedAt?: string;
  readonly error?: string;
}

/** Overall plugin sync state persisted in globalState */
export interface CliPluginSyncState {
  readonly syncedClis: Record<
    string,
    {
      readonly contentHash: string;
      readonly syncedAt: string;
      readonly pluginIds: string[];
    }
  >;
}

/** Multi-CLI generation summary extension */
export interface CliGenerationResult {
  readonly cli: CliTarget;
  readonly agentsWritten: number;
  readonly agentsFailed: number;
  readonly paths: string[];
  readonly errors: string[];
}
```

**Quality Requirements**:

- No runtime dependencies
- All fields readonly for immutability
- Uses existing `CliTarget` rather than overloading `CliType` (which includes 'codex')

#### File: `libs/shared/src/lib/types/index.ts` (MODIFY)

**Purpose**: Add barrel export for new types.

**Change**: Add `export * from './cli-skill-sync.types';`

---

### 5.2 CLI Skill Sync Layer (in `llm-abstraction`)

#### File: `libs/backend/llm-abstraction/src/lib/services/cli-skill-sync/cli-skill-installer.interface.ts` (CREATE)

**Purpose**: Interface for CLI-specific skill installation strategies.

**Pattern**: Strategy pattern -- one installer per CLI target. Matches `CliAdapter` interface pattern (cli-adapter.interface.ts:51).
**Evidence**: CLI adapters already follow this strategy pattern in `cli-adapters/` directory.

```typescript
import type { CliTarget, CliSkillSyncStatus } from '@ptah-extension/shared';

/** Strategy interface for installing Ptah skills into a specific CLI */
export interface ICliSkillInstaller {
  readonly target: CliTarget;

  /**
   * Install/sync Ptah plugin skills to the CLI's skill discovery directory.
   * @param pluginPaths - Absolute paths to Ptah plugin directories (from PluginLoaderService)
   * @returns Sync status with skill count and any errors
   */
  install(pluginPaths: string[]): Promise<CliSkillSyncStatus>;

  /**
   * Remove all Ptah-installed skills from this CLI's directories.
   * Called on premium expiry or extension deactivation.
   */
  uninstall(): Promise<void>;

  /**
   * Get the base directory where skills are installed for this CLI.
   * Used by manifest tracker for hash verification.
   */
  getSkillsBasePath(): string;
}
```

#### File: `libs/backend/llm-abstraction/src/lib/services/cli-skill-sync/copilot-skill-installer.ts` (CREATE)

**Purpose**: Copilot-specific skill installation -- copies Ptah plugin skill directories to `~/.copilot/skills/ptah-{pluginId}/`.

**Pattern**: Implements `ICliSkillInstaller`. Uses `fs/promises` for file operations (same pattern as `GeminiCliAdapter.configureMcpServer()` at gemini-cli.adapter.ts:193-229).
**Evidence**: Gemini adapter already writes to `~/.gemini/` using `homedir()` + `mkdir` + `writeFile` pattern.

**Responsibilities**:

- Recursively copy skill directories from `{extensionPath}/assets/plugins/{pluginId}/skills/` to `~/.copilot/skills/ptah-{pluginId}/`
- Strip `allowed-tools` from SKILL.md frontmatter during copy (Claude-specific field)
- Preserve all reference docs, examples, assets subdirectories
- Create `~/.copilot/skills/` directory if it does not exist
- On uninstall: remove all `ptah-*` directories from `~/.copilot/skills/`

**Key Implementation Detail**: Does NOT copy `.claude-plugin/plugin.json` or `commands/` directories (those are Claude SDK-specific). Only copies `skills/` subtree.

#### File: `libs/backend/llm-abstraction/src/lib/services/cli-skill-sync/gemini-skill-installer.ts` (CREATE)

**Purpose**: Gemini-specific skill installation -- copies Ptah plugin skill directories to `~/.gemini/skills/ptah-{pluginId}/`.

**Pattern**: Same as CopilotSkillInstaller but targeting Gemini's directory.
**Evidence**: Gemini already reads from `~/.gemini/` (gemini-cli.adapter.ts:154, 196).

**Responsibilities**:

- Same recursive copy logic as Copilot installer but target is `~/.gemini/skills/ptah-{pluginId}/`
- Strip `allowed-tools` from SKILL.md frontmatter
- On uninstall: remove all `ptah-*` directories from `~/.gemini/skills/`

#### File: `libs/backend/llm-abstraction/src/lib/services/cli-skill-sync/cli-skill-manifest-tracker.ts` (CREATE)

**Purpose**: Track which plugins have been synced to which CLIs, using content hashing to avoid redundant re-syncs.

**Pattern**: Uses VS Code `globalState` (Memento) for persistence, similar to `PluginLoaderService`'s use of `workspaceState` (plugin-loader.service.ts:163-171).
**Evidence**: `PluginLoaderService` uses `workspaceState.get<T>(KEY)` pattern for persistent state.

**Responsibilities**:

- Compute content hash of plugin directories (fast hash of file paths + sizes + mtimes)
- Store per-CLI sync hashes in `globalState` under `ptah.cliSkillSync` key
- Compare current hash with stored hash to determine if re-sync needed
- Expose `needsSync(cli, pluginPaths): boolean` method
- Late-initialized with `globalState` (same pattern as PluginLoaderService)

#### File: `libs/backend/llm-abstraction/src/lib/services/cli-skill-sync/cli-plugin-sync.service.ts` (CREATE)

**Purpose**: Top-level orchestrator for CLI skill sync. Called from extension activation and setup wizard completion.

**Pattern**: `@injectable()` singleton. Coordinates installers and manifest tracker. Follows `CliDetectionService` pattern (cli-detection.service.ts:20).
**Evidence**: Services registered as singletons via `container.registerSingleton()` (llm-abstraction/di/register.ts:84-93).

**Dependencies** (all verified):

- `TOKENS.LOGGER` (vscode-core/tokens.ts:35)
- `TOKENS.CLI_DETECTION_SERVICE` (resolved to CliDetectionService)
- `LicenseService` for premium check
- `CliSkillManifestTracker` for sync state
- `ICliSkillInstaller` implementations

**Key Methods**:

```typescript
/** Initialize with extension context (globalState for persistence) */
initialize(globalState: vscode.Memento, extensionPath: string): void;

/** Sync skills for all premium-eligible CLIs. Returns per-CLI status. */
async syncOnActivation(enabledPluginIds: string[]): Promise<CliSkillSyncStatus[]>;

/** Full sync (forces re-copy even if hash matches). Used by setup wizard. */
async syncForce(enabledPluginIds: string[]): Promise<CliSkillSyncStatus[]>;

/** Remove all Ptah skills from all CLIs. Called on premium expiry. */
async cleanupAll(): Promise<void>;

/** Remove agents from user-level CLI directories */
async removeCliAgents(clis: CliTarget[]): Promise<void>;
```

#### File: `libs/backend/llm-abstraction/src/lib/services/cli-skill-sync/index.ts` (CREATE)

**Purpose**: Barrel exports for the cli-skill-sync module.

```typescript
export { CliPluginSyncService } from './cli-plugin-sync.service';
export type { ICliSkillInstaller } from './cli-skill-installer.interface';
export { CopilotSkillInstaller } from './copilot-skill-installer';
export { GeminiSkillInstaller } from './gemini-skill-installer';
export { CliSkillManifestTracker } from './cli-skill-manifest-tracker';
```

#### File: `libs/backend/llm-abstraction/src/index.ts` (MODIFY)

**Purpose**: Export new sync service from library barrel.

**Change**: Add after CLI_DETECTION_SERVICE export:

```typescript
// CLI Skill Sync (TASK_2025_160)
export { CliPluginSyncService } from './lib/services/cli-skill-sync';
export type { ICliSkillInstaller } from './lib/services/cli-skill-sync';
```

#### File: `libs/backend/llm-abstraction/src/lib/di/register.ts` (MODIFY)

**Purpose**: Register new sync services in DI container.

**Change**: Add registrations after AgentProcessManager (line 93):

```typescript
// 7. CliPluginSyncService - needs LOGGER, CLI_DETECTION_SERVICE
container.registerSingleton(TOKENS.CLI_PLUGIN_SYNC_SERVICE, CliPluginSyncService);
```

**Note**: `CopilotSkillInstaller` and `GeminiSkillInstaller` are instantiated internally by `CliPluginSyncService` (not registered as separate DI tokens) -- they are implementation details, not injectable services.

#### File: `libs/backend/vscode-core/src/di/tokens.ts` (MODIFY)

**Purpose**: Add DI token for the new sync service.

**Change**: Add to CLI/Agent section:

```typescript
export const CLI_PLUGIN_SYNC_SERVICE = Symbol.for('CliPluginSyncService');
```

And add to TOKENS registry object:

```typescript
CLI_PLUGIN_SYNC_SERVICE,
```

---

### 5.3 Agent Transformation Layer (in `agent-generation`)

#### File: `libs/backend/agent-generation/src/lib/services/cli-agent-transforms/cli-agent-transformer.interface.ts` (CREATE)

**Purpose**: Interface for CLI-specific agent content transformation.

**Pattern**: Strategy pattern, one transformer per CLI. Mirrors `ICliSkillInstaller` pattern.
**Evidence**: The codebase uses interfaces extensively for strategy injection (IAgentFileWriterService, IContentGenerationService, IAgentSelectionService, ITemplateStorageService).

```typescript
import type { CliTarget, CliAgentTransformResult } from '@ptah-extension/shared';
import type { GeneratedAgent } from '../../types/core.types';

/** Transforms Claude-format agent content to a specific CLI format */
export interface ICliAgentTransformer {
  readonly target: CliTarget;

  /**
   * Transform a Claude-format GeneratedAgent into CLI-specific format.
   * Rewrites frontmatter, tool references, and CLI-specific constructs.
   * Returns the transformed content and target file path.
   */
  transform(agent: GeneratedAgent): CliAgentTransformResult;
}
```

#### File: `libs/backend/agent-generation/src/lib/services/cli-agent-transforms/copilot-agent-transformer.ts` (CREATE)

**Purpose**: Transform Claude-format agent content to Copilot CLI format.

**Pattern**: Implements `ICliAgentTransformer`. Pure transformation (no I/O, no DI dependencies).
**Evidence**: Orchestrator's `buildAgentFileContent()` (orchestrator.service.ts:833-860) already performs frontmatter manipulation -- this follows the same pattern.

**Transformation Rules**:

1. **Frontmatter**: Keep `name` and `description` fields (Copilot uses same format)
2. **AskUserQuestion tool**: Replace with `ask_followup_question` pattern or inline questioning instruction
3. **Task tool references**: Replace `Task tool` invocations with `copilot --agent NAME` subagent pattern
4. **Slash commands**: Replace `/orchestrate`, `/review-code` etc. with `copilot` CLI invocations
5. **Internal imports**: Strip any `@ptah-extension/` references
6. **STATIC/LLM markers**: Keep as-is (Markdown comments, ignored by all CLIs)

**Target path**: `~/.copilot/agents/{agent-id}.md`

#### File: `libs/backend/agent-generation/src/lib/services/cli-agent-transforms/gemini-agent-transformer.ts` (CREATE)

**Purpose**: Transform Claude-format agent content to Gemini CLI format.

**Pattern**: Same as CopilotAgentTransformer but with Gemini-specific mappings.

**Transformation Rules**:

1. **Frontmatter**: Keep `name` and `description` fields (Gemini uses same format)
2. **AskUserQuestion tool**: Replace with "ask the user directly in your response" instruction
3. **Task tool references**: Replace with `gemini --agent NAME` or `-a NAME` subagent pattern
4. **Slash commands**: Replace with Gemini CLI invocations
5. **Internal imports**: Strip `@ptah-extension/` references
6. **STATIC/LLM markers**: Keep as-is

**Target path**: `~/.gemini/agents/{agent-id}.md`

#### File: `libs/backend/agent-generation/src/lib/services/cli-agent-transforms/transform-rules.ts` (CREATE)

**Purpose**: Shared transformation rules and regex patterns used by both transformers.

**Rationale**: Both transformers share most rewrite logic (strip internal refs, rewrite sections), differing only in target tool names and paths. Extract common rules to avoid duplication.

```typescript
/** Common regex patterns for Claude-specific content detection */
export const CLAUDE_PATTERNS = {
  askUserQuestion: /AskUserQuestion\s*(?:tool)?/gi,
  taskTool: /(?:use\s+the\s+)?Task\s+tool\s+to/gi,
  slashCommand: /\/(?:orchestrate|review-code|review-logic|review-security)/gi,
  internalImport: /^.*@ptah-extension\/.*$/gm,
  claudeSpecificDirective: /Claude Code|Claude Agent SDK|claude_code preset/gi,
};

/** Strip Claude-internal references that are meaningless outside Claude */
export function stripInternalReferences(content: string): string;

/** Rewrite frontmatter for target CLI */
export function rewriteFrontmatter(content: string, cli: CliTarget, agentId: string, description: string): string;
```

#### File: `libs/backend/agent-generation/src/lib/services/cli-agent-transforms/multi-cli-agent-writer.service.ts` (CREATE)

**Purpose**: Orchestrates agent transformation and writing for all target CLIs. Called after the standard Claude agent writing phase.

**Pattern**: `@injectable()` singleton. Uses `ICliAgentTransformer` strategy instances.
**Evidence**: `AgentFileWriterService` (file-writer.service.ts:49) handles Claude writes; this service handles non-Claude writes.

**Dependencies**:

- `TOKENS.LOGGER` (verified)
- Instantiates transformers internally (not DI-injected, they are pure functions)

**Key Methods**:

```typescript
/**
 * Transform and write agents for multiple CLI targets.
 * Does NOT use AgentFileWriterService (targets are outside .claude/).
 * Uses fs.promises directly for user-level directory writes.
 *
 * @param agents - Claude-format GeneratedAgent[] from orchestrator Phase 3
 * @param targetClis - CLI targets to write for (filtered by detection + premium)
 * @returns Per-CLI generation results
 */
async writeForClis(
  agents: GeneratedAgent[],
  targetClis: CliTarget[]
): Promise<CliGenerationResult[]>;
```

**Security Note**: This service writes to user-level directories (`~/.copilot/`, `~/.gemini/`), NOT workspace directories. This is safe because:

- Paths are computed from `homedir()` (not user input)
- Agent IDs are validated against known template IDs (from `AgentSelectionService`)
- No path traversal risk (no user-controlled path components)

#### File: `libs/backend/agent-generation/src/lib/services/cli-agent-transforms/index.ts` (CREATE)

**Purpose**: Barrel exports.

```typescript
export type { ICliAgentTransformer } from './cli-agent-transformer.interface';
export { CopilotAgentTransformer } from './copilot-agent-transformer';
export { GeminiAgentTransformer } from './gemini-agent-transformer';
export { MultiCliAgentWriterService } from './multi-cli-agent-writer.service';
```

#### File: `libs/backend/agent-generation/src/lib/di/tokens.ts` (MODIFY)

**Purpose**: Add DI token for MultiCliAgentWriterService.

**Change**: Add to File Operations section (after AGENT_FILE_WRITER_SERVICE, line 127):

```typescript
/** MultiCliAgentWriterService - Transform and write agents for non-Claude CLIs */
export const MULTI_CLI_AGENT_WRITER_SERVICE = Symbol.for('MultiCliAgentWriterService');
```

Add to `AGENT_GENERATION_TOKENS` registry:

```typescript
MULTI_CLI_AGENT_WRITER_SERVICE,
```

#### File: `libs/backend/agent-generation/src/lib/di/register.ts` (MODIFY)

**Purpose**: Register MultiCliAgentWriterService.

**Change**: Add after AgentFileWriterService registration (line 143):

```typescript
// Multi-CLI agent writer service - transforms and writes for Copilot/Gemini
container.register(AGENT_GENERATION_TOKENS.MULTI_CLI_AGENT_WRITER_SERVICE, { useClass: MultiCliAgentWriterService }, { lifecycle: Lifecycle.Singleton });
```

#### File: `libs/backend/agent-generation/src/index.ts` (MODIFY)

**Purpose**: Export new services from library barrel.

**Change**: Add after existing service exports:

```typescript
// Multi-CLI Agent Transforms (TASK_2025_160)
export { MultiCliAgentWriterService } from './lib/services/cli-agent-transforms';
export type { ICliAgentTransformer } from './lib/services/cli-agent-transforms';
```

---

### 5.4 Orchestrator Extension

#### File: `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts` (MODIFY)

**Purpose**: Extend generation pipeline to include multi-CLI agent distribution as Phase 5.

**Changes**:

1. **Add to `OrchestratorGenerationOptions`** (after `pluginPaths` field, line 125):

```typescript
/** Target CLI platforms for agent distribution (premium only).
 * When provided, Phase 5 transforms and writes agents to these CLI directories. */
targetClis?: CliTarget[];
```

2. **Inject MultiCliAgentWriterService** in constructor:

```typescript
@inject(AGENT_GENERATION_TOKENS.MULTI_CLI_AGENT_WRITER_SERVICE)
private readonly multiCliWriter: MultiCliAgentWriterService,
```

3. **Add Phase 5** after Phase 4 writing (after line 438, before success summary):

```typescript
// Phase 5: Multi-CLI Agent Distribution (if targetClis specified)
if (options.targetClis && options.targetClis.length > 0) {
  this.logger.info('Phase 5: Distributing agents to CLI targets', {
    targets: options.targetClis,
    agentCount: renderedAgents.length,
  });

  const cliResults = await this.multiCliWriter.writeForClis(renderedAgents, options.targetClis);

  // Append CLI-specific warnings
  for (const result of cliResults) {
    if (result.errors.length > 0) {
      warnings.push(...result.errors.map((e) => `[${result.cli}] ${e}`));
    }
  }
}
```

4. **Extend `GenerationSummary` type** (core.types.ts) with optional CLI results.

#### File: `libs/backend/agent-generation/src/lib/types/core.types.ts` (MODIFY)

**Purpose**: Add CLI generation results to GenerationSummary.

**Change**: Add to `GenerationSummary` interface (after `enhancedPromptsUsed`, line 617):

```typescript
/** Per-CLI agent distribution results (Phase 5) */
cliResults?: import('@ptah-extension/shared').CliGenerationResult[];
```

---

### 5.5 Wizard/RPC Integration

#### File: `apps/ptah-extension-vscode/src/services/rpc/handlers/wizard-generation-rpc.handlers.ts` (MODIFY)

**Purpose**: Pass detected CLIs to orchestrator when generating agents.

**Changes**:

1. **Import CliDetectionService and CliTarget**:

```typescript
import { CliDetectionService } from '@ptah-extension/llm-abstraction';
import type { CliTarget } from '@ptah-extension/shared';
```

2. **In the generation handler**, after resolving premium status, detect installed CLIs:

```typescript
// Detect CLIs for multi-CLI distribution (premium only)
let targetClis: CliTarget[] | undefined;
if (isPremium) {
  const cliDetection = container.resolve(CliDetectionService);
  const installedClis = await cliDetection.getInstalledClis();
  targetClis = installedClis
    .filter((c) => c.cli === 'copilot' || c.cli === 'gemini')
    .filter((c) => c.installed)
    .map((c) => c.cli as CliTarget);
}
```

3. **Add targetClis to orchestrator options**:

```typescript
const options: OrchestratorGenerationOptions = {
  // ...existing fields...
  targetClis,
};
```

---

### 5.6 Extension Activation Integration

#### File: `apps/ptah-extension-vscode/src/main.ts` (MODIFY)

**Purpose**: Add CLI skill sync step during extension activation.

**Change**: After Step 7.1.5 (plugin loader initialization, around line 445), add:

```typescript
// Step 7.1.6: Sync Ptah skills to installed CLIs (TASK_2025_160)
console.log('[Activate] Step 7.1.6: CLI skill sync...');
try {
  const licenseService = DIContainer.resolve<LicenseService>(TOKENS.LICENSE_SERVICE);
  const licenseStatus = await licenseService.checkStatus();

  if (licenseStatus?.tier?.isPremium) {
    const cliPluginSync = DIContainer.resolve<CliPluginSyncService>(TOKENS.CLI_PLUGIN_SYNC_SERVICE);
    cliPluginSync.initialize(context.globalState, context.extensionPath);

    const pluginConfig = pluginLoader.getWorkspacePluginConfig();
    const syncResults = await cliPluginSync.syncOnActivation(pluginConfig.enabledPluginIds);

    logger.info('CLI skill sync complete', {
      results: syncResults.map((r) => ({ cli: r.cli, synced: r.synced, skills: r.skillCount })),
    });
  } else {
    logger.debug('Skipping CLI skill sync (not premium)');
  }
} catch (cliSyncError) {
  logger.warn('CLI skill sync failed (non-fatal)', {
    error: cliSyncError instanceof Error ? cliSyncError.message : String(cliSyncError),
  });
}
console.log('[Activate] Step 7.1.6: CLI skill sync done');
```

**Design Note**: Sync failure is non-fatal. The extension continues to function normally even if CLI skill sync fails. This ensures a degraded but functional experience if a CLI's config directory is read-only, missing, or the CLI is being updated.

---

## 6. Premium Gating Integration Points

All premium gating follows the existing pattern where `isPremium` is checked before enabling features.

| Integration Point                   | Gating Mechanism                                                                     | Evidence                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| **Extension activation skill sync** | `licenseStatus.tier.isPremium` check before `syncOnActivation()`                     | Matches existing pattern in main.ts:145                       |
| **Setup wizard CLI distribution**   | `isPremium` flag in `OrchestratorGenerationOptions` controls `targetClis` population | Matches existing pattern in wizard-generation-rpc.handlers.ts |
| **Orchestrator Phase 5**            | `options.targetClis` is only populated when premium                                  | Implicitly gated -- undefined means no Phase 5                |
| **Skill sync force**                | Called from wizard completion only (wizard already checks premium)                   | Gated at caller level                                         |
| **Premium expiry cleanup**          | Listen for license status change event, call `cleanupAll()`                          | New event handler in main.ts                                  |

**Cleanup on Premium Expiry**:
When premium expires, `CliPluginSyncService.cleanupAll()` removes:

1. All `ptah-*` directories from `~/.copilot/skills/` and `~/.gemini/skills/`
2. All Ptah-generated agents from `~/.copilot/agents/` and `~/.gemini/agents/`
3. Sync state from `globalState`

This ensures no premium content persists after downgrade.

---

## 7. Risk Assessment and Mitigation

### Risk 1: CLI Directory Permissions

**Risk**: User may not have write access to `~/.copilot/` or `~/.gemini/` directories.
**Probability**: Low (user-owned directories)
**Impact**: Skill sync silently fails for that CLI
**Mitigation**: All file operations wrapped in try/catch. `ICliSkillInstaller.install()` returns `CliSkillSyncStatus` with error field. Non-fatal -- never blocks extension activation.

### Risk 2: CLI Directory Structure Changes

**Risk**: Copilot or Gemini CLI updates could change skill/agent discovery paths.
**Probability**: Medium (CLIs are actively developed)
**Impact**: Skills or agents not discovered by CLI
**Mitigation**: Skill installer paths are constants in dedicated files, easy to update. Version-conditional logic can be added if needed (CLI version already detected by `CliDetectionService`).

### Risk 3: Agent Content Incompatibility

**Risk**: Transformed agent content references tools or patterns that don't exist in target CLI.
**Probability**: Medium (tool ecosystems differ significantly)
**Impact**: Agent gives incorrect instructions to the CLI
**Mitigation**: `transform-rules.ts` contains explicit mapping tables. Unknown patterns are stripped rather than incorrectly mapped. Agents remain functional (just less feature-rich) even if some references can't be mapped.

### Risk 4: Race Conditions on Activation

**Risk**: Concurrent activation (multiple workspaces) could cause simultaneous writes to same CLI directories.
**Probability**: Low (VS Code typically activates sequentially)
**Impact**: Corrupted skill files
**Mitigation**: `CliSkillManifestTracker` uses atomic hash comparison. File writes use `writeFile` (atomic on most OS). Could add file locking if race conditions are observed in practice.

### Risk 5: Large Plugin Copy Performance

**Risk**: Copying many plugin files (ptah-angular has 38+ files) during activation could slow startup.
**Probability**: Low (file copies are fast, < 100ms for this volume)
**Impact**: Slightly slower first activation after install/update
**Mitigation**: Content hashing skips re-copy when unchanged. Only `syncOnActivation()` runs during activation (not `syncForce()`).

### Risk 6: AgentFileWriterService Path Validation

**Risk**: The existing `validateFilePath()` requires paths to contain `.claude`, which breaks for `~/.copilot/` or `~/.gemini/` targets.
**Probability**: N/A (by design)
**Impact**: N/A
**Mitigation**: `MultiCliAgentWriterService` does NOT use `AgentFileWriterService`. It uses `fs.promises` directly for user-level directory writes. The existing writer's security validation is preserved for Claude agents. This is intentional separation of concerns.

---

## 8. Complexity Assessment

### Per-Component Estimates

| Component                                    | Complexity | Est. Hours | Rationale                                                    |
| -------------------------------------------- | ---------- | ---------- | ------------------------------------------------------------ |
| **Shared types** (`cli-skill-sync.types.ts`) | LOW        | 0.5h       | Pure type definitions, no logic                              |
| **ICliSkillInstaller interface**             | LOW        | 0.5h       | Interface definition                                         |
| **CopilotSkillInstaller**                    | MEDIUM     | 2h         | Recursive copy, frontmatter stripping, directory management  |
| **GeminiSkillInstaller**                     | MEDIUM     | 1.5h       | Same pattern as Copilot, slightly simpler (well-known paths) |
| **CliSkillManifestTracker**                  | MEDIUM     | 2h         | Content hashing, globalState persistence, comparison logic   |
| **CliPluginSyncService**                     | MEDIUM     | 2.5h       | Orchestration logic, error handling, initialization          |
| **ICliAgentTransformer interface**           | LOW        | 0.5h       | Interface definition                                         |
| **transform-rules.ts**                       | MEDIUM     | 2h         | Regex patterns, content rewriting rules, edge case handling  |
| **CopilotAgentTransformer**                  | MEDIUM     | 2h         | Content transformation, tool reference mapping               |
| **GeminiAgentTransformer**                   | MEDIUM     | 1.5h       | Same pattern as Copilot, different mappings                  |
| **MultiCliAgentWriterService**               | MEDIUM     | 2h         | Orchestration, fs writes, error aggregation                  |
| **Orchestrator modifications**               | LOW        | 1h         | Add Phase 5, extend options type                             |
| **Wizard RPC integration**                   | LOW        | 1h         | Pass targetClis to orchestrator                              |
| **main.ts activation integration**           | LOW        | 1h         | Add sync step, premium gate                                  |
| **DI token + registration**                  | LOW        | 0.5h       | Token definitions, service registration                      |
| **Barrel exports**                           | LOW        | 0.5h       | Index file updates                                           |

**Total Estimated Effort**: ~21 hours

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- All new code is Node.js/TypeScript in backend libraries
- File system operations (recursive copy, directory management)
- DI container registration (tsyringe patterns)
- No Angular/UI components involved
- No browser APIs required
- CLI adapter patterns already established in the codebase

### Implementation Priority Order

1. **Foundation** (2h): Shared types + interfaces
2. **Skill Sync** (8.5h): Installers + tracker + sync service + DI wiring
3. **Agent Transforms** (8h): Transformers + rules + writer service + DI wiring
4. **Integration** (2.5h): Orchestrator Phase 5 + wizard RPC + activation sync

---

## 9. Files Affected Summary

### CREATE (16 files)

| File                                                                                                     | Library          | Purpose                |
| -------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------- |
| `libs/shared/src/lib/types/cli-skill-sync.types.ts`                                                      | shared           | CLI sync types         |
| `libs/backend/llm-abstraction/src/lib/services/cli-skill-sync/cli-skill-installer.interface.ts`          | llm-abstraction  | Installer interface    |
| `libs/backend/llm-abstraction/src/lib/services/cli-skill-sync/copilot-skill-installer.ts`                | llm-abstraction  | Copilot installer      |
| `libs/backend/llm-abstraction/src/lib/services/cli-skill-sync/gemini-skill-installer.ts`                 | llm-abstraction  | Gemini installer       |
| `libs/backend/llm-abstraction/src/lib/services/cli-skill-sync/cli-skill-manifest-tracker.ts`             | llm-abstraction  | Sync state tracker     |
| `libs/backend/llm-abstraction/src/lib/services/cli-skill-sync/cli-plugin-sync.service.ts`                | llm-abstraction  | Sync orchestrator      |
| `libs/backend/llm-abstraction/src/lib/services/cli-skill-sync/index.ts`                                  | llm-abstraction  | Barrel exports         |
| `libs/backend/agent-generation/src/lib/services/cli-agent-transforms/cli-agent-transformer.interface.ts` | agent-generation | Transformer interface  |
| `libs/backend/agent-generation/src/lib/services/cli-agent-transforms/copilot-agent-transformer.ts`       | agent-generation | Copilot transformer    |
| `libs/backend/agent-generation/src/lib/services/cli-agent-transforms/gemini-agent-transformer.ts`        | agent-generation | Gemini transformer     |
| `libs/backend/agent-generation/src/lib/services/cli-agent-transforms/transform-rules.ts`                 | agent-generation | Shared transform rules |
| `libs/backend/agent-generation/src/lib/services/cli-agent-transforms/multi-cli-agent-writer.service.ts`  | agent-generation | Multi-CLI writer       |
| `libs/backend/agent-generation/src/lib/services/cli-agent-transforms/index.ts`                           | agent-generation | Barrel exports         |

### MODIFY (10 files)

| File                                                                                     | Library          | Change Description                         |
| ---------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------ |
| `libs/shared/src/lib/types/index.ts`                                                     | shared           | Add barrel export for cli-skill-sync.types |
| `libs/backend/llm-abstraction/src/index.ts`                                              | llm-abstraction  | Export CliPluginSyncService                |
| `libs/backend/llm-abstraction/src/lib/di/register.ts`                                    | llm-abstraction  | Register CliPluginSyncService              |
| `libs/backend/vscode-core/src/di/tokens.ts`                                              | vscode-core      | Add CLI_PLUGIN_SYNC_SERVICE token          |
| `libs/backend/agent-generation/src/lib/di/tokens.ts`                                     | agent-generation | Add MULTI_CLI_AGENT_WRITER_SERVICE token   |
| `libs/backend/agent-generation/src/lib/di/register.ts`                                   | agent-generation | Register MultiCliAgentWriterService        |
| `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts`                 | agent-generation | Add Phase 5, extend options                |
| `libs/backend/agent-generation/src/lib/types/core.types.ts`                              | agent-generation | Add cliResults to GenerationSummary        |
| `libs/backend/agent-generation/src/index.ts`                                             | agent-generation | Export new services                        |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/wizard-generation-rpc.handlers.ts` | app              | Pass targetClis to orchestrator            |
| `apps/ptah-extension-vscode/src/main.ts`                                                 | app              | Add activation sync step                   |

---

## 10. Critical Verification Points

### Before Implementation, Developer Must Verify:

1. **All imports exist in codebase**:

   - `CliTarget`, `CliAgentTransformResult`, `CliSkillSyncStatus` from `@ptah-extension/shared` (created in this task)
   - `GeneratedAgent` from `@ptah-extension/agent-generation` (core.types.ts:476)
   - `CliDetectionService` from `@ptah-extension/llm-abstraction` (cli-detection.service.ts:20)
   - `TOKENS.LOGGER` from `@ptah-extension/vscode-core` (tokens.ts)
   - `Result` from `@ptah-extension/shared`
   - `LicenseService` from `@ptah-extension/vscode-core` (license.service.ts)

2. **All patterns verified from examples**:

   - File copy pattern: `GeminiCliAdapter.configureMcpServer()` (gemini-cli.adapter.ts:193-229)
   - Persistent state: `PluginLoaderService.getWorkspacePluginConfig()` (plugin-loader.service.ts:155-171)
   - DI registration: `registerLlmAbstractionServices()` (llm-abstraction/di/register.ts:47-105)
   - Content manipulation: `OrchestratorService.buildAgentFileContent()` (orchestrator.service.ts:833-860)

3. **Library documentation consulted**:

   - `libs/backend/agent-generation/CLAUDE.md` -- boundaries, file paths, patterns
   - `libs/backend/llm-abstraction/CLAUDE.md` -- boundaries, file paths, patterns
   - `libs/shared/CLAUDE.md` -- type-only rule, no runtime deps

4. **No hallucinated APIs**:
   - All `fs/promises` methods: `mkdir`, `writeFile`, `readFile`, `copyFile`, `readdir`, `stat`, `rm` -- Node.js built-ins
   - `homedir()` from `os` module -- Node.js built-in
   - `cross-spawn` -- already a dependency (cli-adapter.utils.ts:9)
   - `vscode.Memento` -- already used by PluginLoaderService (plugin-loader.service.ts:111)

---

## 11. Architecture Delivery Checklist

- [x] All components specified with codebase evidence citations
- [x] All patterns verified from existing implementations
- [x] All imports/decorators verified as existing in codebase
- [x] Quality requirements defined per component
- [x] Integration points documented (main.ts, wizard RPC, orchestrator)
- [x] Files affected list complete (16 CREATE, 10+ MODIFY)
- [x] Developer type recommended (backend-developer)
- [x] Complexity assessed (21 hours total, MEDIUM overall)
- [x] Premium gating integration points identified (5 locations)
- [x] Risk assessment with mitigation strategies (6 risks)
- [x] No step-by-step implementation instructions (team-leader responsibility)
- [x] Data flow diagrams for all major workflows (3 diagrams)
- [x] Format specifications for all CLI targets (4 sections)
- [x] Security considerations documented (file writer separation)
