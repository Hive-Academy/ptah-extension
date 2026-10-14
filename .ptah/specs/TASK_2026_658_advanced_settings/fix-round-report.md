# Fix round: code-logic-review.md findings 1 and 2

Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-advanced-settings-ui` (branch
feat/advanced-settings-ui). Scope comes from the last entry of `decisions.md` (2026-10-14, codex review fix
round). Only two files changed: `advanced-settings-group.component.ts` and its `.spec.ts`. There are no
template, class-string or style changes. Finding 3 was deferred as instructed and is not touched. Nothing
was committed.

Paths below are relative to `libs/frontend/chat/src/lib/settings/advanced/`.

## Finding 1 (Serious): backend error text was shown under the field

**Change**: `advanced-settings-group.component.ts`
- In `write()` (~:420-457), the `refusal` state is gone, along with the code that read
  `result.data?.error` (dead state removed). The `rpcCall` type argument is now `{ success: boolean }`, so
  the backend `error` field is never read.
- :454 now calls `this.setError(key, message)`. On `success:false` or an exception, the field shows the
  same fixed string as the status line: "Could not save {label}. The saved setting is unchanged." On a
  timeout it shows "Could not confirm saving {label}. Reopen settings to see the saved value." (this was
  already the behaviour). A comment there explains why host text is never rendered.
- Client validator messages in `edit()` and `commit()` are unchanged. They are our own text.

**Spec**: `advanced-settings-group.component.spec.ts:391`. This test replaces the old "shows the host
refusal under the field" test, which asserted the behaviour this finding removes. The backend returns
`{success:true, data:{success:false, error:'SENTINEL-SECRET-7f3a at /home/someone/.ptah/settings.json'}}`.
The test asserts:
- the sentinel is in neither `textContent` nor `innerHTML` of the host;
- the field error and the status line both contain the fixed string;
- the typed text `8` stays in the field and the stored value is unchanged.

## Finding 2 (Serious): a host that never becomes ready left the group Loading forever

**Change**: `advanced-settings-group.component.ts`
- :28-32: the `SETTINGS_READ_TIMEOUT_MS` doc now says it also bounds `rpcCall`'s readiness wait, which has
  no timeout of its own.
- :283-288: new field `readDeadline`. A constructor registers `inject(DestroyRef).onDestroy(() =>
  clearTimeout(this.readDeadline))`, following the pattern in `settings-save-feedback.service.ts:90`.
- :294-321, `reload()`: the reads still go through `Promise.all` with each `rpcCall` given its 5 s timeout.
  The method now:
  - clears any earlier deadline;
  - starts one 5 s deadline promise that resolves `null`;
  - runs `await Promise.race([reads, deadline])`, then clears the timer once the race settles;
  - shows the load error with Retry when the result is `null` (the deadline won) or any read failed.
- `rpc-call.util.ts` is not changed.

**Spec**: `advanced-settings-group.component.spec.ts:183`. It uses fake timers, and every `rpcCall` returns
a promise that never settles. The test checks these steps:
1. Loading is shown first.
2. At 4999 ms there is no Retry.
3. At 5000 ms Loading is gone and Retry is shown.
4. Clicking Retry starts a new deadline, so the group is `loading` again.
5. After `fixture.destroy()`, advancing 5 s leaves the group `loading`. This proves the destroy hook
   cleared the deadline.

**Mutation check**: I removed the `onDestroy` clear and ran this test. It failed with `Expected: "loading",
Received: "error"`, so the test catches a timer that outlives the component. Then I restored the line.

## Verification (from the worktree)

- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/settings/advanced/advanced-settings-group.component.spec.ts --coverage=false --maxWorkers=2`
  -> `Tests: 32 passed, 32 total`.
- `npx eslint <both files>` -> exit 0, no output.
- `npx prettier --write <both files>` -> both "(unchanged)" on the final pass.
- No nx, build, serve or e2e commands were run, and no git state was changed.

## Decisions

- **The field shows the fixed status string, not just the status line.** The task asked for "the card's
  fixed status string". Showing it under the field keeps `aria-invalid` and `aria-describedby` pointing at
  a message next to the control, as before. It is the same text as the status line.
- **One deadline per group read, not one per key.** A single `Promise.race` around `Promise.all` is the
  smallest change that bounds the readiness wait. All keys share the same readiness promise, so per-key
  deadlines would add nothing.
- **Late results are ignored once the deadline wins.** If the host becomes ready after 5 s, the earlier
  `rpcCall` promises settle into a race that has already resolved, so they cannot overwrite the error
  state. Retry runs a fresh read.
- **The old host-refusal spec was replaced, not kept.** It asserted the exact behaviour that finding 1
  removes.
- **The destroy test asserts behaviour, not a timer count.** `jest.getTimerCount()` also counts timers
  that zone.js and Angular create during a click, so an exact count was flaky. The test checks instead
  that a destroyed group's deadline never fires.
- **Finding 3 (a malformed successful read) is deferred**, per `decisions.md`.
