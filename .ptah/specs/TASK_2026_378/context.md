# TASK_2026_378 — First-class connectors out of the box

## User intent

After TASK_2026_375 shipped a 21-entry catalog, the Smithery Connections API,
and the session MCP chip, the user asked the strategic question:

> Either we enhance our own connectors and add different ones like the Claude
> connectors — we can scrape them and check the best way to add each one — or
> we rely on Smithery as we do now, but it has a limit for the free user, about
> 25k RPC calls across all connectors. Investigate if there is an easy way to
> do those connectors in our Connected Apps section to support first-class
> integrations out of the box.

## What Ptah has today (TASK_2026_375, all committed)

- `libs/shared/src/lib/connectors/ptah-connectors.catalog.ts` — 21 entries,
  kinds `oauth-dcr` (17), `oauth-app` (2: HubSpot direct, GitHub), `smithery`
  (2). Every `oauth-*` URL was probed live through Ptah's own discovery chain.
- Connected Apps runs the MCP authorization flow: RFC 9728 path-aware
  discovery, RFC 8414 path-insert, the 401 `resource_metadata` hint, RFC 7591
  dynamic registration, PKCE, a fixed loopback redirect on Electron/CLI and a
  `vscode://` deep link on VS Code. Pre-registered clients (client id/secret)
  are supported for servers without dynamic registration.
- Smithery: Connections API client, namespace endpoint override with a bearer
  API key, per-connection status and setup URL. Smithery first-party Google
  servers (`gmail`, `googlecalendar`, `googledrive`, `googledocs`,
  `googlesheets`) exist and their auth servers support dynamic registration,
  so they also connect through Connected Apps directly at
  `https://server.smithery.ai/<name>/mcp` with no Smithery API key.
- claude.ai connectors (Gmail, Calendar, Drive, Canva on the claude.ai
  account) cannot be configured from Ptah. They are Anthropic-hosted servers
  tied to the claude.ai login and are disabled under a third-party provider.

## The question, decomposed

1. **Coverage** — how many of the connectors in the Claude directory are
   public remote MCP servers Ptah can connect to directly (vendor-hosted, no
   aggregator)? For each: URL, dynamic registration or pre-registered app,
   any documented quota.
2. **Smithery terms** — the real free-tier limits (calls, connections,
   namespaces), whether the direct OAuth path via `server.smithery.ai` counts
   against the same quota, and what paid tiers cost.
3. **Aggregators** — Pipedream MCP, Composio, Klavis, Nango, Zapier MCP and
   any other managed-OAuth remote MCP provider: app count, dynamic
   registration, per-app connect flow, free tier, what Ptah would need to add.
4. **Ptah-owned route** — what it would take for Ptah to own OAuth apps for the
   top services (Google Workspace first), where the client secret would live,
   and what the license server would have to host.
5. **Fit** — for each route, the change to the catalog schema, the Connectors
   surface, and the session override, with an effort estimate.

## Constraints

- Ptah is a desktop app. Any secret an aggregator issues is the user's own
  credential, stored in Ptah's encrypted secret store.
- No trademarked AI product names in non-JS files (VS Code Marketplace rule).
- Backend libs depend on `platform-core` ports only.
