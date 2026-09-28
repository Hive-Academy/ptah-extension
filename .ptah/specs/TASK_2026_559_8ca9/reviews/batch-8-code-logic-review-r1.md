# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 4/10           |
| Assessment          | NEEDS_REVISION |
| Requested verdict   | REVISE         |
| Blocking issues     | 3              |
| Serious issues      | 0              |
| Moderate issues     | 3              |
| Failure modes found | 6              |

One verdict covers Part A (Batch 8) and Part B (Jest infrastructure). The primary fallback works, and the preset mapper works in the checked projects. However, the fallback bypasses physical workspace containment, silently reduces reference recall, and accepts commented-out declarations. These reproduced failures put this below the 5–6 band; bounded reads, preserved index selection, passing scoped checks, and a working mapper keep it above the 1–2 band.

Paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`.

## Scope and verification

Read the four named source/spec files and three infrastructure files, Batch 8 and its notes/plan risks, context Decision 4, research/code-intel.md:498, and both executor reports. `implementation-plan.md`, `task-description.md`, and `code-style-review.md` are absent; batches.md:13 explicitly says this is plan-free. `ptah_search_files` returned no AGENTS.md; native instruction-file discovery also returned none. Inspected the filesystem adapter, graph implementation, host registration/provider paths, Jest's installed config merge implementation, and the role fixture/root-resolution path. No source edits, git commands, or raw session-log reads were performed.

Verification on 2026-09-26:

- Requested `nx run-many "-t=test,lint,typecheck" -p ptah-electron @ptah-extension/vscode-lm-tools --skip-nx-cache`: **PASS**, all 12 tasks including build prerequisites; 1m20s.
- Requested `nx run-many -t=test -p ptah-cli ptah-extension-vscode ptah-tui @ptah-extension/tool-output-reducers --skip-nx-cache`: **PASS**, four projects and 36 dependency tasks, 3m16s. Nx reported `@ptah-extension/agent-generation:build` as flaky but the overall run succeeded; no manual rerun was performed.
- Requested `nx run degradation-audit:lint --skip-nx-cache`: **PASS**, total 300. Baselines are Electron 4 and vscode-lm-tools 2 (`tools/degradation-audit/baseline.json:3`, `:35`).
- Scoped `ptah_get_diagnostics`: unavailable after its 45-second timeout; it reported the compiler still running. The requested Nx typechecks subsequently passed.
- Both actual project configurations (`jest --showConfig`) retained their vscode/wasm/Electron mappings and inherited the absolute marked mapper.
- Read-only Node harness transpiled the actual Electron class in memory and invoked its public LSP methods with controlled collaborators. It reproduced B1–B3 and M1–M2. B1 used a real disk read through the existing node_modules junction; other cursor/fixture content was supplied in memory. No fixture files were created.
- Loaded the installed UMD into a CommonJS VM and imported the installed ESM build: identical exported key sets; `Lexer`, `marked.lexer`, and `marked.parse` exist. Heading/paragraph, quote/fence, and task-list/link samples produced equal lexer tokens and HTML. This is finite compatibility evidence, not proof that no future package version can differ.

Historical preservation limitation: the current context-enrich block still expresses Batch 7's declaration-only/refusal contract (`tool-description.builder.ts:1632`). The executor attests unchanged constants and block (`batch-8-executor-report.md:84`). No historical diff was independently obtained because this review role prohibits git operations; do not treat that attestation as a byte-for-byte comparison.

## Five logic questions

### 1. How does this fail silently?

Part A: a built graph turns the new guessed declaration into a restricted reference scope (`electron-ide-capabilities.ts:460`), omitting genuine global-script uses without a partial-result indication (B2). A declaration-shaped line inside a comment becomes a successful location (`:734`, B3). Unreadable targets still become ordinary empty results through the existing `safeReadFile` (`:597`); that pre-existing degradation is not counted again.

### 2. What user action produces unexpected behaviour?

Part A: requesting a definition through a relative import traversing a workspace junction reads outside the workspace (B1, `:347`). Building the import graph before requesting global references changes the result from two locations to one (B2, `:459`). Opening a UNC workspace makes relative module probing use a different root spelling (M1, `:391`).

### 3. What input data produces a wrong answer?

Part A: `/*\nclass Ghost {}\n*/\nGhost();` returns line 1, column 6 as Ghost's declaration (B3, `:722`). A relative extensionless import backed solely by `foo.d.ts` returns no definition (M2, `:102`). These are distinct from the documented alias/barrel limitations.

### 4. What happens when a dependency fails?

Part A: an AST exception or error result returns unresolved (`:370`); filesystem read failure logs and returns null (`:597`); exists checks in the actual Electron adapter return false on failure (`platform-electron/src/implementations/electron-file-system-provider.ts:72`). Index rejection propagates from `:285`, so an unavailable reader is supported but a throwing reader is not treated as an empty index. No new timer/subscription or fire-and-forget operation was introduced. There is no cancellation/timeout or file-size bound on the one imported-file read (`:335`); the promised bound is file count, not bytes/time.

Part B: the mapper depends on the installed package's UMD artifact (`jest.preset.js:31`); a missing artifact would fail resolution visibly. The role fixture instead depends on uncontrolled ancestor state (M3, `agent-role-resolver.service.spec.ts:88`).

### 5. What is missing that the requirements never mentioned?

Part A: syntax-aware rejection of comments/string contents, graph completeness and workspace-specific readiness before reducing reference scope, physical-path containment, and ambient declaration-file probing. The review request explicitly adds junction/UNC scrutiny beyond the batch's small two-file fixture. Part B: a hermetic role fixture and explicit ownership of the redundant transform workaround.

## Failure modes

### B1 — Part A: physical workspace escape through junction/symlink

- Trigger: a relative import resolves lexically under the root but traverses a junction/symlink targeting another directory.
- Symptom: the tool returns a location obtained by reading a physically external file.
- Evidence: `apps/ptah-electron/src/services/electron-ide-capabilities.ts:347`, `:335`, `:749`; `libs/backend/platform-electron/src/implementations/electron-file-system-provider.ts:24`.
- Current handling: prefix comparison after POSIX normalization; `exists` and `readFile` follow links. No canonical path check.
- Reproduction: virtual root-level cursor imports `ChildProcess` from `./node_modules/@types/node/child_process.d.ts`. Public getDefinition returned line 84, column 10. The read path was under this worktree, but `realpathSync` resolved it to `D:/projects/ptah-extension/node_modules/@types/node/child_process.d.ts`, outside it.
- Recommendation: canonicalize workspace and each existing candidate using host-appropriate filesystem semantics before reading; reject external targets. Cover intermediate junctions and symlinked files. Preserve the single content-read bound; consider link replacement races if containment is intended as a security boundary.

### B2 — Part A: empty-index fallback silently narrows references

- Trigger: empty/no index, a same-file global declaration, and a built import graph. Global-script consumers have no import edges.
- Symptom: legitimate references disappear, while the tool presents its normal successful locations array.
- Evidence: `apps/ptah-electron/src/services/electron-ide-capabilities.ts:460`, `:426`; graph edges come only from imports at `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts:177`.
- Current handling: any fallback declaration is considered sufficient to restrict scanning to that file and its reverse import edges.
- Reproduction: cursor `function GlobalThing() {}` and another file `GlobalThing();`, no index and no edges. Graph unbuilt: two locations and one workspace stream. Graph built: only the declaration and no stream. Previously zero index candidates selected the brute scan; the new declarationsFor result changes that branch.
- Recommendation: keep index-independent definition guesses separate from reference-scoping evidence. Preserve full scanning when the index is empty unless scope completeness is established. Check `isBuilt(workspaceRoot)` rather than any graph: the existing no-argument method returns true for any open workspace (`dependency-graph.service.ts:371`), another case newly exposed by this fallback.

### B3 — Part A: commented declarations override real imported definitions

- Trigger: a comment or multiline string contains a line starting with a declaration of the searched name.
- Symptom: definition lookup reports non-code as a definition and skips a real imported target.
- Evidence: `apps/ptah-electron/src/services/electron-ide-capabilities.ts:722`, `:734`, `:325`.
- Current handling: first regex-matching line wins; no syntax or comment/string-range validation. The separate reference filter is not used here.
- Reproduction: public getDefinition for Ghost in `/*\nclass Ghost {}\n*/\nGhost();` returned `{line:1,column:6}`. Adding a real Ghost import would still hit the early same-file return.
- Recommendation: obtain declaration nodes from parsing the already-read content, or at minimum exclude comment/string ranges before accepting a match; return unresolved on uncertain syntax. Cover commented declarations, template literals, and misleading nested declarations.

### M1 — Part A: UNC module paths lose their network root

- Trigger: cursor/root `//server/share/repo` and import `./foo`.
- Symptom: the candidate becomes `/server/share/repo/foo.ts`; the actual UNC target is never checked. On Windows the single-slash path is rooted on the current drive, not the UNC share.
- Evidence: `apps/ptah-electron/src/services/electron-ide-capabilities.ts:389`, `:391`, `:751`.
- Current handling: POSIX normalization collapses the leading double slash in both candidate and containment root, allowing their wrong spellings to compare equal.
- Reproduction: mocked existence for `//server/share/repo/foo.ts` yielded no location and 16 wrong probes.
- Recommendation: preserve UNC authority/share using Windows-aware resolution on Windows, then canonical containment. No live network share was mounted for this review.

### M2 — Part A: extensionless ambient module is never probed

- Trigger: `import { Widget } from './foo'` with only `foo.d.ts` (or `foo/index.d.ts`).
- Symptom: ordinary unresolved result despite a declaration being available locally.
- Evidence: `apps/ptah-electron/src/services/electron-ide-capabilities.ts:91`, `:102`, `:350`.
- Current handling: 16 suffix probes omit `.d.ts`/`index.d.ts`. Explicit `./foo.d.ts` does work because stripping `.ts` retains `.d`.
- Reproduction: explicit .ts/.tsx/.js/.mjs/.d.ts and directory index.ts resolved in isolated cases; extensionless foo backed only by foo.d.ts did not (16 probes, cursor read only).
- Recommendation: add declaration suffixes in a deliberate source/declaration resolution order. This is missing coverage in the new fallback, not a regression caused by stripExtension: the old regex also retained the `.d` after removing `.ts`.

### M3 — Part B: role-resolver fixture inherits machine state

- Trigger: a `.ptah` directory exists above the temporary workspace, including `%TEMP%/.ptah`.
- Symptom: resolver searches the ancestor's `.claude/agents` rather than the test's fake agents directory; role assertions fail.
- Evidence: `libs/backend/cli-agent-runtime/src/lib/roles/agent-role-resolver.service.spec.ts:88`; `libs/backend/cli-agent-runtime/src/lib/roles/agent-role-resolver.service.ts:70`; `libs/backend/harness-sync/src/lib/workspace/workspace-root.ts:79`.
- Current handling: fixture creates `.git` only; the real root resolver completes its `.ptah` ancestor walk before trying `.git`.
- Reproduction: `%TEMP%/.ptah` exists on this machine. Calling the actual root resolver for a temp-child path returned the Temp directory. The reported failing suite was not rerun; this confirms its proposed causal mechanism by source and a focused call.
- Recommendation: create a local `.ptah` marker in each owned fixture, or inject/isolate root resolution. Do not delete shared Temp state or change product semantics to repair the test. This is pre-existing and not caused by the mapper, but can affect CI (especially reused/self-hosted runners); “environmental” does not mean the test is robust.

## Blocking issues

- **B1, Part A — containment bypass.** File: `electron-ide-capabilities.ts:349`. Scenario: in-root junction to an external directory. Impact: the new implicit import read violates workspace containment. Fix: canonical physical containment before content read.
- **B2, Part A — misleading reference completeness.** File: `electron-ide-capabilities.ts:460`. Scenario: empty index plus built graph and global scripts/incomplete graph. Impact: an agent may perform an incomplete refactor on a success-looking result. Fix: preserve brute-scan fallback without reliable scoping evidence.
- **B3, Part A — false successful definition.** File: `electron-ide-capabilities.ts:734`. Scenario: declaration text in a comment/string. Impact: navigation/refactoring targets non-code and can conceal the true import. Fix: syntax-aware acceptance. Blocking classification follows the role's explicit rule for silent failures that mislead users.

## Serious issues

None independently established.

## Moderate and minor issues

- **M1, Part A:** UNC normalization loses authority/share semantics (`electron-ide-capabilities.ts:391`).
- **M2, Part A:** extensionless `.d.ts` modules unsupported (`electron-ide-capabilities.ts:102`).
- **M3, Part B:** non-hermetic role fixture (`agent-role-resolver.service.spec.ts:88`); pre-existing follow-up, not a mapper regression.
- **Minor, Part B, not an additional failure mode:** remove the redundant Electron marked transform exemption (`apps/ptah-electron/jest.config.ts:8`) and `allowJs` addition (`apps/ptah-electron/tsconfig.spec.json:13`) together if no other JS input needs them. With the root mapper, the exemption can still transform the UMD .js file; it is not literally inert, though no behavioral defect was observed. The comment claiming ESM transformation is misleading for bare marked imports.

## Data flow

1. Cursor path/read/identifier extraction — existing entry path; read failures return empty (`electron-ide-capabilities.ts:225`). Direct cursor paths are not workspace-contained; pre-existing, outside the new import-boundary fix.
2. Index exact-name candidates — OK: deduplicated locations, zero candidates alone invokes fallback; one candidate returns directly (`:252`, `:282`). Multiple candidates retain local/import/all ordering (`:264`).
3. Same-file declaration scan — B3: lexical text treated as syntax (`:319`).
4. AST relative import resolution — bounded and rejects non-dot package/absolute imports (`:386`); UNC gap M1 (`:391`).
5. Suffix probing and one target content read — B1 physical containment gap; M2 declaration suffix omission (`:347`, `:335`). No recursive import chasing or multiple target content reads.
6. Reference scope — B2: a new weak definition guess changes a formerly index-independent whole-workspace scan (`:460`).
7. Description registration — OK host gating (`protocol-dispatcher.ts:407`); real VS Code providers at `ide-capabilities.vscode.ts:71`, `:108`; host-qualified descriptions at `tool-description.builder.ts:398`, `:431`.
8. Jest bare marked import — OK: preset absolute path (`jest.preset.js:31`), merged with project mappings by installed Jest (`node_modules/jest-config/build/index.js:1431`, invoked at `:1489`), loads published UMD exports. Relative/subpath imports are not matched by `^marked$`.

## Requirements fulfilment

| Requirement                                                                | Status   | Gap                                                                                                          |
| -------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| Empty/no-reader definition fallback; cursor first; one target content read | COMPLETE | Basic real-parser fixture passes; correctness gaps B1/B3 remain                                              |
| Existing index/multi-candidate ordering                                    | COMPLETE | No extra fallback on nonempty candidates; dotted service name covered                                        |
| Workspace-contained imported reads                                         | PARTIAL  | B1 junction escape; M1 UNC semantics                                                                         |
| No reference quality loss                                                  | MISSING  | B2 reproduced                                                                                                |
| Script extensions and index files                                          | PARTIAL  | Tested standard explicit forms; M2 extensionless declaration files                                           |
| Host-accurate description and budget                                       | COMPLETE | 472 and 490 characters, both under 1,000; providers/gating verified                                          |
| Frozen shared prompts/enrich block untouched                               | PARTIAL  | Executor attestation; no independent historical comparison                                                   |
| Fixed-text new logging; degradation baseline                               | COMPLETE | No new logger call/catch; existing raw path/error logs at :605 remain                                        |
| Preset mapper merging, export shape, portability                           | COMPLETE | Actual configs merge; named exports/sample behavior match; path.resolve(__dirname, ...) uses host path rules |
| Redundant Electron workaround judgment                                     | COMPLETE | Recommend removal of paired workaround, no observed runtime defect                                           |
| Environmental role-resolver failure judgment                               | COMPLETE | M3 confirms environment sensitivity and pre-existing fixture weakness                                        |

Implicit requirements not addressed: syntax-valid declaration selection, graph completeness/workspace identity, and canonical filesystem boundaries. No new architectural dependency or public interface was introduced: the class retains its existing injected ports; the fallback methods are cohesive. Its coupling into reference scoping, rather than its naming or file size, is the structural defect.

## Edge cases

| Case                                            | Handled       | How                                  | Concern                                                         |
| ----------------------------------------------- | ------------- | ------------------------------------ | --------------------------------------------------------------- |
| No reader / zero exact candidates               | YES           | Fallback at :252                     | Throwing reader still propagates                                |
| Nonempty/multiple candidates                    | YES           | Existing selection sequence          | Name-based ambiguity remains documented                         |
| Lexical ../ escape                              | YES           | Zero probes in controlled case       | Does not cover physical links                                   |
| Absolute/package imports                        | YES           | Non-dot specifier refused            | No path-alias/barrel traversal by design                        |
| Windows drive case                              | YES           | C:/REPO vs c:/repo accepted in probe | Canonical host semantics still needed                           |
| Junction/symlink                                | NO            | B1                                   | Real outside read reproduced                                    |
| UNC                                             | NO            | M1                                   | Double slash collapsed                                          |
| .ts/.tsx/.js/.mjs/explicit .d.ts/index.ts       | YES           | Controlled isolated targets          | Mixed-extension precedence is heuristic, not full TS resolution |
| Extensionless .d.ts/index.d.ts                  | NO            | M2                                   | Missing suffixes                                                |
| Declaration in comment/string                   | NO            | B3                                   | False location, early return                                    |
| Global references / graph for another workspace | NO            | B2                                   | Silent omissions                                                |
| Dependency read/parse failure                   | YES, degraded | Null/empty result                    | Existing empty/error indistinguishability                       |
| Very large resolved file                        | PARTIAL       | One read                             | No byte/time bound                                              |
| Shared Temp ancestor state                      | NO            | M3                                   | Non-hermetic fixture                                            |

## Verdict

- Recommendation: **REVISE** (both parts together).
- Confidence: **HIGH** for reproduced failures and mapper behavior; limited for historical unchanged-file claims and real UNC filesystem behavior.
- Top risk: the new definition fallback is trusted as stronger evidence than it is, enabling outside-workspace reads and incomplete or false code-navigation results.
- What a robust implementation would add: canonical host-aware containment, syntax-aware declaration selection, conservative reference scoping, ambient declaration suffix tests, and isolated role fixtures. Remove redundant Electron transformation configuration once its lack of other consumers is confirmed.
