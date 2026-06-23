import 'reflect-metadata';

import { ElectronIDECapabilities } from './electron-ide-capabilities';

type Reader = {
  searchSymbols: jest.Mock;
};
type Indexer = {
  indexWorkspaceStream: jest.Mock;
};
type Fs = {
  readFile: jest.Mock;
};

function makeLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

function makeWorkspace(root: string | undefined = 'C:/repo') {
  return { getWorkspaceRoot: jest.fn(() => root) };
}

function makeEditor(active: string | undefined = undefined) {
  return {
    getActiveEditorPath: jest.fn(() => active),
    onDidChangeActiveEditor: jest.fn(),
    onDidOpenDocument: jest.fn(),
  };
}

async function* streamOf(paths: string[]) {
  for (const p of paths) yield { path: p };
}

function build(overrides: {
  reader?: Reader;
  indexer?: Indexer;
  fs?: Fs;
  workspace?: { getWorkspaceRoot: () => string | undefined };
  editor?: { getActiveEditorPath: () => string | undefined };
}) {
  const reader = overrides.reader;
  const indexer = overrides.indexer ?? {
    indexWorkspaceStream: jest.fn(() => streamOf([])),
  };
  const fs = overrides.fs ?? { readFile: jest.fn() };
  const workspace = overrides.workspace ?? makeWorkspace();
  const editor = overrides.editor ?? makeEditor();
  const logger = makeLogger();

  const cap = new ElectronIDECapabilities(
    reader as never,
    indexer as never,
    fs as never,
    workspace as never,
    editor as never,
    logger as never,
  );
  return { cap, reader, indexer, fs, workspace, editor, logger };
}

describe('ElectronIDECapabilities', () => {
  describe('lsp.getDefinition', () => {
    it('resolves the identifier under the cursor to its declaration via the symbol index', async () => {
      const reader: Reader = {
        searchSymbols: jest.fn(async () => ({
          bm25Only: false,
          hits: [
            {
              id: '1',
              workspaceRoot: 'C:/repo',
              filePath: 'C:/repo/src/foo.ts',
              kind: 'function',
              symbolName: 'doThing',
              subject: 'code:function:C:/repo/src/foo.ts:doThing',
              text: 'function doThing in src/foo.ts:41-50',
              tokenCount: 10,
              score: 0.9,
            },
            {
              id: '2',
              workspaceRoot: 'C:/repo',
              filePath: 'C:/repo/src/other.ts',
              kind: 'function',
              symbolName: 'doOther',
              subject: 'code:function:C:/repo/src/other.ts:doOther',
              text: 'function doOther in src/other.ts:5-9',
              tokenCount: 10,
              score: 0.5,
            },
          ],
        })),
      };
      const fs: Fs = {
        readFile: jest.fn(async () => 'const x = doThing();\n'),
      };
      const { cap } = build({ reader, fs });

      // cursor on "doThing" (col 12 is inside the identifier)
      const result = await cap.lsp.getDefinition('C:/repo/src/a.ts', 0, 12);

      expect(reader.searchSymbols).toHaveBeenCalledWith(
        'doThing',
        expect.any(Number),
        'C:/repo',
      );
      expect(result).toEqual([
        { file: 'C:/repo/src/foo.ts', line: 41, column: 0 },
      ]);
    });

    it('returns [] when no symbol reader is available', async () => {
      const fs: Fs = { readFile: jest.fn(async () => 'doThing()') };
      const { cap } = build({ reader: undefined, fs });
      expect(await cap.lsp.getDefinition('C:/repo/a.ts', 0, 0)).toEqual([]);
    });

    it('returns [] when the cursor is not on an identifier', async () => {
      const reader: Reader = { searchSymbols: jest.fn() };
      const fs: Fs = { readFile: jest.fn(async () => '   = 1;') };
      const { cap } = build({ reader, fs });
      expect(await cap.lsp.getDefinition('C:/repo/a.ts', 0, 0)).toEqual([]);
      expect(reader.searchSymbols).not.toHaveBeenCalled();
    });
  });

  describe('lsp.getReferences', () => {
    it('returns word-boundary matches across scanned files', async () => {
      const fs: Fs = {
        readFile: jest.fn(async (p: string) => {
          if (p === 'C:/repo/src/a.ts') return 'const doThing = 1;';
          if (p === 'C:/repo/src/b.ts')
            return 'doThing();\nconst doThingX = 2;\n  doThing(3);';
          return '';
        }),
      };
      const indexer: Indexer = {
        indexWorkspaceStream: jest.fn(() =>
          streamOf(['C:/repo/src/a.ts', 'C:/repo/src/b.ts']),
        ),
      };
      const { cap } = build({ indexer, fs });

      const result = await cap.lsp.getReferences('C:/repo/src/a.ts', 0, 6);

      // doThing in a.ts (col 6), b.ts line0 col0, b.ts line2 col2.
      // doThingX must NOT match (word boundary).
      expect(result).toEqual([
        { file: 'C:/repo/src/a.ts', line: 0, column: 6 },
        { file: 'C:/repo/src/b.ts', line: 0, column: 0 },
        { file: 'C:/repo/src/b.ts', line: 2, column: 2 },
      ]);
    });

    it('returns [] when there is no workspace root', async () => {
      const fs: Fs = { readFile: jest.fn(async () => 'doThing') };
      const { cap, indexer } = build({
        fs,
        workspace: {
          getWorkspaceRoot: jest.fn((): string | undefined => undefined),
        },
      });
      expect(await cap.lsp.getReferences('C:/repo/a.ts', 0, 0)).toEqual([]);
      expect(indexer.indexWorkspaceStream).not.toHaveBeenCalled();
    });
  });

  describe('lsp.getSignatureHelp', () => {
    it('is unsupported and returns null', async () => {
      const { cap } = build({});
      expect(await cap.lsp.getSignatureHelp('a.ts', 0, 0)).toBeNull();
    });
  });

  describe('editor', () => {
    it('getActive reflects the active editor path', async () => {
      const { cap } = build({ editor: makeEditor('C:\\repo\\src\\x.ts') });
      expect(await cap.editor.getActive()).toEqual({
        file: 'C:/repo/src/x.ts',
        line: 0,
        column: 0,
      });
    });

    it('getActive returns null when no editor is active', async () => {
      const { cap } = build({ editor: makeEditor(undefined) });
      expect(await cap.editor.getActive()).toBeNull();
    });

    it('getDirtyFiles returns [] (not tracked in main process)', async () => {
      const { cap } = build({ editor: makeEditor('C:/repo/x.ts') });
      expect(await cap.editor.getDirtyFiles()).toEqual([]);
    });
  });

  describe('actions', () => {
    it('are graceful no-ops', async () => {
      const { cap } = build({});
      expect(await cap.actions.getAvailable('a.ts', 0)).toEqual([]);
      expect(await cap.actions.rename('a.ts', 0, 0, 'y')).toBe(false);
      expect(await cap.actions.organizeImports('a.ts')).toBe(false);
      expect(await cap.actions.fixAll('a.ts')).toBe(false);
    });
  });
});
