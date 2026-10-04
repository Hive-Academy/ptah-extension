# Code Logic Review - PR 3 phase end (N7/N8 session budget + handoff), TASK_2026_597

Scope: `git diff ecc953410..HEAD -- ':!.ptah'`, Batches 50-61. Read in full: `session-budget.service.ts`, `session-budget-stage.ts`, `session-handoff-writer.ts`, the readTail part of `session-handoff-builder.ts`, `weighted-tokens.ts`, the `session-control.service.ts`, `sdk-agent-adapter.ts`, `chat-session.service.ts`, rpc handler and schema diffs, the frontend diffs (tab-manager, message-sender, message-dispatch, session-loader, aggregator, chip, chat-view). Not re-flagged: accepted deviations in the 50-61 reports (F7 overshoot, config-change re-initialize not clearing state, `window.target = 0` when advisory, nothing carried on the refusal as such).

## Summary

| Metric              | Value            |
| ------------------- | ---------------- |
| Overall score       | 5/10             |
| Assessment          | CHANGES REQUIRED |
| Blocking issues     | 0                |
| Serious issues      | 4                |
| Moderate issues     | 8                |
| Failure modes found | 12               |

Numerator parity (focus 1) holds: `measureSessionBudget` uses `tokenCount`, `totalCost`, `knownCost` and weighted tokens only when `pricingCoverage` is not partial and `totalCost` is null (`session-budget-stage.ts:81-127`). The same snapshot object feeds the chip and the budget on live (`sdk-agent-adapter.ts:1633-1645`) and resume (`chat-session.service.ts:1045`) paths. The defects are in state lifetime and in the gate's reliance on stored state.

## Five logic questions

### 1. How does this fail silently?

- Stop (`chat:abort` -> `interruptSession`) deletes the session's budget entry and its stats owner (`sdk-agent-adapter.ts:1437-1443`, `chat-session.service.ts:1196`). The next `chat:continue` sees no entry and no snapshot and is allowed (`session-budget.service.ts:200-215`, fail-open). See F-1.
- A refusal made by `checkSnapshot` (no stored figure) is not mirrored in the tab: the tab holds a disabled/`unknown` state, the banner renders nothing for `unknown` (`session-budget-banner.component.ts:174-182`), and the frontend suppresses the generic failure notice for `SESSION_BUDGET_REACHED` (`message-dispatch.service.ts:201-208`). The send just does nothing. See F-3.
- A handoff built with no transcript (workspace unknown, ENOENT, unreadable dir) is stored and reported as a normal handoff (`session-budget.service.ts:519-534, 540-547`). `readError` is only WARNed once per session and never reaches `SessionBudgetHandoff`. "Continue in new session" then seeds an empty-bodied handoff with `success: true`.
- A read-back miss sends `autoCompactWindow: null` and silently drops the user's configured `compaction.threshold` for that session (F-4).

### 2. What user action produces unexpected behaviour?

- Stop after "Allow 20% more": the extension is forgotten. Next result recomputes with `extensions = 0` and blocks again although used < 120% (F-1).
- At the limit, raise `sessionBudget.tokens`/`usd`, switch `blockAtLimit` off, or disable the budget in settings: the send stays refused (F-2). Only the banner's "Allow 20% more" or a new session works.
- Enable the budget (or change unit) while a session is already over the limit: refused, no banner, "Allow 20% more" returns "No budget state for this session" (F-3).
- `/compact` at the limit passes the gate but cannot relieve it: the measure is cumulative (stage only rises, `session-budget-stage.ts:167-176`), so the user stays blocked afterwards. This is by design (F3) but the exemption gives no way out.

### 3. What input data produces a wrong answer?

- `tokenCount` absent: the budget keeps the previous `used` (`keepPreviousFigure`, `session-budget-stage.ts:234-256`) while the chip shows "-". Numerator parity is lost for that snapshot (Minor).
- Revision-less snapshots in the chat view: `resolvedSessionBudget` compares `acted.revision ?? -1 >= fromTab.revision ?? -1` (`chat-view.component.ts`, resolvedSessionBudget), so with both null the action-returned state wins forever (Moderate, M-6).
- Non-v4 session ids: `UUID_REGEX` is v4-only (`branded.types.ts:39`). The schema (`session-budget-rpc.schema.ts:28`) and writer reject them, but the gate does not, so such a session can be blocked and cannot extend (M-4).

### 4. What happens when a dependency fails?

- `getContextUsage` missing, throwing or timing out: `failed`, stage still advances, WARN once. OK (`session-control.service.ts` lowerSession...).
- Second read-back throws after `applyFlagSettings(target)` succeeded: record override is reverted to the previous value while the runtime keeps the lowered window (M-2).
- Handoff dir unwritable: `path: null` + `writeError`, content kept. OK (`session-handoff-writer.ts:123-135`).
- Config store unreadable: defaults used with one WARN. OK.

### 5. What is missing that the requirements never mentioned?

- Settings changes are not applied to a stored figure (no config-change re-evaluation, no re-check in `canSend`).
- The refusal carries no state, and the gate does not repair a lagging frontend (known gap, but it produces F-3).
- Session existence check in `act` for `write-handoff`/`preview-handoff` (M-5).
- No cleanup for sessions ended outside the adapter (idle eviction), no guard against resurrecting an entry after release (M-7).

## Failure modes

### F-1 Stop erases budget state and opens the gate

- Trigger: user presses Stop (`chat:abort`), or any `interruptSession` (slash-router dead-record cleanup, resume cleanup at `chat-session.service.ts:1423, 1566`).
- Symptom: at/near the limit, the next send is allowed (no entry, owner released so `statsOwner.snapshot` returns null, `session-budget.service.ts:207-208` / `checkSnapshot` returns OK). After that turn the figure is rebuilt with `extensions = 0`, `compactions = 0`, no dismissal, no window/handoff state, so a user who had extended is blocked again at 100% of the base limit, and a handoff-after-compactions trigger restarts.
- Evidence: `sdk-agent-adapter.ts:1437-1443` (`releaseStatsOwners` + `releaseBudget` on interrupt), `session-budget.service.ts:251-253`, `session-stats-owner.service.ts:588-597`.
- Current handling: release treats a turn interrupt as session end.
- Recommendation: do not release the budget on interrupt/abort (only on real session end/close), or persist `extensions`/`compactions` per session for the process lifetime (they are small) and seed `checkSnapshot` from them. At minimum do not fail open when an entry existed.

### F-2 Gate decides on a stored figure that ignores later settings

- Trigger: session blocked at limit; user changes `limit`, `blockAtLimit`, `enabled`, or `unit`.
- Symptom: still refused. No result arrives (sends are blocked) so nothing re-evaluates. `canSend` returns `entry.figure.blocked` without reading config (`session-budget.service.ts:201-206`); `reevaluate` is only called from `recordCompaction` and `extend` (lines 193, 572).
- Evidence: the provider reads settings per call without a change hook (`session-budget-config.provider.ts` header), nothing subscribes.
- Recommendation: in `canSend`, when `entry.figure` exists, compare `configKeyOf(config)` with `entry.configKey` (or re-run `evaluateSessionBudget` on `entry.snapshot` with `resetStage` on key change), and return OK when `!config.enabled`.

### F-3 Silent refusal when the tab has no actionable state; extend impossible

- Trigger: an entry with `figure === null` (set by the disabled branch, `session-budget.service.ts:290-297`), or an entry-less session with a stats snapshot, then the budget is (re)enabled over the limit. `canSend` -> `checkSnapshot` (lines 365-387) refuses with a state that is not stored on the entry.
- Symptom: composer keeps the draft, no notice (suppressed), no banner (tab state is `unknown`), and `act('extend')` answers `No budget state for this session` (`dismiss`/`extend` use `entry.figure`, lines 556, 563). The user has no control to proceed except toggling the setting back.
- Evidence: `message-sender.service.ts:726-748`, `message-dispatch.service.ts:201-208`, `chat-input.component.ts:1368-1370`.
- Recommendation: make `checkSnapshot` install the figure on the entry (and publish it, or have the refusal carry `budget: check.state`, the one-line shared change the Batch 56 report names), and/or show a one-line notice in the composer when the refusal arrives and the tab has no banner.

### F-4 Read-back miss clears the user's configured window

- Trigger: `tightenWindowTokens` set, runtime ignores window (E2 is unproven, so likely).
- Symptom: `applyFlagSettings({ autoCompactWindow: null })` replaces whatever `applyAutoCompactConfig` had applied from `compaction.threshold`; the session reverts to the runtime default (possibly a much larger window) until the next config re-apply. Only a WARN reports it.
- Evidence: `session-control.service.ts` (not-honoured branch, `autoCompactWindow: null`), versus `restoreSessionAutoCompactWindow` which resolves the configured value through `resolveAutoCompactControl`.
- Recommendation: send the resolved configured window, the same helper restore uses, in the not-honoured branch.

### F-5 Failed restore reports `applied: true, reason: 'failed'`

- Evidence: `session-control.service.ts` restore `failed` object; contradicts `session-budget.types.ts:49-51` ("`reason` present when `applied` is false").
- Impact: `entry.window` is stored and published with that shape (`session-budget.service.ts:599`). It is internally consistent with the intent (window still lowered) and the action result is `success: false`, but any consumer that treats `reason` as present only when `applied` is false, or maps `applied: true` to "window applied", mislabels it. Update the shared doc line to allow it, or add a dedicated `restore-failed` reason, rather than leave the type false.

### F-6 Partial failure leaves override and runtime diverged

- Trigger: `applyFlagSettings(target)` succeeds, second `getContextUsage` throws/times out.
- Symptom: `rec.autoCompactOverride = previousOverride` (`catch`) while the runtime holds `target`; later config re-apply sends the configured value, so it self-heals, but the reported `failed` is wrong in the meantime and `restore-window` has nothing to restore (override absent).
- Recommendation: on a read-back failure after a successful apply, keep the override and report `applied: false, reason: 'failed'`, or send `null`/configured back.

### F-7 Empty handoff presented as success

- See Q1. Evidence: `session-budget.service.ts:519-547`, `SessionBudgetHandoff` has no read-status field. Add `readError` (or `transcriptRead: boolean`) so the banner can warn before the user starts a new session from an empty seed.

### F-8 Handoff pruning can be driven by arbitrary UUIDs

- Trigger: `write-handoff` for any valid-UUID session id with no entry and no session (`writeHandoffAction`, `session-budget.service.ts:611-617`; `act` does not check the session exists).
- Symptom: a file per id; `prune` keeps only the newest 50 (`session-handoff-writer.ts:146-187`), evicting real handoffs. Webview-originated, local only. Fix: require an existing entry (or a live record) for the write action.

### F-9 Entry resurrection and leak

- `accept` and `warnOnce(this.entryFor(...))` and `recordCompaction` create entries (`session-budget.service.ts:188-189, 274-275, 288`). A result or compaction event that lands after `release` recreates the entry and nothing releases it. Entries for sessions ended outside the adapter (idle eviction) are also never released; each may hold a handoff copy of up to `totalChars`. Bound by sessions per process, so Moderate.

### F-10 Settings-change reset bug-by-design check (not a defect)

- `configChanged` correctly resets stage and sticky fallback (`session-budget-stage.ts:263-272`); but only on the next observed snapshot (see F-2).

### F-11 Known gaps (confirmed, behaviour impact stated)

- Failed preview keeps "Loading..." (frontend only, user has no error). Chip tooltip hard-codes 50/80/100% (`session-stats-summary.component.ts` budgetTooltip) while the stages are configurable: wrong text for a non-default `tightenPercent`/`handoffPercent`.
- Frontend keeps the action-returned state until the next snapshot (`chat-view.component.ts` resolvedSessionBudget): fine for revisioned snapshots, stale forever when revisions are null (M-6).

### F-12 Temp files orphaned on a crash

- `.<uuid>.<uuid>.tmp` is never matched by `isHandoffFileName`, so a process exit between write and rename leaves a file that pruning never removes (`session-handoff-writer.ts:119-137`). Minor.

## Blocking issues

None. No data loss, corruption or security defect was found. The writer is sound on path safety (below).

## Serious issues

### S-1 Interrupt/Stop releases the budget (F-1)

- File: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1437-1443`
- Scenario: Stop mid-turn at or after the limit, or after "Allow 20% more".
- Impact: one or more free turns past the limit; extensions, dismissals, compaction counts lost; user re-blocked despite having extended.
- Fix: release only on true session end, or persist extensions/compactions across interrupt.

### S-2 `canSend` ignores settings changes (F-2)

- File: `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.ts:200-206`
- Scenario: blocked, user relaxes or disables the budget in settings.
- Impact: settings have no effect while blocked; the user is told to use the banner but the setting they just changed is the natural fix.
- Fix: compare the config key (or re-evaluate) in `canSend`; disabled means OK.

### S-3 Refusal with no visible state and no usable action (F-3)

- File: `session-budget.service.ts:365-387, 556-563`; `message-dispatch.service.ts:201-208`
- Scenario: budget (re)enabled over the limit, or an entry-less session with a stats snapshot.
- Impact: send silently does nothing; no banner; extend fails.
- Fix: store/publish the figure the check computed, include `budget` in the refusal, and make extend work from `entry.snapshot`.

### S-4 Not-honoured path clears the user's configured window (F-4)

- File: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts` (not-honoured branch)
- Scenario: `tightenWindowTokens` set, runtime ignores it.
- Impact: user's `compaction.threshold` silently dropped for the session; auto-compact may no longer fire where the user set it. The executor flagged this and asked for a decision: change it to the resolved configured value.

## Moderate and minor issues

- M-1 (F-5) `session-control.service.ts` restore `failed` shape contradicts `session-budget.types.ts:49-51`; align type or value.
- M-2 (F-6) override/runtime divergence on second read-back failure, `session-control.service.ts` catch.
- M-3 (F-7) read failure invisible in `SessionBudgetHandoff`, `session-budget.service.ts:540-547`.
- M-4 `UUID_REGEX` is v4-only; gate unvalidated vs RPC/writer validated (`session-budget-rpc.schema.ts:28`, `session-handoff-writer.ts:60`). If any SDK session id is not v4, extend/handoff fail while the gate blocks. Verify SDK ids are always v4 (uncertain).
- M-5 (F-8) `write-handoff`/`preview-handoff` accepted for sessions with no entry.
- M-6 `chat-view.component.ts` resolvedSessionBudget: `?? -1` comparison makes an old acted state win when both revisions are null; also never cleared on tab/session change except by sessionId mismatch.
- M-7 (F-9) entry resurrection after release; no release for eviction-ended sessions.
- M-8 `/compact` exemption (`chat-session.service.ts:170-173`) cannot reduce a cumulative measure; the `/compact` turn adds usage. Either document in the banner copy or accept.
- Minor: `keepPreviousFigure` shows a numerator the chip does not (`session-budget-stage.ts:234-256`); tooltip percent hard-coded (known); failed preview "Loading..." (known); `.tmp` orphan (F-12); `act('dismiss')` on `limit` stage sets `dismissedStage` that the banner ignores for limit (`session-budget-banner.component.ts:181`), harmless.

## Data flow

1. Result message -> `releaseTurnOnResult`/result-stats wrapper -> `observeBudget(stats.sessionStats)` (`sdk-agent-adapter.ts:1633`): OK; keyed by the snapshot's real id; a throw is WARNed once and the payload still goes out.
2. `observe` -> `accept` -> `evaluateSessionBudget`: OK; revision guard mirrors the tab's `acceptSessionStats`.
3. Stage actions scheduled after return, serialised per session (`entry.actions`): OK; each failure caught, stage still advances.
4. Broadcast -> `installSessionStats(tab, snapshot, budget)`: OK; installed with the snapshot, dropped with it when the snapshot is rejected, `sessionId` mismatch ignored (`tab-manager.service.ts` budgetPatch).
5. `chat:continue` -> `refuseIfBudgetReached` after the Ptah CLI branch: gap F-1/F-2/F-3 (stored-state staleness).
6. Refusal -> `SESSION_BUDGET_REACHED` -> `MessageSender` rolls back bubble, composer keeps draft: OK; gap F-3 (no state on the refusal).
7. Banner -> `session:budgetAction` -> schema (v4 UUID + enum) -> `act`: OK on validation; gap M-5. "Continue in new session" calls `write-handoff` (fresh) and sends only `handoff.seed` to a new tab: OK.
8. Session end -> `release`: gap S-1 (also fires on interrupt), M-7 (not on eviction).

## Requirements fulfilment

| Requirement                                                   | Status   | Gap                                                                                                                                |
| ------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Numerator equals chip (live + resume), weighted only unpriced | COMPLETE | `tokenCount` absent keeps the previous value (Minor)                                                                               |
| `chat:continue` gate, only /compact and /clear pass           | PARTIAL  | Stale stored figure (S-2), lost state after Stop (S-1), silent refusal (S-3)                                                       |
| `session:budgetAction` boundary validation                    | COMPLETE | Session existence not checked for handoff actions (M-5)                                                                            |
| "Allow 20% more" idempotent                                   | COMPLETE | Only while the entry lives (S-1); second click rejected below `limit`                                                              |
| "Continue in new session" seeds only the handoff              | COMPLETE | Empty handoff not flagged (M-3)                                                                                                    |
| Auto-compact override                                         | PARTIAL  | Read-back miss clears configured window (S-4); restore type contradiction (M-1)                                                    |
| Handoff writer safety                                         | COMPLETE | v4 UUID only, path stays directly under `~/.ptah/handoffs`, `wx` temp then rename, newest-50, failures logged once, no repo writes |
| State cleanup (end, dispose, re-init)                         | PARTIAL  | Over-eager on interrupt (S-1), none on eviction (M-7); `clearAll` on dispose OK                                                    |

Implicit requirements not addressed: settings change while blocked; budget feedback when the tab has no banner state.

## Edge cases

| Case                          | Handled | How                                                        | Concern                                 |
| ----------------------------- | ------- | ---------------------------------------------------------- | --------------------------------------- |
| No snapshot / no figure       | YES     | `unknown`, fail-open                                       | OK                                      |
| Other session id              | YES     | Entries keyed by id; frontend ignores mismatched sessionId | OK                                      |
| New session after limit       | YES     | New id, new entry                                          | OK                                      |
| After "Allow 20% more"        | PARTIAL | Stage reset, limit +20%                                    | Lost on Stop/restart (restart accepted) |
| Double click on extend        | YES     | Backend requires `limit`; frontend busy flag               | OK                                      |
| Out-of-order snapshots        | YES     | Revision guard                                             | OK                                      |
| Handoff dir unwritable        | YES     | In-memory copy, `writeError`                               | OK                                      |
| Traversal / non-UUID id       | YES     | Regex + resolved-path check                                | Non-v4 ids rejected (M-4)               |
| Settings change while blocked | NO      | Stored figure                                              | S-2                                     |
| Interrupt/Stop                | NO      | State released                                             | S-1                                     |
| Unpriced model with cost unit | YES     | Sticky `weighted-fallback`                                 | OK                                      |
| Concurrent stage actions      | YES     | Chain per session, `isCurrent` guard after await           | OK                                      |

## Verdict

- Recommendation: REVISE (CHANGES REQUIRED)
- Confidence: HIGH on S-1 to S-3 (traced through code paths), MEDIUM on M-4 (depends on SDK id format)
- Top risk: the gate trusts stored per-session state whose lifetime and freshness are not tied to Stop, to settings, or to what the tab can show, so it can both let sends through and refuse them with no recourse.
- What a robust implementation would add: keep `extensions`/`compactions` across interrupt (release only on real end); re-evaluate the stored figure against current config inside `canSend`; make `checkSnapshot` publish its state and put `budget` on the refusal; send the configured window (not `null`) on a not-honoured read-back; record a transcript-read status on the handoff; require an existing session for handoff actions; release entries on every session-end path and never recreate one from a late event.
