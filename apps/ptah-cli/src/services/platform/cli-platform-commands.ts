/**
 * CLI Platform Commands Implementation
 *
 * Implements IPlatformCommands for the CLI/TUI environment. The CLI has no
 * window, terminal pane, or chat UI, so every command is a no-op. Breadcrumbs
 * are written to stderr under --verbose ONLY — never stdout, which carries the
 * JSON-RPC NDJSON machine stream.
 */

import type { IPlatformCommands } from '@ptah-extension/rpc-handlers';

export interface CliPlatformCommandsOptions {
  verbose?: boolean;
}

export class CliPlatformCommands implements IPlatformCommands {
  private readonly verbose: boolean;

  constructor(options: CliPlatformCommandsOptions = {}) {
    this.verbose = options.verbose === true;
  }

  async reloadWindow(): Promise<void> {
    this.breadcrumb('reloadWindow');
  }

  openTerminal(_name: string, _command: string): void {
    this.breadcrumb('openTerminal');
  }

  async focusChat(): Promise<void> {
    this.breadcrumb('focusChat');
  }

  private breadcrumb(method: string): void {
    if (this.verbose) {
      process.stderr.write(`[ptah] CliPlatformCommands.${method} (no-op)\n`);
    }
  }
}
