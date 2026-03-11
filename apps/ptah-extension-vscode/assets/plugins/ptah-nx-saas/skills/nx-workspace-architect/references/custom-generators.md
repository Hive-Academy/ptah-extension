# Custom Nx Generators

## Overview

Custom generators automate repetitive scaffolding tasks specific to your workspace.

## Creating a Generator

### Step 1: Create the Generator Project

```bash
# Create a tools library for generators
nx g @nx/plugin:plugin my-generators --directory=tools
```

### Step 2: Generate a Generator

```bash
nx g @nx/plugin:generator domain-library --project=my-generators
```

This creates:

```
tools/my-generators/
├── src/
│   └── generators/
│       └── domain-library/
│           ├── generator.ts      # Generator logic
│           ├── schema.json       # Input schema
│           ├── schema.d.ts       # TypeScript types
│           └── files/            # Template files
├── generators.json
└── project.json
```

### Step 3: Define the Schema

```json
// tools/my-generators/src/generators/domain-library/schema.json
{
  "$schema": "http://json-schema.org/schema",
  "cli": "nx",
  "$id": "DomainLibrary",
  "title": "Create Domain Library Structure",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Domain name (e.g., user-management)",
      "$default": {
        "$source": "argv",
        "index": 0
      },
      "x-prompt": "What is the domain name?"
    },
    "includeApi": {
      "type": "boolean",
      "description": "Include NestJS feature-api library",
      "default": true
    },
    "includeDomain": {
      "type": "boolean",
      "description": "Include domain library (for DDD)",
      "default": false
    }
  },
  "required": ["name"]
}
```

### Step 4: Implement the Generator

```typescript
// tools/my-generators/src/generators/domain-library/generator.ts
import { Tree, formatFiles, generateFiles, joinPathFragments, names } from '@nx/devkit';
import { libraryGenerator as angularLibraryGenerator } from '@nx/angular/generators';
import { libraryGenerator as nestLibraryGenerator } from '@nx/nest/generators';
import { libraryGenerator as jsLibraryGenerator } from '@nx/js/generators';

export interface DomainLibraryGeneratorSchema {
  name: string;
  includeApi: boolean;
  includeDomain: boolean;
}

export default async function (tree: Tree, options: DomainLibraryGeneratorSchema) {
  const { name, includeApi, includeDomain } = options;
  const domainName = names(name).fileName;

  // Create Angular feature library
  await angularLibraryGenerator(tree, {
    name: 'feature',
    directory: domainName,
    standalone: true,
    routing: true,
    lazy: true,
    tags: `scope:${domainName},type:feature,platform:angular`,
  });

  // Create Angular UI library
  await angularLibraryGenerator(tree, {
    name: 'ui',
    directory: domainName,
    standalone: true,
    tags: `scope:${domainName},type:ui,platform:angular`,
  });

  // Create data-access library
  await jsLibraryGenerator(tree, {
    name: 'data-access',
    directory: domainName,
    tags: `scope:${domainName},type:data-access,platform:shared`,
  });

  // Create util library
  await jsLibraryGenerator(tree, {
    name: 'util',
    directory: domainName,
    tags: `scope:${domainName},type:util,platform:shared`,
  });

  // Optionally create NestJS feature-api
  if (includeApi) {
    await nestLibraryGenerator(tree, {
      name: 'feature-api',
      directory: domainName,
      tags: `scope:${domainName},type:feature,platform:nest`,
    });
  }

  // Optionally create domain library (DDD)
  if (includeDomain) {
    await jsLibraryGenerator(tree, {
      name: 'domain',
      directory: domainName,
      tags: `scope:${domainName},type:domain,platform:shared`,
    });

    // Generate domain template files
    generateFiles(tree, joinPathFragments(__dirname, 'files/domain'), `libs/${domainName}/domain/src/lib`, { ...options, ...names(name) });
  }

  await formatFiles(tree);

  return () => {
    console.log(`
✅ Domain "${domainName}" created with:
   - feature (Angular smart components)
   - ui (Angular presentational components)
   - data-access (state & API clients)
   - util (helper functions)
   ${includeApi ? '- feature-api (NestJS controllers)' : ''}
   ${includeDomain ? '- domain (DDD entities & value objects)' : ''}
    `);
  };
}
```

### Step 5: Create Template Files (Optional)

```typescript
// tools/my-generators/src/generators/domain-library/files/domain/__name__.entity.ts.template
export class <%= className %>Entity {
  private constructor(
    public readonly id: <%= className %>Id,
    private _name: string
  ) {}

  get name(): string {
    return this._name;
  }

  static create(props: Create<%= className %>Props): <%= className %>Entity {
    return new <%= className %>Entity(
      <%= className %>Id.generate(),
      props.name
    );
  }
}
```

## Using the Generator

```bash
# Run the generator
nx g @my-org/my-generators:domain-library user-management

# With options
nx g @my-org/my-generators:domain-library orders --includeDomain

# Dry run (preview changes)
nx g @my-org/my-generators:domain-library products --dry-run
```

## Common Generator Patterns

### Feature Module Generator

Creates a complete feature with route, component, and tests:

```typescript
export default async function (tree: Tree, options: FeatureSchema) {
  const { name, domain } = options;
  const featureName = names(name).fileName;
  const featurePath = `libs/${domain}/feature/src/lib/${featureName}`;

  // Generate component files
  generateFiles(tree, joinPathFragments(__dirname, 'files'), featurePath, {
    ...options,
    ...names(name),
  });

  // Update routes file
  const routesPath = `libs/${domain}/feature/src/lib/routes.ts`;
  const routesContent = tree.read(routesPath, 'utf-8');
  const updatedRoutes = addRouteToFile(routesContent, featureName);
  tree.write(routesPath, updatedRoutes);

  await formatFiles(tree);
}
```

### API Endpoint Generator

Creates NestJS controller, service, and DTOs:

```typescript
export default async function (tree: Tree, options: ApiEndpointSchema) {
  const { name, domain } = options;
  const endpointPath = `libs/${domain}/feature-api/src/lib`;

  generateFiles(tree, joinPathFragments(__dirname, 'files'), endpointPath, {
    ...options,
    ...names(name),
    tmpl: '',
  });

  // Update module imports
  updateNestModule(tree, domain, name);

  await formatFiles(tree);
}
```

## Testing Generators

```typescript
// tools/my-generators/src/generators/domain-library/generator.spec.ts
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';
import generator from './generator';

describe('domain-library generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('should create all required libraries', async () => {
    await generator(tree, {
      name: 'user-management',
      includeApi: true,
      includeDomain: false,
    });

    expect(tree.exists('libs/user-management/feature/src/index.ts')).toBeTruthy();
    expect(tree.exists('libs/user-management/ui/src/index.ts')).toBeTruthy();
    expect(tree.exists('libs/user-management/data-access/src/index.ts')).toBeTruthy();
    expect(tree.exists('libs/user-management/feature-api/src/index.ts')).toBeTruthy();
  });

  it('should apply correct tags', async () => {
    await generator(tree, {
      name: 'orders',
      includeApi: true,
      includeDomain: false,
    });

    const projectConfig = JSON.parse(tree.read('libs/orders/feature/project.json', 'utf-8'));
    expect(projectConfig.tags).toContain('scope:orders');
    expect(projectConfig.tags).toContain('type:feature');
  });
});
```

## Listing Available Generators

```bash
# List all generators
nx list @my-org/my-generators

# Get help for specific generator
nx g @my-org/my-generators:domain-library --help
```
