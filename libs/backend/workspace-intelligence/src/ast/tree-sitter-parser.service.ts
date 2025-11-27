import path from 'path';
import { injectable, inject } from 'tsyringe';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import {
  EXTENSION_LANGUAGE_MAP,
  SupportedLanguage,
} from './tree-sitter.config';
import { GenericAstNode } from './ast.types';

// Use require based on documentation and user feedback
const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript; // Use named import for TypeScript

// --- Service Implementation ---

@injectable()
export class TreeSitterParserService {
  // Use 'any' for Parser instance type due to TS issues
  private readonly parserCache: Map<SupportedLanguage, any> = new Map();
  // Use 'any' for Language type
  private readonly languageGrammars: Map<SupportedLanguage, any> = new Map();
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
  ): Result<any, Error> {
    // Use 'any' for Language type
    if (!this.isInitialized) {
      this.logger.debug(
        `_getPreloadedGrammar: Service not initialized. Triggering initialize().`
      );
      const initResult = this.initialize(); // Call synchronous initialize
      if (initResult.isErr()) {
        return Result.err(
          new Error(
            `Initialization failed before getting preloaded grammar: ${
              initResult.error!.message
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
  private _getCachedParser(language: SupportedLanguage): Result<any, Error> {
    // Use 'any' for Parser instance type
    if (!this.parserCache.has(language)) {
      return Result.ok(null);
    }

    this.logger.debug(`Using cached parser for language: ${language}`);
    const cachedParser = this.parserCache.get(language)!;

    const grammarResult = this._getPreloadedGrammar(language); // Call synchronous method
    if (grammarResult.isErr()) {
      this.parserCache.delete(language);
      return Result.err(
        new Error(
          `Failed to re-verify pre-loaded grammar for cached ${language}: ${
            grammarResult.error!.message
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
  ): Result<any, Error> {
    // Use 'any' for Parser instance type
    this.logger.info(`Creating new parser for language: ${language}`);

    const grammarResult = this._getPreloadedGrammar(language); // Call synchronous method
    if (grammarResult.isErr()) {
      return Result.err(grammarResult.error!);
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
  private getOrCreateParser(language: SupportedLanguage): Result<any, Error> {
    // Use 'any' for Parser instance type
    const cachedResult = this._getCachedParser(language); // Call synchronous method

    if (cachedResult.isErr()) {
      return Result.err(cachedResult.error!);
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
    node: any, // Changed from SyntaxNode to 'any' due to TS errors with fieldName/parentFieldName
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
      children: children.map(
        (
          child: any // Explicitly type child as any
        ) => this._convertNodeToGenericAst(child, currentDepth + 1, maxDepth)
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
      return Result.err(initResult.error!);
    }

    const parserResult = this.getOrCreateParser(language);
    if (parserResult.isErr()) {
      return Result.err(parserResult.error!);
    }
    const parser = parserResult.value;

    let tree: any; // Use 'any' for Tree type or import if possible
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
