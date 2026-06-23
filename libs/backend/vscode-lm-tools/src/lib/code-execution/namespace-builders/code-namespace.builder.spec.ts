import type {
  ICodeSymbolReader,
  IMemoryReader,
  CodeSymbolHit,
  MemoryHit,
} from '@ptah-extension/memory-contracts';
import {
  buildCodeNamespace,
  type CodeNamespaceDependencies,
  type SymbolSearchResult,
} from './code-namespace.builder';

function makeCodeHit(over: Partial<CodeSymbolHit> = {}): CodeSymbolHit {
  return {
    id: '01',
    workspaceRoot: '/ws',
    filePath: '/ws/src/auth.ts',
    kind: 'function',
    symbolName: 'login',
    subject: 'code:/ws/src/auth.ts#login',
    text: 'function login() {}',
    tokenCount: 5,
    score: 0.04,
    ...over,
  };
}

function makeMemoryHit(over: Partial<MemoryHit> = {}): MemoryHit {
  return {
    memoryId: 'm1',
    subject: 'code:/ws/src/auth.ts#login',
    content: '',
    chunkText: 'function login() {}',
    score: 0.03,
    tier: 'archival',
    ...over,
  };
}

function makeDeps(
  over: Partial<CodeNamespaceDependencies> = {},
): CodeNamespaceDependencies {
  return {
    getCodeSymbolSearch: () => undefined,
    getMemorySearch: () => undefined,
    getSymbolIndexer: () => undefined,
    getWorkspaceRoot: () => '/ws',
    ...over,
  };
}

describe('buildCodeNamespace.searchSymbols', () => {
  it('uses the dedicated code-symbol reader when available', async () => {
    const reader: ICodeSymbolReader = {
      searchSymbols: jest
        .fn()
        .mockResolvedValue({ hits: [makeCodeHit()], bm25Only: false }),
    };
    const ns = buildCodeNamespace(
      makeDeps({ getCodeSymbolSearch: () => reader }),
    );

    const result = (await ns.searchSymbols('validate token', {
      maxResults: 5,
    })) as SymbolSearchResult;

    expect(reader.searchSymbols).toHaveBeenCalledWith(
      'validate token',
      5,
      '/ws',
    );
    expect(result.bm25Only).toBe(false);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({
      symbolName: 'login',
      filePath: '/ws/src/auth.ts',
      kind: 'function',
      text: 'function login() {}',
    });
  });

  it('filters dedicated reader hits by the filePath option', async () => {
    const reader: ICodeSymbolReader = {
      searchSymbols: jest.fn().mockResolvedValue({
        hits: [
          makeCodeHit({ filePath: '/ws/src/auth.ts' }),
          makeCodeHit({
            filePath: '/ws/src/math.ts',
            symbolName: 'add',
            subject: 'code:/ws/src/math.ts#add',
          }),
        ],
        bm25Only: false,
      }),
    };
    const ns = buildCodeNamespace(
      makeDeps({ getCodeSymbolSearch: () => reader }),
    );

    const result = (await ns.searchSymbols('x', {
      filePath: 'auth.ts',
    })) as SymbolSearchResult;

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].filePath).toBe('/ws/src/auth.ts');
  });

  it('falls back to the memory reader, filtered to code subjects', async () => {
    const memory: IMemoryReader = {
      search: jest.fn().mockResolvedValue({
        hits: [
          makeMemoryHit(),
          makeMemoryHit({
            memoryId: 'm2',
            subject: 'note:not-code',
            tier: 'archival',
          }),
          makeMemoryHit({
            memoryId: 'm3',
            subject: 'code:/ws/src/x.ts#y',
            tier: 'recall',
          }),
        ],
        bm25Only: true,
      }),
    };
    const ns = buildCodeNamespace(makeDeps({ getMemorySearch: () => memory }));

    const result = (await ns.searchSymbols('login', {})) as SymbolSearchResult;

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({
      filePath: '/ws/src/auth.ts',
      symbolName: 'login',
    });
  });

  it('returns an error when neither search service is available', async () => {
    const ns = buildCodeNamespace(makeDeps());
    const result = await ns.searchSymbols('login');
    expect('error' in result).toBe(true);
    expect(result.hits).toHaveLength(0);
  });

  it('returns an error result when the dedicated reader throws', async () => {
    const reader: ICodeSymbolReader = {
      searchSymbols: jest.fn().mockRejectedValue(new Error('db gone')),
    };
    const ns = buildCodeNamespace(
      makeDeps({ getCodeSymbolSearch: () => reader }),
    );
    const result = await ns.searchSymbols('login');
    expect('error' in result).toBe(true);
  });
});
