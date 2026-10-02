import { Injectable } from '@angular/core';
import type { MessageHandler } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { GitOperationOutputPayload } from '@ptah-extension/shared';

/** Receives one `git:operationOutput` chunk of the operation it listens to. */
export type GitOperationOutputListener = (
  output: GitOperationOutputPayload,
) => void;

/** Narrow an inbound `git:operationOutput` payload; anything else is `null`. */
function toOperationOutput(payload: unknown): GitOperationOutputPayload | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { operationId, stream, chunk } = payload as Partial<
    Record<keyof GitOperationOutputPayload, unknown>
  >;
  if (typeof operationId !== 'string' || operationId === '') return null;
  if (stream !== 'stdout' && stream !== 'stderr') return null;
  if (typeof chunk !== 'string') return null;
  return { operationId, stream, chunk };
}

/**
 * GitOperationOutputService — hands `git:operationOutput` pushes to the one
 * listener that started the operation (the commit composer, by the
 * `operationId` it sent with `git:commit`).
 *
 * A component cannot be a `MESSAGE_HANDLERS` entry, so this root service is
 * the entry (same shape as `FileContentChangesService`). Chunks are delivered
 * synchronously in arrival order — a signal would coalesce two pushes drained
 * in one tick. A chunk for an id nobody listens to is dropped.
 */
@Injectable({ providedIn: 'root' })
export class GitOperationOutputService implements MessageHandler {
  private readonly listeners = new Map<string, GitOperationOutputListener>();

  /** Dispatched by `MessageRouterService` through `MESSAGE_HANDLERS`. */
  readonly handledMessageTypes = [MESSAGE_TYPES.GIT_OPERATION_OUTPUT] as const;

  handleMessage(message: { type: string; payload?: unknown }): void {
    if (message.type !== MESSAGE_TYPES.GIT_OPERATION_OUTPUT) return;
    const output = toOperationOutput(message.payload);
    if (!output) return;
    this.listeners.get(output.operationId)?.(output);
  }

  /**
   * Receive every later chunk of `operationId` until the returned release is
   * called. A second listener for the same id replaces the first; the first
   * one's release then leaves the replacement in place.
   */
  listen(
    operationId: string,
    listener: GitOperationOutputListener,
  ): () => void {
    this.listeners.set(operationId, listener);
    return () => {
      if (this.listeners.get(operationId) === listener) {
        this.listeners.delete(operationId);
      }
    };
  }
}
