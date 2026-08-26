/**
 * JSONL Reader Service
 *
 * Handles all JSONL file I/O operations for session history processing.
 * Extracted from SessionHistoryReaderService for single responsibility.
 *
 * Responsibilities:
 * - Find sessions directory for a workspace path
 * - Read JSONL messages from session files
 * - Load linked agent session files
 * - Convert raw JSONL lines to SessionHistoryMessage format
 *
 */

import { injectable, inject } from 'tsyringe';
import * as fs from 'fs/promises';
import { createReadStream } from 'node:fs';
import * as path from 'path';
import * as os from 'os';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type {
  JsonlMessageLine,
  SessionHistoryMessage,
  AgentSessionData,
} from './history.types';
import { SdkError } from '../../errors';

/** Options accepted by every read path on {@link JsonlReaderService}. */
export interface JsonlReadOptions {
  /**
   * Aborts the read between yields. Checked at every event-loop yield, so an
   * abort takes effect within one batch rather than at the end of the file.
   */
  readonly signal?: AbortSignal;
}

/** Options for {@link JsonlReaderService.readJsonlTail}. */
export interface JsonlTailOptions extends JsonlReadOptions {
  /** Size of the window read from the END of the file, in bytes. */
  readonly maxBytes: number;
}

/**
 * Hand back to the event loop. `setImmediate` (not a microtask) is the only
 * primitive that lets pending I/O — the Electron MAIN process's window
 * management, the agent stdout pipes — run before we resume.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * Service for reading JSONL session files.
 *
 * ## Reads are INCREMENTAL and YIELD. This is a hard requirement, not a tuning.
 *
 * Transcripts are read on the backend main thread — in Electron that is the
 * same event loop as `BrowserWindow` management, so a single blocking tick
 * freezes the whole application. This service used to `readFile` the entire
 * transcript (up to {@link MAX_SESSION_FILE_SIZE}, 50 MB), `split` it into an
 * array of every line, and `JSON.parse` each one in ONE synchronous tick, with
 * three independent callers doing that per turn per session: the memory
 * curator on turn-complete (which then keeps only the last 32 KB), skill
 * synthesis 90 s after each Stop, and the subagent metrics extractor on every
 * SubagentStop (TASK_2026_323, blocker B4).
 *
 * Both read paths therefore stream: `for await` over a `createReadStream`
 * already yields once per chunk, and the parse loop yields explicitly every
 * {@link YIELD_EVERY_LINES} lines or {@link YIELD_EVERY_BYTES} bytes so that a
 * chunk dense with short lines cannot monopolise a tick either. A caller that
 * only needs the end of the transcript must use {@link readJsonlTail} rather
 * than reading everything and slicing.
 *
 * Pattern: Injectable service with Logger dependency
 * @see libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:158-164
 */
@injectable()
export class JsonlReaderService {
  /**
   * Maximum session file size allowed for reading (50MB).
   * Prevents memory exhaustion from extremely large session files.
   */
  private readonly MAX_SESSION_FILE_SIZE = 50 * 1024 * 1024;

  /** Read granularity. Also the natural yield granularity of `for await`. */
  private readonly READ_CHUNK_BYTES = 64 * 1024;

  /** Yield after this many parsed lines, whatever their size. */
  private readonly YIELD_EVERY_LINES = 200;

  /** Yield after this many consumed bytes, however few lines they held. */
  private readonly YIELD_EVERY_BYTES = 1024 * 1024;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Find the sessions directory for a workspace.
   *
   * Claude stores sessions in ~/.claude/projects/{escaped-workspace-path}/
   * The workspace path is escaped by replacing : and / with -
   *
   * @param workspacePath - The absolute path to the workspace
   * @returns The sessions directory path, or null if not found
   */
  async findSessionsDirectory(workspacePath: string): Promise<string | null> {
    const homeDir = os.homedir();
    const projectsDir = path.join(homeDir, '.claude', 'projects');

    try {
      await fs.access(projectsDir);
    } catch {
      this.logger.warn('[JsonlReader] Projects directory does not exist', {
        projectsDir,
      });
      return null;
    }
    const escapedPath = workspacePath.replace(/[:\\/]/g, '-');
    const dirs = await fs.readdir(projectsDir);

    this.logger.debug('[JsonlReader] findSessionsDirectory', {
      workspacePath,
      escapedPath,
      dirCount: dirs.length,
      sampleDirs: dirs.slice(0, 10),
    });
    if (dirs.includes(escapedPath)) {
      return path.join(projectsDir, escapedPath);
    }
    const lowerEscaped = escapedPath.toLowerCase();
    const match = dirs.find((d) => d.toLowerCase() === lowerEscaped);
    if (match) {
      return path.join(projectsDir, match);
    }
    const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, '-');
    const normalizedEscaped = normalize(escapedPath);
    const normalizedMatch = dirs.find(
      (d) => normalize(d) === normalizedEscaped,
    );
    if (normalizedMatch) {
      return path.join(projectsDir, normalizedMatch);
    }
    const workspaceName = path.basename(workspacePath);
    const normalizedWorkspaceName = normalize(workspaceName);
    const partialMatch = dirs.find(
      (d) =>
        d.toLowerCase().includes(workspaceName.toLowerCase()) ||
        normalize(d).includes(normalizedWorkspaceName),
    );
    if (partialMatch) {
      return path.join(projectsDir, partialMatch);
    }

    this.logger.warn(
      '[JsonlReader] Sessions directory not found after all match attempts',
      {
        workspacePath,
        escapedPath,
        lowerEscaped,
        workspaceName,
      },
    );

    return null;
  }

  /**
   * Read all messages from a JSONL file.
   *
   * Streams the file and parses it in batches, yielding to the event loop
   * between batches. Skips malformed lines instead of throwing.
   * Enforces a maximum file size limit to prevent memory exhaustion.
   *
   * @param filePath - Absolute path to the JSONL file
   * @param options - Optional abort signal
   * @returns Array of parsed session history messages
   * @throws SdkError if file exceeds maximum size limit
   */
  async readJsonlMessages(
    filePath: string,
    options?: JsonlReadOptions,
  ): Promise<SessionHistoryMessage[]> {
    options?.signal?.throwIfAborted();

    const stats = await fs.stat(filePath);
    if (stats.size > this.MAX_SESSION_FILE_SIZE) {
      const sizeMB = Math.round(stats.size / 1024 / 1024);
      const limitMB = Math.round(this.MAX_SESSION_FILE_SIZE / 1024 / 1024);
      this.logger.warn(
        `[JsonlReader] Session file exceeds size limit: ${stats.size} bytes`,
        { filePath, sizeMB, limitMB },
      );
      throw new SdkError(
        `Session file too large (${sizeMB}MB). Max: ${limitMB}MB`,
      );
    }
    if (stats.size === 0) return [];

    return this.parseJsonlStream(
      createReadStream(filePath, {
        encoding: 'utf8',
        highWaterMark: this.READ_CHUNK_BYTES,
      }),
      filePath,
      { dropFirstLine: false, signal: options?.signal },
    );
  }

  /**
   * Read only the LAST `maxBytes` of a JSONL file.
   *
   * For callers that want a recent excerpt and nothing else — the memory
   * curator composes a transcript from the tail of the session and discards
   * everything before it, so reading and parsing the whole file was pure waste
   * proportional to session length (TASK_2026_323, B4).
   *
   * The window starts one byte EARLIER than requested and the first line is
   * then always discarded. That is what makes the partial-line rule exact: if
   * the extra byte is a newline the discarded "line" is empty and the first
   * full line survives intact; otherwise the discarded line is the fragment
   * that the window cut in half. Reading from `size - maxBytes` and dropping
   * the first line unconditionally would eat a complete line whenever the
   * window happened to land on a boundary.
   *
   * Deliberately NOT subject to {@link MAX_SESSION_FILE_SIZE}: that guard
   * exists to bound memory, and a tail read is bounded by `maxBytes` by
   * construction. A 60 MB transcript still yields its tail here, where
   * {@link readJsonlMessages} refuses it.
   *
   * @param filePath - Absolute path to the JSONL file
   * @param options - `maxBytes` window size, plus an optional abort signal
   * @returns Parsed messages from the tail window, oldest first
   */
  async readJsonlTail(
    filePath: string,
    options: JsonlTailOptions,
  ): Promise<SessionHistoryMessage[]> {
    options.signal?.throwIfAborted();

    const maxBytes = Math.floor(options.maxBytes);
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) return [];

    const stats = await fs.stat(filePath);
    if (stats.size === 0) return [];
    if (stats.size <= maxBytes) {
      // Whole file fits in the window: no partial line to discard, and the
      // size guard is irrelevant because `maxBytes` already bounds us.
      return this.parseJsonlStream(
        createReadStream(filePath, {
          encoding: 'utf8',
          highWaterMark: this.READ_CHUNK_BYTES,
        }),
        filePath,
        { dropFirstLine: false, signal: options.signal },
      );
    }

    const windowStart = stats.size - maxBytes;
    return this.parseJsonlStream(
      createReadStream(filePath, {
        encoding: 'utf8',
        highWaterMark: this.READ_CHUNK_BYTES,
        start: windowStart - 1,
      }),
      filePath,
      { dropFirstLine: true, signal: options.signal },
    );
  }

  /**
   * Consume a text stream one line at a time, parsing each into a
   * {@link SessionHistoryMessage} and yielding to the event loop between
   * batches.
   *
   * The pending text is held in a single buffer advanced by an index rather
   * than re-sliced per line: slicing off the front of the buffer for every
   * line makes the cost quadratic in lines-per-chunk, which is the same defect
   * this method exists to remove.
   */
  private async parseJsonlStream(
    stream: NodeJS.ReadableStream,
    filePath: string,
    options: { dropFirstLine: boolean; signal?: AbortSignal },
  ): Promise<SessionHistoryMessage[]> {
    const messages: SessionHistoryMessage[] = [];
    const { signal } = options;
    let skipNextLine = options.dropFirstLine;
    let buffer = '';
    let linesSinceYield = 0;
    let charsSinceYield = 0;

    try {
      for await (const chunk of stream) {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        buffer += text;
        charsSinceYield += text.length;

        let start = 0;
        let newlineAt = buffer.indexOf('\n', start);
        while (newlineAt !== -1) {
          const line = buffer.slice(start, newlineAt);
          start = newlineAt + 1;

          if (skipNextLine) {
            skipNextLine = false;
          } else {
            this.parseAndCollect(line, messages, filePath);
          }

          linesSinceYield++;
          if (
            linesSinceYield >= this.YIELD_EVERY_LINES ||
            charsSinceYield >= this.YIELD_EVERY_BYTES
          ) {
            linesSinceYield = 0;
            charsSinceYield = 0;
            await yieldToEventLoop();
            signal?.throwIfAborted();
          }

          newlineAt = buffer.indexOf('\n', start);
        }

        buffer = start > 0 ? buffer.slice(start) : buffer;
      }
    } finally {
      // Throwing out of `for await` (abort) leaves the fd open otherwise.
      if ('destroy' in stream && typeof stream.destroy === 'function') {
        stream.destroy();
      }
    }

    // Trailing line with no terminating newline.
    if (buffer.length > 0 && !skipNextLine) {
      this.parseAndCollect(buffer, messages, filePath);
    }

    return messages;
  }

  /**
   * Parse one JSONL line and append it, skipping blank and malformed lines
   * exactly as the previous whole-file implementation did.
   */
  private parseAndCollect(
    rawLine: string,
    messages: SessionHistoryMessage[],
    filePath: string,
  ): void {
    // The previous implementation split on `/\r?\n/`, so a CRLF file never
    // presented the `\r` to `JSON.parse` or to the malformed-line preview.
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line.trim()) return;

    try {
      const parsed = JSON.parse(line) as JsonlMessageLine;
      messages.push(this.convertToSessionHistoryMessage(parsed));
    } catch {
      this.logger.debug('[JsonlReader] Skipping malformed JSONL line', {
        filePath,
        linePreview: line.substring(0, 100),
      });
    }
  }

  /**
   * Convert JsonlMessageLine to SessionHistoryMessage format.
   *
   * Maps the raw JSONL structure to the extended JSONLMessage format
   * used throughout the history processing pipeline.
   *
   * @param line - Raw JSONL message line
   * @returns Converted session history message
   */
  private convertToSessionHistoryMessage(
    line: JsonlMessageLine,
  ): SessionHistoryMessage {
    return {
      type: (line.type ||
        line.message?.role ||
        'unknown') as SessionHistoryMessage['type'],
      subtype: line.subtype,
      uuid: line.uuid,
      sessionId: line.sessionId,
      timestamp: line.timestamp,
      isMeta: line.isMeta,
      slug: line.slug,
      message: line.message as SessionHistoryMessage['message'],
      model: line.model,
      usage: line.message?.usage,
    };
  }

  /**
   * Load agent session files (agent-*.jsonl) for a parent session.
   *
   * Agent files can be stored in two locations (SDK version dependent):
   * 1. Legacy: {sessionsDir}/agent-{id}.jsonl (flat, same directory as main session)
   * 2. Current: {sessionsDir}/{parentSessionId}/subagents/agent-{id}.jsonl (nested)
   *
   * Each agent file contains messages from a subagent spawned by Task tool.
   * Files are filtered to only include agents belonging to the parent session.
   *
   * @param sessionsDir - Path to the sessions directory
   * @param parentSessionId - ID of the parent session to filter by
   * @returns Array of agent session data
   */
  async loadAgentSessions(
    sessionsDir: string,
    parentSessionId: string,
  ): Promise<AgentSessionData[]> {
    const agentSessions: AgentSessionData[] = [];
    const agentFilePaths: { filePath: string; agentId: string }[] = [];
    const subagentsDir = path.join(sessionsDir, parentSessionId, 'subagents');

    let subagentFiles: string[] = [];
    try {
      subagentFiles = await fs.readdir(subagentsDir);
    } catch {
      subagentFiles = [];
    }
    const agentFiles = subagentFiles.filter(
      (f) => f.startsWith('agent-') && f.endsWith('.jsonl'),
    );
    for (const file of agentFiles) {
      agentFilePaths.push({
        filePath: path.join(subagentsDir, file),
        agentId: file.replace('.jsonl', ''),
      });
    }
    if (agentFilePaths.length === 0) {
      let files: string[] = [];
      try {
        files = await fs.readdir(sessionsDir);
      } catch {
        files = [];
      }
      const agentFiles = files.filter(
        (f) => f.startsWith('agent-') && f.endsWith('.jsonl'),
      );
      for (const file of agentFiles) {
        agentFilePaths.push({
          filePath: path.join(sessionsDir, file),
          agentId: file.replace('.jsonl', ''),
        });
      }
    }

    this.logger.info('[JsonlReader] Scanning for agent files', {
      sessionsDir,
      parentSessionId,
      agentFilesFound: agentFilePaths.length,
      source:
        agentFilePaths.length > 0 &&
        agentFilePaths[0].filePath.includes('subagents')
          ? 'nested'
          : 'legacy',
    });

    for (const { filePath, agentId } of agentFilePaths) {
      try {
        const messages = await this.readJsonlMessages(filePath);
        const isNested = filePath.includes(
          path.join(parentSessionId, 'subagents'),
        );
        const firstMsg = messages[0];

        if (isNested || firstMsg?.sessionId === parentSessionId) {
          agentSessions.push({
            agentId,
            filePath,
            messages,
          });
        }
      } catch {
        this.logger.debug('[JsonlReader] Skipping unreadable agent file', {
          filePath,
        });
      }
    }

    return agentSessions;
  }
}
