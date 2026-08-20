import 'reflect-metadata';

jest.mock('vscode', () => ({}), { virtual: true });

import { ContextService, WorkspaceRootMismatchError } from './context.service';
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

/**
 * TASK_2026_200 — explicit workspace scoping on the picker path.
 *
 * Criterion 9: `context:getAllFiles` / `getFileSuggestions` answer for an
 * explicitly requested root, independent of whatever root the process-global
 * `IWorkspaceProvider` reports.
 *
 * R5: when the index is not holding the requested root, the service REBUILDS
 * for it (the normal case, via `ensureReadyFor`) or fails loudly with
 * `WorkspaceRootMismatchError` (the lost-race case). It must NEVER return the
 * other root's files — that silent wrong answer is the defect class this task
 * exists to kill. See context.md §7.2 for why one index cannot serve two roots
 * at the same instant.
 */
describe('ContextService workspace scoping (TASK_2026_200)', () => {
  const isWin = process.platform === 'win32';
  const ROOT_A = isWin ? 'D:\\proj-a' : '/proj-a';
  const ROOT_B = isWin ? 'D:\\proj-b' : '/proj-b';
  /** Normalized forms, as `WorkspaceFileIndexService.indexedRoot` reports them. */
  const KEY_A = isWin ? 'd:\\proj-a' : '/proj-a';
  const KEY_B = isWin ? 'd:\\proj-b' : '/proj-b';

  interface IndexStub {
    ensureReady: jest.Mock;
    ensureReadyFor: jest.Mock;
    search: jest.Mock;
    getAll: jest.Mock;
    searchDirectories: jest.Mock;
    indexedRoot: string | undefined;
  }

  const fileIn = (root: string, fileName: string): FileSearchResult => ({
    path: `${root}/${fileName}`,
    relativePath: fileName,
    fileName,
    fileType: 'text',
    size: 0,
    lastModified: 0,
    isDirectory: false,
  });

  /**
   * A ContextService whose provider insists the active folder is A, over an
   * index stub that starts out holding A. `ensureReadyFor` flips `indexedRoot`
   * to the normalized requested root, mirroring the real service's contract —
   * so any assertion below that yields B's files proves the explicit param
   * beat the provider.
   */
  const makeScoped = (): { service: ContextService; index: IndexStub } => {
    const index: IndexStub = {
      ensureReady: jest.fn(async () => undefined),
      ensureReadyFor: jest.fn(async (root: string) => {
        index.indexedRoot = root
          .replace(/[\\/]+$/, '')
          .replace(/^([A-Za-z]):/, (_m, d: string) => `${d.toLowerCase()}:`);
      }),
      search: jest.fn(() => []),
      getAll: jest.fn(() => []),
      searchDirectories: jest.fn(() => []),
      indexedRoot: KEY_A,
    };

    const noop = jest.fn();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const service = new ContextService(
      { info: noop, warn: noop, error: noop, debug: noop } as any,
      { get: jest.fn() } as any,
      {} as any,
      {
        getWorkspaceRoot: jest.fn(() => ROOT_A),
        getWorkspaceFolders: jest.fn(() => [ROOT_A]),
        getConfiguration: jest.fn(
          (_s: string, _k: string, fallback: unknown) => fallback,
        ),
      } as any,
      {} as any,
      { executeCommand: jest.fn() } as any,
      { captureException: jest.fn() } as any,
      {
        parseWorkspaceIgnoreFiles: jest.fn(async () => []),
        isIgnored: jest.fn(async () => ({ ignored: false })),
      } as any,
      index as any,
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { service, index };
  };

  /** Make the index end up holding A even though B was requested (lost race). */
  const stealIndexForA = (index: IndexStub): void => {
    index.ensureReadyFor.mockImplementation(async () => {
      index.indexedRoot = KEY_A;
    });
  };

  // -------------------------------------------------------------------------
  // Criterion 9 — the explicit root wins over the process-global provider
  // -------------------------------------------------------------------------

  it('getAllFiles with an explicit root rebuilds for it and returns its files while the provider still reports A', async () => {
    const { service, index } = makeScoped();
    index.getAll.mockReturnValue([fileIn(ROOT_B, 'b-only.ts')]);

    const results = await service.getAllFiles(false, 0, 100, ROOT_B);

    expect(index.ensureReadyFor).toHaveBeenCalledWith(ROOT_B);
    // `ensureReady()` is the path that reads the process-global provider — it
    // must not be taken when the caller named a root.
    expect(index.ensureReady).not.toHaveBeenCalled();
    expect(results.map((r) => r.path)).toEqual([`${ROOT_B}/b-only.ts`]);
  });

  it('getFileSuggestions with an explicit root rebuilds for it and never takes the provider path', async () => {
    const { service, index } = makeScoped();
    index.search.mockReturnValue([fileIn(ROOT_B, 'b-only.ts')]);

    const results = await service.getFileSuggestions('b-only', 20, ROOT_B);

    expect(index.ensureReadyFor).toHaveBeenCalledWith(ROOT_B);
    expect(index.ensureReady).not.toHaveBeenCalled();
    expect(results.map((r) => r.path)).toEqual([`${ROOT_B}/b-only.ts`]);
  });

  it('getFileSuggestions short-query path also honours the explicit root', async () => {
    const { service, index } = makeScoped();
    index.getAll.mockReturnValue([fileIn(ROOT_B, 'b-only.ts')]);

    const results = await service.getFileSuggestions('a', 20, ROOT_B);

    expect(index.ensureReadyFor).toHaveBeenCalledWith(ROOT_B);
    expect(index.ensureReady).not.toHaveBeenCalled();
    expect(results.map((r) => r.path)).toEqual([`${ROOT_B}/b-only.ts`]);
  });

  it('searchFiles with an explicit root rebuilds for it (the MCP search path, criterion 4)', async () => {
    const { service, index } = makeScoped();
    index.search.mockReturnValue([fileIn(ROOT_B, 'b-only.ts')]);

    const results = await service.searchFiles({
      query: 'b-only',
      workspaceRoot: ROOT_B,
    });

    expect(index.ensureReadyFor).toHaveBeenCalledWith(ROOT_B);
    expect(index.ensureReady).not.toHaveBeenCalled();
    expect(results.map((r) => r.path)).toEqual([`${ROOT_B}/b-only.ts`]);
  });

  // -------------------------------------------------------------------------
  // Criterion 13 — normalized comparison, no spurious mismatch
  // -------------------------------------------------------------------------

  it('accepts trailing-separator and drive-case variants of the requested root', async () => {
    const { service, index } = makeScoped();
    index.ensureReadyFor.mockImplementation(async () => {
      index.indexedRoot = KEY_B;
    });
    index.getAll.mockReturnValue([fileIn(ROOT_B, 'b-only.ts')]);

    const variant = isWin ? 'D:\\proj-b\\' : '/proj-b/';
    const results = await service.getAllFiles(false, 0, 100, variant);

    expect(results.map((r) => r.fileName)).toEqual(['b-only.ts']);
  });

  // -------------------------------------------------------------------------
  // R5 — loud mismatch, never a silent wrong answer
  // -------------------------------------------------------------------------

  it('R5: getAllFiles throws instead of returning root A files when the index is stolen after the rebuild await', async () => {
    const { service, index } = makeScoped();
    stealIndexForA(index);
    index.getAll.mockReturnValue([fileIn(ROOT_A, 'a-secret.ts')]);

    await expect(service.getAllFiles(false, 0, 100, ROOT_B)).rejects.toThrow(
      WorkspaceRootMismatchError,
    );
    // The whole point of the rule: A's paths must not reach the caller by any
    // route, so the read must not even happen.
    expect(index.getAll).not.toHaveBeenCalled();
  });

  it('R5: getFileSuggestions refuses rather than serving the other root', async () => {
    const { service, index } = makeScoped();
    stealIndexForA(index);
    index.search.mockReturnValue([fileIn(ROOT_A, 'a-secret.ts')]);

    await expect(
      service.getFileSuggestions('a-secret', 20, ROOT_B),
    ).rejects.toThrow(WorkspaceRootMismatchError);
    expect(index.search).not.toHaveBeenCalled();
  });

  it('R5: getFileSuggestions short-query path refuses rather than serving the other root', async () => {
    const { service, index } = makeScoped();
    stealIndexForA(index);
    index.getAll.mockReturnValue([fileIn(ROOT_A, 'a-secret.ts')]);

    await expect(service.getFileSuggestions('a', 20, ROOT_B)).rejects.toThrow(
      WorkspaceRootMismatchError,
    );
    expect(index.getAll).not.toHaveBeenCalled();
  });

  it('R5: searchFiles refuses rather than serving the other root', async () => {
    const { service, index } = makeScoped();
    stealIndexForA(index);
    index.search.mockReturnValue([fileIn(ROOT_A, 'a-secret.ts')]);

    await expect(
      service.searchFiles({ query: 'a-secret', workspaceRoot: ROOT_B }),
    ).rejects.toThrow(WorkspaceRootMismatchError);
    expect(index.search).not.toHaveBeenCalled();
  });

  it('R5 error names both roots so a wrong-workspace report is diagnosable', async () => {
    const { service, index } = makeScoped();
    stealIndexForA(index);

    const error = await service
      .getAllFiles(false, 0, 100, ROOT_B)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(WorkspaceRootMismatchError);
    const mismatch = error as WorkspaceRootMismatchError;
    expect(mismatch.requestedRoot).toBe(ROOT_B);
    expect(mismatch.indexedRoot).toBe(KEY_A);
  });

  // -------------------------------------------------------------------------
  // Optional-param regression guard — omitting the root is today's behaviour
  // -------------------------------------------------------------------------

  it('omitted workspaceRoot keeps the pre-change path exactly: ensureReady(), no rebuild', async () => {
    const { service, index } = makeScoped();
    index.getAll.mockReturnValue([fileIn(ROOT_A, 'a.ts')]);

    const results = await service.getAllFiles();

    expect(index.ensureReady).toHaveBeenCalledTimes(1);
    expect(index.ensureReadyFor).not.toHaveBeenCalled();
    expect(results.map((r) => r.fileName)).toEqual(['a.ts']);
  });

  it('omitted workspaceRoot never throws, even when the index holds an unrelated root', async () => {
    const { service, index } = makeScoped();
    // If the R5 guard were applied unconditionally rather than only when the
    // caller named a root, every legacy call site would start throwing here.
    index.indexedRoot = 'some-completely-other-root';
    index.getAll.mockReturnValue([fileIn(ROOT_A, 'a.ts')]);

    await expect(service.getAllFiles()).resolves.toHaveLength(1);
    await expect(service.getFileSuggestions('a', 20)).resolves.toBeDefined();
    await expect(service.searchFiles({ query: 'a' })).resolves.toBeDefined();
    expect(index.ensureReadyFor).not.toHaveBeenCalled();
  });
});
