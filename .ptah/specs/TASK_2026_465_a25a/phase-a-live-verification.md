# Phase A live verification — done

Two sittings. The first was blocked; the second closed all three criteria. Both
are recorded, because the block was a real condition and not a mistake to hide.

## Sitting 1, 2026-09-20 — blocked on a stale host

`ptah_agent_list` reported antigravity `messaging: none`. The landed code cannot
produce that answer on this machine: `AntigravityCliAdapter.detect` awaits
`probeStreamJsonInput` and reports `bestMessagingCapability(this.capabilities())`,
`capabilities()` returns `continuation: this.streamJsonInputSupported === true`,
and `bestMessagingCapability` maps `continuation` to `queue`. Run by hand against
the installed binary:

```
agy --version              → 1.2.7
agy --help                 → 3,263 bytes
match /--input-format\b/   → True
```

The capability was present in the binary, so a host carrying Phase A would have
answered `queue`. The running extension host predated the PR #537 merge. No live
reading was taken from it, because every reading would have described the
pre-Phase-A build.

## Sitting 2, 2026-09-21 — the host was rebuilt, and it passes

`ptah_agent_list` now reports:

```
| antigravity | cli | installed | messaging: queue, role delivery: preamble/task-prompt |
```

### The three criteria

| # | Criterion | Observed |
| --- | --- | --- |
| 1 | `ptah_agent_message` to a running antigravity lane returns `queue-next-turn`, and the message runs as the next turn in the same conversation | **Yes**, both halves — see below |
| 2 | The `ptah_agent_list` capability cell matches the mode returned | **Yes** — cell reads `queue`, call returned `queue-next-turn` |
| 3 | The lane still reaches `completed` and its output is readable with `ptah_agent_read` | **Yes** — `completed`, exit code 0, output readable |

### The run

Lane `fa290ef9-d261-40dd-8d80-5cc9182f6ed8`, antigravity, task: write a
five-line note about mid-turn delivery, deliverable first, no shell commands.

While it was `running`, `ptah_agent_message` answered:

```
Mode: queue-next-turn
Detail: The agent is mid-turn and antigravity cannot be interrupted or steered,
        so the message is queued at position 1 and will be delivered as a new
        turn when the current one ends.
```

**The mode alone is not proof of delivery.** It is computed from capabilities at
send time, and a lane that dies before its turn settles would report the same
mode and receive nothing — which is exactly what happened on the first attempt
this sitting (lane `45e10907`, killed by a vendor-side
`Eligibility check failed: UNAVAILABLE (code 503)` before its first turn ended).
So the message carried a sentinel: add a sixth line beginning
`QUEUED_MESSAGE_ARRIVED`.

The delivered file ended:

```
5. Multiple queued messages run sequentially within a single continuous process
   and conversation, and the process exits only after stdin closes and the final
   queued line settles.
6. QUEUED_MESSAGE_ARRIVED: This instruction reached me after my first turn had
   already started.
```

and the lane's own last words were:

```
WROTE: …\phase-a-lane-note.md
Updated the deliverable to six numbered lines including acknowledgment of the
mid-turn queued message.
```

Five lines were on disk before the message was sent and six after, in one
conversation, with no respawn. That is the second half of criterion 1 measured
rather than inferred.

## The reverse direction, checked at the same time

Not a Phase A criterion, but it is the other half of the mechanism and it had
never been observed live either. Lane
`97a93f30-a103-4edf-be16-06aa415aac21` (ptah-cli, Claude provider, haiku) was
told to call `ptah_agent_report` twice. Both answered:

```
{"delivered": true, "parent_session": "59ad12f2-c53b-48e9-92db-b2923f3acf0d"}
```

`parent_session` is the orchestrating session's own id, so attribution through
the `/agent/{id}` URL segment worked end to end. The lane also listed the seven
`ptah_agent_*` tools it could see, confirming Ptah's MCP server reached a
ptah-cli child.

**One thing to be honest about**: both reports came back `delivered: true`, but
nothing surfaced in the parent session's visible transcript while they were
running. Delivery was confirmed by the tool's own answer, not by the parent
seeing the text. Whether a delivered report is meant to become visible to the
parent agent mid-run is a separate question this run does not answer.

## A defect found by running it

The opencode lane spawned in the same sitting (`e92ab7d8`) failed instantly:

```
[stderr] ERROR Unrecognized flag: --dir in command opencode run
```

`opencode run` has no `--dir` on 2.0.11, so every opencode lane died at spawn.
The adapter's unit tests could not catch it — they assert the argv Ptah builds
and never ask the binary whether it accepts it. Fixed on this branch by removing
the flag: the spawn already passes `cwd`, and `opencode run` honours it
(measured). **That fix is not in the running host**, so an opencode lane stays
unusable until the host is rebuilt again.

## Still open, and not closable from here

TASK_2026_477 acceptance criteria 1 and 2 — that a spawned agent reports
*without being told how in the task text*. The lane above was told explicitly, so
it proves the report PATH, not the guidance. `TWO_WAY_MESSAGING_GUIDANCE` is
unmerged, so the running host builds its child prompts without it. Those two
criteria need this branch merged and the host rebuilt once more.
