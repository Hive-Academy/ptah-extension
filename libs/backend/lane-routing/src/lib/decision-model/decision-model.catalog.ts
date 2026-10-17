/**
 * Decision-model catalog (Component 8, Requirement 4, D3).
 *
 * Lists the models a host reports as `decision`-capable, for the picker only.
 * The list always comes from the host (4.6): no model id is fixed here, and
 * nothing in this class writes the selection.
 *
 * - `ollama`: `GET {ollamaBaseUrl}/api/tags`, then `POST /api/show {model}`
 *   per tag, at most `DECISION_MODEL_CATALOG_MAX_IN_FLIGHT` in flight across
 *   the instance. A model whose capabilities cannot be determined (failed
 *   lookup, or an older daemon without `capabilities`) is not listed (4.3).
 * - `ollama-cloud`: `GET https://ollama.com/api/tags` with no key; that list
 *   carries `capabilities` itself. Ids are canonicalised with `toCloudId`.
 *
 * `/api/show` answers are cached per `[baseUrl, name, digest]` (10 min for an
 * answer, 60 s for a failure, the TTLs of `ollama-model-discovery.service.ts`).
 * Entries missing from the latest tag list are pruned and a base URL change
 * clears the cache, so it is bounded by the daemon's model count (4.2).
 *
 * One abort budget covers a whole `list` call. An `/api/show` lookup shared
 * by concurrent calls has its own lifetime: it is abandoned only once every
 * call waiting on it has run out of budget, so one call's deadline never
 * cuts another call's answer short. A body longer than
 * `OLLAMA_CATALOG_MAX_BODY_CHARS` is not parsed, and tags past
 * `OLLAMA_CATALOG_MAX_MODELS` count as undetermined without a lookup.
 * `list` never rejects, and no host text (error message, body, URL) reaches
 * the result or a log line.
 *
 * The source and filter unions are the wire contract in
 * `@ptah-extension/shared` (`rpc-decision-model-catalog.types.ts`).
 */
import {
  loggableErrorName,
  toCloudId,
  type DecisionModelCatalogFilter,
  type DecisionModelCatalogSource,
} from '@ptah-extension/shared';
import type { LaneRoutingLogger } from '../lane-routing-logger';
import {
  OLLAMA_CATALOG_MAX_BODY_CHARS,
  OLLAMA_CATALOG_MAX_MODELS,
  OllamaShowResponseSchema,
  OllamaTagEntrySchema,
  OllamaTagsResponseSchema,
} from './ollama-catalog.schema';
import type { SystemOneFetch } from './system-one.client';

/** Budget of one `list` call; the picker's RPC timeout is 5000 ms. */
export const DECISION_MODEL_CATALOG_TIMEOUT_MS = 4000;
/** Cache lifetime of an `/api/show` answer and of the cloud tag list. */
export const DECISION_MODEL_CATALOG_ANSWER_TTL_MS = 10 * 60 * 1000;
/** Cache lifetime of a failed `/api/show` lookup. */
export const DECISION_MODEL_CATALOG_FAILURE_TTL_MS = 60 * 1000;
/** Most `/api/show` requests one catalog has in flight at once. */
export const DECISION_MODEL_CATALOG_MAX_IN_FLIGHT = 5;
/** Public ollama.com tag list; sent without a key. */
export const OLLAMA_CLOUD_TAGS_URL = 'https://ollama.com/api/tags';

/** The capability a model must report to be listed. */
const DECISION_CAPABILITY = 'decision';

export interface DecisionModelCatalogResult {
  /** Decision-capable model ids, in host order, without duplicates. */
  readonly models: readonly string[];
  readonly filter: DecisionModelCatalogFilter;
  /** How many listed tags could not be classified. */
  readonly undetermined: number;
}

/** The base URL source; `DecisionModelConfig` satisfies it. */
export interface DecisionModelCatalogConfig {
  /** Normalised daemon base URL, without trailing slashes. */
  ollamaBaseUrl(): string;
}

export interface DecisionModelCatalogSeams {
  /** Node's global `fetch` by default. */
  readonly fetch?: SystemOneFetch;
  readonly now?: () => number;
  /** `DECISION_MODEL_CATALOG_TIMEOUT_MS` by default. */
  readonly timeoutMs?: number;
}

type Capability = 'capable' | 'not-capable' | 'undetermined';

interface ShowCacheEntry {
  readonly capability: Capability;
  readonly expiresAt: number;
}

interface CatalogModel {
  readonly id: string;
  readonly digest: string;
  /** `undefined` when the host did not report capabilities. */
  readonly capabilities: readonly string[] | undefined;
}

/**
 * One `/api/show` lookup, shared by every concurrent call that needs it.
 * `controller` aborts the request once every signal in `callers` has.
 */
interface ShowLookup {
  readonly result: Promise<Capability>;
  readonly controller: AbortController;
  readonly callers: AbortSignal[];
}

/** A tag listing: parsed entries, and how many were past the cap. */
interface TagListing {
  /** Host order; `null` marks an entry that failed its schema. */
  readonly models: ReadonlyArray<CatalogModel | null>;
  /** Entries past `OLLAMA_CATALOG_MAX_MODELS`, never classified. */
  readonly overflow: number;
}

type JsonAnswer =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly timedOut: boolean };

type RequestStep = 'tags' | 'show';

interface CatalogRequestInit {
  readonly method: 'GET' | 'POST';
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

const UNAVAILABLE: DecisionModelCatalogResult = Object.freeze({
  models: Object.freeze([]),
  filter: 'unavailable',
  undetermined: 0,
});

export class DecisionModelCatalog {
  private readonly fetch: SystemOneFetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  /** Base URL the `/api/show` cache belongs to; a change clears it. */
  private showCacheBaseUrl: string | null = null;
  private readonly showCache = new Map<string, ShowCacheEntry>();
  private readonly showInFlight = new Map<string, ShowLookup>();
  private cloudCache: {
    readonly result: DecisionModelCatalogResult;
    readonly expiresAt: number;
  } | null = null;
  private activeShows = 0;
  private readonly showWaiters: Array<() => void> = [];

  constructor(
    /** `LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG` */
    private readonly config: DecisionModelCatalogConfig,
    /** `LANE_ROUTING_TOKENS.LOGGER` */
    private readonly logger: LaneRoutingLogger,
    seams: DecisionModelCatalogSeams = {},
  ) {
    this.fetch = seams.fetch ?? fetch;
    this.now = seams.now ?? Date.now;
    this.timeoutMs = seams.timeoutMs ?? DECISION_MODEL_CATALOG_TIMEOUT_MS;
  }

  /** The decision-capable models of `source`. Never rejects. */
  async list(
    source: DecisionModelCatalogSource,
  ): Promise<DecisionModelCatalogResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const result =
        source === 'ollama-cloud'
          ? await this.listCloud(controller.signal)
          : await this.listLocal(controller.signal);
      this.logger.debug('[lane-routing] decision model catalog', {
        source,
        filter: result.filter,
        models: result.models.length,
        undetermined: result.undetermined,
      });
      return result;
    } catch (error: unknown) {
      // degradation-audit: reported - the warn below records the failure.
      // The picker contract is a result, never a rejection (Component 8
      // failure behaviour); only the error name is logged because a message
      // can echo host text.
      this.logger.warn('[lane-routing] decision model catalog failed', {
        source,
        errorName: loggableErrorName(error),
      });
      return UNAVAILABLE;
    } finally {
      clearTimeout(timer);
    }
  }

  // ------------------------------------------------------------- cloud

  private async listCloud(
    signal: AbortSignal,
  ): Promise<DecisionModelCatalogResult> {
    const cached = this.cloudCache;
    if (cached !== null && cached.expiresAt > this.now()) {
      return cached.result;
    }
    const listing = await this.fetchTags(OLLAMA_CLOUD_TAGS_URL, signal);
    if (listing === null) return UNAVAILABLE;

    const ids: string[] = [];
    let undetermined = listing.overflow;
    for (const model of listing.models) {
      const capability = model === null ? 'undetermined' : classify(model);
      if (capability === 'undetermined') undetermined += 1;
      if (model !== null && capability === 'capable') {
        ids.push(toCloudId(model.id));
      }
    }
    const result = resultOf(ids, undetermined);
    this.cloudCache = {
      result,
      expiresAt: this.now() + DECISION_MODEL_CATALOG_ANSWER_TTL_MS,
    };
    return result;
  }

  // ------------------------------------------------------------- local

  private async listLocal(
    signal: AbortSignal,
  ): Promise<DecisionModelCatalogResult> {
    const baseUrl = this.config.ollamaBaseUrl();
    if (baseUrl !== this.showCacheBaseUrl) {
      this.showCache.clear();
      this.showInFlight.clear();
      this.showCacheBaseUrl = baseUrl;
    }
    const listing = await this.fetchTags(`${baseUrl}/api/tags`, signal);
    if (listing === null) return UNAVAILABLE;
    const { models } = listing;
    if (baseUrl === this.showCacheBaseUrl) {
      this.prune(models);
    }

    // A model not answered within this call's budget is undetermined for
    // this call; a lookup it shares with another call keeps running.
    const capabilities = await Promise.all(
      models.map((model) =>
        model === null
          ? Promise.resolve<Capability>('undetermined')
          : untilAborted(
              this.lookup(baseUrl, model, signal),
              signal,
              'undetermined',
            ),
      ),
    );
    const ids: string[] = [];
    let undetermined = listing.overflow;
    capabilities.forEach((capability, index) => {
      const model = models[index];
      if (capability === 'undetermined') undetermined += 1;
      if (model !== null && capability === 'capable') ids.push(model.id);
    });
    return resultOf(ids, undetermined);
  }

  /** Drops cached answers for models the latest tag list no longer has. */
  private prune(models: ReadonlyArray<CatalogModel | null>): void {
    const live = new Set<string>();
    for (const model of models) {
      if (model !== null) live.add(cacheKey(model));
    }
    for (const key of [...this.showCache.keys()]) {
      if (!live.has(key)) this.showCache.delete(key);
    }
  }

  private lookup(
    baseUrl: string,
    model: CatalogModel,
    signal: AbortSignal,
  ): Promise<Capability> {
    const key = cacheKey(model);
    const cached = this.showCache.get(key);
    if (cached !== undefined && cached.expiresAt > this.now()) {
      return Promise.resolve(cached.capability);
    }
    let lookup = this.showInFlight.get(key);
    // An abandoned lookup is still settling; it cannot answer a new caller.
    if (lookup === undefined || lookup.controller.signal.aborted) {
      lookup = this.startLookup(baseUrl, model, key);
    }
    joinLookup(lookup, signal);
    return lookup.result;
  }

  private startLookup(
    baseUrl: string,
    model: CatalogModel,
    key: string,
  ): ShowLookup {
    const controller = new AbortController();
    const result = this.show(baseUrl, model, controller.signal).finally(() => {
      if (this.showInFlight.get(key)?.result === result) {
        this.showInFlight.delete(key);
      }
    });
    const lookup: ShowLookup = { result, controller, callers: [] };
    this.showInFlight.set(key, lookup);
    return lookup;
  }

  private async show(
    baseUrl: string,
    model: CatalogModel,
    signal: AbortSignal,
  ): Promise<Capability> {
    await this.acquireShowSlot();
    try {
      // Every caller may have run out of budget while this lookup waited.
      if (signal.aborted) return 'undetermined';
      const answer = await this.requestJson(
        'show',
        `${baseUrl}/api/show`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: model.id }),
        },
        signal,
      );
      if (!answer.ok) {
        // A lookup cut short by the budget is not evidence about the model:
        // it is retried on the next call instead of cached as a failure.
        if (!answer.timedOut) {
          this.remember(baseUrl, model, 'undetermined', true);
        }
        return 'undetermined';
      }
      const parsed = OllamaShowResponseSchema.safeParse(answer.value);
      if (!parsed.success) {
        this.logger.warn('[lane-routing] decision model catalog bad answer', {
          step: 'show',
        });
        this.remember(baseUrl, model, 'undetermined', true);
        return 'undetermined';
      }
      const capability = classifyCapabilities(parsed.data.capabilities);
      this.remember(baseUrl, model, capability, false);
      return capability;
    } finally {
      this.releaseShowSlot();
    }
  }

  private remember(
    baseUrl: string,
    model: CatalogModel,
    capability: Capability,
    failed: boolean,
  ): void {
    // A base URL change while this lookup ran owns the cache now.
    if (baseUrl !== this.showCacheBaseUrl) return;
    const ttl = failed
      ? DECISION_MODEL_CATALOG_FAILURE_TTL_MS
      : DECISION_MODEL_CATALOG_ANSWER_TTL_MS;
    this.showCache.set(cacheKey(model), {
      capability,
      expiresAt: this.now() + ttl,
    });
  }

  private acquireShowSlot(): Promise<void> {
    if (this.activeShows < DECISION_MODEL_CATALOG_MAX_IN_FLIGHT) {
      this.activeShows += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.showWaiters.push(resolve));
  }

  /** Hands the slot to the next waiter, or frees it. */
  private releaseShowSlot(): void {
    const next = this.showWaiters.shift();
    if (next !== undefined) {
      next();
      return;
    }
    this.activeShows -= 1;
  }

  // ------------------------------------------------------------- shared

  /**
   * The parsed tag listing, capped at `OLLAMA_CATALOG_MAX_MODELS` entries.
   * `null` when the listing failed.
   */
  private async fetchTags(
    url: string,
    signal: AbortSignal,
  ): Promise<TagListing | null> {
    const answer = await this.requestJson(
      'tags',
      url,
      { method: 'GET' },
      signal,
    );
    if (!answer.ok) return null;
    const envelope = OllamaTagsResponseSchema.safeParse(answer.value);
    if (!envelope.success) {
      this.logger.warn('[lane-routing] decision model catalog bad answer', {
        step: 'tags',
      });
      return null;
    }
    const entries = envelope.data.models;
    const overflow = Math.max(0, entries.length - OLLAMA_CATALOG_MAX_MODELS);
    if (overflow > 0) {
      this.logger.warn('[lane-routing] decision model catalog list capped', {
        step: 'tags',
        limit: OLLAMA_CATALOG_MAX_MODELS,
        overflow,
      });
    }
    return {
      models: entries.slice(0, OLLAMA_CATALOG_MAX_MODELS).map(toCatalogModel),
      overflow,
    };
  }

  /**
   * One request bounded by `signal` (the call budget for a tag listing, the
   * shared lookup's lifetime for `/api/show`), even if `fetch` ignores it.
   */
  private requestJson(
    step: RequestStep,
    url: string,
    init: CatalogRequestInit,
    signal: AbortSignal,
  ): Promise<JsonAnswer> {
    return untilAborted(this.sendJson(step, url, init, signal), signal, {
      ok: false,
      timedOut: true,
    });
  }

  private async sendJson(
    step: RequestStep,
    url: string,
    init: CatalogRequestInit,
    signal: AbortSignal,
  ): Promise<JsonAnswer> {
    try {
      const response = await this.fetch(url, { ...init, signal });
      if (!response.ok) {
        this.logger.warn('[lane-routing] decision model catalog HTTP error', {
          step,
          status: response.status,
        });
        return { ok: false, timedOut: false };
      }
      const text = await response.text();
      if (text.length > OLLAMA_CATALOG_MAX_BODY_CHARS) {
        this.logger.warn(
          '[lane-routing] decision model catalog body too large',
          {
            step,
            limit: OLLAMA_CATALOG_MAX_BODY_CHARS,
          },
        );
        return { ok: false, timedOut: false };
      }
      const value: unknown = JSON.parse(text);
      return { ok: true, value };
    } catch (error: unknown) {
      // degradation-audit: reported - the warn below records the failure.
      // Classified by the abort signal, never by message: a message can echo
      // a header or URL, so only the error name is logged and the URL is not.
      const timedOut = signal.aborted;
      this.logger.warn('[lane-routing] decision model catalog request failed', {
        step,
        timedOut,
        timeoutMs: this.timeoutMs,
        errorName: loggableErrorName(error),
      });
      return { ok: false, timedOut };
    }
  }
}

/**
 * `work`, or `onAbort` as soon as `signal` aborts. `work` never rejects here
 * (every caller passes a promise that resolves on failure).
 */
function untilAborted<T>(
  work: Promise<T>,
  signal: AbortSignal,
  onAbort: T,
): Promise<T> {
  if (signal.aborted) return Promise.resolve(onAbort);
  return new Promise<T>((resolve) => {
    const abort = (): void => resolve(onAbort);
    signal.addEventListener('abort', abort, { once: true });
    void work.then((value) => {
      signal.removeEventListener('abort', abort);
      resolve(value);
    });
  });
}

/**
 * Adds `signal` to the callers of `lookup`. The lookup is aborted once every
 * caller's signal has aborted, and not before: one caller's deadline never
 * cuts short an answer another caller is still waiting for.
 */
function joinLookup(lookup: ShowLookup, signal: AbortSignal): void {
  lookup.callers.push(signal);
  const abandonIfUnwanted = (): void => {
    if (lookup.callers.every((caller) => caller.aborted)) {
      lookup.controller.abort();
    }
  };
  if (signal.aborted) {
    abandonIfUnwanted();
    return;
  }
  signal.addEventListener('abort', abandonIfUnwanted, { once: true });
  void lookup.result.then(() =>
    signal.removeEventListener('abort', abandonIfUnwanted),
  );
}

function toCatalogModel(entry: unknown): CatalogModel | null {
  const parsed = OllamaTagEntrySchema.safeParse(entry);
  if (!parsed.success) return null;
  const id = parsed.data.name ?? parsed.data.model;
  if (id === undefined) return null;
  return {
    id,
    digest: parsed.data.digest ?? '',
    capabilities: parsed.data.capabilities,
  };
}

function classify(model: CatalogModel): Capability {
  return classifyCapabilities(model.capabilities);
}

function classifyCapabilities(
  capabilities: readonly string[] | undefined,
): Capability {
  if (capabilities === undefined) return 'undetermined';
  return capabilities.includes(DECISION_CAPABILITY) ? 'capable' : 'not-capable';
}

/** Cache key within one base URL: `[name, digest]`. */
function cacheKey(model: CatalogModel): string {
  return JSON.stringify([model.id, model.digest]);
}

function resultOf(
  ids: readonly string[],
  undetermined: number,
): DecisionModelCatalogResult {
  return {
    models: [...new Set(ids)],
    filter: undetermined === 0 ? 'applied' : 'partial',
    undetermined,
  };
}
