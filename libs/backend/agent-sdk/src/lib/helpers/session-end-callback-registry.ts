/**
 * SessionEndCallbackRegistry — fan-out registry for session-end subscribers
 * (TASK_2026_THOTH_SKILL_LIFECYCLE).
 *
 * Mirrors the shape of `CompactionCallbackRegistry` but targets the session-end
 * signal: fired by `SessionControl.endSession()` after the session is fully
 * removed from the active registry.
 *
 * Primary subscriber is `SkillSynthesisService`, which analyses the finished
 * session trajectory and synthesises a reusable skill from it when the
 * session qualifies. Additional subscribers may be registered in the future
 * without touching `SessionControl`.
 *
 * Callbacks may return `Promise<void>`. `notifyAll()` fires them in a
 * fire-and-forget fashion — it does NOT await async callbacks. Each callback
 * is wrapped in an individual `.catch()` so one failing subscriber cannot
 * break the others or the SDK.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';

/** Payload delivered to every registered session-end subscriber. */
export interface SessionEndPayload {
  sessionId: string;
  workspaceRoot: string;
}

/** Callback type accepted by `SessionEndCallbackRegistry.register()`. */
export type SessionEndCallback = (
  data: SessionEndPayload,
) => void | Promise<void>;

@injectable()
export class SessionEndCallbackRegistry {
  private readonly callbacks = new Set<SessionEndCallback>();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Register a subscriber. Returns a disposer that removes the callback.
   * Idempotent — the same function reference is only inserted once.
   */
  register(callback: SessionEndCallback): () => void {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  /** Number of registered subscribers. */
  get size(): number {
    return this.callbacks.size;
  }

  /**
   * Fire all subscribers with the given event data. Async callbacks are
   * started but NOT awaited — fire-and-forget with per-callback `.catch()`
   * so a single failure does not affect the others or the SDK.
   */
  notifyAll(data: SessionEndPayload): void {
    for (const cb of this.callbacks) {
      try {
        const result = cb(data);
        if (result instanceof Promise) {
          result.catch((err: unknown) => {
            this.logger.error(
              '[SessionEndCallbackRegistry] async subscriber threw',
              err instanceof Error ? err : new Error(String(err)),
            );
          });
        }
      } catch (err: unknown) {
        this.logger.error(
          '[SessionEndCallbackRegistry] subscriber threw',
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }
  }
}
