import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import { ANTHROPIC_PROVIDERS } from '@ptah-extension/shared';
import type {
  AnthropicProvider,
  CliDetectionResult,
  CliType,
} from '@ptah-extension/shared';
import { TRIBUNAL_MAX_VENDOR_TILES } from './tribunal-state.service';
import type { VendorLane } from '../types/tribunal-ui.types';

export interface DiscoveredVendor {
  readonly lane: VendorLane;
  readonly available: boolean;
  readonly needsSetup: boolean;
}

const CLI_FAMILIES: readonly { cli: CliType; displayName: string }[] = [
  { cli: 'codex', displayName: 'Codex' },
  { cli: 'copilot', displayName: 'Copilot' },
  { cli: 'cursor', displayName: 'Cursor' },
];

const CLI_FAMILY_PROVIDER_IDS: ReadonlySet<string> = new Set([
  'github-copilot',
  'openai-codex',
]);

@Injectable({ providedIn: 'root' })
export class TribunalDiscoveryService {
  private readonly rpc = inject(ClaudeRpcService);

  readonly maxVendors = TRIBUNAL_MAX_VENDOR_TILES;

  async discover(): Promise<DiscoveredVendor[]> {
    const detectedClis = await this.loadDetectedClis();
    const cliLanes = this.buildCliFamilyLanes(detectedClis);
    const providerLanes = this.buildProviderLanes(detectedClis);
    return [...cliLanes, ...providerLanes].sort(this.compareVendors);
  }

  private async loadDetectedClis(): Promise<readonly CliDetectionResult[]> {
    const result = await this.rpc.call('agent:getConfig', undefined);
    if (!result.isSuccess() || !result.data) {
      return [];
    }
    return result.data.detectedClis;
  }

  private buildCliFamilyLanes(
    detectedClis: readonly CliDetectionResult[],
  ): DiscoveredVendor[] {
    return CLI_FAMILIES.map(({ cli, displayName }) => {
      const detected = detectedClis.find((entry) => entry.cli === cli);
      const available = detected?.installed === true;
      return {
        lane: { laneId: cli, family: cli, displayName, cli },
        available,
        needsSetup: !available,
      };
    });
  }

  private buildProviderLanes(
    detectedClis: readonly CliDetectionResult[],
  ): DiscoveredVendor[] {
    const providers = ANTHROPIC_PROVIDERS as readonly AnthropicProvider[];
    return providers
      .filter((provider) => !CLI_FAMILY_PROVIDER_IDS.has(provider.id))
      .map((provider) => {
        const agent = detectedClis.find(
          (entry) =>
            entry.cli === 'ptah-cli' && entry.providerId === provider.id,
        );
        const available = agent !== undefined;
        const lane: VendorLane = {
          laneId: `ptah-cli|${provider.id}`,
          family: provider.id,
          displayName: provider.name,
          cli: 'ptah-cli',
          providerId: provider.id,
          ...(agent?.ptahCliId ? { ptahCliId: agent.ptahCliId } : {}),
          ...(provider.defaultTiers?.opus
            ? { model: provider.defaultTiers.opus }
            : {}),
        };
        return { lane, available, needsSetup: !available };
      });
  }

  private compareVendors = (
    a: DiscoveredVendor,
    b: DiscoveredVendor,
  ): number => {
    if (a.available !== b.available) {
      return a.available ? -1 : 1;
    }
    const aCli = a.lane.cli !== 'ptah-cli';
    const bCli = b.lane.cli !== 'ptah-cli';
    if (aCli !== bCli) {
      return aCli ? -1 : 1;
    }
    return 0;
  };
}
