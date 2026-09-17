# TASK_2026_399 / TASK_2026_397 — regression test report

## Tests added

| Name | File:line | Behaviour pinned |
| --- | --- | --- |
| renders the box when supportsContinuation is absent but a cliSessionId exists | `libs/frontend/chat/src/lib/components/molecules/agent-continue-input/agent-continue-input.component.spec.ts:269` | `visible` widened to `cliSessionId` — the antigravity/opencode case (TASK_2026_399). |
| renders nothing when neither supportsContinuation nor a cliSessionId is present | `libs/frontend/chat/src/lib/components/molecules/agent-continue-input/agent-continue-input.component.spec.ts:276` | `visible` still closed when there is no path — paired guard against a box that lies. |
| resumes instead of continuing when continuation is unsupported but a session exists | `libs/frontend/chat/src/lib/components/molecules/agent-continue-input/agent-continue-input.component.spec.ts:284` | `resumesInstead` for a resume-only agent: subtitle reads "resumes the session" and `deliver()` skips `continueAgent` and calls `resumeAgentWithMessage` with the message. |
| still continues directly when continuation is supported and not expired | `libs/frontend/chat/src/lib/components/molecules/agent-continue-input/agent-continue-input.component.spec.ts:300` | `resumesInstead` unchanged for a live agent: subtitle is plain "Send a follow-up" and `continueAgent` IS called. Paired isolation for the test above. |
| falls back to resume when continue answers unsupported, carrying the message | `libs/frontend/chat/src/lib/components/molecules/agent-continue-input/agent-continue-input.component.spec.ts:316` | The `'unsupported'` code routes to `sendByResuming` with the user's message, not the generic error branch. |
| hands the SDK the caller task, not the canned resume string, when resumeSessionId is set | `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-spawn-model.spec.ts:298` | `spawnAgent` passes the caller's `task` to the SDK prompt generator when `resumeSessionId` is set (TASK_2026_397). |

## Backend coverage

The existing `PtahCliRegistry` spec are split across nine files. Only
`ptah-cli-registry-spawn-model.spec.ts` drives the real `spawnAgent()` up to the
SDK `queryFn()` call and captures the args handed to the SDK. No existing spec
covered `spawnAgent`'s prompt construction; every other spec stubs the SDK
surface at a different seam.

That spec's harness already built a working `PtahCliRegistry` with a mocked
`queryFn` that captured `args.options`. The prompt is the sibling argument
`args.prompt` (an `AsyncGenerator<SDKUserMessage>` built by
`createPromptMailbox`). The harness was extended with one capture field
(`getCapturedPrompt`) and one new describe block. The new test calls
`spawnAgent` with a `resumeSessionId` and a non-empty `task`, pulls the first
message out of the captured generator, and asserts `message.content` equals the
caller's `task` exactly. A test that only asserted "a prompt was passed" would
stay green against the canned-string bug; this one asserts the literal text.

The harness already exists and the SDK mock is light, so the test was practical
to write honestly.

## Mutation check

### Step 1 — revert `visible` to `supportsContinuation === true`

Edit applied to `agent-continue-input.component.ts:102`:

```ts
protected readonly visible = computed(
  () => this.agent().supportsContinuation === true,
);
```

Test 1 (`renders the box when supportsContinuation is absent but a cliSessionId exists`) FAILED:

```text
expect(received).not.toBeNull()

Received: null

  272 |       expect(fixture.nativeElement.querySelector('textarea')).not.toBeNull();
```

Reverted exactly.

### Step 2 — remove `'unsupported'` from the fallback list

Edit applied to `agent-continue-input.component.ts:227`:

```ts
} else if (
  result.code === 'not_found' ||
  result.code === 'released'
) {
```

Test 5 (`falls back to resume when continue answers unsupported, carrying the message`) FAILED:

```text
expect(resumeAgentWithMessage).toHaveBeenCalledWith(...)

  Number of calls: 0

  330 |       expect(resumeAgentWithMessage).toHaveBeenCalledWith(
```

Reverted exactly.

### Step 3 — restore both, confirm green

Both files restored to their pre-mutation content. Full suite re-run confirmed
green (see "Suite result"). `git diff` on the two production files shows only
the original branch fix lines, no leftover mutation.

## Suite result

Command:

```text
npx nx run-many -t test -p @ptah-extension/cli-agent-runtime @ptah-extension/chat --skip-nx-cache
```

Header:

```text
NX   Running target test for 2 projects:
```

Totals vs baseline:

| Project | Baseline | After | Delta |
| --- | --- | --- | --- |
| `@ptah-extension/cli-agent-runtime` | 661 passed / 1 skipped / 662 total | 662 passed / 1 skipped / 663 total | +1 test |
| `@ptah-extension/chat` | 1010 passed / 2 skipped / 1012 total | 1015 passed / 2 skipped / 1017 total | +5 tests |
| Combined | 1671 passed / 3 skipped / 1674 total | 1677 passed / 3 skipped / 1680 total | +6 tests |

Failures: none. The command exited with code 0.

## Gaps

None.

## Finding 3 closed

The MEDIUM finding in `test-review.md` is closed by one new test. No production
code was changed.

### Test added

| Name | File:line |
| --- | --- |
| `queues a follow-up while a resume-only agent is running, then flushes it by resume at turn end` | `libs/frontend/chat/src/lib/components/molecules/agent-continue-input/agent-continue-input.component.spec.ts:338` |

The test builds the combination nothing else exercised:
`supportsContinuation: undefined` + `cliSessionId: 'sess-a'` + `status: 'running'`
(a resume-only agent that is still working — the antigravity/opencode case the
widened `visible` gate newly exposes).

It asserts, in order:

1. The box IS visible while the agent is running (the widened gate at
   `agent-continue-input.component.ts:102-106`).
2. After `submit()`, the follow-up is QUEUED — `continueAgent` and
   `resumeAgentWithMessage` are both NOT called yet, and the draft is cleared
   (the queue path at `:169-171` / `:194-200`).
3. The agent then leaves `running`, and the `flushOnIdle` effect (`:120-126`)
   delivers the queued message via `resumeAgentWithMessage` with the exact text
   `'my real follow up'`, because `resumesInstead()` is true. `continueAgent`
   is never called at any point.

### Flush mechanism reused

The flush is driven the SAME way the existing `TASK_2026_294` queue tests do it
at `agent-continue-input.component.spec.ts:131-146` (`sends the queued message
once the agent leaves running`): update the component's `agent` input to a
non-running status, call `fixture.detectChanges()` so the `flushOnIdle` effect
fires, then `await Promise.resolve()` to settle the async delivery. No new
mechanism was invented. The `setup(...)` helper (`:33-49`) is reused; no
competing harness was added.

### Mutation result

Mutation: `agent-continue-input.component.ts:126` changed
`void this.deliver(pending);` to `void Promise.resolve(pending);` — the flush
drops the queued message instead of delivering it.

The new test FAILED, verbatim:

```text
  ● AgentContinueInputComponent › resume-only agents with a cliSessionId (TASK_2026_399) › queues a follow-up while a resume-only agent is running, then flushes it by resume at turn end

    expect(jest.fn()).toHaveBeenCalledWith(...expected)

    Expected: ObjectContaining {"agentId": "agent-1"}, "my real follow up"

    Number of calls: 0

      378 |       // at any point — a regression that stranded the message or routed it to
      379 |       // continueAgent fails here.
    > 380 |       expect(resumeAgentWithMessage).toHaveBeenCalledWith(
          |                                      ^
      381 |         expect.objectContaining({ agentId: 'agent-1' }),
      382 |         'my real follow up',
      383 |       );

      at src/lib/components/molecules/agent-continue-input/agent-continue-input.component.spec.ts:380:38
```

Suite totals under the mutation: `4 failed, 2 skipped, 1012 passed, 1018 total`
(the mutation also breaks the existing `TASK_2026_294` flush tests, as expected —
they share the same `deliver(pending)` call).

### Component restored

`agent-continue-input.component.ts:126` restored to `void this.deliver(pending);`.
Full suite re-run after restore:

```text
Test Suites: 64 passed, 64 total
Tests:       2 skipped, 1016 passed, 1018 total
```

`git diff` on the component file shows no leftover mutation.

### Suite totals vs baseline

Baseline for `@ptah-extension/chat`: 1015 passed / 2 skipped / 1017 total.

After adding the one test: 1016 passed / 2 skipped / 1018 total — one test
added, nothing regressed.

```text
npx nx run-many -t test -p @ptah-extension/chat --skip-nx-cache
```

Header names ONE project: `Running target test for project @ptah-extension/chat`.
