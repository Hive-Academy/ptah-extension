/**
 * MemoryPromptInjector — prepends recalled memory hits to the session system prompt.
 *
 * Called by SdkQueryOptionsBuilder at session start for premium users.
 * Always returns '' on error or 0 hits — never throws.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  MEMORY_CONTRACT_TOKENS,
  type IMemoryReader,
} from '@ptah-extension/memory-contracts';

const MAX_HITS = 5;
const MAX_CHUNK_CHARS = 400;
const MIN_QUERY_LENGTH = 8;
const MIN_SCORE = 0.05;

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
    if (query.trim().length < MIN_QUERY_LENGTH) return '';
    try {
      const result = await this.memoryReader.search(
        query,
        MAX_HITS,
        workspaceRoot,
      );
      const hits = result.hits.filter((h) => h.score >= MIN_SCORE);
      if (hits.length === 0) return '';
      const lines = hits.map((h, i) => {
        const label = h.subject ? `[${h.subject}]` : '[memory]';
        const raw = h.chunkText;
        const text =
          raw.length > MAX_CHUNK_CHARS
            ? raw.slice(
                0,
                raw.lastIndexOf(' ', MAX_CHUNK_CHARS) || MAX_CHUNK_CHARS,
              ) + '…'
            : raw;
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
    } catch (err: unknown) {
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
