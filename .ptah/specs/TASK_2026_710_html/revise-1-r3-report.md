# R3 frontend revision 1 report

## Changes and verification

| Defect | Change | Test |
| --- | --- | --- |
| Multiple live frames | `display-panel.component.ts:243` mounts the viewer only for the active key while open; `display-sheet.component.ts:84` destroys the panel on collapse. | `mounts one frame for three artifacts and releases it on collapse`; `unmounts the panel on collapse and drives the single viewer full screen request` |
| Escape collapses both layers | `artifact-viewer.component.ts:181,267,289` handles Escape on the dialog in capture phase and removes its listener; `display-sheet.component.ts:195` ignores dialog targets. | `claims Escape in capture before an enclosing sheet sees it`; `keeps the sheet open when Escape starts inside a dialog` |
| Silent open and list failures, missing selected record | `display-panel.component.ts:164,221,368` presents an alert for a missing selected artifact; `display-sheet.component.ts:87-88,209-227` presents an auto-clearing link alert and the store's `lastError`. | `shows an error for an artifact absent from this tab`; `alerts when an external link is not opened and displays list failure` |
| Card Full screen only changed sheet height | `tool-call-item.component.ts:181`, `display-dock.state.ts:108-115`, `display-sheet.component.ts:92`, and `display-panel.component.ts:246` pass the request to the single viewer dialog and clear it on exit or close. | `unmounts the panel on collapse and drives the single viewer full screen request`; `shows a stored artifact card for %s and opens its dock item` |
| Complete publish without a row vanished | `tool-call-item.component.ts:105,155-174` keeps a card shell with the result title and “Not loaded yet” while no record exists; in-progress and error rows remain hidden. | `shows a not-loaded card until the matching record exists` |
| Blank theme or failed load | `artifact-theme-bridge.service.ts:136` skips overlong variables; `artifact-viewer.component.ts:101,299,310` adds Retry and treats a missing content window as load failure. | `omits overlong theme values and still sends the other tokens`; `offers Retry after load timeout and re-arms the frame` |

## Jest results

- chat-ui targeted specs: 2 suites, 41 tests passed.
- chat targeted specs: 2 suites, 47 tests passed.
- The changed-file diagnostic request initially returned no errors in six requested source files and unrelated sibling errors. The final request for ten edited files timed out twice, so final compiler diagnostics are unavailable. No workspace build or typecheck was run.

## Decisions

- Used a per-tab full-screen request in `DisplayDockState` and reused the existing viewer `fullscreen` input. The alternative was relabeling the card button “Expand”; the viewer already supported external full-screen input, so wiring the request was reversible and fit the existing component contract.
- Destroyed the sheet panel on collapse. The alternative was retaining an inert hidden panel, but the review established that destruction is required to detach the frame bridge. The choice is reversible.

## Not done

- No source changes outside the assigned files. The independent compiler service did not complete its final scoped check.
