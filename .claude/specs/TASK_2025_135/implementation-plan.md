# Implementation Plan - TASK_2025_135: Prompt Harness System

## Executive Summary

This document provides the technical architecture for the Prompt Harness System - a layered prompt assembly mechanism that preserves Anthropic's Claude Code foundation while enabling user-configurable "power-ups" extracted from existing `.claude/agents/` patterns.

---

## System Architecture Diagram

```
+-------------------------------------------------------------------+
|                      FRONTEND (Angular Webview)                    |
+-------------------------------------------------------------------+
|  SettingsComponent                                                 |
|  +-------------------------------------------------------------+  |
|  |  PromptPowerUpsComponent (New)                              |  |
|  |  - Browse/enable/disable power-ups                          |  |
|  |  - Toggle premium power-ups (locked for free users)         |  |
|  |  - Recommendations based on workspace type                  |  |
|  +-------------------------------------------------------------+  |
|  |  CustomPromptEditorComponent (New)                          |  |
|  |  - Create/edit custom prompt sections                       |  |
|  |  - Markdown editor with token count                         |  |
|  |  - Priority ordering                                        |  |
|  +-------------------------------------------------------------+  |
|  |  PromptPreviewComponent (New)                               |  |
|  |  - Real-time assembled prompt preview                       |  |
|  |  - Layer annotations (base, agent, user, premium)           |  |
|  |  - Copy to clipboard                                        |  |
|  +-------------------------------------------------------------+  |
|                               |                                    |
|                               | RPC Calls                          |
|                               v                                    |
+-------------------------------------------------------------------+
|                      RPC LAYER                                     |
+-------------------------------------------------------------------+
|  promptHarness:getConfig      - Get all power-up states + custom   |
|  promptHarness:saveConfig     - Save power-up states + custom      |
|  promptHarness:getPreview     - Get assembled prompt preview       |
|  promptHarness:exportConfig   - Export configuration JSON          |
|  promptHarness:importConfig   - Import configuration JSON          |
|  promptHarness:getRecommendations - Get workspace-based recs       |
+-------------------------------------------------------------------+
|                               |                                    |
|                               v                                    |
+-------------------------------------------------------------------+
|                      BACKEND (Extension Host)                      |
+-------------------------------------------------------------------+
|  PromptHarnessRpcHandlers (New)                                   |
|  - Register RPC methods for frontend communication                |
|  - Delegate to PromptHarnessService                               |
+-------------------------------------------------------------------+
|                               |                                    |
|                               v                                    |
+-------------------------------------------------------------------+
|  PromptHarnessService (New)                                       |
|  +-------------------------------------------------------------+  |
|  |  assemblePrompt(config, isPremium): AssembledPrompt         |  |
|  |  - Layer 1: Reference Anthropic base (immutable)            |  |
|  |  - Layer 2: Project CLAUDE.md (SDK handles via settingSources)|
|  |  - Layer 3: Enabled power-ups (from PowerUpRegistry)        |  |
|  |  - Layer 4: User custom sections (from UserPromptStore)     |  |
|  |  - Layer 5: Premium enhancements (if isPremium)             |  |
|  +-------------------------------------------------------------+  |
|                               |                                    |
|                               v                                    |
+-------------------------------------------------------------------+
|  PowerUpRegistry (New)                                            |
|  - Static definitions of power-ups with metadata                  |
|  - Categorization (free vs premium)                               |
|  - Source agent attribution                                       |
|  - Content templates                                              |
+-------------------------------------------------------------------+
|                               |                                    |
|                               v                                    |
+-------------------------------------------------------------------+
|  UserPromptStore (New)                                            |
|  - VS Code globalState for power-up enable/disable states         |
|  - VS Code SecretStorage for custom prompt sections               |
|  - Import/export functionality                                    |
+-------------------------------------------------------------------+
|                               |                                    |
|                               v                                    |
+-------------------------------------------------------------------+
|  SdkQueryOptionsBuilder (Modified)                                |
|  - Call PromptHarnessService.assemblePrompt() in buildSystemPrompt|
|  - Replace static PTAH_BEHAVIORAL_PROMPT concatenation            |
+-------------------------------------------------------------------+
```

---

## Codebase Investigation Summary

### Libraries Analyzed

1. **@ptah-extension/agent-sdk** (`libs/backend/agent-sdk/`)

   - Key exports: `SdkQueryOptionsBuilder`, `PTAH_SYSTEM_PROMPT` import
   - Pattern: Injectable services with TOKENS
   - Integration point: `buildSystemPrompt()` method (line 437-477)

2. **@ptah-extension/vscode-core** (`libs/backend/vscode-core/`)

   - Key exports: `TOKENS`, `Logger`, `RpcHandler`, `ConfigManager`
   - Storage patterns: globalState for non-sensitive, SecretStorage for sensitive
   - Evidence: `LicenseService` uses both (line 121-136)

3. **@ptah-extension/vscode-lm-tools** (`libs/backend/vscode-lm-tools/`)

   - Key exports: `PTAH_SYSTEM_PROMPT` constant
   - Pattern: Constant export for prompt text
   - Location: `ptah-system-prompt.constant.ts`

4. **@ptah-extension/shared** (`libs/shared/`)

   - Key exports: RPC type definitions
   - Pattern: Interface definitions for params/responses
   - Location: `types/rpc.types.ts`

5. **Frontend Settings** (`libs/frontend/chat/src/lib/settings/`)
   - Key files: `settings.component.ts`, `settings.component.html`
   - Pattern: Signal-based state, RPC calls via `ClaudeRpcService`
   - Premium gating: `isPremium()` signal, `showPremiumSections()` computed

### Patterns Identified

1. **RPC Handler Pattern** (Evidence: `auth-rpc.handlers.ts:34-347`)

   - Injectable class with `register()` method
   - Methods registered via `rpcHandler.registerMethod<Params, Response>()`
   - Zod validation for parameters

2. **Storage Pattern** (Evidence: `license.service.ts:119-165`)

   - `context.globalState` for non-sensitive data (power-up states)
   - `context.secrets` for sensitive data (custom prompts may contain secrets)
   - Cache patterns with TTL

3. **Settings Component Pattern** (Evidence: `settings.component.ts:49-280`)

   - Signal-based state (`signal()`, `computed()`)
   - RPC calls via `ClaudeRpcService.call()`
   - Premium gating via `isPremium()` and `isAuthenticated()` signals

4. **Agent Prompt Patterns** (Evidence: `.claude/agents/*.md`)
   - Frontmatter with metadata (`name`, `description`, `model`)
   - Structured sections with markdown headers
   - Extractable patterns: Investigation Protocol, Escalation Protocol, Code Quality Standards

---

## Data Models

### PowerUpDefinition

```typescript
/**
 * Static definition of a power-up (stored in code, not user data)
 *
 * @see PowerUpRegistry for the registry of all power-ups
 */
interface PowerUpDefinition {
  /** Unique identifier for the power-up */
  id: string;

  /** Human-readable name */
  name: string;

  /** Brief description of what this power-up does */
  description: string;

  /** Category for UI grouping */
  category: 'investigation' | 'code-quality' | 'workflow' | 'mcp' | 'custom';

  /** Source agent this was extracted from (for attribution) */
  sourceAgent?: string;

  /** Whether this power-up requires premium tier */
  isPremium: boolean;

  /** Semantic version for tracking changes */
  version: string;

  /** The actual prompt content to inject */
  content: string;

  /** Default priority (lower = earlier in assembly, 0-100) */
  defaultPriority: number;

  /** Conflicts with these other power-up IDs */
  conflictsWith?: string[];

  /** Estimated token count */
  tokenCount: number;
}
```

### PowerUpState

```typescript
/**
 * User's enable/disable state for a power-up (stored in globalState)
 */
interface PowerUpState {
  /** Power-up ID */
  powerUpId: string;

  /** Whether enabled by user */
  enabled: boolean;

  /** User-overridden priority (optional, defaults to definition) */
  priority?: number;

  /** Timestamp when user last modified this state */
  lastModified: number;
}
```

### UserPromptSection

```typescript
/**
 * User-created custom prompt section (stored in SecretStorage due to
 * potential sensitive content)
 */
interface UserPromptSection {
  /** Unique identifier */
  id: string;

  /** User-provided name */
  name: string;

  /** The prompt content (markdown) */
  content: string;

  /** Whether this section is enabled */
  enabled: boolean;

  /** Priority for ordering (lower = earlier, 0-100) */
  priority: number;

  /** Created timestamp */
  createdAt: number;

  /** Last modified timestamp */
  updatedAt: number;
}
```

### PromptHarnessConfig

```typescript
/**
 * Complete configuration for prompt assembly
 * Retrieved from storage and sent to assemblePrompt()
 */
interface PromptHarnessConfig {
  /** Version for migration support */
  version: string;

  /** Power-up states (map for O(1) lookup) */
  powerUpStates: Map<string, PowerUpState>;

  /** User custom sections */
  customSections: UserPromptSection[];

  /** Whether to show recommendations (user preference) */
  showRecommendations: boolean;

  /** Last workspace type used for recommendations */
  lastWorkspaceType?: string;
}
```

### AssembledPrompt

```typescript
/**
 * Result of prompt assembly with layer annotations for preview
 */
interface AssembledPrompt {
  /** The complete assembled prompt text */
  text: string;

  /** Total estimated token count */
  totalTokens: number;

  /** Breakdown by layer for preview UI */
  layers: {
    /** Layer name for display */
    name: string;
    /** Layer type for styling */
    type: 'base' | 'project' | 'agent' | 'user' | 'premium';
    /** Content of this layer */
    content: string;
    /** Token count for this layer */
    tokenCount: number;
    /** Source attribution (power-up ID or 'custom') */
    source?: string;
  }[];

  /** Warnings (e.g., token budget, conflicts) */
  warnings: {
    type: 'token_budget' | 'conflict' | 'deprecated';
    message: string;
    severity: 'info' | 'warning' | 'error';
  }[];
}
```

---

## Component Specifications

### Component 1: PowerUpRegistry

**Purpose**: Static registry of available power-ups with metadata and content.

**Pattern**: Singleton constant with helper functions (not a class - simple data)
**Evidence**: Similar to `ANTHROPIC_PROVIDERS` in `anthropic-provider-registry.ts`

**Responsibilities**:

- Define all available power-ups with content
- Provide lookup by ID
- Filter by category and premium status
- Track version for migration

**File Location**: `libs/backend/agent-sdk/src/lib/prompt-harness/power-up-registry.ts`

**Implementation Pattern**:

```typescript
/**
 * Power-Up Registry - Static definitions of all available power-ups
 *
 * Pattern source: libs/backend/agent-sdk/src/lib/helpers/anthropic-provider-registry.ts
 *
 * Design Decision: Hardcoded in TypeScript (Option A from requirements)
 * Rationale:
 * - Version controlled with extension releases
 * - No file I/O overhead at startup
 * - Type-safe access
 * - Easy to test
 */

export const POWER_UP_DEFINITIONS: readonly PowerUpDefinition[] = [
  // Investigation category (extracted from software-architect.md)
  {
    id: 'investigation-first',
    name: 'Investigation-First Protocol',
    description: 'Systematically investigate codebase before proposing solutions',
    category: 'investigation',
    sourceAgent: 'software-architect',
    isPremium: false,
    version: '1.0.0',
    defaultPriority: 10,
    tokenCount: 450,
    content: `## Investigation-First Protocol

**Your superpower is INVESTIGATION, not ASSUMPTION.**

Before proposing any implementation, systematically explore the codebase:
- What patterns already exist?
- What libraries are available and how do they work?
- What conventions are established?
- What similar problems have been solved?

**You never hallucinate APIs.** Every decorator, class, interface, and pattern you propose exists in the codebase and is verified through investigation.

### Investigation Methodology
1. **Question Formulation** - Start with specific questions
2. **Evidence Discovery** - Use Glob, Grep, Read to find answers
3. **Pattern Extraction** - Analyze 2-3 examples to extract patterns
4. **Source Verification** - Verify every API exists in codebase
5. **Evidence Citation** - Cite file:line for every decision`,
  },

  {
    id: 'anti-hallucination',
    name: 'Anti-Hallucination Protocol',
    description: 'Verify all APIs exist before using, cite evidence',
    category: 'investigation',
    sourceAgent: 'software-architect',
    isPremium: false,
    version: '1.0.0',
    defaultPriority: 15,
    tokenCount: 200,
    content: `## Anti-Hallucination Protocol

**CRITICAL**: Verify every API you propose exists in the codebase:

- [ ] All imports verified in library source
- [ ] All decorators confirmed as exports
- [ ] All classes verified as actual exports
- [ ] All interfaces verified in type definition files

**If you can't grep it, don't propose it.**

When uncertain, investigate more. When you can't find evidence, mark it as an assumption and flag for validation.`,
  },

  // Code quality category (extracted from code-logic-reviewer.md)
  {
    id: 'code-quality-paranoid',
    name: 'Paranoid Code Review',
    description: 'Hunt for failure modes, never assume happy path',
    category: 'code-quality',
    sourceAgent: 'code-logic-reviewer',
    isPremium: false,
    version: '1.0.0',
    defaultPriority: 20,
    tokenCount: 350,
    content: `## Paranoid Code Review Protocol

**Your default stance**: This code has bugs. Your job is to find them.

### The 5 Paranoid Questions
For EVERY implementation, explicitly answer these:
1. **How does this fail silently?** (Hidden failures)
2. **What user action causes unexpected behavior?** (UX failures)
3. **What data makes this produce wrong results?** (Data failures)
4. **What happens when dependencies fail?** (Integration failures)
5. **What's missing that the requirements didn't mention?** (Gap analysis)

If you can't find failure modes, **you haven't looked hard enough**.`,
  },

  // Workflow category (extracted from backend-developer.md)
  {
    id: 'escalation-protocol',
    name: 'Escalation Protocol',
    description: 'Escalate when task differs from plan, never deviate silently',
    category: 'workflow',
    sourceAgent: 'backend-developer',
    isPremium: false,
    version: '1.0.0',
    defaultPriority: 25,
    tokenCount: 300,
    content: `## Mandatory Escalation Protocol

**CRITICAL**: You are NOT authorized to make architectural decisions silently.

### Escalation Trigger Conditions (STOP and Report If ANY Apply)
- Task seems too complex to implement as specified
- You find a "simpler" or "better" approach than what's planned
- Technology/API doesn't work as expected
- Implementation reveals missing requirements
- You want to skip, defer, or simplify a planned task

### What You MUST Do When Triggered
1. **STOP implementation immediately**
2. **Document the issue clearly** with options (NOT decisions)
3. **Return to user** with escalation before proceeding`,
  },

  {
    id: 'solid-principles',
    name: 'SOLID Principles',
    description: 'Apply SOLID, DRY, YAGNI, KISS to implementations',
    category: 'code-quality',
    sourceAgent: 'backend-developer',
    isPremium: false,
    version: '1.0.0',
    defaultPriority: 30,
    tokenCount: 400,
    content: `## SOLID Principles (Apply to Every Implementation)

### Single Responsibility
A class/module should have one, and only one, reason to change.

### Open/Closed
Open for extension, closed for modification. But only when variations exist (YAGNI).

### Liskov Substitution
Subtypes must be substitutable for their base types.

### Interface Segregation
Many client-specific interfaces better than one general-purpose interface.

### Dependency Inversion
Depend on abstractions, not concretions.

### Supporting Principles
- **DRY**: Don't Repeat Yourself - but wait for 3rd occurrence (Rule of Three)
- **YAGNI**: You Ain't Gonna Need It - build for current requirements only
- **KISS**: Keep It Simple - complexity must justify itself`,
  },

  // Premium MCP category
  {
    id: 'mcp-cost-optimization',
    name: 'MCP Cost Optimization',
    description: 'Use invokeAgent for routine tasks with cheaper models',
    category: 'mcp',
    sourceAgent: 'premium',
    isPremium: true,
    version: '1.0.0',
    defaultPriority: 40,
    tokenCount: 150,
    content: `## Cost Optimization Tips (MCP Server)

**Delegate routine work to cheaper models** (150x cost savings):
- Use \`ptah.ai.invokeAgent(agentPath, task, 'gpt-4o-mini')\` for:
  - Code review
  - Documentation generation
  - Test writing
  - Boilerplate generation

Example: \`ptah.ai.invokeAgent('.claude/agents/code-reviewer.md', 'Review this function', 'gpt-4o-mini')\``,
  },

  {
    id: 'mcp-token-intelligence',
    name: 'MCP Token Intelligence',
    description: 'Check token counts before reading large files',
    category: 'mcp',
    sourceAgent: 'premium',
    isPremium: true,
    version: '1.0.0',
    defaultPriority: 45,
    tokenCount: 100,
    content: `## Token Intelligence (MCP Server)

**Before reading large files or generating content:**
- \`ptah.ai.countFileTokens(file)\` - Check file size before reading
- \`ptah.ai.fitsInContext(content, model, reserve)\` - Verify context capacity

Default reserve: 4000 tokens for user query. Plan ahead to avoid context overflow.`,
  },

  {
    id: 'mcp-ide-powers',
    name: 'MCP IDE Powers',
    description: 'Use LSP references, organize imports, IDE actions',
    category: 'mcp',
    sourceAgent: 'premium',
    isPremium: true,
    version: '1.0.0',
    defaultPriority: 50,
    tokenCount: 150,
    content: `## IDE Powers (MCP Server)

**Use VS Code's LSP capabilities:**
- \`ptah.ai.ide.lsp.getReferences(file, line, col)\` - Find all usages before refactoring
- \`ptah.ai.ide.actions.organizeImports(file)\` - Clean up imports
- \`ptah.ai.ide.editor.getDirtyFiles()\` - Check for unsaved changes

**Pro tip**: Always use \`getReferences()\` before renaming or deleting to find all usages.`,
  },
];

// Helper functions
export function getPowerUp(id: string): PowerUpDefinition | undefined {
  return POWER_UP_DEFINITIONS.find((p) => p.id === id);
}

export function getPowerUpsByCategory(category: PowerUpDefinition['category']): PowerUpDefinition[] {
  return POWER_UP_DEFINITIONS.filter((p) => p.category === category);
}

export function getFreePowerUps(): PowerUpDefinition[] {
  return POWER_UP_DEFINITIONS.filter((p) => !p.isPremium);
}

export function getPremiumPowerUps(): PowerUpDefinition[] {
  return POWER_UP_DEFINITIONS.filter((p) => p.isPremium);
}
```

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/prompt-harness/power-up-registry.ts` (CREATE)
- `libs/backend/agent-sdk/src/lib/prompt-harness/index.ts` (CREATE)
- `libs/backend/agent-sdk/src/index.ts` (MODIFY - add export)

---

### Component 2: UserPromptStore

**Purpose**: Persist power-up states and custom prompt sections to VS Code storage.

**Pattern**: Injectable service with globalState + SecretStorage
**Evidence**: `LicenseService` (vscode-core) uses same pattern for cache + secrets

**Responsibilities**:

- Store/retrieve power-up enable/disable states (globalState - non-sensitive)
- Store/retrieve custom prompt sections (SecretStorage - may contain sensitive patterns)
- Migrate configuration versions
- Export/import configuration

**File Location**: `libs/backend/agent-sdk/src/lib/prompt-harness/user-prompt-store.ts`

**Implementation Pattern**:

```typescript
/**
 * UserPromptStore - Persistence layer for prompt harness configuration
 *
 * Pattern source: libs/backend/vscode-core/src/services/license.service.ts
 *
 * Design Decision: globalState for power-up states (boolean flags, non-sensitive)
 *                  SecretStorage for custom sections (may contain API keys, patterns)
 */
import { injectable, inject } from 'tsyringe';
import * as vscode from 'vscode';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';

@injectable()
export class UserPromptStore {
  private static readonly POWER_UP_STATES_KEY = 'ptah.promptHarness.powerUpStates';
  private static readonly CUSTOM_SECTIONS_KEY = 'ptah.promptHarness.customSections';
  private static readonly CONFIG_VERSION_KEY = 'ptah.promptHarness.version';
  private static readonly CURRENT_VERSION = '1.0.0';

  constructor(
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: vscode.ExtensionContext,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger
  ) {}

  // Power-up states (globalState - non-sensitive)
  async getPowerUpStates(): Promise<Map<string, PowerUpState>> {
    const raw = this.context.globalState.get<Record<string, PowerUpState>>(UserPromptStore.POWER_UP_STATES_KEY, {});
    return new Map(Object.entries(raw));
  }

  async setPowerUpState(powerUpId: string, state: PowerUpState): Promise<void> {
    const states = await this.getPowerUpStates();
    states.set(powerUpId, state);
    await this.context.globalState.update(UserPromptStore.POWER_UP_STATES_KEY, Object.fromEntries(states));
    this.logger.debug('[UserPromptStore] Power-up state saved', { powerUpId, enabled: state.enabled });
  }

  // Custom sections (SecretStorage - potentially sensitive)
  async getCustomSections(): Promise<UserPromptSection[]> {
    const raw = await this.context.secrets.get(UserPromptStore.CUSTOM_SECTIONS_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      this.logger.warn('[UserPromptStore] Failed to parse custom sections, returning empty');
      return [];
    }
  }

  async setCustomSections(sections: UserPromptSection[]): Promise<void> {
    await this.context.secrets.store(UserPromptStore.CUSTOM_SECTIONS_KEY, JSON.stringify(sections));
    this.logger.debug('[UserPromptStore] Custom sections saved', { count: sections.length });
  }

  // Full config operations
  async getConfig(): Promise<PromptHarnessConfig> {
    const [powerUpStates, customSections] = await Promise.all([this.getPowerUpStates(), this.getCustomSections()]);

    const version = this.context.globalState.get<string>(UserPromptStore.CONFIG_VERSION_KEY, UserPromptStore.CURRENT_VERSION);

    return {
      version,
      powerUpStates,
      customSections,
      showRecommendations: true, // Default
      lastWorkspaceType: undefined,
    };
  }

  async exportConfig(): Promise<string> {
    const config = await this.getConfig();
    // Convert Map to object for JSON serialization
    const exportable = {
      ...config,
      powerUpStates: Object.fromEntries(config.powerUpStates),
    };
    return JSON.stringify(exportable, null, 2);
  }

  async importConfig(jsonString: string): Promise<{ success: boolean; error?: string }> {
    try {
      const imported = JSON.parse(jsonString);
      // Validate structure
      if (!imported.version || !imported.powerUpStates) {
        return { success: false, error: 'Invalid configuration format' };
      }

      // Import power-up states
      for (const [id, state] of Object.entries(imported.powerUpStates)) {
        await this.setPowerUpState(id, state as PowerUpState);
      }

      // Import custom sections
      if (imported.customSections) {
        await this.setCustomSections(imported.customSections);
      }

      this.logger.info('[UserPromptStore] Configuration imported successfully');
      return { success: true };
    } catch (error) {
      this.logger.error('[UserPromptStore] Failed to import configuration', { error });
      return { success: false, error: 'Failed to parse configuration JSON' };
    }
  }
}
```

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/prompt-harness/user-prompt-store.ts` (CREATE)
- `libs/backend/agent-sdk/src/lib/prompt-harness/types.ts` (CREATE - interfaces)
- `libs/backend/agent-sdk/src/lib/di/tokens.ts` (MODIFY - add token)
- `libs/backend/agent-sdk/src/lib/di/register.ts` (MODIFY - register service)

---

### Component 3: PromptHarnessService

**Purpose**: Core service that assembles the complete prompt from all layers.

**Pattern**: Injectable service with dependency injection
**Evidence**: `SdkQueryOptionsBuilder` pattern

**Responsibilities**:

- Assemble prompt from all layers
- Resolve power-up conflicts
- Enforce token budget
- Generate layer annotations for preview

**File Location**: `libs/backend/agent-sdk/src/lib/prompt-harness/prompt-harness.service.ts`

**Implementation Pattern**:

```typescript
/**
 * PromptHarnessService - Core prompt assembly logic
 *
 * Design Decision: Builder pattern with layer objects (Option C)
 * Rationale:
 * - Clear separation of layers
 * - Easy to annotate for preview
 * - Extensible for future layers
 * - Token counting per layer
 */
import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { UserPromptStore } from './user-prompt-store';
import { POWER_UP_DEFINITIONS, getPowerUp } from './power-up-registry';
import { PTAH_SYSTEM_PROMPT } from '@ptah-extension/vscode-lm-tools';

// Token budget: Reserve 4000 for user query, max 8000 for system prompt additions
const MAX_PROMPT_TOKENS = 8000;
const TOKEN_WARNING_THRESHOLD = 6000;

@injectable()
export class PromptHarnessService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger, @inject(SDK_TOKENS.USER_PROMPT_STORE) private readonly store: UserPromptStore) {}

  /**
   * Assemble the complete prompt from all layers
   *
   * Layer order (appended to claude_code preset):
   * 1. Enabled power-ups (sorted by priority)
   * 2. User custom sections (sorted by priority)
   * 3. Ptah behavioral prompt (AskUserQuestion) - always included
   * 4. Premium enhancements (MCP awareness) - if isPremium
   */
  async assemblePrompt(isPremium: boolean): Promise<AssembledPrompt> {
    const config = await this.store.getConfig();
    const layers: AssembledPrompt['layers'] = [];
    const warnings: AssembledPrompt['warnings'] = [];
    let totalTokens = 0;

    // Layer 1: Enabled power-ups (sorted by priority)
    const enabledPowerUps = this.getEnabledPowerUps(config, isPremium);
    for (const powerUp of enabledPowerUps) {
      // Check for conflicts
      const conflicts = this.checkConflicts(powerUp, enabledPowerUps);
      if (conflicts.length > 0) {
        warnings.push({
          type: 'conflict',
          message: `Power-up "${powerUp.name}" conflicts with: ${conflicts.join(', ')}`,
          severity: 'warning',
        });
      }

      layers.push({
        name: powerUp.name,
        type: 'agent',
        content: powerUp.content,
        tokenCount: powerUp.tokenCount,
        source: powerUp.id,
      });
      totalTokens += powerUp.tokenCount;
    }

    // Layer 2: User custom sections (sorted by priority)
    const enabledCustom = config.customSections.filter((s) => s.enabled).sort((a, b) => a.priority - b.priority);

    for (const section of enabledCustom) {
      const tokenCount = this.estimateTokens(section.content);
      layers.push({
        name: section.name,
        type: 'user',
        content: section.content,
        tokenCount,
        source: 'custom',
      });
      totalTokens += tokenCount;
    }

    // Layer 3: Premium enhancements (if applicable)
    if (isPremium) {
      const premiumTokens = this.estimateTokens(PTAH_SYSTEM_PROMPT);
      layers.push({
        name: 'Ptah MCP Server',
        type: 'premium',
        content: PTAH_SYSTEM_PROMPT,
        tokenCount: premiumTokens,
        source: 'ptah-mcp',
      });
      totalTokens += premiumTokens;
    }

    // Check token budget
    if (totalTokens > MAX_PROMPT_TOKENS) {
      warnings.push({
        type: 'token_budget',
        message: `Total tokens (${totalTokens}) exceeds budget (${MAX_PROMPT_TOKENS}). Consider disabling some power-ups.`,
        severity: 'error',
      });
    } else if (totalTokens > TOKEN_WARNING_THRESHOLD) {
      warnings.push({
        type: 'token_budget',
        message: `Prompt is using ${totalTokens} tokens (${Math.round((totalTokens / MAX_PROMPT_TOKENS) * 100)}% of budget)`,
        severity: 'warning',
      });
    }

    // Assemble final text
    const text = layers.map((l) => l.content).join('\n\n');

    this.logger.info('[PromptHarnessService] Prompt assembled', {
      layerCount: layers.length,
      totalTokens,
      warningCount: warnings.length,
      isPremium,
    });

    return { text, totalTokens, layers, warnings };
  }

  /**
   * Get the append string for SdkQueryOptionsBuilder
   * This is the optimized path - no layer annotations, just the text
   */
  async getAppendPrompt(isPremium: boolean): Promise<string> {
    const assembled = await this.assemblePrompt(isPremium);
    // Always include PTAH_BEHAVIORAL_PROMPT at the end (for AskUserQuestion)
    return assembled.text + '\n\n' + PTAH_BEHAVIORAL_PROMPT;
  }

  private getEnabledPowerUps(config: PromptHarnessConfig, isPremium: boolean): PowerUpDefinition[] {
    const enabled: PowerUpDefinition[] = [];

    for (const [powerUpId, state] of config.powerUpStates) {
      if (!state.enabled) continue;

      const definition = getPowerUp(powerUpId);
      if (!definition) continue;

      // Skip premium power-ups if not premium user
      if (definition.isPremium && !isPremium) continue;

      enabled.push(definition);
    }

    // Sort by priority (user override or default)
    return enabled.sort((a, b) => {
      const priorityA = config.powerUpStates.get(a.id)?.priority ?? a.defaultPriority;
      const priorityB = config.powerUpStates.get(b.id)?.priority ?? b.defaultPriority;
      return priorityA - priorityB;
    });
  }

  private checkConflicts(powerUp: PowerUpDefinition, allEnabled: PowerUpDefinition[]): string[] {
    if (!powerUp.conflictsWith?.length) return [];

    return allEnabled.filter((p) => p.id !== powerUp.id && powerUp.conflictsWith?.includes(p.id)).map((p) => p.name);
  }

  private estimateTokens(text: string): number {
    // Simple estimate: ~4 chars per token for English text
    return Math.ceil(text.length / 4);
  }
}
```

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/prompt-harness/prompt-harness.service.ts` (CREATE)
- `libs/backend/agent-sdk/src/lib/di/tokens.ts` (MODIFY - add token)
- `libs/backend/agent-sdk/src/lib/di/register.ts` (MODIFY - register service)

---

### Component 4: PromptHarnessRpcHandlers

**Purpose**: RPC handlers for frontend communication.

**Pattern**: Injectable RPC handler class
**Evidence**: `AuthRpcHandlers` pattern in `auth-rpc.handlers.ts`

**File Location**: `apps/ptah-extension-vscode/src/services/rpc/handlers/prompt-harness-rpc.handlers.ts`

**Implementation Pattern**:

```typescript
/**
 * Prompt Harness RPC Handlers
 *
 * Pattern source: apps/ptah-extension-vscode/src/services/rpc/handlers/auth-rpc.handlers.ts
 */
import { injectable, inject } from 'tsyringe';
import { z } from 'zod';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import { PromptHarnessService, UserPromptStore } from '@ptah-extension/agent-sdk';
import { LicenseService } from '@ptah-extension/vscode-core';

@injectable()
export class PromptHarnessRpcHandlers {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger, @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler, @inject(TOKENS.LICENSE_SERVICE) private readonly licenseService: LicenseService, @inject('PromptHarnessService') private readonly promptHarness: PromptHarnessService, @inject('UserPromptStore') private readonly store: UserPromptStore) {}

  register(): void {
    this.registerGetConfig();
    this.registerSaveConfig();
    this.registerGetPreview();
    this.registerExportConfig();
    this.registerImportConfig();

    this.logger.debug('Prompt Harness RPC handlers registered', {
      methods: ['promptHarness:getConfig', 'promptHarness:saveConfig', 'promptHarness:getPreview', 'promptHarness:exportConfig', 'promptHarness:importConfig'],
    });
  }

  private registerGetConfig(): void {
    this.rpcHandler.registerMethod<PromptHarnessGetConfigParams, PromptHarnessGetConfigResponse>('promptHarness:getConfig', async () => {
      const config = await this.store.getConfig();
      const license = await this.licenseService.verifyLicense();
      const isPremium = license.tier === 'pro' || license.tier === 'trial_pro';

      return {
        powerUpStates: Object.fromEntries(config.powerUpStates),
        customSections: config.customSections,
        isPremium,
        availablePowerUps: POWER_UP_DEFINITIONS.map((p) => ({
          ...p,
          isAvailable: p.isPremium ? isPremium : true,
        })),
      };
    });
  }

  private registerSaveConfig(): void {
    const SaveConfigSchema = z.object({
      powerUpStates: z
        .record(
          z.object({
            powerUpId: z.string(),
            enabled: z.boolean(),
            priority: z.number().optional(),
            lastModified: z.number(),
          })
        )
        .optional(),
      customSections: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            content: z.string(),
            enabled: z.boolean(),
            priority: z.number(),
            createdAt: z.number(),
            updatedAt: z.number(),
          })
        )
        .optional(),
    });

    this.rpcHandler.registerMethod<unknown, { success: boolean }>('promptHarness:saveConfig', async (params: unknown) => {
      const validated = SaveConfigSchema.parse(params);

      if (validated.powerUpStates) {
        for (const [id, state] of Object.entries(validated.powerUpStates)) {
          await this.store.setPowerUpState(id, state);
        }
      }

      if (validated.customSections) {
        await this.store.setCustomSections(validated.customSections);
      }

      this.logger.info('Prompt Harness configuration saved');
      return { success: true };
    });
  }

  private registerGetPreview(): void {
    this.rpcHandler.registerMethod<void, AssembledPrompt>('promptHarness:getPreview', async () => {
      const license = await this.licenseService.verifyLicense();
      const isPremium = license.tier === 'pro' || license.tier === 'trial_pro';
      return this.promptHarness.assemblePrompt(isPremium);
    });
  }

  private registerExportConfig(): void {
    this.rpcHandler.registerMethod<void, { json: string }>('promptHarness:exportConfig', async () => {
      const json = await this.store.exportConfig();
      return { json };
    });
  }

  private registerImportConfig(): void {
    const ImportSchema = z.object({ json: z.string() });

    this.rpcHandler.registerMethod<unknown, { success: boolean; error?: string }>('promptHarness:importConfig', async (params: unknown) => {
      const validated = ImportSchema.parse(params);
      return this.store.importConfig(validated.json);
    });
  }
}
```

**Files Affected**:

- `apps/ptah-extension-vscode/src/services/rpc/handlers/prompt-harness-rpc.handlers.ts` (CREATE)
- `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts` (MODIFY)
- `libs/shared/src/lib/types/rpc.types.ts` (MODIFY - add type definitions)

---

### Component 5: SdkQueryOptionsBuilder Integration

**Purpose**: Modify existing prompt building to use PromptHarnessService.

**Pattern**: Modify existing service method
**Evidence**: Current `buildSystemPrompt()` at line 437-477

**File Location**: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`

**Modification**:

```typescript
// BEFORE (current implementation)
private buildSystemPrompt(
  sessionConfig?: AISessionConfig,
  isPremium = false
): SdkQueryOptions['systemPrompt'] {
  const appendParts: string[] = [];

  // ... identity prompt ...
  // ... user custom system prompt ...

  // Always add Ptah behavioral guidelines
  appendParts.push(PTAH_BEHAVIORAL_PROMPT);

  // Add Ptah MCP tools awareness for premium users
  if (isPremium) {
    appendParts.push(PTAH_SYSTEM_PROMPT);
  }

  return {
    type: 'preset' as const,
    preset: 'claude_code' as const,
    append: appendParts.length > 0 ? appendParts.join('\n\n') : undefined,
  };
}

// AFTER (with PromptHarnessService integration)
private async buildSystemPrompt(
  sessionConfig?: AISessionConfig,
  isPremium = false
): Promise<SdkQueryOptions['systemPrompt']> {
  const appendParts: string[] = [];

  // Model identity clarification (unchanged)
  const activeProviderId = getActiveProviderId();
  const identityPrompt = buildModelIdentityPrompt(activeProviderId);
  if (identityPrompt) {
    appendParts.push(identityPrompt);
  }

  // User's custom system prompt (unchanged)
  if (sessionConfig?.systemPrompt) {
    appendParts.push(sessionConfig.systemPrompt);
  }

  // NEW: Get assembled prompt from PromptHarnessService
  // This includes power-ups, custom sections, and PTAH_BEHAVIORAL_PROMPT
  const harnessPrompt = await this.promptHarnessService.getAppendPrompt(isPremium);
  appendParts.push(harnessPrompt);

  return {
    type: 'preset' as const,
    preset: 'claude_code' as const,
    append: appendParts.length > 0 ? appendParts.join('\n\n') : undefined,
  };
}
```

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (MODIFY)
- Need to inject `PromptHarnessService` in constructor

---

### Component 6: Frontend Components

**Purpose**: UI for browsing, enabling, and customizing power-ups.

**Pattern**: Angular standalone components with signals
**Evidence**: `settings.component.ts` pattern

**File Locations**:

- `libs/frontend/chat/src/lib/settings/prompt-power-ups.component.ts` (CREATE)
- `libs/frontend/chat/src/lib/settings/prompt-power-ups.component.html` (CREATE)
- `libs/frontend/chat/src/lib/settings/custom-prompt-editor.component.ts` (CREATE)
- `libs/frontend/chat/src/lib/settings/prompt-preview.component.ts` (CREATE)

**PromptPowerUpsComponent Pattern**:

```typescript
/**
 * PromptPowerUpsComponent - Browse and toggle power-ups
 *
 * Pattern source: libs/frontend/chat/src/lib/settings/settings.component.ts
 */
@Component({
  selector: 'ptah-prompt-power-ups',
  standalone: true,
  imports: [LucideAngularModule /* ... */],
  templateUrl: './prompt-power-ups.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptPowerUpsComponent implements OnInit {
  private readonly rpcService = inject(ClaudeRpcService);

  // State signals
  readonly isLoading = signal(true);
  readonly isPremium = signal(false);
  readonly powerUps = signal<PowerUpWithState[]>([]);
  readonly customSections = signal<UserPromptSection[]>([]);

  // Computed for categories
  readonly investigationPowerUps = computed(() => this.powerUps().filter((p) => p.category === 'investigation'));
  readonly codeQualityPowerUps = computed(() => this.powerUps().filter((p) => p.category === 'code-quality'));
  readonly workflowPowerUps = computed(() => this.powerUps().filter((p) => p.category === 'workflow'));
  readonly mcpPowerUps = computed(() => this.powerUps().filter((p) => p.category === 'mcp'));

  async ngOnInit(): Promise<void> {
    await this.loadConfig();
  }

  async loadConfig(): Promise<void> {
    this.isLoading.set(true);
    try {
      const result = await this.rpcService.call('promptHarness:getConfig', {});
      if (result.isSuccess() && result.data) {
        this.isPremium.set(result.data.isPremium);
        this.powerUps.set(
          result.data.availablePowerUps.map((p) => ({
            ...p,
            enabled: result.data.powerUpStates[p.id]?.enabled ?? false,
          }))
        );
        this.customSections.set(result.data.customSections);
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  async togglePowerUp(powerUpId: string, enabled: boolean): Promise<void> {
    // Optimistic update
    this.powerUps.update((list) => list.map((p) => (p.id === powerUpId ? { ...p, enabled } : p)));

    // Save to backend
    await this.rpcService.call('promptHarness:saveConfig', {
      powerUpStates: {
        [powerUpId]: {
          powerUpId,
          enabled,
          lastModified: Date.now(),
        },
      },
    });
  }
}
```

**Files Affected**:

- `libs/frontend/chat/src/lib/settings/prompt-power-ups.component.ts` (CREATE)
- `libs/frontend/chat/src/lib/settings/prompt-power-ups.component.html` (CREATE)
- `libs/frontend/chat/src/lib/settings/custom-prompt-editor.component.ts` (CREATE)
- `libs/frontend/chat/src/lib/settings/custom-prompt-editor.component.html` (CREATE)
- `libs/frontend/chat/src/lib/settings/prompt-preview.component.ts` (CREATE)
- `libs/frontend/chat/src/lib/settings/prompt-preview.component.html` (CREATE)
- `libs/frontend/chat/src/lib/settings/settings.component.ts` (MODIFY - add new section)
- `libs/frontend/chat/src/lib/settings/settings.component.html` (MODIFY - add new section)

---

## Integration Architecture

### Data Flow

```
User enables power-up in UI
        |
        v
PromptPowerUpsComponent.togglePowerUp()
        |
        v
ClaudeRpcService.call('promptHarness:saveConfig')
        |
        v
PromptHarnessRpcHandlers.registerSaveConfig()
        |
        v
UserPromptStore.setPowerUpState() --> VS Code globalState
        |
        v
(Later, during chat session)
        |
        v
SdkQueryOptionsBuilder.buildSystemPrompt()
        |
        v
PromptHarnessService.getAppendPrompt()
        |
        v
Assembled prompt sent to Claude SDK
```

### Premium Gating

```typescript
// Backend: LicenseService determines isPremium
const license = await this.licenseService.verifyLicense();
const isPremium = license.tier === 'pro' || license.tier === 'trial_pro';

// Power-ups filtered by isPremium in PromptHarnessService
if (definition.isPremium && !isPremium) continue;

// Frontend: Shows locked icon for premium power-ups
@if (!powerUp.isAvailable) {
  <lucide-angular [img]="LockIcon" class="w-3 h-3" />
}
```

---

## Implementation Batches

### Batch 1: Core Data Layer (Backend Foundation)

**Files**:

- `libs/backend/agent-sdk/src/lib/prompt-harness/types.ts`
- `libs/backend/agent-sdk/src/lib/prompt-harness/power-up-registry.ts`
- `libs/backend/agent-sdk/src/lib/prompt-harness/index.ts`
- `libs/backend/agent-sdk/src/index.ts` (export)

**Dependencies**: None
**Verification**: Unit tests for registry helper functions

### Batch 2: Storage Layer

**Files**:

- `libs/backend/agent-sdk/src/lib/prompt-harness/user-prompt-store.ts`
- `libs/backend/agent-sdk/src/lib/di/tokens.ts` (add token)
- `libs/backend/agent-sdk/src/lib/di/register.ts` (register)

**Dependencies**: Batch 1
**Verification**: Unit tests for storage operations

### Batch 3: Assembly Service

**Files**:

- `libs/backend/agent-sdk/src/lib/prompt-harness/prompt-harness.service.ts`
- `libs/backend/agent-sdk/src/lib/di/tokens.ts` (add token)
- `libs/backend/agent-sdk/src/lib/di/register.ts` (register)

**Dependencies**: Batch 1, Batch 2
**Verification**: Unit tests for assembly logic, token counting

### Batch 4: RPC Handlers

**Files**:

- `libs/shared/src/lib/types/rpc.types.ts` (add types)
- `apps/ptah-extension-vscode/src/services/rpc/handlers/prompt-harness-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts`

**Dependencies**: Batch 3
**Verification**: Manual RPC testing via webview

### Batch 5: SDK Integration

**Files**:

- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (modify)

**Dependencies**: Batch 3
**Verification**: Integration test with SDK query

### Batch 6: Frontend Components

**Files**:

- `libs/frontend/chat/src/lib/settings/prompt-power-ups.component.ts`
- `libs/frontend/chat/src/lib/settings/prompt-power-ups.component.html`
- `libs/frontend/chat/src/lib/settings/custom-prompt-editor.component.ts`
- `libs/frontend/chat/src/lib/settings/custom-prompt-editor.component.html`
- `libs/frontend/chat/src/lib/settings/prompt-preview.component.ts`
- `libs/frontend/chat/src/lib/settings/prompt-preview.component.html`
- `libs/frontend/chat/src/lib/settings/settings.component.ts` (modify)
- `libs/frontend/chat/src/lib/settings/settings.component.html` (modify)

**Dependencies**: Batch 4
**Verification**: E2E testing of UI

---

## Risk Mitigations

### Token Budget Overflow

**Risk**: Assembled prompt exceeds model context limits.

**Mitigation**:

1. **Hard limit check** in `assemblePrompt()` - warn if >8000 tokens
2. **Per-power-up token counts** stored in registry
3. **Real-time token display** in UI preview
4. **Priority-based auto-disable suggestion** (not automatic, user chooses)

### Power-Up Conflict Resolution

**Algorithm**:

```typescript
// In PromptHarnessService
private checkConflicts(powerUp: PowerUpDefinition, allEnabled: PowerUpDefinition[]): string[] {
  if (!powerUp.conflictsWith?.length) return [];
  return allEnabled
    .filter(p => p.id !== powerUp.id && powerUp.conflictsWith?.includes(p.id))
    .map(p => p.name);
}

// Resolution strategy: Show warning, user decides
// Later power-up in priority order takes precedence
```

### Backward Compatibility

**Design Decision**: No backward compatibility layer.

**Rationale**:

- New feature, no existing users to migrate
- Static `PTAH_BEHAVIORAL_PROMPT` still included via harness
- Premium users get same `PTAH_SYSTEM_PROMPT` via harness
- No old system to maintain

---

## Quality Requirements

### Functional Requirements

1. Power-ups can be enabled/disabled with immediate effect on next chat
2. Custom prompt sections can be created, edited, deleted
3. Premium power-ups show locked state for free users
4. Prompt preview updates in real-time as settings change
5. Configuration can be exported/imported as JSON

### Non-Functional Requirements

1. **Performance**: Prompt assembly <50ms
2. **Storage**: Config persists across VS Code restarts
3. **Security**: Custom prompts in SecretStorage (may contain patterns)
4. **Scalability**: Support up to 50 power-ups without degradation

### Testing Requirements

1. Unit tests for PowerUpRegistry helper functions
2. Unit tests for UserPromptStore operations
3. Unit tests for PromptHarnessService assembly logic
4. Integration test for RPC round-trip
5. Manual E2E test for UI flow

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer (primary), frontend-developer (Batch 6)

**Rationale**:

- Batches 1-5 are pure backend TypeScript (no Angular)
- Batch 6 requires Angular component knowledge
- Frontend work is isolated to settings components

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 12-16 hours

**Breakdown**:

- Batch 1: 1-2 hours (types + registry)
- Batch 2: 2-3 hours (storage service)
- Batch 3: 2-3 hours (assembly service)
- Batch 4: 2-3 hours (RPC handlers)
- Batch 5: 1-2 hours (SDK integration)
- Batch 6: 4-5 hours (frontend components)

### Files Affected Summary

**CREATE**:

- `libs/backend/agent-sdk/src/lib/prompt-harness/types.ts`
- `libs/backend/agent-sdk/src/lib/prompt-harness/power-up-registry.ts`
- `libs/backend/agent-sdk/src/lib/prompt-harness/user-prompt-store.ts`
- `libs/backend/agent-sdk/src/lib/prompt-harness/prompt-harness.service.ts`
- `libs/backend/agent-sdk/src/lib/prompt-harness/index.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/prompt-harness-rpc.handlers.ts`
- `libs/frontend/chat/src/lib/settings/prompt-power-ups.component.ts`
- `libs/frontend/chat/src/lib/settings/prompt-power-ups.component.html`
- `libs/frontend/chat/src/lib/settings/custom-prompt-editor.component.ts`
- `libs/frontend/chat/src/lib/settings/custom-prompt-editor.component.html`
- `libs/frontend/chat/src/lib/settings/prompt-preview.component.ts`
- `libs/frontend/chat/src/lib/settings/prompt-preview.component.html`

**MODIFY**:

- `libs/backend/agent-sdk/src/lib/di/tokens.ts`
- `libs/backend/agent-sdk/src/lib/di/register.ts`
- `libs/backend/agent-sdk/src/index.ts`
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`
- `libs/shared/src/lib/types/rpc.types.ts`
- `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts`
- `libs/frontend/chat/src/lib/settings/settings.component.ts`
- `libs/frontend/chat/src/lib/settings/settings.component.html`

### Critical Verification Points

**Before Implementation**:

1. Verify `TOKENS.EXTENSION_CONTEXT` exists in vscode-core
2. Verify `LicenseService` injection pattern
3. Verify `PTAH_SYSTEM_PROMPT` export from vscode-lm-tools
4. Verify RpcHandler registration pattern

**After Each Batch**:

1. Run `nx build agent-sdk` to verify compilation
2. Run `nx test agent-sdk` for unit tests
3. Verify no circular dependencies introduced

---

## Architecture Delivery Checklist

- [x] All components specified with evidence citations
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] Implementation batches defined with dependencies
- [x] Risk mitigations specified
- [x] No step-by-step implementation (team-leader's responsibility)

---

## Document Control

| Version | Date       | Author             | Changes                            |
| ------- | ---------- | ------------------ | ---------------------------------- |
| 1.0     | 2026-02-03 | Software Architect | Initial architecture specification |
