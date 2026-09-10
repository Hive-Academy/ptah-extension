# Implementation Plan - TASK_2026_403_403b

## Inputs and constraints

- Requirements used:
  - `D:\projects\ptah-extension\.claude-worktrees\task-id-suffix\.ptah\specs\TASK_2026_403_403b\task.md`
  - `D:\projects\ptah-extension\.claude-worktrees\task-id-suffix\.ptah\specs\TASK_2026_403_403b\context.md`
  - Root `CLAUDE.md`, `libs/backend/task-specs/CLAUDE.md`, `libs/backend/vscode-core/CLAUDE.md`,
    `libs/backend/platform-core/CLAUDE.md`, `libs/shared/CLAUDE.md`
- Corrections applied: none
- Design handoff used: none (no UI surface changes)
- Missing decision-critical input: none. One input the context assumed and this plan
  **verified instead**: `.ptah/specs/` is TRACKED in git, not ignored
  (`.gitignore:131` `.ptah/**` then `:134-135` `!.ptah/specs/` / `!.ptah/specs/**`), and
  `git ls-tree --name-only origin/main .ptah/specs/` returns 176 entries in this worktree.
  Without that the whole `origin/main` half of the design would be dead code.

## Codebase evidence

| Evidence                                                                                                                                 | Location                                                                            | Architectural implication                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TASK_FOLDER_RE = /^TASK_(\d{4})_(\d+)/` is **unanchored at the end**; docblock pins `TASK_2026_146_ORCHESTRA` as 146                     | `libs/backend/task-specs/src/lib/id-allocator.ts:12`, doc `:4-10`, spec `:20-24`     | Verified. The SCAN half already tolerates suffixes. Only the EMIT (`:32`) changes. No parser rewrite.                                                     |
| `allocateTaskId(await this.listFolderNames(specsDir))` inside a 5-attempt claim loop, re-scanning per attempt                             | `libs/backend/task-specs/src/lib/task-writer.service.ts:270-289`                     | Verified. The union must be computed ONCE outside the loop; only the local re-scan may stay inside, or every retry pays a network fetch.                  |
| `createDirectoryExclusive` is the only compare-and-swap the FS port has; EEXIST is the lock                                              | `libs/backend/task-specs/src/lib/task-writer.service.ts:261-289`, `135-142`          | Verified. The suffix does not replace the lock — it makes losing the race almost impossible, and the lock stays as the correctness guarantee.             |
| `listFolderNames` swallows every failure and returns `[]`                                                                                | `libs/backend/task-specs/src/lib/task-writer.service.ts:798-808`                     | Verified. Established degrade-to-local shape; the git union must degrade the same way.                                                                   |
| `execGit(args, cwd, {timeoutMs, spawner})` — the repository's one git exec seam, `IProcessSpawner` optional                              | `libs/backend/vscode-core/src/utils/exec-git.ts:86-115`, `321-328`                   | Verified. A backend lib gets git without importing `node:child_process`. `task-specs` already depends on `vscode-core`.                                   |
| `IProcessSpawner` is a type-only port in `platform-core`, no token                                                                       | `libs/backend/platform-core/src/interfaces/process-spawner.interface.ts:19-20,79-82` | Verified. Typing against it adds no dependency edge.                                                                                                     |
| Electron binds the off-thread spawner under `SDK_TOKENS.SDK_PROCESS_SPAWNER = Symbol.for('SdkProcessSpawner')` and hands it to git       | `libs/backend/agent-sdk/src/lib/di/tokens.ts:51`, `apps/ptah-electron/src/di/phase-4-handlers.ts:102-111` | Verified. `child_process.spawn` runs `CreateProcessW` on the calling thread; a new inline git spawn on the Electron main thread reopens a closed defect. |
| Cross-lib token MIRRORING by symbol, injected `{isOptional:true}`, is the sanctioned way to reach an `agent-sdk` binding without importing it | `libs/backend/skill-synthesis/src/lib/di/tokens.ts:48-64`                            | Verified. Precedent for `task-specs` mirroring `Symbol.for('SdkProcessSpawner')`.                                                                       |
| `parseWorktreeList(stdout)` already parses `git worktree list --porcelain`, in `libs/shared`, zero-dep                                    | `libs/shared/src/lib/utils/git.utils.ts:23-65`; consumers `git-info.service.ts:419`, `git-namespace.builder.ts:86` | Verified. Reuse it. Do not write a second porcelain parser.                                                                                             |
| `GIT_INFO_SERVICE` is registered ONLY by Electron                                                                                        | `apps/ptah-electron/src/di/phase-4-handlers.ts:111-114`; absent from `vscode-core/src/di/register*.ts` | Verified. `GitInfoService` cannot be the union's git source — VS Code and CLI would silently lose it.                                                    |
| Narrow port + token + `NoOp` null object, declared beside the interface, is this lib's existing seam pattern                              | `libs/backend/task-specs/src/lib/task-index.port.ts:14-27`                           | Verified. The union seam copies it exactly rather than inventing a shape.                                                                               |
| `\b` after `\d{3}` cannot match before `_` (a word character)                                                                            | `libs/backend/skill-synthesis/src/lib/subagent-metrics-extractor.ts:46,48`           | Verified. A suffixed id matches NEITHER regex — attribution silently returns `null`, not a wrong value.                                                  |
| The extractor UPPERCASES its result (`:64`, `:70`), while `taskIdFromVerdictSource` does not normalize case at all                        | `subagent-metrics-extractor.ts:64,70`; `skill-scorecard.service.ts:275-281,169`      | Verified. Two producers write one `task_id` column. A lowercase-hex suffix makes them disagree — invisible today because every id is uppercase.           |
| `isSingleTaskPathSegment` constrains separators/`:`/NUL only — no shape                                                                  | `libs/shared/src/lib/types/task-view.types.ts:60-71`; schema `task-view.schemas.ts:26-29` | Verified. The ONLY zod validation of a task id needs no change.                                                                                          |
| `id_mismatch` is an exact `rawId !== folderName` compare and the writer renders `id: claimedId`                                          | `task-frontmatter.ts:308-316`; `task-writer.service.ts:306-328`                      | Verified. A suffixed folder produces a suffixed `id:` — no new warning.                                                                                  |
| Doctor scopes with `/^TASK_/`; registry sorts by `folderName.localeCompare`                                                              | `task-doctor.service.ts:73,703`; `registry-generator.service.ts:76-84`               | Verified. Both suffix-safe.                                                                                                                             |
| `ptah_task_create` forwards args verbatim to `ptahAPI.tasks.create`; the board calls `rpc.call('tasks:create', …)` with no id             | `protocol-dispatcher.ts:1670-1673`; `tasks-store.service.ts:1522-1539`               | Verified. Neither surface allocates or parses an id. Both keep working unchanged; only a description STRING mentions the format.                          |
| `.claude/agents` is a harness SOURCE — `harness-sync` writes nothing there; no script regenerates it                                     | `harness-sync/src/lib/targets/claude-target.ts:13,93`; `manifest/desired-state.types.ts:38-39` | Verified. The 15 deployed agent files are past OUTPUT of `renderTaskSpecAgentBlock()` with markers stripped; they must be hand-edited beside the source. |
| `renderTaskSpecAgentBlock()` is the generator source, resolved as the `TASK_SPEC_CONTRACT` partial                                       | `libs/shared/src/lib/types/task-spec.contract.ts:502-530`; `agent-generation/src/lib/services/template-partial-resolver.ts:58,74` | Verified. Edit the renderer FIRST; the agent `.md` files are its rendered copy and must match it.                                                        |
| Orchestration SKILL carries a hard regex gate `/^TASK_\d{4}_\d{3}$/`                                                                     | `.claude/skills/orchestration/SKILL.md:130`; plugin copy same file `:130`            | Verified. A suffixed id routes to NEW_TASK instead of CONTINUATION. Not mentioned in the task brief — a real break.                                       |
| The plugin asset tree is hash-gated in CI                                                                                                | `scripts/generate-content-manifest.js:25-27,321-326`; `package.json:66-67`           | Verified. Editing a plugin file without `npm run manifest:generate` fails `manifest:check`.                                                              |
| A `catch` that falls back to a default must emit a `DegradationEvent` or carry a `// degradation-audit:` marker; the ratchet FAILS on any increase | `vscode-core/CLAUDE.md` "When a `catch` may degrade"; `tools/degradation-audit/check-degradation.ts:58-60`; `baseline.json:33` (`libs/backend/task-specs: 12`) | Verified. Three new degrading catches land in `task-specs`. Unmarked, they fail CI.                                                                     |
| `TOKENS.DEGRADATION_REPORTER` is injected `{isOptional:true}` at its one existing backend site                                            | `libs/backend/persistence-sqlite/src/lib/backup.service.ts:180`                      | Verified. Follow that shape. `DegradationSource` has no `tasks` member (`rpc-degradation.types.ts:40-52`).                                               |
| `TaskWriterService` is constructed POSITIONALLY at 9 sites across 6 spec files                                                            | `task-writer.service.spec.ts:29,342`; `create-race:63`; `metadata:124,791,802`; `conflict.integration:158,267,406`; `task-doctor.service.spec.ts:36` | Verified. A 4th constructor parameter is a mechanical 6-file spec edit — budget for it rather than making the seam optional.                             |

## Architecture decision

- **Chosen approach**: keep `allocateTaskId` a pure total function and give it BOTH new
  inputs as parameters — the folder-name union it already takes, and the four-hex
  discriminator as a required `suffix: string`. Randomness moves into a one-function
  sibling module (`randomIdSuffix`). The cross-checkout folder-name union moves behind a
  narrow port in `task-specs` (`ITaskFolderVisibility`), copied from the lib's existing
  `task-index.port.ts` seam, whose single git-backed implementation drives git through
  `execGit` from `vscode-core` and `parseWorktreeList` from `libs/shared`. The writer
  computes the union ONCE per `create`, re-scans only the local folder inside the retry
  loop, and draws a FRESH suffix on every attempt.

- **Rationale**:
  - The allocator's scan regex is already suffix-tolerant and pinned as such
    (`id-allocator.ts:12`, spec `:20-24`), so the change is one template literal plus one
    parameter, not a parser rewrite.
  - A required `suffix` parameter is what makes the function testable without mocking a
    clock or a RNG, and — more importantly — makes it impossible for a call site to get
    nondeterminism by accident. A defaulted generator would silently reintroduce it.
  - `execGit` is the repository's existing git seam: it already honours the
    `IProcessSpawner` port, pins the C locale and `GIT_OPTIONAL_LOCKS=0`, and owns
    timeout + tree-kill (`exec-git.ts:80-115`). Re-implementing git access in `task-specs`
    with `node:child_process` would violate the hexagonal rule stated in root `CLAUDE.md`;
    calling `execGit` does not, because the process concern is already behind a port there.
  - A port + `NoOp` in `task-specs` keeps `TaskWriterService` ignorant of git entirely.
    The writer's dependency stays "somebody can tell me which folder names exist
    elsewhere", which is the only fact it needs.

- **Rejected alternatives**:
  - _Inject `GitInfoService` (`vscode-core`) into the writer._ Loses on evidence:
    `TOKENS.GIT_INFO_SERVICE` is bound only in `apps/ptah-electron/src/di/phase-4-handlers.ts:111`.
    VS Code and the CLI would resolve nothing and the feature would be Electron-only
    without saying so.
  - _Add a `listWorktreeSpecFolders` method to `GitInfoService`._ Same registration
    problem, plus it puts a task-spec concern in a general git service that already runs
    ~1000 lines.
  - _New `IGitReader` port in `platform-core` with three adapter implementations._
    `platform-core` is a leaf with no `child_process` dependency by design
    (`process-spawner.interface.ts:19-20`); adding a git port would mean three adapters
    for one caller. `execGit` already IS the shared implementation and already takes the
    spawner port.
  - _Suffix from `Date.now()` or a counter._ Two branches created in the same millisecond,
    or two checkouts with independent counters, collide again — which is the defect.
  - _Longer suffix / UUID._ The folder name is read aloud and typed by humans and agents;
    four hex characters give 65 536 values against a realistic per-number contention of
    2-3 branches. The `mkdir` lock still covers the residue.
  - _Optional 4th writer constructor parameter to avoid editing 6 spec files._ Rejected
    explicitly: an unbound seam would degrade to local-only scanning with no signal, which
    is the exact failure this task exists to remove.

- **Assumptions**:
  1. The mainline branch is `origin/main`. Resolve by: `git ls-tree origin/main` exits
     non-zero on a repository whose default branch is named otherwise, and the union then
     degrades to local + worktrees. If the implementer wants coverage there, the check is
     `git symbolic-ref --quiet refs/remotes/origin/HEAD` — but it is unset on most clones,
     so it is NOT part of this plan.
  2. `workspaceRoot` is the git repository (or worktree) root, so the `.ptah/specs/`
     pathspec resolves. Resolve by: run the union against a workspace opened on a
     SUBDIRECTORY of a repo — `ls-tree` returns nothing and the union degrades. Acceptable
     and self-healing; not worth `--show-toplevel` and a fourth spawn.
  3. `git ls-tree` on a folder pathspec is non-recursive, so every returned entry is
     `.ptah/specs/<name>` at depth 1. Resolve by: the `-z` form asserted in the parser's
     unit test. Measured in this worktree: 176 entries, all depth 1.

- **Effect on existing code**:
  - REPLACED in place: `allocateTaskId`'s emit line and signature; the id-allocation step
    of `TaskWriterService.create`; the two regexes and the case-normalization in
    `subagent-metrics-extractor.ts`; the allocation rule text everywhere it is stated.
  - LEFT ALONE: `adoptFolder`, `updateStatus`, `updateMetadata`, `applyFrontmatterPatch`,
    the scanner, the doctor, the sweeper, the registry generator's ordering, the index
    store schema, `isSingleTaskPathSegment`, every RPC and MCP schema, and both create
    surfaces (`ptah_task_create`, the board dialog).
  - NOT ADDED: no second allocator, no `allocateTaskIdV2`, no compatibility flag, no
    migration. Existing folders are never renamed — the scan regex already reads them.

## Component specifications

### 1. `allocateTaskId` — pure allocator, suffixed emit

- **Purpose**: given every folder name that is known to exist anywhere, and a
  discriminator, produce the next task id.
- **Responsibilities**: scan for the max `NNN` of the requested year (unchanged); emit
  `TASK_${year}_${padded}_${suffix}`; reject a suffix that is not four lowercase hex
  characters.
- **Verified contracts and entry points**:
  - `libs/backend/task-specs/src/lib/id-allocator.ts:12` `TASK_FOLDER_RE` — unchanged.
  - `:14-17` current signature `(folderNames, year = new Date().getFullYear())`.
  - `:32` the emit line — the one behavioural change.
  - Pinned suffix tolerance: `id-allocator.spec.ts:20-24` (`TASK_2026_146_ORCHESTRA` → 147).
  - Only caller: `libs/backend/task-specs/src/lib/task-writer.service.ts:273`.
- **New signature** (positional; `year` keeps its position so the existing spec's third
  argument is the only thing that moves):

  ```ts
  export function allocateTaskId(
    folderNames: readonly string[],
    suffix: string,
    year: number = new Date().getFullYear(),
  ): string;
  ```

  `suffix` is REQUIRED and is validated against `TASK_ID_SUFFIX_RE` (component 2); a
  malformed value throws. That throw is a defect signal, not a runtime path: the writer's
  existing `catch` at `task-writer.service.ts:330-339` maps it to `WRITE_FAILED`, and the
  validation is what makes "the allocator only ever returns a safe single path segment" a
  provable property rather than a convention.
- **Dependencies**: none. Stays import-free and pure — the lib's stated rule
  ("Pure functions take strings (no I/O)", `libs/backend/task-specs/CLAUDE.md`).
- **Integration points**: `TaskWriterService.create` only.
- **Failure behaviour**: throws `Error` on a malformed suffix. Every other input degrades
  as today (unparseable names contribute nothing; no folders → `001`).
- **Quality requirements**: deterministic for a given `(folderNames, suffix, year)`.
  Not applicable: performance, security, accessibility.
- **Verification seam**: the exported function. Every existing case in
  `id-allocator.spec.ts` is re-asserted with a fixed suffix, plus: suffix appears verbatim
  in the output; a legacy `TASK_2026_146_ORCHESTRA` still counts as 146; a suffixed
  `TASK_2026_403_a1f2` counts as 403; malformed suffixes (`''`, `'ABCD'`, `'abcde'`,
  `'xyz1'`) throw.
- **Files**: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-id-suffix\libs\backend\task-specs\src\lib\id-allocator.ts`;
  MODIFY `…\libs\backend\task-specs\src\lib\id-allocator.spec.ts`.

### 2. `id-suffix.ts` — the discriminator producer

- **Purpose**: mint one four-character lowercase-hex discriminator, and own the pattern
  that defines what a valid one is.
- **Responsibilities**: `randomIdSuffix(): string`; `export const TASK_ID_SUFFIX_RE = /^[0-9a-f]{4}$/`.
- **Verified contracts and entry points**: `crypto` is already used inside backend libs
  in this tree (`libs/backend/vscode-core/src/services/git-info.service.ts:9`
  `import { createHash } from 'crypto'`). Use `randomBytes(2).toString('hex')` — exactly
  two bytes, so no slicing and no modulo bias.
- **Dependencies**: `node:crypto` only. Deliberately a SEPARATE file from
  `id-allocator.ts` so the allocator keeps zero imports and stays trivially pure.
- **Integration points**: `allocateTaskId` (validation), `TaskWriterService.create`
  (production).
- **Failure behaviour**: none — `randomBytes` for 2 bytes does not fail in practice; no
  catch, no fallback, so no degradation site.
- **Quality requirements**: uniformly distributed over 65 536 values; lowercase only
  (see component 7 — case matters downstream).
- **Verification seam**: the two exports. Assert 1000 draws all match
  `TASK_ID_SUFFIX_RE`, and that the draw set has more than one member (a stubbed constant
  would pass a shape-only test).
- **Files**: CREATE `…\libs\backend\task-specs\src\lib\id-suffix.ts`;
  CREATE `…\libs\backend\task-specs\src\lib\id-suffix.spec.ts`.

### 3. `task-folder-visibility.port.ts` — the union seam

- **Purpose**: let the writer ask "which task folder names exist outside this checkout's
  own `.ptah/specs`?" without knowing that the answer comes from git.
- **Responsibilities**: declare the interface, the DI token, and the null object.

  ```ts
  export interface ITaskFolderVisibility {
    /**
     * Folder names visible from anywhere BUT this workspace's own
     * `.ptah/specs` directory. The caller unions this with its own local scan.
     * Never throws: an unreachable source contributes nothing.
     */
    listBeyondWorkspace(workspaceRoot: string): Promise<readonly string[]>;
  }
  export const TASK_FOLDER_VISIBILITY_TOKEN = Symbol.for('TaskSpecsFolderVisibility');
  @injectable()
  export class NoOpTaskFolderVisibility implements ITaskFolderVisibility { … }
  ```

- **Verified contracts and entry points**: shape, token placement and the `@injectable()`
  NoOp are copied from `libs/backend/task-specs/src/lib/task-index.port.ts:14-27`, the
  lib's own precedent for a narrow writer-facing seam with a null-object default. Symbol
  descriptions in this lib are globally unique by convention
  (`libs/backend/task-specs/src/lib/di/tokens.ts:1-11`) — `TaskSpecsFolderVisibility` is
  not currently used anywhere.
- **Dependencies**: `tsyringe` only.
- **Integration points**: injected into `TaskWriterService`; bound in
  `registerTaskSpecsServices`; the NoOp is the fixture for specs that do not exercise
  allocation.
- **Failure behaviour**: the interface CONTRACT is "never throws". The NoOp returns `[]`.
- **Quality requirements**: not applicable.
- **Verification seam**: the port is exercised through its two implementations.
- **Files**: CREATE `…\libs\backend\task-specs\src\lib\task-folder-visibility.port.ts`.

### 4. `GitTaskFolderVisibility` — the git-backed union reader

- **Purpose**: the only place in the task-spec subsystem that talks to git.
- **Responsibilities**:
  1. `git worktree list --porcelain` → worktree paths → one `readDirectory` per path on
     `<path>/.ptah/specs` through `IFileSystemProvider`.
  2. `git fetch --quiet origin main` (best effort, short timeout).
  3. `git ls-tree --name-only -z origin/main .ptah/specs/` → basenames.
  4. Deduplicate into one `string[]`; log and report each step that failed.
  5. Cache the result per `workspaceRoot` for `VISIBILITY_CACHE_TTL_MS` (60 000).
- **Verified contracts and entry points**:
  - `execGit(args, cwd, options): Promise<{stdout, stderr, exitCode}>` —
    `libs/backend/vscode-core/src/utils/exec-git.ts:321-328`; exported from the barrel at
    `libs/backend/vscode-core/src/index.ts:101-105`.
  - `ExecGitOptions.timeoutMs` / `.spawner` — `exec-git.ts:86-115`;
    `DEFAULT_GIT_TIMEOUT_MS = 10_000` at `:6`.
  - `parseWorktreeList(stdout): GitWorktreeInfo[]` with `.path` —
    `libs/shared/src/lib/utils/git.utils.ts:23-65`, exported at
    `libs/shared/src/lib/utils/index.ts:7`.
  - `IFileSystemProvider.readDirectory` + `FileType.Directory` — the exact pair
    `TaskWriterService.listFolderNames` already uses (`task-writer.service.ts:798-808`).
  - `IProcessSpawner` type — `platform-core/src/interfaces/process-spawner.interface.ts:79-82`.
  - Spawner token to mirror: `Symbol.for('SdkProcessSpawner')`
    (`libs/backend/agent-sdk/src/lib/di/tokens.ts:51`), bound by Electron at
    `apps/ptah-electron/src/di/phase-4-handlers.ts:102-111`.
  - Degradation reporter injection shape:
    `libs/backend/persistence-sqlite/src/lib/backup.service.ts:180`.
- **Two pure functions exported from the same file** (they are the parts worth unit
  testing, and neither earns its own file under the lib's ~150-line guardrail):
  - `specFolderNamesFromLsTree(stdout: string): string[]` — split on `\0`, drop empties,
    take the segment after the last `/`, keep entries starting with `TASK_`.
  - `specDirsFromWorktreeList(stdout: string): string[]` — `parseWorktreeList` → `.path`
    → `path.join(p, '.ptah', 'specs')`, deduplicated. Git prints forward-slashed Windows
    paths (`worktree D:/projects/ptah-extension`); `path.join` normalises them.
- **Dependencies**: `@ptah-extension/vscode-core` (`execGit`, `Logger`, `TOKENS`) and
  `@ptah-extension/shared` (`parseWorktreeList`) and `@ptah-extension/platform-core`
  (`IFileSystemProvider`, `IProcessSpawner`) — every one of them an EXISTING edge of
  `task-specs` (`libs/backend/task-specs/CLAUDE.md` "Dependencies"). Direction is
  unchanged; no new lib edge, and specifically **no** `agent-sdk` edge: the spawner is
  reached by mirrored symbol, injected `{isOptional: true}`, exactly as
  `skill-synthesis/src/lib/di/tokens.ts:48-64` reaches its two `agent-sdk` bindings.
- **Integration points**: bound to `TASK_FOLDER_VISIBILITY_TOKEN`; consumed only by
  `TaskWriterService.create`.
- **Failure behaviour** — the load-bearing part of this component. **No path throws.**
  Each of the three git steps is independently guarded and contributes nothing on failure:
  - `worktree list` non-zero / throws (no git, not a repo) → no worktree contribution AND
    skip the remote steps, since a non-repo cannot have `origin/main`.
  - `fetch` non-zero / times out (offline, no `origin`, credential prompt) → CONTINUE to
    `ls-tree` against whatever `origin/main` already points at. A stale remote view is
    strictly better than none.
  - `ls-tree` non-zero (no `origin/main` ref) → no remote contribution.
  - A per-worktree `readDirectory` failure (deleted worktree still listed, permission)
    → that worktree contributes nothing; the others are unaffected.
  - Every guarded catch: one `logger.warn` naming the step, plus ONE
    `degradationReporter?.report({ source: 'workspace', code: <literal>, severity: 'degraded', … })`.
    `code` must be a **string literal** per `vscode-core/CLAUDE.md` — use
    `task-visibility.worktree-list-failed`, `task-visibility.fetch-failed`,
    `task-visibility.ls-tree-failed`, `task-visibility.worktree-scan-failed`.
    Each catch also carries `// degradation-audit: reported — <code>`, or
    `libs/backend/task-specs` exceeds its baseline of 12
    (`tools/degradation-audit/baseline.json:33`) and CI fails.
    `DegradationSource` is a closed union with no `tasks` member
    (`libs/shared/src/lib/types/rpc/rpc-degradation.types.ts:40-52`); `'workspace'` is the
    honest fit — the loss is workspace-wide visibility. Widening the union to add
    `'tasks'` was considered and rejected: it is a wire change (`DegradationSource` **and**
    `DEGRADATION_SOURCE_VALUES` must move together, or the guard at `:127` drops the
    payload) for three codes.
- **Timeouts**: `DEFAULT_GIT_TIMEOUT_MS` (10 s) for `worktree list` and `ls-tree`;
  a dedicated `FETCH_TIMEOUT_MS = 5_000` for the fetch, because it is the only step that
  touches the network and the only one that can hang on a credential prompt. A total
  worst case of 25 s on a user-initiated create is the ceiling this buys.
- **Quality requirements**: at most three git spawns and one `readDirectory` per worktree
  per uncached call; zero spawns on a cache hit within 60 s; never blocks the Electron
  main thread when the spawner is bound.
- **Verification seam**: the class, constructed with a fake `execGit`. Extract the exec
  as a constructor-injected function reference defaulting to the imported `execGit` — the
  spec then drives every branch (all-succeed, no-git, fetch-fails-ls-tree-succeeds,
  ls-tree-fails, worktree-readdir-throws) without spawning a process. Plus the two pure
  parsers tested directly, including the NUL-separated form and a worktree list carrying
  `bare` / `detached` blocks.
- **Files**: CREATE `…\libs\backend\task-specs\src\lib\git-task-folder-visibility.service.ts`;
  CREATE `…\libs\backend\task-specs\src\lib\git-task-folder-visibility.service.spec.ts`.

### 5. `TaskWriterService.create` — union once, fresh suffix per attempt

- **Purpose**: allocate against everything visible, and claim.
- **Responsibilities**: unchanged except the id-allocation step.
- **Verified contracts and entry points**:
  - `create` at `task-writer.service.ts:240-340`; the loop at `:270-289`; the allocator
    call at `:273`; `MAX_CREATE_ATTEMPTS = 5` at `:117`; `listFolderNames` at `:798-808`.
  - Constructor at `:231-238` — gains a FOURTH parameter
    `@inject(TASK_FOLDER_VISIBILITY_TOKEN) private readonly visibility: ITaskFolderVisibility`.
- **Required shape**:
  - Call `visibility.listBeyondWorkspace(root)` ONCE, before the loop. Inside the loop,
    union it with a fresh `listFolderNames(specsDir)`. The per-attempt local re-scan is
    what makes the retry converge (`:271-272` states this); the external half cannot
    change during a five-attempt loop and must not be re-fetched.
  - Draw a fresh `randomIdSuffix()` per attempt. A repeated suffix would lose the same
    race twice; a fresh one resolves an EEXIST even when the number is unchanged.
  - `ID_ALLOCATION_EXHAUSTED` (`:291-302`) is unchanged and stays reachable — the folder
    lock is still the correctness guarantee, and the message already names the contended
    ids, which now carry their suffixes.
  - No new `catch`: the visibility port never throws, so this method adds no degradation
    site of its own.
- **Dependencies**: `ITaskFolderVisibility` (direction: writer → port, port implemented in
  the same lib), plus the two id modules.
- **Integration points**: unchanged upstream — `tasks:create` RPC
  (`libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts:269,787`),
  `ptah_task_create` MCP tool
  (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:1670-1673`,
  a verbatim pass-through to `ptahAPI.tasks.create`), and the board's create dialog
  (`libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts:1522-1539`, which sends
  title/type/description and never an id). **All three keep working with no edit.**
- **Failure behaviour**: unchanged union of `INVALID_PARAMS` / `TASK_FOLDER_EXISTS` /
  `WRITE_FAILED` / `ID_ALLOCATION_EXHAUSTED`. A malformed suffix (component 1) surfaces
  as `WRITE_FAILED` through the existing catch at `:330-339`.
- **Quality requirements**: one visibility call per `create`, never per attempt.
- **Verification seam**: `create` with a FAKE `ITaskFolderVisibility`. Required cases:
  (a) local holds `TASK_2026_001`, the fake returns `TASK_2026_402_ab12` → the id is
  `TASK_2026_403_<hex>`; (b) the fake returns `[]` → behaviour identical to today apart
  from the suffix; (c) `listBeyondWorkspace` is called exactly ONCE across a 3-attempt
  EEXIST retry while `readDirectory` is called three times; (d) two attempts produce
  different suffixes. Existing exact-id assertions
  (`task-writer.service.spec.ts:48,94`; `create-race.spec.ts:94-95,123,149,155`) become
  `toMatch(/^TASK_\d{4}_\d{3}_[0-9a-f]{4}$/)` plus a numeric-prefix assertion.
- **Files**: MODIFY `…\libs\backend\task-specs\src\lib\task-writer.service.ts`;
  MODIFY `…\libs\backend\task-specs\src\lib\task-writer.service.spec.ts`,
  `…\task-writer.create-race.spec.ts`, `…\task-writer.metadata.spec.ts`,
  `…\task-writer.conflict.integration.spec.ts`, `…\task-doctor.service.spec.ts`
  (the last four only to pass `new NoOpTaskFolderVisibility()` as the 4th argument).

### 6. DI wiring and public barrel

- **Purpose**: make the seam resolvable in all three hosts with no host-side edit.
- **Responsibilities**: register `GitTaskFolderVisibility` as a singleton and point
  `TASK_FOLDER_VISIBILITY_TOKEN` at it, inside `registerTaskSpecsServices` — the same
  place and the same shape as the `TASK_INDEX_NOTIFIER_TOKEN` binding.
- **Verified contracts and entry points**:
  - `registerTaskSpecsServices(container, logger)` —
    `libs/backend/task-specs/src/lib/di/register.ts`; its documented pre-conditions are
    `TOKENS.LOGGER` and `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER`, both already satisfied.
  - Token style: `Symbol.for('…')`, globally unique description —
    `libs/backend/task-specs/src/lib/di/tokens.ts:1-11`.
  - Barrel: `libs/backend/task-specs/src/index.ts` currently exports `allocateTaskId`,
    `ITaskIndexNotifier`, `NoOpTaskIndexNotifier` (per `libs/backend/task-specs/CLAUDE.md`
    "Public API"). Add `randomIdSuffix`, `TASK_ID_SUFFIX_RE`, `ITaskFolderVisibility`,
    `TASK_FOLDER_VISIBILITY_TOKEN`, `NoOpTaskFolderVisibility`, `GitTaskFolderVisibility`.
- **Dependencies**: `tsyringe`.
- **Integration points**: no host file changes. Electron gets the off-thread spawner
  automatically through the optional mirrored token it already binds
  (`phase-4-handlers.ts:102-107`); VS Code and the CLI bind nothing and take `execGit`'s
  documented inline path (`exec-git.ts:105-114`).
- **Failure behaviour**: an unregistered optional spawner resolves `null` → inline spawn,
  which is the pre-existing behaviour for two of three hosts and therefore not a
  degradation.
- **Quality requirements**: no new registration in any `apps/**` file.
- **Verification seam**: extend the lib's DI registration spec (or add one) to assert the
  token resolves to `GitTaskFolderVisibility` from a container carrying only `TOKENS.LOGGER`
  and `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER`. Pin the mirrored spawner symbol string
  literally, for the reason `skill-synthesis/src/lib/di/tokens.ts:60-63` gives: a typo in a
  mirrored symbol does not fail loudly, it silently resolves `null`.
- **Files**: MODIFY `…\libs\backend\task-specs\src\lib\di\tokens.ts`,
  `…\libs\backend\task-specs\src\lib\di\register.ts`,
  `…\libs\backend\task-specs\src\index.ts`.

### 7. `subagent-metrics-extractor` — accept the suffix, stop uppercasing the id

- **Purpose**: keep per-subagent metrics attributed to the right task.
- **Responsibilities**: widen both regexes; return the id with its case intact.
- **Verified contracts and entry points**:
  - `SPECS_PATH_TASK_ID` at `libs/backend/skill-synthesis/src/lib/subagent-metrics-extractor.ts:46`;
    `BARE_TASK_ID` at `:48`; `extractTaskIdFromPrompt` at `:60-75`; consumer
    `deriveTaskId` at `:211`, surfaced at `:109`.
  - Trigger consumer: `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts:662`.
- **Required shape**:
  - Both patterns become `TASK_\d{4}_\d{3,}(?:_[A-Za-z0-9]+)?`. `\d{3,}` (not `\d{3}`)
    because `TASK_2026_1000` is a pinned output of the allocator
    (`id-allocator.spec.ts:36-38`). The optional group is deliberately wider than
    `[0-9a-f]{4}` so legacy `TASK_2026_146_ORCHESTRA` matches too — the allocator has
    always tolerated it and this extractor should not be stricter than the folder scanner.
    The trailing `\b` survives because the group ends on a word character.
  - **`.toUpperCase()` at `:64` and `:70` must stop deciding the returned string.**
    Keep the case-insensitive DEDUP — `new Set(matches.map(m => m.toUpperCase()))` is what
    makes "exactly one distinct id" correct — but RETURN the matched text verbatim. The
    reason is a second writer into the same column: `taskIdFromVerdictSource`
    (`libs/backend/skill-synthesis/src/lib/skill-scorecard.service.ts:275-281`, used at
    `:169`) does no case normalization at all. With a lowercase-hex suffix, the two
    producers would write `TASK_2026_403_A1F2` and `TASK_2026_403_a1f2` for one task, and
    the scorecard would group them apart. Today every id is uppercase, so the divergence is
    invisible — which is exactly why it must be closed in the same change that introduces
    lowercase characters into ids.
- **Dependencies**: unchanged. This lib already imports `task-specs`
  (`libs/backend/task-specs/CLAUDE.md` "Cross-Lib Rules") but the extractor does not, and
  must not start: it parses free prose, not folders.
- **Integration points**: `skill_candidates.task_id`, `skill_invocation_events.task_id`,
  the agent scorecard.
- **Failure behaviour**: unchanged — no match still yields `null` and the window fallback
  handles attribution.
- **Quality requirements**: not applicable.
- **Verification seam**: `extractTaskIdFromPrompt`, in
  `subagent-metrics-extractor.spec.ts`. Required cases: a specs path carrying a suffixed
  id; a bare suffixed id; a legacy `TASK_2026_146_ORCHESTRA`; `TASK_2026_1000`; a prompt
  naming `TASK_2026_403_a1f2` twice in different case → one distinct id, returned in the
  case of the first match; two genuinely different suffixed ids → `null`.
- **Files**: MODIFY `…\libs\backend\skill-synthesis\src\lib\subagent-metrics-extractor.ts`;
  MODIFY `…\libs\backend\skill-synthesis\src\lib\subagent-metrics-extractor.spec.ts`.

### 8. The stated rule — one renderer, then its copies

- **Purpose**: every prompt, skill and document that teaches id allocation teaches the new
  rule: scan `origin/main` plus every worktree plus the local folder, take highest + 1,
  append four hex characters, and the exclusive `mkdir` is still the lock.
- **Responsibilities**: change the SOURCE first, then the rendered/duplicated copies.
- **Verified contracts and entry points** — the source and why it is the source:
  - `renderTaskSpecAgentBlock()` — `libs/shared/src/lib/types/task-spec.contract.ts:502-530`;
    allocation bullet at `:523-525`; id shape at `:507`.
  - `renderSpecsReadme()` — same file, `:473-477` ("## Allocating an id"), shape at `:427`.
    This is written into a user's `.ptah/specs/README.md`.
  - Resolved as the `TASK_SPEC_CONTRACT` partial by
    `libs/backend/agent-generation/src/lib/services/template-partial-resolver.ts:58,74`
    — which is why there is deliberately no `_shared/task-spec-contract.md` file.
  - Both renderers are pinned by `libs/shared/src/lib/types/task-spec.contract.spec.ts:397-494`.
  - **The 15 `.claude/agents/*.md` are NOT regenerated by anything.** `harness-sync` treats
    `{ws}/.claude/agents` as a SOURCE and writes nothing there
    (`libs/backend/harness-sync/src/lib/targets/claude-target.ts:13,93`;
    `manifest/desired-state.types.ts:38-39`); the only script that touches the directory,
    `scripts/validate-orchestration-skill.ts:154,419-422`, checks existence. The agent
    generation pipeline runs against a USER's workspace at runtime. So: edit the renderer,
    then apply the identical replacement by hand to all 15 files, whose `STATIC:` markers
    were stripped when they were rendered.
  - **A break the brief did not name**: `.claude/skills/orchestration/SKILL.md:130` and its
    plugin copy `:130` gate continuation on `/^TASK_\d{4}_\d{3}$/`. A suffixed id fails
    that anchor and routes to NEW_TASK. It must be widened.
  - **A CI gate the brief did not name**: `scripts/generate-content-manifest.js:25-27`
    hashes `apps/ptah-extension-vscode/assets/plugins` and
    `libs/backend/agent-generation/templates/agents` into `content-manifest.json`
    (`:321-326`); `npm run manifest:check` (`package.json:67`) fails on a stale hash.
    Any plugin-asset edit must be followed by `npm run manifest:generate`.
  - The templates under `libs/backend/agent-generation/templates/agents/` carry
    `<!-- STATIC:TASK_SPEC_CONTRACT -->` marker pairs, not literal rule text, so they need
    NO edit for the allocation rule.
- **Exact locations** (each verified by reading the line):

  | File                                                                                       | Lines                          | What changes                                             |
  | ------------------------------------------------------------------------------------------ | ------------------------------ | -------------------------------------------------------- |
  | `libs/shared/src/lib/types/task-spec.contract.ts`                                            | `427`, `473-477`, `507`, `523-525` | Both renderers: id shape + allocation rule                |
  | `libs/shared/src/lib/types/task-spec.contract.spec.ts`                                       | `397-494`                      | Update the pinned expectations                            |
  | `.claude/agents/*.md` × 15                                                                   | `31` + `47-49` (video-director `32` + `48-50`) | Same replacement as the renderer, byte-identical           |
  | `.claude/skills/orchestration/SKILL.md`                                                      | `130`, `144`                   | Widen the regex gate; restate the reserve rule            |
  | `.claude/skills/orchestration/references/task-tracking.md`                                   | `190-192`, `201-202`           | The numbered allocation procedure + its example           |
  | `.claude/skills/tribunal/references/relay.md`                                                | `40`                           | The one-line allocation step                              |
  | `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/SKILL.md`          | `130`, `138`                   | Same two changes; note this copy already reads differently from `.claude` |
  | `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/references/task-tracking.md` | `190-192`, `201-202`    | Mirror                                                    |
  | `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/references/relay.md`    | `40`                           | Mirror                                                    |
  | `content-manifest.json` (repo root)                                                          | generated                      | `npm run manifest:generate` after the three plugin edits  |
  | `CLAUDE.md`                                                                                  | `173`, `177`                   | Carrier shape + the "ID allocation" bullet                |
  | `libs/backend/task-specs/CLAUDE.md`                                                          | `7`, `18`, `41`                | Purpose line, helper list, `id-allocator.ts` description; add the new port + git service to Internal Structure |
  | `libs/backend/task-specs/src/lib/registry-generator.service.ts`                              | `98`, `101`                    | The emitted registry banner's allocation instructions      |
  | `libs/backend/vscode-lm-tools/.../mcp-core/tool-description.builder.ts`                      | `45`                           | `"Allocates the next TASK_YYYY_NNN id"` → the new format   |

- **Dependencies**: none in code. The ordering constraint is editorial: the renderer is
  the source of truth for the 15 agent files, so it is written first and the copies are
  made to match it.
- **Integration points**: agent prompts, the orchestration and tribunal skills, the shipped
  plugin, the generated registry banner, the MCP tool catalogue.
- **Failure behaviour**: not applicable.
- **Quality requirements**: the allocation bullet in all 15 `.claude/agents/*.md` must be
  byte-identical to `renderTaskSpecAgentBlock()`'s output for that bullet — a divergence
  here is invisible until someone regenerates and gets a diff.
- **Verification seam**: `npx nx test @ptah-extension/shared` (contract renderer spec),
  `npx nx test @ptah-extension/task-specs` (`contract.guard.spec.ts` scans both asset trees
  and the template dir — `:230-236`, `:306-307`), `npm run manifest:check`, and
  `npm run validate-skill`. Plus a `grep` for the retired phrase "zero-padded to three
  digits" returning nothing outside history.
- **Files**: MODIFY, as listed in the table above.

## Integration architecture

- **Data flow** (create, boundary to boundary):
  1. `ptah_task_create` MCP tool (`protocol-dispatcher.ts:1670`) **or** the board dialog
     (`tasks-store.service.ts:1522`) **or** `ptah task create` (`apps/ptah-cli/src/cli/router.ts:841`)
     → `tasks:create` → `TasksRpcHandlers` (`tasks-rpc.handlers.ts:787`, Zod-validated).
  2. `TaskWriterService.create(root, input)` → `fs.createDirectory(specsDir)`.
  3. `visibility.listBeyondWorkspace(root)` — ONCE:
     `git worktree list --porcelain` → paths → `readDirectory(<path>/.ptah/specs)` each;
     `git fetch --quiet origin main` → `git ls-tree --name-only -z origin/main .ptah/specs/`
     → basenames. Deduplicated, cached 60 s.
  4. Per attempt (≤ 5): `listFolderNames(specsDir)` ∪ step 3 →
     `allocateTaskId(union, randomIdSuffix())` → `createDirectoryExclusive`.
  5. `renderTaskMd` → `writeCarrier` → round-trip `parseTaskFile` → `indexNotifier.applyFolderChange`.
- **State or persistence**: one in-memory TTL cache inside `GitTaskFolderVisibility`, keyed
  by `workspaceRoot`, lifetime 60 s, owned entirely by that service. Nothing is persisted;
  the SQLite derived index and the `task.md` carriers are untouched by this change.
- **External boundaries**: git stdout is the only new external input. It is parsed by two
  pure functions with defensive filtering (`startsWith('TASK_')`, basename extraction) and
  the values reach the filesystem only through `allocateTaskId`, which validates its
  suffix and composes the rest from its own literals. No git-derived string is ever joined
  into a path — the union feeds a MAX computation, nothing more. Zod is not warranted here:
  the boundary's output is a `string[]` whose every element is already filtered by shape.
- **Failure and rollback**: there is nothing to roll back. Every git step degrades to
  "contributes nothing", the allocation falls back to exactly today's local-only behaviour,
  and the `createDirectoryExclusive` lock remains the sole correctness guarantee. The
  suffix is drawn locally and never depends on git, so **collision-proofing survives a
  total git failure**; only duplicate NUMBERS become likelier, which the decision in
  `context.md` already accepts as visible and harmless.
- **Observability**: four `logger.warn` lines naming the failed step, each paired with a
  `DegradationReporter.report` under `source: 'workspace'` and a literal `code`
  (component 4). Without this pairing the degrade is silent — and
  `tools/degradation-audit/check-degradation.ts` would fail the build for it, which is the
  mechanism working as designed.

## Architecture-level quality requirements

- **Functional**:
  - Every allocated id matches `/^TASK_\d{4}_\d{3,}_[0-9a-f]{4}$/`.
  - The chosen `NNN` is greater than the max `NNN` found in the union of local folders,
    `origin/main`'s `.ptah/specs`, and every worktree's `.ptah/specs`.
  - With git absent or failing, `create` still succeeds and still emits a suffixed id.
  - Existing unsuffixed and legacy folders are never renamed and still count toward the max.
  - `ptah_task_create`, `tasks:create` and the board dialog require no argument change.
- **Performance**: at most three git spawns per `create`, none inside the retry loop, none
  at all within 60 s of a previous call. Fetch bounded at 5 s, other git calls at 10 s.
  On Electron the spawns go off-thread whenever `Symbol.for('SdkProcessSpawner')` is bound.
- **Security**: no git-derived string is used to construct a path; the allocator validates
  its only externally-influenced input (the suffix) against `/^[0-9a-f]{4}$/`.
- **Maintainability**: `task-specs` gains no new lib dependency edge; `platform-core` stays
  a leaf; the writer stays ignorant of git; `subagent-metrics-extractor` stays free of a
  `task-specs` import; there is exactly ONE allocator and ONE union reader, with no
  version-suffixed sibling and no feature flag.
- **Testability**: the allocator is deterministic given `(names, suffix, year)`; the union
  reader is fully drivable through a fake exec, including every failure branch; the writer
  is drivable through a fake `ITaskFolderVisibility`. No test may spawn a real git process.

## Team-leader handoff

- **Recommended executors**:
  - Components 1-7 → `backend-developer`. All of it is DI-wired backend service work in
    `libs/backend/**` with a port, a token registration and Jest specs — the agent's stated
    domain.
  - Component 8 → `backend-developer` as well, not `technical-content-writer`: the source
    of truth is a TypeScript renderer with a pinning spec
    (`task-spec.contract.ts` / `.spec.ts`), and the edit must be replicated byte-identically
    into 15 rendered files and pass three CI gates. That is contract work that happens to
    be prose, not content authoring.
- **Complexity**: MEDIUM. No component is individually hard; the risk is breadth — 8
  components, ~40 files, three CI gates (`manifest:check`, `contract.guard.spec.ts`, the
  degradation ratchet) that fail for reasons unrelated to the logic, and one spec-file
  fan-out (6 files re-constructing `TaskWriterService`).
- **Dependencies and ordering** (component-level only):
  - Component 2 before component 1 (the allocator validates against `TASK_ID_SUFFIX_RE`).
  - Components 1, 3, 4 before component 5 (the writer consumes all three).
  - Component 3 before component 6 (the token must exist to be bound).
  - Component 7 is independent of 1-6.
  - Component 8 is independent of 1-7 and file-disjoint from all of them.
- **Parallel-safe work**: three file-disjoint groups —
  - **A (task-specs code)**: components 1, 2, 3, 4, 5, 6.
  - **B (skill-synthesis)**: component 7.
  - **C (prompts, docs, plugin assets)**: component 8. Note C includes two `.ts` files —
    `libs/shared/src/lib/types/task-spec.contract.ts` (+ its spec) and
    `libs/backend/task-specs/src/lib/registry-generator.service.ts` — which are prose
    payloads. Neither is touched by group A, so disjointness holds; assign them to C and
    keep A off them.
- **Files affected**:

  **CREATE**
  - `…\libs\backend\task-specs\src\lib\id-suffix.ts`
  - `…\libs\backend\task-specs\src\lib\id-suffix.spec.ts`
  - `…\libs\backend\task-specs\src\lib\task-folder-visibility.port.ts`
  - `…\libs\backend\task-specs\src\lib\git-task-folder-visibility.service.ts`
  - `…\libs\backend\task-specs\src\lib\git-task-folder-visibility.service.spec.ts`

  **MODIFY — group A**
  - `…\libs\backend\task-specs\src\lib\id-allocator.ts`
  - `…\libs\backend\task-specs\src\lib\id-allocator.spec.ts`
  - `…\libs\backend\task-specs\src\lib\task-writer.service.ts`
  - `…\libs\backend\task-specs\src\lib\task-writer.service.spec.ts`
  - `…\libs\backend\task-specs\src\lib\task-writer.create-race.spec.ts`
  - `…\libs\backend\task-specs\src\lib\task-writer.metadata.spec.ts`
  - `…\libs\backend\task-specs\src\lib\task-writer.conflict.integration.spec.ts`
  - `…\libs\backend\task-specs\src\lib\task-doctor.service.spec.ts`
  - `…\libs\backend\task-specs\src\lib\di\tokens.ts`
  - `…\libs\backend\task-specs\src\lib\di\register.ts`
  - `…\libs\backend\task-specs\src\index.ts`

  **MODIFY — group B**
  - `…\libs\backend\skill-synthesis\src\lib\subagent-metrics-extractor.ts`
  - `…\libs\backend\skill-synthesis\src\lib\subagent-metrics-extractor.spec.ts`

  **MODIFY — group C**
  - `…\libs\shared\src\lib\types\task-spec.contract.ts`
  - `…\libs\shared\src\lib\types\task-spec.contract.spec.ts`
  - `…\libs\backend\task-specs\src\lib\registry-generator.service.ts`
  - `…\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\tool-description.builder.ts`
  - `…\.claude\agents\backend-developer.md`, `code-logic-reviewer.md`,
    `code-style-reviewer.md`, `devops-engineer.md`, `frontend-developer.md`,
    `modernization-detector.md`, `project-manager.md`, `researcher-expert.md`,
    `senior-tester.md`, `software-architect.md`, `team-leader.md`,
    `technical-content-writer.md`, `ui-ux-designer.md`, `video-director.md`,
    `visual-reviewer.md`
  - `…\.claude\skills\orchestration\SKILL.md`
  - `…\.claude\skills\orchestration\references\task-tracking.md`
  - `…\.claude\skills\tribunal\references\relay.md`
  - `…\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\SKILL.md`
  - `…\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\references\task-tracking.md`
  - `…\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\tribunal\references\relay.md`
  - `…\content-manifest.json` (regenerated, never hand-edited)
  - `…\CLAUDE.md`
  - `…\libs\backend\task-specs\CLAUDE.md`

  **REWRITE**: none.

- **Verification points**:
  - References to confirm before writing code: `execGit` is exported from the `vscode-core`
    barrel (`libs/backend/vscode-core/src/index.ts:101-105`); `parseWorktreeList` from
    `@ptah-extension/shared`; `Symbol.for('SdkProcessSpawner')` matches
    `libs/backend/agent-sdk/src/lib/di/tokens.ts:51` character for character;
    `TOKENS.DEGRADATION_REPORTER` resolves optionally.
  - Contracts to honour: the visibility port never throws; the union is computed once per
    `create`; the suffix is fresh per attempt; every new degrading `catch` carries BOTH a
    `// degradation-audit: reported — <code>` marker and a reporter call with a literal
    `code`; the agent-file bullet is byte-identical to the renderer's output.
  - Data changes to apply: none. No migration, no folder rename, no carrier rewrite.
  - Commands that must pass (project names are the `project.json` aliases; use `run-many`,
    never `nx test a b c` — root `CLAUDE.md`):
    - `npx nx run-many -t test -p @ptah-extension/task-specs @ptah-extension/skill-synthesis @ptah-extension/shared`
      — check the `Running target test for 3 projects` header says 3.
    - `npx nx run-many -t typecheck -p @ptah-extension/task-specs @ptah-extension/skill-synthesis @ptah-extension/shared @ptah-extension/vscode-lm-tools`
    - `npx nx run-many -t lint -p @ptah-extension/task-specs @ptah-extension/skill-synthesis @ptah-extension/shared`
    - `npx nx run degradation-audit:lint` — must not exceed
      `libs/backend/task-specs: 12` (`tools/degradation-audit/baseline.json:33`).
    - `npm run manifest:generate` after the three plugin-asset edits, then
      `npm run manifest:check`.
    - `npm run validate-skill`.
  - Manual check worth one minute in the worktree, because it is the premise of the whole
    design: `git ls-tree --name-only origin/main .ptah/specs/` returns folder names, and
    `git worktree list --porcelain` lists more than one worktree.

- **Observation, out of scope, do not fix here**: several comments assert
  "`.ptah/**` is gitignored, so an overwrite has no undo"
  (`task-writer.service.ts:353-354`, `:723-724`; `.claude/skills/orchestration/SKILL.md:145`).
  That is false for `.ptah/specs/**`, which `.gitignore:134-135` explicitly un-ignores —
  and the fact that specs ARE tracked is what makes this task's `origin/main` read possible
  at all. The stated rationale is wrong even though the resulting behaviour (never
  overwrite) is right. File it separately rather than widening this task.
