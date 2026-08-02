/**
 * CLI / TUI RPC host profile — the only RPC artifact in the headless hosts.
 *
 * The headless hosts expose full Electron parity for every *backend*
 * subsystem (memory, skills, cron, gateway, voice, persistence, workspace
 * lifecycle). What they cannot serve are the webview-only UI surfaces: file
 * pickers, a command palette, an embedded editor pane, persisted tile layout,
 * an embedded PTY, and the desktop updater. Those capabilities stay off and
 * their methods fall out as derived exclusions.
 */

import { capabilities, type HostProfile } from '@ptah-extension/rpc-handlers';

import { CliAgentRpcHandlers } from './cli-agent-rpc.handlers.js';

export function createCliRpcHostProfile(
  host: 'cli' | 'tui' = 'cli',
): HostProfile {
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
    }),
    hostHandlers: {
      'host.agent': CliAgentRpcHandlers,
    },
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
