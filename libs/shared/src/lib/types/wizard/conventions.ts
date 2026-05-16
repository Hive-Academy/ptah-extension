/**
 * Setup Wizard code convention types — naming conventions and code style.
 */

// ============================================================================
// Code Conventions Types
// ============================================================================

/**
 * Naming convention pattern type.
 */
export type NamingConvention =
  | 'camelCase'
  | 'PascalCase'
  | 'snake_case'
  | 'SCREAMING_SNAKE_CASE'
  | 'kebab-case'
  | string; // Allow custom conventions

/**
 * Naming convention patterns for code elements.
 *
 * @example
 * ```typescript
 * const naming: NamingConventions = {
 *   files: 'kebab-case',
 *   classes: 'PascalCase',
 *   functions: 'camelCase',
 *   variables: 'camelCase',
 *   constants: 'SCREAMING_SNAKE_CASE',
 *   interfaces: 'PascalCase',
 *   types: 'PascalCase'
 * };
 * ```
 */
export interface NamingConventions {
  /** File naming (kebab-case, camelCase, PascalCase, snake_case). */
  files?: NamingConvention;
  /** Class naming (usually PascalCase). */
  classes?: NamingConvention;
  /** Function naming (usually camelCase). */
  functions?: NamingConvention;
  /** Variable naming (usually camelCase). */
  variables?: NamingConvention;
  /** Constant naming (SCREAMING_SNAKE_CASE, camelCase). */
  constants?: NamingConvention;
  /** Interface naming (PascalCase, IPascalCase). */
  interfaces?: NamingConvention;
  /** Type alias naming (usually PascalCase). */
  types?: NamingConvention;
}

/**
 * Code style conventions detected from project files.
 *
 * Extended version of CodeConventions with additional naming convention
 * detection for comprehensive style guidance.
 *
 * @example
 * ```typescript
 * const conventions: CodeConventions = {
 *   indentation: 'spaces',
 *   indentSize: 2,
 *   quoteStyle: 'single',
 *   semicolons: true,
 *   trailingComma: 'es5',
 *   namingConventions: {
 *     files: 'kebab-case',
 *     classes: 'PascalCase',
 *     functions: 'camelCase',
 *     variables: 'camelCase',
 *     constants: 'SCREAMING_SNAKE_CASE'
 *   },
 *   maxLineLength: 100,
 *   usePrettier: true,
 *   useEslint: true
 * };
 * ```
 */
export interface CodeConventions {
  /** Indentation style: tabs or spaces. */
  indentation: 'tabs' | 'spaces';
  /** Number of spaces per indentation level (if using spaces). Common: 2, 4. */
  indentSize: number;
  /** Quote style preference: single or double quotes. */
  quoteStyle: 'single' | 'double';
  /** Whether to use semicolons at end of statements. */
  semicolons: boolean;
  /**
   * Trailing comma style in multi-line structures.
   * - 'none': No trailing commas
   * - 'es5': Trailing commas in ES5-compatible positions (arrays, objects)
   * - 'all': Trailing commas everywhere possible (including function parameters)
   */
  trailingComma: 'none' | 'es5' | 'all';
  /** Naming conventions for different code elements. */
  namingConventions?: NamingConventions;
  /** Maximum line length preference. */
  maxLineLength?: number;
  /** Whether the project uses Prettier. */
  usePrettier?: boolean;
  /** Whether the project uses ESLint. */
  useEslint?: boolean;
  /** Additional style tools detected (e.g., 'stylelint', 'biome', 'rome'). */
  additionalTools?: string[];
}
