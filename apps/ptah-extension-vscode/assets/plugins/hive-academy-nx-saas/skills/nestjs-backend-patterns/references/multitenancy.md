# Multitenancy Architecture

## Overview

Multi-tenant architecture allows a single application to serve multiple organizations (tenants) while keeping their data isolated.

## Approaches

| Approach                      | Isolation | Complexity | Cost   | Recommended For              |
| ----------------------------- | --------- | ---------- | ------ | ---------------------------- |
| Database-per-tenant           | Highest   | High       | High   | Enterprise, compliance-heavy |
| Schema-per-tenant             | High      | Medium     | Medium | Medium-scale SaaS            |
| **Shared schema + tenant ID** | Medium    | Low        | Low    | Most SaaS applications       |

This guide focuses on **shared schema with tenant ID**, enforced at the application layer using ZenStack.

## Implementation with ZenStack

### 1. Schema Design

```zmodel
// libs/database/schema.zmodel

// Organization (Tenant)
model Organization {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Relations
  members   OrganizationMember[]
  projects  Project[]

  // Anyone can create an organization
  @@allow('create', true)

  // Only members can read
  @@allow('read', members?[user == auth()])

  // Only admins can update
  @@allow('update', members?[user == auth() && role == 'ADMIN'])
}

model OrganizationMember {
  id             String       @id @default(cuid())
  organizationId String
  userId         String
  role           MemberRole   @default(MEMBER)
  createdAt      DateTime     @default(now())

  organization   Organization @relation(fields: [organizationId], references: [id])
  user           User         @relation(fields: [userId], references: [id])

  @@unique([organizationId, userId])

  // Can read if you're a member of the org
  @@allow('read', organization.members?[user == auth()])

  // Only admins can manage members
  @@allow('create,update,delete', organization.members?[user == auth() && role == 'ADMIN'])
}

enum MemberRole {
  ADMIN
  MEMBER
  VIEWER
}

// Tenant-scoped resource
model Project {
  id             String       @id @default(cuid())
  name           String
  organizationId String
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  organization   Organization @relation(fields: [organizationId], references: [id])
  tasks          Task[]

  // Can only access projects in your organization
  @@allow('all', organization.members?[user == auth()])
}

model Task {
  id        String   @id @default(cuid())
  title     String
  completed Boolean  @default(false)
  projectId String

  project   Project  @relation(fields: [projectId], references: [id])

  // Inherit access from project
  @@allow('all', project.organization.members?[user == auth()])
}
```

### 2. Enhanced Prisma Client

```typescript
// libs/shared/prisma-client/src/lib/enhanced-prisma.service.ts
import { Injectable, Scope } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { enhance } from '@zenstackhq/runtime';
import { PrismaService } from './prisma.service';

@Injectable({ scope: Scope.REQUEST })
export class EnhancedPrismaService {
  constructor(private readonly prisma: PrismaService, private readonly cls: ClsService) {}

  get client() {
    const user = this.cls.get('user');

    if (!user) {
      // Return enhanced client with no user context
      // ZenStack will deny most operations
      return enhance(this.prisma);
    }

    return enhance(this.prisma, {
      user: {
        id: user.id,
        // Pass any data needed for access policies
      },
    });
  }
}
```

### 3. Request Context Setup

```typescript
// libs/shared/auth/src/lib/auth.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { JwtService } from '@nestjs/jwt';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(private readonly cls: ClsService, private readonly jwtService: JwtService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const token = this.extractToken(req);

    if (token) {
      try {
        const payload = this.jwtService.verify(token);

        // Store user in CLS for use by EnhancedPrismaService
        this.cls.set('user', {
          id: payload.sub,
          organizationId: payload.organizationId,
        });

        req['user'] = payload;
      } catch {
        // Invalid token - continue without user context
      }
    }

    next();
  }

  private extractToken(req: Request): string | undefined {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }
    return undefined;
  }
}
```

### 4. Module Setup

```typescript
// libs/shared/prisma-client/src/lib/prisma-client.module.ts
import { Global, Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { PrismaService } from './prisma.service';
import { EnhancedPrismaService } from './enhanced-prisma.service';
import { AuthMiddleware } from './auth.middleware';

@Global()
@Module({
  imports: [
    ClsModule.forRoot({
      middleware: { mount: true },
    }),
  ],
  providers: [PrismaService, EnhancedPrismaService],
  exports: [PrismaService, EnhancedPrismaService],
})
export class PrismaClientModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes('*');
  }
}
```

### 5. Using in Services

```typescript
// libs/[domain]/data-access/src/lib/project.repository.ts
import { Injectable } from '@nestjs/common';
import { EnhancedPrismaService } from '@my-org/shared/prisma-client';
import { CreateProjectDto } from './dto/create-project.dto';

@Injectable()
export class ProjectRepository {
  constructor(private readonly prisma: EnhancedPrismaService) {}

  async findAll() {
    // ZenStack automatically filters by user's organizations
    return this.prisma.client.project.findMany({
      include: { tasks: true },
    });
  }

  async findById(id: string) {
    // Returns null if user doesn't have access
    return this.prisma.client.project.findUnique({
      where: { id },
    });
  }

  async create(data: CreateProjectDto) {
    // ZenStack validates user has permission to create
    // in the specified organization
    return this.prisma.client.project.create({ data });
  }

  async update(id: string, data: Partial<CreateProjectDto>) {
    // Throws if user doesn't have access
    return this.prisma.client.project.update({
      where: { id },
      data,
    });
  }
}
```

## Organization Context Selection

### Via JWT Claims

```typescript
// User selects organization at login or switch
interface JwtPayload {
  sub: string; // User ID
  email: string;
  organizationId: string; // Currently active organization
  role: string; // Role in current organization
}
```

### Via Header

```typescript
// Support organization context via header
@Injectable()
export class OrganizationMiddleware implements NestMiddleware {
  async use(req: Request, res: Response, next: NextFunction) {
    const orgId = req.headers['x-organization-id'] as string;

    if (orgId) {
      // Verify user has access to this organization
      const hasAccess = await this.verifyAccess(req.user?.id, orgId);
      if (hasAccess) {
        this.cls.set('organizationId', orgId);
      }
    }

    next();
  }
}
```

### Via URL

```typescript
// Organization as subdomain or path
@Controller(':orgSlug/projects')
export class ProjectsController {
  @Get()
  async findAll(@Param('orgSlug') orgSlug: string) {
    // Resolve org and check access
    const org = await this.orgService.findBySlug(orgSlug);
    return this.projectService.findByOrganization(org.id);
  }
}
```

## Testing Multitenancy

```typescript
describe('ProjectRepository', () => {
  let repository: ProjectRepository;
  let tenant1User: User;
  let tenant2User: User;

  beforeEach(async () => {
    // Create two tenants with their own data
    const org1 = await createTestOrganization('Tenant 1');
    const org2 = await createTestOrganization('Tenant 2');

    tenant1User = await createTestUser(org1.id);
    tenant2User = await createTestUser(org2.id);

    // Create projects in each tenant
    await createTestProject(org1.id, 'Project A');
    await createTestProject(org2.id, 'Project B');
  });

  it('should only return projects from user tenant', async () => {
    // Set context to tenant1 user
    cls.set('user', { id: tenant1User.id });

    const projects = await repository.findAll();

    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('Project A');
  });

  it('should not access other tenant projects', async () => {
    cls.set('user', { id: tenant1User.id });

    const project = await repository.findById(tenant2ProjectId);

    expect(project).toBeNull();
  });
});
```

## Security Considerations

1. **Always use enhanced client**: Never use raw Prisma client for tenant data
2. **Validate organization access**: When switching organizations, verify membership
3. **Audit logging**: Log cross-tenant access attempts
4. **Rate limiting per tenant**: Prevent one tenant from affecting others
5. **Background jobs**: Ensure proper context when processing async tasks
