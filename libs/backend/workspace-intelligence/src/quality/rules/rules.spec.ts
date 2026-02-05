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

// ============================================
// TypeScript Rules Tests
// ============================================

describe('TypeScript Rules', () => {
  describe('explicitAnyRule', () => {
    it('should detect explicit any type annotation', () => {
      const content = `
function processData(data: any) {
  return data;
}
`;
      const matches = explicitAnyRule.detect(content, 'test.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('typescript-explicit-any');
      expect(matches[0].location.line).toBe(2);
    });

    it('should detect multiple any usages', () => {
      const content = `
const a: any = 1;
const b: any = 'test';
let c: any;
`;
      const matches = explicitAnyRule.detect(content, 'test.ts');

      expect(matches.length).toBe(3);
    });

    it('should NOT detect any in union types', () => {
      const content = `
const value: any | null = null;
const data: string | any | number = 'test';
`;
      const matches = explicitAnyRule.detect(content, 'test.ts');

      expect(matches.length).toBe(0);
    });

    it('should NOT detect "any" in variable names or strings', () => {
      const content = `
const anyValue = 'test';
const company = 'Any Corp';
function doAnything() {}
`;
      const matches = explicitAnyRule.detect(content, 'test.ts');

      expect(matches.length).toBe(0);
    });
  });

  describe('tsIgnoreRule', () => {
    it('should detect @ts-ignore comment', () => {
      const content = `
// @ts-ignore
const invalid = badCode();
`;
      const matches = tsIgnoreRule.detect(content, 'test.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('typescript-ts-ignore');
    });

    it('should detect @ts-nocheck comment', () => {
      const content = `// @ts-nocheck
const file = 'unchecked';
`;
      const matches = tsIgnoreRule.detect(content, 'test.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('typescript-ts-ignore');
    });

    it('should detect multiple suppression comments', () => {
      const content = `
// @ts-ignore
bad1();
// @ts-ignore
bad2();
// @ts-nocheck
`;
      const matches = tsIgnoreRule.detect(content, 'test.ts');

      expect(matches.length).toBe(3);
    });

    it('should NOT detect @ts-expect-error', () => {
      const content = `
// @ts-expect-error - intentional type mismatch for test
const test = wrongType;
`;
      const matches = tsIgnoreRule.detect(content, 'test.ts');

      expect(matches.length).toBe(0);
    });
  });

  describe('nonNullAssertionRule', () => {
    it('should detect non-null assertion with property access', () => {
      const content = `
const name = user!.name;
`;
      const matches = nonNullAssertionRule.detect(content, 'test.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('typescript-non-null-assertion');
    });

    it('should detect multiple non-null assertions', () => {
      const content = `
const a = obj!.prop;
const b = arr!.length;
const c = data!.nested!.value;
`;
      const matches = nonNullAssertionRule.detect(content, 'test.ts');

      expect(matches.length).toBe(4); // obj!., arr!., data!., nested!.
    });

    it('should NOT detect inequality operators', () => {
      const content = `
if (a != b) {
  console.log('not equal');
}
if (x !== y) {
  console.log('strict not equal');
}
`;
      const matches = nonNullAssertionRule.detect(content, 'test.ts');

      expect(matches.length).toBe(0);
    });

    it('should NOT detect negation operator', () => {
      const content = `
const negative = !true;
const result = !isValid;
`;
      const matches = nonNullAssertionRule.detect(content, 'test.ts');

      expect(matches.length).toBe(0);
    });
  });

  it('typescriptRules should contain all 3 rules', () => {
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
    it('should detect empty catch block', () => {
      const content = `
try {
  riskyOperation();
} catch (e) { }
`;
      const matches = emptyCatchRule.detect(content, 'test.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('error-empty-catch');
    });

    it('should detect empty catch with whitespace', () => {
      const content = `
try {
  doSomething();
} catch (error) {   }
`;
      const matches = emptyCatchRule.detect(content, 'test.ts');

      expect(matches.length).toBe(1);
    });

    it('should NOT detect catch with content', () => {
      const content = `
try {
  doSomething();
} catch (error) {
  console.error(error);
}
`;
      const matches = emptyCatchRule.detect(content, 'test.ts');

      expect(matches.length).toBe(0);
    });

    it('should NOT detect catch with rethrow', () => {
      const content = `
try {
  doSomething();
} catch (error) {
  throw error;
}
`;
      const matches = emptyCatchRule.detect(content, 'test.ts');

      expect(matches.length).toBe(0);
    });
  });

  describe('consoleOnlyCatchRule', () => {
    it('should detect catch with only console.error', () => {
      const content = `
try {
  await saveData();
} catch (e) {
  console.error(e);
}
`;
      const matches = consoleOnlyCatchRule.detect(content, 'test.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('error-console-only-catch');
    });

    it('should detect catch with only console.log', () => {
      const content = `
try {
  doSomething();
} catch (error) {
  console.log(error);
}
`;
      const matches = consoleOnlyCatchRule.detect(content, 'test.ts');

      expect(matches.length).toBe(1);
    });

    it('should NOT detect catch with console AND rethrow', () => {
      const content = `
try {
  doSomething();
} catch (error) {
  console.error(error);
  throw error;
}
`;
      const matches = consoleOnlyCatchRule.detect(content, 'test.ts');

      expect(matches.length).toBe(0);
    });

    it('should NOT detect catch with console AND return', () => {
      const content = `
try {
  return await fetch();
} catch (error) {
  console.error(error);
  return null;
}
`;
      const matches = consoleOnlyCatchRule.detect(content, 'test.ts');

      expect(matches.length).toBe(0);
    });
  });

  it('errorHandlingRules should contain all 2 rules', () => {
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
    it('should detect file with >1000 lines as error', () => {
      const lines = Array(1001).fill('const x = 1;').join('\n');
      const matches = fileTooLargeRule.detect(lines, 'large.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('arch-file-too-large');
      expect(matches[0].metadata?.['severity']).toBe('error');
      expect(matches[0].metadata?.['lineCount']).toBe(1001);
    });

    it('should detect file with >500 lines as warning', () => {
      const lines = Array(501).fill('const x = 1;').join('\n');
      const matches = fileTooLargeRule.detect(lines, 'medium.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('arch-file-too-large');
      expect(matches[0].metadata?.['severity']).toBe('warning');
      expect(matches[0].metadata?.['lineCount']).toBe(501);
    });

    it('should NOT detect file with 500 or fewer lines', () => {
      const lines = Array(500).fill('const x = 1;').join('\n');
      const matches = fileTooLargeRule.detect(lines, 'normal.ts');

      expect(matches.length).toBe(0);
    });

    it('should NOT detect small file', () => {
      const content = `
export function add(a: number, b: number): number {
  return a + b;
}
`;
      const matches = fileTooLargeRule.detect(content, 'utils.ts');

      expect(matches.length).toBe(0);
    });
  });

  describe('tooManyImportsRule', () => {
    it('should detect file with >15 imports', () => {
      const imports = Array(16)
        .fill(null)
        .map((_, i) => `import { Module${i} } from './module${i}';`)
        .join('\n');
      const content = `${imports}\n\nexport class Main {}`;

      const matches = tooManyImportsRule.detect(content, 'index.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('arch-too-many-imports');
      expect(matches[0].metadata?.['importCount']).toBe(16);
    });

    it('should NOT detect file with 15 or fewer imports', () => {
      const imports = Array(15)
        .fill(null)
        .map((_, i) => `import { Module${i} } from './module${i}';`)
        .join('\n');
      const content = `${imports}\n\nexport class Main {}`;

      const matches = tooManyImportsRule.detect(content, 'index.ts');

      expect(matches.length).toBe(0);
    });

    it('should count import type statements', () => {
      const imports = Array(16)
        .fill(null)
        .map((_, i) => `import type { Type${i} } from './types${i}';`)
        .join('\n');

      const matches = tooManyImportsRule.detect(imports, 'types.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].metadata?.['importCount']).toBe(16);
    });

    it('should NOT count export statements', () => {
      const exports = Array(20)
        .fill(null)
        .map((_, i) => `export { Module${i} } from './module${i}';`)
        .join('\n');

      const matches = tooManyImportsRule.detect(exports, 'index.ts');

      expect(matches.length).toBe(0);
    });
  });

  describe('functionTooLargeRule', () => {
    it('should detect function with >50 lines', () => {
      const functionBody = Array(52).fill('  console.log("line");').join('\n');
      const content = `
function largeFunction() {
${functionBody}
}
`;
      const matches = functionTooLargeRule.detect(content, 'service.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('arch-function-too-large');
      expect(matches[0].metadata?.['lineCount']).toBeGreaterThan(50);
    });

    it('should detect arrow function with >50 lines', () => {
      const functionBody = Array(52).fill('  console.log("line");').join('\n');
      const content = `
const largeArrow = () => {
${functionBody}
};
`;
      const matches = functionTooLargeRule.detect(content, 'handler.ts');

      expect(matches.length).toBe(1);
    });

    it('should NOT detect function with 50 or fewer lines', () => {
      const functionBody = Array(48).fill('  console.log("line");').join('\n');
      const content = `
function normalFunction() {
${functionBody}
}
`;
      const matches = functionTooLargeRule.detect(content, 'utils.ts');

      expect(matches.length).toBe(0);
    });

    it('should detect multiple large functions', () => {
      const functionBody = Array(52).fill('  console.log("line");').join('\n');
      const content = `
function large1() {
${functionBody}
}

function large2() {
${functionBody}
}
`;
      const matches = functionTooLargeRule.detect(content, 'service.ts');

      expect(matches.length).toBe(2);
    });

    it('should NOT detect small function', () => {
      const content = `
function add(a: number, b: number): number {
  return a + b;
}
`;
      const matches = functionTooLargeRule.detect(content, 'math.ts');

      expect(matches.length).toBe(0);
    });
  });

  it('architectureRules should contain all 3 rules', () => {
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
    it('should detect test file with it() but no expect()', () => {
      const content = `
describe('feature', () => {
  it('should do something', () => {
    const result = doSomething();
    // Missing assertion
  });
});
`;
      const matches = noAssertionsRule.detect(content, 'feature.spec.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('test-no-assertions');
    });

    it('should detect test file with test() but no expect()', () => {
      const content = `
describe('feature', () => {
  test('should work', () => {
    process();
  });
});
`;
      const matches = noAssertionsRule.detect(content, 'feature.test.ts');

      expect(matches.length).toBe(1);
    });

    it('should NOT detect test with expect()', () => {
      const content = `
describe('feature', () => {
  it('should do something', () => {
    const result = doSomething();
    expect(result).toBeDefined();
  });
});
`;
      const matches = noAssertionsRule.detect(content, 'feature.spec.ts');

      expect(matches.length).toBe(0);
    });

    it('should NOT detect test with assert()', () => {
      const content = `
describe('feature', () => {
  it('should work', () => {
    assert.ok(validate());
  });
});
`;
      const matches = noAssertionsRule.detect(content, 'feature.spec.ts');

      expect(matches.length).toBe(0);
    });

    it('should NOT apply to non-test files', () => {
      expect(noAssertionsRule.fileExtensions).toContain('.spec.ts');
      expect(noAssertionsRule.fileExtensions).toContain('.test.ts');
      expect(noAssertionsRule.fileExtensions).toContain('.spec.js');
      expect(noAssertionsRule.fileExtensions).toContain('.test.js');
      expect(noAssertionsRule.fileExtensions).not.toContain('.ts');
    });
  });

  describe('allSkippedRule', () => {
    it('should detect all it.skip tests', () => {
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
      const matches = allSkippedRule.detect(content, 'feature.spec.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('test-all-skipped');
      expect(matches[0].metadata?.['skippedCount']).toBe(2);
    });

    it('should detect all test.skip tests', () => {
      const content = `
describe('feature', () => {
  test.skip('test 1', () => {});
  test.skip('test 2', () => {});
});
`;
      const matches = allSkippedRule.detect(content, 'feature.test.ts');

      expect(matches.length).toBe(1);
    });

    it('should detect describe.skip', () => {
      const content = `
describe.skip('feature', () => {
  it('test 1', () => {
    expect(1).toBe(1);
  });
  it('test 2', () => {
    expect(2).toBe(2);
  });
});
`;
      const matches = allSkippedRule.detect(content, 'feature.spec.ts');

      expect(matches.length).toBe(1);
      expect(matches[0].metadata?.['reason']).toBe('describe.skip');
    });

    it('should NOT detect mix of skipped and active tests', () => {
      const content = `
describe('feature', () => {
  it.skip('skipped test', () => {});
  it('active test', () => {
    expect(true).toBe(true);
  });
});
`;
      const matches = allSkippedRule.detect(content, 'feature.spec.ts');

      expect(matches.length).toBe(0);
    });

    it('should NOT detect file with no tests', () => {
      const content = `
describe('feature', () => {
  // No tests yet
});
`;
      const matches = allSkippedRule.detect(content, 'feature.spec.ts');

      expect(matches.length).toBe(0);
    });

    it('should NOT detect file with no skipped tests', () => {
      const content = `
describe('feature', () => {
  it('test 1', () => {
    expect(1).toBe(1);
  });
});
`;
      const matches = allSkippedRule.detect(content, 'feature.spec.ts');

      expect(matches.length).toBe(0);
    });
  });

  it('testingRules should contain all 2 rules', () => {
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
    it('should register all built-in rules', () => {
      const rules = registry.getRules();
      expect(rules.length).toBe(ALL_RULES.length);
    });
  });

  describe('getRules', () => {
    it('should return all enabled rules', () => {
      const rules = registry.getRules();

      expect(rules.length).toBeGreaterThan(0);
      rules.forEach((rule) => {
        expect(rule.enabledByDefault).toBe(true);
      });
    });

    it('should exclude disabled rules', () => {
      registry.configureRule('typescript-explicit-any', { enabled: false });

      const rules = registry.getRules();
      const anyRule = rules.find((r) => r.id === 'typescript-explicit-any');

      expect(anyRule).toBeUndefined();
    });

    it('should include explicitly enabled rules', () => {
      // First disable, then re-enable
      registry.configureRule('typescript-explicit-any', { enabled: false });
      registry.configureRule('typescript-explicit-any', { enabled: true });

      const rules = registry.getRules();
      const anyRule = rules.find((r) => r.id === 'typescript-explicit-any');

      expect(anyRule).toBeDefined();
    });
  });

  describe('getRulesByCategory', () => {
    it('should return TypeScript rules for typescript category', () => {
      const rules = registry.getRulesByCategory('typescript');

      expect(rules.length).toBe(3);
      rules.forEach((rule) => {
        expect(rule.category).toBe('typescript');
      });
    });

    it('should return error handling rules', () => {
      const rules = registry.getRulesByCategory('error-handling');

      expect(rules.length).toBe(2);
      rules.forEach((rule) => {
        expect(rule.category).toBe('error-handling');
      });
    });

    it('should return architecture rules', () => {
      const rules = registry.getRulesByCategory('architecture');

      expect(rules.length).toBe(3);
      rules.forEach((rule) => {
        expect(rule.category).toBe('architecture');
      });
    });

    it('should return testing rules', () => {
      const rules = registry.getRulesByCategory('testing');

      expect(rules.length).toBe(2);
      rules.forEach((rule) => {
        expect(rule.category).toBe('testing');
      });
    });

    it('should return empty array for unknown category', () => {
      // Type assertion needed for testing unknown category
      const rules = registry.getRulesByCategory('unknown' as 'typescript');

      expect(rules.length).toBe(0);
    });
  });

  describe('getRulesForExtension', () => {
    it('should return rules applicable to .ts files', () => {
      const rules = registry.getRulesForExtension('.ts');

      // All TypeScript, error handling, and architecture rules apply to .ts
      expect(rules.length).toBeGreaterThan(5);
      rules.forEach((rule) => {
        expect(rule.fileExtensions).toContain('.ts');
      });
    });

    it('should return rules applicable to .spec.ts files', () => {
      const rules = registry.getRulesForExtension('.spec.ts');

      // Testing rules apply to .spec.ts
      expect(rules.length).toBe(2);
      rules.forEach((rule) => {
        expect(rule.category).toBe('testing');
      });
    });

    it('should return rules applicable to .test.js files', () => {
      const rules = registry.getRulesForExtension('.test.js');

      expect(rules.length).toBe(2);
      rules.forEach((rule) => {
        expect(rule.category).toBe('testing');
      });
    });

    it('should return empty array for unsupported extension', () => {
      const rules = registry.getRulesForExtension('.py');

      expect(rules.length).toBe(0);
    });
  });

  describe('getRule', () => {
    it('should return a specific rule by ID', () => {
      const rule = registry.getRule('typescript-explicit-any');

      expect(rule).toBeDefined();
      expect(rule?.id).toBe('typescript-explicit-any');
      expect(rule?.name).toBe('Explicit Any Type');
    });

    it('should return undefined for unknown rule ID', () => {
      const rule = registry.getRule(
        'unknown-rule' as 'typescript-explicit-any'
      );

      expect(rule).toBeUndefined();
    });
  });

  describe('isRuleEnabled', () => {
    it('should return true for enabled by default rule', () => {
      const enabled = registry.isRuleEnabled('typescript-explicit-any');

      expect(enabled).toBe(true);
    });

    it('should return false for disabled rule', () => {
      registry.configureRule('typescript-explicit-any', { enabled: false });

      const enabled = registry.isRuleEnabled('typescript-explicit-any');

      expect(enabled).toBe(false);
    });

    it('should return false for unknown rule', () => {
      const enabled = registry.isRuleEnabled(
        'unknown-rule' as 'typescript-explicit-any'
      );

      expect(enabled).toBe(false);
    });
  });

  describe('getEffectiveSeverity', () => {
    it('should return default severity when not configured', () => {
      const severity = registry.getEffectiveSeverity('typescript-explicit-any');

      expect(severity).toBe('warning');
    });

    it('should return configured severity when set', () => {
      registry.configureRule('typescript-explicit-any', { severity: 'error' });

      const severity = registry.getEffectiveSeverity('typescript-explicit-any');

      expect(severity).toBe('error');
    });

    it('should return undefined for unknown rule', () => {
      const severity = registry.getEffectiveSeverity(
        'unknown-rule' as 'typescript-explicit-any'
      );

      expect(severity).toBeUndefined();
    });
  });

  describe('resetConfigurations', () => {
    it('should restore rules to default state', () => {
      registry.configureRule('typescript-explicit-any', { enabled: false });
      registry.configureRule('typescript-ts-ignore', { severity: 'error' });

      registry.resetConfigurations();

      expect(registry.isRuleEnabled('typescript-explicit-any')).toBe(true);
      expect(registry.getEffectiveSeverity('typescript-ts-ignore')).toBe(
        'warning'
      );
    });
  });

  describe('registerRule', () => {
    it('should add a new rule', () => {
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

    it('should replace existing rule with same ID', () => {
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
  it('should contain 10 total rules', () => {
    expect(ALL_RULES.length).toBe(10);
  });

  it('should contain all rule categories', () => {
    const categories = new Set(ALL_RULES.map((r) => r.category));

    expect(categories.has('typescript')).toBe(true);
    expect(categories.has('error-handling')).toBe(true);
    expect(categories.has('architecture')).toBe(true);
    expect(categories.has('testing')).toBe(true);
  });

  it('should have unique rule IDs', () => {
    const ids = ALL_RULES.map((r) => r.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should have all rules enabled by default', () => {
    ALL_RULES.forEach((rule) => {
      expect(rule.enabledByDefault).toBe(true);
    });
  });
});
