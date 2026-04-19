/**
 * CliEditorProvider — IEditorProvider implementation for CLI.
 *
 * Stub implementation — there is no text editor in CLI context.
 * All methods return empty/undefined values.
 * Events are wired up via createEvent() for interface compatibility,
 * but are never fired in CLI mode.
 */

import type { IEditorProvider } from '@ptah-extension/platform-core';
import type { IEvent } from '@ptah-extension/platform-core';
import { createEvent } from '@ptah-extension/platform-core';

export class CliEditorProvider implements IEditorProvider {
  readonly onDidChangeActiveEditor: IEvent<{
    filePath: string | undefined;
  }>;
  readonly onDidOpenDocument: IEvent<{ filePath: string }>;

  constructor() {
    const [changeEvent] = createEvent<{ filePath: string | undefined }>();
    this.onDidChangeActiveEditor = changeEvent;

    const [openEvent] = createEvent<{ filePath: string }>();
    this.onDidOpenDocument = openEvent;
  }

  getActiveEditorPath(): string | undefined {
    // No editor in CLI context
    return undefined;
  }
}
