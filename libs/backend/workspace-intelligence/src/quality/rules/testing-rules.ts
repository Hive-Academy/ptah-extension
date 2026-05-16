/**
 * Testing Anti-Pattern Detection Rules
 *
 * Provides rules for detecting common testing anti-patterns that
 * can lead to false confidence, incomplete test coverage, and
 * maintenance burden.
 *
 * Rules included:
 * - Test files without assertions (tests that don't verify anything)
 * - All tests skipped (entire test file is disabled)
 *
 * These rules only apply to test files identified by extension:
 * .spec.ts, .test.ts, .spec.js, .test.js
 *
 * @packageDocumentation
 */

import type { AntiPatternRule, AntiPatternMatch } from '@ptah-extension/shared';
import { createHeuristicRule } from './rule-base';

// ============================================
// Testing Rules
// ============================================

/**
 * Detects test files that have test blocks but no assertions.
 *
 * Tests without assertions provide false confidence - they appear to pass
 * but don't actually verify any behavior. This commonly occurs when:
 * - Tests are copied and assertions not updated
 * - Placeholder tests are forgotten
 * - Assertions are accidentally deleted
 *
 * Detection logic:
 * - File has it() or test() blocks (indicates test file with tests)
 * - File has NO expect() or assert() calls (no verification)
 *
 * @severity warning - Test may not actually test anything
 *
 * @example Detected scenarios:
 * ```typescript
 * // Detected: test with no assertion
 * it('should process data', () => {
 *   const result = processData(input);
 *   // Missing: expect(result).toBe(...);
 * });
 *
 * // NOT detected: test with assertion
 * it('should process data', () => {
 *   const result = processData(input);
 *   expect(result).toBeDefined();
 * });
 *
 * // NOT detected: test with assert
 * test('validates input', () => {
 *   assert.ok(validateInput(data));
 * });
 * ```
 */
export const noAssertionsRule: AntiPatternRule = createHeuristicRule({
  id: 'test-no-assertions',
  name: 'Test Without Assertions',
  description:
    'Detects test files with it()/test() blocks but no expect()/assert() calls',
  severity: 'warning',
  category: 'testing',
  fileExtensions: ['.spec.ts', '.test.ts', '.spec.js', '.test.js'],
  check: (content: string, filePath: string): AntiPatternMatch[] => {
    // Check if file has test blocks (it() or test() function calls)
    // Pattern matches: it('...', ...) or test('...', ...)
    // Also handles it.each, test.each variations
    const hasTestBlocks = /\b(it|test)\s*(\.\w+)?\s*\(/.test(content);

    // Check if file has assertion calls
    // Matches: expect(...) or assert.something(...) or assert(...)
    const hasAssertions = /\b(expect|assert)\s*[.(]/.test(content);

    // If there are test blocks but no assertions, that's a problem
    if (hasTestBlocks && !hasAssertions) {
      // Count how many test blocks exist
      const testBlockMatches = content.match(/\b(it|test)\s*(\.\w+)?\s*\(/g);
      const testCount = testBlockMatches ? testBlockMatches.length : 0;

      return [
        {
          type: 'test-no-assertions',
          location: { file: filePath },
          metadata: {
            testCount,
            hasItBlocks: /\bit\s*(\.\w+)?\s*\(/.test(content),
            hasTestBlocks: /\btest\s*(\.\w+)?\s*\(/.test(content),
          },
        },
      ];
    }

    return [];
  },
  suggestionTemplate:
    'Add assertions (expect/assert) to verify expected behavior. ' +
    'Tests without assertions provide false confidence and should either ' +
    'be completed or removed.',
});

/**
 * Detects test files where all tests are skipped.
 *
 * When all tests in a file are skipped (using it.skip or test.skip),
 * the test file provides no value and can mask regressions. Common causes:
 * - Temporary skip that was forgotten
 * - Tests broken during refactoring and not fixed
 * - Environment-specific tests that should use different skip logic
 *
 * Detection logic:
 * - Count it.skip/test.skip occurrences (skipped tests)
 * - Count all it/test occurrences (total tests)
 * - If skipped === total AND total > 0, all tests are skipped
 *
 * Note: describe.skip is handled implicitly as it affects all contained tests
 *
 * @severity info - May be intentional work-in-progress
 *
 * @example Detected scenarios:
 * ```typescript
 * // Detected: all tests skipped
 * describe('feature', () => {
 *   it.skip('test 1', () => { ... });
 *   it.skip('test 2', () => { ... });
 * });
 *
 * // NOT detected: mix of skipped and active
 * describe('feature', () => {
 *   it.skip('test 1', () => { ... });
 *   it('test 2', () => { ... });  // Active test
 * });
 *
 * // NOT detected: no tests at all (empty file)
 * describe('feature', () => {
 *   // No tests
 * });
 * ```
 */
export const allSkippedRule: AntiPatternRule = createHeuristicRule({
  id: 'test-all-skipped',
  name: 'All Tests Skipped',
  description: 'Detects test files where all it()/test() blocks are skipped',
  severity: 'info',
  category: 'testing',
  fileExtensions: ['.spec.ts', '.test.ts', '.spec.js', '.test.js'],
  check: (content: string, filePath: string): AntiPatternMatch[] => {
    // Count skipped tests: it.skip(...) or test.skip(...)
    const skippedMatches = content.match(/\b(it|test)\.skip\s*\(/g);
    const skippedCount = skippedMatches ? skippedMatches.length : 0;

    // Count all test blocks including skipped ones
    // Pattern: it( or test( or it.skip( or test.skip( or it.each( etc.
    const allTestMatches = content.match(/\b(it|test)\s*(\.\w+)?\s*\(/g);
    const totalCount = allTestMatches ? allTestMatches.length : 0;

    // Check for describe.skip which skips all nested tests
    const hasDescribeSkip = /\bdescribe\.skip\s*\(/.test(content);

    // If describe.skip is used, the whole suite is skipped
    if (hasDescribeSkip) {
      return [
        {
          type: 'test-all-skipped',
          location: { file: filePath },
          metadata: {
            reason: 'describe.skip',
            totalTests: totalCount,
          },
        },
      ];
    }

    // If all individual tests are skipped and there's at least one test
    if (skippedCount > 0 && skippedCount === totalCount) {
      return [
        {
          type: 'test-all-skipped',
          location: { file: filePath },
          metadata: {
            skippedCount,
            totalCount,
            reason: 'all-it-skip',
          },
        },
      ];
    }

    return [];
  },
  suggestionTemplate:
    'Enable skipped tests or remove them if no longer needed. ' +
    'Skipped tests accumulate technical debt and can mask regressions. ' +
    'If tests are environment-specific, use conditional skip logic.',
});

// ============================================
// Exports
// ============================================

/**
 * All testing anti-pattern detection rules.
 *
 * Import this array to register all testing rules with the RuleRegistry,
 * or import individual rules for selective registration.
 *
 * Note: These rules are designed for test file extensions only:
 * .spec.ts, .test.ts, .spec.js, .test.js
 *
 * @example
 * ```typescript
 * import { testingRules, RuleRegistry } from './rules';
 *
 * const registry = new RuleRegistry();
 * testingRules.forEach(rule => registry.registerRule(rule));
 *
 * // Only applies to test files
 * const forSpecFiles = registry.getRulesForExtension('.spec.ts');
 * ```
 */
export const testingRules: AntiPatternRule[] = [
  noAssertionsRule,
  allSkippedRule,
];
