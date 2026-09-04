# TASK_2026_373 — Connected Apps supports pre-registered OAuth clients

## User intent

The user mainly runs the Electron host. They tried to connect the HubSpot
remote MCP server (`https://mcp.hubspot.com`) from the Marketplace
**Connected Apps** surface. HubSpot does not support dynamic client
registration. Its documentation requires the user to create an **MCP auth
app** in the HubSpot account, register a **Redirect URL**, and copy the
**client ID** and **client secret** from the app details page.

The user's words: "mostly all of the connectors will be one of those two
options, either like Sentry or HubSpot, so we should allow for both in our
connector."

## Measured state (2026-09-03)

- `libs/frontend/marketplace/src/lib/oauth-surface.component.ts:38` — three
  hardcoded chips (Sentry, Notion, Linear). All three support RFC 7591.
- The **Advanced** section already accepts a client ID and a client secret.
  `McpOAuthService.connect` (`mcp-oauth.service.ts:176-193`) uses them when
  the auth server metadata has no `registration_endpoint`.
- The UI never shows the redirect URL the user must register with the
  provider. The value depends on the host:
  - VS Code: `vscode://ptah-extensions.ptah-coding-orchestra/oauth-callback`
    (`VscodeUriOAuthCallbackListener`, resolved through `asExternalUri`).
  - Electron / CLI: `http://127.0.0.1:<random>/callback` — the loopback
    listener binds port `0` (`loopback-oauth-callback-listener.ts:39`).
- A random port cannot be pre-registered. HubSpot requires an exact match.
  So the pre-registered path cannot succeed on Electron today.
- `mcpDirectory:probeOAuthDiscovery` answers only "does this server publish
  OAuth metadata". It does not report whether dynamic registration is
  supported, so the UI cannot open Advanced for the user.

## Design

### Backend

1. `IOAuthCallbackListener` (platform-core) gains
   `describeRedirectUri(): Promise<string>` — the redirect URI the next
   `start()` will produce, computed without arming a listener.
2. `LoopbackOAuthCallbackListener` binds a fixed port
   `MCP_OAUTH_LOOPBACK_PORT = 41739` (exported constant). If the bind fails
   (`EADDRINUSE`), it falls back to port `0` so dynamic-registration flows
   keep working. `describeRedirectUri()` returns
   `http://127.0.0.1:41739/callback`.
3. `McpOAuthService.connect`: when the flow uses a pre-registered client
   and the armed `redirectUri` differs from `describeRedirectUri()`, throw a
   clear error naming the port. `probeDiscovery` returns
   `{ dynamicRegistration: boolean }`. New `describeRedirectUri()` method.
4. `VscodeUriOAuthCallbackListener.describeRedirectUri()` — same
   `asExternalUri` resolution as `start()`.
5. New RPC `mcpDirectory:getOAuthRedirectUri` (no params) →
   `{ redirectUri: string | null; error?: string }`. Probe result gains
   `dynamicRegistration?: boolean`.

### Frontend (`libs/frontend/marketplace`)

- Load the redirect URL once on init. Show it in **Advanced** as a read-only
  field with a **Copy** button and the label "Redirect URL — register this
  with the provider".
- When the probe reports `supported: true, dynamicRegistration: false`, set
  the hint `needs-client-app`, open Advanced automatically, and show a note
  that explains the three provider-side steps.
- Add a **HubSpot** chip (`https://mcp.hubspot.com`).

### Docs

- `apps/ptah-docs/src/content/docs/marketplace/connected-apps.md` — a section
  "Two kinds of OAuth servers" with a HubSpot walkthrough and the redirect URL
  per host.

## Out of scope

- A searchable connector catalog (separate task).
- TASK_2026_241 (unified installed inventory).
