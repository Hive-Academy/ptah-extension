/**
 * Session Importer Service
 *
 * Imports existing Claude sessions from ~/.claude/projects/
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
 * Entry from Claude CLI's sessions-index.json
 */
interface SessionsIndexEntry {
  sessionId: string;
  fullPath: string;
  fileMtime: number;
  firstPrompt?: string;
  summary?: string;
  customTitle?: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch?: string;
  projectPath?: string;
  isSidechain?: boolean;
}

/**
 * Root structure of Claude CLI's sessions-index.json
 */
interface SessionsIndex {
  version: number;
  entries: SessionsIndexEntry[];
  originalPath?: string;
}

/**
 * Service to import existing Claude sessions
 */
@injectable()
export class SessionImporterService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly metadataStore: SessionMetadataStore,
  ) {}

  /**
   * Scan and import existing Claude sessions for a workspace
   *
   * Optimization: Only reads file stats to find recent files, then only
   * parses the first few KB of the most recent files to extract metadata.
   *
   * @param workspacePath - The workspace path to find sessions for
   * @param limit - Maximum number of sessions to import (default: 50)
   * @returns Number of sessions imported
   */
  async scanAndImport(workspacePath: string, limit = 50): Promise<number> {
    this.logger.info('[SessionImporter] Scanning for existing sessions', {
      workspacePath,
      limit,
    });

    const sessionsDir = await this.findSessionsDirectory(workspacePath);
    if (!sessionsDir) {
      this.logger.debug('[SessionImporter] Sessions directory not found');
      return 0;
    }

    let imported = 0;

    // Primary: Import from sessions-index.json (Claude CLI's canonical session catalog)
    const indexImported = await this.importFromSessionsIndex(
      sessionsDir,
      workspacePath,
      limit,
    );
    imported += indexImported;

    // Secondary: Scan for .jsonl files not already imported via the index
    const remainingLimit = limit - imported;
    if (remainingLimit > 0) {
      const fileImported = await this.importFromJsonlFiles(
        sessionsDir,
        workspacePath,
        remainingLimit,
      );
      imported += fileImported;
    }

    this.logger.info('[SessionImporter] Import complete', {
      imported,
      fromIndex: indexImported,
    });

    return imported;
  }

  /**
   * Import sessions from Claude CLI's sessions-index.json
   *
   * Claude CLI maintains a sessions-index.json in each project directory
   * with rich metadata (summary, branch, timestamps, message count).
   * This is the primary discovery source for existing sessions.
   */
  private async importFromSessionsIndex(
    sessionsDir: string,
    workspacePath: string,
    limit: number,
  ): Promise<number> {
    const indexPath = path.join(sessionsDir, 'sessions-index.json');

    try {
      await fs.promises.access(indexPath);
    } catch {
      // No index file — fall through to .jsonl scanning
      return 0;
    }

    try {
      const content = await fs.promises.readFile(indexPath, 'utf-8');
      const index: SessionsIndex = JSON.parse(content);

      if (!index.entries || !Array.isArray(index.entries)) {
        this.logger.debug(
          '[SessionImporter] sessions-index.json has no entries array',
        );
        return 0;
      }

      // Guard against unknown index format versions
      if (index.version && index.version > 1) {
        this.logger.warn(
          '[SessionImporter] Unknown sessions-index.json version, skipping',
          { version: index.version },
        );
        return 0;
      }

      // Sort by modified date (most recent first) and limit.
      // Use fileMtime as fallback when modified date is invalid.
      const sortedEntries = [...index.entries]
        .filter(
          (e) =>
            typeof e.sessionId === 'string' &&
            e.sessionId.length > 0 &&
            !e.isSidechain,
        )
        .sort((a, b) => {
          const mtimeA = this.parseIndexTimestamp(a.modified, a.fileMtime);
          const mtimeB = this.parseIndexTimestamp(b.modified, b.fileMtime);
          return mtimeB - mtimeA;
        })
        .slice(0, limit);

      let imported = 0;

      for (const entry of sortedEntries) {
        try {
          // Skip sessions whose .jsonl file no longer exists on disk.
          // Importing ghost sessions causes "No messages or events found" errors
          // when the user clicks on them in the sidebar.
          const sessionFilePath = path.join(
            sessionsDir,
            `${entry.sessionId}.jsonl`,
          );
          try {
            await fs.promises.access(sessionFilePath);
          } catch {
            continue;
          }

          const existing = await this.metadataStore.get(entry.sessionId);
          if (existing) {
            continue;
          }

          if (
            await this.metadataStore.isReferencedAsChildSession(entry.sessionId)
          ) {
            await this.metadataStore.createChild(
              entry.sessionId,
              workspacePath,
              'CLI Agent Session',
            );
            continue;
          }

          // Derive the best session name from available fields
          const createdTs = this.parseIndexTimestamp(
            entry.created,
            entry.fileMtime,
          );
          const rawName =
            entry.customTitle ||
            entry.summary ||
            (entry.firstPrompt
              ? entry.firstPrompt.substring(0, 50).trim() +
                (entry.firstPrompt.length > 50 ? '...' : '')
              : null);
          const name =
            rawName && rawName.trim()
              ? rawName.trim()
              : `Session ${new Date(createdTs).toLocaleDateString()}`;

          const metadata: SessionMetadata = {
            sessionId: entry.sessionId,
            name,
            workspaceId: workspacePath,
            createdAt: createdTs,
            lastActiveAt: this.parseIndexTimestamp(
              entry.modified,
              entry.fileMtime,
            ),
            totalCost: 0,
            totalTokens: { input: 0, output: 0 },
          };

          await this.metadataStore.save(metadata);
          imported++;
          this.logger.info('[SessionImporter] Imported session from index', {
            sessionId: entry.sessionId,
            name,
          });
        } catch (error) {
          this.logger.debug('[SessionImporter] Failed to import index entry', {
            sessionId: entry.sessionId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      this.logger.info('[SessionImporter] Index import complete', {
        imported,
        total: sortedEntries.length,
      });

      return imported;
    } catch (error) {
      this.logger.debug(
        '[SessionImporter] Failed to read sessions-index.json',
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return 0;
    }
  }

  /**
   * Import sessions from .jsonl files (legacy/fallback discovery)
   *
   * Scans the sessions directory for flat .jsonl files.
   * Skips sessions already imported (e.g., from sessions-index.json).
   */
  private async importFromJsonlFiles(
    sessionsDir: string,
    workspacePath: string,
    limit: number,
  ): Promise<number> {
    const recentFiles = await this.getRecentSessionFiles(sessionsDir, limit);

    let imported = 0;
    for (const file of recentFiles) {
      try {
        const sessionId = this.extractSessionIdFromFilename(file.filename);
        if (!sessionId) continue;

        const existing = await this.metadataStore.get(sessionId);
        if (existing) {
          continue;
        }

        if (await this.metadataStore.isReferencedAsChildSession(sessionId)) {
          this.logger.info(
            '[SessionImporter] Detected child session via cross-reference, creating child metadata',
            { sessionId },
          );
          await this.metadataStore.createChild(
            sessionId,
            workspacePath,
            'CLI Agent Session',
          );
          continue;
        }

        const metadata = await this.extractMetadata(
          file.path,
          workspacePath,
          file.mtime,
        );

        if (metadata) {
          await this.metadataStore.save(metadata);
          imported++;
          this.logger.info('[SessionImporter] Imported session from file', {
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

    return imported;
  }

  /**
   * Parse a timestamp from an index entry.
   * Uses the ISO date string as primary, falls back to fileMtime (numeric ms),
   * then Date.now() if both are invalid.
   */
  private parseIndexTimestamp(
    isoString: string | undefined,
    fileMtime: number | undefined,
  ): number {
    if (isoString) {
      const ts = new Date(isoString).getTime();
      if (!isNaN(ts)) return ts;
    }
    if (typeof fileMtime === 'number' && !isNaN(fileMtime)) return fileMtime;
    return Date.now();
  }

  /**
   * Get the N most recent session files (optimized)
   *
   * Uses file stats only, doesn't read file content.
   * Excludes agent-* files (subagent sessions).
   */
  private async getRecentSessionFiles(
    sessionsDir: string,
    limit: number,
  ): Promise<SessionFileInfo[]> {
    try {
      const files = await fs.promises.readdir(sessionsDir);

      // Filter to only main session files (not agent subagent files)
      const sessionFiles = files.filter(
        (f) => f.endsWith('.jsonl') && !f.startsWith('agent-'),
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
   * Claude uses format: {session-id}.jsonl
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
    mtime: number,
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
   * Claude stores sessions in ~/.claude/projects/{escaped-workspace-path}/
   */
  private async findSessionsDirectory(
    workspacePath: string,
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

    this.logger.debug('[SessionImporter] findSessionsDirectory', {
      workspacePath,
      escapedPath,
    });

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

    // Try normalized match: treat hyphens and underscores as equivalent.
    // Claude CLI may normalize path separators differently (e.g., replacing _ with -)
    const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, '-');
    const normalizedEscaped = normalize(escapedPath);
    const normalizedMatch = dirs.find(
      (d) => normalize(d) === normalizedEscaped,
    );
    if (normalizedMatch) {
      return path.join(projectsDir, normalizedMatch);
    }

    // Try without leading hyphen
    const withoutLeading = escapedPath.replace(/^-+/, '');
    const withoutLeadingLower = withoutLeading.toLowerCase();
    const normalizedWithoutLeading = normalize(withoutLeading);
    const partialMatch = dirs.find(
      (d) =>
        d.toLowerCase() === withoutLeadingLower ||
        d.toLowerCase().endsWith(withoutLeadingLower) ||
        normalize(d) === normalizedWithoutLeading ||
        normalize(d).endsWith(normalizedWithoutLeading),
    );
    if (partialMatch) {
      return path.join(projectsDir, partialMatch);
    }

    return null;
  }
}
