/**
 * Agent Session Watcher Service
 *
 * Watches for agent JSONL files during streaming to provide real-time
 * summary content updates. When an agent (Task tool) starts, this service
 * watches the sessions directory for new agent-*.jsonl files and streams
 * their text content (summary) to the frontend.
 *
 * Flow:
 * 1. Task tool_use detected → startWatching(toolUseId, sessionId)
 * 2. New agent file appears → match to session, start tailing
 * 3. File grows → extract text blocks, emit summary chunks
 * 4. Task tool_result received → stopWatching(toolUseId)
 */

import { injectable, inject } from 'tsyringe';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import type { Logger } from '../logging/logger';
import { TOKENS } from '../di/tokens';

/**
 * Summary chunk emitted when new content is found in agent file
 */
export interface AgentSummaryChunk {
  /** The Task tool_use ID this summary belongs to */
  toolUseId: string;
  /** New summary text to append */
  summaryDelta: string;
}

/**
 * Internal tracking for active agent watches
 */
interface ActiveWatch {
  /** Main session ID (to match agent files) */
  sessionId: string;
  /** When the Task tool was detected */
  startTime: number;
  /** Path to the matched agent file (once found) */
  agentFilePath: string | null;
  /** Last read position in the file */
  fileOffset: number;
  /** Accumulated summary content */
  summaryContent: string;
  /** Interval for tailing the file */
  tailInterval: NodeJS.Timeout | null;
}

@injectable()
export class AgentSessionWatcherService extends EventEmitter {
  /** Active watches by toolUseId */
  private readonly activeWatches = new Map<string, ActiveWatch>();

  /** Directory watcher instance */
  private directoryWatcher: fs.FSWatcher | null = null;

  /** Sessions directory being watched */
  private watchedSessionsDir: string | null = null;

  /** Pending agent matches (files detected before we know which toolUseId they belong to) */
  private readonly pendingAgentFiles = new Map<
    string,
    { filePath: string; sessionId: string; detectedAt: number }
  >();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    super();
  }

  /**
   * Start watching for an agent's session file
   *
   * Called when a Task tool_use is detected in the main stream.
   * Starts watching the sessions directory for new agent-*.jsonl files.
   *
   * @param toolUseId - The Task tool_use ID
   * @param sessionId - The main session ID (to match agent files)
   * @param workspacePath - Workspace path to find sessions directory
   */
  async startWatching(
    toolUseId: string,
    sessionId: string,
    workspacePath: string
  ): Promise<void> {
    this.logger.debug('AgentSessionWatcher: Starting watch', {
      toolUseId,
      sessionId,
    });

    // Create watch entry
    this.activeWatches.set(toolUseId, {
      sessionId,
      startTime: Date.now(),
      agentFilePath: null,
      fileOffset: 0,
      summaryContent: '',
      tailInterval: null,
    });

    // Ensure we're watching the sessions directory
    await this.ensureDirectoryWatcher(workspacePath);

    // Check if there are any pending files that match this session
    // (agent file may have been created before we started watching)
    this.matchPendingFiles(toolUseId, sessionId);
  }

  /**
   * Stop watching for an agent's session file
   *
   * Called when a Task tool_result is received (agent completed).
   * Stops tailing the file and cleans up.
   *
   * @param toolUseId - The Task tool_use ID
   */
  stopWatching(toolUseId: string): void {
    const watch = this.activeWatches.get(toolUseId);
    if (!watch) return;

    this.logger.debug('AgentSessionWatcher: Stopping watch', {
      toolUseId,
      hadFile: !!watch.agentFilePath,
      summaryLength: watch.summaryContent.length,
    });

    // Clear tail interval
    if (watch.tailInterval) {
      clearInterval(watch.tailInterval);
    }

    // Remove from active watches
    this.activeWatches.delete(toolUseId);

    // If no more active watches, stop directory watcher
    if (this.activeWatches.size === 0) {
      this.stopDirectoryWatcher();
    }
  }

  /**
   * Ensure we have a directory watcher running
   */
  private async ensureDirectoryWatcher(workspacePath: string): Promise<void> {
    const sessionsDir = await this.findSessionsDirectory(workspacePath);
    if (!sessionsDir) {
      this.logger.debug('AgentSessionWatcher: Sessions directory not found', {
        workspacePath,
      });
      return;
    }

    // Already watching this directory
    if (this.watchedSessionsDir === sessionsDir && this.directoryWatcher) {
      return;
    }

    // Stop existing watcher if watching different directory
    this.stopDirectoryWatcher();

    this.logger.debug('AgentSessionWatcher: Starting directory watcher', {
      sessionsDir,
    });

    this.watchedSessionsDir = sessionsDir;

    try {
      this.directoryWatcher = fs.watch(sessionsDir, (eventType, filename) => {
        if (eventType === 'rename' && filename?.startsWith('agent-')) {
          this.handleNewAgentFile(sessionsDir, filename);
        }
      });

      this.directoryWatcher.on('error', (error) => {
        this.logger.error(
          'AgentSessionWatcher: Directory watcher error',
          error
        );
        this.stopDirectoryWatcher();
      });

      // Also scan for existing agent files that may have been created
      // just before we started watching
      await this.scanForExistingAgentFiles(sessionsDir);
    } catch (error) {
      this.logger.error(
        'AgentSessionWatcher: Failed to start directory watcher',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Stop the directory watcher
   */
  private stopDirectoryWatcher(): void {
    if (this.directoryWatcher) {
      this.directoryWatcher.close();
      this.directoryWatcher = null;
      this.watchedSessionsDir = null;
    }
  }

  /**
   * Handle a new agent file being detected
   */
  private async handleNewAgentFile(
    sessionsDir: string,
    filename: string
  ): Promise<void> {
    const filePath = path.join(sessionsDir, filename);

    this.logger.debug('AgentSessionWatcher: New agent file detected', {
      filename,
    });

    // Wait a bit for the file to have content
    await this.delay(100);

    // Try to read the first line to get sessionId
    const sessionId = await this.extractSessionIdFromFile(filePath);
    if (!sessionId) {
      this.logger.debug(
        'AgentSessionWatcher: Could not extract sessionId from file',
        { filename }
      );
      return;
    }

    // Find a matching active watch
    let matched = false;
    for (const [toolUseId, watch] of this.activeWatches) {
      if (watch.sessionId === sessionId && !watch.agentFilePath) {
        // Check if file was created around the time of the Task tool
        // (within 30 seconds - generous window)
        const timeDiff = Date.now() - watch.startTime;
        if (timeDiff < 30000) {
          this.logger.debug('AgentSessionWatcher: Matched agent file to tool', {
            toolUseId,
            filename,
            timeDiff,
          });
          watch.agentFilePath = filePath;
          this.startTailingFile(toolUseId, filePath);
          matched = true;
          break;
        }
      }
    }

    // If not matched, store as pending (tool might not have been detected yet)
    if (!matched) {
      this.pendingAgentFiles.set(filePath, {
        filePath,
        sessionId,
        detectedAt: Date.now(),
      });

      // Clean up old pending files after 60 seconds
      setTimeout(() => {
        this.pendingAgentFiles.delete(filePath);
      }, 60000);
    }
  }

  /**
   * Scan for existing agent files that may have been created before watching started
   */
  private async scanForExistingAgentFiles(sessionsDir: string): Promise<void> {
    try {
      const files = await fs.promises.readdir(sessionsDir);
      const agentFiles = files.filter((f) => f.startsWith('agent-'));

      // Get file stats to find recently created files
      const now = Date.now();
      for (const filename of agentFiles) {
        const filePath = path.join(sessionsDir, filename);
        try {
          const stats = await fs.promises.stat(filePath);
          // Only consider files created in the last 30 seconds
          if (now - stats.mtimeMs < 30000) {
            await this.handleNewAgentFile(sessionsDir, filename);
          }
        } catch {
          // Skip files that can't be read
        }
      }
    } catch (error) {
      this.logger.debug(
        'AgentSessionWatcher: Failed to scan for existing files',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  /**
   * Match pending agent files to a newly started watch
   */
  private matchPendingFiles(toolUseId: string, sessionId: string): void {
    const watch = this.activeWatches.get(toolUseId);
    if (!watch) return;

    for (const [filePath, pending] of this.pendingAgentFiles) {
      if (pending.sessionId === sessionId) {
        const timeDiff = Date.now() - pending.detectedAt;
        if (timeDiff < 30000) {
          this.logger.debug(
            'AgentSessionWatcher: Matched pending file to tool',
            { toolUseId, filePath }
          );
          watch.agentFilePath = filePath;
          this.pendingAgentFiles.delete(filePath);
          this.startTailingFile(toolUseId, filePath);
          break;
        }
      }
    }
  }

  /**
   * Start tailing an agent file for new content
   */
  private startTailingFile(toolUseId: string, filePath: string): void {
    const watch = this.activeWatches.get(toolUseId);
    if (!watch) return;

    // Clear existing interval if any
    if (watch.tailInterval) {
      clearInterval(watch.tailInterval);
    }

    // Read initial content
    this.readNewContent(toolUseId, filePath);

    // Set up interval to check for new content
    watch.tailInterval = setInterval(() => {
      this.readNewContent(toolUseId, filePath);
    }, 200); // Check every 200ms
  }

  /**
   * Read new content from the agent file and emit summary chunks
   */
  private async readNewContent(
    toolUseId: string,
    filePath: string
  ): Promise<void> {
    const watch = this.activeWatches.get(toolUseId);
    if (!watch) return;

    try {
      const stats = await fs.promises.stat(filePath);
      const fileSize = stats.size;

      // No new content
      if (fileSize <= watch.fileOffset) return;

      // Read new content
      const fd = await fs.promises.open(filePath, 'r');
      const buffer = Buffer.alloc(fileSize - watch.fileOffset);
      await fd.read(buffer, 0, buffer.length, watch.fileOffset);
      await fd.close();

      watch.fileOffset = fileSize;

      // Parse new lines and extract summary text
      const newContent = buffer.toString('utf-8');
      const lines = newContent.split('\n').filter((line) => line.trim());

      let summaryDelta = '';
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          const text = this.extractSummaryText(msg);
          if (text) {
            summaryDelta += text;
          }
        } catch {
          // Skip malformed lines
        }
      }

      if (summaryDelta) {
        watch.summaryContent += summaryDelta;

        // Emit the chunk
        const chunk: AgentSummaryChunk = {
          toolUseId,
          summaryDelta,
        };

        this.emit('summary-chunk', chunk);

        this.logger.debug('AgentSessionWatcher: Emitted summary chunk', {
          toolUseId,
          deltaLength: summaryDelta.length,
          totalLength: watch.summaryContent.length,
        });
      }
    } catch (error) {
      // File may not exist yet or be locked, ignore
      this.logger.debug('AgentSessionWatcher: Error reading file', {
        toolUseId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Extract summary text from a JSONL message
   *
   * Uses same logic as SessionReplayService.classifyAgentMessages:
   * - Extract text blocks from assistant messages
   * - Skip tool_use blocks (those are execution, not summary)
   */
  private extractSummaryText(msg: any): string | null {
    // Only process assistant messages with content
    if (msg.type !== 'assistant' || !msg.message?.content) {
      return null;
    }

    const textParts: string[] = [];

    for (const block of msg.message.content) {
      if (block.type === 'text' && block.text) {
        textParts.push(block.text);
      }
      // Skip tool_use blocks - they're execution content, not summary
    }

    return textParts.length > 0 ? textParts.join('\n') : null;
  }

  /**
   * Extract sessionId from the first line of an agent file
   */
  private async extractSessionIdFromFile(
    filePath: string
  ): Promise<string | null> {
    try {
      // Read first 4KB to get the first line
      const fd = await fs.promises.open(filePath, 'r');
      const buffer = Buffer.alloc(4096);
      const { bytesRead } = await fd.read(buffer, 0, 4096, 0);
      await fd.close();

      if (bytesRead === 0) return null;

      const content = buffer.toString('utf-8', 0, bytesRead);
      const firstLine = content.split('\n')[0];
      if (!firstLine) return null;

      const msg = JSON.parse(firstLine);
      return msg.sessionId || null;
    } catch {
      return null;
    }
  }

  /**
   * Find the Claude CLI sessions directory for a workspace
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

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Clean up all watchers (for extension deactivation)
   */
  dispose(): void {
    // Stop all tail intervals
    for (const [toolUseId, watch] of this.activeWatches) {
      if (watch.tailInterval) {
        clearInterval(watch.tailInterval);
      }
    }
    this.activeWatches.clear();

    // Stop directory watcher
    this.stopDirectoryWatcher();

    // Clear pending files
    this.pendingAgentFiles.clear();
  }
}
