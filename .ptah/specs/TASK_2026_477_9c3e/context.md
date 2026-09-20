# TASK_2026_477 — two-way messaging guidance, on both sides of the spawn

## Why this was held until now

The question that started this ("should we tell the agents how to address
two-way messaging?") was asked before TASK_2026_465, 466 and 467. It was
deliberately not filed then. Writing a rule that says "a message reaches a busy
lane" while defect 1 was open would have shipped a false instruction, and an
agent that trusts a false rule fails worse than one with no rule.

Those three tasks are now implemented. The rules would describe real behaviour.

## The gap, measured

### The child side has NO guidance at all

`buildTaskPrompt` (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:512`)
composes everything a spawned CLI agent is told. In order: the system context or
project guidance, the role block, `NATIVE_AGENT_TOOL_POLICY`, the task, the file
list, and the deliverable path.

Not one word about:

- `ptah_agent_report` — that the agent CAN report back, that it takes no agent
  id, and that a `delivered: false` answer with a reason is a normal outcome
  rather than a failure to retry.
- That a message can arrive DURING its run, what it looks like when it does, and
  that it must be treated as an instruction from the session that spawned it.
- That the agent may itself be a parent — `ptah_agent_spawn` is reachable from a
  spawned lane, and the 3-tier hierarchy depends on that.

### The parent side is documented but drifting

`libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts:210-235`
carries the tool table. It is good, and two things in it need review against the
runtime as it now stands:

- The `ptah_agent_message` row names the four modes and warns that
  `interrupt-resume` discards partial work. Correct. It also says to check
  `ptah_agent_list` for a lane's capability. After TASK_2026_465 the antigravity
  capability is now a runtime PROBE of the installed binary, not a fixed
  property, so the advice is more load-bearing than when it was written.
- Nothing tells the parent that a message to a busy ptah-cli lane is now ECHOED
  into that lane's tile (TASK_2026_466 defect 1), which is the observable that
  makes "did it arrive?" answerable.

### `.claude/skills/agent-lanes/SKILL.md`

Holds the lane contract (never review your own work, cross-family review, revise
cap). It mentions messaging at one line. It should carry the same facts as the
prompts, and must not become a third divergent copy.

## Scope

1. A two-way messaging section in the CHILD prompt, added through
   `buildTaskPrompt` so every adapter gets it on its own role channel. It must
   survive the codex path, which strips the role from the task prompt and
   delivers it as `developer_instructions`.
2. A review pass on the parent-side section for drift against the three landed
   tasks.
3. One source of truth. Three copies of this text WILL diverge — decide where it
   lives and have the other two reference it.

## Constraints that already bind this text

- **Name no vendor.** `vendor-roster-drift.spec.ts` exists because a roster in a
  prompt goes stale between releases. The existing parent-side text handles this
  correctly and says so: "A vendor named in any document — including this one —
  is an illustration, never a guarantee it exists here." The new section must
  hold the same line.
- **Every spawned agent pays for this text on every turn.** The child prompt is
  argv or stdin on six adapters and is already near a command-line budget on the
  `.cmd` path (`assertCommandLineWithinLimit`, 8,191 on a Windows `.cmd`
  fallback). Measure the added bytes; do not write a page.
- **Do not describe a mode as available.** `ptah_agent_message` picks per call
  from live capabilities. The text must tell the agent to read the returned mode,
  never to assume one.

## Adjacent defect found while filing this

`buildTaskPrompt:541` tells every agent:

```
Use convention: {taskFolder}/agent-output-{agentId}.md for main deliverable.
```

Lanes keep writing `agent-output-root.md`, so `{agentId}` is resolving to the
literal `root` on some path. Two such files have been deleted by hand during
TASK_2026_466 and TASK_2026_465. Either the id is not being substituted, or the
instruction competes with the explicit filename most prompts already give, and
the agent writes both. Worth one look before writing more prompt text into the
same builder.

## Acceptance criteria

1. A spawned agent, asked in its task to report back, calls `ptah_agent_report`
   without being told how in the task text.
2. A message sent to a running lane is acted on, and the agent does not treat a
   refusal reason as an error to retry.
3. The three copies of the guidance agree, or two of them reference the first.
4. No vendor name appears in any of the added text.
5. The added child-prompt bytes are measured and recorded.
