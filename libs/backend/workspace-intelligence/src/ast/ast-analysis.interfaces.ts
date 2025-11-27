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
  // Optional fields (add TSDoc if uncommented in future):
  // startLine?: number;
  // endLine?: number;
}

/**
 * Represents information about a class definition identified in the code.
 */
export interface ClassInfo {
  /**
   * The name of the class.
   */
  name: string;
  // Optional fields (add TSDoc if uncommented in future):
  // methods?: FunctionInfo[];
  // properties?: string[];
  // startLine?: number;
  // endLine?: number;
}

/**
 * Represents information about an import statement identified in the code.
 */
export interface ImportInfo {
  /**
   * The source module or path being imported (e.g., 'react', './utils').
   */
  source: string;
  // Optional fields (add TSDoc if uncommented in future):
  // importedSymbols?: string[];
  // isDefault?: boolean;
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
  // Future potential insights can be added here.
}
