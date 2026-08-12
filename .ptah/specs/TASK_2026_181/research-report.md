# Research Report — TASK_2026_181: Plane.so feature parity for Ptah's Tasks board

## 0. Scope and method

This replaces an earlier, unsourced comparison. Every claim below is cited to a
Plane.so doc, marketing page, GitHub repo/issue, or explicitly marked
`unverified`. Ptah-side claims are cited to the files actually read for this
task: `libs/shared/src/lib/types/task-spec.contract.ts`,
`libs/shared/src/lib/types/task-spec.types.ts`, and the settled decisions in
`.ptah/specs/TASK_2026_179/context.md` and
`.ptah/specs/TASK_2026_181/context.md`.

**The one fact to hold in view throughout**: Plane is a multi-tenant,
Postgres+Redis-backed, Django/React-Router server product with accounts,
roles, and real-time sync
([github.com/makeplane/plane](https://github.com/makeplane/plane)). Ptah's
task store is `.ptah/specs/TASK_YYYY_NNN/task.md` — gitignored, single-user,
flat-folder-scanned markdown frontmatter with a lazy, optional SQLite index
that falls back to in-memory
(`.ptah/specs/TASK_2026_179/context.md`, "Verified code facts"). No feature
comparison below is meaningful without that gap in view.

---

## 1. Plane's feature inventory, by family

### Work items and hierarchy

- **Work item** — the core unit; gets a sequential per-project id (e.g.
  `PROJ-1`); minimum required field is title
  ([docs.plane.so/core-concepts/issues/overview](https://docs.plane.so/core-concepts/issues/overview)).
- **Sub-work items / parentage** — a work item carries a single `Parent`
  property
  ([docs.plane.so/core-concepts/issues/properties](https://docs.plane.so/core-concepts/issues/properties)).
  Cross-project sub-items are supported: "A work item in Project A can be a
  sub-work item of a work item in Project B. The parent picker searches
  across the entire workspace."
  ([docs.plane.so/core-concepts/issues/overview](https://docs.plane.so/core-concepts/issues/overview)).
- **Hierarchy (workspace feature)** — optionally constrains which Work Item
  Types may nest under which other types, using numbered levels; "Hierarchy
  cannot be disabled once enabled for a workspace."
  ([docs.plane.so/work-items/workspace-work-item-types](https://docs.plane.so/work-items/workspace-work-item-types)).
- **Work Item Types** — custom typed schemas (Bug, Story, Epic, etc.) with
  custom property fields: rich text, member picker (single/multi), URL, and
  more; "Task is created at level 0 and Epic at level 1" by default
  ([docs.plane.so/work-items/project-work-item-types](https://docs.plane.so/work-items/project-work-item-types),
  [docs.plane.so/core-concepts/issues/epics](https://docs.plane.so/core-concepts/issues/epics)).
- **States/workflow** — five state groups (Backlog, Unstarted, Started,
  Completed, Cancelled), each project can define custom states within them
  ([docs.plane.so/core-concepts/issues/states](https://docs.plane.so/core-concepts/issues/states)).
- **Duplicate work item ("Make a copy")** — same-project or cross-project
  copy; bulk copy caps at 1000 items
  ([docs.plane.so/core-concepts/issues/overview](https://docs.plane.so/core-concepts/issues/overview),
  [docs.plane.so/core-concepts/issues/bulk-ops](https://docs.plane.so/core-concepts/issues/bulk-ops)).
- **Branch-name generation** — copies a git-ready branch name
  (`username/ID`) from a work item
  ([docs.plane.so/core-concepts/issues/overview](https://docs.plane.so/core-concepts/issues/overview)).

### Relations and dependencies

- **Blocking / Blocked by** — modeled as scheduling _dependencies_; when both
  items have start/due dates they render as Timeline connectors, and
  violated ones show as red lines
  ([docs.plane.so/core-concepts/issues/overview](https://docs.plane.so/core-concepts/issues/overview)).
- **Relates to / Duplicate / Implements** — default _relation_ types,
  explicitly "don't enforce scheduling constraints"
  ([docs.plane.so/core-concepts/issues/overview](https://docs.plane.so/core-concepts/issues/overview)).
- **Custom relation types** — workspace admins can define new relation types
  with a Title, Inward name, and Outward name (e.g. "Tests" /
  "Depends On")
  ([docs.plane.so/work-items/custom-relations](https://docs.plane.so/work-items/custom-relations)).
- **AI duplicate detection** — runs automatically on every work item
  creation, surfaces up to 5 candidate duplicates
  ([docs.plane.so/ai/plane-ai](https://docs.plane.so/ai/plane-ai)).

### Labels and estimates

- **Labels** — "Categorize your work item with labels created within the
  project"; project-scoped
  ([docs.plane.so/core-concepts/issues/properties](https://docs.plane.so/core-concepts/issues/properties)).
- **Estimates** — three configurable systems, set per project:
  - **Points**: "preset progressions" — Linear, Fibonacci, Squares, or
    Custom — not free numeric entry.
  - **Categories**: text levels — T-shirt sizes (XS–XL), Easy/Medium/Hard,
    or a custom set.
  - **Time** (Pro tier): hour-based durations.
    Free-plan projects are capped at 6 custom estimate values
    ([docs.plane.so/core-concepts/issues/estimates](https://docs.plane.so/core-concepts/issues/estimates)).

### Cycles and modules

- **Cycles** — time-boxed sprints; one active cycle by default (a named
  "Parallel cycles" feature relaxes this); optional auto-scheduling with a
  configurable duration
  ([docs.plane.so/core-concepts/cycles](https://docs.plane.so/core-concepts/cycles)).
- **Modules** — non-time-boxed groupings of work items ("smaller, focused
  projects... tracking progress on a new feature... or representing discrete
  pieces of your software architecture"); progress = % of completed work
  items; module states: Backlog, Planned, In Progress, Paused, Completed,
  Cancelled
  ([docs.plane.so/core-concepts/modules](https://docs.plane.so/core-concepts/modules)).

### Views, filters, PQL

- **Filters** — field + operator + value chips, combinable, applied live
  ([docs.plane.so/core-concepts/issues/visualise_filter](https://docs.plane.so/core-concepts/issues/visualise_filter)).
- **Plane Query Language (PQL)** — structured text queries with AND/OR and
  grouping; available "wherever work items are listed: Work items, Cycles,
  Modules, Views, Teamspace work items, Workspace views"; has a
  natural-language-to-PQL AI assist
  ([docs.plane.so/core-concepts/issues/plane-query-language](https://docs.plane.so/core-concepts/issues/plane-query-language)).
- **Views** — "a saved configuration of filters, layouts, display options,
  and sorting preferences applied to your work items. Views do not change
  the underlying data." Project-level and workspace-level (cross-project)
  variants exist; four built-ins ship (All Issues, Assigned to Me, Created
  by Me, Subscribed); a view can be shared via link
  ([docs.plane.so/core-concepts/views](https://docs.plane.so/core-concepts/views)).

### Bulk operations

- Restricted to List/Table layout; checkbox multi-select; property edits are
  staged and only committed on an explicit **Update** click. Documented
  batch-editable properties: state, priority, assignee, cycle, work item
  type, labels, modules, start/due dates. Bulk archive and bulk delete are
  also supported; deletion "cannot be undone." No documented atomicity or
  partial-failure behavior for the update path
  ([docs.plane.so/core-concepts/issues/bulk-ops](https://docs.plane.so/core-concepts/issues/bulk-ops)).

### Command palette

- **"Power K"** (Cmd/Ctrl+K) — search across work items, cycles, modules
  (optionally workspace-wide); create projects, work items, cycles, modules,
  views, pages, and workspaces; inline property edits on a work item
  (state/priority/assignee, copy link) when opened on a work item page;
  quick theme/settings toggles; jumps to the keyboard-shortcut list and docs
  ([docs.plane.so/core-concepts/power-k](https://docs.plane.so/core-concepts/power-k)).
- A full shortcut reference is reachable via Cmd/Ctrl+/
  ([docs.plane.so/support/keyboard-shortcuts](https://docs.plane.so/support/keyboard-shortcuts)).

### Intake / triage

- Project-level, **off by default**. Three channels: in-app (Guests can
  submit), public Forms (no account required), and a dedicated per-project
  Email address (renewable)
  ([docs.plane.so/intake/overview](https://docs.plane.so/intake/overview),
  [docs.plane.so/core-concepts/intake](https://docs.plane.so/core-concepts/intake),
  [docs.plane.so/intake/intake-forms](https://docs.plane.so/intake/intake-forms),
  [docs.plane.so/intake/intake-email](https://docs.plane.so/intake/intake-email)).
- Submissions land in a **Triage** state; a reviewer accepts (choosing the
  destination workflow state) or rejects
  ([docs.plane.so/intake/intake-forms](https://docs.plane.so/intake/intake-forms)).
- Custom intake forms are built from a Work Item Type's own field schema
  ([docs.plane.so/intake/intake-forms](https://docs.plane.so/intake/intake-forms)).

### Pages and wiki

- **Project Pages** are scoped to one project; **Wiki** pages live at the
  workspace level for cross-project knowledge; nested pages are gated to the
  Business tier
  ([plane.so/wiki](https://plane.so/wiki),
  [plane.so/business](https://plane.so/business)).
- Rich-text/AI-assisted editing is claimed on marketing pages; exact editor
  mechanics (collaborative editing protocol, conflict model) are
  **unverified** — not documented in the pages fetched for this report.

### Analytics

- Workspace-level analytics (Admin role only), project-level (Admin/Member),
  and cycle/module-level drill-down. The workspace dashboard table shows
  member count, work item count, cycles/modules, and even page/view counts
  per project, plus an intake column
  ([docs.plane.so/core-concepts/analytics](https://docs.plane.so/core-concepts/analytics)).
- Dashboards are user-manageable (each member can create/edit/delete their
  own), support work-item filters, and clicking a segment opens the
  filtered All Work Items view
  ([plane.so/changelog/release-v2-6-0-pql-releases-wiki-collections-and-more](https://plane.so/changelog/release-v2-6-0-pql-releases-wiki-collections-and-more)).

### Time tracking

- Per-project toggle; per-work-item worklog entries (hours, minutes,
  optional description) roll into a "Tracked time" property on that item; a
  workspace-level Worklogs view filters by user/project/date and exports to
  Excel/CSV
  ([docs.plane.so/core-concepts/issues/time-tracking](https://docs.plane.so/core-concepts/issues/time-tracking)).
- **Project-level** aggregated time analytics/rollup (budget utilization,
  module/cycle breakdown) is an **open, unshipped feature request** as of
  the GitHub issue dated 2025-10-30 — not a shipped capability
  ([github.com/makeplane/plane/issues/8045](https://github.com/makeplane/plane/issues/8045)).

### Templates

- **Work Item Templates** (Pro) — pre-fill a work item's fields (including
  sub-items) at creation time; managed at project or workspace level
  ([docs.plane.so/templates/work-item-templates](https://docs.plane.so/templates/work-item-templates)).
- **Project Templates** (Business) — pre-configure states, labels, work item
  types, and optionally seed initial work items for a new project
  ([docs.plane.so/templates/project-templates](https://docs.plane.so/templates/project-templates)).
- **Recurring work items** — "define work that repeats on a schedule; Plane
  creates it automatically" — marketing claim; underlying mechanism
  **unverified**
  ([plane.so/work-items](https://plane.so/work-items)).

### Notable extras (not on the required list, but structurally relevant)

- **Roles and permissions** — workspace roles Owner/Admin/Member/Guest;
  independent project roles Admin/Contributor/Commenter/Guest; a documented
  "guest ceiling" blocks privilege escalation; a full permissions matrix
  gates invites, role changes, removals
  ([docs.plane.so/roles-and-permissions/overview](https://docs.plane.so/roles-and-permissions/overview),
  [docs.plane.so/roles-and-permissions/member-roles](https://docs.plane.so/roles-and-permissions/member-roles),
  [docs.plane.so/roles-and-permissions/permissions-matrix](https://docs.plane.so/roles-and-permissions/permissions-matrix)).
- **Project subscribers** (Business) — get notified of all work-item
  activity in a project without subscribing item-by-item
  ([docs.plane.so/core-concepts/projects/manage-project-members](https://docs.plane.so/core-concepts/projects/manage-project-members)).
- **"Real-time collaboration"** — "Every change on work-item syncs
  instantly. Teams work simultaneously without conflicts or lost data."
  Marketing claim; exact transport (websocket/SSE/poll) is **unverified**
  ([plane.so/project-management](https://plane.so/project-management)).
- **Workflows and Approvals** (Business tier, per nav) — a second
  approval step in state transitions; not independently verified beyond the
  nav listing
  ([plane.so/business](https://plane.so/business)).
- **Architecture** — self-hosted (Docker/Kubernetes/Podman) or cloud;
  frontend React Router, backend Django, a Node.js component, PostgreSQL,
  Redis; AGPL-3.0-licensed open-source edition
  ([github.com/makeplane/plane](https://github.com/makeplane/plane),
  [plane.so/open-source](https://plane.so/open-source)).

---

## 2. Three-way port classification

Constraint shorthand used in the "why" column, all sourced to
`.ptah/specs/TASK_2026_179/context.md` and the shared contract module unless
noted: **files-as-truth** (`task.md` frontmatter is the closed, CI-ratcheted
schema in `task-spec.contract.ts`), **flat scan** (`.ptah/specs/TASK_*`
glob is load-bearing for the id allocator and the doctor), **single-user**
(no accounts, per `TASK_2026_181/context.md`), **no server** (no
process to broadcast from), **gitignored** (`.ptah/**`, no VCS undo),
**lazy index** (SQLite is optional/derived with an in-memory fallback per
`register.ts:57-65`, so it "cannot gate anything"), **no transaction** (no
`writeFileExclusive`; only `createDirectoryExclusive` is a real CAS).

| Feature                                               | Classification                   | Reason (specific Ptah constraint)                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Labels                                                | PORTS CLEANLY                    | Pure array field on the closed `task.md` frontmatter schema; no cross-file or server dependency, single-user coloring is cosmetic.                                                                                                                                                                                                                                                                                               |
| Estimates                                             | PORTS CLEANLY                    | Same as labels — a scalar/enum frontmatter field; no rollup engine required to _store_ it, only to aggregate it later (see §3).                                                                                                                                                                                                                                                                                                  |
| Sub-issues (parentage)                                | PORTS WITH CHANGES               | The store is a **flat scan**; a nested-folder shape (mirroring Plane's tree) breaks the id allocator and the doctor, so only a `parent:` frontmatter pointer (keeping the scan flat) is viable — this is the literal open question in `TASK_2026_181/context.md`.                                                                                                                                                                |
| Relations (blocks/duplicate/relates-to)               | PORTS WITH CHANGES               | `dependsOn` already exists as this exact shape (folder-name array + `dangling_depends_on` warning), so new relation kinds are additive **files-as-truth** fields — but Plane relations are bidirectional-by-transaction, and Ptah has **no transaction** across two `task.md` files, so a renderer must tolerate one-sided relations.                                                                                            |
| Custom relation _types_ (workspace-defined)           | DOES NOT PORT AS DESIGNED        | Requires a workspace-settings admin surface Ptah does not have; **single-user** makes a "workspace admin defines new relation semantics" screen pointless — a small closed set is enough.                                                                                                                                                                                                                                        |
| States/workflow (custom per-project)                  | PORTS WITH CHANGES               | `TaskStatus` is a closed literal union (`TASK_STATUSES`) referenced across UI and the CI ratchet, not a configurable per-project table; making it configurable is a schema-version bump (`SPEC_CONTRACT_VERSION`) like Phase 1 did, not a field add.                                                                                                                                                                             |
| Views (saved filter+layout bundles)                   | PORTS WITH CHANGES               | Plane's own docs say a view "does not change the underlying data" — it is **not task data**. It cannot live in `task.md` (closed DOC_FILES schema) nor safely depend on the **lazy index** (can vanish to in-memory fallback); it needs its own durable, non-per-task store.                                                                                                                                                     |
| Ad hoc filters                                        | PORTS CLEANLY                    | Pure computed operation over `TaskSpecSummary[]` already loaded for the board; nothing persisted, so none of the above constraints bite.                                                                                                                                                                                                                                                                                         |
| PQL (as specified)                                    | PORTS WITH CHANGES (scoped down) | Plane's PQL spans 6 resource types Ptah doesn't have (cycles/modules/teamspaces); a small filter-expression DSL over the existing summary fields is plausible, full PQL is not — and its AI-generate-query step depends on Plane's server, which Ptah has **no server** to replicate.                                                                                                                                            |
| Bulk operations                                       | PORTS WITH CHANGES               | Ptah has **no transaction**: `updateStatus` already needed a pre-write re-read and a typed `TASK_CONFLICT` specifically because "a bulk operation would have multiplied the original data-loss bug by the size of the selection" (`TASK_2026_179/context.md`). Plane's docs don't even specify bulk-update partial-failure handling, so there is no design to copy — Ptah must treat partial failure as normal, not exceptional. |
| Command palette                                       | PORTS CLEANLY                    | Pure UI layer over already-callable paths — the `tasks:` RPC namespace and MCP `ptah_task_create\|update\|get\|list\|check` tools already exist; no new storage constraint.                                                                                                                                                                                                                                                      |
| Intake/triage (forms, email, Guest submission)        | DOES NOT PORT                    | Explicitly deferred as family D in `TASK_2026_181/context.md`; structurally needs a reachable **server** endpoint and an accounts system Ptah, being **single-user** with **no server**, does not have.                                                                                                                                                                                                                          |
| Cycles (sprints)                                      | PORTS WITH CHANGES               | A date-range/grouping field is portable as frontmatter, but Plane's burndown/velocity analytics imply cross-task aggregation that does not exist in Ptah yet — computable via a flat scan without a server, but it is new surface, not a port.                                                                                                                                                                                   |
| Modules (component grouping)                          | PORTS CLEANLY (but redundant)    | Structurally just a tag-like field, close enough to Labels that this is a product-scope decision, not a technical blocker.                                                                                                                                                                                                                                                                                                       |
| Analytics/dashboards                                  | DOES NOT PORT AS DESCRIBED       | Plane's dashboards aggregate "team members... cycles and modules... pages and views" across multiple people and projects — a **single-user**, single-tree flat scan can produce simple local counts (which the board already does informally) but not Plane's cross-team rollups.                                                                                                                                                |
| Time tracking (per-item worklog)                      | PORTS WITH CHANGES               | Logging hours is an appended field, no server needed — but Plane's own project-level rollup is an **unshipped feature request**, so there is no proven design to copy; any Ptah rollup must re-scan files on demand rather than trust the **lazy index**.                                                                                                                                                                        |
| Templates (work item / project)                       | PORTS CLEANLY                    | A template only pre-fills initial content at creation time; it doesn't touch the `task.md`/`context.md` ownership split (machine-owned vs agent-owned prose) because there's no ongoing sync obligation.                                                                                                                                                                                                                         |
| Pages/Wiki                                            | DOES NOT PORT / OUT OF SCOPE     | `context.md` is deliberately the single agent-owned prose surface; `TASK_2026_179` explicitly rejected merging prose and carrier "even opt-in" to preserve the accidental safety of disjoint-file concurrency — a second collaborative prose surface contradicts that decision outright.                                                                                                                                         |
| Multi-user roles/permissions/RBAC                     | DOES NOT PORT                    | **Single-user** by explicit constraint — there is no accounts system to hang a role onto.                                                                                                                                                                                                                                                                                                                                        |
| Notifications / subscribers                           | DOES NOT PORT                    | Notifications imply a delivery channel to _other_ users; **single-user**, none exists.                                                                                                                                                                                                                                                                                                                                           |
| Real-time collaborative sync                          | DOES NOT PORT                    | Requires a broadcast channel (**no server**); Ptah's concurrency model is conflict-_detection_ on next write (`TASK_CONFLICT`), not live broadcast — `TASK_2026_179` explicitly rejected a cross-process lockfile because "an external Claude Code doing a raw Edit will not honor it," which kills any live-sync design for the same reason.                                                                                    |
| AI duplicate detection (server-side, on every create) | DOES NOT PORT AS DESCRIBED       | Needs a corpus-wide similarity search server; an agent-runtime-side equivalent is family-A territory (deferred), not a task-store feature.                                                                                                                                                                                                                                                                                       |

---

## 3. Deep dive — the two in-scope families

### Family B: sub-issues, relations, labels, estimates

**Sub-issues and the flat scan.** Plane models parentage as a single
`Parent` property per work item — at most one parent, and that pointer is
workspace-scoped rather than project-scoped: "the parent picker searches
across the entire workspace"
([docs.plane.so/core-concepts/issues/overview](https://docs.plane.so/core-concepts/issues/overview)).
On top of the raw pointer, an optional "Hierarchy" feature constrains which
Work Item Types may nest under which other types via numbered levels, and
once turned on for a workspace it "cannot be disabled"
([docs.plane.so/work-items/workspace-work-item-types](https://docs.plane.so/work-items/workspace-work-item-types)).

Ptah's store is a **flat** scan of `.ptah/specs/TASK_*`, and that flatness
is load-bearing for two other subsystems: the id allocator (scans the
highest `NNN` for the current year across every folder) and
`task-doctor.service.ts`'s plan/apply adoption cycle
(`TASK_2026_179/context.md`). `TASK_2026_181/context.md` names this
tension directly as the open question for the architect: a nested-folder
shape mirrors Plane's tree visually but changes the scanner's shape (the
allocator would need to decide whether nested ids share the parent year's
numbering pool, and the doctor's flat directory listing assumption breaks).
A `parent:` frontmatter pointer — the same shape `dependsOn` already uses —
keeps the scan flat: a sub-task is still a top-level folder found by the
same glob, carrying one more field. Unlike Plane, Ptah cannot enforce
"only Epics may contain Stories," because `TaskType` is a flat closed enum
(`FEATURE`/`BUGFIX`/`REFACTORING`/`DOCUMENTATION`/`RESEARCH`/`DEVOPS`/
`SAAS_INIT`/`CREATIVE`, `task-spec.types.ts:23-33`) with no notion of level
— building that would be inventing a new type-hierarchy concept, not
porting Plane's.

**Relations.** Plane separates two things that read similarly but are not.
Blocking/Blocked-by are scheduling _dependencies_: when both items have
start/due dates they render as Timeline connectors, and violated ones show
as red lines. Relates-to/Duplicate/Implements are "logically connected"
_relations_ that explicitly "don't enforce scheduling constraints," and a
workspace can define further custom relation types with an inward/outward
name pair
([docs.plane.so/core-concepts/issues/overview](https://docs.plane.so/core-concepts/issues/overview),
[docs.plane.so/work-items/custom-relations](https://docs.plane.so/work-items/custom-relations)).
Ptah already has one relation shaped exactly like Plane's
Blocking/Blocked-by: `dependsOn` is a folder-name string array, validated,
with `dangling_depends_on` as a non-fatal warning rather than an exclusion
(`task-spec.types.ts:39-58`). Extending to `blocks`/`duplicateOf`/
`relatesTo` is additive to the same pattern. What does **not** port
cleanly: Plane's relations are bidirectional by server transaction — "the
relation appears on both work items" (custom-relations doc) — but Ptah has
no transaction spanning two `task.md` carriers. Writing `blocks: [TASK_B]`
into `TASK_A/task.md` and `blockedBy: [TASK_A]` into `TASK_B/task.md` are
two independent, non-atomic writes; a renderer must tolerate a one-sided
relation left by a crash, an external edit, or an interrupted agent between
the two writes, rather than assume Plane's guarantee that both sides always
agree.

**Estimates: enum, not free-form, and why it matters.** Plane's Points
system uses "preset progressions" — Linear, Fibonacci, Squares, or Custom —
not free numeric entry; Categories are an enumerated label set (T-shirt
XS–XL, Easy/Medium/Hard, or custom); Time is hour-based and Pro-gated. All
three are closed, per-project-configured **enums**, not open numbers — even
"Points" restricts you to one progression's fixed values, and the free tier
caps custom values at 6
([docs.plane.so/core-concepts/issues/estimates](https://docs.plane.so/core-concepts/issues/estimates)).
This choice is not incidental: an enum lets both PQL filters and rollup math
treat the field as a small, closed, summable domain once a progression is
picked. Free-form numeric entry would let every task invent its own unit
and defeat both faceted filtering and cross-task rollup. For Ptah the same
argument applies with more force, because there is no server-side rollup
engine to fall back on: if `estimate` is stored as an open string, ad hoc
filtering ("show all 3-point tasks") still works client-side, but any
future rollup (sum of points across a view) requires the field to be a
closed numeric enum from the start — Ptah would need to match Plane's
choice out of necessity, not convention.

**Labels.** Plane's labels are "created within the project" — project-
scoped, not global
([docs.plane.so/core-concepts/issues/properties](https://docs.plane.so/core-concepts/issues/properties)).
Ptah has no project concept above a single task folder, so the natural
equivalent is a flat, workspace-wide label vocabulary (or none at all —
free-text labels per task) rather than a project-scoped one; this is a
product decision, not a technical blocker, and is flagged here only because
Plane's scoping doesn't map onto Ptah's shape 1:1.

### Family C: views, filters, bulk operations, command palette

**Views — what is actually persisted, and whose data is it.** Plane states
it plainly: "A View in Plane is a saved configuration of filters, layouts,
display options, and sorting preferences applied to your work items. Views
do not change the underlying data — they are lenses"
([docs.plane.so/core-concepts/views](https://docs.plane.so/core-concepts/views)).
Everything a saved view holds — which filters, which layout, which columns,
sort order — is **user preference**, not task data. None of it belongs in
`task.md` (machine-owned, closed `DOC_FILES` schema, CI-ratcheted by
`contract.guard.spec.ts`) or in `context.md` (agent-owned prose,
`TASK_2026_179/context.md`). It should also not be gated behind the SQLite
index, because that index is lazily selected and falls back to
`InMemoryTaskIndexStore` when `better-sqlite3` fails to load
(`register.ts:57-65`, `TASK_2026_179/context.md`) — a saved view that only
survives when SQLite happens to be available would silently disappear on a
machine where the native module fails to build, exactly the kind of
fragile gating `TASK_2026_179` rejected for schema versioning (it used a
file stamp instead). A saved view therefore needs its own durable,
non-per-task store — most simply a small settings file, analogous to how
`~/.ptah/settings.json` already holds workspace-level preference outside
the specs tree. Plane's _workspace-level_ views (cross-project, alongside
four built-ins: All Issues, Assigned to Me, Created by Me, Subscribed)
reinforce that a view is not scoped to one task folder at all, which rules
out ever attaching it to a single carrier.

**Filters.** Ad hoc filtering in Plane is chip-based (field, operator,
value, combinable) and applies live with no persistence step
([docs.plane.so/core-concepts/issues/visualise_filter](https://docs.plane.so/core-concepts/issues/visualise_filter)).
This maps directly onto Ptah's already-loaded `TaskSpecSummary[]` — a
computed/filtered signal over data already fetched for the board, no new
storage at all.

**Bulk operations and partial failure as the normal case.** Plane restricts
bulk operations to List/Table layout, multi-selects via checkboxes, stages
edits, and commits only on an explicit **Update** click. It documents eight
batch-editable properties (state, priority, assignee, cycle, type, labels,
modules, dates), plus bulk archive/delete, and notes delete "cannot be
undone"
([docs.plane.so/core-concepts/issues/bulk-ops](https://docs.plane.so/core-concepts/issues/bulk-ops)).
The docs say **nothing** about what happens when some selected items fail
to update mid-batch — no atomicity guarantee is documented either way
(unverified beyond the delete-irreversibility note). That silence is more
informative for Ptah than anything stated outright: Plane can plausibly
afford it because a Django/Postgres backend can wrap a batch in one
transaction server-side (unverified — inferred from the stack, not
confirmed in docs). Ptah starts from the opposite place, stated directly in
`TASK_2026_179/context.md`: "`updateStatus` detects `TASK_CONFLICT` via a
pre-write re-read, so bulk status operations cannot silently clobber a
concurrent agent edit. Before Phase 2 a bulk operation would have
multiplied the original data-loss bug by the size of the selection."
`IFileSystemProvider` deliberately has no `rename` and no exclusive write
beyond `createDirectoryExclusive` — no cross-file transaction is available
at all. A Ptah bulk operation over N tasks is N independent
conflict-detecting single-file writes, so partial failure (7 of 10 tasks
updated, 3 returning `TASK_CONFLICT` because an agent touched them
mid-batch) is the **normal** case to design for, not an edge case to
document away. This is the one place Ptah cannot even loosely copy Plane's
UX — it has to surface a per-item result list, because there is no
transaction to hide the partial state behind.

**Command palette.** Plane's "Power K" searches and creates work items,
cycles, modules, views, pages, and workspaces, and offers inline property
edits (state/priority/assignee, copy link) plus quick settings toggles
([docs.plane.so/core-concepts/power-k](https://docs.plane.so/core-concepts/power-k)).
Ptah's equivalent is strictly narrower (no cycles/modules/pages to create),
but every action it would need already has a callable path: the `tasks:`
RPC namespace and the MCP `ptah_task_create|update|get|list|check` tools
(`TASK_2026_181/context.md`, `TASK_2026_179/context.md`). The palette is a
pure UI layer over existing write paths — it adds no new storage
constraint at all.

---

## 4. What Ptah has that Plane does not

- **The agent and the human share one local write path.** Ptah's task store
  is directly writable by an AI agent through the same validated MCP tools
  a human's UI action would trigger (`ptah_task_create|update|get|list|check`,
  `TASK_2026_179/context.md`), with no account, no API key provisioning, no
  server round-trip. Plane's equivalent, "Plane AI," is a bolt-on product
  layered on top of its multi-tenant server — every action it takes is an
  authenticated API call
  ([docs.plane.so/ai/plane-ai](https://docs.plane.so/ai/plane-ai)). This is
  a **structural** advantage, not a mere tradeoff: it follows directly from
  files-as-truth + no-server, not from Plane choosing not to build it —
  Plane's architecture requires the API call; Ptah's doesn't have one to
  require.
- **Zero-setup, zero-account local operation.** No signup, no workspace
  provisioning, no Postgres/Redis process to run. This is genuinely
  structural — it follows directly from single-user + no-server, and Plane
  even at its lightest self-hosted footprint needs 2 CPU / 4 GB RAM and
  Docker/Kubernetes ([plane.so/open-source](https://plane.so/open-source)).
- **Task data readable/editable by any tool, not just Plane's client.**
  Being plain markdown frontmatter under a normal folder means any text
  editor, `grep`, or unrelated script can read or (carefully) write it — no
  API client required. This cuts both ways, honestly: the same
  `.ptah/**` gitignore that keeps this simple ("no server needed") is also
  why Ptah has **no** audit trail — Plane logs "every property change,
  comment, and state transition... with author, timestamp, and diff"
  ([plane.so/work-items](https://plane.so/work-items)); Ptah has no VCS
  history for task data at all
  (`.gitignore:128` is `.ptah/**`, per `TASK_2026_179/context.md`). Call
  this a tradeoff, not a win.

Things Ptah is simply missing rather than structurally better at — real-time
sync, notifications, permissions, an audit trail — are covered honestly in
§5; they are not reframed as advantages here.

---

## 5. Anti-recommendations

- **Multi-user roles/permissions (Owner/Admin/Member/Guest, project
  Admin/Contributor/Commenter/Guest)** — a real, verified Plane feature
  ([docs.plane.so/roles-and-permissions/overview](https://docs.plane.so/roles-and-permissions/overview)).
  Mistake to port: Ptah is single-user by explicit constraint
  (`TASK_2026_181/context.md`); there is no accounts system to hang a role
  off of, and building one would mean inventing the server Ptah
  deliberately does not have.
- **Notifications / project subscribers** — verified
  ([docs.plane.so/core-concepts/projects/manage-project-members](https://docs.plane.so/core-concepts/projects/manage-project-members)).
  Mistake: notification implies a delivery channel to _other_ users;
  single-user, none exists.
- **Real-time collaborative sync** ("every change... syncs instantly,"
  [plane.so/project-management](https://plane.so/project-management)) —
  mistake: requires a broadcast channel Ptah has no server to run.
  `TASK_2026_179` explicitly rejected a cross-process lockfile "because an
  external Claude Code doing a raw `Edit` will not honor it" — the identical
  reasoning kills any live-sync design; Ptah's concurrency model is
  conflict-_detection_ on the next write (`TASK_CONFLICT`), not broadcast.
- **Intake from public forms/email with Guest accounts** — verified
  ([docs.plane.so/intake/overview](https://docs.plane.so/intake/overview)).
  Already explicitly deferred as family D alongside native agent
  integration in `TASK_2026_181/context.md`; also structurally needs the
  account/server layer above.
- **Full custom relation-type editor at workspace-settings level** —
  verified
  ([docs.plane.so/work-items/custom-relations](https://docs.plane.so/work-items/custom-relations)).
  Mistake to port literally: it assumes a workspace-admin settings surface
  Ptah has no reason to build for one user; a small closed set of relation
  kinds (blocks/blocked-by/duplicate/relates-to) matches the closed-`
DOC_FILES` philosophy already established and needs no settings UI.
- **Server-side AI duplicate detection on every creation** — verified
  ([docs.plane.so/ai/plane-ai](https://docs.plane.so/ai/plane-ai)). Mistake
  to port as designed: it needs a corpus-wide similarity search server. If
  wanted at all, it's agent-runtime work (family A, already deferred), not
  a task-store feature.
- **Full Plane Query Language** — verified
  ([docs.plane.so/core-concepts/issues/plane-query-language](https://docs.plane.so/core-concepts/issues/plane-query-language)).
  Over-engineered for Ptah's much smaller object model (no
  cycles/modules/teamspaces to query across); its natural-language-to-query
  step depends on Plane's own server-side model integration, which Ptah has
  no server to replicate. A handful of filter chips covers what a flat
  folder scan needs.
- **Nested collaborative Wiki/Pages editor** — verified at a marketing level
  ([plane.so/wiki](https://plane.so/wiki)); editor mechanics unverified.
  Mistake regardless of mechanics: it conflicts directly with the settled
  `TASK_2026_179` decision to keep `context.md` as the single agent-owned
  prose surface — that decision explicitly rejected merging prose and
  carrier "even opt-in" to preserve the accidental safety of disjoint-file
  concurrency. A second prose-editing surface with its own sync model
  reopens exactly the risk that decision closed.
- **Workflows and Approvals** (Business-tier nav item,
  [plane.so/business](https://plane.so/business), not independently
  verified beyond the nav listing) — mistake: an approval step implies a
  second person to approve, which does not exist in a single-user store.

---

## Sources consulted

Plane docs: core-concepts/issues/overview, properties, states, estimates,
bulk-ops, plane-query-language, time-tracking, epics; core-concepts/views,
modules, cycles, analytics, intake; work-items/workspace-work-item-types,
project-work-item-types, custom-relations; templates/work-item-templates,
project-templates; roles-and-permissions/overview, member-roles,
permissions-matrix; core-concepts/workspaces/members;
core-concepts/projects/overview, manage-project-members;
core-concepts/power-k; support/keyboard-shortcuts; ai/plane-ai;
introduction/core-concepts; intake/overview, intake-forms, intake-email.
Marketing/other: plane.so/work-items, plane.so/wiki, plane.so/business,
plane.so/open-source, plane.so/project-management,
plane.so/changelog/release-v2-6-0-...; github.com/makeplane/plane (README);
github.com/makeplane/plane/issues/8045 (time-tracking rollup, unshipped).

Ptah: `libs/shared/src/lib/types/task-spec.contract.ts`,
`libs/shared/src/lib/types/task-spec.types.ts`,
`.ptah/specs/TASK_2026_179/context.md`,
`.ptah/specs/TASK_2026_181/context.md`.

No source in this report was paywalled; two initial docs.plane.so URLs
guessed before verification (sub-work-items, relations, estimates, labels
direct paths) returned 404 and were not used — all citations above were
re-verified via search-returned URLs before being cited.
