---
name: agent-lanes
description: 'Contract for spawning, resuming and messaging background CLI agent lanes via the ptah_agent_* tools. Load before any ptah_agent_spawn, or when orchestration or tribunal refers here.'
---

# Agent Lanes

A **lane** is one background agent started with `ptah_agent_spawn`: an installed system CLI or a
configured ptah-cli provider. This skill is the one place lane mechanics are written. Workflows
(orchestration, tribunal) decide _what_ a lane does; this decides _how_ to run it.
Skill and workflow authors: write and trim prompts against the [prompt-authoring rubric](../skill-creator/references/prompt-authoring-rubric.md) in `skill-creator`.

## 1. Discover

No `ptah_agent_*` tools in this session → do the work natively and say so. Otherwise call
`ptah_agent_list` before choosing. Its rows are the only lanes that exist on this machine now.
Read each row's Limit state: never pick an AT LIMIT lane (spawn refuses it unless force: true); treat "unknown (…)" as unverified, not as room.
The `cli` enum on the `ptah_agent_spawn` schema lists adapters this build ships, not what is installed.

```
| Agent        | Type     | Status        | Family     | Capabilities                                              |
| ------------ | -------- | ------------- | ---------- | --------------------------------------------------------- |
| <cli row>    | cli      | installed     | <family>   | messaging: <reported capability>                          |
| <provider>   | ptah-cli | available     | <family>   | provider: <family>, ptahCliId: <listed id>, messaging: …  |
```

That sample is one machine's output at one moment — yours will differ.

- `Type: cli` + `installed` → spawnable with `cli`. Any other status (`not installed`, `disabled`) → skip.
- `Type: ptah-cli` + `available` → spawnable with `ptahCliId`.
- **Family** = the `cli` value, or the `provider:` token of a ptah-cli row. Families matter for review.
- Treat every provider as an ordinary ptah-cli row; none is privileged or excluded.
- The user named a lane that is not listed → say which one is missing and offer the listed
  alternatives. Never substitute silently.
- The live list, not an example, determines what can be spawned.

## 2. Address

| Param                 | Use                                                                                                                                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task`                | Required. The self-contained prompt (§3).                                                                                                                                                                                                                             |
| `cli`                 | A system CLI from an `installed` row. Omit for the user's default CLI.                                                                                                                                                                                                |
| `ptahCliId`           | A ptah-cli row's id. When set, `cli` is ignored.                                                                                                                                                                                                                      |
| `model`               | Raw model id. For a ptah-cli lane it overrides the tier mapping. Read ids from that lane's own model list; never invent one.                                                                                                                                          |
| `modelTier`           | `opus` / `sonnet` / `haiku`, ptah-cli lanes only; the provider maps the tier to a model.                                                                                                                                                                              |
| `role`                | Name of a role generated for this workspace. `ptah_agent_list` lists the valid names. The spawn result reports `roleDelivery` and `roleChannel`.                                                                                                                      |
| `workingDirectory`    | Inside the workspace. A worktree path when lanes edit the same files in parallel.                                                                                                                                                                                     |
| `taskFolder`, `files` | Where the lane writes deliverables; what it should read.                                                                                                                                                                                                              |
| `taskKind`            | Gate 0.1 chosen row's `taskKind`: `plan`, `implement`, `review`, `research`, `tests` or `docs`.                                                                                                                                                                       |
| `routingSource`       | Gate 0.1 chosen row's `source`: `model`, `ranking` or `pin`.                                                                                                                                                                                                          |
| `deliverables`        | The files the lane MUST write. Relative to `taskFolder` when set, else to `workingDirectory`. Pass it whenever the lane owes you a file — it is what makes the completion signal (§4) able to say the work was actually done.                                         |
| `timeout`             | Inactivity window in milliseconds: the lane is stopped after this long with no output. Default one hour, no maximum; `0` disables it. Pass a value well under an hour (20 min, `1200000`, is a good default); a lane that needs more than that is too big — split it. |
| `resume_session_id`   | Only per §5.                                                                                                                                                                                                                                                          |

A user-pinned spawn args line (lane, model) is passed through unchanged. Before a lane spawn,
the orchestrator may call `ptah_route_decide` as described at orchestration Gate 0.1. Pass
`taskKind` and `routingSource` from its chosen row on `ptah_agent_spawn`; omit them when
no routed row exists. If `ptah_route_decide` is not listed, skip it silently. `ptah_agent_spawn`
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
   own throwaway worktree and says so. Never run git commands that discard working-tree changes
   (`restore`, `checkout -- <path>`, `stash`, `reset`, `clean`); a change the lane did not make
   belongs to another writer — report it, never revert it.
8. **Decide, then ask the spawner**: settle open points from the code, the inputs, project docs and
   web search, and list each under `## Decisions` in the deliverable (decision, options, evidence,
   reversible). A point still open, or user-reserved (orchestration `checkpoints.md` § User-reserved
   decisions), goes to you through `ptah_agent_report` with options and a recommendation; the lane
   continues with the work that does not depend on it. If the report is not delivered, or nothing is
   left to do without the answer, it writes the questions under `## Clarifications Needed` in the
   deliverable and stops. You answer with `ptah_agent_message` (branch on `mode`, §7) after running
   the decision ladder.
9. **Preserve list**: when replacing, consolidating or deleting an existing surface, list what it
   can do today (or pass `parity-inventory.md` in `files`). Every item stays, moves, or is listed
   under `## Proposed Removals` for user approval — never removed silently.

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

**Do not poll in a loop.** When a lane reaches a terminal status, Ptah pushes one `<agent-lane-completed>` signal per lane turn
into the session that spawned it. Spawn, get on with your own work, and act when it arrives. The
signal carries the agent id, lane, terminal status, exit code, duration, report count, CLI Session
ID when available, and one line per declared deliverable.

Act on its `verdict`, never on the exit code alone:

| `verdict`        | Meaning                                                                            | Do this                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `delivered`      | Terminal status `completed` and every declared deliverable exists and is non-empty | Read the files and verify the content (§6)                                                                                  |
| `no-deliverable` | Exited cleanly WITHOUT writing every declared deliverable                          | Treat the task as not done. Read the output, then resume per §5 naming the missing paths. Never report the lane as complete |
| `failed`         | Terminal status `failed`, `timeout` or `stopped`                                   | Recover per §5                                                                                                              |
| `unverified`     | Completed, but nothing was declared, so nothing was checked                        | Read the output and verify it. Declare `deliverables` next time                                                             |

**The pushed `<agent-lane-completed>` signal is the wake.** After it arrives, read status and
output with `ptah_agent_status({ agentId })` and `ptah_agent_read({ agentId })`, then verify the
declared deliverables' contents. A missing or empty file is not complete. If push is unavailable
(for example, no live spawning session, no parent session, or no chat runtime), make one status/read
check. If it reports `running`, continue other independent work and re-check with at most 5 status
checks per lane, at least 60 s apart. Do not use a tight loop, timer, or watcher. If the fifth check still reports
`running`, stop waiting: tell the user the lane is still running (include its agent ID and lane) and
end the turn, or, if it has clearly exceeded its expected duration, use `ptah_agent_stop` and
recover per §5 as a non-limit timeout, never as a usage limit.
For a verdict other than `delivered`, read the output and recover per §5.

A message queued with `ptah_agent_message` runs as a new turn after a `delivered` signal and can change the deliverable again.
A later signal from the same agent supersedes an earlier one.
Do not start review of a deliverable while a queued message for that lane is pending; wait for
that turn's signal, then read and verify the final file.

Status is one of `running`, `completed`, `failed`, `timeout`, `stopped`.

- **Concurrency**: at most 3 lanes in flight by default. Wider only when the workflow allows it and
  the user agreed to the added cost. Queue the rest and spawn as slots free.
- Parallel lanes must be independent and file-disjoint, or each gets its own worktree.

## 5. Recover

Classify terminal evidence as quota/usage-limit, auth, crash, timeout, bad/missing output, or
unknown. After a possible limit failure, read that lane's `ptah_agent_list` row and its own output.
The readable limit signal is the row's `AT LIMIT` state with a reset time or `reset unknown`,
together with the lane's output. Never infer a limit from timeout, capacity, or a missing deliverable.

On a confirmed limit, record the lane ID (`cli` or `ptahCliId`), family, cause, and row's reset
time or `reset unknown` in this run's `context.md`. Key exhaustion by lane, not `agentId`: a
resumed lane gets a new agent ID. Do not force-spawn. Choose fallback in this order:
**other family same capability** → **same family other provider/model** → **subagent** with a
`Subagent reason`. Skip a known-reset lane until its limit clears. For `reset unknown`, skip
that lane for the rest of this run; re-check with `ptah_agent_list` only at the next Gate 0.1 or
on user request. A fresh list row with confirmed room overrides the exhausted entry.

For a non-limit failure, resume once when `ptah_agent_status` supplies a `CLI Session ID` and
there is useful work to continue: spawn on the same lane with `resume_session_id` and a specific
continuation task. Otherwise respawn once with a narrower, self-contained task; an ephemeral
adapter needs the context restated. Name missing deliverables and missed items explicitly. After
two non-limit failures on that lane, choose the next eligible lane, then a subagent with a
`Subagent reason` if no lane is eligible. Report the fallback, cause, and reset time or
`reset unknown` when a limit was involved. Never silently replace a user pin: disclose that its
lane is unavailable and get direction before using another executor.

## 6. Verify and revise

Lane output is evidence, not proof.

| Output                                                | Before you use it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Research, surveys, summaries                          | Spot-check claims against the code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Scaffolding, stubs                                    | Read it in full — only the files the lane edited                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Decision artifacts (spec, design, plan)               | A proposal, not a decision. Diff every rule against the user's request; tag rules `user-requested` / `project-rule` / `lane-proposed`, and list only `lane-proposed` rules under `## Lane-introduced constraints`. Project rules keep their `project-rule` tag and cite their source where they appear; do not list them as lane-introduced. A Document gates review (below) runs first; then orchestration Gate 1, 1.7 or 2 approves the artifact before any lane builds from it — the reviewer in `lane-review` mode, the user in `user` mode or on escalation. |
| Code that deletes, replaces or consolidates a surface | Check the supplied preserve list or `parity-inventory.md` item by item; a missing, unapproved capability blocks the batch. Proposed removals require explicit user approval before the batch is accepted.                                                                                                                                                                                                                                                                                                                                                         |
| UI code                                               | Typecheck/test/lint are not proof. Require visual-reviewer screenshots in dark + light themes, compared with the approved prototype (or — for a UI change with no added/redesigned surface and so no prototype — before/after screenshots of the affected screen, the "before" taken from the base commit before the fix lands) and shown to the user before merge.                                                                                                                                                                                               |
| Code that will ship                                   | Independent review by a different family under Shipping code (below), recorded in `code-logic-review.md` under the code-review role's own verdict contract. **Write-path trace**: when persisted settings/config/storage writes change, trace each write to its runtime reader (key, scope, value format, side effects such as env vars); confirm behaviour is unchanged or intended.                                                                                                                                                                             |

- **Document gates**: Decision artifacts (`task-description.md`, `design-spec.md` + `prototype/`,
  `implementation-plan.md`) use an independent opposite-execution-side reviewer. _Side_ means
  in-process (orchestrator or subagent) versus CLI lane. The author never reviews its own work;
  an in-process author uses a CLI lane and a CLI author uses an in-process reviewer. If the
  opposite side is unavailable, lanes are disabled at Gate 0.1, or the user pins a same-side
  reviewer, disclose the reason and use an independent same-side reviewer, preferring another
  family unless pinned. Never silently replace a pinned reviewer. Document reviews write
  `<artifact-stem>-review.md` (APPROVED / REVISE); an existing eligible review is not duplicated.
  An approving opposite-side review passes Gate 1/1.7/2 in `lane-review` mode; a same-side
  review goes to the user rather than approving the gate. REVISE at the cap goes to the user;
  a proposed removal goes to the user. Keep the document verdict and orchestration
  `agent-catalog.md` / `checkpoints.md` § Approval mode protocol. If no independent reviewer
  can run, report the blocker; never claim a review.
- **Shipping code**: Use an independent code reviewer from a different family than the implementer,
  regardless of execution side; keep the `code-logic-review.md` verdict contract. _Family_ is
  the lane's `cli` value or ptah-cli provider token (§1), or the in-process model family.
  The `Review family` record names the actual reviewer family alongside the implementer family.
  The author never reviews its own work. A same-family review requires a specific reason and a
  weaker-evidence label. An in-process subagent reviewing code by an in-process subagent of the
  same family also requires both. If no eligible lane can review, use an independent subagent
  only with the same specific reason and weaker-evidence label. Never silently replace a pinned
  reviewer; if no independent reviewer can run, report the blocker and never claim a review.
- **Defects** go back to the original lane (resume per §5) as a numbered list, each with
  `file:line`. Drop any defect without a location before relaying it.
- **Revise cap**: at most 2 revise rounds (author/reviewer revision pairs) after the initial review; announce it
  first. At exhaustion, a document goes to the user with every open item, in either approval mode. For code, report the
  open defects or make ONE bounded correction, then have the changed code independently reviewed;
  if that review finds defects, report them and stop — never reset the cap or claim completion.
- **Code checks** are the project's typecheck, tests and lint; UI also needs rendered evidence.
  A lane's `PASS` is an opinion; run them —
  scoped to the projects the lane changed (`npx nx run-many -t typecheck,test,lint -p <project>`),
  never workspace-wide. Tail or filter the output; never paste a full log into the thread.

## 7. Talk to a live lane

`ptah_agent_message({ agentId, message })` reports how it was delivered. Always branch on `mode`:

| `mode`             | Meaning                                                           |
| ------------------ | ----------------------------------------------------------------- |
| `steer`            | Injected into the turn in flight                                  |
| `queue-next-turn`  | Held and delivered as the next turn                               |
| `interrupt-resume` | The turn in flight was aborted and its **partial work discarded** |
| `unsupported`      | Nothing delivered; `detail` says why — fall back to §5            |

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
the lanes, the number of rounds and the resulting call count — including required document
reviews: one initial review per artifact plus up to two author/reviewer pairs.

Inside a lane, **cost ≈ requests × context**: every tool call is one request that resends the
whole thread, so a lane's bill grows with its call count times its accumulated context. Measured
over 7 days of Codex lanes: 68 requests per session at an average 115k-token context, 29% of
them polling, and 1.23 billion input tokens in total.

- Default ceiling: **40 tool calls per lane**. State it in `task`; a lane near it reports and stops.
- Give the lane its file list up front (`files` plus absolute paths in `task`) so it edits instead
  of exploring. Exploration is the calls you pay for twice — once to search, once as context.
- A lane whose context balloons from a log or a whole-file read pays that context on every call
  after; the scoped-verification and tail rules in §6 apply inside the lane too.

## 9. Agent sessions (`ptah_session_*`)

A child session is a chat session in its own git worktree on a new branch. It opens as a tab in the
user's window, and the user can read and type in that tab as well. It is not a CLI lane: it has no
process to resume (§5), and it never exits, it goes idle. Use a lane for a bounded task on a vendor
CLI; use a child session when the work needs the full chat runtime, slash commands such as
`/orchestrate TASK_…`, or a branch the user can open and review.

| Tool                                               | Use                                                                                                      |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `ptah_session_start({ task, branch, … })`          | Create the worktree and branch, open the tab, run `task`                                                 |
| `ptah_session_send({ sessionId, message, mode? })` | Steer. `queue` (default), `steer` (interrupts the turn in flight), `if-idle` (refused as busy otherwise) |
| `ptah_session_status({ sessionId? })`              | State of one or all of your children                                                                     |
| `ptah_session_read({ sessionId, tailKiB? })`       | Tail of the child's transcript (default 32 KiB, max 256)                                                 |
| `ptah_session_stop({ sessionId })`                 | Stop it; tab, transcript, worktree and branch remain                                                     |

- **Messaging first.** Steer with `ptah_session_send`; use `ptah_session_read` to inspect. Do not poll
  `ptah_session_status` while a completion turn is due: one is pushed into your session each time a
  child settles, as `<agent-lane-completed … cli="ptah-session" …>`, with a `verdict` of `delivered`,
  `no-deliverable`, `unverified` or `failed`. Verify the deliverables yourself; a file existing is not
  proof its content is right.
- **Call `ptah_session_status` after a resume.** Children keep running while you are not live and a
  completion that arrived then is held, not lost. Every `ptah_session_*` result ends with those held
  completions under "Held while this session was not live". A child's `ptah_agent_report` while you
  are not live is refused and counted, not queued.
- **Permissions.** There is no permission, path or parent argument. The child starts at your
  session's autopilot level as it is at `ptah_session_start`. In full autopilot (YOLO) it runs
  without prompts. At any other level, file edits inside the worktree and allowlisted Bash
  commands run without asking; anything else waits in the child's tab for the user, then is
  denied (`ptah_session_status` shows `awaiting-permission` with the denial time). Plan mode is
  not inherited: a planning parent's child starts at Ask.
- **Limits.** At most 3 live children per host by default, depth 1 (a child cannot start sessions).
  An idle child still holds its slot until `ptah_session_stop`. A refusal is returned as text with a
  code (`cap-reached`, `depth-exceeded`, `branch-exists`, …); act on it, do not retry blindly.
- **The user owns the result.** The worktree and the branch remain after the child ends. Never merge,
  push or clean up on the user's behalf.
- **Hosts.** Child sessions need the chat runtime and the Ptah MCP server. In a host without the
  session spawner the tools fail with an error that says so.
- **Reports.** A child reports with `ptah_agent_report`; it arrives as
  `<agent-report … cli="ptah-session">`, the same envelope a lane's report uses.

Settings, limits and the full tool reference: the "Agent Sessions" page in the Ptah docs.

## Requires

- `skill-creator` — the prompt-authoring rubric this skill points authors to. If it is not
  installed, tell the user to enable it; do not improvise a rubric.
