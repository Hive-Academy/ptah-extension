/**
 * VS Code File System Manager with Enhanced Operations
 * Based on MONSTER_EXTENSION_REFACTOR_PLAN Week 3 specifications
 * Provides comprehensive file system operations with workspace intelligence
 */

import * as vscode from 'vscode';
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../di/tokens';

/**
 * File operation type enumeration
 */
export type FileOperationType =
  | 'read'
  | 'write'
  | 'delete'
  | 'copy'
  | 'move'
  | 'create'
  | 'stat'
  | 'readdir';

/**
 * File operation options
 */
export interface FileOperationOptions {
  readonly create?: boolean;
  readonly overwrite?: boolean;
  readonly exclude?: readonly string[];
  readonly includeHidden?: boolean;
  readonly followSymlinks?: boolean;
}

/**
 * File watcher configuration
 */
export interface FileWatcherConfig {
  readonly id: string;
  readonly pattern: vscode.RelativePattern | string;
  readonly ignoreCreateEvents?: boolean;
  readonly ignoreChangeEvents?: boolean;
  readonly ignoreDeleteEvents?: boolean;
}

/**
 * File operation event payload for event bus
 */
export interface FileOperationPayload {
  readonly operation: FileOperationType;
  readonly uri: string;
  readonly targetUri?: string;
  readonly size?: number;
  readonly timestamp: number;
  readonly workspace?: string;
}

/**
 * File watcher event payload for event bus
 */
export interface FileWatcherEventPayload {
  readonly watcherId: string;
  readonly eventType: 'created' | 'changed' | 'deleted';
  readonly uri: string;
  readonly timestamp: number;
}

/**
 * File system error event payload for event bus
 */
export interface FileSystemErrorPayload {
  readonly operation: FileOperationType;
  readonly uri: string;
  readonly targetUri?: string;
  readonly error: string;
  readonly errorCode?: string;
  readonly timestamp: number;
}

/**
 * VS Code File System Manager with event integration
 * Provides comprehensive file system operations with monitoring and error handling
 */
@injectable()
export class FileSystemManager {
  private readonly activeWatchers = new Map<string, vscode.FileSystemWatcher>();
  private readonly operationMetrics = new Map<
    FileOperationType,
    {
      totalOperations: number;
      successfulOperations: number;
      failedOperations: number;
      totalBytesProcessed: number;
      averageResponseTime: number;
      lastOperation: number;
    }
  >();

  constructor(
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: vscode.ExtensionContext
  ) {
    this.initializeMetrics();
  }

  /**
   * Read file contents with comprehensive error handling
   * Supports both text and binary file reading with workspace context
   *
   * @param uri - File URI to read
   * @param options - Read operation options
   * @returns File contents as Uint8Array
   */
  async readFile(
    uri: vscode.Uri,
    _options?: FileOperationOptions
  ): Promise<Uint8Array> {
    const startTime = Date.now();

    try {
      // Pre-operation validation and tracking
      await this.validateFileOperation(uri, 'read');

      // Perform read operation
      const content = await vscode.workspace.fs.readFile(uri);
      const duration = Date.now() - startTime;

      // Update metrics
      this.updateOperationMetrics('read', true, content.byteLength, duration);

      return content;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.handleFileSystemError('read', uri, undefined, error, duration);
      throw error;
    }
  }

  /**
   * Write file contents with workspace-aware operations
   * Supports creation and overwrite with comprehensive tracking
   *
   * @param uri - Target file URI
   * @param content - Content to write
   * @param options - Write operation options
   */
  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: FileOperationOptions = {}
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Pre-operation validation
      await this.validateFileOperation(uri, 'write');

      // Perform write operation with configured options
      await vscode.workspace.fs.writeFile(uri, content, {
        create: options.create ?? true,
        overwrite: options.overwrite ?? true,
      });
      const duration = Date.now() - startTime;

      // Update metrics
      this.updateOperationMetrics('write', true, content.byteLength, duration);
    } catch (error) {
      const duration = Date.now() - startTime;
      this.handleFileSystemError('write', uri, undefined, error, duration);
      throw error;
    }
  }

  /**
   * Delete file or directory with recursive support
   * Provides comprehensive tracking and error categorization
   *
   * @param uri - URI to delete
   * @param options - Delete operation options
   */
  async delete(
    uri: vscode.Uri,
    _options?: FileOperationOptions
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Pre-operation validation and stat for size tracking
      const stat = await this.stat(uri);
      await this.validateFileOperation(uri, 'delete');

      // Configure delete options
      const deleteOptions = {
        recursive: true, // Enable recursive deletion for directories
        useTrash: false, // Direct deletion for consistency
      };

      // Perform delete operation
      await vscode.workspace.fs.delete(uri, deleteOptions);
      const duration = Date.now() - startTime;

      // Update metrics
      this.updateOperationMetrics('delete', true, stat.size, duration);
    } catch (error) {
      const duration = Date.now() - startTime;
      this.handleFileSystemError('delete', uri, undefined, error, duration);
      throw error;
    }
  }

  /**
   * Copy file or directory with workspace intelligence
   * Handles both single files and recursive directory copying
   *
   * @param source - Source URI
   * @param target - Target URI
   * @param options - Copy operation options
   */
  async copy(
    source: vscode.Uri,
    target: vscode.Uri,
    options: FileOperationOptions = {}
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Pre-operation validation
      const sourceStat = await this.stat(source);
      await this.validateFileOperation(source, 'copy');
      await this.validateFileOperation(target, 'copy');

      // Configure copy options
      const copyOptions = {
        overwrite: options.overwrite ?? false,
      };

      // Perform copy operation
      await vscode.workspace.fs.copy(source, target, copyOptions);
      const duration = Date.now() - startTime;

      // Update metrics
      this.updateOperationMetrics('copy', true, sourceStat.size, duration);
    } catch (error) {
      const duration = Date.now() - startTime;
      this.handleFileSystemError('copy', source, target, error, duration);
      throw error;
    }
  }

  /**
   * Move/rename file or directory
   * Provides atomic move operations with comprehensive tracking
   *
   * @param source - Source URI
   * @param target - Target URI
   * @param options - Move operation options
   */
  async move(
    source: vscode.Uri,
    target: vscode.Uri,
    options: FileOperationOptions = {}
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Pre-operation validation
      const sourceStat = await this.stat(source);
      await this.validateFileOperation(source, 'move');
      await this.validateFileOperation(target, 'move');

      // Configure rename options
      const renameOptions = {
        overwrite: options.overwrite ?? false,
      };

      // Perform move operation (rename in VS Code API)
      await vscode.workspace.fs.rename(source, target, renameOptions);
      const duration = Date.now() - startTime;

      // Update metrics
      this.updateOperationMetrics('move', true, sourceStat.size, duration);
    } catch (error) {
      const duration = Date.now() - startTime;
      this.handleFileSystemError('move', source, target, error, duration);
      throw error;
    }
  }

  /**
   * Get file or directory stats with enhanced information
   * Provides comprehensive file metadata with error handling
   *
   * @param uri - URI to stat
   * @returns File stat information
   */
  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const startTime = Date.now();

    try {
      await this.validateFileOperation(uri, 'stat');

      const stat = await vscode.workspace.fs.stat(uri);
      const duration = Date.now() - startTime;

      // Update metrics
      this.updateOperationMetrics('stat', true, 0, duration);

      return stat;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.handleFileSystemError('stat', uri, undefined, error, duration);
      throw error;
    }
  }

  /**
   * Read directory contents with filtering support
   * Provides comprehensive directory listing with workspace context
   *
   * @param uri - Directory URI to read
   * @param options - Read directory options
   * @returns Array of directory entries
   */
  async readDirectory(
    uri: vscode.Uri,
    options: FileOperationOptions = {}
  ): Promise<Array<[string, vscode.FileType]>> {
    const startTime = Date.now();

    try {
      await this.validateFileOperation(uri, 'readdir');

      const entries = await vscode.workspace.fs.readDirectory(uri);
      const duration = Date.now() - startTime;

      // Apply filtering if specified
      const filteredEntries = this.filterDirectoryEntries(entries, options);

      // Update metrics
      this.updateOperationMetrics(
        'readdir',
        true,
        filteredEntries.length,
        duration
      );

      return filteredEntries;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.handleFileSystemError('readdir', uri, undefined, error, duration);
      throw error;
    }
  }

  /**
   * Create a file system watcher with enhanced configuration
   * Provides centralized watcher management with event routing
   *
   * @param config - Watcher configuration
   * @returns File system watcher
   */
  createWatcher(config: FileWatcherConfig): vscode.FileSystemWatcher {
    if (this.activeWatchers.has(config.id)) {
      // Return existing watcher
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return this.activeWatchers.get(config.id)!;
    }

    // eslint-disable-next-line no-useless-catch
    try {
      // Create watcher with configuration
      const watcher = vscode.workspace.createFileSystemWatcher(
        config.pattern,
        config.ignoreCreateEvents,
        config.ignoreChangeEvents,
        config.ignoreDeleteEvents
      );

      // Set up event handlers with event bus integration
      watcher.onDidCreate((uri) => {
        this.handleWatcherEvent(config.id, 'created', uri);
      });

      watcher.onDidChange((uri) => {
        this.handleWatcherEvent(config.id, 'changed', uri);
      });

      watcher.onDidDelete((uri) => {
        this.handleWatcherEvent(config.id, 'deleted', uri);
      });

      // Store watcher reference
      this.activeWatchers.set(config.id, watcher);

      // Add to extension subscriptions for proper cleanup
      this.context.subscriptions.push(watcher);

      return watcher;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Dispose a specific file watcher
   * Properly cleans up resources and stops tracking
   *
   * @param watcherId - ID of the watcher to dispose
   * @returns True if watcher was disposed, false if not found
   */
  disposeWatcher(watcherId: string): boolean {
    const watcher = this.activeWatchers.get(watcherId);

    if (!watcher) {
      return false;
    }

    try {
      watcher.dispose();
      this.activeWatchers.delete(watcherId);

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get file system operation metrics for monitoring
   *
   * @param operation - Optional specific operation type
   * @returns Metrics for specified operation or all operations
   */
  getOperationMetrics(operation?: FileOperationType) {
    if (operation) {
      return this.operationMetrics.get(operation) || null;
    }

    return Object.fromEntries(this.operationMetrics);
  }

  /**
   * Get list of active watcher IDs
   *
   * @returns Array of active watcher IDs
   */
  getActiveWatchers(): readonly string[] {
    return Array.from(this.activeWatchers.keys());
  }

  /**
   * Dispose all resources
   * Should be called during extension deactivation
   */
  dispose(): void {
    try {
      this.activeWatchers.forEach((watcher) => watcher.dispose());
      this.activeWatchers.clear();
      this.operationMetrics.clear();
    } catch {
      // Silently handle disposal errors
    }
  }

  /**
   * Initialize operation metrics tracking
   */
  private initializeMetrics(): void {
    const operations: FileOperationType[] = [
      'read',
      'write',
      'delete',
      'copy',
      'move',
      'create',
      'stat',
      'readdir',
    ];

    operations.forEach((operation) => {
      this.operationMetrics.set(operation, {
        totalOperations: 0,
        successfulOperations: 0,
        failedOperations: 0,
        totalBytesProcessed: 0,
        averageResponseTime: 0,
        lastOperation: 0,
      });
    });
  }

  /**
   * Validate file operation permissions and constraints
   */
  private async validateFileOperation(
    uri: vscode.Uri,
    operation: FileOperationType
  ): Promise<void> {
    // Basic URI validation
    if (!uri || !uri.scheme) {
      throw new Error(`Invalid URI for ${operation} operation`);
    }

    // For now, basic validation - can be extended with more sophisticated checks
    if (uri.scheme !== 'file' && uri.scheme !== 'untitled') {
      // Allow operations on supported schemes
    }
  }

  /**
   * Get workspace folder for a given URI
   */
  private getWorkspaceForUri(uri: vscode.Uri): string | undefined {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    return workspaceFolder?.name;
  }

  /**
   * Filter directory entries based on options
   */
  private filterDirectoryEntries(
    entries: Array<[string, vscode.FileType]>,
    options: FileOperationOptions
  ): Array<[string, vscode.FileType]> {
    let filtered = entries;

    // Filter hidden files if specified
    if (!options.includeHidden) {
      filtered = filtered.filter(([name]) => !name.startsWith('.'));
    }

    // Apply exclude patterns if specified
    if (options.exclude && options.exclude.length > 0) {
      filtered = filtered.filter(([name]) => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return !options.exclude!.some((pattern) => {
          // Simple pattern matching - can be enhanced with glob patterns
          return name.includes(pattern);
        });
      });
    }

    return filtered;
  }

  /**
   * Handle file system watcher events
   */
  private handleWatcherEvent(
    _watcherId: string,
    _eventType: 'created' | 'changed' | 'deleted',
    _uri: vscode.Uri
  ): void {
    // Handle file watcher events - params reserved for future implementation
    void _watcherId;
    void _eventType;
    void _uri;
  }

  /**
   * Handle file system operation errors with comprehensive categorization
   */
  private handleFileSystemError(
    operation: FileOperationType,
    uri: vscode.Uri,
    targetUri: vscode.Uri | undefined,
    error: unknown,
    duration: number
  ): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.categorizeFileSystemError(errorMessage);

    // Update metrics
    this.updateOperationMetrics(operation, false, 0, duration);
  }

  /**
   * Categorize file system errors for better handling
   */
  private categorizeFileSystemError(errorMessage: string): string {
    const lowerMessage = errorMessage.toLowerCase();
    if (lowerMessage.includes('enoent') || lowerMessage.includes('not found')) {
      return 'FILE_NOT_FOUND';
    }
    if (
      lowerMessage.includes('eacces') ||
      lowerMessage.includes('permission')
    ) {
      return 'PERMISSION_DENIED';
    }
    if (
      lowerMessage.includes('eexist') ||
      lowerMessage.includes('already exists')
    ) {
      return 'FILE_EXISTS';
    }
    if (
      lowerMessage.includes('eisdir') ||
      lowerMessage.includes('is a directory')
    ) {
      return 'IS_DIRECTORY';
    }
    if (
      lowerMessage.includes('enotdir') ||
      lowerMessage.includes('not a directory')
    ) {
      return 'NOT_DIRECTORY';
    }
    if (
      lowerMessage.includes('emfile') ||
      lowerMessage.includes('too many files')
    ) {
      return 'TOO_MANY_FILES';
    }
    return 'UNKNOWN_ERROR';
  }

  /**
   * Update operation metrics for monitoring and debugging
   */
  private updateOperationMetrics(
    operation: FileOperationType,
    success: boolean,
    bytesProcessed: number,
    duration: number
  ): void {
    const metrics = this.operationMetrics.get(operation);
    if (!metrics) return;

    metrics.totalOperations++;
    metrics.lastOperation = Date.now();

    if (success) {
      metrics.successfulOperations++;
      metrics.totalBytesProcessed += bytesProcessed;
    } else {
      metrics.failedOperations++;
    }

    // Update average response time
    const totalDuration =
      metrics.averageResponseTime * (metrics.totalOperations - 1) + duration;
    metrics.averageResponseTime = totalDuration / metrics.totalOperations;
  }
}
