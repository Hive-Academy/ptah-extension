# TASK_2026_400 — Batch 3 report

## What was added

- Added one real Electron Playwright regression:
  D:/projects/ptah-extension/apps/ptah-electron-e2e/src/specs/chat/compaction-duplicate-session.spec.ts.
- No production file was changed. In particular, the temporary
  [compaction-diag] warnings were not altered or removed, per the executor
  constraint.
- No fixed sleep was added. Readiness is observed through Playwright locator
  assertions and expect.poll over renderer-to-main RPC calls.

## Why this is a genuine two-tile reproduction

The test uses the real Electron canvas UI to create two simultaneously visible
canvas tiles. For each tile it sends a prompt through the real textarea/send
button, captures that tile's real tabId from the emitted chat:start RPC, and
then delivers the production session:id-resolved message with the same SDK UUID
to both tab IDs. A tab-targeted turn_state event is routed from each tile through
the real ChatMessageHandler, StreamingHandlerService, and StreamRouter; the
second event binds the second tile to the existing conversation containing the
shared session. This is not a single-tab approximation or a DOM clone.

The test then enters /compact in the second tile's real input and clicks its
real send button. It proves the emitted chat:continue request contains:

- prompt: /compact
- sessionId: the shared SDK session
- tabId: the second (array-non-first) tile
- model: the per-tile Fable selection, while the mocked global default remains
  Default

It injects the two real backend completion signals used by the app:
session:compactionComplete and an in-stream compaction_complete chat chunk.

## Assertions

- The test snapshots the chat:resume call count immediately before emitting
  compaction completion. Exactly two additional calls must occur, and only
  those post-baseline calls are inspected; their target tab IDs must be exactly
  the two original canvas tile IDs. This excludes setup/automatic resumes from
  the regression assertion.
- Both tiles render the restored assistant transcript marker.
- Both tiles render non-zero lifetime telemetry: 226.7k tokens and $35.67.
- Both tiles render Compactions 1.
- Both tiles render the compaction marker with 8,000 -> 1,500 tokens in 1.3s.
- Opening the second tile's marker renders the backend compaction summary.
- Both tiles still show Fable Test rather than the global Default model.
- The canvas still contains exactly two tiles.
- The first tile remains unfocused and the non-first origin tile remains
  focused, proving no unrelated tile was activated or created.

## Repository-state mismatch

The assigned shared branch is fix/license-server-dep-pinning at 18f162275.
It does not contain the Batch 1 loader implementation described by
batch-1-report.md / commit cd6b2fc74. The shared branch still re-derives a
compaction destination through openSessionTab and does not honor an explicit
targetTabId. The orchestrator explicitly directed this executor not to restore,
cherry-pick, or edit those production files, and will run this test in an
isolated worktree containing cd6b2fc74.

The local Electron execution recorded below predates the baseline refinement:
it observed two total resume calls and showed that their IDs did not cover both
original tiles. The isolated post-fix run then showed that one of those total
calls can be a setup/automatic resume. The final spec therefore snapshots the
resume-call baseline immediately before compaction completion, waits for exactly
two additional calls, and inspects only that slice. The authoritative fixed-
commit rerun of that final assertion is recorded below.

## Verification — verbatim terminal output

ANSI colour-control bytes are omitted below; all textual output is preserved.

### Lint

Command:

    npx nx run-many -t lint -p ptah-electron-e2e

Output:

     NX   Running target lint for project ptah-electron-e2e:

    - ptah-electron-e2e



    > nx run ptah-electron-e2e:lint

    (node:13984) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
    (Use node --trace-warnings ... to show where the warning was created)

    Linting "ptah-electron-e2e"...

    D:\projects\ptah-extension\apps\ptah-electron-e2e\src\specs\git\hunk-revert-top-layer.spec.ts
      225:16  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
      225:28  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

    D:\projects\ptah-extension\apps\ptah-electron-e2e\src\specs\tasks\tasks-list-visual.spec.ts
      376:5  warning  Unused eslint-disable directive (no problems were reported from 'no-console')
      452:5  warning  Unused eslint-disable directive (no problems were reported from 'no-console')
      517:5  warning  Unused eslint-disable directive (no problems were reported from 'no-console')
      593:5  warning  Unused eslint-disable directive (no problems were reported from 'no-console')

    D:\projects\ptah-extension\apps\ptah-electron-e2e\src\support\fixtures.ts
      44:37  warning  Unexpected empty arrow function  @typescript-eslint/no-empty-function

    D:\projects\ptah-extension\apps\ptah-electron-e2e\src\support\permission-seam-fixtures.ts
      169:37  warning  Unexpected empty arrow function  @typescript-eslint/no-empty-function

    D:\projects\ptah-extension\apps\ptah-electron-e2e\src\support\real-rpc-fixtures.ts
      272:37  warning  Unexpected empty arrow function  @typescript-eslint/no-empty-function

    ✖ 9 problems (0 errors, 9 warnings)
      0 errors and 4 warnings potentially fixable with the --fix option.

    ✖ 9 problems (0 errors, 9 warnings)

      0 errors and 4 warnings are potentially fixable with the --fix option.




     NX   Successfully ran target lint for project ptah-electron-e2e


    Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.

Result: exit code 0. All nine warnings are pre-existing and outside the new
spec.

### Typecheck

Command:

    npx nx run-many -t typecheck -p ptah-electron-e2e

Output:

     NX   Running target typecheck for project ptah-electron-e2e:

    - ptah-electron-e2e



    > nx run ptah-electron-e2e:typecheck

    > tsc --noEmit --project apps/ptah-electron-e2e/tsconfig.spec.json




     NX   Successfully ran target typecheck for project ptah-electron-e2e


    Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.

Result: exit code 0.

### Electron e2e — shared pre-fix branch

This section is historical falsifiability evidence. The authoritative final
gate is the fixed-commit execution immediately below.

The Nx target was first invoked as:

    npx nx run ptah-electron-e2e:e2e --args="src/specs/chat/compaction-duplicate-session.spec.ts"

That target successfully ran its ptah-electron:build-dev and
ptah-electron:copy-renderer-dev dependencies, then invoked the project command:

    npx playwright test --config=playwright.config.ts src/specs/chat/compaction-duplicate-session.spec.ts

Final direct project-command output:

    Running 1 test using 1 worker

      x  1 src\specs\chat\compaction-duplicate-session.spec.ts:52:7 › Compaction recovery for duplicate visible session tiles (TASK_2026_400) › restores both tiles in place when /compact originates from the non-first same-session tile (11.6s)


      1) src\specs\chat\compaction-duplicate-session.spec.ts:52:7 › Compaction recovery for duplicate visible session tiles (TASK_2026_400) › restores both tiles in place when /compact originates from the non-first same-session tile

        Error: expect(received).toEqual(expected) // deep equality

        - Expected  - 1
        + Received  + 1

          Array [
            "04780752-c7bb-4ba0-9906-129abc8840d5",
        -   "9d41d59a-e1a2-4506-bfc4-1417b45a44fd",
        +   "04780752-c7bb-4ba0-9906-129abc8840d5",
          ]

          210 |       .map(tabIdFrom)
          211 |       .sort();
        > 212 |     expect(resumeTabIds).toEqual([firstTabId, secondTabId].sort());
              |                          ^
          213 |
          214 |     for (const tile of [firstTile, secondTile]) {
          215 |       await expect(tile.locator('[data-testid="chat-tool-output"]')).toContainText(
            at D:\projects\ptah-extension\apps\ptah-electron-e2e\src\specs\chat\compaction-duplicate-session.spec.ts:212:26

        attachment #1: screenshot (image/png)
        ..\..\dist\apps\ptah-electron-e2e\test-results\chat-compaction-duplicate--b0536-non-first-same-session-tile\test-failed-1.png

        Error Context: ..\..\dist\apps\ptah-electron-e2e\test-results\chat-compaction-duplicate--b0536-non-first-same-session-tile\error-context.md

      1 failed
        src\specs\chat\compaction-duplicate-session.spec.ts:52:7 › Compaction recovery for duplicate visible session tiles (TASK_2026_400) › restores both tiles in place when /compact originates from the non-first same-session tile
    (node:33520) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
    (Use node --trace-warnings ... to show where the warning was created)
    (node:33520) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
    (Use node --trace-warnings ... to show where the warning was created)
    [ptah-electron stdout] [Ptah Electron] Settings registered and migrations applied (1 custom providers)
    [ptah-electron stdout] [Ptah Electron] DI verify: TOKENS.RPC_HANDLER -- OK
    [ptah-electron stdout] [Ptah Electron] DI verify: TOKENS.LOGGER -- OK
    [ptah-electron stdout] [Ptah Electron] DI verify: PLATFORM_TOKENS.WORKSPACE_PROVIDER -- OK
    [Ptah Electron] DI verify: PLATFORM_TOKENS.STATE_STORAGE -- OK
    [ptah-electron stdout] [Ptah Electron] DI verify: PLATFORM_TOKENS.SECRET_STORAGE -- OK
    [Ptah Electron] DI verification: 5/5 tokens resolved
    [ptah-electron stdout] [Ptah Electron] No persisted workspaces and no CLI arg — starting without workspace
    [ptah-electron stdout] [IpcBridge] Diagnostics IPC handlers initialized
    [ptah-electron stdout] [IpcBridge] IPC listeners initialized
    [ptah-electron stdout] [Ptah Electron] IPC bridge, WebviewManager, and RPC methods initialized
    [ptah-electron stdout] [Ptah Electron] Membership status resolved (valid: false, tier: community)
    [ptah-electron stdout] [Ptah Electron] Agent adapters initialized successfully
    [ptah-electron stdout] [Ptah Electron] Subsystems brought up
    [ptah-electron stdout] [Ptah Electron] Startup config registered
    [ptah-electron stdout] [Ptah Electron] UpdateManager started
    [ptah-electron stdout] [Ptah Electron] Membership revalidation scheduled
    [ptah-electron stderr] [Ptah Electron] Messaging gateway starting without persistence (degraded)
    [ptah-electron stdout] [Ptah Electron] Messaging gateway started
    [ptah-electron stdout] [Ptah Electron] Gateway chat bridge started
    [ptah-electron stdout] [Ptah Electron] Saving window bounds: {"x":360,"y":116,"width":1200,"height":800}
    [ptah-electron stderr] Debugger ending on ws://127.0.0.1:56530/ac67b32a-a83d-4fee-a9b1-d6a9015cbe1a
    For help, see: https://nodejs.org/en/docs/inspector

Result: 0 passed, 1 failed on the shared pre-fix branch before the baseline
refinement. This output proves the test reached the real duplicate-tile reload
boundary; it is retained as historical evidence, not claimed as the final
post-refinement result.

### Electron e2e — authoritative fixed commit

Worktree and revision:

    D:\projects\ptah-extension-e2e-verify
    detached HEAD cd6b2fc74

Command:

    npx nx run ptah-electron-e2e:e2e --args="src/specs/chat/compaction-duplicate-session.spec.ts"

Verbatim target output (ANSI colour-control bytes omitted):

     NX   Running target e2e for project ptah-electron-e2e and 2 tasks it depends on:



    > nx run ptah-electron:copy-renderer-dev

    > nx build ptah-extension-webview --configuration=development

    (node:40024) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
    (Use node --trace-warnings ... to show where the warning was created)

     NX   Running target build for project ptah-extension-webview and 3 tasks it depends on:



    > nx run @ptah-extension/shared:build  [existing outputs match the cache, left as is]


    > nx run @ptah-extension/markdown:build:development  [existing outputs match the cache, left as is]


    > nx run @ptah-extension/ui:build:development  [existing outputs match the cache, left as is]


    > nx run ptah-extension-webview:build:development  [existing outputs match the cache, left as is]

    (node:30484) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
    (Use node --trace-warnings ... to show where the warning was created)
    > Building...
    (node:30484) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
    (Use node --trace-warnings ... to show where the warning was created)
    √ Building...
    Initial chunk files | Names                      |  Raw size
    chunk-DMNXP6RL.js   | -                          |   2.52 MB |
    chunk-R77QWOZ5.js   | -                          |   1.70 MB |
    chunk-SNK2V6SV.js   | -                          |   1.01 MB |
    main.js             | main                       | 611.92 kB |
    chunk-ORIJUSRT.js   | -                          | 522.10 kB |
    chunk-XXZ4GLYD.js   | -                          | 332.99 kB |
    styles.css          | styles                     | 273.75 kB |
    chunk-KCYAYXF2.js   | -                          | 263.71 kB |
    chunk-7FUMJHW2.js   | -                          | 228.54 kB |
    chunk-62ALK2DO.js   | -                          | 219.78 kB |
    polyfills.js        | polyfills                  |  92.52 kB |
    chunk-MYF4KJDS.js   | -                          |  92.49 kB |
    scripts.js          | scripts                    |  84.66 kB |
    chunk-WM5MJ322.js   | -                          |  57.01 kB |
    chunk-Z4OR6GJ6.js   | -                          |  50.59 kB |
    chunk-Q4KZE2KK.js   | -                          |   3.57 kB |

                        | Initial total              |   8.06 MB

    Lazy chunk files    | Names                      |  Raw size
    chunk-NPJIMRT7.js   | index                      |   1.06 MB |
    chunk-5FJZHYPP.js   | index                      | 581.10 kB |
    chunk-3Z5SBIPF.js   | index                      | 434.83 kB |
    chunk-W3B5YO6H.js   | index                      | 280.47 kB |
    chunk-7SJKOYGS.js   | index                      | 190.78 kB |
    theme-extra.css     | theme-extra                |  60.92 kB |
    chunk-5AAFIQWN.js   | index                      |  19.60 kB |
    chunk-MSL2XU3N.js   | -                          |  14.75 kB |
    chunk-74HVJKNB.js   | -                          |   1.61 kB |
    chunk-JGAVBH3L.js   | index                      | 916 bytes |
    chunk-BTTAJ46C.js   | metadata-patch-schema-lazy | 206 bytes |

    Application bundle generation complete. [21.856 seconds] - 2026-09-08T17:55:52.432Z

    Output location: D:\projects\ptah-extension-e2e-verify\dist\apps\ptah-extension-webview



     NX   Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on

    Nx read the output from the cache instead of running the command for 4 out of 4 tasks.

    Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.

    > node apps/ptah-electron/scripts/copy-renderer.js

    [copy-renderer] Cleaned old renderer directory
    [copy-renderer] Copied D:\projects\ptah-extension-e2e-verify\dist\apps\ptah-extension-webview\browser -> D:\projects\ptah-extension-e2e-verify\dist\apps\ptah-electron\renderer
    [copy-renderer] Patched index.html: base href="/" -> "./"
    [copy-renderer] Done

    > nx run ptah-electron:build-dev

    > nx build-main ptah-electron --configuration=development

    (node:19372) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
    (Use node --trace-warnings ... to show where the warning was created)

    > nx run ptah-electron:build-main:development  [existing outputs match the cache, left as is]

    (node:24260) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
    (Use node --trace-warnings ... to show where the warning was created)



     NX   Successfully ran target build-main for project ptah-electron

    Nx read the output from the cache instead of running the command for 1 out of 1 tasks.

    Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.

    > nx build-preload ptah-electron

    (node:33760) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
    (Use node --trace-warnings ... to show where the warning was created)

    > nx run ptah-electron:build-preload  [existing outputs match the cache, left as is]

    (node:13052) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
    (Use node --trace-warnings ... to show where the warning was created)



     NX   Successfully ran target build-preload for project ptah-electron

    Nx read the output from the cache instead of running the command for 1 out of 1 tasks.

    Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.

    > nx build-embedder-worker ptah-electron

    (node:14120) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
    (Use node --trace-warnings ... to show where the warning was created)

    > nx run ptah-electron:build-embedder-worker  [existing outputs match the cache, left as is]

    (node:35740) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
    (Use node --trace-warnings ... to show where the warning was created)



     NX   Successfully ran target build-embedder-worker for project ptah-electron

    Nx read the output from the cache instead of running the command for 1 out of 1 tasks.

    Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.

    > nx build-voice-worker ptah-electron

    (node:13304) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
    (Use node --trace-warnings ... to show where the warning was created)

    > nx run ptah-electron:build-voice-worker  [existing outputs match the cache, left as is]

    (node:24844) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
    (Use node --trace-warnings ... to show where the warning was created)



     NX   Successfully ran target build-voice-worker for project ptah-electron

    Nx read the output from the cache instead of running the command for 1 out of 1 tasks.

    Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.

    > nx build-integrity-worker ptah-electron

    (node:14796) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
    (Use node --trace-warnings ... to show where the warning was created)

    > nx run ptah-electron:build-integrity-worker  [existing outputs match the cache, left as is]

    (node:43300) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
    (Use node --trace-warnings ... to show where the warning was created)



     NX   Successfully ran target build-integrity-worker for project ptah-electron

    Nx read the output from the cache instead of running the command for 1 out of 1 tasks.

    Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.

    > node scripts/copy-wasm.js dist/apps/ptah-electron

      Copied web-tree-sitter.wasm (195.6 KB)
      Copied tree-sitter-javascript.wasm (402.1 KB)
      Copied tree-sitter-typescript.wasm (1380.7 KB)
      Copied tree-sitter-python.wasm (447.2 KB)
      Copied tree-sitter-go.wasm (212.1 KB)
      Copied tree-sitter-c-sharp.wasm (4983.7 KB)
    WASM assets copied to D:\projects\ptah-extension-e2e-verify\dist\apps\ptah-electron\wasm

    > nx run ptah-electron-e2e:e2e --args=src/specs/chat/compaction-duplicate-session.spec.ts

    > npx playwright test --config=playwright.config.ts src/specs/chat/compaction-duplicate-session.spec.ts


    Running 1 test using 1 worker

      ok 1 src\specs\chat\compaction-duplicate-session.spec.ts:52:7 › Compaction recovery for duplicate visible session tiles (TASK_2026_400) › restores both tiles in place when /compact originates from the non-first same-session tile (11.5s)

      1 passed (12.1s)



     NX   Successfully ran target e2e for project ptah-electron-e2e and 2 tasks it depends on


    Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.

Result: exit code 0; 1 passed, 0 failed. This is the authoritative final e2e
gate for the baseline-aware regression against the Batch 1 fixed commit.

## Not done

- No production diagnostics were removed.
- No production data-testid was required.
- No commit was created.
- The shared branch itself still does not contain the production fix; the
  authoritative product verification was therefore run in the isolated
  detached cd6b2fc74 worktree documented above.
