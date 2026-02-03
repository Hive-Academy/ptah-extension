/**
 * UserPromptStore - Persistence layer for prompt harness configuration
 * TASK_2025_135 Batch 2: Storage Layer
 *
 * Pattern source: libs/backend/vscode-core/src/services/license.service.ts
 *
 * Design Decision:
 * - globalState for power-up states (boolean flags, non-sensitive)
 * - SecretStorage for custom sections (may contain sensitive patterns)
 * - Version tracking for future migration support
 */
import { injectable, inject } from 'tsyringe';
import type * as vscode from 'vscode';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type {
  PowerUpState,
  UserPromptSection,
  PromptHarnessConfig,
} from './types';

/**
 * Service for persisting and retrieving prompt harness configuration.
 *
 * Storage strategy:
 * - Power-up states: globalState (non-sensitive boolean flags)
 * - Custom sections: SecretStorage (may contain sensitive API keys or patterns)
 * - Version: globalState (for migration tracking)
 *
 * @example
 * ```typescript
 * const store = container.resolve(UserPromptStore);
 *
 * // Get all power-up states
 * const states = await store.getPowerUpStates();
 *
 * // Enable a power-up
 * await store.setPowerUpState('investigation-first', {
 *   powerUpId: 'investigation-first',
 *   enabled: true,
 *   lastModified: Date.now()
 * });
 *
 * // Export/import configuration
 * const json = await store.exportConfig();
 * await store.importConfig(json);
 * ```
 */
@injectable()
export class UserPromptStore {
  /**
   * Storage key for power-up enable/disable states (globalState - non-sensitive)
   */
  private static readonly POWER_UP_STATES_KEY =
    'ptah.promptHarness.powerUpStates';

  /**
   * Storage key for custom prompt sections (SecretStorage - potentially sensitive)
   */
  private static readonly CUSTOM_SECTIONS_KEY =
    'ptah.promptHarness.customSections';

  /**
   * Storage key for configuration version (globalState)
   */
  private static readonly CONFIG_VERSION_KEY = 'ptah.promptHarness.version';

  /**
   * Current configuration version for migration support
   */
  private static readonly CURRENT_VERSION = '1.0.0';

  constructor(
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: vscode.ExtensionContext,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger
  ) {
    this.logger.debug('[UserPromptStore] Service initialized');
  }

  /**
   * Get all power-up states from globalState storage.
   *
   * Converts the stored Record<string, PowerUpState> to Map<string, PowerUpState>
   * for O(1) lookup performance in assembly operations.
   *
   * @returns Map of power-up ID to state (empty Map if no states stored)
   */
  async getPowerUpStates(): Promise<Map<string, PowerUpState>> {
    try {
      const raw = this.context.globalState.get<Record<string, PowerUpState>>(
        UserPromptStore.POWER_UP_STATES_KEY,
        {}
      );
      this.logger.debug('[UserPromptStore] Retrieved power-up states', {
        count: Object.keys(raw).length,
      });
      return new Map(Object.entries(raw));
    } catch (error) {
      this.logger.error('[UserPromptStore] Failed to get power-up states', {
        error: error instanceof Error ? error.message : String(error),
      });
      return new Map();
    }
  }

  /**
   * Save a single power-up state to globalState storage.
   *
   * Merges with existing states - only updates the specific power-up.
   * Converts Map back to Record for JSON serialization in globalState.
   *
   * @param powerUpId - The power-up ID to update
   * @param state - The new state for the power-up
   */
  async setPowerUpState(powerUpId: string, state: PowerUpState): Promise<void> {
    try {
      const states = await this.getPowerUpStates();
      states.set(powerUpId, state);

      await this.context.globalState.update(
        UserPromptStore.POWER_UP_STATES_KEY,
        Object.fromEntries(states)
      );

      this.logger.debug('[UserPromptStore] Power-up state saved', {
        powerUpId,
        enabled: state.enabled,
        priority: state.priority,
      });
    } catch (error) {
      this.logger.error('[UserPromptStore] Failed to save power-up state', {
        powerUpId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get all custom prompt sections from SecretStorage.
   *
   * Custom sections are stored in SecretStorage because they may contain
   * sensitive content like API keys or proprietary patterns.
   *
   * @returns Array of custom sections (empty array if none stored or parse error)
   */
  async getCustomSections(): Promise<UserPromptSection[]> {
    try {
      const raw = await this.context.secrets.get(
        UserPromptStore.CUSTOM_SECTIONS_KEY
      );

      if (!raw) {
        this.logger.debug(
          '[UserPromptStore] No custom sections found, returning empty array'
        );
        return [];
      }

      const sections = JSON.parse(raw) as UserPromptSection[];
      this.logger.debug('[UserPromptStore] Retrieved custom sections', {
        count: sections.length,
      });
      return sections;
    } catch (error) {
      this.logger.warn(
        '[UserPromptStore] Failed to parse custom sections, returning empty',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return [];
    }
  }

  /**
   * Save custom prompt sections to SecretStorage.
   *
   * Replaces all existing sections with the provided array.
   * Use this for bulk updates (add, edit, delete, reorder).
   *
   * @param sections - The complete array of custom sections to store
   */
  async setCustomSections(sections: UserPromptSection[]): Promise<void> {
    try {
      await this.context.secrets.store(
        UserPromptStore.CUSTOM_SECTIONS_KEY,
        JSON.stringify(sections)
      );

      this.logger.debug('[UserPromptStore] Custom sections saved', {
        count: sections.length,
      });
    } catch (error) {
      this.logger.error('[UserPromptStore] Failed to save custom sections', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get the complete prompt harness configuration.
   *
   * Aggregates power-up states, custom sections, and configuration metadata
   * into a single PromptHarnessConfig object.
   *
   * @returns Complete configuration with all settings
   */
  async getConfig(): Promise<PromptHarnessConfig> {
    try {
      const [powerUpStates, customSections] = await Promise.all([
        this.getPowerUpStates(),
        this.getCustomSections(),
      ]);

      const version = this.context.globalState.get<string>(
        UserPromptStore.CONFIG_VERSION_KEY,
        UserPromptStore.CURRENT_VERSION
      );

      const config: PromptHarnessConfig = {
        version,
        powerUpStates,
        customSections,
        showRecommendations: true, // Default - could be persisted in future
        lastWorkspaceType: undefined,
      };

      this.logger.debug('[UserPromptStore] Retrieved full config', {
        version,
        powerUpCount: powerUpStates.size,
        customSectionCount: customSections.length,
      });

      return config;
    } catch (error) {
      this.logger.error('[UserPromptStore] Failed to get config', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Return default config on error
      return {
        version: UserPromptStore.CURRENT_VERSION,
        powerUpStates: new Map(),
        customSections: [],
        showRecommendations: true,
        lastWorkspaceType: undefined,
      };
    }
  }

  /**
   * Export configuration as JSON string for backup/sharing.
   *
   * Converts Map to Object for JSON serialization compatibility.
   * The exported format can be imported via importConfig().
   *
   * @returns JSON string representation of the configuration
   */
  async exportConfig(): Promise<string> {
    try {
      const config = await this.getConfig();

      // Convert Map to object for JSON serialization
      const exportable = {
        version: config.version,
        powerUpStates: Object.fromEntries(config.powerUpStates),
        customSections: config.customSections,
        showRecommendations: config.showRecommendations,
        lastWorkspaceType: config.lastWorkspaceType,
      };

      const json = JSON.stringify(exportable, null, 2);

      this.logger.info('[UserPromptStore] Configuration exported', {
        powerUpCount: config.powerUpStates.size,
        customSectionCount: config.customSections.length,
      });

      return json;
    } catch (error) {
      this.logger.error('[UserPromptStore] Failed to export config', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Import configuration from JSON string.
   *
   * Validates the JSON structure before importing.
   * Merges imported power-up states with existing (imported values take precedence).
   * Replaces custom sections entirely with imported values.
   *
   * @param jsonString - JSON string from exportConfig() or compatible format
   * @returns Result object indicating success or failure with error message
   */
  async importConfig(
    jsonString: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Parse JSON
      let imported: {
        version?: string;
        powerUpStates?: Record<string, PowerUpState>;
        customSections?: UserPromptSection[];
      };

      try {
        imported = JSON.parse(jsonString);
      } catch {
        this.logger.warn('[UserPromptStore] Invalid JSON in import');
        return { success: false, error: 'Invalid JSON format' };
      }

      // Validate required fields
      if (!imported.version) {
        this.logger.warn('[UserPromptStore] Missing version in import');
        return {
          success: false,
          error: 'Invalid configuration format: missing version',
        };
      }

      if (
        !imported.powerUpStates ||
        typeof imported.powerUpStates !== 'object'
      ) {
        this.logger.warn('[UserPromptStore] Missing powerUpStates in import');
        return {
          success: false,
          error: 'Invalid configuration format: missing powerUpStates',
        };
      }

      // Import power-up states
      for (const [id, state] of Object.entries(imported.powerUpStates)) {
        // Validate state structure
        if (
          typeof state.powerUpId !== 'string' ||
          typeof state.enabled !== 'boolean' ||
          typeof state.lastModified !== 'number'
        ) {
          this.logger.warn(
            '[UserPromptStore] Invalid power-up state structure',
            { id }
          );
          continue; // Skip invalid entries
        }

        await this.setPowerUpState(id, state);
      }

      // Import custom sections if present
      if (imported.customSections && Array.isArray(imported.customSections)) {
        // Validate each section
        const validSections = imported.customSections.filter((section) => {
          return (
            typeof section.id === 'string' &&
            typeof section.name === 'string' &&
            typeof section.content === 'string' &&
            typeof section.enabled === 'boolean' &&
            typeof section.priority === 'number' &&
            typeof section.createdAt === 'number' &&
            typeof section.updatedAt === 'number'
          );
        });

        await this.setCustomSections(validSections);
      }

      // Update version
      await this.context.globalState.update(
        UserPromptStore.CONFIG_VERSION_KEY,
        imported.version
      );

      this.logger.info(
        '[UserPromptStore] Configuration imported successfully',
        {
          version: imported.version,
          powerUpCount: Object.keys(imported.powerUpStates).length,
          customSectionCount: imported.customSections?.length ?? 0,
        }
      );

      return { success: true };
    } catch (error) {
      this.logger.error('[UserPromptStore] Failed to import configuration', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: 'Failed to parse configuration JSON',
      };
    }
  }

  /**
   * Clear all prompt harness data from storage.
   *
   * Useful for reset to defaults or debugging.
   * Removes power-up states, custom sections, and version.
   */
  async clearAll(): Promise<void> {
    try {
      await Promise.all([
        this.context.globalState.update(
          UserPromptStore.POWER_UP_STATES_KEY,
          undefined
        ),
        this.context.secrets.delete(UserPromptStore.CUSTOM_SECTIONS_KEY),
        this.context.globalState.update(
          UserPromptStore.CONFIG_VERSION_KEY,
          undefined
        ),
      ]);

      this.logger.info('[UserPromptStore] All prompt harness data cleared');
    } catch (error) {
      this.logger.error('[UserPromptStore] Failed to clear data', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
