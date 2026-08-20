# Implementation Plan — TASK_2026_181

**Title**: Richer task metadata and a keyboard-first views/filter layer for the Tasks board
**Scope**: families **B** and **C** only. **A** and **D** are out of scope (§7 of `task-description.md`).
**Binding decisions**: D1–D5, Q1–Q4 as approved in `context.md` → _Checkpoint 1 — APPROVED_. Not re-litigated here.

> No blocking objection. Every binding decision is technically achievable against the
> code as it stands today. Three corrections to _stated mitigations_ in the requirements
> are recorded in [§10](#10-risk-deltas-r1r15) — they change how a risk is discharged,
> never whether the decision holds.

---

## 0. What the investigation changed

Four findings from reading the actual edit sites. Each one changes a task the requirements
assumed, so they are stated up front rather than buried.

| #      | Finding                                                                                                                                                                                                                                                                                                          | Consequence                                                                                                                                                                                                                                                                             |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1** | `'tasks:'` is **already present** in `ALLOWED_METHOD_PREFIXES` (`rpc-handler.ts:84`), and `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts` already asserts, for every method in `RPC_METHOD_NAMES` _and_ every method in `RPC_HANDLER_MANIFEST`, that its prefix is allowlisted.                        | §4.3 site 7 / NFR-6 needs **zero edits** to `rpc-handler.ts`. The DoD checkbox "ALLOWED_METHOD_PREFIXES verified at runtime" is discharged by an **existing automated test** that runs inside the NFR-14 gate (`-p rpc-handlers`), not by inspection. Do not hand-edit the prefix list. |
| **F2** | Nx boundary lint **cannot** catch `tasks-ui → editor`. `libs/frontend/tasks-ui/project.json:7` is `["scope:webview","type:feature"]`; `libs/frontend/editor/project.json:7` is `["scope:webview","type:feature"]`; `eslint.config.mjs` allows `type:feature → type:feature` and `scope:webview → scope:webview`. | R11's stated mitigation ("`nx graph` / boundary lint catches it") is **false**. A dedicated source ratchet is required — see [§7 Phase 6](#phase-6--c6-command-palette--c7-board-keyboard-navigation) and [R11](#10-risk-deltas-r1r15).                                                 |
| **F3** | `updateFrontmatter` (`task-frontmatter.ts:285`) merges `{...existing, ...patch}` and re-serializes through `gray-matter`/js-yaml. A key set to `undefined` in the patch reaches js-yaml as `undefined` and is not a dumpable YAML type.                                                                          | FR-B5.5 ("empty ⇒ remove the key") **cannot** be expressed as `patch.labels = undefined`. `updateFrontmatter` gains an explicit `remove` option. See [§3.3](#33-the-removal-semantics-fr-b55).                                                                                          |
| **F4** | `BaseSettingsRepository.handleFor()` (`base-repository.ts:36`) does `def.schema.safeParse(raw)` on the **whole** value and falls back to `def.default` on failure. With `schema: z.array(SavedViewSchema)`, one malformed view discards **all** views.                                                           | FR-C2.3 ("skip the bad one, load the rest") requires the settings-layer schema to be permissive (`z.array(z.unknown())`) with per-item validation at the RPC boundary. See [§5.2](#52-saved-views-storage-d2).                                                                          |

---

## 1. Component and file inventory

Absolute paths, grouped by lib. `C` = create, `M` = modify. Every path below was opened and
read; line references are against the tree at the time of writing.

### 1.1 `libs/shared` — the contract and the one bridge (NFR-7)

| Op  | Path                                                                          | What changes                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M   | `D:/projects/ptah-extension/libs/shared/src/lib/types/task-spec.types.ts`     | `TASK_ESTIMATES` + `TaskEstimate`; five new fields on `TaskSpecSummary`; eight new codes on `TaskValidationIssue['code']`.                                                             |
| M   | `D:/projects/ptah-extension/libs/shared/src/lib/types/task-spec.contract.ts`  | `RenderTaskMdInput` gains five optional fields; `renderTaskMd`'s hand-ordered field list gains five **omitted-when-empty** entries. `renderFrontmatterBlock` is **untouched** (NFR-3). |
| C   | `D:/projects/ptah-extension/libs/shared/src/lib/types/task-graph.ts`          | Zero-dep derivation: `buildTaskGraph`, `TaskGraph`, `deriveCrossFileIssues`, `labelKey`, `labelColorIndex`.                                                                            |
| C   | `D:/projects/ptah-extension/libs/shared/src/lib/types/task-filter.ts`         | `TaskFilterSpec`, `TaskSortSpec`, `EMPTY_TASK_FILTER`, `filterTasks`, `sortTasks`, `TaskFilterSpecSchema`, `TaskSortSpecSchema`. **The single filter predicate (FR-C1.5).**            |
| C   | `D:/projects/ptah-extension/libs/shared/src/lib/types/task-view.types.ts`     | `SavedTaskView`, `SavedTaskViewSchema`, `MAX_SAVED_TASK_VIEWS`, `TaskMetadataPatch`, `TaskMetadataPatchSchema`, label limits.                                                          |
| M   | `D:/projects/ptah-extension/libs/shared/src/index.ts`                         | Add `export * from './lib/types/task-graph'`, `'./lib/types/task-filter'`, `'./lib/types/task-view.types'` beside the existing lines 28–29.                                            |
| M   | `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-tasks.types.ts` | Params/results for five new methods + `filter` on `TasksListParams` + `TasksBulkResultItem`.                                                                                           |
| M   | `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc.types.ts`           | Two sites: the `RpcMethodMap` block (currently lines **1800–1816**) **and** the `RPC_METHOD_ENTRIES` record (currently lines **2969–2977**). Both must gain all five methods.          |

### 1.2 `libs/backend/task-specs` — parse, scan, index, write

| Op  | Path                                                                           | What changes                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M   | `.../libs/backend/task-specs/src/lib/task-frontmatter.ts`                      | `TaskFrontmatterSchema` (line 30) gains five keys; the **separate manual lift** into `TaskSpecSummary` (lines 243–270) gains five reads + per-field validation issues; `updateFrontmatter` (line 285) gains a `remove` option (F3).                |
| M   | `.../libs/backend/task-specs/src/lib/task-scanner.service.ts`                  | After the parse loop (line 84–92), run `deriveCrossFileIssues` over the scanned set and merge the cross-file issues (`parent_cycle`, `parent_depth_exceeded`) back onto each task; recompute `frontmatterValid`.                                   |
| M   | `.../libs/backend/task-specs/src/lib/task-index.store.ts`                      | `RawTaskRow` (line 132) + `insertSql` (line 262) + `insertParams` (line 299) + `rowToSummary` (line 324) + `cloneSummary` (line 122) + `TaskIndexFilters` (line 36) → optional `filter: TaskFilterSpec`, applied via the **shared** `filterTasks`. |
| M   | `.../libs/backend/task-specs/src/lib/task-writer.service.ts`                   | New `updateMetadata`; `updateStatus` becomes a thin delegate; new private `applyFrontmatterPatch`; a `deferNotify` flag for bulk; `CreateTaskInput` gains the five fields. **`adoptFolder` is deliberately unchanged** (see §3.6).                 |
| M   | `.../libs/backend/task-specs/src/lib/task-doctor.service.ts`                   | `DoctorWarning['code']` (line 99) gains `dangling_parent \| parent_cycle \| parent_depth_exceeded \| dangling_relation`, reported read-only (§5.5). **No new `DoctorAction` kind** — see §3.7.                                                     |
| M   | `.../libs/backend/task-specs/src/lib/contract.guard.spec.ts`                   | Duty 4 round-trip extended to every new field × {absent, empty, single, many, quoted-scalar}. **Written first** (R1).                                                                                                                              |
| C   | `.../libs/backend/task-specs/src/lib/task-graph.spec.ts`                       | Cycle/rollup/inverse/label-union fixtures.                                                                                                                                                                                                         |
| C   | `.../libs/backend/task-specs/src/lib/task-writer.metadata.spec.ts`             | Body-preservation, key-removal, neighbour-byte-identity, BOM.                                                                                                                                                                                      |
| M   | `.../libs/backend/task-specs/src/lib/task-writer.conflict.integration.spec.ts` | Add the interleaved-external-write-mid-bulk case (DoD).                                                                                                                                                                                            |
| M   | `.../libs/backend/task-specs/src/lib/task-scanner.service.spec.ts`             | Nested `TASK_*/TASK_*/task.md` is **not** indexed (R3 / DoD).                                                                                                                                                                                      |
| M   | `.../libs/backend/task-specs/src/lib/task-index.store.spec.ts`                 | Round-trip of the five columns through **both** store impls (NFR-11).                                                                                                                                                                              |

### 1.3 `libs/backend/persistence-sqlite` — additive migration

| Op  | Path                                                                                      | What changes                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| C   | `.../libs/backend/persistence-sqlite/src/lib/migrations/0031_task_specs_metadata.ts`      | Five `ALTER TABLE task_specs ADD COLUMN` + one index. Pattern copied verbatim from `0028_gateway_conversation_workspace_root.ts`. |
| C   | `.../libs/backend/persistence-sqlite/src/lib/migrations/0031_task_specs_metadata.spec.ts` | Applies onto a 0029-shaped table; asserts existing rows survive with defaults.                                                    |
| M   | `.../libs/backend/persistence-sqlite/src/lib/migrations/index.ts`                         | Import + append `{ version: 31, name: '0031_task_specs_metadata', sql: ... }` after version 30 (line 253).                        |

### 1.4 `libs/backend/settings-core` — saved-views storage

| Op  | Path                                                                | What changes                                                                  |
| --- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| C   | `.../libs/backend/settings-core/src/schema/tasks-schema.ts`         | `TASKS_SAVED_VIEWS_DEF`, `TASKS_ACTIVE_VIEW_ID_DEF`. Permissive schemas (F4). |
| C   | `.../libs/backend/settings-core/src/repositories/tasks-settings.ts` | `TasksSettings extends BaseSettingsRepository`.                               |
| M   | `.../libs/backend/settings-core/src/di/tokens.ts`                   | `TASKS_SETTINGS: Symbol.for('TasksSettings')`.                                |
| M   | `.../libs/backend/settings-core/src/index.ts`                       | Export the two defs, the repository, and the entry type.                      |

### 1.5 `libs/backend/platform-*` — key routing + three registrations

| Op  | Path                                                                                | What changes                                                                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M   | `.../libs/backend/platform-core/src/file-settings-keys.ts`                          | `FILE_BASED_SETTINGS_KEYS` (line 47) += `'tasks.savedViews'`, `'tasks.activeViewId'`; `FILE_BASED_SETTINGS_DEFAULTS` (line 191) += `[]`, `''`. **Without this the keys do not route to `~/.ptah/settings.json` on VS Code** (D2, gate 1). |
| M   | `.../libs/backend/platform-vscode/src/settings/vscode-settings-registration.ts`     | Register `SETTINGS_TOKENS.TASKS_SETTINGS` beside `CRON_SETTINGS` (line 151).                                                                                                                                                              |
| M   | `.../libs/backend/platform-electron/src/settings/electron-settings-registration.ts` | Same, beside line 123.                                                                                                                                                                                                                    |
| M   | `.../libs/backend/platform-cli/src/settings/cli-settings-registration.ts`           | Same, beside line 126.                                                                                                                                                                                                                    |

### 1.6 `libs/backend/rpc-handlers` — the `tasks:` surface

| Op  | Path                                                                        | What changes                                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M   | `.../libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts`      | `METHODS` tuple (line 132) += 5; `register()` (line 166) += 5; five new private registrars; inject `SETTINGS_TOKENS.TASKS_SETTINGS`.                                                                                          |
| M   | `.../libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.schema.ts`        | Five new Zod param schemas; `TasksListParamsSchema` gains `filter`; `TasksCreateParamsSchema` gains the five metadata fields.                                                                                                 |
| M   | `.../libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.spec.ts` | Per-method params/results, sanitization, bulk per-item shape.                                                                                                                                                                 |
| —   | `.../libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`            | **No edit.** The `tasks` entry (line 242) references `TasksRpcHandlers.METHODS`, so it picks up new methods automatically. `rpc-allowlist.spec.ts` fails if a method reaches `RPC_METHOD_ENTRIES` without reaching `METHODS`. |
| —   | `.../libs/backend/vscode-core/src/messaging/rpc-handler.ts`                 | **No edit** — `'tasks:'` is present at line 84 (F1). Confirm, do not touch.                                                                                                                                                   |

### 1.7 `libs/backend/vscode-lm-tools` — the MCP agent path

| Op  | Path                                                                                                    | What changes                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M   | `.../libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/tasks-namespace.builder.ts` | `TaskCreateArgsSchema` (line 124) += 5; new `TaskUpdateArgsSchema` shape (status **or** metadata); `TaskSpecWriterLike` gains `updateMetadata`; `get` returns a `derived` block from the shared graph. |
| M   | `.../libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`          | `ptah_task_create` / `ptah_task_update` / `ptah_task_get` / `ptah_task_list` JSON-Schema + prose. `buildTaskListTool` is at line **121**; `buildTaskGetTool` at line **101**.                          |

### 1.8 `libs/frontend/tasks-ui` — the board

| Op  | Path                                                                                      | What changes                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M   | `.../libs/frontend/tasks-ui/src/lib/task-presentation.ts`                                 | `TASK_ESTIMATE_LABELS`, `taskEstimateBadge`, `LABEL_CHIP_CLASSES` (audited palette), `labelChipClass`, `TASK_VALIDATION_CODE_LABELS`, `TASK_RELATION_GROUP_LABELS`. |
| M   | `.../libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts`                      | Graph/filter/selection/views/bulk signals; per-task write serialization; `applyMetadata(..., {reload})`; push suppression during bulk.                              |
| C   | `.../libs/frontend/tasks-ui/src/lib/services/task-views.service.ts`                       | Saved-view CRUD over `tasks:getViews` / `tasks:saveViews`, modified-vs-saved tracking.                                                                              |
| C   | `.../libs/frontend/tasks-ui/src/lib/components/filter/task-filter-bar.component.ts`       | Facet menus, ANY/ALL toggle, removable chips, `23 of 181` counter, clear-all.                                                                                       |
| C   | `.../libs/frontend/tasks-ui/src/lib/components/filter/task-view-menu.component.ts`        | View list, create/rename/update/delete/reorder, cap message, modified badge.                                                                                        |
| C   | `.../libs/frontend/tasks-ui/src/lib/components/palette/task-command-palette.component.ts` | `role="dialog"` + `role="listbox"` palette, local to `tasks-ui` (FR-C6.8).                                                                                          |
| C   | `.../libs/frontend/tasks-ui/src/lib/components/palette/palette-match.ts`                  | Pure subsequence matcher + ranking. No runtime dependency (FR-C6.9).                                                                                                |
| C   | `.../libs/frontend/tasks-ui/src/lib/components/palette/palette-entries.ts`                | Entry catalogue + disabled-with-reason predicates.                                                                                                                  |
| C   | `.../libs/frontend/tasks-ui/src/lib/components/bulk/task-bulk-bar.component.ts`           | Selection count, target-status picker, confirm >10, progress `7 / 12`, cancel.                                                                                      |
| C   | `.../libs/frontend/tasks-ui/src/lib/components/bulk/task-bulk-summary.component.ts`       | Persistent (non-toast) per-item failure summary with on-disk status.                                                                                                |
| C   | `.../libs/frontend/tasks-ui/src/lib/components/detail/task-relations.component.ts`        | Five relation groups; authored vs derived affordances.                                                                                                              |
| C   | `.../libs/frontend/tasks-ui/src/lib/components/detail/task-metadata-editor.component.ts`  | Label input w/ completions, estimate picker, parent picker, relation add/remove.                                                                                    |
| M   | `.../libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts`                   | Host keydown scope, filter bar, bulk bar, palette host, filtered-empty state.                                                                                       |
| M   | `.../libs/frontend/tasks-ui/src/lib/components/board/task-board.component.ts`             | Roving-tabindex owner; arrow navigation across the filtered model.                                                                                                  |
| M   | `.../libs/frontend/tasks-ui/src/lib/components/board/task-column.component.ts`            | Filtered count in the header; forwards focus/selection inputs.                                                                                                      |
| M   | `.../libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts`              | Label chips, estimate badge, child rollup, parent breadcrumb, duplicate marker, checkbox, `tabindex`, `pending`.                                                    |
| C   | `.../libs/frontend/tasks-ui/src/lib/no-editor-dependency.spec.ts`                         | **The R11 ratchet** (F2).                                                                                                                                           |
| M   | `.../libs/frontend/tasks-ui/src/index.ts`                                                 | Export the new public components/services.                                                                                                                          |

### 1.9 `apps/ptah-cli`

| Op  | Path                                                   | What changes                                                                                                                                          |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| M   | `.../apps/ptah-cli/src/cli/commands/ptah-spec.ts`      | `--json` output carries the new fields (they ride on `TaskSpecSummary`); `list` accepts `--label` / `--estimate`. `TASK_CONFLICT` handling unchanged. |
| M   | `.../apps/ptah-cli/src/cli/commands/ptah-spec.spec.ts` | Coverage for the two new flags.                                                                                                                       |

**Total: 16 created, 30 modified. Two sites the requirements name that need NO edit: `rpc-handler.ts` (F1) and `manifest.ts`.**

---

## 2. Data-model design

### 2.1 Frontmatter keys — exact names, types, defaults

| Key (YAML)   | YAML type  | `TaskSpecSummary` field            | Absent ⇒    | Emitted by `renderTaskMd` when |
| ------------ | ---------- | ---------------------------------- | ----------- | ------------------------------ |
| `labels`     | `string[]` | `labels: string[]`                 | `[]`        | non-empty **only**             |
| `estimate`   | `string`   | `estimate?: TaskEstimate`          | `undefined` | set **only**                   |
| `parent`     | `string`   | `parent?: string`                  | `undefined` | set **only**                   |
| `duplicates` | `string[]` | `duplicates: string[]`             | `[]`        | non-empty **only**             |
| `relates_to` | `string[]` | `relatesTo: string[]`              | `[]`        | non-empty **only**             |
| `depends_on` | `string[]` | `dependsOn: string[]` _(existing)_ | `[]`        | **always** (unchanged — §5.3)  |

All six are `string`, `boolean`, or `readonly string[]`. **`renderFrontmatterBlock`
(`task-spec.contract.ts:222`) is not modified.** NFR-3 holds by construction.

`estimate` is the enum only:

```ts
export const TASK_ESTIMATES = ['XS', 'S', 'M', 'L', 'XL'] as const;
export type TaskEstimate = (typeof TASK_ESTIMATES)[number];
```

Exported from `task-spec.types.ts` beside `TASK_STATUSES`/`TASK_TYPES` (FR-B2.1). The order
of the tuple **is** the sort order (FR-C3.1). No numeric mapping exists anywhere in the
codebase — bucket counts only (FR-B2.5).

### 2.2 Emit path — `renderTaskMd`

Field list in `renderTaskMd` (`task-spec.contract.ts:257`) becomes:

```
id, status, type, title, depends_on, created, updated,
description?, executor?, parent?, estimate?, labels?, duplicates?, relates_to?, status_inferred?
```

Each new field is pushed **only** when non-empty:

```ts
if (input.parent !== undefined && input.parent.length > 0) fields.push(['parent', input.parent]);
if (input.estimate !== undefined) fields.push(['estimate', input.estimate]);
if (input.labels !== undefined && input.labels.length > 0) fields.push(['labels', input.labels]);
// duplicates, relatesTo identically
```

A create with no metadata therefore produces a carrier **byte-identical to today's**
(§5.3). This is asserted, not assumed — see [§8](#8-test-strategy).

### 2.3 The quoted-scalar case

`yamlScalar` (line 215) already routes anything failing `isPlainSafeScalar` through
`JSON.stringify`, which is a valid YAML double-quoted scalar. Verified by inspection against
the five enum values and against hostile labels:

| Value          | `isPlainSafeScalar`                                        | Emitted as           | `gray-matter` reads back |
| -------------- | ---------------------------------------------------------- | -------------------- | ------------------------ |
| `XS` … `XL`    | ✅ (matches `^[A-Za-z][A-Za-z0-9 _./()-]*$`, not reserved) | `estimate: XS`       | `"XS"`                   |
| `licensing`    | ✅                                                         | `  - licensing`      | `"licensing"`            |
| `needs:design` | ❌ (`:`)                                                   | `  - "needs:design"` | `"needs:design"`         |
| `#urgent`      | ❌ (`#`)                                                   | `  - "#urgent"`      | `"#urgent"`              |
| `2fa`          | ❌ (leading digit)                                         | `  - "2fa"`          | `"2fa"`                  |
| `-wip`         | ❌ (leading `-`)                                           | `  - "-wip"`         | `"-wip"`                 |
| `no`           | ❌ (reserved word)                                         | `  - "no"`           | `"no"`                   |
| `trailing `    | ❌ (trailing space)                                        | `  - "trailing "`    | `"trailing "`            |

None of the five estimate values collides with a YAML boolean token. **No emitter change.**
FR-B1.8 is a test obligation, not a code obligation.

### 2.4 Parse path — `parseTaskFile`

`TaskFrontmatterSchema` (documentation half) gains:

```ts
labels: z.array(z.string()).nullish(),
estimate: z.string().nullish(),
parent: z.string().nullish(),
duplicates: z.array(z.string()).nullish(),
relates_to: z.array(z.string()).nullish(),
```

The **manual lift** (the half that actually decides what reaches `TaskSpecSummary`) gains one
block per field, each following the established `depends_on` shape at lines 195–223:
present-but-malformed ⇒ warning + safe default, never exclusion (NFR-11).

| Field                     | Shape failure                                                                                        | Well-formed failure                                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `labels`                  | `invalid_labels` → `[]`                                                                              | per-entry: newline / `> 32` chars / `> 12` entries ⇒ `invalid_labels` (kept in the summary verbatim; the **write** boundary rejects, the **read** boundary warns) |
| `estimate`                | not in `TASK_ESTIMATES` ⇒ `invalid_estimate`, field left `undefined`, raw value named in the message | —                                                                                                                                                                 |
| `parent`                  | not a string, or not a single path segment ⇒ `invalid_parent`                                        | `parent === folderName` ⇒ `parent_cycle`; not in `knownFolders` ⇒ `dangling_parent`                                                                               |
| `duplicates`/`relates_to` | not `string[]` ⇒ `invalid_relation` (`field` names the key)                                          | self-reference or not in `knownFolders` ⇒ `dangling_relation` naming field + id (FR-B4.6/4.7)                                                                     |

Duplicate entries within one relation array are **not** rewritten out of the file
(FR-B4.8) — de-duplication happens only in `buildTaskGraph` for display.

`knownFolders` is supplied only by `TaskScannerService` (line 121), exactly as
`dangling_depends_on` is today. A single-file reparse (`getDetail`,
`writeCarrier` round-trip) omits it and therefore skips the dangling checks — this is the
existing, deliberate contract documented at `task-frontmatter.ts:96–109`. Do not change it.

New `TaskValidationIssue['code']` members (union at `task-spec.types.ts:41`):

```
invalid_estimate | invalid_labels | invalid_parent | dangling_parent
parent_cycle | parent_depth_exceeded | invalid_relation | dangling_relation
```

`libs/frontend/tasks-ui/src/lib/task-presentation.ts` keys a `Record<code, string>` off this
union, so a code added backend-side **fails typecheck** in the frontend until it is
explained — the same guarantee `TASK_EXCLUSION_REASON_LABELS` already provides.

### 2.5 Derived (never persisted) fields

Computed by `buildTaskGraph`; **no column, no frontmatter key, no settings entry**:

`children`, `childRollup`, `blocks`, `duplicatedBy`, `related`, `knownLabels`,
`knownExecutors`, `labelColorIndex`, `hasUnmetDependencies`.

The two **cross-file validation issues** (`parent_cycle` in its multi-node form,
`parent_depth_exceeded`) are the one exception: they are derived, but they are _merged into
`validationIssues` by the scanner_ before `replaceWorkspace`, so the index row is
self-describing and `tasks:list` carries them. They are recomputed identically on every
rebuild; deleting `ptah.db` loses nothing.

### 2.6 SQLite migration `0031`

```sql
-- 0031_task_specs_metadata — additive columns for TASK_2026_181 family B.
-- Forward-only, no backfill: existing rows take the declared defaults, and
-- nothing rewrites a carrier on disk (NFR-9).
-- SECURITY: SQL MUST stay static. No `${...}` interpolation.
ALTER TABLE task_specs ADD COLUMN labels     TEXT NOT NULL DEFAULT '[]';
ALTER TABLE task_specs ADD COLUMN estimate   TEXT;
ALTER TABLE task_specs ADD COLUMN parent     TEXT;
ALTER TABLE task_specs ADD COLUMN duplicates TEXT NOT NULL DEFAULT '[]';
ALTER TABLE task_specs ADD COLUMN relates_to TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_task_specs_ws_parent
  ON task_specs (workspace_root, parent);
```

Matches the JSON-in-TEXT + `DEFAULT '[]'` convention `depends_on` established at
`0029_task_specs.ts:19`. `ADD COLUMN IF NOT EXISTS` does not exist in SQLite; the runner's
`schema_migrations` bookkeeping guarantees once-only execution, exactly as
`0028_gateway_conversation_workspace_root.ts` relies on. **The reserved `claim` column is
not repurposed** (§4.2 rule 4).

Store wiring: five entries each in `RawTaskRow`, `insertSql`, the `ON CONFLICT … DO UPDATE`
list, `insertParams`, and `rowToSummary`; `cloneSummary` (line 122) must clone the three new
arrays or the in-memory store hands out shared references. Both impls are covered by the
same parity spec (NFR-11).

---

## 3. Write-path design

### 3.1 One method, one conflict domain (FR-B5.1)

The read → parse → patch → **pre-write re-read** → byte-compare → write → notify sequence
(today inlined in `updateStatus`, lines 368–472) is extracted verbatim into:

```ts
private async applyFrontmatterPatch(
  root: string,
  taskId: string,
  patch: Partial<TaskFrontmatter>,
  remove: readonly string[],
  deferNotify: boolean,
): Promise<UpdateMetadataResult>
```

Two public entry points call it and **nothing else writes a carrier**:

```ts
async updateMetadata(root, taskId, input: UpdateMetadataInput, opts?: { deferNotify?: boolean })
async updateStatus(root, taskId, status)   // ⇒ this.updateMetadata(root, taskId, { status })
```

`updateStatus` keeps its exported signature and its declared `UpdateStatusResult` union, so
the RPC handler, the MCP namespace, and `apps/ptah-cli` need no change on that path. Its one
new line maps the (unreachable — inputs are Zod-validated upstream) `INVALID_PARAMS` onto
`WRITE_FAILED` with an explanatory comment, rather than widening the wire error union in
`rpc-tasks.types.ts` for a case that cannot occur.

`UpdateMetadataInput`:

```ts
export interface UpdateMetadataInput {
  status?: TaskStatus;
  labels?: readonly string[]; // full replacement; [] ⇒ remove the key
  estimate?: TaskEstimate | null; // null ⇒ remove the key
  parent?: string | null; // null ⇒ remove the key
  duplicates?: readonly string[]; // [] ⇒ remove the key
  relatesTo?: readonly string[]; // [] ⇒ remove the key
  dependsOn?: readonly string[]; // [] ⇒ written as `[]` (existing behaviour, §5.3)
}
```

Every field is a **full replacement**, never a merge. Add/remove of a single label is
computed by the caller from the task it already holds; that keeps the writer free of
read-modify-write semantics it cannot make atomic.

### 3.2 Conflict semantics reused, not re-implemented (FR-B5.2, R6)

`applyFrontmatterPatch` keeps the whole-file content comparison at line 440 unchanged. It is
strict on purpose: _any_ concurrent touch refuses the write. R6's conflict-fatigue cost is
accepted and paid down two ways — an actionable message (FR-C4.7 surfaces the on-disk
status), and client-side serialization (§3.5) so the UI never conflicts with itself.

### 3.3 The removal semantics (FR-B5.5)

`updateFrontmatter` gains a third parameter (F3):

```ts
export interface UpdateFrontmatterOptions {
  /** Keys DELETED from the merged frontmatter, applied after the patch merge. */
  readonly remove?: readonly string[];
}
export function updateFrontmatter(raw: string, patch: Partial<TaskFrontmatter>, options?: UpdateFrontmatterOptions): string;
```

Implementation is three lines after the existing merge at line 308:

```ts
const merged: Record<string, unknown> = { ...existing, ...patch };
for (const key of options?.remove ?? []) delete merged[key];
```

`updateStatus`'s existing call site passes no options and is behaviourally unchanged.

**Two pre-existing behaviours a developer must not "fix":**

1. `matter.stringify` re-serializes the _whole_ frontmatter block, so untouched keys may
   change quoting style. This already happens on every status change today. It is not an
   add/remove/reorder, so FR-B5.4 holds. Do not hand-roll a surgical line-splice to avoid
   it — that would be a second write path.
2. Frontmatter **comments** do not survive that round trip. Also pre-existing. Out of scope.

**Key ordering** (FR-B5.4): the merge preserves `existing` insertion order and appends only
genuinely new keys at the end. A first-ever `labels` write therefore appends `labels:` to the
end of the block and disturbs nothing above it.

### 3.4 Body preservation (FR-B5.3)

Free, and already correct: `updateFrontmatter` splices only the `FRONTMATTER_RE` match and
concatenates `source.slice(block.length)` untouched, re-applying a stripped BOM at line 317.
The obligation is a test (`task-writer.metadata.spec.ts`), not code.

### 3.5 Same-task serialization (FR-B5.8)

Client-side, in `TasksStore`. A per-task promise tail:

```ts
private readonly writeTails = new Map<string, Promise<unknown>>();

private enqueueWrite<T>(taskId: string, op: () => Promise<T>): Promise<T> {
  const prev = this.writeTails.get(taskId) ?? Promise.resolve();
  const run = prev.then(op, op);            // a failed predecessor must not block the queue
  const tail = run.then(() => undefined, () => undefined);
  this.writeTails.set(taskId, tail);
  void tail.then(() => {
    if (this.writeTails.get(taskId) === tail) this.writeTails.delete(taskId);  // identity check: only the current tail self-evicts
  });
  return run;
}
```

Every mutating store method routes through it. The identity check is what prevents a stale
`finally` from deleting a newer chain and letting two writes overlap again.

This does **not** provide correctness — the writer's own pre-write re-read does. It removes
the UI's ability to manufacture a `TASK_CONFLICT` against itself by issuing a second write
from a pre-first-write snapshot.

### 3.6 What is deliberately _not_ touched

- **`adoptFolder`** gains no metadata fields. Adoption retrofits a carrier onto existing
  work; there is no metadata to deduce, and adding fields would be indistinguishable from a
  backfill (§5.1, NFR-9).
- **`registry-generator.service.ts`** is unchanged. Widening the generated table is not
  requested and would rewrite a generated file for every workspace on first activation.
- **`TaskStartService`** and `apps/ptah-extension-webview` routing: untouched (§7, R12).

### 3.7 The doctor (§5.5)

`task-doctor.service.ts` gains **read-only warnings only** — four new `DoctorWarning` codes
beside `id_mismatch`/`unparseable_carrier` (line 99). **No new `DoctorAction` kind**, so the
`assertNever` exhaustiveness guard in `tasks-rpc.handlers.ts:120` is never tripped and no
"normalize metadata" action can exist. `TasksDoctorWarning['code']` in
`rpc-tasks.types.ts:208` widens in lockstep.

---

## 4. Derived-index design

All of it lives in **one zero-dependency module**,
`libs/shared/src/lib/types/task-graph.ts`, so the backend scanner and `tasks-ui` run
**identical code** (NFR-7 — `libs/shared` is the only bridge).

```ts
export interface TaskChildRollup {
  total: number;
  done: number;
  cancelled: number;
  open: number;
}

export interface TaskGraph {
  readonly byId: ReadonlyMap<string, TaskSpecSummary>;
  readonly children: ReadonlyMap<string, readonly string[]>;
  readonly rollup: ReadonlyMap<string, TaskChildRollup>;
  readonly effectiveParent: ReadonlyMap<string, string>; // corrections applied
  readonly blocks: ReadonlyMap<string, readonly string[]>;
  readonly duplicatedBy: ReadonlyMap<string, readonly string[]>;
  readonly related: ReadonlyMap<string, readonly string[]>;
  readonly knownLabels: readonly string[]; // canonical, deterministic order
  readonly knownExecutors: readonly string[];
  readonly unmetDependencies: ReadonlyMap<string, readonly string[]>;
}
export function buildTaskGraph(tasks: readonly TaskSpecSummary[]): TaskGraph;
export function deriveCrossFileIssues(tasks: readonly TaskSpecSummary[]): ReadonlyMap<string, readonly TaskValidationIssue[]>;
```

### 4.1 Parentage: correction pass, then rollup

`parent` is single-valued, so the parent relation is a **functional graph** (out-degree ≤ 1).
Two passes, both iterative, both O(N):

**Pass 1 — cycle marking (three-colour, explicit stack, no recursion).**

```
colour: Map<id, WHITE|GREY|BLACK>, all WHITE
for each id in tasks (sorted by id, for determinism):
  if colour(id) != WHITE: continue
  walk = []                       // the current chain, in order
  cur = id
  while cur exists and colour(cur) == WHITE:
     colour(cur) = GREY; walk.push(cur)
     cur = declaredParent(cur)    // undefined ⇒ stop
  if cur exists and colour(cur) == GREY:
     // cur is on the current walk ⇒ everything from cur onward is a cycle
     mark every member of walk from index_of(cur) .. end as ON_CYCLE
  for each n in walk: colour(n) = BLACK
```

**Termination guarantee.** Each node is coloured `GREY` at most once across the entire
algorithm (the `while` condition requires `WHITE`), and each node is coloured `BLACK` exactly
once. The outer loop therefore performs at most `N` colour transitions in total and the inner
`while` cannot revisit a node it already coloured. A cycle of any length — 1
(self-reference), 2, or 1000 — terminates in the pass that first enters it, because the
second visit finds `GREY`, not `WHITE`. There is no input, cyclic or acyclic, on which this
loop does not halt. **This discharges R8 by construction, not by a depth cap.**

**Pass 2 — effective parent.** For each task, in order of precedence:

| Condition                                 | Issue emitted           | Effective parent    |
| ----------------------------------------- | ----------------------- | ------------------- |
| no `parent` key                           | —                       | none (_standalone_) |
| on a cycle (pass 1), incl. self-parent    | `parent_cycle`          | none (FR-B3.7)      |
| `parent` not in `byId`                    | `dangling_parent`       | none (FR-B3.6)      |
| `declaredParent(parent)` exists in `byId` | `parent_depth_exceeded` | none (FR-B3.5)      |
| otherwise                                 | —                       | `parent`            |

`parent_depth_exceeded` attaches to the **child whose declared parent itself declares a
parent** — the task making the invalid claim. Both tasks stay on the board (FR-B3.5).

**Rollup.** `children(p) = { c : effectiveParent(c) === p }`, sorted by id.
`rollup(p) = { total, done, cancelled, open }` where `done` counts `status === 'done'`,
`cancelled` counts `'cancelled'`, `open = total − done − cancelled`. The card renders
`done / total` (FR-B3.3); the FR-B3.8 warning fires when `open > 0` and the parent is being
moved to `done` — a warning, never a block.

**FR-B3.2 is structural**: `children` is read out of `effectiveParent`, which is read out of
each _child's_ frontmatter. Nothing in this module can produce a write, so a parent's carrier
is provably never modified when a child appears, is re-parented, or is deleted.

**FR-B3.9 is untouched by construction**: `id-allocator.ts` consumes
`TaskWriterService.listFolderNames` (`task-writer.service.ts:485`), a single
`readDirectory` filtered to directories. Nothing in this task alters the scan depth. The
R3 regression test asserts a nested `TASK_*/TASK_*/task.md` is never indexed — which is
already true (`task-scanner.service.ts:104` builds exactly one candidate path per folder),
so the test _freezes_ the flat contract rather than implementing it.

### 4.2 Inverse relations — one pass, no traversal

```
for each task t (iterated in id-sorted order):
  for each d in t.dependsOn      : if d !== t.id && byId.has(d) → blocks[d] += t.id
  for each d in t.duplicates     : if d !== t.id && byId.has(d) → duplicatedBy[d] += t.id
  for each r in t.relatesTo      : if r !== t.id && byId.has(r) → related[r] += t.id
                                                                 related[t.id] += r
```

Every value set is de-duplicated on insert. There is **no traversal**, so no cycle can arise:
a self-edge is filtered (already reported as `dangling_relation` by the parser), and a
mutual `relates_to` pair produces the same union from either direction. `related` is the
symmetric closure required by FR-B4.5, computed from one authored side only (D3).

Ordering is deterministic: authored entries first in authored order, then derived entries in
id-sorted order. That satisfies FR-B4.9's need to visually distinguish **authored** (this
task's own array — removable here) from **derived** (someone else's array — the affordance
navigates to the authoring task or is disabled with a reason, never a silent no-op).

**FR-B4.3 — "blocks" writes exactly one carrier.** A "B blocks A" affordance on B's panel
issues `tasks:updateMetadata` on **A** with `dependsOn: [...A.dependsOn, B.id]`. One file, one
conflict domain, no `blocks:` key anywhere.

### 4.3 Label union and colour

```ts
export function labelKey(raw: string): string {
  return raw.trim().toLowerCase();
}
```

`knownLabels` is built by iterating tasks in id-sorted order and labels in authored order
into a `Map<labelKey, canonicalDisplayText>`; first-seen wins, so the union is deterministic
and independent of file-system iteration order. FR-B1.4 (case/whitespace-insensitive match),
FR-B1.5 (completions from the union — **no registry file**), and FR-B1.6 (a removed label
vanishes on the next rebuild with no cleanup step) all fall out of this one map.

Colour (FR-B1.9, NFR-12, R15): FNV-1a 32-bit over `labelKey(raw)` — so `Licensing` and
`licensing ` get the **same** chip — modulo a fixed palette exported from
`task-presentation.ts`. The palette is a hand-audited list of Tailwind/daisyui class triples
verified at ≥ 4.5:1 text contrast in both the light and dark VS Code themes. **Nothing is
persisted**, and colour is never the sole carrier of meaning — every chip renders its text.

### 4.4 Where the graph lives at runtime

| Consumer                   | How                                                                                                                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TaskScannerService.scan`  | calls `deriveCrossFileIssues` once per scan and merges the result into each task's `validationIssues`, recomputing `frontmatterValid`, **before** `replaceWorkspace`.                                       |
| `TasksStore` (webview)     | `readonly graph = computed(() => buildTaskGraph(this.allTasks()))` over the already-loaded board payload. One `computed`, invalidated only when the board payload changes — **not** per keystroke (NFR-10). |
| `tasks:get` / detail panel | the panel reads inverses and rollups from `TasksStore.graph()`, **not** from the RPC. `TasksGetResult` is unchanged.                                                                                        |
| MCP `ptah_task_get`        | calls `index.list()` (as `check()` already does at builder line 389) and returns a `derived` block from the same `buildTaskGraph`, so an agent never has to do graph maths.                                 |

Client-side derivation means SQLite availability gates nothing (NFR-11): the in-memory store
returns the same summaries, so the same graph.

---

## 5. RPC surface

### 5.1 The five new methods

All under the already-allowlisted `tasks:` prefix (F1).

#### `tasks:updateMetadata`

```ts
// rpc-tasks.types.ts
export interface TasksUpdateMetadataParams extends TasksWorkspaceScopedParams {
  taskId: string;
  patch: TaskMetadataPatch; // from libs/shared/.../task-view.types.ts
}
export interface TasksUpdateMetadataResult {
  success: boolean;
  task?: TaskSpecSummary;
  error?: {
    code: 'TASK_NOT_FOUND' | 'TASK_EXCLUDED' | 'WRITE_FAILED' | 'TASK_CONFLICT' | 'INVALID_PARAMS';
    message: string;
  };
}
```

```ts
// tasks-rpc.schema.ts — composed from the SHARED patch schema so the RPC and the
// MCP tool cannot drift.
export const TasksUpdateMetadataParamsSchema = z.object({
  workspaceRoot,
  taskId: taskIdSegment, // single path segment (NFR-13)
  patch: TaskMetadataPatchSchema,
});
```

```ts
// libs/shared/.../task-view.types.ts — the single definition, Zod 4
export const MAX_LABEL_LENGTH = 32;
export const MAX_LABELS_PER_TASK = 12;

const LabelSchema = z
  .string()
  .min(1)
  .max(MAX_LABEL_LENGTH)
  .refine((v) => !/[\r\n]/.test(v), 'a label may not contain a newline')
  .refine((v) => v.trim().length > 0, 'a label may not be blank');

// 🛑 DEFECT — THE THREE LINES BELOW ARE WRONG. DO NOT IMPLEMENT THEM.
// This is the WEAK check that GATING NOTE G3 exists to eliminate, and writing
// it here would have propagated it to all five boundaries at once while
// appearing to discharge the note. It accepts " .. ", "   ", "C:", the
// drive-relative "C:NAME" and an embedded NUL — every one of which escapes or
// corrupts a join onto the spec root.
//
// SHIPPED INSTEAD (Batch 4), and the only correct source:
//   import { TaskIdRefSchema, isSingleTaskPathSegment }
//     from 'libs/shared/src/lib/types/task-view.types';
// See batches.md → 🛑 PLAN DEFECT P1 / BR-14.
//
// const TaskIdRefSchema = z.string().min(1)
//   .refine((v) => !v.includes('/') && !v.includes('\\') && v !== '..',
//           'a task id must be a single path segment');

export const TaskMetadataPatchSchema = z
  .object({
    status: z.enum(TASK_STATUSES).optional(),
    labels: z.array(LabelSchema).max(MAX_LABELS_PER_TASK).optional(),
    estimate: z.enum(TASK_ESTIMATES).nullable().optional(),
    parent: TaskIdRefSchema.nullable().optional(),
    duplicates: z.array(TaskIdRefSchema).optional(),
    relatesTo: z.array(TaskIdRefSchema).optional(),
    dependsOn: z.array(TaskIdRefSchema).optional(),
    // 🛑 DEFECT — `Object.keys(p).length > 0` IS WRONG. Zod 4 keeps an explicitly-
    // `undefined` optional key in its output, so `{ labels: undefined }` has a key
    // count of 1, passes this refinement, reaches `updateFrontmatter`, refreshes
    // `updated` and rewrites a gitignored carrier the caller asked NOT to change.
    // SHIPPED INSTEAD (Batch 4):
    //   .refine((p) => Object.values(p).some((v) => v !== undefined), …)
  })
  .refine((p) => Object.values(p).some((v) => v !== undefined), 'patch must change at least one field');
```

FR-B1.7's three limits (newline / 32 chars / 12 labels) are enforced **here**, so they hold
identically on the RPC path, the MCP path, and the CLI path. The visible, specific message is
the Zod issue message surfaced by the store.

#### `tasks:bulkUpdateStatus` and `tasks:bulkUpdateLabels`

```ts
export interface TasksBulkResultItem {
  taskId: string;
  ok: boolean;
  /** true when nothing needed writing (already carried the label / already in status). */
  noop?: boolean;
  error?: { code: 'TASK_CONFLICT' | 'TASK_NOT_FOUND' | 'TASK_EXCLUDED' | 'WRITE_FAILED' | 'INVALID_PARAMS'; message: string };
  /** ON CONFLICT ONLY: the status the carrier actually holds right now (FR-C4.7). */
  currentStatus?: TaskStatus;
}

export interface TasksBulkUpdateStatusParams extends TasksWorkspaceScopedParams {
  taskIds: string[]; // ≤ BULK_CHUNK_SIZE per call; the client chunks
  status: TaskStatus;
}
export interface TasksBulkUpdateStatusResult {
  results: TasksBulkResultItem[];
}

export interface TasksBulkUpdateLabelsParams extends TasksWorkspaceScopedParams {
  taskIds: string[];
  add?: string[];
  remove?: string[];
}
export interface TasksBulkUpdateLabelsResult {
  results: TasksBulkResultItem[];
}
```

**The result is a list. There is no boolean anywhere on this path (D5).** The handler loop:

```
for each taskId:
  r = await writer.updateMetadata(root, taskId, patch, { deferNotify: true })
  if r fails with TASK_CONFLICT: re-read the carrier, parseTaskFile, attach currentStatus
  push one item
finally: await index.applyFolderChange(root, <any touched folder>)   // ONE rebuild, ONE push
```

`deferNotify: true` suppresses the per-write `this.notify(...)` at
`task-writer.service.ts:467`. Without it, N writes cause N full `.ptah/specs` rescans **and**
N `tasks:changed` broadcasts — R5 wearing a different hat.

#### `tasks:getViews` and `tasks:saveViews`

```ts
export type TasksGetViewsParams = TasksWorkspaceScopedParams;
export interface TasksGetViewsResult {
  views: SavedTaskView[];
  activeViewId: string | null;
  /** Stored entries dropped because they failed validation (FR-C2.3). */
  skipped: number;
}
export interface TasksSaveViewsParams extends TasksWorkspaceScopedParams {
  views: SavedTaskView[]; // whole-list replace, ≤ MAX_SAVED_TASK_VIEWS
  activeViewId?: string | null;
}
export interface TasksSaveViewsResult {
  success: boolean;
  error?: { code: 'INVALID_PARAMS' | 'CAP_EXCEEDED' | 'WRITE_FAILED'; message: string };
}
```

Whole-list replace mirrors `PTAH_CLI_AGENTS_DEF`. Per-view CRUD is client-side arithmetic
over the list plus one write, so create/rename/update/delete/reorder (FR-C2.5) are all one
method.

#### `tasks:list` gains a filter (no new method)

`TasksListParams` gains `filter?: TaskFilterSpec`; `TasksListParamsSchema` gains
`filter: TaskFilterSpecSchema.optional()`. The handler applies the **shared** `filterTasks`
over `index.list(...)`'s summaries. `status`/`type` stay for compatibility and are folded
into the spec before the call. This is what makes FR-C1.5's parity claim testable rather than
aspirational.

### 5.2 Saved-views storage (D2)

**Gate 1 — `FILE_BASED_SETTINGS_KEYS`.** Add `'tasks.savedViews'` and `'tasks.activeViewId'`
to the `Set` at `file-settings-keys.ts:47`, plus `[]` / `''` to
`FILE_BASED_SETTINGS_DEFAULTS` at line 191. Without this, `VscodeWorkspaceProvider` routes
the key to `vscode.workspace.getConfiguration`, which has no schema for it, and the write is
silently lost.

**Gate 2 — a `tasks:`-prefixed RPC.** `settings:` is export/import only and `config:` is
per-setting-typed; there is no generic get/set. `tasks:getViews`/`tasks:saveViews` are the
cheapest correct route because the prefix is already allowlisted (F1).

**Gate 3 (found during investigation, F4) — the settings schema must be permissive.**

```ts
// libs/backend/settings-core/src/schema/tasks-schema.ts
//
// Deliberately PERMISSIVE. `BaseSettingsRepository.handleFor()` runs safeParse over the
// WHOLE value and falls back to `default` on failure — a strict per-item schema here would
// make one malformed view discard every view, which FR-C2.3 forbids. Per-item validation
// happens at the RPC boundary with SavedTaskViewSchema from @ptah-extension/shared.
//
// settings-core does not depend on @ptah-extension/shared (see cli-subagent-schema.ts) and
// must not start.
export const TASKS_SAVED_VIEWS_DEF = defineSetting({
  key: 'tasks.savedViews',
  scope: 'global',
  sensitivity: 'plain',
  schema: z.array(z.unknown()),
  default: [] as unknown[],
  sinceVersion: 1,
});
export const TASKS_ACTIVE_VIEW_ID_DEF = defineSetting({
  key: 'tasks.activeViewId',
  scope: 'global',
  sensitivity: 'plain',
  schema: z.string(),
  default: '',
  sinceVersion: 1,
});
```

`tasks:getViews` then does `SavedTaskViewSchema.safeParse(entry)` **per element**, drops
failures with `logger.warn`, and returns `skipped: n` (FR-C2.3). A malformed or unreadable
settings file yields `{ views: [], activeViewId: null, skipped: 0 }` — the board renders
(NFR-11).

`SavedTaskView` carries only `{ id, name, filter, sort, order }` — **no task data, no task
ids, no result snapshot** (FR-C2.1). A view naming a vanished label or executor still
applies, matches nothing on that facet, and the chip carries a "no longer present in this
workspace" note computed against `graph().knownLabels` / `knownExecutors`. Nothing is
auto-pruned (FR-C2.4).

### 5.3 Dual registration — the exact checklist

| Half           | Site                                                              | Action                                                     |
| -------------- | ----------------------------------------------------------------- | ---------------------------------------------------------- |
| Compile-time A | `libs/shared/.../rpc/rpc-tasks.types.ts`                          | params + result interfaces                                 |
| Compile-time B | `libs/shared/.../rpc.types.ts` `RpcMethodMap` (≈ line 1800)       | `'tasks:updateMetadata': { params; result }` × 5           |
| Compile-time C | `libs/shared/.../rpc.types.ts` `RPC_METHOD_ENTRIES` (≈ line 2969) | `'tasks:updateMetadata': true` × 5                         |
| Compile-time D | `TasksRpcHandlers.METHODS` (line 132)                             | append × 5, `satisfies readonly RpcMethodName[]`           |
| **Runtime**    | `ALLOWED_METHOD_PREFIXES` (`rpc-handler.ts:84`)                   | **already contains `'tasks:'` — verify, do not edit (F1)** |

Miss **C** and `assertManifestInvariants` fails. Miss **D** and the same spec fails ("claims
every registry method exactly once"). Miss the runtime half for a _new_ prefix and
`rpc-allowlist.spec.ts` fails with a message naming the file and line. All three run inside
the NFR-14 gate under `-p rpc-handlers`. **The silent-crash failure mode this task most fears
is already automated; the job is to keep that automation in the gate, not to re-verify by
hand.**

---

## 6. Frontend design

Angular 21 throughout: `signal` / `computed` / `inject`, `ChangeDetectionStrategy.OnPush` on
every new and modified component, `track` on every `@for`, no `[innerHTML]`.

### 6.1 Store shape

```ts
// ── session state (never persisted) ────────────────────────────────────────
private readonly _filter        = signal<TaskFilterSpec>(EMPTY_TASK_FILTER);
private readonly _sort          = signal<TaskSortSpec>({ field: 'updated', direction: 'desc' });
private readonly _selection     = signal<ReadonlySet<string>>(new Set());
private readonly _selectionAnchor = signal<string | null>(null);
private readonly _pending       = signal<ReadonlySet<string>>(new Set());
private readonly _paletteOpen   = signal(false);
private readonly _bulk          = signal<BulkProgress | null>(null);
private readonly _bulkSummary   = signal<BulkSummary | null>(null);

// ── derived ────────────────────────────────────────────────────────────────
readonly allTasks    = computed(() => TASK_STATUSES.flatMap((s) => this._columns()[s]));
readonly graph       = computed(() => buildTaskGraph(this.allTasks()));
readonly filtered    = computed(() => filterTasks(this.allTasks(), this._filter(), this.graph()));
readonly filteredIds = computed(() => new Set(this.filtered().map((t) => t.id)));
readonly board       = computed<TaskBoardColumn[]>(() => {
  const keep = this.filteredIds(); const sort = this._sort();
  return TASK_STATUSES.map((status) => ({
    status,
    tasks: sortTasks(this._columns()[status].filter((t) => keep.has(t.id)), sort),
  }));
});
readonly matchedCount = computed(() => this.filtered().length);
readonly totalIndexed = computed(() => this.allTasks().length);
readonly knownLabels  = computed(() => this.graph().knownLabels);   // memoized (NFR-10)
readonly estimateBuckets = computed(() => /* count per bucket + unestimated */);
readonly filteredEmpty = computed(() => this.loaded() && this.totalIndexed() > 0 && this.matchedCount() === 0);
```

The whole filter path is `computed()` over an **already-loaded payload**: changing a filter
issues no RPC and triggers no reload (FR-C1.4, NFR-10 → **0 reloads**). `knownLabels` is one
memoized `computed`, not a per-keystroke recomputation (FR-B1.5, NFR-10).

`board` replaces the existing `computed` at `tasks-store.service.ts:230`; because the
existing header counters (`totalCount`, `statusCounts`, `doneCount`, `activeCount`) read
`_columns()` directly, they keep reporting **indexed** totals while the columns report
**filtered** counts — which is exactly the `23 of 181` contract in FR-C1.2.

The filter survives a reload for free (FR-C1.7): it is store state, and `loadBoard` only
replaces `_columns`.

### 6.2 Bulk operations — chunked, cancellable, ≤ 1 reload

```ts
private static readonly BULK_CHUNK_SIZE = 20;
private static readonly BULK_CONFIRM_THRESHOLD = 10;   // FR-C4.12

async bulkUpdateStatus(status: TaskStatus): Promise<void> {
  const ids = [...this._selection()];
  this._bulkCancelled = false;
  this._bulk.set({ done: 0, total: ids.length, cancelled: false });
  const results: TasksBulkResultItem[] = [];
  try {
    for (let i = 0; i < ids.length; i += TasksStore.BULK_CHUNK_SIZE) {
      if (this._bulkCancelled) break;                       // FR-C4.9
      const chunk = ids.slice(i, i + TasksStore.BULK_CHUNK_SIZE);
      this._pending.update((s) => new Set([...s, ...chunk]));   // FR-C4.11
      const r = await this.rpc.call('tasks:bulkUpdateStatus', { taskIds: chunk, status, ...this.workspaceParam() });
      results.push(...(r.data?.results ?? chunk.map(failedItem)));
      this._bulk.update((p) => p && { ...p, done: p.done + chunk.length });
      this._pending.update((s) => { const n = new Set(s); chunk.forEach((id) => n.delete(id)); return n; });
    }
  } finally {
    this._pending.set(new Set());
    this._selection.set(new Set(results.filter((r) => !r.ok).map((r) => r.taskId)));  // FR-C4.6
    this._bulkSummary.set(summarize(results, this._bulkCancelled));                    // FR-C4.5
    this._bulk.set(null);
    await this.loadBoard();                                  // EXACTLY ONE — FR-C4.10 / R5
  }
}
```

**≤ 1 board reload is enforced on two fronts.** The loop never calls `loadBoard`; only the
`finally` does. And `handleMessage` (the `tasks:changed` push handler at
`tasks-store.service.ts:290`) short-circuits while `this._bulk() !== null`, setting a
`_missedPush` flag instead — otherwise the backend's end-of-chunk broadcasts would each
trigger `refreshActiveFromPush`. The single `loadBoard()` in the `finally` also clears the
flag. **The store test counts `tasks:board` calls; the assertion is `≤ 1`, not "roughly one".**

`updateStatus` (single-card) keeps its current behaviour — write, then `loadBoard()`. It is
refactored to share `applyMetadata(taskId, patch, { reload: true })` with the bulk path so
there is one client mutation funnel.

Cancellation is **chunk-granular** and the UI says so verbatim: _"Cancelled after 40 of 120.
Writes already issued completed and were not reversed."_ That is precisely FR-C4.9's
contract. No auto-retry ever fires (FR-C4.8); Retry is a button scoped to the still-selected
failures.

Language ban (FR-C4.4): the words _atomic_, _transactional_, and _all-or-nothing_ appear in
no label, tooltip, or message. A lint-free way to keep it honest is a one-line assertion in
`task-bulk-summary.component.spec.ts` over the rendered text.

### 6.3 Selection model (FR-C4.1–4.2)

`_selection` (multi-select, checkbox / shift-range / ctrl-toggle / select-all-matching) is
**completely independent** of the existing `_selectedTaskId` (detail panel). Entering
multi-select opens no detail; clearing the selection closes no detail. Shift-range resolves
against the **filtered, sorted, column-flattened** order so a range means what the user sees.
Select-all-matching uses `filteredIds()`, honouring the active filter.

### 6.4 Palette — where it lives, and why the boundary lint will not save you

The palette is **local to `tasks-ui`**:
`libs/frontend/tasks-ui/src/lib/components/palette/task-command-palette.component.ts`.
It reuses `KeyboardNavigationService` from `@ptah-extension/ui`
(`scope:webview` + `type:ui` — an allowed edge from `type:feature`) and a hand-rolled
subsequence matcher in `palette-match.ts`. **No new runtime dependency** (FR-C6.9).

`libs/frontend/editor/src/lib/quick-open/quick-open.component.ts` is prior art to _read_, not
to import. **Verified**: `tasks-ui` and `editor` are both `["scope:webview","type:feature"]`,
and `eslint.config.mjs` permits `type:feature → type:feature` and
`scope:webview → scope:webview`. `@nx/enforce-module-boundaries` would let
`tasks-ui → editor` through **silently**. Therefore ship an explicit ratchet:

```ts
// libs/frontend/tasks-ui/src/lib/no-editor-dependency.spec.ts
// R11 ratchet. The Nx boundary lint CANNOT catch this — tasks-ui and editor carry
// identical tags and type:feature → type:feature is an allowed edge. Verified against
// eslint.config.mjs and both project.json files.
it('never imports @ptah-extension/editor', () => {
  const offenders = walk('libs/frontend/tasks-ui/src').filter((f) => /@ptah-extension\/editor/.test(read(f)));
  expect(offenders).toEqual([]);
});
```

**Shortcut scoping (FR-C6.1, R10).** The keydown handler is bound to the
`TasksViewComponent` **host element**, never to `window` or `document`:

```ts
host: { '(keydown)': 'onKeyDown($event)' }
```

`onKeyDown` calls `preventDefault()` + `stopPropagation()` **only** when it consumed the
event, and it ignores every key while the target is an `<input>`, `<textarea>`, or
`[contenteditable]`. Trigger: `Ctrl/Cmd+K`, plus an always-visible toolbar button — the
button is the contract, the shortcut is the convenience. Because the handler is host-scoped,
nothing is captured while focus is anywhere else in the webview. **A manual three-host check
(VS Code, Electron, and the webview harness) is a named gate on Phase 6.**

**A11y (FR-C6.4–6.6).** `role="dialog"` + `aria-label`; the result list is `role="listbox"`
with `aria-activedescendant` tracking `KeyboardNavigationService.activeIndex`; the active
option is `scrollIntoView({ block: 'nearest' })`. `document.activeElement` is captured on
open and restored on close. Selection-scoped actions are **listed but disabled with a stated
reason** when the selection is empty, never hidden. Bulk actions launched from the palette
route through the same confirmation as the bulk bar (FR-C6.7 → FR-C4.12).

**No "run this task" entry** (§7, R12). `TaskStartService` is not imported by the palette.

### 6.5 Board keyboard navigation (FR-C7)

`TaskBoardComponent` becomes the roving-tabindex owner: one `focusedTaskId` signal fed down
to every card, which renders `[attr.tabindex]="focused() ? 0 : -1"` and
`[attr.data-task-id]`. The board's host keydown moves `focusedTaskId` across the **filtered**
column model and calls
`host.querySelector('[data-task-id="…"]')?.focus()`. **The board is one tab stop, not 181.**
`Space` toggles selection, `Enter` opens detail, `Escape` clears the selection if non-empty
and otherwise closes the detail panel. Every new control has a visible focus ring meeting
WCAG 2.1 AA contrast (NFR-12).

### 6.6 Untrusted text (NFR-4, NFR-13)

Label text, view names, executor values, and palette entry labels are rendered as
`{{ interpolation }}` only. They are never passed to `[innerHTML]`, never routed through
`ptah-markdown-block`, never interpolated into a path, a glob, a `RegExp`, or an RPC method
name. Free-text filtering is a case-insensitive `String.includes`, **not** a constructed
regex.

### 6.7 The zero-metadata workspace (§5.2)

Absent `labels` renders no chips and no "add label" nag; absent `estimate` renders no badge
and no "unestimated" pill; absent `parent` renders no breadcrumb; absent
`duplicates`/`relates_to` render no marker and no group. **A card with none of the five is
pixel-identical to today's card.** That row of §5.2 is the acceptance test, and it is a named
spec — see §8.

---

## 7. Implementation phases

Nine phases. Each is independently shippable and independently verifiable.
Sequencing honours **Q4: C1 + C6 before C4**.

### Phase 0 — the ratchet, then the nine coordinated sites (R1)

Extend `contract.guard.spec.ts` Duty 4 **first**, so an incomplete wiring is a red test rather
than a silent data loss. Then land all of §4.3's coordinated set as **one change**: shared
types, contract emitter, frontmatter parser + manual lift, migration `0031` + store, RPC
types, MCP schema, presentation maps.

_Gate_: `nx run-many -t test -p shared task-specs persistence-sqlite` green; the round-trip
matrix covers every new field × {absent, empty, single, many, quoted}; a carrier written with
no metadata is byte-identical to a pre-change carrier (golden-string assertion).

### Phase 1 — B read path, end to end (no write UI)

Card renders label chips, estimate badge, duplicate marker, parent breadcrumb, child rollup.
Detail panel renders the five relation groups from `TasksStore.graph()`.

_Gate_: hand-author a carrier with all five fields → every field renders. Delete them →
the card is pixel-identical to `main`. Zero writes issued during either render.

### Phase 2 — derived index + cross-file validation

`task-graph.ts` complete; scanner merges cross-file issues; doctor gains its four read-only
warning codes.

_Gate_: `task-graph.spec.ts` green over self-reference, 2-cycle, 3-cycle, 200-cycle,
diamond, dangling, and depth-3 fixtures — every case **terminates** and produces the
documented issue. In-memory and SQLite stores return identical graphs.

### Phase 3 — the single write path (FR-B5)

`updateFrontmatter` `remove` option; `applyFrontmatterPatch`; `updateMetadata`;
`updateStatus` delegates; `tasks:updateMetadata`; MCP `ptah_task_update` widened;
per-task client serialization; the metadata editor in the detail panel.

_Gate_: `task-writer.metadata.spec.ts` — body byte-identical (incl. BOM and CRLF); an
untouched key keeps its position; setting a field empty **removes** the key; a write to task
A leaves task B byte-identical; a mid-write external edit returns `TASK_CONFLICT` and writes
nothing. Two rapid same-task edits produce **zero** spurious conflicts.

### Phase 4 — C1 multi-axis filtering + C3 sorting

`task-filter.ts`; filter bar with removable chips; `23 of 181`; filtered-empty state;
`tasks:list` filter parity.

_Gate_: **parity test** — the same `TaskFilterSpec` over the same fixture returns an
identical id list from `filterTasks` client-side and from the `tasks:list` handler. A filter
change issues **0** RPC calls (spy assertion). Filter recompute over a 1 000-task fixture is
< 16 ms. Sorting is stable and tie-broken by id.

### Phase 5 — C2 saved views

`tasks-schema.ts`, `TasksSettings`, `SETTINGS_TOKENS.TASKS_SETTINGS`, three platform
registrations, the two `FILE_BASED_SETTINGS_KEYS` entries, `tasks:getViews`/`saveViews`, the
view menu.

_Gate_: create a view → delete `~/.ptah/ptah.db` → `tasks:reindex` → the view survives (R7).
A malformed entry is skipped, `skipped` is reported, and the remaining views load. An
unreadable settings file still renders the board. The 50-view cap produces a clear message.
`tasks.savedViews` is observed **in `~/.ptah/settings.json`** on VS Code (gate-1 proof).

### Phase 6 — C6 command palette + C7 board keyboard navigation

Palette local to `tasks-ui`; `palette-match.ts`; roving tabindex; the R11 ratchet.

_Gate_: `no-editor-dependency.spec.ts` green. Full keyboard operation with no mouse.
`role="dialog"` / `role="listbox"` / `aria-activedescendant` asserted. Prefix outranks
interior in the ranker. **Manual: the shortcut is verified on VS Code and Electron and
steals nothing from the host** (R10).

### Phase 7 — C4 bulk status (highest risk, lands last — Q4)

Selection model; `tasks:bulkUpdateStatus`; `deferNotify`; chunked client loop; progress +
cancel; per-item summary with on-disk status; pending cards.

_Gate_: interleaved-external-write integration test — one item returns `TASK_CONFLICT` with
`currentStatus` while the others succeed. Store test asserts **≤ 1** `tasks:board` call for a
50-task bulk. Failures stay selected, successes deselect. `> 10` requires confirmation naming
the count and the target status. The banned words appear nowhere in rendered text.

### Phase 8 — C5 bulk labels _(P2 — the designated cut)_

Same result contract; already-labelled tasks reported `noop`, unwritten, not failures.
**Drop this phase before Phase 7 if scope must be cut (FR-C5.3).**

---

## 8. Test strategy — §10 Definition of Done, line by line

| DoD checkbox                                                                                                                          | File                                                                                                            | Assertion that satisfies it                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every FR has a passing test at its level                                                                                              | the twelve files below plus the per-component specs in §1.8                                                     | —                                                                                                                                                                                                                                                                                                    |
| `contract.guard.spec.ts` round-trips every new field: absent, empty, single, many, quoted scalar                                      | `libs/backend/task-specs/src/lib/contract.guard.spec.ts`                                                        | `renderTaskMd` → `parseTaskFile` over the 48 status × type pairs **with** metadata; a `HOSTILE_LABELS` table (`needs:design`, `#urgent`, `2fa`, `-wip`, `no`, `trailing `, unicode); `expect(parsed.task.labels).toEqual(input)`; empty ⇒ key absent from the rendered text **and** `[]` after parse |
| A scanner test asserts nested `TASK_*/TASK_*/task.md` is **not** indexed                                                              | `libs/backend/task-specs/src/lib/task-scanner.service.spec.ts`                                                  | fixture with `TASK_A/TASK_B/task.md`; `expect(result.tasks.map(t=>t.id)).not.toContain('TASK_B')`; `TASK_A` is `excluded: 'no_carrier'` (R3)                                                                                                                                                         |
| A metadata write to one task leaves every other carrier byte-identical                                                                | `libs/backend/task-specs/src/lib/task-writer.metadata.spec.ts`                                                  | snapshot every carrier's bytes → `updateMetadata` on A → re-read all → deep-equal for every id ≠ A (R4)                                                                                                                                                                                              |
| Rendering the board writes nothing to disk                                                                                            | `libs/backend/task-specs/src/lib/task-writer.metadata.spec.ts` + `.../tasks-ui/.../tasks-store.service.spec.ts` | an `IFileSystemProvider` mock whose `writeFile` throws; a full `tasks:board` → render cycle completes (R4). _Note: `ensureStarted` may write `.ptah/specs/README.md` — the assertion excludes that one known, hash-guarded path and asserts **zero** writes under any `TASK\__` folder.\*            |
| Integration test interleaves an external carrier write mid-bulk and asserts per-item `TASK_CONFLICT` with the others still succeeding | `libs/backend/task-specs/src/lib/task-writer.conflict.integration.spec.ts`                                      | 5 ids; the fs mock mutates id #3's bytes between its read and its write; expect exactly one item `{ ok:false, code:'TASK_CONFLICT', currentStatus }` and four `{ ok:true }` (R2)                                                                                                                     |
| A store test asserts ≤ 1 board reload per bulk operation                                                                              | `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.spec.ts`                                           | RPC spy; 50-id bulk with `tasks:changed` pushes fired after every chunk; `expect(spy.calls('tasks:board').length).toBeLessThanOrEqual(1)` (R5)                                                                                                                                                       |
| Cycle fixtures for `parent` and each relation type terminate                                                                          | `libs/backend/task-specs/src/lib/task-graph.spec.ts`                                                            | self, 2-, 3-, 200-cycle for `parent`; mutual and self `relates_to`/`duplicates`/`depends_on`; each wrapped in a 2 s Jest timeout and asserted on its issue code (R8)                                                                                                                                 |
| Saved views survive a full index rebuild and a malformed-settings read                                                                | `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.spec.ts`                                         | save → `tasks:reindex` → `tasks:getViews` returns the same list; a store seeded with `[goodView, 42, {bad:1}]` returns 1 view and `skipped: 2`; an unreadable store returns `[]` and does not throw (R7)                                                                                             |
| The board renders identically to today for a workspace with no new field set                                                          | `libs/frontend/tasks-ui/src/lib/components/board/task-card.component.spec.ts`                                   | golden-DOM assertion against a `TaskSpecSummary` with `labels: []`, `duplicates: []`, `relatesTo: []`, no `estimate`, no `parent`: no chip, no badge, no rollup, no breadcrumb, no marker (§5.2 final row)                                                                                           |
| `ALLOWED_METHOD_PREFIXES` verified to cover every new RPC method **at runtime**                                                       | `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts` _(already exists)_                                    | its two existing `it` blocks iterate `RPC_HANDLER_MANIFEST` **and** `RPC_METHOD_NAMES` and fail with a message naming `rpc-handler.ts`. **No new test needed** — confirm it runs in the gate (F1)                                                                                                    |
| The NFR-14 gate command run with actual output reported, incl. the pre-existing `ptah-cli` `NO_COLOR` failure                         | §9                                                                                                              | —                                                                                                                                                                                                                                                                                                    |

Additional named specs beyond the DoD list:

| File                                                                             | Covers                                                                                               |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `libs/shared/src/lib/types/task-filter.spec.ts`                                  | per-facet semantics, AND-across / OR-within, labels ANY vs ALL, `unestimated`, stable sort           |
| `libs/backend/rpc-handlers/.../tasks-rpc.handlers.spec.ts` (filter parity block) | **FR-C1.5**: identical id list from `filterTasks` and from the `tasks:list` handler over one fixture |
| `libs/frontend/tasks-ui/src/lib/components/palette/palette-match.spec.ts`        | prefix outranks interior; subsequence match; empty query                                             |
| `libs/frontend/tasks-ui/src/lib/no-editor-dependency.spec.ts`                    | **R11** (F2)                                                                                         |
| `libs/backend/persistence-sqlite/.../0031_task_specs_metadata.spec.ts`           | migration applies onto a 0029 table; pre-existing rows take defaults                                 |
| `libs/backend/task-specs/src/lib/task-index.store.spec.ts`                       | five-column round trip through **both** store impls (NFR-11)                                         |

---

## 9. Verification gate

The NFR-14 command, verbatim — including `vscode-lm-tools` and `ptah-cli`, both of which this
task touches and both of which the TASK_2026_179 gate omitted:

```bash
npx nx run-many -t typecheck,test,lint -p shared task-specs rpc-handlers \
  tasks-ui vscode-core platform-core platform-vscode platform-electron \
  platform-cli skill-synthesis cli-engine vscode-lm-tools ptah-cli
```

**Recommended addition, not a substitution.** This task also modifies
`libs/backend/settings-core` (the saved-views definition + repository) and
`libs/backend/persistence-sqlite` (migration `0031`). Neither is in the NFR-14 list. Run the
command above **as specified** and record its output, then run the superset:

```bash
npx nx run-many -t typecheck,test,lint -p shared task-specs rpc-handlers \
  tasks-ui vscode-core platform-core platform-vscode platform-electron \
  platform-cli skill-synthesis cli-engine vscode-lm-tools ptah-cli \
  settings-core persistence-sqlite
```

**Known pre-existing failure — report, never "fix".** `apps/ptah-cli` carries a test
asserting coloured output "by default" that fails when `NO_COLOR` is set in the environment.
It is pre-existing and unrelated to this task. Report it explicitly as pre-existing in the
batch report; do not absorb it silently and do not repair it as drive-by scope (NFR-15).

Not part of the gate but required once, on Phase 6: a **manual** palette-shortcut check on VS
Code and on Electron (R10). No automated harness covers host keybinding capture.

---

## 10. Risk deltas (R1–R15)

| #                                                                            | Discharged by                                                                                                                                                                                                                                                                                                                                                                     | Status                              |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **R1** — a field lands at some of the nine sites, not all                    | Phase 0 lands all nine as one change, and extends `contract.guard.spec.ts` Duty 4 **first**. `TaskValidationIssue['code']` is keyed by a `Record` in `task-presentation.ts`, so a backend-only code fails the frontend typecheck. `renderTaskMd` and the parser's manual lift are both exercised by the same round-trip matrix.                                                   | **Closed**                          |
| **R2** — bulk amplifies writes; partial failure reads as success             | `TasksBulkResultItem[]` with no boolean anywhere (D5); `currentStatus` on conflict; failures stay selected; no auto-retry; a persistent (non-toast) summary; the three banned words asserted absent from rendered text; the interleaved-write integration test.                                                                                                                   | **Closed**                          |
| **R3** — sub-tasks as nested folders break scanner/allocator/doctor          | `parent:` pointer only; zero scanner, allocator, or doctor changes. The scanner test **freezes** the flat contract (it already holds — `task-scanner.service.ts:104` builds exactly one candidate path per folder).                                                                                                                                                               | **Closed**                          |
| **R4** — a "normalize the carriers" step backfills 180 gitignored files      | No backfill path exists to write: `adoptFolder` gains no fields, `renderTaskMd` omits empties, the doctor gains warnings but **no new `DoctorAction` kind** (so the `assertNever` at `tasks-rpc.handlers.ts:120` stays satisfied and no apply path can appear). Two tests: neighbour-byte-identity, and read-only render writes nothing under any `TASK_*`.                       | **Closed**                          |
| **R5** — one full rescan per task in a bulk                                  | Two fronts: `deferNotify` collapses N backend rebuilds into one per chunk, and the client's `tasks:changed` handler short-circuits while `_bulk() !== null` so pushes cannot re-enter `loadBoard`. Exactly one `loadBoard()` in the `finally`. Asserted at ≤ 1.                                                                                                                   | **Closed**                          |
| **R6** — whole-file byte comparison causes conflict fatigue                  | **Accepted, not eliminated** — the strictness is what makes the write safe. Paid down by an actionable message (on-disk status shown) and by per-task client serialization so the UI never conflicts with itself. **Remains open by design**: an external agent editing an unrelated key still refuses the write. That is correct behaviour under a gitignored tree with no undo. | **Accepted, open**                  |
| **R7** — views in SQLite, erased by a reindex                                | Views live in `~/.ptah/settings.json` via settings-core; the index is never consulted. Test: create → delete `ptah.db` → reindex → survives.                                                                                                                                                                                                                                      | **Closed**                          |
| **R8** — a cycle hangs a rollup or inverse computation                       | Inverses need **no traversal** at all (one pass, self-edges filtered). Parentage uses an iterative three-colour marking pass whose termination is proved by a per-node colour monotonicity argument (§4.1) rather than by a depth cap. Fixtures up to a 200-cycle.                                                                                                                | **Closed**                          |
| **R9** — labels fragment by case/whitespace                                  | `labelKey = trim().toLowerCase()` used for matching, for the union, **and** for the colour hash — so `Licensing` and `licensing ` are one label with one colour. Completions come from the derived union, making reuse the path of least resistance.                                                                                                                              | **Closed**                          |
| **R10** — palette hotkey collides with a host shortcut                       | Host-element `(keydown)` binding, never `window`/`document`; `preventDefault` only on consumption; ignored inside text inputs; a visible button is the primary affordance. **Manual three-host verification is a named Phase 6 gate** — no automated test can prove this.                                                                                                         | **Mitigated; manual gate**          |
| **R11** — a copied palette creates `tasks-ui → editor`                       | **Correction (F2): the stated mitigation does not work.** Both libs are `["scope:webview","type:feature"]` and `eslint.config.mjs` allows that edge, so `nx graph` / boundary lint would pass silently. Replaced with an explicit source ratchet, `no-editor-dependency.spec.ts`, which runs under `-p tasks-ui` in the NFR-14 gate.                                              | **Closed by a different mechanism** |
| **R12** — scope creep pulls family A in                                      | `TaskStartService` is not imported or modified anywhere in this plan; the palette entry catalogue in `palette-entries.ts` has no run action; §7's touchpoints are listed as read-only. A reviewer rejects any diff to `task-start.service.ts`.                                                                                                                                    | **Closed**                          |
| **R13** — a per-task filename literal or `TASK_2025_` fails the ratchet late | No new file names a per-task document. Every filename flows from `DOC_FILES`; `task-presentation.ts` keeps deriving `WORKFLOW_ARTIFACTS` from the contract. Fixtures use `TASK_2026_*` ids only. **Run `contract.guard.spec.ts` in Phase 0**, not at the end.                                                                                                                     | **Closed**                          |
| **R14** — the gate omits a touched project                                   | The NFR-14 command is used verbatim, and §9 adds `settings-core` + `persistence-sqlite` as a recommended superset because this task touches both and NFR-14's list predates that.                                                                                                                                                                                                 | **Closed, with an extension**       |
| **R15** — label chip colours fail contrast in one theme                      | Fixed, hand-audited palette in `task-presentation.ts` (both themes, ≥ 4.5:1); colour is never the sole carrier — every chip renders its text, and relation type, estimate, and validation state each carry an accessible name. Verification is a manual visual check on the palette constant, once.                                                                               | **Mitigated; manual gate**          |

---

## 11. Team-leader handoff

**Recommended developer**: **both** — `backend-developer` for Phases 0, 2, 3, 5 and the
backend half of 7; `frontend-developer` for Phases 1, 4, 6, 8 and the client half of 7.
Phases 0 and 3 are backend-only and must precede everything the frontend does.

**Complexity**: **HIGH**. Nine coordinated contract sites, a schema migration, a new settings
namespace across three platform registrations, five RPC methods, a derived graph with a
termination proof obligation, and the highest-risk item in the document (bulk writes against
a live agent) all in one task.

**Files affected**: 16 created, 30 modified, across 8 libs and 1 app — full inventory with
absolute paths in [§1](#1-component-and-file-inventory).

**Critical verification points for whoever executes this:**

1. **Do not edit `ALLOWED_METHOD_PREFIXES`.** `'tasks:'` is at
   `libs/backend/vscode-core/src/messaging/rpc-handler.ts:84`. `rpc-allowlist.spec.ts`
   proves coverage automatically (F1).
2. **Do not rely on the Nx boundary lint for R11.** It cannot catch `tasks-ui → editor`.
   Ship `no-editor-dependency.spec.ts` (F2).
3. **Do not express key removal as `patch.key = undefined`.** js-yaml cannot dump it. Use
   `updateFrontmatter`'s new `remove` option (F3).
4. **Do not give the saved-views setting a strict per-item Zod schema.**
   `BaseSettingsRepository.handleFor()` would discard every view on one bad entry (F4).
5. **`renderFrontmatterBlock` must not change.** Every new field is `string`, `boolean`, or
   `readonly string[]` precisely so it does not have to (NFR-3).
6. **Extend `contract.guard.spec.ts` before writing the parser**, not after (R1).
7. **`adoptFolder` and `registry-generator.service.ts` are not touched.** Adding metadata
   there is indistinguishable from a backfill (NFR-9, R4).
8. **`TaskStartService` is not touched, and the palette registers no run action** (§7, R12).

---

_No clarifications remain. Every open decision was settled at Checkpoint 1; the four
investigation findings (F1–F4) correct implementation mechanics, not approved decisions, and
each is resolved inside this document._
