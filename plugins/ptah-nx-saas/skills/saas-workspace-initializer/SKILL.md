---
name: saas-workspace-initializer
description: Bootstraps a new SaaS workspace on Nx, NestJS and Angular or React — discovery, a phased roadmap and a foundation-only scaffold. Use when starting a new SaaS or multi-tenant project. Not for .NET stacks — use dotnet-solution-initializer.
---

# SaaS Workspace Initializer

## Stage A contract

- Complete discovery in two rounds: business first, then stack. Ask required unanswered questions and wait for answers before design or scaffolding. Use the available question tool or plain text when the tool is unavailable.
- Derive domain boundaries and Nx library layout from the answers. Write `.ptah/roadmap.md` using the required schema, then scaffold only the foundation needed by the first Stage B tasks.
- Verify the foundation and emit the handoff. Each unchecked roadmap item is a separate Stage B task in a new session; stop after the handoff.
- Per-stack initializers inherit the business discovery questions and roadmap schema here. Preserve this shared contract when changing either.

## Load by task

- Before discovery, design, roadmap writing, or foundation scaffolding, load [Stage A workflow](references/stage-a-workflow.md). It contains the exact questions, conditional scaffold table, and verification gate.
- Before writing `.ptah/roadmap.md`, load [roadmap format](references/roadmap-format.md) for the charter schema and dependency notation.

## Handoff and stop

Emit exactly this block, expanding only the next phase's items:

```
Foundation complete.

Roadmap written to .ptah/roadmap.md.
Scope decisions recorded in .ptah/scope-decisions.md.

Next tasks (run each in a NEW chat session, one at a time):

  /orchestrate <slug-1>   # <charter one-liner>
  /orchestrate <slug-2>   # <charter one-liner>
  ...

Each task will activate the relevant companion skill
(nx-workspace-architect, nestjs-backend-patterns, webhook-architecture,
resilient-nestjs-patterns, saas-platform-patterns, nestjs-deployment)
and pick up dependencies from the roadmap.
```

After handoff, do not implement feature libraries, pre-create future task stubs, or run multiple roadmap items in this session.

## Requires

- `ddd-architecture` (ptah-core plugin) — Stage A uses it to name bounded contexts before the roadmap. If unavailable, tell the user to enable ptah-core before Step a2.
- `dotnet-solution-initializer` (ptah-dotnet plugin) — the .NET sibling that reuses this skill's Stage A contract and roadmap schema; `references/roadmap-format.md` keeps the schema stack-agnostic because of it. If it is not installed, the shared contract here still stands on its own.
- `nx-workspace-architect` — the Nx lib layout `references/stage-a-workflow.md` invokes with the discovery answers before the roadmap is written. If it is not installed, tell the user to enable it before scaffolding the foundation.
