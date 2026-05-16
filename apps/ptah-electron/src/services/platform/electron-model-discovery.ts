/**
 * Electron Model Discovery Implementation
 *
 * Stub implementation for Electron:
 * - getCopilotModels: Returns empty array (VS Code LM API not available)
 * - getCodexModels: Returns empty array (VS Code LM API not available)
 */

import { injectable } from 'tsyringe';
import type { IModelDiscovery } from '@ptah-extension/rpc-handlers';

@injectable()
export class ElectronModelDiscovery implements IModelDiscovery {
  async getCopilotModels(): Promise<
    Array<{ id: string; name: string; contextLength: number }>
  > {
    // VS Code Language Model API is not available in Electron
    return [];
  }

  async getCodexModels(): Promise<
    Array<{ id: string; name: string; contextLength: number }>
  > {
    // VS Code Language Model API is not available in Electron
    return [];
  }
}
