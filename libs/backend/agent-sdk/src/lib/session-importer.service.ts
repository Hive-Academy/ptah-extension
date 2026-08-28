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
import { blankToUndefined } from '@ptah-extension/shared';
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
 * Bytes read from the head of a session `.jsonl` when probing it for metadata.
 *
 * This is a BYTE bound, not a record bound: the prefix is cut wherever byte
 * 8192 lands, which for a JSONL file is almost always mid-token. Anything
 * reading this prefix must treat its trailing line as incomplete — see
 * `splitCompleteRecords`.
 */
const METADATA_PREFIX_BYTES = 8192;

/**
 * Split a byte-bounded file prefix into the JSONL records that are certainly
 * complete, dropping a trailing record that the byte bound cut in half.
 *
 * The tail is dropped only when the read actually hit the bound AND the
 * content does not end on a newline. A short read means the whole file is in
 * hand, so its final line is complete even without a trailing newline and must
 * be kept.
 */
function splitCompleteRecords(content: string, bytesRead: number): string[] {
  const lines = content.split('\n');
  if (bytesRead >= METADATA_PREFIX_BYTES && !content.endsWith('\n')) {
    lines.pop();
  }
  return lines.filter((line) => line.trim());
}

/**
 * Options for a scan.
 *
 * The signal exists because this scan moved behind the window
 * (TASK_2026_331 B1.T5): it can now still be running when the user quits, and
 * an import that keeps writing metadata after the host's disposal chain has run
 * is exactly the shutdown race the boot coordinator exists to prevent.
 */
export interface ScanAndImportOptions {
  signal?: AbortSignal;
}

/**
 * Collapse a workspace path to the key the in-flight map is keyed by.
 *
 * Three rules, applied in order: strip trailing separators, fold backslashes to
 * forward slashes, lowercase. Deliberately a LOCAL reimplementation of
 * `normalizeWorkspaceRoot` in
 * `apps/ptah-electron/src/activation/boot-heavy-services.ts` — a backend lib
 * must not import from an app, and this is three lines rather than a new shared
 * module. The semantics must stay identical to that function's: the two callers
 * this dedup exists for are the Electron boot (which keys its own one-shot latch
 * with it) and the `workspace:switch` RPC, and the root the renderer echoes back
 * differs from the startup root by separator and case on Windows. Two spellings
 * of one directory must join one scan, not start two.
 */
function normalizeWorkspaceKey(workspacePath: string): string {
  return workspacePath
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/')
    .toLowerCase();
}

/**
 * Hand the event loop back.
 *
 * `setImmediate` rather than `await Promise.resolve()`: a resolved promise is a
 * MICROtask, so a loop of them never lets an I/O callback or an IPC message run
 * — the whole loop still executes in one turn. `setImmediate` is a macrotask
 * queued behind pending I/O, which is what actually lets the renderer's RPCs be
 * served while a long import is in progress.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * Service to import existing Claude sessions
 */
@injectable()
export class SessionImporterService {
  /**
   * The scan currently running per normalized workspace root.
   *
   * This service is the ONE thing the two independent importers share
   * (`SDK_TOKENS.SDK_SESSION_IMPORTER`, resolved by the Electron boot and by the
   * `workspace:switch` RPC handler), which is why the concurrency state lives
   * here rather than in either caller. The handler's own guards could only ever
   * see the handler's own runs — the boot import stamped none of them — so the
   * same root was scanned twice on every launch that switched into it
   * (TASK_2026_331 B7).
   *
   * Deliberately NOT a "already imported" latch. The entry is cleared the
   * instant the scan settles, so a genuine re-scan — switching away and back —
   * still works. Whether a completed import is recent enough to skip is a
   * different question with a different owner: the time-based guards in
   * `WorkspaceRpcHandlers.deferSessionImport`.
   */
  private readonly scansInFlight = new Map<string, Promise<number>>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly metadataStore: SessionMetadataStore,
  ) {}

  /**
   * Scan and import existing Claude sessions for a workspace.
   *
   * Optimization: Only reads file stats to find recent files, then only
   * parses the first few KB of the most recent files to extract metadata.
   *
   * Yields to the event loop between sessions. This scan runs AFTER the window
   * is open (TASK_2026_331), so holding the loop for its whole duration would
   * freeze a window the user is already looking at — an import of 50 sessions
   * is 50 file opens, 50 reads and 50 store writes.
   *
   * **A call for a root that is already being scanned JOINS that scan** and
   * resolves with its count. It does not start a second one. Different roots run
   * independently. A rejection reaches every joined caller, and clears the entry
   * either way.
   *
   * **The FIRST caller's `limit` and `signal` govern the whole scan**, and that
   * is the deliberate choice rather than an oversight. The alternatives are
   * worse: honouring a joiner's abort would let one caller truncate another's
   * import, and refusing to join callers whose options differ would reinstate
   * the duplicate scan this dedup exists to remove — the two real call sites
   * differ in exactly that way (the boot passes the shutdown signal, the RPC
   * passes none) and both ask for the same 50. The only signal in play means
   * "the host is quitting", so a joined caller receiving a truncated count is
   * the correct answer to a question the process is no longer around to use.
   * The reverse — a signalled caller joining an unsignalled scan and so not
   * being able to cut it short — is bounded by the scan's own `setImmediate`
   * yielding and by the boot coordinator's own drain deadline.
   *
   * @param workspacePath - The workspace path to find sessions for
   * @param limit - Maximum number of sessions to import (default: 50)
   * @param options - Optional abort signal, checked between sessions
   * @returns Number of sessions imported
   */
  scanAndImport(
    workspacePath: string,
    limit = 50,
    options?: ScanAndImportOptions,
  ): Promise<number> {
    const key = normalizeWorkspaceKey(workspacePath);
    const joined = this.scansInFlight.get(key);
    if (joined !== undefined) {
      this.logger.debug(
        '[SessionImporter] Joining the scan already in flight for this workspace',
        { workspacePath },
      );
      return joined;
    }

    // Reserved synchronously. `runScan` is async, so it returns at its first
    // await and the map is populated in the same turn as the call that started
    // it — a second caller in the same tick cannot slip past into a second scan.
    const scan = this.runScan(workspacePath, limit, options).finally(() => {
      this.scansInFlight.delete(key);
    });
    this.scansInFlight.set(key, scan);
    return scan;
  }

  private async runScan(
    workspacePath: string,
    limit: number,
    options?: ScanAndImportOptions,
  ): Promise<number> {
    this.logger.info('[SessionImporter] Scanning for existing sessions', {
      workspacePath,
      limit,
    });

    const signal = options?.signal;
    if (signal?.aborted === true) return 0;

    const sessionsDir = await this.findSessionsDirectory(workspacePath);
    if (!sessionsDir) {
      this.logger.debug('[SessionImporter] Sessions directory not found');
      return 0;
    }

    let imported = 0;
    const indexImported = await this.importFromSessionsIndex(
      sessionsDir,
      workspacePath,
      limit,
      signal,
    );
    imported += indexImported;
    const remainingLimit = limit - imported;
    if (remainingLimit > 0) {
      const fileImported = await this.importFromJsonlFiles(
        sessionsDir,
        workspacePath,
        remainingLimit,
        signal,
      );
      imported += fileImported;
    }

    await this.pruneTitleOnlySessions(sessionsDir, workspacePath, signal);

    this.logger.info('[SessionImporter] Import complete', {
      imported,
      fromIndex: indexImported,
    });

    return imported;
  }

  /**
   * Remove previously-imported metadata that points to title-only sidecar
   * files — the CLI's `{"type":"ai-title",...}` files that carry no
   * conversation. Earlier builds imported these as phantom "Session <date>"
   * entries; this reconciles the store so they disappear on the next scan.
   *
   * Deletes only when the backing file still exists AND is positively a
   * title-only sidecar (an `ai-title` line with no system/user line). Entries
   * whose JSONL was removed externally, or any file that contains a real
   * session marker, are left untouched.
   */
  private async pruneTitleOnlySessions(
    sessionsDir: string,
    workspacePath: string,
    signal?: AbortSignal,
  ): Promise<number> {
    let pruned = 0;
    try {
      const stored = await this.metadataStore.getForWorkspace(workspacePath);
      for (const entry of stored) {
        if (signal?.aborted === true) break;
        await yieldToEventLoop();
        const filePath = path.join(sessionsDir, `${entry.sessionId}.jsonl`);
        try {
          await fs.promises.access(filePath);
        } catch {
          continue;
        }
        if (await this.isTitleOnlySidecar(filePath)) {
          await this.metadataStore.delete(entry.sessionId);
          pruned++;
        }
      }
    } catch (error) {
      this.logger.debug('[SessionImporter] Title-only prune failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (pruned > 0) {
      this.logger.info('[SessionImporter] Pruned title-only phantom sessions', {
        pruned,
      });
    }

    return pruned;
  }

  /**
   * Detect a title-only sidecar file: parses the leading lines and reports
   * true only when an `ai-title` line is present and no `system`/`user`
   * session line exists. A truncated or unparseable real-session file fails
   * the positive `ai-title` test, so it is never misclassified.
   */
  private async isTitleOnlySidecar(filePath: string): Promise<boolean> {
    try {
      const fd = await fs.promises.open(filePath, 'r');
      const buffer = Buffer.alloc(METADATA_PREFIX_BYTES);
      const { bytesRead } = await fd.read(buffer, 0, METADATA_PREFIX_BYTES, 0);
      await fd.close();

      if (bytesRead === 0) return false;

      const content = buffer.toString('utf-8', 0, bytesRead);
      const lines = splitCompleteRecords(content, bytesRead);

      let sawAiTitle = false;
      for (const line of lines) {
        let msg: { type?: string };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.type === 'system' || msg.type === 'user') return false;
        if (msg.type === 'ai-title') sawAiTitle = true;
      }

      return sawAiTitle;
    } catch {
      return false;
    }
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
    signal?: AbortSignal,
  ): Promise<number> {
    const indexPath = path.join(sessionsDir, 'sessions-index.json');

    try {
      await fs.promises.access(indexPath);
    } catch {
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
      if (index.version && index.version > 1) {
        this.logger.warn(
          '[SessionImporter] Unknown sessions-index.json version, skipping',
          { version: index.version },
        );
        return 0;
      }
      const sortedEntries = [...index.entries]
        .filter(
          (e) =>
            typeof e.sessionId === 'string' &&
            blankToUndefined(e.sessionId) !== undefined &&
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
        if (signal?.aborted === true) break;
        // One macrotask per session, so the renderer keeps being served while
        // the import runs behind the already-open window.
        await yieldToEventLoop();
        try {
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
    signal?: AbortSignal,
  ): Promise<number> {
    const recentFiles = await this.getRecentSessionFiles(sessionsDir, limit);

    let imported = 0;
    for (const file of recentFiles) {
      if (signal?.aborted === true) break;
      await yieldToEventLoop();
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
      const sessionFiles = files.filter(
        (f) => f.endsWith('.jsonl') && !f.startsWith('agent-'),
      );
      const fileInfos: SessionFileInfo[] = [];

      for (const filename of sessionFiles) {
        const filePath = path.join(sessionsDir, filename);
        const stats = await fs.promises.stat(filePath);
        fileInfos.push({
          path: filePath,
          filename,
          mtime: stats.mtimeMs,
        });
      }
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
   *
   * Truncation is expected, not exceptional. The prefix is bounded by BYTES,
   * so its last line is normally cut mid-token; `splitCompleteRecords` drops
   * that tail and a per-record `try` tolerates any remaining bad line. A file
   * whose complete records ALL fail to parse is genuinely corrupt and still
   * yields `null` — the tolerance is for the known-truncated tail, not for
   * everything.
   */
  private async extractMetadata(
    filePath: string,
    workspaceId: string,
    mtime: number,
  ): Promise<SessionMetadata | null> {
    try {
      const fd = await fs.promises.open(filePath, 'r');
      const buffer = Buffer.alloc(METADATA_PREFIX_BYTES);
      const { bytesRead } = await fd.read(buffer, 0, METADATA_PREFIX_BYTES, 0);
      await fd.close();

      if (bytesRead === 0) return null;

      const content = buffer.toString('utf-8', 0, bytesRead);
      const lines = splitCompleteRecords(content, bytesRead);

      let sessionId: string | null = null;
      let sessionName: string | null = null;
      let sawSessionContent = false;
      let parsedRecords = 0;

      for (const line of lines) {
        let msg: {
          type?: string;
          subtype?: string;
          session_id?: string;
          message?: {
            content?: string | Array<{ type: string; text?: string }>;
          };
        };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        parsedRecords++;
        if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
          sessionId = msg.session_id;
        }
        if (msg.type === 'system' || msg.type === 'user') {
          sawSessionContent = true;
        }
        if (msg.type === 'user' && !sessionName) {
          const text = this.extractUserMessageText(msg);
          if (text) {
            sessionName = text.substring(0, 50).trim();
            if (text.length > 50) sessionName += '...';
          }
        }
        if (sessionId && sessionName) break;
      }

      // Complete records were present and none of them was JSON: the file is
      // corrupt rather than merely truncated. Warn — a whole directory failing
      // this way is exactly what stayed invisible behind `imported: 0`.
      if (lines.length > 0 && parsedRecords === 0) {
        this.logger.warn(
          '[SessionImporter] No parseable records in session file prefix',
          { filePath, completeLines: lines.length },
        );
        return null;
      }

      // Skip sidecar files that hold no conversation — e.g. the CLI's
      // title-only `{"type":"ai-title",...}` files. They carry no system
      // init or user turn, so importing them produces phantom
      // "Session <date>" entries in the session list.
      //
      // Gated on having actually read a record: when the first record alone
      // exceeds the prefix there is nothing to judge from, and a real session
      // must not be discarded as a sidecar on no evidence. Sidecars are tiny,
      // so they are always read whole and always reach this guard.
      if (parsedRecords > 0 && !sawSessionContent) return null;

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
      // Only I/O now reaches here — per-record parse failures are handled
      // above. A file we could open but not read is worth more than debug.
      this.logger.warn('[SessionImporter] Failed to extract metadata', {
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
    const escapedPath = workspacePath.replace(/[:\\/]/g, '-');

    this.logger.debug('[SessionImporter] findSessionsDirectory', {
      workspacePath,
      escapedPath,
    });

    const dirs = await fs.promises.readdir(projectsDir);
    if (dirs.includes(escapedPath)) {
      return path.join(projectsDir, escapedPath);
    }
    const lowerEscaped = escapedPath.toLowerCase();
    const lowerMatch = dirs.find((d) => d.toLowerCase() === lowerEscaped);
    if (lowerMatch) {
      return path.join(projectsDir, lowerMatch);
    }
    const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, '-');
    const normalizedEscaped = normalize(escapedPath);
    const normalizedMatch = dirs.find(
      (d) => normalize(d) === normalizedEscaped,
    );
    if (normalizedMatch) {
      return path.join(projectsDir, normalizedMatch);
    }
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
