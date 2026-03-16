/**
 * ElectronEditorProvider — IEditorProvider implementation for Electron.
 *
 * The renderer hosts Monaco Editor (ngx-monaco-editor-v2) and a file tree.
 * This backend service tracks which file is currently active and fires events
 * when the renderer notifies of file open/change via IPC.
 *
 * The IPC bridge calls notifyFileOpened() and notifyActiveEditorChanged()
 * to update state and fire events.
 *
 * No Electron imports required — pure state tracking with createEvent().
 */

import type { IEditorProvider } from '@ptah-extension/platform-core';
import type { IEvent } from '@ptah-extension/platform-core';
import { createEvent } from '@ptah-extension/platform-core';

export class ElectronEditorProvider implements IEditorProvider {
  readonly onDidChangeActiveEditor: IEvent<{
    filePath: string | undefined;
  }>;
  readonly onDidOpenDocument: IEvent<{ filePath: string }>;

  private readonly fireActiveEditorChange: (data: {
    filePath: string | undefined;
  }) => void;
  private readonly fireDocumentOpen: (data: { filePath: string }) => void;
  private activeFilePath: string | undefined;

  constructor() {
    const [changeEvent, fireChange] = createEvent<{
      filePath: string | undefined;
    }>();
    this.onDidChangeActiveEditor = changeEvent;
    this.fireActiveEditorChange = fireChange;

    const [openEvent, fireOpen] = createEvent<{ filePath: string }>();
    this.onDidOpenDocument = openEvent;
    this.fireDocumentOpen = fireOpen;
  }

  getActiveEditorPath(): string | undefined {
    return this.activeFilePath;
  }

  /**
   * Called by IPC bridge when renderer opens a file in Monaco.
   */
  notifyFileOpened(filePath: string): void {
    this.activeFilePath = filePath;
    this.fireDocumentOpen({ filePath });
    this.fireActiveEditorChange({ filePath });
  }

  /**
   * Called by IPC bridge when renderer closes the editor or switches tabs.
   */
  notifyActiveEditorChanged(filePath: string | undefined): void {
    this.activeFilePath = filePath;
    this.fireActiveEditorChange({ filePath });
  }
}
