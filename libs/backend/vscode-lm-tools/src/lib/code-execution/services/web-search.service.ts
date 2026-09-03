/**
 * WebSearchService - Parallel Multi-Provider Web Search
 *
 * Queries EVERY selected provider (Tavily, Serper, Exa) in parallel and merges
 * the results. Providers are isolated: one failing never affects another, and a
 * missing API key is that provider's own failure rather than a thrown error.
 * The call throws only when every selected provider failed.
 *
 * Reads provider configuration from IWorkspaceProvider and API keys from
 * ISecretStorage. Both dependencies are platform-abstracted, supporting VS Code
 * and Electron equally.
 *
 * Configuration:
 *   - Providers: ptah.webSearch.providers (settings) -> string[]
 *     Legacy single-value key ptah.webSearch.provider is still read as a
 *     fallback for installs that predate the list.
 *   - Max results: ptah.webSearch.maxResults (settings) -> number (default 5)
 *   - API keys: ptah.webSearch.apiKey.{provider} (SecretStorage, encrypted)
 */

import type { ISecretStorage } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';

import type {
  IWebSearchProvider,
  WebSearchAttributedResultItem,
  WebSearchFailureReason,
  WebSearchProviderOutcome,
  WebSearchProviderResult,
  WebSearchProviderType,
  WebSearchResultItem,
} from './web-search-provider.interface';
import { TavilySearchProvider } from './providers/tavily.provider';
import { SerperSearchProvider } from './providers/serper.provider';
import { ExaSearchProvider } from './providers/exa.provider';

export interface WebSearchDependencies {
  secretStorage: ISecretStorage;
  workspaceProvider: IWorkspaceProvider;
  logger: Logger;
}

export interface WebSearchOptions {
  maxResults?: number;
  timeout?: number;
  /** Overrides the configured provider set for this one call. */
  providers?: WebSearchProviderType[];
}

export interface WebSearchResult {
  query: string;
  summary: string;
  /** The providers actually attempted, in selection order. */
  providers: WebSearchProviderType[];
  /** 'ok' = every provider succeeded. 'partial' = at least one of each. */
  status: 'ok' | 'partial';
  durationMs: number;
  results: WebSearchAttributedResultItem[];
  resultCount: number;
  /** One entry per selected provider, ok and failed alike. */
  outcomes: WebSearchProviderOutcome[];
}

const MAX_QUERY_LENGTH = 2000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESULTS = 5;

const VALID_PROVIDERS: WebSearchProviderType[] = ['tavily', 'serper', 'exa'];

/**
 * Secret key pattern for storing provider API keys.
 * Example: ptah.webSearch.apiKey.tavily
 */
function secretKeyForProvider(provider: WebSearchProviderType): string {
  return `ptah.webSearch.apiKey.${provider}`;
}

/** Raised by the per-provider timeout race so the reason can be classified. */
class WebSearchTimeoutError extends Error {}

/** One provider's attempt: always an outcome, plus its payload when it worked. */
interface ProviderAttempt {
  outcome: WebSearchProviderOutcome;
  result?: WebSearchProviderResult;
}

/**
 * Normalize a URL for cross-provider de-duplication: drop the fragment and
 * strip every trailing slash from the PATH.
 *
 * The strip applies to the path alone. A trailing slash inside a query string
 * is significant, so `https://example.com/a?b=1/` and `https://example.com/a?b=1`
 * are two different pages and must not collapse. The case of a path is also
 * significant, so a path is never case-folded; `new URL` already lower-cases
 * the scheme and the host, which are the only parts that are case-insensitive.
 *
 * An unparseable URL takes the same rule applied to the raw string: trim, drop
 * the fragment, then strip trailing slashes from the part before the query.
 */
function stripTrailingSlashes(path: string): string {
  return path.replace(/\/+$/, '');
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.pathname = stripTrailingSlashes(parsed.pathname) || '/';
    return parsed.toString();
  } catch {
    const withoutFragment = url.trim().replace(/#.*$/, '');
    const queryAt = withoutFragment.indexOf('?');
    if (queryAt === -1) {
      return stripTrailingSlashes(withoutFragment);
    }
    return (
      stripTrailingSlashes(withoutFragment.slice(0, queryAt)) +
      withoutFragment.slice(queryAt)
    );
  }
}

export class WebSearchService {
  constructor(private readonly deps: WebSearchDependencies) {}

  async search(
    query: string,
    options?: WebSearchOptions,
  ): Promise<WebSearchResult> {
    const trimmed = query?.trim();
    if (!trimmed) {
      throw new Error('Web search query must not be empty');
    }
    const sanitizedQuery =
      trimmed.length > MAX_QUERY_LENGTH
        ? trimmed.substring(0, MAX_QUERY_LENGTH)
        : trimmed;
    const timeout = Math.min(
      options?.timeout ?? DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    );
    const providers = this.resolveProviders(options?.providers);
    const configMaxResults =
      this.deps.workspaceProvider.getConfiguration<number>(
        'ptah',
        'webSearch.maxResults',
        DEFAULT_MAX_RESULTS,
      ) ?? DEFAULT_MAX_RESULTS;
    const maxResults = options?.maxResults ?? configMaxResults;

    const start = Date.now();
    const settled = await Promise.allSettled(
      providers.map((provider) =>
        this.runProvider(provider, sanitizedQuery, maxResults, timeout),
      ),
    );
    const attempts = settled.map((entry, index) =>
      entry.status === 'fulfilled'
        ? entry.value
        : this.attemptFromUnexpectedRejection(providers[index], entry.reason),
    );
    const durationMs = Date.now() - start;

    const outcomes = attempts.map((attempt) => attempt.outcome);
    for (const outcome of outcomes) {
      if (outcome.status === 'failed') {
        this.deps.logger.warn(
          `[WebSearch] Failed via ${outcome.provider}`,
          'WebSearchService',
          {
            query: sanitizedQuery.substring(0, 80),
            durationMs: outcome.durationMs,
            reason: outcome.reason,
            error: outcome.message,
          },
        );
      }
    }

    const succeeded = attempts.filter((attempt) => attempt.result != null);
    if (succeeded.length === 0) {
      throw new Error(
        `Web search failed on all providers: ${outcomes
          .map((o) => `${o.provider} (${o.reason}: ${o.message})`)
          .join('; ')}`,
      );
    }

    const results = this.mergeResults(attempts).slice(0, maxResults);
    const nativeSummary = succeeded.find((attempt) => attempt.result?.summary)
      ?.result?.summary;
    const summary = nativeSummary || this.buildSummaryFromResults(results);
    const status = succeeded.length === attempts.length ? 'ok' : 'partial';

    this.deps.logger.info('[WebSearch] Completed', 'WebSearchService', {
      providers,
      status,
      query: sanitizedQuery.substring(0, 80),
      resultCount: results.length,
      durationMs,
    });

    return {
      query: sanitizedQuery,
      summary,
      providers,
      status,
      durationMs,
      results,
      resultCount: results.length,
      outcomes,
    };
  }

  /**
   * Run one provider end to end — key lookup, adapter construction and the
   * timed search — and reduce every branch to an outcome. This never rejects.
   */
  private async runProvider(
    providerName: WebSearchProviderType,
    query: string,
    maxResults: number,
    timeout: number,
  ): Promise<ProviderAttempt> {
    const start = Date.now();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      const apiKey = await this.deps.secretStorage.get(
        secretKeyForProvider(providerName),
      );
      if (!apiKey?.trim()) {
        return this.failedAttempt(
          providerName,
          'missing-api-key',
          `No API key configured for ${providerName}. ` +
            `Configure it in Ptah Settings > Web Search.`,
          Date.now() - start,
        );
      }

      const provider = this.createProvider(providerName, apiKey);
      const timeoutHandle = this.createTimeoutPromise(timeout);
      timeoutId = timeoutHandle.timerId;
      const result = await Promise.race([
        provider.search(query, maxResults),
        timeoutHandle.promise,
      ]);

      return {
        result,
        outcome: {
          provider: providerName,
          status: 'ok',
          durationMs: Date.now() - start,
          resultCount: result.results.length,
        },
      };
    } catch (error: unknown) {
      const reason: WebSearchFailureReason =
        error instanceof WebSearchTimeoutError ? 'timeout' : 'provider-error';
      const message = error instanceof Error ? error.message : String(error);
      return this.failedAttempt(
        providerName,
        reason,
        message,
        Date.now() - start,
      );
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  private failedAttempt(
    provider: WebSearchProviderType,
    reason: WebSearchFailureReason,
    message: string,
    durationMs: number,
  ): ProviderAttempt {
    return {
      outcome: {
        provider,
        status: 'failed',
        durationMs,
        resultCount: 0,
        reason,
        message,
      },
    };
  }

  /**
   * `runProvider` is written not to reject, but `Promise.allSettled` still
   * reports a rejection if it ever does. Treat it as that provider's failure.
   */
  private attemptFromUnexpectedRejection(
    provider: WebSearchProviderType,
    reason: unknown,
  ): ProviderAttempt {
    const message = reason instanceof Error ? reason.message : String(reason);
    return this.failedAttempt(provider, 'provider-error', message, 0);
  }

  /**
   * Interleave the successful providers round-robin — every provider's first
   * result, then every provider's second, and so on — then collapse duplicates
   * by normalized URL. The first occurrence keeps its title and snippet; every
   * later duplicate only appends its provider to `sources`. Selection order is
   * the tie-break inside one round.
   *
   * The merge is round-robin rather than provider-by-provider so that the
   * `maxResults` trim samples every provider. A concatenated merge let the trim
   * discard every row of a provider the `Provider status` section still
   * reported as `ok`, which told the agent about results it could not see.
   */
  private mergeResults(
    attempts: ProviderAttempt[],
  ): WebSearchAttributedResultItem[] {
    const byUrl = new Map<string, WebSearchAttributedResultItem>();
    const merged: WebSearchAttributedResultItem[] = [];
    const succeeded = attempts.filter(
      (
        attempt,
      ): attempt is ProviderAttempt & { result: WebSearchProviderResult } =>
        attempt.result != null,
    );
    const deepest = succeeded.reduce(
      (longest, attempt) => Math.max(longest, attempt.result.results.length),
      0,
    );

    for (let round = 0; round < deepest; round++) {
      for (const attempt of succeeded) {
        const item = attempt.result.results[round];
        if (!item) {
          continue;
        }
        const provider = attempt.outcome.provider;
        const key = normalizeUrl(item.url);
        const existing = byUrl.get(key);
        if (existing) {
          if (!existing.sources.includes(provider)) {
            existing.sources.push(provider);
          }
          continue;
        }
        const attributed: WebSearchAttributedResultItem = {
          ...item,
          sources: [provider],
        };
        byUrl.set(key, attributed);
        merged.push(attributed);
      }
    }

    return merged;
  }

  /**
   * Selection order: the explicit override, else the configured list, else
   * `['tavily']`. Invalid entries are dropped with a warning.
   */
  private resolveProviders(
    explicit?: WebSearchProviderType[],
  ): WebSearchProviderType[] {
    const raw =
      explicit && explicit.length > 0 ? explicit : this.readConfiguredList();
    return this.normalizeProviders(raw);
  }

  /**
   * Read `webSearch.providers`. When it is absent or empty, fall back to the
   * legacy single `webSearch.provider` string, then to 'tavily'. Existing
   * installs still carry the legacy key on disk.
   */
  private readConfiguredList(): string[] {
    const configured = this.deps.workspaceProvider.getConfiguration<string[]>(
      'ptah',
      'webSearch.providers',
      [],
    );
    if (Array.isArray(configured) && configured.length > 0) {
      return configured;
    }
    const legacy = this.deps.workspaceProvider.getConfiguration<string>(
      'ptah',
      'webSearch.provider',
      'tavily',
    );
    return [legacy || 'tavily'];
  }

  private normalizeProviders(raw: string[]): WebSearchProviderType[] {
    const selected: WebSearchProviderType[] = [];
    for (const entry of raw) {
      if (!VALID_PROVIDERS.includes(entry as WebSearchProviderType)) {
        this.deps.logger.warn(
          `[WebSearch] Unknown provider "${entry}", ignoring`,
          'WebSearchService',
        );
        continue;
      }
      const provider = entry as WebSearchProviderType;
      if (!selected.includes(provider)) {
        selected.push(provider);
      }
    }
    if (selected.length === 0) {
      this.deps.logger.warn(
        '[WebSearch] No valid provider configured, falling back to tavily',
        'WebSearchService',
      );
      return ['tavily'];
    }
    return selected;
  }

  /**
   * Factory method to create the appropriate provider adapter.
   * Providers are cheap to instantiate (just stores API key).
   */
  private createProvider(
    providerName: WebSearchProviderType,
    apiKey: string,
  ): IWebSearchProvider {
    switch (providerName) {
      case 'tavily':
        return new TavilySearchProvider(apiKey);
      case 'serper':
        return new SerperSearchProvider(apiKey);
      case 'exa':
        return new ExaSearchProvider(apiKey);
      default: {
        const _exhaustive: never = providerName;
        throw new Error(`Unknown web search provider: ${_exhaustive}`);
      }
    }
  }

  /**
   * Build a fallback summary by concatenating top result snippets
   * when no provider supplies a native summary.
   */
  private buildSummaryFromResults(results: WebSearchResultItem[]): string {
    if (!results || results.length === 0) {
      return 'No results found.';
    }

    const topResults = results.slice(0, 3);
    return topResults
      .map((r, i) => `${i + 1}. ${r.title}: ${r.snippet}`)
      .join('\n\n');
  }

  /**
   * Create a timeout promise that rejects after the specified duration.
   */
  private createTimeoutPromise(timeoutMs: number): {
    promise: Promise<never>;
    timerId: ReturnType<typeof setTimeout> | undefined;
  } {
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const promise = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => {
        reject(
          new WebSearchTimeoutError(
            `Search timed out after ${(timeoutMs / 1000).toFixed(0)}s`,
          ),
        );
      }, timeoutMs);
    });
    return { promise, timerId };
  }
}
