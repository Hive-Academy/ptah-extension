---
name: nx-workspace-architect
description: Nx monorepo architecture for Angular and NestJS. Use when creating a workspace, organizing or naming libraries, tags and module boundaries, custom generators or TypeScript paths. Not for React in Nx — use react-nx-patterns; not for .NET — use nx-dotnet-workspace.
---

# Nx Workspace Architect

## Apply

- During workspace design, keep apps as composition roots and place reusable domain behavior in libraries.
- Name libraries by business domain and responsibility. Tag each library by scope, type, and platform, then enforce allowed dependencies with Nx module boundaries.
- Keep imports through library public entry points and the workspace's TypeScript path mapping. Use generators for repeated layouts.

## Load by task

- For a new Nx workspace or initial apps, load [workspace setup](references/workspace-setup.md).
- For selecting feature, UI, data access, domain, or utility library types, load [library types](references/library-types.md).
- For a new domain library and its tags, load [library creation](references/library-creation.md).
- For ESLint constraints and permitted dependency direction, load [module boundaries](references/module-boundaries.md).
- For import errors between libraries, check the boundary tags and `eslint.config.mjs` using [module boundaries](references/module-boundaries.md).
- For repeatable scaffolding, load [custom generators](references/custom-generators.md).
