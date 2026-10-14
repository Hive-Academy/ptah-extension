# Code Logic Review R9f-fix — TASK_2026_629_c0b3

Review family: Claude (reviewer) vs codex (implementer). Scoped re-review of the R9f fix round only.

Scope read in full: `canvas-detail/canvas-detail-transcript.component.ts` (+spec), `canvas-detail/canvas-lane-view.component.ts` (+spec). Read for integration: `canvas-detail/canvas-lane-tabs.component.ts`, `canvas-detail/canvas-detail.service.ts`, `canvas-rail/canvas-focus-area.component.ts`, `inline-agent-bubble.component.ts:1090-1115`, `single-chat-subagent-view.component.ts:81-125`, `chat.store.ts:192,477`. Ran one scoped spec through the lock: `canvas-lane-view.component.spec.ts` (rr-r9f-1): 12/12 pass. I did not re-run the transcript spec (the fix report shows 8/8). I ran no typecheck or lint. I mutated no source.

## Summary

| Metric | Value |
| --- | --- |
| Score | 7/10 (was 5/10) |
| Verdict | APPROVE-WITH-FIXES |
| Findings closed | S1, S2, S3, S4, S5a-g, M1, M5 |
| Not closed end to end | M2 (lane view is right, but the lane tabs component still collapses the lane) |
| New defects | 1 Moderate (focus pulled from the tab strip), 2 Minor |
| Blocking / Serious new | 0 / 0 |

Why 7, not 5: every Serious item from the original round is now closed with specs that touch the real component (real `ChatViewComponent`, real `ExecutionNodeComponent`, real transcript), and I found no regression in the dock (row 77), retention or `HIDE_AGENT_SIDEBAR` (absent from all non-spec source under `libs/frontend/canvas/src`). Why not 8 or higher: the M2 fix is only half of the path (the `sub:` to `bg:` background flow still ends on the orchestrator in the product), and the new focus effect steals focus from the tab strip.

## Per-finding table

| Finding | Result | Evidence | Can the spec fail if the fix is removed? |
| --- | --- | --- | --- |
| S1 visible-set registration | FIXED | `canvas-detail-transcript.component.ts:49-50` splits `parentActive` and `active = parentActive && visible`. `:72-83` registration reads `parentActive` only, so `visible` no longer touches it. `:54-55,60` feed `active` to SESSION_VISIBLE, SESSION_FOCUSED, SURFACE_ACTIVE. Cleanup is unregistered on parent deactivate (effect cleanup) and on destroy. The tile-owned case still does not register (`:76`), so there is no double owner. | Yes. Spec `canvas-detail-transcript.component.spec.ts:315-350` asserts the id stays registered with `visible=false` while the three tokens read `false`, then asserts unregister after `parentActive.set(false)`. Reverting to `active()` for registration fails line 341. |
| S2 display opens and updates in place in Rail host | FIXED (naming caveat) | Spec `:59-149` mounts the real `CanvasDetailTranscriptComponent` with the real `ChatViewComponent` under the real `childInjector` (`environmentInjector` outlet). It asserts `HIDE_AGENT_SIDEBAR` is null (`:116`), the Rail retention and card actions tokens (`:117-118`), a real `DisplayDockState` taken from the ChatView injector, auto-open, exactly one `ptah-display-dock` (`:133`), the same `RailDisplayPanelStub` instance after the update (`:134`), the updated surfaces (`:135`), and the same ChatView and panel across a `visible` false/true round trip (`:136-143`). | Yes. Restoring `HIDE_AGENT_SIDEBAR` fails `:116` and the dock would not render. Breaking the child injector fails the panel lookup. Removing the dock fails `:128`. Caveat: the surfaces are fed through the store (as `chat-view.dock.spec.ts:927-951` does). No fenced markdown is parsed, so the test name over-claims. The fence-to-surface path is the chat lib's own coverage, which decision 93 accepts. |
| S3 persistent ChatView and draft | FIXED | Lane spec `:295-364` keeps the real `CanvasDetailTranscriptComponent` with a stub ChatView. It asserts the same transcript instance and the same ChatView instance across `orchestrator`, `sub:`, `orchestrator` (`:317-318,330`). It asserts SESSION_VISIBLE, SESSION_FOCUSED, SURFACE_ACTIVE are `false` while covered and `true` after Back (`:319-321,332`), and that the same textarea element keeps its value (`:329,331`). The transcript spec adds the real-ChatView identity check (`:136-143`). Source: transcript sits outside the keyed block (`canvas-lane-view.component.ts:67-69`), with `[visible]` bound at `:68`. | Yes. Moving the transcript into the keyed `@for` changes the instance and fails `:317`. Dropping `[visible]` fails `:319`. |
| S4 focus and Escape | FIXED for the contracted path, with new defect N1 | Open: effect `canvas-lane-view.component.ts:262-272` captures the opener only if the focused element is inside the host, then `afterNextRender` focuses the Back button. Back/Escape: `:357-366` restores the opener if connected, else the composer textarea or contenteditable, else the transcript host (now `tabindex=-1`, `canvas-detail-transcript.component.ts:35`). Escape: `:368-374` ignores `defaultPrevented`, the orchestrator lane, and events from input, textarea, select or contenteditable. Not stolen when the lane is not open: the effect fires only on the orchestrator to non-orchestrator edge. | Yes. Spec `:295-364` asserts `document.activeElement` is Back after open (`:323`), the opener after Back (`:328`), and the opener after Escape (`:354`). It also asserts Escape on the orchestrator does nothing (`:335-336`), Escape from a textarea does nothing (`:341-345`), and the composer fallback when the opener is gone (`:363`). Removing the focus code fails `:323`. |
| S5a Stop | FIXED | Spec `:366-407` mounts the real `ExecutionNodeComponent` (`:367-369,380-382`), clicks the bubble's `subagent-stop-button`, and asserts `stopAgent('task-1','owner')` (`:383-386`). | Yes for "bubble Stop is wired". Weak for "lane Stop is gone" (see N3). |
| S5b steer | FIXED | `:387-394` opens the send box, types, submits, and asserts `sendMessageToAgent('task-tool', text, 'owner')`. | Yes. Fails if the real node is not mounted. |
| S5c copy | FIXED (per decision 97) | `:409-436` expands a nested tool card in the real node and finds `ptah-copy-text-button` or `ptah-copy-button`. | Yes. A null header (node not mounted) fails `:432`. |
| S5d background | FIXED in the lane view only (see M2) | `:399-405` clicks the bubble's Background button, asserts `backgroundAgent('owner','task-tool')`, then flips the record to `background` and asserts the lane stays `subagent` with the same node. | Yes at component level (`:277,404`). Does not cover the focus-area composition. |
| S5e full node, tile mode off, permission | FIXED | `:381-382` assert the real instance's `node()` and `agentTileMode() === false`. `:395-398` click the bubble's Allow and assert `chatStore.handlePermissionResponse` receives `{id:'perm-1', decision:'allow'}`. | Yes. The `(permissionResponded)` binding at `canvas-lane-view.component.ts:154` is exercised. `agentTileMode` defaults to `false` anyway, so that one assertion is weak, but it is not the only one. |
| S5f nested depth-2 | FIXED | `:282-293` opens `sub:nested` with a node nested under another agent and asserts `agentNode()` is the nested one and the node renders. | Yes. Fails if `findAgentNode` stops recursing (`canvas-lane-view.component.ts:377-385`). |
| S5g Rail tile click | FIXED (scope-limited) | Spec `:150-175` instantiates a real component under the real `childInjector` that injects `SESSION_CARD_ACTIONS`, clicks it, and asserts `selectLaneFor('parent','sub:tool')`. Source: `canvas-detail-transcript.component.ts:62-68`. The test tile hard-codes `'sub:tool'`, so the real `SubagentTile` to key mapping (`subagent-tile.component.ts:96-99`) is not exercised. | Yes for the token and tab id wiring. The `ptah-single-chat-subagent-view` null assertion is still trivially true (template is `''`), but it is no longer the only evidence. |
| M1 single owner for Stop and permission | FIXED | The lane-header Stop and permission group are deleted. The sub lane renders only `ptah-subagent-usage-summary` and the real `ptah-execution-node` (`canvas-lane-view.component.ts:145-171`). Outputs are wired exactly as in `single-chat-subagent-view.component.ts:83-84`: `[getPermissionForTool]` from `chatStore`, `(permissionResponded)` to `chatStore.handlePermissionResponse` (global, not tab-scoped, `chat.store.ts:477`). CLI lane permission controls are kept (`:79-108`). | Permission: yes. Spec `:193-218` asserts no `[aria-label="Permission request"]` and no `respondSession`, with a matching request present. Restoring the old group would render it and fail. Stop: weak (N3). |
| M2 background keeps the same lane | PARTIAL (not fixed end to end) | Lane view: `selectedSubagent` `:202-214` now matches by `parentToolUseId` regardless of status, and the spec `:264-280,402-405` passes. But `canvas-lane-tabs.component.ts:124-126,141-150` moves a backgrounded record from a `sub:` tab to a `bg:` tab, and `:164-168,171-174` then see the stored `sub:x` key as missing and emit `laneSelected('orchestrator')`. The focus area wires that to `detail.selectLaneFor` (`canvas-focus-area.component.ts:51`). In the product the lane still collapses to the orchestrator on Background. | The lane-view spec fails if the status filter returns. No spec composes lane tabs with the lane view, so the product behaviour is untested. |
| M5 failed stop unobserved | FIXED by removal in the lane | `stop()` and `stopping` are deleted from `canvas-lane-view.component.ts` (no matches). The bubble's own `onStopClick` (`inline-agent-bubble.component.ts:1090-1100`) has the same try/finally shape with no catch. That is the chat lib and out of R9f scope. Residual: a failed Stop from the Rail lane is still an unobserved rejection, now owned by the bubble. | Not a testable behaviour in the lane any more. |

## New defects and residuals

### N1 (Moderate). Back-focus effect steals focus from the lane tab strip and on tab swap or mount

- File: `canvas-lane-view.component.ts:260-272`.
- Cause: the effect fires on any `selectedKind` edge from `orchestrator` to non-orchestrator, and `afterNextRender` always focuses Back. It does not check that the open came from inside the lane view.
- Scenario A: the user clicks a lane tab, or arrows through the tablist (`canvas-lane-tabs.component.ts:213-236` focuses the next tab right after emitting). The lane view then moves focus to Back. Keyboard users lose the tablist after one arrow press onto a non-orchestrator tab. Opener is `null` in this case (focus was outside the host), so Back later falls back to the composer, not the tab.
- Scenario B: the focus area keeps one lane-view instance and swaps `tabId`/`laneKey` (`canvas-focus-area.component.ts:54-58`). Swapping focus from an orchestrator tab to one with an open lane, or mounting with a lane already open (the initial `previousKind` is the default `'orchestrator'`, line 261), also focuses Back.
- Impact: a keyboard and focus regression, not data loss. It is the "no focus steal" check from the brief: the contracted case (lane not open) passes, these adjacent cases do not.
- Fix: only focus Back when an opener was captured inside the host (the user acted in the lane view content), or when the host already contains focus. Add a case that opens through the tab strip and asserts focus stays on the tab. Reset `opener` and `previousKind` on `tabId` change.

### N2 (Moderate, carried M2). Lane tabs undo the "same lane" fix

- File: `canvas-lane-tabs.component.ts:124-126,141-150,164-174` (outside the 8 R9f files), integrated through `canvas-focus-area.component.ts:48-52`.
- Impact: clicking Background in a live lane still ends on the orchestrator, focus is lost to `body` (neither `back()` nor the opener path runs), and `aria-labelledby` (`canvas-lane-view.component.ts:63`) points at a tab id that no longer exists in the tablist.
- Fix (smallest): in `CanvasLaneTabsComponent`, keep a record the user opened under `sub:` visible under its current key by treating `laneKey()` as satisfied when it resolves to the same `parentToolUseId` under either kind, or migrate the stored key to `bg:<id>` with `laneSelected` instead of the orchestrator reset. Add a focus-area level spec with the real lane tabs plus the real lane view. Decision 93 limits the round to 8 files, so this needs a decision or a recorded follow-up, not silence.

### N3 (Minor). Weak regression guard for the duplicate Stop

- File: `canvas-lane-view.component.spec.ts:383-386`. The bubble's button is found by `data-testid`. The deleted lane Stop had no testid, so restoring it keeps the spec green. Assert exactly one Stop button in the rendered lane (`querySelectorAll('button')` filtered by text), as the permission case already does for its group.

### N4 (Minor). Escape closes the lane on any unhandled Escape inside the lane

- File: `canvas-lane-view.component.ts:368-374`. Escape pressed to dismiss a popover or dropdown inside the full node closes the lane unless that widget calls `preventDefault`. It is the same behaviour as the single view, and the guard covers editable controls, so this is only noted.

## Regression check

- Dock (row 77): the dock and `Displays/Agents` still render under the Rail host, shown by the real-ChatView spec (`transcript spec :127-135`). No change to dock providers. OK.
- Retention: `RAIL_TRANSCRIPT_RETENTION` provided at `canvas-detail-transcript.component.ts:61` and asserted at spec `:117`. OK.
- `HIDE_AGENT_SIDEBAR`: absent from every non-spec file in `libs/frontend/canvas/src`. Present only in spec `expect(...).toBeNull()` assertions. OK.
- Visible-set: no new leak. Register is on `parentActive` only, with cleanup on deactivate and destroy (spec `:264-313,315-350`). OK.
- Transcript fetch: `agentNode()` guard in the load effect (`canvas-lane-view.component.ts:288`) and in `loadTranscript` (`:317`) means no RPC fetch while the live node exists, and the fetch resumes (with a version bump) if the node disappears. OK.
- Removed `PermissionHandlerService` and `stop()` leave no dead imports in the lane component. OK.

## Verdict

- Recommendation: APPROVE-WITH-FIXES.
- Confidence: HIGH on S1 to S5, M1, M5 (read source plus one passing re-run). HIGH on the N2 code path (all three lines read). MEDIUM on the real-browser behaviour of N1, since jsdom has no `display:none`.
- Top risk: Background from inside the live lane still returns the user to the orchestrator because the lane tabs component resets a `sub:` key whose record has become `background` (N2).
- Before merge: close N2 (or record it as a decision with an owner) and gate the Back focus on an in-host opener (N1). N3 is a one-line assertion.
