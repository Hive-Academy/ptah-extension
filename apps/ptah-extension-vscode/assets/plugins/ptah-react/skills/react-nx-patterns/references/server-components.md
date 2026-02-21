# Server Components Patterns

## React Server Components (RSC) in Nx Libraries

### Feature Library Structure for RSC

```
libs/user-management/feature/
├── src/
│   ├── pages/                    # Server Components (default)
│   │   ├── user-profile-page.tsx
│   │   └── users-list-page.tsx
│   ├── layouts/                  # Server Component layouts
│   │   └── user-settings-layout.tsx
│   ├── components/               # Mixed RSC/Client components
│   │   ├── user-list-container.tsx  # 'use client'
│   │   └── user-stats-widget.tsx    # Server Component
│   └── index.ts
```

### Server Component Best Practices

#### 1. Data Fetching in Server Components

```typescript
// libs/user-management/feature/src/pages/user-profile-page.tsx
import { getUserById, getUserPosts } from '@my-org/user-management/data-access';
import { UserHeader } from '../components/user-header';
import { PostsList } from '../components/posts-list';

interface Props {
  params: { id: string };
}

export default async function UserProfilePage({ params }: Props) {
  // Parallel data fetching
  const [user, posts] = await Promise.all([getUserById(params.id), getUserPosts(params.id)]);

  return (
    <div>
      <UserHeader user={user} />
      <PostsList posts={posts} initialUserId={params.id} />
    </div>
  );
}
```

#### 2. Use React.cache() for Deduplication

```typescript
// libs/user-management/data-access/src/api/get-user.ts
import 'server-only';
import { cache } from 'react';
import { db } from '@my-org/core/database';

// Deduplicates calls within the same render
export const getUserById = cache(async (id: string) => {
  console.log(`Fetching user ${id}`); // Only logs once per render

  const user = await db.user.findUnique({
    where: { id },
    include: { profile: true },
  });

  if (!user) throw new Error('User not found');

  return user;
});

// Multiple calls to getUserById('123') in the same render
// will only execute the database query once
```

#### 3. Streaming with Suspense

```typescript
// libs/user-management/feature/src/pages/user-dashboard-page.tsx
import { Suspense } from 'react';
import { UserStats } from '../components/user-stats';
import { RecentActivity } from '../components/recent-activity';
import { UserPosts } from '../components/user-posts';

export default function UserDashboardPage({ params }: { params: { id: string } }) {
  return (
    <div>
      <h1>Dashboard</h1>

      {/* Fast component renders immediately */}
      <Suspense fallback={<StatsSkeleton />}>
        <UserStats userId={params.id} />
      </Suspense>

      {/* Slower components stream in */}
      <Suspense fallback={<ActivitySkeleton />}>
        <RecentActivity userId={params.id} />
      </Suspense>

      <Suspense fallback={<PostsSkeleton />}>
        <UserPosts userId={params.id} />
      </Suspense>
    </div>
  );
}
```

### Server Actions in Data-Access Libraries

```typescript
// libs/user-management/data-access/src/api/update-user.ts
'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@my-org/core/database';
import { UpdateUserDto } from '@my-org/shared/api-interfaces';

export async function updateUserProfile(userId: string, data: UpdateUserDto) {
  const user = await db.user.update({
    where: { id: userId },
    data,
  });

  // Revalidate relevant pages
  revalidatePath(`/users/${userId}`);
  revalidatePath('/users');

  return { success: true, user };
}

export async function deleteUser(userId: string) {
  await db.user.delete({ where: { id: userId } });

  revalidatePath('/users');
  redirect('/users');
}
```

### Using Server Actions in Client Components

```typescript
// libs/user-management/feature/src/components/user-edit-form.tsx
'use client';

import { useTransition } from 'react';
import { updateUserProfile } from '@my-org/user-management/data-access';
import { User } from '@my-org/shared/api-interfaces';

interface Props {
  user: User;
}

export function UserEditForm({ user }: Props) {
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (formData: FormData) => {
    startTransition(async () => {
      const result = await updateUserProfile(user.id, {
        name: formData.get('name') as string,
        email: formData.get('email') as string,
      });

      if (result.success) {
        // Form will automatically show updated data on revalidation
      }
    });
  };

  return (
    <form action={handleSubmit}>
      <input name="name" defaultValue={user.name} disabled={isPending} />
      <input name="email" defaultValue={user.email} disabled={isPending} />
      <button type="submit" disabled={isPending}>
        {isPending ? 'Saving...' : 'Save'}
      </button>
    </form>
  );
}
```

## Performance Patterns

### 1. Minimize Client Bundle

Only mark components as `'use client'` when necessary:

```typescript
// ❌ Unnecessary client component
'use client';

import { User } from '@my-org/shared/api-interfaces';

export function UserDisplay({ user }: { user: User }) {
  return <div>{user.name}</div>; // No interactivity needed
}

// ✅ Server component (default)
import { User } from '@my-org/shared/api-interfaces';

export function UserDisplay({ user }: { user: User }) {
  return <div>{user.name}</div>;
}
```

### 2. Composition Pattern for Client Components

```typescript
// libs/user-management/feature/src/pages/user-page.tsx
// Server Component (default)
import { getUserById } from '@my-org/user-management/data-access';
import { InteractiveUserCard } from '../components/interactive-user-card';

export default async function UserPage({ params }: { params: { id: string } }) {
  const user = await getUserById(params.id);

  // Pass server-fetched data to client component
  return (
    <div>
      <h1>User Profile</h1>
      <InteractiveUserCard user={user} />
    </div>
  );
}

// libs/user-management/feature/src/components/interactive-user-card.tsx
('use client');

import { useState } from 'react';
import { User } from '@my-org/shared/api-interfaces';

export function InteractiveUserCard({ user }: { user: User }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div>
      <h2>{user.name}</h2>
      <button onClick={() => setIsExpanded(!isExpanded)}>{isExpanded ? 'Collapse' : 'Expand'}</button>
      {isExpanded && <div>{user.bio}</div>}
    </div>
  );
}
```

### 3. Parallel Route Fetching

```typescript
// Feature library structure
libs/user-management/feature/src/
├── pages/
│   └── user-page.tsx          # Parent route
└── components/
    ├── user-header.tsx        # Independent data fetch
    ├── user-posts.tsx         # Independent data fetch
    └── user-followers.tsx     # Independent data fetch

// libs/user-management/feature/src/pages/user-page.tsx
import { Suspense } from 'react';
import { UserHeader } from '../components/user-header';
import { UserPosts } from '../components/user-posts';
import { UserFollowers } from '../components/user-followers';

export default function UserPage({ params }: { params: { id: string } }) {
  // Each component fetches its own data in parallel
  return (
    <div>
      <Suspense fallback={<HeaderSkeleton />}>
        <UserHeader userId={params.id} />
      </Suspense>

      <div className="grid grid-cols-2">
        <Suspense fallback={<PostsSkeleton />}>
          <UserPosts userId={params.id} />
        </Suspense>

        <Suspense fallback={<FollowersSkeleton />}>
          <UserFollowers userId={params.id} />
        </Suspense>
      </div>
    </div>
  );
}
```

## Error Handling

### Error Boundaries for Server Components

```typescript
// libs/user-management/feature/src/pages/user-page/error.tsx
'use client';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div>
      <h2>Something went wrong loading this user!</h2>
      <p>{error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
```

### Server Action Error Handling

```typescript
// libs/user-management/data-access/src/api/update-user.ts
'use server';

import { z } from 'zod';

const UpdateUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

export async function updateUser(userId: string, formData: FormData) {
  try {
    // Validate input
    const data = UpdateUserSchema.parse({
      name: formData.get('name'),
      email: formData.get('email'),
    });

    // Update user
    const user = await db.user.update({
      where: { id: userId },
      data,
    });

    revalidatePath(`/users/${userId}`);

    return { success: true, user };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, errors: error.flatten() };
    }

    return { success: false, error: 'Failed to update user' };
  }
}
```

## Loading States

### Streaming with Loading UI

```typescript
// libs/user-management/feature/src/pages/user-page/loading.tsx
export default function Loading() {
  return <UserProfileSkeleton />;
}

// Alternative: Suspense boundaries for granular loading
// libs/user-management/feature/src/pages/user-page.tsx
import { Suspense } from 'react';

export default function UserPage({ params }: { params: { id: string } }) {
  return (
    <div>
      <Suspense fallback={<Skeleton />}>
        <AsyncUserContent userId={params.id} />
      </Suspense>
    </div>
  );
}
```
