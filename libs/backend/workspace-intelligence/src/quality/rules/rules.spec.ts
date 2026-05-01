/**
 * Unit Tests for Anti-Pattern Detection Rules
 *
 * Tests all rule categories with positive and negative cases:
 * - TypeScript rules
 * - Error handling rules
 * - Architecture rules
 * - Testing rules
 * - RuleRegistry methods
 *
 * TASK_2025_141: Unified Project Intelligence with Code Quality Assessment
 */

import {
  // TypeScript rules
  explicitAnyRule,
  tsIgnoreRule,
  nonNullAssertionRule,
  typescriptRules,
  // Error handling rules
  emptyCatchRule,
  consoleOnlyCatchRule,
  errorHandlingRules,
  // Architecture rules
  fileTooLargeRule,
  tooManyImportsRule,
  functionTooLargeRule,
  architectureRules,
  // Testing rules
  noAssertionsRule,
  allSkippedRule,
  testingRules,
  // Registry
  RuleRegistry,
  ALL_RULES,
} from './index';
import {
  configureArchitectureRules,
  resetArchitectureRulesForTests,
} from './architecture-rules';
import type {
  TreeSitterParserService,
  QueryMatch,
} from '../../ast/tree-sitter-parser.service';
import { Result } from '@ptah-extension/shared';

// ============================================
// TypeScript Rules Tests
// ============================================

describe('TypeScript Rules', () => {
  describe('explicitAnyRule', () => {
    it('should detect explicit any type annotation', async () => {
      const content = `
function processData(data: any) {
  return data;
}
`;
      const matches = await explicitAnyRule.detect(content, 'test.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('typescript-explicit-any');
      expect(matches[0].location.line).toBe(2);
    });

    it('should detect multiple any usages', async () => {
      const content = `
const a: any = 1;
const b: any = 'test';
let c: any;
`;
      const matches = await explicitAnyRule.detect(content, 'test.ts');

      expect(matches.length).toBe(3);
    });

    it('should NOT detect any in union types', async () => {
      const content = `
const value: any | null = null;
const data: string | any | number = 'test';
`;
      const matches = await explicitAnyRule.detect(content, 'test.ts');

      expect(matches.length).toBe(0);
    });

    it('should NOT detect "any" in variable names or strings', async () => {
      const content = `
const anyValue = 'test';
const company = 'Any Corp';
function doAnything() {}
`;
      const matches = await explicitAnyRule.detect(content, 'test.ts');

      expect(matches.length).toBe(0);
    });
  });

  describe('tsIgnoreRule', () => {
    it('should detect @ts-ignore comment', async () => {
      const content = `
// @ts-ignore
const invalid = badCode();
`;
      const matches = await tsIgnoreRule.detect(content, 'test.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('typescript-ts-ignore');
    });

    it('should detect @ts-nocheck comment', async () => {
      const content = `// @ts-nocheck
const file = 'unchecked';
`;
      const matches = await tsIgnoreRule.detect(content, 'test.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('typescript-ts-ignore');
    });

    it('should detect multiple suppression comments', async () => {
      const content = `
// @ts-ignore
bad1();
// @ts-ignore
bad2();
// @ts-nocheck
`;
      const matches = await tsIgnoreRule.detect(content, 'test.ts');

      expect(matches.length).toBe(3);
    });

    it('should NOT detect @ts-expect-error', async () => {
      const content = `
// @ts-expect-error - intentional type mismatch for test
const test = wrongType;
`;
      const matches = await tsIgnoreRule.detect(content, 'test.ts');

      expect(matches.length).toBe(0);
    });
  });

  describe('nonNullAssertionRule', () => {
    it('should detect non-null assertion with property access', async () => {
      const content = `
const name = user!.name;
`;
      const matches = await nonNullAssertionRule.detect(content, 'test.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('typescript-non-null-assertion');
    });

    it('should detect multiple non-null assertions', async () => {
      const content = `
const a = obj!.prop;
const b = arr!.length;
const c = data!.nested!.value;
`;
      const matches = await nonNullAssertionRule.detect(content, 'test.ts');

      expect(matches.length).toBe(4); // obj!., arr!., data!., nested!.
    });

    it('should NOT detect inequality operators', async () => {
      const content = `
if (a != b) {
  console.log('not equal');
}
if (x !== y) {
  console.log('strict not equal');
}
`;
      const matches = await nonNullAssertionRule.detect(content, 'test.ts');

      expect(matches.length).toBe(0);
    });

    it('should NOT detect negation operator', async () => {
      const content = `
const negative = !true;
const result = !isValid;
`;
      const matches = await nonNullAssertionRule.detect(content, 'test.ts');

      expect(matches.length).toBe(0);
    });
  });

  it('typescriptRules should contain all 3 rules', async () => {
    expect(typescriptRules).toHaveLength(3);
    expect(typescriptRules).toContain(explicitAnyRule);
    expect(typescriptRules).toContain(tsIgnoreRule);
    expect(typescriptRules).toContain(nonNullAssertionRule);
  });
});

// ============================================
// Error Handling Rules Tests
// ============================================

describe('Error Handling Rules', () => {
  describe('emptyCatchRule', () => {
    it('should detect empty catch block', async () => {
      const content = `
try {
  riskyOperation();
} catch (e) { }
`;
      const matches = await emptyCatchRule.detect(content, 'test.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('error-empty-catch');
    });

    it('should detect empty catch with whitespace', async () => {
      const content = `
try {
  doSomething();
} catch (error) {   }
`;
      const matches = await emptyCatchRule.detect(content, 'test.ts');

      expect(matches.length).toBe(1);
    });

    it('should NOT detect catch with content', async () => {
      const content = `
try {
  doSomething();
} catch (error) {
  console.error(error);
}
`;
      const matches = await emptyCatchRule.detect(content, 'test.ts');

      expect(matches.length).toBe(0);
    });

    it('should NOT detect catch with rethrow', async () => {
      const content = `
try {
  doSomething();
} catch (error) {
  throw error;
}
`;
      const matches = await emptyCatchRule.detect(content, 'test.ts');

      expect(matches.length).toBe(0);
    });
  });

  describe('consoleOnlyCatchRule', () => {
    it('should detect catch with only console.error', async () => {
      const content = `
try {
  await saveData();
} catch (e) {
  console.error(e);
}
`;
      const matches = await consoleOnlyCatchRule.detect(content, 'test.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('error-console-only-catch');
    });

    it('should detect catch with only console.log', async () => {
      const content = `
try {
  doSomething();
} catch (error) {
  console.log(error);
}
`;
      const matches = await consoleOnlyCatchRule.detect(content, 'test.ts');

      expect(matches.length).toBe(1);
    });

    it('should NOT detect catch with console AND rethrow', async () => {
      const content = `
try {
  doSomething();
} catch (error) {
  console.error(error);
  throw error;
}
`;
      const matches = await consoleOnlyCatchRule.detect(content, 'test.ts');

      expect(matches.length).toBe(0);
    });

    it('should NOT detect catch with console AND return', async () => {
      const content = `
try {
  return await fetch();
} catch (error) {
  console.error(error);
  return null;
}
`;
      const matches = await consoleOnlyCatchRule.detect(content, 'test.ts');

      expect(matches.length).toBe(0);
    });
  });

  it('errorHandlingRules should contain all 2 rules', async () => {
    expect(errorHandlingRules).toHaveLength(2);
    expect(errorHandlingRules).toContain(emptyCatchRule);
    expect(errorHandlingRules).toContain(consoleOnlyCatchRule);
  });
});

// ============================================
// Architecture Rules Tests
// ============================================

describe('Architecture Rules', () => {
  describe('fileTooLargeRule', () => {
    it('should detect file with >1000 lines as error', async () => {
      const lines = Array(1001).fill('const x = 1;').join('\n');
      const matches = await fileTooLargeRule.detect(lines, 'large.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('arch-file-too-large');
      expect(matches[0].metadata?.['severity']).toBe('error');
      expect(matches[0].metadata?.['lineCount']).toBe(1001);
    });

    it('should detect file with >500 lines as warning', async () => {
      const lines = Array(501).fill('const x = 1;').join('\n');
      const matches = await fileTooLargeRule.detect(lines, 'medium.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('arch-file-too-large');
      expect(matches[0].metadata?.['severity']).toBe('warning');
      expect(matches[0].metadata?.['lineCount']).toBe(501);
    });

    it('should NOT detect file with 500 or fewer lines', async () => {
      const lines = Array(500).fill('const x = 1;').join('\n');
      const matches = await fileTooLargeRule.detect(lines, 'normal.ts');

      expect(matches.length).toBe(0);
    });

    it('should NOT detect small file', async () => {
      const content = `
export function add(a: number, b: number): number {
  return a + b;
}
`;
      const matches = await fileTooLargeRule.detect(content, 'utils.ts');

      expect(matches.length).toBe(0);
    });
  });

  describe('tooManyImportsRule', () => {
    it('should detect file with >15 imports', async () => {
      const imports = Array(16)
        .fill(null)
        .map((_, i) => `import { Module${i} } from './module${i}';`)
        .join('\n');
      const content = `${imports}\n\nexport class Main {}`;

      const matches = await tooManyImportsRule.detect(content, 'index.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('arch-too-many-imports');
      expect(matches[0].metadata?.['importCount']).toBe(16);
    });

    it('should NOT detect file with 15 or fewer imports', async () => {
      const imports = Array(15)
        .fill(null)
        .map((_, i) => `import { Module${i} } from './module${i}';`)
        .join('\n');
      const content = `${imports}\n\nexport class Main {}`;

      const matches = await tooManyImportsRule.detect(content, 'index.ts');

      expect(matches.length).toBe(0);
    });

    it('should count import type statements', async () => {
      const imports = Array(16)
        .fill(null)
        .map((_, i) => `import type { Type${i} } from './types${i}';`)
        .join('\n');

      const matches = await tooManyImportsRule.detect(imports, 'types.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].metadata?.['importCount']).toBe(16);
    });

    it('should NOT count export statements', async () => {
      const exports = Array(20)
        .fill(null)
        .map((_, i) => `export { Module${i} } from './module${i}';`)
        .join('\n');

      const matches = await tooManyImportsRule.detect(exports, 'index.ts');

      expect(matches.length).toBe(0);
    });
  });

  describe('functionTooLargeRule (AST-backed — TASK_2025_291 B2)', () => {
    /**
     * Build a synthetic {@link QueryMatch} matching the shape produced by
     * `TreeSitterParserService.queryFunctions`. We only populate the fields
     * the rule reads: the declaration capture's row span and (optionally)
     * the name capture's text.
     */
    function fakeDeclaration(options: {
      kind?:
        | 'function.declaration'
        | 'arrow.declaration'
        | 'arrow_var.declaration'
        | 'method.declaration'
        | 'generator.declaration';
      name?: string;
      startRow: number;
      endRow: number;
    }): QueryMatch {
      const kind = options.kind ?? 'function.declaration';
      const nameKind = kind.replace('.declaration', '.name');
      const captures: QueryMatch['captures'] = [
        {
          name: kind,
          text: '',
          startPosition: { row: options.startRow, column: 0 },
          endPosition: { row: options.endRow, column: 0 },
          node: {
            type: 'function_declaration',
            text: '',
            startPosition: { row: options.startRow, column: 0 },
            endPosition: { row: options.endRow, column: 0 },
            isNamed: true,
            fieldName: null,
            children: [],
          },
        },
      ];
      if (options.name) {
        captures.push({
          name: nameKind,
          text: options.name,
          startPosition: { row: options.startRow, column: 0 },
          endPosition: { row: options.startRow, column: options.name.length },
          node: {
            type: 'identifier',
            text: options.name,
            startPosition: { row: options.startRow, column: 0 },
            endPosition: { row: options.startRow, column: options.name.length },
            isNamed: true,
            fieldName: null,
            children: [],
          },
        });
      }
      return { pattern: 0, captures };
    }

    let mockParser: jest.Mocked<TreeSitterParserService>;

    beforeEach(() => {
      mockParser = {
        queryFunctions: jest.fn(),
      } as unknown as jest.Mocked<TreeSitterParserService>;
      mockParser.queryFunctions.mockResolvedValue(Result.ok([]));
      configureArchitectureRules(mockParser);
    });

    afterEach(() => {
      resetArchitectureRulesForTests();
    });

    // --- Existing 6 tests (now async) ------------------------------------
    // (5 original + the extra 'multiple large functions' from rules.spec.ts)

    it('should detect function with >50 lines', async () => {
      mockParser.queryFunctions.mockResolvedValue(
        Result.ok([
          fakeDeclaration({ name: 'largeFunction', startRow: 1, endRow: 54 }),
        ]),
      );
      const content = 'function largeFunction() {\n/* 52 lines */\n}';

      const matches = await Promise.resolve(
        functionTooLargeRule.detect(content, 'service.ts'),
      );

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('arch-function-too-large');
      expect(matches[0].metadata?.['lineCount']).toBeGreaterThan(50);
    });

    it('should detect arrow function with >50 lines', async () => {
      mockParser.queryFunctions.mockResolvedValue(
        Result.ok([
          fakeDeclaration({
            kind: 'arrow.declaration',
            name: 'largeArrow',
            startRow: 1,
            endRow: 54,
          }),
        ]),
      );
      const content = 'const largeArrow = () => {\n/* 52 lines */\n};';

      const matches = await Promise.resolve(
        functionTooLargeRule.detect(content, 'handler.ts'),
      );

      expect(matches.length).toBe(1);
    });

    it('should NOT detect function with 50 or fewer lines', async () => {
      mockParser.queryFunctions.mockResolvedValue(
        Result.ok([
          fakeDeclaration({ name: 'normalFunction', startRow: 1, endRow: 50 }),
        ]),
      );
      const content = 'function normalFunction() {\n/* 48 lines */\n}';

      const matches = await Promise.resolve(
        functionTooLargeRule.detect(content, 'utils.ts'),
      );

      expect(matches.length).toBe(0);
    });

    it('should detect multiple large functions', async () => {
      mockParser.queryFunctions.mockResolvedValue(
        Result.ok([
          fakeDeclaration({ name: 'large1', startRow: 1, endRow: 54 }),
          fakeDeclaration({ name: 'large2', startRow: 56, endRow: 109 }),
        ]),
      );
      const content = "/* doesn't matter — mock drives results */";

      const matches = await Promise.resolve(
        functionTooLargeRule.detect(content, 'service.ts'),
      );

      expect(matches.length).toBe(2);
    });

    it('should NOT detect small function', async () => {
      mockParser.queryFunctions.mockResolvedValue(
        Result.ok([fakeDeclaration({ name: 'add', startRow: 1, endRow: 3 })]),
      );
      const content =
        'function add(a: number, b: number): number {\n  return a + b;\n}';

      const matches = await Promise.resolve(
        functionTooLargeRule.detect(content, 'math.ts'),
      );

      expect(matches.length).toBe(0);
    });

    it('should return [] when parser is not configured', async () => {
      resetArchitectureRulesForTests();
      const content = 'function whatever() {}';

      const matches = await Promise.resolve(
        functionTooLargeRule.detect(content, 'svc.ts'),
      );

      expect(matches).toEqual([]);
    });

    // --- 4 edge-case fixtures from TASK_2025_291 B2 brief ---------------
    // These fixtures are the motivation for moving off brace counting.
    // The old heuristic would treat the `{` inside the literal as a
    // function-body opening and accumulate lines until a later `}`,
    // producing spurious hits. The new AST-backed rule asks tree-sitter
    // for REAL function declarations, so literals are invisible to it.

    it('string containing unmatched brace: no function, no match', async () => {
      // Parser reports no function declarations — the only `{` is in the string.
      mockParser.queryFunctions.mockResolvedValue(Result.ok([]));
      const content = 'const s = "hello { world";';

      const matches = await Promise.resolve(
        functionTooLargeRule.detect(content, 'brace-in-string.ts'),
      );

      // BEFORE (brace counter): would try to start a "function body" at `{`
      // inside the string and accumulate until EOF, potentially false-positive.
      // AFTER: tree-sitter correctly identifies no function declarations.
      expect(matches).toEqual([]);
      expect(mockParser.queryFunctions).toHaveBeenCalledWith(
        content,
        'typescript',
      );
    });

    it('template literal with brace expression: no function, no match', async () => {
      mockParser.queryFunctions.mockResolvedValue(Result.ok([]));
      const content = 'const s = `${1 + 1}`;';

      const matches = await Promise.resolve(
        functionTooLargeRule.detect(content, 'template.ts'),
      );

      // BEFORE: `${...}` contains a `{` that a raw brace counter would pair
      //   with an unrelated later `}`, potentially flagging a phantom function.
      // AFTER: tree-sitter reports no function declarations, no match.
      expect(matches).toEqual([]);
    });

    it('regex literal with braces: no function, no match', async () => {
      mockParser.queryFunctions.mockResolvedValue(Result.ok([]));
      const content = 'const r = /\\{\\}/;';

      const matches = await Promise.resolve(
        functionTooLargeRule.detect(content, 'regex.ts'),
      );

      // BEFORE: the `{`/`}` inside the regex would be counted as code braces.
      // AFTER: tree-sitter correctly parses the regex literal as a single
      // token; no function declarations; no match.
      expect(matches).toEqual([]);
    });

    it("nested functions: each function counted on its own body, not its parent's", async () => {
      // Two nested declarations: outer `a` spans rows 1-4 (4 lines),
      // inner `b` spans rows 2-3 (2 lines). Neither exceeds 50 lines.
      mockParser.queryFunctions.mockResolvedValue(
        Result.ok([
          fakeDeclaration({ name: 'a', startRow: 0, endRow: 3 }),
          fakeDeclaration({ name: 'b', startRow: 1, endRow: 2 }),
        ]),
      );
      const content = 'function a() { function b() { return 1; } return b(); }';

      const matches = await Promise.resolve(
        functionTooLargeRule.detect(content, 'nested.ts'),
      );

      // BEFORE: the brace counter, on seeing the outer `{`, would accumulate
      // braces through the inner body and report a single count that
      // effectively double-counts the inner lines as part of the outer.
      // AFTER: each declaration is reported independently with its own row
      // range; short functions produce no matches.
      expect(matches).toEqual([]);
    });

    it('nested functions: inner crosses threshold independently of outer', async () => {
      // Outer `a` is short (rows 0-3), inner `b` is huge (rows 1-60).
      // The inner should be flagged with its own line count, not the outer's.
      mockParser.queryFunctions.mockResolvedValue(
        Result.ok([
          fakeDeclaration({ name: 'a', startRow: 0, endRow: 3 }),
          fakeDeclaration({ name: 'b', startRow: 1, endRow: 60 }),
        ]),
      );
      const content = 'function a() { function b() { /* big */ } return b(); }';

      const matches = await Promise.resolve(
        functionTooLargeRule.detect(content, 'nested-big.ts'),
      );

      expect(matches).toHaveLength(1);
      expect(matches[0].matchedText).toBe('b');
      expect(matches[0].metadata?.['lineCount']).toBe(60);
    });
  });

  it('architectureRules should contain all 3 rules', async () => {
    expect(architectureRules).toHaveLength(3);
    expect(architectureRules).toContain(fileTooLargeRule);
    expect(architectureRules).toContain(tooManyImportsRule);
    expect(architectureRules).toContain(functionTooLargeRule);
  });
});

// ============================================
// Testing Rules Tests
// ============================================

describe('Testing Rules', () => {
  describe('noAssertionsRule', () => {
    it('should detect test file with it() but no expect()', async () => {
      const content = `
describe('feature', () => {
  it('should do something', async () => {
    const result = doSomething();
    // Missing assertion
  });
});
`;
      const matches = await noAssertionsRule.detect(content, 'feature.spec.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('test-no-assertions');
    });

    it('should detect test file with test() but no expect()', async () => {
      const content = `
describe('feature', () => {
  test('should work', () => {
    process();
  });
});
`;
      const matches = await noAssertionsRule.detect(content, 'feature.test.ts');

      expect(matches.length).toBe(1);
    });

    it('should NOT detect test with expect()', async () => {
      const content = `
describe('feature', () => {
  it('should do something', async () => {
    const result = doSomething();
    expect(result).toBeDefined();
  });
});
`;
      const matches = await noAssertionsRule.detect(content, 'feature.spec.ts');

      expect(matches.length).toBe(0);
    });

    it('should NOT detect test with assert()', async () => {
      const content = `
describe('feature', () => {
  it('should work', async () => {
    assert.ok(validate());
  });
});
`;
      const matches = await noAssertionsRule.detect(content, 'feature.spec.ts');

      expect(matches.length).toBe(0);
    });

    it('should NOT apply to non-test files', async () => {
      expect(noAssertionsRule.fileExtensions).toContain('.spec.ts');
      expect(noAssertionsRule.fileExtensions).toContain('.test.ts');
      expect(noAssertionsRule.fileExtensions).toContain('.spec.js');
      expect(noAssertionsRule.fileExtensions).toContain('.test.js');
      expect(noAssertionsRule.fileExtensions).not.toContain('.ts');
    });
  });

  describe('allSkippedRule', () => {
    it('should detect all it.skip tests', async () => {
      const content = `
describe('feature', () => {
  it.skip('test 1', () => {
    expect(1).toBe(1);
  });
  it.skip('test 2', () => {
    expect(2).toBe(2);
  });
});
`;
      const matches = await allSkippedRule.detect(content, 'feature.spec.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('test-all-skipped');
      expect(matches[0].metadata?.['skippedCount']).toBe(2);
    });

    it('should detect all test.skip tests', async () => {
      const content = `
describe('feature', () => {
  test.skip('test 1', () => {});
  test.skip('test 2', () => {});
});
`;
      const matches = await allSkippedRule.detect(content, 'feature.test.ts');

      expect(matches.length).toBe(1);
    });

    it('should detect describe.skip', async () => {
      const content = `
describe.skip('feature', () => {
  it('test 1', async () => {
    expect(1).toBe(1);
  });
  it('test 2', async () => {
    expect(2).toBe(2);
  });
});
`;
      const matches = await allSkippedRule.detect(content, 'feature.spec.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].metadata?.['reason']).toBe('describe.skip');
    });

    it('should NOT detect mix of skipped and active tests', async () => {
      const content = `
describe('feature', () => {
  it.skip('skipped test', () => {});
  it('active test', async () => {
    expect(true).toBe(true);
  });
});
`;
      const matches = await allSkippedRule.detect(content, 'feature.spec.ts');

      expect(matches.length).toBe(0);
    });

    it('should NOT detect file with no tests', async () => {
      const content = `
describe('feature', () => {
  // No tests yet
});
`;
      const matches = await allSkippedRule.detect(content, 'feature.spec.ts');

      expect(matches.length).toBe(0);
    });

    it('should NOT detect file with no skipped tests', async () => {
      const content = `
describe('feature', () => {
  it('test 1', async () => {
    expect(1).toBe(1);
  });
});
`;
      const matches = await allSkippedRule.detect(content, 'feature.spec.ts');

      expect(matches.length).toBe(0);
    });
  });

  it('testingRules should contain all 2 rules', async () => {
    expect(testingRules).toHaveLength(2);
    expect(testingRules).toContain(noAssertionsRule);
    expect(testingRules).toContain(allSkippedRule);
  });
});

// ============================================
// RuleRegistry Tests
// ============================================

describe('RuleRegistry', () => {
  let registry: RuleRegistry;

  beforeEach(() => {
    registry = new RuleRegistry();
  });

  describe('constructor', () => {
    it('should register all built-in rules', async () => {
      const rules = registry.getRules();
      expect(rules.length).toBe(ALL_RULES.length);
    });
  });

  describe('getRules', () => {
    it('should return all enabled rules', async () => {
      const rules = registry.getRules();

      expect(rules.length).toBeGreaterThan(0);
      rules.forEach((rule) => {
        expect(rule.enabledByDefault).toBe(true);
      });
    });

    it('should exclude disabled rules', async () => {
      registry.configureRule('typescript-explicit-any', { enabled: false });

      const rules = registry.getRules();
      const anyRule = rules.find((r) => r.id === 'typescript-explicit-any');

      expect(anyRule).toBeUndefined();
    });

    it('should include explicitly enabled rules', async () => {
      // First disable, then re-enable
      registry.configureRule('typescript-explicit-any', { enabled: false });
      registry.configureRule('typescript-explicit-any', { enabled: true });

      const rules = registry.getRules();
      const anyRule = rules.find((r) => r.id === 'typescript-explicit-any');

      expect(anyRule).toBeDefined();
    });
  });

  describe('getRulesByCategory', () => {
    it('should return TypeScript rules for typescript category', async () => {
      const rules = registry.getRulesByCategory('typescript');

      expect(rules.length).toBe(3);
      rules.forEach((rule) => {
        expect(rule.category).toBe('typescript');
      });
    });

    it('should return error handling rules', async () => {
      const rules = registry.getRulesByCategory('error-handling');

      expect(rules.length).toBe(2);
      rules.forEach((rule) => {
        expect(rule.category).toBe('error-handling');
      });
    });

    it('should return architecture rules', async () => {
      const rules = registry.getRulesByCategory('architecture');

      expect(rules.length).toBe(3);
      rules.forEach((rule) => {
        expect(rule.category).toBe('architecture');
      });
    });

    it('should return testing rules', async () => {
      const rules = registry.getRulesByCategory('testing');

      expect(rules.length).toBe(2);
      rules.forEach((rule) => {
        expect(rule.category).toBe('testing');
      });
    });

    it('should return empty array for unknown category', async () => {
      // Type assertion needed for testing unknown category
      const rules = registry.getRulesByCategory('unknown' as 'typescript');

      expect(rules.length).toBe(0);
    });
  });

  describe('getRulesForExtension', () => {
    it('should return rules applicable to .ts files', async () => {
      const rules = registry.getRulesForExtension('.ts');

      // All TypeScript, error handling, and architecture rules apply to .ts
      expect(rules.length).toBeGreaterThan(5);
      rules.forEach((rule) => {
        expect(rule.fileExtensions).toContain('.ts');
      });
    });

    it('should return rules applicable to .spec.ts files', async () => {
      const rules = registry.getRulesForExtension('.spec.ts');

      // Testing rules apply to .spec.ts
      expect(rules.length).toBe(2);
      rules.forEach((rule) => {
        expect(rule.category).toBe('testing');
      });
    });

    it('should return rules applicable to .test.js files', async () => {
      const rules = registry.getRulesForExtension('.test.js');

      expect(rules.length).toBe(2);
      rules.forEach((rule) => {
        expect(rule.category).toBe('testing');
      });
    });

    it('should return empty array for unsupported extension', async () => {
      const rules = registry.getRulesForExtension('.py');

      expect(rules.length).toBe(0);
    });
  });

  describe('getRule', () => {
    it('should return a specific rule by ID', async () => {
      const rule = registry.getRule('typescript-explicit-any');

      expect(rule).toBeDefined();
      expect(rule?.id).toBe('typescript-explicit-any');
      expect(rule?.name).toBe('Explicit Any Type');
    });

    it('should return undefined for unknown rule ID', async () => {
      const rule = registry.getRule(
        'unknown-rule' as 'typescript-explicit-any',
      );

      expect(rule).toBeUndefined();
    });
  });

  describe('isRuleEnabled', () => {
    it('should return true for enabled by default rule', async () => {
      const enabled = registry.isRuleEnabled('typescript-explicit-any');

      expect(enabled).toBe(true);
    });

    it('should return false for disabled rule', async () => {
      registry.configureRule('typescript-explicit-any', { enabled: false });

      const enabled = registry.isRuleEnabled('typescript-explicit-any');

      expect(enabled).toBe(false);
    });

    it('should return false for unknown rule', async () => {
      const enabled = registry.isRuleEnabled(
        'unknown-rule' as 'typescript-explicit-any',
      );

      expect(enabled).toBe(false);
    });
  });

  describe('getEffectiveSeverity', () => {
    it('should return default severity when not configured', async () => {
      const severity = registry.getEffectiveSeverity('typescript-explicit-any');

      expect(severity).toBe('warning');
    });

    it('should return configured severity when set', async () => {
      registry.configureRule('typescript-explicit-any', { severity: 'error' });

      const severity = registry.getEffectiveSeverity('typescript-explicit-any');

      expect(severity).toBe('error');
    });

    it('should return undefined for unknown rule', async () => {
      const severity = registry.getEffectiveSeverity(
        'unknown-rule' as 'typescript-explicit-any',
      );

      expect(severity).toBeUndefined();
    });
  });

  describe('resetConfigurations', () => {
    it('should restore rules to default state', async () => {
      registry.configureRule('typescript-explicit-any', { enabled: false });
      registry.configureRule('typescript-ts-ignore', { severity: 'error' });

      registry.resetConfigurations();

      expect(registry.isRuleEnabled('typescript-explicit-any')).toBe(true);
      expect(registry.getEffectiveSeverity('typescript-ts-ignore')).toBe(
        'warning',
      );
    });
  });

  describe('registerRule', () => {
    it('should add a new rule', async () => {
      const customRule = {
        ...explicitAnyRule,
        id: 'custom-rule' as const,
        name: 'Custom Rule',
      };

      // Need to cast for test
      registry.registerRule(customRule as unknown as typeof explicitAnyRule);

      const rule = registry.getRule('custom-rule' as 'typescript-explicit-any');
      expect(rule).toBeDefined();
      expect(rule?.name).toBe('Custom Rule');
    });

    it('should replace existing rule with same ID', async () => {
      const modifiedRule = {
        ...explicitAnyRule,
        name: 'Modified Any Rule',
      };

      registry.registerRule(modifiedRule);

      const rule = registry.getRule('typescript-explicit-any');
      expect(rule?.name).toBe('Modified Any Rule');
    });
  });
});

// ============================================
// ALL_RULES Constant Tests
// ============================================

describe('ALL_RULES', () => {
  it('should contain 25 total rules (10 original + 15 framework)', async () => {
    expect(ALL_RULES.length).toBe(25);
  });

  it('should contain all rule categories', async () => {
    const categories = new Set(ALL_RULES.map((r) => r.category));

    expect(categories.has('typescript')).toBe(true);
    expect(categories.has('error-handling')).toBe(true);
    expect(categories.has('architecture')).toBe(true);
    expect(categories.has('testing')).toBe(true);
  });

  it('should have unique rule IDs', async () => {
    const ids = ALL_RULES.map((r) => r.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should have all rules enabled by default', async () => {
    ALL_RULES.forEach((rule) => {
      expect(rule.enabledByDefault).toBe(true);
    });
  });
});
