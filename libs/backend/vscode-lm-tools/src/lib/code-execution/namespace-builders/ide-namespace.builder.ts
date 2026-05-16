/**
 * IDE Namespace Builder
 *
 * Builds the IDE namespace with LSP, Editor, Actions, and Testing sub-namespaces.
 * When IIDECapabilities is provided (VS Code), delegates to the platform implementation.
 * When IIDECapabilities is absent (Electron/standalone), returns graceful degradation
 * stubs that return empty arrays, null, or false as appropriate.
 *
 * Sub-namespaces: LSP, Editor, Actions, Testing.
 * Decoupled from `vscode` import via the IIDECapabilities interface.
 */

import type {
  IDENamespace,
  LSPNamespace,
  EditorNamespace,
  ActionsNamespace,
  TestingNamespace,
  Location,
  HoverInfo,
  SignatureHelp,
  ActiveEditorInfo,
  CodeAction,
  TestItem,
  TestRunOptions,
  TestResult,
  CoverageInfo,
  VisibleRange,
} from '../types';

// ========================================
// IIDECapabilities Interface
// ========================================

/**
 * Platform-specific IDE capabilities interface.
 *
 * In VS Code, this is implemented by VscodeIDECapabilities which wraps
 * vscode.commands.executeCommand(), vscode.window.*, and vscode.workspace.* APIs.
 *
 * In Electron/standalone mode, this interface is NOT provided,
 * and buildIDENamespace() returns graceful degradation stubs instead.
 *
 * @see VscodeIDECapabilities in ide-capabilities.vscode.ts
 */
export interface IIDECapabilities {
  /** Language Server Protocol operations */
  lsp: {
    /**
     * Get definition location for symbol at position.
     * @replaces vscode.commands.executeCommand('vscode.executeDefinitionProvider', ...)
     */
    getDefinition(file: string, line: number, col: number): Promise<Location[]>;

    /**
     * Find all references to symbol at position.
     * @replaces vscode.commands.executeCommand('vscode.executeReferenceProvider', ...)
     */
    getReferences(file: string, line: number, col: number): Promise<Location[]>;

    /**
     * Get hover information (types, documentation) at position.
     * @replaces vscode.commands.executeCommand('vscode.executeHoverProvider', ...)
     */
    getHover(
      file: string,
      line: number,
      col: number,
    ): Promise<HoverInfo | null>;

    /**
     * Get type definition location for symbol at position.
     * @replaces vscode.commands.executeCommand('vscode.executeTypeDefinitionProvider', ...)
     */
    getTypeDefinition(
      file: string,
      line: number,
      col: number,
    ): Promise<Location[]>;

    /**
     * Get signature help for function call at position.
     * @replaces vscode.commands.executeCommand('vscode.executeSignatureHelpProvider', ...)
     */
    getSignatureHelp(
      file: string,
      line: number,
      col: number,
    ): Promise<SignatureHelp | null>;
  };

  /** Editor state operations */
  editor: {
    /**
     * Get active editor information (file, cursor position, selection).
     * @replaces vscode.window.activeTextEditor
     */
    getActive(): Promise<ActiveEditorInfo | null>;

    /**
     * Get all currently open files in editor tabs.
     * @replaces vscode.workspace.textDocuments
     */
    getOpenFiles(): Promise<string[]>;

    /**
     * Get all files with unsaved changes.
     * @replaces vscode.workspace.textDocuments (filtered by isDirty)
     */
    getDirtyFiles(): Promise<string[]>;

    /**
     * Get recently accessed files (most recent first).
     * @replaces vscode.window.visibleTextEditors
     */
    getRecentFiles(limit?: number): Promise<string[]>;

    /**
     * Get visible code range in active editor.
     * @replaces vscode.window.activeTextEditor.visibleRanges
     */
    getVisibleRange(): Promise<VisibleRange | null>;
  };

  /** Code actions and refactoring operations */
  actions: {
    /**
     * Get available code actions at position.
     * @replaces vscode.commands.executeCommand('vscode.executeCodeActionProvider', ...)
     */
    getAvailable(file: string, line: number): Promise<CodeAction[]>;

    /**
     * Apply a code action by title.
     * @replaces vscode.workspace.applyEdit() / vscode.commands.executeCommand()
     */
    apply(file: string, line: number, actionTitle: string): Promise<boolean>;

    /**
     * Rename symbol at position across workspace.
     * @replaces vscode.commands.executeCommand('editor.action.rename', ...)
     */
    rename(
      file: string,
      line: number,
      col: number,
      newName: string,
    ): Promise<boolean>;

    /**
     * Organize imports in file.
     * @replaces vscode.commands.executeCommand('editor.action.organizeImports', ...)
     */
    organizeImports(file: string): Promise<boolean>;

    /**
     * Apply all auto-fixes in file with optional kind filter.
     * @replaces vscode.commands.executeCommand('editor.action.fixAll', ...)
     */
    fixAll(file: string, kind?: string): Promise<boolean>;
  };
}

// ========================================
// Graceful Degradation Message
// ========================================

const IDE_NOT_AVAILABLE_MSG =
  'IDE integration not available in standalone mode. This feature requires VS Code.';

// ========================================
// buildIDENamespace
// ========================================

/**
 * Build the complete IDE namespace with all sub-namespaces.
 *
 * When capabilities are provided (VS Code context), delegates LSP, editor,
 * and actions operations to the platform implementation.
 *
 * When capabilities are undefined (Electron/standalone context), returns
 * graceful degradation stubs that return empty arrays, null, or false
 * with descriptive messages.
 *
 * Testing namespace always uses graceful degradation (no test controller dependency).
 *
 * @param capabilities Optional IDE capabilities from the platform implementation
 * @returns IDENamespace with LSP, Editor, Actions, and Testing
 */
export function buildIDENamespace(
  capabilities?: IIDECapabilities,
): IDENamespace {
  if (capabilities) {
    return {
      lsp: buildLSPNamespaceFromCapabilities(capabilities.lsp),
      editor: buildEditorNamespaceFromCapabilities(capabilities.editor),
      actions: buildActionsNamespaceFromCapabilities(capabilities.actions),
      testing: buildTestingNamespace(),
    };
  }

  // Graceful degradation: no IDE capabilities available (Electron/standalone)
  return {
    lsp: buildGracefulLSPNamespace(),
    editor: buildGracefulEditorNamespace(),
    actions: buildGracefulActionsNamespace(),
    testing: buildTestingNamespace(),
  };
}

// ========================================
// Capability-backed Namespace Builders
// ========================================

/**
 * Build LSP namespace that delegates to IIDECapabilities.lsp
 * Adds input validation before delegating to the platform implementation.
 */
function buildLSPNamespaceFromCapabilities(
  lsp: IIDECapabilities['lsp'],
): LSPNamespace {
  return {
    getDefinition: async (
      file: string,
      line: number,
      col: number,
    ): Promise<Location[]> => {
      validateFileInput(file);
      validatePositionInput(line, col);
      return lsp.getDefinition(file, line, col);
    },

    getReferences: async (
      file: string,
      line: number,
      col: number,
    ): Promise<Location[]> => {
      validateFileInput(file);
      validatePositionInput(line, col);
      return lsp.getReferences(file, line, col);
    },

    getHover: async (
      file: string,
      line: number,
      col: number,
    ): Promise<HoverInfo | null> => {
      validateFileInput(file);
      validatePositionInput(line, col);
      return lsp.getHover(file, line, col);
    },

    getTypeDefinition: async (
      file: string,
      line: number,
      col: number,
    ): Promise<Location[]> => {
      validateFileInput(file);
      validatePositionInput(line, col);
      return lsp.getTypeDefinition(file, line, col);
    },

    getSignatureHelp: async (
      file: string,
      line: number,
      col: number,
    ): Promise<SignatureHelp | null> => {
      validateFileInput(file);
      validatePositionInput(line, col);
      return lsp.getSignatureHelp(file, line, col);
    },
  };
}

/**
 * Build Editor namespace that delegates to IIDECapabilities.editor
 */
function buildEditorNamespaceFromCapabilities(
  editor: IIDECapabilities['editor'],
): EditorNamespace {
  return {
    getActive: () => editor.getActive(),
    getOpenFiles: () => editor.getOpenFiles(),
    getDirtyFiles: () => editor.getDirtyFiles(),
    getRecentFiles: (limit?: number) => editor.getRecentFiles(limit),
    getVisibleRange: () => editor.getVisibleRange(),
  };
}

/**
 * Build Actions namespace that delegates to IIDECapabilities.actions
 * Adds input validation before delegating to the platform implementation.
 */
function buildActionsNamespaceFromCapabilities(
  actions: IIDECapabilities['actions'],
): ActionsNamespace {
  return {
    getAvailable: async (file: string, line: number): Promise<CodeAction[]> => {
      validateFileInput(file);
      validateLineInput(line);
      return actions.getAvailable(file, line);
    },

    apply: async (
      file: string,
      line: number,
      actionTitle: string,
    ): Promise<boolean> => {
      validateFileInput(file);
      validateLineInput(line);
      if (!actionTitle || actionTitle.trim().length === 0) {
        throw new Error('Action title cannot be empty');
      }
      return actions.apply(file, line, actionTitle);
    },

    rename: async (
      file: string,
      line: number,
      col: number,
      newName: string,
    ): Promise<boolean> => {
      validateFileInput(file);
      validatePositionInput(line, col);
      if (!newName || newName.trim().length === 0) {
        throw new Error('New name cannot be empty');
      }
      return actions.rename(file, line, col, newName);
    },

    organizeImports: async (file: string): Promise<boolean> => {
      validateFileInput(file);
      return actions.organizeImports(file);
    },

    fixAll: async (file: string, kind?: string): Promise<boolean> => {
      validateFileInput(file);
      return actions.fixAll(file, kind);
    },
  };
}

// ========================================
// Graceful Degradation Namespace Builders
// ========================================

/**
 * Build LSP namespace with graceful degradation stubs.
 * All methods return empty arrays or null with a descriptive message
 * indicating that IDE integration is not available in standalone mode.
 */
function buildGracefulLSPNamespace(): LSPNamespace {
  return {
    getDefinition: async (): Promise<Location[]> => {
      return [];
    },

    getReferences: async (): Promise<Location[]> => {
      return [];
    },

    getHover: async (): Promise<HoverInfo | null> => {
      return null;
    },

    getTypeDefinition: async (): Promise<Location[]> => {
      return [];
    },

    getSignatureHelp: async (): Promise<SignatureHelp | null> => {
      return null;
    },
  };
}

/**
 * Build Editor namespace with graceful degradation stubs.
 * All methods return null or empty arrays since there is no active editor
 * in standalone/Electron mode.
 */
function buildGracefulEditorNamespace(): EditorNamespace {
  return {
    getActive: async (): Promise<ActiveEditorInfo | null> => {
      return null;
    },

    getOpenFiles: async (): Promise<string[]> => {
      return [];
    },

    getDirtyFiles: async (): Promise<string[]> => {
      return [];
    },

    getRecentFiles: async (): Promise<string[]> => {
      return [];
    },

    getVisibleRange: async (): Promise<VisibleRange | null> => {
      return null;
    },
  };
}

/**
 * Build Actions namespace with graceful degradation stubs.
 * All methods return empty arrays or false since code actions
 * require language server integration not available in standalone mode.
 */
function buildGracefulActionsNamespace(): ActionsNamespace {
  return {
    getAvailable: async (): Promise<CodeAction[]> => {
      return [];
    },

    apply: async (): Promise<boolean> => {
      return false;
    },

    rename: async (): Promise<boolean> => {
      return false;
    },

    organizeImports: async (): Promise<boolean> => {
      return false;
    },

    fixAll: async (): Promise<boolean> => {
      return false;
    },
  };
}

// ========================================
// Testing Namespace (always graceful degradation)
// ========================================

/**
 * Build the Testing namespace for test operations.
 *
 * IMPORTANT: VS Code's Testing API requires a TestController to be registered,
 * which is typically owned by test framework extensions (Jest, Mocha, Vitest, etc.).
 * These methods provide a graceful degradation when no test controller is available.
 *
 * For full testing integration, a test framework extension should register a
 * TestController via vscode.tests.createTestController() and populate test items.
 *
 * @returns TestingNamespace with graceful degradation implementations
 */
function buildTestingNamespace(): TestingNamespace {
  return {
    /**
     * Discover tests in the workspace.
     *
     * Note: This method requires a VS Code test controller to be registered.
     * Since test controllers are typically owned by test framework extensions
     * (Jest, Mocha, etc.), this method returns an empty array when no controller
     * is available.
     *
     * @returns Array of test items (empty if no test controller available)
     */
    discover: async (): Promise<TestItem[]> => {
      return [];
    },

    /**
     * Run tests with optional filters.
     *
     * Note: This method requires a VS Code test controller to be registered.
     * Since test controllers are typically owned by test framework extensions,
     * this method returns zero results when no controller is available.
     *
     * @param options Optional test run options (include/exclude patterns, debug mode)
     * @returns Test results with passed/failed/skipped counts
     */
    run: async (options?: TestRunOptions): Promise<TestResult> => {
      void options;
      return {
        passed: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        duration: 0,
      };
    },

    /**
     * Get results from the last test run.
     *
     * Note: This method would require maintaining state from test runs.
     * Since no test controller is available, always returns null.
     *
     * @returns Last test results or null if no tests have been run
     */
    getLastResults: async (): Promise<TestResult | null> => {
      return null;
    },

    /**
     * Get coverage information for a specific file.
     *
     * Note: This method requires test framework integration with coverage tools.
     * Since no test controller is available, always returns null.
     *
     * @param file Absolute file path to get coverage for
     * @returns Coverage info or null if unavailable
     */
    getCoverage: async (file: string): Promise<CoverageInfo | null> => {
      if (!file || file.trim().length === 0) {
        throw new Error('File path cannot be empty');
      }
      return null;
    },
  };
}

// ========================================
// Input Validation Helpers
// ========================================

/**
 * Validate that a file path input is non-empty.
 * @throws Error if file path is empty or whitespace
 */
function validateFileInput(file: string): void {
  if (!file || file.trim().length === 0) {
    throw new Error('File path cannot be empty');
  }
}

/**
 * Validate that line and column inputs are non-negative.
 * @throws Error if line or column is negative
 */
function validatePositionInput(line: number, col: number): void {
  if (line < 0 || col < 0) {
    throw new Error('Line and column must be non-negative');
  }
}

/**
 * Validate that a line input is non-negative.
 * @throws Error if line is negative
 */
function validateLineInput(line: number): void {
  if (line < 0) {
    throw new Error('Line must be non-negative');
  }
}

// Export the IDE_NOT_AVAILABLE_MSG for potential use in error reporting
export { IDE_NOT_AVAILABLE_MSG };
