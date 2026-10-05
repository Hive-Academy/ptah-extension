# Research Report - TASK_2026_596

## Question

- Decision this supports: which data source Ptah's per-provider quota adapters should read for plan-limit windows (used %, reset time), for (a) the main session and (b) spawned CLI lanes.
- Question: per provider, what is the most reliable and least fragile way to learn 5h / weekly / per-model / monthly windows?
- Bounds: no design, no code. Nothing was run against live vendor accounts; payload shapes for Antigravity and Ollama come from third-party tools and are labelled as such. Cursor/other lanes not examined. Firecrawl not used. Installed Claude SDK checked at `D:\projects\ptah-extension\node_modules\@anthropic-ai\claude-agent-sdk\sdk.d.ts` (worktree node_modules is a junction to it). Codex protocol checked at the repo's generated file (codex-cli 0.147.0).

## Answer

Rank by "vendor-typed or vendor-documented first": Claude (SDK `rate_limit_event` plus experimental `usage_...()` query, both typed in the installed SDK) and Codex (`account/rateLimits/read`, already shipped) are solid. Antigravity (local language server `GetUserStatus`) and Ollama (`ollama.com/api/usage`) are real but undocumented, so they must be isolated behind "estimated" adapters that fail soft. OpenCode has no programmatic usage source at all; only the web console and the error text at the limit exist. For lanes, the only uniform signal is the error text the lane prints at the limit; quota windows for a lane are best read from the account-level source of that lane's vendor (same account), not from the lane process.

## Evidence

| Claim | Source | Date | Verified how |
| --- | --- | --- | --- |
| SDK emits `rate_limit_event` "when rate limit info changes"; carries `status` (allowed/allowed_warning/rejected), `resetsAt`, `rateLimitType` (five_hour, seven_day, seven_day_opus, seven_day_sonnet, seven_day_overage_included, overage), `utilization`, overage fields | `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:5317-5355` | installed | read the .d.ts |
| `Query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(opts)` returns `SDKControlGetUsageResponse`: `rate_limits_available`, `subscription_type`, `rate_limits.{five_hour,seven_day,seven_day_oauth_apps,seven_day_opus,seven_day_sonnet}` each `{utilization 0-100, resets_at ISO8601}`, `model_scoped[]` `{display_name, utilization, resets_at}`, `extra_usage{monthly_limit, used_credits, utilization}`; null for API key / Bedrock / Vertex; `opts` can skip the local transcript scan ("for a usage meter") | `sdk.d.ts:2856-2874, 4001-4104` | installed | read the .d.ts |
| `/usage` result also carries `usage_report` (structured twin) only from claude.ai-subscriber sessions | `sdk.d.ts:3461` | installed | read |
| Repo only has the type guard `isRateLimitEvent`; no consumer | `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts:400` (grep of libs/backend found no other `rate_limit_event`) | repo | grep |
| Claude Code statusline JSON gives `rate_limits.five_hour/seven_day.{used_percentage, resets_at (unix s)}`; present only for Pro/Max (or gateway) and only after first API response; each window may be absent; dropped after `resets_at` | https://code.claude.com/docs/en/statusline (line 343, 842-846 of fetched text) | fetched 2026-10-03 | read vendor doc |
| Third-party descriptions of Claude unified headers `anthropic-ratelimit-unified-{claim}-utilization / -reset / -status` on every API call | https://www.cometapi.com/when-does-claude-code-usage-reset/ (search snippet) | undated | inferred; third party, not verified against vendor |
| Claude CLI limit text seen by users: "5-hour limit reached ∙ resets 2am"; "You've hit your limit"; clock time only, local tz, no date | https://claudeissues.com/issue/7157-5-hour-limit-reached-resets-2am (search snippet) | undated | secondary |
| Codex `account/rateLimits/read` returns `rateLimits{limitId,limitName,primary,secondary,credits,planType,rateLimitReachedType,...}` where window = `{usedPercent, windowDurationMins, resetsAt}`; plus `rateLimitsByLimitId` | `libs/backend/auth-providers/src/lib/providers/codex/protocol/codex-account.generated.ts:22-44` (generated from codex-cli 0.147.0) | repo | read |
| Codex service spawns `codex app-server`, `initialize`, `account/read`, `account/rateLimits/read`; only for `chatgpt` auth; 'unsupported-auth' for apiKey/Bedrock; pinned to protocol version | `codex-account-usage.service.ts:138-178, 191-203` | repo | read |
| Codex session JSONL: `event_msg` with `payload.type == "token_count"` carries `rate_limits.primary/secondary` with `used_percent`, `window_minutes`, `resets_in_seconds` (reset = event timestamp + resets_in_seconds); events have no predictable cadence; need a message sent in session first | https://github.com/xiangz19/codex-ratelimit ; https://codex.danielvaughan.com/2026/06/05/codex-cli-session-forensics-jsonl-post-mortems-codex-trace-cass-ccusage/ (cadence) | undated / 2026-06-05 | third-party; field names NOT verified against Codex source |
| Codex limit error text: "You've hit your usage limit. Upgrade to Pro (...) or try again at 5:05 PM." Already parsed by `summarizeCliSdkError` (`/usage limit/i`, `/try again at\s+([^\n.)]+)/i`), clock time only | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/sdk-error-summary.ts:20-55` and its spec | repo | read |
| Codex SDK package `@openai/codex-sdk` type defs contain no rate-limit fields | grep of `node_modules/@openai/codex-sdk` for rate_limits/primary/used_percent: no matches | installed | grep |
| Antigravity language server: `https://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/GetUserStatus`; port + `--csrf_token` taken from the server process args; per-model `remainingFraction`/`resetTime` (tool renders `remainingPercent`, `resetTime`, label) | https://claudeskills.info/skills/sundial-org/awesome-openclaw-skills/antigravity-balance/ ; https://glama.ai/mcp/servers/@abdullah1854/MCPGateway (search snippets; source fetch 404) | undated | third-party only; undocumented |
| Antigravity CLI limit text: "RESOURCE_EXHAUSTED (code 429): You have exhausted your capacity on this model. Your quota will reset after 144h24m50s." (a relative duration); `/usage` alias `/quota` exists; distinct from MODEL_CAPACITY_EXHAUSTED (not a quota) | https://discuss.ai.google.dev/t/antigravity-rate-limit-quota-reset-issue/170535 ; https://agentpedia.codes/blog/antigravity-model-capacity-exhausted-fix (search snippets) | undated | secondary, forum reports |
| OpenCode Go: $12 / 5h, $30 weekly, $60 monthly; docs express as 20% / 50% / 100% of monthly; "rolling" is an inference from docs; usage tracked "in the console"; no API/CLI documented; optional "Use balance" fallback to Zen | https://opencode.ai/docs/go/ | fetched 2026-10-03 | read vendor doc (summarised by fetch tool) |
| OpenCode error when free cap hit: "Free usage exceeded, subscribe to Go" plus "retrying in Ns - attempt #n"; known bug: Go subscribers misclassified as free for `opencode/` and `-free` models | https://github.com/anomalyco/opencode/issues/42013 and related (search snippet) | undated | secondary |
| Ollama docs list only `/api/chat` and `/api/tags` and link `ollama.com/settings/usage`; no usage API, limits, or 429 body documented | https://docs.ollama.com/cloud | fetched 2026-10-03 | read vendor doc |
| `ollama.com/api/usage` with `Authorization: Bearer <api key>` returns session and weekly usage percentages, per-model request counts, activity; community says undocumented; reset times NOT in payload (session = fixed 5h UTC buckets, weekly = Monday 00:00 UTC, per that author's inference) | https://community.home-assistant.io/t/ollama-usage-monitoring/1017888 | undated | third-party |
| Another third party scrapes DOM and says "Ollama still hasn't shipped an official usage endpoint"; its JSON has `percent`, `resets_at` (ISO8601) per session/weekly, so the settings page does show resets | https://ai.rud.is/posts/2026-05-27-ollama-usage-enhanced.md | 2026-05-27 | third-party |
| An Apify actor claims `/api/usage` + `/api/me` are "official" and returns session reset countdown | https://apify.com/subimpact/ollama-usage-checker | undated | vendor-of-actor claim, not Ollama |
| Ollama cloud 429 on session/weekly quota; "honor Retry-After if present" | https://apis.io/rate-limits/ollama/ollama-rate-limits/ (third-party catalogue citing ollama docs) | undated | secondary; no 429 body sample found anywhere |

## Options

### Claude (main session and claude CLI lane)

| Option (ranked) | Fit here | Cost | Failure mode |
| --- | --- | --- | --- |
| 1. SDK `rate_limit_event` stream (typed) | Ptah already runs the Agent SDK; guard exists, no consumer. Gives `resetsAt`, `rateLimitType`, `utilization`, `status` per window, near-zero cost | Add a consumer in the stream path | Event fires "when rate limit info changes", not every turn; likely only sends the window that changed/is nearest (not verified). Partial picture, subscriber-only. Cannot give a complete 5h+7d+per-model table alone |
| 2. `usage_EXPERIMENTAL_...()` query (typed, ISO resets, all windows, model_scoped, extra_usage) | Best single read for a stats grid; `rate_limits_available` flag signals API-key sessions; option to skip transcript scan | One control request on an open Query | Name says may change; sdk version pin needed; null for API key/Bedrock/Vertex; pulls from claude.ai usage endpoint (cached data possible per `model_scoped` note) |
| 3. Statusline JSON from the CLI (documented) | Only useful for a `claude` CLI lane if Ptah can inject a statusLine command; documented | Per-lane config injection | Subscribers only, after first response, windows drop at reset |
| 4. Parse CLI text "5-hour limit reached ∙ resets 2am" | Fallback for a lane that died at the limit | Regex | Clock-time only, local tz, no date, wording changes |
| 5. Raw `anthropic-ratelimit-unified-*` headers / OAuth usage endpoint | Not examined first-hand; third-party only | n/a | Undocumented |

Same account for lane and main: a claude lane can be covered by the main account read (options 1-2); the lane process itself need not be asked.

### Codex

| Option | Fit | Cost | Failure mode |
| --- | --- | --- | --- |
| 1. App-server `account/rateLimits/read` (existing) | Done; generated protocol types pin v0.147.0; has `rateLimitReachedType`, per-limit-id buckets (`rateLimitsByLimitId`) | None; cache + stale handling exist | Version pinned (`CODEX_ACCOUNT_PROTOCOL_VERSION`), spawns a process per read, ChatGPT auth only |
| 2. Rollout JSONL `token_count.rate_limits` (per-lane, passive) | Gives a snapshot as of last turn for a lane's own session, no extra process | Tail files under CODEX_HOME sessions | Field names (`window_minutes`, `resets_in_seconds`) come from third parties, not verified; snapshot can be stale; undocumented format |
| 3. Error text "try again at 5:05 PM" (existing parser) | Works for lanes today | None | Clock time only, no weekly vs 5h distinction, no date |
| 4. `@openai/codex-sdk` | No rate-limit fields in types | n/a | Not a source |

### Antigravity (agy)

| Option | Fit | Cost | Failure mode |
| --- | --- | --- | --- |
| 1. Local language server `GetUserStatus` | Only programmatic source found; per-model remaining fraction and reset | Find LS process, parse `--csrf_token` and port from args, self-signed HTTPS call on 127.0.0.1; Windows process-arg reading | Undocumented, protobuf-over-JSON service, process-arg scraping, port discovery by scanning; breaks on LS update; only works when LS is running (IDE or agy session) |
| 2. CLI `/usage` (`/quota`) interactive command | Exists per forum; not machine-readable (unexamined) | Scrape TUI | Fragile |
| 3. Error text "Your quota will reset after 144h24m50s" | Relative duration, convertible to absolute reset by adding to print time | Regex on lane output | Wording undocumented; distinguish from MODEL_CAPACITY_EXHAUSTED (not quota) |

### OpenCode (Go / Zen)

| Option | Fit | Cost | Failure mode |
| --- | --- | --- | --- |
| 1. No documented API/CLI. Web console shows usage (documented) | Cannot be read headlessly without scraping an authenticated console | n/a | Not reliable |
| 2. Lane error text ("Free usage exceeded, subscribe to Go", retry countdown) | Only trigger signal; no reset time in the text found | Regex | Free-tier message even for Go users (bug); no window attribution |
| 3. Local accounting | Ptah could estimate against the documented caps ($12/5h, $30/wk, $60/mo) from lane token costs | Needs cost per lane (TASK_2026_535) | Estimate only; per-model price drift; window anchor unknown |

### Ollama Cloud (Glm lane and direct)

| Option | Fit | Cost | Failure mode |
| --- | --- | --- | --- |
| 1. `GET https://ollama.com/api/usage` Bearer API key | Same key the Glm lane already uses; returns session + weekly percentages, per-model counts | One HTTPS call | Undocumented in official docs; resets not in payload per one source (derive: 5h buckets, weekly) while another third party shows `resets_at` from the settings page; official status disputed |
| 2. Scrape `ollama.com/settings/usage` with cookie | Documented as the place to view | Cookie handling | Expiring cookies, DOM changes |
| 3. 429 handling | 429 on quota exhaustion; honor `Retry-After` if present (secondary source); no body sample found | Header read in the lane's HTTP layer | Whether 429 carries Retry-After for quota exhaustion unverified; body unknown |

## Disagreements

- Is `ollama.com/api/usage` official? Apify actor says "official"; the Home Assistant thread says undocumented and may be closed; ai.rud.is (2026-05-27) says no official endpoint; Ollama docs (fetched) list no such endpoint. Decision here: treat as undocumented and mark data "estimated".
- Ollama reset times: HA author says not in payload and derives fixed 5h UTC buckets/Monday 00:00 UTC; ai.rud.is shows `resets_at` parsed from the web page. Unresolved; a live call with a real key settles it.
- Codex 5h/weekly: one source says primary is "typically 2 hours" (search summary), another says 5-hour; the app-server payload carries `windowDurationMins`, so classify windows by that value rather than by primary/secondary position.
- OpenCode reset semantics: docs read as percentages of monthly limit and imply rolling; a user reports usage shared across models. No source gives the anchor.

## Local consequences

- `libs/backend/agent-sdk/.../claude-sdk.types.ts:400`: the guard exists but nothing consumes it; the SDK event is a partial, change-driven signal, so the stats grid cannot rely on it alone for a full table.
- `provider-rpc.handlers.ts` / `codex-account-usage.service.ts`: only the Codex shape (`primary`/`secondary` + `windowDurationMins` + `resetsAt` unix seconds) exists; Claude uses ISO strings or unix seconds, Ollama percentages, OpenCode dollars. A common window model needs a per-window label/duration plus a "source quality" flag (authoritative / estimated / unknown) to honour the memory rule that telemetry is not quota.
- `sdk-error-summary.ts`: already handles only Codex wording and only clock-time. Claude ("resets 2am"), Antigravity ("reset after 144h24m50s", relative) and Ollama/OpenCode (no reset time) need different parsers; clock-time-only strings need a timezone/date resolution rule.
- Lane stats: no lane-process quota channel exists for any vendor except Codex JSONL; account-level reads per vendor are the practical route.
- Claude SDK query handle: the experimental usage call requires an active `Query`; if Ptah closes it between turns that read is unavailable.

## Unknowns

- Whether `rate_limit_event` arrives every turn or only near/at a limit. The installed type says "emitted when rate limit info changes" and `status` includes `allowed`, which suggests it can fire in the normal state, but no vendor source states cadence. Smallest experiment: run an SDK query on a Pro/Max account, log every `rate_limit_event` across 10 turns, and compare against `usage_EXPERIMENTAL...()` output.
- Codex `token_count.rate_limits` exact field names in 0.147.0 (only third-party). Experiment: read one rollout file in CODEX_HOME.
- Antigravity `GetUserStatus` real response schema and Windows process-arg discovery. Experiment: run it against a running agy/LS.
- Ollama `/api/usage` payload, reset fields, 429 body and headers. Experiment: one authenticated call and one forced 429.
- OpenCode: any local file/db (opencode storage) or API recording Go limit state. Not examined.
