import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { AvailableAgent, CliType } from '@ptah-extension/shared';
import { TRIBUNAL_MAX_VENDOR_TILES } from './tribunal-state.service';
import type { VendorLane } from '../types/tribunal-ui.types';

export interface DiscoveredVendor {
  readonly lane: VendorLane;
  readonly available: boolean;
  readonly installed: boolean;
}

const CLI_FAMILIES: readonly CliType[] = [
  'codex',
  'copilot',
  'cursor',
  'ptah-cli',
];

@Injectable({ providedIn: 'root' })
export class TribunalDiscoveryService {
  private readonly rpc = inject(ClaudeRpcService);

  readonly maxVendors = TRIBUNAL_MAX_VENDOR_TILES;

  async discover(): Promise<DiscoveredVendor[]> {
    const result = await this.rpc.call('harness:initialize', {});
    if (!result.isSuccess() || !result.data) {
      return [];
    }
    return result.data.availableAgents
      .filter((agent) => agent.type === 'cli')
      .map((agent) => this.toDiscoveredVendor(agent));
  }

  private toDiscoveredVendor(agent: AvailableAgent): DiscoveredVendor {
    const cli = this.resolveCli(agent);
    const available = agent.available;
    const installed = agent.installed ?? agent.available;
    const lane: VendorLane = {
      laneId: this.buildLaneId(agent, cli),
      family: agent.family ?? agent.id,
      displayName: agent.name,
      cli,
      ...(agent.provider ? { model: agent.provider } : {}),
    };
    return { lane, available, installed };
  }

  private resolveCli(agent: AvailableAgent): CliType {
    const family = (agent.family ?? agent.id).toLowerCase();
    const match = CLI_FAMILIES.find((f) => f === family);
    if (match) return match;
    if (family.includes('codex')) return 'codex';
    if (family.includes('copilot')) return 'copilot';
    if (family.includes('cursor')) return 'cursor';
    return 'ptah-cli';
  }

  private buildLaneId(agent: AvailableAgent, cli: CliType): string {
    const family = agent.family ?? cli;
    return agent.provider
      ? `${family}|${agent.provider}`
      : `${family}|${agent.id}`;
  }
}
