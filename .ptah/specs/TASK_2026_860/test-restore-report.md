# TASK_2026_860 canvas lane tabs test restoration

## Scope and result

- Restored all 32 test definitions from `git show main:libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.spec.ts` into the same spec file. The former six-agent parameter case became a separate cap assertion, so the restored suite now has 33 definitions and still covers all 35 original parameter-expanded cases.
- Preserved all 10 branch dock test definitions (15 parameter-expanded cases). The combined suite has 50 cases.
- Only the named spec file was edited for tests; no production file was changed in this lane.

## Restored tests from main

1. acquires the second clock only while an agent with a start time is running
2. rail shows five active avatars, expands overflow and selects with the shared tooltip
3. rail falls back to the orchestrator when no agents are active
4. rail arrow keys move focus only, keep one tab stop, and leave selection to Enter or a click
5. rail key normalization updates the selection without a user pick
6. hides the dropdown when no agent is hidden (%i total)
7. does not show a tooltip for the selected named tile
8. gives the rail dock tab ids that differ from the chat dock for the same panel
9. names every chip and opens no card when five or fewer agents
10. shows avatar circles with a card when more than five agents
11. moves terminal lanes into the menu even in a small roster
12. keeps a focused finished chip inline until focus leaves the dock
13. does not freeze visible chips after a pointer click focuses a tab
14. freezes visible chips while a tab has keyboard focus
15. shows a new %s agent inline while keyboard focus freezes the dock
16. clears the remembered chip when focus moves to the menu
17. restores focus to the selected tab when a focused agent leaves the roster
18. keeps a finished selected chip available for reverse arrow navigation
19. closes the hover card when its chip moves into the menu
20. excludes foreign and unresolved owners and falls back for an unknown key
21. migrates a selected sub-agent tab to its background tab
22. migrates a selected background tab back to its completed sub-agent tab
23. falls back to orchestrator when a background lane has no matching key
24. shows an owned CLI lane once while excluding unresolved and foreign lanes
25. moves between tabs with arrow keys
26. keeps a waiting agent and hides a done one at 360px, and disconnects the observer
27. keeps a newly selected lane rendered when the dock is narrow
28. keeps menu focus on a remaining hidden agent and restores the selected tab when overflow empties
29. restores the selected tab when overflow empties while the closed menu trigger has focus
30. selects from the menu with Enter, returns focus on Escape, and describes the hovered tab
31. closes the card after the pointer leaves the tab and card without keyboard focus
32. closes the open card after a quick pointer sweep across two tabs

## Adaptations to the approved contract

| Tests | Adaptation and contract basis |
| --- | --- |
| Six-agent dropdown case; avatar circles; quick pointer sweep | Enforce at most five rendered chips and show overflow for the sixth. `design-spec.md`, **Agent dock**, paragraph 1, requires the five-chip cap on every render path. |
| Five-or-fewer naming; terminal-lane small roster | Settle the measured width before assertions and expect finished agents inline when space permits. `design-spec.md`, **Agent dock**, paragraphs 1?2, ranks done/stopped after active states but does not exclude them from available chips. |
| Pointer click freeze; keyboard freeze; newly waiting/failed agent; focused finished chip | Assert frozen membership while focus remains in the dock, then replan after focus leaves. New agents remain in overflow during a freeze. `design-spec.md`, **Agent dock**, paragraph 3 and **Revision 1** item 4 require focus-subtree freeze and release on exit. The pointer-click assertion currently exposes a production regression below. |
| Arrow keys; 360px resize | Assert focus movement without lane selection, the five-chip measured capacity, and zero chips when width is zero and the selected pill plus trigger cannot fit. `design-spec.md`, **Agent dock**, paragraphs 1?3. |
| Narrow selected lane; menu focus/overflow-empty paths; Enter/Escape menu | Use widths or rosters that actually create overflow under the new capacity; check focus restoration and closed menu after selection/Escape. `design-spec.md`, **Agent dock**, paragraphs 1?3 and **Revision 1** item 2. |
| Hover card and second clock | Added only the initial render settle where measurement is needed. The original behavioral assertions remain; no contract relaxation. |

## Production regression

- **Test:** `freezes visible chips after a pointer click until focus leaves the dock` (restored from `does not freeze visible chips after a pointer click focuses a tab`). **Failure:** `expect(root.querySelector('#canvas-lane-panel-tab-cli\\:c1')).not.toBeNull()` received `null` at spec line 553. A pointer click focuses the tab, but a subsequent status update removes the previously visible `c1` chip before focus leaves the dock. `canvas-lane-tabs.component.ts` only sets `frozenVisibleKeys` for keyboard modality in `onDockFocusIn` / `onDockKeydown`; `onDockPointerDown` records pointer modality. This contradicts `design-spec.md` **Agent dock** paragraph 3 and **Revision 1** item 4. The assertion was retained.

## Verification

- Command: `npm run verify -- -t test -p @ptah-extension/canvas -- --testPathPatterns=canvas-lane-tabs` (foreground; tailed Nx output and inspected its full task log).
- Result: **failed**: 1 suite failed; **49 passed, 1 failed, 50 total**. Failure is the production regression above. Final Nx task log: `C:\Users\abdal\.nx\8b7110c7390b9603\cache\terminalOutputs\12047438549753439835`.
- Scoped `ptah_get_diagnostics` after the test edits reported no errors in the changed spec. It reported 10 errors in sibling files outside this lane?s edit scope.
- No skill-loading tool or available-skills catalogue was exposed in this lane, so no skill was loaded.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Preserve the failing pointer-focus assertion as a production regression | Keep the old pointer exception / apply focus-subtree freeze | The approved Agent dock and Revision 1 text explicitly freeze while focus is inside the dock; source guards freezing by keyboard modality; focused test fails consistently. | Yes, once production is corrected. |
| Measure width in restored desktop tests | Rely on unknown-width layout / simulate measured dock | The approved safe unknown-width plan intentionally exposes only one chip; tests expecting multiple chips must measure. | Yes. |
