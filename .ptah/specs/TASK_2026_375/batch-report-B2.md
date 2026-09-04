# TASK_2026_375 — Batch report B2

**Batch**: B2 — Smithery Connections API (backend + shared contract)
**Libs**: `libs/shared`, `libs/backend/cli-agent-runtime`, `libs/backend/rpc-handlers`
**Status**: complete.

---

## Files changed

| File                                                                      | Part | Change                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/shared/src/lib/types/mcp-directory.types.ts`                        | B2.1 | `SmitheryInstalledRecord` gains `namespace?` + `connectionId?`; new `SmitheryConnectionStatus`, `SmitheryConnectionSummary`; four new param/result pairs; `McpDirectoryInstallSmitheryResult` gains `status`/`setupUrl`/`namespace`/`connectionId`. |
| `libs/shared/src/lib/types/rpc.types.ts`                                  | B2.1 | Four `RpcMethodMap` entries + four `RPC_METHOD_NAMES` entries + the type imports.                                                                                                                                                                   |
| `libs/backend/cli-agent-runtime/.../smithery-connections.client.ts`       | B2.2 | **NEW.** `SmitheryConnectionsClient` + status normalizer + Ptah metadata helpers.                                                                                                                                                                   |
| `libs/backend/cli-agent-runtime/.../smithery-connections.client.spec.ts`  | B2.2 | **NEW.** 26 cases pinning the documented JSON shapes.                                                                                                                                                                                               |
| `libs/backend/cli-agent-runtime/.../smithery-errors.ts`                   | B2.2 | New `SmitheryApiError { status, message }`.                                                                                                                                                                                                         |
| `libs/backend/cli-agent-runtime/.../smithery-wire.constants.ts`           | B2.2 | `SMITHERY_API_BASE`, `SMITHERY_NAMESPACE_MCP_HOST`, `buildSmitheryNamespaceUrl()`; all seven `[VERIFY]` comments dropped and replaced with the one legacy note.                                                                                     |
| `libs/backend/cli-agent-runtime/.../smithery-installed-manifest.ts`       | B2.3 | `SmitheryInstallInput` gains `namespace?` / `connectionId?`; record carries them; new `get(serverKey)` with `refresh()` first.                                                                                                                      |
| `libs/backend/cli-agent-runtime/.../smithery-installed-manifest.spec.ts`  | B2.3 | New `Connections API fields` block, 4 cases.                                                                                                                                                                                                        |
| `libs/backend/cli-agent-runtime/.../smithery-connection-resolver.ts`      | B2.4 | New `resolveNamespace(namespace)` + `namespaceHost` option.                                                                                                                                                                                         |
| `libs/backend/cli-agent-runtime/.../smithery-connection-resolver.spec.ts` | B2.4 | New `resolveNamespace` describe, 4 cases.                                                                                                                                                                                                           |
| `libs/backend/cli-agent-runtime/.../smithery-override-resolver.ts`        | B2.4 | Splits records into Connections-API vs legacy; one `smithery` override for the namespace; new `SMITHERY_NAMESPACE_OVERRIDE_KEY`.                                                                                                                    |
| `libs/backend/cli-agent-runtime/.../smithery-override-resolver.spec.ts`   | B2.4 | 7 new cases; every pre-existing case kept and still passes.                                                                                                                                                                                         |
| `libs/backend/cli-agent-runtime/.../mcp-directory/index.ts`               | B2   | Barrel exports for the client, the error, the new constants and the override key.                                                                                                                                                                   |
| `libs/backend/rpc-handlers/.../mcp-directory-rpc.schema.ts`               | B2.3 | `SmitheryServerKeySchema` + `deriveSmitheryConnectionId()`.                                                                                                                                                                                         |
| `libs/backend/rpc-handlers/.../mcp-directory-rpc.handlers.ts`             | B2.3 | Client field, 10-minute namespace cache, rewritten `installSmithery` / `uninstallSmithery`, four new methods, `METHODS` tuple.                                                                                                                      |
| `libs/backend/rpc-handlers/.../mcp-directory-rpc.handlers.spec.ts`        | B2.3 | New `Smithery Connections API` describe, 30 cases, with `os.homedir` redirected to a scratch directory.                                                                                                                                             |

No file outside the batch scope was touched. No git state command was run.

---

## Documented JSON shapes pinned in the specs

Five documentation pages were read on 2026-09-03. Three shapes differ from the
table in `context.md` F3. **The documentation wins in each case**, and the specs
pin the documented shape.

### 1. `status` is an OBJECT, not a bare string (the important one)

`context.md` F3 states: "Connection `status` enum: `connected | disconnected |
auth_required | input_required | error`". Those five values are real, but they
are the value of `status.state` INSIDE a status object, and the object also
carries the `setupUrl`:

```jsonc
// ConnectionStatus — oneOf, from api-reference/connect/get-connection
{ "state": "connected" }
{ "state": "disconnected" }
{ "state": "auth_required",  "setupUrl": "<uri>", "authorizationUrl": "<uri, deprecated>" }
{ "state": "input_required", "setupUrl": "<uri>", "http": { … },
  "missing": { "headers": ["…"], "query": ["…"] } }
{ "state": "error", "message": "string" }
```

Reading `connection.status` as a string would have yielded `'unknown'` for every
connection and never produced a `setupUrl`. `SmitheryConnectionsClient` flattens
the object to `status` + `setupUrl` + `statusMessage`, so no caller depends on
the nesting.

### 2. `/namespaces` returns objects, not strings

```jsonc
// GET https://api.smithery.ai/namespaces
{
  "namespaces": [{ "name": "string" }],
  "pagination": { "currentPage": 1, "pageSize": 50, "totalPages": 1, "totalCount": 2 },
}
```

`context.md` implied a flat list. `listNamespaces()` maps `.name` out.

### 3. The Connection object has no top-level `server` field

```jsonc
// GET /connect/{ns} → { connections: Connection[], nextCursor: string | null }
// Connection:
{
  "connectionId": "string",
  "name": "string",
  "transport": "http" | "uplink",
  "mcpUrl": "string | null",
  "metadata": "object | null",
  "mock": { "enabled": true, "scenario": "string" },
  "iconUrl": "string | null",
  "createdAt": "string (ISO 8601)",
  "status": ConnectionStatus,
  "serverInfo": { "name", "title", "icons", "version", "websiteUrl", "description" }
}
```

The registry qualified name is accepted on the way IN (`server` in the PUT body)
and is not echoed back. See the decisions section for how `server` is recovered.

### 4. Upsert request body

```jsonc
// PUT https://api.smithery.ai/connect/{namespace}/{connectionId}
// 200 = updated, 201 = created, 400 validation, 404 namespace, 409 URL mismatch
{
  "transport": "http" | "uplink",   // optional
  "mcpUrl": "<uri>",                // required only when `server` is omitted
  "server": "hubspot",              // ^@?[a-zA-Z0-9][a-zA-Z0-9_-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9_-]*)?$
  "name": "HubSpot",                // optional, 1-255 chars
  "metadata": { "…": "…" },         // optional, for filtering
  "headers": { "…": "…" }           // optional, stored securely, NOT returned
}
```

### 5. Delete

```
DELETE https://api.smithery.ai/connect/{namespace}/{connectionId}
200 → {"success": true}   400/404 → {"error": "…", "message": "…"}
```

### One documentation contradiction, resolved in favor of the API reference

`docs/use/connect.md` (the narrative page) gives the upsert URL as
`PUT https://smithery.run/{namespace}/{connectionId}`. All four
`docs/api-reference/connect/*` pages give
`https://api.smithery.ai/connect/{namespace}/{connectionId}`, which is also what
`context.md` F3 measured returning 401 without a key. The client uses
`api.smithery.ai`. The narrative page also omits `disconnected` from the status
enum; the API reference includes it, and the shared type keeps it.

`https://mcp.smithery.run/{namespace}` is the MCP endpoint and is unchanged by
this — it is not the API base.

---

## Decisions

1. **`metadata` carries the qualified name as well as the owner marker.** The
   batch text asks for `{ managedBy: 'ptah' }`. The Connection response has no
   `server` field (shape 3 above), so with the marker alone the Connectors
   surface could not match a connection back to a catalog entry. Ptah writes
   `{ managedBy: 'ptah', server: '<qualifiedName>' }` and the client reads
   `server` from metadata first, falling back to `serverInfo.name` for a
   connection the user made elsewhere. Both routes are pinned by specs.

2. **`SmitheryOverrideResolver` needs no new constructor dependency.** The
   namespace override needs the API key, which the override resolver never had —
   it delegates URL building to `SmitheryConnectionResolver`, which owns
   `getApiKey`. Adding a `getApiKey` dep would have meant editing
   `rpc-handlers/.../chat/session/chat-session.service.ts`, which is outside this
   batch's scope. Instead `SmitheryConnectionResolver` gained
   `resolveNamespace(namespace)`, the same secret-safe seam its `resolve()`
   already is. No wiring outside `mcp-directory/` changed.

3. **A failed connection PUT records a LEGACY install, not a Connections-API
   one.** The batch says to keep the install and return
   `{ success: true, status: 'unknown', error }`. It does — and it deliberately
   writes the record WITHOUT `namespace`/`connectionId`. Writing them for a
   connection that does not exist would make `smitheryConnectionStatus` and
   `openSmitherySetup` address a 404 forever, and would put the record in the
   namespace override where the session cannot reach it either.

4. **A key with no namespace is not an error.** `installSmithery` records the
   legacy install and returns `status: 'unknown'` with an explanatory `error`,
   making no PUT at all.

5. **`deriveSmitheryConnectionId` trims dashes off both ends and falls back to
   `server`.** The batch text says "any character outside `[a-z0-9-]` mapped to
   `-`", which is what it does; the trim is added because the id is a URL path
   segment, and `smithery__weird__` would otherwise become `-weird--`.

6. **The namespace cache is invalidated by `setSmitheryApiKey` only, and a
   failure is never cached.** `getActiveSmitheryNamespace()` writes the cache
   only on a successful fetch, so a transient outage does not lock the surface
   out for ten minutes.

7. **`SmitheryConnectionsClient` resolves `globalThis.fetch` PER CALL.** The
   client is constructed once, in the handler constructor. Capturing `fetch`
   there would freeze whatever implementation existed at construction — which a
   spec that re-mocks `fetch` between calls proved immediately, and which would
   also break any host that installs a fetch wrapper after boot.

8. **`listSmitheryConnections` does not return `setupUrl`.** A setup URL is
   single use, so a list is the wrong place to hand one out. `openSmitherySetup`
   re-PUTs the connection for a fresh one, exactly as the batch specifies.

9. **`smitheryAccount` and `listSmitheryConnections` do not report to Sentry.**
   A revoked key or an unreachable API is a state the surface must render, not a
   defect worth an alert. `openSmitherySetup` DOES report, because it is an
   explicit user action that should have worked. This follows the
   `getOAuthRedirectUri` precedent already documented in `rpc-handlers/CLAUDE.md`.

10. **The handler spec redirects `os.homedir()`.** `SmitheryInstalledManifestStore`
    resolves its path from `os.homedir()` at module load, and the handler builds a
    real store. Without the redirect the new install specs would write to the
    developer's real `~/.ptah/smithery-installed.json`. Only `homedir` is
    replaced; the rest of the `os` module is the real one.

---

## `McpHttpServerOverride.headers` reaches the SDK

Verified, as the batch asked, without editing `agent-sdk`:

```ts
// libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1284
private mergeMcpOverride(base, override) {
  if (!override || Object.keys(override).length === 0) return base;
  return { ...base, ...(override as Record<string, McpHttpServerConfig>) };
}
```

The override object is spread whole, so `headers` survives. Nothing to report,
and `agent-sdk` was not touched.

---

## Secrecy

- The API key is sent as `Authorization: Bearer <key>` and never placed in a
  URL. Two specs assert that the recorded request URL and every logged line are
  free of the key.
- `setupUrl` is returned to the renderer and to `openExternal`, and is never
  logged. Pinned in both the client spec and the handler spec.
- The namespace override logs `{ namespace, connectionsApiRecords, legacyRecords,
serverKeys }` — counts and names, never the `Authorization` header. Pinned by
  `never logs the Authorization header or the namespace URL secret`.

---

## Verification

```
npx nx run-many -t typecheck lint test -p @ptah-extension/shared @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers --skip-nx-cache
```

Header: `NX  Running targets typecheck, lint, test for 3 projects`
Result: `NX  Successfully ran targets typecheck, lint, test for 3 projects`

| Project                             | Test suites    | Tests                              | Lint                                   |
| ----------------------------------- | -------------- | ---------------------------------- | -------------------------------------- |
| `@ptah-extension/shared`            | 52 passed / 52 | **1238 passed / 1238**             | clean                                  |
| `@ptah-extension/cli-agent-runtime` | 47 passed / 47 | **631 passed / 631**               | 36 problems, **0 errors**, 36 warnings |
| `@ptah-extension/rpc-handlers`      | 91 passed / 91 | **2674 passed, 31 skipped / 2705** | 19 problems, **0 errors**, 19 warnings |

All three `typecheck` targets are clean. Every lint warning is pre-existing and
in a file this batch did not touch — grepping the lint output for `smithery` and
`mcp-directory` returns nothing.

**Cases added by this batch: 71.**

| Spec file                              | Cases | Notes                                                              |
| -------------------------------------- | ----- | ------------------------------------------------------------------ |
| `smithery-connections.client.spec.ts`  | 26    | **NEW file.** 22 `it` blocks, one an `it.each` with 5 rows.        |
| `smithery-connection-resolver.spec.ts` | 4     | `resolveNamespace`.                                                |
| `smithery-installed-manifest.spec.ts`  | 4     | `namespace` / `connectionId` persistence + `get()`.                |
| `smithery-override-resolver.spec.ts`   | 7     | The namespace override, legacy split, namespace conflict, secrecy. |
| `mcp-directory-rpc.handlers.spec.ts`   | 30    | 27 `it` blocks, one an `it.each` with 4 rows.                      |

Baselines from the B1 report: `cli-agent-runtime` was 46 suites / 590 tests,
`rpc-handlers` was 91 suites / 2641 passed. The measured `rpc-handlers` delta is
+33 rather than +30 because another engineer's `session-lifecycle-notifier.spec.ts`
change also landed in this working tree between the two runs.

`rpc-allowlist.spec.ts` passes: all four new method names are in
`RPC_METHOD_NAMES` and in `McpDirectoryRpcHandlers.METHODS`, the manifest
partitions the registry exactly, and `mcpDirectory:` is already in
`ALLOWED_METHOD_PREFIXES`, so no `vscode-core` change was needed.

---

## Not done / notes for later batches

- **Another engineer is editing this working tree.** An intermediate run of the
  rpc-handlers suite failed four spec files with TypeScript errors in
  `libs/backend/memory-curator/src/lib/memory-curator.service.ts` (`Property
'drafts' does not exist on type …`), caused by their in-flight
  `curator-window-runner.ts` change, not by this batch. Those suites pass in the
  final run. Nothing in `memory-curator` was touched here.
- **B3 consumers**: the Connectors surface should call
  `mcpDirectory:listSmitheryConnections` and match a catalog entry by the
  `server` field, which is the registry qualified name for a Ptah-managed
  connection and `serverInfo.name` otherwise.
- **B4**: a Connections-API install now appears in the session as ONE MCP server
  named `smithery`, not one per installed server. The chat MCP chip's Authorize
  routing should treat the key `smithery` as "open the Marketplace Smithery
  surface", because one namespace endpoint can hold several connections in
  different states.
- **B5 docs**: `SMITHERY_NAMESPACE_OVERRIDE_KEY` and the tool prefix
  `<connectionId>.<tool>` are the two facts a user needs to understand why their
  tool names changed after reconnecting.
- Legacy records still work and are still resolved through the old per-server
  URL. Nothing migrates them automatically — the user reconnects.
- Nothing was committed.
