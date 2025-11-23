import 'reflect-metadata';
import { TreeSitterParserService } from './tree-sitter-parser.service';
import { Logger } from '@ptah-extension/vscode-core';

// Mock tree-sitter native modules
jest.mock('tree-sitter', () => {
  const mockParser = {
    setLanguage: jest.fn(),
    parse: jest.fn().mockReturnValue({
      rootNode: {
        type: 'program',
        text: '',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 0 },
        isNamed: true,
        fieldName: null,
        children: [],
      },
    }),
  };
  return jest.fn(() => mockParser);
});

jest.mock('tree-sitter-javascript', () => ({}));
jest.mock('tree-sitter-typescript', () => ({
  typescript: {},
}));

describe('TreeSitterParserService', () => {
  let service: TreeSitterParserService;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    // Create mock logger
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      lifecycle: jest.fn(),
      dispose: jest.fn(),
    } as any;

    // Create service with mock logger
    service = new TreeSitterParserService(mockLogger);
  });

  describe('parse TypeScript code', () => {
    it('should parse simple TypeScript function to AST', () => {
      const code = 'function hello() { return "world"; }';
      const result = service.parse(code, 'typescript');

      expect(result.isOk()).toBe(true);
      expect(result.value!.type).toBe('program');
      expect(Array.isArray(result.value!.children)).toBe(true);
    });
  });

  describe('parse JavaScript code', () => {
    it('should parse simple JavaScript function to AST', () => {
      const code = 'function add(a, b) { return a + b; }';
      const result = service.parse(code, 'javascript');

      expect(result.isOk()).toBe(true);
      expect(result.value!.type).toBe('program');
      expect(Array.isArray(result.value!.children)).toBe(true);
    });
  });

  describe('initialization', () => {
    it('should initialize grammars on first parse', () => {
      const code = 'const x = 42;';
      const result = service.parse(code, 'javascript');

      expect(result.isOk()).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Initializing Tree-sitter grammars via require...'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Tree-sitter grammars initialized successfully.'
      );
    });

    it('should reuse initialized grammars on subsequent parses', () => {
      // First parse initializes
      service.parse('const x = 1;', 'javascript');

      // Clear mock call history
      mockLogger.info.mockClear();

      // Second parse should not re-initialize
      const result = service.parse('const y = 2;', 'javascript');

      expect(result.isOk()).toBe(true);
      // Should not see initialization messages again
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        'Initializing Tree-sitter grammars via require...'
      );
    });
  });

  describe('AST structure', () => {
    it('should include node type information', () => {
      const code = 'const message = "hello";';
      const result = service.parse(code, 'typescript');

      expect(result.isOk()).toBe(true);
      expect(result.value!).toHaveProperty('type');
      expect(result.value!).toHaveProperty('text');
      expect(result.value!).toHaveProperty('startPosition');
      expect(result.value!).toHaveProperty('endPosition');
      expect(result.value!).toHaveProperty('isNamed');
      expect(result.value!).toHaveProperty('fieldName');
      expect(result.value!).toHaveProperty('children');
    });
  });
});
