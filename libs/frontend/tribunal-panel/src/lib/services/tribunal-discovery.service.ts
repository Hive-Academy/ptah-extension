import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { CliDetectionResult } from '@ptah-extension/shared';
import { TRIBUNAL_MAX_VENDOR_TILES } from './tribunal-state.service';
import type { VendorLane } from '../types/tribunal-ui.types';

export interface DiscoveredVendor {
  readonly lane: VendorLane;
  readonly available: boolean;
  readonly installed: boolean;
}

const CLI_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  codex: 'Codex',
  copilot: 'Copilot',
  cursor: 'Cursor',
};

@Injectable({ providedIn: 'root' })
export class TribunalDiscoveryService {
  private readonly rpc = inject(ClaudeRpcService);

  readonly maxVendors = TRIBUNAL_MAX_VENDOR_TILES;

  async discover(): Promise<DiscoveredVendor[]> {
    const result = await this.rpc.call('agent:getConfig', undefined);
    if (!result.isSuccess() || !result.data) {
      return [];
    }
    return result.data.detectedClis
      .map((cli, index) => ({
        vendor: this.toDiscoveredVendor(cli, index),
        rank: this.rankOf(cli),
      }))
      .sort((a, b) => a.rank - b.rank)
      .map((entry) => entry.vendor);
  }

  private toDiscoveredVendor(
    cli: CliDetectionResult,
    index: number,
  ): DiscoveredVendor {
    const installed = cli.installed;
    const available = cli.installed;
    const lane =
      cli.cli === 'ptah-cli'
        ? this.toPtahCliLane(cli, index)
        : this.toSystemCliLane(cli);
    return { lane, available, installed };
  }

  private toPtahCliLane(cli: CliDetectionResult, index: number): VendorLane {
    const key =
      cli.ptahCliId ?? cli.providerId ?? cli.providerName ?? `${index}`;
    return {
      laneId: `ptah-cli|${key}`,
      family: cli.providerId ?? 'ptah-cli',
      displayName: cli.ptahCliName ?? cli.providerName ?? 'Ptah CLI',
      cli: cli.cli,
      ...(cli.providerName ? { model: cli.providerName } : {}),
    };
  }

  private toSystemCliLane(cli: CliDetectionResult): VendorLane {
    return {
      laneId: cli.cli,
      family: cli.cli,
      displayName: CLI_DISPLAY_NAMES[cli.cli] ?? cli.cli,
      cli: cli.cli,
    };
  }

  private rankOf(cli: CliDetectionResult): number {
    const rank = cli.preferredRank;
    return rank && rank > 0 ? rank : Number.MAX_SAFE_INTEGER;
  }
}
