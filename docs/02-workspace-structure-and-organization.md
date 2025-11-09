# Workspace Structure and Organization for Angular and NestJS in Nx

Organizing your Nx monorepo properly is crucial for maintainability, scalability, and developer efficiency. This guide outlines best practices for structuring an Nx workspace with Angular and NestJS applications.

## Default Workspace Structure

A typical Nx workspace with Angular and NestJS will have the following structure:

```
my-workspace/
├── apps/                  # Deployable applications
│   ├── frontend/         # Angular application
│   │   ├── src/
│   │   ├── e2e/
│   │   └── ...
│   ├── api/              # NestJS application
│   │   ├── src/
│   │   └── ...
│   └── ...
├── libs/                  # Shared code libraries
│   ├── frontend/         # Frontend-specific libraries
│   ├── api/              # Backend-specific libraries
│   ├── shared/           # Shared across frontend and backend
│   └── ...
├── tools/                 # Workspace-specific tooling
├── nx.json                # Nx configuration
├── workspace.json        # Workspace configuration
├── tsconfig.base.json    # Base TypeScript configuration
├── package.json          # Workspace dependencies
└── ...
```

## Organization Principles

### 1. Apps vs. Libs

- **Apps**: Contain minimal code and primarily serve to expose and bootstrap libraries
- **Libs**: Where most of your code lives, organized into different categories and domains

### 2. Domain-driven Organization

Structure your libraries around business domains rather than technical concerns:

```
libs/
├── user-management/      # Domain: User Management
│   ├── feature/          # Smart components for user management
│   ├── ui/               # Presentational components
│   ├── data-access/      # State management and API access
│   ├── util/             # Utility functions
│   └── api/              # Backend implementation
├── inventory/            # Domain: Inventory
│   ├── feature/
│   ├── ui/
│   └── ...
└── ...
```

This approach:

- Keeps related code together (frontend and backend)
- Makes it easier to understand business domains
- Simplifies adding or modifying features
- Improves code navigation

### 3. Angular and NestJS Domain Alignment

Align your Angular and NestJS domains to maintain clarity and consistency:

```
libs/
├── user-management/
│   ├── feature/          # Angular feature libraries
│   ├── ui/               # Angular UI components
│   ├── data-access/      # Angular services and state
│   └── api/              # NestJS implementation
├── shared/
│   ├── models/           # Shared TypeScript interfaces
│   ├── utils/            # Shared utilities
│   └── constants/        # Shared constants
└── ...
```

## Library Categorization

Categorize your libraries based on their purpose and responsibility:

### 1. Feature Libraries

Angular feature libraries implement specific business use cases or pages:

```
libs/user-management/feature-user-profile/
libs/user-management/feature-user-list/
libs/inventory/feature-product-catalog/
```

NestJS feature modules implement specific API endpoints or services:

```
libs/user-management/api-user-profile/
libs/inventory/api-product-catalog/
```

### 2. UI Libraries (Angular)

```
libs/user-management/ui-user-card/
libs/user-management/ui-user-form/
libs/shared/ui-buttons/
libs/shared/ui-forms/
```

### 3. Data-access Libraries

Angular data-access libraries:

```
libs/user-management/data-access/
libs/inventory/data-access/
```

NestJS data-access libraries:

```
libs/user-management/data-access-db/
libs/inventory/data-access-db/
```

### 4. Utility Libraries

```
libs/shared/util-formatting/
libs/shared/util-testing/
```

### 5. API Interface Libraries

Shared interfaces between Angular and NestJS:

```
libs/shared/api-interfaces/
```

## Scopes and Tags

Use scopes and tags to enforce boundaries and dependencies:

```json
// nx.json
{
  "npmScope": "my-org",
  "projects": {
    "frontend": {
      "tags": ["scope:app", "type:application"]
    },
    "api": {
      "tags": ["scope:api", "type:application"]
    },
    "user-management-feature": {
      "tags": ["scope:user-management", "type:feature"]
    },
    "user-management-data-access": {
      "tags": ["scope:user-management", "type:data-access"]
    },
    "shared-util": {
      "tags": ["scope:shared", "type:util"]
    }
  }
}
```

## Avoiding Common Pitfalls

### 1. Don't Organize by Technical Concern

Avoid organizing code by technical concerns:

```
❌ Bad:
libs/
├── components/
├── services/
├── models/
└── utils/
```

This approach makes it difficult to navigate and understand related code.

### 2. Don't Create Overly Generic Libraries

Avoid creating libraries that are too generic and try to serve multiple purposes:

```
❌ Bad:
libs/shared/common/
```

Instead, create focused libraries with clear responsibilities:

```
✅ Good:
libs/shared/ui-forms/
libs/shared/util-date/
```

### 3. Don't Mix Angular and NestJS Code in the Same Library

Keep Angular and NestJS code in separate libraries:

```
❌ Bad:
libs/user-management/mixed-frontend-backend/
```

Instead, separate them but keep them in the same domain:

```
✅ Good:
libs/user-management/feature-profile/  # Angular
libs/user-management/api-profile/      # NestJS
```

## Recommended Folder Structure

Here's a comprehensive example of a well-organized Angular and NestJS monorepo:

```
workspace/
├── apps/
│   ├── frontend/                      # Angular application
│   ├── admin/                         # Angular admin panel
│   ├── api/                           # Main NestJS API
│   └── jobs/                          # NestJS background job processor
├── libs/
│   ├── user-management/               # User domain
│   │   ├── feature-profile/           # Angular feature
│   │   ├── feature-settings/          # Angular feature
│   │   ├── ui-user-card/              # Angular UI components
│   │   ├── data-access/               # Angular services
│   │   ├── api-auth/                  # NestJS auth module
│   │   └── api-users/                 # NestJS users module
│   ├── products/                      # Products domain
│   │   ├── feature-catalog/           # Angular feature
│   │   ├── feature-details/           # Angular feature
│   │   ├── ui-product-card/           # Angular UI components
│   │   ├── data-access/               # Angular services
│   │   └── api-products/              # NestJS products module
│   ├── orders/                        # Orders domain
│   │   ├── feature-checkout/          # Angular feature
│   │   ├── feature-history/           # Angular feature
│   │   ├── data-access/               # Angular services
│   │   └── api-orders/                # NestJS orders module
│   └── shared/                        # Shared code
│       ├── ui-common/                 # Shared UI components
│       ├── util-formatting/           # Shared utilities
│       ├── environments/              # Environment configs
│       ├── models/                    # Shared interfaces
│       └── api-interfaces/            # Shared API DTOs
```

## Practical Implementation

### 1. Create Domain Libraries

```bash
# Create a domain folder and libraries for user management
nx g @nx/angular:lib user-management/feature-profile --tags="scope:user-management,type:feature"
nx g @nx/angular:lib user-management/ui-user-card --tags="scope:user-management,type:ui"
nx g @nx/angular:lib user-management/data-access --tags="scope:user-management,type:data-access"
nx g @nx/nest:lib user-management/api-users --tags="scope:user-management,type:api"
```

### 2. Create Shared Libraries

```bash
# Create shared libraries
nx g @nx/angular:lib shared/ui-common --tags="scope:shared,type:ui"
nx g @nx/js:lib shared/util-formatting --tags="scope:shared,type:util"
nx g @nx/js:lib shared/models --tags="scope:shared,type:model"
```

### 3. Create Applications

```bash
# Create applications
nx g @nx/angular:app frontend
nx g @nx/nest:app api
```

## Summary

A well-structured Nx monorepo for Angular and NestJS:

1. Organizes code around business domains
2. Categorizes libraries by their purpose
3. Separates frontend and backend code while keeping related code in the same domain
4. Uses scopes and tags to enforce boundaries
5. Prioritizes code sharing and reuse through focused libraries

This approach scales well as your application grows, making it easier to navigate, understand, and maintain your codebase.
