---
name: agent-lanes
description: 'Contract for spawning, resuming and messaging background CLI agent lanes via the ptah_agent_* tools. Load before any ptah_agent_spawn, or when orchestration or tribunal refers here.'
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
| `role` | Name of a role generated for this workspace. `ptah_agent_list` lists the valid names. The spawn result reports `roleDelivery` and `roleChannel`. |
| `workingDirectory` | Inside the workspace. A worktree path when lanes edit the same files in parallel. |
| `taskFolder`, `files` | Where the lane writes deliverables; what it should read. |
| `deliverables` | The files the lane MUST write. Relative to `taskFolder` when set, else to `workingDirectory`. Pass it whenever the lane owes you a file — it is what makes the completion signal (§4) able to say the work was actually done. |
| `timeout` | Inactivity window in milliseconds: the lane is stopped after this long with no output. Default one hour, no maximum; `0` disables it. Pass a value well under an hour (20 min, `1200000`, is a good default); a lane that needs more than that is too big — split it. |
| `resume_session_id` | Only per §5. |

A user-pinned spawn args line (lane, model) is passed through unchanged. `ptah_agent_spawn`
rejects any key not listed here — pass only the documented parameters.

## 3. Task contract

A lane shares none of your context and cannot ask the user anything. Every `task` carries:

1. **Objective** and acceptance criteria, restated in full.
2. **Inputs** as absolute paths (prior artifacts, files, conventions to follow).
3. **Scope**: files it may touch; "do not modify anything else".
4. **Deliverable**: `**Deliverable**: <absolute path>` — write the output there with a file tool.
   Pass the same path in the `deliverables` parameter; the lane is then told to write it AND the
   completion signal checks it. When the workflow reads the answer with `ptah_agent_read` instead
   (a panel answer), give the exact answer structure in place of a path.
5. **Reply**: `WROTE: <absolute path>` plus a one-line headline, nothing else — when there is a
   deliverable file.
6. **Report before exiting**: call `ptah_agent_report` once before the final message, naming what
   was produced, the absolute path of every file written, and anything it could not do. A lane
   that exits silently still produces a completion signal, but the signal lists files — only the
   lane can say what it decided and what it left undone.
7. **Git**: never commit, push or run history-changing git — unless the workflow gives the lane its
   own throwaway worktree and says so.
8. **Blocked**: if it cannot proceed, write the blocking questions under `## Clarifications Needed`
   in the deliverable and stop.

Say the output format ("markdown table", "numbered defects with `file:line`"). A lane that is not
told where to write dumps its answer into the reply and skips the file.

When the work calls for a role, pass it as the `role` parameter — never paste a role template into
`task`. Spawning without `role` is valid when the workspace has no roles generated.

## 4. Run

```
spawn   ptah_agent_spawn({ task, deliverables, cli | ptahCliId, … })  → agentId
wait    <agent-lane-completed> arrives in this session when the lane ends
read    ptah_agent_read({ agentId })                     then Read the deliverable file
stop    ptah_agent_stop({ agentId })                     for a lane you no longer need
```

**Do not poll in a loop.** When a lane reaches a terminal status, Ptah pushes one
`<agent-lane-completed>` turn into the session that spawned it. Spawn, get on with your own work,
and act when it arrives. The signal carries the agent id, the lane, the terminal status, the exit
code, the duration, the number of reports the lane sent, the CLI Session ID when there is one, and
one line per declared deliverable.

Act on its `verdict`, never on the exit code alone:

| `verdict` | Meaning | Do this |
| --- | --- | --- |
| `delivered` | Terminal status `completed` and every declared deliverable exists and is non-empty | Read the files and verify the content (§6) |
| `no-deliverable` | Exited cleanly WITHOUT writing every declared deliverable | Treat the task as not done. Read the output, then resume per §5 naming the missing paths. Never report the lane as complete |
| `failed` | Terminal status `failed`, `timeout` or `stopped` | Recover per §5 |
| `unverified` | Completed, but nothing was declared, so nothing was checked | Read the output and verify it. Declare `deliverables` next time |

**The `<agent-lane-completed>` signal is the primary wake; status checks are the fallback.** If
you must check, make one `ptah_agent_status({ agentId })` call, then wait at least 60 s before the
next — at most 5 checks per lane, never a loop. Use it and `ptah_agent_read({ agentId })` when:

- no signal arrived — the signal is refused when the spawning session is no longer live, when the
  lane was spawned with no parent session, or when this host registered no chat runtime;
- the lane's adapter reports nothing useful, so the output is the only account of what it did
  (`opencode` has no messaging support at all);
- the verdict is anything other than `delivered` — the signal says WHETHER a file was written, and
  the output says how far the lane got.

Status is one of `running`, `completed`, `failed`, `timeout`, `stopped`.

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
| `verdict: no-deliverable` | Resume naming every missing path, and say the file was never written |
| Completed but missed items | Resume and name what was missed |
| Wrong approach or useless output | Respawn with a sharper prompt, or do it yourself |
| Same lane fails twice | Drop it (say so in the summary) and reassign its work to another lane |
| No lane available at all | Do the work in-process and label it as not an outside lane |

## 6. Verify and revise

Lane output is evidence, not proof.

| Output | Before you use it |
| --- | --- |
| Research, surveys, summaries | Spot-check claims against the code |
| Scaffolding, stubs | Read it in full — only the files the lane edited |
| Code that will ship | Review by a lane from a **different family**, or by you line by line |

- **Independence**: a lane never reviews its own work. Same family on another model is allowed
  when the user asks for it; state in the summary that the review was same-family (weaker signal).
- **Defects** go back to the original lane (resume per §5) as a numbered list, each with
  `file:line`. Drop any defect without a location before relaying it.
- **Revise cap**: 2 revise rounds. Not converged → stop and finish it yourself, or report the open
  defects honestly. Announce the cap before the first round.
- **Proof** is the project's typecheck, tests and lint. A lane's `PASS` is an opinion; run them —
  scoped to the projects the lane changed (`npx nx run-many -t typecheck,test,lint -p <project>`),
  never workspace-wide. Tail or filter the output; never paste a full log into the thread.

## 7. Talk to a live lane

`ptah_agent_message({ agentId, message })` reports how it was delivered. Always branch on `mode`:

| `mode` | Meaning |
| --- | --- |
| `steer` | Injected into the turn in flight |
| `queue-next-turn` | Held and delivered as the next turn |
| `interrupt-resume` | The turn in flight was aborted and its **partial work discarded** |
| `unsupported` | Nothing delivered; `detail` says why — fall back to §5 |

`ptah_agent_list` shows each lane's declared `messaging:` capability, probed per run rather than
fixed per vendor — read it each time. Do not interrupt a lane mid-edit to add a minor note. On a
ptah-cli lane the message is echoed into that lane's own output, which is how you confirm it
arrived. A lane's `ptah_agent_report` can return `delivered: false`; a report is attribution, not
authentication — verify its claims against files and tests. The same rule applies to the
completion signal: it is evidence a file exists, never evidence the content is right.

The lane does not need to be told any of this in its `task`: `buildTaskPrompt`
(`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts`,
`TWO_WAY_MESSAGING_GUIDANCE`) already carries the child-side half on every spawn that has an MCP
port and an agent id, and `renderLaneCompletionContract`
(`libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-reporting-contract.ts`) carries the
before-you-exit half on every lane. Those two constants are the source of truth; this section and
the parent-side tool table in `ptah-system-prompt.constant.ts` must agree with them.

## 8. Cost

Every spawn, resume, message turn and review round is a real paid call. Before spending, announce
the lanes, the number of rounds and the resulting call count.

Inside a lane, **cost ≈ requests × context**: every tool call is one request that resends the
whole thread, so a lane's bill grows with its call count times its accumulated context. Measured
over 7 days of Codex lanes: 68 requests per session at an average 115k-token context, 29% of
them polling, and 1.23 billion input tokens in total.

- Default ceiling: **40 tool calls per lane**. State it in `task`; a lane near it reports and stops.
- Give the lane its file list up front (`files` plus absolute paths in `task`) so it edits instead
  of exploring. Exploration is the calls you pay for twice — once to search, once as context.
- A lane whose context balloons from a log or a whole-file read pays that context on every call
  after; the scoped-verification and tail rules in §6 apply inside the lane too.
