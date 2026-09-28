/**
 * TreeSitterParserService Tests
 *
 * web-tree-sitter is mocked so that we can exercise the service without loading
 * actual WASM grammars. The WASM bundle-dir resolver is also mocked to avoid
 * touching `import.meta.url` in Jest's CJS runtime.
 *
 * Tests focus on:
 * - Lazy initialization via initialize()
 * - Async parse() returning Promise<Result<GenericAstNode, Error>>
 * - Runtime reuse semantics
 * - Error propagation when init fails
 */

import 'reflect-metadata';
import { Logger } from '@ptah-extension/vscode-core';

// Mock the WASM bundle-dir resolver so that `import.meta.url` is never
// parsed in Jest's CJS runtime (the real module uses `import.meta.url` which
// only works in the bundled ESM output).
jest.mock('./wasm-bundle-dir', () => ({
  BUNDLE_DIR: '/mock/bundle/dir',
  resolveWasmPath: (filename: string) => `/mock/bundle/dir/wasm/${filename}`,
}));

// Shared mock state -- referenced inside jest.mock() factory below.
const mockRootNode = {
  type: 'program',
  text: '',
  startPosition: { row: 0, column: 0 },
  endPosition: { row: 0, column: 0 },
  isNamed: true,
  children: [],
};

const mockTreeInstance = {
  rootNode: mockRootNode,
  delete: jest.fn(),
  edit: jest.fn(),
};

const mockParserInstance = {
  setLanguage: jest.fn(),
  parse: jest.fn().mockReturnValue(mockTreeInstance),
  delete: jest.fn(),
};

const mockLanguageInstance = { name: 'mock-language' };

jest.mock('web-tree-sitter', () => {
  const ParserMock = jest.fn(() => mockParserInstance) as unknown as {
    new (): typeof mockParserInstance;
    init: jest.Mock;
  };
  ParserMock.init = jest.fn().mockResolvedValue(undefined);

  const LanguageMock = {
    load: jest.fn().mockResolvedValue(mockLanguageInstance),
  };

  const QueryMock = jest.fn(() => ({
    matches: jest.fn().mockReturnValue([]),
    delete: jest.fn(),
  }));

  const EditMock = jest.fn((init) => init);

  return {
    Parser: ParserMock,
    Language: LanguageMock,
    Query: QueryMock,
    Edit: EditMock,
  };
});

const webTreeSitter = require('web-tree-sitter');

import { TreeSitterParserService } from './tree-sitter-parser.service';
import {
  MAX_PARSE_BYTES,
  ParserRefusalError,
  parserFailureReason,
} from './parser-refusal';

describe('TreeSitterParserService', () => {
  let service: TreeSitterParserService;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockParserInstance.parse.mockReturnValue(mockTreeInstance);
    webTreeSitter.Parser.init.mockResolvedValue(undefined);
    webTreeSitter.Language.load.mockResolvedValue(mockLanguageInstance);

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      lifecycle: jest.fn(),
      dispose: jest.fn(),
    } as unknown as jest.Mocked<Logger>;

    service = new TreeSitterParserService(mockLogger);
  });

  afterEach(() => {
    service.dispose();
  });

  describe('parse()', () => {
    it.each(['ERROR', 'MISSING'])(
      '24a reports %s recovery once per queryMulti parse',
      async (kind) => {
        const root = {
          ...mockRootNode,
          children: [
            {
              ...mockRootNode,
              type: kind === 'ERROR' ? 'ERROR' : ';',
              isMissing: kind === 'MISSING',
            },
          ],
        };
        mockParserInstance.parse.mockReturnValue({
          ...mockTreeInstance,
          rootNode: root,
        });
        const result = await service.queryMulti('broken', 'typescript', [
          { key: 'functions', queryString: '(program) @root' },
        ]);
        expect(result.value).toMatchObject({
          parseStatus: 'recovered',
          errorNodeCount: 1,
          errorNodeCountCapped: false,
        });
        expect(mockParserInstance.parse).toHaveBeenCalledTimes(1);
        expect(mockTreeInstance.delete).toHaveBeenCalledTimes(1);
      },
    );

    it('24a bounds recovery counts', async () => {
      mockParserInstance.parse.mockReturnValue({
        ...mockTreeInstance,
        rootNode: {
          ...mockRootNode,
          children: Array.from({ length: 50 }, () => ({
            ...mockRootNode,
            type: 'ERROR',
          })),
        },
      });
      const result = await service.queryMulti('broken', 'typescript', [
        { key: 'functions', queryString: '(program) @root' },
      ]);
      expect(result.value).toMatchObject({
        parseStatus: 'recovered',
        errorNodeCount: 20,
        errorNodeCountCapped: true,
      });
    });

    it('24a reports clean and empty parses explicitly', async () => {
      for (const content of ['const x = 1;', '']) {
        const result = await service.queryMulti(content, 'typescript', [
          { key: 'functions', queryString: '(program) @root' },
        ]);
        expect(result.value).toMatchObject({
          parseStatus: 'ok',
          errorNodeCount: 0,
          errorNodeCountCapped: false,
        });
      }
    });

    it('24a detects real TSX recovery with the shipped TypeScript grammar', async () => {
      const actual =
        jest.requireActual<typeof import('web-tree-sitter')>('web-tree-sitter');
      const { readFileSync } = await import('fs');
      const { dirname, join } = await import('path');
      await actual.Parser.init();
      const grammar = await actual.Language.load(
        new Uint8Array(
          readFileSync(
            join(
              dirname(require.resolve('@vscode/tree-sitter-wasm/package.json')),
              'wasm/tree-sitter-typescript.wasm',
            ),
          ),
        ),
      );
      const realParser = new actual.Parser();
      realParser.setLanguage(grammar);
      mockParserInstance.parse.mockImplementation((content: string) =>
        realParser.parse(content),
      );
      try {
        const result = await service.queryMulti(
          'export const App = () => <div>Hello</div>;',
          'typescript',
          [],
        );
        expect(result.value).toMatchObject({ parseStatus: 'recovered' });
      } finally {
        realParser.delete();
      }
    });

    it('parses TypeScript code and returns Result.ok with the root AST node', async () => {
      const result = await service.parse(
        'function hello() { return "world"; }',
        'typescript',
      );

      expect(result.isOk()).toBe(true);
      expect(result.value?.type).toBe('program');
      expect(Array.isArray(result.value?.children)).toBe(true);
    });

    it('parses JavaScript code and returns Result.ok', async () => {
      const result = await service.parse(
        'function add(a, b) { return a + b; }',
        'javascript',
      );

      expect(result.isOk()).toBe(true);
      expect(result.value?.type).toBe('program');
    });
  });

  describe('initialization', () => {
    it('initializes the WASM runtime and grammars on first parse', async () => {
      const result = await service.parse('const x = 42;', 'javascript');

      expect(result.isOk()).toBe(true);
      expect(webTreeSitter.Parser.init).toHaveBeenCalledTimes(1);
      expect(webTreeSitter.Language.load).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Initializing web-tree-sitter'),
      );
    });

    it('reuses the initialized runtime on subsequent parses', async () => {
      await service.parse('const x = 1;', 'javascript');
      webTreeSitter.Parser.init.mockClear();
      webTreeSitter.Language.load.mockClear();

      const result = await service.parse('const y = 2;', 'javascript');

      expect(result.isOk()).toBe(true);
      expect(webTreeSitter.Parser.init).not.toHaveBeenCalled();
      expect(webTreeSitter.Language.load).not.toHaveBeenCalled();
    });

    it('returns Result.err when WASM initialization fails', async () => {
      webTreeSitter.Parser.init.mockRejectedValueOnce(new Error('WASM boom'));

      const result = await service.parse('const x = 1;', 'javascript');

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('WASM boom');
    });
  });

  describe('AST structure', () => {
    it('returns a node with the expected GenericAstNode fields', async () => {
      const result = await service.parse('const message = "hi";', 'typescript');

      expect(result.isOk()).toBe(true);
      const astNode = result.value;
      expect(astNode).toBeDefined();
      expect(astNode).toHaveProperty('type');
      expect(astNode).toHaveProperty('text');
      expect(astNode).toHaveProperty('startPosition');
      expect(astNode).toHaveProperty('endPosition');
      expect(astNode).toHaveProperty('isNamed');
      expect(astNode).toHaveProperty('fieldName');
      expect(astNode).toHaveProperty('children');
    });
  });

  describe('parse failure handling', () => {
    it('returns Result.err when the parser produces no root node', async () => {
      mockParserInstance.parse.mockReturnValueOnce(null);

      const result = await service.parse('const x = 1;', 'typescript');

      expect(result.isErr()).toBe(true);
    });
  });

  describe('29a2 lazy isolated grammar loading', () => {
    const loadedFiles = (): string[] =>
      webTreeSitter.Language.load.mock.calls.map(([grammarPath]: [string]) =>
        grammarPath.slice(grammarPath.lastIndexOf('/') + 1),
      );

    it('initialize() loads the runtime only; no grammar is read', async () => {
      const result = await service.initialize();

      expect(result.isOk()).toBe(true);
      expect(webTreeSitter.Parser.init).toHaveBeenCalledTimes(1);
      expect(webTreeSitter.Language.load).not.toHaveBeenCalled();
    });

    it('loads only the grammar of the language that is used', async () => {
      await service.queryMulti('const x = 1;', 'typescript', []);
      await service.queryMulti('const y = 2;', 'typescript', []);

      expect(loadedFiles()).toEqual(['tree-sitter-typescript.wasm']);
    });

    it('concurrent first uses of a language share one load and one parser', async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          service.queryMulti('x = 1', 'python', []),
        ),
      );

      expect(results.every((result) => result.isOk())).toBe(true);
      expect(webTreeSitter.Parser.init).toHaveBeenCalledTimes(1);
      expect(loadedFiles()).toEqual(['tree-sitter-python.wasm']);
      expect(webTreeSitter.Parser).toHaveBeenCalledTimes(1);
      expect(mockParserInstance.setLanguage).toHaveBeenCalledTimes(1);
    });

    it('FB: a failing grammar does not disable the others', async () => {
      webTreeSitter.Language.load.mockImplementation((grammarPath: string) =>
        grammarPath.endsWith('tree-sitter-c-sharp.wasm')
          ? Promise.reject(new Error('corrupt grammar'))
          : Promise.resolve(mockLanguageInstance),
      );

      const csharp = await service.queryMulti('class A {}', 'csharp', []);
      const typescript = await service.queryMulti(
        'const x = 1;',
        'typescript',
        [],
      );
      const python = await service.parse('x = 1', 'python');

      expect(csharp.isErr()).toBe(true);
      expect(csharp.error).toBeInstanceOf(ParserRefusalError);
      expect(parserFailureReason(csharp.error)).toBe('grammar-unavailable');
      expect(csharp.error?.message).toContain('csharp');
      expect(typescript.isOk()).toBe(true);
      expect(typescript.value).toMatchObject({ parseStatus: 'ok' });
      expect(python.isOk()).toBe(true);
    });

    it('a failed grammar stays failed for its language without re-reading it', async () => {
      webTreeSitter.Language.load.mockRejectedValue(
        new Error('corrupt grammar'),
      );

      const first = await service.queryMulti('package main', 'go', []);
      const second = await service.query(
        'package main',
        'go',
        '(source_file) @s',
      );

      expect(parserFailureReason(first.error)).toBe('grammar-unavailable');
      expect(parserFailureReason(second.error)).toBe('grammar-unavailable');
      expect(webTreeSitter.Language.load).toHaveBeenCalledTimes(1);
    });

    it('a runtime failure is not latched: the next call retries it', async () => {
      webTreeSitter.Parser.init.mockRejectedValueOnce(new Error('WASM boom'));

      const failed = await service.queryMulti('const x = 1;', 'typescript', []);
      const retried = await service.queryMulti(
        'const x = 1;',
        'typescript',
        [],
      );

      expect(parserFailureReason(failed.error)).toBe('grammar-unavailable');
      expect(webTreeSitter.Language.load).toHaveBeenCalledTimes(1);
      expect(retried.isOk()).toBe(true);
      expect(webTreeSitter.Parser.init).toHaveBeenCalledTimes(2);
    });

    it('refuses a source over 1 MiB as too-large before loading anything', async () => {
      const oversize = 'a'.repeat(MAX_PARSE_BYTES + 1);

      const results = [
        await service.parse(oversize, 'typescript'),
        await service.query(oversize, 'typescript', '(program) @p'),
        await service.queryMulti(oversize, 'typescript', []),
        await service.parseAndCache('/f.ts', oversize, 'typescript'),
      ];

      for (const result of results) {
        expect(result.isErr()).toBe(true);
        expect(parserFailureReason(result.error)).toBe('too-large');
      }
      expect(webTreeSitter.Parser.init).not.toHaveBeenCalled();
      expect(webTreeSitter.Language.load).not.toHaveBeenCalled();
      expect(mockParserInstance.parse).not.toHaveBeenCalled();
    });

    it('measures the limit in UTF-8 bytes, and exactly 1 MiB is accepted', async () => {
      // 2 bytes per character: under the limit in characters, over it in bytes.
      const multibyte = 'é'.repeat(MAX_PARSE_BYTES / 2 + 1);
      expect(multibyte.length).toBeLessThan(MAX_PARSE_BYTES);

      const refused = await service.queryMulti(multibyte, 'python', []);
      const atLimit = await service.queryMulti(
        'a'.repeat(MAX_PARSE_BYTES),
        'python',
        [],
      );

      expect(parserFailureReason(refused.error)).toBe('too-large');
      expect(atLimit.isOk()).toBe(true);
    });

    it('a too-large incremental re-parse drops the stale cached tree', async () => {
      const delta = {
        startIndex: 0,
        oldEndIndex: 0,
        newEndIndex: 1,
        startPosition: { row: 0, column: 0 },
        oldEndPosition: { row: 0, column: 0 },
        newEndPosition: { row: 0, column: 1 },
      };
      await service.parseAndCache('/f.ts', 'const x = 1;', 'typescript');
      mockTreeInstance.delete.mockClear();

      const refused = await service.parseIncremental(
        '/f.ts',
        'a'.repeat(MAX_PARSE_BYTES + 1),
        'typescript',
        delta,
      );

      expect(parserFailureReason(refused.error)).toBe('too-large');
      expect(mockTreeInstance.delete).toHaveBeenCalledTimes(1);
      expect(mockTreeInstance.edit).not.toHaveBeenCalled();
    });

    it('a grammar load that finishes after dispose() frees its parser', async () => {
      let finishLoad: (language: unknown) => void = () => undefined;
      webTreeSitter.Language.load.mockReturnValueOnce(
        new Promise((resolve) => {
          finishLoad = resolve;
        }),
      );

      const pending = service.parse('const x = 1;', 'typescript');
      await new Promise((resolve) => setImmediate(resolve));
      service.dispose();
      mockParserInstance.delete.mockClear();
      finishLoad(mockLanguageInstance);
      const result = await pending;

      expect(result.isErr()).toBe(true);
      expect(mockParserInstance.delete).toHaveBeenCalledTimes(1);
    });

    it('R29a2-01: a parse waiting on the runtime when dispose() runs never loads or keeps a parser', async () => {
      let finishInit: () => void = () => undefined;
      webTreeSitter.Parser.init.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishInit = resolve;
        }),
      );

      const pending = service.parse('const x = 1;', 'typescript');
      await new Promise((resolve) => setImmediate(resolve));
      service.dispose();
      finishInit();
      const result = await pending;

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('disposed');
      expect(webTreeSitter.Language.load).not.toHaveBeenCalled();
      expect(webTreeSitter.Parser).not.toHaveBeenCalled();
      expect(mockParserInstance.parse).not.toHaveBeenCalled();
    });

    it('R29a2-01: a pre-dispose runtime failure does not clear the newer initialization latch', async () => {
      let failA: (error: Error) => void = () => undefined;
      let finishB: () => void = () => undefined;
      webTreeSitter.Parser.init
        .mockReturnValueOnce(
          new Promise<void>((_, reject) => {
            failA = reject;
          }),
        )
        .mockReturnValueOnce(
          new Promise<void>((resolve) => {
            finishB = resolve;
          }),
        );

      const initA = service.initialize();
      service.dispose();
      const initB = service.initialize();
      failA(new Error('stale runtime failure'));
      expect((await initA).isErr()).toBe(true);
      const follower = service.initialize();
      finishB();

      expect((await initB).isOk()).toBe(true);
      expect((await follower).isOk()).toBe(true);
      expect(webTreeSitter.Parser.init).toHaveBeenCalledTimes(2);
    });

    it('R29a2-01: the service reinitializes and parses normally after dispose()', async () => {
      expect((await service.parse('const x = 1;', 'typescript')).isOk()).toBe(
        true,
      );
      service.dispose();

      const again = await service.parse('const y = 2;', 'typescript');

      expect(again.isOk()).toBe(true);
      expect(webTreeSitter.Parser.init).toHaveBeenCalledTimes(2);
      expect(webTreeSitter.Language.load).toHaveBeenCalledTimes(2);
    });

    it('parserFailureReason reads a refusal through re-wrapping causes', () => {
      const refusal = new ParserRefusalError('too-large', 'big');
      const wrapped = new Error('AST analysis failed', {
        cause: new Error('outer', { cause: refusal }),
      });

      expect(parserFailureReason(wrapped)).toBe('too-large');
      expect(parserFailureReason(new Error('syntax'))).toBe('parse');
      expect(parserFailureReason(undefined)).toBe('parse');
    });
  });
});
