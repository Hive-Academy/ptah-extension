/**
 * CLI Platform Commands Implementation
 *
 * Implements IPlatformCommands for the CLI/TUI environment:
 * - reloadWindow: No-op (CLI has no window to reload)
 * - openTerminal: No-op (CLI is already in a terminal)
 */

import type { IPlatformCommands } from '@ptah-extension/rpc-handlers';

export class CliPlatformCommands implements IPlatformCommands {
  async reloadWindow(): Promise<void> {
    console.log('CliPlatformCommands.reloadWindow called');
  }

  openTerminal(_name: string, _command: string): void {
    console.log('CliPlatformCommands.openTerminal called');
  }

  async focusChat(): Promise<void> {
    console.log('CliPlatformCommands.focusChat called');
  }
}
