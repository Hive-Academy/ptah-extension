---
title: Creating Templates
description: The structure and frontmatter of a PtahCode agent template.
---

An agent template is a file named `<name>.template.md` with YAML frontmatter and a Markdown body.

## Example frontmatter

```markdown title="frontend-developer.template.md"
---
templateId: frontend-developer-v2
templateVersion: 2.3.0
applicabilityRules:
  projectTypes: [React, Angular, Vue, Svelte, Node]
  requiredPatterns: ['**/components/**', '**/*.component.*']
  excludePatterns: ['**/controllers/**']
  minimumRelevanceScore: 60
  alwaysInclude: false
  techStack: [React, Angular, TypeScript]
dependencies: []
name: frontend-developer
description: >-
  Writes and changes user-interface code in this repository ...
model: opus
variables:
  CLARIFY_TRIGGER: >-
    two materially different UI structures ...
---
```

## Frontmatter fields

| Field                | Purpose                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `templateId`         | Unique template ID                                                            |
| `templateVersion`    | Version of the template                                                       |
| `applicabilityRules` | When the template is selected. See [How templates are used](/templates/using-templates/) |
| `dependencies`       | Other templates that this template needs                                      |
| `name`               | The agent name                                                                |
| `description`        | When to use the agent                                                         |
| `model`              | The model for the agent                                                       |
| `variables`          | Values for the `{{SLOT}}` placeholders in the shared blocks                   |

## Shared blocks

To include a shared block, put a marker pair on its own lines:

```markdown
<!-- STATIC:CLARIFICATION_PROTOCOL -->
<!-- /STATIC:CLARIFICATION_PROTOCOL -->
```

PtahCode replaces the content between the markers with the file `_shared/<kebab-name>.md`, for example `_shared/clarification-protocol.md`. The ID must use only capital letters and `_`. A wrong ID stops the template load with an error.

## Task-spec ownership

When you adapt a shipped specialist template, keep its task-spec limits. A specialist reads its task folder, writes its deliverable, and reports with evidence. It does not allocate task IDs.

## Publishing

Templates are in [`libs/backend/agent-generation/templates/agents/`](https://github.com/Hive-Academy/PtahCode/tree/main/libs/backend/agent-generation/templates/agents).

1. Add or change the template in a pull request.
2. Run `node scripts/generate-content-manifest.js` to make the manifest again.

Templates that you copy into `~/.ptah/templates/agents/` are deleted at the next content download. See [Template storage](/templates/template-storage/).

## Next steps

- [Template storage](/templates/template-storage/)
- [How templates are used](/templates/using-templates/)
