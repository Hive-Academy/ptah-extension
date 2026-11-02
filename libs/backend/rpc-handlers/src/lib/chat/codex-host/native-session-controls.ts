import type {
  LegacySessionControlPorts,
  LegacySettingsPersistence,
  NativeSessionControls,
} from '@ptah-extension/agent-sdk';
import { isCodexChatAdapterError } from '@ptah-extension/agent-sdk';
import {
  WorkspaceScopeResolver,
  providerSelectedModelDef,
  providerReasoningEffortDef,
  type ISettingsStore,
} from '@ptah-extension/settings-core';
import type {
  AppliedSettings,
  EffortLevel,
  IAgentAdapter,
  PermissionLevel,
  SessionId,
  SessionRuntimeControlOptions,
} from '@ptah-extension/shared';
import type { ChatStreamBroadcaster } from '../streaming/chat-stream-broadcaster.service';

export interface SessionControlSettings {
  readonly workspacePath: string;
  /** Provider settings namespace from the session's bound provider, not focused UI. */
  readonly authKey: string;
  readonly model: string;
  readonly effort?: EffortLevel;
  readonly permissionLevel: PermissionLevel;
}

export interface SessionControlPersistenceDeps {
  store: ISettingsStore;
  appScope?: string;
  /** Initial effective settings captured at native open, or persisted inactive binding. */
  settings(sessionId: SessionId): SessionControlSettings;
}

export interface NativeSessionControlsDeps extends SessionControlPersistenceDeps {
  adapter: Pick<
    IAgentAdapter,
    | 'setSessionModel'
    | 'setSessionEffort'
    | 'setSessionPermissionLevel'
    | 'interruptCurrentTurn'
    | 'executeSlashCommand'
    | 'getSessionToken'
  > & {
    canSendFollowUp(sessionId: SessionId): boolean;
  };
  broadcaster: Pick<ChatStreamBroadcaster, 'streamEventsToWebview'>;
  tabId(sessionId: SessionId): string;
}

/** Serialize shared scope writes as well as per-session live transactions. */
function queue() {
  let pending: Promise<unknown> = Promise.resolve();
  return <T>(action: () => Promise<T>): Promise<T> => {
    const operation = pending.then(action, action);
    pending = operation;
    return operation;
  };
}

const persistenceQueues = new WeakMap<ISettingsStore, ReturnType<typeof queue>>();

function persistence(
  deps: SessionControlPersistenceDeps,
): LegacySettingsPersistence {
  let serialize = persistenceQueues.get(deps.store);
  if (!serialize) {
    serialize = queue();
    persistenceQueues.set(deps.store, serialize);
  }
  const enqueue = serialize;
  const save = (
    id: SessionId,
    changes: ReadonlyArray<readonly [string, unknown]>,
    options?: SessionRuntimeControlOptions,
  ) =>
    enqueue(async () => {
      const settings = deps.settings(id);
      const target = options?.applyTo ?? 'app';
      if (target === 'workspace' && !settings.workspacePath)
        throw new Error('Session workspace unavailable');
      const source = {
        getActivePath: () => settings.workspacePath,
        // This immutable source is scoped to one save; the resolver never subscribes.
        onDidChange: () => ({
          dispose() {
            return;
          },
        }),
      };
      const resolver = new WorkspaceScopeResolver(
        deps.store,
        source,
        deps.appScope,
      );
      const previous = new Map<string, unknown>();
      for (const [key] of changes) {
        for (const physical of resolver.scopedKeys(key, true)) {
          previous.set(physical, deps.store.readGlobal(physical));
        }
      }
      try {
        for (const [key, value] of changes) {
          await resolver.write(key, value, target, true);
          await resolver.clearMoreSpecific(key, target, true);
        }
      } catch (saveError) {
        // Restore physical values, including undefined (absence). Never materialize
        // inherited defaults at the failed target scope.
        const failures: unknown[] = [saveError];
        for (const [key, value] of previous) {
          if (Object.is(deps.store.readGlobal(key), value)) continue;
          try {
            await deps.store.writeGlobal(key, value);
          } catch (error) {
            failures.push(error);
          }
        }
        if (failures.length > 1)
          throw new AggregateError(failures, 'Settings rollback failed', {
            cause: saveError,
          });
        throw saveError;
      }
    });
  return {
    saveModel(id, model, options) {
      const def = providerSelectedModelDef(deps.settings(id).authKey);
      return save(id, [[def.key, def.schema.parse(model)]], options);
    },
    saveEffort(id, effort, options) {
      const def = providerReasoningEffortDef(deps.settings(id).authKey);
      return save(id, [[def.key, def.schema.parse(effort ?? '')]], options);
    },
    savePermission(id, level, options) {
      const autopilot = options?.autopilot ?? {
        enabled: level !== 'ask',
        permissionLevel: level,
      };
      return save(
        id,
        [
          ['autopilot.enabled', autopilot.enabled],
          ['autopilot.permissionLevel', autopilot.permissionLevel],
        ],
        options,
      );
    },
  };
}

export function createNativeSessionControls(
  deps: NativeSessionControlsDeps,
): NativeSessionControls {
  const saves = persistence(deps);
  const serialize = queue();
  const states = new Map<
    SessionId,
    { token: string; revision: number; settings: SessionControlSettings }
  >();
  const change = <T>(
    id: SessionId,
    value: T,
    previous: (settings: SessionControlSettings) => T,
    update: (
      settings: SessionControlSettings,
      value: T,
    ) => SessionControlSettings,
    apply: (value: T) => Promise<void>,
    save: () => Promise<void>,
  ): Promise<AppliedSettings> =>
    serialize(async () => {
      const token = deps.adapter.getSessionToken(id);
      if (!token) {
        states.delete(id);
        await save();
        return { timing: 'nextTurn', revision: 0 };
      }
      let state = states.get(id);
      if (!state || state.token !== token) {
        state = { token, revision: 0, settings: { ...deps.settings(id) } };
        states.set(id, state);
      }
      const old = previous(state.settings);
      try {
        await apply(value);
      } catch (error) {
        if (
          !isCodexChatAdapterError(error) ||
          error.code !== 'unavailable' ||
          error.operation !== 'permission'
        )
          throw error;
        states.delete(id);
        await save();
        return { timing: 'nextTurn', revision: 0 };
      }
      try {
        await save();
      } catch (saveError) {
        try {
          if (deps.adapter.getSessionToken(id) !== token)
            throw new Error('Session changed during settings save', {
              cause: saveError,
            });
          await apply(old);
        } catch (rollbackError) {
          throw new AggregateError(
            [saveError, rollbackError],
            'Native live settings rollback failed',
            { cause: rollbackError },
          );
        }
        throw saveError;
      }
      state.settings = update(state.settings, value);
      return { timing: 'nextTurn', revision: ++state.revision };
    });
  return {
    setModel: (id, model, options) =>
      change(
        id,
        model,
        (s) => s.model,
        (s, value) => ({ ...s, model: value }),
        (value) => deps.adapter.setSessionModel(id, value),
        () => saves.saveModel(id, model, options),
      ),
    setEffort: (id, effort, options) =>
      change(
        id,
        effort,
        (s) => s.effort,
        (s, value) => ({ ...s, effort: value }),
        (value) => deps.adapter.setSessionEffort(id, value),
        () => saves.saveEffort(id, effort, options),
      ),
    setPermission: (id, level, options) =>
      change(
        id,
        level,
        (s) => s.permissionLevel,
        (s, value) => ({ ...s, permissionLevel: value }),
        (value) => deps.adapter.setSessionPermissionLevel(id, value),
        () => saves.savePermission(id, level, options),
      ),
    canSendFollowUp: (id) => deps.adapter.canSendFollowUp(id),
    interrupt: (id) => deps.adapter.interruptCurrentTurn(id),
    async compact(id) {
      const tabId = deps.tabId(id);
      const stream = await deps.adapter.executeSlashCommand(id, '/compact', {
        tabId,
      });
      await deps.broadcaster.streamEventsToWebview(id, stream, tabId);
    },
    releaseSession(id) {
      states.delete(id);
    },
  };
}

export interface LegacySessionControlPortsDeps
  extends
    SessionControlPersistenceDeps,
    Pick<
      LegacySessionControlPorts,
      'sessions' | 'modelResolver' | 'lifecycle'
    > {
  adapter: Pick<IAgentAdapter, 'executeSlashCommand'>;
  broadcaster: Pick<ChatStreamBroadcaster, 'streamEventsToWebview'>;
  tabId(sessionId: SessionId): string;
}

export function createLegacySessionControlPorts(
  deps: LegacySessionControlPortsDeps,
): LegacySessionControlPorts {
  return {
    sessions: deps.sessions,
    modelResolver: deps.modelResolver,
    lifecycle: deps.lifecycle,
    persistence: persistence(deps),
    slash: {
      async executeSlashCommand(id, command) {
        const tabId = deps.tabId(id);
        const stream = await deps.adapter.executeSlashCommand(id, command, {
          tabId,
        });
        await deps.broadcaster.streamEventsToWebview(
          id,
          stream,
          tabId,
        );
      },
    },
  };
}
