import { TestBed } from '@angular/core/testing';
import { SessionMcpStatusRegistry } from '@ptah-extension/chat-state';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import { McpServerStatusService } from './mcp-server-status.service';

describe('McpServerStatusService recovery', () => {
  const rpc = { call: jest.fn() };

  beforeEach(() => {
    rpc.call.mockReset();
    TestBed.configureTestingModule({
      providers: [
        { provide: ClaudeRpcService, useValue: rpc },
        { provide: AppStateManager, useValue: {} },
      ],
    });
  });

  it('retries a failed read and retains a successfully recorded status', async () => {
    const service = TestBed.inject(McpServerStatusService);
    const record = jest.spyOn(TestBed.inject(SessionMcpStatusRegistry), 'record');
    rpc.call
      .mockResolvedValueOnce({ isSuccess: () => false })
      .mockResolvedValueOnce({
        isSuccess: () => true,
        data: { mcpServers: [{ name: 'smithery', status: 'connected' }], notices: [] },
      });

    await service.recover('session-1');
    expect(record).not.toHaveBeenCalled();
    await service.recover('session-1');
    expect(rpc.call).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledTimes(1);

    await service.recover('session-1');
    expect(rpc.call).toHaveBeenCalledTimes(2);
  });

  it('retries when a successful read contains no MCP status', async () => {
    const service = TestBed.inject(McpServerStatusService);
    const record = jest.spyOn(TestBed.inject(SessionMcpStatusRegistry), 'record');
    rpc.call
      .mockResolvedValueOnce({ isSuccess: () => true, data: {} })
      .mockResolvedValueOnce({
        isSuccess: () => true,
        data: { mcpServers: [], notices: [] },
      });

    await service.recover('session-2');
    expect(record).not.toHaveBeenCalled();
    await service.recover('session-2');
    expect(rpc.call).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledTimes(1);
  });
});
