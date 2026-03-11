# Complete Guide: Integrating Prisma, ZenStack, and NestJS in an Nx Workspace

This comprehensive guide covers everything you need to know about setting up and using Prisma, ZenStack, and NestJS together in an Nx monorepo workspace.

## Table of Contents

1. [Overview: Understanding the Technologies](#1-overview-understanding-the-technologies)
2. [Setting Up the Nx Workspace](#2-setting-up-the-nx-workspace)
3. [Integrating Prisma with Nx](#3-integrating-prisma-with-nx)
4. [Adding ZenStack to the Mix](#4-adding-zenstack-to-the-mix)
5. [NestJS Integration](#5-nestjs-integration)
6. [Running and Testing the Application](#6-running-and-testing-the-application)
7. [Handling Multiple Prisma Schemas](#7-handling-multiple-prisma-schemas-in-an-nx-workspace)
8. [ZenStack's Automatic CRUD API](#8-zenstacks-automatic-crud-api)
9. [Error Handling Best Practices](#9-error-handling-best-practices)
10. [Database Migrations with ZenStack](#10-database-migrations-with-zenstack)
11. [Leveraging ZenStack Plugins](#11-leveraging-zenstack-plugins)
12. [Comprehensive Testing Strategy](#12-comprehensive-testing-strategy)
13. [Advanced Access Policies](#13-advanced-access-policies)
14. [Custom Nx Generators](#14-custom-nx-generators)

## 1. Overview: Understanding the Technologies

### What Each Technology Brings to the Table

**Nx**: A build system and set of extensible dev tools for monorepos. It provides:

- Structure and organization for monorepos with apps and libs
- Efficient task execution with caching and affected commands
- Consistent tooling and code sharing between projects
- Support for various frameworks including Angular and NestJS

**Prisma**: A next-generation ORM for Node.js and TypeScript that provides:

- Type-safe database access with auto-generated client
- Schema-based modeling of your database
- Migration management
- Easy to understand query API

**ZenStack**: An extension to Prisma that adds:

- Access policy definition directly in your schema
- Automatic enforcement of those policies at the ORM level
- Plugin system for extending functionality
- Automatic CRUD API generation
- Frontend data query utilities

**NestJS**: A progressive Node.js framework for building server-side applications that offers:

- A modular architecture based on dependency injection
- TypeScript support out of the box
- Integration with various libraries and tools
- Extensible plugin system

### Benefits of Combining These Technologies

1. **End-to-End Type Safety**: Share types between database schema, API, and frontend
2. **Declarative Access Control**: Define permissions in your schema instead of in controller code
3. **Reduced Boilerplate**: Generate CRUD operations and API endpoints
4. **Modular Architecture**: Organize code in a maintainable way using Nx libraries
5. **Developer Experience**: Consistent tooling and efficient workflows
6. **Scalability**: The monorepo approach allows your application to scale well as it grows

### High-level Architecture

In a typical setup combining these technologies:

1. **Database schema and access policies** are defined in ZenStack's `.zmodel` files
2. ZenStack **generates Prisma schema** and other artifacts
3. **Prisma generates** the TypeScript client for database access
4. **NestJS uses the enhanced Prisma client** (via ZenStack) to enforce access policies
5. The application is organized in an **Nx monorepo**, with clear separation between apps and libs

## 2. Setting Up the Nx Workspace

### Creating an Nx Workspace

Let's start by creating a new Nx workspace:

```bash
# Create a new workspace with the Nx CLI
npx create-nx-workspace@latest my-zenstack-workspace --preset=apps

# Change into the new workspace directory
cd my-zenstack-workspace
```

### Organizing the Monorepo Structure

Based on best practices, we should structure our monorepo with:

```
apps/
  api/                    # NestJS API application
  web/                    # Frontend application (optional)
libs/
  database/               # Contains ZenStack schema and configuration
  prisma-client/          # Generated Prisma client (optional, can use direct imports)
  api-interfaces/         # Shared interfaces between frontend and backend
  feature-*/              # Feature libraries for NestJS modules
  data-access-*/          # Data access libraries for specific entities
  util-*/                 # Utility libraries
```

### Adding NestJS to the Workspace

```bash
# Add NestJS capabilities to the workspace
npm install -D @nx/nest

# Generate a NestJS application
nx generate @nx/nest:application api
```

### Adding TypeScript Configuration

Ensure the `tsconfig.base.json` at the root of the workspace has proper path mapping:

```json
{
  "compilerOptions": {
    "paths": {
      "@my-org/database": ["libs/database/src/index.ts"],
      "@my-org/api-interfaces": ["libs/api-interfaces/src/index.ts"]
      // Add other path mappings here
    }
  }
}
```

## 3. Integrating Prisma with Nx

### Setting Up Prisma

First, we'll create a library for our database schema and install Prisma:

```bash
# Create a library for database schema
nx generate @nx/js:library database --unitTestRunner=none --bundler=none

# Install Prisma
npm install -D prisma
npm install @prisma/client
```

### Using @nx-tools/nx-prisma Plugin

The `@nx-tools/nx-prisma` plugin helps manage Prisma in an Nx workspace:

```bash
# Install the plugin
npm install -D @nx-tools/nx-prisma

# Configure Prisma for the database library
nx g @nx-tools/nx-prisma:configuration database
```

This will set up a Prisma schema in the database library and add executors to the `project.json` file.

### Initial Prisma Schema Setup

Create or modify the Prisma schema at `libs/database/prisma/schema.prisma`:

```prisma
// This is your Prisma schema file

datasource db {
  provider = "postgresql"  // or "sqlite" for local development
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
  // For monorepos with multiple schemas, use a custom output path:
  // output   = "../../../node_modules/@prisma/client/database"
}

// Define your models here
model User {
  id    Int     @id @default(autoincrement())
  email String  @unique
  name  String?
}
```

### Running Prisma Commands in Nx

After setup, you can run Prisma commands using Nx:

```bash
# Generate Prisma client
nx prisma-generate database

# Run migrations
nx prisma-migrate database

# Launch Prisma Studio
nx prisma-studio database
```

## 4. Adding ZenStack to the Mix

### Initializing ZenStack

With Prisma set up, we can now add ZenStack:

```bash
# Install ZenStack
npm install zenstack
npm install @zenstackhq/runtime

# Initialize ZenStack in the database library
cd libs/database
npx zenstack init
```

This will:

1. Create a `.zmodel` file based on your existing Prisma schema
2. Add ZenStack dependencies to your project

### Converting Prisma Schema to ZenStack Schema

The initialization step creates a `schema.zmodel` file based on your Prisma schema. Let's enhance it with access policies:

```zmodel
// This is your ZenStack schema file (schema.zmodel)

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
  // If using multiple schemas, specify the output path
  // output   = "../../../node_modules/@prisma/client/database"
}

// Define your models with access policies
model User {
  id    Int     @id @default(autoincrement())
  email String  @unique
  name  String?

  // Example access policies:
  // Anyone can create a user (sign up)
  @@allow('create', true)

  // Users can read their own data
  @@allow('read', auth() == this)

  // Users can update their own data
  @@allow('update', auth() == this)
}
```

### Generating Prisma Artifacts from ZenStack Schema

After defining your ZenStack schema, generate the Prisma artifacts:

```bash
# From the database library directory
npx zenstack generate

# Or from the workspace root
nx run database:zenstack-generate
```

ZenStack will generate:

1. A Prisma schema at `prisma/schema.prisma`
2. Additional artifacts required by ZenStack

### Adding the ZenStack Generate Command to Nx

To simplify ZenStack generation, add a custom command to your database library's `project.json`:

```json
{
  "targets": {
    "zenstack-generate": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx zenstack generate",
        "cwd": "libs/database"
      }
    }
  }
}
```

## 5. NestJS Integration

### Creating NestJS Libraries and Services

First, let's create some NestJS libraries for our API features and data access:

```bash
# Create a data-access library for users
nx g @nx/nest:library data-access-users --directory=libs/data-access

# Create a feature library for users API
nx g @nx/nest:library feature-users --directory=libs/feature
```

### Creating a Prisma Service for NestJS

Now let's create a Prisma service that can be used across our NestJS application. We'll start with a base Prisma service:

```bash
# Create a Prisma client library
nx g @nx/nest:library prisma-client --directory=libs/shared
```

Edit the generated file at `libs/shared/prisma-client/src/lib/prisma-client.service.ts`:

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // You can pass Prisma client options here
    super();
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

Then create a module file at `libs/shared/prisma-client/src/lib/prisma-client.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma-client.service';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaClientModule {}
```

Don't forget to update the public API in `libs/shared/prisma-client/src/index.ts`:

```typescript
export * from './lib/prisma-client.service';
export * from './lib/prisma-client.module';
```

### Integrating ZenStack's Enhanced Prisma Client with NestJS

To use ZenStack's enhanced Prisma client in NestJS, we need to:

1. Install the ZenStack server adapter for NestJS
2. Create a module for ZenStack
3. Configure it to use our user authentication context

```bash
# Install the ZenStack server adapter
npm install @zenstackhq/server
```

For user authentication context, we'll use [nestjs-cls](https://www.npmjs.com/package/nestjs-cls) to store the current user in an async local storage:

```bash
# Install nestjs-cls for maintaining request context
npm install nestjs-cls
```

Now, let's create a ZenStack module at `libs/shared/prisma-client/src/lib/zenstack.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ClsModule, ClsService } from 'nestjs-cls';
import { ZenStackModule } from '@zenstackhq/server/nestjs';
import { enhance } from '@zenstackhq/runtime';
import { PrismaService } from './prisma-client.service';

@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true },
    }),
    ZenStackModule.registerAsync({
      useFactory: (prisma: PrismaService, cls: ClsService) => ({
        getEnhancedPrisma: () =>
          enhance(prisma, {
            user: cls.get('auth'),
          }),
      }),
      inject: [PrismaService, ClsService],
      extraProviders: [PrismaService],
    }),
  ],
  exports: [ClsModule, ZenStackModule],
})
export class ZenStackNestModule {}
```

And export it in `libs/shared/prisma-client/src/index.ts`:

```typescript
export * from './lib/prisma-client.service';
export * from './lib/prisma-client.module';
export * from './lib/zenstack.module';
```

### Setting Up Authentication

We need to setup an interceptor that extracts the authentication information from the request and puts it into the CLS storage:

Create `libs/shared/prisma-client/src/lib/auth.interceptor.ts`:

```typescript
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Observable } from 'rxjs';

@Injectable()
export class AuthInterceptor implements NestInterceptor {
  constructor(private readonly cls: ClsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    // In a real app, get the user from JWT or session
    // This is a simplified example
    const user = request.user;

    if (user) {
      this.cls.set('auth', { id: user.id });
    }

    return next.handle();
  }
}
```

Then register the interceptor globally in your main NestJS application module:

```typescript
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaClientModule, ZenStackNestModule, AuthInterceptor } from '@my-org/prisma-client';

@Module({
  imports: [
    PrismaClientModule,
    ZenStackNestModule,
    // Other modules...
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: AuthInterceptor,
    },
  ],
})
export class AppModule {}
```

### Using the Enhanced Prisma Client in Controllers

Now you can use the enhanced Prisma client in your controllers and services:

```typescript
import { Controller, Get, Inject } from '@nestjs/common';
import { ENHANCED_PRISMA } from '@zenstackhq/server/nestjs';
import { PrismaService } from '@my-org/prisma-client';

@Controller('users')
export class UsersController {
  constructor(@Inject(ENHANCED_PRISMA) private readonly prisma: PrismaService) {}

  @Get()
  async findAll() {
    // This query will be automatically filtered based on the access policies
    return this.prisma.user.findMany();
  }
}
```

## 6. Running and Testing the Application

### Running the NestJS Application with Nx

To run the application:

```bash
# Start the NestJS API
nx serve api
```

### Setting Up Environment Variables

Create a `.env` file at the root of your workspace:

```
# Database connection string
DATABASE_URL=postgresql://username:password@localhost:5432/mydb

# Other environment variables
JWT_SECRET=your-secret-key
```

Make sure to add this file to `.gitignore` to avoid committing sensitive information.

### Testing ZenStack Access Policies

To test the access policies, you can create a simple test script or use tools like Postman or curl:

```typescript
// Example test script
async function testAccessPolicies() {
  // Create a regular Prisma client
  const prisma = new PrismaClient();

  // Create an enhanced Prisma client with a user context
  const enhancedPrisma = enhance(prisma, {
    user: { id: 1 },
  });

  // Try to access data with different permissions
  const users = await enhancedPrisma.user.findMany();
  console.log('Users accessible to user 1:', users);
}
```

## 7. Handling Multiple Prisma Schemas in an Nx Workspace

When working on larger applications, you might need multiple Prisma schemas to represent different domains or services:

1. **Create Separate Library for Each Schema**:

   ```bash
   nx g @nx/js:library schema-users --unitTestRunner=none
   nx g @nx/js:library schema-products --unitTestRunner=none
   ```

2. **Configure Custom Output Paths** in each schema's `schema.prisma`:

   ```prisma
   // In schema-users/prisma/schema.prisma
   generator client {
     provider = "prisma-client-js"
     output   = "../../../node_modules/@prisma/client/users"
   }

   // In schema-products/prisma/schema.prisma
   generator client {
     provider = "prisma-client-js"
     output   = "../../../node_modules/@prisma/client/products"
   }
   ```

3. **Create Separate Prisma Client Services** for each schema:

   ```typescript
   // users-prisma.service.ts
   import { Injectable, OnModuleInit } from '@nestjs/common';
   import { PrismaClient } from '@prisma/client/users';

   @Injectable()
   export class UsersPrismaService extends PrismaClient implements OnModuleInit {
     async onModuleInit() {
       await this.$connect();
     }
   }

   // products-prisma.service.ts
   import { Injectable, OnModuleInit } from '@nestjs/common';
   import { PrismaClient } from '@prisma/client/products';

   @Injectable()
   export class ProductsPrismaService extends PrismaClient implements OnModuleInit {
     async onModuleInit() {
       await this.$connect();
     }
   }
   ```

4. **Add Nx Commands for Each Schema**:

   ```json
   // In schema-users/project.json
   {
     "targets": {
       "prisma-generate": {
         "executor": "nx:run-commands",
         "options": {
           "command": "prisma generate",
           "cwd": "libs/schema-users"
         }
       }
     }
   }

   // Similar for schema-products/project.json
   ```

5. **Run Commands for Multiple Schemas**:
   ```bash
   # Generate all prisma clients
   nx run-many --target=prisma-generate --all
   ```

## 8. ZenStack's Automatic CRUD API

ZenStack can automatically generate CRUD API endpoints for your models:

1. **Install the RESTful API Adapter**:

   ```bash
   npm install @zenstackhq/server
   ```

2. **Create a CRUD Controller Factory**:

   ```typescript
   // Create a factory module in libs/shared/api-crud/src/lib/crud-factory.module.ts
   import { Module, DynamicModule } from '@nestjs/common';
   import { createCrudControllers, createCrudModule } from '@zenstackhq/server/nestjs-rest';
   import { PrismaService } from '@my-org/prisma-client';

   @Module({})
   export class CrudFactoryModule {
     static register(): DynamicModule {
       return {
         module: CrudFactoryModule,
         imports: [
           createCrudModule({
             provider: 'enhanced',
             prismaService: PrismaService,
             enableAuth: true,
           }),
         ],
         controllers: createCrudControllers({
           models: ['User', 'Post'], // Add your model names here
         }),
       };
     }
   }
   ```

3. **Import the CRUD Factory Module in Your App**:

   ```typescript
   import { Module } from '@nestjs/common';
   import { CrudFactoryModule } from '@my-org/api-crud';

   @Module({
     imports: [
       CrudFactoryModule.register(),
       // Other modules...
     ],
   })
   export class AppModule {}
   ```

## 9. Error Handling Best Practices

When using the enhanced Prisma client with ZenStack, consider these error handling strategies:

1. **Create a Custom Exception Filter**:

   ```typescript
   import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus } from '@nestjs/common';
   import { Response } from 'express';
   import { Prisma } from '@prisma/client';

   @Catch(Prisma.PrismaClientKnownRequestError)
   export class PrismaExceptionFilter implements ExceptionFilter {
     catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
       const ctx = host.switchToHttp();
       const response = ctx.getResponse<Response>();

       let status = HttpStatus.INTERNAL_SERVER_ERROR;
       let message = 'Internal server error';

       // Handle access policy violations (ZenStack specific)
       if (exception.code === 'P2004' && exception.message.includes('access policy')) {
         status = HttpStatus.FORBIDDEN;
         message = 'Access denied due to policy violation';
       }
       // Handle not found errors
       else if (exception.code === 'P2001') {
         status = HttpStatus.NOT_FOUND;
         message = 'Resource not found';
       }

       response.status(status).json({
         statusCode: status,
         message,
         error: exception.message,
       });
     }
   }
   ```

2. **Register the Exception Filter**:

   ```typescript
   import { Module } from '@nestjs/common';
   import { APP_FILTER } from '@nestjs/core';
   import { PrismaExceptionFilter } from './prisma-exception.filter';

   @Module({
     providers: [
       {
         provide: APP_FILTER,
         useClass: PrismaExceptionFilter,
       },
     ],
   })
   export class AppModule {}
   ```

## 10. Database Migrations with ZenStack

When using ZenStack with Prisma, migrations work as follows:

1. **Update Your ZenStack Schema**:
   Make changes to your `schema.zmodel` file.

2. **Generate Prisma Schema**:

   ```bash
   npx zenstack generate
   ```

3. **Create Migration**:

   ```bash
   # From the database library directory
   npx prisma migrate dev --name add_new_feature
   ```

4. **Add Nx Commands for Migrations**:
   ```json
   // In database library's project.json
   {
     "targets": {
       "migrate-dev": {
         "executor": "nx:run-commands",
         "options": {
           "command": "prisma migrate dev",
           "cwd": "libs/database"
         }
       },
       "migrate-deploy": {
         "executor": "nx:run-commands",
         "options": {
           "command": "prisma migrate deploy",
           "cwd": "libs/database"
         }
       }
     }
   }
   ```

## 11. Leveraging ZenStack Plugins

ZenStack has a plugin system that can extend its capabilities:

1. **OpenAPI Plugin**: Generates OpenAPI specifications from your schema.

   ```bash
   # Install the plugin
   npm install @zenstackhq/openapi
   ```

   Add to your `schema.zmodel`:

   ```zmodel
   generator openapi {
     provider = "@zenstackhq/openapi"
     output = "./openapi.yaml"
   }
   ```

2. **Markdown Documentation Plugin**: Generates documentation from your schema.

   ```bash
   # Install the plugin
   npm install zenstack-markdown
   ```

   Add to your `schema.zmodel`:

   ```zmodel
   generator markdown {
     provider = "zenstack-markdown"
     output = "./schema.md"
   }
   ```

3. **Creating a Custom Plugin**: You can create your own plugins to extend ZenStack's capabilities.

   ```typescript
   // Example of a simple plugin that logs model information
   import { Plugin } from 'zenstack/plugins';

   const myPlugin: Plugin = {
     name: 'my-plugin',
     generate: async (schema, options) => {
       console.log('Models in schema:');
       schema.models.forEach((model) => {
         console.log(`- ${model.name}`);
       });
     },
   };

   export default myPlugin;
   ```

## 12. Comprehensive Testing Strategy

A complete testing strategy for your Nx+NestJS+ZenStack application should include:

1. **Unit Testing ZenStack Access Policies**:

   ```typescript
   import { PrismaClient } from '@prisma/client';
   import { enhance } from '@zenstackhq/runtime';

   describe('User access policies', () => {
     let prisma: PrismaClient;

     beforeEach(() => {
       prisma = new PrismaClient();
     });

     it('should allow users to read their own data', async () => {
       // Create a test user
       const user = await prisma.user.create({
         data: { email: 'test@example.com', name: 'Test User' },
       });

       // Create an enhanced client with the user context
       const enhancedPrisma = enhance(prisma, { user: { id: user.id } });

       // Should be able to read own data
       const result = await enhancedPrisma.user.findUnique({
         where: { id: user.id },
       });

       expect(result).toBeDefined();
       expect(result.id).toEqual(user.id);
     });
   });
   ```

2. **Integration Testing NestJS Controllers** using the enhanced Prisma client in a test environment

3. **E2E Testing** to verify the complete API behavior with authentication

## 13. Advanced Access Policies

ZenStack allows for complex access policies. Here's an example for a multi-tenant application:

```zmodel
model Space {
  id          Int          @id @default(autoincrement())
  name        String
  members     SpaceUser[]

  // Space can be read by its members
  @@allow('read', members?[user == auth()])
  // Space can be created by anyone who's logged in
  @@allow('create', auth() != null)
  // Space can be updated and deleted by admin members
  @@allow('update,delete', members?[user == auth() && role == 'ADMIN'])
}

model SpaceUser {
  id        Int      @id @default(autoincrement())
  space     Space    @relation(fields: [spaceId], references: [id], onDelete: Cascade)
  spaceId   Int
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId    Int
  role      String   @default("USER") // "ADMIN" or "USER"

  @@unique([spaceId, userId])

  // SpaceUser can be read by members of the same space
  @@allow('read', space.members?[user == auth()])
  // SpaceUser can be created by space admins
  @@allow('create', space.members?[user == auth() && role == "ADMIN"])
  // SpaceUser can be updated and deleted by space admins
  @@allow('update,delete', space.members?[user == auth() && role == "ADMIN"])
}

model List {
  id        Int      @id @default(autoincrement())
  title     String
  private   Boolean  @default(false)
  space     Space    @relation(fields: [spaceId], references: [id], onDelete: Cascade)
  spaceId   Int
  owner     User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  ownerId   Int
  todos     Todo[]

  // List can be read by its owner or members of the space if not private
  @@allow('read', owner == auth() || (space.members?[user == auth()] && !private))
  // List can be created by space members
  @@allow('create', space.members?[user == auth()])
  // List can be updated and deleted by its owner or space admins
  @@allow('update,delete', owner == auth() || space.members?[user == auth() && role == "ADMIN"])
}
```

## 14. Custom Nx Generators

You can create custom Nx generators to automate the setup of new features with Prisma and ZenStack:

1. **Create a Generator Project**:

   ```bash
   nx g @nx/plugin:plugin my-generators
   ```

2. **Create a Generator for ZenStack Feature**:

   ```typescript
   // libs/my-generators/src/generators/zenstack-feature/generator.ts
   import { formatFiles, generateFiles, getWorkspaceLayout, names, offsetFromRoot, Tree } from '@nx/devkit';
   import * as path from 'path';

   export default async function (tree: Tree, schema: any) {
     const { name, directory } = schema;
     const { fileName, className } = names(name);

     // Define the directory structure
     const libDir = `${getWorkspaceLayout(tree).libsDir}/${directory}/${fileName}`;

     // Generate files from templates
     generateFiles(tree, path.join(__dirname, 'files'), libDir, {
       ...schema,
       fileName,
       className,
       offsetFromRoot: offsetFromRoot(libDir),
       template: '',
     });

     // Format files
     await formatFiles(tree);
   }
   ```

3. **Use the Generator**:
   ```bash
   nx g @my-org/my-generators:zenstack-feature --name=products --directory=features
   ```

## Conclusion

Combining Prisma, ZenStack, and NestJS in an Nx monorepo provides a powerful foundation for building modern, type-safe applications with declarative access control. This architecture offers:

1. **End-to-end type safety** from database to frontend
2. **Declarative access policies** defined directly in your schema
3. **Automatic CRUD API generation** to reduce boilerplate code
4. **Efficient monorepo management** with Nx's powerful tooling
5. **Modular architecture** that scales well as your application grows

By following this guide, you can set up a robust and maintainable application architecture that leverages the best features of each technology.
