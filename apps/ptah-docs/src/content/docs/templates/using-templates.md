---
title: Using Templates
description: Apply a template to your current workspace.
---

The **Templates** panel lets you browse the catalog, preview any template, and apply it to the active workspace in a single click.

![Templates panel](/screenshots/templates-panel.png)

## Applying a template

1. Open the **Templates** panel from the primary sidebar.
2. Browse or search for a template.
3. Click **Preview** to inspect the files and prompts it will add.
4. Click **Apply to workspace**.
5. Fill in any template variables (name, target folder, options).
6. Ptah writes the files and — if the template contains agent or skill definitions — registers them with the current session.

:::tip
Templates never overwrite existing files silently. When a conflict is detected, Ptah opens a diff view and asks you to accept, skip, or merge each change.
:::

## Template variables

Most templates declare variables in their metadata, for example:

```yaml
variables:
  - name: featureName
    prompt: 'Feature name (kebab-case)'
    required: true
  - name: useSignals
    prompt: 'Use Angular signals?'
    type: boolean
    default: true
```

You'll be prompted for each variable before the template is applied.

## Agent templates

Agent templates are a special case: applying one installs the agent into the workspace's `.claude/agents/` folder so it becomes spawnable via the orchestrator and visible to third-party AI clients that read that folder.

```text
<workspace>/.claude/agents/
├── frontend-developer.md
├── backend-developer.md
└── security-auditor.md
```

## Chaining templates with orchestration

Templates pair well with the `/orchestrate` skill from `ptah-core`. A common pattern:

1. Apply a **project scaffold** template.
2. Apply one or more **agent templates** for the stack.
3. Run `/orchestrate <task>` to let the orchestrator delegate to those agents.

## Next steps

- [Template storage internals](/templates/template-storage/)
- [Create your own template](/templates/creating-templates/)
