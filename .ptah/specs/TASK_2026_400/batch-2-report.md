# TASK_2026_400 — Batch 2 report

## Outcome

Implemented the model-selector tab-awareness fix without changing `TabState`,
`TabManagerService`, any Batch 1 file, or `ModelStateService`.

- `libs/frontend/chat/src/lib/components/molecules/chat-input/model-selector.component.ts:182`
  now resolves the canvas context tab when `SESSION_CONTEXT` supplies a tab ID;
  otherwise it reads `TabManagerService.activeTab()`. It resolves the displayed
  model in the required order: `overrideModel ?? sessionModel ??
modelState.currentModel()`.
- `libs/frontend/chat/src/lib/components/molecules/chat-input/model-selector.component.spec.ts:1`
  adds a signal-based, logic-only TestBed harness using branded `TabId` values.

This keeps a canvas override highest priority, preserves the restored session
model in the main panel across global model-list refreshes, and retains the
global fallback for fresh tabs.

Review correction: the harness's `sessionContext` option is explicitly typed
as `Signal<TabId | null> | null`, so test setup cannot substitute an unbranded
string ID. The focused suite was rerun against the final spec after this
correction and passed 3/3 (`2.653 s`).

## Tests added

1. `keeps a resumed main-panel tab sessionModel after a global models-list refresh selects default`
2. `keeps a canvas tile's overrideModel as the highest priority`
3. `falls back to the global default for a fresh tab with no model fields`

## Regression proof (red before production change)

Command:

```text
npx nx test @ptah-extension/chat --testPathPatterns=model-selector.component.spec.ts --runInBand
```

Output:

```text
> nx run @ptah-extension/chat:test --testPathPatterns=model-selector.component.spec.ts --runInBand

FAIL chat libs/frontend/chat/src/lib/components/molecules/chat-input/model-selector.component.spec.ts
  ● ModelSelectorComponent.effectiveModel › keeps a resumed main-panel tab sessionModel after a global models-list refresh selects default

    expect(received).toBe(expected) // Object.is equality
    Expected: "claude-fable-5-1[1m]"
    Received: "default"

      80 |     currentModel.set('default');
      81 |
    > 82 |     expect(component.effectiveModel()).toBe('claude-fable-5-1[1m]');
         |                                        ^

Test Suites: 1 failed, 1 total
Tests:       1 failed, 2 passed, 3 total
Snapshots:   0 total
Time:        2.947 s
Ran all test suites matching model-selector.component.spec.ts.

NX   Running target test for project @ptah-extension/chat failed
```

## Regression proof (green after production change)

Command:

```text
npx nx test @ptah-extension/chat --testPathPatterns=model-selector.component.spec.ts --runInBand
```

Output:

```text
> nx run @ptah-extension/chat:test --testPathPatterns=model-selector.component.spec.ts --runInBand

NX   Successfully ran target test for project @ptah-extension/chat

Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.

(node:29748) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
Snapshots:   0 total
Time:        1.896 s, estimated 2 s
Ran all test suites matching model-selector.component.spec.ts.
```

## Verification gate — verbatim output

ANSI colour control characters are omitted; the text below is otherwise the
terminal output from the required commands.

### `npx nx run-many -t test -p @ptah-extension/chat`

```text
NX   Running target test for project @ptah-extension/chat:

- @ptah-extension/chat

> nx run @ptah-extension/chat:test

FAIL chat libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.spec.ts
  ● CompactionLifecycleService › handleCompactionComplete › clears tree-builder cache, resets tab, increments compactionCount, switches session

    expect(jest.fn()).toHaveBeenCalledWith(...expected)

    - Expected
    + Received

      "1d58a75a-2990-4184-bb12-f371985298c2",
      Object {
        "reason": "compaction",
    +   "targetTabId": "tab-1",
      },

    Number of calls: 1

  ● CompactionLifecycleService › handleCompactionComplete › B2 — resets preloadedStats.tokens to zero {0,0,0,0} while preserving totalCost (lifetime cost)

    expect(received).toEqual(expected) // deep equality

    - Expected  - 4
    + Received  + 4

      Object {
    -   "cacheCreation": 0,
    -   "cacheRead": 0,
    -   "input": 0,
    -   "output": 0,
    +   "cacheCreation": 50,
    +   "cacheRead": 100,
    +   "input": 1000,
    +   "output": 500,
      }

  ● CompactionLifecycleService › N1 — handleCompactionComplete fans out to sibling tabs › dedupes switchSession reload by unique claudeSessionId

    expect(jest.fn()).toHaveBeenCalledTimes(expected)

    Expected number of calls: 1
    Received number of calls: 2

  ● CompactionLifecycleService › N2 — handleCompactionComplete widens the fan-out to excluded tiles › includes a same-conversation tile whose claudeSessionId has rotated (not returned by findTabsBySessionId)

    expect(jest.fn()).toHaveBeenCalledWith(...expected)

    Expected: "8d7c921a-5560-4c44-916a-dbdfb0259c91", {"reason": "compaction"}
    Received
           1
              "61066417-6bee-4dbf-a05b-6a7757fa3853",
              Object {
                "reason": "compaction",
            +   "targetTabId": "tab-1",
              },
           2
              "8d7c921a-5560-4c44-916a-dbdfb0259c91",
              Object {
                "reason": "compaction",
            +   "targetTabId": "tile-1",
              },

    Number of calls: 2

  ● CompactionLifecycleService › N2 — handleCompactionComplete widens the fan-out to excluded tiles › includes a tile via findContainingSession when the originating tab is unbound

    expect(jest.fn()).toHaveBeenCalledWith(...expected)

    Expected: "8d7c921a-5560-4c44-916a-dbdfb0259c91", {"reason": "compaction"}
    Received
           1
              "61066417-6bee-4dbf-a05b-6a7757fa3853",
              Object {
                "reason": "compaction",
            +   "targetTabId": "tab-orphan",
              },
           2
              "8d7c921a-5560-4c44-916a-dbdfb0259c91",
              Object {
                "reason": "compaction",
            +   "targetTabId": "tile-1",
              },

    Number of calls: 2

  ● CompactionLifecycleService › N2 — handleCompactionComplete widens the fan-out to excluded tiles › reloads a widened tile with a null claudeSessionId via the compactionSessionId fallback

    expect(jest.fn()).toHaveBeenCalledWith(...expected)

    Expected: "61066417-6bee-4dbf-a05b-6a7757fa3853", {"reason": "compaction"}
    Received
           1
              "61066417-6bee-4dbf-a05b-6a7757fa3853",
              Object {
                "reason": "compaction",
            +   "targetTabId": "tab-1",
              },
           2
              "61066417-6bee-4dbf-a05b-6a7757fa3853",
              Object {
                "reason": "compaction",
            +   "targetTabId": "tile-1",
              },

    Number of calls: 2

  ● CompactionLifecycleService › compaction marker (token + summary merge inputs) › handleCompactionComplete reloads the session with { reason: compaction }

    expect(jest.fn()).toHaveBeenCalledWith(...expected)

    - Expected
    + Received

      "b6929417-eea4-4c9f-87bb-ba83ddebaa75",
      Object {
        "reason": "compaction",
    +   "targetTabId": "tab-1",
      },

    Number of calls: 1

A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them.

Test Suites: 1 failed, 64 passed, 65 total
Tests:       7 failed, 2 skipped, 986 passed, 995 total
Snapshots:   0 total
Time:        19.434 s, estimated 147 s
Ran all test suites.

NX   Running target test for project @ptah-extension/chat failed

Failed tasks:

- @ptah-extension/chat:test

Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

Result: **failed (exit 1)**. All seven failures are in the concurrently edited
Batch 1 `compaction-lifecycle.service.spec.ts`; the new Batch 2 suite passed as
part of the 64 passing suites.

### `npx nx run-many -t typecheck -p @ptah-extension/chat`

```text
NX   Running target typecheck for project @ptah-extension/chat:

- @ptah-extension/chat

> nx run @ptah-extension/chat:typecheck

> npx ngc --noEmit --project libs/frontend/chat/tsconfig.lib.json

(node:13592) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:31488) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
src/lib/services/chat-store/compaction-lifecycle.service.ts:369:11 - error TS2322: Type 'SessionCostSummary | { totalCost: number | null; tokens: { input: number; output: number; cacheRead: number; cacheCreation: number; }; messageCount: number; } | null' is not assignable to type 'PreloadedStatsPayload | null | undefined'.
  Property 'tokens' is missing in type 'SessionCostSummary' but required in type 'PreloadedStatsPayload'.

369           preloadedStats,
              ~~~~~~~~~~~~~~

  ../chat-state/src/lib/tab-state.types.ts:25:3
    25   tokens: {
         ~~~~~~
    'tokens' is declared here.
  ../chat-state/src/lib/tab-manager.service.ts:1733:7
    1733       preloadedStats: PreloadedStatsPayload | null | undefined;
               ~~~~~~~~~~~~~~
    The expected type comes from property 'preloadedStats' which is declared here on type '{ preloadedStats: PreloadedStatsPayload | null | undefined; compactionCount: number; }'

Warning: command "npx ngc --noEmit --project libs/frontend/chat/tsconfig.lib.json" exited with non-zero status code

NX   Running target typecheck for project @ptah-extension/chat failed

Failed tasks:

- @ptah-extension/chat:typecheck

Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

Result: **failed (exit 1)** on the concurrently edited Batch 1
`compaction-lifecycle.service.ts`. No diagnostic names either Batch 2 file.

### `npx nx run-many -t lint -p @ptah-extension/chat`

```text
NX   Running target lint for project @ptah-extension/chat:

- @ptah-extension/chat

> nx run @ptah-extension/chat:lint

(node:50420) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

Linting "@ptah-extension/chat"...

D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input\chat-input.component.ts
  885:1  warning  File has too many lines (978). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\execution\inline-agent-bubble.component.spec.ts
  253:7  warning  Unused eslint-disable directive (no problems were reported from '@typescript-eslint/dot-notation')

D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\execution\inline-agent-bubble.component.ts
  807:1   warning  File has too many lines (932). Maximum allowed is 700  max-lines
  936:37  warning  Forbidden non-null assertion                           @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts
   70:35  warning  'SessionId' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  369:22  warning  Unexpected empty arrow function                                              @typescript-eslint/no-empty-function

D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.spec.ts
  1045:5  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts
  1062:1  warning  File has too many lines (906). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.keepalive.spec.ts
  200:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  212:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  213:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  221:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts
  924:43  warning  Unexpected empty async method 'createNewSession'  @typescript-eslint/no-empty-function

D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\ptah-ai\agent-orchestration-config.component.ts
  739:1  warning  File has too many lines (988). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\ptah-ai\ptah-cli-config.component.ts
   787:49  warning  Unexpected empty arrow function                         @typescript-eslint/no-empty-function
   789:1   warning  File has too many lines (1034). Maximum allowed is 700  max-lines
  1014:49  warning  Unexpected empty arrow function                         @typescript-eslint/no-empty-function

✖ 17 problems (0 errors, 17 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

✖ 17 problems (0 errors, 17 warnings)

  0 errors and 1 warning are potentially fixable with the `--fix` option.

NX   Successfully ran target lint for project @ptah-extension/chat

Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

Result: **passed (exit 0)** with 17 unrelated warnings and no warning in either
Batch 2 file.

## Anything not done

- Did not edit `model-state.service.ts`; the fix did not require it.
- Did not add a `TabState` field or touch any Batch 1/shared-state file.
- Did not repair the concurrent Batch 1 test/typecheck failures because those
  files are explicitly outside Batch 2 ownership.
- Did not commit, as requested.
