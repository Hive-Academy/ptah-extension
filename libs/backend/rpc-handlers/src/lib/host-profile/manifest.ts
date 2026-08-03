/**
 * RPC handler manifest — the single source of truth for "who owns which RPC
 * methods, and what does the host need in order to serve them".
 *
 * Two kinds of entry:
 *
 *  - **Lib-owned** (`handler` set): the class lives in this library and is
 *    resolved straight out of the container.
 *  - **Host-owned** (`handler` omitted): the implementation still lives in a
 *    host (VS Code / Electron / cli-engine) and is supplied through
 *    {@link HostProfile.hostHandlers}. These entries shrink to zero as the
 *    handler families are unified into this library.
 *
 * Two invariants make derived exclusions provably exact (asserted in
 * `manifest.spec.ts` and at dev-time boot):
 *
 *  1. **Disjoint** — no method is claimed by two entries.
 *  2. **Total** — the union of all entries is exactly `RPC_METHOD_NAMES`.
 *
 * Given those, a host's excluded set is simply the methods of the entries its
 * profile switched off. There is nothing left to hand-maintain.
 */

import type { RpcMethodName } from '@ptah-extension/shared';

import type { Capability } from './capabilities';
import {
  AgentRpcHandlers,
  AuthRpcHandlers,
  AutocompleteRpcHandlers,
  ChatRpcHandlers,
  CommandRpcHandlers,
  ConfigRpcHandlers,
  ContextRpcHandlers,
  CorpusRpcHandlers,
  CronRpcHandlers,
  EmbedderRpcHandlers,
  EnhancedPromptsRpcHandlers,
  FilePickerRpcHandlers,
  FileSystemRpcHandlers,
  GatewayRpcHandlers,
  GitRpcHandlers,
  HarnessRpcHandlers,
  ImagePickerRpcHandlers,
  IndexingRpcHandlers,
  LayoutRpcHandlers,
  LicenseRpcHandlers,
  LlmRpcHandlers,
  McpDirectoryRpcHandlers,
  MemoryRpcHandlers,
  MemRpcHandlers,
  PersistenceRpcHandlers,
  PluginRpcHandlers,
  ProviderRpcHandlers,
  PtahCliRpcHandlers,
  QualityRpcHandlers,
  SessionRpcHandlers,
  SettingsRpcHandlers,
  SetupRpcHandlers,
  SkillsShRpcHandlers,
  SkillsSynthesisRpcHandlers,
  SubagentRpcHandlers,
  TasksRpcHandlers,
  TerminalRpcHandlers,
  UpdateRpcHandlers,
  VoiceRpcHandlers,
  WebSearchRpcHandlers,
  WizardGenerationRpcHandlers,
  WorkspaceRpcHandlers,
} from '../handlers';

/**
 * Structural shape every RPC handler class satisfies. tsyringe's
 * class-as-token `resolve` only accepts an `any[]`-parameter construct
 * signature; a narrower one fails to match the real handlers.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RpcHandlerCtor = new (...args: any[]) => { register(): void };

export interface RpcHandlerManifestEntry {
  /** Stable identifier. Host profiles key `hostHandlers` by this. */
  readonly key: string;
  /** Every RPC method this family owns. */
  readonly methods: readonly RpcMethodName[];
  /** Capabilities the host must have. `[]` means every host serves it. */
  readonly requires: readonly Capability[];
  /**
   * The library-owned implementation. Omitted while the family still lives in
   * a host — the profile supplies the class instead.
   */
  readonly handler?: RpcHandlerCtor;
}

/**
 * Host-owned method tuples. These become `static readonly METHODS` on the
 * unified handler classes as each family moves into this library.
 */
const EDITOR_PANE_METHODS = [
  'editor:openFile',
  'editor:saveFile',
  'editor:getFileTree',
  'editor:getDirectoryChildren',
  'editor:createFile',
  'editor:createFolder',
  'editor:renameItem',
  'editor:deleteItem',
  'editor:getSetting',
  'editor:updateSetting',
  'editor:searchInFiles',
  'editor:listAllFiles',
] as const satisfies readonly RpcMethodName[];

export const RPC_HANDLER_MANIFEST = [
  // --- library-owned, every host --------------------------------------------
  {
    key: 'agent',
    methods: AgentRpcHandlers.METHODS,
    requires: [],
    handler: AgentRpcHandlers,
  },
  {
    key: 'auth',
    methods: AuthRpcHandlers.METHODS,
    requires: [],
    handler: AuthRpcHandlers,
  },
  {
    key: 'autocomplete',
    methods: AutocompleteRpcHandlers.METHODS,
    requires: [],
    handler: AutocompleteRpcHandlers,
  },
  {
    key: 'chat',
    methods: ChatRpcHandlers.METHODS,
    requires: [],
    handler: ChatRpcHandlers,
  },
  {
    key: 'config',
    methods: ConfigRpcHandlers.METHODS,
    requires: [],
    handler: ConfigRpcHandlers,
  },
  {
    key: 'context',
    methods: ContextRpcHandlers.METHODS,
    requires: [],
    handler: ContextRpcHandlers,
  },
  {
    key: 'enhancedPrompts',
    methods: EnhancedPromptsRpcHandlers.METHODS,
    requires: [],
    handler: EnhancedPromptsRpcHandlers,
  },
  {
    key: 'git',
    methods: GitRpcHandlers.METHODS,
    requires: [],
    handler: GitRpcHandlers,
  },
  {
    key: 'harness',
    methods: HarnessRpcHandlers.METHODS,
    requires: [],
    handler: HarnessRpcHandlers,
  },
  {
    key: 'license',
    methods: LicenseRpcHandlers.METHODS,
    requires: [],
    handler: LicenseRpcHandlers,
  },
  {
    key: 'llm',
    methods: LlmRpcHandlers.METHODS,
    requires: [],
    handler: LlmRpcHandlers,
  },
  {
    key: 'mcpDirectory',
    methods: McpDirectoryRpcHandlers.METHODS,
    requires: [],
    handler: McpDirectoryRpcHandlers,
  },
  {
    key: 'plugin',
    methods: PluginRpcHandlers.METHODS,
    requires: [],
    handler: PluginRpcHandlers,
  },
  {
    key: 'provider',
    methods: ProviderRpcHandlers.METHODS,
    requires: [],
    handler: ProviderRpcHandlers,
  },
  {
    key: 'ptahCli',
    methods: PtahCliRpcHandlers.METHODS,
    requires: [],
    handler: PtahCliRpcHandlers,
  },
  {
    key: 'quality',
    methods: QualityRpcHandlers.METHODS,
    requires: [],
    handler: QualityRpcHandlers,
  },
  {
    key: 'session',
    methods: SessionRpcHandlers.METHODS,
    requires: [],
    handler: SessionRpcHandlers,
  },
  {
    key: 'settings',
    methods: SettingsRpcHandlers.METHODS,
    requires: [],
    handler: SettingsRpcHandlers,
  },
  {
    key: 'setup',
    methods: SetupRpcHandlers.METHODS,
    requires: [],
    handler: SetupRpcHandlers,
  },
  {
    key: 'skillsSh',
    methods: SkillsShRpcHandlers.METHODS,
    requires: [],
    handler: SkillsShRpcHandlers,
  },
  {
    key: 'subagent',
    methods: SubagentRpcHandlers.METHODS,
    requires: [],
    handler: SubagentRpcHandlers,
  },
  {
    key: 'tasks',
    methods: TasksRpcHandlers.METHODS,
    requires: [],
    handler: TasksRpcHandlers,
  },
  {
    key: 'webSearch',
    methods: WebSearchRpcHandlers.METHODS,
    requires: [],
    handler: WebSearchRpcHandlers,
  },
  {
    key: 'wizardGeneration',
    methods: WizardGenerationRpcHandlers.METHODS,
    requires: [],
    handler: WizardGenerationRpcHandlers,
  },

  // --- library-owned, capability-gated --------------------------------------
  {
    key: 'memory',
    methods: MemoryRpcHandlers.METHODS,
    requires: ['memory'],
    handler: MemoryRpcHandlers,
  },
  {
    key: 'mem',
    methods: MemRpcHandlers.METHODS,
    requires: ['memory'],
    handler: MemRpcHandlers,
  },
  {
    key: 'corpus',
    methods: CorpusRpcHandlers.METHODS,
    requires: ['memory'],
    handler: CorpusRpcHandlers,
  },
  {
    key: 'embedder',
    methods: EmbedderRpcHandlers.METHODS,
    requires: ['memory'],
    handler: EmbedderRpcHandlers,
  },
  {
    key: 'indexing',
    methods: IndexingRpcHandlers.METHODS,
    requires: ['memory'],
    handler: IndexingRpcHandlers,
  },
  {
    key: 'filePicker',
    methods: FilePickerRpcHandlers.METHODS,
    requires: ['filePicker'],
    handler: FilePickerRpcHandlers,
  },
  {
    key: 'filePickImages',
    methods: ImagePickerRpcHandlers.METHODS,
    requires: ['filePickerImages'],
    handler: ImagePickerRpcHandlers,
  },
  {
    key: 'command',
    methods: CommandRpcHandlers.METHODS,
    requires: ['commandExecution'],
    handler: CommandRpcHandlers,
  },
  {
    key: 'fileSystem',
    methods: FileSystemRpcHandlers.METHODS,
    requires: ['fileSystemAccess'],
    handler: FileSystemRpcHandlers,
  },
  {
    key: 'skillSynthesis',
    methods: SkillsSynthesisRpcHandlers.METHODS,
    requires: ['skillSynthesis'],
    handler: SkillsSynthesisRpcHandlers,
  },
  {
    key: 'cron',
    methods: CronRpcHandlers.METHODS,
    requires: ['cron'],
    handler: CronRpcHandlers,
  },
  {
    key: 'gateway',
    methods: GatewayRpcHandlers.METHODS,
    requires: ['gateway'],
    handler: GatewayRpcHandlers,
  },
  {
    key: 'voice',
    methods: VoiceRpcHandlers.METHODS,
    requires: ['voice'],
    handler: VoiceRpcHandlers,
  },
  {
    key: 'persistence',
    methods: PersistenceRpcHandlers.METHODS,
    requires: ['persistence'],
    handler: PersistenceRpcHandlers,
  },
  {
    key: 'workspace',
    methods: WorkspaceRpcHandlers.METHODS,
    requires: ['workspaceLifecycle'],
    handler: WorkspaceRpcHandlers,
  },
  {
    key: 'layout',
    methods: LayoutRpcHandlers.METHODS,
    requires: ['layoutPersistence'],
    handler: LayoutRpcHandlers,
  },
  {
    key: 'terminal',
    methods: TerminalRpcHandlers.METHODS,
    requires: ['pty'],
    handler: TerminalRpcHandlers,
  },
  {
    key: 'update',
    methods: UpdateRpcHandlers.METHODS,
    requires: ['appUpdater'],
    handler: UpdateRpcHandlers,
  },

  // --- host-owned (unification pending) -------------------------------------
  { key: 'host.fileOpen', methods: ['file:open'], requires: ['fileOpen'] },
  {
    key: 'host.editorRevert',
    methods: ['editor:revertFiles'],
    requires: ['editorRevert'],
  },
  {
    key: 'host.editorPane',
    methods: EDITOR_PANE_METHODS,
    requires: ['editorHost'],
  },
] as const satisfies readonly RpcHandlerManifestEntry[];

/** Every manifest key, for typed `hostHandlers` maps on host profiles. */
export type RpcHandlerKey = (typeof RPC_HANDLER_MANIFEST)[number]['key'];

/** Keys whose implementation still lives in a host. */
export type HostOwnedRpcHandlerKey = Extract<RpcHandlerKey, `host.${string}`>;

/**
 * Assert the two manifest invariants. Called at dev-time boot from
 * `registerRpcSurface` and unconditionally from `manifest.spec.ts`.
 *
 * @throws when an entry is duplicated, or when the manifest does not partition
 *   `RPC_METHOD_NAMES` exactly.
 */
export function assertManifestInvariants(registry: readonly string[]): void {
  const owner = new Map<string, string>();
  for (const entry of RPC_HANDLER_MANIFEST) {
    for (const method of entry.methods) {
      const previous = owner.get(method);
      if (previous) {
        throw new Error(
          `RPC manifest: '${method}' is claimed by both '${previous}' and '${entry.key}'`,
        );
      }
      owner.set(method, entry.key);
    }
  }

  const known = new Set(registry);
  const unknown = [...owner.keys()].filter((method) => !known.has(method));
  if (unknown.length > 0) {
    throw new Error(
      `RPC manifest claims ${unknown.length} method(s) absent from RPC_METHOD_NAMES: ${unknown.join(', ')}`,
    );
  }

  const unowned = registry.filter((method) => !owner.has(method));
  if (unowned.length > 0) {
    throw new Error(
      `RPC manifest is missing an owner for ${unowned.length} method(s): ${unowned.join(', ')}`,
    );
  }

  assertHandlersNotSharedAcrossCapabilities();
}

/**
 * A handler class registers all of its methods at once, so two entries backed
 * by the same class must be gated identically. Otherwise enabling one
 * capability silently registers the other's methods too, and the derived
 * exclusion set becomes a lie.
 */
function assertHandlersNotSharedAcrossCapabilities(): void {
  const seen = new Map<RpcHandlerCtor, { key: string; requires: string }>();
  for (const entry of RPC_HANDLER_MANIFEST as readonly RpcHandlerManifestEntry[]) {
    if (!entry.handler) continue;
    const requires = [...entry.requires].sort().join('+') || '(none)';
    const previous = seen.get(entry.handler);
    if (previous && previous.requires !== requires) {
      throw new Error(
        `RPC manifest: ${entry.handler.name} backs '${previous.key}' ` +
          `(requires ${previous.requires}) and '${entry.key}' ` +
          `(requires ${requires}). Split the class, or gate both entries the same.`,
      );
    }
    if (!previous) seen.set(entry.handler, { key: entry.key, requires });
  }
}
