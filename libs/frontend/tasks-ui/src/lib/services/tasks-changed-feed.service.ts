import { Injectable, signal, type Signal } from '@angular/core';
import type { MessageHandler } from '@ptah-extension/core';
import type { TasksChangedNotification } from '@ptah-extension/shared';
import { TASKS_CHANGED_MESSAGE_TYPE } from '../tasks-changed';

/** One validated `tasks:changed` push, numbered so equal payloads still change. */
export interface TasksChangedEvent {
  /** Increases by one per accepted push, starting at 1. */
  readonly seq: number;
  readonly change: TasksChangedNotification;
}

const CHANGE_REASONS: ReadonlySet<TasksChangedNotification['reason']> =
  new Set(['watcher', 'write', 'reindex']);

/**
 * Board-free view of the backend `tasks:changed` push.
 *
 * `TasksStore` also handles this message, but it only refreshes while the
 * board surface is open and it pulls the whole board into the importing graph.
 * Consumers outside the board (the chat inspector's TASK section) watch
 * {@link changes} instead and decide for themselves whether a push concerns
 * them. This service fetches nothing and owns no timer; it only validates and
 * republishes.
 *
 * Register it in `MESSAGE_HANDLERS` with `useExisting` so the router and the
 * consumers share the root instance.
 */
@Injectable({ providedIn: 'root' })
export class TasksChangedFeed implements MessageHandler {
  public readonly handledMessageTypes = [TASKS_CHANGED_MESSAGE_TYPE] as const;

  private readonly _changes = signal<TasksChangedEvent | null>(null);
  private seq = 0;

  /** The latest accepted push, or `null` before the first one. */
  public readonly changes: Signal<TasksChangedEvent | null> =
    this._changes.asReadonly();

  public handleMessage(message: { type: string; payload?: unknown }): void {
    if (message.type !== TASKS_CHANGED_MESSAGE_TYPE) return;
    const change = parseTasksChanged(message.payload);
    // A malformed push is dropped: consumers filter on `workspaceRoot`, and a
    // guessed root could refresh the wrong workspace.
    if (change === null) return;
    this.seq += 1;
    this._changes.set({ seq: this.seq, change });
  }
}

/**
 * Narrow an untrusted payload to a {@link TasksChangedNotification}, or `null`.
 * `workspaceRoot` must be a string, `reason` one of the shared union, and
 * `folderNames`, when present, an array of strings. The array is copied so a
 * later mutation of the raw message cannot reach the published value.
 */
function parseTasksChanged(payload: unknown): TasksChangedNotification | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const raw = payload as Record<string, unknown>;

  const { workspaceRoot, reason, folderNames } = raw;
  if (typeof workspaceRoot !== 'string') return null;
  if (
    typeof reason !== 'string' ||
    !CHANGE_REASONS.has(reason as TasksChangedNotification['reason'])
  ) {
    return null;
  }

  if (folderNames === undefined) {
    return {
      workspaceRoot,
      reason: reason as TasksChangedNotification['reason'],
    };
  }
  if (
    !Array.isArray(folderNames) ||
    !folderNames.every((name): name is string => typeof name === 'string')
  ) {
    return null;
  }
  return {
    workspaceRoot,
    reason: reason as TasksChangedNotification['reason'],
    folderNames: [...folderNames],
  };
}
