# TASK_2026_375 — Ptah Connectors

## User intent

The user runs the Electron host. They installed HubSpot from the Marketplace
Smithery surface. No browser opened, nothing asked for keys, and a new chat
session had no HubSpot tools. There is no way to see which Smithery account is
in use or which servers are connected. The Electron log also showed that the
claude.ai connectors (Gmail, Google Calendar, Drive, Canva) were disabled with
no surface to act on it.

The user's decision: "we should have our own connectors and properly fix all
of these gaps."

## Measured facts (2026-09-03, all verified by probe or log)

### F1 — Manifests are read once, so installs need an app restart

- `SmitheryInstalledManifestStore` loads `~/.ptah/smithery-installed.json` in
  its constructor (`smithery-installed-manifest.ts:88`); `list()` returns the
  in-memory copy.
- `McpOAuthInstalledManifestStore` does the same (`mcp-oauth-installed-manifest.ts:33`).
- `ChatSessionService` builds its own instance of each store lazily and reuses
  it (`chat-session.service.ts:181-247`). The Marketplace RPC handler writes
  through a different instance.
- Electron log, session "test hubspot" at 18:25:22: `mcpOverrideKeys:
["oauth-mcp.sentry.dev-mcp"]` although `smithery_hubspot` was written to the
  manifest at 18:21. In a fresh dev run (`tmp/logs/log.log`) the same install
  produced `mcpOverrideKeys: ["smithery_hubspot"]`.

### F2 — OAuth discovery ignores URL paths

`libs/backend/cli-agent-runtime/src/lib/mcp-directory/oauth/mcp-oauth-metadata.ts`:

- `discoverAuthorizationServer` (line 94) fetches
  `${origin}/.well-known/oauth-protected-resource` only.
- `discoverAuthServerMetadata` (line 122) reduces the issuer to its origin.

Smithery shapes, measured:

| URL                                                                           | Result                                                                                                              |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `https://server.smithery.ai/.well-known/oauth-protected-resource`             | 404                                                                                                                 |
| `https://server.smithery.ai/.well-known/oauth-protected-resource/hubspot/mcp` | 200, `authorization_servers: ["https://auth.smithery.ai/hubspot"]`                                                  |
| `https://hubspot.run.tools/.well-known/oauth-protected-resource`              | 200, same auth server                                                                                               |
| `https://auth.smithery.ai/.well-known/oauth-authorization-server`             | 404                                                                                                                 |
| `https://auth.smithery.ai/.well-known/oauth-authorization-server/hubspot`     | 200, has `registration_endpoint`, `token_endpoint_auth_methods_supported: ["none","client_secret_post"]`, PKCE S256 |
| `https://auth.smithery.ai/hubspot/.well-known/oauth-authorization-server`     | 404                                                                                                                 |

A 401 from either MCP endpoint carries
`WWW-Authenticate: Bearer ... resource_metadata="<url>"` pointing at the path
form. So every Smithery-hosted server is a standard OAuth MCP server with
dynamic client registration, and Ptah cannot discover it today.

HubSpot direct (`https://mcp.hubspot.com`) has no `registration_endpoint` and
needs a pre-registered app (TASK_2026_373 handles that path).

### F3 — Smithery integration uses the legacy wire format and has no auth step

- `smithery-wire.constants.ts` builds
  `https://server.smithery.ai/{name}/mcp?config=<b64>&api_key=<key>&profile=`.
  Constants still carry `[VERIFY]` markers.
- The legacy host still reads `api_key` (probe with a bogus key answers
  `"Invalid API key"`). With a valid key the CLI reported the server as
  `needs-auth` in the session init (`tmp/logs/log.log:308`):
  `{"name":"smithery_hubspot","status":"needs-auth"}`. Ptah logs it at debug
  level and shows nothing.
- `mcpDirectory:getSmitheryKeyStatus` returns a boolean only. No account, no
  connection list.

Smithery's current model (docs at `https://smithery.ai/docs/llms.txt`):

| Operation                 | Endpoint                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| User namespaces (account) | `GET https://api.smithery.ai/namespaces`                                                                              |
| List connections + status | `GET https://api.smithery.ai/connect/{namespace}`                                                                     |
| Create/update connection  | `PUT https://api.smithery.ai/connect/{namespace}/{connectionId}` body `{ server: "hubspot", name?, metadata? }`       |
| Get one connection        | `GET https://api.smithery.ai/connect/{namespace}/{connectionId}`                                                      |
| Namespace MCP endpoint    | `https://mcp.smithery.run/{namespace}`, `Authorization: Bearer <api key>`; tools are prefixed `<connectionId>.<tool>` |

Connection `status` enum: `connected | disconnected | auth_required |
input_required | error`. `auth_required` and `input_required` responses carry a
`setupUrl` the user opens in a browser; Smithery completes the upstream OAuth
and the connection becomes `connected`. All endpoints answered 401 without a
key, which confirms the base URL. The docs pages to read before coding:
`https://smithery.ai/docs/use/connect.md`,
`https://smithery.ai/docs/api-reference/connect/create-or-update-connection.md`,
`https://smithery.ai/docs/api-reference/connect/list-connections.md`,
`https://smithery.ai/docs/api-reference/connect/get-connection.md`,
`https://smithery.ai/docs/api-reference/namespaces/get-users-namespaces-or-search-namespaces.md`.

### F4 — The CLI reports MCP status and Ptah drops it

- The system `init` message carries `mcp_servers: [{ name, status }]`. Ptah
  reads it in `stream-transformer.ts:304` and logs it at debug level. No message
  reaches the webview. No frontend file reads it.
- The CLI writes to stderr at session start when a third-party auth source is
  active: `claude.ai connectors are disabled because ANTHROPIC_API_KEY or
another auth source is set and takes precedence over your claude.ai login`.
  Ptah logs it as `[SdkQueryOptionsBuilder] CLI stderr:` at debug level. The
  user's active provider is `openai-codex` through the local Codex proxy, so
  their Gmail / Calendar / Drive / Canva connectors never load. Ptah cannot
  configure those connectors (they live in the claude.ai account), but it must
  say so.

### F5 — No catalog

Connected Apps has three hardcoded chips plus HubSpot (TASK_2026_373). The
docs state "Discovery: None — you already know the server". Claude's
connectors directory lists hundreds. Ptah needs its own curated catalog with
verified URLs and a kind per entry.

## Design

See `batches.md` for the file-level plan. Summary:

1. **Freshness** — both manifest stores re-read the file when its mtime changed,
   on every read.
2. **Discovery** — RFC 9728 path form, RFC 8414 path-insert form, and the
   `resource_metadata` hint from a 401 challenge.
3. **Smithery Connections API** — a client, a manifest record per connection
   with `namespace` + `connectionId`, `installSmithery` returns `status` +
   `setupUrl`, a status RPC, an account RPC, and a single session override on
   the namespace endpoint.
4. **Ptah connectors catalog** — a static, verified list in `libs/shared`, and a
   new **Connectors** surface in the Marketplace that merges the catalog,
   Connected Apps, and Smithery connections with a status badge per entry.
5. **Session MCP status** — captured from the CLI init message and the stderr
   notice, published to the webview, shown as a chip in the chat header with an
   Authorize action for `needs-auth`.
6. **Docs** — Connected Apps, Smithery and Marketplace pages.

## Out of scope

- Configuring claude.ai connectors from Ptah (impossible; they live in the
  claude.ai account). Ptah only explains and links.
- Smithery service tokens (Ptah is a desktop app that holds the user's own API
  key; the key is the credential).
- TASK_2026_241 (unified installed inventory) is superseded by the Connectors
  surface for remote servers; local stdio servers stay on the MCP Registry
  surface.
