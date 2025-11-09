# Modular Agent Orchestration System

**Status**: ✅ Complete  
**Created**: {current date}  
**Architecture**: Phase-based modular prompts with validation gates

---

## 🎯 System Overview

The Ptah extension now uses a **modular agent orchestration system** where each development phase is an independent `.prompt.md` file that can be invoked sequentially through a master orchestrator.

### Key Innovation

**Instead of**: One monolithic `orchestrate.prompt.md` with pseudocode "calls" to agents  
**We have**: 8+ independent phase prompts, each specifying its own agent mode, that can be chained together

---

## 📁 File Structure

```
.github/
  prompts/
    orchestrate-v2.prompt.md           # Master coordinator
    phase1-project-manager.prompt.md   # Requirements phase
    validation-gate.prompt.md          # Reusable validation
    phase2-researcher-expert.prompt.md # Research phase (conditional)
    phase3-software-architect.prompt.md # Architecture phase
    phase4-backend-developer.prompt.md # Backend implementation
    phase4-frontend-developer.prompt.md # Frontend implementation
    phase5-senior-tester.prompt.md     # Testing phase
    phase6-code-reviewer.prompt.md     # Final review
    phase8-modernization-detector.prompt.md # Future work consolidation

  chatmodes/
    product-manager.chatmode.md        # PM persona
    business-analyst.chatmode.md       # BA persona
    researcher-expert.chatmode.md      # Researcher persona
    software-architect.chatmode.md     # Architect persona
    backend-developer.chatmode.md      # Backend dev persona
    frontend-developer.chatmode.md     # Frontend dev persona
    senior-tester.chatmode.md          # Tester persona
    code-reviewer.chatmode.md          # Reviewer persona
    modernization-detector.chatmode.md # Modernization persona
```

---

## 🔄 How It Works

### 1. User Invokes Orchestrator

```bash
/orchestrate "Add new Claude API integration feature"
```

### 2. Master Orchestrator Coordinates

The `orchestrate-v2.prompt.md` file:

- Initializes git branch and task folder
- Injects phase-specific prompts at appropriate times
- Passes context between phases
- Handles validation gates
- Creates PR upon completion

### 3. Each Phase is Self-Contained

Example `phase1-project-manager.prompt.md`:

```yaml
---
mode: agent
description: Requirements analysis phase
tools: ['codebase', 'search']
---
# Phase 1: Project Manager - Requirements Analysis

You are the **Project Manager** for this task.

## Your Role
#file:../.github/chatmodes/product-manager.chatmode.md

## Context
**Task ID**: {TASK_ID}
**User Request**: {USER_REQUEST}

## Your Mission
Create comprehensive task-description.md with SMART requirements and BDD acceptance criteria.

[Detailed instructions and templates...]

## Completion Signal
## PHASE 1 COMPLETE ✅
[Output format...]
```

### 4. Validation Gates Between Phases

After each phase, `validation-gate.prompt.md` is invoked:

```markdown
#file:./validation-gate.prompt.md

PHASE_NAME: "Phase 1 - Requirements Analysis"
AGENT_NAME: "project-manager"
DELIVERABLE_PATH: "task-tracking/{TASK_ID}/task-description.md"
```

Business analyst reviews and either:

- ✅ **APPROVE** → Proceed to next phase
- ❌ **REJECT** → Re-execute current phase with corrections

---

## 🏗️ Architecture Patterns

### Instruction-Based Role Adoption

**We don't "call" agents**. Instead, we:

1. Use `mode: agent` in prompt frontmatter
2. Load chatmode instructions via `#file` reference
3. Guide AI to adopt that role for the phase
4. Use structured output format to signal completion

### Context Passing with Variables

Each phase receives context from previous phases:

```markdown
**Task ID**: {TASK_ID}
**User Request**: {USER_REQUEST}
**Requirements**: #file:../../task-tracking/{TASK_ID}/task-description.md
**Implementation Plan**: #file:../../task-tracking/{TASK_ID}/implementation-plan.md
```

Variables are "injected" by orchestrator as natural language instructions.

### Deliverable-Driven Workflow

Each phase produces a specific deliverable:

| Phase | Agent                  | Deliverable                        |
| ----- | ---------------------- | ---------------------------------- |
| 1     | Project Manager        | `task-description.md`              |
| 2     | Researcher Expert      | `research-report.md` (conditional) |
| 3     | Software Architect     | `implementation-plan.md`           |
| 4     | Developers             | Code changes + `progress.md`       |
| 5     | Senior Tester          | Tests + `test-report.md`           |
| 6     | Code Reviewer          | `code-review.md`                   |
| 8     | Modernization Detector | `future-enhancements.md`           |

---

## 🎨 Phase Details

### Phase 0: Task Initialization

**Orchestrator handles**:

- Generate `TASK_ID` (e.g., `TASK_CMD_003`)
- Create feature branch
- Create task folder structure
- Update registry
- Initial git commit

### Phase 1: Requirements Analysis

**Agent**: Project Manager  
**Input**: User request  
**Output**: `task-description.md`

**Content**:

- SMART requirements
- BDD acceptance criteria (Given/When/Then)
- Risk assessment
- Research needs recommendation
- Timeline estimate

**Validation**: Business Analyst checks for completeness

### Phase 2: Technical Research (Conditional)

**Agent**: Researcher Expert  
**Input**: Requirements + research questions  
**Output**: `research-report.md`

**Content**:

- 3-5 authoritative sources per question
- Comparative analysis of approaches
- Performance/security implications
- Recommendation with evidence
- Alternative approaches considered

**Triggered**: Only if PM recommends research

### Phase 3: Architecture Planning

**Agent**: Software Architect  
**Input**: Requirements + research (if exists)  
**Output**: `implementation-plan.md`

**Content**:

- Architecture overview
- Type/schema reuse strategy
- File changes planned
- SOLID compliance design
- Integration points
- Testing strategy
- Timeline discipline (<2 weeks)

**Validation**: Business Analyst checks architecture soundness

### Phase 4: Development

**Agents**: Backend Developer AND/OR Frontend Developer  
**Input**: Implementation plan  
**Output**: Code changes + `progress.md`

**Backend Developer** (TypeScript Extension):

- Service implementation with registry pattern
- Error boundaries around external calls
- VS Code API integration
- Type safety (zero `any` types)
- Progress tracking every 30 min

**Frontend Developer** (Angular Webview):

- Standalone components
- Signal-based APIs (`input()`, `output()`)
- Modern control flow (`@if`, `@for`)
- OnPush change detection
- Extension communication

**Validation**: Business Analyst checks implementation quality

### Phase 5: Testing

**Agent**: Senior Tester  
**Input**: Implementation + requirements  
**Output**: Tests + `test-report.md`

**Content**:

- Unit tests (≥80% coverage)
- Integration tests
- Manual E2E testing
- Performance benchmarks
- Test traceability matrix
- Bug reports

**Validation**: Business Analyst checks test coverage

### Phase 6: Code Review

**Agent**: Code Reviewer  
**Input**: All previous deliverables + code changes  
**Output**: `code-review.md`

**Reviews**:

- Requirements compliance
- SOLID principles
- Type safety
- Error handling
- Code size limits
- Performance
- Security
- Documentation

**Decision**: APPROVE | REJECT | CONDITIONAL

### Phase 7: Task Completion

**Orchestrator handles**:

- Final git commit
- Create Pull Request via `gh` CLI
- Update registry status
- Output PR URL

### Phase 8: Future Work

**Agent**: Modernization Detector  
**Input**: All task deliverables  
**Output**: `future-enhancements.md`

**Content**:

- Future work items extracted
- Modernization opportunities detected
- Technical debt documented
- Lessons learned
- Dashboard updates
- Registry entries for high-priority items

---

## 🚀 Usage Examples

### Simple Feature Addition

```bash
/orchestrate "Add dark mode toggle to webview settings"
```

**Flow**: Phase 1 → Validation → Phase 3 → Validation → Phase 4 (Frontend) → Validation → Phase 5 → Validation → Phase 6 → Validation → Phase 7 → Phase 8

**Skips**: Phase 2 (no research needed)

### Complex Integration

```bash
/orchestrate "Integrate OpenAI GPT-4 as alternative AI provider"
```

**Flow**: Phase 1 → Validation → **Phase 2 (Research)** → Validation → Phase 3 → Validation → Phase 4 (Backend + Frontend) → Validation → Phase 5 → Validation → Phase 6 → Validation → Phase 7 → Phase 8

**Includes**: Phase 2 for API research, both backend and frontend development

### Bug Fix

```bash
/orchestrate "Fix memory leak in streaming response handler"
```

**Flow**: Phase 1 → Validation → Phase 3 → Validation → Phase 4 (Backend) → Validation → Phase 5 → Validation → Phase 6 → Validation → Phase 7 → Phase 8

**Skips**: Phase 2 (bug fix, no research)  
**Focus**: Backend only

---

## 🎯 Key Benefits

### 1. Modularity

Each phase is independent and testable. Can invoke phases individually:

```bash
/phase1-project-manager TASK_CMD_003
/validation-gate PHASE_NAME="Phase 1"
```

### 2. Reusability

Validation gate is parameterized and reused 6+ times per workflow.

### 3. Maintainability

To update requirements phase logic, edit only `phase1-project-manager.prompt.md`.

### 4. Flexibility

Can skip phases conditionally:

- No research needed? Skip Phase 2
- Frontend-only change? Skip backend developer
- Backend-only change? Skip frontend developer

### 5. Consistency

Every task follows same workflow, ensuring quality gates are never skipped.

### 6. Visibility

Each phase produces traceable deliverables in `task-tracking/{TASK_ID}/` folder.

---

## 🔧 Technical Details

### Frontmatter Pattern

Every phase prompt uses:

```yaml
---
mode: agent # Enables autonomous execution
description: '...' # Human-readable description
tools: [...] # VS Code tools this phase needs
---
```

### File Reference Pattern

```markdown
#file:../.github/chatmodes/{agent}.chatmode.md
```

Loads agent persona instructions into context.

### Context Variable Pattern

```markdown
**Task ID**: {TASK_ID}
**User Request**: {USER_REQUEST}
```

Orchestrator provides these as natural language, not actual variables.

### Completion Signal Pattern

```markdown
## PHASE X COMPLETE ✅

**Deliverable**: task-tracking/{TASK_ID}/{file.md}
**Key Metric**: {value}

Ready for validation gate (business-analyst).
```

Structured output that orchestrator can detect.

---

## 📊 Validation Gate Framework

### How Validation Works

1. **Phase completes** with deliverable
2. **Orchestrator invokes** `validation-gate.prompt.md` with parameters
3. **Business Analyst role adopted** via `#file` reference
4. **Comprehensive checklist** for that phase type applied
5. **Decision output**: APPROVE or REJECT with evidence

### Validation Checklists

**Different checklists for different phases**:

- **Phase 1**: SMART criteria, BDD format, risk assessment
- **Phase 2**: Source credibility, comparative analysis, evidence quality
- **Phase 3**: SOLID compliance, type reuse, timeline discipline
- **Phase 4**: Build success, type safety, error handling
- **Phase 5**: Coverage thresholds, acceptance criteria validation
- **Phase 6**: Requirements compliance, SOLID principles, security
- **Phase 8**: Future work extraction, modernization detection

### Rejection Handling

```markdown
## VALIDATION REJECTED ❌

**Phase**: {PHASE_NAME}
**Corrections Required**:

1. {Specific issue found}
2. {Specific issue found}

**Action**: Re-executing {PHASE_NAME} with corrections...
```

Orchestrator re-invokes same phase prompt with validation feedback as additional context.

---

## 🔄 Git Workflow Integration

### Branch Strategy (Trunk-Based)

```bash
# Orchestrator creates feature branch
git checkout -b feature/TASK_CMD_003-add-dark-mode

# Developers commit incrementally
git commit -m "feat(TASK_CMD_003): add settings UI component"
git commit -m "feat(TASK_CMD_003): implement theme toggle logic"

# Orchestrator creates PR
gh pr create --title "feat(TASK_CMD_003): Add dark mode toggle"

# After review and merge
git branch -d feature/TASK_CMD_003-add-dark-mode
```

### Commit Message Convention

```
{type}({TASK_ID}): {description}

Types:
- feat: New feature
- fix: Bug fix
- refactor: Code restructuring
- test: Adding tests
- docs: Documentation
- chore: Maintenance
```

---

## 📋 Task Tracking Integration

### Registry Format

```markdown
| Task ID      | Description          | Status         | Owner        | Created    | Completed |
| ------------ | -------------------- | -------------- | ------------ | ---------- | --------- |
| TASK_CMD_003 | Add dark mode toggle | 🔄 In Progress | orchestrator | 2025-01-15 | -         |
```

**Status Icons**:

- 📋 Planned
- 🔄 In Progress
- ✅ Completed
- ❌ Failed
- ⏸️ Paused

### Task Folder Structure

```
task-tracking/
  TASK_CMD_003/
    context.md              # Original user request
    task-description.md     # Phase 1 output
    research-report.md      # Phase 2 output (if executed)
    implementation-plan.md  # Phase 3 output
    progress.md            # Phase 4 output
    test-report.md         # Phase 5 output
    code-review.md         # Phase 6 output
    future-enhancements.md # Phase 8 output
```

---

## 🎓 Migration from Old System

### Old Orchestration (Pseudocode)

```markdown
invoke project-manager with {TASK_ID}
if research_needed:
invoke researcher-expert with {TASK_ID}
invoke software-architect with {TASK_ID}

# etc.
```

**Problem**: VS Code doesn't support programmatic agent "calls".

### New Orchestration (Instruction-Based)

```markdown
**Execute Phase Prompt**: #file:./phase1-project-manager.prompt.md

**Context Variables**:

- TASK_ID: {from Phase 0}
- USER_REQUEST: {from Phase 0}

**Wait for**: Phase 1 completion signal

---

**Execute Validation**: #file:./validation-gate.prompt.md

**Context Variables**:

- PHASE_NAME: "Phase 1 - Requirements Analysis"
- AGENT_NAME: "project-manager"
- DELIVERABLE_PATH: "task-tracking/{TASK_ID}/task-description.md"
```

**Solution**: Natural language instructions guide AI through phase execution.

---

## 🚨 Critical Constraints (Enforced at Each Phase)

### Universal Requirements

1. **NO `any` types** - Use strict types or branded types
2. **NO backward compatibility** - Always use latest patterns
3. **Type/schema reuse** - Search existing before creating
4. **Timeline discipline** - Keep under 2 weeks or defer to future work
5. **Progress tracking** - Update progress.md every 30 min
6. **SOLID principles** - Services <200 lines, functions <30 lines
7. **Test coverage** - Minimum 80% line/branch/function
8. **Error boundaries** - Try-catch around all external calls

### Phase-Specific Requirements

**Phase 1**:

- SMART requirements
- BDD acceptance criteria format

**Phase 2**:

- Minimum 3-5 sources
- Comparative analysis with evidence

**Phase 3**:

- Type reuse documented
- SOLID compliance planned

**Phase 4**:

- Build must pass
- Zero loose types
- All changes committed

**Phase 5**:

- Coverage ≥80%
- All acceptance criteria tested

**Phase 6**:

- Zero critical issues
- Requirements 100% implemented

**Phase 8**:

- All future work extracted
- Dashboard updated

---

## 🎬 Next Steps

### For Users

1. **Invoke orchestrator**: `/orchestrate "your task description"`
2. **Monitor progress**: Watch phase completions in chat
3. **Review deliverables**: Check `task-tracking/{TASK_ID}/` folder
4. **Approve PR**: Review and merge the generated pull request

### For Developers (Extending System)

1. **Add new phase**: Create `phaseX-{agent}.prompt.md` following pattern
2. **Update orchestrator**: Add phase invocation to `orchestrate-v2.prompt.md`
3. **Create chatmode** (if new agent): Define in `.github/chatmodes/`
4. **Update validation**: Add checklist to `validation-gate.prompt.md`

### For Contributors

1. **Test phases individually**: Each prompt is independently testable
2. **Improve checklists**: Validation gates can always be more comprehensive
3. **Add examples**: Each phase can include more template examples
4. **Optimize workflow**: Identify bottlenecks and streamline

---

## 📚 Related Documentation

- **AGENTS.md**: Universal agent framework and task management protocols
- **copilot-instructions.md**: Ptah-specific coding conventions and architecture
- **CHATMODE_ORCHESTRATION_GUIDE.md**: Technical deep-dive on VS Code chat modes
- **ORCHESTRATION_SUMMARY.md**: Quick reference and TL;DR

---

**System Status**: ✅ Production Ready  
**Total Prompts**: 10 (1 orchestrator + 8 phases + 1 validation gate)  
**Test Coverage**: Manual testing recommended for each phase  
**Documentation**: Comprehensive inline templates in each phase prompt
