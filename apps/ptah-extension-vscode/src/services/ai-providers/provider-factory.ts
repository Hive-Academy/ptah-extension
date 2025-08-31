/**
 * AI Provider Factory
 * Creates and manages AI provider instances
 * Supports both Claude CLI and VS Code LM providers
 */

import { Logger } from '../../core/logger';
import {
  IAIProvider,
  IProviderFactory,
  ProviderId,
  ProviderInfo,
  PROVIDER_IDS,
  isValidProviderId,
} from '@ptah-extension/shared';
import { ClaudeCliService } from '../claude-cli.service';
import { ClaudeCliProviderAdapter } from './claude-cli-provider-adapter';
import { VSCodeLMProvider, VSCodeLMProviderConfig } from './vscode-lm-provider';

/**
 * Provider Factory Configuration
 */
export interface ProviderFactoryConfig {
  claudeCli?: {
    service: ClaudeCliService;
  };
  vscodeLm?: VSCodeLMProviderConfig;
}

/**
 * AI Provider Factory Implementation
 */
export class ProviderFactory implements IProviderFactory {
  private providerInstances = new Map<ProviderId, IAIProvider>();
  private config: ProviderFactoryConfig;

  constructor(config: ProviderFactoryConfig) {
    this.config = config;
    Logger.info('Provider factory initialized');
  }

  /**
   * Create a provider instance
   */
  async createProvider(providerId: ProviderId): Promise<IAIProvider> {
    if (!isValidProviderId(providerId)) {
      throw new Error(`Invalid provider ID: ${providerId}`);
    }

    // Return existing instance if available
    const existingProvider = this.providerInstances.get(providerId);
    if (existingProvider) {
      Logger.info(`Returning existing ${providerId} provider instance`);
      return existingProvider;
    }

    Logger.info(`Creating new ${providerId} provider instance...`);

    let provider: IAIProvider;

    switch (providerId) {
      case 'claude-cli':
        provider = await this.createClaudeCliProvider();
        break;

      case 'vscode-lm':
        provider = await this.createVSCodeLMProvider();
        break;

      default:
        throw new Error(`Unsupported provider: ${providerId}`);
    }

    // Initialize the provider
    const initSuccess = await provider.initialize();
    if (!initSuccess) {
      throw new Error(`Failed to initialize ${providerId} provider`);
    }

    // Cache the provider
    this.providerInstances.set(providerId, provider);
    Logger.info(`${providerId} provider created and cached successfully`);

    return provider;
  }

  /**
   * Get available providers (those that can be created)
   */
  async getAvailableProviders(): Promise<readonly ProviderId[]> {
    const availableProviders: ProviderId[] = [];

    for (const providerId of PROVIDER_IDS) {
      try {
        const canCreate = await this.canCreateProvider(providerId);
        if (canCreate) {
          availableProviders.push(providerId);
        }
      } catch (error) {
        Logger.warn(`Provider ${providerId} not available:`, error);
      }
    }

    Logger.info(`Available providers: ${availableProviders.join(', ')}`);
    return availableProviders;
  }

  /**
   * Get provider information without creating the provider
   */
  getProviderInfo(providerId: ProviderId): ProviderInfo | undefined {
    switch (providerId) {
      case 'claude-cli':
        return {
          id: 'claude-cli',
          name: 'Claude Code CLI',
          version: '1.0.0',
          description: 'Anthropic Claude Code CLI with advanced streaming and resilience features',
          vendor: 'Anthropic',
          capabilities: {
            streaming: true,
            fileAttachments: true,
            contextManagement: true,
            sessionPersistence: true,
            multiTurn: true,
            codeGeneration: true,
            imageAnalysis: true,
            functionCalling: true,
          },
          maxContextTokens: 200000,
        };

      case 'vscode-lm':
        return {
          id: 'vscode-lm',
          name: 'VS Code Language Model',
          version: '1.0.0',
          description: 'VS Code integrated language model provider with Copilot support',
          vendor: 'Microsoft/GitHub',
          capabilities: {
            streaming: true,
            fileAttachments: true,
            contextManagement: true,
            sessionPersistence: true,
            multiTurn: true,
            codeGeneration: true,
            imageAnalysis: false,
            functionCalling: false,
          },
          maxContextTokens: 8192,
        };

      default:
        return undefined;
    }
  }

  /**
   * Get cached provider instance
   */
  getProviderInstance(providerId: ProviderId): IAIProvider | undefined {
    return this.providerInstances.get(providerId);
  }

  /**
   * Dispose all provider instances
   */
  dispose(): void {
    Logger.info('Disposing provider factory...');

    for (const [providerId, provider] of this.providerInstances) {
      try {
        provider.dispose();
        Logger.info(`${providerId} provider disposed`);
      } catch (error) {
        Logger.error(`Error disposing ${providerId} provider:`, error);
      }
    }

    this.providerInstances.clear();
    Logger.info('Provider factory disposed');
  }

  /**
   * Clear cached provider instances
   */
  clearCache(): void {
    Logger.info('Clearing provider factory cache...');

    for (const [providerId, provider] of this.providerInstances) {
      try {
        provider.dispose();
      } catch (error) {
        Logger.error(`Error disposing cached ${providerId} provider:`, error);
      }
    }

    this.providerInstances.clear();
    Logger.info('Provider factory cache cleared');
  }

  /**
   * Update factory configuration
   */
  updateConfig(config: Partial<ProviderFactoryConfig>): void {
    this.config = { ...this.config, ...config };
    Logger.info('Provider factory configuration updated');
  }

  /**
   * Private helper methods
   */
  private async createClaudeCliProvider(): Promise<IAIProvider> {
    if (!this.config.claudeCli?.service) {
      throw new Error('Claude CLI service not provided in factory configuration');
    }

    const adapter = new ClaudeCliProviderAdapter(this.config.claudeCli.service);
    return adapter;
  }

  private async createVSCodeLMProvider(): Promise<IAIProvider> {
    const provider = new VSCodeLMProvider(this.config.vscodeLm);
    return provider;
  }

  private async canCreateProvider(providerId: ProviderId): Promise<boolean> {
    switch (providerId) {
      case 'claude-cli':
        return this.canCreateClaudeCliProvider();

      case 'vscode-lm':
        return this.canCreateVSCodeLMProvider();

      default:
        return false;
    }
  }

  private async canCreateClaudeCliProvider(): Promise<boolean> {
    try {
      // Check if Claude CLI service is available in config
      if (!this.config.claudeCli?.service) {
        Logger.warn('Claude CLI service not available in factory configuration');
        return false;
      }

      // Try to verify installation
      const isAvailable = await this.config.claudeCli.service.verifyInstallation();
      return isAvailable;
    } catch (error) {
      Logger.warn('Cannot create Claude CLI provider:', error);
      return false;
    }
  }

  private async canCreateVSCodeLMProvider(): Promise<boolean> {
    try {
      // Check if VS Code LM API is available
      const vscode = require('vscode');
      if (!vscode.lm) {
        Logger.warn('VS Code Language Model API not available');
        return false;
      }

      // Try to get available models
      const models = await vscode.lm.selectChatModels({});
      const hasModels = models && models.length > 0;

      if (!hasModels) {
        Logger.warn('No VS Code language models available');
      }

      return hasModels;
    } catch (error) {
      Logger.warn('Cannot create VS Code LM provider:', error);
      return false;
    }
  }
}
