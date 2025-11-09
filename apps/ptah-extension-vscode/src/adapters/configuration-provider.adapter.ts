/**
 * Configuration Provider Adapter
 *
 * Adapts ConfigManager (vscode-core) to implement IConfigurationProvider interface
 * from claude-domain library.
 *
 * This adapter bridges the gap between:
 * - ConfigManager (vscode-core's Zod-based config service)
 * - IConfigurationProvider (claude-domain's configuration interface)
 *
 * Pattern: Adapter pattern for cross-library dependency injection
 * Verification: Implements IConfigurationProvider from config-orchestration.service.ts:38
 */

import type {
  IConfigurationProvider,
  WorkspaceConfiguration,
} from '@ptah-extension/claude-domain';
import type { ConfigManager } from '@ptah-extension/vscode-core';

/**
 * Configuration Provider Adapter
 * Implements IConfigurationProvider by delegating to ConfigManager
 */
export class ConfigurationProviderAdapter implements IConfigurationProvider {
  constructor(private readonly configManager: ConfigManager) {}

  /**
   * Get workspace configuration
   * Reads from VS Code workspace configuration via ConfigManager
   */
  async getConfiguration(): Promise<WorkspaceConfiguration> {
    // ConfigManager provides direct access to VS Code configuration
    // Get values with defaults matching the WorkspaceConfiguration structure
    return {
      claude: {
        model: this.configManager.getWithDefault(
          'claude.model',
          'claude-3-sonnet-20241022'
        ),
        temperature: this.configManager.getWithDefault(
          'claude.temperature',
          0.1
        ),
        maxTokens: this.configManager.getWithDefault('maxTokens', 200000),
      },
      streaming: {
        bufferSize: this.configManager.getWithDefault(
          'streaming.bufferSize',
          8192
        ),
        chunkSize: this.configManager.getWithDefault(
          'streaming.chunkSize',
          1024
        ),
        timeoutMs: this.configManager.getWithDefault(
          'streaming.timeoutMs',
          30000
        ),
      },
    };
  }

  /**
   * Set configuration value
   * Delegates to ConfigManager.set()
   */
  async setConfiguration(key: string, value: unknown): Promise<void> {
    await this.configManager.set(key, value);
  }

  /**
   * Update configuration value (alias for setConfiguration)
   */
  async updateConfiguration(key: string, value: unknown): Promise<void> {
    await this.setConfiguration(key, value);
  }
}
