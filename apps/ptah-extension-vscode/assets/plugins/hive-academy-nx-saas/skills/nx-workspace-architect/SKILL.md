---
name: nx-workspace-architect
description: Expert guidance for Nx monorepo architecture with Angular and NestJS; use when setting up new Nx workspace, creating or organizing libraries, naming conventions and tagging strategy, enforcing module boundaries, building custom generators, structuring apps vs libs, domain-driven library organization, or TypeScript path configuration.
---

# Nx Workspace Architect

Guide for building scalable, maintainable Nx monorepos with Angular and NestJS.

## Core Principle: Libs Over Apps

- **Apps**: Thin shells that bootstrap and expose libraries. Minimal code.
- **Libs**: Where 90%+ of code lives. Organized by domain and type.

## Library Type Quick Reference

| Type           | Platform | Purpose                          | Naming               | Tags                  |
| -------------- | -------- | -------------------------------- | -------------------- | --------------------- |
| feature        | Angular  | Smart components, routes, pages  | `feature-[name]`     | `type:feature`        |
| feature-api    | NestJS   | Controllers, API endpoints       | `feature-api-[name]` | `type:feature`        |
| ui             | Angular  | Presentational components (dumb) | `ui-[name]`          | `type:ui`             |
| data-access    | Both     | State, services, repositories    | `data-access-[name]` | `type:data-access`    |
| util           | Both     | Pure functions, helpers          | `util-[name]`        | `type:util`           |
| api-interfaces | Both     | Shared DTOs, types, contracts    | `api-interfaces`     | `type:api-interfaces` |
| domain         | Both     | Domain models, value objects     | `domain`             | `type:domain`         |

## Domain-Based Organization Pattern

```
libs/
├── [domain]/                    # e.g., user-management, inventory
│   ├── feature/                 # Angular smart components
│   ├── feature-api/             # NestJS controllers
│   ├── ui/                      # Shared UI for this domain
│   ├── data-access/             # State + API clients
│   ├── domain/                  # Domain models (if DDD)
│   └── util/                    # Domain-specific utilities
├── shared/
│   ├── ui/                      # Cross-domain UI components
│   ├── util/                    # Cross-domain utilities
│   ├── data-access/             # Cross-domain state/services
│   └── api-interfaces/          # Shared DTOs and types
└── core/
    ├── auth/                    # Authentication infrastructure
    └── config/                  # App configuration
```

## Module Boundary Rules

Configure in `.eslintrc.json`:

```json
{
  "@nx/enforce-module-boundaries": [
    "error",
    {
      "depConstraints": [
        {
          "sourceTag": "type:feature",
          "onlyDependOnLibsWithTags": ["type:feature", "type:ui", "type:data-access", "type:util", "type:api-interfaces", "type:domain"]
        },
        {
          "sourceTag": "type:ui",
          "onlyDependOnLibsWithTags": ["type:ui", "type:util", "type:api-interfaces"]
        },
        {
          "sourceTag": "type:data-access",
          "onlyDependOnLibsWithTags": ["type:data-access", "type:util", "type:api-interfaces", "type:domain"]
        },
        { "sourceTag": "type:util", "onlyDependOnLibsWithTags": ["type:util"] },
        {
          "sourceTag": "type:api-interfaces",
          "onlyDependOnLibsWithTags": ["type:api-interfaces"]
        },
        {
          "sourceTag": "scope:shared",
          "onlyDependOnLibsWithTags": ["scope:shared"]
        },
        {
          "sourceTag": "scope:*",
          "onlyDependOnLibsWithTags": ["scope:shared", "scope:*"]
        }
      ]
    }
  ]
}
```

## Workspace Initialization Commands

```bash
# Create workspace
npx create-nx-workspace@latest my-workspace --preset=apps

# Add capabilities
npm install -D @nx/angular @nx/nest @nx/js

# Create apps
nx g @nx/angular:app web --style=scss --standalone --routing
nx g @nx/nest:app api

# Create domain library structure
nx g @nx/angular:lib feature --directory=user-management --standalone
nx g @nx/nest:lib feature-api --directory=user-management
nx g @nx/js:lib data-access --directory=user-management
nx g @nx/js:lib domain --directory=user-management
nx g @nx/angular:lib ui --directory=shared --standalone
nx g @nx/js:lib api-interfaces --directory=shared
```

## TypeScript Path Configuration

In `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@my-org/user-management/feature": ["libs/user-management/feature/src/index.ts"],
      "@my-org/user-management/data-access": ["libs/user-management/data-access/src/index.ts"],
      "@my-org/shared/ui": ["libs/shared/ui/src/index.ts"],
      "@my-org/shared/api-interfaces": ["libs/shared/api-interfaces/src/index.ts"]
    }
  }
}
```

## Tagging Strategy

In each library's `project.json`:

```json
{
  "tags": ["scope:user-management", "type:feature", "platform:angular"]
}
```

**Tag Dimensions:**

- `scope:` - Business domain (user-management, inventory, shared)
- `type:` - Library type (feature, ui, data-access, util)
- `platform:` - Target platform (angular, nest, shared)

## Decision Matrix

| Need                 | Action                                                      |
| -------------------- | ----------------------------------------------------------- |
| New workspace        | See [workspace-setup.md](references/workspace-setup.md)     |
| New domain/feature   | See [library-creation.md](references/library-creation.md)   |
| Import errors        | Check module boundaries in .eslintrc.json                   |
| Automate generation  | See [custom-generators.md](references/custom-generators.md) |
| Understand lib types | See [library-types.md](references/library-types.md)         |

## References

Load these as needed for detailed guidance:

- [workspace-setup.md](references/workspace-setup.md) - Full workspace initialization guide
- [library-types.md](references/library-types.md) - Deep dive on each library type
- [library-creation.md](references/library-creation.md) - Step-by-step library creation
- [module-boundaries.md](references/module-boundaries.md) - Boundary enforcement details
- [custom-generators.md](references/custom-generators.md) - Building Nx generators
