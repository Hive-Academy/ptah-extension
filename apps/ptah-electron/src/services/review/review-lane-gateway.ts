import { z } from 'zod';
import { AgentProcessManager, AgentSpawnEnvironment, CliDetectionService, LaneLimitLookupService } from '@ptah-extension/cli-agent-runtime';
import type { CliDetectionResult } from '@ptah-extension/shared';
import type { IReviewLaneGateway, ReviewLaneCapability } from '@ptah-extension/review-core';

const spawnInputSchema = z.object({
  laneId: z.string().min(1).max(128), cwd: z.string().min(1),
  prompt: z.string().min(1).max(200_000),
}).strict();

function idOf(row: CliDetectionResult): string {
  return row.ptahCliId ? `ptah-cli:${row.ptahCliId}` : row.cli;
}

/** Adapts the existing agent manager and quota lookup to review's admission contract. */
export class ReviewLaneGateway implements IReviewLaneGateway {
  constructor(
    private readonly manager: AgentProcessManager,
    private readonly detection: CliDetectionService,
    private readonly limits: LaneLimitLookupService,
    private readonly spawnEnvironment: AgentSpawnEnvironment,
  ) {}

  async list(): Promise<{ lanes: ReviewLaneCapability[]; maxConcurrentAgents: number }> {
    const installed = await this.detection.getInstalledClis();
    const checked = await this.limits.lookup(installed);
    return {
      lanes: checked.map(({ row, state }) => ({
        id: idOf(row), family: row.family ?? row.cli,
        limitState: state.state === 'confirmed-room' ? 'confirmed-room' as const :
          state.state === 'at-limit' ? 'at-limit' as const : 'unknown' as const,
      })),
      maxConcurrentAgents: this.spawnEnvironment.maxConcurrentAgents(),
    };
  }

  async spawn(input: { laneId: string; cwd: string; prompt: string; signal: AbortSignal }): Promise<string> {
    const parsed = spawnInputSchema.parse({ laneId: input.laneId, cwd: input.cwd, prompt: input.prompt });
    if (input.signal.aborted) throw new Error('Review lane cancelled');
    const installed = await this.detection.getInstalledClis();
    const lane = installed.find((entry) => idOf(entry) === parsed.laneId);
    if (!lane) throw new Error('Review lane unavailable');
    const [limit] = await this.limits.lookup([lane], { signal: input.signal });
    if (!limit || limit.state.state !== 'confirmed-room') throw new Error('Review lane has no confirmed room');
    const result = await this.manager.spawn({ task: parsed.prompt, cli: lane.cli,
      ...(lane.ptahCliId ? { ptahCliId: lane.ptahCliId } : {}), workingDirectory: parsed.cwd,
      taskKind: 'review' });
    const agentId = String(result.agentId);
    if (input.signal.aborted) {
      await this.manager.stop(agentId);
      throw new Error('Review lane cancelled');
    }
    const waited = await this.manager.waitForAgents([agentId], 'all', 15 * 60_000, input.signal);
    if (waited.cancelled || waited.timedOut) {
      await this.manager.stop(agentId);
      throw new Error('Review lane deadline reached');
    }
    const terminal = waited.entries[0];
    if (terminal?.state !== 'exited' || terminal.info.status !== 'completed')
      throw new Error('Review lane failed');
    return this.manager.readOutput(agentId).stdout;
  }
}
