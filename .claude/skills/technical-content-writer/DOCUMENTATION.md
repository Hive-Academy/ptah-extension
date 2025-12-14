# Documentation Content Patterns

## Purpose

Help users succeed with the product through accurate, tested documentation.

## Documentation Types

### 1. Getting Started Guide

**Goal**: First-time user to working state in <15 minutes
**Sources**: CLAUDE.md, package.json, actual setup commands

### 2. API Reference

**Goal**: Comprehensive interface documentation
**Sources**: TypeScript interfaces, service classes, types

### 3. Concept Guide

**Goal**: Explain how things work conceptually
**Sources**: CLAUDE.md architecture sections, implementation plans

### 4. Tutorial

**Goal**: Step-by-step to accomplish specific task
**Sources**: Working code patterns from codebase

### 5. Troubleshooting

**Goal**: Solve common problems
**Sources**: Bug fix tasks, known issues from task-tracking

## Investigation Protocol

```bash
# Prerequisites
Read(package.json)                            # Dependencies
Read(CLAUDE.md)                               # Build commands

# API Surface
Glob(libs/<library>/src/index.ts)             # Public exports
Grep("export interface|export type", libs/<library>)

# Usage Patterns
Grep("<ServiceName>", apps/**/*.ts)           # How it's used
Read(libs/<library>/src/**/*.spec.ts)         # Test examples

# Known Issues
Grep("fix|bug", task-tracking/registry.md)    # Bug fixes
Read(task-tracking/TASK_XXXX/context.md)      # Problem descriptions
```

## Getting Started Template

````markdown
# Getting Started with [Product/Feature]

## Prerequisites

- [Requirement 1] - from package.json
- [Requirement 2] - from CLAUDE.md

## Installation

```bash
# From actual CLAUDE.md commands
npm install [package]
```
````

## Quick Start

### Step 1: [Action]

```typescript
// Working code from codebase
import { ServiceName } from '@ptah-extension/library';
```

### Step 2: [Action]

```typescript
// Next step with real code
```

### Step 3: [Verify]

```bash
# Verification command from CLAUDE.md
npm run [command]
```

## Next Steps

- [Link to concept guide]
- [Link to API reference]
- [Link to tutorials]

````

## API Reference Template

```markdown
# [ServiceName]

> [One-line description from code comments or CLAUDE.md]

## Import
```typescript
import { ServiceName } from '@ptah-extension/library';
````

## Methods

### methodName(params): ReturnType

[Description from JSDoc or code analysis]

**Parameters**:
| Name | Type | Description |
|------|------|-------------|
| param1 | `TypeName` | [From interface] |

**Returns**: `ReturnType` - [Description]

**Example**:

```typescript
// From actual usage in codebase
const result = service.methodName(value);
```

## Interfaces

### InterfaceName

```typescript
// Exact interface from source
interface InterfaceName {
  property: Type;
}
```

## Related

- [Link to other relevant docs]

````

## Tutorial Template

```markdown
# How to [Accomplish Task]

## What You'll Build
[Screenshot or description of end result]

## Prerequisites
- [What they need to know]
- [What they need installed]

## Step 1: [Action Verb + Object]
[Explanation]

```typescript
// Working code from codebase
````

**What This Does**: [Brief explanation]

## Step 2: [Action Verb + Object]

[Explanation]

```typescript
// Next code step
```

## Step 3: [Action Verb + Object]

[Explanation]

## Verify It Works

```bash
# Command to test
```

Expected output:

```
[What they should see]
```

## Troubleshooting

### [Common Problem 1]

**Symptom**: [What they see]
**Solution**: [How to fix - from bug fix tasks]

## Next Steps

- [What to learn next]

```

## Quality Standards

### Code Examples Must:
- [ ] Compile without errors
- [ ] Use correct import paths
- [ ] Match actual API signatures
- [ ] Include necessary context

### Content Must:
- [ ] Be tested on target platform
- [ ] Include all prerequisites
- [ ] Have working commands
- [ ] Link to related docs

### Structure Must:
- [ ] Be scannable (headers, bullets)
- [ ] Progress logically
- [ ] Include troubleshooting
- [ ] Provide next steps
```
