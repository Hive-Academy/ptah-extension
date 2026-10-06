# Batch 7 report — alert, badge, divider renderers (TASK_2026_594_31ff)

Status: DONE. All 3 tasks implemented with real code; both scoped verification
commands pass. No stubs, placeholders or TODO markers. Only Batch 7's six files
were created; no existing file was touched, and `surface-node.component.ts` was
not wired (Batch 10 owns it).

## Files created (all absolute)

1. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-alert.component.ts`
2. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-alert.component.spec.ts`
3. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-badge.component.ts`
4. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-badge.component.spec.ts`
5. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-divider.component.ts`
6. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-divider.component.spec.ts`

## Task 7.1: DashboardAlertComponent — DONE

- Standalone, `ChangeDetectionStrategy.OnPush`,
  `input.required<AlertNode>()` where `AlertNode = Extract<StatusNode, { kind: 'alert' }>`
  (`dashboard-alert.component.ts:4,33-34`). Selector `ptah-dashboard-alert`.
- Tone map `ALERT_TONE_CLASSES` holds the four complete literals
  `alert alert-info|success|warning|error`, bound with `[class]`
  (`dashboard-alert.component.ts:11-16,25`). No concatenation anywhere.
- `role="alert"` for warning/error (assertive), `role="status"` for info/success
  (`dashboard-alert.component.ts:38-40`); the tone word is rendered in an
  `sr-only` span, so the tone is conveyed in text, not colour alone
  (`dashboard-alert.component.ts:26`).
- No `title`: no title element and no empty placeholder — the alert div's only
  element child is the sr-only tone span
  (`dashboard-alert.component.spec.ts:48-50`). With `title`: an inline
  `font-semibold` span inside the same alert element, before the text
  (`dashboard-alert.component.ts:27-29`;
  `dashboard-alert.component.spec.ts:52-61` asserts same parent, order, and the
  single-space inline reading "Deploy failed Disk almost full"). No heading
  element is used, so it reads as a short inline note.
- Plain interpolation only: the spec feeds `<img src=x onerror=alert(1)>` as
  text and asserts no `img`/`style`/`script` node is created
  (`dashboard-alert.component.spec.ts:37-43`).

## Task 7.2: DashboardBadgeComponent — DONE

- Standalone, OnPush, `input.required<BadgeNode>()`. Selector
  `ptah-dashboard-badge`.
- Six complete literals `badge badge-<tone>` in `BADGE_TONE_CLASSES`
  (`dashboard-badge.component.ts:12-19`), bound with `[class]`.
- Only the host-valid selection pathway: when `selectable`, a `<button>` emits
  `SurfaceSelection` with target `{ kind: 'badge' }` on the existing
  `selectionChange` output (`dashboard-badge.component.ts:46-48`), mirroring
  the stat component's selection handling — `surfaceId` input,
  `data-apps-focus-key`, `'Select ' + text` aria-label, and `aria-pressed`
  from the current selection (`dashboard-badge.component.ts:24-30,40`).
- Non-interactive without `dashboard.select`: a `<span>` badge, no button, and
  `selectBadge()` emits nothing
  (`dashboard-badge.component.spec.ts:45-54`).
- Selection spec: click emits `{ componentId: 'badge', target: { kind: 'badge' } }`
  exactly once; `aria-pressed` is false unselected, true when the current
  selection targets this badge, and false for both a different componentId and
  a different target kind (`dashboard-badge.component.spec.ts:56-77`).

## Task 7.3: DashboardDividerComponent — DONE

- Standalone, OnPush, `input.required<DividerNode>()`. Selector
  `ptah-dashboard-divider`.
- Direction map per the plan: `horizontal: 'divider'`,
  `vertical: 'divider divider-horizontal'` — daisyUI 4's inverted naming is
  documented in the map's comment
  (`dashboard-divider.component.ts:5-17`).
- `role="separator"` and `aria-orientation` equal to the contract direction
  (`dashboard-divider.component.ts:23`); the spec asserts the orientation
  attribute equals the direction while the class is the daisyUI literal
  (`dashboard-divider.component.spec.ts:20-32`).
- Optional text as plain interpolation: without text the separator is empty
  with no placeholder element; with text it renders as plain text, and hostile
  markup stays text (`dashboard-divider.component.spec.ts:34-44`).

## Verification (scoped, per batches.md)

- `npx nx run-many -t typecheck,lint -p declarative-dashboard` — PASS:
  both targets succeeded, 0 errors (15.9s).
- `npx jest --config libs/frontend/declarative-dashboard/jest.config.ts "dashboard-(alert|badge|divider)\.component"` —
  PASS: `Test Suites: 3 passed, 3 total; Tests: 9 passed, 9 total`. First run
  had 1 failure (a double space in the alert's inline note from Angular's
  whitespace collapsing next to my explicit in-span space); fixed by dropping
  the in-span space so the collapsed template whitespace is the single
  separator; re-run green.
- Each spec asserts every tone's/direction's exact literal class and the
  rendered text under both existing theme roots (`data-theme="anubis"` dark and
  `data-theme="anubis-light"` light, from `tailwind.config.js:68-198`), and
  asserts the class list holds no hard-coded colour utility.

## Risks and how they were handled

- **Tailwind purge drops concatenated classes (MEDIUM).** All tone/direction
  maps are `as const` records of complete literal class strings
  (`dashboard-alert.component.ts:11-16`, `dashboard-badge.component.ts:12-19`,
  `dashboard-divider.component.ts:13-17`); no `'alert-' + tone` style building
  exists. Specs assert the exact `className` per tone and direction.
- **Badge selection target half-wired (MEDIUM).** This batch emits the
  `{ kind: 'badge' }` target on the existing `selectionChange` pathway exactly
  as the plan specifies; the emitter, schema and switch cases from Batches 1
  and 5 typecheck against it, and my spec asserts the emitted payload and the
  `aria-pressed` true/false states that Batch 10 re-asserts end to end.
- **Alert title edge case (edge case list, Tasks 7.1).** No title renders no
  title node (children count asserted); with title it is a bold inline span
  before the text inside the same alert element, with exactly one separating
  space (whitespace behaviour verified by the failing-then-passing exact
  string assertion).
- **Divider direction inversion.** Mapped per the plan (`vertical ->
  'divider divider-horizontal'`) with the inversion documented at the map, and
  `aria-orientation` kept equal to the contract direction, not the class name.
- **Eager-closure gate (MEDIUM).** No new imports were added anywhere outside
  the six new files; nothing imports them yet. Batch 10 will import them into
  `surface-node.component.ts` only, and Batch 12 runs the gate.
- **Concurrent lanes.** Only the six Batch 7 files were created; no shared,
  spec, host or wiring file was touched, reverted or reformatted.

## Not done / notes for the team-leader

- `batches.md` Batch 7 status lines were left as-is (IN_PROGRESS); status
  updates and the commit `feat(declarative-dashboard): add alert, badge and
  divider renderers` are the team-leader's, per the rules.
- The status kinds are not yet dispatched by `surface-node.component.ts`; until
  Batch 10 lands, a status node renders `renderFailed` (known, fail-closed,
  LOW risk).