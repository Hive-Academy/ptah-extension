# Library Creation Guide

## Creating Libraries by Domain

### Step 1: Plan Your Domain Structure

Before creating libraries, identify:

1. The business domain (e.g., `user-management`, `inventory`, `orders`)
2. What library types you need (feature, data-access, etc.)
3. Whether it's Angular-only, NestJS-only, or shared

### Step 2: Create Domain Libraries

```bash
# For a complete domain (e.g., user-management)

# Angular feature (smart components, routes)
nx g @nx/angular:lib feature \
  --directory=user-management \
  --standalone \
  --routing \
  --lazy \
  --tags="scope:user-management,type:feature,platform:angular"

# NestJS feature-api (controllers)
nx g @nx/nest:lib feature-api \
  --directory=user-management \
  --tags="scope:user-management,type:feature,platform:nest"

# Angular UI components for this domain
nx g @nx/angular:lib ui \
  --directory=user-management \
  --standalone \
  --tags="scope:user-management,type:ui,platform:angular"

# Data-access (shared between platforms)
nx g @nx/js:lib data-access \
  --directory=user-management \
  --tags="scope:user-management,type:data-access,platform:shared"

# Domain models (if using DDD)
nx g @nx/js:lib domain \
  --directory=user-management \
  --tags="scope:user-management,type:domain,platform:shared"

# Domain utilities
nx g @nx/js:lib util \
  --directory=user-management \
  --tags="scope:user-management,type:util,platform:shared"
```

### Step 3: Create Shared Libraries

```bash
# Shared UI components
nx g @nx/angular:lib ui \
  --directory=shared \
  --standalone \
  --tags="scope:shared,type:ui,platform:angular"

# Shared utilities
nx g @nx/js:lib util \
  --directory=shared \
  --tags="scope:shared,type:util,platform:shared"

# API interfaces (DTOs, types)
nx g @nx/js:lib api-interfaces \
  --directory=shared \
  --tags="scope:shared,type:api-interfaces,platform:shared"
```

## Generator Options Reference

### Angular Library Options

```bash
nx g @nx/angular:lib [name] \
  --directory=[path]        # Location under libs/
  --standalone             # Use standalone components (recommended)
  --routing                # Include routing module
  --lazy                   # Configure for lazy loading
  --changeDetection=OnPush # Default change detection
  --style=scss             # Stylesheet format
  --tags="..."             # Comma-separated tags
  --buildable              # Make it buildable (for publishing)
  --publishable            # Make it publishable to npm
```

### NestJS Library Options

```bash
nx g @nx/nest:lib [name] \
  --directory=[path]       # Location under libs/
  --tags="..."             # Comma-separated tags
  --buildable              # Make it buildable
  --publishable            # Make it publishable
  --controller             # Generate a controller
  --service                # Generate a service
```

### JavaScript/TypeScript Library Options

```bash
nx g @nx/js:lib [name] \
  --directory=[path]       # Location under libs/
  --tags="..."             # Tags
  --unitTestRunner=jest    # Test runner (jest/vitest/none)
  --bundler=tsc            # Bundler (tsc/swc/rollup/esbuild/none)
  --buildable              # Make it buildable
```

## Setting Up Path Mappings

After creating libraries, update `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@my-org/user-management/feature": ["libs/user-management/feature/src/index.ts"],
      "@my-org/user-management/feature-api": ["libs/user-management/feature-api/src/index.ts"],
      "@my-org/user-management/ui": ["libs/user-management/ui/src/index.ts"],
      "@my-org/user-management/data-access": ["libs/user-management/data-access/src/index.ts"],
      "@my-org/user-management/domain": ["libs/user-management/domain/src/index.ts"],
      "@my-org/user-management/util": ["libs/user-management/util/src/index.ts"],
      "@my-org/shared/ui": ["libs/shared/ui/src/index.ts"],
      "@my-org/shared/util": ["libs/shared/util/src/index.ts"],
      "@my-org/shared/api-interfaces": ["libs/shared/api-interfaces/src/index.ts"]
    }
  }
}
```

## Barrel File (index.ts)

Each library should export its public API:

```typescript
// libs/user-management/feature/src/index.ts
export * from './lib/user-profile/user-profile.component';
export * from './lib/user-list/user-list.component';
export * from './lib/routes'; // or routing configuration

// libs/user-management/ui/src/index.ts
export * from './lib/user-card/user-card.component';
export * from './lib/user-avatar/user-avatar.component';

// libs/user-management/data-access/src/index.ts
export * from './lib/user.service';
export * from './lib/user.store'; // if using state management

// libs/shared/api-interfaces/src/index.ts
export * from './lib/user.dto';
export * from './lib/api-response.dto';
```

## Library Internal Structure

### Angular Feature Library

```
libs/user-management/feature/
├── src/
│   ├── lib/
│   │   ├── user-profile/
│   │   │   ├── user-profile.component.ts
│   │   │   ├── user-profile.component.html
│   │   │   └── user-profile.component.scss
│   │   ├── user-list/
│   │   │   └── user-list.component.ts
│   │   └── routes.ts
│   ├── index.ts            # Public API
│   └── test-setup.ts
├── project.json
├── tsconfig.json
├── tsconfig.lib.json
└── tsconfig.spec.json
```

### NestJS Feature-API Library

```
libs/user-management/feature-api/
├── src/
│   ├── lib/
│   │   ├── controllers/
│   │   │   └── users.controller.ts
│   │   ├── dto/
│   │   │   ├── create-user.dto.ts
│   │   │   └── update-user.dto.ts
│   │   └── users.module.ts
│   └── index.ts
├── project.json
├── tsconfig.json
└── tsconfig.lib.json
```

### Data-Access Library

```
libs/user-management/data-access/
├── src/
│   ├── lib/
│   │   ├── user.service.ts       # Angular service
│   │   ├── user.repository.ts    # NestJS repository
│   │   └── user.store.ts         # State management
│   └── index.ts
├── project.json
└── tsconfig.json
```

## Verifying Library Setup

```bash
# Check the project graph
nx graph

# Verify tags are set correctly
nx show project user-management-feature

# Test the library
nx test user-management-feature

# Lint the library
nx lint user-management-feature
```
