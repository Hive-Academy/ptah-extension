# P5 backend fix round — TASK_2026_719 (findings 1 and 2 of code-logic-review-p5-backend.md)

Worktree: `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts`. Four files changed, no others. Nothing committed.

## Fix 1 (Serious) — late PID after kill grace

**Change**: `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:503-505` (`run()` → `stop()` → `whenSpawned.then`).
`if (settled) return undefined;` became `if (settled && (!receipt || receipt.closed)) return undefined;`, with a comment explaining the two settled cases:
- Settled with no receipt means the child closed, so no kill is needed.
- Settled with an unclosed receipt means the grace ran out before the PID arrived. `killProcessTree(pid, 'SIGKILL')` is then still requested.

The null-PID branch and the existing `degradation-audit: optional-capability` catch are unchanged.

**New spec cases**: `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ambient.spec.ts`. The fake `Child` now takes its `whenSpawned` promise as a constructor argument. A `nextWhenSpawned` variable lets a spec defer it. `killProcessTree` is still faked through the file's existing `jest.mock('@ptah-extension/platform-core', ...)`; there is no `spyOn`.
- `:121` "still requests the tree kill when the PID arrives after the kill grace (unclosed receipt)". The PID is deferred, the 10 s limit and the 2 s grace run, the receipt is open and no kill has happened yet. The PID then resolves and the spec asserts `killProcessTree(4321, 'SIGKILL')`. A later close marks the receipt closed.
- `:136` "requests no tree kill when the child closed before a late PID arrives". The PID is deferred, the timeout stops the child, and the child closes, so the run is settled with no receipt. The PID then resolves and the spec asserts `killProcessTree` was not called.

## Fix 2 (Moderate) — one env snapshot per attempt

**Change**: `libs/backend/auth-providers/src/lib/accounts/claude-ambient-login-status.ts`.
- `:83`: `Attempt` gains `readonly env`, the snapshot its key was derived from.
- `:177-178`: `start()` takes one snapshot with `ambientProbeEnv(this.host.env())` and derives the key from it with the new `keyOf(env)`.
- `:196` and `attempt(env, signal)`: the status child receives `attempt.env`. The post-certification re-read of `this.host.env()` is removed.
- `:259`: `keyOf(env)` holds the digest and the stale-cache clearing that `currentKey()` had. `currentKey()` now delegates to it, so `enqueue`/`finish` still compare against the live environment.

All other contracts are unchanged: same-key join, one queued follow-up, abort-and-await of a different-key attempt, retained receipts blocking spawns, the 25 s deadline (unknown/timeout/null) and the 60 s cache.

**New spec case**: `libs/backend/auth-providers/src/lib/accounts/claude-ambient-login-status.spec.ts:349` "probes with the env snapshot its key came from when the env changes A to B to A during certification". `FakeCommands` gains an optional `certifyGate` to defer certification.
1. The read starts under env A.
2. The env becomes B, and certification is released while B is current.
3. The spec asserts the child received `ambientProbeEnv(A)`, not B.
4. The env returns to A and the probe resolves signed-in.
5. The returned status is `connected` with the completion timestamp. A second read is served from the cache under key A without a new probe.

## Verification

- Focused jest under the lock:
  `node scripts/verify.mjs --exec --task fix-jest -- npx jest -c libs/backend/auth-providers/jest.config.ts <both specs>`
  → `Test Suites: 2 passed, 2 total; Tests: 33 passed, 33 total`, exit 0.
- Red check: with both source fixes temporarily reverted (then restored and confirmed identical with `cmp`), the same run gave `Tests: 2 failed, 31 passed`. The new late-PID kill case and the env-snapshot case fail on the old code, so they guard these regressions.
- `ptah_get_diagnostics` on the four files: 0 errors, 0 warnings.
- Not run, as the brief instructs: `npm run verify`, lint, the project typecheck, and the wider auth-providers suite.

## Deviations

None. No `any`, no `as unknown as`, no `@ts-ignore`, no `console`, and no new logging.

## Open points

- Fix 1 also kills when the receipt was disposed but never closed, because disposed is not closed. That is the conservative choice, since no close has proved termination.
- Lint and the full `auth-providers` test/typecheck targets should run in the coordinator's `npm run verify -p @ptah-extension/auth-providers` pass.
