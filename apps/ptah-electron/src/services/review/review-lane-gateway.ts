import { z } from 'zod';
import { AgentProcessManager, AgentSpawnEnvironment, CliDetectionService, LaneLimitLookupService } from '@ptah-extension/cli-agent-runtime';
import type { CliDetectionResult } from '@ptah-extension/shared';
import { type IReviewLaneGateway, type ReviewLaneCapability } from '@ptah-extension/review-core';

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

  async spawn(input: { laneId: string; cwd: string; prompt: string; signal: AbortSignal }): Promise<void> {
    const parsed = spawnInputSchema.parse({ laneId: input.laneId, cwd: input.cwd, prompt: input.prompt });
    if (input.signal.aborted) throw new Error('Review lane cancelled');
    const installed = await this.detection.getInstalledClis();
    const lane = installed.find((entry) => idOf(entry) === parsed.laneId);
    if (!lane) throw new Error('Review lane unavailable');
    const [limit] = await this.limits.lookup([lane], { signal: input.signal });
    if (limit?.state.state === 'at-limit') throw new Error('Review lane is at its limit');
    const result = await this.manager.spawn({ task: parsed.prompt, cli: lane.cli,
      ...(lane.ptahCliId ? { ptahCliId: lane.ptahCliId } : {}), workingDirectory: parsed.cwd,
      taskKind: 'review', attachMcp: false, deliverables: ['out/lane-output.json'] });
    const agentId = String(result.agentId);
    if (input.signal.aborted) {
      await this.manager.stop(agentId);
      throw new Error('Review lane cancelled');
    }
    // Continuation-capable SDK handles can keep their process alive after the
    // turn completes. waitForAgents listens for process exit, which may be the
    // five-minute idle release rather than the end of the review turn.
    const deadline = Date.now() + 15 * 60_000;
    try {
      while (true) {
        if (input.signal.aborted) throw new Error('cancelled');
        if (Date.now() >= deadline) throw new Error('timeout');
        // Review attempts live outside the active editor workspace, so the
        // caller-scoped getStatus API would reject this internal lane.
        const status = this.manager.findAgentInfo(agentId);
        if (!status) throw new Error('status-failed: missing agent');
        if (status.status === 'completed') return;
        if (status.status === 'failed' || status.status === 'stopped' || status.status === 'timeout') {
          const detail = status.status === 'timeout' ? 'timeout' :
            `status-failed: ${status.failureKind ?? status.exitCode ?? status.status}`;
          throw new Error(detail);
        }
        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(200, Math.max(1, deadline - Date.now()))));
      }
    } finally {
      // stop preserves the completed status while releasing a live SDK handle.
      await this.manager.stop(agentId);
    }
  }
}
