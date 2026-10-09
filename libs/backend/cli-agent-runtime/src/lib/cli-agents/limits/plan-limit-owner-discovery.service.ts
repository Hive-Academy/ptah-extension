/**
 * Plan-limit owner discovery (TASK_2026_596, Component 10b; Req 6.6, 7, 8).
 *
 * Decides, in the backend, which quota owners the dashboard and a session
 * view show, and how each one is read. No secret crosses this boundary: a
 * target names where its credential lives, never the credential.
 *
 * ## Sources, in order
 *
 * 1. **The dashboard's selected provider**, resolved through the established
 *    route logic `resolveEffectiveAuthRoute`. Discovery assembles the config
 *    and the provider snapshot that function needs (see {@link routeInput}):
 *    - `claude-cli` → the Claude account of a live native session, read
 *      through that session's probe handle; "no open session" without one.
 *    - `anthropic` on an API key → `unsupported-auth`, never read.
 *    - `openai-codex` → the Codex account home, no credential reference.
 *    - `ollama-cloud`, `opencode-go`, `opencode-zen` → the stored provider key.
 *    - anything else → `provider-unsupported`, never read.
 * 2. **Local CLI stores**: installed `opencode` and `antigravity`.
 * 3. **The requested sessions' owners**, from the resolver's session route.
 * 4. **Lane owners from detection**: installed `codex`, and enabled Ptah CLI
 *    agents on Ollama Cloud (Glm included), each read with its own key. A
 *    missing key is still listed and reads `unsupported-config`; a
 *    placeholder reads `unsupported-auth`; neither reaches the network.
 * 5. **Ledger-only owners**: the view's `ownerKeys` (runs that recorded an
 *    owner), then owners with active evidence. Each is listed only when no
 *    live source above named it, from ledger evidence alone, with no read —
 *    so an old account is never read as, or shown as, the current one. The
 *    status is the one `planOwnerRead` already knows for that owner (an
 *    Anthropic API key stays `unsupported-auth`); `service-unavailable` only
 *    when the owner would need a live read.
 *
 * Owner keys come from `ProviderOwnerResolver` at call time, so a changed
 * account is a new key and a new target (Decision 10). The list is
 * deduplicated by owner key; the first source in the order above to name an
 * owner wins.
 *
 * ## Deadline
 *
 * The sources run together, each bounded by the shared lookup deadline
 * (`LIMIT_LOOKUP_DEADLINE_MS`), so one call takes at most that long. A source
 * that throws or misses the deadline is dropped alone, logged at debug; the
 * others still return. `discoverTargets` never rejects.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  parseQuotaOwnerRef,
  type SessionQuotaProbe,
} from '@ptah-extension/agent-sdk';
import {
  AUTH_PROVIDERS_TOKENS,
  quotaOwnerRefFromKey,
  resolveEffectiveAuthRoute,
  unknownOwnerKey,
  type ActiveProviderResolver,
  type EffectiveRouteConfig,
  type EffectiveRouteProvider,
  type PlanLimitLedgerService,
  type PlanOwnerTarget,
  type ProviderOwnerResolver,
} from '@ptah-extension/auth-providers';
import {
  ANTHROPIC_DIRECT_PROVIDER_ID,
  LIMIT_LOOKUP_DEADLINE_MS,
  getAllAnthropicProviders,
  type AnthropicProvider,
  type CliDetectionResult,
  type PlanLimitOwnerSnapshot,
  type PtahCliSummary,
  type QuotaOwnerRef,
} from '@ptah-extension/shared';
import { CLI_AGENT_RUNTIME_TOKENS } from '../../di/tokens';
import {
  planOwnerRead,
  snapshotWithoutRead,
  type PlanOwnerKnownStatus,
  type PlanOwnerReadContext,
} from './plan-owner-read';

/** Which source named an owner. */
export type PlanOwnerOrigin =
  | 'selected-provider'
  | 'cli-store'
  | 'session'
  | 'lane'
  | 'owner-key'
  | 'active-evidence';

/**
 * One owner to show:
 * - `read` — read through `PlanUsageService.getOwnerSnapshot(target)`;
 * - `known` — the snapshot is already complete; the caller must not read it.
 */
export type DiscoveredPlanOwner =
  | {
      readonly kind: 'read';
      readonly origin: PlanOwnerOrigin;
      readonly target: PlanOwnerTarget;
    }
  | {
      readonly kind: 'known';
      readonly origin: PlanOwnerOrigin;
      readonly snapshot: PlanLimitOwnerSnapshot;
    };

export interface PlanOwnerDiscoveryRequest {
  /** The dashboard's selected provider: a UI provider id, not a credential. */
  readonly selectedProviderId?: string;
  /** Sessions whose owners the view shows. */
  readonly sessionIds?: readonly string[];
  /** Opaque owner keys of runs the view shows. */
  readonly ownerKeys?: readonly string[];
}

/** Outcome of resolving the account owner for one selected provider route. */
export type SelectedProviderDiscovery =
  | { readonly kind: 'owner'; readonly entry: DiscoveredPlanOwner | undefined }
  | { readonly kind: 'unavailable' };

export type DiscoveryOwnerSource = Pick<
  ProviderOwnerResolver,
  | 'ownerForProviderKey'
  | 'ownerForPtahCli'
  | 'ownerForClaudeAccount'
  | 'ownerForCodexHome'
  | 'resolveCodexHomeOwner'
  | 'ownerForCliStore'
  | 'ownerForAntigravity'
  | 'ownerForSession'
>;
export type DiscoveryLedger = Pick<
  PlanLimitLedgerService,
  'snapshotFor' | 'knownOwners' | 'sessionOwners'
>;
export type DiscoveryProbe = Pick<SessionQuotaProbe, 'sessionRoute'>;
export type DiscoveryActiveAuth = Pick<
  ActiveProviderResolver,
  'resolveActiveAuth'
>;
export interface DiscoveryDetection {
  detectAll(): Promise<CliDetectionResult[]>;
}
export interface DiscoveryPtahCliAgents {
  listAgents(): Promise<PtahCliSummary[]>;
}

const CLAUDE_CLI_PROVIDER_ID = 'claude-cli';
/** Selected providers read through their stored key. */
const STORED_KEY_PROVIDERS: ReadonlySet<string> = new Set([
  'ollama-cloud',
  'opencode-go',
  'opencode-zen',
]);
const CLI_STORE_CLIS = ['opencode', 'antigravity'] as const;
/** What a source's deadline resolves with. */
const TIMED_OUT: unique symbol = Symbol('plan-owner-source-timed-out');

@injectable()
export class PlanLimitOwnerDiscoveryService {
  private completedCodexHomeOwner: QuotaOwnerRef | undefined;
  private codexHomeOwnerInFlight: Promise<QuotaOwnerRef> | null = null;
  private retainNextCodexHomeOwner = false;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(AUTH_PROVIDERS_TOKENS.PROVIDER_OWNER_RESOLVER)
    private readonly owners: DiscoveryOwnerSource,
    @inject(AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER)
    private readonly ledger: DiscoveryLedger,
    @inject(SDK_TOKENS.SDK_SESSION_QUOTA_PROBE)
    private readonly probe: DiscoveryProbe,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_ACTIVE_PROVIDER_RESOLVER)
    private readonly activeAuth: DiscoveryActiveAuth,
    @inject(TOKENS.CLI_DETECTION_SERVICE)
    private readonly detection: DiscoveryDetection,
    @inject(CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY)
    private readonly ptahCliAgents: DiscoveryPtahCliAgents,
  ) {}

  /** The owners to show, deduplicated by owner key. Never rejects. */
  async discoverTargets(
    request: PlanOwnerDiscoveryRequest = {},
  ): Promise<DiscoveredPlanOwner[]> {
    const sessionIds = request.sessionIds ?? [];
    const cachedCodexHomeOwner = this.completedCodexHomeOwner;
    this.completedCodexHomeOwner = undefined;
    const listed = new Map<string, DiscoveredPlanOwner>();
    const add = (entries: ReadonlyArray<DiscoveredPlanOwner | undefined>) => {
      for (const entry of entries) {
        if (!entry) continue;
        const key = ownerOf(entry).key;
        if (!listed.has(key)) listed.set(key, entry);
      }
    };

    // Every source starts now and races its own copy of the same deadline;
    // results are added in source order, so precedence does not depend on
    // which source settles first.
    const detected = this.fromSource('detection', () =>
      this.detection.detectAll(),
    );
    const sources: Array<
      Promise<ReadonlyArray<DiscoveredPlanOwner | undefined> | undefined>
    > = [
      this.fromSource(
        'selected-provider',
        async () => [
          await this.selectedProvider(request.selectedProviderId, sessionIds, cachedCodexHomeOwner),
        ],
        () => (this.retainNextCodexHomeOwner = true),
      ),
      this.fromSource('cli-store', async () =>
        this.cliStores((await detected) ?? []),
      ),
      this.fromSource('session', () => this.sessions(sessionIds)),
      this.fromSource(
        'lane',
        async () => this.detectedLanes((await detected) ?? [], cachedCodexHomeOwner),
        () => (this.retainNextCodexHomeOwner = true),
      ),
      this.fromSource('ptah-cli', () => this.ptahCliLanes()),
      this.fromSource('owner-key', () =>
        Promise.resolve(
          this.ledgerOnly(parseOwnerKeys(request.ownerKeys ?? []), 'owner-key'),
        ),
      ),
      this.fromSource('active-evidence', () =>
        Promise.resolve(
          this.ledgerOnly(this.ledger.knownOwners(), 'active-evidence'),
        ),
      ),
    ];
    for (const entries of await Promise.all(sources)) add(entries ?? []);
    return [...listed.values()];
  }

  /**
   * Resolves only the selected-provider source. Unlike the aggregate lookup,
   * this preserves a source failure so the account RPC can remain retryable.
   * It deliberately has no shared lookup deadline: the account RPC asks for
   * this one owner and its reader owns its own timeout (Codex cold starts can
   * exceed the three-second aggregate dashboard budget).
   */
  async discoverSelectedProvider(
    providerId: string,
  ): Promise<SelectedProviderDiscovery> {
    try {
      const entry = await this.selectedProvider(providerId, []);
      return { kind: 'owner', entry };
    } catch (error: unknown) {
      // degradation-audit: reported - selected-provider failure is logged and
      // surfaced to the RPC as retryable service-unavailable.
      this.logger.debug('[PlanLimitOwnerDiscovery] source dropped', {
        source: 'selected-provider',
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return { kind: 'unavailable' };
    }
  }

  // ------------------------------------------------------------ sources

  private async selectedProvider(
    selectedProviderId: string | undefined,
    sessionIds: readonly string[],
    cachedCodexHomeOwner?: QuotaOwnerRef,
  ): Promise<DiscoveredPlanOwner | undefined> {
    const { config, providers } = this.routeInput(selectedProviderId);
    const driver = resolveEffectiveAuthRoute(
      config,
      providers,
    ).driverProviderId;
    if (driver === null) return undefined;
    const origin: PlanOwnerOrigin = 'selected-provider';

    if (driver === CLAUDE_CLI_PROVIDER_ID) {
      const sessionId = this.nativeSession(sessionIds);
      if (sessionId === undefined) {
        return this.known(
          this.owners.ownerForClaudeAccount(
            null,
            'selected-provider:claude-cli',
          ),
          {
            status: 'service-unavailable',
            unavailableReason: 'no-open-session',
          },
          origin,
        );
      }
      return this.entryFor(
        await this.owners.ownerForSession(sessionId),
        origin,
        { sessionId },
      );
    }
    if (driver === ANTHROPIC_DIRECT_PROVIDER_ID) {
      // A direct API key has no plan windows (Req 2.2): never read.
      return this.known(
        await this.owners.ownerForProviderKey(ANTHROPIC_DIRECT_PROVIDER_ID),
        { status: 'unsupported-auth' },
        origin,
      );
    }
    if (driver === 'openai-codex') {
      return this.entryFor(
        await this.resolveCodexHomeOwner(cachedCodexHomeOwner),
        origin,
      );
    }
    if (STORED_KEY_PROVIDERS.has(driver)) {
      return this.entryFor(
        await this.owners.ownerForProviderKey(driver),
        origin,
      );
    }
    return this.known(
      quotaOwnerRefFromKey(
        unknownOwnerKey(driver, `selected-provider:${driver}`),
      ),
      { status: 'provider-unsupported' },
      origin,
    );
  }

  private cliStores(
    detected: readonly CliDetectionResult[],
  ): Array<DiscoveredPlanOwner | undefined> {
    return CLI_STORE_CLIS.filter((cli) => isInstalled(detected, cli)).map(
      (cli) =>
        this.entryFor(
          cli === 'antigravity'
            ? this.owners.ownerForAntigravity()
            : this.owners.ownerForCliStore(cli),
          'cli-store',
        ),
    );
  }

  private async sessions(
    sessionIds: readonly string[],
  ): Promise<Array<DiscoveredPlanOwner | undefined>> {
    return Promise.all(
      sessionIds.map(async (sessionId) =>
        this.entryFor(await this.owners.ownerForSession(sessionId), 'session', {
          sessionId,
        }),
      ),
    );
  }

  private async detectedLanes(
    detected: readonly CliDetectionResult[],
    cachedCodexHomeOwner?: QuotaOwnerRef,
  ): Promise<Array<DiscoveredPlanOwner | undefined>> {
    return isInstalled(detected, 'codex')
      ? [
          this.entryFor(
            await this.resolveCodexHomeOwner(cachedCodexHomeOwner),
            'lane',
          ),
        ]
      : [];
  }

  private resolveCodexHomeOwner(
    cachedCodexHomeOwner?: QuotaOwnerRef,
  ): Promise<QuotaOwnerRef> {
    if (cachedCodexHomeOwner !== undefined) {
      return Promise.resolve(cachedCodexHomeOwner);
    }
    if (this.codexHomeOwnerInFlight !== null) return this.codexHomeOwnerInFlight;
    const read = this.owners.resolveCodexHomeOwner();
    this.codexHomeOwnerInFlight = read;
    void read
      .then((owner) => {
        if (this.retainNextCodexHomeOwner) {
          this.completedCodexHomeOwner = owner;
          this.retainNextCodexHomeOwner = false;
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.codexHomeOwnerInFlight === read) {
          this.codexHomeOwnerInFlight = null;
        }
      });
    return read;
  }

  /**
   * Enabled Ptah CLI agents on Ollama Cloud, each under its own key. A Ptah
   * CLI Claude lane has no owner until its run reads its own account, so it
   * is listed through that run's `ownerKeys` entry instead.
   */
  private async ptahCliLanes(): Promise<
    Array<DiscoveredPlanOwner | undefined>
  > {
    const agents = (await this.ptahCliAgents.listAgents()).filter(
      (agent) => agent.enabled && agent.providerId === 'ollama-cloud',
    );
    return Promise.all(
      agents.map(async (agent) =>
        this.entryFor(
          await this.owners.ownerForPtahCli(agent.id, agent.providerId),
          'lane',
          { ptahCliId: agent.id },
        ),
      ),
    );
  }

  /**
   * Known, in-scope owners from ledger evidence alone, never read. An owner
   * whose status `planOwnerRead` already knows keeps it (and its reason);
   * one that would need a live read is `service-unavailable`.
   */
  private ledgerOnly(
    owners: readonly QuotaOwnerRef[],
    origin: PlanOwnerOrigin,
  ): DiscoveredPlanOwner[] {
    const entries: DiscoveredPlanOwner[] = [];
    for (const owner of owners) {
      if (owner.identityKind === 'unknown') continue;
      const plan = planOwnerRead(owner);
      if (!plan) continue;
      entries.push(
        this.known(
          owner,
          plan.kind === 'known' ? plan : { status: 'service-unavailable' },
          origin,
        ),
      );
    }
    return entries;
  }

  // ------------------------------------------------------------ helpers

  /**
   * The input `resolveEffectiveAuthRoute` needs:
   * - the config is the active one (`ActiveProviderResolver`) when nothing is
   *   selected or the selection is the active provider; otherwise the auth
   *   method the selection implies (`claude-cli` → `claudeCli`, `anthropic` →
   *   `apiKey`, any other → `thirdParty` on that provider);
   * - the provider snapshot is the registry, plus the virtual direct
   *   Anthropic entry, typed as `llm:getProviderStatus` types them. Discovery
   *   probes nothing, so every status is `unknown`; the route's blockers are
   *   not used here.
   */
  private routeInput(selectedProviderId: string | undefined): {
    config: EffectiveRouteConfig;
    providers: EffectiveRouteProvider[];
  } {
    const active = this.activeAuth.resolveActiveAuth();
    const selected = selectedProviderId?.trim() || undefined;
    const activeIds =
      active.authMethod === 'claudeCli'
        ? [CLAUDE_CLI_PROVIDER_ID, ANTHROPIC_DIRECT_PROVIDER_ID]
        : [active.providerId];
    const config: EffectiveRouteConfig =
      selected === undefined || activeIds.includes(selected)
        ? {
            authMethod: active.authMethod,
            defaultProvider: null,
            anthropicProviderId:
              active.authMethod === 'thirdParty' ? active.providerId : null,
          }
        : {
            authMethod:
              selected === CLAUDE_CLI_PROVIDER_ID
                ? 'claudeCli'
                : selected === ANTHROPIC_DIRECT_PROVIDER_ID
                  ? 'apiKey'
                  : 'thirdParty',
            defaultProvider: null,
            anthropicProviderId: selected,
          };
    const providers: EffectiveRouteProvider[] = [
      { id: ANTHROPIC_DIRECT_PROVIDER_ID, type: 'apiKey', status: 'unknown' },
      ...getAllAnthropicProviders().map((provider): EffectiveRouteProvider => ({
        id: provider.id,
        type: routeProviderType(provider),
        status: 'unknown',
      })),
    ];
    return { config, providers };
  }

  /** The first requested, else any ledger-known, session on a native route. */
  private nativeSession(sessionIds: readonly string[]): string | undefined {
    const candidates = [
      ...sessionIds,
      ...Object.keys(this.ledger.sessionOwners()),
    ];
    return candidates.find(
      (sessionId) => this.probe.sessionRoute(sessionId)?.routeKind === 'native',
    );
  }

  private entryFor(
    owner: QuotaOwnerRef,
    origin: PlanOwnerOrigin,
    context: PlanOwnerReadContext = {},
  ): DiscoveredPlanOwner | undefined {
    const plan = planOwnerRead(owner, context);
    if (!plan) return undefined;
    return plan.kind === 'read'
      ? { kind: 'read', origin, target: plan.target }
      : this.known(owner, plan, origin);
  }

  private known(
    owner: QuotaOwnerRef,
    status: PlanOwnerKnownStatus,
    origin: PlanOwnerOrigin,
  ): DiscoveredPlanOwner {
    return {
      kind: 'known',
      origin,
      snapshot: snapshotWithoutRead(owner, status, this.ledger),
    };
  }

  /**
   * `read()`, or `undefined` when it throws or misses the lookup deadline;
   * the other sources go on. A late read cannot be cancelled, but its
   * result is ignored and its timer is released either way. Callers may retain
   * a completed result for the next refresh.
   */
  private async fromSource<T>(
    source: string,
    read: () => Promise<T>,
    onTimeout?: () => void,
  ): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), LIMIT_LOOKUP_DEADLINE_MS);
      timer.unref?.();
    });
    try {
      const result = await Promise.race([read(), deadline]);
      if (result === TIMED_OUT) {
        onTimeout?.();
        this.logger.debug('[PlanLimitOwnerDiscovery] source timed out', {
          source,
        });
        return undefined;
      }
      return result;
    } catch (error: unknown) {
      // degradation-audit: reported - logged at debug; this source is dropped
      // and the other sources still count.
      // Only the failure kind: a detection, registry or secret-store error
      // may quote a path or a stored value.
      this.logger.debug('[PlanLimitOwnerDiscovery] source dropped', {
        source,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return undefined;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

function ownerOf(entry: DiscoveredPlanOwner): QuotaOwnerRef {
  return entry.kind === 'read' ? entry.target.ownerRef : entry.snapshot.owner;
}

function isInstalled(
  detected: readonly CliDetectionResult[],
  cli: CliDetectionResult['cli'],
): boolean {
  return detected.some((result) => result.cli === cli && result.installed);
}

/**
 * The view's owner keys as full references. A key that is not canonical is
 * dropped: it came across RPC and names nobody this host can vouch for.
 */
function parseOwnerKeys(keys: readonly string[]): QuotaOwnerRef[] {
  const owners: QuotaOwnerRef[] = [];
  for (const key of keys) {
    let owner: QuotaOwnerRef | undefined;
    try {
      owner = parseQuotaOwnerRef(quotaOwnerRefFromKey(key));
    } catch {
      owner = undefined;
    }
    if (owner) owners.push(owner);
  }
  return owners;
}

/** A registry entry's auth modality, as `llm:getProviderStatus` reports it. */
function routeProviderType(
  provider: AnthropicProvider,
): EffectiveRouteProvider['type'] {
  if (provider.nativeAuth) return 'cli';
  if (provider.authType === 'oauth') return 'oauth';
  if (provider.isLocal) {
    return provider.requiresProxy ? 'local-proxy' : 'local-native';
  }
  return provider.authType === 'apiKey' ? 'apiKey' : 'unknown';
}
