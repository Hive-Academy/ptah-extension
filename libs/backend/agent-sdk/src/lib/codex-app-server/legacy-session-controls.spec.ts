import type { EffortLevel, SessionId } from '@ptah-extension/shared';
import {
  LegacySessionControls,
  type LegacyControlledSession,
} from './legacy-session-controls';

const id = 'session' as SessionId;

function setup(effort: EffortLevel = 'high') {
  const query = {
    setPermissionMode: jest.fn().mockResolvedValue(undefined),
    setModel: jest.fn().mockResolvedValue(undefined),
    applyFlagSettings: jest.fn().mockResolvedValue(undefined),
  };
  const session: LegacyControlledSession = {
    query,
    currentModel: 'old-model',
    permissionLevel: 'ask',
    config: { model: 'old-model', effort },
  };
  const sessions = {
    find: jest.fn((): LegacyControlledSession | undefined => session),
  };
  const persistence = {
    savePermission: jest.fn().mockResolvedValue(undefined),
    saveModel: jest.fn().mockResolvedValue(undefined),
    saveEffort: jest.fn().mockResolvedValue(undefined),
  };
  const resolver = {
    resolve: jest.fn((model: string) =>
      model === 'sonnet' ? 'claude-sonnet' : model,
    ),
  };
  const lifecycle = { interruptCurrentTurn: jest.fn().mockResolvedValue(true) };
  const slash = { executeSlashCommand: jest.fn().mockResolvedValue(undefined) };
  const controls = new LegacySessionControls(
    sessions,
    persistence,
    resolver,
    lifecycle,
    slash,
  );
  return {
    controls,
    query,
    session,
    sessions,
    persistence,
    resolver,
    lifecycle,
    slash,
  };
}

describe('LegacySessionControls', () => {
  it.each([
    ['ask', 'default'],
    ['plan', 'plan'],
    ['auto-edit', 'acceptEdits'],
    ['yolo', 'default'],
  ] as const)('applies live %s as %s before saving', async (level, mode) => {
    const { controls, query, session, persistence } = setup();
    persistence.savePermission.mockImplementation(async () => {
      expect(query.setPermissionMode).toHaveBeenCalledWith(mode);
      expect(session.permissionLevel).toBe(level);
    });
    await expect(controls.setPermission(id, level)).resolves.toEqual({
      timing: 'effectiveNow',
      revision: 1,
    });
    expect(persistence.savePermission).toHaveBeenCalledWith(id, level);
  });

  it('resolves models, clears the model override, and increments revisions', async () => {
    const { controls, query, resolver, persistence } = setup();
    await controls.setModel(id, 'sonnet');
    expect(query.setModel).toHaveBeenCalledWith('claude-sonnet');
    expect(persistence.saveModel).toHaveBeenCalledWith(id, 'sonnet');
    await expect(controls.setModel(id, '')).resolves.toEqual({
      timing: 'effectiveNow',
      revision: 2,
    });
    expect(query.setModel).toHaveBeenLastCalledWith(undefined);
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
  });

  it('clears effort with null in the SDK and undefined in persistence', async () => {
    const { controls, query, persistence } = setup();
    await controls.setEffort(id, undefined);
    expect(query.applyFlagSettings).toHaveBeenCalledWith({ effortLevel: null });
    expect(persistence.saveEffort).toHaveBeenCalledWith(id, undefined);
  });

  it('applies max as xhigh before persisting max with next-turn timing', async () => {
    const { controls, query, persistence } = setup();
    persistence.saveEffort.mockImplementation(async () => {
      expect(query.applyFlagSettings).toHaveBeenCalledWith({
        effortLevel: 'xhigh',
      });
    });
    await expect(controls.setEffort(id, 'max')).resolves.toEqual({
      timing: 'nextTurn',
      revision: 1,
    });
    expect(persistence.saveEffort).toHaveBeenCalledWith(id, 'max');
  });

  it('restores the previous effort when saving max fails', async () => {
    const { controls, query, persistence } = setup();
    persistence.saveEffort.mockRejectedValueOnce(new Error('save failed'));
    await expect(controls.setEffort(id, 'max')).rejects.toThrow('save failed');
    expect(query.applyFlagSettings.mock.calls).toEqual([
      [{ effortLevel: 'xhigh' }],
      [{ effortLevel: 'high' }],
    ]);
    await expect(controls.setEffort(id, 'low')).resolves.toEqual({
      timing: 'effectiveNow',
      revision: 1,
    });
  });

  it.each(['initial', 'committed'] as const)(
    'restores %s max as xhigh after a failed lower-effort save',
    async (source) => {
      const { controls, query, persistence } = setup(
        source === 'initial' ? 'max' : 'high',
      );
      if (source === 'committed') await controls.setEffort(id, 'max');
      query.applyFlagSettings.mockClear();
      persistence.saveEffort.mockRejectedValueOnce(new Error('save failed'));
      await expect(controls.setEffort(id, 'low')).rejects.toThrow('save failed');
      expect(query.applyFlagSettings.mock.calls).toEqual([
        [{ effortLevel: 'low' }],
        [{ effortLevel: 'xhigh' }],
      ]);
      await expect(controls.setEffort(id, 'low')).resolves.toEqual({
        timing: 'effectiveNow',
        revision: source === 'initial' ? 1 : 2,
      });
      expect(query.applyFlagSettings).toHaveBeenLastCalledWith({
        effortLevel: 'low',
      });
      expect(persistence.saveEffort).toHaveBeenLastCalledWith(id, 'low');
    },
  );

  it('restores YOLO callback mode and frontend level after a failed permission save', async () => {
    const { controls, query, session, persistence } = setup();
    await controls.setPermission(id, 'yolo');
    query.setPermissionMode.mockClear();
    persistence.savePermission.mockRejectedValueOnce(new Error('save failed'));
    await expect(controls.setPermission(id, 'plan')).rejects.toThrow(
      'save failed',
    );
    expect(query.setPermissionMode.mock.calls).toEqual([['plan'], ['default']]);
    expect(session.permissionLevel).toBe('yolo');
  });

  it('rolls permission back after a save failure and does not advance revision', async () => {
    const { controls, query, session, persistence } = setup();
    session.permissionLevel = 'plan';
    persistence.savePermission.mockRejectedValueOnce(new Error('save failed'));
    await expect(controls.setPermission(id, 'yolo')).rejects.toThrow(
      'save failed',
    );
    expect(query.setPermissionMode.mock.calls).toEqual([
      ['default'],
      ['plan'],
    ]);
    expect(session.permissionLevel).toBe('plan');
    await expect(controls.setPermission(id, 'plan')).resolves.toEqual({
      timing: 'effectiveNow',
      revision: 1,
    });
  });

  it('rolls the model back after a save failure', async () => {
    const { controls, query, session, persistence } = setup();
    persistence.saveModel.mockRejectedValue(new Error('save failed'));
    await expect(controls.setModel(id, 'new-model')).rejects.toThrow(
      'save failed',
    );
    expect(query.setModel.mock.calls).toEqual([['new-model'], ['old-model']]);
    expect(session.currentModel).toBe('old-model');
  });

  it('rolls effort back to the last committed live value, including a cleared override', async () => {
    const { controls, query, persistence } = setup();
    await controls.setEffort(id, undefined);
    persistence.saveEffort.mockRejectedValue(new Error('save failed'));
    await expect(controls.setEffort(id, 'low')).rejects.toThrow('save failed');
    expect(query.applyFlagSettings.mock.calls).toEqual([
      [{ effortLevel: null }],
      [{ effortLevel: 'low' }],
      [{ effortLevel: null }],
    ]);
  });

  it.each(['permission', 'model', 'effort'] as const)(
    'does not save after a live %s failure',
    async (setting) => {
      const { controls, query, persistence } = setup();
      query.setPermissionMode.mockRejectedValue(new Error('live failed'));
      query.setModel.mockRejectedValue(new Error('live failed'));
      query.applyFlagSettings.mockRejectedValue(new Error('live failed'));
      const action =
        setting === 'permission'
          ? controls.setPermission(id, 'plan')
          : setting === 'model'
            ? controls.setModel(id, 'new')
            : controls.setEffort(id, 'low');
      await expect(action).rejects.toThrow('live failed');
      for (const save of Object.values(persistence))
        expect(save).not.toHaveBeenCalled();
    },
  );

  it('surfaces both save and rollback failures', async () => {
    const { controls, query, persistence } = setup();
    const save = new Error('save');
    const rollback = new Error('rollback');
    persistence.saveModel.mockRejectedValue(save);
    query.setModel
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(rollback);
    await expect(controls.setModel(id, 'new')).rejects.toMatchObject({
      code: 'rollback-failed',
      failures: [save, rollback],
    });
  });

  it('serializes changes so a failed save cannot roll back a newer success', async () => {
    const { controls, query, persistence } = setup();
    persistence.saveModel.mockRejectedValueOnce(new Error('save'));
    const first = controls.setModel(id, 'first');
    const second = controls.setModel(id, 'second');
    await expect(first).rejects.toThrow('save');
    await expect(second).resolves.toEqual({
      timing: 'effectiveNow',
      revision: 1,
    });
    expect(query.setModel.mock.calls).toEqual([
      ['first'],
      ['old-model'],
      ['second'],
    ]);
  });

  it('rejects absent sessions and uses the existing lifecycle and slash ports', async () => {
    const { controls, sessions, lifecycle, slash } = setup();
    sessions.find.mockReturnValue(undefined);
    await expect(controls.setModel(id, 'model')).rejects.toMatchObject({
      code: 'session-unavailable',
    });
    await expect(controls.interrupt(id)).resolves.toBe(true);
    await controls.compact(id);
    expect(lifecycle.interruptCurrentTurn).toHaveBeenCalledWith(id);
    expect(slash.executeSlashCommand).toHaveBeenCalledWith(id, '/compact');
  });
});
