# Code Logic Review — `TASK_2026_707` sessions merge (round 2)

Review family: grok (implementer: codex)

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVE |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| New defects | 0 |

Score band: 7–8 (sound). All five round-1 defects are fixed on the path that produces the user-visible result, and the specs that name those paths passed here (3 suites, 13 tests). This is not a 9: a null OpenCode `session_id` still drops that message (outside the five fixes), and a rejected session id is only visible in the host log.

Jest: `npx jest -c libs/backend/usage-analytics/jest.config.ts` on `usage-summary.service.spec.ts`, `sources/opencode.source.spec.ts`, and `sources/grok.source.spec.ts` — 13 passed. No source file was edited.

## Round-1 defects

| # | Status | Evidence |
| --- | --- | --- |
| 1. Missing `session.title` dropped every OpenCode row | fixed | `opencode.source.ts:35-38` reads `PRAGMA table_info(session)` and selects `NULL AS sessionTitle` when `title` is absent. Rows still parse. `opencode.source.spec.ts:18` expects one contribution and title `Session s`. `opencode.source.spec.ts:42` expects `Important task` when the column exists. |
| 2. Top-session model was the last contribution | fixed | `usage-summary.service.ts:76-89` accumulates cost and tokens per `providerId` + `modelId`, then picks priced cost, then tokens, then `modelId`. `usage-summary.service.spec.ts:30-42`: two `costly` rows at 3 beat one `cheap` row at 5; unpriced `tie-large` (10 tokens) beats `tie-small` (1 token). |
| 3. One Grok turn with several models counted as several messages | fixed | `grok.source.ts:59-63` sets `requestCount` to 1 on the first valid model and 0 after that. `usage-summary.service.ts:101` and `:105` add `requestCount ?? 1`, so 0 is not replaced by 1. `grok.source.spec.ts:39-48` expects `[1, 0]` and both token totals. |
| 4. The fact-cap row was folded into session totals | fixed | `usage-summary.service.ts:66` breaks before the session block at `:72`. `usage-summary.service.spec.ts:64-76`: 100000 facts, the next row carries `session-overflow`, `sessionCount` is 0, `messageCount` is 0, `topSessions` is empty, source reason is `fact-limit`. |
| 5. An invalid session id failed the whole summary | fixed | `usage-summary.service.ts:67-72` runs `UsageTopSessionSchema.shape.sessionId.safeParse` and skips the session block when it fails. The fact is still written at `:108-119`. `usage-summary.service.spec.ts:45-61`: a space and a 161-character id produce 20 input tokens, no top sessions, and one warning that carries `sourceId` only. |

## Removals

No live import of `SessionAnalyticsStateService`, `session-analytics-state.service`, `session-analytics-state.testing`, or `components/session-analytics/` remains under `apps/` or `libs/`. The dashboard public index no longer exports the service (`libs/frontend/dashboard/src/index.ts:20` exports `DashboardSessionEntry` only). Specs import `dashboard-rpc.testing`. `session:stats-batch` is still called from `apps/ptah-cli/src/cli/commands/session.ts:964` and `apps/ptah-tui/src/hooks/use-sessions.ts:320`.

`SESSION_DATA_PROVIDER` is still provided in `apps/ptah-extension-webview/src/app/app.config.ts:293` and declared in `libs/frontend/core/src/lib/tokens/session-data.token.ts:22`. Nothing injects it. That matches the fix report: propose, do not delete.

`tools/mcp-bench/questions/7910f34cf` still names the deleted paths. Ignored as corpus data.

Showcase: `dashboard-tour.scene.ts` calls `director.say` at 0 (`:82`), 1 (`:85`), 2 (`:89`), 3 (`:93`), 4 (`:110`), 5 (`:124`), and 6 (`:149`). No other index. `scripts/dashboard-tour.json:3-10` has seven lines, so indices 0–6 match. The Usage beat uses `section[aria-label="Usage"]` (`dashboard-tour.scene.ts:120-121`), which matches `analytics-card.component.html`. The old metrics, range, and session-card beats are gone.

## New defects

None.

Checked and not filed:

- A null OpenCode `session_id` still fails `rowSchema` (`opencode.source.ts:10`, `:42-43`) and that message is omitted from facts. The new tests only insert non-null ids. This is the round-1 row schema, not a behavior the fix round added.
- An omitted session id does not change the on-screen partial state. The warning is the host log at `usage-summary.service.ts:70`. That is what the fix specified.
- The fact-cap test does not also assert a session that was accepted before the cap. The cap check is before `sessions.set`, so an earlier valid session would remain.
- Grok's multi-model `requestCount` is asserted on the source, not through `summarize`. The summary adds that field with `??`, which keeps 0.
