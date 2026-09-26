# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric              | Value                    |
| ------------------- | ------------------------ |
| Overall score       | 8/10                     |
| Assessment          | APPROVED                 |
| Requested verdict   | APPROVE                  |
| Blocking issues     | 0                        |
| Serious issues      | 0                        |
| Moderate issues     | 0                        |
| Failure modes found | 0 new reproduced defects |

Post-cap independent round 3, Batch 8 (Part A) and test infrastructure (Part B), 2026-09-26. The bounded correction satisfies the explicitly accepted scope. TSX support is **accepted-as-scoped**, not implemented: an empty-index TSX lookup deliberately returns no location, the limitation is disclosed, and indexed TSX lookup remains usable. Go aliases now resolve with the real grammar. The six r1 findings remain fixed in their regression scenarios. No new reproduced behavioral defect was found.

The passing real-parser/real-filesystem regressions and scoped verification justify the sound 7–8 band rather than 5–6. Deferred TSX coverage, the existing reference-description imprecision, and the limits of physical-race/live-UNC verification prevent an exemplary 9–10 assessment.

Paths are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`. Abbreviations:

- **E**: `apps/ptah-electron/src/services/electron-ide-capabilities.ts`
- **ES**: `apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts`
- **D**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`
- **DS**: the adjacent `tool-description.builder.spec.ts`
- **RS**: `libs/backend/cli-agent-runtime/src/lib/roles/agent-role-resolver.service.spec.ts`

## Scope and verification

Read all eight named source/spec/config files in full, both previous reviews, both executor reports including the bounded correction, Batch 8, context Decision 4, and the relevant research. No task-description.md, implementation-plan.md, or code-style-review.md exists in this task folder. `ptah_search_files` found no AGENTS.md; native discovery also found none. No Ptah file-read tool was listed, so native reads were used. Also inspected parser query conversion/disposal, the Electron filesystem adapter, graph readiness, role-root resolution, Electron registration, and VS Code provider/tool gating.

Only this review document was written by the reviewer. No source edits, git operations, or raw session-log reads were performed. Requested tests create their own fixtures/build outputs.

Independent verification from the worktree root:

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p ptah-electron @ptah-extension/vscode-lm-tools @ptah-extension/cli-agent-runtime --skip-nx-cache`: **PASS**, all 15 tasks including six build prerequisites, exit 0, 1m49s. This runs the real-grammar Go/TSX and earlier containment/reference regressions, description budget assertions, and role-resolver suite. No failed suite was rerun.
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache`: **PASS**, exit 0, 16.7s, total 300 unsuppressed sites.
- Scoped `ptah_get_diagnostics`: **unavailable** after its 45-second limit; no clean diagnostic result is claimed. The independent Nx project typechecks passed.
- In-memory evaluation of the actual description builders measured definitions **572 characters** and references **472**, both below the 1,000-character budget (`DS:13`, `DS:68`).
- Actual Jest `--showConfig` for Electron and vscode-lm-tools retained project-specific vscode/wasm/Electron mappings and inherited the absolute marked mapper (`jest.preset.js:31`). Installed UMD and ESM export-key sets matched; three samples (heading/paragraph, quote/code fence, task list/link) produced identical lexer output and HTML. This is finite compatibility evidence, not a guarantee about future releases.
- `%TEMP%/.ptah` exists on this machine. The role suite passes with its own local marker (`RS:93`).

### Baseline reasoning for S1

This role prohibits git operations, so no independent checkout/diff against main was obtained. The recorded pre-batch code analysis states that zero index candidates returned `[]` regardless of cursor position (`research/code-intel.md:471–489`) and that import resolution was only a multiple-candidate disambiguator (`research/code-intel.md:501`). The executor records the same pre-Batch-8 TSX baseline (`batch-8-executor-report.md:212`). Thus, against the documented main baseline, deliberate empty-index TSX refusal is not a regression. The r2 loss was relative to r1's unsafe regex fallback, as r2 itself explicitly notes.

The current code independently establishes the scoped behavior: index results return first (`E:334–340`); `.tsx` maps to no declaration language (`E:868–871`); cursor refusal occurs at `E:425`; target refusal occurs at `E:436–437`, before its content read at `E:438`. `extToLanguage` still maps TSX as before for other paths (`E:882`). Historical frozen-prompt/enrich preservation remains executor-attested, not independently byte-compared; the current enrich block retains its declaration-only/refusal contract (`D:1632`).

## r1 and r2 finding disposition

| Review / finding                             | Part | Status             | Current evidence and impact                                                                                                                                                                                                                                                              |
| -------------------------------------------- | ---- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| r1 B1: junction/symlink containment          | A    | fixed              | Canonical root/target comparison and canonical read (`E:495`, `E:510–515`, `E:438`); real directory-junction regression `ES:655`, injected file-symlink canonical result `ES:669`, canonicalisation failure `ES:686`. External target content is not read.                               |
| r1 B2: empty-index reference narrowing       | A    | fixed              | Only indexed declarations scope references; zero candidates return full-scan signal (`E:638–644`). Global-script regression `ES:1055` retains both locations; `ES:1088` checks a graph belonging to another workspace.                                                                   |
| r1 B3: comment/string declarations           | A    | fixed              | Top-level syntax queries and ERROR rejection (`E:153`, `E:467`); real-parser comment, imported declaration, template and nested-scope guards (`ES:702–760`). Declaration-shaped text no longer overrides the tested real import.                                                         |
| r1 M1: UNC root loss                         | A    | fixed              | Windows-aware resolution preserves UNC (`E:923–927`); real-parser/controlled-filesystem UNC tests `ES:826`, `ES:840`. No live SMB share was tested.                                                                                                                                      |
| r1 M2: missing extensionless .d.ts           | A    | fixed              | Direct and index declaration suffixes at `E:113–115`; real-file regression `ES:763` pins correct location and suffix order.                                                                                                                                                              |
| r1 M3: role fixture inherits ancestor marker | B    | fixed              | Fixture creates local `.ptah` (`RS:93`), matching nearest-marker search (`libs/backend/harness-sync/src/lib/workspace/workspace-root.ts:94`); suite passes despite Temp marker.                                                                                                          |
| r1 minor: redundant Electron workaround      | B    | fixed              | Exemption and allowJs removed (`apps/ptah-electron/jest.config.ts:5`, `apps/ptah-electron/tsconfig.spec.json:3`); actual merged mapper and Electron suite pass.                                                                                                                          |
| r2 S1: TSX empty-index lookup/disclosure     | A    | accepted-as-scoped | Deterministic refusal before query/target read (`E:423–437`, `E:868`), disclosed at `D:431`; `ES:869–909` checks JSX, unrelated JSX, no JSX and import target. Indexed TSX remains resolved (`ES:912–946`). Grammar packaging is explicitly deferred (`batch-8-executor-report.md:212`). |
| r2 M1: Go type_alias                         | A    | fixed              | Actual query includes type_alias (`E:183`). Real parser and disk fixture (`ES:419`, `ES:530`) return Widget at line 1, column 5 from the use at (2,10) (`ES:856–866`).                                                                                                                   |
| r2 minor: reference-scope wording            | A    | not fixed          | `D:398` still omits the usable-index condition implemented at `E:644`. Explicitly deferred (`batch-8-executor-report.md:214`); low-impact description precision, not a new behavioral failure or a reason to reopen the bounded correction.                                              |

## Five logic questions

### 1. How does this fail silently?

Part A retains an unresolved `[]` for unsupported TSX fallback, parser failure and unreadable files (`E:425`, `E:462`, `E:776`). TSX is now disclosed (`D:431`), and the previous false comment location/reference narrowing are covered by passing regressions (`ES:702`, `ES:1055`). No new misleading nonempty result was reproduced. Part B fails visibly if the installed UMD artifact cannot resolve (`jest.preset.js:31`).

### 2. What user action produces unexpected behaviour?

A cold-index TSX lookup still produces no location, now intentionally within the accepted scope (`E:868`, `ES:877`). Building another workspace's graph or looking through a static external junction no longer triggers the earlier failures (`ES:1088`, `ES:655`). No new unexpected action/result pair was reproduced.

### 3. What input data produces a wrong answer?

The previous Go alias fixture now returns the exact declaration position (`ES:856`). Comment/template declaration-shaped text is excluded (`ES:702`, `ES:725`). The resolver remains name-based rather than type-aware (`D:431`, `E:352`); no broader semantic-resolution guarantee is inferred from these finite cases.

### 4. What happens when a dependency fails?

Realpath fails closed with fixed-text logging (`E:518–528`); read failures return null (`E:776–787`); parser Result errors return uncertain (`E:461–462`); AST exceptions return unresolved (`E:545–555`). Production parser query errors become Result errors and query/tree objects are deleted in finally (`libs/backend/workspace-intelligence/src/ast/tree-sitter-parser.service.ts:464–473`). Index promise rejection still propagates (`E:383`), rather than being treated as an empty index. No new background task or resource lifetime was introduced. There is no new cancellation or byte/time limit on the one target read (`E:438`); the promised bound is content-read count.

### 5. What is missing that the requirements never mentioned?

An atomic check/open containment guarantee and live network-share testing remain unproven (`E:495`, `E:438`). Reading the canonical path protects against simply retargeting the original junction, but concurrent replacement of canonical path components is not an atomic handle-based guarantee. No race was reproduced. TSX grammar packaging is now a named cross-batch follow-up (`batch-8-executor-report.md:212`), rather than an undisclosed expectation.

## Failure modes

No new reproduced defect in Part A or Part B. Examined indexed and empty-index flows, cursor/import-target refusal, declaration captures, bounded reads, physical containment, reference scoping, host descriptions, mapper merging and fixture isolation. Passing regressions provide runtime evidence; source inspection covers failure propagation and parser disposal. Remaining uncertainty is historical comparison, live UNC I/O, concurrent filesystem mutation, very large inputs and semantic cases outside this name-based resolver's scope.

## Blocking issues

None reproduced in either part.

## Serious issues

None under the explicitly accepted TSX scope.

## Moderate and minor issues

No moderate issue reproduced. The previously recorded Part A minor wording imprecision remains: qualify graph-based narrowing with usable indexed declarations (`D:398`, `E:644`). Part B has no reproduced remaining defect.

## Data flow

1. **OK:** read cursor once and extract identifier (`E:316–322`).
2. **OK:** exact-name index lookup, deduplication and existing local/import/all disambiguation (`E:352–401`); any usable indexed result precedes fallback (`E:339`).
3. **OK within scope:** TSX refuses; supported cursor syntax is queried for top-level declarations (`E:420–426`).
4. **OK:** relative import analysis, lexical containment, ordered suffix probes, canonical containment (`E:428–435`, `E:489–515`).
5. **OK within scope:** reject TSX target before read; otherwise read exactly one canonical target and query it (`E:436–447`).
6. **OK:** references use this workspace's graph and indexed evidence only; empty index retains bounded full scan (`E:638–644`, `E:606`).
7. **OK:** Electron composition root supplies existing collaborators (`apps/ptah-electron/src/di/phase-3-storage.ts:189`); tool gating remains capability-based (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:407`).
8. **OK, Part B:** root mapper resolves installed marked UMD while project mappings survive (`jest.preset.js:31`); local fixture marker prevents ancestor root capture (`RS:93`).

## Requirements fulfilment

| Requirement                                              | Status   | Gap                                                   |
| -------------------------------------------------------- | -------- | ----------------------------------------------------- |
| Imported definition with empty/no reader                 | COMPLETE | Real fixture `ES:573`, `ES:592` passes                |
| Preserve indexed TSX and multi-candidate behavior        | COMPLETE | `ES:912`, `ES:305`, `ES:331`, `ES:343`                |
| TSX refusal and truthful budgeted disclosure             | COMPLETE | Scoped contract; grammar implementation deferred      |
| Go alias real-grammar regression                         | COMPLETE | `E:183`, `ES:856`                                     |
| r1 containment, reference scan, syntax, UNC, .d.ts fixes | COMPLETE | Evidence in disposition table                         |
| Part B mapper and hermetic fixture                       | COMPLETE | Actual config/sample checks and requested suites pass |
| Historical untouched prompts/enrich                      | PARTIAL  | Executor attestation; no git comparison permitted     |

Implicit requirements not established: adversarial atomic filesystem containment and full language-server semantics are not proven by this review.

## Edge cases

| Case                                      | Handled               | How                                          | Concern                                        |
| ----------------------------------------- | --------------------- | -------------------------------------------- | ---------------------------------------------- |
| Empty index / absent reader               | YES                   | Relative-import fallback, `ES:573`, `ES:592` | Throwing reader is a different failure         |
| TSX cursor with/without JSX               | YES, scoped refusal   | `ES:869`                                     | No fallback support until grammar follow-up    |
| TSX import target                         | YES, scoped refusal   | No target content read, `ES:899`             | Same limitation                                |
| Indexed TSX                               | YES                   | Index path first, `ES:912`                   | Existing name ambiguity remains                |
| Go alias                                  | YES                   | Real grammar, `ES:856`                       | Finite declaration coverage                    |
| Junction / canonicalisation error         | YES                   | Fail closed, `ES:655`, `ES:686`              | Concurrent canonical-path replacement untested |
| UNC / .d.ts                               | YES                   | `ES:826`, `ES:763`                           | UNC filesystem controlled                      |
| Comments / strings / nested declaration   | YES for covered cases | `ES:702–760`                                 | Not a semantic binder                          |
| Empty index + built/other-workspace graph | YES                   | Full scan, `ES:1055`, `ES:1088`              | Existing scan caps remain                      |
| Repeated parser calls                     | YES                   | Query/tree disposed, parser service:471      | No new session-growing resource                |
| Ancestor Temp marker                      | YES                   | Local marker, `RS:93`                        | Suite passed with ancestor present             |

## Verdict

- Recommendation: **APPROVE** for Part A and Part B under the stated scope.
- Confidence: **HIGH** for the bounded correction and regression checks; historical main equivalence is reasoned from recorded pre-batch analysis, not independently diffed.
- Top risk: cold-index TSX navigation remains unavailable until the explicitly tracked grammar-packaging follow-up.
- What a robust implementation would add: complete that cross-batch TSX grammar work and replace refusal tests with positive cases, qualify the reference-description condition, and test live UNC/atomic containment only if stronger filesystem guarantees become requirements.
