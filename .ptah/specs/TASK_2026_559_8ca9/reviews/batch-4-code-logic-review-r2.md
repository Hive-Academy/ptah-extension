# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | NEEDS_REVISION |
| Batch 4 round 2 verdict | REVISE |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 1 |

The byte-budget correction holds under reproduced Unicode and exact-boundary cases. The discovery correction works with IDE capabilities enabled and all namespaces enabled, but still advertises unavailable substitutions on other supported host configurations. This is one guidance/discovery defect, with shown-row and omitted-row manifestations; it is not two findings. The score remains in the sound implementation band: the bounded, cached handshake and all six scoped checks pass, separating it from 5–6; the unresolved advertised discovery contract prevents an 8.

Paths are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`. In short references below, `server-instructions.ts`, `server-instructions.spec.ts`, `protocol-dispatcher.ts`, and `protocol-dispatcher.spec.ts` are under `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/`.

## Round 1 findings

| Finding | Status | Round 2 evidence |
| --- | --- | --- |
| M1: omitted substitutions sent to incomplete `ptah.help()` | **not fixed** in full | The original wrong-help destination is removed at `server-instructions.ts:65`. Re-running help still produces topic-not-found for code, memory and webSearch, but that is no longer the advertised destination. The replacement destination remains incomplete when IDE capabilities are absent or ide/code namespaces are disabled: F1 below. |
| M2: UTF-16 accounting permits output above 512 UTF-8 bytes | **fixed** | Every budget step uses `size()` (`server-instructions.ts:69`, `:82`, `:85`, `:95`, `:97`, `:149`); fallback truncation walks code points (`:163`). The original 400-CJK-character reproduction now returns 104 characters / 104 bytes, naming `ptah_ast_analyze` separately. A 14,721-case sweep and exact-boundary checks found no overflow. |

## Five logic questions

### 1. How does this fail silently?

The successful initialize result describes substitutions without indicating that their availability varies by host (`protocol-dispatcher.ts:297`; `server-instructions.ts:32`, `:65`). On a non-IDE host, two explicitly shown tools are absent from the tool list and one of the eleven promised omitted tools is absent. This is F1, a misleading instruction rather than a silent successful data operation. No new silent result corruption was reproduced.

### 2. What user action produces unexpected behaviour?

Connecting an external client to a host without IDE capabilities, or disabling the ide namespace, still instructs the client to use `ptah_lsp_references` and `ptah_lsp_definitions`, although neither is exposed in `tools/list` (`protocol-dispatcher.ts:405`). Following the closing to discover dirty-file inspection also fails because `ptah_get_dirty_files` is missing. Disabling code similarly removes eight promised omitted substitutions (`protocol-dispatcher.ts:456`).

### 3. What input data produces a wrong answer?

`hasIDECapabilities: false` or omitted, and `disabledMcpNamespaces: ['ide']` / `['code']`, cause the discovery mismatch in F1. Unicode section variants did not violate the size or closing contract (`server-instructions.ts:149`, `:163`). Pre-existing lone surrogates can remain in the output, but are counted as three UTF-8 bytes each and survive JSON stringify/parse. The code promises not to split valid code points, not to repair malformed input; no separate defect is assigned.

### 4. What happens when a dependency fails?

Derivation is synchronous over a compiled constant, with no I/O, timeout or cancellation boundary (`server-instructions.ts:56`, `:113`). Non-string inputs become an empty section (`:57`). The capability/configuration dependency is not consulted when constructing the instructions, although it is used by discovery (`protocol-dispatcher.ts:279`, `:378`). Existing tool-error and execution-timeout regressions passed in the scoped suite (`protocol-dispatcher.spec.ts:1054`, `:2379`, `:2781`). No new dependency-failure regression was reproduced.

### 5. What is missing that the requirements never mentioned?

Byte-identical instructions across callers need an explicit availability qualifier when the advertised mandate spans tools gated by host capabilities or configuration. Caller independence does not imply every host exposes the same tools (`protocol-dispatcher.ts:354`, `:405`, `:456`). The new discovery test uses only `hasIDECapabilities: true`, with no disabled namespaces (`server-instructions.spec.ts:120`, `:130`), so it misses this case.

## Failure modes

### F1 — Discovery guidance promises tools that the host does not expose (Moderate)

- Trigger: initialize on a non-IDE host, with the ide namespace disabled, or with the code namespace disabled.
- Symptom: the client receives mandatory-looking mappings to unavailable LSP tools and/or cannot find all eleven omitted substitutions at the advertised `tools/list` destination.
- Evidence: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/server-instructions.ts:65`; `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:297`, `:405`, `:456`. These are real settings passed from the HTTP server at `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts:377` and `:381`.
- Current handling: the instruction builder counts rows from the shared mandate, independent of the host's effective tool set. The shipped text says `11 more ptah_* substitutions: see tools/list. execute_code API: ptah.help()`. The direct-tool check covers only an IDE-enabled, fully enabled host (`server-instructions.spec.ts:130`).
- Impact: external clients receive conflicting guidance about which tools they can discover/use, wasting discovery or tool calls and obstructing the intended substitution workflow. No data loss, corruption or security failure was reproduced; severity remains moderate.
- Recommendation: keep one cached caller-independent string, but qualify the mappings as applying when the tools are listed, direct clients to `tools/list` for **available** tools, and explicitly allow fallback when a named tool is unavailable. Avoid an unconditional numeric promise that all remaining mandate rows occur in that list. Preserve the protected prompt constant, the final `ptah.help()`, both size bounds and existing capability/namespace gates. Add discovery tests for non-IDE and disabled ide/code configurations.

Reproduced through the actual transpiled `handleMCPRequest`, instruction builder and tool-definition builders, with unrelated service imports stubbed:

| Host settings | Shown tools absent from tools/list | Omitted tools absent from tools/list |
| --- | --- | --- |
| IDE true, namespaces enabled | None | None |
| IDE false or omitted | `ptah_lsp_references`, `ptah_lsp_definitions` | `ptah_get_dirty_files` |
| IDE true, ide disabled | `ptah_lsp_references`, `ptah_lsp_definitions` | `ptah_get_dirty_files` |
| IDE true, code disabled | None | `ptah_code_search_symbols`, `ptah_ast_analyze`, `ptah_context_enrich_file`, `ptah_get_dependents`, `ptah_memory_search`, `ptah_relevance_rank_files`, `ptah_project_detect_monorepo`, `ptah_get_symbol_index` |
| IDE false, code disabled | Both LSP tools | Dirty-files plus the eight code tools |

An additional execution of the source's `buildToolDefinitions` across all 128 subsets of its seven namespace toggles, three IDE states (true/false/undefined), and two SQLite states covered **768 configurations**. **704** lacked at least one mandate tool; there were four distinct missing-tool sets. The unrelated namespace toggles introduce no additional variation in mandate availability. `hasSqliteLayer` changes eager metadata rather than membership (`protocol-dispatcher.ts:598`).

The current shipped instructions **show** `ptah_lsp_references`; they do not omit it. The omitted non-IDE counterexample for this exact text is `ptah_get_dirty_files`.

## Blocking issues

None reproduced.

## Serious issues

None reproduced.

## Moderate and minor issues

- **F1:** unconditional availability/discovery wording at `server-instructions.ts:65`, coupled with the unqualified mappings under `:32`. Correct the guidance and broaden the existing discovery guard. No separate style or test-only finding is counted.

## Data flow

1. **OK:** source mandate is re-exported through `libs/backend/agent-sdk/src/lib/prompt-harness/index.ts:13` and `libs/backend/agent-sdk/src/index.ts:286`; the direct dependency is declared at `libs/backend/vscode-lm-tools/package.json:17`.
2. **OK:** the builder imports that export (`server-instructions.ts:24`), parses the table and fallback (`:59`, `:118`, `:134`) and derives the text. Rename/reword checks passed (`server-instructions.spec.ts:147`, `:160`).
3. **OK:** fallback and widest closing are reserved first; whole rows are kept in source order (`server-instructions.ts:69`, `:83`). Every addition is bounded in both units.
4. **F1:** omitted names and counts derive from all source rows (`server-instructions.ts:90`, `:105`), while the advertised destination applies independent capability/namespace gates (`protocol-dispatcher.ts:405`, `:456`).
5. **OK:** the synchronous module memo calculates once (`server-instructions.ts:109`, `:113`). An instrumented source-export getter was read once across repeated calls and 48 handshakes.
6. **OK:** initialize returns the string directly at `result.instructions`, outside caller-context handling (`protocol-dispatcher.ts:229`, `:242`, `:297`). Six host configurations × two client names × four caller identities produced one distinct instruction string.
7. **OK within scoped checks:** existing dispatch, tool budgets, caller-context, telemetry, image and approval behavior passed their regression suites (`protocol-dispatcher.spec.ts:2176`, `:2695`, `:2723`, `:3001`, `:3039`).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Derive table and fallback from exported constant | COMPLETE | Source and derivation tests verified |
| At most 512 UTF-16 units and UTF-8 bytes; final ptah.help() | COMPLETE | Shipped 500/500; Unicode sweep and boundary cases pass |
| Complete/truthful discovery guidance across host settings | PARTIAL | F1: absent IDE/code tools still promised |
| Caller/client independence | COMPLETE | 48 initialize executions, one string; scoped caller tests pass |
| Computed once | COMPLETE | Single source read in instrumented module; synchronous memo |
| Protected ptah-core-prompt.ts unchanged | PARTIAL verification | Byte-equal to the primary checkout copy; executor reports empty diff at batch-4-executor-report.md:147. Historical HEAD comparison was not run under the role's no-git rule |
| No regression elsewhere | COMPLETE within requested scope | All six project tasks passed; no packaged-host launch or workspace-wide verification |

Implicit requirement not addressed: qualify host availability without changing caller identity behavior or weakening the protected mandate.

## Edge cases

| Case | Handled | Evidence / concern |
| --- | --- | --- |
| Original 400-CJK-character row | YES | Now 104/104; dropped mapping is named directly |
| ASCII, CJK, emoji, combining marks | YES | Seven token families × 701 lengths × three section shapes = 14,721 cases; all bounded and closing retained |
| Lone high/low surrogate input | YES for requested budget | Preserved when retained; JSON round-trip works. Direct UTF-8 encoding replaces existing malformed units, but accounting covers their bytes; no split valid pair reproduced |
| Row exactly filling final budget | YES | Two-row fixture: 387-character first description gives 511 bytes, 388 gives 512, 389 drops the row |
| Names line exactly filling final budget | YES | With two oversized rows, first name `ptah_` + 373/374 `a`s gives 511/512 bytes; 375 drops the names line |
| Empty table plus very long Unicode fallback | YES | CJK words: 296 chars / 508 bytes; emoji-plus-combining words: 366/507; closing retained |
| Empty/non-string/malformed table | YES | Scoped malformed-input tests pass; empty section is 68/68 |
| Repeated requests / caller variants | YES | One memoized value, no await in construction |
| Non-IDE / disabled ide/code namespace | NO | F1 |

For the row boundary fixture, the second row has a 1,000-character description and a `ptah_` + 1,000-character name, so it cannot be separately named and the counted closing remains. The names-line fixture makes both row descriptions oversized and varies only the first omitted tool name. These exercise actual final 512-byte results, not just the conservatively reserved internal limit (`server-instructions.ts:85`, `:97`).

## Verification and limitations

- Ran once from the worktree root: `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/agent-sdk --skip-nx-cache`, tailing output. **Exit 0; all six tasks passed**, 51.4 seconds. One completion read; no suite rerun. No port EACCES failure was reported.
- Scoped `ptah_get_diagnostics` for the instruction builder and SDK barrel reported **0 errors, 0 warnings**, source `typescript-compiler`.
- In-memory TypeScript/Node VM probes executed production source; no production/spec edits or persisted reproduction script. The dispatcher probe used actual mandate-related tool builders, actual caller resolver and actual initialize/list paths. Unrelated service imports, budget metadata, three unrelated dashboard/surface tool builders and shared schema enum values were stubbed. This proves the discovery mismatch, not host startup; the normal Nx suite exercised the regular import graph.
- Re-ran the round 1 help reproduction: `help('code')`, `help('memory')`, `help('webSearch')` still return topic-not-found (`namespace-builders/system-namespace.builders.ts:588`), but the revised closing no longer directs omitted substitutions there. M1's remaining problem is specifically the new destination's availability promise.
- Read the supplied seven-file scope, round 1 report, executor revision, Batch 4/notes and context decisions. This task is plan-free; no task-description.md, implementation-plan.md or code-style-review.md was present in its folder. `ptah_search_files` returned zero AGENTS.md files; no direct file-read tool was available, so native reads were used.
- Protected-file comparison used raw buffers against the existing primary checkout copy and returned equal; that does not establish the historical commit baseline. No git operations were run. No raw .jsonl/.sqlite session logs were read. Only this review deliverable was written.

## Verdict

- Recommendation: **REVISE**
- Confidence: **HIGH** for F1 and the budget correction; limited for historical protected-file identity and packaged-host startup.
- Top risk: the new handshake directs non-IDE/configured clients to tools missing from their actual discovery surface.
- What a robust implementation would add: one availability-qualified, caller-independent instruction string and discovery guards covering IDE false/absent and disabled ide/code, while preserving the fixed byte budget and protected source constant.
