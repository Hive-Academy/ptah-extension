# Code Logic Review — TASK_2026_372 (commit `1e812d663`)

**Verdict: CHANGES REQUIRED**
**Findings: 9 (3 high, 3 medium, 3 low)**
**Scope: behavioural correctness only. Style, naming and formatting are not in this review.**

## Summary

The core of the change is correct. `WebSearchService` holds all three parts of
the binding failure policy. `Promise.allSettled` isolates the providers,
`runProvider` never rejects, a missing API key becomes that provider's own
`missing-api-key` outcome, and the only throw is total failure with every
provider and reason in the message. The timeout timer is cleared in a `finally`
block, so it is cleared on both race outcomes and no timer leaks. The same is
true of `webSearch:test`. `formatWebSearch` renders the `Provider status`
section on success as well as on failure.

The defects are at the edges of that core.

Three of them are the write path. The new setting key `ptah.webSearch.providers`
is not a registered VS Code configuration, so every save from the settings panel
fails on the VS Code host. The settings component then ignores the failed result
and keeps showing the selection. The `ptah-cli` `websearch` command was not
migrated, so `ptah websearch config set --provider` is now a silent no-op and
`ptah websearch test` drops every per-provider reason. All existing tests pass
(992 in `vscode-lm-tools`, 2641 in `rpc-handlers`) because the affected paths are
covered against mocks that still assert the single-provider shape.

One finding is the re-assessment path itself: the `providers` MCP tool argument
is not validated, and a string value silently selects Tavily.

---

## F1 — `ptah.webSearch.providers` is not a registered VS Code setting, so every save fails on the VS Code host

**Severity: HIGH**
**`libs/backend/rpc-handlers/src/lib/handlers/web-search-rpc.handlers.ts:263`**

`webSearch:setConfig` calls `writeConfiguration('webSearch.providers', providers)`.
That reaches `VscodeWorkspaceProvider.setConfiguration`
(`libs/backend/platform-vscode/src/implementations/vscode-workspace-provider.ts:95`).
`webSearch.providers` is not in `FILE_BASED_SETTINGS_KEYS`
(`libs/backend/platform-core/src/file-settings-keys.ts:154` has no `webSearch`
entry), so the call falls through to
`vscode.workspace.getConfiguration('ptah').update(...)` at line 113.
`apps/ptah-extension-vscode/package.json:280` declares only
`ptah.webSearch.provider` and `ptah.webSearch.maxResults`. VS Code refuses
`update()` for a key that is not a registered configuration property.
`isDirtySettingsFailure` (line 122) finds no dirty `settings.json` document and
no `unsaved changes` text, so it returns `false` and the error is rethrown. The
repository already models this error path in
`libs/backend/platform-vscode/src/implementations/vscode-workspace-dirty-settings.spec.ts:113`.

**Failure scenario.** On the VS Code host, a user opens Settings > Web Search and
checks Serper. `webSearch:setConfig` throws. Nothing is written. The next search
still uses the legacy value. Selecting a provider is impossible on VS Code.

**Regression.** The pre-commit handler wrote `webSearch.provider`, which is
registered, so this path worked before the commit.

**Note.** Reads are unaffected. VS Code returns unregistered keys present in
`settings.json` through `get()`, and the Electron host writes to its own
`config.json` and needs no registration.

---

## F2 — A failed save is silent and leaves the panel showing a selection the backend did not store

**Severity: HIGH**
**`libs/frontend/chat/src/lib/settings/ptah-ai/web-search-config.component.ts:502`**

`saveConfig` awaits `rpcService.call('webSearch:setConfig', params)` and never
inspects the result. `ClaudeRpcService.call`
(`libs/frontend/core/src/lib/services/claude-rpc.service.ts:146`) returns
`new Promise((resolve) => ...)` and only ever calls `resolve`. A backend throw,
an RPC timeout and an abort all resolve an `RpcResult` with `success: false`.
The `try`/`catch` at lines 508-514 is therefore unreachable, and the failure
branch of `RpcResult` is never read. `saveApiKey` at line 417 checks
`result.isSuccess()`. `saveConfig` does not.

**Failure scenario.** `toggleProvider` (line 379) sets `selectedProviders` before
it calls `saveConfig`. The checkbox turns on, `saveConfig` swallows the failure,
and no error text appears. Under F1 this happens on every VS Code save. The user
sees Serper selected while the backend stores nothing. The same applies to
`onMaxResultsChange` at line 489: the slider moves and the value is discarded.

---

## F3 — `ptah websearch config set --provider <id>` is now a silent no-op

**Severity: HIGH**
**`apps/ptah-cli/src/cli/commands/websearch.ts:236`**

The commit changed the `webSearch:setConfig` parameter from `provider` to
`providers` but did not update the CLI. `runConfigSet` builds
`params['provider'] = opts.provider` and sends it. The handler
(`web-search-rpc.handlers.ts:261`) reads only `params.providers` and
`params.maxResults`, so an unknown `provider` key is ignored. The handler returns
`{ success: true }` because nothing threw. The CLI then emits a
`websearch.config` notification carrying the parameters it sent (line 243) and
exits `0`.

**Failure scenario.** `ptah websearch config set --provider serper` prints a
`websearch.config` notification naming `serper` and exits `0`. Nothing was
written. The command is declared in `apps/ptah-cli/src/cli/router.ts:2225`.

**Why the suite stayed green.** `apps/ptah-cli/src/cli/commands/websearch.spec.ts:320`
asserts `params: { provider: 'serper', maxResults: 10 }` against a mock
transport, so it pins the broken shape instead of catching it.

---

## F4 — `ptah websearch test` drops every per-provider reason

**Severity: MEDIUM**
**`apps/ptah-cli/src/cli/commands/websearch.ts:195`**

`runTest` types the response as `{ success?, provider?, error? }` and reads
`result?.provider` and `result?.error`. `webSearch:test` now returns
`{ success: boolean; results: Array<{ provider, success, error? }> }`
(`web-search-rpc.handlers.ts:211`). Both `provider` and `error` are `undefined`.

**Failure scenario.** Tavily has a key and passes. Serper has none. The handler
returns `success: true` with two entries. The CLI prints
`websearch.test { success: true, provider: undefined, error: undefined }`. The
Serper failure and its reason never reach the user, and the exit code is `0`.
This is the attribution requirement failing on the CLI surface.
`websearch.spec.ts:230` mocks the old payload, so the suite passes.

---

## F5 — `ptah websearch status` always reports Tavily

**Severity: MEDIUM**
**`apps/ptah-cli/src/cli/commands/websearch.ts:107`**

`runStatus` reads `config?.provider` from `webSearch:getConfig`, which now
returns `{ providers, maxResults }` (`web-search-rpc.handlers.ts:232`). The
field is `undefined`, so the expression falls through to the literal `'tavily'`.

**Failure scenario.** A user configured for `['serper']` runs
`ptah websearch status`. The output reports `provider: tavily` and the
`configured` flag for Tavily's key, not Serper's. A user who holds only a Serper
key is told that web search is unconfigured.

---

## F6 — The `providers` tool argument is unvalidated, so a string value silently selects Tavily

**Severity: MEDIUM**
**`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:811`**
**`libs/backend/vscode-lm-tools/src/lib/code-execution/services/web-search.service.ts:333`**

The dispatcher casts `args` to `{ providers?: string[] }` with no runtime check
and forwards it. `resolveProviders` tests `explicit && explicit.length > 0`,
which is true for a plain string. `normalizeProviders` (line 361) then iterates
that string with `for...of`, which yields characters. Every character fails the
`VALID_PROVIDERS` test, the list empties, and line 374 falls back to `['tavily']`.
The house rule requires a Zod schema at every external boundary, and AI tool
arguments are named in that rule.

**Failure scenario.** A `Provider status` section reports that Tavily failed and
Serper succeeded. The agent retries with
`ptah_web_search({ query: 'x', providers: 'serper' })`. Six warn lines are
logged, the call runs Tavily, and `outcomes` reports Tavily as though the agent
had asked for it. The retry runs against the provider that just failed, and the
agent cannot see that its override was discarded. This defeats the re-assessment
requirement.

An array of unknown names, for example `providers: ['bing']`, takes the same
fallback, but there `outcomes` names Tavily, so the substitution is at least
visible.

---

## F7 — The `maxResults` trim can discard every result of a provider still reported `ok`

**Severity: LOW**
**`libs/backend/vscode-lm-tools/src/lib/code-execution/services/web-search.service.ts:171`**

Each provider is asked for `maxResults` items and the merged list is then cut to
`maxResults`. The per-provider `resultCount` at line 238 counts what the adapter
returned, not what survived the cut.

**Failure scenario.** Providers `['tavily','serper']`, `maxResults` 5, each
returns 5 distinct URLs. The merged list holds 10 and is cut to the 5 Tavily
rows. `Provider status` reports `serper — ok (5 results)`, the outcome counts sum
to 10, the top-level `resultCount` is 5, and no result line names `serper` in its
`sources`. The agent is told that Serper contributed 5 results that it cannot
see.

This matches the contract as written, so it is a consequence of the contract
rather than a deviation. It is recorded because the `Provider status` section
exists to inform the agent, and here it misinforms it.

---

## F8 — `normalizeUrl` strips a trailing slash from the query string

**Severity: LOW**
**`libs/backend/vscode-lm-tools/src/lib/code-execution/services/web-search.service.ts:99`**

The trailing-slash strip is applied to the full serialized URL, not to the path.

**Failure scenario.** Tavily returns `https://example.com/a?b=1/` and Serper
returns `https://example.com/a?b=1`. The first serializes with a trailing `/`,
the strip removes it, both produce the same key, and the two are collapsed. Only
the first title and snippet survive. The second, genuinely different, page is
dropped and appears only as an extra entry in `sources`.

Two smaller inconsistencies sit in the same function. The parsed branch removes
one trailing slash with `slice(0, -1)`, so `https://example.com/p//` and
`https://example.com/p` do not collapse. The unparseable branch at line 101 uses
`\/+$` and also lower-cases the whole string including the path, so the two
branches apply different rules to the same input class.

---

## F9 — A failed config load leaves the panel showing zero providers and no message

**Severity: LOW**
**`libs/frontend/chat/src/lib/settings/ptah-ai/web-search-config.component.ts:330`**

`loadConfig` sets state only inside `if (configResult.isSuccess())`. There is no
`else`. Because `ClaudeRpcService.call` never rejects (see F2), the `catch` at
line 335 is unreachable, so a failed load sets no `errorMessage` either.
`selectedProviders` stays the initial empty `Set`.

**Failure scenario.** `webSearch:getConfig` returns a failure result. Every
checkbox renders unchecked while the backend still resolves `['tavily']`. The
zero-provider guard in `toggleProvider` (line 369) does not fire, because it only
blocks the removal of the last member of a non-empty set. If the user then checks
Serper, `saveConfig` writes `['serper']` and the previously configured Tavily is
discarded without a prompt.

---

## Checked and found correct

- **Isolation.** `runProvider` (`web-search.service.ts:201`) wraps the key
  lookup, the adapter construction and the timed search in one `try`/`catch` and
  returns an outcome on every branch. It cannot reject. `Promise.allSettled` at
  line 134 is used as the contract requires, and
  `attemptFromUnexpectedRejection` (line 280) covers the branch that cannot be
  reached today.
- **Total failure is the only throw.** Line 163 throws only when
  `succeeded.length === 0`. A provider that returns zero results still carries a
  non-null `result`, so it counts as a success and does not push the call to the
  throw. `status` at line 175 is `partial` whenever any provider failed. There is
  no path where a partial success is reported as total failure, or the reverse.
- **Timer discipline.** `createTimeoutPromise` (line 424) returns the handle and
  `runProvider` clears it in `finally` (line 251), which runs on both race
  outcomes. On the success outcome the `await` continuation is a microtask, so
  the timer is cleared before the timer macrotask can fire and the timeout
  promise never rejects unobserved. `testProvider`
  (`web-search-rpc.handlers.ts:382`) follows the same pattern and is equally
  sound. No leaked timer and no unhandled rejection were found in the parallel
  path.
- **`webSearch:test` isolation.** `testProvider` returns rather than throws on
  every branch, and the `allSettled` wrapper at line 192 covers the branch that
  cannot be reached. `success` is `results.some(...)`, matching the contract.
- **Legacy read migration.** Both readers handle a stale legacy value, an empty
  array, a non-array value and an unknown provider name.
  `WebSearchService.readConfiguredList` (line 342) guards with `Array.isArray`
  before it accepts the list, and `readProvidersConfig`
  (`web-search-rpc.handlers.ts:300`) does the same and additionally checks
  `typeof provider === 'string'`. Both end at `['tavily']` when the list empties,
  and both warn on a dropped name. `setConfig` clears the legacy key (line 264)
  so the two cannot disagree after a write.
- **Zero providers selected.** `toggleProvider` refuses to remove the last
  selected provider, and `WebSearchProvidersSchema`
  (`web-search-rpc.schema.ts:41`) rejects an empty array at the RPC boundary. F9
  is the one state that reaches an empty display, and it cannot be persisted.
- **Attribution rendering.** `formatWebSearch`
  (`mcp-response-formatter.ts:706`) renders `Provider status` whenever
  `outcomes` is non-empty, success included, and each result line names its
  `sources`.
- **Merge order and summary.** `mergeResults` (line 293) preserves selection
  order, keeps the first title and snippet, and appends later providers to
  `sources` without duplicates. The native summary is taken from the first
  successful provider in selection order.
