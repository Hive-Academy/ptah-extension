/**
 * Specs for system namespace builders.
 *
 * Covers buildFilesNamespace, buildHelpMethod, and the HELP_DOCS constant.
 *
 * Files namespace behaviours under test:
 *   - Workspace-relative path resolution via IWorkspaceProvider.getWorkspaceRoot()
 *   - Security: rejects absolute paths and path traversal
 *   - Error propagation when workspace/file is missing
 *   - readJson() handles both plain JSON and JSONC (comments / trailing commas)
 *   - list() validates directory type and maps FileType to 'file' | 'directory'
 *
 * Help method behaviours under test:
 *   - Default topic returns the overview
 *   - Unknown topic returns "not found" with an available-topics list
 *   - Legacy `ai.ide.*` prefix is rewritten to `ide.*`
 */

import * as path from 'path';
import type { FileSystemManager } from '@ptah-extension/vscode-core';
import type {
  IWorkspaceProvider,
  IFileSystemProvider,
  FileStat,
  DirectoryEntry,
} from '@ptah-extension/platform-core';
import { FileType } from '@ptah-extension/platform-core';

import {
  buildFilesNamespace,
  buildHelpMethod,
  HELP_DOCS,
  type SystemNamespaceDependencies,
} from './system-namespace.builders';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKSPACE_ROOT = path.resolve('/ws');

function createWorkspaceProviderMock(): jest.Mocked<
  Pick<IWorkspaceProvider, 'getWorkspaceRoot'>
> {
  return { getWorkspaceRoot: jest.fn(() => WORKSPACE_ROOT) };
}

function createEmptyWorkspaceProviderMock(): jest.Mocked<
  Pick<IWorkspaceProvider, 'getWorkspaceRoot'>
> {
  return { getWorkspaceRoot: jest.fn(() => undefined) };
}

function createFsMock(): jest.Mocked<IFileSystemProvider> {
  const mock: jest.Mocked<IFileSystemProvider> = {
    readFile: jest.fn(),
    readFileBytes: jest.fn(),
    writeFile: jest.fn(),
    writeFileBytes: jest.fn(),
    readDirectory: jest.fn(),
    stat: jest.fn(),
    exists: jest.fn(),
    delete: jest.fn(),
    createDirectory: jest.fn(),
    createDirectoryExclusive: jest.fn(),
    copy: jest.fn(),
    findFiles: jest.fn(),
    createFileWatcher: jest.fn(),
  };
  return mock;
}

function createDeps(
  fsProvider: jest.Mocked<IFileSystemProvider>,
  workspaceProvider: jest.Mocked<Pick<IWorkspaceProvider, 'getWorkspaceRoot'>>,
): SystemNamespaceDependencies {
  return {
    // FileSystemManager is accepted but the builder delegates to
    // fileSystemProvider for every operation, so a stub is sufficient.
    fileSystemManager: {} as FileSystemManager,
    workspaceProvider: workspaceProvider as unknown as IWorkspaceProvider,
    fileSystemProvider: fsProvider,
  };
}

// ---------------------------------------------------------------------------
// buildFilesNamespace — shape + path resolution
// ---------------------------------------------------------------------------

describe('buildFilesNamespace — shape & delegation', () => {
  it('exposes read / readJson / list methods', () => {
    const ns = buildFilesNamespace(
      createDeps(createFsMock(), createWorkspaceProviderMock()),
    );
    expect(typeof ns.read).toBe('function');
    expect(typeof ns.readJson).toBe('function');
    expect(typeof ns.list).toBe('function');
  });

  it('read() resolves workspace-relative path and returns file contents', async () => {
    const fs = createFsMock();
    fs.exists.mockResolvedValue(true);
    fs.readFile.mockResolvedValue('hello world');
    const wp = createWorkspaceProviderMock();

    const ns = buildFilesNamespace(createDeps(fs, wp));
    const contents = await ns.read('src/a.ts');

    const expected = path.join(WORKSPACE_ROOT, 'src/a.ts');
    expect(contents).toBe('hello world');
    expect(fs.exists).toHaveBeenCalledWith(expected);
    expect(fs.readFile).toHaveBeenCalledWith(expected);
  });

  it('read() throws "File not found" when the provider reports missing', async () => {
    const fs = createFsMock();
    fs.exists.mockResolvedValue(false);
    const ns = buildFilesNamespace(
      createDeps(fs, createWorkspaceProviderMock()),
    );

    await expect(ns.read('missing.ts')).rejects.toThrow(/File not found/);
    expect(fs.readFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// buildFilesNamespace — security validation
// ---------------------------------------------------------------------------

describe('buildFilesNamespace — workspace path security', () => {
  it('rejects absolute paths (drive letter or unix)', async () => {
    const fs = createFsMock();
    const ns = buildFilesNamespace(
      createDeps(fs, createWorkspaceProviderMock()),
    );

    await expect(ns.read('C:/etc/passwd')).rejects.toThrow(
      /Absolute paths are not allowed/,
    );
    await expect(ns.read('/etc/passwd')).rejects.toThrow(
      /Absolute paths are not allowed/,
    );
    expect(fs.exists).not.toHaveBeenCalled();
  });

  it('rejects path traversal with leading ".."', async () => {
    const fs = createFsMock();
    const ns = buildFilesNamespace(
      createDeps(fs, createWorkspaceProviderMock()),
    );

    await expect(ns.read('../secret.env')).rejects.toThrow(
      /Path traversal is not allowed/,
    );
    expect(fs.exists).not.toHaveBeenCalled();
  });

  it('throws when no workspace folder is open', async () => {
    const fs = createFsMock();
    const ns = buildFilesNamespace(
      createDeps(fs, createEmptyWorkspaceProviderMock()),
    );

    await expect(ns.read('src/a.ts')).rejects.toThrow(
      /No workspace folder is open/,
    );
  });

  it('normalises backslashes to forward slashes before resolving', async () => {
    const fs = createFsMock();
    fs.exists.mockResolvedValue(true);
    fs.readFile.mockResolvedValue('contents');
    const ns = buildFilesNamespace(
      createDeps(fs, createWorkspaceProviderMock()),
    );

    await ns.read('src\\nested\\file.ts');

    const expected = path.join(WORKSPACE_ROOT, 'src/nested/file.ts');
    expect(fs.readFile).toHaveBeenCalledWith(expected);
  });
});

// ---------------------------------------------------------------------------
// buildFilesNamespace — readJson()
// ---------------------------------------------------------------------------

describe('buildFilesNamespace — readJson', () => {
  it('parses valid strict JSON via the fast path', async () => {
    const fs = createFsMock();
    fs.exists.mockResolvedValue(true);
    fs.readFile.mockResolvedValue('{"name":"ptah","version":1}');
    const ns = buildFilesNamespace(
      createDeps(fs, createWorkspaceProviderMock()),
    );

    await expect(ns.readJson('package.json')).resolves.toEqual({
      name: 'ptah',
      version: 1,
    });
  });

  it('falls back to comment-stripping for JSONC (line comments + trailing commas)', async () => {
    const fs = createFsMock();
    fs.exists.mockResolvedValue(true);
    fs.readFile.mockResolvedValue(
      '{\n  // a comment\n  "strict": true,\n  "target": "es2022",\n}',
    );
    const ns = buildFilesNamespace(
      createDeps(fs, createWorkspaceProviderMock()),
    );

    await expect(ns.readJson('tsconfig.json')).resolves.toEqual({
      strict: true,
      target: 'es2022',
    });
  });

  it('preserves // sequences inside string literals (e.g. URLs)', async () => {
    const fs = createFsMock();
    fs.exists.mockResolvedValue(true);
    fs.readFile.mockResolvedValue(
      '{\n  // comment\n  "url": "https://example.com/path",\n}',
    );
    const ns = buildFilesNamespace(
      createDeps(fs, createWorkspaceProviderMock()),
    );

    const result = (await ns.readJson('config.jsonc')) as { url: string };
    expect(result.url).toBe('https://example.com/path');
  });

  it('surfaces "File not found" when the JSON file does not exist', async () => {
    const fs = createFsMock();
    fs.exists.mockResolvedValue(false);
    const ns = buildFilesNamespace(
      createDeps(fs, createWorkspaceProviderMock()),
    );

    await expect(ns.readJson('missing.json')).rejects.toThrow(/File not found/);
  });
});

// ---------------------------------------------------------------------------
// buildFilesNamespace — list()
// ---------------------------------------------------------------------------

describe('buildFilesNamespace — list', () => {
  const dirStat: FileStat = {
    type: FileType.Directory,
    ctime: 0,
    mtime: 0,
    size: 0,
  };

  it('returns mapped entries for a valid directory', async () => {
    const fs = createFsMock();
    fs.stat.mockResolvedValue(dirStat);
    const entries: DirectoryEntry[] = [
      { name: 'index.ts', type: FileType.File },
      { name: 'sub', type: FileType.Directory },
    ];
    fs.readDirectory.mockResolvedValue(entries);
    const wp = createWorkspaceProviderMock();

    const ns = buildFilesNamespace(createDeps(fs, wp));
    const listed = await ns.list('src');

    expect(listed).toEqual([
      { name: 'index.ts', type: 'file' },
      { name: 'sub', type: 'directory' },
    ]);
    expect(fs.readDirectory).toHaveBeenCalledWith(
      path.join(WORKSPACE_ROOT, 'src'),
    );
  });

  it('throws "Directory not found" when stat rejects with a missing-path error', async () => {
    const fs = createFsMock();
    fs.stat.mockRejectedValue(new Error('ENOENT'));
    const ns = buildFilesNamespace(
      createDeps(fs, createWorkspaceProviderMock()),
    );

    await expect(ns.list('missing-dir')).rejects.toThrow(/Directory not found/);
    await expect(ns.list('missing-dir')).rejects.not.toThrow(/Not a directory/);
    expect(fs.readDirectory).not.toHaveBeenCalled();
  });

  it('throws "Not a directory" when target exists but is a file', async () => {
    const fs = createFsMock();
    fs.stat.mockResolvedValue({ ...dirStat, type: FileType.File });
    const ns = buildFilesNamespace(
      createDeps(fs, createWorkspaceProviderMock()),
    );

    await expect(ns.list('a-file')).rejects.toThrow(/^Not a directory:/);
    expect(fs.readDirectory).not.toHaveBeenCalled();
  });

  it('throws "Not a directory" when stat rejects with ENOTDIR (intermediate path is a file)', async () => {
    const fs = createFsMock();
    const err: NodeJS.ErrnoException = Object.assign(
      new Error('ENOTDIR: not a directory'),
      { code: 'ENOTDIR' },
    );
    fs.stat.mockRejectedValue(err);
    const ns = buildFilesNamespace(
      createDeps(fs, createWorkspaceProviderMock()),
    );

    await expect(ns.list('a-file/inside')).rejects.toThrow(/^Not a directory:/);
    expect(fs.readDirectory).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// buildHelpMethod / HELP_DOCS
// ---------------------------------------------------------------------------

describe('buildHelpMethod', () => {
  it('returns the "overview" doc when called with no topic', async () => {
    const help = buildHelpMethod();
    const out = await help();
    expect(out).toBe(HELP_DOCS['overview']);
    expect(out).toMatch(/Ptah IDE Access/);
  });

  it('returns the matching doc for a known topic', async () => {
    const help = buildHelpMethod();

    expect(await help('workspace')).toBe(HELP_DOCS['workspace']);
    expect(await help('ide')).toBe(HELP_DOCS['ide']);
    expect(await help('ide.lsp')).toBe(HELP_DOCS['ide.lsp']);
  });

  it('never claims the ide namespace is exclusive to VS Code (Batch 27 honesty: 24c review finding 3)', async () => {
    const help = buildHelpMethod();

    // ptah.ide.lsp has a real Electron fallback (Batch 26a/26b); the parent
    // topic must not tell a desktop agent the whole namespace is unavailable.
    await expect(help('ide')).resolves.not.toMatch(/exclusive to VS Code/i);
    await expect(help('overview')).resolves.not.toMatch(
      /ide\.\*.*VS Code exclusive/i,
    );
  });

  // r1 review R27-05: the previous wording claimed the CLI also gets a
  // name-based/graph-scoped scan fallback. Only the Electron (desktop) host
  // registers IIDECapabilities (apps/ptah-electron/src/di/phase-3-storage.ts);
  // the CLI registers none, so buildIDENamespace(undefined) — see
  // `ide-namespace.builder.ts:212-233` — sends every ptah.ide.lsp call through
  // the graceful `mechanism: 'none'` stub there, same as VS Code editor/actions/
  // testing off-host. The help text must name the CLI's actual behaviour, not
  // a fallback that only Electron has.
  it('names the desktop app (not the CLI) as the LSP fallback host, and the CLI as having no IDE host at all (R27-05)', async () => {
    const help = buildHelpMethod();
    const ideDoc = await help('ide');

    expect(ideDoc).toMatch(/desktop.*fallback|fallback.*desktop/is);
    expect(ideDoc).toMatch(/CLI registers no IDE host|CLI has no IDE host/i);
    expect(ideDoc).not.toMatch(/CLI.*fall back to name-based/i);
  });

  it('rewrites legacy "ai.ide.*" topics to "ide.*"', async () => {
    const help = buildHelpMethod();

    await expect(help('ai.ide.editor')).resolves.toBe(HELP_DOCS['ide.editor']);
    await expect(help('ai.ide.lsp')).resolves.toBe(HELP_DOCS['ide.lsp']);
  });

  it('returns a "not found" message listing available topics for unknown input', async () => {
    const help = buildHelpMethod();

    const out = await help('nonexistent');

    expect(out).toMatch(/^Topic 'nonexistent' not found\./);
    // Available list must exclude the meta "overview" entry
    expect(out).not.toMatch(/\boverview\b/);
    // Sanity: at least one real topic is listed
    expect(out).toMatch(/workspace/);
  });
});

// TASK_2026_559 Batch 24c (26a finding R26A-m1): execute_code help lists the
// LSP report methods, and the ast topic states the parse-status contract its
// parsing operations now return.
describe('HELP_DOCS — Batch 24c', () => {
  it('ide.lsp lists getDefinitionReport and getReferencesReport with the report shape', () => {
    const doc = HELP_DOCS['ide.lsp'];
    expect(doc).toContain('getDefinitionReport(file, line, col)');
    expect(doc).toContain('getReferencesReport(file, line, col)');
    expect(doc).toContain(
      '{ locations, mechanism, language, languageSupported,',
    );
    for (const mechanism of [
      "'provider-defined'",
      "'symbol-index'",
      "'declaration-scan'",
      "'graph-scoped-scan'",
      "'text-scan'",
      "'none'",
    ]) {
      expect(doc).toContain(mechanism);
    }
  });

  it('ast states that parse and the structural queries lead with parse status', () => {
    const doc = HELP_DOCS['ast'];
    expect(doc).toContain(
      'queryFunctions(file) - { ...parse status, file, language, functions }',
    );
    expect(doc).toContain("parseStatus 'ok' | 'recovered' | 'unknown'");
    expect(doc).not.toContain('currently: javascript, typescript');
  });
});
