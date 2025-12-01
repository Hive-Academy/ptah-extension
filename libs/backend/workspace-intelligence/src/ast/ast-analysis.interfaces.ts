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
   * The name of the exported symbol.
   */
  name: string;
  /**
   * The type of export (function, class, variable, type, interface).
   */
  kind: 'function' | 'class' | 'variable' | 'type' | 'interface' | 'unknown';
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
}

/**
 * Represents the structured code insights extracted from a single file's AST.
 */
export interface CodeInsights {
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
}
