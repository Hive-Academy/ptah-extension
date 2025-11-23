import 'reflect-metadata';
import { TreeSitterParserService } from './tree-sitter-parser.service';
import { Logger } from '@ptah-extension/vscode-core';

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
      expect(result.value!.children.length).toBeGreaterThan(0);
    });

    it('should parse TypeScript class to AST', () => {
      const code = `class User {
        constructor(name: string) {
          this.name = name;
        }
      }`;
      const result = service.parse(code, 'typescript');

      expect(result.isOk()).toBe(true);
      expect(result.value!.type).toBe('program');
    });

    it('should parse TypeScript with types to AST', () => {
      const code = `interface Person {
        name: string;
        age: number;
      }

      const getPerson = (id: number): Person => {
        return { name: 'Alice', age: 30 };
      };`;
      const result = service.parse(code, 'typescript');

      expect(result.isOk()).toBe(true);
      expect(result.value!.type).toBe('program');
    });
  });

  describe('parse JavaScript code', () => {
    it('should parse simple JavaScript function to AST', () => {
      const code = 'function add(a, b) { return a + b; }';
      const result = service.parse(code, 'javascript');

      expect(result.isOk()).toBe(true);
      expect(result.value!.type).toBe('program');
      expect(result.value!.children.length).toBeGreaterThan(0);
    });

    it('should parse ES6 arrow function to AST', () => {
      const code = 'const multiply = (x, y) => x * y;';
      const result = service.parse(code, 'javascript');

      expect(result.isOk()).toBe(true);
      expect(result.value!.type).toBe('program');
    });

    it('should parse JavaScript class to AST', () => {
      const code = `class Product {
        constructor(name, price) {
          this.name = name;
          this.price = price;
        }
      }`;
      const result = service.parse(code, 'javascript');

      expect(result.isOk()).toBe(true);
      expect(result.value!.type).toBe('program');
    });
  });

  describe('error handling', () => {
    it('should handle malformed code gracefully', () => {
      // tree-sitter is fault-tolerant, so this should still parse
      const invalidCode = 'function {{{ invalid';
      const result = service.parse(invalidCode, 'typescript');

      // tree-sitter parsers are very fault-tolerant and will still produce a tree
      expect(result.isOk()).toBe(true);
    });

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
      expect(result.value).toHaveProperty('type');
      expect(result.value).toHaveProperty('text');
      expect(result.value).toHaveProperty('startPosition');
      expect(result.value).toHaveProperty('endPosition');
      expect(result.value).toHaveProperty('isNamed');
      expect(result.value).toHaveProperty('fieldName');
      expect(result.value).toHaveProperty('children');
    });

    it('should include position information', () => {
      const code = 'function test() {}';
      const result = service.parse(code, 'typescript');

      expect(result.isOk()).toBe(true);
      expect(result.value!.startPosition).toHaveProperty('row');
      expect(result.value!.startPosition).toHaveProperty('column');
      expect(result.value!.endPosition).toHaveProperty('row');
      expect(result.value!.endPosition).toHaveProperty('column');
    });

    it('should recursively parse child nodes', () => {
      const code = `function outer() {
        function inner() {
          return 42;
        }
        return inner();
      }`;
      const result = service.parse(code, 'typescript');

      expect(result.isOk()).toBe(true);
      expect(result.value!.children.length).toBeGreaterThan(0);

      // Should have nested children (recursive structure)
      const findNestedChildren = (node: any): boolean => {
        if (node.children && node.children.length > 0) {
          return node.children.some((child: any) =>
            child.children && child.children.length > 0
              ? true
              : findNestedChildren(child)
          );
        }
        return false;
      };

      expect(findNestedChildren(result.value)).toBe(true);
    });
  });
});
