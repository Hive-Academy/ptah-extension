# Execution Strategies Reference

Detailed workflow diagrams and guidance for all 6 execution strategies plus creative workflows.

---

## Strategy Overview

| Strategy       | Complexity | Primary Agents                      | User Checkpoints |
|----------------|------------|-------------------------------------|------------------|
| FEATURE        | Full       | PM, Architect, Team-Leader, Devs, QA | Scope, Requirements, Architecture, QA |
| BUGFIX         | Streamlined | Team-Leader, Devs, QA              | QA              |
| REFACTORING    | Focused    | Architect, Team-Leader, Devs, QA    | Architecture, QA |
| DOCUMENTATION  | Minimal    | PM, Developer, Style Reviewer       | Requirements    |
| RESEARCH       | Investigation | Researcher                        | None            |
| DEVOPS         | Infrastructure | PM, Architect, DevOps Engineer, QA | Requirements, Architecture, QA |

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
         USER VALIDATES ("APPROVED" or feedback)
         |
         v
Phase 2: [IF technical unknowns] researcher-expert --> Creates research-report.md
         |
         v
Phase 3: [IF UI/UX work] ui-ux-designer --> Creates visual-design-specification.md
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
         USER VALIDATES ("APPROVED" or feedback)
         |
         v
Phase 5: team-leader MODE 1 --> MODE 2 (loop) --> MODE 3
         |
         USER CHOOSES QA (tester/style/logic/reviewers/all/skip)
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

| Documentation Type | Developer        |
|--------------------|------------------|
| API docs           | backend-developer |
| Component docs     | frontend-developer |
| CI/CD docs         | devops-engineer  |
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
         USER VALIDATES ("APPROVED" or feedback)
         |
         v
Phase 2: software-architect --> Creates implementation-plan.md
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

## Creative Workflows

Creative workflows follow a **design-first principle** with specific agent sequencing.

### Design-First Dependency Chain

```
+---------------------------------------------------------------+
|  CREATIVE WORKFLOW DEPENDENCY CHAIN                           |
|                                                               |
|  1. DESIGN SYSTEM (Foundation)                                |
|     +-- ui-ux-designer creates if missing                     |
|         +-- Output: .claude/skills/technical-content-writer/  |
|                     DESIGN-SYSTEM.md                          |
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

```
design_system_path = ".claude/skills/technical-content-writer/DESIGN-SYSTEM.md"

if NOT exists(design_system_path):
    -> Invoke ui-ux-designer FIRST
    -> "Create design system for this project"
    -> Wait for completion
    -> Then invoke technical-content-writer

if exists(design_system_path):
    -> Invoke technical-content-writer directly
    -> Content will use existing design system
```

### Creative Request Detection

| User Says                         | Workflow                               |
|-----------------------------------|----------------------------------------|
| "Create landing page"             | Design check -> ui-ux -> content-writer |
| "Design our homepage"             | Design check -> ui-ux -> content-writer |
| "Marketing content for..."        | Design check -> content-writer          |
| "Visual design for..."            | ui-ux-designer                          |
| "Brand identity"                  | ui-ux-designer (full discovery)         |
| "Write a blog post"               | content-writer (design check optional)  |
| "Video script for..."             | content-writer                          |
| "What should our site look like?" | ui-ux-designer (discovery)              |

---

## Strategy Selection Summary

Use this decision tree for quick strategy selection:

```
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
