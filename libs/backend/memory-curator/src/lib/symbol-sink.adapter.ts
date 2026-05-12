// libs/backend/memory-curator/src/lib/symbol-sink.adapter.ts
// TASK_2026_THOTH_CODE_INDEX

import { inject, injectable } from 'tsyringe';
import type {
  ISymbolSink,
  SymbolChunkInsert,
} from '@ptah-extension/memory-contracts';
import { MEMORY_TOKENS } from './di/tokens';
import { MemoryStore } from './memory.store';

@injectable()
export class MemoryStoreSymbolSink implements ISymbolSink {
  constructor(
    @inject(MEMORY_TOKENS.MEMORY_STORE) private readonly store: MemoryStore,
  ) {}

  deleteSymbolsForFile(filePath: string, workspaceRoot: string): number {
    // Match subject pattern: "code:<kind>:<filePath>:<symbolName>"
    // Use '%' wildcard for kind and symbolName; exact filePath match in between.
    return this.store.deleteBySubjectPrefix(
      'code:%:' + filePath + ':',
      workspaceRoot,
    );
  }

  async insertSymbols(chunks: readonly SymbolChunkInsert[]): Promise<void> {
    for (const chunk of chunks) {
      await this.store.insertMemoryWithChunks(
        {
          kind: 'entity',
          tier: 'archival',
          salience: 0.5,
          pinned: true,
          subject: chunk.subject,
          content: chunk.text,
          workspaceRoot: chunk.workspaceRoot,
        },
        [{ text: chunk.text, tokenCount: chunk.tokenCount, ord: 0 }],
      );
    }
  }
}
