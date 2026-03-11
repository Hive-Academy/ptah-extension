/**
 * Architecture Anti-Pattern Detection Rules
 *
 * Provides rules for detecting common architectural anti-patterns that
 * can lead to maintainability issues, poor modularity, and technical debt.
 *
 * Rules included:
 * - File too large (>500 lines warning, >1000 lines error)
 * - Too many imports (>15 imports)
 * - Function too large (>50 lines)
 *
 * TASK_2025_141: Unified Project Intelligence with Code Quality Assessment
 *
 * @packageDocumentation
 */

import type { AntiPatternRule, AntiPatternMatch } from '@ptah-extension/shared';
import { createHeuristicRule } from './rule-base';

// ============================================
// Architecture Rules
// ============================================

/**
 * Detects files that exceed recommended line counts.
 *
 * Large files are harder to understand, test, and maintain. They often
 * indicate that a module has multiple responsibilities and should be
 * split into smaller, focused modules.
 *
 * Thresholds:
 * - >1000 lines: Error severity (critical size issue)
 * - >500 lines: Warning severity (approaching problematic size)
 *
 * @severity warning (dynamic - error for >1000 lines)
 *
 * @example Detected scenarios:
 * ```
 * src/giant-service.ts    // 1200 lines -> error
 * src/large-component.ts  // 600 lines  -> warning
 * src/utils.ts            // 200 lines  -> not detected
 * ```
 */
export const fileTooLargeRule: AntiPatternRule = createHeuristicRule({
  id: 'arch-file-too-large',
  name: 'File Too Large',
  description:
    'Detects files exceeding recommended line counts (>500 warning, >1000 error)',
  severity: 'warning',
  category: 'architecture',
  fileExtensions: ['.ts', '.tsx', '.js', '.jsx'],
  check: (content: string, filePath: string): AntiPatternMatch[] => {
    const lines = content.split('\n');
    const lineCount = lines.length;

    // Error threshold: >1000 lines
    if (lineCount > 1000) {
      return [
        {
          type: 'arch-file-too-large',
          location: { file: filePath },
          metadata: {
            lineCount,
            severity: 'error',
            threshold: 1000,
          },
        },
      ];
    }

    // Warning threshold: >500 lines
    if (lineCount > 500) {
      return [
        {
          type: 'arch-file-too-large',
          location: { file: filePath },
          metadata: {
            lineCount,
            severity: 'warning',
            threshold: 500,
          },
        },
      ];
    }

    return [];
  },
  suggestionTemplate:
    'Split this file into smaller, focused modules. Consider extracting ' +
    'related functionality into separate files based on Single Responsibility Principle.',
});

/**
 * Detects files with excessive import statements.
 *
 * Too many imports can indicate:
 * - High coupling to other modules
 * - Module doing too many things
 * - Missing abstraction layer
 * - Potential circular dependency risk
 *
 * Threshold: >15 imports triggers detection
 *
 * @severity info - May be intentional for aggregation modules
 *
 * @example Detected scenarios:
 * ```typescript
 * // 20 import statements at top of file -> detected
 * import { A } from './a';
 * import { B } from './b';
 * // ... 18 more imports
 *
 * // Index files with many re-exports -> NOT detected (export, not import)
 * export { A } from './a';
 * ```
 */
export const tooManyImportsRule: AntiPatternRule = createHeuristicRule({
  id: 'arch-too-many-imports',
  name: 'Too Many Imports',
  description: 'Detects files with excessive import statements (>15 imports)',
  severity: 'info',
  category: 'architecture',
  fileExtensions: ['.ts', '.tsx', '.js', '.jsx'],
  check: (content: string, filePath: string): AntiPatternMatch[] => {
    // Count lines starting with 'import ' (not 'import type' in some analyses)
    // We count all import statements including type imports
    const importMatches = content.match(/^import\s+/gm) || [];
    const importCount = importMatches.length;

    if (importCount > 15) {
      return [
        {
          type: 'arch-too-many-imports',
          location: { file: filePath },
          metadata: {
            importCount,
            threshold: 15,
          },
        },
      ];
    }

    return [];
  },
  suggestionTemplate:
    'Consider extracting related functionality into a separate module to reduce coupling. ' +
    'Use barrel exports (index.ts) to consolidate related imports.',
});

/**
 * Detects functions that exceed recommended line counts.
 *
 * Large functions are difficult to:
 * - Understand at a glance
 * - Test thoroughly
 * - Maintain over time
 * - Reuse in other contexts
 *
 * Threshold: >50 lines triggers detection
 *
 * Detection approach: Uses regex-based heuristic to find function declarations
 * and counts lines by tracking balanced braces. Note: This is a simplified
 * approach; AST analysis would be more accurate but is heavier.
 *
 * @severity warning - Functions should be focused and concise
 *
 * @example Detected patterns:
 * ```typescript
 * // Detected: function with 60+ lines
 * function processData(input: Data) {
 *   // ... 60 lines of code
 * }
 *
 * // Detected: arrow function with 55+ lines
 * const handler = async (req, res) => {
 *   // ... 55 lines of code
 * };
 *
 * // NOT detected: short function
 * function add(a: number, b: number) {
 *   return a + b;
 * }
 * ```
 */
export const functionTooLargeRule: AntiPatternRule = createHeuristicRule({
  id: 'arch-function-too-large',
  name: 'Function Too Large',
  description: 'Detects functions exceeding 50 lines',
  severity: 'warning',
  category: 'architecture',
  fileExtensions: ['.ts', '.tsx', '.js', '.jsx'],
  check: (content: string, filePath: string): AntiPatternMatch[] => {
    const matches: AntiPatternMatch[] = [];

    // Pattern to match function declarations:
    // - Regular functions: function name(...) or async function name(...)
    // - Arrow functions: const/let/var name = (...) => or const/let/var name = async (...) =>
    // - Method shorthand: name(...) { (in objects/classes)
    const functionPattern =
      /(?:async\s+)?(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>|\w+\s*=>))/g;

    let match: RegExpExecArray | null;
    while ((match = functionPattern.exec(content)) !== null) {
      const startIndex = match.index;

      // Calculate start line number
      const beforeMatch = content.substring(0, startIndex);
      const startLine = (beforeMatch.match(/\n/g) || []).length + 1;

      // Find the opening brace and count until balanced closing brace
      let braceCount = 0;
      let foundStart = false;
      let endIndex = startIndex;

      for (let i = startIndex; i < content.length; i++) {
        const char = content[i];

        if (char === '{') {
          braceCount++;
          foundStart = true;
        } else if (char === '}') {
          braceCount--;

          if (foundStart && braceCount === 0) {
            endIndex = i;
            break;
          }
        }
      }

      // If we found a complete function body
      if (foundStart && braceCount === 0) {
        const functionContent = content.substring(startIndex, endIndex + 1);
        const lineCount = (functionContent.match(/\n/g) || []).length + 1;

        if (lineCount > 50) {
          matches.push({
            type: 'arch-function-too-large',
            location: {
              file: filePath,
              line: startLine,
            },
            matchedText: match[0],
            metadata: {
              lineCount,
              threshold: 50,
            },
          });
        }
      }
    }

    return matches;
  },
  suggestionTemplate:
    'Break this function into smaller, single-responsibility functions. ' +
    'Extract logical blocks into helper functions with descriptive names.',
});

// ============================================
// Exports
// ============================================

/**
 * All architecture anti-pattern detection rules.
 *
 * Import this array to register all architecture rules with the RuleRegistry,
 * or import individual rules for selective registration.
 *
 * @example
 * ```typescript
 * import { architectureRules, RuleRegistry } from './rules';
 *
 * const registry = new RuleRegistry();
 * architectureRules.forEach(rule => registry.registerRule(rule));
 * ```
 */
export const architectureRules: AntiPatternRule[] = [
  fileTooLargeRule,
  tooManyImportsRule,
  functionTooLargeRule,
];
