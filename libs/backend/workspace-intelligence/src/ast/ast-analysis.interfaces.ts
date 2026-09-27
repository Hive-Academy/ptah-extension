/**
 * Represents information about a function definition identified in the code.
 */
export interface FunctionInfo {
  /**
   * The name of the function.
   */
  name: string;
  /**
   * An array of parameter names for the function.
   */
  parameters: string[];
  /**
   * The starting line number (0-indexed).
   */
  startLine?: number;
  /**
   * The ending line number (0-indexed).
   */
  endLine?: number;
  /**
   * Whether this function is exported.
   */
  isExported?: boolean;
  /**
   * Whether this is an async function.
   */
  isAsync?: boolean;
}

/**
 * Represents information about a class definition identified in the code.
 */
export interface ClassInfo {
  /**
   * The name of the class.
   */
  name: string;
  /**
   * The starting line number (0-indexed).
   */
  startLine?: number;
  /**
   * The ending line number (0-indexed).
   */
  endLine?: number;
  /**
   * Whether this class is exported.
   */
  isExported?: boolean;
  /**
   * Methods defined in the class.
   */
  methods?: FunctionInfo[];
}

/**
 * Represents information about an import statement identified in the code.
 */
export interface ImportInfo {
  /**
   * The source module or path being imported (e.g., 'react', './utils').
   */
  source: string;
  /**
   * The symbols imported from the module.
   */
  importedSymbols?: string[];
  /**
   * Whether this is a default import.
   */
  isDefault?: boolean;
  /**
   * Whether this is a namespace import (import * as X).
   */
  isNamespace?: boolean;
}

/**
 * Represents information about an export statement identified in the code.
 */
export interface ExportInfo {
  /**
   * The name other modules import. A named declaration keeps its own name even
   * when it is the default export (`export default function f` → `f`); an
   * anonymous or expression default export is `default`; `export { a as b }`
   * is `b`; `export * as ns` is `ns`; a plain `export *` is `*`.
   */
  name: string;
  /**
   * What the export is. `unknown` means the statement names a binding without
   * declaring it (`export { a }`, `export default a`). `namespace` is a TS
   * `namespace` or an `export * as ns`; `wildcard` is a plain `export *`,
   * whose names are resolved in `source`, not here.
   */
  kind:
    | 'function'
    | 'class'
    | 'variable'
    | 'type'
    | 'interface'
    | 'enum'
    | 'namespace'
    | 'wildcard'
    | 'unknown';
  /**
   * Whether this is a default export.
   */
  isDefault?: boolean;
  /**
   * Whether this is a re-export from another module.
   */
  isReExport?: boolean;
  /**
   * The source module if this is a re-export.
   */
  source?: string;
  /**
   * The local (or, for a re-export, the source module's) name when it differs
   * from `name`: `a` for `export { a as b }` and for `export default a`.
   */
  localName?: string;
}

/**
 * Represents the structured code insights extracted from a single file's AST.
 */
export interface ParseQuality {
  /** Unknown is used for legacy ASTs that did not retain parser metadata. */
  parseStatus: 'ok' | 'recovered' | 'unknown';
  /** Saturates at 20; null means the original parse was not observed. */
  errorNodeCount: number | null;
  /** True means the count is a lower bound. */
  errorNodeCountCapped: boolean;
}

export interface CodeInsights extends Partial<ParseQuality> {
  /**
   * An array of identified function definitions.
   */
  functions: FunctionInfo[];
  /**
   * An array of identified class definitions.
   */
  classes: ClassInfo[];
  /**
   * An array of identified import statements.
   */
  imports: ImportInfo[];
  /**
   * An array of identified export statements.
   */
  exports?: ExportInfo[];
  /**
   * Export forms seen but not represented in `exports` (`line N: <source>`),
   * e.g. `exports[key] = v`. Present means `exports` may be incomplete.
   */
  unextractedExports?: string[];
  /**
   * Definitions seen but not represented in `functions` (`line N: <text>`):
   * a C/C++ declarator that names nothing the walker can read. Present means
   * `functions` may be incomplete (Batch 31 r1 R31-02).
   */
  unextractedDeclarations?: string[];
}
