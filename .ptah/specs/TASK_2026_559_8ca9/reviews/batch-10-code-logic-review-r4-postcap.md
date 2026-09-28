# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 7/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 2        |
| Failure modes found | 2        |

Batch 10, independent post-cap r4 review of the bounded correction. All three primary r3 reproductions are fixed and pinned by specs. No Blocking or Serious defect was demonstrated under this review's explicit realistic-workspace severity rule. Two uncommon residual cases remain below. APPROVED means the specified gate is satisfied, not that the parser supports every YAML form or that tooling can never influence classification.

The working original regressions, passing scoped checks, and successful formatter-through-budget probe put this in the 7–8 band rather than 5–6. The two residual correctness gaps and incomplete boundary coverage prevent an 8–10 score.

All evidence paths are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`. These aliases denote exact files:

- **MD**: `libs/backend/workspace-intelligence/src/project-analysis/monorepo-detector.service.ts`
- **DISC**: `libs/backend/workspace-intelligence/src/project-analysis/monorepo-member-discovery.ts`
- **PD**: `libs/backend/workspace-intelligence/src/project-analysis/project-detector.service.ts`
- **WS**: `libs/backend/workspace-intelligence/src/workspace/workspace.service.ts`
- **WA**: `libs/backend/workspace-intelligence/src/composite/workspace-analyzer.service.ts`
- **WA-spec**: `libs/backend/workspace-intelligence/src/composite/workspace-analyzer.root-scope.spec.ts`
- **FMT**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts`
- **BUDGET**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts`
- **PD-spec**, **FMT-spec**: the adjacent `.spec.ts` files of PD and FMT.

## r3 findings status

| Finding                                                      | Status                                                                    | Code, spec and independent evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R3-S1: quoted brace-flow comma split aborts analysis         | FIXED for the reported primary trigger; unusual scalar variants remain    | MD:87, :132 preserve `['{services,tools}/*']` as one pattern. DISC:102, :230, :238, :245 preflight include segments and exclusions and disclose compilation failure. PD-spec:906 finds both services and tools; :921 asserts an unusable cross-segment brace pattern returns incomplete plus its reason. Independent brace/comma-flow probes pass; invalid include/exclude probes return incomplete without throwing. Residual YAML scalar semantics are R4-M1, not a repeat of the fixed crash. |
| R3-S2: custom tooling `check` overrides application `bundle` | FIXED for the reported trigger; universal tooling exclusion is incomplete | PD:143, :174 prioritize build, bundle, serve and other application names independently of declaration order; :179 filters auxiliary executors on custom names. PD-spec:934 pins check+bundle; :883 retains build+lint coverage. Independent ordinary and reversed-order fixtures both return react/react. Reserved-name tooling is R4-M2.                                                                                                                                                        |
| R3-M1: long rows displace the inspection reason              | FIXED                                                                     | FMT:248 puts counts/incomplete first, :257 puts bounded notes before rows, :274 bounds row reasons and :277 bounds names/paths. FMT-spec:430 asserts <=8,000 chars and failure-summary-before-rows with 300-character strings. Independent original long-row fixture is now 4,400 chars with the summary at offset 254. A larger 8,247-character formatter output passed through the actual budget to 7,893 chars / 1,533 tokens, retaining incomplete and the failure summary.                  |

The new M1 spec tests the formatter, not the budget integration. The independent integration probe supplies that evidence for this review; a durable integration spec would strengthen the guard.

## Earlier findings regression scan

| Earlier finding                                                    | Current status and evidence                                                                                                                                                                                                                           |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| r1 B1 / r2 B1: hidden inventory and depth caps                     | No regression demonstrated. PD:381 counts before the 200-member slice and marks incomplete at :383; DISC:301, :316, :323 disclose candidate/depth/read bounds. PD-spec:748, :810, :827 pass.                                                          |
| r1 B2 / r2 B3: unreadable member disappears or its issue is hidden | No regression demonstrated. PD:498 distinguishes invalid from absent; :398 aggregates member failures before presentation. WS:492 carries completeness; FMT:253, :257 render it before rows. PD-spec:707, :723, :739, :867 and FMT-spec:400 pass.     |
| r1 S1 / r2 B2: hardcoded membership and YAML comments              | Custom/nested declarations and ordinary comments remain supported: MD:645; DISC:228; PD-spec:676, :769, :794, :840. Independent comments, quoted hash, flow exclusions and comma-literal probes pass. Full scalar fidelity remains partial (R4-M1).   |
| r1 S2 / r2 S2: language substituted for framework; Nuxt lost       | WS:563 sniffs JS app manifests as Node and :568 preserves refinements; WA:65 aggregates framework fields only. Independent Express, Next+React, Nuxt+Vue and Vue probes return express, nextjs, nuxt and vue. PD-spec:769, :957 and WA-spec:150 pass. |
| r1 S3 / r2 S1: dependency/tooling evidence overrides actual build  | Original triggers remain fixed: PD:174 and :459; PD-spec:692, :883. Reserved-name tooling caveat is R4-M2.                                                                                                                                            |
| r1 S4: source statistics lost by Node root reclassification        | WS:502 unions original root, language root and member types; :857 counts the union. PD-spec:661 passes.                                                                                                                                               |

## Five logic questions

### 1. How does this fail silently?

Unusual valid YAML scalars can still become different literal glob strings while the result claims complete (MD:78, :140, :688; R4-M1). The fixed depth, inspection and unreadable-member paths explicitly report incompleteness (DISC:316; PD:383, :398). Long project rows no longer precede the failure summary (FMT:257, :267).

### 2. What user action produces unexpected behaviour?

Replacing a plain glob with a YAML folded scalar can remove the matching service project (MD:140; R4-M1). Naming a tooling task `build` or `serve` allows its executor to decide the framework before the real custom application target (PD:174; R4-M2). Ordinary check+bundle and build+lint configurations now return the correct React classification (PD-spec:934, :883).

### 3. What input data produces a wrong answer?

`packages:\n  - >-\n    services/*\n  - 'tools/*'\n` becomes patterns `['>-', 'tools/*']`, omitting services with complete=true (MD:140, :145). A React manifest with `build.executor='@angular-eslint/builder:lint'` and `bundle.executor='@nx/react-native:bundle'` produces angular/angular (PD:175, :176, :459). These uncommon inputs are the two Moderate cases below.

### 4. What happens when a dependency fails?

Invalid RegExp compilation now yields a reported issue and incomplete instead of aborting composition (DISC:102, :230). Directory-read rejection and invalid/read-failed JSON members retain disclosures (DISC:167; PD:498, :398). Existing existence checks still collapse provider failure into false (`libs/backend/workspace-intelligence/src/services/file-system.service.ts:99`), and optional framework sniffing still returns undefined on failure (`libs/backend/workspace-intelligence/src/project-analysis/framework-detector.service.ts:78`). These inherited limitations are not additional correction defects. No timeout is introduced around sequential member reads (PD:391).

### 5. What is missing that the requirements never mentioned?

An explicit supported YAML scalar dialect with honest rejection is still needed (MD:124). Tooling exclusion must be invariant across both priority passes if the documented “never tooling” claim is intended literally (PD:169, :426). Output ordering is now tested directly, but the permanent M1 regression does not exercise the outer budget (FMT-spec:430). No new timer, watcher or resource-allocation path is introduced by these three corrections; existing disposal/fence paths remain at WS:1131 and WA:629.

## Failure modes — numbered residual defects

### 1. R4-M1 — Moderate: unsupported YAML scalar semantics still look like complete membership

- File: MD:78, :95, :140, :145, :688.
- Trigger: Use a folded scalar `- >-` followed by an indented `services/*`, or a quoted scalar with YAML escapes/doubled single quotes.
- Symptom: The independent folded-scalar fixture returned only tools, with complete=true and no issues. A double-quoted `services/\u0061pi` returned no members even though services/api exists. Doubled single quotes also failed to resolve the corresponding directory.
- Current handling: The parser strips surrounding quotes, accepts the block-scalar indicator as a literal item, and treats any nonempty pattern array as successful parsing. The glob preflight only detects uncompilable regexes; these incorrect strings compile or bypass glob compilation.
- Impact: An uncommon declaration form silently loses members and their frameworks. This is a residual manifestation already mentioned in r3, not a new regression introduced by splitFlowItems. It is Moderate under the requested unusual-edge-case rule.
- Recommendation: Correctly decode these scalar forms or explicitly reject them with a membership issue/incomplete status. Do not accept partially understood list items as complete. Add folded-scalar and escaped-scalar fixtures that assert exact membership or explicit incompleteness.

### 2. R4-M2 — Moderate: application-name priority bypasses the tooling-executor filter

- File: PD:174–177, :179–182, :459; WS:552.
- Trigger: A React project assigns `@angular-eslint/builder:lint` to a target named build (or serve), alongside a real React Native bundle (or custom compile) target.
- Symptom: Both independent fixtures return angular/angular, although their own package.json declares React and their application executor is React Native.
- Current handling: Only the second/custom-target pass checks AUXILIARY_EXECUTOR. The first pass immediately accepts any framework-looking executor under a reserved application name. WS retains that executor framework without refinement.
- Impact: Unusually named tooling tasks can still contaminate the framework answer and member-derived statistics. The original ordinary check+bundle trigger is fixed. The executor report's priority algorithm is implemented, but the stronger “tooling executors never count” claim is not true for this branch. The reserved-name lint trigger is uncommon, so this is Moderate, not Serious.
- Recommendation: Apply the tooling-executor rejection before rule matching in both passes. Pin build/serve tooling with a later genuine application target, and a tooling-only project with a manifest fallback.

## Blocking issues

None demonstrated in the reviewed correction or the earlier regression fixtures.

## Serious issues

None demonstrated under the requested realistic-workspace severity threshold.

## Moderate and minor issues

R4-M1 and R4-M2 above. Additional test-strengthening suggestion, not a third failure mode: retain a formatter-through-budget regression with enough tree/notes content to require spooling (FMT-spec:430; BUDGET:255).

## Data flow

1. **OK:** WS:437 detects monorepo before selecting composition; :455/:458 preserve the single-app branch.
2. **PARTIAL:** MD:645 reads tool/package declarations; :87 preserves quoted brace-flow entries. R4-M1 remains at scalar interpretation.
3. **OK for inspected bounds:** DISC:245 preflights include segments and :238 exclusions; :230 marks unusable patterns incomplete; :301/:316/:323 disclose candidate/depth/read limits.
4. **OK with R4-M2:** PD:381 retains total before inspection cap; :391 inspects members, :398 promotes failures to a summary. PD:174 prioritizes recognized application names, but lacks first-pass tooling rejection.
5. **OK on supported tested frameworks:** WS:546 resolves per-member frameworks; WA:65 aggregates actual frameworks; :446 labels the root by monorepo tool. WS:502 preserves statistics extensions.
6. **OK for r3 M1:** FMT:248/:257 places status and notes before :267 project rows. FMT:37/:40/:48 bounds the tree independently.
7. **OK on budget probe:** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:891` passes formatted output into the response path; BUDGET:236 uses that text as raw, :265 reduces and :277 spools when over budget. The oversized probe returned 7,893 chars and retained the failure summary.

## Requirements fulfilment

| Requirement                                                     | Status                                   | Evidence / gap                                                                                                                                                   |
| --------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R3-S1 quoted brace-flow parsing and nonthrowing invalid glob    | COMPLETE for primary triggers            | MD:87; DISC:230; PD-spec:906, :921; independent invalid include/exclude probes                                                                                   |
| General YAML declaration fidelity                               | PARTIAL                                  | R4-M1                                                                                                                                                            |
| R3-S2 check cannot override bundle; application-target priority | COMPLETE for primary trigger             | PD:174; PD-spec:934; reversed-order probe                                                                                                                        |
| Tooling executors never determine framework                     | PARTIAL                                  | R4-M2                                                                                                                                                            |
| R3-M1 status/counts/incomplete/failure before bounded rows      | COMPLETE                                 | FMT:248, :257, :277; FMT-spec:430; actual budget probe                                                                                                           |
| Monorepo-first mixed Nx root and per-member frameworks          | COMPLETE for supported examined fixtures | WS:437; WA:446; PD-spec:608, :633, :769, :957                                                                                                                    |
| Honest discovery/inspection limits and member read failures     | COMPLETE on examined boundaries          | DISC:301, :316, :323; PD:383, :398; regression specs pass                                                                                                        |
| Single-app detection retained                                   | COMPLETE for executed behavior           | PD:276; WS:455, :458; PD-spec:85–487, :985 pass; no byte-baseline claim                                                                                          |
| Prior source statistics preserved                               | COMPLETE                                 | WS:502, :857; PD-spec:661                                                                                                                                        |
| Tree depth 3, 25 entries/directory, required exclusions         | COMPLETE                                 | FMT:37, :40, :61; FMT-spec:143–271                                                                                                                               |
| Flat 500-file tree <4,000; whole specified fixture <=8,000      | COMPLETE                                 | FMT-spec:144, :273 pass                                                                                                                                          |
| Universal formatter-only <=8,000 for arbitrary input            | NOT REQUIRED / NOT GUARANTEED            | Combined long rows, notes and tree probe formats to 8,247; outer budget returns 7,893. Batch 10 requires the specified fixture, not universal uncapped metadata. |
| Scoped checks, degradation audit, dependency validation         | COMPLETE                                 | Independently passed as recorded below                                                                                                                           |

Implicit requirements still incomplete: honest rejection of unsupported YAML scalar forms, and executor-purpose filtering independent of target name.

## Edge cases

| Case                                                     | Handled                                    | Evidence / concern                                          |
| -------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------- |
| Quoted brace-flow and literal comma path                 | YES                                        | Independent exact-membership probes; PD-spec:906            |
| Uncompilable positive or negative pattern                | YES                                        | Independent probes return incomplete; DISC:230              |
| Trailing/inter-item comments, quoted hash, flow negation | YES                                        | Independent probes and PD-spec:840                          |
| Multiline flow unsupported                               | YES, honest incompleteness                 | MD:690; independent probe                                   |
| Folded/escaped YAML scalar                               | NO                                         | R4-M1                                                       |
| check+bundle, either declaration order                   | YES                                        | PD-spec:934; independent probes                             |
| Explicit build versus bundle priority                    | YES                                        | Independent probe; PD:143                                   |
| Custom target with test substring, e.g. build-contest    | YES                                        | Independent probe returns angular                           |
| Tooling under build/serve                                | NO                                         | R4-M2                                                       |
| Long project rows and oversized combined response        | YES for summary visibility and outer bound | 8,247 raw -> 7,893 returned; incomplete and reason retained |
| Empty or failed-member inventory                         | YES for covered declarations               | FMT-spec:400, :459; PD-spec:707, :723                       |
| Concurrent/repeated analyses and disposal                | Existing safeguards retained               | WS:368, :519, :1131; WA:394, :454, :629; scoped suites pass |

## Verification performed

- Read the nine named production/spec files in full, the archived r3 review and bounded correction report, earlier r1/r2 findings, context/User Decisions and Batch 10 requirements. No source edits or git operations were performed.
- Task directory was discovered and exists. It has no task-description.md, implementation-plan.md or code-style-review.md. `ptah_search_files` returned zero AGENTS.md; native hidden instruction-name search likewise found none. No full-file Read or Write tool is exposed; native PowerShell reads and the deliverable write were used. Task/status files were not changed.
- Scoped `ptah_get_diagnostics` for the two reviewed projects: typescript-compiler, **0 errors / 0 warnings**.
- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache`: **all six targets passed**, exit 0, 58.5 seconds; last 30 lines retained.
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache`: **passed**, exit 0, **TOTAL 300 unsuppressed site(s)**; last 12 lines retained.
- `node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache`: **passed**, exit 0, including prerequisite; last 8 lines retained.
- Independently reran the inspected temp probe `C:/Users/abdal/AppData/Local/Temp/ptah-559-r3-probe.cjs` against current worktree source. It transpiles the actual implementations in memory, uses real temp filesystem fixtures and actual stack profiles/json2md, and stubs DI/platform boundaries. Results above include correct brace/comma flow, original target conflicts, framework refinements and the residual scalar failures.
- Wrote and ran `C:/Users/abdal/AppData/Local/Temp/ptah-559-r4-probe.cjs`, using the inspected budget-probe loader. Actual application priority, invalid include/exclude handling, and actual formatter plus result-budget/reducer pipeline were exercised. Fixture/spool writes stayed under OS temp. No repository test was added.
- Budget measurements: ordinary long-row+500-flat-file output **4,753 chars / 1,071 tokens**, unchanged by budget; combined long-row+wide-tree+five-note output **8,247 -> 7,893 chars / 1,533 tokens**, spooled, incomplete=true and failure summary present. This is empirical fixture evidence, not a universal formatter-only bound.
- No live MCP client or UI session was exercised. No baseline byte comparison was attempted under the no-git rule, so unchanged single-app behavior is supported by branches and passing current specs, not independently certified historical byte identity. Existing unsupported legacy builder forms, optional framework misses, filesystem existence semantics and unbounded I/O latency remain outside the correction's guarantees.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for the three primary corrections; MEDIUM for the wider declaration/executor dialect.
- Top risk: Uncommon valid YAML scalar forms still produce complete-looking inventories with missing members (R4-M1).
- What a robust implementation would add: explicit supported-scalar validation/rejection, tooling filtering before both executor-priority passes, and a permanent formatter-through-budget regression.
