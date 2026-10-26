# Revision 2 implementation report

Implemented changes for the requested items 1–8 in canvas, chat and chat-ui. This pass is incomplete: verification failed and final corrections remain unverified. No git operations, host builds, browser automation or interaction with the running Electron app were performed.

## Item evidence

Paths below are relative to the worktree root. Adjacent specs use the same directory as their component.

| Item | Implementation | Verification |
| --- | --- | --- |
| 1. Sidebar-only identity and strip | `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.ts:49` renders controls only in split; `canvas-focus-header.component.ts:44` contains controls without identity; `libs/frontend/chat/src/lib/components/organisms/session-inspector/session-inspector.component.html:27` and `:128` own rail/expanded identity and strip projection. | `canvas-focus-area.component.spec.ts:176` covers single/split absence; `canvas-focus-header.component.spec.ts:48` covers rail and expanded controls without identity. |
| 2. Sidebar controls | `canvas-inspector-dock.component.ts:114`, `:195`, `:256` project Stop, view toggle, menu and Close; `canvas-rail-board.component.ts:378` forwards Close. Compact-sheet and split-sheet projections use the same controls. | `canvas-focus-header.component.spec.ts:62` tests outputs; `:110` checks focus when Stop disappears. |
| 3. Split floating controls | `canvas-focus-area.component.ts:49` places the controls absolutely, with hover/focus visibility; the sidebar reads the focused tab. | `canvas-focus-area.component.spec.ts:176`, `:323`; `canvas-focus-header.component.spec.ts:77` tests split actions and Escape. |
| 4. Compact active-agent icons | `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:294` chooses up to five running/waiting agents, with orchestrator fallback; `:212` adds +N; `canvas-inspector-dock.component.ts:367` selects and expands; session-inspector removes the Run count tile while retaining attention and limit indicators. | `canvas-lane-tabs.component.spec.ts:143`, `:171` cover icons, shared tooltip, selection, overflow and fallback; dock spec covers expansion and selection. |
| 5. Two-row expanded strip | `canvas-lane-tabs.component.ts:299` reserves row space for the orchestrator and labelled agents menu, sends remaining avatars into overflow; `:222` prevents compact/count-only menu text. | `canvas-lane-tabs.component.spec.ts:180` checks row capacity and visible agents label. Actual browser geometry still needs visual review. |
| 6. Narrow overlay | `canvas-inspector-dock.component.ts:345` switches to overlay when remaining chat width would be below 560px (and for split), caps the sheet at viewport width, reserves only 56px in flow and hides the resize grip. Existing sub-400 sheet behavior remains. | Dock spec covers 400/900px overlay, width allocation and rail selection; board spec updates narrow resize expectations. |
| 7. Lane usage mapping | `libs/frontend/chat/src/lib/services/session-stats/session-stats-source.ts:88` shares the lane-card segment fallback. `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-tiles.ts:119`, `:666`, `:731` expose partial totals with ≥. The view-model type accepts the partial marker. | `session-stats-source.spec.ts` tests input/output/cost fallback, structured-total precedence, unknown values and partial lane subtotal. |
| 8. Hand off and tooltip | `session-inspector.component.html:128` aligns the existing ghost Hand off button with the title. `canvas-lane-tabs.component.ts:230`, `:484` and `agent-dock-card.component.ts` render the sidebar hover card in flow below avatars, reserving space above Session tiles; rail cards open left. | Existing Hand off tests plus controls-menu coverage and shared avatar tooltip tests. No fresh Electron screenshots taken. |

## Root cause of item 7

Agent cards already call `usageTotalsFromSegments` when structured `agent.usageTotals` is absent. The session-inspector mapper forwarded only structured totals, so the card displayed segment-derived input/output/cost while lane tiles and Known subtotal received no usage. The mapper now uses the same helper, preserving its partial marker. Structured totals take precedence. Session Cost remains sourced from session usage: lane subtotals are never promoted into session totals, and missing session cost remains unknown.

## Capability moves

| Capability | Previous location | New location |
| --- | --- | --- |
| Stop | Chat header | Expanded sidebar top bar / compact rail / sheet controls |
| View toggle | Chat header | Sidebar controls; also split floating controls |
| Session actions and Close | Chat header | Sidebar controls; also split floating controls |
| Split close/swap/menu actions | Chat header menu | Floating pane menu |
| Hand off | Header/session details action | Title-aligned sidebar action and sidebar menu |
| Agent selection | Chat/header strip and inspector strip | Sidebar strip or compact avatar rail |
| Requests, steering, resume | Existing inspector/lane surfaces | Retained there; existing detail selection and request paths preserved |

## Verification

Final rerun: **FAIL**, exit 1, completed 2026-10-26 14:41:36 UTC.

| Project | Lint | Test | Typecheck |
| --- | --- | --- | --- |
| @ptah-extension/chat-ui | PASS | PASS: 86 suites, 1591 tests | PASS |
| @ptah-extension/chat | FAIL: two untouched-file lint errors | PASS: 274 suites, 4708 passed / 2 skipped / 4710 total | PASS |
| @ptah-extension/canvas | PASS | FAIL: 21 suites passed / 2 failed; 451 tests passed / 16 failed / 467 total | PASS |

Canvas failures included a reactive cycle: default dock-open state read effective left-rail width, which itself read dock-open state. After the final run, the default was changed to the conservative 1200px board threshold (304px rail + 336px dock + 560px chat), removing that circular dependency. The 900px overlay test was also corrected to pass available width after the left rail, rather than total board width. **These final corrections were not retested**, because the permitted rerun was exhausted.

Remaining board expectations include old narrow breakpoint defaults, absence of the compact expand control, and no dialog after closing split Details despite the new sidebar overlay. These need a follow-up test pass and potentially further behavior fixes; the implementation is not claimed ready to merge. No third verification run was made.

Command (run once, then rerun once after correcting the template and obsolete button-count expectation):
`npm run verify -- -p @ptah-extension/chat-ui,@ptah-extension/chat,@ptah-extension/canvas -- --output-style=static`

The header confirms **lint, test, typecheck for 3 projects**. Logs are in `$env:TEMP/ptah-revision2-verify.log` and `$env:TEMP/ptah-revision2-verify-final.log`.

First run: chat-ui 86 suites / 1591 tests passed; chat 273 suites passed / one failed (4707 passed, one failed, two skipped); canvas template parse failure caused 197 failed tests. The missing template brace and obsolete compact button count were corrected for the rerun.

Scoped Ptah diagnostics: the post-cycle-fix check timed out after 45 seconds and remains unchecked. Two earlier calls also timed out; the final dock check reported no diagnostics in the requested file and nine sibling errors in untouched shared/test helpers (mock RPC casts and BigInt target configuration).

## Decisions

- Default to an expanded dock only at board width ≥1200px, independently of effective rail width, to avoid the dock/rail reactive cycle. Actual overlay placement still uses available width. This is conservative when the left rail is collapsed. Reversible.
- Reuse the existing controls component in place rather than introduce a second header implementation. Evidence: its existing view, Stop, split and menu outputs already implement the required capabilities. Reversible.
- Preserve the existing full sheet below 400px and use an overlay above that threshold whenever docking leaves less than 560px. Split uses an overlay conservatively to protect both panes. Evidence: existing focus trap and sheet handoff behavior. Reversible.
- Render the expanded avatar hover card in flow beneath the strip, rather than overlap Session tiles. Rail retains floating left placement. Evidence: revision item 8 forbids obscuring the tiles. Reversible.
- Keep lane totals independent from session totals, including when only partial segment usage exists. Evidence: item 7 and the existing agent-card fallback. Reversible.
- Retain existing DaisyUI Hand off styling; move its projection next to the title. Evidence: its source already uses `btn btn-ghost btn-xs`. Reversible.

## Clarifications Needed

- Two lint errors occur in untouched chat files: `services/attention-context.util.ts:1` (unnecessary escaped slash) and `services/chat-attention-source.service.ts:27` (control characters in regex). These were left for their owner.
- The design document now contains an additional item 9 (DaisyUI lane-detail structure), beyond the explicit eight-item assignment. It was not implemented in this pass.

## Limits and remaining work

- Tool-call budget was approaching its ceiling, so the pass stopped with the failed verification explicitly reported.
- Electron visual review at the supplied screenshot sizes is still required; the running app was left untouched as instructed. DOM/unit coverage does not prove pixel geometry or tooltip placement.
- All-host builds were prohibited; only the three requested projects were verified.
- No unrelated source, task state, or machine-owned task document was edited.
- `canvas-rail-board.component.ts` remains 1237 lines, below the 1241-line cap.
