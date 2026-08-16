---
title: SKILL.md Anatomy
description: What an auto-promoted skill file looks like on disk — and what deliberately stays out of it.
---

import { Aside } from '@astrojs/starlight/components';

# SKILL.md Anatomy

A promoted skill lives at `~/.ptah/skills/<slug>/SKILL.md` and has the same shape as any hand-authored skill — frontmatter plus prose. There is **no second file format** for auto-synthesized skills: the frontmatter generator writes exactly the shape Ptah's plugin-discovery loader already expects, on purpose, so a synthesized skill and a hand-written one are indistinguishable at load time.

## Layout

```markdown title="~/.ptah/skills/api-error-triage/SKILL.md"
---
name: api-error-triage
description: Triage failing HTTP calls — read the failing request, check the
  server log, propose a fix. Use when the user reports a 4xx/5xx from a backend
  endpoint or asks "why is this API call failing?".
when_to_use: 'The user reports a failing HTTP call or asks why a request is erroring.'
---

# API Error Triage

## Step 1: Identify the failing call

...
```

## Frontmatter fields

| Field         | Purpose                                                                                |
| ------------- | -------------------------------------------------------------------------------------- |
| `name`        | Slug used by the agent loader; matches the directory name                              |
| `description` | Trigger text the orchestrator uses to decide when to invoke the skill                  |
| `when_to_use` | Optional. Extracted from a `## When to use` section in the drafted body, if one exists |

That's the whole file. It is deliberately minimal.

<Aside type="note" title="Provenance lives in the database, not the file">
Which sessions produced a skill, its trajectory hash, its judge score and criteria, and (once measured) its trigger-retrieval and replay numbers are all real, queryable facts — they're just not written into the `SKILL.md`. They live in Ptah's local SQLite state (`~/.ptah/state/ptah.sqlite`) and surface in the Skills tab's candidate detail and scorecard views, not in the file on disk. Keeping the file to `name` / `description` / `when_to_use` means a synthesized skill is exactly as portable as a hand-authored one — copy it to another machine and it loses nothing that made it work.
</Aside>

## Runtime consumption

Once written, the file is loaded by Ptah's skill engine on the next session. There is **no second mechanism** for auto-skills — they participate in the same discovery, junctioning, and trigger-matching as hand-authored ones.

See [MCP & Skills → Skills](/mcp-and-skills/skills/) for how skill files are loaded, junctioned into `<workspace>/.claude/skills/`, and matched at runtime.

:::note
Editing a promoted skill is supported and encouraged. Polish the prose, tighten the description, add references — Ptah won't overwrite hand edits.
:::
