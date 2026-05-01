---
title: Skills
description: Scoped knowledge packs Ptah can invoke — and how skill junctions make them available to every AI client.
---

A **skill** is a small, focused prompt package with a deterministic trigger. When the model decides a skill is relevant, its contents are injected into context on the spot. Skills are how Ptah keeps expertise modular: one skill per topic, versioned, and reusable across providers.

## What a skill looks like

```text
skills/
└── review-security/
    ├── SKILL.md              # Definition + trigger description
    └── references/           # Optional lazy-loaded content
        ├── owasp-top-10.md
        └── threat-model.md
```

```markdown title="SKILL.md"
---
name: review-security
description: Security vulnerability review — OWASP-based assessment across any tech stack. Use when the user asks for a security review or mentions vulnerabilities, auth, or hardening.
---

# Security Review Protocol

## Phase 1: Authentication & authorization

...
```

## How Ptah decides which skill to invoke

Every skill's `description` field is the trigger. The orchestrator scans available skills and picks the ones whose descriptions match the user's intent. Matching is LLM-based, not keyword-based, so phrasing matters:

- **Good:** _"Use when the user writes Angular forms, reactive forms, or form validation."_
- **Poor:** _"Angular forms stuff."_

:::tip
Concrete verbs and nouns in the description dramatically improve skill discovery. Aim for "when to use" rather than "what it does."
:::

## Skill junctions — sharing across AI clients

Ptah goes beyond its own sessions. Every enabled plugin skill is **symlinked** (junctioned on Windows) into the active workspace at:

```text
<workspace>/.claude/skills/<skill-name>/
```

This is the folder the wider AI-tooling ecosystem reads — Claude Code, Copilot, Cursor, Codex CLI. By populating it automatically, Ptah ensures that when you switch tools for a specific task, you don't lose the knowledge pack.

```mermaid
flowchart LR
    A["~/.ptah/plugins/ptah-core/skills/orchestration/"] -- junction --> B[".claude/skills/orchestration/"]
    C["~/.ptah/plugins/ptah-angular/skills/angular-frontend-patterns/"] -- junction --> D[".claude/skills/angular-frontend-patterns/"]
    B --> E["Ptah"]
    B --> F["Copilot"]
    B --> G["Cursor"]
    D --> E
    D --> F
    D --> G
```

### Junction lifecycle

| Event                  | Ptah's action                                               |
| ---------------------- | ----------------------------------------------------------- |
| Plugin enabled         | Create junctions for every skill in the plugin              |
| Plugin disabled        | Remove the junctions (originals stay in `~/.ptah/plugins/`) |
| Plugin updated         | Junctions auto-resolve — no re-creation needed              |
| Workspace first opened | Ensure junctions exist for all enabled plugins              |

### Platform notes

| Platform | Link type          | Needs special permission?       |
| -------- | ------------------ | ------------------------------- |
| Windows  | Directory junction | No (junctions don't need admin) |
| macOS    | Symbolic link      | No                              |
| Linux    | Symbolic link      | No                              |

## Skill vs. agent — when to use which

| Skill                                              | Agent                                                     |
| -------------------------------------------------- | --------------------------------------------------------- |
| Knowledge pack injected into current context       | Separate sub-session with its own context window          |
| No token isolation                                 | Token-isolated — good for large background work           |
| Invoked automatically when description matches     | Invoked explicitly via `ptah_agent_spawn` or orchestrator |
| Best for: patterns, checklists, reference material | Best for: multi-step execution, long-running tasks        |

## Next steps

- [Browse the popular skill catalog](/mcp-and-skills/popular-skills/)
- [Create your own skill](/mcp-and-skills/creating-skills/)
