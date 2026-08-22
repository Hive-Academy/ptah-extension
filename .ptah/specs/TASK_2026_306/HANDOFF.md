# Handoff — TASK_2026_306

**As of**: 2026-08-22 · **Branch**: `ak/boot-blocker-quota-gate` · **Status**: `in_progress`
**Batches**: 4 of 5 committed. Batch 2 is code-complete and green but **uncommitted and unreviewed**.

---

## 1. What this task is

A dev `nx serve ptah-electron` run never opened a window. The captured log
(`tmp/logs/log.log`, 1200 lines) yielded eight defects, A–H. Scope was set to
**A–G**; H is noise and has no batch.

Two independent S1 defects sat underneath the symptom:

- **A** — the activation chain awaits cron cold-start catchup, which runs every
  overdue job serially, so window creation waited on unbounded background work.
  This fires for a healthy provider with a large backlog too; the quota problem
  only made it infinite.
- **B** — the developer's Codex subscription was exhausted. The proxy answered
  429 correctly, but nothing consumed the signal, so background work looped
  against a dead endpoint, spent the remaining quota, and persisted a
  template-derived skill candidate from a provider that never answered.

---

## 2. Current git state

```
5f082759e  docs(harness-sync): record task 4.4 + batch 5, correct research-report §F
5c2090bdf  fix(harness-sync): report harness health at a scope both boot lines agree on
44c29592c  fix(task-specs): skip the predictably-offline index write instead of warning
8d8043b50  docs(task-specs): fold the batch 4 ruling into a single tasks.md section
fd23a1108  fix(workspace-intelligence): stop a missing file and an early write losing indexes
3da9b4431  fix(agent-sdk): stop discarding every session file and racing init on boot
8358528ff  fix(workspace-intelligence): declare typescript as a runtime dependency
a1c9f9335  fix(cron-scheduler): take cold-start catchup off the activation path
f40cc4e4f  fix(ci): repair the App Platform landing spec rejected at parse   ← NOT ours, see §6
```

Nothing is pushed. No stashes.

---

## 3. Batch status

| Batch | Defects                             | State                                         | Commit      |
| ----- | ----------------------------------- | --------------------------------------------- | ----------- |
| 1     | A — boot blocker                    | ✅ committed                                  | `a1c9f9335` |
| 3     | C, G — session import + double init | ✅ committed                                  | `3da9b4431` |
| 4     | D, E — index abort + early write    | ✅ committed                                  | `fd23a1108` |
| 4.4   | E — closes the last criterion       | ✅ committed                                  | `44c29592c` |
| 5     | F — harness-sync                    | ✅ committed                                  | `5c2090bdf` |
| **2** | **B — provider quota gate**         | ⚠️ **code-complete, uncommitted, unreviewed** | —           |

Plus `8358528ff`, an unplanned prerequisite — see §5.

---

## 4. Batch 2 — exactly where it stands

The implementing agent was **interrupted by a session exit**, then stopped, so
it cannot be resumed. Its work survived intact in the working tree: 27 modified
files plus three new ones (`provider-quota.error.ts`, `provider-quota.store.ts`,
`provider-quota.store.spec.ts`). Roughly +1345/−61 lines.

### Verified green by the orchestrator, after the interrupt

| Check                                                              | Result                                                                                             |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `nx run-many -t test -p auth-providers,skill-synthesis,agent-sdk`  | auth-providers 631 · agent-sdk 1043 · skill-synthesis 1324 (+37 pre-existing skips) — **all pass** |
| `nx run-many -t lint -p auth-providers,skill-synthesis,agent-sdk`  | **0 errors**, 35 warnings (all pre-existing kinds: `max-lines`, unused disable directives)         |
| `nx run-many -t build -p auth-providers,skill-synthesis,agent-sdk` | **pass**                                                                                           |

### The critical fix landed correctly

The one thing most likely to have been got wrong — **R1** — is right. In
`provider-auth-resolver.ts`, `resolve()` now computes
`providerId = requested || activeProviderId` and runs `assertNotCoolingDown`
**above** both early returns (`:108-110` empty id, `:111-113` id equals active
provider). Every lane ships `provider: ''` (inherit) and in the captured run the
exhausted provider _was_ the active one, so a check below those returns would
have been dead code on the exact path that produced this task.

`'quota-exhausted'` is in `SkillLaneFailureKind` and threaded through
`skill-drain.service.ts`, classified as TRANSPORT (requeue) rather than falling
through to `markUnscored`, with the family docs updated at `:110`, `:125`,
`:214`, `:870`, `:877`, `:885`, `:905`, `:921`. Code comments indicate the
`maxAttempts` ceiling is **exempt** for quota, matching `auth-unresolvable`.

### What is missing

1. **`batch-2-implementation.md` was never written** — the interrupt cost the
   report, not the code.
2. **No team-leader review and no commit.** Every other batch was reviewed
   before landing, and that review caught real problems in all four (§7).
3. The `maxAttempts` decision is visible in code comments but was never stated
   explicitly for the record.
4. Spec counts are unverified — every other batch's self-reported counts were
   checked, and two were wrong in opposite directions.

### To finish it

Do not re-implement. Spawn a fresh `backend-developer` to (a) re-read the
existing diff, (b) confirm R1 explicitly, (c) state the `maxAttempts` decision,
and (d) write the report — then hand to `team-leader` MODE 2 to verify and
commit. `tasks.md` Batch 2 holds the full six-task spec and the three answered
open questions. Do not relaunch the stopped agent's work from scratch.

---

## 5. The unplanned prerequisite

`8358528ff` moved `typescript` from `devDependencies` to `dependencies` in
`libs/backend/workspace-intelligence/package.json`.

It is **not** part of any batch. The pre-commit hook runs
`nx affected --target=lint`; Batch 1 touched one lib so its affected set was
narrow, but Batch 3 touched three, widening it to 29 projects and pulling in
`workspace-intelligence`, where `@nx/dependency-checks` fails because
`TypeScriptDiagnosticsProvider` calls `require('typescript')` at runtime.

Pre-existing on `main` — the lib is byte-identical there and fails identically.
The team-leader refused to use `--no-verify`, which was correct. Moving the
declaration changes nothing about what ships: the lib is `"private": true` and
`typescript` was already in the generated `dist/apps/ptah-electron/package.json`.
The electron `validate-deps` gate independently lists it as a detected runtime
import.

---

## 6. Decisions needed from the user

1. **`f40cc4e4f` (`.do/app.yaml`) does not belong on this branch.** It was an
   uncommitted working-tree change at session start, unrelated to this task, and
   a team-leader committed it during Batch 1. Nothing is pushed, so
   `git reset --soft` lifts it off cleanly. Still unanswered.
2. **Follow-up R2 — legacy skill adoption migration.** Needs a product decision,
   not a bugfix call: the migration **can overwrite a hand-authored skill**. See
   §7 on defect F for why it exists. Recommended as its own task.
3. **Whether to run a real `nx serve ptah-electron` cold start.** Several
   acceptance criteria across Batches 1, 3 and 4 are proven at spec level only
   and need one boot to confirm — including whether the window now opens at all.

---

## 7. Findings that changed the work

Recorded because they are not obvious from the diffs.

**Defect F is not a defect.** `research-report.md` §F claimed 13
manifest-expected files were produced by neither source. The premise was
inverted: all 13 exist on disk, all on the `claude` target, all legacy
`SkillJunctionService`-era copies that no manifest owns — so they are `foreign`
→ `blocked` → counted `missing` **by design**. They are 13 correct refusals to
overwrite files the reconciler does not own. Adoption fails for an accident of
history: `SkillJunctionService` wrote its `.ptah-managed.json` sidecar into
`.claude/commands` but had nowhere to put one for `.claude/skills`, which is why
all 7 legacy commands adopted and 0 of 13 skills did. `writeFailed: 0` was never
evidence writes succeeded — a blocked path never enters `plan.writes`. §F is
struck-through and corrected in place.

**My proposed design for defect B would not have fired.** The original report
put the quota check inside `ProviderAuthResolver.resolve()` without noticing the
two early returns above it. Caught at plan review, before any code was written.

**My proposed fix for defect E was also wrong.** I suggested running
`ensureSpecsReadme` at activation while deferring only the index rebuild;
`ensureSpecsReadme` early-returns on `state.specsDirExists`, which is written
_by_ `rebuild`, so the README cannot land without the scan. The working fix
(Task 4.4) came from the implementing developer instead.

**Two agent-reported numbers were wrong in opposite directions** — Batch 1
overstated its spec count (12 cases, not 14; the mutation result was actually
_better_ than claimed), Batch 4 understated its discriminating cases. Both were
caught by re-counting rather than by reading the reports.

---

## 8. Open follow-ups (recorded in `tasks.md`, none blocking)

| Id   | Item                                                                                                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F3-1 | A whitespace-only file under 8 KB reaches the filename fallback and produces the phantom `Session <date>` entry the sidecar guard exists to prevent. Gate on `bytesRead >= METADATA_PREFIX_BYTES`.             |
| F3-2 | `initInFlight` is correct only by promise-reaction FIFO ordering; an identity check (`if (this.initInFlight === p)`) removes the dependence on scheduling.                                                     |
| F3-3 | Two concurrent `reset()` calls can have the second answered by the guard after `dispose()`.                                                                                                                    |
| R1   | Log the blocked harness set as a distinct user-actionable message. Low risk, high diagnostic value — this is what cost the defect-F diagnosis its time.                                                        |
| R2   | Legacy skill adoption migration. **Product decision — can overwrite hand-authored skills.**                                                                                                                    |
| R3   | Name the blocked paths in the boot line.                                                                                                                                                                       |
| R4   | One spec for `formatClaudeSlice` — a pure three-branch function; the `0/0` state was an acceptance criterion and a named edge case.                                                                            |
| —    | VS Code host has the same scope defect at `apps/ptah-extension-vscode/src/activation/plugin-activation.ts:286-294`. Batch 5 made VS Code strictly worse: the two hosts at least used to agree with each other. |
| —    | `EPERM`/`EBUSY` missing from `MISSING_ENTRY_CODES`; on Windows a file locked by another process usually surfaces as `EPERM`, so one locked file still aborts a whole index.                                    |
| —    | The `onDidOpen` fix silently no-ops unless the SQLite token is registered before `startTaskSpecsIndex`. Both hosts order correctly today; nothing enforces it.                                                 |
| —    | `workspace-target.ts` contains two literal NUL bytes (deliberate sentinels written raw). Harmless at runtime, but `grep` treats the file as binary and skips it.                                               |

---

## 9. Files

```
.ptah/specs/TASK_2026_306/
├── task.md                        # carrier, status: in_progress
├── context.md                     # intent, scope, codebase constraints, decisions
├── research-report.md             # the defect inventory (§F corrected in place)
├── tasks.md                       # 5 batches, 18 tasks, per-task specs + rulings
├── batch-1-implementation.md
├── batch-3-implementation.md
├── batch-4-implementation.md
├── task-4-4-implementation.md
├── batch-5-implementation.md
├── batch-2-implementation.md      # ← MISSING, never written
└── HANDOFF.md                     # this file
```
