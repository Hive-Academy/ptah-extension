import type { AuthManager } from '@ptah-extension/auth-providers';
import type { SessionLifecycleManager } from '@ptah-extension/agent-sdk';
import { resolveAuthProviderKey } from '@ptah-extension/platform-core';
import {
  EFFORT_LEVEL_SCHEMA,
  providerReasoningEffortDef,
  providerSelectedModelDef,
  type WorkspaceScopeResolver,
} from '@ptah-extension/settings-core';
import { z } from 'zod';
import type { CodexSessionSettingsRecordDeps } from './codex-session-settings-record';
import type { LegacySessionControlPortsDeps } from './native-session-controls';

export interface LegacyCodexSessionSettingsDeps {
  readonly sessions: Pick<SessionLifecycleManager, 'find'>;
  readonly identities: Pick<CodexSessionSettingsRecordDeps['identities'], 'lookup'>;
  readonly scopeResolver: Pick<WorkspaceScopeResolver, 'readForPath'>;
  readonly auth: Pick<AuthManager, 'resolveActiveAuthForPath'>;
}

export class LegacyCodexSessionSettingsError extends Error {
  constructor(
    readonly code: 'missing-workspace-path' | 'invalid-model' | 'invalid-effort' | 'invalid-permission',
  ) {
    super(`Legacy Codex session settings: ${code}`);
    this.name = 'LegacyCodexSessionSettingsError';
  }
}

const effortSchema = EFFORT_LEVEL_SCHEMA.exclude(['']).optional();
const permissionSchema = z.enum(['ask', 'plan', 'auto-edit', 'yolo']);

/** Legacy controls share the same precedence without exposing stored values in errors. */
export function createLegacyCodexSessionSettings(
  deps: LegacyCodexSessionSettingsDeps,
): LegacySessionControlPortsDeps['settings'] {
  return (id) => {
    const session = deps.sessions.find(id);
    const workspacePath =
      session?.config.projectPath ??
      session?.config.workspaceId ??
      deps.identities.lookup(id)?.persisted?.workspaceId;
    if (!workspacePath) throw new LegacyCodexSessionSettingsError('missing-workspace-path');
    const auth = deps.auth.resolveActiveAuthForPath(workspacePath);
    const authKey = resolveAuthProviderKey(auth.authMethod, auth.providerId);
    const read = (key: string) =>
      deps.scopeResolver.readForPath(key, workspacePath, true);
    const modelDef = providerSelectedModelDef(authKey);
    const model = modelDef.schema.safeParse(
      session?.currentModel ?? read(modelDef.key) ?? modelDef.default,
    );
    if (!model.success) throw new LegacyCodexSessionSettingsError('invalid-model');

    let effort: unknown = session?.config.effort;
    if (!session) {
      const effortDef = providerReasoningEffortDef(authKey);
      const saved = effortDef.schema.safeParse(
        read(effortDef.key) ?? effortDef.default,
      );
      if (!saved.success) throw new LegacyCodexSessionSettingsError('invalid-effort');
      const value = saved.data;
      effort = value === '' ? undefined : value;
    }
    const parsedEffort = effortSchema.safeParse(effort);
    if (!parsedEffort.success) throw new LegacyCodexSessionSettingsError('invalid-effort');
    const permission = permissionSchema.safeParse(
      session?.permissionLevel ??
        (read('autopilot.enabled') === true
          ? read('autopilot.permissionLevel')
          : 'ask'),
    );
    if (!permission.success)
      throw new LegacyCodexSessionSettingsError('invalid-permission');
    return {
      workspacePath,
      authKey,
      model: model.data,
      effort: parsedEffort.data,
      permissionLevel: permission.data,
    };
  };
}
