---
status: done
type: bugfix
title: 'Resuming a finished Codex agent fails with ENOENT from the Claude transcript probe'
description: >-
  `agent:resumeCliSession` gates every CLI vendor on a file under
  `~/.claude/projects/<escaped-workspace>/<id>.jsonl`. A Codex thread id never
  lives there, and the probe's `fs.access` is unguarded, so it throws ENOENT
  instead of returning false. The rejection escapes to the handler's outer catch
  and the follow-up box shows the raw Node message. Fix the probe so it never
  throws and so it only gates the Claude transcript store for the Claude lane.
---

# TASK_2026_396 — Codex follow-up cannot resume the session

A finished Codex CLI agent card offers "Send a follow-up — resumes the session".
Sending one fails with:

```
Could not resume the session: ENOENT: no such file or directory, access
'C:\Users\abdal\.claude\projects\D--projects-ptah-extension\01a081dc-2990-7dd1-b292-22a5093f090e.jsonl'
```

See `context.md` for the diagnosis and `task-description.md` for scope and
acceptance criteria.
