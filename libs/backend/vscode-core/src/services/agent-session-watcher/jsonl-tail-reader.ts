/**
 * JSONL Tail Reader (Wave C7a — TASK_2025_291)
 *
 * Extracted from {@link AgentSessionWatcherService}.
 *
 * Responsibilities:
 * - Own the per-file tailing loop (`setInterval` + incremental reads) for a
 *   single `ActiveWatch`.
 * - Read new bytes since `watch.fileOffset`, prepend any buffered incomplete
 *   line, split into JSONL messages, parse, and surface structured content
 *   blocks via an `onChunk` callback.
 * - Handle partial-line buffering at end-of-read so streaming writes don't
 *   produce PARSE_ERROR entries.
 *
 * The coordinator owns the mutable {@link ActiveWatch} state and passes a
 * reference in; this module only mutates the watch (offset, buffer, summary
 * content, tail interval) through that reference.
 *
 * @packageDocumentation
 */

import * as fs from 'fs';
import type { Logger } from '../../logging/logger';
import {
  extractContentBlocks,
  type AgentContentBlock,
  type AgentJsonlMessage,
} from './agent-jsonl-parser';

/**
 * Internal tracking for active agent watches.
 *
 * Mirrors the original `ActiveWatch` interface defined inside
 * {@link AgentSessionWatcherService}. Exported so the coordinator and the
 * tail reader can share the shape.
 */
export interface ActiveWatch {
  /** Unique agent identifier (primary key for Map) */
  agentId: string;
  /** Main session ID (to match agent files) */
  sessionId: string;
  /** Task tool_use ID (set later via setToolUseId, may be null) */
  toolUseId: string | null;
  /** Agent type (e.g., 'Explore', 'Plan') - TASK_2025_100 */
  agentType: string;
  /** When the agent was detected */
  startTime: number;
  /** Path to the matched agent file (once found) */
  agentFilePath: string | null;
  /** Last read position in the file */
  fileOffset: number;
  /** Accumulated summary content */
  summaryContent: string;
  /** Interval for tailing the file */
  tailInterval: NodeJS.Timeout | null;
  /**
   * TASK_2025_102: Buffer for incomplete lines from previous reads.
   * When reading file content mid-write, we may get a partial JSON line
   * at the end. This buffer stores that partial content to be prepended
   * to the next read, ensuring we don't lose data.
   */
  incompleteLineBuffer: string;
  /** TASK_2025_217: Set by coordinator when a background agent is detected. */
  isBackground?: boolean;
}

/**
 * Result of a single tail iteration.
 *
 * The coordinator uses this to construct and emit the final
 * `AgentSummaryChunk` — it knows the session id, tool-use id, and event
 * name. The tail reader deliberately does not emit events itself.
 */
export interface TailChunk {
  summaryDelta: string;
  contentBlocks: AgentContentBlock[];
}

/** Interval (ms) between tail reads — preserved from original constants. */
export const TAIL_INTERVAL_MS = 200;

/**
 * Read new content from the agent file and invoke `onChunk` when parsed
 * content is available. Mutates `watch.fileOffset`, `watch.summaryContent`,
 * and `watch.incompleteLineBuffer` in-place.
 */
export async function readNewContent(
  watch: ActiveWatch,
  filePath: string,
  logger: Logger,
  onChunk: (chunk: TailChunk) => void,
): Promise<void> {
  try {
    const stats = await fs.promises.stat(filePath);
    const fileSize = stats.size;

    // No new content
    if (fileSize <= watch.fileOffset) return;

    // DIAGNOSTIC: Log that we found new content
    const newBytes = fileSize - watch.fileOffset;
    logger.info('[AgentSessionWatcher] Reading new content', {
      agentId: watch.agentId,
      fileOffset: watch.fileOffset,
      fileSize,
      newBytes,
      hasBufferedContent: watch.incompleteLineBuffer.length > 0,
    });

    // Read new content
    const fd = await fs.promises.open(filePath, 'r');
    const buffer = Buffer.alloc(newBytes);
    await fd.read(buffer, 0, buffer.length, watch.fileOffset);
    await fd.close();

    watch.fileOffset = fileSize;

    // TASK_2025_102: Prepend any buffered incomplete content from previous read
    const newContent = watch.incompleteLineBuffer + buffer.toString('utf-8');
    watch.incompleteLineBuffer = ''; // Clear buffer

    // Split by newlines - but be careful with the last line
    const rawLines = newContent.split('\n');

    // TASK_2025_102: The last element after split may be incomplete if file
    // was read mid-write. We'll try to parse it, and if it fails, buffer it.
    const lines: string[] = [];
    const messageTypes: string[] = [];
    let summaryDelta = '';
    const allContentBlocks: AgentContentBlock[] = [];

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i].trim();
      if (!line) continue; // Skip empty lines

      const isLastLine = i === rawLines.length - 1;

      try {
        const msg = JSON.parse(line) as AgentJsonlMessage;
        messageTypes.push(msg.type || 'unknown');
        lines.push(line);

        // TASK_2025_102: Extract structured content blocks for interleaving
        const { summaryText, contentBlocks } = extractContentBlocks(
          msg,
          logger,
        );
        if (summaryText) {
          summaryDelta += summaryText;
        }
        if (contentBlocks.length > 0) {
          allContentBlocks.push(...contentBlocks);
        }
      } catch {
        // TASK_2025_102: If this is the last line and it failed to parse,
        // it's likely incomplete (read mid-write). Buffer it for next read.
        if (isLastLine && line.length > 0) {
          watch.incompleteLineBuffer = line;
          logger.debug(
            '[AgentSessionWatcher] Buffering incomplete line for next read',
            {
              agentId: watch.agentId,
              lineLength: line.length,
              linePreview: line.slice(0, 50),
            },
          );
        } else {
          // Non-last line that failed to parse - this is genuinely malformed
          messageTypes.push('PARSE_ERROR');
          logger.warn('[AgentSessionWatcher] Malformed JSON line (not last)', {
            agentId: watch.agentId,
            lineIndex: i,
            lineLength: line.length,
            linePreview: line.slice(0, 100),
          });
        }
      }
    }

    // DIAGNOSTIC: Always log what we found in the file
    logger.info('[AgentSessionWatcher] Parsed new content', {
      agentId: watch.agentId,
      linesCount: lines.length,
      messageTypes,
      summaryDeltaLength: summaryDelta.length,
      hasTextContent: summaryDelta.length > 0,
      hasBufferedIncomplete: watch.incompleteLineBuffer.length > 0,
      contentBlocksCount: allContentBlocks.length,
      contentBlockTypes: allContentBlocks.map((b) => b.type),
    });

    if (summaryDelta || allContentBlocks.length > 0) {
      watch.summaryContent += summaryDelta;
      onChunk({
        summaryDelta,
        contentBlocks: allContentBlocks,
      });
    }
  } catch (error) {
    // File may not exist yet or be locked, ignore
    logger.debug('AgentSessionWatcher: Error reading file', {
      agentId: watch.agentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Begin tailing `filePath` for `watch`. Clears any existing interval on the
 * watch, performs an initial read, then schedules recurring reads every
 * {@link TAIL_INTERVAL_MS}.
 *
 * The coordinator is responsible for stopping the interval via
 * `clearInterval(watch.tailInterval)` when the watch is removed.
 */
export function startTailingFile(
  watch: ActiveWatch,
  filePath: string,
  logger: Logger,
  onChunk: (chunk: TailChunk) => void,
): void {
  // DIAGNOSTIC: INFO level
  logger.info('[AgentSessionWatcher] Starting to TAIL file', {
    agentId: watch.agentId,
    filePath,
    toolUseId: watch.toolUseId,
  });

  // Clear existing interval if any
  if (watch.tailInterval) {
    clearInterval(watch.tailInterval);
  }

  // Read initial content
  void readNewContent(watch, filePath, logger, onChunk);

  // Set up interval to check for new content
  watch.tailInterval = setInterval(() => {
    void readNewContent(watch, filePath, logger, onChunk);
  }, TAIL_INTERVAL_MS);
}
