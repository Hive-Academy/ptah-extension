# Code Style Review Delta — `TASK_2026_437_0778` Batch 20 (P4, C15)

Base: `b20-code-style-review.md` (6/10, NEEDS_REVISION, 0 blocking / 3 serious / 3 minor).
This delta re-verifies every base finding against the current uncommitted diff in
`D:\projects\ptah-437` (`git diff --stat`: 32 changed + 3 new files, 1147+/478-) and judges the
new live-event-fence surface. HEAD `36a24f257` (Sonar fix) is not in scope and was not touched by
this delta.

## Summary

| Metric          | Value                                                                                                                                                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Overall score   | 9/10                                                                                                                                                                                                                                                                                             |
| Assessment      | APPROVED                                                                                                                                                                                                                                                                                         |
| Blocking issues | 0                                                                                                                                                                                                                                                                                                |
| Serious issues  | 0 (all 3 base serious findings closed)                                                                                                                                                                                                                                                           |
| Minor issues    | 2 open (1 base minor closed as "not this batch's fix" is now moot; 1 new; see below)                                                                                                                                                                                                             |
| Files reviewed  | 19 (12 base-reviewed files re-diffed + 7 newly touched: `session-history-replayer.service.ts`(+spec), `chat.store.ts`, `chat-message-handler.service.ts`(+spec), `tab-manager.service.ts`, `session.ts`/`interact.ts`/`router.ts`, `README.md`/`jsonrpc-schema.md`, the two `jsonrpc.md` copies) |

## Base findings: closed / open

### S1 — Dead `readHistoryAsMessages` — **CLOSED**

`session-history-reader.service.ts:16-18` now lists a two-entry "Public API" (`readSessionHistory`,
`readHistoryForCuration`); `readHistoryAsMessages` (formerly `:532-546`) is deleted. Both
`{@link readHistoryAsMessages}` cross-references are updated: `readHistoryForCuration`'s doc
(`:522-527`, new) says "the UI replays `readSessionHistory` events (TASK_2026_437 C15)" instead of
pointing at the deleted method, and the shared-helper doc (`:544-547`) drops the "ONLY behavioural
difference between the two public variants" framing along with the second variant. `artifact-parity.spec.ts` was rewritten to call `reader.readHistoryAsMessages` directly per the base
review's own note that this was the one legitimate remaining caller — confirmed it is gone too
(`git diff --stat` shows `artifact-parity.spec.ts` still touched 134 lines; the method no longer
exists anywhere in `libs/backend/agent-sdk`, confirmed by `Grep` returning zero hits for
`readHistoryAsMessages` repo-wide). RPC spec mock wiring for the deleted method is gone from
`chat-session-resume-activate.spec.ts` / `chat-continue-slash-before-resume.spec.ts` (both still in
the diff for the unrelated `events`-only assertions the base review already scored 8/10).

### S2 — Replay/chunking left inline, no facade extraction — **CLOSED**

`libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts` (new, 312
lines) is exactly the collaborator the base review asked for: `claim`/`isCurrent`/`release`/
`replay` own the chunk loop and claim supersession that used to live at
`session-loader.service.ts:866-942`; `SessionLoaderService.switchSession` now calls
`this.historyReplayer.claim(resolvedTabId)` before the RPC and `this.historyReplayer.replay(events,
replayClaim, sessionId, resumableSubagents)` after it (`session-loader.service.ts:653`, `:775-793`),
with `release(replayClaim)` in the existing `finally` (`:820`). Nothing is left duplicated: the old
inline `claimReplay`/`isReplayClaimCurrent`/`releaseReplayClaim`/`replayHistoryEvents` and the
`replayClaims`/`replayClaimCounter` fields are gone from `session-loader.service.ts` (confirmed by
diff — the whole block is a removal, not a copy). `SessionLoaderService` shrinks from 1,467 to 1,346
lines (eslint: `max-lines` now reports 971 effective lines, down from 1045) — net negative line
growth despite the batch adding the live-event fence on top of the original chunking logic. Size,
constructor deps and nameability all pass: `SessionHistoryReplayer` takes three collaborators
(`TabManagerService`, `StreamingHandlerService`, `SessionManager`, `session-history-replayer.service.ts:77-79`),
same shape as the pattern the base review named (`ExecutionTreeBuilderService`/`AgentMonitorStore`);
it is injected into both `SessionLoaderService` (`:83`) and `ChatStore` (`chat.store.ts:50`) via
plain `inject()`, matching every sibling child-service injection in the same constructor block. The
name passes the nameability test — not `helpers`/`utils`/`common`/`misc`, and it names a domain
concept ("replays session history") the repo doesn't already have a word for.

### S3 — Duplicated `MessageChannel`-yield primitive — **CLOSED**

`libs/frontend/core/src/lib/services/macrotask-scheduler.ts` (already committed at HEAD, part of
the adjacent `perf(core): coalesce inbound webview message bursts` work, not part of this
uncommitted diff) is the single shared home the base review recommended. `SessionHistoryReplayer`
imports `yieldToMacrotask` from `@ptah-extension/core` (`session-history-replayer.service.ts:32`),
and `MessageRouterService` (`libs/frontend/core/src/lib/services/message-router.service.ts:51`,
`:181`) imports `scheduleMacrotask` from the same module — confirmed via `Grep` that no second
`MessageChannel`/`yieldToMacrotask` definition exists anywhere under `libs/frontend/chat`. This also
retroactively resolves logic-review M1 (the fallback-behaviour divergence): both consumers now share
one `if (typeof MessageChannel === 'undefined')` branch (`macrotask-scheduler.ts:40-43`), so there is
no longer a "does it degrade or does it fail" inconsistency to document — they are, by construction,
the same code path.

### Minor — CLAUDE.md gaps — **CLOSED**

`libs/frontend/chat/CLAUDE.md` gains rule 7 (`:70`), a dense paragraph documenting claims, chunks,
the live-event fence (matching key, buffering, delivery timing, the `LIVE_EVENT_FENCE_LIMIT` bound,
which RPC methods are and are not fenced) and `yieldToMacrotask` semantics including the jsdom
microtask fallback and the "never add a second MessageChannel helper" instruction. `libs/shared/CLAUDE.md`
gains a bullet (`:29`) stating `ChatResumeResult.events` is the only transcript, that
`rpc-chat.types.spec.ts` pins it at compile time, and that `SessionLoadResult.messages`/
`agentSessions` are always `[]`. Both bullets are accurate against the code read for this delta, not
just plausible-sounding.

### Minor — Dead `TabManagerService.applyResumedHistory` — **CLOSED**

`tab-manager.service.ts:2130-2141` (the `applyResumedHistory` method) is deleted along with its two
spec cases (`tab-manager.intent-mutators.spec.ts` — the `'applyResumedHistory installs replay
messages and marks loaded'` test is removed; `session-identity.spec.ts:141` now calls
`applyFinalizedHistory` instead, with a comment noting "Resume history lands through history
finalization (TASK_2026_437 C15)"). This was flagged as out-of-file-scope for Batch 20 in the base
review, but the developer fixed it directly rather than deferring it — repo-wide `Grep` for
`applyResumedHistory` returns zero hits.

### Minor — `rpc-chat.types.spec.ts` precedent — **OPEN (acknowledged, not a defect)**

Unchanged from the base review: this is still the first per-file compile-time-assertion spec under
`libs/shared/src/lib/types/rpc/`. Re-read `rpc-chat.types.spec.ts` in full for this delta — it is
still a clean, minimal pin (`HasNoMessagesKey`/`HasEventsKey` conditional types plus one
`not.toHaveProperty` assertion) and the base review already scored it correctly (a precedent worth
naming, not a problem). Not re-litigated as a new finding; carried forward as accepted.

## New findings

### Live-event fence — seam, dependency direction, naming: PASS

`ChatMessageHandler.handleChatChunk` (`chat-message-handler.service.ts:454-468`) wraps the existing
`processStreamEvent`/`routeStreamEvent` pair in a `deliver` closure and offers it to
`this.chatStore.deferLiveStreamEvent(event, tabId, sessionId, deliver)`, falling through to
`deliver()` only when the store reports no fence claimed it. `ChatStore.deferLiveStreamEvent`
(`chat.store.ts:392-407`) is a one-line pass-through to `this.historyReplayer.deferLiveEvent(...)` —
the same thin-delegation shape as every other `ChatStore` facade method in this file (e.g.
`processStreamEvent` a few lines above). Dependency direction is correct: `ChatMessageHandler`
(a `MessageHandler`, outside `chat-store/`) depends on the `ChatStore` facade, never reaches past it
into `chat-store/session-history-replayer.service.ts` directly — confirmed by `Grep`, no import of
`SessionHistoryReplayer` outside `chat.store.ts` and `session-loader.service.ts`. `SessionHistoryReplayer`
itself never imports `ChatMessageHandler` or anything from outside `chat-store/`'s existing
collaborator set (`TabManagerService`, `StreamingHandlerService`, `SessionManager`) — no new boundary
crossing. Naming: `deferLiveStreamEvent` / `deferLiveEvent` / `findFence` / `openFence` / `closeFence`
/ `leaveFence` read as what they do, not how (no `helper`/`process2`/`handle2`); `LiveEventFence` and
`HeldFence` are two distinct, correctly-scoped types (session-keyed buffer vs. one tab's hold on it) —
the doc comment at `session-history-replayer.service.ts:53-59` states the deliberate reason the fence
is keyed by session rather than tab (fan-out), which is exactly the kind of "why," not "what,"
comment the file otherwise avoids over-explaining. Type precision: `deferLiveEvent` takes
`FlatStreamEventUnion`, not `unknown` or a widened event type; `deliver: () => void` is a plain
callback, not stringly-typed. This is the correct seam — a new mechanism added at the one place
`ChatMessageHandler` already routes every chunk through, with no parallel entry point invented.

### `yieldToMacrotask` semantics documented at both point of definition and point of reliance: PASS

Confirmed present in three places, all consistent with each other and with the code: the shared
helper's own doc (`macrotask-scheduler.ts:1-18`, "rejects if the underlying post throws" / jsdom
resolves on a microtask), the replayer's class doc (`session-history-replayer.service.ts:23-28`,
"Yield failures" bullet — ties the rejection to the replayer's own failure branch), and
`chat/CLAUDE.md` rule 7's "Yield semantics" sentence. No divergence found between what the code does
(`replay`'s `await yieldToMacrotask()` at `:163` is inside the same `try` `switchSession` wraps, so a
rejection surfaces exactly like a throwing chunk) and what all three comments claim.

### Stale comment, `history-event-factory.ts:503` — flagged by the developer, confirmed real, **should be fixed but is not blocking**

- File: `libs/backend/agent-sdk/src/lib/helpers/history/history-event-factory.ts:499-507`
- Problem: the doc comment for `extractContentForCuration` still reads "the text-only
  {@link extractTextContent} (consumed by the UI history view) strips them." `extractTextContent`
  is no longer consumed by any UI-history-projection method — `readHistoryAsMessages`, its only
  caller for that purpose, was deleted in this batch. Repo-wide `Grep` shows `extractTextContent`'s
  remaining callers are `session-replay.service.ts` (event-stream text extraction, unrelated to the
  deleted UI projection) and `session-history-reader.service.ts:758` (`resolveAnchorByPromptText`,
  a fork/rewind anchor matcher — also unrelated to "the UI history view").
- Impact: low — this is a doc-comment-only staleness in a file the batch's own diff doesn't touch
  (`history-event-factory.ts` is not in `git diff --stat`'s file list), so it is drift the deletion
  caused one hop away rather than a defect in changed code. A reader following the `{@link}` still
  lands on a real method; they'd just be told the wrong reason it's "text-only" (there's no longer a
  UI consumer to contrast against).
- Recommendation: reword to something like "unlike {@link extractTextContent}, which drops
  `tool_use`/`tool_result` blocks entirely" — dropping the now-false "(consumed by the UI history
  view)" parenthetical. Small enough to fold into this batch or the next touch of this file; not a
  reason to withhold approval.

### `session.spec.ts:993` / `interact.spec.ts:848` — non-empty `session:load` mocks — judged **not required for this batch**

- File: `apps/ptah-cli/src/cli/commands/session.spec.ts:993` (`e.scripted.set('session:load', { data:
{ messages: [{ role: 'user', content: 'hi' }], agentSessions: [] } })`), similarly
  `interact.spec.ts:848`.
- These specs mock the RPC layer with a non-empty `messages` array, which the real backend can no
  longer produce (`SessionLoadResult.messages` is `[]` by construction, per the doc fix this batch
  made at `rpc-session.types.ts:98-101` and the new CLAUDE.md bullet). Judgment: this is a
  fixture-realism gap, not a false assertion about production behaviour — the tests exercise the
  CLI's pass-through/write-JSON mechanics (`parsed.messages).toHaveLength(1)`), which remain correct
  regardless of what the real backend sends, since the router code has no special-case for empty vs.
  non-empty `messages`. Neither `session.spec.ts` nor `interact.spec.ts` is in this batch's diff
  (confirmed via `git status --short` — absent from the 32 changed + 3 new files), and the batch's
  stated scope (Task 20.1/20.2, `chat:resume` + chunked replay) does not touch `session:load`'s
  contract, only its already-accurate doc comments. Fixing the mock realism is a legitimate but
  separable follow-up (touches an untouched test file for a fixture-hygiene reason, not a
  correctness one) — not required to close this batch, and not scored as an open finding here.

## Pattern compliance (re-verified)

| Repository rule or nearby convention                                                     | Status | Evidence                                                                                                                                                               |
| ---------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Facade rule (extract collaborator past size/nameability threshold)                       | PASS   | `session-history-replayer.service.ts` (new), injected into `SessionLoaderService` and `ChatStore` identically to `ExecutionTreeBuilderService`/`AgentMonitorStore`     |
| No dead code left behind a deletion                                                      | PASS   | `readHistoryAsMessages` and `applyResumedHistory` both deleted with their spec cases                                                                                   |
| CLAUDE.md kept current for architecturally significant change                            | PASS   | `chat/CLAUDE.md:70`, `shared/CLAUDE.md:29`                                                                                                                             |
| Single shared primitive, not reinvented per consumer                                     | PASS   | `macrotask-scheduler.ts` used by both `session-history-replayer.service.ts` and `message-router.service.ts`                                                            |
| Facade dependency direction (outer handler → store facade → collaborator, never skipped) | PASS   | `chat-message-handler.service.ts:454-468` → `chat.store.ts:392-407` → `session-history-replayer.service.ts:218-243`; no direct import of the replayer from the handler |
| Two jsonrpc.md copies stay identical                                                     | PASS   | `diff` reports no difference                                                                                                                                           |
| VS Code Marketplace trademarked-name rule not worsened by assets markdown edit           | PASS   | `git diff` on the vscode-assets copy contains no `claude`/`copilot`/`codex`/`openai`/`anthropic` string                                                                |
| eslint clean (no new errors) on re-touched production files                              | PASS   | `npx eslint` on the four key files: 0 errors, 2 pre-existing warnings (`max-lines`, empty-function), both already known from the base review                           |
| prettier clean on new files                                                              | PASS   | `npx prettier --check` on the three new files: clean                                                                                                                   |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: none blocking. The one remaining loose end is a one-line stale doc comment
  (`history-event-factory.ts:503`) in a file this batch didn't touch, caused one hop away by the
  `readHistoryAsMessages` deletion — worth a follow-up edit, not a re-review.
- What a 10/10 version would do differently: fold the `history-event-factory.ts:503` wording fix
  into this batch (it is a one-line change in a file already conceptually owned by this deletion),
  and, as a separate low-priority follow-up outside this batch's stated scope, refresh
  `session.spec.ts`/`interact.spec.ts`'s `session:load` mocks to return `messages: []` so the
  fixtures match what the backend can actually send.
