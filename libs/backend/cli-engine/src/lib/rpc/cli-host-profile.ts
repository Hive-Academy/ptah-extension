/**
 * CLI / TUI RPC host profile — the only RPC artifact in the headless hosts.
 *
 * Both headless hosts expose full Electron parity for every *backend*
 * subsystem (memory, skills, cron, gateway, voice, persistence, workspace
 * lifecycle). What they cannot serve are the webview-only UI surfaces: raw
 * filesystem RPC, a command palette, an embedded editor pane, persisted tile
 * layout, an embedded PTY, and the desktop updater. Those capabilities stay
 * off and their methods fall out as derived exclusions.
 *
 * The two hosts diverge on exactly one capability. The TUI owns a terminal and
 * can put a selection list in front of the user, so it serves `file:pick`
 * through {@link IHeadlessFilePicker}; the stdio CLI has nobody to ask.
 */

import {
  capabilities,
  type HostProfile,
  type RpcHandlerCtor,
} from '@ptah-extension/rpc-handlers';

import { CliAgentRpcHandlers } from './cli-agent-rpc.handlers.js';
import { CliFilePickerRpcHandlers } from './cli-file-picker-rpc.handlers.js';

export function createCliRpcHostProfile(
  host: 'cli' | 'tui' = 'cli',
): HostProfile {
  const interactive = host === 'tui';

  const hostHandlers: Record<string, RpcHandlerCtor> = {
    'host.agent': CliAgentRpcHandlers,
  };
  if (interactive) {
    hostHandlers['host.filePicker'] = CliFilePickerRpcHandlers;
  }

  return {
    platform: 'cli',
    host,
    capabilities: capabilities({
      memory: true,
      skillSynthesis: true,
      cron: true,
      gateway: true,
      voice: true,
      persistence: true,
      workspaceLifecycle: true,
      filePicker: interactive,
    }),
    hostHandlers,
    wiring: {
      worktree: false,
      copilotPermission: false,
      persistCliSession: false,
      sdkSessionIdLookup: false,
      sessionMetadataEvents: false,
    },
    // Headless boot stays permissive — a drift report must not stop a
    // scripted `ptah` invocation from running.
    assertOnDrift: false,
  };
}
