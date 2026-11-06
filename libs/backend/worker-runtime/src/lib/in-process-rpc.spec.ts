import { WORKER_ERROR_MESSAGES } from '@ptah-extension/worker-protocol';
import { InProcessRpc, IN_PROCESS_SPECS } from './in-process-rpc';

describe('InProcessRpc', () => {
  it.each(['chat:start', 'chat:continue', 'chat:abort'] as const)(
    '%s treats nested failure as a failure',
    async (method) => {
      const handler = {
        handleMessage: jest.fn(async () => ({
          success: true,
          data: {
            success: false,
            errorCode: 'AUTH_REQUIRED',
            error: '/secret/path',
          },
        })),
      };
      const rpc = new InProcessRpc(handler);
      const result = await rpc.call(
        method,
        {} as never,
        IN_PROCESS_SPECS[method] as never,
      );
      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'NO_PROVIDER_READY',
          message: WORKER_ERROR_MESSAGES.NO_PROVIDER_READY,
        }),
      });
      expect(JSON.stringify(result)).not.toContain('/secret/path');
    },
  );

  it('validates session:list result shape', async () => {
    const rpc = new InProcessRpc({
      handleMessage: async () => ({ success: true, data: { sessions: 'bad' } }),
    });
    const result = await rpc.call(
      'session:list',
      {} as never,
      IN_PROCESS_SPECS['session:list'] as never,
    );
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'INTERNAL' }),
    });
  });

  it('logs redacted raw errors and returns only fixed copy', async () => {
    const log = jest.fn();
    const rpc = new InProcessRpc(
      {
        handleMessage: async () => ({
          success: false,
          errorCode: 'UNKNOWN',
          error: 'provider secret at /home/user',
        }),
      },
      log,
    );
    const result = await rpc.call(
      'chat:abort',
      {} as never,
      IN_PROCESS_SPECS['chat:abort'] as never,
    );
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: 'INTERNAL',
        message: WORKER_ERROR_MESSAGES.INTERNAL,
        ref: expect.any(String),
      }),
    });
    expect(JSON.stringify(result)).not.toContain('/home/user');
    expect(log).toHaveBeenCalledTimes(1);
  });
});
