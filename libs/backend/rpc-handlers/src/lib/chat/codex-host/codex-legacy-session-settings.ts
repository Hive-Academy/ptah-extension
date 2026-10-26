import type { AuthManager } from '@ptah-extension/auth-providers';
import type { SessionLifecycleManager } from '@ptah-extension/agent-sdk';
import { resolveAuthProviderKey } from '@ptah-extension/platform-core';
import {
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
    if (!workspacePath) throw new Error('Legacy session settings unavailable');
    const auth = deps.auth.resolveActiveAuthForPath(workspacePath);
    const authKey = resolveAuthProviderKey(auth.authMethod, auth.providerId);
    const read = (key: string) =>
      deps.scopeResolver.readForPath(key, workspacePath, true);
    const modelDef = providerSelectedModelDef(authKey);
    const model = modelDef.schema.safeParse(
      session?.currentModel ?? read(modelDef.key) ?? modelDef.default,
    );
    if (!model.success) throw new Error('Legacy session model unavailable');

    let effort = session?.config.effort;
    if (!session) {
      const effortDef = providerReasoningEffortDef(authKey);
      const saved = effortDef.schema.safeParse(
        read(effortDef.key) ?? effortDef.default,
      );
      if (!saved.success) throw new Error('Legacy session effort unavailable');
      const value = saved.data;
      if (
        value !== '' &&
        value !== undefined &&
        value !== 'low' &&
        value !== 'medium' &&
        value !== 'high' &&
        value !== 'xhigh' &&
        value !== 'max'
      ) {
        throw new Error('Legacy session effort unavailable');
      }
      effort = value === '' ? undefined : value;
    }
    const permission = permissionSchema.safeParse(
      session?.permissionLevel ??
        (read('autopilot.enabled') === true
          ? read('autopilot.permissionLevel')
          : 'ask'),
    );
    if (!permission.success)
      throw new Error('Legacy session permission unavailable');
    return {
      workspacePath,
      authKey,
      model: model.data,
      effort,
      permissionLevel: permission.data,
    };
  };
}
