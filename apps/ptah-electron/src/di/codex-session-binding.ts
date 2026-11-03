import type { DependencyContainer } from 'tsyringe';
import type { IAgentAdapter, SessionId } from '@ptah-extension/shared';
import {
  SDK_TOKENS,
  type SessionLifecycleManager,
  type CodexChatAdapterPorts,
  type CodexChatScope,
  type NativeSessionControls,
} from '@ptah-extension/agent-sdk';
import type { CodexThreadIdentity, CodexThreadIdentityStore } from '@ptah-extension/codex-runtime';
import { trackElectronCodexBinding } from './codex-binding-registry';
import {
  AUTH_PROVIDERS_TOKENS,
  type AuthManager,
} from '@ptah-extension/auth-providers';
import {
  createNativeSessionControls,
  createLegacySessionControlPorts,
  createLegacyCodexSessionSettings,
  type CodexChatHostPortsDeps,
  type NativeSessionControlsDeps,
  type LegacySessionControlPortsDeps,
} from '@ptah-extension/rpc-handlers';
import type {
  ElectronCodexBinding,
  ElectronCodexBindingInput,
  ElectronCodexIdentityLookup,
  ElectronCodexPreparedSession,
  ElectronCodexRouting,
  ElectronCodexSessionControls,
  ElectronCodexSessionState,
  ElectronCodexSettingsRecord,
  ElectronCodexShutdownStore,
} from './codex-binding.types';

/** @internal Electron composition and its lifecycle specs. */
export function createElectronCodexSessionState(
  container: DependencyContainer,
): ElectronCodexSessionState {
  const lifecycle = () =>
    container.resolve<SessionLifecycleManager>(
      SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER,
    );
  const native = () =>
    container.resolve<NativeSessionControlsDeps['adapter']>(
      SDK_TOKENS.CODEX_CHAT_ADAPTER,
    );
  const legacy = () =>
    container.resolve<IAgentAdapter>(SDK_TOKENS.SDK_AGENT_ADAPTER);
  const tabs = new Map<SessionId, string>();
  const profiles = new Map<SessionId, ElectronCodexPreparedSession>();
  const preparedTabs = new WeakMap<ElectronCodexPreparedSession, string>();
  const tabId = (id: SessionId) =>
    tabs.get(id) ?? lifecycle().find(id)?.tabId ?? id;
  return { lifecycle, native, legacy, tabs, profiles, preparedTabs, tabId };
}

/** @internal Electron composition only. */
export function createElectronCodexControls(
  container: DependencyContainer,
  input: ElectronCodexBindingInput,
  state: ElectronCodexSessionState,
  record: ElectronCodexSettingsRecord,
  lookup: ElectronCodexIdentityLookup,
  broadcaster: CodexChatHostPortsDeps['broadcaster'],
): ElectronCodexSessionControls {
  const { settingsStore, scopeResolver } = input;
  const { tabId, native, legacy, lifecycle } = state;
  const controls = createNativeSessionControls({
    store: settingsStore,
    settings: (id) => record.settings(id),
    broadcaster,
    tabId,
    adapter: {
      setSessionModel: (...args) => native().setSessionModel(...args),
      setSessionEffort: (...args) => native().setSessionEffort(...args),
      setSessionPermissionLevel: (...args) =>
        native().setSessionPermissionLevel(...args),
      interruptCurrentTurn: (...args) =>
        native().interruptCurrentTurn(...args),
      executeSlashCommand: (...args) => native().executeSlashCommand(...args),
      getSessionToken: (...args) => native().getSessionToken(...args),
      canSendFollowUp: (id) => native().canSendFollowUp(id),
    },
  });
  const legacyPorts = createLegacySessionControlPorts({
    store: settingsStore,
    broadcaster,
    tabId,
    adapter: {
      executeSlashCommand: (...args) => legacy().executeSlashCommand(...args),
    },
    sessions: { find: (id) => lifecycle().find(id) },
    lifecycle: {
      interruptCurrentTurn: (id) => lifecycle().interruptCurrentTurn(id),
    },
    modelResolver: {
      resolve: (...args) =>
        container
          .resolve<LegacySessionControlPortsDeps['modelResolver']>(
            AUTH_PROVIDERS_TOKENS.SDK_MODEL_RESOLVER,
          )
          .resolve(...args),
    },
    settings: createLegacyCodexSessionSettings({
      sessions: { find: (id) => lifecycle().find(id) },
      identities: lookup,
      scopeResolver,
      auth: {
        resolveActiveAuthForPath: (path) =>
          container
            .resolve<AuthManager>(AUTH_PROVIDERS_TOKENS.SDK_AUTH_MANAGER)
            .resolveActiveAuthForPath(path),
      },
    }),
  });
  return { controls, legacyPorts };
}

/** @internal Electron composition and its lifecycle specs. */
export function createElectronCodexSessionLifecycle(
  record: Pick<ElectronCodexSettingsRecord, 'lifecycle'>,
  state: Pick<ElectronCodexSessionState, 'tabs' | 'profiles' | 'preparedTabs'>,
  lookup: Pick<ElectronCodexIdentityLookup, 'releaseSession'>,
  controls: Pick<NativeSessionControls, 'releaseSession'>,
): NonNullable<CodexChatAdapterPorts['sessions']> {
  const { profiles, tabs, preparedTabs } = state;
  return {
    opened(id, prepared) {
      record.lifecycle.opened(id, prepared);
      profiles.set(id, prepared);
      const tab = preparedTabs.get(prepared);
      if (tab) tabs.set(id, tab);
    },
    closed(id) {
      record.lifecycle.closed(id);
      profiles.delete(id);
      tabs.delete(id);
      lookup.releaseSession(id);
      controls.releaseSession?.(id);
    },
  };
}

/** @internal Own inactive writes independently of the runtime's close latency. */
export function createElectronCodexShutdownStore(
  store: CodexThreadIdentityStore,
): ElectronCodexShutdownStore {
  const identities = new Set<CodexThreadIdentity>();
  let stopping = false;
  let staged: Promise<void> | undefined;
  return {
    read: (id) => store.read(id),
    async persist(identity) {
      if (stopping) throw new Error('Native Codex chat is shutting down');
      // Include an in-flight persist: the metadata store serializes its writes.
      identities.add(identity);
      try {
        await store.persist(identity);
      } catch (error) {
        identities.delete(identity);
        throw error;
      }
      if (stopping) throw new Error('Native Codex chat is shutting down');
    },
    async markInactive(identity) {
      // A late runtime close must not enqueue a write against closed storage.
      if (stopping) return staged;
      await store.markInactive(identity);
      identities.delete(identity);
    },
    stageInactive() {
      if (staged) return staged;
      stopping = true;
      staged = Promise.allSettled(
        [...identities].map((identity) => store.markInactive(identity)),
      ).then((results) => {
        identities.clear();
        const failures = results.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : [],
        );
        if (failures.length)
          throw new AggregateError(failures, 'Codex inactive metadata staging failed');
      });
      return staged;
    },
  };
}

interface BindingHandleContext {
  readonly routing: ElectronCodexRouting;
  readonly scopes: Set<CodexChatScope>;
  readonly record: Pick<ElectronCodexSettingsRecord, 'dispose'>;
  readonly lookup: Pick<ElectronCodexIdentityLookup, 'dispose'>;
  readonly store: ElectronCodexShutdownStore;
  readonly state: Pick<ElectronCodexSessionState, 'tabs' | 'profiles'>;
  disposed: boolean;
}

/** @internal Electron composition; exported for shutdown regression coverage. */
export function createElectronCodexBindingHandle(
  context: BindingHandleContext,
): ElectronCodexBinding {
  const { routing, scopes, record, lookup, store } = context;
  const { tabs, profiles } = context.state;
  let closing: Promise<void> | undefined;
  const tracking: { untrack: () => void } = { untrack: () => undefined };
  const binding: ElectronCodexBinding = {
    ...routing,
    dispose: () =>
      (closing ??= (async () => {
        context.disposed = true;
        try {
          // Invoke first so every inactive write is queued before slow closes.
          const staged = store.stageInactive();
          const results = await Promise.allSettled([
            staged,
            ...[...scopes].map((scope) => Promise.resolve().then(() => scope.dispose())),
          ]);
          const failures = results.flatMap((result) =>
            result.status === 'rejected' ? [result.reason] : [],
          );
          if (failures.length)
            throw new AggregateError(failures, 'Codex scope shutdown failed');
        } finally {
          try {
            record.dispose();
          } finally {
            try {
              lookup.dispose();
            } finally {
              tabs.clear();
              profiles.clear();
              tracking.untrack();
            }
          }
        }
      })()),
  };
  tracking.untrack = trackElectronCodexBinding(binding);
  return binding;
}
