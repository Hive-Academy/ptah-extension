/**
 * Session Metadata Store
 *
 * Lightweight storage for session UI metadata ONLY.
 * Session messages and conversation history are managed by the Claude Agent SDK
 * natively in ~/.claude/projects/{sessionId}.jsonl
 *
 * This store ONLY tracks:
 * - Session names (user-friendly labels)
 * - Timestamps (for sorting)
 * - Workspace association
 * - Accumulated cost/tokens (from result messages)
 *
 * It does NOT store:
 * - Messages (SDK handles this)
 * - Conversation history (SDK handles this)
 * - Message content (SDK handles this)
 *
 * @see TASK_2025_088 for migration details
 */

import { injectable, inject } from 'tsyringe';
import * as vscode from 'vscode';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { CliSessionReference } from '@ptah-extension/shared';

/**
 * Session metadata - UI state only, NOT message storage
 */
export interface SessionMetadata {
  /**
   * Real SDK session UUID (from system 'init' message)
   * This is the filename in ~/.claude/projects/
   */
  readonly sessionId: string;

  /**
   * User-friendly session name
   */
  readonly name: string;

  /**
   * Workspace path for this session
   */
  readonly workspaceId: string;

  /**
   * Session creation timestamp
   */
  readonly createdAt: number;

  /**
   * Last activity timestamp (for sorting)
   */
  readonly lastActiveAt: number;

  /**
   * Accumulated cost from result messages (USD)
   */
  readonly totalCost: number;

  /**
   * Accumulated tokens from result messages
   */
  readonly totalTokens: {
    readonly input: number;
    readonly output: number;
  };

  /** CLI agent sessions linked to this parent session. Enables resume. */
  readonly cliSessions?: readonly CliSessionReference[];

  /** When true, this session is a child/subagent session (e.g., Ptah CLI agent spawned
   *  by a parent orchestrator). Child sessions are hidden from the sidebar session list. */
  readonly isChildSession?: boolean;
}

/**
 * Storage key for session metadata
 */
const STORAGE_KEY = 'ptah.sessionMetadata';

/**
 * Session Metadata Store
 *
 * Minimal storage for session UI metadata.
 * Relies on SDK's native ~/.claude/projects/ for message persistence.
 */
@injectable()
export class SessionMetadataStore {
  /**
   * NOTE: @inject() decorators below are NOT used at runtime.
   * This class is registered via registerInstance() in di/register.ts,
   * which manually constructs the instance with context.workspaceState
   * and a Logger instance. The decorators are retained for documentation
   * purposes only (they show the logical dependencies).
   */
  constructor(
    @inject(TOKENS.GLOBAL_STATE) private storage: vscode.Memento,
    @inject(TOKENS.LOGGER) private logger: Logger
  ) {}

  /**
   * Save or update session metadata
   */
  async save(metadata: SessionMetadata): Promise<void> {
    const all = await this.getAll();
    const index = all.findIndex((m) => m.sessionId === metadata.sessionId);

    if (index >= 0) {
      all[index] = metadata;
    } else {
      all.push(metadata);
    }

    await this.storage.update(STORAGE_KEY, all);
    this.logger.debug(
      `[SessionMetadataStore] Saved metadata for session ${metadata.sessionId}`
    );
  }

  /**
   * Get metadata by session ID
   */
  async get(sessionId: string): Promise<SessionMetadata | null> {
    const all = await this.getAll();
    return all.find((m) => m.sessionId === sessionId) || null;
  }

  /**
   * Get all session metadata for a workspace.
   * Excludes child sessions (Ptah CLI agents) by default — these only
   * appear within their parent session's context, not in the sidebar.
   */
  async getForWorkspace(
    workspaceId: string,
    includeChildren = false
  ): Promise<SessionMetadata[]> {
    const all = await this.getAll();
    return all
      .filter(
        (m) =>
          m.workspaceId === workspaceId &&
          (includeChildren || !m.isChildSession)
      )
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  /**
   * Get all session metadata
   */
  async getAll(): Promise<SessionMetadata[]> {
    return (await this.storage.get<SessionMetadata[]>(STORAGE_KEY)) || [];
  }

  /**
   * Update session activity timestamp
   */
  async touch(sessionId: string): Promise<void> {
    const metadata = await this.get(sessionId);
    if (metadata) {
      await this.save({
        ...metadata,
        lastActiveAt: Date.now(),
      });
    }
  }

  /**
   * Update session stats (cost, tokens) from result message
   */
  async addStats(
    sessionId: string,
    stats: { cost: number; tokens: { input: number; output: number } }
  ): Promise<void> {
    const metadata = await this.get(sessionId);
    if (metadata) {
      await this.save({
        ...metadata,
        lastActiveAt: Date.now(),
        totalCost: metadata.totalCost + stats.cost,
        totalTokens: {
          input: metadata.totalTokens.input + stats.tokens.input,
          output: metadata.totalTokens.output + stats.tokens.output,
        },
      });
    }
  }

  /**
   * Add a CLI session reference to a parent session's metadata.
   * Called when a CLI agent exits with a captured cliSessionId.
   */
  async addCliSession(
    sessionId: string,
    cliSession: CliSessionReference
  ): Promise<void> {
    const metadata = await this.get(sessionId);
    if (!metadata) {
      throw new Error(`Parent session not found: ${sessionId}`);
    }

    const existing = metadata.cliSessions ?? [];
    // Upsert by cliSessionId: if a reference with the same cliSessionId already
    // exists, replace it with the new one (preserves updated status, stdout, and
    // segments from resumed sessions). Otherwise append.
    const existingIndex = existing.findIndex(
      (s) => s.cliSessionId === cliSession.cliSessionId
    );

    let updated: readonly CliSessionReference[];
    if (existingIndex >= 0) {
      // Replace existing reference with updated data (resume scenario)
      const mutable = [...existing];
      mutable[existingIndex] = cliSession;
      updated = mutable;
      this.logger.info(
        `[SessionMetadataStore] Updated CLI session ${cliSession.cliSessionId} (${cliSession.cli}) in session ${sessionId}`
      );
    } else {
      updated = [...existing, cliSession];
      this.logger.info(
        `[SessionMetadataStore] Linked CLI session ${cliSession.cliSessionId} (${cliSession.cli}) to session ${sessionId}`
      );
    }

    await this.save({
      ...metadata,
      lastActiveAt: Date.now(),
      cliSessions: updated,
    });
  }

  /**
   * Delete session metadata
   */
  async delete(sessionId: string): Promise<void> {
    const all = await this.getAll();
    const filtered = all.filter((m) => m.sessionId !== sessionId);

    if (filtered.length !== all.length) {
      await this.storage.update(STORAGE_KEY, filtered);
      this.logger.info(
        `[SessionMetadataStore] Deleted metadata for session ${sessionId}`
      );
    }
  }

  /**
   * Create initial metadata for a new session
   * Called when SDK returns the real session ID from system 'init' message
   */
  async create(
    sessionId: string,
    workspaceId: string,
    name: string
  ): Promise<SessionMetadata> {
    const now = Date.now();
    const metadata: SessionMetadata = {
      sessionId,
      name,
      workspaceId,
      createdAt: now,
      lastActiveAt: now,
      totalCost: 0,
      totalTokens: { input: 0, output: 0 },
    };

    await this.save(metadata);
    this.logger.info(
      `[SessionMetadataStore] Created metadata for session ${sessionId}: "${name}"`
    );

    return metadata;
  }

  /**
   * Create metadata for a child session (hidden from sidebar).
   * Called when a Ptah CLI agent's real SDK session ID is resolved.
   * Creating this entry early prevents SessionImporterService from
   * re-importing the session as a top-level sidebar item.
   */
  async createChild(
    sessionId: string,
    workspaceId: string,
    name: string
  ): Promise<SessionMetadata> {
    const now = Date.now();
    const metadata: SessionMetadata = {
      sessionId,
      name,
      workspaceId,
      createdAt: now,
      lastActiveAt: now,
      totalCost: 0,
      totalTokens: { input: 0, output: 0 },
      isChildSession: true,
    };

    await this.save(metadata);
    this.logger.info(
      `[SessionMetadataStore] Created child session metadata: ${sessionId} "${name}"`
    );

    return metadata;
  }

  /**
   * Rename session
   */
  async rename(sessionId: string, newName: string): Promise<void> {
    const metadata = await this.get(sessionId);
    if (metadata) {
      await this.save({
        ...metadata,
        name: newName,
      });
      this.logger.info(
        `[SessionMetadataStore] Renamed session ${sessionId} to "${newName}"`
      );
    }
  }
}
