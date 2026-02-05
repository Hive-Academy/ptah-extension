/**
 * Error Handling Anti-Pattern Detection Rules
 *
 * Provides rules for detecting common error handling anti-patterns that
 * can lead to silent failures, lost error context, and debugging difficulties.
 *
 * Rules included:
 * - Empty catch blocks (swallowing errors)
 * - Console-only catch blocks (logging without proper handling)
 *
 * TASK_2025_141: Unified Project Intelligence with Code Quality Assessment
 *
 * @packageDocumentation
 */

import type { AntiPatternRule, AntiPatternMatch } from '@ptah-extension/shared';
import {
  createRegexRule,
  createHeuristicRule,
  getLineFromPosition,
} from './rule-base';

// ============================================
// Error Handling Rules
// ============================================

/**
 * Detects empty catch blocks that silently swallow errors.
 *
 * Empty catch blocks are one of the most dangerous anti-patterns because
 * they completely hide errors, making debugging extremely difficult.
 * Errors should always be logged, rethrown, or converted to a result type.
 *
 * Pattern: Matches `catch(...) { }` with only whitespace in the body
 *
 * @severity error - Critical issue that hides errors
 *
 * @example Detected patterns:
 * ```typescript
 * try {
 *   riskyOperation();
 * } catch (e) { }  // Detected - empty catch
 *
 * try {
 *   riskyOperation();
 * } catch (e) {
 *   // Comment only - NOT detected by this simple pattern
 * }
 *
 * try {
 *   riskyOperation();
 * } catch (e) {
 *   console.error(e);  // NOT detected - has content
 * }
 * ```
 */
export const emptyCatchRule: AntiPatternRule = createRegexRule({
  id: 'error-empty-catch',
  name: 'Empty Catch Block',
  description:
    'Detects catch blocks with empty bodies that silently swallow errors',
  severity: 'error',
  category: 'error-handling',
  fileExtensions: ['.ts', '.tsx', '.js', '.jsx'],
  // Match catch with optional parameter followed by empty braces
  // Handles various whitespace patterns between catch and braces
  pattern: /catch\s*\([^)]*\)\s*\{\s*\}/g,
  suggestionTemplate:
    'Handle the error appropriately: log it with context, rethrow it, ' +
    'or return an error result. Never silently swallow errors.',
});

/**
 * Detects catch blocks that only contain console logging.
 *
 * While logging errors is important, catch blocks that ONLY log without
 * any further action (rethrow, return error, recovery) can lead to:
 * - Silent failures in production
 * - Callers not knowing operations failed
 * - Inconsistent application state
 *
 * Pattern: Matches catch blocks containing only console.log/warn/error
 *
 * @severity warning - Error is logged but not properly handled
 *
 * @example Detected patterns:
 * ```typescript
 * try {
 *   await saveData();
 * } catch (e) {
 *   console.error(e);  // Detected - console only
 * }
 *
 * try {
 *   await saveData();
 * } catch (e) {
 *   console.error(e);
 *   throw e;  // NOT detected - has rethrow
 * }
 *
 * try {
 *   await saveData();
 * } catch (e) {
 *   console.error(e);
 *   return Result.err(e);  // NOT detected - has return
 * }
 * ```
 */
export const consoleOnlyCatchRule: AntiPatternRule = createHeuristicRule({
  id: 'error-console-only-catch',
  name: 'Console-Only Catch',
  description:
    'Detects catch blocks that only log to console without proper error handling',
  severity: 'warning',
  category: 'error-handling',
  fileExtensions: ['.ts', '.tsx', '.js', '.jsx'],
  check: (content: string, filePath: string): AntiPatternMatch[] => {
    const matches: AntiPatternMatch[] = [];

    // Pattern to match catch blocks containing only console statements
    // This pattern is more complex because it needs to analyze block content
    // Match: catch (...) { console.log/warn/error(...); }
    // The block should ONLY contain console statements and whitespace/semicolons
    const catchBlockPattern =
      /catch\s*\(([^)]*)\)\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;

    let match: RegExpExecArray | null;
    while ((match = catchBlockPattern.exec(content)) !== null) {
      const blockContent = match[2].trim();

      // Skip if block is empty (handled by emptyCatchRule)
      if (!blockContent) {
        continue;
      }

      // Check if block contains ONLY console statements
      // Remove console.log/warn/error/info/debug calls
      const withoutConsole = blockContent
        .replace(/console\.(log|warn|error|info|debug)\s*\([^)]*\)\s*;?/g, '')
        .trim();

      // If nothing remains after removing console calls, it's console-only
      if (withoutConsole === '' || withoutConsole === ';') {
        const lineNumber = getLineFromPosition(content, match.index);

        matches.push({
          type: 'error-console-only-catch',
          location: {
            file: filePath,
            line: lineNumber,
          },
          matchedText:
            match[0].length > 80 ? match[0].substring(0, 77) + '...' : match[0],
          metadata: {
            blockContent: blockContent.substring(0, 100),
          },
        });
      }
    }

    return matches;
  },
  suggestionTemplate:
    'Log the error AND handle it properly: rethrow for unexpected errors, ' +
    'return an error result, or implement recovery logic. ' +
    'Callers should know when operations fail.',
});

// ============================================
// Exports
// ============================================

/**
 * All error handling anti-pattern detection rules.
 *
 * Import this array to register all error handling rules with the RuleRegistry,
 * or import individual rules for selective registration.
 *
 * @example
 * ```typescript
 * import { errorHandlingRules, RuleRegistry } from './rules';
 *
 * const registry = new RuleRegistry();
 * errorHandlingRules.forEach(rule => registry.registerRule(rule));
 * ```
 */
export const errorHandlingRules: AntiPatternRule[] = [
  emptyCatchRule,
  consoleOnlyCatchRule,
];
