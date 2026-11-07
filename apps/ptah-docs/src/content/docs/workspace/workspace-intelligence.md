---
title: Workspace Intelligence
description: The context that PtahCode gives agents about your project.
---

# Workspace Intelligence

**Workspace intelligence** is the context layer between your project and the agents. It lets agents know your stack and structure without a long prompt from you.

## What agents get

| Source                 | Content                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| **Project analysis**   | The analysis files, imported through `CLAUDE.md`. Refer to [Project analysis](/workspace/project-analysis/). |
| **Code symbol index**  | A local index of functions, classes, and other symbols for fast code search. |
| **Chat memory**        | Facts extracted from earlier chats. Refer to [Memory](/memory/).         |
| **Ptah MCP tools**     | Tools such as `ptah_workspace_analyze`, `ptah_code_search_symbols`, and `ptah_get_diagnostics`. |

## The workspace index

PtahCode reads files in your workspace to build a local search index stored at `~/.ptah/state/ptah.sqlite`. Nothing is uploaded.

The index has two pipelines: **Code symbol index** and **Chat memory extraction**. You can turn off each pipeline.

Use these controls to manage the index:

- **Index now**: build the index for a workspace that is not indexed yet.
- **Re-index**: build the index again.
- **Pause** and **Resume**: stop and continue the current run.
- **Cancel**: stop the current run.

## Privacy

PtahCode keeps workspace intelligence on your machine. It sends context only to the provider of the active chat.
