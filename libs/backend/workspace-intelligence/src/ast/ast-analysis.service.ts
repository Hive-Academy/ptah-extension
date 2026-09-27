import { injectable, inject } from 'tsyringe';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import { CodePosition, GenericAstNode, SupportedLanguage } from './ast.types';
import {
  CodeInsights,
  FunctionInfo,
  ClassInfo,
  ImportInfo,
  DeclarationInfo,
} from './ast-analysis.interfaces';
import {
  TreeSitterParserService,
  QueryMatch,
  QueryCapture,
} from './tree-sitter-parser.service';
import { LANGUAGE_QUERIES_MAP } from './tree-sitter.config';
import { extractExportsFromMatches } from './export-extraction';
import { LANGUAGE_MODULES } from './languages';
import type { LanguageExtraction } from './languages/types';

/** `@declaration.<kind>` or `@declaration.<kind>.file` (`languages/types.ts`). */
const DECLARATION_CAPTURE =
  /^declaration\.(package|namespace|module)(\.file)?$/;

/** A declaration with the exact range scope containment is computed on. */
interface ScopedDeclaration {
  readonly kind: DeclarationInfo['kind'];
  /** The name as written in this declaration. */
  readonly ownName: string;
  /** The full name inside the file (enclosing names joined). */
  readonly name: string;
  readonly start: CodePosition;
  readonly end: CodePosition;
}

function comparePositions(a: CodePosition, b: CodePosition): number {
  return a.row - b.row || a.column - b.column;
}

function encloses(outer: ScopedDeclaration, position: CodePosition): boolean {
  return (
    comparePositions(outer.start, position) <= 0 &&
    comparePositions(position, outer.end) <= 0
  );
}

/** The position just past the last character of `content`. */
function endOfContent(content: string): CodePosition {
  const lines = content.split('\n');
  return { row: lines.length - 1, column: lines[lines.length - 1].length };
}

/**
 * Node types for JavaScript/TypeScript AST analysis.
 * These correspond to tree-sitter grammar node types.
 */
const AST_NODE_TYPES = {
  FUNCTION_DECLARATION: 'function_declaration',
  FUNCTION_EXPRESSION: 'function_expression',
  ARROW_FUNCTION: 'arrow_function',
  METHOD_DEFINITION: 'method_definition',
  GENERATOR_FUNCTION: 'generator_function_declaration',
  CLASS_DECLARATION: 'class_declaration',
  CLASS_EXPRESSION: 'class_expression',
  IMPORT_STATEMENT: 'import_statement',
  IMPORT_CLAUSE: 'import_clause',
  NAMED_IMPORTS: 'named_imports',
  IMPORT_SPECIFIER: 'import_specifier',
  EXPORT_STATEMENT: 'export_statement',
  EXPORT_CLAUSE: 'export_clause',
  IDENTIFIER: 'identifier',
  FORMAL_PARAMETERS: 'formal_parameters',
  REQUIRED_PARAMETER: 'required_parameter',
  OPTIONAL_PARAMETER: 'optional_parameter',
  REST_PATTERN: 'rest_pattern',
  PROPERTY_IDENTIFIER: 'property_identifier',
  TYPE_IDENTIFIER: 'type_identifier',
  STRING: 'string',
  STRING_FRAGMENT: 'string_fragment',
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

    try {
      const langQueries = LANGUAGE_QUERIES_MAP[language];
      const extraction = LANGUAGE_MODULES[language].extraction;
      const queryEntries = [
        { key: 'functions', queryString: langQueries.functionQuery },
        { key: 'classes', queryString: langQueries.classQuery },
        { key: 'imports', queryString: langQueries.importQuery },
        { key: 'exports', queryString: langQueries.exportQuery },
        // Batch 32a: an extra entry of the same parse, not a second parse.
        {
          key: 'declarations',
          queryString: extraction?.declarations?.query,
        },
      ].filter(
        (e): e is { key: string; queryString: string } => !!e.queryString,
      );
      const multiResult = await this.parserService.queryMulti(
        content,
        language,
        queryEntries,
      );

      if (multiResult.isErr()) {
        const errorMessage =
          multiResult.error?.message ?? 'queryMulti returned an unknown error';
        this.logger.error(
          `AstAnalysisService.analyzeSource() - queryMulti failed for ${logPath}: ${errorMessage}`,
        );
        // `cause` keeps a parser refusal readable (`parserFailureReason`).
        return Result.err(
          new Error(`AST analysis failed for ${logPath}: ${errorMessage}`, {
            cause: multiResult.error,
          }),
        );
      }

      const map = multiResult.value;
      if (!map) {
        return Result.err(
          new Error('queryMulti returned null value unexpectedly'),
        );
      }
      const functions: FunctionInfo[] = this.extractFunctionsFromMatches(
        map.get('functions') ?? [],
      );
      const classes: ClassInfo[] = this.extractClassesFromMatches(
        map.get('classes') ?? [],
      );
      const scopes = extraction?.declarations
        ? this.extractDeclarationsFromMatches(
            map.get('declarations') ?? [],
            extraction.declarations.scopeSeparator,
            endOfContent(content),
          )
        : [];
      const imports: ImportInfo[] = extraction
        ? this.extractContractImports(
            map.get('imports') ?? [],
            extraction,
            scopes,
          )
        : this.extractImportsFromMatches(map.get('imports') ?? []);
      const { exports, unextracted } = extractExportsFromMatches(
        map.get('exports') ?? [],
      );

      const insights: CodeInsights = {
        parseStatus: map.parseStatus ?? 'unknown',
        errorNodeCount: map.errorNodeCount ?? null,
        errorNodeCountCapped: map.errorNodeCountCapped ?? false,
        functions,
        classes,
        imports,
        exports: exports.length > 0 ? exports : undefined,
        ...(unextracted.length > 0 ? { unextractedExports: unextracted } : {}),
        ...(extraction?.declarations
          ? {
              declarations: scopes.map(
                ({ kind, name, start, end }): DeclarationInfo => ({
                  kind,
                  name,
                  startLine: start.row,
                  endLine: end.row,
                }),
              ),
            }
          : {}),
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
  analyzeAst(
    astData: GenericAstNode,
    filePath: string,
  ): Result<CodeInsights, Error> {
    try {
      const functions: FunctionInfo[] = [];
      const classes: ClassInfo[] = [];
      const imports: ImportInfo[] = [];
      this.traverseAst(astData, (node, parent) => {
        if (this.isFunctionNode(node)) {
          const funcInfo = this.extractFunctionInfo(node, parent);
          if (funcInfo) {
            functions.push(funcInfo);
          }
        }
        if (this.isClassNode(node)) {
          const classInfo = this.extractClassInfo(node);
          if (classInfo) {
            classes.push(classInfo);
          }
        }
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
      let name: string | undefined;
      let params: string[] = [];
      let startLine = 0;
      let endLine = 0;
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
        let source = sourceCapture.text;
        if (
          (source.startsWith('"') && source.endsWith('"')) ||
          (source.startsWith("'") && source.endsWith("'"))
        ) {
          source = source.slice(1, -1);
        }
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
   * Batch 32a declarations: decodes `@declaration.*` matches, extends a
   * file-scoped declaration to `fileEnd`, and joins each declaration's name
   * onto the names of the declarations whose range contains it. Returned in
   * source order (outer before inner at the same start).
   */
  private extractDeclarationsFromMatches(
    matches: QueryMatch[],
    scopeSeparator: string,
    fileEnd: CodePosition,
  ): ScopedDeclaration[] {
    const raw: Omit<ScopedDeclaration, 'name'>[] = [];
    for (const match of matches) {
      const nameCapture = match.captures.find(
        (c) => c.name === 'declaration.name',
      );
      let declaring: RegExpExecArray | null = null;
      let node: QueryCapture | undefined;
      for (const capture of match.captures) {
        const parsed = DECLARATION_CAPTURE.exec(capture.name);
        if (parsed) {
          declaring = parsed;
          node = capture;
        }
      }
      if (!nameCapture || !declaring || !node) continue;
      raw.push({
        kind: declaring[1] as DeclarationInfo['kind'],
        ownName: nameCapture.text,
        start: node.startPosition,
        end: declaring[2] ? fileEnd : node.endPosition,
      });
    }
    raw.sort(
      (a, b) =>
        comparePositions(a.start, b.start) || comparePositions(b.end, a.end),
    );

    const scoped: ScopedDeclaration[] = [];
    for (const declaration of raw) {
      // Every earlier declaration that still contains this one is an
      // ancestor; the last of them is the nearest (source order).
      const parent = [...scoped]
        .reverse()
        .find(
          (outer) =>
            encloses(outer, declaration.start) &&
            encloses(outer, declaration.end),
        );
      scoped.push({
        ...declaration,
        name: parent
          ? `${parent.name}${scopeSeparator}${declaration.ownName}`
          : declaration.ownName,
      });
    }
    return scoped;
  }

  /**
   * Batch 32a imports: each distinct `@import.statement` node is decoded once
   * by the language, in source order, and every import it yields gets the
   * statement's line and the names of the declarations enclosing it.
   */
  private extractContractImports(
    matches: QueryMatch[],
    extraction: LanguageExtraction,
    scopes: readonly ScopedDeclaration[],
  ): ImportInfo[] {
    const statements = new Map<string, GenericAstNode>();
    for (const match of matches) {
      for (const capture of match.captures) {
        if (capture.name !== 'import.statement') continue;
        const { row, column } = capture.startPosition;
        statements.set(`${row}:${column}`, capture.node);
      }
    }

    const imports: ImportInfo[] = [];
    const ordered = [...statements.values()].sort((a, b) =>
      comparePositions(a.startPosition, b.startPosition),
    );
    for (const statement of ordered) {
      const scopePath = scopes
        .filter((scope) => encloses(scope, statement.startPosition))
        .map((scope) => scope.ownName);
      for (const extracted of extraction.extractImports(statement)) {
        imports.push({
          ...extracted,
          line: statement.startPosition.row,
          scopePath: [...scopePath],
        });
      }
    }
    return imports;
  }

  /**
   * Extracts parameter names from a formal_parameters text.
   * E.g., "(a, b, c)" -> ["a", "b", "c"]
   */
  private extractParamsFromText(paramsText: string): string[] {
    const inner = paramsText.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(',')
      .map((param) => {
        const trimmed = param.trim();
        if (trimmed.startsWith('...')) {
          const name = trimmed
            .slice(3)
            .split(/[:\s=]/)[0]
            .trim();
          return `...${name}`;
        }
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
    if (
      node.type === AST_NODE_TYPES.FUNCTION_DECLARATION ||
      node.type === AST_NODE_TYPES.GENERATOR_FUNCTION
    ) {
      const nameNode = this.findChildByType(node, AST_NODE_TYPES.IDENTIFIER);
      if (nameNode) {
        name = nameNode.text;
      }
    }
    if (node.type === AST_NODE_TYPES.METHOD_DEFINITION) {
      const nameNode =
        this.findChildByType(node, AST_NODE_TYPES.PROPERTY_IDENTIFIER) ||
        this.findChildByType(node, AST_NODE_TYPES.IDENTIFIER);
      if (nameNode) {
        name = nameNode.text;
      }
    }
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
    const parameters = this.extractParameters(node);
    if (name === '<anonymous>' && parameters.length === 0) {
      return null;
    }
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
        if (child.type === AST_NODE_TYPES.IDENTIFIER) {
          parameters.push(child.text);
        } else {
          const idNode = this.findChildByType(child, AST_NODE_TYPES.IDENTIFIER);
          if (idNode) {
            parameters.push(idNode.text);
          }
        }
      } else if (child.type === AST_NODE_TYPES.REST_PATTERN) {
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
    if (name === '<anonymous>') {
      return null;
    }
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
    const sourceNode = this.findChildByType(node, AST_NODE_TYPES.STRING);
    if (!sourceNode) {
      return null;
    }
    let source = sourceNode.text;
    if (
      (source.startsWith('"') && source.endsWith('"')) ||
      (source.startsWith("'") && source.endsWith("'"))
    ) {
      source = source.slice(1, -1);
    }
    const importedSymbols: string[] = [];
    let isDefault = false;
    let isNamespace = false;

    const importClause = this.findChildByType(
      node,
      AST_NODE_TYPES.IMPORT_CLAUSE,
    );
    if (importClause) {
      for (const child of importClause.children) {
        if (child.type === AST_NODE_TYPES.IDENTIFIER) {
          importedSymbols.push(child.text);
          isDefault = true;
        }
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
