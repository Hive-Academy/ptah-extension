import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import { type ArtifactRecord } from '@ptah-extension/shared';
import { ArtifactMessageHandler } from './artifact-message-handler.service';
import { ArtifactStore } from './artifact.store';

const payload: ArtifactRecord = {
  id: 'abcdefghijklmnop',
  title: 'Preview',
  revision: 1,
  sessionId: 'session-a',
  viewerUrl: 'ptah-artifact://abcdefghijklmnop/index.html',
  createdAt: '2026-10-20T12:00:00.000Z',
};

describe('ArtifactMessageHandler', () => {
  const order: string[] = [];
  const upsert = jest.fn(() => order.push('upsert'));
  const requestAutoOpen = jest.fn();
  const call = jest.fn();
  let handler: ArtifactMessageHandler;

  beforeEach(() => {
    order.length = 0;
    upsert.mockClear();
    requestAutoOpen.mockReset();
    call.mockReset();
    call.mockImplementation(async () => {
      order.push('settings:get');
      return { success: true, data: { success: true, value: true } };
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: ArtifactStore, useValue: { upsert, requestAutoOpen } },
        { provide: ClaudeRpcService, useValue: { call } },
      ],
    });
    handler = TestBed.inject(ArtifactMessageHandler);
  });

  it('upserts valid metadata first, then requests auto-open when the setting is on', async () => {
    await handler.handleMessage({ type: 'artifact:published', payload });
    expect(upsert).toHaveBeenCalledWith(payload);
    expect(call).toHaveBeenCalledWith(
      'settings:get',
      { key: 'display.autoOpenArtifacts' },
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(order).toEqual(['upsert', 'settings:get']);
    expect(requestAutoOpen).toHaveBeenCalledWith(payload);
  });

  it('upserts without an auto-open request when the setting is off', async () => {
    call.mockResolvedValue({
      success: true,
      data: { success: true, value: false },
    });
    await handler.handleMessage({ type: 'artifact:published', payload });
    expect(upsert).toHaveBeenCalledWith(payload);
    expect(requestAutoOpen).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a failed RPC',
      () => call.mockResolvedValue({ success: false, error: 'down' }),
    ],
    ['a rejected RPC', () => call.mockRejectedValue(new Error('timeout'))],
    [
      'an unset value',
      () => call.mockResolvedValue({ success: true, data: { success: true } }),
    ],
  ])('uses the default (on) after %s', async (_label, arrange) => {
    arrange();
    await handler.handleMessage({ type: 'artifact:published', payload });
    expect(upsert).toHaveBeenCalledWith(payload);
    expect(requestAutoOpen).toHaveBeenCalledWith(payload);
  });

  it('keeps publish order when an older settings read resolves last', async () => {
    const reads: Array<() => void> = [];
    call.mockImplementation(
      () =>
        new Promise((resolve) => {
          reads.push(() =>
            resolve({ success: true, data: { success: true, value: true } }),
          );
        }),
    );
    const newer: ArtifactRecord = {
      ...payload,
      id: 'bcdefghijklmnopq',
      title: 'Newer',
    };
    const first = handler.handleMessage({
      type: 'artifact:published',
      payload,
    });
    const second = handler.handleMessage({
      type: 'artifact:published',
      payload: newer,
    });
    for (let i = 0; i < 50 && reads.length < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(reads).toHaveLength(2);
    reads[1]();
    await second;
    reads[0]();
    await first;
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(requestAutoOpen).toHaveBeenCalledTimes(1);
    expect(requestAutoOpen).toHaveBeenCalledWith(newer);
  });

  it('drops malformed and unexpected messages', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    await handler.handleMessage({
      type: 'artifact:published',
      payload: { html: '<script>bad</script>' },
    });
    await handler.handleMessage({ type: 'unrelated', payload: {} });
    expect(upsert).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
    expect(requestAutoOpen).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
