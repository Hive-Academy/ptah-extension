# VS Code smoke checklist - TASK_2026_584_5e7a (Batch 9)

Manual steps for the VS Code host. A tester cannot drive the VS Code UI, so every item below is PENDING-USER. Record PASS/FAIL next to each item and attach the captures named in "Capture".

## Setup

1. Build and launch the extension from this branch (`feat/task-584-agent-sessions`, HEAD b514dc3ac or later): open the worktree in VS Code and press F5 (Extension Development Host), or install the packaged VSIX.
2. Create a scratch git repo outside the real repository, for example `D:\b9scratch\repo`, with `git init`, one commit, and `.ptah/specs/TASK_SMOKE_1..3/task.md` (any small task, such as "create helloN.txt").
3. Sign in to a provider in Ptah settings (one that is not rate limited), and confirm the Ptah MCP server is running (status bar or the Ptah output channel).
4. Open the Ptah output channel. Keep it visible; it is the log source for "Capture".

## S1 - UI binding, A1 (workspace folder open = scratch repo)

- Action: open the scratch repo as the only folder. Open the Ptah chat panel, start a parent chat, and send: "Call ptah_session_start three times: branch smoke/one|two|three, task 'Read .ptah/specs/TASK_SMOKE_n/task.md and do it, then write a summary to .ptah/specs/TASK_SMOKE_n/done.md', deliverables ['.ptah/specs/TASK_SMOKE_n/done.md']. Do not do the work yourself."
- Expected: no `chat-runtime-unavailable` refusal in any tool result; three new tabs appear right after the parent tab, each with the agent-origin badge and the banner; the active tab does not change (no focus steal); each child tab streams live text; the sidebar lists three entries under the root workspace; `git worktree list` in the scratch repo shows three worktrees; each child's metadata `workingDirectory` equals its worktree.
- Capture: screenshot of the tab bar with badge and banner; screenshot of the sidebar; output of `git worktree list`; the three raw tool results (ids and statuses); the Ptah output channel lines around the first start (A1: the push to the UI happens before the first chunk streams).

## S1b - late adoption with NO folder open (F1) and sidebar click (B7 A2)

- Action: with the three children still running, run "Developer: Reload Window", or close and reopen the Ptah panel. Then run "File > Close Folder" so the window has NO folder open, and reopen the Ptah panel. In the sidebar, click one child session entry.
- Expected: the child tab opens (late adoption) and keeps streaming; clicking the sidebar entry activates that tab instead of doing nothing or throwing; no error toast; the Ptah output channel and the Developer Tools console show no "tab not found" or `requireTargetTab` error.
- Capture: screenshot of the no-folder window with the child tab open; the Developer Tools console (Help > Toggle Developer Tools) after the click.

## F1 fix - late-adopted child tab receives updates in the VS Code panel

- Action: with the no-folder window from S1b and a late-adopted child tab open, make the child produce (a) streaming text, (b) a finished turn, (c) a permission prompt (ask it to run `curl https://example.com`).
- Expected: (a) text streams into the adopted tab; (b) the turn finalizes (the streaming indicator stops and the message is committed); (c) the permission prompt with the countdown appears in that tab.
- Capture: three screenshots (streaming, finalized, permission prompt) of the adopted tab.

## S2 - cap

- Action: from the parent, call `ptah_session_start` a fourth time while three children run.
- Expected: result `cap-reached`; no fourth tab or worktree.
- Capture: the tool result.

## S3 - subagents read .mcp.json, A3

- Action: tell a child to run the orchestration skill, launch a Task subagent, and have both call a Ptah MCP tool (for example `ptah_session_status`).
- Expected: both the child and the subagent complete a Ptah MCP tool call (the subagent only when `subagentPtahTools` is `available`).
- Capture: the subagent's tool result in the child tab; note the `subagentPtahTools` value.

## S4 - depth

- Action: tell a child to call `ptah_session_start`.
- Expected: `depth-exceeded`.
- Capture: the tool result in the child tab.

## S5 - report

- Action: tell a child to call `ptah_agent_report`; then in an ordinary (non-agent) tab call `ptah_agent_report`.
- Expected: the child report arrives as exactly one new turn in the parent tab; the ordinary tab gets `unattributed-caller`.
- Capture: parent tab screenshot; the ordinary-tab tool result.

## S6 - send modes and read, A5, F2

- Action: with a working child, call `ptah_session_send` with mode `if-idle`, then with `queue`; wait for an idle child and send again; then call `ptah_session_read` with the default arguments.
- Expected: `busy`; `held-until-turn-end`; `started-turn`; and `ptah_session_read` returns the 32 KiB tail inline with no spool file (F2 fix). A5: the transcript read is the one for the child's worktree cwd.
- Capture: the four tool results; for the read, the result text length and whether any spool path is mentioned.

## S7 - permissions, A4

- Action: tell a child to run `curl https://example.com`, and to edit a file in the PARENT root (outside its worktree).
- Expected: the permission prompt shows in the CHILD tab with a countdown; unanswered, it is denied at about 60 s; `ptah_session_status` shows `awaiting-permission` meanwhile; approving inside the window works; an edit inside the worktree is auto-approved, an edit in the parent root is not (A4).
- Capture: screenshots of the prompt and the denial; the status result.

## S8 - deliverable verdicts

- Action: let one child finish without writing its deliverable, and one with it.
- Expected: one `no-deliverable` push in the first case; `delivered` in the second.
- Capture: both parent-tab push messages.

## S9 - typing into a child

- Action: type a message into a child tab.
- Expected: the reply streams in that tab; when it settles, the parent receives a push.
- Capture: child and parent screenshots.

## S10 - compact, parent stop, shutdown

- Action: (1) run `/compact` in the parent. (2) Stop the parent and wait several minutes; during that time have a child call `ptah_agent_report` and let another child settle. (3) Resume the parent (also by clicking its sidebar entry in a new tab) and call `ptah_session_status`. (4) Quit VS Code with a child still running.
- Expected: (1) children continue; (2) children keep running, the report returns `parent-session-not-active`, the settle shows as `heldCompletion` in status; (3) the held completion is returned once and the parent can send and stop; (4) clean shutdown with no push logged after shutdown.
- Capture: tool results; the Ptah output channel tail after quit.

## Cleanup

Delete the scratch repo and its worktrees (`git worktree remove --force <path>` for each, then delete the folder) and stop all child sessions.
