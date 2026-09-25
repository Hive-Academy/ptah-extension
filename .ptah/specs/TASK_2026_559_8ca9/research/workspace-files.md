# Workspace / Files / Diagnostics / Memory / Web / Execution — Tool Audit

TASK_2026_559. Repo `D:/projects/ptah-extension`, HEAD `9afac1aa2` (2026-09-25 16:14:32 +0300), branch `main`,
working tree clean except untracked `.ptah/specs/TASK_2026_557_tokaudit`, `TASK_2026_559_8ca9`, `TASK_2026_560_2ae5`.
Live MCP server: the running Ptah Electron/VS Code host reachable through the `mcp__ptah__*` tools in this session.
Its tool descriptions (`ptah_get_diagnostics`'s "PASS `files` WITH THE FILES YOU CHANGED..." text, matching
`tool-description.builder.ts` at HEAD) match source at HEAD exactly, so **the running server's source matches HEAD** —
this audit is not measuring a stale build, unlike the caveat that would otherwise apply.

Baseline documents read first: `.ptah/specs/TASK_2026_557_tokaudit/research-report.md` (RC5, RC6, Wave 1) and
`C:/Users/abdal/.ptah-token-audit/mcp_surface.md` (2026-09-25 static+live audit, same HEAD-adjacent commit). Both are
treated as a PRIOR measurement, not as ground truth for this pass — several of their findings have since moved.

ptah tools used for this research itself: `ptah_search_files` (confirmed file inventory and reproduced the 50-cap
bug), `ptah_memory_search` (surfaced 3 directly relevant prior-session memories, including one contradicting the
Wave-1 "main thread" diagnosis — see RC/get_diagnostics below), `ptah_get_diagnostics`, `ptah_project_detect_monorepo`,
`ptah_workspace_analyze`, `ptah_json_validate`, `ptah_web_search`, `ptah_git_worktree_add/list/remove`, `execute_code`.
All were faster and more targeted than Grep-only research would have been for the live-behaviour half of this task;
Grep and Read carried the code-path and forensic half.

---

## ptah_workspace_analyze

**1. Contract.** Description (live tool, matches `tool-description.builder.ts:317-321`): *"Analyze the entire
workspace in one call. Returns project type, frameworks, directory structure, and architecture overview. **Use this
FIRST when starting any task to understand the project.**"* The core prompt repeats the mandate:
`ptah-core-prompt.ts:39` ("Manual workspace exploration" → `ptah_workspace_analyze`, "Full project structure in one
call") and `ptah-core-prompt.ts:74` ("Workflow: Start Every Task With Ptah" step 1). Eager-loaded on every runtime
(`protocol-dispatcher.ts:398-404`).

**2. Live behaviour.** Called live on this repo (2026-09-25):
- **Project Type: react.** Wrong. This is an Nx 22 monorepo of 13 apps (Angular VS Code extension/webview, Angular
  Electron app, NestJS license server, Astro docs, a CLI, a Remotion video-studio app) with zero React UI apps.
  `ptah_project_detect_monorepo`, called in the same batch, correctly returned `{"isMonorepo":true,"type":"nx"}` —
  **two tools in the same server disagree on the same workspace in the same second**, and the one every agent is told
  to call FIRST is the wrong one.
- **Directory tree, no cap.** The rendered response included the full, uncapped recursive tree — not just source
  code but `tmp/d/` (≈290 scratch marketing `.html` files), `tmp/js/` (≈120 chunk files), `tmp/vd/` (≈85 files) and
  a dozen `tmp/*.log` files, none of them excluded. Measuring the returned text: `tmp/d/` alone contributes about
  290 lines × ~28 chars ≈ 8,100 chars, `tmp/js/` ≈120 × ~24 ≈ 2,900 chars, `tmp/vd/` ≈85 × ~30 ≈ 2,500 chars — over
  13,000 chars of scratch-directory noise alone, on top of the legitimate `apps/`/`libs/` tree. This is the same
  defect the Wave-1 audit measured at 96% tree / 29,727 chars on 2026-09-25's mcp_surface.md pass, but the `tmp/`
  directory has grown since that measurement (worktree-patch files, trace JSON, screenshots) and there is still no
  depth or per-directory entry cap, so the payload is now larger, not smaller.
- Deps/dev-deps lists are correctly capped at 15 with a "... and N more" trailer (`mcp-response-formatter.ts:124-138`).
- Latency: sub-second (no timing regression here).

**3. Code path.** `protocol-dispatcher.ts:673-680` (`case 'ptah_workspace_analyze'`) → `ptahAPI.workspace.analyze()`
→ `WorkspaceService` (`workspace.service.ts:367-420`, calls `this.projectDetector.detectProjectType(workspacePath)`
at :371-372) → formatted by `formatWorkspaceAnalysis` (`mcp-response-formatter.ts:73-187`), tree rendered by
`renderDirectoryTree` (`mcp-response-formatter.ts:38-68`) — recurses over every `dir`/`file` entry with **no depth
parameter, no entry-count cap, and no exclude list applied at render time** (exclusion is only whatever
`getDirectoryStructure` upstream already filtered, and `tmp/` is not in `DEFAULT_WORKSPACE_EXCLUDES`, confirmed by
its appearance in the live output).

Project-type root cause: `project-detector.service.ts:96-163` (`detectProjectType`). Priority is: (1) `angular.json`
file present at the workspace root → Angular; (2) Node/TS profile match → `detectNodeProjectType` (deps-based).
`detectNodeProjectType` (`project-detector.service.ts:179-211`) checks `allDeps.next`, then **`allDeps.react`
(line 194) before `allDeps['@angular/core']` (line 197)**. This repo's root `package.json` carries **both** `react`
and `@angular/core` in its aggregate dependency list (confirmed: `node -e "require('./package.json')"` shows both
true) — normal for an Nx monorepo root manifest, which lists every app's dependencies together — and there is no
`angular.json` at the repo root (Nx workspaces put Angular config in each app's `project.json`/`angular.json` under
`apps/*`, not at root; confirmed `ls angular.json` → no such file). So step (1) never fires here, step (2) hits
`detectNodeProjectType`, and React wins because it is checked first.

**4. Regression forensics.** This is a **known, previously "fixed", still-broken** defect, not a fresh regression.
- File-level history: `git log --follow` on `project-detector.service.ts` shows the file created at
  `2b537f44c` (2026-05-15) with the React-before-Angular dependency order already in place.
- `react` entered the root `package.json` at `ea36c1a72` (2026-06-12, "scaffold ptah-tui app" — the TUI likely
  pulls in `ink`/React for its terminal UI), which is when this workspace started tripping the bug.
- **`e4e2a7bd6` (2026-09-22 20:43:27, "fix(agent-generation,workspace-intelligence): detect the stack and cut
  prompts at block boundaries") is an attempted fix for exactly this symptom.** Its own commit message: *"The setup
  wizard reported this Nx + Angular workspace as a non-monorepo React project... angular.json decides the project
  type before the dependency branch, so React tooling in devDependencies no longer wins."* The diff moves the
  `angular.json` check to the top of `detectProjectType` (`project-detector.service.ts:100-102`). **This fix only
  works when `angular.json` exists at the workspace root** — which this repo (the one named in the commit message)
  does not have, being an Nx monorepo. The same commit adds
  `project-detector.service.spec.ts:184-204`, *"should still detect React from package.json devDependencies when no
  angular.json exists"* — a test that **pins the exact broken behaviour this repo exhibits** as the intended
  contract, three days before this bug report. The fix closed the single-app Angular-CLI case and left the Nx
  monorepo case (the one it was written for) open.
- Verified live at HEAD (2026-09-25, after `e4e2a7bd6`): `ptah_workspace_analyze` still returns `"Project Type: react"`.

**5. Root cause.** `detectNodeProjectType`'s dependency-priority order (React before Angular) is unsound for any
workspace whose root manifest aggregates dependencies from multiple apps — which describes every Nx/Lerna/Turbo/pnpm
workspace with more than one framework across its apps. The `angular.json`-first guard added in `e4e2a7bd6` only
covers the sub-case where Angular config lives at the workspace root; it does not consult
`monorepoDetector.detectMonorepo()`'s own result (`workspace.service.ts:377-380`), which is computed in the same
function and already knows this is an Nx workspace, before falling back to a single-type dependency guess.

**6. Fix design.**
- `workspace.service.ts:367-420`: call `monorepoDetector.detectMonorepo()` **before** `detectProjectType`, and when
  `isMonorepo` is true, do not report a single framework type from root-level dependencies at all. Either (a) scan
  each app directory (`apps/*/project.json` for Nx, `apps/*/angular.json`, `packages/*/package.json` for
  Lerna/Turbo/pnpm) and report the set of frameworks in use, or (b) report `type: 'monorepo'` /
  `type: '<tool>-monorepo'` (e.g. `nx-monorepo`) and put the per-app breakdown in a `apps` field instead of
  collapsing it to one wrong guess. Cheapest correct fix: for Nx specifically, read `nx.json`'s `projects` or glob
  `apps/*/project.json` and union the `@nx/angular`/`@nx/react`/`@nx/nest` executors found.
  `project-detector.service.spec.ts:184-204` must be rewritten to assert the monorepo-aware answer, not the
  single-framework guess, for a fixture with both `react` and `@angular/core` and no root `angular.json`.
- `mcp-response-formatter.ts:38-68` (`renderDirectoryTree`): accept a `maxEntriesPerDir` (default ~20) and
  `maxDepth` (default 3, matching `getDirectoryStructure(workspacePath, 3)` already used at
  `workspace.service.ts:534`), with `... and N more` on overflow — same pattern already used for deps/devDeps two
  blocks above it in the same file. Add `tmp/`, `dist/`, `.claude-worktrees/`, `.ptah/analysis` to whatever exclude
  set feeds the structure walk if it is not already excluded (confirmed present in the live tree, so it is not).
- Drop "Use this FIRST" from `tool-description.builder.ts:321` until both are fixed — an agent that trusts a wrong
  project type early in a session anchors every later inference (framework choice for new files, lint config
  assumptions, etc.) on it.

**7. Regression guard.** A workspace-analyze integration spec against **this repository's own root** (not a
synthetic fixture) asserting `projectType` is NOT `'react'` and IS monorepo-aware — the existing unit specs
(`project-detector.service.spec.ts`) all use synthetic single-signal fixtures and would not catch this class of bug
even after the assertion is corrected, because none of them combine "root deps span two frameworks" with "no root
angular.json" AND "is a real multi-app Nx tree" in one fixture. Add that combined fixture. Separately, a
`renderDirectoryTree` spec with a directory of 500 flat files should assert the rendered output stays under a fixed
char budget (e.g. 4,000 chars for that subtree) — this is exactly the shape `tmp/d/` has today and nothing catches it.

**8. Verdict: degraded.** `ptah_project_detect_monorepo` (below) gives the correct answer for free in the same
server; `ptah_workspace_analyze` gives the wrong one and is the one every agent is told to call first. **Priority
P1** — wrong architecture assumption at the start of every task, plus an uncapped payload that has grown since the
last measurement, not shrunk.

---

## ptah_search_files

**1. Contract.** *"Find files in the workspace by glob pattern. Searches the real filesystem (not a fuzzy index).
Returns workspace-relative paths. Respects default workspace excludes."* No stated cap in the description; the
`limit` parameter description says "Max results to return (default: 50)". `ptah-core-prompt.ts:40` maps `find`/Glob
to this tool ("Respects .gitignore, workspace-indexed").

**2. Live behaviour.**
- `pattern: "libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/*.ts"` → 25 files, exact and correct
  (matches `Glob` on the same pattern from this session).
- `pattern: "**/*.ts"` (no `limit`) → **"Found: 50 files"**, with the same 50 files a second identical call would
  return (deterministic first-50, not sampled) and **no indication anywhere in the response that 5,159 `.ts` files
  exist** (per `ptah_workspace_analyze`'s own file-statistics table from the same session) or that the result is
  truncated. An agent reading "Found: 50 files" for `**/*.ts` in this repo has no signal to ask for more.
- Latency: both calls sub-100ms.

**3. Code path.** `protocol-dispatcher.ts:682-690` (`case 'ptah_search_files'`) → `ptahAPI.search.findFiles(pattern,
limit ?? 50)` → `core-namespace.builders.ts` search namespace (`findFiles` around line 150, calls
`fileSystemProvider.findFiles(pattern, DEFAULT_WORKSPACE_EXCLUDES, limit, root)`) → `formatSearchFiles`
(`mcp-response-formatter.ts:192-214`), which prints `Found: ${files.length}` with **no comparison against `limit`
and no truncation flag** — the formatter never sees the requested limit, only the returned array length, so it
cannot distinguish "found exactly 50" from "found ≥50, capped at 50."

**4. Regression forensics.** Unchanged since the 2026-09-25 `mcp_surface.md` pass (case 1b there: same symptom,
same file). No commit since then touches `formatSearchFiles` or the `findFiles` call site
(`git log -- mcp-response-formatter.ts` most recent touching this function predates the audit). Not a regression —
a known, still-open defect.

**5. Root cause.** `formatSearchFiles` is handed only the result array, not the request's `limit` or a
"was-this-capped" boolean from the provider. `ptahAPI.search.findFiles` returns a plain array with no metadata.

**6. Fix design.** Have `findFiles` (or the `ptah_search_files` case in `protocol-dispatcher.ts:682-690`) request
`limit + 1` internally and pass an `atLimit: files.length > limit` flag (after slicing back to `limit`) into
`formatSearchFiles`, which then appends `(showing first ${limit}; narrow the pattern or pass limit=200)` when true.
Also validate `pattern` at the boundary — 5 logged production failures ("Patterns must be a string (non empty)")
per `mcp_surface.md` §3 indicate no schema check runs before `findFiles` is called.

**7. Regression guard.** A spec asserting that `formatSearchFiles`'s output contains a truncation marker when
`results.length === limit` and the provider reports more were available — none of the existing
`mcp-response-formatter.spec.ts` cases assert on the truncation case at all (confirmed: `formatSearchFiles` has no
"at limit" branch to test).

**8. Verdict: degraded** (silent truncation, no data-loss risk since it's a discovery tool, but wastes a round trip
whenever a broad pattern is used). **Priority P2.**

---

## ptah_get_diagnostics

**1. Contract.** Live description: *"Get TypeScript/JavaScript errors and warnings... PASS `files` WITH THE FILES
YOU CHANGED: on a large monorepo an unscoped call type-checks every project and can exceed the call timeout, while a
scoped one checks only the projects owning those files and returns in seconds."* `files` param: *"Narrows the check
to the projects that own them... Diagnostics from sibling files in the same project are still reported."*
`ptah-core-prompt.ts:41`: "Running build to check errors" → this tool, "call once after edits, not on every step."
Eager-loaded (`protocol-dispatcher.ts:402`).

**2. Live behaviour — materially better than the Wave-1 audit measured, but still not honouring its own contract
for two of three tested cases.**
- Scoped to one file in the **main worktree** (`protocol-dispatcher.ts`, `severity:'error'`): returned in well
  under a second, `Errors: 0 | Warnings: 0 — No issues found.` — correct and fast, matching the "returns in
  seconds" promise.
- **Unscoped** (no `files`, whole workspace): hit the 45-second caller budget and returned `"TypeScript check still
  running after 45s... retry shortly... or pass files"` — the honest degraded-but-not-hung answer the code is
  designed to give (see below), but it did NOT return in seconds, contradicting the description's framing that only
  the unscoped path is slow (true) and that the scoped path is the escape hatch (also true, see next line — except
  when it isn't).
- **Scoped to one file inside an existing git worktree**
  (`.claude-worktrees/feat-task-538-surface-contract-v2/.../protocol-dispatcher.ts`, same relative path, same repo
  content at a different commit) **also hit the identical 45-second budget and returned the same "still running"
  message** — even though this is a single-file scope that should walk up to 3-4 `tsconfig*.json` files exactly as
  the main-worktree call did. This reproduces the class of problem the Wave-1 audit flagged as "17,501-error
  worktree payload" (H1 in `mcp_surface.md`), though the live symptom here is timeout rather than an oversized
  payload — worth stating precisely: **the worktree case is confirmed broken, the specific 17,501-error number is
  not reproduced by this probe** (different worktree, different day).

**3. Code path.** `protocol-dispatcher.ts:692-710` (`case 'ptah_get_diagnostics'`) → `ptahAPI.diagnostics.getErrors
/getWarnings/getAll(files)` → `buildDiagnosticsNamespace` (`core-namespace.builders.ts:203-252`) — **this already
passes `files` through as a scope** (`files && files.length > 0 ? { files } : undefined`, line 214) — **contrary to
this task's brief, which described the current state as "get_diagnostics filters by project only
(core-namespace.builders.ts:207-245)": that description is stale.** The real implementation is
`TypeScriptDiagnosticsProvider.getDiagnostics` (`type-script-diagnostics-provider.ts:188-239`), which:
  - resolves owning `tsconfig*.json` files by walking UP from each scoped file
    (`resolveOwningConfigs`, lines 493-525) instead of a full workspace glob when scoped (lines 358-365);
  - runs the actual compile **off the calling thread**, in a shared `worker_threads` Worker
    (`ts-diagnostics-worker.ts:1-40`, confirmed by its own header comment and by a matching memory hit —
    `type-check-offload-b3`: *"ptah_get_diagnostics moved off main thread to worker_threads Worker with
    single-flight per root and 30s cache. No host wiring needed; new spec proves calling event loop stays free
    during compile."* **This directly contradicts this task's brief's claim that diagnostics runs "on the main
    thread" — it does not, as of this code.** The brief's citation (`protocol-dispatcher.ts:492-502`) is the
    generic slow-tool-call **timing wrapper** (`handleToolsCall`, logs a warning when any tool exceeds
    `PTAH_MCP_SLOW_WARN_MS`), not diagnostics-specific main-thread blocking code;
  - caps the wait at `RESULT_BUDGET_MS = 45_000` (`type-script-diagnostics-provider.ts:124`) and returns
    `unavailable` with a retry hint rather than hanging — this is what both slow calls above actually hit;
  - the underlying worker still has a hard `RUN_TIMEOUT_MS = 300_000` (`ts-diagnostics-worker.ts:139`) and, per its
    own comment, "a legitimate full-monorepo check takes tens of seconds" — so the unscoped case genuinely doing
    tens of seconds of real compiler work is expected behaviour by design, just not "seconds" as the description
    promises.
  Output side: `formatDiagnostics`/`formatDiagnosticList` (`mcp-response-formatter.ts:223-268` / :270-330) has
  **no cap on the number of diagnostics rendered** — every error/warning in the payload is listed, so if a scoped
  call ever does return a large sibling-file diagnostic set (the "floor not filter" behaviour described in
  `e70130bf5`'s commit message), nothing downstream bounds it.

**4. Regression forensics.** This is the opposite of a regression: real, substantial work landed here since the
Wave-1 audit's last full pass, across several commits reachable from HEAD:
  - `4df73f4a6` — initial `TypeScriptDiagnosticsProvider` (worker-based).
  - `f72bd891b`, `ceca0c54f` — stop reporting a false "clean" from partial config discovery.
  - `044d69960` — honest diagnostics contract.
  - `27fd5af64` — consolidate path-containment logic (dedup a hand-rolled path check into the tested
    `isPathWithinRoots`).
  - **`e70130bf5` (2026-08-30, "let a diagnostics check name the files it cares about")** — the scoping fix itself:
    adds `DiagnosticsScope`/`files`, walks up from each file to its owning tsconfig set instead of compiling all
    ~297 configs, adds the scope to the cache/single-flight key. Commit message cites the exact prior failure mode:
    *"a direct MCP call was measured past 400s with no response at all."*
  This means the Wave-1 audit's "1.08M chars / 17,501 errors / median 29-32s on the main thread" finding describes
  a **pre-`e70130bf5`/pre-worker-offload state that no longer exists as described** — the main-thread blocking is
  fixed, and the unscoped case now fails safely at 45s instead of hanging past 400s. What is **not** fixed, and is
  newly confirmed by this live probe, is that a single-file scope **inside a worktree** still hits the same 45s
  wall the unscoped call does — this is a live, reproduced, currently-open defect, distinct from the one the
  cited commits closed.

**5. Root cause (of the still-open worktree case — not fully diagnosed, marked as inferred).** `resolveOwningConfigs`
walks up from the file's directory using only literal `tsconfig*.json` presence, which should find the same 3-4
configs in a worktree copy as in the main copy (identical directory layout, same relative path under
`libs/backend/vscode-lm-tools/`). The compile itself runs via `ts.createProgram` per discovered config
(`ts-diagnostics-worker.ts`, worker source), and `resolveTypescriptModulePath` resolves the `typescript` module
against the **single workspace root the MCP server is bound to** (`type-script-diagnostics-provider.ts:150-166`
takes `workspaceRoot`, not the scoped file's own directory) — meaning both the main-repo file and the worktree file
are compiled with the same `typescript` install and against the same fixed `workspaceRoot` for module resolution.
**Inferred, not confirmed by tracing the actual compile**: a worktree checkout has no `node_modules` of its own
(git worktrees do not duplicate `node_modules`), so TypeScript's module resolution walking up from the worktree's
`tsconfig` location may be pulling in a different / much larger project graph or re-resolving types across
significantly more files than the identical main-copy compile, inflating the "single small program" case into one
that exceeds 45s. This needs a targeted repro (time the worker run directly, log `programCount`/file count for both
calls) rather than being asserted from this probe alone — recorded as an **unknown**, not a closed finding.

**6. Fix design.**
- Confirm/diagnose the worktree-scoped-timeout mechanism first (see Unknowns) before choosing a fix; do not
  guess-fix without the repro.
- Independent of that: cap `formatDiagnosticList` output (e.g. first 50 entries + a `shown 50 of N` summary line),
  per the Wave-1 P1 proposal, since "sibling files in the same project are still reported" by design and nothing
  bounds how many.
- Raise `RESULT_BUDGET_MS` for scoped calls specifically, or return a partial/streaming-style answer ("N of M
  configs compiled so far") rather than an all-or-nothing 45s wall — a scoped call that is 44s away from finishing
  restarts from a warm cache on retry (`RESULT_CACHE_TTL_MS`/single-flight), so the "retry" advice in the message is
  sound, but a caller that retries once and gives up never gets the answer.

**7. Regression guard.** A worktree-specific diagnostics spec (create a real worktree in a test fixture — the repo
already has `run-diagnostics-provider-contract.ts` in `platform-core/src/testing/contracts` — add a case that runs
the contract against a `git worktree add` copy, not just the primary root) asserting scoped diagnostics on a
worktree file completes within a fixed budget (e.g. 10s) and returns the same answer as the identical file in the
main worktree. Nothing today exercises the provider against a second worktree at all.

**8. Verdict: mostly fixed, one open regression.** Main-thread blocking: **fixed** (`e70130bf5` + worker offload).
Scoping: **fixed and confirmed live** for the ordinary case. Output cap: **still missing** (inherited risk, not
triggered in these probes). Worktree-scoped timeout: **broken, newly confirmed live**, root cause unconfirmed.
**Priority P1** for the worktree case specifically (worktrees are this repo's primary parallel-lane mechanism —
21 live worktrees were listed by `ptah_git_worktree_list` in this same session, so lane agents calling scoped
diagnostics inside a worktree hit this today), **P2** for the missing output cap (design defect, not yet observed
causing harm post-scoping-fix).

---

## ptah_get_dirty_files

**1. Contract.** *"Get all files with unsaved changes in VS Code. Unlike 'git status', this shows unsaved buffers,
not committed changes."* `ptah-core-prompt.ts:44` maps `git status` (via Bash) to this tool: *"Shows unsaved VS Code
buffers too."* This mapping was flagged by the Wave-1 audit as a **wrong equivalence** (an agent asking "what
changed" wants `git status`'s committed/staged/untracked view, not editor-buffer dirtiness) — this audit did not
re-litigate that judgment call (it is a prompt-design question, not a tool-behaviour bug) but confirms the tool
itself behaves exactly as documented.

**2. Live behaviour.** Called with no open unsaved buffers in the Electron/VS Code host: `Found: 0 unsaved files` —
correct (there genuinely are none; `git status --short` in the same session shows only untracked task folders, no
modified tracked files). Sub-second. No native-tool comparison applies (there is no "unsaved buffer" equivalent in
Bash) — the only valid comparison is against `git status`, and by design this tool answers a different question.

**3. Code path.** `protocol-dispatcher.ts:740` (`case 'ptah_get_dirty_files'`) → IDE-only namespace, gated behind
`hasIDECapabilities` (`protocol-dispatcher.ts:319-325`) and eager only when IDE capabilities are present
(`IDE_EAGER_TOOLS`, `protocol-dispatcher.ts:407-411`).

**4-5. Regression forensics / root cause.** No defect found; not investigated further.

**6-7. Fix / guard.** None needed for the tool's own behaviour. The **prompt mapping** at `ptah-core-prompt.ts:44`
remains a design question for whoever owns that prompt (outside this tool-behaviour audit's scope) — recorded here
only because it is the only reason this tool is described as degraded anywhere in the source audits.

**8. Verdict: works.** Not a priority.

---

## ptah_project_detect_monorepo

**1. Contract.** *"Detect whether the workspace is a monorepo and identify the tool (nx, lerna, turborepo,
pnpm/yarn workspaces). Returns isMonorepo, type, the config files that indicated it, and package count when
detectable."*

**2. Live behaviour.** `{"isMonorepo":true,"type":"nx","workspaceFiles":["nx.json"]}` — correct, matches
`nx.json` at repo root and the repo's actual tooling. No `packageCount` field returned (description says "when
detectable" — acceptable if genuinely not computed here, not verified further). 60-char output, effectively
instant. **This is the tool that should be feeding `ptah_workspace_analyze`'s project-type decision and currently
is not** (see workspace_analyze §5/§6 above).

**3. Code path.** `protocol-dispatcher.ts:1835` (`case 'ptah_project_detect_monorepo'`), gated by the `'code'`
namespace toggle (`protocol-dispatcher.ts:370-382`).

**4-5. Regression forensics / root cause.** No defect found.

**8. Verdict: works**, and is the accurate counter-example that makes `ptah_workspace_analyze`'s wrong answer
avoidable with data the server already has. Not a priority on its own; referenced as the fix ingredient for
`ptah_workspace_analyze`.

---

## ptah_json_validate

**1. Contract.** *"Validate and repair a JSON file. Reads the file, extracts JSON from raw agent output (strips
markdown fences, prose, fixes trailing commas, unquoted keys, single quotes), validates against an optional schema,
and overwrites the file with clean formatted JSON."*

**2. Live behaviour.** Ran against `.mcp.json` (a real, already-valid JSON file in this repo): `## JSON Validation
Passed`, `Status: Valid JSON`, `File overwritten with clean, formatted JSON.` — correct. Note the tool **writes the
file** even when it was already valid and unchanged in content (re-formats it) — consistent with its documented
contract ("overwrites... with clean formatted JSON"), not a bug, but worth flagging to any caller that assumes a
validate-only, side-effect-free check exists elsewhere; it does not.

**3. Code path.** `protocol-dispatcher.ts:1084` (`case 'ptah_json_validate'`), gated by the `'json'` namespace
toggle.

**4-5. Regression forensics / root cause.** No defect found.

**8. Verdict: works.** Not a priority.

---

## ptah_memory_search

**1. Contract.** *"Search persistent memory from past sessions (facts, preferences, prior decisions) using hybrid
BM25 + vector search... NOTE: backed by the memory store — returns a 'not available' result on runtimes without it
(e.g. VS Code)."* `ptah-core-prompt.ts:51` and the `[!IMPORTANT]` memory-trigger block (`ptah-core-prompt.ts:70`)
mandate calling this before answering "last time"/"previously" questions.

**2. Live behaviour.** Query `"token audit ptah mcp diagnostics degradation"` returned 10 hits, several directly
relevant and useful for this very research task — including a hit (`type-check-offload-b3`) that **contradicted**
the task brief's "main thread" framing for `ptah_get_diagnostics` and was the trigger for re-checking that claim
against source (see get_diagnostics §3-4 above). This is a case where the tool delivered exactly what its contract
promises and materially changed this audit's conclusion. Some duplication between `content` and `chunkText` per hit
persists (matches the Wave-1 `mcp_surface.md` §2 finding) but is a minor formatting cost, not a correctness issue.

**3. Code path.** `protocol-dispatcher.ts:1794` (`case 'ptah_memory_search'`), gated by `'code'` namespace, eager
only where the SQLite layer is present (`SQLITE_EAGER_TOOLS`, `protocol-dispatcher.ts:414-417`) — this Electron
host has it.

**4-5. Regression forensics / root cause.** No defect found in this pass.

**8. Verdict: works**, and demonstrably useful. Not a priority for correctness; the `content`/`chunkText`
duplication (Wave-1 P4) remains a legitimate minor token-saving item but is out of scope to re-verify here beyond
noting it persists.

---

## ptah_web_search

**1. Contract.** *"Search the web for current information using your configured search providers (Tavily, Serper,
Exa). Every configured provider runs in parallel and the results are merged and de-duplicated... plus a narrative
summary and a Provider status section naming any provider that failed and why."*

**2. Live behaviour.** Query `"MCP server tools/list instructions field best practice"` → 3 results in 1.1s, one
provider configured (`serper`, status `ok`), a summary block plus per-result attribution — matches the contract
exactly, including the "Provider status" section the description promises.

**3. Code path.** `protocol-dispatcher.ts:969` (`case 'ptah_web_search'`), arguments validated against
`WebSearchArgsSchema` (`protocol-dispatcher.ts:431-441`, `.strict()` — rejects an unrecognized `provider` singular
key rather than silently dropping it, per the comment at :419-430).

**4-5. Regression forensics / root cause.** No defect found.

**8. Verdict: works.** Not a priority.

---

## ptah_git_worktree_add / list / remove

**1. Contract.** `add`: *"Create a new git worktree for parallel development. Checks out a branch into a separate
directory. Use createBranch to create and checkout a new branch."* `list`: *"List all git worktrees... path, branch,
HEAD commit, and whether each worktree is the main worktree."* `remove`: *"Remove a git worktree. The worktree
directory will be deleted."*

**2. Live behaviour.**
- `list` (before any change): 21 worktrees returned in a compact Markdown table (path/branch/HEAD/main flag) —
  matches `git worktree list` in shape and content; this is the repo's real, heavily-used parallel-lane state
  (branches like `feat/task-2026-533-marketplace-redesign`, `fix/task-418-codex-session-statistics`, etc., matching
  the PR/commit history visible in `git log`).
- `add` with `branch: "test-task559-worktree-probe"`, `createBranch: true` → created
  `.claude-worktrees/test-task559-worktree-probe-f3ef3fd219b6` successfully, sub-second.
- `remove` on that path → `"Successfully removed."`, sub-second. (The created branch itself was left behind by
  `remove`, as documented — `remove` deletes the worktree directory, not the branch; cleaned up afterward with
  `git branch -D`, outside the tool.)

**3. Code path.** `protocol-dispatcher.ts:1006` (`list`), `:1015` (`add`), `:1049` (`remove`), all gated by the
`'git'` namespace toggle (`protocol-dispatcher.ts:337-343`).

**4-5. Regression forensics / root cause.** No defect found. Matches the Wave-1 `mcp_surface.md` §3 latency note
(`git_worktree_add` median 6.7s across 9 slow-logged calls in the prior window) only loosely — this single call was
sub-second, consistent with "median 6.7s" meaning most calls are fast and a few (first-run npm install hooks,
antivirus scan on Windows, etc.) are slow; not enough data here to confirm or refute that distribution.

**8. Verdict: works.** Not a priority.

---

## execute_code (ptah.help, ptah.ide.actions, ptah.memory)

**1. Contract.** *"Execute TypeScript/JavaScript against the global `ptah` API for multi-step workflows only. Prefer
direct `ptah_*` tools: they are more focused and have lower overhead. Use `ptah.help(topic)` to discover APIs when
execute_code is necessary. `ptah.files` is read-only."* `ptah-core-prompt.ts:61-67` (IDE Access via execute_code)
scopes it to operations with no first-class tool: `ptah.ide.actions.organizeImports/rename`, `ptah.help()`,
`ptah.memory.list()`, `ptah.memory.purgeBySubjectPattern()`.

**2. Live behaviour.** `return await ptah.help();` → a compact 21-namespace directory (WORKSPACE, ANALYSIS, JSON,
GIT, IDE, ORCHESTRATION, AGENT, MEMORY/CORPUS, HARNESS, DASHBOARD), ~650 chars, each line naming its sub-APIs and
pointing to `ptah.help('namespace')` for detail — this is a genuinely good, small, self-documenting entry point and
matches its contract. Did not probe `ptah.help('ide')`/`ptah.ide.actions.*` or `ptah.memory.list/purgeBySubjectPattern`
individually in this pass (out of time budget for this audit) — recorded as **not tested**, not as working or broken.

**3. Code path.** `protocol-dispatcher.ts:610-616` (`if (name === 'execute_code')`) → `handleExecuteCodeCall`
(`protocol-dispatcher.ts:2051`, "Handle execute_code tool call") → `code-execution.engine.ts` (sandboxed
TS/JS execution against the `ptah` global built from the namespace builders this whole audit and the sibling
code-intel audit cover).

**4-5. Regression forensics / root cause.** Not investigated (no defect found in the one call made).

**8. Verdict: works** (for the one path tested — `ptah.help()`). Not a priority. `ptah.ide.actions` and
`ptah.memory.list/purgeBySubjectPattern` are **unverified** in this pass.

---

## ptah_count_tokens

Brief note only — not the focus of this audit's named scope, but not claimed by any other group either.
**1. Contract:** *"Count tokens in a file using the model-specific tokenizer. Use this instead of reading a file
just to check its size."* `ptah-core-prompt.ts:45` maps "Reading a file to check size" to this tool.
**2. Live behaviour:** called against `protocol-dispatcher.ts` (2,232 lines) → `Tokens: 15430`, 43-char total
response, effectively instant. Matches contract. **8. Verdict: works.** Not a priority.

---

## Summary

| Tool | Verdict | Root cause (one line) | Regressing commit | Fix (one line) | Guard | Priority |
|---|---|---|---|---|---|---|
| ptah_workspace_analyze | degraded | `detectNodeProjectType` checks `react` dep before `@angular/core` (project-detector.service.ts:194-197); the `angular.json`-first guard added to fix this only covers root-level Angular CLI, not Nx monorepos; `renderDirectoryTree` has no depth/entry cap and `tmp/` is not excluded | e4e2a7bd6 (2026-09-22, attempted fix, incomplete for this repo's own layout; bug present since 2b537f44c 2026-05-15 / exposed since ea36c1a72 2026-06-12) | Gate project-type detection on `monorepoDetector.detectMonorepo()` result first; cap `renderDirectoryTree` depth/entries; drop "Use this FIRST" until fixed | Fixture combining root deps spanning 2 frameworks + no root angular.json + real multi-app Nx tree, asserting `projectType !== 'react'`; char-budget spec for a 500-file flat directory | P1 |
| ptah_search_files | degraded | `formatSearchFiles` prints `files.length` with no truncation flag; provider gives no "more available" signal | none identified (long-standing) | Request `limit+1`, pass `atLimit` into formatter, append truncation notice | Formatter spec asserting a truncation marker when `results.length === limit` | P2 |
| ptah_get_diagnostics | mostly fixed / one open regression | Main-thread blocking and workspace-wide scoping are fixed (worker offload `ts-diagnostics-worker.ts`, per-file scope `type-script-diagnostics-provider.ts`); a worktree-scoped single-file call still hits the 45s budget for an unconfirmed reason; output has no cap | e70130bf5 (2026-08-30) fixed scoping/blocking; worktree-scope timeout is a newly confirmed, not-yet-diagnosed defect, no regressing commit identified | Diagnose worktree timeout with direct worker timing before fixing; cap `formatDiagnosticList` output | Diagnostics-provider contract run against a real second worktree, asserting parity with the main-worktree answer within a fixed budget | P1 (worktree case), P2 (missing output cap) |
| ptah_get_dirty_files | works | n/a | n/a | n/a | n/a | none |
| ptah_project_detect_monorepo | works | n/a | n/a | n/a | n/a | none (reference answer for workspace_analyze fix) |
| ptah_json_validate | works | n/a | n/a | n/a | n/a | none |
| ptah_memory_search | works | n/a | n/a | n/a | n/a | none |
| ptah_web_search | works | n/a | n/a | n/a | n/a | none |
| ptah_git_worktree_add/list/remove | works | n/a | n/a | n/a | n/a | none |
| execute_code (ptah.help tested) | works (partial coverage) | n/a | n/a | n/a | n/a | none |
| ptah_count_tokens | works | n/a | n/a | n/a | n/a | none |
