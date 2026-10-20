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

## Phase B review

Review family: reviewer anthropic (Sonnet 5.5), implementer codex lanes (one orchestrator edit). Scope: uncommitted Phase B tree, read in full for the coordinator, ports, three adapters, ingress, RPC handler/schema, DI attach sites and B3c resolution hooks. Nothing was executed (no nx/jest/tsc); spec findings are by reading.

Score: 6/10. Verdict: REVISE. Blocking 0, Serious 3, Moderate 10, Minor 5.

### Five questions (Phase B)

1. Silent failure: MCP approval requests are claimed by the coordinator but dropped without a notice (S1); `notifications.failureHostEnabled` can be turned on and nothing ever fires (S2); an Electron click is lost after the window closes (M2/M3).
2. Unexpected user action: clicking a stale VS Code notification does nothing instead of revealing the session and saying "Already answered" (M1); clicking a grouped Electron toast opens only the first member (M5).
3. Wrong-answer input: a request with no metadata record in a multi-workspace Electron app gets the active workspace's id (M6); surfaceMode requests never carry `surfaceKind`, so host Open is always disabled (M7).
4. Dependency failure: coordinator/observer/host errors are swallowed and logged by name only (good); a DI resolution failure of the coordinator aborts boot on all three hosts (M9).
5. Missing: no producer for failure notices, no MCP wiring, no race test for resolve-during-title-lookup.

### Checks that passed (evidence)

- Privacy: `SafeHostAttentionNotice` is whitelist-typed (host-attention-notifications.interface.ts:11-32); the coordinator builds it only from fixed labels, a truncated title (host-attention-coordinator.ts:226-230) and hashed ids; all logs use `errorName` only (:232). The canary spec asserts it. The title in host text is plan-mandated (decision #21, plan section 3) and overrides the older AC text at task-description:99.
- Race: `resolve` deletes the generation, and `issueRequest` re-checks `generations.get(key)` before `pending.set` and again in `presentIfCurrent` (coordinator.ts:176,203), so a lookup finishing after resolve cannot resurrect a notice. Request gate (`hostEnabled`, default true) and failure gate (`failureHostEnabled`, default false) are separate (:214).
- Write path (item 3): settings UI -> `settings:set` (guarded by `isFileBasedSettingKey`, settings-rpc.handlers.ts:172-194) -> `workspaceProvider.setConfiguration('ptah', key, v)` -> `PtahFileSettingsManager.set`. The coordinator reads `getConfiguration('ptah', key, default)`, which routes to the same manager in Electron (electron-workspace-provider.ts:95), VS Code (vscode-workspace-provider.ts:80) and CLI (cli-workspace-provider.ts:84). Keys are in `FILE_BASED_SETTINGS_KEYS` (file-settings-keys.ts:478-479). Same key, scope and boolean format on all hosts. Residual: `enabled !== true` treats a non-boolean as off (m1).
- Ingress: VS Code `sendMessage` and `broadcastMessage` each observe once before delivery; broadcast uses the private `sendToWebview`, so no double observe; the observer call is wrapped in try/catch. CLI adapter is the same. Electron observes before the IPC send and is zero-view safe. The census spec is real but regex-based and scans only `libs/backend` (host-attention-ingress.spec.ts:13-50).
- Producer resolution (item 5): SDK permission resolves on response/abort/timeout/dispose/session cleanup/undelivered, because every path calls the wrapped `pending.resolve` (sdk-permission-handler.ts:1253-1257, 1281-1290, 1306, 1347, 1373); ask-user resolves on answer/abort/idle-timeout/dispose through the registry (ask-user-question.service.ts:171-228); the Copilot lane wraps `resolvePermission` and `cleanup` (agent-events.ts:300-325; the bridge blocks until one of those, so there is no timer gap). Generation = `payload.timestamp` in every producer and in the coordinator.
- RPC (item 6): params `{}` strict matches the renderer call (handler service :107); the result reuses `AttentionNoticeSchema`; `INVALID_PARAMS` exists in the code union; the `attention:` prefix is allowlisted (rpc-handler.ts:45). `occurredAt = generation` is request time in ms, acceptable. The renderer compares key+generation+target fields exactly as the host emits them.
- DI (item 7): coordinator deps are all registered before the attach point on each host (VS Code phase-2 after `registerSdkServices`, CLI container.ts:683-690 after storage at :499, Electron bootstrap after WEBVIEW_MANAGER). No cycle found. Electron no-teardown is acceptable: process-lifetime singleton, the OS clears toasts on quit.
- The CLI no-op adapter passes the shared contract (`noOp` branches in run-host-attention-contract.ts).

### Findings

**Serious**

S1. MCP approval path is inert end to end. `protocol-dispatcher.ts:1030-1038` does not pass `hostAttention`, so the B3c resolve hook in approval-prompt.handler.ts:65-72 never exists in production (known gap confirmed). In addition `createRequest` builds a request with no sessionId/tabId (permission-prompt.service.ts:107-114), so `issueRequest` returns at host-attention-coordinator.ts:158 after `claim()` already stored the generation: no host notice, no snapshot row, and a permanent `generations` entry. `removePendingResolver` (permission-prompt.service.ts:159) has no production caller, so it adds no further leak. Fix: pass the coordinator into the dispatcher deps; decide how MCP requests get a target (workspace root plus a synthetic session) or have the coordinator skip claiming them and document them as in-app only; add a dispatcher-level spec; extend the census to assert the resolve wiring.

S2. Failure host path has no producer. `presentFailure` (coordinator.ts:123) has zero callers outside its spec, so `notifications.failureHostEnabled` (advanced-settings.types.ts:513) is a shipped toggle that does nothing; the AC 22 host half is unmet. If a later phase owns it, hide or label the setting until then. Also `c:` generations are never released (claim at :188 only), so each distinct condition leaks one map entry for the process lifetime.

S3. Unbounded and stuck coordinator state. `generations` and `pending` shrink only via `resolve`; a request whose issue bails early (:158) or a producer without a resolve hook (S1) leaves entries, and for `pending` a permanent snapshot row the renderer re-projects on every reveal. Fix: delete the generation when `issueRequest` bails, add a TTL sweep for entries older than the longest permission timeout, release failure keys after presentation.

**Moderate**

M1. VS Code stale click is a silent no-op (vscode-host-attention-notifications.ts:62-65). The AC and plan section 4 require reveal plus "Already answered". Because the host returns before routing, the renderer's own "Already answered" path (openIfPending) is never reached.
M2. Electron `onRendererReady` registers `once('did-finish-load')` on `getMainWindow()?` (bootstrap.ts attention block). With a null window (macOS closed window) nothing is registered but `waitingForRenderer` stays true forever (electron-host-attention-notifications.ts:84-88), so no later click can queue. `did-finish-load` also fires before Angular registers its message handler, so a route sent then can be dropped.
M3. Electron `open` after the window was destroyed does nothing: `revealWindow` no-ops on a null window and nothing recreates it. Same root as M2; fix together (resolve the window at click time, reset `waitingForRenderer` on failure).
M4. Electron `sendMessage`/`broadcastMessage` call the observer without try/catch (webview-manager-adapter.ts:61,99), unlike VS Code and CLI; the contract says observer errors must not break delivery.
M5. Burst grouping is not a summary. Electron members share the first notice's handle and body (electron-host-attention-notifications.ts:52-57), so later requests are invisible natively and a click opens only the first target; VS Code has no grouping at all. AC 26 and the plan want one grouped summary.
M6. The workspace target falls back to `getWorkspaceRoot()` when no metadata record exists (coordinator.ts:151). In Electron with several workspaces this can mis-target; prefer a null target (renderer shows "Target unavailable") over a wrong one.
M7. `surfaceKind` is never populated (coordinator.ts:160-164) but the renderer routes surfaceMode only by `surfaceKind` (handler service upsertProjection), so host rows for surfaceMode requests are always disabled; AC:72 expects focus when the owner is known.
M8. The snapshot is all-or-nothing: one notice failing `AttentionNoticeSchema` (id regex/length) makes `parse` throw and the whole snapshot unavailable (attention-rpc.handlers.ts:60). Validate per notice and skip with a count-only log.
M9. Coordinator resolution at boot is unguarded and fatal: VS Code phase-2-libraries.ts:182-184, CLI container.ts:685, Electron bootstrap.ts (catch rethrows). A notification wiring fault should degrade, not abort activation.
M10 (specs). The coordinator spec has no lane-permission case (`metadata.getAll` stubbed to `[]`), no resolve-during-lookup race and no `c:` hashing assertion beyond the prefix; the Electron bootstrap and CLI container attach are untested; the census scans `libs/backend` only and does not check resolve wiring.

**Minor**

m1. `enabled !== true` (coordinator.ts:215) silently disables on a non-boolean stored value (for example a hand-edited string).
m2. The title is not stripped of control characters/newlines before the native body (coordinator.ts:226-230); 80 code points can exceed the shared schema's 120 UTF-16 slice and cut a surrogate pair.
m3. VS Code eligibility ignores window focus/minimize: a visible but unfocused Ptah sidebar suppresses the notice (matches the AC text, flagged as a product risk).
m4. VS Code `queueAttentionOpen` posts to the sidebar and every panel, so the renderer may process the same route twice (angular-webview.provider.ts:68-77); harmless because `openIfPending` is guarded.
m5. Snapshot failure is a plain `Error` (attention-rpc.handlers.ts:70) rather than a coded error; acceptable because it is not user-facing.

### Fix list (at most 3 file-disjoint lanes)

Lane 1, agent-sdk + vscode-lm-tools (S1, S2 key release, S3, M6, M7, M10 coordinator cases, m1, m2): host-attention-coordinator.ts and spec, protocol-dispatcher.ts, approval-prompt.handler.ts and spec, permission-prompt.service.ts if needed.
Lane 2, host adapters and boot (M1, M2, M3, M4, M5, M9, m4): electron-host-attention-notifications.ts and spec, vscode-host-attention-notifications.ts and spec, webview-manager-adapter.ts, bootstrap.ts, phase-2-libraries.ts, cli-engine container.ts, angular-webview.provider.ts.
Lane 3, rpc-handlers + settings (M8, S2 UI decision): attention-rpc.handlers.ts and spec, advanced-settings.types.ts (hide or label `failureHostEnabled` until a producer exists) with its two guard specs.

## Re-review after Phase B fix round

Reviewer: anthropic (Sonnet 5.5). Read in full: host-attention-coordinator.ts, the VS Code and Electron host adapters, the three boot attach sites, attention-rpc.handlers.ts, the sdk-message-transformer.ts hunks, the dispatcher and permission-prompt hunks, and the F1-F3 reports. Nothing executed. Score 7/10. Verdict: REVISE (0 Blocking, 2 Serious, 4 Moderate, 3 Minor), one short round 2.

### Status of Phase B findings

| Finding | Status | Evidence |
| --- | --- | --- |
| S1 MCP inert | FIXED by decision (in-app only); resolver plumbing left as dead code | coordinator.ts:102-103 skips owner-less requests before `claim`, so no generation leaks. Resolver is wired (protocol-dispatcher.ts:1036, http-mcp-server.service.ts:310, permission-prompt.service.ts:162) but can never match a key |
| S2 failure producer | PARTIAL: SDK turn producer exists; CLI lane producer absent; SDK predicate wrong (N1, N2) | sdk-message-transformer.ts:327-337; agent-process-manager.service.ts:2332-2350 untouched |
| S3 unbounded state | FIXED | coordinator.ts:173-188 (256 cap, 2h lazy TTL, `drop` resolves host). SDK timeouts are 60 s to 10 min (sdk-permission-handler.ts:90,115; ask-user service :29), so a 2h TTL never expires a live SDK request |
| M1 stale VS Code click | FIXED | vscode-host-attention-notifications.ts:67-74 |
| M2 / M3 Electron readiness, destroyed window | PARTIAL | bootstrap.ts:250-255 returns false on a null window and the adapter clears `waitingForRenderer` (adapter:121-135); still `once('did-finish-load')`, which can fire before Angular listens (N5) |
| M4 Electron observer try/catch | FIXED | webview-manager-adapter.ts:62,104 |
| M5 burst summary | FIXED on Electron; VS Code accepted (c) | electron adapter:58-83 replaces the handle, click picks newest live member; VS Code earlier messages cannot be retracted (:49-60) |
| M6 wrong workspace | FIXED, but silent (N3) | coordinator.ts:217-222 |
| M7 `surfaceKind` | DEFERRED to A8 (decision #36 calls this "M10"; the review's M10 is the spec item) | n/a |
| M8 per-notice snapshot | FIXED | attention-rpc.handlers.ts:47-78: invalid notices dropped, count-only log, coded failure |
| M9 boot isolation | FIXED, logged by error name (not silent); unverified, no specs | phase-2-libraries.ts:182-189, container.ts:684-696, bootstrap.ts:459-465 |
| M10 specs | PARTIAL | coordinator, adapter, RPC specs and a census resolve check added; boot attach-failure specs and a failure-reason matrix spec missing |
| m1 non-boolean setting, m2 title sanitising | FIXED | coordinator.ts:277, 284-293 |
| m3 unfocused sidebar | ACCEPTED (plan section 4) | n/a |
| Open routing to one webview, coded snapshot error | FIXED | F2 and F3 reports; handlers.ts:77 |

### Judgement of lane decisions

- (a) MCP approvals in-app only: ACCEPTED. task-description.md names chat permission, question and lane permission as pending requests (:11, :70, :82-84); MCP approval is not an AC item and has no session or tab, so no honest Open target exists. Record it in decisions.md as a known limit: an MCP approval raised while Ptah is in the background gets no OS notice.
- (b) Drop on missing metadata: ACCEPTED in principle (a wrong workspace is worse than none), but the drop is silent (N3).
- (c) VS Code burst not retractable: ACCEPTED. Cost is stacked messages in the notification center; each still routes to the newest live member, stale ones say "Already answered".

### New findings

**Serious**

N1. The session failure predicate disagrees with the AC. sdk-message-transformer.ts:332-335 fires for `phase === 'failed' || (terminalReason && terminalReason !== 'completed')`. That includes `background_requested`, `hook_stopped`, `stop_hook_prevented`, `tool_deferred`, `tool_deferred_unavailable` and `max_turns`, which task-description.md:72 lists as non-failures; only `aborted_*` is excluded. With `failureHostEnabled` on, a normal background-task or deferred-tool turn yields "Session failed". The renderer also requires `classification === 'error'` (chat-failed-turn-attention.service.ts:23-24), so host and bell disagree. Fix: allowlist the AC's failure reasons (`api_error`, `model_error`, `image_error`, `budget_exhausted`, `blocking_limit`, `rapid_refill_breaker`, `prompt_too_long`, `turn_setup_failed`, `malformed_tool_use_exhausted`, `structured_output_retry_exhausted`) plus `phase === 'failed'`; put it in a pure function next to the coordinator and cover it with a table spec.

N2. The CLI lane failure host notice has no producer (agent-process-manager.service.ts:2332-2350). task-description.md:86 requires it when the setting is on, and decision #36 promised a producer. Fix: inject the coordinator optionally into AgentProcessManager and call `presentFailure('lane:<agentId>', Date.now(), 'lane', target)` on the failed-exit branch, deriving the target from the parent session metadata (same `cliSessions` lookup); if none is resolvable, skip with a count-only debug log. If the owner defers it, record that in decisions.md and relabel the setting instead.

**Moderate**

N3. Silent drops. coordinator.ts:219-222 returns with no log when metadata is missing (first permission of a fresh session, or tab-only requests where `metadata.get(tabId)` cannot resolve), and presentSessionFailure returns silently at :153. Add a fixed count-only log line.
N4. No spec for boot attach failure on any host (F2 not-done confirmed), none for the failure-reason table (N1), and none for the release-vs-present race at coordinator.ts:149-152.
N5. Electron `did-finish-load` (bootstrap.ts:253) and `isRendererReady` (:246-249) signal page load, not Angular handler registration, so a queued route can still be dropped on cold start. A listener attached to a window destroyed before load never fires and leaves `waitingForRenderer` true (adapter:121-135). Use the renderer's existing ready handshake or resend via the snapshot call, and re-arm on `closed`.
N6. SDK session close never releases the `c:turn:` key (F1 confirmed). Bounded: the native toast stays until the next turn, the 2h TTL or the 256 cap. The cap evicts the oldest key regardless of kind (coordinator.ts:178-182) and can drop a live request's snapshot row, though that needs more than 256 concurrent keys. Evict failure keys first.

**Minor**

N7. issueFailure catch (coordinator.ts:261-263) does not `drop(key)`, unlike issueRequest, so a failed title read keeps the generation until TTL.
N8. The Electron summary body count goes stale when a member resolves while others share the handle (adapter:158 refuses to close, text is not updated).
N9. The MCP resolver plumbing in three files is dead; remove it or annotate it as intentionally inert so nobody assumes MCP is covered.

### Verdict

REVISE, small. Privacy, race, TTL and release mechanics are sound: lazy TTL runs on observe and snapshot, eviction resolves the host presentation, the release-version guard handles release during the metadata await, aborted reasons are excluded, snapshot validation is per notice, boot isolation logs by name. What remains is the over-broad failure predicate (N1) and the missing lane producer (N2).

### Revise round 2 fix list (two file-disjoint lanes)

Lane 1, agent-sdk and cli-agent-runtime: N1 (reason allowlist function in host-attention-coordinator.ts used from sdk-message-transformer.ts, table spec in host-attention-coordinator.spec.ts), N2 (agent-process-manager.service.ts, its spec, optional coordinator inject), N3 logs, N7, N6 (evict failure keys first in `prune`).
Lane 2, hosts, boot and mcp plumbing: N4 boot attach-failure specs (apps/ptah-electron bootstrap, vscode phase-2-libraries, cli-engine container), N5 Electron readiness (bootstrap.ts, electron-host-attention-notifications.ts and spec), N8, N9 (http-mcp-server.service.ts, protocol-dispatcher.ts, permission-prompt.service.ts, approval-prompt.handler.ts and specs).

## Final re-review after revise round 2

Reviewer: anthropic (Sonnet 5.5). Read in full: host-attention-coordinator.ts, electron-host-attention-notifications.ts, bootstrap.ts:184-305 (readiness handshake and attach helper), the sdk-message-transformer.ts and agent-process-manager.service.ts hunks (including handleExit :2316-2364), the chat failure service and spec diff, the three orchestrator edits, and the vscode-lm-tools diff. Nothing executed. Score 8/10. Verdict: APPROVED (0 Blocking, 0 Serious, 2 Moderate, 3 Minor); commit as is and report the items below.

### Status of N1-N9

| Finding | Status | Evidence |
| --- | --- | --- |
| N1 failure predicate | FIXED | coordinator.ts:38-47 allowlist is exactly the ten AC reasons (task-description.md:72); the transformer calls it at sdk-message-transformer.ts:330-335 with `phase === 'failed'`. `SdkTerminalReason` (sdk-hook.types.ts:66-85) has 19 members; the other nine, including `aborted_*`, `max_turns`, `completed`, are excluded. Spec uses `satisfies Record<SdkTerminalReason, boolean>`, so a new member breaks the type check. Chat renderer uses the same ten (chat-failed-turn-attention.service.ts:5-11, :32), so host and bell agree |
| N2 lane producer | FIXED | agent-process-manager.service.ts:2353 only inside `status === 'running'` and `code !== 0`; stop and timeout set status earlier, so a user-stopped lane never reaches it (spec :1570-1575). Owner comes from `info.parentSessionId` plus that session's metadata (coordinator.ts:178-195); missing owner drops with a fixed debug line. Trailing `isOptional` inject (:335-336) leaves the six other `new AgentProcessManager(...)` specs valid and an unregistered token resolves to undefined |
| N3 silent drops | FIXED | coordinator.ts:166, 180, 186, 256 fixed debug lines, no ids |
| N4 boot attach specs | FIXED | `attachElectronHostAttention` (bootstrap.ts:237-247) is called at the same boot point (:503) and logs by error name; VS Code and CLI helpers follow the same shape. Specs cover the helpers, not the full boot functions (accepted) |
| N5 Electron readiness | FIXED | Readiness is the first `attention:getSnapshot` RPC from the current WebContents (bootstrap.ts:221-230). It is valid because the handler is registered via MESSAGE_HANDLERS before its constructor microtask calls `reconcile()` (chat-attention-host-message-handler.service.ts:60). Channel and shape match the bridge ('rpc' channel, `rpc:call`, payload.method). `did-start-loading` clears readiness (:217). One pending route, generation re-checked at send (adapter :129, :141); no lost or duplicated route; destroyed window returns false from `onReady` and clears the flag (:149) |
| N6 eviction | FIXED | coordinator.ts:213-218 evicts the oldest `c:` key before any request key |
| N7 failure drop | FIXED | coordinator.ts:298-300 drops on a gated-off or failed present, so a later enable retries |
| N8 burst count | FIXED | adapter :100-108 closes the shared handle and re-shows with the remaining count; the last member returns to the single body |
| N9 MCP plumbing | FIXED | No `hostAttention` or resolver references remain under vscode-lm-tools/src; http-mcp-server.service.ts and protocol-dispatcher.ts show no net diff. Ownerless MCP is skipped at coordinator.ts:115 |

### Orchestrator edits

1. vscode-host-attention-notifications.ts:75 `.then(undefined, handler)` is correct for a `Thenable`; :81 `.catch` is on `broadcastMessage`, which returns a real Promise, so it type-checks.
2. The chat failure filter now matches the AC allowlist; the extended spec cases (five non-failure reasons) all fall through to `continue`. By reading, it compiles and passes.
3. host-attention-ingress.spec.ts: exempting only the MCP file path (relative to libs/backend) from the host-release regex is narrow and correct. The remaining four emissions still need `hostAttention?.resolve(attentionRequestKey(` in their file.

### Specs that cannot compile or pass by reading

None found. The new approval-prompt and dispatcher specs use existing module-scope helpers (`createPermissionService`, `buildDeps`, `makeRequest`); only their indentation is off.

### Remaining defects (non-blocking)

- Moderate: electron-host-attention-notifications.ts:100-108. Resolving one member of a shared burst handle re-shows a native toast without re-checking `isEligible()`, so answering one of two requests in a focused window can pop a fresh OS toast. Fix: call `isEligible()` before `showHandle` and only close when not eligible.
- Moderate: sdk-message-transformer.ts:327-335. The result branch has no `isReplayMessage` guard, unlike the user branch (:243). If the SDK replays a failed result on resume, a stale "Session failed" host notice could fire. Not shown to occur; confirm in a resume smoke test.
- Minor: approval-prompt.handler.ts:67-69 wraps `resolve` in a no-op arrow; pass `resolve` directly.
- Minor: coordinator.ts:178-182 lane failure with no `parentSessionId` is dropped with a debug line only. Accepted (a wrong workspace is worse than none), but the setting then silently misses such lanes.
- Minor: session-close still does not release the `c:turn:` key (bounded by the 2h TTL and 256 cap); already accepted in L1's decisions.

### Verdict

APPROVED. The failure-reason table is exhaustive against `SdkTerminalReason`, the user-stopped lane is not a failure, the optional inject is safe, the renderer-ready ordering holds, and the MCP removal left no residue. Commit Phase B as is and carry the two Moderate items into the follow-up list.

## Phase B post-check correction review

Scope: only the post-check correction (decisions.md #38 production edits and the Codex spec and test-container edits in phase-B-check-fix-report.md). Read-only; no checks were run by me, and I rely on the report's per-suite `Tests:` lines for pass status.

| Metric | Value |
| --- | --- |
| Score | 9/10 |
| Verdict | APPROVED |
| Blocking / Serious / Moderate | 0 / 0 / 2 minor |

### 1. Orchestrator production edits

- `resolve()` null narrowing, `electron-host-attention-notifications.ts:100-115`: behaviour is identical. Before, a null `entry.handle` made `shared` null and the `else` branch ran `close(entry)`. Now a null `oldHandle` gives `shared = []`, the `if (oldHandle && shared.length)` is false, and the same `else` runs. With a non-null handle the filter, the handle nulling, the `burstHandle` reset, the `close` and the `showHandle` re-show are unchanged, and `oldHandle` is captured before the loop nulls `member.handle`, as before. No defect.
- Suppression comments. All four are honest.
  - `electron-host-attention-notifications.ts:44` (`isEligible` catch): optional OS notification over the in-app bell. It calls `warnOnce` (line 180), so the error is logged but only once per instance, and returns `false`, meaning "do not show". No required path is hidden.
  - `host-attention-coordinator.ts:~319` (`presentIfCurrent` catch): the error goes through `logHostError('present', ...)`, which logs the error name only (no path or secret). It returns `false`, and the in-app request is emitted independently by the webview manager. Honest.
  - `host-attention-coordinator.ts:~330` (`no-control-regex` disable): the regex deliberately strips control characters from titles, and the disable carries a reason. Honest.
  - `libs/backend/cli-engine/src/lib/container.ts:~290` (`attachCliHostAttention`): the failure is warned (name only) and `undefined` is returned, which the signature documents as "nothing to dispose". The CLI is not a required consumer of the notification channel. Honest.

### 2. Codex spec and test-container edits

- `host-attention-ingress.spec.ts:40` scanner (untracked, so I read it whole): the narrowing is legitimate.
  - It skips the coordinator file, which only compares message types (`host-attention-coordinator.ts:81,94-95`; no `sendMessage`).
  - It skips a `messageType:` log field. The only such site is `sdk-permission-handler.ts:983`, inside `logger.info`; the real emission is elsewhere in that file.
  - The strict, sorted `emissions` equality list (5 entries) remains, along with the no-BATCH assertion, the `webviewManager` receiver check and the `hostAttention?.resolve(attentionRequestKey(` check. Nothing was widened to hide a violation.
- Added or changed assertions: none removed or loosened. The `sdk-permission-handler.spec.ts` diff is additive (new resolution tests, `request!['x']` bracket access, a `hostAttention` argument). The rpc-allowlist test is additive. I found no `.skip`, `xit`, `@ts-ignore` or new `as any` in tracked diff hunks. The `as unknown as` hits I saw sit in lines that already existed (for example `ask-user-question.service.spec.ts:40,70`, `register.compaction-boundary-registry.smoke.spec.ts:84`); the added diff lines contain none.
- DI smoke containers (`container.smoke.spec.ts:123` in ptah-electron, `register.compaction-boundary-registry.smoke.spec.ts:95`, `register.agent-process-manager.smoke.spec.ts:47`, `register-shared-rpc-handlers.activation.spec.ts:89`): each registers only the platform port `HOST_ATTENTION_NOTIFICATIONS` as a stub. That port is bound per host in the real platform registration, so stubbing it in a test container is correct. `HOST_ATTENTION_COORDINATOR_TOKEN` is resolved through the real `registerSdkServices` in the new Electron test (`container.smoke.spec.ts:90-103`), including a singleton identity check, so a missing production registration would still fail. Not a mask.

### Minor findings

1. `host-attention-ingress.spec.ts:40`: the coordinator exemption is by file-name suffix (`endsWith('host-attention-coordinator.ts')`), so any future file with that name would be exempt. Low risk; a full relative path would be tighter.
2. `host-attention-ingress.spec.ts` `hostAttention?.resolve` check is per file, not per emission (pre-existing weakness). A second unreleased emission in the same file would pass.

### Unverified

`apps/ptah-electron/src/services/git-watcher.real-git.spec.ts` stalled and has no `Tests:` line (report lines 30, 44-46). Nothing in this change touches it, so I judge it environmental, but it is still unverified and should be confirmed in a later run.

Verdict: APPROVED, 9/10.


## Phase C + A8 review

Review family: implementer codex (lanes) + Anthropic orchestrator edits; reviewer Anthropic subagent.

Scope: `git diff HEAD` plus untracked files (excluding `.ptah/`). Read whole: dispatcher, voice service, action-banner service, git-status-attention service, the three focus routers and providers, `notice-action-handler.token.ts`, back-office mapper and projection, `NotificationService`, `GitStatusService`. Read as diffs only: host handler, source service, review-shell, chat-view, app.config. Nothing was executed (no nx, tsc or Jest, per instruction); "will fail" claims below come from reading the code and the audit rule source.

Score: 6/10. Verdict: REVISE (0 Blocking, 3 Serious, 6 Moderate, 3 Minor).

### Serious

1. `chat-view.component.spec.ts` still uses the deleted members `actionError()` and `actionWarning()`.
   - Where: `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts:1441, 1468, 1505, 1515, 1517`. The file is not in the diff.
   - Scenario: `chat-view.component.ts` dropped both computeds, so these specs fail to compile or throw `is not a function`. The chat project's test target goes red.
   - Context: `ActionBannerService.showError` and `showWarning` no longer write to the local banner, so the "real banner" assertions are also obsolete.
   - Fix: replace them with assertions on `NotificationService` (upsert called, kind `failure` or `warning`, `tabId` scoped) and delete the "warning does not leak into info/error slots" case.

2. New silent catch in `libs/frontend/chat`, which is ratcheted (baseline 11, `tools/degradation-audit/baseline.json`).
   - Where: `voice-provider-error.service.ts:97-99`. The block is `catch { switchError.set(...); return false; }` with no throw, no `.error(` and no `degradation-audit: reported` marker.
   - Why it counts: `check-degradation.ts` rule 1 (catch-return-sentinel) flags a catch that returns a literal `false`. This adds one site to the chat directory and trips the ratchet. The "stays 294" requirement is not met.
   - Fix: log with `LoggingService` (the dispatcher does this) and add `// degradation-audit: reported - <reason>`, or return an outcome object.
   - Not run here. Confirm with the audit target.

3. C3 back-office projection misses the terminal boot failure, never clears a boot failure, and relies on unverified labels.
   - `mapBootReadiness` returns `null` for `phase === 'settled'` (`back-office-activity.service.ts:~383`). `rpc-readiness.types.ts:100` says `settled` "pairs with a terminal BackendReadiness". So a final `failed` or `degraded` boot arrives with `settled`, is dropped before `projectFailure` runs, and the "Workspace startup failed" label is mostly unreachable.
   - For non-settled phases `item.kind` is the phase name (`database`, `index`, ...). That is never in the recovery list `['online','ready','complete','success']`, so a boot notice, once raised, is never resolved by a later healthy boot.
   - `FAILURE_LABELS` has entries `indexing:failed`, `indexing:degraded`, `indexing:error`, `database:error` and `harness:error`. I found no emitter for them: `mapIndexingComplete` only yields `complete`, and no emitter for these kinds was found. Treat them as dead or speculative unless a test drives a real emission.
   - Attribution: `projectFailure` uses `workspaceScope.activeWorkspacePath()` at receipt time. Activity events carry no workspace (only `memory:extracted` is filtered by `isForActiveWorkspace`). A failure from workspace A while B is active is filed under B. Also, `if (!path) return` drops the failure when there is no active workspace.
   - Fix: project boot readiness before the settled filter (the ticker can keep skipping it), resolve on a `ready` readiness, and drop or prove the speculative labels.

### Moderate

4. `GitStatusAttentionService` cannot clear on recovery while the dock is closed (`git-status.service.ts:386-387` ignores pushes unless listening; `git-status-attention.service.ts:36-70`).
   - The service is deliberately observe-only, and the shell disarms the status service on dock close. The warning then stays until `switchWorkspace`, an explicit Retry or a dock reopen.
   - Scenario: git fails, the dock closes, git recovers, and the "Git status is unavailable" notice stays in Recent. The AC "resolve on recovery" holds only while the dock is open.
   - Related: `markReadFailed` (`git-status.service.ts:558`) publishes nothing when there is no last-good data, so a first-read failure raises no warning.
   - Suggest: say so in the spec, or have the root service re-read on a slow trigger.

5. Voice switch races a newer error (`voice-provider-error.service.ts:93-95`).
   - Scenario: a switch is in flight for an stt error, a tts error arrives (new key, `currentKey` replaced), then the stt switch succeeds. The success path sets `currentKey = null` and `_latestError = null`, wiping the tts notice's tracking. The tts notice stays visible, but `canHandle` returns false and the user sees "Already answered".
   - Fix: after the await, only clear when `this.currentKey === key`.

6. Each voice error creates a new key and resolves the prior one (`voice-provider-error.service.ts:42-55`).
   - A burst of failing transcribe calls makes the snackbar flicker and replay.
   - Suggest a stable key per direction with an incrementing generation.

7. `ActionBannerService` is now misleading and can drop errors (`action-banner.service.ts:71-77, 95-101, 124-138`).
   - `showError` and `showWarning` ignore `_durationMs`.
   - `error()` and `warning()` computeds can never be non-null any more. `ActionBannerState.kind` still advertises `'error' | 'warning'`.
   - `showAttention` returns silently when `!notifications || !tabs` (non-injection construction). That is a silent drop of a user-facing error, with no log.
   - Every call mints a unique key (`...:${generation}`) with no dedupe, so a repeated failure fills the Recent list (bounded by the eviction limit).
   - The notice has `actions: []`, so a tab-scoped error carries `tabId` but offers no way to reach it. That matches "no Open without a reliable target", but it is a behaviour change from the inline banner.

8. Routability is computed once at projection time, so Open can be stale in either direction.
   - Where: `chat-attention-host-message-handler.service.ts` `upsertProjection` (the `surfaceRouters.find(... canFocus)` and `routable` computation), and `chat-attention-source.service.ts` (the `surfaceOwner` computation).
   - `AppsFocusRouter.canFocus` depends on the live `AppsSessionService.sessionId()`. `SetupWizardFocusRouter` and `HarnessBuilderFocusRouter` depend on the active workspace.
   - Scenario: a notice arrives before the apps session id is set. Open is permanently `disabledReason: 'Target unavailable'` until the notice is re-projected. Conversely, Open shows enabled after a workspace switch and then fails on click. The click path handles the failure with a status message, so this is not data loss.

9. Setup and harness `canFocus` require `found.workspacePath === tabs.activeWorkspacePath` (`setup-wizard-focus-router.service.ts:13-14`, same in harness).
   - A wizard or harness session in another workspace gets Open disabled instead of switching workspace, unlike chat tabs routed through the focus coordinator. Confirm this is the intended decision #30 behaviour; if not, it is a requirements gap.

### Minor

10. `VoiceProviderErrorService.dismiss()` has no production caller now (only the spec). The deleted toast was its caller. Presentation dismissal goes through `NotificationService`, so `_latestError` is never cleared by the panel's dismiss. This is harmless today, but `switchError` and `isSwitching` signals are also unrendered.
11. `soundEligible: true` on every back-office failure (`back-office-activity.service.ts`). Because `resolve` clears `sounded`, a flapping `vec` or `embedder` status replays the sound, limited only by the global cooldown.
12. `GitStatusAttentionService` derives `workspaceName` by regex while sibling sources use `workspaceLabelFromPath`. This is a duplicate and could drift. `review-shell` Dismiss for the inline strip is local only and does not touch the attention notice, which is acceptable but undocumented.

### Focus-area results

- **A8 routers and registration**
  - `canFocus` is limited to owned sessions: setup and harness by `tab.workflow` plus active workspace, apps by `sessions.sessionId()`. `focus` re-checks `canFocus`, maps navigation failure to `missing`, and switches the tab only after a landed navigation. The routes exist (`harness-builder/:mode/:tabId`, `generationRouteBinding`). OK.
  - All three providers are registered in `app.config.ts`. The `harness-builder/services` alias exists. Provider arrays use `multi: true`. OK.
  - Dependency direction: the apps shell imports each lib. No lib imports a sibling feature lib to register it. OK.
  - The tab-less Open mapping is consistent between the host handler (`upsertProjection`, `openProjected`) and the source service. The mismatch check against pending target fields is kept. Fall-through to the focus coordinator for tab-less, router-less targets is correct. The caveat is item 8.
- **NOTICE_ACTION_HANDLER and dispatcher** (`chat-attention-action-dispatcher.service.ts`)
  - Stale generation: `getLive(key, gen)` returns null, then no handler matches, then `{ kind: 'stale' }`. Correct.
  - inFlight is per key and released in `finally`, so double clicks are blocked. The handlers add their own guards (`switching`, generation check).
  - Outcome mapping is consistent: completed, unavailable with reason, stale. A handler throw is logged and mapped to unavailable. OK.
  - `dispatch()` collapses the outcome to a boolean, which is fine for the legacy path.
- **C1 voice**
  - Preserved: message (`context: payload.message`), provider name (title), dismiss (via the panel), and switch-to-local that resolves on success and keeps the notice on failure (resolve happens only after both RPCs succeed). Registration in `app.config.ts` is present.
  - Deleted toast: no dangling import of `VoiceProviderErrorToast` remains in non-spec code.
  - Gaps: items 2, 5, 6 and 10. Inline `isSwitching` progress and the inline error text are no longer shown. Failure is surfaced via the dispatcher outcome reason.
- **C2 git**
  - The service is observe-only. The shell still arms and disarms `GitStatusService` (`review-shell.component.ts` `startListening` in the constructor), and `git-dock-arming-identity.spec.ts` guards it.
  - The key is stable, with generation 1. A re-upsert with identical content is a no-op in `NotificationService`, and presentation dismissal survives dock toggles. Snackbar suppression is set before the upsert and cleared with the entry. Resolve fires on recovery and on workspace change. The retry handler guards on key, generation and reason.
  - Gap: item 4.
- **C3 back-office**
  - Every public member of `BackOfficeActivityService` is unchanged. `push` still runs first, so the canvas ticker is unaffected. Labels are fixed strings with no diagnostic text, and `actions: []`, so there is no Open without a target.
  - Gap: item 3.
- **General**
  - No `any`, `@ts-ignore` or `as unknown as` in the added non-spec lines. No new `text-base-content/NN` in templates (the existing `border-base-content/10` is a `border-` utility). Module direction is clean.
  - The degradation audit is at risk from item 2.

### Verdict

REVISE. Fix 1-3, then re-run the chat, core and git-ui specs and the degradation audit target on the changed directories. Items 4-9 can be fixed in the same pass or recorded as decisions.

## Phase C fix-round re-review

Scope: only S1, S2, S3, M5 and M7-partial from "Phase C + A8 review". Static read, no tests run (machine busy).

| Finding | Status | Evidence |
| ------- | ------ | -------- |
| S1 chat-view spec uses deleted members | Fixed | `chat-view.component.spec.ts:1446-1448, 1475-1477, 1515-1517, 1527-1529` now assert `attentionUpsertMock` (kind, title, tabId). The real `ActionBannerService` is built by a `useFactory` (line ~489) so `inject()` works, and `NotificationService`/`LoggingService` stubs are provided. `tabManagerStub` has `activeWorkspacePath` (318) and `findTabByIdAcrossWorkspaces` (331), so `showAttention` does not throw. Only the obsolete "no leak into info/error" case was dropped; the two replacement cases keep equal strength (global has no `tabId`, warning is tab-scoped). |
| S2 silent catch | Fixed | `voice-provider-error.service.ts:100-104` logs via `LoggingService.warn` (error name only, no payload), sets `switchError`, carries `degradation-audit: reported`. The notice stays actionable. Spec `voice-provider-error.service.spec.ts:140-146` covers the thrown path. Not run against the audit target. |
| S3 back-office projection | Fixed, with one residual | `handleMessage` (`back-office-activity.service.ts:161-170`) calls `projectBootReadiness` before the mapper, so the terminal `failed`/`degraded` with phase `settled` raises the notice and `ready` resolves it (key `back-office:boot`). `mapBootReadiness` still returns `null` for `settled` (394), so the activity ring still skips it; no public member was removed (diff is additions plus a new `NotificationService` inject). Spec at `...spec.ts:95-103` asserts a failed settled boot raises a notice. FAILURE_LABELS: `skills:error` (mapSkillSynthesis, 520), `embedder:error` (312), `embedder:offline`/`vec:offline` (330, 292) have emitters. The four removed labels (`indexing:degraded`, `indexing:error`, `database:error`, `harness:error`) had no emitter in the typed mappers. `indexing:failed` has no typed emitter but can arrive through the generic `mapActivityEvent` pass-through (375-384), and a spec drives it (`...spec.ts:83-93`); acceptable. |
| M5 voice switch race | Fixed | `voice-provider-error.service.ts:94-98`: the old key is resolved (correct, the switch did succeed for it), but `currentKey` and `_latestError` are cleared only when `this.currentKey === key`. Spec at 124-137 covers it. |
| M7-partial banner silent drop | Fixed (partial, as scoped) | `action-banner.service.ts:126-129` now logs a warning when `notifications`/`tabs` are missing. Spec was extended (+43/-6). `_durationMs` is still ignored, the dead `error()`/`warning()` computeds and no dedupe remain: deferred, out of scope. |

New defects: none blocking. Residuals (unchanged, out of scope here): S3 attribution still uses the active workspace at receipt time (`projectBootReadiness` 177, `projectFailure` 197), and a failure with no active workspace is dropped without a log.

Specs were not weakened: diff numstat shows chat-view +27/-17 (assertions swapped, not removed), action-banner +43/-6, voice +91/-1, back-office +79/-0.

Score: 8/10. Verdict: APPROVED (fix round only; the deferred items remain open).
## PR #780 review-comment fixes review

Scope: `git diff HEAD` (12 files, +99/-8), read-only static review. No nx/tsc/Jest run (machine busy); spec outcomes are not verified by execution.

| # | Comment | Verdict |
|---|---------|---------|
| 1 | Lane restart releases lane failure notice | Fixed (with a moderate race) |
| 2 | Burst summary re-shown only when eligible | Fixed |
| 3 | notification.service compares against presented item | Fixed (touch branch is dead code) |
| 4 | activate catch is reported, not silent | Fixed |
| 5 | dismiss resumes paused snackbar | Fixed |

### 1. Lane restart release - fixed
- `host-attention-coordinator.ts:208-212` `releaseLaneFailure` builds the same key as `presentLaneFailure` (`c:` + `workspaceIdFromPath('lane:<agentId>')`, lines 189 and 208) and reuses `resolve(key, generation)`. Failure presentation (`:178-195`, `agent-process-manager.service.ts:2355`) is unchanged.
- `agent-process-manager.service.ts:1883` calls release only after `sdkHandle.continue()` succeeds. A failed continue goes through `handleExit(...,1)` and presents a fresh failure. Correct placement.
- Moderate (new): `presentLaneFailure` is async (`await this.metadata.get`, line 184). If the user restarts the lane before that await settles, `releaseLaneFailure` finds no generation and is a no-op. The notice is then presented for a lane that is already running again. `releaseSessionFailure` guards this with `releasedSessionAt`, and the lane path has no equivalent. Window is small (one metadata lookup), so it is not blocking. Fix: record a per-agent release marker and check it before `presentFailure`.
- Test: the new coordinator spec asserts `host.resolve` with the lane key and generation 30. The manager spec asserts the call with `agentId`. Adequate.

### 2. Burst re-show - fixed
- `electron-host-attention-notifications.ts:109-113` re-shows the summary only when `isEligible()`. Otherwise the members were already set to `handle = null` (line 106) and the old handle closed. They are detached, and later `close()` on a null handle is a no-op (line 177), so there is no leak or double close.
- Accepted trade-off: members are not re-shown if the window loses focus again later. The request was to not show while ineligible, so this is within spec.

### 3. notification.service presented comparison - fixed
- `presentationChanged` now compares `presented.presentationKey` with `prior.presentationKey` (`:81`). Before, a host-source item with a different key could clear `dismissed` and reset the clock while the presented chat item was unchanged. That is gone, and the spec at `needsYou()[0]).toBe(chat)` pins it.
- Minor: the new `if (stateChanged) { touch(); scheduleExpiry(); }` branch (`:109-112`) is unreachable. The early return needs `prior` and all fields equal, including `presentationKey`. `stateChanged` is only true when `newLifecycle` (which implies no `prior`) or when `presentationChanged` (which implies the key field differs). Harmless, but the comment's "still run touch()" intent is not exercised. Remove it or add a test that proves a reachable case.

### 4. activate catch - fixed
- `notification-center.store.ts:112-117` logs through `LoggingService.error(context, message, data)`, which matches the signature (`logging.service.ts:180`). It sets a fixed `'Action unavailable'` row status, returns false, and `finally` still clears `submitting`. The text is fixed and does not leak the error. The marker comment documents the intent, so this is not a silent catch. The spec asserts status, `isSubmitting` false and the logged error.
- Minor: the status uses `statuses` only and not the `unavailable` map, so the action is retryable. That is the right behaviour for a transient dispatch failure.

### 5. Snackbar dismiss - fixed
- `notification-snackbar.component.ts:172` calls `resumeSnackbar(key)` only when `paused.delete(key)` returned true. This clears `individuallyPaused` and the clock state before `dismissPresentation`. A dismissed-then-reappearing key no longer stays individually paused. The spec covers hover, then dismiss, and `resume` is called with `'hovered'`.

### Hygiene
- No `any`, `@ts-ignore` or new `as unknown as` in added lines. The `Object.create(null) as HostAttentionCoordinator` in the manager spec is existing. No `expect` or `it` lines were removed or weakened (grep of removed lines is empty). The only new catch is the reported one in #4.

### Verdict
APPROVED, 8/10. 0 blocking, 0 serious, 2 moderate/minor: the lane release race (#1) and the dead `touch()` branch (#3). Spec execution is unverified here, so the maintainer should run the five changed projects' tests before merge.
