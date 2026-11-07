---
title: Templates
description: The agent templates that PtahCode uses to generate project agents.
---

**Templates** in PtahCode are agent templates. Each template is a Markdown file that describes one specialist agent, for example `frontend-developer` or `software-architect`. The agent generation in the [setup wizard](/setup/setup-wizard/) uses the templates to write agents for your project.

## Where templates come from

The installer does not include the templates. The [content download](/plugins/plugin-storage/) gets them from the public GitHub repository into `~/.ptah/templates/agents/`.

## Shipped templates

| Group        | Templates                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| Planning     | `project-manager`, `software-architect`, `team-leader`, `researcher-expert`                               |
| Building     | `backend-developer`, `frontend-developer`, `devops-engineer`                                              |
| Quality      | `senior-tester`, `code-logic-reviewer`, `code-style-reviewer`, `visual-reviewer`, `modernization-detector` |
| Design and content | `ui-ux-designer`, `technical-content-writer`                                                        |

The folder `_shared/` holds blocks that many templates include, for example the clarification protocol and the tool rules.

## Next steps

- [How templates are used](/templates/using-templates/)
- [Template storage](/templates/template-storage/)
- [Creating templates](/templates/creating-templates/)
