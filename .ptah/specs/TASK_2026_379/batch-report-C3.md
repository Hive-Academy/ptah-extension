# TASK_2026_379 — Batch C3 report

**Batch**: C3 — Remaining catalog rows
**Executor**: claude cli
**Date**: 2026-09-04
**Status**: complete. Not committed. No git state command was run.

## Files changed

| File                                                                                              | Change                                                           |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `libs/shared/src/lib/connectors/ptah-connectors.catalog.ts`                                       | 5 rows added. 1 existing row relabelled.                         |
| `libs/shared/src/lib/connectors/ptah-connectors.catalog.spec.ts`                                  | 4 new cases for the invariants the new rows introduce.           |
| `libs/backend/cli-agent-runtime/src/lib/mcp-directory/oauth/ptah-connectors-catalog.live.spec.ts` | 5 probe candidates added. Run command in the docblock corrected. |

No other file was touched. `git status` reports two staged files outside this
batch (`agent-process-manager.workspace-scope.spec.ts`, `toolchain-probe.spec.ts`)
and the two C4 files. None of them is mine.

---

## 1. Catalog totals

|                        | Before C3 | After C3 |
| ---------------------- | --------- | -------- |
| Rows                   | 58        | 63       |
| `oauth-dcr`            | 44        | 44       |
| `oauth-app`            | 12        | 17       |
| `smithery`             | 2         | 2        |
| Rows with `setupSteps` | 12        | 17       |
| Rows with `scopes`     | 5         | 9        |

---

## 2. Rows added

### C3.1 — the four remaining Google Workspace servers

All four are `kind: 'oauth-app'`, which is what the probe found. Google
publishes no `registration_endpoint`, so the user creates the OAuth client.
Each row carries five `setupSteps` in the wording the C1 Google rows
established, with `{redirectUrl}` in step 2.

| id              | label         | category      | url                                       | scopes |
| --------------- | ------------- | ------------- | ----------------------------------------- | ------ |
| `google-sheets` | Google Sheets | productivity  | `https://sheetsmcp.googleapis.com/mcp/v1` | 4      |
| `google-slides` | Google Slides | productivity  | `https://slidesmcp.googleapis.com/mcp/v1` | 4      |
| `google-chat`   | Google Chat   | communication | `https://chatmcp.googleapis.com/mcp/v1`   | 5      |
| `google-people` | Google People | communication | `https://people.googleapis.com/mcp/v1`    | 3      |

Sheets and Slides take `productivity`, the category Google Docs already uses,
so the document servers read as one group. Chat and People take
`communication`, the category Gmail already uses.

### C3.2 — Asana v2

| id         | label    | category     | kind        | url                            |
| ---------- | -------- | ------------ | ----------- | ------------------------------ |
| `asana-v2` | Asana v2 | productivity | `oauth-app` | `https://mcp.asana.com/v2/mcp` |

Four setup steps, `{redirectUrl}` in step 2. No `scopes`. See section 3.

**What v2 adds**, from
`developers.asana.com/docs/integrating-with-asanas-mcp-server`: Streamable HTTP
transport, a new client registration model, workspace-scoped authorization, an
optimized tool set, and MCP tokens that work only against the MCP server, so a
compromised token cannot reach the general Asana API. The row description states
the two facts a user chooses on: workspace-scoped authorization and a wider tool
set.

**The two rows are labelled apart.** The new row is "Asana v2". The existing v1
row was relabelled from "Asana" to "Asana v1 beta", and its description now reads
"The deprecated beta endpoint for tasks, projects and portfolios in Asana." The
v1 row itself was kept, as the batch directs. Section 4 records the one thing
about it that does not add up.

---

## 3. Scopes and their source

Every scope below was read from
`developers.google.com/workspace/guides/configure-mcp-servers` on 2026-09-04.
None was guessed. The page was read twice with different questions, and the four
servers C1 already shipped came back with the scope sets already in the catalog.
That agreement is what makes the four new sets trustworthy. Chat and People were
confirmed a second time against `docs.cloud.google.com/mcp/supported-products`,
which lists the same two endpoints.

| Row             | Scopes                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `google-sheets` | `drive.readonly`, `drive.file`, `spreadsheets.readonly`, `spreadsheets`                                                       |
| `google-slides` | `drive.readonly`, `drive.file`, `presentations.readonly`, `presentations`                                                     |
| `google-chat`   | `chat.spaces.readonly`, `chat.memberships.readonly`, `chat.messages.readonly`, `chat.messages.create`, `chat.users.readstate` |
| `google-people` | `directory.readonly`, `userinfo.profile`, `contacts.readonly`                                                                 |

Each scope is stored with its full `https://www.googleapis.com/auth/` prefix, as
the page writes it and as the five C1 rows already do.

The same page names a product API **and** a separate MCP API per server — "Google
Sheets API" and "Sheets MCP API", "Google Chat API" and "Chat MCP API", and so
on. The "Enable …" step of each new row therefore names both, exactly as the C1
Google rows do.

**`asana-v2` carries no `scopes`.** Asana's V2 client pages document the app
registration and the redirect URL rule, and document no scope list. The
`PtahConnector` contract says to omit `scopes` rather than guess, so it is
omitted.

---

## 4. What I could not verify

1. **Asana v1 has a shutdown date that has already passed, and it is still
   answering.** `developers.asana.com` says the V1 beta server
   `https://mcp.asana.com/sse` "is deprecated and will shut down on Wed 5 Aug
   2026", extended once from 11 May 2026. Today is 4 Sep 2026, so that date is a
   month behind us. The endpoint is nevertheless alive: an unauthenticated
   `GET https://mcp.asana.com/sse` returns **401**, not 404 or 410, which is the
   answer a live server that wants authorization gives. Either the page is stale
   or the date slipped again without a note. The batch directs that the row stay,
   so it stays, now labelled "Asana v1 beta" with a description that says
   deprecated. Delete the row the first time it fails, rather than debugging it.
2. **No connector was connected end to end.** The probe proves discovery and
   registration metadata. It does not prove that consent completes, that a token
   is issued, or that a tool call returns. This is the standing limit of the whole
   task, named in `batches.md` under "Not automatable".
3. **All eight Google Workspace MCP servers are in Google's Developer Preview
   program.** Both Google pages label every server that way. A preview endpoint
   can change its URL, its scope set or its availability without notice. The
   scheduled probe C4 adds is the thing that will catch it.
4. **The Sheets and Slides endpoints are documented on the Workspace page only.**
   `docs.cloud.google.com/mcp/supported-products` lists Drive, Gmail, Calendar,
   Chat and People, and does not list Sheets or Slides. Both URLs probe clean
   against `accounts.google.com`, so they ship, but they rest on one
   documentation source rather than two.
5. **The Google setup-step wording was not walked through in a real Cloud
   console.** The steps name the right console, the right client type and the
   right APIs per the documentation, but exact menu labels drift. Correct the
   wording from what you actually see the first time you connect one.

---

## 5. Live probe

Command actually used. Note the **plural** `--testPathPatterns`, as the C1 report
established. The singular form is ignored by Jest 30 and silently runs all 48
suites:

```
PTAH_LIVE_PROBES=1 npx jest --config libs/backend/cli-agent-runtime/jest.config.ts \
  --rootDir libs/backend/cli-agent-runtime \
  --testPathPatterns "ptah-connectors-catalog.live"
```

65 candidates probed on 2026-09-04 in 13.0 s. **64 PASS, 1 FAIL.** The five new
rows are marked with a star. Every one of them passed, so all five ship.

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
| ★ google-sheets         | https://sheetsmcp.googleapis.com/mcp/v1               | PASS     | oauth-app | https://accounts.google.com                                                                                                   |
| ★ google-slides         | https://slidesmcp.googleapis.com/mcp/v1               | PASS     | oauth-app | https://accounts.google.com                                                                                                   |
| ★ google-chat           | https://chatmcp.googleapis.com/mcp/v1                 | PASS     | oauth-app | https://accounts.google.com                                                                                                   |
| ★ google-people         | https://people.googleapis.com/mcp/v1                  | PASS     | oauth-app | https://accounts.google.com                                                                                                   |
| ★ asana-v2              | https://mcp.asana.com/v2/mcp                          | PASS     | oauth-app | https://app.asana.com                                                                                                         |
| gmail-smithery          | https://server.smithery.ai/gmail/mcp                  | PASS     | oauth-dcr | https://auth.smithery.ai/gmail                                                                                                |
| googlecalendar-smithery | https://server.smithery.ai/googlecalendar/mcp         | PASS     | oauth-dcr | https://auth.smithery.ai/googlecalendar                                                                                       |
| googledrive-smithery    | https://server.smithery.ai/googledrive/mcp            | PASS     | oauth-dcr | https://auth.smithery.ai/googledrive                                                                                          |
| googledocs-smithery     | https://server.smithery.ai/googledocs/mcp             | PASS     | oauth-dcr | https://auth.smithery.ai/googledocs                                                                                           |
| googlesheets-smithery   | https://server.smithery.ai/googlesheets/mcp           | PASS     | oauth-dcr | https://auth.smithery.ai/googlesheets                                                                                         |
| pipedream               | https://mcp.pipedream.net/v2                          | PASS     | oauth-dcr | https://mcp.pipedream.com                                                                                                     |

The one FAIL is `cloudflare-docs`, which C1 already established needs no
authorization at all. It stays a probe candidate and stays out of the catalog.
Nothing regressed: the other 59 candidates returned the same result as in C1.

**`asana-v2` came back `oauth-app`.** The probe agrees with Asana's
documentation that V2 dropped dynamic client registration. That is the evidence
the row's `kind` rests on.

### Probe spec changes

- Candidate list grown from 60 to 65.
- Suite-ceiling comment corrected from 60 to 65 candidates.
- The run command in the module docblock was replaced. It printed the singular
  `--testPathPattern`, which Jest 30 ignores, and now carries the plural form
  with a note that says why.
- The `asana` candidate label was aligned with the catalog: "Asana v1 beta".

---

## 6. Specs added

`ptah-connectors.catalog.spec.ts` — 4 new cases, 31 in the file, all passing.
Each pins an invariant that did not exist before this batch. The `setupSteps` and
`scopes` shape rules were already pinned by C1 and were not duplicated.

1. **Every entry has a distinct label.** Ids and URLs were already unique, but a
   user picks a card by its label, and this batch is the first to put two rows of
   one vendor side by side. Two cards reading "Asana" would be two cards nobody
   can choose between.
2. **Every Google Workspace MCP server Google documents is present**, by URL, all
   eight. A row dropped by hand would otherwise leave no trace.
3. **Every `googleapis.com` row is `oauth-app`, has scopes, and every scope
   starts with `https://www.googleapis.com/auth/`.** A Google row without scopes
   cannot complete consent.
4. **Both Asana endpoints exist and are told apart**: exactly `asana` and
   `asana-v2`, v1 `oauth-dcr`, v2 `oauth-app` on the `/v2/mcp` URL.

---

## 7. Verification

```
npx nx run-many -t typecheck lint test -p @ptah-extension/shared @ptah-extension/cli-agent-runtime
```

Header read `Running targets typecheck, lint, test for 2 projects`. Result:
`Successfully ran targets typecheck, lint, test for 2 projects`.

| Project                             | typecheck | lint                  | test                                            |
| ----------------------------------- | --------- | --------------------- | ----------------------------------------------- |
| `@ptah-extension/shared`            | pass      | 0 errors, 2 warnings  | 54 suites, **1291 passed**, 0 failed            |
| `@ptah-extension/cli-agent-runtime` | pass      | 0 errors, 36 warnings | 48 suites, **633 passed, 1 skipped**, 634 total |

Shared gained 4 tests (1287 → 1291), which is the four new cases and nothing
else. The 1 skipped test is the live probe suite, which is `describe.skip`
without `PTAH_LIVE_PROBES=1`. That is the designed behavior.

### Lint warnings

Both shared warnings are `max-lines`. `ptah-connectors.catalog.ts` went from 703
to 808 counted lines, and `rpc.types.ts` at 3201 lines is pre-existing and
untouched. The catalog was not split, for the reason C1 gave and this batch did
not change: `CLAUDE.md` sets the 700-line ceiling at warn level and states that
"a contract barrel or exhaustive type union can be long and correct". The file is
a 63-row data table with no logic in it, and splitting it would create the
fragment sprawl the same rule forbids. The 36 `cli-agent-runtime` warnings are
pre-existing and untouched.

---

## 8. Notes for whoever comes next

- **The gaps C1 named in its section 7 items 6 and 7 are closed.** Items 1
  through 5 of that list are still open and unchanged by this batch.
- **Asana v1 is on borrowed time.** Its documented shutdown date passed a month
  ago and it still answers 401. Delete the `asana` row the first time it fails,
  rather than treating it as a bug.
- **The Google family is now nine rows** — eight Workspace servers plus BigQuery
  — and all nine are Developer Preview. If one URL changes, every one of them is
  suspect, and the C4 weekly probe is the thing that will say so first.
- **17 rows now carry `setupSteps`.** The C2 surface renders them and the C2.2
  card hint quotes a step count. Step counts still range from 4 to 5, so no C2
  copy needs revisiting.
