# Codebase Mining Reference

## Purpose

Extract compelling content material from the codebase and task history.

## Generic Codebase Structure

```
[project-name]/
├── CLAUDE.md                 # Project overview, commands, architecture
├── apps/
│   └── [app-name]/           # Application(s)
├── libs/
│   └── [library-name]/       # Shared libraries
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
Glob(libs/[library]/src/lib/components/**/*.ts)  # Count components

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
Read(libs/[library]/src/lib/services/*.service.ts)

# Results/metrics
Grep("Complete|DONE", task-tracking/TASK_XXXX/tasks.md)
```

### For Documentation

```bash
# Public APIs
Glob(libs/*/src/index.ts)  # Exports
Grep("export interface|export type|export class", libs/[library])

# Usage examples
Grep("<ClassName>", apps/**/*.ts)  # How it's used

# Prerequisites
Read(package.json)
Read(CLAUDE.md)  # Build commands
```

### For Video Scripts

```bash
# Visual features
Read(libs/[library]/CLAUDE.md)  # UI components
Glob(libs/*/src/lib/components/**/*.ts)

# Demo flows
Read(task-tracking/TASK_XXXX/context.md)  # User journey

# Code highlights
Read(libs/[library]/src/lib/services/*.service.ts)  # Key logic
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
Glob(libs/*/src/**/*.component.ts)

# Service count
Glob(libs/**/*.service.ts)

# Type definitions
Grep("export interface|export type", libs/[shared-lib])

# Directive count
Glob(libs/**/*.directive.ts)
```

### From Task Tracking

```bash
# Completed tasks
Grep("Complete", task-tracking/registry.md)

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
Grep("@Component", libs/**/*.component.ts)

# Interface names
Grep("export interface", libs/[shared-lib]/src)

# Feature names (from task titles)
Grep("Description", task-tracking/registry.md)
```

## Content Ideas by Library Type

### UI Component Libraries

- "Building a [Feature] Interface with [Framework]"
- "N Components: Anatomy of a Production [Feature] UI"
- "Reactive State with [State Management]"

### Service/SDK Libraries

- "Integrating [External Service] with [Framework]"
- "Multi-Turn [Feature] with [SDK]"
- "Streaming Responses in [Platform]"

### Core/Utility Libraries

- "Intelligent [Domain] Analysis for [Use Case]"
- "N Services for Understanding Your [Domain]"
- "Optimizing [Resource] for [Constraint]"

### Setup/Config Libraries

- "N-Step Setup: From Install to [Goal]"
- "Automating [Feature] Configuration"

## Quick Reference Commands

```bash
# Find all features
Read(task-tracking/registry.md)

# Deep dive on feature
Read(task-tracking/TASK_XXXX/context.md)
Read(task-tracking/TASK_XXXX/implementation-plan.md)

# Find code for feature
Grep("[feature-keyword]", libs/**/*)

# Get library overview
Read(libs/[library]/CLAUDE.md)

# Find usage patterns
Grep("[ServiceName]", apps/**/*.ts)
```
