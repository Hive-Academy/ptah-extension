# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Batch 4 post-cap r3 verdict | APPROVE |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 |

The bounded correction fixes the remaining availability/discovery finding. No new reproducible Batch 4 defect was found. The shipped text is 509 UTF-16 units and 509 UTF-8 bytes. All six requested project checks passed. The score is above the 5–6 band because the known contract failures are resolved and independently exercised across configurations, callers and Unicode boundaries. It remains below 9–10 because verification covers source-level behavior and project checks, not packaged-host/client interpretation or a historical baseline comparison.

Paths are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`. Below, `server-instructions.ts`, `server-instructions.spec.ts`, `protocol-dispatcher.ts` and `protocol-dispatcher.spec.ts` refer to `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/`.

## Round 1 and round 2 findings

| Prior finding | Status | Current evidence |
| --- | --- | --- |
| r1 M1: omitted substitutions sent to incomplete ptah.help() | fixed | `server-instructions.ts:39` labels help as execute_code API help; `:40` directs additional substitutions to available direct tools in tools/list. Help no longer promises the missing direct-tool mappings. |
| r1 M2: character-only ceiling permits more than 512 UTF-8 bytes | fixed | `server-instructions.ts:73`, `:91`, `:103`, `:155` budget every contribution in both units; `:170` preserves whole code points. The independent 14,721-case Unicode sweep and exact 512-byte cases passed. |
| r2 M1 remainder/F1: unconditional mappings and numeric omitted-tool promise fail on restricted hosts | fixed | Header and names are conditional (`server-instructions.ts:36`, `:38`), an absent tool has an explicit fallback (`:37`), and the closing has no numeric promise (`:40`). All 768 host configurations pass the availability-qualified contract. |
| r2 M2: retain the accepted byte-budget correction | fixed | The new fixed line is included in reservation at `server-instructions.ts:76`; no overflow or split valid code point occurred. |

## Five logic questions

### 1. How does this fail silently?

No new silent-success failure was reproduced. The previous false discovery promise is removed at `server-instructions.ts:36` and `:40`. When a tool is absent, the explicit line at `:37` supplies the fallback rather than implying discovery must find it. The initialize field is returned directly at `protocol-dispatcher.ts:297`; no separate success signal conceals an asynchronous construction failure.

### 2. What user action produces unexpected behaviour?

The prior actions—connecting a non-IDE host or disabling ide/code—still remove tools, as intended by `protocol-dispatcher.ts:405` and `:456`. They no longer invalidate the instructions. The only conditionally named unavailable tool in the current shipped text is ptah_lsp_references; its `Also, if listed:` prefix applies explicitly (`server-instructions.ts:111`). Changing caller identity or client name does not change the text (`protocol-dispatcher.ts:279`, `:297`); 6,144 initialize executions returned one distinct string.

### 3. What input data produces a wrong answer?

No wrong size, broken closing or split valid code point was reproduced with ASCII, CJK, emoji, combining marks, whitespace variants, malformed tables, non-string input or boundary-sized rows/names. Non-string input is normalized at `server-instructions.ts:63`; table parsing rejects invalid tool cells at `:135`. Unicode is counted at `:156`, and fallback truncation walks code points at `:170`. Existing lone surrogates are not repaired, but count toward UTF-8 bytes; preserving already-malformed input is not a newly split valid code point.

### 4. What happens when a dependency fails?

The new builder has no runtime I/O or asynchronous dependency: it uses a compiled export and synchronous parsing (`server-instructions.ts:28`, `:62`, `:120`). There is no new timeout, cancellation, partially committed write or resource lifecycle. Tool dependency failures retain their existing error paths (`protocol-dispatcher.ts:2209`); the requested suite covers tool exceptions (`protocol-dispatcher.spec.ts:1054`) and execute_code timeout with a throwing observer (`:2781`). The scoped diagnostics provider returned 0 errors and 0 warnings. No new dependency-failure regression was reproduced.

### 5. What is missing that the requirements never mentioned?

Host-dependent availability was the real missing case in r2. It is now represented explicitly without making the cached value depend on a caller (`server-instructions.ts:36`, `:37`, `:120`). Tests establish that restricted hosts actually lack tools (`server-instructions.spec.ts:205`), rather than testing wording against an unrealistically identical catalogue. Remaining uncertainty is how particular external models interpret prose; the source/configuration probes cannot prove model compliance.

## Failure modes

None reproduced in the Batch 4 change. Read the supplied seven-file scope in full, the protected mandate/policy passages, both prior reviews, both executor correction sections, Batch 4 and its preceding notes, and context Decisions 4/5. No task-description.md, implementation-plan.md or code-style-review.md exists in this plan-free task folder.

### Availability probe

Executed actual TypeScript-transpiled instruction builder, mandate constant, dispatcher initialize/list paths, caller resolver and tool-description builders in Node VM contexts. Unrelated service imports, result-budget metadata, three dashboard/surface builders and shared enum inputs were stubbed. This isolates the instruction/discovery contract; normal project tests cover the ordinary import graph.

| Probe | Result |
| --- | --- |
| 128 subsets of ide/agent/git/json/browser/harness/code × IDE true/false/undefined × SQLite true/false | 768 configurations |
| Configurations missing at least one mandate tool | 704, with four distinct missing-tool sets, matching r2 |
| Every configuration still advertises execute_code | Passed |
| Conditional header, absent-tool fallback, no numeric promise | Passed for all configurations |
| Two clients × four caller kinds × 768 hosts | 6,144 successful initialize responses |
| Distinct instruction strings | 1 |
| Instrumented reads of the source export | 1 |
| Shipped size | 509 chars / 509 bytes |

This probe does not assert that missing tools became available. It verifies that their absence no longer contradicts the availability-qualified mappings or promises an unavailable count (`server-instructions.ts:36`, `:38`, `:40`). The three fully mapped tools are always-on (`protocol-dispatcher.ts:380`); the conditional LSP name is gated by `:405`. Additional available substitutions remain in the always-on set even with both ide and code disabled.

### Budget and derivation probe

Seven token families × 701 lengths × three section shapes produced 14,721 results. Every result stayed within 512 chars and bytes, ended with ptah.help(), and round-tripped through UTF-8 without splitting valid pairs. Shapes were a row, a fallback and both together; tokens were ASCII, CJK, emoji, combining marks, spaced CJK, spaced emoji and accented text. Additional malformed/non-string cases passed.

Exact final-output boundaries passed: a two-row fixture with first description lengths 313/314 yielded 511/512 bytes; omitted-name suffix lengths 301/302 yielded 511/512 bytes. The second description/tool name was deliberately too large to fit. Sweeping lengths 0–599 found no overflow for either shape. Renaming the first mandate tool changed the derived output; reworded-fallback regression coverage passed (`server-instructions.spec.ts:220`, `:233`).

The general bound also follows from the implementation: the widest closing and all fixed separators are reserved (`server-instructions.ts:73`); every appended row/name must fit (`:91`, `:103`); the final closing is never larger than that reservation (`:68`). Fallback truncation reserves its ellipsis and never splits a code point (`:163`). This is not merely an ASCII-size assertion.

## Blocking issues

None reproduced.

## Serious issues

None reproduced.

## Moderate and minor issues

None supported by the Batch 4 evidence. Wording preferences are not findings.

## Protected mandate and fallback consistency

The header scopes these substitutions to tools listed in discovery (`server-instructions.ts:36`). Within that scope, the derived `Fall back to … only …` line remains intact (`:66`, `:109`; source `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts:56`). The adjacent fixed line covers the separate case where the replacement is not offered at all (`server-instructions.ts:37`, `:110`). It does not license skipping a listed, working tool. Consequently, the combined text has a coherent operational reading on both host classes: use listed replacements; follow the existing error/write/build/test/git exceptions; use a built-in when no listed replacement exists. This is the availability exception requested by the r2 recommendation, not a weakening to accommodate a listed tool's degraded result.

The protected symbol/AST-first instruction (`ptah-core-prompt.ts:59`) still applies when those tools are available. Native policy continues to prefer direct ptah tools and reserve writes for native tools (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:409`). No contradictory executable behavior or repeated discovery loop was reproduced. A purely literal reading of the isolated word “only” would ignore the explicit adjacent exception; that wording concern alone is not a demonstrated defect.

Raw-buffer comparisons against the primary checkout found both the entire ptah-core-prompt.ts and cli-adapter.utils.ts byte-identical. This supports Decision 4; it is not an independent historical HEAD comparison. The executor reports an empty protected-file diff at `batch-4-executor-report.md:186`; no git operation was run during this review.

## Data flow

1. **OK:** unchanged mandate is re-exported through `libs/backend/agent-sdk/src/lib/prompt-harness/index.ts:13` and `libs/backend/agent-sdk/src/index.ts:286`. Dependency declaration is at `libs/backend/vscode-lm-tools/package.json:17`.
2. **OK:** builder imports that export and parses table/fallback (`server-instructions.ts:28`, `:65`, `:66`), with no duplicated mandate literal.
3. **OK:** reserve fixed lines and widest closing, retain table-order rows, then table-order omitted names (`:73`, `:89`, `:98`). Both unit ceilings hold.
4. **OK:** availability-qualified glue and final API-help closing are joined (`:108`). No count depends on a host-specific catalogue.
5. **OK:** synchronous lazy memo computes once per loaded module (`:120`); there is no await across a shared-state read/write.
6. **OK:** initialize returns the cached value outside tools/call request context (`protocol-dispatcher.ts:229`, `:242`, `:297`). tools/list keeps existing caller resolution and host gates (`:338`, `:405`, `:456`).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Truthful instructions across host/namespace combinations | COMPLETE | 768-case probe; explicit availability conditions |
| Derived table and fallback | COMPLETE | Source tracing and mutation tests |
| At most 512 chars and bytes, code-point-safe truncation | COMPLETE | General accounting review, Unicode sweep and exact boundaries |
| Ends with ptah.help() | COMPLETE | Both closing branches and all probe outputs |
| Identical for callers, computed once | COMPLETE | 6,144 handshakes; one string and one export read |
| Preserve protected constants and mandate | COMPLETE within available comparison | Primary-checkout byte equality; historical baseline not independently checked |
| Initialize remains outside request context | COMPLETE | `protocol-dispatcher.ts:229` |
| No Batch 4 regression | COMPLETE within scoped verification | Six requested Nx tasks passed; no packaged-host launch |

Implicit requirements not addressed: none identified within the reviewed change.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| IDE absent/false, ide or code disabled | YES | Listed-only mappings plus absent-tool fallback | No unconditional count |
| Empty/non-string/malformed table | YES | Normalization and skipped rows | Bounded text retained |
| Oversized row/name | YES | Keep only the fitting prefix | Table order preserved |
| Oversized Unicode fallback | YES | Dual-unit truncation on code points | Does not repair pre-existing invalid Unicode |
| Exact 512-byte result | YES | Boundary probes for rows and names | No overflow |
| Repeated/concurrent requests | YES | Synchronous module memo | Per-module cache, no per-caller state |
| Dependency timeout/error | YES within regression scope | Existing tool error handling tests pass | No new async dependency in derivation |

## Verification and limitations

- Ran once from the required worktree root: `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/agent-sdk --skip-nx-cache`, output tailed. Exit 0; all six tasks passed; Nx duration 41.6 seconds. One completion read, no suite rerun. No real-port EACCES failure was reported.
- Scoped ptah_get_diagnostics returned 0 errors, 0 warnings from typescript-compiler.
- ptah_search_files returned no AGENTS.md. No direct file-read tool was listed, so native reads were used; the targeted native instruction-file search also returned none.
- Probe scripts ran from stdin and were not persisted. No production/spec edits, task-state edits, git operations or raw .jsonl/.sqlite session-log reads were performed. Only this review deliverable was written.
- These results establish the reviewed logic and scoped regression checks, not a packaged application launch, external-client/model behavior, or the complete repository's correctness.

## Verdict

- Recommendation: **APPROVE**
- Confidence: **HIGH** for the bounded correction, host matrix and size/cache contracts; limited for packaged-client interpretation and historical baseline identity.
- Top risk: future changes to catalogue gates or mandate format could outgrow the current prose/parser contract; current gates and source format passed the probes (`protocol-dispatcher.ts:378`; `server-instructions.ts:125`).
- What a robust implementation would add: no required correction. Retain the availability, derivation, Unicode and caller-identity guards when changing the mandate or tool catalogue.
