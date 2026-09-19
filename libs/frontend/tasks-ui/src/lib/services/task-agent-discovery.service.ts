import { Injectable, inject, signal } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { TaskAgentTarget } from '../types/task-agent.types';

const ORCHESTRATOR_TARGET: TaskAgentTarget = {
  id: 'orchestrator',
  name: 'Full Orchestrator',
  category: 'orchestrator',
  description: 'Run the full task orchestration pipeline.',
};

const CLI_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  codex: 'Codex',
  copilot: 'Copilot',
  cursor: 'Cursor',
  antigravity: 'Antigravity',
  opencode: 'OpenCode',
  pi: 'Pi',
  'ptah-cli': 'Ptah CLI',
};

/** Resolves and caches the task-assignment roster from existing RPC methods. */
@Injectable({ providedIn: 'root' })
export class TaskAgentDiscoveryService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly _availableAgents = signal<readonly TaskAgentTarget[]>([
    ORCHESTRATOR_TARGET,
  ]);
  private loadPromise: Promise<void> | null = null;

  /** Category-ordered roster: orchestrator, specialist roles, then CLI lanes. */
  public readonly availableAgents = this._availableAgents.asReadonly();

  /** Load once per service lifetime. Failures intentionally keep the safe default. */
  public load(): Promise<void> {
    this.loadPromise ??= this.discover();
    return this.loadPromise;
  }

  private async discover(): Promise<void> {
    try {
      const [agentsResult, clisResult] = await Promise.all([
        this.rpc.call('autocomplete:agents', { query: '' }),
        this.rpc.call('agent:detectClis', undefined),
      ]);

      const specialists =
        agentsResult.success && agentsResult.data !== undefined
          ? (agentsResult.data.agents ?? []).map(
              (agent): TaskAgentTarget => ({
                id: `specialist:${agent.name}`,
                name: agent.name,
                category: 'specialist',
                description: agent.description,
                role: agent.name,
              }),
            )
          : [];
      const lanes =
        clisResult.success && clisResult.data !== undefined
          ? (clisResult.data.clis ?? [])
              .filter((cli) => cli.installed && cli.disabled !== true)
              .map(
                (cli): TaskAgentTarget => ({
                  id: `lane:${cli.ptahCliId ?? cli.cli}`,
                  name:
                    cli.ptahCliName ?? CLI_DISPLAY_NAMES[cli.cli] ?? cli.cli,
                  category: 'lane',
                  description: cli.version
                    ? `Run through ${cli.cli} ${cli.version}.`
                    : `Run through the ${cli.cli} CLI lane.`,
                  cli: cli.cli,
                }),
              )
          : [];

      this._availableAgents.set([
        ORCHESTRATOR_TARGET,
        ...specialists,
        ...lanes,
      ]);
    } catch (error: unknown) {
      // RPC failures must never escape into the Tasks surface. Narrowing keeps
      // this boundary safe if the transport starts rejecting in the future.
      const message =
        error instanceof Error ? error.message : 'Agent discovery failed';
      console.warn('[TaskAgentDiscoveryService] Discovery failed:', message);
      this._availableAgents.set([ORCHESTRATOR_TARGET]);
    }
  }
}
