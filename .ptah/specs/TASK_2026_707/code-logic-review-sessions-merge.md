# Code Logic Review — `TASK_2026_707` sessions merge

Review family: grok (implementer: codex)

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Assessment | REVISE |
| Blocking issues | 0 |
| Serious issues | 2 |
| Moderate issues | 3 |
| Failure modes found | 5 |

Score band: 5–6 (real gaps). The priced/unpriced ordering, dedup-before-count, UTC range, and KPI wiring match the summary pass and the new service spec. That keeps this out of the 3–4 band. Two defects change what a user is told on ordinary data (the model named on a multi-model session, and an OpenCode read that now returns no rows), so this is not a 7–8.

Ptah symbol tools were not available in this session (`search_tool` listed only the tasks server). Text search used ripgrep. No source file was edited.

## Five logic questions

### 1. How does this fail silently?

An OpenCode database whose `session` table has no `title` column makes `OpenCodeSource.read` throw inside the new query. The `catch` returns an empty contribution list and `status: 'unavailable'` with a WAL/driver reason (`opencode.source.ts:35`, `opencode.source.ts:57-58`). Cost and tokens from that source disappear while the rest of the summary still returns. The existing fixture has that shape and the spec now gets `[]` (`opencode.source.spec.ts:23`, `opencode.source.spec.ts:35`).

A session id that fails `UsageTopSessionSchema` (`rpc-analytics.types.ts:4`, `rpc-analytics.types.ts:33`) throws at `UsageSummarySchema.parse` after every source has been folded (`usage-summary.service.ts:129`). The RPC catch turns that into `Usage summary is unavailable.` for the whole dashboard (`analytics-rpc.handlers.ts:94-101`).

### 2. What user action produces unexpected behaviour?

Opening Usage after a Claude, Codex, or Grok session that used more than one model. The row's Model cell is whatever contribution was folded last, not the model that accounts for the cost (`usage-summary.service.ts:71-72`, `usage-top-sessions.component.ts:24`).

The Electron showcase looks for `section[aria-label="Session analytics"]` (`dashboard-tour.scene.ts:129-131`). The card label is now `Usage` (`analytics-card.component.html:1`), so the `isVisible` guard skips beats 5–8. The inner `ptah-session-metrics-cards` and `ptah-session-stats-card` lookups (`dashboard-tour.scene.ts:142`, `dashboard-tour.scene.ts:170`) are also stale. They do not throw. They also do not show the new table.

### 3. What input data produces a wrong answer?

- Two or more `modelId` values on one `sourceId:sessionId` (`usage-summary.service.ts:68-72`).
- One Grok `turn_completed` whose `modelUsage` has two models: each push sets `requestCount: 1` (`grok.source.ts:59-61`), and both the session row and the Messages KPI add that count (`usage-summary.service.ts:76`, `usage-summary.service.ts:80`).
- A summary that omits the new optional counts parses, then the view model renders them as `0` (`rpc-analytics.types.ts:51-53`, `usage-summary.view-model.ts:219-221`).

### 4. What happens when a dependency fails?

Per-source exceptions stay inside the existing source `try` and mark that source unavailable (`usage-summary.service.ts:105-112`). The new session map is not rolled back for rows already accepted, which matches fact handling. The OpenCode `catch` is the bad case: a missing column is reported as a driver/WAL failure and the contributions are dropped (`opencode.source.ts:57-58`). A Zod failure on the finished summary is not per-source; it fails the RPC (`analytics-rpc.handlers.ts:94-101`). Abort and fact-limit still stop later sources (`usage-summary.service.ts:46-49`, `usage-summary.service.ts:101-103`).

### 5. What is missing that the requirements never mentioned?

The Model column has no rule for a session with several models. Message identity is "one contribution", so a multi-model Grok turn counts as several messages. Antigravity and Ollama still have no session id; their spend stays in the cost tiles and out of the session KPIs. The strip tooltip states that scope (`usage-kpi-strip.component.ts:78`). No rule was given for a showcase selector that keys off the removed heading.

## Failure modes

### OpenCode title column empties the source

- Trigger: `SELECT` of `s.title` against a `session` table that has only `id` and `directory`.
- Symptom: OpenCode usage is absent. Source status is `unavailable` and the reason blames SQLite or WAL metadata.
- Evidence: `opencode.source.ts:35`, `opencode.source.ts:57-58`. Jest `opencode.source.spec.ts` failed: expected 1 contribution, received `[]`.
- Current handling: catch returns `{ contributions: [], status: unavailable }`.
- Recommendation: read tokens even when title is absent. Add `title` to the fixture if production databases have it, and treat a missing column as `sessionTitle: null`, not as a failed source.

### Top-session model is the last write

- Trigger: two in-range contributions for the same session with different `modelId`s. Claude ledger order is filename order then record order (`session-stats-reader.service.ts:138-140`, `session-stats-reader.service.ts:168-183`).
- Symptom: the cost table names a model that may be a cheap trailing call.
- Evidence: `usage-summary.service.ts:71-72`.
- Current handling: every contribution replaces `modelId` and `providerId`.
- Recommendation: keep the model with the greater priced cost, then the greater token count.

### Grok message KPI counts models

- Trigger: one `turn_completed` with two `modelUsage` entries.
- Symptom: Messages is higher than the number of turns. The same prompt id is one user action.
- Evidence: `grok.source.ts:59-61`, `usage-summary.service.ts:80`.
- Current handling: `requestCount: 1` on every model row, summed after dedup. Dedup does not collapse models, because `modelId` is part of the fact key (`grok.source.ts:61`).
- Recommendation: add one message per prompt (or per turn), and keep per-model rows only for tokens and cost.

### Fact-limit row is counted in sessions and not in facts

- Trigger: a contribution would create fact group 100001.
- Symptom: session tokens, message count, and possibly top-5 cost include a row the breakdown does not.
- Evidence: session update at `usage-summary.service.ts:61-80`, then `break` before `groups.set` at `usage-summary.service.ts:97-98`.
- Current handling: `overflow` marks the source partial and skips later sources. The session map already holds the rejected row.
- Recommendation: test the cap before mutating `sessions`, `subagents`, or `messageCount`.

### One bad session id fails every provider

- Trigger: `sessionId` longer than 160 characters or outside `/^[\w.\-:/]+$/` (`rpc-analytics.types.ts:4`). Codex uses the meta id or the rollout filename (`codex.source.ts:64`). Grok uses the session directory name (`grok.source.ts:61`). OpenCode uses `session_id` (`opencode.source.ts:51`).
- Symptom: Usage shows `Usage summary is unavailable.` Claude and the other sources are discarded with it.
- Evidence: `usage-summary.service.ts:69-72`, `usage-summary.service.ts:129`, `analytics-rpc.handlers.ts:94-101`.
- Current handling: parse is outside the per-source try. The RPC catch does not say which field failed.
- Recommendation: drop or shorten a session id that fails the id schema and still return the facts. Do not fail the summary on a session label.

## Defects

### 1. OpenCode read drops every row when `session.title` is missing

- Severity: high
- File: `libs/backend/usage-analytics/src/lib/sources/opencode.source.ts:35`
- Problem: The query now selects `s.title`. The source spec creates `session (id, directory)` with no `title` column (`opencode.source.spec.ts:23`). SQLite throws, and the catch at `opencode.source.ts:57-58` returns no contributions. `npx jest -c libs/backend/usage-analytics/jest.config.ts libs/backend/usage-analytics/src/lib/sources/opencode.source.spec.ts --coverage=false --maxWorkers=2` failed on `opencode.source.spec.ts:35` (expected length 1, received `[]`). Any database with that shape loses OpenCode cost and tokens, and the status text points at the native driver.
- Fix: Select title only when the column exists, otherwise bind `NULL AS sessionTitle`. Keep the message row. Update `opencode.source.spec.ts` so the fixture matches the query that production is supposed to run, and assert `sessionId` and the title fallback.

### 2. Top-session model is the last contribution, not the costly one

- Severity: high
- File: `libs/backend/usage-analytics/src/lib/usage-summary.service.ts:71`
- Problem: `modelId: contribution.modelId` replaces the previous model on every row of the session. A session that spent on one model and then called another shows the later model in `usage-top-sessions.component.ts:24`. Cost and tokens on that row can still be right, so the label contradicts the sort.
- Fix: Store the incumbent cost and tokens for the displayed model. Replace `modelId` only when the new row's non-null cost is greater, or when both costs are null and the new row has more tokens.

### 3. One Grok turn with several models counts as several messages

- Severity: medium
- File: `libs/backend/usage-analytics/src/lib/sources/grok.source.ts:61`
- Problem: The model loop pushes `requestCount: 1` for each `modelUsage` entry. `usage-summary.service.ts:80` adds that into `messageCount` after dedup. Two models on one `prompt_id` become two messages in the KPI at `usage-kpi-strip.component.ts:80`.
- Fix: Count a message once per `prompt_id` (fallback `timestampMs:index`) inside the session fold, while still summing each model's tokens and cost.

### 4. The contribution that trips the fact cap is already in the session totals

- Severity: medium
- File: `libs/backend/usage-analytics/src/lib/usage-summary.service.ts:80`
- Problem: Session identity, tokens, message count, and subagent membership are updated at `usage-summary.service.ts:61-80`. The new-group cap is checked later at `usage-summary.service.ts:97` and `break`s before `groups.set`. That one contribution is in `topSessions` / `messageCount` and not in `facts`.
- Fix: If `!previous && groups.size >= MAX_FACTS`, set `overflow` and `break` before the session block.

### 5. A session id the schema rejects takes down the whole usage response

- Severity: medium
- File: `libs/backend/usage-analytics/src/lib/usage-summary.service.ts:129`
- Problem: `sessionId` is copied from ledger keys, rollout meta or filenames, Grok directory names, and OpenCode `session_id` with no check against `id` (`rpc-analytics.types.ts:4`, max 160, charset `[\w.\-:/]`). `UsageSummarySchema.parse` is outside the source `try`. `analytics-rpc.handlers.ts:99-101` then returns `Usage summary is unavailable.` for every provider. Title is sliced to 500 (`usage-summary.service.ts:70`). Session id is not.
- Fix: If `sessionId` fails the id schema, omit session fields for that contribution and still fold the fact. Log the source id only.

## Checked, not filed

- Claude session id `r.key.slice(0, 36)` matches a v4 UUID. Scan files must match `UUID_REGEX` (`branded.types.ts:41-42`, `session-stats-reader.service.ts:138-139`). The key is `` `${sessionId}:${messageId}` `` or `` `${sessionId}:${ledgerName}:${i}` `` (`session-stats-reader.service.ts:180`). Slice length 36 is the id. Subagent files are `agent-*.jsonl`; `subagentId` is the basename and is only a set key (`session-stats-reader.service.ts:181`, `usage-summary.service.ts:65-67`).
- Dedup runs before session mutation (`usage-summary.service.ts:57-59`). The new service spec's duplicate `key: 'a'` does not double-count. Fully unpriced rows keep `costUsd: null` and sort after any non-null cost (`usage-summary.service.ts:73-74`, `usage-summary.service.ts:120-124`). Ties fall through to tokens, then `sessionId`. Mixed priced-plus-unpriced rows keep a partial sum, set `unpriced`, and the table renders `≥` (`usage-top-sessions.component.ts:42-44`). That matches "priced first, fully unpriced after".
- Range bounds stay `since = today - (range - 1) days`, `until = tomorrow` UTC (`usage-summary.service.ts:34-36`). Invalid contributions never enter the session map (`usage-summary.service.ts:56`).
- New response fields are optional, so an old payload still parses (`rpc-analytics.types.ts:51-53`). This host always sets them (`usage-summary.service.ts:120-125`). Rendering a missing count as `0` (`usage-summary.view-model.ts:219-221`) is safe for this co-shipped host and wrong for an older payload. Not filed separately: the service under review always sends integers, including zero.
- Loading and error states still gate the table: the top-5 block is inside `viewModel()` and `vm.hasUsage` (`usage-dashboard.component.html:45-66`, `usage-dashboard.component.html:90-164`). It is not mounted on the empty array during the first load. There is no `[innerHTML]` in the new table. Titles go through text interpolation and `[attr.title]` (`usage-top-sessions.component.ts:23-24`). Empty session titles fall back in the service (`usage-summary.service.ts:70`).
- Deleted `MetricsCardsComponent`, `SessionStatsCardComponent`, and `SessionDetailModalComponent` have no remaining import under `apps/` or `libs/`. `SessionAnalyticsStateService` stays exported (`libs/frontend/dashboard/src/index.ts:20-24`). `tools/mcp-bench` JSON still names the deleted paths as corpus strings, not as runtime imports. The showcase references are the live leftover and are filed above.

## Data flow

1. Sources attach `sessionId` / `sessionTitle` / `subagentId` — OK for Claude UUIDs; OpenCode query fails closed when `title` is absent.
2. `validContribution` then dedup `sourceId:key` — OK, same gate as facts.
3. Price, then session fold — model id last-write; message count follows `requestCount ?? 1`; Grok counts each model.
4. Fact group cap — session map already updated.
5. Sort null cost last, then cost desc, tokens desc, `sessionId` — OK for fully unpriced vs priced.
6. `UsageSummarySchema.parse` — one bad session id rejects the response.
7. View model `?? 0` / `?? []`, then KPI strip and top-5 table — OK when the service populated the fields. Table hidden until `hasUsage`.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Session, message, and subagent counts on the Usage strip for 7/30/90 | PARTIAL | Counts follow the summary pass. Grok multi-model turns inflate messages. OpenCode contributes nothing when `title` is missing. |
| Top 5 by priced cost, unpriced after, then tokens, same pass | PARTIAL | Sort and dedup match. The model label does not. The fact-cap boundary diverges. |
| Remove cards, modal, and Sessions toggle | COMPLETE | Card template is the usage dashboard only (`analytics-card.component.html:1-4`). |
| Keep `session:stats-batch` and `SessionAnalyticsStateService` | COMPLETE | Still exported. No new host wiring. |
| Zod bounds and response compatibility | PARTIAL | Title, counts, and the five-row cap are bounded. `sessionId` is not sanitized before the strict parse. Optional fields accept old payloads; a bad new id fails the new payload. |

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Duplicate contribution key | YES | `seen` set before the session block | Covered by the new service spec |
| Fully unpriced session | YES | `costUsd` stays null; sort key is null vs number | Spec expects `session-c` last |
| Mixed priced and unpriced | YES | Partial sum plus `unpriced`; UI prefix `≥` | Ranked with priced sessions by the known sum |
| Empty session title | YES | Trim, then `Session` plus first 8 of the id, then slice 500 | OpenCode `??` does not treat `''`; the service trim does |
| No session-linked rows | YES | Empty table copy | Hidden entirely when `hasUsage` is false |
| Equal cost | YES | Token desc, then `sessionId` `localeCompare` | Untested, code is deterministic |
| Showcase selectors | NO | `isVisible` skips | Filed as defect context under question 2; the guards prevent a failed scene |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Fully unpriced means `costUsd === null`, not `unpriced === true` | Demote any `unpriced` row, or rank by known cost and mark the rest `≥` | `usage-summary.service.ts:120-122`, `usage-top-sessions.component.ts:42-44`. The brief says priced desc, unpriced after. A partial sum is still a price. | Yes |
| Claude `slice(0, 36)` is the session id | Parse on the first colon, or keep the fixed slice | `UUID_REGEX` is 36 characters and the key prefix is that id (`session-stats-reader.service.ts:180`, `branded.types.ts:41-42`) | Yes |
| Showcase guards are not a crash, and they are still a missed beat | Ignore because the implementer left showcase copy out of scope, or record the dead selectors | `dashboard-tour.scene.ts:129-142` never matches `analytics-card.component.html:1` | Yes |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: OpenCode usage vanishes on the schema this repo already tests, and the user is told the SQLite driver failed.
- What a robust implementation would add: title-optional OpenCode read with the spec updated; dominant-model selection; one message per Grok prompt; fact-cap check before session mutation; session ids that cannot fail the whole summary.
