# Code Logic Review — TASK_2026_181, Batch 2 (Phase 2: derived graph + cross-file validation)

> **RE-REVIEW (round 2) — see [§18](#18-re-review-round-2--the-ref-fix) for the fix verification.
> Final verdict: APPROVED WITH CONCERNS.** The round-1 verdict and findings below are left intact as the
> record of what was found and why; do not read §1's "REJECTED" as the current status.

## Scope actually reviewed

Established via `git status` / `git diff`, not the batch inventory. Uncommitted changes under
`libs/shared` and `libs/backend/task-specs` only, per instructions:

- `libs/shared/src/index.ts` (M) — export `task-graph`
- `libs/shared/src/lib/types/rpc/rpc-tasks.types.ts` (M) — `TasksDoctorWarning['code']` widened
- `libs/shared/src/lib/types/task-graph.ts` (new, 517 lines)
- `libs/backend/task-specs/src/lib/task-scanner.service.ts` (M) — `mergeCrossFileIssues`
- `libs/backend/task-specs/src/lib/task-scanner.service.spec.ts` (M) — nested-carrier + cross-file tests
- `libs/backend/task-specs/src/lib/task-doctor.service.ts` (M) — `crossFileWarnings`, `inspectCarrier` reshape
- `libs/backend/task-specs/src/lib/task-doctor.service.spec.ts` (M) — cross-file doctor test
- `libs/backend/task-specs/src/lib/task-index.store.spec.ts` (M) — store-parity graph test (skip-gated)
- `libs/backend/task-specs/src/lib/task-graph.spec.ts` (new, 29 tests)

`task-frontmatter.ts` was **not** touched in this diff (it is Batch-1, already committed) — read for
context only, to verify the scanner's `knownFolders` semantics that the de-duplication logic depends on.
Everything under `apps/ptah-license-server/prisma/**`, `libs/api-contracts/community/**`,
`libs/api/forum/**`, `libs/api/audit/**`, `tsconfig.base.json` was ignored as instructed.

## Verdict: REJECTED

One confirmed, narrow-but-real correctness defect in the scanner's cross-file merge (issue #1 below).
Everything else checked — termination proof, §4.1 precedence table, inverse-relation construction,
determinism, `labelKey`/FNV-1a/`labelColorIndex`, structural read-only, BR-6/BR-7/G2/G3 compliance, the
doctor's read-only emission — verified correct by direct trace and is not in question. The fix is small
and localized; nothing else in this batch needs to change.

---

## 1. BLOCKING — `mergeCrossFileIssues`'s `(code, field)` de-dup key swallows a genuinely new finding

**File**: `libs/backend/task-specs/src/lib/task-scanner.service.ts:26-38` (`issueKey`) and `:127-156`
(`mergeCrossFileIssues`).

**The claim under test.** The review brief (developer decision #2) requires: "a self-parent must be
reported once, not twice, and no genuine second finding may be swallowed by an over-broad dedupe key."
I verified the self-parent case is handled correctly (see §2 below). The second half of the claim does
not hold.

**Root cause.** `knownFolders` (passed to `parseTaskFile` by the scanner, `task-scanner.service.ts:98`,
`new Set(folderNames)`) is built from the **raw directory listing** — every non-dot directory under
`.ptah/specs`, whether or not its carrier parses. `deriveCrossFileIssues`'s `byId`
(`task-graph.ts:466-469`) is built from the **scanner's `tasks` array**, i.e. only the carriers that
successfully parsed into an included task. These two universes differ whenever a folder exists on disk
but its carrier is excluded (missing `title`/`status`, unreadable, etc.) — call this folder `Y`. The
per-file parser's `dangling_relation` check (`task-frontmatter.ts:202`,
`knownFolders.has(entry)`) sees `Y` as "known" (it's a real folder name) and stays silent about it. The
cross-file pass sees `Y` as absent from `byId` and correctly flags it as `dangling_relation` — this gap
is explicitly why `deriveCrossFileIssues` exists per its own docstring
(`task-graph.ts:440-461`: "a caller WITHOUT that view ... has been told nothing and must get the complete
picture"). But the scanner **is** a caller with that view for the raw-existence half of the check, and
the merge treats "I already know about this field+code" as sufficient reason to drop _everything_ the
cross-file pass says about that field+code — including the part it doesn't already know.

**Concrete failure scenario.**

1. `TASK_2026_X` declares `relates_to: [TASK_2026_Y, TASK_2026_Z]`.
2. `TASK_2026_Y` exists as a folder on disk but its carrier is excluded (e.g. missing `title`) — it
   never reaches `tasks` / `byId`.
3. `TASK_2026_Z` does not exist as a folder at all.
4. At parse time (`task-frontmatter.ts:191-208`, called with the full `knownFolders`): `Y` passes the
   `knownFolders.has(entry)` check (silent), `Z` fails it → one issue pushed:
   `{ field: 'relates_to', code: 'dangling_relation', message: "...Z..." }`.
5. `deriveCrossFileIssues(tasks)` independently walks the same array against `byId` (parsed tasks only)
   and correctly produces **two** issues for `TASK_2026_X`: one for `Y` (not in `byId` — genuinely new
   information the parser never had) and one for `Z` (duplicate of step 4).
6. `mergeCrossFileIssues` builds `alreadyReported = new Set(task.validationIssues.map(issueKey))`. Because
   `Z`'s parser-level issue already produced the key `"dangling_relation relates_to"`, **both** derived
   issues — `Y`'s and `Z`'s — key-match and are filtered out of `added` (`task-scanner.service.ts:150`).
7. Net result: `TASK_2026_X.validationIssues` ends up with only the `Z` finding (from the parser).
   The `Y` finding — a `relates_to` entry that points at a folder whose carrier is broken — is silently
   dropped and never reaches `tasks:list`, the persisted index row, or the board. It is unrecoverable:
   per `implementation-plan.md` §4.4, `tasks-ui` does **not** independently call `deriveCrossFileIssues`;
   only the scanner does, so there is no second chance to surface it.

Note the asymmetry with `parent`: this cannot happen for the `parent` field, because a task has at most
one `parent` value, so there is only ever one derived issue to filter per task — collapsing to a single
key is harmless there. The bug is specific to the two array-valued relation fields (`duplicates`,
`relates_to`), where multiple entries under the same field can trigger the same `code`, and the key
carries no information about _which_ entry.

**Impact.** Not data loss (the `relates_to` array itself is untouched — FR-B4.8 holds) and not a write-
path issue. It is a silently-dropped diagnostic: the user is told about `Z` but not `Y`, and
`task.frontmatterValid` still correctly flips to `false` (so the task doesn't read as "clean"), but the
specific, actionable warning about the broken reference to `Y` never surfaces. This is exactly the
"silent failure that misleads the user about the full scope of a problem" class of bug, and it sits in
the module the review brief calls out as the batch's core scope.

**Recommended fix.** The key needs to distinguish _which_ entry triggered the finding, not just which
field and code. Cleanest options, in order of preference:

1. Add an optional structured field to `TaskValidationIssue` (e.g. `ref?: string`) carrying the offending
   id/entry for the codes that name one (`dangling_relation`, `dangling_parent`), and dedupe on
   `(code, field, ref)` instead of `(code, field)`. This also removes the current reliance on `message`
   wording staying out of the key (already called out as deliberate in the code comment) while fixing the
   real gap.
2. Alternatively, close the semantic gap at the source: build the scanner's `knownFolders` from the same
   "successfully parsed" universe `deriveCrossFileIssues` uses (i.e. pass the set of _included_ task ids,
   not every raw folder name) — but this changes what the per-file parser can independently report and
   has knock-on effects on `dangling_depends_on`'s existing contract, so option 1 is lower-risk.

This is the only blocking issue found. The rest of the batch is solid enough that, once this is fixed with
a targeted change (no redesign needed), re-review should be quick.

---

## 2. Termination — verified correct, no depth cap, matches the documented proof

Traced `analyzeParentage`'s pass 1 (`task-graph.ts:197-237`) by hand against the required cases:

- **Self-parent** (`parent === id`): `walk=[id]`, `cur` becomes `id` again, loop exits because
  `colour.get(id) === GREY` (not WHITE); `cur === GREY` check fires; `entry = walk.indexOf(id) = 0`;
  `id` marked `onCycle`. Pass 2 correctly reports `parent_cycle` with the "this task itself" wording.
- **2-cycle / 3-cycle / 200-cycle**: confirmed by trace that the inner `while` can enter a WHITE node at
  most once ever (colours only move WHITE→GREY→BLACK, never backward), so total inner-loop iterations
  across the _entire_ outer loop are bounded by `N`. No recursion, explicit `walk: string[]` array, no
  stack growth across outer iterations (each outer iteration's `walk` is capped by the nodes it
  personally discovers, and every node is discoverable by exactly one outer iteration since later
  iterations skip non-WHITE nodes).
- **Long chain feeding a cycle (400→401→402→403→401)**: hand-simulated the algorithm exactly as coded.
  400 is visited first (sorted order), walks through 401→402→403→401, finds 401 GREY on the second visit,
  marks `[401,402,403]` as `onCycle` (starting at `walk.indexOf(401) = 1`, correctly excluding 400 at
  index 0). Pass 2 then correctly gives 400 `parent_depth_exceeded` (its declared parent 401 itself
  declares a parent, 402, which resolves) and 401/402/403 all `parent_cycle`. This exactly matches the
  `task-graph.spec.ts:170-196` fixture and its assertions — confirmed by independent trace, not by
  trusting the test.
- **No depth cap exists anywhere in the diff.** Confirmed by reading the full file; the docstring
  explicitly argues against adding one, and none was added.

**Verdict on termination: correct by construction**, matching the monotonic-colour argument the code
documents.

## 3. §4.1 precedence — verified exactly, including the documented interaction

`analyzeParentage` pass 2 (`task-graph.ts:239-285`) implements the precedence table in the documented
order: cycle → `parent_cycle`; not in `byId` → `dangling_parent`; grandparent resolves in `byId` →
`parent_depth_exceeded` **attached to the child** (not the ancestor — confirmed the `issues.set(id, ...)`
call uses the loop's own `id`, never `parent` or `grandparent`). Both tasks stay on the board in every
row — `effectiveParent` is simply not populated for the rejected id; nothing removes the task from
`byId`/`tasks`.

**The specific interaction called out in the brief** — "a child whose parent's own claim was rejected as
dangling should keep an ordinary honoured one-level claim" — is handled correctly at `task-graph.ts:270-
284`: the `parent_depth_exceeded` check tests `byId.has(grandparent)`, i.e. it only fires when the
grandparent _itself resolves_. If the parent's own declared parent is dangling, `byId.has(grandparent)`
is `false`, the check falls through, and the child's one-level claim is honoured. Verified by trace and
confirmed by the fixture at `task-graph.spec.ts:263-274` and the doctor test's `TASK_2026_143` case
(`task-doctor.service.spec.ts` — 143's own claim on the dangling-rooted 142 is honoured, `byId.has('
TASK_2026_143')` absent from warnings).

Note (by design, not a defect): `parent_depth_exceeded`'s grandparent check reads the **raw** declared
`parent` field of the parent task, not its `effectiveParent`. If the parent is itself part of an
unrelated cycle, a child pointing at it can still be flagged `parent_depth_exceeded` based on the
cycle-member's raw (invalid) declared parent. This matches the pseudocode in `implementation-plan.md`
§4.1 verbatim (`declaredParent(cur)`, not the resolved chain), so it is not a deviation from the approved
plan — flagged here only so it's on record as a conscious design choice, not an oversight.

## 4. Inverses — one pass, no traversal, verified

`buildTaskGraph`'s inverse-relation block (`task-graph.ts:357-405`) is a single forward pass with no
recursion and no fixpoint loop, so no cycle can arise regardless of the input (confirmed: `blocks`,
`duplicatedBy`, `related` are all built by iterating each task's own arrays once). Self-edges are filtered
(`other === id` / `dependency === id` / `duplicate === id` checks) before insertion. `addUnique`
de-duplicates every bucket on insert (`task-graph.ts:294-306`). Grepped the whole diff for a `blocks:`
frontmatter key or a second authored side for `related` — none exists; `related` is built from
`relatesTo` only, exactly matching D3.

## 5. Determinism — verified, not a whole-list sort

Confirmed `related`'s ordering is genuinely "authored-first (per task, in its own array order), then
derived (id-sorted by authoring task)" — not a final sort pass. The first loop
(`task-graph.ts:371-378`) walks `sortedIds` and, for each task, appends _that task's own_ `relatesTo`
entries in their original array order into `related[id]` — this is the authored half. The second loop
(`task-graph.ts:380-405`) walks `sortedIds` again and appends `id` into `related[other]` for every
`other` it names — since the outer loop is `sortedIds`, the derived entries land in id-sorted order of
the _authoring_ task. Verified against the `task-graph.spec.ts:343-363` fixture by trace, not just by
running it. All iteration is over `Map`/`Set` insertion order and `[...byId.keys()].sort()` seeds — no
filesystem-order dependency anywhere.

## 6. `labelKey` / `labelColorIndex` — verified

`labelKey = raw.trim().toLowerCase()` used uniformly for matching (`related`/`knownLabels` construction
is untouched by label logic — correctly scoped), the union (`labelsByKey` keyed on `labelKey`,
first-seen wins per `task-graph.ts:408-420`), and the colour hash (`labelColorIndex` hashes
`labelKey(raw)`, `task-graph.ts:145-148`) — so `Licensing`/`licensing ` collapse to one entry with one
colour, confirmed by `task-graph.spec.ts:429-433` and by trace.

`fnv1a32` (`task-graph.ts:125-132`) is textbook FNV-1a: offset basis `0x811c9dc5`, XOR-then-multiply by
prime `0x01000193`, `Math.imul` for correct 32-bit overflow (a plain `*` would silently stop being
FNV-1a past 2^53 exactly as the comment states), `>>> 0` to force unsigned — cannot return negative or
`NaN`. `labelColorIndex` separately guards `paletteSize` (`!Number.isInteger || <= 0` → `0`), so a
zero/negative/non-integer palette size cannot propagate `NaN`/negative into a class binding. Verified
against the `labelColorIndex` test block (`task-graph.spec.ts:451-455`) and confirmed correct by
independent reasoning, not just by the test existing.

## 7. Structural read-only — verified

`task-graph.ts` imports only `type { TaskSpecSummary, TaskValidationIssue } from './task-spec.types'` —
no `fs`, no `vscode`, no platform port, nothing that could reach a write. Both `buildTaskGraph` and
`deriveCrossFileIssues` take plain arrays/summaries in and return plain `Map`/array data out; nothing
mutates the input (confirmed no `task.x = ...` anywhere in the module, and the input arrays are only
read via `.get`/iteration). The `deriveCrossFileIssues` spec explicitly asserts input immutability via a
`JSON.stringify` before/after comparison (`task-graph.spec.ts:536-547`) — a real assertion, not a
tautology, since `buildTaskGraph`/`deriveCrossFileIssues` are called on the same array in between.

## 8. G3 — no fourth path-segment guard, confirmed

`task-graph.ts`'s module docstring (`:23-30`) explicitly states `parent` is treated as an opaque key and
is not re-validated as a path segment. Confirmed by code: no string manipulation on `parent` beyond
equality/membership tests (`===`, `byId.has(...)`) — no `.includes('/')`, no path joins, nothing
resembling `isSinglePathSegment`. G3 holds.

## 9. `parent` preserved on rejection — confirmed, not re-cleared

Neither `buildTaskGraph` nor `deriveCrossFileIssues` writes back to `task.parent`; both only read it via
`byId.get(...).parent`/`declaredParent(...)`. The `TaskSpecSummary` objects passed in are never mutated
by this module (see §7). Batch 1's decision to keep `parent` verbatim on `parent_cycle`/`dangling_parent`
is untouched here.

## 10. No new `DoctorAction` kind — confirmed

`export type DoctorAction = AdoptAction | RenameBatchesAction;` in `task-doctor.service.ts` is
byte-identical before/after this diff (context line, no `+`/`-` around it). `tasks-rpc.handlers.ts` (the
file containing the `assertNever` guard at line ~120) is **not** in this diff's file list at all — zero
changes. `crossFileWarnings` (`task-doctor.service.ts`, new) only ever pushes to `DoctorWarning[]`, never
to `actions`. Confirmed by the new test (`task-doctor.service.spec.ts`: "reports the four cross-file
problems and repairs NONE of them") which asserts `result.plan.actions` has length 0 **and** takes a
before/after filesystem byte-snapshot (`snapshot(fs)`) that must be equal — a real assertion that would
fail if any write occurred. Also independently confirmed: `tasks-rpc.handlers.ts:246` does
`warnings: result.plan.warnings` — a direct, unfiltered pass-through, so the four widened codes reach the
wire without any intermediate mapping that could silently drop them or misfile them as an `actions` entry.

## 11. Developer decision #1 — doctor emission is in-scope, not scope creep

Batch 2's own task list (`batches.md` Task 2.4, heading **"Doctor: read-only warnings"**) and
`implementation-plan.md` §3.7 ("`task-doctor.service.ts` gains **read-only warnings only** ... **reported
read-only**") both describe actual emission, not merely a widened type with no producer. A `DoctorWarning
['code']` union that no code path ever populates would not satisfy a task titled "read-only warnings" —
the developer's characterization of the alternative as "a stub" is accurate, and wiring
`crossFileWarnings` + reshaping `inspectCarrier` to `{ warnings, task? }` (so the cross-file pass has a
view of every carrier that parsed) is the correct, minimal way to do that. Verified the emission itself is
correct (§10 above: `actions` stays empty, `plan()` performs no I/O beyond reads, confirmed by the
byte-snapshot test). **Not scope creep — justified and correctly implemented.**

## 12. Developer decision #2 — de-duplication design is right in principle, wrong in the key (see §1)

`deriveCrossFileIssues` deliberately emitting all four codes (not just the two the scanner needs) so a
caller with no directory view gets the complete picture from one call is the right design — verified the
doctor path (§10, §13) benefits from exactly this and has no duplication problem, because
`inspectCarrier`'s own returned `warnings` only ever surfaces `id_mismatch`; all cross-file codes come
from the single `crossFileWarnings(parsed)` call. The scanner's merge, which _does_ need to de-duplicate
against the parser's own findings, has the coarse-key defect in §1. The design intent is sound; the
implementation of the de-dup key is not fine-grained enough for array-valued fields.

## 13. Developer decision #3 — `knownLabels` as `readonly string[]` is sufficient; no map exposure needed

`implementation-plan.md`'s `TaskGraph` interface declares `knownLabels: readonly string[]`; `batches.md
:453`'s prose description of the internal construction ("first-seen-wins `Map<labelKey,
canonicalDisplayText>`") is exactly that — internal construction detail, not a claim about the public
shape. The developer implemented the declared interface with the `Map` kept as a local, non-exported
variable (`labelsByKey`, `task-graph.ts:408`) that is discarded after producing `[...labelsByKey.values
()]`.

**Recommendation: sufficient as-is, no change needed.** `labelKey` is itself an exported pure function
(`task-graph.ts:112-114`). Any consumer needing case-insensitive matching against the array — Batch 5's
label-completion UI included — can derive the same key from any `knownLabels` entry by calling
`labelKey(entry)`, and by construction (first-seen-wins dedup on that exact key) no two entries in the
array can produce the same `labelKey`. So the array is lossless with respect to the map: nothing the map
could tell a caller is unrecoverable from `readonly string[]` + the already-exported `labelKey`. A
per-keystroke linear scan over a workspace's label set (realistically well under a thousand entries) to
compute completions is not a performance concern at this scale, and NFR-10's "not per keystroke"
constraint is about graph _recomputation_, not about a client-side filter over an already-computed array.
Exposing the map now would be premature: it adds public surface for a lookup Batch 5 can build itself in
one line if it ever needs O(1) instead of a scan.

## 14. Developer decision #4 — the two out-of-inventory test additions are legitimate

- `task-index.store.spec.ts`'s new "both impls yield an identical derived graph" test exercises code this
  very batch's `buildTaskGraph` introduces, over data shapes (`InMemoryTaskIndexStore` vs
  `SqliteTaskIndexStore`) this batch's plan explicitly worries about (§4.4: "SQLite availability gates
  nothing"). It correctly inherits the file's existing `(Database ? it : it.skip)` gate rather than
  inventing a new skip mechanism. Legitimate — not scope creep.
- `task-doctor.service.spec.ts`'s "reports the four cross-file problems and repairs NONE of them" test
  directly verifies the BR-6/G-note-adjacent guarantee (`actions` stays empty, a full FS byte-snapshot
  before/after `plan()`) that Task 2.4 exists to provide. This is exactly the kind of assertion the
  binding rules demand be _proven_, not asserted by comment. Legitimate.

Both are additive, do not touch any inventory file not already in this batch's own diff, and raise the
bar rather than lower it. No objection.

## 15. G1 — still stands; store code inspected, nothing newly verified

The new store-parity graph test in `task-index.store.spec.ts` is correctly skip-gated (`Database ? it :
it.skip`) and, in this environment (`better-sqlite3` ABI mismatch, as recorded in G1), **did not run**.
Read `task-index.store.ts` directly rather than trusting the skip:

- `cloneSummary` (`:132-138`) clones all three new arrays (`labels`, `duplicates`, `relatesTo`) —
  confirmed, so the in-memory store does not hand out shared array references.
- `rowToSummary` (`:354-377`) correctly treats `estimate`/`parent` as nullable columns (conditionally
  assigns the key only when non-null, matching `TaskSpecSummary`'s optional-field contract) and routes
  `labels`/`duplicates`/`relates_to` through `parseJsonArray`, which is wrapped in try/catch
  (`:381-`, pre-existing pattern reused for the three new columns) — a corrupt JSON value degrades to `[]`
  rather than throwing.
- The `INSERT`/`ON CONFLICT DO UPDATE` parameter list (`:286-344`) writes `JSON.stringify(task.labels ??
[])` etc. and `task.estimate ?? null` / `task.parent ?? null` — consistent with what `rowToSummary`
  expects to read back.

This is **credible by inspection** and consistent with the DDL evidence already recorded in G1, but it is
still **not execution evidence**. `buildTaskGraph(sqliteStore.listByWorkspace(...))` producing output
identical to the in-memory store's remains unverified in this environment. **Restating plainly, as
required: the SQLite half of this batch's parity claim is unverified, not verified, and this review does
not change that.** Discharge condition is unchanged from G1 — a run on a runtime where the native module
loads, with the 8 previously-skipped suites plus this new one reported as passed.

## 16. Nested-carrier test — real scanner path, confirmed

`task-scanner.service.spec.ts`'s "never indexes a carrier nested inside another task folder" test
constructs `TASK_2026_030/TASK_2026_031/task.md` via the mock filesystem and runs it through
`new TaskScannerService(fs, makeLogger()).scan(ROOT)` — the actual production scan path, not a stub or a
hand-rolled assertion about scanner internals. Asserts `TASK_2026_031` never appears in `result.tasks`
and `TASK_2026_030` is excluded as `no_carrier`. This is the real contract, exercised for real.

## 17. Test count and quality

Counted 29 `it(...)` blocks in `task-graph.spec.ts` (close enough to the stated "28" to not be worth
flagging). Coverage confirmed present and correctly targeted for: self-reference, 2-cycle, 3-cycle,
200-cycle, the long-chain-feeding-a-cycle tail-mismarking case, a dependency diamond (for `blocks`/
`duplicatedBy` — the only place a "diamond" fixture makes sense, since `parent` is single-valued and
cannot form a diamond), dangling parent, and depth-3. Every cycle test carries the `CYCLE_TIMEOUT_MS`
(2000ms) Jest timeout and asserts measured `elapsed`, so non-termination would report as a numeric
failure rather than hang the suite — confirmed this is a real assertion (`timed()` wraps the call and
returns wall-clock ms) and not decorative.

---

## Summary

| #    | Finding                                                                                                                                                                                         | Severity                                       | Blocking                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------- |
| 1    | `mergeCrossFileIssues`'s `(code, field)` key swallows a genuine second `dangling_relation` finding when one entry under the same field was already caught by the per-file parser                | Serious — silent diagnostic loss, no data loss | **Yes**                                 |
| 2–17 | Termination, precedence, inverses, determinism, label hash, structural read-only, BR-6/BR-7/G2/G3, doctor scope + correctness, decisions #1/#3/#4, G1 status, nested-carrier test, test quality | —                                              | No — all verified correct or legitimate |

**Recommendation**: fix issue #1 (localized — add a distinguishing value to `TaskValidationIssue` or the
de-dup key for the two array-valued relation fields), re-run
`npx nx run-many -t typecheck,test,lint -p shared task-specs persistence-sqlite`, and resubmit. No other
change is required; the rest of this batch is executed to a high standard, including catching an
interaction (grandparent-dangling → one-level claim) that would have been easy to get wrong.

---

## 18. RE-REVIEW (round 2) — the `ref` fix

### Current diff re-established

`git status` re-run. Beyond round 1's file set, the fix touches `libs/shared/src/lib/types/task-spec.types.ts`
(new `ref?: string` on `TaskValidationIssue`) and `libs/backend/task-specs/src/lib/task-frontmatter.ts`
(a **committed, Batch-1 file**, now reopened this round). `task-graph.ts` and `task-scanner.service.ts`
carry the corresponding `ref` writes and the widened `(code, field, ref)` key. All other round-1 files
unchanged in kind.

### 18.1 Is `(code, field, ref)` sufficient? — adversarial construction, not just acceptance

Checked every site, both passes, for the two failure directions:

**Under-suppression (the original bug, re-tested).** Reconstructed the exact scenario from finding #1 —
`TASK_2026_X` with `relates_to: [Y, Z]`, `Y` an existing-but-unparseable folder, `Z` absent entirely.
Traced it through the current code: parser flags `Z` only, with `ref: 'Z'`
(`task-frontmatter.ts:206-208`). `deriveCrossFileIssues` flags both `Y` (`ref: 'Y'`) and `Z`
(`ref: 'Z'`) (`task-graph.ts:498-521`). `issueKey` now produces `"dangling_relation relates_to Y"` and
`"dangling_relation relates_to Z"` — distinct. `alreadyReported` contains only the `Z` key (from the
parser). The `Y` finding survives the filter. **Fixed**, confirmed by trace, not just by the test the
developer added.

**Over-suppression (the direction the coordinator flagged as the real risk).** Checked every code that
participates in the merge for a one-sided `ref`:

| Code                                                            | Parser site sets `ref`?                                                 | Graph site sets `ref`?                                                                                                                                                                   | Same underlying value?                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parent_cycle` (self only — parser can't see multi-node cycles) | Yes, `task-frontmatter.ts:461` (`ref: rawParent`)                       | Yes, `task-graph.ts:256` (`ref: parent`)                                                                                                                                                 | Yes — both read the identical `task.parent` string; the parser's `rawParent` becomes exactly `task.parent` (`task-frontmatter.ts:451`, no trim/normalization applied to the stored value), and the graph reads `task.parent` directly. String-identical by construction.              |
| `dangling_parent`                                               | Yes, `task-frontmatter.ts:468`                                          | Yes, `task-graph.ts:267`                                                                                                                                                                 | Same as above — same source field, same string.                                                                                                                                                                                                                                       |
| `dangling_relation` (self-ref branch)                           | Yes, `task-frontmatter.ts:195`                                          | Yes, `task-graph.ts:500-505`                                                                                                                                                             | Yes — both iterate the identical `task.duplicates`/`task.relatesTo` array (the graph reads exactly what `liftRelationArray` produced and stored on the summary), so `entry` is the same string on both sides.                                                                         |
| `dangling_relation` (dangling branch)                           | Yes, `task-frontmatter.ts:206`                                          | Yes, `task-graph.ts:508-519`                                                                                                                                                             | Same as above.                                                                                                                                                                                                                                                                        |
| `parent_depth_exceeded`                                         | **No** — the parser cannot compute this (needs the parent's own parent) | Yes, `task-graph.ts:282`                                                                                                                                                                 | N/A — never emitted by the parser, so there is nothing for it to collide or fail to collide with; every occurrence is purely additive through the merge. Confirmed no parser-side entry with this code exists anywhere in `task-frontmatter.ts`.                                      |
| `dangling_depends_on`                                           | Yes, `task-frontmatter.ts:349` (`ref: dependency`)                      | **N/A — `deriveCrossFileIssues` never emits this code at all** (`blocks`/`unmetDependencies` construction in `task-graph.ts:387-395` silently skips unresolved entries, pushes no issue) | N/A — not part of the merge's comparison surface at all; the parser is the only producer. The `ref` addition here is inert with respect to de-duplication (nothing to dedupe against) but is harmless and consistent with the field's documented purpose ("the codes that name one"). |

No code has `ref` populated on one side and left `undefined` on the other while both sides can produce
it for the same logical finding. The two codes that are asymmetric (`parent_depth_exceeded`,
`dangling_depends_on`) are asymmetric because only one pass can ever produce them at all — there is no
"same logical finding, different `ref` presence" scenario possible for either, so they cannot manufacture
a spurious duplicate or a spurious suppression.

**Verdict: `(code, field, ref)` is sufficient.** No collision (two genuinely different findings sharing a
full key) and no residual under- or over-suppression found under adversarial construction.

### 18.2 Over-correction direction — confirmed the self-parent case still collapses to one

Re-traced `parent_cycle` self-reference: parser emits `{ code: 'parent_cycle', field: 'parent', ref:
rawParent }` where `rawParent === folderName`. Graph's `analyzeParentage` emits `{ code: 'parent_cycle',
field: 'parent', ref: parent }` where `parent === task.parent === rawParent` (same field, same value).
Keys match exactly → collapses to one, exactly as `task-graph.spec.ts`'s pre-existing "does not report a
self-parent twice" fixture and the new scanner test (`task-scanner.service.spec.ts`: "does not report a
self-parent twice when both passes catch it") assert. Ran both suites (below) — green.

Searched for any other latent duplication risk from the widened key and found none: the key can only get
_more_ precise than `(code, field)`, never less, so anything that used to collapse under the old key and
had matching `ref`s on both sides still collapses under the new one (§18.1's table shows every
overlapping code has matching `ref`s for the same logical finding). There is no case in this diff where
widening the key from `(code, field)` to `(code, field, ref)` newly _fails_ to collapse two issues that
represent the same finding — the only two-issues-with-different-ref scenarios found are the ones that
represent two genuinely different findings (the whole point of the fix).

### 18.3 `ref` placement discipline — correctly drawn

Grepped every `code: '...'` literal in `task-frontmatter.ts` (14 sites). Confirmed `ref` was added to
exactly 5: `dangling_relation` ×2 branches, `dangling_depends_on`, `parent_cycle`, `dangling_parent` — all
five name a **reference to another task/folder**. Confirmed `ref` was **not** added to `invalid_relation`,
`id_mismatch`, `invalid_type`, `invalid_depends_on`, `invalid_date` ×2, `invalid_labels`,
`invalid_estimate`, `invalid_parent` — all of these describe a malformed **raw value** (a shape failure,
a bad enum member, an unparseable date) rather than a pointer to another task, and none of them
participates in the cross-file merge's de-duplication (they are never produced by
`deriveCrossFileIssues`, so there is nothing to disambiguate against). The line is drawn on the right
property: "does this code name an entity that could collide with another entry under the same
`(code, field)`," not "does this code involve a string." Correctly drawn, no gaps found.

### 18.4 `task-frontmatter.ts` — a committed Batch-1 file reopened this round

Diff is exactly five one-line additions, each `+  ref: <value>,` inside an existing object literal
(`task-frontmatter.ts:197` self-relation, `:208` dangling-relation, `:349` dangling-depends-on, `:462`
parent_cycle, `:471` dangling_parent). No control flow changed, no message text changed, no schema
changed (`TaskFrontmatterSchema` untouched), no lift-order changed. Confirmed by reading the full diff,
not by trusting the summary.

**`contract.guard.spec.ts` (BR-7 ratchet + full round-trip matrix)** run in isolation (not just as part of
the aggregate suite count):

```
npx jest --config libs/backend/task-specs/jest.config.ts contract.guard
Test Suites: 1 passed, 1 total
Tests:       173 passed, 173 total
```

Green. BR-7 (no per-task filename literal, no banned path strings, `TASK_2026_*` fixtures only) and the
hostile-label / golden-string round-trip matrix are both intact.

### 18.5 The nine coordinated sites — spot-checked, not accepted on say-so

- **Emitter** (`task-spec.contract.ts`, `renderTaskMd`): grepped for `validationIssues` — zero matches.
  BR-5 holds; the diff for this batch does not touch the file at all (confirmed via `git status` — not
  in the changed-file list).
- **`task-index.store.ts`**: read directly, not inferred. `validation_issues` is declared
  `TEXT NOT NULL DEFAULT '[]'` in `0029_task_specs.ts:25` — a single JSON-blob column, confirmed
  unrelated to migration `0031`'s five metadata columns. `cloneSummary` clones each issue with
  `task.validationIssues.map((i) => ({ ...i }))` (`task-index.store.ts:139`) — a shallow spread that
  carries any optional property, including `ref`, without needing to know it exists. The SQLite write
  path does `JSON.stringify(task.validationIssues ?? [])` (`:349`) and the read path does
  `parseIssues` → `JSON.parse` + an `Array.isArray` guard, cast, no per-field allowlist (`:390-397`) — so
  `ref` round-trips through the blob with zero store-side changes required. The claim is correct.
- **The extended round-trip test** (`task-index.store.spec.ts`) adds a `ref`-bearing issue to the
  existing shared `runContract` fixture and asserts `ref` is `undefined` on an issue that lacks it and
  `'TASK_2026_900'` on one that has it. This fixture runs unconditionally for `InMemoryTaskIndexStore`
  (`:327-328`, no skip gate) — **and did run**, as part of the 317-passed count below — proving the
  in-memory half of the `ref` round trip by execution, not by inspection. The `SqliteTaskIndexStore` half
  runs through the same `runContract` under `describeSqlite = Database ? describe : describe.skip`
  (`:364`), which is skipped in this environment — consistent with, and does not discharge, G1.

### 18.6 The one deliberate drop — `tasks-namespace.builder.ts:406`, `check()`'s MCP projection

Read the file directly (not touched by this diff — confirmed via `git status`). `check()`
(`tasks-namespace.builder.ts:390-412`) explicitly projects each issue to `{ field, code, message }`,
dropping `ref`. Two other facts narrow this: (1) `list()` (`:378-386`) returns `result.tasks` — the raw
`TaskSpecSummary[]` — directly, so `ref` **does** ride along on the `list`/`get` MCP paths for free,
since those pass the summary through unprojected; only `check()`'s narrower health-check shape drops it.
(2) the dropped `ref` value is not lost information for a _reader_ of `check()`'s output — every message
that carries a `ref` also names that same value inline in prose (e.g. `"relates_to entry 'X' does not
resolve..."`), so an agent consuming `check()` still has the entry available, just as unstructured text
rather than a separate field.

**Ruling: acceptable to leave alone.** This file is out of this batch's inventory (Batch 1/4/6 own
different parts of it), the drop loses no information reachable by a consumer of `check()`'s prose, and
`ref` is an additive optional field so nothing here required changing for the diff to type-check. Non-
blocking. Worth a one-line note for whichever batch next touches `check()`: pass `ref` through for
parity with `list`/`get`, but there is no correctness reason to force that now.

### 18.7 Pre-existing `NG0955` risk — confirmed real, correctly not fixed here, routing agreed

`libs/frontend/tasks-ui/src/lib/components/detail/task-detail.component.ts:105` —
`@for (issue of task.validationIssues; track issue.field)`. Confirmed by direct read. `track issue.field`
is non-unique whenever two issues share a `field`, which was **already possible on `main`** before this
task: `dependsOn` could already produce multiple `dangling_depends_on` issues (one per bad entry) sharing
`field: 'depends_on'`. This is a genuine pre-existing Angular `NG0955` (duplicate track key) exposure, not
introduced by this diff.

This diff does make it **more frequently reachable**: before the `ref` fix, the over-broad `(code, field)`
scanner de-dup was incidentally collapsing some of the new multi-entry `relates_to`/`duplicates` findings
down to fewer entries per field than the data actually contained; now that the fix correctly lets
genuinely distinct findings through, more tasks will legitimately carry two-plus issues sharing one
`field` value, and each one now hits the frontend's non-unique `track`.

**Ruling**: correctly out of scope for Batch 2 (frontend file, owned by Batch 3 per the batch map) and
correctly not touched in this diff. Severity is real (a live Angular runtime warning/error class, not
cosmetic) but not a regression _of the underlying bug_ — only of its trigger frequency — so it does not
retroactively block a backend-only batch. **Agree with the developer's routing**: Batch 3 should fix the
`track` expression using the now-available `ref` (e.g. `track field + ':' + (issue.ref ?? message)` or
an index-based fallback), and should not be allowed to treat "no regression introduced" as license to
defer it further, since Batch 2's own fix is what makes it materially more likely to fire. Recording this
explicitly so it does not get lost between batches.

### 18.8 Gates — spot-checked by direct execution, not accepted from the report

Ran independently rather than trusting the numbers handed over:

```
npx nx test task-specs --skip-nx-cache
  → Test Suites: 13 passed, 13 total
  → Tests: 17 skipped, 317 passed, 334 total          (matches developer's number exactly)

npx nx test shared --skip-nx-cache
  → Test Suites: 26 passed, 26 total
  → Tests: 515 passed, 515 total                      (matches)

npx nx run-many -t typecheck -p shared task-specs rpc-handlers tasks-ui vscode-lm-tools ptah-cli persistence-sqlite --skip-nx-cache
  → all 7 green                                        (matches, superset of the reported 4+3 split)

npx nx run-many -t lint -p shared task-specs --skip-nx-cache
  → both "All files pass linting"                       (matches)

npx jest --config libs/backend/task-specs/jest.config.ts contract.guard
  → 1 suite, 173 tests, all passed                       (isolated confirmation of the BR-7 ratchet specifically)
```

All numbers reproduced exactly. **G1 is confirmed still open**: the 17 skips in `task-specs` are the same
`better-sqlite3` ABI-gated suites as before (the store-parity graph test from round 1 and the new
`ref`-bearing half of the round-trip test both skip under `describeSqlite`/`(Database ? it : it.skip)` in
this environment). Nothing in this round changes G1's discharge condition or status.

### 18.9 Final verdict

| #    | Round-1 finding                                                                | Status                                                                                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `mergeCrossFileIssues`'s `(code, field)` key swallows a genuine second finding | **RESOLVED** — `ref` added at every site that needs it, key widened to `(code, field, ref)`, verified sufficient by adversarial construction (§18.1) and by reproducing the original failure scenario against the current code (§18.1) |
| 2–17 | All other round-1 checks                                                       | Unaffected by this round's diff; re-confirmed no regression via the gate re-run (§18.8)                                                                                                                                                |

New, round-2-only observations, both **non-blocking**:

- §18.6 — `check()`'s MCP projection drops `ref`; acceptable, no information loss to a reader, out of
  this batch's file inventory.
- §18.7 — pre-existing `NG0955` `track` risk in `task-detail.component.ts`, made more frequently
  reachable by this fix; correctly out of scope for a backend batch, routing to Batch 3 agreed.

**VERDICT: APPROVED WITH CONCERNS.** No blocking issues remain. The two items above should be tracked
(the second explicitly handed to Batch 3, as the developer proposed) but neither blocks landing this
batch.
