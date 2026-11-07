---
title: Project Analysis
description: The multi-phase project analysis that the setup wizard runs and stores in .ptah/analysis/.
---

# Project Analysis

The [setup wizard](/setup/setup-wizard/) runs a multi-phase analysis of your project. The result is a set of Markdown files that agents can read without a new scan.

<video controls preload="metadata" playsinline style="width:100%;border-radius:0.5rem;border:1px solid var(--sl-color-gray-5);margin:1rem 0;">
  <source src="/assets/videos/setup-wizard-analysis.mp4" type="video/mp4" />
</video>

## Phases

| Phase | Output file                      |
| ----- | -------------------------------- |
| 1     | `01-project-profile.md`          |
| 2     | `02-architecture-assessment.md`  |
| 3     | `03-quality-audit.md`            |
| 4     | `04-elevation-plan.md`           |

## Where results live

PtahCode writes each analysis run to its own folder in `.ptah/analysis/`:

```
my-project/
└── .ptah/
    └── analysis/
        └── <slug>/
            ├── manifest.json
            ├── 01-project-profile.md
            ├── 02-architecture-assessment.md
            ├── 03-quality-audit.md
            └── 04-elevation-plan.md
```

PtahCode adds an import block for the latest analysis files to the workspace `CLAUDE.md`. Agents that read `CLAUDE.md` get the analysis. PtahCode changes only its marked block in that file.

You can commit `.ptah/analysis/` to share it with your team, or add it to `.gitignore`.

## From an agent

Agents can call the `ptah_workspace_analyze` MCP tool to get the project type, frameworks, and folder structure in one call.
