# Batch 10 report — surface-node dispatch and badge pressed state (plan D)

Executor: frontend-developer subagent (fallback; CLI lane unavailable to this lane).
Date: 2026-10-05. Worktree root W: `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds`.

## Tasks

### Task 10.1: Dispatch wiring — DONE

File: `W/libs/frontend/declarative-dashboard/src/lib/components/surface-node.component.ts`

- Six static component imports added at `surface-node.component.ts:26-31` (`DashboardAlertComponent`,
  `DashboardBadgeComponent`, `DashboardDividerComponent`, `DashboardProgressComponent`,
  `DashboardRadialProgressComponent`, `DashboardTextBlockComponent`, each with its node type).
  No other file gained a renderer import, so no new eager imports enter the webview initial
  closure (see Risks).
- `SURFACE_NODE_KINDS` grew from 13 to 19 values (`:67-72`); the count comments at `:65` and
  `:82` were updated to 19.
- The component `imports` array gained the six components (`:100-107`).
- Six computed kind guards added after `chartNode` (`:271-295`): `alertNode`, `badgeNode`,
  `progressNode`, `radialProgressNode`, `dividerNode`, `textBlockNode`, each narrowing by kind
  equality in the established style.
- Six `@case` branches added before `@default` (`:213-238`). The badge case forwards
  `[surfaceId]`, `[selection]="interaction().selection"` and
  `(selectionChange)="selectionChange.emit($event)"`, mirroring the stat case's selection
  handling. The other five forward only `[node]`; none of the six kinds has children, so no
  child template is wired for them.

Conditional file `surface-renderer.component.ts`: NOT edited. Its guard reads
`SURFACE_NODE_KINDS` by membership and its selection equality is generic, so typecheck passed
with no edit. No error to report.

### Task 10.2: surface-node spec — DONE

File: `W/libs/frontend/declarative-dashboard/src/lib/components/surface-node.component.spec.ts`

- The literal at `:15` (`catalogVersion: 'dashboard-catalog/2'`) replaced with the imported
  `SURFACE_CATALOG_VERSION` from `@ptah-extension/shared/mcp-apps-contracts/surface` (import at
  `:5`), the same import path the swept Batch 2 specs use.
- `EVERY_KIND` extended from 13 to 19 entries (`:38-59`): one minimal valid v2 component per
  new kind plus the element it must render — `ptah-dashboard-alert`, `ptah-dashboard-badge
  button` (selectable badge with a `dashboard.select` action), `ptah-dashboard-progress
  progress`, `ptah-dashboard-radial-progress`, `ptah-dashboard-divider`, `ptah-dashboard-text-block
  h3`. The dispatch test renamed to "switches over all 19 catalog kinds" and asserts
  `SURFACE_NODE_KINDS.size === 19`; each entry renders its child and `failures` stays 0, which
  is one dispatch test per new kind with no `renderFailed`.
- New badge test (`:80-93`): renders a selectable badge, asserts `aria-pressed="false"`
  initially, clicks and asserts the emitted `{ componentId: 'k-badge', target: { kind: 'badge' } }`
  selection, then sets the host interaction selection to that target and asserts
  `aria-pressed="true"` after rerender. The host component gained an `[interaction]` binding
  with a local `NO_INTERACTION` base (`:62-69`) so the test can drive the current selection.

## Verification

```
npx nx run-many -t typecheck,test,lint -p declarative-dashboard
```

Result: `Successfully ran targets typecheck, test, lint for project
@ptah-extension/declarative-dashboard` — typecheck PASS, full test suite PASS, lint PASS.
No exclusions were used; this run lifts the last `surface-node.component.spec.ts` exclusion.

Single-suite evidence: `npx jest --config libs/frontend/declarative-dashboard/jest.config.ts
surface-node.component` — `Test Suites: 1 passed, 1 total`, `Tests: 7 passed, 7 total`.

Literal sweep check: `grep -c "dashboard-catalog/2"` over both Batch 10 files returns 0. In
`libs/frontend/declarative-dashboard` the only remaining file is
`surface-view-model.spec.ts`, which holds the deliberate negative case owned by Batch 1.

## Files modified (absolute)

- `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-node.component.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-node.component.spec.ts`

## Risks (from the plan-validation table) and how they were handled

- **Status node rendered `renderFailed` before Batch 10 (LOW)** — closed: all six kinds are
  registered in `SURFACE_NODE_KINDS` and dispatch to their renderers; the dispatch test asserts
  each kind renders its child with `failures === 0`.
- **Eager-closure gate could fail on new renderer imports (MEDIUM)** — the six imports were
  added only to `surface-node.component.ts`, which stays inside the existing lazy/deferred
  declarative-dashboard boundary; no eager entry was touched and no allowlist was modified.
  The production webview build plus `npm run gate:eager-closure` is Batch 12's Task 12.2, so
  the gate proof remains with that batch as the plan assigns it.
- **Renderer edit needed only if typecheck requires it** — typecheck passed with
  `surface-renderer.component.ts` untouched; its guard reads `SURFACE_NODE_KINDS` by
  membership, so adding values required no change there.
- **Badge selection target half-wired (MEDIUM)** — the pressed state comes from the current
  selection forwarded through the existing `interaction().selection` input; the new spec test
  proves both `false` and `true` states plus the emitted `{ kind: 'badge' }` target.

## Not done / notes

- Nothing in Batch 10's task list is left undone. `batches.md` was not edited. No git commands
  were run. Other lanes' files (Batch 6 vscode-lm-tools, Batch 9 shared specs) were untouched.