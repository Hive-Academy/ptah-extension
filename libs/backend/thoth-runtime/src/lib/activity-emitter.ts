/**
 * Back-office activity emitter (TASK_2026_380, component 14b).
 *
 * ## What this is and is not
 *
 * Ptah does a lot of work the user never sees. A cron run fires, the harness
 * reconciles, a session import finishes — and each of those either logs to a
 * file nobody opens or pushes a bespoke message one panel consumes. This
 * emitter is the single narrow way a SILENT subsystem says "I did a thing".
 *
 * It is deliberately not a logging abstraction and deliberately not aware of
 * any surface. `thoth-runtime` must not learn what a ticker is: the payload it
 * produces is the same kind of pre-formatted sentence the memory bridges in
 * `boot-thoth-runtime.ts` already produce, and a subsystem could equally write
 * that sentence to a log.
 *
 * ## The rules that keep it safe on the boot path
 *
 * - **`TOKENS.WEBVIEW_MANAGER` is resolved lazily, per emit, behind
 *   `isRegistered`.** The CLI registers a duck-typed manager and a test host
 *   may register none; capturing the answer once would freeze whichever was
 *   true at construction.
 * - **Every failure is swallowed.** A broadcast failure must NEVER break the
 *   pipeline it was narrating — same rule as `skill-synthesis.service.ts`'s
 *   best-effort push.
 * - **No subsystem that ALREADY broadcasts may emit here too.** Memory,
 *   indexing, skill synthesis, vec, embedder and boot readiness all have their
 *   own message types; a second event for the same work would render twice.
 */

import type { DependencyContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type {
  ActivityEventPayload,
  ActivityLevel,
  ActivitySource,
} from '@ptah-extension/shared';
import type { JobHandler } from '@ptah-extension/cron-scheduler';

import { DEFAULT_THOTH_LOG_PREFIX } from './types';

/** The one method this file needs from `WebviewManager`. */
interface BroadcastSurface {
  broadcastMessage: (type: string, payload: unknown) => Promise<void>;
}

/** What {@link createActivityEmitter} returns. Never throws, never awaits. */
export type ActivityEmitter = (
  source: ActivitySource,
  kind: string,
  summary: string,
  level?: ActivityLevel,
) => void;

/**
 * Build an activity emitter bound to a container.
 *
 * Stateless: the returned function holds nothing but the container and the log
 * prefix, so it is safe to build one per call site rather than share one.
 */
export function createActivityEmitter(
  container: DependencyContainer,
  logPrefix: string = DEFAULT_THOTH_LOG_PREFIX,
): ActivityEmitter {
  return (source, kind, summary, level): void => {
    try {
      if (!container.isRegistered(TOKENS.WEBVIEW_MANAGER)) return;
      const webviewManager = container.resolve<BroadcastSurface>(
        TOKENS.WEBVIEW_MANAGER,
      );
      const payload: ActivityEventPayload = {
        source,
        kind,
        summary,
        timestamp: Date.now(),
        ...(level === undefined ? {} : { level }),
      };
      void webviewManager
        .broadcastMessage(MESSAGE_TYPES.ACTIVITY_EVENT, payload)
        .catch((error: unknown) => {
          console.warn(
            `${logPrefix} Activity broadcast rejected (non-fatal):`,
            error instanceof Error ? error.message : String(error),
          );
        });
    } catch (error: unknown) {
      console.warn(
        `${logPrefix} Activity emit failed (non-fatal):`,
        error instanceof Error ? error.message : String(error),
      );
    }
  };
}

/**
 * Wrap a cron {@link JobHandler} so a completed run emits exactly one activity
 * event, and the handler's ORIGINAL return value reaches the runner unchanged.
 *
 * The summary is derived from what the handler already returns, so no handler
 * has to learn about this channel:
 *
 * - `{ outcome: 'skipped', reason }` → `'<name> skipped (<reason>)'` at
 *   `'warn'`. A gated tick ran to completion and did nothing, which is exactly
 *   the "degraded but completed" case `'warn'` exists to tint.
 * - `{ summary }` → the handler's own sentence, at `'info'`.
 *
 * **A THROWN handler emits nothing and rethrows.** The ticker has no `'error'`
 * level on purpose (see `rpc-activity.types.ts`): a failed cron run needs a
 * channel the user cannot miss, and the run row the scheduler writes is that
 * channel. Swallowing the throw here would also turn a failed run into a
 * successful one.
 */
export function withActivityEmit(
  emit: ActivityEmitter,
  handlerName: string,
  handler: JobHandler,
): JobHandler {
  return async (ctx) => {
    const result = await handler(ctx);
    if (result.outcome === 'skipped') {
      emit(
        'cron',
        handlerName,
        `${handlerName} skipped (${result.reason ?? 'unknown'})`,
        'warn',
      );
    } else {
      emit('cron', handlerName, result.summary ?? `${handlerName} completed`);
    }
    return result;
  };
}
