/**
 * WorkspacePathEncoder - Encode workspace paths to Claude CLI directory format
 *
 * **Purpose**: Convert absolute workspace paths to the encoded directory name format
 * used by Claude CLI for session storage in ~/.claude/projects/
 *
 * **Path Encoding Algorithm** (from research-report.md:54-62):
 * 1. Normalize to forward slashes: D:\projects\ptah-extension → D:/projects/ptah-extension
 * 2. Lowercase: d:/projects/ptah-extension
 * 3. Replace : and / with -: d--projects-ptah-extension
 * 4. Remove leading hyphen if double: d--projects-ptah-extension
 *
 * **Design Principles**:
 * - Single Responsibility: Only path encoding, no I/O operations
 * - Stateless: Pure functions, no instance state
 * - Cross-platform: Handles Windows, Linux, macOS paths
 * - Performance: < 1ms for path encoding (simple string operations)
 *
 * @example
 * ```typescript
 * // Windows path
 * WorkspacePathEncoder.encodeWorkspacePath('D:\\projects\\ptah-extension');
 * // Returns: 'd--projects-ptah-extension'
 *
 * // Linux path
 * WorkspacePathEncoder.encodeWorkspacePath('/home/user/projects/app');
 * // Returns: '-home-user-projects-app'
 *
 * // Get full sessions directory
 * WorkspacePathEncoder.getSessionsDirectory('D:\\projects\\ptah-extension');
 * // Returns: 'C:\\Users\\abdal\\.claude\\projects\\d--projects-ptah-extension'
 * ```
 */

import * as path from 'path';
import * as os from 'os';

/**
 * WorkspacePathEncoder - Utility for encoding workspace paths to Claude CLI format
 */
export class WorkspacePathEncoder {
  /**
   * Encode workspace path to Claude CLI format
   *
   * **Algorithm**:
   * 1. Normalize path separators to forward slash
   * 2. Lowercase entire path
   * 3. Replace colons (:) and slashes (/) with hyphens (-)
   * 4. Preserve leading hyphen for absolute paths
   *
   * **Examples**:
   * - Windows: `D:\projects\ptah-extension` → `d--projects-ptah-extension`
   * - Linux: `/home/user/project` → `-home-user-project`
   * - macOS: `/Users/agent/workspace` → `-users-agent-workspace`
   *
   * @param absolutePath - Absolute workspace path
   * @returns Encoded directory name
   *
   * @example
   * ```typescript
   * const encoded = WorkspacePathEncoder.encodeWorkspacePath('D:\\projects\\ptah');
   * console.log(encoded); // 'd--projects-ptah'
   * ```
   */
  static encodeWorkspacePath(absolutePath: string): string {
    // Step 1: Normalize path (handles backslash → forward slash on Windows)
    const normalized = path.normalize(absolutePath);

    // Step 2: Replace backslashes with forward slashes (Windows compatibility)
    const forwardSlashed = normalized.replace(/\\/g, '/');

    // Step 3: Lowercase for consistency
    const lowercased = forwardSlashed.toLowerCase();

    // Step 4: Replace colons and forward slashes with hyphens
    // This handles Windows drive letters (C: → c-) and path separators (/ → -)
    const encoded = lowercased.replace(/[:/]/g, '-');

    return encoded;
  }

  /**
   * Get full path to sessions directory for workspace
   *
   * **Returns**: `~/.claude/projects/{encoded-path}/`
   *
   * **Platform-specific**:
   * - Windows: `C:\Users\{user}\.claude\projects\{encoded}\`
   * - Linux: `/home/{user}/.claude/projects/{encoded}/`
   * - macOS: `/Users/{user}/.claude/projects/{encoded}/`
   *
   * @param workspacePath - Absolute workspace path
   * @returns Full path to sessions directory
   *
   * @example
   * ```typescript
   * const dir = WorkspacePathEncoder.getSessionsDirectory('D:\\projects\\ptah');
   * // Returns: 'C:\\Users\\abdal\\.claude\\projects\\d--projects-ptah'
   * ```
   */
  static getSessionsDirectory(workspacePath: string): string {
    // Encode workspace path
    const encoded = this.encodeWorkspacePath(workspacePath);

    // Get user home directory (cross-platform)
    const homeDir = os.homedir();

    // Build full path: ~/.claude/projects/{encoded}/
    return path.join(homeDir, '.claude', 'projects', encoded);
  }
}
