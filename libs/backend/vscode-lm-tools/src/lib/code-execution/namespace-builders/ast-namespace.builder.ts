/**
 * AST Namespace Builder
 *
 * Provides code structure analysis using tree-sitter parsing.
 * Exposes functions, classes, imports, exports extraction.
 */

import * as vscode from 'vscode';
import {
  TreeSitterParserService,
  AstAnalysisService,
  EXTENSION_LANGUAGE_MAP,
  type SupportedLanguage,
  type GenericAstNode,
  type QueryMatch,
  type QueryCapture,
} from '@ptah-extension/workspace-intelligence';
import { FileSystemManager } from '@ptah-extension/vscode-core';
import {
  AstNamespace,
  AstCodeInsights,
  AstParseResult,
  AstNode,
  AstFunctionInfo,
  AstClassInfo,
  AstImportInfo,
  AstExportInfo,
} from '../types';

/**
 * Dependencies required for AST namespace
 */
export interface AstNamespaceDependencies {
  treeSitterParser: TreeSitterParserService;
  astAnalysis: AstAnalysisService;
  fileSystemManager: FileSystemManager;
}

/**
 * Build AST analysis namespace
 */
export function buildAstNamespace(
  deps: AstNamespaceDependencies
): AstNamespace {
  const { treeSitterParser, astAnalysis, fileSystemManager } = deps;

  return {
    analyze: async (filePath: string): Promise<AstCodeInsights> => {
      const { content, language, absolutePath } = await readFileForAst(
        filePath,
        fileSystemManager
      );

      const result = astAnalysis.analyzeSource(content, language, absolutePath);

      if (result.isErr()) {
        throw new Error(result.error?.message ?? 'AST analysis failed');
      }

      const insights = result.value ?? { functions: [], classes: [], imports: [], exports: [] };
      return {
        file: filePath,
        language,
        functions: insights.functions as AstFunctionInfo[],
        classes: insights.classes as AstClassInfo[],
        imports: insights.imports as AstImportInfo[],
        exports: (insights.exports || []) as AstExportInfo[],
      };
    },

    parse: async (filePath: string, maxDepth = 10): Promise<AstParseResult> => {
      const { content, language } = await readFileForAst(
        filePath,
        fileSystemManager
      );

      const result = treeSitterParser.parse(content, language);

      if (result.isErr()) {
        throw new Error(result.error?.message ?? 'AST parsing failed');
      }

      const ast = result.value;
      if (!ast) {
        throw new Error('AST parsing returned no result');
      }
      const { node: simplifiedAst, count } = simplifyAstNode(ast, 0, maxDepth);

      return {
        file: filePath,
        language,
        ast: simplifiedAst,
        nodeCount: count,
      };
    },

    queryFunctions: async (filePath: string): Promise<AstFunctionInfo[]> => {
      const { content, language } = await readFileForAst(
        filePath,
        fileSystemManager
      );

      const result = treeSitterParser.queryFunctions(content, language);

      if (result.isErr()) {
        throw new Error(result.error?.message ?? 'Function query failed');
      }

      return extractFunctionsFromMatches(result.value ?? []);
    },

    queryClasses: async (filePath: string): Promise<AstClassInfo[]> => {
      const { content, language } = await readFileForAst(
        filePath,
        fileSystemManager
      );

      const result = treeSitterParser.queryClasses(content, language);

      if (result.isErr()) {
        throw new Error(result.error?.message ?? 'Class query failed');
      }

      return extractClassesFromMatches(result.value ?? []);
    },

    queryImports: async (filePath: string): Promise<AstImportInfo[]> => {
      const { content, language } = await readFileForAst(
        filePath,
        fileSystemManager
      );

      const result = treeSitterParser.queryImports(content, language);

      if (result.isErr()) {
        throw new Error(result.error?.message ?? 'Import query failed');
      }

      return extractImportsFromMatches(result.value ?? []);
    },

    queryExports: async (filePath: string): Promise<AstExportInfo[]> => {
      const { content, language } = await readFileForAst(
        filePath,
        fileSystemManager
      );

      const result = treeSitterParser.queryExports(content, language);

      if (result.isErr()) {
        throw new Error(result.error?.message ?? 'Export query failed');
      }

      return extractExportsFromMatches(result.value ?? []);
    },

    getSupportedLanguages: (): string[] => {
      return Object.values(EXTENSION_LANGUAGE_MAP).filter(
        (v, i, a) => a.indexOf(v) === i
      );
    },
  };
}

// ========================================
// Helper Functions
// ========================================

/**
 * Read a file and detect its language for AST parsing
 */
async function readFileForAst(
  filePath: string,
  fileSystemManager: FileSystemManager
): Promise<{
  content: string;
  language: SupportedLanguage;
  absolutePath: string;
}> {
  const absolutePath = resolveFilePath(filePath);
  const uri = vscode.Uri.file(absolutePath);

  const contentBytes = await fileSystemManager.readFile(uri);
  const content = new TextDecoder('utf-8').decode(contentBytes);

  const ext = absolutePath.substring(absolutePath.lastIndexOf('.'));
  const language = EXTENSION_LANGUAGE_MAP[ext.toLowerCase()];

  if (!language) {
    throw new Error(
      `Unsupported file type: ${ext}. Supported: ${Object.keys(
        EXTENSION_LANGUAGE_MAP
      ).join(', ')}`
    );
  }

  return { content, language, absolutePath };
}

/**
 * Resolve file path to absolute path
 */
function resolveFilePath(filePath: string): string {
  if (
    filePath.startsWith('/') ||
    /^[A-Za-z]:/.test(filePath) ||
    filePath.startsWith('\\\\')
  ) {
    return filePath;
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    throw new Error('No workspace folder open');
  }

  return vscode.Uri.joinPath(workspaceFolder.uri, filePath).fsPath;
}

/**
 * Simplify GenericAstNode to AstNode for JSON serialization
 */
function simplifyAstNode(
  node: GenericAstNode,
  depth: number,
  maxDepth: number
): { node: AstNode; count: number } {
  let count = 1;

  const text =
    node.text.length > 100 ? node.text.substring(0, 100) + '...' : node.text;

  const simplified: AstNode = {
    type: node.type,
    text: text !== node.type ? text : undefined,
    start: {
      line: node.startPosition.row,
      column: node.startPosition.column,
    },
    end: { line: node.endPosition.row, column: node.endPosition.column },
  };

  if (depth < maxDepth && node.children.length > 0) {
    simplified.children = [];
    for (const child of node.children) {
      const { node: childNode, count: childCount } = simplifyAstNode(
        child,
        depth + 1,
        maxDepth
      );
      simplified.children.push(childNode);
      count += childCount;
    }
  }

  return { node: simplified, count };
}

/**
 * Extract function info from tree-sitter query matches
 */
function extractFunctionsFromMatches(matches: QueryMatch[]): AstFunctionInfo[] {
  const functions: AstFunctionInfo[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const captures = new Map<string, QueryCapture>();
    for (const capture of match.captures) {
      captures.set(capture.name, capture);
    }

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
      const name = nameCapture.text;
      const startLine = declCapture?.startPosition?.row ?? 0;
      const key = `${name}:${startLine}`;

      if (!seen.has(key)) {
        seen.add(key);
        functions.push({
          name,
          parameters: paramsCapture
            ? extractParamsFromText(paramsCapture.text)
            : [],
          startLine,
          endLine: declCapture?.endPosition?.row,
        });
      }
    }
  }

  return functions;
}

/**
 * Extract class info from tree-sitter query matches
 */
function extractClassesFromMatches(matches: QueryMatch[]): AstClassInfo[] {
  const classes: AstClassInfo[] = [];
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
      const startLine = declCapture?.startPosition?.row ?? 0;
      const key = `${name}:${startLine}`;

      if (!seen.has(key)) {
        seen.add(key);
        classes.push({
          name,
          startLine,
          endLine: declCapture?.endPosition?.row,
        });
      }
    }
  }

  return classes;
}

/**
 * Extract import info from tree-sitter query matches
 */
function extractImportsFromMatches(matches: QueryMatch[]): AstImportInfo[] {
  const imports: AstImportInfo[] = [];
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
 * Extract export info from tree-sitter query matches
 */
function extractExportsFromMatches(matches: QueryMatch[]): AstExportInfo[] {
  const exports: AstExportInfo[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const captures = new Map<string, QueryCapture>();
    for (const capture of match.captures) {
      captures.set(capture.name, capture);
    }

    const isDefault = captures.has('export.is_default');
    const funcName = captures.get('export.func_name');
    const className = captures.get('export.class_name');
    const varName = captures.get('export.var_name');
    const namedExport = captures.get('export.named');
    const reexportName = captures.get('reexport.name');
    const reexportSource = captures.get('reexport.source');

    let name: string | undefined;
    let kind: AstExportInfo['kind'] = 'unknown';
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
        source = reexportSource.text.slice(1, -1);
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
 * Extract parameter names from formal_parameters text
 */
function extractParamsFromText(paramsText: string): string[] {
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
