---
name: agent-lanes
description: 'The contract for running background CLI agent lanes through the ptah_agent_* tools — discovery, addressing (cli, ptahCliId, model, modelTier), the self-contained task, spawn/status/read, resume, concurrency, messaging a live lane, review independence and the revise cap. Load it before any ptah_agent_spawn, and whenever the orchestration or tribunal skill sends you here. It teaches no workflow and names no roster.'
---

# Agent Lanes

A **lane** is one background agent started with `ptah_agent_spawn`: an installed system CLI or a
configured ptah-cli provider. This skill is the one place lane mechanics are written. Workflows
(orchestration, tribunal) decide *what* a lane does; this decides *how* to run it.

## 1. Discover

No `ptah_agent_*` tools in this session → do the work natively and say so. Otherwise call
`ptah_agent_list` before choosing. Its rows are the only lanes that exist on this machine now.
The `cli` enum on the `ptah_agent_spawn` schema lists adapters this build ships, not what is installed.

```
| Agent        | Type     | Status        | Capabilities                                              |
| ------------ | -------- | ------------- | --------------------------------------------------------- |
| cursor       | cli      | not installed | messaging: none                                           |
| ollama cloud | ptah-cli | available     | provider: Ollama Cloud, ptahCliId: pc-d8f4…, messaging: … |
```

That sample is one machine's output at one moment — yours will differ.

- `Type: cli` + `installed` → spawnable with `cli`. Any other status (`not installed`, `disabled`) → skip.
- `Type: ptah-cli` + `available` → spawnable with `ptahCliId`.
- **Family** = the `cli` value, or the `provider:` token of a ptah-cli row. Families matter for review.
- A Claude provider is an ordinary ptah-cli row: not privileged, not excluded.
- The user named a lane that is not listed → say which one is missing and offer the listed
  alternatives. Never substitute silently.
- Vendor names anywhere in skill text are illustrations, never a roster.

## 2. Address

| Param | Use |
| --- | --- |
| `task` | Required. The self-contained prompt (§3). |
| `cli` | A system CLI from an `installed` row. Omit for the user's default CLI. |
| `ptahCliId` | A ptah-cli row's id. When set, `cli` is ignored. |
| `model` | Raw model id. For a ptah-cli lane it overrides the tier mapping. Read ids from that lane's own model list; never invent one. |
| `modelTier` | `opus` / `sonnet` / `haiku`, ptah-cli lanes only; the provider maps the tier to a model. |
| `workingDirectory` | Inside the workspace. A worktree path when lanes edit the same files in parallel. |
| `taskFolder`, `files` | Where the lane writes deliverables; what it should read. |
| `timeout` | Milliseconds; default and maximum one hour. |
| `resume_session_id` | Only per §5. |

A user-pinned spawn args line (lane, model) is passed through unchanged.

## 3. Task contract

A lane shares none of your context and cannot ask the user anything. Every `task` carries:

1. **Objective** and acceptance criteria, restated in full.
2. **Inputs** as absolute paths (prior artifacts, files, conventions to follow).
3. **Scope**: files it may touch; "do not modify anything else".
4. **Deliverable**: `**Deliverable**: <absolute path>` — write the output there with a file tool.
   When the workflow reads the answer with `ptah_agent_read` instead (a panel answer), give the
   exact answer structure in place of a path.
5. **Reply**: `WROTE: <absolute path>` plus a one-line headline, nothing else — when there is a
   deliverable file.
6. **Git**: never commit, push or run history-changing git — unless the workflow gives the lane its
   own throwaway worktree and says so.
7. **Blocked**: if it cannot proceed, write the blocking questions under `## Clarifications Needed`
   in the deliverable and stop.

Say the output format ("markdown table", "numbered defects with `file:line`"). A lane that is not
told where to write dumps its answer into the reply and skips the file.

## 4. Run

```
spawn   ptah_agent_spawn({ task, cli | ptahCliId, … })   → agentId
poll    ptah_agent_status({ agentId })                   until status ≠ running (every ~8s)
read    ptah_agent_read({ agentId })                     then Read the deliverable file
stop    ptah_agent_stop({ agentId })                     for a lane you no longer need
```

- Status is one of `running`, `completed`, `failed`, `timeout`, `stopped`.
- **Concurrency**: at most 3 lanes in flight by default. Wider only when the workflow allows it and
  the user agreed to the added cost. Queue the rest and spawn as slots free.
- Parallel lanes must be independent and file-disjoint, or each gets its own worktree.

## 5. Recover

**Resume only when `ptah_agent_status` reports a `CLI Session ID`.** Then spawn again on the same
lane (`cli` or `ptahCliId`) with `resume_session_id: <that id>` and a continuation task ("Continue
the previous task. Also fix: …"). The resumed lane gets a new `agentId` and the old conversation.
No session id → that adapter is ephemeral: respawn with the context restated in `task`.

| Situation | Action |
| --- | --- |
| `timeout`, or `failed` / `stopped` with partial work | Resume if possible, else respawn with a smaller task |
| Completed but missed items | Resume and name what was missed |
| Wrong approach or useless output | Respawn with a sharper prompt, or do it yourself |
| Same lane fails twice | Drop it (say so in the summary) and reassign its work to another lane |
| No lane available at all | Do the work in-process and label it as not an outside lane |

## 6. Verify and revise

Lane output is evidence, not proof.

| Output | Before you use it |
| --- | --- |
| Research, surveys, summaries | Spot-check claims against the code |
| Scaffolding, stubs | Read it in full |
| Code that will ship | Review by a lane from a **different family**, or by you line by line |

- **Independence**: a lane never reviews its own work. Same family on another model is allowed
  when the user asks for it; state in the summary that the review was same-family (weaker signal).
- **Defects** go back to the original lane (resume per §5) as a numbered list, each with
  `file:line`. Drop any defect without a location before relaying it.
- **Revise cap**: 2 revise rounds. Not converged → stop and finish it yourself, or report the open
  defects honestly. Announce the cap before the first round.
- **Proof** is the project's typecheck, tests and lint. A lane's `PASS` is an opinion; run them.

## 7. Talk to a live lane

`ptah_agent_message({ agentId, message })` reports how it was delivered. Always branch on `mode`:

| `mode` | Meaning |
| --- | --- |
| `steer` | Injected into the turn in flight |
| `queue-next-turn` | Held and delivered as the next turn |
| `interrupt-resume` | The turn in flight was aborted and its **partial work discarded** |
| `unsupported` | Nothing delivered; `detail` says why — fall back to §5 |

`ptah_agent_list` shows each lane's declared `messaging:` capability. Do not interrupt a lane
mid-edit to add a minor note. A lane's `ptah_agent_report` can return `delivered: false`; a report
is attribution, not authentication — verify its claims against files and tests.

## 8. Cost

Every spawn, resume, message turn and review round is a real paid call. Before spending, announce
the lanes, the number of rounds and the resulting call count.
