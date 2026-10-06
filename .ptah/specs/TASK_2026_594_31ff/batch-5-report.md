# Batch 5 report — Text fallback and badge selection (plan A2)

Status: COMPLETE. Both tasks implemented with real code. No stubs, no TODO markers.
Batch 5 files only were touched. No git commands were run.

## Task 5.1: Fallback lines for the six kinds — DONE

Source: `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-text-fallback.ts:29-42`

Six `case` branches in the `renderDisplay` switch, before `default`:

- `alert` (`:29-30`): `Alert (<tone>): <text>`
- `badge` (`:31-32`): `Badge: <text>`
- `progress` (`:33-34`): `Progress: <label> — <value>%`
- `radial-progress` (`:35-36`): `Radial progress: <label> — <value>%`
- `divider` (`:37-38`): `Divider: <text>` when text exists, else the bare line `Divider`
- `text-block` (`:39-42`): `Heading: <text>` for role `heading`, `Text: <text>` for role `body`

The progress value is plain `${value}%` template interpolation. It is never rounded.

Spec: `surface-text-fallback.spec.ts:158-217`. The new test builds one root
component per kind and asserts each exact output line with
`expect(lines).toContain(...)` against the split output, so `Divider` is matched
as an exact line and not as a substring of `Divider: Later`. It covers the
textless divider, the decimal `42.5%`, a `100%` radial, and both text-block roles.

## Task 5.2: Badge selection target cases — DONE

`surface-patch.ts`:

- `checkSurfaceSelection` `:387-389`: `case 'badge'` returns ok only when
  `component.kind === 'badge'`. It mirrors the `stat` case, including the
  failure message shape `does not match target kind badge.`
- `sameSelection` `:428-429`: `case 'badge'` returns true only when both
  targets are `badge`. Two badge targets are equal; a badge target is never
  equal to any other kind.

`surface-selection.ts:79-82`: `describeSurfaceSelection` gained a
`badge`/`badge` branch that emits `Text: <quoted badge text>` and
`Tone: <quoted tone>`, after the common `Component`, `Kind` and `Title` lines.
It follows the existing `quoted()` convention that caps and escapes source
strings. A badge has no `title`, so `Title` resolves to the component id, as the
list and chart kinds already do.

Specs:

- `surface-patch.spec.ts:527-558`: accepted on a badge (`ok: true`), rejected
  on a stat (`ok: false`).
- `surface-patch.spec.ts:611-636`: equality through `revalidateSelection`, the
  only exported route to `sameSelection`. An unchanged badge selection is kept;
  a badge target changed to `stat` is cleared to null.
- `surface-selection.spec.ts:106-123`: the description lines, asserted exactly:
  `Component: "badge"`, `Kind: "badge"`, `Title: "badge"`, `Text: "Slow build"`,
  `Tone: "warning"`.
- `surface-selection.spec.ts:124-133`: a badge target on `card`, `table` and
  `stat` returns null.

## Edge cases handled

- Textless divider (Batch 5 edge case, `batches.md:87`): the fallback line is the
  bare `Divider`; the spec asserts it as an exact line.
- Unrounded decimal percentage (`batches.md:87`): `42.5` renders as `42.5%`.
- Badge selection is closed: `{kind:'badge'}` is accepted only on a badge
  component; on any other kind both `checkSurfaceSelection` and
  `describeSurfaceSelection` fail closed (null / ok:false).

## Risks handled

- Badge selection target is half-wired (`batches.md:74`, MEDIUM): Batch 5 is the
  "switches in A2" slice only. The type and schema came from Batch 1; the emitter
  (C1) and `aria-pressed` (D) stay with Batches 7 and 10. The two `default`
  branches that were safe before remain the fail-closed path for every target
  kind this batch does not name, so the interim state stays safe.
- No other file enumerates `SurfaceSelectionTarget` in `shared` (verified by
  grep: only `surface-patch.ts` and `surface-selection.ts` switch on
  `target.kind`), so the shared typecheck stays green without touching the
  renderer, which Batch 10 owns conditionally.

## Verification

Commands from the worktree root, output tailed:

1. `npx nx run-many -t typecheck,lint -p shared`
   Result: `Successfully ran targets typecheck, lint for project @ptah-extension/shared`. 0 errors.
2. `npx jest --config libs/shared/jest.config.ts --testPathIgnorePatterns "/node_modules/" "surface-(contract|validator|budgets)\.spec\.ts"`
   Result: `Test Suites: 102 passed, 102 total. Tests: 2789 passed, 2789 total.`
   Wave 1 recorded 2784 tests; the +5 are this batch's new tests.
3. Targeted re-run of the three touched specs,
   `npx jest --config libs/shared/jest.config.ts "surface-(text-fallback|patch|selection)\.spec\.ts"`:
   `Test Suites: 3 passed. Tests: 55 passed.`

The `surface-(contract|validator|budgets)` exclusions stay in place; Batch 9
owns them. Lint passed, so the formatting of every edit matches the repository
rules.

## Files

Modified (6), created (0):

- `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-text-fallback.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-text-fallback.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-patch.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-patch.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-selection.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-selection.spec.ts`

Nothing was blocked. No clarifications are needed.