import { inject, injectable } from 'tsyringe';
import type {
  ISymbolSink,
  SymbolChunkInsert,
} from '@ptah-extension/memory-contracts';
import { MEMORY_TOKENS } from './di/tokens';
import { CodeSymbolStore, type CodeSymbolInsert } from './code-symbol.store';

function parseSubject(
  subject: string,
): { kind: string; symbolName: string } | null {
  if (!subject.startsWith('code:')) return null;
  const afterPrefix = subject.slice('code:'.length);
  const firstColon = afterPrefix.indexOf(':');
  if (firstColon < 0) return null;
  const kind = afterPrefix.slice(0, firstColon);
  const remainder = afterPrefix.slice(firstColon + 1);
  const lastColon = remainder.lastIndexOf(':');
  if (lastColon < 0) return null;
  const symbolName = remainder.slice(lastColon + 1);
  if (kind.length === 0 || symbolName.length === 0) return null;
  return { kind, symbolName };
}

@injectable()
export class MemoryStoreSymbolSink implements ISymbolSink {
  constructor(
    @inject(MEMORY_TOKENS.CODE_SYMBOL_STORE)
    private readonly codeSymbols: CodeSymbolStore,
  ) {}

  deleteSymbolsForFile(filePath: string, workspaceRoot: string): number {
    return this.codeSymbols.deleteByFile(workspaceRoot, filePath);
  }

  async insertSymbols(chunks: readonly SymbolChunkInsert[]): Promise<void> {
    if (chunks.length === 0) return;
    const entries: CodeSymbolInsert[] = [];
    for (const chunk of chunks) {
      const parsed = parseSubject(chunk.subject);
      if (!parsed) continue;
      entries.push({
        workspaceRoot: chunk.workspaceRoot,
        filePath: chunk.filePath,
        kind: parsed.kind,
        symbolName: parsed.symbolName,
        subject: chunk.subject,
        text: chunk.text,
        tokenCount: chunk.tokenCount,
      });
    }
    await this.codeSymbols.insertBatch(entries);
  }
}
