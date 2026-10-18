---
name: react-nx-patterns
description: React and Next.js in Nx monorepos. Use when setting up React or Next.js in Nx, organizing React libraries and module boundaries, container vs presentational components, Server Components or the app router. Not for Angular or NestJS workspaces — use nx-workspace-architect.
---

# React NX Patterns

## Core Principle: Libs Over Apps

- **Apps**: Thin Next.js shells that bootstrap libraries. Minimal routing and layout code.
- **Libs**: Where 95%+ of code lives. Organized by domain and type.

## Library Type Quick Reference for React

| Type           | Purpose                                     | Naming               | Tags                  | Examples                      |
| -------------- | ------------------------------------------- | -------------------- | --------------------- | ----------------------------- |
| feature        | Pages, layouts, smart components (RSC/RCC)  | `feature-[name]`     | `type:feature`        | User dashboard, checkout flow |
| ui             | Presentational components (reusable)        | `ui-[name]`          | `type:ui`             | Button, Card, Modal           |
| data-access    | API clients, state management, server hooks | `data-access-[name]` | `type:data-access`    | User service, product API     |
| util           | Pure functions, helpers                     | `util-[name]`        | `type:util`           | formatDate, validateEmail     |
| api-interfaces | Shared types, DTOs, Zod schemas             | `api-interfaces`     | `type:api-interfaces` | UserDto, ApiResponse types    |

## Domain-Based Organization Pattern

```
libs/
├── [domain]/                    # e.g., user-management, products
│   ├── feature/                 # Next.js pages, layouts, RSC
│   │   ├── src/
│   │   │   ├── pages/          # Route components
│   │   │   ├── layouts/        # Layout components
│   │   │   └── components/     # Domain-specific smart components
│   ├── ui/                      # Domain UI components
│   │   └── src/
│   │       ├── user-card/
│   │       ├── user-form/
│   │       └── user-avatar/
│   ├── data-access/             # API + state
│   │   └── src/
│   │       ├── api/            # Server actions, route handlers
│   │       ├── hooks/          # Client hooks (useUser, etc.)
│   │       └── store/          # Client state (Zustand, etc.)
│   └── util/                    # Domain utilities
├── shared/
│   ├── ui/                      # Cross-domain components
│   │   └── src/
│   │       ├── button/
│   │       ├── form/
│   │       └── layout/
│   ├── data-access/             # Shared API client, auth
│   ├── util/                    # Cross-domain utils
│   └── api-interfaces/          # Shared types + Zod schemas
└── core/
    ├── auth/                    # Auth infrastructure
    └── config/                  # App-wide config
```

## Decision Matrix

| Need                    | Action                                   |
| ----------------------- | ---------------------------------------- |
| New Next.js page        | Create in feature library                |
| Reusable UI component   | Create in ui library                     |
| Data fetching (server)  | Add to data-access/api                   |
| Data fetching (client)  | Add hook to data-access/hooks            |
| Client state management | Add to data-access/store                 |
| Pure utility function   | Add to util library                      |
| Shared types/schemas    | Add to api-interfaces                    |
| Server Actions          | Add to data-access/api with 'use server' |

## Component and Data-Access Patterns

Server-component pages, client containers, presentational UI components,
server actions, React Query hooks and Zustand stores are worked end to end in
the two pattern references below. Load the one that matches the component being
written; do not re-derive its placement from this entry.

## Module Boundaries

Dependency direction between library types is enforced by
`@nx/enforce-module-boundaries` over the type and scope tags. Load
[module-boundaries.md](references/module-boundaries.md) before wiring the
ESLint rule or choosing a library's tags.

## References

- [server-components.md](references/server-components.md) - RSC pages and
  layouts, `React.cache()` deduplication, server actions, app-router exports.
  Load for any server-rendered feature work.
- [client-components.md](references/client-components.md) - `'use client'`
  criteria, presentational component rules, React Query, Zustand, form
  patterns. Load for interactive components and client state.
- [module-boundaries.md](references/module-boundaries.md) - the
  `@nx/enforce-module-boundaries` ESLint config, tag dimensions, `project.json`
  tags. Load when wiring boundaries or tagging libraries.
- [workspace-setup.md](references/workspace-setup.md) - `create-nx-workspace`
  and generator commands, `tsconfig.base.json` paths. Load when creating the
  workspace or generating libraries.
