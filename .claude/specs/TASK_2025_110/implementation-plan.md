# Implementation Plan - TASK_2025_110: Orchestration Skill Conversion

## Executive Summary

Convert the orchestration workflow from fragmented sources (orchestrate.md command + CLAUDE.md embedded rules) into a self-contained, reusable **skill** that enables flexible orchestration patterns for any software engineering task.

---

## Codebase Investigation Summary

### Current State Analysis

| Source File                       | Lines | Content                                                                                                    |
| --------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| `.claude/commands/orchestrate.md` | 640   | Full orchestration logic: mode detection, strategies, team-leader integration, checkpoints, error handling |
| `CLAUDE.md` (lines 193-783)       | ~590  | Orchestration role, workflow protocol, creative workflows, task management, git standards                  |
| `.claude/agents/team-leader.md`   | 679   | MODE 1/2/3 task decomposition (stays as agent)                                                             |

**Total orchestration content**: ~1,230 lines across 2 files with significant duplication

### Pattern Discovery from Existing Skills

**Evidence**: Analyzed skill-creator, ui-ux-designer, angular-3d-scene-crafter, angular-gsap-animation-crafter

**Common Structure**:

```
skill-name/
  SKILL.md          # ~200-400 lines, frontmatter + core workflow
  references/       # Detailed guides loaded on-demand
  assets/           # Optional output templates
```

**Progressive Disclosure Pattern** (from skill-creator/SKILL.md:114-127):

1. **Metadata** (frontmatter) - Always in context (~100 words)
2. **SKILL.md body** - When skill triggers (<500 lines recommended)
3. **references/** - As needed during execution (unlimited)

### Agent Catalog (13 agents - NO CHANGES NEEDED)

All agents remain unchanged in `.claude/agents/`:

- project-manager.md, software-architect.md, team-leader.md
- backend-developer.md, frontend-developer.md, devops-engineer.md
- senior-tester.md, code-style-reviewer.md, code-logic-reviewer.md
- researcher-expert.md, modernization-detector.md
- ui-ux-designer.md, technical-content-writer.md

---

## Architecture Design

### Design Philosophy

**Chosen Approach**: Modular skill with progressive disclosure
**Rationale**:

- Matches existing skill patterns in codebase (ui-ux-designer, skill-creator)
- Enables flexible orchestration (full/partial/minimal workflows)
- Reduces CLAUDE.md bloat by ~590 lines
- Single source of truth for orchestration logic

### Target Structure

```
.claude/skills/orchestration/
  SKILL.md                    # ~350-400 lines
    Frontmatter (name, description with triggers)
    Quick Start (usage examples)
    Workflow Selection Matrix
    Core Orchestration Loop
    Reference index

  references/
    strategies.md             # ~250 lines - All 6 strategy flows
    agent-catalog.md          # ~200 lines - 13 agents with capabilities
    team-leader-modes.md      # ~150 lines - MODE 1/2/3 details
    task-tracking.md          # ~100 lines - Folder structure, registry
    checkpoints.md            # ~150 lines - User validation patterns
    git-standards.md          # ~100 lines - Commitlint rules (from CLAUDE.md)
```

**Total**: ~1,250 lines organized across 7 files (vs 1,230 lines in 2 fragmented files)

---

## File-by-File Specification

### File 1: `.claude/skills/orchestration/SKILL.md`

**Purpose**: Core skill entry point with workflow selection and orchestration loop

**Content Structure**:

```markdown
---
name: orchestration
description: >
  Development workflow orchestration for software engineering tasks.
  Use when: (1) Implementing new features, (2) Fixing bugs, (3) Refactoring code,
  (4) Creating documentation, (5) Research & investigation, (6) DevOps/infrastructure,
  (7) Landing pages and marketing content.
  Supports full (PM→Architect→Dev→QA), partial, or minimal workflows.
  Invoked via /orchestrate command or directly when task analysis suggests delegation.
---

# Orchestration Skill

[~350-400 lines covering:]

- Quick Start (usage examples)
- Workflow Selection Decision Tree
- Core Orchestration Loop
- Flexible Invocation Patterns (full/partial/minimal)
- Reference Index with load triggers
```

**Key Sections**:

1. **Quick Start** (~30 lines)

   - `/orchestrate [task]` examples
   - Strategy selection quick reference

2. **Workflow Selection Matrix** (~50 lines)

   - Task type detection logic (from orchestrate.md:65-82)
   - Strategy mapping table
   - Complexity assessment criteria

3. **Core Orchestration Loop** (~100 lines)

   - Phase 0: Initialization (registry, task ID, context.md)
   - Phase N: Agent invocation pattern
   - Validation checkpoints (reference checkpoints.md)
   - Error handling skeleton

4. **Flexible Invocation Patterns** (~80 lines)

   - **Full**: PM → Architect → Team-Leader → Devs → QA
   - **Partial**: Architect → Team-Leader → Devs (skip PM)
   - **Minimal**: Just developers or specific reviewers
   - When to use each pattern

5. **Reference Index** (~40 lines)
   - Table linking each reference file to its purpose
   - Clear load triggers ("Read when...")

---

### File 2: `.claude/skills/orchestration/references/strategies.md`

**Purpose**: Detailed workflow for all 6 execution strategies

**Content** (migrated from orchestrate.md:105-224):

```markdown
# Execution Strategies Reference

## FEATURE (Full Workflow)

[ASCII flow diagram + detailed steps]

## BUGFIX (Streamlined)

[ASCII flow diagram + detailed steps]

## REFACTORING (Focused)

[ASCII flow diagram + detailed steps]

## DOCUMENTATION (Minimal)

[ASCII flow diagram + detailed steps]

## RESEARCH (Investigation)

[ASCII flow diagram + detailed steps]

## DEVOPS (Infrastructure)

[ASCII flow diagram + detailed steps]

## Creative Workflows

[Design-first principle, ui-ux-designer → content-writer flow]
```

**Load Trigger**: "Read when selecting or executing a specific strategy"

---

### File 3: `.claude/skills/orchestration/references/agent-catalog.md`

**Purpose**: Comprehensive catalog of all 13 specialist agents

**Content Structure**:

```markdown
# Agent Catalog Reference

## Agent Selection Matrix

| Request Type | Agent Path | Trigger |
| ------------ | ---------- | ------- |

[Full table from CLAUDE.md:408-424]

## Agent Profiles

### project-manager

- **Purpose**: Requirements gathering, scope definition
- **Invokes**: When starting new features, documentation
- **Output**: task-description.md
- **Invocation Example**: Task(subagent_type='project-manager', prompt='...')

### software-architect

[Same pattern for each of 13 agents]
...
```

**Load Trigger**: "Read when determining which agent to invoke"

---

### File 4: `.claude/skills/orchestration/references/team-leader-modes.md`

**Purpose**: Detailed MODE 1/2/3 integration patterns

**Content** (extracted from orchestrate.md:254-324 + team-leader.md patterns):

```markdown
# Team-Leader Integration Reference

## Overview

| Mode                  | When             | Purpose                            |
| --------------------- | ---------------- | ---------------------------------- |
| MODE 1: DECOMPOSITION | After architect  | Create tasks.md with batched tasks |
| MODE 2: ASSIGNMENT    | After developer  | Verify, commit, assign next        |
| MODE 3: COMPLETION    | All batches done | Final verification                 |

## MODE 1: DECOMPOSITION

[Invocation template, expected output format]

## MODE 2: ASSIGNMENT + VERIFY + COMMIT

[Loop handling, response patterns]

## MODE 3: COMPLETION

[Final verification, QA handoff]

## Handling Team-Leader Responses

[Decision tree for NEXT BATCH, REJECTED, ALL COMPLETE]
```

**Load Trigger**: "Read when invoking team-leader or handling team-leader responses"

---

### File 5: `.claude/skills/orchestration/references/task-tracking.md`

**Purpose**: Task folder structure, registry management, document templates

**Content** (extracted from CLAUDE.md:615-633 + orchestrate.md context):

```markdown
# Task Tracking Reference

## Task ID Format

`TASK_YYYY_NNN` - Sequential (TASK_2025_001, TASK_2025_002, ...)

## Folder Structure

task-tracking/
registry.md # Master task registry
TASK\_[ID]/
context.md # User intent, conversation summary
task-description.md # Requirements (PM output)
implementation-plan.md # Design (Architect output)
tasks.md # Atomic task breakdown (Team-leader)
test-report.md # Testing results
code-review.md # Review findings
future-enhancements.md # Future work

## Registry Management

[How to read, update, generate new IDs]

## Document Templates

[context.md template, other document formats]

## Continuation Mode

[How to detect phase from existing documents]
```

**Load Trigger**: "Read when initializing tasks or managing task state"

---

### File 6: `.claude/skills/orchestration/references/checkpoints.md`

**Purpose**: User validation patterns and interaction templates

**Content** (extracted from orchestrate.md:329-495):

```markdown
# User Checkpoints Reference

## Checkpoint Types

| Checkpoint              | When              | Purpose                        |
| ----------------------- | ----------------- | ------------------------------ |
| Scope Clarification     | Before PM         | Clarify ambiguous requests     |
| Requirements Validation | After PM          | Approve task-description.md    |
| Technical Clarification | Before Architect  | Technical preferences          |
| Architecture Validation | After Architect   | Approve implementation-plan.md |
| QA Choice               | After Development | Select tester/reviewers        |

## Checkpoint 0: Scope Clarification

[Trigger conditions, template, skip conditions]

## Checkpoint 1: Requirements Validation

[Template with placeholders]

## Checkpoint 1.5: Technical Clarification

[Trigger conditions, template]

## Checkpoint 2: Architecture Validation

[Template]

## Checkpoint 3: QA Choice

[Options: tester, style, logic, reviewers, all, skip]
[Parallel invocation patterns]

## Error Handling

[Validation rejection, verification failure, hook failure]
```

**Load Trigger**: "Read when presenting validation checkpoints to user"

---

### File 7: `.claude/skills/orchestration/references/git-standards.md`

**Purpose**: Commitlint rules and git operations (stays project-specific but referenced)

**Content** (extracted from CLAUDE.md:637-782):

```markdown
# Git Standards Reference

## Commit Message Format

<type>(<scope>): <subject>

## Allowed Types

feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert

## Allowed Scopes (Project-Specific)

webview, vscode, vscode-lm-tools, deps, release, ci, docs, hooks, scripts

## Commit Rules

[Full rules from CLAUDE.md]

## Pre-commit Checks

[Hook workflow, failure protocol]

## Commit Hook Failure Protocol

[3-option choice template]
```

**Load Trigger**: "Read when creating commits or handling hook failures"

---

## Migration Strategy

### What Moves TO the Skill

| From                 | To                                            | Lines |
| -------------------- | --------------------------------------------- | ----- |
| orchestrate.md:1-640 | SKILL.md + references/                        | 640   |
| CLAUDE.md:193-425    | SKILL.md + references/agent-catalog.md        | 232   |
| CLAUDE.md:427-612    | references/strategies.md (creative workflows) | 185   |
| CLAUDE.md:615-633    | references/task-tracking.md                   | 18    |
| CLAUDE.md:637-782    | references/git-standards.md                   | 145   |

### What Stays in CLAUDE.md

The following sections REMAIN in CLAUDE.md (lines 1-192):

- Project Overview (~35 lines)
- Development Commands (~25 lines)
- Workspace Architecture & Library Map (~155 lines)
- File path workaround note (1 line)

**Plus NEW reference** (~10 lines):

```markdown
## ORCHESTRATION & WORKFLOW

For development workflow orchestration, invoke the orchestration skill:

- **Skill**: `.claude/skills/orchestration/SKILL.md`
- **Command**: `/orchestrate [task]` or `/orchestrate TASK_2025_XXX`

The skill supports: FEATURE, BUGFIX, REFACTORING, DOCUMENTATION, RESEARCH, DEVOPS, CREATIVE workflows.
See the skill for flexible invocation patterns (full/partial/minimal).
```

### What Stays in orchestrate.md (Thin Wrapper)

New `.claude/commands/orchestrate.md` (~30 lines):

```markdown
# Orchestrate Development Workflow

Invoke the orchestration skill for development workflows.

## Usage

/orchestrate [task description] # New task
/orchestrate TASK_2025_XXX # Continue existing

## Execution

1. Load `.claude/skills/orchestration/SKILL.md`
2. Follow the Workflow Selection Matrix
3. Execute the chosen strategy
4. Load references as needed during execution

## Quick Reference

- **Strategies**: FEATURE, BUGFIX, REFACTORING, DOCUMENTATION, RESEARCH, DEVOPS
- **Agents**: 13 specialists (see agent-catalog.md)
- **Checkpoints**: Scope, Requirements, Architecture, QA Choice
```

---

## Critical Design Decisions

### 1. Frontmatter Format

**Decision**: Use standard YAML frontmatter with comprehensive description
**Rationale**: Matches skill-creator pattern, description triggers skill selection

```yaml
---
name: orchestration
description: >
  Development workflow orchestration for software engineering tasks.
  Use when: (1) Implementing new features, (2) Fixing bugs, (3) Refactoring code,
  (4) Creating documentation, (5) Research & investigation, (6) DevOps/infrastructure,
  (7) Landing pages and marketing content.
  Supports full (PM→Architect→Dev→QA), partial, or minimal workflows.
  Invoked via /orchestrate command or directly when task analysis suggests delegation.
---
```

### 2. Reference File Organization

**Decision**: Flat references/ folder (no nesting)
**Rationale**: skill-creator/SKILL.md:199 explicitly recommends "Keep references one level deep"

**Structure**:

```
references/
  strategies.md       # All 6 workflows
  agent-catalog.md    # All 13 agents
  team-leader-modes.md
  task-tracking.md
  checkpoints.md
  git-standards.md
```

### 3. Strategy Documentation

**Decision**: One file (strategies.md) with all 6 strategies + creative workflows
**Rationale**: Related content, loaded together when selecting strategy
**Alternative Considered**: Separate file per strategy - rejected (too fragmented)

### 4. Checkpoint Implementation

**Decision**: Checkpoints defined as templates with trigger conditions
**Rationale**: Main agent reads checkpoint template, applies context, presents to user
**Format**:

```markdown
## Checkpoint N: [Name]

**Trigger Conditions** (ask if ANY apply):

- [Condition 1]
- [Condition 2]

**Skip Conditions** (proceed without asking if ALL apply):

- [Condition 1]

**Template**:
[Markdown template with placeholders]
```

### 5. Flexible Invocation Patterns

**Decision**: Document three invocation patterns in SKILL.md
**Rationale**: Enables nested orchestration, partial workflows

| Pattern     | Description                              | When to Use                         |
| ----------- | ---------------------------------------- | ----------------------------------- |
| **Full**    | PM → Architect → Team-Leader → Devs → QA | New features with unclear scope     |
| **Partial** | Architect → Team-Leader → Devs           | Refactoring with known requirements |
| **Minimal** | Direct developer/reviewer invocation     | Simple fixes, quick reviews         |

### 6. Git Standards Location

**Decision**: Keep in references/git-standards.md (skill-specific)
**Rationale**: Commitlint scopes are project-specific, but orchestration needs them
**Alternative**: Keep in CLAUDE.md - rejected (would fragment orchestration knowledge)

---

## Integration Points

### Skill-to-Command Integration

The thin wrapper command loads the skill:

```markdown
# In .claude/commands/orchestrate.md

1. Load `.claude/skills/orchestration/SKILL.md`
2. Follow instructions in skill body
```

### Skill-to-Agent Integration

Skill documents invocation patterns but does NOT modify agents:

```typescript
// Invocation pattern (in SKILL.md + agent-catalog.md)
Task({
  subagent_type: 'project-manager',
  description: 'Create requirements for TASK_[ID]',
  prompt: `...`,
});
```

### Skill-to-CLAUDE.md Integration

CLAUDE.md references skill without duplicating content:

```markdown
## ORCHESTRATION & WORKFLOW

For orchestration, see: `.claude/skills/orchestration/SKILL.md`
```

---

## Risk Analysis

### Risk 1: Skill Not Loading Correctly

**Risk**: Thin wrapper fails to trigger skill loading
**Mitigation**:

- Test with `/orchestrate implement test feature` immediately after migration
- Ensure frontmatter description contains all trigger keywords
  **Validation**: Verify SKILL.md body content appears in context after `/orchestrate`

### Risk 2: Reference Files Not Found

**Risk**: References use wrong paths or aren't loaded when needed
**Mitigation**:

- Use relative paths in SKILL.md: `[strategies.md](references/strategies.md)`
- Include explicit "Read when..." triggers in SKILL.md reference index
  **Validation**: Trace through FEATURE workflow, verify all references accessible

### Risk 3: Continuation Mode Breaks

**Risk**: `/orchestrate TASK_2025_XXX` fails to detect phase correctly
**Mitigation**:

- Phase detection logic stays in SKILL.md (not split to references)
- Test continuation with existing task from registry
  **Validation**: Resume TASK_2025_108 and verify correct phase detection

### Risk 4: Git Standards Orphaned

**Risk**: Developers bypass skill, miss commitlint rules
**Mitigation**:

- Keep minimal git reference in CLAUDE.md pointing to skill
- Team-leader still enforces commit standards (unchanged)
  **Validation**: Test commit through team-leader workflow

### Risk 5: Context Window Bloat

**Risk**: Loading all references exceeds context limits
**Mitigation**:

- Progressive disclosure design
- Clear load triggers prevent unnecessary loading
- Each reference <300 lines
  **Validation**: Monitor token usage during full FEATURE workflow

---

## Validation Checklist

### Pre-Migration Validation

- [ ] All 13 agents accessible at `.claude/agents/*.md`
- [ ] Registry at `task-tracking/registry.md` readable
- [ ] Current orchestrate.md works for continuation

### Post-Migration Validation

- [ ] `/orchestrate implement test feature` triggers skill
- [ ] SKILL.md body loads after trigger
- [ ] References load when explicitly requested
- [ ] Continuation mode works: `/orchestrate TASK_2025_108`
- [ ] All 6 strategies documented in strategies.md
- [ ] All 13 agents cataloged in agent-catalog.md
- [ ] Checkpoints render correctly
- [ ] Git commits through team-leader pass commitlint

---

## Files Affected Summary

### CREATE (7 files)

| File                                                           | Lines | Purpose                    |
| -------------------------------------------------------------- | ----- | -------------------------- |
| `.claude/skills/orchestration/SKILL.md`                        | ~400  | Core skill entry point     |
| `.claude/skills/orchestration/references/strategies.md`        | ~250  | All 6 workflow strategies  |
| `.claude/skills/orchestration/references/agent-catalog.md`     | ~200  | 13 agent profiles          |
| `.claude/skills/orchestration/references/team-leader-modes.md` | ~150  | MODE 1/2/3 integration     |
| `.claude/skills/orchestration/references/task-tracking.md`     | ~100  | Folder structure, registry |
| `.claude/skills/orchestration/references/checkpoints.md`       | ~150  | User validation patterns   |
| `.claude/skills/orchestration/references/git-standards.md`     | ~100  | Commitlint rules           |

### REWRITE (2 files)

| File                              | Before    | After      | Change                       |
| --------------------------------- | --------- | ---------- | ---------------------------- |
| `.claude/commands/orchestrate.md` | 640 lines | ~30 lines  | Thin wrapper                 |
| `CLAUDE.md`                       | 783 lines | ~202 lines | Remove orchestration section |

### NO CHANGE

- All `.claude/agents/*.md` files (13 files)
- `task-tracking/registry.md`

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: N/A (documentation task)
**Rationale**: This is a content migration/refactoring task, not code implementation

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 4-6 hours

**Breakdown**:

- Create 7 new files with migrated content: 3-4 hours
- Rewrite orchestrate.md as thin wrapper: 30 minutes
- Update CLAUDE.md (remove ~580 lines): 30 minutes
- Validation testing: 1-2 hours

### Critical Verification Points

1. **Skill triggers correctly**: `/orchestrate` loads SKILL.md
2. **References accessible**: All 6 reference files load when requested
3. **Continuation works**: `/orchestrate TASK_2025_XXX` resumes correctly
4. **No agent changes**: All 13 agents still work unchanged
5. **Git standards work**: Commits through team-leader pass hooks

---

## Architecture Delivery Checklist

- [x] All components specified with clear file paths
- [x] All patterns extracted from existing skills (skill-creator, ui-ux-designer)
- [x] Content migration strategy documented
- [x] Reference organization follows skill-creator best practices
- [x] Checkpoints documented with templates
- [x] Flexible invocation patterns (full/partial/minimal) specified
- [x] Risk analysis with mitigation strategies
- [x] Validation checklist provided
- [x] Files affected summary complete
- [x] No changes required to existing agents
