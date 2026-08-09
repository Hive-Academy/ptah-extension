# Adoption report — TASK_2026_179, first production run of `task-doctor`

**Date**: 2026-08-09 · **Workspace**: `D:\projects\ptah-extension` · **Branch**: `ak/license-server-validation-pipe`

Twelve carrier-less folders under `.ptah/specs/` were adopted. All twelve now hold a
`task.md` that `parseTaskFile` returns as `{ kind: 'task' }` with **zero validation
issues**, so all twelve are visible to the Tasks board. No task folder was renamed, no
new task id was allocated, no git operation was performed.

---

## 1. How it was driven

**`task-doctor` was driven directly, not hand-written.** `TaskDoctorService.plan()` →
`apply()` → `plan()` again → `undo()` were all exercised against the real tree.

### Correction to the task brief: the `ptah spec` CLI verbs DO exist

The brief said the CLI verbs "were never finished, so there is no command-line entry
point," and asked me to confirm that gap. **It is not a gap.** Step 16 of `context.md`
shipped:

- `apps/ptah-cli/src/cli/router.ts:776` registers `program.command('spec')` with
  `new / status / show / list / check / doctor`.
- `apps/ptah-cli/src/cli/commands/ptah-spec.ts:511-568` implements all three doctor
  modes — `--plan`, `--fix`, `--undo` — resolving `TaskDoctorService` from the container.
- `apps/ptah-cli/src/cli/commands/ptah-spec.spec.ts:625` already covers
  `spec doctor --plan` as read-only against real files.
- Step 18 also shipped: `tasks:adopt` and `tasks:doctorPlan` are live in
  `tasks-rpc.handlers.ts`.

I still used an in-process harness rather than the CLI binary, for one reason: the
doctor's `AdoptAction` carries no `description` and infers `type` as a hardcoded
constant (defects D2/D4 below), so `spec doctor --fix` would have written twelve carriers
that say `FEATURE` and carry no description. The harness let me take the doctor's own
`DoctorPlan` object, correct `title` / `type` / `status` per folder against the prose and
the git history, and hand the corrected plan straight back to the **real** `apply()` —
which is exactly the human-in-the-loop contract the service documents ("callers can show
the result verbatim and let a human decide"). Everything downstream of that point —
journal, ordering, `adoptFolder`, the `status_inferred` tag, the contract stamp — is the
shipped code path, unmodified.

### Run transcript (abridged)

```
===== UNDO (prior run) =====        ok: true  reverted: 13   (12 carriers + stamp; all 12 confirmed gone)
===== RAW DOCTOR PLAN =====         stampVersion: null  contractVersion: 1
                                    adopt candidates: 12   unexpected (not in the 12): []
                                    renameLegacyBatches candidates: 12  (EXCLUDED — see §4)
===== APPLY =====                   ok: true  applied: 12
                                    journal: .ptah\specs\.doctor-journal.json
===== RE-PLAN =====                 remaining adopt actions: 0   stampVersion now: 1
re-adopt guard (adoptFolder on an already-adopted folder): CARRIER_EXISTS
```

The re-adopt guard is the load-bearing one: adoption **aborted** rather than falling
through to `allocateTaskId`. Confirmed empirically, not just by reading the code.

Descriptions were written in a second pass with the lib's own byte-preserving
`updateFrontmatter`. That pass is still fully covered by the journal, whose `create`
entry deletes the whole carrier on undo regardless of its contents.

---

## 2. The twelve folders

`Doctor` = what the unmodified tool inferred. `Final` = what was written after the prose
read + git cross-check. Divergences are explained in the evidence column.

| #   | Folder                          | Final status  | Final type | Doctor said                                        | Evidence used                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------- | ------------- | ---------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `TASK_2026_155`                 | `in_progress` | FEATURE    | `in_progress` / FEATURE                            | `implementation-plan.md` present. **Git contradicts nothing but confirms nothing**: zero commits matching `/goal`, and `grep` for `GoalManager` / `goal:` / `GOAL_TOKENS` across `libs` + `apps` returns **no files**. Context log ends "Checkpoint 2 presented to user". Planned, approved, never implemented. See §5 — this is the one status I would not defend hard.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2   | `TASK_2026_160`                 | `done`        | FEATURE    | `done` / FEATURE                                   | `code-style-review.md` + `code-logic-review.md`. Commit `91ad76d37` "feat(cli-agents): add opencode & Pi providers with Pi RPC steering".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 3   | `TASK_2026_161`                 | `done`        | BUGFIX     | **`backlog`** / FEATURE                            | Doctor was wrong — see **D1**. Context's own batch table lists all 3 batches done; commits `1f3694ba7`, `f41a638ee`, `db2a44dac` (+ `bc3a482ab` CI green-up) match items A/B, C and D exactly. Type from context: "BUGFIX + REFACTORING".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4   | `TASK_2026_164`                 | `done`        | CREATIVE   | `in_progress` / **FEATURE**                        | Commit `d0f372a57` "feat(landing): reshape admin dashboard into a task-oriented console"; `TASK_2026_166/context.md` independently states "TASK_2026_164 (committed `d0f372a57`) rebuilt the admin IA". Type declared `CREATIVE` in this folder's own `context.md` frontmatter, which the doctor never reads (**D2**).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 5   | `TASK_2026_165`                 | `done`        | FEATURE    | `done` / FEATURE                                   | `code-logic-review.md`. Commit `061a19ab7` "feat(license-server): seamless Discourse SSO — auto-admin + one-click community login" (cited by 167's context). Noted in the description: superseded later by `fd1b4557e`, which retired the whole Discourse integration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 6   | `TASK_2026_166`                 | `done`        | CREATIVE   | `in_progress` / **FEATURE**                        | This folder's `tasks.md` ledger marks Wave 1, Wave 2, Wave 3 and the backend templates batch all `✅ DONE`. Commits `cdd4b7ce8`, `d0bc57469`. Type `CREATIVE` from its own `context.md` frontmatter (**D2**).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 7   | `TASK_2026_167`                 | `done`        | FEATURE    | `done` / FEATURE                                   | `code-logic-review.md` + `visual-review.md`. Discourse theme + `/api/v1/community/summary` shipped; later retired with `fd1b4557e`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 8   | `TASK_2026_168`                 | `done`        | CREATIVE   | `done` / **FEATURE**                               | `visual-review.md`. Commit `53feb7325` "feat(landing): declutter & consolidate the top navigation" — the commit subject is verbatim the task's chosen direction. Type `CREATIVE` declared in context (**D2**).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 9   | `TASK_2026_169`                 | `done`        | FEATURE    | `done` / FEATURE                                   | `test-report.md` + `code-logic-review.md`. Commits `b0dc64869` "feat(license-server): admin-authorized management of Builders content" and `13c05e3a5` "feat(landing): admin dashboard section for Builders content".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 10  | `TASK_2026_170`                 | `done`        | BUGFIX     | `in_progress` / **FEATURE**                        | **The headline stale-prose case.** `tasks.md` ends with the literal line `## Status: NOT STARTED — awaiting orchestrator to spawn B0`. Git says otherwise: B1–B9 all landed (`59eef2fcc` waitlist, `03cdc37b3` verify, `7aa728847` auth, `6ceceecbe` contact, `1e6fa07e3` session, `193a1c46a` checkout, `8f25aa3d1` marketing, `a74e923d1` admin records), plus the R1/R2 restructure (`6c877f264` "split the admin god-controller off the shared prefix") and `25950bb90` "guard payload validation across every controller". Decisive: the task defined its own completion gate as `UNVALIDATED_DEBT` being empty, and `apps/ptah-license-server/src/common/controller-validation.spec.ts:78` now reads `const UNVALIDATED_DEBT: readonly string[] = [];`. Its own reports (`implementation-report-b0/r1/r2.md`) are all 🟢 GREEN. |
| 11  | `TASK_2026_VOICE_PROVIDERS`     | `done`        | FEATURE    | `done` / FEATURE                                   | `test-report.md`. `libs/backend/voice-contracts` and `libs/backend/voice-providers` both exist and are in the root `CLAUDE.md` module index. Commits `c35b10e43` (ElevenLabs TTS + Scribe STT), `fe673f7de` (provider-agnostic voice RPC), `fa4628ae0` (settings UI), `fffb075d9` (custom model source), `13551f2fe` (embedder in `utilityProcess`), `a652bdd9d` (onnxruntime-node pin).                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 12  | `TASK_WORKSPACE_SCOPING_REVIEW` | `done`        | BUGFIX     | `done` / FEATURE, **title = the bare folder name** | Only file is `code-logic-review.md` — a review of commit `ef32f9c4b`, scored 5/10 NEEDS_REVISION with 6 failure modes. Follow-up commit `88f68ea53` "fix: harden workspace scoping from dual code review" closes it. Doctor produced a content-free title (**D3**); the real title came from the review's own H1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Every one of the twelve carries `status_inferred: true`.

Commit-reachability note: of the evidence commits, only `c35b10e43` is an ancestor of
`main`; the rest are ancestors of the current `HEAD` but not yet of `main` (main is
behind this line of development). `done` is still the right call — the work exists and is
merged into the working line — but a reader reconciling against `main` alone will not see
it.

### Status distribution

| Status                                            | Count |
| ------------------------------------------------- | ----- |
| `done`                                            | 11    |
| `in_progress`                                     | 1     |
| `backlog` / `in_review` / `blocked` / `cancelled` | 0     |

### The two non-conforming folder names — decision recorded

`TASK_2026_VOICE_PROVIDERS` and `TASK_WORKSPACE_SCOPING_REVIEW` do not match
`TASK_YYYY_NNN`. **Decision: adopt both, with the folder name as the id, unchanged.**
Verified, not assumed:

- `TaskScannerService.scan` (`task-scanner.service.ts:115-117`) filters on
  `type === Directory && !name.startsWith('.')` — there is **no** shape check on the
  folder name anywhere in the read path. Both folders are scanned like any other.
- `parseTaskFile` applies no schema to `id`; `id === folderName` here, so no
  `id_mismatch`.
- `allocateTaskId` (`id-allocator.ts:12`) matches `/^TASK_(\d{4})_(\d+)/`, so neither
  folder participates in id allocation. They cannot collide with, skip, or perturb a
  numeric id.
- Confirmed empirically: both parse as `{ kind: 'task' }` with 0 validation issues.

Forcing either into a numeric id would have required renaming a folder — forbidden — and
would have broken the inbound reference from `TASK_2026_161/context.md`, which cites
`.ptah/specs/TASK_2026_160/followup-*.md` style paths by name.

---

## 3. Could not confidently infer

**None of the twelve produced an unusable carrier.** One qualifier:

- **`TASK_2026_155` status.** `in_progress` is the doctor's inference and is written
  as-is, but the evidence is genuinely thin in a way the others are not: the plan is
  approved and zero lines of it exist in the tree. Its `context.md` log ends at
  "Checkpoint 2 presented to user", which reads as _waiting on a human_, i.e. `blocked`.
  I did not write `blocked` because that asserts a specific blocker the folder never
  names, and `status_inferred: true` is on the carrier for exactly this reason. ~~**A human
  should decide between `in_progress` and `blocked` here.**~~

  **RESOLVED 2026-08-09 — `blocked`, decided by the user.** On review the blocker IS
  nameable: Checkpoint 1 carries an explicit `APPROVED by user` line in that log and
  Checkpoint 2 carries no answering line, so the task waits on an architecture approval
  that was never given. Note also that `in_progress` on a task with zero implementation
  commits is itself the board-lies-with-confidence failure this task set exists to remove
  — so the real choice was never `in_progress` vs `blocked`, it was `blocked` vs
  `backlog`. `status_inferred: true` was dropped from the carrier when the status became a
  human decision rather than a deduction, and the carrier's description was corrected: it
  claimed the architecture was "approved at Checkpoint 2", which inverts what the log
  says. Verified before the change, not assumed: no `libs/backend/goal-workflow`, zero
  references to `GoalManager` / `StopDecisionRegistry` across `libs` and `apps`, no
  `goal:` RPC namespace, no matching commit; and the plan's reserved migration
  `0029_goals` has since been consumed by `0029_task_specs.ts`, so it needs renumbering
  before anyone restarts. Full detail in `TASK_2026_155/context.md`.

- **`TASK_WORKSPACE_SCOPING_REVIEW` type.** It is a review artifact, not a build. I typed
  it `BUGFIX` because the review drove a real fix commit (`88f68ea53`). `RESEARCH` is a
  defensible alternative reading.

---

## 4. Scope deliberately excluded from `apply()`

The doctor's raw plan contained **12 `renameLegacyBatches` actions** (`tasks.md` →
`batches.md`) for `TASK_2026_157/158/163/164/166/170/171/173/177/179` and
`TASK_2026_VOICE_PROVIDERS` — including `TASK_2026_179`'s own `tasks.md`. **All were
filtered out.** Adoption was the task; renaming a dozen other folders' files (four of
them outside the twelve, one of them this task's own) is a separate, unrequested
mutation, and `LEGACY_BATCHES_FILE` is a permanent fallback so nothing is broken by
leaving them. They remain in the plan for whoever wants them.

**Decision recorded 2026-08-09: leave them, indefinitely.** Confirmed by the user after
the post-fix re-run surfaced the same 12 (now including `TASK_2026_187`, which did not
exist at the time of the first run). The fallback is permanent by design, so the renames
buy uniformity and nothing else, against mutating twelve folders nobody asked about —
one of them this task's own `tasks.md`, which was being edited at the time.

---

## 5. Defects found in `task-doctor` and its dependencies

Six, all reproduced against the real tree. D1–D4 are why the plan needed human correction
before `apply()`.

### D1 — `COMPLETION_ARTIFACTS` misses most real-world review files → completed work reported as `backlog`

`task-spec.contract.ts` derives it from the **closed** `DOC_FILES` set:

```ts
export const COMPLETION_ARTIFACTS: readonly DocFile[] = DOC_FILES.filter((name) => name === 'test-report.md' || name.endsWith('-review.md'));
```

Because `DOC_FILES` is closed, that resolves to exactly three names:
`test-report.md`, `code-style-review.md`, `code-logic-review.md`, `visual-review.md`. The
stated rule — "a folder carrying `test-report.md` or **any** `*-review.md`" — is not what
runs. The filter is applied to a fixed list, not to the folder's actual contents.

**Observed**: `TASK_2026_161` holds `batch2-logic-review.md`, `batch1-report.md`,
`batch3-report.md`. None is in `DOC_FILES`, so `inferredFrom=[]` and the doctor planned
`status: backlog` for a task with **three shipped commits**. That is precisely the
"board lies with confidence" failure the adoption rules exist to prevent, produced by the
tool built to prevent it. `TASK_2026_VOICE_PROVIDERS` has the same shape
(`batch-3-tests-report.md`, eight `batch-*-report.md` files) and was only saved by also
having a canonical `test-report.md`.

**Fix**: in `planAdoption`, match the folder's actual filenames against a pattern
(`/-review\.md$/`, `/-report\.md$/`, `test-report.md`) rather than intersecting with
`DOC_FILES`. Keep `DOC_FILES` closed for the CI ratchet; status inference is a different
question from "which filenames may agents create".

### D2 — `type` is a hardcoded constant, and declared metadata sitting in `context.md` is ignored

`planAdoption` returns `type: 'FEATURE'` unconditionally, with a comment saying no
artifact reliably encodes the type. That is not true of this tree.
`TASK_2026_164/context.md` and `TASK_2026_166/context.md` **open with a full carrier
frontmatter block** — `id`, `status`, `type: CREATIVE`, `title`, `created`, `updated` —
and `TASK_2026_168`/`161`/`170`/`155` state their type in a `**Type**:` line in the first
ten lines. `inferTitle` already opens `context.md`; it reads past the frontmatter looking
for an H1 and discards it.

**Observed**: 5 of 12 types (`161`, `164`, `166`, `168`, `170`) would have been wrong.

**Fix**: parse `context.md`'s leading frontmatter when present and lift `type` (and
`title`) from it; fall back to a `**Type**: X` line scan; only then default. Do **not**
lift `status` from it without keeping `status_inferred` — `164` and `166` both declare a
stale `in_progress` there.

### D3 — `inferTitle` reads only `context.md`, and takes the first H1 whatever it says

Two failure shapes, both hit:

- `TASK_2026_170/context.md` and `TASK_2026_VOICE_PROVIDERS/context.md` both open with
  `# TASK_XXXX — Context`. The doctor proposed the literal titles
  **"TASK_2026_170 — Context"** and **"TASK_2026_VOICE_PROVIDERS — Context"**.
- `TASK_WORKSPACE_SCOPING_REVIEW` has no `context.md` at all, so the fallback fired and
  the proposed title was the bare folder name **"TASK_WORKSPACE_SCOPING_REVIEW"** — even
  though its sole file, `code-logic-review.md`, opens with a perfectly serviceable H1.

3 of 12 titles carried no information. A board row reading "TASK_2026_170 — Context" is
the "unknown task" outcome under a different spelling.

**Fix**: reject an H1 that is the folder name, or the folder name plus a separator plus a
generic word (`Context`, `Notes`, `Plan`, `Report`); and when `context.md` is absent or
useless, fall through to the other prose files in the folder before defaulting to the
folder name.

### D4 — `AdoptAction` cannot carry a `description`, though every layer beneath it can

`renderTaskMd` accepts `description`. `TaskWriterService.adoptFolder`'s `AdoptFolderInput`
accepts `description`. `AdoptAction` does not declare it, and `executeAction` does not
pass one. `spec doctor --fix` therefore cannot ever produce a carrier with a description —
the field is dropped between the only two layers that both support it. All 12 descriptions
here were written by a separate `updateFrontmatter` pass.

**Fix**: add `description?: string` to `AdoptAction` and forward it in `executeAction`.
One-line change on each side.

### D5 — `parseTaskFile` is NON-DETERMINISTIC: the same bytes give a different exclusion reason on the second call

The most serious finding, and it is in `task-frontmatter.ts`, not the doctor — so it
affects the scanner and the board's exclusions drawer too.

Reproduced with a 3-iteration probe over the unmodified bytes of
`.ptah/specs/TASK_2026_182/task.md`:

```
pass 0: excluded yaml_unparseable
pass 1: excluded invalid_status
pass 2: excluded invalid_status
```

Cause: `task-frontmatter.ts:233` calls bare `matter(normalized)` with no
`{ cache: false }`. gray-matter keeps a module-global cache keyed by the input string; the
first call throws out of the YAML engine, but the cached entry survives with an empty
`data`, so every later call returns `{}` instead of throwing — and the parser falls
through to the `status` check and reports `invalid_status` instead of `yaml_unparseable`.

This is exactly what I observed live during the run: the same three folders
(`182`, `188`, `189`) were reported `yaml_unparseable` in the first `plan()` and
`invalid_status` in the second `plan()` four seconds later, within one process.

**Impact**: step 10 of this task's plan ships an exclusions drawer that lists each excluded
folder "BY NAME with its typed reason". That reason is not stable — a user gets a
different diagnosis for the same file depending on whether anything parsed it earlier in
the session. Secondarily, the cache is unbounded in a long-lived extension host.

**Fix**: `matter(normalized, { cache: false })` at both call sites
(`task-frontmatter.ts:233` and `:530`).

### D6 — a single plan can contain an `adopt` whose `inferredFrom` cites a file that a `renameLegacyBatches` in the same plan deletes

For `TASK_2026_164`, `166`, `170` and `VOICE_PROVIDERS` the raw plan contained both
`ADOPT ... inferredFrom=[tasks.md]` and `RENAME ...\tasks.md -> ...\batches.md`.
`apply()` executes `plan.actions` in array order; the adopt happens to precede the rename
because of the order `plan()` pushes them, but nothing states or tests that invariant. If
it ever inverted, `apply()` would write a carrier whose status evidence points at a path
that no longer exists. Low severity, zero cost to pin: infer from `batches.md` when a
rename for the same folder is in the plan, or order the actions explicitly.

---

## 6. Side effects on disk

- `.ptah/specs/.doctor-journal.json` — 13 entries (12 carrier creates + the stamp create).
  `undo` reverses all of it; verified by actually running it.
- `.ptah/specs/.ptah-spec-contract.json` — now `{ version: 1 }`. It was absent before.
- Nothing else in `.ptah/specs/` was touched. No folder renamed, no `tasks.md` renamed,
  no existing carrier rewritten, no id allocated. `TASK_2026_176`'s `id: TASK_2026_178`
  mismatch was reported as a warning and left exactly as it was, as required.
- Temporary harness files were removed: `libs/backend/task-specs/src/lib/tmp-*.spec.ts`,
  and `tmp-179-*` at the repo root.

## 7. Unrelated observations worth someone's attention

- `TASK_2026_182`, `TASK_2026_188` and `TASK_2026_189` have carriers that **fail to
  parse** and are therefore invisible to the board despite having a `task.md`. The real
  cause for at least 188 is an unquoted YAML plain scalar containing a flow mapping —
  `description:` begins `... a client sending {"field": null} to a ...`. `182` fails the
  same way. This is a live carrier-generation bug in whatever wrote them: `description`
  needs quoting/block-scalar treatment. (`188`/`189` were being written by a concurrent
  agent during this run; `182` dates from 2026-08-08 and is stable.)

---

## D6 — `renderTaskMd` writes descriptions as unquoted plain YAML scalars

Added 2026-08-09 after the adoption pass, by the orchestrator.

The three unparseable carriers this report flagged (`TASK_2026_182`, `188`, `189`)
share one root cause, and it is not authoring error. Every one of them was
written through the contract's own renderer, and `renderTaskMd` emits:

```yaml
description: <text verbatim>
```

A plain YAML scalar terminates at the first `: ` (colon-space). Any description
that quotes code breaks the whole document:

| Carrier | Killing substring                              |
| ------- | ---------------------------------------------- |
| 182     | `nativeAvailable ? describe : describe.skip`   |
| 188     | `{"field": null}`                              |
| 189     | `config({ path: resolve(__dirname, '.env') })` |

The failure is total, not partial — an unparseable carrier makes the task
invisible to the board, which is the exact condition this task exists to
eliminate. Three of the newest carriers in the repo were already dark.

Fixed in place by converting each to a folded block scalar (`description: >-`),
and all carriers in `.ptah/specs` now parse. That is a repair, not a fix: the
renderer will reintroduce it on the next write.

**The real fix belongs in `renderTaskMd`** — emit `description` as a block
scalar unconditionally, or quote and escape it. Prefer the block scalar: it
survives colons, braces, quotes and apostrophes without escaping, and stays
readable in the file. Pair it with a round-trip test that renders a description
containing `: `, `{`, `"` and `'`, reads it back with `parseTaskFile`, and
asserts byte equality. D5's `{ cache: false }` fix should land in the same batch,
since both are correctness bugs in the shared parse/render pair rather than in
the doctor that exposed them.
