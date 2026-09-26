# Code Logic Review — `TASK_2026_494` Batch 14

Scope: `libs/frontend/mcp-apps-page/src/lib/components/apps-focus-memory.directive.ts` (+ spec, NEW);
`libs/frontend/mcp-apps-page/src/lib/services/apps-workspace-slice.ts`,
`apps-session.service.ts`, `apps-session.service.spec.ts` (MODIFIED). Read in full; not a re-review of Batch 12.

Independent verification: `npx nx run @ptah-extension/mcp-apps-page:test --skip-nx-cache` — 8/8 suites,
146/146 tests green (132 at Batch 12 + 14 new).

## Summary

| Metric               | Value                                |
| --------------------- | ------------------------------------ |
| Overall score         | 6/10                                 |
| Assessment             | NEEDS_REVISION                       |
| Blocking issues        | 0                                    |
| Serious issues         | 2                                    |
| Moderate issues        | 2                                    |
| Failure modes found    | 4                                    |

## Five logic questions

### 1. How does this fail silently?

- `AppsSessionService.start()` (`apps-session.service.ts:186-233`) has no ownership check after a **successful**
  `chat:start` resolves. If the new implicit-workspace-drop effect (`:164-169`) fires *while* `chat:start` is
  still in flight for a conversation claimed under `APPS_IMPLICIT_WORKSPACE`, `dropSlice` releases the inbox
  claim, the workflow claim, calls `streamRouter.onSurfaceClosed`, disposes the sync, and removes the slice
  (`:529-538`) — all before the RPC promise settles. When the promise then resolves `success`, `start()` takes
  no action at all (no branch handles "the slice I claimed no longer exists"): the host has a live, running
  conversation that the client can never reach again (the inbox has already released the claim, so every
  future `surface:updated` push for that `routingId` is silently dropped per the Batch 1 drop-rule contract).
  No error is shown, nothing is logged, and no resource is released on the host side. See Failure mode
  "Boot-window race orphans a live conversation" below.
- `recordFocusKey()` (`apps-session.service.ts:350-360`) → `patch()` → `patchAppsSlice()`
  (`apps-workspace-slice.ts:108-119`) materializes a brand-new map entry for any workspace key that has no
  slice yet, the moment a focus event fires with a non-null key. This is the same class of bug Batch 12's N3
  named for `discard()` (now fixed there), reintroduced through the new write path. The service reports
  success (nothing throws, nothing warns) while quietly growing `_slices` with phantom entries for workspaces
  that never started a conversation.

### 2. What user action produces unexpected behaviour?

- Typing a first message before the Electron workspace-restore sequence finishes resolving
  `activeWorkspacePath$` (i.e. during the boot window), where the folder-restore lands *while* `chat:start` is
  in flight rather than before it starts: the conversation the user just typed silently vanishes with no error,
  and the host keeps running an orphaned agent turn. (Batch 12 N2's own scenario — folder resolves before
  `start()` is even called — is fixed and tested; the harder in-flight interleaving is not.)
- Clicking/tabbing around the Apps page in a workspace that has never started a conversation (e.g. browsing an
  empty state, or a workspace the user is just passing through) creates a permanent, non-conversational slice
  entry for that workspace the first time focus lands on any `[data-apps-focus-key]` control. Repeated across
  many workspace switches in a long Electron session, `_slices` accumulates entries that are never cleaned up
  by `discard()` (nothing calls it) or by the removed-workspace effect (the workspace was never removed, just
  switched away from).
- If a user closes every open folder after already having one resolved workspace, then opens a *different*
  folder, `hasResolvedWorkspace` (`apps-session.service.ts:112`) is already `true` from the first resolution
  and never resets, so any conversation started in the intervening implicit window is never dropped when the
  new folder resolves (see Failure mode "Implicit-drop guard only fires once" below).

### 3. What input data produces a wrong answer?

- A `data-apps-focus-key` value containing `"`, `'`, `[`, `]` is handled correctly: the directive never builds a
  CSS selector string from the key (`apps-focus-memory.directive.ts:50-57` iterates `querySelectorAll('[data-apps-focus-key]')`
  and compares `getAttribute(...) !== key` directly), and the spec pins this with a literal
  `filter["value"]'suffix` key (`apps-focus-memory.directive.spec.ts:108-116`). No injection risk found.
- No other malformed-input path was found in this batch's diff that produces a wrong (non-error, non-empty)
  answer; the focus-key value is opaque and never interpreted.

### 4. What happens when a dependency fails?

- `control.focus()` throwing (e.g. a control detached mid-call) is caught per-candidate is **not** true — the
  `try` wraps the entire `for` loop in `restoreFocus()` (`apps-focus-memory.directive.ts:47-58`), so if
  `control.focus()` throws, the loop's remaining candidates (there can be more than one element carrying the
  same stale key, though unlikely) are never tried and control falls straight to the host-focus fallback. This
  matches the spec pin ("falls back without throwing when a control refuses focus",
  `apps-focus-memory.directive.spec.ts:135-144`) and is an acceptable simplification given the stated contract
  is "restore to the recorded key, or the host fallback" — not "try every match." Not a defect.
- `this.host.focus()` itself throwing is caught separately (`:63-68`) and swallowed; the directive never
  throws to its Angular caller in any traced path — confirmed for both `onFocus` and `restoreFocus`.
- `AppsSurfaceSync.dispose()` thrown from within `dropSlice`'s `teardown()` is caught by the per-step try/catch
  inherited from Batch 12 (`apps-session.service.ts:517-526`) and does not stop the other release steps or the
  map update — that part of the implicit-drop effect correctly reuses the hardened `discard()`/`dropSlice`
  teardown path, which does answer part of Q3 in the task prompt: yes, `dropSlice` runs the *exact* same
  `teardown()` as `discard()` (`:340` and `:531` both call the same private method).

### 5. What is missing that the requirements never mentioned?

- No guard on the `start()` success path against the slice having been dropped mid-await (see Q1). The plan's
  quality bar ("rollback and `discard()` release inbox, claims, surface and sync") assumed the only place a
  slice disappears mid-flight was `discard()`/workspace-removal, both of which the existing `isAppsSliceOf`
  check in `rollBackFailedStart` covers on the **failure** branch. Batch 14 added a second, effect-driven way a
  slice can disappear mid-flight (the implicit-drop effect) without extending the equivalent guard to the
  **success** branch.
- No test exercises the in-flight (not-yet-resolved) interleaving of the implicit-drop effect against
  `start()`; the new N2 spec (`apps-session.service.spec.ts:459-484`) only covers the sequential case where
  `start()` has already resolved before the real workspace appears.
- `hasResolvedWorkspace` is a one-shot latch with no reset path; the plan implicitly assumes exactly one
  implicit→real transition per app lifetime, which is not guaranteed if a user can close and later reopen
  folders in Electron.

## Failure modes

### Boot-window race orphans a live conversation

- Trigger: `start()` claims a conversation under `APPS_IMPLICIT_WORKSPACE` (`apps-session.service.ts:186-192`
  → `claimConversation` at `:426-463`, all synchronous), then awaits `chat:start`
  (`:195-208`). Before that await settles, `tabManager.activeWorkspacePath$` resolves to a real folder path
  (plausible: this signal is driven by an independent, asynchronous workspace-restore sequence racing the
  network round trip of `chat:start`). The new constructor effect (`:164-169`) fires and calls
  `dropSlice(APPS_IMPLICIT_WORKSPACE)` (`:529-538`), which releases the inbox claim, the workflow claim,
  calls `streamRouter.onSurfaceClosed`, disposes the sync, and deletes the slice — all while `chat:start` is
  still outstanding.
- Symptom: when `chat:start` later resolves `success`, `start()` (`:209-217`) takes the `else` branch (no
  code runs) and returns. The host now runs a conversation the client can never receive updates for (its
  `routingId`'s inbox claim was already released, so the Batch-1 inbox drop-rule silently discards every
  future `surface:updated` push for it) and cannot address again (surface registry entry unregistered,
  workflow claim released). No `error` is set on any slice; nothing is logged.
- Evidence: `apps-session.service.ts:164-169` (effect, no in-flight guard), `:186-233` (`start()`, no
  post-await ownership check on the success path — contrast with `rollBackFailedStart`'s `isAppsSliceOf` guard
  at `:479` on the failure path), `:529-538` (`dropSlice`, unconditional teardown of whatever the implicit
  slice currently holds).
- Current handling: only the failure branch is guarded (`rollBackFailedStart` no-ops via `isAppsSliceOf` when
  the slice was already released). The success branch has no equivalent check.
- Recommendation: after `chat:start` resolves successfully, re-check `isAppsSliceOf(readAppsSlice(this._slices(), key), conversation.routingId)`. If it no longer holds, treat the just-established host session as orphaned and run the same `releaseConversation` teardown against the *new* conversation (best-effort `chat:abort`/close) so the host is told to stop, rather than leaving it running unreachable. Add a spec that starts `start()`, drops the implicit slice mid-await (before resolving the mock RPC), then resolves it successfully, and asserts the resulting host session is released, not silently abandoned.

### Implicit-drop guard only fires once per app lifetime

- Trigger: `hasResolvedWorkspace` (`apps-session.service.ts:112`) is set `true` the first time
  `workspaceKey()` reports a non-implicit key and is never reset. If the workspace later becomes implicit
  again (all folders closed) and a new conversation is started under `APPS_IMPLICIT_WORKSPACE`, then a
  *different* folder resolves, the effect's early-return (`:166`, `this.hasResolvedWorkspace` already true)
  means `dropSlice(APPS_IMPLICIT_WORKSPACE)` never runs again.
- Symptom: the second implicit-window conversation (with its live claims, inbox registration and running
  agent) is stranded permanently — the exact defect N2 was raised to fix, now reachable a second time.
- Evidence: `apps-session.service.ts:112, 164-169` — `hasResolvedWorkspace` has no setter other than `:167`
  and no reset anywhere in the diff or the surrounding file.
- Current handling: none; the guard is a true one-shot latch.
- Recommendation: track "was the *previous* `workspaceKey()` implicit" instead of a permanent boolean latch
  (e.g. compare against the previous value inside the effect, or drop the implicit slice whenever the key
  transitions away from `APPS_IMPLICIT_WORKSPACE`, regardless of how many times that has already happened).

### `recordFocusKey` materializes phantom slices for workspaces with no conversation

- Trigger: any `focusin` on a `[data-apps-focus-key]` control while the active workspace slice does not exist
  in `_slices` yet (e.g. a workspace the user has switched to but never started an Apps conversation in).
- Symptom: `AppsSessionService.recordFocusKey` → `patch(this.workspaceKey(), recordAppsFocusKey)` →
  `patchAppsSlice` (`apps-workspace-slice.ts:108-119`) reads the `EMPTY_APPS_SLICE` fallback
  (`lastFocusKey: null`), and `recordAppsFocusKey(EMPTY_APPS_SLICE, key)` returns a *new* object whenever
  `key !== null`, so `patchAppsSlice` allocates a fresh `Map` and inserts a full, otherwise-empty
  `AppsWorkspaceSlice` for that workspace key. Nothing ever removes it (it is not a conversation, so
  `discard()`/workspace-removal never targets it unless the workspace is later closed). Over a long session
  with many workspace switches, `_slices` grows with one phantom entry per workspace the user merely looked at.
- Evidence: `apps-session.service.ts:350-360` (`recordFocusKey`, no existence guard, unlike the new guard
  Batch 14 itself added to `discard()` at `:336-339` for the identical class of problem); `apps-workspace-slice.ts:79-85, 108-119`
  (`recordAppsFocusKey`, `patchAppsSlice`).
- Current handling: none — this is the same bug N3 fixed for `discard()`, reintroduced via the new write path
  Batch 14 itself added.
- Recommendation: guard `recordFocusKey` the same way `discard()` was just fixed — skip the patch (or use
  `removeAppsSlice`-style no-op) when `!this._slices().has(this.workspaceKey())` and the focus key would be
  the only reason to materialize the slice; or only record focus when a conversation already exists
  (`activeSlice().conversation !== null`), which also matches the directive's real use case (it restores focus
  for the Apps *conversation* UI, not an empty state).

### Host `tabindex="-1"` is unconditional, not fallback-only

- Trigger: the directive host always carries `host: { tabindex: '-1' }` (`apps-focus-memory.directive.ts:11-15`),
  regardless of whether a real control is found and focused.
- Symptom: this is benign for keyboard tab order (`-1` is excluded from the natural tab sequence in every
  browser), so it does not "steal" Tab-key focus and does not add the container to the accessibility tab
  order. The only observable side effect is that the container becomes *programmatically* focusable and, in
  Firefox/Safari, mouse-clickable-to-focus even when a real control was found and focused instead (clicking
  empty space inside the section could shift `document.activeElement` to the section itself in some browsers).
  This is a minor UX/accessibility nuance (an unlabelled container occasionally receiving a visible focus ring)
  rather than a functional defect, and it is required for the host-fallback case anyway (`restoreFocus()` at
  `:63-68` calls `this.host.focus()`, which requires the `tabindex`).
- Evidence: `apps-focus-memory.directive.ts:11-15, 63-68`.
- Current handling: as designed; no defect in the traced logic, flagged as a Moderate observability/UX note
  rather than a blocking behavioural bug.
- Recommendation: none required for this batch; if the visual/accessibility reviewer flags a stray focus ring
  on the section, consider `tabindex="-1"` only when no real control is found (would require restructuring the
  host binding into a signal), but this is out of scope for a logic review.

## Blocking issues

None.

## Serious issues

### `start()` has no post-await ownership guard on the success branch

- File: `libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts:209-217`
- Scenario: implicit-workspace `start()` in flight when the real workspace resolves mid-await (see Failure
  mode above).
- Impact: a live host-side agent turn becomes permanently unreachable from the client with no error shown to
  the user and no resource released on the host; this is a silent-failure and a resource-leak class defect,
  the exact category this task was asked to hunt for.
- Fix: add an `isAppsSliceOf` check after `chat:start` resolves successfully, symmetric to the one already
  used in `rollBackFailedStart`; release the orphaned conversation's claims if the slice no longer owns it.

### `recordFocusKey` materializes phantom workspace slices

- File: `libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts:350-360`;
  `libs/frontend/mcp-apps-page/src/lib/services/apps-workspace-slice.ts:79-85, 108-119`
- Scenario: focus lands on any `[data-apps-focus-key]` control while the active workspace has no slice.
- Impact: unbounded, session-lifetime growth of `_slices` for workspaces the user merely visited; reintroduces
  the exact bug class (N3) this same batch fixed one call site over.
- Fix: skip materializing a slice for a focus-only write; see recommendation above.

## Fix round 1 re-check

Re-verified against current source (not the fix report's claims alone) and re-ran
`npx nx run @ptah-extension/mcp-apps-page:test --skip-nx-cache`: 10/10 suites, 199/199 tests green (B13 files
present in the target but out of this review's scope, per the task boundary).

### 1. `start()` success-branch ownership guard — RESOLVED

`apps-session.service.ts:223-232`: after a successful `chat:start`, an `else if` checks
`isAppsSliceOf(readAppsSlice(this._slices(), key), conversation.routingId)` against the **original captured
`key`**, not the live `workspaceKey()` — correct, since ownership loss is about the slice at the key `start()`
claimed under, not the currently-active workspace. On loss, `abortUnownedStart` (`:497-510`) is awaited with
`result.data?.sessionId ?? (conversation.routingId as SessionId)` — the returned host session id when present,
else the routing id fallback. `abortUnownedStart` only calls `rpc.call('chat:abort', { sessionId })` inside a
try/catch that logs category-only warnings (`:504, :508`, no payload values) and **never touches `_slices`,
`patch`, or `patchOwned`** — it cannot re-create or double-release client-side state. Confirmed no double
release: `streamRouter.onSurfaceClosed` is asserted `toHaveBeenCalledTimes(1)` in the new spec
(`apps-session.service.spec.ts:508`) even though both the drop and the late-arriving success occur.

New spec `aborts a successful pending start after %s without recreating state or claims`
(`apps-session.service.spec.ts:467-514`, `it.each` over `['implicit drop', 'discard', 'workspace removal']`)
exercises exactly the scenario Serious #1 named: `start()` left pending via a manually-resolved mock RPC
promise, the owning slice released **while the RPC is still in flight**, then the mock resolves success. It
asserts the abort call's target id (both the returned-sessionId and the routingId-fallback branches, via the
`discard` vs other cases), that `_slices` is reference-unchanged after the late resolution (`toBe(afterRelease)`,
`:507`), and that claims/registry/inbox are not re-created. This is real coverage of the interleaving my
original finding said was untested — not merely the sequential case.

**Late-abort-vs-newer-conversation race** (explicitly asked): new spec `keeps a newer slice unchanged when
late-start abort fails by %s` (`:516-547`) starts an old conversation, discards it, **starts a second,
different conversation in the same slice key that succeeds and is live**, only then resolves the old pending
`chat:start` as success (triggering `abortUnownedStart` for the OLD session, which itself is made to fail by
transport rejection or host refusal). Assertions: `_slices` reference-unchanged from before the late resolution
(`toBe(newer)`, `:538`), `isActive()` still true, the inbox still claims the NEW routingId, and no leaked
payload text in `console.warn` calls. Source trace confirms why this is safe by construction, not just by
lucky test timing: `abortUnownedStart` receives only a standalone `sessionId: SessionId` value captured in the
OLD `start()` call's own closure (`:229-231`) and never re-reads `this._slices()`, `key`, or `conversation` from
outer scope for any write — there is no code path by which the late abort of an orphaned session could patch or
touch a newer conversation's slice.

**Addressing scheme correctness** (explicitly asked): `sessionId: tabId` (i.e. the routing/correlation id, not
a real Claude session id) is an existing, supported pattern elsewhere in the codebase — e.g.
`apps/ptah-cli/src/cli/commands/interact.ts:491`, `apps/ptah-cli/src/services/mcp/session-submit.service.ts:284,666`
all call `chat:abort` with `sessionId: tabId`. Traced to the host resolution:
`ChatSessionService.abortSession` (`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:967-976`)
→ `SdkAgentAdapter.interruptSession` (`sdk-agent-adapter.ts:1337-1343`) → `SessionLifecycle.endSession`
(`session-lifecycle-manager.ts:477-478`) → `SessionControl.endSession`
(`session-control.service.ts:160-171`), which calls `this.registry.find(sessionId as string)`. The same
registry is looked up by `rec.tabId` elsewhere in the same file (`:124, :148`), confirming it is dual-keyed by
both the real session id and the tab/correlation id — a lookup miss (already-ended, or a record that was never
created) returns `'already-ended'` with no error and no side effect (`:162-166`). There is no ambiguous- or
wrong-target risk: a stale/orphaned id either resolves to the correct orphaned record or safely no-ops.

**Verdict: RESOLVED.** File:line evidence above; both the originally-missing race and the newer-conversation
non-interference are now covered by source logic and by a real (non-tautological) spec that manually stalls the
mock RPC to force the interleaving.

### 2. `recordFocusKey` phantom-slice materialization — RESOLVED

`apps-session.service.ts:362-372`:
```
public recordFocusKey(key: string | null): void {
  try {
    const workspaceKey = this.workspaceKey();
    if (!this._slices().has(workspaceKey)) return;
    this.patch(workspaceKey, (slice) => recordAppsFocusKey(slice, key));
  } catch (error: unknown) { ... }
}
```
The existence guard mirrors `discard()`'s own fix. New spec `a focus record on a never-started workspace leaves
the slices map unchanged` (`apps-session.service.spec.ts:443-449`) asserts `service['_slices']()` is
reference-identical before and after the call (`toBe(before)`), the key is absent, and `lastFocusKey()` stays
null. This is a true no-op (no `Map` allocation, no signal notification), matching the `discard()` fix pattern
exactly.

**B14 focus-partition spec change** (explicitly asked): `records focus only in the active workspace slice and
restores each key` (`:557-570`) now calls `await service.start('Build in A')` and `await service.start('Build
in B')` before recording focus in each workspace, where the prior version recorded focus directly against
workspaces with no conversation. This is a legitimate adaptation, not a weakening: the guard now correctly
refuses to record focus for a non-existent slice, so a spec that wants to assert per-workspace isolation must
first make both slices exist. The test still exercises exactly the same isolation property it always did —
`composer` recorded in A, `table-filter` recorded in B, switching back to A reads `composer`, switching to B
reads `table-filter`, and `recordFocusKey(null)` clears it — nothing about the isolation assertions themselves
was removed or loosened.

**Verdict: RESOLVED.**

### 3. `hasResolvedWorkspace` one-shot latch — RESOLVED

`apps-session.service.ts:113, 164-175`: the permanent boolean latch is gone, replaced by
`previousWorkspaceKey: string = APPS_IMPLICIT_WORKSPACE` and a transition check inside the effect:
```
const key = this.workspaceKey();
const previous = this.previousWorkspaceKey;
this.previousWorkspaceKey = key;
if (previous === APPS_IMPLICIT_WORKSPACE && key !== APPS_IMPLICIT_WORKSPACE) {
  untracked(() => this.dropSlice(APPS_IMPLICIT_WORKSPACE));
}
```
Traced for the real → implicit → real sequence specifically asked about: starting real (`previous` becomes the
real key, no drop since `previous` wasn't implicit at that edge — the first transition from the initial
`APPS_IMPLICIT_WORKSPACE` default already drops once), then implicit (`previous`=real, `key`=implicit → no drop,
`previous` becomes implicit), then a new real key (`previous`=implicit, `key`=new-real → drop fires again,
since the condition only depends on the immediately-preceding value, not on any lifetime flag). This is a
correct edge-triggered transition detector, not a one-shot latch, and re-arms on every subsequent
implicit-to-real edge. New spec `drops the implicit slice on two separate implicit-to-real transitions`
(`apps-session.service.spec.ts:451-465`) exercises this with two loop iterations, each going
`null (implicit) → start → real path`, and asserts `streamRouter.onSurfaceClosed` was called exactly twice
(once per transition) and that claims/registry/inbox are released each time — this is precisely the
real → implicit → real pattern (the loop's second iteration starts from whatever real path the first iteration
left as `previous`, moves to implicit, then to a new real path), and it passes.

**Verdict: RESOLVED.**

### 4. `discard()` early-return regression check

`apps-session.service.ts:348-359`: `if (!this._slices().has(key)) return;` — still a true no-op (now not even
calling `_slices.update`/`removeAppsSlice` at all, an incremental simplification over the Batch-14-proper
version that called `removeAppsSlice` unconditionally; both are equivalent no-ops since `removeAppsSlice`
already short-circuited on a missing key). No regression. Re-confirmed by `discard on a workspace that never
started creates no empty slice (N3)` (`apps-session.service.spec.ts:552-557`), still present and passing
unchanged.

### Updated verdict

- Recommendation: **APPROVE**
- Confidence: HIGH
- Score: **8/10**
- Resolved: Serious #1 (`start()` success-branch ownership guard, including the harder in-flight race and the
  newer-conversation non-interference check), Serious #2 (`recordFocusKey` phantom-slice materialization),
  Moderate (`hasResolvedWorkspace` one-shot latch → edge-triggered `previousWorkspaceKey`). `discard()`'s N3 fix
  confirmed still correct, no regression.
- Still open (both previously Minor/Moderate, non-blocking): the host `tabindex="-1"` UX/accessibility note on
  `AppsFocusMemoryDirective` (unchanged this round, not in scope of the fix); no new issues found in the delta.
  The one remaining item from the original review not re-litigated here — whether `AppsPageComponent` truly
  remounts on every workspace switch so the directive's one-shot `afterNextRender` restore fires per switch —
  is still a B15 wiring concern, not a Batch 14 defect, and was already noted as carried forward.
- Score rationale: raised from 6/10 to 8/10. Both Serious findings are resolved with source evidence and
  non-tautological specs that force the exact interleavings in question (a stalled mock RPC promise, not just
  sequential await); the remaining open item is a Minor/observational note with no functional impact traced.
  Not raised to 9-10 because the review scope this round was narrow (the delta only) and the wider batch
  (directive + full session service) was already reviewed at that ceiling in the original pass.

## Moderate and minor issues

- `hasResolvedWorkspace` is a permanent one-shot latch (`apps-session.service.ts:112, 166`); it should track a
  transition, not a lifetime event, so a second implicit→real transition is still handled. Moderate.
- Host `tabindex="-1"` is unconditional (`apps-focus-memory.directive.ts:11-15`); minor UX/accessibility note,
  not a functional defect. Minor.
- The new N2 spec (`apps-session.service.spec.ts:459-484`) only exercises the sequential (already-resolved)
  interleaving; it does not exercise the in-flight race identified above. Minor test-coverage gap (paired with
  the Serious finding it should have caught).

## Data flow

1. `focusin` bubbles to the directive host → `event.target.closest('[data-apps-focus-key]')` finds the nearest
   tagged ancestor-or-self, confirmed to be inside the host → `AppsSessionService.recordFocusKey(key)`. OK,
   except no existence guard on the target slice (see Serious finding).
2. `recordFocusKey` → `patch(workspaceKey(), recordAppsFocusKey)` → `patchAppsSlice` → new `Map` with the
   updated (or newly materialized) slice. OK for an existing conversation slice; gap for a non-existent one.
3. Directive construction → `afterNextRender(() => this.restoreFocus())` (one-shot, fires once per directive
   instantiation, i.e. once per `AppsPageComponent` mount) → reads `session.lastFocusKey()` (workspace-scoped
   via `activeSlice()`) → scans `querySelectorAll('[data-apps-focus-key]')`, direct attribute comparison (no
   selector injection), `canFocus` gate (connected, not disabled/aria-disabled, not inside `[hidden]`/`[inert]`,
   focusable tag/attribute allow-list, not `display:none`/`visibility:hidden` up the ancestor chain) → `.focus()`
   → verifies `activeElement === control` before returning; else falls through to `host.focus()`. OK, matches
   the plan's "restore to the recorded key, or the host fallback" (Req 7.6), and matches D1's remount-on-
   workspace-switch design (the directive doesn't need to react to live `workspaceKey()` changes because the
   plan's routing design remounts `AppsPageComponent` on a workspace switch — confirmed by
   `implementation-plan.md:142-158`, "a workspace switch while on Apps navigates to the incoming workspace's
   own surface... returning restores `apps` from that workspace's view slice").
4. `DestroyRef.onDestroy` removes the `focusin` listener and calls `render.destroy()` (cancels the pending
   `afterNextRender` callback if not yet fired). OK — no leaked listener or pending callback traced.
5. `discard()` on a workspace with no slice: early-returns via a true `Map`-identity no-op
   (`removeAppsSlice` returns the same reference when the key is absent, `apps-workspace-slice.ts:122-130`), so
   the signal `.set()` call does not notify subscribers. OK — N3 is genuinely fixed for this call site.
6. `dropSlice(APPS_IMPLICIT_WORKSPACE)` fired from the new constructor effect: reuses the same `teardown()` as
   `discard()` (inbox release, workflow-claim release, `streamRouter.onSurfaceClosed`, `sync.dispose()`), then
   removes the map entry. OK when the conversation is not simultaneously in the middle of `start()`'s await;
   gap when it is (see Serious finding).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Req 7.6 — record last-focused control per workspace, restore on init or host fallback | COMPLETE | None found; real-DOM spec confirms restore-per-slice via remount, host fallback, and safe handling of adversarial keys. |
| Batch 12 N2 — boot-window implicit conversation dropped on first real workspace | PARTIAL | Fixed and tested for the sequential case (start already resolved); the in-flight interleaving during `chat:start`'s await is unguarded and untested, and the one-shot `hasResolvedWorkspace` latch does not re-arm for a second implicit window later in the session. |
| Batch 12 N3 — `discard()` must not materialize an empty slice for a missing key | COMPLETE (for `discard()`) | The identical defect class is reintroduced by this same batch's new `recordFocusKey` write path, which has no equivalent guard. |
| "Same file owner" scope-widening note — B13 must not touch these three files | COMPLETE | Verified via `git diff --stat`: only `apps-session.service.ts`, `apps-session.service.spec.ts`, `apps-workspace-slice.ts` changed, matching the announced scope. |
| B12 spec assertions/fixtures unchanged | COMPLETE | `git diff` on `apps-session.service.spec.ts` is a pure unified-diff addition (three new `it` blocks inserted after existing content, zero `-` lines against original assertions/fixtures). |

Implicit requirements not addressed: robustness of the implicit-drop effect against a `start()` still in
flight (the plan's "same file owner fixes N2" note did not anticipate that fixing N2 would introduce a new,
adjacent race — see Serious finding).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Focus key with `"`, `'`, `[`, `]` | YES | Direct attribute comparison, no selector interpolation (`apps-focus-memory.directive.spec.ts:108-116`) | None |
| No matching control (missing/detached/disabled/hidden/inert/non-focusable) | YES | `canFocus` gate + host `tabindex="-1"` fallback, all six variants pinned by `it.each` | None |
| Directive destroyed before `afterNextRender` fires | YES | `render.destroy()` in `onDestroy` | None |
| `control.focus()` throws | YES | Caught, falls to host focus | Falls back to host rather than trying a second matching element (acceptable per contract) |
| Workspace switch while directive is live (no remount) | N/A per design | Directive relies on `AppsPageComponent` remount per workspace switch (D1 routing behaviour) | Not verified in this batch — depends on B15/B16/B17 wiring the route/remount correctly; carry forward to B15 review |
| `discard()` on a never-started workspace | YES | True no-op, verified by identity check in the new spec | None |
| `recordFocusKey` on a never-started workspace | NO | Materializes a phantom slice | Serious finding above |
| `start()` in flight when the implicit-drop effect fires | NO | No post-await ownership check on the success branch | Serious finding above |
| Implicit workspace re-entered after a real workspace was already resolved once | NO | `hasResolvedWorkspace` is a permanent latch | Moderate finding above |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: `start()`'s success path has no ownership guard against the new implicit-drop effect firing
  mid-await, so a boot-window conversation can succeed on the host and become permanently unreachable and
  unreleased on the client with zero user-visible error — a silent resource leak in exactly the area (N2) this
  batch was scoped to fix.
- What a robust implementation would add: (1) a post-await `isAppsSliceOf` check in `start()`'s success branch,
  mirroring the one already used on the failure branch, with a spec that drops the implicit slice while
  `chat:start` is still pending; (2) re-arming (not one-shot) tracking for the implicit→real transition so a
  second occurrence in the same session is still handled; (3) an existence guard in `recordFocusKey` so a
  focus event alone cannot materialize a permanent slice for a workspace with no conversation, matching the
  guard this same batch just added to `discard()`.
