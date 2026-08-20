# Batch Breakdown — TASK_2026_237

**Title**: Wire Relay and Crucible into the Tribunal panel, with first-class phase/round state
**Source of truth**: `implementation-plan.md` §3 (change list), §4 (sequencing), §7 (handoff). This file executes that
sequence; it does not redesign it. The two places where I deviate are called out explicitly in
_Plan Validation Summary_ below.
**Total batches**: 8 (B0–B7) | **Status**: 0/8 complete | **All batches**: `PENDING`

**Global constraint — no CLI executors.** codex is the only installed CLI on this machine and is broken
(TASK_2026_238, `codex-cli.adapter.ts:228-235`). Every batch below is assigned to a **sub-agent developer**.
Do not delegate any batch to `ptah_agent_spawn`.

**Global constraint — no live-run verification.** Per plan §6 R10, no end-to-end Relay or Crucible run can be
QA'd on this branch until TASK*2026_238 lands. Every gate below is therefore a unit/type/lint gate. Batches whose
\_natural* verification would be a live run (B3, B4, B5) carry an explicit note on how they are verified without one.

---

## Plan Validation Summary

**Validation status**: PASSED WITH TWO FLAGS. No blockers. Do not send this back to the architect.

### Assumptions verified against the plan's own citations

| Assumption                                                                 | Status                                                                       |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `tasks:` prefix already runtime-guarded — no `rpc-handler.ts` edit         | ✅ Asserted at plan §0.2 / §7.1 with `file:line`. Re-confirm in B1 preflight |
| Relay's four deliverables are all `DocFile`s → no new RPC for Relay        | ✅ plan §1 Q1(b)                                                             |
| Only `round-N-judge.md` content needs a new method                         | ✅ plan §0.2, last row                                                       |
| `MarkdownBlockComponent` provided app-wide for both hosts                  | ✅ plan §0.3                                                                 |
| One tile slotter unchanged → AC-6.2 / AC-6.3 satisfied by non-modification | ✅ plan §1 Q5, §3.2 "Explicitly NOT changed"                                 |

### FLAG 1 — B2's "tree stays green" is not true as literally scoped (BOUNDARY CORRECTION, not a re-cut)

Plan §4 marks B2 "additive only, nothing removed, tree stays green" while assigning
`tribunal-ui.types.ts` (which **widens `TribunalMove`**) to B2 and the three exhaustive
`Record<TribunalMove, …>` maps to B3. Widening the union breaks `MOVE_PHRASE`
(`tribunal-run.service.ts:8`), `MOVE_FRAMING` (`:14`) and `TURNS_PER_VENDOR`
(`step-panel-preview.component.ts:35`) **the moment B2 lands**. The tree is red between B2 and B3, and B2's
`nx affected -t typecheck` gate cannot pass.

**Resolution adopted (Option 1, preferred):** B2 additionally adds the `relay` / `crucible` entries to those three
existing maps — real values, no placeholders, nothing deleted, no signature changed. That keeps B2 literally
additive, keeps its typecheck gate honest, and leaves B3 with exactly its intended job: **delete**
`FULL_AUTO_DIRECTIVE` and `TURNS_PER_VENDOR`, and change `prepare()`'s signature with every call site.
B2 and B3 were already sequential (B3 depends on B2), so this costs no declared parallelism — the plan's two
disjointness claims (B1 ‖ B2, B3 ‖ B4) are both preserved.

**Rejected (Option 2):** land B2+B3 as one commit. Loses B2's independent gate and makes the largest, riskiest
batch in the task bigger. Only fall back to this if a developer reports Option 1 forces a `default:` arm —
it must not, and a `default:` arm on any of those three maps is an AC-1.1 defect.

### FLAG 2 — B6 would regress B0 (SCOPE ADDITION)

B0 re-syncs `.github/skills/tribunal/` to the shipped copy. B6 then edits **only** the shipped copy
(`vendor-panel.md` §0, `crucible.md:51`), leaving the two copies divergent again by the end of the task —
reintroducing the exact defect B0 exists to remove. **B6 must apply both edits to `.github/skills/tribunal/references/`
as well**, and its gate verifies the two trees are identical. This is one extra file copy, not design work.

### Risks carried from plan §6 into per-batch Validation Notes

| Risk                                                             | Lands in | Carried as                                                                               |
| ---------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| R1 agent-tick refresh misses conductor-authored artifacts        | B4, B5   | Refresh-progress button (B5) + never render stale as `pending` (B4)                      |
| R3 conductor may run a user-authorised 3rd round                 | B1, B4   | Zod bounds 1..4 (B1); render "Round 3 of 2 (user-authorised)", never clamp (B4)          |
| R4 Windows `file:line` (`D:\a\b.ts:42`)                          | B2       | Location matcher anchors on trailing `:\d+`, pinned by test                              |
| R5 Relay implement deliverable renamed `tasks.md` → `batches.md` | B4       | Accept **either** `BATCHES_FILE` or `LEGACY_BATCHES_FILE`, both from the shared contract |
| R7 discovery RPC delays first paint of move cards                | B3       | Cards paint enabled; Crucible disable applies only after discovery resolves              |
| R8 judge markdown is untrusted vendor output                     | B5       | Defect `what`/`expected` interpolated; only the mentor note goes through markdown        |
| R9 async `prepare()` double-click                                | B3       | Disable the run button for the await duration                                            |
| R10 no live CLI lane available                                   | all      | Every gate is unit-level; see per-batch notes                                            |

---

## B0 — Re-sync `.github/skills/tribunal/` to six references

**Status**: `COMPLETE` — all seven content files byte-identical to the shipped copy (`cmp` verified). `crucible.md`
created; `SKILL.md`, `relay.md`, `vendor-panel.md`, `forge.md`, `race.md` replaced; `council.md` was already
identical. No content disagreements — every hunk was one-directional staleness. The shipped copy was not modified.

> **Discovered during B0**: `.github/skills/` is gitignored (`.gitignore:190`), so this whole tree is **untracked**.
> The re-sync is a local-machine fix with nothing to commit, and the "divergence" was a stale per-machine clone
> rather than a repo-tracked one. Two permanent metadata hunks remain and are expected: `.history/**` (Ptah's
> local-history snapshot) and `.ptah-origin.json` (clone sidecar, inert here — `UserLayerMirrorService` resolves to
> `~/.ptah/user/skills`, so no runtime code reads a sidecar at this path).
> **Recommended Executor**: `frontend-developer` (doc-only; any developer agent is competent — plan §7 names frontend)
> **Execution Mode**: `sequential`
> **Dependencies**: none. **B0 IS FIRST AND IS NOT REORDERABLE.**
> **Disjoint with**: all

**Why first, non-negotiable**: every agent implementing the rest of this task reads
`.github/skills/tribunal/`, and today that copy does not describe Crucible at all
(5 references vs the shipped 6 — requirements §10). Running B1–B6 before B0 means every downstream
developer works from a spec that omits the move they are wiring up. This is a correctness precondition,
not a nicety.

**Files touched**

- `.github/skills/tribunal/references/crucible.md` — **CREATE** (copy from
  `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/references/crucible.md`)
- `.github/skills/tribunal/references/council.md` — diff vs shipped copy, reconcile
- `.github/skills/tribunal/references/forge.md` — diff vs shipped copy, reconcile
- `.github/skills/tribunal/references/race.md` — diff vs shipped copy, reconcile
- `.github/skills/tribunal/references/relay.md` — diff vs shipped copy, reconcile
- `.github/skills/tribunal/references/vendor-panel.md` — diff vs shipped copy, reconcile
- `.github/skills/tribunal/SKILL.md` — must list five moves, matching the shipped `SKILL.md`

**Acceptance criteria closed**: requirements §10 bullet 1; DoD "`.github/skills/tribunal/` re-synced to six references"

**Verification gate** (doc-only — no build, no test):

```bash
ls .github/skills/tribunal/references            # exactly 6 files
git diff --no-index apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal .github/skills/tribunal
```

The `--no-index` diff must be empty, or every remaining hunk must be a deliberate, stated dev-vs-shipped
difference. **The shipped copy is authoritative — never edit it to match `.github/`.**

**Validation notes**

- Requirements §11: this task does **not** change the behaviour of the moves. B0 is a copy plus a diff review.
  If the diff reveals a genuine content disagreement between the two copies, **stop and report** — do not
  arbitrate it here.
- `apps/ptah-docs/src/content/docs/tribunal/` is explicitly **out of scope** (requirements §10, follow-up task).

---

## B1 — The `tasks:getRoundJudge` RPC, end to end

**Status**: `COMPLETE` — 7 files changed, all inside this batch's table. Not committed.
All five preflight points held; no runtime-guard edit made; `file:read` not used.
`round` is `z.number().int().min(1).max(4)`; a missing file resolves as `{ round, content: null }`.
`DOC_FILES` is byte-unchanged. Gates: `nx affected -t typecheck` → 90 projects, exit 0;
`nx test task-specs` → 404 passed (`contract.guard.spec.ts` green); `nx test rpc-handlers` → 1910 passed
(`rpc-allowlist.spec.ts` green).

> **Carry into B2 / B4**: `roundJudgeFile()` takes a **number** and derives the name. No frontend code may
> hand-write `round-N-judge.md`.
> **Recommended Executor**: `backend-developer` (plan §7)
> **Execution Mode**: `sequential` — but **parallel-eligible with B2** (see below)
> **Dependencies**: B0 complete
> **Disjoint with**: **B2**, B3 — zero file overlap (backend + `libs/shared` vs `libs/frontend/tribunal-panel`)

### ⚠️ PREFLIGHT — re-confirm these five before writing a line (plan §7). Stop if any disagrees.

1. **`tasks:` is already in `ALLOWED_METHOD_PREFIXES`** at `libs/backend/vscode-core/src/messaging/rpc-handler.ts:85`.
   → **NO runtime-guard edit.** NFR-3's second site is satisfied by inspection. Do not add a prefix entry.
2. **`RPC_HANDLER_MANIFEST` partitions `RPC_METHOD_NAMES` exactly**, asserted by `rpc-allowlist.spec.ts`.
   → The new method **MUST** be added to `TasksRpcHandlers.METHODS` (`tasks-rpc.handlers.ts:261-278`), or that spec fails.
   A method in the union with no manifest owner is a red build, not a runtime surprise.
3. **Contract-guard Duty 1** (`libs/backend/task-specs/src/lib/contract.guard.spec.ts:154-186`) forbids the
   `round-N-judge.md` / `rubric.md` literals in production TypeScript outside `task-spec.contract.ts` and four
   allowlisted files. → Put `RUBRIC_FILE` and `roundJudgeFile(round)` in `task-spec.contract.ts` **only**, and
   compose every path from them.
4. **`file:read` is Electron-only** (`manifest.ts:318-320`; the VS Code profile does not set `fileSystemAccess`).
   → Do **not** reach for it as a shortcut. That is the whole reason this method exists.
5. **`MarkdownBlockComponent` is already provided app-wide** (`app.config.ts:72`). → Relevant to B5, stated here so
   nobody adds a second `provideMarkdownRendering()` while touching shared types.

**Additional hard rule**: **do NOT add `RUBRIC_FILE` or `roundJudgeFile` to `DOC_FILES`** (plan §1 Q1).
`DOC_FILES` drives `renderSpecsReadme()` (`task-spec.contract.ts:385`), whose output is hash-compared and rewritten
into `.ptah/specs/README.md` in **every user workspace** on activation.

**Files touched**

| File                                                               | Action                                                                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `libs/shared/src/lib/types/task-spec.contract.ts`                  | MODIFY — add `RUBRIC_FILE`, `roundJudgeFile(round)`                                                             |
| `libs/shared/src/lib/types/rpc/rpc-tasks.types.ts`                 | MODIFY — `TasksGetRoundJudgeParams` / `TasksGetRoundJudgeResult` (plan §1 Q1)                                   |
| `libs/shared/src/lib/types/rpc.types.ts`                           | MODIFY — type re-export (~`:505-512`), registry entry (~`:1868`), `true` in the bool map (~`:3095`)             |
| `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.schema.ts`   | MODIFY — Zod: `taskId` string, `round` **int 1..4**                                                             |
| `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts` | MODIFY — add to `METHODS` (`:261-278`) + `registerGetRoundJudge()` mirroring `registerGetArtifact` (`:668-690`) |
| `libs/backend/task-specs/src/lib/task-index.service.ts`            | MODIFY — `readRoundJudge(root, folderName, round)` beside `readArtifact` (`:345-363`)                           |
| `libs/backend/rpc-handlers/**/tasks-rpc.handlers.spec.ts`          | MODIFY — extend                                                                                                 |
| `libs/backend/task-specs/**/task-index.service.spec.ts`            | MODIFY — extend                                                                                                 |

**Acceptance criteria closed**: NFR-3 (both sites, one by inspection); the data source AC-5.1–AC-5.4 depend on;
plan §5 row "B1"; partial AC-7.3 (`nx affected -t typecheck`)

**Verification gate**

```bash
npx nx affected -t typecheck
npx nx test task-specs          # contract.guard.spec.ts MUST stay green (Duty 1)
npx nx test rpc-handlers        # rpc-allowlist.spec.ts MUST stay green (manifest partition)
```

**Validation notes**

- The caller passes an **integer, never a filename**; the server derives `round-${round}-judge.md`. Path traversal
  must be structurally impossible, not merely validated away.
- **Missing file ⇒ `{ round, content: null }` as a SUCCESS**, not an error. An unjudged round is a normal state.
- Echo `round` back in the result so a late response cannot render under the wrong round.
- **R3**: bound the Zod int at **1..4**, not 1..2. The panel caps at 2 but the conductor may run a user-authorised
  3rd (`crucible.md:153`); a 4th must surface as a visible anomaly, not an RPC error.
- **NFR-8**: the tree carries unrelated WIP. Touch only the files above; stop and report on out-of-scope failures.

**Parallelism**: B1 and B2 are file-disjoint (backend/shared vs frontend). If you run them concurrently, do it in
**separate worktrees** — they share one `nx affected -t typecheck` gate otherwise and will report each other's
in-flight breakage. In a single worktree, run B1 then B2.

---

## B2 — Frontend types + pure services (ADDITIVE ONLY)

**Status**: `COMPLETE`. Additive only; nothing deleted, no signature changed, not committed. All three exhaustive
maps completed with **no `default:` arm and no `??`**. Gates: `nx test tribunal-panel` → 11 suites / **201 passed**;
`nx affected -t typecheck` → 90 projects (matches B1's baseline); `nx lint tribunal-panel` → clean.

> **Correction applied during B2**: the parser originally dropped any defect whose severity was not exactly
> `blocking|major|minor`, so a judge writing `[critical]` lost an **evidenced, located** defect. AC-5.3 makes a
> missing `file:line` the **sole** drop condition. `CrucibleDefect.severity` now carries `'unknown'`; unrecognised
> words resolve to it and are **never** remapped onto `'major'` (which would misreport the judge rather than lose
> them). `SEVERITIES` is a recogniser, not a gate.
>
> Pinned by test so this cannot be re-tightened on a false premise: the `PASS | REVISE | REJECT` template row dies on
> the **location** rule even when given a valid `[blocking]` severity, and a row carrying a real `a/b.ts:12` survives
> a junk `[blocking|major|minor]` severity. Severity was never the template defence.

> **Carry into B3**: `step-pick-move.component.ts:110` `iconFor` has a **pre-existing `default:` arm**, so the union
> widening did not break it — meaning AC-1.1's safety net did not fire there. B3 converts it to an exhaustive switch.
> **Recommended Executor**: `frontend-developer`
> **Execution Mode**: `sequential` — **parallel-eligible with B1** (see B1's parallelism note)
> **Dependencies**: B0 complete
> **Disjoint with**: **B1**

**Files touched** (all under `libs/frontend/tribunal-panel/`)

| File                                              | Action                                                                                                                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/types/tribunal-ui.types.ts`              | MODIFY — widen `TribunalMove`; add `RELAY_ROLES` / `CRUCIBLE_ROLES` / `LaneRole` / `rolesForMove`; `role?` on `VendorLane`; the whole `TribunalProgress` union (plan §2.3) |
| `src/lib/services/tribunal-estimate.ts`           | CREATE — `estimateTurns()` (plan §2.5), pure                                                                                                                               |
| `src/lib/services/tribunal-roster-rules.ts`       | CREATE — `validateRoster()` (plan §2.4), pure                                                                                                                              |
| `src/lib/services/judge-report.parser.ts`         | CREATE — `round-N-judge.md` → `CrucibleRound`, pure                                                                                                                        |
| `src/lib/services/tribunal-state.service.ts`      | MODIFY — 4 new slice fields + setters + `EMPTY_SLICE` defaults + `progress` exposure                                                                                       |
| `src/lib/services/tribunal-run.service.ts`        | MODIFY — **FLAG 1**: add the two new entries to `MOVE_PHRASE` and `MOVE_FRAMING`. Nothing else. Do not touch `FULL_AUTO_DIRECTIVE` or `prepare()`                          |
| `src/lib/wizard/step-panel-preview.component.ts`  | MODIFY — **FLAG 1**: add the two new entries to `TURNS_PER_VENDOR`. Do not delete it yet                                                                                   |
| `src/lib/types/tribunal-ui.types.spec.ts`         | CREATE                                                                                                                                                                     |
| `src/lib/services/tribunal-estimate.spec.ts`      | CREATE                                                                                                                                                                     |
| `src/lib/services/tribunal-roster-rules.spec.ts`  | CREATE                                                                                                                                                                     |
| `src/lib/services/judge-report.parser.spec.ts`    | CREATE                                                                                                                                                                     |
| `src/lib/services/tribunal-state.service.spec.ts` | MODIFY — extend                                                                                                                                                            |

**Acceptance criteria closed**: AC-1.1 (union + exhaustive-map completion, no `default:`, no `??`),
AC-2.1, AC-2.2 / AC-2.4 / AC-2.5 (rule layer only — UI in B3), AC-3.3 (function only — wiring in B3),
AC-4.2 (structurally, via `RelayPhaseStatus` having **no `'running'` member**), AC-5.2, AC-5.3, AC-6.1

**Verification gate**

```bash
npx nx affected -t typecheck
npx nx test tribunal-panel
```

**Validation notes**

- **FLAG 1 is the whole point of this batch's shape.** B2 only ever _adds_. Deletions live in B3. If completing an
  exhaustive map here appears to require a `default:` arm or a `??`, that is an AC-1.1 defect — **stop and report**.
- `slotFor`, `reconcileSlice`, `laneTagOf` and `TRIBUNAL_MAX_VENDOR_TILES` are **untouched**. AC-6.2 and AC-6.3 are
  satisfied by non-modification; changing them is a regression, not an improvement.
- **R4**: the `file:line` matcher anchors on a **trailing** `:\d+(:\d+)?`, never on the first colon.
  `D:\projects\x\foo.ts:42` must parse to location `D:\projects\x\foo.ts:42`, not `D`. Pin it with a test.
- **AC-5.2 is adversarial**: the literal contract template line `PASS | REVISE | REJECT` echoed back by a lazy judge
  must parse to `'unparsed'`. **No input may yield `pass` unless the word PASS stands alone.** There is no default arm.
- `EMPTY_SLICE` must gain all four defaults (`null`, `null`, `null`, `{ kind: 'none' }`) — that is what makes
  `reset()` (and therefore `Close Tribunal`) clear the new state for free (AC-6.4).
- Verified without a live run: every artifact here is a pure function or a signal store; no CLI lane is involved.

---

## B3 — Run service + all five wizard components (the breaking change)

**Status**: `COMPLETE`. Not committed. Gates: `nx typecheck tribunal-panel` green; `nx test tribunal-panel` →
**13 suites / 247 passed** (B2 baseline 11/196); `nx lint tribunal-panel` clean.

> **AC-1.4 held.** The three flat-move framing strings are unchanged **character for character**, asserted with
> full-string `toBe` equality against snapshots taken from the pre-change source — not `toContain`. The
> `MOVE_AUTONOMY` flat arms share one frozen array holding the original `FULL_AUTO_DIRECTIVE` verbatim, and
> `MOVE_CONDUCTOR_CLAUSE` keeps `running FULLY AUTONOMOUSLY` for all three. `laneTagOf` untouched; a test pins that
> role-move tags still parse to exactly `codex#0, codex#1, copilot#2, cursor#3`.
>
> **`default:` audit done.** `iconFor` is now exhaustive over five moves. The two remaining arms in the lib
> (`tribunal-page.component.ts:260`, `tribunal-tile-host.component.ts:104`) switch on **agent/tile status**, not
> `TribunalMove`, so they hide no move-exhaustiveness gap. Both are B5 files and were left alone.
>
> **Deviation, accepted**: `wizard/tribunal-wizard.component.spec.ts` was edited though it is not in B3's table —
> its `StepRunStub` lacked the new `rubric`/`roundCap` inputs and the override dropped the two new step components,
> so the gate was red until the stubs matched. Same lib, spec-only, and the gate could not pass without it.
>
> Deliverable filenames resolve from `DOC_FILES` / `BATCHES_FILE`, never literals — a hand-written
> `'task-description.md'` in this lib trips contract-guard Duty 1. Re-verified: `nx test task-specs` still 404 passed.
> **Recommended Executor**: `frontend-developer`
> **Execution Mode**: `sequential`
> **Dependencies**: **B2 complete** (hard). **MUST NOT be reordered before B2.**
> **Disjoint with**: B4

**Ordering constraint, restated because it is load-bearing**: B2 is deliberately additive so the tree compiles
after it. B3 is where `TURNS_PER_VENDOR` is **deleted**, `FULL_AUTO_DIRECTIVE` is **deleted**, and `prepare()`
changes signature — it must carry **every call site in one commit**. Splitting B3 leaves the tree red.

**Files touched** (all under `libs/frontend/tribunal-panel/`)

| File                                                    | Action                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/services/tribunal-run.service.ts`              | REWRITE — `FULL_AUTO_DIRECTIVE` (`:22-23`) **deleted** → `MOVE_AUTONOMY` (plan §1 Q2); `:124` and `:133` become per-move; `prepare()` → `TribunalLaunchSpec`, **async**, allocates the spec folder via `tasks:create`; role tokens + `Spec folder:` line + rubric block in the framing (plan §2.6) |
| `src/lib/services/tribunal-discovery.service.ts`        | MODIFY — shared `vendors` signal + memoized `ensureDiscovered()`; `discover()` kept as-is                                                                                                                                                                                                          |
| `src/lib/wizard/step-pick-move.component.ts`            | MODIFY — five cards, distinct icons, all `enabled: true`; Crucible disabled with `crucible.md:55`'s reason when < 2 families; skill advisory badge; `iconFor` becomes an exhaustive switch                                                                                                         |
| `src/lib/wizard/step-role-roster.component.ts`          | CREATE — N slots from `rolesForMove()`; emits `VendorLane[]` (same contract as the flat picker)                                                                                                                                                                                                    |
| `src/lib/wizard/step-crucible-rubric.component.ts`      | CREATE — rubric textarea prefilled from `crucible.md:61-71`; round-cap control default 2, max 2                                                                                                                                                                                                    |
| `src/lib/wizard/step-panel-preview.component.ts`        | MODIFY — **delete `TURNS_PER_VENDOR`**; call `estimateTurns()`; consume the shared discovery cache                                                                                                                                                                                                 |
| `src/lib/wizard/tribunal-wizard.component.ts`           | MODIFY — `steps` computed per move; `@switch` between the two lane editors; `rubric`/`roundCap` signals; `canAdvance` consults `validateRoster`                                                                                                                                                    |
| `src/lib/wizard/step-run.component.ts`                  | MODIFY — `async run()`; passes `TribunalLaunchSpec`; per-move estimate; non-blocking spec-folder-allocation notice                                                                                                                                                                                 |
| `src/lib/services/tribunal-run.service.spec.ts`         | MODIFY — extend                                                                                                                                                                                                                                                                                    |
| `src/lib/wizard/step-pick-move.component.spec.ts`       | CREATE                                                                                                                                                                                                                                                                                             |
| `src/lib/wizard/step-crucible-rubric.component.spec.ts` | CREATE                                                                                                                                                                                                                                                                                             |
| `src/lib/wizard/step-panel-preview.component.spec.ts`   | MODIFY — extend                                                                                                                                                                                                                                                                                    |

**Acceptance criteria closed**: AC-1.2, AC-1.3, **AC-1.4**, AC-2.2, AC-2.3, AC-2.4, AC-2.5, AC-2.6, AC-2.7,
AC-3.1, AC-3.2, AC-3.3 (wired), AC-3.4, AC-3.5, **AC-7.2**, NFR-1, NFR-7

**Verification gate**

```bash
npx nx typecheck tribunal-panel
npx nx test tribunal-panel
npx nx lint tribunal-panel
```

**Validation notes**

- **AC-1.4 is the highest-value assertion in the whole task.** Snapshot-style equality on the **full framing string**
  for all five moves from a fixed lane fixture. The council/forge/race snapshots must match what
  `tribunal-run.service.spec.ts:167-260` already asserts **character for character**. The framing is a wire
  contract with the skill, not copy.
- The `council` / `forge` / `race` entries in `MOVE_AUTONOMY` hold **that exact `FULL_AUTO_DIRECTIVE` string,
  unchanged**. The flat moves keep `running FULLY AUTONOMOUSLY` at `:124` verbatim.
- The **`[tribunal:<laneId>]` tag grammar does not change** — the role is an additive `(role)` token in the
  human-readable remainder. `laneTagOf` stays untouched (AC-6.2 by inspection).
- Same-family judge **blocks with no override** (plan §2.4 sub-decision). Do not add a confirmation surface.
- Two relay slots on the same family with different models must produce **two distinct `laneId`s and must never be
  de-duplicated** (AC-2.2, `relay.md:60`). Use the existing `makeLaneId(baseKey, i)`.
- Spec-folder allocation failure is **non-blocking**: the run launches with `specTaskId = null`, the framing omits
  the `Spec folder:` line, and progress shows the AC-4.5 unavailable state. Progress is an enhancement, never a
  launch blocker.
- **R9**: disable the run button for the duration of the `prepare()` await.
- **R7**: all five cards paint enabled immediately; the Crucible disable is applied only once discovery resolves.
  Never the reverse flash.
- **No live run needed** (R10): `tasks:create` and `plugins:list-skills` are mocked through `ClaudeRpcService`;
  framing is asserted as a string. Nothing here spawns a CLI lane.
- **NFR-2**: no `libs/backend/**` import may appear in this lib. All backend access via `ClaudeRpcService`.

---

## B4 — `TribunalProgressService` (the reader)

**Status**: `COMPLETE`. Two files created, nothing else touched. Not committed. Gates (uncached):
`nx typecheck tribunal-panel` green; `nx test tribunal-panel` → **14 suites / 287 passed** (B3 baseline 13/247);
`nx lint tribunal-panel` clean. Contract ratchet re-run with the new file present: `nx test task-specs` → 404 passed.

> **AC-4.2 structural**: two concurrently-running lanes yield exactly one `runningIndex`, pinned by test. `running`
> is not a member of the per-phase union, so a second live phase is **unrepresentable**, not merely unguarded.
> **R5**: `RELAY_COMPLETION_NAMES.implement = [BATCHES_FILE, LEGACY_BATCHES_FILE]`, both from `@ptah-extension/shared`;
> two tests pin that either name closes the phase. No `'tasks.md'` literal in production code.
> **R3**: a 3rd round is not clamped — `currentRound 3 / roundCap 2` renders as in-progress. `MAX_JUDGED_ROUND = 4`
> matches B1's RPC bound.

> **Judgement calls to review at B5**:
>
> - `currentRound` advances on a REVISE only while the loop is open; a terminal loop reports its last judged round.
>   Otherwise a `regression-stop` would render as "Round 3 of 4", claiming a round that never ran.
> - `regression-stop` derives exactly from `crucible.md:157`, comparing severity buckets worst-first with `'unknown'`
>   as its own trailing bucket — **never folded into `'major'`**.
> - A lane that exited **cleanly without its deliverable** is `failed`, not `pending`. The ordering premise is "a lane
>   writes its file then exits", so exited-without-artifact did not deliver (R1 — `pending` would claim it never started).
> - `reassignedFromLaneId` is produced only on **positive evidence**, so a not-yet-started phase never reads as reassigned.
> - **`specDoc()` is duplicated** from `tribunal-run.service.ts` (module-private there; B3's file was out of scope).
>   **B5 should hoist it to one shared location.**
>   **Recommended Executor**: `frontend-developer`
>   **Execution Mode**: `sequential` — **parallel-eligible with B3**, with the caveat below
>   **Dependencies**: **B1 and B2 complete** (needs the RPC and the `TribunalProgress` union). Does **not** depend on B3.
>   **Disjoint with**: **B3**

**Parallelism caveat (honest)**: B3 ‖ B4 is the plan's headline parallelism win and the files genuinely do not
overlap — but both gate on `nx test|lint|typecheck tribunal-panel`, which is **whole-lib**. Run them concurrently
only in **separate worktrees**. In a shared worktree, B4's gate will fail on B3's in-flight edits and vice versa;
run B4 after B3 there.

**Files touched**

- `libs/frontend/tribunal-panel/src/lib/services/tribunal-progress.service.ts` — CREATE
- `libs/frontend/tribunal-panel/src/lib/services/tribunal-progress.service.spec.ts` — CREATE

**Acceptance criteria closed**: AC-4.2 (derivation), AC-4.3, AC-4.5 (the `unavailable` arm and its reason),
AC-5.1 (round counter from the artifact filenames)

**Verification gate**

```bash
npx nx typecheck tribunal-panel
npx nx test tribunal-panel
npx nx lint tribunal-panel
```

**Validation notes**

- Derivation is a pure join: role → lane → `MonitoredAgent` → status, over `laneBindings`
  (`tribunal-state.service.ts:155-177`) plus `tasks:get` artifacts plus `tasks:getRoundJudge`.
- **AC-4.2 must be enforced by the type, not by a guard**: `runningIndex` is a single nullable index on the
  container. Two simultaneously-running lanes must still yield exactly one `runningIndex`. Test that case directly.
- **No `tasks:changed` subscription and no `app.config.ts` edit** (plan §1 Q1). Refresh is an Angular `effect` over
  `AgentMonitorStore.agents()`. Registering in `MESSAGE_HANDLERS` is eager at webview bootstrap and would drag
  `TribunalPageComponent` + gridstack into the initial bundle — the exact TASK_2026_187 regression.
- **R5**: the implement-phase completion check accepts **either** `BATCHES_FILE` or `LEGACY_BATCHES_FILE`, both
  imported from the shared contract. Never a hand-written `'tasks.md'`.
- **R3**: a 3rd round renders as "Round 3 of 2 (user-authorised)". **Do not clamp** — clamping lies about a run
  that is genuinely in progress.
- **R1**: a stale or unavailable state is **labelled**, never rendered as `pending`. `pending` means "we know it
  has not started"; `unavailable` means "we cannot tell". Conflating them is the AC-4.5 defect.
- `{ kind: 'unavailable', reason }` is reached when `specTaskId === null` **or** the RPC errors. There is no
  default arm and no `??` that can produce a PASS or a false `complete`.
- **No live run needed** (R10): the RPC is mocked; the parser is already unit-pinned by B2.

---

## B5 — Run-view components: phase rail, verdict panel, page, tile host

**Status**: `COMPLETE`. Not committed. Gates (uncached): `nx typecheck tribunal-panel` green;
`nx test tribunal-panel` → **16 suites / 330 passed** (B4 baseline 14/287); `nx lint tribunal-panel` clean;
`nx test task-specs` → 404 passed (Duty 1 clean with the new files present).

> **NFR-4 / AC-5.7 verified**: `grep -rnE "\[innerHTML\]\s*=|innerHTML\s*=|bypassSecurityTrust"` over the lib →
> **exit 1, zero matches** across 42 files. Mentor note routes through `MarkdownBlockComponent`; defect
> `what`/`expected`/`location` are interpolated, pinned by a test that an `<img onerror>` payload renders as text
> and no `<img>` reaches the DOM. No second `provideMarkdownRendering()`.
>
> **`specDoc()` hoisted** to `services/spec-documents.ts`. `RELAY_DELIVERABLE` was hoisted with it — it was
> duplicated byte-for-byte, and the run service names those files in the framing the conductor reads while the
> progress service watches for the same names to close a phase. Two copies drifting is R5 arrived at by duplication.
> `RELAY_COMPLETION_NAMES` (read-side legacy tolerance) correctly stays in the progress service.
>
> **Deviation, accepted**: `tribunal-page.component.spec.ts` was edited though not in B5's table — its
> `TribunalStateService` stub needed `progress`/`specTaskId` and `TribunalProgressService` had to be provided.
> Same lib, spec-only, gate could not pass without it. Same shape as B3's accepted deviation.
>
> **Open nit carried from B5, not a defect**: if a folder listing races a just-written artifact, that phase reads
> `Failed` until the next tick. This is exactly why the **Refresh progress** button had to ship in this batch.
> All four of B4's judgement calls were reviewed and agreed; `'unknown'` severity is **not** remapped at the render
> layer either, pinned by a test asserting the chip reads `unknown` literally.
> **Recommended Executor**: `frontend-developer`
> **Execution Mode**: `sequential`
> **Dependencies**: **B3 and B4 complete**
> **Disjoint with**: —

**Files touched** (all under `libs/frontend/tribunal-panel/`)

| File                                                          | Action                                                                                                                                                     |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/components/relay-phase-rail.component.ts`            | CREATE — four-step rail; per-step lane name, deliverable filename, status; open-deliverable action; reassignment display; "phase progress unavailable" arm |
| `src/lib/components/relay-phase-rail.component.spec.ts`       | CREATE                                                                                                                                                     |
| `src/lib/components/crucible-verdict-panel.component.ts`      | CREATE — "Round N of M"; verdict chip (4 states incl. `awaiting`); defect list with severity + `file:line`; mentor note; terminal-state labels             |
| `src/lib/components/crucible-verdict-panel.component.spec.ts` | CREATE                                                                                                                                                     |
| `src/lib/tribunal-page.component.ts`                          | MODIFY — per-move strip above the tile grid; role badge into `tileLabel`; **Refresh progress** button; `Close Tribunal` unchanged                          |
| `src/lib/tribunal-tile-host.component.ts`                     | MODIFY — optional `role` input as a header badge. Status vocabulary unchanged                                                                              |
| `src/index.ts`                                                | MODIFY — export the new progress types                                                                                                                     |

**Acceptance criteria closed**: AC-4.1, AC-4.4, AC-4.5 (UI arm), AC-5.1, AC-5.2, AC-5.3, AC-5.4, AC-5.5,
AC-5.6, **AC-5.7**, AC-6.3, AC-6.4, NFR-1, **NFR-4**

**Verification gate**

```bash
npx nx typecheck tribunal-panel
npx nx test tribunal-panel
npx nx lint tribunal-panel
```

Plus an explicit grep assertion that **no `[innerHTML]` binding exists anywhere in the lib** (AC-5.7 / NFR-4).

**Validation notes**

- **R8 / NFR-4**: the mentor note goes through `MarkdownBlockComponent` (`libs/frontend/markdown` — the single
  DOMPurify chokepoint). Defect `what` and `expected` render as **interpolated text**, not markdown —
  interpolation is the cheaper and stronger guarantee against a markdown-link payload.
- **Preflight item 5**: `provideMarkdownRendering()` is already installed app-wide (`app.config.ts:72`) and that one
  config serves both the VS Code webview and the Electron renderer. **Import the component; do not add a second
  provider.**
- **AC-5.5**: on `REJECT` the UI states the loop stopped and the approach is not being patched. It must present
  **no revise affordance**. This is a distinct render path, not a styling variant of `revise`.
- **AC-5.6**: all four terminal states distinguishable — `PASS` (noting the conductor still verifies against the
  build: "the judge's PASS is an opinion; the build is the fact"), cap-reached-with-defects, regression-stop, reject.
- **AC-5.3**: defects with no `file:line` are already dropped by the B2 parser. The UI must **not resurrect them**.
- **R1**: the **Refresh progress** button is this batch's deliverable and is the only escape hatch for a
  conductor-authored artifact that no agent tick follows.
- `slotFor` and `TRIBUNAL_MAX_VENDOR_TILES` stay untouched — the per-move strip renders **above** the grid
  (AC-6.3 by non-modification).
- **No live run needed** (R10): components are driven from `TribunalProgress` fixtures in TestBed.

---

## B6 — Mirror the wire-format change into the skill references

**Status**: `COMPLETE`. Not committed. Gate: all seven content files `cmp` exit 0 after the edit.
The dev-side mirrors were made by **byte copy, not retyped**, so re-divergence is structurally impossible.

> **AC-2.8 verified by comparison, not assertion.** `tribunal-run.service.ts:411` emits
> `  [tribunal:<laneId>] (<role>) <displayName> — <spawn>` — lowercase role in round parentheses, one space after
> the `]` tag and one before the display name, `<role>` ∈ `plan|architect|implement|review|executor|judge`
> (the `as const` literals at `tribunal-ui.types.ts:17-29`). The two prose strings were **byte-compared** against
> the emitted lines rather than eyeballed: the authoritative line (`:355`) and the `Spec folder:` line (`:348`).
>
> **Carry forward**: `.github/skills/` is gitignored (`.gitignore:190`), so the dev-side mirrors are local-only and
> never appear in `git status`. **B0's byte-equality invariant is enforceable only by the `cmp` gate — a diff review
> or a PR will never catch a re-divergence.** Any later batch that assumes git would catch it is wrong.
> **Recommended Executor**: `frontend-developer`
> **Execution Mode**: `sequential`
> **Dependencies**: **B3 complete**. Per plan §4, **must land in the same PR as B3's framing change** — the panel and
> the skill must never be on `main` disagreeing about the wire format.
> **Disjoint with**: B4, B5

**Files touched**

- `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/references/vendor-panel.md` — MODIFY §0
  (`:11-30`): the `(<role>)` token form and that when present the role is **authoritative**; the `Spec folder:` line
  and "do not scan for or allocate a new task id"
- `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/references/crucible.md` — MODIFY at `:51`:
  one line deferring to `vendor-panel.md` §0 — when a role token is present, the first-lane/last-lane heuristic does
  not apply and no confirmation round-trip is needed
- **`.github/skills/tribunal/references/vendor-panel.md`** — MODIFY, identical edit ← **FLAG 2 addition**
- **`.github/skills/tribunal/references/crucible.md`** — MODIFY, identical edit ← **FLAG 2 addition**

**Acceptance criteria closed**: **AC-2.8**; preserves B0's invariant

**Verification gate** (doc-only):

```bash
for f in SKILL.md references/council.md references/crucible.md references/forge.md \
         references/race.md references/relay.md references/vendor-panel.md; do
  cmp "apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/$f" \
      ".github/skills/tribunal/$f"
done
```

**Gate corrected after B0** — the original `git diff --no-index` form asserted an empty tree diff, which is
unreachable: `.history/**` and `.ptah-origin.json` exist only on the dev side and are permanent. Assert byte-equality
of the **seven content files** instead. Then confirm by reading that the `(role)` token documented in `vendor-panel.md` §0 is
**character-identical** to what `tribunal-run.service.ts` actually emits — the AC-2.8 failure mode is a plausible
paraphrase, not an obvious omission.

**Validation notes**

- This is a **doc-alignment edit mandated by AC-2.8, not a behaviour change to the move** (requirements §11 respected).
  Do not take the opportunity to "improve" `crucible.md`'s protocol.
- **NFR-6**: `apps/ptah-extension-vscode/assets/plugins/**` is excluded from the VSIX by `.vscodeignore`, so the
  trademarked-name scanner does not apply here. Do not add vendor names to any _new_ non-JS file.

---

## B7 — Release step (NOT a code change)

**Status**: `COMPLETE for this task` — Steps 1–3 done and committed. Steps 4–5 **deferred by the user** as a
separate release decision.

| Step                                           | State                                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1. `node scripts/generate-content-manifest.js` | ✅ 214 plugin + 15 template files, 229 total                                                 |
| 2. `crucible.md` in `plugins.files`            | ✅ tribunal now lists **7** files, was 6                                                     |
| 3. `contentHash` changed                       | ✅ `sha256:45fc296e…` → `sha256:8bee40f9…` (a real content change, not a `generatedAt` bump) |
| 4. Merge to `main`                             | ⏭ **DEFERRED by the user** — not part of this task's completion                             |
| 5. Clean-profile verification                  | ⏭ **DEFERRED with step 4** — it verifies the download only `main` serves                    |

**Steps 4–5 are deliberately deferred, not forgotten.** The manifest is regenerated and committed, but
`ContentDownloadService` reads `main` and only `main` — so **Crucible still reaches zero users until this branch
merges**. That is a release decision the user is taking separately, not an unfinished part of the build.

---

## Completion

**All eight batches delivered.** Committed to `ak/tui-defects` as `06cf3ed68`
_"feat(webview): launch Relay and Crucible from the Tribunal panel"_ — 53 files, +9437/−127.

| Gate                                  | Result                                                                |
| ------------------------------------- | --------------------------------------------------------------------- |
| `nx test tribunal-panel`              | **16 suites / 330 passed** (baseline 11/196)                          |
| `nx affected -t typecheck`            | 90 projects, exit 0                                                   |
| `nx lint tribunal-panel`              | clean                                                                 |
| `nx test task-specs` / `rpc-handlers` | 404 / 1910 passed — contract guard and allowlist partition both green |
| `[innerHTML]` grep over the lib       | zero matches across 42 files                                          |
| Skill-copy `cmp` (7 files)            | identical, re-verified **after** the pre-commit formatter ran         |

Re-verified post-commit: the hooks ran `nx format:write` across all 53 staged files, so both the skill-copy
byte-equality and the full test suite were re-run afterwards. Both hold.

**Carried out of this task, by design:**

- **TASK_2026_238** — codex adapter path fix. Gates live end-to-end QA of a real Relay or Crucible run; everything
  here is unit-verified only. Owned in a separate session.
- **Public docs** (`apps/ptah-docs/src/content/docs/tribunal/`) — needs a written Crucible page plus Starlight
  sidebar wiring, sequenced after the UI ships (requirements §10).
- **CI wiring for `generate-content-manifest.js`** — a DEVOPS task. This task is the evidence for it: the manifest
  sat stale from 2026-08-09 with nothing in 16 workflows to catch it, and `pruneStaleFiles` would have deleted
  `crucible.md` had it arrived by any other route.
  **Recommended Executor**: `devops-engineer`, **or the orchestrator directly** (plan §7)
  **Execution Mode**: `sequential`
  **Dependencies**: **B0–B6 all complete**
  **Disjoint with**: —

**This batch ships no TypeScript.** It is the release procedure from requirements §8 Finding 1, without which
Crucible reaches **zero users** — `ContentDownloadService` reads the manifest from `main` and only `main`, and
`pruneStaleFiles` actively **deletes** any local file the manifest does not list.

**Files touched**

- `content-manifest.json` — REGENERATE via `node scripts/generate-content-manifest.js` (do not hand-edit)

**Acceptance criteria closed**: requirements §7, §8 Finding 1 Steps 1–3; DoD "`content-manifest.json` regenerated
and containing `crucible.md`; merged to `main`; verified on a clean profile"

**Verification gate** (the one non-unit gate in this breakdown — a release procedure, by nature)

1. `node scripts/generate-content-manifest.js`
2. Confirm `ptah-core/skills/tribunal/references/crucible.md` appears in the manifest's `plugins.files` array
3. Confirm `contentHash` **changed** from its committed value (a `generatedAt` bump alone is not proof)
4. Merge to `main`
5. Clean-profile verification: delete `~/.ptah/.content-cache.json` and `~/.ptah/plugins/ptah-core/`, launch, and
   confirm `~/.ptah/plugins/ptah-core/skills/tribunal/references/crucible.md` exists on disk

**Validation notes**

- **Not blocked by TASK_2026_238.** Step 5 exercises `ContentDownloadService`, not a CLI lane spawn — so this
  batch's gate is executable today even though live Relay/Crucible QA is not.
- No extension re-publish, no Electron release and no CLI release is required. Skill content ships independently
  of all three.
- **CI wiring for `generate-content-manifest.js` is explicitly NOT part of this batch or this task.** It is a
  separate DEVOPS task (requirements §8, §11). File it; do not absorb it.

---

## Execution order at a glance

```
B0  (doc re-sync — FIRST, non-negotiable)
 ├─ B1  (backend/shared RPC)      ─┐  file-disjoint; parallel ONLY in separate worktrees
 └─ B2  (frontend types, additive)─┘
       ├─ B3  (run service + wizard — the breaking change)  ─┐  file-disjoint; parallel ONLY
       └─ B4  (progress service; also needs B1)             ─┘  in separate worktrees
             ├─ B5  (run-view components; needs B3 + B4)
             └─ B6  (skill doc mirror; needs B3, same PR as B3)
                   └─ B7  (release; needs all)
```

**Parallelism opportunities identified by the plan**: **B1 ‖ B2** and **B3 ‖ B4**. Both are genuine file-disjoint
wins and both share a whole-lib or whole-workspace verification gate, so both require worktree isolation to be
worth taking. In a single shared worktree, run everything sequentially in the order above.

## Post-B7 — carried forward, NOT batches here

- Public docs rewrite, `apps/ptah-docs/src/content/docs/tribunal/` — follow-up task (requirements §10)
- CI wiring for `generate-content-manifest.js` — separate DEVOPS task (requirements §8)
- Live end-to-end Relay and Crucible QA — sequence **after** TASK_2026_238 lands (plan §6 R10)
