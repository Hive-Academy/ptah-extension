/**
 * TUI implementation of the IFileDialog port.
 *
 * The backend cannot open a dialog, and the Ink tree cannot be called from the
 * backend — so this sits between them. `openFiles` (called on the RPC thread
 * by `FilePickerRpcHandlers`) parks a pending request; the React tree
 * subscribes, renders the existing `FilePickerOverlay`, and settles it.
 *
 * Cancellation is an empty selection, never a rejection — that is the port's
 * contract and it matches what the desktop hosts return for a dismissed
 * dialog. If nothing is subscribed (a frame where the chat panel is not
 * mounted), the request settles empty immediately rather than hanging the
 * caller forever.
 */

import type { IFileDialog } from '@ptah-extension/platform-core';

export interface PendingFilePick {
  readonly multiple: boolean;
  /** Settle the request. Safe to call more than once; later calls no-op. */
  readonly resolve: (paths: readonly string[]) => void;
}

type Subscriber = (request: PendingFilePick) => void;

export class TuiFilePickerBridge implements IFileDialog {
  private subscriber: Subscriber | null = null;

  /**
   * Register the React-side handler. Returns an unsubscribe function; the last
   * subscriber wins, matching Ink's single-tree model.
   */
  subscribe(subscriber: Subscriber): () => void {
    this.subscriber = subscriber;
    return () => {
      if (this.subscriber === subscriber) {
        this.subscriber = null;
      }
    };
  }

  async openFiles(options: {
    multiple: boolean;
    title: string;
    filters?: Record<string, string[]>;
  }): Promise<readonly string[]> {
    const subscriber = this.subscriber;
    if (!subscriber) return [];

    return new Promise<readonly string[]>((resolve) => {
      let settled = false;
      subscriber({
        multiple: options.multiple,
        resolve: (paths) => {
          if (settled) return;
          settled = true;
          resolve(paths);
        },
      });
    });
  }
}
