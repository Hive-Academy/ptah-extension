import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { VoiceProviderErrorPayload } from '@ptah-extension/shared';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService, LoggingService, NotificationService } from '@ptah-extension/core';
import { createMockRpcService, rpcError, rpcSuccess } from '@ptah-extension/core/testing';

import { VoiceProviderErrorService } from './voice-provider-error.service';

function payload(
  overrides: Partial<VoiceProviderErrorPayload> = {},
): VoiceProviderErrorPayload {
  return {
    direction: 'tts',
    providerId: 'elevenlabs',
    category: 'auth',
    message: 'invalid key',
    ...overrides,
  };
}

describe('VoiceProviderErrorService', () => {
  let service: VoiceProviderErrorService;
  const upsert = jest.fn();
  const resolve = jest.fn();
  const dismissPresentation = jest.fn();
  const warn = jest.fn();
  let rpc: ReturnType<typeof createMockRpcService>;
  let workspacePath: string;

  beforeEach(() => {
    upsert.mockClear();
    resolve.mockClear();
    dismissPresentation.mockClear();
    warn.mockClear();
    workspacePath = '';
    rpc = createMockRpcService();
    TestBed.configureTestingModule({ providers: [VoiceProviderErrorService,
      { provide: TabManagerService, useValue: { get activeWorkspacePath() { return workspacePath; } } },
      { provide: NotificationService, useValue: { upsert, resolve, dismissPresentation } },
      { provide: ClaudeRpcService, useValue: rpc },
      { provide: LoggingService, useValue: { warn } },
    ] });
    service = TestBed.inject(VoiceProviderErrorService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('declares the VOICE_PROVIDER_ERROR message type', () => {
    expect(service.handledMessageTypes).toEqual([
      MESSAGE_TYPES.VOICE_PROVIDER_ERROR,
    ]);
  });

  it('captures the latest error payload from a matching message', () => {
    service.handleMessage({
      type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR,
      payload: payload({ category: 'quota', message: 'quota exceeded' }),
    });
    expect(service.latestError()?.category).toBe('quota');
    expect(service.latestError()?.message).toBe('quota exceeded');
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'failure', severity: 'error', context: 'quota exceeded',
      actions: [{ id: 'switch-to-local', label: 'Switch to local' }],
    }));
  });

  it('updates repeated speech-to-text errors under one notice key', () => {
    service.handleMessage({ type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR, payload: payload({ direction: 'stt', message: 'first failure' }) });
    service.handleMessage({ type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR, payload: payload({ direction: 'stt', message: 'second failure' }) });

    const first = upsert.mock.calls[0][0];
    const second = upsert.mock.calls[1][0];
    expect(second.key).toBe(first.key);
    expect(second.generation).toBe(first.generation + 1);
    expect(second.presentationKey).not.toBe(first.presentationKey);
    expect(second.context).toBe('second failure');
    expect(resolve).not.toHaveBeenCalled();
    expect(service.canHandle(second.key, 'switch-to-local')).toBe(true);
    expect(service.latestError()?.message).toBe('second failure');
  });

  it('keeps separate notice keys for speech-to-text and text-to-speech errors', () => {
    service.handleMessage({ type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR, payload: payload({ direction: 'stt' }) });
    service.handleMessage({ type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR, payload: payload({ direction: 'tts' }) });

    expect(upsert.mock.calls[0][0].key).not.toBe(upsert.mock.calls[1][0].key);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('lets both direction notices switch their own provider', async () => {
    rpc.call.mockResolvedValue(rpcSuccess({ ok: true }));
    service.handleMessage({ type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR, payload: payload({ direction: 'stt' }) });
    service.handleMessage({ type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR, payload: payload({ direction: 'tts' }) });
    const stt = upsert.mock.calls[0][0];
    const tts = upsert.mock.calls[1][0];

    expect(service.canHandle(stt.key, 'switch-to-local')).toBe(true);
    expect(service.canHandle(tts.key, 'switch-to-local')).toBe(true);
    expect(await service.run(stt.key, stt.generation, 'switch-to-local')).toEqual({ kind: 'completed' });
    expect(rpc.call).toHaveBeenCalledWith('voice:setProviderConfig', { sttProvider: 'local' });
    expect(service.latestError()?.direction).toBe('tts');
    expect(await service.run(tts.key, tts.generation, 'switch-to-local')).toEqual({ kind: 'completed' });
    expect(rpc.call).toHaveBeenCalledWith('voice:setProviderConfig', { ttsProvider: 'local' });
    expect(resolve).toHaveBeenCalledWith(stt.key, stt.generation, 'chat');
    expect(resolve).toHaveBeenCalledWith(tts.key, tts.generation, 'chat');
  });

  it('reports an unavailable action for a notice from another workspace', async () => {
    workspacePath = 'C:/first';
    service.handleMessage({ type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR, payload: payload({ direction: 'stt' }) });
    const first = upsert.mock.calls[0][0];
    workspacePath = 'C:/second';
    service.handleMessage({ type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR, payload: payload({ direction: 'stt' }) });
    const second = upsert.mock.calls[1][0];

    expect(first.key).not.toBe(second.key);
    expect(service.canHandle(first.key, 'switch-to-local')).toBe(true);
    expect(await service.run(first.key, first.generation, 'switch-to-local')).toEqual({
      kind: 'unavailable', reason: 'Open the notice workspace to switch its voice provider',
    });
    expect(rpc.call).not.toHaveBeenCalled();
    rpc.call.mockResolvedValue(rpcSuccess({ ok: true }));
    expect(await service.run(second.key, second.generation, 'switch-to-local')).toEqual({ kind: 'completed' });
  });

  it('ignores unrelated message types and missing payloads', () => {
    service.handleMessage({ type: 'something:else', payload: payload() });
    expect(service.latestError()).toBeNull();

    service.handleMessage({ type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR });
    expect(service.latestError()).toBeNull();
  });

  it('clears the error on dismiss', () => {
    service.handleMessage({
      type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR,
      payload: payload(),
    });
    expect(service.latestError()).not.toBeNull();

    service.dismiss();
    expect(service.latestError()).toBeNull();
    expect(dismissPresentation).toHaveBeenCalledTimes(1);
  });

  it('switches the failing direction and resolves only after success', async () => {
    rpc.call.mockResolvedValue(rpcSuccess({ ok: true }));
    service.handleMessage({ type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR, payload: payload({ direction: 'stt' }) });
    const item = upsert.mock.calls[0][0];
    expect(await service.switchToLocal(item.key, item.generation)).toBe(true);
    expect(rpc.call).toHaveBeenCalledWith('voice:setProviderConfig', { sttProvider: 'local' });
    expect(rpc.call).toHaveBeenCalledWith('voice:getProviderConfig', {});
    expect(resolve).toHaveBeenCalledWith(item.key, item.generation, 'chat');
  });

  it('handles only its current switch action and rejects an old generation', async () => {
    rpc.call.mockResolvedValue(rpcSuccess({ ok: true }));
    service.handleMessage({ type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR, payload: payload() });
    const item = upsert.mock.calls[0][0];
    expect(service.canHandle(item.key, 'switch-to-local')).toBe(true);
    expect(service.canHandle(item.key, 'deny')).toBe(false);
    expect(service.canHandle('other', 'switch-to-local')).toBe(false);
    expect(await service.run(item.key, item.generation - 1, 'switch-to-local')).toEqual({ kind: 'stale' });
    expect(rpc.call).not.toHaveBeenCalled();
    expect(await service.run(item.key, item.generation, 'switch-to-local')).toEqual({ kind: 'completed' });
  });

  it('keeps the notice actionable when switching fails', async () => {
    rpc.call.mockResolvedValue(rpcError('backend down'));
    service.handleMessage({ type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR, payload: payload() });
    const item = upsert.mock.calls[0][0];
    expect(await service.switchToLocal(item.key, item.generation)).toBe(false);
    expect(service.switchError()).toBe('Could not switch to local provider');
    expect(resolve).not.toHaveBeenCalled();
    expect(await service.run(item.key, item.generation, 'switch-to-local')).toEqual({ kind: 'unavailable', reason: 'Could not switch to local provider' });
  });

  it('keeps the notice when provider config cannot be refreshed', async () => {
    rpc.call.mockResolvedValueOnce(rpcSuccess({ ok: true })).mockResolvedValueOnce(rpcError('refresh failed'));
    service.handleMessage({ type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR, payload: payload() });
    const item = upsert.mock.calls[0][0];
    expect(await service.run(item.key, item.generation, 'switch-to-local')).toEqual({ kind: 'unavailable', reason: 'Could not switch to local provider' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('keeps a newer provider error tracked when an older switch completes', async () => {
    let finishSwitch: ((value: ReturnType<typeof rpcSuccess<{ ok: boolean }>>) => void) | undefined;
    rpc.call.mockImplementationOnce(() => new Promise(resolve => { finishSwitch = resolve; }))
      .mockResolvedValue(rpcSuccess({ ok: true }));
    service.handleMessage({ type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR, payload: payload({ direction: 'stt' }) });
    const old = upsert.mock.calls[0][0];
    const switching = service.switchToLocal(old.key, old.generation);
    service.handleMessage({ type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR, payload: payload({ direction: 'tts', message: 'new failure' }) });
    const next = upsert.mock.calls[1][0];
    finishSwitch?.(rpcSuccess({ ok: true }));
    expect(await switching).toBe(true);
    expect(service.latestError()?.message).toBe('new failure');
    expect(service.canHandle(next.key, 'switch-to-local')).toBe(true);
    expect(resolve).toHaveBeenCalledWith(old.key, old.generation, 'chat');
  });

  it('keeps a newer error tracked when an older switch completes for the same direction', async () => {
    let finishSwitch: ((value: ReturnType<typeof rpcSuccess<{ ok: boolean }>>) => void) | undefined;
    rpc.call.mockImplementationOnce(() => new Promise(resolve => { finishSwitch = resolve; }))
      .mockResolvedValue(rpcSuccess({ ok: true }));
    service.handleMessage({ type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR, payload: payload({ direction: 'stt' }) });
    const old = upsert.mock.calls[0][0];
    const switching = service.switchToLocal(old.key, old.generation);
    service.handleMessage({ type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR, payload: payload({ direction: 'stt', message: 'new failure' }) });
    const next = upsert.mock.calls[1][0];
    finishSwitch?.(rpcSuccess({ ok: true }));

    expect(await switching).toBe(true);
    expect(next.key).toBe(old.key);
    expect(next.generation).toBe(old.generation + 1);
    expect(service.latestError()?.message).toBe('new failure');
    expect(service.canHandle(next.key, 'switch-to-local')).toBe(true);
    expect(resolve).toHaveBeenCalledWith(old.key, old.generation, 'chat');
  });

  it('logs a thrown switch error and keeps the notice', async () => {
    rpc.call.mockRejectedValue(new TypeError('private diagnostic'));
    service.handleMessage({ type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR, payload: payload() });
    const item = upsert.mock.calls[0][0];
    expect(await service.switchToLocal(item.key, item.generation)).toBe(false);
    expect(warn).toHaveBeenCalledWith('VoiceProviderErrorService', 'Switch to local failed (TypeError)');
    expect(resolve).not.toHaveBeenCalledWith(item.key, item.generation, 'chat');
  });
});

describe('VoiceProviderErrorService notice presentation', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('re-presents a dismissed direction on a new error without duplicating or replaying the same generation', () => {
    TestBed.configureTestingModule({ providers: [VoiceProviderErrorService,
      NotificationService,
      { provide: ClaudeRpcService, useValue: createMockRpcService() },
      { provide: LoggingService, useValue: { warn: jest.fn() } },
    ] });
    const service = TestBed.inject(VoiceProviderErrorService);
    const notifications = TestBed.inject(NotificationService);

    service.handleMessage({ type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR, payload: payload({ direction: 'stt' }) });
    const first = notifications.snackbars()[0];
    service.dismiss();
    expect(notifications.snackbars()).toHaveLength(0);

    service.handleMessage({ type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR, payload: payload({ direction: 'stt', message: 'again' }) });
    const second = notifications.snackbars()[0];
    expect(second.key).toBe(first.key);
    expect(second.presentationKey).not.toBe(first.presentationKey);
    expect(notifications.snackbars()).toHaveLength(1);
    expect(notifications.recentNotices()).toHaveLength(1);
    expect(notifications.soundCue()).toBeNull();

    notifications.upsert(second);
    expect(notifications.snackbars()).toEqual([second]);
    expect(notifications.soundCue()).toBeNull();
    service.dismiss();
    notifications.upsert(second);
    expect(notifications.snackbars()).toHaveLength(0);
  });
});
