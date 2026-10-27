import type { IAgentAdapter, SessionId } from '@ptah-extension/shared';
import type {
  CodexChatSessionLifecycle,
  LegacySessionControlPorts,
  NativeSessionControls,
  SessionLifecycleManager,
  SessionMetadataStore,
  SessionRuntimeIdentityLookup,
} from '@ptah-extension/agent-sdk';
import type {
  CodexExecutionProfile,
  CodexParityPlatform,
  CodexRuntimeRegistrationPorts,
  CodexThreadIdentity,
  CodexThreadIdentityStore,
} from '@ptah-extension/codex-runtime';
import type {
  LegacyCodexSessionSettingsDeps,
  NativeSessionControlsDeps,
  SessionControlSettings,
} from '@ptah-extension/rpc-handlers';

/** @internal Electron composition contracts shared with session binding. */
export interface ElectronCodexRoutingInput {
  readonly isPackaged: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly platform: CodexParityPlatform;
}

export interface ElectronCodexRouting {
  readonly devRoute: CodexRuntimeRegistrationPorts['devRoute'];
  readonly capabilities: Readonly<{ nativeCodex: boolean }>;
}

export interface ElectronCodexBindingInput extends ElectronCodexRoutingInput {
  readonly bundledRoot: string;
  readonly scopeResolver: LegacyCodexSessionSettingsDeps['scopeResolver'];
  readonly settingsStore: NativeSessionControlsDeps['store'];
}

export interface ElectronCodexIdentityLookup extends SessionRuntimeIdentityLookup {
  updateCodexExecution: SessionMetadataStore['updateCodexExecution'];
  releaseSession(sessionId: SessionId): void;
  dispose(): void;
}

export interface ElectronCodexPreparedSession {
  readonly profile: CodexExecutionProfile;
  readonly resume?: CodexThreadIdentity;
}

export interface ElectronCodexSessionState {
  lifecycle(): SessionLifecycleManager;
  native(): NativeSessionControlsDeps['adapter'];
  legacy(): IAgentAdapter;
  readonly tabs: Map<SessionId, string>;
  readonly profiles: Map<SessionId, ElectronCodexPreparedSession>;
  readonly preparedTabs: WeakMap<ElectronCodexPreparedSession, string>;
  tabId(id: SessionId): string;
}

export interface ElectronCodexSettingsRecord {
  record(id: SessionId, prepared: ElectronCodexPreparedSession): void;
  settings(id: SessionId): SessionControlSettings;
  readonly lifecycle: CodexChatSessionLifecycle;
  dispose(): void;
}

export interface ElectronCodexSessionControls {
  readonly controls: NativeSessionControls;
  readonly legacyPorts: LegacySessionControlPorts;
}

export interface ElectronCodexShutdownStore extends CodexThreadIdentityStore {
  /** Queue inactive writes synchronously, before waiting on process closure. */
  stageInactive(): Promise<void>;
}

export interface ElectronCodexBinding extends ElectronCodexRouting {
  dispose(): Promise<void>;
}
