import { Injectable } from '@angular/core';
import { SessionId, StrictChatMessage } from '@ptah-extension/shared';

/**
 * Session file metadata
 */
export interface SessionFileInfo {
  sessionId: SessionId;
  path: string;
  lastModified: number;
}

/**
 * ClaudeFileService - Direct JSONL file reader for session messages
 *
 * Replaces the old SessionManager caching layer (deleted in Phase 0).
 * Instead of backend caching + event notifications, frontend reads .jsonl files directly.
 *
 * Benefits:
 * - No caching layers (eliminates message duplication)
 * - No backend roundtrip (faster session loading)
 * - Single source of truth (.jsonl files)
 * - Simpler architecture (1 hop vs 15+)
 *
 * Architecture:
 * - Uses VS Code FileSystem API via (window as any).vscode.workspace.fs
 * - Reads session files from ~/.claude/projects/{encodedWorkspace}/{sessionId}.jsonl
 * - Parses JSONL format (one JSON object per line)
 * - Returns empty array on file not found (graceful failure)
 */
@Injectable({ providedIn: 'root' })
export class ClaudeFileService {
  /**
   * Read session messages from .jsonl file
   * @param sessionId - Session ID to read
   * @returns Array of messages (empty if file doesn't exist)
   *
   * Example:
   *   const messages = await claudeFileService.readSessionFile(sessionId);
   *   if (messages.length > 0) {
   *     console.log('Loaded messages:', messages);
   *   }
   */
  async readSessionFile(sessionId: SessionId): Promise<StrictChatMessage[]> {
    try {
      const path = this.buildSessionPath(sessionId);
      const vscode = (window as any).vscode;

      if (!vscode?.workspace?.fs) {
        console.warn('VS Code FileSystem API not available');
        return [];
      }

      const uri = vscode.Uri.file(path);
      const content = await vscode.workspace.fs.readFile(uri);

      return this.parseJsonl(content);
    } catch (error) {
      // File doesn't exist or read error - return empty array (graceful failure)
      console.debug(
        `Session file not found or unreadable: ${sessionId}`,
        error
      );
      return [];
    }
  }

  /**
   * List all session files in workspace
   * @returns Array of session file metadata
   *
   * TODO: Phase 2 - This will be populated via RPC (backend scans .claude directory)
   * For now, returns empty array as session list comes from RPC
   */
  async listSessionFiles(): Promise<SessionFileInfo[]> {
    return [];
  }

  /**
   * Build session file path
   * @param sessionId - Session ID
   * @returns Absolute path to .jsonl file
   *
   * Path format: ~/.claude/projects/{encodedWorkspace}/{sessionId}.jsonl
   *
   * Example paths:
   * - Windows: C:\Users\username\.claude\projects\workspace_name\session-id.jsonl
   * - Unix: /home/username/.claude/projects/workspace_name/session-id.jsonl
   */
  private buildSessionPath(sessionId: SessionId): string {
    const homeDir = this.getHomeDirectory();
    const workspace = this.getWorkspacePath();
    const encodedWorkspace = this.encodeWorkspacePath(workspace);

    return `${homeDir}/.claude/projects/${encodedWorkspace}/${sessionId}.jsonl`;
  }

  /**
   * Parse JSONL content into messages
   * @param content - JSONL file content as Uint8Array
   * @returns Array of parsed messages
   *
   * JSONL Format:
   * - One JSON object per line
   * - Each line is a StrictChatMessage
   * - Empty lines are skipped
   * - Invalid lines are logged and skipped (graceful failure)
   */
  private parseJsonl(content: Uint8Array): StrictChatMessage[] {
    try {
      const text = new TextDecoder('utf-8').decode(content);
      const lines = text.split('\n').filter((line) => line.trim());

      const messages: StrictChatMessage[] = [];
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);

          // Validate required fields
          if (parsed.id && parsed.type && parsed.timestamp) {
            messages.push(parsed as StrictChatMessage);
          }
        } catch (parseError) {
          // Skip invalid JSON lines
          console.warn('Invalid JSON line in JSONL:', parseError);
        }
      }

      return messages;
    } catch (error) {
      console.error('Failed to parse JSONL:', error);
      return [];
    }
  }

  /**
   * Get user home directory (platform-aware)
   * @returns Home directory path
   *
   * Platform detection:
   * - Windows: USERPROFILE environment variable
   * - Unix/Linux/Mac: HOME environment variable
   * - Fallback: Default paths for each platform
   */
  private getHomeDirectory(): string {
    const platform = navigator.platform.toLowerCase();

    if (platform.includes('win')) {
      // Windows
      return (window as any).process?.env?.USERPROFILE || 'C:\\Users\\Default';
    } else {
      // Unix/Linux/Mac
      return (window as any).process?.env?.HOME || '/home/default';
    }
  }

  /**
   * Get current workspace path
   * @returns Workspace root path
   * @throws Error if no workspace folder open
   */
  private getWorkspacePath(): string {
    const vscode = (window as any).vscode;
    const workspace = vscode?.workspace?.workspaceFolders?.[0]?.uri?.fsPath;

    if (!workspace) {
      throw new Error('No workspace folder open');
    }

    return workspace;
  }

  /**
   * Encode workspace path for file system (simple implementation)
   * @param path - Workspace path to encode
   * @returns Encoded path (safe for filesystem)
   *
   * TODO: Use WorkspacePathEncoder from @ptah-extension/shared if available
   * For now, simple encoding: replace special chars with underscores
   *
   * Examples:
   * - "D:\projects\my-app" → "d_projects_my_app"
   * - "/home/user/my app" → "_home_user_my_app"
   */
  private encodeWorkspacePath(path: string): string {
    // Simple encoding - replace special chars
    return path
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .toLowerCase();
  }
}
