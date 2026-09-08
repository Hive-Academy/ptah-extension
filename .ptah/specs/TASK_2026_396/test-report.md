# Test report — TASK_2026_396

## Tests added

All in
`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.resume-parent-session.spec.ts`,
inside one new `describe` block:
`agent:resumeCliSession — no filesystem gate (TASK_2026_396)`.

| # | Test name | file:line | AC |
|---|-----------|-----------|----|
| 1 | `resumes a codex session when the claude projects directory is absent` | `agent-rpc.handlers.resume-parent-session.spec.ts:468` | AC1 |
| 2 | `passes the codex thread id through as resumeSessionId when the session file is missing` | `agent-rpc.handlers.resume-parent-session.spec.ts:490` | AC2 |
| 3 | `threads the cli session id into both halves of the ptah-cli resume` | `agent-rpc.handlers.resume-parent-session.spec.ts:514` | AC3' |

The `describe` block starts at line 459. Each test asserts both
`expect(mockReaddir).not.toHaveBeenCalled()` and
`expect(mockAccess).not.toHaveBeenCalled()` (AC6). Test 2 asserts the exact
`resumeSessionId` value (`CLI_SESSION_ID`), not just that spawn was called.
Test 3 asserts the id on BOTH `registry.spawnAgent.mock.calls[0][2].resumeSessionId`
and `processManager.spawnFromSdkHandle.mock.calls[0][1].resumeSessionId`.

The block has its own `beforeEach` that calls `mockReaddir.mockReset()` and
`mockAccess.mockReset()`, so per-test configuration does not leak.

## Suite result

Command:

```
npx nx run-many -t test -p @ptah-extension/rpc-handlers --skip-nx-cache
```

Header line:

```
Running target test for project @ptah-extension/rpc-handlers:
```

One project, as required by AC5.

Totals (after restore):

```
Test Suites: 92 passed, 92 total
Tests:       31 skipped, 2697 passed, 2728 total
```

All pre-existing tests and the three new tests pass.

## Mutation check

Reverted one line in
`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`, in the
non-`ptah-cli` spawn branch (the `agent:resumeCliSession` handler):

```diff
-            resumeSessionId: params.cliSessionId,
+            resumeSessionId: undefined,
```

Re-ran the suite. Test 2 (AC2) FAILED as expected. Failure message:

```
Expected: "cli-session-uuid"
Received: undefined

  ● agent:resumeCliSession — no filesystem gate (TASK_2026_396) › passes the codex thread id through as resumeSessionId when the session file is missing

    expect(h.processManager.spawn.mock.calls[0][0].resumeSessionId).toBe(...)
```

The pre-existing `accepts a non-empty cliSessionId and spawns` test (line 282)
also failed for the same reason — the mutation broke the shared contract, which
confirms the assertion is load-bearing.

Totals under mutation:

```
Tests: 2 failed, 31 skipped, 2695 passed, 2728 total
```

Restored the line exactly to `resumeSessionId: params.cliSessionId,` and
re-ran the suite. Result:

```
Tests: 31 skipped, 2697 passed, 2728 total
```

The file is restored to its pre-mutation state.

## Gaps

None. AC1, AC2 and AC3' are covered, AC6's negative fs assertions are present
in every test, and the mutation check proved Test 2 detects the
silent-loss regression.

---

`git diff --stat` output (after restore):

```
 .../src/lib/handlers/agent-rpc.handlers.resume-parent-session.spec.ts | 100 ++++++++++++++++++++-
 .../src/lib/handlers/agent-rpc.handlers.ts                             |  63 +------------
 2 files changed, 100 insertions(+), 63 deletions(-)
```

The `agent-rpc.handlers.ts` change is the pre-existing fix (the probe deletion)
that was already staged in the worktree before this test phase began; it is not
my work. My only edit is the 100 insertions in the spec file. The temporary
mutation was reverted line-for-line and the suite is green again.
## Review findings closed

| Finding | Change | Location |
|---|---|---|
| A1 | Added `surfaces a stale codex thread id as a clean error instead of rejecting`. Overrides `processManager.spawn` to reject with `thread not found: cli-session-uuid`; asserts `success: false` and `error` contains `thread not found`. Pins the outer catch at `agent-rpc.handlers.ts:818-825`. | `agent-rpc.handlers.resume-parent-session.spec.ts` (no filesystem gate block) |
| A2 | Added `surfaces a ptah-cli registry failure as a clean error before the second half spawns`. Overrides `registry.spawnAgent` to resolve `{ status: 'error', message: 'session expired' }`; asserts `success: false`, `error` contains `session expired`, and `spawnFromSdkHandle` not called. Pins `agent-rpc.handlers.ts:883-885`. | `agent-rpc.handlers.resume-parent-session.spec.ts` (no filesystem gate block) |
| B | Added one `it.each` parameterized test over the six `SYSTEM_CLI_TYPES` literals (`codex`, `copilot`, `cursor`, `antigravity`, `opencode`, `pi`). For each: `mockReaddir`/`mockAccess` reject, assert `success: true`, `processManager.spawn.mock.calls[0][0].resumeSessionId === CLI_SESSION_ID`, and both fs mocks never called. Literal array with a comment naming `libs/shared/src/lib/types/agent-process.types.ts:62-69`; no barrel import added. | `agent-rpc.handlers.resume-parent-session.spec.ts` (no filesystem gate block) |
| C | Removed the dead `mockReaddir.mockResolvedValue(['D-ws'])` / `mockAccess.mockResolvedValue(undefined)` setup and its probe comment from the first `beforeEach`; removed the `sessionFileExists` escape comment and matching `['D--ws']` mock setup from the second `beforeEach`; renamed the line-193 test to `preserves the resume and parent session ids on both halves of the ptah-cli resume`. Kept the `jest.mock('fs/promises')` block, the `mockReaddir`/`mockAccess` bindings, all `beforeEach` resets, and the third block's `beforeEach` (not flagged). | `agent-rpc.handlers.resume-parent-session.spec.ts:170-176`, `:193`, `:241-249` |

### Suite result

Command:
```
npx nx run-many -t test -p @ptah-extension/rpc-handlers --skip-nx-cache
```

Header line: `Running target test for project @ptah-extension/rpc-handlers:` (one project).

Totals: `Test Suites: 92 passed, 92 total` / `Tests: 31 skipped, 2705 passed, 2736 total`.

Compared against the prior `2697 passed`: `2705 - 2697 = 8` more passing tests (A1, A2, and six parameterized rows from B). Suite count unchanged at 92; skipped unchanged at 31.

### git diff --stat

```
 ...gent-rpc.handlers.resume-parent-session.spec.ts | 191 +++++++++++++++++++--
 .../src/lib/handlers/agent-rpc.handlers.ts         |  63 +------
 2 files changed, 183 insertions(+), 71 deletions(-)
```

The `agent-rpc.handlers.ts` line is the pre-existing fix under review, present in the worktree's git status at the start of this session (`M libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`). This session edited only `agent-rpc.handlers.resume-parent-session.spec.ts`. No production file was touched by this session.

### Notes

- The `mockAccess.mockRejectedValue(ENOENT)` line inside the renamed C test (formerly describing a probe failure) was left in place. It is now dead setup, but the review's Finding 2 did not list it, and removing it is outside the three bullets C scoped. It does not affect the test outcome — the negative assertions `expect(mockAccess).not.toHaveBeenCalled()` hold either way.
- The third `beforeEach` block (`agent:resumeCliSession from ptah agent-cli resume`, ~line 374) carries the same dead `mockReaddir.mockResolvedValue(['D-ws'])` / `mockAccess.mockResolvedValue(undefined)` setup, but it was not flagged by either review and is out of C's scope. Left untouched.
- The two blocker/nit findings in `ptah-cli-registry.ts` and `agent-process-manager.service.ts` are out of scope and were not touched.
