/**
 * Architecture Anti-Pattern Detection Rules
 *
 * Provides rules for detecting common architectural anti-patterns that
 * can lead to maintainability issues, poor modularity, and technical debt.
 *
 * Rules included:
 * - File too large (>500 lines warning, >1000 lines error)
 * - Too many imports (>15 imports)
 * - Function too large (>50 lines) — AST-backed via tree-sitter
 *
 * functionTooLargeRule uses tree-sitter AST queries rather than brace-counting
 * because brace counters mis-fire on braces inside strings / template literals
 * / regex literals and miscount nested function bodies.
 *
 * @packageDocumentation
 */

import type { AntiPatternRule, AntiPatternMatch } from '@ptah-extension/shared';
import { createHeuristicRule } from './rule-base';
import type {
  TreeSitterParserService,
  QueryMatch,
} from '../../ast/tree-sitter-parser.service';
import type { SupportedLanguage } from '../../ast/tree-sitter.config';
import { EXTENSION_LANGUAGE_MAP } from '../../ast/tree-sitter.config';

// ============================================
// Module-Level Parser Configuration
// ============================================

/**
 * Module-scoped tree-sitter parser used by {@link functionTooLargeRule}.
 *
 * The anti-pattern rule factory (`createHeuristicRule`) does not accept
 * injected dependencies — rules are plain data objects shared by the
 * `RuleRegistry`. To give the rule access to the already-registered DI
 * singleton parser without refactoring the entire rule pipeline, we expose
 * a module-level setter that the library's DI bootstrap calls once at
 * startup. If the setter is never called, the rule returns `[]` with a
 * single one-time warning — the rest of the detection pipeline is
 * unaffected.
 *
 * This is intentionally simple: a setter + a nullable reference. It is
 * strictly a DI-bridge shim, not a general service locator.
 */
let treeSitter: TreeSitterParserService | null = null;
let hasWarnedAboutMissingParser = false;

/**
 * Provides the module-level tree-sitter parser that
 * {@link functionTooLargeRule} uses for AST-backed function-size analysis.
 *
 * Must be called once during library bootstrap, AFTER the
 * `TreeSitterParserService` singleton has been registered in the DI
 * container. Subsequent calls overwrite the previous reference.
 *
 * @param parser - A resolved `TreeSitterParserService` instance.
 *
 * @example
 * ```typescript
 * // In libs/backend/workspace-intelligence/src/di/register.ts:
 * import { configureArchitectureRules } from '../quality/rules/architecture-rules';
 *
 * container.registerSingleton(TOKENS.TREE_SITTER_PARSER_SERVICE, TreeSitterParserService);
 * configureArchitectureRules(container.resolve<TreeSitterParserService>(
 *   TOKENS.TREE_SITTER_PARSER_SERVICE
 * ));
 * ```
 */
export function configureArchitectureRules(
  parser: TreeSitterParserService,
): void {
  treeSitter = parser;
  hasWarnedAboutMissingParser = false;
}

/**
 * Resets the module-level parser reference. Test-only.
 * Exported for unit tests that need to exercise the "no parser configured"
 * code path deterministically.
 * @internal
 */
export function resetArchitectureRulesForTests(): void {
  treeSitter = null;
  hasWarnedAboutMissingParser = false;
}

// ============================================
// Helpers
// ============================================

/**
 * Maps a file path extension to a tree-sitter supported language.
 * Returns `undefined` for extensions we don't have a grammar for.
 */
function languageFromPath(filePath: string): SupportedLanguage | undefined {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) {
    return undefined;
  }
  const ext = filePath.substring(lastDot).toLowerCase();
  return EXTENSION_LANGUAGE_MAP[ext];
}

/**
 * Function-body node types produced by the tree-sitter JS/TS grammars.
 * We select the match capture that represents the outermost function
 * construct so nested functions are counted against their own bodies
 * rather than rolled into their parents.
 */
const FUNCTION_DECLARATION_CAPTURES: ReadonlySet<string> = new Set([
  'function.declaration',
  'generator.declaration',
  'arrow.declaration',
  'arrow_var.declaration',
  'method.declaration',
]);

/**
 * Name captures associated with each declaration capture (for `matchedText`).
 */
const FUNCTION_NAME_CAPTURES: ReadonlySet<string> = new Set([
  'function.name',
  'generator.name',
  'arrow.name',
  'arrow_var.name',
  'method.name',
]);

const FUNCTION_LINE_THRESHOLD = 50;

/**
 * Converts a single tree-sitter `QueryMatch` produced by the function query
 * (see `LANGUAGE_QUERIES_MAP.*.functionQuery`) into an `AntiPatternMatch`
 * if the function body exceeds the line threshold.
 */
function matchToAntiPattern(
  match: QueryMatch,
  filePath: string,
): AntiPatternMatch | null {
  const declarationCapture = match.captures.find((c) =>
    FUNCTION_DECLARATION_CAPTURES.has(c.name),
  );
  if (!declarationCapture) {
    return null;
  }

  // tree-sitter positions are 0-indexed rows; AntiPatternMatch.location.line is 1-indexed.
  const startLine = declarationCapture.startPosition.row + 1;
  const endLine = declarationCapture.endPosition.row + 1;
  const lineCount = endLine - startLine + 1;

  if (lineCount <= FUNCTION_LINE_THRESHOLD) {
    return null;
  }

  const nameCapture = match.captures.find((c) =>
    FUNCTION_NAME_CAPTURES.has(c.name),
  );

  return {
    type: 'arch-function-too-large',
    location: {
      file: filePath,
      line: startLine,
    },
    matchedText: nameCapture?.text ?? declarationCapture.text.slice(0, 80),
    metadata: {
      lineCount,
      threshold: FUNCTION_LINE_THRESHOLD,
    },
  };
}

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
 * Threshold: >50 lines triggers detection.
 *
 * Detection approach: uses tree-sitter AST queries via
 * {@link TreeSitterParserService.queryFunctions} to locate function, method
 * and arrow-function declarations. Function length is measured from the
 * declaration's start row to its end row (inclusive), which is robust to:
 *
 * - Braces inside string / template-literal / regex-literal content
 *   (the previous brace-counting heuristic mis-fired on all three).
 * - Nested functions (each declaration reports its own body size, instead
 *   of the outer function rolling the inner body into its own count).
 *
 * If the module-level parser is not configured (see
 * {@link configureArchitectureRules}) or if tree-sitter analysis fails, the
 * rule logs a single warning and returns an empty array rather than block
 * the rest of the detection pipeline.
 *
 * @severity warning - Functions should be focused and concise
 */
export const functionTooLargeRule: AntiPatternRule = createHeuristicRule({
  id: 'arch-function-too-large',
  name: 'Function Too Large',
  description: 'Detects functions exceeding 50 lines (AST-backed)',
  severity: 'warning',
  category: 'architecture',
  fileExtensions: ['.ts', '.tsx', '.js', '.jsx'],
  check: async (
    content: string,
    filePath: string,
  ): Promise<AntiPatternMatch[]> => {
    const language = languageFromPath(filePath);
    if (!language) {
      return [];
    }

    if (!treeSitter) {
      if (!hasWarnedAboutMissingParser) {
        hasWarnedAboutMissingParser = true;
        console.warn(
          '[arch-function-too-large] TreeSitterParserService is not configured; ' +
            'skipping function-size analysis. Call configureArchitectureRules() ' +
            'during DI bootstrap to enable it.',
        );
      }
      return [];
    }

    const result = await treeSitter.queryFunctions(content, language);
    if (result.isErr()) {
      console.warn(
        `[arch-function-too-large] tree-sitter query failed for ${filePath}:`,
        result.error?.message ?? 'unknown error',
      );
      return [];
    }

    const matches: AntiPatternMatch[] = [];
    for (const queryMatch of result.value ?? []) {
      const antiPattern = matchToAntiPattern(queryMatch, filePath);
      if (antiPattern) {
        matches.push(antiPattern);
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
