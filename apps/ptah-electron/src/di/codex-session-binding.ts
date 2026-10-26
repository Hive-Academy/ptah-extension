import type { DependencyContainer } from 'tsyringe';
import type { IAgentAdapter, SessionId } from '@ptah-extension/shared';
import {
  SDK_TOKENS,
  type SessionLifecycleManager,
  type CodexChatAdapterPorts,
} from '@ptah-extension/agent-sdk';
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
  type createCodexSessionSettingsRecord,
} from '@ptah-extension/rpc-handlers';
import type {
  ElectronCodexBindingInput,
  createElectronCodexIdentityLookup,
} from './codex-runtime-composition';

type IdentityLookup = Awaited<ReturnType<typeof createElectronCodexIdentityLookup>>;
type SettingsRecord = ReturnType<typeof createCodexSessionSettingsRecord>;

export function createElectronCodexSessionState(container: DependencyContainer) {
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
  const profiles = new Map<
    SessionId,
    Awaited<ReturnType<CodexChatAdapterPorts['profile']>>
  >();
  const preparedTabs = new WeakMap<
    Awaited<ReturnType<CodexChatAdapterPorts['profile']>>,
    string
  >();
  const tabId = (id: SessionId) =>
    tabs.get(id) ?? lifecycle().find(id)?.tabId ?? id;
  return { lifecycle, native, legacy, tabs, profiles, preparedTabs, tabId };
}

type SessionState = ReturnType<typeof createElectronCodexSessionState>;

export function createElectronCodexControls(
  container: DependencyContainer,
  input: ElectronCodexBindingInput,
  state: SessionState,
  record: SettingsRecord,
  lookup: IdentityLookup,
  broadcaster: CodexChatHostPortsDeps['broadcaster'],
) {
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

export function createElectronCodexSessionLifecycle(
  record: Pick<SettingsRecord, 'lifecycle'>,
  state: Pick<SessionState, 'tabs' | 'profiles' | 'preparedTabs'>,
  lookup: Pick<IdentityLookup, 'releaseSession'>,
  controls: Pick<ReturnType<typeof createNativeSessionControls>, 'releaseSession'>,
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
