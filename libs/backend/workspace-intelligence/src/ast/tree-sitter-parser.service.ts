import path from 'path';
import { injectable, inject } from 'tsyringe';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import {
  EXTENSION_LANGUAGE_MAP,
  SupportedLanguage,
  LANGUAGE_QUERIES_MAP,
} from './tree-sitter.config';
import { GenericAstNode } from './ast.types';
import Parser from 'web-tree-sitter';

/**
 * Public interface representing an edit delta for incremental parsing.
 * Consumers (e.g., VS Code extension layer) use this to describe text changes
 * so the parser can incrementally re-parse only the affected region.
 */
export interface EditDelta {
  startIndex: number;
  oldEndIndex: number;
  newEndIndex: number;
  startPosition: { row: number; column: number };
  oldEndPosition: { row: number; column: number };
  newEndPosition: { row: number; column: number };
}

/** Cache entry for storing parsed tree-sitter trees keyed by file path. */
interface TreeCacheEntry {
  tree: Parser.Tree;
  language: SupportedLanguage;
  lastAccessed: number;
  filePath: string;
}

/**
 * Represents a capture from a tree-sitter query match.
 */
export interface QueryCapture {
  /** The name of the capture (e.g., 'function.name', 'class.declaration') */
  name: string;
  /** The captured node converted to GenericAstNode */
  node: GenericAstNode;
  /** The text content of the captured node */
  text: string;
  /** Start position */
  startPosition: { row: number; column: number };
  /** End position */
  endPosition: { row: number; column: number };
}

/**
 * Represents a single match from a tree-sitter query.
 */
export interface QueryMatch {
  /** The pattern index that matched */
  pattern: number;
  /** All captures in this match */
  captures: QueryCapture[];
}

// --- WASM Path Resolution ---

/**
 * Resolves the absolute path to a WASM file co-located in the `wasm/` directory
 * next to the bundled output.
 *
 * In the final ESM bundle, the esbuild banner injects:
 *   `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`
 * This makes `import.meta.url` available at runtime, but TypeScript rejects it
 * during library compilation (CJS target). We use `new Function` to bypass the
 * static check while keeping the resolution correct at runtime.
 *
 * Fallback: If `import.meta.url` is not available (e.g. plain CJS), we fall
 * back to `__dirname` which is always defined in CommonJS modules.
 */
function resolveWasmPath(filename: string): string {
  let dir: string;
  try {
    // At runtime in ESM bundle, import.meta.url is available via esbuild banner.
    // Use Function constructor to avoid TS1470 "import.meta not allowed in CJS" error.

    const getMetaUrl = new Function('return import.meta.url') as () => string;
    const metaUrl: string = getMetaUrl();
    const { fileURLToPath } = require('url') as typeof import('url');
    dir = path.dirname(fileURLToPath(metaUrl));
  } catch {
    // Fallback for plain CJS execution (e.g. tests)
    dir = __dirname;
  }
  return path.join(dir, 'wasm', filename);
}

// --- Service Implementation ---

@injectable()
export class TreeSitterParserService {
  private readonly parserCache: Map<SupportedLanguage, Parser> = new Map();
  private readonly languageGrammars: Map<SupportedLanguage, Parser.Language> =
    new Map();
  private readonly treeCache: Map<string, TreeCacheEntry> = new Map();
  private readonly treeCacheMaxSize = 100;
  private isInitialized = false;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    this.logger.info(
      'TreeSitterParserService created. Initialization required.',
    );
  }

  // --- Initialization ---

  /**
   * Initializes the service by loading the web-tree-sitter WASM runtime and
   * language grammars. This method is idempotent -- subsequent calls after a
   * successful initialization return immediately.
   *
   * @returns A Result indicating success or failure of initialization.
   */
  async initialize(): Promise<Result<void, Error>> {
    this.logger.debug(
      `Initialize called. Current state: isInitialized=${this.isInitialized}`,
    );
    if (this.isInitialized) {
      this.logger.debug('Already initialized.');
      return Result.ok(undefined);
    }

    this.logger.info(
      'Initializing web-tree-sitter WASM runtime and grammars...',
    );
    try {
      // Initialize the WASM runtime
      await Parser.init({
        locateFile: () => resolveWasmPath('tree-sitter.wasm'),
      });

      // Load language grammars from WASM files
      const jsLanguage = await Parser.Language.load(
        resolveWasmPath('tree-sitter-javascript.wasm'),
      );
      const tsLanguage = await Parser.Language.load(
        resolveWasmPath('tree-sitter-typescript.wasm'),
      );

      this.languageGrammars.set('javascript', jsLanguage);
      this.languageGrammars.set('typescript', tsLanguage);

      this.isInitialized = true;
      this.logger.info(
        'web-tree-sitter WASM runtime and grammars initialized successfully.',
      );
      return Result.ok(undefined);
    } catch (error) {
      this.isInitialized = false;
      const initError = this._handleAndLogError(
        'TreeSitterParserService WASM initialization failed',
        error,
      );
      return Result.err(initError);
    }
  }

  // --- Language & Grammar Handling ---

  private getLanguageFromExtension(
    filePath: string,
  ): SupportedLanguage | undefined {
    const ext = path.extname(filePath).toLowerCase();
    return EXTENSION_LANGUAGE_MAP[ext];
  }

  /**
   * Retrieves the pre-loaded language grammar. Ensures service is initialized.
   * @param language The language grammar to retrieve.
   * @returns A Result containing the Language object or an error if not initialized or not found.
   */
  private async _getPreloadedGrammar(
    language: SupportedLanguage,
  ): Promise<Result<Parser.Language, Error>> {
    if (!this.isInitialized) {
      this.logger.debug(
        `_getPreloadedGrammar: Service not initialized. Triggering initialize().`,
      );
      const initResult = await this.initialize();
      if (initResult.isErr()) {
        return Result.err(
          new Error(
            `Initialization failed before getting preloaded grammar: ${
              initResult.error?.message ?? 'Unknown error'
            }`,
          ),
        );
      }
      if (!this.isInitialized) {
        return Result.err(
          this._handleAndLogError(
            'Initialization race condition or unexpected error',
            new Error(
              'isInitialized still false after successful initialize() call',
            ),
          ),
        );
      }
      this.logger.debug(`_getPreloadedGrammar: Initialization completed.`);
    }

    const grammar = this.languageGrammars.get(language);
    if (!grammar) {
      return Result.err(
        this._handleAndLogError(
          `Grammar for language ${language} not found in pre-loaded cache after successful initialization`,
          new Error(`Grammar not found: ${language}`),
        ),
      );
    }
    this.logger.debug(
      `Retrieved pre-loaded grammar for language: ${language}.`,
    );
    return Result.ok(grammar);
  }

  // --- Parser Caching & Creation ---

  /**
   * Attempts to retrieve a parser from the cache and verifies its language module.
   * @param language - The language of the parser to retrieve.
   * @returns A Result containing the cached parser if valid, or an error/null if not found or invalid.
   */
  private async _getCachedParser(
    language: SupportedLanguage,
  ): Promise<Result<Parser | null, Error>> {
    if (!this.parserCache.has(language)) {
      return Result.ok(null);
    }

    this.logger.debug(`Using cached parser for language: ${language}`);
    const cachedParser = this.parserCache.get(language) as Parser;

    const grammarResult = await this._getPreloadedGrammar(language);
    if (grammarResult.isErr()) {
      this.parserCache.delete(language);
      return Result.err(
        new Error(
          `Failed to re-verify pre-loaded grammar for cached ${language}: ${
            grammarResult.error?.message ?? 'Unknown error'
          }`,
        ),
      );
    }

    try {
      cachedParser.setLanguage(grammarResult.value as Parser.Language);
      return Result.ok(cachedParser);
    } catch (error: unknown) {
      this.parserCache.delete(language);
      return Result.err(
        this._handleAndLogError(
          `Failed to set language on cached parser for ${language}`,
          error,
        ),
      );
    }
  }

  /**
   * Creates a new parser instance, loads its language, and caches it.
   * @param language - The language for the new parser.
   * @returns A Result containing the newly created parser or an error.
   */
  private async _createAndCacheParser(
    language: SupportedLanguage,
  ): Promise<Result<Parser, Error>> {
    this.logger.info(`Creating new parser for language: ${language}`);

    const grammarResult = await this._getPreloadedGrammar(language);
    if (grammarResult.isErr()) {
      return Result.err(
        grammarResult.error ?? new Error('Unknown grammar error'),
      );
    }

    try {
      const parser = new Parser();
      parser.setLanguage(grammarResult.value);
      this.parserCache.set(language, parser);
      this.logger.info(
        `Successfully created and cached parser for language: ${language}`,
      );
      return Result.ok(parser);
    } catch (error: unknown) {
      return Result.err(
        this._handleAndLogError(
          `Failed to create or set language for new parser for ${language}`,
          error,
        ),
      );
    }
  }

  /**
   * Retrieves or creates a Tree-sitter parser instance for the specified language.
   * Uses caching to avoid redundant loading.
   * @param language - The language for the parser.
   * @returns A Result containing the parser instance or an error.
   */
  private async getOrCreateParser(
    language: SupportedLanguage,
  ): Promise<Result<Parser | null, Error>> {
    const cachedResult = await this._getCachedParser(language);

    if (cachedResult.isErr()) {
      return Result.err(cachedResult.error ?? new Error('Unknown cache error'));
    }

    const cachedParser = cachedResult.value;
    if (cachedParser) {
      return Result.ok(cachedParser);
    }

    return this._createAndCacheParser(language);
  }

  // --- AST Conversion ---

  /**
   * Recursively converts a Tree-sitter SyntaxNode to a GenericAstNode.
   * Includes an optional depth limit to prevent excessive recursion.
   * @param node The Tree-sitter node to convert.
   * @param currentDepth The current recursion depth.
   * @param maxDepth The maximum recursion depth allowed (null for no limit).
   * @returns The converted GenericAstNode.
   * @private
   */
  private _convertNodeToGenericAst(
    node: Parser.SyntaxNode,
    currentDepth = 0,
    maxDepth: number | null = null, // Optional depth limit
  ): GenericAstNode {
    if (maxDepth !== null && currentDepth > maxDepth) {
      // Return a minimal node if depth limit is exceeded
      return {
        type: node.type,
        text: '... [Max Depth Reached]', // Indicate truncation
        startPosition: {
          row: node.startPosition.row,
          column: node.startPosition.column,
        },
        endPosition: {
          row: node.endPosition.row,
          column: node.endPosition.column,
        },
        isNamed: node.isNamed,
        fieldName: null, // web-tree-sitter SyntaxNode does not expose fieldName
        children: [], // No children beyond max depth
      };
    }

    // Ensure children is an array, default to empty array if null/undefined
    const children = node.children ?? [];

    return {
      type: node.type,
      text: node.text, // Be mindful of large text nodes, potential optimization later if needed
      startPosition: {
        row: node.startPosition.row,
        column: node.startPosition.column,
      },
      endPosition: {
        row: node.endPosition.row,
        column: node.endPosition.column,
      },
      isNamed: node.isNamed,
      fieldName: null, // web-tree-sitter SyntaxNode does not expose fieldName
      children: children.map((child: Parser.SyntaxNode) =>
        this._convertNodeToGenericAst(child, currentDepth + 1, maxDepth),
      ),
    };
  }

  // --- Public API ---

  async parse(
    content: string,
    language: SupportedLanguage,
  ): Promise<Result<GenericAstNode, Error>> {
    this.logger.info(
      `Parsing content for language: ${language} to generate generic AST`,
    );

    const initResult = await this.initialize();
    if (initResult.isErr()) {
      return Result.err(initResult.error ?? new Error('Unknown init error'));
    }

    const parserResult = await this.getOrCreateParser(language);
    if (parserResult.isErr()) {
      return Result.err(
        parserResult.error ?? new Error('Unknown parser error'),
      );
    }
    const parser = parserResult.value;

    let tree: Parser.Tree;
    try {
      if (!parser) {
        throw new Error('Parser instance is null or undefined before parsing.');
      }
      tree = parser.parse(content);
      if (!tree?.rootNode) {
        throw new Error('Parsing resulted in an undefined tree or rootNode.');
      }
      this.logger.debug(
        `Successfully created syntax tree for language: ${language}. Root node type: ${tree.rootNode.type}`,
      );

      // Convert tree to generic AST
      const genericAstRoot = this._convertNodeToGenericAst(
        tree.rootNode,
        0,
        null,
      );
      this.logger.info(
        `Successfully converted AST to generic JSON format for language: ${language}.`,
      );
      return Result.ok(genericAstRoot);
    } catch (error: unknown) {
      return Result.err(
        this._handleAndLogError(
          `Error during Tree-sitter parsing or AST conversion for ${language}`,
          error,
        ),
      );
    }
  }

  /**
   * Executes a tree-sitter query on the parsed content.
   * This is the recommended way to extract specific code structures.
   *
   * @param content The source code content to parse
   * @param language The language of the source code
   * @param queryString The tree-sitter query in S-expression format
   * @returns A Result containing an array of QueryMatch objects
   */
  async query(
    content: string,
    language: SupportedLanguage,
    queryString: string,
  ): Promise<Result<QueryMatch[], Error>> {
    this.logger.debug(`Running query for language: ${language}`);

    const initResult = await this.initialize();
    if (initResult.isErr()) {
      return Result.err(initResult.error ?? new Error('Unknown init error'));
    }

    const parserResult = await this.getOrCreateParser(language);
    if (parserResult.isErr()) {
      return Result.err(
        parserResult.error ?? new Error('Unknown parser error'),
      );
    }
    const parser = parserResult.value;

    const grammarResult = await this._getPreloadedGrammar(language);
    if (grammarResult.isErr()) {
      return Result.err(
        grammarResult.error ?? new Error('Unknown grammar error'),
      );
    }
    const grammar = grammarResult.value!;

    try {
      if (parser === undefined || parser === null) {
        throw new Error('Parser instance is null or undefined before parsing.');
      } else {
        const tree = parser.parse(content);

        if (!tree?.rootNode) {
          throw new Error('Parsing resulted in an undefined tree or rootNode.');
        }

        // Create query using the language's query method (web-tree-sitter API)
        const query = grammar.query(queryString);
        const matches = query.matches(tree.rootNode);

        // Convert matches to our QueryMatch format
        const results: QueryMatch[] = matches.map(
          (match: {
            pattern: number;
            captures: { name: string; node: Parser.SyntaxNode }[];
          }) => ({
            pattern: match.pattern,
            captures: match.captures.map(
              (capture: { name: string; node: Parser.SyntaxNode }) => ({
                name: capture.name,
                node: this._convertNodeToGenericAst(capture.node, 0, 3), // Limit depth for captures
                text: capture.node.text,
                startPosition: {
                  row: capture.node.startPosition.row,
                  column: capture.node.startPosition.column,
                },
                endPosition: {
                  row: capture.node.endPosition.row,
                  column: capture.node.endPosition.column,
                },
              }),
            ),
          }),
        );

        this.logger.debug(
          `Query returned ${results.length} matches for language: ${language}`,
        );
        return Result.ok(results);
      }
    } catch (error: unknown) {
      return Result.err(
        this._handleAndLogError(
          `Error during tree-sitter query for ${language}`,
          error,
        ),
      );
    }
  }

  /**
   * Executes the pre-configured function query for the given language.
   * @param content The source code content
   * @param language The language of the source code
   * @returns Query matches for functions, methods, and arrow functions
   */
  async queryFunctions(
    content: string,
    language: SupportedLanguage,
  ): Promise<Result<QueryMatch[], Error>> {
    const queries = LANGUAGE_QUERIES_MAP[language];
    if (!queries.functionQuery) {
      return Result.ok([]);
    }
    return this.query(content, language, queries.functionQuery);
  }

  /**
   * Executes the pre-configured class query for the given language.
   * @param content The source code content
   * @param language The language of the source code
   * @returns Query matches for class declarations
   */
  async queryClasses(
    content: string,
    language: SupportedLanguage,
  ): Promise<Result<QueryMatch[], Error>> {
    const queries = LANGUAGE_QUERIES_MAP[language];
    if (!queries.classQuery) {
      return Result.ok([]);
    }
    return this.query(content, language, queries.classQuery);
  }

  /**
   * Executes the pre-configured import query for the given language.
   * @param content The source code content
   * @param language The language of the source code
   * @returns Query matches for import statements
   */
  async queryImports(
    content: string,
    language: SupportedLanguage,
  ): Promise<Result<QueryMatch[], Error>> {
    const queries = LANGUAGE_QUERIES_MAP[language];
    if (!queries.importQuery) {
      return Result.ok([]);
    }
    return this.query(content, language, queries.importQuery);
  }

  /**
   * Executes the pre-configured export query for the given language.
   * @param content The source code content
   * @param language The language of the source code
   * @returns Query matches for export statements
   */
  async queryExports(
    content: string,
    language: SupportedLanguage,
  ): Promise<Result<QueryMatch[], Error>> {
    const queries = LANGUAGE_QUERIES_MAP[language];
    if (!queries.exportQuery) {
      return Result.ok([]);
    }
    return this.query(content, language, queries.exportQuery);
  }

  // --- Incremental Parsing ---

  /**
   * Parses source code and caches the raw tree-sitter tree for future incremental re-parses.
   * Use this instead of `parse()` when you intend to later call `parseIncremental()` on the same file.
   *
   * @param filePath - Absolute path used as the cache key for the tree.
   * @param content - The full source code content to parse.
   * @param language - The language of the source code.
   * @returns A Result containing the GenericAstNode root or an Error.
   */
  async parseAndCache(
    filePath: string,
    content: string,
    language: SupportedLanguage,
  ): Promise<Result<GenericAstNode, Error>> {
    this.logger.debug(
      `parseAndCache: Parsing and caching tree for ${filePath} (${language})`,
    );

    const initResult = await this.initialize();
    if (initResult.isErr()) {
      return Result.err(initResult.error ?? new Error('Unknown init error'));
    }

    const parserResult = await this.getOrCreateParser(language);
    if (parserResult.isErr()) {
      return Result.err(
        parserResult.error ?? new Error('Unknown parser error'),
      );
    }
    const parser = parserResult.value;

    try {
      if (!parser) {
        throw new Error('Parser instance is null or undefined before parsing.');
      }

      const tree = parser.parse(content);
      if (!tree?.rootNode) {
        throw new Error('Parsing resulted in an undefined tree or rootNode.');
      }

      // Evict oldest entry if cache is full before adding
      this.evictLRUTreeCache();

      // Store the raw tree in the tree cache for incremental re-parsing
      this.treeCache.set(filePath, {
        tree,
        language,
        lastAccessed: Date.now(),
        filePath,
      });

      const genericAstRoot = this._convertNodeToGenericAst(
        tree.rootNode,
        0,
        null,
      );

      this.logger.debug(
        `parseAndCache: Successfully parsed and cached tree for ${filePath}`,
      );
      return Result.ok(genericAstRoot);
    } catch (error: unknown) {
      return Result.err(
        this._handleAndLogError(
          `Error during parseAndCache for ${filePath} (${language})`,
          error,
        ),
      );
    }
  }

  /**
   * Incrementally re-parses a file using a previously cached tree and an edit delta.
   * If no cached tree exists for the file, falls back to a full `parseAndCache()`.
   *
   * Incremental parsing is significantly faster for small edits (e.g., single-line changes)
   * because tree-sitter only re-parses the affected region of the syntax tree.
   *
   * @param filePath - Absolute path used as the cache key.
   * @param content - The full source code content AFTER the edit has been applied.
   * @param language - The language of the source code.
   * @param editDelta - Describes where and how the text changed (byte offsets and positions).
   * @returns A Result containing the GenericAstNode root or an Error.
   */
  async parseIncremental(
    filePath: string,
    content: string,
    language: SupportedLanguage,
    editDelta: EditDelta,
  ): Promise<Result<GenericAstNode, Error>> {
    const cachedEntry = this.treeCache.get(filePath);

    if (!cachedEntry) {
      this.logger.debug(
        `parseIncremental: Cache miss for ${filePath}, falling back to full parse`,
      );
      return this.parseAndCache(filePath, content, language);
    }

    // If the cached tree was parsed with a different language, the old tree is
    // not compatible for incremental re-parsing. Fall back to a full parse.
    if (cachedEntry.language !== language) {
      this.logger.debug(
        `parseIncremental: Language mismatch for ${filePath} (cached: ${cachedEntry.language}, requested: ${language}), falling back to full parse`,
      );
      return this.parseAndCache(filePath, content, language);
    }

    this.logger.debug(
      `parseIncremental: Cache hit for ${filePath}, performing incremental re-parse`,
    );

    const initResult = await this.initialize();
    if (initResult.isErr()) {
      return Result.err(initResult.error ?? new Error('Unknown init error'));
    }

    const parserResult = await this.getOrCreateParser(language);
    if (parserResult.isErr()) {
      return Result.err(
        parserResult.error ?? new Error('Unknown parser error'),
      );
    }
    const parser = parserResult.value;

    try {
      if (!parser) {
        throw new Error('Parser instance is null or undefined before parsing.');
      }

      // Apply the edit delta to the cached tree so tree-sitter knows what changed
      cachedEntry.tree.edit({
        startIndex: editDelta.startIndex,
        oldEndIndex: editDelta.oldEndIndex,
        newEndIndex: editDelta.newEndIndex,
        startPosition: editDelta.startPosition,
        oldEndPosition: editDelta.oldEndPosition,
        newEndPosition: editDelta.newEndPosition,
      });

      // Incremental parse: tree-sitter reuses unchanged subtrees from the old tree
      const newTree = parser.parse(content, cachedEntry.tree);
      if (!newTree?.rootNode) {
        throw new Error(
          'Incremental parsing resulted in an undefined tree or rootNode.',
        );
      }

      // Update the cache with the new tree
      this.treeCache.set(filePath, {
        tree: newTree,
        language,
        lastAccessed: Date.now(),
        filePath,
      });

      const genericAstRoot = this._convertNodeToGenericAst(
        newTree.rootNode,
        0,
        null,
      );

      this.logger.debug(
        `parseIncremental: Successfully performed incremental re-parse for ${filePath}`,
      );
      return Result.ok(genericAstRoot);
    } catch (error: unknown) {
      // On failure, remove the potentially corrupted cache entry and fall back
      this.treeCache.delete(filePath);
      this.logger.warn(
        `parseIncremental: Incremental parse failed for ${filePath}, falling back to full parse`,
      );
      return this.parseAndCache(filePath, content, language);
    }
  }

  /**
   * Evicts the least-recently-used entry from the tree cache when it exceeds the max size.
   * Uses the `lastAccessed` timestamp to determine the oldest entry.
   */
  private evictLRUTreeCache(): void {
    if (this.treeCache.size < this.treeCacheMaxSize) {
      return;
    }

    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.treeCache) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.logger.debug(
        `evictLRUTreeCache: Evicting cached tree for ${oldestKey}`,
      );
      this.treeCache.delete(oldestKey);
    }
  }

  /**
   * Handles and logs an error, ensuring a proper Error object is created.
   * @param context A string describing the context where the error occurred.
   * @param error The caught error object (unknown type).
   * @returns The processed Error object.
   * @private
   */
  private _handleAndLogError(context: string, error: unknown): Error {
    const processedError =
      error instanceof Error
        ? error
        : new Error(String(error) || 'Unknown error');
    const message = `${context}: ${processedError.message}`;
    this.logger.error(message, processedError);
    processedError.message = message;
    return processedError;
  }
}
