/**
 * AST Namespace Builder
 *
 * Provides code structure analysis using tree-sitter parsing.
 * Exposes functions, classes, imports, exports extraction.
 */

import * as path from 'path';
import {
  TreeSitterParserService,
  AstAnalysisService,
  EXTENSION_LANGUAGE_MAP,
  LANGUAGE_QUERIES_MAP,
  classifyFileForCoverage,
  extractExportsFromMatches,
  hasCapability,
  languageForExtension,
  supportedLanguagesFor,
  type SupportedLanguage,
  type GenericAstNode,
  type ParseQuality,
  type QueryMatch,
  type QueryCapture,
} from '@ptah-extension/workspace-intelligence';
import {
  FileType,
  compactCoverage,
  withCoverageVerdict,
} from '@ptah-extension/platform-core';
import type {
  IFileSystemProvider,
  IWorkspaceProvider,
  LanguageCoverage,
} from '@ptah-extension/platform-core';
import {
  AstNamespace,
  AstCodeInsights,
  AstParseHonesty,
  AstParseResult,
  AstNode,
  AstFunctionInfo,
  AstFunctionsResult,
  AstClassInfo,
  AstClassesResult,
  AstImportInfo,
  AstImportsResult,
  AstExportInfo,
} from '../types';

/**
 * Dependencies required for AST namespace
 */
export interface AstNamespaceDependencies {
  treeSitterParser: TreeSitterParserService;
  astAnalysis: AstAnalysisService;
  fileSystemProvider: IFileSystemProvider;
  workspaceProvider: IWorkspaceProvider;
}

/**
 * Build AST analysis namespace
 */
export function buildAstNamespace(
  deps: AstNamespaceDependencies,
): AstNamespace {
  const {
    treeSitterParser,
    astAnalysis,
    fileSystemProvider,
    workspaceProvider,
  } = deps;

  return {
    analyze: async (
      filePath: string,
      workspaceRoot?: string,
    ): Promise<AstCodeInsights> => {
      const { content, language, absolutePath } = await readFileForAst(
        filePath,
        fileSystemProvider,
        workspaceProvider,
        workspaceRoot,
      );

      const result = await astAnalysis.analyzeSource(
        content,
        language,
        absolutePath,
      );

      if (result.isErr()) {
        throw new Error(result.error?.message ?? 'AST analysis failed');
      }

      const insights = result.value ?? {
        functions: [],
        classes: [],
        imports: [],
        exports: [],
      };
      const unextractedExports = result.value?.unextractedExports ?? [];
      return {
        ...parseHonesty(absolutePath, insights, unextractedExports.length > 0),
        ...(unextractedExports.length > 0 ? { unextractedExports } : {}),
        file: filePath,
        language,
        functions: insights.functions as AstFunctionInfo[],
        classes: insights.classes as AstClassInfo[],
        imports: insights.imports as AstImportInfo[],
        exports: (insights.exports || []) as AstExportInfo[],
      };
    },

    parse: async (filePath: string, maxDepth = 10): Promise<AstParseResult> => {
      const { content, language, absolutePath } = await readFileForAst(
        filePath,
        fileSystemProvider,
        workspaceProvider,
      );

      const result = await treeSitterParser.parse(content, language);

      if (result.isErr()) {
        throw new Error(result.error?.message ?? 'AST parsing failed');
      }

      const ast = result.value;
      if (!ast) {
        throw new Error('AST parsing returned no result');
      }
      // The generic tree drops tree-sitter's MISSING flag, so its quality is
      // read from a parse that keeps it (no query runs on that parse).
      const { quality } = await queryWithQuality(
        treeSitterParser,
        content,
        language,
        '',
        'AST parsing failed',
      );
      const { node: simplifiedAst, count } = simplifyAstNode(ast, 0, maxDepth);

      return {
        ...parseHonesty(absolutePath, quality),
        file: filePath,
        language,
        ast: simplifiedAst,
        nodeCount: count,
      };
    },

    queryFunctions: async (filePath: string): Promise<AstFunctionsResult> => {
      const { content, language, absolutePath } = await readFileForAst(
        filePath,
        fileSystemProvider,
        workspaceProvider,
      );

      const { quality, matches } = await queryWithQuality(
        treeSitterParser,
        content,
        language,
        LANGUAGE_QUERIES_MAP[language].functionQuery,
        'Function query failed',
      );

      return {
        ...parseHonesty(absolutePath, quality),
        file: filePath,
        language,
        functions: extractFunctionsFromMatches(matches),
      };
    },

    queryClasses: async (filePath: string): Promise<AstClassesResult> => {
      const { content, language, absolutePath } = await readFileForAst(
        filePath,
        fileSystemProvider,
        workspaceProvider,
      );

      const { quality, matches } = await queryWithQuality(
        treeSitterParser,
        content,
        language,
        LANGUAGE_QUERIES_MAP[language].classQuery,
        'Class query failed',
      );

      return {
        ...parseHonesty(absolutePath, quality),
        file: filePath,
        language,
        classes: extractClassesFromMatches(matches),
      };
    },

    queryImports: async (filePath: string): Promise<AstImportsResult> => {
      const { content, language, absolutePath } = await readFileForAst(
        filePath,
        fileSystemProvider,
        workspaceProvider,
      );

      const { quality, matches } = await queryWithQuality(
        treeSitterParser,
        content,
        language,
        LANGUAGE_QUERIES_MAP[language].importQuery,
        'Import query failed',
      );

      return {
        ...parseHonesty(absolutePath, quality),
        file: filePath,
        language,
        imports: extractImportsFromMatches(matches),
      };
    },

    queryExports: async (filePath: string): Promise<AstExportInfo[]> => {
      const { content, language } = await readFileForAst(
        filePath,
        fileSystemProvider,
        workspaceProvider,
      );

      if (!hasCapability(language, 'publicSymbols')) {
        throw new Error(
          `${JSON.stringify({ coverage: compactCoverage(fileCoverage(filePath, 'publicSymbols', 'unknown')) })} ` +
            `Export query unsupported for ${language}. Supported: ${supportedLanguagesFor('publicSymbols').join(', ')}`,
        );
      }

      const result = await treeSitterParser.queryExports(content, language);

      if (result.isErr()) {
        throw new Error(result.error?.message ?? 'Export query failed');
      }

      const { exports, unextracted } = extractExportsFromMatches(
        result.value ?? [],
        { fileName: filePath },
      );
      if (unextracted.length > 0) {
        // A bare array has no room for the disclosure, so a partial
        // extraction is refused rather than returned as if complete.
        throw new Error(
          `${JSON.stringify({ coverage: compactCoverage(fileCoverage(filePath, 'publicSymbols', 'ok', true)) })} ` +
            `Export extraction is partial for ${filePath}: ${exports.length} export(s) read, ` +
            `these forms could not be read: ${unextracted.join('; ')}. ` +
            'Use ptah.ast.analyze(file) for the known exports with this disclosure.',
        );
      }
      return exports;
    },

    getSupportedLanguages: (): string[] => {
      return Object.values(EXTENSION_LANGUAGE_MAP).filter(
        (v, i, a) => a.indexOf(v) === i,
      );
    },
  };
}

const QUERY_KEY = 'matches';

/**
 * Run one query over ONE parse that also reports the parse quality
 * (`queryMulti`), so the matches and the quality describe the same tree. An
 * empty `queryString` (a language without that query) runs no query and
 * still reports the quality.
 */
async function queryWithQuality(
  treeSitterParser: TreeSitterParserService,
  content: string,
  language: SupportedLanguage,
  queryString: string,
  failureMessage: string,
): Promise<{ quality: Partial<ParseQuality>; matches: QueryMatch[] }> {
  const result = await treeSitterParser.queryMulti(
    content,
    language,
    queryString ? [{ key: QUERY_KEY, queryString }] : [],
  );
  if (result.isErr()) {
    throw new Error(result.error?.message ?? failureMessage);
  }
  const results = result.value;
  return {
    quality: results ?? {},
    matches: results?.get(QUERY_KEY) ?? [],
  };
}

/**
 * The parse honesty fields every parsing operation leads with. Missing parser
 * metadata is `unknown`, never `ok`, so it cannot read as a clean parse.
 */
function parseHonesty(
  absolutePath: string,
  quality: Partial<ParseQuality>,
  hasUnextractedExports = false,
): AstParseHonesty {
  const parseStatus = quality.parseStatus ?? 'unknown';
  return {
    parseStatus,
    errorNodeCount: quality.errorNodeCount ?? null,
    errorNodeCountCapped: quality.errorNodeCountCapped ?? false,
    coverage: fileCoverage(
      absolutePath,
      'parse',
      parseStatus,
      hasUnextractedExports,
    ),
  };
}

/**
 * A single explicit file is a complete census, even when analysis is partial.
 * A clean parse with export forms the extractor could not represent counts as
 * failed (`unsupported-syntax`): the result is partial, never clean.
 */
function fileCoverage(
  filePath: string,
  capability: 'parse' | 'publicSymbols',
  parseStatus: AstCodeInsights['parseStatus'],
  hasUnextractedExports = false,
): LanguageCoverage {
  const classification = classifyFileForCoverage(filePath, capability);
  const eligible = classification === 'eligible';
  const unsupportedSyntax =
    eligible && parseStatus === 'ok' && hasUnextractedExports;
  const language = languageForExtension(path.extname(filePath));
  return withCoverageVerdict({
    supportedLanguages: supportedLanguagesFor(capability),
    census: 'complete',
    analyzed: eligible && parseStatus === 'ok' && !unsupportedSyntax ? 1 : 0,
    unchecked: eligible && parseStatus === 'unknown' ? 1 : 0,
    failed:
      (eligible && parseStatus === 'recovered') || unsupportedSyntax ? 1 : 0,
    unsupported: classification === 'unsupported' ? 1 : 0,
    unrecognised: classification === 'unrecognised' ? 1 : 0,
    nonSource: classification === 'nonSource' ? 1 : 0,
    excluded: 0,
    omittedByCap: 0,
    ...(classification === 'unsupported'
      ? { unsupportedByLanguage: { [language ?? 'other']: 1 } }
      : {}),
    ...(eligible && parseStatus === 'recovered'
      ? { failedByReason: { parse: 1 } }
      : {}),
    ...(unsupportedSyntax
      ? { failedByReason: { 'unsupported-syntax': 1 } }
      : {}),
  });
}

/**
 * Read a file and detect its language for AST parsing
 */
async function readFileForAst(
  filePath: string,
  fileSystemProvider: IFileSystemProvider,
  workspaceProvider: IWorkspaceProvider,
  workspaceRoot?: string,
): Promise<{
  content: string;
  language: SupportedLanguage;
  absolutePath: string;
}> {
  const absolutePath = resolveFilePath(
    filePath,
    workspaceProvider,
    workspaceRoot,
  );

  const stat = await fileSystemProvider.stat(absolutePath);
  if (stat.type === FileType.Directory) {
    throw new Error(
      `Path is a directory, not a file: ${absolutePath}. ` +
        `AST tools operate on a single source file — pass a file path instead.`,
    );
  }

  const content = await fileSystemProvider.readFile(absolutePath);

  const ext = absolutePath.substring(absolutePath.lastIndexOf('.'));
  const language = EXTENSION_LANGUAGE_MAP[ext.toLowerCase()];

  if (!language) {
    throw new Error(
      `${JSON.stringify({ coverage: compactCoverage(fileCoverage(absolutePath, 'parse', 'unknown')) })} ` +
        `Unsupported file type: ${ext}. Supported: ${Object.keys(
          EXTENSION_LANGUAGE_MAP,
        ).join(', ')}`,
    );
  }

  return { content, language, absolutePath };
}

/**
 * Resolve file path to absolute path.
 *
 * Absolute filePaths (POSIX root, Windows drive, or UNC) are returned verbatim.
 * A relative filePath is joined against `explicitRoot` when the caller supplied
 * one, otherwise against the active workspace root. The explicit root lets a
 * caller disambiguate when multiple workspaces are open, where the process-
 * global active folder can point at a different workspace than intended.
 */
function resolveFilePath(
  filePath: string,
  workspaceProvider: IWorkspaceProvider,
  explicitRoot?: string,
): string {
  if (
    filePath.startsWith('/') ||
    /^[A-Za-z]:/.test(filePath) ||
    filePath.startsWith('\\\\')
  ) {
    return filePath;
  }

  const workspaceRoot =
    explicitRoot?.trim() || workspaceProvider.getWorkspaceRoot();
  if (!workspaceRoot) {
    throw new Error('No workspace folder open');
  }

  return path.join(workspaceRoot, filePath);
}

/**
 * Simplify GenericAstNode to AstNode for JSON serialization
 */
function simplifyAstNode(
  node: GenericAstNode,
  depth: number,
  maxDepth: number,
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
        maxDepth,
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
