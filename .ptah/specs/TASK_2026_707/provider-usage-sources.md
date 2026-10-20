# Research Report - TASK_2026_707: Provider usage sources

## Question

- Decision this supports: how the analytics dashboard's "Plan limits" section should read
  usage per provider (Antigravity, Ollama Cloud, Grok/xAI), and what data model a
  T3-style usage dashboard can build on.
- Question: for each provider, what is the official or best-available way for a
  third-party local app (Ptah) to read plan-window percentages, reset times,
  per-model usage, credit balance, and token/cost history?
- Bounds: read-only web research. No CLI was executed, no endpoint was called with a
  real key, and no source file in this repository was modified. TUI/CLI output formats
  that could only be confirmed by running a tool are marked UNVERIFIED.

## Answer

Ollama Cloud is the only one of the three quota providers with a fully documented,
API-key-authenticated surface: `GET /api/balance` returns session/weekly remaining
percent and reset times (legacy plans) plus purchased credit balance, and
`GET /api/usage` returns per-model request counts and USD spend. xAI splits in two:
the Management API (documented) covers prepaid balance and spend history for API-key
accounts but needs a *management* key, not the inference key a user already has;
SuperGrok subscription logins have no documented surface at all — only an undocumented
`cli-chat-proxy.grok.com` billing endpoint. Antigravity exposes quota only through the
interactive `/usage` TUI panel or as a text report from headless `agy -p /usage`; there
is no JSON quota output. T3 Code does not read provider quotas at all for most
providers: it computes cost from provider CLIs' local transcripts priced against the
LiteLLM `model_prices_and_context_window.json` table, with explicit pricing
provenance statuses.

---

## 1. Antigravity CLI (`agy`)

**Method**

- Interactive: `/usage` (alias `/quota`) inside a TUI session opens the "Model
  Quotas" panel. It shows per-model usage limits and remaining requests/tokens
  (docs name "Gemini 3.5 Flash" and "Gemini 3.1 Pro" as examples) and performs an
  active refresh from the backend each time it opens. No flags, no JSON output, and
  no reset times are documented on that page.
- `/credits` shows remaining G1 credits and purchase links (interactive).
- Headless/print mode: CLI-handled slash commands "such as `/model` and `/usage`"
  can run as standalone print invocations (`agy -p /usage`) and produce "a text
  report rather than a standard event stream". They run without spending quota.
- `/usage` is **not** in the set of print-mode commands that emit structured
  payloads under `--output-format json` (that set, per release 1.1.12, is
  `/permissions`, `/hooks`, `/help`, `/changelog`, `/config`). No JSON quota
  surface is documented anywhere.
- Shell commands `agy models` and `agy agents` do support `--output-format json`
  (release 1.1.12), but they list models/agents, not usage.
- The status line fetches model quota internally (release 1.1.12 fixed it being one
  fetch out of date), which proves a backend quota call exists — but its endpoint is
  not documented.

**Auth**

- One interactive `agy` login (OAuth; `/logout` "purge[s] authentication tokens from
  the secure keyring"). Headless mode uses cached credentials; an unauthenticated
  headless run exits with an `authentication required` error instead of hanging.
- API-key mode: set `"modelProvider": "gemini"` in
  `~/.gemini/antigravity-cli/settings.json` plus `GEMINI_API_KEY` in the
  environment; `GOOGLE_GEMINI_BASE_URL` can redirect to a custom endpoint. Only
  `GEMINI_API_KEY` is read (`GOOGLE_API_KEY` and `.env` files are not).
  UNVERIFIED by direct fetch (the `install.md` URL returned 404; claim comes from
  search-result summaries of the official install docs and Harbor PR #2776, which
  report the mode as added around release 1.1.13, Aug 2026).
- Implication for Ptah: a spawned process can run `agy -p /usage` only if the user
  has logged in interactively at least once on that machine. Ptah cannot create the
  session itself.

**Sample response fields**

- None documented for quota. The headless JSON envelope for *normal* runs is
  `conversation_id`, `status` (`SUCCESS`/`ERROR`/`CANCELED`/`INTERRUPTED`/`INVALID`/
  `WAITING`/`RUNNING`), `response`, `error`, `duration_seconds`, `num_turns`,
  `structured_output` (with `--json-schema`), and `usage` with `input_tokens`,
  `output_tokens`, `thinking_tokens`, `cache_read_tokens`, `total_tokens` — that
  `usage` is per-run token accounting, **not** plan quota.
- The exact text format printed by `agy -p /usage` is UNVERIFIED (would require
  running a logged-in CLI).

**Stability**: documented (interactive TUI + print-mode text report). No documented
JSON quota endpoint; the print-mode text report has no documented format.

**Sources**

- https://antigravity.google/docs/cli/commands/usage/ — undated page, fetched 2026-10-20.
- https://antigravity.google/docs/cli/reference/ — undated page, fetched 2026-10-20.
- https://antigravity.google/docs/cli/headless/ — undated page, fetched 2026-10-20.
- https://github.com/google-antigravity/antigravity-cli/releases/tag/1.1.12 — fetched 2026-10-20.
- https://www.antigravity.google/docs/cli/install and
  https://github.com/harbor-framework/harbor/pull/2776 — via search-result summary,
  2026-10-20 (direct fetch of the install page variant returned 404): GEMINI_API_KEY mode.

**Recommendation for Ptah**

Do not parse the TUI. If Antigravity must appear in the plan-limits section, run
`agy -p /usage` headless and parse the text report behind a small, isolated adapter
marked fragile (the format is undocumented and can change per CLI release), with a
clean "not available" fallback. First run one experiment on a logged-in machine:
`agy -p /usage` and `agy -p /usage --output-format json`, to learn whether the JSON
envelope wraps the report (untested; even if it does, only the text payload inside
carries the numbers). Note in the UI that Antigravity needs a prior interactive
login.

---

## 2. Ollama Cloud

**Method** (both endpoints documented at docs.ollama.com)

- `GET https://ollama.com/api/balance` — no query parameters. The endpoint that
  matches the ollama.com settings page ("Session usage 0% used, resets in 1 hour",
  "Weekly usage 14% used, resets in 6 days", usage credits balance).
  - Legacy plans (session + weekly limits, i.e. the plan the settings page shows):
    `included.session.remaining_percent` (0–100, percent **remaining**) and
    `included.session.resets_at` (UTC); same for `included.weekly`;
    `purchased.balance_usd` (remaining unexpired purchased credits).
  - Current plans: `included.balance_usd`, `included.allowance_usd`,
    `included.period.from` / `included.period.until` (monthly reset schedule);
    `purchased.balance_usd`. Team members share balances.
- `GET https://ollama.com/api/usage?range=24h|7d|30d&scope=self|team&group_by=model`
  — token/USD timeseries. Top level: `range`, `scope`, `granularity` (`hour` for 24h,
  else `day`), `from`, `until`, `totals`, `buckets[]`. Totals and each bucket carry
  `request_count`, `usage_usd`, `input_tokens`, `cached_input_tokens`,
  `output_tokens`, and `groups[]` (with `group_by=model`: `model` + the same
  metrics; up to 10 groups ranked by total `usage_usd`; legacy data may rank by
  `request_count`), plus `remainder` for usage outside the top groups. Each bucket
  also has `from`, `until`, `partial` (the current hour/day).
  - Semantics: `cached_input_tokens` is already included in `input_tokens`;
    `usage_usd` covers plan-covered usage **and** usage paid from purchased credits;
    timestamps UTC; empty buckets still returned.
  - The "Models used this week: glm-5.3 — 185 requests" settings-page line maps to
    `range=7d&group_by=model` → `totals.groups[].model` + `request_count`.
  - This endpoint does **not** return plan limits, percentages, or reset times.
- Rate limits (both endpoints): 10 requests per minute per user, shared across API
  keys and devices; `429` with a `Retry-After` header; docs recommend polling at most
  once per minute. Errors: `400`, `401`, `403` (suspended), `429`, `503` (balance
  reporting temporarily unavailable), all with an `error` string field.

**Auth**

- `Authorization: Bearer $OLLAMA_API_KEY`, key created at
  https://ollama.com/settings/keys. No browser cookie needed for either endpoint.

**Historical note (UNVERIFIED)**

Community reports (GitHub issue ollama/ollama#12532 and related) say `/api/usage`
once returned `limits.session.usage` / `limits.weekly.usage` as decimal fractions of
quota used, and that a referenced issue reports the `limits` object was removed
around 2026-10-07. The current official docs show no `limits` object, which matches
the removal; the exact cutover date is UNVERIFIED. Before these endpoints existed,
tools scraped the `ollama.com/settings` HTML (parsing `width: N.N%` CSS) with the
browser session cookie.

**Community tools (what auth they use)**

- CodexBar (steipete/CodexBar, `docs/ollama.md`): API-key path calls
  `GET https://ollama.com/api/balance` via a bundled `ollama-api.ts` plugin (key from
  Settings → Providers → Ollama, or `OLLAMA_API_KEY` env; `HTTP 401/403` invalidates
  the stored key). It derives "Monthly credits used" and a utilization percentage
  from `included.allowance_usd − included.balance_usd`, reset from
  `included.period.until`, and shows `purchased.balance_usd` as "Credit balance"
  without inventing a quota bar when the account reports no meter.
- Cookie path (legacy settings pages and CodexBar's older versions): scrape
  `https://ollama.com/settings` with browser cookies (WorkOS AuthKit `wos-session`
  plus legacy Ollama/NextAuth cookies) to read the Session/Weekly usage percentages;
  redirects to `/signin` are treated as expired sessions. This is the only source
  for percentage meters on some legacy pages, but it is fragile and unnecessary now
  that `/api/balance` exists.

**Stability**: documented (both endpoints, with rate limits and error codes). The
strongest, most stable surface of the three quota providers.

**Sources**

- https://docs.ollama.com/api/balance — undated page, fetched 2026-10-20 (all field
  names above verified against it).
- https://docs.ollama.com/api/cloud-usage — undated page, fetched 2026-10-20
  (verified, including the example response).
- https://github.com/steipete/CodexBar/blob/main/docs/ollama.md and
  .../blob/main/docs/providers.md — via search-result summary, 2026-10-20.
- https://github.com/ollama/ollama/issues/12532, /issues/15132, /issues/18653 — via
  search-result summary, 2026-10-20 (limits-removal claim UNVERIFIED).

**Recommendation for Ptah**

Use `GET /api/balance` as the primary plan-limits source: it returns exactly what
the settings page shows — session %, weekly %, both reset times, and purchased
credits. Convert `remaining_percent` to "used %" by inverting it
(used = 100 − remaining); label it clearly because the API reports remaining. Use
`GET /api/usage?range=7d&group_by=model` for per-model request counts and USD, and
`range=30d`/`24h` for the T3-style history charts. Handle both balance shapes
(legacy `session`/`weekly` vs current `balance_usd`/`allowance_usd`/`period`) and
poll at most once per minute, honoring `Retry-After`. No cookie scraping.

---

## 3. Grok / xAI

There are two separate account types with two separate surfaces.

### 3a. Grok CLI (Grok Build) subscription login — SuperGrok / X Premium+

**Method**

- No `grok usage` shell command exists. The CmdBrief guide states "Grok Build
  publishes no `grok usage` command and no API for the weekly allowance".
- In-session slash command `/usage show | manage` reportedly opens
  `https://grok.com/?_s=usage` and `/usage show` renders billing data —
  UNVERIFIED (search-attributed only; the CmdBrief page does not mention it).
- Undocumented endpoints used by community tools (verified via the toml01/grok-usage
  README): `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits` and
  `GET https://cli-chat-proxy.grok.com/v1/user?include=subscription`, called with the
  same OIDC bearer token the CLI stores in `~/.grok/auth.json` (optional header
  `x-grok-client-mode: cli`). Search-attributed response fields (UNVERIFIED — the
  README does not list key names): `creditUsagePercent`, `currentPeriod` (e.g.
  `WEEKLY` with start/end/reset), `productUsage[]`, `onDemandCap`/`onDemandUsed`,
  `prepaidBalance`, `isUnifiedBillingUser`. xAI reports usage as a percent value,
  not absolute counts.
- Local fallback: `~/.grok/logs/unified.jsonl` is the CLI's own billing log; CmdBrief
  parses weekly credit consumption from it. Sessions live under `GROK_HOME`
  (default `~/.grok`) with a `summary.json` per session.
- Token expiry: "The login token expires after a few hours"; a stale token requires
  running `grok` once to refresh. The endpoint is not documented by xAI and "xAI can
  change it at any time".
- SuperGrok specifics: a single shared **weekly** allowance across all products;
  no page publishes the allowance size. Community cross-check: quota-axi issue #220
  reports the SuperGrok weekly limit readable via the Grok CLI path while quota-axi
  reports quota unavailable for the same OIDC login — the surfaces are unstable
  enough that tools disagree.

**Auth**: OIDC token from `~/.grok/auth.json` (created by `grok login`), not an API
key. Community wrappers: `toml01/grok-usage` (`grok-usage`, `grok-usage --json` for
raw JSON; prints plan tier, usage limit, current usage, reset time, percent) and
`apoapostolov/pi-grok-usage` (Pi extension).

**Stability**: undocumented. None of this is in official docs; it can break on any
CLI update.

### 3b. xAI Management API — API-key (pay-as-you-go) accounts

**Method** (documented REST reference)

- Base URL `https://management-api.x.ai`. All billing routes are under
  `/v1/billing/teams/{team_id}/...` and take the team id as a path parameter.
- `POST /v1/billing/teams/{team_id}/usage` — usage analytics. Body wraps
  `analyticsRequest` with `timeRange` (`startTime`/`endTime` as
  `YYYY-MM-DD HH:MM:SS` **local wall-clock** values plus an IANA `timezone`, not
  UTC ISO strings), `timeUnit` (`TIME_UNIT_MONTH`/`TIME_UNIT_CALENDAR_WEEK`/
  `TIME_UNIT_DAY`/`TIME_UNIT_HOUR`/...), `values[]` (e.g.
  `{"name": "usd", "aggregation": "AGGREGATION_SUM"}`), optional `groupBy[]`
  (e.g. `["description"]`) and `filters[]` (AND-combined). Response:
  `timeSeries[]`, each with `group[]`, `groupLabels[]`, and
  `dataPoints[]` of `{timestamp, values[]}` aligned with the requested
  aggregations; plus `limitReached` (true = cardinality cap hit, treat as partial).
- `GET /v1/billing/teams/{team_id}/prepaid/balance` — `changes[]` with `teamId`,
  `changeOrigin` (`PURCHASE`/`SPEND`/`REFUND`/`MANUAL`/`AUTO_PURCHASE`),
  `topupStatus`, `amount{val}` (**USD cents**; purchases negative), `invoiceId`,
  `invoiceNumber`, `createTime`, `paymentProcessor{...}`; and `total{val}` (the
  currently available prepaid credits).
- `GET /v1/billing/teams/{team_id}/postpaid/invoice/preview` — in-progress cycle
  spend: `coreInvoice` (with `lines[]`, `amountBeforeVat`, `vatCost`,
  `amountAfterVat`, `prepaidCredits`...), `effectiveSpendingLimit`,
  `defaultCredits`, `billingCycle{year, month}`.
- `GET|POST /v1/billing/teams/{team_id}/postpaid/spending-limits` —
  `spendingLimits{hardSlOverride, hardSlAuto, effectiveHardSl, softSl, effectiveSl}`;
  POST sets `desiredSoftSpendingLimit` (0 = prepaid only).
- Also `GET .../invoices`, `GET|POST .../billing-info`, `GET .../payment-method`,
  `POST .../prepaid/top-up`.
- Plan-limit concept: none on the API side — API usage is prepaid/postpaid USD. The
  spending limit is the closest analogue to a cap. There is no percentage or
  plan-window meter for API-key accounts.

**Auth**

- `Authorization: Bearer <management key>` — a **management key**, created in the
  xAI Console (the account needs "Management Keys Read + Write" permission; the key
  is on the settings page). An inference API key against `https://api.x.ai` "will
  not answer billing routes". `team_id` is required in every path; where to obtain
  it programmatically is UNVERIFIED (the how-to guide takes it from an env var).

**Stability**: documented (REST reference at docs.x.ai), incl. an official proto
definition (`xai-org/xai-proto`, `proto/xai/management_api/v1/billing.proto`).

**Sources**

- https://docs.x.ai/developers/rest-api-reference/management/billing — undated page,
  fetched 2026-10-20 (endpoint paths and schemas verified).
- https://docs.x.ai/developers/rest-api-reference/management — fetched 2026-10-20
  (base URL, management-key requirement; header name not given on this page).
- https://metagrok.io/how-to/get-usage-analytics-via-management-api — fetched
  2026-10-20 (auth header `Authorization: Bearer ${XAI_MANAGEMENT_KEY}`, full curl
  example, response shape).
- https://cmdbrief.com/guides/grok-cli — Sep 2026 per search, fetched 2026-10-20.
- https://github.com/toml01/grok-usage — fetched 2026-10-20 (endpoints, auth file,
  output fields, token-expiry and instability caveats).
- https://github.com/kunchenguid/quota-axi/issues/220,
  https://github.com/apoapostolov/pi-grok-usage — via search-result summary,
  2026-10-20.

**Recommendation for Ptah**

This answers the user's "why does it not work / where to put an API key": the xAI
inference key a user already has cannot read billing, by design. Ptah needs a
separate **management key** field (labeled "xAI management key", distinct from the
inference key) plus the team id. For API-key accounts: read
`prepaid/balance` (`total` = credits) and `POST usage` with
`groupBy: ["description"]` for spend history — documented and stable; convert cents
to USD. There is no plan percentage to show for API-key accounts; show credits and
spend instead. For SuperGrok subscription logins, the only data source is the
undocumented `cli-chat-proxy.grok.com` billing endpoint (or the CLI's own
`~/.grok/logs/unified.jsonl`); if Ptah supports it, isolate it in an adapter labeled
undocumented and handle the few-hour token expiry by prompting the user to re-run
`grok`. Otherwise show "not available" for subscription accounts until xAI
documents a surface.

---

## 4. T3 Code (t3.codes / pingdotgg/t3code) — comparison

**How the Usage dashboard works** (verified in `docs/user/usage.md` and
`apps/server/src/usage/UsageService.ts`):

- It shows **estimated API-equivalent cost**, explicitly not the subscription bill.
  Costs break down by token type and speed; "Premium" covers the Fast/Ultrafast
  surcharge; unallocatable costs (e.g. provider-reported costs without public model
  rates) appear as "Other".
- The server scans provider CLIs' own local stores rather than T3's records —
  OpenCode's SQLite database and older JSON history, Antigravity's local
  conversation databases (including T3-managed profiles), with directory overrides
  `OPENCODE_DATA_DIR`, `ANTIGRAVITY_DATA_DIR`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR`,
  `GROK_HOME`, `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`. Cursor is the
  exception: account usage is read through "Cursor's dashboard API" using the
  server's saved CLI login (macOS Keychain access can be enabled). Credentials come
  from `OPENCODE_API_KEY`, `CURSOR_AUTH_TOKEN`, and `grok login`. A CLIProxyAPI hub
  (URL + management key) can be added under Settings → Providers → Usage providers.
- **Pricing table** (verified in `UsageService.ts`): fetched from LiteLLM —
  `https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`,
  with fallback
  `https://api.github.com/repos/BerriAI/litellm/contents/model_prices_and_context_window.json?ref=main`
  (header `application/vnd.github.raw+json`). 10-second fetch timeout; a response is
  accepted only if it parses with at least one rate. Disk cache
  `usage-model-rates.json` (`{fetchedAtMs, document}`) under `config.stateDir`;
  24-hour TTL; 60-second forced-refresh floor and failed-refresh backoff. Pricing
  provenance is exposed as `pricing{status, source, fetchedAt, knownModels}` with
  statuses `"fresh"` / `"cached"` / `"unavailable"`.
- **Cost quality** (search/DeepWiki-attributed, UNVERIFIED in the files read:
  the constants live in the aggregator/pricing modules, and the DeepWiki page
  fetch was rate-limited): `providerReported` (transcript carried an explicit cost),
  `modelPriced` (matched the LiteLLM table), `unpriced` (tokens counted, excluded
  from cost). `cacheSavingsUsd` = what cached input would have cost at the full
  input rate minus actual cost. Also attributed there: scans of
  `~/.claude/projects/**/*.jsonl` and `~/.codex/sessions/**/*.jsonl` (mirroring
  ccusage), buckets keyed `(day, hourStart?, provider, model)`,
  `cachedInputTokens`/`cacheCreationTokens` disjoint from `uncachedInputTokens`,
  and `reasoningTokens` as a subset of `outputTokens`.
- **User overrides** (verified in the docs): a per-environment "Model prices" table
  in USD per million input/output tokens, optional cache read/write rates (blank
  inherits the input rate; `0` means free), "Map to" price aliasing, and a "Mixed"
  display when environments disagree. Overrides replace automatic pricing for that
  environment's history.
- **Scan cache** (verified): files memoized by size, modification time and provider;
  a strictly larger file resumes from the saved byte position; failed reads are
  deliberately not cached; duplicates across moved session copies are deduplicated;
  retention 92 days; serialized atomic writes. `UsageSummary` returns
  `contractVersion`, `readAt`, `timeZone`, `sinceDay`, `untilDay`, `buckets`,
  `sources` (each `fingerprint`, `status`, `scannedFiles`, `skippedFiles`,
  `malformedRecords`, `distinctSessions`, `message`), `pricing`, `scanDurationMs`;
  default resolution is day, hourly only within a ≤24h window.
- Known bug history (search-attributed): issue #5797 — provider-qualified model
  aliases overwrote canonical pricing entries, inflating estimates; fixed in PRs
  #5810/#8529/#8806.

**Stability**: open-source repo, MIT-style public docs; the pricing pipeline is
readable in the repo (verified directly in source).

**Sources**

- https://github.com/pingdotgg/t3code/blob/main/docs/user/usage.md — fetched
  2026-10-20 (raw).
- https://github.com/pingdotgg/t3code/blob/main/apps/server/src/usage/UsageService.ts —
  fetched 2026-10-20 (raw; LiteLLM URLs, TTLs, cache files, `UsageSummary` shape
  verified).
- https://deepwiki.com/pingdotgg/t3code/5.8-observability-and-telemetry — fetch was
  rate-limited (429); cost-quality categories and token semantics are cited from
  search-result summaries of it, 2026-10-20.
- https://github.com/pingdotgg/t3code/issues/5797 — via search-result summary.

**Relevance for Ptah**

T3's Usage dashboard is **computed, not provider-reported**: local transcripts
priced against a public table, with explicit pricing provenance (fresh/cached/
unavailable) and cost-quality labels (provider-reported / model-priced / unpriced).
Only Cursor usage goes through an authenticated API. For Ptah's T3-style dashboard,
this is the pattern to copy — and it composes with the per-provider quota adapters
above: Ollama and xAI-API accounts get real provider-reported plan data;
Antigravity and Grok-subscription accounts fall back to transcript-derived cost
estimates.

---

## Verified vs inferred

- **Verified by direct page/source fetch** (2026-10-20): Antigravity `/usage` TUI
  behavior, `/credits`, headless flags and JSON envelope, `/usage` as print-mode text
  report; Ollama `/api/balance` and `/api/usage` request/response schemas and rate
  limits; xAI Management API endpoint list and schemas (docs.x.ai) plus auth header
  and example (metagrok); grok-usage README (endpoints, auth file, output, caveats);
  CmdBrief Grok guide (no `grok usage` command, `unified.jsonl`, SuperGrok weekly
  allowance); T3 usage docs and `UsageService.ts` pricing pipeline.
- **Inferred or search-attributed (marked UNVERIFIED where load-bearing)**:
  Antigravity GEMINI_API_KEY setup details; Grok CLI `/usage show` behavior and the
  `cli-chat-proxy` response key names; Ollama `/api/usage` limits-removal date; T3
  cost-quality categories and token semantics (from DeepWiki summaries).

## Decisions

1. **Ollama plan limits: use the two documented endpoints, not cookie scraping.**
   Options: (a) `/api/balance` + `/api/usage` with an API key, (b) scrape
   ollama.com/settings with browser cookies, (c) parse the settings CSS as older
   tools did. Evidence: both endpoints are officially documented with rate limits
   and return exactly the settings-page values; cookie scraping is fragile and
   session-bound (CodexBar's older versions prove the pain). Reversible: yes.
2. **Ollama percentage direction: store and display "used %", computed as
   100 − `remaining_percent`.** The API reports remaining, the UI shows used.
   Reversible: yes.
3. **xAI API-key accounts: use the Management API with a dedicated management-key
   field plus team id; show credits and spend, not a plan percentage.** Options:
   (a) management key + `/v1/billing/...`, (b) inference key (fails: "will not
   answer billing routes"), (c) undocumented cli-chat-proxy (subscription only).
   Reversible: yes.
4. **Antigravity: treat as best-effort text parsing of `agy -p /usage`, isolated
   behind an adapter with an unavailable fallback; do not parse the TUI.**
   Reversible: yes. This is a recommendation; the architecture decision stays with
   the architect.
5. **T3-style dashboard: adopt the local-transcript + LiteLLM-rates pattern with
   pricing provenance statuses.** Verified LiteLLM URL and 24h-TTL disk cache
   pattern from T3 source. Reversible: yes.

## Open questions

- **Antigravity print output**: the exact text format of `agy -p /usage`, and
  whether `--output-format json` wraps it. Smallest experiment: on a logged-in
  machine, run `agy -p /usage` and `agy -p /usage --output-format json` and inspect
  stdout.
- **xAI team id**: where to obtain `team_id` programmatically (Console URL vs a
  management API route). Smallest experiment: create a management key, list teams
  via the management API, and compare with the Console URL.
- **Ollama limits history**: whether `/api/usage` ever again exposes plan limits,
  and whether new pay-as-you-go plans expose any session/weekly meter (the balance
  endpoint returns a monthly period for them). Watch issues #15132/#18653.
- **Grok subscription**: the exact response key names of
  `cli-chat-proxy.grok.com/v1/billing?format=credits`. Smallest experiment: with a
  fresh `grok login`, call the endpoint with the token from `~/.grok/auth.json` and
  dump the JSON (as `grok-usage --json` does).
- **T3 pricing edge cases**: whether Ptah should replicate T3's provider-qualified
  alias handling (the #5797 bug class) if it builds its own LiteLLM-table parser.