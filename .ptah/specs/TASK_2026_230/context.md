# "bogus snapshot token" control fails on a timeout, not an assertion

## Origin

Surfaced during `TASK_2026_227` (commit `6a4cce435`) while running the editor
e2e specs in a live Electron host. Re-encountered during `TASK_2026_229`.
Both tasks flagged it and deliberately did not expand into it.

## Why this is not just a red test

The case is a **negative control**. It exists to prove the app refuses a
`git:applyHunks` request carrying a stale snapshot token — the guard that
stops a revert from landing on a hunk that has been renumbered since the user
selected it. That guard is load-bearing: `TASK_2026_219` and `TASK_2026_227`
both turned on snapshot-token behaviour being correct.

A control that fails on an `RpcBridge.sendRpc` timeout does not tell you the
guard is broken. It tells you **the guard is currently unverified**. Those are
different, and the second one is easy to mistake for a flaky test and ignore.

## What is known

- The failure is a timeout inside `RpcBridge.sendRpc`, not an assertion
  mismatch. The expected rejection never arrives.
- Confirmed **pre-existing**, not caused by either task that saw it. The
  `TASK_2026_227` agent stashed only its own edit to
  `apps/ptah-electron-e2e/src/support/git-scratch-repo.ts` and reproduced the
  identical timeout at `HEAD`.
- The other two cases in the same spec file pass.
- Neighbouring specs sharing the same harness pass: `glyph-margin-visual`,
  `hunk-widget-mouse`, `hunk-revert-top-layer`.

## What is not known

Which of these it is:

1. **Harness defect** — the bridge's timeout is too short for this path, or
   the request is malformed in a way that never reaches a handler.
2. **RPC defect** — the rejection path returns nothing rather than an error
   envelope, so the caller waits forever. Note the RPC dual-registration rule:
   a method prefix missing from `ALLOWED_METHOD_PREFIXES` at
   `libs/backend/vscode-core/src/messaging/rpc-handler.ts:46` causes a silent
   crash, which is exactly what a hanging caller looks like from the outside.
3. **App defect** — the app genuinely hangs when rejecting a stale token,
   which would be the most serious reading and the one that makes this a
   user-facing bug rather than a test-infrastructure one.

Rule (2) out or in first — it is the cheapest to check and has a known failure
signature that matches the symptom.

## Scope

1. Determine which of the three it is. Do not fix the symptom by raising the
   timeout until you know; a longer timeout on a genuine hang converts a
   visible failure into a slow one.
2. If the guard itself is fine and only the harness is wrong, fix the harness
   and say so plainly — the value here is knowing the guard works.
3. Verify in a live Electron host. This spec only runs there.

## Build note

`TASK_2026_229` (commit `fe70fd689`) changed how the dev renderer is built.
Use `nx copy-renderer-dev ptah-electron`, not `copy-renderer` — the latter is
now the production path and is `package`'s dependency only. `build-dev` no
longer builds the webview at all.
