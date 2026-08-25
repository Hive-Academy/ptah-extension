# Context — TASK_2026_181

## Orchestration metadata

- **Strategy**: FEATURE, Full depth (PM → Research → Architect), planning round only
- **cli_delegation**: disabled
- **Depends on**: TASK_2026_179 (contract + conflict-safe write paths), commits
  `b7b24500f` and `f80fa299c`
- **No implementation** until `task-description.md` and `implementation-plan.md`
  are both approved by the user.

## User intent

The user asked whether the Tasks board can be pushed well beyond its current
six-column Kanban, including "features like the ones in plane.so" and a native
AI integration inside the task tab.

Four families were offered. The user selected **B and C for now**:

- **(B) Richer task metadata** — labels, estimates, sub-tasks, and typed
  relations (blocks / blocked-by / duplicate) on top of the existing
  `depends_on`. File-native in carrier frontmatter; no server.
- **(C) Views, filters, command palette** — saved views, multi-axis filtering,
  bulk status operations, keyboard-first command palette.

## Explicitly DEFERRED — not in this task

- **(A) Native agent integration** ("Run this task" on a card). The user has
  not decided the UI/UX and raised the real question directly:

  > "i don't know if we have a link between the task dashboard and the agent
  > canvas or let the tasks has the canvas details integrated inside to avoid
  > page switching?"

  A read-only reconnaissance pass is running against `libs/frontend/canvas`,
  `chat-execution-tree`, `chat-streaming`, `chat-routing` (`StreamRouter` /
  `SurfaceRegistry`), `tasks-ui`, and the Nx module-boundary tags, to establish
  what inline embedding versus linking out would each actually cost. That
  finding decides A. Do NOT design A here.

- **(D) Intake from the messaging gateway.** Deferred with A.

## Why B and C are safe to build now

TASK_2026_179 Phase 2 delivered the write paths this work needs:

- `updateStatus` detects `TASK_CONFLICT` via a pre-write re-read, so **bulk
  status operations** cannot silently clobber a concurrent agent edit. Before
  Phase 2 a bulk operation would have multiplied the original data-loss bug by
  the size of the selection.
- `createDirectoryExclusive` is a real compare-and-swap, so `create` no longer
  races on id allocation. (Observed live during this session: `TASK_2026_180`
  was taken by another writer between a folder scan and an allocation.)
- The MCP `tasks` namespace (`ptah_task_create|update|get|list|check`) gives an
  agent a callable, validated path — no raw `Write` to a carrier.
- `DOC_FILES` is a closed set in `libs/shared/.../task-spec.contract.ts`, and
  `contract.guard.spec.ts` is a live CI ratchet that FAILS the build on a
  per-task filename literal outside its allowlist, and on the dead identifiers
  `task-tracking/`, `.ptah/tasks/`, `specs/TASK_2025_`.

## Hard constraints inherited from TASK_2026_179 — do not violate

- **`task.md` is the machine-owned carrier. `context.md` and its siblings are
  agent-owned prose.** No machine rewrites prose. There is deliberately no
  `ptah_task_set_section` MCP tool. Any new metadata (labels, estimates,
  relations, sub-task links) belongs in carrier FRONTMATTER, never in a prose
  body.
- Folder name is the canonical id. A mismatched `id:` is a WARNING, never
  auto-normalized. `TASK_2026_176` declares `id: TASK_2026_178` — leave it.
- `tasks.md` remains a PERMANENT fallback for `batches.md`. Never
  deprecation-warn it.
- `.ptah/**` is gitignored. There is NO git undo for anything under it. Any
  new mutation path needs the same journalled, fail-closed treatment as
  `task-doctor.service.ts`.
- Adding a new per-task document name requires editing `DOC_FILES` in
  `libs/shared` — the ratchet enforces this.
- Frontend libs MUST NOT import backend libs. `libs/shared` is the only bridge.
  `tasks-ui` consumes the contract module from `libs/shared` for exactly this
  reason.
- New RPC namespace requires BOTH `libs/shared/.../rpc.types.ts` AND
  `ALLOWED_METHOD_PREFIXES` at `vscode-core/src/messaging/rpc-handler.ts:84`.
  `tasks:` is already present.
- Angular 21: signals + `computed()` + `inject()`,
  `ChangeDetectionStrategy.OnPush` mandatory, no `[innerHTML]`.
- TypeScript 5.9 strict, `catch (error: unknown)`. Zod 4 at every boundary.

## Known gaps worth folding in

- The verification gate command used by TASK_2026_179 omits `vscode-lm-tools`
  and `ptah-cli`, both of which that task modified. A broken mock in
  `vscode-lm-tools` slipped through because of it. Any gate this task defines
  should include them.
- `apps/ptah-cli` has a pre-existing test that asserts colored output "by
  default" and fails when `NO_COLOR` is set in the environment.

## Open question for the architect

Sub-tasks are the one item in (B) that may not be purely additive. The current
store is a FLAT folder scan of `.ptah/specs/TASK_*`. Representing a sub-task as
a nested folder would change the scanner's shape; representing it as a
frontmatter `parent:` pointer keeps the scan flat. Weigh both — the flat scan is
load-bearing for the id allocator and the doctor.

**RESOLVED** — see the approved decisions below.

## Checkpoint 1 — APPROVED (2026-08-04)

The user approved `task-description.md` **with the recommendations as written**.
Every open decision is therefore SETTLED. The architect designs to these; it does
not re-litigate them.

| Ref     | Decision (binding)                                                                                                                                                                                                                                                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 / Q2 | Sub-tasks are a frontmatter `parent:` pointer on a **flat sibling folder**. **Exactly one level** — a task with a `parent` cannot itself be a parent. No nested folders, no scanner/allocator/doctor changes.                                                                                                                                        |
| D2 / Q3 | Saved views live in `~/.ptah/settings.json` via settings-core, `tasks.*` namespace, **per-user only**. NOT the SQLite index (a reindex destroys it), NOT workspace state. Two gates: add the key to `FILE_BASED_SETTINGS_KEYS` (`platform-core/src/file-settings-keys.ts`), and ship a `tasks:`-prefixed RPC (there is no generic settings get/set). |
| D3      | **One authored side per edge.** The inverse is derived by the index. No `blocks:` key — `depends_on` already is the blocked-by edge; "blocks X" writes `depends_on` on X.                                                                                                                                                                            |
| D4 / Q1 | Estimate is the enum `XS \| S \| M \| L \| XL`. Not Fibonacci, not a free-form duration. Value is a `string`, so the YAML emitter is untouched.                                                                                                                                                                                                      |
| D5      | Bulk operations return a **per-item list**, never a boolean. Partial failure is the expected outcome. The word "atomic" never appears.                                                                                                                                                                                                               |
| Q4      | Sequencing: **C1 (filtering) and C6 (palette) first, C4 (bulk status) last.** C4 is R2, the highest-risk item in the document (score 10), and benefits from landing on a settled selection model.                                                                                                                                                    |

Also binding on the architect: §4.3's nine coordinated edit sites are ONE atomic
change (R1); NFR-14's verification gate must include `vscode-lm-tools` and
`ptah-cli`; the pre-existing `ptah-cli` `NO_COLOR` test failure is reported as
pre-existing, never "fixed" opportunistically.

## Checkpoint 2 — APPROVED (2026-08-04)

The user approved `implementation-plan.md` as written. 46 files (16 created, 30
modified) across 8 libs + 1 app, in 9 phases. No blocking objection.

Four investigation findings (F1–F4 in §0 of the plan) correct implementation
mechanics and are binding on every developer:

1. **Do NOT edit `ALLOWED_METHOD_PREFIXES`** — `'tasks:'` is already at
   `rpc-handler.ts:84`, and `rpc-allowlist.spec.ts` already proves prefix
   coverage automatically for every method.
2. **Do NOT rely on the Nx boundary lint for R11** — `tasks-ui` and `editor`
   carry identical tags, so the edge is permitted. A source ratchet is required.
3. **Do NOT express key removal as `patch.key = undefined`** — js-yaml cannot
   dump it. Use `updateFrontmatter`'s new `remove` option.
4. **Do NOT give the saved-views setting a strict per-item Zod schema** —
   `BaseSettingsRepository` would discard every view on one bad entry.

Next phase: team-leader MODE 1 → `batches.md`.

**Deliverable filename note**: the batch breakdown goes in `batches.md`, NOT
`tasks.md`. `DOC_FILES` in `libs/shared/src/lib/types/task-spec.contract.ts:70`
makes `batches.md` canonical; `tasks.md` is `LEGACY_DOC_FILES` — a permanent
read fallback that must never be newly authored.
