# Workspace Setup Guide

## Creating a New Nx Workspace

### Step 1: Initialize Workspace

```bash
# Create with apps preset (recommended for Angular + NestJS)
npx create-nx-workspace@latest my-saas-app --preset=apps

cd my-saas-app
```

### Step 2: Add Framework Capabilities

```bash
# Add Angular & NestJS plugins
npm install -D @nx/angular @nx/nest @nx/js

# Optional: Add testing capabilities
npm install -D @nx/jest @nx/cypress
```

### Step 3: Create Applications

```bash
# Frontend (Angular)
nx g @nx/angular:app web --style=scss --standalone --routing

# Backend (NestJS)
nx g @nx/nest:app api

# Optional: Admin panel
nx g @nx/angular:app admin --style=scss --standalone --routing
```

### Step 4: Create Core Libraries

```bash
# Shared types (used by both frontend and backend)
nx g @nx/js:lib api-interfaces --directory=shared --unitTestRunner=jest

# Shared utilities
nx g @nx/js:lib util --directory=shared --unitTestRunner=jest

# Database library (for Prisma/ZenStack)
nx g @nx/js:lib database --unitTestRunner=none --bundler=none
```

## Recommended Directory Structure

```
my-saas-app/
├── apps/
│   ├── web/                      # Angular frontend
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── app.component.ts
│   │   │   │   ├── app.config.ts
│   │   │   │   └── app.routes.ts
│   │   │   └── main.ts
│   │   └── project.json
│   ├── api/                      # NestJS backend
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   └── app.module.ts
│   │   │   └── main.ts
│   │   └── project.json
│   └── web-e2e/                  # E2E tests
├── libs/
│   ├── shared/
│   │   ├── api-interfaces/       # DTOs, types
│   │   ├── ui/                   # Shared components
│   │   └── util/                 # Shared utilities
│   ├── core/
│   │   ├── auth/                 # Auth infrastructure
│   │   └── config/               # Configuration
│   └── [domain]/                 # Business domains
│       ├── feature/
│       ├── feature-api/
│       ├── data-access/
│       └── ui/
├── tools/                        # Workspace tooling
├── nx.json                       # Nx configuration
├── tsconfig.base.json           # Root TypeScript config
└── package.json
```

## Configuration Files

### nx.json

```json
{
  "$schema": "./node_modules/nx/schemas/nx-schema.json",
  "defaultBase": "main",
  "namedInputs": {
    "default": ["{projectRoot}/**/*", "sharedGlobals"],
    "production": ["default", "!{projectRoot}/**/?(*.)+(spec|test).[jt]s?(x)"],
    "sharedGlobals": []
  },
  "targetDefaults": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["production", "^production"],
      "cache": true
    },
    "test": {
      "inputs": ["default", "^production"],
      "cache": true
    },
    "lint": {
      "inputs": ["default"],
      "cache": true
    }
  }
}
```

### tsconfig.base.json

```json
{
  "compilerOptions": {
    "rootDir": ".",
    "sourceMap": true,
    "declaration": false,
    "moduleResolution": "node",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "importHelpers": true,
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022", "DOM"],
    "skipLibCheck": true,
    "skipDefaultLibCheck": true,
    "baseUrl": ".",
    "paths": {
      "@my-org/shared/api-interfaces": ["libs/shared/api-interfaces/src/index.ts"],
      "@my-org/shared/ui": ["libs/shared/ui/src/index.ts"],
      "@my-org/shared/util": ["libs/shared/util/src/index.ts"]
    }
  },
  "exclude": ["node_modules", "tmp"]
}
```

## Common Nx Commands

```bash
# Serve applications
nx serve web          # Angular app on http://localhost:4200
nx serve api          # NestJS app on http://localhost:3000

# Build for production
nx build web --configuration=production
nx build api --configuration=production

# Test
nx test my-lib        # Unit tests
nx e2e web-e2e        # E2E tests

# Lint
nx lint my-lib
nx lint --all         # Lint everything

# Affected commands (only changed projects)
nx affected -t test
nx affected -t build
nx affected -t lint

# Generate dependency graph
nx graph

# Reset cache
nx reset
```

## Environment Configuration

### For NestJS (apps/api)

Create `.env` files:

```bash
# .env.local (development)
DATABASE_URL=postgresql://localhost:5432/mydb
JWT_SECRET=dev-secret
STRIPE_SECRET_KEY=sk_test_xxx

# .env.production (production)
DATABASE_URL=${DATABASE_URL}
JWT_SECRET=${JWT_SECRET}
STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}
```

### For Angular (apps/web)

Use `environment.ts` files:

```typescript
// apps/web/src/environments/environment.ts
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api',
};

// apps/web/src/environments/environment.prod.ts
export const environment = {
  production: true,
  apiUrl: '/api',
};
```
