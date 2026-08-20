# TASK_2026_282 — Pre-existing spec failures on `ak/tui-defects`

Filed from the TASK_2026_278 gate run (`nx affected -t typecheck lint test`, 95 projects). typecheck and lint are clean across all 95; these three test projects fail. All were verified against a clean worktree at HEAD — none is caused by the harness reconciler work.

## 1. `apps/ptah-extension-webview` — `src/app/unit5-message-routing.spec.ts` (6 tests)

Every test dies in `beforeEach` with NG0201. The spec builds a `TestBed` mirroring `app.config.ts`'s `MESSAGE_HANDLERS` registrations but does not provide `MODEL_REFRESH_CONTROL`, which is now reached transitively:
`HarnessWorkflowMessageHandler → HarnessWorkflowService → PermissionHandlerService → TabManagerService`.

Likely fix: add `...provideModelRefreshControl()` to the spec's providers. Worth also asking whether this spec should assert against the real `appConfig.providers` rather than a hand-maintained copy — a mirrored provider list drifts by construction, and that drift is the whole failure.

## 2. `libs/frontend/thoth-shell` (1 test)

`ThothShellComponent › switches active tab via setThothActiveTab when a tab is clicked` → `TypeError: this.state.refreshQueue is not a function`, with `ERROR TypeError: this.appState.workspaceInfo is not a function` logged twice during the same run. Both are stub objects that have fallen behind the signals the component now reads.

## 3. `libs/api/member-hub` (2 tests)

`SessionsSection — the Phase-4 three-way merge`:

- `the per-source truth table › Calendar DISABLED but a private session exists -> ok`
- `the private source — R4, and what it refuses to show › reconstructs endsAt from durationMinutes, since the row has no end column`

Unrelated to the other two; needs its own read of the merge logic vs. the fixtures.

## Also worth a look, not currently failing

- `agent-generation` user-layer specs were flagged flaky by Nx under parallel load. One real vector was fixed during 278 (`rm` with `maxRetries: 0`, which throws on Windows `EBUSY`); three suspected causes turned out not to exist in that tree. If it recurs, capture the actual red output before hardening further.
- `ptah-cli` has a worker-teardown leak ("worker process failed to exit gracefully") and one `EPERM` on a jest transform-cache file, both environmental and both clearing on retry.

## Acceptance

`nx affected -t test` green on this branch, with each fix landing in the spec (or the stub) that owns the gap — no product code changed unless a failure turns out to be real.
