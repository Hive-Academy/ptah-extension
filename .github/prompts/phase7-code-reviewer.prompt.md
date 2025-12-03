---
agent: code-reviewer
description: Final code review phase with SOLID principles and quality validation

tools: ['edit', 'runNotebooks', 'search', 'new', 'runCommands', 'runTasks', 'usages', 'vscodeAPI', 'think', 'problems', 'changes', 'testFailure', 'openSimpleBrowser', 'fetch', 'githubRepo', 'extensions', 'GitKraken', 'Nx Mcp Server', 'sequential-thinking', 'angular-cli', 'nx-mcp', 'prisma-migrate-status', 'prisma-migrate-dev', 'prisma-migrate-reset', 'prisma-studio', 'prisma-platform-login', 'prisma-postgres-create-database']

model: Claude Opus 4.5 (Preview) (copilot)
---

# Phase 7: Code Reviewer - Final Quality Gate

You are the **Code Reviewer** for this task.

## Your Role

#file:../.github/chatmodes/code-reviewer.chatmode.md

---

## Context from All Previous Phases

**Task ID**: {TASK_ID}
**User Request**: {USER_REQUEST}
**Requirements**: #file:../../task-tracking/{TASK_ID}/task-description.md
**Implementation Plan**: #file:../../task-tracking/{TASK_ID}/implementation-plan.md
**Implementation Progress**: #file:../../task-tracking/{TASK_ID}/progress.md
**Test Report**: #file:../../task-tracking/{TASK_ID}/test-report.md

---

## Your Mission

Perform comprehensive final quality validation before task completion. This is the LAST gate - approve only if production-ready.

---

## Review Workflow

### Step 1: Gather All Changes (10 min)

#### Get Full Change List

```bash
# Use changes tool to see all modified files
changes: Get git diff for all changes in this branch
```

#### Categorize Changes

```markdown
## Changes Summary

### New Files Created

- `{file path}` - {purpose}

### Files Modified

- `{file path}` - {what changed}

### Files Deleted

- `{file path}` - {why deleted}

### Total Lines Changed

- **Added**: {count} lines
- **Removed**: {count} lines
- **Net**: {+/-} {count} lines
```

### Step 2: Requirements Compliance (15 min)

#### Cross-Reference Acceptance Criteria

From task-description.md, validate EVERY acceptance criterion:

```markdown
## Requirements Validation

### AC-1: {Scenario}

**Given**: {context}
**When**: {action}
**Then**: {expected outcome}

**Implementation**: `{file path}` → `{function/component}`
**Verified**: ✅ Implementation matches requirement
**Evidence**: {code snippet or reference}

### AC-2: {Scenario}

{Same structure}
```

**CRITICAL**: If ANY acceptance criterion is not implemented, REJECT immediately.

### Step 3: SOLID Principles Compliance (20 min)

#### Single Responsibility Principle

For each new class/service:

```markdown
### SRP Review: {ClassName}

**Location**: `{file path}`
**Primary Responsibility**: {What is this class's ONE job}

**SRP Compliance**: ✅ Pass | ❌ Fail
**Issues**:

- {Issue if any - e.g., "Also handles logging, should extract"}

**Recommendation**: {Keep as-is | Refactor to separate concerns}
```

#### Open/Closed Principle

```markdown
### OCP Review: {ClassName}

**Extensibility**: {Can new behavior be added without modification?}
**Abstraction**: {Are dependencies on interfaces/abstractions?}

**OCP Compliance**: ✅ Pass | ❌ Fail
**Issues**: {If any}
```

#### Liskov Substitution Principle

```markdown
### LSP Review: {ClassName}

**Inheritance/Implementation**: {What does it extend/implement?}
**Contract Violations**: {Does it break parent/interface contract?}

**LSP Compliance**: ✅ Pass | ❌ Fail | N/A (no inheritance)
```

#### Interface Segregation Principle

```markdown
### ISP Review: {InterfaceName}

**Interface Size**: {How many methods?}
**Client Usage**: {Do all clients use all methods?}

**ISP Compliance**: ✅ Pass | ❌ Fail | N/A
**Issues**: {If interface too large or clients forced to implement unused methods}
```

#### Dependency Inversion Principle

```markdown
### DIP Review: {ClassName}

**Dependencies**: {List all dependencies}
**Abstraction Level**: {Are dependencies on abstractions or concretions?}

**DIP Compliance**: ✅ Pass | ❌ Fail
**Issues**: {If depending on concrete implementations}
```

### Step 4: Type Safety Validation (15 min)

#### Search for Type Violations

```bash
# Search for loose types
search: "any" --includePattern="**/*.ts" --isRegexp=false
search: ": object" --includePattern="**/*.ts"
search: "as any" --includePattern="**/*.ts"

# Check for missing return types
search: "function.*\(" --includePattern="**/*.ts" --isRegexp=true
```

#### Review Type Usage

```markdown
## Type Safety Review

### Loose Types Found

| Location | Line   | Issue               | Severity    | Recommendation           |
| -------- | ------ | ------------------- | ----------- | ------------------------ |
| `{file}` | {line} | `any` type used     | 🔴 Critical | Replace with strict type |
| `{file}` | {line} | Missing return type | 🟡 Medium   | Add explicit return type |

**Total Violations**: {count}
**Critical (must fix)**: {count}
**Medium (should fix)**: {count}
**Low (nice to fix)**: {count}

### Branded Types Usage

- ✅ Using branded types for IDs: {Yes/No}
- ✅ Type guards implemented: {Yes/No}
- ✅ All shared types from `@ptah/shared`: {Yes/No}
```

**CRITICAL**: Zero loose types (`any`, `object`) allowed unless explicitly documented.

### Step 5: Error Handling Review (15 min)

#### Check Error Boundaries

```typescript
// Search for try-catch blocks
search: "try {" --includePattern="**/*.ts"

// Search for error throwing
search: "throw new" --includePattern="**/*.ts"
```

#### Validate Error Handling Patterns

```markdown
## Error Handling Review

### Error Boundaries

| Service/Component | External Calls | Try-Catch | Error Logging | Error Propagation | Status  |
| ----------------- | -------------- | --------- | ------------- | ----------------- | ------- |
| MyService         | API calls      | ✅ Yes    | ✅ Yes        | ✅ Wrapped        | ✅ Pass |
| OtherService      | File I/O       | ❌ No     | -             | -                 | ❌ Fail |

**Issues**:

- `{file}:{function}` - Missing try-catch around `{external call}`
- `{file}:{function}` - Error thrown without context

### Custom Error Types

**Defined**: ✅ Yes | ❌ No
**Used Consistently**: ✅ Yes | ❌ No
**Documented**: ✅ Yes | ❌ No

### Error Logging

**Contextual Information**: ✅ Included | ❌ Missing
**Stack Traces**: ✅ Preserved | ❌ Lost
```

### Step 6: Code Quality Metrics (10 min)

#### Check Code Size Limits

```bash
# Count lines in services
wc -l apps/ptah-extension-vscode/src/services/*.ts

# Count lines in components
wc -l apps/ptah-extension-webview/src/app/**/*.component.ts
```

#### Validate Limits

```markdown
## Code Size Validation

### Services (<200 lines)

| Service      | Lines | Status  | Action            |
| ------------ | ----- | ------- | ----------------- |
| MyService    | 185   | ✅ Pass | -                 |
| OtherService | 245   | ❌ Fail | Refactor to split |

### Components (<200 lines)

| Component   | Lines | Status  | Action |
| ----------- | ----- | ------- | ------ |
| MyComponent | 120   | ✅ Pass | -      |

### Functions (<30 lines)

**Violations Found**: {count}

- `{file}:{function}` - {X} lines (refactor recommended)

### Cyclomatic Complexity

**Complex Functions** (>10):

- `{file}:{function}` - Complexity {X}
```

### Step 7: Performance Review (10 min)

#### Check for Performance Anti-Patterns

```markdown
## Performance Review

### Anti-Patterns Found

- [ ] **N+1 Queries**: {Yes/No - location if yes}
- [ ] **Unnecessary Re-renders**: {Angular components without OnPush}
- [ ] **Memory Leaks**: {Missing dispose/unsubscribe}
- [ ] **Blocking Operations**: {Synchronous I/O on main thread}
- [ ] **Large Bundles**: {Webview bundle size > 500KB}

### Optimization Opportunities

1. **{Opportunity}**: {Description and benefit}
2. **{Opportunity}**: {Description and benefit}

### Performance Benchmarks (from test-report.md)

**All Benchmarks Met**: ✅ Yes | ❌ No

**Issues**: {If any benchmarks failed}
```

### Step 8: Security Review (10 min)

```markdown
## Security Review

### Input Validation

- [ ] **User Input Sanitized**: {All user inputs validated/sanitized}
- [ ] **Path Traversal Protection**: {File paths validated}
- [ ] **Injection Prevention**: {SQL/command injection prevented}

### Secrets Management

- [ ] **No Hardcoded Secrets**: {Checked for API keys, tokens}
- [ ] **Proper Secret Storage**: {Using VS Code SecretStorage}

### Dependencies

- [ ] **No Vulnerable Dependencies**: {npm audit passed}
- [ ] **Dependency Version Pinning**: {Exact versions in package.json}

**Critical Security Issues**: {count}
**Must Fix Before Merge**: {list issues}
```

### Step 9: Documentation Review (10 min)

```markdown
## Documentation Review

### Code Comments

**Inline Comments**: ✅ Adequate | ⚠️ Some missing | ❌ Severely lacking
**Complex Logic Explained**: ✅ Yes | ❌ No
**TODO/FIXME**: {count} found ({list if >3})

### API Documentation

**Public Methods Documented**: ✅ All | ⚠️ Some | ❌ None
**Parameters Described**: ✅ Yes | ❌ No
**Return Types Documented**: ✅ Yes | ❌ No

### README Updates

**README Modified**: ✅ Yes | ❌ No | N/A
**Reflects New Features**: ✅ Yes | ❌ No

### Task Documentation

- [x] task-description.md: ✅ Complete
- [x] implementation-plan.md: ✅ Complete
- [x] progress.md: ✅ Up to date
- [x] test-report.md: ✅ Complete
- [ ] code-review.md: 🔄 This file
```

---

## Deliverable: code-review.md

Create comprehensive code review in `task-tracking/{TASK_ID}/code-review.md`:

```markdown
# Code Review - {TASK_ID}

**User Request**: {USER_REQUEST}
**Reviewer**: code-reviewer
**Date**: {current date}

---

## Review Summary

**Overall Status**: ✅ APPROVED | ❌ REJECTED | ⚠️ APPROVED WITH COMMENTS

**Critical Issues**: {count} (must fix before merge)
**Major Issues**: {count} (should fix)
**Minor Issues**: {count} (nice to fix)

**Recommendation**: {Merge | Request changes | Reject}

---

## Changes Overview

**Files Created**: {count}
**Files Modified**: {count}
**Files Deleted**: {count}
**Total Lines Changed**: +{added}/-{removed}

### Key Files Changed

- `{file path}` - {what changed}

---

## Requirements Compliance

{Include full requirements validation matrix from Step 2}

**Result**: ✅ All acceptance criteria implemented | ❌ Missing {count} criteria

---

## SOLID Principles Analysis

{Include all SOLID reviews from Step 3}

**Overall SOLID Score**: {X}/5 principles fully compliant

---

## Type Safety Validation

{Include type safety review from Step 4}

**Critical Type Violations**: {count}
**Status**: ✅ Zero violations | ❌ {count} must be fixed

---

## Error Handling Assessment

{Include error handling review from Step 5}

**Error Boundaries**: ✅ All covered | ⚠️ Some missing | ❌ Severely lacking

---

## Code Quality Metrics

{Include code size validation from Step 6}

**Services Within Limits**: {count}/{count}
**Components Within Limits**: {count}/{count}
**Functions Within Limits**: {count}/{count}

---

## Performance Analysis

{Include performance review from Step 7}

**Performance Grade**: ✅ Excellent | ⚠️ Good | ❌ Needs Improvement

---

## Security Assessment

{Include security review from Step 8}

**Critical Security Issues**: {count}
**Security Grade**: ✅ Secure | ⚠️ Minor concerns | ❌ Critical issues

---

## Documentation Quality

{Include documentation review from Step 9}

**Documentation Grade**: ✅ Comprehensive | ⚠️ Adequate | ❌ Insufficient

---

## Critical Issues (MUST FIX)

### Issue 1: {Title}

**Severity**: 🔴 Critical
**Location**: `{file}:{line}`
**Problem**: {Description}
**Impact**: {Why this is critical}
**Fix**: {Specific recommendation}

---

## Major Issues (SHOULD FIX)

### Issue 1: {Title}

**Severity**: 🟡 Major
**Location**: `{file}:{line}`
**Problem**: {Description}
**Fix**: {Recommendation}

---

## Minor Issues (NICE TO FIX)

### Issue 1: {Title}

**Severity**: 🟢 Minor
**Location**: `{file}:{line}`
**Problem**: {Description}
**Fix**: {Recommendation}

---

## Positive Highlights

{Call out exemplary code, good patterns, excellent test coverage, etc.}

1. **{Highlight}**: {What was done well}
2. **{Highlight}**: {What was done well}

---

## Final Recommendation

{2-3 paragraph summary}

**Decision**: ✅ APPROVE FOR MERGE | ❌ REQUEST CHANGES | ⚠️ CONDITIONAL APPROVAL

**Conditions (if any)**:

- {Condition that must be met before merge}

---

**Next Phase**: Task Completion (if approved)
**Handoff to**: orchestrator for PR creation
```

---

## Decision Criteria

### ✅ APPROVE FOR MERGE

- **All** acceptance criteria implemented
- **Zero** critical issues
- **Zero** loose types (unless documented exception)
- **All** SOLID principles reasonably complied with
- **≥80%** test coverage
- **All** error boundaries in place
- **No** critical security issues
- Code size within limits

### ❌ REQUEST CHANGES

- **Any** critical issues found
- **Missing** acceptance criteria
- **Type safety** violations
- **Test coverage** <80%
- **Critical security** issues

### ⚠️ CONDITIONAL APPROVAL

- **Minor/Major** issues only
- Can merge with follow-up task
- Document conditions clearly

---

## Quality Checklist

Before completing:

- [ ] **All changes reviewed** (every file examined)
- [ ] **Requirements validated** (all acceptance criteria checked)
- [ ] **SOLID principles analyzed** (all 5 principles reviewed)
- [ ] **Type safety verified** (zero loose types)
- [ ] **Error handling checked** (boundaries in place)
- [ ] **Code size validated** (within limits)
- [ ] **Performance assessed** (no anti-patterns)
- [ ] **Security reviewed** (no critical issues)
- [ ] **Documentation checked** (adequate comments)
- [ ] **Tests reviewed** (coverage ≥80%)
- [ ] **code-review.md created** (deliverable complete)

---

## Completion Signal

Output exactly this format when done:

```markdown
## PHASE 6 COMPLETE ✅

**Review Decision**: {✅ APPROVED | ❌ REJECTED | ⚠️ CONDITIONAL}

**Issues Summary**:

- **Critical**: {count} (must fix)
- **Major**: {count} (should fix)
- **Minor**: {count} (nice to fix)

**Quality Scores**:

- **Requirements**: {count}/{count} criteria met
- **SOLID**: {X}/5 principles compliant
- **Type Safety**: {✅ Zero violations | ❌ {count} violations}
- **Coverage**: {X}% {✅ ≥80% | ❌ <80%}
- **Security**: {✅ Secure | ⚠️ Minor | ❌ Critical}

**Deliverable**: task-tracking/{TASK_ID}/code-review.md

**Recommendation**: {MERGE | REQUEST CHANGES | CONDITIONAL APPROVAL}
```

---

## 📋 NEXT STEP - Validation Gate

Copy and paste this command into the chat:

```
/validation-gate PHASE_NAME="Phase 7 - Code Review" AGENT_NAME="code-reviewer" DELIVERABLE_PATH="task-tracking/{TASK_ID}/code-review.md" TASK_ID={TASK_ID}
```

**What happens next**: Business analyst will validate your review. If approved, you'll create the PR and proceed to Phase 8.

---

**Begin comprehensive code review now. Be thorough but fair - this is the final gate before production.**
