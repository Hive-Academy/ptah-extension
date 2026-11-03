# Client Components Patterns

## When to Use Client Components

Mark components with `'use client'` when they need:

1. **Interactivity** - Event handlers, state, effects
2. **Browser APIs** - localStorage, window, navigator
3. **React hooks** - useState, useEffect, useContext (except in Server Components)
4. **Third-party libs** - Most npm packages that use hooks

## Client Component Architecture in Nx

### UI Library Structure

```
libs/user-management/ui/
├── src/
│   ├── user-card/
│   │   ├── user-card.tsx           # Presentational
│   │   ├── user-card.spec.tsx
│   │   └── index.ts
│   ├── user-form/
│   │   ├── user-form.tsx           # Interactive form
│   │   ├── user-form.spec.tsx
│   │   └── index.ts
│   └── index.ts
```

## Presentational Component Pattern

```typescript
// libs/user-management/ui/src/user-card/user-card.tsx
import { User } from '@my-org/shared/api-interfaces';

interface UserCardProps {
  user: User;
  variant?: 'default' | 'compact';
  onEdit?: (userId: string) => void;
  onDelete?: (userId: string) => void;
}

export function UserCard({ user, variant = 'default', onEdit, onDelete }: UserCardProps) {
  return (
    <div className={`user-card user-card--${variant}`}>
      <img src={user.avatarUrl} alt={user.name} />

      <div className="user-card__content">
        <h3>{user.name}</h3>
        <p>{user.email}</p>
        {variant === 'default' && <p>{user.bio}</p>}
      </div>

      {(onEdit || onDelete) && (
        <div className="user-card__actions">
          {onEdit && <button onClick={() => onEdit(user.id)}>Edit</button>}
          {onDelete && <button onClick={() => onDelete(user.id)}>Delete</button>}
        </div>
      )}
    </div>
  );
}
```

**Rules for presentational components:**

- No data fetching
- No routing
- No global state access
- Data via props only
- Events via callback props
- Can compose other presentational components

## Client State Management Patterns

### 1. Local State with useState

```typescript
// libs/user-management/feature/src/components/user-filter.tsx
'use client';

import { useState } from 'react';
import { UserCard } from '@my-org/user-management/ui';

interface Props {
  users: User[];
}

export function UserFilter({ users }: Props) {
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  const filteredUsers = users.filter((user) => {
    const matchesSearch = user.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === 'all' || user.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  return (
    <div>
      <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search users..." />

      <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
        <option value="all">All Roles</option>
        <option value="admin">Admin</option>
        <option value="user">User</option>
      </select>

      <div>
        {filteredUsers.map((user) => (
          <UserCard key={user.id} user={user} />
        ))}
      </div>
    </div>
  );
}
```

### 2. Global State with Zustand (Recommended)

```typescript
// libs/user-management/data-access/src/store/user-store.ts
'use client';

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { User } from '@my-org/shared/api-interfaces';

interface UserState {
  selectedUserId: string | null;
  viewMode: 'grid' | 'list';
  filters: {
    search: string;
    role: string | null;
  };
}

interface UserActions {
  setSelectedUserId: (id: string | null) => void;
  setViewMode: (mode: 'grid' | 'list') => void;
  setFilters: (filters: Partial<UserState['filters']>) => void;
  reset: () => void;
}

const initialState: UserState = {
  selectedUserId: null,
  viewMode: 'grid',
  filters: {
    search: '',
    role: null,
  },
};

export const useUserStore = create<UserState & UserActions>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,

        setSelectedUserId: (id) => set({ selectedUserId: id }, false, 'setSelectedUserId'),

        setViewMode: (mode) => set({ viewMode: mode }, false, 'setViewMode'),

        setFilters: (filters) =>
          set(
            (state) => ({
              filters: { ...state.filters, ...filters },
            }),
            false,
            'setFilters'
          ),

        reset: () => set(initialState, false, 'reset'),
      }),
      {
        name: 'user-store',
        partialize: (state) => ({ viewMode: state.viewMode }), // Only persist viewMode
      }
    )
  )
);

// Selectors for performance
export const useSelectedUserId = () => useUserStore((state) => state.selectedUserId);

export const useViewMode = () => useUserStore((state) => state.viewMode);

export const useFilters = () => useUserStore((state) => state.filters);
```

**Usage:**

```typescript
// libs/user-management/feature/src/components/user-list-controls.tsx
'use client';

import { useUserStore } from '@my-org/user-management/data-access';

export function UserListControls() {
  const { viewMode, filters, setViewMode, setFilters } = useUserStore();

  return (
    <div>
      <input value={filters.search} onChange={(e) => setFilters({ search: e.target.value })} />

      <button onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}>Toggle View ({viewMode})</button>
    </div>
  );
}
```

### 3. React Query for Server State

```typescript
// libs/user-management/data-access/src/hooks/use-users.ts
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { User, CreateUserDto } from '@my-org/shared/api-interfaces';

// Query hooks
export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await fetch('/api/users');
      if (!res.ok) throw new Error('Failed to fetch users');
      return res.json() as Promise<User[]>;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useUser(id: string) {
  return useQuery({
    queryKey: ['user', id],
    queryFn: async () => {
      const res = await fetch(`/api/users/${id}`);
      if (!res.ok) throw new Error('Failed to fetch user');
      return res.json() as Promise<User>;
    },
    enabled: !!id, // Only fetch if id exists
  });
}

// Mutation hooks
export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateUserDto) => {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) throw new Error('Failed to create user');
      return res.json() as Promise<User>;
    },

    onSuccess: (newUser) => {
      // Update cache
      queryClient.setQueryData<User[]>(['users'], (old) => [...(old ?? []), newUser]);
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<User> }) => {
      const res = await fetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) throw new Error('Failed to update user');
      return res.json() as Promise<User>;
    },

    onSuccess: (updatedUser) => {
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.setQueryData(['user', updatedUser.id], updatedUser);
    },
  });
}
```

**Usage:**

```typescript
// libs/user-management/feature/src/components/user-list.tsx
'use client';

import { useUsers } from '@my-org/user-management/data-access';
import { UserCard } from '@my-org/user-management/ui';

export function UserList() {
  const { data: users, isLoading, error } = useUsers();

  if (isLoading) return <div>Loading users...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      {users?.map((user) => (
        <UserCard key={user.id} user={user} />
      ))}
    </div>
  );
}
```

## Form Patterns

### Uncontrolled Forms with Server Actions

```typescript
// libs/user-management/ui/src/user-form/user-form.tsx
'use client';

import { useTransition } from 'react';
import { createUser } from '@my-org/user-management/data-access';

export function UserForm() {
  const [isPending, startTransition] = useTransition();

  const handleSubmit = async (formData: FormData) => {
    startTransition(async () => {
      const result = await createUser({
        name: formData.get('name') as string,
        email: formData.get('email') as string,
      });

      if (result.success) {
        // Reset form
        const form = document.querySelector('form');
        form?.reset();
      }
    });
  };

  return (
    <form action={handleSubmit}>
      <input name="name" placeholder="Name" required disabled={isPending} />
      <input name="email" type="email" placeholder="Email" required disabled={isPending} />
      <button type="submit" disabled={isPending}>
        {isPending ? 'Creating...' : 'Create User'}
      </button>
    </form>
  );
}
```

### Controlled Forms with React Hook Form

```typescript
// libs/user-management/ui/src/user-form/user-form-controlled.tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCreateUser } from '@my-org/user-management/data-access';

const UserSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
  role: z.enum(['admin', 'user']),
});

type UserFormData = z.infer<typeof UserSchema>;

export function UserFormControlled() {
  const createUser = useCreateUser();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<UserFormData>({
    resolver: zodResolver(UserSchema),
    defaultValues: {
      role: 'user',
    },
  });

  const onSubmit = async (data: UserFormData) => {
    await createUser.mutateAsync(data);
    reset();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div>
        <input {...register('name')} placeholder="Name" disabled={isSubmitting} />
        {errors.name && <span>{errors.name.message}</span>}
      </div>

      <div>
        <input {...register('email')} type="email" placeholder="Email" disabled={isSubmitting} />
        {errors.email && <span>{errors.email.message}</span>}
      </div>

      <div>
        <select {...register('role')} disabled={isSubmitting}>
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Creating...' : 'Create User'}
      </button>
    </form>
  );
}
```

## Performance Optimization

### 1. Memoization

```typescript
'use client';

import { memo, useMemo } from 'react';
import { UserCard } from '@my-org/user-management/ui';

interface Props {
  users: User[];
  filter: string;
}

// Memoize expensive computation
export function UserList({ users, filter }: Props) {
  const filteredUsers = useMemo(() => {
    return users.filter((u) => u.name.toLowerCase().includes(filter.toLowerCase()));
  }, [users, filter]);

  return (
    <div>
      {filteredUsers.map((user) => (
        <MemoizedUserCard key={user.id} user={user} />
      ))}
    </div>
  );
}

// Memoize component
const MemoizedUserCard = memo(function UserCard({ user }: { user: User }) {
  return <UserCard user={user} />;
});
```

### 2. Virtual Lists for Large Data

```typescript
'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { UserCard } from '@my-org/user-management/ui';

export function VirtualUserList({ users }: { users: User[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: users.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100, // Estimated height of each item
    overscan: 5, // Render 5 extra items above/below viewport
  });

  return (
    <div ref={parentRef} style={{ height: '600px', overflow: 'auto' }}>
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const user = users[virtualItem.index];
          return (
            <div
              key={user.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <UserCard user={user} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```
