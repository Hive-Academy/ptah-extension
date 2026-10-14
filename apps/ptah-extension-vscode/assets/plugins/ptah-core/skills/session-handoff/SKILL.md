---
name: session-handoff
description: 'Wrap up this session and continue in a fresh one: finish the current step, write HANDOFF.md, then open a new Ptah session with ptah_session_handoff. Use only when the user or the Ptah session-budget banner runs /session-handoff.'
---

# Session Handoff

This session is ending. Your job is to leave the next session nothing to rediscover. Anything
after `/session-handoff` (for example a context-usage figure) is context only, not a new task.

## 1. Wrap up

- Start no new work. Bring the current step to a safe stopping point: finish or revert a
  half-made edit; never leave a file broken.
- Check everything still running once: subagents, CLI agent lanes (`ptah_agent_status`; lane
  mechanics live in the `agent-lanes` skill) and child sessions (`ptah_session_status`). Collect
  the results of those that finished.
- Wait for the rest briefly, at most 5 minutes in total (`ptah_agent_wait` for lanes). Never wait
  indefinitely.
- Record and continue: anything waiting on a permission or other outside input (for example
  `awaiting-permission`), or still not settled after that wait, is unfinished. Do not wait for it
  any longer. Record it under **Background work** in HANDOFF.md (its id, its state, how to check
  on it), then go on.

## 2. Write HANDOFF.md

Write it in the task folder you are working in (for example `.ptah/specs/<task>/`); with no task
folder, in the root of the current worktree. Overwrite an earlier HANDOFF.md. Write for a reader
who has none of this conversation:

- **Goal**: what the user asked for, and the decisions they already made.
- **Done**: commits (hash and subject), branches, PRs (links), with verification results.
- **In progress**: what is partly done, and in which files.
- **Open problems and decisions**: blockers, failing checks, questions waiting on the user.
- **Key files**: absolute paths, one line each on why they matter.
- **Background work**: anything you could not wait for, and how to check on it.
- **Next steps**: ordered, concrete, with the exact verification commands to run.

Record facts you checked, not intentions. Leave out what the next session can read from the code.

## 3. Hand off

Compose the continuation prompt. It must stand on its own: the goal in one or two sentences,
the ABSOLUTE path of HANDOFF.md, an instruction to read it first and continue from Next steps,
the repository rules that matter, and a note that it can run `/session-handoff` itself when its
own budget runs low.

Call `ptah_session_handoff` exactly once with `handoffPath` (absolute path of HANDOFF.md),
`prompt` (the continuation prompt) and optionally a short `label`.

On success, read `tabOpened`:

- `true`: tell the user the new session is open (by its label) and ask them to close this one.
- `false`: tell the user the new session started (by its label) but no tab appeared. They can
  find it in the session list in the Ptah sessions panel and open it from there. Ask them to
  close this one only after they have found it.

Do no further work here.

## Fallback

If `ptah_session_handoff` is not available, or the call is refused (any code) or fails: do not
retry. Print the continuation prompt in exactly one fenced code block and tell the user to paste
it into a new session. HANDOFF.md stays where you wrote it. If the refusal says the new session
may still open late, tell the user to look for it in the sessions panel first, and to paste the
prompt only if it does not appear.
