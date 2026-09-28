# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Requested verdict   | REVISE         |
| Blocking issues     | 0              |
| Serious issues      | 1              |
| Moderate issues     | 1              |
| Failure modes found | 2              |

Round 2, Batch 8 plus test infrastructure, 2026-09-26. All six round-one findings are fixed in their reproduced scenarios. Part B holds. Part A introduces two reproduced false negatives: valid JSX-containing TSX and Go type aliases. The containment/reference fixes and passing checks put this above the significant-problems band; losing normal React definition lookup prevents the sound 7–8 band. These return an ordinary unresolved result rather than a fabricated declaration location: the common TSX regression is Serious; the narrower Go variant is Moderate.

Paths are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`. **E** means `apps/ptah-electron/src/services/electron-ide-capabilities.ts`; **D** means `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`.

## Scope and verification

Read the named source/spec/config files, round-one review, both executor reports including Revision round 1, Batch 8, and context Decision 4. No task-description.md, implementation-plan.md, or code-style-review.md exists in this task folder. `ptah_search_files` returned no AGENTS.md. No direct file-read tool was listed, so native reads were used. Examined parser capture conversion/disposal, physical filesystem reads, workspace-root resolution, graph readiness and Electron registration. No source edits, git operations, or raw session-log reads. Only this deliverable was written.

- Requested `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p ptah-electron @ptah-extension/vscode-lm-tools @ptah-extension/cli-agent-runtime --skip-nx-cache`: **PASS**, all 15 tasks including six prerequisites, 2m15s. Includes real-parser Electron regressions and the role-resolver suite.
- Requested `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache`: **PASS**, total 300, 16.2s. Baselines remain Electron 4 and vscode-lm-tools 2 (`tools/degradation-audit/baseline.json:3`, `:35`).
- Scoped `ptah_get_diagnostics`: **unavailable**, compiler still running at its 45s limit. No clean diagnostic result is claimed; independent project typechecks passed.
- Read-only Node probes transpiled the actual Electron class in memory and invoked its public LSP methods. Declaration queries used the installed real tree-sitter grammars, with the production capture text/position shape (`tree-sitter-parser.service.ts:453`). Filesystem/import collaborators were controlled except for the actual node_modules junction/realpath check. No custom fixture files were written.
- Actual `jest --showConfig` for Electron and vscode-lm-tools preserved project vscode/wasm mappings and Electron's electron mapping while inheriting the absolute marked UMD mapper. Installed UMD/ESM exported key sets matched. Heading/paragraph, quote/fence, and task-list/link samples produced equal lexer tokens and HTML. This is finite compatibility evidence, not proof about every future package release.
- `%TEMP%/.ptah` exists here. The role suite passed with its local marker (`agent-role-resolver.service.spec.ts:93`). Electron tests passed without the marked transform exemption or allowJs (`apps/ptah-electron/jest.config.ts:5`, `apps/ptah-electron/tsconfig.spec.json:3`).

Historical limitation: shared-prompt and enrich-block preservation rests on the executor's attestation, not an independent historical byte comparison, because git operations were prohibited. The current enrich-file description retains the declaration-only/refusal contract (`D:1632`).

## Round-one findings

| Finding                                     | Status | Round-two evidence                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Part A B1: junction/symlink escape          | fixed  | Actual node_modules junction resolves to `D:/projects/ptah-extension/node_modules`, outside this worktree. Virtual cursor importing ChildProcess through it now returns `[]`, with only the cursor read. Canonical comparison/read: `E:491`, `E:506`, `E:434`. Passing suite also checks a real directory junction and realpath failure. |
| Part A B2: empty-index reference narrowing  | fixed  | GlobalThing declaration and another global-script use, built graph without edges, no reader: both locations returned. Only indexed declarations scope references (`E:635`); zero candidates select full scan (`E:640`). Readiness is workspace-specific (`E:634`).                                                                       |
| Part A B3: commented declaration            | fixed  | `/*\nclass Ghost {}\n*/\nGhost();` returns `[]`. Syntax query at `E:156` excludes comment text. Imported-real-declaration, template-literal and nested-declaration regression specs pass.                                                                                                                                                |
| Part A M1: UNC root lost                    | fixed  | Controlled `//server/share/repo/a.ts` importing `./foo` resolves to correct UNC `foo.d.ts`, preserving double slash (`E:906`). No live SMB share was mounted; filesystem availability was controlled.                                                                                                                                    |
| Part A M2: extensionless .d.ts              | fixed  | `./foo` backed only by foo.d.ts returns Widget at line 0, column 21. Suffix added after source suffixes (`E:111`); passing spec pins probe index 8.                                                                                                                                                                                      |
| Part B M3: ancestor .ptah fixture leak      | fixed  | Local marker at `agent-role-resolver.service.spec.ts:93` wins the nearest-marker walk (`workspace-root.ts:94`). Requested suite passes with the interfering Temp marker present.                                                                                                                                                         |
| Part B minor: redundant Electron workaround | fixed  | Paired exemption/allowJs removed; actual merged config and full Electron tests pass.                                                                                                                                                                                                                                                     |

## Five logic questions

### 1. How does this fail silently?

Valid TSX containing JSX becomes ordinary unresolved at `E:463` and `E:423`, without a limitation in `D:431` (S1). Go aliases parse cleanly but have no capture at `E:182` (M1). Neither produces a wrong nonempty location.

### 2. What user action produces unexpected behaviour?

With no indexed candidate, requesting Widget in a normal React file returns no location even when Widget is a plain class and JSX appears elsewhere (`E:418`, `E:463`). Looking up a Go alias from a use also returns no location (`E:182`). Building the graph no longer loses GlobalThing references (`E:635`).

### 3. What input data produces a wrong answer?

`export class Widget {}\nconst view = <div/>;` yields `[]` despite valid TSX syntax. `type Widget = int` yields `[]` despite a clean Go parse. Ghost inside a comment now correctly yields no definition (`E:156`).

### 4. What happens when a dependency fails?

Realpath failures fail closed and log fixed text (`E:514`). Read failures return null through the existing logger (`E:772`). Parser Result errors become unresolved (`E:458`); production query failures become Result errors and query/tree allocations are disposed (`tree-sitter-parser.service.ts:468`). AST exceptions return unresolved (`E:547`). Index rejection still propagates (`E:378`), rather than activating the empty-index fallback; this is existing behavior, not a new finding. No new timer, subscription, background write or unobserved promise was introduced.

### 5. What is missing that the requirements never mentioned?

A declaration-form parity matrix and a distinction between malformed input and valid syntax rejected by the selected grammar. TSX maps to TypeScript (`E:865`); Go aliases have a distinct node kind absent from `E:182`. Atomic filesystem containment is not implemented; see TOCTOU below.

## Failure modes

### S1 — Part A: valid TSX loses index-free definition lookup

- Trigger: empty/no index and JSX anywhere in a TSX cursor or resolved target.
- Symptom: public getDefinition returns `[]` for a real declaration.
- Evidence: `E:865` selects the TS grammar; `E:463` rejects any ERROR capture; `E:423` stops before imports. Target rejection is at `E:441`. `D:431` does not disclose this limitation.
- Reproduction: `export const Widget = () => <div/>;` at line 0, column 13 returns `[]`. So does `export class Widget {}\nconst view = <div/>;` at line 0, column 13. Installed TypeScript's TSX parser reports zero syntax diagnostics for both; the actual tree-sitter TS grammar emits ERROR for JSX. A no-JSX class control resolves at line 0, column 13.
- Current handling: an ERROR anywhere invalidates even a separately parsed correct class declaration. The executor report discloses the deviation; the tool description does not.
- Recommendation: parse TSX with a JSX-capable grammar/parser while preserving syntax-aware rejection of comment text. Add cursor and imported-target regressions, including a plain declaration with unrelated JSX. Describe any remaining language limitation; disclosure alone does not restore behavior.

The former regex was unsafe for comments, but its documented class/const prefixes correctly matched these simple real declaration lines. The executor confirms the TSX loss. This is a regression from round one's fallback, not a claim that the pre-Batch-8 empty-index implementation worked or that the regex understood all TSX. Indexed lookup is unaffected because it returns before the fallback (`E:338`).

### M1 — Part A: Go type aliases omitted from the query

- Trigger: empty/no index and a top-level Go type alias.
- Symptom: lookup from a use returns `[]`, while a defined-type control resolves.
- Evidence: `E:182` matches only `(type_declaration (type_spec ...))`; the installed grammar uses `type_alias` for aliases.
- Reproduction: `package p\ntype Widget = int\nvar value Widget\n`, `getDefinition('C:/repo/main.go', 2, 10)` returns `[]`. Real grammar `hasError` is false and its tree contains `(type_declaration (type_alias name: (type_identifier) type: (type_identifier)))`. Control `type Widget struct {}` resolves at line 1, column 5.
- Current handling: the query succeeds without a Widget capture; import fallback cannot supply this same-file declaration.
- Recommendation: add top-level `type_alias` name captures and a real-grammar regression. Round one's documented `type` prefix matched this simple alias form.

## Blocking issues

None established in this revision. The previous external read and false comment location were not reproduced after the fixes.

## Serious issues

### S1 — Part A: TSX fallback regression

- File: `apps/ptah-electron/src/services/electron-ide-capabilities.ts:463`.
- Scenario: normal React source and an empty/unavailable index.
- Impact: routine Electron navigation fails for valid local definitions and cannot proceed to relative imports; agents are not told the limitation in `tool-description.builder.ts:431`.
- Fix: JSX-capable declaration parsing plus cursor/target regression coverage, preserving containment and the one-target-read contract.

## Moderate and minor issues

- **M1, Part A:** Go aliases are a missing sibling of supported defined types (`E:182`); include `type_alias` and cover it with a real-grammar test.
- **Minor description precision, not an additional failure mode:** `D:398` says graph construction limits scanning to importing files. With B2 fixed, an empty index still causes a full scan (`E:640`). Qualify the description with usable indexed declarations. Missing TSX disclosure is part of S1, not a duplicate finding.
- **Part B:** no reproduced behavioral defect remains in the named infrastructure changes.

## TOCTOU assessment

`E:506` resolves paths; `E:434` later opens the canonical path through `ElectronFileSystemProvider.readFile` (`electron-file-system-provider.ts:24`). This is not atomic handle-based containment. Retargeting the original junction alone no longer redirects the read, because the canonical path is used. A concurrent actor replacing a component of that canonical path could still race check/open.

No physical race was reproduced, and workspace directories were not mutated to attempt one. For this read-only local IDE helper, with no demonstrated privilege separation and direct cursor reads already accepting absolute paths (`E:791`), this is residual hardening uncertainty rather than a reproduced security/blocking finding. An adversarial-writer guarantee would require handle-based verification; another realpath check alone cannot close the race. The header's “never” at `E:20` is stronger than the implementation proves.

## Data flow

1. Cursor path/read/identifier — checked inputs work (`E:308`); existing absolute-path and read-error behavior retained.
2. Exact-name index selection — existing single/multiple-candidate order retained; fallback only for empty candidates (`E:333`, `E:352`).
3. Cursor syntax query — comment/string false positives fixed; S1 rejects TSX and M1 omits Go aliases (`E:418`, `E:182`).
4. AST relative-import resolution — checked relative imports work; existing package/alias/barrel limits remain (`E:533`).
5. Suffix probes and realpath containment — reproduced junction, UNC and ambient-module cases work (`E:484`, `E:506`).
6. One canonical target content read — bound retained; TSX target is also subject to S1 (`E:434`).
7. References use indexed scoping evidence and this workspace's graph — GlobalThing fixed (`E:634`).
8. Jest maps bare marked to installed UMD while retaining project mappings (`jest.preset.js:31`). Role fixture establishes its local root before resolution (`agent-role-resolver.service.spec.ts:93`).

## Requirements fulfilment

| Requirement                                   | Status   | Gap                                                               |
| --------------------------------------------- | -------- | ----------------------------------------------------------------- |
| Empty/no-reader imported-definition fallback  | COMPLETE | Real-parser guard and requested suites pass                       |
| Preserve working declaration forms            | PARTIAL  | S1 TSX, M1 Go alias                                               |
| Existing index disambiguation                 | COMPLETE | Existing passing specs; fallback not used for nonempty candidates |
| Contained import read, one target read        | COMPLETE | Static junction fixed; concurrent-mutation caveat above           |
| Empty-index reference recall                  | COMPLETE | Both GlobalThing locations returned                               |
| UNC and extensionless .d.ts                   | COMPLETE | Controlled probes pass                                            |
| Host-accurate descriptions                    | PARTIAL  | S1 undisclosed; reference clause needs indexed-evidence qualifier |
| Fixed-text new logs and audit baseline        | COMPLETE | Canonicalisation logs fixed text at E:521; audit passes           |
| Mapper/UMD and Electron workaround removal    | COMPLETE | Actual configs, sample equivalence and full targets pass          |
| Deterministic role-resolver fixture           | COMPLETE | Local marker wins despite Temp marker; suite passes               |
| Frozen prompts/enrich historical preservation | PARTIAL  | Executor attestation only; no historical comparison               |

Implicit requirements not addressed: valid syntax must not be mistaken for unavailable grammar coverage, and sibling declaration node kinds require parity checks.

## Edge cases

| Case                                                       | Handled         | How                                          | Concern                                                                                                                                       |
| ---------------------------------------------------------- | --------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Named default exported class/function                      | YES             | Real-grammar positions 21/24                 | Anonymous default aliases not claimed                                                                                                         |
| Export const arrow, abstract class, interface/type/enum    | YES             | Real-grammar probes return correct positions | Still name-based                                                                                                                              |
| Declare class/function/const/namespace; decorated TS class | YES             | Real-grammar probes resolve                  | No universal ambient-syntax claim                                                                                                             |
| Python decorated function; Go defined type                 | YES             | Real-grammar probes resolve                  | Go alias separately fails                                                                                                                     |
| JSX-containing TSX                                         | NO              | Whole-file ERROR abort                       | S1, even unrelated JSX                                                                                                                        |
| Go type alias                                              | NO              | No type_alias capture                        | M1                                                                                                                                            |
| Comment/template fake declaration                          | YES             | Syntax query excludes text                   | Regression suite passes                                                                                                                       |
| Empty index and built graph                                | YES             | Full scan retained                           | Existing bounded-scan limits remain                                                                                                           |
| Static external junction / realpath failure                | YES             | No target read                               | No atomicity guarantee                                                                                                                        |
| UNC and .d.ts                                              | YES             | Host-aware paths and suffix                  | No live network-share I/O                                                                                                                     |
| Parser failure / ERROR nodes                               | YES, unresolved | Result error or ERROR capture                | Query does not detect every MISSING node; missing closing brace still allowed a real class location in a probe, not counted as a wrong answer |
| Repeated parser calls                                      | YES             | Production query/tree disposed in finally    | No new growing cache/subscription                                                                                                             |

The ERROR policy is defensible for genuinely malformed files, but too strict when valid TSX is fed to the wrong grammar. The other requested common TS declaration forms passed; no wider TS query regression is claimed.

## Verdict

- Recommendation: **REVISE**
- Confidence: **HIGH** for reproduced defects and round-one fixes; limited for physical TOCTOU and live UNC I/O.
- Top risk: a cold-index Electron session loses normal React definition lookup despite valid source.
- What a robust implementation would add: JSX-capable declaration parsing, Go alias captures, public-method regressions for both, and accurate remaining-limit text in the LSP descriptions.
