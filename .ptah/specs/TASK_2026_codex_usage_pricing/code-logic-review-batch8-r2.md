# Code Logic Review - Batch 8, round 2

Scope: round-1 findings re-checked; protocol names and units verified against the pinned schema and zod validators. No checks were run.

| Metric | Value |
| --- | --- |
| Score | 8/10 |
| Verdict | APPROVE |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 3 |

## Round-1 findings

| Finding | Status | Evidence |
| --- | --- | --- |
| B1 structured cause unreachable | FIXED | `codex-event-translator.ts` `turn/completed` attaches `limitReached` to the terminal error when `turn.error.codexErrorInfo === 'usageLimitExceeded'`. `turnError` keeps `codexErrorInfo` (`codex-protocol-schemas.ts:433-438`, `string | object`), so the field survives parsing. `CodexRuntimeError.limitReached` added (`codex-runtime.types.ts` ~l.234); `codex-chat-events.ts` `reachedCause()` reads it from `event.error`; no intermediate layer strips it. The `error` event type does not consume the one-shot `errorEmitted` (chat-events l.314-316), so the specific message is still emitted at the terminal. |
| Reset unit (s vs ms) | FIXED | Translator multiplies the window `resetsAt` (epoch seconds, `rateWindow` in codex-protocol-schemas.ts:660) by 1000 once; the bound `max(8.64e12)` s keeps the ms value under chat-events' `max(8.64e15)`, so `toISOString()` cannot throw. Spec asserts year 2030. |
| Unescaped table cells | FIXED | `agent-limit.formatter.ts` `table()` escapes `& < > \ | backtick` and folds CR/LF for headers and cells; the only table call site is the plan-limits table (l.445). |
| Unclamped remainingPercent | FIXED | clamp 0..100 in the formatter and in `plan-limit-tiles.ts` allowanceTiles. |

## Protocol check
- Native names/values match: `CodexErrorInfo` enum contains the string `usageLimitExceeded` (`protocol/codex-app-server-protocol.schema.json:8572-8590`); `rateLimitReachedType` enum in `codex-protocol-methods.ts:287-294` is accepted by chat-events' regex `^[a-z][a-z0-9_]*$`, and so is the `usage_limit_exceeded` fallback; `primary/secondary.usedPercent/resetsAt` come from the validated `rateWindow`. Units: `resetsAt` is seconds in, milliseconds out. `individual.resetsAt` in the shared types is already ms (untouched).
- Best effort only: the reset comes from the latest `account/rateLimits/updated` seen by this translator instance, not from the failed turn, so it can be absent or from the other bucket. Absence yields the generic "Usage limit reached" text with no invented date.

## Static type review
No obvious errors: zod is a dependency of agent-sdk (other files already import it); `RateLimits` is inferred from `codexNotificationSchemas[...]`; `PlanLimitAllowance` is re-exported via `libs/shared/src/index.ts:28`; tile model fields (`kind: 'status'`, `tone`, `resetLine`, `detailLines`, `sourceChips`) match `PlanLimitTileModel`; `...(limitReached && { limitReached })` is legal. `limit.snapshot.allowances/credits` resolve if `AgentLimit['snapshot']` is `PlanLimitOwnerSnapshot` (not opened).

## Moderate
- M1: `limitCause` uses `find`, which picks the first exhausted window; if primary and secondary are both exhausted the later reset is the effective one. Prefer the max `resetsAt`.
- M2: `this.rateLimits` is never cleared; an exhausted window from an earlier snapshot can supply a reset already in the past. Omit `resetsAt` when it is not in the future.
- M3: The new escape also rewrites `&` and `\` in existing cells (output change for labels containing them; low risk). The ledger is still not updated from the error cause (out of scope). The combined translator-to-events spec remains unmet because the translator is not exported; acceptable.

## Verdict
APPROVE. The cause is now wired from the real protocol field to the user-facing message and units are consistent.

## Final file list (batch 8)
- libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-events.ts (+ .spec.ts)
- libs/backend/codex-runtime/src/lib/codex-runtime.types.ts
- libs/backend/codex-runtime/src/lib/codex-event-translator.ts (+ .spec.ts)
- libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-limit.formatter.ts (+ .spec.ts)
- libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tiles.ts
- libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.spec.ts
- libs/frontend/core/src/lib/services/plan-limits.store.spec.ts
- Overlap with batch 7: none at file level; same Nx project `codex-runtime` (codex-runtime.ts in batch 7, types and translator in batch 8). `task-tracking/landing-live-demo/HANDOFF.md` is foreign and should stay out of the commit.
