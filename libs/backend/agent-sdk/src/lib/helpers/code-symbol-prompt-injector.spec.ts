import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  ICodeSymbolReader,
  CodeSymbolHit,
} from '@ptah-extension/memory-contracts';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { CodeSymbolPromptInjector } from './code-symbol-prompt-injector';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeWorkspace(injectionEnabled = true): IWorkspaceProvider {
  return {
    getConfiguration: jest.fn().mockReturnValue(injectionEnabled),
  } as unknown as IWorkspaceProvider;
}

function makeHit(over: Partial<CodeSymbolHit> = {}): CodeSymbolHit {
  return {
    id: '01',
    workspaceRoot: '/ws',
    filePath: '/ws/src/auth.ts',
    kind: 'function',
    symbolName: 'login',
    subject: 'code:/ws/src/auth.ts#login',
    text: 'function login() { return validateToken(); }',
    tokenCount: 9,
    score: 0.04,
    ...over,
  };
}

function makeReader(
  page: { hits: CodeSymbolHit[]; bm25Only: boolean } = {
    hits: [makeHit()],
    bm25Only: false,
  },
): ICodeSymbolReader {
  return {
    searchSymbols: jest.fn().mockResolvedValue(page),
  };
}

const QUERY = 'where do we validate the auth token';

describe('CodeSymbolPromptInjector.buildBlock', () => {
  it('returns "" when no reader is registered', async () => {
    const injector = new CodeSymbolPromptInjector(
      makeLogger(),
      makeWorkspace(),
      null,
    );
    expect(await injector.buildBlock(QUERY, '/ws')).toBe('');
  });

  it('returns "" when the query is shorter than the minimum length', async () => {
    const reader = makeReader();
    const injector = new CodeSymbolPromptInjector(
      makeLogger(),
      makeWorkspace(),
      reader,
    );
    expect(await injector.buildBlock('hi', '/ws')).toBe('');
    expect(reader.searchSymbols).not.toHaveBeenCalled();
  });

  it('returns "" when injection is disabled via setting', async () => {
    const reader = makeReader();
    const injector = new CodeSymbolPromptInjector(
      makeLogger(),
      makeWorkspace(false),
      reader,
    );
    expect(await injector.buildBlock(QUERY, '/ws')).toBe('');
    expect(reader.searchSymbols).not.toHaveBeenCalled();
  });

  it('returns "" when there are no hits', async () => {
    const reader = makeReader({ hits: [], bm25Only: false });
    const injector = new CodeSymbolPromptInjector(
      makeLogger(),
      makeWorkspace(),
      reader,
    );
    expect(await injector.buildBlock(QUERY, '/ws')).toBe('');
  });

  it('returns "" and does not throw when the reader rejects', async () => {
    const reader: ICodeSymbolReader = {
      searchSymbols: jest.fn().mockRejectedValue(new Error('db gone')),
    };
    const logger = makeLogger();
    const injector = new CodeSymbolPromptInjector(
      logger,
      makeWorkspace(),
      reader,
    );
    expect(await injector.buildBlock(QUERY, '/ws')).toBe('');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('formats a symbols block and forwards the workspace root', async () => {
    const reader = makeReader();
    const injector = new CodeSymbolPromptInjector(
      makeLogger(),
      makeWorkspace(),
      reader,
    );
    const block = await injector.buildBlock(QUERY, '/ws');
    expect(block).toContain('## Relevant Workspace Symbols');
    expect(block).toContain('`login`');
    expect(block).toContain('/ws/src/auth.ts');
    expect(reader.searchSymbols).toHaveBeenCalledWith(
      QUERY,
      expect.any(Number),
      '/ws',
    );
  });
});
