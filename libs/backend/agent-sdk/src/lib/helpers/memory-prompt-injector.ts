/**
 * MemoryPromptInjector — prepends recalled memory hits to the session system prompt.
 *
 * Called by SdkQueryOptionsBuilder at session start for premium users.
 * Always returns '' on error or 0 hits — never throws.
 *
 * TASK_2026_THOTH_MEMORY_READ
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  MEMORY_CONTRACT_TOKENS,
  type IMemoryReader,
} from '@ptah-extension/memory-contracts';

const MAX_HITS = 5;
const MAX_CHUNK_CHARS = 200;

@injectable()
export class MemoryPromptInjector {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(MEMORY_CONTRACT_TOKENS.MEMORY_READER)
    private readonly memoryReader: IMemoryReader,
  ) {}

  /**
   * Returns a formatted memory block for system prompt injection.
   * Returns '' when no hits, store unavailable, or any error occurs.
   */
  async buildBlock(query: string, workspaceRoot?: string): Promise<string> {
    if (!query.trim()) return '';
    try {
      const result = await this.memoryReader.search(
        query,
        MAX_HITS,
        workspaceRoot,
      );
      if (result.hits.length === 0) return '';
      const lines = result.hits.map((h, i) => {
        const label = h.subject ? `[${h.subject}]` : '[memory]';
        const text =
          h.chunkText.length > MAX_CHUNK_CHARS
            ? h.chunkText.slice(0, MAX_CHUNK_CHARS) + '…'
            : h.chunkText;
        return `${i + 1}. ${label}: ${text}`;
      });
      return [
        '## Recalled Memory Context',
        'The following facts were recalled from your persistent memory based on this session:',
        '',
        ...lines,
        '',
        '---',
      ].join('\n');
    } catch (err) {
      this.logger.warn(
        '[MemoryPromptInjector] Memory search failed; skipping injection',
        {
          error: err instanceof Error ? err.message : String(err),
        },
      );
      return '';
    }
  }
}
