# Batch 4 implementation report

Files written (absolute paths):
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\src\lib\table\table-rows.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\src\lib\table\table-rows.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\src\lib\charts\chart-geometry.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\src\lib\charts\chart-geometry.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\src\lib\components\dashboard-chart.component.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\src\lib\components\dashboard-chart.component.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\.ptah\specs\TASK_2026_494_ca38\batch-4-report.md

## Implementation and requirements
- Req 4.1 / D5: standalone OnPush signal-input chart component renders line and grouped bar charts with named series and labelled axes. Pure geometry handles numeric and categorical x axes, signed y values, empty/singleton/all-zero inputs, and extreme finite numbers. Numeric axis labels reflect bounds even for out-of-order points.
- Req 4.4: data references show a plain-text not-available notice, including rowCount when present; no empty chart/table or data-fetch control appears.
- Req 5.1: nextTableSort cycles ascending, descending, original; tableRows preserves original indices and stable ties, compares numbers numerically, and never mutates input. Switching columns starts ascending.
- Req 5.2: table filtering searches literal, case-insensitive visible cell text only. Hidden cells do not participate. Results include the total count for the subsequent table component.
- Req 5.3: pageSlice uses SURFACE_PAGE_SIZE (25), returns totals and clamps stale/invalid page indices. The chart data table renders at most 25 rows with keyboard-native Previous/Next buttons and page/count status. Table header/filter UI remains the assigned Batch 6 consumer of the pure module.
- Req 7.3: always-visible native Show as table / Show as chart button uses aria-pressed; it emits client view-state changes only. There is no Expand or host-action control.
- Req 7.4: series have named legends with matching distinct SVG stroke patterns; the same patterns distinguish bar outlines. No hue-only encoding.
- Selection buttons appear only for selectable nodes, in the accessible chart table. Events preserve original series/point indices. The method also guards nonselectable nodes. Selection state accepts SurfaceSelection and renders aria-pressed. Every interactive control has a surface/component/control focus key.
- All producer text is interpolation. Tests verify markup remains literal and creates no img element. No HTML parser, transport, chart dependency, alpha text utility, unsafe cast or suppression was added.
- CSP: SVG presentation uses attributes (coordinates, stroke, dash patterns, fill), plus existing utility classes. No style attribute, component stylesheet, injected style, external SVG resource, script evaluation or policy relaxation. DOM tests assert no style elements/attributes in the component; actual Electron CSP integration was not run in this batch.
- The 5,000-point line-chart test asserts one polyline, no circles, fewer than 20 SVG descendant elements, paged table rows, and correct selection after paging. Other specs pin sort cycling, stable ties, visible-text filtering, page boundaries, geometry, literal text, toggle behaviour, data notices and patterned bars.

## Integration contract
- table-rows.ts exports TableNode, IndexedTableRow, cellText, nextTableSort, pageSlice and tableRows. Row results are { items, page, pageCount, total }; each item is { originalIndex, cells }.
- chart-geometry.ts exports ChartPoint and chartGeometry(series, kind).
- DashboardChartComponent selector: ptah-dashboard-chart. Inputs: node, surfaceId, viewState, selection. Outputs: viewStateChange (component state), selectionChange (SurfaceSelection). The parent must feed emitted view state back into the input. Index/barrel exports were intentionally left for the owning later batch.

## Verification
Command: npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard --skip-nx-cache

All three targets passed. Repeated once after the numeric-axis correction and regression spec. Last 10 lines from the final run:

~~~~text

 NX   Successfully ran targets lint, typecheck, test for project @ptah-extension/declarative-dashboard


Output of 3 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

  Run duration:      22.0s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     19.7s (1 task)
  Recoverable time:  2.3s (10% of the run)
~~~~

No git commands were run. No other libraries, configuration, existing sources or task documents were edited. Temporary verification output is outside the task folder.
