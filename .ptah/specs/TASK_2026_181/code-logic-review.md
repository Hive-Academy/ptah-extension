# Code Logic Review — TASK_2026_181, Batch 1 (Phase 0: contract ratchet + nine coordinated sites)

## Review Summary

| Metric              | Value                      |
| ------------------- | -------------------------- |
| Overall Score       | 7/10                       |
| Assessment          | **APPROVED WITH CONCERNS** |
| Critical Issues     | 0                          |
| Serious Issues      | 1                          |
| Moderate Issues     | 2                          |
| Minor / Notes       | 2                          |
| Failure Modes Found | 4                          |

**Scope actually reviewed** (from `git status`/`git diff`, not from any inventory):

- `libs/shared/src/lib/types/task-spec.types.ts`, `task-spec.contract.ts`
- `libs/backend/task-specs/src/lib/task-frontmatter.ts`, `contract.guard.spec.ts`, `task-index.store.ts`, `task-index.store.spec.ts`
- `libs/backend/persistence-sqlite/.../migrations/0031_task_specs_metadata.ts` (new), `.spec.ts` (new), `index.ts`, `0028_...spec.ts`, `0030_...spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.schema.ts`
- `libs/shared/src/lib/types/rpc/rpc-tasks.types.ts`
- `libs/backend/vscode-lm-tools/.../tasks-namespace.builder.ts`, `.../tool-description.builder.ts`
- `libs/frontend/tasks-ui/src/lib/task-presentation.ts`

**Explicitly out of scope, confirmed unrelated to TASK_2026_181, not reviewed**: `apps/ptah-license-server/prisma/schema.prisma` + its new migration, `libs/api-contracts/community/**`, `libs/api/forum/**` (new lib), `tsconfig.base.json`'s single added path (`@ptah-api/forum`), and a stray untracked `tmp-ad5-census.cjs` census script at repo root. These are leftover working-tree state from other work; none of them touch task-specs/task-graph/RPC-tasks surfaces.

**Gates run and verified green**:

- `npx nx run-many -t test -p shared task-specs persistence-sqlite` → 515+269+80 passed, 0 failed (SQLite native-behavior suites skip on `NODE_MODULE_VERSION` mismatch exactly as documented, not silently passed).
- `npx nx run-many -t typecheck -p tasks-ui` (V-1 mitigation) → green.
- `npx nx run-many -t typecheck -p rpc-handlers vscode-lm-tools` (consumers of the touched schemas, not in the stated Batch 1 gate but touched by Task 1.10/1.11) → green.

## The 5 Paranoid Questions

### 1. How does this fail silently?

`tasks:create` (RPC) and `ptah_task_create` (MCP) both now _validate_ `labels`, `estimate`, `parent`, `duplicates`, `relatesTo` via their Zod schemas, but neither path actually plumbs the parsed values into `TaskWriterService.create()` — `CreateTaskInput` and `TaskSpecWriterLike.create`'s parameter type still only carry `title/type/description/dependsOn/executor` (Batch 4 work, not yet landed). A caller who submits `labels: ['licensing']` on create gets back `{ success: true, task }` with `task.labels === []` and **no error, no warning field**. See Serious Issue 1 below — this is verified by tracing the code, not inferred from the plan.

### 2. What user action causes unexpected behavior?

A hand-edited `task.md` with a label containing a newline, a label over 32 characters, or more than 12 labels parses as **fully valid** (`frontmatterValid: true`, zero `validationIssues`) today, because Task 1.5's manual lift only checks _shape_ (`z.array(z.string())`), not the per-entry limits implementation-plan §2.4 assigns to the read boundary. See Moderate Issue 1.

### 3. What data makes this produce wrong results?

A `parent` value of `" .. "` (surrounding whitespace around two dots) or `".. "` (trailing space) passes `isSinglePathSegment` today (it is not the exact string `".."`), yet Windows' `CreateFile`-family APIs silently strip trailing dots and spaces from a path component before resolving it — meaning such a value could resolve identically to `".."` once something (Batch 2's graph, Batch 4's writer) actually joins it onto a filesystem path. See Moderate Issue 2. Not exploitable _in this diff_ — nothing here calls `path.join` with `parent` yet — but the validator that is supposed to make it safe forever is landing now, in this batch, with the gap already in it.

### 4. What happens when dependencies fail?

`better-sqlite3`'s native binary cannot load under the Node version this sandbox runs (`NODE_MODULE_VERSION 143` vs `137`), so every SQLite-specific behavior test in `0031_task_specs_metadata.spec.ts` and the SQLite half of `task-index.store.spec.ts`'s parity block is **skipped**, not passed. I read the migration SQL and the store's insert/upsert/select code directly (§ "SQLite verification gap" below) rather than trusting green ticks that never ran.

### 5. What's missing that the requirements didn't mention?

Nothing new surfaced beyond what implementation-plan.md and batches.md already flagged as open questions (the three "developer decisions" the task brief asked me to adjudicate) — see below. I did not find an _additional_, previously-unflagged gap in the wiring itself; the nine coordinated sites are wired completely for what Batch 1 owns.

## Failure Mode Analysis

### Failure Mode 1: Create-time metadata is accepted, validated, and silently dropped

- **Trigger**: `tasks:create` or `ptah_task_create` called with any of `labels`/`estimate`/`parent`/`duplicates`/`relatesTo` set, before Batch 4 ships.
- **Symptoms**: `success: true`, a `TaskSpecSummary` is returned, but the five fields are all empty/`undefined` regardless of what was sent. If a value fails validation (e.g. `estimate: 'HUGE'`), the call is correctly _rejected_ — so valid input is silently ignored while invalid input is loudly rejected, an inconsistent signal to callers.
- **Impact**: A UI or agent that trusts the response's `success: true` to mean "everything I sent was applied" is wrong. No data is corrupted (the field just never existed), but it is misleading.
- **Current handling**: None — no comment, no `INVALID_PARAMS`, no partial-success flag.
- **Recommendation**: At minimum, add an explicit code comment on `TasksCreateParamsSchema`/`TaskCreateArgsSchema` stating these fields are accepted-but-inert until Batch 4, so nobody mistakes "compiles" for "wired." Track closure at Batch 4's gate explicitly (batches.md already assigns `CreateTaskInput`'s five fields to Task 4.3 — make sure Batch 4's review confirms `registerCreate`/`TaskSpecWriterLike.create` actually pass them through, not just that the writer _accepts_ them).

### Failure Mode 2: A hand-authored carrier with an oversized/newline-containing label parses as fully valid

- **Trigger**: A user or another tool writes `labels: ["a very long label that is more than thirty-two characters"]` directly into `task.md`.
- **Symptoms**: `parseTaskFile` returns `frontmatterValid: true`, no `invalid_labels` issue, the label is kept and rendered as-is on the board.
- **Impact**: Low on its own (the label still displays and works), but it means NFR-11's "present-but-malformed ⇒ warning" contract is not actually honored for this specific malformation class at the read boundary, contrary to implementation-plan.md §2.4's own table.
- **Current handling**: Shape-level check only (`STRING_ARRAY_SCHEMA.safeParse`); no per-entry length/newline/count check anywhere in `task-frontmatter.ts`.
- **Recommendation**: Either implement the three checks now (accepting a small, temporary duplication of `32`/`12` until Batch 4's `task-view.types.ts` exists, with a `// TODO(TASK_2026_181 Batch 4): dedupe against MAX_LABEL_LENGTH` comment), or — the more defensible choice given the plan's own single-source-of-truth goal for these limits — leave it deferred but **say so explicitly** in a comment next to the `labels` lift block, the same way every other intentional gap in this file (duplicate entries not de-duped, comments not surviving round-trip, `parent`'s deliberate non-clearing) is documented. Right now there is no comment at all, which reads as an oversight rather than a decision.

### Failure Mode 3: A padded `..` segment defeats path-segment validation on Windows

- **Trigger**: `parent: ".. "` or `parent: " .."` in frontmatter (or via a future write path that doesn't re-derive from a real folder listing).
- **Symptoms**: `isSinglePathSegment` returns `true` (the string isn't exactly `.` or `..`, and contains no `/`/`\`), so no `invalid_parent` issue is raised and the value is kept as a legitimate parent reference.
- **Impact**: None _yet_ — nothing in this diff joins `parent` onto a filesystem path. But `task-writer.service.ts` already demonstrates the house pattern (`path.join(root, '.ptah', 'specs', folderName)`) that Batch 2's graph module and Batch 4's writer will apply to `parent`-derived values. Windows' `CreateFile` strips trailing dots/spaces from path components before resolution, so a component that reads as `".. "` in the frontmatter could resolve as `".."` on disk — a directory traversal primitive smuggled through a validator whose entire stated purpose (per its own doc comment) is to prevent exactly that.
- **Current handling**: None; the check doesn't trim before comparing.
- **Recommendation**: Trim the value (or reject any segment whose trimmed form is empty/`.`/`..`) before the exact-match checks in `isSinglePathSegment`. Cheap, no behavior change for any currently-passing test, and closes the gap before Batch 2/4 give `parent` an actual filesystem consumer.

### Failure Mode 4: SQLite-specific behavior for migration 0031 is asserted only by inspection, not execution, in this environment

- **Trigger**: Running the test suite on a machine (like this one) where `better-sqlite3`'s prebuilt binary doesn't match the running Node ABI.
- **Symptoms**: `0031_task_specs_metadata.spec.ts`'s five `maybe(...)` behavior tests (column types/nullability, pre-existing-row survival, index creation, full-column insert, re-run-is-a-no-op) and the SQLite half of `task-index.store.spec.ts`'s parity block report as **skipped**, and Jest's overall summary (`80 passed`, `269 passed`, etc.) does not distinguish "skipped because irrelevant" from "skipped because broken environment" without reading the console output.
- **Impact**: If the SQL in `0031_task_specs_metadata.ts` had a syntax error, a wrong `NOT NULL`/default pairing, or an off-by-one in column ordering vs. `insertParams`, none of that would be caught by this run.
- **Current handling**: The registry-entry tests (static-SQL check, `claim` non-repurposing check, version/ordering checks) _do_ run unconditionally and pass. The behavior tests are correctly gated on a real native-module probe rather than a stub, so they are not giving a false pass — they are giving no signal, honestly.
- **What I verified by direct inspection instead**: `0031`'s five `ALTER TABLE ... ADD COLUMN` statements match SQLite's rule that `NOT NULL` requires a literal default (`labels`/`duplicates`/`relates_to` get `DEFAULT '[]'`; `estimate`/`parent` are nullable with no default) — this is syntactically valid SQLite DDL. The `CREATE INDEX IF NOT EXISTS` is idempotent by construction. `insertSql`'s 21-column list and its 21 `?` placeholders, and `insertParams`'s 21-item array, are in matching order column-by-column (verified by manual count, not just "looks right") — a mismatch here would silently write `estimate`'s value into the `parent` column, which is exactly the class of bug that only reproduces on the ABI-correct machine QA owns per the plan's own note. I found no ordering mismatch.

## Critical Issues

None found.

## Serious Issues

### Issue 1: `tasks:create` / `ptah_task_create` validate five metadata fields they cannot yet persist

- **File**: `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts:303-309` (`registerCreate`); `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/tasks-namespace.builder.ts:270` (`context.writer.create(context.root, parsed.data)`); `libs/backend/task-specs/src/lib/task-writer.service.ts:24-30,224-235` (`CreateTaskInput`, `renderTaskMd` call).
- **Scenario**: Any caller of either surface passes one or more of the five new fields at task-creation time.
- **Impact**: Silent no-op on those fields; the response looks fully successful.
- **Evidence**: `TasksCreateParamsSchema` (this diff) and `TaskCreateArgsSchema` (this diff) both gained `labels/estimate/parent/duplicates/relatesTo`, but `registerCreate` still builds its `writer.create()` call from an explicit five-field literal (`title, type, description, dependsOn, executor`) unchanged by this diff, and `renderTaskMd({...})` inside `TaskWriterService.create` is likewise called with only those same five fields. `CreateTaskInput` (unchanged in this diff) has no metadata fields.
- **Fix**: This is a known, plan-sanctioned deferral (batches.md Task 1.10: "No new method in this batch"; `CreateTaskInput` is explicitly Task 4.3). Not a reason to reject Batch 1. It **is** a reason to (a) add a short "accepted, not yet wired — see Batch 4" comment at both schema sites so the gap is discoverable by reading the code, and (b) make it a named, checked line item in Batch 4's own acceptance gate (batches.md's Batch 4 verification list does not currently call this out explicitly — it should, given this is the exact "silent data loss" failure mode R1 exists to prevent).

## Moderate Issues

### Issue 1: Read-boundary label limits from plan §2.4 are not implemented in Task 1.5

- **File**: `libs/backend/task-specs/src/lib/task-frontmatter.ts:378-390` (labels lift block).
- **Scenario**: A hand-authored or externally-written carrier has a label with a newline, a label over 32 characters, or more than 12 labels.
- **Impact**: `frontmatterValid: true`, no `invalid_labels` issue is raised, contrary to implementation-plan.md §2.4's table ("per-entry: newline / > 32 chars / > 12 entries ⇒ `invalid_labels`... the READ boundary warns").
- **Evidence**: The labels lift only runs `STRING_ARRAY_SCHEMA.safeParse(rawLabels)` — a shape check — with no follow-up per-entry validation, and batches.md's own Task 1.5 description omits the per-entry column when restating plan §2.4 (it lists only the shape-failure codes).
- **Fix / judgment**: I do not think this should block Batch 1. Implementing it now would mean hand-coding the `32`/`12` limits into `task-frontmatter.ts` ahead of Batch 4's canonical `MAX_LABEL_LENGTH`/`MAX_LABELS_PER_TASK` in `libs/shared/.../task-view.types.ts`, risking exactly the two-source-of-truth drift the plan's §5.1 was written to avoid. The safer fix is cheap and should land now regardless: a one-line comment on the labels lift block stating this is deliberately deferred to Batch 4 and why, so a future reader doesn't mistake it for an oversight (every other intentional gap in this same file — duplicate relation entries not de-duped, `parent` not cleared on cycle/dangling — already gets this treatment; labels' limits do not).

### Issue 2: `isSinglePathSegment` does not trim before its exact-match checks

- **File**: `libs/backend/task-specs/src/lib/task-frontmatter.ts:127-135`.
- **Scenario**: `parent: ".. "` or `parent: " .."` (or similar padding) in frontmatter.
- **Impact**: Passes validation as a "safe" single path segment today. Not exploitable within this diff (nothing joins `parent` onto an FS path yet), but the function's own doc comment states its purpose is exactly to prevent a later path-join from being steered outside the spec tree — and Windows silently strips trailing dots/spaces from path components at resolution time, so a padded `".. "` can behave like `".."` once such a join exists (Batch 2's graph, Batch 4's writer).
- **Fix**: `value.trim()` before the `.`/`..` comparisons (and consider rejecting a value that differs from its trimmed form outright, since a folder name with leading/trailing whitespace is not a realistic legitimate parent reference either). Recommend closing this before Batch 2 lands, since Batch 2 is exactly where `parent` gets its first real graph consumer.

## Data Flow Analysis

```
task.md (labels/estimate/parent/duplicates/relates_to as YAML)
   │
   ▼
task-frontmatter.ts: TaskFrontmatterSchema (documentation-only, not a gate)
   │
   ▼
task-frontmatter.ts: manual lift (parseTaskFile)          ◄── Issue: no per-entry label limits (Moderate #1)
   │  labels:[] / estimate?/ parent? / duplicates:[] / relatesTo:[]
   │  + validationIssues: invalid_estimate | invalid_labels | invalid_parent
   │    | dangling_parent | parent_cycle | invalid_relation | dangling_relation
   ▼
TaskSpecSummary (libs/shared/task-spec.types.ts)            ◄── verified: all 5 fields present, typed correctly
   │
   ├──► SqliteTaskIndexStore: insertSql / insertParams / rowToSummary / cloneSummary
   │      all 5 columns present, ON CONFLICT list complete, cloneSummary copies
   │      the 3 new arrays (verified column-order match, 21 cols ↔ 21 params)  ✓
   │
   ├──► InMemoryTaskIndexStore: cloneSummary (same function, shared)            ✓
   │
   ├──► rpc-tasks.types.ts / tasks-rpc.schema.ts: TasksCreateParamsSchema       ▲ validated
   │      gains all 5 fields, taskIdRef rejects '/', '\\', '..'                │ Issue:
   │                                                                            │ never reaches
   ├──► tasks-namespace.builder.ts / tool-description.builder.ts: same 5       │ writer.create()
   │      fields on TaskCreateArgsSchema + MCP JSON-Schema prose               ▼ (Serious #1)
   │
   └──► task-presentation.ts: TASK_ESTIMATE_LABELS (5/5 keys),
          TASK_VALIDATION_CODE_LABELS (14/14 keys incl. all 8 new codes)       ✓ typecheck-enforced
```

### Gap points identified

1. `TasksCreateParamsSchema`/`TaskCreateArgsSchema` → `TaskWriterService.create()`: values validated, then dropped (Serious #1). Not a Batch 1 defect per se — Batch 1 correctly stops at "gain the five fields... no new method" — but the gap is live in the working tree today and undocumented in code.
2. Read-boundary label lift → no per-entry limit enforcement (Moderate #1).
3. `parent`'s path-segment guard → doesn't trim (Moderate #2), latent until a real path-join consumer exists.

## Requirements Fulfillment

| Requirement                                                                              | Status       | Concern                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-5: `renderFrontmatterBlock`/`yamlScalar`/`isPlainSafeScalar` zero functional diff     | **COMPLETE** | Verified via `git diff` — only `RenderTaskMdInput`/`renderTaskMd` changed; the three named functions are byte-identical.                                                                                                                          |
| BR-1: `rpc-handler.ts` untouched, `'tasks:'` prefix pre-existing                         | **COMPLETE** | File not in the diff at all.                                                                                                                                                                                                                      |
| BR-6: no backfill/normalization; `adoptFolder`/`registry-generator.service.ts` untouched | **COMPLETE** | Neither file appears in the diff. Migration 0031 confirmed forward-only (declared defaults only, no `UPDATE`).                                                                                                                                    |
| Migration SQL static, no interpolation, `claim` not repurposed                           | **COMPLETE** | Verified by reading `0031_task_specs_metadata.ts` directly and by its own registry-entry test (`not.toContain('${')`, `not.toContain('claim')`), which runs unconditionally.                                                                      |
| BR-7: no filename literal / forbidden path strings, `TASK_2026_*` fixtures only          | **COMPLETE** | Grepped the full diff for `task-tracking/`, `.ptah/tasks/`, `specs/TASK_2025_`, `blocks:` — zero hits. All new fixture ids are `TASK_2026_*`.                                                                                                     |
| NFR-11: malformed ⇒ warning + safe default, never exclusion                              | **PARTIAL**  | True for shape failures (labels/estimate/parent/duplicates/relates_to all degrade to a safe default with an issue). **Not** true for labels' per-entry limits, which are silently accepted as valid (Moderate #1).                                |
| Empty array ⇒ key removed for labels/duplicates/relates_to; `depends_on` still `[]`      | **COMPLETE** | Verified in `renderTaskMd` diff and asserted by the golden-string test + the `EMPTY` sub-test of every `ARRAY_FIELDS` case.                                                                                                                       |
| `TASK_ESTIMATES` tuple order is sort order, no numeric mapping                           | **COMPLETE** | Confirmed — no numeric estimate mapping exists anywhere in the diff; `TASK_ESTIMATE_LABELS` is a `Record<TaskEstimate,string>`, not a score.                                                                                                      |
| No `blocks:` key anywhere                                                                | **COMPLETE** | Not present; `dependsOn` is the only authored relation touched in this batch.                                                                                                                                                                     |
| Task 1.12 constant-maps-only                                                             | **COMPLETE** | `task-presentation.ts` diff adds only `TASK_ESTIMATE_LABELS`, `TaskValidationCode`, `TASK_VALIDATION_CODE_LABELS`, and two small pure lookup helpers (`isTaskValidationCode`, `taskValidationCodeLabel`) — no component/template/service touched. |
| TS 5.9 strict, `catch (error: unknown)`, Zod 4, no `any`/`@ts-ignore`                    | **COMPLETE** | Grepped the diff for `: any`, `catch (error)` (unnarrowed), `@ts-ignore` — zero hits.                                                                                                                                                             |

## Three developer decisions — my adjudication

1. **`parent` preserved (not cleared) on `parent_cycle`/`dangling_parent`, cleared only on `invalid_parent`.** **Correct as implemented**, and I agree with the rationale: `parent_cycle`/`dangling_parent` are about _whether the declared value should be honored_, which is exactly `buildTaskGraph`'s job in Batch 2 — clearing at parse time would destroy the only evidence of what the author declared. The `invalid_parent` case is structurally different (the value literally cannot be a folder name), so clearing it is correct. **However**, the path-segment guard that is supposed to make "preserve it, it's safe" true forever has the trim gap described in Moderate Issue 2. My answer to the explicit question: the guard catches `/`, `\`, exact `.`/`..`, which is sufficient against every currently-existing consumer (there are none yet), but is **not** sufficient against a future consumer that resolves rather than joins, or against Windows' trailing-dot/space normalization. Recommend fixing before Batch 2.

2. **Create path accepts-and-drops.** Verified real by code trace (Serious Issue 1). My judgment: **acceptable to defer to Batch 4 as a matter of sequencing** (Batch 1's own stated task list explicitly says "no new method," and `CreateTaskInput` is explicitly scoped to Task 4.3) — but it should not be a _silent_ deferral. It needs (a) a code comment at both schema sites now, and (b) an explicit assertion in Batch 4's acceptance gate that a `tasks:create`/`ptah_task_create` call carrying metadata actually produces a carrier with that metadata, not just that the writer's types compile. Left as-is with no comment, this is exactly the kind of gap that survives into a shipped release because nothing describes it as temporary.

3. **Per-entry label limits deferred, not duplicated into `task-frontmatter.ts`.** **Defensible**, not a clear mistake: duplicating `32`/`12` now would create two sources of truth ahead of Batch 4's canonical constants, which the plan explicitly wants to avoid (§5.1: "enforced here only, so they hold identically on the RPC, MCP and CLI paths"). The read boundary is measurably under-defended in the interim (Moderate Issue 1) — a fact worth being honest about rather than waving away — but the fix that actually matches the codebase's own stated principles is a documentation comment now and enforcement in Batch 4, not a duplicated constant in Batch 1.

## Edge Case Analysis

| Edge Case                                                                                      | Handled             | How                                                                                                                                | Concern                                                                                                                 |
| ---------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Absent metadata (no keys)                                                                      | YES                 | Defaults: `labels/duplicates/relatesTo → []`, `estimate/parent → undefined`                                                        | None — golden-string test confirms byte-identity.                                                                       |
| Empty array explicitly passed to `renderTaskMd`                                                | YES                 | Key omitted entirely (not `field: []`)                                                                                             | Verified for labels/duplicates/relatesTo; `depends_on` correctly still emits `[]` (unchanged behavior, not "fixed").    |
| Hostile YAML scalars (`needs:design`, `#urgent`, `2fa`, `-wip`, `no`, trailing space, unicode) | YES                 | Existing `yamlScalar`/`isPlainSafeScalar` (zero-diff, per BR-5) already double-quotes all of these; round-trip asserted byte-exact | None found — traced each case against the actual regex/reserved-word logic, all fall into the quoted branch as claimed. |
| Self-parent (`parent === folderName`)                                                          | YES                 | `parent_cycle` issue, value **kept**                                                                                               | None — matches stated design and is unit-tested.                                                                        |
| Parent naming a nonexistent folder, with `knownFolders` supplied                               | YES                 | `dangling_parent`, value kept                                                                                                      | None.                                                                                                                   |
| Parent check with no `knownFolders` (single-file reparse)                                      | YES                 | Dangling checks skipped entirely (pre-existing documented contract)                                                                | None — explicitly tested.                                                                                               |
| `parent` with padding around `..` (`" .. "`)                                                   | **NO**              | `isSinglePathSegment` doesn't trim                                                                                                 | Moderate Issue 2 — latent, not yet reachable by any path-join in this diff.                                             |
| Duplicate entries within one relation array                                                    | YES                 | Preserved verbatim, not de-duped (FR-B4.8)                                                                                         | None — explicitly tested, matches "de-dup is a display concern" design.                                                 |
| Label with newline / >32 chars / >12 entries                                                   | **NO**              | No per-entry check exists                                                                                                          | Moderate Issue 1.                                                                                                       |
| `tasks:create` / `ptah_task_create` with metadata fields                                       | **NO (silent)**     | Schema validates, writer drops                                                                                                     | Serious Issue 1.                                                                                                        |
| Every status × type pair with all five fields present                                          | YES                 | `contract.guard.spec.ts`'s 48-pair `it.each` asserts zero validation issues and correct field values                               | None.                                                                                                                   |
| SQLite column/param ordering (21 columns)                                                      | YES (by inspection) | Manually verified `insertSql` column order matches `insertParams` array order 1:1                                                  | Behavior tests that would catch a real DB rejecting this are skipped in this environment (Failure Mode 4).              |

## Integration Risk Assessment

| Integration                                                                          | Failure Probability                                        | Impact                                                    | Mitigation                                                                                                                                                    |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontmatter parse → `TaskSpecSummary`                                                | LOW                                                        | N/A                                                       | Manual lift is thorough and tested across 48 status×type pairs plus hostile-label matrix.                                                                     |
| `TaskSpecSummary` → `SqliteTaskIndexStore`                                           | LOW (verified by inspection; UNVERIFIED by execution here) | A column-order mismatch would silently cross-write fields | Registry-entry tests run unconditionally; behavior tests skipped in this Node/ABI environment — QA-owned per the plan's own note, correctly not "fixed" here. |
| `TasksCreateParamsSchema`/`TaskCreateArgsSchema` → `TaskWriterService.create`        | **CERTAIN** (by design, until Batch 4)                     | Metadata silently discarded on create                     | Serious Issue 1 — needs a comment now, a closing assertion in Batch 4.                                                                                        |
| `task-presentation.ts` `TASK_VALIDATION_CODE_LABELS` ↔ `TaskValidationIssue['code']` | LOW                                                        | A code added without a label fails `tasks-ui` typecheck   | This is the intended R1 mechanism, confirmed working (typecheck gate passes with all 14 codes present).                                                       |

## Verdict

**Recommendation**: **APPROVE WITH CONCERNS** — no binding rule is violated, every stated and superset gate I could run is green, the nine coordinated sites are completely and correctly wired for what Batch 1 owns, and the contract ratchet (Task 1.1) is a genuine, well-reasoned test suite rather than a test that would pass with either side wrong (the golden string is hand-authored, not derived from the emitter).

**Confidence**: HIGH on everything I could execute or trace by hand (frontmatter parse, store wiring, RPC/MCP schema wiring, contract ratchet). MEDIUM on SQLite runtime behavior specifically, because it is unverified by execution in this environment — I inspected the SQL and the store's parameter ordering directly and found no defect, but that is inspection, not proof.

**Top risk**: Serious Issue 1 (create-path accept-and-drop) is the one item in this batch that resembles R1's own stated fear — a validated field that goes nowhere — even though it is a plan-sanctioned, temporally-scoped gap rather than an oversight. It should not block this batch, but it must not be allowed to become invisible: add the two comments now, and make Batch 4's gate check for it explicitly rather than trusting that wiring `CreateTaskInput` implies wiring `registerCreate`/the MCP create handler.

## What Robust Implementation Would Include

- A code comment at every "accepted but not yet wired" boundary (the create-path schemas) stating which batch closes it — this repo's own style already does this everywhere else in the diff (`isSinglePathSegment`, the labels/duplicates dedup note, the `parent` preservation rationale); the create-path gap is the one place that convention was dropped.
- Per-entry label validation at the read boundary now, even if it means a temporary, clearly-commented duplication of the `32`/`12` limits ahead of Batch 4's canonical constants — or, short of that, at least a comment marking the deferral so it reads as a decision rather than a miss.
- `isSinglePathSegment` trimming its input before the exact-match checks, closing the Windows trailing-dot/space normalization gap before Batch 2 gives `parent` its first real graph/path consumer.
- A CI lane that can actually execute the `better-sqlite3`-gated behavior tests (matching Node's ABI to the prebuilt binary), so migration 0031's column ordering and nullability are asserted by execution rather than by a reviewer's manual count.
