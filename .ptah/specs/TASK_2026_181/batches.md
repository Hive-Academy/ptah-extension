# Development Batches — TASK_2026_181

**Title**: Richer task metadata and a keyboard-first views/filter layer for the Tasks board
**Scope**: families **B** and **C** only. **A** and **D** are out of scope.
**Source of truth**: `implementation-plan.md` (APPROVED, Checkpoint 2). This file does not
re-plan it — §7's nine phases **are** the batch skeleton.

**Total Tasks**: 71 | **Batches**: 14 | **Status**: **12/14 complete — 13 & 14 DEFERRED to
`TASK_2026_185`**

---

# ✅ TASK COMPLETION SUMMARY — TASK_2026_181

**Delivered: 12 of 14 batches.** Batches 13–14 (C5 bulk labels, the designated P2 cut) were
**deferred by decision** to `TASK_2026_185` — see the block above Batch 13 for the full
reasoning.

## The twelve commits

| Batch | SHA            | What landed                                                            |
| ----- | -------------- | ---------------------------------------------------------------------- |
| 1     | `3e93069fd`    | Task metadata contract ratchet across nine sites                       |
| 2     | `7cadd50ec`    | Task graph derivation + cross-file relation validation                 |
| 3     | `c6cf19dce`    | Metadata read path across board and detail                             |
| 4     | `2f7426bf0`    | The single task-metadata write path                                    |
| 5     | `c122d2441`    | Client metadata editor + write queue                                   |
| 6     | `34cf9e75b`    | Shared filter predicate across list, store and CLI                     |
| 7     | `c107e9d09`    | Board filter bar, sorting, filtered-empty state                        |
| 8     | `26c23f190`    | Saved-views storage, RPC, file-routing gate                            |
| 9     | `a2d36a24c`    | Saved-views menu + the R7 durability proof                             |
| 10    | `ed840f9d2`    | Command palette, board keyboard nav, R11 ratchet                       |
| 11    | `6c46e9a29`    | Bulk status backend, as a list of outcomes                             |
| 12    | ⏳ **PENDING** | Bulk status frontend — verified and staged, commit blocked (see below) |

## Gates discharged

- **G1** — SQLite suites were skipping rather than running ✅
- **G2** ✅ · **G3** ✅
- **Phase 1** ✅ · **Phase 2** ✅
- **Phase 3** ✅ discharged for the pair (`2f7426bf0` + `c122d2441`)
- **Phase 4** ✅ · **Phase 5** ✅ · **Phase 6** ✅ **except R10** (below)
- **§7 PHASE 7 ACCEPTANCE GATE** ✅ **DISCHARGED FOR THE PAIR** — Batch 11 `6c46e9a29` +
  Batch 12. **R2 — the highest-risk item in the requirements document (score 10) — is
  CLOSED.**

## ⚠️ Batch 12: verified and staged, commit blocked by a foreign gate

Batch 12 passed every check — gate run uncached twice (tasks-ui **470/470**, shared 628,
task-specs 380, rpc-handlers 1 634), both reviewers APPROVED, the wiring seam's second half
proven load-bearing by construction. **15 paths are staged, all `tasks-ui`.**

It could not be committed because the pre-commit hook runs `nx affected --target=lint`
across 68 projects and a parallel session's untracked `libs/web/members` work fails lint
(4 errors, then 11). `tasks-ui` and `shared` lint clean throughout. `--no-verify` was
declined. **Retry the commit unchanged once that session's lint is green; do not reset the
index.** See _THE SECOND SHARED-TREE HAZARD_ for the durable finding.

## The one outstanding item — R10

**Not performed, not passed.** The palette shortcut has never been verified on a live host.
Carried against **Phase 6 sign-off**, not against any batch.

**What closes it — two minutes, both hosts**: open the Tasks board in the Extension
Development Host; press `Ctrl+K`; confirm the palette opens and VS Code does **not** enter
its chord state (no _"K was pressed, waiting for second key"_ in the status bar); repeat in
Electron. Also on that list: jsdom cannot synthesize an activation `click` from a synthetic
`keydown`, so the **positive** keyboard path is unproven by automation.

> **Standing note: `"keybindings": []` answers a different question and must not be cited as
> a pass.** It proves Ptah contributes no _conflicting_ binding. It says nothing about
> whether the workbench captures `Ctrl+K` as a chord prefix before the webview sees it.

## Four follow-up tasks

| Task            | Type    | What it carries                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TASK_2026_182` | —       | Runner coverage and test reliability                                                                                                                                                                                                                                                                                                                                                                                |
| `TASK_2026_183` | —       | Theme-token contrast; the `primary` / `primary-content` root cause                                                                                                                                                                                                                                                                                                                                                  |
| `TASK_2026_184` | BUGFIX  | `KeyboardNavigationService.configure()` clamps rather than resets. Live victim: `unified-suggestions-dropdown.component.ts:140` — configures from `suggestions().length` in an effect, never resets, owns a `resetFocus()` at `:268` it does not call. Type to narrow, press Enter, insert the wrong file. `native-autocomplete.component.ts` shares the risk. Any test there must narrow to **more than one** item |
| `TASK_2026_185` | FEATURE | C5 bulk labels (Batches 13–14). Explicit obligation: give `noop` a producer or delete it                                                                                                                                                                                                                                                                                                                            |

## Two structural notes for whoever reads this next

**1. There is no `task-bulk-bar.component.spec.ts`.** The bulk bar is covered by **151
assertions** across `tasks-view.component.spec.ts` (the wiring seam) and
`task-bulk-summary.component.spec.ts` (the banned-word sweep, bar in all three states).
That is defensible — the bar is presentational and its behaviour _is_ its wiring, tested at
the integration point where it matters — but **a reader looking for that file will not find
it**, and should not conclude the bar is untested.

**2. The eighth claim's carrier is the worst of the eight because it never touches the
tree.** This task produced eight claims that outran their evidence, across a comment, a test
name, a docblock, a fixture, a test harness, an orchestrator instruction, and finally a
**status report**. The report is the most dangerous of them: every earlier instance was
findable in the repository afterwards, so a gate or a reader could catch it. A false claim
in a report leaves **no artefact at all** — it can only be caught by someone going to look
for the thing that was said to exist. **A claim about work done is not the work.**

---

**Phases closed**: Phase 3 ✅ discharged for the pair (Batch 4 `2f7426bf0` + Batch 5 `c122d2441`).

**All three gating notes are now DISCHARGED** — G1 (SQLite suites were skipping, not
passing), G2 (`tasks:create` accepted-and-dropped the five metadata fields), G3 (five
divergent path-segment guards). Evidence at each note. Two new binding rules came out of
Batch 4: **BR-13** (run `npm run test:native` for SQLite work) and **BR-14** (do not copy
plan §5.1's guard sketch — see 🛑 PLAN DEFECT P1).

**Gates G1, G2 and G3 all still stand.** None was discharged by Batch 3 — it is a pure read
path that issues no write. **G2 and G3 both come due at Batch 4**, which is the first batch
that writes metadata a user can lose.
**cli_delegation**: **DISABLED** for this task. Every batch is a sub-agent
(`backend-developer` / `frontend-developer`). No CLI agent is to be spawned.

---

## 0. How to read this file

- `batches.md` is the canonical team-leader breakdown (`DOC_FILES`,
  `libs/shared/src/lib/types/task-spec.contract.ts:74`). `tasks.md` is
  `LEGACY_DOC_FILES` (line 87) — a **permanent read fallback that must never be newly
  authored**. `contract.guard.spec.ts` is a live CI ratchet on this.
- One batch = one developer pass = one review = one commit.
- **A batch pair (Na/Nb) shares a single phase acceptance gate.** The backend half going
  green is _not_ the phase gate. See [V-8](#v-8--five-phases-span-both-sides-risk-med).

---

## 1. Binding rules — every batch carries these

**Restated in full because a developer may read only their own batch. Violating any one of
these is an automatic review rejection.**

| #         | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BR-1**  | **Do NOT edit `ALLOWED_METHOD_PREFIXES`.** `'tasks:'` is already at `D:/projects/ptah-extension/libs/backend/vscode-core/src/messaging/rpc-handler.ts:84` — **verified by direct read**. `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts` already proves prefix coverage for every method in `RPC_METHOD_NAMES` _and_ `RPC_HANDLER_MANIFEST`, automatically, inside the gate (F1). Confirm; do not touch.                                                  |
| **BR-2**  | **Do NOT rely on the Nx boundary lint to prevent `tasks-ui → editor`.** The edge is _permitted_ and would pass silently. Ship the source ratchet `no-editor-dependency.spec.ts` (F2, Batch 10). `libs/frontend/editor/src/lib/quick-open/quick-open.component.ts` is prior art to **read**, never to import.                                                                                                                                                        |
| **BR-3**  | **Do NOT express frontmatter key removal as `patch.key = undefined`.** js-yaml cannot dump `undefined`. Use `updateFrontmatter`'s new `remove` option (F3, Batch 4).                                                                                                                                                                                                                                                                                                |
| **BR-4**  | **Do NOT give the saved-views setting a strict per-item Zod schema.** `BaseSettingsRepository.handleFor()` `safeParse`s the **whole** value and falls back to `default` — one bad entry would discard every view. Permissive `z.array(z.unknown())` in settings-core; per-item `SavedTaskViewSchema` at the RPC boundary (F4, Batch 8).                                                                                                                             |
| **BR-5**  | **`renderFrontmatterBlock` (`task-spec.contract.ts:222`) must not change.** Every new field is `string`, `boolean`, or `readonly string[]` precisely so it does not have to (NFR-3).                                                                                                                                                                                                                                                                                |
| **BR-6**  | **NO backfill. NO normalization** of existing carriers. `.ptah/**` is gitignored — there is no undo. `adoptFolder` and `registry-generator.service.ts` are **not touched**. A read-only board render writes nothing to disk.                                                                                                                                                                                                                                        |
| **BR-7**  | **Never emit** a per-task filename literal, or the strings `task-tracking/`, `.ptah/tasks/`, `specs/TASK_2025_`, into source — **including comments and fixtures**. The ratchet fails the build on them. Fixtures use `TASK_2026_*` ids only. Every filename flows from `DOC_FILES`.                                                                                                                                                                                |
| **BR-8**  | **`TaskStartService` is not touched, and the palette registers no run action.** Families (A) and (D) are out of scope. A reviewer rejects any diff to `task-start.service.ts` (R12).                                                                                                                                                                                                                                                                                |
| **BR-9**  | **Frontend libs MUST NOT import backend libs**; `libs/shared` is the only bridge. TypeScript 5.9 strict, `catch (error: unknown)`, Zod 4 at every boundary. Angular 21: `signal`/`computed`/`inject`, `ChangeDetectionStrategy.OnPush` mandatory, `track` on every `@for`, **no `[innerHTML]`**.                                                                                                                                                                    |
| **BR-10** | **Untrusted text** (labels, view names, executor values, palette entry labels) is rendered as `{{ interpolation }}` only — never `[innerHTML]`, never through `ptah-markdown-block`, never interpolated into a path, glob, `RegExp`, or RPC method name. Free-text filtering is case-insensitive `String.includes`, **not** a constructed regex (NFR-4, NFR-13).                                                                                                    |
| **BR-11** | **Folder name is the canonical id.** A mismatched `id:` in frontmatter is a WARNING, never auto-normalized. (`TASK_2026_176` declares `id: TASK_2026_178` on disk today — leave it.)                                                                                                                                                                                                                                                                                |
| **BR-13** | **The SQLite suites do NOT run under `nx test`** — `better-sqlite3` is built for Electron's ABI (143) and the system Node is ABI 137, so `persistence-sqlite` and `task-specs` **self-skip and still report green**. Run `npm run test:native` (added Batch 4) whenever you touch SQLite persistence, and quote its numbers — a plain `nx test` green is **not** evidence that SQL executed. Full rationale at ✅ GATING NOTE G1.                                   |
| **BR-14** | **Do NOT copy `implementation-plan.md` §5.1's `TaskIdRefSchema` sketch** — it ships the WEAK containment check that GATING NOTE G3 exists to eliminate. Import `TaskIdRefSchema` / `isSingleTaskPathSegment` from `libs/shared/src/lib/types/task-view.types.ts`. Likewise use `Object.values(p).some((v) => v !== undefined)` for "patch is non-empty", never §5.1's `Object.keys(p).length > 0` — Zod 4 keeps explicitly-`undefined` keys. See 🛑 PLAN DEFECT P1. |
| **BR-12** | **You do NOT create git commits.** The team-leader commits after `code-logic-reviewer` returns APPROVED. Focus 100% on code quality; a stub written to "finish faster" fails review.                                                                                                                                                                                                                                                                                |

---

## 2. Plan validation summary

**Validation status**: **PASSED WITH RISKS** — no blockers. The plan is unusually
well-investigated (F1–F4 already correct four stated mitigations). Eight items below;
five are verified-OK, three change how a batch is shaped.

### Assumptions verified against the live tree

| #       | Assumption                                                | Result                                                                                                    |
| ------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **V-4** | F1: `'tasks:'` already in `ALLOWED_METHOD_PREFIXES`       | ✅ **VERIFIED** — `rpc-handler.ts:84`. Zero edits needed.                                                 |
| **V-5** | F2: the Nx boundary lint cannot catch `tasks-ui → editor` | ✅ **VERIFIED, conclusion strengthened** — see below.                                                     |
| **V-6** | Migration slot `0031` is free                             | ✅ **VERIFIED** — highest on disk is `0030_skill_event_metrics`, registered at `migrations/index.ts:250`. |
| **V-7** | `batches.md` is canonical, `tasks.md` legacy              | ✅ **VERIFIED** — `task-spec.contract.ts:74` vs `:87`/`:101`.                                             |
| **V-9** | Every path in §1's 46-file inventory resolves             | ✅ **VERIFIED** — spot-checked 15 of the 30 modified files; all present.                                  |

**V-5 detail (a correction to F2's evidence, not to its conclusion).** The plan states
`libs/frontend/tasks-ui/project.json:7` is `["scope:webview","type:feature"]`. It is
actually `["scope:webview", "type:feature", "platform:angular"]` — tasks-ui carries a
**third** tag that `editor` lacks. This does **not** weaken F2; it strengthens it:
`eslint.config.mjs:83-84` lets `scope:webview` depend on `scope:shared`/`scope:webview`,
`type:feature → type:feature` is allowed at `:184-186`, and **there is no
`sourceTag: 'platform:angular'` constraint anywhere in `eslint.config.mjs`** — so the extra
tag adds no restriction at all. `tasks-ui → editor` passes lint **silently**. BR-2 stands.

### Risks identified

| #       | Risk                                                                                                                                       | Severity | Mitigation                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------ |
| **V-1** | Phase 0 is called "backend-only", but its ninth coordinated site is a **frontend** file, and Phase 0's own gate cannot detect its omission | **MED**  | Batch 1 includes it, constant-maps-only; Batch 1's gate is extended with `typecheck -p tasks-ui` |
| **V-2** | Phase 1 consumes `buildTaskGraph`, which Phase 2 creates — Phase 1 cannot meet its own gate as numbered                                    | **MED**  | **Execution order swapped**: Phase 2 → Batch 2, Phase 1 → Batch 3                                |
| **V-3** | §1.9's `apps/ptah-cli` work is in the file inventory but assigned to **no phase** in §7                                                    | **LOW**  | Assigned to Batch 6, beside the shared filter predicate it depends on                            |
| **V-8** | Five phases span backend **and** frontend, colliding with the never-mix rule                                                               | **MED**  | Split into paired batches; the phase gate is evaluated at the end of the **pair**                |

---

#### V-1 — Phase 0's ninth site is a frontend file _(RISK, MED)_

§11 and the orchestrator brief both call Phase 0 "backend-only". §7 Phase 0's own task list
ends with **"presentation maps"** — that is
`D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/task-presentation.ts`, a
**frontend** file.

This is not an oversight to route around. It is **R1's enforcement mechanism**:
`TASK_VALIDATION_CODE_LABELS` is keyed by a `Record<TaskValidationIssue['code'], string>`,
so the eight new backend-side codes **fail the `tasks-ui` typecheck** until each is
explained. That is the guarantee, working as designed.

The real defect is the **gate**. Phase 0's stated gate is
`nx run-many -t test -p shared task-specs persistence-sqlite` — which **does not include
`tasks-ui`**, and so would report green on a Phase 0 that left the frontend typecheck red.

**Mitigation, both halves applied:**

1. Batch 1 includes `task-presentation.ts`, scoped to **constant `Record`/array maps only**
   — no component edits, no template edits, no service edits. A `backend-developer` adding
   entries to a typed constant map is not frontend work.
2. **Batch 1's acceptance gate is extended** with `npx nx run-many -t typecheck -p tasks-ui`.
   Without this the R1 mechanism exists but never fires in the phase that needs it.

#### V-2 — Phase 1 depends on Phase 2 _(RISK, MED — execution order changed)_

§7 Phase 1's gate requires the detail panel to render "the five relation groups from
`TasksStore.graph()`" and the card to render a **child rollup**. Both read `TaskGraph`.
`buildTaskGraph` lives in `libs/shared/src/lib/types/task-graph.ts` (§1.1), which §7
**Phase 2** creates. As numbered, Phase 1 cannot meet its own gate.

**Mitigation — swap the execution order of Phases 1 and 2.** This violates no stated
sequencing constraint: the hard constraints are (a) Phases 0 and 3 precede frontend work,
(b) Phase 4 and Phase 6 precede Phase 7, (c) Phase 8 is the cut. Nothing pins Phase 1
before Phase 2. The swap also groups the backend work contiguously, matching §11's split.
No phase is merged and no phase content moves.

> **Orchestrator may veto.** The alternative is to build a throwaway minimal graph inside
> Phase 1 and discard it in Phase 2 — strictly worse.

#### V-3 — `apps/ptah-cli` is unassigned _(RISK, LOW)_

§1.9 lists `apps/ptah-cli/src/cli/commands/ptah-spec.ts` (+ its spec) as modified: `--json`
carries the new fields, and `list` accepts `--label` / `--estimate`. §7's nine phases never
name it. The `--json` half rides free on `TaskSpecSummary` from Batch 1; the two new flags
must fold into a `TaskFilterSpec` and go through the **shared** `filterTasks`, or FR-C1.5's
single-predicate claim is false on the CLI path. **Assigned to Batch 6.**

#### V-8 — five phases span both sides _(RISK, MED)_

Phases 3, 4, 5, 7 and 8 each contain backend and frontend work. The never-mix-developer-types
rule and §11's own split both require these to be separate passes. Each is split into an
`a` (backend) and `b` (frontend) batch.

**The phase acceptance gate from §7 belongs to the PAIR.** The `a` batch has its own
narrower exit criteria; the phase gate is asserted at the end of `b`. The orchestrator must
not read a green `a` batch as a discharged phase gate.

### Edge cases to handle — each traced to an owning batch

- [ ] Empty array ⇒ the key is **removed**, for `labels` / `duplicates` / `relates_to` — but `depends_on` is still written as `[]` (existing behaviour, do not "fix") → Batch 1 + Batch 4
- [ ] A carrier created with **no** metadata is byte-identical to a pre-change carrier (golden-string assertion) → Batch 1
- [ ] Hostile YAML labels round-trip: `needs:design`, `#urgent`, `2fa`, `-wip`, `no`, `trailing `, unicode → Batch 1
- [ ] Body preservation across BOM **and** CRLF → Batch 4
- [ ] Parent cycles of length 1 (self), 2, 3 and **200** all terminate → Batch 2
- [ ] Nested `TASK_*/TASK_*/task.md` is **never** indexed → Batch 2
- [ ] A metadata write to task A leaves every other carrier **byte-identical** → Batch 4
- [ ] One malformed saved view is skipped, `skipped: n` reported, the rest load; an unreadable settings file still renders the board → Batch 8
- [ ] The 50-view cap produces a clear message, not a silent truncation → Batch 8/9
- [ ] A view naming a vanished label/executor still applies, matches nothing, and is annotated — **nothing is auto-pruned** → Batch 9
- [ ] Bulk cancel is **chunk-granular**; already-issued writes completed and were not reversed, said verbatim → Batch 12
- [ ] `> 10` selection requires confirmation naming the count **and** the target status → Batch 12
- [ ] The words _atomic_, _transactional_, _all-or-nothing_ appear in **no** rendered text → Batch 12
- [ ] A card with none of the five new fields is **pixel-identical** to today's card → Batch 3
- [ ] The palette shortcut is ignored inside `<input>` / `<textarea>` / `[contenteditable]` → Batch 10

---

## 3. Verification gate (§9) — carried verbatim

Run the NFR-14 command **exactly as specified** and record its output:

```bash
npx nx run-many -t typecheck,test,lint -p shared task-specs rpc-handlers \
  tasks-ui vscode-core platform-core platform-vscode platform-electron \
  platform-cli skill-synthesis cli-engine vscode-lm-tools ptah-cli
```

Then run the **recommended superset** (addition, _not_ a substitution) — this task also
modifies `settings-core` and `persistence-sqlite`, neither of which is in the NFR-14 list:

```bash
npx nx run-many -t typecheck,test,lint -p shared task-specs rpc-handlers \
  tasks-ui vscode-core platform-core platform-vscode platform-electron \
  platform-cli skill-synthesis cli-engine vscode-lm-tools ptah-cli \
  settings-core persistence-sqlite
```

`vscode-lm-tools` and `ptah-cli` are in the list deliberately — the TASK_2026_179 gate
omitted both, and a broken `vscode-lm-tools` mock slipped through because of it.

> ### Known pre-existing failure — report, never "fix"
>
> `apps/ptah-cli` carries a test asserting coloured output "by default" that **fails when
> `NO_COLOR` is set in the environment**. It is **pre-existing and unrelated to this task**.
> Report it explicitly as pre-existing in the batch report. Do **not** absorb it silently,
> and do **not** repair it as drive-by scope (NFR-15).

**Manual gates — no automated harness covers these.** Required once each, on the batch named:

- **Batch 10 (R10)**: the palette shortcut is verified on **VS Code and Electron** and
  steals nothing from the host.
- **Batch 3 (R15)**: a visual check that the `LABEL_CHIP_CLASSES` palette meets ≥ 4.5:1
  text contrast in **both** the light and dark VS Code themes.

---

## 4. Batch map

| #   | Phase | Name                                               | Executor | Tasks | Depends on |
| --- | ----- | -------------------------------------------------- | -------- | ----- | ---------- |
| 1   | 0     | Contract ratchet + the nine coordinated sites      | backend  | 12    | —          |
| 2   | 2     | Derived graph + cross-file validation              | backend  | 5     | 1          |
| 3   | 1     | B read path, end to end                            | frontend | 5     | 1, 2       |
| 4   | 3a    | The single write path (backend)                    | backend  | 6     | 1          |
| 5   | 3b    | Metadata editor + client write serialization       | frontend | 4     | 3, 4       |
| 6   | 4a    | Shared filter predicate + list parity + CLI flags  | backend  | 5     | 1, 2       |
| 7   | 4b    | Filter bar, sorting, filtered-empty state          | frontend | 5     | 3, 6       |
| 8   | 5a    | Saved-views storage + RPC (backend)                | backend  | 5     | 6          |
| 9   | 5b    | Saved-views menu (frontend)                        | frontend | 3     | 7, 8       |
| 10  | 6     | Command palette + board keyboard nav + R11 ratchet | frontend | 6     | 7, 9       |
| 11  | 7a    | Bulk status (backend)                              | backend  | 4     | 4          |
| 12  | 7b    | Bulk status (frontend) — **highest risk**          | frontend | 6     | 10, 11     |
| 13  | 8a    | Bulk labels (backend) — **P2 CUT**                 | backend  | 2     | 11         |
| 14  | 8b    | Bulk labels (frontend) — **P2 CUT**                | frontend | 2     | 12, 13     |

**Execution Mode is `sequential` for all 14 batches.** No batch passes the parallel-eligible
checklist: every batch converges on at least one shared mutable file — `libs/shared/src/index.ts`,
`libs/frontend/tasks-ui/src/index.ts`, `tasks-store.service.ts`, `rpc.types.ts`, or
`tasks-rpc.handlers.ts` — so the tasks are not file-disjoint.

**Fallback Executor** is `general-purpose` throughout. With `cli_delegation` disabled there
is no second specialist of either type; `general-purpose` is a capability fallback only, and
a batch that falls back must be reviewed with the same `code-logic-reviewer` gate.

---

# Batch 1 — Phase 0: contract ratchet + the nine coordinated sites ✅ COMPLETE

**Commit**: `3e93069fd` — `feat(vscode): batch 1 — task metadata contract ratchet across nine sites`
**Reviewer verdict**: `code-logic-reviewer` — APPROVED WITH CONCERNS, no blocking issues
(`code-logic-review.md`). All four reviewer-directed fixes landed and were re-verified.
**Gating notes G1, G2, G3 are NOT discharged by this commit.**

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `general-purpose`
**Execution Mode**: `sequential` — Task 1.1 **must** land before 1.2–1.12 (R1)
**Rationale**: One atomic contract change across nine sites. R1 is the highest-consequence
structural risk in the plan: a field that lands at eight of nine sites is **silent data
loss**, not a compile error. Splitting this batch would put a knowingly-red ratchet through
a review gate. **Oversized by design (12 tasks vs the usual 3–5) — this is deliberate and
must not be "optimized" into two commits.**
**Tasks**: 12 | **Dependencies**: none

### Task 1.1 — Extend `contract.guard.spec.ts` Duty 4 **FIRST** ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/backend/task-specs/src/lib/contract.guard.spec.ts`
Round-trip matrix over every new field × {absent, empty, single, many, quoted-scalar}, across
the 48 status × type pairs **with** metadata. Add a `HOSTILE_LABELS` table: `needs:design`,
`#urgent`, `2fa`, `-wip`, `no`, `trailing ` (trailing space), unicode. Assert empty ⇒ the key
is **absent from the rendered text** _and_ `[]` after parse. Assert a no-metadata carrier is
byte-identical to a golden pre-change string.
**This test is written and RED before Task 1.2 begins** (R1, plan §11 item 6). BR-7 applies
to every fixture id.

### Task 1.2 — Shared types ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/shared/src/lib/types/task-spec.types.ts`
`TASK_ESTIMATES = ['XS','S','M','L','XL'] as const` + `TaskEstimate`, beside
`TASK_STATUSES`/`TASK_TYPES`. **Tuple order is the sort order**; no numeric mapping exists
anywhere. Five new fields on `TaskSpecSummary` (`labels`, `estimate?`, `parent?`,
`duplicates`, `relatesTo`). Eight new codes on `TaskValidationIssue['code']` (union at :41):
`invalid_estimate | invalid_labels | invalid_parent | dangling_parent | parent_cycle |
parent_depth_exceeded | invalid_relation | dangling_relation`.

### Task 1.3 — Contract emitter ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/shared/src/lib/types/task-spec.contract.ts`
`RenderTaskMdInput` gains five optional fields; `renderTaskMd`'s hand-ordered field list
(≈ :257) gains five **omitted-when-empty** entries in the order
`… description?, executor?, parent?, estimate?, labels?, duplicates?, relates_to?,
status_inferred?`. **BR-5: `renderFrontmatterBlock` (:222) is not modified.** `yamlScalar`
(:215) already handles every hostile case — **no emitter change** (plan §2.3).

### Task 1.4 — Frontmatter schema ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/backend/task-specs/src/lib/task-frontmatter.ts`
`TaskFrontmatterSchema` (:30) gains `labels`, `estimate`, `parent`, `duplicates`,
`relates_to`, all `.nullish()`.

### Task 1.5 — Frontmatter **manual lift** + per-field issues ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/backend/task-specs/src/lib/task-frontmatter.ts` (:243–270)
The manual lift is the half that actually decides what reaches `TaskSpecSummary` — a schema
edit alone changes nothing. One block per field, following the `depends_on` shape at
:195–223. **Present-but-malformed ⇒ warning + safe default, never exclusion** (NFR-11).
Per plan §2.4: `invalid_labels`→`[]`; `invalid_estimate`→ leave `undefined`, **name the raw
value in the message**; `invalid_parent`; `invalid_relation` naming the field.
`knownFolders` is supplied **only** by the scanner — a single-file reparse skips the dangling
checks. That is the existing deliberate contract at :96–109; **do not change it.**
Duplicate entries inside one relation array are **not** rewritten out of the file (FR-B4.8).

### Task 1.6 — Migration `0031` + spec ✅ COMPLETE

**Files**:

- `D:/projects/ptah-extension/libs/backend/persistence-sqlite/src/lib/migrations/0031_task_specs_metadata.ts`
- `D:/projects/ptah-extension/libs/backend/persistence-sqlite/src/lib/migrations/0031_task_specs_metadata.spec.ts`

Five `ALTER TABLE task_specs ADD COLUMN` + `CREATE INDEX IF NOT EXISTS idx_task_specs_ws_parent
ON task_specs (workspace_root, parent)`. Exact SQL in plan §2.6. Pattern copied verbatim
from `0028_gateway_conversation_workspace_root.ts`.
**SECURITY: the SQL MUST stay static — no `${...}` interpolation.** Forward-only, no backfill
(BR-6). `ADD COLUMN IF NOT EXISTS` does not exist in SQLite; `schema_migrations` bookkeeping
guarantees once-only execution. **The reserved `claim` column is not repurposed.**
Spec applies onto a 0029-shaped table and asserts pre-existing rows survive with defaults.

### Task 1.7 — Register migration 31 ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/backend/persistence-sqlite/src/lib/migrations/index.ts`
Import + append `{ version: 31, name: '0031_task_specs_metadata', sql: … }` after version 30
(:250). **Verified: 30 is the current maximum; slot 31 is free.**

### Task 1.8 — Index store, five columns ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/backend/task-specs/src/lib/task-index.store.ts`
Five entries each in `RawTaskRow` (:132), `insertSql` (:262), the `ON CONFLICT … DO UPDATE`
list, `insertParams` (:299), `rowToSummary` (:324). **`cloneSummary` (:122) must clone the
three new arrays** or the in-memory store hands out shared references.

### Task 1.9 — Store parity spec ✅ COMPLETE _(authored; SQLite half SKIPPED, not passed — G1 stands)_

**File**: `D:/projects/ptah-extension/libs/backend/task-specs/src/lib/task-index.store.spec.ts`
Five-column round trip through **both** store impls (NFR-11).

### Task 1.10 — RPC + create-path types ✅ COMPLETE _(G2 and G3 both trace here)_

**Files**:

- `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-tasks.types.ts`
- `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.schema.ts`

`TasksCreateParamsSchema` gains the five metadata fields. The five fields ride onto every
existing result for free via `TaskSpecSummary`. **No new method in this batch.**

### Task 1.11 — MCP agent path ✅ COMPLETE

**Files**:

- `D:/projects/ptah-extension/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/tasks-namespace.builder.ts` (`TaskCreateArgsSchema`, :124)
- `D:/projects/ptah-extension/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts` (`ptah_task_create` / `ptah_task_list` JSON-Schema + prose; `buildTaskListTool` :121, `buildTaskGetTool` :101)

### Task 1.12 — Presentation constant maps _(the one frontend file — see V-1)_ ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/task-presentation.ts`
Add `TASK_ESTIMATE_LABELS` and `TASK_VALIDATION_CODE_LABELS` — a
`Record<TaskValidationIssue['code'], string>` covering all eight new codes.
**Scope: typed constant maps ONLY.** No component, template, or service edits — those are
Batch 3. This file is in Batch 1 because the eight new codes make the `tasks-ui` typecheck
**red** until each is explained; that is R1's mechanism, not a scope leak.

**Batch 1 Verification** _(§7 Phase 0 gate, extended per V-1)_:

```bash
npx nx run-many -t test -p shared task-specs persistence-sqlite
npx nx run-many -t typecheck -p tasks-ui        # ← added per V-1; the stated gate misses this
```

- The round-trip matrix covers every new field × {absent, empty, single, many, quoted}
- A carrier written with **no** metadata is byte-identical to a pre-change carrier
  (golden-string assertion)
- `renderFrontmatterBlock` shows **zero** diff (BR-5)

**Team-leader verification (independent re-run):** both gate commands reproduced with
`--skip-nx-cache`. `test -p shared task-specs persistence-sqlite` → shared 515/515,
task-specs 269 passed + 16 skipped, persistence-sqlite 80 passed / **65 skipped, 8 suites
skipped**. `typecheck -p tasks-ui` → green. BR-1, BR-5, BR-6, BR-7 confirmed by direct diff
inspection; `renderFrontmatterBlock`, `yamlScalar`, `isPlainSafeScalar` and `toOneLine`
bodies are byte-identical to `HEAD`.

> ### ✅ GATING NOTE G1 — DISCHARGED at the Batch 4 gate _(team-leader, independently reproduced)_
>
> **Resolved. The suites now run and pass; no later batch needs to rediscover this.**
>
> The cause was never a broken build — it was the runner. `better-sqlite3` is rebuilt by
> `postinstall` against **Electron's** ABI (143) because Electron is where it runs in
> production; the repo's system Node is v24.15.0, which is **ABI 137**. Electron's own
> bundled Node is also ABI 143, so running the _same Jest config_ through Electron in
> node mode loads the addon **exactly as it already is on disk**.
>
> **The standing invocation — use this, do not re-diagnose G1 a fourth time:**
>
> ```bash
> npm run test:native                        # persistence-sqlite + task-specs
> npm run test:native -- persistence-sqlite  # one project
> npm run test:native -- task-specs -t 'rowToSummary'
> ```
>
> Added in Batch 4 as `scripts/test-native.mjs` + one `package.json` line. It is a Node
> script rather than an inline `ELECTRON_RUN_AS_NODE=1 electron …` because that is POSIX
> shell syntax and `npm run` uses `cmd.exe` on Windows; `cross-env` would paper over it but
> is only a **transitive** dependency here. **No existing script's behaviour changed.**
>
> **Team-leader reproduction (not taken on report).** Verified `process.versions.modules`
> = 137 under `node`, 143 under electron-as-node. Then:
>
> |                      | plain node (ABI 137)                              | `npm run test:native` (ABI 143)             |
> | -------------------- | ------------------------------------------------- | ------------------------------------------- |
> | `persistence-sqlite` | 8 suites **skipped**, 65 tests skipped, 10 passed | **18/18 suites, 145/145 passed, 0 skipped** |
> | `task-specs`         | 17 skipped                                        | **14/14 suites, 361/361 passed, 0 skipped** |
>
> **Nothing on disk was modified to achieve it.** `better_sqlite3.node`,
> `bin/win32-x64-143/better-sqlite3.node` and `test_extension.node` were SHA-256 hashed
> before the first Electron run and again after six of them: **byte-identical, mtimes
> unchanged (2026-07-15, the original `postinstall` build)**. The plain-node run still
> skips _exactly_ as it did before — the baseline is intact, so this is an added way to run
> the suites, not a mutation of the environment.
>
> `SqliteTaskIndexStore`'s 21-placeholder `INSERT`, its `ON CONFLICT … DO UPDATE` list and
> `rowToSummary` have now **executed and passed**. Batch 1's SQLite half is verified.
>
> <details><summary>Original note (kept for provenance)</summary>
>
> ### ⚠️ GATING NOTE G1 — the SQLite half of Batch 1 is UNVERIFIED, not verified
>
> `0031`'s behaviour suite and `SqliteTaskIndexStore`'s metadata round-trip / parity block
> were **SKIPPED, not passed**: `better-sqlite3` on disk is built for Electron ABI 143 and
> the Jest runner is Node ABI 137. The skip is **pre-existing** — the header of
> `task-index.store.spec.ts` already documented it before this batch — so it is not a
> regression and is **not grounds to reject Batch 1**. It is grounds to refuse to _record_
> Batch 1 as SQLite-verified.
>
> What is actually proven today: migration `0031`'s registry entry (version, name, static
> SQL, not vec-gated) runs in-suite and passes, and the developer applied the DDL
> out-of-band against Node's built-in SQLite engine (clean apply onto a 0029 table, legacy
> row survives with `'[]'`/`NULL` defaults, `idx_task_specs_ws_parent` created, second exec
> throws `duplicate column name: labels`). That is credible evidence for the DDL and **no
> evidence at all** for `SqliteTaskIndexStore`'s five-column mapping — the 21-placeholder
> `INSERT`, the `ON CONFLICT` list and `rowToSummary` have never executed.
>
> **Discharge condition.** This note is cleared only by a run of
> `npx nx test persistence-sqlite task-specs` on a runtime where the native module loads,
> with the 8 skipped suites reported as **passed**. Until then no later batch may cite
> "Batch 1 green" as evidence that SQLite metadata persistence works. The environment fix
> is QA's, tracked at the Batch 4 gate at the latest — Batch 4 is the first batch that
> writes metadata a user can lose.
>
> </details>

> ### ✅ GATING NOTE G2 — DISCHARGED at the Batch 4 gate _(team-leader verified)_
>
> Both call sites wire the five fields through, confirmed by direct diff read:
>
> - **RPC** — `tasks-rpc.handlers.ts:311` `registerCreate` maps `labels`, `estimate`,
>   `parent`, `duplicates`, `relatesTo` **explicitly** (not by spread), so a sixth field
>   added later and forgotten is visible at the call site rather than silently dropped.
> - **MCP** — `TaskSpecWriterLike.create`'s input type widened to declare the five, and
>   `buildTasksNamespace.create` passes `parsed.data` through.
> - **Writer** — `CreateTaskInput` carries them and `TaskWriterService.create` maps them
>   into `renderTaskMd`, again explicitly.
>
> Round-tripped on both paths at the call boundary _and_ against a real carrier on disk
> (`raw` contains `labels:`, `needs:design`, `estimate: L`). A create supplying **no**
> metadata still writes none of the five keys, so pre-existing carriers are unaffected.
>
> **One scope addition beyond the note, accepted:** `TasksCreateParamsSchema.labels` and
> `TaskCreateArgsSchema.labels` now use the shared `LabelSchema` + `MAX_LABELS_PER_TASK`
> cap. Without it, `create` could plant 40 labels that `tasks:updateMetadata` would then
> refuse to edit — a hole beside the boundary rather than a boundary.
>
> <details><summary>Original note (kept for provenance)</summary>
>
> ### ⚠️ GATING NOTE G2 — `tasks:create` accepts-and-drops until Batch 4
>
> `TasksCreateParamsSchema` and `TaskCreateArgsSchema` both validate the five metadata
> fields as of Task 1.10/1.11, but `TaskWriterService.CreateTaskInput` does not carry them
> until Task 4.3, and `TasksRpcHandlers.registerCreate` (`tasks-rpc.handlers.ts:303`) maps
> its fields **explicitly**. A `tasks:create` call carrying `labels` therefore validates
> successfully and **silently discards them today**. This is the plan's stated staging
> (§1 file inventory: "`CreateTaskInput` gains the five fields", Batch 4 Task 4.3), not a
> Batch 1 defect — but it is precisely R1's failure shape and it is a **silent** one.
>
> **Batch 4 is not complete until `registerCreate` and the MCP `create` handler pass the
> five fields through.** Task 4.3 widens the input type; nothing in Batch 4's stated task
> list wires the two call sites. Add that wiring to Task 4.3's scope and assert it in Task
> 4.6 — a create-with-labels round trip through **both** the RPC and MCP paths.
>
> </details>

> ### ✅ GATING NOTE G3 — DISCHARGED at the Batch 4 gate, and WIDENED _(team-leader verified)_
>
> **There is now exactly ONE implementation.** `isSingleTaskPathSegment` +
> `TaskIdRefSchema` live in `libs/shared/src/lib/types/task-view.types.ts`; every boundary
> consumes it. `task-frontmatter.ts` keeps the local name via
> `const isSinglePathSegment = isSingleTaskPathSegment` — an alias, so its call sites and
> behaviour are unchanged.
>
> The note named **three** guards. The developer hardened **five**, and was right to:
>
> | #   | Guard                                  | File                         | In original note?                     |
> | --- | -------------------------------------- | ---------------------------- | ------------------------------------- |
> | 1   | `taskIdRef`                            | `tasks-rpc.schema.ts`        | yes                                   |
> | 2   | `taskIdSchema`                         | `tasks-namespace.builder.ts` | yes                                   |
> | 3   | `TasksAdoptParamsSchema.folderName`    | `tasks-rpc.schema.ts`        | yes                                   |
> | 4   | `TasksUpdateStatusParamsSchema.taskId` | `tasks-rpc.schema.ts`        | **no — was bare `z.string().min(1)`** |
> | 5   | `TasksGetParamsSchema.taskId`          | `tasks-rpc.schema.ts`        | **no — was bare `z.string().min(1)`** |
>
> 4 and 5 were joined onto the spec root just as the other three are. Hardening three of
> five would have recreated the exact divergence this note exists to end.
>
> Plus **defence in depth at the funnel**: `TaskWriterService.updateMetadata` re-checks
> `taskId` and `parent` itself before `applyFrontmatterPatch` joins them onto a path. Every
> boundary above it already rejects a non-segment value, so this is a backstop — but it is
> the one method every carrier write passes through.
>
> **Rejection-table coverage verified by direct read.** The canonical 11-row table
> (`contract.guard.spec.ts:764`) is replicated verbatim — same 11 rows, same labels — in
> `tasks-rpc.handlers.spec.ts:733` and `tasks-namespace.builder.spec.ts:100`, driving:
> `tasks:updateMetadata` (taskId), `tasks:updateStatus`, `tasks:adopt`, `tasks:create`
> (parent), **`tasks:updateMetadata` relation-array entries** (`patch: { relatesTo: [v] }`),
> `ptah_task_get`, `ptah_task_update`, `ptah_task_create` (parent **and** relation array).
> Every RPC case asserts the writer was **not called** — rejection, not a write that fails
> later. Relation entries are guarded at both boundaries via `TASK_METADATA_PATCH_SHAPE`,
> which uses `TaskIdRefSchema` for `parent`, `duplicates`, `relatesTo` and `dependsOn`.
>
> **Widened again after review — the ADS colon gap.** `code-logic-reviewer` found that the
> drive-letter regex `/^[A-Za-z]:/` missed NTFS **alternate-data-stream** syntax
> (`TASK_2026_100:stream`). It live-tested it as **not exploitable against any current call
> site** — every consumer appends a further path segment after the guarded value — but
> non-exploitability was a property of _today's callers_, not of the guard, and Batch 5
> onward adds callers. Closed anyway.
>
> The fix **replaces** `/^[A-Za-z]:/` with `trimmed.includes(':')` rather than adding a
> second check: the regex would become unreachable behind the broader test, and dead code
> beside a live check is how a later reader concludes one of the two is wrong. `C:` and
> `C:TASK_2026_100` still reject — now via the colon test — and their table rows still pass.
>
> **All three rejection tables are now 12 rows**, verified by direct count:
> `contract.guard.spec.ts:774`, `tasks-rpc.handlers.spec.ts:744`,
> `tasks-namespace.builder.spec.ts:111`. The third of those is a **Batch 1 file** and the
> reach-back was checked against `3e93069fd`: **exactly one inserted line (+1/−0)**. Leaving
> that table at 11 rows would have made the tables disagree about what the shared guard
> rejects — the precise drift G3 existed to end. A stale "the last five are the ones the
> previous local check let through" comment was replaced in all three with one that _names_
> the excluded shapes rather than counting them.
>
> _Minor, accepted:_ `folderName`'s rejection message is now the shared
> `'a task id must be a single path segment'` rather than `'folderName must be …'`. No test
> asserts the old text.
>
> **Post-fix gate, team-leader re-ran uncached:** shared 515 (26 suites); task-specs **345**
> passed / 17 skipped (14); vscode-lm-tools **727** (36); rpc-handlers **1522** passed / 4
> skipped (70). `npm run test:native` → persistence-sqlite 18/18 & 145/145; task-specs 14/14
> & **362/362**; **both 0 skipped** — confirming the `libs/shared` guard change propagated
> into `task-specs` cleanly.
>
> <details><summary>Original note (kept for provenance)</summary>
>
> ### ⚠️ GATING NOTE G3 — three write-path guards still do the WEAK check _(owner: Batch 4)_
>
> Batch 1 hardened `isSinglePathSegment` (`task-frontmatter.ts`) after review: it now
> compares `value.trim()`, and rejects whitespace-only, embedded NUL, and a Windows
> drive prefix (`C:`, and the drive-**relative** `C:TASK_2026_100`, which escapes a join
> while containing no separator anywhere in the string).
>
> **Three parallel guards were deliberately NOT hardened** and still run the original
> `!includes('/') && !includes('\\') && !== '..'` test, so all three accept `" .. "`,
> `"   "`, `"C:"`, `"C:NAME"` and an embedded NUL:
>
> | Guard                               | File                                                                | Origin                             |
> | ----------------------------------- | ------------------------------------------------------------------- | ---------------------------------- |
> | `taskIdRef`                         | `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.schema.ts:30` | **added by this batch, Task 1.10** |
> | `taskIdSchema`                      | `.../namespace-builders/tasks-namespace.builder.ts:119`             | pre-existing                       |
> | `TasksAdoptParamsSchema.folderName` | `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.schema.ts:95` | pre-existing                       |
>
> These are the **write-path counterparts** of the guard hardened in Batch 1. Leaving them
> is correct for now on two grounds: **none is exploitable in this diff** — nothing joins
> these values onto a filesystem path until the write path exists — and hardening only
> `taskIdRef` because it happens to be new would leave two divergent guards doing the
> weaker check, which is exactly the silent divergence this note exists to prevent.
>
> **Discharge condition. Batch 4 is not green until all three match `isSinglePathSegment`'s
> behaviour and carry the same rejection test table** (the 11-row `REJECTED_PARENTS` table
> in `contract.guard.spec.ts:764`). Batch 4 is where these first gain a real path-join
> consumer, so it is the last batch at which this is a hardening exercise rather than a
> vulnerability. Prefer promoting one shared guard over `Task 4.4`'s `TaskIdRefSchema` to
> re-implementing the check a fourth time.
>
> </details>

> ### 🛑 PLAN DEFECT P1 — `implementation-plan.md` §5.1 ships the WEAK guard. DO NOT COPY IT.
>
> **Any batch that reaches for plan §5.1 as a reference must ignore its `TaskIdRefSchema`
> sketch.** `implementation-plan.md:622-624` reads:
>
> ```ts
> const TaskIdRefSchema = z
>   .string()
>   .min(1)
>   .refine((v) => !v.includes('/') && !v.includes('\\') && v !== '..', 'a task id must be a single path segment');
> ```
>
> That is **the very check G3 was raised to eliminate**, sitting inside G3's own designated
> fix. Implemented verbatim it accepts `" .. "`, `"   "`, `"C:"`, the drive-relative
> `"C:NAME"` and an embedded NUL — and it would have propagated the weak check to all five
> boundaries at once _while appearing to discharge the note_.
>
> Batch 4 correctly deviated and used `isSingleTaskPathSegment`. **The authority is
> `libs/shared/src/lib/types/task-view.types.ts`, never the plan sketch.** No later batch
> may re-derive this guard from §5.1 — import the shared one.
>
> **Second deviation from §5.1, also correct.** The plan specifies
> `.refine((p) => Object.keys(p).length > 0)`. Zod 4 **keeps an explicitly-`undefined`
> optional key in its output**, so `{ labels: undefined }` has a key count of 1, passes that
> refinement, reaches `updateFrontmatter`, refreshes `updated` and rewrites a carrier the
> caller asked not to change — in a gitignored file with no undo. Batch 4 used
> `Object.values(patch).some((v) => v !== undefined)`. Use that shape anywhere else a
> "non-empty patch" check is needed.

---

# Batch 2 — Phase 2: derived graph + cross-file validation ✅ COMPLETE

**Commit**: `7cadd50` — 11 files, no foreign paths. All hooks passed (lint-staged,
electron validate-deps, commitlint); nothing bypassed.

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `general-purpose`
**Execution Mode**: `sequential`
**Rationale**: Pure algorithmic work in `libs/shared` plus two backend consumers. Runs
**before** Phase 1 per [V-2](#v-2--phase-1-depends-on-phase-2-risk-med) — Phase 1's card
rollup and relation groups read the graph this batch creates.
**Tasks**: 5 | **Dependencies**: Batch 1

### Task 2.1 — `task-graph.ts` ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/shared/src/lib/types/task-graph.ts` _(create)_
`buildTaskGraph`, `TaskGraph`, `TaskChildRollup`, `deriveCrossFileIssues`, `labelKey`,
`labelColorIndex`. **Zero-dependency module** — the backend scanner and `tasks-ui` run
identical code (NFR-7).

- **Parentage, pass 1**: three-colour marking, **explicit stack, no recursion**. Iterate
  sorted by id for determinism. Termination is proved by per-node colour monotonicity
  (plan §4.1) — **not** by a depth cap. Do not add one.
- **Pass 2**: effective parent by the precedence table in §4.1 (cycle → `parent_cycle`;
  not in `byId` → `dangling_parent`; grandparent → `parent_depth_exceeded` **on the child
  making the invalid claim**; both tasks stay on the board).
- **Inverses**: one pass, **no traversal**, self-edges filtered, every set de-duplicated on
  insert. `related` is the symmetric closure computed from one authored side only (D3).
- **Ordering is deterministic**: authored entries first in authored order, then derived in
  id-sorted order — this is what lets the UI distinguish authored from derived (FR-B4.9).
- `labelKey = raw.trim().toLowerCase()`, used for matching, the union, **and** the colour
  hash (FNV-1a 32-bit) so `Licensing` and `licensing ` are one label with one colour (R9).
- `knownLabels`: the **exported field is `readonly string[]`** (plan §4 interface), the
  canonical display texts in first-seen order. A first-seen-wins
  `Map<labelKey, canonicalDisplayText>` is the **internal build mechanism** only (plan §4.3)
  and is never exposed. **No registry file.**
  _(Corrected by team-leader at the Batch 2 gate: the earlier wording here named the Map as
  the field's type, contradicting plan §4. The plan is authoritative; Batch 5's
  label-completion UI consumes a `readonly string[]` — see plan §5 `knownLabels = computed(
  () => this.graph().knownLabels)`.)_
  **Nothing in this module may produce a write** (FR-B3.2 is structural).

### Task 2.2 — Export the module ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/shared/src/index.ts`
Add `export * from './lib/types/task-graph';` beside the existing lines 28–29.

### Task 2.3 — Scanner merges cross-file issues ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/backend/task-specs/src/lib/task-scanner.service.ts`
After the parse loop (:100–108 — was cited as :84–92 before Batch 1 added imports), run
`deriveCrossFileIssues` over the scanned set, merge
`parent_cycle` / `parent_depth_exceeded` back onto each task, and **recompute
`frontmatterValid`** — all **before** `replaceWorkspace`, so the index row is self-describing.

### Task 2.4 — Doctor: read-only warnings ✅ COMPLETE

**Files**:

- `D:/projects/ptah-extension/libs/backend/task-specs/src/lib/task-doctor.service.ts` (`DoctorWarning['code']`, :99)
- `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-tasks.types.ts` (`TasksDoctorWarning['code']`, :224 — was cited as :208 — widen in lockstep)

Four new codes: `dangling_parent | parent_cycle | parent_depth_exceeded | dangling_relation`.
**NO new `DoctorAction` kind** — the `assertNever` guard at `tasks-rpc.handlers.ts:120` must
never be tripped, so no "normalize metadata" apply path can ever exist (BR-6, R4).

### Task 2.5 — Graph + scanner specs ✅ COMPLETE

**Files**:

- `D:/projects/ptah-extension/libs/backend/task-specs/src/lib/task-graph.spec.ts` _(create)_
- `D:/projects/ptah-extension/libs/backend/task-specs/src/lib/task-scanner.service.spec.ts`

Fixtures: self-reference, 2-cycle, 3-cycle, **200-cycle**, diamond, dangling, depth-3;
mutual and self `relates_to`/`duplicates`/`depends_on`. **Each wrapped in a 2 s Jest
timeout** and asserted on its issue code (R8). Scanner spec: `TASK_A/TASK_B/task.md` ⇒
`TASK_B` is **not** indexed and `TASK_A` is `excluded: 'no_carrier'`. That test **freezes**
an already-true flat contract (R3) — it does not implement one.

**Batch 2 Verification** _(§7 Phase 2 gate)_:

- ✅ `task-graph.spec.ts` green over every fixture; **every case terminates** — 28 tests,
  200-cycle case included. Verified by team-leader, uncached.
- ✅ In-memory and SQLite stores return **identical** graphs — **NOW VERIFIED.** The
  assertion lives in `task-index.store.spec.ts` inside the existing
  `(Database ? it : it.skip)` gate and was **SKIPPED, not passed**; team-leader confirmed
  all **17** `task-specs` skips were in that one file (the `better-sqlite3`
  Electron-ABI-143 / Node-ABI-137 gate). **Discharged at the Batch 4 gate:** under
  `npm run test:native` the file runs and `task-specs` reports **14/14 suites, 361/361
  passed, 0 skipped**. See ✅ GATING NOTE G1.
- ✅ `npx nx run-many -t typecheck,test,lint -p shared task-specs` — team-leader re-ran
  uncached: shared 515/515 (26 suites); task-specs 314 passed / 17 skipped (13 suites);
  typecheck green on `shared task-specs rpc-handlers tasks-ui`.
  _(`persistence-sqlite` is named in the plan's gate line but its store coverage is exactly
  what G1 quarantines; it cannot discharge anything while the ABI gate holds.)_

**Batch 2 round 2** — REJECTED by `code-logic-reviewer`, fixed, re-verified by team-leader.

The blocking defect was real: `mergeCrossFileIssues` keyed de-duplication on `(code, field)`,
which is not an identity for the **array-valued** relation fields. One `relates_to` array with
two distinct bad entries — one parser-caught, one graph-caught — collapsed to one key and the
second finding was dropped with no other route to the board. Fix: `TaskValidationIssue` gained
an optional `ref?: string` naming the offending entry; the key is now `(code, field, ref)`.

Inventory grew **9 → 11**. Two files new to the batch:

- `libs/shared/src/lib/types/task-spec.types.ts` — `ref?: string`, **optional**, so no
  existing construction site breaks.
- `libs/backend/task-specs/src/lib/task-frontmatter.ts` — **reaches back into Batch 1's
  committed work (`3e93069fd`)**. Team-leader diffed it against that commit directly: it is
  **5 insertions, 0 deletions**, every one a `ref:` line appended to an existing issue
  literal, all inside `liftRelationArray` and `parseTaskFile`. The claim holds.

**BR-5 re-confirmed after that edit**: all five hunks land before `updateFrontmatter` (:524);
the emitter is untouched, and `validationIssues` is referenced nowhere in the emitter path —
so `ref` can never reach frontmatter. It is derived data, read-only, one direction.

**No migration is required — claim VERIFIED, not taken on trust.** `validation_issues` is a
single `TEXT NOT NULL DEFAULT '[]'` column from migration `0029_task_specs.ts`. The store
writes `JSON.stringify(task.validationIssues ?? [])` and reads `JSON.parse(...)` cast whole —
**no field-by-field reconstruction anywhere**, which is what would have silently dropped
`ref`. `cloneSummary` spreads (`{ ...i }`), so the in-memory store preserves it too.
`task-index.store.ts` has **zero diff** and the highest migration is still `0031`. There is
correctly no `0032`. This was checked by reading the write path, the read path and the clone
path directly, because G1 means the SQLite round-trip test does not execute.

**Batch 2 gate adjudications** _(team-leader, structural pass — pre-commit)_:

1. **Task 2.4 scope expansion → ACCEPTED.** The developer wired emission (`plan()` builds
   `crossFileWarnings`, `inspectCarrier` returns `{ warnings, task? }`) beyond the stated
   "widen two unions". Plan §1.2 and §3.7 both require these be _reported_; a widened union
   with no producer is a dead type, which is the stub shape the quality bar rejects.
   Emission is read-only and adds **no** `DoctorAction`, so BR-6/R4 hold. Not creep.
2. **`deriveCrossFileIssues` emits all four codes → ACCEPTED.** One directory-aware producer
   with `(code, field)` de-duplication at the scanner merge is better than splitting the
   derivation across two call sites. Self-parent-reported-once is pinned by test.
3. **`knownLabels` shape → the batches.md line was WRONG; the developer is RIGHT.** Line
   corrected above. Plan §4 is authoritative: `readonly string[]`, Map internal only.
   Batch 5 is now pointed at a shape that exists.
4. **Two out-of-inventory test files → ACCEPTED.** The store-parity graph assertion correctly
   reuses the existing skip gate instead of inventing a second one (this is why G1's scope
   grew rather than a G4 appearing). The doctor "repairs NONE of them" test with an FS
   byte-snapshot is the structural proof for BR-6 and is worth more than the inventory
   line-item it exceeds.

---

# Batch 3 — Phase 1: B read path, end to end (no write UI) ✅ COMPLETE

**Commit**: `c6cf19dce` — _feat(vscode): render the task metadata read path across board and detail_

**Recommended Executor**: `frontend-developer`
**Fallback Executor**: `general-purpose`
**Execution Mode**: `sequential`
**Rationale**: First frontend pass. Pure render — **zero writes** are issued anywhere in
this batch. Reordered after Batch 2 per V-2.
**Tasks**: 6 | **Dependencies**: Batch 1, Batch 2

**Verification (team-leader, MODE 2)** — **PASS.** Both reviewers APPROVED WITH CONCERNS, no
blocking issues; all concerns fixed before commit.

- Gate re-run uncached at the committed state: lint clean, **5 suites / 90 tests passed**,
  typecheck clean. All pre-commit hooks passed; nothing bypassed.
- Change set is the 6-task inventory + 6 out-of-inventory files, **all under `tasks-ui`**.
  Nothing foreign staged.
- Standing guards all hold: R11 (no `tasks-ui → editor` edge), BR-8 (`TaskStartService` zero
  diff), BR-7 (all fixtures `TASK_2026_*`), OnPush on **6 of 6** components, no `[innerHTML]`.
- **Defect found at the first gate by the team-leader and fixed** — neither reviewer found it.
  `task-relations.component.ts` tracked on `entry.id`, the same collision class this batch was
  opened to fix. The authored groups read `task.dependsOn` / `task.duplicates` /
  `task.relatesTo`, which the parser returns **un-deduplicated** (`task-frontmatter.ts:338`,
  `:211`) and which never pass through `buildTaskGraph`'s `addUnique` — that only de-duplicates
  the **derived** buckets. Fixed with `[...new Set(ids)]`. **Pin verified to bite by the
  team-leader directly**, not from a transcript: reverting it produces four distinct NG0955
  warnings, 1 failed / 89 passed.

**All three palette gates independently recomputed at this gate** — values pulled from the
installed `tailwindcss@3.4.19` rather than transcribed, and `anubis-light`'s
`oklch(97.788% 0.004 56.375)` converted to `#faf7f5`. **Every published figure reproduced to
the hundredth**: worst text 6.38:1 (gate 4.5), worst boundary 4.70:1 across all four themes
(gate 3.0), closest OKLab fill pair `cyan`/`sky` 0.0276 against the 0.0157 `emerald`/`teal`
threshold. The `-600` → `-700` border claim is confirmed: worst boundary was **3.09:1** at
`-600`. The `red`/`rose` cut measured **0.0064**, 2.45× closer than the pair the list had
already rejected.

> ### ⚠️ Both manual gates were discharged WITHOUT a live host — carry this to Batch 10
>
> **Three agents now share this limitation**: the frontend-developer, the `visual-reviewer`
> (localhost blocked in its environment) and the team-leader all verified R15 and the
> pixel-identity gate by **computation and static analysis only**. No VS Code host, no Electron
> host, no screenshot and no colour-picker reading was taken by anyone at any point.
>
> What that **does** establish, and it is not weak: the palette is absolute sRGB, so the ratios
> are theme-invariant by construction, and the arithmetic has now been reproduced independently
> from the installed Tailwind source.
>
> What it does **not** establish: that the classes survive Tailwind's purge, that no daisyui
> rule or ancestor `opacity`/`filter` alters the rendered colour, and that the truncation reads
> well at real chip size. **Batch 10's cross-host palette check is where this closes** — it is
> the first batch with a reason to open both hosts, and it should treat this as an explicit
> inherited debt rather than a formality.
>
> **One scope correction to the pixel-identity claim, found at this gate.** The byte-diff was
> run against a fixture with **no `executor`**, so it proves identity only for that shape. The
> executor badge is a **pre-existing** affordance and it _was_ modified — `max-w-[7rem]` plus a
> `<span class="truncate">` wrapper. A card carrying an executor and none of the five new
> fields is therefore **not** byte-identical to `HEAD`. This is **accepted**, not a defect: it
> is the same overflow fix the reviewer required for the chips, on the same row, and it changes
> pixels only when the executor name exceeds 7rem. But the gate's wording ("a card with no
> metadata is pixel-identical") is broader than what was proven, and Batch 10 must not read it
> as covering the executor row.

### Task 3.1 — Presentation helpers ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/task-presentation.ts`
`taskEstimateBadge`, `LABEL_CHIP_CLASSES`, `labelChipClass`, `TASK_RELATION_GROUP_LABELS`.
`LABEL_CHIP_CLASSES` is a **fixed, hand-audited** list of class triples at
**≥ 4.5:1 text contrast in both the light and dark VS Code themes** (NFR-12, R15).

> **CORRECTED at the Batch 3 gate**: use **absolute Tailwind palette steps only — never daisyui
> theme tokens.** A daisyui token (`badge-info`, `bg-primary`, …) resolves to a different colour
> per theme, and this app ships 30-plus themes, so a token-based palette would have to be
> re-audited on every theme and would silently re-break whenever a theme is added. Tailwind
> steps are absolute sRGB, so **one audit holds for every theme**. The original
> "Tailwind/daisyui" wording sanctioned the variant that cannot be audited.
> **Nothing is persisted, and colour is never the sole carrier of meaning** — every chip
> renders its text.

### Task 3.2 — Store graph computed ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts`
`readonly graph = computed(() => buildTaskGraph(this.allTasks()))` over the already-loaded
board payload. **One `computed`, invalidated only when the board payload changes — not per
keystroke** (NFR-10). The detail panel reads inverses and rollups from `graph()`, **not**
from the RPC; `TasksGetResult` is unchanged.

### Task 3.3 — Card renders the five fields ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts`
Label chips, estimate badge, child rollup (`done / total`), parent breadcrumb, duplicate
marker. **Absent ⇒ render nothing** — no "add label" nag, no "unestimated" pill (plan §6.7).

> **CORRECTED at the Batch 3 gate**: the rollup and the breadcrumb **cannot appear on the same
> card**, so do not write a test that asserts both. Parentage is **one level deep**, therefore a
> task with children cannot validly declare a parent. They are two disjoint cases and need two
> tests. The original wording listed them in one sentence as though a single fixture could
> exercise both.

### Task 3.4 — Relation groups (read-only) ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/detail/task-relations.component.ts` _(create)_
Five relation groups. **Authored** entries (this task's own array) are visually distinct from
**derived** entries (someone else's array); the derived affordance navigates to the authoring
task **or is disabled with a stated reason — never a silent no-op** (FR-B4.9). Read-only in
this batch; write affordances arrive in Batch 5.

### Task 3.5 — Zero-metadata golden-DOM spec + exports ✅ COMPLETE

**Files**:

- `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/board/task-card.component.spec.ts`
- `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/index.ts`

Golden-DOM assertion against a `TaskSpecSummary` with `labels: []`, `duplicates: []`,
`relatesTo: []`, no `estimate`, no `parent`: **no chip, no badge, no rollup, no breadcrumb,
no marker.**

### Task 3.6 — Fix the duplicate `@for` track key on validation issues ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/detail/task-detail.component.ts` (:105)

```
@for (issue of task.validationIssues; track issue.field) {
```

`track issue.field` is **not unique**. `duplicates` and `relates_to` are arrays, so one field
can carry several bad entries, and every issue about that array shares `field`.

- **Pre-existing on `main`; NOT caused by this task.** Verified by team-leader at the Batch 2
  gate by reading the line directly.
- **This task makes it more reachable**, which is why it is scheduled here rather than left
  alone: before the Batch 2 `ref` fix the surplus findings were being silently swallowed by
  the coarse de-dup key, so the collision was hard to provoke. Now that a correctly-surviving
  second finding actually reaches the board, the duplicate key is on a live path.

> **CORRECTED at the Batch 3 gate — this task's original spec was wrong on three
> counts. Verified against the installed Angular 21.2.6 and the parser source; do
> not re-inherit the original wording.**
>
> 1. **NG0955 does not throw.** In `@angular/core@21.2.6`
>    (`fesm2022/_debug_node-chunk.mjs:13690-13702`) it is a `console.warn` behind
>    `ngDevMode`. It is also raised **only from `reconcile()`** (`:13565`) — all
>    three `recordDuplicateKeys` call sites live inside it — so it **cannot fire on
>    first render**, which does not reconcile.
> 2. **The prescribed test is therefore not a pin.** "Render two dangling entries,
>    assert two `<li>` rows" **passes against the broken key**: first render creates
>    one view per item regardless of key. A duplicate-key test MUST drive at least
>    one reconcile and assert on a `console.warn` spy.
> 3. **The prescribed key `field|code|(ref ?? $index)` still collides.**
>    `liftRelationArray` (`libs/backend/task-specs/src/lib/task-frontmatter.ts:191-211`)
>    emits one issue per array **occurrence** with `ref` = the entry, and returns
>    `result.data` **un-deduplicated**. So `relates_to: [X, X]` — permitted by FR-B4.8 —
>    yields two issues with an identical `(field, code, ref)`, and the `ref` arm is
>    taken, not the `$index` fallback.

- **Fix (as shipped)**: `track issue.code + '|' + issue.field + '|' + (issue.ref ?? '') + '|' + $index`.
  `$index` is **unconditional**, not a fallback — uniqueness is then by construction and does
  not depend on `ref` being present or distinct. The semantic prefix is retained so the key
  still changes when the item at a position changes identity.
- **Test (as shipped)**: a `console.warn` spy across a 2 → 3 → 1 reconcile sequence, asserting
  no `NG0955` message. Row-count assertions are kept alongside as the user-visible contract,
  but the **warning assertion is the one that bites**.

> **Two de-duplication rules that look contradictory and are not. Do not "unify" them.**
>
> - The **relation list** IS de-duplicated for display (`[...new Set(ids)]`): `depends_on: [X, X]`
>   is one edge, and rendering two identical chips states nothing the first did not.
> - The **validation-issue list** is deliberately **NOT** de-duplicated: each occurrence is a
>   real finding about a real authored line, and collapsing them would under-report the file.
>
> A later batch that applies the relation rule to the issue list will silently hide findings.
> Both lists still need collision-proof track keys — that is a separate concern from whether
> the underlying data should be collapsed.

**Batch 3 Verification** _(§7 Phase 1 gate)_:

- Hand-author a carrier with all five fields → every field renders
- A `relates_to` with two bad entries renders **two** warning rows, and a **reconcile** over
  that list raises **no NG0955** on a `console.warn` spy (Task 3.6 — the row count alone does
  not test the key; see the correction note above)
- Delete them → the card is **pixel-identical to `HEAD`**
  > **CORRECTED at the Batch 3 gate**: the baseline is `HEAD`, **not `main`**. `main`'s
  > `tasks-ui` predates four unrelated commits on this branch (`638180dbf`, `ef32f9c4b`,
  > `88f68ea53`, `b7b24500f`) that reworked the card, plus Batch 1's `3e93069fd`. Plan §6.7
  > says "pixel-identical to **today's** card"; diffing against `main` would charge this batch
  > for four other commits' deliberate changes.
- **Zero writes** issued during either render
- **MANUAL (R15)**: visual contrast check of `LABEL_CHIP_CLASSES` in both themes
- `npx nx run-many -t typecheck,test,lint -p tasks-ui`

---

# Batch 4 — Phase 3a: the single write path (backend) ✅ COMPLETE

**Commit**: `2f7426bf0` — 18 files, +2391/-99. `code-logic-reviewer`: APPROVED WITH CONCERNS,
all three fix items landed and re-verified by team-leader before staging.

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `general-purpose`
**Execution Mode**: `sequential`
**Rationale**: The one write funnel for the whole feature. Must precede every write-capable
frontend batch. Backend half of Phase 3 (V-8) — the phase gate is asserted at the end of
Batch 5.
**Tasks**: 6 | **Dependencies**: Batch 1

### Task 4.1 — `updateFrontmatter` gains `remove` (F3 / BR-3) ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/backend/task-specs/src/lib/task-frontmatter.ts` (:285)

```ts
export interface UpdateFrontmatterOptions {
  readonly remove?: readonly string[];
}
```

Three lines after the existing merge at :308:
`const merged = { ...existing, ...patch }; for (const key of options?.remove ?? []) delete merged[key];`
`updateStatus`'s existing call site passes no options and is **behaviourally unchanged**.

**Two pre-existing behaviours a developer must NOT "fix":** (1) `matter.stringify`
re-serializes the whole frontmatter block, so untouched keys may change **quoting style** —
this already happens on every status change today; it is not an add/remove/reorder, so
FR-B5.4 holds. **Do not hand-roll a surgical line-splice** — that would be a second write
path. (2) Frontmatter **comments** do not survive the round trip. Also pre-existing. Out of scope.

### Task 4.2 — Extract `applyFrontmatterPatch` + `deferNotify` ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/backend/task-specs/src/lib/task-writer.service.ts`
Extract the read → parse → patch → **pre-write re-read** → byte-compare → write → notify
sequence (today inlined in `updateStatus`, :368–472) **verbatim** into
`private applyFrontmatterPatch(root, taskId, patch, remove, deferNotify)`.
**The whole-file content comparison at :440 is unchanged.** It is strict on purpose; R6's
conflict-fatigue cost is **accepted, not eliminated**. `deferNotify` suppresses the per-write
`this.notify(…)` at :467 (bulk needs this — R5).

### Task 4.3 — `updateMetadata`; `updateStatus` delegates ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/backend/task-specs/src/lib/task-writer.service.ts`
Two public entry points, and **nothing else writes a carrier**. `updateStatus` becomes
`this.updateMetadata(root, taskId, { status })` and **keeps its exported signature and its
declared `UpdateStatusResult` union**, so the RPC handler, the MCP namespace and
`apps/ptah-cli` need no change on that path. Its one new line maps the unreachable
`INVALID_PARAMS` onto `WRITE_FAILED` **with an explanatory comment**, rather than widening
the wire error union for a case that cannot occur.
`UpdateMetadataInput` per plan §3.1 — **every field is a full replacement, never a merge**;
`[]`/`null` ⇒ remove the key, except `dependsOn: []` which is still written as `[]`.
`CreateTaskInput` gains the five fields.
**BR-6: `adoptFolder` gains no metadata fields and is not otherwise touched.**

### Task 4.4 — Shared patch contract ✅ COMPLETE

**Files**:

- `D:/projects/ptah-extension/libs/shared/src/lib/types/task-view.types.ts` _(create)_
- `D:/projects/ptah-extension/libs/shared/src/index.ts`

`TaskMetadataPatch`, `TaskMetadataPatchSchema`, `MAX_LABEL_LENGTH = 32`,
`MAX_LABELS_PER_TASK = 12`, `LabelSchema`, `TaskIdRefSchema` (Zod 4, exact shapes in plan
§5.1). FR-B1.7's three limits (newline / 32 chars / 12 labels) are enforced **here only**, so
they hold identically on the RPC, MCP and CLI paths. `TaskIdRefSchema` rejects `/`, `\`, and
`..` (NFR-13). The final `.refine` requires the patch to change at least one field.

### Task 4.5 — `tasks:updateMetadata` — full dual registration ✅ COMPLETE

**Files**:

- `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-tasks.types.ts`
- `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc.types.ts` — **two sites**: the `RpcMethodMap` block (≈ :1800) **and** the `RPC_METHOD_ENTRIES` record (≈ :2969)
- `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.schema.ts`
- `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts` — `METHODS` (:132) + `register()` (:166) + a private registrar

`TasksUpdateMetadataParamsSchema` composes `TaskMetadataPatchSchema` from `libs/shared` so
the RPC and the MCP tool **cannot drift**.
**No edit to `rpc-handler.ts` (BR-1) and no edit to `host-profile/manifest.ts`** — the
`tasks` entry at :242 references `TasksRpcHandlers.METHODS` and picks up new methods
automatically.

### Task 4.6 — Write-path specs + MCP update tool ✅ COMPLETE

**Files**:

- `D:/projects/ptah-extension/libs/backend/task-specs/src/lib/task-writer.metadata.spec.ts` _(create)_
- `D:/projects/ptah-extension/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/tasks-namespace.builder.ts` — new `TaskUpdateArgsSchema` (status **or** metadata); `TaskSpecWriterLike` gains `updateMetadata`; `get` returns a `derived` block from `buildTaskGraph`
- `D:/projects/ptah-extension/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`
- `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.spec.ts`

`task-writer.metadata.spec.ts` asserts: body byte-identical **including BOM and CRLF**; an
untouched key keeps its position; setting a field empty **removes the key**; a write to task
A leaves every other carrier byte-identical (R4); a mid-write external edit returns
`TASK_CONFLICT` and **writes nothing**; and — with an `IFileSystemProvider` mock whose
`writeFile` throws — a full read-only render completes, asserting **zero** writes under any
`TASK_*` folder _(the assertion excludes the one known hash-guarded `ensureStarted` path)_.

**Batch 4 Verification** _(backend half of the Phase 3 gate)_:

- Every assertion in Task 4.6 green
- `npx nx run-many -t typecheck,test,lint -p shared task-specs rpc-handlers vscode-lm-tools`
- Diff review: `adoptFolder`, `registry-generator.service.ts`, `rpc-handler.ts`,
  `manifest.ts`, `renderFrontmatterBlock` all show **zero** changes
- **Discharges GATING NOTE G3** (recorded under Batch 1): `taskIdRef`, `taskIdSchema` and
  `TasksAdoptParamsSchema.folderName` all match `isSinglePathSegment`'s hardened behaviour
  and carry its rejection test table. Batch 4 is not green until they do.
- **Discharges GATING NOTE G2**: `registerCreate` and the MCP `create` handler pass the five
  metadata fields through; asserted by a create-with-labels round trip on both paths.
- **GATING NOTE G1** (SQLite suites skipped, not passed) should be discharged at this gate
  at the latest — Batch 4 is the first batch that writes metadata a user can lose.

## Team-leader structural verification — Batch 4

**Verdict: STRUCTURALLY GREEN.** Every gate item above is met. G1, G2 and G3 are all
discharged and annotated in full at their notes under Batch 1. Not committed here — the
`code-logic-reviewer` security pass ran concurrently and its verdict gates the commit.

**Change set established independently** (`git status` against `c6cf19dce`): 12 modified +
3 new files — exactly the Task 4.1-4.6 inventory plus the disclosed extras. Nothing
foreign. Team-leader added 2 more (`scripts/test-native.mjs`, one `package.json` line).

**Gate re-run uncached, team-leader's own numbers** — these match the developer's report
exactly:

| project           | suites    | tests                  |
| ----------------- | --------- | ---------------------- |
| `shared`          | 26 passed | 515 passed             |
| `task-specs`      | 14 passed | 344 passed, 17 skipped |
| `rpc-handlers`    | 70 passed | 1517 passed, 4 skipped |
| `vscode-lm-tools` | 36 passed | 723 passed             |

`typecheck`, `test`, `lint` all green across the four; 26 lint warnings, all pre-existing
in untouched files, 0 errors.

### The `updateFrontmatter` blank-line defect — reproduced and the fix independently tested

**The pre-existing defect is real.** Probed directly: `matter.stringify('', data)` returns
`"---\n…\n---\n\n"` — **two** trailing newlines, the second being its own separator from
the content it was given. `FRONTMATTER_RE` consumes only the newline that _closes_ the
block, so the sliced body carries its own leading newline and the two concatenate into a
blank line **on every write, cumulatively**. It was invisible because the existing conflict
spec compares two strings that both went through `updateFrontmatter`, so the drift
cancelled.

The fix is `.replace(/\n$/, '')` — one newline, not `\n+$`. Team-leader wrote a throwaway
spec against the **real** `updateFrontmatter` and ran it (7/7 passed, then deleted):

- **LF, four successive writes** — body byte-identical each time and total file length
  _stable_, i.e. accumulation gone, not merely slowed.
- **CRLF** — body survives verbatim as `\r\n# H\r\n\r\nBody line.\r\n` across three
  writes. The block itself is re-emitted with LF, which is pre-existing `matter.stringify`
  behaviour and not a regression.
- **Empty body** — stays empty; file still ends `---\n`, no blank line grown.
- **Body legitimately starting with blank lines** (`\n\n\nBODY`) — all three preserved.
  The fix strips the _emitter's_ padding, never the body's.
- **No trailing newline after the closing fence** — normalises once, then stable
  (`once.length === twice.length`). Previously added two.
- **BOM** — re-applied at byte 0, body byte-identical.
- **`remove` option** — key deleted, body untouched.

Existing carriers keep their accumulated blank lines; nothing is backfilled (BR-6).

### Must-not-fix behaviours — all four survived

- `matter.stringify` **re-quoting**: untouched. Still `matter.stringify`; **no hand-rolled
  line splice** was introduced, so no second write path.
- Frontmatter **comments** still do not survive the round trip. Out of scope, unchanged.
- **The whole-file compare is unchanged.** `if (current !== raw)` is byte-identical to
  `HEAD`; only the surrounding comment expanded and the log strings were renamed
  `updateStatus …` → `carrier …` (the method is now shared). R6's conflict-fatigue cost is
  still accepted, not tuned away.
- **`dependsOn: []` is still written as `[]`.** `updateMetadata` has no removal branch for
  it, and `task-writer.metadata.spec.ts:312` asserts it explicitly.

### Binding rules re-confirmed by direct diff read

- **BR-1** — `rpc-handler.ts` **zero diff**. `ALLOWED_METHOD_PREFIXES` untouched.
- **BR-5** — `renderFrontmatterBlock` **zero occurrences** in the diff.
- **BR-6** — `adoptFolder` and `registry-generator.service.ts` **zero production diff**;
  `adoptFolder` appears only in spec assertions. `manifest.ts` zero diff — the `tasks`
  entry picks up `tasks:updateMetadata` via `TasksRpcHandlers.METHODS` automatically.
- **BR-7** — scanned every changed and new file for `task-tracking/`, `.ptah/tasks/`,
  `specs/TASK_2025_` and `TASK_2025_`: **no hits**.
- **Dual registration** confirmed at **both** sites: `rpc.types.ts:1809` (`RpcMethodRegistry`)
  and `:2979` (`RPC_METHOD_ENTRIES`).

### Accepted deviations and open notes

- `deferNotify` has **no production caller until Batch 11** — tests only, per Task 4.2's
  explicit instruction. Not dead code; a documented seam. **Batch 11 must consume it.**
- The BOM assertion is made against `updateFrontmatter` directly because the fs mock's
  `TextDecoder` strips a leading BOM on read. Correct call — a mock-routed version would
  be green while proving nothing.
- `updateStatus` with a non-segment `taskId` now returns `WRITE_FAILED` (folded from the
  unreachable `INVALID_PARAMS`) where it previously reached `TASK_NOT_FOUND`. Error-path
  only, no test regressed, and the message is preserved verbatim.

---

# Batch 5 — Phase 3b: metadata editor + client write serialization ✅ COMPLETE

**Commit**: `c122d2441` — _feat(vscode): batch 5 — the client metadata editor and its write queue_
(12 files, +2372/−50). `code-logic-reviewer` APPROVED, all five follow-ups landed and
independently re-verified. Hooks passed clean; no `--no-verify`.

**Recommended Executor**: `frontend-developer`
**Fallback Executor**: `general-purpose`
**Execution Mode**: `sequential`
**Rationale**: Frontend half of Phase 3 (V-8). Establishes the one client mutation funnel
that Batches 7, 9, 12 and 14 all reuse. **The Phase 3 acceptance gate is asserted here.**
**Tasks**: 4 | **Dependencies**: Batch 3, Batch 4

### Task 5.1 — Per-task write serialization ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts`
`enqueueWrite` per-task promise tail exactly as plan §3.5. Two details are load-bearing:
`prev.then(op, op)` — **a failed predecessor must not block the queue**; and the **identity
check** before `delete`, which is what stops a stale `finally` from dropping a newer chain
and letting two writes overlap again.
Every mutating store method routes through it. Add `applyMetadata(taskId, patch, { reload })`
as the single client mutation funnel; refactor single-card `updateStatus` to share it.
**This does not provide correctness — the writer's pre-write re-read does.** It removes the
UI's ability to manufacture a `TASK_CONFLICT` against itself.

### Task 5.2 — Metadata editor ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/detail/task-metadata-editor.component.ts` _(create)_
Label input with completions **from `graph().knownLabels`** (no registry file), estimate
picker, parent picker, relation add/remove. Full-replacement semantics: add/remove of a
single label is computed **client-side** from the task already held, then sent as a whole
array. Surface the Zod issue message verbatim on limit violations. BR-10 applies to every
label rendered.

### Task 5.3 — Relation write affordances ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/detail/task-relations.component.ts`
Authored entries become removable **here**; derived entries are not. **FR-B4.3: a "B blocks
A" affordance on B's panel issues `tasks:updateMetadata` on A with
`dependsOn: [...A.dependsOn, B.id]` — one file, one conflict domain. There is no `blocks:`
key anywhere** (D3).

### Task 5.4 — Store spec + exports ✅ COMPLETE

**Files**:

- `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/services/tasks-store.service.spec.ts`
- `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/index.ts`

**Batch 5 Verification** _(§7 Phase 3 gate — the full pair)_:

- Body byte-identical (incl. BOM and CRLF); an untouched key keeps its position; setting a
  field empty **removes** the key; a write to A leaves B byte-identical; a mid-write external
  edit returns `TASK_CONFLICT` and writes nothing
- **Two rapid same-task edits produce ZERO spurious conflicts**
- `npx nx run-many -t typecheck,test,lint -p shared task-specs rpc-handlers tasks-ui vscode-lm-tools`

**Team-leader structural verification** _(independent re-run, not the developer's numbers)_:

Gate, uncached, **post-follow-up**: shared 515/515 (26 suites) · task-specs 345 passed /
17 skipped / 362 · vscode-lm-tools 727/727 (36) · rpc-handlers 1522 passed / 4 skipped /
1526 (70) · tasks-ui **156/156, 7 suites** (152 pre-follow-up; 5 spec files at `2f7426bf0`
→ 7). Lint clean, 0 errors. `npm run test:native`: persistence-sqlite 18 suites / 145 tests,
task-specs 14 / **362**, **0 skipped** in both.

The 17 standard-runner skips are ALL in `task-index.store.spec.ts`, gated on
`Database ? it : it.skip`. **`task-writer.metadata.spec.ts` carries no skip gate**, so the
five backend gate assertions already executed under the standard runner. The developer's
stated reason for the native run was therefore over-cautious — but the run is still the
stronger evidence and cost nothing, so it stands as the citation.

_Pin mutations reproduced independently_ (file restored byte-identical after each):

| mutation                                                                                 | team-leader result                                                                                                                                            |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| identity check → unconditional `delete`                                                  | **exactly 1 fails** — `keeps the queue intact when an early write settles under later ones` (re-confirmed post-follow-up)                                     |
| `set(taskId, tail)` → `set(taskId, run)` **and** `then(op, op)` → `then(op)`             | **1 fails** — `does not wedge the queue when a predecessor rejects`                                                                                           |
| `then(op, op)` → `then(op)` alone                                                        | **all pass** — confirms the developer, refutes the brief                                                                                                      |
| `enqueueWrite` → `return op()`                                                           | **3 fail** (was 4 pre-follow-up) — the expected consequence of the wedge test now targeting the primitive rather than `applyMetadata`                         |
| post-write reload `try/catch` removed                                                    | **exactly 3 fail**; the complement `leaves a genuine WRITE failure reading as a write failure` correctly **passes**                                           |
| `origin === 'authored' ? … : undefined` → unconditional `AUTHORED_RELATION_FIELD[group]` | **1 fails** — `offers removal on authored groups only`, and the received DOM is the **`related — declared elsewhere`** remove button. The pin is not vacuous. |

**Correction of record — the orchestration brief was wrong.** The brief asserted that
`prev.then(op)` alone would wedge the queue after a failure. It does not, for this code:
the map stores `tail`, and `tail` is `run.then(() => undefined, () => undefined)`, so `prev`
is **always** fulfilled and the rejection handler is unreachable as wired. Verified by
reading the primitive and by mutation. The developer was right to refuse the claim and to
pin the **pair** instead. This is the second developer correction of an orchestration-layer
instruction on this task; the claim must not propagate into Batches 7 / 9 / 12 / 14.

_Reviewer follow-up rulings (team-leader)_:

- **Item 4 — the `related` finding is CORRECT and is the real reason the guard exists.**
  `AUTHORED_RELATION_FIELD` is `Partial<Record<…>>` with a `related` key, so the type-level
  absence closes `blocks` and `duplicated_by` **only**. For the derived half of `related`
  the `origin === 'authored'` test is the sole guard, proven by mutation above. One
  sharpening for the record: the derived half's ids are disjoint from `task.relatesTo` by
  construction (`relatedIds.filter(id => !authoredHere.has(id))`), so the filter is always
  the identity and the emitted **array content** is unchanged. The defect is therefore a
  spurious carrier rewrite — real write, wrong file, bumps `updated`, triggers reindex and
  board reload — behind a remove button that visibly does nothing. Not data loss, but
  "no-op" is still the wrong word for it, and the guard is still required.
- **Private-member access in `does not wedge the queue when a predecessor rejects` —
  ALLOWED, narrowly.** Fixing item 1 made `writeMetadata` unable to reject at all, which
  would have left the old pin passing while asserting nothing. The choice was a silently
  vacuous test or a cast. `enqueueWrite` is a general `<T>(taskId, op)` primitive whose
  non-wedging contract Batches 7, 9, 12 and 14 will rely on, so the guarantee outlives
  today's only caller. The test also gained an execution-order assertion
  (`['first','second']`), so it now pins serialization as well. **Conditions**: this is the
  single permitted instance in `tasks-ui`; if a later batch adds an op that CAN reject, the
  test moves back onto the public API. Recorded so Batch 7 does not read it as licence.
- **`libs/frontend/tasks-ui/CLAUDE.md` — content verified accurate.** The RPC list matches
  the eight real call sites, and all three new sentences check out against the code. Two
  pre-existing staleness items are NOT this batch's to fix and were correctly left alone
  ("the card's Start button is a placeholder", "Batch D wires `TaskStartService`" — both
  predate this task). One nit for a later pass: "there is no second mutating call site" is
  loose next to `tasks:create`, which also mutates the filesystem; the sentence is plainly
  about metadata writes, but the word "mutating" does double duty.

_Single-funnel proof_: exactly one `tasks:updateMetadata` call site in the whole webview
(`writeMetadata`, `tasks-store.service.ts:768`), reachable only from `applyMetadata` via
`enqueueWrite`. `enqueueWrite` has exactly one call site. No client `tasks:updateStatus`
call remains. The three label limits appear client-side **only inside prose comments**
naming the shared schema as their home — no executable literal, and the component specs
derive their expected sentences from `TaskMetadataPatchSchema` via a `schemaMessage(...)`
helper rather than hardcoding them.

_Standing guards_: R11 (no `tasks-ui → editor` edge) holds · BR-7 (no forbidden literal;
fixtures all `TASK_2026_*`) holds · BR-8 (`task-start.service.ts` **zero diff**) holds ·
BR-10 (no `[innerHTML]`, no `new RegExp`, no `bypassSecurity`) holds · OnPush on 3/3 detail
components · Batch 3 pixel proof intact (`libs/frontend/tasks-ui/src/lib/components/board/`
**zero diff** vs `c6cf19dce`).

> ## §7 PHASE 3 ACCEPTANCE GATE — ✅ DISCHARGED FOR THE PAIR (Batch 4 `2f7426bf0` + Batch 5 `c122d2441`)
>
> All six assertions located, named and green:
>
> 1. Body byte-identical incl. BOM and CRLF — `task-writer.metadata.spec.ts:154,178,191,209`
> 2. Untouched key keeps value **and** position — `:225,246`
> 3. Empty removes the key, `dependsOn: []` still written as `[]` — `:269` (`it.each`), `:291`, `:310`
> 4. A write to A leaves B byte-identical — `:419`
> 5. Mid-write external edit → `TASK_CONFLICT`, incl. a BODY-only edit — `:497,520`
> 6. Two rapid same-task edits produce **ZERO** spurious conflicts —
>    `tasks-store.service.spec.ts:612` and the four siblings in
>    `describe('per-task write serialization')`
>
> Assertion 6 is a real assertion, not a tautology: the harness mock models the writer's
> pre-write re-read by returning `TASK_CONFLICT` for a second `updateMetadata` on an
> in-flight task, and is mutation-pinned above.
>
> Both contingencies are now satisfied: `code-logic-reviewer` **APPROVED** with all five
> follow-ups landed and independently re-verified, and Batch 5 is committed at `c122d2441`.
> **The gate is discharged. Phase 3 is closed.** The orchestrator may treat FR-B5.x and the
> single-write-path claim as established for Batches 7, 9, 12 and 14.

---

# Batch 6 — Phase 4a: shared filter predicate + list parity + CLI flags ✅ COMPLETE

**Commit**: `34cf9e75b` — _feat(vscode): batch 6 — the shared filter predicate across list, store and cli_
**Progress**: 6/14 batches complete

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `general-purpose`
**Execution Mode**: `sequential`
**Rationale**: FR-C1.5's single-predicate claim is only testable if the shared module and the
`tasks:list` handler land together. Carries the unassigned `apps/ptah-cli` work per
[V-3](#v-3--appsptah-cli-is-unassigned-risk-low).
**Tasks**: 5 | **Dependencies**: Batch 1, Batch 2

### Task 6.1 — `task-filter.ts` ✅ COMPLETE

**Files**:

- `D:/projects/ptah-extension/libs/shared/src/lib/types/task-filter.ts` _(create)_
- `D:/projects/ptah-extension/libs/shared/src/index.ts`

`TaskFilterSpec`, `TaskSortSpec`, `EMPTY_TASK_FILTER`, `filterTasks`, `sortTasks`,
`TaskFilterSpecSchema`, `TaskSortSpecSchema`. **This is THE single filter predicate
(FR-C1.5)** — no second implementation may exist on either side.
AND-across-facets / OR-within-facet; labels ANY vs ALL; `unestimated`. Sort is **stable and
tie-broken by id**; estimate sorts by `TASK_ESTIMATES` tuple order.
**BR-10: free-text is case-insensitive `String.includes`, never a constructed `RegExp`.**

### Task 6.2 — Filter spec ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/shared/src/lib/types/task-filter.spec.ts` _(create)_

### Task 6.3 — `tasks:list` gains a filter _(no new method)_ ✅ COMPLETE

**Files**:

- `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-tasks.types.ts` — `TasksListParams.filter?`
- `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.schema.ts` — `filter: TaskFilterSpecSchema.optional()`
- `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts`
- `D:/projects/ptah-extension/libs/backend/task-specs/src/lib/task-index.store.ts` — `TaskIndexFilters` (:36) gains optional `filter`

The handler applies the **shared** `filterTasks` over `index.list(…)`'s summaries.
`status`/`type` stay for compatibility and are **folded into the spec** before the call.

### Task 6.4 — Parity spec ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.spec.ts`
**The same `TaskFilterSpec` over the same fixture returns an identical id list from
`filterTasks` client-side and from the `tasks:list` handler.**

### Task 6.5 — CLI flags _(V-3)_ ✅ COMPLETE

**Files**:

- `D:/projects/ptah-extension/apps/ptah-cli/src/cli/commands/ptah-spec.ts`
- `D:/projects/ptah-extension/apps/ptah-cli/src/cli/commands/ptah-spec.spec.ts`

`--json` carries the new fields (they ride on `TaskSpecSummary`). `list` accepts `--label`
and `--estimate`, folded into a `TaskFilterSpec` and applied through the **shared**
`filterTasks`. **`TASK_CONFLICT` handling is unchanged.**
**Report the pre-existing `NO_COLOR` failure; do not fix it** (§3 of this file, NFR-15).

**Batch 6 Verification** _(backend half of the Phase 4 gate)_:

- Parity test green; sorting stable and tie-broken by id
- `npx nx run-many -t typecheck,test,lint -p shared task-specs rpc-handlers ptah-cli`
- Pre-existing `ptah-cli` `NO_COLOR` failure reported **as pre-existing**

**Team-leader verification — PASSED. `code-logic-reviewer` APPROVED. Committed `34cf9e75b`.**

### Post-fix re-verification (all three gates, uncached)

Change set re-established after the two follow-ups: still **10 modified + 2 new**, no new
files. The delta was `+12/−2`, confined to `tasks-rpc.handlers.spec.ts` (the relabel and its
comment), plus the two sort pins inside the untracked `task-filter.spec.ts`.

**Totals checked, not just pass counts** — the collection-failure flake reduces a run's
TOTAL rather than showing red, so the totals are the signal:

| Gate                                  | Result     | Totals                                                                                                                                                                |
| ------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate 1 `--skip-nx-cache`              | **EXIT=0** | shared **597/597** (27 suites, 595 + 2 pins) · task-specs 351 + 23 skipped = **374** · rpc-handlers 1548 + 30 skipped = **1578** · ptah-cli 859 + 3 skipped = **862** |
| `npm run test:native`                 | **EXIT=0** | persistence-sqlite **145/145** · task-specs **374/374, 0 skipped**                                                                                                    |
| `npm run test:native -- rpc-handlers` | **EXIT=0** | **1576 passed, 2 skipped, 1578 total**                                                                                                                                |

The reconciliation that matters: `rpc-handlers` reports **1578 total under BOTH runners**,
with skips falling 30 → 2. Identical totals prove no suite was silently dropped, and the 28
tests moving from skipped to passed are the SQLite blocks finally executing. No collection
failure in any run. `NO_COLOR` did not reproduce; Nx again flagged a flaky task, consistent
with the two causes now recorded in `TASK_2026_182`.

**Seed fix** — same shape as the precedent. `task-index.store.spec.ts:42` joins
`[29, 31]` into one DDL string; `tasks-rpc.handlers.spec.ts:500` loops `for (const version
of [29, 31]) db.exec(…)`, identical to its own sibling parity block at `:1556`. Mechanics
differ, rationale and effect are the same. The relabel `':memory: + migration 0029'` →
`':memory: + migrations 0029 and 0031'` makes the description accurate; the old one had
become a false statement about what the block does. The 2 remaining skips are pre-existing
`it.skip`s at `auth-rpc.handlers.spec.ts:459` and `config-rpc.handlers.spec.ts:242`, both
files untouched by this batch.

**Sort pins bite, with one precision note.** Pin 1 (`Émile`/`Emile`/`zulu`) is the robust
one: `é` collates beside `e` in effectively every locale, so ordinal `[Emile, zulu, Émile]`
differs from locale-collated order universally, and the `not.toEqual` states the intent
outright. Pin 2 asserts the `sv`/`en` disagreement is real before asserting this sort
ignores it — good construction. Note for the record: for the `ä`/`z` fixture the ordinal
result `[a-first, z-third, ä-second]` **coincides with** the Swedish collation, so pin 2's
comment "agrees with neither" is imprecise, and pin 2 alone would not bite on a
Swedish-locale host. Pin 1 carries the universal guarantee, so the pair is sound. Not a
defect; worth knowing before anyone leans on pin 2 by itself.

**`localeCompare` — precisely stated.** None remains in `task-filter.ts` outside its two doc
comments, which is the claim that matters: that module is the one both hosts run. It does
survive elsewhere in source — `task-index.store.ts:105,110` (`orderSummaries`),
`registry-generator.service.ts:79,84`, `init.ts:775` — all **pre-existing, untouched by this
batch, and server-side only**, so no two hosts ever collate the same payload. `orderSummaries`
sits outside this batch's diff hunk (`@@ -95,21 +111,38 @@`). Harmless today; if the default
board order ever has to agree across the extension host, CLI and Electron, that is where to
look.

Change set independently established: **10 modified + 2 new**, matching the developer's
inventory exactly. The three `git stash push`/`pop` cycles lost nothing — the only stash
entry belongs to an unrelated branch (`ak/quick-fix-discord`).

Gates re-run uncached by the team leader:

- Gate 1 `typecheck,test,lint -p shared task-specs rpc-handlers ptah-cli --skip-nx-cache`
  **EXIT=0**. Nx flagged `ptah-cli:test` as a **flaky** task; it passed on this run
  (859 passed / 3 skipped) and `NO_COLOR` did **not** fail here — see the note below.
- Gate 2 `npm run test:native` **EXIT=0** — persistence-sqlite 145/145 (18 suites),
  task-specs **374/374, 0 skipped**. Both confirm the developer's numbers.
- `npm run test:native -- rpc-handlers` **EXIT=1** — 1 failed, 2 skipped, 1575 passed.

Single-predicate claim (FR-C1.5) verified by independent search across the four libs:
**exactly one production caller of `filterTasks`** — `task-index.store.ts:145`. The store's
SQL is still `SELECT * FROM task_specs WHERE workspace_root = ?` with no `WHERE status IN`;
no status/type comparison survives anywhere outside `libs/shared`; the two `.filter(` calls
in `ptah-spec.ts` are `filter(Boolean)` over label strings and a pre-existing
`validationIssues` count in `spec check` (HEAD:398), neither a task predicate.

Parity test confirmed to run **end to end**, not `filterTasks` against itself: the server
side is `getHandler(rpc, 'tasks:list')(params)` over a real `TaskScannerService` +
`TaskIndexService` + store (both impls), and the client side calls `filterTasks` directly.
It measures **wire fidelity** — that schema, handler and store deliver the spec unchanged —
while predicate correctness is carried separately by `task-filter.spec.ts`. That is the
right division; the block bites when the plumbing drops the spec (verified: 22 failures).

BR re-confirmations: **BR-1** — no new RPC method; `tasks:` was already in
`ALLOWED_METHOD_PREFIXES` (`rpc-handler.ts:84`); `rpc-handler.ts` and `manifest.ts` both
untouched. **BR-6** — read path only; `listByWorkspace` is a bare `SELECT` and no write
statement is reachable from `tasks:list`. **BR-5**, **BR-7**, **BR-14** hold.

### Gating note G2 — `test:native`'s project list is hand-maintained and has drifted

`npm run test:native -- rpc-handlers` fails at HEAD, in a block **this batch did not
touch** (the diff has two hunks: imports at `:56`, and an append at `:1128`). The failing
block is `tasks:board exclusions — SqliteTaskIndexStore › :memory: + migration 0029`
(`tasks-rpc.handlers.spec.ts:500`), which seeds migration 0029 only, while
`SqliteTaskIndexStore.insertSql()` has written the five 0031 columns (`labels`, `estimate`,
`parent`, `duplicates`, `relates_to`) since **Batch 1 `3e93069fd`**. Every insert throws.
It has been red for three batches, invisible because the block self-skips under plain
`nx test` **and `rpc-handlers` is not in `test:native`'s default project set**.

The scope is larger than one entry. `scripts/test-native.mjs:50` declares
`DEFAULT_PROJECTS = ['persistence-sqlite', 'task-specs']` under a comment reading "the
projects whose suites self-skip when the native addon will not load" — a claim that is now
false. Projects carrying the same `nativeAvailable ? describe : describe.skip` pocket and
**not** covered: `rpc-handlers`, `messaging-gateway`, `skill-synthesis`, and
`apps/ptah-electron`. The last is unreachable by construction: the script resolves configs
at the hardcoded `libs/backend/<project>/jest.config.ts`, so no app can be named at all.

**RESOLUTION — G2 is TRANSFERRED, not resolved.** The orchestrator took the split ruling in
full. The seed fix landed here in `34cf9e75b`. The runner rework — derive the project list
instead of hardcoding it, fix the `libs/backend/<project>` path that makes `apps/*`
unnameable, and triage whatever `messaging-gateway` and `skill-synthesis` turn red — is
carried by **`TASK_2026_182`** (`BUGFIX`, `depends_on: [TASK_2026_181]`), where it is
explicitly allowed to be red. The `DEFAULT_PROJECTS` finding and the `rpc-handlers` history
are written into its `context.md`, along with **both** flakiness causes: the
`formatter.spec.ts` process-global `NO_COLOR` mutation, and the Windows `EPERM` on Jest's
shared `%TEMP%` transform cache — the latter being the more dangerous, since a collection
failure shrinks the reported total rather than showing red.

**Team-leader ruling — split the fix; do not take the runner change in this batch.**

- **In Batch 6**: apply the one-line `[29, 31]` seed in the pre-existing block. One line, in
  a file this batch already owns, and it removes the confusing adjacency of two sibling
  blocks where the newer one seeds correctly and the older one does not.
- **NOT in Batch 6**: any edit to `scripts/test-native.mjs`. Adding `rpc-handlers` to the
  hand-maintained list fixes one pocket of four and re-commits to the mechanism that caused
  this. The durable fix is to **derive** the project list and to resolve app configs — and
  its blast radius is unknown until the three uncovered libs are run, any of which may be
  red like `rpc-handlers` was. That is an unbounded hole and must not gate a clean feature
  batch. It belongs in its own task, where it is allowed to be red.

`NO_COLOR`: reported as pre-existing per Task 6.5's instruction, correctly not repaired. It
did **not** reproduce in the team leader's Gate 1 run, and Nx independently flagged
`ptah-cli:test` flaky — `formatter.spec.ts` mutates the process-global `NO_COLOR`
(`:251-277`), which is the more likely story than a deterministic failure. Worth a note in
the follow-up task, still not this batch's to fix.

Design decisions — **all four upheld.** `mergeStatusTypeFacets` returning `null` is right:
`[]` means "facet inactive", so writing the empty intersection back would invert two
contradictory constraints into none, and three tests pin the `[]` behaviour. Label limits
correctly not applied to the read path — `LabelSchema`'s 32-char cap is a write constraint,
and refusing to filter for an over-long label would hide the very task its warning is
about. Absence ranked before the direction sign is correct — unsized tasks are unanswered,
not small. Ordinal-on-lowercase over `localeCompare` is correct and load-bearing: ICU
collation differs between the extension host and the webview, and this is a shared module
both run.

Out-of-inventory files — **both accepted.** `router.ts` is not optional: without the two
`.option()` declarations commander never populates `--label`/`--estimate` and Task 6.5's
flags are unreachable. `task-index.store.spec.ts`'s six cases run the filter through the
**SQL** row set as well as the Map one, which is the only way to know `labels`/`estimate`
round-trip out of JSON/TEXT columns into a shape the shared predicate can read.

**This is the backend half of Phase 4 only. The Phase 4 gate is asserted at the end of
Batch 7 and is NOT discharged here.**

---

# Batch 7 — Phase 4b: filter bar, sorting, filtered-empty state ✅ COMPLETE

**Commit**: `c107e9d09` — _feat(vscode): batch 7 — the board filter bar, sorting and filtered-empty state_
**Progress**: 7/14 batches complete

**Recommended Executor**: `frontend-developer`
**Fallback Executor**: `general-purpose`
**Execution Mode**: `sequential`
**Rationale**: Frontend half of Phase 4 (V-8). **The Phase 4 acceptance gate is asserted here.**
**Tasks**: 5 | **Dependencies**: Batch 3, Batch 6

### Task 7.1 — Store filter/sort signals + computeds ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts`
`_filter`, `_sort` (session state, **never persisted**) plus `filtered`, `filteredIds`,
`board`, `matchedCount`, `totalIndexed`, `knownLabels`, `estimateBuckets`, `filteredEmpty` —
shapes in plan §6.1. `board` **replaces** the existing `computed` at **:301**
_(corrected at the Batch 7 gate — the `:230` this line carried was a plan-time
offset that Batches 1–6 had already pushed down; `:230` at `34cf9e75b` is
mid-comment in the workspace-cache block)_.
**The whole filter path is `computed()` over an already-loaded payload: changing a filter
issues NO RPC and triggers NO reload** (FR-C1.4, NFR-10 → 0 reloads).
The existing header counters (`totalCount`, `statusCounts`, `doneCount`, `activeCount`) keep
reading `_columns()` directly, so they report **indexed** totals while columns report
**filtered** counts — that is exactly the `23 of 181` contract. The filter survives a reload
for free: it is store state and `loadBoard` only replaces `_columns`.

### Task 7.2 — Filter bar ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/filter/task-filter-bar.component.ts` _(create)_
Facet menus, ANY/ALL toggle, removable chips, the `23 of 181` counter, clear-all.

### Task 7.3 — Column header counts ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/board/task-column.component.ts`
Filtered count in the header; forwards focus/selection inputs (consumed in Batches 10, 12).

### Task 7.4 — View host + filtered-empty state ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts`

### Task 7.5 — Store spec ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/services/tasks-store.service.spec.ts`
A filter change issues **0** RPC calls (spy assertion). Filter recompute over a **1 000-task
fixture is < 16 ms**.

**Batch 7 Verification** _(§7 Phase 4 gate — the full pair)_:

- Parity test (Batch 6) still green
- A filter change issues **0** RPC calls; 1 000-task recompute < 16 ms
- Sorting stable, tie-broken by id
- `npx nx run-many -t typecheck,test,lint -p shared tasks-ui rpc-handlers`

## Team-leader structural verification — Batch 7

**Gate re-run uncached by the team leader**: `typecheck,test,lint -p shared
tasks-ui rpc-handlers --skip-nx-cache` → _Successfully ran targets for 3
projects_. Lint 0 errors (8 pre-existing `rpc-handlers` warnings, none in the
change set).

**Totals measured at BOTH ends by the team leader, not taken from the report.**
Baselines were captured by `git stash -u` at `34cf9e75b` and re-measured, so
every delta below is a difference of two runs on this machine:

| Project               | HEAD `34cf9e75b`                  | Working tree              | Delta             |
| --------------------- | --------------------------------- | ------------------------- | ----------------- |
| `shared`              | 27 suites / **597**               | 27 / **614**              | **+17**           |
| `rpc-handlers` (jest) | 70 / 1548 + 30 skipped = **1578** | 70 / 1549 + 31 = **1580** | **+2**            |
| `tasks-ui`            | 7 suites / **156**                | 8 suites / **192**        | **+1 suite, +36** |

**No suite dropped anywhere** (27→27, 70→70, 7→8) — the collection-failure
failure mode from gating note G1 did not occur. `tasks-ui`'s +36 reconciles
exactly against the diff: `tasks-store.service.spec.ts` +12, `tasks-view.component.spec.ts`
+7, `task-card.component.spec.ts` +2, the new `task-filter-bar.component.spec.ts`
16, minus 1 renamed-away case = **+36**, and 156 + 36 = 192.

> **One correction to the developer's report.** It gave the `tasks-ui` HEAD
> baseline as **168** and the delta as **+24**. The measured baseline is **156**
> and the delta is **+36**. The end state and the arithmetic are both sound —
> every added test is accounted for — but the reconciliation was performed
> against a baseline that was never actually run. _Measure both ends._

**`npm run test:native -- rpc-handlers`** → EXIT=0, **70 suites, 1578 passed /
2 skipped / 1580 total**. Native @ HEAD is **1576 / 2 / 1578**, so the native
total moved **+2** as well. Identical totals under both runners (1580 = 1580)
with skips collapsing 31 → 2, which is what proves the SQLite half of the new
parity case executed rather than self-skipping. The mechanism is confirmed
sound: the SQL blocks use `describe.skip`, which still _counts_, so a total that
matched while skips differed is exactly the expected signature.
_(A first native run of mine read 1578 total. That was my own instrumentation
error — a `git stash` I had issued concurrently reverted the tree mid-run. Noted
because the next person to run these two runners side by side will see the same
thing if they overlap them: **do not stash while a background jest run is in
flight.**)_

### The `task-filter.ts` reach-back — VERIFIED ADDITIVE

Third reach-back into a committed file this task (after Batch 2's
`task-frontmatter.ts` and Batch 4's `contract.guard.spec.ts`), and it clears the
same bar:

- **Type-level**: `childrenOf` is a _required_ field on `TaskFilterSpec`, so any
  consumer building a literal without it would fail `typecheck`. Every producer
  in the repo spreads `EMPTY_TASK_FILTER` — `ptah-spec.ts:403`,
  `tasks-store.service.ts:270`, `task-filter-bar.component.ts:397`, and all
  spec fixtures. `task-index.store.ts` and `rpc-tasks.types.ts` only _consume_
  the type. Nothing else constructs one. **Zero call sites broken**, and the
  green `typecheck` across `shared`, `tasks-ui`, `rpc-handlers` is the proof.
- **Wire-level**: the schema entry is `.default([])`, so a payload minted before
  this change — an old CLI invocation, a Batch 8 saved view — still parses.
  `task-filter.spec.ts:630` (`TaskFilterSpecSchema.parse({})` equals
  `EMPTY_TASK_FILTER`) is the in-test statement of that and now covers the new
  field for free.
- **No import cycle**: `task-filter.ts → task-view.types.ts` is a new one-way
  edge; `task-view.types.ts` imports only `zod` and `task-spec.types`.
- **Behaviour-level**: `matchesChildrenOf` is guarded by
  `filter.childrenOf.length > 0`, so `EMPTY_TASK_FILTER` reaches none of it.
  The neutral spec is still neutral.

### Rulings

1. **The `childrenOf` facet — RIGHT CALL, upheld.** The alternative was a
   bespoke `.filter()` beside the rollup handler, and FR-C1.5 exists precisely
   to forbid a second predicate. The decisive argument is not tidiness, it is
   that the facet matches on `graph.effectiveParent` — the same map
   `graph.children`/`rollup` is built from — so the number on the badge and the
   number of cards after the click **cannot** drift. `task-filter.spec.ts`
   asserts that identity directly ("returns exactly as many tasks as the parent
   rollup counts"), and the refused-claim case (dangling parent → invisible to
   both `childrenOf` and `children`, still `standalone` for `parentage`) is the
   edge a hand-rolled `.filter()` on `task.parent` would have got wrong. It also
   buys a real capability: `tasks:list` and the CLI can now express the query,
   which a board-local filter never could. The `TaskIdRefSchema` reuse with the
   7-row rejection table is the BR-14 discipline, not a decoration —
   `childrenOf` values are task ids and this is the fourth boundary to run the
   one guard.
2. **The Task 7.3 deferral — ACCEPTED.** A `focused` input that no template
   reads is a dead prop, and dead props are the exact shape the reviewer gate
   rejects; Batch 3's precedent (rollup as a value, not a button that did
   nothing) is correctly cited and this is the same call. It does **not** leave
   Batch 12 harder — Task 12.2 already owns `task-column.component.ts`. It
   **did** leave Batch 10 harder, because Task 10.5's file list stopped at board
   - card while focus must flow board → column → card. **Transfer recorded in
     Task 10.5 above**, along with two pre-existing defects found while ruling on
     it (the `role="button"` card with focusable descendants defeats "one tab
     stop", and unguarded `keydown.enter/space` on the card root makes keyboard
     activation of any descendant _also_ open the detail panel).
3. **`showChildrenOf` merges rather than replaces — UPHELD.** Discarding a
   user's facets on a click is destructive with no undo, and the survivors are
   visible removable chips, so a click landing on zero cards explains itself on
   screen. Both branches are asserted.
4. **`estimateBuckets` over the indexed set — UPHELD.** Counts that label the
   choices in a menu must not collapse as you select from that menu, or they
   stop predicting what the next click does. Pinned by its own test.
5. **`total` on `TaskBoardColumn` — UPHELD, and it is a fix, not a scope
   addition.** §6.1's sketch omitted it; without it an empty column under a
   filter says `No tasks`, which is a false statement about the workspace.
   `TaskColumnComponent.total` defaults to `null` and falls back to
   `tasks().length`, and `hidden()` is clamped at zero, so a standalone use of
   the column is unchanged. The second number appears only while something is
   hidden — `3 of 3` would be noise.
6. **`board` replacing the existing computed — CORRECT**, and at **:301**.
   Line reference fixed in Task 7.1 above.
7. **Out-of-inventory files — ALL ACCEPTED.** `task-filter.ts` + spec is the
   facet, ruled on above. `tasks-rpc.handlers.spec.ts` is one parity row and is
   _load-bearing_: without it the new facet would be the only one of nine not
   proven equal across the in-memory and SQL stores. `task-card.component.ts` +
   spec is FR-B3.3 itself — the rollup cannot become a control anywhere else.
   `task-board.component.ts` and `index.ts` are the forwarding and the export
   the above requires. The two component specs are the view-level half of the
   0-RPC assertion.

### The 16 ms claim — verified STRUCTURALLY, not just by its clock

The timing (1.0–1.9 ms over four runs) is evidence but not proof. The trace is:

- `graph` (`tasks-store.service.ts:389`) reads `allTasks()` and nothing else.
- `allTasks` (:358) reads `_columns()` and nothing else.
- `_columns` is written **only** by `loadBoard` / the `tasks:changed` handler.
- `_filter` and `_sort` are written **only** by `setFilter` / `clearFilter` /
  `setSort` / `showChildrenOf`, all of which touch `_filter`/`_sort` alone.

So no filter or sort signal can reach the graph computed — the dependency edge
runs `filtered → graph`, never back. The test's
`expect(store.graph()).toBe(warmGraph)` is a genuine assertion of that: a
reference change is exactly what a filter-signal read inside `graph` would
produce. Warming the graph before starting the clock is the right call — the
budget is what a _keystroke_ costs, and a keystroke on a rendered board never
pays for the build.

**FR-C1.5 re-verified independently**: exactly two production callers of
`filterTasks` (`task-index.store.ts:145`, `tasks-store.service.ts:434`). The one
remaining `.filter(` over tasks in the store is `tasks-store.service.ts:459`,
set membership against the already-decided `filteredIds()` — plan §6.1's own
line, not a predicate.

**Standing guards**: BR-10 holds (no `[innerHTML]`, no `new RegExp`, no
`bypassSecurity` anywhere in the change set — the single grep hit is the filter
bar's comment _stating_ the rule) · OnPush on both new components · Batch 3's
zero-metadata proof still green (the rollup renders only when `childRollup()` is
non-null, so a metadata-free card never reaches the changed markup) ·
`board/` is no longer zero-diff vs `c6cf19dce`, which is correct — Task 7.3 owns
`task-column.component.ts` and FR-B3.3 owns the card.

### `libs/frontend/tasks-ui/CLAUDE.md` — DEFER, as suggested

One doc pass at the end of the task, not now. The lib is mid-rewrite across
Batches 9, 10 and 12 (saved views, palette, bulk); a pass written at Batch 7
describes a shape that three more batches will invalidate, and re-editing it
each batch spends review attention on prose that is wrong again by the next
commit. The Batch 5 note already carries one open nit for the same pass
("mutating" doing double duty next to `tasks:create`). **Record it as a
task-closing chore, not a batch chore.**

> ## §7 PHASE 4 ACCEPTANCE GATE — ✅ DISCHARGED FOR THE PAIR (Batch 6 `34cf9e75b` + Batch 7 _pending commit_)
>
> All four assertions located, named and green:
>
> 1. **Batch 6's parity block still green** — `tasks-rpc.handlers.spec.ts:1459`,
>    now 21 cases × 2 store impls, and the SQL half provably _executed_ under
>    `test:native` (skips 31 → 2, total unchanged at 1580).
> 2. **0 RPC for a filter or sort change** — `tasks-store.service.spec.ts:479`
>    (every facet set, sort changed, `showChildrenOf`, `clearFilter`, all ten
>    derived signals read, microtask queue drained) plus a second view-level
>    assertion in `tasks-view.component.spec.ts`. The developer mutation-pinned
>    both by injecting `rpc.call('tasks:list', …)` into `setFilter` and watching
>    them fail at `:516` and `:259`.
> 3. **1 000-task recompute < 16 ms** — `tasks-store.service.spec.ts:529`,
>    measured 1.0–1.9 ms, and carrying the structural half
>    (`expect(store.graph()).toBe(warmGraph)`) traced above.
> 4. **Sorting stable, tie-broken by id** — `tasks-store.service.spec.ts:582`:
>    three tasks sharing one `updated`, handed over out of order, id-ascending
>    in **both** directions because the tie-break is unsigned.
>
> The gate is discharged **contingent on two things**, exactly as Phase 3 was:
> `code-logic-reviewer` returning APPROVED, and Batch 7 landing a commit. Batch 6
> is already committed at `34cf9e75b`. **Phase 4 closes when both hold.** Batches
> 9, 10 and 12 may treat the shared-predicate and 0-RPC claims as established.

## Post-review revision — the visual pass, and the second gate run

`code-logic-reviewer`: **APPROVED**, 0 blocking. A `visual-reviewer` then ran on
the team leader's suggestion and returned **NEEDS REVISION** on contrast — five
serious findings on a surface no visual pass had ever examined. All five fixed.

**The systemic finding.** The batch had reintroduced `text-base-content/NN`, the
opacity-modified theme token Batch 3 moved away from. Rebuilding the audit from
the literal theme values (anubis + anubis-light from `tailwind.config.js`, the
built-ins from `daisyui/src/theming/themes`, OKLCH→sRGB via `culori`, translucent
text alpha-blended over its real background) reproduced the reviewer's numbers and
showed the problem is worse than reported — **no opacity level is safe**:

| opacity | anubis | anubis-light | daisyUI dark | daisyUI light |
| ------- | ------ | ------------ | ------------ | ------------- |
| `/30`   | 2.39   | 1.92         | 1.84         | 1.85          |
| `/50`   | 4.48   | 3.28         | 2.82         | 3.05          |
| `/70`   | 7.69   | 6.18         | **4.18**     | 5.53          |

Even `/70` — which the review measured as _passing_ — fails on daisyUI `dark`.
"Raise the floor" was never an available fix; the construct had to go. Replaced
with full-opacity `base-content`, worst case **4.74:1**, hierarchy carried by size
and weight. **Team leader verified the change set introduces no live instance**:
the only survivor is the `aria-hidden` FilterX glyph on the filtered-empty state
(`text-base-content/20`), which is decorative non-text content with the meaning
carried by the copy beside it, and is declared as such in a comment. The two other
matches in the batch are prose inside doc comments, not classes.

**The pin pattern is worth copying.** `task-column.component.spec.ts:129` asserts
the _construct is absent from the rendered tree_
(`expect(classes).not.toMatch(/text-base-content\/\d/)`) rather than asserting a
ratio a jsdom test cannot measure. That is the right shape for a contrast
regression guard: it pins the decision, not a number no runner can compute.
`task-filter-bar.component.spec.ts:95` does the same for `.badge-primary`.

**`badge-primary`**: usage changed only — `tailwind.config.js` **zero diff**,
verified. Recorded for the record: anubis's `primary-content` `#e8e6e1` on
`primary` `#2563eb` is **4.14:1**, a live defect on every `badge-primary` /
`btn-primary` small-text site in the product.

**The rollup** is now `btn btn-outline btn-xs`, which closes two findings at once:
`.btn` sets `cursor: pointer` (`.badge` sets none — it never even got a hand
cursor) and `btn-xs` is **24px** against `badge-xs`'s 12px, meeting SC 2.5.8.
`btn-outline` gives it a border at rest, so it no longer shares a recipe with the
three inert spans beside it, and the rest/hover pair is the
`base-content`/`base-100` inverse — identical ratio in both states, so the
affordance no longer depends on a colour flip that failed.

Both judgement calls **upheld**: `dropdown-end` declined because the bar wraps and
which row a trigger lands on is not knowable at author time (viewport clamp
instead), and the `<summary>` focus ring declared in-component rather than in
`apps/ptah-extension-webview/src/styles.css`, because that stylesheet belongs to
one host and the board also renders in Electron.

### Second gate run — team leader's own numbers, both ends

`typecheck,test,lint -p shared tasks-ui rpc-handlers --skip-nx-cache` →
_Successfully ran targets for 3 projects_, 0 lint errors.

| Project               | HEAD `34cf9e75b` | Committed                      | Delta              |
| --------------------- | ---------------- | ------------------------------ | ------------------ |
| `shared`              | 27 / **597**     | 27 / **614**                   | +17                |
| `rpc-handlers` (jest) | 70 / **1578**    | 70 / 1549 + 31 skip = **1580** | +2                 |
| `tasks-ui`            | 7 / **156**      | 9 / **206**                    | +2 suites, **+50** |

`+50` reconciles exactly against the diff: store spec +12, view spec +7, card spec
+2, new filter-bar spec 20, new column spec **10**, minus 1 renamed-away = **+50**,
and 156 + 50 = 206. No suite dropped (27→27, 70→70, 7→9).

`npm run test:native -- rpc-handlers` → EXIT=0, **1578 passed / 2 skipped / 1580
total** — identical total to the jest runner with skips collapsing 31 → 2, so the
SQL half of the parity case executed.

> **The totals trap fired live during this revision**, twice: a backtick inside a
> template-literal comment broke _collection_ on four suites and then two, and the
> runs reported `135 passed, 135 total` and `171 passed, 171 total` — **green pass
> counts with the total silently down from 206.** Only watching the total caught
> it. This is the third appearance of gating note G1 in this task. **Reconcile
> totals, never pass counts.**

**Phase 4 gate assertions re-verified after the revision** (it touched the
components they run through): 0-RPC pins intact at `tasks-store.service.spec.ts:479`
/ `:516` and `tasks-view.component.spec.ts:252` / `:263`, both re-proved to bite by
injecting `rpc.call` into `setFilter`; perf re-measured 1.902 / 1.295 / 4.053 ms
with `expect(store.graph()).toBe(warmGraph)` at `:579` holding.

_Two small corrections to the hand-off, neither material_: the new column spec has
**10** tests, not 11 (the arithmetic requires 10 — 11 would total 207), and "both
`badge-primary` consumers gone" is true of the two **this batch** introduced; a
third, pre-existing, live one remains at
`task-detail.component.ts:236` (`hover:badge-primary`), untouched by this batch.
**It is not in TASK_2026_183's named file list — add it**, since it is the same
4.14:1 defect and the anubis `primary-content` decision covers it.

> ## §7 PHASE 4 ACCEPTANCE GATE — ✅ DISCHARGED FOR THE PAIR (Batch 6 `34cf9e75b` + Batch 7 `c107e9d09`)
>
> Both contingencies are now met: `code-logic-reviewer` **APPROVED** with 0
> blocking, and Batch 7 is committed. **The gate is discharged. Phase 4 is
> closed.** Batches 9, 10 and 12 may treat the shared-predicate, 0-RPC and
> filter-performance claims as established.

### Precedent recorded — logic approval does not cover a UI surface

**Batch 3 and Batch 7 are now both precedents.** Batch 7 passed
`code-logic-reviewer` with **0 blocking findings** and then failed a visual pass
with **five serious contrast findings**, one of them systemic across four themes.
Logic-plus-structure review is blind to rendered contrast, cursor affordance and
target size by construction — it reads the tree, not the pixels.

**Rule for the remaining UI batches (9, 10, 12, and 13's polish):** a batch that
adds or restyles a rendered surface gets a `visual-reviewer` pass **in addition
to** `code-logic-reviewer`, before the team leader commits. Batch 10 already
carries a manual R10 gate; that is not a substitute — it tests keyboard behaviour,
not colour.

---

# Batch 8 — Phase 5a: saved-views storage + RPC (backend) ✅ COMPLETE

**Commit**: `26c23f190` — _feat(vscode): batch 8 — saved-views storage, rpc and the file-routing gate_
**Reviewer**: `code-logic-reviewer` **APPROVED**, 8/10, confidence HIGH, no blocking issues.
Both non-blocking findings fixed and re-verified before the commit.
**Counter**: **8 / 14 batches complete.**

> ⚠️ **The Phase 5 acceptance gate is NOT discharged here.** Batch 8 is the backend half only.
> **Batch 9 carries the pair gate** — including the R7 reindex-survival check — exactly as in
> Phases 3 and 4. Backend-only batch, so **no visual pass** was taken; Batch 9 takes both a
> `code-logic-reviewer` and a `visual-reviewer` pass.

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `general-purpose`
**Execution Mode**: `sequential`
**Rationale**: A new settings namespace across three platform registrations plus two
RPC methods. Backend half of Phase 5 (V-8). **Three gates must all be satisfied or the
write is silently lost** — see below.
**Tasks**: 5 | **Dependencies**: Batch 6

### Task 8.1 — Settings definitions — **permissive** (F4 / BR-4) ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/backend/settings-core/src/schema/tasks-schema.ts` _(create)_
`TASKS_SAVED_VIEWS_DEF` (`schema: z.array(z.unknown())`, `default: []`) and
`TASKS_ACTIVE_VIEW_ID_DEF` (`schema: z.string()`, `default: ''`), both
`scope: 'global'`, `sensitivity: 'plain'`, `sinceVersion: 1`.
**Deliberately permissive, and the file must carry a comment saying why**:
`BaseSettingsRepository.handleFor()` (`base-repository.ts:36`) `safeParse`s the **whole**
value and falls back to `default` on failure — a strict per-item schema would make one
malformed view discard **every** view, which FR-C2.3 forbids.
**`settings-core` does not depend on `@ptah-extension/shared` (see `cli-subagent-schema.ts`)
and must not start.**

### Task 8.2 — Repository + token + export ✅ COMPLETE

**Files**:

- `D:/projects/ptah-extension/libs/backend/settings-core/src/repositories/tasks-settings.ts` _(create)_
- `D:/projects/ptah-extension/libs/backend/settings-core/src/di/tokens.ts` — `TASKS_SETTINGS: Symbol.for('TasksSettings')`
- `D:/projects/ptah-extension/libs/backend/settings-core/src/index.ts`

### Task 8.3 — **Gate 1**: key routing ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/backend/platform-core/src/file-settings-keys.ts`
`FILE_BASED_SETTINGS_KEYS` (:47) += `'tasks.savedViews'`, `'tasks.activeViewId'`;
`FILE_BASED_SETTINGS_DEFAULTS` (:191) += `[]`, `''`.
**Without this, `VscodeWorkspaceProvider` routes the key to
`vscode.workspace.getConfiguration`, which has no schema for it, and the write is SILENTLY
LOST.** This is the single most skippable, most costly line in Phase 5.

### Task 8.4 — Three platform registrations ✅ COMPLETE

**Files**:

- `D:/projects/ptah-extension/libs/backend/platform-vscode/src/settings/vscode-settings-registration.ts` (beside `CRON_SETTINGS`, :151)
- `D:/projects/ptah-extension/libs/backend/platform-electron/src/settings/electron-settings-registration.ts` (beside :123)
- `D:/projects/ptah-extension/libs/backend/platform-cli/src/settings/cli-settings-registration.ts` (beside :126)

**All three. A missing registration fails only on that one runtime.**

### Task 8.5 — `tasks:getViews` / `tasks:saveViews` ✅ COMPLETE

**Files**:

- `D:/projects/ptah-extension/libs/shared/src/lib/types/task-saved-view.types.ts` _(create)_ — `SavedTaskView`, `SavedTaskViewSchema`, `MAX_SAVED_TASK_VIEWS`, `MAX_SAVED_VIEW_ID_LENGTH`, `MAX_SAVED_VIEW_NAME_LENGTH`
  **CORRECTED by team-leader (Batch 8 verification).** This task text originally named
  `task-view.types.ts`. That location **cannot work**: `task-filter.ts:42` imports
  `TaskIdRefSchema` from `task-view.types.ts` as a **value** and consumes it at module top
  level while building `TaskFilterSpecSchema` (`task-filter.ts:271`,
  `z.array(TaskIdRefSchema)`). Declaring `SavedTaskViewSchema` — which needs
  `TaskFilterSpecSchema` — inside `task-view.types.ts` closes that edge into a **runtime**
  cycle, not a type-only one. `libs/shared` is `type: "commonjs"`, so whichever module loads
  second receives a partially-populated `exports` object and reads `undefined`: either
  `z.array(undefined)` at `task-filter.ts:271` or `filter: undefined` in the saved-view
  schema. **Both load orders break, and typecheck stays green** — the failure is at import
  time. A sibling module depends on both and is depended on by neither, keeping the graph a
  DAG. **Do not fold these exports back into `task-view.types.ts`.** Two tests in
  `task-saved-view.types.spec.ts` fail if anyone does.
- `D:/projects/ptah-extension/libs/shared/src/index.ts` — barrel export for the new module
- `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-tasks.types.ts`
- `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc.types.ts` — **both** `RpcMethodMap` and `RPC_METHOD_ENTRIES`
- `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.schema.ts`
- `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts` — `METHODS` + `register()` + two registrars; inject `SETTINGS_TOKENS.TASKS_SETTINGS`
- `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.spec.ts`

**Gate 3**: `tasks:getViews` runs `SavedTaskViewSchema.safeParse(entry)` **per element**,
drops failures with `logger.warn`, and returns `skipped: n`. A malformed or unreadable
settings file yields `{ views: [], activeViewId: null, skipped: 0 }` — **the board renders**
(NFR-11).
Whole-list replace, mirroring `PTAH_CLI_AGENTS_DEF`; per-view CRUD is client-side arithmetic
plus one write, so create/rename/update/delete/reorder are all **one method**.
`SavedTaskView` carries **only** `{ id, name, filter, sort, order }` — **no task data, no
task ids, no result snapshot** (FR-C2.1).
**BR-1: still no edit to `rpc-handler.ts`.**

**Batch 8 Verification** _(backend half of the Phase 5 gate)_:

- Seeded `[goodView, 42, {bad:1}]` ⇒ 1 view and `skipped: 2`; an unreadable store returns
  `[]` and does not throw
- **`tasks.savedViews` is observed in `~/.ptah/settings.json` on VS Code (gate-1 proof)**
- `npx nx run-many -t typecheck,test,lint -p shared settings-core platform-core platform-vscode platform-electron platform-cli rpc-handlers`

### Team-leader structural verification — Batch 8 ✅ PASSED (pending review + commit)

**Gate re-run uncached by team-leader, both ends measured independently** (`--skip-nx-cache`,
batch-8 paths stashed for the BEFORE end). Every Before/After number and every delta below
was produced by the team-leader, not copied from the report. The reported table matched
exactly — no totals trap.

| Project           | Before    | After         | Δ       | Reconciliation                                  |
| ----------------- | --------- | ------------- | ------- | ----------------------------------------------- |
| shared            | 27 / 614  | 28 / 628      | +14     | `task-saved-view.types.spec.ts`                 |
| settings-core     | 5 / 136   | 6 / 144       | +8      | `tasks-schema.spec.ts`                          |
| platform-core     | 27 / 327  | 27 / 333      | +6      | `file-settings-keys.spec.ts` block              |
| platform-vscode   | 13 / 142  | 14 / 147      | +5      | `vscode-settings-adapter.tasks-routing.spec.ts` |
| rpc-handlers      | 70 / 1580 | 70 / **1602** | **+22** | getViews 8 + saveViews 10 + 4 partial-failure   |
| platform-electron | 15 / 244  | 15 / 244      | 0       | —                                               |
| platform-cli      | 12 / 200  | 12 / 200      | 0       | —                                               |

_(Both ends re-measured a second time after the two reviewer fixes landed. The BEFORE end was
byte-identical to the first run; the only movement anywhere was rpc-handlers 1598 → 1602,
exactly the four new partial-failure tests.)_

`test` EXIT=0 · `typecheck,lint` EXIT=0, **0 errors**. Every lint warning was confirmed to
land outside the batch-8 file set (grep over the full lint output for all 19 paths: no hit),
so the warnings are pre-existing.

**Gate 1 independently proven to bite.** The team-leader removed the two
`FILE_BASED_SETTINGS_KEYS` entries and re-ran the spec: **4 of 5 failed**, each message
naming `FILE_BASED_SETTINGS_KEYS`; the 5th ("proves the double is armed") passed by design.
The hostile `vscode` double throws on both `get` and `update`, which is exactly the
else-branch `VscodeSettingsAdapter.readGlobal`/`writeGlobal` take when
`isFileBasedSettingKey` returns false — i.e. the double sits on the real miss path, not
beside it. Routing entries restored; `git diff --stat` back to 11 insertions.

**BR re-confirmation (direct diff, team-leader):** BR-1 — `rpc-handler.ts` and
`host-profile/manifest.ts` **zero diff**; `'tasks:'` present at `rpc-handler.ts:84`.
BR-5 — `renderFrontmatterBlock` zero occurrences across all 19 files. BR-6 — `libs/backend/task-specs/`
zero diff; no diff **hunk** touches `adoptFolder` or `registry-generator` (the grep hits in
`tasks-rpc.handlers.ts` are pre-existing lines). BR-7 — no forbidden literal in any changed
or new file. BR-13 — `persistence-sqlite/` and `task-specs/` zero diff, so **not triggered**;
`npm run test:native` correctly not required. BR-14 — `TaskIdRefSchema` imported, never
re-declared; no `Object.keys(p).length` check.

**FR-C2.1 upheld.** `SavedTaskView` is `{ id, name, filter, sort, order }` — no task data, no
result snapshot. `filter.childrenOf` does carry task ids, but as a **filter criterion**
("show children of X"), not a cached match set; that is a lens parameter and is in scope.

**Isolation upheld.** `settings-core` gained **no** `@ptah-extension/shared` dependency — the
five grep hits for that string are all inside comments; no import, and its `package.json` has
no dependency block.

**All three platform registrations present** (vscode :152, electron :124, cli :127), each
beside `CRON_SETTINGS` and each constructing `TasksSettings(reactiveStore)`.

**Post-review fixes verified (team-leader).** Both `code-logic-reviewer` findings were fixed
before the commit and both were re-verified independently:

1. **A landed write is no longer reported as failed.** The two settings keys are two
   whole-file writes and cannot be made atomic, so they are attempted and reported
   separately. `savedViews` failing returns `WRITE_FAILED` / _"Nothing was changed."_ and the
   pointer write is **unreachable** — the failure branch `return`s, so a pointer can never
   outlive the list it points into (read and confirmed at the control flow, not just the
   test). `activeViewId` failing returns `success: true` with
   `warning: { code: 'ACTIVE_VIEW_ID_NOT_SAVED' }`. **Mutation-checked by team-leader**:
   collapsing the two `try` blocks into one fails **3 of 4** new tests; the logging test
   correctly still passes, since both shapes log.
2. **Dead union member removed.** `TasksSaveViewsResult.error.code` is
   `'CAP_EXCEEDED' | 'WRITE_FAILED'`. Confirmed `INVALID_PARAMS` is absent from the type (the
   remaining occurrences in `rpc-tasks.types.ts` belong to other result shapes where it
   legitimately reaches the wire) and that the only consumers are `rpc.types.ts`, the handler
   and the spec.

The tightened `WRITE_FAILED` test was confirmed to assert `warning` is undefined,
`activeViewId.set` was never called, and no `.ptah` path reaches the wire.

> 🔁 **Flake note (`TASK_2026_182`) — no reproduction.** The reviewer saw
> `filterTasks — scale › filters 1 000 tasks … well inside a frame`
> (`task-filter.spec.ts:959`, wall-clock `expect(elapsed).toBeLessThan(16)`) fail once and
> correctly reported it rather than re-running past it. **It did not flake for the
> team-leader across four full uncached `shared` runs** (two BEFORE, two AFTER) — 614/614 and
> 628/628 every time. That is corroborating evidence for the `TASK_2026_182` diagnosis
> (timing-sensitive under machine load, not a regression: the file is Batch 6/7 work, was
> untouched this round, and the only `libs/shared` change was type-level and erased at
> runtime). Recorded here as a **second observation** for that task.

**Rulings on the developer's five decisions** — all five UPHELD; see the return report.
Out-of-inventory files (shared barrel, `rpc.types.ts` dual registration, 4 extra
`new TasksRpcHandlers(...)` ctor sites, `file-settings-keys.spec.ts`, 3 new specs) all
accepted as mechanically required.

> ⚠️ **Pre-existing inconsistency, NOT a Batch 8 defect, no action this batch.**
> `schema/index.ts` still instructs "Add new definitions to their domain schema file, then
> include them here", but `CRON_SETTING_DEFS`, `MEMORY_SETTING_DEFS` and
> `SKILL_SYNTHESIS_SETTING_DEFS` already omit themselves from `SETTINGS_SCHEMA`. Batch 8
> follows those three, not the older `PTAH_CLI_AGENTS_DEF`. Correct call — `tasks.*` needs no
> migration entry and no generated settings form. The stale docblock is worth a separate
> cleanup task.

### 🔗 Contracts Batch 9 MUST honour (established by Batch 8)

1. **`tasks:getViews` returns views ALREADY SORTED by `order`**, with a stable
   surviving-position tie-break. The menu **must not** re-sort assuming insertion order, and
   must not assume `order` equals the array index — `order` is deliberately not the index
   because every mutation is a whole-list replace.
2. **The 50-view cap is enforced in the handler, not by Zod.** Over-cap requests return
   `{ success: false, error: { code: 'CAP_EXCEEDED', message } }` — a **typed, resolved
   result**, not a thrown `INVALID_PARAMS`. Batch 9 must render `error.message` (it names the
   limit) rather than treating it as a transport failure. **Nothing is saved** on cap
   rejection — the write is all-or-nothing.
3. **Duplicate view ids are refused at the boundary** (`INVALID_PARAMS`, thrown). The client
   owns id generation and must guarantee uniqueness before sending.
4. **`activeViewId` is reconciled, never rejected.** An id naming no view in the submitted
   list is stored as `''` and returned as `null` — that is what deleting the active view
   looks like. Batch 9 must treat `activeViewId: null` as "no active view", not as an error.
   Omitting the key leaves the stored value alone; sending `null` clears it.
5. **`skipped: n` is a real signal.** A malformed entry is dropped and counted while the rest
   load; the board always renders (NFR-11). Batch 9 should surface a non-zero `skipped`
   rather than silently ignoring it.
6. **`tasks:saveViews` is a whole-list replace.** Create/rename/update/delete/reorder are all
   client-side arithmetic plus one write. There is no read-modify-write server-side.

---

# Batch 9 — Phase 5b: saved-views menu (frontend) ✅ COMPLETE

**Commit**: `a2d36a24c` — `feat(vscode): batch 9 — the saved-views menu and the r7 durability proof`
(12 files, 3807 insertions). All hooks passed — `lint-staged`, `ptah-electron:validate-deps`
and `commitlint`. Nothing bypassed.
**Reviewer verdicts**: `code-logic-reviewer` **APPROVED** · `visual-reviewer` **APPROVED**.
**Final gate**: 2 further uncached runs green at commit time, byte-identical totals —
shared **628**, settings-core **144**, rpc-handlers **1606** (31 skipped), tasks-ui **294**.
Across the batch: **5 full gate runs + 20 targeted runs, 0 failures, 0 Nx flaky warnings.**

> **Team-leader structural verification — round 2.** All findings from round 1 are fixed and
> re-verified **by repeating the original mutations**, not by reading the fix. Change set is
> **12 files**, nothing foreign. **Awaiting both reviewer verdicts. Not committed.**
>
> **Gate stability — characterized, not sampled once.** Round 1 measured 1-in-2 failures.
> Round 2: **3 consecutive full uncached gates, all green, zero Nx flaky-task warnings**, plus
> **10 consecutive targeted runs of each previously-flaky suite** — 13 clean samples each,
> 0 failures. At the round-1 failure rate that outcome has probability ~1e-4. Stability is
> established.
>
> **The ceilings still discriminate.** Dropping both to 0.05 ms turns both red — measured warm
> medians on this machine **0.43 ms** (store) and **0.71 ms** (shared predicate), so the 16 ms
> ceiling retains ~37x and ~22x headroom. Keeping the budget was the right call: it still traps
> the quadratic-predicate and per-call-graph-rebuild regressions it exists for.
>
> **`expect(store.graph()).toBe(warmGraph)` is byte-identical to HEAD** — the diff contains no
> `+`/`-` line touching it. The structural half of the perf test survived the timing rewrite.
>
> **`nextViewId` collision branch now genuinely pinned.** Repeating the round-1 deletion
> mutation (`return base;`) now fails **3** tests; in round 1 it failed **0**.
>
> **Executor asymmetry fixed at both sites** — the set is built trimmed AND the lookup trims.
> Defensive on both sides, so it does not depend on `buildTaskGraph` continuing to trim.
>
> **R7 (carried from round 1, still valid).** Verified by mutation: emptying the settings file
> after the warm read turns the cold read RED while every warm assertion above it PASSES. The
> no-`better-sqlite3` substitute is **ruled sound** — `task-specs` has zero import of
> `settings-core`, so the real index has no route to settings the substitute could hide, and
> `tasks-rpc.handlers.spec.ts:558,1638` already self-skip on the ABI gate.
>
> **Two open items, both documentation-level, neither blocking:**
>
> 1. The root-cause note in `task-filter.spec.ts` attributes the **62 ms** observation to itself.
>    That reading came from `tasks-store.service.spec.ts`, which already used `performance.now()`
>    — so `Date.now()` granularity explains the _shared_ suite's flake but **not** the store
>    suite's. Two distinct causes; the median fixes both, but the comment conflates them.
> 2. The reconciliation line `37 + 29 + 29 + 28 + 69 = 294` sums to **192**. Those are the five
>    changed suites; the six unchanged tasks-ui suites supply the remaining **102**. Components
>    all correct, arithmetic mis-stated.

**Recommended Executor**: `frontend-developer`
**Fallback Executor**: `general-purpose`
**Execution Mode**: `sequential`
**Rationale**: Frontend half of Phase 5 (V-8). **The Phase 5 acceptance gate — including the
R7 reindex-survival check — is asserted here.**
**Tasks**: 3 | **Dependencies**: Batch 7, Batch 8 (`26c23f190`)
**Reviews**: `code-logic-reviewer` **and** `visual-reviewer` — **both**, per the Batch 7
precedent. Logic-plus-structure approval is blind to contrast, cursor affordance and target
size by construction, so a frontend batch cannot be discharged on a logic pass alone.

> ## 🛑 READ FIRST — the six contracts Batch 8 froze
>
> The backend for this batch is already committed at `26c23f190`. It has opinions, and four
> of them are the kind a frontend developer discovers by shipping a bug. **Read all six
> before writing the service.**
>
> ### 1. ⚠️ `tasks:getViews` ALREADY SORTS BY `order` — DO NOT RE-SORT
>
> **This is the one most likely to bite.** The handler returns views sorted by `order` with a
> stable surviving-position tie-break. Three consequences:
>
> - **Do not re-sort** the array in the service, the store or the menu template.
> - **`order` is NOT the array index.** It is deliberately a separate field, because every
>   mutation is a whole-list replace and an index would be a second fact about the same thing
>   that can disagree. Never derive one from the other.
> - **Do not assume insertion order.** A view created last can sort first.
>
> Reorder = rewrite the `order` values and send the whole list.
>
> ### 2. `CAP_EXCEEDED` is a RESOLVED RESULT, not a thrown error
>
> Over-cap returns `{ success: false, error: { code: 'CAP_EXCEEDED', message } }` — the
> promise **resolves**. A `try/catch` alone will not see it. `error.message` already names the
> limit (50) and says nothing was saved; **render it** rather than substituting a generic
> "save failed". The write is all-or-nothing — **nothing** was persisted.
>
> ### 3. `WRITE_FAILED` vs the `ACTIVE_VIEW_ID_NOT_SAVED` warning
>
> `success: true` may arrive **with** `warning: { code: 'ACTIVE_VIEW_ID_NOT_SAVED', message }`.
> That is a success: the views **are** on disk and only the active-view pointer did not
> record. Its message ends _"There is nothing to save again"_ — so do **not** offer a retry
> and do **not** render it as a failure. `WRITE_FAILED` is the opposite: nothing was changed.
>
> ### 4. `activeViewId: null` means "no active view" — NOT an error
>
> The backend reconciles rather than rejects. Deleting the active view is normal, and the next
> read returns `activeViewId: null`. Treat `null` as "no view selected". On write: **omitting**
> the key leaves the stored value alone; sending `null` **clears** it. These are different —
> do not send `null` when you mean "unchanged".
>
> ### 5. Duplicate ids are refused at the boundary (thrown `INVALID_PARAMS`)
>
> The **client owns id generation**. Two views sharing an id is rejected outright, so generate
> collision-free ids and never copy an id when duplicating a view.
>
> ### 6. `skipped: n` is a real signal — surface it
>
> A malformed stored view is dropped, counted and the rest still load; the board always
> renders (NFR-11). A non-zero `skipped` means the user silently lost something. Tell them.
> Do not discard the field.
>
> ### Also binding on this batch
>
> - **`TASK_2026_183` owns the surface-wide opacity sweep.** Batch 9 must introduce **no new**
>   `text-base-content/NN` on any informational element. Follow **Batch 7's pattern**: pin the
>   construct's _absence from the rendered tree_, not a contrast ratio — jsdom cannot compute
>   a ratio, so a ratio assertion would be theatre.
> - Standing: OnPush mandatory, signals + `inject()`, no `[innerHTML]` on any view `name`
>   (untrusted free text — interpolation only, BR-10), R11 (no `tasks-ui → editor` edge),
>   BR-7 (no forbidden path literal in source, comments **or** fixtures).

### Task 9.1 — View service ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/services/task-views.service.ts` _(create)_
Saved-view CRUD over `tasks:getViews` / `tasks:saveViews`; modified-vs-saved tracking.

### Task 9.2 — View menu ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/filter/task-view-menu.component.ts` _(create)_
View list, create/rename/update/delete/reorder, **cap message**, modified badge.
BR-10: view names are `{{ interpolation }}` only.

### Task 9.3 — Wiring + stale-facet annotation ✅ COMPLETE

**Files**:

- `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts`
- `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/index.ts`
- `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/filter/task-filter-bar.component.ts`
  — **corrected by team-leader at verification.** The original two-file list was wrong: the
  stale-facet note is a property of `TaskFilterChip` and is computed in the filter bar's
  `chips` computed, which is the only place that knows both the spec and
  `knownLabels`/`knownExecutors`. It cannot land in either originally-named file. Reported by
  the developer rather than silently absorbed, which is the correct handling of a wrong
  inventory (NFR-15).

A view naming a vanished label or executor **still applies**, matches nothing on that facet,
and the chip carries a "no longer present in this workspace" note computed against
`graph().knownLabels` / `knownExecutors`. **Nothing is auto-pruned** (FR-C2.4).

**Batch 9 Verification** _(§7 Phase 5 gate — the full pair)_:

- **R7**: create a view → **delete `~/.ptah/ptah.db`** → `tasks:reindex` → **the view survives**
  — landed as `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.views-durability.spec.ts`
  (4 tests), which the original three-task inventory did not name either. Added by
  team-leader at verification for the same reason as the filter-bar file above.
- A malformed entry is skipped, `skipped` reported, the rest load
- An unreadable settings file still renders the board
- The 50-view cap produces a clear message
- `npx nx run-many -t typecheck,test,lint -p shared tasks-ui settings-core rpc-handlers`

**Two further files entered the change set in round 2**, both perf-assertion rewrites forced by
the team-leader's flaky-gate escalation. Neither is saved-views work; both are recorded here
because they ship in this commit:

- `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/services/tasks-store.service.spec.ts`
- `D:/projects/ptah-extension/libs/shared/src/lib/types/task-filter.spec.ts`

**Independently re-measured reconciliation** (team-leader, per-file, uncached):

| Project       | Before    | After         | Δ                                                                                                |
| ------------- | --------- | ------------- | ------------------------------------------------------------------------------------------------ |
| shared        | 28 / 628  | 28 / 628      | 0 — `task-filter.spec.ts` 78 `it()` at HEAD and now; the scale test was **rewritten**, not added |
| settings-core | 6 / 144   | 6 / 144       | 0 — no batch file touches the project                                                            |
| rpc-handlers  | 70 / 1602 | 71 / **1606** | +1 suite / +4 — durability spec measured alone at exactly 4                                      |
| tasks-ui      | 9 / 206   | 11 / **294**  | +2 suites / +88                                                                                  |

tasks-ui delta, measured per file: new `task-views.service.spec` **37** + `task-view-menu.component.spec`
**29** = 66; modified `task-filter-bar.component.spec` 20→**29** (+9), `tasks-view.component.spec`
15→**28** (+13), `tasks-store.service.spec` 69→**69** (+0). 66 + 9 + 13 + 0 = **88**. Skips
unchanged at 31. All eleven tasks-ui suites enumerated and measured: store 69, views service 37,
filter bar 29, view menu 29, tasks-view 28, card 26, metadata editor 22, relations 22, detail 17,
column 10, start service 5 = **294**.

**Progress**: 9/14 batches complete

---

## 🏁 §7 PHASE 5 ACCEPTANCE GATE — **DISCHARGED FOR THE PAIR**

**Batch 8 (`26c23f190`) + Batch 9 (`a2d36a24c`).** Both halves committed, both reviewed —
Batch 9 by `code-logic-reviewer` **and** `visual-reviewer`, both APPROVED.

**R7 is the centrepiece, and it is proven rather than asserted.** A saved view survives deleting
the index database and running `tasks:reindex`, because views live in `~/.ptah/settings.json` and
never in the index. The proof is a **cold read** — a second store, repository and handler set that
share no memory with the writer — because `ReactiveSettingsStore` keeps a read-through cache and a
same-process read is therefore satisfiable by a process that never touched the disk. Verified by
mutation twice, independently: emptying the settings file after the warm read turns the cold read
RED while every warm assertion above it still PASSES.

Also discharged: a malformed stored entry is skipped, counted and the rest still load (FR-C2.3);
an unparseable settings file still renders a full board (NFR-11); the 50-view cap resolves as a
typed result whose message is rendered verbatim; and a view naming a vanished label or executor
still applies, still matches nothing, and is annotated rather than pruned (FR-C2.4).

---

## 📌 REVIEW HEURISTIC FOR THE REMAINING BATCHES — check the claim against the code

This task produced **three separate cases of a comment or a test name asserting something its own
code did not do**. None was caught by reading the prose; all three were caught by checking the
claim against the implementation.

| Case                            | The claim                                                         | What the code did                                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nextViewId` (Batch 9)          | a test named _"terminates when the drawn token is already taken"_ | drew a fresh UUID that was never in the taken set — the loop was never entered, and deleting the entire collision branch still passed                |
| Stale-facet executors (Batch 9) | a comment saying executors compare on _"the raw trimmed value"_   | compared **raw**, no trim — while the predicate trimmed both sides, so a view could match tasks and be labelled "no longer present" at the same time |
| Perf docblock (Batch 9)         | a root-cause note citing a 62 ms `Date.now()` failure             | that file already used `performance.now()`; the 62 ms reading belonged to a different suite with a different cause                                   |

**The rule**: a docblock or a test name is a claim, not evidence. For any load-bearing assertion,
run the mutation that should kill it. A test that cannot fail is not a check — the same reasoning
already written into the R7 spec's own rejection of `better-sqlite3`. This is cheap: each of the
three above took one mutation to expose.

---

# Batch 10 — Phase 6: command palette + board keyboard navigation ✅ COMPLETE

**Commit**: `ed840f9d2` — 17 files, 3 771 insertions, 10 deletions, all under
`libs/frontend/tasks-ui`. Staged path-scoped; zero foreign files swept in.
**Counter**: **10 / 14 batches complete.**
**Reviews**: `code-logic-reviewer` **APPROVED**, `visual-reviewer` **APPROVED**.
**Gate**: `typecheck,test,lint -p tasks-ui --skip-nx-cache` → exit 0, **16 suites,
409 tests**, lint clean. Re-run independently by the team leader post-fix-round; the
eighth clean full-suite run at 409.

> ### Phase 6 gate: DISCHARGED EXCEPT R10
>
> Every automatable line is green and verified independently. **R10 — the manual
> cross-host palette-shortcut check — is NOT performed and NOT passed.** It is carried
> forward as an open item against **Phase 6 sign-off**, per the user's decision, and does
> not block Batch 10 or Batch 11. See _OPEN — Phase 6 sign-off: the R10 manual checklist_
> below. `"keybindings": []` must never be cited as closing it.

**Recommended Executor**: `frontend-developer`
**Fallback Executor**: `general-purpose`
**Execution Mode**: `sequential`
**Rationale**: Pure `tasks-ui` frontend. Lands **before** Batch 12 per Q4 — C6 before C4.
Carries the R11 ratchet and the R10 manual gate.
**Tasks**: 6 | **Dependencies**: Batch 7 (`c107e9d09`), Batch 9 (`a2d36a24c`)
**Reviews**: `code-logic-reviewer` **and** `visual-reviewer` — both, per the Batch 7 precedent.
The R10 manual gate tests **keyboard**, not colour; it is not a substitute for the visual pass.

> ## 🛑 READ FIRST — this batch carries more inherited debt than any before it
>
> ### 1. The R11 ratchet is this batch's own deliverable, not a formality
>
> The Nx boundary lint **provably cannot** catch a `tasks-ui → editor` edge: both libs carry
> identical `scope:webview` + `type:feature` tags, and **no `sourceTag: 'platform:angular'`
> constraint exists anywhere in `eslint.config.mjs`** — tasks-ui's extra tag has no
> `depConstraints` entry at all. A source ratchet is the only thing that will catch it.
> Its comment must say this, so the next reader does not delete it as redundant with lint.
>
> ### 2. Two PRE-EXISTING keyboard defects are yours to fix (Task 10.5)
>
> Both were recorded at the Batch 7 gate and neither is a Batch 7 regression:
>
> - **"One tab stop, not 181" cannot hold as written.** The card root is
>   `<div role="button" tabindex="0">` holding **~~3–4 focusable `<button>` descendants~~**
>   — **CORRECTED AT THE BATCH 10 GATE: ten focusable descendants, eleven nodes including
>   the root.** The count of 3–4 missed the daisyUI dropdown's own `<ul tabindex="0">`
>   container, its **six** status-option buttons, and the isolate checkbox `<input>`.
>   The full set is: root, status-menu trigger, menu container, six status options, isolate
>   toggle, Start — plus the parent crumb on cards that have a parent (twelve there).
>   **Measured, not read**: a three-card board carries 33 focusable nodes; before the fix all
>   33 were tab stops, i.e. `~11 × 181 ≈ 1 991` on the 181-task board, not `~4 × 181`.
>   After the fix: **11**, every one inside the focused card.
>   **The descendants need roving too.**
> - **Keyboard activation double-fires.** Descendants stop only `click`, while the card's
>   `(keydown.enter)` / `(keydown.space)` are unguarded — so activating any descendant by
>   keyboard emits its action **and** `selectTask`. Documented consequence: Enter on the rollup
>   narrows the board to a parent's children **excluding the parent** while opening the detail
>   panel for that now-invisible parent. Batch 7's assertion drives `.click()` and proves the
>   **mouse** path only. **Assert the keyboard path.**
>
> ### 3. Task 7.3's transfer lands here
>
> Batch 7 deliberately did not ship the focus/selection input forwarding, because a `focused`
> input no reader consumes is a dead prop. That deferral was **accepted**, so the forwarding is
> yours to add beside the code that reads it. Note the shape: focus flows
> **board → column → card** — the original file list stopped at board + card. The `selection`
> half needs nothing; `TaskColumnComponent.selectedTaskId` already exists and already forwards.
>
> ### 4. The R10 manual gate
>
> The palette shortcut verified on **both VS Code and Electron**, stealing nothing from the
> host. No automated harness covers host keybinding capture. It tests keyboard only.
>
> ### 5. The Batch 5 private-member test access is a single RECORDED EXCEPTION, not licence
>
> Do not cite it as precedent for reaching into private state in this batch's specs.
>
> ### 6. Standing — and the heuristic above applies to every claim you write
>
> `host:`-bound keydown **never** `window`/`document` (R10); every key ignored inside
> `<input>` / `<textarea>` / `[contenteditable]`; **BR-8 — no run action, `TaskStartService`
> is not imported** (R12); no new runtime dependency (FR-C6.9); OnPush, signals + `inject()`;
> BR-10 on any rendered task title. **Before you write a docblock or name a test, run the
> mutation that should kill the assertion** — this task has already produced three claims that
> its own code did not honour.

### Task 10.1 — Matcher ✅ COMPLETE

**Files**:

- `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/palette/palette-match.ts` _(create)_
- `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/palette/palette-match.spec.ts` _(create)_

Hand-rolled subsequence matcher + ranking. **No new runtime dependency** (FR-C6.9).
Spec: **prefix outranks interior**; subsequence match; empty query.

### Task 10.2 — Entry catalogue ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/palette/palette-entries.ts` _(create)_
Entries + disabled-with-reason predicates. **BR-8: NO run action. `TaskStartService` is not
imported** (R12).

### Task 10.3 — Palette component ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/palette/task-command-palette.component.ts` _(create)_
**Local to `tasks-ui`** (FR-C6.8). Reuses `KeyboardNavigationService` from
`@ptah-extension/ui` (`scope:webview` + `type:ui` — an allowed edge).
A11y: `role="dialog"` + `aria-label`; the result list is `role="listbox"` with
`aria-activedescendant` tracking `KeyboardNavigationService.activeIndex`; the active option
is `scrollIntoView({ block: 'nearest' })`; `document.activeElement` is **captured on open and
restored on close**. Selection-scoped actions are **listed but disabled with a stated reason**
when the selection is empty — **never hidden**.

### Task 10.4 — Host-scoped keydown ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts`
`host: { '(keydown)': 'onKeyDown($event)' }` — **bound to the host element, NEVER to `window`
or `document`** (R10). `preventDefault()` + `stopPropagation()` **only** when the event was
consumed. **Every key is ignored while the target is an `<input>`, `<textarea>`, or
`[contenteditable]`.** Trigger `Ctrl/Cmd+K`, **plus an always-visible toolbar button — the
button is the contract, the shortcut is the convenience.**

### Task 10.5 — Roving tabindex ✅ COMPLETE

**Files**:

- `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/board/task-board.component.ts`
- `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/board/task-column.component.ts` **(transferred from Task 7.3 at the Batch 7 gate)**
- `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts`

**Transferred from Task 7.3.** Batch 7 was asked to forward "focus/selection
inputs (consumed in Batches 10, 12)" and deliberately did not, because a
`focused` input no reader consumes is a dead prop — the same call Batch 3 made
when it rendered the rollup as a value rather than a button that did nothing.
The team-leader **accepted that deferral**, so the forwarding is Batch 10's to
add beside the code that reads it. Note the shape: focus flows
board → **column** → card, and this task's original file list stopped at
board + card. The column edit is one input plus one binding.
(The `selection` half needs nothing: `TaskColumnComponent.selectedTaskId`
already exists at :99 and already forwards to the card at :64.)

`TaskBoardComponent` owns one `focusedTaskId` signal; each card renders
`[attr.tabindex]="focused() ? 0 : -1"` and `[attr.data-task-id]`. Arrow keys move
`focusedTaskId` across the **filtered** column model. **The board is one tab stop, not 181.**

> **The "one tab stop" claim does not hold as written — found at the Batch 7 gate.**
> The card root is `<div role="button" tabindex="0">` and already contains
> ~~three-to-four~~ focusable `<button>` descendants.
>
> **⚠️ COUNT CORRECTED AT THE BATCH 10 GATE — do not carry "three-to-four" into
> Batch 12.** The real figure is **ten focusable descendants (eleven nodes with the
> root)**, and it was measured on a rendered board rather than read off the template:
> root, status-menu trigger, the daisyUI dropdown's own `<ul tabindex="0">`, its
> **six** status options, the isolate `<input>`, and Start — twelve on a card that
> also renders the parent crumb. The three-to-four figure counted only the buttons a
> reader notices and missed the menu container, five of the six options, and the
> checkbox. So the board was `~11 × 181 ≈ 1 991` tab stops, **not `~4 × 181`**.
> Verified independently at this gate: 33 focusable nodes on a three-card board,
> 33 stops before the fix and 11 after, all 11 inside the focused card.
>
> The descendants need the roving treatment too. **This is pre-existing, NOT a Batch 7
> regression** — Batch 7 added one more instance of a pattern Batch 3 established.
> (Line references in this block have drifted and were dropped; every site was
> relocated by structure at the Batch 10 gate.)
>
> **Related keyboard defect, same root, also pre-existing.** Every descendant button
> stops only `click`. The card root's `(keydown.enter)` (:74) and `(keydown.space)`
> (:75) are unguarded, so activating any descendant **by keyboard** emits that
> button's action **and** `selectTask` — Enter on the rollup filters the board and
> opens the detail panel. Batch 7's own assertion ("emits the PARENT id from the
> rollup, and does not open the card") drives `.click()` and so proves the mouse
> path only. Batch 10 owns keyboard; fix it there and assert the keyboard path.
> `Space` toggles selection, `Enter` opens detail, `Escape` clears a non-empty selection and
> otherwise closes the detail panel. Visible focus ring meeting WCAG 2.1 AA (NFR-12).

### Task 10.6 — **The R11 ratchet** ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/no-editor-dependency.spec.ts` _(create)_
Walks `libs/frontend/tasks-ui/src` and asserts **no file matches `@ptah-extension/editor`**.
The comment must state **why** it exists: the Nx boundary lint **cannot** catch this — both
libs carry `scope:webview` + `type:feature`, `eslint.config.mjs` permits both edges, and
tasks-ui's extra `platform:angular` tag has **no** `depConstraints` entry at all (BR-2, F2,
verified). Runs under `-p tasks-ui` in the NFR-14 gate.

**Batch 10 Verification** _(§7 Phase 6 gate)_:

- `no-editor-dependency.spec.ts` green
- Full keyboard operation with **no mouse**
- `role="dialog"` / `role="listbox"` / `aria-activedescendant` asserted
- Prefix outranks interior in the ranker
- **MANUAL (R10)**: the shortcut is verified on **VS Code and Electron** and steals nothing
  from the host. No automated harness covers host keybinding capture.
- `npx nx run-many -t typecheck,test,lint -p tasks-ui`

---

## Batch 10 structural verification — team-leader gate

**Gate re-run uncached by the team leader**: `typecheck,test,lint -p tasks-ui
--skip-nx-cache` → **exit 0, 16 suites, 396 tests, ~18 s**. Matches the developer's
runs 4–6 exactly.

> ⚠️ **Superseded — these were the PRE-fix-round figures.** The fix round moved the count.
> **Post-fix gate, re-run uncached by the team leader: exit 0, 16 suites, 409 tests, lint
> clean.** That is the number Batch 10 commits against, and it is the eighth independent
> clean full-suite run at 409. Both R11 injections were repeated from scratch against the
> edited ratchet rather than carried over — see the narrowed claim below.

### The three claims were reproduced, not accepted

| Claim                        | Reproduction                                                                                           | Result                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tab-stop arithmetic          | Read the rendered assertion; recomputed per-card                                                       | **33 focusable / 33 stops before / 11 after** on a 3-card board — confirmed, and it revealed the note's count was wrong (see the correction above) |
| Keyboard guard discriminates | Deleted **both** `event.target !== event.currentTarget` guards, re-ran                                 | **Exactly 5 red**, all five the `does NOT …` tests; the positive Enter/Space tests stayed green. 391 passed                                        |
| R11 ratchet + lint blindness | Injected `@ptah-extension/editor` package import; separately a relative `../../../../../editor/…` path | See the narrowed claim below — **re-run from scratch post-fix**, because the docblock fix edited the ratchet itself                                |

### R11 — the NARROWED claim, verified independently in both directions

The original docblock overclaimed. The corrected claim is asymmetric, and the asymmetry is
the point:

| Injected form                                            | `nx lint tasks-ui`                                                                                                                              | The ratchet        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **Package specifier** `from '@ptah-extension/editor'`    | ✅ **"All files pass linting"** — blind                                                                                                         | ❌ fails **alone** |
| **Relative reach-back** `from '../../../../../editor/…'` | ❌ **fails** — `@nx/enforce-module-boundaries`: _"Projects cannot be imported by a relative or absolute path, and must begin with a npm scope"_ | ❌ fails           |

**So the ratchet is load-bearing for exactly ONE form** — the package specifier, which is
the form anyone would actually write — and belt-and-braces for the other. That is a
narrower claim than "the lint cannot catch this edge", and it is the true one. Anyone
tempted to delete the ratchet because they saw lint catch a relative path has tested the
form lint _does_ catch and concluded the wrong thing.

A fourth, unrequested check: deleting the `reindex` dispatch arm fails typecheck with
`TS2322: Type '{ readonly kind: "reindex"; }' is not assignable to type 'never'`. The
exhaustiveness guard is load-bearing, not decorative.

### Standing constraints verified

- **BR-8 / R12** — no `TaskStartService` import anywhere under `palette/` (sole hit is a
  docblock naming the prohibition). Asserted structurally across the whole catalogue.
- **FR-C6.8** — the palette is local to `tasks-ui`; the only cross-lib edge is
  `KeyboardNavigationService` from `@ptah-extension/ui` (an allowed edge).
- **FR-C6.9** — no `package.json` change; no new runtime dependency.
- **R10 host-binding** — `host: { '(keydown)': 'onKeyDown($event)' }` on both
  `TasksViewComponent` and `TaskBoardComponent`; **zero** `window.`, `document.` or
  `@HostListener` occurrences in either.
- **BR-10 / selector interpolation** — **none survives in production code**. The only
  `[data-task-id="${id}"]` in a non-spec file is inside a docblock explaining why
  `focusCardElement` reads the attribute off candidates instead.

### The `KeyboardNavigationService` clamp → **`TASK_2026_184`** (BUGFIX, `libs/frontend/ui`)

Ruled at this gate: a **shared-lib defect needing its own task**, not acceptable as merely
worked around. `configure()` (`keyboard-navigation.service.ts:100-110`) **clamps** to
`itemCount - 1` rather than resetting, so a narrowed list leaves the active index on a
stale row. Live victim traced:
`libs/frontend/chat/.../unified-suggestions-dropdown.component.ts:140` configures from
`suggestions().length` inside an effect and **never resets**; it owns a `resetFocus()` at
`:268` that this path does not call. Type to narrow, press Enter, insert the wrong file.
`code-logic-reviewer` added `native-autocomplete.component.ts` as sharing the risk
unguarded. `effort-selector`, `model-selector` and `agent-selector` are fixed-length and
immune.

**The tasks-ui workaround stays** — configure + `setActiveIndex(0)` synchronously in
`onQueryChange`, eager rather than waiting for the effect. Fixing the shared method changes
behaviour for four consumers that depend on today's semantics, which is exactly why a
drive-by fix in this batch would have been wrong.

> ⚠️ **Carried into `TASK_2026_184`**: any test written there must narrow to **more than
> one** remaining item. Batch 10 shipped a test named _"resets the active row when the query
> narrows the list"_ that **could not fail** — its fixture narrowed to exactly one match,
> which the clamp alone satisfies. Same trap, easy to walk into twice.

### 🔴 R10 manual gate — OUTSTANDING, NOT PASSED

**Batch 10 is not blocked by this.** Per the user's decision at the Batch 10 gate, R10 is
carried forward as an explicitly open item against **Phase 6 sign-off**, not against
Batch 10. Batch 10 commits with every automatable line green and this one manual line
outstanding. See **OPEN — Phase 6 sign-off: the R10 manual checklist** below, which is the
item of record.

The developer did **not** perform it and did **not** claim to. Its circumstantial evidence
was verified and holds: `apps/ptah-extension-vscode/package.json` carries
`"keybindings": []`, and no `ctrl+k` / `CmdOrCtrl+K` accelerator exists in the VS Code or
Electron sources. That proves **Ptah does not contribute a conflicting binding**. It does
**not** answer the residual risk, which is correctly named: **VS Code owns `Ctrl+K` as a
chord prefix at workbench level**, and whether a webview `preventDefault` stops the
workbench entering that chord is answerable only on a live host.

**The Phase 6 gate is therefore NOT fully discharged.** Every automatable line of it is
green; the one manual line is open and must not be marked passed by inference.

---

## ⚙️ PROCESS RULE — mutation windows (binding for Batches 11–14)

**A mutation-based verification declares a window. Full-suite runs do not start inside one.**

### What happened, so the rule is not obeyed blindly

At the Batch 10 re-review `visual-reviewer` reported an intermittent flake — **13 then 1**
failures confined to `task-card.component.spec.ts`'s keyboard-activation block, passing
42/42 in isolation. **13 is exactly the guard-mutation signature.** It was escalated as a
possible real defect.

It was an **orchestration artefact**. Two reviewers ran concurrently against one working
tree, and `code-logic-reviewer` verifies pins the same way this gate does: by deleting
source and watching the right tests fail. The visual reviewer sampled the tree mid-
experiment. Both agents restored byte-identically, **which is exactly why nothing was left
to find afterwards.**

Attribution, corrected by the developer and worth keeping: the developer's own two windows
were **13/42** (card spec, guard removal) and **1/25** (**palette** spec, eager-reset
removal). A `1` confined to the _card_ spec therefore cannot have come from the developer's
window — the likelier source is the logic reviewer's **restore transient**, the moment
between the two `if (event.target !== event.currentTarget) return;` lines being written
back.

### The mechanism, stated generally

> **Mutation-based verification is destructive to concurrent readers even when it is
> perfectly non-destructive to the repository.** Byte-identical _afterwards_ says nothing
> about _during_.

A reader sampling mid-experiment gets a result that is internally consistent,
reproducible-looking and **completely false**. Worse, it carries a signature that **mimics
a real defect**: failures confined to one `describe` block that pass in isolation is the
textbook fingerprint of order-dependence, so the false reading points at a plausible bug
and invites a hunt for something that was never there.

### Why this one is worse than the four before it

Every prior case on this task **left an artefact** — a false claim in a comment, a test
name, a docblock — inspectable after the fact. That is how they were caught.
**This failure mode leaves none.** Nothing in the tree records that an observation was
taken inside someone else's experiment. It is unfalsifiable after the fact, which is
precisely why the control has to be procedural and up front.

### The control

1. Any agent about to mutate source for verification **announces the window** to the
   orchestrator before the first mutation, and **announces its close** after the restore is
   confirmed.
2. **No full-suite run starts inside an open window.** A reader that needs a full suite
   waits, or is given its own tree.
3. The **restore transient counts as inside the window** — the window closes after a clean
   confirmation run, not after the last `cp`.
4. **Batch 12 puts three agents on one tree.** Prefer separate worktrees there; if that is
   not done, windows are mandatory and serialised.

This gate followed the rule: the two R11 injections above were run in a declared window,
and the window was closed with a full clean 409 confirmation run before staging.

### ⚙️ THE SECOND SHARED-TREE HAZARD — a shared GATE (found at the Batch 12 gate)

**The mutation-window rule fixes concurrent _reads_. It does nothing about a shared
_gate_.** This is the same hazard through a different door, and it stopped Batch 12 from
landing.

The pre-commit hook runs `nx affected --target=lint` across **68 projects**. `affected` is
computed from the **working tree**, so _any_ session's uncommitted work enters that
calculation — and its lint failures block _every other session's commit_. At the Batch 12 gate a
parallel session's untracked `libs/web/members` work failed lint with 4 errors, then 11 a
few minutes later. `tasks-ui` and `shared` were clean throughout. Batch 12 was fully
verified and correctly staged and **still could not be committed**.

**A pre-commit hook running `nx affected` makes every session's lint everyone's lint.**

The controls, in order of preference:

1. **Separate worktrees per agent.** This closes both doors at once — the read hazard and
   the gate hazard — and is the only control that scales past two concurrent sessions.
2. **Land work in dependency order** so a session that is mid-flight is not holding the
   gate when another is ready to commit.
3. **Never `--no-verify`.** It was declined at the Batch 12 gate and that was correct: the
   hook was behaving properly and the failure was real. The bug is the shared tree, not the
   gate, and disabling the gate to work around the tree trades a blocked commit for an
   unchecked one.

**Do not "fix" the other session's files to unblock your own commit.** Every batch in this
task staged path-scoped precisely to avoid entangling parallel work; reaching into it at
the last step would undo that discipline exactly when it mattered most.

---

## 🔴 OPEN — Phase 6 sign-off: the R10 manual checklist

**Status**: OPEN. **Owner**: Phase 6 sign-off. **Not** a Batch 10 blocker.
**Nothing on this list can be discharged by any agent in a headless session.** Both items
need a live host.

### The accepted risk, stated as it was accepted

> The `Ctrl+K` shortcut is explicitly the convenience; the always-visible toolbar button is
> the contract and is fully covered, so shipping with R10 open degrades to **"the button
> works, the shortcut may be shadowed on VS Code"** — a real but bounded risk.

### What closes it — two minutes, both hosts

1. Open the Tasks board in the **Extension Development Host**.
2. Press `Ctrl+K`. Confirm the palette **opens**.
3. Confirm VS Code does **not** enter its chord state — no _"K was pressed, waiting for
   second key"_ in the status bar.
4. **Repeat in Electron.**

### Also on this list — the positive keyboard path (from `code-logic-reviewer`)

jsdom **cannot synthesize an activation `click` from a synthetic `keydown`**. Batch 10's
five keyboard-guard assertions are therefore all **negative** — they prove `selectTask`
does _not_ fire. That the descendant's **own** action fires on Enter (pressing Enter on the
child rollup narrows the board to that parent's children) is **unproven by automation** and
must be confirmed by hand beside the chord check.

### Standing rule — do not let this dissolve by inference

**`"keybindings": []` answers a different question and must NOT be cited as a pass.**
It proves Ptah contributes no _conflicting_ binding. It says nothing about whether the
workbench captures `Ctrl+K` as a chord prefix before the webview sees it. Any future
reader tempted to close R10 on that evidence is closing the wrong question.

---

# Batch 11 — Phase 7a: bulk status (backend) ✅ COMPLETE

**Commit**: `6c46e9a29` — 7 files, 1 267 insertions, 2 deletions. Staged path-scoped; zero
foreign files swept in.
**Counter**: **11 / 14 batches complete.**
**Review**: `code-logic-reviewer` **APPROVED** — 0 blocking, 0 serious, 2 non-blocking fixed.
**Gate**: run uncached **twice**, identical both times — shared 628; task-specs
357/23/**380**; rpc-handlers **1 603**/31/**1 634**. `npm run test:native` → task-specs
**380/380, 0 skipped**.

> ### Phase 7 gate: NOT discharged here
>
> Batch 11 is the **backend half only**. Batch 12 is the frontend half and carries the
> **pair gate**, exactly as in Phases 3, 4 and 5. Nothing in Phase 7 is signed off until
> Batch 12 lands and the pair is verified together.

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `general-purpose`
**Execution Mode**: `sequential`
**Rationale**: Backend half of **R2 — the highest-risk item in the document (score 10)**.
Lands after C1 and C6 per Q4, on a settled selection model. Reuses Batch 4's write funnel
**without re-implementing conflict semantics**.
**Tasks**: 4 | **Dependencies**: Batch 4

### Task 11.1 — Bulk result contract ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-tasks.types.ts`
`TasksBulkResultItem` (`taskId`, `ok`, `noop?`, `error?`, `currentStatus?`),
`TasksBulkUpdateStatusParams`, `TasksBulkUpdateStatusResult`.
**The result is a LIST. There is no boolean anywhere on this path (D5). Partial failure is
the expected outcome. The word "atomic" never appears.**

### Task 11.2 — `tasks:bulkUpdateStatus` ✅ COMPLETE

**Files**:

- `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc.types.ts` — **both** `RpcMethodMap` and `RPC_METHOD_ENTRIES`
- `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.schema.ts`
- `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts` — `METHODS` + `register()` + registrar

Handler loop per plan §5.1: `updateMetadata(…, { deferNotify: true })` per id, then **in
`finally`** exactly **one** `index.applyFolderChange(root, …)` — **ONE rebuild, ONE push**.
**Without `deferNotify`, N writes cause N full `.ptah/specs` rescans AND N `tasks:changed`
broadcasts** (R5). `taskIds` is capped at the chunk size; the client chunks.

### Task 11.3 — Conflict enrichment ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts`
On `TASK_CONFLICT` **only**: re-read the carrier, `parseTaskFile`, attach `currentStatus` —
the status the carrier actually holds right now (FR-C4.7). This is what makes the failure
message actionable rather than a dead end (R6 paydown).

### Task 11.4 — Interleaved-write integration spec ✅ COMPLETE

**Files**:

- `D:/projects/ptah-extension/libs/backend/task-specs/src/lib/task-writer.conflict.integration.spec.ts`
- `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.spec.ts`

5 ids; the fs mock mutates id #3's bytes **between its read and its write**; expect exactly
one item `{ ok:false, code:'TASK_CONFLICT', currentStatus }` and **four `{ ok:true }`** (R2).

**Batch 11 Verification** _(backend half of the Phase 7 gate)_:

- Interleaved-external-write test green
- Exactly one `applyFolderChange` per bulk call (spy assertion)
- `npx nx run-many -t typecheck,test,lint -p shared task-specs rpc-handlers`

---

## Batch 11 structural verification — team-leader gate

**Gate re-run uncached TWICE by the team leader, plus the native suite. Identical both
runs**: shared **628/628** (28 suites); task-specs **357 passed / 23 skipped / 380**
(14 suites); rpc-handlers **1 603 passed / 31 skipped / 1 634** (71 suites); lint and
typecheck clean across all three. `npm run test:native` → task-specs **380 / 380, 0
skipped** under electron-as-node (ABI-matched).

### The vacuous R5 assertion — reproduced in BOTH directions

This is the finding of the batch and it was worth re-proving rather than accepting. The
bulk suite's writer is wired to **the same `TaskIndexService` the handler holds**, because
that is what production DI does (`task-specs/src/lib/di/register.ts:82` points
`TASK_INDEX_NOTIFIER_TOKEN` at `TaskIndexService`). I verified what each wiring is worth by
dropping `deferNotify: true` under both:

| Writer's notifier                          | `deferNotify` dropped | Result                                                                                           |
| ------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------ |
| **`index`** (correct, as shipped)          | dropped               | **6 failed** — including _"issues exactly ONE index rebuild for the whole call (R5 / FR-C4.10)"_ |
| **`NoOpTaskIndexNotifier`** (the original) | dropped               | **1 failed** — and the **R5 rebuild assertion PASSES**                                           |

**Under the original wiring the entire efficiency claim of Phase 7a was green against a
handler that had dropped the flag.** The rebuild count is 1 either way when the writer
notifies nobody. The developer found this in its own test before any reviewer saw it.

Note what the surviving `1` is: the explicit `updateMetadata` spy assertion _"passes
deferNotify on every write"_, which the developer added as a second, independent guard.
**Without that assertion the NoOp configuration fails ZERO tests** — the vacuity would have
been total. Two independent guards now cover R5: the wiring makes the rebuild count
meaningful, and the spy checks the flag directly. Either alone would have been enough to
catch this mutation; neither alone is enough to catch every way of breaking it.

### Mutations 6 and 7 reproduced

| Mutation                                         | Expected | Measured                                                                                                                                                                                                                                             |
| ------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#6** dedupe key `toLowerCase()` → exact string | 2 failed | **2 failed** — _"treats a differently-cased duplicate as ONE task and ONE write"_ and _"writes one file once when two casings name the same task"_                                                                                                   |
| **#7** per-item catch → rethrow                  | 3 failed | **3 failed** — _"preserves the results of writes that already landed when item 4 throws"_, _"still rebuilds once when a mid-loop throw follows landed writes"_, and _"does not leak the raw error text of an unexpected throw to the client"_ (R4.4) |

Both discriminate, and #7's third pin is the one that matters for R4.4: the injected error
text carries `D:\secrets\…` and `EBUSY` on purpose, so the assertion proves the sanitizer
is load-bearing rather than decorative.

### The disproved mechanism — recorded because the false claim came from the orchestrator

The orchestration layer asserted that a differently-cased duplicate would make the second
write's pre-write re-read see the first's bytes and report `TASK_CONFLICT` against a write
that had succeeded. The developer built a case-insensitive filesystem to reproduce it,
ran the mutation, and got **`ok: true`**. The reason is in `task-writer.service.ts`:
`current !== raw` compares against **that call's own** snapshot, taken _after_ the first
write completed, so the re-read agrees and no conflict fires.

The real cost of the un-deduplicated case is quieter and still worth refusing: **two result
entries for one task** (FR-C4.3 forbids it) and **the carrier written twice**, the second
write existing only to refresh `updated` on a gitignored file with no undo.

> **This is the strongest case yet for the mutation-window / run-the-mutation rule, and it
> is a different shape from the six before it.** The false mechanism came from the
> **orchestration layer**, and had it not been tested it would have shipped in **two
> docblocks written in the developer's own voice** — the exact artefact this task keeps
> catching, but laundered through an agent that had no reason to doubt it. An instruction
> from above is not evidence. The developer corrected both docblocks in place and noted
> explicitly that the expected failure was disproved.

It also caught a decorative assertion in its own first attempt: _"no `TASK_CONFLICT`
appears"_ asserted against the default `Map`-keyed mock, which is case-**sensitive**, so it
passed either way. Removed and replaced.

### Ruling — the missing HEAD baseline is ACCEPTED

The developer declined a stash-based baseline twice because a parallel session was actively
staging into the shared index, and stated plainly that its deltas are **arithmetic rather
than measured**. **Confirmed, not overruled.** A corrupted shared index is a worse outcome
than a missing number, `git stash` is repo-global and cannot be scoped to seven paths, and
the honesty of labelling the deltas arithmetic is worth more than a measured number
obtained by risking another session's staged work. The absolute totals above are measured
twice and are what the batch is verified against; the deltas are presentation.

_(Confirmed independently at this gate: the index was empty and the foreign work had
already been committed as `a8d33adde`, so the hazard the developer avoided was real but had
resolved by the time I staged. That does not change the ruling — the decision was correct
on the information available when it was made.)_

---

# Batch 12 — Phase 7b: bulk status (frontend) — HIGHEST RISK 🔄 IN PROGRESS ← ASSIGNED

**Recommended Executor**: `frontend-developer`
**Fallback Executor**: `general-purpose`
**Execution Mode**: `sequential`
**Rationale**: Frontend half of R2. **The Phase 7 acceptance gate is asserted here.** Every
prerequisite (selection surface, palette confirmation route, write funnel) is already settled
by Batches 5, 7, 10 and 11 — which is the entire point of Q4's sequencing.
**Tasks**: 6 | **Dependencies**: Batch 10, Batch 11

### Task 12.1 — Selection model 🔄 IMPLEMENTED

**File**: `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts`
`_selection`, `_selectionAnchor`, `_pending`, `_bulk`, `_bulkSummary` — all session state,
**never persisted**.
**`_selection` is COMPLETELY INDEPENDENT of the existing `_selectedTaskId` (detail panel).
Entering multi-select opens no detail; clearing the selection closes no detail.**
Shift-range resolves against the **filtered, sorted, column-flattened** order, so a range
means what the user sees. Select-all-matching uses `filteredIds()`, honouring the filter.

### Task 12.2 — Selection affordances 🔄 IMPLEMENTED

**Files**:

- `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts` — checkbox, `pending` state
- `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/board/task-board.component.ts`
- `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/board/task-column.component.ts`

Checkbox / shift-range / ctrl-toggle / select-all-matching.

**Note from the Batch 7 gate.** Task 7.3's "forwards focus/selection inputs
(consumed in Batches 10, 12)" was deliberately not done — dead props were
declined, and the team-leader accepted that. This task is unaffected: it already
owns `task-column.component.ts`, so add the selection bindings here as planned.
`selectedTaskId` (the DETAIL panel's, :99/:64) already exists and is a different
signal from `_selection` per Task 12.1 — do not conflate them.

### Task 12.3 — Chunked loop, cancel, push suppression 🔄 IMPLEMENTED

**File**: `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts`
`BULK_CHUNK_SIZE = 20`, `BULK_CONFIRM_THRESHOLD = 10`. Loop exactly as plan §6.2.
**≤ 1 board reload is enforced on TWO fronts and both are required**: (a) the loop **never**
calls `loadBoard` — only the `finally` does, exactly once; (b) `handleMessage` (the
`tasks:changed` push handler at :290) **short-circuits while `this._bulk() !== null`**,
setting a `_missedPush` flag instead, which the single `loadBoard()` clears. Without (b) the
backend's end-of-chunk broadcasts each re-enter `loadBoard` (R5).
Failures stay selected; successes deselect (FR-C4.6). **No auto-retry ever fires** (FR-C4.8) —
Retry is a button scoped to the still-selected failures.

### Task 12.4 — Bulk bar 🔄 IMPLEMENTED

**File**: `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/bulk/task-bulk-bar.component.ts` _(create)_
Selection count, target-status picker, **confirmation above 10 naming the count AND the
target status** (FR-C4.12), progress `7 / 12`, cancel.
Cancellation is **chunk-granular** and the UI says so verbatim: _"Cancelled after 40 of 120.
Writes already issued completed and were not reversed."_
Bulk actions launched from the palette route through **this same confirmation** (FR-C6.7).

### Task 12.5 — Failure summary 🔄 IMPLEMENTED

**File**: `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/bulk/task-bulk-summary.component.ts` _(create)_
**Persistent — NOT a toast.** Per-item failure with the on-disk `currentStatus` shown
(FR-C4.7).

### Task 12.6 — Bulk specs + exports 🔄 IMPLEMENTED

**Files**:

- `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/services/tasks-store.service.spec.ts`
- `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/bulk/task-bulk-summary.component.spec.ts`
- `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/index.ts`

RPC spy; **50-id bulk with `tasks:changed` pushes fired after every chunk**;
`expect(spy.calls('tasks:board').length).toBeLessThanOrEqual(1)` — **the assertion is `≤ 1`,
not "roughly one"** (R5).
**Language ban (FR-C4.4)**: a one-line assertion over the rendered text that _atomic_,
_transactional_ and _all-or-nothing_ appear in **no** label, tooltip, or message.

**Batch 12 Verification** _(§7 Phase 7 gate — the full pair)_:

- Interleaved-external-write test: one item `TASK_CONFLICT` with `currentStatus`, the others
  succeed
- **≤ 1** `tasks:board` call for a 50-task bulk
- Failures stay selected, successes deselect
- `> 10` requires confirmation naming the count and the target status
- The three banned words appear nowhere in rendered text
- `npx nx run-many -t typecheck,test,lint -p shared task-specs rpc-handlers tasks-ui`

---

## 🚧 Batch 12 — VERIFIED AND STAGED, COMMIT BLOCKED BY FOREIGN LINT

**Not a Batch 12 defect.** All verification below passed and the 15 Batch 12 paths are
staged. The commit is blocked by the **pre-commit hook**, which runs
`nx affected --target=lint` across 68 projects. A parallel session's **untracked** work
makes `web-members` affected, and it fails with **4 errors**, all in files Batch 12 never
touched:

- `libs/web/members/src/lib/learning/components/progress-meter.spec.ts` — missing
  `OnPush`; two `base-300`-as-border violations
- `libs/web/members/src/lib/services/member-learning-api.service.spec.ts` — unused
  `_dropped`

`tasks-ui` and `shared` both lint **clean**. `--no-verify` was **not** used: skipping the
hook is not authorised, and the hook is doing its job — it is the working tree that is
shared, not the failure. **The commit is retried unchanged once that session's lint is
green or its work is committed.** The staged index (15 files, all `tasks-ui`) is intact and
must not be reset.

---

## Batch 12 structural verification — team-leader gate

**Gate re-run uncached TWICE, the second across the whole Phase 7 pair. Identical both
runs**: tasks-ui **470/470** (17 suites); shared **628/628** (28); task-specs
**357/23/380** (14); rpc-handlers **1 603/31/1 634** (71). Lint clean, 0 errors, all four.

### The wiring seam — I verified the SECOND half is load-bearing, not just present

Three checks, not one:

| Check                                                                       | Result                    |
| --------------------------------------------------------------------------- | ------------------------- |
| **Mutation 18** — swap `(cancelRequest)` ↔ `(cancelRun)`                    | **1 failed** — reproduced |
| **Extra-call defect** — `(selectAllMatching)` also calls `clearSelection()` | **1 failed** — caught     |
| **Same defect, second half of the assertion deleted**                       | **470/470 ALL PASS**      |

That third row is the one that matters. **With the "and NO other did" half removed, the
extra-call defect ships silently and the suite is completely green.** The second half is
the only thing standing between that defect and production, and it is what carries **Cancel
during a live 120-task run**. The reviewer's construction is confirmed: the first half
alone would pass against every permutation _and_ against every superset.

The third layer — `toHaveBeenCalledWith('in_review')` on the one value-carrying output —
covers the remaining gap, since a binding that hard-coded or dropped the status satisfies
every call-count assertion above it.

### The three-group split reaches the rendering

`succeeded + failures.length + untouched.length === requested` is asserted directly at the
**40/20/20 cancel** fixture, not merely stated in a docblock, and `untouched` is recorded as
its **own** list rather than folded into failures. The board renders a per-card badge and
succeeded cards are absent from the map entirely — one producer, no drift path.

### BR contracts verified

- **`BULK_CHUNK_SIZE` is IMPORTED**, never redeclared — **0** local declarations. Chunking
  asserted as `[20, 20, 10]` for 50 ids, so the client's chunking and the boundary's cap
  cannot disagree.
- **The banned words**: `grep -i atomic` returns 5 hits in `tasks-ui` and **none is a
  violation**. Two are the enforcement itself —
  `const BANNED = ['atomic', 'transactional', 'all-or-nothing']`, swept across the rendered
  text of both bulk components and the bar in all three states. The other three are
  pre-existing docblocks about single-field metadata writes having _no read-modify-write
  semantics to make atomic_ — a different mechanism, and they say the opposite of
  reassuring. The developer built the ratchet rather than merely obeying the rule.

### The EIGHTH claim that outran its evidence — and this one is in a REPORT

The developer stated it _"added a sweep across every `_.component.ts`template in the lib"*
after breaking the template-literal rule three times. **Verified independently: no such
sweep exists.** The only file-walking spec in`tasks-ui`is`no-editor-dependency.spec.ts`,
the R11 ratchet, which matches the editor specifier and nothing else. The `BANNED` sweep is
real but sweeps _rendered DOM text of two components_, not every template in the lib.

**The coverage is genuinely there; only the claim is false.** Confirmed by injecting
`${undefinedThing}` into an inline template: `typecheck` fails with
`TS2304: Cannot find name 'undefinedThing'`. So nothing in the tree is wrong and there is
nothing to fix — which is exactly why it belongs in the record.

> **The pattern now has its full range**: a comment, a test name, a docblock, a fixture, a
> test harness, an orchestrator instruction, and now a **status report**. The common thread
> across all eight is that **a claim about work done is not the work.** The report is the
> most dangerous carrier of the eight, because it is the one artefact that never touches the
> tree — it cannot be caught by any gate, only by someone checking. Every earlier instance
> was findable in the repository afterwards; this one was findable only because a reviewer
> went and grepped for a thing that was said to exist.

### Visual residual — ACCEPTED

The two per-card badges share identical chrome and lean on a 10×10 px icon pair not
reliably distinguishable by shape. Accepted: **the word is the real signal**, present at
rest and unambiguous. This is the same conclusion the task has now reached independently
**three** times — Batch 3's authored-vs-derived, Batch 9's message states, Batch 10's
"Enter to run". Stated as a standing principle: **colour and shape reinforce, words carry.**

### The mutation-window rule held on its first real test

Created by an orchestration error at the Batch 10 gate, it was exercised here with three
agents on one tree: the logic reviewer took the window, the visual reviewer was restricted
to static analysis, and **there was no phantom failure to chase.** It has now paid for
itself twice in a single batch. This gate ran its own window and closed it with a clean
confirmation run before staging.

---

# Batch 13 — Phase 8a: bulk labels (backend) 🔀 DEFERRED to `TASK_2026_185`

> ## 🔀 BATCHES 13 AND 14 ARE DEFERRED — A DECISION TAKEN, NOT A CUT THAT LAPSED
>
> **Moved to `TASK_2026_185` (FEATURE, `depends_on: [TASK_2026_181]`).** Read this before
> concluding the work was dropped for lack of time or attention. It was not. C5 was
> assessed as **cheap to build** — the write funnel, the bulk loop, chunking, cancellation,
> the confirmation, the three-group summary and the per-card badge all exist and are proven,
> and labels would reuse every one. It was deferred anyway, for three reasons:
>
> 1. **The plan named C5 as the P2 cut before anyone knew how the task would go** — which is
>    exactly when scope decisions are trustworthy. Building the designated cut _because it
>    turned out cheap_ is how a scoped task stops being scoped. The cut is not a contingency
>    that expires on arrival.
> 2. **12/14 is an honest handover boundary.** R2 — the highest-risk item in the document —
>    is closed with a verified pair. Phases 1–7 are complete. There is exactly one
>    outstanding item (R10), bounded and documented. That is a clean thing to hand over;
>    "everything, plus a labels feature reviewed at the end of a long session" is not.
> 3. **A dangling contract field is cheap to remove and expensive to half-populate.**
>    Batch 12 shipped `noop` with no producer. That is a real cost, but a contained one, and
>    if C5 is never built the fix is to delete a field — not to unpick a feature. Built now,
>    `noop` would acquire its producer in Batch 13 and its consumer in Batch 14, resolving
>    the dangling field in the two batches most likely to be rushed.
>
> **`TASK_2026_185` carries an explicit obligation on `noop`: give it a producer or delete
> it.** Batch 11's reasoning for declaring it early is preserved there, so the next reader
> knows it was deliberate rather than sloppy.
>
> The original Batch 13/14 breakdown below is left intact as input to `TASK_2026_185`.

---

## Original breakdown (input to `TASK_2026_185`)

# Batch 13 — Phase 8a: bulk labels (backend) — **P2, DESIGNATED CUT**

> **This batch and Batch 14 are the designated scope cut (FR-C5.3). If scope must be reduced,
> DROP BATCHES 13 AND 14 — never Batch 12.**

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `general-purpose`
**Execution Mode**: `sequential`
**Rationale**: Reuses Batch 11's result contract and handler shape wholesale. Small by design.
**Tasks**: 2 | **Dependencies**: Batch 11

### Task 13.1 — Params/result types ⏸️ PENDING

**Files**:

- `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-tasks.types.ts` — `TasksBulkUpdateLabelsParams` (`taskIds`, `add?`, `remove?`), `TasksBulkUpdateLabelsResult`
- `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc.types.ts` — **both** `RpcMethodMap` and `RPC_METHOD_ENTRIES`

**Same result contract as Batch 11 — a list, never a boolean.**

### Task 13.2 — Handler + spec ⏸️ PENDING

**Files**:

- `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.schema.ts`
- `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts` — `METHODS` + `register()` + registrar
- `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.spec.ts`

**Already-labelled tasks are reported `noop`, UNWRITTEN, and are NOT failures.** Same
`deferNotify` + single-rebuild discipline as Batch 11. Label limits come from
`TaskMetadataPatchSchema` in `libs/shared` — do not restate them here.

**Batch 13 Verification**:

- An already-labelled task returns `noop: true` and **no write is issued for it**
- `npx nx run-many -t typecheck,test,lint -p shared rpc-handlers task-specs`

---

# Batch 14 — Phase 8b: bulk labels (frontend) 🔀 DEFERRED to `TASK_2026_185` — **P2, DESIGNATED CUT**

**Recommended Executor**: `frontend-developer`
**Fallback Executor**: `general-purpose`
**Execution Mode**: `sequential`
**Rationale**: Frontend half of the P2 cut. **The Phase 8 acceptance gate is asserted here.**
**Tasks**: 2 | **Dependencies**: Batch 12, Batch 13

### Task 14.1 — Bulk label actions ⏸️ PENDING

**Files**:

- `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/bulk/task-bulk-bar.component.ts`
- `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts`
- `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/palette/palette-entries.ts`

Add/remove labels across a selection, through the **same** chunked loop, cancel, ≤ 1 reload,
and confirmation threshold as Batch 12. `noop` items are reported as such — **not** as
successes and **not** as failures.

### Task 14.2 — Spec + exports ⏸️ PENDING

**Files**:

- `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/services/tasks-store.service.spec.ts`
- `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/index.ts`

**Batch 14 Verification** _(§7 Phase 8 gate — the full pair)_:

- Already-labelled tasks reported `noop`, unwritten, not failures
- ≤ 1 board reload; banned words still absent
- **The full §3 gate command (both forms), with the pre-existing `ptah-cli` `NO_COLOR`
  failure reported as pre-existing**

---

## 5. Reviewer rejection criteria — every batch

`code-logic-reviewer` rejects on any of:

- `// TODO`, `// PLACEHOLDER`, `// STUB`, or an empty method body
- Hardcoded mock data or `console.log` standing in for real logic
- **Any diff to `task-start.service.ts`** (BR-8, R12)
- **Any diff to `ALLOWED_METHOD_PREFIXES`** (BR-1, F1)
- **Any diff to `renderFrontmatterBlock`** (BR-5, NFR-3)
- **Any diff to `adoptFolder` or `registry-generator.service.ts`** (BR-6, NFR-9)
- **Any new `DoctorAction` kind** (BR-6, R4)
- A `patch.key = undefined` removal (BR-3, F3)
- A strict per-item Zod schema on the saved-views **settings** definition (BR-4, F4)
- An import of `@ptah-extension/editor` from `tasks-ui` (BR-2, F2)
- A per-task filename literal, or `task-tracking/`, `.ptah/tasks/`, `specs/TASK_2025_`, in
  source **or comments or fixtures** (BR-7)
- A second filter predicate, or a second carrier write path
- A missing `ChangeDetectionStrategy.OnPush`, a `[innerHTML]`, or a `catch (error)` without
  `: unknown`
- The words _atomic_, _transactional_, _all-or-nothing_ in rendered text (Batches 12, 14)

## 6. Status icons

| Icon           | Meaning                               | Set by      |
| -------------- | ------------------------------------- | ----------- |
| ⏸️ PENDING     | Not started                           | team-leader |
| 🔄 IN PROGRESS | Assigned to a developer               | team-leader |
| 🔄 IMPLEMENTED | Developer done, awaiting verification | developer   |
| ✅ COMPLETE    | Reviewed, verified, committed         | team-leader |
| ❌ FAILED      | Verification failed                   | team-leader |
