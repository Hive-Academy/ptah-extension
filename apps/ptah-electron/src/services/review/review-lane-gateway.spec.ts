import { AgentProcessManager, AgentSpawnEnvironment, CliDetectionService, LaneLimitLookupService } from '@ptah-extension/cli-agent-runtime';
import { AgentId } from '@ptah-extension/shared';
import { ReviewLaneGateway } from './review-lane-gateway';

describe('ReviewLaneGateway', () => {
  it('reports cancellation separately from the polling deadline', async () => {
    const manager = Object.create(AgentProcessManager.prototype) as AgentProcessManager;
    const agentId = AgentId.create();
    jest.spyOn(manager, 'spawn').mockResolvedValue({ agentId, cli: 'codex', status: 'running', startedAt: new Date().toISOString() });
    const controller = new AbortController();
    jest.spyOn(manager, 'findAgentInfo').mockImplementation(() => {
      controller.abort();
      return { agentId, cli: 'codex', task: 'Review', workingDirectory: '/attempt', status: 'running', startedAt: new Date().toISOString() };
    });
    jest.spyOn(manager, 'stop').mockResolvedValue({ agentId, cli: 'codex', task: 'Review', workingDirectory: '/attempt', status: 'stopped', startedAt: new Date().toISOString() });
    const detection = Object.create(CliDetectionService.prototype) as CliDetectionService;
    jest.spyOn(detection, 'getInstalledClis').mockResolvedValue([{ cli: 'codex', installed: true, messagingMode: 'none' }]);
    const limits = Object.create(LaneLimitLookupService.prototype) as LaneLimitLookupService;
    jest.spyOn(limits, 'lookup').mockImplementation(async (rows) => rows.map((row) => ({
      row, lookup: 'ok' as const, state: { state: 'confirmed-room' as const, reasons: [], windows: [] },
    })));
    const environment = Object.create(AgentSpawnEnvironment.prototype) as AgentSpawnEnvironment;
    await expect(new ReviewLaneGateway(manager, detection, limits, environment)
      .spawn({ laneId: 'codex', cwd: '/attempt', prompt: 'Review', signal: controller.signal }))
      .rejects.toThrow('cancelled');
  });
  it('accepts completed status and releases the live process before its eventual exit', async () => {
    const manager = Object.create(AgentProcessManager.prototype) as AgentProcessManager;
    const agentId = AgentId.create();
    jest.spyOn(manager, 'spawn').mockResolvedValue({ agentId, cli: 'codex', status: 'running', startedAt: new Date().toISOString() });
    const completed = { agentId, cli: 'codex' as const, task: 'Review', workingDirectory: '/attempt',
      status: 'completed' as const, startedAt: new Date().toISOString() };
    jest.spyOn(manager, 'findAgentInfo').mockReturnValue(completed);
    const stop = jest.spyOn(manager, 'stop').mockResolvedValue(completed);
    const waitForAgents = jest.spyOn(manager, 'waitForAgents');
    const detection = Object.create(CliDetectionService.prototype) as CliDetectionService;
    jest.spyOn(detection, 'getInstalledClis').mockResolvedValue([{ cli: 'codex', installed: true, messagingMode: 'none' }]);
    const limits = Object.create(LaneLimitLookupService.prototype) as LaneLimitLookupService;
    jest.spyOn(limits, 'lookup').mockImplementation(async (rows) => rows.map((row) => ({
      row, lookup: 'ok' as const, state: { state: 'confirmed-room' as const, reasons: [], windows: [] },
    })));
    const environment = Object.create(AgentSpawnEnvironment.prototype) as AgentSpawnEnvironment;
    const gateway = new ReviewLaneGateway(manager, detection, limits, environment);
    await expect(gateway.spawn({ laneId: 'codex', cwd: '/attempt', prompt: 'Review', signal: new AbortController().signal }))
      .resolves.toBeUndefined();
    expect(manager.spawn).toHaveBeenCalledWith(expect.objectContaining({ attachMcp: false, deliverables: ['out/lane-output.json'] }));
    expect(stop).toHaveBeenCalledWith(agentId);
    expect(waitForAgents).not.toHaveBeenCalled();
  });
  it('withholds a lane known to be at its limit before spawning', async () => {
    const manager = Object.create(AgentProcessManager.prototype) as AgentProcessManager;
    const spawn = jest.spyOn(manager, 'spawn');
    const detection = Object.create(CliDetectionService.prototype) as CliDetectionService;
    jest.spyOn(detection, 'getInstalledClis').mockResolvedValue([
      { cli: 'codex', installed: true, messagingMode: 'none' },
    ]);
    const limits = Object.create(LaneLimitLookupService.prototype) as LaneLimitLookupService;
    jest.spyOn(limits, 'lookup').mockImplementation(async (rows) => rows.map((row) => ({
      row, lookup: 'ok' as const, state: { state: 'at-limit' as const, reasons: [], windows: [] },
    })));
    const environment = Object.create(AgentSpawnEnvironment.prototype) as AgentSpawnEnvironment;
    jest.spyOn(environment, 'maxConcurrentAgents').mockReturnValue(5);
    const gateway = new ReviewLaneGateway(manager, detection, limits, environment);

    expect(await gateway.list()).toEqual({ lanes: [{ id: 'codex', family: 'codex', limitState: 'at-limit' }], maxConcurrentAgents: 5 });
    await expect(gateway.spawn({ laneId: 'codex', cwd: '/attempt/src', prompt: 'Review', signal: new AbortController().signal }))
      .rejects.toThrow('at its limit');
    expect(spawn).not.toHaveBeenCalled();
  });
  it('reports failed terminal status without waiting for process exit', async () => {
    const manager = Object.create(AgentProcessManager.prototype) as AgentProcessManager;
    const agentId = AgentId.create();
    jest.spyOn(manager, 'spawn').mockResolvedValue({ agentId, cli: 'codex', status: 'running', startedAt: new Date().toISOString() });
    jest.spyOn(manager, 'findAgentInfo').mockReturnValue({ agentId, cli: 'codex', task: 'Review', workingDirectory: '/attempt/src',
      status: 'failed', startedAt: new Date().toISOString(), exitCode: 7, failureKind: 'quota' });
    jest.spyOn(manager, 'stop').mockResolvedValue({ agentId, cli: 'codex', task: 'Review', workingDirectory: '/attempt/src',
      status: 'failed', startedAt: new Date().toISOString(), exitCode: 7, failureKind: 'quota' });
    const detection = Object.create(CliDetectionService.prototype) as CliDetectionService;
    jest.spyOn(detection, 'getInstalledClis').mockResolvedValue([{ cli: 'codex', installed: true, messagingMode: 'none' }]);
    const limits = Object.create(LaneLimitLookupService.prototype) as LaneLimitLookupService;
    jest.spyOn(limits, 'lookup').mockImplementation(async (rows) => rows.map((row) => ({
      row, lookup: 'timeout' as const, state: { state: 'unknown' as const, reasons: [], windows: [] },
    })));
    const environment = Object.create(AgentSpawnEnvironment.prototype) as AgentSpawnEnvironment;
    jest.spyOn(environment, 'maxConcurrentAgents').mockReturnValue(5);
    const waitForAgents = jest.spyOn(manager, 'waitForAgents');
    const gateway = new ReviewLaneGateway(manager, detection, limits, environment);
    await expect(gateway.spawn({ laneId: 'codex', cwd: '/attempt/src', prompt: 'Review', signal: new AbortController().signal }))
      .rejects.toThrow('status-failed: quota');
    expect(waitForAgents).not.toHaveBeenCalled();
  });

  it('spawns when a limit lookup timed out', async () => {
    const manager = Object.create(AgentProcessManager.prototype) as AgentProcessManager;
    const spawn = jest.spyOn(manager, 'spawn').mockRejectedValue(new Error('spawn reached'));
    const detection = Object.create(CliDetectionService.prototype) as CliDetectionService;
    jest.spyOn(detection, 'getInstalledClis').mockResolvedValue([{ cli: 'codex', installed: true, messagingMode: 'none' }]);
    const limits = Object.create(LaneLimitLookupService.prototype) as LaneLimitLookupService;
    jest.spyOn(limits, 'lookup').mockImplementation(async (rows) => rows.map((row) => ({
      row, lookup: 'timeout' as const, state: { state: 'unknown' as const, reasons: [], windows: [] },
    })));
    const environment = Object.create(AgentSpawnEnvironment.prototype) as AgentSpawnEnvironment;
    jest.spyOn(environment, 'maxConcurrentAgents').mockReturnValue(5);
    const gateway = new ReviewLaneGateway(manager, detection, limits, environment);
    expect((await gateway.list()).lanes[0].limitState).toBe('unknown');
    await expect(gateway.spawn({ laneId: 'codex', cwd: '/attempt/src', prompt: 'Review', signal: new AbortController().signal }))
      .rejects.toThrow('spawn reached');
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});
