import 'reflect-metadata';

jest.mock('vscode', () => ({}), { virtual: true });

import { ContextService, FileSearchResult } from './context.service';
import { FileType } from '@ptah-extension/platform-core';

describe('ContextService file search', () => {
  let service: ContextService;
  let findFiles: jest.Mock;
  let stat: jest.Mock;

  const makeService = (): ContextService => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    const configManager = { get: jest.fn() };
    const fsProvider = {
      findFiles,
      stat,
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const workspaceProvider = {
      getWorkspaceRoot: jest.fn(() => '/workspace'),
      getWorkspaceFolders: jest.fn(() => ['/workspace']),
      getConfiguration: jest.fn(
        (_section: string, _key: string, fallback: unknown) => fallback,
      ),
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const editorProvider = {} as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const commandRegistry = {
      executeCommand: jest.fn(),
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const sentryService = {
      captureException: jest.fn(),
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const ignoreResolver = {
      parseWorkspaceIgnoreFiles: jest.fn(async () => []),
      isIgnored: jest.fn(async () => ({ ignored: false })),
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    return new ContextService(
      logger as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      configManager as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      fsProvider,
      workspaceProvider,
      editorProvider,
      commandRegistry,
      sentryService,
      ignoreResolver,
    );
  };

  beforeEach(() => {
    stat = jest.fn(async () => ({
      size: 10,
      mtime: 1,
      type: FileType.File,
    }));
    findFiles = jest.fn(async () => []);
    service = makeService();
  });

  it('passes an exact-filename glob through unwrapped and returns matches', async () => {
    findFiles.mockImplementation(async (pattern: string) => {
      if (pattern === '**/package.json') {
        return ['/workspace/a/package.json', '/workspace/b/package.json'];
      }
      return [];
    });

    const results = await service.searchFiles({ query: '**/package.json' });

    const patternsUsed = findFiles.mock.calls.map((c) => c[0]);
    expect(patternsUsed).toContain('**/package.json');
    expect(patternsUsed).not.toContain('**/***/package.json*');
    expect(patternsUsed.every((p: string) => !p.includes('***'))).toBe(true);
    expect(results.map((r) => r.fileName)).toEqual([
      'package.json',
      'package.json',
    ]);
  });

  it('passes a directory-scoped glob through unwrapped', async () => {
    findFiles.mockImplementation(async (pattern: string) => {
      if (pattern === 'src/**/*.component.ts') {
        return ['/workspace/src/app/foo.component.ts'];
      }
      return [];
    });

    await service.searchFiles({ query: 'src/**/*.component.ts' });

    const patternsUsed = findFiles.mock.calls.map((c) => c[0]);
    expect(patternsUsed).toContain('src/**/*.component.ts');
  });

  it('still wraps a plain substring token for fuzzy matching', async () => {
    findFiles.mockImplementation(async (pattern: string) => {
      if (pattern === '**/*auth*') {
        return ['/workspace/src/auth.service.ts'];
      }
      return [];
    });

    const results = await service.searchFiles({ query: 'auth' });

    const patternsUsed = findFiles.mock.calls.map((c) => c[0]);
    expect(patternsUsed).toContain('**/*auth*');
    expect(results.map((r) => r.fileName)).toEqual(['auth.service.ts']);
  });

  it('resolves two distinct concurrent searches with their own results', async () => {
    findFiles.mockImplementation(async (pattern: string) => {
      if (pattern === '**/*.component.ts') {
        return ['/workspace/src/a.component.ts'];
      }
      if (pattern === '**/package.json') {
        return ['/workspace/package.json'];
      }
      return [];
    });

    const [components, packages] = await Promise.all([
      service.searchFiles({ query: '**/*.component.ts' }),
      service.searchFiles({ query: '**/package.json' }),
    ]);

    expect(components.map((r: FileSearchResult) => r.fileName)).toEqual([
      'a.component.ts',
    ]);
    expect(packages.map((r: FileSearchResult) => r.fileName)).toEqual([
      'package.json',
    ]);
  });

  it('collapses rapid identical queries into a single search', async () => {
    findFiles.mockImplementation(async (pattern: string) => {
      if (pattern === '**/*auth*') {
        return ['/workspace/src/auth.service.ts'];
      }
      return [];
    });

    const [first, second] = await Promise.all([
      service.searchFiles({ query: 'auth' }),
      service.searchFiles({ query: 'auth' }),
    ]);

    const authCalls = findFiles.mock.calls.filter((c) => c[0] === '**/*auth*');
    expect(authCalls.length).toBe(1);
    expect(first.map((r) => r.fileName)).toEqual(['auth.service.ts']);
    expect(second.map((r) => r.fileName)).toEqual(['auth.service.ts']);
  });
});
