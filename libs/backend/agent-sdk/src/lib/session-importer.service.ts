/**
 * Session Importer Service
 *
 * Imports existing Claude Code sessions from ~/.claude/projects/
 * Scans for JSONL session files and imports metadata for recent sessions.
 *
 * Optimization: Uses file modification time to find only the most recent sessions
 * without fully scanning the directory.
 */

import { injectable, inject } from 'tsyringe';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  SessionMetadataStore,
  SessionMetadata,
} from './session-metadata-store';
import { SDK_TOKENS } from './di/tokens';

/**
 * Session file info for sorting
 */
interface SessionFileInfo {
  path: string;
  filename: string;
  mtime: number;
}

/**
 * Service to import existing Claude Code sessions
 */
@injectable()
export class SessionImporterService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly metadataStore: SessionMetadataStore
  ) {}

  /**
   * Scan and import existing Claude Code sessions for a workspace
   *
   * Optimization: Only reads file stats to find recent files, then only
   * parses the first few KB of the most recent files to extract metadata.
   *
   * @param workspacePath - The workspace path to find sessions for
   * @param limit - Maximum number of sessions to import (default: 5)
   * @returns Number of sessions imported
   */
  async scanAndImport(workspacePath: string, limit = 5): Promise<number> {
    this.logger.info('[SessionImporter] Scanning for existing sessions', {
      workspacePath,
      limit,
    });

    const sessionsDir = await this.findSessionsDirectory(workspacePath);
    if (!sessionsDir) {
      this.logger.debug('[SessionImporter] Sessions directory not found');
      return 0;
    }

    // Get recent session files (optimized - only gets file stats, not content)
    const recentFiles = await this.getRecentSessionFiles(sessionsDir, limit);

    let imported = 0;
    for (const file of recentFiles) {
      try {
        // Skip if already imported
        const sessionId = this.extractSessionIdFromFilename(file.filename);
        if (!sessionId) continue;

        const existing = await this.metadataStore.get(sessionId);
        if (existing) {
          this.logger.debug('[SessionImporter] Session already imported', {
            sessionId,
          });
          continue;
        }

        // Extract metadata from file content
        const metadata = await this.extractMetadata(
          file.path,
          workspacePath,
          file.mtime
        );

        if (metadata) {
          await this.metadataStore.save(metadata);
          imported++;
          this.logger.info('[SessionImporter] Imported session', {
            sessionId: metadata.sessionId,
            name: metadata.name,
          });
        }
      } catch (error) {
        this.logger.debug('[SessionImporter] Failed to import session file', {
          file: file.filename,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.info('[SessionImporter] Import complete', {
      imported,
      scanned: recentFiles.length,
    });

    return imported;
  }

  /**
   * Get the N most recent session files (optimized)
   *
   * Uses file stats only, doesn't read file content.
   * Excludes agent-* files (subagent sessions).
   */
  private async getRecentSessionFiles(
    sessionsDir: string,
    limit: number
  ): Promise<SessionFileInfo[]> {
    try {
      const files = await fs.promises.readdir(sessionsDir);

      // Filter to only main session files (not agent subagent files)
      const sessionFiles = files.filter(
        (f) => f.endsWith('.jsonl') && !f.startsWith('agent-')
      );

      // Get stats for each file (just mtime, not content)
      const fileInfos: SessionFileInfo[] = [];

      for (const filename of sessionFiles) {
        try {
          const filePath = path.join(sessionsDir, filename);
          const stats = await fs.promises.stat(filePath);
          fileInfos.push({
            path: filePath,
            filename,
            mtime: stats.mtimeMs,
          });
        } catch {
          // Skip files that can't be read
        }
      }

      // Sort by modification time (most recent first) and take only limit
      return fileInfos.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
    } catch (error) {
      this.logger.debug('[SessionImporter] Failed to read sessions directory', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Extract session ID from filename
   *
   * Claude Code uses format: {session-id}.jsonl
   */
  private extractSessionIdFromFilename(filename: string): string | null {
    if (!filename.endsWith('.jsonl')) return null;
    return filename.slice(0, -6); // Remove .jsonl
  }

  /**
   * Extract metadata from a session file
   *
   * Reads only the first few KB to find:
   * - Session ID from system init message
   * - Name from first user message (first 50 chars)
   */
  private async extractMetadata(
    filePath: string,
    workspaceId: string,
    mtime: number
  ): Promise<SessionMetadata | null> {
    try {
      // Read first 8KB - enough to get init + first user message
      const fd = await fs.promises.open(filePath, 'r');
      const buffer = Buffer.alloc(8192);
      const { bytesRead } = await fd.read(buffer, 0, 8192, 0);
      await fd.close();

      if (bytesRead === 0) return null;

      const content = buffer.toString('utf-8', 0, bytesRead);
      const lines = content.split('\n').filter((line) => line.trim());

      let sessionId: string | null = null;
      let sessionName: string | null = null;

      for (const line of lines) {
        try {
          const msg = JSON.parse(line);

          // Get session ID from system init message
          if (
            msg.type === 'system' &&
            msg.subtype === 'init' &&
            msg.session_id
          ) {
            sessionId = msg.session_id;
          }

          // Get name from first user message
          if (msg.type === 'user' && !sessionName) {
            const text = this.extractUserMessageText(msg);
            if (text) {
              // Use first 50 chars as session name
              sessionName = text.substring(0, 50).trim();
              if (text.length > 50) sessionName += '...';
            }
          }

          // Stop once we have both
          if (sessionId && sessionName) break;
        } catch {
          // Skip malformed lines
        }
      }

      // Use filename as session ID if not found in content
      if (!sessionId) {
        sessionId = this.extractSessionIdFromFilename(path.basename(filePath));
      }

      if (!sessionId) return null;

      return {
        sessionId,
        name: sessionName || `Session ${new Date(mtime).toLocaleDateString()}`,
        workspaceId,
        createdAt: mtime,
        lastActiveAt: mtime,
        totalCost: 0,
        totalTokens: { input: 0, output: 0 },
      };
    } catch (error) {
      this.logger.debug('[SessionImporter] Failed to extract metadata', {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Extract text from a user message
   */
  private extractUserMessageText(msg: {
    message?: { content?: string | Array<{ type: string; text?: string }> };
  }): string | null {
    if (!msg.message?.content) return null;

    // Content can be string or array
    if (typeof msg.message.content === 'string') {
      return msg.message.content;
    }

    if (Array.isArray(msg.message.content)) {
      for (const block of msg.message.content) {
        if (block.type === 'text' && block.text) {
          return block.text;
        }
      }
    }

    return null;
  }

  /**
   * Find the Claude CLI sessions directory for a workspace
   *
   * Claude Code stores sessions in ~/.claude/projects/{escaped-workspace-path}/
   */
  private async findSessionsDirectory(
    workspacePath: string
  ): Promise<string | null> {
    const homeDir = os.homedir();
    const projectsDir = path.join(homeDir, '.claude', 'projects');

    try {
      await fs.promises.access(projectsDir);
    } catch {
      return null;
    }

    // Generate the escaped path pattern (replace : and /\ with -)
    const escapedPath = workspacePath.replace(/[:\\/]/g, '-');

    const dirs = await fs.promises.readdir(projectsDir);

    // Try exact match first
    if (dirs.includes(escapedPath)) {
      return path.join(projectsDir, escapedPath);
    }

    // Try lowercase match
    const lowerEscaped = escapedPath.toLowerCase();
    const lowerMatch = dirs.find((d) => d.toLowerCase() === lowerEscaped);
    if (lowerMatch) {
      return path.join(projectsDir, lowerMatch);
    }

    // Try without leading hyphen
    const withoutLeading = escapedPath.replace(/^-+/, '');
    const withoutLeadingLower = withoutLeading.toLowerCase();
    const partialMatch = dirs.find(
      (d) =>
        d.toLowerCase() === withoutLeadingLower ||
        d.toLowerCase().endsWith(withoutLeadingLower)
    );
    if (partialMatch) {
      return path.join(projectsDir, partialMatch);
    }

    return null;
  }
}
