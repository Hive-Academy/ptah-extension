/**
 * GatewayRpcService — RPC roundtrip tests.
 *
 * Stubs `ClaudeRpcService.call` so we exercise only the wire-level concerns:
 * method name, payload shape, success-data unwrap, error throw.
 */
import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import { GatewayRpcService } from './gateway-rpc.service';

describe('GatewayRpcService', () => {
  let service: GatewayRpcService;
  let rpcCall: jest.Mock;

  beforeEach(() => {
    rpcCall = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        GatewayRpcService,
        {
          provide: ClaudeRpcService,
          useValue: { call: rpcCall as unknown as ClaudeRpcService['call'] },
        },
      ],
    });
    service = TestBed.inject(GatewayRpcService);
  });

  const okResult = <T>(data: T) => ({
    success: true,
    isSuccess: () => true,
    data,
  });
  const errResult = (error: string) => ({
    success: false,
    isSuccess: () => false,
    error,
  });

  it('status() calls gateway:status with empty params and returns data', async () => {
    const payload = { enabled: false, adapters: [] };
    rpcCall.mockResolvedValue(okResult(payload));

    const result = await service.status();

    expect(rpcCall).toHaveBeenCalledWith(
      'gateway:status',
      {},
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(result).toEqual(payload);
  });

  it('start() omits platform when not provided', async () => {
    rpcCall.mockResolvedValue(okResult({ ok: true }));

    await service.start();

    expect(rpcCall).toHaveBeenCalledWith(
      'gateway:start',
      {},
      expect.any(Object),
    );
  });

  it('start(platform) forwards the platform parameter', async () => {
    rpcCall.mockResolvedValue(okResult({ ok: true }));

    await service.start('telegram');

    expect(rpcCall).toHaveBeenCalledWith(
      'gateway:start',
      { platform: 'telegram' },
      expect.any(Object),
    );
  });

  it('setToken() forwards platform + token (and optional slackAppToken)', async () => {
    rpcCall.mockResolvedValue(okResult({ ok: true }));

    await service.setToken({
      platform: 'slack',
      token: 'xoxb-redacted',
      slackAppToken: 'xapp-redacted',
    });

    expect(rpcCall).toHaveBeenCalledWith(
      'gateway:setToken',
      {
        platform: 'slack',
        token: 'xoxb-redacted',
        slackAppToken: 'xapp-redacted',
      },
      expect.any(Object),
    );
  });

  it('test(platform) — happy path returns the structured success result', async () => {
    const payload = {
      ok: true,
      bindingId: 'b-1',
      externalMsgId: 'msg-1',
    };
    rpcCall.mockResolvedValue(okResult(payload));

    const result = await service.test('telegram');

    expect(rpcCall).toHaveBeenCalledWith(
      'gateway:test',
      { platform: 'telegram' },
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(result).toEqual(payload);
  });

  it('test(platform, bindingId) forwards the optional bindingId', async () => {
    rpcCall.mockResolvedValue(
      okResult({ ok: true, bindingId: 'b-2', externalMsgId: 'msg-2' }),
    );

    await service.test('discord', 'b-2');

    expect(rpcCall).toHaveBeenCalledWith(
      'gateway:test',
      { platform: 'discord', bindingId: 'b-2' },
      expect.any(Object),
    );
  });

  it('throws with the RPC error string when test fails at the transport layer', async () => {
    rpcCall.mockResolvedValue(errResult('timeout'));

    await expect(service.test('telegram')).rejects.toThrow('timeout');
  });
});
