import 'reflect-metadata';
import { createMockRpcHandler } from './rpc-handler.mock';

describe('createMockRpcHandler', () => {
  it('records registrations and routes handleMessage through them', async () => {
    const mock = createMockRpcHandler();

    mock.registerMethod('session:list', async (params: unknown) => ({
      echoed: params,
    }));

    const ok = await mock.handleMessage({
      method: 'session:list',
      params: { workspace: '/tmp' },
      correlationId: 'corr-1',
    });

    expect(ok.success).toBe(true);
    expect(ok.correlationId).toBe('corr-1');
    expect(ok.data).toEqual({ echoed: { workspace: '/tmp' } });

    const missing = await mock.handleMessage({
      method: 'chat:unknown',
      params: {},
      correlationId: 'corr-2',
    });
    expect(missing.success).toBe(false);
    expect(missing.error).toMatch(/Method not found/);

    expect(mock.getRegisteredMethods()).toContain('session:list');
    mock.unregisterMethod('session:list');
    expect(mock.getRegisteredMethods()).not.toContain('session:list');
  });
});
