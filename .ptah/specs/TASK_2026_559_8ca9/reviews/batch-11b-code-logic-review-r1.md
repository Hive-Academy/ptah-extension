# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Batch 11b, r1: follow-up to the three findings in Batch 11 r1. Source/spec scope is the four files named in `batch-11b-executor-report.md`. Reviewed the relevant production dependency paths, the relocated fixtures and their previous assertions from the earlier review. Batches 11/12 already committed are context, not a fresh review of unrelated behavior. Orchestrator documents for tasks 561/562 were not examined or changed.

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Minor issues        | 0        |
| Failure modes found | 0 new    |

All three earlier findings are resolved. The changes have a narrow behavioral surface, retain the original cap assertions, and pass both ordinary verification and the independently repeated slow-filesystem probe. An 8 reflects sound evidence-backed work rather than exemplary completeness: the agreement test samples a defined boundary set, the memory provider models only the filesystem operations its fixtures need, and verification covers this Windows host rather than every runtime adapter.

Paths below are relative to this worktree. `MCP` means `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/`; `WI` means `libs/backend/workspace-intelligence/src/`.

## r1 items status

| Item                                     | Status   | Evidence and assessment                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1 — schema/validator mismatch           | RESOLVED | `MCP/tool-description.builder.ts:335`, `:341`, `:360` publish shared default/max constants and integer/minimum/maximum/default fields. `MCP/protocol-dispatcher.ts:909` consumes the constants, enforces the same numeric domain, and prints its bounds/default in the error. Agreement spec at `MCP/protocol-dispatcher.spec.ts:1019` tests accepted values, both upper-bound sides, zero, negatives and fractions, plus omitted default. |
| M2 — real-disk inspection-cap timeout    | RESOLVED | Bulk cases now instantiate the real services over a memory filesystem (`WI/project-analysis/project-detector.service.spec.ts:954`). Cap assertions at `:979` still check total 210, inspected 200, incomplete status (`complete === false`), and the exact omission note. Failure-summary assertions at `:997` retain incomplete status and the exact malformed-member note. Independent +30 ms/read probe: all 57 tests passed.           |
| Minor — notice-through-budget regression | RESOLVED | `MCP/protocol-dispatcher.spec.ts:3490` invokes the actual dispatcher for 1,000 and 10,000 shown files, checks final notice and reducer/cut trailer, both budgets, and byte-equal formatted raw spool. The helper at `:2788` also requires exactly one spool file. Independent notice-relocation probe confirms the prefix-cut case detects the regression.                                                                                 |

## Five logic questions

### 1. How does this fail silently?

No new supported silent-failure scenario found. The limit validator's domain is unchanged from Batch 11: integer, 1 through MAX_SAFE_INTEGER (`MCP/protocol-dispatcher.ts:910–918`). Discovery now communicates that domain. Oversized-result tests inspect final returned text rather than merely formatter output (`MCP/protocol-dispatcher.spec.ts:3507–3528`), so a missing notice after reduction is observable to the regression suite.

### 2. What user action produces unexpected behaviour?

No new unexpected user behavior established. The shared default is still 50 and the accepted positive-safe-integer set is unchanged (`MCP/tool-description.builder.ts:335–341`; dispatcher `:909–914`). Zero, negative, fractional and string limits were rejected by Batch 11 already; the executor's compatibility note correctly attributes that tightening to Batch 11. `null` remains a backward-compatible default through `??`; the schema does not advertise null. This permissiveness does not cause a schema-valid call to fail.

### 3. What input data produces a wrong answer?

No new wrong answer found. The in-memory fixture supplies raw manifests and directory entries, not computed project lists. Production discovery still chooses members, sorts paths and distinguishes plain folders from projects (`WI/project-analysis/monorepo-member-discovery.ts:273–346`). Production composition still counts discovery before applying its 200-project inspection cap (`WI/project-analysis/project-detector.service.ts:374–394`). The test therefore continues to reject wrong totals, cap sizes and incomplete/omission reporting.

### 4. What happens when a dependency fails?

The test double throws for missing files and supplies malformed JSON unchanged (`WI/project-analysis/project-detector.service.spec.ts:993`, `:1081–1089`). Production manifest parsing and failure summarization remain exercised (`WI/project-analysis/project-detector.service.ts:398–410`, `:437–450`). Small disk tests retain unreadable-file and unreadable-directory cases (`WI/project-analysis/project-detector.service.spec.ts:691`, `:707`). No production error propagation or timeout path is changed by 11b.

### 5. What is missing that the requirements never mentioned?

No new actionable gap established. The memory double cannot represent empty directories, symlinks or filesystem-specific errors: it derives directories from file prefixes (`WI/project-analysis/project-detector.service.spec.ts:1068–1092`). Those limitations do not weaken these fixtures: all intentional plain folders contain README files, and these tests concern counting and manifest failures. This double should not be treated as a general adapter contract suite.

## Numbered new defects

None. No Blocking, Serious, Moderate or Minor defect supported by the examined behavior.

## Failure modes

No new failure mode established. The checks covered limit bounds/default/error wording, forward probing and budget integration, manifest discovery through a memory provider, preservation of cap/failure assertions, and the complete detector spec under injected read latency.

Residual uncertainty: the sampled schema agreement test is not exhaustive JSON Schema validation; the read-latency probe does not simulate every kind of OS scheduling pause, directory-read delay, or filesystem fault. These limits do not constitute observed regressions.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

None new. Earlier M1, M2 and Minor are closed as detailed above.

## Detailed assessment

### Limit contract and regression strength

- Default/max come from one declaration (`MCP/tool-description.builder.ts:335`, `:341`), imported by the dispatcher (`MCP/protocol-dispatcher.ts:104–105`). Minimum 1 is literal in both places, but agreement tests cover both sides of that boundary.
- `Number.isInteger(value) && value >= 1 && value <= Number.MAX_SAFE_INTEGER` accepts exactly the previous positive-safe-integer set. NaN, infinities and numeric strings cannot pass this check. The existing invalid-input table at `MCP/protocol-dispatcher.spec.ts:994` retains NaN/string rejection and exact error-text coverage.
- MAX_SAFE_INTEGER + 1, used only as the probe count, is exactly representable as 2^53. Although it is not a _safe_ integer, this single addition does not round or change the requested count. No new practical ceiling or precision defect is introduced.
- The agreement test computes the published type/minimum/maximum verdict independently, then calls the real handler and checks provider invocation (`MCP/protocol-dispatcher.spec.ts:1026–1061`). Reverting type to number, removing bounds, changing one bound/default, or changing the handler at the tested boundaries produces disagreement. It does not merely compare two imported constants. It does not claim exhaustive coverage of hypothetical future schema keywords such as `multipleOf`.
- The top-level description remains the same true filesystem-discovery description (`MCP/tool-description.builder.ts:350`). The parameter description now states the minimum/default and notice behavior (`:365`); maximum is discoverable in the schema and error. No shared prompt contract is weakened.

### Memory fixture fidelity and real-disk coverage

The composition helper calls real `detectMonorepo`, real `detectDeclaredMembers` and real `detectMonorepoComposition` (`WI/project-analysis/project-detector.service.spec.ts:1048–1058`). It does not mock discovery or inject a precomputed member list. `FileSystemService` still delegates and wraps failures normally (`WI/services/file-system.service.ts:23–38`). Only the provider's readFile/readDirectory/exists methods are replaced.

The map provider normalizes paths; lists immediate children with FileType.File/Directory; infers intermediate directories; and answers existence from files or directory prefixes (`WI/project-analysis/project-detector.service.spec.ts:1065–1093`). Those semantics are sufficient for these fixtures. Production discovery still recursively scans `project.json`, ignores nonprojects and sorts the resulting set; production parsing still encounters the deliberately malformed final manifest.

The cap fixture retains four base apps, 206 extra projects and 20 README-only folders (`WI/project-analysis/project-detector.service.spec.ts:967–975`). All four prior assertions remain at `:979–983`. The 30-project failure-summary fixture preserves its prior assertions at `:997–999`; no note or completeness check was weakened.

Dropping the **large disk cap case** is acceptable: small real-disk integration cases were not dropped. The four-app composition test remains at `:576`, WorkspaceService integration at `:601`, nested/Nx discovery at `:644`, malformed/unreadable data at `:675–713`, and declared workspace patterns at `:717–813`. They use actual temp-directory writes (`:515`) and async readFile/readdir (`:1109–1119`). Thus an additional duplicate small disk smoke test is unnecessary.

Accepted plan deviation: the batch note asks for a small smoke test with an explicit integration timeout; existing small disk tests remain at the default timeout. Independent slow-I/O verification passed the entire 57-test file without changing that timeout. No remaining disk fixture has the former 200- or 30-project serial-read shape: the small Nx cases have approximately four to six projects; the depth-bound cases at `:758` and `:775` have nested directories but only one deep project. Arbitrary machine starvation can still affect any test; no remaining analogous bulk-I/O defect was found.

### Notice guard significance

The tests call `handleMCPRequest` through the budget-suite helper (`MCP/protocol-dispatcher.spec.ts:2794–2809`), using a host-recognized temp spool root. A mock provider supplies N+1 paths; the real dispatcher, formatter, reducer and budget run. Assertions at `:3521–3528` require an oversized raw result, budget-compliant final content, a hardcoded notice, the expected reduction path, and an exact formatted raw spool.

Using `formatSearchFiles(firstN, true)` as the expected raw spool is appropriate here: this tests preservation through the budget, while the separately hardcoded final notice tests visibility. It is not a test that could pass solely because both actual and expected omit the notice.

The author's mutation is meaningful. An independent temp-only probe moved just the notice to the end of the actual formatted output:

| Shown files | Original output                   | Notice moved after list           | Spool equality      |
| ----------- | --------------------------------- | --------------------------------- | ------------------- |
| 1,000       | Notice survives; markdown-outline | Notice survives; markdown-outline | Exact in both cases |
| 10,000      | Notice survives; prefix cut       | Notice absent; prefix cut         | Exact in both cases |

The Markdown reducer can preserve a trailing paragraph, so that case does not establish ordering. The prefix-cut case does establish it. Together they exercise the two intended paths rather than requiring both to fail the same mutation.

## Data flow

1. **OK:** schema declares shared limit constants and integer bounds (`MCP/tool-description.builder.ts:335–365`).
2. **OK:** dispatcher validates/defaults, requests N+1, slices N and supplies availability (`MCP/protocol-dispatcher.ts:909–927`). No new state or resource lifetime.
3. **OK:** final search response passes through the existing budget; new specs observe final text and raw spool (`MCP/protocol-dispatcher.spec.ts:3507–3528`).
4. **OK:** raw map manifests become directory entries through the provider, pass through real FileSystemService/discovery, then real composition (`WI/project-analysis/project-detector.service.spec.ts:954–962`, `:1048–1093`).
5. **OK:** composition computes full count, capped inspections and failure notes; unchanged assertions validate the output (`WI/project-analysis/project-detector.service.ts:374–410`; spec `:979–999`).

## Requirements fulfilment

| Requirement                                       | Status                       | Evidence / qualification                                                    |
| ------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------- |
| Integer, min 1, default 50, maximum MAX_SAFE      | COMPLETE                     | Builder :360–365                                                            |
| Shared constants and matching handler             | COMPLETE                     | Dispatcher :104–105, :909–918                                               |
| Agreement regression catches drift                | COMPLETE                     | Dispatcher spec :1019–1072; independently evaluates schema bounds/default   |
| Actionable error and honest description           | COMPLETE                     | Dispatcher :918; builder :350, :365                                         |
| Bulk assertions remain as strong                  | COMPLETE                     | Detector spec :979–983, :997–999                                            |
| Same production discovery path                    | COMPLETE                     | Detector spec :1048–1058; no discovery stub                                 |
| Repeat 30 ms/read probe                           | COMPLETE                     | Independent full-file run: 57/57 passed                                     |
| Real filesystem integration retained              | COMPLETE, accepted deviation | Existing small disk suites retained; no additional timeout override         |
| Check remaining bulk-disk risk                    | COMPLETE                     | Both large cases moved; remaining fixtures small/depth-focused              |
| Final notice and exact spool in both paths        | COMPLETE                     | Dispatcher spec :3490–3528; independent relocation probe confirms cut guard |
| Scoped tests/lint/typecheck and audit/bundle gate | COMPLETE                     | All requested targets passed                                                |

Implicit requirements not addressed: none newly established in this scope.

## Edge cases

| Case                                                | Handled                 | Evidence / concern                                                       |
| --------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------ |
| Omitted limit                                       | YES                     | Schema default 50, handler probes 51; agreement spec                     |
| 1 and MAX_SAFE_INTEGER                              | YES                     | Both checked against schema and actual handler                           |
| MAX_SAFE+1, huge number, zero, negatives, fractions | YES                     | Agreement table and explicit rejection                                   |
| NaN / numeric string                                | YES                     | Existing invalid-input table retained                                    |
| Null limit                                          | YES                     | Existing tolerant default retained, not advertised by schema             |
| Plain nonproject folders                            | YES                     | 20 README-only folders do not inflate cap count                          |
| Malformed last project manifest                     | YES                     | Production parse failure appears in composition notes                    |
| Missing map path                                    | YES                     | read throws / exists false; same service boundary                        |
| Empty directories or symlinks in memory double      | Not modeled             | Not present in the bulk fixtures; not claimed as adapter coverage        |
| Slow real file reads                                | YES for probe           | +30 ms fixture-read delay, full detector spec passed                     |
| Large Markdown reduction / prefix cut               | YES                     | Final notice and raw spool pinned independently                          |
| Repeated/concurrent calls                           | YES within change scope | Constants immutable; each fixture map and budget spool root are per-test |

## Verification performed

- Read executor report, Batch 11b note and context Decisions 2/4/17; reused the prior review's dependency-path and baseline-assertion evidence. No task-description, implementation-plan or code-style-review document was found in the task-folder checks. No per-library AGENTS.md/CLAUDE.md was found for the scoped libraries.
- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache --output-style=static`: all six tasks passed. vscode-lm-tools: 69 suites / 1,804 tests; workspace-intelligence: 45 suites / 1,239 tests. Runtime 2m33s. Lint reported warnings but no errors. Log: OS-temp `task559-b11b-review-verification.txt`.
- `nx run degradation-audit:lint --skip-nx-cache`: passed, TOTAL 300 unsuppressed sites.
- `nx run ptah-electron:validate-deps --skip-nx-cache`: passed, including its dependency task.
- Independent slow-I/O rerun reused the reviewer's original temp setup: wrap fs.promises.readFile and add 30 ms only to paths containing `ptah-monorepo-fixture-`; no altered production/test source or timeout. Ran scoped workspace-intelligence:test with the temp config, --runInBand and --testFile=project-detector.service.spec.ts. Result: 1 suite, 57 tests passed; Jest 16.678s. Log: OS-temp `task559-b11b-review-slow-io.log`.
- Independent formatter/budget relocation probe used actual bundled code and modified only the formatted input string under OS temp. Results shown above; both original oversized results preserve the notice and exact spools.
- Direct scoped `ptah_get_diagnostics` returned unavailable: compiler check still running after its 45-second window, explicitly not cancelled. It was not retried; the separately completed scoped Nx typecheck targets provide the successful static-check evidence.
- No git operations or source/spec edits. Probe scripts, bundles, configs and logs remained under OS temp. Only this review document was overwritten in the worktree.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for the bounded Batch 11b changes.
- Top risk: remaining real-disk tests can still be affected by extreme host starvation; the specific bulk-I/O amplification from M2 has been removed and the original delay probe now passes.
- What a robust implementation would add: nothing required for this batch. Preserve the current boundary samples and end-to-end notice/spool assertions when changing schema fields, formatter layout or reducers.
