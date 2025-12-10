# agent-generation

**Purpose**: Intelligent Project-Adaptive Agent Generation System for TASK_2025_058

This library provides the core infrastructure for generating dynamic, project-adaptive agents using VS Code Language Model API. It contains utilities, patterns, and type definitions extracted from the roocode-generator project.

## Overview

The agent-generation library serves as the foundation for creating intelligent agents that:

- Analyze project structure and context
- Generate adaptive agent prompts based on project characteristics
- Orchestrate multi-agent workflows
- Process and transform content for agent consumption

## Architecture

```
agent-generation/
├── utils/           # ContentProcessor utilities (Task -1.2)
├── patterns/        # Orchestration patterns (Task -1.3)
└── types/           # Type definitions and contracts
```

## Development Status

**Status**: Scaffolding Complete (TASK_2025_058 Batch -1)

**Extraction Tasks**:

- ✅ Task -1.4: Library scaffolding (COMPLETE)
- ⏸️ Task -1.1: VS Code LM API Provider (PENDING)
- ⏸️ Task -1.2: ContentProcessor utilities (PENDING)
- ⏸️ Task -1.3: Orchestration patterns (PENDING)

## Building

Run `nx build agent-generation` to build the library.

## Running unit tests

Run `nx test agent-generation` to execute the unit tests via [Jest](https://jestjs.io).

## Import Path

```typescript
import { ... } from '@ptah-extension/agent-generation';
```

## Related Documentation

- Task Tracking: `task-tracking/TASK_2025_058/`
- Implementation Plan: `task-tracking/TASK_2025_058/implementation-plan.md`
- Extraction Plan: `task-tracking/TASK_2025_058/extraction-plan.md`
