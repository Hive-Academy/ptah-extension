/**
 * CompactionCallbackRegistry — fan-out registry for additional PreCompact
 * subscribers (architecture §2.6).
 *
 * The interactive chat path captures a single `onCompactionStart` closure
 * via `CompactionHookHandler.createHooks()` to push the
 * `session:compacting` notification at the webview. The registry introduces
 * a second subscriber — the memory curator — that needs the same firing
 * signal but lives in a different DI scope and cannot be captured by the
 * chat-path closure.
 *
 * The registry is intentionally tiny: a `Set<CompactionStartCallback>`
 * with `register()` returning a disposer, plus a `notifyAll()` invoked by
 * the hook handler in addition to the captured closure. Throws are caught
 * per-callback so one bad subscriber cannot break the SDK or another
 * subscriber.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type { CompactionStartCallback } from './compaction-hook-handler';

@injectable()
export class CompactionCallbackRegistry {
  private readonly callbacks = new Set<CompactionStartCallback>();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Register a subscriber. Returns a disposer that removes the callback.
   * Idempotent — the same function reference is only inserted once.
   */
  register(callback: CompactionStartCallback): () => void {
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
   * Fire all subscribers with the given event data. Each callback is
   * invoked in a try/catch so a single failure does not affect the others
   * or the SDK.
   */
  notifyAll(data: Parameters<CompactionStartCallback>[0]): void {
    for (const cb of this.callbacks) {
      try {
        cb(data);
      } catch (err) {
        this.logger.error(
          '[CompactionCallbackRegistry] subscriber threw',
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }
  }
}
