## What changed

All structured CLI lanes now use one ExecutionNode renderer. Raw stdout retains its existing parser and renderer. No git commands were run.

Paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/refactor-task-2026-526-agent-card-output-unificatio-aa0e4830b53e`.

| File | Change | Why |
| --- | --- | --- |
| `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.ts` | created | Shared rich tree, typed stats, stderr, both input shapes and auto-scroll. |
| `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.spec.ts` | created | 16 rendered regression cases covering routing, usage, stderr, fallback and streaming. |
| `libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.spec.ts` | created | Three typed aggregation and no-regex regression tests. |
| `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts` | modified | Remove the vendor switch; select the rich renderer by available structured data. |
| `libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.ts` | modified | Replace both regex extractors with typed usage aggregation. |
| `libs/shared/src/lib/types/agent-process.types.ts` | modified | Add optional readonly usage metadata to CliOutputSegment only. |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts` | modified | Attach input/output/total token usage. |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts` | modified | Attach input/output token usage. |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/copilot-sdk.adapter.ts` | modified | Attach model, tokens, cost and duration; retain zero-only usage. |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts` | modified | Attach input/output tokens and available cost. |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts` | modified | Assert output-only and total-only typed usage. |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.spec.ts` | modified | Assert the typed segment emitted for turn.completed. |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/copilot-sdk.adapter.spec.ts` | modified | Assert model/tokens/cost/duration on the emitted segment. |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.spec.ts` | modified | Assert typed tokens on step_finish. |
| `libs/frontend/chat/src/lib/components/molecules/agent-card/codex-output.component.ts` | deleted | Replaced by CliAgentOutputComponent; no remaining references. |
| `libs/frontend/chat/src/lib/components/molecules/agent-card/copilot-output.component.ts` | deleted | Replaced by CliAgentOutputComponent; no remaining references. |
| `libs/frontend/chat/src/lib/components/molecules/agent-card/ptah-cli-output.component.ts` | deleted | Replaced by CliAgentOutputComponent; no remaining references. |
| `.ptah/specs/TASK_2026_526_aa0e/implementation-report.md` | created | Implementation decisions, file inventory and verification evidence. |

## Design decisions

- **One data-driven route for every CLI.** Removed the vendor switch entirely. Any agent with segments or stream events uses `ptah-cli-agent-output`; a new CLI requires no UI branch. Evidence: `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts:93`.
- **Keep AgentCardOutputComponent strictly for the unstructured path.** When both collections are empty, the card invokes `parseAgentOutput(stdout)` and the flat renderer. The regex parser emits `heading` and `tool` types (`libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card.types.ts:23`) which are not handled by the segment tree builder's switch (`libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts:199`). Routing these values directly into that builder would lose content. Evidence for the retained route: `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts:105` and `:142`. The existing chat-ui export, chat re-export and truncation tests remain in place because the component remains used.
- **Typed usage is the only stats contract.** `CliOutputSegment.usage` has optional readonly `model`, `inputTokens`, `outputTokens`, `totalTokens`, `costUsd`, and `durationMs`. Evidence: `libs/shared/src/lib/types/agent-process.types.ts:337`. The additional total field preserves Antigravity's real total-only reports without inventing an input/output split. The header shows that total when neither split is known (`libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.ts:56`). Human-readable content formatting is retained.
- **Preserve aggregation semantics.** Sum reported token counts over turns, retain absent fields as absent, and use the latest reported model/cost/duration, including zero. This matches the former extractors' token accumulation and latest-value behavior while removing parsing and rounding through text. Evidence: `libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.ts:38`. Usage filtering also uses typed metadata, with no text or regex fallback (`:33`).
- **All actual usage emitters updated.** Antigravity (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts:1024`), Codex (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts:1116`), Copilot (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/copilot-sdk.adapter.ts:708`), and OpenCode (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:739`). The supplied claim that OpenCode has no structured output is stale: its current `handleStepFinish` already emits usage (`:722`). Raw output still has a tested fallback independent of vendor.
- **Preserve both tree inputs and scrolling.** Nonempty stream events take precedence; `streamRevision` invalidates in-place appends; otherwise the segment builder is used. Completed streams finalize orphaned tools. The original requestAnimationFrame scroll effect is retained. Evidence: `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.ts:129` and `:162`.
- **Prevent a streaming regression on newly rich lanes.** The store coalesces adjacent text into a replacement segment (`libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:814`), but the tree builder caches only by count (`libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts:139`). The component clears that agent's cache before rebuilding segment-based output (`libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.ts:135`). Event-based incremental caching remains intact. No service outside the allowed scope was changed.
- **Presentation and safety.** Angular 22.1.7 from `package.json`; standalone, OnPush, signal inputs/computed state and inject follow the three replaced components. Existing Tailwind/daisyui classes are reused. Stderr markup is copied from the flat renderer and uses escaped interpolation (`libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.ts:82`). Existing ExecutionNode rendering is reused; no new HTML binding or sanitizer is introduced. Imports respect the shared/webview boundaries in `eslint.config.mjs:256`.
- **Available instructions.** Root `CLAUDE.md` and the assigned task documents were absent. Read `CONTRIBUTING.md`, `CONVENTIONS.md`, root README and the chat README, and followed the explicit task specification. No task carrier or state was edited.

## Verification

All commands ran from the requested worktree. The final required test, lint and typecheck runs exited 0. Nx suppresses successful per-project logs by default; the output below is the actual returned output, not reconstructed test counts.

`npx nx run-many -t test -p chat,chat-ui,shared,cli-agent-runtime --skip-nx-cache` — exit 0.

```text
NX   Running target test for 4 projects:

- @ptah-extension/chat
- @ptah-extension/chat-ui
- @ptah-extension/shared
- @ptah-extension/cli-agent-runtime


√  nx run @ptah-extension/chat-ui:test
√  nx run @ptah-extension/shared:test
√  nx run @ptah-extension/chat:test
√  nx run @ptah-extension/cli-agent-runtime:test



 NX   Successfully ran target test for 4 projects


Output of 4 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

  Run duration:      1m 46s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     1m 26s (1 task)
  Recoverable time:  19.7s (19% of the run)

  Recommendations:
    - Cache: drop --skip-nx-cache to restore unchanged tasks instantly.
    - Speed up or split the longest tasks on the critical path:
        @ptah-extension/cli-agent-runtime:test    1m 26s
```

`npx nx run-many -t lint -p chat,chat-ui,shared,cli-agent-runtime` — exit 0.

```text
NX   Running target lint for 4 projects:

- @ptah-extension/chat
- @ptah-extension/chat-ui
- @ptah-extension/shared
- @ptah-extension/cli-agent-runtime


√  nx run @ptah-extension/chat-ui:lint
√  nx run @ptah-extension/shared:lint
√  nx run @ptah-extension/cli-agent-runtime:lint
√  nx run @ptah-extension/chat:lint



 NX   Successfully ran target lint for 4 projects


Output of 4 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

  Run duration:      57.6s
  Cache:             0/4 hit (0%)
  Critical path:     39.1s (1 task)
  Recoverable time:  18.4s (32% of the run)

  Recommendations:
    - Increase parallelism to recover up to 18.4s → https://nx.dev/docs/concepts/ci-concepts/parallelization-distribution?utm_source=nx-cli&utm_medium=cli&utm_campaign=performance-report&utm_content=parallelization.
    - Drastically reduce your run duration by sharing a cache across your team and CI → https://cloud.nx.app/connect/DLTY5YYo9l.
```

`npx nx run-many -t typecheck -p chat,chat-ui,shared,cli-agent-runtime` — exit 0.

```text
NX   Running target typecheck for 4 projects:

- @ptah-extension/chat
- @ptah-extension/chat-ui
- @ptah-extension/shared
- @ptah-extension/cli-agent-runtime


√  nx run @ptah-extension/shared:typecheck
√  nx run @ptah-extension/chat-ui:typecheck
√  nx run @ptah-extension/cli-agent-runtime:typecheck
√  nx run @ptah-extension/chat:typecheck



 NX   Successfully ran target typecheck for 4 projects


Output of 4 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

  Run duration:      29.9s
  Cache:             0/4 hit (0%)
  Critical path:     15.7s (1 task)
  Recoverable time:  14.1s (47% of the run)
```

The typecheck targets execute Angular `ngc --noEmit` for chat/chat-ui and TypeScript `tsc --noEmit` for shared/cli-agent-runtime (their respective `project.json` files). The final typecheck includes the cache invalidation change.

Focused rendered-component verification before the additional coalesced-text case:

`npx nx test chat --skip-nx-cache --testPathPatterns=cli-agent-output.component.spec.ts --runInBand` — exit 0.

```text
> nx run @ptah-extension/chat:test --testPathPatterns=cli-agent-output.component.spec.ts --runInBand

The `@nx/jest:jest` executor is deprecated and will be removed in Nx v24. Run `nx g @nx/jest:convert-to-inferred` to migrate to the `@nx/jest/plugin` inferred targets. See https://nx.dev/docs/guides/tasks--caching/convert-to-inferred for details.
Test Suites: 1 passed, 1 total
Tests:       15 passed, 15 total
Snapshots:   0 total
Time:        4.158 s
Ran all test suites matching cli-agent-output.component.spec.ts.



 NX   Successfully ran target test for project @ptah-extension/chat


  Run duration:      5.0s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     4.9s (1 task)
  Recoverable time:  <1ms
```

Post-edit `ptah_get_diagnostics` returned the same 248 errors and zero warnings as the pre-edit chat diagnostic baseline. None named the new component, stats utility or changed adapters. This broad provider includes existing spec/dependency errors; it is not the successful production typecheck target above.

A final source search found no references to the three deleted components/selectors or either removed vendor extractor.

Earlier verification attempts failed while implementation was in progress. These are resolved by the final runs above. The test run preceded the updated Antigravity assertions and the cost interpolation fix; the first typecheck exposed nullable accumulator narrowing, fixed by initializing the accumulator to an empty typed object.

<details>
<summary>Initial required test command — exit 1</summary>

```text
NX   Running target test for 4 projects:

- @ptah-extension/chat
- @ptah-extension/chat-ui
- @ptah-extension/shared
- @ptah-extension/cli-agent-runtime


√  nx run @ptah-extension/shared:test
√  nx run @ptah-extension/chat-ui:test

> nx run @ptah-extension/cli-agent-runtime:test

The `@nx/jest:jest` executor is deprecated and will be removed in Nx v24. Run `nx g @nx/jest:convert-to-inferred` to migrate to the `@nx/jest/plugin` inferred targets. See https://nx.dev/docs/guides/tasks--caching/convert-to-inferred for details.
(node:35284) Warning: Failed to load the ES module: D:\projects\ptah-extension\.claude-worktrees\refactor-task-2026-526-agent-card-output-unificatio-aa0e4830b53e\libs\backend\cli-agent-runtime\jest.config.ts. Make sure to set "type": "module" in the nearest package.json file or use the .mjs extension.
(Use `node --trace-warnings ...` to show where the warning was created)
FAIL cli-agent-runtime libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts (34.515 s)
  ● AntigravityCliAdapter › runSdk() — stream-json → segment parsing › ignores structural steps but reports per-turn agent_response usage

    expect(received).toEqual(expected) // deep equality

    - Expected  - 0
    + Received  + 5

      Array [
        Object {
          "content": "Usage: 168 output tokens",
          "type": "info",
    +     "usage": Object {
    +       "inputTokens": undefined,
    +       "outputTokens": 168,
    +       "totalTokens": undefined,
    +     },
        },
      ]

      746 |       await handle.done;
      747 |
    > 748 |       expect(segments).toEqual([
          |                        ^
      749 |         { type: 'info', content: 'Usage: 168 output tokens' },
      750 |       ]);
      751 |     });

      at Object.<anonymous> (src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts:748:24)

  ● AntigravityCliAdapter › runSdk() — stream-json → segment parsing › reports total usage without inventing zero input or output tokens

    expect(received).toEqual(expected) // deep equality

    - Expected  - 0
    + Received  + 5

      Array [
        Object {
          "content": "Usage: 11867 total tokens",
          "type": "info",
    +     "usage": Object {
    +       "inputTokens": undefined,
    +       "outputTokens": undefined,
    +       "totalTokens": 11867,
    +     },
        },
      ]

      766 |       await handle.done;
      767 |
    > 768 |       expect(segments).toEqual([
          |                        ^
      769 |         { type: 'info', content: 'Usage: 11867 total tokens' },
      770 |       ]);
      771 |     });

      at Object.<anonymous> (src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts:768:24)

A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them.

Summary of all failing tests
FAIL src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts (34.515 s)
  ● AntigravityCliAdapter › runSdk() — stream-json → segment parsing › ignores structural steps but reports per-turn agent_response usage

    expect(received).toEqual(expected) // deep equality

    - Expected  - 0
    + Received  + 5

      Array [
        Object {
          "content": "Usage: 168 output tokens",
          "type": "info",
    +     "usage": Object {
    +       "inputTokens": undefined,
    +       "outputTokens": 168,
    +       "totalTokens": undefined,
    +     },
        },
      ]

      746 |       await handle.done;
      747 |
    > 748 |       expect(segments).toEqual([
          |                        ^
      749 |         { type: 'info', content: 'Usage: 168 output tokens' },
      750 |       ]);
      751 |     });

      at Object.<anonymous> (src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts:748:24)

  ● AntigravityCliAdapter › runSdk() — stream-json → segment parsing › reports total usage without inventing zero input or output tokens

    expect(received).toEqual(expected) // deep equality

    - Expected  - 0
    + Received  + 5

      Array [
        Object {
          "content": "Usage: 11867 total tokens",
          "type": "info",
    +     "usage": Object {
    +       "inputTokens": undefined,
    +       "outputTokens": undefined,
    +       "totalTokens": 11867,
    +     },
        },
      ]

      766 |       await handle.done;
      767 |
    > 768 |       expect(segments).toEqual([
          |                        ^
      769 |         { type: 'info', content: 'Usage: 11867 total tokens' },
      770 |       ]);
      771 |     });

      at Object.<anonymous> (src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts:768:24)


Test Suites: 1 failed, 62 passed, 63 total
Tests:       2 failed, 1 skipped, 996 passed, 999 total
Snapshots:   0 total
Time:        71.84 s
Ran all test suites.

> nx run @ptah-extension/chat:test

The `@nx/jest:jest` executor is deprecated and will be removed in Nx v24. Run `nx g @nx/jest:convert-to-inferred` to migrate to the `@nx/jest/plugin` inferred targets. See https://nx.dev/docs/guides/tasks--caching/convert-to-inferred for details.
FAIL chat libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts
  ● Test suite failed to run

    Jest encountered an unexpected token

    Jest failed to parse a file. This happens e.g. when your code or its dependencies use non-standard JavaScript syntax, or when Jest is not configured to support such syntax.

    Out of the box Jest supports Babel, which will be used to transform your files into valid JS based on your Babel configuration.

    By default "node_modules" folder is ignored by transformers.

    Here's what you can do:
     • If you are trying to use TypeScript, see https://jestjs.io/docs/getting-started#using-typescript
     • To have some of your "node_modules" files transformed, you can specify a custom "transformIgnorePatterns" in your config.
     • If you need a custom transformation, specify a "transform" option in your config.
     • If you simply want to mock your non-JS modules (e.g. binary assets) you can stub them out with the "moduleNameMapper" config option.

    You'll find more details and examples of these config options in the docs:
    https://jestjs.io/docs/configuration
    For information about custom transformations, see:
    https://jestjs.io/docs/code-transformation

    Details:

    D:\projects\ptah-extension\.claude-worktrees\refactor-task-2026-526-agent-card-output-unificatio-aa0e4830b53e\libs\frontend\chat\src\lib\components\molecules\agent-card\cli-agent-output.component.ts:109
                  ${{ stats, : .costUsd.toFixed(4) }}
                             ^

    SyntaxError: Unexpected token ':'

      21 |   type MonitoredAgent,
      22 | } from '@ptah-extension/chat-streaming';
    > 23 | import { CliAgentOutputComponent } from './cli-agent-output.component';
         | ^
      24 | import { AgentCardHeaderComponent } from './agent-card-header.component';
      25 | import { AgentCardOutputComponent } from '@ptah-extension/chat-ui';
      26 | import {

      at ModuleExecutor.compile (../../../../../node_modules/jest-runtime/build/index.js:3081:44)
      at Object.<anonymous> (src/lib/components/molecules/agent-card/agent-card.component.ts:23:1)
      at Object.<anonymous> (src/lib/components/organisms/agent-monitor-panel.component.ts:60:1)
      at Object.<anonymous> (src/lib/components/templates/chat-view.component.ts:24:1)
      at Object.<anonymous> (src/lib/components/templates/chat-view.component.spec.ts:63:1)

FAIL chat libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.spec.ts
  ● Test suite failed to run

    Jest encountered an unexpected token

    Jest failed to parse a file. This happens e.g. when your code or its dependencies use non-standard JavaScript syntax, or when Jest is not configured to support such syntax.

    Out of the box Jest supports Babel, which will be used to transform your files into valid JS based on your Babel configuration.

    By default "node_modules" folder is ignored by transformers.

    Here's what you can do:
     • If you are trying to use TypeScript, see https://jestjs.io/docs/getting-started#using-typescript
     • To have some of your "node_modules" files transformed, you can specify a custom "transformIgnorePatterns" in your config.
     • If you need a custom transformation, specify a "transform" option in your config.
     • If you simply want to mock your non-JS modules (e.g. binary assets) you can stub them out with the "moduleNameMapper" config option.

    You'll find more details and examples of these config options in the docs:
    https://jestjs.io/docs/configuration
    For information about custom transformations, see:
    https://jestjs.io/docs/code-transformation

    Details:

    D:\projects\ptah-extension\.claude-worktrees\refactor-task-2026-526-agent-card-output-unificatio-aa0e4830b53e\libs\frontend\chat\src\lib\components\molecules\agent-card\cli-agent-output.component.ts:109
                  ${{ stats, : .costUsd.toFixed(4) }}
                             ^

    SyntaxError: Unexpected token ':'

      21 |   type MonitoredAgent,
      22 | } from '@ptah-extension/chat-streaming';
    > 23 | import { CliAgentOutputComponent } from './cli-agent-output.component';
         | ^
      24 | import { AgentCardHeaderComponent } from './agent-card-header.component';
      25 | import { AgentCardOutputComponent } from '@ptah-extension/chat-ui';
      26 | import {

      at ModuleExecutor.compile (../../../../../node_modules/jest-runtime/build/index.js:3081:44)
      at Object.<anonymous> (src/lib/components/molecules/agent-card/agent-card.component.ts:23:1)
      at Object.<anonymous> (src/lib/components/organisms/agent-monitor-panel.component.ts:60:1)
      at Object.<anonymous> (src/lib/components/organisms/agent-monitor-panel.component.spec.ts:21:1)

FAIL chat libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.scope.spec.ts
  ● Test suite failed to run

    Jest encountered an unexpected token

    Jest failed to parse a file. This happens e.g. when your code or its dependencies use non-standard JavaScript syntax, or when Jest is not configured to support such syntax.

    Out of the box Jest supports Babel, which will be used to transform your files into valid JS based on your Babel configuration.

    By default "node_modules" folder is ignored by transformers.

    Here's what you can do:
     • If you are trying to use TypeScript, see https://jestjs.io/docs/getting-started#using-typescript
     • To have some of your "node_modules" files transformed, you can specify a custom "transformIgnorePatterns" in your config.
     • If you need a custom transformation, specify a "transform" option in your config.
     • If you simply want to mock your non-JS modules (e.g. binary assets) you can stub them out with the "moduleNameMapper" config option.

    You'll find more details and examples of these config options in the docs:
    https://jestjs.io/docs/configuration
    For information about custom transformations, see:
    https://jestjs.io/docs/code-transformation

    Details:

    D:\projects\ptah-extension\.claude-worktrees\refactor-task-2026-526-agent-card-output-unificatio-aa0e4830b53e\libs\frontend\chat\src\lib\components\molecules\agent-card\cli-agent-output.component.ts:109
                  ${{ stats, : .costUsd.toFixed(4) }}
                             ^

    SyntaxError: Unexpected token ':'

      21 |   type MonitoredAgent,
      22 | } from '@ptah-extension/chat-streaming';
    > 23 | import { CliAgentOutputComponent } from './cli-agent-output.component';
         | ^
      24 | import { AgentCardHeaderComponent } from './agent-card-header.component';
      25 | import { AgentCardOutputComponent } from '@ptah-extension/chat-ui';
      26 | import {

      at ModuleExecutor.compile (../../../../../node_modules/jest-runtime/build/index.js:3081:44)
      at Object.<anonymous> (src/lib/components/molecules/agent-card/agent-card.component.ts:23:1)
      at Object.<anonymous> (src/lib/components/organisms/agent-monitor-panel.component.ts:60:1)
      at Object.<anonymous> (src/lib/components/organisms/agent-monitor-panel.scope.spec.ts:18:1)

FAIL chat libs/frontend/chat/src/lib/components/templates/electron-shell.activity-placement.spec.ts
  ● Test suite failed to run

    Jest encountered an unexpected token

    Jest failed to parse a file. This happens e.g. when your code or its dependencies use non-standard JavaScript syntax, or when Jest is not configured to support such syntax.

    Out of the box Jest supports Babel, which will be used to transform your files into valid JS based on your Babel configuration.

    By default "node_modules" folder is ignored by transformers.

    Here's what you can do:
     • If you are trying to use TypeScript, see https://jestjs.io/docs/getting-started#using-typescript
     • To have some of your "node_modules" files transformed, you can specify a custom "transformIgnorePatterns" in your config.
     • If you need a custom transformation, specify a "transform" option in your config.
     • If you simply want to mock your non-JS modules (e.g. binary assets) you can stub them out with the "moduleNameMapper" config option.

    You'll find more details and examples of these config options in the docs:
    https://jestjs.io/docs/configuration
    For information about custom transformations, see:
    https://jestjs.io/docs/code-transformation

    Details:

    D:\projects\ptah-extension\.claude-worktrees\refactor-task-2026-526-agent-card-output-unificatio-aa0e4830b53e\libs\frontend\chat\src\lib\components\molecules\agent-card\cli-agent-output.component.ts:109
                  ${{ stats, : .costUsd.toFixed(4) }}
                             ^

    SyntaxError: Unexpected token ':'

      21 |   type MonitoredAgent,
      22 | } from '@ptah-extension/chat-streaming';
    > 23 | import { CliAgentOutputComponent } from './cli-agent-output.component';
         | ^
      24 | import { AgentCardHeaderComponent } from './agent-card-header.component';
      25 | import { AgentCardOutputComponent } from '@ptah-extension/chat-ui';
      26 | import {

      at ModuleExecutor.compile (../../../../../node_modules/jest-runtime/build/index.js:3081:44)
      at Object.<anonymous> (src/lib/components/molecules/agent-card/agent-card.component.ts:23:1)
      at Object.<anonymous> (src/lib/components/organisms/agent-monitor-panel.component.ts:60:1)
      at Object.<anonymous> (src/lib/components/templates/chat-view.component.ts:24:1)
      at Object.<anonymous> (src/lib/components/templates/app-shell.component.ts:33:1)
      at Object.<anonymous> (src/lib/components/templates/electron-shell.component.ts:49:1)
      at Object.<anonymous> (src/lib/components/templates/electron-shell.activity-placement.spec.ts:67:1)

A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them.

Summary of all failing tests
FAIL src/lib/components/templates/chat-view.component.spec.ts
  ● Test suite failed to run

    Jest encountered an unexpected token

    Jest failed to parse a file. This happens e.g. when your code or its dependencies use non-standard JavaScript syntax, or when Jest is not configured to support such syntax.

    Out of the box Jest supports Babel, which will be used to transform your files into valid JS based on your Babel configuration.

    By default "node_modules" folder is ignored by transformers.

    Here's what you can do:
     • If you are trying to use TypeScript, see https://jestjs.io/docs/getting-started#using-typescript
     • To have some of your "node_modules" files transformed, you can specify a custom "transformIgnorePatterns" in your config.
     • If you need a custom transformation, specify a "transform" option in your config.
     • If you simply want to mock your non-JS modules (e.g. binary assets) you can stub them out with the "moduleNameMapper" config option.

    You'll find more details and examples of these config options in the docs:
    https://jestjs.io/docs/configuration
    For information about custom transformations, see:
    https://jestjs.io/docs/code-transformation

    Details:

    D:\projects\ptah-extension\.claude-worktrees\refactor-task-2026-526-agent-card-output-unificatio-aa0e4830b53e\libs\frontend\chat\src\lib\components\molecules\agent-card\cli-agent-output.component.ts:109
                  ${{ stats, : .costUsd.toFixed(4) }}
                             ^

    SyntaxError: Unexpected token ':'

      21 |   type MonitoredAgent,
      22 | } from '@ptah-extension/chat-streaming';
    > 23 | import { CliAgentOutputComponent } from './cli-agent-output.component';
         | ^
      24 | import { AgentCardHeaderComponent } from './agent-card-header.component';
      25 | import { AgentCardOutputComponent } from '@ptah-extension/chat-ui';
      26 | import {

      at ModuleExecutor.compile (../../../../../node_modules/jest-runtime/build/index.js:3081:44)
      at Object.<anonymous> (src/lib/components/molecules/agent-card/agent-card.component.ts:23:1)
      at Object.<anonymous> (src/lib/components/organisms/agent-monitor-panel.component.ts:60:1)
      at Object.<anonymous> (src/lib/components/templates/chat-view.component.ts:24:1)
      at Object.<anonymous> (src/lib/components/templates/chat-view.component.spec.ts:63:1)

FAIL src/lib/components/organisms/agent-monitor-panel.component.spec.ts
  ● Test suite failed to run

    Jest encountered an unexpected token

    Jest failed to parse a file. This happens e.g. when your code or its dependencies use non-standard JavaScript syntax, or when Jest is not configured to support such syntax.

    Out of the box Jest supports Babel, which will be used to transform your files into valid JS based on your Babel configuration.

    By default "node_modules" folder is ignored by transformers.

    Here's what you can do:
     • If you are trying to use TypeScript, see https://jestjs.io/docs/getting-started#using-typescript
     • To have some of your "node_modules" files transformed, you can specify a custom "transformIgnorePatterns" in your config.
     • If you need a custom transformation, specify a "transform" option in your config.
     • If you simply want to mock your non-JS modules (e.g. binary assets) you can stub them out with the "moduleNameMapper" config option.

    You'll find more details and examples of these config options in the docs:
    https://jestjs.io/docs/configuration
    For information about custom transformations, see:
    https://jestjs.io/docs/code-transformation

    Details:

    D:\projects\ptah-extension\.claude-worktrees\refactor-task-2026-526-agent-card-output-unificatio-aa0e4830b53e\libs\frontend\chat\src\lib\components\molecules\agent-card\cli-agent-output.component.ts:109
                  ${{ stats, : .costUsd.toFixed(4) }}
                             ^

    SyntaxError: Unexpected token ':'

      21 |   type MonitoredAgent,
      22 | } from '@ptah-extension/chat-streaming';
    > 23 | import { CliAgentOutputComponent } from './cli-agent-output.component';
         | ^
      24 | import { AgentCardHeaderComponent } from './agent-card-header.component';
      25 | import { AgentCardOutputComponent } from '@ptah-extension/chat-ui';
      26 | import {

      at ModuleExecutor.compile (../../../../../node_modules/jest-runtime/build/index.js:3081:44)
      at Object.<anonymous> (src/lib/components/molecules/agent-card/agent-card.component.ts:23:1)
      at Object.<anonymous> (src/lib/components/organisms/agent-monitor-panel.component.ts:60:1)
      at Object.<anonymous> (src/lib/components/organisms/agent-monitor-panel.component.spec.ts:21:1)

FAIL src/lib/components/organisms/agent-monitor-panel.scope.spec.ts
  ● Test suite failed to run

    Jest encountered an unexpected token

    Jest failed to parse a file. This happens e.g. when your code or its dependencies use non-standard JavaScript syntax, or when Jest is not configured to support such syntax.

    Out of the box Jest supports Babel, which will be used to transform your files into valid JS based on your Babel configuration.

    By default "node_modules" folder is ignored by transformers.

    Here's what you can do:
     • If you are trying to use TypeScript, see https://jestjs.io/docs/getting-started#using-typescript
     • To have some of your "node_modules" files transformed, you can specify a custom "transformIgnorePatterns" in your config.
     • If you need a custom transformation, specify a "transform" option in your config.
     • If you simply want to mock your non-JS modules (e.g. binary assets) you can stub them out with the "moduleNameMapper" config option.

    You'll find more details and examples of these config options in the docs:
    https://jestjs.io/docs/configuration
    For information about custom transformations, see:
    https://jestjs.io/docs/code-transformation

    Details:

    D:\projects\ptah-extension\.claude-worktrees\refactor-task-2026-526-agent-card-output-unificatio-aa0e4830b53e\libs\frontend\chat\src\lib\components\molecules\agent-card\cli-agent-output.component.ts:109
                  ${{ stats, : .costUsd.toFixed(4) }}
                             ^

    SyntaxError: Unexpected token ':'

      21 |   type MonitoredAgent,
      22 | } from '@ptah-extension/chat-streaming';
    > 23 | import { CliAgentOutputComponent } from './cli-agent-output.component';
         | ^
      24 | import { AgentCardHeaderComponent } from './agent-card-header.component';
      25 | import { AgentCardOutputComponent } from '@ptah-extension/chat-ui';
      26 | import {

      at ModuleExecutor.compile (../../../../../node_modules/jest-runtime/build/index.js:3081:44)
      at Object.<anonymous> (src/lib/components/molecules/agent-card/agent-card.component.ts:23:1)
      at Object.<anonymous> (src/lib/components/organisms/agent-monitor-panel.component.ts:60:1)
      at Object.<anonymous> (src/lib/components/organisms/agent-monitor-panel.scope.spec.ts:18:1)

FAIL src/lib/components/templates/electron-shell.activity-placement.spec.ts
  ● Test suite failed to run

    Jest encountered an unexpected token

    Jest failed to parse a file. This happens e.g. when your code or its dependencies use non-standard JavaScript syntax, or when Jest is not configured to support such syntax.

    Out of the box Jest supports Babel, which will be used to transform your files into valid JS based on your Babel configuration.

    By default "node_modules" folder is ignored by transformers.

    Here's what you can do:
     • If you are trying to use TypeScript, see https://jestjs.io/docs/getting-started#using-typescript
     • To have some of your "node_modules" files transformed, you can specify a custom "transformIgnorePatterns" in your config.
     • If you need a custom transformation, specify a "transform" option in your config.
     • If you simply want to mock your non-JS modules (e.g. binary assets) you can stub them out with the "moduleNameMapper" config option.

    You'll find more details and examples of these config options in the docs:
    https://jestjs.io/docs/configuration
    For information about custom transformations, see:
    https://jestjs.io/docs/code-transformation

    Details:

    D:\projects\ptah-extension\.claude-worktrees\refactor-task-2026-526-agent-card-output-unificatio-aa0e4830b53e\libs\frontend\chat\src\lib\components\molecules\agent-card\cli-agent-output.component.ts:109
                  ${{ stats, : .costUsd.toFixed(4) }}
                             ^

    SyntaxError: Unexpected token ':'

      21 |   type MonitoredAgent,
      22 | } from '@ptah-extension/chat-streaming';
    > 23 | import { CliAgentOutputComponent } from './cli-agent-output.component';
         | ^
      24 | import { AgentCardHeaderComponent } from './agent-card-header.component';
      25 | import { AgentCardOutputComponent } from '@ptah-extension/chat-ui';
      26 | import {

      at ModuleExecutor.compile (../../../../../node_modules/jest-runtime/build/index.js:3081:44)
      at Object.<anonymous> (src/lib/components/molecules/agent-card/agent-card.component.ts:23:1)
      at Object.<anonymous> (src/lib/components/organisms/agent-monitor-panel.component.ts:60:1)
      at Object.<anonymous> (src/lib/components/templates/chat-view.component.ts:24:1)
      at Object.<anonymous> (src/lib/components/templates/app-shell.component.ts:33:1)
      at Object.<anonymous> (src/lib/components/templates/electron-shell.component.ts:49:1)
      at Object.<anonymous> (src/lib/components/templates/electron-shell.activity-placement.spec.ts:67:1)


Test Suites: 4 failed, 82 passed, 86 total
Tests:       2 skipped, 1261 passed, 1263 total
Snapshots:   0 total
Time:        75.246 s
Ran all test suites.



 NX   Running target test for 4 projects failed

Failed tasks:

- @ptah-extension/cli-agent-runtime:test
- @ptah-extension/chat:test

Output of 2 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

  Run duration:      1m 53s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     1m 20s (1 task)
  Recoverable time:  33.0s (29% of the run)

  Recommendations:
    - Increase parallelism to recover up to 33.0s → https://nx.dev/docs/concepts/ci-concepts/parallelization-distribution?utm_source=nx-cli&utm_medium=cli&utm_campaign=performance-report&utm_content=parallelization.
    - Cache: drop --skip-nx-cache to restore unchanged tasks instantly.
```

</details>

<details>
<summary>Initial required lint command — exit 1</summary>

```text
√  nx run @ptah-extension/chat-ui:lint
√  nx run @ptah-extension/shared:lint
√  nx run @ptah-extension/cli-agent-runtime:lint

> nx run @ptah-extension/chat:lint

The `@nx/eslint:lint` executor is deprecated and will be removed in Nx v24. Run `nx g @nx/eslint:convert-to-inferred` to migrate to the `@nx/eslint/plugin` inferred targets. See https://nx.dev/docs/guides/tasks--caching/convert-to-inferred for details.

Linting "@ptah-extension/chat"...

D:\projects\ptah-extension\.claude-worktrees\refactor-task-2026-526-agent-card-output-unificatio-aa0e4830b53e\libs\frontend\chat\src\lib\components\molecules\agent-card\cli-agent-output.component.ts
  59:23  error  Parsing error: ',' expected

D:\projects\ptah-extension\.claude-worktrees\refactor-task-2026-526-agent-card-output-unificatio-aa0e4830b53e\libs\frontend\chat\src\lib\components\molecules\chat-input\chat-input.component.ts
  911:1  warning  File has too many lines (1063). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\refactor-task-2026-526-agent-card-output-unificatio-aa0e4830b53e\libs\frontend\chat\src\lib\components\organisms\execution\inline-agent-bubble.component.ts
   807:1   warning  File has too many lines (928). Maximum allowed is 700              max-lines
   932:37  warning  Forbidden non-null assertion                                       @typescript-eslint/no-non-null-assertion
  1081:9   warning  The value assigned to 'sent' is not used in subsequent statements  no-useless-assignment

D:\projects\ptah-extension\.claude-worktrees\refactor-task-2026-526-agent-card-output-unificatio-aa0e4830b53e\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts
   73:35  warning  'SessionId' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  380:22  warning  Unexpected empty arrow function                                              @typescript-eslint/no-empty-function

D:\projects\ptah-extension\.claude-worktrees\refactor-task-2026-526-agent-card-output-unificatio-aa0e4830b53e\libs\frontend\chat\src\lib\components\templates\chat-view.component.spec.ts
  1302:5  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\.claude-worktrees\refactor-task-2026-526-agent-card-output-unificatio-aa0e4830b53e\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts
  1109:1  warning  File has too many lines (1006). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\refactor-task-2026-526-agent-card-output-unificatio-aa0e4830b53e\libs\frontend\chat\src\lib\components\templates\chat-view.keepalive.spec.ts
  202:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  214:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  215:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  223:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\.claude-worktrees\refactor-task-2026-526-agent-card-output-unificatio-aa0e4830b53e\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts
   995:1   warning  File has too many lines (977). Maximum allowed is 700  max-lines
  1356:43  warning  Unexpected empty async method 'createNewSession'       @typescript-eslint/no-empty-function

D:\projects\ptah-extension\.claude-worktrees\refactor-task-2026-526-agent-card-output-unificatio-aa0e4830b53e\libs\frontend\chat\src\lib\settings\ptah-ai\agent-orchestration-config.component.ts
  739:1  warning  File has too many lines (990). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\refactor-task-2026-526-agent-card-output-unificatio-aa0e4830b53e\libs\frontend\chat\src\lib\settings\ptah-ai\ptah-cli-config.component.ts
   787:49  warning  Unexpected empty arrow function                         @typescript-eslint/no-empty-function
   789:1   warning  File has too many lines (1034). Maximum allowed is 700  max-lines
  1014:49  warning  Unexpected empty arrow function                         @typescript-eslint/no-empty-function

✖ 19 problems (1 error, 18 warnings)

✖ 19 problems (1 error, 18 warnings)




 NX   Running target lint for 4 projects failed

Failed tasks:

- @ptah-extension/chat:lint

Output of 3 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

  Run duration:      45.0s
  Cache:             0/3 hit (0%)
  Critical path:     29.5s (1 task)
  Recoverable time:  15.4s (34% of the run)

  Recommendations:
    - Increase parallelism to recover up to 15.4s → https://nx.dev/docs/concepts/ci-concepts/parallelization-distribution?utm_source=nx-cli&utm_medium=cli&utm_campaign=performance-report&utm_content=parallelization.
    - Drastically reduce your run duration by sharing a cache across your team and CI → https://cloud.nx.app/connect/L3gnXkMUVO.
```

</details>

<details>
<summary>Initial required typecheck command — exit 1</summary>

```text
NX   Running target typecheck for 4 projects:

- @ptah-extension/chat
- @ptah-extension/chat-ui
- @ptah-extension/shared
- @ptah-extension/cli-agent-runtime


√  nx run @ptah-extension/shared:typecheck
√  nx run @ptah-extension/chat-ui:typecheck
√  nx run @ptah-extension/cli-agent-runtime:typecheck

> nx run @ptah-extension/chat:typecheck

> npx ngc --noEmit --project libs/frontend/chat/tsconfig.lib.json

src/lib/components/molecules/agent-card/stats-bar.utils.ts:45:36 - error TS2339: Property 'model' does not exist on type 'never'.

45       model: usage.model ?? stats?.model,
                                      ~~~~~
src/lib/components/molecules/agent-card/stats-bar.utils.ts:47:18 - error TS2339: Property 'inputTokens' does not exist on type 'never'.

47         ? stats?.inputTokens
                    ~~~~~~~~~~~
src/lib/components/molecules/agent-card/stats-bar.utils.ts:48:19 - error TS2339: Property 'inputTokens' does not exist on type 'never'.

48         : (stats?.inputTokens ?? 0) + usage.inputTokens,
                     ~~~~~~~~~~~
src/lib/components/molecules/agent-card/stats-bar.utils.ts:50:18 - error TS2339: Property 'outputTokens' does not exist on type 'never'.

50         ? stats?.outputTokens
                    ~~~~~~~~~~~~
src/lib/components/molecules/agent-card/stats-bar.utils.ts:51:19 - error TS2339: Property 'outputTokens' does not exist on type 'never'.

51         : (stats?.outputTokens ?? 0) + usage.outputTokens,
                     ~~~~~~~~~~~~
src/lib/components/molecules/agent-card/stats-bar.utils.ts:53:18 - error TS2339: Property 'totalTokens' does not exist on type 'never'.

53         ? stats?.totalTokens
                    ~~~~~~~~~~~
src/lib/components/molecules/agent-card/stats-bar.utils.ts:54:19 - error TS2339: Property 'totalTokens' does not exist on type 'never'.

54         : (stats?.totalTokens ?? 0) + usage.totalTokens,
                     ~~~~~~~~~~~
src/lib/components/molecules/agent-card/stats-bar.utils.ts:55:40 - error TS2339: Property 'costUsd' does not exist on type 'never'.

55       costUsd: usage.costUsd ?? stats?.costUsd,
                                          ~~~~~~~
src/lib/components/molecules/agent-card/stats-bar.utils.ts:56:46 - error TS2339: Property 'durationMs' does not exist on type 'never'.

56       durationMs: usage.durationMs ?? stats?.durationMs,
                                                ~~~~~~~~~~

Warning: command "npx ngc --noEmit --project libs/frontend/chat/tsconfig.lib.json" exited with non-zero status code


 NX   Running target typecheck for 4 projects failed

Failed tasks:

- @ptah-extension/chat:typecheck

Output of 3 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

  Run duration:      1m 3s
  Cache:             0/3 hit (0%)
  Critical path:     43.8s (1 task)
  Recoverable time:  19.2s (30% of the run)

  Recommendations:
    - Increase parallelism to recover up to 19.2s → https://nx.dev/docs/concepts/ci-concepts/parallelization-distribution?utm_source=nx-cli&utm_medium=cli&utm_campaign=performance-report&utm_content=parallelization.
    - Drastically reduce your run duration by sharing a cache across your team and CI → https://cloud.nx.app/connect/wX1EnCBM6v.
```

</details>

An initial focused component run also failed because the test asserted markdown text before its asynchronous render completed. The test now waits for fixture stability. Failure excerpt, verbatim:

```text
  ● unified CLI agent output › keeps no-segment raw stdout and stderr visible through the fallback renderer
    expect(received).toContain(expected) // indexOf
    Expected substring: "Raw stdout response"
    Received string:    " opencode  running  497241h 47m Task Inspect files Tool:read_file{\"path\":\"a.ts\"}Error: raw failure"
Test Suites: 1 failed, 1 total
Tests:       1 failed, 14 passed, 15 total
```

## Tests added

| Test / updated assertion | What it proves | Location |
| --- | --- | --- |
| Rich tool rendering, parameterized for Antigravity, Cursor, Pi, Codex, Copilot, Ptah CLI and OpenCode | Real ExecutionNode component receives a paired tool/result; no flat renderer is mounted | `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.spec.ts:61` |
| Adapter usage contract, parameterized for Codex, Copilot and Antigravity | Typed adapter-shaped segments reach the rendered stats bar, usage captions never enter the tree; paired backend tests below verify producers emit these shapes | `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.spec.ts:110` |
| Informational/error stderr | Both blocks remain visible with existing severity styling and escaped script-like content | `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.spec.ts:159` |
| No-segment raw stdout | Existing fallback still renders stdout, parsed tool names and stderr | `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.spec.ts:176` |
| Stream events and revision | Events take precedence; appending to the same array with a revision bump updates the tree | `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.spec.ts:197` |
| Coalesced text | Same-count segment updates do not return stale cached text | `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.spec.ts:241` |
| Orphan finalization | Unfinished tool stays streaming until the lane stops, then becomes error | `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.spec.ts:258` |
| Total-only and zero values | Total-only reporting does not fabricate a split; zero cost and duration remain visible | `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.spec.ts:274` |
| Multi-turn accumulation | Sum tokens, keep latest model/cost/duration, preserve explicit zero | `libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.spec.ts:4` |
| No free-text contract | Readable Usage text alone is not parsed or filtered; typed localized content is recognized | `libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.spec.ts:40` |
| Missing fields and total-only accumulation | No invented counts; empty usage produces no stats | `libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.spec.ts:56` |
| Antigravity producer assertions (updated) | Output-only and total-only typed usage emitted without fabricated zero counts | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts:710`, `:757` |
| Codex producer assertion (updated) | turn.completed emits typed input/output tokens and original content | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.spec.ts:688` |
| Copilot producer assertion (updated) | assistant.usage emits typed model, tokens, numeric cost and duration | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/copilot-sdk.adapter.spec.ts:620` |
| OpenCode producer assertion (updated) | step_finish emits typed input/output tokens | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.spec.ts:493` |

## Known gaps

- No live vendor process or interactive browser session was run. Rendering was verified with the real Angular components in Jest's DOM environment; producer tests use the existing mocked SDK/process harnesses.
- The broad diagnostic provider still reports its pre-existing 248 errors; the required project production typechecks, tests and lint pass. Those unrelated diagnostics were left outside scope.
- Historical segments lacking typed usage intentionally receive no regex-derived header stats. No compatibility shim was retained.
- No git commands, staging, commits or history changes were performed.

