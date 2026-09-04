# Module Boundaries Enforcement

## Purpose

Module boundaries prevent unwanted dependencies between projects, ensuring:

- Clear architectural layers
- Domain isolation
- Maintainable dependency graph

## Setting Up Module Boundaries

### 1. Install ESLint Plugin

```bash
npm install -D @nx/eslint-plugin
```

### 2. Configure Rules in `.eslintrc.json`

```json
{
  "root": true,
  "ignorePatterns": ["**/*"],
  "plugins": ["@nx"],
  "overrides": [
    {
      "files": ["*.ts", "*.tsx", "*.js", "*.jsx"],
      "rules": {
        "@nx/enforce-module-boundaries": [
          "error",
          {
            "enforceBuildableLibDependency": true,
            "allow": [],
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
              {
                "sourceTag": "type:util",
                "onlyDependOnLibsWithTags": ["type:util"]
              },
              {
                "sourceTag": "type:api-interfaces",
                "onlyDependOnLibsWithTags": ["type:api-interfaces"]
              },
              {
                "sourceTag": "type:domain",
                "onlyDependOnLibsWithTags": ["type:domain", "type:util"]
              },
              {
                "sourceTag": "scope:shared",
                "onlyDependOnLibsWithTags": ["scope:shared"]
              },
              {
                "sourceTag": "scope:user-management",
                "onlyDependOnLibsWithTags": ["scope:user-management", "scope:shared"]
              },
              {
                "sourceTag": "scope:orders",
                "onlyDependOnLibsWithTags": ["scope:orders", "scope:user-management", "scope:shared"]
              },
              {
                "sourceTag": "platform:angular",
                "onlyDependOnLibsWithTags": ["platform:angular", "platform:shared"]
              },
              {
                "sourceTag": "platform:nest",
                "onlyDependOnLibsWithTags": ["platform:nest", "platform:shared"]
              },
              {
                "sourceTag": "platform:shared",
                "onlyDependOnLibsWithTags": ["platform:shared"]
              }
            ]
          }
        ]
      }
    }
  ]
}
```

### 3. Tag Your Projects

In each library's `project.json`:

```json
{
  "name": "user-management-feature",
  "tags": ["scope:user-management", "type:feature", "platform:angular"]
}
```

## Tag Strategy Patterns

### Dimensional Tagging

Use multiple dimensions:

| Dimension   | Purpose         | Examples                                                |
| ----------- | --------------- | ------------------------------------------------------- |
| `scope:`    | Business domain | `scope:user-management`, `scope:orders`, `scope:shared` |
| `type:`     | Library type    | `type:feature`, `type:ui`, `type:data-access`           |
| `platform:` | Target platform | `platform:angular`, `platform:nest`, `platform:shared`  |

### Full Tag Examples

```json
// Angular feature library
"tags": ["scope:user-management", "type:feature", "platform:angular"]

// NestJS controller library
"tags": ["scope:user-management", "type:feature", "platform:nest"]

// Shared data-access
"tags": ["scope:user-management", "type:data-access", "platform:shared"]

// Shared UI components
"tags": ["scope:shared", "type:ui", "platform:angular"]

// API interfaces (used by both)
"tags": ["scope:shared", "type:api-interfaces", "platform:shared"]
```

## Common Boundary Violations

### ❌ Feature importing another Feature

```typescript
// libs/orders/feature/src/lib/order-details.component.ts
// VIOLATION: feature cannot import feature
import { UserProfileComponent } from '@my-org/user-management/feature';
```

**Fix**: Extract shared functionality to `ui` or `data-access`.

### ❌ UI importing Data-Access

```typescript
// libs/shared/ui/src/lib/user-card.component.ts
// VIOLATION: ui cannot import data-access
import { UserService } from '@my-org/user-management/data-access';
```

**Fix**: Pass data via inputs. UI components should be dumb.

### ❌ Cross-Domain Import

```typescript
// libs/orders/data-access/src/lib/order.service.ts
// VIOLATION: orders cannot import inventory (unless configured)
import { InventoryService } from '@my-org/inventory/data-access';
```

**Fix**: Either allow the dependency in rules or use shared/api-interfaces.

### ❌ Platform Mismatch

```typescript
// libs/user-management/feature-api/src/lib/users.controller.ts
// VIOLATION: NestJS cannot import Angular
import { UserCardComponent } from '@my-org/user-management/ui';
```

**Fix**: NestJS should not import Angular components. Use platform:shared libs.

## Banning External Imports

Restrict npm package usage:

```json
{
  "sourceTag": "scope:user-management",
  "onlyDependOnLibsWithTags": ["scope:user-management", "scope:shared"],
  "bannedExternalImports": ["lodash"]
}
```

## Checking Boundaries

```bash
# Lint all projects
nx lint

# Check specific project
nx lint user-management-feature

# Run affected lint
nx affected -t lint
```

## Dependency Graph Visualization

```bash
# Interactive graph
nx graph

# Focus on specific project
nx graph --focus=user-management-feature

# Show only affected
nx affected:graph
```

## Best Practices

1. **Tag everything**: Every library should have scope, type, and platform tags
2. **Start strict**: Begin with restrictive rules, loosen as needed
3. **Document exceptions**: If you add to `allow`, comment why
4. **Review graph regularly**: Use `nx graph` to spot unexpected dependencies
5. **Enforce in CI**: Run `nx lint` in your CI pipeline
