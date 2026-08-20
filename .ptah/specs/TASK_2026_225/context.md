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

---

## Resolution — 2026-08-11

**The spec was stale. The service is correct. Fixed by completing the mock.**

### The lead in "Attribution" above was wrong

That section named `d7101460b` (`feat(output-styles)`) as the first place to look,
on the strength of it being the file's most recent touch. It was not the cause.
`git log -S "hasLiveSessionStream"` names the real one:

```
5cff0927a fix(chat): stop follow-up turns hanging on a session whose stream already died
```

"Most recently touched" and "what broke it" are different questions. The `-S` pickaxe
over the symbol in the _service_ answered it immediately; the log over the _spec_ never
could have.

### Root cause

`5cff0927a` introduced `hasLiveSessionStream` (`chat-session.service.ts:933`):

```ts
private hasLiveSessionStream(sessionId: SessionId, tabId: string): boolean {
  if (!this.sdkAdapter.isSessionActive(sessionId)) return false;
  return (
    this.streamBroadcaster.isStreaming(sessionId as string) ||
    this.streamBroadcaster.isStreaming(tabId)
  );
}
```

The spec's `streamBroadcaster` mock only ever defined `streamEventsToWebview`. So
`this.streamBroadcaster.isStreaming` was `undefined`, calling it threw a TypeError, and
`resumeSession`'s outer catch turned that into `{ success: false, error: … }`.

That is why the failure landed on `expect(result.success).toBe(true)` — the FIRST
assertion — and why `activated` was never reached. It also explains why only this one
of the file's three tests failed: the other two pass `isSessionActive: false`, which
returns at the guard clause above before the missing method is ever touched. The
mock gap was invisible until a test drove the active path.

### Fix

`chat-session-resume-activate.spec.ts` — added `isStreaming` to the broadcaster mock,
parameterised through `makeService` and defaulting to `false`, then set to `true` in the
already-live test. The default matters: active-but-not-streaming is a genuinely different
branch (the record is treated as a corpse, torn down via `endSession`, and resumed for
real), so defaulting to `true` would have quietly mislabelled the other two tests.

No production code changed. The service behaviour `5cff0927a` introduced is deliberate
and is left exactly as it is.

### The worker leak was a separate thing

The carrier suspected the "worker process has failed to exit gracefully" warning might
share a cause. It does not. Run alone with `--detectOpenHandles`:

```
npx jest --runTestsByPath src/lib/chat/session/chat-session-resume-activate.spec.ts --detectOpenHandles
→ 3 passed, no warning, no handles reported
```

The warning belongs to some other spec in the full-suite run. Not pursued here; this
carrier's scope was the failing assertion.

### Verification

| Command                                         | Result                                    |
| ----------------------------------------------- | ----------------------------------------- |
| `nx test rpc-handlers --skip-nx-cache`          | **74/74 suites, 1782 passed**, 31 skipped |
| single spec, `--detectOpenHandles`              | 3 passed, clean                           |
| `nx run-many -t lint typecheck -p rpc-handlers` | green                                     |

Suite went from 1781 passed / 1 failed to 1782 passed / 0 failed — the delta is exactly
the one test, with nothing else disturbed.
