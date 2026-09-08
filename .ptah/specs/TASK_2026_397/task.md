---
status: backlog
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

Do not simply delete the substitution. The canned prompt presumably exists
because an empty follow-up needed something to send. Establish what a resume
with an EMPTY task should do before changing the branch. A likely shape: use the
user's task when it is non-empty, and fall back to the canned string only when
it is not.

## Acceptance sketch

- A ptah-cli resume carrying a non-empty task sends that task to the model.
- A ptah-cli resume carrying an empty task keeps today's behavior.
- A regression test pins both, asserting the prompt actually handed to the SDK.
