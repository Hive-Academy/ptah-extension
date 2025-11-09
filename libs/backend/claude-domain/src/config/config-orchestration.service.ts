/**
 * Config Orchestration Service
 * Business logic layer for configuration management operations
 *
 * Migrated from: apps/ptah-extension-vscode/src/services/webview-message-handlers/config-message-handler.ts (174 lines)
 * Extracted business logic: ~94 lines
 *
 * Verification trail:
 * - Source handler analyzed: config-message-handler.ts:1-174
 * - Dependency: vscode.workspace.getConfiguration (VS Code API)
 * - Pattern: Interface-based abstraction to avoid vscode dependency in library
 */

import { injectable, inject } from 'tsyringe';
import type { CorrelationId } from '@ptah-extension/shared';
import { TOKENS } from '@ptah-extension/vscode-core';

/**
 * Workspace Configuration interface
 */
export interface WorkspaceConfiguration {
  claude: {
    model: string;
    temperature: number;
    maxTokens: number;
  };
  streaming: {
    bufferSize: number;
    chunkSize: number;
    timeoutMs: number;
  };
}

/**
 * Configuration Provider interface
 * Abstracts VS Code configuration API
 */
export interface IConfigurationProvider {
  getConfiguration(): Promise<WorkspaceConfiguration>;
  setConfiguration(key: string, value: unknown): Promise<void>;
  updateConfiguration(key: string, value: unknown): Promise<void>;
}

/**
 * Request/Response Types for Config Operations
 */

export interface GetConfigRequest {
  requestId: CorrelationId;
}

export interface GetConfigResult {
  success: boolean;
  config?: WorkspaceConfiguration;
  error?: {
    code: string;
    message: string;
  };
}

export interface SetConfigRequest {
  requestId: CorrelationId;
  key: string;
  value: unknown;
}

export interface SetConfigResult {
  success: boolean;
  message?: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface UpdateConfigRequest {
  requestId: CorrelationId;
  key: string;
  value: unknown;
}

export interface UpdateConfigResult {
  success: boolean;
  message?: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface RefreshConfigRequest {
  requestId: CorrelationId;
}

export interface RefreshConfigResult {
  success: boolean;
  config?: WorkspaceConfiguration;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Config Orchestration Service
 * Handles all configuration management business logic
 *
 * Business Logic Extracted from config-message-handler.ts:
 * - Get configuration (handleConfigGet)
 * - Set configuration (handleConfigSet)
 * - Update configuration (handleConfigUpdate)
 * - Refresh configuration (handleConfigRefresh)
 */
@injectable()
export class ConfigOrchestrationService {
  constructor(
    @inject(TOKENS.CONFIGURATION_PROVIDER)
    private readonly configProvider: IConfigurationProvider
  ) {}

  /**
   * Get workspace configuration
   * Extracted from: config-message-handler.ts:77-116
   */
  async getConfig(): Promise<GetConfigResult> {
    try {
      const config = await this.configProvider.getConfiguration();

      console.info('Retrieved configuration', config);

      return {
        success: true,
        config,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to get configuration';
      console.error('Failed to get configuration:', error);
      return {
        success: false,
        error: {
          code: 'GET_CONFIG_ERROR',
          message: errorMessage,
        },
      };
    }
  }

  /**
   * Set configuration value
   * Extracted from: config-message-handler.ts:121-143
   */
  async setConfig(request: SetConfigRequest): Promise<SetConfigResult> {
    try {
      await this.configProvider.setConfiguration(request.key, request.value);

      console.info('Configuration set', { key: request.key });

      return {
        success: true,
        message: 'Configuration updated successfully',
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to set configuration';
      console.error('Failed to set configuration:', error);
      return {
        success: false,
        error: {
          code: 'SET_CONFIG_ERROR',
          message: errorMessage,
        },
      };
    }
  }

  /**
   * Update configuration value
   * Extracted from: config-message-handler.ts:148-170
   */
  async updateConfig(
    request: UpdateConfigRequest
  ): Promise<UpdateConfigResult> {
    try {
      await this.configProvider.updateConfiguration(request.key, request.value);

      console.info('Configuration updated', { key: request.key });

      return {
        success: true,
        message: 'Configuration updated successfully',
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to update configuration';
      console.error('Failed to update configuration:', error);
      return {
        success: false,
        error: {
          code: 'UPDATE_CONFIG_ERROR',
          message: errorMessage,
        },
      };
    }
  }

  /**
   * Refresh configuration
   * Extracted from: config-message-handler.ts:175-182
   */
  async refreshConfig(): Promise<RefreshConfigResult> {
    try {
      // For now, just return current config (same as get)
      const result = await this.getConfig();
      return {
        success: result.success,
        config: result.config,
        error: result.error,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to refresh configuration';
      console.error('Failed to refresh configuration:', error);
      return {
        success: false,
        error: {
          code: 'REFRESH_CONFIG_ERROR',
          message: errorMessage,
        },
      };
    }
  }
}
