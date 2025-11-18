/**
 * Provider Orchestration Service
 * Business logic layer for AI provider operations
 *
 * Migrated from: apps/ptah-extension-vscode/src/services/webview-message-handlers/provider-message-handler.ts (629 lines)
 * Extracted business logic: ~300 lines
 *
 * Verification trail:
 * - Source handler analyzed: provider-message-handler.ts:38-629
 * - Dependency verified: IProviderManager from @ptah-extension/shared (ai-provider.types.ts:139)
 * - Pattern: Using interface (IProviderManager) to avoid circular dependency
 * - Main app ProviderManager implements IProviderManager ✓
 */

import { injectable, inject } from 'tsyringe';
import type {
  IProviderManager,
  ProviderId,
  ProviderHealth,
  ProviderSwitchEvent,
  ProviderErrorEvent,
  ProviderHealthChangeEvent,
  IAIProvider,
} from '@ptah-extension/shared';
import { isValidProviderId } from '@ptah-extension/shared';
import type { CorrelationId } from '@ptah-extension/shared';
import { TOKENS } from '@ptah-extension/vscode-core';

/**
 * Provider data returned to webview
 */
export interface ProviderData {
  id: ProviderId;
  name: string;
  description: string;
  vendor: string;
  capabilities: {
    streaming: boolean;
    fileAttachments: boolean;
    contextManagement: boolean;
    sessionPersistence: boolean;
    multiTurn: boolean;
    codeGeneration: boolean;
    imageAnalysis: boolean;
    functionCalling: boolean;
  };
  health: ProviderHealth;
}

/**
 * Request/Response Types for Provider Operations
 */

export interface GetAvailableProvidersRequest {
  requestId: CorrelationId;
}

export interface GetAvailableProvidersResult {
  success: boolean;
  providers?: ProviderData[];
  error?: {
    code: string;
    message: string;
  };
}

export interface GetCurrentProviderRequest {
  requestId: CorrelationId;
}

export interface GetCurrentProviderResult {
  success: boolean;
  provider?: ProviderData | null;
  error?: {
    code: string;
    message: string;
  };
}

export interface SwitchProviderRequest {
  requestId: CorrelationId;
  providerId: string;
  reason?: 'user-request' | 'auto-fallback' | 'error-recovery';
}

export interface SwitchProviderResult {
  success: boolean;
  switched?: boolean;
  provider?: ProviderData | null;
  error?: {
    code: string;
    message: string;
  };
}

export interface GetProviderHealthRequest {
  requestId: CorrelationId;
  providerId?: string;
}

export interface GetProviderHealthResult {
  success: boolean;
  health?: ProviderHealth;
  error?: {
    code: string;
    message: string;
  };
}

export interface GetAllProviderHealthRequest {
  requestId: CorrelationId;
}

export interface GetAllProviderHealthResult {
  success: boolean;
  healthMap?: Record<ProviderId, ProviderHealth>;
  error?: {
    code: string;
    message: string;
  };
}

export interface SetDefaultProviderRequest {
  requestId: CorrelationId;
  providerId: string;
}

export interface SetDefaultProviderResult {
  success: boolean;
  defaultProvider?: ProviderId;
  error?: {
    code: string;
    message: string;
  };
}

export interface EnableFallbackRequest {
  requestId: CorrelationId;
  enabled: boolean;
}

export interface EnableFallbackResult {
  success: boolean;
  fallbackEnabled?: boolean;
  error?: {
    code: string;
    message: string;
  };
}

export interface SetAutoSwitchRequest {
  requestId: CorrelationId;
  enabled: boolean;
}

export interface SetAutoSwitchResult {
  success: boolean;
  autoSwitchEnabled?: boolean;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Event listener callback type for provider events
 */
export type ProviderEventCallback = (
  event: ProviderSwitchEvent | ProviderHealthChangeEvent | ProviderErrorEvent
) => void;

/**
 * Provider Orchestration Service
 * Handles all provider-related business logic
 *
 * Business Logic Extracted from provider-message-handler.ts:
 * - Get available providers (handleGetAvailable)
 * - Get current provider (handleGetCurrent)
 * - Switch providers (handleSwitch)
 * - Get provider health (handleGetHealth)
 * - Get all provider health (handleGetAllHealth)
 * - Set default provider (handleSetDefault)
 * - Enable/disable fallback (handleEnableFallback)
 * - Set auto-switch on failure (handleSetAutoSwitch)
 */
@injectable()
export class ProviderOrchestrationService {
  constructor(
    @inject(TOKENS.PROVIDER_MANAGER)
    private readonly providerManager: IProviderManager
  ) {}

  /**
   * Get all available providers
   * Extracted from: provider-message-handler.ts:117-153
   */
  async getAvailableProviders(): Promise<GetAvailableProvidersResult> {
    try {
      console.log(`[ProviderOrchestration] getAvailableProviders() called`);
      const availableProviders = this.providerManager.getAvailableProviders();
      console.log(
        `[ProviderOrchestration] ProviderManager returned ${availableProviders.length} providers`
      );

      const providerData: ProviderData[] = availableProviders.map(
        (provider: IAIProvider) => ({
          id: provider.providerId,
          name: provider.info.name,
          description: provider.info.description,
          vendor: provider.info.vendor,
          capabilities: provider.info.capabilities,
          health: provider.getHealth(),
        })
      );

      console.log(
        `[ProviderOrchestration] Mapped to ${providerData.length} ProviderData objects`
      );
      console.log(
        `[ProviderOrchestration] Provider IDs:`,
        providerData.map((p) => p.id)
      );

      return {
        success: true,
        providers: providerData,
      };
    } catch (error) {
      console.error(
        '[ProviderOrchestration] Error getting available providers:',
        error
      );
      return {
        success: false,
        error: {
          code: 'GET_AVAILABLE_ERROR',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to get available providers',
        },
      };
    }
  }

  /**
   * Get current active provider
   * Extracted from: provider-message-handler.ts:158-194
   */
  async getCurrentProvider(): Promise<GetCurrentProviderResult> {
    try {
      const currentProvider = this.providerManager.getCurrentProvider();

      if (!currentProvider) {
        return {
          success: true,
          provider: null,
        };
      }

      const providerData: ProviderData = {
        id: currentProvider.providerId,
        name: currentProvider.info.name,
        description: currentProvider.info.description,
        vendor: currentProvider.info.vendor,
        capabilities: currentProvider.info.capabilities,
        health: currentProvider.getHealth(),
      };

      return {
        success: true,
        provider: providerData,
      };
    } catch (error) {
      console.error('Error getting current provider:', error);
      return {
        success: false,
        error: {
          code: 'GET_CURRENT_ERROR',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to get current provider',
        },
      };
    }
  }

  /**
   * Switch to different provider
   * Extracted from: provider-message-handler.ts:199-265
   */
  async switchProvider(
    request: SwitchProviderRequest
  ): Promise<SwitchProviderResult> {
    try {
      const { providerId } = request;

      // Validate provider ID
      if (!isValidProviderId(providerId)) {
        return {
          success: false,
          error: {
            code: 'INVALID_PROVIDER_ID',
            message: `Invalid provider ID: ${providerId}`,
          },
        };
      }

      // Attempt provider switch
      // Note: IProviderManager interface only accepts providerId (reason parameter not in interface)
      const success = await this.providerManager.switchProvider(
        providerId as ProviderId
      );

      if (!success) {
        return {
          success: false,
          error: {
            code: 'SWITCH_FAILED',
            message: `Failed to switch to provider: ${providerId}`,
          },
        };
      }

      // Get the new current provider info
      const currentProvider = this.providerManager.getCurrentProvider();
      const providerData: ProviderData | null = currentProvider
        ? {
            id: currentProvider.providerId,
            name: currentProvider.info.name,
            description: currentProvider.info.description,
            vendor: currentProvider.info.vendor,
            capabilities: currentProvider.info.capabilities,
            health: currentProvider.getHealth(),
          }
        : null;

      return {
        success: true,
        switched: true,
        provider: providerData,
      };
    } catch (error) {
      console.error('Error switching provider:', error);
      return {
        success: false,
        error: {
          code: 'SWITCH_ERROR',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to switch provider',
        },
      };
    }
  }

  /**
   * Get provider health status
   * Extracted from: provider-message-handler.ts:270-327
   */
  async getProviderHealth(
    request: GetProviderHealthRequest
  ): Promise<GetProviderHealthResult> {
    try {
      const { providerId } = request;

      let health: ProviderHealth | undefined;

      if (providerId) {
        // Validate provider ID
        if (!isValidProviderId(providerId)) {
          return {
            success: false,
            error: {
              code: 'INVALID_PROVIDER_ID',
              message: `Invalid provider ID: ${providerId}`,
            },
          };
        }
        health = this.providerManager.getProviderHealth(
          providerId as ProviderId
        );
      } else {
        // Get current provider health
        const currentProvider = this.providerManager.getCurrentProvider();
        health = currentProvider ? currentProvider.getHealth() : undefined;
      }

      if (!health) {
        return {
          success: false,
          error: {
            code: 'PROVIDER_NOT_FOUND',
            message: `Provider ${providerId || 'current'} not found`,
          },
        };
      }

      return {
        success: true,
        health,
      };
    } catch (error) {
      console.error('Error getting provider health:', error);
      return {
        success: false,
        error: {
          code: 'GET_HEALTH_ERROR',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to get provider health',
        },
      };
    }
  }

  /**
   * Get all providers health statuses
   * Extracted from: provider-message-handler.ts:332-357
   */
  async getAllProviderHealth(): Promise<GetAllProviderHealthResult> {
    try {
      const allHealth = this.providerManager.getAllProviderHealth();
      return {
        success: true,
        healthMap: allHealth,
      };
    } catch (error) {
      console.error('Error getting all providers health:', error);
      return {
        success: false,
        error: {
          code: 'GET_ALL_HEALTH_ERROR',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to get all providers health',
        },
      };
    }
  }

  /**
   * Set default provider
   * Extracted from: provider-message-handler.ts:362-395
   */
  async setDefaultProvider(
    request: SetDefaultProviderRequest
  ): Promise<SetDefaultProviderResult> {
    try {
      const { providerId } = request;

      // Validate provider ID
      if (!isValidProviderId(providerId)) {
        return {
          success: false,
          error: {
            code: 'INVALID_PROVIDER_ID',
            message: `Invalid provider ID: ${providerId}`,
          },
        };
      }

      await this.providerManager.setDefaultProvider(providerId as ProviderId);

      return {
        success: true,
        defaultProvider: providerId as ProviderId,
      };
    } catch (error) {
      console.error('Error setting default provider:', error);
      return {
        success: false,
        error: {
          code: 'SET_DEFAULT_ERROR',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to set default provider',
        },
      };
    }
  }

  /**
   * Enable or disable provider fallback
   * Extracted from: provider-message-handler.ts:400-427
   */
  async enableFallback(
    request: EnableFallbackRequest
  ): Promise<EnableFallbackResult> {
    try {
      const { enabled } = request;

      this.providerManager.enableFallback(enabled);

      return {
        success: true,
        fallbackEnabled: enabled,
      };
    } catch (error) {
      console.error('Error enabling/disabling fallback:', error);
      return {
        success: false,
        error: {
          code: 'ENABLE_FALLBACK_ERROR',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to update fallback setting',
        },
      };
    }
  }

  /**
   * Enable or disable auto-switch on provider failure
   * Extracted from: provider-message-handler.ts:432-459
   */
  async setAutoSwitch(
    request: SetAutoSwitchRequest
  ): Promise<SetAutoSwitchResult> {
    try {
      const { enabled } = request;

      this.providerManager.setAutoSwitchOnFailure(enabled);

      return {
        success: true,
        autoSwitchEnabled: enabled,
      };
    } catch (error) {
      console.error('Error setting auto-switch on failure:', error);
      return {
        success: false,
        error: {
          code: 'SET_AUTO_SWITCH_ERROR',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to update auto-switch setting',
        },
      };
    }
  }

  /**
   * Set up provider event listeners
   * Allows external components to listen for provider events
   * Extracted from: provider-message-handler.ts:464-504
   *
   * @param eventType - Type of event to listen for
   * @param callback - Callback function for the event
   */
  setupEventListener(
    eventType:
      | 'provider-switched'
      | 'provider-health-changed'
      | 'provider-error',
    callback: (data: unknown) => void
  ): void {
    this.providerManager.on(eventType, callback);
  }

  /**
   * Remove provider event listener
   *
   * @param eventType - Type of event to remove listener for
   * @param callback - Callback function to remove
   */
  removeEventListener(
    eventType:
      | 'provider-switched'
      | 'provider-health-changed'
      | 'provider-error',
    callback: (data: unknown) => void
  ): void {
    this.providerManager.off(eventType, callback);
  }
}
