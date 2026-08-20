---
description: Initialize a complete SaaS workspace with NestJS, Nx, and Angular/React — discovery-first Stage A bootstrap.
argument-hint: '[project name]'
---

# Initialize SaaS Workspace

Standalone command that runs Stage A of the `saas-workspace-initializer` skill: discovery, domain + workspace design, roadmap, foundation scaffold, handoff.

## Usage

```
/init-saas                  # New SaaS project
```

## Execution

1. Load the `saas-workspace-initializer` skill from the active plugins.
2. Follow its Stage A contract in order:
   - **Step a) Discovery** — mandatory, two-round `AskUserQuestion`. Round 1 asks business questions (what is being built, customer type, core jobs-to-be-done/candidate domains, MVP scope, monetization). Round 2 asks stack questions (frontend, API, DB/ORM, auth shape, tenancy), each with a "Recommend for me" option. Never answer a discovery question for the user; never proceed while a required question is unanswered.
   - **Step a2) Domain + workspace design** — invoke the `ddd-architecture` skill (ptah-core plugin) with the Round 1 answers to name bounded contexts and aggregates, then the `nx-workspace-architect` skill to derive the lib layout and tags. Both outputs seed the roadmap.
   - **Step b) Roadmap** — write `.ptah/roadmap.md` following `saas-workspace-initializer/references/roadmap-format.md`. Derive phases and items from the Step a2 output; the reference file's worked example is illustrative only.
   - **Step c) Foundation scaffold** — scaffold the Nx workspace and only the primitives Stage B depends on, per the skill's foundation table.
   - **Step d) Handoff** — emit the "Foundation complete" block listing the next roadmap items to run via `/orchestrate <slug>` in new chat sessions.
   - **Step e) STOP** — do not implement features beyond the foundation in this session.

## Quick Reference

**Files written** (workspace root):

- `.ptah/scope-decisions.md` — Step a discovery answers, one section per question with chosen value and rationale.
- `.ptah/roadmap.md` — Step b output, phased checklist with charters.

**Stage B**: every unchecked roadmap item is its own task, run later via `/orchestrate <slug>` or the project-manager agent, in a new chat session.

## Skill Path

`saas-workspace-initializer` (from ptah-nx-saas plugin)
