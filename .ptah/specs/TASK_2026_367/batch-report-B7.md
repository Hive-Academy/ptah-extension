# Batch B7 — C3: OAuth discovery failure becomes an actionable UX

Branch: `fix/log-defects-367`. Plan section: §3 "C3 — OAuth discovery failure
becomes an actionable UX" (lines 213-351).

---

## What the batch changes

A server that publishes no OAuth authorization-server metadata is not a broken
OAuth server. It is a server that does not do OAuth at all, and it usually wants
an API key. Before this batch, `discoverAuthServerMetadata` threw a bare `Error`,
the RPC handler put its raw message on the wire, and the UI printed it. The user
who tried `https://mcp.firecrawl.dev` three times had no way to learn that.

The batch makes the failure a classified fact on the wire and turns it into one
sentence in the UI, plus an advisory pre-submit probe that says the same thing
before the browser ever opens.

---

## Files created

None. Both files the plan marked CREATE already existed on this branch, so both
were extended in place:

- `libs/backend/cli-agent-runtime/src/lib/mcp-directory/oauth/mcp-oauth-metadata.spec.ts`
- `libs/frontend/marketplace/src/lib/oauth-surface.component.spec.ts`

## Files modified (11)

| File                                                                               | Change                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/cli-agent-runtime/src/lib/mcp-directory/oauth/mcp-oauth-metadata.ts` | Adds `OAUTH_DISCOVERY_ERROR_NAME` and `OAuthDiscoveryError` (`override readonly name`, `readonly serverUrl`). `discoverAuthServerMetadata` now throws it. The message text is unchanged.                      |
| `libs/backend/cli-agent-runtime/src/lib/mcp-directory/oauth/mcp-oauth.service.ts`  | Adds `probeDiscovery(serverUrl)`: the two discovery calls `connect()` already performs first, and nothing else. No callback listener, no browser, no client registration.                                     |
| `libs/backend/cli-agent-runtime/src/lib/mcp-directory/index.ts`                    | Exports `OAuthDiscoveryError` and `OAUTH_DISCOVERY_ERROR_NAME`.                                                                                                                                               |
| `libs/shared/src/lib/types/mcp-directory.types.ts`                                 | Adds `McpOAuthFailureReason` (`'no-oauth-discovery' \| 'other'`), the additive `reason?` on `McpDirectoryConnectOAuthResult`, and `McpDirectoryProbeOAuthDiscoveryParams` / `...Result`.                      |
| `libs/shared/src/lib/types/rpc.types.ts`                                           | Registers `mcpDirectory:probeOAuthDiscovery` in BOTH places: the `RpcMethodRegistry` entry and the `RPC_METHOD_ENTRIES` mirror. Adds the two type imports.                                                    |
| `libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.schema.ts`           | Adds `ProbeOAuthDiscoverySchema = ConnectOAuthSchema.pick({ serverUrl: true })` — literally the same URL rule, not a copy of it.                                                                              |
| `libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.ts`         | `connectOAuth` classifies its caught error through a new `classifyOAuthFailure` helper. Adds `registerProbeOAuthDiscovery`, plus the method in `METHODS`, in `register()` and in the registration debug list. |
| `libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.spec.ts`    | 6 new assertions (below).                                                                                                                                                                                     |
| `libs/backend/cli-agent-runtime/.../mcp-oauth-metadata.spec.ts`                    | 2 new assertions (below).                                                                                                                                                                                     |
| `libs/frontend/marketplace/src/lib/oauth-surface.component.ts`                     | `discoveryHint` signal, debounced probe, inline note, classified `connect()` failure branch.                                                                                                                  |
| `libs/frontend/marketplace/src/lib/oauth-surface.component.spec.ts`                | 7 new assertions (below).                                                                                                                                                                                     |

No file outside the assigned list was touched. `ptah-cli/**`, the new `spawn/`
folder and `stream-event.transformer.ts` carry other agents' work and were left
alone.

---

## Spec assertions added

### `mcp-oauth-metadata.spec.ts` (2)

1. A server with no metadata endpoints rejects with an error whose `name` is
   `'OAuthDiscoveryError'` and whose `serverUrl` is the probed origin. The
   assertion also pins the constant's literal value, because the name is the
   cross-bundle contract.
2. The same rejection is an `instanceof OAuthDiscoveryError`.

### `mcp-directory-rpc.handlers.spec.ts` (6)

1. `connectOAuth` against a server whose discovery documents all 404 returns
   `{ success: false, reason: 'no-oauth-discovery' }`.
2. `connectOAuth` with an unrelated error (a Zod rejection on a non-URL) returns
   `reason: 'other'` — a typo must not advise an API key.
3. `probeOAuthDiscovery` returns `{ supported: false, reason: 'no-oauth-discovery' }`.
4. `probeOAuthDiscovery` returns `{ supported: true }` when metadata is published.
5. `probeOAuthDiscovery` rejects a non-URL param through Zod and makes no
   network call.
6. `probeOAuthDiscovery` is declared in the `METHODS` tuple.

### `oauth-surface.component.spec.ts` (7)

1. Typing a URL one character at a time produces exactly one probe call, and
   nothing goes out before 400 ms (`tick(399)` → 0 calls, `tick(1)` → 1 call).
2. A string that is not an absolute `https:` URL issues no probe at all and
   leaves the hint at `'none'`.
3. A `no-oauth-discovery` probe sets `discoveryHint` to `'needs-api-key'`,
   renders the sentence, and leaves the Connect button enabled.
4. A failed probe leaves the hint at `'none'`, sets no `connectError`, and
   renders nothing.
5. A probe answer that arrives after the URL changed is discarded.
6. A `connect()` failure with `reason: 'no-oauth-discovery'` renders the API-key
   sentence and NOT the raw "No OAuth authorization-server metadata found …"
   message.
7. A `connect()` failure with `reason: 'other'` still renders the raw error.

The RPC-registry compile check needs no spec: `_MissingRpcMethodNames` at
`rpc.types.ts` fails the build if either registration is missing, and
`npm run typecheck:all` exercises it.

---

## Verification results

```
npx nx run-many -t test -p @ptah-extension/cli-agent-runtime \
  @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/marketplace
```

Header read and confirmed: **"Running target test for 4 projects"**.

| Project                             | Suites         | Tests                                  |
| ----------------------------------- | -------------- | -------------------------------------- |
| `@ptah-extension/shared`            | 51 passed / 51 | 1231 passed                            |
| `@ptah-extension/marketplace`       | 10 passed / 10 | 171 passed                             |
| `@ptah-extension/cli-agent-runtime` | 44 passed / 44 | 540 passed                             |
| `@ptah-extension/rpc-handlers`      | 91 passed / 91 | 2625 passed, 31 skipped (pre-existing) |

Result: `Successfully ran target test for 4 projects`. Zero failures.

```
npx nx run-many -t lint -p <same four>
```

`Successfully ran target lint for 4 projects`. **0 errors, 19 warnings** — all
pre-existing (`max-lines` on other handler files, unused-var and non-null
warnings in files this batch did not touch).

```
npm run typecheck:all
```

`Successfully ran target typecheck for 70 projects`. Zero errors.

---

## Deviations from the plan

1. **Both "CREATE" spec files already existed.** `mcp-oauth-metadata.spec.ts`
   and `oauth-surface.component.spec.ts` were already on the branch. Extending
   them was the only correct action — overwriting either would have deleted
   working coverage.
2. **The probe schema reuses `ConnectOAuthSchema` by `.pick()` instead of
   re-declaring `z.string().url()`.** The plan says "the same URL rule". A
   `.pick()` IS the same rule; a second literal declaration is a copy that can
   drift.
3. **`fillSuggestion` also schedules a probe.** The plan names only `onUrlInput`.
   A quick-connect chip changes the URL exactly as typing does, and without this
   the hint would keep describing the previous URL. It cannot break the
   debounce-count assertion, which drives `onUrlInput` only.
4. **The `connect()` failure branch sets `connectError` and does not also set
   `discoveryHint`.** Setting both would render the same sentence twice — once
   in the error alert and once in the inline note. One rendering, one sentence.
5. **`registerProbeOAuthDiscovery` does not call `sentryService.captureException`,**
   unlike every neighbouring handler. A probe negative is the expected answer for
   a non-OAuth server, not an incident; reporting it would send one Sentry event
   per typed URL. It logs at `debug` instead.

## Anything left undone

Nothing in the batch scope. One thing to note rather than fix:

- `oauth-surface.component.ts` grew from 641 to 749 lines and now trips the
  700-line `max-lines` **warning** (warn-level, not an error — the lint run is
  green). The growth is 5 template lines plus three small private methods on the
  component that owns the connect form. Per the repo's own rule, line count
  alone is not the signal and a split is warranted past ~1000; splitting here
  would not pass the nameability test.
- The `reason` union stays at two values, as the plan requires.
  `'registration-failed'` and `'callback-timeout'` have no classifier and no UI
  copy, so they were not added.

DONE: B7 — OAuth discovery failures now carry a `no-oauth-discovery` reason and a debounced pre-submit probe tells the user to use an API key instead.
