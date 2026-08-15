# TASK_2026_247 — a config change kills every in-flight permission

Filed 2026-08-15, from a live incident during TASK_2026_180 B3.5. **This has been
diagnosed more than once and re-diagnosed each time**, because the symptom the
model sees is indistinguishable from a decision the user made. That
indistinguishability is half the defect.

## The chain, verified end to end

```
ConfigWatcher watches 'authMethod', 'anthropicProviderId',
  and ANY secret key starting 'ptah.auth.'
    libs/backend/agent-sdk/src/lib/helpers/config-watcher.ts:57-70

  → emitConfigChanged                       config-watcher.ts:121
  → onConfigChanged handler                 sdk-agent-adapter.ts:144
  → sessionLifecycle.disposeAllSessions()   sdk-agent-adapter.ts:148
  → cleanupPendingPermissions()   ← NO sessionId argument
                                            session-control.service.ts:180
  → for EVERY pending request in EVERY session:
      resolve({ decision: 'deny', reason: 'Session aborted' })
                                            sdk-permission-handler.ts:869-873
```

**No user action appears anywhere in that chain.**

## Defect 1 — the cleanup is global, the trigger is not

`endSession(sessionId)` scopes its cleanup to one session
(`session-control.service.ts:120` → the `if (sessionId)` branch at
`sdk-permission-handler.ts:843`, which filters on
`pending.tabId === sessionId || pending.sessionId === sessionId`).

`disposeAllSessions()` passes nothing, taking the `else` branch that walks the
whole map. So an auth-method change in one window denies in-flight permission
requests in every other window, tab and background subagent in the process.

Re-authenticating is a reason to refresh credentials. It is not a reason to deny
a subagent's file read three tabs away. Either scope the disposal to the affected
sessions, or re-auth in place without tearing the world down.

**Cross-session is not hypothetical.** During this same incident a second Ptah
session was demonstrably live — it allocated `TASK_2026_246` at 19:11 while this
session was mid-batch.

## Defect 2 — the reason is laundered before the model sees it

Ptah sets `reason: 'Session aborted'` (`sdk-permission-handler.ts:849, 872`).
What reaches the agent is Claude Code's canned string:

> The user doesn't want to take this action right now. STOP what you are doing
> and wait for the user to tell you how to proceed.

Every agent is instructed — correctly — that a permission denial is a deliberate
user decision, never to be retried or worked around. So on an abort-deny an agent
does the worst available thing: it stops cleanly, reports politely, and waits.
Nothing logs as an error. The only external signal is an agent returning suddenly
with "context gathering only, no files written".

`AbortError: Stream closed` on an in-flight Edit is the same event seen from the
CLI control-request side, already recorded in memory as a benign teardown race
(`session-control.ts` resolves Ptah's side before `query.interrupt()` closes the
stream). Benign for the SESSION; not benign for the agent, which reads it as a
wall.

## Why it looks intermittent

A config change is a one-shot edge. Resume the agent and there is no second edge,
so it works — which is exactly the signature that makes it get re-diagnosed
instead of fixed.

## Suspected aggravator: TASK_2026_180's own feature

Phase 1 of TASK_2026_180 is lane auth routing — `IProviderAuthResolver` snapshots
with `scope: 'lane'`, per-lane provider/model settings, background lanes resolving
credentials off the foreground quota. Anything on that path that writes
`ptah.auth.*` fires this watcher. **The feature may be killing its own background
agents.** Worth confirming: `LaneResolverService` obtains an
`OneShotAuthOverride` and is documented as inert with respect to globals, so it
SHOULD not write a secret — but a token refresh underneath it might.

## What a fix has to do

1. **Scope the permission cleanup to the sessions actually being disposed.** The
   per-session branch already exists and is already used by `endSession`.
2. **Propagate the deny reason to the model.** `interrupted` and `denied` must be
   distinguishable at the tool-result layer. Then the agent rule becomes
   unambiguous: a real deny stops the agent; an abort-deny is retryable, and the
   agent can say which one it hit instead of guessing.
3. **Consider whether an auth change needs `disposeAllSessions()` at all**, or
   whether it can re-initialize credentials without ending live sessions.

## Verification

The failure is reproducible by construction: start a background subagent that
will request a permission, then change `authMethod` or write a `ptah.auth.*`
secret from any window. Expect the subagent to receive a deny it did not earn.
A regression spec belongs beside `session-lifecycle-manager.spec.ts:484`, which
already pins the teardown ORDER — this pins its SCOPE.

## Related

- `libs/frontend/chat-routing/src/lib/stream-router.service.ts:444-448` — a
  SECOND auto-deny path, for prompts arriving on a surface-only conversation.
  `libs/frontend/chat-routing/CLAUDE.md` asserts surfaces "run full-auto with
  auto-allow at the SDK layer". If that assumption is false for background
  subagents, it is the same failure from a different origin. Check it while here;
  do not assume it is the same bug.
