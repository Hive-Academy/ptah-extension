# TASK_2026_360 — Independent review gate (Codex + adjudication)

Task: **Backend-owned session turn state as the single source of truth for streaming status**
Status at review time: `in_review`. Question: is moving it to `done` honest?

Reviewers: Codex CLI (agent `6dd11cb6-18a7-4de8-abc6-e571c602daf2`, session
`01a07db1-179b-7fb0-8394-6d4fc6ac3db6`, read-only) + this gate's own verification.
Every Codex claim carried below was re-opened at the named file:line and confirmed;
claims that did not survive that check are listed as dropped.

Independent evidence gathered by this gate:
`npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/agent-sdk
@ptah-extension/rpc-handlers @ptah-extension/chat-state @ptah-extension/chat-streaming
@ptah-extension/chat` → **Successfully ran target typecheck for 6 projects** (exit 0).

## Acceptance criteria

Criteria are extracted from `implementation-plan.md` §1–§4 plus the four findings of the
prior `code-logic-review.md` (4/10, NEEDS_CHANGES) that batches B5a/B5b/B5c claim to close.

| #    | Criterion                                                                        | Codex           | Adjudicated     | Key evidence                                                                                                          |
| ---- | -------------------------------------------------------------------------------- | --------------- | --------------- | --------------------------------------------------------------------------------------------------------------------- |
| AC1  | Shared contract: phase union, revision, `TurnStateEvent` in `FlatStreamEventUnion`, guard, Zod schema | SATISFIED       | **SATISFIED**   | `libs/shared/src/lib/types/execution/stream-background.ts:226,259,281,308`; `type-guards/guards/exec.ts:406`; `types/sdk-hook.schemas.ts:125` |
| AC2  | Turn state travels IN the ordered chunk stream, never as a `MESSAGE_TYPES` push   | SATISFIED       | **SATISFIED**   | `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:462-464`; broadcaster spec asserts `['text_delta','text_delta','turn_state']` at `chat-stream-broadcaster.service.spec.ts:540` |
| AC3  | Registry reducer, DI singleton, monotonic revision incl. rekey and clear/resume   | NOT SATISFIED   | **SATISFIED (with known bounded residue)** | `session-turn-state.registry.ts:200,215,220,228,263,291,328,363`; `di/register.ts:383`. Codex's failure rests on `REVISION_FLOOR_MAP_LIMIT = 256` eviction — a deliberate, documented bound with a paired frontend heal (`registry.ts:96-127`, `tab-manager.service.ts:1235-1276`, TASK_2026_371). Downgraded to a note. |
| AC4  | `ResultMessageTransformer` actually runs, one terminal state per result; hooks only snapshot | SATISFIED       | **SATISFIED**   | `sdk-message-transformer.ts:234`; `result-message.transformer.ts:24-25`; `stop-hook-handler.ts:90`; `stop-failure-hook-handler.ts:78`; `subagent-stop-hook-handler.ts:78`; `system-message.transformer.ts:411-413` |
| AC5  | Broadcaster forces idle before `CHAT_ERROR` and in `finally`, then clears         | PARTIAL         | **PARTIAL**     | `chat-stream-broadcaster.service.ts:317-325,352-358,410-415`. Ordering is right; the `forceIdle` calls are not guarded by the record-token comparison at `:383-399` (blocker B3). |
| AC6  | `session:status` returns `turnState`, `isStreaming` derived from phase            | SATISFIED       | **SATISFIED**   | `session-rpc.handlers.ts:1163,1170-1171`; `rpc-session.types.ts:312` |
| AC7  | Exactly ONE frontend applier; all event-derived status writers deleted            | NOT SATISFIED   | **SATISFIED for the tab path** | `streaming-handler.service.ts:102-108`; grep for `markTabStreaming`/`markStreaming(` across `libs/frontend` (non-spec) returns only `message-sender.service.ts:377,662-663` (the sanctioned optimistic send) and the registry/applier themselves. Codex's counter-example (`chat-message-handler.service.ts:477` `markFailed`) is the surface-owned `CHAT_ERROR` path, which plan §3.4 never listed for deletion. Dropped as a blocker. |
| AC8  | Multi-workspace / multi-session; no stale cross-contamination; per-session hard-deny | NOT SATISFIED   | **PARTIAL**     | Hard-deny per session is genuinely fixed (`permission-handler.service.ts:98,452-455`). Cross-workspace routing verified (`turn-state-applier.service.ts:194-218`). The unbound-placeholder acceptance window remains open (blocker B2). |
| AC9  | Failure/abort do not finalize outside the ordered event, except the B5c fallback  | NOT SATISFIED   | **SATISFIED (one documented deviation)** | `chat-lifecycle.service.ts:272-299` no longer finalizes or writes status; `conversation.service.ts:228-238,296-312`. Codex's repeat-abort objection is real code (`:193-201`) but it is session-scoped and re-resolves the tab; it is a second-press escape hatch, not an unordered writer. Downgraded to a note. |
| AC10 | UI derives from backend state; `sleeping` real; restore re-learns                 | SATISFIED       | **SATISFIED**   | `chat-types.ts:446,458`; `chat-input.component.ts:440`; `tab-bar.component.ts:120`; `awaiting-background-indicator.component.ts:87,105`; `tab-persistence.ts:127,132` |
| AC11 | Tests exist and are meaningful                                                    | PARTIAL         | **PARTIAL**     | Coverage is genuinely strong (registry spec has ~50 cases incl. rekey collision + floor eviction; applier spec covers stale/foreign rejection). Gaps are real: no test ties a failed `chat:start` to `_streamingTabIds` (`message-sender.service.spec.ts:428-433` asserts only `markLoaded` + `failSession`), none covers the unbound-placeholder window, none covers an old broadcaster exiting against a newer same-key record. |

## Codex raw verdict

```
VERDICT: NEEDS_WORK
```

Codex reported: AC3, AC7, AC8, AC9 NOT SATISFIED; AC5, AC11 PARTIAL; the rest SATISFIED.
Prior findings: F1 NOT CLOSED, F2 CLOSED, F3 NOT CLOSED, F4 CLOSED.

## Adjudication

Confirmed and carried forward (three blockers, below): the failed-`chat:start` spinner leak,
the unbound-placeholder acceptance window, the unguarded broadcaster `forceIdle`.

Confirmed but **downgraded** (real code, not grounds to withhold `done`):

- **AC3 / 256-entry floor eviction.** `registry.ts:128,414-422`. The bound is deliberate, the
  eviction cost is written out in the source, and `tab-manager.service.ts:1319-1324` carries the
  matching terminal heal. This is an engineered tradeoff, not an unfinished promise.
- **AC7 / `chat-message-handler.service.ts:477` `markFailed`.** Surface-owned session with no tab;
  plan §3.4's deletion list does not include `handleChatError`.
- **AC9 / repeat-abort local idle.** `conversation.service.ts:193-201` → `idleAbortedTabLocally`
  (`:296-312`) re-resolves the tab by id and returns if `claudeSessionId` moved. Scoped, and it
  only fires when the user presses Stop a second time on a turn already aborted.
- **`SessionId.from` on wire data** — `chat-lifecycle.service.ts:290`. Violates the repo rule
  ("never `from` off the wire"), but every producer on `CHAT_ERROR` supplies a UUID v4
  (SDK session id or tabId). Low; worth a follow-up edit, not a gate.
- **Optional-chained hook snapshots** (`stop-hook-handler.ts:90` et al.). `di/register.ts:383`
  registers the singleton, so the interactive path always supplies it. Cosmetic.
- **`session:status` error → `{isActive:false,isStreaming:false}`** (`session-rpc.handlers.ts:1186`)
  and **dead `CompletionHandlerService` export** — both pre-existing, both minor.
- **`StreamBatchBuffer` swallows a sink rejection** (`stream-batch-buffer.ts:194-196`). A dropped
  terminal batch would strand the spinner while the registry is cleared, but that is a transport
  failure, and the buffer's "report, never throw" contract is deliberate and spec'd.

Dropped: nothing Codex asserted was found to be factually wrong at the line it named. Its
severity calibration was wrong in four places (above); its file:line evidence held everywhere
this gate re-checked it.

## Blockers

### B1 — CRITICAL. A failed `chat:start` leaves the Stop button lit forever. This is the original bug.

`libs/frontend/chat/src/lib/services/message-sender.service.ts:377`

```ts
this.tabManager.markTabStreaming(activeTabId);   // optimistic, BEFORE the RPC
```

Both failure exits call `markLoaded` only:

- `message-sender.service.ts:431` — structural rejection (`!result.success || authFailed || result.data?.success === false`)
- `message-sender.service.ts:447` — thrown RPC

and `markLoaded` writes status alone:

```ts
// libs/frontend/chat-state/src/lib/tab-manager.service.ts:1104
markLoaded(tabId: string): void {
  this.updateTabInternal(tabId, { status: 'loaded' });
}
```

The tab stays in `_streamingTabIds` (only `markTabIdle` at `tab-manager.service.ts:2344-2351`
and `applyTurnState` at `:1197-1203` remove it). No stream was ever created, so no backend
`turn_state` can arrive to repair it.

Failure scenario: new chat → user sends → spinner on → `chat:start` returns
`{ success: false }` (auth failure, backend rejection) or throws → status flips to `loaded`
while `isTabStreaming(tab.id)` stays `true` → the red Stop button
(`chat-input.component.ts:415`, `tab-bar.component.ts:66`) is lit with nothing to clear it.
Worse than cosmetic: `_streamingTabIds` also gates send-vs-queue
(`tab-manager.service.ts:150-156`, TASK_2026_382), so the next message is silently queued
instead of sent.

The sibling path proves this is an oversight, not a design: `continueConversation` pairs both
calls on both failure exits — `message-sender.service.ts:652-653` and `:668-669`.

Test gap: `message-sender.service.spec.ts:428-433` asserts `markLoaded` and `failSession` and
never looks at the spinner set (`markTabIdle` appears twice in that whole spec, both for the
continue path).

Related, same family (PLAUSIBLE, not separately proven to occur): a stream that exits cleanly
with zero events sends only `CHAT_COMPLETE` (`chat-stream-broadcaster.service.ts:276-286`);
the `finally` heal at `:355` fires only when the registry says `generating`, and the registry
has no record when nothing called `markGenerating`. A plain `CHAT_COMPLETE` is ignored by the
webview, so the optimistic spinner survives that exit too.

### B2 — MAJOR. Review F1 is only half closed: an unbound tab still accepts any session's terminal event.

`libs/frontend/chat-state/src/lib/tab-manager.service.ts:1304-1308`

```ts
const bound = tab.claudeSessionId;
if (bound && bound !== sessionId) return false;   // ownership checked ONLY when bound
const last = tab.lastTurnStateRevision;
if (last === undefined) return true;
```

The prior review's prescribed fix was explicit: *"Reject a routed tab unless the event uses its
unresolved placeholder (`event.sessionId === tab.id`) or the event session is currently bound to
that tab"* (`code-logic-review.md` Finding 1). The shipped rule is weaker — an unbound tab
accepts **any** `sessionId`.

Failure scenario: tab `T` is reset (`resetTabToFresh` nulls `claudeSessionId` and clears both
watermarks) and immediately re-used for a replacement session; before the SDK `init` returns the
UUID the tab is still unbound; the OLD broadcaster for `S-old`, which captured `tabId = T`,
exits and pushes `idle@N`. `TurnStateApplier.resolveTabs` routes it by tab id
(`turn-state-applier.service.ts:195-200`), acceptance passes on both clauses above, and the
applier then finalizes the replacement's in-flight message
(`turn-state-applier.service.ts:126`), drains its hard-deny bucket and writes `status: 'loaded'`
— the exact destructive sequence F1 was raised about, in the one window the fix does not cover.
The replacement's own `generating@1` is then rejected (`1 > N` false, heal needs `bound`), so
the turn streams with no spinner until its terminal event lands.

No spec covers this window. `turn-state-applier.service.spec.ts:295` covers the *bound* case only.

### B3 — MAJOR. The broadcaster force-idles a shared registry key before it knows its record was replaced.

`libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:320` (catch)
and `:355-357` (finally) both call `this.turnState.forceIdle(turnSessionId)` and push the result.
The identity check that exists precisely for id reuse runs later, at `:383-399`
(`endSessionIfTokenMatches` → `recordReplaced`), and only the `clear` at `:413-414` is guarded
by it:

```ts
// :412
if (!recordReplaced) {
  this.turnState.clear(turnSessionId);
  this.turnState.clear(sessionId);
}
```

Failure scenario — the slash-command follow-up race the same file documents at `:369-381`:
`executeSlashCommandQuery` ends the old record and registers a new one under the SAME id. The
old loop sees the end as a thrown abort, reaches the catch, and calls `forceIdle` on the
registry entry the NEW query is already using. The state it commits carries a revision above
anything the tab holds and a terminal phase, so the frontend accepts it and idles a live turn.
`forceIdle` also resets `generatingEmitted` (`registry.ts:298`), so the backend's own view of
the running turn is corrupted, not just the UI's.

Guard both `forceIdle` sites the way `clear` is guarded, or take the record token before them.
No spec covers it: `chat-stream-broadcaster.service.spec.ts:800` pre-settles the registry to
`idle` rather than putting a newer `generating` record under the key.

## Final verdict

**NEEDS_WORK — do not move TASK_2026_360 to `done`.**

The architecture the task promised is genuinely built and is good work: one backend reducer,
the state carried in the ordered chunk stream, one frontend applier, every event-derived status
writer removed, `sleeping` plumbed to the UI, typecheck green on all six affected projects, and
a registry/applier spec suite that tests real behaviour rather than mocks. Findings F2 and F4 of
the prior review are genuinely closed.

But the task's own headline symptom — a lit Stop button with an idle backend — is still
reachable in one command (B1), through the optimistic writer this task explicitly kept and
explicitly made responsible for pairing itself with a cleanup. Its sibling path does pair it.
No test looks at the spinner set on that path. Closing the task with B1 open would record the
original bug as fixed while a first-message auth failure still reproduces it.

B2 and B3 are narrower races, but both are the same class the prior review already forced a
batch for, and both are untested.

Suggested minimum to clear the gate: add `markTabIdle` to both failure exits of
`startNewConversation` with a spec that asserts `_streamingTabIds`; tighten
`acceptsTurnState` so an unbound tab accepts only `sessionId === tab.id` or `undefined`;
move the record-token comparison ahead of the two `forceIdle` calls. Each is a few lines and
each wants the test it currently lacks.
