---
status: in_review
type: bugfix
title: 'A ptah-cli resume discards the user typed follow-up message'
description: >-
  `PtahCliRegistry.spawnAgent` replaces the caller's `task` with the hardcoded
  string "Continue working on the previous task. Pick up where you left off."
  whenever `resumeSessionId` is set. The agent card's follow-up box exists to
  send the user's own words, so on the ptah-cli lane those words never reach the
  model. Found by three independent reviews during TASK_2026_396.
---

# TASK_2026_397 — the ptah-cli follow-up box throws away what you type

## The defect

`libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:682-685`

```ts
const isResume = !!options?.resumeSessionId;
const effectivePrompt = isResume
  ? 'Continue working on the previous task. Pick up where you left off.'
  : task;
```

`effectivePrompt` reaches `createPromptMailbox` at line 688 and the SDK `query`
at line 705. The `task` argument — the user's typed follow-up, passed from
`agent-rpc.handlers.ts:875` — is discarded.

## Why it surfaced now

TASK_2026_396 deleted a filesystem probe that used to set `resumeSessionId` to
`undefined` when a transcript file was missing. That accident set `isResume` to
`false` and let the user's text through as a fresh task. With the probe gone,
`resumeSessionId` is always set, so the substitution always fires.

The defect is older than TASK_2026_396. That change removed its only escape
hatch, so it is now reachable on every ptah-cli resume.

## Evidence of independence

Found separately by the Conductor, by the Ollama Cloud code-review lane
(`code-logic-review.md` Finding 1), and implied by the Codex test-review lane's
Q6 note that no test pins resume prompt content.

## Contrast: the codex lane is correct

`cli-adapter.utils.ts:364` builds `taskPrompt` with `options.task` embedded, so
the user's words do reach the model on every system-CLI lane.

## Scope hint

**CORRECTED after implementation.** The original hint said "do not simply delete
the substitution" and guessed that the canned prompt existed to cover an empty
follow-up. That guess was wrong, and the acceptance sketch built on it was wrong
too. Both are recorded here rather than silently rewritten, because the review
disagreement they caused is the useful part.

There is no empty-task case. `task` is non-empty on every path that can reach
`PtahCliRegistry.spawnAgent`:

| Entry point | Guard |
| ----------- | ----- |
| `agent:resumeCliSession` RPC | `agent-rpc.schema.ts` — `task: z.string().min(1)` |
| MCP `ptah_agent_spawn` | `mcp-stdio/agent-tool.dispatcher.ts:48` — `task: z.string().min(1).max(MAX_TASK_LENGTH)` |
| The follow-up box itself | `agent-continue-input.component.ts:166` — `submit()` returns on `message.length === 0` |

`spawnAgent` is an internal method behind two validated boundaries, so an
empty-string fallback would be exactly the defensive branch the repo standard
forbids ("do not add error handling for scenarios that cannot happen; only
validate at system boundaries"). Deleting the substitution outright is correct.

Blame is uninformative: the line arrives in a squashed release commit
(`chore(release): extension v0.2.32`) with the substitution already present. The
better evidence is `cli-agent-delegation.md:324`, which instructs CALLERS to
pass `"Continue the previous task. Pick up where you left off."` as their task
when resuming. That string was always the caller's to supply, so the registry
hard-coding it was redundant on the intended path and destructive on every other.

## Acceptance sketch

- A ptah-cli resume carrying a non-empty task sends that task to the model.
- A regression test pins it by asserting the exact prompt handed to the SDK. A
  test asserting only that "a prompt was passed" stays green against this bug.

The withdrawn third criterion — "an empty task keeps today's behavior" — asked
for a branch no caller can reach.
