# Initialize SaaS Workspace

Standalone command for SaaS workspace initialization with multi-turn discovery.

## Usage

```
/init-saas                  # New SaaS project
/init-saas TASK_YYYY_NNN    # Continue existing SaaS init
```

## Execution

1. Load the `saas-workspace-initializer` skill from the active plugins
2. Load `orchestration/references/task-tracking.md` — task ID format, registry management, folder structure, file path conventions
3. **Phase 0: Framework Selection** — Ask the user which frontend framework they want:
   - **Angular** — loads `angular-frontend-patterns` skill (from ptah-angular plugin)
   - **React** — loads `react-best-practices` and `react-nx-patterns` skills (from ptah-react plugin)
4. Follow the Execution Protocol (Mode Detection → Phases 1-6)
5. Load dependent skills on demand during discovery steps:
   - `ddd-architecture` skill — Step 2a: Domain Modeling
   - `nx-workspace-architect` skill — Step 2b: NX Structure
   - `nestjs-backend-patterns` skill — Step 2c: Backend Architecture
   - **Selected frontend skill** — Step 2d: Frontend Architecture
   - `webhook-architecture` skill — Step 2e: Webhook Architecture (if webhooks needed)
   - `resilient-nestjs-patterns` skill — Step 2f: Resilience Patterns
   - `saas-platform-patterns` skill — Step 2g: Monetization Architecture (if payment needed)
   - `nestjs-deployment` skill — Step 2h: Deployment Architecture
6. Load on demand during implementation phases:
   - `orchestration/references/team-leader-modes.md` — Phases 3-5: MODE 1/2/3 integration
   - `orchestration/references/checkpoints.md` — User validation templates
   - `orchestration/references/git-standards.md` — Commit rules and hook handling

## Quick Reference

**Decision Files** (written to `task-tracking/TASK_[ID]/`):

- `scope-decisions.md` — Phase 0 output (includes frontend framework choice)
- `task-description.md` — Phase 1 output (PM)
- `domain-decisions.md` — Step 2a output
- `workspace-decisions.md` — Step 2b output
- `backend-decisions.md` — Step 2c output
- `frontend-decisions.md` — Step 2d output
- `webhook-decisions.md` — Step 2e output (webhook sources, verification strategy)
- `resilience-decisions.md` — Step 2f output (service patterns, retry strategy, events)
- `monetization-decisions.md` — Step 2g output (tier model, licensing, subscriptions)
- `deployment-decisions.md` — Step 2h output (Docker, production config, CI/CD)
- `implementation-plan.md` — Step 2i output (Architect synthesis)

**Phase Summary**:

1. Phase 0: Scope Clarification + Framework Selection (main thread, user conversation)
2. Phase 1: PM Requirements (sub-agent: project-manager)
3. Steps 2a-2d: Architecture Discovery (main thread, user conversation per skill)
4. Steps 2e-2h: Infrastructure Discovery (conditional — webhook, resilience, monetization, deployment)
5. Step 2i: Architect Synthesis (sub-agent: software-architect)
6. Phases 3-5: Implementation (sub-agent: team-leader MODE 1/2/3)

**Checkpoints**: Every discovery step requires explicit user confirmation before proceeding.

## Skill Path

`saas-workspace-initializer` (from ptah-nx-saas plugin)
