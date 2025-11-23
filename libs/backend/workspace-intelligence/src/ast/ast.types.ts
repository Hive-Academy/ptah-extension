/**
 * Represents a position in the source code.
 */
export interface CodePosition {
  row: number;
  column: number;
}

/**
 * Represents a generic node in the Abstract Syntax Tree (AST).
 */
export interface GenericAstNode {
  type: string;
  text: string;
  startPosition: CodePosition;
  endPosition: CodePosition;
  isNamed: boolean;
  fieldName: string | null; // Field name in the parent node
  children: GenericAstNode[];
}

/**
 * Supported languages for AST parsing.
 */
export type SupportedLanguage = 'javascript' | 'typescript';
