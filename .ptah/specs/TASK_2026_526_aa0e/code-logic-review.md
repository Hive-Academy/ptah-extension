# Code Logic Review — `TASK_2026_526_aa0e`

## Verdict

**APPROVE WITH FIXES** — the unification is directionally sound, the full suite is green, and the typed-stats migration preserves the old extractors' semantics on adapter-shaped data, but two proven major defects (a cache-defeating side effect inside `computed()`, and mid-run renderer flip that drops already-shown stdout) must be fixed before merge.

## Score

**60/100** — rubric: green test/lint/typecheck across all four projects and faithful behaviour migration earn the passing band; the two major defects with executable proof, plus one test that locks in the wrong design, hold it well below approval level.

## Defects

### 1. Side effect inside `computed()` defeats the segment cache and deletes sibling state

- **Location:** `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.ts:135` (calls `clearAgentCache`); cache keyed by count at `libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts:139`; `clearAgentCache` also deletes `eventStateMap` at `agent-monitor-tree-builder.service.ts:188-191`.
- **Scenario:** Any agent rendered through the segment path (codex, copilot, antigravity, opencode, cursor, pi). On every re-evaluation of `executionNodes` — every segment append, every coalesced text replacement, every `isStreaming`/`streamRevision` change while `streamEvents` is empty — the computed first deletes the agent's entire cache entry, then `buildTreeFromSegments` re-inserts it. The count-keyed cache can therefore never hit on this path: the intended memoization is dead code, and every keystroke-level delta rebuilds the whole tree in O(n). The call also mutates a non-reactive service `Map` from inside a pure computed, which violates Angular's computed contract, and deletes the `eventStateMap` entry, discarding event-builder state that this path never owned.
- **Severity:** major.
- **Evidence:** `agent-card-unified.review.spec.ts:50` — test asserts `clearAgentCache` is invoked inside the computed on mount and on every segment update. Reproduced: `Tests: 3 passed, 3 total` (see Verification).

### 2. Mid-run renderer flip drops already-rendered stdout

- **Location:** `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts:93` — selection is `segments.length > 0 || streamEvents.length > 0`; the rich renderer receives no stdout input (`agent-card.component.ts:94-103`, and `CliAgentOutputComponent` has no stdout input at `cli-agent-output.component.ts:105-118`).
- **Scenario:** A lane that previously fell to the flat default (antigravity, cursor, pi, opencode — and any future CLI) starts with stdout and no segments: the flat renderer shows it. When the first segment arrives, the card swaps to the rich tree, which never renders stdout. All output written before the first segment — CLI startup banners, raw process output emitted by the CLI itself rather than through `emitOutput`/`emitSegment` pairs — vanishes from the DOM mid-run. Inputs/state → wrong output: `{stdout: 'Initializing sandbox…', segments: []}` renders the banner; then `{stdout: same, segments: [{type:'text',…}]}` removes it from view.
- **Severity:** major (visible content loss on a likely path for every newly-rich lane).
- **Evidence:** `agent-card-unified.review.spec.ts:76` — test renders the card with stdout, asserts it is visible, adds one segment, and asserts `'Initializing sandbox environment'` is gone from `fixture.nativeElement.textContent`. Reproduced: `Tests: 3 passed, 3 total`.

### 3. `totalTokens` silently hidden once a split is ever reported

- **Location:** `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.ts:55-59` — the total renders only when both `inputTokens === undefined && outputTokens === undefined`.
- **Scenario:** Turn 1 reports total only (antigravity's total-only shape, `antigravity-cli.adapter.ts:1024-1028`); turn 2 reports an input/output split. `extractCliAgentStats` correctly holds all three (`stats-bar.utils.ts:57-60`), but the template hides the total forever after, so the earlier turn's token count disappears from the display. Inputs → wrong output: `[{usage:{totalTokens:1000}}, {usage:{inputTokens:200,outputTokens:100}}]` shows `↑ 200 ↓ 100` and never the 1000.
- **Severity:** minor.
- **Evidence:** `agent-card-unified.review.spec.ts:128` — asserts the rendered text contains `↑ 200` / `↓ 100` and does not contain `1.0k`, `1000`, or `total tokens`. Reproduced: `Tests: 3 passed, 3 total`.

### 4. Regression test locks in defect 1's workaround

- **Location:** `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.spec.ts:241` — "updates coalesced text when the segment count stays unchanged".
- **Scenario:** This test passes only because `executionNodes` clears the whole agent cache on every recompute. Fix defect 1 properly (for example, key the segment cache by a revision or content identity instead of count) and this test fails, because the same-count replacement would then be served from a correctly keyed cache — which is the behaviour the test actually wants. As written, it asserts the side effect's observable result, not the invariant, and will block the correct fix.
- **Severity:** minor (test quality, but it defends a major defect).

No further defects survived verification. Candidate suspicions I investigated and dropped, with evidence, are recorded under "Claims checked and found TRUE".

## Claims checked and found TRUE

**A. Multi-turn accumulation fidelity — TRUE, with one documented divergence.**
I copied both deleted extractors verbatim from `HEAD:stats-bar.utils.ts` into `stats-accumulation.review.spec.ts` and compared them against `extractCliAgentStats` on adapter-shaped data. Results (all reproduced green):

- Codex multi-turn (two `turn.completed` turns, both counts): old `extractCodexStats` and new both give `{inputTokens: 300, outputTokens: 80}`. Preserved.
- Explicit zero vs absent: a turn reporting `0 input, 0 output` adds 0 under both old and new (`(\d[\d,]*)` matches "0"; `usage.inputTokens === 0` is summed). Absent fields are retained as absent. Preserved.
- Latest model/cost/duration (copilot shape): old keeps latest `model: latest-model`, `durationMs: 500`, cost string `$0.0200`; new keeps the same values as `costUsd: 0.02` rendered by `toFixed(4)` to the same string. Preserved.
- **Documented divergence:** a turn that reports only one side (e.g. `usage: { outputTokens: 25 }`, which `copilot-sdk.adapter.ts:708` can genuinely emit when the SDK omits `inputTokens`) was skipped by both old extractors (`inputMatch && outputMatch` required) but is accumulated by the new one. This is a deliberate improvement, not a wrong answer — the old lanes either showed nothing (flat default) or under-reported.
- Double-count of summed `totalTokens` vs summed split: turn 1 `{totalTokens: 1000}`, turn 2 `{inputTokens: 400, outputTokens: 100, totalTokens: 500}` yields stats `{totalTokens: 1500, inputTokens: 400, outputTokens: 100}`, and the rendered bar shows only `↑ 400 ↓ 100` — the summed total is never displayed next to the split, so no double count is visible. (The total's *absence* is defect 3.) The antigravity `total_tokens` field is per `agent_response` step (`antigravity-cli.adapter.ts:1013-1031`, per the adapter's own "per-turn" test), so per-turn summing is the right model; I could not verify the vendor's semantics beyond the adapter's tests.

**B. `isUsageSegment` semantics change — TRUE, no content is lost with the current adapters.**
All four usage emitters attach `usage` only to an `info` segment whose `content` is the usage line itself: `antigravity-cli.adapter.ts:1021-1029`, `codex-cli.adapter.ts:1113-1120`, `copilot-sdk.adapter.ts:705-715`, `opencode-cli.adapter.ts:736-743`. A repo-wide grep for `usage:` across `cli-adapters/` finds no other construction site; the fifth hit (`codex-cli.adapter.ts:94`) is the SDK event type, not a segment. Cursor and pi adapters emit no `Usage:` text at all (grep returned nothing), so nothing that was previously visible becomes newly filtered, and no `text`/`tool-result`/`command` segment carries `usage`. Fragility note: the shared type now permits a future adapter to attach `usage` to a content-bearing segment, which `isUsageSegment` (`stats-bar.utils.ts:33-35`) would silently drop; no live defect today, but worth a guard comment or type-level constraint.

**C. stderr and the raw-stdout fallback — TRUE.**
`AgentCardOutputComponent` is still exported from the barrel at `libs/frontend/chat-ui/src/index.ts:25` and still reachable: `agent-card.component.ts:104-111` renders it whenever both collections are empty and stdout/stderr exist, and `parsedOutput` still runs `parseAgentOutput(stdout)` (`agent-card.component.ts:142-145`). The stderr markup in `cli-agent-output.component.ts:82-100` is byte-identical to the flat renderer's block (`agent-card-output.component.ts:288-306`) — same classes, same escaped `{{ seg.content }}` interpolation, same `error`/`info` split. Both are covered by rendered tests: `cli-agent-output.component.spec.ts:159` (stderr beside the rich tree, script injection escaped) and `:176` (flat fallback shows stdout, parsed tool name and stderr).

**D. `ptah-cli` regression — TRUE, rendering and invalidation preserved; one acceptable corner change.**
The event path is unchanged: `executionNodes` still reads `streamRevision()` to invalidate the in-place-mutated array (`cli-agent-output.component.ts:131`, same pattern as the deleted component's computed), still calls `buildTree(agentId, events)` when events exist (`:139`), still finalizes orphaned tools when not streaming (`:144-147`), and the `clearAgentCache` side effect does not fire on this path (`:133-136` skips it when `events.length > 0`). No adapter attaches `usage` for the ptah-cli lane (grep across `cli-adapters/`), so `modelStats()` is null and no stats bar appears where none appeared before; the outer wrapper markup matches the deleted component exactly. Corner change: a ptah-cli agent with `segments` but empty `streamEvents` previously rendered flat via `mergeConsecutiveTextSegments(agent.segments)`; it now renders the rich segment tree. This is the refactor's stated intent ("any agent with segments or stream events uses the rich renderer") and I judge it acceptable.

**E. Conventions — TRUE.**
`cli-agent-output.component.ts` and both new spec files use standalone components, `ChangeDetectionStrategy.OnPush`, signal `input()`/`computed()`/`effect()` and `inject()`. Grep found no `as any`, `@ts-ignore` or `@ts-expect-error` in any new or changed file; the two `parentSessionId!` non-null assertions in `agent-card.component.ts:71-73` are pre-existing and outside the diff hunks. Cross-lib imports go through barrels only (`@ptah-extension/shared`, `@ptah-extension/chat-ui`, `@ptah-extension/chat-streaming`, `@ptah-extension/core`); the service and ExecutionNode imports are same-lib relative paths. `chat:lint` exits 0 (see Verification).

**F. Weak tests — one found (defect 4).**
The coalesced-text test at `cli-agent-output.component.spec.ts:241` is the only test that asserts almost nothing independent of defect 1 — it validates the workaround, not the invariant, and will fail under a correct fix. The remaining 15 component cases and all three `stats-bar.utils.spec.ts` cases are substantive: they render the real component tree, assert on DOM text (including the negative `Usage:` assertion and `<script>` escaping), and pin accumulation semantics including explicit zeros, absent fields and empty usage.

## Verification

Reproduction of the three confirmed defects:

```
npx nx test chat --skip-nx-cache --testPathPatterns=agent-card-unified.review.spec.ts --runInBand
> nx run @ptah-extension/chat:test --testPathPatterns=agent-card-unified.review.spec.ts --runInBand
Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
Snapshots:   0 total
Time:        5.837 s
NX   Successfully ran target test for project @ptah-extension/chat
```

Claim A comparison spec (old extractors copied verbatim from HEAD vs new; includes rendered double-count check):

```
npx nx test chat --skip-nx-cache --testPathPatterns=stats-accumulation.review.spec.ts --runInBand
Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
Snapshots:   0 total
Time:        4.357 s
NX   Successfully ran target test for project @ptah-extension/chat
```

Full required suite:

```
npx nx run-many -t test,lint,typecheck -p chat,chat-ui,shared,cli-agent-runtime --skip-nx-cache
√  nx run @ptah-extension/shared:test
√  nx run @ptah-extension/shared:lint
√  nx run @ptah-extension/shared:typecheck
√  nx run @ptah-extension/chat-ui:test
√  nx run @ptah-extension/chat-ui:lint
√  nx run @ptah-extension/chat-ui:typecheck
√  nx run @ptah-extension/cli-agent-runtime:test
√  nx run @ptah-extension/cli-agent-runtime:typecheck
√  nx run @ptah-extension/cli-agent-runtime:lint
√  nx run @ptah-extension/chat:test
√  nx run @ptah-extension/chat:typecheck
√  nx run @ptah-extension/chat:lint

NX   Successfully ran targets test, lint, typecheck for 4 projects
Output of 12 successful tasks were not shown. Run with --verbose or --output-style=static to see it.
Run duration:      2m 30s
Cache:             Skipped (--skip-nx-cache)
```

Honesty note on my own test run: the first execution of `stats-accumulation.review.spec.ts` failed 2 of 5 tests — both failures were wrong expectations in my copied old-extractor harness (the old cost regex `/\$(\d+\.\d+)/` captures the full decimal string `$0.1000`/`$0.0200`, not my truncated `$0.10`/`$0.02`). No production behaviour was involved; after correcting the harness expectations, all 5 pass as shown above. This failure also confirmed the old and new cost displays render identically at four decimals.

## Temporary test files

- `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-unified.review.spec.ts` — found (left by the previous reviewer); proves defects 1-3. Keep until the defects are fixed, then remove or convert the assertions to the fixed behaviour.
- `libs/frontend/chat/src/lib/components/molecules/agent-card/stats-accumulation.review.spec.ts` — added by this review; proves claim A (old-vs-new accumulation fidelity, zero semantics, latest-value semantics, one-sided-turn divergence, no displayed double-count). Candidate to keep as a permanent regression test for the typed stats contract.