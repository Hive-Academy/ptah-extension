/**
 * ElectronTokenCounter - ITokenCounter implementation using gpt-tokenizer.
 *
 * Pure JavaScript BPE tokenizer. No VS Code dependency.
 * Provides accurate GPT-4 tokenization (~5% margin vs cl100k_base for Claude).
 */
import type { ITokenCounter } from '@ptah-extension/platform-core';
import { encode } from 'gpt-tokenizer';

export class ElectronTokenCounter implements ITokenCounter {
  async countTokens(text: string): Promise<number> {
    return encode(text).length;
  }

  async getMaxInputTokens(): Promise<number | null> {
    // No model discovery available outside VS Code.
    // Return null — callers already handle null (use default budget).
    return null;
  }
}
