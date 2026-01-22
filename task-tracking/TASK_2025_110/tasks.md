# Development Tasks - TASK_2025_110

**Total Tasks**: 9 | **Batches**: 4 | **Status**: 0/4 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- Skill structure follows existing patterns (skill-creator/SKILL.md): VERIFIED
- Progressive disclosure pattern documented: VERIFIED
- Flat references folder recommended: VERIFIED
- 13 agents remain unchanged: VERIFIED
- Source content exists in orchestrate.md (640 lines): VERIFIED
- Source content exists in CLAUDE.md (lines 193-783): VERIFIED

### Risks Identified

| Risk | Severity | Mitigation |
|------|----------|------------|
| Skill not triggering correctly | MEDIUM | Include comprehensive trigger keywords in frontmatter description |
| Reference file paths incorrect | LOW | Use relative paths from SKILL.md location |
| Content lost during migration | LOW | Create all new files before modifying existing ones |

### Edge Cases to Handle

- [ ] Ensure frontmatter description contains all 7 trigger keywords (FEATURE, BUGFIX, REFACTORING, DOCUMENTATION, RESEARCH, DEVOPS, CREATIVE)
- [ ] Verify thin wrapper command correctly references skill path
- [ ] Ensure CLAUDE.md retains project-specific content (lines 1-192)

---

## Batch 1: Core Skill Structure - COMPLETE

**Developer**: documentation-developer
**Tasks**: 2 | **Dependencies**: None

### Task 1.1: Create skill folder and SKILL.md

**File**: D:\projects\ptah-extension\.claude\skills\orchestration\SKILL.md
**Spec Reference**: implementation-plan.md:86-140
**Pattern to Follow**: D:\projects\ptah-extension\.claude\skills\skill-creator\SKILL.md (frontmatter + body structure)

**Quality Requirements**:
- YAML frontmatter with name and description fields
- Description must include all 7 workflow types as triggers
- Quick Start section with /orchestrate usage examples
- Workflow Selection Matrix (task type detection logic)
- Core Orchestration Loop (Phase 0 initialization, agent invocation pattern)
- Flexible Invocation Patterns (full/partial/minimal)
- Reference Index table linking to all 6 reference files

**Implementation Details**:
- Extract from orchestrate.md:1-104 (mode detection, Phase 0, task type analysis)
- Extract from CLAUDE.md:239-360 (orchestrator workflow, execution flow)
- Approximately 350-400 lines total
- Use imperative/infinitive form in instructions

**Status**: COMPLETE

**Implementation Notes**:
- Created SKILL.md with 398 lines (within 350-400 target)
- YAML frontmatter includes all 7 workflow types in description
- Quick Start section with usage examples and strategy quick reference
- Workflow Selection Matrix with task type detection keywords and complexity assessment
- Core Orchestration Loop with Phase 0 initialization, continuation detection, agent invocation pattern
- Flexible Invocation Patterns (Full, Partial, Minimal) with selection guidance
- Reference Index table with all 6 reference files and load triggers
- Team-Leader Integration summary (full details in reference file)
- Error Handling patterns documented
- Key Design Principles section added

---

### Task 1.2: Create references folder structure

**File**: D:\projects\ptah-extension\.claude\skills\orchestration\references\ (folder)
**Spec Reference**: implementation-plan.md:62-77
**Dependencies**: Task 1.1

**Quality Requirements**:
- Empty folder created to establish structure
- Ready for reference files in subsequent batches

**Implementation Details**:
- Create empty references/ folder inside orchestration/ skill folder

**Status**: COMPLETE

**Implementation Notes**:
- Created D:\projects\ptah-extension\.claude\skills\orchestration\references\ folder
- Folder ready for Batch 2 and Batch 3 reference files

---

**Batch 1 Verification**:
- [x] .claude/skills/orchestration/SKILL.md exists with proper frontmatter
- [x] .claude/skills/orchestration/references/ folder exists
- [x] Frontmatter contains comprehensive description with all triggers

---

## Batch 2: Primary Reference Files

**Developer**: documentation-developer
**Tasks**: 2 | **Dependencies**: Batch 1

### Task 2.1: Create strategies.md reference

**File**: D:\projects\ptah-extension\.claude\skills\orchestration\references\strategies.md
**Spec Reference**: implementation-plan.md:143-175
**Pattern to Follow**: orchestrate.md:105-224 (all 6 strategies)

**Quality Requirements**:
- Document all 6 execution strategies: FEATURE, BUGFIX, REFACTORING, DOCUMENTATION, RESEARCH, DEVOPS
- Include ASCII flow diagrams for each strategy
- Add Creative Workflows section (ui-ux-designer + content-writer flow)
- Include "When to invoke" triggers for conditional agents
- Approximately 250 lines

**Implementation Details**:
- Migrate from orchestrate.md:105-224 (strategies section)
- Migrate from CLAUDE.md:427-612 (creative workflow orchestration)
- Include DEVOPS strategy details (DevOps engineer invocation)

**Status**: PENDING

---

### Task 2.2: Create agent-catalog.md reference

**File**: D:\projects\ptah-extension\.claude\skills\orchestration\references\agent-catalog.md
**Spec Reference**: implementation-plan.md:178-206
**Pattern to Follow**: CLAUDE.md:408-424 (agent selection matrix)

**Quality Requirements**:
- Agent Selection Matrix table (Request Type | Agent Path | Trigger)
- Profile for each of 13 agents with:
  - Purpose
  - When to invoke
  - Output file(s)
  - Invocation example
- Approximately 200 lines

**Implementation Details**:
- Migrate from CLAUDE.md:408-424 (agent selection matrix)
- Extract agent list from context.md:110-124
- Document all 13 agents: project-manager, software-architect, team-leader, backend-developer, frontend-developer, devops-engineer, senior-tester, code-style-reviewer, code-logic-reviewer, researcher-expert, modernization-detector, ui-ux-designer, technical-content-writer

**Status**: PENDING

---

**Batch 2 Verification**:
- [ ] references/strategies.md exists with all 6 strategies
- [ ] references/agent-catalog.md exists with all 13 agents
- [ ] Both files follow markdown best practices

---

## Batch 3: Supporting Reference Files

**Developer**: documentation-developer
**Tasks**: 4 | **Dependencies**: Batch 2

### Task 3.1: Create team-leader-modes.md reference

**File**: D:\projects\ptah-extension\.claude\skills\orchestration\references\team-leader-modes.md
**Spec Reference**: implementation-plan.md:209-237
**Pattern to Follow**: orchestrate.md:254-324 (team-leader integration)

**Quality Requirements**:
- Overview table: Mode | When | Purpose
- MODE 1: DECOMPOSITION details with invocation template
- MODE 2: ASSIGNMENT + VERIFY + COMMIT loop handling
- MODE 3: COMPLETION final verification
- Handling Team-Leader Responses decision tree
- Approximately 150 lines

**Implementation Details**:
- Migrate from orchestrate.md:254-324 (team-leader integration section)
- Include response handling patterns (NEXT BATCH, REJECTED, ALL COMPLETE)

**Status**: PENDING

---

### Task 3.2: Create task-tracking.md reference

**File**: D:\projects\ptah-extension\.claude\skills\orchestration\references\task-tracking.md
**Spec Reference**: implementation-plan.md:240-276
**Pattern to Follow**: CLAUDE.md:615-633 (task management section)

**Quality Requirements**:
- Task ID Format: TASK_YYYY_NNN
- Folder Structure diagram
- Registry Management instructions
- Document Templates (context.md template)
- Continuation Mode detection logic
- Approximately 100 lines

**Implementation Details**:
- Migrate from CLAUDE.md:615-633 (task management section)
- Migrate from orchestrate.md:227-251 (continuation phase detection)
- Include phase detection table from orchestrate.md:236-250

**Status**: PENDING

---

### Task 3.3: Create checkpoints.md reference

**File**: D:\projects\ptah-extension\.claude\skills\orchestration\references\checkpoints.md
**Spec Reference**: implementation-plan.md:279-318
**Pattern to Follow**: orchestrate.md:329-495 (user checkpoints section)

**Quality Requirements**:
- Checkpoint Types table: Checkpoint | When | Purpose
- Checkpoint 0: Scope Clarification (trigger conditions, template, skip conditions)
- Checkpoint 1: Requirements Validation (template)
- Checkpoint 1.5: Technical Clarification (trigger conditions, template)
- Checkpoint 2: Architecture Validation (template)
- Checkpoint 3: QA Choice (options table, parallel invocation patterns)
- Error Handling section (validation rejection, verification failure, hook failure)
- Approximately 150 lines

**Implementation Details**:
- Migrate from orchestrate.md:329-495 (all checkpoint templates)
- Include QA invocation patterns for tester/style/logic/reviewers/all

**Status**: PENDING

---

### Task 3.4: Create git-standards.md reference

**File**: D:\projects\ptah-extension\.claude\skills\orchestration\references\git-standards.md
**Spec Reference**: implementation-plan.md:321-349
**Pattern to Follow**: CLAUDE.md:637-782 (git operations section)

**Quality Requirements**:
- Commit Message Format template
- Allowed Types table (11 types with descriptions)
- Allowed Scopes table (9 scopes - project-specific)
- Commit Rules (enforced by commitlint)
- Valid/Invalid Examples
- Pre-commit Checks workflow
- Commit Hook Failure Protocol (3-option choice template)
- Approximately 100 lines

**Implementation Details**:
- Migrate from CLAUDE.md:637-782 (git operations & commit standards section)
- Include all commitlint rules and examples

**Status**: PENDING

---

**Batch 3 Verification**:
- [ ] references/team-leader-modes.md exists with all 3 modes
- [ ] references/task-tracking.md exists with folder structure and continuation logic
- [ ] references/checkpoints.md exists with all 5 checkpoint types
- [ ] references/git-standards.md exists with commitlint rules

---

## Batch 4: Command Wrapper and CLAUDE.md Update

**Developer**: documentation-developer
**Tasks**: 2 | **Dependencies**: Batch 3

### Task 4.1: Rewrite orchestrate.md as thin wrapper

**File**: D:\projects\ptah-extension\.claude\commands\orchestrate.md
**Spec Reference**: implementation-plan.md:386-409
**Pattern to Follow**: implementation-plan.md:391-409 (thin wrapper template)

**Quality Requirements**:
- Reduce from 640 lines to ~30 lines
- Include usage examples (/orchestrate [task], /orchestrate TASK_2025_XXX)
- Reference skill path: .claude/skills/orchestration/SKILL.md
- Include Quick Reference for strategies, agents, checkpoints
- Clear execution instructions (load skill, follow matrix, use references)

**Implementation Details**:
- Replace entire current content with thin wrapper
- Point to skill for all orchestration logic
- Keep same /orchestrate command interface

**Validation Notes**:
- CRITICAL: Verify skill path is correct relative to command location
- Test that /orchestrate still triggers correctly after change

**Status**: PENDING

---

### Task 4.2: Update CLAUDE.md (remove orchestration content)

**File**: D:\projects\ptah-extension\CLAUDE.md
**Spec Reference**: implementation-plan.md:366-384
**Pattern to Follow**: implementation-plan.md:376-384 (new reference section)

**Quality Requirements**:
- Keep lines 1-192 (Project Overview, Development Commands, Workspace Architecture)
- Replace lines 193-783 with brief skill reference (~10 lines)
- New section title: "ORCHESTRATION & WORKFLOW"
- Reference skill path and /orchestrate command
- List supported workflow types

**Implementation Details**:
- Delete lines 193-783 (approximately 590 lines of orchestration content)
- Add new reference section pointing to skill
- Keep file path workaround note (line 191)
- Resulting file should be approximately 202 lines

**Validation Notes**:
- CRITICAL: Verify project-specific content (lines 1-192) is preserved exactly
- Ensure git standards are now only in skill (references/git-standards.md)

**Status**: PENDING

---

**Batch 4 Verification**:
- [ ] orchestrate.md is ~30 lines (thin wrapper)
- [ ] CLAUDE.md is ~202 lines (orchestration content removed)
- [ ] /orchestrate command still functions
- [ ] Skill reference in CLAUDE.md points to correct path

---

## Status Legend

| Icon | Status | Description |
|------|--------|-------------|
| PENDING | Not started | Task ready to be assigned |
| IN PROGRESS | Active | Developer working on task |
| IMPLEMENTED | Code done | Awaiting team-leader verification |
| COMPLETE | Verified | Git committed, verified |
| FAILED | Blocked | Verification failed |

---

## Notes

- This is a documentation/content migration task, not code implementation
- All work involves creating/modifying markdown files
- No TypeScript, Angular, or code changes required
- Developer should read source files and extract content per specifications
- Team-leader handles git commits after verification
