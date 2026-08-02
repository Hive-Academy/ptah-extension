/**
 * HostProfile — the one declarative artifact each host ships to describe its
 * RPC surface. Everything else (which handlers register, which methods are
 * excluded from verification, which null implementations get installed) is
 * derived from it.
 */

import type { WorktreeCreatedData } from '@ptah-extension/cli-agent-runtime';

import type { HostCapabilities } from './capabilities';
import type { HostOwnedRpcHandlerKey, RpcHandlerCtor } from './manifest';
import type { RpcRegistrationPlatform } from '../verify-and-report';

/**
 * Host wiring switches for the SDK / agent-event bridges. These mirror the
 * option bags `wireSdkCallbacks` and `wireAgentEventListeners` already accept;
 * the profile is simply where a host states its answers.
 */
export interface HostWiring {
  /** Wire git-worktree creation callbacks (desktop-class hosts only). */
  readonly worktree: boolean;
  /**
   * Resolve a freshly created worktree's checkout path. Required when
   * `worktree` is true — the resolution mechanism is genuinely host-specific.
   */
  readonly resolveWorktreePath?: (
    data: WorktreeCreatedData,
  ) => Promise<string | undefined>;
  /** Bridge Copilot permission prompts into the host UI. */
  readonly copilotPermission: boolean;
  /** Persist rival-CLI sessions to the parent session's metadata. */
  readonly persistCliSession: boolean;
  /**
   * Supply `getSdkSessionId` to both bridges by resolving `ChatRpcHandlers`
   * from the container. Hosts without a webview session map pass `false`.
   */
  readonly sdkSessionIdLookup: boolean;
  /** Subscribe the session-metadata event bridge. */
  readonly sessionMetadataEvents: boolean;
}

export interface HostProfile {
  /** Platform label used in logs and the Sentry drift payload. */
  readonly platform: RpcRegistrationPlatform;
  /** Host identity — distinguishes `cli` from `tui` on the shared platform. */
  readonly host: 'vscode' | 'electron' | 'cli' | 'tui';
  /** What this host can serve. */
  readonly capabilities: HostCapabilities;
  /**
   * Implementations for manifest entries the library does not own yet, keyed
   * by manifest key. One class may serve several keys; it is registered once.
   *
   * Every enabled host-owned entry MUST appear here and every disabled one
   * MUST NOT — `registerRpcSurface` throws otherwise.
   */
  readonly hostHandlers: Readonly<
    Partial<Record<HostOwnedRpcHandlerKey, RpcHandlerCtor>>
  >;
  readonly wiring: HostWiring;
  /**
   * Throw on registration drift when `NODE_ENV=development` / `PTAH_E2E=1`.
   * Headless hosts keep boot permissive.
   */
  readonly assertOnDrift: boolean;
}

const ALL_DISABLED: HostCapabilities = {
  memory: false,
  skillSynthesis: false,
  cron: false,
  gateway: false,
  voice: false,
  persistence: false,
  workspaceLifecycle: false,
  fileOpen: false,
  filePicker: false,
  fileSystemAccess: false,
  editorRevert: false,
  editorHost: false,
  commandExecution: false,
  layoutPersistence: false,
  pty: false,
  appUpdater: false,
};

/**
 * Spell out only the capabilities a host has. Anything omitted is `false`, so
 * introducing a capability defaults every other host to "not supported" —
 * the safe direction, and the reason adding an Electron-only subsystem needs
 * no edit to the VS Code or CLI profiles.
 */
export function capabilities(
  enabled: Partial<HostCapabilities>,
): HostCapabilities {
  return { ...ALL_DISABLED, ...enabled };
}
