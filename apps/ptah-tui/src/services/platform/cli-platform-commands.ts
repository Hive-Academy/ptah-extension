/**
 * CLI Platform Commands Implementation (TASK_2025_263)
 *
 * Implements IPlatformCommands for the CLI/TUI environment:
 * - reloadWindow: No-op (CLI has no window to reload)
 * - openTerminal: No-op (CLI is already in a terminal)
 */

import type { IPlatformCommands } from '@ptah-extension/rpc-handlers';

export class CliPlatformCommands implements IPlatformCommands {
  async reloadWindow(): Promise<void> {
    // No-op: CLI has no window to reload.
    // If needed, the user can restart the process manually.
  }

  openTerminal(_name: string, _command: string): void {
    // No-op: CLI is already running in a terminal.
    // Auth flows that need a terminal redirect are not applicable in CLI mode.
  }
}
