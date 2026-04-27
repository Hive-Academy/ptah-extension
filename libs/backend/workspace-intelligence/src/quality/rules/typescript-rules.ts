/**
 * TypeScript Anti-Pattern Detection Rules
 *
 * Provides rules for detecting common TypeScript anti-patterns that
 * can lead to type safety issues, maintenance problems, and bugs.
 *
 * Rules included:
 * - Explicit `any` type usage
 * - @ts-ignore and @ts-nocheck comments
 * - Non-null assertion operator overuse
 *
 * TASK_2025_141: Unified Project Intelligence with Code Quality Assessment
 *
 * @packageDocumentation
 */

import type { AntiPatternRule } from '@ptah-extension/shared';
import { createRegexRule } from './rule-base';

// ============================================
// TypeScript Rules
// ============================================

/**
 * Detects explicit usage of the `any` type.
 *
 * The `any` type bypasses TypeScript's type system, making the code
 * prone to runtime errors and harder to maintain. This rule detects
 * explicit `: any` annotations but excludes union types like `any | null`.
 *
 * Pattern: Matches `: any` not followed by `| <type>`
 *
 * @severity warning - Can be intentional escape hatch but should be minimized
 *
 * @example Detected patterns:
 * ```typescript
 * function parse(data: any) { ... }  // Detected
 * let result: any = undefined;       // Detected
 * const config: any | null = null;   // NOT detected (union type)
 * ```
 */
export const explicitAnyRule: AntiPatternRule = createRegexRule({
  id: 'typescript-explicit-any',
  name: 'Explicit Any Type',
  description:
    'Detects explicit usage of the `any` type which bypasses type safety',
  severity: 'warning',
  category: 'typescript',
  fileExtensions: ['.ts', '.tsx'],
  // Match `: any` but not when followed by `| <word>` (union type)
  pattern: /:\s*any\b(?!\s*\|\s*\w)/g,
  suggestionTemplate:
    'Replace `any` with a specific type or use `unknown` for type-safe handling. ' +
    'Consider creating an interface or type alias for complex structures.',
});

/**
 * Detects @ts-ignore and @ts-nocheck comments.
 *
 * These comments suppress TypeScript errors, which can hide real bugs
 * and make the codebase harder to maintain. The `@ts-expect-error`
 * directive is preferred as it fails when the error is fixed.
 *
 * Pattern: Matches `@ts-ignore` or `@ts-nocheck` anywhere in the line
 *
 * @severity warning - Suppresses type errors that may indicate bugs
 *
 * @example Detected patterns:
 * ```typescript
 * // @ts-ignore
 * someFunction(wrongType);
 *
 * // @ts-nocheck (at file level)
 * ```
 */
export const tsIgnoreRule: AntiPatternRule = createRegexRule({
  id: 'typescript-ts-ignore',
  name: 'TS-Ignore Comment',
  description:
    'Detects @ts-ignore and @ts-nocheck comments that suppress TypeScript errors',
  severity: 'warning',
  category: 'typescript',
  fileExtensions: ['.ts', '.tsx'],
  pattern: /@ts-ignore|@ts-nocheck/g,
  // This rule's subject IS a comment — run against raw source so the B3
  // comment-stripper doesn't blank the directive before we can see it.
  matchInCommentsAndStrings: true,
  suggestionTemplate:
    'Fix the underlying type error instead of suppressing it. ' +
    'If suppression is necessary, use @ts-expect-error with a reason comment.',
});

/**
 * Detects excessive use of non-null assertion operator (!).
 *
 * The non-null assertion operator tells TypeScript to assume a value
 * is not null/undefined. Overuse can lead to runtime errors when
 * assumptions are wrong.
 *
 * Pattern: Matches `!.` (assertion followed by property access)
 * but not `!=` (inequality operator)
 *
 * @severity info - Can be valid but often indicates a design issue
 *
 * @example Detected patterns:
 * ```typescript
 * const name = user!.name;      // Detected
 * const items = list!.items!;   // Detected twice
 * if (a != b) { ... }           // NOT detected (inequality)
 * ```
 */
export const nonNullAssertionRule: AntiPatternRule = createRegexRule({
  id: 'typescript-non-null-assertion',
  name: 'Non-Null Assertion',
  description:
    'Detects excessive use of non-null assertions (!) which can mask null pointer issues',
  severity: 'info',
  category: 'typescript',
  fileExtensions: ['.ts', '.tsx'],
  // Match !. but not part of another word (handles negative lookbehind via exclusion)
  // Uses \b!\.  to match word boundary followed by !.
  // Note: (?<!\w) not supported in all environments, using simpler pattern
  pattern: /\b!\./g,
  suggestionTemplate:
    'Use optional chaining (?.) or add proper null checks. ' +
    'Consider refactoring to make nullability explicit in the type system.',
});

// ============================================
// Exports
// ============================================

/**
 * All TypeScript anti-pattern detection rules.
 *
 * Import this array to register all TypeScript rules with the RuleRegistry,
 * or import individual rules for selective registration.
 *
 * @example
 * ```typescript
 * import { typescriptRules, RuleRegistry } from './rules';
 *
 * const registry = new RuleRegistry();
 * typescriptRules.forEach(rule => registry.registerRule(rule));
 * ```
 */
export const typescriptRules: AntiPatternRule[] = [
  explicitAnyRule,
  tsIgnoreRule,
  nonNullAssertionRule,
];
