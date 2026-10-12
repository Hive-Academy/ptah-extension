# Phase 4 code-logic review — Batches 16–21

## Score: 7/10

The implementation is logically sound within the reviewed Batches 16–21 scope. The score is a 7 rather than 8 because the required focused Jest invocation did not start: the PowerShell argument delivered an invalid JSON value for `--moduleNameMapper`, so there is no executable verification result for this review. Source inspection covered the complete specified production paths, their adjacent shared pipeline boundary, the supplied phase documents, and the targeted specs' failure/race cases. There are no source-backed Blocking, Serious, Moderate, or Minor logic findings in this scope.

A score of 8 would require the focused suite to execute successfully. A score of 6 or below would require a demonstrated behavioural defect; none was found in the reviewed code.

## Blocking

None found.

## Serious

None found.

## Moderate

None found.

## Minor

None found.

## Evidence and boundary trace

- D3/D5 compilation and resolution are deliberately split. `display-surface-sync.component.ts:110-126` keys compilation by surface id and body and removes absent fences; `:195-210` reuses resolution only while the compiled object and every named input are referentially unchanged. The shared resolver is itself non-throwing at `libs/shared/src/mcp-apps-contracts/ptah-ui-pipeline.ts:80-109`, so a malformed resolved surface becomes an invalid fence rather than crashing the transcript.
- D10 state retention is narrow and per-surface: `display-surfaces.ts:297-302,382-412` compares only a surface's previous component signatures, and the write-port contract requires pruning all other stored state at `ptah-ui-display-dock.ts:69-80`. No panel-local state is used as the persistence authority.
- D12 is synchronous through the set/seen protocol. `display-surface-sync.component.ts:252-273` sets the publication, checks unseen fence keys, requests open only for live applied fences, then marks the same keys seen. There is no await between `hasSeen`, request, and `markSeen`, preserving the #73/#74 contract against a duplicate synchronous publish.
- `$limits` is reference-counted and single-flight. `ptah-ui-lane-limits.source.ts:77-127` starts one burst at holder transition zero-to-one, queues exactly one post-flight reread on a snapshot change, and destroys the watcher at zero holders. `:129-157` converts failed, timed-out, and malformed replies to explicit `unavailable`; `:161-223` structurally validates and allow-lists the response before renderer input.
- Untrusted fence content is compiled then validated by the shared pipeline (`ptah-ui-pipeline.ts:55-72,80-109`). The display application catches a failing injected compiler/resolver and records `invalid`, leaving existing panels unchanged at `display-surfaces.ts:192-208,254-269,350-379`.
- The panel preserves pinned behaviour: only an unpinned panel changes selection/scroll for a strictly newer sequence (`display-panel.component.ts:326-351`). Keyboard navigation is the only path that moves focus (`:397-423`), while the automatic path scrolls without focusing (`:444-456`), satisfying R1.6/R1.7.
- Cost remains explicit when absent: the model promises no fabricated zero at `turn-summary.model.ts:80-84`, and the panel keeps `unavailable` plus a not-reported affordance at `turn-summary.component.ts:583-594`. Files/lines have their distinct unavailable rendering at `:541-568`.
- The tests and change-set data are retained in the summary model, including run rows, command, failure lines, marks, and change set actions (`turn-summary.model.ts:48-63,95-128`). The rendered Tests component retains the progress and per-run disclosure path (`turn-summary-tests.component.ts:55-173`).
- Host source identity remains injector-scoped: the optional host token is read locally by the sync (`display-surface-sync.component.ts:85-92,217-231`) and `$agents` derives facts only for that host session (`ptah-ui-agents.source.ts:33-60`).
- The eager-reachable bridge files use type-only imports for lazy types: `ptah-ui-display-dock.ts:1-2`, `ptah-ui-host-sources.ts:1-4`, and the root barrel's host-source export (`index.ts:102-106`). The lazy entry is isolated by `tsconfig.base.json:52-54`.

## Five logic questions

1. **How does this fail silently?** No success-looking failure path was found. Compiler, resolver, renderer, and limits failures are converted to explicit invalid/unavailable states (`display-surfaces.ts:204-208,357-363`; `ptah-ui-lane-limits.source.ts:136-157`).
2. **What user action produces unexpected behaviour?** No action path was found to move focus on an automatic update; pinned updates retain selection, and unpinned updates only select/scroll a newer surface (`display-panel.component.ts:345-350,397-423`).
3. **What input produces a wrong answer rather than an error?** No such input was found. Invalid `$limits` shapes are rejected by exact-key and primitive validation (`ptah-ui-lane-limits.source.ts:186-223`), and invalid fences do not partially apply (`display-surfaces.ts:264-295`).
4. **What happens when a dependency fails, times out, or has the wrong shape?** Limits becomes `unavailable` with a payload-free warning, then retries only on the next snapshot change; pipeline conversion/validation returns an invalid result. Evidence: `ptah-ui-lane-limits.source.ts:129-157`; `ptah-ui-pipeline.ts:80-109`.
5. **What is missing that requirements never mentioned?** End-to-end mounting of the per-tab dock store and the transcript provider is intentionally outside Batches 16–21; this review therefore cannot prove the conditional #72–#74 integration. The reviewed library contracts preserve the required injection and state boundaries, but Batch 23–25 implementation must supply them.

## Verification

- `git diff --check b66148f4c..5f356dc96` produced no whitespace errors.
- The sole permitted focused Jest attempt did not run tests because its `--moduleNameMapper` JSON was rejected by Jest before discovery. No second Jest command was run, per the memory-safe rule.
- `ptah_get_diagnostics` and `ptah_agent_report` were not available in this agent environment; native read/search was used as the instructed fallback.

VERDICT: APPROVED
