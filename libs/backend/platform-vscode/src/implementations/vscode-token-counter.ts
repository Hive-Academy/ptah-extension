/**
 * VscodeTokenCounter - ITokenCounter implementation using VS Code LM API.
 *
 * Uses vscode.lm.selectChatModels() for accurate model-specific token counting.
 * Falls back to gpt-tokenizer if no models available.
 */
import * as vscode from 'vscode';
import type { ITokenCounter } from '@ptah-extension/platform-core';
import { encode } from 'gpt-tokenizer';

export class VscodeTokenCounter implements ITokenCounter {
  async countTokens(text: string): Promise<number> {
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (models.length > 0) {
      return await models[0].countTokens(text);
    }
    try {
      return encode(text).length;
    } catch {
      return Math.ceil(text.length / 4);
    }
  }

  async getMaxInputTokens(): Promise<number | null> {
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (models.length > 0) {
      return models[0].maxInputTokens;
    }
    return null;
  }
}
