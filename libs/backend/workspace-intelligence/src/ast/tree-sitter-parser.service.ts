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

/**
 * Opaque type representing a tree-sitter parser instance (loaded via require).
 * tree-sitter does not ship TypeScript declarations, so we model these as
 * structural interfaces covering only the members we actually use.
 */
interface TreeSitterParser {
  setLanguage(language: TreeSitterLanguage): void;
  parse(input: string): TreeSitterTree;
}

/** Opaque type representing a tree-sitter language grammar. */
type TreeSitterLanguage = Record<string, unknown>;

/** Opaque type representing a tree-sitter parse tree. */
interface TreeSitterTree {
  rootNode: TreeSitterSyntaxNode;
}

/** Structural interface for tree-sitter SyntaxNode fields we access. */
interface TreeSitterSyntaxNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  isNamed: boolean;
  fieldName: string | null;
  children: TreeSitterSyntaxNode[];
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

// Use require based on documentation and user feedback
const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript; // Use named import for TypeScript

// --- Service Implementation ---

@injectable()
export class TreeSitterParserService {
  private readonly parserCache: Map<SupportedLanguage, TreeSitterParser> =
    new Map();
  private readonly languageGrammars: Map<
    SupportedLanguage,
    TreeSitterLanguage
  > = new Map();
  private isInitialized = false;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    this.logger.info(
      'TreeSitterParserService created. Initialization required.'
    );
  }

  // --- Initialization ---

  /**
   * Initializes the service by loading required Tree-sitter grammars.
   * This method is idempotent.
   * @returns A Result indicating success or failure of initialization.
   */
  initialize(): Result<void, Error> {
    // Synchronous
    this.logger.debug(
      `Initialize called. Current state: isInitialized=${this.isInitialized}`
    );
    if (this.isInitialized) {
      this.logger.debug('Already initialized.');
      return Result.ok(undefined);
    }

    this.logger.info('Initializing Tree-sitter grammars via require...');
    try {
      // Store the required grammar modules directly
      this.languageGrammars.set('javascript', JavaScript);
      this.languageGrammars.set('typescript', TypeScript);
      // Add other languages if needed

      this.isInitialized = true;
      this.logger.info('Tree-sitter grammars initialized successfully.');
      return Result.ok(undefined);
    } catch (error) {
      this.isInitialized = false;
      const initError = this._handleAndLogError(
        'TreeSitterParserService grammar require() initialization failed',
        error
      );
      return Result.err(initError);
    }
  }

  // --- Language & Grammar Handling ---

  private getLanguageFromExtension(
    filePath: string
  ): SupportedLanguage | undefined {
    const ext = path.extname(filePath).toLowerCase();
    return EXTENSION_LANGUAGE_MAP[ext];
  }

  /**
   * Retrieves the pre-loaded language grammar. Ensures service is initialized.
   * @param language The language grammar to retrieve.
   * @returns A Result containing the Language object or an error if not initialized or not found.
   */
  private _getPreloadedGrammar(
    // Synchronous
    language: SupportedLanguage
  ): Result<TreeSitterLanguage, Error> {
    if (!this.isInitialized) {
      this.logger.debug(
        `_getPreloadedGrammar: Service not initialized. Triggering initialize().`
      );
      const initResult = this.initialize(); // Call synchronous initialize
      if (initResult.isErr()) {
        return Result.err(
          new Error(
            `Initialization failed before getting preloaded grammar: ${
              initResult.error?.message ?? 'Unknown error'
            }`
          )
        );
      }
      if (!this.isInitialized) {
        return Result.err(
          this._handleAndLogError(
            'Initialization race condition or unexpected error',
            new Error(
              'isInitialized still false after successful initialize() call'
            )
          )
        );
      }
      this.logger.debug(`_getPreloadedGrammar: Initialization completed.`);
    }

    const grammar = this.languageGrammars.get(language);
    if (!grammar) {
      return Result.err(
        this._handleAndLogError(
          `Grammar for language ${language} not found in pre-loaded cache after successful initialization`,
          new Error(`Grammar not found: ${language}`)
        )
      );
    }
    this.logger.debug(
      `Retrieved pre-loaded grammar for language: ${language}.`
    );
    return Result.ok(grammar);
  }

  // --- Parser Caching & Creation ---

  /**
   * Attempts to retrieve a parser from the cache and verifies its language module.
   * @param language - The language of the parser to retrieve.
   * @returns A Result containing the cached parser if valid, or an error/null if not found or invalid.
   */
  private _getCachedParser(
    language: SupportedLanguage
  ): Result<TreeSitterParser | null, Error> {
    if (!this.parserCache.has(language)) {
      return Result.ok(null);
    }

    this.logger.debug(`Using cached parser for language: ${language}`);
    const cachedParser = this.parserCache.get(language) as TreeSitterParser;

    const grammarResult = this._getPreloadedGrammar(language); // Call synchronous method
    if (grammarResult.isErr()) {
      this.parserCache.delete(language);
      return Result.err(
        new Error(
          `Failed to re-verify pre-loaded grammar for cached ${language}: ${
            grammarResult.error?.message ?? 'Unknown error'
          }`
        )
      );
    }

    try {
      cachedParser.setLanguage(grammarResult.value);
      return Result.ok(cachedParser);
    } catch (error: unknown) {
      this.parserCache.delete(language);
      return Result.err(
        this._handleAndLogError(
          `Failed to set language on cached parser for ${language}`,
          error
        )
      );
    }
  }

  /**
   * Creates a new parser instance, loads its language, and caches it.
   * @param language - The language for the new parser.
   * @returns A Result containing the newly created parser or an error.
   */
  private _createAndCacheParser(
    language: SupportedLanguage
  ): Result<TreeSitterParser, Error> {
    this.logger.info(`Creating new parser for language: ${language}`);

    const grammarResult = this._getPreloadedGrammar(language); // Call synchronous method
    if (grammarResult.isErr()) {
      return Result.err(
        grammarResult.error ?? new Error('Unknown grammar error')
      );
    }

    try {
      const parser = new Parser(); // Use require'd Parser constructor
      parser.setLanguage(grammarResult.value);
      this.parserCache.set(language, parser);
      this.logger.info(
        `Successfully created and cached parser for language: ${language}`
      );
      return Result.ok(parser);
    } catch (error: unknown) {
      return Result.err(
        this._handleAndLogError(
          `Failed to create or set language for new parser for ${language}`,
          error
        )
      );
    }
  }

  /**
   * Retrieves or creates a Tree-sitter parser instance for the specified language.
   * Uses caching to avoid redundant loading.
   * @param language - The language for the parser.
   * @returns A Result containing the parser instance or an error.
   */
  private getOrCreateParser(
    language: SupportedLanguage
  ): Result<TreeSitterParser | null, Error> {
    const cachedResult = this._getCachedParser(language); // Call synchronous method

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
    node: TreeSitterSyntaxNode,
    currentDepth = 0,
    maxDepth: number | null = null // Optional depth limit
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
        fieldName: node.fieldName || null, // Corrected property name
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
      fieldName: node.fieldName || null, // Corrected property name
      children: children.map((child: TreeSitterSyntaxNode) =>
        this._convertNodeToGenericAst(child, currentDepth + 1, maxDepth)
      ),
    };
  }

  // --- Public API ---

  parse(
    content: string,
    language: SupportedLanguage
  ): Result<GenericAstNode, Error> {
    // Updated return type
    this.logger.info(
      `Parsing content for language: ${language} to generate generic AST`
    ); // Updated log

    const initResult = this.initialize();
    if (initResult.isErr()) {
      return Result.err(initResult.error ?? new Error('Unknown init error'));
    }

    const parserResult = this.getOrCreateParser(language);
    if (parserResult.isErr()) {
      return Result.err(
        parserResult.error ?? new Error('Unknown parser error')
      );
    }
    const parser = parserResult.value;

    let tree: TreeSitterTree;
    try {
      if (!parser) {
        throw new Error('Parser instance is null or undefined before parsing.');
      }
      tree = parser.parse(content);
      if (!tree?.rootNode) {
        throw new Error('Parsing resulted in an undefined tree or rootNode.');
      }
      this.logger.debug(
        `Successfully created syntax tree for language: ${language}. Root node type: ${tree.rootNode.type}`
      );

      // --- NEW: Convert tree to generic AST ---
      // Consider passing a maxDepth from config or keep it null/hardcoded for now
      const genericAstRoot = this._convertNodeToGenericAst(
        tree.rootNode,
        0,
        null
      );
      this.logger.info(
        `Successfully converted AST to generic JSON format for language: ${language}.`
      ); // Updated log
      return Result.ok(genericAstRoot);
      // --- END NEW ---
    } catch (error: unknown) {
      return Result.err(
        this._handleAndLogError(
          `Error during Tree-sitter parsing or AST conversion for ${language}`,
          error
        ) // Updated log context
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
  query(
    content: string,
    language: SupportedLanguage,
    queryString: string
  ): Result<QueryMatch[], Error> {
    this.logger.debug(`Running query for language: ${language}`);

    const initResult = this.initialize();
    if (initResult.isErr()) {
      return Result.err(initResult.error ?? new Error('Unknown init error'));
    }

    const parserResult = this.getOrCreateParser(language);
    if (parserResult.isErr()) {
      return Result.err(
        parserResult.error ?? new Error('Unknown parser error')
      );
    }
    const parser = parserResult.value;

    const grammarResult = this._getPreloadedGrammar(language);
    if (grammarResult.isErr()) {
      return Result.err(
        grammarResult.error ?? new Error('Unknown grammar error')
      );
    }
    const grammar = grammarResult.value;

    try {
      const tree = parser.parse(content);
      if (!tree?.rootNode) {
        throw new Error('Parsing resulted in an undefined tree or rootNode.');
      }

      // Create and run the query using Parser.Query constructor
      // tree-sitter requires new Parser.Query(language, queryString)
      const query = new Parser.Query(grammar, queryString);
      const matches = query.matches(tree.rootNode);

      // Convert matches to our QueryMatch format
      const results: QueryMatch[] = matches.map(
        (match: {
          pattern: number;
          captures: { name: string; node: TreeSitterSyntaxNode }[];
        }) => ({
          pattern: match.pattern,
          captures: match.captures.map(
            (capture: { name: string; node: TreeSitterSyntaxNode }) => ({
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
            })
          ),
        })
      );

      this.logger.debug(
        `Query returned ${results.length} matches for language: ${language}`
      );
      return Result.ok(results);
    } catch (error: unknown) {
      return Result.err(
        this._handleAndLogError(
          `Error during tree-sitter query for ${language}`,
          error
        )
      );
    }
  }

  /**
   * Executes the pre-configured function query for the given language.
   * @param content The source code content
   * @param language The language of the source code
   * @returns Query matches for functions, methods, and arrow functions
   */
  queryFunctions(
    content: string,
    language: SupportedLanguage
  ): Result<QueryMatch[], Error> {
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
  queryClasses(
    content: string,
    language: SupportedLanguage
  ): Result<QueryMatch[], Error> {
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
  queryImports(
    content: string,
    language: SupportedLanguage
  ): Result<QueryMatch[], Error> {
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
  queryExports(
    content: string,
    language: SupportedLanguage
  ): Result<QueryMatch[], Error> {
    const queries = LANGUAGE_QUERIES_MAP[language];
    if (!queries.exportQuery) {
      return Result.ok([]);
    }
    return this.query(content, language, queries.exportQuery);
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
