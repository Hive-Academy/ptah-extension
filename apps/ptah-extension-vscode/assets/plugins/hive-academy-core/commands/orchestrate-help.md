# Orchestrator Quick Reference

Quick help guide for the `/orchestrate` command workflow system.

## Command Usage

```bash
/orchestrate [argument]
```

### Arguments

- **Task Description**: Start new task (e.g., "implement user authentication")
- **TASK_ID**: Continue specific task (e.g., "TASK_CMD_009")
- **"continue"**: Resume last incomplete task from registry

## Workflow Phases

### 1. Pre-Flight (Automatic)

- Checks git status and branch
- Reviews task registry
- Creates/loads task folder

### 2. Project Manager

- Creates task-description.md
- Defines acceptance criteria (BDD format)
- Performs risk analysis
- Routes to next agent

**Quality Gate**: Validates all required sections present

### 3. Researcher (Conditional)

- Conducts technical research
- Evaluates approaches
- Creates research-report.md
- Provides recommendations

**Quality Gate**: Validates sources and analysis depth

### 4. Software Architect

- Creates implementation-plan.md
- Designs architecture
- **MUST** search project's shared types and components
- Breaks down into subtasks

**Quality Gate**: Validates SOLID principles and type search

### 5. Senior Developer

- Implements code
- **MUST** use existing types from project's shared libraries
- Zero 'any' types allowed
- Updates progress.md

**Quality Gate**: Validates compilation and type safety

### 6. Senior Tester

- Creates comprehensive tests
- Achieves >80% coverage
- Tests all acceptance criteria
- Includes edge cases

**Quality Gate**: Validates coverage and AC verification

### 7. Code Reviewer

- Final quality review
- Security validation
- Performance check
- Approval decision

**Quality Gate**: Final production readiness check

## Quality Standards

### Must Pass All Gates

- ✅ Type search protocol followed
- ✅ Zero 'any' types
- ✅ Functions < 30 lines
- ✅ Test coverage > 80%
- ✅ All ACs verified
- ✅ Security validated

## Common Commands

### Check Status

```bash
!cat task-tracking/registry.md | grep "🔄\|⚠️\|❌"
```

### View Task Progress

```bash
!cat task-tracking/TASK_CMD_009/progress.md
```

### Validate Specific Phase

```bash
/validate-project-manager TASK_CMD_009
/validate-architect TASK_CMD_009
/validate-developer TASK_CMD_009
/validate-tester TASK_CMD_009
/validate-reviewer TASK_CMD_009
```

## Troubleshooting

### If Validation Fails

1. Review the specific validation output
2. Make required corrections
3. Re-run the orchestrator from current phase

### Memory Issues

- Orchestrator runs sequentially (one agent at a time)
- No parallel Task() invocations
- Clear context between agents

### Common Issues

- **Missing task-description.md**: Project manager didn't complete
- **No type search**: Developer must document shared type discovery
- **Low coverage**: Tester needs more test cases
- **Build fails**: Developer must fix compilation errors

## Best Practices

1. **Always use orchestrator for agent tasks** - Don't invoke agents directly
2. **Let it run to completion** - Quality gates ensure standards
3. **Review validation output** - Understand what passed/failed
4. **Document in progress.md** - Track decisions and blockers
5. **Follow the workflow** - Don't skip phases

## Exit Criteria

Task is complete when:

- All phases passed
- Code reviewer approves
- Registry updated
- Completion report generated

## Need Help?

- Check validation output for specific issues
- Review the failed quality gate criteria
- Ensure all prerequisites are met
- Follow the type search protocol
