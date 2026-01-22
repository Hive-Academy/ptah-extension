# Task Context - TASK_2025_110

## User Intent

Convert the orchestration workflow from a command + CLAUDE.md embedded rules into a self-contained, reusable **skill** that enables flexible orchestration patterns for any software engineering task.

## Why This Task?

Currently, orchestration is spread across multiple files:
- `.claude/commands/orchestrate.md` (640 lines) - The slash command
- `CLAUDE.md` (lines 193-500+) - Embedded orchestration rules
- `.claude/agents/team-leader.md` (679 lines) - Task decomposition logic

This fragmentation causes:
1. **Duplication**: Rules repeated in CLAUDE.md and orchestrate.md
2. **Inflexibility**: Only one workflow pattern (full orchestration)
3. **No Nesting**: Subagents cannot orchestrate sub-tasks
4. **Maintenance Burden**: Updates needed in multiple places

## User Requirements (Confirmed)

1. **Create a Skill** (not just refactor the command)
   - Location: `.claude/skills/orchestration/SKILL.md`
   - Progressive disclosure: metadata always loaded, body on-demand

2. **Flexible Orchestration Patterns**:
   - **Full**: PM → Architect → Team-Leader → Devs → QA
   - **Partial**: Architect → Team-Leader → Devs
   - **Minimal**: Just specific developers/reviewers
   - Main agent chooses which pattern based on task

3. **Replace `/orchestrate` Command**:
   - Convert to thin wrapper that invokes the skill
   - Keep same usage: `/orchestrate [task]` or `/orchestrate TASK_2025_XXX`

4. **Remove from CLAUDE.md**:
   - Delete all orchestration rules (lines 193-500+)
   - Add single reference to the skill

5. **Subagent Clarification**:
   - Subagents can use `AskUserQuestion` tool to clarify with users
   - Ensures quality over speed

6. **Same Task Folder**:
   - No nested sub-task folders
   - All work goes into parent task folder

---

## Current File Analysis

### File 1: `.claude/commands/orchestrate.md` (640 lines)

**Purpose**: Slash command that triggers orchestration workflow

**Key Sections**:
- Mode Detection (NEW_TASK vs CONTINUATION)
- Phase 0 Initialization (read registry, create task folder, generate ID)
- Execution Strategies (6 types - see below)
- Team-Leader Integration (3 modes)
- User Validation Checkpoints (4 checkpoints)
- Error Handling

**Strategies Defined**:
| Strategy | Flow |
|----------|------|
| FEATURE | PM → [Research] → [UI/UX] → Architect → Team-Leader → QA → Modernization |
| BUGFIX | [Research] → Team-Leader → QA |
| REFACTORING | Architect → Team-Leader → QA |
| DOCUMENTATION | PM → Developer → Style Reviewer |
| RESEARCH | Researcher → [conditional implementation] |
| DEVOPS | PM → Architect → DevOps Engineer → QA |

### File 2: `CLAUDE.md` (lines 193-500+)

**Purpose**: Project instructions with embedded orchestration rules

**Orchestration Content to Extract**:
- "YOUR ROLE: ORCHESTRATOR & MANAGER" section
- "When to Use Agents" matrix
- "ORCHESTRATOR WORKFLOW" architecture
- "WORKFLOW PROTOCOL" (before any request)
- "CREATIVE WORKFLOW ORCHESTRATION" (ui-ux-designer + content-writer)
- "TASK MANAGEMENT" (ID format, folder structure)
- "GIT OPERATIONS & COMMIT STANDARDS"

**Keep in CLAUDE.md**:
- Project Overview
- Development Commands
- Workspace Architecture & Library Map
- Git commit standards (commitlint rules)

### File 3: `.claude/agents/team-leader.md` (679 lines)

**Purpose**: Task decomposition & batch orchestration specialist

**Key Sections**:
- MODE 1: DECOMPOSITION (create tasks.md from implementation-plan.md)
- MODE 2: ASSIGNMENT + VERIFY + COMMIT (loop for each batch)
- MODE 3: COMPLETION (final verification)
- Plan Validation (5 validation questions)
- Batching Strategy (3-5 tasks per batch)

**Note**: This file stays as an agent. The skill references it.

### File 4: Existing Agents (13 total)

Located in `.claude/agents/`:

| Agent | File | Purpose |
|-------|------|---------|
| project-manager | project-manager.md | Requirements gathering |
| software-architect | software-architect.md | Technical design |
| team-leader | team-leader.md | Task decomposition & batching |
| backend-developer | backend-developer.md | Backend implementation |
| frontend-developer | frontend-developer.md | Frontend implementation |
| devops-engineer | devops-engineer.md | Infrastructure & CI/CD |
| senior-tester | senior-tester.md | Testing |
| code-style-reviewer | code-style-reviewer.md | Pattern review |
| code-logic-reviewer | code-logic-reviewer.md | Logic completeness |
| researcher-expert | researcher-expert.md | Technical research |
| modernization-detector | modernization-detector.md | Future improvements |
| ui-ux-designer | ui-ux-designer.md | Visual design |
| technical-content-writer | technical-content-writer.md | Documentation |

### File 5: Existing Skills (reference for structure)

Located in `.claude/skills/`:

**skill-creator/** - Good reference for skill structure:
```
skill-creator/
├── SKILL.md (357 lines)
└── references/
    ├── output-patterns.md
    └── workflows.md
```

**ui-ux-designer/** - Example of skill with multiple references:
```
ui-ux-designer/
├── SKILL.md
├── ASSET-GENERATION.md
├── DESIGN-SYSTEM-BUILDER.md
├── NICHE-DISCOVERY.md
└── REFERENCE-LIBRARY.md
```

---

## Target Structure

```
.claude/skills/orchestration/
├── SKILL.md                      # Main skill (~300-400 lines)
│   ├── YAML frontmatter (name, description)
│   ├── Quick Start (usage examples)
│   ├── Workflow Selection (how to choose strategy)
│   ├── Core Orchestration Loop
│   └── References index
│
├── references/
│   ├── strategies.md             # All 6 strategies detailed
│   │   ├── FEATURE workflow
│   │   ├── BUGFIX workflow
│   │   ├── REFACTORING workflow
│   │   ├── DOCUMENTATION workflow
│   │   ├── RESEARCH workflow
│   │   └── DEVOPS workflow
│   │
│   ├── agent-catalog.md          # All 13 agents
│   │   ├── Agent capabilities
│   │   ├── When to use each
│   │   └── Invocation patterns
│   │
│   ├── team-leader-modes.md      # MODE 1, 2, 3 details
│   │   ├── DECOMPOSITION mode
│   │   ├── ASSIGNMENT mode
│   │   └── COMPLETION mode
│   │
│   ├── task-tracking.md          # Folder structure, registry
│   │   ├── Task ID format (TASK_YYYY_NNN)
│   │   ├── Folder structure
│   │   ├── Registry management
│   │   └── Document templates
│   │
│   └── checkpoints.md            # User validation patterns
│       ├── Scope clarification
│       ├── Requirements validation
│       ├── Architecture validation
│       ├── QA choice
│       └── Error handling
│
└── assets/                       # (optional - templates if needed)
```

---

## Implementation Plan Outline

### Batch 1: Create Skill Structure
1. Create `.claude/skills/orchestration/SKILL.md` with frontmatter
2. Write core orchestration logic (workflow selection, loop)
3. Create `references/` folder structure

### Batch 2: Extract Strategies
1. Create `references/strategies.md`
2. Move all 6 strategy definitions from orchestrate.md
3. Add flexible invocation patterns (full/partial/minimal)

### Batch 3: Create Supporting References
1. Create `references/agent-catalog.md` (all 13 agents)
2. Create `references/team-leader-modes.md`
3. Create `references/task-tracking.md`
4. Create `references/checkpoints.md`

### Batch 4: Update Command & CLAUDE.md
1. Replace `.claude/commands/orchestrate.md` with thin wrapper
2. Remove orchestration content from `CLAUDE.md`
3. Add skill reference to `CLAUDE.md`

### Batch 5: Validation & Testing
1. Test `/orchestrate` command invokes skill correctly
2. Verify all strategies work
3. Test continuation mode (TASK_2025_XXX)

---

## Key Design Decisions

### 1. Skill Frontmatter

```yaml
---
name: orchestration
description: >
  Development workflow orchestration for software engineering tasks.
  Use when: (1) Implementing new features, (2) Fixing bugs, (3) Refactoring code,
  (4) Creating documentation, (5) Research & investigation, (6) DevOps/infrastructure.
  Supports full (PM→Architect→Dev→QA), partial, or minimal workflows.
---
```

### 2. Thin Command Wrapper

New `.claude/commands/orchestrate.md` (~20 lines):
```markdown
# Orchestrate Development Workflow

Invoke the orchestration skill for development workflows.

## Usage
/orchestrate [task description]   # New task
/orchestrate TASK_2025_XXX        # Continue existing

## Execution
1. Read `.claude/skills/orchestration/SKILL.md`
2. Follow the workflow selection and execution instructions
3. Use references as needed for detailed guidance
```

### 3. CLAUDE.md Reference

Replace lines 193-500+ with:
```markdown
## 🎯 ORCHESTRATION & WORKFLOW

For development workflow orchestration, use the orchestration skill:
- **Skill**: `.claude/skills/orchestration/SKILL.md`
- **Command**: `/orchestrate [task]` or `/orchestrate TASK_2025_XXX`

The skill supports: FEATURE, BUGFIX, REFACTORING, DOCUMENTATION, RESEARCH, DEVOPS workflows.
```

### 4. Progressive Disclosure

| Level | Content | When Loaded |
|-------|---------|-------------|
| Metadata | name + description (~100 words) | Always |
| SKILL.md body | Core workflow (~400 lines) | When skill triggers |
| references/* | Strategy details (~1500 lines total) | As needed by workflow |

---

## Files to Read Before Starting

1. **Current orchestrate command**: `.claude/commands/orchestrate.md`
2. **Current CLAUDE.md orchestration section**: `CLAUDE.md` (lines 193-500+)
3. **Team-leader agent**: `.claude/agents/team-leader.md`
4. **Skill structure reference**: `.claude/skills/skill-creator/SKILL.md`
5. **Task tracking registry**: `task-tracking/registry.md`

---

## Success Criteria

- [ ] `.claude/skills/orchestration/SKILL.md` created with proper frontmatter
- [ ] All 6 strategies documented in `references/strategies.md`
- [ ] All 13 agents catalogued in `references/agent-catalog.md`
- [ ] Team-leader 3-mode integration in `references/team-leader-modes.md`
- [ ] Task tracking patterns in `references/task-tracking.md`
- [ ] User checkpoints in `references/checkpoints.md`
- [ ] `/orchestrate` command converted to thin wrapper
- [ ] CLAUDE.md cleaned (orchestration content removed)
- [ ] `/orchestrate implement X` works via skill
- [ ] `/orchestrate TASK_2025_XXX` (continuation) works via skill

---

## Dependencies

- **Blocks**: TASK_2025_111 (MCP-Powered Setup Wizard needs this skill to exist)
- **Depends on**: None

## Related Tasks

- **TASK_2025_111**: MCP-Powered Setup Wizard (will generate this skill for new projects)
- **TASK_2025_108**: Premium Feature Enforcement (completed - reference for patterns)

---

## Notes for New Session

When starting this task in a fresh session:

1. **Read the files listed above** to understand current state
2. **Use `/orchestrate TASK_2025_110`** to continue this task
3. **Follow the FEATURE workflow** (PM → Architect → Team-Leader → Devs)
4. **All 13 agents are available** in `.claude/agents/`
5. **Reference existing skills** for structure patterns

The goal is a self-contained skill that enables flexible orchestration - the main agent should be able to orchestrate any software task by reading the skill and choosing the appropriate workflow pattern.
