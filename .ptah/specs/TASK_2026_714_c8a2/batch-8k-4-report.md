# Batch 8k-4 — native usage and model in the session-stats payload

W = `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration` (HEAD 095e4246e).
Scope held: only the listed files changed; `codex-chat-events.ts(+spec)` and rpc-handlers untouched.

## Findings (Task 1) — what feeds each header field

Header = `SessionStatsSummaryComponent`
(`W/libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts` + `.html`).
The aggregator routes the `session:stats` payload
(`W/libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts:147-172`):
`modelUsage` → `deriveLiveModelStats` → `setLiveModelStats` (the live header input),
`sessionStats` → `installSessionStats` (the snapshot input).

| Header field | Reads | Codex before this batch |
| --- | --- | --- |
| Model | `primaryModelName` (ts:214-219): `liveModelStats().model`, else `snapshot.model`, else `snapshot.modelUsageList[0].model`; chip at html:24-39 / 270-278 | NEVER EMITTED — the Codex payload had no `modelUsage` and no `sessionStats`, so the chip was hidden |
| Context | `contextPercentLabel` (ts:189) / `hasKnownContextWindow` (ts:182) ← `sessionContextCue` (`session-stats-view.ts:42-60`): needs `live.contextKnown` (numerator) AND a valid `live.contextCapacity` (source `sdk-native`/`provider-catalog`, `tokens > 0`, model match); chip at html:41-53 | EMITTED-AND-DROPPED — the server sends `tokenUsage.modelContextWindow` (`codex-protocol-methods.ts:343-350`) but the translator built `CodexReportedUsage` without it (`codex-event-translator.ts:145-150` pre-edit), and no `modelUsage` row existed, so the chip showed "—" |
| Tokens | `tokensLabel` (ts:238-241) = `snapshot.tokenCount` (the `sessionStats` entry only); chip at html:54-81. The per-turn footer `tokens` go to the message footer via `StreamingHandlerService` (aggregator:174), not the header | NEVER EMITTED — payload has no `sessionStats` (see ## Not done) |
| Cost | `totalCost` (ts:222) = `snapshot.totalCost ?? null`; `null` renders "cost unavailable" in `CostBadge`; chip at html:82-121 | NEVER EMITTED — no `sessionStats` and Codex reports no pricing; `costUSD: null` is the documented contract ("null means UNKNOWN … render it as unavailable, never as $0", `agent-adapter.types.ts:49-58`) |

Model source check (batch question): the native wire does NOT report the effective model —
the `turn` schema has no model field (`codex-protocol-schemas.ts:427-436`) and
`thread/tokenUsage/updated` carries only `modelContextWindow`. So the adapter's
`TrackedSession.settings.model` (`codex-chat-adapter.ts:143-144`, set at :365-370, kept current by
`setSessionModel` at :691) is the only source; native model data does not exist to prefer.

## Task 2 — codex-runtime carries the native context window

- `W/libs/backend/codex-runtime/src/lib/codex-runtime.types.ts:165` — added
  `modelContextWindow?: number` to `CodexReportedUsage` (doc: present only when the server
  reported a positive integer; null/absent stays absent).
- `W/libs/backend/codex-runtime/src/lib/codex-event-translator.ts:145-154` — the
  `thread/tokenUsage/updated` case includes it conditionally
  (`typeof === 'number' && > 0`). The terminal reuses the turn's stored snapshot
  (`:170-176`, `this.usage.get(key)`), so terminal usage carries the window too — no second
  construction site exists.
- Spec: `W/libs/backend/codex-runtime/src/lib/codex-event-translator.spec.ts:331-357` —
  "carries only a positive server-reported context window": positive 272_000 is carried on the
  usage event and on the terminal snapshot; `null`, absent and `0` stay absent.

## Task 3 — agent-sdk builds the per-model row

- `W/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:9` — value import
  `resolveContextCapacity` (same shared helper the Claude path uses,
  `stream-transformer.ts:821`).
- `W/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:38-43` —
  `CodexChatSession.settings?: { model?: string }` (see Decision 2).
- `W/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:134-185` — the
  result callback now also builds `modelUsage: [row]` in the SAME `deps.stats` payload:
  - `model` = `session.settings.model`; the whole row is omitted when the model is unknown.
  - `inputTokens` / `outputTokens` / `cacheReadInputTokens` reuse `tokenUsage(usage)`
    (`codex-chat-events.ts:8-18`) — the exact same disjoint-bucket split the footer uses
    (OpenAI input includes cache, so uncached input is the difference).
  - `lastTurnContextTokens` = `usage.lastRequestTotalTokens` (present only when reported).
  - `costUSD: null` — no Codex pricing; renders "unavailable" by contract.
  - `contextWindow` = `contextCapacity.tokens ?? 0` and `contextCapacity` from
    `resolveContextCapacity({ route: { kind: 'native', providerId: null }, model,
    sdkContextWindow: usage.modelContextWindow })` — `sdk-native` with the server-reported
    window, or `tokens: null, source: 'unknown'` when absent.
- `W/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts` — NO change
  needed: the session object already carries `settings` and the stream-side declaration
  covers it.

### Unknown-window value (batch question): 0

The frontend never reads the row's numeric `contextWindow` for the header: the derivation
takes the window from the row's `contextCapacity` and computes `contextPercent = 0` without it
(`session-live-stats.util.ts:77-101`; its spec pins "renders 0 contextPercent when the context
window is unknown (0)", `session-live-stats.util.spec.ts:249-262`), and the chip's known-gate is
the capacity object (`session-stats-view.ts:44-52`). So `0` renders "unknown", never a wrong
percentage, and matches Claude's own row (`stream-transformer.ts:830`:
`contextWindow: contextCapacity.tokens ?? 0`).

## Task 5 — lifecycle specs

`W/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-lifecycle.spec.ts`:
- `:7` — added `type CodexReportedUsage` import.
- `:237-281` — "feeds native usage and model into the session-stats payload": usage + terminal
  sequence (mirroring the real order after a text delta) asserts one stats call with
  `sessionId`, `turnCost: null`, `tokens { input: 80, output: 30, cacheRead: 40 }` and the
  `modelUsage` row (`model: 'gpt'`, split buckets, `contextWindow: 272_000`,
  `contextCapacity` `sdk-native`, `costUSD: null`, `lastTurnContextTokens: 90`).
- `:283-326` — "reports an unknown native context window without inventing one": without
  `modelContextWindow` the row still exists but reads `contextWindow: 0` and
  `contextCapacity { tokens: null, source: 'unknown' }`.

Existing stats assertions use `expect.objectContaining`, so the added `modelUsage` key cannot
break them (`codex-chat-adapter.spec.ts:648-653`; the no-usage flows still never call stats).

## Decisions

1. **The row includes `contextCapacity`, beyond the batch's field list.**
   Options: (a) row with only the listed fields; (b) add `contextCapacity` built from the
   native window via the shared `resolveContextCapacity`.
   Evidence: the header Context percentage requires the structured capacity —
   `sessionContextCue` needs `live.contextCapacity` (`session-stats-view.ts:42-52`) and
   `deriveLiveModelStats` takes capacity only from the row's `contextCapacity` field, never
   from the row's numeric `contextWindow` (`session-live-stats.util.ts:77`). Option (a) would
   leave the Context chip at "—" forever and give Task 2's window no consumer. Claude's row
   carries both fields (`stream-transformer.ts:826-839`).
   Chose (b): native window only (`sdk-native` when the server reports a positive integer,
   `unknown` otherwise), no catalog fallback (providerId null), same helper as Claude.
   Reversible: delete the property.

2. **Model passed on the session object, not via deps.**
   Options: (a) new `deps.model` field; (b) declare the adapter's existing
   `TrackedSession.settings` on `CodexChatSession`.
   Evidence: the runtime session object already carries `settings.model`
   (`codex-chat-adapter.ts:365-370`) and `setSessionModel` mutates it in place (:691), so the
   stream reading it per result always sees the current model with zero adapter changes and no
   duplicated state.
   Chose (b). Reversible: move the read to a deps field.

3. **`contextWindow: 0` when unknown** — evidence cited above (Claude parity
   `stream-transformer.ts:830`; frontend ignores the numeric field and renders an explicit
   unknown, `session-live-stats.util.ts:77-101`). Never invents a window.

## Not done

1. **`sessionStats` (session-lifetime snapshot) not wired** — the stats owner cannot accept a
   Codex run with existing APIs:
   - `SessionStatsOwnerService.replaceRun` (`session-stats-owner.service.ts:555`) consumes
     `RunUsageResult` = "the cumulative per-model usage of the query run so far" (:170-174)
     with monotonic validation — a missing model or a decreased counter is rejected
     (`stream-transformer.ts:947-949`).
   - Codex emits per-turn deltas (the translator subtracts the turn baseline,
     `codex-event-translator.ts:139-148`); fed as cumulative, every turn after the first would
     be rejected.
   - An owner must also be prepared per session+generation via `prepareRun` (:450, Claude
     transcript loaders) with a per-run token, and cost needs a `costSource` — both
     Claude-run concepts.
   What it would take (new contracts, deliberately not attempted per the batch): emit
   thread-cumulative totals from codex-runtime, add owner preparation/generation lifecycle to
   the Codex adapter, and define the pricing-less cost source — or a delta-based owner API.
   Until then the header **Tokens** and **Cost** stay "—"/"unavailable" for native Codex
   sessions (they read `snapshot.tokenCount` / `snapshot.totalCost`,
   `session-stats-summary.component.ts:222,238-241`). Context and Model are fixed by this
   batch.
2. **Cost stays null by contract** (`agent-adapter.types.ts:49-58`): `costUSD: null` in the
   row and no session total — "unavailable", never $0.
3. **No verification run** — per batch rules the coordinator verifies (`npm run verify`).