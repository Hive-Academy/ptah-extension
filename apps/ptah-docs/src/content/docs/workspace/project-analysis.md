---
title: Project Analysis
description: How Ptah scans your workspace to detect stack, patterns, quality, and dependencies.
---

# Project Analysis

When you open a workspace, Ptah runs a **multi-phase project analysis**. The result is a structured snapshot of your codebase that every agent can reference without re-scanning.

<video controls preload="metadata" playsinline style="width:100%;border-radius:0.5rem;border:1px solid var(--sl-color-gray-5);margin:1rem 0;">
  <source src="/assets/videos/setup-wizard-analysis.mp4" type="video/mp4" />
</video>

Analysis is incremental — after the first full scan, subsequent runs only re-examine what changed since the last analysis timestamp.

## Phases

| Phase                    | What it does                                                                             | Typical output                                   |
| ------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Tech stack detection** | Identifies languages, frameworks, runtimes, build tools                                  | `TypeScript`, `Angular 20`, `Nx`, `Electron`     |
| **Pattern recognition**  | Detects architectural patterns, conventions, module layouts                              | `Nx monorepo`, `feature-sliced`, `signals-based` |
| **Quality metrics**      | Runs lightweight checks: file size distribution, test coverage hints, TODO/FIXME density | `~82% files under 300 LOC`, `0.4 TODO/KLOC`      |
| **Dependency analysis**  | Parses `package.json`, `requirements.txt`, `Cargo.toml`, `go.mod`, etc.                  | Direct/transitive dep graph, outdated warnings   |
| **Plugin analysis**      | Scans `.ptah/plugins/` and enabled community plugins for project-relevant agents/skills  | `angular-frontend-patterns` auto-enabled         |

## Running analysis

Analysis runs automatically on:

- First open of a workspace.
- Workspace switch.
- Manual trigger via **Workspace → Re-analyze Project**.

You can also invoke it programmatically from any agent using the `ptah_workspace_analyze` MCP tool:

```json
{
  "tool": "ptah_workspace_analyze",
  "arguments": {
    "includeDependencies": true,
    "includePatterns": true
  }
}
```

## Where results live

Analysis output is cached in `.ptah/analysis/` inside your workspace. The cache is safe to commit (if you want teammates to skip the initial scan) or to gitignore (the default).

```
my-project/
├── .ptah/
│   └── analysis/
│       ├── stack.json         # Detected tech stack
│       ├── patterns.json      # Architectural patterns
│       ├── quality.json       # Quality metrics
│       └── deps.json          # Dependency graph
└── ...
```

:::note
Analysis is read-only. It never modifies your source files, runs your build, or executes project code. It uses static inspection only.
:::

## How agents use it

Every agent receives the analysis snapshot as part of its initial context. That's why, for example, the frontend agent automatically suggests signals-based patterns for an Angular project without you having to mention the framework.

See [Workspace intelligence](/workspace/workspace-intelligence/) for the full list of context sources.
