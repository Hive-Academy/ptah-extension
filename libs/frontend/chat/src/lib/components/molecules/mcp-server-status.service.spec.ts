import { TestBed } from '@angular/core/testing';
import { SessionMcpStatusRegistry } from '@ptah-extension/chat-state';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import type { SessionMcpNotice } from '@ptah-extension/shared';
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

  it('retries a failed read and records a successful one', async () => {
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
  });

  it('deduplicates concurrent reads and keeps no id after the read', async () => {
    const service = TestBed.inject(McpServerStatusService);
    rpc.call.mockResolvedValue({ isSuccess: () => true, data: { mcpServers: [], notices: [] } });

    await Promise.all([service.recover('session-3'), service.recover('session-3')]);
    expect(rpc.call).toHaveBeenCalledTimes(1);
    // A later recover (e.g. after the session's status was cleared) reads again.
    await service.recover('session-3');
    expect(rpc.call).toHaveBeenCalledTimes(2);
  });

  it('refreshes the provider name after a provider switch', async () => {
    const service = TestBed.inject(McpServerStatusService);
    const disabled: SessionMcpNotice[] = [{ code: 'claude-ai-connectors-disabled', message: 'Connectors are off.' }];
    const status = (id: string) => ({
      isSuccess: () => true,
      data: { anthropicProviderId: id, availableProviders: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }] },
    });
    rpc.call.mockResolvedValueOnce(status('a')).mockResolvedValueOnce(status('b'));

    await service.loadProviderName(disabled);
    expect(service.providerName()).toBe('Alpha');
    await service.loadProviderName(disabled);
    expect(service.providerName()).toBe('Beta');
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
