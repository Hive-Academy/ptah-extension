/**
 * Electron Auth Extended RPC Handlers
 *
 * Handles Electron-specific auth methods that are NOT in the shared AuthRpcHandlers:
 * - auth:setApiKey - Store API key in secret storage (Electron API key auth)
 * - auth:getStatus - Get current auth status (simplified for Electron)
 * - auth:getApiKeyStatus - Get per-provider key status without exposing values
 *
 * The shared AuthRpcHandlers covers: auth:getHealth, auth:saveSettings,
 * auth:testConnection, auth:getAuthStatus, auth:copilotLogin/Logout/Status,
 * auth:codexLogin.
 *
 * TASK_2025_203 Batch 5: Extracted from inline registrations
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { ISecretStorage } from '@ptah-extension/platform-core';

@injectable()
export class ElectronAuthExtendedRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.SECRET_STORAGE)
    private readonly secretStorage: ISecretStorage
  ) {}

  register(): void {
    this.registerSetApiKey();
    this.registerGetStatus();
    this.registerGetApiKeyStatus();
  }

  private registerSetApiKey(): void {
    this.rpcHandler.registerMethod(
      'auth:setApiKey',
      async (params: { provider: string; apiKey: string } | undefined) => {
        if (!params?.provider || !params?.apiKey) {
          return {
            success: false,
            error: 'provider and apiKey are required',
          };
        }

        const storageKey = `ptah.apiKey.${params.provider}`;
        await this.secretStorage.store(storageKey, params.apiKey);

        // Also set in environment for Claude Agent SDK
        if (params.provider === 'anthropic') {
          process.env['ANTHROPIC_API_KEY'] = params.apiKey;
        }

        return { success: true };
      }
    );
  }

  private registerGetStatus(): void {
    this.rpcHandler.registerMethod('auth:getStatus', async () => {
      const anthropicKey = await this.secretStorage.get(
        'ptah.apiKey.anthropic'
      );

      return {
        isAuthenticated: !!anthropicKey,
        provider: 'anthropic',
        hasApiKey: !!anthropicKey,
      };
    });
  }

  private registerGetApiKeyStatus(): void {
    this.rpcHandler.registerMethod('auth:getApiKeyStatus', async () => {
      const anthropicKey = await this.secretStorage.get(
        'ptah.apiKey.anthropic'
      );
      const openrouterKey = await this.secretStorage.get(
        'ptah.apiKey.openrouter'
      );

      return {
        providers: [
          {
            provider: 'anthropic',
            displayName: 'Anthropic (Claude)',
            hasApiKey: !!anthropicKey,
            isDefault: true,
          },
          {
            provider: 'openrouter',
            displayName: 'OpenRouter',
            hasApiKey: !!openrouterKey,
            isDefault: false,
          },
        ],
      };
    });
  }
}
