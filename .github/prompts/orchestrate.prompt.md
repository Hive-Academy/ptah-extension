---
mode: agent
description: Orchestrates complete development workflow with sequential agent phases
tools: ['edit', 'runNotebooks', 'search', 'new', 'runCommands', 'runTasks', 'usages', 'vscodeAPI', 'think', 'problems', 'changes', 'testFailure', 'openSimpleBrowser', 'fetch', 'githubRepo', 'extensions', 'GitKraken', 'Nx Mcp Server', 'sequential-thinking', 'angular-cli', 'nx-mcp', 'prisma-migrate-status', 'prisma-migrate-dev', 'prisma-migrate-reset', 'prisma-studio', 'prisma-platform-login', 'prisma-postgres-create-database']
model: Claude Sonnet 4.5 (Preview) (copilot)
---

# Orchestrate Development Workflow

Complete task execution with multi-phase agent workflow, validation gates, and trunk-based development.

## ⚠️ IMPORTANT: User-Driven Workflow

This orchestration requires **manual phase transitions**. After each phase completes, you'll receive a clear command to run next.

## Usage

In VS Code chat, type:

```
/orchestrate [task description]
```

**Examples**:

- `/orchestrate Week 4 Provider Core Infrastructure`
- `/orchestrate Fix memory leak in streaming handler`nt
  description: Orchestrates complete development workflow with sequential agent phases
  tools: ['edit', 'runNotebooks', 'search', 'new', 'runCommands', 'runTasks', 'usages', 'vscodeAPI', 'think', 'problems', 'changes', 'testFailure', 'openSimpleBrowser', 'fetch', 'githubRepo', 'extensions', 'GitKraken', 'Nx Mcp Server', 'sequential-thinking', 'angular-cli', 'nx-mcp']

---

# Orchestrate Development Workflow

Complete task execution with multi-phase agent workflow, validation gates, and trunk-based development.

## Usage

`/orchestrate [task description]` - Start new task
`/orchestrate TASK_ID` - Continue existing task  
`/orchestrate continue` - Resume last incomplete task

---

## 🎯 WORKFLOW OVERVIEW

This orchestration runs **8 sequential phases**, each with its own agent prompt and validation gate:

1. **Phase 0**: Task Initialization (Git + Registry)
2. **Phase 1**: Project Manager → Business Analyst
3. **Phase 2**: Researcher Expert → Business Analyst (if needed)
4. **Phase 3**: Software Architect → Business Analyst
5. **Phase 4**: Developer(s) → Business Analyst
6. **Phase 5**: Senior Tester → Business Analyst
7. **Phase 6**: Code Reviewer → Business Analyst
8. **Phase 7**: Task Completion (PR Creation)
9. **Phase 8**: Future Work Consolidation

---

## Phase 0: Task Initialization

### Extract User Request

```javascript
const args = '{arguments from /orchestrate command}';
const USER_REQUEST = args.replace(/^(TASK_\w+_\d+|continue)\s*/, '').trim() || 'Continue previous task';
```

### Git Setup & Task Creation

Execute these terminal commands:

```bash
# Check current git state
git branch --show-current
git status --short

# Commit any pending work
if [[ -n $(git status --short) ]]; then
    git add .
    git commit -m "chore: checkpoint before starting new task"
fi

# Generate Task ID
DOMAIN="CMD"  # Determine from request: CMD, INT, FE, BE, DOC, BUG
TASK_NUMBER=$(grep -c "^| TASK_${DOMAIN}_" task-tracking/registry.md | awk '{print $1+1}')
TASK_ID="TASK_${DOMAIN}_$(printf "%03d" $TASK_NUMBER)"

# Create feature branch
BRANCH_NAME="feature/${TASK_ID}-$(echo "$USER_REQUEST" | sed 's/[^a-zA-Z0-9]/-/g' | cut -c1-30)"
git checkout -b "$BRANCH_NAME"
git push -u origin "$BRANCH_NAME"

# Create task structure
mkdir -p "task-tracking/$TASK_ID"
echo "# Task Context - $TASK_ID" > "task-tracking/$TASK_ID/context.md"
echo "" >> "task-tracking/$TASK_ID/context.md"
echo "## Original User Request" >> "task-tracking/$TASK_ID/context.md"
echo "$USER_REQUEST" >> "task-tracking/$TASK_ID/context.md"

# Update registry
echo "| $TASK_ID | $USER_REQUEST | 🔄 In Progress | orchestrator | $(date '+%Y-%m-%d') | $(date '+%Y-%m-%d %H:%M:%S') |" >> task-tracking/registry.md

# Initial commit
git add .
git commit -m "feat($TASK_ID): initialize task - $USER_REQUEST"
git push origin "$BRANCH_NAME"

# Export for subsequent phases
export TASK_ID BRANCH_NAME USER_REQUEST
```

---

## ✅ PHASE 0 COMPLETE

**Task ID**: `{TASK_ID}`  
**Branch**: `{BRANCH_NAME}`  
**Folder**: `task-tracking/{TASK_ID}/` created  
**Registry**: Updated with 🔄 In Progress status

---

## 📋 NEXT STEP - Phase 1: Requirements Analysis

Copy and paste this command into the chat:

```
/phase1-project-manager TASK_ID={TASK_ID} USER_REQUEST="{USER_REQUEST}"
```

**What happens next**: The project manager will analyze requirements and create `task-description.md`

---

## 🔄 REMAINING PHASES

**Note**: The subsequent phases (1-8) are invoked individually through their respective prompt files. Each phase will provide the next command to run upon completion.

**Workflow Reference**:

1. ✅ Phase 0 complete (above)
2. → Phase 1: Requirements Analysis (run command shown above)
3. → Validation Gate
4. → Phase 2: Research (conditional) OR Phase 3: Architecture
5. → Phase 4: Development (Backend/Frontend)
6. → Phase 5: Testing
7. → Phase 6: Code Review
8. → Phase 7: PR Creation
9. → Phase 8: Future Work Consolidation

Each phase prompt will guide you to the next step.
