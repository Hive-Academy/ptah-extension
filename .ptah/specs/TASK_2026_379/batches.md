# TASK_2026_379 — Batches

Two batches run **in parallel** on **file-disjoint** paths, one per CLI agent.
The shared contract they both depend on (`setupSteps`, `scopes` on
`PtahConnector`) is ALREADY committed — do not re-add it, do not change its
shape.

Repo rules for both batches:

- Absolute Windows paths for Read/Write/Edit.
- `catch (error: unknown)`, narrow with `instanceof Error`. No `@ts-ignore`.
- Angular: standalone, `ChangeDetectionStrategy.OnPush`, signals + `inject()`,
  no `[innerHTML]`, Tailwind + daisyui classes matching the sibling files.
- Never `nx test a b c`. Use `npx nx run-many -t <target> -p <projects>` and
  check the `Running target … for N projects` header.
- Do not commit. Do not run any git command that changes state.
- Stay inside your batch's file list. The other agent is editing the other list
  at the same time.

Evidence for every row and every claim:
`D:\projects\ptah-extension\.ptah\specs\TASK_2026_378\research-report.md`.

---

## C1 — Catalog rows + live probe (executor: claude cli)

**Files (yours alone):**

- `libs/shared/src/lib/connectors/ptah-connectors.catalog.ts`
- `libs/shared/src/lib/connectors/ptah-connectors.catalog.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/mcp-directory/oauth/ptah-connectors-catalog.live.spec.ts`

### C1.1 Add the browser sign-in rows

Add every row from research-report section 4 that is not already in the
catalog, as `kind: 'oauth-dcr'`, with the URL exactly as probed. That is 24 new
rows. Write a one-sentence `description` in the voice of the existing entries
and pick the closest existing `category`.

**Hold back three rows** — Square, Ahrefs, Semrush. Their metadata passes but
their documentation restricts custom clients (report section 4). Add them in a
clearly marked commented-out block with the reason and a `[VERIFY: connect
once]` note, so the next person does not re-probe them from scratch.

`Cloudflare Bindings` and `Atlassian Rovo v2` are second endpoints for vendors
already present. Add them as separate ids (`cloudflare-bindings`,
`atlassian-v2`) only if their tool sets differ per the vendor docs; if you
cannot establish that in two fetches, skip them and say so in the report.

### C1.2 Add the app-required rows with setup steps

From report section 4b, add as `kind: 'oauth-app'` with a `setupSteps` array:
the four Google Workspace servers (Gmail, Calendar, Drive, Docs), BigQuery,
Slack, Box, MongoDB Atlas, PagerDuty, Shopify. GitHub and HubSpot already
exist — give them `setupSteps` too.

Each `setupSteps` entry is one imperative sentence. The step that tells the
user where to register the redirect URL MUST contain the literal token
`{redirectUrl}` — the surface substitutes the host's real value. Example shape:

```ts
setupSteps: [
  'Open the Google Cloud console and create an OAuth client of type Web application.',
  'Add {redirectUrl} to the authorized redirect URIs.',
  'Enable the Gmail API for the project.',
  'Copy the client ID and client secret into the fields below.',
],
```

For each Google entry, read the Workspace MCP documentation and set `scopes`
to what the server documents. If the documentation does not state scopes, omit
`scopes` and say so in the report — do not guess.

### C1.3 Add the Smithery Google rows

Add `gmail`, `googlecalendar`, `googledrive`, `googledocs`, `googlesheets` as
`kind: 'oauth-dcr'` with url `https://server.smithery.ai/<name>/mcp`. Label
them so a user can tell them apart from the Google direct rows, for example
"Gmail via Smithery". In the `description`, state that a third party hosts the
connection.

### C1.4 Add Pipedream and Zapier

Both as `kind: 'oauth-dcr'`:
`https://mcp.pipedream.net/v2` and `https://mcp.zapier.com/api/mcp/mcp`.
In the `description` of each, state the quota plainly — Zapier's free plan is
about 50 tool calls per month, Pipedream's MCP quota is unpublished.

### C1.5 Specs

Extend `ptah-connectors.catalog.spec.ts`: ids stay unique; every `oauth-app`
row has a non-empty `setupSteps`; every `setupSteps` array has at least one
entry containing `{redirectUrl}`; no `oauth-dcr` or `smithery` row has
`setupSteps`; `scopes`, when present, is a non-empty array of non-empty
strings; the three held-back services are absent from `PTAH_CONNECTORS`.

Extend the live probe spec to cover every new `oauth-*` url. Run it once:

```
$env:PTAH_LIVE_PROBES='1'; npx nx test @ptah-extension/cli-agent-runtime --testPathPattern ptah-connectors-catalog.live
```

Paste the full pass/fail table into your report. **A row whose probe fails does
not ship** — remove it and say why.

### C1 verification

```
npx nx run-many -t typecheck lint test -p @ptah-extension/shared @ptah-extension/cli-agent-runtime
```

Write `batch-report-C1.md` in this folder: rows added, rows held back with
reasons, the live probe table, test counts, and anything you could not verify.

---

## C2 — Setup-step rendering + docs (executor: codex cli)

**Files (yours alone):**

- `libs/frontend/marketplace/src/lib/connectors-surface.component.ts`
- `libs/frontend/marketplace/src/lib/connectors-surface.component.html`
- `libs/frontend/marketplace/src/lib/connectors-surface.component.spec.ts`
- `apps/ptah-docs/src/content/docs/marketplace/connectors.md`

Read first: the component and its template, `ptah-connectors.catalog.ts` (for
the `setupSteps` and `scopes` contract — read only, C1 owns that file), and
`oauth-surface.component.ts` for how the Advanced disclosure and the redirect
URL row already work.

### C2.1 Render the setup steps

When the user clicks **Connect** on an `oauth-app` connector, the surface today
opens the embedded custom-server form with the URL prefilled and Advanced open.
Add, above the client id field in that form's context, a numbered list of the
connector's `setupSteps`, with `{redirectUrl}` replaced by the value already
loaded from `mcpDirectory:getOAuthRedirectUri`.

Constraints:

- The redirect URL is loaded once and may be null. When it is null, render the
  step with the words "the redirect URL shown above" instead of the token, and
  never render a raw `{redirectUrl}`.
- Plain interpolation only. No `[innerHTML]`.
- The steps belong to the connector the user clicked. Clicking a different
  connector replaces them; closing the form clears them.
- Pass `connector.scopes` (joined with spaces) as the `scope` param of
  `connectOAuth` when present.

### C2.2 Kind hint copy

The card hint for `oauth-app` currently reads "Needs an app you create with the
provider". Extend it so a user knows the effort before clicking, for example by
appending the step count. Keep it one short line.

### C2.3 Specs

Add cases: steps render in order for an `oauth-app` connector; `{redirectUrl}`
is substituted with the loaded value; the null-redirect fallback wording is
used and no raw token appears; steps clear when the form closes; `scopes` reach
`connectOAuth` as a space-joined `scope`; an `oauth-dcr` connector renders no
steps.

### C2.4 Docs

Update `connectors.md`: a short section on what happens when a connector needs
an app you create, the numbered steps, and where the redirect URL comes from.
**Never write the words copilot, codex, openai, anthropic, or claude in this
file** — the VS Code Marketplace scanner rejects those names in non-JS files.
The one allowed exception is the existing fixed phrase "claude.ai connectors".
Do not paste the GitHub connector URL, which contains a trademarked name.

### C2 verification

```
npx nx run-many -t typecheck lint test -p @ptah-extension/marketplace
npx nx build ptah-docs
```

Write `batch-report-C2.md` in this folder: files changed, test counts, the docs
build tail, and a grep proving the forbidden words are absent from the docs file
you edited.

---

## C3 — Remaining catalog rows (executor: claude cli)

C1 and C2 are committed (`48d10f56d`). This batch closes the four data gaps the
C1 report named in its section 7.

**Files (yours alone):**

- `libs/shared/src/lib/connectors/ptah-connectors.catalog.ts`
- `libs/shared/src/lib/connectors/ptah-connectors.catalog.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/mcp-directory/oauth/ptah-connectors-catalog.live.spec.ts`

### C3.1 The four remaining Google Workspace servers

C1 shipped Gmail, Calendar, Drive, Docs and BigQuery. Google documents four
more on the same page: Sheets, Slides, Chat and People. Add each as
`kind: 'oauth-app'` with `setupSteps` in the shape C1 established (one step
containing `{redirectUrl}`) and `scopes` read from Google's documentation —
never guessed. If a scope set is not documented for a server, omit `scopes` and
say so in the report.

Reuse the wording of the existing Google rows so the five and the four read as
one family.

### C3.2 Asana v2

`https://mcp.asana.com/v2/mcp`. The research report and the C1 probe agree it
has no registration endpoint, so it is `oauth-app` and needs `setupSteps`. Keep
the existing `asana` v1 row: it still probes clean and Asana has not retired it.
Label the two so a user can tell them apart, and say in the v2 `description`
what it adds.

### C3.3 Probe and specs

Add every new row to the live probe candidate list. Run the probe with the
**plural** flag — `--testPathPatterns`, as your own C1 report established, since
the singular form silently runs the whole suite:

```
PTAH_LIVE_PROBES=1 npx jest --config libs/backend/cli-agent-runtime/jest.config.ts --rootDir libs/backend/cli-agent-runtime --testPathPatterns "ptah-connectors-catalog.live"
```

Paste the full table. A row whose probe fails does not ship. The existing spec
cases already enforce the `setupSteps` and `scopes` invariants; add cases only
where a new invariant appears.

### C3 verification

```
npx nx run-many -t typecheck lint test -p @ptah-extension/shared @ptah-extension/cli-agent-runtime
```

Write `batch-report-C3.md`: rows added, the probe table, scopes with their
source, test counts, anything you could not verify.

---

## C4 — Scheduled catalog probe (executor: codex cli)

**Files (yours alone):**

- `.github/workflows/connectors-probe.yml` (new)
- `.ptah/specs/TASK_2026_379/batch-report-C4.md` (your report)

Read `.github/workflows/nightly-coverage.yml` first and follow its conventions
for the runner, the Node setup, the npm install step and the concurrency group.
Do not copy a convention it does not use.

The workflow:

- Runs weekly on a schedule, and on `workflow_dispatch`.
- Sets `PTAH_LIVE_PROBES=1` and runs the live catalog probe with the **plural**
  `--testPathPatterns` flag (the singular form is ignored by Jest 30 and
  silently runs the whole suite).
- On failure, opens ONE issue titled so a second failure updates it rather than
  filing a duplicate, with the probe output in the body. Use `actions/github-script`
  or the `gh` CLI already available on the runner; do not add a marketplace
  action that is not already used elsewhere in this repository.
- Never runs on pull requests. This probe makes real network calls to third
  parties; it must not run per-PR.

Validate the file parses: `npx js-yaml .github/workflows/connectors-probe.yml`
or an equivalent already available in the repository. Do not trigger the
workflow.

Write `batch-report-C4.md`: the file added, the schedule chosen and why, the
conventions you took from `nightly-coverage.yml`, and the parse-check output.

---

## Not automatable

**End-to-end connect.** The probe proves discovery and registration metadata.
It cannot prove that consent completes, that a token is issued, or that a tool
call returns. That needs a human with an account, and it is the reason Square,
Ahrefs and Semrush are held back rather than shipped on a green probe.
