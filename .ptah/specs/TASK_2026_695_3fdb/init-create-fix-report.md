# SDK init metadata create correction

## Changes

- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1457-1474`: restored two direct `metadataStore.create` branches with no catch. A rejected create now rejects the SDK init callback before the session ID resolved notification. Both branches pass `blankToUndefined(providerId)`; the equal-directory branch passes an undefined working directory, and the worktree branch passes its actual working directory.
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts:1337`: existing provider-ID creation test verifies `openrouter` reaches `create`.
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts:1361`: corrected failure test verifies the same rejection propagates and the resolved callback is not called.
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts:1383`: added blank-provider test verifying an undefined provider argument.
- Updated existing create argument assertions, including the worktree and equal-directory cases (`sdk-agent-adapter.spec.ts:1326`, `:1407`, `:1455`, `:1489`).

## Behavior check

`SessionMetadataStore.create` (`session-metadata-store.ts:1358-1407`) defaults the status to `created`, defaults an omitted or blank working directory to `workspaceId`, and omits a blank provider ID. Passing `'created'`, `undefined`, and a normalized provider ID therefore preserves the prior equal-directory metadata values. The resume and slash-command provider writes were not changed.

## Checks

- Prettier on both changed files: passed.
- Scoped Ptah diagnostics: 0 errors, 0 warnings.
- `nx typecheck agent-sdk --parallel=1 --output-style=static`: passed.
- ESLint on adapter: 0 errors; 2 pre-existing warnings (`no-useless-assignment` at line 449, `max-lines` at line 1025).
- `nx test agent-sdk --parallel=1 --output-style=static -- --maxWorkers=2`: 163 suites passed, 2 skipped; 3,498 tests passed, 3 skipped.
- Degradation audit: 294 unsuppressed sites, unchanged target count.

## Limitation

The backend-developer role prohibits git commands, so the requested `git show HEAD` comparison was not run. The previous call behavior was established from the task description, existing spec expectations, and the store defaults above.

