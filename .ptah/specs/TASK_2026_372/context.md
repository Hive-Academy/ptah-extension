# TASK_2026_372 — Parallel multi-provider web search

## Intent

Today Ptah routes every web search to exactly ONE provider. `WebSearchService`
reads `ptah.webSearch.provider` (a single string), builds one adapter, and
throws if that adapter fails. A user who has both a Serper key and a Tavily key
can use only one of them.

The user wants to select several providers and have Ptah query all of them.

## User-decided failure policy (BINDING)

> "A failure of one provider shouldn't affect the other one, and the agent
> should know the reason and be able to re-assess the search with the working
> provider if possible."

Three consequences, all mandatory:

1. **Isolation** — one provider failing NEVER fails the call while another
   provider returned results. Use `Promise.allSettled`, never `Promise.all`.
2. **Attribution** — the response carries a per-provider outcome for EVERY
   selected provider, with a machine-readable `reason` and a human message.
   An empty result set and a failed provider must never look the same.
3. **Re-assessment** — the agent can retry a narrowed search. `ptah_web_search`
   takes an optional `providers` argument that overrides the configured set for
   that one call.

## The contract (do not deviate — four batches implement against this)

### 1. Types — `libs/backend/vscode-lm-tools/src/lib/code-execution/services/web-search-provider.interface.ts`

Keep `WebSearchResultItem`, `WebSearchProviderResult`, `WebSearchProviderType`
and `IWebSearchProvider` exactly as they are. Provider adapters do not change.

Add:

```ts
export type WebSearchFailureReason = 'missing-api-key' | 'timeout' | 'provider-error';

/** Per-provider outcome. Present for EVERY selected provider, ok or not. */
export interface WebSearchProviderOutcome {
  provider: WebSearchProviderType;
  status: 'ok' | 'failed';
  durationMs: number;
  resultCount: number;
  /** Present only when status is 'failed'. */
  reason?: WebSearchFailureReason;
  /** Present only when status is 'failed'. Human-readable cause. */
  message?: string;
}

/** A result item tagged with the providers that returned it. */
export interface WebSearchAttributedResultItem extends WebSearchResultItem {
  /** Every provider that returned this URL, in selection order. */
  sources: WebSearchProviderType[];
}
```

### 2. `WebSearchService` — same file directory, `web-search.service.ts`

`WebSearchResult` becomes:

```ts
export interface WebSearchResult {
  query: string;
  summary: string;
  /** The providers actually attempted, in selection order. */
  providers: WebSearchProviderType[];
  /** 'ok' = every provider succeeded. 'partial' = at least one ok and at least one failed. */
  status: 'ok' | 'partial';
  durationMs: number;
  results: WebSearchAttributedResultItem[];
  resultCount: number;
  /** One entry per selected provider, ok and failed alike. */
  outcomes: WebSearchProviderOutcome[];
}
```

`WebSearchOptions` gains `providers?: WebSearchProviderType[]`.

Behaviour:

- **Selection order** = `options.providers` when given, otherwise the configured
  list, otherwise `['tavily']`. De-duplicate, preserve order.
- **Per-provider work** is independent: read that provider's key from
  `ISecretStorage` (`ptah.webSearch.apiKey.{provider}`), build its adapter, run
  `search` under the SAME per-provider timeout the current code uses. A missing
  key is that provider's own `missing-api-key` failure — it must NOT throw and
  must NOT stop the others.
- **Run with `Promise.allSettled`.** Every branch resolves into a
  `WebSearchProviderOutcome`.
- **Merge**: concatenate results in selection order, then de-duplicate by
  normalized URL (lower-case host, strip a trailing slash, strip the fragment).
  The FIRST occurrence wins its title and snippet; each later duplicate appends
  its provider to `sources`.
- **Trim** the merged list to `maxResults`.
- **Summary**: prefer the first non-empty native `summary` in selection order
  (Tavily supplies one). Otherwise fall back to the existing
  `buildSummaryFromResults`.
- **Total failure is the ONLY throw.** When every selected provider failed,
  throw one `Error` whose message names each provider and its reason, e.g.
  `Web search failed on all providers: tavily (timeout: Search timed out after
30s); serper (missing-api-key: No API key configured for serper)`. Any
  partial success returns normally with `status: 'partial'`.
- Log one line per failed provider at `warn` and one completion line at `info`
  carrying `providers`, `status` and `resultCount`.

### 3. Configuration read

The setting becomes a list: `ptah.webSearch.providers` (`string[]`).

**Read migration, one place, keep it:** when `webSearch.providers` is absent or
empty, fall back to the legacy single `webSearch.provider` string, then to
`'tavily'`. Existing installs have the legacy key on disk. Drop any entry that
is not in `VALID_PROVIDERS` and log a warn naming it; if that empties the list,
use `['tavily']`.

`webSearch.maxResults` is unchanged.

### 4. MCP surface — `libs/backend/vscode-lm-tools/src/lib/code-execution/`

- `mcp-core/tool-description.builder.ts` — `buildWebSearchTool()` gains an
  optional `providers` property: an array of strings, enum
  `['tavily','serper','exa']`. Describe it as an override of the user's
  configured set, and tell the model to use it to RETRY with the providers that
  worked when a previous call reported a failure.
- `mcp-core/protocol-dispatcher.ts` — the `ptah_web_search` case forwards
  `providers` through to `webSearch.search`.
- `mcp-core/mcp-response-formatter.ts` — `formatWebSearch` replaces the single
  `**Provider:**` line with a `Provider status` section listing every outcome:
  provider, ok or failed, result count, and for a failure the reason and the
  message. This section is what lets the agent re-assess, so it must render even
  when every provider succeeded. Each result line names its `sources`.
- `types.ts` — widen the `PtahAPI.webSearch.search` signature to match the new
  options and result. Keep it structurally typed as it is now.

### 5. RPC — `libs/backend/rpc-handlers/src/lib/handlers/`

- `web-search-rpc.schema.ts` — keep `SECRET_KEY_PREFIX`, `VALID_PROVIDERS` and
  `WebSearchProviderSchema` unchanged. Add
  `WebSearchProvidersSchema = z.array(WebSearchProviderSchema).min(1)`.
- `web-search-rpc.handlers.ts`:
  - `webSearch:getConfig` returns `{ providers: string[]; maxResults: number }`.
    It applies the same legacy-key read migration described above.
  - `webSearch:setConfig` accepts `{ providers?: string[]; maxResults?: number }`
    and writes `webSearch.providers`. Validate with `WebSearchProvidersSchema`.
    When it writes `providers`, it also clears the legacy `webSearch.provider`
    key (write `undefined`) so the two can never disagree.
  - `webSearch:test` tests EVERY configured provider, in parallel, isolated, and
    returns `{ success: boolean; results: Array<{ provider: string; success:
boolean; error?: string }> }`. `success` is true when at least one provider
    passed.
  - `getApiKeyStatus`, `setApiKey` and `deleteApiKey` stay per-provider and are
    unchanged.

### 6. Settings UI — `libs/frontend/chat/src/lib/settings/ptah-ai/web-search-config.component.ts`

- The provider `select` becomes a multi-select: one checkbox per provider, each
  row showing whether that provider has a key stored. Refusing to leave zero
  providers selected is the component's job.
- API key entry stays per provider. The key form targets whichever provider row
  the user expands or focuses. Keep `data-testid` attributes stable where they
  exist; where a testid must change, keep the `settings-toggle-web-search-`
  prefix.
- The test button shows a per-provider pass or fail line from the new
  `webSearch:test` payload.
- `ChangeDetectionStrategy.OnPush` and signals only. No new sanitizer, no
  `[innerHTML]`.

## House rules that apply

- `catch (error: unknown)`, narrow with `instanceof Error` before `.message`.
- No `@ts-ignore`. No new backwards-compatibility shim beyond the ONE legacy
  settings read named above.
- Update the existing spec files beside every file you change. Do not leave a
  spec asserting the single-provider shape.
- Do not add a new lib, a new DI token or a new RPC namespace. This is a change
  to existing surfaces only.
