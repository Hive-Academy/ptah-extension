# Context — TASK_2026_179

## Orchestration metadata

- **Strategy**: REFACTORING, Partial depth
- **Skipped phases**: project-manager, software-architect — the design is
  settled by a prior 15-agent design workflow. Do NOT re-derive it.
- **cli_delegation**: disabled (sub-agent developers only)
- **Ships as two independent commits**: Phase 1 alone, then Phase 2 alone.

## Background

A prior session diagnosed why `.ptah/specs/` task folders go missing from the
Tasks board, ran a 15-agent design workflow, and shipped Phase 0
(commit `3245d9cb8`). Phases 1 and 2 remain.

### The decision — SETTLED, do not revisit

The carrier stays `task.md`. `context.md` does NOT become the carrier. The
reason is concurrency: today the two unsynchronized writers touch disjoint
files (the RPC rewrites frontmatter in `task.md`; agents write prose in
`context.md`), so the no-lock design is accidentally safe. Merging them would
put every agent prose-write onto the file the UI also mutates, and no RPC or
tool has a body-write path — those writes would be raw `Write` calls that
clobber `status:`.

The fix is to make ownership explicit, not to merge:

- `task.md` — machine-owned metadata carrier. Frontmatter + short pointer body.
- `context.md` and siblings — agent-owned prose. No machine rewrites them.
- `tasks.md` (team-leader batches) → renamed `batches.md`, permanent fallback.

Folder name stays the canonical id. A mismatched `id:` is a warning, never
auto-normalized.

### What Phase 0 already shipped (commit 3245d9cb8) — do not redo

- `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/SKILL.md`
  — id now comes from a folder scan, not `registry.md`; carrier creation added
  as step 3; continuation regex fixed from hard-coded `TASK_2025_` to
  `/^TASK_\d{4}_\d{3}$/`; phase table gained a "no task.md" row.
- Root `CLAUDE.md` — new "Task Specs" section.
- Six agent templates under `libs/backend/agent-generation/templates/agents/`
  — carrier contract note added.
- `ptah-core` plugin bumped to 1.5.0, `content-manifest.json` regenerated.

## Verified code facts — TRUST THESE, do not re-verify

- `CARRIER_FILE = 'task.md'` is duplicated as a local const in three files:
  - `libs/backend/task-specs/src/lib/task-scanner.service.ts:27`
  - `libs/backend/task-specs/src/lib/task-index.service.ts:75`
  - `libs/backend/task-specs/src/lib/task-writer.service.ts:48`
- `ensureStarted` is called ONLY from `tasks-rpc.handlers.ts` (lines
  122/141/158/184/235). Nothing calls it at host activation.
- `libs/frontend/tasks-ui/src/lib/task-presentation.ts:34-45` holds
  `WORKFLOW_ARTIFACTS`, a second divergent doc-file list.
- `spec-extractor.ts:125` returns null on a missing carrier,
  `spec-harvester.service.ts:241` drops nulls, and `harvest()` logs only when
  `harvested > 0`. A missed carrier is therefore a SILENT empty harvest.
- `orchestration-namespace.builder.ts:184` joins a dead `task-tracking/` root;
  line 189 hardcodes `['tasks.md']`.
- `IFileSystemProvider` has NO `rename` and NO exclusive write.
  `createDirectory` is recursive.
- `libs/backend/task-specs/src/lib/di/register.ts:57-65` selects the store
  LAZILY and falls back to `InMemoryTaskIndexStore` when better-sqlite3 fails.
  A SQLite column therefore CANNOT gate anything.
- `updateFrontmatter` re-dumps through `matter.stringify`. It is
  body-preserving but NOT frontmatter-byte-preserving.
- `ALLOWED_METHOD_PREFIXES` at `vscode-core/src/messaging/rpc-handler.ts:84`
  already contains `tasks:`.
- `.gitignore:128` is `.ptah/**` and `:141` is `.claude/agents/*`. There is no
  VCS undo for anything under those paths.
- Commit scopes are restricted. Allowed: webview, vscode, vscode-lm-tools,
  deps, release, ci, docs, hooks, scripts, landing, license-server, electron,
  cli.

## Phase 1 — contract module, collider rename, data-plane README

Ships alone. Ordered:

1. New `libs/shared/src/lib/types/task-spec.contract.ts`: `SPEC_ROOT`,
   `CARRIER_FILE`, `SPEC_CONTRACT_VERSION`, `DOC_FILES` (closed set:
   context.md, task-description.md, implementation-plan.md, batches.md,
   test-report.md, code-style-review.md, code-logic-review.md,
   visual-review.md, visual-design-specification.md, research-report.md,
   future-enhancements.md; `tasks.md` marked legacy), `renderTaskMd`,
   `renderSpecsReadme`, `CARRIER_BANNER`. It lives in `libs/shared` because
   `libs/frontend/tasks-ui` must consume it and cannot import a backend lib.
2. Re-export from `libs/shared/src/index.ts`.
3. Delete the three duplicated `CARRIER_FILE` consts; import from shared.
4. `task-writer.service.ts`: move `renderTaskMd` to the contract module. Body
   becomes banner + one-line summary + explicit pointer to `./context.md`.
   `updateStatus` gains a pre-write re-read and a typed `TASK_CONFLICT` error
   instead of clobbering. Extend the error union at lines 38-45.
5. `task-index.service.ts`: in `ensureStarted`, after `state.started = true`
   and after the initial rebuild, write `.ptah/specs/README.md` when its hash
   differs. Add self-write suppression to kill the current double rebuild.
6. `spec-extractor.ts`: read `batches.md` with a PERMANENT fallback to
   `tasks.md`. Add an explicit `warn` when a `TASK_*` folder yields a null spec.
7. `task-presentation.ts`: derive `WORKFLOW_ARTIFACTS` from shared `DOC_FILES`;
   accept `batches.md` or `tasks.md`.
8. `orchestration-namespace.builder.ts`: line 184 `task-tracking/` →
   `.ptah/specs/`; line 189 → `['batches.md','tasks.md']`.
9. New `libs/backend/task-specs/src/lib/contract.guard.spec.ts` CI ratchet:
   flag per-task filename string literals outside an allowlist; fail if any
   agent template or orchestration skill asset names a per-task `*.md` outside
   `DOC_FILES`; fail on `TASK_2025_`, `.ptah/tasks/`, or `task-tracking/` in
   any `.ts` or skill asset; round-trip `renderTaskMd` → `parseTaskFile` for
   every status × type pair.
10. `libs/frontend/tasks-ui/.../tasks-view.component.ts`: exclusions drawer
    listing every excluded folder BY NAME with its typed reason, not a count.
11. Call `ensureStarted(activeWorkspaceRoot)` at host activation in all three
    hosts: `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`,
    `apps/ptah-electron/src/di/phase-2-libraries.ts`,
    `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts`.
    Without this the README never lands, and the README is the ONLY channel
    that reaches a user whose `.claude/` clone is diverged.

## Phase 2 — callable write paths and adoption

Ships alone, after Phase 1:

12. `IFileSystemProvider`: add exactly ONE method,
    `createDirectoryExclusive(path)` — non-recursive mkdir, rejects EEXIST.
    Implement in platform-vscode / platform-electron / platform-cli, plus the
    mock and the shared contract test. Do NOT add `rename` or
    `writeFileExclusive` (see Rejected).
13. `task-writer.service.ts`: `create` uses allocate →
    `createDirectoryExclusive` → on EEXIST re-allocate, retry ≤5 → write
    carrier. Add a DISTINCT `adoptFolder(folderName)` that aborts on an
    existing carrier and never falls through to `allocateTaskId`.
14. New `task-doctor.service.ts` with `plan()` / `apply()`. Adoption infers
    status from artifacts and ALWAYS tags `status_inferred`. Writes
    `.ptah/specs/.doctor-journal.json` BEFORE the first mutation, recording
    creations, renames AND deletions with bytes. `--undo` reverses all three.
15. `task-frontmatter.ts`: add `dangling_depends_on` as a validation issue.
16. `apps/ptah-cli`: `spec new|status|show|list|check|doctor`, `--json` on all.
17. MCP `tasks` namespace in the always-on core set (NOT
    `disabledMcpNamespaces`): `ptah_task_create|update|get|list|check`. No
    `ptah_task_set_section` — prose stays in `context.md`.
18. RPC `tasks:adopt` and `tasks:doctorPlan`.
19. Integration test reproducing the loss interleaving: read carrier → RPC
    `updateStatus` → whole-file external write from the pre-update snapshot →
    assert `TASK_CONFLICT` or surviving status.

## Migration — no automatic mutation of task files, ever

`.ptah/**` is gitignored, so there is no git undo. The store selection is lazy,
so a SQLite `contract_version` cannot gate a migration — it would re-run on
every launch. Use a file stamp, `.ptah/specs/.ptah-spec-contract.json`,
fail-closed if unreadable.

In this workspace, 12 folders currently have no carrier and are invisible to
the board: 155, 160, 161, 164, 165, 166, 167, 168, 169, 170, VOICE_PROVIDERS,
WORKSPACE_SCOPING_REVIEW. Adopt them ONLY through `spec doctor --plan` then
`--fix`. Folders carrying `test-report.md` or `*-review.md` adopt as `done`,
not `backlog`.

`TASK_2026_176` declares `id: TASK_2026_178`. LEAVE IT. Normalizing it would
erase the only record of a declared id that the folder-scan allocator would
then re-issue to a different task. (This task was therefore allocated 179, not
178, to avoid re-issuing the declared id.)

## Rejected — do not propose these again

- `context.md` as the carrier. It is a content merge, not a rename, and it
  moves agent prose onto the file the UI mutates.
- Merging `context.md` into `task.md` at all, even opt-in.
- Renaming the carrier to `spec.md` or similar — a missed rename is a silent
  null-swallowed harvest failure.
- `IFileSystemProvider.rename` and `writeFileExclusive`. `vscode.workspace.fs
.writeFile` takes no options, so exclusive-write degrades to the same TOCTOU
  it was bought to close. Only `createDirectoryExclusive` is a real CAS.
- sha256 compare-and-swap, and mtime+size change detection (`backlog`/`blocked`
  and `in_review`/`cancelled` are same-length).
- A cross-process lockfile — an external Claude Code doing a raw `Edit` will
  not honor it.
- Automatic migration inside `ensureStarted`.
- Auto-normalizing a mismatched `id:`, and backfilling banner or version into
  existing carriers.
- SQLite migration 0030. Nothing here needs a schema change.
- Deriving the next id from `registry.md`, permanently.

## Verification

Run and report actual output:

```
npx nx run-many -t typecheck,test,lint -p shared task-specs rpc-handlers \
  tasks-ui vscode-core platform-core platform-vscode platform-electron \
  platform-cli skill-synthesis cli-engine
```

## Constraints

TypeScript 5.9 strict, `catch (error: unknown)`. Zod 4 at every boundary.
Backend depends on `platform-core` ports, never adapters. Frontend libs must
not import backend libs. Angular OnPush + signals. Use complete absolute
Windows paths for all Read/Write.

---

# Defects found on the first real run — 2026-08-09

`task-doctor` was built by this task and, until 2026-08-09, had never been run
against anything. That day it adopted all 12 carrier-less folders in
`.ptah/specs`. It worked — 12 of 12 adopted, `plan() → apply() → plan() → undo()`
verified, undo reverting all 13 effects file by file, `adoptFolder` returning
`CARRIER_EXISTS` and never falling through to allocation.

It also produced wrong output in six ways. Full evidence and the per-folder table
are in `./adoption-report.md`. These are defects in **this task's own
deliverable**, which is why this task moved back from `in_review` to
`in_progress`.

> **All six are closed as of 2026-08-09.** Five were real and are fixed. One —
> D6 — was misdiagnosed: the defect is real and carriers really did go dark, but
> it is NOT in `renderTaskMd`. See the D6 entry for the evidence and the actual
> fix. Each entry below now ends with what was done.

## D6 — `renderTaskMd` writes descriptions as unquoted plain YAML scalars

**The most urgent of the six: it makes tasks vanish rather than merely mislabel
them.**

`renderTaskMd` emits `description: <text verbatim>` on one line. A plain YAML
scalar terminates at the first `: ` (colon-space), so any description that quotes
code destroys the document and the carrier stops parsing. Three of the newest
carriers in the repo were already invisible to the board:

| Carrier         | Killing substring                              |
| --------------- | ---------------------------------------------- |
| `TASK_2026_182` | `nativeAvailable ? describe : describe.skip`   |
| `TASK_2026_188` | `{"field": null}`                              |
| `TASK_2026_189` | `config({ path: resolve(__dirname, '.env') })` |

Repaired in place on 2026-08-09 by converting each to a folded block scalar
(`description: >-`); every carrier under `.ptah/specs` parses as of that date.
**That was a repair, not a fix** — the renderer reintroduces the defect on the
next write, so this stays open.

### RESOLVED 2026-08-09 — but the diagnosis above was wrong about the writer

The symptom is real and the three carriers really were dark. The attributed
cause is not. **`renderTaskMd` has never emitted an unquoted `description`.**

Evidence, from running the shipped code rather than reading it:

```
renderTaskMd({ description: 'nativeAvailable ? describe : describe.skip and
                             {"field": null} and it\'s "quoted"' })
→ description: "nativeAvailable ? describe : describe.skip and {\"field\": null} and it's \"quoted\""
parseTaskFile(...) → { kind: 'task', description: <byte-identical> }
```

`yamlScalar` (`task-spec.contract.ts:230`) routes any value failing
`isPlainSafeScalar` through `JSON.stringify`, and JSON string syntax IS a valid
YAML double-quoted scalar. A description containing `: ` has always been quoted.

The corroborating detail nobody checked: all three dark carriers carry
`assignee:` and `claim:` — fields `renderTaskMd` does not emit and never has. They
were **hand-authored by agents**, from the frontmatter template in
`skills/orchestration/references/task-tracking.md:48`, which showed:

```yaml
description: One-line summary (optional; long form goes in the body)
```

A plain scalar in the one document that teaches agents how to write a carrier by
hand. That is the defect, and it explains the pattern precisely: the machine
write path was always safe; every dark carrier came from the hand path.

**Fixed:**

- `task-tracking.md` (shipped asset + the `.claude/` mirror): both the
  frontmatter contract and the `task.md` template now show `description: >-`,
  with a section stating why and naming the three carriers it cost. `plugin.json`
  1.5.1 → 1.5.2, `content-manifest.json` regenerated.
- Root `CLAUDE.md` "Task Specs" gained the same rule — it is the instruction
  surface agents actually read.
- `contract.guard.spec.ts` gained the requested round-trip ratchet: the three
  exact killing strings from `182`/`188`/`189` plus one carrying `: `, `{`, `"`
  and `'` together, rendered → parsed → asserted byte-equal on the field.

**Deliberately NOT done: switching `renderTaskMd` to a block scalar.** The
instruction to "emit a block scalar unconditionally" was premised on the writer
being broken. It is not. Swapping a correct quoted emitter for a block-scalar
one changes the golden bytes the contract ratchet asserts against, and trades a
mechanism with no edge cases (`JSON.stringify`) for one with several (trailing
whitespace, lines that start indented, `#`). That is churn against a passing
test, not a fix.

## D5 — `parseTaskFile` is non-deterministic

Bare `matter()` with no `{ cache: false }`. Identical bytes yield
`yaml_unparseable` on the first call and `invalid_status` on every call after.
Reproduced three times.

This poisons the exclusions drawer built in Task 3.2: the same file shows the
user a different exclusion reason depending on call order. Two-token fix, but it
is a correctness bug in the shared parser and belongs in the same batch as D6.

### RESOLVED 2026-08-09 — confirmed, and it is worse than "a cache"

Reproduced on demand: three `parseTaskFile` calls over identical bytes returned
`yaml_unparseable | invalid_status | invalid_status`.

The mechanism, from `gray-matter/index.js:29-48`: the cache branch is taken only
`if (!options)`, and the file object is stored in `matter.cache` **before**
parsing. When the YAML engine throws, that half-built entry survives with an
empty `data`, so every later call returns `{}` instead of throwing.

Fixed by passing an options object at both call sites, which bypasses the cache
branch entirely. It is `{ language: 'yaml' }` — gray-matter's own default, so
parsing is unchanged — rather than the literal `{ cache: false }` the report
proposed: `cache` is honoured at runtime but absent from the shipped `.d.ts`, so
`{ cache: false }` does not compile under `strict`. The constant is
`MATTER_OPTIONS` in `task-frontmatter.ts`, documented at the definition.

Regression test in `task-frontmatter.spec.ts`: three parses of the same
malformed bytes must return the same reason all three times.

## D1 — `COMPLETION_ARTIFACTS` is a closed set, so finished work reads as unstarted

`COMPLETION_ARTIFACTS` is `DOC_FILES.filter(...)`, which can only ever match four
canonical filenames. `TASK_2026_161` carries `batch2-logic-review.md`, which is
not among them, so the doctor planned `status: backlog` for a task with three
shipped commits.

This directly contradicts the edge case this task already recorded — _"folders
carrying `test-report.md` or `_-review.md`adopt as`done`, not `backlog`"\*. The
rule was written; the implementation narrowed it to exact names.

Fix: match on a pattern (`*-review.md`, `*-report.md`, `test-report.md`) rather
than an allowlist.

### RESOLVED 2026-08-09

`COMPLETION_ARTIFACTS` / `PLANNING_ARTIFACTS` (closed name lists) are replaced by
`COMPLETION_ARTIFACT_PATTERNS` / `PLANNING_ARTIFACT_PATTERNS` plus
`isCompletionArtifact()` / `isPlanningArtifact()` in the shared contract, and
`planAdoption` now filters the folder's ACTUAL filenames through them.
`DOC_FILES` stays closed — it answers "which filenames may an agent create?",
which is a different question from "does this folder show finished work?", and
the CI ratchet still needs the closed form.

Tests: `TASK_2026_161`'s three real filenames adopt as `done` with all three
cited in `inferredFrom`, plus a control proving a folder with no evidence is
still `backlog` (a pattern matcher that called everything `done` would fail in
the opposite direction).

## D2/D3/D4 — the doctor discards evidence it already holds

- **D2**: `type` is hardcoded to `FEATURE`. `TASK_2026_164` and `TASK_2026_166`
  declare `CREATIVE` in frontmatter the doctor reads straight past. It proposed
  `FEATURE` for all 12 folders.
- **D3**: `inferTitle` proposed `"TASK_2026_170 — Context"`, and for
  `TASK_WORKSPACE_SCOPING_REVIEW` the bare folder name.
- **D4**: `AdoptAction` drops `description` even though both `adoptFolder` and
  `renderTaskMd` accept one.

### RESOLVED 2026-08-09

- **D2** — `planAdoption` calls a new `readDeclaredMetadata()`, which lifts
  `type` (and `title`) from a frontmatter block at the head of `context.md`, then
  falls back to a `**Type**: X` line in the first 40 lines, then to `FEATURE`.
  `status` is still NEVER lifted from prose: `164` and `166` both declare a stale
  `in_progress` that their own artifacts contradict — artifacts are evidence,
  prose is a claim. This is a hand-rolled scan, not a `parseTaskFile` call:
  `context.md` is agent-owned prose that happens to open with frontmatter, and
  running the carrier parser over it would report exclusions against a contract
  it was never required to satisfy.
- **D3** — `inferTitle` now rejects an uninformative title (the bare folder name,
  or the folder name + separator + one generic word: Context, Notes, Plan,
  Report, Overview, Readme, Tasks, Batches, Spec) and falls through
  `context.md` → the folder's other `*.md` in sorted order → the folder name as a
  last resort. All three shapes from the run are covered by tests, including
  `TASK_WORKSPACE_SCOPING_REVIEW` picking up the H1 of its only file.
- **D4** — `AdoptAction.description?: string`, forwarded in `executeAction`.
  The doctor never invents one; the field exists so a caller who edits the plan
  before `apply()` — the human-in-the-loop contract the service documents — is
  not silently dropped. Tested end to end with a description carrying a colon,
  braces and both quote characters.

## Suggested sequencing

D6 and D5 first — both live in the shared parse/render pair, both cause silent
misreporting, and together they are a small change under a single round-trip
test. D1 next, since it is the one that inverts a task's status. D2/D3/D4 are
cosmetic against the other five and can ride along.

**Followed as written.** Correction to the premise, recorded because it changed
the work: D6 and D5 were expected to be one change in "the shared parse/render
pair". D5 was in that pair; D6 turned out not to be in the code at all — see its
entry. The ordering still held, because the round-trip ratchet D6 asked for is
worth having either way.

## Added on top of D1–D6 — making this class of drift detectable

The stale batch markers that hid 6.1/6.2/6.3 are D1 one layer up: a file claimed
a state, the disk proved another, and nothing compared them. The doctor now
reports a `status_contradicted_by_artifacts` warning when a carrier declares
`backlog` while its folder holds a review or a test report.

Deliberately narrow. Only `backlog` + a completion artifact, which has no
innocent reading; `in_progress` next to a review is ordinary mid-flight state and
stays silent. A diagnostic that fires on normal work gets ignored, and an ignored
diagnostic is worse than none. Reported and never repaired, like every other
doctor warning. Both the positive case and the false-positive control are tested,
and the warning code is widened in lockstep in `TasksDoctorWarning`
(`rpc-tasks.types.ts`) so the two unions cannot drift.

## Re-run against the live tree after the fixes — 2026-08-09

The whole reason D1–D6 exist is that the doctor was shipped without ever being
pointed at real data. Shipping the _fixes_ the same way would repeat the mistake,
so `plan()` was run read-only against the real `.ptah/specs` tree with the
corrected code (an in-process harness over a real-fs `IFileSystemProvider`;
`plan()` touches nothing):

```
stampVersion=1
actions=12          — ALL renameLegacyBatches (tasks.md -> batches.md); ZERO adopts
warnings=1
  id_mismatch: TASK_2026_176
```

Four things that says, none of which a unit test could:

- **Zero adopt actions.** All 12 previously carrier-less folders are adopted and
  adoption is idempotent — a second run proposes nothing.
- **Zero `unparseable_carrier`.** Every carrier under `.ptah/specs` parses,
  `182`/`188`/`189` included, and now does so deterministically.
- **Zero `status_contradicted_by_artifacts`.** The new warning does not
  false-positive anywhere across the real tree, which is the property the
  narrow rule was chosen for.
- **The one warning is the one that should be there** — `TASK_2026_176`'s
  declared `id: TASK_2026_178`, still reported, still not normalised.

The 12 rename actions remain deliberately unexecuted (see `adoption-report.md`
§4). `LEGACY_BATCHES_FILE` is a permanent fallback, so nothing is broken by
leaving them; the list now also includes `TASK_2026_187`, which did not exist at
the time of the first run.

What was NOT built, and why: a checker that reads batch markers in `tasks.md` /
`batches.md` and compares them to git. Those markers are free-form prose with no
grammar, the mapping from a batch item to a commit is a judgement call, and a
high-false-positive checker over agent-authored markdown would be ignored within
a week. The carrier-vs-artifacts check above covers the same failure at the layer
that actually has a contract.

## Related

- `TASK_2026_194` — atomic task-ID allocation. Same failure class (a carrier that
  looks written and is not usable) reached by a different mechanism: a
  read-then-write race rather than a serialisation bug. The two fixes share no
  code and are deliberately separate tasks.
