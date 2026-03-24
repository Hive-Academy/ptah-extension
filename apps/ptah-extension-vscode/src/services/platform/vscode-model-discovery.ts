/**
 * VS Code Model Discovery Implementation (TASK_2025_203)
 *
 * Implements IModelDiscovery using VS Code Language Model API:
 * - getCopilotModels: vscode.lm.selectChatModels({ vendor: 'copilot' })
 * - getCodexModels: vscode.lm.selectChatModels() filtered by Codex IDs
 */

import { injectable } from 'tsyringe';
import * as vscode from 'vscode';
import type { IModelDiscovery } from '@ptah-extension/rpc-handlers';

@injectable()
export class VsCodeModelDiscovery implements IModelDiscovery {
  async getCopilotModels(): Promise<
    Array<{ id: string; name: string; contextLength: number }>
  > {
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      return models.map((m) => ({
        id: m.family,
        name: m.family,
        contextLength: m.maxInputTokens ?? 0,
      }));
    } catch {
      return [];
    }
  }

  async getCodexModels(): Promise<
    Array<{ id: string; name: string; contextLength: number }>
  > {
    try {
      const models = await vscode.lm.selectChatModels();
      // Return all non-copilot models as potential Codex models
      // The caller will filter further against known Codex model IDs
      return models.map((m) => ({
        id: m.family,
        name: m.family,
        contextLength: m.maxInputTokens ?? 0,
      }));
    } catch {
      return [];
    }
  }
}
