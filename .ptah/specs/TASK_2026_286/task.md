---
id: TASK_2026_286
status: done
type: feature
title: >-
  Agents were the one artifact kind Ptah fanned out with nobody's permission —
  gate them, without reaping what the previous version already wrote
description: >-
  Skills and commands only propagate because the user installed or authored
  them: a plugin toggle, a `SKILL.md` they wrote, a harness-builder run.
  `buildAgents()` had no equivalent — it read every `.md` under
  `~/.ptah/user/agents` unfiltered, so any agent file in a workspace was
  transformed into `.codex/agents/*.toml`, `.github/agents/*.agent.md` and
  `.cursor/agents/*.md` on the first pass, in every workspace, whether or not
  the user had ever asked Ptah to manage subagents there. The setup wizard is
  only one producer; a hand-written `{ws}/.claude/agents/x.md` propagated
  identically, and no state anywhere recorded that the wizard had ever run. The
  hard part is not the gate, it is shipping it: agents are manifest-owned, so a
  flag defaulting to false makes the first routine reconcile after an upgrade
  DELETE every agent file Ptah had ever written, in every existing workspace,
  silently, reported as an ordinary clean pass.
updated: '2026-08-25T21:16:27.165Z'
---

# The agents consent gate

Machine-owned metadata carrier. Prose lives in `./context.md`.
