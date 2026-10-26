import type {
  CodexChatAdapterPorts,
  SessionRuntimeIdentityLookup,
} from '@ptah-extension/agent-sdk';
import { resolveAuthProviderKey } from '@ptah-extension/platform-core';
import {
  providerSelectedModelDef,
  providerReasoningEffortDef,
} from '@ptah-extension/settings-core';
import type {
  EffortLevel,
  PermissionLevel,
  SessionId,
} from '@ptah-extension/shared';
import type { SessionControlSettings } from './native-session-controls';

type ProfileResult = Awaited<ReturnType<CodexChatAdapterPorts['profile']>>;

export interface CodexSessionSettingsRecordDeps {
  identities: SessionRuntimeIdentityLookup;
  /** WorkspaceScopeResolver.readForPath; values are unknown until validated here. */
  scopeResolver: {
    readForPath(
      globalKey: string,
      workspacePath: string,
      appScopable?: boolean,
    ): unknown;
  };
}

export class CodexSessionSettingsError extends Error {
  constructor(readonly code: 'unknown-session' | 'invalid-settings') {
    super(`Codex session settings: ${code}`);
    this.name = 'CodexSessionSettingsError';
  }
}

function effort(value: unknown): EffortLevel | undefined {
  if (value === undefined || value === '') return undefined;
  if (
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max'
  )
    return value;
  throw new CodexSessionSettingsError('invalid-settings');
}

export function createCodexSessionSettingsRecord(
  deps: CodexSessionSettingsRecordDeps,
) {
  const sessions = new Map<SessionId, SessionControlSettings>();
  const pending = new Map<string, ProfileResult>();
  // Native Codex is a third-party provider in the legacy auth route, including
  // openai-codex OAuth. Never read the currently focused workspace's authMethod.
  const authKey = (providerId: string) =>
    resolveAuthProviderKey('thirdParty', providerId);
  const record = (sessionId: SessionId, result: ProfileResult): void => {
    const p = result.profile;
    sessions.set(
      sessionId,
      Object.freeze({
        workspacePath: p.workspaceId,
        authKey: authKey(p.providerId),
        model: p.model,
        effort: effort(p.effort),
        permissionLevel: p.permissionLevel,
      }),
    );
  };
  return {
    record,
    settings(sessionId: SessionId): SessionControlSettings {
      const recorded = sessions.get(sessionId);
      if (recorded) return recorded;
      const identity = deps.identities.lookup(sessionId)?.persisted;
      if (
        !identity ||
        identity.sessionId !== sessionId ||
        identity.runtime !== 'codex-app-server'
      ) {
        throw new CodexSessionSettingsError('unknown-session');
      }
      const key = authKey(identity.providerId);
      const read = (name: string) =>
        deps.scopeResolver.readForPath(
          name,
          identity.workspaceId,
          true,
        );
      const modelDef = providerSelectedModelDef(key);
      const effortDef = providerReasoningEffortDef(key);
      const model = modelDef.schema.safeParse(
        read(modelDef.key) ?? modelDef.default,
      );
      const parsedEffort = effortDef.schema.safeParse(
        read(effortDef.key) ?? effortDef.default,
      );
      if (!model.success || !parsedEffort.success)
        throw new CodexSessionSettingsError('invalid-settings');
      const enabled = read('autopilot.enabled');
      const level = read('autopilot.permissionLevel');
      let permissionLevel: PermissionLevel = 'ask';
      if (enabled === true) {
        if (
          level !== 'ask' &&
          level !== 'plan' &&
          level !== 'auto-edit' &&
          level !== 'yolo'
        ) {
          throw new CodexSessionSettingsError('invalid-settings');
        }
        permissionLevel = level;
      }
      return {
        workspacePath: identity.workspaceId,
        authKey: key,
        model: model.data,
        effort: effort(parsedEffort.data),
        permissionLevel,
      };
    },
    /** Fresh thread ids exist only after open. Bind the prepared profile when metadata is saved. */
    wrapPorts<T extends Pick<CodexChatAdapterPorts, 'profile' | 'metadata'>>(
      ports: T,
    ): T {
      return {
        ...ports,
        async profile(...args: Parameters<CodexChatAdapterPorts['profile']>) {
          const [config, sessionId] = args;
          const result = await ports.profile(config, sessionId);
          if (sessionId) record(sessionId, result);
          else pending.set(result.profile.contextId, result);
          return result;
        },
        metadata: {
          async save(
            ...args: Parameters<CodexChatAdapterPorts['metadata']['save']>
          ) {
            const [sessionId, identity, title] = args;
            const result = pending.get(identity.contextId);
            try {
              await ports.metadata.save(sessionId, identity, title);
              if (result) record(sessionId, result);
            } finally {
              pending.delete(identity.contextId);
            }
          },
        },
      };
    },
    /** Host teardown must also release prepared profiles whose runtime open failed. */
    dispose() {
      sessions.clear();
      pending.clear();
    },
    discardProfile(contextId: string) {
      pending.delete(contextId);
    },
    release(sessionId: SessionId) {
      sessions.delete(sessionId);
    },
  };
}
