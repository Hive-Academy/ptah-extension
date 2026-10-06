# Batch 6 report — MCP tool description and v1 regression (plan E)

Status: COMPLETE. All 3 tasks done; full verification passed.

## Tasks

### Task 6.1: Tool prose for the six kinds — DONE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/surface-tools.ts`
- Evidence: `surface-tools.ts:174-179` — the "Status kind fields" sentence, inserted between
  the component-kinds list and "Layout kinds nest". It names, for each of the six kinds,
  the concise fields and ranges: alert `{ tone: info|success|warning|error, text, title? }`;
  badge `{ tone: neutral|primary|info|success|warning|error, text, actions?: dashboard.select
  ONLY (no url, at most ${SURFACE_LIMITS.maxActionsPerComponent}) }` with the selection
  target `{ kind: "badge" }`; progress and radial-progress `{ value: 0-100, tone, label }`;
  divider `{ direction: horizontal|vertical, text? }`; text-block `{ role: heading|body, text }`.
- The vocabulary stays derived: the six kind names reach the description only through
  `SURFACE_DISPLAY_KINDS` (kinds sentence, :172-173), the catalog literal through
  `SURFACE_CATALOG_VERSION` (:170), the badge action cap through `SURFACE_LIMITS`
  (:176). No independent kind tuple was added.

### Task 6.2: Completeness case and growth-guard decision — DONE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/surface-tools.spec.ts`
- Evidence:
  - `surface-tools.spec.ts:181-201` — parses the emitted `layout ...; input ...; display ...`
    comma lists into exact tokens (split on comma, trim) and asserts array equality with
    `SURFACE_LAYOUT_KINDS`, `SURFACE_INPUT_KINDS` and `SURFACE_DISPLAY_KINDS`, set equality
    of the union with `SURFACE_COMPONENT_KINDS`, and that every token appears exactly once.
    Exact tokens only — `text` cannot be satisfied by `text-block`, nor `progress` by
    `radial-progress`.
  - `surface-tools.spec.ts:204-208` — pins `SURFACE_CATALOG_VERSION` to the literal
    `'dashboard-catalog/3'` and asserts the description quotes
    `catalogVersion: "dashboard-catalog/3"`.
  - Imports for the three kind tuples added at `surface-tools.spec.ts:12-25`.

### Task 6.3: v1 propose-spec regression — DONE

- File: `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/dashboard-propose-spec.tool.spec.ts`
- Evidence: `dashboard-propose-spec.tool.spec.ts:438-481` — the new test:
  - pins `DASHBOARD_COMPONENT_KINDS` to exactly `stat, line-chart, bar-chart, table, list`;
  - asserts the advertised JSON-schema enum
    (`inputSchema.properties.spec.properties.components.items.properties.kind.enum`)
    equals `DASHBOARD_COMPONENT_KINDS`;
  - parses the prose `(kinds: ...)` list into exact tokens and asserts set equality plus
    uniqueness;
  - asserts none of `alert`, `badge`, `progress`, `radial-progress`, `divider`,
    `text-block` appears anywhere in the serialized v1 tool.
- The tool source `dashboard-propose-spec.tool.ts` is unchanged.

## Size numbers (growth guard, surface-tools.spec.ts:55-94)

- Guard baseline before this batch: measured 65,190, ceiling 68,449 (dated 2026-09-26).
- Measured at HEAD 2d18e0215 (Wave 1 six schemas, before any prose):
  `JSON.stringify(buildSurfaceUpdateTool()).length` = **69,204** — already over the old
  ceiling, so the raise was required before prose was added.
- After the Task 6.1 prose: 69,608.
- Final (after the 8-char trim below): **69,600**; new ceiling
  `floor(69,600 * 1.05)` = **73,080**, pinned at `surface-tools.spec.ts:94`.
- `SURFACE_UPDATE_MEASURED_CHARS` re-baselined to 69,600 at `surface-tools.spec.ts:68`
  with the dated comment `// 2026-10-05 TASK_2026_594: six status/text kinds`, and the
  guard's doc comment records the 2026-10-05 re-baseline. The guard itself was not
  weakened: the +5% ceiling rule, both tool entries and the pinned-ceiling test are
  intact. `SURFACE_GET_STATE_MEASURED_CHARS` (2,141 / 2,248) is unchanged.

## Verification

Command (Batch 6 verification, full suite — the `surface-tools.spec.ts` exclusion is
lifted by this batch):

```bash
npx nx run-many -t typecheck,test,lint -p vscode-lm-tools
```

Result: `NX Successfully ran targets typecheck, test, lint for project
@ptah-extension/vscode-lm-tools` — 3/3 targets green, 0 failing tests, 0 lint errors.
(Nx Cloud free-plan notice in the output is unrelated infrastructure noise.)

Supporting measurement runs (jest, growth-guard filtered): before = 69,204
(1 failing: "Expected: <= 68449, Received: 69204"), final = guard passes with the
re-baselined constants.

## Risks and edge cases handled

- **Growth guard (plan-validation risk, MEDIUM).** The six schemas alone pushed the tool
  past the old ceiling (69,204 > 68,449). Handled exactly as the batch and the guard's own
  comment require: a deliberate re-baseline with a dated `TASK_2026_594` comment, the
  pinned ceiling updated to the new `floor(measured * 1.05)`, and both numbers reported
  above. Nothing was deleted and no ceiling was loosened beyond the documented raise.
- **Unexpected adjacent guard.** The first prose draft (description 4,960 chars) exceeded
  the per-tool description budget 4,956 in `mcp-contract.sweep.spec.ts` (a file this batch
  must not touch). Handled by trimming the prose (" finite" dropped from the value range:
  the input schema already carries the finite-number constraint), giving a 4,952-char
  description; the sweep suite passes untouched.
- **Exact-token completeness (edge case).** The completeness test splits the comma lists
  and compares token sets/arrays; no substring assertions exist in either new test.
- **v1 isolation (edge case, plan:321-324).** Task 6.3 proves the v1 tool still lists
  exactly the five kinds in both the JSON-schema enum and the prose, and that none of the
  six new kinds appears anywhere in the v1 tool definition. The tool source is unchanged.
- **Derived vocabulary.** No independent kind tuple exists in `surface-tools.ts`; all
  vocabulary is interpolated from `SURFACE_*_KINDS` and the version constants.

## Files

Modified:

- `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/surface-tools.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/surface-tools.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/dashboard-propose-spec.tool.spec.ts`

Created:

- `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/.ptah/specs/TASK_2026_594_31ff/batch-6-report.md`

Not run: git (no commit/push/stash/etc., per batch rules).