---
title: Creating Skills
description: Write a skill — file layout, frontmatter, trigger descriptions, and how to make it available.
---

A skill is one folder with a `SKILL.md` file. Optional `references/` files hold long material, so that the skill itself stays small.

## Minimal skill

```text
my-skill/
└── SKILL.md
```

```markdown title="SKILL.md"
---
name: my-skill
description: One sentence that tells when to use this skill.
---

# My Skill

Write the instructions that the model must follow when it uses this skill.
```

## Recommended layout

```text
my-skill/
├── SKILL.md              # Definition, trigger, and top-level guidance
└── references/           # Optional — read only when SKILL.md links to them
    ├── patterns.md
    └── examples.md
```

## Frontmatter

| Field         | Required | Purpose                                       |
| ------------- | -------- | --------------------------------------------- |
| `name`        | Yes      | Unique identifier (kebab-case)                |
| `description` | Yes      | Trigger text. The model compares it to intent |

### Write a good `description`

The model selects a skill from its description. A good description:

- Starts with "Use when..." so that it reads as a trigger.
- Names concrete verbs and nouns that the user can say.
- States the limits of the skill, so that the model does not use it for a near but wrong case.

:::tip
**Good:** _"Use when the user asks for a security review, mentions vulnerabilities, OWASP, auth hardening, or XSS/SQLi."_

**Poor:** _"This skill helps with security stuff."_
:::

## Structure `SKILL.md`

```markdown
---
name: review-security
description: ...
---

# Security Review Protocol

## When to use

- The user asks for a security review
- A pull request touches auth, crypto, or user input

## Process

1. Identify entry points (routes, event handlers)
2. Check for OWASP Top 10 categories
3. Produce a findings report with severity

## References

- OWASP patterns: see [references/owasp-top-10.md](references/owasp-top-10.md)
```

Links to `references/` keep the top-level skill small. The model reads those files only when it needs them.

## Make a skill available

### 1. Put it in a plugin

Put the skill folder in `<plugin>/skills/<skill-name>/`. When the plugin is enabled, PtahCode copies the skill into the skill folder of each detected AI tool, for example `.claude/skills/`. See [Creating plugins](/plugins/creating-plugins/) and [Skills](/mcp-and-skills/skills/#harness-sync--sharing-across-ai-clients).

### 2. Create it with `ptah_harness_create_skill`

Ask an agent to call `ptah_harness_create_skill` with a name, a description, and a body. PtahCode writes the skill as its own harness plugin:

- `scope: "workspace"` (default): `{workspace}/.ptah/plugins/ptah-harness-<name>/skills/<name>/SKILL.md`
- `scope: "user"`: `~/.ptah/plugins/ptah-harness-<name>/skills/<name>/SKILL.md`

Harness plugins are active when PtahCode finds them. They show in the plugin catalog under **Your Skills**. See [Harness plugins](/plugins/harness-plugins/).

## Test your skill

1. Make sure that the `SKILL.md` frontmatter is valid YAML.
2. Start a new chat session.
3. Ask a question that must trigger the skill.
4. If the skill does not trigger, make the `description` more specific.

:::tip
Use `ptah_harness_search_skills` to make sure that the skill is found by keyword.
:::

## Next steps

- [Skills and harness sync](/mcp-and-skills/skills/)
- [Shipped skills](/mcp-and-skills/popular-skills/)
