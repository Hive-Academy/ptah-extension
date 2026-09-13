---
title: Creating Templates
description: Structure and metadata for authoring Ptah templates.
---

A template is a Markdown or folder-based artifact with **YAML frontmatter** that tells Ptah how to present and apply it. The same authoring model is used for agent definitions and project scaffolds.

## Agent template

The simplest template type — a single Markdown file describing an agent:

```markdown title="agents/frontend-developer.md"
---
name: frontend-developer
description: Implements UI features with accessibility and performance in mind.
category: agent
tools: Read, Write, Edit, Grep, Glob
tags: [frontend, ui, accessibility]
---

You are a senior frontend developer. When invoked:

1. Read the task and relevant files.
2. Implement the change with clean, typed code.
3. Add or update tests.
4. Verify accessibility (keyboard nav, ARIA, contrast).
5. Summarize what changed.
```

Applying this template writes the file to `<workspace>/.claude/agents/frontend-developer.md`.

## Task-spec ownership

When adapting a shipped specialist template, preserve its task-spec boundaries: read the assigned task folder, write the requested deliverable, and report completion or blockers with evidence. Specialists do not allocate task IDs or edit `task.md` or `batches.md`; the team-leader records batch state.

Keep delegation scoped to the role. `team-leader`, `visual-reviewer`, and `ui-ux-designer` do not delegate to CLI lanes. Do not assume Ptah tools exist in every host: prefer them when listed, otherwise use native tools. See [agent orchestration](/agents/agent-orchestration/).

## Project scaffold template

Scaffolds are folders with a `template.yaml` at the root describing files and variables:

```text
my-scaffold/
├── template.yaml
├── files/
│   ├── {{featureName}}.component.ts.hbs
│   ├── {{featureName}}.component.html.hbs
│   └── {{featureName}}.component.spec.ts.hbs
└── README.md
```

```yaml title="template.yaml"
name: angular-feature-module
description: Scaffolds a new Angular standalone feature with signals.
category: scaffold
tags: [angular, signals]
variables:
  - name: featureName
    prompt: Feature name (kebab-case)
    required: true
  - name: useSignals
    prompt: Use signals?
    type: boolean
    default: true
targetPath: src/app/features/{{featureName}}
```

## Frontmatter fields

| Field         | Type                              | Required       | Purpose                                                   |
| ------------- | --------------------------------- | -------------- | --------------------------------------------------------- |
| `name`        | string                            | Yes            | Unique identifier (kebab-case)                            |
| `description` | string                            | Yes            | Shown in the Templates panel and used by the orchestrator |
| `category`    | `agent` \| `scaffold` \| `prompt` | Yes            | Determines how the template is applied                    |
| `tools`       | string list                       | No             | Tools granted to an agent template                        |
| `tags`        | string list                       | No             | Search filters                                            |
| `variables`   | list                              | No             | User-provided values for `{{placeholders}}`               |
| `targetPath`  | string                            | Scaffolds only | Where files land inside the workspace                     |

## Template expressions

Template files can use Handlebars-style expressions:

```text
{{featureName}}              → provided variable
{{pascalCase featureName}}   → helper
{{#if useSignals}}...{{/if}} → conditional blocks
```

Built-in helpers: `camelCase`, `pascalCase`, `kebabCase`, `snakeCase`, `upperCase`, `lowerCase`.

## Testing locally

Drop your template under `~/.ptah/templates/` and run **Ptah: Reload Templates** from the command palette. Templates sideloaded this way are tagged **Local** and do not auto-update.

## Publishing

Submit templates to the official catalog by opening a PR against [`libs/backend/agent-generation/templates/`](https://github.com/Hive-Academy/ptah-extension/tree/main/libs/backend/agent-generation/templates) and regenerating the manifest with `node scripts/generate-content-manifest.js`.

## Next steps

- [Template storage internals](/templates/template-storage/)
- [Apply templates](/templates/using-templates/)
