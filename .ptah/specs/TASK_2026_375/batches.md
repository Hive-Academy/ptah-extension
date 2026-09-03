# TASK_2026_375 — Batches

Executor: the Ptah CLI agent ("claude cli"), one batch per run, sequential.
Every batch is file-disjoint from the batches before it except where a later
batch consumes a contract an earlier one added. Each batch ends with the
verification commands listed for it, and the executor pastes the summary lines
into `.ptah/specs/TASK_2026_375/batch-report-<id>.md`.

Repo rules that apply to every batch:

- Absolute Windows paths for Read/Write/Edit.
- `catch (error: unknown)`, narrow with `instanceof Error`. No `@ts-ignore`.
- Zod at every RPC boundary (`*-rpc.schema.ts`). Trust internal types past it.
- Backend libs import `platform-core` ports only, never a `platform-*` adapter.
- Frontend: Angular 21 standalone, `ChangeDetectionStrategy.OnPush`, signals +
  `inject()`, no `[innerHTML]` on AI or remote text, Tailwind + daisyui classes
  that match the sibling files.
- New RPC method = add to `RpcMethodMap` AND `RPC_METHOD_NAMES` in
  `libs/shared/src/lib/types/rpc.types.ts`, AND to the handler's
  `static readonly METHODS` tuple. `mcpDirectory` and `session` prefixes are
  already allowed at runtime; a NEW prefix also needs
  `libs/backend/vscode-core/src/messaging/rpc-handler.ts` `ALLOWED_METHOD_PREFIXES`.
- Never `nx test a b c`. Use `npx nx run-many -t <target> -p <projects>` and
  check the `Running target … for N projects` header.
- Never log a token, an API key or a built Smithery URL.
- Do not commit.

---

## B1 — Manifest freshness + path-aware OAuth discovery (bugfix)

Libs: `libs/backend/cli-agent-runtime` only.

### B1.1 Manifest stores re-read on change

Files:

- `src/lib/mcp-directory/smithery-installed-manifest.ts` (+ `.spec.ts`)
- `src/lib/mcp-directory/oauth/mcp-oauth-installed-manifest.ts` (+ `.spec.ts`)

Change: each store keeps `loadedMtimeMs: number | null`. A private
`refresh()` stats the manifest file (`fs.statSync`, catch → treat as absent);
when the mtime differs from `loadedMtimeMs` (or the file appeared / vanished)
it re-parses and updates `loadedMtimeMs`. Call `refresh()` at the top of every
READ method (`list`, `has`, `get`, `getConfig`). Writes keep the in-memory
map and update `loadedMtimeMs` after `save()` from a fresh stat. Specs: a
second store instance sees a record written by the first without
reconstruction; a deleted file yields an empty list; a corrupt file yields an
empty list without throwing.

Fix the JSDoc in `smithery-override-resolver.ts` and in
`chat-session.service.ts:174-178 / 215-218` (rpc-handlers) ONLY if the words
"reads the manifest on each buildOverrides()" are there — they now become true;
leave the sentence, do not rewrite the comment blocks.

### B1.2 Path-aware OAuth discovery

File: `src/lib/mcp-directory/oauth/mcp-oauth-metadata.ts` (+ `.spec.ts`).

`discoverAuthorizationServer(serverUrl, fetchImpl)` — candidate order:

1. If the server URL has a non-root pathname `p`:
   `${origin}/.well-known/oauth-protected-resource${p}` (RFC 9728 §3.1 path form).
2. `${origin}/.well-known/oauth-protected-resource`.
3. A `GET serverUrl` with `Accept: application/json, text/event-stream`; when
   the response is 401 and carries `WWW-Authenticate` with
   `resource_metadata="<url>"`, fetch that URL. Parse the header with a
   tolerant regex; the `FetchLike` type must expose response headers — extend
   it with `headers?: { get(name: string): string | null }` and keep every
   existing caller and fake compiling (the property is optional).
4. Fallback: the server origin (unchanged).
   Take `authorization_servers[0]` from the first document that has one.

`discoverAuthServerMetadata(authServer, fetchImpl)` — with `issuer = new
URL(authServer)`, `base = issuer.origin`, `p = issuer.pathname` (trailing slash
stripped), candidate order:

1. If `p` is non-root: `${base}/.well-known/oauth-authorization-server${p}`
   (RFC 8414 §3.1 path-insert).
2. If `p` is non-root: `${base}/.well-known/openid-configuration${p}`.
3. If `p` is non-root: `${authServer}/.well-known/oauth-authorization-server`
   and `${authServer}/.well-known/openid-configuration` (OIDC Discovery 1.0
   §4 legacy form).
4. `${base}/.well-known/oauth-authorization-server`, then
   `${base}/.well-known/openid-configuration`.
   Return the first document with both `authorization_endpoint` and
   `token_endpoint`. The `OAuthDiscoveryError` message must name the ORIGINAL
   `authServer`, not the origin.

Specs pin the Smithery shapes from `context.md` F2 exactly (path-form PRM at
`/hubspot/mcp`, path-insert AS metadata at `/hubspot`, and the 401 +
`resource_metadata` route), and pin that `https://mcp.hubspot.com` (root PRM,
root AS metadata) still resolves as before. Also pin that a server with no
document anywhere still throws `OAuthDiscoveryError`.

### B1 verification

```
npx nx run-many -t typecheck lint test -p @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers
```

Then run ONE live probe from a scratch script or `node -e` against
`https://server.smithery.ai/hubspot/mcp` through the two exported functions
with `globalThis.fetch`, and paste the resolved `authorizationEndpoint` and
`registrationEndpoint` into the batch report. Delete the scratch file.

---

## B2 — Smithery Connections API (backend + shared contract)

Libs: `libs/backend/cli-agent-runtime`, `libs/backend/rpc-handlers`,
`libs/shared`. Read the five Smithery docs pages listed in `context.md` F3
BEFORE writing the client; pin the JSON shapes you find there in the specs.

### B2.1 Shared contract (`libs/shared/src/lib/types/mcp-directory.types.ts`, `rpc.types.ts`)

- `SmitheryInstalledRecord` gains optional `namespace?: string` and
  `connectionId?: string`. A record with both is a Connections-API record; a
  record without them is legacy (still resolved through the old URL until the
  user reconnects).
- `SmitheryConnectionStatus = 'connected' | 'disconnected' | 'auth_required' | 'input_required' | 'error' | 'unknown'`.
- `McpDirectoryInstallSmitheryResult` gains `status?: SmitheryConnectionStatus`,
  `setupUrl?: string`, `namespace?: string`, `connectionId?: string`.
- New RPCs (params/result types + `RpcMethodMap` + `RPC_METHOD_NAMES`):
  - `mcpDirectory:smitheryAccount` → `{ configured: boolean; namespaces: string[]; activeNamespace: string | null; error?: string }`.
  - `mcpDirectory:listSmitheryConnections` → `{ connections: Array<{ connectionId; name; server?: string; status: SmitheryConnectionStatus; iconUrl?: string; createdAt?: string; managedByPtah: boolean; serverKey?: string }>; namespace: string | null; error?: string }`.
  - `mcpDirectory:smitheryConnectionStatus` params `{ serverKey }` → `{ status: SmitheryConnectionStatus; setupUrl?: string; error?: string }`.
  - `mcpDirectory:openSmitherySetup` params `{ serverKey }` → `{ opened: boolean; setupUrl?: string; error?: string }` (re-PUTs the connection to obtain a fresh `setupUrl`, then opens it through `IUserInteraction.openExternal`).

### B2.2 Client (`cli-agent-runtime/src/lib/mcp-directory/smithery-connections.client.ts` + spec)

`SmitheryConnectionsClient` with `fetchImpl` injection and `getApiKey`:
`listNamespaces()`, `listConnections(namespace)`, `getConnection(namespace,
id)`, `upsertConnection(namespace, id, { server, name?, metadata? })`. Base
`https://api.smithery.ai`, `Authorization: Bearer <key>`. Zod-validate every
response body with a tolerant schema (unknown keys allowed). Throw
`SmitheryKeyMissingError` when no key; throw a typed
`SmitheryApiError { status, message }` on non-2xx. Never log the key.
`metadata` on every Ptah-created connection is `{ managedBy: 'ptah' }` so the
list can tell Ptah's connections from others.

Add `SMITHERY_API_BASE = 'https://api.smithery.ai'` and
`SMITHERY_NAMESPACE_MCP_HOST = 'https://mcp.smithery.run'` to
`smithery-wire.constants.ts`; drop the `[VERIFY]` comments on the legacy
constants and replace them with one comment: "legacy per-server format, kept
for records without namespace/connectionId".

### B2.3 Install and status flow (`rpc-handlers/.../mcp-directory-rpc.handlers.ts` + schema + spec)

- Active namespace: the first entry of `listNamespaces()`, cached in the
  handler for 10 minutes and invalidated by `setSmitheryApiKey`.
- `installSmithery`: keep the pre-flight `resolveSmithery` path as is. Then
  `upsertConnection(ns, connectionId, { server: qualifiedName, name, metadata })`
  where `connectionId = deriveSmitheryServerKey(qualifiedName)` with the
  `smithery_` prefix removed and any character outside `[a-z0-9-]` mapped to
  `-`. Record `namespace` + `connectionId` in the manifest. Return the
  connection `status` and `setupUrl` when present. If the PUT fails, still
  record the legacy install and return `{ success: true, status: 'unknown', error }`
  so the surface can say what happened without losing the install.
- `uninstallSmithery`: when the record has `namespace` + `connectionId`,
  `DELETE /connect/{ns}/{id}` best-effort (log warn on failure), then remove
  the record.
- `smitheryConnectionStatus`, `listSmitheryConnections`, `smitheryAccount`,
  `openSmitherySetup` as in B2.1. `listSmitheryConnections` marks
  `managedByPtah` when a manifest record matches `connectionId`, and returns
  the Ptah `serverKey` for those.

### B2.4 Session override (`cli-agent-runtime/.../smithery-override-resolver.ts` + spec)

`buildOverrides()`:

- If ANY record has `namespace` + `connectionId`, emit ONE override keyed
  `smithery` → `{ type: 'http', url: 'https://mcp.smithery.run/<ns>', headers: { Authorization: 'Bearer <key>' } }`.
  Do not emit per-server overrides for those records.
- Records WITHOUT `namespace` keep the legacy per-server override (unchanged).
- Keys never logged; log only `{ namespace, connectionsApiRecords, legacyRecords }`.
  Check that `McpHttpServerOverride.headers` reaches the SDK
  (`SdkQueryOptionsBuilder.mergeMcpOverride` in agent-sdk) — if headers are
  dropped there, report it in the batch report; do not edit agent-sdk in this
  batch.

### B2 verification

```
npx nx run-many -t typecheck lint test -p @ptah-extension/shared @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers
```

`rpc-handlers` includes `host-profile/rpc-allowlist.spec.ts`, which fails if a
method is in `RPC_METHOD_NAMES` but in no handler's `METHODS`.

---

## B3 — Ptah connectors catalog + Connectors surface (shared data + frontend)

Libs: `libs/shared` (one new data file + barrel export), `libs/frontend/marketplace`.

### B3.1 Catalog (`libs/shared/src/lib/connectors/ptah-connectors.catalog.ts` + spec, exported from `src/index.ts`)

```ts
export type PtahConnectorKind = 'oauth-dcr' | 'oauth-app' | 'smithery';
export interface PtahConnector {
  readonly id: string; // kebab-case, stable
  readonly label: string;
  readonly description: string; // one sentence
  readonly category: 'code' | 'communication' | 'data' | 'design' | 'productivity' | 'sales-marketing' | 'finance' | 'devops';
  readonly kind: PtahConnectorKind;
  readonly url?: string; // oauth-* kinds: the MCP server URL
  readonly smitheryQualifiedName?: string; // smithery kind
  readonly docsUrl?: string;
  readonly verifiedAt: string; // ISO date the URL was probed
}
export const PTAH_CONNECTORS: readonly PtahConnector[];
```

Seed candidates to PROBE (include an entry only when its OAuth discovery
succeeds through the B1 functions at authoring time; set `kind` from the
presence of `registration_endpoint`): Sentry `https://mcp.sentry.dev/mcp`,
Notion `https://mcp.notion.com/mcp`, Linear `https://mcp.linear.app/mcp`,
HubSpot `https://mcp.hubspot.com`, Atlassian `https://mcp.atlassian.com/v1/mcp`,
Asana `https://mcp.asana.com/sse`, Intercom `https://mcp.intercom.com/mcp`,
Stripe `https://mcp.stripe.com`, PayPal `https://mcp.paypal.com/mcp`,
Square `https://mcp.squareup.com/sse`, Canva `https://mcp.canva.com/mcp`,
Figma `https://mcp.figma.com/mcp`, Vercel `https://mcp.vercel.com`,
Neon `https://mcp.neon.tech/mcp`, Supabase `https://mcp.supabase.com/mcp`,
Zapier `https://mcp.zapier.com/api/mcp/mcp`, monday.com `https://mcp.monday.com/mcp`,
Webflow `https://mcp.webflow.com/sse`, Cloudflare docs `https://docs.mcp.cloudflare.com/mcp`,
GitHub `https://api.githubcopilot.com/mcp/`. Add two `smithery` entries:
`hubspot` (label "HubSpot via Smithery") and one more popular managed server
you confirm exists in the registry. Write the probe as a Jest spec that is
`describe.skip` unless `PTAH_LIVE_PROBES=1`, run it once with the flag, and
paste the pass/fail table into the batch report. The committed catalog must
contain only the entries that passed.

### B3.2 Connectors surface (`libs/frontend/marketplace`)

Read `smithery-surface.component.ts`, `oauth-surface.component.ts`,
`providers.registry.ts` and the hub component that mounts descriptors first.

- New `connectors-surface.component.ts` registered as a descriptor
  `connectors` with label **Connectors**, placed FIRST. It renders:
  1. A search box and category chips over `PTAH_CONNECTORS`.
  2. A card grid. Each card: label, description, a kind hint
     ("Signs in with your browser" / "Needs an app you create with the
     provider" / "Managed by Smithery"), and a status badge resolved from:
     `mcpDirectory:listOAuthConnected` + `oauthStatus` for `oauth-*` kinds
     (match by `serverUrl`), and `mcpDirectory:listSmitheryConnections` for
     `smithery` kind (match by `server` / qualified name).
  3. A primary action per card: **Connect** (oauth-dcr → `connectOAuth`;
     oauth-app → open the existing OAuth form prefilled with Advanced open;
     smithery → `installSmithery`, then if `setupUrl` → `openSmitherySetup`
     and poll `smitheryConnectionStatus` every 3 s for up to 5 min until
     `connected`), **Authorize** when status is `auth_required` /
     `input_required` / expired, **Disconnect** when connected.
  4. A collapsed "Connect a custom server" section that embeds the existing
     `ptah-oauth-surface` form (reuse the component; do not duplicate it).
- Smithery surface: add an **Account** row at the top from
  `mcpDirectory:smitheryAccount` (namespace name, or "API key not set" with
  the existing key form), and a **Connections** list from
  `listSmitheryConnections` with status badges and Authorize / Remove
  actions. Installed cards use the connection status, not the manifest only.
- Keep Connected Apps as a descriptor for now (it is embedded in Connectors).
- Specs for the new component: catalog filter, status merge, Connect routes
  per kind, Authorize on `auth_required`, polling stops on `connected` and on
  destroy.

### B3 verification

```
npx nx run-many -t typecheck lint test -p @ptah-extension/shared @ptah-extension/marketplace
```

Check the project names in each `project.json` first.

---

## B4 — Session MCP status (agent-sdk capture → shared message → rpc-handlers → chat header)

Libs: `libs/shared`, `libs/backend/agent-sdk` (two small edits),
`libs/backend/rpc-handlers`, `libs/frontend/chat` (+ `chat-ui` if an atom is
needed). agent-sdk files other than the two named below are being edited by
another engineer in parallel — do not touch them.

### B4.1 Shared

- New message type `SESSION_MCP_STATUS` in `messages/message-constants.ts` /
  `message-type.ts`, payload in `payload-map.ts` + zod schema in
  `messages/schemas.ts`:
  `{ sessionId: string; servers: Array<{ name: string; status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled' | string }>; notices: Array<{ code: 'claude-ai-connectors-disabled'; message: string }> }`.
- `session:status` result gains optional `mcpServers` and `notices` with the
  same shapes, so a reloaded tab can read the last known state.

### B4.2 agent-sdk (two edits only)

- `helpers/stream-transformer.ts`: where `sdkMessage.mcp_servers` is logged
  (≈ line 304), also call a new optional `onMcpServers?(sessionId, servers)`
  on `StreamTransformConfig`.
- `SdkQueryOptionsBuilder` stderr handler (the `CLI stderr:` log site): when
  the chunk contains `claude.ai connectors are disabled`, call a new optional
  `onCliNotice?(sessionId, { code: 'claude-ai-connectors-disabled', message })`
  on the same config surface that carries `onMcpServers`. Find how
  `StreamTransformConfig` reaches the builder and thread it the same way; if
  the stderr site cannot see the session id, use the tabId the builder already
  has (it is the routing id the webview knows).

### B4.3 rpc-handlers

`SessionMcpStatusRegistry` (new, in `src/lib/chat/session/`): per session id
`{ servers, notices, updatedAt }`, bounded LRU 256, `rekey` wired to
`SessionIdResolvedCallbackRegistry` like `SessionTurnStateRegistry`. The
chat session service wires `onMcpServers` / `onCliNotice` into it and posts
`SESSION_MCP_STATUS` to the webview through the same publisher that posts
`session:stats`. `session:status` reads from it.

### B4.4 chat header chip (`libs/frontend/chat`)

- In the chat header (where CTX / TOKENS / COST / TIME / MODELS chips render)
  add an **MCP** chip: count of connected servers; amber when any server is
  `needs-auth` or `failed`; a popover (use the existing Floating-UI
  primitives from `@ptah-extension/ui`) listing each server with a status
  pill. Rows with `needs-auth` get **Authorize**: for a `smithery*` key call
  `mcpDirectory:openSmitherySetup`; for an `oauth-*` key call
  `mcpDirectory:connectOAuth` with the record's `serverUrl` from
  `listOAuthConnected`; otherwise navigate to Marketplace → Connectors.
- When `notices` has `claude-ai-connectors-disabled`, the popover shows one
  info row: "Your claude.ai connectors (Gmail, Calendar, Drive…) are disabled
  because Ptah runs this session on <provider>. Switch the provider to Claude
  login to load them." with a link to Settings → Providers. Do not word it as
  an error.
- State lives in `chat-state` if a per-tab slice already exists for session
  stats; follow the same pattern as `session:stats` handling.

### B4 verification

```
npx nx run-many -t typecheck lint test -p @ptah-extension/shared @ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/chat @ptah-extension/chat-state
```

---

## B5 — Docs + CLAUDE.md

- `apps/ptah-docs/src/content/docs/marketplace/connected-apps.md`: fix the
  "takes effect at next session" wording to match B1, add the Smithery-hosted
  server note (paste any `server.smithery.ai/<name>/mcp` URL; the browser
  flow works; no vendor app needed).
- `apps/ptah-docs/src/content/docs/marketplace/smithery.md`: Account row,
  Connections list, Authorize step, and what "Managed" means.
- New `apps/ptah-docs/src/content/docs/marketplace/connectors.md`: the
  catalog, the three kinds, status badges, and the chat MCP chip. Add it to
  the sidebar in `astro.config.mjs` if the section uses explicit `items`.
- `libs/backend/cli-agent-runtime/CLAUDE.md`: one bullet each for manifest
  freshness, path-aware discovery, and the Connections API override.
- `libs/backend/rpc-handlers/CLAUDE.md`: one bullet for
  `SessionMcpStatusRegistry` and the new `mcpDirectory` methods.
- `libs/frontend/marketplace` and `libs/frontend/chat` CLAUDE.md (if present):
  one bullet each.
- `npx nx build ptah-docs` must pass.
