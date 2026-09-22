## Defects fixed

### Defect 1 — Correct segment cache ownership and invalidation

Removed the component's `clearAgentCache` call entirely (`libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.ts:143`). The builder now stores the segment array reference and count and reuses a tree only when both match (`libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts:44`, `:142`, `:149`). Checking the key is O(1); unchanged input reuses the tree. Changed segment input still requires the existing O(n) build, rather than pretending this builder incrementally assembles segment trees.

Verified the identity assumption against `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:814` and `:816`: coalesced text creates a replacement array with a replacement final segment, and ordinary appends spread into a new array. The component's filtered segment array is itself memoized by a computed input. A same-count content replacement therefore invalidates the cache without any component-managed eviction.

The event-path implementation and its incremental state map are unchanged. Permanent regressions at `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-unified.spec.ts:53` and `:97` prove unchanged-tree reference reuse, same-count replacement, same-array append invalidation, no clear call, and preservation of the independent event tree for the same agent.

### Defect 2 — Keep stdout and its scroll container mounted

Selected option **(a)**: the unified component accepts `stdoutSegments` and renders parsed stdout ahead of its ExecutionNode tree. The card now mounts one output component regardless of whether structured segments/events have arrived (`libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts:87`, `:91`, `:128`). Raw stdout has an explicit accessible section label (`libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.ts:77`).

The existing flat renderer supplies parsed stdout markup inside that section. Its new `embedded` presentation input removes its private scrolling wrapper classes and suppresses its own scrolling effect (`libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.ts:39`, `:314`, `:330`). The unified component owns the single scroller and its existing requestAnimationFrame follow-output behavior.

This fixes the transition itself: no conditional branch replaces the output component, the scroller, or the raw-output child when the first structured segment arrives. Tests retain those exact DOM node references, set scrollTop to 37, verify it is not reset by the update, and verify the startup banner, parsed raw tool and new structured output remain rendered (`libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-unified.spec.ts:117`). Both a normal first text segment and an error-only failure are covered. The test separately flushes the existing follow-output frames after its remount/scroll-retention assertions, allowing rich streaming markdown to paint without confusing auto-scroll with container replacement.

### Defect 3 — Preserve reported totals alongside splits

The stats template renders any defined `totalTokens`, independently of split availability, with the label **Reported total: N tokens** (`libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.ts:59`). No value is derived from input plus output; these are separate reported accumulations and can cover different turns.

The converted proof checks that a total-only first turn remains visible after split counts arrive (`libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-unified.spec.ts:190`). The stats regression also checks 1000 + 500 reported total is displayed as 1.5k, not 2.0k after incorrectly adding the split (`libs/frontend/chat/src/lib/components/molecules/agent-card/stats-accumulation.spec.ts:98`).

### Defect 4 — Assert the rendered coalescing invariant

Rewrote the coalesced-text case to wait for actual Angular/markdown rendering and assert the DOM includes the replacement text after a same-count update (`libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.spec.ts:263`). It does not assert a cache key, a clear call, or computed internals. Separate focused cache regressions cover the memoization contract. Updated the existing service test title to describe unchanged-array reuse (`libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.spec.ts:326`).

## Design decisions

- **Stdout retention:** a permanently mounted unified scroller contains the raw transcript and the rich tree. No vendor switch, stateful transition snapshot, or heuristic text deduplication is introduced. The raw transcript may repeat content represented by structured nodes; preserving it is deliberate because these inputs do not identify which stdout bytes correspond to which structured events. The visible “Raw stdout” label distinguishes it.
- **Embedded flat rendering:** `embedded` is a current presentation/scroll-ownership input on an existing renderer, not a compatibility shim. Existing standalone consumers and truncation tests continue to use its standalone scrolling behavior; the unified component explicitly owns scrolling for its embedded child. Stderr remains rendered once, by the unified component.
- **Usage guard:** `isUsageSegment` now requires `type === 'info' && segment.usage !== undefined` (`libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.ts:33`). This matches all current dedicated usage emitters and prevents text, command and tool-result content from being hidden just because it carries metadata. Three parameterized guard cases are in `libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.spec.ts:4`; a rendered text-with-usage case is in `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.spec.ts:159`. Stats extraction still reads that metadata.
- **Review specs retained as permanent regressions:** renamed `agent-card-unified.review.spec.ts` to `agent-card-unified.spec.ts`, converted all three defect assertions to fixed behavior, and strengthened coverage with an error-only transition and direct cache-key checks. Renamed `stats-accumulation.review.spec.ts` to `stats-accumulation.spec.ts`, kept its five scenarios, and removed both copied legacy regex extractors. Explicit expectations on the typed contract replace the obsolete comparison implementation. Neither review filename nor any “PROVES DEFECT” title remains.
- **Scope and conventions:** retained the unified renderer, Angular standalone/OnPush/signal patterns, existing rendering safety boundaries and package-barrel imports. No backend usage code or shared type was changed in this revision. No git commands were run.

Files written in this revision (relative to the requested worktree):

| File | Change |
| --- | --- |
| `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.ts` | Remove cache eviction; add persistent stdout; always display reported totals |
| `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts` | Mount one unified output component and supply parsed stdout |
| `libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts` | Cache by array identity and length |
| `libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.spec.ts` | Correct the cache test's description |
| `libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.ts` | Support embedding under the unified scroller |
| `libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.ts` | Guard filtering by segment type |
| `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.spec.ts` | Assert rendered replacement content, embedded raw output, guarded text and total label |
| `libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.spec.ts` | Guard three content-bearing segment types |
| `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-unified.spec.ts` | Rename and convert the defect proof tests |
| `libs/frontend/chat/src/lib/components/molecules/agent-card/stats-accumulation.spec.ts` | Rename and retain typed-contract scenarios without legacy extractors |
| `.ptah/specs/TASK_2026_526_aa0e/revise-round-1-report.md` | This report |

Deleted the two original `.review.spec.ts` paths as part of those renames.

## Verification

All commands below ran from `D:/projects/ptah-extension/.claude-worktrees/refactor-task-2026-526-agent-card-output-unificatio-aa0e4830b53e`. Output is pasted as returned; Nx/Jest suppress successful per-case details in this workspace's reporter configuration. The permanent test titles and assertion locations are given above. No passing test counts were inferred.

`npx nx run-many -t test,lint,typecheck -p chat,chat-ui,shared,cli-agent-runtime --skip-nx-cache`

Exit code: **0**.

```text
NX   Running targets test, lint, typecheck for 4 projects:

- @ptah-extension/chat
- @ptah-extension/chat-ui
- @ptah-extension/shared
- @ptah-extension/cli-agent-runtime


√  nx run @ptah-extension/shared:test
√  nx run @ptah-extension/shared:lint
√  nx run @ptah-extension/shared:typecheck
√  nx run @ptah-extension/chat-ui:test
√  nx run @ptah-extension/chat-ui:lint
√  nx run @ptah-extension/chat-ui:typecheck
√  nx run @ptah-extension/cli-agent-runtime:test
√  nx run @ptah-extension/cli-agent-runtime:lint
√  nx run @ptah-extension/cli-agent-runtime:typecheck
√  nx run @ptah-extension/chat:test
√  nx run @ptah-extension/chat:typecheck
√  nx run @ptah-extension/chat:lint



 NX   Successfully ran targets test, lint, typecheck for 4 projects


Output of 12 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

  Run duration:      2m 4s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     46.9s (1 task)
  Recoverable time:  1m 17s (62% of the run)

  Recommendations:
    - Increase parallelism to recover up to 1m 17s → https://nx.dev/docs/concepts/ci-concepts/parallelization-distribution?utm_source=nx-cli&utm_medium=cli&utm_campaign=performance-report&utm_content=parallelization.
    - Cache: drop --skip-nx-cache to restore unchanged tasks instantly.
```

`npx nx test chat --skip-nx-cache --testPathPatterns='agent-card-unified.spec.ts|stats-accumulation.spec.ts' --runInBand --verbose`

Exit code: **0**.

```text
> nx run @ptah-extension/chat:test --testPathPatterns=agent-card-unified.spec.ts|stats-accumulation.spec.ts --runInBand

The `@nx/jest:jest` executor is deprecated and will be removed in Nx v24. Run `nx g @nx/jest:convert-to-inferred` to migrate to the `@nx/jest/plugin` inferred targets. See https://nx.dev/docs/guides/tasks--caching/convert-to-inferred for details.
Test Suites: 2 passed, 2 total
Tests:       10 passed, 10 total
Snapshots:   0 total
Time:        33.736 s
Ran all test suites matching agent-card-unified.spec.ts|stats-accumulation.spec.ts.



 NX   Successfully ran target test for project @ptah-extension/chat


  Run duration:      35.9s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     35.8s (1 task)
  Recoverable time:  <1ms

  Recommendations:
    - Cache: drop --skip-nx-cache to restore unchanged tasks instantly.
    - Speed up or split the longest tasks on the critical path:
        @ptah-extension/chat:test    35.8s
Failed to flush telemetry: Flush reply channel closed
```

`npx jest --config libs/frontend/chat/jest.config.ts --testPathPatterns='agent-card-unified.spec.ts|stats-accumulation.spec.ts' --runInBand --verbose`

Exit code: **0**.

```text
Test Suites: 2 passed, 2 total
Tests:       10 passed, 10 total
Snapshots:   0 total
Time:        9.521 s, estimated 11 s
Ran all test suites matching agent-card-unified.spec.ts|stats-accumulation.spec.ts.
```

`npx nx test chat --skip-nx-cache --testPathPatterns='agent-card-unified.spec.ts|stats-accumulation.spec.ts|cli-agent-output.component.spec.ts|stats-bar.utils.spec.ts' --runInBand`

Exit code: **1**.

```text
> nx run @ptah-extension/chat:test --testPathPatterns=agent-card-unified.spec.ts|stats-accumulation.spec.ts|cli-agent-output.component.spec.ts|stats-bar.utils.spec.ts --runInBand

The `@nx/jest:jest` executor is deprecated and will be removed in Nx v24. Run `nx g @nx/jest:convert-to-inferred` to migrate to the `@nx/jest/plugin` inferred targets. See https://nx.dev/docs/guides/tasks--caching/convert-to-inferred for details.
FAIL chat libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-unified.spec.ts (19.313 s)
  ● agent card unified output regressions › retains stdout, mounted nodes and scroll position when a first text segment arrives
    expect(received).toContain(expected) // indexOf
    Expected substring: "I have inspected the repository."
    Received string:    " Raw stdout Initializing sandbox environment
    Tool:read_file{\"path\":\"a.ts\"}"
      169 |         expect(output.textContent).toContain('read_file');
      170 |         expect(output.querySelector('ptah-execution-node')).not.toBeNull();
    > 171 |         expect(output.textContent).toContain(
          |                                    ^
      172 |           type === 'error'
      173 |             ? 'Process exited with code 1'
      174 |             : 'I have inspected the repository.',
      at src/lib/components/molecules/agent-card/agent-card-unified.spec.ts:171:36
      at fulfilled (../../../../../node_modules/tslib/tslib.js:167:62)
      at _ZoneDelegate.invoke (../../../../../node_modules/zone.js/bundles/zone.umd.js:405:168)
      at _ProxyZoneSpec.onInvoke (../../../../../node_modules/zone.js/bundles/zone-testing.umd.js:1080:43)
      at _ZoneDelegate.invoke (../../../../../node_modules/zone.js/bundles/zone.umd.js:405:56)
      at _ZoneImpl.run (../../../../../node_modules/zone.js/bundles/zone.umd.js:160:47)
      at ../../../../../node_modules/zone.js/bundles/zone.umd.js:2198:42
      at _ZoneDelegate.invokeTask (../../../../../node_modules/zone.js/bundles/zone.umd.js:434:181)
      at _ProxyZoneSpec.onInvokeTask (../../../../../node_modules/zone.js/bundles/zone-testing.umd.js:1111:43)
      at _ZoneDelegate.invokeTask (../../../../../node_modules/zone.js/bundles/zone.umd.js:434:64)
      at _ZoneImpl.runTask (../../../../../node_modules/zone.js/bundles/zone.umd.js:202:51)
      at drainMicroTaskQueueSynchronously (../../../../../node_modules/zone.js/bundles/zone.umd.js:620:39)
Test Suites: 1 failed, 3 passed, 4 total
Tests:       1 failed, 32 passed, 33 total
Snapshots:   0 total
Time:        25.458 s
Ran all test suites matching agent-card-unified.spec.ts|stats-accumulation.spec.ts|cli-agent-output.component.spec.ts|stats-bar.utils.spec.ts.



 NX   Running target test for project @ptah-extension/chat failed

Failed tasks:

- @ptah-extension/chat:test

Hint: run the command with --verbose for more details.

  Run duration:      27.5s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     27.4s (1 task)
  Recoverable time:  <1ms
```

This initial focused failure came from the test's requestAnimationFrame stub preventing the new streaming text from painting. The corrected test queues callbacks, asserts mounted-node and scroll retention first, then flushes those callbacks and asserts both old and new content. No assertion was removed or weakened. Both subsequent named runs and the full required run passed.

Post-edit `ptah_get_diagnostics` scoped to chat and chat-ui returned:

```text
## Diagnostics


**Source:** typescript-compiler  

**Errors:** 250 | **Warnings:** 0
```

No returned diagnostic named the revised output components, converted regression files or stats utility. This broad provider includes existing spec/dependency diagnostics; the required production typecheck targets above passed. The prior round's chat-only scope reported 248 errors; this invocation also included chat-ui.

Formatting command (exit 0):

```text
npx prettier --write libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.ts libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.spec.ts libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-unified.spec.ts libs/frontend/chat/src/lib/components/molecules/agent-card/stats-accumulation.spec.ts libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.spec.ts libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts
libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.ts 524ms
libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts 168ms
libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.spec.ts 114ms
libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-unified.spec.ts 52ms
libs/frontend/chat/src/lib/components/molecules/agent-card/stats-accumulation.spec.ts 36ms
libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.spec.ts 18ms
libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts 145ms
```

## Known gaps

- No requested defect remains open; all 12 required targets and the 10 converted regression cases pass.
- Raw stdout can duplicate structured content. It is retained and labelled intentionally rather than discarded or heuristically deduplicated.
- The cache relies on the verified store contract: content replacements produce new arrays. Same-array appends are also detected by length; unsupported same-array, same-length in-place content mutation is not detected.
- Scroll-container identity and position retention are tested in Jest's DOM environment. No live CLI or interactive browser session was run. Existing follow-output auto-scroll remains active in production.
- The broad diagnostic provider still reports unrelated spec/dependency errors noted above. No out-of-scope repair was attempted.
- The successful named Nx run printed a telemetry flush warning; its process exit code was 0 and all 10 tests passed.

