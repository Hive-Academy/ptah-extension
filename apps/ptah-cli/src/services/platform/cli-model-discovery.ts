/**
 * CLI Model Discovery Implementation
 *
 * Implements IModelDiscovery for the CLI/TUI environment:
 * - getCopilotModels: Returns empty array (no VS Code LM API in CLI)
 * - getCodexModels: Returns empty array (no VS Code LM API in CLI)
 *
 * In CLI mode, model discovery is not available because there is no
 * VS Code LM API (vscode.lm.selectChatModels). Users configure models
 * directly via API keys in settings.
 */

import type { IModelDiscovery } from '@ptah-extension/rpc-handlers';

export class CliModelDiscovery implements IModelDiscovery {
  async getCopilotModels(): Promise<
    Array<{ id: string; name: string; contextLength: number }>
  > {
    return [];
  }

  async getCodexModels(): Promise<
    Array<{ id: string; name: string; contextLength: number }>
  > {
    return [];
  }
}
