import 'reflect-metadata';

jest.mock('vscode', () => ({}), { virtual: true });

import { ContextService } from './context.service';
import type { FileSearchResult } from '../file-indexing/workspace-file-index.service';

/**
 * ContextService file-search is now served entirely by the live
 * WorkspaceFileIndexService. These tests assert ContextService delegates to the
 * index (fresh, no disk walk) and applies the thin image/type filtering +
 * pagination + inclusion-priority layers on top.
 */
describe('ContextService file search (index-backed)', () => {
  let ensureReady: jest.Mock;
  let search: jest.Mock;
  let getAll: jest.Mock;
  let searchDirectories: jest.Mock;

  const file = (
    fileName: string,
    fileType: FileSearchResult['fileType'] = 'text',
    isDirectory = false,
  ): FileSearchResult => ({
    path: `/workspace/${fileName}`,
    relativePath: fileName,
    fileName,
    fileType,
    size: 0,
    lastModified: 0,
    isDirectory,
  });

  const makeService = (): ContextService => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    const configManager = { get: jest.fn() };
    const fsProvider = {} as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const workspaceProvider = {
      getWorkspaceRoot: jest.fn(() => '/workspace'),
      getWorkspaceFolders: jest.fn(() => ['/workspace']),
      getConfiguration: jest.fn(
        (_section: string, _key: string, fallback: unknown) => fallback,
      ),
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const editorProvider = {} as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const commandRegistry = { executeCommand: jest.fn() } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const sentryService = { captureException: jest.fn() } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const ignoreResolver = {
      parseWorkspaceIgnoreFiles: jest.fn(async () => []),
      isIgnored: jest.fn(async () => ({ ignored: false })),
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const fileIndex = {
      ensureReady,
      search,
      getAll,
      searchDirectories,
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
      fileIndex,
    );
  };

  beforeEach(() => {
    ensureReady = jest.fn(async () => undefined);
    search = jest.fn(() => []);
    getAll = jest.fn(() => []);
    searchDirectories = jest.fn(() => []);
  });

  it('searchFiles awaits the index build then delegates to index.search', async () => {
    search.mockReturnValue([file('auth.service.ts'), file('auth.spec.ts')]);
    const service = makeService();

    const results = await service.searchFiles({ query: 'auth' });

    expect(ensureReady).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('auth', expect.any(Number));
    expect(results.map((r) => r.fileName)).toEqual([
      'auth.service.ts',
      'auth.spec.ts',
    ]);
  });

  it('searchFiles excludes images unless includeImages is set', async () => {
    search.mockReturnValue([file('logo.png', 'image'), file('a.ts', 'text')]);
    const service = makeService();

    const withoutImages = await service.searchFiles({ query: 'a' });
    expect(withoutImages.map((r) => r.fileName)).toEqual(['a.ts']);

    const withImages = await service.searchFiles({
      query: 'a',
      includeImages: true,
    });
    expect(withImages.map((r) => r.fileName)).toEqual(['logo.png', 'a.ts']);
  });

  it('searchFiles filters by requested fileTypes extensions', async () => {
    search.mockReturnValue([
      file('a.ts', 'text'),
      file('b.css', 'text'),
      file('c.ts', 'text'),
    ]);
    const service = makeService();

    const results = await service.searchFiles({
      query: '',
      fileTypes: ['.ts'],
    });

    expect(results.map((r) => r.fileName)).toEqual(['a.ts', 'c.ts']);
  });

  it('getAllFiles paginates the index snapshot and drops images by default', async () => {
    getAll.mockReturnValue([
      file('a.ts'),
      file('b.ts'),
      file('logo.png', 'image'),
      file('c.ts'),
    ]);
    const service = makeService();

    const page = await service.getAllFiles(false, 1, 2);

    expect(ensureReady).toHaveBeenCalled();
    // images filtered → [a, b, c]; offset 1 limit 2 → [b, c]
    expect(page.map((r) => r.fileName)).toEqual(['b.ts', 'c.ts']);
  });

  it('getFileSuggestions with a short query returns the all-files list', async () => {
    getAll.mockReturnValue([file('a.ts'), file('b.ts')]);
    const service = makeService();

    const results = await service.getFileSuggestions('a', 20);

    // short query (<2 chars) path calls getAll, not search
    expect(search).not.toHaveBeenCalled();
    expect(results.map((r) => r.fileName)).toEqual(['a.ts', 'b.ts']);
  });

  it('getFileSuggestions merges directory matches with file matches', async () => {
    search.mockReturnValue([file('auth.service.ts'), file('auth.util.ts')]);
    searchDirectories.mockReturnValue([file('auth', 'unknown', true)]);
    const service = makeService();

    const results = await service.getFileSuggestions('auth', 20);

    expect(search).toHaveBeenCalledWith('auth', 40);
    expect(searchDirectories).toHaveBeenCalledWith('auth', 20);
    // The directory entry plus both file matches should all be present.
    const names = results.map((r) => r.fileName);
    expect(names).toContain('auth');
    expect(names).toContain('auth.service.ts');
    expect(names).toContain('auth.util.ts');
  });
});
