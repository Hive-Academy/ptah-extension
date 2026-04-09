# Authorization Patterns

## Overview

Authorization determines what authenticated users can do. This guide covers RBAC (Role-Based Access Control) implementation patterns.

## Architecture Layers

```
Request → Guard → Decorator → Controller → Service → ZenStack Policy
           │         │                                    │
           │         └── Extract required permissions     │
           └── Verify permissions                         └── Enforce at data layer
```

## Role and Permission Setup

### 1. Define Enums

```typescript
// libs/shared/auth/src/lib/enums/role.enum.ts
export enum Role {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
  VIEWER = 'VIEWER',
}

// libs/shared/auth/src/lib/enums/permission.enum.ts
export enum Permission {
  // User management
  USERS_READ = 'users:read',
  USERS_CREATE = 'users:create',
  USERS_UPDATE = 'users:update',
  USERS_DELETE = 'users:delete',

  // Project management
  PROJECTS_READ = 'projects:read',
  PROJECTS_CREATE = 'projects:create',
  PROJECTS_UPDATE = 'projects:update',
  PROJECTS_DELETE = 'projects:delete',

  // Organization management
  ORG_SETTINGS = 'org:settings',
  ORG_BILLING = 'org:billing',
  ORG_MEMBERS = 'org:members',
}
```

### 2. Role-Permission Mapping

```typescript
// libs/shared/auth/src/lib/role-permissions.ts
import { Role, Permission } from './enums';

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.SUPER_ADMIN]: Object.values(Permission), // All permissions

  [Role.ADMIN]: [Permission.USERS_READ, Permission.USERS_CREATE, Permission.USERS_UPDATE, Permission.PROJECTS_READ, Permission.PROJECTS_CREATE, Permission.PROJECTS_UPDATE, Permission.PROJECTS_DELETE, Permission.ORG_SETTINGS, Permission.ORG_MEMBERS],

  [Role.MEMBER]: [Permission.USERS_READ, Permission.PROJECTS_READ, Permission.PROJECTS_CREATE, Permission.PROJECTS_UPDATE],

  [Role.VIEWER]: [Permission.USERS_READ, Permission.PROJECTS_READ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
```

## Decorators

### @Roles Decorator

```typescript
// libs/shared/auth/src/lib/decorators/roles.decorator.ts
import { SetMetadata } from '@nestjs/common';
import { Role } from '../enums/role.enum';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
```

### @Permissions Decorator

```typescript
// libs/shared/auth/src/lib/decorators/permissions.decorator.ts
import { SetMetadata } from '@nestjs/common';
import { Permission } from '../enums/permission.enum';

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);
```

### @Public Decorator

```typescript
// libs/shared/auth/src/lib/decorators/public.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

## Guards

### Roles Guard

```typescript
// libs/shared/auth/src/lib/guards/roles.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../enums/role.enum';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true; // No roles required
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return false;
    }

    return requiredRoles.some((role) => user.role === role);
  }
}
```

### Permissions Guard

```typescript
// libs/shared/auth/src/lib/guards/permissions.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission } from '../enums/permission.enum';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { hasPermission } from '../role-permissions';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.role) {
      return false;
    }

    return requiredPermissions.every((permission) => hasPermission(user.role, permission));
  }
}
```

## Usage in Controllers

```typescript
// libs/[domain]/feature-api/src/lib/users.controller.ts
import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@my-org/shared/auth';
import { RolesGuard, PermissionsGuard } from '@my-org/shared/auth';
import { Roles, RequirePermissions, Public } from '@my-org/shared/auth';
import { Role, Permission } from '@my-org/shared/auth';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Public endpoint - no auth required
  @Public()
  @Get('public-stats')
  getPublicStats() {
    return this.usersService.getPublicStats();
  }

  // Requires authentication only (any role)
  @Get('me')
  getCurrentUser(@CurrentUser() user: JwtPayload) {
    return this.usersService.findById(user.sub);
  }

  // Requires specific role
  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  findAll() {
    return this.usersService.findAll();
  }

  // Requires specific permission
  @Post()
  @RequirePermissions(Permission.USERS_CREATE)
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  // Combine role and permission
  @Delete(':id')
  @Roles(Role.ADMIN)
  @RequirePermissions(Permission.USERS_DELETE)
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
```

## Resource-Level Authorization

For fine-grained access (e.g., "can this user edit THIS project?"), use ZenStack policies:

```zmodel
model Project {
  id             String       @id @default(cuid())
  name           String
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  ownerId        String
  owner          User         @relation(fields: [ownerId], references: [id])

  // Anyone in the org can read
  @@allow('read', organization.members?[user == auth()])

  // Only owner or admins can update
  @@allow('update', owner == auth() || organization.members?[user == auth() && role == 'ADMIN'])

  // Only admins can delete
  @@allow('delete', organization.members?[user == auth() && role == 'ADMIN'])
}
```

## Global Guard Registration

```typescript
// apps/api/src/main.ts or app.module.ts
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard, RolesGuard, PermissionsGuard } from '@my-org/shared/auth';

@Module({
  providers: [
    // Apply guards globally in order
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
```

## Testing Authorization

```typescript
describe('UsersController', () => {
  it('should deny access without proper role', async () => {
    const response = await request(app.getHttpServer()).get('/users').set('Authorization', `Bearer ${viewerToken}`).expect(403);
  });

  it('should allow access with admin role', async () => {
    const response = await request(app.getHttpServer()).get('/users').set('Authorization', `Bearer ${adminToken}`).expect(200);
  });
});
```
