---
status: backlog
type: bugfix
title: 'AgentProcessManager warns that codex cannot resume, which is false'
description: >-
  `agent-process-manager.service.ts` logs a warning saying the CLI "does not
  support session resume" for every non-copilot resume. Codex does support
  resume through `codex.resumeThread`. After TASK_2026_396 the warning fires on
  every codex resume, so a working path now emits a false alarm on every use.
---

# TASK_2026_398 — a false "does not support session resume" warning

## The defect

`libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:461-465`

```ts
if (request.resumeSessionId && request.cli !== 'copilot') {
  this.logger.warn(
    `[AgentProcessManager] resume_session_id provided for ${request.cli} which does not support session resume`,
  );
}
```

The claim is false for codex. `codex-cli.adapter.ts:640-641` calls
`codex.resumeThread(options.resumeSessionId, threadOptions)` precisely when
`resumeSessionId` is set, and resume works.

## Why it matters now

Before TASK_2026_396, a codex resume only reached this line when a
`~/.claude/projects` transcript happened to exist. That probe is gone, so
`resumeSessionId` is now always set and this warning fires on **every** codex
resume. A correct, working path now logs a warning claiming it cannot work.

Found by the Ollama Cloud code-review lane during TASK_2026_396
(`code-logic-review.md` Finding 4), verified by the Conductor.

## Scope hint

The condition is a stale allowlist. Determine which adapters genuinely ignore
`resumeSessionId` today, rather than inverting the test around `copilot` again.
Read each adapter's use of the field. Codex and ptah-cli both honor it. If every
current adapter honors it, delete the warning rather than repair it.

## Acceptance sketch

- A codex resume logs no warning claiming resume is unsupported.
- Any adapter that genuinely ignores `resumeSessionId` still warns, or the
  warning is removed entirely with a note saying why.
- A test pins whichever rule is chosen.
