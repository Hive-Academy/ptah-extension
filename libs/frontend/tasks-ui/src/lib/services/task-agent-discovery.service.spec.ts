import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import { TaskAgentDiscoveryService } from './task-agent-discovery.service';

const ok = <T>(data: T) => ({ success: true, isSuccess: () => true, data });
const fail = (error: string) => ({
  success: false,
  isSuccess: () => false,
  error,
});

describe('TaskAgentDiscoveryService', () => {
  let service: TaskAgentDiscoveryService;
  let rpcCall: jest.Mock;

  beforeEach(() => {
    rpcCall = jest.fn((method: string) => {
      if (method === 'autocomplete:agents') {
        return Promise.resolve(
          ok({
            agents: [
              {
                name: 'frontend-developer',
                description: 'Implements frontend work.',
                scope: 'project' as const,
              },
            ],
          }),
        );
      }
      return Promise.resolve(
        ok({
          clis: [
            {
              cli: 'codex' as const,
              installed: true,
              version: '1.2.3',
              messagingMode: 'steer' as const,
            },
            {
              cli: 'cursor' as const,
              installed: false,
              messagingMode: 'none' as const,
            },
          ],
        }),
      );
    });

    TestBed.configureTestingModule({
      providers: [
        TaskAgentDiscoveryService,
        {
          provide: ClaudeRpcService,
          useValue: { call: rpcCall as unknown as ClaudeRpcService['call'] },
        },
      ],
    });
    service = TestBed.inject(TaskAgentDiscoveryService);
  });

  it('loads specialists and installed CLI lanes after the orchestrator', async () => {
    await service.load();

    expect(rpcCall).toHaveBeenCalledWith('autocomplete:agents', { query: '' });
    expect(rpcCall).toHaveBeenCalledWith('agent:detectClis', undefined);
    expect(service.availableAgents()).toEqual([
      expect.objectContaining({ id: 'orchestrator', category: 'orchestrator' }),
      expect.objectContaining({
        id: 'specialist:frontend-developer',
        category: 'specialist',
        role: 'frontend-developer',
      }),
      expect.objectContaining({
        id: 'lane:codex',
        category: 'lane',
        cli: 'codex',
      }),
    ]);
  });

  it('caches the roster after the first load', async () => {
    await service.load();
    await service.load();

    expect(rpcCall).toHaveBeenCalledTimes(2);
  });

  it('keeps specialists when CLI detection fails', async () => {
    rpcCall.mockImplementation((method: string) => {
      if (method === 'autocomplete:agents') {
        return Promise.resolve(
          ok({
            agents: [
              {
                name: 'frontend-developer',
                description: 'Implements frontend work.',
                scope: 'project' as const,
              },
            ],
          }),
        );
      }
      return Promise.resolve(fail('CLI_DETECTION_FAILED'));
    });

    await service.load();

    expect(service.availableAgents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'orchestrator' }),
        expect.objectContaining({
          id: 'specialist:frontend-developer',
          role: 'frontend-developer',
        }),
      ]),
    );
  });

  it('keeps CLI lanes when agent discovery fails', async () => {
    rpcCall.mockImplementation((method: string) =>
      Promise.resolve(
        method === 'autocomplete:agents'
          ? fail('AGENT_SCAN_FAILED')
          : ok({
              clis: [
                {
                  cli: 'codex' as const,
                  installed: true,
                  messagingMode: 'steer' as const,
                },
              ],
            }),
      ),
    );

    await service.load();

    expect(service.availableAgents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'orchestrator' }),
        expect.objectContaining({ id: 'lane:codex', cli: 'codex' }),
      ]),
    );
  });

  it('handles a successful CLI response with no clis field', async () => {
    rpcCall.mockImplementation((method: string) => {
      if (method === 'autocomplete:agents') {
        return Promise.resolve(
          ok({
            agents: [
              {
                name: 'frontend-developer',
                description: 'Implements frontend work.',
                scope: 'project' as const,
              },
            ],
          }),
        );
      }
      return Promise.resolve(ok({}));
    });

    await expect(service.load()).resolves.toBeUndefined();

    expect(service.availableAgents()).toEqual([
      expect.objectContaining({ id: 'orchestrator' }),
      expect.objectContaining({
        id: 'specialist:frontend-developer',
        role: 'frontend-developer',
      }),
    ]);
  });

  it('does not throw when the RPC transport rejects', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    rpcCall.mockRejectedValue(new Error('transport down'));
    try {
      await expect(service.load()).resolves.toBeUndefined();
      expect(service.availableAgents()).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});
