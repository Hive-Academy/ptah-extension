import { Injectable } from '@angular/core';
import type { MessageHandler } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { FileContentChangedPayload } from '@ptah-extension/shared';

/** Receives one `file:content-changed` batch. */
export type FileContentChangeListener = (
  change: FileContentChangedPayload,
) => void;

/**
 * Narrow an inbound `file:content-changed` payload. Anything that is not the
 * batch shape yields `null`; non-string entries are dropped rather than
 * failing the whole batch (the payload changed shape in TASK_2026_437).
 */
function toFileContentChange(
  payload: unknown,
): FileContentChangedPayload | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { filePaths, truncated } = payload as Partial<
    Record<keyof FileContentChangedPayload, unknown>
  >;
  if (!Array.isArray(filePaths)) return null;
  return {
    filePaths: filePaths.filter(
      (entry): entry is string => typeof entry === 'string' && entry !== '',
    ),
    truncated: truncated === true,
  };
}

/**
 * FileContentChangesService — hands `file:content-changed` pushes to the
 * components that are alive to care about them (the review shell forwards
 * them to the spot editor, `SpotEditorComponent.notifyDiskChange`).
 *
 * A component cannot be a `MESSAGE_HANDLERS` entry, so this root service is
 * the entry and keeps a listener set. Every batch reaches every listener, in
 * arrival order — a signal would coalesce two pushes drained in one tick. An
 * empty, untruncated batch carries nothing and is not delivered.
 */
@Injectable({ providedIn: 'root' })
export class FileContentChangesService implements MessageHandler {
  private readonly listeners = new Set<FileContentChangeListener>();

  /** Dispatched by `MessageRouterService` through `MESSAGE_HANDLERS`. */
  readonly handledMessageTypes = [MESSAGE_TYPES.FILE_CONTENT_CHANGED] as const;

  handleMessage(message: { type: string; payload?: unknown }): void {
    if (message.type !== MESSAGE_TYPES.FILE_CONTENT_CHANGED) return;
    const change = toFileContentChange(message.payload);
    if (!change || (!change.truncated && change.filePaths.length === 0)) {
      return;
    }
    // A copy, so a listener that releases itself does not skip a sibling.
    for (const listener of [...this.listeners]) listener(change);
  }

  /** Receive every later batch until the returned release is called. */
  listen(listener: FileContentChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
