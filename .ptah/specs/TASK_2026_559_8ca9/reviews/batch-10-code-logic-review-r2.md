# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 4/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 3              |
| Serious issues      | 2              |
| Moderate issues     | 0              |
| Failure modes found | 5              |

Independent Batch 10 r2 review, after revision round 1. The inspection cap, Express reporting, original Angular-executor conflict and file statistics have concrete fixes. However, valid pnpm declarations and deep project layouts still produce success-looking incomplete inventories, and errors can disappear during rendering. This remains in the significant-problems band: the failures affect the central inventory answer, not just observability around an otherwise correct result. Working fixtures, preserved statistics, explicit inspection counts and passing checks separate it from the 1–3 range; the three undisclosed completeness failures prevent a 5–6 score.

Paths are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`. Evidence aliases denote these exact files:

- **DISC**: `libs/backend/workspace-intelligence/src/project-analysis/monorepo-member-discovery.ts`
- **PD**: `libs/backend/workspace-intelligence/src/project-analysis/project-detector.service.ts`
- **MD**: `libs/backend/workspace-intelligence/src/project-analysis/monorepo-detector.service.ts`
- **FD**: `libs/backend/workspace-intelligence/src/project-analysis/framework-detector.service.ts`
- **WS**: `libs/backend/workspace-intelligence/src/workspace/workspace.service.ts`
- **WA**: `libs/backend/workspace-intelligence/src/composite/workspace-analyzer.service.ts`
- **FMT**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts`
- **PD-spec**, **FMT-spec**: the respective adjacent `.spec.ts` files.

## r1 findings status

| r1 finding                                          | Status  | Code and spec evidence; remaining gap                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1: undisclosed 50-project cap                      | FIXED   | PD:318 counts discovered projects before slicing inspection to 200; PD:320 marks partial inspection and explains it. WS:483 carries that metadata; FMT:222 and FMT:251 calculate displayed/hidden counts against the total. PD-spec:747 and FMT-spec:343 pin the boundary. Independent 206-project probe returned total 206, inspected 200, incomplete, with six uninspected. The separate new depth bound fails disclosure (R2-B1); the fixed 50-project defect is not counted again. |
| B2: failed sole manifest deletes project            | PARTIAL | PD:329 always retains discovered members; PD:365 and PD:421 distinguish invalid manifests and attach an issue/unknown type. PD-spec:706, :722 and :738 cover malformed/read-failed manifests and unreadable discovery directories. FMT-spec:368 covers only a visible failed project. The project is now retained, but its error can vanish after the 25-row presentation cap (R2-B3).                                                                                                 |
| S1: hardcoded apps/packages layout                  | PARTIAL | MD:600, :617, :626 and :635 consume package-manager/tool declarations; DISC:225 scans Nx project.json roots. PD-spec:675, :768 and :793 cover nested Nx, custom workspaces and simple pnpm exclusions. Independent object-workspaces, Lerna and plain-JSON Rush probes succeeded. YAML comments and deep roots remain broken (R2-B2/R2-B1).                                                                                                                                            |
| S2: project types used as frameworks                | PARTIAL | WorkspaceProject now separates framework/type (PD:83); WS:551 runs per-project framework detection; WA:65 aggregates frameworks only. Express regression passes (PD-spec:768; analyzer root-scope spec:150). Nuxt with both nuxt and vue in its own manifest is still reported as Vue (R2-S2, remaining r1 gap).                                                                                                                                                                       |
| S3: dependencies override explicit Angular executor | FIXED   | PD:382 gives recognized executors precedence. PD-spec:691 exercises Angular build plus React tooling and checks angular/angular. A different conflict is introduced by treating every target as a build signal (R2-S1).                                                                                                                                                                                                                                                                |
| S4: Node root drops UI source statistics            | FIXED   | WS:493 unions original root type, language root type and inspected member types; WS:845/918 count that union in one walk. PD-spec:660 pins JSX/TSX/HTML preservation. Real-worktree probe returned .tsx 147, .jsx 0, .html 86, .scss 1, plus JS/TS/JSON/CSS.                                                                                                                                                                                                                           |

Only the five current failure modes below contribute to the counts. Fixed r1 triggers and multiple manifestations of the same remaining gap are not additional issues.

## Five logic questions

### 1. How does this fail silently?

Depth-limited discovery returns `complete: true` after abandoning deeper roots (DISC:178, :239). The pnpm parser converts valid commented YAML into unmatched or missing patterns without an issue (MD:61, :74, :615). A malformed manifest outside the rendered prefix produces no visible error because member issues never affect composition completeness (PD:327–340; FMT:241–249). These are R2-B1 through R2-B3.

### 2. What user action produces unexpected behaviour?

Moving an Nx app below five directory levels makes it disappear; adding a comment to a workspace glob can do the same (DISC:239; MD:61). Adding an Angular-named lint executor to a React Native project changes its reported framework to Angular even though its build remains React Native (PD:124, :376). See R2-B1, R2-B2 and R2-S1.

### 3. What input data produces a wrong answer?

`targets.build.executor = '@nx/react-native:bundle'` plus `targets.lint.executor = '@angular-eslint/builder:lint'` returns angular/angular (PD:51, :124, :376). An app whose dependencies contain both `nuxt` and `vue`, without a Nuxt config file, returns vue/vue (PD:472; FD:58; WS:555). See R2-S1/R2-S2.

### 4. What happens when a dependency fails?

A failed discovery-directory read sets incomplete and an issue (DISC:144). Failed JSON manifest reads produce an unknown project and an issue (PD:421), but a hidden member's issue is not surfaced (R2-B3). Framework detection still swallows optional detection errors (FD:78, :163). Existence probes also collapse provider failures into absence (file-system.service.ts:99); this is an existing limitation, not separately scored here. Sequential reads have count/depth limits but no elapsed-time deadline (DISC:132; PD:328; WS:542), so a stalled filesystem call can still block analysis. No new race, timer or disposal leak was demonstrated; WS:359 and WA:394 preserve per-computation fences.

### 5. What is missing that the requirements never mentioned?

The new completeness contract needs to cover every discovery bound and inspection error independently of the rendered rows (DISC:59; WS:42; FMT:212). Executor evidence needs a distinction between application build and auxiliary targets (PD:118). Framework detection needs to retain refinements when type detection narrows the app to Vue (WS:65). These are the causes of the scored findings, not extra counts. Timeout policy and supported declaration/glob dialects remain unspecified.

## Failure modes

### 1. R2-B1 — Blocking: the new depth cap silently drops projects

- Trigger: An Nx member at `apps/a/b/c/d/web/project.json` (six directory levels), or the equivalent member selected by `apps/**`.
- Symptom: Both probes returned zero projects, `complete: true`, `issues: []`. The formatter consequently presents a clean zero-project inventory. The executor report's claim that every bound is disclosed is false for depth.
- Evidence: DISC:178 returns on excessive glob depth without changing completeness; DISC:239 returns at the Nx depth boundary without checking/reporting unvisited child directories. DISC:269 only handles the directory-read cap. PD:318 treats the resulting directory list as the discovered total; FMT:230 omits the incomplete warning when true.
- Current handling: Read-count and candidate-count limits are disclosed; depth is not. Nx also deliberately skips `src` and dot-directories at DISC:244; the result does not describe that search boundary.
- Impact: Callers mistake a partial member set and missing framework coverage for a complete answer.
- Recommendation: Surface depth truncation whenever potentially relevant children or unmatched pattern segments remain; carry it through `ProjectDiscovery`. State the Nx search exclusions/boundary where completeness cannot be guaranteed. Add depth-boundary regressions for both explicit/wildcard membership and Nx scanning. The three-level _rendered tree_ limit is a different contract and should remain unchanged.

### 2. R2-B2 — Blocking: valid YAML comments silently erase pnpm membership

- Trigger: `packages:\n  - 'services/*' # applications\n`, or a comment line between two package entries.
- Symptom: The first probe had a real `services/api/package.json` but returned zero projects with `complete: true`. The second listed `services/*`, then a comment, then `tools/*`; only the service was found, with no warning about the missing tool app.
- Evidence: MD:61 recognizes only a contiguous run of dash lines; MD:74 strips outer quotes without handling a trailing comment. MD:615 trusts the extracted strings and adds no parsing issue. DISC:219 expands the resulting patterns and DISC:279 returns success when they match nothing.
- Current handling: Inline YAML flow arrays are also unsupported by this parser; unsupported content becomes a fallback or a partial pattern list rather than a declaration parse failure. The simple quoted list spec at PD-spec:793 does not cover comments.
- Impact: Harmless edits to workspace configuration change project counts/framework coverage in a successful analysis.
- Recommendation: Use a suitable already-available parser through an allowed dependency, or explicitly support/reject the declaration forms consumed here. At minimum, valid comment/blank-line handling must preserve every list item, and unparseable declared membership must produce incomplete status rather than a clean inventory. Add inline-comment and inter-item-comment regressions with real manifests.

### 3. R2-B3 — Blocking: inspection errors disappear outside the displayed project prefix

- Trigger: Thirty sorted member projects; the last project's sole package.json is malformed or unreadable.
- Symptom: The project is retained as unknown with an issue in the internal array, but the rendered result contains neither `unknown`, the parse/read error, nor `incomplete`. It shows 30 found and five more. This is an integration gap left by the B2 fix, not a repeat of the fixed deletion bug.
- Evidence: PD:327 collects member results but PD:334 returns the discovery-only `complete`/`issues` unchanged. WS:483 copies those values. FMT:241 slices to the first 25 rows before reading `p.issue` at :248. FMT:262 can only render composition-level issues. FMT-spec:385 explicitly supplies `complete: true` for a failed member but tests only two visible rows.
- Current handling: Error visibility depends on alphabetical project position and the display cap. The Frameworks set can omit the failed member's framework without a visible coverage warning.
- Impact: The analysis looks fully inspected and successful despite a known manifest failure; callers cannot know that retry/repair is needed. The normal formatter output already lacks the error, so downstream text budgeting cannot restore it.
- Recommendation: Aggregate inspected-member failures into completeness/inspection metadata independently of the display selection. Render a bounded failed-member count and diagnostic summary even when affected rows are hidden. Add an end-to-end detector-to-formatter case with failure after row 25.

### 4. R2-S1 — Serious: an auxiliary executor overrides the application build framework

- Trigger: A React Native app declares `@nx/react-native:bundle` for build and `@angular-eslint/builder:lint` for lint, with React dependencies.
- Symptom: Independent probe returned `{type:'angular', framework:'angular'}`.
- Evidence: PD:118–126 extracts executors from **all** targets and discards target names. PD:376 searches the global rule list; `/angular/i` at PD:51 precedes the React rule at :56. WS:544 then preserves that executor-derived framework without checking the app manifest.
- Current handling: “First match” means rule ordering, not build-target authority. Any matching auxiliary target can win over a recognized build target. This differs from the now-fixed r1 dependency-versus-Angular-build conflict.
- Impact: The new precedence fix can replace a correctly detectable app framework with a tooling framework and also select the wrong extension set for statistics (WS:498).
- Recommendation: Preserve target identity and rank recognized application build/serve executors above lint/test/storybook/tooling. Match specific executor semantics rather than arbitrary substrings, or expose conflicting evidence instead of picking the first rule. Add a mixed-target regression.

### 5. R2-S2 — Serious: package-only Nuxt refinement remains unreachable

- Trigger: A workspace member package.json contains dependencies `nuxt` and `vue`, with no nuxt.config file and no framework-specific executor.
- Symptom: Independent composition plus `withProjectFrameworks` probe returned type `vue`, framework `vue`, losing the explicitly declared Nuxt refinement.
- Evidence: PD:472 detects Vue. WS:551 calls FD with type Vue. FD:58 only reads package.json for Node or React, so FD:142's existing Nuxt rule is unreachable for this member. WS:555 falls back to `UI_TYPE_FRAMEWORK[Vue]` even though `UI_TYPE_REFINEMENTS[Vue]` at WS:69 explicitly allows Nuxt.
- Current handling: Nuxt is retained when a Nuxt config or executor supplies it, but not for this ordinary own-manifest combination. PD-spec:768 only proves Express/React, not the Nuxt sibling of r1 S2.
- Impact: Batch 10's per-app framework-from-manifest requirement remains incomplete. This is a remaining r1 S2 case, counted once; it is not claimed to be a new change to the frozen single-app detector.
- Recommendation: In the monorepo composition path, obtain actual manifest framework evidence for every supported JS app type before applying refinement/precedence rules. Preserve single-app behavior. Add nuxt+vue dependency-only and config/executor variants.

## Blocking issues

R2-B1, R2-B2 and R2-B3 above are blocking: their file/line evidence, triggers, impact and concrete fixes are specified under Failure modes. Each produces a success-looking result after losing known or discoverable information.

## Serious issues

R2-S1 and R2-S2 above are serious: app framework classification is wrong on the demonstrated inputs. R2-S2 is the unresolved refinement portion of r1 S2, not an additional count for the fixed Express defect.

## Moderate and minor issues

None separately scored. NestJS without a recognized executor is a pre-existing capability gap, not a regression proved by this revision: FD:138–162 has no NestJS package rule, and the independent old-detector probe also returned undefined. The current output's `node` is the project's **type**, not a false `node` framework (PD:84; WA:68; FMT:243). Nest executors are recognized at PD:63. Adding a package rule would improve coverage, but is not evidence that this change lost a previously detected NestJS framework.

## Data flow and caller impact

1. **OK:** `namespace-builders/core-namespace.builders.ts:100–111` under the FMT parent code-execution directory resolves the per-call root and obtains info, structure and projectInfo.
2. **OK:** WS:428 detects monorepo before type; the single-app branch remains at WS:444–452. MD:600 reads declared membership. **Gap R2-B2:** pnpm parsing can lose members before discovery begins.
3. **Gap R2-B1:** DISC expands declarations/scans Nx. It counts bounded reads but silently stops at depth. **OK for tested other caps:** DISC:254 and :269 mark candidate/read truncation; PD:320 marks the 200-inspection cap.
4. **OK with gaps:** PD:354 retains invalid JSON members as unknown. **R2-B3:** failures stay only on rows. **R2-S1:** auxiliary executors can decide type/framework.
5. **Gap R2-S2:** WS:537 adds framework evidence; Vue narrowing prevents package-based Nuxt refinement. WA:431 aggregates only actual framework fields. WA:446 publishes `<tool>-monorepo` while ProjectInfo.type stays a language-level type.
6. **OK:** WS:493/845 preserves old root statistics and adds inspected-member extensions in one walk. Existing count traversal still treats unreadable subtrees as empty (WS:925); this was not introduced by the new union.
7. **Gap R2-B3:** FMT:241 discards hidden row errors. **OK on required fixtures:** FMT:37/:40/:48 bounds tree depth, entries and characters; :61 excludes required directories.
8. Other consumers: `namespace-builders/analysis-namespace.builders.ts:274` now receives the monorepo label. `core-namespace.builders.ts:124` returns the framework set alone, without ProjectDiscovery metadata. `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts:437` consumes statistics keys and :455 takes the first aggregated framework; the statistics fix preserves its extension evidence, but classification gaps feed its framework choice. `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts:567` independently sniffs the root with the new language type, so it does not consume the per-app framework set. WS:623 and WA:513 now choose generic Node templates/critical files for a JS monorepo. These are identified behavior changes; no separate routing defect is asserted without a more specific caller contract.

## Requirements fulfilment

| Requirement                                                      | Status                         | Gap/evidence                                                                                                                                                                                              |
| ---------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo-first detection, combined Nx fixture never React root   | COMPLETE                       | WS:428; PD-spec:632; WA:446; real repo probe reports 100 members                                                                                                                                          |
| Declared app set, including custom/nested membership             | PARTIAL                        | R2-B1/R2-B2; simple package array/object, negation, Lerna and plain-JSON Rush probes pass                                                                                                                 |
| Real per-app frameworks, separated from type                     | PARTIAL                        | Express fixed; R2-S1/R2-S2                                                                                                                                                                                |
| Honest 200-project inspection limit                              | COMPLETE                       | PD:318; FMT:234; 206-project probe                                                                                                                                                                        |
| Honest completeness across discovery and inspection              | PARTIAL                        | R2-B1/R2-B3                                                                                                                                                                                               |
| Single-app detection and existing single-signal tests            | COMPLETE for executed behavior | PD:213; WS:447; current single-signal suite passes. No git/baseline byte comparison was performed under the reviewer no-git rule; the executor's unchanged-source claim is not independently certified.   |
| File statistics preserve preexisting supported extensions        | COMPLETE                       | WS:493, :851, :918; PD-spec:660; real repo counts                                                                                                                                                         |
| Tree depth 3, 25 entries/directory, required excludes            | COMPLETE                       | FMT:37, :40, :61, :136; FMT-spec:143 onward pass                                                                                                                                                          |
| 500 flat files under 4,000 chars; fixture whole analysis <=8,000 | COMPLETE                       | Independent flat output 424 chars/475 hidden; current large-fixture assertion FMT-spec:326 passes; independently composed real-root output 5,224 chars                                                    |
| Frozen shared prompts; no new tools/split                        | COMPLETE within named scope    | Reviewed changes are detector/service/spec/formatter paths; no tool registration or shared prompt change is part of this scope. Executor report records unchanged prompts; no independent git comparison. |
| Degradation audit TOTAL 300; validate-deps passes                | COMPLETE                       | Both independently executed and passed                                                                                                                                                                    |

Implicit requirements not addressed: truthful completeness at every cap/error boundary; target-purpose-aware executor precedence; framework refinements independent of language/app type.

## Edge cases and cost

| Case                                               | Handled                              | Evidence/remaining concern                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 206 discovered projects                            | YES                                  | 200 inspected, six disclosed; PD:318; independent probe                                                                                                                                                                                                                                                                                                  |
| >3,000 directory reads / >2,000 matched candidates | YES                                  | Synthetic provider probes reported incomplete and exact cap notes; DISC:254/:269                                                                                                                                                                                                                                                                         |
| Depth beyond five / unsearched project roots       | NO                                   | R2-B1                                                                                                                                                                                                                                                                                                                                                    |
| Invalid/read-failed sole JSON manifest             | PARTIAL                              | Retained as unknown; hidden-row error lost, R2-B3                                                                                                                                                                                                                                                                                                        |
| Array/object workspaces and `!packages/skip`       | YES on tested forms                  | MD:50; DISC:204/:277; independent probes                                                                                                                                                                                                                                                                                                                 |
| pnpm comments between/after entries                | NO                                   | R2-B2                                                                                                                                                                                                                                                                                                                                                    |
| Lerna `packages` / Rush `projectFolder`            | YES on tested plain-JSON forms       | MD:617/:626; independent probes; no claim of complete JSONC/glob dialect coverage                                                                                                                                                                                                                                                                        |
| Symlink loop during discovery                      | YES on tested provider semantics     | A real junction to the fixture root was skipped and scan ended after five directory reads. DISC:160/:242 require exact Directory; CLI/Electron providers return SymbolicLink, VS Code preserves its bit. Literal paths can follow a symlink, but pattern segments/depth bound that traversal; no infinite discovery loop demonstrated.                   |
| node_modules / .claude-worktrees / dist scanning   | CONDITIONAL                          | Nx and `**` skip these at DISC:160/:244; ordinary wildcard matching still admits dist (DISC:192), and literals can enter excluded names (DISC:187). Probe `*/*` found dist/copy but skipped node_modules and dot-worktrees. This follows the documented declaration override, not the renderer exclusion contract; it is not counted as an extra defect. |
| Negated subtrees on large repos                    | BOUNDED, not pruned early            | Exclusions apply at DISC:277 after scanning/candidate checks, so excluded directories can consume the budget. The read/candidate caps disclose exhaustion; no separate undisclosed-cost defect demonstrated.                                                                                                                                             |
| Manifest/target conflict                           | PARTIAL                              | Original Angular-build conflict fixed; auxiliary-target conflict R2-S1                                                                                                                                                                                                                                                                                   |
| Empty monorepo                                     | YES when actually empty              | FMT:218/:239 renders the section; FMT-spec:400; false empty results remain R2-B1/B2                                                                                                                                                                                                                                                                      |
| Repeated/concurrent roots and disposal             | YES in existing scoped tests         | WS:359/:513/:1119; WA:394/:455/:629; no new resource leak demonstrated                                                                                                                                                                                                                                                                                   |
| Arbitrarily long names/descriptions                | Not universally bounded by formatter | Project rows/metadata are uncapped strings (FMT:249/:298). Required fixture budgets pass; no universal formatter-only <=8k guarantee is claimed.                                                                                                                                                                                                         |

Discovery costs up to 3,000 directory reads, then up to 2,000 candidate checks with three manifest existence probes each, plus up to 200 inspections and framework detection (DISC:30/:36/:261; PD:21/:328; WS:542). The matched set is built before the candidate slice and one directory listing has no entry-count limit; the limits bound reads/inspection, not total input bytes or wall time. No timeout or cancellation contract was added. On this worktree the independent discovery/framework/statistics/tree/count probe completed in 303 ms. This does not establish latency on remote filesystems.

## Verification performed

- Read all nine named source/spec files, archived r1 review, executor report including Revision round 1, only Batch 10 plus the requested later-batches note, and context/User Decisions. Traced framework/file-system adapters, formatter boundaries and named consumers. No task-description.md, implementation-plan.md or current code-style-review.md exists in the discovered task folder.
- `ptah_search_files` returned no AGENTS.md; native hidden-file search also found none. No direct file-read or Write tool is listed, so native PowerShell reads and the deliverable write were used. No source edits or git operations were performed. Temporary probes/fixtures were written only under the OS temp directory.
- Scoped `ptah_get_diagnostics` for the two owning projects returned **typescript-compiler: Errors 0, Warnings 0**.
- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache`: all six targets passed, exit 0, duration 1m 2s. Output tailed to 30 lines.
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache`: passed, exit 0, **TOTAL 300 unsuppressed site(s)**. Output tailed to 12 lines.
- `node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache`: passed including its dependency task, exit 0. Output tailed to 8 lines.
- Independent probes: `C:/Users/abdal/AppData/Local/Temp/ptah-559-r2-logic-probe.cjs` and `C:/Users/abdal/AppData/Local/Temp/ptah-559-r2-additional-probe.cjs`. They transpile current TS in memory, use actual detection/framework/formatter/statistics methods and stack profiles, stub DI/platform imports, and use real temporary files; read/candidate-cap tests use bounded synthetic filesystem providers. They reproduced all five findings, confirmed inspection/read/candidate disclosures, simple membership forms, junction termination, and flat rendering. The real-worktree measurement composes the actual methods' output into the formatter; it is not an end-to-end live MCP session.
- The suite's passing r1 tests do not exercise depth truncation, YAML comments, a failed member after row 25, mixed-purpose executor targets, or dependency-only nuxt+vue refinement. The existing single-signal tests pass as currently written; preservation relative to an earlier commit and frozen-prompt byte identity remain unverified independently because this role prohibits git operations.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: An apparently complete workspace answer silently omits members or hides known inspection failures.
- What a robust implementation would add: depth-bound disclosure; reliable declaration parsing with explicit unsupported/error status; failure summaries independent of project display limits; build-target-aware executor precedence; manifest framework refinement for every JS app type; regression fixtures for the five demonstrated cases.
