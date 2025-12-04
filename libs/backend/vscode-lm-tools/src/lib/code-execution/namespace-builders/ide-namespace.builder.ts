/**
 * IDE Namespace Builder
 *
 * Builds the IDE namespace with LSP, Editor, Actions, and Testing sub-namespaces.
 * Provides VS Code-exclusive capabilities impossible to access from outside VS Code.
 *
 * TASK_2025_039 - Phase 4: LSP Namespace Implementation (COMPLETE)
 * - getDefinition(): Go to definition via LSP
 * - getReferences(): Find all references
 * - getHover(): Hover info (types, docs)
 * - getTypeDefinition(): Type definition location
 * - getSignatureHelp(): Function signatures
 *
 * TASK_2025_039 - Phase 5: Editor Namespace Implementation (COMPLETE)
 * - getActive(): Active file, cursor position, selection
 * - getOpenFiles(): All open files in editor tabs
 * - getDirtyFiles(): Files with unsaved changes
 * - getRecentFiles(): Recently accessed files (via visible editors)
 * - getVisibleRange(): Visible code range in active editor
 *
 * Phase 6-7 (Actions, Testing) are stubs for future implementation.
 */

import * as vscode from 'vscode';
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
  VisibleRange,
} from '../types';

/**
 * Build the complete IDE namespace with all sub-namespaces
 * @returns IDENamespace with LSP (implemented) + Editor/Actions/Testing (stubs)
 */
export function buildIDENamespace(): IDENamespace {
  return {
    lsp: buildLSPNamespace(),
    editor: buildEditorNamespace(),
    actions: buildActionsNamespace(),
    testing: buildTestingNamespace(),
  };
}

/**
 * Build the LSP namespace for Language Server Protocol operations
 * Provides access to language intelligence features via VS Code commands
 * @returns LSPNamespace with all 5 LSP methods implemented
 */
function buildLSPNamespace(): LSPNamespace {
  return {
    /**
     * Get definition location for symbol at position
     * Uses vscode.executeDefinitionProvider command
     */
    getDefinition: async (
      file: string,
      line: number,
      col: number
    ): Promise<Location[]> => {
      // Validate inputs
      if (!file || file.trim().length === 0) {
        throw new Error('File path cannot be empty');
      }
      if (line < 0 || col < 0) {
        throw new Error('Line and column must be non-negative');
      }

      try {
        const uri = vscode.Uri.file(file);
        const position = new vscode.Position(line, col);

        const definitions = await vscode.commands.executeCommand<
          vscode.Location[]
        >('vscode.executeDefinitionProvider', uri, position);

        if (!definitions || definitions.length === 0) {
          return [];
        }

        // Convert vscode.Location[] to Location[]
        return definitions.map((def) => ({
          file: def.uri.fsPath,
          line: def.range.start.line,
          column: def.range.start.character,
          endLine: def.range.end.line,
          endColumn: def.range.end.character,
        }));
      } catch (error) {
        throw new Error(
          `Failed to get definition for ${file}:${line}:${col}: ${
            (error as Error).message
          }`
        );
      }
    },

    /**
     * Find all references to symbol at position
     * Uses vscode.executeReferenceProvider command
     */
    getReferences: async (
      file: string,
      line: number,
      col: number
    ): Promise<Location[]> => {
      // Validate inputs
      if (!file || file.trim().length === 0) {
        throw new Error('File path cannot be empty');
      }
      if (line < 0 || col < 0) {
        throw new Error('Line and column must be non-negative');
      }

      try {
        const uri = vscode.Uri.file(file);
        const position = new vscode.Position(line, col);

        const references = await vscode.commands.executeCommand<
          vscode.Location[]
        >('vscode.executeReferenceProvider', uri, position);

        if (!references || references.length === 0) {
          return [];
        }

        // Convert vscode.Location[] to Location[]
        return references.map((ref) => ({
          file: ref.uri.fsPath,
          line: ref.range.start.line,
          column: ref.range.start.character,
          endLine: ref.range.end.line,
          endColumn: ref.range.end.character,
        }));
      } catch (error) {
        throw new Error(
          `Failed to get references for ${file}:${line}:${col}: ${
            (error as Error).message
          }`
        );
      }
    },

    /**
     * Get hover information (types, documentation) at position
     * Uses vscode.executeHoverProvider command
     */
    getHover: async (
      file: string,
      line: number,
      col: number
    ): Promise<HoverInfo | null> => {
      // Validate inputs
      if (!file || file.trim().length === 0) {
        throw new Error('File path cannot be empty');
      }
      if (line < 0 || col < 0) {
        throw new Error('Line and column must be non-negative');
      }

      try {
        const uri = vscode.Uri.file(file);
        const position = new vscode.Position(line, col);

        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
          'vscode.executeHoverProvider',
          uri,
          position
        );

        if (!hovers || hovers.length === 0) {
          return null;
        }

        // Use the first hover result
        const hover = hovers[0];

        // Convert MarkdownString[] or MarkedString[] to string[]
        const contents = hover.contents.map((content) => {
          if (typeof content === 'string') {
            return content;
          } else {
            // MarkdownString has 'value' property
            return content.value;
          }
        });

        const result: HoverInfo = {
          contents,
        };

        // Add range if available
        if (hover.range) {
          result.range = {
            start: {
              file: uri.fsPath,
              line: hover.range.start.line,
              column: hover.range.start.character,
            },
            end: {
              file: uri.fsPath,
              line: hover.range.end.line,
              column: hover.range.end.character,
            },
          };
        }

        return result;
      } catch (error) {
        throw new Error(
          `Failed to get hover info for ${file}:${line}:${col}: ${
            (error as Error).message
          }`
        );
      }
    },

    /**
     * Get type definition location for symbol at position
     * Uses vscode.executeTypeDefinitionProvider command
     */
    getTypeDefinition: async (
      file: string,
      line: number,
      col: number
    ): Promise<Location[]> => {
      // Validate inputs
      if (!file || file.trim().length === 0) {
        throw new Error('File path cannot be empty');
      }
      if (line < 0 || col < 0) {
        throw new Error('Line and column must be non-negative');
      }

      try {
        const uri = vscode.Uri.file(file);
        const position = new vscode.Position(line, col);

        const typeDefinitions = await vscode.commands.executeCommand<
          vscode.Location[]
        >('vscode.executeTypeDefinitionProvider', uri, position);

        if (!typeDefinitions || typeDefinitions.length === 0) {
          return [];
        }

        // Convert vscode.Location[] to Location[]
        return typeDefinitions.map((def) => ({
          file: def.uri.fsPath,
          line: def.range.start.line,
          column: def.range.start.character,
          endLine: def.range.end.line,
          endColumn: def.range.end.character,
        }));
      } catch (error) {
        throw new Error(
          `Failed to get type definition for ${file}:${line}:${col}: ${
            (error as Error).message
          }`
        );
      }
    },

    /**
     * Get signature help for function call at position
     * Uses vscode.executeSignatureHelpProvider command
     */
    getSignatureHelp: async (
      file: string,
      line: number,
      col: number
    ): Promise<SignatureHelp | null> => {
      // Validate inputs
      if (!file || file.trim().length === 0) {
        throw new Error('File path cannot be empty');
      }
      if (line < 0 || col < 0) {
        throw new Error('Line and column must be non-negative');
      }

      try {
        const uri = vscode.Uri.file(file);
        const position = new vscode.Position(line, col);

        const signatureHelp =
          await vscode.commands.executeCommand<vscode.SignatureHelp>(
            'vscode.executeSignatureHelpProvider',
            uri,
            position
          );

        if (!signatureHelp || signatureHelp.signatures.length === 0) {
          return null;
        }

        // Convert vscode.SignatureHelp to SignatureHelp
        return {
          signatures: signatureHelp.signatures.map((sig) => ({
            label: sig.label,
            documentation: sig.documentation
              ? typeof sig.documentation === 'string'
                ? sig.documentation
                : sig.documentation.value
              : undefined,
            parameters:
              sig.parameters?.map((param) => ({
                label:
                  typeof param.label === 'string'
                    ? param.label
                    : sig.label.substring(param.label[0], param.label[1]),
                documentation: param.documentation
                  ? typeof param.documentation === 'string'
                    ? param.documentation
                    : param.documentation.value
                  : undefined,
              })) || [],
          })),
          activeSignature: signatureHelp.activeSignature,
          activeParameter: signatureHelp.activeParameter,
        };
      } catch (error) {
        throw new Error(
          `Failed to get signature help for ${file}:${line}:${col}: ${
            (error as Error).message
          }`
        );
      }
    },
  };
}

/**
 * Build the Editor namespace for editor state operations
 * Provides access to active editor state, open files, and visible ranges
 * @returns EditorNamespace with all 5 editor methods implemented
 */
function buildEditorNamespace(): EditorNamespace {
  return {
    /**
     * Get active editor information (file, cursor position, selection)
     * @returns Active editor info or null if no editor is active
     */
    getActive: async (): Promise<ActiveEditorInfo | null> => {
      const editor = vscode.window.activeTextEditor;

      if (!editor) {
        return null;
      }

      const result: ActiveEditorInfo = {
        file: editor.document.uri.fsPath,
        line: editor.selection.active.line,
        column: editor.selection.active.character,
      };

      // Add selection if there's a non-empty selection
      if (!editor.selection.isEmpty) {
        result.selection = {
          start: {
            file: editor.document.uri.fsPath,
            line: editor.selection.start.line,
            column: editor.selection.start.character,
          },
          end: {
            file: editor.document.uri.fsPath,
            line: editor.selection.end.line,
            column: editor.selection.end.character,
          },
        };
      }

      return result;
    },

    /**
     * Get all currently open files in editor tabs
     * @returns Array of absolute file paths
     */
    getOpenFiles: async () => {
      const documents = vscode.workspace.textDocuments;

      // Filter out non-file schemes (e.g., output, debug, git)
      const filePaths = documents
        .filter((doc) => doc.uri.scheme === 'file')
        .map((doc) => doc.uri.fsPath);

      // Remove duplicates (same file can be open in multiple editors)
      return Array.from(new Set(filePaths));
    },

    /**
     * Get all files with unsaved changes
     * @returns Array of absolute file paths
     */
    getDirtyFiles: async () => {
      const documents = vscode.workspace.textDocuments;

      // Filter to dirty files only
      const dirtyPaths = documents
        .filter((doc) => doc.uri.scheme === 'file' && doc.isDirty)
        .map((doc) => doc.uri.fsPath);

      return Array.from(new Set(dirtyPaths));
    },

    /**
     * Get recently accessed files (most recent first)
     * Note: VS Code doesn't expose full MRU list via API, using visible editors as proxy
     * @param limit - Maximum number of files (default: no limit)
     * @returns Array of absolute file paths
     */
    getRecentFiles: async (limit?: number) => {
      // VS Code doesn't expose full MRU (Most Recently Used) list via API
      // Use visible editors as proxy for "recent" files
      const visibleEditors = vscode.window.visibleTextEditors;

      const filePaths = visibleEditors
        .filter((editor) => editor.document.uri.scheme === 'file')
        .map((editor) => editor.document.uri.fsPath);

      // Remove duplicates
      const uniquePaths = Array.from(new Set(filePaths));

      // Apply limit if specified
      if (limit !== undefined && limit > 0) {
        return uniquePaths.slice(0, limit);
      }

      return uniquePaths;
    },

    /**
     * Get visible code range in active editor
     * @returns Visible range or null if no editor is active
     */
    getVisibleRange: async () => {
      const editor = vscode.window.activeTextEditor;

      if (!editor) {
        return null;
      }

      // Get visible ranges (can be multiple if editor is split)
      const visibleRanges = editor.visibleRanges;

      if (visibleRanges.length === 0) {
        return null;
      }

      // Use the first visible range
      const range = visibleRanges[0];

      return {
        file: editor.document.uri.fsPath,
        startLine: range.start.line,
        endLine: range.end.line,
      };
    },
  };
}

/**
 * Build the Actions namespace (stub for Phase 6)
 * @returns ActionsNamespace with stub implementations
 */
function buildActionsNamespace(): ActionsNamespace {
  return {
    getAvailable: async (file, line) => [],
    apply: async (file, line, actionTitle) => false,
    rename: async (file, line, col, newName) => false,
    organizeImports: async (file) => false,
    fixAll: async (file, kind?) => false,
  };
}

/**
 * Build the Testing namespace (stub for Phase 7)
 * @returns TestingNamespace with stub implementations
 */
function buildTestingNamespace(): TestingNamespace {
  return {
    discover: async () => [],
    run: async (options?) => ({
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      duration: 0,
    }),
    getLastResults: async () => null,
    getCoverage: async (file) => null,
  };
}
