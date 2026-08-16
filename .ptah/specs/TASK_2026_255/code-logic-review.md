# Code Logic Review — TASK_2026_255

## Review Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall Score       | 8/10     |
| Assessment          | APPROVED |
| Critical Issues     | 0        |
| Serious Issues      | 0        |
| Moderate Issues     | 0        |
| Nits (non-blocking) | 1        |

This is a narrow, well-scoped fix with an unusually thorough implementation
report, and the report's claims all check out against the actual diff and a
live test/typecheck/lint run. No blocking defects found.

## The 5 Paranoid Questions

### 1. How does this fail silently?

It doesn't, for the cases this task targets. `toTaskType`/`toTaskStatus`
return `undefined` for anything that isn't a recognised value in any case —
including non-strings (numbers, arrays, objects, booleans) — and both call
sites in `parseTaskFile` treat `undefined` exactly as the old `safeParse`
failure was treated (push `invalid_type` / exclude with `invalid_status`).
Verified by tracing `data['status']`/`data['type']` from `gray-matter`
straight into the helper with no intermediate normalization that could hide
a bad value.

One thing worth naming even though it isn't new: `updateFrontmatter` never
re-normalizes an UNTOUCHED `status`/`type` value on write — it splices the
patch over the raw parsed frontmatter object, so a carrier that still says
`status: Backlog` on disk stays `Backlog` on disk after an unrelated metadata
write (e.g., a label change). That is correct per the lib's stated
byte-preservation invariant, and every _touched_ field is written back
already canonically cased because `TaskStatus`/`TaskType` are compile-time
types on the writer's input — but it does mean the file bytes and the
in-memory `TaskSpecSummary.status` can disagree in casing for as long as
nothing writes that field. Not a defect; recorded because it's the kind of
thing that looks like one on first read of `updateFrontmatter`.

### 2. What user action causes unexpected behavior?

None identified. A hand-authored `type: bugfix` or `status: Backlog` now
renders correctly instead of vanishing or warning. A genuinely bad value
(`type: banana`, `status: nonsense`) still warns/excludes exactly as before.

### 3. What data makes this produce wrong results?

Checked the two edge families explicitly called out in the task brief:

- **Non-string YAML values** (`type: 1`, `type: [a, b]`, `type: {k: v}`,
  `type: true`, `status: 1`, `status: [a, b]`, `status: true`) — the
  `typeof value !== 'string'` guard in `task-enum-narrowing.ts:40,49` routes
  all of these to `undefined` without calling `.trim()`, so nothing throws.
  Confirmed by the new `it.each` blocks in the spec and by reading the guard
  directly.
- **Turkish-locale `toUpperCase`** — verified `task-enum-narrowing.ts:41,50`
  use `.toUpperCase()`/`.toLowerCase()`, not the locale-sensitive variants.
  Correct per the report's claim.

### 4. What happens when dependencies fail?

N/A — this is a pure, synchronous narrowing change with no I/O, network, or
async dependency added.

### 5. What's missing that the requirements didn't mention?

Nothing essential. One structural limitation worth flagging (see Nits): the
"agrees with the doctor narrowing" test compares the parser's output against
`task-enum-narrowing.ts` directly, not against anything actually inside
`task-doctor.service.ts`. That's fine architecturally (the doctor is now a
thin, unconditional call to the same function — there is no doctor-side logic
left to diverge), but it means the test's name overstates what it checks.

## Verification Against the Report's Specific Claims

### 1. Round-trip safety — CONFIRMED, correct as designed

Traced both write paths:

- `TaskWriterService.updateStatus` → `updateMetadata` → `patch.status =
input.status` (`task-writer.service.ts:561`). `input.status` is typed
  `TaskStatus`, so it is always canonically cased at the call site — there is
  no way to route a lowercase-drifted `Status` string through this path.
  `updateFrontmatter` (`task-frontmatter.ts:567`) then does
  `merged = { ...existing, ...patch }`, so the patched key is fully replaced
  with the canonical value and every untouched key (including a
  differently-cased `type` sitting in `existing`) survives byte-for-byte.
- When a write does NOT touch `status`/`type` (e.g. a labels-only
  `updateMetadata` call), `existing.status`/`existing.type` — whatever raw
  string `gray-matter` parsed off disk, case and all — passes through
  unchanged into `merged` and gets re-serialized as-is. This matches the
  lib's stated invariant: byte-preservation of everything outside the touched
  key.
- `TaskFrontmatterSchema` is never invoked on this path (see #3 below), so
  its case-sensitive `z.enum` has no chance to reject a lowercase existing
  value during a merge.

Net effect: normalization happens strictly on **read**
(`parseTaskFile`/`toTaskStatus`/`toTaskType`); writes never silently rewrite
a field the caller didn't ask to change, and any field the caller DOES change
is written in canonical case because the type system enforces that at the
call site. This is the correct, defensible choice and matches what the report
claims.

### 2. The exclusion path still excludes — CONFIRMED

`toTaskStatus(data['status'])` returning `undefined` is handled identically
to the old `!statusResult.success` branch: same `{ kind: 'excluded',
excluded: { folderName, reason: 'invalid_status' } }` shape at
`task-frontmatter.ts:272-278`. Verified via the new `'still excludes a status
that is no status in any case'` test and by reading the exclusion branch
directly — no change to `ExcludedTaskFolder`'s shape, no new reason code.

### 3. `TaskFrontmatterSchema` left case-sensitive — CONFIRMED safe

Grepped the whole repo (`libs/`, `apps/`) for `TaskFrontmatterSchema` and for
`.safeParse`/`.parse` calls on it: the only hits are the definition itself
(`task-frontmatter.ts:34`), the `z.infer` type alias (`:71`), the public
re-export (`index.ts:16`), and documentation. **It is never invoked anywhere
in the codebase.** It exists solely to derive the `TaskFrontmatter` type used
to type `updateFrontmatter`'s `patch` parameter — a compile-time-only
artifact. No read path reaches it, so its case-sensitive `z.enum` fields are
inert. The report's claim is correct.

### 4. Doctor's behavior is genuinely unchanged — CONFIRMED

Both call sites (`task-doctor.service.ts:850` and `:864`) pass string values
(`unquoted`, `match[1]`) into the now-`unknown`-typed shared `toTaskType`.
Since both call sites already only ever produced strings, the widened
parameter type accepts exactly what it did before and nothing new reaches it.
Logic inside the shared function is byte-identical to the deleted private one
for string inputs (uppercase, trim, membership check). Confirmed by diff and
by grepping for any other `TASK_TYPES`/`toTaskType` reference in the doctor
file (none beyond the import and these two call sites).

### 5. Regression-guard test actually guards — CONFIRMED (with a caveat)

Traced what happens if `task-frontmatter.ts` were reverted to the pre-fix
`z.enum(TASK_TYPES).safeParse(rawType)` / `STATUS_SCHEMA.safeParse`, while
`task-enum-narrowing.ts` and the spec file stay as they are:

- `TASK_TYPES` is uppercase (`FEATURE`, `BUGFIX`, …), so
  `z.enum(TASK_TYPES).safeParse('bugfix')` fails → `result.task.type` would
  be `null`.
- The test's `toTaskType('bugfix')` → `'BUGFIX'`.
- `expect(result.task.type).toBe(toTaskType(input) ?? null)` →
  `null !== 'BUGFIX'` → **test fails**, exactly as required.

Same reasoning holds for `status` against the lowercase `TASK_STATUSES`
tuple. I did not physically apply-and-run the reverted file (a background
process was holding `.git/index.lock` during the session, making an
in-repo revert experiment risky mid-review of concurrent work; the logic
trace above is deterministic and doesn't depend on that). I did confirm
`TASK_TYPES`/`TASK_STATUSES` casing directly in
`libs/shared/src/lib/types/task-spec.types.ts:13-32` to ground the trace.

Caveat (see Paranoid Question 5 / Nits): the test compares the parser against
`task-enum-narrowing.ts`, not against anything inside
`task-doctor.service.ts`. It guards the actual historical defect (parser
diverging from the canonical narrowing) correctly; it does not — and
structurally cannot, now that the doctor's private copy is deleted — prove
the doctor specifically agrees, beyond "the doctor imports the same
function," which is a one-line grep-checkable fact rather than something a
unit test needs to re-prove.

### 6. No stubs, no dead code — CONFIRMED

- `STATUS_SCHEMA` — deleted, zero remaining references (grepped).
- Doctor's private `toTaskType` — deleted, zero remaining references
  (grepped).
- `TASK_TYPES` import removed from `task-doctor.service.ts`'s import list and
  not referenced anywhere else in that file.
- `TASK_STATUSES`/`TASK_TYPES` imports in `task-frontmatter.ts` remain live
  (still used by `TaskFrontmatterSchema`).

### 7. Locale — CONFIRMED

`task-enum-narrowing.ts:41` and `:50` use `.toUpperCase()` / `.toLowerCase()`,
not the locale-sensitive `toLocaleUpperCase`/`toLocaleLowerCase`.

## Gate Results (run live, not taken from the report)

```
npx nx test task-specs --skip-nx-cache
  Test Suites: 16 passed, 16 total
  Tests:       23 skipped, 423 passed, 446 total
```

```
npx nx typecheck task-specs
  Successfully ran target typecheck for project @ptah-extension/task-specs
```

```
npx nx lint task-specs
  ✖ 1 problem (0 errors, 1 warning)
  'MockFileSystemProvider' is defined but never used —
  task-writer.create-race.spec.ts:33 (pre-existing, untouched by this diff)
```

All three numbers match the implementation report exactly: 16 suites / 423
passed / 23 pre-existing skips, clean typecheck, one pre-existing lint
warning in a file this task did not touch.

## Requirements Fulfillment

| Requirement                                                                  | Status   | Concern                                                                              |
| ---------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| Parser and doctor narrow `type` identically                                  | COMPLETE | Both call one shared function; verified by trace and by the regression test's logic. |
| `status` narrowed with the same fix, given its worse (exclusion) consequence | COMPLETE | `toTaskStatus` applied at the essential-field gate; exclusion shape unchanged.       |
| Non-string / malformed values never throw                                    | COMPLETE | `typeof` guard in the shared helper, exercised by dedicated tests.                   |
| Byte-preservation of untouched frontmatter on write                          | COMPLETE | Traced through `updateMetadata`/`updateFrontmatter`; normalization is read-only.     |
| No orphaned code from the refactor                                           | COMPLETE | `STATUS_SCHEMA` and the doctor's private `toTaskType` are both gone with no residue. |

## Verdict

**Recommendation**: APPROVE
**Confidence**: HIGH
**Top residual risk (non-blocking)**: the "agrees with the doctor narrowing"
test name promises more than it can structurally check post-refactor — it
verifies the parser against the canonical helper, not against
`task-doctor.service.ts` itself. Given the doctor's private duplicate is
deleted and it now does nothing but call the shared helper, this is a
naming/documentation nit, not a functional gap. Does not block approval.
