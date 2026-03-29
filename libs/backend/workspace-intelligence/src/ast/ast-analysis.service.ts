import { injectable, inject } from 'tsyringe';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import { GenericAstNode, SupportedLanguage } from './ast.types';
import {
  CodeInsights,
  FunctionInfo,
  ClassInfo,
  ImportInfo,
  ExportInfo,
} from './ast-analysis.interfaces';
import {
  TreeSitterParserService,
  QueryMatch,
  QueryCapture,
} from './tree-sitter-parser.service';

/**
 * Node types for JavaScript/TypeScript AST analysis.
 * These correspond to tree-sitter grammar node types.
 */
const AST_NODE_TYPES = {
  // Function declarations
  FUNCTION_DECLARATION: 'function_declaration',
  FUNCTION_EXPRESSION: 'function_expression',
  ARROW_FUNCTION: 'arrow_function',
  METHOD_DEFINITION: 'method_definition',
  GENERATOR_FUNCTION: 'generator_function_declaration',

  // Class declarations
  CLASS_DECLARATION: 'class_declaration',
  CLASS_EXPRESSION: 'class_expression',

  // Import statements
  IMPORT_STATEMENT: 'import_statement',
  IMPORT_CLAUSE: 'import_clause',
  NAMED_IMPORTS: 'named_imports',
  IMPORT_SPECIFIER: 'import_specifier',

  // Export statements
  EXPORT_STATEMENT: 'export_statement',
  EXPORT_CLAUSE: 'export_clause',

  // Identifiers and parameters
  IDENTIFIER: 'identifier',
  FORMAL_PARAMETERS: 'formal_parameters',
  REQUIRED_PARAMETER: 'required_parameter',
  OPTIONAL_PARAMETER: 'optional_parameter',
  REST_PATTERN: 'rest_pattern',
  PROPERTY_IDENTIFIER: 'property_identifier',
  TYPE_IDENTIFIER: 'type_identifier',

  // String types
  STRING: 'string',
  STRING_FRAGMENT: 'string_fragment',

  // Variable declarations (for exported arrow functions)
  VARIABLE_DECLARATION: 'variable_declaration',
  VARIABLE_DECLARATOR: 'variable_declarator',
  LEXICAL_DECLARATION: 'lexical_declaration',
} as const;

/**
 * Service responsible for analyzing Abstract Syntax Tree (AST) data.
 *
 * Extracts structured code insights (functions, classes, imports, exports) from
 * source code using tree-sitter queries (preferred) or GenericAstNode traversal (fallback).
 */
@injectable()
export class AstAnalysisService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.TREE_SITTER_PARSER_SERVICE)
    private readonly parserService: TreeSitterParserService,
  ) {}

  /**
   * Analyzes source code using tree-sitter queries (recommended).
   * This is the preferred method as it uses native tree-sitter pattern matching.
   *
   * @param content The source code content to analyze
   * @param language The language of the source code
   * @param filePath Optional file path for logging
   * @returns A Result containing the extracted CodeInsights on success, or an Error on failure.
   */
  async analyzeSource(
    content: string,
    language: SupportedLanguage,
    filePath?: string,
  ): Promise<Result<CodeInsights, Error>> {
    const logPath = filePath || '<inline>';
    this.logger.debug(
      `AstAnalysisService.analyzeSource() - Analyzing ${logPath} using queries`,
    );

    try {
      // Extract functions using query
      const functionsResult = await this.parserService.queryFunctions(
        content,
        language,
      );
      const functions: FunctionInfo[] = functionsResult.isOk()
        ? this.extractFunctionsFromMatches(functionsResult.value ?? [])
        : [];

      // Extract classes using query
      const classesResult = await this.parserService.queryClasses(
        content,
        language,
      );
      const classes: ClassInfo[] = classesResult.isOk()
        ? this.extractClassesFromMatches(classesResult.value ?? [])
        : [];

      // Extract imports using query
      const importsResult = await this.parserService.queryImports(
        content,
        language,
      );
      const imports: ImportInfo[] = importsResult.isOk()
        ? this.extractImportsFromMatches(importsResult.value ?? [])
        : [];

      // Extract exports using query
      const exportsResult = await this.parserService.queryExports(
        content,
        language,
      );
      const exports: ExportInfo[] = exportsResult.isOk()
        ? this.extractExportsFromMatches(exportsResult.value ?? [])
        : [];

      const insights: CodeInsights = {
        functions,
        classes,
        imports,
        exports: exports.length > 0 ? exports : undefined,
      };

      this.logger.debug(
        `AstAnalysisService.analyzeSource() - Found ${functions.length} functions, ` +
          `${classes.length} classes, ${imports.length} imports, ${exports.length} exports in ${logPath}`,
      );

      return Result.ok(insights);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `AstAnalysisService.analyzeSource() - Failed to analyze ${logPath}: ${errorMessage}`,
      );
      return Result.err(
        new Error(`AST analysis failed for ${logPath}: ${errorMessage}`),
      );
    }
  }

  /**
   * Analyzes the provided AST data for a file (fallback method).
   * Uses manual traversal when source code is not available.
   *
   * @param astData The generic AST node representing the file's structure.
   * @param filePath The path of the file being analyzed.
   * @returns A Result containing the extracted CodeInsights on success, or an Error on failure.
   */
  async analyzeAst(
    astData: GenericAstNode,
    filePath: string,
  ): Promise<Result<CodeInsights, Error>> {
    this.logger.debug(
      `AstAnalysisService.analyzeAst() - Analyzing ${filePath} using traversal`,
    );

    try {
      const functions: FunctionInfo[] = [];
      const classes: ClassInfo[] = [];
      const imports: ImportInfo[] = [];

      // Traverse the AST and extract insights
      this.traverseAst(astData, (node, parent) => {
        // Extract functions
        if (this.isFunctionNode(node)) {
          const funcInfo = this.extractFunctionInfo(node, parent);
          if (funcInfo) {
            functions.push(funcInfo);
          }
        }

        // Extract classes
        if (this.isClassNode(node)) {
          const classInfo = this.extractClassInfo(node);
          if (classInfo) {
            classes.push(classInfo);
          }
        }

        // Extract imports
        if (node.type === AST_NODE_TYPES.IMPORT_STATEMENT) {
          const importInfo = this.extractImportInfo(node);
          if (importInfo) {
            imports.push(importInfo);
          }
        }
      });

      const insights: CodeInsights = {
        functions,
        classes,
        imports,
      };

      this.logger.debug(
        `AstAnalysisService.analyzeAst() - Found ${functions.length} functions, ${classes.length} classes, ${imports.length} imports in ${filePath}`,
      );

      return Result.ok(insights);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `AstAnalysisService.analyzeAst() - Failed to analyze ${filePath}: ${errorMessage}`,
      );
      return Result.err(
        new Error(`AST analysis failed for ${filePath}: ${errorMessage}`),
      );
    }
  }

  // --- Query Result Extraction Methods ---

  /**
   * Extracts FunctionInfo from query matches.
   */
  private extractFunctionsFromMatches(matches: QueryMatch[]): FunctionInfo[] {
    const functions: FunctionInfo[] = [];
    const seen = new Set<string>(); // Track by name+line to avoid duplicates

    for (const match of matches) {
      const captures = new Map<string, QueryCapture>();
      for (const capture of match.captures) {
        captures.set(capture.name, capture);
      }

      // Determine function type and extract name
      let name: string | undefined;
      let params: string[] = [];
      let startLine = 0;
      let endLine = 0;

      // Check different capture patterns
      const nameCapture =
        captures.get('function.name') ||
        captures.get('generator.name') ||
        captures.get('arrow.name') ||
        captures.get('arrow_var.name') ||
        captures.get('method.name');

      const paramsCapture =
        captures.get('function.params') ||
        captures.get('generator.params') ||
        captures.get('arrow.params') ||
        captures.get('arrow_var.params') ||
        captures.get('method.params');

      const declCapture =
        captures.get('function.declaration') ||
        captures.get('generator.declaration') ||
        captures.get('arrow.declaration') ||
        captures.get('arrow_var.declaration') ||
        captures.get('method.declaration');

      if (nameCapture) {
        name = nameCapture.text;
      }

      if (paramsCapture) {
        params = this.extractParamsFromText(paramsCapture.text);
      }

      if (declCapture) {
        startLine = declCapture.startPosition.row;
        endLine = declCapture.endPosition.row;
      }

      if (name) {
        const key = `${name}:${startLine}`;
        if (!seen.has(key)) {
          seen.add(key);
          functions.push({
            name,
            parameters: params,
            startLine,
            endLine,
          });
        }
      }
    }

    return functions;
  }

  /**
   * Extracts ClassInfo from query matches.
   */
  private extractClassesFromMatches(matches: QueryMatch[]): ClassInfo[] {
    const classes: ClassInfo[] = [];
    const seen = new Set<string>();

    for (const match of matches) {
      const captures = new Map<string, QueryCapture>();
      for (const capture of match.captures) {
        captures.set(capture.name, capture);
      }

      const nameCapture =
        captures.get('class.name') || captures.get('class_expr.name');
      const declCapture =
        captures.get('class.declaration') ||
        captures.get('class_expr.declaration');

      if (nameCapture) {
        const name = nameCapture.text;
        const startLine = declCapture?.startPosition.row ?? 0;
        const endLine = declCapture?.endPosition.row ?? 0;

        const key = `${name}:${startLine}`;
        if (!seen.has(key)) {
          seen.add(key);
          classes.push({
            name,
            startLine,
            endLine,
          });
        }
      }
    }

    return classes;
  }

  /**
   * Extracts ImportInfo from query matches.
   */
  private extractImportsFromMatches(matches: QueryMatch[]): ImportInfo[] {
    const imports: ImportInfo[] = [];
    const seen = new Set<string>();

    for (const match of matches) {
      const captures = new Map<string, QueryCapture>();
      for (const capture of match.captures) {
        captures.set(capture.name, capture);
      }

      const sourceCapture = captures.get('import.source');
      if (sourceCapture) {
        // Remove quotes from source
        let source = sourceCapture.text;
        if (
          (source.startsWith('"') && source.endsWith('"')) ||
          (source.startsWith("'") && source.endsWith("'"))
        ) {
          source = source.slice(1, -1);
        }

        // Check for default, named, or namespace imports
        const defaultCapture = captures.get('import.default');
        const namedCapture = captures.get('import.named');
        const namespaceCapture = captures.get('import.namespace');

        const importedSymbols: string[] = [];
        let isDefault = false;
        let isNamespace = false;

        if (defaultCapture) {
          importedSymbols.push(defaultCapture.text);
          isDefault = true;
        }
        if (namedCapture) {
          importedSymbols.push(namedCapture.text);
        }
        if (namespaceCapture) {
          importedSymbols.push(`* as ${namespaceCapture.text}`);
          isNamespace = true;
        }

        // Use source + symbols as key to avoid duplicates
        const key = `${source}:${importedSymbols.join(',')}`;
        if (!seen.has(key)) {
          seen.add(key);
          imports.push({
            source,
            importedSymbols:
              importedSymbols.length > 0 ? importedSymbols : undefined,
            isDefault: isDefault || undefined,
            isNamespace: isNamespace || undefined,
          });
        }
      }
    }

    return imports;
  }

  /**
   * Extracts ExportInfo from query matches.
   */
  private extractExportsFromMatches(matches: QueryMatch[]): ExportInfo[] {
    const exports: ExportInfo[] = [];
    const seen = new Set<string>();

    for (const match of matches) {
      const captures = new Map<string, QueryCapture>();
      for (const capture of match.captures) {
        captures.set(capture.name, capture);
      }

      // Check different export patterns
      const isDefault = captures.has('export.is_default');
      const funcName = captures.get('export.func_name');
      const className = captures.get('export.class_name');
      const varName = captures.get('export.var_name');
      const namedExport = captures.get('export.named');
      const reexportName = captures.get('reexport.name');
      const reexportSource = captures.get('reexport.source');

      let name: string | undefined;
      let kind: ExportInfo['kind'] = 'unknown';
      let isReExport = false;
      let source: string | undefined;

      if (funcName) {
        name = funcName.text;
        kind = 'function';
      } else if (className) {
        name = className.text;
        kind = 'class';
      } else if (varName) {
        name = varName.text;
        kind = 'variable';
      } else if (namedExport) {
        name = namedExport.text;
      } else if (reexportName) {
        name = reexportName.text;
        isReExport = true;
        if (reexportSource) {
          source = reexportSource.text.slice(1, -1); // Remove quotes
        }
      }

      if (name) {
        const key = `${name}:${isDefault}:${source || ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          exports.push({
            name,
            kind,
            isDefault: isDefault || undefined,
            isReExport: isReExport || undefined,
            source,
          });
        }
      }
    }

    return exports;
  }

  /**
   * Extracts parameter names from a formal_parameters text.
   * E.g., "(a, b, c)" -> ["a", "b", "c"]
   */
  private extractParamsFromText(paramsText: string): string[] {
    // Remove parentheses and split by comma
    const inner = paramsText.slice(1, -1).trim();
    if (!inner) return [];

    // Simple extraction - just get identifiers before any type annotations or defaults
    return inner
      .split(',')
      .map((param) => {
        const trimmed = param.trim();
        // Handle rest parameters
        if (trimmed.startsWith('...')) {
          const name = trimmed
            .slice(3)
            .split(/[:\s=]/)[0]
            .trim();
          return `...${name}`;
        }
        // Get identifier before any : or = or ?
        return trimmed.split(/[:\s=?]/)[0].trim();
      })
      .filter(Boolean);
  }

  /**
   * Traverses the AST tree and calls the visitor function for each node.
   */
  private traverseAst(
    node: GenericAstNode,
    visitor: (node: GenericAstNode, parent: GenericAstNode | null) => void,
    parent: GenericAstNode | null = null,
  ): void {
    visitor(node, parent);
    for (const child of node.children) {
      this.traverseAst(child, visitor, node);
    }
  }

  /**
   * Checks if a node represents a function declaration/expression.
   */
  private isFunctionNode(node: GenericAstNode): boolean {
    return (
      [
        AST_NODE_TYPES.FUNCTION_DECLARATION,
        AST_NODE_TYPES.FUNCTION_EXPRESSION,
        AST_NODE_TYPES.ARROW_FUNCTION,
        AST_NODE_TYPES.METHOD_DEFINITION,
        AST_NODE_TYPES.GENERATOR_FUNCTION,
      ] as string[]
    ).includes(node.type);
  }

  /**
   * Checks if a node represents a class declaration/expression.
   */
  private isClassNode(node: GenericAstNode): boolean {
    return (
      [
        AST_NODE_TYPES.CLASS_DECLARATION,
        AST_NODE_TYPES.CLASS_EXPRESSION,
      ] as string[]
    ).includes(node.type);
  }

  /**
   * Extracts function information from a function node.
   */
  private extractFunctionInfo(
    node: GenericAstNode,
    parent: GenericAstNode | null,
  ): FunctionInfo | null {
    let name = '<anonymous>';

    // For function declarations, the name is a direct child
    if (
      node.type === AST_NODE_TYPES.FUNCTION_DECLARATION ||
      node.type === AST_NODE_TYPES.GENERATOR_FUNCTION
    ) {
      const nameNode = this.findChildByType(node, AST_NODE_TYPES.IDENTIFIER);
      if (nameNode) {
        name = nameNode.text;
      }
    }

    // For method definitions, get the property name
    if (node.type === AST_NODE_TYPES.METHOD_DEFINITION) {
      const nameNode =
        this.findChildByType(node, AST_NODE_TYPES.PROPERTY_IDENTIFIER) ||
        this.findChildByType(node, AST_NODE_TYPES.IDENTIFIER);
      if (nameNode) {
        name = nameNode.text;
      }
    }

    // For arrow functions assigned to variables, get the variable name
    if (node.type === AST_NODE_TYPES.ARROW_FUNCTION && parent) {
      if (parent.type === AST_NODE_TYPES.VARIABLE_DECLARATOR) {
        const nameNode = this.findChildByType(
          parent,
          AST_NODE_TYPES.IDENTIFIER,
        );
        if (nameNode) {
          name = nameNode.text;
        }
      }
    }

    // Extract parameters
    const parameters = this.extractParameters(node);

    // Skip anonymous functions unless they have parameters (to reduce noise)
    if (name === '<anonymous>' && parameters.length === 0) {
      return null;
    }

    // Check for async modifier (look for 'async' keyword in text)
    const isAsync = node.text.trimStart().startsWith('async');

    return {
      name,
      parameters,
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      isAsync,
    };
  }

  /**
   * Extracts parameter names from a function node.
   */
  private extractParameters(node: GenericAstNode): string[] {
    const parameters: string[] = [];

    const paramsNode = this.findChildByType(
      node,
      AST_NODE_TYPES.FORMAL_PARAMETERS,
    );
    if (!paramsNode) {
      return parameters;
    }

    for (const child of paramsNode.children) {
      if (
        child.type === AST_NODE_TYPES.IDENTIFIER ||
        child.type === AST_NODE_TYPES.REQUIRED_PARAMETER ||
        child.type === AST_NODE_TYPES.OPTIONAL_PARAMETER
      ) {
        // For simple identifiers, use the text directly
        if (child.type === AST_NODE_TYPES.IDENTIFIER) {
          parameters.push(child.text);
        } else {
          // For required/optional parameters, find the identifier within
          const idNode = this.findChildByType(child, AST_NODE_TYPES.IDENTIFIER);
          if (idNode) {
            parameters.push(idNode.text);
          }
        }
      } else if (child.type === AST_NODE_TYPES.REST_PATTERN) {
        // Rest parameters: ...args
        const idNode = this.findChildByType(child, AST_NODE_TYPES.IDENTIFIER);
        if (idNode) {
          parameters.push(`...${idNode.text}`);
        }
      }
    }

    return parameters;
  }

  /**
   * Extracts class information from a class node.
   */
  private extractClassInfo(node: GenericAstNode): ClassInfo | null {
    let name = '<anonymous>';

    const nameNode =
      this.findChildByType(node, AST_NODE_TYPES.TYPE_IDENTIFIER) ||
      this.findChildByType(node, AST_NODE_TYPES.IDENTIFIER);

    if (nameNode) {
      name = nameNode.text;
    }

    // Skip anonymous classes
    if (name === '<anonymous>') {
      return null;
    }

    // Extract methods from class body
    const methods: FunctionInfo[] = [];
    const classBody = this.findChildByType(node, 'class_body');
    if (classBody) {
      for (const child of classBody.children) {
        if (child.type === AST_NODE_TYPES.METHOD_DEFINITION) {
          const methodInfo = this.extractFunctionInfo(child, classBody);
          if (methodInfo) {
            methods.push(methodInfo);
          }
        }
      }
    }

    return {
      name,
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      methods: methods.length > 0 ? methods : undefined,
    };
  }

  /**
   * Extracts import information from an import statement node.
   */
  private extractImportInfo(node: GenericAstNode): ImportInfo | null {
    // Find the source string (the module path)
    const sourceNode = this.findChildByType(node, AST_NODE_TYPES.STRING);
    if (!sourceNode) {
      return null;
    }

    // Extract the string content (remove quotes)
    let source = sourceNode.text;
    // The text includes quotes, so we need to strip them
    if (
      (source.startsWith('"') && source.endsWith('"')) ||
      (source.startsWith("'") && source.endsWith("'"))
    ) {
      source = source.slice(1, -1);
    }

    // Extract imported symbols
    const importedSymbols: string[] = [];
    let isDefault = false;
    let isNamespace = false;

    const importClause = this.findChildByType(
      node,
      AST_NODE_TYPES.IMPORT_CLAUSE,
    );
    if (importClause) {
      for (const child of importClause.children) {
        // Default import: import X from 'module'
        if (child.type === AST_NODE_TYPES.IDENTIFIER) {
          importedSymbols.push(child.text);
          isDefault = true;
        }
        // Namespace import: import * as X from 'module'
        if (child.type === 'namespace_import') {
          const nameNode = this.findChildByType(
            child,
            AST_NODE_TYPES.IDENTIFIER,
          );
          if (nameNode) {
            importedSymbols.push(`* as ${nameNode.text}`);
            isNamespace = true;
          }
        }
        // Named imports: import { A, B } from 'module'
        if (child.type === AST_NODE_TYPES.NAMED_IMPORTS) {
          for (const specifier of child.children) {
            if (specifier.type === AST_NODE_TYPES.IMPORT_SPECIFIER) {
              const nameNode = this.findChildByType(
                specifier,
                AST_NODE_TYPES.IDENTIFIER,
              );
              if (nameNode) {
                importedSymbols.push(nameNode.text);
              }
            }
          }
        }
      }
    }

    return {
      source,
      importedSymbols: importedSymbols.length > 0 ? importedSymbols : undefined,
      isDefault: isDefault || undefined,
      isNamespace: isNamespace || undefined,
    };
  }

  /**
   * Finds the first child node of a specific type.
   */
  private findChildByType(
    node: GenericAstNode,
    type: string,
  ): GenericAstNode | null {
    for (const child of node.children) {
      if (child.type === type) {
        return child;
      }
    }
    return null;
  }

  /**
   * Finds all child nodes of a specific type (recursive).
   */
  private findAllChildrenByType(
    node: GenericAstNode,
    type: string,
    results: GenericAstNode[] = [],
  ): GenericAstNode[] {
    for (const child of node.children) {
      if (child.type === type) {
        results.push(child);
      }
      this.findAllChildrenByType(child, type, results);
    }
    return results;
  }
}
