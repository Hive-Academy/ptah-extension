# Handoff — In-app MCP OAuth flow

Status as of the three `feat:` commits on branch `ak/elevate-video-and-tasks`:

```
5cf698814 feat: wire in-app MCP OAuth RPC surface and query-time token injection
887bf99a1 feat: add OAuth 2.0 + PKCE subsystem for remote MCP server connections
e7ddf021d feat: add node:http loopback HttpServerProvider for Electron and VS Code
```

## What this feature does

Lets a user connect an **OAuth-gated remote MCP server** (Sentry, Notion, Linear, the
claude.ai connectors, etc.) from inside Ptah — one click, no external `claude mcp` CLI,
no manual token pasting. The agent then gets the server's tools with an
`Authorization: Bearer <token>` header injected at chat-query time.

**Backend core is done and Electron-only.** No UI yet. Fully unit-tested; the live
end-to-end (real browser + real server) is the only unverified path.

## Design (mirrors the existing Smithery pattern)

Tokens are stored **encrypted** via `IAuthSecretsService` per-server slots; only
non-secret metadata goes to a plaintext manifest; the secret-bearing connection is
rebuilt **in memory at query time**. Nothing sensitive is written to disk config.

Flow (`connect`): discover authorization server (RFC 9728) → auth-server metadata
(RFC 8414) → dynamic client registration (RFC 7591) → PKCE S256 → open system browser →
loopback `127.0.0.1:0` catches `?code=&state=` → validate `state` → exchange code +
verifier → store tokens.

## Key files

| Concern                            | Path                                                                                                                                                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Loopback listener (new port impls) | `libs/backend/platform-electron/src/implementations/electron-http-server-provider.ts`, `libs/backend/platform-vscode/src/implementations/vscode-http-server-provider.ts` (both `node:http`; registered under `PLATFORM_TOKENS.HTTP_SERVER_PROVIDER` in each `registration.ts`) |
| OAuth subsystem                    | `libs/backend/cli-agent-runtime/src/lib/mcp-directory/oauth/` — `pkce.ts`, `mcp-oauth-metadata.ts`, `mcp-oauth.service.ts`, `mcp-oauth-token-store.ts`, `mcp-oauth-installed-manifest.ts`, `mcp-oauth-override-resolver.ts` (+ `*.spec.ts`)                                    |
| Shared types                       | `libs/shared/src/lib/types/mcp-directory.types.ts` (`McpOAuthConnectedRecord`, manifest, `McpOAuthConnectionState`, RPC params/results); `rpc.types.ts` (payload map ~1008 + coverage map ~2698)                                                                               |
| RPC surface                        | `libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.ts` + `.schema.ts`                                                                                                                                                                                      |
| Query-time injection               | `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` → `getOAuthOverrideResolver()` + `buildMcpServersOverride()`                                                                                                                                          |

## RPC methods (prefix `mcpDirectory:` already in the runtime guard)

- `connectOAuth` `{ serverUrl, name?, serverKey?, scope? }` → `{ success, serverKey?, error? }` — runs the interactive flow.
- `oauthStatus` `{ serverKey }` → `{ state: 'connected' | 'expired' | 'disconnected' }`.
- `disconnectOAuth` `{ serverKey }` → `{ success, error? }` — deletes tokens + manifest record.
- `listOAuthConnected` `{}` → `{ servers: McpOAuthConnectedRecord[] }` (non-secret).

`serverKey` defaults to `deriveMcpOAuthServerKey(url)` (e.g. `https://mcp.notion.com/mcp` → `oauth-mcp.notion.com-mcp`).

## Design decisions to know before continuing

- **`McpOAuthService` connect-only deps are optional.** `httpServerProvider` and
  `openExternal` are only needed by `connect()`. The chat-session override resolver
  constructs the service _without_ them (it only calls `getFreshAccessToken`), so the
  hot chat path does not inject `HTTP_SERVER_PROVIDER`/`USER_INTERACTION`.
- **VS Code also got the loopback provider.** The shared `McpDirectoryRpcHandlers` now
  requires `HTTP_SERVER_PROVIDER`; VS Code didn't register one, so a real `node:http`
  impl was added there too (extension host is Node). The loopback flow would work in
  VS Code as-is; the deferred VS Code item is only the _native URI-handler_ alternative.
- **DCR is required in this pass.** If an auth server has no `registration_endpoint`,
  `connect()` throws ("pre-registered client … not yet supported"). Pre-registered /
  manual `client_id` support is a follow-up.
- **Resource indicator (RFC 8707).** `resource=<serverUrl>` is sent on both authorize
  and token requests.

## Verification

- Unit tests (all green): `nx test cli-agent-runtime` (OAuth specs: pkce, token-store,
  metadata, service `connect`/`refresh`/`status`, override-resolver),
  `nx test platform-electron` (loopback provider, real TCP), `nx test rpc-handlers`,
  `nx test platform-vscode`, `nx test shared`. Typecheck: `nx run-many -t typecheck -p
shared cli-agent-runtime rpc-handlers platform-electron platform-vscode platform-cli`.
- **Manual e2e (not yet run — needs browser + network):** build+launch Electron
  (`nx build-dev ptah-electron`), drive `mcpDirectory:connectOAuth` with
  `https://mcp.notion.com/mcp` (or Sentry). Browser opens → authorize → loopback
  catches the code → `oauthStatus` reports `connected`. Start a chat and confirm the
  agent lists the server's tools. `disconnectOAuth` clears it.

## Remaining work (next session)

1. **Angular UI (primary follow-up).** Add Connect / Reconnect / Disconnect controls +
   a status pill for OAuth-capable servers in the MCP directory surface. UI seams:
   - `libs/frontend/marketplace/src/lib/smithery-surface.component.ts` (the analog
     Smithery connect surface — closest reference for the pattern).
   - `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts`.
     Call the four RPCs via the existing RPC client; keep OnPush + signals; no `[innerHTML]`.
     `connectOAuth` is long-running (browser round-trip) — show a pending state and poll
     `oauthStatus`.
2. **e2e contract test.** Extend `apps/ptah-electron-e2e/src/specs/rpc-new-features.spec.ts`
   with the read-only OAuth methods (`oauthStatus` → `disconnected` for an unknown key,
   `listOAuthConnected` → `{ servers: [] }`). Do NOT contract-test `connectOAuth` in e2e
   (it opens a browser / hits the network).
3. **VS Code native URI-handler callback** (optional) instead of the loopback server.
4. **Pre-registered client_id support** for auth servers without DCR.

## Gotchas

- Manifest defaults to `~/.ptah/mcp-oauth-installed.json`; tokens live in encrypted
  provider-key slots `mcp.oauth.<serverKey>`. Pass a temp `manifestPath` in tests.
- `McpOAuthService` uses `globalThis.fetch` by default — inject `fetchImpl` in tests.
- Commit-message scope-enum only allows a fixed list; these commits use **no scope**
  (there's no `mcp`/`platform`/`shared` scope). Follow that for follow-up commits, or
  use `webview` for the UI work.
