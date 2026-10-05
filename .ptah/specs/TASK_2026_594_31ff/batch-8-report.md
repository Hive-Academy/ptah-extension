# Batch 8 report — Progress, radial-progress, text-block renderers (plan C2)

Status: DONE. All 3 tasks implemented with real code, no stubs, no TODO markers.
Worktree W: `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds`.

## Tasks

### Task 8.1: DashboardProgressComponent — DONE

- Files created:
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-progress.component.ts`
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-progress.component.spec.ts`
- Evidence:
  - `dashboard-progress.component.ts:11-19` — typed `const` tone map with complete literal
    class strings. `neutral: 'progress'` (daisyUI 4 has no `progress-neutral`); the other five
    tones are `'progress progress-<tone>'` literals. Bound via `[class]` at `:29`. No
    concatenation anywhere.
  - `:26-31` — native `<progress>` element with `role="progressbar"`, `aria-valuemin="0"`,
    `aria-valuemax="100"`, `[attr.aria-valuenow]="node().value"`, and
    `[attr.aria-label]="node().label.text"` (accessible label from `label`). `[value]` is the
    renderer-owned validated number.
  - `:28` visible label stays text (`data-testid="progress-label"`); `:32` shows the unrounded
    percentage (`{{ node().value }}%` — 42.5 renders as `42.5%`).
  - `dashboard-progress.component.spec.ts:24-33` asserts every tone's exact class under both
    theme roots (`anubis`, `anubis-light`); `:35-46` the full ARIA contract with exact
    `aria-valuenow="42.5"` plus 0 and 100 edges; `:48-53` label + unrounded percentage;
    `:55-60` hostile markup never becomes markup, style or colour.

### Task 8.2: DashboardRadialProgressComponent — DONE

- Files created:
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-radial-progress.component.ts`
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-radial-progress.component.spec.ts`
- Evidence:
  - `dashboard-radial-progress.component.ts:10-18` — all six `radial-progress text-<tone>`
    literals, bound via `[class]` at `:27`.
  - `:27-30` — the same ARIA contract as progress: `role="progressbar"`, `aria-valuemin="0"`,
    `aria-valuemax="100"`, exact `[attr.aria-valuenow]`, `[attr.aria-label]` from `label`.
  - `:29` — `[style.--value]="node().value"` is the ONLY style binding, sourced from the
    validated finite 0..100 number. The agent never supplies style.
  - `:30` — visible unrounded percentage inside the ring; `:26` visible label text.
  - `dashboard-radial-progress.component.spec.ts:26-36` exact class per tone under both theme
    roots; `:38-49` ARIA contract plus the custom-property assertion
    (`ring.style.getPropertyValue('--value') === '42.5'`, no colour channel, `style.length === 1`);
    `:51-57` label + visible percentage; `:59-67` hostile markup and style checks.

### Task 8.3: DashboardTextBlockComponent — DONE

- Files created:
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-text-block.component.ts`
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-text-block.component.spec.ts`
- Evidence:
  - `dashboard-text-block.component.ts:9-15` — `heading` role renders `<h3>`, `body` renders
    `<p>`; plain text interpolation only. Classes are base-content typography tokens
    (`text-base-content`, `text-lg`/`text-base`, `leading-*`) — no hard-coded colours.
  - `dashboard-text-block.component.spec.ts:18-31` heading vs body element per theme root,
    no role override; `:33-41` token-only colour check; `:43-47` hostile markup check.

## Verification (Batch 8 command from batches.md)

From W:

```
npx jest --config libs/frontend/declarative-dashboard/jest.config.ts "dashboard-(progress|radial-progress|text-block)\.component"
Test Suites: 3 passed, 3 total
Tests:       12 passed, 12 total
```

```
npx nx run-many -t typecheck,lint -p declarative-dashboard
Successfully ran targets typecheck, lint for project @ptah-extension/declarative-dashboard
```

Lint re-run without the Nx cache (`npx nx run declarative-dashboard:lint --skip-nx-cache`):
0 errors, 98 warnings. Direct eslint on the six Batch 8 files: 0 errors, 16 warnings, all
`@typescript-eslint/no-non-null-assertion` in the specs — the same warning class every existing
dashboard spec carries (for example `dashboard-stat.component.spec.ts`), so the pattern matches
the repository. The batch gate is 0 errors, as in Wave 1 ("pre-existing warnings only").

## Risks and how they were handled

- **Tailwind purge drops concatenated classes (risk table, batches.md:73).** Both tone maps
  hold COMPLETE literal strings in a typed `const` record bound with `[class]`. No
  `'progress-' + tone` anywhere. The specs assert the exact class string per tone, so any
  regression fails the gate.
- **No `progress-neutral` in daisyUI 4.12.24.** `neutral` maps to the bare `'progress'` literal
  (`dashboard-progress.component.ts:12`); the spec pins it (`toneClasses.neutral === 'progress'`).
- **Radial `--value` must be renderer-owned only.** `[style.--value]="node().value"` is the only
  style binding in the component; the spec asserts the custom property value and that no colour
  or background channel is set. No agent style path exists.
- **ARIA contract for progress variants.** Both components expose `role="progressbar"`,
  `aria-valuemin="0"`, `aria-valuemax="100"`, exact unrounded `aria-valuenow` and an accessible
  label from `label`. The specs assert all attributes, including decimal 42.5 and edges 0/100.
- **Hard-coded colours forbidden.** Only daisy theme tokens (`progress-*`, `text-*` tone classes,
  `text-base-content`) are used; the specs reject hex colours and raw colour utilities in both
  class and style channels. Dark and light themes are covered by the `anubis` / `anubis-light`
  `data-theme` roots.
- **Eager-closure boundary (batches.md:72).** No file outside the six Batch 8 files was touched.
  `surface-node.component.ts` is NOT wired — Batch 10 owns it. No renderer import was added
  anywhere else.

## Files created (absolute paths, complete list)

1. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-progress.component.ts`
2. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-progress.component.spec.ts`
3. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-radial-progress.component.ts`
4. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-radial-progress.component.spec.ts`
5. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-text-block.component.ts`
6. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-text-block.component.spec.ts`

No file was modified outside Batch 8's list. No git commands were run.