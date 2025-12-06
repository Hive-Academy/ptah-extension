/**
 * SDK Session Storage Service
 *
 * Stores SDK sessions in VS Code workspace state with explicit parent-child relationships.
 * Uses JSON serialization (NOT JSONL) for simpler, more reliable persistence.
 *
 * Key Features:
 * - Explicit parentId tracking (no timestamp correlation)
 * - Graceful quota handling (fallback to in-memory)
 * - Session compaction for large sessions
 * - O(n) tree reconstruction
 */

import { injectable, inject } from 'tsyringe';
import * as vscode from 'vscode';
import { SessionId, MessageId } from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { StoredSession, StoredSessionMessage } from './types/sdk-session.types';

/**
 * Maximum session size before compaction triggers (8MB)
 */
const MAX_SESSION_SIZE_MB = 8;

/**
 * Storage key prefix for SDK sessions
 */
const STORAGE_KEY_PREFIX = 'ptah.sdkSessions';

/**
 * SDK Session Storage Service
 *
 * Manages session persistence with explicit parent-child message relationships.
 * Eliminates correlation bugs from CLI-based approach.
 */
@injectable()
export class SdkSessionStorage {
  /**
   * In-memory fallback when VS Code storage quota exceeded
   * Maps SessionId → StoredSession
   */
  private inMemoryFallback = new Map<SessionId, StoredSession>();

  /**
   * Flag indicating whether we're using in-memory fallback
   */
  private useInMemoryFallback = false;

  constructor(
    @inject(TOKENS.GLOBAL_STATE) private storage: vscode.Memento,
    @inject(TOKENS.LOGGER) private logger: Logger
  ) {}

  /**
   * Save session to VS Code workspace state
   *
   * Handles quota errors gracefully by falling back to in-memory storage.
   * Triggers compaction if session exceeds size limit.
   */
  async saveSession(session: StoredSession): Promise<void> {
    try {
      // Check session size and compact if needed
      const sessionSizeBytes = this.calculateSessionSize(session);
      const sessionSizeMB = sessionSizeBytes / (1024 * 1024);

      if (sessionSizeMB > MAX_SESSION_SIZE_MB) {
        this.logger.warn(
          `[SdkSessionStorage] Session ${
            session.id
          } exceeds ${MAX_SESSION_SIZE_MB}MB (${sessionSizeMB.toFixed(
            2
          )}MB), compacting...`
        );
        await this.compactSession(session.id);
        return; // compactSession will call saveSession recursively with compacted session
      }

      const key = this.getStorageKey(session.workspaceId);

      if (this.useInMemoryFallback) {
        // Already in fallback mode - save to memory
        this.inMemoryFallback.set(session.id, session);
        this.logger.debug(
          `[SdkSessionStorage] Saved session ${session.id} to in-memory fallback`
        );
        return;
      }

      // Get all sessions for this workspace
      const sessions = (await this.storage.get<StoredSession[]>(key)) || [];

      // Find and update existing session or add new
      const index = sessions.findIndex((s) => s.id === session.id);
      if (index >= 0) {
        sessions[index] = session;
      } else {
        sessions.push(session);
      }

      // Persist to VS Code state
      await this.storage.update(key, sessions);

      this.logger.debug(
        `[SdkSessionStorage] Saved session ${session.id} (${
          sessions.length
        } total sessions, ${sessionSizeMB.toFixed(2)}MB)`
      );
    } catch (error) {
      // Handle quota exceeded error
      if (
        error instanceof Error &&
        (error.message.includes('quota') || error.message.includes('exceeded'))
      ) {
        this.logger.warn(
          '[SdkSessionStorage] VS Code storage quota exceeded, falling back to in-memory storage',
          error
        );
        this.useInMemoryFallback = true;
        this.inMemoryFallback.set(session.id, session);
      } else {
        this.logger.error(
          `[SdkSessionStorage] Failed to save session ${session.id}`,
          error instanceof Error ? error : new Error(String(error))
        );
        throw error;
      }
    }
  }

  /**
   * Get session by ID
   *
   * Checks in-memory fallback first if enabled, then VS Code state.
   */
  async getSession(sessionId: SessionId): Promise<StoredSession | null> {
    try {
      // Check in-memory fallback first
      if (this.useInMemoryFallback) {
        const session = this.inMemoryFallback.get(sessionId);
        return session || null;
      }

      // Search all workspaces for this session
      // (we don't know workspace ID when only session ID is provided)
      const allKeys = this.storage.keys();
      for (const key of allKeys) {
        if (!key.startsWith(STORAGE_KEY_PREFIX)) {
          continue;
        }

        const sessions = (await this.storage.get<StoredSession[]>(key)) || [];
        const session = sessions.find((s) => s.id === sessionId);
        if (session) {
          return session;
        }
      }

      return null;
    } catch (error) {
      this.logger.error(
        `[SdkSessionStorage] Failed to get session ${sessionId}`,
        error instanceof Error ? error : new Error(String(error))
      );
      return null;
    }
  }

  /**
   * Add message to session
   *
   * Automatically updates session totals (tokens, cost, lastActiveAt).
   * Preserves explicit parentId for tree reconstruction.
   */
  async addMessage(
    sessionId: SessionId,
    message: StoredSessionMessage
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Create updated session with new message
    const updatedSession: StoredSession = {
      ...session,
      messages: [...session.messages, message],
      lastActiveAt: Date.now(),
      totalTokens: {
        input: session.totalTokens.input + (message.tokens?.input || 0),
        output: session.totalTokens.output + (message.tokens?.output || 0),
      },
      totalCost: session.totalCost + (message.cost || 0),
    };

    await this.saveSession(updatedSession);

    this.logger.debug(
      `[SdkSessionStorage] Added message ${
        message.id
      } to session ${sessionId} (parentId: ${message.parentId || 'null'})`
    );
  }

  /**
   * Get all sessions for a workspace
   */
  async getAllSessions(workspaceId: string): Promise<StoredSession[]> {
    try {
      if (this.useInMemoryFallback) {
        // Filter in-memory sessions by workspace
        return Array.from(this.inMemoryFallback.values()).filter(
          (s) => s.workspaceId === workspaceId
        );
      }

      const key = this.getStorageKey(workspaceId);
      const sessions = (await this.storage.get<StoredSession[]>(key)) || [];
      return sessions;
    } catch (error) {
      this.logger.error(
        `[SdkSessionStorage] Failed to get sessions for workspace ${workspaceId}`,
        error instanceof Error ? error : new Error(String(error))
      );
      return [];
    }
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId: SessionId): Promise<void> {
    try {
      if (this.useInMemoryFallback) {
        this.inMemoryFallback.delete(sessionId);
        this.logger.debug(
          `[SdkSessionStorage] Deleted session ${sessionId} from in-memory fallback`
        );
        return;
      }

      // Find session across all workspaces
      const allKeys = this.storage.keys();
      for (const key of allKeys) {
        if (!key.startsWith(STORAGE_KEY_PREFIX)) {
          continue;
        }

        const sessions = (await this.storage.get<StoredSession[]>(key)) || [];
        const filtered = sessions.filter((s) => s.id !== sessionId);

        if (filtered.length !== sessions.length) {
          // Session was found and removed
          await this.storage.update(key, filtered);
          this.logger.info(`[SdkSessionStorage] Deleted session ${sessionId}`);
          return;
        }
      }

      this.logger.warn(
        `[SdkSessionStorage] Session ${sessionId} not found for deletion`
      );
    } catch (error) {
      this.logger.error(
        `[SdkSessionStorage] Failed to delete session ${sessionId}`,
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Compact session by removing older messages while preserving structure
   *
   * Keeps recent messages and ensures parent-child relationships remain intact.
   * Target size is optional (defaults to 50% of max size).
   */
  async compactSession(
    sessionId: SessionId,
    targetSizeMB: number = MAX_SESSION_SIZE_MB * 0.5
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const originalSize = this.calculateSessionSize(session);
    const originalSizeMB = originalSize / (1024 * 1024);

    this.logger.info(
      `[SdkSessionStorage] Compacting session ${sessionId} from ${originalSizeMB.toFixed(
        2
      )}MB to target ${targetSizeMB.toFixed(2)}MB`
    );

    // Strategy: Keep most recent messages until target size reached
    // Ensure we don't break parent-child chains

    const targetSizeBytes = targetSizeMB * 1024 * 1024;
    const keptMessages: StoredSessionMessage[] = [];
    const keptMessageIds = new Set<MessageId>();
    let currentSize = 0;

    // Start from end (most recent) and work backwards
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const message = session.messages[i];
      const messageSize = JSON.stringify(message).length;

      if (
        currentSize + messageSize > targetSizeBytes &&
        keptMessages.length > 0
      ) {
        // Target size reached
        break;
      }

      keptMessages.unshift(message);
      keptMessageIds.add(message.id);
      currentSize += messageSize;
    }

    // Now ensure all parent references are valid
    // If a message references a parent that was removed, set parentId to null
    const validatedMessages = keptMessages.map((msg) => {
      if (msg.parentId && !keptMessageIds.has(msg.parentId)) {
        // Parent was removed - make this a root message
        return { ...msg, parentId: null };
      }
      return msg;
    });

    // Recalculate totals
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;

    for (const msg of validatedMessages) {
      totalInputTokens += msg.tokens?.input || 0;
      totalOutputTokens += msg.tokens?.output || 0;
      totalCost += msg.cost || 0;
    }

    const compactedSession: StoredSession = {
      ...session,
      messages: validatedMessages,
      totalTokens: {
        input: totalInputTokens,
        output: totalOutputTokens,
      },
      totalCost,
    };

    await this.saveSession(compactedSession);

    const newSize = this.calculateSessionSize(compactedSession);
    const newSizeMB = newSize / (1024 * 1024);

    this.logger.info(
      `[SdkSessionStorage] Compacted session ${sessionId}: ${
        session.messages.length
      } → ${validatedMessages.length} messages, ${originalSizeMB.toFixed(
        2
      )}MB → ${newSizeMB.toFixed(2)}MB`
    );
  }

  /**
   * Calculate session size in bytes
   */
  private calculateSessionSize(session: StoredSession): number {
    return JSON.stringify(session).length;
  }

  /**
   * Get storage key for workspace
   */
  private getStorageKey(workspaceId: string): string {
    return `${STORAGE_KEY_PREFIX}.${workspaceId}`;
  }
}
