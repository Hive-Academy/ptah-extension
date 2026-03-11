---
name: react-nx-patterns
description: Modern React development in Nx monorepos. Use when (1) Setting up React/Next.js in Nx workspace, (2) Creating or organizing React libraries, (3) Building React component architecture, (4) Module boundaries and dependency constraints, (5) Smart/container vs presentational components, (6) React Server Components in Nx, (7) Data fetching patterns, (8) Next.js app router integration with Nx.
---

# React NX Patterns

Scalable React/Next.js architecture in Nx monorepos with modern patterns and server components.

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

## React Component Patterns

### Feature Library (Smart Components)

```typescript
// libs/user-management/feature/src/pages/user-profile-page.tsx
// This is a React Server Component by default (Next.js 13+)
import { UserProfileCard } from '@my-org/user-management/ui';
import { getUserById } from '@my-org/user-management/data-access';

export default async function UserProfilePage({ params }: { params: { id: string } }) {
  // Server-side data fetching
  const user = await getUserById(params.id);

  return (
    <div>
      <h1>User Profile</h1>
      <UserProfileCard user={user} />
    </div>
  );
}
```

### Feature Library (Client Component Container)

```typescript
// libs/user-management/feature/src/components/user-list-container.tsx
'use client';

import { useState } from 'react';
import { UserCard } from '@my-org/user-management/ui';
import { useUsers } from '@my-org/user-management/data-access';

export function UserListContainer() {
  const [filter, setFilter] = useState('');
  const { data: users, isLoading } = useUsers();

  const filteredUsers = users?.filter((u) => u.name.toLowerCase().includes(filter.toLowerCase()));

  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter users..." />

      {filteredUsers?.map((user) => (
        <UserCard key={user.id} user={user} />
      ))}
    </div>
  );
}
```

### UI Library (Presentational/Dumb Components)

```typescript
// libs/user-management/ui/src/user-card/user-card.tsx
import { User } from '@my-org/shared/api-interfaces';

interface UserCardProps {
  user: User;
  onEdit?: (userId: string) => void;
}

export function UserCard({ user, onEdit }: UserCardProps) {
  return (
    <div className="user-card">
      <img src={user.avatarUrl} alt={user.name} />
      <h3>{user.name}</h3>
      <p>{user.email}</p>
      {onEdit && <button onClick={() => onEdit(user.id)}>Edit</button>}
    </div>
  );
}
```

**Characteristics:**

- No external dependencies (API calls, routing, etc.)
- Data via props only
- Events via callback props
- Highly reusable and testable

## Data-Access Patterns

### Server-Side Data Access (React Server Components)

```typescript
// libs/user-management/data-access/src/api/get-user.ts
import 'server-only'; // Ensure this runs on server only
import { db } from '@my-org/core/database';
import { cache } from 'react';

// React.cache() deduplicates requests per render
export const getUserById = cache(async (id: string) => {
  const user = await db.user.findUnique({ where: { id } });

  if (!user) {
    throw new Error('User not found');
  }

  return user;
});

// Server Actions
('use server');
export async function updateUser(id: string, data: UpdateUserDto) {
  const user = await db.user.update({
    where: { id },
    data,
  });

  revalidatePath(`/users/${id}`);
  return user;
}
```

### Client-Side Data Access (React Client Components)

```typescript
// libs/user-management/data-access/src/hooks/use-users.ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { User } from '@my-org/shared/api-interfaces';

async function fetchUsers(): Promise<User[]> {
  const res = await fetch('/api/users');
  if (!res.ok) throw new Error('Failed to fetch users');
  return res.json();
}

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
  });
}

export function useUser(id: string) {
  return useQuery({
    queryKey: ['user', id],
    queryFn: () => fetch(`/api/users/${id}`).then((r) => r.json()),
  });
}
```

### Client State Management (Zustand Example)

```typescript
// libs/user-management/data-access/src/store/user-store.ts
'use client';

import { create } from 'zustand';
import { User } from '@my-org/shared/api-interfaces';

interface UserStore {
  selectedUserId: string | null;
  users: User[];
  setSelectedUserId: (id: string | null) => void;
  setUsers: (users: User[]) => void;
}

export const useUserStore = create<UserStore>((set) => ({
  selectedUserId: null,
  users: [],
  setSelectedUserId: (id) => set({ selectedUserId: id }),
  setUsers: (users) => set({ users }),
}));
```

## Module Boundary Rules for React

Configure in `.eslintrc.json`:

```json
{
  "@nx/enforce-module-boundaries": [
    "error",
    {
      "depConstraints": [
        {
          "sourceTag": "type:feature",
          "onlyDependOnLibsWithTags": ["type:feature", "type:ui", "type:data-access", "type:util", "type:api-interfaces"]
        },
        {
          "sourceTag": "type:ui",
          "onlyDependOnLibsWithTags": ["type:ui", "type:util", "type:api-interfaces"]
        },
        {
          "sourceTag": "type:data-access",
          "onlyDependOnLibsWithTags": ["type:data-access", "type:util", "type:api-interfaces"]
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
          "sourceTag": "scope:shared",
          "onlyDependOnLibsWithTags": ["scope:shared"]
        }
      ]
    }
  ]
}
```

## Workspace Initialization

### Create Nx Workspace with Next.js

```bash
# Create workspace with Next.js preset
npx create-nx-workspace@latest my-workspace --preset=next

# Or add Next.js to existing workspace
npm install -D @nx/next
nx g @nx/next:app web --style=tailwind --appDir
```

### Create Domain Library Structure

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

## Tagging Strategy

In each library's `project.json`:

```json
{
  "tags": ["scope:user-management", "type:feature", "platform:react"]
}
```

**Tag Dimensions:**

- `scope:` - Business domain (user-management, products, shared)
- `type:` - Library type (feature, ui, data-access, util)
- `platform:` - Target platform (react, next, shared)

## Next.js 13+ App Router Integration

### Feature Library Exports

```typescript
// libs/user-management/feature/src/index.ts
export { default as UserProfilePage } from './pages/user-profile-page';
export { default as UsersListPage } from './pages/users-list-page';
export { UserSettingsLayout } from './layouts/user-settings-layout';
```

### App Router Usage

```typescript
// apps/web/app/users/[id]/page.tsx
import { UserProfilePage } from '@my-org/user-management/feature';

export default UserProfilePage;
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

## References

Load these for detailed implementation guidance:

- [library-organization.md](references/library-organization.md) - Detailed library structure
- [server-components.md](references/server-components.md) - RSC patterns and best practices
- [client-components.md](references/client-components.md) - Client component patterns
- [data-fetching.md](references/data-fetching.md) - Server/client data fetching strategies
- [module-boundaries.md](references/module-boundaries.md) - Boundary enforcement details
