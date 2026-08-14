import { Injectable, computed, inject, signal } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import { getAllAnthropicProviders } from '@ptah-extension/shared';
import type {
  AgentListCliModelsResult,
  AnthropicProvider,
  CliDetectionResult,
  CliType,
  ProviderModelInfo,
} from '@ptah-extension/shared';
import { TRIBUNAL_MAX_VENDOR_TILES } from './tribunal-state.service';
import {
  laneBaseKey,
  makeLaneId,
  type VendorLane,
} from '../types/tribunal-ui.types';

/**
 * The only two fields the lane model picker renders. Narrower than
 * `ProviderModelInfo` so CLI-native model lists (`CliModelOption`, which has no
 * context length or tool-use flag) can be returned without fabricating values.
 */
export type TribunalModelOption = Pick<ProviderModelInfo, 'id' | 'name'>;

export interface DiscoveredVendor {
  readonly lane: VendorLane;
  readonly available: boolean;
  readonly needsSetup: boolean;
  readonly baseKey: string;
  readonly supportsModelList: boolean;
  /** Set when models come from `provider:listModels`. */
  readonly modelProviderId?: string;
  /** Set when models come from `agent:listCliModels` instead. */
  readonly cliModelKey?: keyof AgentListCliModelsResult;
}

/**
 * Every CLI that can hold a tribunal lane. Must stay in step with the `cli`
 * arms of `TribunalRunService.spawnArgsFor` — a family missing here is a lane
 * the run path can execute but the panel will never offer.
 *
 * A family lists models through ONE of two RPCs: `modelProviderId` routes to
 * `provider:listModels` (Codex/Copilot have real provider catalogs), while
 * `cliModelKey` routes to `agent:listCliModels`, which asks the adapter itself.
 * Cursor has neither and renders no model picker.
 */
const CLI_FAMILIES: readonly {
  cli: CliType;
  displayName: string;
  modelProviderId?: string;
  cliModelKey?: keyof AgentListCliModelsResult;
}[] = [
  { cli: 'codex', displayName: 'Codex', modelProviderId: 'openai-codex' },
  {
    cli: 'copilot',
    displayName: 'Copilot',
    modelProviderId: 'github-copilot',
  },
  { cli: 'cursor', displayName: 'Cursor' },
  {
    cli: 'antigravity',
    displayName: 'Antigravity',
    cliModelKey: 'antigravity',
  },
  { cli: 'opencode', displayName: 'opencode', cliModelKey: 'opencode' },
  { cli: 'pi', displayName: 'Pi', cliModelKey: 'pi' },
];

const CLI_FAMILY_PROVIDER_IDS: ReadonlySet<string> = new Set([
  'github-copilot',
  'openai-codex',
]);

@Injectable({ providedIn: 'root' })
export class TribunalDiscoveryService {
  private readonly rpc = inject(ClaudeRpcService);

  readonly maxVendors = TRIBUNAL_MAX_VENDOR_TILES;

  private readonly _vendors = signal<readonly DiscoveredVendor[]>([]);
  private readonly _discovered = signal(false);
  private inFlight: Promise<readonly DiscoveredVendor[]> | null = null;

  /**
   * The shared discovery result. One cache for every wizard step, so the move
   * picker, the flat panel picker and the role roster all read the same vendor
   * list instead of each firing their own `agent:getConfig` round trip.
   */
  readonly vendors = this._vendors.asReadonly();

  /**
   * True once discovery has RESOLVED at least once.
   *
   * R7 hangs off this: a card whose availability depends on discovery paints
   * enabled while this is false and only then applies its rule. A failed
   * discovery leaves it false, so an unreliable probe can never disable a move
   * — the reverse flash (paint disabled, then enable) is the thing to avoid.
   */
  readonly discovered = this._discovered.asReadonly();

  /**
   * Distinct AVAILABLE vendor families. Crucible's gate (`crucible.md:55`)
   * counts families, not lanes: two lanes of the same family cannot produce an
   * independent judge.
   */
  readonly availableFamilyCount = computed(
    () =>
      new Set(
        this._vendors()
          .filter((vendor) => vendor.available)
          .map((vendor) => vendor.lane.family),
      ).size,
  );

  /**
   * Discover once per service lifetime, then serve from the cache.
   *
   * Concurrent callers share the single in-flight promise rather than each
   * issuing their own RPC — the wizard mounts several steps that all want the
   * vendor list on the same tick.
   *
   * Never rejects: a failed probe resolves to the current (possibly empty)
   * cache with {@link discovered} left false, because a detection failure must
   * read as "we do not know", not as "there are no vendors".
   */
  ensureDiscovered(): Promise<readonly DiscoveredVendor[]> {
    if (this._discovered()) {
      return Promise.resolve(this._vendors());
    }
    return this.runDiscovery();
  }

  /** Bypass the cache — the wizard's explicit Refresh affordance. */
  rediscover(): Promise<readonly DiscoveredVendor[]> {
    return this.runDiscovery();
  }

  private runDiscovery(): Promise<readonly DiscoveredVendor[]> {
    this.inFlight ??= this.discover()
      .then((vendors) => {
        this._vendors.set(vendors);
        this._discovered.set(true);
        return this._vendors();
      })
      .catch((error: unknown) => {
        console.error(
          '[TribunalDiscoveryService] discovery failed:',
          error instanceof Error ? error.message : String(error),
        );
        return this._vendors();
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  async discover(): Promise<DiscoveredVendor[]> {
    const detectedClis = await this.loadDetectedClis();
    const cliLanes = this.buildCliFamilyLanes(detectedClis);
    const providerLanes = this.buildProviderLanes(detectedClis);
    return [...cliLanes, ...providerLanes].sort(this.compareVendors);
  }

  async listModelsFor(
    vendor: DiscoveredVendor,
  ): Promise<readonly TribunalModelOption[]> {
    if (!vendor.supportsModelList) {
      return [];
    }
    if (vendor.cliModelKey) {
      return this.listCliModels(vendor.cliModelKey);
    }
    if (!vendor.modelProviderId) {
      return [];
    }
    try {
      const result = await this.rpc.call('provider:listModels', {
        toolUseOnly: false,
        providerId: vendor.modelProviderId,
      });
      if (result.isSuccess() && result.data) {
        return result.data.models ?? [];
      }
      return [];
    } catch (error: unknown) {
      console.error(
        '[TribunalDiscoveryService] provider:listModels failed:',
        error instanceof Error ? error.message : String(error),
      );
      return [];
    }
  }

  /**
   * Models for a CLI that owns its own catalog (Antigravity's `agy models`
   * labels, opencode's `provider/model` ids, Pi's list). One RPC returns every
   * CLI's list, so the key selects the slice.
   */
  private async listCliModels(
    key: keyof AgentListCliModelsResult,
  ): Promise<readonly TribunalModelOption[]> {
    try {
      const result = await this.rpc.call('agent:listCliModels', undefined);
      if (result.isSuccess() && result.data) {
        return result.data[key] ?? [];
      }
      return [];
    } catch (error: unknown) {
      console.error(
        '[TribunalDiscoveryService] agent:listCliModels failed:',
        error instanceof Error ? error.message : String(error),
      );
      return [];
    }
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
    return CLI_FAMILIES.map(
      ({ cli, displayName, modelProviderId, cliModelKey }) => {
        const detected = detectedClis.find((entry) => entry.cli === cli);
        const available = detected?.installed === true;
        const baseKey = laneBaseKey({ cli });
        const supportsModelList =
          modelProviderId !== undefined || cliModelKey !== undefined;
        return {
          lane: {
            laneId: makeLaneId(baseKey, 0),
            family: cli,
            displayName,
            cli,
          },
          available,
          needsSetup: !available,
          baseKey,
          supportsModelList,
          ...(modelProviderId ? { modelProviderId } : {}),
          ...(cliModelKey ? { cliModelKey } : {}),
        };
      },
    );
  }

  private buildProviderLanes(
    detectedClis: readonly CliDetectionResult[],
  ): DiscoveredVendor[] {
    // Merged registry — a user-defined provider is a legitimate tribunal lane.
    const providers: readonly AnthropicProvider[] = getAllAnthropicProviders();
    return providers
      .filter((provider) => !CLI_FAMILY_PROVIDER_IDS.has(provider.id))
      .map((provider) => {
        const agent = detectedClis.find(
          (entry) =>
            entry.cli === 'ptah-cli' && entry.providerId === provider.id,
        );
        const available = agent !== undefined;
        const baseKey = laneBaseKey({
          cli: 'ptah-cli',
          providerId: provider.id,
        });
        const lane: VendorLane = {
          laneId: makeLaneId(baseKey, 0),
          family: provider.id,
          displayName: provider.name,
          cli: 'ptah-cli',
          providerId: provider.id,
          ...(agent?.ptahCliId ? { ptahCliId: agent.ptahCliId } : {}),
          ...(provider.defaultTiers?.opus
            ? { model: provider.defaultTiers.opus }
            : {}),
        };
        return {
          lane,
          available,
          needsSetup: !available,
          baseKey,
          supportsModelList: true,
          modelProviderId: provider.id,
        };
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
