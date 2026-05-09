import { injectable, inject } from 'tsyringe';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import { SupportedLanguage, LANGUAGE_QUERIES_MAP } from './tree-sitter.config';
import { GenericAstNode } from './ast.types';
import { resolveWasmPath } from './wasm-bundle-dir';
import {
  Parser,
  Language,
  Query,
  Edit,
  type Node as SyntaxNode,
  type Tree,
  type QueryCapture as TsQueryCapture,
  type QueryMatch as TsQueryMatch,
} from 'web-tree-sitter';

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
  tree: Tree;
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

// --- Service Implementation ---

@injectable()
export class TreeSitterParserService {
  private readonly parserCache: Map<SupportedLanguage, Parser> = new Map();
  private readonly languageGrammars: Map<SupportedLanguage, Language> =
    new Map();
  private readonly treeCache: Map<string, TreeCacheEntry> = new Map();
  private readonly treeCacheMaxSize = 100;
  private isInitialized = false;
  private initPromise: Promise<Result<void, Error>> | null = null;

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
   * Uses a promise guard to prevent concurrent initialization: if multiple
   * callers invoke initialize() before it completes, they all await the same
   * Promise instead of triggering duplicate Parser.init() calls.
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

    if (this.initPromise) {
      this.logger.debug(
        'Initialization already in progress. Returning existing promise.',
      );
      return this.initPromise;
    }

    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<Result<void, Error>> {
    this.logger.info(
      'Initializing web-tree-sitter WASM runtime and grammars...',
    );
    const jsWasmPath = resolveWasmPath('tree-sitter-javascript.wasm');
    const tsWasmPath = resolveWasmPath('tree-sitter-typescript.wasm');
    const runtimeWasmPath = resolveWasmPath('tree-sitter.wasm');

    try {
      // Initialize the WASM runtime, passing through the requested filename
      await Parser.init({
        locateFile: (file: string) => resolveWasmPath(file),
      });

      // Load language grammars from WASM files
      const jsLanguage = await Language.load(jsWasmPath);
      const tsLanguage = await Language.load(tsWasmPath);

      this.languageGrammars.set('javascript', jsLanguage);
      this.languageGrammars.set('typescript', tsLanguage);

      this.isInitialized = true;
      this.logger.info(
        'web-tree-sitter WASM runtime and grammars initialized successfully.',
      );
      return Result.ok(undefined);
    } catch (error) {
      this.isInitialized = false;
      this.initPromise = null; // Allow retry on failure
      const initError = this._handleAndLogError(
        `TreeSitterParserService WASM initialization failed. Attempted paths: runtime=${runtimeWasmPath}, JS=${jsWasmPath}, TS=${tsWasmPath}`,
        error,
      );
      return Result.err(initError);
    }
  }

  // --- Language & Grammar Handling ---

  /**
   * Retrieves the pre-loaded language grammar. Ensures service is initialized.
   * @param language The language grammar to retrieve.
   * @returns A Result containing the Language object or an error if not initialized or not found.
   */
  private async _getPreloadedGrammar(
    language: SupportedLanguage,
  ): Promise<Result<Language, Error>> {
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
   * Attempts to retrieve a parser from the cache.
   * Parsers are created with their language already set in _createAndCacheParser(),
   * and since we cache one parser per language, no re-verification is needed.
   * @param language - The language of the parser to retrieve.
   * @returns A Result containing the cached parser if found, or null if not cached.
   */
  private _getCachedParser(
    language: SupportedLanguage,
  ): Result<Parser | null, Error> {
    if (!this.parserCache.has(language)) {
      return Result.ok(null);
    }

    this.logger.debug(`Using cached parser for language: ${language}`);
    const cachedParser = this.parserCache.get(language) as Parser;
    return Result.ok(cachedParser);
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
      parser.setLanguage(grammarResult.value ?? null);
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
    const cachedResult = this._getCachedParser(language);

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
    node: SyntaxNode,
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
      children: children.map((child: SyntaxNode) =>
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

    if (!parser) {
      return Result.err(
        new Error('Parser instance is null or undefined before parsing.'),
      );
    }

    let tree: Tree | null = null;
    try {
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
    } finally {
      // Free WASM heap memory -- Tree objects are NOT garbage collected
      tree?.delete();
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
    const grammar = grammarResult.value;

    if (!parser) {
      return Result.err(
        new Error('Parser instance is null or undefined before parsing.'),
      );
    }

    if (!grammar) {
      return Result.err(
        new Error('Grammar instance is null or undefined before querying.'),
      );
    }

    let tree: Tree | null = null;
    let tsQuery: Query | undefined;
    try {
      tree = parser.parse(content);

      if (!tree?.rootNode) {
        throw new Error('Parsing resulted in an undefined tree or rootNode.');
      }

      // Create query via the Query constructor (web-tree-sitter 0.26 API)
      tsQuery = new Query(grammar, queryString);
      const matches = tsQuery.matches(tree.rootNode);

      // Convert matches to our QueryMatch format
      const results: QueryMatch[] = matches.map((match: TsQueryMatch) => ({
        pattern: match.patternIndex,
        captures: match.captures.map((capture: TsQueryCapture) => ({
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
        })),
      }));

      this.logger.debug(
        `Query returned ${results.length} matches for language: ${language}`,
      );
      return Result.ok(results);
    } catch (error: unknown) {
      return Result.err(
        this._handleAndLogError(
          `Error during tree-sitter query for ${language}`,
          error,
        ),
      );
    } finally {
      // Free WASM heap memory -- Query and Tree objects are NOT garbage collected
      tsQuery?.delete();
      tree?.delete();
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

  /**
   * Executes multiple tree-sitter queries over a single parse of the content.
   * Parses the source exactly once and runs all provided queries against the
   * resulting tree, returning a Map keyed by each entry's `key` field.
   *
   * This is significantly more efficient than calling `query()` N times when
   * all queries operate on the same source file, as the WASM parse cost is
   * paid only once.
   *
   * @param content The source code content to parse
   * @param language The language of the source code
   * @param queries An array of { key, queryString } entries to execute
   * @returns A Result containing a Map<key, QueryMatch[]> on success, or an Error on failure.
   *          An empty `queries` array returns `Result.ok(new Map())` immediately.
   */
  async queryMulti(
    content: string,
    language: SupportedLanguage,
    queries: { key: string; queryString: string }[],
  ): Promise<Result<Map<string, QueryMatch[]>, Error>> {
    if (!content || queries.length === 0) {
      return Result.ok(new Map());
    }

    this.logger.debug(
      `Running queryMulti for language: ${language} with ${queries.length} queries`,
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

    const grammarResult = await this._getPreloadedGrammar(language);
    if (grammarResult.isErr()) {
      return Result.err(
        grammarResult.error ?? new Error('Unknown grammar error'),
      );
    }
    const grammar = grammarResult.value;

    if (!parser) {
      return Result.err(
        new Error('Parser instance is null or undefined before parsing.'),
      );
    }

    if (!grammar) {
      return Result.err(
        new Error('Grammar instance is null or undefined before querying.'),
      );
    }

    let tree: Tree | null = null;
    // Collect all Query objects so the finally block can delete each one,
    // even if an exception is thrown mid-loop.
    const createdQueries: Query[] = [];

    try {
      tree = parser.parse(content);

      if (!tree?.rootNode) {
        throw new Error('Parsing resulted in an undefined tree or rootNode.');
      }

      const resultMap = new Map<string, QueryMatch[]>();

      for (const entry of queries) {
        const tsQuery = new Query(grammar, entry.queryString);
        createdQueries.push(tsQuery);

        const matches = tsQuery.matches(tree.rootNode);

        const queryMatches: QueryMatch[] = matches.map(
          (match: TsQueryMatch) => ({
            pattern: match.patternIndex,
            captures: match.captures.map((capture: TsQueryCapture) => ({
              name: capture.name,
              node: this._convertNodeToGenericAst(capture.node, 0, 3),
              text: capture.node.text,
              startPosition: {
                row: capture.node.startPosition.row,
                column: capture.node.startPosition.column,
              },
              endPosition: {
                row: capture.node.endPosition.row,
                column: capture.node.endPosition.column,
              },
            })),
          }),
        );

        resultMap.set(entry.key, queryMatches);
      }

      this.logger.debug(
        `queryMulti returned results for ${resultMap.size} queries, language: ${language}`,
      );
      return Result.ok(resultMap);
    } catch (error: unknown) {
      return Result.err(
        this._handleAndLogError(
          `Error during queryMulti for ${language}`,
          error,
        ),
      );
    } finally {
      // Free WASM heap memory for every Query object created before the error.
      for (const tsQuery of createdQueries) {
        tsQuery?.delete();
      }
      tree?.delete();
    }
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

    if (!parser) {
      return Result.err(
        new Error('Parser instance is null or undefined before parsing.'),
      );
    }

    try {
      const tree = parser.parse(content);
      if (!tree?.rootNode) {
        throw new Error('Parsing resulted in an undefined tree or rootNode.');
      }

      // Evict oldest entry if cache is full before adding
      this.evictLRUTreeCache();

      // Delete the previous tree for this file path if it exists (WASM heap cleanup)
      const previousEntry = this.treeCache.get(filePath);
      if (previousEntry?.tree) {
        previousEntry.tree.delete();
      }

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

    if (!parser) {
      return Result.err(
        new Error('Parser instance is null or undefined before parsing.'),
      );
    }

    try {
      // Apply the edit delta to the cached tree so tree-sitter knows what changed.
      // web-tree-sitter 0.26+ requires an Edit class instance (not a plain object).
      cachedEntry.tree.edit(
        new Edit({
          startIndex: editDelta.startIndex,
          oldEndIndex: editDelta.oldEndIndex,
          newEndIndex: editDelta.newEndIndex,
          startPosition: editDelta.startPosition,
          oldEndPosition: editDelta.oldEndPosition,
          newEndPosition: editDelta.newEndPosition,
        }),
      );

      // Incremental parse: tree-sitter reuses unchanged subtrees from the old tree
      const newTree = parser.parse(content, cachedEntry.tree);
      if (!newTree?.rootNode) {
        throw new Error(
          'Incremental parsing resulted in an undefined tree or rootNode.',
        );
      }

      // Delete the old tree from WASM heap now that the new tree is created
      cachedEntry.tree.delete();

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
      // On failure, delete the potentially corrupted cached tree and fall back
      const corruptedEntry = this.treeCache.get(filePath);
      if (corruptedEntry?.tree) {
        corruptedEntry.tree.delete();
      }
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
      // Free WASM heap memory before removing the Map entry
      const evicted = this.treeCache.get(oldestKey);
      if (evicted?.tree) {
        evicted.tree.delete();
      }
      this.treeCache.delete(oldestKey);
    }
  }

  /**
   * Clears all cached trees, freeing their WASM heap memory.
   * Parsers are retained since they are long-lived singletons per language.
   */
  clearCache(): void {
    for (const [, entry] of this.treeCache) {
      entry.tree.delete();
    }
    this.treeCache.clear();
    this.logger.debug(
      'clearCache: All cached trees deleted and cache cleared.',
    );
  }

  /**
   * Disposes of all WASM resources held by this service.
   * Must be called when the extension deactivates or the service is no longer needed.
   * After calling dispose(), the service must be re-initialized before use.
   */
  dispose(): void {
    this.logger.info(
      'Disposing TreeSitterParserService: freeing all WASM resources.',
    );

    // Delete all cached trees
    for (const [, entry] of this.treeCache) {
      entry.tree.delete();
    }
    this.treeCache.clear();

    // Delete all cached parsers
    for (const [, parser] of this.parserCache) {
      parser.delete();
    }
    this.parserCache.clear();

    // Clear grammar references (Language objects are managed by the WASM runtime)
    this.languageGrammars.clear();

    this.isInitialized = false;
    this.initPromise = null;

    this.logger.info('TreeSitterParserService disposed.');
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
