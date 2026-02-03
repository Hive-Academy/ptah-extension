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
import {
  PTAH_CORE_SYSTEM_PROMPT,
  PTAH_CORE_SYSTEM_PROMPT_TOKENS,
} from './ptah-core-prompt';
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

    // TASK_2025_137: Add PTAH_CORE_SYSTEM_PROMPT as foundation layer
    // This is always included as the base prompt for all users
    layers.push({
      name: 'Ptah Core',
      type: 'agent', // Core layer, not premium-gated
      content: PTAH_CORE_SYSTEM_PROMPT,
      tokenCount: PTAH_CORE_SYSTEM_PROMPT_TOKENS,
      source: 'ptah-core',
    });
    textParts.push(PTAH_CORE_SYSTEM_PROMPT);

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
   * the complete text ready to append to the system prompt.
   *
   * TASK_2025_137: PTAH_CORE_SYSTEM_PROMPT is now included as the foundation
   * layer in assemblePrompt(), so we no longer need to append PTAH_BEHAVIORAL_PROMPT
   * separately (its guidance is now part of the core prompt).
   *
   * @param isPremium - Whether user has premium features
   * @returns Complete prompt text ready to append to system prompt
   */
  async getAppendPrompt(isPremium: boolean): Promise<string> {
    const assembled = await this.assemblePrompt(isPremium);

    this.logger.debug('[PromptHarnessService] Generated append prompt', {
      isPremium,
      assembledLength: assembled.text.length,
      totalTokens: assembled.totalTokens,
      layerCount: assembled.layers.length,
    });

    return assembled.text;
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
