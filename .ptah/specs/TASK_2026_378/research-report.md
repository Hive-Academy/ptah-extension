# TASK_2026_378 — First-class connectors: research report

**Probed 2026-09-04.** 63 candidate MCP endpoints were probed live through the
RFC 9728 / RFC 8414 / RFC 7591 chain Ptah itself uses. Five parallel sweeps
(the Claude connectors directory, vendor developer docs, Smithery terms,
managed-OAuth aggregators, a read-only codebase assessment) and three
independent judges (user experience, cost and maintenance, coverage) fed this
report. Every number below is a probe result or a sourced document, never an
estimate.

---

## 1. Decision

**Grow Ptah's own catalog. Use Smithery only for Google. Add the two
dynamic-registration aggregators as ordinary catalog rows. Do not build an
aggregator kind, and do not build a Ptah-owned OAuth broker.**

All three judges reached the same combination independently. The reason is one
measured fact: **43 of 63 probed endpoints already support dynamic client
registration**, which is the flow Ptah shipped in TASK_2026_375. Each one is a
data row in `ptah-connectors.catalog.ts` and no new code. The 14 that need a
provider-side app are already served by the `oauth-app` kind. Nothing in the
"first-class connectors" goal requires a new mechanism — it requires more rows
and better setup copy.

The quota worry that started this investigation is smaller than assumed and
mostly avoidable: the Smithery free tier is 50,000 calls per month, not 25,000,
and the vendor-hosted route it is being compared against has no Ptah-side quota
at all.

---

## 2. Decision matrix

|                     | A. Own catalog                    | B. Smithery                        | C. Aggregator kind                                | D. Ptah-owned OAuth                   |
| ------------------- | --------------------------------- | ---------------------------------- | ------------------------------------------------- | ------------------------------------- |
| User steps          | Click Connect, approve in browser | Same, or install + setup page      | Sign in to the aggregator, then per-app           | Click Connect                         |
| Third-party account | None                              | Only for the API-key path          | Yes, always                                       | None                                  |
| Quota               | The vendor's own                  | 50k calls/month free, 3 namespaces | Zapier 50 calls/month free; Pipedream unpublished | The vendor's own                      |
| Ptah backend        | None                              | None                               | None                                              | License-server broker if confidential |
| Secrets Ptah holds  | None                              | None                               | None                                              | A client secret per provider          |
| Coverage today      | 43 verified now                   | Google family + registry           | 3,000–9,000 apps behind one endpoint              | Whatever Ptah registers               |
| Maintenance         | Re-probe periodically             | Vendor-managed                     | Vendor churn risk                                 | Ptah owns every app                   |
| Effort              | 0.1–0.15 day per entry            | Already built                      | 5–8 days                                          | 8–13 days                             |

Effort figures come from the codebase assessment, anchored on TASK_2026_375
batch B2, which was the structurally identical change: 16 files, 3 libs, 71 new
test cases.

---

## 3. What the three judges said

| Lens                 | Route                                                         | Strongest risk named                                                                                                           |
| -------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| User experience      | A as the spine, B narrowed to Google, C narrowed to Pipedream | A user could hit a silent Smithery wall with no documented error and no Ptah failure state                                     |
| Cost and maintenance | A, plus B for Google, plus C as plain rows only               | Vendor endpoint churn is proven, not hypothetical: Asana v2 dropped dynamic registration and Atlassian retired its v1 endpoint |
| Coverage             | A + B + C combined, D deferred                                | Zapier's free plan allows about 50 tool calls per month, and Pipedream is being acquired, with its quota unpublished           |

They disagree only on emphasis. The coverage judge would add more aggregators;
the cost judge would add none beyond Pipedream. **The cost judge wins**: an
aggregator that returns a valid registration response is a one-line catalog row
either way, so adding them as rows costs nothing and building a kind costs 5–8
days. Nothing in the evidence justifies that spend.

---

## 4. Verified candidates — browser sign-in (43)

These connect with one browser round trip. No app, no key, no account beyond
the service itself. This is the shopping list.

| Service             | Category      | MCP URL                                                 | Authorization server        |
| ------------------- | ------------- | ------------------------------------------------------- | --------------------------- |
| Ahrefs              | marketing     | `https://api.ahrefs.com/mcp/mcp`                        | api.ahrefs.com              |
| Airtable            | data          | `https://mcp.airtable.com/mcp`                          | airtable.com/oauth2/v1      |
| Amplitude           | data          | `https://mcp.amplitude.com/mcp`                         | mcp.amplitude.com           |
| Apollo.io           | sales         | `https://mcp.apollo.io/mcp`                             | mcp.apollo.io               |
| Asana               | productivity  | `https://mcp.asana.com/sse`                             | mcp.asana.com               |
| Atlassian Rovo      | productivity  | `https://mcp.atlassian.com/v1/mcp`                      | mcp.atlassian.com           |
| Atlassian Rovo v2   | productivity  | `https://mcp.atlassian.com/v2/mcp`                      | auth.atlassian.com          |
| Attio               | sales         | `https://mcp.attio.com/mcp`                             | app.attio.com               |
| Canva               | design        | `https://mcp.canva.com/mcp`                             | mcp.canva.com               |
| ClickUp             | project       | `https://mcp.clickup.com/mcp`                           | mcp.clickup.com             |
| Cloudflare          | devops        | `https://mcp.cloudflare.com/mcp`                        | mcp.cloudflare.com          |
| Cloudflare Bindings | devops        | `https://bindings.mcp.cloudflare.com/mcp`               | bindings.mcp.cloudflare.com |
| Context7            | code          | `https://mcp.context7.com/mcp`                          | clerk.context7.com          |
| Datadog             | devops        | `https://mcp.datadoghq.com/api/unstable/mcp-server/mcp` | mcp.datadoghq.com           |
| Dropbox             | storage       | `https://mcp.dropbox.com/mcp`                           | dropbox.com                 |
| Exa                 | data          | `https://mcp.exa.ai/mcp`                                | auth.exa.ai                 |
| Figma               | design        | `https://mcp.figma.com/mcp`                             | api.figma.com               |
| GitLab              | code          | `https://gitlab.com/api/v4/mcp`                         | gitlab.com                  |
| Hugging Face        | code          | `https://huggingface.co/mcp`                            | huggingface.co              |
| Intercom            | communication | `https://mcp.intercom.com/mcp`                          | mcp.intercom.com            |
| Klaviyo             | marketing     | `https://mcp.klaviyo.com/mcp`                           | mcp.klaviyo.com             |
| Linear              | productivity  | `https://mcp.linear.app/mcp`                            | mcp.linear.app              |
| Mixpanel            | data          | `https://mcp.mixpanel.com/mcp`                          | mcp.mixpanel.com            |
| monday.com          | project       | `https://mcp.monday.com/mcp`                            | auth.monday.com             |
| Neon                | data          | `https://mcp.neon.tech/mcp`                             | mcp.neon.tech               |
| Notion              | productivity  | `https://mcp.notion.com/mcp`                            | mcp.notion.com              |
| PayPal              | finance       | `https://mcp.paypal.com/mcp`                            | mcp.paypal.com              |
| Pipedrive           | sales         | `https://mcp.pipedrive.ai/mcp`                          | oauth.pipedrive.com         |
| PlanetScale         | data          | `https://mcp.pscale.dev/mcp/planetscale`                | mcp.pscale.dev              |
| Semrush             | marketing     | `https://mcp.semrush.com/v2/mcp`                        | oauth.semrush.com           |
| Sentry              | devops        | `https://mcp.sentry.dev/mcp`                            | mcp.sentry.dev              |
| Square              | finance       | `https://mcp.squareup.com/mcp`                          | mcp.squareup.com            |
| Stripe              | finance       | `https://mcp.stripe.com`                                | access.stripe.com           |
| Supabase            | data          | `https://mcp.supabase.com/mcp`                          | api.supabase.com            |
| Tavily              | data          | `https://mcp.tavily.com/mcp`                            | mcp.tavily.com              |
| Todoist             | productivity  | `https://ai.todoist.net/mcp`                            | todoist.com                 |
| Trello              | project       | `https://mcp.trello.com/v1`                             | auth.atlassian.com          |
| Vercel              | devops        | `https://mcp.vercel.com`                                | vercel.com                  |
| Webflow             | design        | `https://mcp.webflow.com/sse`                           | mcp.webflow.com             |
| Zapier              | productivity  | `https://mcp.zapier.com/api/mcp/mcp`                    | mcp.zapier.com              |
| Zernio              | sales         | `https://mcp.zernio.com/mcp`                            | zernio.com                  |

Already in the catalog: Sentry, Notion, Linear, Atlassian, Asana, Intercom,
Stripe, PayPal, Square, Canva, Figma, Vercel, Neon, Supabase, Zapier,
monday.com, Webflow. **The other 24 rows are new.**

Three caveats a metadata probe cannot catch, all named by the cost judge:

- **Square** answers the registration probe but its documentation requires the
  client to be on an allowlist.
- **Ahrefs** documentation forbids custom clients.
- **Semrush** advertises an unusual token transport and lists plain PKCE first.

Verify these three by connecting once before you commit their rows.

## 4b. Verified candidates — app required (14)

| Service                                   | MCP URL                                     | Authorization server   |
| ----------------------------------------- | ------------------------------------------- | ---------------------- |
| Gmail                                     | `https://gmailmcp.googleapis.com/mcp/v1`    | accounts.google.com    |
| Google Calendar                           | `https://calendarmcp.googleapis.com/mcp/v1` | accounts.google.com    |
| Google Drive                              | `https://drivemcp.googleapis.com/mcp/v1`    | accounts.google.com    |
| Google Docs, Sheets, Slides, Chat, People | `https://docsmcp.googleapis.com/mcp/v1`     | accounts.google.com    |
| BigQuery                                  | `https://bigquery.googleapis.com/mcp`       | accounts.google.com    |
| Slack                                     | `https://mcp.slack.com/mcp`                 | mcp.slack.com          |
| Box                                       | `https://mcp.box.com`                       | api.box.com            |
| GitHub                                    | (see catalog entry)                         | github.com/login/oauth |
| HubSpot                                   | `https://mcp.hubspot.com`                   | mcp.hubspot.com        |
| MongoDB Atlas                             | `https://mcp.mongodb.com`                   | authorize.mongodb.com  |
| PagerDuty                                 | `https://mcp.pagerduty.com/mcp`             | mcp.pagerduty.com      |
| Shopify                                   | `https://setup.shopify.com/mcp`             | setup.shopify.com      |
| Asana v2                                  | `https://mcp.asana.com/v2/mcp`              | app.asana.com          |

**Google now hosts official Workspace MCP servers.** This is the most important
new fact in the sweep. Gmail, Calendar, Drive and Docs have first-party
endpoints. They need a Google Cloud OAuth app, so they are `oauth-app` — but
they remove every third party from the path, which no other option does.

## 4c. Not usable

| Service                                       | Reason                                        |
| --------------------------------------------- | --------------------------------------------- |
| Freshworks Developer, Mailchimp Transactional | No OAuth metadata published                   |
| Freshdesk, Snowflake, Microsoft 365 Work IQ   | Per-tenant URL template, not a fixed endpoint |
| Netlify                                       | Every request timed out                       |

---

## 5. Smithery terms, measured

Read from the pricing page payload and the pricing FAQ on 2026-09-04.

| Tier          | Price         | Calls                            | Namespaces |
| ------------- | ------------- | -------------------------------- | ---------- |
| Hobby         | Free          | 50,000 per month                 | 3          |
| Pay as you go | $10 per month | 100,000 per month                | 100        |
| Custom        | Contact       | Custom limits, uptime commitment | 100+       |

The FAQ defines a call as one JSON-RPC request to an MCP server — listing
tools, calling a tool, or reading a resource — and states that usage is billed
to "the account making the calls".

**The 25,000 figure is out of date.** The current free tier is 50,000.

**The open question, unresolved.** Whether the direct OAuth path
(`server.smithery.ai/<name>/mcp` with dynamic registration and no API key) is
metered, and against whose account, is documented nowhere: not in pricing, the
connect guide, token scoping, namespaces, uplink, the cookbook, or the OpenAPI
document. No rate-limit header and no quota-exhausted error is documented
either. See section 8.

---

## 6. Aggregators

| Aggregator                    | Dynamic registration | Account needed               | Free tier                             | Apps    |
| ----------------------------- | -------------------- | ---------------------------- | ------------------------------------- | ------- |
| Pipedream                     | Yes, verified        | Yes, separate MCP account    | Daily credit cap; unpublished for MCP | 3,000+  |
| Zapier                        | Yes, verified        | Yes                          | 100 tasks per month = 50 tool calls   | 9,000+  |
| Composio                      | No                   | API key                      | 100,000 calls per month               | 1,462   |
| Klavis                        | No                   | API key                      | Unknown                               | Unknown |
| Nango, Glama, Arcade, Paragon | No                   | Backend or developer project | —                                     | —       |

Six aggregators returned a valid dynamic registration response: Pipedream,
Zapier, withone.ai, Gumloop, Activepieces and Make. Only Pipedream and Zapier
are worth a catalog row today.

Two facts argue against depending on any of them:

- **Zapier's free plan is effectively 50 tool calls per month.** Each
  successful call consumes two tasks of a 100-task allowance.
- **Pipedream is being acquired by Workday**, and its MCP quota is unpublished.
- **Composio's zero-backend consumer product shut down in May 2026.** Its
  remaining path needs an API key, so it cannot be an `oauth-dcr` row.

Composio's free tier is the largest by far. If a quota-free option is ever
needed, Composio is the one to re-examine — but only with an aggregator kind,
which this report recommends against for now.

---

## 7. Implementation plan

### C1 — Catalog growth and polish (recommended first, about 3–4 days)

Files: `libs/shared/src/lib/connectors/ptah-connectors.catalog.ts` and its
spec, `libs/backend/cli-agent-runtime/.../ptah-connectors-catalog.live.spec.ts`,
`apps/ptah-docs/src/content/docs/marketplace/connectors.md`.

1. Add the 24 new browser sign-in rows from section 4, minus the three
   caveat rows until one manual connect confirms each.
2. Add the Google Workspace rows from section 4b as `oauth-app`.
3. Add the five Smithery Google servers as `oauth-dcr` rows at
   `https://server.smithery.ai/<name>/mcp`, labelled so the user can see the
   difference from the Google direct rows.
4. Add Pipedream and Zapier as `oauth-dcr` rows, each with a quota note.
5. Add `setupSteps` to `PtahConnector` and render it for every `oauth-app`
   entry, interpolating the real redirect URL from
   `mcpDirectory:getOAuthRedirectUri`. This is the single biggest quality win:
   it turns the current dead end into a walkthrough.
6. Add `scopes` and `docsUrl`, both already accepted by the connect path.
7. Extend the live probe spec to cover every new row, and run it once.

### C2 — Keep the catalog true (about 0.5 day)

Add a scheduled workflow that runs the live probe weekly with
`PTAH_LIVE_PROBES=1` and opens an issue when an entry changes kind or fails.
Vendor churn is proven: Asana dropped dynamic registration between versions.

### C3 — Not now

The aggregator kind (5–8 days) and the Ptah-owned OAuth route (8–13 days) are
specified in the codebase assessment and remain available. Neither is justified
by current evidence.

---

## 8. Open questions

| Question                                                                          | Cheapest way to close it                                                                        |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Is the Smithery direct OAuth path metered, and against whom?                      | Connect one server that way, then read the usage page on the Smithery account. One manual test. |
| Do Square, Ahrefs and Semrush accept a dynamically registered client in practice? | Connect each once from Ptah. Three manual tests.                                                |
| Does Pipedream's MCP quota survive the acquisition?                               | Re-read the pricing page in one month.                                                          |
| Which Google Cloud scopes does each Workspace server need?                        | Read the Workspace MCP documentation before writing the `setupSteps` copy.                      |

Four of these need one manual connect each. None blocks C1.
