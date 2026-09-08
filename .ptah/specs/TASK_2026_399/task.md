---
status: backlog
type: bugfix
title: 'The follow-up box hides on continuation support when resume would serve'
description: >-
  `AgentContinueInputComponent.visible` renders the follow-up box only when
  `supportsContinuation === true`. The antigravity and opencode adapters never
  declare that capability, so their finished agents show no follow-up box at
  all — even though every adapter honors `resumeSessionId` and the session is
  perfectly resumable. The box is gated on the wrong capability.
---

# TASK_2026_399 — follow-up is disabled for agents we could resume

## The gate

`libs/frontend/chat/src/lib/components/molecules/agent-continue-input/agent-continue-input.component.ts:102-104`

```ts
protected readonly visible = computed(
  () => this.agent().supportsContinuation === true,
);
```

`supportsContinuation` means "this agent's live process can take another turn".
It does NOT mean "this conversation can be picked up again". Those are different
capabilities and the box conflates them.

## Capability by adapter

| CLI | `supportsContinuation` | source | resume mechanism |
| --- | ---------------------- | ------ | ---------------- |
| codex | `() => true` | `codex-cli.adapter.ts:737` | `codex.resumeThread` |
| cursor | `() => true` | `cursor-cli.adapter.ts:386` | `sdk.Agent.resume` |
| ptah-cli | `() => true` | `ptah-cli-registry.ts:821` | SDK `resume` option |
| copilot | `() => capturedSessionId != null` | `copilot-sdk.adapter.ts:453` | `--resume=<id>` |
| pi | `() => capturedSessionId != null` | `pi-cli.adapter.ts:505` | `--session <id>` |
| **antigravity** | **never declared** | — | `--conversation <id>` (`antigravity-cli.adapter.ts:462`) |
| **opencode** | **never declared** | — | `--session <id>` (`opencode-cli.adapter.ts:411`) |

Every adapter accepts a resume id. Two of them can never show a follow-up box.
Two more hide it whenever their session id was not captured.

## User-visible effect

A finished antigravity or opencode agent offers no way to send a follow-up. The
conversation is resumable and the backend would honor it — the UI simply never
offers it. Reported by the user: "some of the cli agent is truly disabled send
follow up where we can easily resume all".

## Proposed gate

Show the box when the agent can be continued OR resumed:

```ts
protected readonly visible = computed(
  () =>
    this.agent().supportsContinuation === true ||
    !!this.agent().cliSessionId,
);
```

`resumesInstead` (line 133) and the existing `sendByResuming` path already
handle the resume-only case, including the subtitle "Send a follow-up — resumes
the session". Widening `visible` reuses machinery that is already there.

## Secondary, latent

`agent-continue-input.component.ts:223` falls back to resume only on
`not_found` and `released`:

```ts
} else if (result.code === 'not_found' || result.code === 'released') {
  await this.sendByResuming(message);
} else {
  this.error.set('Could not send the follow-up. Try again.');
}
```

`AgentContinueError` also defines `'unsupported'`
(`agent-process-manager.service.ts:92-103`, thrown at `:1025`). Today the
`visible` gate mostly hides that path, but once `visible` widens as proposed
above, `'unsupported'` becomes reachable and MUST join the fallback list.
Fixing `visible` without this leaves a dead end where the box appears and every
send fails.

## Acceptance sketch

- A finished antigravity or opencode agent with a `cliSessionId` shows the
  follow-up box, and sending resumes the session.
- An agent with neither continuation support nor a `cliSessionId` still shows
  no box — there is no path, and offering one would lie.
- `'unsupported'` routes to the resume fallback.
- Tests pin all three.
