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

## Outcome (2026-08-25, branch `fix/electron-update-check-timeout`)

Re-verified all three projects at HEAD. Two were already repaired by later commits and one was still leaking.

1. **`ptah-extension-webview` — already fixed.** `dd1209413 test(webview): give the unit5 TestBed the model-refresh token it resolves` added `...provideModelRefreshControl()` at `unit5-message-routing.spec.ts:150`, and `0bfd77f29` taught the spec about the tasks surface gate. 7 suites / 141 tests pass.
2. **`api-member-hub` — already fixed.** 9 suites / 125 tests pass. No SessionsSection failure remains.
3. **`thoth-shell` — repaired here.** The `refreshQueue` half was already gone, but `TypeError: this.appState.workspaceInfo is not a function` was still thrown twice per run. The tests PASSED anyway: Angular routes an exception raised inside a subscription to the application `ErrorHandler`, which logged it and let the suite go green. Two of the four hand-written `AppStateManager` stubs (the gateway and skills placeholder cases) had no `workspaceInfo`, which `ThothStatusService` reads on behalf of the shell.

The fix is two parts, both spec-local. No product code changed.

- One `makeAppStateStub()` factory replaces the four literals. Four separate literals is how two of them lost the signal in the first place.
- A `RecordingErrorHandler` is provided into every TestBed and asserted empty in `afterEach`. This is the durable half: a swallowed error is now a red suite rather than a line of console noise. Verified by deleting `workspaceInfo` from the factory — all 5 tests fail; restored, all 5 pass.

`lint`, `typecheck` and `test` are green for `@ptah-extension/thoth-shell`.
