/**
 * Specs for buildIDENamespace.
 *
 * Covers:
 *   - shape round-trip (lsp / editor / actions / testing)
 *   - capability-backed mode — delegation + input validation
 *   - graceful-degradation mode — no-capabilities path returns [] / null / false
 *   - testing namespace — always graceful
 */

import {
  buildIDENamespace,
  IDE_NOT_AVAILABLE_MSG,
  type IIDECapabilities,
} from './ide-namespace.builder';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type LspMock = jest.Mocked<IIDECapabilities['lsp']>;
type EditorMock = jest.Mocked<IIDECapabilities['editor']>;
type ActionsMock = jest.Mocked<IIDECapabilities['actions']>;

function createLspMock(): LspMock {
  return {
    getDefinition: jest.fn().mockResolvedValue([]),
    getReferences: jest.fn().mockResolvedValue([]),
    getHover: jest.fn().mockResolvedValue(null),
    getTypeDefinition: jest.fn().mockResolvedValue([]),
    getSignatureHelp: jest.fn().mockResolvedValue(null),
  };
}

function createEditorMock(): EditorMock {
  return {
    getActive: jest.fn().mockResolvedValue(null),
    getOpenFiles: jest.fn().mockResolvedValue([]),
    getDirtyFiles: jest.fn().mockResolvedValue([]),
    getRecentFiles: jest.fn().mockResolvedValue([]),
    getVisibleRange: jest.fn().mockResolvedValue(null),
  };
}

function createActionsMock(): ActionsMock {
  return {
    getAvailable: jest.fn().mockResolvedValue([]),
    apply: jest.fn().mockResolvedValue(false),
    rename: jest.fn().mockResolvedValue(false),
    organizeImports: jest.fn().mockResolvedValue(false),
    fixAll: jest.fn().mockResolvedValue(false),
  };
}

function createCapabilities(): {
  capabilities: IIDECapabilities;
  lsp: LspMock;
  editor: EditorMock;
  actions: ActionsMock;
} {
  const lsp = createLspMock();
  const editor = createEditorMock();
  const actions = createActionsMock();
  return {
    capabilities: { lsp, editor, actions },
    lsp,
    editor,
    actions,
  };
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe('buildIDENamespace — shape', () => {
  it('returns all four sub-namespaces in capability-backed mode', () => {
    const { capabilities } = createCapabilities();
    const ns = buildIDENamespace(capabilities);

    expect(ns.lsp).toBeDefined();
    expect(ns.editor).toBeDefined();
    expect(ns.actions).toBeDefined();
    expect(ns.testing).toBeDefined();

    // sanity-check each sub-namespace's contract surface is present
    expect(typeof ns.lsp.getDefinition).toBe('function');
    expect(typeof ns.editor.getActive).toBe('function');
    expect(typeof ns.actions.rename).toBe('function');
    expect(typeof ns.testing.discover).toBe('function');
  });

  it('returns all four sub-namespaces in graceful-degradation mode', () => {
    const ns = buildIDENamespace();

    expect(ns.lsp).toBeDefined();
    expect(ns.editor).toBeDefined();
    expect(ns.actions).toBeDefined();
    expect(ns.testing).toBeDefined();
  });

  it('exports the IDE_NOT_AVAILABLE_MSG constant mentioning standalone mode', () => {
    expect(IDE_NOT_AVAILABLE_MSG).toMatch(/standalone mode/i);
    expect(IDE_NOT_AVAILABLE_MSG).toMatch(/VS Code/);
  });
});

// ---------------------------------------------------------------------------
// Capability-backed — LSP delegation + input validation
// ---------------------------------------------------------------------------

describe('buildIDENamespace — LSP (capability-backed)', () => {
  it('delegates getDefinition/getReferences/getTypeDefinition/getHover/getSignatureHelp with args', async () => {
    const { capabilities, lsp } = createCapabilities();
    const def = [{ file: 'x.ts', line: 1, column: 2 }] as Awaited<
      ReturnType<LspMock['getDefinition']>
    >;
    lsp.getDefinition.mockResolvedValue(def);

    const ns = buildIDENamespace(capabilities);

    await expect(ns.lsp.getDefinition('x.ts', 1, 2)).resolves.toBe(def);
    expect(lsp.getDefinition).toHaveBeenCalledWith('x.ts', 1, 2);

    await ns.lsp.getReferences('y.ts', 5, 6);
    expect(lsp.getReferences).toHaveBeenCalledWith('y.ts', 5, 6);

    await ns.lsp.getTypeDefinition('z.ts', 0, 0);
    expect(lsp.getTypeDefinition).toHaveBeenCalledWith('z.ts', 0, 0);

    await ns.lsp.getHover('a.ts', 3, 4);
    expect(lsp.getHover).toHaveBeenCalledWith('a.ts', 3, 4);

    await ns.lsp.getSignatureHelp('b.ts', 7, 8);
    expect(lsp.getSignatureHelp).toHaveBeenCalledWith('b.ts', 7, 8);
  });

  it('rejects empty/whitespace file paths before delegating', async () => {
    const { capabilities, lsp } = createCapabilities();
    const ns = buildIDENamespace(capabilities);

    await expect(ns.lsp.getDefinition('', 0, 0)).rejects.toThrow(
      'File path cannot be empty',
    );
    await expect(ns.lsp.getHover('   ', 0, 0)).rejects.toThrow(
      'File path cannot be empty',
    );
    expect(lsp.getDefinition).not.toHaveBeenCalled();
    expect(lsp.getHover).not.toHaveBeenCalled();
  });

  it('rejects negative line/column before delegating', async () => {
    const { capabilities, lsp } = createCapabilities();
    const ns = buildIDENamespace(capabilities);

    await expect(ns.lsp.getDefinition('x.ts', -1, 0)).rejects.toThrow(
      'Line and column must be non-negative',
    );
    await expect(ns.lsp.getReferences('x.ts', 0, -2)).rejects.toThrow(
      'Line and column must be non-negative',
    );
    expect(lsp.getDefinition).not.toHaveBeenCalled();
    expect(lsp.getReferences).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Capability-backed — Editor delegation (no validation layer)
// ---------------------------------------------------------------------------

describe('buildIDENamespace — Editor (capability-backed)', () => {
  it('delegates every editor method and forwards the optional limit', async () => {
    const { capabilities, editor } = createCapabilities();
    editor.getActive.mockResolvedValue({
      file: 'a.ts',
      line: 0,
      column: 0,
    });
    editor.getOpenFiles.mockResolvedValue(['a.ts']);
    editor.getDirtyFiles.mockResolvedValue(['a.ts']);
    editor.getRecentFiles.mockResolvedValue(['a.ts', 'b.ts']);
    editor.getVisibleRange.mockResolvedValue({
      file: 'a.ts',
      startLine: 0,
      endLine: 10,
    });

    const ns = buildIDENamespace(capabilities);

    await expect(ns.editor.getActive()).resolves.toEqual({
      file: 'a.ts',
      line: 0,
      column: 0,
    });
    await expect(ns.editor.getOpenFiles()).resolves.toEqual(['a.ts']);
    await expect(ns.editor.getDirtyFiles()).resolves.toEqual(['a.ts']);
    await ns.editor.getRecentFiles(5);
    expect(editor.getRecentFiles).toHaveBeenCalledWith(5);
    await ns.editor.getRecentFiles();
    expect(editor.getRecentFiles).toHaveBeenLastCalledWith(undefined);
    await expect(ns.editor.getVisibleRange()).resolves.toEqual({
      file: 'a.ts',
      startLine: 0,
      endLine: 10,
    });
  });
});

// ---------------------------------------------------------------------------
// Capability-backed — Actions validation + delegation
// ---------------------------------------------------------------------------

describe('buildIDENamespace — Actions (capability-backed)', () => {
  it('getAvailable validates file + non-negative line, then delegates', async () => {
    const { capabilities, actions } = createCapabilities();
    actions.getAvailable.mockResolvedValue([
      { title: 'fix', kind: 'quickfix' },
    ]);

    const ns = buildIDENamespace(capabilities);

    await expect(ns.actions.getAvailable('', 0)).rejects.toThrow(
      'File path cannot be empty',
    );
    await expect(ns.actions.getAvailable('x.ts', -1)).rejects.toThrow(
      'Line must be non-negative',
    );

    const out = await ns.actions.getAvailable('x.ts', 3);
    expect(out).toEqual([{ title: 'fix', kind: 'quickfix' }]);
    expect(actions.getAvailable).toHaveBeenCalledWith('x.ts', 3);
  });

  it('apply rejects empty action title and delegates when valid', async () => {
    const { capabilities, actions } = createCapabilities();
    actions.apply.mockResolvedValue(true);
    const ns = buildIDENamespace(capabilities);

    await expect(ns.actions.apply('x.ts', 1, '   ')).rejects.toThrow(
      'Action title cannot be empty',
    );
    await expect(ns.actions.apply('x.ts', 1, 'Organize Imports')).resolves.toBe(
      true,
    );
    expect(actions.apply).toHaveBeenCalledWith('x.ts', 1, 'Organize Imports');
  });

  it('rename rejects empty name and non-negative position rule', async () => {
    const { capabilities, actions } = createCapabilities();
    actions.rename.mockResolvedValue(true);
    const ns = buildIDENamespace(capabilities);

    await expect(ns.actions.rename('x.ts', -1, 0, 'foo')).rejects.toThrow(
      'Line and column must be non-negative',
    );
    await expect(ns.actions.rename('x.ts', 0, 0, '')).rejects.toThrow(
      'New name cannot be empty',
    );
    await ns.actions.rename('x.ts', 1, 2, 'newName');
    expect(actions.rename).toHaveBeenCalledWith('x.ts', 1, 2, 'newName');
  });

  it('organizeImports and fixAll validate file path and forward optional kind', async () => {
    const { capabilities, actions } = createCapabilities();
    actions.organizeImports.mockResolvedValue(true);
    actions.fixAll.mockResolvedValue(true);
    const ns = buildIDENamespace(capabilities);

    await expect(ns.actions.organizeImports('')).rejects.toThrow(
      'File path cannot be empty',
    );
    await ns.actions.organizeImports('x.ts');
    expect(actions.organizeImports).toHaveBeenCalledWith('x.ts');

    await ns.actions.fixAll('x.ts', 'source.fixAll.eslint');
    expect(actions.fixAll).toHaveBeenCalledWith('x.ts', 'source.fixAll.eslint');
    await ns.actions.fixAll('x.ts');
    expect(actions.fixAll).toHaveBeenLastCalledWith('x.ts', undefined);
  });
});

// ---------------------------------------------------------------------------
// Graceful degradation mode
// ---------------------------------------------------------------------------

describe('buildIDENamespace — graceful degradation (no capabilities)', () => {
  it('LSP methods return [] / null without calling any platform API', async () => {
    const ns = buildIDENamespace();

    await expect(ns.lsp.getDefinition('x.ts', 0, 0)).resolves.toEqual([]);
    await expect(ns.lsp.getReferences('x.ts', 0, 0)).resolves.toEqual([]);
    await expect(ns.lsp.getTypeDefinition('x.ts', 0, 0)).resolves.toEqual([]);
    await expect(ns.lsp.getHover('x.ts', 0, 0)).resolves.toBeNull();
    await expect(ns.lsp.getSignatureHelp('x.ts', 0, 0)).resolves.toBeNull();
  });

  it('Editor methods return nulls / empty arrays', async () => {
    const ns = buildIDENamespace();

    await expect(ns.editor.getActive()).resolves.toBeNull();
    await expect(ns.editor.getOpenFiles()).resolves.toEqual([]);
    await expect(ns.editor.getDirtyFiles()).resolves.toEqual([]);
    await expect(ns.editor.getRecentFiles(3)).resolves.toEqual([]);
    await expect(ns.editor.getVisibleRange()).resolves.toBeNull();
  });

  it('Actions methods return [] / false uniformly', async () => {
    const ns = buildIDENamespace();

    await expect(ns.actions.getAvailable('x.ts', 0)).resolves.toEqual([]);
    await expect(ns.actions.apply('x.ts', 0, 'title')).resolves.toBe(false);
    await expect(ns.actions.rename('x.ts', 0, 0, 'foo')).resolves.toBe(false);
    await expect(ns.actions.organizeImports('x.ts')).resolves.toBe(false);
    await expect(ns.actions.fixAll('x.ts')).resolves.toBe(false);
  });

  it('does NOT run validation in graceful mode (empty inputs are allowed)', async () => {
    const ns = buildIDENamespace();
    await expect(ns.lsp.getDefinition('', -1, -1)).resolves.toEqual([]);
    await expect(ns.actions.apply('', -1, '')).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Testing namespace — always graceful
// ---------------------------------------------------------------------------

describe('buildIDENamespace — testing namespace', () => {
  it('discover() returns [] and getLastResults() returns null', async () => {
    const ns = buildIDENamespace(createCapabilities().capabilities);

    await expect(ns.testing.discover()).resolves.toEqual([]);
    await expect(ns.testing.getLastResults()).resolves.toBeNull();
  });

  it('run() returns a zero-valued TestResult shape regardless of options', async () => {
    const ns = buildIDENamespace();

    const result = await ns.testing.run();
    expect(result).toEqual({
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      duration: 0,
    });

    const filtered = await ns.testing.run({ include: ['suite'] });
    expect(filtered).toEqual(result);
  });

  it('getCoverage() rejects empty file path and returns null for a real path', async () => {
    const ns = buildIDENamespace();

    await expect(ns.testing.getCoverage('  ')).rejects.toThrow(
      'File path cannot be empty',
    );
    await expect(ns.testing.getCoverage('src/a.ts')).resolves.toBeNull();
  });
});
