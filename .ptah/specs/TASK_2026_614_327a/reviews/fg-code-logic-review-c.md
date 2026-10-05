# Code Logic Review — `TASK_2026_614_327a` (Stage F + G, frontend part, reviewer C)

Scope: `git diff 55f245619..49fba1097 -- libs/frontend libs/shared/src/lib/utils/pricing.utils.ts` (26 files, +2108/-445).
Batches 19, 20, 32, 33, 35, 36. Inputs read: `context.md` § Stage F, § Stage G, § User Decisions (Stage F + G);
`batches.md` lines 662-714 and 1275-1340; `batch-33-report.md` and `batch-36-report.md`. I read every production hunk
in full together with the code around it:

- `tab-manager.service.ts`: `clearSessionBudgets`, `updateTabInternal`, the three `emitTabClosed` sites, `resetTabToFresh`
- `tab-workspace-partition.service.ts`
- `agent-monitor.store.ts`: pricing helpers, clear paths, rekey, eviction
- `pricing.utils.ts`: `findModelPricing`, `pricesCacheTokens`
- `session-budget-actions.service.ts` (whole file)
- `chat-view.component.ts/.html`
- `session-budget-banner.component.ts`
- `session-rotation-keep.service.ts`
- `session-budget-settings.component.ts`: `commit`, `commitPartner`, `toggle`, `write`, template bindings
- `session-stats-summary.component.ts`, `session-budget-format.ts`, `subagent-usage-summary.component.ts`
- `rpc-call.util.ts` (timeout message)
- `busy-disabled.directive.ts`

I read spec files only where a finding depends on them. I did not run tests or `ptah_get_diagnostics`, so the review
relies on the batch reports' green checks.

## Summary

| Metric              | Value               |
| ------------------- | ------------------- |
| Overall score       | 7/10                |
| Assessment          | APPROVED WITH FIXES |
| Blocking issues     | 0                   |
| Serious issues      | 1                   |
| Moderate issues     | 1                   |
| Minor issues        | 8                   |
| Failure modes found | 6                   |

Why 7 and not 8: the F.3 fix for the sibling-draft auto-save opened a new silent path. A partner draft that becomes
valid while its field has focus is never saved unless the user edits it again (S1). That path is the natural Tab order
for lowering both percents.

Why 7 and not 6: Batches 35 and 36 do preserve behaviour.

- The component-provided `SessionBudgetActionsService` makes the same single `session:budgetAction` RPC.
- It keeps the same busy guard, error banner targeting and seed / new-tab / canvas / prefill flows.
- The stats-summary split is a pure function extraction with identical strings.

The other fixes hold:

- Keep-key pruning, the write timeout and its distinct copy.
- Per-request pricing, with "unknown" when a cache price is missing.
- Monitor eviction and rekey.
- The `restore-failed` and `readStatus` copy, preview "Try again", and F-D clearing across workspaces.

## Five logic questions

### 1. How does this fail silently?

- **Partner percent draft never saved (S1).** Tighten is saved while focus is already in Handoff, so `commitPartner`
  only re-validates the Handoff draft (`session-budget-settings.component.ts:465-473`). `blurred()` only clears
  `focusedKey` (`:433-435`). `(change)` does not fire when the user leaves the field without editing it. The draft
  stays on screen with its error cleared, while the status line says "Saved Tighten at.".
- **Stale snapshot after F-D (M1).** The settings card clears `sessionBudget` on every tab. A stats snapshot computed
  before the write can then arrive and re-install a `limit` banner that says sends are paused when they are not
  (`tab-manager.service.ts:2280-2292`).

### 2. What user action produces unexpected behaviour?

- **Lowering both percents in Tab order (S1).** Defaults are 50/80 and the target is 30/40:
  1. Type Handoff 40. It is invalid against 50, so the draft is kept with an error.
  2. Click Tighten and type 30.
  3. Press Tab. `change` on Tighten triggers its write, then focus moves to Handoff.
  4. When the write resolves, the Handoff draft is only re-validated.
  5. Press Tab again. Nothing saves Handoff, which stays at 80 on the host.
- **Turning the budget off from `settings.json` or another window.** The card is the only caller of
  `clearSessionBudgets` (`session-budget-settings.component.ts:552-556`), so the limit banner stays until the next
  snapshot. That is the F-D wording ("saved off" through the card), so it is noted, not filed.

### 3. What input data produces a wrong answer?

- A `SessionBudgetState` from an older host with `revision` absent. The new compare at
  `session-budget-actions.service.ts:98-103` tests `!== null`, so `undefined` reaches `>=` and evaluates false. A fresh
  action state then loses to the tab budget. The old code used `?? -1` (m1).
- A first `message_complete` with no `sessionId` creates a usage entry with `parentSessionId: undefined`. Later
  messages never update it (`agent-monitor.store.ts:2111-2118`), so a session clear never drops it. Only the 100-entry
  cap does (m3).

### 4. What happens when a dependency fails?

- **`settings:set` times out (5 s).** `rpcCall` resolves `RPC timeout: settings:set` (`rpc-call.util.ts:132`), which
  matches `RPC_TIMEOUT_PREFIX` (`session-budget-settings.component.ts:44`). The card frees `busy` and shows "Could not
  confirm saving …". It also skips `clearSessionBudgets` even if the write later lands. This is correct and
  conservative.
- **`session:budgetAction` fails during a preview.**
  - The preview gets `content: null` and the banner shows "Could not load the handoff." with Try again
    (`session-budget-actions.service.ts:139-143`, banner `:185-205`).
  - A retry resets the failed entry, so "Loading…" shows again (`:138`).
  - The error banner fires too, so the failure is reported twice (m6).
- **The pricing table has no entry or no cache price.** `estimateCost` returns `null` (`agent-monitor.store.ts:220-227`).
  One unpriced request makes the whole subagent total "unknown", which is the F-E decision.

### 5. What is missing that the requirements never mentioned?

- A blur-time commit for a partner draft that is pending and valid (S1).
- Protection against a stale snapshot after F-D (M1).
- Pruning of keep keys when a whole workspace is removed. The service listens only to `onTabClosed`
  (`session-rotation-keep.service.ts:24-29`). I did not verify whether workspace removal emits per-tab close events
  (m7).
- The tooltip's hard-coded 50/80/100 (`session-budget-format.ts`, `budgetTooltip`). It is deferred as NL-F1, and
  `batches.md:1338` records that.

## Failure modes

### FM-1 Partner percent draft left unsaved after focus moves into it

- **Trigger:** a percent field holds an invalid draft. The user saves its partner and moves focus into the drafted
  field before the write resolves, which happens with Tab. The user then leaves without typing.
- **Symptom:** the field shows the new number with no error. The host keeps the old value, and the status says only
  the partner was saved.
- **Evidence:** `session-budget-settings.component.ts:278-279` (focus/blur bindings), `:433-435` (`blurred`),
  `:465-473` (`commitPartner` re-validate-only branch). The spec at `session-budget-settings.component.spec.ts:280`
  pins "not saved while focused" but not the blur that follows.
- **Current handling:** none after blur.
- **Recommendation:** in `blurred(key)`, commit a pending draft: `if (this.drafts()[key] !== undefined) void this.commit(key);`.
  `commit` already returns early for an unchanged, invalid or busy draft. Add a spec for focus → partner save → blur
  with no edit.

### FM-2 Stale snapshot re-installs the limit banner after F-D

- **Trigger:** a stats snapshot in flight, computed while the budget was still on, arrives after the confirmed write
  of `enabled=false`.
- **Symptom:** the limit banner returns with "New messages here are paused" while sends go through, until the next
  snapshot.
- **Evidence:** `tab-manager.service.ts:2280-2292` clears once. The settings card at `:552-556` runs it only after
  the confirmed write. Nothing guards later snapshots against the settings change.
- **Current handling:** self-heals on the next snapshot.
- **Recommendation:** named later task. The backend could stamp the budget-off state on its next snapshot, or the
  frontend could ignore `blocked` while the saved setting is off.

### FM-3 Action state dropped when a revision field is absent

- **Trigger:** a host omits `revision`. The wire is untyped; the declared type is `number | null`
  (`session-budget.types.ts:124`).
- **Symptom:** the banner shows the tab's pre-action budget, for example still at `limit` after "Allow 20% more", until
  the next snapshot.
- **Evidence:** `session-budget-actions.service.ts:98-103`.
- **Recommendation:** use `actedRevision != null && tabRevision != null`, or normalise with `?? null`.

### FM-4 Action state ignored when a snapshot lands before the RPC reply (null revisions)

- **Trigger:** both revisions are `null`, and the action causes a snapshot that reaches the tab before the
  `session:budgetAction` reply.
- **Symptom:** `acted.base !== fromTab`, so the tab's snapshot wins (`:103`). It may already include the action, so
  this is usually harmless.
- **Evidence:** `session-budget-actions.service.ts:212, :220, :103`.
- **Recommendation:** accept. This is the M6 design and errs towards the snapshot.

### FM-5 Unmatched usage entry with no session never dropped by a session clear

- **Evidence:** `agent-monitor.store.ts:2111-2118` sets `parentSessionId` only at creation. `:1764-1768` matches on
  it.
- **Recommendation:** set `entry.parentSessionId ??= knownSessionId(event.sessionId)` on every message.

### FM-6 Pending-identity cap evicts an identity whose `agent_start` is still coming

- **Evidence:** `agent-monitor.store.ts:1937-1948` evicts the oldest pending identities once there are more than 100.
  A record created later lacks `agentId` and `teammateName`. This is reachable only with more than 100 subagents
  pending in flight.
- **Recommendation:** accept.

## Blocking issues

None.

## Serious issues

### S1 Sibling percent draft is never committed when focus has moved into it (F.3 regression path)

- **File:** `libs/frontend/chat/src/lib/settings/ptah-ai/session-budget-settings.component.ts:433-435`, `:465-473`
- **Scenario:** see FM-1. It is reachable in normal Tab order when the user lowers both percents and enters Handoff
  first.
- **Impact:** the user's edit is silently lost. The settings card looks saved, but the backend uses the old handoff
  percent, so handoff and rotation fire at a threshold the user believes they changed. This is a settings value, not
  a lane config, but it is a lost user edit, so fix it this round.
- **Fix:** commit the pending draft on blur, as in FM-1, and add the spec.

## Moderate and minor issues

**Moderate**

- **M1** (FM-2): a stale snapshot after F-D can re-show a paused limit banner (`tab-manager.service.ts:2280-2292`).
  It cannot break a lane config or lose data and heals on the next snapshot, so it becomes a named later task.

**Minor**

- **m1** (FM-3): `undefined` revision compare (`session-budget-actions.service.ts:100`).
- **m2** (FM-4): null-revision ordering against a snapshot that arrives first (`:103`).
- **m3** (FM-5): an unmatched usage entry is never stamped with its session after creation
  (`agent-monitor.store.ts:2111-2118`).
- **m4** (FM-6): the pending-identity cap can drop a live identity (`agent-monitor.store.ts:1937-1948`).
- **m5** `clearSessionBudgets` goes through `updateTabInternal`, which stamps `lastActivityAt: Date.now()`
  (`tab-manager.service.ts:1320-1324`). Turning the budget off therefore marks every budgeted tab as just active,
  which affects any recency ordering.
- **m6** A failed preview reports twice: the error banner from `runAction` and the inline "Could not load the
  handoff." (`session-budget-actions.service.ts:223-227` plus banner `:185-205`).
- **m7** Keep keys are pruned only on `onTabClosed` against active-workspace `tabs()`
  (`session-rotation-keep.service.ts:55-64`). Workspace removal was not verified. The set is bounded by the number of
  sessions.
- **m8** `busy` and the error-banner target stay view-scoped, not tab-scoped
  (`session-budget-actions.service.ts:81, :240-242`). An action in flight from tab A disables the banner buttons on
  tab B in the same panel, and a late error lands on B. This behaviour carries over from the old code unchanged, so
  it is not a 35/36 regression.

Accepted side effect: F-D hides an active rotation advisory until the next snapshot (`batch-33-report.md:82`).

## Data flow

1. **Settings card toggles `enabled` off.** `toggle` → `write` → `rpcCall('settings:set', …, 5000)` (OK). On
   confirmed false → `clearSessionBudgets()` (OK). On timeout → "Could not confirm…" with no clear (OK). Gap M1:
   snapshots that arrive later.
2. **`clearSessionBudgets`.** Active tabs come from `_tabs()`, background tabs from `findBackgroundTabIds`, which skips
   the active path (`tab-workspace-partition.service.ts:352-362`). Both go through `updateTabInternal` (OK; m5
   `lastActivityAt`).
3. **Chat view.** `connect({activeTab, tabId, sessionId})` runs in the constructor. Field initialisers only alias the
   service signals, and `view` is a signal, so nothing reads stale state before `connect` (OK).
4. **Scope change.** On a tab or session change, `linkedSignal` resets `actionState` and `preview` (OK, M6 clearing).
   An in-flight reply then writes into the new scope, and `budget` and `currentPreview` filter it by `sessionId` (OK).
5. **Budget action.** `runAction` makes one RPC, records `{state, base}`, shows an error banner on failure and clears
   busy in `finally`. This matches the old `runBudgetAction` (OK).
6. **Continue / Rotate.** Seed → `createTab` → `requestCanvasTab` in grid layout → `sendOrQueueMessage` for Continue,
   or `requestComposerPrefill(seed, grid ? tabId : null)` for Rotate. This is identical to the old chat-view code (OK).
7. **Monitor `message_complete`.** The usage entry is created and stamped with its session, then `evictUnmatchedUsage`
   runs (OK; m3). A record re-sums its totals, and `estimatedCostUsd` is computed per request with a fallback to the
   latest named model (OK).
8. **Monitor clear and rekey.** A session clear drops the session's unmatched entries. `forceClear` drops records and
   their entries. `resolveParentSessionId` rekeys pending identities and usage from the tab id to the session id (OK).
9. **View.** `subagentUsageView` → `totalsCost` uses the stored estimate, or prices hand-built totals as a single
   request (OK).

## Requirements fulfilment

| Requirement                                               | Status   | Gap                                                    |
| --------------------------------------------------------- | -------- | ------------------------------------------------------ |
| F.3 sibling percent draft does not auto-save while typing | PARTIAL  | S1: a focused partner draft is never saved after blur  |
| F.3 `settings:set` 5 s timeout and honest copy            | COMPLETE | —                                                      |
| F.4 / F-D clear banners on every tab when saved off       | COMPLETE | M1 stale snapshot; rotation advisory hidden (accepted) |
| F.1 M6 resolvedSessionBudget ordering and clearing        | COMPLETE | m1 undefined revision                                  |
| F.1 M3 UI readStatus line (F-B)                           | COMPLETE | —                                                      |
| F.1 M8 / F-C `/compact` copy only                         | COMPLETE | —                                                      |
| Batch 28 `restore-failed` copy                            | COMPLETE | —                                                      |
| F.5 M2 / M5 eviction of unmatched entries                 | COMPLETE | m3, m4                                                 |
| F.5 M4 rekey placeholder identities                       | COMPLETE | —                                                      |
| F.5 M3 / F-E per-request price, unknown on missing cache  | COMPLETE | —                                                      |
| F.6 failed preview "Try again"                            | COMPLETE | m6 double report                                       |
| F.6 tooltip 50/80/100                                     | DEFERRED | NL-F1 (documented)                                     |
| D.5 keep-key pruning on tab close or reset                | COMPLETE | m7 workspace removal unverified                        |
| F.2 / 35 / 36 behaviour-preserving split                  | COMPLETE | —                                                      |

Implicit requirements not addressed: a blur commit for a pending valid draft (S1).

## Edge cases

| Case                                         | Handled | How                                                   | Concern                   |
| -------------------------------------------- | ------- | ----------------------------------------------------- | ------------------------- |
| Tab switch during an in-flight budget action | YES     | sessionId filter on `budget` and `currentPreview`     | m8 busy and banner target |
| Tab close, session still in another tab      | YES     | `stillHeld` check after `_tabs` removal               | —                         |
| Tab reset (`/clear`)                         | YES     | reset clears `claudeSessionId` and `sessionBudget` before emitting | —            |
| Workspace switch                             | YES     | no close events, so keys are kept                     | —                         |
| Background-workspace tabs on F-D             | YES     | `findBackgroundTabIds`                                | —                         |
| Request without a model                      | YES     | priced with the latest named model                    | —                         |
| Cache tokens with no cache price             | YES     | `pricesCacheTokens` → null                            | —                         |
| Hand-built totals with no estimate           | YES     | `totalsCost` single-request pricing                   | —                         |
| More than 100 unmatched subagents            | YES     | oldest-first cap                                      | m4                        |
| Write times out but lands later              | PARTIAL | honest copy                                           | F-D clear skipped         |
| Partner draft valid while focused, then blur | NO      | —                                                     | S1                        |

## Verdict

- **Recommendation:** APPROVED WITH FIXES. Fix S1 this round. M1 cannot break a lane config or lose data, so it goes to
  a named later task, along with the Minors.
- **Confidence:** MEDIUM-HIGH. I read every production hunk. I did not re-run specs or diagnostics, and m7 (workspace
  removal) is unverified.
- **Top risk:** after a Tab-order edit of both percents, the settings card looks saved while the handoff percent never
  reached the host.
- **What a robust implementation would add:**
  - A blur commit of a pending valid draft.
  - A guard against a pre-change snapshot after F-D.
  - A `!= null` revision compare.
  - Session stamping of unmatched usage entries on every message.
