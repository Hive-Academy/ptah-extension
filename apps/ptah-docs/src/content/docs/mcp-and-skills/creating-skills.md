---
title: Creating Skills
description: Author a skill from scratch — file layout, frontmatter, trigger descriptions, and registration.
---

A skill is one folder with a `SKILL.md` inside. That's it. Optional `references/` subfolders hold lazy-loaded long-form material so the skill itself stays lean.

## Minimal skill

```text
my-skill/
└── SKILL.md
```

```markdown title="SKILL.md"
---
name: my-skill
description: One sentence describing when to use this skill.
---

# My Skill

Write the instructions the model should follow when this skill is invoked.
```

## Recommended layout

```text
my-skill/
├── SKILL.md              # Definition + trigger + top-level guidance
├── references/           # Optional — loaded lazily when SKILL.md links to them
│   ├── patterns.md
│   ├── examples.md
│   └── troubleshooting.md
└── assets/               # Optional — code snippets, templates
    └── starter.ts
```

## Frontmatter

| Field         | Required | Purpose                                    |
| ------------- | -------- | ------------------------------------------ |
| `name`        | Yes      | Unique identifier (kebab-case)             |
| `description` | Yes      | Trigger text — matched against user intent |
| `version`     | No       | Semantic version string                    |
| `tags`        | No       | Search/categorization                      |

### Writing a great `description`

The description is the **only** thing the orchestrator sees during trigger selection. A strong description:

- **Leads with "Use when..."** to frame it as a trigger, not a summary.
- **Names concrete verbs and nouns** the user might say.
- **States the skill's boundaries** so it isn't invoked for adjacent but wrong cases.

:::tip
**Good:** _"Use when the user asks for a security review, mentions vulnerabilities, OWASP, auth hardening, or XSS/SQLi."_

**Poor:** _"This skill helps with security stuff."_
:::

## Structuring `SKILL.md`

A reliable pattern:

```markdown
---
name: review-security
description: ...
---

# Security Review Protocol

## When to use

- The user asks for a security review
- A PR touches auth, crypto, or user input

## Process

1. Identify entry points (routes, event handlers)
2. Check for OWASP Top 10 categories
3. Produce a findings report with severity

## References

- OWASP patterns: see [references/owasp-top-10.md](references/owasp-top-10.md)
- Threat modeling: see [references/threat-model.md](references/threat-model.md)
```

Linking to `references/` keeps the top-level skill small — those files are only loaded if the model decides it needs them.

## Registering a skill

There are three ways to make a skill available:

### 1. Ship it in a plugin (recommended for reuse)

Place the skill folder under `<plugin>/skills/<skill-name>/`. When the plugin is enabled, Ptah auto-junctions the skill into `<workspace>/.claude/skills/`. See [Creating plugins](/plugins/creating-plugins/).

### 2. Create it on the fly with `ptah_harness_create_skill`

From any chat session:

```text
Call ptah_harness_create_skill with:
{
  "name": "my-skill",
  "description": "Use when ...",
  "body": "# My Skill\n\n..."
}
```

Ptah writes the skill under `<workspace>/.claude/skills/my-skill/SKILL.md` and registers it immediately. Ideal for capturing a reusable workflow you just discovered.

### 3. Drop a folder into `.claude/skills/`

Manually create `<workspace>/.claude/skills/<skill-name>/SKILL.md` with valid frontmatter. Ptah picks it up on the next session start.

## Testing your skill

1. Ensure `SKILL.md` frontmatter parses (valid YAML).
2. Open a new chat session — Ptah re-indexes skills on each session.
3. Ask a question that should trigger your skill. Watch the chat's **Active skills** chip to confirm it was invoked.
4. If it doesn't fire, tighten the `description`.

:::tip
Use `ptah_harness_search_skills` to verify the skill is discoverable by keyword before relying on automatic trigger selection.
:::

## Versioning and evolution

- Bump `version` in frontmatter for breaking changes.
- Keep the skill's `name` stable — changing it invalidates any workflow that references it.
- Link to `references/` rather than inlining — long skills hurt trigger precision.

## Next steps

- [Skill junctions & sharing with other AI clients](/mcp-and-skills/skills/)
- [Browse popular skills](/mcp-and-skills/popular-skills/)
