import 'reflect-metadata';
import type { SymbolChunkInsert } from '@ptah-extension/memory-contracts';
import type { CodeSymbolInsert, CodeSymbolStore } from './code-symbol.store';
import { MemoryStoreSymbolSink } from './symbol-sink.adapter';

/**
 * `MemoryStoreSymbolSink` turns indexer chunks into `code_symbols` rows
 * (TASK_2026_559 Batch 24d review r1, R24d-02). The subject's last `:`
 * separates the name from the path, so a name holding `:` (a valid exported
 * string name such as `export { a as "x:y" }`) cannot be parsed back out of
 * it: the producer's explicit kind and name are stored instead.
 */
describe('MemoryStoreSymbolSink', () => {
  function sinkWithCapture(): {
    sink: MemoryStoreSymbolSink;
    rows: CodeSymbolInsert[];
  } {
    const rows: CodeSymbolInsert[] = [];
    const store = {
      insertBatch: jest.fn(async (entries: CodeSymbolInsert[]) => {
        rows.push(...entries);
      }),
      deleteByFile: jest.fn(() => 0),
    } as unknown as CodeSymbolStore;
    return { sink: new MemoryStoreSymbolSink(store), rows };
  }

  const base = {
    text: 'export x:y in src/a.ts:1-1',
    tokenCount: 7,
    filePath: 'D:/ws/src/a.ts',
    workspaceRoot: 'D:/ws',
  };

  it('stores a name holding ":" exactly when the producer names it', async () => {
    const { sink, rows } = sinkWithCapture();
    const chunk: SymbolChunkInsert = {
      ...base,
      subject: 'code:export:D:/ws/src/a.ts:x:y',
      kind: 'export',
      symbolName: 'x:y',
    };

    await sink.insertSymbols([chunk]);

    expect(rows).toEqual([
      expect.objectContaining({
        kind: 'export',
        symbolName: 'x:y',
        subject: 'code:export:D:/ws/src/a.ts:x:y',
      }),
    ]);
  });

  it('still parses kind and name from the subject when the producer omits them', async () => {
    const { sink, rows } = sinkWithCapture();

    await sink.insertSymbols([
      { ...base, subject: 'code:function:D:/ws/src/a.ts:run' },
      { ...base, subject: 'not-a-code-subject' },
    ]);

    expect(rows).toEqual([
      expect.objectContaining({ kind: 'function', symbolName: 'run' }),
    ]);
  });
});
