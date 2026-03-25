/**
 * Context Orchestration Service
 * Business logic layer for workspace context management operations
 *
 * Migrated from: apps/ptah-extension-vscode/src/services/webview-message-handlers/context-message-handler.ts (523 lines)
 * Extracted business logic: ~400 lines
 *
 * Verification trail:
 * - Source handler analyzed: context-message-handler.ts:1-523
 * - Dependency verified: ContextService from @ptah-extension/workspace-intelligence (context.service.ts:89)
 * - Pattern: Using ContextService from workspace-intelligence library
 * - ContextService already implements required functionality ✓
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { ContextService } from './context.service';
import type { FileSearchResult, FileSearchOptions } from './context.service';
import type { CorrelationId } from '@ptah-extension/shared';
import { DependencyGraphService } from '../ast/dependency-graph.service';
import { ContextSizeOptimizerService } from '../context-analysis/context-size-optimizer.service';

/**
 * VS Code Uri interface (minimal, for type safety without vscode dependency)
 */
export interface VsCodeUri {
  fsPath: string;
  path: string;
  scheme: string;
  toString(): string;
}

/**
 * Request/Response Types for Context Operations
 */

export interface GetContextFilesRequest {
  requestId: CorrelationId;
}

export interface GetContextFilesResult {
  success: boolean;
  data?: {
    files: unknown[]; // Workspace files with metadata
    context: {
      includedFiles: string[];
      excludedFiles: string[];
      tokenEstimate: number;
      optimizationSuggestions?: unknown[];
    };
  };
  error?: {
    code: string;
    message: string;
  };
}

export interface IncludeFileRequest {
  requestId: CorrelationId;
  filePath: string;
}

export interface IncludeFileResult {
  success: boolean;
  filePath?: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface ExcludeFileRequest {
  requestId: CorrelationId;
  filePath: string;
}

export interface ExcludeFileResult {
  success: boolean;
  filePath?: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface SearchFilesRequest {
  requestId: CorrelationId;
  query: string;
  includeImages?: boolean;
  maxResults?: number;
  fileTypes?: string[];
}

export interface SearchFilesResult {
  success: boolean;
  query?: string;
  results?: Array<{
    uri: string;
    relativePath: string;
    fileName: string;
    fileType: string;
    size: number;
    lastModified: number;
    isDirectory: boolean;
  }>;
  error?: {
    code: string;
    message: string;
  };
}

export interface GetAllFilesRequest {
  requestId: CorrelationId;
  includeImages?: boolean;
  offset?: number;
  limit?: number;
}

export interface GetAllFilesResult {
  success: boolean;
  files?: Array<{
    uri: string;
    relativePath: string;
    fileName: string;
    fileType: string;
    size: number;
    lastModified: number;
    isDirectory: boolean;
  }>;
  offset?: number;
  limit?: number;
  hasMore?: boolean;
  error?: {
    code: string;
    message: string;
  };
}

export interface GetFileSuggestionsRequest {
  requestId: CorrelationId;
  query: string;
  limit?: number;
}

export interface GetFileSuggestionsResult {
  success: boolean;
  query?: string;
  suggestions?: Array<{
    uri: string;
    relativePath: string;
    fileName: string;
    fileType: string;
    size: number;
    lastModified: number;
    isDirectory: boolean;
  }>;
  error?: {
    code: string;
    message: string;
  };
}

export interface SearchImagesRequest {
  requestId: CorrelationId;
  query: string;
}

export interface SearchImagesResult {
  success: boolean;
  query?: string;
  images?: Array<{
    uri: string;
    relativePath: string;
    fileName: string;
    fileType: string;
    size: number;
    lastModified: number;
    isDirectory: boolean;
  }>;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Helper function to convert FileSearchResult to serializable format
 * FIXED: Added fsPath for file system path (required by attachment processor)
 * The uri field contains URI string (file:///...), fsPath contains actual file system path
 */
function formatFileResult(result: FileSearchResult) {
  return {
    uri: result.path,
    fsPath: result.path, // Actual file system path for attachment processing
    relativePath: result.relativePath,
    fileName: result.fileName,
    fileType: result.fileType,
    size: result.size,
    lastModified: result.lastModified,
    isDirectory: result.isDirectory,
  };
}

/**
 * Context Orchestration Service
 * Handles all context management business logic
 *
 * Business Logic Extracted from context-message-handler.ts:
 * - Get context files (handleGetContextFiles)
 * - Include file in context (handleIncludeFile)
 * - Exclude file from context (handleExcludeFile)
 * - Search files with filters (handleSearchFiles)
 * - Get all workspace files (handleGetAllFiles)
 * - Get file suggestions for autocomplete (handleGetFileSuggestions)
 * - Search for image files (handleSearchImages)
 */
@injectable()
export class ContextOrchestrationService {
  constructor(
    @inject(TOKENS.CONTEXT_SERVICE)
    private readonly contextService: ContextService,
    @inject(TOKENS.DEPENDENCY_GRAPH_SERVICE)
    private readonly dependencyGraph: DependencyGraphService,
    @inject(TOKENS.CONTEXT_SIZE_OPTIMIZER)
    private readonly contextSizeOptimizer: ContextSizeOptimizerService
  ) {
    // Wire DependencyGraphService into the optimizer so it can use dependency
    // data for relevance scoring. The optimizer holds an optional reference
    // (not constructor-injected) because it was created before the graph service.
    this.contextSizeOptimizer.setDependencyGraph(this.dependencyGraph);
  }

  /**
   * Get current context files and workspace structure
   * Extracted from: context-message-handler.ts:75-119
   *
   * Note: This method requires access to vscode.workspace API to get workspace files
   * The main app handler will need to provide this data
   */
  async getContextFiles(
    request: GetContextFilesRequest,
    workspaceFiles: unknown[]
  ): Promise<GetContextFilesResult> {
    try {
      const context = this.contextService.getCurrentContext();

      const data = {
        files: workspaceFiles,
        context: {
          includedFiles: context.includedFiles,
          excludedFiles: context.excludedFiles,
          tokenEstimate: context.tokenEstimate,
          optimizationSuggestions: context.optimizations,
        },
      };

      return {
        success: true,
        data,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to get context files';
      return {
        success: false,
        error: {
          code: 'CONTEXT_FILES_ERROR',
          message: errorMessage,
        },
      };
    }
  }

  /**
   * Include a file in the context
   * Extracted from: context-message-handler.ts:121-152
   *
   * @param request - Request with file path
   * @param uri - VS Code URI object (passed from main app to avoid vscode dependency)
   */
  async includeFile(
    request: IncludeFileRequest,
    uri: VsCodeUri
  ): Promise<IncludeFileResult> {
    try {
      // Cast to unknown first, then to expected type to satisfy ContextService vscode.Uri requirement
      // The main app will pass the actual vscode.Uri object
      await this.contextService.includeFile(
        uri as unknown as Parameters<ContextService['includeFile']>[0]
      );

      return {
        success: true,
        filePath: request.filePath,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to include file';
      return {
        success: false,
        error: {
          code: 'FILE_INCLUDE_ERROR',
          message: errorMessage,
        },
      };
    }
  }

  /**
   * Exclude a file from the context
   * Extracted from: context-message-handler.ts:154-185
   *
   * @param request - Request with file path
   * @param uri - VS Code URI object (passed from main app to avoid vscode dependency)
   */
  async excludeFile(
    request: ExcludeFileRequest,
    uri: VsCodeUri
  ): Promise<ExcludeFileResult> {
    try {
      // Cast to unknown first, then to expected type to satisfy ContextService vscode.Uri requirement
      await this.contextService.excludeFile(
        uri as unknown as Parameters<ContextService['excludeFile']>[0]
      );

      return {
        success: true,
        filePath: request.filePath,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to exclude file';
      return {
        success: false,
        error: {
          code: 'FILE_EXCLUDE_ERROR',
          message: errorMessage,
        },
      };
    }
  }

  /**
   * Search files with filters
   * Extracted from: context-message-handler.ts:312-357
   */
  async searchFiles(request: SearchFilesRequest): Promise<SearchFilesResult> {
    try {
      const options: FileSearchOptions = {
        query: request.query,
        includeImages: request.includeImages,
        maxResults: request.maxResults,
        fileTypes: request.fileTypes ? [...request.fileTypes] : undefined,
        sortBy: 'relevance',
      };

      const results = await this.contextService.searchFiles(options);

      return {
        success: true,
        query: request.query,
        results: results.map(formatFileResult),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to search files';
      return {
        success: false,
        error: {
          code: 'FILE_SEARCH_ERROR',
          message: errorMessage,
        },
      };
    }
  }

  /**
   * Get all workspace files with pagination
   * Extracted from: context-message-handler.ts:359-404
   */
  async getAllFiles(request: GetAllFilesRequest): Promise<GetAllFilesResult> {
    try {
      const results = await this.contextService.getAllFiles(
        request.includeImages,
        request.offset,
        request.limit
      );

      return {
        success: true,
        files: results.map(formatFileResult),
        offset: request.offset || 0,
        limit: request.limit || 1000,
        hasMore: results.length === (request.limit || 1000),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to get all files';
      return {
        success: false,
        error: {
          code: 'GET_ALL_FILES_ERROR',
          message: errorMessage,
        },
      };
    }
  }

  /**
   * Get file suggestions for autocomplete
   * Extracted from: context-message-handler.ts:406-442
   */
  async getFileSuggestions(
    request: GetFileSuggestionsRequest
  ): Promise<GetFileSuggestionsResult> {
    try {
      const suggestions = await this.contextService.getFileSuggestions(
        request.query,
        request.limit
      );

      return {
        success: true,
        query: request.query,
        suggestions: suggestions.map(formatFileResult),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to get file suggestions';
      return {
        success: false,
        error: {
          code: 'FILE_SUGGESTIONS_ERROR',
          message: errorMessage,
        },
      };
    }
  }

  /**
   * Search for image files
   * Extracted from: context-message-handler.ts:444-479
   */
  async searchImages(
    request: SearchImagesRequest
  ): Promise<SearchImagesResult> {
    try {
      const results = await this.contextService.searchImageFiles(request.query);

      return {
        success: true,
        query: request.query,
        images: results.map(formatFileResult),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to search images';
      return {
        success: false,
        error: {
          code: 'IMAGE_SEARCH_ERROR',
          message: errorMessage,
        },
      };
    }
  }
}
