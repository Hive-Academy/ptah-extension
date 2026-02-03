/**
 * PromptHarnessService - Prompt Assembly Service (TASK_2025_135 Batch 3)
 *
 * Assembles user-configured power-ups and custom sections into a complete
 * prompt that can be appended to Claude's system prompt.
 *
 * Responsibilities:
 * - Retrieve power-up states from UserPromptStore
 * - Filter enabled power-ups (respecting premium tier)
 * - Sort by priority (lower = earlier in assembly)
 * - Check for conflicts between power-ups
 * - Add custom user sections
 * - Calculate total token count
 * - Generate warnings (token budget, conflicts)
 *
 * Pattern source: libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PTAH_SYSTEM_PROMPT } from '@ptah-extension/vscode-lm-tools';
import { SDK_TOKENS } from '../di/tokens';
import { UserPromptStore } from './user-prompt-store';
import { POWER_UP_DEFINITIONS, getPowerUp } from './power-up-registry';
import type {
  PowerUpDefinition,
  PowerUpState,
  UserPromptSection,
  PromptHarnessConfig,
  PromptLayer,
  PromptWarning,
  AssembledPrompt,
} from './types';

/**
 * Maximum tokens allowed for assembled prompt
 * Beyond this, we generate an error-level warning
 */
const MAX_PROMPT_TOKENS = 8000;

/**
 * Token threshold for generating a warning
 * Above this, we generate a warning-level message
 */
const TOKEN_WARNING_THRESHOLD = 6000;

/**
 * Ptah behavioral system prompt - always appended (all tiers)
 *
 * Instructs the agent to use AskUserQuestion tool for presenting choices
 * instead of writing questions as plain markdown text. This provides a
 * better UX with structured UI and selectable options.
 *
 * Note: This is a copy from sdk-query-options-builder.ts to avoid circular deps.
 * Both locations use the same content.
 */
const PTAH_BEHAVIORAL_PROMPT = `# Ptah Extension - MANDATORY User Interaction Rules

## AskUserQuestion Tool — YOU MUST USE IT

The \`claude_code\` tool preset you are running under includes a tool called **AskUserQuestion**.
It is ALREADY available to you — do NOT claim otherwise. You MUST call it whenever you need the user to make a choice, answer a question, or pick between approaches.

### Tool Schema (exact parameters)

\`\`\`
AskUserQuestion({
  questions: [                          // 1-4 questions per call
    {
      question: string,                 // Full question ending with "?"
      header: string,                   // Short label, max 12 chars (e.g. "Approach")
      options: [                        // 2-4 options per question
        { label: string, description: string }
      ],
      multiSelect: boolean              // true = checkboxes, false = radio
    }
  ]
})
\`\`\`

### WRONG (NEVER do this)

Writing options as plain text in your response:
"Here are your options:
1. Option A — does X
2. Option B — does Y
3. Option C — does Z
Which do you prefer?"

### CORRECT (ALWAYS do this)

Call the AskUserQuestion tool:
\`\`\`json
{
  "questions": [{
    "question": "Which approach should we use?",
    "header": "Approach",
    "options": [
      { "label": "Option A", "description": "Does X" },
      { "label": "Option B", "description": "Does Y" },
      { "label": "Option C", "description": "Does Z" }
    ],
    "multiSelect": false
  }]
}
\`\`\`

### Rules

1. You MUST use AskUserQuestion for ANY situation where you present choices, ask preferences, or need a decision.
2. NEVER present numbered options, bullet-point choices, or "which do you prefer?" as plain text.
3. NEVER claim the tool is unavailable or that you cannot call it — it is part of your tool preset.
4. When spawning subagents via the Task tool, include in the prompt parameter: "If you need to ask the user a question or present choices, you MUST use the AskUserQuestion tool. It is available in your claude_code tool preset. NEVER present choices as plain text."

## Rich Formatting Guidelines

The Ptah extension renders your markdown with enhanced visual styling. To produce the best-looking output, consider these formatting tips (all are optional — standard markdown always works):

- **Use headings** (\`##\`, \`###\`) to give your responses clear structure and visual hierarchy.
- **Use horizontal rules** (\`---\`) to separate major sections — they render as decorative gold dividers.
- **Specify language in code blocks** (e.g. \`\`\`typescript, \`\`\`python) — the language appears as a badge header above the code.
- **Use numbered lists** for sequential steps or instructions — they render as visually distinct step cards with numbered indicators.
- **Use callout syntax** for important information:
  - \`> [!NOTE]\` for general notes
  - \`> [!TIP]\` for helpful tips
  - \`> [!WARNING]\` for warnings
  - \`> [!IMPORTANT]\` for critical information
  - \`> [!CAUTION]\` for dangerous operations
`;

/**
 * Service for assembling user-configured power-ups into prompts.
 *
 * @example
 * ```typescript
 * const service = container.resolve(PromptHarnessService);
 *
 * // Assemble complete prompt with layer breakdown
 * const assembled = await service.assemblePrompt(isPremiumUser);
 * console.log('Total tokens:', assembled.totalTokens);
 * console.log('Warnings:', assembled.warnings);
 *
 * // Get just the append text for SDK query
 * const appendPrompt = await service.getAppendPrompt(isPremiumUser);
 * ```
 */
@injectable()
export class PromptHarnessService {
  constructor(
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_USER_PROMPT_STORE)
    private readonly userPromptStore: UserPromptStore
  ) {
    this.logger.debug('[PromptHarnessService] Service initialized');
  }

  /**
   * Assemble a complete prompt from enabled power-ups and custom sections.
   *
   * Returns a structured result with:
   * - Complete assembled text
   * - Token count estimate
   * - Layer breakdown for UI preview
   * - Warnings for conflicts or token budget issues
   *
   * @param isPremium - Whether user has premium features (enables premium power-ups and system prompt)
   * @returns Assembled prompt with metadata
   */
  async assemblePrompt(isPremium: boolean): Promise<AssembledPrompt> {
    this.logger.debug('[PromptHarnessService] Assembling prompt', {
      isPremium,
    });

    // Get user configuration from store
    const config = await this.userPromptStore.getConfig();

    // Get enabled power-ups, respecting premium tier
    const enabledPowerUps = this.getEnabledPowerUps(config, isPremium);

    // Sort by priority (lower = earlier)
    enabledPowerUps.sort((a, b) => {
      const priorityA =
        config.powerUpStates.get(a.id)?.priority ?? a.defaultPriority;
      const priorityB =
        config.powerUpStates.get(b.id)?.priority ?? b.defaultPriority;
      return priorityA - priorityB;
    });

    // Check for conflicts
    const warnings: PromptWarning[] = [];
    for (const powerUp of enabledPowerUps) {
      const conflicts = this.checkConflicts(powerUp, enabledPowerUps);
      for (const conflictId of conflicts) {
        const conflictingPowerUp = getPowerUp(conflictId);
        warnings.push({
          type: 'conflict',
          message: `"${powerUp.name}" conflicts with "${
            conflictingPowerUp?.name ?? conflictId
          }"`,
          severity: 'warning',
        });
      }
    }

    // Build layers
    const layers: PromptLayer[] = [];
    const textParts: string[] = [];

    // Add enabled power-up layers
    for (const powerUp of enabledPowerUps) {
      layers.push({
        name: powerUp.name,
        type: powerUp.isPremium ? 'premium' : 'agent',
        content: powerUp.content,
        tokenCount: powerUp.tokenCount,
        source: powerUp.id,
      });
      textParts.push(powerUp.content);
    }

    // Add enabled custom sections
    const enabledSections = config.customSections.filter((s) => s.enabled);
    enabledSections.sort((a, b) => a.priority - b.priority);

    for (const section of enabledSections) {
      const tokenCount = this.estimateTokens(section.content);
      layers.push({
        name: section.name,
        type: 'user',
        content: section.content,
        tokenCount,
        source: 'custom',
      });
      textParts.push(section.content);
    }

    // Add PTAH_SYSTEM_PROMPT for premium users
    if (isPremium) {
      const ptahSystemTokens = this.estimateTokens(PTAH_SYSTEM_PROMPT);
      layers.push({
        name: 'Ptah MCP Tools',
        type: 'premium',
        content: PTAH_SYSTEM_PROMPT,
        tokenCount: ptahSystemTokens,
        source: 'ptah-system',
      });
      textParts.push(PTAH_SYSTEM_PROMPT);
    }

    // Calculate total tokens
    const totalTokens = layers.reduce(
      (sum, layer) => sum + layer.tokenCount,
      0
    );

    // Generate token budget warnings
    if (totalTokens > MAX_PROMPT_TOKENS) {
      warnings.push({
        type: 'token_budget',
        message: `Assembled prompt exceeds maximum budget (${totalTokens} / ${MAX_PROMPT_TOKENS} tokens). Consider disabling some power-ups.`,
        severity: 'error',
      });
    } else if (totalTokens > TOKEN_WARNING_THRESHOLD) {
      warnings.push({
        type: 'token_budget',
        message: `Assembled prompt is approaching token limit (${totalTokens} / ${MAX_PROMPT_TOKENS} tokens)`,
        severity: 'warning',
      });
    }

    // Assemble final text
    const text = textParts.join('\n\n');

    this.logger.info('[PromptHarnessService] Prompt assembled', {
      isPremium,
      powerUpCount: enabledPowerUps.length,
      customSectionCount: enabledSections.length,
      layerCount: layers.length,
      totalTokens,
      warningCount: warnings.length,
    });

    return {
      text,
      totalTokens,
      layers,
      warnings,
    };
  }

  /**
   * Get the complete append prompt text for SDK query.
   *
   * This is a convenience method that assembles the prompt and returns
   * just the text with PTAH_BEHAVIORAL_PROMPT appended (for all tiers).
   *
   * @param isPremium - Whether user has premium features
   * @returns Complete prompt text ready to append to system prompt
   */
  async getAppendPrompt(isPremium: boolean): Promise<string> {
    const assembled = await this.assemblePrompt(isPremium);

    // Always append behavioral prompt for AskUserQuestion guidance
    const parts: string[] = [];

    if (assembled.text) {
      parts.push(assembled.text);
    }

    parts.push(PTAH_BEHAVIORAL_PROMPT);

    this.logger.debug('[PromptHarnessService] Generated append prompt', {
      isPremium,
      assembledLength: assembled.text.length,
      behavioralLength: PTAH_BEHAVIORAL_PROMPT.length,
      totalLength: parts.join('\n\n').length,
    });

    return parts.join('\n\n');
  }

  /**
   * Get enabled power-ups from configuration, respecting premium tier.
   *
   * @param config - User's prompt harness configuration
   * @param isPremium - Whether user has premium access
   * @returns Array of enabled power-up definitions
   */
  private getEnabledPowerUps(
    config: PromptHarnessConfig,
    isPremium: boolean
  ): PowerUpDefinition[] {
    const enabled: PowerUpDefinition[] = [];

    for (const powerUp of POWER_UP_DEFINITIONS) {
      // Skip premium power-ups for non-premium users
      if (powerUp.isPremium && !isPremium) {
        continue;
      }

      // Check if user has explicitly enabled this power-up
      const state = config.powerUpStates.get(powerUp.id);

      // If no state exists, power-up is disabled by default
      if (!state || !state.enabled) {
        continue;
      }

      enabled.push(powerUp);
    }

    this.logger.debug('[PromptHarnessService] Filtered enabled power-ups', {
      total: POWER_UP_DEFINITIONS.length,
      enabled: enabled.length,
      isPremium,
    });

    return enabled;
  }

  /**
   * Check if a power-up conflicts with other enabled power-ups.
   *
   * @param powerUp - Power-up to check
   * @param allEnabled - All currently enabled power-ups
   * @returns Array of conflicting power-up IDs
   */
  private checkConflicts(
    powerUp: PowerUpDefinition,
    allEnabled: PowerUpDefinition[]
  ): string[] {
    if (!powerUp.conflictsWith || powerUp.conflictsWith.length === 0) {
      return [];
    }

    const conflicts: string[] = [];
    const enabledIds = new Set(allEnabled.map((p) => p.id));

    for (const conflictId of powerUp.conflictsWith) {
      if (enabledIds.has(conflictId) && conflictId !== powerUp.id) {
        conflicts.push(conflictId);
      }
    }

    return conflicts;
  }

  /**
   * Estimate token count for a text string.
   *
   * Uses a simple heuristic of approximately 4 characters per token.
   * This is a rough estimate - actual token count depends on the tokenizer.
   *
   * @param text - Text to estimate tokens for
   * @returns Estimated token count
   */
  private estimateTokens(text: string): number {
    // Simple estimation: ~4 characters per token on average
    // This is a common approximation for English text
    return Math.ceil(text.length / 4);
  }
}
