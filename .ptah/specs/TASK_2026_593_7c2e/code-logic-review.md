# Code Logic Review - TASK_2026_593_7c2e, Phase A

Review family: Anthropic (reviewer) / codex (implementer)

Scope read in full: `libs/frontend/core` (attention.types, notification.service, dispatcher token), `libs/shared` attention wire (attention.ts, schemas.ts additions, rpc-attention.types, rpc.types, constants, payload map), `libs/frontend/notification-center` (store, bell, snackbar, announcer, sound service, types), `libs/frontend/chat` attention services (source, dispatcher, host handler, responder), shell diffs (app-shell, electron-shell), `libs/frontend/chat-streaming/permission-handler.service.ts` diff, `apps/ptah-extension-webview/src/app/app.config.ts` diff. Checked against decisions #1-#28, plan rows A1-A7/A5b, task-description ACs, design-spec and parity-inventory. No tests were run (single check slot, per brief); every runtime claim below is from reading code, and the two claims that depend on Angular scheduling are marked as such.

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 4/10 |
| Assessment | REVISE |
| Blocking issues | 2 |
| Serious issues | 9 |
| Moderate issues | 10 |
| Minor issues | 4 |
| Failure modes found | 25 |

Evidence separating 4 from the bands either side: the structure (single keyed model, generation guards, snapshot-vs-push revision check, Clear all semantics, privacy of wire and logs) is sound and matches the approved design, which keeps it above 3. But the real `NotificationService` is never exercised by the chat-source specs (it is mocked), and with the real service the source silently drops a whole class of requests and likely re-triggers itself; several preserve-list capabilities (failed-turn notices, sound outside the bell, host Open) are lost or dead. That is more than "needs a polish pass", so not 6.

## Five logic questions

### 1. How does this fail silently?

- Requests whose owner has no workspace path never reach the model. `chat-attention-source.service.ts:88` sets `workspacePath = owner?.workspacePath ?? ''`; `notification.service.ts:74` returns early on an empty `workspacePath`. `TabLookupResult.workspacePath` is `null` whenever no workspace is active (`libs/frontend/chat-state/src/lib/tab-workspace-partition.service.ts:329-338`, comment names the VS Code panel) and for any unmatched owner. Result: no bell row, no badge, no snackbar, no sound, no announcement, for a prompt the backend waits on (questions have no timeout). The source spec hides this because it mocks `NotificationService` (`chat-attention-source.service.spec.ts:36`, "keeps an unmatched request countable" asserts only that `upsert` was *called*). The dispatcher's failure notice (`chat-attention-action-dispatcher.service.ts:43-50`) has the same empty path and is dropped the same way.
- Failed turns no longer produce any notice. The ledger (the only consumer of `terminalTurnPulses`) is deleted (A5b) and no batch row projects failed turns (plan "Entry points" names `terminalTurnPulses()`, but A2's source implements only permissions, questions and lanes). AC9, AC22, parity row 39 are silently unmet.
- Allow/Deny on a request without a resolved tab is enabled and does nothing: `chat-attention-action-dispatcher.service.ts:38` `if (!target.tabId) return false`, while the source enables Allow whenever a tool name exists (`chat-attention-source.service.ts:102`). The click returns `false`, the bell and snackbar ignore the result (`notification-center.store.ts:79`, `notification-snackbar.component.ts:171`), and the user sees nothing.
- Open on a host-projected row does nothing when the dispatcher is bound (it is, in `app.config.ts`). `dispatch` returns `false` when `source.getLive` has no entry (`chat-attention-action-dispatcher.service.ts:18-19`); host items live only in `NotificationService`; `store.activate` returns the dispatcher result without a fallback (`notification-center.store.ts:79`).
- Sound: `NotificationSoundService` is now injected only by `NotificationCenterComponent` (`notification-center.component.ts:133`); the deleted ledger used to instantiate it eagerly at root. On a standalone-first boot (bell row not built; the shell comment in the old code says exactly this) no attention sound ever plays.

### 2. What user action produces unexpected behaviour?

- Clicking "+N more": the snackbar output calls `bell.click()` (`app-shell.component.ts:193`, `electron-shell.component.ts:401-404`). The bell opens, then the *original* click bubbles to the bell's `(document:click)` handler (`notification-center.component.ts:22,176`); its target is the snackbar button, outside the bell host, so `close(true)` runs. The panel opens and closes in the same event.
- Muting then un-muting the bell sound replays the last cue: the sound service effect (`notification-sound.service.ts:27-33`) reads `_muted()` inside `playBurst` (tracked), and `soundState` is never reset, so the effect re-runs with the old cue and plays when the cooldown has elapsed.
- The X on a "Needs you" row (`notification-center.component.ts:65-69`) calls `dismissPresentation`, which only hides a snackbar. Inside the bell the row stays, so the button looks dead.
- Opening a permission whose session is already visible and focused still raises a snackbar: nothing implements "focused visible owning surface suppresses its snackbar" (AC1, AC24, design-spec :35). `setSnackbarSuppressed` has one caller, the bell panel store.
- Clicking an OS/host notification whose snapshot target does not match is dropped with only a log line (`chat-attention-host-message-handler.service.ts:189`), no status message.

### 3. What input data produces a wrong answer?

- A workspace path of `''`/`null` (above): the request vanishes instead of being counted unroutable.
- The local key embeds `workspacePath` (`attentionRequestKey`, JSON array). When a tab binds late, the path changes `''` -> real path, the key changes, `reconcile` resolves the old key and upserts a new lifecycle (`generations.get(newKey)+1 = 1`). A snackbar the user dismissed reappears, and the announcer announces again.
- A host notice with a session title longer than 120 characters fails `AttentionNoticeSchema` (`schemas.ts` `title ... max(120)`) and the whole notice is dropped, so the request never appears from the host path. Truncation is a host promise that nothing on the renderer enforces.
- A `resolve` carrying a newer generation than the projected one is a no-op (`chat-attention-host-message-handler.service.ts:157` requires equality), leaving a stale "Needs you" row until the next reveal reconcile.

### 4. What happens when a dependency fails?

- `attention:getSnapshot` failure/timeout/bad shape returns `null` (`:89,94,99`), logs a fixed line and is never retried; bootstrap has one `queueMicrotask` attempt (`:53`). If it fails at startup (host not ready), host-only requests stay invisible until a focus/visibility event.
- `vscode.postMessage` throwing is handled well in the responder and `permission-handler` (post before mutate, rollback of `answeredRequestIds`).
- Focus router failure: dispatcher turns `!outcome.success` into a generic failure notice (good), but the notice is dropped when the owner path is empty.
- Dispatcher swallows the thrown error object entirely (`:40`, degradation-audit sentinel) so no error class survives anywhere.

### 5. What is missing that the requirements never mentioned?

- Nothing drains `TabManagerService._terminalTurnPulses` any more (`tab-manager.service.ts:1945,1952`; `takeTerminalTurnPulses` had one caller, the deleted ledger). Every finished turn appends a pulse, including `lastAssistantMessage`, for the life of the tab manager: unbounded growth that retains assistant text.
- Eviction/cleanup for `info`/`success` entries in core (never recent, never request, never removed), `generations`, `answeredRequestIds`, `generationFloor`, `announced`.
- A way for sources to say "owner unknown but countable" without a fake path.
- Cross-source identity (see decision #27 contracts below).

## Failure modes

### Silent drop of ownerless requests
- Trigger: permission/question/lane request whose tab has no workspace (VS Code panel, unmatched session).
- Symptom: request exists in the backend, invisible in every attention surface.
- Evidence: `chat-attention-source.service.ts:88`, `notification.service.ts:74`, `tab-workspace-partition.service.ts:329-338`.
- Current handling: `upsert` returns silently.
- Recommendation: identity must not depend on a path (contract 1); accept `workspacePath: ''` as "unknown workspace" in core; add an unmocked integration spec.

### Source effect reads and writes the model it reconciles
- Trigger: any live request while the source effect is active.
- Symptom (probable, depends on Angular effect semantics): the effect re-runs after every run and on every `tabs()` change. `upsert` reads `this.entries()` (`notification.service.ts:75`) inside the effect and writes it with a fresh array (`:105`); `resolve` does the same (`:111-114`). Reads inside an effect are tracked, so the effect becomes its own dependency; each run re-upserts every live item (new array, `revision` bump, snackbar/bell/announcer recompute). Expect a render/re-run loop or at best per-token churn, since `tabs.tabs()` (`chat-attention-source.service.ts:34`) also changes during streaming.
- Evidence: `chat-attention-source.service.ts:29-36,63-72`.
- Current handling: none; the spec mocks the model.
- Recommendation: run the reconcile body in `untracked`, depend only on the explicit source signals, skip `upsert` when the item is shallow-equal to the live one, and add a spec with the real `NotificationService`.

### Failed turns lost, pulses leak
- Trigger: any turn ending with a failure reason; any turn ending at all.
- Symptom: no failure snackbar/Recent row/sound (AC9, AC22); pulse array grows.
- Evidence: `tab-manager.service.ts:1945-1956`; ledger deletion (A5b); no A/B/C row owns it.
- Recommendation: add the projection to the chat source (call `takeTerminalTurnPulses()`, discard non-failures, raise `failure` items with Open); drain even when the item is suppressed.

### Host Open row is inert
- Trigger: host-projected row, user presses Open.
- Evidence: `chat-attention-action-dispatcher.service.ts:18-19`, `notification-center.store.ts:79`, handler `:139-149`.
- Recommendation: dispatcher falls back to the `NotificationService` entry by key/generation for `source === 'host'` open; or `activate` falls back to `focus(item)` when the dispatcher returns "not mine".

### Tabless Allow/Deny no-op
- Evidence: `chat-attention-action-dispatcher.service.ts:38`; `permission-handler.service.ts:431` (`tabId?` is optional).
- Recommendation: make `tabId` optional through `respondSession` and always run the response; return a typed outcome.

### "+N more" self-closes the bell
- Evidence: `notification-center.component.ts:22,176`; shells' `openNotifications`.
- Recommendation: expose `openPanel()` on the bell and call it (typed `viewChild(NotificationCenterComponent)`), or ignore events whose `target` is the snackbar host; do not synthesize a click.

### Sound replay on unmute and no root sound instance
- Evidence: `notification-sound.service.ts:27-33,77-82`; `notification-center.component.ts:133`; old ledger injected the service.
- Recommendation: track `lastCueSequence`, wrap `playBurst()` in `untracked`, and inject `NotificationSoundService` from the shell-level announcer (or an app initializer).

### Duplicate bell rows (decision #27.1)
- Trigger: host push plus local source for the same request (every VS Code request once B2 lands).
- Evidence: local key `JSON.stringify([workspacePath, kind, id])` (`notification.service.ts:19`) vs host key = wire id (`AttentionIdSchema` forbids `[`, `"`, `/`, `\`); badge counts `needsYou().length` (`notification.service.ts:45`).
- Recommendation: contract 1.

### Orphan projection on newer-generation resolve
- Evidence: `chat-attention-host-message-handler.service.ts:66-69,155-159`.
- Recommendation: resolve when `generation >= projected`.

### Snapshot failure never retried
- Evidence: `:53,89-99`. Recommendation: bounded retry with backoff (3 tries, 1s/3s/10s) on null, and one on first RPC-ready.

## Blocking issues

### B1. Ownerless requests are silently discarded by the core model
- File: `libs/frontend/chat/src/lib/services/chat-attention-source.service.ts:88-89`; `libs/frontend/core/src/lib/services/notification.service.ts:74`
- Scenario: VS Code editor panel (no active workspace, `workspacePath: null`), or any request whose tab/session does not resolve.
- Impact: the user is never told a permission or question needs them; the agent hangs. Violates AC23 ("unroutable ... counted"), plan component 1 failure clause, parity row 41, and replaces a previously working (counted, disabled) row.
- Fix: (1) key identity without path (contract 1); (2) core accepts `workspacePath === ''` with `workspaceName` "Unknown workspace"; remove the path from the guard; (3) dispatcher failure notices use `attentionConditionKey` with a non-empty scope token; (4) add a spec using the real `NotificationService` with unmatched and `workspacePath: null` owners and asserting a Needs you row.

### B2. Source effect is a reactive read/write cycle over the model it feeds
- File: `chat-attention-source.service.ts:29-36,63-72`; `notification.service.ts:75,105,111-114`
- Scenario: a live request exists; any `tabs()` change (streaming) or the previous run's own write.
- Impact: probable endless effect re-runs and re-renders of bell, snackbar and announcer; at minimum per-token churn and repeated `soundEligible`/announcement work. Not observable in current specs because the model is mocked. Unverified at runtime (not run); treated as Blocking because the cost of being wrong is a frozen webview and the fix is local.
- Fix: as in "Source effect reads and writes" above, plus replace the whole-`tabs()` dependency with a computed of (tabId, sessionId, workspacePath) tuples.

## Serious issues

### S1. Failed-turn notices removed with no replacement; terminal pulses leak
- File: `libs/frontend/chat-state/src/lib/tab-manager.service.ts:1945,1952`; `chat-attention-source.service.ts` (no projection); A5b deletion.
- Scenario: any turn end. Impact: AC9/22 and parity row 39 unmet; unbounded memory (assistant text retained).
- Fix: see Failure modes. Also add lane-failure and ActionBanner/voice rows to the plan (C1 owns the latter two; nothing owns turn/lane failures).

### S2. Host Open dead when the dispatcher is bound
- File: `chat-attention-action-dispatcher.service.ts:18-19`; `notification-center.store.ts:79`
- Fix: see Failure modes.

### S3. Allow/Deny enabled but inert without a tab
- File: `chat-attention-action-dispatcher.service.ts:38`; `chat-attention-source.service.ts:102`
- Fix: see Failure modes; the dispatcher must also return a distinguishable outcome and the bell/snackbar must surface `unavailable`/`stale` (a short status notice) instead of ignoring `false` (`notification-center.store.ts:79`, `notification-snackbar.component.ts:171`).

### S4. "+N more" immediately closes the bell
- File: `notification-center.component.ts:22,176`; `app-shell.component.ts:190-195`; `electron-shell.component.ts:401-404`. Fix: see Failure modes. Judgement on the shell `querySelector`: it is functionally sound (the host element contains the bell; encapsulation does not block `querySelector`; the `viewChild(..., { read: ElementRef })` typing is right), but it couples two shells to a `data-testid` and to `aria-expanded` via `MutationObserver`, and `pendingNotificationOpen` (`app-shell.component.ts:267-279`) can stay `true` and auto-open the bell on an unrelated later render. Replace with a typed `viewChild(NotificationCenterComponent)`, a public `panelOpen` signal/output and an `openPanel()` method.

### S5. Sound: replay on unmute, and no root-level service instance
- File: `notification-sound.service.ts:27-33,77-82`; `notification-center.component.ts:133`. Fix: see Failure modes. A cue present at service construction must not be played (record the current sequence at construction).

### S6. No focused-and-visible suppression of snackbars
- File: `notification.service.ts:152-156` (one caller: `notification-center.store.ts:33-41`); AC1, AC24, design-spec :35, plan component 2.
- Fix: the chat source computes `inlineVisible` per request (owning tab active in the visible grid/single view, `document.visibilityState === 'visible'`, `document.hasFocus()`) and sets suppression with a *reason* (`'inline'`, `'panel'`); core keeps a `Map<key, Set<reason>>` so the bell store clearing its reason cannot unhide an inline-suppressed card, and vice versa.

### S7. Duplicate request identity between host and local projections (decision #27.1)
- Latent until B2a, but the key format is spread through A1/A2/A6/A7 and must be fixed in the fix round. See contract 1.

### S8. Host-origin rows and surfaceMode cannot be opened (decision #27.2)
- File: `chat-attention-host-message-handler.service.ts:139-149,193-195`; `schemas.ts` `AttentionTargetSchema`. See contract 2. Until then AC32 and AC5 (multi-workspace Open from host) are unmet.

### S9. Dispatcher and snapshot catch sites raise the degradation audit
- File: `chat-attention-action-dispatcher.service.ts:40`, `chat-attention-host-message-handler.service.ts:97` (+2, baseline must not rise).
- Fix: dispatcher: `catch (error) { return this.reportActionFailure(live, error); }` where `reportActionFailure` classifies by `error instanceof Error ? error.name : 'unknown'` (name only, no message/path), logs it, raises the notice and returns the method's own result (not a literal). Handler `fetchSnapshot`: return a discriminated `{ kind: 'unavailable' | 'invalid' | 'ok' }` (or rethrow into `reconcile`, which owns the retry policy from "Snapshot failure never retried") so the catch is a real handler, not a sentinel.

## Moderate and minor issues

Moderate

1. `chat-attention-host-message-handler.service.ts:155-159` - resolve only on equal generation leaves orphans; use `>=`.
2. `:53,89-99` - no retry after a failed snapshot.
3. `schemas.ts` (`AttentionNoticeSchema.title` max 120) - one over-long title discards the notice; truncate renderer-side (`z.string().min(1).transform(s => s.slice(0,120))`) or reject only in host tests.
4. `:189` - target mismatch is logged but not surfaced; show the same status message used elsewhere.
5. `:66-69,157,generationFloor` and `chat-attention-source.service.ts:97` (`generations`), `agent-permission-responder.ts` (`answeredRequestIds`), `notification-announcer.component.ts` (`announced`) - per-request maps never pruned; bound or prune on resolve.
6. `notification.service.ts:86-105` - `info`/`success` entries are never removed after their clock expires; entries grow and `entries().find` scans them. Remove expired non-recent transients, or reject those kinds (decision #12: they are local-only).
7. `notification-announcer.component.ts:20-31` - successive items in one flush overwrite the same signal (all but the last lost); an identical message to the previous one is not re-announced by screen readers (same string, no DOM change). Queue messages and append a zero-width counter or clear-then-set.
8. `notification-center.component.ts:65-69` - dead X on Needs you rows (see question 2); remove it there (design-spec :100 limits Dismiss to presentation or dismissible history).
9. `notification.service.ts:94-105` - hidden (Clear-all) Recent notices still count toward the 75 cap; evict hidden ones first.
10. `chat-attention-source.service.ts:63-72` - every run re-upserts unchanged items (churn, covered by B2's equality skip).

Minor

11. `notification-center.store.ts:65-67` - `isSubmitting` reads a plain `Set`; the disabled state is not reactive under OnPush (double-click guard in `activate` still holds).
12. `notification-center.types.ts` and `index.ts:6-8` - dead `CompletionNotification*` types remain exported; delete with the ledger.
13. `permission-handler.service.ts:431,569` - the new "not pending" early return gives other callers no signal; return a boolean.
14. `chat-attention-action-dispatcher.service.ts:26` - missing router returns `false` silently (see S3 outcome type).

## The two failing chat specs: code or spec wrong?

The specs are wrong; the handler is behaving as designed.

- Cause: the handler constructor schedules `queueMicrotask(() => void this.reconcile())` (`chat-attention-host-message-handler.service.ts:53`) and the spec default RPC mock returns `{ notices: [notice] }` (`...spec.ts:26`). Jest yields to the microtask queue between `beforeEach` and the test body, so the bootstrap reconcile has already upserted `host-request-1` once before the first assertion.
- "drops private or malformed push payloads" (spec :64): `upsert` was called once by the bootstrap reconcile, not by the dropped payload.
- "resolves only the matching generation..." (spec :74): the 2 calls are bootstrap + the first push (equal generation upserts are idempotent by design; the third, post-resolve upsert is correctly blocked by `generationFloor`).
- Fix: in the spec `beforeEach`, default `call` to `{ notices: [] }`, `await` one macrotask after `TestBed.inject`, and `upsert.mockClear()`; keep `[notice]` only in the bootstrap test. No code change.

## Data flow

1. Backend request -> renderer `PermissionHandlerService` signals -> chat source effect: B2 (self-triggering), B1 (path drop).
2. Source -> `NotificationService.upsert`: generation guard OK, dedupe by key OK (only within one source), sound once per lifecycle OK.
3. Host push -> `AttentionChangedPayloadSchema.safeParse` OK -> handler -> `upsert` (different key space, S7).
4. Reveal/focus -> snapshot -> revision guard against concurrent pushes OK; failure path S/Moderate 2.
5. Bell/snackbar -> `store.activate`/`dispatch` -> dispatcher -> responder: stale generation check OK, in-flight guard OK, silent `false` outcomes (S3), host Open dead (S2).
6. Answer -> `handlePermissionResponse` posts before mutating (OK) -> pending signal clears -> source resolves -> presentations removed OK.
7. Clear all -> `clearAll` touches only `failure`/`warning` kinds (matches decision #16, OK).
8. Sound: `soundCue` -> effect -> `playBurst` (replay, no root instance).

Privacy: wire payload carries ids, kind, truncated session title (allowed by #21), no question/args/errors; log calls use fixed strings; dispatcher failure notice text is fixed. OK. Local titles use tool name only (AC16).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| AC1 one row + snackbar unless focused/visible | PARTIAL | no focus/visibility suppression (S6); duplicates once host lands (S7) |
| AC2 resolve by identity everywhere | PARTIAL | host orphan (Moderate 1) |
| AC4 duplicate event updates in place | PARTIAL | within one source only |
| AC5 multi-workspace Open | PARTIAL | host rows (S2, S8) |
| AC6/7 bell order, Clear all (#16 reading) | COMPLETE | matches `notification.service.ts:140-149`; counts depend on B1 |
| AC8 no finished notices | COMPLETE | no producer remains; but pulses leak (S1) |
| AC9/22 failures | MISSING | no turn/lane failure projection |
| AC12/31 voice | PARTIAL | sound guard present (source `soundEligible`), voice failure item is C1 |
| AC17/18 keyboard, announcements | PARTIAL | Moderate 7; shell open (S4) |
| AC23 unroutable/surfaceMode/multi-tab fixture | PARTIAL | unroutable dropped (B1) |
| AC24 max three + "+N more" | PARTIAL | "+N more" self-closes (S4) |
| AC31 sound gates | PARTIAL | cooldown, gate, mute kept; replay and no root instance (S5) |
| AC32 surfaceMode Open | MISSING | contract 2 |

Implicit requirements not addressed: pulse drain, bounded per-request state, root sound instance, retry of host snapshot.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Same request id re-issued | YES | new generation | key churn if owner path changes |
| Two attached tabs, one request | YES | one key per request id | key includes path today |
| Answer elsewhere while bell open | YES | resolve + signals | none |
| postMessage throws | YES | pending retained, guard rolled back | none |
| Ownerless request | NO | silently dropped | B1 |
| Request resolved within 350 ms burst | NO | sound still plays | Minor; check pending before play |
| Host restart (generations reset) | PARTIAL | floor only blocks `<=` for same key | floors never pruned |
| Hidden webview, notice via host only | PARTIAL | host row, Open dead | S2 |
| Panel open while new request arrives | YES | suppressed, announced once | none |

## Contracts for decision #27 (to implement in the fix round and B3a)

### Contract 1: one request key, one merge rule

- Key: `requestKey = "<kind>:<requestId>"`, `kind` in `permission | question | lane-permission` (the existing wire kinds), no workspace in the key. `requestId` is used verbatim when it matches `^[A-Za-z0-9._-]{1,200}$` (all current producers use `uuidv4`; `generateRequestId` in `permission-description.ts:182`), otherwise `"x-" + base64url(utf8(requestId))` truncated to 200 chars with a 8-char hash suffix. Result matches the A6 `AttentionIdSchema` (`[A-Za-z0-9._:-]`, max 256) and never carries a path or a slash. Workspace becomes metadata (`workspacePath`, possibly `''`), never identity; this also fixes the late-binding key churn and B1.
- Single definition in `libs/shared` (`attentionRequestKey(kind, requestId)`), imported by the B3a host coordinator, the A6 schema tests, the renderer source and the handler. Remove the JSON-array form from core; keep `attentionConditionKey` for local-only conditions but prefix it `c:` so it can never collide with `kind:` keys and never crosses the wire.
- Merge: `NotificationService` stores per-key `sources: Map<'chat' | 'host', AttentionItem>`; the presented item is `chat` when present, else `host`. `upsert`/`resolve` take the item's `source`; generations are compared only within the same source. The entry is removed only when every source has resolved it (so a closed local tab leaves the host projection visible, and a missed host resolve cannot hide a live local request). Host-source `resolve(key, generation)` uses `>=`.
- Counting and dispatch: badge counts distinct keys. `dispatch` resolves the actor by presented source (chat -> source map, host -> Open only via focus router, honouring S2).
- Tests: a unit spec that upserts the same key from both sources and asserts one row/one sound/one announcement, then resolves each source in both orders.

### Contract 2: owner resolution without paths

- `workspaceId` (wire, opaque): `ws-` + 53-bit FNV-1a of the normalized (case-folded on Windows, trailing-slash-stripped) workspace root, base-36, defined once in `libs/shared` as `workspaceIdFromPath(path)`. It contains no path text, passes `AttentionIdSchema`, and is computable synchronously on both sides. The renderer builds `workspaceId -> path` from `TabManagerService` partition keys plus `VSCodeService.config().workspaceRoot` and resolves Open without searching tabs; an unknown id yields the existing "Target unavailable" disabled row. `sessionId`/`tabId` stay as secondary resolvers (already used by `localWorkspace`).
- surfaceMode: keep `surfaceMode?: boolean` and add optional `surfaceKind?: 'setup-wizard' | 'harness-builder' | 'mcp-apps'` (host sets it from the surface that started the session; strict enum, so no free text on the wire). The renderer resolves the actual owner through its own conversation-to-surface binding (`chat-routing` `TabSessionBinding`/surface registry, keyed by `sessionId`) and a new `SURFACE_FOCUS_ROUTER` multi-token that each surface component registers (`focus(sessionId): Promise<NotificationFocusResult>`). Open is enabled iff a router for the kind is registered and the binding resolves; otherwise it stays disabled with "Answer in <label of surfaceKind>". Because no surface id is invented by the host, there is no host/renderer ID drift to maintain.
- Wire change: `AttentionTargetSchema` gains `surfaceKind` (optional, enum); `workspaceId` regex unchanged. Both ship in B3a alongside the coordinator; A6 specs get a canary that a path-like `workspaceId` still fails validation.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH on B1, S1-S5 (read directly); MEDIUM on B2 (Angular effect semantics, needs an unmocked spec to confirm)
- Top risk: a real permission or question can be invisible in the bell (B1) while the backend waits on it, and the specs cannot see it because they mock the model.
- What a robust implementation would add: path-free request identity and a two-source merge in core; an unmocked integration spec (source + real `NotificationService` + bell) covering unmatched owner, `workspacePath: null`, duplicate host+local, answer-elsewhere and Clear all; failed-turn and lane-failure projection that drains terminal pulses; typed dispatcher outcomes surfaced as short status text; per-reason snackbar suppression including focused-visible; a typed bell API instead of `querySelector` and `aria-expanded` observation; sound sequence tracking with a root-level instance; bounded retry for the host snapshot; pruning of per-request maps; fix the two chat specs by clearing the bootstrap reconcile.


## Re-review after fix round

Scope: F1 and F2 changes, read in full (core `notification.service.ts`, shared `attention-identity.ts`/`schemas.ts`, chat source, failed-turn, dispatcher and host handler services, bell store, sound service, announcer, snackbar, both shells' diffs). No tests were run (a scoped check is in flight). Not re-read line by line: `agent-permission-responder.ts` pruning and `permission-handler.service.ts` boolean return (Moderate 5 part, Minor 13); those rest on the F1 report and the spec names.

**Verdict: APPROVED.** No Blocking and no Serious defect remains, apart from S8's already-accepted gap (decision #30). The fix round introduced three Moderate and two Minor defects, none of which blocks the Phase A commit; N1-N3 should be fixed before B3a builds on this.

### Findings status

| Finding | Status | Evidence |
| --- | --- | --- |
| B1 ownerless items | FIXED | `chat-attention-source.service.ts:118,130,132,135` keeps `workspacePath ''`, Open disabled with a reason; core `upsert` (`notification.service.ts:71-72`) no longer rejects empty paths; spec `:106` uses the real `NotificationService` and asserts badge 1 and Open disabled. |
| B2 read/write cycle | FIXED | The effect only tracks the listed signals and calls `reconcile()` inside `untracked` (`:43-52`); suppression refresh is also untracked (`:34`). The real-service spec (`:106`, `tabs.set` re-tick) would hang or inflate counts on a loop. See N1: the "skip unchanged" part of the claim is not true for chat items, but it is no longer a loop. |
| S1 failed turns | FIXED, see N2 | `chat-failed-turn-attention.service.ts:23-40` drains via `takeTerminalTurnPulses` (set to `[]` once, effect re-runs once on empty), keeps only `classification === 'error'`, builds a `c:` key, fixed text plus session title; `lastAssistantMessage`, `terminalReason` and raw reasons are never copied; no "Finished". |
| S2 host Open | FIXED | dispatcher `:37-40` routes non-live `open` to `host.openProjected`, which re-checks the snapshot (`host:61-67`, `openIfPending`). |
| S3 Allow/Deny inert | FIXED | disabled reasons in `chat-attention-source.service.ts:133-135`; store and snackbar show status and disable the button (`store:98-105`, `snackbar:177-187`). |
| S4 "+N more" | FIXED | `stopPropagation()` then `openNotifications.emit()` (`snackbar:76`) goes to a typed `bell.openPanel()` (both shells); `openPanel` is idempotent (`notification-center.component.ts:159-160`), and the bell document-click handler never sees the click. App shell queues the open if the bell is not yet built. |
| S5 sound | FIXED | `notification-sound.service.ts:25-33`: sequence-tracked, existing cue ignored at construction, mute read inside `untracked(playBurst)`, so unmute cannot replay. Both shells inject the root service, and the bell injects the same root instance. |
| S6 suppression | FIXED | `suppressed` is a per-key set of reasons (`notification.service.ts:31,179-187`); chat clears the `inline` reason before resolving (`chat-attention-source.service.ts:83`), and core resolve deletes the whole entry when all sources are gone (`:146`). Refreshed on tab, visibility, focus and blur events. No stuck path found. |
| S7 identity/merge | FIXED | `attentionRequestKey(kind, id)` is the only request-key constructor (grep: chat source, host handler, specs; core re-exports it). Output matches `AttentionIdSchema` (<=214 chars, charset). Core keeps per-source entries, chat is presented over host (`:79,131`), generations compare within a source (`:76`), resolve is source-scoped and removes the entry only when no source remains (`:130-138`). |
| S8 surface/host routing | PARTIAL by decision #30 | Wire `surfaceKind`, path-free `workspaceId`, host target validation and `SURFACE_FOCUS_ROUTER` exist. Surface router registration and tab-less owner mapping (`host:192-203`) are the only remaining gap, deferred to A8. Open stays disabled with a reason, never inert. |
| S9 catch sites | FIXED | `error.name` only: dispatcher `:80`, host `:118` and `focusFailure`; no error object or message is logged or stored. See N4 for the snackbar catch. |
| Moderate 1 newer resolve | FIXED | `host:186` only ignores a resolve older than the projection. |
| Moderate 2 snapshot retry | FIXED, see N3 | `host:132-135`. |
| Moderate 3 long title | FIXED | `schemas.ts:34` truncates after validation (a `slice` can split a surrogate pair; cosmetic). |
| Moderate 4 mismatch status | FIXED | `openIfPending` sets a status and logs a fixed line. |
| Moderate 5 growth | FIXED (core/host verified; responder prune per report) | single `generationSequence` (`:31,126`), `generationFloor` capped at 256 (`host:82`), targets removed on resolve (`host:188`). |
| Moderate 6, 9 core transient/eviction | FIXED | `notification.service.ts:73` rejects info/success; `:100-113` evicts hidden Recent first and cleans clocks, `dismissed`, `sources`. |
| Moderate 7 announcer | FIXED | prunes `announced` each run, single released timer, queue capped at 100 (`notification-announcer.component.ts:26,29-37`). |
| Moderate 8 inert X | FIXED per report | not re-read in the template. |
| Moderate 10 effect churn | PARTIAL | no loop, but see N1. |
| Minor 11 | FIXED | `submitting` is a signal (`store:70-72,91`). |
| Minor 12 | FIXED per report | no consumers found. |
| Minor 13 | FIXED per report | not re-read. |
| Minor 14 | FIXED | `AttentionActionOutcome` consumed by store and snackbar. |
| Wrong specs | FIXED | specs changed in this round (`notification-sound.service.spec.ts`, `chat-attention-source.service.spec.ts`) replaced direct `playBurst` calls with cue-driven ones; no assertion weakened in the files read. |

### New defects introduced by the fix round

**Moderate**

- **N1. Unchanged-item skip does not work for chat items; every reconcile rewrites the model.** `chat-attention-source.service.ts:87-92` clears `live` and then reads `this.live.get(key)` for `previous`, so `previous` is always `undefined` and the `JSON.stringify` comparison is dead code: every reconcile calls `notifications.upsert`. In core, the equality guard (`notification.service.ts:95-96`) compares fields with `Object.is`, and `actions` is a fresh array on every reconcile, so it never matches. Each tabs/permission/visible-tab signal change (tabs change during streaming) therefore does `entries.set`, `touch()` and `scheduleExpiry()`, re-rendering bell, snackbar and announcer for no change. Not a loop (the effect is untracked), but it is the cost pattern B2/Moderate 10 asked to remove. Fix: capture `previous` before `live.clear()` (or diff against the old map), and compare `actions` structurally.
- **N2. A user-stopped turn becomes "Session failed: <title>".** `tab-manager.service.ts:1927-1930` classifies every idle/failed pulse whose `terminalReason !== 'completed'` as `error`, including `aborted_streaming` and `aborted_tools` (the old ledger gave those a distinct label, `git show HEAD:libs/frontend/notification-center/src/lib/notification-ledger.service.ts` lines 83-84). `chat-failed-turn-attention.service.ts:25` projects all of them as severity `error` with an assertive announcement and an 8s snackbar. Pressing Stop will raise a failure alert. Fix: project only `phase === 'failed'` or non-aborted reasons, and add a spec for an aborted pulse.
- **N3. Snapshot retry is unbounded.** `chat-attention-host-message-handler.service.ts:130-135` retries every 2s forever on any `null` (RPC missing, host not ready, 5s timeout), logging a warning each time. On a host that lacks `attention:getSnapshot` (until B2a lands) this is a permanent 2s poll plus log noise. Fix: capped exponential backoff and a stop after a few failures (focus/visibility already re-trigger a reconcile).

**Minor**

- **N4.** `notification-snackbar.component.ts` dispatch `catch` is comment-only and sets no status, so a thrown dispatcher or router error shows nothing in the snackbar (the bell path reports one). Electron's `openNotifications()` silently does nothing when the bell is not mounted, unlike the app shell's pending-open path.
- **N5.** `ChatFailedTurnAttentionService` only drains when `MODEL_REFRESH_CONTROL` is provided (`:11-13`); where it is absent, terminal pulses (including `lastAssistantMessage`) are never taken. F2 recorded this as production-supplied; confirm for the Electron and CLI webview roots when the host batches wire them.

### Remaining gap for S8 (accepted, decision #30)

Only the two deferred items: surface components do not yet register `SURFACE_FOCUS_ROUTER`, and tab-less partition keys cannot be mapped to an owner (`host:192-203`). Until A8 those rows show Open disabled with a reason. Nothing else blocks S8.

### Open items

1. N1 (Moderate): dead dedupe and array identity defeat the core skip.
2. N2 (Moderate): aborted turns announced as failures.
3. N3 (Moderate): unbounded 2s snapshot retry.
4. N4, N5 (Minor).
5. S8 remainder, owned by A8.

## Review of bounded correction (N1-N5)

Review family: reviewer anthropic, implementer codex. Static read only; no test, tsc, lint or nx was run.

| Defect | Status | Evidence |
| --- | --- | --- |
| N1 chat dedupe dead | FIXED | `chat-attention-source.service.ts:81` snapshots `previousLive` before `live.clear()` (`:88`), compare at `:90-92`. `add()` still reads the old `live` for generation (`:122`), valid because `clear()` runs after the loop. Spec `chat-attention-source.service.spec.ts:117-121` uses the real model and asserts no `upsert` and the same item identity after a tabs re-emit. |
| N1 core action identity | FIXED | `notification.service.ts:95-99` compares `actions` by length, id, label and disabledReason. Spec per report `notification.service.spec.ts:62-71`. |
| N2 Stop shown as failure | FIXED | `chat-failed-turn-attention.service.ts:23-24` skips non-error, and non-failed phase with null or `aborted_*` reason. Spec `:29-42` feeds both aborted reasons plus a real failure and asserts exactly one notice and no private text. |
| N3 unbounded retry | FIXED | `chat-attention-host-message-handler.service.ts:137-148` gives 2/4/8/16s delays, stops at 5, warns once with fixed text. Reset on success (`:150`) and on visible focus or visibility (`:49-53`). Error text is not logged (`:123-125`). Spec `:124-146` asserts 5 calls, no more after 60s, one exhaustion warning, renewed call on focus. |
| N4 snackbar catch, Electron bell | FIXED | `notification-snackbar.component.ts:196-198` sets the fixed `Action unavailable` status using the same `key:generation` id as `request` (`:180`). `electron-shell.component.ts:406-414` queues the open and switches to chat; effect `:446-454` clears the flag before `openPanel()`, so it drains once and cannot double-open. |
| N5 MODEL_REFRESH_CONTROL | CONFIRMED | `apps/ptah-extension-webview/src/app/app.config.ts:315` spreads `provideModelRefreshControl()`, which provides the token at `model-refresh-control.provider.ts:27`. Electron reuses the webview build, per the report. The CLI has no Angular webview, so no hole. |

### New defects (none Blocking or Serious)

- **Minor** `chat-attention-host-message-handler.service.ts:164`: a queued `reconcileAgain` after a failure re-runs at once, bypassing the backoff. The failure counter can reach 5 while a retry timer is still pending (`:141-147`), and the timer then fires one 6th attempt. The cap leaks by at most one call; no loop and no timer leak (cleared on destroy `:61`, success `:151`, reveal `:51`).
- **Minor** `notification.service.ts:95`: the equality guard iterates `Object.keys(presented)` only. A field that disappears from a newer item (optional key absent, not `undefined`) is treated as equal. Current producers always set their keys, so there is no live bug.
- **Minor** `electron-shell.notification-center.spec.ts:25-28`: the pending-open fix is asserted by source-string match, not behaviour. It would not catch a wiring regression. Pre-existing pattern in this spec, so acceptable.
- **Observation** `chat-failed-turn-attention.service.ts:23-24`: `idle` with a null terminal reason is now silent, and `failed` with an aborted reason still alerts. Both are defensible.

No assertion was weakened in the specs read. Reasons N1-N5 do not introduce stale state, timer leaks, a non-resetting backoff, missed aborted reasons, raw error text, or an undrained or double pending-open.

Verdict: APPROVED
