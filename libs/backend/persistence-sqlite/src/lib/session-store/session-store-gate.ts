import type { ISessionStoreGate } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';

/**
 * Opens once the host's legacy copy-forward has finished. A safety timer opens
 * it anyway, so a migration that never ran or hangs cannot block every
 * session read for the rest of the run.
 */
export class SessionStoreGate implements ISessionStoreGate {
  private readonly ready: Promise<void>;
  private open!: () => void;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly logger: Logger,
    timeoutMs = 30_000,
  ) {
    this.ready = new Promise<void>((resolve) => {
      this.open = resolve;
    });
    this.timer = setTimeout(() => {
      this.logger.warn(
        '[persistence-sqlite] session store gate opened by timeout; the legacy copy-forward did not report back',
        { timeoutMs },
      );
      this.markReady();
    }, timeoutMs);
    this.timer.unref?.();
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  markReady(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.open();
  }
}
