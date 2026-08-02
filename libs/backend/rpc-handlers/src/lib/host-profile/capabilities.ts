/**
 * RPC host capabilities.
 *
 * A capability is the single unit of per-host RPC variation. Every handler
 * family in {@link RPC_HANDLER_MANIFEST} declares the capabilities it needs;
 * every host ships one {@link HostProfile} declaring which capabilities it
 * has. Registration and exclusion are then derived — never hand-maintained.
 *
 * Adding a subsystem means adding ONE capability here, ONE manifest entry,
 * and flipping the flag on the hosts that support it. Hosts that do not
 * support it need no edit: `false` is the default for every profile that
 * omits the key.
 */

/**
 * The closed set of capabilities. Ordered by subsystem, then by host surface.
 */
export const RPC_CAPABILITIES = [
  // --- backend subsystems (SQLite / native / worker backed) ---------------
  /** Letta-style memory: recall, listing, corpora, embedder, symbol indexing. */
  'memory',
  /** Trajectory extraction + skill synthesis. */
  'skillSynthesis',
  /** SQLite-backed cron scheduler. */
  'cron',
  /** Telegram / Discord / Slack messaging gateway. */
  'gateway',
  /** Local + cloud speech providers. */
  'voice',
  /** Direct `~/.ptah/ptah.db` maintenance (health, reset, vec reload). */
  'persistence',
  /** Host can add/remove/switch workspace folders (IWorkspaceLifecycleProvider). */
  'workspaceLifecycle',

  // --- host UI surfaces ----------------------------------------------------
  /** Host can reveal a path in its own editor/explorer (`file:open`). */
  'fileOpen',
  /** Host has native file/image picker dialogs. */
  'filePicker',
  /** Host exposes raw filesystem read/exists/save-dialog RPC. */
  'fileSystemAccess',
  /** Host can revert files to their on-disk/HEAD state. */
  'editorRevert',
  /** Host embeds a full editor pane (file tree, search, settings). */
  'editorHost',
  /** Host has a command palette / command executor. */
  'commandExecution',
  /** Host persists a webview tile layout. */
  'layoutPersistence',
  /** Host can spawn pseudo-terminals. */
  'pty',
  /** Host ships a self-updating application shell. */
  'appUpdater',
] as const;

export type Capability = (typeof RPC_CAPABILITIES)[number];

/**
 * A host's capability answer set — total, so every capability has an answer.
 * Profiles build it with the `capabilities()` helper, which fills omissions
 * with `false`.
 */
export type HostCapabilities = Readonly<Record<Capability, boolean>>;

/** True when the profile satisfies every capability the entry requires. */
export function satisfies(
  capabilities: HostCapabilities,
  requires: readonly Capability[],
): boolean {
  return requires.every((capability) => capabilities[capability]);
}
