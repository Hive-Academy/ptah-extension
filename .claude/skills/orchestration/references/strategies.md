# Execution Strategies Reference

Detailed workflow diagrams and guidance for all 8 task type workflows. Which phases or batches may run on CLI lanes: [lane-assignment.md](lane-assignment.md).

Every document gate below runs `author → independent document review → bounded revision → user gate`
([checkpoints.md § Cross-side review protocol](checkpoints.md#cross-side-review-protocol)), for initial
artifacts and revisions alike. Include the reviews in the announced agent sequence. Every
implementation also gets the required shipping-code review before batch acceptance, or before
completion and git in flows without team-leader; Gate 3 `skip` does not waive it.

---

## Strategy Overview

| Strategy      | Complexity     | Primary Agents                       | User Checkpoints                      |
| ------------- | -------------- | ------------------------------------ | ------------------------------------- |
| FEATURE       | Full           | PM, [Designer], Architect, Team-Leader, Devs, QA | Scope, Requirements, Design (1.7), Architecture, QA |
| BUGFIX        | Streamlined    | Team-Leader, Devs, QA                | QA                                    |
| REFACTORING   | Focused        | Architect, Team-Leader, Devs, QA     | Architecture, QA                      |
| DOCUMENTATION | Minimal        | PM, Developer, Style Reviewer        | Requirements                          |
| RESEARCH      | Investigation  | Researcher                           | None                                  |
| DEVOPS        | Infrastructure | PM, Architect, DevOps Engineer, QA   | Requirements, Architecture, QA        |
| SAAS_INIT     | Full+Discovery | PM, Architect, Team-Leader, Devs     | Scope, PRD, Architecture, Batches     |
| CREATIVE      | Design-first   | ui-ux-designer, content-writer, Dev  | Design system check, Design (1.7)     |

---

## FEATURE (Full Workflow)

**When to use**: New features, unclear scope, complex requirements

```
Phase 0.5: [IF ambiguous request] SCOPE CLARIFICATION
           Orchestrator asks scope/priority/constraint questions
           |
           USER ANSWERS (clarifies scope)
           |
           v
Phase 1: project-manager --> Creates task-description.md
         |
         INDEPENDENT DOCUMENT REVIEW (other execution side; max 2 revise rounds)
         |
         USER VALIDATES ("APPROVED" or feedback)
         |
         v
Phase 2: [IF technical unknowns] researcher-expert --> Creates research-report.md
         |
         v
Phase 3: [IF UI/UX work] ui-ux-designer --> Creates design-spec.md + prototype/
         |
         INDEPENDENT DOCUMENT REVIEW (other execution side; max 2 revise rounds)
         |
         GATE 1.7: USER VALIDATES ("APPROVED" or revisions)
         |
         v
Phase 3.5: [IF multiple valid approaches] TECHNICAL CLARIFICATION
           Orchestrator asks pattern/integration/tradeoff questions
           |
           USER ANSWERS (clarifies technical preferences)
           |
           v
Phase 4: software-architect --> Creates implementation-plan.md
         |
         INDEPENDENT DOCUMENT REVIEW (other execution side; max 2 revise rounds)
         |
         USER VALIDATES ("APPROVED" or feedback)
         |
         v
Phase 5: team-leader MODE 1 --> MODE 2 (loop) --> MODE 3
         |
         USER CHOOSES QA (tester/style/logic/visual/reviewers/all/skip)
         |
         v
Phase 6: [QA agents as chosen]
         |
         v
Phase 7: User handles git (commits already created)
         |
         v
Phase 8: modernization-detector --> Creates future-enhancements.md
```

Before design starts on an existing surface being replaced, consolidated, rebuilt or redesigned,
PM (architect when no PM) writes `parity-inventory.md` from the old code. The designer owns
`design-spec.md` and `<taskFolder>/prototype/`, including `README.md` and `screenshots/`;
revise them until Gate 1.7 is approved, then pass the approved prototype to the architect.

### Conditional Agent Triggers

| Agent             | Invoke When                                                 |
| ----------------- | ----------------------------------------------------------- |
| researcher-expert | Technical complexity > 3, unknown libraries/APIs, needs POC |
| ui-ux-designer    | Landing pages, visual redesigns, new UI components          |

---

## BUGFIX (Streamlined)

**When to use**: Bug reports, error fixes, issue resolution

```
[IF complex/unknown cause] researcher-expert
         |
         v
team-leader MODE 1 --> MODE 2 (loop) --> MODE 3
         |
         USER CHOOSES QA
         |
         v
[QA agents] --> Git --> modernization-detector
```

### Decision Points

- **Unknown cause**: Add researcher-expert before team-leader
- **Known cause**: Skip directly to team-leader MODE 1
- **Single-file fix**: Consider minimal pattern (direct developer)

---

## REFACTORING (Focused)

**When to use**: Code restructuring, optimization, technical debt reduction

```
software-architect --> Creates implementation-plan.md
         |
         INDEPENDENT DOCUMENT REVIEW (other execution side; max 2 revise rounds)
         |
         USER VALIDATES ("APPROVED" or feedback)
         |
         v
team-leader MODE 1 --> MODE 2 (loop) --> MODE 3
         |
         USER CHOOSES QA
         |
         v
[QA agents] --> Git --> modernization-detector
```

### Why Skip PM

Refactoring requirements are typically clear:

- "Extract service from component"
- "Optimize database queries"
- "Consolidate duplicate code"

The architect designs HOW to refactor; no scope discovery needed.

---

## DOCUMENTATION (Minimal)

**When to use**: README updates, API docs, comments, guides

```
project-manager --> Creates task-description.md
         |
         INDEPENDENT DOCUMENT REVIEW (other execution side; max 2 revise rounds)
         |
         USER VALIDATES ("APPROVED" or feedback)
         |
         v
[appropriate developer] --> Implements documentation
         |
         v
code-style-reviewer --> Verifies formatting/consistency
         |
         v
Git
```

### Developer Selection

| Documentation Type | Developer          |
| ------------------ | ------------------ |
| API docs           | backend-developer  |
| Component docs     | frontend-developer |
| CI/CD docs         | devops-engineer    |
| General guides     | frontend-developer |

---

## RESEARCH (Investigation Only)

**When to use**: Technical exploration, feasibility studies, POC evaluation

```
researcher-expert --> Creates research-report.md
         |
         v
[IF implementation needed] --> Switch to FEATURE strategy
[IF research only] --> Complete
```

### Research-to-Implementation Transition

If research concludes implementation is needed:

1. Research report becomes input to PM
2. Switch to FEATURE strategy
3. PM references research-report.md in task-description.md

---

## DEVOPS (Infrastructure & Deployment)

**When to use**: CI/CD, Docker, Kubernetes, Terraform, monitoring, publishing

```
Phase 1: project-manager --> Creates task-description.md
         |
         INDEPENDENT DOCUMENT REVIEW (other execution side; max 2 revise rounds)
         |
         USER VALIDATES ("APPROVED" or feedback)
         |
         v
Phase 2: software-architect --> Creates implementation-plan.md
         |
         INDEPENDENT DOCUMENT REVIEW (other execution side; max 2 revise rounds)
         |
         USER VALIDATES ("APPROVED" or feedback)
         |
         v
Phase 3: devops-engineer --> Implements infrastructure
         |
         USER CHOOSES QA (style/logic/skip)
         |
         v
Phase 4: [QA agents as chosen]
         |
         v
Phase 5: User handles git (commits already created)
         |
         v
Phase 6: modernization-detector --> Creates future-enhancements.md
```

### DEVOPS Trigger Keywords

Invoke DEVOPS strategy when task involves:

- CI/CD pipelines, GitHub Actions, GitLab CI
- Docker, Kubernetes, container orchestration
- Terraform, CloudFormation, infrastructure-as-code
- npm/Docker publishing automation
- Monitoring, observability, alerting
- Secret management, cloud platform configuration

**Key Signal**: Work is 100% infrastructure (no application business logic)

**Developer**: Always use `devops-engineer` (NOT backend-developer)

---

## SAAS_INIT (SaaS Workspace Initialization)

**When to use**: Creating new multi-tenant SaaS projects with Nx, NestJS, and Angular

### Trigger Keywords

Invoke SAAS_INIT strategy when task involves:

- "new SaaS", "create SaaS", "start SaaS project"
- "multi-tenant", "multitenancy"
- "Nx monorepo with NestJS and Angular"
- "initialize workspace", "scaffold workspace"
- "B2B SaaS", "B2C platform"

**Key Signal**: Greenfield project requiring full workspace structure

### Strategy Flow

```
Phase 0: DISCOVERY (Orchestrator)
         Run saas-workspace-initializer Step a: mandatory two-round
         AskUserQuestion (Round 1 business, Round 2 stack)
         |
         USER ANSWERS (clarifies business/technical context)
         |
         v
Phase 1: project-manager + [saas-discovery-prompt]
         --> Creates SaaS PRD (task-description.md) with:
             - Tenant model
             - Domain boundaries
             - Integration patterns
             - MVP scope
         |
         INDEPENDENT DOCUMENT REVIEW (other execution side; max 2 revise rounds)
         |
         USER VALIDATES ("APPROVED" or feedback)
         |
         v
Phase 2: software-architect + [saas-architecture-skills]
         References: nx-workspace-architect, nestjs-backend-patterns
         --> Creates implementation-plan.md with:
             - Complete library structure
             - Module boundary rules
             - Batch breakdown
         |
         INDEPENDENT DOCUMENT REVIEW (other execution side; max 2 revise rounds)
         |
         USER VALIDATES ("APPROVED" or feedback)
         |
         v
Phase 3: team-leader MODE 1
         Creates batched tasks from implementation plan
         |
         v
Phase 4: Development Loop (team-leader MODE 2)
         Batch 1: Workspace + shared infrastructure
         Batch 2: Authentication + multitenancy
         Batch 3: First domain scaffold
         Batch 4: Build verification
         |
         v
Phase 5: team-leader MODE 3
         Final verification, summary
```

### Discovery (Phase 0)

Single source of truth: `saas-workspace-initializer` Step a. Do not maintain a separate discovery question list here. Ask through the `AskUserQuestion` tool, in the skill's two rounds, before invoking PM:

- **Round 1 — business**: what is being built, customer type (B2B/B2C/internal), core jobs-to-be-done (2-3 candidate domains), MVP scope, monetization yes/no.
- **Round 2 — stack**: frontend, API, DB/ORM, auth shape, tenancy — each with a "Recommend for me" option.

See `saas-workspace-initializer/SKILL.md` Step a for the exact question wording and the "never proceed with unanswered required questions" rule.

### PM Agent Extension

When invoking project-manager, include in prompt:

```
Reference skill: saas-workspace-initializer/SKILL.md

The task-description.md MUST include sections for:
1. TENANT MODEL - Identification and isolation strategy
2. AUTHENTICATION - Provider choice with rationale
3. DOMAIN BOUNDARIES - Bounded contexts list
4. THIRD-PARTY INTEGRATIONS - Using Provider Pattern
5. MVP FEATURE SCOPE - Must-have vs phase 2
6. NON-FUNCTIONAL REQUIREMENTS - Scale, compliance
```

### Architect Agent Extension

When invoking software-architect, include in prompt:

```
Reference skills:
- nx-workspace-architect (library structure)
- nestjs-backend-patterns (backend patterns)
- angular-frontend-patterns (frontend patterns)
- ddd-architecture (if complex domains)

The implementation-plan.md MUST include:
1. WORKSPACE STRUCTURE - All libraries with tags
2. DOMAIN LAYER ORGANIZATION - Per bounded context
3. SHARED INFRASTRUCTURE - Common libraries
4. MULTITENANCY IMPLEMENTATION - Middleware + policies
5. AUTHENTICATION SCAFFOLD - Provider pattern
6. PHASE BREAKDOWN - Batched for team-leader
```

### Batch Templates

Batch structure follows the phase schema in `saas-workspace-initializer/references/roadmap-format.md` — do not duplicate a separate breakdown here. Batch 1 scaffolds exactly the Foundation phase (Nx workspace, ESLint, shared/domain, api-interfaces, plus tenant/auth/DB primitives only if Phase 0 discovery makes them load-bearing — see `saas-workspace-initializer/SKILL.md` Step c). Later batches implement roadmap Phase 2 (Tenancy & Auth) and Phase 3 (Domain Modules) items, one item per batch, in the dependency order given by each item's `Depends on:` field. A final batch always runs verification (build all, lint, typecheck, boundaries) before handoff.

### Developer Skill References

Developers reference these skills during implementation:

| Task Area            | Skill                     |
| -------------------- | ------------------------- |
| Workspace, libraries | nx-workspace-architect    |
| Auth, multitenancy   | nestjs-backend-patterns   |
| Entities, aggregates | ddd-architecture          |
| Angular components   | angular-frontend-patterns |

---

## Creative Workflows

Creative workflows follow a **design-first principle** with specific agent sequencing.
Whenever a designer ran or a UI surface is added/redesigned, the designer owns `design-spec.md`
and `<taskFolder>/prototype/` (with `README.md` and `screenshots/`). Run Gate 1.7 before
content/implementation; an existing design system does not waive it. For an existing surface,
PM (architect when no PM) inventories the old code in `parity-inventory.md` before design starts.

### Design-First Dependency Chain

```
+---------------------------------------------------------------+
|  CREATIVE WORKFLOW DEPENDENCY CHAIN                           |
|                                                               |
|  1. DESIGN SYSTEM (Foundation)                                |
|     +-- ui-ux-designer creates if missing                     |
|         +-- Output: DESIGN-SYSTEM.md, in the                  |
|                     technical-content-writer skill's own dir  |
|                                                               |
|  1.7 DESIGNER -> PROTOTYPE -> GATE 1.7 (APPROVED)              |
|                                                               |
|  2. CONTENT GENERATION (Depends on #1)                        |
|     +-- technical-content-writer uses design system           |
|         +-- Output: Design-integrated content specs           |
|                                                               |
|  3. IMPLEMENTATION (Depends on #1 and #2)                     |
|     +-- frontend-developer implements with specs              |
+---------------------------------------------------------------+
```

### Automatic Design System Check

Before invoking technical-content-writer for landing pages:

`DESIGN-SYSTEM.md` is a sibling of the `technical-content-writer` SKILL.md.
Resolve it against that skill's own directory (from the Skill tool / plugin
root); a workspace-relative `.claude/` path is not portable across hosts.

```
design_system_path = <technical-content-writer skill dir>/DESIGN-SYSTEM.md

if NOT exists(design_system_path):
    -> Invoke ui-ux-designer FIRST
    -> "Create design system for this project"
    -> Wait for completion
    -> Designer creates design-spec.md + prototype/; run Gate 1.7
    -> Then invoke technical-content-writer

if exists(design_system_path):
    -> For added/redesigned UI: designer -> prototype -> Gate 1.7
    -> Then invoke technical-content-writer
    -> Content will use existing design system
```

### Creative Request Detection

| User Says                         | Workflow                                |
| --------------------------------- | --------------------------------------- |
| "Create landing page"             | Design check -> ui-ux -> content-writer |
| "Design our homepage"             | Design check -> ui-ux -> content-writer |
| "Marketing content for..."        | Design check -> content-writer          |
| "Visual design for..."            | ui-ux-designer                          |
| "Brand identity"                  | ui-ux-designer (full discovery)         |
| "Write a blog post"               | content-writer (design check optional)  |
| "Video script for..."             | content-writer                          |
| "What should our site look like?" | ui-ux-designer (discovery)              |

### Workflow A: Full Creative (Landing Page, Marketing Site)

```
User: "Create a landing page for our extension"

Orchestrator:
  1. Check design system exists
     Read(<technical-content-writer skill dir>/DESIGN-SYSTEM.md)

  2. IF MISSING -> Invoke ui-ux-designer:
     Task("Create design system", subagent_type="ui-ux-designer")
     - Agent loads NICHE-DISCOVERY.md skill
     - Agent guides user through aesthetic discovery
     - Agent creates DESIGN-SYSTEM.md
     - Wait for completion

  2.5. Invoke ui-ux-designer for design-spec.md + prototype/ (even if design system exists)
       - Include prototype/README.md and prototype/screenshots/
       - Run the independent document review, then present Gate 1.7; revise per the review protocol until APPROVED

  3. Invoke technical-content-writer:
     Task("Create landing page content", subagent_type="technical-content-writer")
     - Agent loads LANDING-PAGES.md skill
     - Agent loads DESIGN-SYSTEM.md
     - Agent creates design-integrated content

  4. Deliver combined output:
     - Design system (if created)
     - Approved design-spec.md and prototype/
     - Content specification with visual specs
     - Asset generation briefs
```

### Workflow B: Content Only (Blog, Docs, Video)

```
User: "Write a blog post about the SDK"

Orchestrator:
  1. Design system check (OPTIONAL for blogs)
     - If exists, content-writer can reference it
     - If missing, proceed without (text-focused content)

  2. Invoke technical-content-writer:
     Task("Write blog post about SDK", subagent_type="technical-content-writer")
     - Agent loads BLOG-POSTS.md skill
     - Agent investigates codebase
     - Agent creates evidence-backed content
```

### Workflow C: Design System Only

```
User: "Help me define our visual identity"

Orchestrator:
  1. Invoke ui-ux-designer:
     Task("Create design system with full discovery", subagent_type="ui-ux-designer")
     - Agent loads NICHE-DISCOVERY.md
     - Agent loads DESIGN-SYSTEM-BUILDER.md
     - Agent guides through discovery questions
     - Agent creates complete design system, design-spec.md and prototype/
  2. Run the independent document review, then present Gate 1.7; revise per the review protocol until APPROVED
```

### Parallel vs Sequential Execution

**Sequential (Default for Creative)**:

- Design system MUST complete before content; if a designer ran or UI is added/redesigned,
  designer → prototype → Gate 1.7 approval also precedes content
- Content informs implementation

**Parallel (When Design Exists)**:

- Multiple content pieces can be created in parallel
- Different content types (blog + video) can run simultaneously

```
# Sequential (design missing)
ui-ux-designer --> prototype --> Gate 1.7 --> technical-content-writer --> frontend-developer

# Parallel (design exists; Gate 1.7 approved for added/redesigned UI)
+-> technical-content-writer (landing page)
+-> technical-content-writer (blog post)
+-> technical-content-writer (video script)
```

### Creative Output Locations

| Agent                    | Output File                                                  | Purpose                           |
| ------------------------ | ------------------------------------------------------------ | --------------------------------- |
| ui-ux-designer           | `DESIGN-SYSTEM.md` in the technical-content-writer skill dir | Design tokens, colors, typography |
| ui-ux-designer           | `.ptah/specs/TASK_[ID]/design-spec.md` + `prototype/`         | Visual spec + prototype for Gate 1.7        |
| technical-content-writer | `.ptah/specs/TASK_[ID]/content-specification.md`             | Content with design integration   |
| technical-content-writer | `docs/content/*.md`                                          | Final content files               |

### Creative Handoff Protocols

**ui-ux-designer -> technical-content-writer:**

```markdown
## Design Handoff for Content

**Design System**: `DESIGN-SYSTEM.md`, in the technical-content-writer skill's own directory
**Approved Prototype**: `<taskFolder>/prototype/` (Gate 1.7; README.md + screenshots/)
**Aesthetic**: [Name - e.g., "Sacred Tech"]
**Key Colors**: [Primary accent, backgrounds]
**Typography**: [Display + body fonts]
**Animation Patterns**: [Key effects to reference]

Content writer should:

- Reference DESIGN-SYSTEM.md for all visual specs
- Use LANDING-PAGES.md templates with design integration
- Include animation/effect specifications in content
```

**technical-content-writer -> frontend-developer:**

```markdown
## Content Handoff for Implementation

**Content Spec**: .ptah/specs/TASK\_[ID]/content-specification.md
**Design System**: `DESIGN-SYSTEM.md`, in the technical-content-writer skill's own directory
**Approved Prototype**: `<taskFolder>/prototype/` (Gate 1.7)
**Assets Needed**: [List from asset briefs]

Developer should:

- Implement content following visual specs and the approved prototype; return deviations to the designer
- Use design system tokens exactly
- Generate/source assets from briefs
```

---

## Strategy Selection Summary

Use this decision tree for quick strategy selection:

```
Is task SAAS_INIT (new SaaS, multi-tenant, Nx workspace)?
    YES -> SAAS_INIT strategy
    NO  -> continue

Is task DEVOPS (CI/CD, Docker, K8s, Terraform)?
    YES -> DEVOPS strategy
    NO  -> continue

Is task CREATIVE (landing page, brand, marketing)?
    YES -> Check design system -> CREATIVE strategy
    NO  -> continue

Is task a new FEATURE?
    YES -> FEATURE strategy (full workflow)
    NO  -> continue

Is task a BUGFIX?
    YES -> Is cause known?
           YES -> Minimal pattern (developer only)
           NO  -> BUGFIX strategy
    NO  -> continue

Is task REFACTORING?
    YES -> REFACTORING strategy
    NO  -> continue

Is task DOCUMENTATION?
    YES -> DOCUMENTATION strategy
    NO  -> continue

Is task RESEARCH?
    YES -> RESEARCH strategy
    NO  -> Ask user for clarification
```
