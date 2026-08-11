# Context — TASK_2026_225

## How this was found

While closing `TASK_2026_173`, its DoD item 5 (the NFR-1 cross-project test floor)
required a clean `rpc-handlers` run. That run came back:

```
Test Suites: 1 failed, 73 passed, 74 total
Tests:       1 failed, 31 skipped, 1781 passed, 1813 total
```

The floor itself was met — NFR-1 requires ≥1410 passes from `rpc-handlers` and 1781
clears it with this failure excluded — but the failure is real and needed a home.

## The failure

```
FAIL libs/backend/rpc-handlers/src/lib/chat/session/chat-session-resume-activate.spec.ts

● ChatSessionService — resumeSession activate:true (TS-04)
  › reports activated:true when the session is already live (no autoResume needed)

  expect(received).toBe(expected) // Object.is equality
  Expected: true
  Received: false

  204 |
  205 |   const result = (await svc.resumeSession(params)) as ChatResumeResult;
> 206 |   expect(result.success).toBe(true);
      |                          ^
  207 |   expect(result.activated).toBe(true);
```

It fails on the FIRST assertion — `success` — so `activated`, `activationError` and
`activationErrorCode` on the following lines are never reached and their state is
unknown. Do not assume the activation logic is the fault; the resume itself is
already reporting failure.

The same run also prints:

```
A worker process has failed to exit gracefully and has been force exited.
```

for this file, and the suite takes 18–23s. Whether the leak and the assertion failure
share a cause is unknown and worth checking together — a service that is mid-teardown
or holding an open handle could plausibly produce both.

## Attribution — checked, not assumed

This is **not** fallout from `TASK_2026_173`:

- The file appears in **zero** of that task's 13 commits (`git log --grep` over its
  commit set returns no match for this path).
- Its last three touches are `d7101460b` (`feat(output-styles): surface Claude Code
output styles as a Ptah setting`), `338ad25f3` and `c96cd9ae3`.
- `TASK_2026_173` was scoped to `libs/frontend/editor`, the `vscode-core` git path and
  the Electron watcher. It never went near `chat/session`.

`d7101460b` is the most recent touch and therefore the first place to look, but that is
a lead, not a conclusion.

## Reproduction

```bash
npx nx test rpc-handlers --skip-nx-cache --testPathPattern="chat-session-resume-activate"
```

Deterministic — it fails in isolation, not only in the full suite, which rules out
cross-spec interaction as the cause.

## What the task has to decide

Whether the spec's expectation or the service's behaviour is the wrong one. TS-04
encodes "a session that is already live needs no autoResume and should report
`success: true, activated: true`". If the output-styles work deliberately changed what
`resumeSession` returns on the already-live path, the spec is stale and should be
updated with that reasoning recorded. If it did not, the service regressed. Do not
"fix" this by relaxing the assertion until that question is answered.
