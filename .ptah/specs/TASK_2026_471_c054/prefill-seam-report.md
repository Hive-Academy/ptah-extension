## What changed

- `libs/frontend/core/src/lib/services/app-state.service.ts:110` exports the monotonic `ComposerPrefillRequest` contract and adds the signal plus `requestComposerPrefill` publisher at line 804.
- `libs/frontend/core/src/lib/services/app-state.service.spec.ts:780` pins the initial request and monotonic sequence, text, and target-tab updates.
- `libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.ts:22` replaces the send outcome with a layout-scoped composer-prefill publication at line 71, removes `MessageSenderService`, and still resolves failures from tab creation through `finally`.
- `libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.spec.ts:60` rewrites the send-path assertions for prefill behavior, with both single- and grid-layout targeting pinned at line 96 and retained tab-creation failure coverage.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:840` consumes nonzero prefill requests only for the matching surface and delegates to `handlePromptSelected` at line 848, preserving focus and auto-resize behavior.

## Contract

```ts
export interface ComposerPrefillRequest {
  readonly seq: number;
  readonly text: string;
  readonly tabId: string | null;
}
```

## Verification

The first test invocation confirmed `Running target test for 2 projects` but failed because temporary `ChatViewComponent` effect tests forced the suite's deliberately minimal harness through an unrelated full-template tick (`chatStore.unmatchedPermissions is not a function`). Those temporary tests were removed; the production change and focused app-state/bridge coverage remain. The exact command was rerun and passed.

`npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/core`

```text
Test Suites: 82 passed, 82 total
Tests:       2 skipped, 1312 passed, 1314 total
Snapshots:   0 total
Time:        21.802 s, estimated 38 s
Ran all test suites.



 NX   Successfully ran target test for 2 projects

Nx read the output from the cache instead of running the command for 1 out of 2 tasks.

Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

The header was `Running target test for 2 projects`; the cached core result in the same output was 30 suites and 721 tests passed.

`npx nx run-many -t typecheck -p @ptah-extension/chat @ptah-extension/core`

```text
> nx run @ptah-extension/chat:typecheck

> npx ngc --noEmit --project libs/frontend/chat/tsconfig.lib.json

(node:39624) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:6056) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)



 NX   Successfully ran target typecheck for 2 projects


Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

The header was `Running target typecheck for 2 projects`.

## Risks

- The successful test run reported an existing Jest worker teardown warning for the cached core suite; all 721 core tests still passed.
- Nx reported that the local AI-agent configuration is outdated after both commands; this did not affect test or typecheck results.

## Review round 1

Fixed `libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.ts:65`: the bridge now reads layout once, publishes the created tab id only for grid layout, and publishes `null` for single layout so the main panel (which has no `SESSION_CONTEXT`) claims the prefill. The guard comment at line 69 records why single layout intentionally drops the id. `task-prompt-bridge.service.spec.ts:96` parameterizes both layouts to prevent regression.

`npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/core`

```text
 NX   Running target test for 2 projects:

- @ptah-extension/chat
- @ptah-extension/core

Test Suites: 30 passed, 30 total
Tests:       721 passed, 721 total
Snapshots:   0 total
Time:        17.949 s, estimated 28 s
Ran all test suites.

Test Suites: 82 passed, 82 total
Tests:       2 skipped, 1313 passed, 1315 total
Snapshots:   0 total
Time:        33.19 s
Ran all test suites.

 NX   Successfully ran target test for 2 projects

Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

`npx nx run-many -t typecheck -p @ptah-extension/chat @ptah-extension/core`

```text
 NX   Running target typecheck for 2 projects:

- @ptah-extension/chat
- @ptah-extension/core

> nx run @ptah-extension/core:typecheck

> npx ngc --noEmit --project libs/frontend/core/tsconfig.lib.json

> nx run @ptah-extension/chat:typecheck

> npx ngc --noEmit --project libs/frontend/chat/tsconfig.lib.json

 NX   Successfully ran target typecheck for 2 projects

Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```
