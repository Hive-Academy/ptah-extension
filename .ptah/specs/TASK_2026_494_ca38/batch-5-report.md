# Batch 5 report

## Files written (absolute paths)
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\src\lib\components\dashboard-stat.component.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\src\lib\components\dashboard-stat.component.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\src\lib\components\dashboard-list.component.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\src\lib\components\dashboard-list.component.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\src\lib\components\dashboard-pager.component.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\.ptah\specs\TASK_2026_494_ca38\batch-5-report.md

## Requirements and evidence
- Req 4.1: stat label/value/unit and signed delta (including zero and missing delta) render in the neutral stat card. Spec: 'renders literal label, value, unit and signed delta on a neutral surface without styles'. Description appears in expanded details; projected child content can share that details region. Lists use ol or ul according to ordered, with a muted secondary detail line. Spec: 'honours ordered lists, secondary detail and literal URL/text without links or styles'.
- Req 4.5: URLs are interpolated in a plain paragraph, never an anchor or href. Covered by the preceding list rendering spec.
- Req 4.4: referenced list data renders the not-available notice and optional rowCount instead of the list/filter/pager. Spec: 'shows an unavailable data notice and row count instead of list or filter controls'. Stat has no data reference in the shared contract.
- Req 5.2: case-insensitive filter searches the displayed item text, detail and URL, reports the result count, and resets page to zero. Spec: 'filters visible title/detail/URL text and resets the page with a result count'.
- Req 5.3: list uses existing pageSlice and SURFACE_PAGE_SIZE (25), retaining a maximum 25 rendered items. Pager consumes the clamped page metadata and emits a pageChange; native Previous/Next buttons are disabled at bounds and a live status states Page X of Y. Spec: 'pages 25 items with native bounded buttons, status, focus keys and clamped indices'. Empty results are covered by the filter spec. No paging algorithm was duplicated.
- Req 7.1/7.2: dedicated SVG icon buttons expose Expand/Collapse labels, aria-expanded and aria-controls. Containers have no role/tabindex or activation handler; their Escape listener only collapses an already expanded component and restores focus to its own expand button. All state changes emit a copied SurfaceComponentViewState for the parent to feed back. Stat details use hidden; list expansion removes its max-h-64 viewport restriction while keeping pagination. Specs: 'expands details through controlled state and Escape restores button focus' (stat); 'expands through controlled state and Escape returns focus to the icon button' (list).
- Req 7.5 and CSP: stat value uses primary text on bg-base-200; other content uses base-content and base-content-muted on neutral backgrounds. No filled status badges, alpha text utilities, style attributes, style bindings or style elements. SVG icons use presentation attributes only. Both rendering specs assert no style or [style].
- Literal text: both rendering specs use an img/onerror title, assert its literal text, and assert that no img element exists. No HTML parsing.
- Selection: buttons exist only when selectable, with a second method guard. Stat selection input controls aria-pressed. List selection preserves originalIndex through validation, paging and filtering, uses it for track and focus keys, rejects nonexistent indices, and uses selection input for aria-pressed. Specs: 'offers selection only for selectable stats and emits the contract target'; 'guards selection and emits original item indices after paging and filtering'.
- Every interactive button/input has a surfaceId:componentId:control focus key, including pager controls; verified by the expansion and paging specs.

## Carry-over notes
- B3 malformed list input: missing/non-array items become empty; null, primitives, arrays, and objects without any displayable fields are skipped. Optional text/detail rich-text values must contain a string text field; URL must be a string. Malformed title/description are absent with a List title fallback. Preserving the source index before skipping items prevents selection index drift. Spec: 'handles malformed items and non-string optional fields without throwing or losing original indices'. No view-model changes.
- B4 unique ids: per-instance module counters generate stat details and list content/filter ids, independent of producer node ids. Specs: 'assigns unique expansion ids to stat instances sharing a node id'; 'uses unique content and filter ids for instances with the same node id'.
- B4 original indices: page-two selection emits itemIndex 25, then filtered selection emits 29. Covered by 'guards selection and emits original item indices after paging and filtering'.

## Shared selection contract
Source: libs/shared/src/mcp-apps-contracts/surface.types.ts:175 declares the stat target { kind: 'stat' }; :177 declares { kind: 'list-item', itemIndex: number }. The enclosing SurfaceSelection is declared at :183, with componentId at :184 and target at :185. Both outputs use this exact type; no host transport is imported or invoked.

## Integration and deviations
- Stat/list inputs: node, surfaceId, viewState, selection. Outputs: viewStateChange, selectionChange. Parents must feed emitted view state back, matching the chart's controlled-input pattern.
- Pager inputs: pagination (the { page, pageCount, total } portion of pageSlice's result), surfaceId, componentId. Output: pageChange. The list passes its pageSlice result directly; future table consumers can do the same.
- SURFACE_PAGE_SIZE is imported from its actual defining module surface-view-state.ts; pageSlice is imported from table/table-rows.ts, which does not re-export the constant. Neither existing module was changed.
- Pager tests live in dashboard-list.component.spec.ts as authorized; exactly five source/spec files were created.
- The prototype's list viewport expansion is implemented as removal of a height constraint, not an overlay. Stat expansion reveals description/projected children. Both stay client-only and retain page state.
- No other sources, config, barrels, libraries or existing task documents were edited. No git commands ran. Browser/Electron visual fidelity remains for the later visual gate.

## Verification
Command: npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard --skip-nx-cache

Result: all three targets green. Last 10 lines:

~~~~text

 NX   Successfully ran targets lint, typecheck, test for project @ptah-extension/declarative-dashboard


Output of 3 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

  Run duration:      10.8s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     10.1s (1 task)
  Recoverable time:  669ms (6% of the run)
~~~~
