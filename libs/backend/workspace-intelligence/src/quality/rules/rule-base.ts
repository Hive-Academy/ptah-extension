/**
 * Rule Base Utilities
 *
 * Provides factory functions for creating anti-pattern detection rules.
 * These utilities abstract the common patterns for regex-based and
 * heuristic-based rule definitions.
 *
 * @packageDocumentation
 */

import type {
  AntiPatternRule,
  AntiPatternMatch,
  AntiPatternType,
  AntiPatternSeverity,
  MaybeAsync,
  RuleCategory,
} from '@ptah-extension/shared';

import { stripCommentsAndStrings } from './strip-comments-and-strings';

// ============================================
// Factory Configuration Types
// ============================================

/**
 * Configuration for creating a regex-based anti-pattern rule.
 * Regex rules detect patterns by matching a regular expression
 * against each line of file content.
 */
export interface RegexRuleConfig {
  /** Unique rule identifier matching an AntiPatternType */
  id: AntiPatternType;
  /** Human-readable rule name */
  name: string;
  /** Description of what the rule detects */
  description: string;
  /** Severity level for detected patterns */
  severity: AntiPatternSeverity;
  /** Category for grouping rules */
  category: RuleCategory;
  /** File extensions this rule applies to (e.g., ['.ts', '.tsx']) */
  fileExtensions: string[];
  /** Regex pattern to match (use 'g' flag for multiple matches per line) */
  pattern: RegExp;
  /** Template string for the fix suggestion */
  suggestionTemplate: string;
  /** Whether the rule is enabled by default (defaults to true) */
  enabledByDefault?: boolean;
  /**
   * If true, the rule runs against the ORIGINAL source text instead of the
   * content with comments/strings stripped. Default: false (stripping is on).
   *
   * Set to `true` for rules whose subject IS a comment or string — e.g.
   * detectors for `@ts-ignore`, `@ts-nocheck`, or `TODO:` markers. Without
   * this flag, such rules would never match because the pre-processor blanks
   * their target content.
   */
  matchInCommentsAndStrings?: boolean;
}

/**
 * Configuration for creating a heuristic-based anti-pattern rule.
 * Heuristic rules use custom logic to detect patterns that cannot
 * be expressed as simple regex matches.
 */
export interface HeuristicRuleConfig {
  /** Unique rule identifier matching an AntiPatternType */
  id: AntiPatternType;
  /** Human-readable rule name */
  name: string;
  /** Description of what the rule detects */
  description: string;
  /** Severity level for detected patterns */
  severity: AntiPatternSeverity;
  /** Category for grouping rules */
  category: RuleCategory;
  /** File extensions this rule applies to (e.g., ['.ts', '.tsx']) */
  fileExtensions: string[];
  /**
   * Custom check function that analyzes file content.
   *
   * May return synchronously (e.g. regex/structural scans) or asynchronously
   * (e.g. AST-backed analyses using tree-sitter). Consumers of the produced
   * `AntiPatternRule.detect` must `await Promise.resolve(...)` the result.
   * The signature widens from `AntiPatternMatch[]` to `MaybeAsync<AntiPatternMatch[]>`
   * so rules like `functionTooLargeRule` can call into the async
   * `TreeSitterParserService`.
   *
   * @param content - File content to analyze
   * @param filePath - Relative file path
   * @returns Array of detected anti-pattern matches (or a Promise for one)
   */
  check: (content: string, filePath: string) => MaybeAsync<AntiPatternMatch[]>;
  /** Template string for the fix suggestion */
  suggestionTemplate: string;
  /** Whether the rule is enabled by default (defaults to true) */
  enabledByDefault?: boolean;
}

// ============================================
// Factory Functions
// ============================================

/**
 * Creates a regex-based anti-pattern detection rule.
 *
 * The created rule scans file content line-by-line, matching the provided
 * regex pattern against each line. This approach is efficient for detecting
 * single-line patterns like explicit `any` types or `@ts-ignore` comments.
 *
 * @param config - Configuration object for the regex rule
 * @returns A fully configured AntiPatternRule
 *
 * @example
 * ```typescript
 * const explicitAnyRule = createRegexRule({
 *   id: 'typescript-explicit-any',
 *   name: 'Explicit Any Type',
 *   description: 'Detects explicit usage of the `any` type',
 *   severity: 'warning',
 *   category: 'typescript',
 *   fileExtensions: ['.ts', '.tsx'],
 *   pattern: /:\s*any\b/g,
 *   suggestionTemplate: 'Replace `any` with a specific type or `unknown`',
 * });
 * ```
 */
export function createRegexRule(config: RegexRuleConfig): AntiPatternRule {
  return {
    id: config.id,
    name: config.name,
    description: config.description,
    severity: config.severity,
    method: 'regex',
    category: config.category,
    fileExtensions: config.fileExtensions,
    enabledByDefault: config.enabledByDefault ?? true,

    detect: (content: string, filePath: string): AntiPatternMatch[] => {
      const matches: AntiPatternMatch[] = [];
      // Strip comment/string contents before matching so rules don't mis-fire
      // on e.g. `// TODO: fix any` or `"console.log(x)"`.
      // The stripper preserves line count and per-line column positions, so
      // offsets computed against the stripped text are valid in the original
      // source — line/column in reported matches still point to the right
      // spot. We report `matchedText` from the ORIGINAL source so callers see
      // meaningful output (the stripped version would be spaces).
      //
      // Rules whose subject IS a comment/string (e.g. `@ts-ignore`) opt out
      // via `matchInCommentsAndStrings: true`.
      const scanTarget = config.matchInCommentsAndStrings
        ? content
        : stripCommentsAndStrings(content);
      const strippedLines = scanTarget.split('\n');
      const originalLines = content.split('\n');

      strippedLines.forEach((strippedLine, lineIndex) => {
        // Reset regex lastIndex for global patterns
        const pattern = new RegExp(config.pattern.source, config.pattern.flags);
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(strippedLine)) !== null) {
          const col = match.index ?? 0;
          const originalLine = originalLines[lineIndex] ?? '';
          const originalMatch = originalLine.substring(
            col,
            col + match[0].length,
          );

          matches.push({
            type: config.id,
            location: {
              file: filePath,
              line: lineIndex + 1, // 1-indexed
              column: col + 1, // 1-indexed
            },
            matchedText: originalMatch || match[0],
          });

          // Prevent infinite loops for non-global patterns
          if (!config.pattern.global) {
            break;
          }
        }
      });

      return matches;
    },

    getSuggestion: (): string => config.suggestionTemplate,
  };
}

/**
 * Creates a heuristic-based anti-pattern detection rule.
 *
 * Heuristic rules are used when pattern detection requires custom logic
 * beyond simple regex matching. Examples include:
 * - Multi-line pattern detection (catch blocks with specific content)
 * - Counting-based rules (file too large, too many imports)
 * - Structural analysis (function length, nesting depth)
 *
 * @param config - Configuration object for the heuristic rule
 * @returns A fully configured AntiPatternRule
 *
 * @example
 * ```typescript
 * const fileTooLargeRule = createHeuristicRule({
 *   id: 'arch-file-too-large',
 *   name: 'File Too Large',
 *   description: 'Detects files exceeding recommended line counts',
 *   severity: 'warning',
 *   category: 'architecture',
 *   fileExtensions: ['.ts', '.tsx', '.js', '.jsx'],
 *   check: (content, filePath) => {
 *     const lineCount = content.split('\n').length;
 *     if (lineCount > 500) {
 *       return [{
 *         type: 'arch-file-too-large',
 *         location: { file: filePath },
 *         metadata: { lineCount },
 *       }];
 *     }
 *     return [];
 *   },
 *   suggestionTemplate: 'Split this file into smaller, focused modules',
 * });
 * ```
 */
export function createHeuristicRule(
  config: HeuristicRuleConfig,
): AntiPatternRule {
  return {
    id: config.id,
    name: config.name,
    description: config.description,
    severity: config.severity,
    method: 'heuristic',
    category: config.category,
    fileExtensions: config.fileExtensions,
    enabledByDefault: config.enabledByDefault ?? true,

    detect: config.check,

    getSuggestion: (): string => config.suggestionTemplate,
  };
}

// ============================================
// Utility Functions
// ============================================

/**
 * Extracts file extension from a file path.
 *
 * @param filePath - File path to extract extension from
 * @returns File extension including the dot (e.g., '.ts') or empty string
 *
 * @example
 * ```typescript
 * getFileExtension('src/app.service.ts'); // '.ts'
 * getFileExtension('src/app.spec.ts'); // '.ts'
 * getFileExtension('Makefile'); // ''
 * ```
 */
export function getFileExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filePath.length - 1) {
    return '';
  }
  return filePath.substring(lastDot);
}

/**
 * Checks if a file path matches any of the specified extensions.
 *
 * @param filePath - File path to check
 * @param extensions - Array of extensions to match against
 * @returns True if file matches any extension
 *
 * @example
 * ```typescript
 * hasMatchingExtension('src/app.ts', ['.ts', '.tsx']); // true
 * hasMatchingExtension('src/app.js', ['.ts', '.tsx']); // false
 * ```
 */
export function hasMatchingExtension(
  filePath: string,
  extensions: string[],
): boolean {
  const ext = getFileExtension(filePath);
  return extensions.includes(ext);
}

/**
 * Calculates line number from character position in content.
 * Useful for heuristic rules that match multi-line patterns.
 *
 * @param content - Full file content
 * @param position - Character position (0-indexed)
 * @returns Line number (1-indexed)
 *
 * @example
 * ```typescript
 * const content = 'line1\nline2\nline3';
 * getLineFromPosition(content, 0); // 1 (start of line1)
 * getLineFromPosition(content, 6); // 2 (start of line2)
 * ```
 */
export function getLineFromPosition(content: string, position: number): number {
  const beforeMatch = content.substring(0, position);
  return (beforeMatch.match(/\n/g) || []).length + 1;
}
