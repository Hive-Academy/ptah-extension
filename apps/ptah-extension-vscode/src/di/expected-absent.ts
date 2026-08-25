/**
 * The negative half of {@link ./expected-resolvable}.
 *
 * `EXPECTED_RESOLVABLE` pins what this host must be able to construct. This
 * file pins what it must NOT: handler classes whose subsystems are absent in
 * the VS Code extension host (no better-sqlite3, no embedder worker, no
 * workspace-lifecycle provider) and the desktop-only UI surfaces the IDE
 * already owns.
 *
 * The failure this guards against is the one that kept recurring: a subsystem
 * added for Electron gets switched on everywhere, and VS Code crashes at
 * activation resolving a class its DI phases never registered. Flipping a
 * capability on in `rpc-host-profile.ts` without adding the backing services
 * now fails here instead of at a user's activation.
 */

import {
  CorpusRpcHandlers,
  CronRpcHandlers,
  EmbedderRpcHandlers,
  GatewayRpcHandlers,
  IndexingRpcHandlers,
  MemoryRpcHandlers,
  MemRpcHandlers,
  PersistenceRpcHandlers,
  SkillsSynthesisRpcHandlers,
  VoiceRpcHandlers,
  WorkspaceRpcHandlers,
} from '@ptah-extension/rpc-handlers';

/** Handler classes the VS Code host must never construct. */
export const EXPECTED_ABSENT_HANDLERS = [
  MemoryRpcHandlers,
  MemRpcHandlers,
  CorpusRpcHandlers,
  EmbedderRpcHandlers,
  IndexingRpcHandlers,
  SkillsSynthesisRpcHandlers,
  CronRpcHandlers,
  GatewayRpcHandlers,
  VoiceRpcHandlers,
  PersistenceRpcHandlers,
  WorkspaceRpcHandlers,
] as const;

/**
 * Capabilities that must stay off. Each maps to services this host does not
 * register; turning one on without wiring them is an activation crash.
 */
export const EXPECTED_ABSENT_CAPABILITIES = [
  'memory',
  'skillSynthesis',
  'cron',
  'gateway',
  'voice',
  'persistence',
  'workspaceLifecycle',
  'fileSystemAccess',
  'editorHost',
  'layoutPersistence',
  'pty',
  'appUpdater',
] as const;
