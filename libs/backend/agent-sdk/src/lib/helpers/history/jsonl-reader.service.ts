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
 * A resolved sessions directory, valid only while `~/.claude/projects` still
 * carries the mtime it carried when the scan ran.
 */
interface SessionsDirEntry {
  readonly resolved: string | null;
  readonly projectsMtimeMs: number;
}

/** One transcript parsed once, reusable while the file on disk is unchanged. */
interface ParsedTranscriptEntry {
  readonly size: number;
  readonly mtimeMs: number;
  readonly cachedAt: number;
  readonly messages: SessionHistoryMessage[];
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

  /**
   * Resolved sessions directories, keyed by workspace path.
   *
   * See {@link findSessionsDirectory} for why the `~/.claude/projects` mtime is
   * the whole invalidation rule.
   */
  private readonly sessionsDirCache = new Map<string, SessionsDirEntry>();

  /**
   * Cap on remembered workspaces, evicted least-recently-used.
   *
   * The mtime token invalidates an entry but never REMOVES one, so without a
   * bound this map grows once per distinct workspace path for the life of an
   * Electron process — and this is a long-lived process whose users switch
   * folders (judge round 1, TASK_2026_353). 32 is far above any plausible
   * working set of open projects, so the cap is a leak guard, not a tuning
   * knob: a host that reaches it was never going to get cache hits on the
   * evicted entries anyway. Entries are tiny (a path and a number), which is
   * why this is a count and not a byte budget.
   */
  private readonly SESSIONS_DIR_CACHE_MAX_ENTRIES = 32;

  /** Parsed transcripts, keyed by absolute file path. See {@link readJsonlMessages}. */
  private readonly transcriptCache = new Map<string, ParsedTranscriptEntry>();

  /** Sum of the on-disk sizes currently represented in {@link transcriptCache}. */
  private transcriptCacheBytes = 0;

  /**
   * A parsed transcript is reusable for this long. The duplicate reads this
   * cache exists for happen within one interaction — `chat:resume` parses the
   * same file twice back to back, `session:stats-batch` parses it again a
   * moment later — so a short window captures all of them without pinning
   * transcript-sized arrays in the heap for the life of the process.
   */
  private readonly TRANSCRIPT_CACHE_TTL_MS = 60_000;

  /** Cap on the summed on-disk size of every cached transcript. */
  private readonly TRANSCRIPT_CACHE_MAX_BYTES = 24 * 1024 * 1024;

  /**
   * Never cache a transcript larger than this: the parsed form is several times
   * bigger than the bytes on disk.
   *
   * Derived from {@link TRANSCRIPT_CACHE_MAX_BYTES} rather than written out, so
   * that "anything cacheable fits in the cache ON ITS OWN" holds by
   * construction. {@link cacheTranscript}'s eviction loop relies on it: it can
   * evict every OTHER entry and stop, and never has to consider evicting the
   * entry it just wrote. Break the relation and that loop starts throwing away
   * the value it was asked to store.
   */
  private readonly TRANSCRIPT_CACHE_MAX_FILE_BYTES =
    this.TRANSCRIPT_CACHE_MAX_BYTES / 2;

  /** Cap on the number of cached transcripts, whatever their size. */
  private readonly TRANSCRIPT_CACHE_MAX_ENTRIES = 8;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Find the sessions directory for a workspace.
   *
   * Claude stores sessions in ~/.claude/projects/{escaped-workspace-path}/
   * The workspace path is escaped by replacing : and / with -
   *
   * ## Memoised on the projects directory's mtime
   *
   * The scan below `readdir`s `~/.claude/projects` and then does up to four
   * passes over the result. Its answer depends on exactly one thing: the SET of
   * child directories. A directory's mtime moves when a child is created or
   * removed and at no other time, so `mtimeMs` is an exact validity token for
   * this answer — not a heuristic, and not a TTL.
   *
   * That also makes the NEGATIVE answer safe to cache. `null` means "no
   * directory here matches this workspace", which can only stop being true once
   * a directory is created, which moves the mtime.
   *
   * Measured before this memo: 24 identical scans of the same 18-entry
   * directory in one boot (`tmp/logs/log.log`, TASK_2026_353), from
   * `SessionHistoryReaderService`, `memory-curator`, `skill-synthesis` and
   * `SessionRpcHandlers`. A `stat` that fails for any reason falls through to
   * the full scan, so the memo can never be the reason a lookup fails.
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
      // Nothing under a directory that no longer exists is still resolvable.
      this.sessionsDirCache.clear();
      return null;
    }

    const projectsMtimeMs = await this.readProjectsDirMtime(projectsDir);
    if (projectsMtimeMs !== null) {
      const cached = this.sessionsDirCache.get(workspacePath);
      if (cached && cached.projectsMtimeMs === projectsMtimeMs) {
        // Re-insert to make the eviction order least-recently-USED: the
        // workspace being worked in is asked for constantly and must not age
        // out behind one that was merely visited later.
        this.sessionsDirCache.delete(workspacePath);
        this.sessionsDirCache.set(workspacePath, cached);
        return cached.resolved;
      }
    }

    const resolved = await this.scanForSessionsDirectory(
      projectsDir,
      workspacePath,
    );

    if (projectsMtimeMs !== null) {
      this.sessionsDirCache.delete(workspacePath);
      this.sessionsDirCache.set(workspacePath, { resolved, projectsMtimeMs });
      this.evictOldestSessionsDirEntries();
    }

    return resolved;
  }

  /**
   * Drop least-recently-used workspaces until the map is within
   * {@link SESSIONS_DIR_CACHE_MAX_ENTRIES}. Map iteration order is insertion
   * order, and every read and write re-inserts, so the front of the map is the
   * least recently used entry.
   */
  private evictOldestSessionsDirEntries(): void {
    while (this.sessionsDirCache.size > this.SESSIONS_DIR_CACHE_MAX_ENTRIES) {
      const oldest = this.sessionsDirCache.keys().next();
      if (oldest.done) return;
      this.sessionsDirCache.delete(oldest.value);
    }
  }

  /**
   * `mtimeMs` of `~/.claude/projects`, or `null` if it cannot be read — in
   * which case the caller scans and caches nothing rather than trusting a
   * token it could not verify.
   */
  private async readProjectsDirMtime(
    projectsDir: string,
  ): Promise<number | null> {
    try {
      const stats = await fs.stat(projectsDir);
      return typeof stats.mtimeMs === 'number' ? stats.mtimeMs : null;
    } catch (error: unknown) {
      this.logger.debug('[JsonlReader] Could not stat projects directory', {
        projectsDir,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * The actual directory scan: exact → lowercase → hyphen/underscore-normalized
   * → partial match on the workspace's basename. Unchanged from before the
   * memo; extracted so there is ONE place the result is cached rather than five
   * return statements each needing to remember.
   */
  private async scanForSessionsDirectory(
    projectsDir: string,
    workspacePath: string,
  ): Promise<string | null> {
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
   * ## The parse is memoised on `(path, size, mtimeMs)`
   *
   * Three independent callers read the SAME transcript within a second of each
   * other on the resume path: `chat:resume` calls `readSessionHistory()` and
   * then `readHistoryAsMessages()` — two full parses of one file — and
   * `session:stats-batch` parses it again for the sidebar. Nothing about the
   * bytes changed between them.
   *
   * `size` AND `mtimeMs` together are an exact validity token for an
   * append-only transcript: an appended turn moves the size, and a rewrite
   * moves the mtime. Neither alone is enough (`mtimeMs` has millisecond
   * resolution, and a same-size rewrite leaves the size untouched), which is
   * why both are compared.
   *
   * The `fs.stat` this needs is the one already taken for the size guard, so
   * the memo costs no extra syscall. {@link readJsonlTail} is deliberately NOT
   * memoised — its result depends on `maxBytes` as well, and its callers read
   * a moving window of a file that is actively being appended to.
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

    const cached = this.readCachedTranscript(filePath, stats);
    if (cached) return cached;

    const messages = await this.parseJsonlStream(
      createReadStream(filePath, {
        encoding: 'utf8',
        highWaterMark: this.READ_CHUNK_BYTES,
      }),
      filePath,
      { dropFirstLine: false, signal: options?.signal },
    );

    this.cacheTranscript(filePath, stats, messages);
    // Every caller gets its OWN array. The elements are shared — nothing in the
    // history pipeline mutates a parsed message — but an array-level mutation
    // (a `sort`, a `splice`) by one caller must not reach the next one.
    return [...messages];
  }

  /**
   * The cached parse for this file, if it is still valid, as a fresh array.
   * Returns `null` on a miss and drops the stale entry as it goes.
   */
  private readCachedTranscript(
    filePath: string,
    stats: { size: number; mtimeMs: number },
  ): SessionHistoryMessage[] | null {
    const entry = this.transcriptCache.get(filePath);
    if (!entry) return null;

    const isCurrent =
      entry.size === stats.size && entry.mtimeMs === stats.mtimeMs;
    const isFresh = Date.now() - entry.cachedAt < this.TRANSCRIPT_CACHE_TTL_MS;
    if (!isCurrent || !isFresh) {
      this.dropCachedTranscript(filePath);
      return null;
    }

    // Re-insert so the eviction order below is least-recently-USED rather than
    // least-recently-written: the transcript being resumed is read repeatedly
    // and must not be the first one evicted.
    this.transcriptCache.delete(filePath);
    this.transcriptCache.set(filePath, entry);
    return [...entry.messages];
  }

  /** Store a parse, then evict until the entry and byte caps hold. */
  private cacheTranscript(
    filePath: string,
    stats: { size: number; mtimeMs: number },
    messages: SessionHistoryMessage[],
  ): void {
    if (stats.size > this.TRANSCRIPT_CACHE_MAX_FILE_BYTES) return;
    // No usable mtime means no validity token, and an entry that cannot be
    // invalidated is worse than no entry.
    if (typeof stats.mtimeMs !== 'number') return;

    this.dropCachedTranscript(filePath);
    this.transcriptCache.set(filePath, {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      cachedAt: Date.now(),
      messages,
    });
    this.transcriptCacheBytes += stats.size;

    // Evict least-recently-used until both caps hold. The entry just written is
    // LAST in insertion order and, being at most
    // TRANSCRIPT_CACHE_MAX_FILE_BYTES = MAX_BYTES / 2, satisfies both caps on
    // its own — so the loop always stops before reaching it and needs no
    // self-skip. That is a property of the two constants, which is why they are
    // related by construction rather than written out independently.
    for (const [key] of this.transcriptCache) {
      const withinCaps =
        this.transcriptCache.size <= this.TRANSCRIPT_CACHE_MAX_ENTRIES &&
        this.transcriptCacheBytes <= this.TRANSCRIPT_CACHE_MAX_BYTES;
      if (withinCaps) break;
      this.dropCachedTranscript(key);
    }
  }

  private dropCachedTranscript(filePath: string): void {
    const entry = this.transcriptCache.get(filePath);
    if (!entry) return;
    this.transcriptCache.delete(filePath);
    this.transcriptCacheBytes -= entry.size;
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
   * then discarded. That is what makes the partial-line rule exact: if the
   * extra byte is a newline the discarded "line" is empty and the first full
   * line survives intact; otherwise the discarded line is the fragment that the
   * window cut in half. Reading from `size - maxBytes` and dropping the first
   * line unconditionally would eat a complete line whenever the window happened
   * to land on a boundary.
   *
   * The drop is conditional on the read actually starting past byte 0. When
   * `windowStart` is exactly 1 the extra byte pulls the read back to the start
   * of the file, so there is no truncated fragment to discard and the "first
   * line" is a real one — dropping it silently lost a turn. Repro:
   * `AAA\nBBB\nCCC\n` with `maxBytes = 11` returned `['BBB','CCC']`
   * (TASK_2026_328).
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
    const readStart = windowStart - 1;
    return this.parseJsonlStream(
      createReadStream(filePath, {
        encoding: 'utf8',
        highWaterMark: this.READ_CHUNK_BYTES,
        start: readStart,
      }),
      filePath,
      { dropFirstLine: readStart > 0, signal: options.signal },
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
