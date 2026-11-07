---
title: How Templates Are Used
description: How agent generation selects templates and writes agents into your project.
---

You do not apply templates one by one. The agent generation of the [setup wizard](/setup/setup-wizard/) selects the templates that fit your project and writes the agents for you.

## How templates are selected

Each template has `applicabilityRules` in its frontmatter:

| Rule                    | Meaning                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| `projectTypes`          | Project types that the template fits                              |
| `techStack`             | Technologies that the template fits                               |
| `requiredPatterns`      | File patterns that show the template is relevant                  |
| `excludePatterns`       | File patterns that lower the relevance                            |
| `minimumRelevanceScore` | The minimum score for the template to be selected                 |
| `alwaysInclude`         | When `true`, the template is always selected                      |

## What is written

PtahCode writes each generated agent to `<workspace>/.claude/agents/<name>.md`. When it writes a file, it expands the shared blocks from `_shared/` and removes the template markers. The harness sync then copies the agents to the agent folders of the other detected AI tools.

## Using the agents

The generated agents work with the `orchestration` skill and the `/orchestrate` command from `ptah-core`. Run `/orchestrate <task>` to let the orchestrator give work to those agents.

## Next steps

- [Template storage](/templates/template-storage/)
- [Creating templates](/templates/creating-templates/)
