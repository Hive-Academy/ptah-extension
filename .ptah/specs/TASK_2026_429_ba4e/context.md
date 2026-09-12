# Context — TASK_2026_429_ba4e

## How this was found

On 2026-09-12 a single orchestration session spawned six agents: four in-process
subagents and two CLI agents, plus a third CLI agent for an unrelated CI fix.
Every one of them completed its work correctly and wrote its report to disk.

The lifecycle reporting was wrong about three of them, in three different ways.

This is not a report about agents failing. It is a report about the system
lying about agents that succeeded.

---

## Defect 1 — a completed agent vanishes from the registry

**Observed three times**, on two different CLI families.

| Agent        | CLI                     | Task                       | What `ptah_agent_status` returned |
| ------------ | ----------------------- | -------------------------- | --------------------------------- |
| `b5b46ca0-…` | antigravity             | Batch 11.1 facade          | `Agent not found`                 |
| `f3cc215d-…` | ptah-cli (ollama cloud) | Batch 11.2 picker          | `Agent not found`                 |
| `19f4d943-…` | antigravity             | Batch 11.3 send affordance | `Agent not found`                 |

The exact message:

> Agent not found: `<id>`. This host holds no record under that id — neither a
> live agent nor one restored from persisted session state. The id is from a run
> that was never persisted, or from one older than the retention window.
> Retrying cannot recover it: spawn a new agent if the work still needs doing.

**Every one of those statements was false.** In all three cases the agent had
finished seconds or minutes earlier, and its output was on disk:
`peer-session.facade.ts`, `peer-session-picker/`, `peer-session-send/`, and a
report file each. The id was minutes old, not past any retention window.

A bare `ptah_agent_status` with no id, issued in the same minute, listed a
different still-running agent correctly. So the registry was alive; these
records were simply gone from it.

**The cost:** the message ends with explicit advice — _"spawn a new agent if the
work still needs doing"_. An orchestrator that followed it would re-run finished
work, and on a shared worktree a second writer would collide with the first
one's committed output. The only reason that did not happen here is that the
orchestrator distrusted the tool and checked `git status` instead.

### Acceptance criteria

1. A completed agent remains queryable by id for a stated retention window, and
   that window is documented where a caller can find it.
2. If a record genuinely cannot be found, the message stops asserting WHY. It
   currently offers three confident explanations and picked the wrong one three
   times out of three.
3. The "spawn a new agent" advice is removed or made conditional. Advising a
   re-run of work that may already be complete is the most expensive part of
   this defect.

---

## Defect 2 — a completed agent never exits

**Observed once.** Agent `06529ee4-…`, codex, on the pull request #494 CI fix.

The agent produced its final report, wrote its changes, and printed a complete
summary ending in "No commit or push was performed." Then it kept running.
`ptah_agent_status` reported `running` indefinitely, and the host UI showed
_"Agent is working — your message queues until it finishes"_, so the caller was
blocked behind an agent with nothing left to do.

`ptah_agent_stop` terminated it cleanly and returned `Exit Code: N/A`.

This is the mirror image of Defect 1. There, a finished agent disappeared. Here,
a finished agent never admitted it was finished. Both are the same missing
signal: **"this agent is done"** is not reliably produced or consumed.

### Acceptance criteria

1. An agent that has produced its final output transitions to `completed`
   without operator intervention.
2. If a CLI adapter cannot detect completion for a given vendor, that limit is
   stated in `ptah_agent_status` output rather than shown as `running`.
3. A caller is never blocked indefinitely behind an agent that has finished.

---

## Defect 3 — a completed run hangs forever, with no diagnostic

**Observed once**, and it cost about twenty minutes.

A subagent running `jest --runInBand` finished its tests — the output ends with
`Ran all test suites.` and `Jest did not exit one second after the test run has
completed.` — and then held the process open on a leaked async handle. Measured:
`CPU 275.09s` on two samples twelve seconds apart, zero delta, 1.2 GB resident,
no child processes. Alive, blocked, computing nothing.

Nothing reported this. Not the agent, not the status tool, not a timeout. The
only way it was found was sampling the process CPU by hand and seeing it flat.

**The underlying handle leak is already filed as `TASK_2026_427_f669`** together
with its root cause (`copy-wasm` resolving `node_modules` against a worktree
root that has none, which pushes agents onto the raw-jest path in the first
place). That part is not duplicated here.

What belongs HERE is the observability half: a spawned agent that is not
consuming CPU and not producing output is indistinguishable, from the outside,
from one that is thinking hard.

### Acceptance criteria

1. A spawned agent that produces no output and consumes no CPU for a bounded
   period is surfaced as such, rather than silently reported as `running`.
2. Whatever the mechanism, an operator can tell "stuck" from "working" without
   sampling process CPU by hand.

---

## Why these are one task and not three

They share a root: **the lifecycle signal is unreliable in both directions.**
A finished agent can vanish, a finished agent can appear to run forever, and a
stuck agent looks exactly like a working one. Fixing any one of them in
isolation leaves a caller still unable to answer "is this agent done?" — which
is the only question the tool exists to answer.

The evidence is six spawns in one session. That is a small sample, but the
failure rate within it is high enough that the orchestrator abandoned the tool
mid-session, which is the outcome worth preventing.

## Deliberately not in scope

- The jest handle leak and the `copy-wasm` worktree defect — `TASK_2026_427_f669`.
- Anything about agent OUTPUT quality. All six agents did their work correctly;
  every finding here is about reporting, not about results.
