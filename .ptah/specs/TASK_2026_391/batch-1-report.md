# TASK_2026_391 — Batch 1 report

## What changed and why

- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:51,508-744`
  adds `targetTabId?: TabId` to the session-switch options. Targeted loads use
  `(sessionId, tabId)` as their in-flight identity, validate ownership before
  and after both asynchronous RPC boundaries, bypass `openSessionTab`, never
  activate/switch a tab, and route resume initialization, RPC, stats, replay,
  finalization, failure, and legacy history writes to the explicit tab.
- `libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts:357-424`
  preserves each fan-out tab's lifetime stats (or projects its current live
  summary) instead of synthesizing zero-token stats, and schedules one explicit
  targeted reload for every cleared tab while retaining the existing settle
  cleanup semantics and `[compaction-diag]` logging.
- `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:86-205`
  adds an opt-out `fanOut` replay option. Live streaming still fans out by
  default; compaction replay passes `fanOut: false` and touches only its target.
- `libs/frontend/chat-state/src/lib/tab-manager.service.ts` did not require a
  change. `applyCompactionComplete` already stores the supplied snapshot, and
  the resume/failure mutators do not clear it or either per-tab model field.

## Tests added or updated

- `restores history and stats to the second matching tab without opening or activating another tab`
- `uses the explicit target for the legacy-message fallback`
- `fails loudly when the target does not own the requested session`
- `fails before writing when the target disappears during session load`
- `stops downstream writes when the target disappears during chat resume`
- `keys in-flight targeted loads by both session and tab`
- `B2 — preserves lifetime stats when a targeted reload fails`
- `reloads every cleared same-session tab by its explicit tab id`
- `target-only replay writes only to the explicit tab`

The existing live multi-tab fan-out test remains unchanged. N1/N2 expectations
now require explicit target tab IDs, including rotated and null-session fan-out
plans.

## Verification gate — verbatim output

### Tests

Command:

```text
npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/chat-state @ptah-extension/chat-streaming
```

```text
 NX   Running target test for 3 projects:

- @ptah-extension/chat
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming



> nx run @ptah-extension/chat-state:test

(node:3936) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:26144) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:49600) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:44104) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:43312) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:22468) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:12460) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:17640) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:33524) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:31908) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:15148) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:34708) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:20032) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:49072) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:45492) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:11828) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them.

Test Suites: 15 passed, 15 total
Tests:       338 passed, 338 total
Snapshots:   0 total
Time:        25.296 s
Ran all test suites.

> nx run @ptah-extension/chat-streaming:test

(node:10124) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:33428) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:28724) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:15140) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:24996) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:17816) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:23564) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:49116) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:39036) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:24496) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:5484) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:50324) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:9256) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:28132) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:37340) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:50296) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them.

Test Suites: 22 passed, 22 total
Tests:       1 skipped, 450 passed, 451 total
Snapshots:   0 total
Time:        31.591 s
Ran all test suites.

> nx run @ptah-extension/chat:test

(node:24756) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:37104) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:12264) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:50924) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:33284) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:47744) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:31136) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:20684) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:39460) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:42540) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:41888) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:24680) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:36808) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:27668) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:47980) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:28400) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them.

Test Suites: 65 passed, 65 total
Tests:       2 skipped, 999 passed, 1001 total
Snapshots:   0 total
Time:        35.097 s
Ran all test suites.



 NX   Successfully ran target test for 3 projects


Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

ANSI colour-control bytes are not represented in this Markdown transcription;
all textual terminal output is included. The Nx header confirms all 3 requested
projects ran.

### Typecheck

Command:

```text
npx nx run-many -t typecheck -p @ptah-extension/chat @ptah-extension/chat-state @ptah-extension/chat-streaming
```

```text
 NX   Running target typecheck for 3 projects:

- @ptah-extension/chat
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming



> nx run @ptah-extension/chat-state:typecheck

> npx ngc --noEmit --project libs/frontend/chat-state/tsconfig.lib.json

(node:2236) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:46620) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

> nx run @ptah-extension/chat-streaming:typecheck

> npx ngc --noEmit --project libs/frontend/chat-streaming/tsconfig.lib.json

(node:51332) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:25696) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

> nx run @ptah-extension/chat:typecheck

> npx ngc --noEmit --project libs/frontend/chat/tsconfig.lib.json

(node:8968) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:5100) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)



 NX   Successfully ran target typecheck for 3 projects


Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

### Lint

Command:

```text
npx nx run-many -t lint -p @ptah-extension/chat @ptah-extension/chat-state @ptah-extension/chat-streaming
```

```text
 NX   Running target lint for 3 projects:

- @ptah-extension/chat
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming



> nx run @ptah-extension/chat-state:lint  [existing outputs match the cache, left as is]

Linting "@ptah-extension/chat-state"...
D:\projects\ptah-extension\libs\frontend\chat-state\src\lib\tab-manager.cross-workspace.spec.ts
  115:29  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
D:\projects\ptah-extension\libs\frontend\chat-state\src\lib\tab-manager.service.ts
    40:10  warning  'ClaudeSessionId' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  1513:1   warning  File has too many lines (1190). Maximum allowed is 700                             max-lines
✖ 3 problems (0 errors, 3 warnings)

> nx run @ptah-extension/chat-streaming:lint

(node:46824) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

Linting "@ptah-extension/chat-streaming"...
D:\projects\ptah-extension\libs\frontend\chat-streaming\src\lib\agent-monitor.store.ts
  1155:1  warning  File has too many lines (1091). Maximum allowed is 700  max-lines
D:\projects\ptah-extension\libs\frontend\chat-streaming\src\lib\streaming-event-cascade-clean.spec.ts
  8:11  warning  'SeedTextDelta' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
✖ 2 problems (0 errors, 2 warnings)

> nx run @ptah-extension/chat:lint

(node:46128) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
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
   70:35   warning  'SessionId' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  369:22   warning  Unexpected empty arrow function                                              @typescript-eslint/no-empty-function
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
  919:43  warning  Unexpected empty async method 'createNewSession'  @typescript-eslint/no-empty-function
D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\ptah-ai\agent-orchestration-config.component.ts
  739:1  warning  File has too many lines (988). Maximum allowed is 700  max-lines
D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\ptah-ai\ptah-cli-config.component.ts
   787:49  warning  Unexpected empty arrow function                         @typescript-eslint/no-empty-function
   789:1   warning  File has too many lines (1034). Maximum allowed is 700  max-lines
  1014:49  warning  Unexpected empty arrow function                         @typescript-eslint/no-empty-function
✖ 17 problems (0 errors, 17 warnings)

  0 errors and 1 warning are potentially fixable with the `--fix` option.



 NX   Successfully ran target lint for 3 projects

Nx read the output from the cache instead of running the command for 1 out of 3 tasks.

Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

## Could not do / notes

- Nothing blocked the implementation or verification.
- The test runner reported existing worker teardown warnings, but all suites
  passed and Nx returned exit code 0.
- Lint returned exit code 0 with existing warnings and no errors.
- No commit was created.
