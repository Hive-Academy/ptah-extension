# Requirements Document — TASK_2026_181

**Title**: Richer task metadata and a keyboard-first views/filter layer for the Tasks board
**Type**: FEATURE
**Depends on**: TASK_2026_179 (contract module, `TASK_CONFLICT` write path, `createDirectoryExclusive`), commits `b7b24500f`, `f80fa299c`
**Scope**: families **B** and **C** only. Families **A** and **D** are out of scope — see [§7](#7-explicitly-out-of-scope).

---

## Introduction

The Tasks board (`libs/frontend/tasks-ui`) today renders a six-column Kanban over
`.ptah/specs/`. A card shows exactly seven things: `id`, a validity warning,
`status`, `title`, `type`, `executor`, and a _count_ of `depends_on`. There is no
search, no filter, no multi-select, no keyboard navigation beyond Enter/Space on a
card, and no way to express that one task duplicates another or is a piece of a
larger one. At ~180 task folders in this workspace, the board is already a wall
that must be read linearly.

TASK_2026_179 made two things safe that were not safe before, and they are the
precondition for this work:

- `updateStatus` performs a pre-write re-read and returns a typed `TASK_CONFLICT`
  instead of clobbering. Without it, a bulk status operation would multiply the
  original data-loss bug by the size of the selection.
- `createDirectoryExclusive` is a real compare-and-swap, closing the id-allocation
  race.

This task adds (B) file-native metadata — labels, an estimate, sub-task
parentage, and typed relations layered on the existing `depends_on` — and (C) the
retrieval layer that makes that metadata worth having: multi-axis filtering,
saved views, bulk status operations, and a keyboard-first command palette.

Everything stays file-native. No server, no new per-task document, no new
carrier. The value proposition is that a user can answer "what is blocked on me,
sized M or larger, labelled `licensing`, and not yet in review?" in one keystroke,
and act on the answer without leaving the keyboard.

### Design constraint that shaped the whole data model

The carrier's YAML emitter (`renderFrontmatterBlock`,
`libs/shared/src/lib/types/task-spec.contract.ts:222`) handles exactly three value
shapes: `string`, `boolean`, and `readonly string[]`. **Every field this document
introduces is one of those three.** Typed relations are therefore expressed as
arrays of task ids on a single authored side, with the inverse derived by the
index — not as arrays of objects. This is not a convenience; it means the emitter,
the round-trip ratchet in `contract.guard.spec.ts`, and every hand-editing human
keep working unchanged.

---

## 1. Functional Requirements — Family B: Richer task metadata

### FR-B1: Labels

**User Story:** As a developer using the Tasks board, I want to attach free-form
labels to a task, so that I can group work by an axis the fixed `type` enum does
not capture (`licensing`, `flaky-test`, `needs-design`).

**Data landing**: carrier frontmatter `labels: string[]`. Derived into the index.
See [§4](#4-data-model-impact).

#### Acceptance Criteria

1. WHEN a task's carrier frontmatter contains `labels: ["licensing", "paddle"]`
   THEN the board card SHALL render one chip per label, in the authored order.
2. WHEN a user adds a label through the UI THEN the system SHALL write only the
   `labels` key of that task's frontmatter and SHALL leave every other
   frontmatter key and the entire markdown body byte-identical.
3. WHEN a carrier has no `labels` key THEN the card SHALL render no label chips
   and no placeholder, and the task's `labels` SHALL be observable as `[]`.
4. WHEN a user adds a label whose text differs from an existing label only by
   case or by surrounding whitespace THEN the system SHALL match it to the
   existing label and SHALL NOT create a second one.
5. WHEN a user types into the label input THEN the system SHALL offer completions
   drawn from the union of all labels across every indexed task in the current
   workspace. There SHALL be no separate label-registry file.
6. WHEN a label is removed from the last task carrying it THEN it SHALL disappear
   from the completion list on the next index rebuild, with no cleanup step.
7. WHEN a label string contains a newline, or exceeds 32 characters, or the task
   already carries 12 labels THEN the system SHALL reject the addition with a
   visible, specific message and SHALL NOT write the file.
8. WHEN a label contains a character the YAML emitter cannot write as a plain
   scalar (`:`, `#`, a leading digit, a leading `-`) THEN the written carrier
   SHALL still round-trip: `renderTaskMd` → `parseTaskFile` SHALL return the
   identical label string.
9. WHEN the same label appears on two tasks THEN its chip SHALL have the same
   colour on both, derived deterministically from the label text. No colour
   assignment SHALL be persisted anywhere.

### FR-B2: Estimate

**User Story:** As a person planning a week of work, I want a coarse size on each
task, so that I can filter out the large items when I have an afternoon.

**Data landing**: carrier frontmatter `estimate: string` (enum-valued). Derived
into the index.

#### Acceptance Criteria

1. The estimate SHALL be a closed, ordered enum — **`XS`, `S`, `M`, `L`, `XL`** —
   exported from `libs/shared` alongside `TASK_STATUSES` and `TASK_TYPES`. It
   SHALL NOT be free-form text and SHALL NOT be a duration in hours or days.
   _Rationale in [§8, D4](#d4-estimate-is-an-enum-not-a-duration)._
2. WHEN a carrier declares `estimate: M` THEN the card SHALL render an estimate
   badge reading `M`, visually distinct from the type badge and the status badge.
3. WHEN a carrier has no `estimate` key THEN the card SHALL render no estimate
   badge and no "unestimated" placeholder chip. Unestimated SHALL be reachable as
   an explicit filter value, not as visual noise on every legacy card.
4. WHEN a carrier declares an `estimate` outside the enum THEN the task SHALL
   remain **included** in the board with a `invalid_estimate` validation issue
   attached, consistent with the existing warning-not-exclusion policy for
   `type`. It SHALL NOT be silently coerced or dropped.
5. WHEN the board aggregates estimates for a column or a filtered set THEN it
   SHALL report a **count per bucket** (e.g. `2 XS · 5 M · 1 XL · 3 unestimated`).
   It SHALL NOT sum, average, or convert the enum to a number.

### FR-B3: Sub-tasks via a frontmatter parent pointer

**User Story:** As someone breaking down a large feature, I want to mark a task as
a child of another, so that the board can roll a group up without me maintaining
a separate list.

**Data landing**: carrier frontmatter `parent: string` (a task id). Children are
**derived**, never authored.

#### Acceptance Criteria

1. A sub-task SHALL be an ordinary sibling folder `.ptah/specs/TASK_YYYY_NNN/`
   with a `parent:` key in its carrier frontmatter. The `.ptah/specs/` tree SHALL
   remain exactly one level deep. **No nested task folders.**
   _Rationale in [§8, D1](#d1-sub-tasks-use-a-parent-pointer-not-nested-folders)._
2. WHEN task `TASK_2026_200` declares `parent: TASK_2026_181` THEN
   `TASK_2026_181` SHALL expose `TASK_2026_200` as a child **without any write to
   `TASK_2026_181`'s carrier**. The parent's file SHALL NOT be modified when a
   child is created, re-parented, or deleted.
3. WHEN a task has children THEN its card SHALL show a child rollup — completed
   children over total children — and the rollup SHALL be clickable to filter the
   board to that parent's children.
4. WHEN a task declares a `parent` THEN its card SHALL show the parent id as a
   navigable affordance, and clicking it SHALL open the parent's detail panel.
5. Parentage SHALL be limited to **one level**: a task that declares a `parent`
   SHALL NOT itself be a valid parent. WHEN a two-level chain is detected THEN
   both tasks SHALL remain included, and the child SHALL carry a
   `parent_depth_exceeded` validation issue.
6. WHEN a `parent` names a folder that does not exist THEN the task SHALL remain
   included with a `dangling_parent` validation issue, mirroring the existing
   `dangling_depends_on` treatment.
7. WHEN a `parent` names the task itself, or a cycle is formed THEN the task SHALL
   remain included with a `parent_cycle` validation issue and SHALL be treated as
   parentless for rollup purposes. The rollup computation SHALL terminate.
8. WHEN a parent is moved to `done` while it has children not in `done` or
   `cancelled` THEN the system SHALL warn but SHALL NOT block the transition.
9. The id allocator SHALL be unaffected: allocating an id after a sub-task exists
   SHALL still be a single-level scan of `.ptah/specs/TASK_*` and SHALL produce
   the same result it would have produced without sub-tasks.

### FR-B4: Typed relations layered on `depends_on`

**User Story:** As someone triaging a backlog, I want to record that a task
duplicates another or merely relates to it, so that I do not re-litigate the same
work and can see what a change will ripple into.

**Data landing**: carrier frontmatter. `depends_on` is unchanged. Two new authored
arrays; two derived inverses.

| Relation   | Authored on        | Field                               | Inverse shown as | Inverse source                   |
| ---------- | ------------------ | ----------------------------------- | ---------------- | -------------------------------- |
| blocked-by | the dependent task | `depends_on: string[]` _(existing)_ | —                | —                                |
| blocks     | _not authored_     | —                                   | "Blocks"         | derived: inverse of `depends_on` |
| duplicates | the duplicate      | `duplicates: string[]` _(new)_      | "Duplicated by"  | derived inverse                  |
| relates-to | either side        | `relates_to: string[]` _(new)_      | "Related"        | derived, symmetric union         |

#### Acceptance Criteria

1. `depends_on` SHALL keep its exact current name, shape (`string[]`), and
   meaning. It SHALL NOT be repurposed, renamed, wrapped, or migrated. Existing
   `dangling_depends_on` validation SHALL continue to behave identically.
2. There SHALL be **no `blocks:` frontmatter key**. WHEN task A declares
   `depends_on: [B]` THEN B's detail panel SHALL show A under "Blocks", computed
   by the index from A's carrier alone.
3. WHEN a user adds a "blocks" edge from B to A through the UI THEN the system
   SHALL write `depends_on` on **A only**. Exactly one carrier SHALL be modified
   per relation edit, in every direction, for every relation type.
   _Rationale in [§8, D3](#d3-one-authored-side-per-edge)._
4. WHEN task A declares `duplicates: [B]` THEN A's card SHALL carry a visually
   de-emphasised duplicate marker, and B's detail panel SHALL list A under
   "Duplicated by".
5. WHEN task A declares `relates_to: [B]` THEN both A and B SHALL show the other
   under "Related", even though only A's carrier names the relation.
6. WHEN a relation names a task id that does not exist THEN the holding task SHALL
   remain included with a `dangling_relation` validation issue naming the field
   and the missing id.
7. WHEN a relation names the holding task itself THEN it SHALL be reported as
   `dangling_relation` and ignored for display.
8. WHEN the same id appears twice in one relation array THEN it SHALL be
   de-duplicated for display, and the duplicate SHALL NOT be silently rewritten
   out of the file.
9. The detail panel SHALL group relations under distinct headings — Blocked by,
   Blocks, Duplicates, Duplicated by, Related — and SHALL visually distinguish an
   **authored** edge (removable from this task) from a **derived** edge
   (removable only from the other task). Attempting to remove a derived edge from
   the wrong side SHALL either navigate to the authoring task or be disabled with
   an explanation — never silently no-op.

### FR-B5: A single write path for metadata

**User Story:** As a maintainer, I want exactly one validated, conflict-checked
route that mutates task metadata, so that no surface acquires a raw `Write` to a
carrier.

#### Acceptance Criteria

1. All metadata mutation (labels, estimate, parent, duplicates, relates_to,
   depends_on) SHALL go through **one** writer method with the same pre-write
   re-read and `TASK_CONFLICT` semantics that `updateStatus` already has. There
   SHALL be no second write path and no raw `Write` to a carrier from any
   surface.
2. WHEN the carrier's bytes changed between read and write THEN the write SHALL
   be refused with `TASK_CONFLICT` and nothing SHALL be written.
3. The metadata write SHALL be **body-preserving**: the markdown body below the
   frontmatter SHALL be byte-identical after the write, including a leading BOM
   if present.
4. The write SHALL NOT add, remove, or reorder any frontmatter key it was not
   asked to change, except `updated`, which SHALL be refreshed.
5. WHEN a metadata field is set to its empty value (`labels: []`,
   `relates_to: []`, estimate cleared) THEN the key SHALL be **removed** from the
   frontmatter rather than written as an empty value, so a task returns to its
   pre-metadata shape.
6. The RPC surface SHALL extend the existing `tasks:` namespace, which is already
   present in `ALLOWED_METHOD_PREFIXES` — only the compile-time half of the
   dual-registration is new. See NFR-6.
7. The MCP `tasks` namespace SHALL expose the new metadata on
   `ptah_task_create`, `ptah_task_update`, `ptah_task_get`, and
   `ptah_task_list`, so an agent has a callable validated path and never needs a
   raw carrier write. There SHALL still be **no** prose-writing MCP tool.
8. Two concurrent in-flight writes to the **same** task SHALL be serialized by
   the client. WHEN a user changes a label and a status in quick succession THEN
   the second SHALL not be issued from a stale snapshot and SHALL not produce a
   spurious `TASK_CONFLICT`.

---

## 2. Functional Requirements — Family C: Views, filters, palette

### FR-C1: Multi-axis filtering

**User Story:** As someone with 180 task folders, I want to narrow the board on
several axes at once, so that the wall becomes a shortlist.

#### Acceptance Criteria

1. The board SHALL support simultaneous filtering on these axes, combined with
   AND across axes:
   - `status` (multi-select)
   - `type` (multi-select)
   - `labels` (multi-select, with a user-selectable **ANY** / **ALL** mode)
   - `estimate` (multi-select, including an explicit _unestimated_ value)
   - `executor` (multi-select, values derived from the index)
   - parentage: _is a parent_ / _is a sub-task_ / _standalone_
   - relations: _has unmet dependencies_ / _is a duplicate_
   - validity: _has validation issues_
   - free text over `id`, `title`, and `description`
2. WHEN a filter is active THEN every column SHALL show its filtered count and
   the header SHALL show total matched over total indexed (`23 of 181`).
3. WHEN a filter matches nothing THEN the board SHALL show a filtered-empty state
   naming the active facets, distinct from the existing no-tasks-at-all empty
   state.
4. Changing a filter SHALL NOT issue any RPC call and SHALL NOT trigger a board
   reload or a re-index. Filtering SHALL operate on the already-loaded board
   payload.
5. The filter predicate SHALL be defined **once**, in `libs/shared`, and consumed
   by both the client-side board filter and the server-side `tasks:list` /
   `ptah_task_list` filters. A given filter spec SHALL produce an identical
   result set from either side. A divergence SHALL be a test failure, not a
   behavioural difference.
6. Clearing all filters SHALL be a single action and SHALL be reachable from both
   the filter UI and the command palette.
7. WHEN a filter is active and the board reloads (watcher push, workspace focus,
   manual refresh) THEN the filter SHALL survive the reload.
8. The active filter SHALL be summarised as removable chips, one per active
   facet value, each individually removable.

### FR-C2: Saved views

**User Story:** As a returning user, I want to name and recall a filter
combination, so that "my blocked work" is one click and not six.

**Data landing**: `~/.ptah/settings.json` via settings-core, under a `tasks.*`
namespace. **Not** in a task folder, **not** in the SQLite index.
_Rationale in [§8, D2](#d2-saved-views-live-in-settings)._

#### Acceptance Criteria

1. A saved view SHALL consist of a stable id, a user-supplied name, the full
   filter spec, and a sort order. It SHALL NOT contain task data, task ids, or
   any snapshot of results.
2. Saved views SHALL persist across a webview reload, an extension host restart,
   and an index rebuild. Deleting `~/.ptah/ptah.db` SHALL NOT lose them.
3. Saved views SHALL be validated with a Zod schema on read. WHEN a stored view
   fails validation THEN it SHALL be skipped with a logged warning and the
   remaining views SHALL still load. A malformed view SHALL NOT prevent the board
   from rendering.
4. WHEN a saved view references a label or an executor that no longer exists in
   the workspace THEN the view SHALL still apply, SHALL match nothing on that
   facet, and SHALL surface a "no longer present in this workspace" note on that
   chip. It SHALL NOT be auto-pruned.
5. Users SHALL be able to create, rename, update-from-current-filter, delete, and
   reorder views. Deleting SHALL require a confirmation.
6. The currently active view SHALL persist across a reload, and switching to a
   view SHALL replace the entire active filter, not merge with it.
7. WHEN the user modifies a filter while a view is active THEN the view SHALL be
   marked as modified and SHALL offer both _save to view_ and _revert_. The view
   SHALL NOT be silently overwritten.
8. The number of saved views SHALL be capped (recommended 50) with a clear
   message at the cap.
9. Saved views SHALL be per-user, on the local machine. This work SHALL NOT
   introduce a workspace-committed views file. _See [§9, Q3](#9-clarifications-needed)._

### FR-C3: Sorting

#### Acceptance Criteria

1. Within a column, cards SHALL be sortable by `updated`, `created`, `estimate`
   (enum order), `title`, and `id`, ascending or descending.
2. The sort SHALL be part of the saved-view payload (FR-C2.1).
3. Sorting SHALL be stable: two cards with an equal sort key SHALL keep a
   deterministic relative order across re-renders, tie-broken by `id`.

### FR-C4: Bulk status operations, and partial failure as the normal case

**User Story:** As someone closing out a milestone, I want to move a selection of
tasks to `done` in one action, so that I do not click twelve dropdowns.

**This is the highest-risk requirement in the document.** There is no transaction
across N files. Each task is an independent read → compare → write. A bulk
operation over N tasks is N independent chances to hit `TASK_CONFLICT`, an
unreadable file, or a permission error. **All-or-nothing is not achievable and
SHALL NOT be presented.**

#### Acceptance Criteria

1. The board SHALL support multi-select of cards via checkbox, shift-click range,
   ctrl/cmd-click toggle, and a select-all-matching action that respects the
   active filter. The selection count SHALL always be visible while non-empty.
2. Multi-select SHALL be distinct from the existing single-select-opens-detail
   behaviour. Entering multi-select SHALL NOT open the detail panel, and clearing
   the selection SHALL NOT close a detail panel the user opened deliberately.
3. WHEN a bulk status change is applied to N tasks THEN the system SHALL produce
   **exactly one result entry per task**, each carrying that task's id and either
   success or a typed error code (`TASK_CONFLICT`, `TASK_NOT_FOUND`,
   `TASK_EXCLUDED`, `WRITE_FAILED`).
4. The UI SHALL NOT describe a bulk operation as atomic, transactional, or
   all-or-nothing, in any label, tooltip, or message.
5. WHEN a bulk operation completes with any failures THEN the UI SHALL show a
   persistent summary — _"9 of 12 updated. 3 failed."_ — listing each failed task
   by id with its reason in plain language. The summary SHALL remain until
   dismissed and SHALL NOT be a transient toast.
6. WHEN a bulk operation partially fails THEN the **succeeded** tasks SHALL be
   deselected and the **failed** tasks SHALL remain selected, so that retrying is
   a single action scoped to exactly what failed.
7. WHEN a task fails with `TASK_CONFLICT` THEN the summary SHALL show that task's
   **current on-disk status** next to the status the user attempted, so the user
   can see what the other writer did before deciding.
8. The system SHALL NOT silently auto-retry a `TASK_CONFLICT`. Retry SHALL be an
   explicit user action.
9. A bulk operation SHALL show live progress (`7 / 12`) and SHALL be cancellable.
   WHEN cancelled THEN no further writes SHALL be issued, already-completed
   writes SHALL NOT be reversed, and the UI SHALL state exactly that.
10. A bulk operation over N tasks SHALL trigger **at most one** board reload, at
    the end. It SHALL NOT reload the board once per task. _(Today
    `TasksStore.updateStatus` calls `loadBoard()` on every success — N bulk
    operations would be N full rescans of ~180 folders.)_
11. WHEN a bulk operation is in flight THEN the affected cards SHALL be visibly
    pending and SHALL NOT accept a second mutation.
12. There SHALL be a selection size above which the operation requires explicit
    confirmation naming the count and the target status (recommended > 10).
13. `cancelled` and `done` SHALL be reachable through bulk operations, and
    reaching them SHALL require the same confirmation as any other target — there
    SHALL be no special "destructive" path, because none of these operations
    deletes anything.

### FR-C5: Bulk label add/remove _(SHOULD — P2)_

#### Acceptance Criteria

1. Adding or removing a label across a selection SHALL follow **the identical
   partial-failure contract as FR-C4** — per-item results, failed items stay
   selected, one board reload, no atomicity claim.
2. WHEN a label is added to a selection where some tasks already carry it THEN
   those tasks SHALL be reported as no-ops, SHALL NOT be written, and SHALL NOT
   count as failures.
3. This requirement SHALL be dropped before FR-C4 if scope must be cut.

### FR-C6: Command palette

**User Story:** As a keyboard-first user, I want one entry point to every board
action, so that I never reach for the mouse.

#### Acceptance Criteria

1. A palette SHALL open from a keyboard shortcut while the Tasks view has focus,
   and from a visible button. The shortcut SHALL be scoped to the Tasks view and
   SHALL NOT capture keys globally across the webview or steal a shortcut owned
   by the host editor.
2. The palette SHALL expose, at minimum: jump to a task by id or title; apply a
   saved view; set status on the current selection; add/remove a label on the
   current selection; create a task; clear all filters; toggle any single filter
   facet; open the exclusions drawer; reindex.
3. Palette entries SHALL be filtered by a subsequence match over the entry label,
   ranked so that a prefix match outranks an interior match.
4. The palette SHALL be fully operable from the keyboard: type to filter, Up/Down
   to move, Enter to run, Escape to close. Focus SHALL move into the input on
   open and SHALL return to the previously focused element on close.
5. The palette SHALL be a `role="dialog"` with an accessible name; the result
   list SHALL be a `role="listbox"` with correct `aria-activedescendant`, and the
   active option SHALL be scrolled into view.
6. Actions that operate on a selection SHALL be listed but **disabled with a
   stated reason** when the selection is empty, rather than hidden.
7. Running a destructive-looking or bulk action from the palette SHALL honour the
   same confirmation rules as the equivalent UI action (FR-C4.12).
8. The palette SHALL NOT create a dependency from `tasks-ui` to
   `libs/frontend/editor`. It SHALL either be local to `tasks-ui` or promoted
   into `libs/frontend/ui`. _(Prior art:
   `libs/frontend/editor/src/lib/quick-open/quick-open.component.ts`; existing
   primitive: `KeyboardNavigationService` in
   `libs/frontend/ui/src/lib/native/shared/keyboard-navigation.service.ts`.)_
9. The palette SHALL NOT introduce a new runtime dependency. No fuzzy-search
   library.

### FR-C7: Board keyboard navigation

#### Acceptance Criteria

1. Arrow keys SHALL move focus between cards within a column and between
   columns, using a roving tabindex — the board SHALL be a single tab stop, not
   181 of them.
2. Space SHALL toggle selection on the focused card; Enter SHALL open its detail.
3. Escape SHALL clear the selection when a selection exists, otherwise close the
   detail panel.
4. All interactive additions SHALL be reachable and operable by keyboard alone,
   with a visible focus indicator meeting WCAG 2.1 AA contrast.

---

## 3. Non-Functional Requirements

Constraints marked **[inherited]** are carried verbatim from
`TASK_2026_179/context.md` and this task's `context.md`. They are not
negotiable and are restated here because they bind this work directly.

### NFR-1 — Carrier ownership **[inherited]**

`task.md` is the machine-owned metadata carrier. `context.md` and its siblings are
agent-owned prose. **No machine rewrites prose.** There is deliberately no
`ptah_task_set_section` MCP tool. Every field introduced by this task — labels,
estimate, parent, duplicates, relates_to — belongs in carrier **frontmatter**,
never in a prose body. Any proposal that parses metadata out of, or writes
metadata into, `context.md` or any other prose document is out of contract.

### NFR-2 — No new per-task document; the `DOC_FILES` ratchet **[inherited]**

`DOC_FILES` in `libs/shared/src/lib/types/task-spec.contract.ts` is a closed set,
and `contract.guard.spec.ts` is a live CI ratchet. This task SHALL NOT widen
`DOC_FILES` and SHALL NOT introduce any new per-task `*.md`. Implementers SHALL
NOT write a per-task filename string literal outside the allowlist into any `.ts`
file or skill asset, and SHALL NOT introduce the dead identifiers
`task-tracking/`, `.ptah/tasks/`, or a hardcoded `TASK_2025_` prefix — including
in code comments and test fixtures. The ratchet's round-trip assertion
(`renderTaskMd` → `parseTaskFile` over every status × type pair) SHALL be extended
to cover every new field, including absent, empty, and quoted-scalar cases.

### NFR-3 — Carrier YAML shape

Every new frontmatter field SHALL be `string`, `boolean`, or `readonly string[]`,
so that `renderFrontmatterBlock` requires **no** change. No nested objects, no
arrays of objects, no maps in carrier frontmatter. The carrier SHALL remain
readable and hand-editable by a human with a plain text editor and no tooling.

### NFR-4 — Angular **[inherited]**

Angular 21: signals, `computed()`, `inject()`.
`ChangeDetectionStrategy.OnPush` mandatory on every new and modified component.
No `[innerHTML]` — AI/user markdown routes through `libs/frontend/markdown`
(`ptah-markdown-block`), the single DOMPurify chokepoint. Label text, view names,
and palette entry labels are user-supplied and SHALL be rendered as text
interpolation, never as HTML.

### NFR-5 — Type safety and validation **[inherited]**

TypeScript 5.9 strict. `catch (error: unknown)`, narrowed with `instanceof Error`
before `.message`. Zod 4 at every external boundary: the RPC params, the MCP tool
args, the carrier frontmatter read, and the saved-views settings read. No
`@ts-ignore` without `@ts-expect-error` and a reason.

### NFR-6 — RPC dual-registration **[inherited]**

A new RPC namespace requires **both** `libs/shared/.../rpc.types.ts` and
`ALLOWED_METHOD_PREFIXES` at
`libs/backend/vscode-core/src/messaging/rpc-handler.ts:84`. `tasks:` is already
present, so new methods under that prefix need only the compile-time half plus
the handler's `METHODS` tuple. **This SHALL be verified, not assumed** — the
missing runtime half is a silent runtime crash, not a compile error.

### NFR-7 — Library boundaries **[inherited]**

Frontend libs MUST NOT import backend libs, and vice versa. `libs/shared` is the
only bridge — this is precisely why the contract module lives there and why
`tasks-ui` consumes it. The shared filter predicate (FR-C1.5) SHALL live in
`libs/shared` for the same reason. Backend code SHALL depend on `platform-core`
ports, never on a concrete adapter. `tasks-ui` SHALL NOT gain a dependency on
`libs/frontend/editor` (FR-C6.8).

### NFR-8 — No VCS undo under `.ptah/**` **[inherited]**

`.ptah/**` is gitignored. There is no git undo for anything under it. Any new
mutation path SHALL receive the same journalled, fail-closed treatment as
`task-doctor.service.ts`, or SHALL be provably non-destructive (frontmatter-key
patch with a body-preserving splice and a pre-write byte comparison). Bulk
operations SHALL be treated as a mutation path for this purpose.

### NFR-9 — No automatic mutation of existing task files **[inherited]**

See [§5](#5-migration-and-compatibility). No backfill, ever, under any trigger.

### NFR-10 — Performance

| Measure                                            | Budget                       |
| -------------------------------------------------- | ---------------------------- |
| Filter recompute on keystroke, 1 000 indexed tasks | < 16 ms; no dropped frame    |
| Palette open to first paint                        | < 100 ms                     |
| Board reloads caused by a filter or sort change    | **0**                        |
| Board reloads per bulk operation of any size       | **≤ 1**                      |
| Single metadata write, round trip                  | < 250 ms p95 on a warm index |
| Board initial render, 1 000 tasks                  | < 500 ms                     |
| Index rebuild regression vs. today's baseline      | ≤ 10 %                       |

Filtering SHALL be computed from the already-loaded board payload with `computed()`
signals. Label completion lists SHALL be derived, memoized, and not recomputed per
keystroke.

### NFR-11 — Reliability

- A malformed value in any new frontmatter field SHALL produce a **validation
  issue**, never an exclusion. The existing warning-not-exclusion policy is
  extended, not altered. A task with a broken `parent` is still a task.
- Every new derived computation — child rollup, inverse relations, label union —
  SHALL terminate on cyclic input. Cycle detection SHALL be tested explicitly.
- The SQLite index is **derived and rebuildable** and falls back to
  `InMemoryTaskIndexStore` when better-sqlite3 fails. No feature in this task
  SHALL be gated on SQLite being available, and the in-memory store SHALL produce
  identical filter and rollup results.
- WHEN the settings file holding saved views is unreadable or malformed THEN the
  board SHALL render with no saved views and a logged warning. It SHALL NOT fail
  to load.

### NFR-12 — Accessibility

WCAG 2.1 AA. Label chip colours SHALL meet 4.5:1 text contrast in both the light
and dark VS Code themes, and colour SHALL NOT be the sole carrier of any meaning
— every chip carries its text. Relation type, estimate, and validation state
SHALL each be conveyed by text or an accessible name, not by colour or icon
alone.

### NFR-13 — Security

Labels, view names, and free-text filters are untrusted input from a file on disk
that an agent may have written. They SHALL be treated as such: rendered as text,
length-capped, newline-rejected, and never interpolated into a path, a glob, a
regex, or an RPC method name. A task id used in a relation SHALL be validated as
a single path segment before any file access, matching the existing guard in the
MCP tasks namespace builder.

### NFR-14 — Verification gate

The gate SHALL include the TASK_2026_179 project list **plus `vscode-lm-tools`
and `ptah-cli`**, both of which this task touches and both of which the previous
gate omitted — an omission that let a broken mock in `vscode-lm-tools` ship.

```
npx nx run-many -t typecheck,test,lint -p shared task-specs rpc-handlers \
  tasks-ui vscode-core platform-core platform-vscode platform-electron \
  platform-cli skill-synthesis cli-engine vscode-lm-tools ptah-cli
```

Known pre-existing failure: `apps/ptah-cli` has a test asserting coloured output
"by default" that fails when `NO_COLOR` is set in the environment. This is
pre-existing and SHALL be reported, not silently absorbed and not "fixed" as
drive-by scope.

### NFR-15 — Concurrent-agent checkout

Other agents run against this same checkout. Implementation batches SHALL NOT
modify unstaged work outside this task's scope, SHALL stop and report on an
out-of-scope failure rather than repairing a neighbour's WIP, and SHALL NEVER
bypass hooks with `--no-verify`.

---

## 4. Data-model impact

This is the highest-risk section. **The carrier is machine-owned; prose files are
agent-owned. No new metadata may go into a prose file.**

### 4.1 Where every new field lands

| Field                     | Shape                             | Carrier frontmatter        | SQLite derived index                   | Client-only                                | Settings                   |
| ------------------------- | --------------------------------- | -------------------------- | -------------------------------------- | ------------------------------------------ | -------------------------- |
| `labels`                  | `string[]`                        | ✅ **authored**            | ✅ JSON-in-TEXT column                 | —                                          | —                          |
| `estimate`                | `string` (enum `XS\|S\|M\|L\|XL`) | ✅ **authored**            | ✅ scalar TEXT column                  | —                                          | —                          |
| `parent`                  | `string` (task id)                | ✅ **authored**            | ✅ scalar TEXT column, indexed         | —                                          | —                          |
| `duplicates`              | `string[]`                        | ✅ **authored**            | ✅ JSON-in-TEXT column                 | —                                          | —                          |
| `relates_to`              | `string[]`                        | ✅ **authored**            | ✅ JSON-in-TEXT column                 | —                                          | —                          |
| `depends_on`              | `string[]`                        | ✅ **existing, unchanged** | ✅ existing column                     | —                                          | —                          |
| children of a task        | `string[]`                        | ❌ **never authored**      | ⚠️ derived at query time from `parent` | —                                          | —                          |
| `blocks` (inverse)        | `string[]`                        | ❌ **never authored**      | ⚠️ derived from `depends_on`           | —                                          | —                          |
| `duplicated_by` (inverse) | `string[]`                        | ❌ **never authored**      | ⚠️ derived from `duplicates`           | —                                          | —                          |
| related (symmetric)       | `string[]`                        | ❌                         | ⚠️ derived union of `relates_to`       | —                                          | —                          |
| child rollup counts       | numbers                           | ❌                         | ⚠️ derived                             | ✅ may be computed client-side             | —                          |
| known-label union         | `string[]`                        | ❌                         | ⚠️ derived                             | ✅ memoized client-side                    | —                          |
| label → colour            | —                                 | ❌                         | ❌                                     | ✅ deterministic from text, **not stored** | ❌                         |
| saved views               | objects                           | ❌ **forbidden**           | ❌ **forbidden**                       | —                                          | ✅ `~/.ptah/settings.json` |
| active view id            | `string`                          | ❌                         | ❌                                     | —                                          | ✅ settings                |
| active ad-hoc filter      | object                            | ❌                         | ❌                                     | ✅ session signal                          | —                          |
| multi-selection           | `string[]`                        | ❌                         | ❌                                     | ✅ session signal                          | —                          |
| palette open state, focus | —                                 | ❌                         | ❌                                     | ✅ session signal                          | —                          |
| column collapse, sort     | —                                 | ❌                         | ❌                                     | —                                          | ✅ part of the saved view  |

**Legend**: ✅ authored/stored here · ⚠️ derived, never written · ❌ must not land here.

### 4.2 Rules the table encodes

1. **Authored on exactly one side.** Every relation edge and every parent link is
   written into exactly one carrier. No edge is mirrored into a second file. This
   halves the write surface and makes every relation edit a single-file,
   single-conflict operation. It is the reason FR-B4 has no `blocks:` key.
2. **Derived data is never written back.** Children, inverses, rollups, and the
   label union are computed. If the index is deleted, they are recomputed
   identically. Nothing is lost.
3. **The index is derived and rebuildable, never authoritative.** Every change
   path already funnels into a full `scan` → `replaceWorkspace` (DELETE +
   re-INSERT in one transaction), and the store degrades to
   `InMemoryTaskIndexStore` when better-sqlite3 fails. Therefore: **nothing may
   be stored only in the index**, and no feature may be gated on a column
   existing. New columns exist so that a `TaskSpecSummary` served from the index
   round-trips every field it claims to carry — not as a source of truth.
4. **A SQLite migration IS required by this task.** TASK_2026_179 rejected a
   migration on the grounds that _nothing in that task_ needed a schema change —
   a scoped statement, not a standing ban. This task needs columns for the five
   authored fields. The migration SHALL be additive-only (new nullable columns
   with defaults on the existing `task_specs` table), matching the established
   pattern where `depends_on` is a JSON-in-TEXT column with `DEFAULT '[]'`. The
   pre-existing reserved-and-always-null `claim` column SHALL NOT be repurposed.
5. **Saved views are user preference, not task data.** They never enter a task
   folder and they never enter the index (a rebuild would erase them). See
   [§8, D2](#d2-saved-views-live-in-settings).
6. **Selection, palette state, and the ad-hoc filter are session state.** They do
   not survive a reload and must not.

### 4.3 Coordinated edit sites for any new frontmatter field

A new field is not one edit. It is, at minimum:

1. `libs/shared/src/lib/types/task-spec.contract.ts` — `renderTaskMd`'s closed,
   hand-ordered field list (the create path).
2. `libs/shared/src/lib/types/task-spec.types.ts` — `TaskSpecSummary`,
   `TaskSpecDetail`, and the `TaskValidationIssue` code union.
3. `libs/backend/task-specs/src/lib/task-frontmatter.ts` — `TaskFrontmatterSchema`
   **and** the separate manual lift into `TaskSpecSummary`. These are two
   different things in that file and both must be changed; the Zod schema alone
   is documentation.
4. A new additive SQLite migration + `task-index.store.ts` insert SQL, insert
   params, and `rowToSummary`.
5. `libs/backend/task-specs/src/lib/task-writer.service.ts` — the new metadata
   write method. **There is no generic frontmatter-update escape hatch today**;
   `updateFrontmatter` has exactly one caller, with a hardcoded
   `{ status, updated }` patch.
6. `tasks-rpc.schema.ts` (Zod), the handler `METHODS` tuple, and the shared RPC
   result types.
7. MCP: `tasks-namespace.builder.ts` and `tool-description.builder.ts`.
8. `libs/frontend/tasks-ui/src/lib/task-presentation.ts` — presentation maps.
9. `contract.guard.spec.ts` — round-trip coverage for the new field.

A useful accident worth knowing: unrecognised frontmatter keys **already survive**
`updateFrontmatter`, because the merge is over raw `gray-matter` data rather than
over the schema. This means a hand-written `labels:` key will not be destroyed by
a status change even before the feature ships — but it is invisible everywhere
until sites 2, 3, and 4 above exist. Do not mistake survival for support.

---

## 5. Migration and compatibility

### 5.1 The rule

**No existing carrier is rewritten to add any field introduced by this task.**
Not on activation, not on index rebuild, not by the doctor, not by an opt-in
prompt, not on first render. Backfilling existing carriers was explicitly rejected
in TASK_2026_179 and remains rejected. `.ptah/**` is gitignored; there is no undo.

A carrier gains `labels`, `estimate`, `parent`, `duplicates`, or `relates_to`
**only** when a user or an agent explicitly sets that field on that task.

### 5.2 What a task with none of these fields renders as

| Absent field     | Observable value | Rendering                                                             |
| ---------------- | ---------------- | --------------------------------------------------------------------- |
| `labels`         | `[]`             | No chips. No "add label" nag. No placeholder row.                     |
| `estimate`       | `undefined`      | No badge. Matches the _unestimated_ filter value only.                |
| `parent`         | `undefined`      | No parent breadcrumb. Counts as _standalone_ in the parentage filter. |
| `duplicates`     | `[]`             | No duplicate marker.                                                  |
| `relates_to`     | `[]`             | No "Related" group in the detail panel.                               |
| all of the above | —                | **The card is pixel-identical to today's card.**                      |

That last row is the acceptance test. A workspace where nobody has used the new
features SHALL look and behave exactly as it does now, with the addition of the
filter bar and the palette entry point.

### 5.3 New carriers

`renderTaskMd` SHALL **omit** any new field that is empty or unset. A new task
created without labels or an estimate SHALL produce a carrier byte-identical to
what `renderTaskMd` produces today. This keeps carrier diffs minimal, keeps the
round-trip test matrix tractable, and means the feature is invisible until used.
It also means `labels: []` SHALL NOT be emitted the way `depends_on: []` is —
`depends_on` keeps its always-emitted behaviour for compatibility; the new fields
do not adopt it.

### 5.4 Contract version

`SPEC_CONTRACT_VERSION` is bumped only when the on-disk carrier shape changes.
Adding **optional, omitted-when-empty** fields does not change the shape a reader
must handle: every existing carrier remains valid, and every new carrier remains
readable by the current parser. The recommendation is therefore **do not bump**,
and specifically do not use a bump to trigger any migration —
`.ptah/specs/.ptah-spec-contract.json` is a fail-closed stamp for the doctor, not
a migration trigger. The architect may overrule this, but a bump SHALL NOT cause
any file to be rewritten.

### 5.5 The doctor

`task-doctor.service.ts` SHALL NOT gain a "normalize metadata" or "backfill
labels" action. It MAY gain **read-only warnings** for `dangling_parent`,
`parent_cycle`, `parent_depth_exceeded`, and `dangling_relation`, consistent with
its existing `id_mismatch` warning, which it reports and never fixes. Note that
the RPC projection of doctor actions has an `assertNever` exhaustiveness guard —
a new action kind fails typecheck there first, which is a useful tripwire, not an
obstacle to route around.

### 5.6 Down-level readers

A carrier written with `labels:` and read by an older build parses cleanly and
ignores the key. A carrier written by an older build and read by the new build
yields the [§5.2](#52-what-a-task-with-none-of-these-fields-renders-as) defaults.
No compatibility shim, no version branch, no dual code path is required or
permitted.

---

## 6. Stakeholders

| Stakeholder                                | Impact     | Involvement                 | Success criterion                                                     |
| ------------------------------------------ | ---------- | --------------------------- | --------------------------------------------------------------------- |
| Solo maintainer running 180+ task folders  | High       | Daily driver, sole approver | Finds a specific task in < 5 s; closes a milestone in one bulk action |
| Concurrent agents writing carriers via MCP | High       | Automated writer            | Zero silent overwrites; every conflict surfaces as `TASK_CONFLICT`    |
| Orchestration skill + agent templates      | Medium     | Consumers of the contract   | No template change required; new fields are optional                  |
| Future contributors reading `.ptah/specs/` | Medium     | Hand-editors                | Carrier stays readable and hand-editable with no tooling              |
| CI (`contract.guard.spec.ts`)              | Medium     | Automated gate              | Ratchet stays green; round-trip covers every new field                |
| CLI users (`ptah spec …`)                  | Low–Medium | Alternate surface           | New metadata visible in `--json`; `TASK_CONFLICT` still honoured      |

---

## 7. Explicitly out of scope

### (A) Native agent integration — "Run this task"

Deferred by explicit user decision. The user has not settled the UX and named the
real question directly: whether the task dashboard **links out** to the agent
canvas or **embeds** canvas details inside the task tab to avoid page switching. A
separate read-only reconnaissance pass is running against `libs/frontend/canvas`,
`chat-execution-tree`, `chat-streaming`, `chat-routing` (`StreamRouter` /
`SurfaceRegistry`), `tasks-ui`, and the Nx module-boundary tags to establish what
each option costs. **That finding decides A. Nothing in this document designs it.**

Two touchpoints exist and must be respected but not extended:

- `TaskStartService` already exists in `tasks-ui` and builds a
  `/ptah-core:orchestrate <ID>` prompt. This task SHALL NOT modify its behaviour
  and SHALL NOT add a bulk-run affordance.
- FR-C6's palette SHALL NOT register a "run this task" entry.

**Known dependency**: if A later lands as an embedded canvas, the selection model
in FR-C4 and the palette in FR-C6 are the natural host for a run action. Both
should be built so that adding an entry is additive. Nothing more.

### (D) Intake from the messaging gateway

Deferred with A. No requirement in this document assumes an inbound task-creation
path from `messaging-gateway` or `gateway-chat-bridge`, and none SHALL be added.

### Also out of scope

- Drag-and-drop between columns. There is none today; adding it alongside
  multi-select and a new conflict-visible write path is a distinct risk surface.
- Swimlanes, a list/table view, a timeline or Gantt view.
- Any workspace-committed or team-shared views file. See
  [§9, Q3](#9-clarifications-needed).
- Repurposing or migrating `depends_on`.
- Any change to `context.md`, `batches.md`, or any prose document's role.

---

## 8. Recommendations on the open questions

These are recommendations with reasoning. **The architect makes the final call.**

### D1 — Sub-tasks use a `parent:` pointer, not nested folders

**Recommendation: frontmatter `parent:` pointer on a flat sibling folder.**

The flat scan is load-bearing in three places, and nested folders break all three:

1. **The scanner is not a glob and not recursive.** It is one `readDirectory` on
   `.ptah/specs`, filtered to non-dot directories, then exactly one candidate
   path per folder: `join(specsDir, folderName, 'task.md')`. A carrier at
   `.ptah/specs/TASK_X/TASK_Y/task.md` is never read. A nested sub-task would be
   invisible to the board — reproducing the exact class of bug TASK_2026_179 was
   created to eliminate.
2. **The id allocator depends on the same flat listing.** It scans folder names
   at one level and takes the highest `NNN` for the current year. A nested
   sub-task's id would be outside that scan, so the allocator could re-issue it —
   which is precisely the failure TASK_2026_179 refused to risk when it declined
   to normalize `TASK_2026_176`'s declared id.
3. **The doctor filters `/^TASK_/` at one level.** A nested folder would never be
   adopted, never be warned about, and never appear in `registry.md`.

Beyond the three: "the folder name is the canonical id" is a settled contract, and
nesting forces the id to become path-like or to lose uniqueness. The published
`.ptah/specs/README.md` — the only channel that reaches a user with a diverged
`.claude/` clone — states "one sub-folder per task". Nesting would silently make
that document wrong.

The `parent:` pointer costs one new scalar frontmatter field, needs zero scanner
changes, zero allocator changes, and zero doctor changes, and it is a `string`,
so the YAML emitter is untouched. Children are derived. The parent's carrier is
never written when a child appears.

**Recommend one level of nesting** (FR-B3.5). Arbitrary depth turns every rollup
into a graph traversal with cycle risk, and there is no evidence of demand.

### D2 — Saved views live in settings

**Recommendation: `~/.ptah/settings.json` via settings-core, under a `tasks.*`
namespace.**

Ruling out the alternatives first:

- **The SQLite index is disqualified outright.** Every change path funnels into a
  full rebuild that does `DELETE` + re-`INSERT` for the whole workspace, and the
  store silently degrades to `InMemoryTaskIndexStore` when better-sqlite3 fails.
  A saved view stored there would be destroyed by a routine reindex and would
  simply not exist in the fallback. This is not a trade-off; it is a correctness
  failure.
- **Workspace state** (`PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE`) is a real,
  cross-host port and is per-workspace, which is a genuine advantage. But it has
  no generic RPC surface the webview can reach: the only existing wrapper,
  `layout:`, is capability-gated to Electron
  (`requires: ['layoutPersistence']`, set only in
  `apps/ptah-electron/src/rpc-host-profile.ts`), is single-keyed into one blob,
  and is untyped and unvalidated. Using it means building a new RPC anyway, and
  ending up with an opaque unvalidated blob.

settings-core wins on the things that matter here: atomic tmp+rename writes, a
cross-process `fs.watch`, a versioned `$schema` header, Zod validation on every
read and write, and the same behaviour on all three hosts. There is no generic
"arbitrary blob" repository, but a single `SettingDefinition` whose schema is
`z.array(SavedViewSchema)` is an established pattern (`PTAH_CLI_AGENTS_DEF` does
exactly this with a list). Views are also portable across workspaces, which is
what a user actually wants from "my views".

Two implementation gates the architect must not miss: on VS Code, a key must also
appear in `FILE_BASED_SETTINGS_KEYS`
(`libs/backend/platform-core/src/file-settings-keys.ts`) or it will not route to
`~/.ptah/settings.json`; and there is **no generic settings get/set RPC** today —
`settings:` is export/import only and `config:` is per-setting-typed. A
`tasks:`-prefixed method is the cheapest correct route, since that prefix is
already allowed at runtime.

### D3 — One authored side per edge

**Recommendation: every relation is written into exactly one carrier; the inverse
is derived by the index.**

There is no transaction across two files. Writing both sides of an edge doubles
the write surface, doubles the `TASK_CONFLICT` probability, and introduces a
state that has no correct resolution — edge written on A, failed on B. Deriving
the inverse costs one pass over an already-loaded index and can never be
inconsistent, because there is only one source.

This also removes the need for a `blocks:` key entirely: `depends_on` already
_is_ the blocked-by edge, authored on the dependent side. "Blocks" is its inverse.
A UI affordance reading "this task blocks X" simply writes `depends_on` on X —
still exactly one carrier, still exactly one conflict domain.

### D4 — Estimate is an enum, not a duration

**Recommendation: `XS | S | M | L | XL`.**

An enum filters and aggregates cleanly, needs no parsing, needs no unit
normalization, and cannot be entered wrong in six different ways. Free-form hours
invite precision that nobody can substantiate and immediately create a demand for
sums, velocity, and burndown — none of which a file-native board can honestly
compute. Bucket counts (`2 XS · 5 M · 1 XL`) say everything a coarse estimate can
truthfully say. The value is a `string`, so the YAML emitter is untouched. The
five-point scale also matches the sizing vocabulary the orchestration workflow
already uses. See [§9, Q1](#9-clarifications-needed) for the alternative.

### D5 — Bulk operations report per-item, always

**Recommendation: the result shape is a list, not a boolean.**

A bulk operation over N tasks is N independent read-compare-write cycles against
files that concurrent agents are actively writing. Partial failure is the
**expected** outcome, not an error path. Any design whose success signal is a
single boolean is lying. The requirement is therefore structural: the API returns
one entry per task, the UI keeps failures selected, and the word "atomic" never
appears.

---

## 9. Risks

| #   | Risk                                                                                                                                                                                | Prob.  | Impact   | Score  | Mitigation                                                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | A new field is added to some of the nine coordinated sites but not all, producing a field that persists on disk but is invisible in the UI — or worse, is silently dropped on write | High   | High     | **9**  | Treat the nine sites in [§4.3](#43-coordinated-edit-sites-for-any-new-frontmatter-field) as one atomic change. Extend `contract.guard.spec.ts` round-trip coverage to every new field _first_, so an incomplete wiring is a red test rather than a silent data loss |
| R2  | Bulk operations amplify writes against a live agent, and a partial failure is presented as a success                                                                                | High   | Critical | **10** | FR-C4.3–FR-C4.9. Per-item results, failures stay selected, `TASK_CONFLICT` shows the on-disk status, no auto-retry, no atomicity language. Integration test that interleaves an external write mid-bulk                                                             |
| R3  | Sub-tasks implemented as nested folders, silently breaking the scanner, the allocator, and the doctor                                                                               | Medium | Critical | **8**  | D1 recommendation is explicit and reasoned. Add a scanner test asserting a nested `TASK_*/TASK_*/task.md` is **not** indexed, so the flat contract is enforced rather than assumed                                                                                  |
| R4  | A well-intentioned "normalize the carriers" step backfills defaults into 180 gitignored files with no undo                                                                          | Medium | Critical | **8**  | NFR-9 and [§5.1](#51-the-rule) forbid it unconditionally. Add a test asserting a metadata write to task A leaves task B byte-identical, and that a read-only board render writes nothing                                                                            |
| R5  | Bulk operations trigger one full board rescan per task (today's `updateStatus` calls `loadBoard()` on every success) — 12 selected tasks means 12 rescans of ~180 folders           | High   | Medium   | **6**  | NFR-10 and FR-C4.10: ≤ 1 reload per bulk operation. Assert the reload count in a store test                                                                                                                                                                         |
| R6  | The whole-file byte comparison in the conflict check makes _any_ concurrent touch of the carrier — including an unrelated key — refuse a metadata write, producing conflict fatigue | Medium | Medium   | **5**  | Accept the strictness (it is what makes the write safe) but make the message actionable per FR-C4.7. Serialize same-task writes client-side (FR-B5.8) so the UI never conflicts with itself                                                                         |
| R7  | Saved views placed in the SQLite index and erased by a routine reindex                                                                                                              | Low    | High     | **5**  | D2 rules it out explicitly and states why. Test: rebuild the index, assert views survive                                                                                                                                                                            |
| R8  | A relation or parent cycle sends a rollup or inverse computation into an infinite loop, hanging the webview                                                                         | Low    | High     | **5**  | FR-B3.7, FR-B4.7, NFR-11. Explicit cycle-detection tests with self-reference, two-cycle, and long-cycle fixtures                                                                                                                                                    |
| R9  | Free-form labels fragment into `Licensing` / `licensing` / `licensing ` and the filter becomes useless                                                                              | Medium | Medium   | **4**  | FR-B1.4 case- and whitespace-insensitive matching; FR-B1.5 completion from the derived union so the path of least resistance is reuse                                                                                                                               |
| R10 | The command palette hotkey collides with a VS Code or Electron shortcut, or captures keys globally across the webview                                                               | Medium | Medium   | **4**  | FR-C6.1 scopes the shortcut to the Tasks view. Verify on all three hosts before merge                                                                                                                                                                               |
| R11 | The palette is copied from `libs/frontend/editor`, creating a `tasks-ui → editor` dependency that violates the module-boundary tags                                                 | Medium | Medium   | **4**  | FR-C6.8. `nx graph` / boundary lint in the verification gate catches it                                                                                                                                                                                             |
| R12 | Scope creep pulls family A in through a "just add a run button while we're in here"                                                                                                 | Medium | Medium   | **4**  | [§7](#7-explicitly-out-of-scope) names A and D and forbids touching `TaskStartService`. A reviewer rejects any diff to it                                                                                                                                           |
| R13 | A new source file introduces a per-task filename literal or a `TASK_2025_` string, failing the `contract.guard.spec.ts` ratchet late in the batch                                   | Medium | Low      | **3**  | NFR-2 states it up front, including comments and fixtures. Run the ratchet early                                                                                                                                                                                    |
| R14 | The verification gate again omits a touched project, letting a broken mock ship                                                                                                     | Medium | Medium   | **4**  | NFR-14 adds `vscode-lm-tools` and `ptah-cli` to the gate                                                                                                                                                                                                            |
| R15 | Label chip colours fail contrast in one of the two VS Code themes                                                                                                                   | Low    | Low      | **2**  | NFR-12; colour is never the sole carrier of meaning, every chip carries its text                                                                                                                                                                                    |

---

## 10. Definition of done

- [ ] Every FR above has a passing test at the level its acceptance criteria describe.
- [ ] `contract.guard.spec.ts` round-trips every new field: absent, empty, single, many, and a value needing a quoted YAML scalar.
- [ ] A scanner test asserts nested `TASK_*/TASK_*/task.md` is **not** indexed.
- [ ] A test asserts a metadata write to one task leaves every other carrier byte-identical.
- [ ] A test asserts rendering the board writes nothing to disk.
- [ ] An integration test interleaves an external carrier write mid-bulk-operation and asserts a per-item `TASK_CONFLICT` with the other items still succeeding.
- [ ] A store test asserts ≤ 1 board reload per bulk operation.
- [ ] Cycle fixtures for `parent` and for each relation type terminate.
- [ ] Saved views survive a full index rebuild and a malformed-settings read.
- [ ] The board renders identically to today for a workspace where no new field is set.
- [ ] `ALLOWED_METHOD_PREFIXES` verified to cover every new RPC method at runtime, not just at compile time.
- [ ] The NFR-14 gate command run, with actual output reported, including the known pre-existing `ptah-cli` `NO_COLOR` failure called out as pre-existing.

---

## 11. Clarifications needed

None of these block the architect from starting; each has a recommended default
that is already written into the requirements above. They are listed so the user
can overrule cheaply before implementation rather than expensively after.

### Q1 — Estimate scale

The document specifies `XS | S | M | L | XL`.

- **Option A (Recommended)**: `XS | S | M | L | XL`. Coarse, ordered, matches the
  sizing vocabulary the orchestration workflow already uses, aggregates honestly
  as bucket counts.
- **Option B**: Fibonacci points `1 | 2 | 3 | 5 | 8 | 13`. Still an enum, still
  filterable, but numeric-looking values invite summing and velocity math that a
  file-native board cannot honestly support.
- **Option C**: Free-form duration string. Rejected in D4 — needs parsing, unit
  normalization, and produces unverifiable precision.

### Q2 — Sub-task depth

The document specifies exactly one level (a task with a `parent` cannot itself be
a parent).

- **Option A (Recommended)**: one level. Rollups are a single pass, cycles are
  trivially detectable, the board stays flat.
- **Option B**: arbitrary depth with cycle detection. Every rollup becomes a graph
  traversal; the board needs a tree affordance it does not have.

### Q3 — Are saved views per-user, or should they be shareable?

The document specifies per-user, stored in `~/.ptah/settings.json`.

- **Option A (Recommended)**: per-user only. `~/.ptah/` is outside the repo and
  `.ptah/**` inside the repo is gitignored, so nothing under either is
  committable. Views are a personal lens.
- **Option B**: a workspace-committed views file outside `.ptah/`. This is the
  only way to share views with a team, but it introduces a new committed file, a
  new file format, and a merge-conflict surface — and this is a solo-maintainer
  workspace today.

### Q4 — Relative priority of C4 (bulk status) against C6 (palette)

Both are specified. If the batch must be cut:

- **Option A (Recommended)**: build filtering (C1) and the palette (C6) first,
  bulk operations (C4) last. Filtering and the palette are read-only and carry
  almost no risk; bulk operations are the single highest-risk item in this
  document (R2, score 10) and benefit from landing on top of a settled selection
  model.
- **Option B**: bulk operations first, since they are the largest single time
  saving.
