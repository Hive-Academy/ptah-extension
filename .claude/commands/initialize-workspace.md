Analyze this codebase and generate comprehensive Claude Code documentation:

## Your Task

1. **Discover Architecture**: Scan the project structure, identify the organizational pattern (monorepo, feature-based, domain-driven, layered, etc.)

2. **Generate Root CLAUDE.md**: Create a main context file at project root with:

   - Project overview (1-2 sentences)
   - Detected architecture pattern with visual structure
   - Tech stack and key dependencies
   - Setup and development commands
   - Coding standards and conventions (inferred from existing code)
   - Navigation map linking to all module CLAUDE.md files

3. **Generate Module CLAUDE.md Files**: For each significant folder (apps, packages, features, domains, libraries), create a CLAUDE.md with:
   - Module purpose and boundaries
   - Key files and their roles
   - Internal/external dependencies
   - Module-specific commands
   - Coding guidelines for this module
   - Link back to main CLAUDE.md

## Structure Template

### Root `CLAUDE.md`:

```markdown
# [Project Name]

## Overview

[What this project does in 1-2 sentences]

## Architecture

**Pattern**: [Detected pattern]

[Visual directory structure with descriptions]

## Tech Stack

- Language: [versions]
- Frameworks: [key frameworks]
- Tools: [build tools, package managers]

## Setup

[bash commands to get started]

## Development Commands

[common commands: dev, test, build, lint]

## Coding Standards

[Inferred patterns from codebase]

## Module Index

- [Module A](./path/to/module-a/CLAUDE.md) - [brief description]
- [Module B](./path/to/module-b/CLAUDE.md) - [brief description]
```

### Module `CLAUDE.md`:

```markdown
# [Module Name]

↩️ [Back to Main](../../CLAUDE.md)

## Purpose

[What this module does]

## Boundaries

**Belongs here**: [types of code]
**Does NOT belong**: [anti-patterns]

## Key Files

- `file.ts` - [what it does]

## Dependencies

[Internal and external deps with links]

## Commands

[Module-specific commands]

## Guidelines

[Module-specific coding rules]
```

## Execution

1. Use `view` to scan the entire project structure
2. Identify patterns by analyzing file organization and naming
3. Create all CLAUDE.md files in appropriate locations
4. Ensure bidirectional linking works
5. Keep each file concise and actionable

Generate the documentation now.
