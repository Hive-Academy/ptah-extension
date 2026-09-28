# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 4/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 2              |
| Serious issues      | 4              |
| Moderate issues     | 0              |
| Failure modes found | 6              |

Batch 10, independent r1 review. The monorepo-first ordering and bounded tree work on the supplied fixtures. Project discovery and framework reporting still fail on supported, ordinary monorepo layouts; two paths silently lose projects. This separates the score from 5–6: the gaps affect the core requested answer, rather than just peripheral edge cases. It is above 3 because the required Nx example, single-app tests, tree bounds, and scoped verification pass.

Paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`. Abbreviations: **PD** = `libs/backend/workspace-intelligence/src/project-analysis/project-detector.service.ts`; **WS** = `libs/backend/workspace-intelligence/src/workspace/workspace.service.ts`; **WA** = `libs/backend/workspace-intelligence/src/composite/workspace-analyzer.service.ts`; **FMT** = `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts`. Every abbreviated evidence reference denotes that exact file.

## Five logic questions

### 1. How does this fail silently?

B1: PD:312 discards candidates after 50 without completeness metadata. FMT:262 computes the omitted count from the already shortened array. B2: PD:380 converts an unreadable/malformed manifest into absence; PD:335 then omits the project entirely. Neither condition reaches the tool caller as degraded analysis.

### 2. What user action produces unexpected behaviour?

Analyzing a workspace whose declared packages live in `services/*`, `libs/*`, or nested `apps/team/web` yields no corresponding projects (S1, PD:21, PD:306). Analyzing a React/Nx workspace now removes JSX/TSX statistics because its root is classified as Node (S4, WS:394, WS:741).

### 3. What input data produces a wrong answer?

An Express package becomes framework `node` (S2, WA:71). An Angular build executor plus React tooling in the app's devDependencies produces project type `react` (S3, PD:346). Sixty app manifests produce 25 displayed projects plus “25 more,” although 35 are undisplayed (B1, FMT:262).

### 4. What happens when a dependency fails?

A failing manifest read is swallowed and can erase the app (B2, PD:375). A failing directory read logs and continues with an incomplete project list (PD:298). There is no new timeout/cancellation handling around sequential project reads (PD:267); latency of a stalled provider remains unbounded. The latter is a residual risk, not an additional scored defect. Existing cache fences remain intact (WS:437 and WA:457); no new race or resource leak was demonstrated.

### 5. What is missing that the requirements never mentioned?

The composition needs an explicit completeness/error contract, independent language and framework fields, and a policy for contradictory app signals. Existing statistics consumers also need to preserve supported extensions after a monorepo root stops masquerading as one app (PD:68, WA:64, WS:741). These omissions are manifested by B1/B2 and S2–S4, not counted again.

## Failure modes

### B1 — Blocking: undisclosed discovery cap makes counts and framework coverage false

- Trigger: More than 50 immediate app/package directories; alternatively, ordinary nonproject directories consume candidate slots before real packages.
- Symptom: A successful answer silently omits projects and their frameworks. Probe: 60 app manifests, with Vue only in app 59, returned 50 projects and no Vue; the rendered projects list said `... and 25 more` after showing 25. The correct undisplayed count is 35.
- Evidence: PD:307 adds all directories before checking manifests; PD:312 slices to 50; WA:71 aggregates only survivors; FMT:255 and FMT:262 display/count only that shortened array.
- Current handling: No `incomplete`, discovered count, omitted-candidate count, or discovery boundary is carried in `MonorepoComposition` (PD:68). The downstream spool cannot recover these projects: `protocol-dispatcher.ts:891` passes the already formatted string to budgeting, and `tool-result-budget.ts:236` treats that string as raw output (both under the FMT directory).
- Impact: An agent treats a partial inventory and missing framework as the complete workspace answer.
- Recommendation: Preserve discovery completeness through all layers. Count actual project candidates separately from ordinary folders, disclose caps and uninspected candidates, and compute the display summary against a known total (or explicitly say the total is unknown). Add >50-project and nonproject-slot regression cases. No new tool is needed.

### B2 — Blocking: failed sole manifest read silently deletes a project

- Trigger: An app has only `package.json` (or only `project.json`), and it is unreadable, temporarily invalid during a save, or parses to a nonobject.
- Symptom: The app disappears from an otherwise successful composition. An injected EACCES on `apps/app-00/package.json` reduced the probe's selected inventory from 50 to 49 and removed app-00.
- Evidence: PD:375–384 collapses read/parse failures to `undefined`; PD:335–336 interprets that as no project. PD:381 explicitly claims the project remains listed, which is contradicted by the preceding gate.
- Current handling: No result error, warning, or degraded flag. Directory-read failure similarly logs and continues at PD:298–304.
- Impact: A transient I/O failure looks like a real absence and is cached in successful workspace analysis (WS:438).
- Recommendation: Distinguish absent from unreadable/invalid manifests. Retain a discovered project with unknown type and a surfaced diagnostic, or mark the composition incomplete. Test read rejection, malformed JSON, and a failed parent-directory read.

### S1 — Serious: hardcoded layout bypasses declared workspace membership

- Trigger: Yarn/package.json workspaces `services/*`; equivalent pnpm/Lerna/Turbo layouts; Nx projects under `libs/`, a custom apps directory, or nested app roots.
- Symptom: Those apps/packages and their frameworks are absent. Probe with root `workspaces: ['services/*']` and `services/api/package.json` returned `projects: []`. A nested group lacking its own manifest is skipped without visiting its children.
- Evidence: PD:21 restricts parents to `apps` and `packages`; PD:306 reads immediate children only; PD:335 rejects grouping directories. `libs/backend/workspace-intelligence/src/project-analysis/monorepo-detector.service.ts:324` detects workspaces declared in package.json, but the subsequent composition never consumes that declaration.
- Current handling: WA:433 suppresses root framework detection for every detected monorepo, even when discovery returns no projects. FMT:252 omits the Projects section entirely for that empty result.
- Impact: The monorepo label is correct but the requested app set is missing on normal supported layouts.
- Recommendation: Resolve project roots from the detected workspace's declarations/configuration, including nested roots and libs, with a bounded discovery policy and explicit incomplete status where support is unavailable. Exercise pnpm globs, Yarn array/object workspaces, Lerna/Turbo membership, and nested Nx fixtures.

### S2 — Serious: project languages replace actual frameworks

- Trigger: A monorepo app's own package.json declares Express (also affects finer distinctions such as Nuxt versus Vue).
- Symptom: The public Frameworks section reports `node`, and per-app output has no Express signal. Probe: the new app detector returned `node`, while the existing framework detector on the same app returned `express`.
- Evidence: PD:58 only carries `type: ProjectType`; WA:64–74 constructs frameworks from those types; WA:433 bypasses `detectRootFrameworks`. `libs/backend/workspace-intelligence/src/project-analysis/framework-detector.service.ts:158–159` already recognizes Express, but it is never called per app.
- Current handling: Language-level types are presented under the Frameworks heading (FMT:240).
- Impact: Batch 10 does not meet per-app framework reporting and can lose a previously visible Express signal. `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts:455` consumes the first framework, so this also changes prompt context to `node`.
- Recommendation: Carry the app's language/type separately from its framework(s); run existing framework detection against each discovered app's own manifests and merge executor evidence. Aggregate actual frameworks for WorkspaceInfo. Keep single-app detection unchanged.

### S3 — Serious: app dependency heuristic overrides its explicit Angular build target

- Trigger: An app project.json has `@angular-devkit/build-angular:application`, its dependencies include `@angular/core`, and devDependencies include React tooling.
- Symptom: Probe returned `type: react` despite the explicit Angular application executor.
- Evidence: PD:339 uses the single-app dependency heuristic; PD:346–349 takes that UI answer before the recognized executor. PD:417 ranks React before Angular within combined production/dev dependencies.
- Current handling: Executor evidence is calculated but discarded whenever ownType is any recognized UI type.
- Impact: Moving root guessing into app manifests still gives a wrong app framework when tooling dependencies coexist with an explicit build declaration.
- Recommendation: Give recognized application build executors/configuration priority over generic dependency heuristics, or report conflicting/multiple evidence rather than claiming one wrong framework. Do this only in composition so the frozen single-signal behavior remains unchanged. Add this combined app fixture.

### S4 — Serious: root reclassification drops existing source statistics

- Trigger: A React/Next/Angular/Vue monorepo is reclassified to Node, as intended by this batch.
- Symptom: JSX/TSX, Vue, HTML, CSS and SCSS counts previously available for the relevant old type disappear. Probe with one `.tsx` and one `.jsx` returned only `.js: 0`, `.ts: 0`, `.json: 62` under Node; the React path returned both source counts as 1.
- Evidence: WS:394 selects composition.rootType; WS:481 passes analysis.projectType into statistics; WS:741 restricts Node statistics to `.js`, `.ts`, `.json`, whereas WS:742–745 include framework extensions.
- Current handling: The existing type-specific statistics table receives the new language-level root type without adaptation.
- Impact: The workspace tool loses real source information. `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts:436–439` derives language information from these extension keys, so JSX/TSX evidence is lost there as well.
- Recommendation: For monorepos, count the union of supported source extensions independently of the synthetic root type, or derive a complete union from project composition. Preserve single-app statistics. Add a real mixed-source statistics regression.

## Blocking issues

B1 and B2 above require revision: both convert incomplete inspection into success-looking inventory. Their triggers, evidence, impact, and fixes are specified in the numbered failure modes.

## Serious issues

S1–S4 above require revision: ordinary workspace declarations, actual frameworks, explicit executor evidence, and existing statistics are not preserved end to end.

## Moderate and minor issues

None separately scored. The renderer's name shortening and depth limit are deliberate bounds, not counted as defects. Whole-output size with arbitrary metadata remains governed by the shared budget layer; the 8,000-character assertion proves the supplied fixture, not every possible manifest name/description.

## Data flow

1. **OK:** `core-namespace.builders.ts:100–110` resolves the per-call root and requests info/structure/projectInfo (under `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders`).
2. **OK:** WS:383 calls monorepo detection before project-type detection. The single-app branch still uses existing detectors.
3. **GAPS B1/B2/S1:** PD:267 discovers and reads projects; membership, completeness and read errors can be lost before formatting.
4. **GAPS S2/S3:** PD:339 classifies apps; WA:433 turns project types into frameworks.
5. **GAP S4:** WS:481 selects statistics using the changed root type. Templates now select `node` (WS:519); this generic root choice alone is not a defect. Agent generation also separately detects a root framework (`libs/backend/agent-generation/src/lib/services/orchestrator.service.ts:567`), so it does not consume the new per-app set consistently; no additional defect is counted without a narrower expected routing contract.
6. **OK within supplied tree shape:** FMT:136 allocates a shared tree budget; FMT:188 counts hidden nonexcluded children; FMT:321 emits a nested Markdown list. Exact exclusion matching at FMT:89 retains `distribution`.
7. **GAP B1:** FMT:262 has only the capped composition count. **OK:** `protocol-dispatcher.ts:891` applies the existing response path; shared budgeting bounds/spools formatted text, but cannot restore information lost in detection.

## Requirements fulfilment

| Requirement                                                                        | Status                             | Gap                                                                                                                    |
| ---------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 10.1 monorepo detection before project type                                        | COMPLETE                           | WS:383; real fixture call-order assertion at project-detector.service.spec.ts:608                                      |
| Nx combined root-dependencies fixture reports monorepo + app set, never React root | COMPLETE                           | Supplied direct-app fixture passes; WA:448 supplies nx-monorepo                                                        |
| Per-app frameworks and supported workspace app set                                 | PARTIAL                            | S1–S3, B1–B2                                                                                                           |
| Single-app detection retained                                                      | COMPLETE for examined behavior     | Existing detector branch retained; scoped tests pass; no git comparison performed                                      |
| 10.2 depth 3, per-directory 25, required excludes                                  | COMPLETE                           | FMT:37, FMT:40, FMT:61; fixture specs pass                                                                             |
| 500 flat files under 4,000 chars, correct hidden count                             | COMPLETE                           | Independent probe: whole minimal response 424 chars, 475 hidden                                                        |
| Whole supplied analysis fixture <=8,000 chars                                      | COMPLETE                           | mcp-response-formatter.spec.ts:273 fixture and passing project suite                                                   |
| Preserve useful preexisting monorepo information                                   | PARTIAL                            | S2/S4                                                                                                                  |
| No new tools or split; frozen prompts                                              | COMPLETE within reviewed file list | No new tool or prompt edits in the executor's seven-file scope; independent diff verification unavailable by role rule |

Implicit requirements not addressed: distinguish incomplete inspection from complete inventory; preserve framework semantics and source statistics across root reclassification.

## Edge cases

| Case                                     | Handled                        | How                                                | Concern                                          |
| ---------------------------------------- | ------------------------------ | -------------------------------------------------- | ------------------------------------------------ |
| 500 flat files                           | YES                            | 25 entries plus 475 more                           | Probe and supplied spec                          |
| Wide/deep tree                           | YES                            | Depth, entry and shared character limits           | Supplied wide/deep and sibling-budget specs pass |
| Excluded directory vs distribution       | YES                            | Exact set membership                               | Probe retains distribution                       |
| 60 app manifests                         | NO                             | First 50 candidates only                           | B1                                               |
| Read rejection / malformed sole manifest | NO                             | Project omitted                                    | B2                                               |
| Declared services/* or nested roots      | NO                             | Not traversed                                      | S1                                               |
| Express app                              | NO                             | Framework becomes node                             | S2                                               |
| Angular executor + React tooling         | NO                             | Dependency heuristic wins                          | S3                                               |
| JSX/TSX under Node-classified monorepo   | NO                             | Extensions not counted                             | S4                                               |
| Concurrent calls / invalidation          | YES in existing tests          | Root-keyed promises and cancellation fences        | No new concurrency regression demonstrated       |
| Arbitrary long metadata                  | YES at outer response boundary | Existing budget layer cuts/spools formatted output | No universal formatter-only 8k guarantee claimed |

## Verification performed

- Read the seven executor-named source/spec files, Batch 10 and its later-batches note, context/User Decisions, and the executor report. Traced filesystem, monorepo/framework detectors, namespace/formatter/budget boundaries and agent-generation consumers. No source edits or git operations.
- `ptah_search_files` found no AGENTS.md; native hidden-file search also found none. No task-description.md, implementation-plan.md or code-style-review.md exists in this task folder. No file-read or Write tool is listed; native PowerShell reads and the deliverable write were used. Task state documents were not edited.
- Scoped `ptah_get_diagnostics` returned **Unavailable: TypeScript check still running after 45s**. This is not clean-diagnostics evidence. The separate Nx typechecks below passed.
- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache`: all six targets passed, 2m36s. Output tailed.
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache`: passed, **TOTAL 300 unsuppressed site(s)**. Output tailed. The suppression marker does not establish correctness of B2.
- `node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache`: passed, including its dependency task. Output tailed.
- Independent temporary Node probe transpiled actual detector, framework detector, WorkspaceService and formatter code in memory, used the actual stack-profile registry and real filesystem fixtures under the OS temp directory, and stubbed DI/platform boundaries only. It reproduced all six findings and checked flat-tree output/exact exclusions. Probe path: `C:/Users/abdal/AppData/Local/Temp/ptah-559-r1-logic-probe.cjs` (resolved using the OS TEMP variable at execution). No repository test/source file was added.
- Supplied tests cover happy-path executor-only apps and the tree bounds, but do not exercise declared custom membership, >50 projects, read-failure completeness, Express preservation, conflicting executor/dependency signals or monorepo source-statistics preservation.
- No UI/runtime end-to-end MCP session was exercised. Ordinary tree Markdown is structurally valid by inspection; no universal claim is made for adversarial filenames. The formatter returns Markdown and its fallback returns serialized JSON; no malformed-JSON regression was demonstrated.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: A successful workspace analysis presents an incomplete project inventory as complete, with missing or incorrect framework information.
- What a robust implementation would add: declaration-aware bounded discovery; propagated completeness/read-error metadata; actual per-app framework detection with explicit signal precedence; monorepo-wide source statistics; regression cases for the six demonstrated failures.
