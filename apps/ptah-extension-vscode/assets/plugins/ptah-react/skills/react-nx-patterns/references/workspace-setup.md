# Workspace Setup — Commands and Paths

## Create Nx Workspace with Next.js

```bash
# Create workspace with Next.js preset
npx create-nx-workspace@latest my-workspace --preset=next

# Or add Next.js to existing workspace
npm install -D @nx/next
nx g @nx/next:app web --style=tailwind --appDir
```

## Create Domain Library Structure

```bash
# Feature library (pages, layouts, smart components)
nx g @nx/next:lib feature --directory=user-management --unitTestRunner=vitest

# UI library (presentational components)
nx g @nx/react:lib ui --directory=user-management --unitTestRunner=vitest

# Data-access library
nx g @nx/js:lib data-access --directory=user-management --unitTestRunner=vitest

# Shared libraries
nx g @nx/react:lib ui --directory=shared --unitTestRunner=vitest
nx g @nx/js:lib api-interfaces --directory=shared --unitTestRunner=vitest
nx g @nx/js:lib util --directory=shared --unitTestRunner=vitest
```

## TypeScript Path Configuration

In `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@my-org/user-management/feature": ["libs/user-management/feature/src/index.ts"],
      "@my-org/user-management/ui": ["libs/user-management/ui/src/index.ts"],
      "@my-org/user-management/data-access": ["libs/user-management/data-access/src/index.ts"],
      "@my-org/shared/ui": ["libs/shared/ui/src/index.ts"],
      "@my-org/shared/api-interfaces": ["libs/shared/api-interfaces/src/index.ts"],
      "@my-org/shared/util": ["libs/shared/util/src/index.ts"]
    }
  }
}
```