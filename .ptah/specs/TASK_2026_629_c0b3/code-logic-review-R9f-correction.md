# Code Logic Review R9f-correction - TASK_2026_629_c0b3

Review family: Claude (reviewer) vs codex (implementer). Scope: the post-cap correction of N1, N2 and N3 only (decisions.md row 98). I made no source edits and ran no git commands that change state.

Read in full: `canvas-detail/canvas-lane-view.component.ts` (all 398 lines) and its spec (lines 255-436 plus the Stop case), `canvas-detail/canvas-lane-tabs.component.ts` (all 244 lines) and spec (lines 1-140), the `git diff` of the lane-tabs files. Read for integration: `canvas-rail/canvas-focus-area.component.ts`, `canvas-detail/canvas-detail.service.ts`, `canvas-detail-transcript.component.ts:40-90`, `chat/.../compact-lane-rows.ts:21-41`, `chat-streaming/.../agent-monitor.store.ts:560-625,955-975`.

Ran two scoped specs through the lock, one at a time:

| Run | Spec | Result |
| --- | --- | --- |
| rr2-r9f-1 | `canvas-lane-view.component.spec.ts` | 16/16 pass |
| rr2-r9f-2 | `canvas-lane-tabs.component.spec.ts` | 7/7 pass |

I ran no typecheck, lint or full suite. I did not mutate the source, so "fails if the fix is removed" below is derived by tracing the code against the assertion, not by a run.

## Summary

| Metric | Value |
| --- | --- |
| Score | 8/10 (was 7/10) |
| Verdict | APPROVED (residuals below are recorded, not blocking) |
| N1 / N2 / N3 | FIXED / FIXED / FIXED |
| New defects from the correction | 0 Blocking, 0 Serious, 0 Moderate, 3 Minor |
| Pre-existing residuals surfaced | 1 Moderate-to-Minor (reverse key migration), reachability unverified |

Why 8, not 7: all three findings are closed at the cited lines, with specs that would turn red if the fix were removed (except one redundant spec, noted below), and I found no regression in the focus, tablist, lane selection, dock or HIDE_AGENT_SIDEBAR checks. Why not 9: the key-migration is one-directional, the opener is not cleared on a non-host open, and the first-mount spec does not isolate the guard it names.

## Per-finding table

| Finding | Status | Code | Spec | Fails if the fix is removed? |
| --- | --- | --- | --- | --- |
| N1 focus steal | FIXED | `canvas-lane-view.component.ts:260-284` | `:383-401`, `:403-417`, `:419-435`, main case `:312-381` | Yes for the strip and tabId-swap cases (see below). The mount case is redundant coverage. |
| N2 lane tabs undo M2 | FIXED | `canvas-lane-tabs.component.ts:164-170`, emit at `:173-176` | tabs spec `:101-117`, view spec `:282-297`, unknown key `:75-99` | Yes. Without the `bg:` branch, `selectedKey` returns `orchestrator`, the emit is `orchestrator`, and the `toHaveBeenCalledWith('bg:x')` and `not.toHaveBeenCalledWith('orchestrator')` assertions fail. |
| N3 weak Stop guard | FIXED | spec `canvas-lane-view.component.spec.ts:385-387` | same | Yes. Any restored lane Stop whose text or aria label starts with "Stop" makes the count 2. |

## N1 detail

Focus is moved to Back only when all of these hold: the tab id is unchanged since the last run, the previous kind was `orchestrator`, the new kind is not, and `activeElement` is inside the host (`:266-282`).

- Open from lane-view content: the opener is captured (`:275`) and Back receives focus after render (`:276-280`). The main spec asserts `activeElement === back` (`:340`), then opener restore on Back (`:345`), Escape on a non-editable target (`:366-367`), a removed opener falling back to the draft (`:380`), and Escape ignored in a textarea (`:361-362`). These pass.
- Open from the tab strip: the strip is a sibling of the lane view in `canvas-focus-area.component.ts:48-59`, so focus is outside the host, the guard is false, and focus stays on the tab. This also fixes arrow-key tablist navigation (`canvas-lane-tabs.component.ts:233-237`). Spec `:383-401` focuses a button outside the host and asserts it keeps focus. Removing the host-contains check puts focus on Back and fails it.
- tabId swap: the first branch returns after resetting `opener` and `previousKind` to the new tab's kind (`:266-271`). Spec `:403-417` puts a focused button inside the host and swaps tabId and laneKey together. With the branch removed, previous kind would be `orchestrator`, the new kind a lane, and focus inside the host, so Back would be focused and the spec would fail.
- First mount with an open lane: `previousKind` starts `undefined`, so the first run cannot satisfy `=== 'orchestrator'`. This is correct. Spec `:419-435` focuses a button outside the host, so it would also pass without the first-run branch, because the in-host check alone already blocks it. It proves behaviour, not that guard in isolation. Minor.
- Opener reset on tabId change: done at `:267`.

## N2 detail

- `selectedKey` (`:164-170`) keeps a listed key, maps an unlisted `sub:<id>` to `bg:<id>` when that tab exists, and otherwise returns `orchestrator`. Unknown keys still reset (spec `:75-99`).
- No emit loop. The effect (`:173-176`) emits only when `laneKey() !== selectedKey()`. After the parent stores `bg:x` (`canvas-focus-area.component.ts:50-51`, `detail.selectLaneFor` accepts any parseable key, `canvas-detail.service.ts:22-25`) the two are equal and the effect stops. If the tile is gone and the service refuses the key, the effect does not re-run because its dependencies did not change. No loop in either branch.
- `aria-labelledby` (`canvas-lane-view.component.ts:63`) matches the tab id once the parent key becomes `bg:x` (view spec `:282-297`, id `canvas-lane-panel-tab-bg:task-tool`). There is a one-tick window in which the lane view still holds `sub:x` while the tabs component already highlights `bg:x`. It heals on the next change detection. Not a finding.
- The lane view does not reset a `sub:` lane whose record turns `background` (`selectedKind` does not read status, `:224-234`), and view spec `:264-280` covers it. So the lane never reverts to the orchestrator in either component.

## N3 detail

`canvas-lane-view.component.spec.ts:385-387` counts every `button` in the rendered lane whose trimmed text or aria label begins with "Stop" and requires exactly one. The bubble button matches (the test would otherwise read 0), and the permission Deny/Allow buttons do not, because their label contains "stop execution" but does not start with it. A restored lane-level Stop with the usual text or label would make the count 2. An icon-only button with an unrelated label would slip past, but that is not a plausible restoration.

## New defects (introduced by the correction)

None above Minor.

1. Minor. Stale opener. `canvas-lane-view.component.ts:272-282`: `opener` is set only when the open happens with in-host focus and is cleared only in `back()` (`:376`) and on tabId change. Sequence: open from content (opener = X), switch to Orchestrator through the tab strip (not `back()`), open another lane through the strip, then press Back. Focus goes to X, the old in-content element, rather than the composer fallback. It is harmless because X is still the user's earlier location, and it only occurs on a mixed strip and content path. Fix: set `this.opener = null` on every open edge that has no in-host focus, or when the kind returns to `orchestrator`.
2. Minor. Late-resolving record. If a lane key is already stored and its record resolves after mount, `previousKind` is `orchestrator` and the edge fires. A user typing in the composer at that moment gets focus moved to Back. This needs a stored lane key whose record arrives late, which is rare, and the old code had the same trigger. Fix, if wanted: also require that the previous `laneKey` was `orchestrator`.
3. Minor. Spec isolation: `canvas-lane-view.component.spec.ts:419-435` (see N1 detail).

## Pre-existing residuals surfaced by the review (not caused by the correction)

- Reverse migration (Moderate-to-Minor, reachability unverified). `canvas-lane-tabs.component.ts:164-170` maps `sub:x` to `bg:x` but not `bg:x` to `sub:x`. If a record leaves `background` for `completed`, its tab moves from the Background group (`:141-161`) back to Sub-agents, the stored `bg:x` key is unlisted, and the lane resets to the orchestrator. That is the same user-visible bounce the correction fixed in one direction. Counter-evidence: `agent-monitor.store.ts:970` calls `status === 'background'` "a type-level guard" with `BackgroundAgentStore` as "the real source". So the status may rarely or never be set in production, in which case neither direction fires and the N2 path is inert but harmless. I did not trace the reducers. Record it as a follow-up with a decision, as decision 93 does for N4.
- Remount on migration. `canvas-lane-view.component.ts:73` tracks the lane by `tabId + ':' + laneKey`, so `sub:x` to `bg:x` destroys and recreates the lane content (replays the enter animation, drops in-lane UI state such as a half-typed send message, and loses focus if it was inside the lane). Back is outside that `@for` (`:70-72`) so it survives. Escape then only works after focus returns to the host. Minor.
- N4 (Escape closes the lane on any unhandled Escape) stays as recorded, unchanged.

## Regression check

| Check | Result |
| --- | --- |
| Keyboard tablist (arrow, Home, End) | OK. Focus stays on the strip. Tabs spec "moves between tabs with arrow keys" passes (7/7). |
| Lane selection / Back / Escape / opener restore | OK. Main focus spec passes. |
| Display dock (row 77), retention | Untouched by this correction. The diff is confined to the four named files. |
| HIDE_AGENT_SIDEBAR | Absent from all non-spec source. The only hits are `toBeNull()` assertions at `canvas-detail-transcript.component.spec.ts:116,166`. OK. |
| Foreign / unresolved owners | Unchanged `ownedBySession` usage (`canvas-lane-tabs.component.ts:100-114`). OK. |
| Stale-record reset | A `sub:` or `cli:` key with no listed or migratable tab still resets to the orchestrator (spec `:75-99`). OK. |

## Five logic questions (scoped)

1. Silent failure: none new. The only silent path is focus not moving (no in-host focus), which is the intended outcome.
2. Unexpected user action: strip click and arrow keys no longer move focus. Strip then Back may land on a stale opener (Minor 1).
3. Wrong-answer input: `sub:<id>` slicing assumes the `sub:` prefix is 4 characters (`:168`), which `LANE_KEY_PREFIX` guarantees (`compact-lane-rows.ts:21-25`). An id containing colons is preserved by `slice(4)`.
4. Dependency failure: the parent refusing the emitted key (tile closed) leaves the key stale, with no loop.
5. Missing: reverse migration and the remount noted above. Neither was required by N1-N3.

## Verdict

- Recommendation: APPROVED.
- Confidence: HIGH on the code paths and the two passing specs. MEDIUM on real-browser focus timing (jsdom has no `display:none` focus loss and no mac Safari button-focus quirk), and MEDIUM on production reachability of the `background` status.
- Top risk: the one-directional `sub:`/`bg:` migration. If `background` does occur in production, the completion transition still bounces the user to the orchestrator.
- Per agent-lanes section 6 these are reported, not fixed. Suggested record: reverse-migration follow-up and a `opener = null` clear on non-host opens, both small and independent of the merge.
