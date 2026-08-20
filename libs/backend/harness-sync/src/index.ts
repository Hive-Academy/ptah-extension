/**
 * @ptah-extension/harness-sync — public API.
 *
 * One concern: reconcile the user layer (`~/.ptah/user/`) into the harness
 * directories every AI tool actually reads, as idempotent, manifest-owned
 * COPIES. Replaces `SkillJunctionService` (TASK_2026_278 Batch 1); Batch 2
 * slots the rival-CLI targets in behind `IHarnessTarget`.
 *
 * Depends on `shared` (wire types) and `vscode-core` (Logger) only. It
 * deliberately does NOT depend on `agent-sdk` — see
 * `lib/sources/harness-source.port.ts`.
 */

// Reconciler — the single entry point.
export {
  HarnessReconcilerService,
  type HarnessReconcileOptions,
  type HarnessReconcilerEvents,
} from './lib/reconciler/harness-reconciler.service';

// Triggers — Batch 3. Propagation is the ONE call an emit site makes;
// preflight is the bounded session-start check every host shares.
export {
  HarnessPropagationService,
  type HarnessPropagateOptions,
} from './lib/propagation/harness-propagation.service';
export {
  HarnessPreflightService,
  DEFAULT_PREFLIGHT_MIN_INTERVAL_MS,
  DEFAULT_PREFLIGHT_TIMEOUT_MS,
  type HarnessPreflightDeps,
  type HarnessPreflightOptions,
  type IHarnessContentGate,
} from './lib/preflight/harness-preflight.service';
export {
  NO_USER_LAYER_REFRESH,
  type IUserLayerRefresher,
} from './lib/sources/user-layer-refresher.port';

// Desired state.
export {
  HarnessManifestBuilder,
  type HarnessManifestBuildOptions,
} from './lib/manifest/harness-manifest.builder';
export type {
  HarnessDesiredAgent,
  HarnessDesiredCommand,
  HarnessDesiredMcpServer,
  HarnessDesiredSkill,
  HarnessDesiredState,
} from './lib/manifest/desired-state.types';
export { canonicalSlug, isReservedSlug } from './lib/manifest/slug-rules';

// Workspace root normalization (E14) — every target writes at the ROOT.
export {
  resolveHarnessWorkspaceRoot,
  WORKSPACE_ROOT_MARKERS,
} from './lib/workspace/workspace-root';

// Manifest store.
export {
  ManagedManifestStore,
  ManagedManifestSchema,
  MANAGED_MANIFEST_VERSION,
  HARNESS_STATE_DIR,
  emptyManifest,
  entrySourceHash,
  managedEntry,
  type ManagedEntries,
  type ManagedEntry,
  type ManagedManifest,
} from './lib/manifest-store/managed-manifest';

// Cross-process lock — the workspace policy, and the mechanism under it.
export {
  acquireWorkspaceLock,
  serializePerWorkspace,
  lockPath,
  STALE_AFTER_MS,
  type HarnessLockHandle,
} from './lib/lock/workspace-lock';
export {
  acquireFileLock,
  serializeByKey,
  withFileLock,
  DEFAULT_MAX_WAIT_MS,
  type FileLockOptions,
} from './lib/lock/file-lock';

// Targets.
export type {
  HarnessApplyResult,
  HarnessMigration,
  HarnessPlan,
  HarnessPlanRemove,
  HarnessPlanWrite,
  IHarnessTarget,
} from './lib/targets/harness-target.port';
export { ClaudeTarget, createClaudeTarget } from './lib/targets/claude-target';
export {
  WorkspaceHarnessTarget,
  type WorkspaceHarnessTargetOptions,
} from './lib/targets/workspace-target';
export {
  createAntigravityTarget,
  createCodexTarget,
  createCopilotTarget,
  createCursorTarget,
  createRivalTargets,
  createVscodeMcpTarget,
  LEGACY_HOME_PREFIXES,
  type RivalTargetDeps,
} from './lib/targets/rival-targets';

// Agent transformers (moved from `agent-generation` in Batch 2).
export type {
  HarnessAgentSource,
  IHarnessAgentTransformer,
} from './lib/targets/transformers/agent-transformer.port';
export { CodexAgentTransformer } from './lib/targets/transformers/codex-agent-transformer';
export { CopilotAgentTransformer } from './lib/targets/transformers/copilot-agent-transformer';
export { CursorAgentTransformer } from './lib/targets/transformers/cursor-agent-transformer';
export {
  extractFrontmatterDescription,
  resolveAgentDescription,
  stripFrontmatter,
  transformAgentBody,
  transformAgentContent,
} from './lib/targets/transformers/transform-rules';

// Skill markdown rewrites applied on the way into a rival CLI.
export {
  isSkillManifestFile,
  rewriteSkillName,
  sanitizeYamlDescriptions,
  stripAllowedToolsFromFrontmatter,
  transformSkillMarkdown,
} from './lib/targets/skill-transform';

// MCP facets — the per-target config-file adapters.
export {
  isMcpFragmentKey,
  mcpEntryKey,
  PTAH_SPAWN_MCP_KEY,
  type IHarnessMcpFacet,
} from './lib/targets/mcp/mcp-facet.port';
export {
  mcpConfigLockPath,
  withMcpConfigLock,
  MCP_CONFIG_LOCK_MAX_WAIT_MS,
  MCP_CONFIG_LOCK_SUFFIX,
} from './lib/targets/mcp/mcp-config-lock';
export {
  JsonMcpFacet,
  type JsonMcpFacetOptions,
} from './lib/targets/mcp/json-mcp-facet';
export {
  createAllMcpFacets,
  createMcpFacet,
  MCP_FACET_TARGETS,
  type McpFacetOptions,
} from './lib/targets/mcp/mcp-facet.registry';
export {
  CodexTomlMcpFacet,
  parseMcpServerTables,
  spliceOwnedBlock,
} from './lib/targets/mcp/codex-toml-mcp-facet';
export {
  configToJson,
  hashMcpConfig,
  jsonToConfig,
  ANTIGRAVITY_URL_KEY,
  DEFAULT_URL_KEY,
} from './lib/targets/mcp/mcp-json-format';

// Sources.
export type {
  HarnessSourceLayout,
  HarnessSourceState,
  IHarnessCliDetector,
  IHarnessSourceResolver,
} from './lib/sources/harness-source.port';
export { NO_CLI_DETECTOR } from './lib/sources/harness-source.port';
export {
  McpIntentStore,
  MCP_INTENT_VERSION,
  defaultMcpIntentPath,
  type HarnessMcpIntent,
} from './lib/sources/mcp-intent-store';
export {
  PluginConfigSourceResolver,
  createPluginConfigSourceResolver,
  createStaticSourceResolver,
  defaultHarnessSourceLayout,
  type HarnessPluginConfigReader,
} from './lib/sources/plugin-config-source-resolver';

// Health.
export {
  appliedTargetHealth,
  undetectedTargetHealth,
} from './lib/health/harness-health';

// `.gitignore` managed block + the per-workspace user-decision store (E23).
export {
  HarnessGitignoreWriter,
  DEFAULT_MANAGE_GITIGNORE,
  GITIGNORE_BEGIN,
  GITIGNORE_END,
  type GitignoreOutcome,
  type GitignoreResult,
  type HarnessGitignoreDeps,
} from './lib/gitignore/gitignore-writer';
export {
  HarnessStateStore,
  HarnessWorkspaceStateSchema,
  HARNESS_STATE_FILE,
  emptyHarnessState,
  harnessStatePath,
  type HarnessWorkspaceState,
} from './lib/gitignore/harness-state-store';

// The per-workspace consent gate for the `agents` facet, and its migration.
// Exported because the setup wizard GRANTS the consent from `rpc-handlers`.
export {
  AgentSyncGate,
  type AgentSyncDecision,
} from './lib/state/agent-sync-gate';

// Durable writes — every file this lib owns lands through these, atomically and
// with the Windows sharing-violation retry (E21).
export { atomicWriteWithRetry } from './lib/fs/atomic-write';
export {
  describeError,
  isRetryableError,
  withWindowsRetry,
  withWindowsRetrySync,
  MAX_WRITE_ATTEMPTS,
  RETRYABLE_ERROR_CODES,
} from './lib/fs/windows-retry';

// Content hashing (shared with the targets; useful to specs and to Batch 4).
export {
  hashContent,
  hashDirSync,
  hashFileSync,
  isIgnoredEntry,
  IGNORED_ENTRY_NAMES,
} from './lib/hash/content-hash';

// DI.
export { HARNESS_SYNC_TOKENS, type HarnessSyncDIToken } from './lib/di/tokens';
export {
  registerHarnessSyncServices,
  claudeTargetFactory,
  codexTargetFactory,
  copilotTargetFactory,
  cursorTargetFactory,
  antigravityTargetFactory,
  vscodeMcpTargetFactory,
  ALL_HARNESS_TARGET_FACTORIES,
  type HarnessSyncRegistrationOptions,
  type HarnessTargetFactory,
} from './lib/di/register';
