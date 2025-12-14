# Codebase Mining Reference

## Purpose

Extract compelling content material from the codebase and task history.

## The Ptah Codebase Structure

```
ptah-extension/
├── CLAUDE.md                 # Project overview, commands, architecture
├── orchestration.md          # Workflow, task management, agent delegation
├── apps/
│   ├── ptah-extension-vscode/   # VS Code extension
│   └── ptah-extension-webview/  # Angular SPA
├── libs/
│   ├── backend/              # Backend libraries
│   │   ├── agent-sdk/        # Claude SDK integration
│   │   ├── agent-generation/ # Agent templates
│   │   ├── llm-abstraction/  # Multi-provider LLM
│   │   ├── template-generation/
│   │   ├── vscode-core/      # DI, logging, APIs
│   │   ├── vscode-lm-tools/  # MCP server
│   │   └── workspace-intelligence/
│   ├── frontend/             # Frontend libraries
│   │   ├── chat/             # Chat UI (48+ components)
│   │   ├── core/             # State management
│   │   ├── dashboard/
│   │   ├── setup-wizard/
│   │   └── ui/               # Shared components
│   └── shared/               # Type system
├── task-tracking/            # Task history
│   ├── registry.md           # All tasks
│   └── TASK_XXXX/           # Individual tasks
└── .claude/                  # Orchestration agents
```

## Content Mining Locations

### Product Overview

```bash
Read(CLAUDE.md)
# Extracts: Project purpose, architecture, commands, library map
```

### Feature Details

```bash
Read(libs/*/CLAUDE.md)
# Extracts: Library purpose, components, APIs, usage patterns
```

### Problem-Solution Stories

```bash
Read(task-tracking/TASK_XXXX/context.md)
# Extracts: User intent, problem statement, why feature was needed
```

### Technical Decisions

```bash
Read(task-tracking/TASK_XXXX/implementation-plan.md)
# Extracts: Architecture decisions, trade-offs, approach chosen
```

### Progress & Metrics

```bash
Read(task-tracking/TASK_XXXX/tasks.md)
# Extracts: Task breakdown, completion status, batch progress
```

### Review Insights

```bash
Read(task-tracking/TASK_XXXX/code-*-review.md)
# Extracts: Quality issues, improvements made, lessons learned
```

## Mining Patterns by Content Type

### For Landing Pages

```bash
# Unique value propositions
Grep("PURPOSE|RESPONSIBILITY", libs/*/CLAUDE.md)

# Feature counts
Glob(libs/frontend/chat/src/lib/components/**/*.ts)  # Count components

# Architecture highlights
Read(CLAUDE.md)  # Library map section

# Recent achievements
Read(task-tracking/registry.md)  # Completed tasks with metrics
```

### For Blog Posts

```bash
# Story material
Read(task-tracking/TASK_XXXX/context.md)  # The problem
Read(task-tracking/TASK_XXXX/implementation-plan.md)  # The solution

# Code examples
Read(libs/<library>/src/lib/services/*.service.ts)

# Results/metrics
Grep("Complete|DONE", task-tracking/TASK_XXXX/tasks.md)
```

### For Documentation

```bash
# Public APIs
Glob(libs/*/src/index.ts)  # Exports
Grep("export interface|export type|export class", libs/<library>)

# Usage examples
Grep("<ClassName>", apps/**/*.ts)  # How it's used

# Prerequisites
Read(package.json)
Read(CLAUDE.md)  # Build commands
```

### For Video Scripts

```bash
# Visual features
Read(libs/frontend/chat/CLAUDE.md)  # UI components
Glob(libs/frontend/*/src/lib/components/**/*.ts)

# Demo flows
Read(task-tracking/TASK_XXXX/context.md)  # User journey

# Code highlights
Read(libs/<library>/src/lib/services/*.service.ts)  # Key logic
```

## Key Content Goldmines

### 1. Task Registry (task-tracking/registry.md)

- Complete history of all features
- Status of each feature
- Task IDs for deep dives

### 2. Context Files (task-tracking/TASK_XXXX/context.md)

- Original user problem
- Why feature was requested
- Business value

### 3. Library CLAUDE.md Files

- Feature purpose and responsibility
- Architecture decisions
- Component inventory
- Usage patterns

### 4. Implementation Plans

- Technical approach
- Architecture decisions
- Trade-offs considered
- Alternative approaches rejected

### 5. Review Documents

- Quality improvements
- Lessons learned
- Best practices discovered

## Metrics to Extract

### From Codebase

```bash
# Component count
find libs/frontend/chat/src -name "*.component.ts" | wc -l

# Service count
find libs -name "*.service.ts" | wc -l

# Type definitions
Grep("export interface|export type", libs/shared) | wc -l

# DI tokens
Grep("TOKENS\.", libs/backend/vscode-core/src/di/tokens.ts) | wc -l
```

### From Task Tracking

```bash
# Completed tasks
Grep("Complete", task-tracking/registry.md) | wc -l

# Features by type
Grep("FEATURE|BUGFIX|REFACTOR", task-tracking/registry.md)

# Timeline
Grep("Created.*2025", task-tracking/registry.md)
```

## Terminology Extraction

Use actual terminology from the codebase for SEO and authenticity:

```bash
# Service names (use in content)
Grep("class.*Service", libs/**/*.service.ts)

# Component names
Grep("@Component", libs/frontend/**/*.component.ts)

# Interface names
Grep("export interface", libs/shared/src)

# Feature names (from task titles)
Grep("Description", task-tracking/registry.md)
```

## Content Ideas by Library

### libs/frontend/chat

- "Building a Real-Time AI Chat Interface with Angular Signals"
- "48 Components: Anatomy of a Production Chat UI"
- "Streaming Text with TypeWriter Effect"

### libs/backend/agent-sdk

- "10x Faster Than CLI: Claude Agent SDK Integration"
- "Multi-Turn Conversations with Claude SDK"
- "Streaming AI Responses in VS Code"

### libs/backend/workspace-intelligence

- "Intelligent Workspace Analysis for AI Context"
- "20 Services for Understanding Your Codebase"
- "Token Optimization for LLM Context Windows"

### libs/frontend/setup-wizard

- "6-Step Agent Setup: From Install to Intelligent"
- "Automating Claude Configuration"

## Quick Reference Commands

```bash
# Find all features
Read(task-tracking/registry.md)

# Deep dive on feature
Read(task-tracking/TASK_XXXX/context.md)
Read(task-tracking/TASK_XXXX/implementation-plan.md)

# Find code for feature
Grep("<feature-keyword>", libs/**/*)

# Get library overview
Read(libs/<library>/CLAUDE.md)

# Find usage patterns
Grep("<ServiceName>", apps/**/*.ts)
```
