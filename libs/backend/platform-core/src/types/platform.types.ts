/**
 * Platform Abstraction Types
 *
 * Platform-agnostic types replacing VS Code-specific types.
 * These types have ZERO dependency on 'vscode' module.
 */

// ============================================================
// Disposable Pattern
// ============================================================

/**
 * Resource that can be disposed.
 * Replaces: vscode.Disposable
 */
export interface IDisposable {
  dispose(): void;
}

// ============================================================
// Event System
// ============================================================

/**
 * Event subscription handler.
 * Replaces: vscode.Event<T>
 *
 * Usage:
 *   const disposable = event((data) => { ... });
 *   disposable.dispose(); // unsubscribe
 */
export type IEvent<T> = (listener: (e: T) => void) => IDisposable;

// ============================================================
// File System Types
// ============================================================

/**
 * File type enumeration.
 * Replaces: vscode.FileType
 */
export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

/**
 * File metadata.
 * Replaces: vscode.FileStat
 */
export interface FileStat {
  readonly type: FileType;
  readonly ctime: number;
  readonly mtime: number;
  readonly size: number;
}

/**
 * Directory entry.
 * Replaces: [string, vscode.FileType] tuple from readDirectory()
 */
export interface DirectoryEntry {
  readonly name: string;
  readonly type: FileType;
}

/**
 * File watcher for monitoring file system changes.
 * Replaces: vscode.FileSystemWatcher
 */
export interface IFileWatcher extends IDisposable {
  readonly onDidChange: IEvent<string>;
  readonly onDidCreate: IEvent<string>;
  readonly onDidDelete: IEvent<string>;
}

// ============================================================
// Progress
// ============================================================

/**
 * Progress reporter.
 * Replaces: vscode.Progress<{ message?: string; increment?: number }>
 */
export interface IProgress {
  report(value: { message?: string; increment?: number }): void;
}

/**
 * Progress options for withProgress().
 * Replaces: vscode.ProgressOptions
 */
export interface ProgressOptions {
  readonly title: string;
  readonly cancellable?: boolean;
  /**
   * Location hint: 'notification' | 'window' | 'statusbar'
   * Implementations map this to platform-specific locations.
   */
  readonly location?: 'notification' | 'window' | 'statusbar';
}

// ============================================================
// Quick Pick / Input Box
// ============================================================

/**
 * Quick pick item.
 * Replaces: vscode.QuickPickItem
 */
export interface QuickPickItem {
  readonly label: string;
  readonly description?: string;
  readonly detail?: string;
  readonly picked?: boolean;
  readonly alwaysShow?: boolean;
}

/**
 * Quick pick options.
 * Replaces: vscode.QuickPickOptions
 */
export interface QuickPickOptions {
  readonly title?: string;
  readonly placeHolder?: string;
  readonly canPickMany?: boolean;
  readonly ignoreFocusOut?: boolean;
}

/**
 * Input box options.
 * Replaces: vscode.InputBoxOptions
 */
export interface InputBoxOptions {
  readonly title?: string;
  readonly prompt?: string;
  readonly placeHolder?: string;
  readonly value?: string;
  readonly password?: boolean;
  readonly ignoreFocusOut?: boolean;
  readonly validateInput?: (
    value: string
  ) => string | undefined | Promise<string | undefined>;
}

// ============================================================
// Platform Info
// ============================================================

/**
 * Runtime platform type.
 */
export enum PlatformType {
  VSCode = 'vscode',
  Electron = 'electron',
  CLI = 'cli',
  Web = 'web',
}

/**
 * Platform information.
 * Replaces: vscode.ExtensionContext (extensionPath, storagePath, etc.)
 */
export interface IPlatformInfo {
  readonly type: PlatformType;
  /** Root directory of the extension/application */
  readonly extensionPath: string;
  /** Directory for persistent storage (globalStoragePath equivalent) */
  readonly globalStoragePath: string;
  /** Directory for workspace-scoped storage */
  readonly workspaceStoragePath: string;
}

// ============================================================
// Configuration Change Event
// ============================================================

/**
 * Configuration change event data.
 * Replaces: vscode.ConfigurationChangeEvent
 */
export interface ConfigurationChangeEvent {
  readonly affectsConfiguration: (section: string) => boolean;
}

// ============================================================
// Secret Change Event
// ============================================================

/**
 * Secret change event data.
 * Replaces: vscode.SecretStorageChangeEvent
 */
export interface SecretChangeEvent {
  readonly key: string;
}
