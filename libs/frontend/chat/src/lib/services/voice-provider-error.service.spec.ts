import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { VoiceProviderErrorPayload } from '@ptah-extension/shared';
import { TestBed } from '@angular/core/testing';
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

  beforeEach(() => {
    upsert.mockClear();
    resolve.mockClear();
    dismissPresentation.mockClear();
    warn.mockClear();
    rpc = createMockRpcService();
    TestBed.configureTestingModule({ providers: [VoiceProviderErrorService,
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

  it('logs a thrown switch error and keeps the notice', async () => {
    rpc.call.mockRejectedValue(new TypeError('private diagnostic'));
    service.handleMessage({ type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR, payload: payload() });
    const item = upsert.mock.calls[0][0];
    expect(await service.switchToLocal(item.key, item.generation)).toBe(false);
    expect(warn).toHaveBeenCalledWith('VoiceProviderErrorService', 'Switch to local failed (TypeError)');
    expect(resolve).not.toHaveBeenCalledWith(item.key, item.generation, 'chat');
  });
});
