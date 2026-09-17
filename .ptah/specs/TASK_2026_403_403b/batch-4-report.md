# Batch 4 report — the cross-checkout visibility seam

Task: `TASK_2026_403_403b`, Batch 4 (Tasks 4.1 – 4.7)
Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-id-suffix` (branch `fix/task-id-suffix`)
Nothing was committed, stashed, or reset. `npx nx reset` was NOT run.

---

## OUTSTANDING — one Batch 4 gate is not met, and no batch owns the files

Batch 4's verification list includes:

> Repo-wide grep: the retired phrase `zero-padded to three digits` returns nothing
> outside git history (this closes the check Batch 3 could only run partially)

**It still returns 14 hits.** All 14 are in `.codex\agents\*.toml`, which appear in
NO batch's owned-file list — Batch 3 owned `.claude\agents\*.md` (15 files) and the
decomposition did not know a second rendered copy of the same agent bodies exists.

```
./.codex/agents/backend-developer.toml:47
./.codex/agents/code-logic-reviewer.toml:48
./.codex/agents/code-style-reviewer.toml:48
./.codex/agents/devops-engineer.toml:47
./.codex/agents/modernization-detector.toml:47
./.codex/agents/project-manager.toml:47
./.codex/agents/researcher-expert.toml:47
./.codex/agents/senior-tester.toml:47
./.codex/agents/software-architect.toml:47
./.codex/agents/team-leader.toml:47
./.codex/agents/technical-content-writer.toml:47
./.codex/agents/ui-ux-designer.toml:47
./.codex/agents/video-director.toml:47
./.codex/agents/visual-reviewer.toml:48
```

I did NOT edit them, for two reasons:

1. They are outside Batch 4's ownership, and the batch's shared executor rules
   forbid touching a file another batch owns or that no batch assigned.
2. **They are generated, not source.** Every one carries `# source: ptah` on line 1
   and is a `harness-sync` manifest-owned mirror of `~/.ptah/user/agents/*`
   (root `CLAUDE.md`: "One reconciler: user layer → every AI tool's harness dirs …
   as manifest-owned copies"). The upstream body lives in the user's home
   directory, outside this repository. Hand-editing the repo copy would be
   reverted by the next `harness reconcile`, so it is the wrong fix in kind, not
   just out of scope.

**Decision needed from the orchestrator**, one of:

- (a) Accept the 14 hits: `.codex/agents/**` is a generated mirror and the grep
  gate should be scoped to source (`.claude/agents/**` was the source Batch 3
  owned and it is clean). Narrow the gate wording and close the task.
- (b) File a follow-up task that fixes the phrase at its real source
  (`~/.ptah/user/agents/*`, plus `renderTaskSpecAgentBlock()` if these were
  rendered from it) and re-runs `harness reconcile` so the mirrors regenerate.
- (c) Extend some batch's ownership to `.codex\agents\*.toml` and hand-edit the
  14 files, accepting that a later reconcile may overwrite them.

Everything else in Batch 4's verification list is green — see below.

---

## Tasks completed

| Task | Status | Note |
| --- | --- | --- |
| 4.1 `ITaskFolderVisibility` port + token + NoOp | done | |
| 4.2 `GitTaskFolderVisibility` + spec | done | 5 failure branches + 2 parsers driven; no real git spawn |
| 4.3 DI tokens, registration, public barrel | done | see deviation D-2 |
| 4.4 `TaskWriterService.create` — union once, fresh suffix per attempt | done | |
| 4.5 4th-argument fan-out | done | re-grepped: **11 sites / 7 files**, matching R-1, not the plan |
| 4.6 Verify the mirrored spawner symbol | done | pinned as a string literal |
| 4.7 Registry banner + `task-specs` CLAUDE.md | done | `registry-generator.service.spec.ts` read first; no pinned phrase broken |

---

## Files

### CREATED

- `D:\projects\ptah-extension\.claude-worktrees\task-id-suffix\libs\backend\task-specs\src\lib\task-folder-visibility.port.ts`
  — `ITaskFolderVisibility` (`listBeyondWorkspace`, contract "never throws"),
  `TASK_FOLDER_VISIBILITY_TOKEN = Symbol.for('TaskSpecsFolderVisibility')`,
  `@injectable() NoOpTaskFolderVisibility`. `tsyringe` is the only import.
- `D:\projects\ptah-extension\.claude-worktrees\task-id-suffix\libs\backend\task-specs\src\lib\git-task-folder-visibility.service.ts`
  — the git-backed reader plus the two pure parsers
  `specFolderNamesFromLsTree` / `specDirsFromWorktreeList`, and the constants
  `VISIBILITY_CACHE_TTL_MS` (60 000), `FETCH_TIMEOUT_MS` (5 000),
  `SDK_PROCESS_SPAWNER_TOKEN`, `VISIBILITY_EXEC_GIT_TOKEN`.
- `D:\projects\ptah-extension\.claude-worktrees\task-id-suffix\libs\backend\task-specs\src\lib\git-task-folder-visibility.service.spec.ts`
  — 24 cases: both parsers (NUL form, `bare`/`detached` blocks, dedup), the five
  failure branches, the cache, the spawner pass-through, the mirrored-symbol pin
  and the DI resolution.

### MODIFIED

- `…\libs\backend\task-specs\src\lib\task-writer.service.ts` — 4th constructor
  parameter `@inject(TASK_FOLDER_VISIBILITY_TOKEN)`; ONE
  `visibility.listBeyondWorkspace(root)` call placed BEFORE the retry loop and
  unioned with the per-attempt local `listFolderNames`. `MAX_CREATE_ATTEMPTS`,
  the `ID_ALLOCATION_EXHAUSTED` path and the exclusive-claim CAS are unchanged.
  No new `catch` was added.
- `…\libs\backend\task-specs\src\lib\di\tokens.ts` — the NOTE now names both
  seam tokens declared beside their interfaces. `TASK_SPECS_TOKENS` unchanged.
- `…\libs\backend\task-specs\src\lib\di\register.ts` — `GitTaskFolderVisibility`
  registered as a singleton behind `TASK_FOLDER_VISIBILITY_TOKEN`, same shape and
  same place as the `TASK_INDEX_NOTIFIER_TOKEN` binding. **No `apps\**` file was
  touched for registration.**
- `…\libs\backend\task-specs\src\index.ts` — added `randomIdSuffix`,
  `TASK_ID_SUFFIX_RE`, `ITaskFolderVisibility`, `TASK_FOLDER_VISIBILITY_TOKEN`,
  `NoOpTaskFolderVisibility`, `GitTaskFolderVisibility`.
- `…\libs\backend\task-specs\src\lib\registry-generator.service.ts` — the
  "CORRECT ALLOCATION" banner line now states the union rule and the
  `TASK_YYYY_NNN_xxxx` shape. `fail-if-exists mkdir`, `DERIVED, NOT
  AUTHORITATIVE` and `NEVER ALLOCATE A TASK ID FROM THIS FILE` — the three
  strings `registry-generator.service.spec.ts:110,111,115` pins — are preserved
  verbatim, so no pinned expectation needed updating (R-6 resolved by reading,
  not by editing).
- `…\libs\backend\task-specs\CLAUDE.md` — Purpose line, helper list, `id-allocator`
  description; added `id-suffix.ts`, `task-folder-visibility.port.ts` and
  `git-task-folder-visibility.service.ts` to Internal Structure, the new names to
  Public API, and three Guidelines bullets (the union-once rule, the never-throws
  + marker rule, and the mirrored-symbol rule).
- The 4th-argument fan-out (7 files, 11 sites):
  - `…\libs\backend\task-specs\src\lib\task-writer.service.spec.ts` (2 sites)
  - `…\libs\backend\task-specs\src\lib\task-writer.create-race.spec.ts` (1 site)
  - `…\libs\backend\task-specs\src\lib\task-writer.metadata.spec.ts` (3 sites)
  - `…\libs\backend\task-specs\src\lib\task-writer.conflict.integration.spec.ts` (3 sites)
  - `…\libs\backend\task-specs\src\lib\task-doctor.service.spec.ts` (1 site)
  - `…\apps\ptah-cli\src\cli\commands\ptah-spec.spec.ts` (1 site — the R-1 site
    the plan missed; imports `NoOpTaskFolderVisibility` from
    `@ptah-extension/task-specs`, which Task 4.3 exports)

**Re-grep of `new TaskWriterService(` before editing** (as instructed — the
inventory was not trusted) returned exactly the 11 sites R-1 predicted, at the
line numbers it gave. The plan's "9 sites / 6 files" is wrong; R-1 is right.

---

## Behavioural coverage added

`task-writer.service.spec.ts` — new describe block "allocates against the
cross-checkout union", the four cases the batch required:

- (a) local holds `TASK_<YEAR>_001`, the fake returns `TASK_<YEAR>_402_ab12` →
  the id is `TASK_<YEAR>_403_<hex>`.
- (b) the fake returns `[]` → `TASK_<YEAR>_002_<hex>`, identical to Batch 1's
  behaviour.
- (c) `listBeyondWorkspace` called **exactly once** across a 3-attempt EEXIST
  retry while `readDirectory` on the specs dir is called **three times**.
- (d) two attempts produce different suffixes (asserted on the actual folder
  names handed to `createDirectoryExclusive`).

`task-writer.create-race.spec.ts` — one added case: a checkout that can see
`TASK_<YEAR>_001_aaaa` only through the port does not re-propose that number.
This is the regression the whole task exists for: `.ptah/**` is gitignored, the
two folders live on different paths, and the exclusive `mkdir` cannot save it
because both claims succeed.

The five never-throws branches are each driven separately in
`git-task-folder-visibility.service.spec.ts` and each asserts a RESOLVED value —
"returned nothing" and "threw" are otherwise indistinguishable.

---

## Verification

### 1. `npx nx run-many -t test -p @ptah-extension/task-specs ptah-cli`

First, verbatim, as specified:

```
 NX   Running target test for 2 projects:

- @ptah-extension/task-specs
- ptah-cli

...
> nx run ptah-cli:copy-wasm
> node scripts/copy-wasm.js dist/apps/ptah-cli

WASM file not found: D:\projects\ptah-extension\.claude-worktrees\task-id-suffix\node_modules\web-tree-sitter\web-tree-sitter.wasm
Warning: command "node scripts/copy-wasm.js dist/apps/ptah-cli" exited with non-zero status code

 NX   Running target test for 2 projects and 31 tasks they depend on failed

Failed tasks:
- ptah-cli:copy-wasm
```

**This failure is environmental and pre-existing; it is not caused by Batch 4.**
This worktree has no `node_modules` of its own (`ls -ld node_modules` →
"No such file or directory"); `npx` resolves up to
`D:\projects\ptah-extension\node_modules`, where the grammar IS present
(`node_modules/web-tree-sitter/web-tree-sitter.wasm`). `scripts/copy-wasm.js`
looks under the *workspace root*, which for a worktree is the worktree. Batch 4
touches no `project.json` and no build target.

Re-run against the same two projects, dependencies excluded and the build-artifact
gate skipped (both `PTAH_ALLOW_SKIP_UNBUILT=1` and the gate's own error message
document that env var as the supported escape on an unbuilt checkout):

```
$ PTAH_ALLOW_SKIP_UNBUILT=1 npx nx run-many -t test \
    -p @ptah-extension/task-specs ptah-cli \
    --exclude-task-dependencies --skip-nx-cache

 NX   Running target test for 2 projects:

  @ptah-extension/task-specs
Test Suites: 18 passed, 18 total
Tests:       23 skipped, 489 passed, 512 total

  ptah-cli
Test Suites: 1 skipped, 66 passed, 66 of 67 total
Tests:       7 skipped, 981 passed, 988 total

 NX   Successfully ran target test for 2 projects
```

Header reads **2 projects**, as required. The 4 failures seen before setting
`PTAH_ALLOW_SKIP_UNBUILT=1` were all
`build-artifact-gate.ts:49` "`dist/apps/ptah-cli/*.mjs` not found. Run
`nx run ptah-cli:build-*` to build it" — the unbuilt-bundle gate, downstream of
the same missing-`node_modules` problem, and unrelated to this batch.

### 2. `npx nx run-many -t typecheck -p @ptah-extension/task-specs ptah-cli`

```
 NX   Running target typecheck for 2 projects:

- @ptah-extension/task-specs
- ptah-cli

> nx run @ptah-extension/task-specs:typecheck
> tsc --noEmit --project libs/backend/task-specs/tsconfig.lib.json

> nx run ptah-cli:typecheck
> tsc --noEmit --project apps/ptah-cli/tsconfig.app.json

 NX   Successfully ran target typecheck for 2 projects
```

Ran clean, with no flags. (`tsconfig.lib.json` excludes specs; the spec files are
type-checked by `ts-jest` in the test run above, which passed.)

### 3. `npx nx run-many -t lint -p @ptah-extension/task-specs ptah-cli`

```
 NX   Running target lint for 2 projects:
...
✖ 125 problems (0 errors, 125 warnings)

 NX   Successfully ran target lint for 2 projects
```

**0 errors** — including `@nx/enforce-module-boundaries`, which is the mechanical
proof that no new lib dependency edge was added and specifically that `task-specs`
still has no `agent-sdk` edge.

Scoped to the lib under change:

```
Linting "@ptah-extension/task-specs"...

libs\backend\task-specs\src\lib\task-writer.create-race.spec.ts
  33:8  warning  'MockFileSystemProvider' is defined but never used.  @typescript-eslint/no-unused-vars

✖ 1 problem (0 errors, 1 warning)
```

That one warning is **pre-existing at `HEAD`** (verified with
`git show HEAD:…create-race.spec.ts | grep -n MockFileSystemProvider` → line 33).
Left untouched — see Out-of-scope observations.

### 4. `npx nx run degradation-audit:lint`

```
  libs/backend/task-specs: 12 ok (baseline 12)
...
degradation-audit: TOTAL 303 unsuppressed site(s)

 NX   Successfully ran target lint for project degradation-audit
```

`libs/backend/task-specs` stays at its baseline of 12
(`tools\degradation-audit\baseline.json:33`), because all four new degrading
catches carry a `// degradation-audit: reported — <code>` marker with a reason:

| Catch | Code | Marker |
| --- | --- | --- |
| `worktreeSpecDirs` | `task-visibility.worktree-list-failed` | yes |
| `fetchOriginMain` | `task-visibility.fetch-failed` | yes |
| `remoteSpecFolderNames` | `task-visibility.ls-tree-failed` | yes |
| `scanSpecsDir` | `task-visibility.worktree-scan-failed` | yes |

Each also emits one `logger.warn` naming the step and one
`degradationReporter?.report({ source: 'workspace', code, severity: 'degraded', … })`.
`code` is typed as the closed union `VisibilityDegradationCode`, so every call
site passes a string literal and an interpolated code is a **compile error**, not
a convention. `DegradationSource` was NOT widened; `'workspace'` is the honest fit.

### 5. Repo-wide grep — **NOT MET**, see the OUTSTANDING section above

```
$ grep -rn "zero-padded to three digits" .   # excluding node_modules, .git, this task folder
→ 14 hits, all in .codex/agents/*.toml
```

Zero hits under `libs\`, `apps\`, `.claude\`, or the repo-root `CLAUDE.md`.

### 6. `git status --short`

```
 M apps/ptah-cli/src/cli/commands/ptah-spec.spec.ts
 M libs/backend/task-specs/CLAUDE.md
 M libs/backend/task-specs/src/index.ts
 M libs/backend/task-specs/src/lib/di/register.ts
 M libs/backend/task-specs/src/lib/di/tokens.ts
 M libs/backend/task-specs/src/lib/registry-generator.service.ts
 M libs/backend/task-specs/src/lib/task-doctor.service.spec.ts
 M libs/backend/task-specs/src/lib/task-writer.conflict.integration.spec.ts
 M libs/backend/task-specs/src/lib/task-writer.create-race.spec.ts
 M libs/backend/task-specs/src/lib/task-writer.metadata.spec.ts
 M libs/backend/task-specs/src/lib/task-writer.service.spec.ts
 M libs/backend/task-specs/src/lib/task-writer.service.ts
?? .ptah/specs/TASK_2026_403_403b/agent-output-batch-1.md
?? .ptah/specs/TASK_2026_403_403b/agent-output-codex.md
?? .ptah/specs/TASK_2026_403_403b/agent-output-root.md
?? libs/backend/task-specs/src/lib/git-task-folder-visibility.service.spec.ts
?? libs/backend/task-specs/src/lib/git-task-folder-visibility.service.ts
?? libs/backend/task-specs/src/lib/task-folder-visibility.port.ts
```

The three `agent-output-*.md` files are not mine — they predate this batch and
were untracked when I started. Every source path listed is inside Batch 4's owned
set, and the only `apps\**` file modified is
`apps\ptah-cli\src\cli\commands\ptah-spec.spec.ts`, as the batch permits.

---

## Hard rules — compliance

- `execGit` reused from `@ptah-extension/vscode-core`; `parseWorktreeList` reused
  from `@ptah-extension/shared`. **No second porcelain parser was written.**
- No `node:child_process` anywhere in the new files.
- No new lib dependency edge: imports are `tsyringe`, `node:path`,
  `@ptah-extension/platform-core`, `@ptah-extension/vscode-core`,
  `@ptah-extension/shared` — every one already an edge of `task-specs`.
  No `agent-sdk` import; the spawner is reached by mirrored symbol description
  with `{ isOptional: true }`.
- **No test spawns a real git process.** Every branch is driven through the
  injected exec fake.
- Every degrading catch: marker + literal-code reporter call (table above).
- `catch (error: unknown)` at all four sites, narrowed with `instanceof Error`
  via the file-local `describe(error)` helper.
- kebab-case filenames.
- No commit, no `git stash`, no `npx nx reset`.

---

## Plan deviations

**D-1 — the exec seam needed a DI token, not a bare defaulted parameter.**
The plan says "Extract the exec as a constructor-injected function reference
defaulting to the imported `execGit`". A plain undecorated trailing parameter does
not work under tsyringe: `@injectable()` emits `design:paramtypes` for EVERY
constructor parameter, a function-typed one erases to `Function`, and tsyringe's
`construct` throws `TypeInfo not known for "Function"` — so
`container.resolve(GitTaskFolderVisibility)` would have failed at runtime in all
three hosts while every direct-construction spec passed. I added a file-local
`VISIBILITY_EXEC_GIT_TOKEN = Symbol.for('TaskSpecsVisibilityExecGit')`, injected
`{ isOptional: true }`, which no host registers, so it resolves `null` and the
constructor falls back to the imported `execGit`. Verified unused elsewhere in
the repo before adding. It is **not exported from the barrel** — Task 4.3
enumerates the barrel additions and this is not one of them.

**D-2 — the DI assertions live in the git service spec, not a new `di/register.spec.ts`.**
Component 6 says "extend the lib's DI registration spec (or add one)". The lib has
no `di/register.spec.ts`, and creating one would add a file outside Batch 4's
owned list. Both required assertions are therefore in
`git-task-folder-visibility.service.spec.ts`, which IS owned:
`SDK_PROCESS_SPAWNER_TOKEN.description === 'SdkProcessSpawner'` (the R-8 literal
pin), and `TASK_FOLDER_VISIBILITY_TOKEN` resolving to a `GitTaskFolderVisibility`
singleton from a container carrying only `TOKENS.LOGGER` and
`PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER`, plus a third case proving a host-bound
spawner reaches the instance.

**D-3 — the spec fixtures use the CURRENT year, not a literal `2026`.**
The batch text spells the cases with `TASK_2026_*`. `allocateTaskId` defaults its
`year` argument to `new Date().getFullYear()`, and the surrounding specs already
use a `YEAR` constant for exactly this reason, so hard-coding `2026` would make
the suite start failing on 1 Jan 2027. The semantics are identical.

**D-4 — the test/typecheck/lint commands were run as written; only the `test` one
needed flags to get past a pre-existing worktree environment defect.** Documented
in full under Verification §1. No production behaviour depends on it.

**D-5 — case (d) is probabilistic by construction.** "Two attempts produce
different suffixes" draws twice from 65 536 values, so it collides once in 65 536
runs. Any seam that made it deterministic would stop testing the real generator.
The residual is noted in a comment at the assertion.

---

## Out-of-scope observations (NOT touched)

1. **`scripts/copy-wasm.js` is worktree-hostile.** It resolves
   `<workspaceRoot>/node_modules/web-tree-sitter/…`, which does not exist in a
   `git worktree` checkout that shares the main clone's `node_modules`. Result:
   `ptah-cli:copy-wasm` fails, which fails `ptah-cli:build`, which fails
   `ptah-cli:test` for anyone running the batch's literal verification command in
   a worktree. Worth a `require.resolve('web-tree-sitter/package.json')` lookup
   instead of a path join. Owned by `devops-engineer`, not this batch.
2. **`task-writer.create-race.spec.ts:33`** imports `type MockFileSystemProvider`
   and never uses it (pre-existing at `HEAD`, a lint warning). One-line delete,
   but it is Batch 1's line, not Batch 4's change.
3. **`.codex/agents/*.toml` are committed generated artifacts.** Fifteen files
   whose upstream source is `~/.ptah/user`, tracked in git with a `# source: ptah`
   header. Any prose change to an agent body has to be made twice, or the mirror
   silently rots — which is exactly what happened here. Whether they should be
   tracked at all is a question worth its own task.
4. **`libs/frontend/editor` has a stale degradation baseline entry** (`0 ok
   (baseline 2) — directory not found by this scan`). Reported by the audit
   itself; needs `--update-baseline`. Nothing to do with this batch.
