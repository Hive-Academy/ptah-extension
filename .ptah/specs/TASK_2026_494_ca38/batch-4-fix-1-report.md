# Batch 4 fix round 1 report

## Fixes
1. Prototype series encoding: fixed primary/secondary/accent/info stroke class cycle. Line charts retain solid-first/dashed-later strokes and matching line legends. Bar series 0 has solid primary fill; later series use 45-degree userSpaceOnUse SVG hatches with their series hue, plus hue outlines and existing dash patterns. Bar legend swatches are rectangles with matching fill and stroke. Hatch ids combine a module-level component-instance counter and series index, so repeated node ids cannot collide between component instances. Axis text uses text-base-content-muted and currentColor fill.
2. Mixed-cell sorting: a consistent ascending order ranks numbers before nonempty strings/booleans, then null/empty. Numbers compare numerically; other values compare via localeCompare(cellText). Descending reverses this order while originalIndex remains the stable tie-break in both directions. Sort cycling and original-order restoration remain intact.
3. Added geometry edge coverage for mixed numeric/categorical line x values and numeric bar x values. Both use categorical slots as intended; no production geometry change was needed.

## Changed files (absolute paths)
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\src\lib\components\dashboard-chart.component.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\src\lib\components\dashboard-chart.component.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\src\lib\table\table-rows.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\src\lib\table\table-rows.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\src\lib\charts\chart-geometry.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\.ptah\specs\TASK_2026_494_ca38\batch-4-fix-1-report.md

## New spec names
- totally orders mixed cells in both directions with stable empty and numeric ties
- falls back to categorical spacing for mixed numeric and categorical line x values
- uses categorical slots for numeric bar x values
- renders solid primary and hatched secondary bars with matching rect legends (replaces the former bar-pattern test)
- uses unique hatch ids across chart instances with the same node id

Extended the existing literal-text/labelled-axis/pattern test to assert primary versus secondary hue classes, matching line legend encoding, and muted axis text. Updated the sort-cycle expectations for null-last ascending order. Retained and expanded assertions that no style element or style attribute appears. The two-instance spec mounts both charts together and verifies unique definitions and chart/legend references.

## CSP and scope
Only SVG presentation attributes and static utility class names are used: no style attributes, style bindings, style elements, external resources, or CSP relaxation. No unsafe casts or suppressions were added. No other library, config, index/barrel or existing task document was edited. No git command was run.

## Verification
Command: npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard --skip-nx-cache

Result: lint, typecheck and test all passed. Last 10 lines:

~~~~text

 NX   Successfully ran targets lint, typecheck, test for project @ptah-extension/declarative-dashboard


Output of 3 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

  Run duration:      19.5s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     18.4s (1 task)
  Recoverable time:  1.1s (6% of the run)
~~~~

No requested fix remains blocked. Browser/Electron visual integration was not run in this scoped fix round.
