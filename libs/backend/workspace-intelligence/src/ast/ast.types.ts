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
  /**
   * Set only on a `parse` result bounded for transport from the tree-sitter
   * worker: `text` was cut to `MAX_TRANSPORT_NODE_TEXT_CHARS`.
   */
  textTruncated?: true;
  /** Set only on a bounded `parse` result: some children were left out. */
  childrenTruncated?: true;
}

/**
 * Supported languages for AST parsing.
 */
export type SupportedLanguage =
  | 'javascript'
  | 'typescript'
  | 'tsx'
  | 'python'
  | 'go'
  | 'csharp'
  | 'java'
  | 'rust'
  | 'php'
  | 'ruby'
  | 'cpp'
  | 'kotlin';
