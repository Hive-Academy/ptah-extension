import { AgentProcessManager, AgentSpawnEnvironment, CliDetectionService, LaneLimitLookupService } from '@ptah-extension/cli-agent-runtime';
import { ReviewLaneGateway } from './review-lane-gateway';

describe('ReviewLaneGateway', () => {
  it('withholds a lane with no confirmed room before spawning', async () => {
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
      .rejects.toThrow('no confirmed room');
    expect(spawn).not.toHaveBeenCalled();
  });
});
