# Batch 9 Implementation Report — TASK_2026_299

**Executor**: backend-developer
**Scope**: Three confirmed defects from the Batch 8 logic review (`code-logic-review.md` Critical Issues 1–3).
**Result**: All three fixed at the source. Red baseline is now green with no assertion weakened.

---

## 1. Red baseline reproduced BEFORE any edit

Both suites were run first, unmodified, to confirm the three specs fail for the
stated reason and not for an environmental one.

```
npx nx test workspace-intelligence --skip-nx-cache
  -> Test Suites: 1 failed, 35 passed, 36 total
  -> Tests:       2 failed, 884 passed, 886 total
  -> failing at src/diagnostics/type-script-diagnostics-provider.spec.ts:203
     ("EXPECTED RED (Batch 8 finding #2) ... unavailable, not a false clean")
     and the finding #1 solution-style traversal case in the same file.

npx nx test vscode-lm-tools --skip-nx-cache
  -> Test Suites: 1 failed, 41 passed, 42 total
  -> Tests:       1 failed, 815 passed, 816 total
  -> failing at src/lib/code-execution/namespace-builders/core-namespace.builders.spec.ts:436
     ("EXPECTED RED (Batch 8 finding #3) ... rejects when contextOrchestration
      resolves { success: false }")
```

This matches `test-report.md` exactly: 2 red in workspace-intelligence, 1 red in
vscode-lm-tools, everything else green. Baseline totals recorded for the
no-regression check: **886** and **816**.

---

## 2. Task 9.1 — Project-reference traversal for solution-style configs

**File**: `D:/projects/ptah-extension/libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.ts`

**Before**: `if (rootFileNames.length === 0) return;` (old line 129) returned
before `program.getProjectReferences()` (old line 148) could run. For a
solution-style config (`{ files: [], include: [], references: [...] }` — the
shape of `libs/backend/workspace-intelligence/tsconfig.json` and every other lib
in this repo) the traversal was unreachable dead code.

**After** — `type-script-diagnostics-provider.ts:135-162`:

- `type-script-diagnostics-provider.ts:135` — the early `return` is gone.
  Program creation and `getPreEmitDiagnostics` collection are now inside
  `if (rootFileNames.length > 0) { ... }`, so a config with no in-root root
  files simply builds no program of its own instead of aborting the visit.
- `type-script-diagnostics-provider.ts:157-162` — traversal now reads
  `parsed.projectReferences ?? []` (populated by `ts.parseJsonConfigFileContent`
  regardless of whether `fileNames` is empty) rather than
  `program.getProjectReferences()`, and recurses into
  `collectFromConfig(...)` for each reference. This runs unconditionally,
  independent of whether the parent config had root files.
- `type-script-diagnostics-provider.ts:158` — `ref.path` is resolved with
  `ts.resolveProjectReferencePath(ref)` rather than being used raw, so a
  reference pointing at a **directory** (`{ "path": "./child" }`, the common
  form) resolves to `child/tsconfig.json` the way the compiler itself does.
  API existence verified against
  `node_modules/typescript/lib/typescript.d.ts:9624`
  (`function resolveProjectReferencePath(ref: ProjectReference): ResolvedConfigFileName;`)
  before use — not assumed.
- The `visitedConfigs` cycle guard is untouched and still gates the top of
  `collectFromConfig`, so each config is visited at most once and reference
  cycles terminate. The old redundant `visitedPrograms.has(programKey)` early
  return was removed: `visitedConfigs` already guards the identical key, and
  `visitedPrograms` is now needed as a pure "programs actually built" counter
  for Task 9.2.

Existing behavior for configs that DO have root files is preserved: build the
program, collect `getPreEmitDiagnostics`, then traverse.

## 3. Task 9.2 — `available + []` can no longer mean "checked nothing"

**File**: same file, `type-script-diagnostics-provider.ts:174-189`

**Before**: `if (visitedPrograms.size === 0 && errors.length > 0)`. When configs
were discovered but zero programs were built and no error was recorded, this
fell through to `{ status: 'available', diagnostics: [] }`, which
`formatDiagnostics` renders as "No issues found" — the exact class of lie this
task exists to remove, reintroduced one layer deeper.

**After**: the guard is `if (visitedPrograms.size === 0)`
(`type-script-diagnostics-provider.ts:178`). "At least one program was built" is
now tracked as a condition strictly distinct from "errors occurred", and the two
causes are distinguished in the reason
(`type-script-diagnostics-provider.ts:182-185`):

- errors present -> `errors.join('; ')` (unchanged wording, so the existing
  malformed-tsconfig spec still passes on its original reason).
- no errors -> `'No tsconfig produced a compilable project (all discovered
configs were reference-only with no resolvable root files).'`

The file header doc comment (`type-script-diagnostics-provider.ts:9-11`) was
updated to state the new invariant: `available` + zero diagnostics can now only
mean "checked, and clean".

Guard does not misfire on the normal path: with Task 9.1 landed, a solution-style
root recurses into its children, those children build programs, and
`visitedPrograms.size > 0`. Verified by the finding-#1 spec passing (it asserts
`status === 'available'` plus a child diagnostic) rather than tripping the new
unavailable branch.

## 4. Task 9.3 — `getRelevantFiles` propagates resolved failures

**File**: `D:/projects/ptah-extension/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/core-namespace.builders.ts:162-170`

`ContextOrchestrationService.getFileSuggestions` catches internally and
**resolves** with `{ success: false, error: { code, message } }`
(`libs/backend/workspace-intelligence/src/context/context-orchestration.service.ts:439-451`),
so only the thrown half of the requirement was implemented; resolved failures
degraded to `[]`.

Added at `core-namespace.builders.ts:166-170`, before `result.files` is consumed:

```ts
if (result.success === false) {
  throw new Error(result.error?.message ?? 'getFileSuggestions failed for query.');
}
```

`getRelevantFiles` stays fuzzy — it still delegates to
`contextOrchestration.getFileSuggestions`; no glob conversion. `findFiles` was
not touched.

**One deliberate detail worth review attention**: the check is
`result.success === false`, not `!result.success`. This is the literal
requirement from context.md §1 and tasks.md Task 2.2 ("propagate ...
`{ success: false }` failures"), and it is load-bearing here: two
previously-green specs
(`core-namespace.builders.spec.ts:391` and `:441`) use partial mocks shaped
`{ files: [...] }` / `{ files: [] }` with **no** `success` field. A truthiness
check would have made both of those reject and would have regressed two green
tests. `GetFileSuggestionsResult.success` is a required `boolean` in the real
contract (`context-orchestration.service.ts:161`), so in production the two
forms are equivalent; the strict comparison is the one that does not require
touching green specs.

---

## 5. Verification commands and results

| Command                                                                                                                                                                                 | Result                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `npx nx test workspace-intelligence --skip-nx-cache` (baseline, pre-edit)                                                                                                               | **2 failed**, 884 passed, 886 total — red baseline confirmed                       |
| `npx nx test vscode-lm-tools --skip-nx-cache` (baseline, pre-edit)                                                                                                                      | **1 failed**, 815 passed, 816 total — red baseline confirmed                       |
| `npx nx test workspace-intelligence --skip-nx-cache` (post-fix)                                                                                                                         | 36 suites passed, **886 passed / 886 total**, 0 failed, 0 skipped                  |
| `npx nx test vscode-lm-tools --skip-nx-cache` (post-fix)                                                                                                                                | 42 suites passed, **816 passed / 816 total**, 0 failed, 0 skipped                  |
| `npx nx run-many -t typecheck -p platform-core,platform-vscode,platform-electron,platform-cli,workspace-intelligence,vscode-lm-tools,cli-engine,ptah-electron,ptah-cli --skip-nx-cache` | `Successfully ran target typecheck for 9 projects` — **9/9 pass**                  |
| `npx nx run-many -t test -p workspace-intelligence,vscode-lm-tools,platform-vscode,cli-engine --skip-nx-cache`                                                                          | `Successfully ran target test for 4 projects` — **zero failures**                  |
| `npx nx run-many -t lint -p workspace-intelligence,vscode-lm-tools --skip-nx-cache`                                                                                                     | `Successfully ran target lint for 2 projects` — 0 errors, 13 pre-existing warnings |

Note on `--testPathPattern`: Nx forwards it, but the configured Jest run in these
projects executes the full project suite regardless, so the two commands in the
batch brief effectively ran every spec in each project. That is strictly
stronger than the requested filter and is what the numbers above report.

**No-regression check**: baseline totals were workspace-intelligence 886 and
vscode-lm-tools 816. Post-fix totals are identical (886 / 816) with zero
failures, so all previously-green tests remain green and no test was added,
removed, or skipped by this batch.

Lint warnings are pre-existing and untouched by this batch — the two in the
changed provider file (`36:5`, `102:11`, "Unused eslint-disable directive") sit
on the two `require(...)` lines that Batch 5 wrote and that Batch 9 did not
modify; their line numbers shifted only because the header doc comment grew by
two lines.

---

## 6. Assertion integrity

**No red assertion was weakened, softened, skipped, or deleted.** No spec file
was modified in this batch at all — the only two files changed are:

- `D:/projects/ptah-extension/libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.ts`
- `D:/projects/ptah-extension/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/core-namespace.builders.ts`

All three EXPECTED RED cases now pass against their original, unmodified
assertions.

---

## 7. Scope discipline

Explicitly **not** changed, per the batch brief's out-of-scope list — and none
of them turned out to be load-bearing for making a red spec pass:

- 200-result cap on tsconfig discovery (`type-script-diagnostics-provider.ts:71-76`) — untouched.
- Vestigial `.next` walk in `flattenDiagnostic` — untouched. Confirmed inert
  during this work: it does not affect any of the three fixes, and real message
  flattening continues through `ts.flattenDiagnosticMessageText`.
- Hand-rolled `path.relative` containment vs. `isPathWithinRoots` — untouched in
  both diagnostics adapters.

Also respected: no shell/`tsc` subprocess (in-process compiler API only, the
recursion added is a plain function call), no Nx process execution from library
code, no frontend changes, no adapter dependency introduced into
workspace-intelligence (`IFileSystemProvider` from `platform-core` remains the
only injected port), `catch (error: unknown)` narrowing preserved, no
`@ts-ignore` added. Nothing was committed to git.

---

VERDICT: PASS
