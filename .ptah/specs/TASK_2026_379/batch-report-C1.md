# TASK_2026_379 — Batch C1 report

**Batch**: C1 — Catalog rows + live probe
**Executor**: claude cli
**Date**: 2026-09-04
**Status**: complete. Not committed. No git state command was run.

## Files changed

| File                                                                                              | Change                                                                                    |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `libs/shared/src/lib/connectors/ptah-connectors.catalog.ts`                                       | 38 rows added, 1 row withdrawn, 3 rows held back in a commented block.                    |
| `libs/shared/src/lib/connectors/ptah-connectors.catalog.spec.ts`                                  | 7 new cases for `setupSteps`, `scopes` and the held-back services.                        |
| `libs/backend/cli-agent-runtime/src/lib/mcp-directory/oauth/ptah-connectors-catalog.live.spec.ts` | Candidate list grown from 20 to 60. Bounded-concurrency runner added. 1 new offline case. |

No other file was touched.

---

## 1. Catalog totals

|                        | Before | After |
| ---------------------- | ------ | ----- |
| Rows                   | 21     | 58    |
| `oauth-dcr`            | 17     | 44    |
| `oauth-app`            | 2      | 12    |
| `smithery`             | 2      | 2     |
| Rows with `setupSteps` | 0      | 12    |
| Rows with `scopes`     | 0      | 5     |

38 rows were added and 1 row (`square`) was withdrawn.

---

## 2. Rows added

### C1.1 — browser sign-in, `kind: 'oauth-dcr'` (22 rows)

Report section 4 lists 24 candidates that were not yet in the catalog. Two of
them (Ahrefs, Semrush) are held back, so 22 shipped.

| id                    | label               | category        | url                                                     |
| --------------------- | ------------------- | --------------- | ------------------------------------------------------- |
| `airtable`            | Airtable            | data            | `https://mcp.airtable.com/mcp`                          |
| `amplitude`           | Amplitude           | data            | `https://mcp.amplitude.com/mcp`                         |
| `apollo`              | Apollo.io           | sales-marketing | `https://mcp.apollo.io/mcp`                             |
| `atlassian-v2`        | Atlassian Rovo v2   | productivity    | `https://mcp.atlassian.com/v2/mcp`                      |
| `attio`               | Attio               | sales-marketing | `https://mcp.attio.com/mcp`                             |
| `clickup`             | ClickUp             | productivity    | `https://mcp.clickup.com/mcp`                           |
| `cloudflare`          | Cloudflare          | devops          | `https://mcp.cloudflare.com/mcp`                        |
| `cloudflare-bindings` | Cloudflare Bindings | devops          | `https://bindings.mcp.cloudflare.com/mcp`               |
| `context7`            | Context7            | code            | `https://mcp.context7.com/mcp`                          |
| `datadog`             | Datadog             | devops          | `https://mcp.datadoghq.com/api/unstable/mcp-server/mcp` |
| `dropbox`             | Dropbox             | data            | `https://mcp.dropbox.com/mcp`                           |
| `exa`                 | Exa                 | data            | `https://mcp.exa.ai/mcp`                                |
| `gitlab`              | GitLab              | code            | `https://gitlab.com/api/v4/mcp`                         |
| `huggingface`         | Hugging Face        | code            | `https://huggingface.co/mcp`                            |
| `klaviyo`             | Klaviyo             | sales-marketing | `https://mcp.klaviyo.com/mcp`                           |
| `mixpanel`            | Mixpanel            | data            | `https://mcp.mixpanel.com/mcp`                          |
| `pipedrive`           | Pipedrive           | sales-marketing | `https://mcp.pipedrive.ai/mcp`                          |
| `planetscale`         | PlanetScale         | data            | `https://mcp.pscale.dev/mcp/planetscale`                |
| `tavily`              | Tavily              | data            | `https://mcp.tavily.com/mcp`                            |
| `todoist`             | Todoist             | productivity    | `https://ai.todoist.net/mcp`                            |
| `trello`              | Trello              | productivity    | `https://mcp.trello.com/v1`                             |
| `zernio`              | Zernio              | sales-marketing | `https://mcp.zernio.com/mcp`                            |

The catalog has eight categories only. Report categories were mapped to the
closest chip: `marketing` and `sales` became `sales-marketing`, `project`
became `productivity`, and `storage` became `data`.

#### The two second endpoints — both shipped

The batch made both conditional on the tool sets differing per vendor
documentation, inside two fetches. Both were established in one search each.

- **`cloudflare-bindings`** ships. Cloudflare documents `mcp.cloudflare.com` as
  a general API server that uses a code-mode pattern over roughly 2,500 API
  endpoints, and `bindings.mcp.cloudflare.com` as a domain-specific server with
  curated, typed tools for Workers platform resources (D1, KV, R2). The tool
  sets are not the same server behind two names.
  Source: `developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/`
  and `github.com/cloudflare/mcp-server-cloudflare/tree/main/apps/workers-bindings`.
- **`atlassian-v2`** ships. Atlassian documents v2 as exposing more tools and
  more products than v1: new and improved Confluence tools with attachments,
  whiteboards and databases, plus discover and execute tools with lazy loading.
  v1 stays in the catalog because it still probes PASS and because Atlassian
  only migrates v1 to v2 tools automatically on 2027-03-01.
  Source: `developer.atlassian.com/cloud/rovo-mcp/changelog/`.

### C1.2 — app required, `kind: 'oauth-app'` (10 new rows, 2 existing rows updated)

| id                | label           | category      | url                                         | `scopes`      |
| ----------------- | --------------- | ------------- | ------------------------------------------- | ------------- |
| `google-gmail`    | Gmail           | communication | `https://gmailmcp.googleapis.com/mcp/v1`    | 2, documented |
| `google-calendar` | Google Calendar | productivity  | `https://calendarmcp.googleapis.com/mcp/v1` | 3, documented |
| `google-drive`    | Google Drive    | data          | `https://drivemcp.googleapis.com/mcp/v1`    | 2, documented |
| `google-docs`     | Google Docs     | productivity  | `https://docsmcp.googleapis.com/mcp/v1`     | 4, documented |
| `google-bigquery` | BigQuery        | data          | `https://bigquery.googleapis.com/mcp`       | 1, documented |
| `slack`           | Slack           | communication | `https://mcp.slack.com/mcp`                 | omitted       |
| `box`             | Box             | data          | `https://mcp.box.com`                       | omitted       |
| `mongodb-atlas`   | MongoDB Atlas   | data          | `https://mcp.mongodb.com`                   | omitted       |
| `pagerduty`       | PagerDuty       | devops        | `https://mcp.pagerduty.com/mcp`             | omitted       |
| `shopify`         | Shopify         | finance       | `https://setup.shopify.com/mcp`             | omitted       |

`github` and `hubspot` kept their existing rows and gained `setupSteps`.

All 12 `oauth-app` rows have a non-empty `setupSteps` array, and every array has
at least one step containing the literal token `{redirectUrl}`.

#### Google scopes — read from Google's own documentation, not guessed

Source: `developers.google.com/workspace/guides/configure-mcp-servers` and
`developers.google.com/workspace/gmail/api/guides/configure-mcp-server`.

| Row               | Scopes written into the catalog                                                          |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `google-gmail`    | `gmail.readonly`, `gmail.compose`                                                        |
| `google-calendar` | `calendar.calendarlist.readonly`, `calendar.events.freebusy`, `calendar.events.readonly` |
| `google-drive`    | `drive.readonly`, `drive.file`                                                           |
| `google-docs`     | `drive.readonly`, `drive.file`, `documents.readonly`, `documents`                        |
| `google-bigquery` | `bigquery`                                                                               |

Each is stored as the full `https://www.googleapis.com/auth/...` string.

BigQuery is not on the Workspace page. Its scope comes from Google Cloud's
BigQuery MCP documentation, which states the OAuth 2.0 flow must include
`https://www.googleapis.com/auth/bigquery`.

`scopes` is omitted for Slack, Box, MongoDB Atlas, PagerDuty and Shopify. None
of them documents a fixed scope set for the MCP server. Each expects the user to
choose scopes while creating the app, so the catalog does not guess.

### C1.3 — Smithery Google rows, `kind: 'oauth-dcr'` (5 rows)

| id                        | label                        | url                                             |
| ------------------------- | ---------------------------- | ----------------------------------------------- |
| `gmail-smithery`          | Gmail via Smithery           | `https://server.smithery.ai/gmail/mcp`          |
| `googlecalendar-smithery` | Google Calendar via Smithery | `https://server.smithery.ai/googlecalendar/mcp` |
| `googledrive-smithery`    | Google Drive via Smithery    | `https://server.smithery.ai/googledrive/mcp`    |
| `googledocs-smithery`     | Google Docs via Smithery     | `https://server.smithery.ai/googledocs/mcp`     |
| `googlesheets-smithery`   | Google Sheets via Smithery   | `https://server.smithery.ai/googlesheets/mcp`   |

The batch specifies `kind: 'oauth-dcr'` for these, not `kind: 'smithery'`, and
the probe agrees: each one resolves to its own `auth.smithery.ai/<name>`
authorization server with a registration endpoint. They need no Smithery API key
and do not go through the Connections API.

Each label ends in "via Smithery" so a user can tell them from the Google direct
rows, and each `description` states that Smithery, a third party, hosts the
server.

### C1.4 — aggregators

- **`pipedream`** added, `oauth-dcr`, `https://mcp.pipedream.net/v2`. The
  description states the MCP quota is unpublished.
- **`zapier`** already existed. Its `description` now states the free plan is
  about 50 tool calls a month.

---

## 3. Rows held back and rows withdrawn

All three probe PASS with a `registration_endpoint`. A metadata-only check would
ship them. Their documentation is the reason they do not.

They live in a commented block at the end of `PTAH_CONNECTORS`, each with its
reason and a `[VERIFY: connect once]` note, and a `Do NOT re-probe` warning so
the next person does not repeat work that already succeeded.

| Service | State                                  | Reason                                                                                                                                           |
| ------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Square  | **Withdrawn from the shipped catalog** | Square's documentation requires the OAuth client to be on an allowlist, so a dynamically registered client is expected to be refused at consent. |
| Ahrefs  | Never added                            | Ahrefs' documentation forbids custom OAuth clients.                                                                                              |
| Semrush | Never added                            | Semrush advertises an unusual token transport and lists plain PKCE first, so the flow Ptah runs may not be the flow Semrush supports.            |

> **Square is a behavior change, not only an omission.** `square` shipped in
> TASK_2026_375 on the metadata probe alone. C1.5 requires the three held-back
> services to be absent from `PTAH_CONNECTORS`, so the row was withdrawn and a
> spec case now pins its absence. A user who already connected Square keeps
> their configured server — this removes the catalog card, not an installation.
> No production code outside the catalog referenced the id `square`, verified by
> a repository-wide grep.

---

## 4. Live probe

Command actually used:

```
PTAH_LIVE_PROBES=1 npx jest --config libs/backend/cli-agent-runtime/jest.config.ts \
  --rootDir libs/backend/cli-agent-runtime \
  --testPathPatterns "ptah-connectors-catalog.live"
```

> The command printed in `batches.md` runs, but it does **not** isolate the
> probe. Jest 30 renamed `--testPathPattern` to `--testPathPatterns`, so the
> singular flag is ignored: the run executed all 48 suites and 634 tests, and
> the table was buried. Use the plural flag, or run jest directly as above.

60 candidates probed on 2026-09-04. **59 PASS, 1 FAIL.**

| id                      | url                                                   | result   | kind      | authorization server / reason                                                                                                 |
| ----------------------- | ----------------------------------------------------- | -------- | --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| sentry                  | https://mcp.sentry.dev/mcp                            | PASS     | oauth-dcr | https://mcp.sentry.dev                                                                                                        |
| notion                  | https://mcp.notion.com/mcp                            | PASS     | oauth-dcr | https://mcp.notion.com                                                                                                        |
| linear                  | https://mcp.linear.app/mcp                            | PASS     | oauth-dcr | https://mcp.linear.app                                                                                                        |
| hubspot                 | https://mcp.hubspot.com                               | PASS     | oauth-app | https://mcp.hubspot.com                                                                                                       |
| atlassian               | https://mcp.atlassian.com/v1/mcp                      | PASS     | oauth-dcr | https://mcp.atlassian.com                                                                                                     |
| asana                   | https://mcp.asana.com/sse                             | PASS     | oauth-dcr | https://mcp.asana.com                                                                                                         |
| intercom                | https://mcp.intercom.com/mcp                          | PASS     | oauth-dcr | https://mcp.intercom.com                                                                                                      |
| stripe                  | https://mcp.stripe.com                                | PASS     | oauth-dcr | https://access.stripe.com/mcp                                                                                                 |
| paypal                  | https://mcp.paypal.com/mcp                            | PASS     | oauth-dcr | https://mcp.paypal.com                                                                                                        |
| square                  | https://mcp.squareup.com/sse                          | PASS     | oauth-dcr | https://mcp.squareup.com                                                                                                      |
| canva                   | https://mcp.canva.com/mcp                             | PASS     | oauth-dcr | https://mcp.canva.com                                                                                                         |
| figma                   | https://mcp.figma.com/mcp                             | PASS     | oauth-dcr | https://api.figma.com                                                                                                         |
| vercel                  | https://mcp.vercel.com                                | PASS     | oauth-dcr | https://vercel.com                                                                                                            |
| neon                    | https://mcp.neon.tech/mcp                             | PASS     | oauth-dcr | https://mcp.neon.tech                                                                                                         |
| supabase                | https://mcp.supabase.com/mcp                          | PASS     | oauth-dcr | https://api.supabase.com                                                                                                      |
| zapier                  | https://mcp.zapier.com/api/mcp/mcp                    | PASS     | oauth-dcr | https://mcp.zapier.com                                                                                                        |
| monday                  | https://mcp.monday.com/mcp                            | PASS     | oauth-dcr | https://auth.monday.com/mcp                                                                                                   |
| webflow                 | https://mcp.webflow.com/sse                           | PASS     | oauth-dcr | https://mcp.webflow.com                                                                                                       |
| cloudflare-docs         | https://docs.mcp.cloudflare.com/mcp                   | **FAIL** | —         | No OAuth authorization-server metadata found for https://docs.mcp.cloudflare.com. The server may not support OAuth discovery. |
| github                  | https://api.githubcopilot.com/mcp/                    | PASS     | oauth-app | https://github.com/login/oauth                                                                                                |
| ahrefs                  | https://api.ahrefs.com/mcp/mcp                        | PASS     | oauth-dcr | https://api.ahrefs.com/                                                                                                       |
| airtable                | https://mcp.airtable.com/mcp                          | PASS     | oauth-dcr | https://airtable.com/oauth2/v1                                                                                                |
| amplitude               | https://mcp.amplitude.com/mcp                         | PASS     | oauth-dcr | https://mcp.amplitude.com                                                                                                     |
| apollo                  | https://mcp.apollo.io/mcp                             | PASS     | oauth-dcr | https://mcp.apollo.io                                                                                                         |
| atlassian-v2            | https://mcp.atlassian.com/v2/mcp                      | PASS     | oauth-dcr | https://auth.atlassian.com/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3                                                                   |
| attio                   | https://mcp.attio.com/mcp                             | PASS     | oauth-dcr | https://app.attio.com                                                                                                         |
| clickup                 | https://mcp.clickup.com/mcp                           | PASS     | oauth-dcr | https://mcp.clickup.com                                                                                                       |
| cloudflare              | https://mcp.cloudflare.com/mcp                        | PASS     | oauth-dcr | https://mcp.cloudflare.com                                                                                                    |
| cloudflare-bindings     | https://bindings.mcp.cloudflare.com/mcp               | PASS     | oauth-dcr | https://bindings.mcp.cloudflare.com                                                                                           |
| context7                | https://mcp.context7.com/mcp                          | PASS     | oauth-dcr | https://clerk.context7.com                                                                                                    |
| datadog                 | https://mcp.datadoghq.com/api/unstable/mcp-server/mcp | PASS     | oauth-dcr | https://mcp.datadoghq.com/v1/mcp                                                                                              |
| dropbox                 | https://mcp.dropbox.com/mcp                           | PASS     | oauth-dcr | https://www.dropbox.com                                                                                                       |
| exa                     | https://mcp.exa.ai/mcp                                | PASS     | oauth-dcr | https://auth.exa.ai                                                                                                           |
| gitlab                  | https://gitlab.com/api/v4/mcp                         | PASS     | oauth-dcr | https://gitlab.com                                                                                                            |
| huggingface             | https://huggingface.co/mcp                            | PASS     | oauth-dcr | https://huggingface.co                                                                                                        |
| klaviyo                 | https://mcp.klaviyo.com/mcp                           | PASS     | oauth-dcr | https://mcp.klaviyo.com                                                                                                       |
| mixpanel                | https://mcp.mixpanel.com/mcp                          | PASS     | oauth-dcr | https://mcp.mixpanel.com/mcp                                                                                                  |
| pipedrive               | https://mcp.pipedrive.ai/mcp                          | PASS     | oauth-dcr | https://oauth.pipedrive.com                                                                                                   |
| planetscale             | https://mcp.pscale.dev/mcp/planetscale                | PASS     | oauth-dcr | https://mcp.pscale.dev/mcp/planetscale                                                                                        |
| semrush                 | https://mcp.semrush.com/v2/mcp                        | PASS     | oauth-dcr | https://oauth.semrush.com                                                                                                     |
| tavily                  | https://mcp.tavily.com/mcp                            | PASS     | oauth-dcr | https://mcp.tavily.com/                                                                                                       |
| todoist                 | https://ai.todoist.net/mcp                            | PASS     | oauth-dcr | https://todoist.com                                                                                                           |
| trello                  | https://mcp.trello.com/v1                             | PASS     | oauth-dcr | https://auth.atlassian.com/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3                                                                   |
| zernio                  | https://mcp.zernio.com/mcp                            | PASS     | oauth-dcr | https://zernio.com                                                                                                            |
| google-gmail            | https://gmailmcp.googleapis.com/mcp/v1                | PASS     | oauth-app | https://accounts.google.com                                                                                                   |
| google-calendar         | https://calendarmcp.googleapis.com/mcp/v1             | PASS     | oauth-app | https://accounts.google.com                                                                                                   |
| google-drive            | https://drivemcp.googleapis.com/mcp/v1                | PASS     | oauth-app | https://accounts.google.com                                                                                                   |
| google-docs             | https://docsmcp.googleapis.com/mcp/v1                 | PASS     | oauth-app | https://accounts.google.com                                                                                                   |
| google-bigquery         | https://bigquery.googleapis.com/mcp                   | PASS     | oauth-app | https://accounts.google.com                                                                                                   |
| slack                   | https://mcp.slack.com/mcp                             | PASS     | oauth-app | https://mcp.slack.com                                                                                                         |
| box                     | https://mcp.box.com                                   | PASS     | oauth-app | https://api.box.com                                                                                                           |
| mongodb-atlas           | https://mcp.mongodb.com                               | PASS     | oauth-app | https://authorize.mongodb.com                                                                                                 |
| pagerduty               | https://mcp.pagerduty.com/mcp                         | PASS     | oauth-app | https://app.pagerduty.com/global/oauth/anonymous                                                                              |
| shopify                 | https://setup.shopify.com/mcp                         | PASS     | oauth-app | https://setup.shopify.com/auth                                                                                                |
| gmail-smithery          | https://server.smithery.ai/gmail/mcp                  | PASS     | oauth-dcr | https://auth.smithery.ai/gmail                                                                                                |
| googlecalendar-smithery | https://server.smithery.ai/googlecalendar/mcp         | PASS     | oauth-dcr | https://auth.smithery.ai/googlecalendar                                                                                       |
| googledrive-smithery    | https://server.smithery.ai/googledrive/mcp            | PASS     | oauth-dcr | https://auth.smithery.ai/googledrive                                                                                          |
| googledocs-smithery     | https://server.smithery.ai/googledocs/mcp             | PASS     | oauth-dcr | https://auth.smithery.ai/googledocs                                                                                           |
| googlesheets-smithery   | https://server.smithery.ai/googlesheets/mcp           | PASS     | oauth-dcr | https://auth.smithery.ai/googlesheets                                                                                         |
| pipedream               | https://mcp.pipedream.net/v2                          | PASS     | oauth-dcr | https://mcp.pipedream.com                                                                                                     |

### What the probe decided

- **No row was removed for a failed probe.** Every URL the batch asked for
  answered discovery. `cloudflare-docs` is the one FAIL, and it was already
  excluded on purpose: it needs no authorization at all, so it has no metadata
  to find. It stays a probe candidate as a negative control, and a spec case
  still pins its absence from the catalog.
- **Every `kind` the probe reported matches the `kind` written in the catalog.**
  The 10 new app-required rows all lack a registration endpoint, and the 28 new
  browser rows (22 vendor, 5 Smithery, 1 aggregator) all have one.
- Two authorization servers moved since the report was written:
  Stripe now issues from `access.stripe.com/mcp`, and Datadog from
  `mcp.datadoghq.com/v1/mcp`. Both remain `oauth-dcr`, so no row changed.
- `atlassian-v2` and `trello` resolve to the **same** Atlassian authorization
  server (`auth.atlassian.com/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3`). The MCP
  endpoints and their tools differ, so both rows stand.

### Probe spec changes

- Candidate list grown from 20 to 60.
- `probeAll` added: a bounded pool of 8 requests in flight, with outcomes kept
  in candidate order so the table is stable between runs. A serial loop over 60
  candidates at a 15 s per-request ceiling could exceed the suite timeout.
- Suite ceiling raised from 600 s to 900 s. The measured run took **6.8 s**.
- One offline case added: candidate ids and URLs are unique.

---

## 5. Specs added (C1.5)

`ptah-connectors.catalog.spec.ts` — 7 new cases, 27 in the file, all passing:

1. Every `oauth-app` entry has a non-empty `setupSteps` list.
2. Every setup step is a non-empty sentence that ends with a period.
3. Every `setupSteps` list names `{redirectUrl}` in at least one step.
4. No `oauth-dcr` or `smithery` entry has `setupSteps`.
5. `scopes`, when present, is a non-empty array of non-empty, untrimmed-free
   strings.
6. No entry repeats a scope.
7. Square, Ahrefs and Semrush are absent, by id and by URL.

Id uniqueness was already pinned by an existing case and still passes.

---

## 6. Verification

```
npx nx run-many -t typecheck lint test -p @ptah-extension/shared @ptah-extension/cli-agent-runtime
```

Header read `Running targets typecheck, lint, test for 2 projects`. Result:
`Successfully ran targets typecheck, lint, test for 2 projects`.

| Project                             | typecheck | lint                  | test                                            |
| ----------------------------------- | --------- | --------------------- | ----------------------------------------------- |
| `@ptah-extension/shared`            | pass      | 0 errors, 2 warnings  | 54 suites, **1287 passed**, 0 failed            |
| `@ptah-extension/cli-agent-runtime` | pass      | 0 errors, 36 warnings | 48 suites, **633 passed, 1 skipped**, 634 total |

The 1 skipped test is the live probe suite, which is `describe.skip` without
`PTAH_LIVE_PROBES=1`. That is the designed behavior.

### The one new lint warning

`ptah-connectors.catalog.ts` now reports
`File has too many lines (703). Maximum allowed is 700` — a **warning**, not an
error. It was not split, on purpose. `CLAUDE.md` states the 700-line ceiling is
warn-level and that "a contract barrel or exhaustive type union can be long and
correct". This file is a 58-row data table with no logic in it. Splitting it to
save three lines would create exactly the fragment sprawl the same rule forbids.
The other 37 warnings across both projects are pre-existing and untouched.

---

## 7. What I could not verify

1. **Setup steps for Box, MongoDB Atlas, PagerDuty, GitHub and HubSpot were
   not read page by page today.** They describe each vendor's standard OAuth
   application registration and name the right console, but the exact menu
   labels may drift. Google, Slack and Shopify steps ARE grounded in
   documentation read on 2026-09-04. Anyone connecting one of the five for the
   first time should correct the wording from what they actually see.
2. **No connector was connected end to end.** The probe proves discovery and
   registration metadata only. It does not prove that consent completes, that a
   token is issued, or that a tool call returns. This is the same limit
   TASK_2026_375 shipped under, and it is exactly why Square, Ahrefs and Semrush
   are held back rather than shipped on a green probe.
3. **Zernio's product scope is unverified.** The research report classes it as
   sales, and its endpoint probes PASS, but no vendor documentation was read.
   Its `description` says only that it exposes sales tools, which is the most
   the evidence supports. Reword it once someone connects it.
4. **Slack may refuse a private app.** One source states that only
   directory-published or internal apps may use Slack's MCP server. The
   `setupSteps` cover creating and installing the app, but a user on a workspace
   that forbids unlisted apps may still be blocked. Not reproducible without a
   Slack workspace.
5. **The Smithery metering question from report section 8 is still open.**
   Whether the five `server.smithery.ai` rows consume a Smithery quota, and
   against whose account, is documented nowhere. The rows ship because the batch
   asked for them and they probe clean, not because the quota question closed.
6. **Google Sheets and Slides have direct endpoints that were not added.**
   Google documents `sheetsmcp.googleapis.com/mcp/v1`,
   `slidesmcp.googleapis.com/mcp/v1`, `chatmcp.googleapis.com/mcp/v1` and
   `people.googleapis.com/mcp/v1` alongside the four this batch names. C1.2
   listed four Google Workspace servers, so four shipped. The other four are
   cheap follow-up rows with scopes already documented on the same page.
7. **Asana v2 (`https://mcp.asana.com/v2/mcp`) was not added.** Report section
   4b lists it, but C1.2 does not name it, so it was left out of both the
   catalog and the probe. The report notes it dropped dynamic registration,
   which makes it an `oauth-app` row needing setup steps nobody has written.

---

## 8. Notes for C2 and C3

- **For C2**: the `{redirectUrl}` token appears in exactly one step of each of
  the 12 `oauth-app` rows. Step counts range from 4 to 5, so the C2.2 hint can
  say "4 steps" or "5 steps". Five rows carry `scopes`; the other seven carry
  none, so `connectOAuth` must omit `scope` rather than send an empty string.
- **For C3**: the weekly workflow should use `--testPathPatterns` (plural). The
  singular form silently runs the whole suite and hides the table.
- `ptahConnectorKindHint` was left untouched in the catalog, because C2 owns the
  card hint copy and the step count it needs lives on the connector, not on the
  kind.
