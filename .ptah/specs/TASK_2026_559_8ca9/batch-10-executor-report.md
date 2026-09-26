# Batch 10 executor report — TASK_2026_559_8ca9

Executor: backend-developer (sub-agent). No git operations were run.

## Task 10.1 — Monorepo-aware project type: COMPLETE

### What changed

- `workspace-intelligence/src/project-analysis/project-detector.service.ts`
  - New exported types `WorkspaceProject` (`name`, `path`, `type`) at :58 and `MonorepoComposition` (`rootType`, `projects`) at :68.
  - New `detectMonorepoComposition(workspacePath)` at :259. It computes the root type with the existing
    `detectProjectType`, but a UI framework read off the root (`react`/`angular`/`vue`/`nextjs`) becomes `node`.
    A monorepo root's manifest aggregates every app's dependencies, so a framework read from it is a guess about
    one app.
  - It lists projects as the immediate children of `apps/` and `packages/` (`MONOREPO_PROJECT_DIRS`, :21). The list is
    sorted and bounded at 50 (`MAX_MONOREPO_PROJECTS`). A directory with no `project.json` and no `package.json` is not
    a project.
  - Per-project type (`detectMonorepoProject`, :324), in this order:
    1. A UI framework named by the project's own files, through `detectProjectType(projectDir)` (its own package.json
       dependencies, angular.json, ...).
    2. Its `project.json` executors, via `EXECUTOR_TYPE_RULES` (:46): next, angular, react/expo, vue/nuxt, python,
       dotnet, rust, go.
    3. Any other type its own files name.
    4. Otherwise `node` if the project has any executor, else `general`.
  - `readJsonManifest` (:369) carries the one new flagged catch. It has a `// degradation-audit: optional-capability`
    marker. The `listMonorepoProjectDirs` catch logs and `continue`s, so it is not a flagged site and has no marker.
  - `detectProjectType` itself is unchanged; only its doc comment points to the new method.
- `workspace-intelligence/src/workspace/workspace.service.ts`, `analyzeRoot` (:383-400)
  - It calls `detectMonorepo` first. For a monorepo it takes the root type from `detectMonorepoComposition` and does
    not run root framework detection (`framework` is `undefined`). A single-app workspace follows the old path
    unchanged: `detectProjectType` then `detectFramework`.
  - `WorkspaceAnalysisResult` gains `projects: WorkspaceProject[]` (:58), which is empty for a single app.
  - `ProjectInfo` gains optional `monorepoType` and `projects` (:84), and `getProjectInfo` fills both (:489).
- `workspace-intelligence/src/composite/workspace-analyzer.service.ts` (deviation 1)
  - For a monorepo, `computeWorkspaceInfo` reports `projectType: '<monorepoType>-monorepo'` (e.g. `nx-monorepo`, :446-449).
    Its `frameworks` are the sorted distinct per-project types (`monorepoFrameworks`, :64), excluding `general` and
    `unknown`.
  - A single-app root keeps its old path, moved unchanged into `detectRootFrameworks` (:407).

### Specs added

- `project-detector.service.spec.ts`, new describe "Nx monorepo fixture (temp dir)" (:499). The fixture is built in
  `os.tmpdir()` and read through a real `FileSystemService` over node `fs`.
  - Its shape: `nx.json`; root deps `react` + `@angular/core`; no root angular.json.
  - Apps: `apps/dashboard` (angular-devkit executor), `apps/landing` (vite executor + own package.json with react),
    `apps/api` (`@nx/js:node`), `apps/storefront` (`@nx/next:build`, no name → directory name), and `apps/notes`
    (README only, so not a project).
  - The specs:
    1. Root-only `detectProjectType` still says `react`. This documents the bug shape the composition replaces.
    2. `detectMonorepo` → Nx. The composition `rootType` is `node` (never `react`), and `projects` =
       api:node, dashboard:angular, landing:react, storefront:nextjs.
    3. A real `WorkspaceService` with real detectors: `detectMonorepo` runs before `detectProjectType`
       (`invocationCallOrder`). `getProjectInfo` → `type: node`, `monorepoType: nx`, version read, and the same app set.
    4. With nx.json and apps/ removed, the same dependencies go through single-app detection (`react`), unchanged.
- `workspace-analyzer.root-scope.spec.ts` (deviation 1): for a monorepo `ProjectInfo`, `projectType === 'nx-monorepo'`
  and `frameworks === ['angular','node','react']`. Neither `detectProjectType` nor `detectFrameworks` is called.
- The existing single-signal specs are unchanged and green, including the :194 "still detect React ... when no
  angular.json exists" spec, which has no nx.json.

### Measured on this worktree's own root

I ran a real `WorkspaceService` with node-fs detectors on this worktree's root, through `formatWorkspaceAnalysis`.
This was a throwaway spec, deleted afterwards.

- Project Type is `nx-monorepo`. Frameworks: angular, node, react. There are 13 projects, for example
  `ptah-extension-webview (angular)`, `ptah-landing-page (angular)`, `ptah-tui (react)`, `ptah-cli (react)` and
  `ptah-electron (node)`.
- The root `ProjectInfo.type` is `node`, and nothing reports `react` as the workspace type.

## Task 10.2 — Tree depth/entry cap and excludes: COMPLETE

### What changed (`vscode-lm-tools/.../mcp-core/mcp-response-formatter.ts`)

- New constants:
  - `TREE_MAX_DEPTH = 3` (:37)
  - `TREE_MAX_ENTRIES_PER_DIR = 25` (:40)
  - `TREE_MAX_CHARS = 3_500` (:48)
  - `TREE_MORE_LINE_RESERVE = 40` (:51)
  - `TREE_MAX_NAME_CHARS = 80`, above which names are cut with `…` (:54)
  - `TREE_EXCLUDED_DIRS` = tmp, dist, .claude-worktrees, .ptah, node_modules, .git, coverage (:61)
- `renderDirectoryTree` (:130) was rewritten.
  - **Selection** is breadth-first by level and round-robin across the directories of a level. A wide first directory
    therefore cannot starve its siblings.
  - Each directory keeps a contiguous prefix of at most 25 entries, directories first.
  - Every shown directory reserves 40 chars for its own `... and N more` line, which keeps the total within
    `TREE_MAX_CHARS` plus one root summary line. The renderer cap alone bounds the output, whatever the walk returns.
  - **Rendering** is depth-first. `... and N more` is written only for a directory whose level was reached, so a
    directory at the depth limit is never mis-summarised. Excluded directories are neither listed nor counted.
- The tree is pushed to json2md as a raw string (:321), the same pattern as `formatDiagnosticList`. It is no longer a
  `p` block, which put a blank line between every entry and doubled the size.
- A monorepo `### Projects` section renders `name (type) — path`, capped at `PROJECTS_DISPLAY_CAP = 25` followed by
  `... and N more` (:199, :253).

### Specs added (`mcp-response-formatter.spec.ts`, describe at :143)

- 500 flat files: the section is < 4,000 chars, files 000-024 are shown, the line reads `... and 475 more`, and there
  is one entry per line.
- Shared budget: 12 packages × 25 long-named modules. Both `pkg-00` and `pkg-11` list a first module.
- Per-directory cap: 30 dirs + 3 files → `pkg-24` shown, `pkg-25` and the files hidden, `... and 8 more`.
- Depth: level1/level2/level3 are shown. level4 and level3's files are not, and no false "and N more" line appears.
- Excludes: none of the 7 names, or their contents, appear. `src/` does appear, with no "more" line.
- Wide and deep: 40 dirs × 3 levels with 120-char names and 500 files each. The section is < 4,000 chars and names are
  cut with `…`.
- Whole analysis on a large monorepo fixture:
  - Input: 30 apps × 500 files, the same again under libs, tmp/ and .ptah/ with 500 files each, 60 deps, 90 devDeps
    and 30 projects.
  - Result: ≤ 8,000 chars, `### Projects` present with a `... and 5 more` line, and nothing under tmp/ shown.

### Measured sizes

| Measurement                                                           | Chars | Tokens (gpt-tokenizer) |
| --------------------------------------------------------------------- | ----- | ---------------------- |
| 500-flat-file directory, Directory Structure section                  | 394   | —                      |
| 500-flat-file directory, whole `formatWorkspaceAnalysis` output       | 458   | —                      |
| This worktree's root, Directory Structure section                     | 2,565 | —                      |
| This worktree's root, whole `ptah_workspace_analyze` formatted output | 4,606 | 1,492                  |

The whole-analysis result is under both limits of the Batch 2e budget (8,000 chars / 2,000 tokens,
`tool-result-budget.ts:48-50`). Before the raw-string change the same root rendered 4,718 chars with blank lines
between entries.

### Structure walk (validation note)

`workspace.service.ts` `shouldSkipDirectory` (:918) already skips every dot-directory (so `.git`, `.ptah` and
`.claude-worktrees`), plus `dist`, `node_modules` and `coverage`. It does **not** skip `tmp`. The walk therefore still
reads `tmp/` to depth 3, and `countAllFiles` counts its files in Total Files; the renderer drops it.

I did not change this. The renderer cap alone satisfies the budget, as required, and adding `tmp` to the walk would
change the Total Files figure. This is the file to edit if the walk cost matters.

## Verification

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache --parallel=2`
  → "Running targets test, lint, typecheck for 2 projects" → "Successfully ran targets test, lint, typecheck for 2 projects".
  Targeted runs showed 64/64 formatter specs and 62/62 across the project-detector, analyzer root-scope and workspace specs.
- `node_modules/.bin/nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` → "Successfully ran target typecheck for 2 projects".
- `node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered by package.json dependencies."
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache` → `libs/backend/vscode-lm-tools: 2 ok (baseline 2)`,
  `libs/backend/workspace-intelligence: 1 ok (baseline 1)`, "TOTAL 300 unsuppressed site(s)".
- `npx prettier --check` on the 7 changed source/spec files → "All matched files use Prettier code style!".
- `ptah-core-prompt.ts`, `ptah-system-prompt.constant.ts` and `tool-description.builder.ts` are unchanged
  (`git diff --quiet`).

## Deviations

1. **Files outside the 10.1 list:** `workspace-analyzer.service.ts` and `workspace-analyzer.root-scope.spec.ts`. The MCP
   answer's Project Type and Frameworks come from the analyzer's `WorkspaceInfo`, not from `WorkspaceService`.
   `computeWorkspaceInfo` called `detectProjectType` + `detectFrameworks` on the root a second time, so it would still
   have printed `node` and a root-guessed `react` framework. The change there is limited to the monorepo branch.
2. **Monorepo root `ProjectType` is `node`**, not a new enum member. The `nx-monorepo` label is built in the analyzer
   as `${monorepoType}-monorepo`. Adding a `ProjectType` member would have forced edits to every exhaustive
   `Record<ProjectType, …>` table, the template map and the file-statistics map. Consumers of `ProjectInfo.type`
   (enhanced prompts, templates, statistics) now see `node` for a JS monorepo instead of a guessed framework.
3. **Formatter additions beyond the tree cap:** a `### Projects` section, and the tree is emitted as a raw string (no
   blank lines between entries).
4. **Prettier reformatting:** `project-detector.service.spec.ts` and `mcp-response-formatter.spec.ts` failed
   `prettier --check` at HEAD (missing trailing commas). `prettier --write` reformatted their existing lines, so their
   diffs include formatting-only hunks.

## Out-of-scope observations

- `tool-description.builder.ts:325` still says "Use this FIRST ... architecture overview". Research §6 suggested
  dropping "Use this FIRST" until both fixes landed. With this batch the type and size claims hold, so I left it
  unchanged (Decision 4: correct only false claims). "architecture overview" is loose wording, not a false claim.
- Project discovery covers `apps/*` and `packages/*` only. It does not read nx.json `workspaceLayout`, libs, nested
  project roots or pnpm/yarn globs. Non-JS monorepos (.sln, uv, poetry) keep their root type and usually list no
  projects.
- `.ptah/specs/TASK_2026_561_9e57/context.md` was already modified in the worktree by another session. I did not touch it.

## Revision round 1 (r1 REVISE 4/10)

Review: `reviews/batch-10-code-logic-review-r1.md`. I fixed all six findings. No git write operations were run.

Paths used below:

- **PD** — `workspace-intelligence/src/project-analysis/project-detector.service.ts`
- **MD** — `.../monorepo-detector.service.ts`
- **DISC** — `.../monorepo-member-discovery.ts` (NEW)
- **WS** — `.../workspace/workspace.service.ts`
- **WA** — `.../composite/workspace-analyzer.service.ts`
- **FMT** — `vscode-lm-tools/.../mcp-core/mcp-response-formatter.ts`

### B1 — the discovery cap was hidden, so counts were false

- The per-directory 50-candidate slice is gone. Discovery now counts only directories that hold a manifest
  (`project.json`, `package.json` or `pyproject.toml`), so plain folders take no project slot.
- Inspection is capped at `MAX_INSPECTED_PROJECTS = 200` (PD:21). `MonorepoComposition` (PD:91) now carries
  `totalProjects`, `complete` and `issues`. When the cap is hit, `complete` is false and the issues include the line
  `"<n> of <total> projects not inspected (limit 200)"` (PD:302).
- The walk bounds in DISC are 3,000 directory reads, depth 5, and 2,000 matched candidates (DISC:30-36). Hitting any
  of them sets `complete: false` and adds a disclosure line (DISC:257, :272).
- WS passes all of this through as `ProjectDiscovery` on `WorkspaceAnalysisResult` and `ProjectInfo` (WS:42).
- FMT `projectsBlocks` (FMT:212) now prints:
  - `**Found:** N projects`
  - `**Inspected:** M (Frameworks above cover these only)` when some were not inspected
  - `**Discovery:** incomplete` when discovery was cut short
  - a `... and X more (Y not inspected)` line, where X is computed against the **discovered total**
  - discovery notes, capped at 5
- Specs:
  - project-detector: "r1 B1: counts every project past the inspection cap and says so" (206 libs plus 20 plain
    folders → total 210, 200 inspected, issue line present).
  - formatter: "r1 B1: counts hidden projects against the discovered total, not the inspected list". It expects
    `... and 181 more (6 not inspected)`; r0 printed `... and 175 more`.

### B2 — an unreadable sole manifest silently removed the project

- A candidate is now found by manifest existence (or by the listing, for Nx), never by a successful read.
  `detectMonorepoProject` (PD:354) always returns a project.
- `readJsonManifest` (PD:421) returns `absent`, `invalid` or `ok`. When a manifest is invalid and nothing else names a
  type, the project gets `type: unknown` (PD:392) and the issue `"<file> could not be read or parsed"`.
- The old `optional-capability` catch is gone. The new catch returns a status object, so it is not a sentinel site.
- In DISC, a directory that cannot be read is recorded as `"<dir>/ could not be read"` and sets `complete: false`.
- Specs:
  - "r1 B2: keeps a project whose only manifest is malformed, as unknown with a reason"
  - "... cannot be read" (the provider rejects that path, standing in for EACCES)
  - "r1 B2: a directory that cannot be read marks discovery incomplete"
  - formatter: "r1 B2 + S2" renders `broken (unknown) — services/broken — package.json could not be read or parsed`.

### S1 — a hardcoded apps/packages layout ignored declared membership

- **Membership parsers are reused, not duplicated.** The parsing inside `detectMonorepo` was lifted into shared pure
  functions:
  - `workspacesFieldPatterns` (MD:50)
  - `pnpmWorkspacePatterns` (MD:60)
  - `stringEntries` (Lerna `packages`)
  - `rushProjectFolders`
  - `nxProjectRoots`
  - `tomlArrayEntries` (MD:114), which replaces the private `countTomlArrayEntries`

  The existing detectors now count packages with these same functions. Their IO order is unchanged, and the existing
  monorepo-detector specs pass unchanged.

- The new `detectDeclaredMembers(root, type)` (MD:574) returns a `DeclaredMembership`:
  - package.json `workspaces` (array and `{packages}` forms) plus pnpm-workspace.yaml, for every JavaScript tool
  - Lerna `packages`, Rush `projectFolder`, and the legacy Nx/workspace.json `projects` map
  - uv `members`
  - `scanProjectJson: true` for Nx
  - `supported: false` for .NET solutions and Poetry
  - read and parse failures, as `issues` (two `// degradation-audit: reported` catches)
- DISC `discoverMemberDirectories` (DISC:115):
  - expands the globs (`*`, `?`, `{a,b}`, `**`, `!` exclusions) with bounded walks
  - for Nx, adds every directory holding a `project.json`; its search skips node_modules, dist, build, out, tmp,
    coverage, target, src and dot-directories
  - falls back to `apps/*` + `packages/*` **only** when nothing is declared, and says so in the issues (DISC:214)
- WS calls `detectDeclaredMembers` and then `detectMonorepoComposition(root, membership)`. FMT renders the Projects
  section even when zero projects are found.
- Specs:
  - "r1 S1: finds Nx projects under libs/ and nested app roots"
  - "r1 S1 + S2: follows package.json workspaces (services/*, nested **) and keeps Express"
  - "r1 S1: follows pnpm-workspace.yaml globs including exclusions"
  - "r1 S1: discloses the apps/* + packages/* fallback"
  - formatter "r1 S1: renders the section for a monorepo with no projects found"

### S2 — languages were reported as frameworks

- `WorkspaceProject` now carries a `framework` separate from `type`.
- WS `withProjectFrameworks` (WS:537) runs the existing `FrameworkDetectorService.detectFramework` against each
  project's own directory, so Express stays Express.
  - For a UI type, a detected framework that contradicts the type falls back to the type's own framework
    (`UI_TYPE_REFINEMENTS`, WS:65).
  - An executor-declared framework is kept as is.
- WA `monorepoFrameworks` (WA:65) aggregates frameworks only. A language such as `node` is no longer listed as a
  framework.
- FMT shows `name (type, framework)`.
- Specs:
  - "r1 S1 + S2 ..." expects `@acme/api:node:express`
  - the analyzer root-scope spec now expects `['angular','express','react']`, with no `node`

### S3 — the dependency heuristic overrode the app's explicit Angular executor

- `EXECUTOR_RULES` (PD:40) now maps an executor to a type and an optional framework (including Nuxt and NestJS), and
  it is checked **before** the app's own dependency detection (PD:354).
- Single-app `detectProjectType` is unchanged.
- Spec: "r1 S3: an explicit Angular build executor wins over React tooling in the app deps". It expects
  angular/angular; r0 returned react.

### S4 — reclassifying the root as `node` dropped source statistics

- `getFileStatistics` (WS:845) now takes a list of project types and counts their union of extensions in **one** walk
  (`countFilesByExtension`, WS:918). Before, it made one full walk per extension.
- For a monorepo, the list is:
  - `manifestRootType`, the pre-monorepo single-app answer
  - the root type
  - every inspected project's type

  Every statistic the old output had is therefore still present (WS:493). A single-app workspace passes `[projectType]`,
  so its results are the same.

- Spec: "r1 S4: keeps the JSX/TSX statistics a react root had after the root becomes node". It expects `.tsx 1`,
  `.jsx 1`, `.html 1`, `.scss 0`; under r0 `node` had no `.tsx` or `.jsx` key.

### Fails-before

- Every r1 spec either uses the new API (`detectDeclaredMembers`, the composition's completeness fields, `framework`)
  or asserts a value r0 produced differently:
  - S1: r0 had no services, libs or nested projects.
  - B1 (formatter): `175` instead of `181`.
  - S3: r0 said `react`.
  - S4: r0 had no `.tsx` key.
  - B2: r0 omitted the project.
- r0 is not committed and git restore/stash is not allowed, so I did not run these specs against r0 itself. The r0
  outcomes above are the reviewer's probe results (review §Failure modes).

### Re-measured on this worktree's root (throwaway spec, deleted)

- Discovery: `nx-monorepo`, 100 projects found and 100 inspected, `complete: true`, no issues, 345 ms.
- Frameworks: angular, react.
- Statistics: `.tsx 147`, `.ts 5160`, `.html 86`, `.json 509`, `.js 31`, `.css 16`, `.scss 1`, `.jsx 0`.
- **Whole analysis: 5,224 chars / 1,687 tokens**, within the 8,000-char / 2,000-token budget. The Projects section
  shows 25 projects, then `... and 75 more`.
- The 10.2 tree bounds are unchanged, and all tree specs still pass.

### Verification

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache --parallel=2`
  → "Running targets test, lint, typecheck for 2 projects" → "Successfully ran targets test, lint, typecheck for 2 projects".
  Targeted runs showed 216/216 (project-analysis, workspace and analyzer root-scope specs) and 67/67 (formatter).
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` → "Successfully ran target typecheck for 2 projects".
- `nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered by package.json dependencies."
- `nx run degradation-audit:lint --skip-nx-cache` → `vscode-lm-tools: 2 ok (baseline 2)`,
  `workspace-intelligence: 1 ok (baseline 1)`, "TOTAL 300 unsuppressed site(s)".
- `npx prettier --check` on the 9 changed/new files → "All matched files use Prettier code style!".
- The frozen prompt files and `tool-description.builder.ts` are unchanged (`git diff --quiet`).

### Deviations (round 1)

1. **New file DISC** (`monorepo-member-discovery.ts`). Glob expansion and the bounded walks are their own
   responsibility, and keeping them out of PD keeps PD at detection only. **MD** was also edited: I extracted its
   parsers so they could be shared, and added `detectDeclaredMembers`. Neither file was in the batch list.
2. **The WorkspaceService file-statistics walk was rewritten** to one pass for all extensions. The counts are the same;
   the number of walks drops from one per extension to one.
3. **Process slip.** I briefly ran `prettier --write` over the whole `workspace-intelligence/src` directory. It
   reformatted 9 unrelated files, and I wrote each one back to its exact HEAD content with `git show HEAD:<path>`, a
   read-only git command. `git status` afterwards lists only the batch files.
4. **Frameworks now list real frameworks only.** On this repository the list shrank from angular/node/react to
   angular/react. NestJS apps built with generic executors show `node`, because the existing framework detector has no
   NestJS package rule, and adding one is outside S2's "keep what the old detector finds".

### Out-of-scope observations (round 1)

- `FrameworkDetectorService.detectFromPackageJson` has no `@nestjs/core` rule. Adding one would let NestJS projects
  report their framework.
- `ProjectDiscovery` is not exported from `workspace-intelligence/src/index.ts`. It is not needed by the current
  consumers, which read `ProjectInfo`.

## Revision round 2 (r2 REVISE 4/10)

Review: `reviews/batch-10-code-logic-review-r2.md`. I fixed all five r2 findings. No git write operations were run, and
Prettier was run only on the changed files. The path aliases are the same as in round 1.

### Fails-before (recorded before any fix)

I added six regression specs to PD-spec and ran them once against the round-1 code
(`jest ... project-detector.service.spec.ts -t "r2 "`). The result was **6 failed**:

| Spec                                                                    | Failure on r1 code                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| r2 B1 … Nx project below the depth bound (:810)                         | `complete` Expected false, Received true                     |
| r2 B1 … `**` workspace pattern (:827)                                   | `complete` Expected false, Received true                     |
| r2 B2 … pnpm trailing and between-item comments (:840)                  | projects Expected `[services/api, tools/cli]`, Received `[]` |
| r2 B3 … member failures summarised whatever their position (:867)       | `complete` Expected false, Received true                     |
| r2 S1 … the build target decides, not an auxiliary lint executor (:883) | Expected react/react, Received angular/angular               |
| r2 S2 … nuxt + vue in the member's own manifest reports Nuxt (:906)     | framework Expected nuxt, Received vue                        |

After the fixes all six pass. FMT-spec gained one more pin, "r2 B3: a failed project past the 25-row prefix is still
stated through the composition summary" (:400). It checks the rendering path; the formatter already printed
composition issues, so this one pins the behaviour rather than demonstrating a failure.

### R2-B1 — the depth bound was silent

- DISC now records every place where a directory below the bound is left unsearched:
  - Nx scan: a directory at the bound that still has searchable subdirectories (DISC:261).
  - `**` expansion: the same condition (DISC:189).
  - Wildcard segment: a wildcard segment past the bound (DISC:203).
- Any of these sets `complete: false` and adds the issue
  `"directories deeper than <n> levels were not searched; more projects may exist"` (DISC:290). The issue travels
  through `ProjectDiscovery` and the formatter's Discovery line, the same way the 200-inspection limit does.
- Literal pattern segments cost no directory read, so they are no longer depth-bound.
- `MAX_DISCOVERY_DEPTH` was raised from 5 to 12 (DISC:37). The 3,000-read budget still bounds the cost.
- Why the bound was raised: at 5, this repository's own scan was flagged incomplete. Its deepest searchable directory is
  9 levels down (`apps/ptah-extension-vscode/assets/plugins/.../scenes`), and a full scan takes 292 reads. At 12 the
  real answer is complete and nothing is lost silently.
- The two specs build their fixtures relative to the constant, so they stay valid if the bound changes.

### R2-B2 — YAML comments erased pnpm membership

- The pnpm-workspace.yaml parser was rewritten (MD:96):
  - `stripYamlComment` (MD:63) removes a `#` at line start or after whitespace, outside single or double quotes.
  - Block-list items may have comments and blank lines between them.
  - The list ends at the next top-level key.
  - The flow form `packages: ['a', "!b"]` is supported.
  - Quotes are removed, and `!` negations are kept.
- The same function still counts packages in `detectMonorepo`. All existing monorepo-detector specs pass unchanged,
  including "complex YAML" (count 2).
- A declared `packages` key whose list cannot be parsed now adds the issue
  `"pnpm-workspace.yaml packages list could not be parsed"` (MD:664). That makes the analysis incomplete instead of
  looking like "no members".

### R2-B3 — member failures disappeared behind the 25-row display cap

- After inspection, `detectMonorepoComposition` collects every project that has an `issue`.
- If any exist, it sets `complete: false` and puts this summary **first** in `issues`, ahead of any display limit on
  notes (PD:380):
  `"N project(s) could not be fully inspected: <path> (<reason>), …, and K more"`. Up to 5 are named
  (`FAILED_PROJECTS_NAMED`).
- The formatter's `**Discovery:** incomplete` line and its notes therefore show the failure whatever the project's row
  position.

### R2-S1 — an auxiliary executor overrode the build framework

- `projectTargets` (PD:127) keeps each target's name alongside its executor.
- `decidingExecutorRule` (PD:152) decides in this order:
  1. the `build` target's executor
  2. any other non-auxiliary target (serve, bundle, …)
- Targets matching `AUXILIARY_TARGET` (lint, test, e2e, storybook, format, typecheck, docs, release, publish, version;
  PD:144) never decide. Any executor still marks the project as an Nx-built `node` fallback.
- The r1 S3 spec (Angular build plus React tooling) still passes.

### R2-S2 — Nuxt with both nuxt and vue in its own manifest was reported as Vue

- `withProjectFrameworks` now sniffs every JavaScript app type (`JS_APP_TYPES`: node, react, angular, vue, nextjs;
  WS:65, :565) as `node`. The existing detector then reads the project's own package.json in its refinement order:
  next, nuxt, angular, react, vue, express.
- The refinement check against the app type (`UI_TYPE_REFINEMENTS`) is unchanged, so Vue + Nuxt gives Nuxt, and a
  contradicting framework still falls back to the type's framework.
- Single-app detection is unchanged.

### Re-measured on this worktree's root (throwaway spec, deleted)

- Discovery: `nx-monorepo`, 100 projects found and 100 inspected, `complete: true`, no issues, 326 ms.
- Frameworks: angular, react.
- **Whole analysis: 5,224 chars / 1,687 tokens**, at most 8,000 chars and within 2,000 tokens.

For comparison, with the depth bound still at 5 the same root rendered 5,369 chars, `complete: false`, with the depth
issue.

### Verification

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache --parallel=2`
  → "Running targets test, lint, typecheck for 2 projects" → "Successfully ran targets test, lint, typecheck for 2 projects".
  Targeted runs showed 222/222 (project-analysis, workspace and analyzer root-scope specs) and 68/68 (formatter).
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` → "Successfully ran target typecheck for 2 projects".
- `nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered by package.json dependencies."
- `nx run degradation-audit:lint --skip-nx-cache` → `vscode-lm-tools: 2 ok (baseline 2)`,
  `workspace-intelligence: 1 ok (baseline 1)`, "TOTAL 300 unsuppressed site(s)".
- `npx prettier --check` on the 9 changed/new files → "All matched files use Prettier code style!".
- `git status --short` lists only the batch files: 8 modified plus the new `monorepo-member-discovery.ts`. Also listed
  are the task-folder documents and entries owned by other sessions, which were already there before this round
  (`TASK_2026_561_9e57/context.md`, `TASK_2026_562_4b1d/`, and the two r1/r2 review files).

### Deviations (round 2)

1. **`MAX_DISCOVERY_DEPTH` raised to 12**, with disclosure, rather than kept at 5 with disclosure. Keeping 5 would have
   marked this repository's own analysis incomplete.
2. **pnpm flow-form support** (`packages: [...]`) was added along with the comment fix. An unparseable declared list is
   now an issue, as R2-B2 recommended.

### Out-of-scope observations (round 2)

- There is still no wall-clock deadline on discovery or inspection reads. Only count and depth bounds apply (review §4).
- Explicit declarations can still match `dist`-named directories through ordinary wildcards. This is by design:
  declarations override the search skip list (review edge cases).

## Bounded correction (post-cap, after r3 REVISE 6/10)

Review: `reviews/batch-10-code-logic-review-r3.md`. This round fixes exactly R3-S1, R3-S2 and R3-M1. No git write
operations were run, and Prettier was run only on the changed files.

### Fails-before (recorded before any fix)

| Spec                                                                                              | Failure on the round-2 code                                                                            |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| PD-spec :906 "r3 S1: a quoted brace glob in a pnpm flow array is one pattern"                     | `SyntaxError: Invalid regular expression: /^'(?:services$/: Unterminated group` (the analysis aborted) |
| PD-spec :921 "r3 S1: an unusable workspace glob is a reported issue, not a failed analysis"       | `SyntaxError: Invalid regular expression: /^(?:apps$/: Unterminated group`                             |
| PD-spec :934 "r3 S2: an application bundle target outranks a custom-named tooling target"         | Expected react/react, Received angular/angular                                                         |
| FMT-spec :430 "r3 M1: states the inspection failure before long project rows and bounds each row" | Expected ≤ 8000, Received 16121                                                                        |

After the fixes all four pass.

### R3-S1 — a quoted brace glob in a pnpm flow array aborted the analysis

- The flow form (`packages: [...]`) is now split by `splitFlowItems` (MD:87), which splits only on commas outside
  quotes and outside `{...}` braces. `['{services,tools}/*']` stays one pattern and matches both member directories.
- Every declared pattern is compiled through `tryGlob` (DISC:102) before use. That covers each wildcard segment of an
  include, and the whole of an exclude.
- A pattern that cannot compile no longer throws out of the analysis. `unusable` (DISC:230) sets `complete: false` and
  adds the issue `"workspace pattern '<p>' could not be used"`. An example is an unbalanced brace split at a slash,
  such as `{apps/a,libs/b}`.
- The new catch returns `undefined` with a `// degradation-audit: reported` marker, because every caller records the
  issue. The audit total is unchanged at 300.

### R3-S2 — a custom-named tooling target outranked the application target

The rule was inverted. `decidingExecutorRule` (PD:169) now decides in this order:

1. **Application targets, in authority order.** `APPLICATION_TARGETS` (PD:143): build, bundle, serve, start, export,
   package, build-android, build-ios, run-android, run-ios. The first of these whose executor maps to a framework
   decides.
2. **Other targets, only if no application target named a framework.** Any remaining target whose executor is not
   tooling. Tooling is recognised by the executor's own semantics (`AUXILIARY_EXECUTOR`, PD:160: eslint, lint, jest,
   vitest, karma, test, storybook, cypress, playwright, prettier, format), not by the target's name.

Consequences:

- An unknown target name such as `check` can no longer outrank `bundle`.
- A real application target with a custom name (e.g. `build-contest` running an Angular builder) is no longer
  discarded, because target-name substring filtering is gone.
- The r1 S3 and r2 S1 specs still pass.

### R3-M1 — long project rows pushed the inspection reason out of the budget

- `projectsBlocks` in FMT now puts status first (FMT:224):
  1. `**Found:**`, `**Inspected:**` and `**Discovery:** incomplete`
  2. the discovery notes, which lead with the inspection-failure summary; each note is clipped to 400 chars
  3. then the project rows
- Each row is bounded with `clip` (FMT:212): name ≤ 60, path ≤ 80, per-row reason ≤ 80, each followed by `…` when cut
  (FMT:205). A row is at most about 240 characters regardless of the input.
- The M1 spec uses 30 projects with 300-char names and paths:
  - output ≤ 8,000 chars (it was 16,121)
  - the failure summary comes before the first row
  - every project line is ≤ 200 chars

### Re-measured on this worktree's root (throwaway spec, deleted)

- `nx-monorepo`, 100 projects found and 100 inspected, `complete: true`, no issues, 354 ms.
- Frameworks: angular, react.
- **Whole analysis: 5,224 chars / 1,687 tokens**, at most 8,000 chars and within 2,000 tokens.

### Verification

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache --parallel=2`
  → "Running targets test, lint, typecheck for 2 projects" → "Successfully ran targets test, lint, typecheck for 2 projects".
  Targeted runs showed 225/225 (project-analysis, workspace and analyzer root-scope specs) and 69/69 (formatter).
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` → "Successfully ran target typecheck for 2 projects".
- `nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered by package.json dependencies."
- `nx run degradation-audit:lint --skip-nx-cache` → `vscode-lm-tools: 2 ok (baseline 2)`,
  `workspace-intelligence: 1 ok (baseline 1)`, "TOTAL 300 unsuppressed site(s)".
- `npx prettier --check` on the 6 files changed this round → "All matched files use Prettier code style!".
- `git status --short` shows the same batch files as round 2, plus the new r3 review file. The entries owned by other
  sessions (`TASK_2026_561_9e57/context.md`, `TASK_2026_562_4b1d/`) were already there before this round.

### Deviations

None. This round changed only MD, DISC, PD, FMT and the two spec files.
