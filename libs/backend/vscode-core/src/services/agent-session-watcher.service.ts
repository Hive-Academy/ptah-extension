/**
 * Agent Session Watcher Service
 *
 * Watches for agent JSONL files during streaming to provide real-time
 * summary content updates. When a subagent starts (via SDK SubagentStart hook),
 * this service watches the sessions directory for new agent-{agent_id}.jsonl
 * files and streams their text content (summary) to the frontend.
 *
 * Flow:
 * 1. SubagentStart hook fires -> startWatching(agentId, sessionId, workspacePath, toolUseId?)
 * 2. New agent file appears -> match by agentId pattern, start tailing
 * 3. File grows -> extract text blocks, emit summary chunks with toolUseId
 * 4. SubagentStop hook fires -> setToolUseId(agentId, toolUseId), stopWatching(agentId)
 *
 * Note: toolUseId may not be available at SubagentStart but is always
 * available at SubagentStop. Use setToolUseId() for late binding.
 */

import { injectable, inject } from 'tsyringe';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import type { Logger } from '../logging/logger';
import { TOKENS } from '../di/tokens';

/**
 * Configuration constants for agent session watching
 */
const AGENT_WATCHER_CONSTANTS = {
  /** Time window (ms) for matching agent files to active watches */
  MATCH_WINDOW_MS: 30_000,
  /** Cleanup timeout (ms) for pending agent files */
  PENDING_CLEANUP_MS: 60_000,
  /** Interval (ms) between file tail reads */
  TAIL_INTERVAL_MS: 200,
  /** Buffer size (bytes) for reading first line of agent file */
  FIRST_LINE_BUFFER_SIZE: 4096,
  /** Delay (ms) after file detection before reading */
  FILE_DETECTION_DELAY_MS: 100,
} as const;

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
 * Agent start event emitted when SubagentStart hook fires
 * TASK_2025_100 FIX: Emit agent_start event early so frontend can create
 * agent node BEFORE summary chunks arrive (fixes race condition)
 */
export interface AgentStartEvent {
  /** The Task tool_use ID this agent belongs to */
  toolUseId: string;
  /** Agent type (e.g., 'Explore', 'Plan', 'software-architect') */
  agentType: string;
  /** Agent description derived from agent type */
  agentDescription: string;
  /** Timestamp when agent started */
  timestamp: number;
  /** Parent session ID (for routing to correct tab) */
  sessionId: string;
}

/**
 * Internal tracking for active agent watches
 */
interface ActiveWatch {
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
}

@injectable()
export class AgentSessionWatcherService extends EventEmitter {
  /** Active watches by agentId (primary key) */
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

  /** Tracked timeout IDs for cleanup on dispose (prevents memory leaks) */
  private readonly pendingCleanupTimeouts = new Set<NodeJS.Timeout>();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    super();
  }

  /**
   * Start watching for an agent's session file
   *
   * Called when SubagentStart hook fires from the SDK.
   * Starts watching the sessions directory for agent-{agent_id}.jsonl files.
   *
   * TASK_2025_100 FIX: Also emits 'agent-start' event so frontend can create
   * agent node BEFORE summary chunks arrive (fixes race condition where
   * summary chunks were buffered because no agent node existed).
   *
   * @param agentId - The unique agent identifier (primary key)
   * @param sessionId - The main session ID (for context)
   * @param workspacePath - Workspace path to find sessions directory
   * @param agentType - Agent type (e.g., 'Explore', 'Plan')
   * @param toolUseId - Optional Task tool_use ID (may be set later via setToolUseId)
   */
  async startWatching(
    agentId: string,
    sessionId: string,
    workspacePath: string,
    agentType: string,
    toolUseId?: string
  ): Promise<void> {
    // DIAGNOSTIC: INFO level to trace execution
    this.logger.info('[AgentSessionWatcher] >>> startWatching CALLED <<<', {
      agentId,
      sessionId,
      agentType,
      toolUseId: toolUseId ?? null,
      workspacePath,
    });

    const startTime = Date.now();

    // Create watch entry keyed by agentId
    this.activeWatches.set(agentId, {
      agentId,
      sessionId,
      toolUseId: toolUseId ?? null,
      agentType,
      startTime,
      agentFilePath: null,
      fileOffset: 0,
      summaryContent: '',
      tailInterval: null,
    });

    // TASK_2025_100 FIX: Emit agent-start event so frontend can create agent node
    // BEFORE summary chunks arrive. This fixes the race condition.
    if (toolUseId) {
      const agentDescription = this.formatAgentDescription(agentType);
      const agentStartEvent: AgentStartEvent = {
        toolUseId,
        agentType,
        agentDescription,
        timestamp: startTime,
        sessionId, // Parent session ID for tab routing
      };

      this.logger.debug('AgentSessionWatcher: Emitting agent-start event', {
        agentId,
        toolUseId,
        agentType,
        sessionId,
      });

      this.emit('agent-start', agentStartEvent);
    }

    // Ensure we're watching the sessions directory
    await this.ensureDirectoryWatcher(workspacePath);

    // Check if there are any pending files that match this agent
    // (agent file may have been created before we started watching)
    this.matchPendingFiles(agentId, sessionId);
  }

  /**
   * Format agent type into human-readable description
   * TASK_2025_100: Matches the logic in execution-tree-builder.service.ts
   */
  private formatAgentDescription(agentType: string): string {
    // Convert kebab-case or camelCase to Title Case with spaces
    return agentType
      .replace(/[-_]/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Set the toolUseId for an active watch
   *
   * Called when SubagentStop hook provides the toolUseId (late binding).
   * This enables proper UI routing for summary chunks.
   *
   * @param agentId - The unique agent identifier
   * @param toolUseId - The Task tool_use ID to associate
   */
  setToolUseId(agentId: string, toolUseId: string): void {
    const watch = this.activeWatches.get(agentId);
    if (!watch) {
      this.logger.debug(
        'AgentSessionWatcher: setToolUseId called for unknown agent',
        {
          agentId,
          toolUseId,
        }
      );
      return;
    }

    this.logger.debug('AgentSessionWatcher: Setting toolUseId for agent', {
      agentId,
      toolUseId,
      previousToolUseId: watch.toolUseId,
    });

    watch.toolUseId = toolUseId;
  }

  /**
   * Stop watching for an agent's session file
   *
   * Called when SubagentStop hook fires (agent completed).
   * Stops tailing the file and cleans up.
   *
   * @param agentId - The unique agent identifier
   */
  stopWatching(agentId: string): void {
    const watch = this.activeWatches.get(agentId);
    if (!watch) return;

    this.logger.debug('AgentSessionWatcher: Stopping watch', {
      agentId,
      toolUseId: watch.toolUseId,
      hadFile: !!watch.agentFilePath,
      summaryLength: watch.summaryContent.length,
    });

    // Clear tail interval
    if (watch.tailInterval) {
      clearInterval(watch.tailInterval);
    }

    // Remove from active watches
    this.activeWatches.delete(agentId);

    // If no more active watches, stop directory watcher
    if (this.activeWatches.size === 0) {
      this.stopDirectoryWatcher();
    }
  }

  /**
   * Ensure we have a directory watcher running
   */
  private async ensureDirectoryWatcher(workspacePath: string): Promise<void> {
    // DIAGNOSTIC: INFO level
    this.logger.info('[AgentSessionWatcher] ensureDirectoryWatcher called', {
      workspacePath,
    });

    const sessionsDir = await this.findSessionsDirectory(workspacePath);
    if (!sessionsDir) {
      // DIAGNOSTIC: WARN level - this is a problem!
      this.logger.warn('[AgentSessionWatcher] Sessions directory NOT FOUND!', {
        workspacePath,
        homeDir: require('os').homedir(),
        expectedPattern: workspacePath.replace(/[:\\/]/g, '-'),
      });
      return;
    }

    // Already watching this directory
    if (this.watchedSessionsDir === sessionsDir && this.directoryWatcher) {
      this.logger.info('[AgentSessionWatcher] Already watching directory', {
        sessionsDir,
      });
      return;
    }

    // Stop existing watcher if watching different directory
    this.stopDirectoryWatcher();

    this.logger.info('[AgentSessionWatcher] Starting directory watcher', {
      sessionsDir,
    });

    this.watchedSessionsDir = sessionsDir;

    try {
      this.directoryWatcher = fs.watch(sessionsDir, (eventType, filename) => {
        // DIAGNOSTIC: Log ALL fs.watch events
        this.logger.info('[AgentSessionWatcher] fs.watch event', {
          eventType,
          filename,
          isAgentFile: filename?.startsWith('agent-'),
        });

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

    // DIAGNOSTIC: INFO level
    this.logger.info('[AgentSessionWatcher] New agent file detected', {
      filename,
      filePath,
      activeWatchesCount: this.activeWatches.size,
    });

    // Wait a bit for the file to have content
    await this.delay(AGENT_WATCHER_CONSTANTS.FILE_DETECTION_DELAY_MS);

    // Try to read the first line to get sessionId
    const sessionId = await this.extractSessionIdFromFile(filePath);
    if (!sessionId) {
      this.logger.warn(
        '[AgentSessionWatcher] Could not extract sessionId from file',
        { filename, filePath }
      );
      return;
    }

    // DIAGNOSTIC: Log what we're trying to match
    this.logger.info('[AgentSessionWatcher] Extracted sessionId from file', {
      filename,
      fileSessionId: sessionId,
      activeWatches: Array.from(this.activeWatches.entries()).map(
        ([id, w]) => ({
          agentId: id,
          watchSessionId: w.sessionId,
          hasFilePath: !!w.agentFilePath,
        })
      ),
    });

    // Find a matching active watch
    let matched = false;
    for (const [agentId, watch] of this.activeWatches) {
      if (watch.sessionId === sessionId && !watch.agentFilePath) {
        // Check if file was created around the time of the agent start
        // (within MATCH_WINDOW_MS - generous window)
        const timeDiff = Date.now() - watch.startTime;
        if (timeDiff < AGENT_WATCHER_CONSTANTS.MATCH_WINDOW_MS) {
          this.logger.info(
            '[AgentSessionWatcher] MATCHED agent file to agent!',
            {
              agentId,
              filename,
              timeDiff,
              toolUseId: watch.toolUseId,
            }
          );
          watch.agentFilePath = filePath;
          this.startTailingFile(agentId, filePath);
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

      // Clean up old pending files after PENDING_CLEANUP_MS
      const timeoutId = setTimeout(() => {
        this.pendingAgentFiles.delete(filePath);
        this.pendingCleanupTimeouts.delete(timeoutId);
      }, AGENT_WATCHER_CONSTANTS.PENDING_CLEANUP_MS);
      this.pendingCleanupTimeouts.add(timeoutId);
    }
  }

  /**
   * Scan for existing agent files that may have been created before watching started
   */
  private async scanForExistingAgentFiles(sessionsDir: string): Promise<void> {
    try {
      const files = await fs.promises.readdir(sessionsDir);
      const agentFiles = files.filter((f) => f.startsWith('agent-'));

      // DIAGNOSTIC: Log scan results
      this.logger.info('[AgentSessionWatcher] Scanning for existing files', {
        sessionsDir,
        totalFiles: files.length,
        agentFilesCount: agentFiles.length,
      });

      // Get file stats to find recently created files
      const now = Date.now();
      let recentCount = 0;
      for (const filename of agentFiles) {
        const filePath = path.join(sessionsDir, filename);
        try {
          const stats = await fs.promises.stat(filePath);
          // Only consider files created within MATCH_WINDOW_MS
          const age = now - stats.mtimeMs;
          if (age < AGENT_WATCHER_CONSTANTS.MATCH_WINDOW_MS) {
            recentCount++;
            this.logger.info('[AgentSessionWatcher] Found recent agent file', {
              filename,
              ageMs: age,
            });
            await this.handleNewAgentFile(sessionsDir, filename);
          }
        } catch {
          // Skip files that can't be read
        }
      }

      this.logger.info('[AgentSessionWatcher] Scan complete', {
        recentFilesProcessed: recentCount,
      });
    } catch (error) {
      this.logger.warn('[AgentSessionWatcher] Failed to scan for files', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Match pending agent files to a newly started watch
   */
  private matchPendingFiles(agentId: string, sessionId: string): void {
    const watch = this.activeWatches.get(agentId);
    if (!watch) return;

    for (const [filePath, pending] of this.pendingAgentFiles) {
      if (pending.sessionId === sessionId) {
        const timeDiff = Date.now() - pending.detectedAt;
        if (timeDiff < AGENT_WATCHER_CONSTANTS.MATCH_WINDOW_MS) {
          this.logger.debug(
            'AgentSessionWatcher: Matched pending file to agent',
            { agentId, filePath }
          );
          watch.agentFilePath = filePath;
          this.pendingAgentFiles.delete(filePath);
          this.startTailingFile(agentId, filePath);
          break;
        }
      }
    }
  }

  /**
   * Start tailing an agent file for new content
   */
  private startTailingFile(agentId: string, filePath: string): void {
    const watch = this.activeWatches.get(agentId);
    if (!watch) return;

    // DIAGNOSTIC: INFO level
    this.logger.info('[AgentSessionWatcher] Starting to TAIL file', {
      agentId,
      filePath,
      toolUseId: watch.toolUseId,
    });

    // Clear existing interval if any
    if (watch.tailInterval) {
      clearInterval(watch.tailInterval);
    }

    // Read initial content
    this.readNewContent(agentId, filePath);

    // Set up interval to check for new content
    watch.tailInterval = setInterval(() => {
      this.readNewContent(agentId, filePath);
    }, AGENT_WATCHER_CONSTANTS.TAIL_INTERVAL_MS);
  }

  /**
   * Read new content from the agent file and emit summary chunks
   */
  private async readNewContent(
    agentId: string,
    filePath: string
  ): Promise<void> {
    const watch = this.activeWatches.get(agentId);
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

        // Emit the chunk - use watch.toolUseId for UI routing
        // toolUseId may be null if SubagentStop hasn't fired yet
        // CRITICAL: The chunkId MUST match what frontend uses to register agents!
        const chunkId = watch.toolUseId ?? agentId;
        const chunk: AgentSummaryChunk = {
          toolUseId: chunkId,
          summaryDelta,
        };

        this.emit('summary-chunk', chunk);

        // DIAGNOSTIC: INFO level - show the ACTUAL ID used in chunk
        // If toolUseId is null, we fallback to agentId which may NOT match frontend!
        this.logger.info(
          '[AgentSessionWatcher] >>> EMITTED summary-chunk <<<',
          {
            agentId,
            toolUseIdFromWatch: watch.toolUseId,
            chunkIdUsed: chunkId,
            isFallbackToAgentId: !watch.toolUseId,
            deltaLength: summaryDelta.length,
            totalLength: watch.summaryContent.length,
            deltaPreview: summaryDelta.slice(0, 100),
          }
        );
      }
    } catch (error) {
      // File may not exist yet or be locked, ignore
      this.logger.debug('AgentSessionWatcher: Error reading file', {
        agentId,
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
      // Read first FIRST_LINE_BUFFER_SIZE bytes to get the first line
      const fd = await fs.promises.open(filePath, 'r');
      const buffer = Buffer.alloc(
        AGENT_WATCHER_CONSTANTS.FIRST_LINE_BUFFER_SIZE
      );
      const { bytesRead } = await fd.read(
        buffer,
        0,
        AGENT_WATCHER_CONSTANTS.FIRST_LINE_BUFFER_SIZE,
        0
      );
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
    for (const [, watch] of this.activeWatches) {
      if (watch.tailInterval) {
        clearInterval(watch.tailInterval);
      }
    }
    this.activeWatches.clear();

    // Stop directory watcher
    this.stopDirectoryWatcher();

    // Clear pending files and their cleanup timeouts
    this.pendingAgentFiles.clear();
    for (const timeoutId of this.pendingCleanupTimeouts) {
      clearTimeout(timeoutId);
    }
    this.pendingCleanupTimeouts.clear();
  }
}
