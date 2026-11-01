import type {
  AppliedSettings,
  EffortLevel,
  PermissionLevel,
  SessionId,
  SessionRuntimeControls,
  SessionRuntimeControlOptions,
} from '@ptah-extension/shared';
import type { IModelResolver } from '../auth-env.port';
import type { Query } from '../helpers/session-lifecycle-manager';
import type { SessionRecord } from '../helpers/session-lifecycle/session-registry.service';
import type { SessionControl } from '../helpers/session-lifecycle/session-control.service';
import { PERMISSION_MODE_MAP } from '../helpers/session-lifecycle/permission-mode-map';

export interface LegacyControlledSession extends Pick<
  SessionRecord,
  'currentModel' | 'permissionLevel' | 'config'
> {
  readonly query: Pick<
    Query,
    'setPermissionMode' | 'setModel' | 'applyFlagSettings'
  > | null;
}

export interface LegacySessionLookup {
  find(sessionId: string): LegacyControlledSession | undefined;
}

/**
 * Composition binds these to ModelSettings.selectedModel.set,
 * ReasoningSettings.effort.set (undefined -> ''), and ConfigManager's
 * autopilot settings. Scope comes from the caller/session, never focused UI.
 * Each save must reject without committing, or restore its own partial writes.
 */
export interface LegacySettingsPersistence {
  savePermission(sessionId: SessionId, level: PermissionLevel, options?: SessionRuntimeControlOptions): Promise<void>;
  saveModel(sessionId: SessionId, model: string, options?: SessionRuntimeControlOptions): Promise<void>;
  saveEffort(
    sessionId: SessionId,
    effort: EffortLevel | undefined,
    options?: SessionRuntimeControlOptions,
  ): Promise<void>;
}

/** Bind to the existing SDK executeSlashCommand path, including its stream pump. */
export interface LegacySlashCommands {
  executeSlashCommand(sessionId: SessionId, command: '/compact'): Promise<void>;
}

export class LegacySessionControlError extends Error {
  constructor(
    readonly code: 'session-unavailable' | 'rollback-failed',
    readonly sessionId: SessionId,
    readonly failures?: readonly unknown[],
  ) {
    super(`Legacy session control failed: ${code}`);
    this.name = 'LegacySessionControlError';
  }
}

/** All settings mutations must enter here so snapshots remain authoritative. */
export class LegacySessionControls implements SessionRuntimeControls {
  private readonly pending = new Map<SessionId, Promise<unknown>>();
  private readonly state = new WeakMap<
    LegacyControlledSession,
    {
      revision: number;
      effort: EffortLevel | undefined;
    }
  >();

  constructor(
    private readonly sessions: LegacySessionLookup,
    private readonly persistence: LegacySettingsPersistence,
    private readonly modelResolver: Pick<IModelResolver, 'resolve'>,
    private readonly lifecycle: Pick<SessionControl, 'interruptCurrentTurn'>,
    private readonly slash: LegacySlashCommands,
  ) {}

  setPermission(
    sessionId: SessionId,
    level: PermissionLevel,
    options?: SessionRuntimeControlOptions,
  ): Promise<AppliedSettings> {
    return this.serialize(sessionId, async () => {
      if (options && !this.sessions.find(sessionId)?.query) {
        await this.persistence.savePermission(sessionId, level, options);
        return { timing: 'nextTurn', revision: 0 };
      }
      const { session, query, state } = this.live(sessionId);
      const previous = session.permissionLevel;
      const apply = async (value: PermissionLevel) => {
        // YOLO keeps SDK callbacks active; the frontend level auto-approves tools.
        await query.setPermissionMode(PERMISSION_MODE_MAP[value]);
        session.permissionLevel = value;
      };
      await this.commit(
        sessionId,
        () => apply(level),
        () => options ? this.persistence.savePermission(sessionId, level, options) : this.persistence.savePermission(sessionId, level),
        () => apply(previous),
      );
      return { timing: 'effectiveNow', revision: ++state.revision };
    });
  }

  setModel(sessionId: SessionId, model: string, options?: SessionRuntimeControlOptions): Promise<AppliedSettings> {
    return this.serialize(sessionId, async () => {
      if (options && !this.sessions.find(sessionId)?.query) {
        await this.persistence.saveModel(sessionId, model, options);
        return { timing: 'nextTurn', revision: 0 };
      }
      const { session, query, state } = this.live(sessionId);
      const previous = session.currentModel;
      const resolved = model === '' ? '' : this.modelResolver.resolve(model);
      const apply = async (value: string) => {
        await query.setModel(value || undefined);
        session.currentModel = value;
      };
      await this.commit(
        sessionId,
        () => apply(resolved),
        () => options ? this.persistence.saveModel(sessionId, model, options) : this.persistence.saveModel(sessionId, model),
        () => apply(previous),
      );
      return { timing: 'effectiveNow', revision: ++state.revision };
    });
  }

  setEffort(
    sessionId: SessionId,
    effort: EffortLevel | undefined,
    options?: SessionRuntimeControlOptions,
  ): Promise<AppliedSettings> {
    return this.serialize(sessionId, async () => {
      if (options && !this.sessions.find(sessionId)?.query) {
        await this.persistence.saveEffort(sessionId, effort, options);
        return { timing: 'nextTurn', revision: 0 };
      }
      const { query, state } = this.live(sessionId);
      const previous = state.effort;
      // Preserve legacy live max as xhigh; persisted max takes full effect on
      // the next session start. Use the same mapping when restoring live state.
      const apply = (value: EffortLevel | undefined) =>
        query.applyFlagSettings({
          effortLevel: value === 'max' ? 'xhigh' : (value ?? null),
        });
      await this.commit(
        sessionId,
        () => apply(effort),
        () => options ? this.persistence.saveEffort(sessionId, effort, options) : this.persistence.saveEffort(sessionId, effort),
        () => apply(previous),
      );
      state.effort = effort;
      return {
        timing: effort === 'max' ? 'nextTurn' : 'effectiveNow',
        revision: ++state.revision,
      };
    });
  }

  interrupt(sessionId: SessionId): Promise<boolean> {
    return this.lifecycle.interruptCurrentTurn(sessionId);
  }

  compact(sessionId: SessionId): Promise<void> {
    return this.slash.executeSlashCommand(sessionId, '/compact');
  }

  private live(sessionId: SessionId) {
    const session = this.sessions.find(sessionId);
    if (!session?.query)
      throw new LegacySessionControlError('session-unavailable', sessionId);
    let state = this.state.get(session);
    if (!state) {
      state = { revision: 0, effort: session.config.effort };
      this.state.set(session, state);
    }
    return { session, query: session.query, state };
  }

  private async commit(
    sessionId: SessionId,
    apply: () => Promise<void>,
    save: () => Promise<void>,
    rollback: () => Promise<void>,
  ): Promise<void> {
    await apply();
    try {
      await save();
    } catch (saveError) {
      try {
        await rollback();
      } catch (rollbackError) {
        throw new LegacySessionControlError('rollback-failed', sessionId, [
          saveError,
          rollbackError,
        ]);
      }
      throw saveError;
    }
  }

  private serialize<T>(
    sessionId: SessionId,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.pending.get(sessionId) ?? Promise.resolve();
    // Previous errors remain visible to their caller; they don't poison the queue.
    const operation = previous.then(action, action);
    this.pending.set(sessionId, operation);
    const release = () => {
      if (this.pending.get(sessionId) === operation)
        this.pending.delete(sessionId);
    };
    void operation.then(release, release);
    return operation;
  }
}
