import 'reflect-metadata';
import { CodexChatAdapterError } from '@ptah-extension/agent-sdk';
import { resolve } from 'node:path';
import { SessionId, type FlatStreamEventUnion } from '@ptah-extension/shared';
import type { ISettingsStore } from '@ptah-extension/settings-core';
import {
  createNativeSessionControls,
  createLegacySessionControlPorts,
  type NativeSessionControlsDeps,
} from './native-session-controls';

describe('native session controls', () => {
  const id = SessionId.from('11111111-1111-4111-8111-111111111111');
  function harness() {
    const data = new Map<string, unknown>();
    const writeGlobal = jest.fn(async (key: string, value: unknown) => {
      if (value === undefined) data.delete(key);
      else data.set(key, value);
    });
    const store: ISettingsStore = {
      readGlobal: <T>(key: string) => data.get(key) as T | undefined,
      writeGlobal,
      readSecret: jest.fn(),
      writeSecret: jest.fn(),
      deleteSecret: jest.fn(),
      watchGlobal: jest.fn(),
      watchSecret: jest.fn(),
      flushSync: jest.fn(),
    };
    const adapter = {
      getSessionToken: jest.fn().mockReturnValue('generation-one'),
      setSessionModel: jest.fn().mockResolvedValue(undefined),
      setSessionEffort: jest.fn().mockResolvedValue(undefined),
      setSessionPermissionLevel: jest.fn().mockResolvedValue(undefined),
      canSendFollowUp: jest.fn().mockReturnValue(false),
      interruptCurrentTurn: jest.fn().mockResolvedValue(true),
      executeSlashCommand: jest.fn(),
    };
    const deps: NativeSessionControlsDeps = {
      store,
      adapter,
      appScope: 'app.electron',
      settings: () => ({
        workspacePath: resolve('/projects/session'),
        authKey: 'thirdParty.openai-codex',
        model: 'gpt-5',
        effort: 'low',
        permissionLevel: 'ask',
      }),
      broadcaster: { streamEventsToWebview: jest.fn() },
      tabId: () => 'tab',
    };
    return {
      deps,
      controls: createNativeSessionControls(deps),
      data,
      writeGlobal,
      adapter,
    };
  }
  it('writes effort exactly once and applies the native setter once', async () => {
    const h = harness();
    await expect(
      h.controls.setEffort(id, 'high', { applyTo: 'app' }),
    ).resolves.toEqual({ timing: 'nextTurn', revision: 1 });
    expect(h.writeGlobal).toHaveBeenCalledTimes(1);
    expect(h.writeGlobal).toHaveBeenCalledWith(
      'app.electron.provider.thirdParty.openai-codex.reasoningEffort',
      'high',
    );
    expect(h.adapter.setSessionEffort.mock.calls).toEqual([[id, 'high']]);
  });
  it('rolls failed effort saves back to the latest successful live value', async () => {
    const h = harness();
    await h.controls.setEffort(id, 'medium');
    h.writeGlobal.mockRejectedValueOnce(new Error('disk'));
    await expect(h.controls.setEffort(id, 'high')).rejects.toThrow('disk');
    expect(h.adapter.setSessionEffort.mock.calls).toEqual([
      [id, 'medium'],
      [id, 'high'],
      [id, 'medium'],
    ]);
  });
  it('applies a different permission level on an open thread and saves the autopilot chip', async () => {
    const h = harness();
    await expect(h.controls.setPermission(id, 'plan')).resolves.toEqual({
      timing: 'nextTurn',
      revision: 1,
    });
    expect(h.adapter.setSessionPermissionLevel.mock.calls).toEqual([
      [id, 'plan'],
    ]);
    expect(h.writeGlobal.mock.calls).toEqual([
      ['app.electron.autopilot.enabled', true],
      ['app.electron.autopilot.permissionLevel', 'plan'],
    ]);
    expect(h.data.get('app.electron.autopilot.permissionLevel')).toBe('plan');
    expect(h.data.get('app.electron.autopilot.enabled')).toBe(true);
  });
  it('rolls a failed permission save back to the previous open-thread level', async () => {
    const h = harness();
    await h.controls.setPermission(id, 'plan');
    h.writeGlobal.mockRejectedValueOnce(new Error('disk'));
    await expect(h.controls.setPermission(id, 'auto-edit')).rejects.toThrow(
      'disk',
    );
    expect(h.adapter.setSessionPermissionLevel.mock.calls).toEqual([
      [id, 'plan'],
      [id, 'auto-edit'],
      [id, 'plan'],
    ]);
    expect(h.data.get('app.electron.autopilot.permissionLevel')).toBe('plan');
    expect(h.data.get('app.electron.autopilot.enabled')).toBe(true);
  });
  it('restores absent permission keys instead of writing inherited values explicitly', async () => {
    const h = harness();
    h.data.set('autopilot.enabled', false);
    h.data.set('autopilot.permissionLevel', 'plan');
    const original = new Map(h.data);
    h.writeGlobal.mockImplementationOnce(async (key, value) => {
      h.data.set(key, value);
    });
    h.writeGlobal.mockRejectedValueOnce(new Error('second key failed'));
    await expect(
      h.controls.setPermission(id, 'yolo', { applyTo: 'app' }),
    ).rejects.toThrow('second key failed');
    expect(h.data).toEqual(original);
    expect(h.adapter.setSessionPermissionLevel.mock.calls).toEqual([
      [id, 'yolo'],
      [id, 'ask'],
    ]);
  });
  it('delegates follow-up gating and interrupt to the native adapter', async () => {
    const h = harness();
    expect(h.controls.canSendFollowUp(id)).toBe(false);
    expect(h.adapter.canSendFollowUp).toHaveBeenCalledWith(id);
    expect(await h.controls.interrupt(id)).toBe(true);
  });
  it('saves inactive sessions without attempting a live change', async () => {
    const h = harness();
    h.adapter.getSessionToken.mockReturnValue(null);
    await expect(h.controls.setModel(id, 'gpt-5.1')).resolves.toEqual({
      timing: 'nextTurn',
      revision: 0,
    });
    expect(h.writeGlobal).toHaveBeenCalledTimes(1);
    expect(h.adapter.setSessionModel).not.toHaveBeenCalled();
  });
  it('saves the next-open permission when a stale token points at an unavailable context', async () => {
    const h = harness();
    h.adapter.setSessionPermissionLevel.mockRejectedValueOnce(
      new CodexChatAdapterError('unavailable', 'permission'),
    );
    await expect(h.controls.setPermission(id, 'auto-edit')).resolves.toEqual({
      timing: 'nextTurn', revision: 0,
    });
    expect(h.data.get('app.electron.autopilot.permissionLevel')).toBe('auto-edit');
    expect(h.adapter.setSessionPermissionLevel).toHaveBeenCalledTimes(1);
  });
  it('surfaces a genuine permission update error without saving the level', async () => {
    const h = harness();
    const failure = new CodexChatAdapterError('runtime-failed', 'permission');
    h.adapter.setSessionPermissionLevel.mockRejectedValueOnce(failure);
    await expect(h.controls.setPermission(id, 'auto-edit')).rejects.toBe(failure);
    expect(h.data.has('app.electron.autopilot.permissionLevel')).toBe(false);
  });
  it.each(['native', 'legacy'] as const)(
    'passes the tab config and publishes the compact stream on the %s route',
    async (route) => {
      const h = harness();
      const event: FlatStreamEventUnion = {
        id: 'event',
        messageId: 'message',
        sessionId: id,
        timestamp: 1,
        eventType: 'message_complete',
      };
      const stream = (async function* () {
        yield event;
      })();
      h.adapter.executeSlashCommand.mockResolvedValue(stream);
      if (route === 'native') {
        await h.controls.compact(id);
      } else {
        const ports = createLegacySessionControlPorts({
          ...h.deps,
          sessions: { find: () => undefined },
          modelResolver: { resolve: (model) => model },
          lifecycle: { interruptCurrentTurn: h.adapter.interruptCurrentTurn },
        });
        await ports.slash.executeSlashCommand(id, '/compact');
      }
      expect(h.adapter.executeSlashCommand).toHaveBeenCalledWith(
        id,
        '/compact',
        { tabId: 'tab' },
      );
      expect(h.deps.broadcaster.streamEventsToWebview).toHaveBeenCalledWith(
        id,
        stream,
        'tab',
      );
    },
  );
  it('constructs legacy persistence with one effort write', async () => {
    const h = harness();
    const ports = createLegacySessionControlPorts({
      ...h.deps,
      sessions: { find: () => undefined },
      modelResolver: { resolve: (model) => model },
      lifecycle: { interruptCurrentTurn: h.adapter.interruptCurrentTurn },
    });
    await ports.persistence.saveEffort(id, 'max', { applyTo: 'global' });
    expect(h.writeGlobal.mock.calls).toEqual([
      ['provider.thirdParty.openai-codex.reasoningEffort', 'max'],
    ]);
  });
});
