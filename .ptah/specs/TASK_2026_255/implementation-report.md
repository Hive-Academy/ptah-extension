# Implementation Report — TASK_2026_255

Case-sensitivity defect in the task-spec frontmatter parser. Fixed at the
narrowing, not at the carriers; the sixteen carriers were repaired as cleanup
afterwards.

## The shared-helper decision

**One new file**, `libs/backend/task-specs/src/lib/task-enum-narrowing.ts`,
exporting `toTaskType(value: unknown)` and `toTaskStatus(value: unknown)`. The
parser and the doctor both call it. The doctor's private `toTaskType` was
deleted, not left in place.

Why a shared helper rather than fixing the parser in isolation: the defect was
never "the parser is case-sensitive". It was **two narrowings of one union, in
one lib, answering differently for identical bytes**. Patching one copy to
match the other leaves the same two-copies-in-sync-by-convention arrangement
that produced sixteen bad carriers — it just resets the clock. There is now one
narrowing and it is not possible for the two call sites to drift.

Three details worth stating:

- **The helper does NOT share a fold direction.** `TASK_STATUSES` is lowercase
  (`libs/shared/src/lib/types/task-spec.types.ts:13`) and `TASK_TYPES` is
  uppercase (`:23`). Each function folds toward its own tuple. A single
  "normalize" step that uppercased both would have broken every status on the
  board.
- **Both accept `unknown`, not `string`.** YAML hands the parser whatever was
  typed — `status: 1` is a number, `type: [a, b]` is an array. The `typeof`
  guard is the reason those reach the invalid path instead of throwing on
  `.trim()`, which matters because `parseTaskFile` must never throw past its
  boundary. The doctor's old signature took `string`; widening it cost nothing
  since both its call sites already pass strings.
- **`toUpperCase()`, not `toLocaleUpperCase()`.** A Turkish locale maps `i` to
  `İ`, which would make `bugfix` parse on one machine and not another.

**Public API not widened.** The helper is internal to the lib; `src/index.ts` is
untouched. Nothing outside `task-specs` needs it.

## Files changed

### New

- `libs/backend/task-specs/src/lib/task-enum-narrowing.ts` — the single
  narrowing for both enums, with the root cause recorded in its header.

### Parser — `libs/backend/task-specs/src/lib/task-frontmatter.ts`

- `:27` — import the helper.
- `:115` (was) — deleted `const STATUS_SCHEMA = z.enum(TASK_STATUSES)`. It had
  exactly one call site and that call site is now the helper.
- `:272` — `status` narrowed via `toTaskStatus(data['status'])`; `undefined`
  still returns `{ kind: 'excluded', reason: 'invalid_status' }`.
- `:323` — `type` narrowed via `toTaskType(rawType)`; a miss still pushes
  `invalid_type` and leaves `type` null.

`TaskFrontmatterSchema` (`:33`) keeps its `z.enum(...)` fields deliberately. That
schema types the **writer's** patch input, which is already typed `TaskType` /
`TaskStatus` at the call site — it is not the read path and loosening it would
let a lowercase literal into a write.

### Doctor — `libs/backend/task-specs/src/lib/task-doctor.service.ts`

- `:301-307` (was) — private `toTaskType` deleted.
- `:64` — imports the shared helper instead.
- `:58` (was) — dropped the now-unused `TASK_TYPES` import.
- `:850`, `:864` — call sites unchanged in shape; behaviour identical by
  construction.

### Tests — `libs/backend/task-specs/src/lib/task-frontmatter.spec.ts`

Extended the existing spec (no parallel file). One new describe block,
`case-insensitive enum narrowing (TASK_2026_255)`, **19 tests**:

- `type: bugfix` / `BugFix` / `'  bugfix  '` / `documentation` / `saas_init` →
  correct `TaskType` with `validationIssues` empty and `frontmatterValid` true.
- `status: Backlog` / `IN_PROGRESS` / `'  In_Review  '` → narrowed, included,
  no issues.
- `type: banana` → still `invalid_type`, type null.
- `status: nonsense` → still excluded, `invalid_status`.
- Non-string `type` (`1`, `[a, b]`, `{ k: v }`, `true`) → invalid path, no
  throw. Non-string `status` (`1`, `[a, b]`, `true`) → exclusion, no throw.
- **The regression guard**: `agrees with the doctor narrowing for every input`
  feeds eight inputs to `parseTaskFile` and to `toTaskType` and asserts the
  answers match (`result.task.type === toTaskType(input) ?? null` — the parser
  reports "no type" as null, the doctor as undefined; same answer, two shapes).
  A sibling test does the same for `status`.

The two pre-existing negative tests were left untouched and still pass, which is
the point: `status: wip` folds to `wip` and is still no status, `type: NONSENSE`
folds to `NONSENSE` and is still no type.

## Verification

```
npx nx test task-specs
  Test Suites: 16 passed, 16 total
  Tests:       23 skipped, 423 passed, 446 total
```

Re-run with `--skip-nx-cache` AFTER the sixteen carrier edits (the contract
guard reads real repo files): identical, 16 suites / 423 passed. The 23 skips
are pre-existing.

New tests confirmed executing rather than silently absent:

```
npx nx test task-specs -- --testNamePattern="TASK_2026_255"
  Tests: 427 skipped, 19 passed, 446 total
```

```
npx nx typecheck task-specs
  tsc --noEmit --project libs/backend/task-specs/tsconfig.lib.json
  Successfully ran target typecheck
```

```
npx nx lint task-specs
  ✖ 1 problem (0 errors, 1 warning)
  Successfully ran target lint
```

The single warning is `'MockFileSystemProvider' is defined but never used` in
`task-writer.create-race.spec.ts:33` — pre-existing, in a file this task did not
touch. Not fixed here; unrelated to the change and out of scope for a bug fix.

`libs/shared` was NOT modified, so `nx test shared` was not required. The lib's
public API (`src/index.ts`) is unchanged, so dependents (`rpc-handlers`,
`skill-synthesis`) see no surface change.

## Carriers repaired

All sixteen were lowercase on line 4 and each `type:` line was verified UNIQUE
in its file before editing. Sixteen single-line `Edit` calls, no `Write`, no
whole-carrier rewrite.

| Task          | Was             | Now             |
| ------------- | --------------- | --------------- |
| TASK_2026_234 | `bugfix`        | `BUGFIX`        |
| TASK_2026_235 | `refactoring`   | `REFACTORING`   |
| TASK_2026_237 | `feature`       | `FEATURE`       |
| TASK_2026_238 | `bugfix`        | `BUGFIX`        |
| TASK_2026_239 | `documentation` | `DOCUMENTATION` |
| TASK_2026_240 | `devops`        | `DEVOPS`        |
| TASK_2026_241 | `feature`       | `FEATURE`       |
| TASK_2026_243 | `bugfix`        | `BUGFIX`        |
| TASK_2026_245 | `feature`       | `FEATURE`       |
| TASK_2026_246 | `refactoring`   | `REFACTORING`   |
| TASK_2026_247 | `bugfix`        | `BUGFIX`        |
| TASK_2026_248 | `documentation` | `DOCUMENTATION` |
| TASK_2026_249 | `bugfix`        | `BUGFIX`        |
| TASK_2026_250 | `bugfix`        | `BUGFIX`        |
| TASK_2026_251 | `bugfix`        | `BUGFIX`        |
| TASK_2026_253 | `bugfix`        | `BUGFIX`        |

**Skipped: none of the sixteen.** All were present and all were lowercase.

**Eight more found, deliberately left alone.** A post-repair sweep for
non-uppercase `type:` lines across every carrier found `TASK_2026_256`, `257`,
`258`, `259`, `260`, `261`, `262`, `263` — all authored by hand AFTER this task
was written, all lowercase. They parse correctly under the fix and belong to
other in-flight tasks, so they were not touched. They are also the plainest
available evidence that the fix belonged in the parser: the convention drifted
eight more times in the window between diagnosing it and fixing it.

## `status` finding recorded

Appended to `context.md` under `## Answer on status: same exposure, worse
consequence — normalized too`, without altering the existing prose. It states:
the same case-sensitivity at `task-frontmatter.ts:115` applied at `:270`; the
consequence is EXCLUSION at `:274` (the folder leaves the board) rather than a
warning; the two tuples' opposite casing; and that a sweep of every `status:`
line under `.ptah/specs` currently returns only the six lowercase members — so
the exposure was real but had not yet fired. Decision recorded: normalize both,
through one helper, with unrecognised values keeping their old behaviour
exactly.

## Not done

No commit — per instruction, git is the orchestrator's. `task.md` status left at
`in_progress`.
