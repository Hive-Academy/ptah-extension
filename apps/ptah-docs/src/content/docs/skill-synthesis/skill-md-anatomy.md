---
title: SKILL.md Anatomy
description: What an auto-promoted skill file looks like on disk.
---

# SKILL.md Anatomy

A promoted skill lives at `~/.ptah/skills/<slug>/SKILL.md` and has the same shape as any hand-authored skill — frontmatter plus prose — with extra provenance fields recording where it came from.

## Layout

```markdown title="~/.ptah/skills/api-error-triage/SKILL.md"
---
name: api-error-triage
description: Triage failing HTTP calls — read the failing request, check the
  server log, propose a fix. Use when the user reports a 4xx/5xx from a backend
  endpoint or asks "why is this API call failing?".
generated-from-sessions:
  - sess_7a2f4d1e
  - sess_b13c0099
  - sess_4f5d2210
trajectory-hash: 9b0a...e7
---

# API Error Triage

## Step 1: Identify the failing call

...
```

## Frontmatter fields

| Field                     | Purpose                                                                  |
| ------------------------- | ------------------------------------------------------------------------ |
| `name`                    | Slug used by the agent loader; matches the directory name                |
| `description`             | Trigger text the orchestrator uses to decide when to invoke the skill    |
| `generated-from-sessions` | Session IDs of the trajectories that produced the skill (audit trail)    |
| `trajectory-hash`         | Stable hash used by the dedup pipeline to recognise the same shape later |

## Runtime consumption

Once written, the file is loaded by Ptah's skill engine on the next session. There is **no second mechanism** for auto-skills — they participate in the same discovery, junctioning, and trigger-matching as hand-authored ones.

See [MCP & Skills → Skills](/mcp-and-skills/skills/) for how skill files are loaded, junctioned into `<workspace>/.claude/skills/`, and matched at runtime.

:::note
Editing a promoted skill is supported and encouraged. Polish the prose, tighten the description, add references — Ptah won't overwrite hand edits.
:::
