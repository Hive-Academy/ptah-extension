# Phase 6: QA - Testing and Code Review (USER CHOICE)

**Agent**: senior-tester AND/OR code-reviewer  
**Purpose**: Validate implementation meets acceptance criteria and quality standards  
**User Choice**: tester | reviewer | both (parallel) | skip

---

## 🎯 USER QA CHOICE

After development completes, **user chooses QA strategy**:

1. **"tester"** - Run senior-tester only (testing focus)
2. **"reviewer"** - Run code-reviewer only (quality focus)
3. **"both"** - Run BOTH in parallel (comprehensive QA)
4. **"skip"** - Skip QA phase (go straight to completion)

---

## 📋 SENIOR TESTER MODE

#file:../.github/chatmodes/senior-tester.chatmode.md

### Deliverable: test-report.md

**Focus**:

- ✅ All acceptance criteria tested (traceability matrix)
- ✅ Coverage ≥80% (lines/branches/functions)
- ✅ Unit + integration tests
- ✅ Manual E2E scenarios documented
- ✅ Performance benchmarks (if applicable)

**Completion Signal**:

```markdown
## SENIOR TESTER COMPLETE ✅

**Test Summary**:

- Tests: {count} passed, {count} failed
- Coverage: Lines {X}%, Branches {X}%, Functions {X}%
- Acceptance Criteria: {count}/{count} validated

**Deliverable**: task-tracking/{TASK_ID}/test-report.md

**Recommendation**: {Ready for review | Requires fixes}
```

---

## 📋 CODE REVIEWER MODE

#file:../.github/chatmodes/code-reviewer.chatmode.md

### Deliverable: code-review.md

**Triple Review Protocol**:

1. **Code Quality Review**

   - SOLID principles compliance
   - Type safety (zero `any` types)
   - Code size limits (services <200 lines)
   - Error handling (boundaries around external calls)

2. **Logic Correctness Review**

   - Requirements compliance (all acceptance criteria)
   - Business logic correctness
   - Edge case handling
   - Error path coverage

3. **Security Review**
   - Input validation
   - Authentication/authorization (if applicable)
   - Injection vulnerabilities
   - Sensitive data handling

**Completion Signal**:

```markdown
## CODE REVIEWER COMPLETE ✅

**Review Status**: APPROVED ✅ | CONDITIONAL ⚠️ | REJECTED ❌

**Quality Assessment**:

- SOLID Compliance: {score}/10
- Type Safety: {score}/10
- Logic Correctness: {score}/10
- Security: {score}/10

**Issues Found**: {count} critical, {count} major, {count} minor

**Deliverable**: task-tracking/{TASK_ID}/code-review.md

**Recommendation**: {Approve | Fix issues first}
```

---

## 🔄 PARALLEL EXECUTION (Both Mode)

When user chooses **"both"**:

1. **Invoke senior-tester** - Test coverage and acceptance criteria
2. **Invoke code-reviewer** - Quality and security review
3. **Both run in parallel** - No blocking between them
4. **Collect both deliverables** - test-report.md + code-review.md

---

## 📤 PHASE 6 COMPLETION

After QA (or skip):

```markdown
## PHASE 6 COMPLETE ✅

**User QA Choice**: {tester | reviewer | both | skip}

[If tester ran]
**Testing**: ✅ Complete - {coverage}% coverage, {count} tests passed

[If reviewer ran]
**Review**: ✅ Complete - {status} with {count} issues

[If both ran]
**Testing**: ✅ {coverage}% coverage
**Review**: ✅ {status}

[If skip]
**QA Skipped**: User chose to skip QA phase

**Deliverables Created**:

- {test-report.md if tester}
- {code-review.md if reviewer}

Ready for Phase 8 (modernization-detector).
```

---

**User decides QA depth. Flexible quality assurance based on task criticality.**
