/**
 * VS Code IDE Capabilities Implementation
 *
 * Implements IIDECapabilities by wrapping VS Code's LSP commands,
 * editor state APIs, and code action providers.
 *
 * This file is the ONLY place in the namespace-builders directory that
 * imports `vscode`. It encapsulates all VS Code-specific IDE integration
 * so that ide-namespace.builder.ts remains platform-agnostic.
 */

import * as vscode from 'vscode';
import type {
  Location,
  HoverInfo,
  SignatureHelp,
  ActiveEditorInfo,
  CodeAction,
  VisibleRange,
} from '../types';
import type { IIDECapabilities } from './ide-namespace.builder';

/**
 * Resolve a file path relative to workspace root if it's not absolute.
 * Handles relative paths like 'src/contexts/AuthContext.tsx' by prepending workspace root.
 */
function resolveFilePath(filePath: string): vscode.Uri {
  // Normalize path separators to forward slashes
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Check if it's already an absolute path (starts with drive letter or /)
  const isAbsolute =
    /^[a-zA-Z]:/.test(normalizedPath) || normalizedPath.startsWith('/');

  if (isAbsolute) {
    return vscode.Uri.file(normalizedPath);
  }

  // Relative path - resolve to workspace root
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error(
      'No workspace folder open. Cannot resolve relative path: ' + filePath,
    );
  }

  return vscode.Uri.joinPath(workspaceFolders[0].uri, normalizedPath);
}

/**
 * VS Code implementation of IIDECapabilities.
 *
 * Wraps VS Code's commands, editor state, and workspace APIs to provide
 * LSP operations, editor state queries, and code action capabilities.
 *
 * This class should be instantiated and registered in the VS Code DI container.
 * It is NOT used in Electron/standalone mode.
 */
export class VscodeIDECapabilities implements IIDECapabilities {
  readonly lsp: IIDECapabilities['lsp'] = {
    /**
     * Get definition location for symbol at position.
     * Uses vscode.executeDefinitionProvider command.
     */
    getDefinition: async (
      file: string,
      line: number,
      col: number,
    ): Promise<Location[]> => {
      try {
        const uri = resolveFilePath(file);
        const position = new vscode.Position(line, col);

        const definitions = await vscode.commands.executeCommand<
          vscode.Location[]
        >('vscode.executeDefinitionProvider', uri, position);

        if (!definitions || definitions.length === 0) {
          return [];
        }

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
          }`,
        );
      }
    },

    /**
     * Find all references to symbol at position.
     * Uses vscode.executeReferenceProvider command.
     */
    getReferences: async (
      file: string,
      line: number,
      col: number,
    ): Promise<Location[]> => {
      try {
        const uri = resolveFilePath(file);
        const position = new vscode.Position(line, col);

        const references = await vscode.commands.executeCommand<
          vscode.Location[]
        >('vscode.executeReferenceProvider', uri, position);

        if (!references || references.length === 0) {
          return [];
        }

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
          }`,
        );
      }
    },

    /**
     * Get hover information (types, documentation) at position.
     * Uses vscode.executeHoverProvider command.
     */
    getHover: async (
      file: string,
      line: number,
      col: number,
    ): Promise<HoverInfo | null> => {
      try {
        const uri = resolveFilePath(file);
        const position = new vscode.Position(line, col);

        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
          'vscode.executeHoverProvider',
          uri,
          position,
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
          }`,
        );
      }
    },

    /**
     * Get type definition location for symbol at position.
     * Uses vscode.executeTypeDefinitionProvider command.
     */
    getTypeDefinition: async (
      file: string,
      line: number,
      col: number,
    ): Promise<Location[]> => {
      try {
        const uri = resolveFilePath(file);
        const position = new vscode.Position(line, col);

        const typeDefinitions = await vscode.commands.executeCommand<
          vscode.Location[]
        >('vscode.executeTypeDefinitionProvider', uri, position);

        if (!typeDefinitions || typeDefinitions.length === 0) {
          return [];
        }

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
          }`,
        );
      }
    },

    /**
     * Get signature help for function call at position.
     * Uses vscode.executeSignatureHelpProvider command.
     */
    getSignatureHelp: async (
      file: string,
      line: number,
      col: number,
    ): Promise<SignatureHelp | null> => {
      try {
        const uri = resolveFilePath(file);
        const position = new vscode.Position(line, col);

        const signatureHelp =
          await vscode.commands.executeCommand<vscode.SignatureHelp>(
            'vscode.executeSignatureHelpProvider',
            uri,
            position,
          );

        if (!signatureHelp || signatureHelp.signatures.length === 0) {
          return null;
        }

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
          }`,
        );
      }
    },
  };

  readonly editor: IIDECapabilities['editor'] = {
    /**
     * Get active editor information (file, cursor position, selection).
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
     * Get all currently open files in editor tabs.
     */
    getOpenFiles: async (): Promise<string[]> => {
      const documents = vscode.workspace.textDocuments;

      // Filter out non-file schemes (e.g., output, debug, git)
      const filePaths = documents
        .filter((doc) => doc.uri.scheme === 'file')
        .map((doc) => doc.uri.fsPath);

      // Remove duplicates (same file can be open in multiple editors)
      return Array.from(new Set(filePaths));
    },

    /**
     * Get all files with unsaved changes.
     */
    getDirtyFiles: async (): Promise<string[]> => {
      const documents = vscode.workspace.textDocuments;

      // Filter to dirty files only
      const dirtyPaths = documents
        .filter((doc) => doc.uri.scheme === 'file' && doc.isDirty)
        .map((doc) => doc.uri.fsPath);

      return Array.from(new Set(dirtyPaths));
    },

    /**
     * Get recently accessed files (most recent first).
     * Note: VS Code doesn't expose full MRU list via API, using visible editors as proxy.
     */
    getRecentFiles: async (limit?: number): Promise<string[]> => {
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
     * Get visible code range in active editor.
     */
    getVisibleRange: async (): Promise<VisibleRange | null> => {
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

  readonly actions: IIDECapabilities['actions'] = {
    /**
     * Get available code actions at position.
     * Uses vscode.executeCodeActionProvider command.
     */
    getAvailable: async (file: string, line: number): Promise<CodeAction[]> => {
      try {
        const uri = resolveFilePath(file);
        const position = new vscode.Position(line, 0);
        const range = new vscode.Range(position, position);

        const actions = await vscode.commands.executeCommand<
          vscode.CodeAction[]
        >('vscode.executeCodeActionProvider', uri, range);

        if (!actions || actions.length === 0) {
          return [];
        }

        return actions.map((action) => ({
          title: action.title,
          kind: action.kind?.value || '',
          isPreferred: action.isPreferred || false,
        }));
      } catch (error) {
        throw new Error(
          `Failed to get code actions for ${file}:${line}: ${
            (error as Error).message
          }`,
        );
      }
    },

    /**
     * Apply a code action by title.
     * Uses vscode.executeCodeActionProvider to find action, then applies edit or executes command.
     */
    apply: async (
      file: string,
      line: number,
      actionTitle: string,
    ): Promise<boolean> => {
      try {
        const uri = resolveFilePath(file);
        const position = new vscode.Position(line, 0);
        const range = new vscode.Range(position, position);

        // Get available actions
        const actions = await vscode.commands.executeCommand<
          vscode.CodeAction[]
        >('vscode.executeCodeActionProvider', uri, range);

        if (!actions || actions.length === 0) {
          return false;
        }

        // Find action by title
        const action = actions.find((a) => a.title === actionTitle);
        if (!action) {
          return false;
        }

        // Apply the action
        if (action.edit) {
          const success = await vscode.workspace.applyEdit(action.edit);
          return success;
        } else if (action.command) {
          await vscode.commands.executeCommand(
            action.command.command,
            ...(action.command.arguments || []),
          );
          return true;
        }

        return false;
      } catch (error) {
        throw new Error(
          `Failed to apply action "${actionTitle}" at ${file}:${line}: ${
            (error as Error).message
          }`,
        );
      }
    },

    /**
     * Rename symbol at position across workspace.
     * Uses editor.action.rename command.
     */
    rename: async (
      file: string,
      line: number,
      col: number,
      newName: string,
    ): Promise<boolean> => {
      try {
        const uri = resolveFilePath(file);
        const position = new vscode.Position(line, col);

        await vscode.commands.executeCommand(
          'editor.action.rename',
          uri,
          position,
          newName,
        );

        return true;
      } catch (error) {
        throw new Error(
          `Failed to rename symbol at ${file}:${line}:${col}: ${
            (error as Error).message
          }`,
        );
      }
    },

    /**
     * Organize imports in file.
     * Uses editor.action.organizeImports command.
     */
    organizeImports: async (file: string): Promise<boolean> => {
      try {
        const uri = resolveFilePath(file);

        await vscode.commands.executeCommand(
          'editor.action.organizeImports',
          uri,
        );

        return true;
      } catch (error) {
        throw new Error(
          `Failed to organize imports in ${file}: ${(error as Error).message}`,
        );
      }
    },

    /**
     * Apply all auto-fixes in file with optional kind filter.
     * Uses editor.action.fixAll command.
     */
    fixAll: async (file: string, kind?: string): Promise<boolean> => {
      try {
        const uri = resolveFilePath(file);

        if (kind) {
          await vscode.commands.executeCommand('editor.action.fixAll', {
            uri: uri,
            kind: kind,
          });
        } else {
          await vscode.commands.executeCommand('editor.action.fixAll', uri);
        }

        return true;
      } catch (error) {
        throw new Error(
          `Failed to fix all issues in ${file}: ${(error as Error).message}`,
        );
      }
    },
  };
}
