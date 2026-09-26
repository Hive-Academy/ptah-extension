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
});
