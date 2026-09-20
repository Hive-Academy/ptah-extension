# Context

## How this started

The user reported that pricing was "suddenly broken": the chat header showed
`TOKENS 0`, `COST $0.0000` and `TIME 63ms` for a session that was billing
normally.

Three CLI lanes investigated in parallel on 2026-09-18: `codex` read the current
Electron logs, `antigravity` traced the code path, and `ollama cloud` compared
old logs against new ones. Their reports are in `tmp/pricing-diag/`.

## What was ruled out

The pricing math is correct. Two facts rule out the obvious suspects.

1. The pricing map loaded normally on the failing boot: 445 models, 440 with
   prices, fetched from OpenRouter
   (`Ptah Electron-2026-09-18.log:310`, `:358-359`, `:478-479`).
2. No `[Pricing] … not found in pricing map` line exists in the 09-17 or 09-18
   log. No model id failed lookup.

One lane (`ollama cloud`) concluded that the absence of the
`[StreamTransformer] Invalid cost value from SDK` warning meant the cost stream
had gone silent. That reading is inverted. The warning marks a **rejection**.
Its absence on 09-18 means nothing was rejected that day, because the highest
live session cost was $12.08.

## Defect 1 — validation ceilings (FIXED)

`libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts`, `validateStats`.

`validateStats` returned `null` when a value passed a fixed ceiling, and the
caller then discarded the whole stats payload. The bounds were wrong because the
SDK result message reports **cumulative per-session** figures.

Measured: 92 rejections in `Ptah Electron-2026-09-15.log`, all one session
(`1018d610`), every one a correct value:

    line 583: {"cost":101.12016359999998,"sessionId":"1018d610-…"}
    line 836: {"cost":105.72038814999996,"sessionId":"1018d610-…"}

56 more in the 09-12 log, up to about $356.

`git log -L` shows the `> 100` bound arrived with the file's first draft
(`2b537f44c`) and carried no explanation. The only later edit (`912261b6e`)
added a null guard around the same condition.

Fixed on branch `fix/stats-validation-ceilings`, worktree
`.claude-worktrees/fix-stats-validation-ceilings-099254c3ce53`. All four
ceilings deleted (cost, input tokens, output tokens, duration). Every `< 0`,
`isNaN` and `!isFinite` check kept. 2000 tests pass, typecheck clean, lint 0
errors. Not committed.

## Defect 2 — a null price becomes $0.0000

`calculateMessageCost` returns `null` on purpose when a model has no published
price, so the UI can say "cost unavailable". Three sites destroy that signal.

- `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts:255`
  — `calculateMessageCost(…) ?? 0`
- the same coercion at `session-replay.service.ts:582` (subagent replay)
- `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:542` —
  `(m.costUSD ?? 0)` in the multi-model sum, so one unpriced model in a turn
  silently contributes zero

Propagation to the screen:

1. `history-message-builder.service.ts:182` reads `completeEvent.cost` as `0`
   and sets `cost: 0` at `:214`.
2. `message-bubble.component.html:173` tests `cost !== undefined`. `0` passes.
3. `cost-badge.component.ts:64-69` — `typeof 0 === 'number'` is true, so
   `knownCost` becomes `{ value: 0 }`.
4. `formatCost(0)` prints `$0.0000`. The "cost unavailable" `@else` branch at
   `cost-badge.component.ts:37-45` can never run on this path.

A related asymmetry: `assistant-message.transformer.ts:378` coerces the same
null to `undefined`, which makes the badge disappear entirely rather than say
"unavailable". Both ends of the same signal are lost, in opposite directions.

Risk this raises: `DEFAULT_MODEL_PRICING` now holds only five legacy OpenAI
models, so every Claude price comes from the runtime fetch. That fetch failed on
09-17 (`Ptah Electron-2026-09-17.log:7089`, `OpenRouter pricing pre-fetch
failed: 200`). On such a boot every Claude cost is `null`, and defect 2 turns
the whole transcript into `$0.0000`.

## Defect 3 — an empty stats payload overwrites a good one

`Ptah Electron-2026-09-18.log:2732`:

    Session stats received: 722bd666-…:
      {"cost":0,"tokens":{"input":0,"output":0,"cacheRead":0,"cacheCreation":0},"duration":63}

The payload carries no `modelUsage` key. It arrives 6.4 s after
`chat:continue resume` for a session that was not active (`:2710`). The header
binds to the newest payload, so zero replaces the real value. The same session
reported $1.11 ninety-five seconds later (`:2823`). The `duration: 63` matches
the `TIME 63ms` in the user's screenshot exactly.

A second shape of the same problem at `:67`: a payload carries `cost: 1.77`
while `tokens` is all zeros, and the real counts sit only inside `modelUsage`.
The token field and the cost field are filled from different sources.

## CLI Lanes

Mode: enabled. The user asked for CLI lanes explicitly.

`ptah_agent_list` rows at the time of assignment:

    codex         | cli      | installed             | messaging: queue
    copilot       | cli      | disabled (installed)  | messaging: queue
    cursor        | cli      | not installed         | messaging: interrupt
    antigravity   | cli      | installed             | messaging: none
    opencode      | cli      | not installed         | messaging: none
    pi            | cli      | not installed         | messaging: steer
    ollama cloud  | ptah-cli | available             | provider: Ollama Cloud
    claude cli    | ptah-cli | available             | provider: Claude (Subscription)

| Phase                  | Lane           | Model        | Deliverable                 |
| ---------------------- | -------------- | ------------ | --------------------------- |
| Batch A — defect 2     | codex          | lane default | code + `batch-a-report.md`  |
| Batch B — defect 3     | codex, resumed | lane default | code + `batch-b-report.md`  |
| Review                 | antigravity    | lane default | `code-logic-review.md`      |
| Codex pricing audit    | ollama cloud   | opus         | `codex-pricing-findings.md` |
| Batch C — review fixes | codex, resumed | lane default | code + `batch-c-report.md`  |

Review independence holds by family: antigravity did not write the code.

All work lands on branch `fix/stats-validation-ceilings` in worktree
`.claude-worktrees/fix-stats-validation-ceilings-099254c3ce53`, stacked on the
defect 1 fix. The user chose this over a branch per defect, because defect 1 and
defect 2 both touch `stream-transformer.ts`.

## Review outcome — CHANGES REQUESTED

The `antigravity` review found one critical defect in the Batch B fix and two
major ones in files Batch A touched. Batch C corrects all three.

1. **Critical.** Batch B derived `tokens` by summing `modelUsage` when the
   aggregate usage was empty. `sdkMessage.usage` is a PER-TURN figure while
   `modelUsage` is CUMULATIVE per session, and the consumer accumulates
   (`session-stats-aggregator.service.ts:144-152`). Each payload of that shape
   re-added the whole session history, compounding across turns. Proof at
   `Ptah Electron-2026-09-18.log:195` — aggregate `input 42, cacheRead
2761872` against modelUsage `inputTokens 72, cacheReadInputTokens 4080929`.
   Fix: the fallback is deleted; the emission guard stays.
2. **Major.** `compact-session-activity.component.ts:254,267` tested
   `@if (entry.cost)`, so a genuine zero-cost turn hid the badge.
3. **Major.** `session-stats-aggregator.service.ts:137-143` dropped an
   unpriced turn from the running total and erased a null total when a later
   turn was priced.

A related token-ordering check cleared: `modelUsage.inputTokens` does NOT
include cache reads (`log:120` reads `input 30` beside `cacheRead 1319057` in
both fields), so no double count existed on that axis.

## Codex pricing

Audited read-only by the `ollama cloud` lane at opus tier;
`codex-pricing-findings.md` carries the full trace. The arithmetic is correct.
Reasoning tokens are counted once, inside `output_tokens`, and the translation
layer never adds them again. Cached input is subtracted from input before
billing. `subscriptionCovered` changes a label only — it appends
"· covered by subscription" and touches no number. A Codex subscription user
sees a real price for `gpt-5.4` and "cost unavailable" for the codex-only ids,
never `$0.0000`.

One hazard found, deferred to **TASK_2026_475_e4b7**: `lookupPricingEntry`
matches by bidirectional substring, so `gpt-5.3-codex` can be billed at
`gpt-5`'s rates with no warning. It is not in this task's branch because it
changes cost math for every provider and two tests pin the current behaviour
deliberately.

## Reference reports

- `tmp/pricing-diag/log-evidence-codex.md`
- `tmp/pricing-diag/code-path-antigravity.md`
- `tmp/pricing-diag/regression-window-ollama.md` (read its conclusion with the
  correction noted above)
