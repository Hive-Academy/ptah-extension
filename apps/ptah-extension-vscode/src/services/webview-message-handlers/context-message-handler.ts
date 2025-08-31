import * as vscode from 'vscode';
import {
  BaseWebviewMessageHandler,
  StrictPostMessageFunction,
  IWebviewMessageHandler,
} from './base-message-handler';
import {
  StrictMessageType,
  MessagePayloadMap,
  MessageResponse,
  ContextUpdatePayload,
  ContextSearchFilesPayload,
  ContextGetAllFilesPayload,
  ContextGetFileSuggestionsPayload,
  ContextSearchImagesPayload,
} from '@ptah-extension/shared';
import { CorrelationId } from '@ptah-extension/shared';
import { ContextManager } from '../context-manager';
import { Logger } from '../../core/logger';

/**
 * Context Message Types - Strict type definition
 */
type ContextMessageTypes =
  | 'context:getFiles'
  | 'context:includeFile'
  | 'context:excludeFile'
  | 'context:searchFiles'
  | 'context:getAllFiles'
  | 'context:getFileSuggestions'
  | 'context:searchImages';

/**
 * ContextMessageHandler - Single Responsibility: Handle context management messages
 */
export class ContextMessageHandler
  extends BaseWebviewMessageHandler<ContextMessageTypes>
  implements IWebviewMessageHandler<ContextMessageTypes>
{
  readonly messageType = 'context:';

  constructor(
    postMessage: StrictPostMessageFunction,
    private contextManager: ContextManager
  ) {
    super(postMessage);
  }

  async handle<K extends ContextMessageTypes>(
    messageType: K,
    payload: MessagePayloadMap[K]
  ): Promise<MessageResponse> {
    try {
      switch (messageType) {
        case 'context:getFiles':
          return await this.handleGetContextFiles();
        case 'context:includeFile':
          return await this.handleIncludeFile(payload as { filePath: string });
        case 'context:excludeFile':
          return await this.handleExcludeFile(payload as { filePath: string });
        case 'context:searchFiles':
          return await this.handleSearchFiles(payload as ContextSearchFilesPayload);
        case 'context:getAllFiles':
          return await this.handleGetAllFiles(payload as ContextGetAllFilesPayload);
        case 'context:getFileSuggestions':
          return await this.handleGetFileSuggestions(payload as ContextGetFileSuggestionsPayload);
        case 'context:searchImages':
          return await this.handleSearchImages(payload as ContextSearchImagesPayload);
        default:
          throw new Error(`Unknown context message type: ${messageType}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Context handler error';
      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'CONTEXT_HANDLER_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }

  private async handleGetContextFiles(): Promise<MessageResponse> {
    try {
      const context = this.contextManager.getCurrentContext();
      const workspaceFiles = await this.getWorkspaceFiles();

      const data = {
        files: workspaceFiles,
        context: context,
      };

      this.postMessage({
        type: 'context:filesLoaded',
        payload: data,
      });

      return {
        requestId: CorrelationId.create(),
        success: true,
        data,
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get context files';
      this.postMessage({
        type: 'context:error',
        payload: { message: errorMessage },
      });

      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'CONTEXT_FILES_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }

  private async handleIncludeFile(data: { filePath: string }): Promise<MessageResponse> {
    try {
      await this.contextManager.includeFile(vscode.Uri.file(data.filePath));

      const responseData = { filePath: data.filePath };

      this.postMessage({
        type: 'context:fileIncluded',
        payload: responseData,
      });

      return {
        requestId: CorrelationId.create(),
        success: true,
        data: responseData,
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to include file';
      this.postMessage({
        type: 'context:error',
        payload: { message: errorMessage },
      });

      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'FILE_INCLUDE_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }

  private async handleExcludeFile(data: { filePath: string }): Promise<MessageResponse> {
    try {
      await this.contextManager.excludeFile(vscode.Uri.file(data.filePath));

      const responseData = { filePath: data.filePath };

      this.postMessage({
        type: 'context:fileExcluded',
        payload: responseData,
      });

      return {
        requestId: CorrelationId.create(),
        success: true,
        data: responseData,
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to exclude file';
      this.postMessage({
        type: 'context:error',
        payload: { message: errorMessage },
      });

      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'FILE_EXCLUDE_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }

  /**
   * Get all workspace files for the file tree
   */
  private async getWorkspaceFiles(): Promise<any[]> {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceRoot) {
        return [];
      }

      // Get all files in workspace (excluding common ignore patterns)
      const filePattern = new vscode.RelativePattern(workspaceRoot, '**/*');
      const excludePattern = '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/.vscode/**}';

      const files = await vscode.workspace.findFiles(filePattern, excludePattern, 10000);

      const fileList = await Promise.all(
        files.map(async (uri) => {
          try {
            const relativePath = vscode.workspace.asRelativePath(uri);
            const stat = await vscode.workspace.fs.stat(uri);

            // Estimate tokens (rough approximation: 1 token per 4 characters)
            let tokenEstimate = 0;
            if (stat.type === vscode.FileType.File) {
              try {
                const content = await vscode.workspace.fs.readFile(uri);
                tokenEstimate = Math.ceil(content.length / 4);
              } catch {
                // If we can't read the file, estimate based on size
                tokenEstimate = Math.ceil(stat.size / 4);
              }
            }

            return {
              path: relativePath,
              name: uri.path.split('/').pop() || 'unknown',
              type: stat.type === vscode.FileType.File ? 'file' : 'directory',
              size: stat.size,
              tokenEstimate: stat.type === vscode.FileType.File ? tokenEstimate : undefined,
            };
          } catch (error) {
            // If we can't get file info, return basic info
            const relativePath = vscode.workspace.asRelativePath(uri);
            return {
              path: relativePath,
              name: uri.path.split('/').pop() || 'unknown',
              type: 'file',
              size: 0,
              tokenEstimate: 0,
            };
          }
        })
      );

      // Sort files by path for consistent tree building
      return fileList.sort((a, b) => a.path.localeCompare(b.path));
    } catch (error) {
      Logger.error('Error getting workspace files:', error);
      return [];
    }
  }

  /**
   * Enhanced File Search Handlers - For @ syntax autocomplete
   */

  private async handleSearchFiles(data: ContextSearchFilesPayload): Promise<MessageResponse> {
    try {
      const results = await this.contextManager.searchFiles({
        query: data.query,
        includeImages: data.includeImages,
        maxResults: data.maxResults,
        fileTypes: data.fileTypes ? [...data.fileTypes] : undefined,
        sortBy: 'relevance',
      });

      const responseData = {
        query: data.query,
        results: results.map((result) => ({
          uri: result.uri.toString(),
          relativePath: result.relativePath,
          fileName: result.fileName,
          fileType: result.fileType,
          size: result.size,
          lastModified: result.lastModified,
          isDirectory: result.isDirectory,
        })),
      };

      this.postMessage({
        type: 'context:searchResults',
        payload: responseData,
      });

      return {
        requestId: CorrelationId.create(),
        success: true,
        data: responseData,
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to search files';
      this.postMessage({
        type: 'context:error',
        payload: { message: errorMessage },
      });
      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'FILE_SEARCH_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }

  private async handleGetAllFiles(data: ContextGetAllFilesPayload): Promise<MessageResponse> {
    try {
      const results = await this.contextManager.getAllFiles(
        data.includeImages,
        data.offset,
        data.limit
      );

      const responseData = {
        files: results.map((result) => ({
          uri: result.uri.toString(),
          relativePath: result.relativePath,
          fileName: result.fileName,
          fileType: result.fileType,
          size: result.size,
          lastModified: result.lastModified,
          isDirectory: result.isDirectory,
        })),
        offset: data.offset || 0,
        limit: data.limit || 1000,
        hasMore: results.length === (data.limit || 1000),
      };

      this.postMessage({
        type: 'context:allFiles',
        payload: responseData,
      });

      return {
        requestId: CorrelationId.create(),
        success: true,
        data: responseData,
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get all files';
      this.postMessage({
        type: 'context:error',
        payload: { message: errorMessage },
      });
      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'GET_ALL_FILES_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }

  private async handleGetFileSuggestions(
    data: ContextGetFileSuggestionsPayload
  ): Promise<MessageResponse> {
    try {
      const suggestions = await this.contextManager.getFileSuggestions(data.query, data.limit);

      const responseData = {
        query: data.query,
        suggestions: suggestions.map((result) => ({
          uri: result.uri.toString(),
          relativePath: result.relativePath,
          fileName: result.fileName,
          fileType: result.fileType,
          size: result.size,
          lastModified: result.lastModified,
          isDirectory: result.isDirectory,
        })),
      };

      this.postMessage({
        type: 'context:fileSuggestions',
        payload: responseData,
      });

      return {
        requestId: CorrelationId.create(),
        success: true,
        data: responseData,
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to get file suggestions';
      this.postMessage({
        type: 'context:error',
        payload: { message: errorMessage },
      });
      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'FILE_SUGGESTIONS_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }

  private async handleSearchImages(data: ContextSearchImagesPayload): Promise<MessageResponse> {
    try {
      const results = await this.contextManager.searchImageFiles(data.query);

      const responseData = {
        query: data.query,
        images: results.map((result) => ({
          uri: result.uri.toString(),
          relativePath: result.relativePath,
          fileName: result.fileName,
          fileType: result.fileType,
          size: result.size,
          lastModified: result.lastModified,
          isDirectory: result.isDirectory,
        })),
      };

      this.postMessage({
        type: 'context:imageResults',
        payload: responseData,
      });

      return {
        requestId: CorrelationId.create(),
        success: true,
        data: responseData,
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to search images';
      this.postMessage({
        type: 'context:error',
        payload: { message: errorMessage },
      });
      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'IMAGE_SEARCH_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }
}
