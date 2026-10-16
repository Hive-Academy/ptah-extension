/**
 * `LaneModelListing` for every host that calls `registerSharedRpcHandlers`.
 *
 * The Batch 5 port type is not on the `@ptah-extension/lane-routing` barrel
 * (that index export belongs to a later batch). This class matches
 * `list(row, signal)` on `lane-model-listing.port.ts` and is registered under
 * `LANE_ROUTING_TOKENS.LANE_MODEL_LISTING`.
 *
 * System CLI rows come from `CliModelListService`. Ptah CLI rows come from
 * the saved config (no network) plus one shared provider discovery per
 * provider, raced against the row's signal.
 */

import { inject, injectable } from 'tsyringe';
import { CLI_AGENT_RUNTIME_TOKENS } from '@ptah-extension/cli-agent-runtime';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers';
import {
  TOKENS,
  type IAuthSecretsService,
  type Logger,
} from '@ptah-extension/vscode-core';
import {
  getAnthropicProvider,
  type AgentModelEntry,
  type AgentModelProvider,
  type CliDetectionResult,
  type PtahCliConfig,
  type SystemCliType,
} from '@ptah-extension/shared';
import { CliModelListService } from './cli-model-list.service';

/** Matches `LaneModelEntry` on the Batch 5 port. */
interface ListedModel {
  readonly id: string;
  readonly provenance: 'reported' | 'fallback' | 'configured' | 'tier';
  readonly auto?: boolean;
}

interface DiscoveryModels {
  readonly kind: 'models';
  readonly models: readonly { readonly id: string }[];
  readonly isStatic: boolean;
}

interface DiscoverySkipped {
  readonly kind: 'skipped';
}

interface DiscoveryEmpty {
  readonly kind: 'empty';
  readonly reason: 'empty';
}

interface DiscoveryFailed {
  readonly kind: 'error';
  readonly reason: 'threw' | 'threw-unknown';
}

type DiscoveryOutcome =
  DiscoveryModels | DiscoverySkipped | DiscoveryEmpty | DiscoveryFailed;

interface ProviderModelFetch {
  fetchModels(
    providerId: string,
    apiKey: string | null,
    toolUseOnly?: boolean,
  ): Promise<{
    models: readonly { readonly id: string }[];
    totalCount: number;
    isStatic: boolean;
  }>;
}

const CLASSIFIED_CLIS = ['codex', 'copilot', 'cursor', 'opencode'] as const;

type ClassifiedCli = (typeof CLASSIFIED_CLIS)[number];

function isClassifiedCli(cli: SystemCliType): cli is ClassifiedCli {
  return (CLASSIFIED_CLIS as readonly string[]).includes(cli);
}

function failureReason(error: unknown): 'threw' | 'threw-unknown' {
  if (error instanceof Error) return 'threw';
  return 'threw-unknown';
}

/**
 * Lists models for one lane. Registered as a singleton under
 * `LANE_ROUTING_TOKENS.LANE_MODEL_LISTING`.
 */
@injectable()
export class LaneModelListingAdapter {
  /** In-flight discovery for one burst. Dropped when that promise settles. */
  private readonly discoveryInFlight = new Map<
    string,
    Promise<DiscoveryOutcome>
  >();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Pick<Logger, 'debug'>,
    @inject(CliModelListService)
    private readonly cliModels: Pick<
      CliModelListService,
      'listAll' | 'listForClassification'
    >,
    @inject(CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_CONFIG_PERSISTENCE)
    private readonly ptahCliConfigs: {
      loadConfigs(): PtahCliConfig[];
    },
    @inject(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelFetch,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecrets: Pick<IAuthSecretsService, 'getProviderKey'>,
  ) {}

  async list(
    row: CliDetectionResult,
    signal: AbortSignal,
  ): Promise<readonly ListedModel[]> {
    if (row.cli === 'ptah-cli') {
      return this.listPtahCli(row, signal);
    }
    return this.listSystemCli(row.cli);
  }

  private async listSystemCli(cli: SystemCliType): Promise<ListedModel[]> {
    const [listed, classified] = await Promise.all([
      this.cliModels.listAll(),
      this.cliModels.listForClassification(),
    ]);
    const seen = new Set<string>();
    const entries: ListedModel[] = [];
    const push = (id: string, isFallback: boolean | undefined): void => {
      const trimmed = id.trim();
      if (trimmed.length === 0 || seen.has(trimmed)) return;
      seen.add(trimmed);
      entries.push({
        id: trimmed,
        provenance: isFallback === true ? 'fallback' : 'reported',
      });
    };

    for (const option of listed[cli]) {
      const fromClassification = this.classifiedById(
        classified,
        cli,
        option.id,
      );
      push(
        option.id,
        fromClassification ? fromClassification.isFallback : option.isFallback,
      );
    }
    if (isClassifiedCli(cli)) {
      for (const entry of classified[cli]) {
        push(entry.id, entry.isFallback);
      }
    }
    return entries;
  }

  private classifiedById(
    classified: Record<AgentModelProvider, AgentModelEntry[]>,
    cli: SystemCliType,
    id: string,
  ): AgentModelEntry | undefined {
    if (!isClassifiedCli(cli)) return undefined;
    const want = id.trim();
    return classified[cli].find((entry) => entry.id.trim() === want);
  }

  private async listPtahCli(
    row: CliDetectionResult,
    signal: AbortSignal,
  ): Promise<readonly ListedModel[]> {
    const configs = this.ptahCliConfigs.loadConfigs();
    const config = row.ptahCliId
      ? configs.find((item) => item.id === row.ptahCliId)
      : undefined;
    const base = this.entriesFromConfig(config);
    const providerId = config?.providerId ?? row.providerId;
    if (!providerId) return base;
    if (signal.aborted) {
      this.logMiss(row.ptahCliId, providerId, 'aborted');
      return base;
    }

    try {
      const outcome = await this.awaitWithSignal(
        this.sharedDiscovery(providerId),
        signal,
      );
      if (outcome.kind === 'skipped') return base;
      if (outcome.kind === 'empty' || outcome.kind === 'error') {
        this.logMiss(row.ptahCliId, providerId, outcome.reason);
        return base;
      }
      return this.mergeDiscovery(base, outcome.models, outcome.isStatic);
    } catch (error: unknown) {
      // degradation-audit: optional-capability - the row deadline or a
      // discovery failure leaves the saved configured and tier entries.
      this.logMiss(
        row.ptahCliId,
        providerId,
        signal.aborted ? 'aborted' : failureReason(error),
      );
      return base;
    }
  }

  private entriesFromConfig(config: PtahCliConfig | undefined): ListedModel[] {
    if (!config) return [];
    const entries: ListedModel[] = [];
    const seen = new Set<string>();
    const push = (
      id: string | undefined,
      provenance: ListedModel['provenance'],
    ): void => {
      if (typeof id !== 'string') return;
      const trimmed = id.trim();
      if (trimmed.length === 0 || seen.has(trimmed)) return;
      seen.add(trimmed);
      entries.push({ id: trimmed, provenance });
    };
    push(config.selectedModel, 'configured');
    const tiers = config.tierMappings;
    if (tiers) {
      push(tiers.sonnet, 'tier');
      push(tiers.opus, 'tier');
      push(tiers.haiku, 'tier');
    }
    return entries;
  }

  private mergeDiscovery(
    base: readonly ListedModel[],
    models: readonly { readonly id: string }[],
    isStatic: boolean,
  ): ListedModel[] {
    const entries = base.map((entry) => ({ ...entry }));
    const seen = new Set(entries.map((entry) => entry.id));
    const provenance: ListedModel['provenance'] = isStatic
      ? 'fallback'
      : 'reported';
    for (const model of models) {
      const id = model.id.trim();
      if (id.length === 0 || seen.has(id)) continue;
      seen.add(id);
      entries.push({ id, provenance });
    }
    return entries;
  }

  /**
   * One discovery promise per provider until it settles. Each row races its
   * own signal against that shared promise, so one abort does not cancel
   * another row on the same provider.
   */
  private sharedDiscovery(providerId: string): Promise<DiscoveryOutcome> {
    const existing = this.discoveryInFlight.get(providerId);
    if (existing) return existing;
    const pending = this.runDiscovery(providerId);
    this.discoveryInFlight.set(providerId, pending);
    const release = (): void => {
      if (this.discoveryInFlight.get(providerId) === pending) {
        this.discoveryInFlight.delete(providerId);
      }
    };
    void pending.then(release, release);
    return pending;
  }

  private async runDiscovery(providerId: string): Promise<DiscoveryOutcome> {
    try {
      const apiKey = await this.authSecrets.getProviderKey(providerId);
      if (!apiKey && this.isPurelyDynamic(providerId)) {
        return { kind: 'skipped' };
      }
      const result = await this.providerModels.fetchModels(
        providerId,
        apiKey ?? null,
        false,
      );
      const models = result.models.filter(
        (model) => model.id.trim().length > 0,
      );
      if (models.length === 0) return { kind: 'empty', reason: 'empty' };
      return { kind: 'models', models, isStatic: result.isStatic };
    } catch (error: unknown) {
      // degradation-audit: optional-capability - provider discovery can fail
      // or hang; the row keeps configured and tier entries. The raw error is
      // not logged because a provider client can echo the request.
      return { kind: 'error', reason: failureReason(error) };
    }
  }

  /** Same guard as `provider:listModels`: no key and no static catalog. */
  private isPurelyDynamic(providerId: string): boolean {
    const provider = getAnthropicProvider(providerId);
    return Boolean(
      provider?.modelsEndpoint &&
      (!provider.staticModels || provider.staticModels.length === 0),
    );
  }

  private awaitWithSignal<T>(
    work: Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    if (signal.aborted) return Promise.reject(this.abortError(signal));
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        reject(this.abortError(signal));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      work.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          if (signal.aborted) {
            reject(this.abortError(signal));
            return;
          }
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  private abortError(signal: AbortSignal): Error {
    const reason: unknown = signal.reason;
    if (reason instanceof Error) return reason;
    if (typeof reason === 'string' && reason.length > 0) {
      return new Error(reason);
    }
    return new Error('aborted');
  }

  private logMiss(
    ptahCliId: string | undefined,
    providerId: string,
    reason: string,
  ): void {
    this.logger.debug('[LaneModelListing] discovery unavailable', {
      ptahCliId,
      providerId,
      reason,
    });
  }
}
