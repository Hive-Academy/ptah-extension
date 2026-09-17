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

**Do not simply delete the warning.** A verification pass already tried that and
found the evidence does not support it. See `resume-support-verification.md` in
this folder for the machine-level results, gathered 2026-09-08.

Verified real on the vendor's own interface:

| CLI | Mechanism | Verified by |
| --- | --------- | ----------- |
| codex | `codex resume [SESSION_ID]` | `codex-cli 0.153.4` help |
| copilot | `-r, --resume[=value]` | `GitHub Copilot CLI 1.0.80` help |
| antigravity | `--conversation <id>` | `agy 1.1.27` help |
| ptah-cli | SDK `resume` option | `claude 2.1.259` help + SDK 0.3.150 |

NOT verified, because the binary is absent on the verification machine:
`opencode`, `pi`, `cursor`.

**`pi` is the specific risk.** `pi-cli.adapter.ts:57-59` and `:366-368` record,
in the source itself, that `--session` is known only from the interactive flag
table and may NOT be honored in `--mode rpc`. If it is not, then the warning was
CORRECT for pi and deleting it removes a true signal.

Also relevant: `ptah-cli` never reaches this block at all — its registry route
bypasses `doSpawnSdk`, so the warning never fired for it.

What would settle it: run `pi --mode rpc --session <finished-session-id>` and
`opencode run --session <finished-session-id>` against real finished sessions and
observe whether prior history is retained. Until then, the honest change is to
correct the message rather than remove the signal — the text asserts
"does not support session resume", which is a definitive claim the code cannot
make for any CLI it has not tested.

## Acceptance sketch

- A codex resume logs no warning claiming resume is unsupported.
- Any adapter that genuinely ignores `resumeSessionId` still warns, or the
  warning is removed entirely with a note saying why.
- A test pins whichever rule is chosen.
