---
description: Dual-reviewer code review with code-style-reviewer and code-logic-reviewer
---

# Phase 9: Code Review - Dual Reviewer Edition

> **Agent Coordination**: Invoke **code-style-reviewer** + **code-logic-reviewer** in sequence, then synthesize findings

---

## 🎯 DUAL-REVIEWER APPROACH

**Why Two Reviewers?**

- **Style**: Pattern compliance, maintainability, technical debt
- **Logic**: Business logic correctness, failure modes, edge cases
- **Result**: Comprehensive adversarial analysis

---

## 📋 EXECUTION STEPS

### Step 1: Read Task Context

```bash
Read(task-tracking/{TASK_ID}/context.md)
Read(task-tracking/{TASK_ID}/implementation-plan.md)
Read(task-tracking/{TASK_ID}/tasks.md)
```

Extract: requirements, file list, expected behavior

---

### Step 2: Invoke Code Style Reviewer

**Prompt Template**:

```
Review TASK_{TASK_ID} for code style, patterns, and maintainability.

See .claude/agents/code-style-reviewer.md for full mandate.

CRITICAL:
- Find ≥3 issues (even for excellent code)
- Answer 5 critical questions explicitly
- Use realistic scoring (5-6/10 acceptable)
- Provide file:line citations

THE 5 CRITICAL QUESTIONS:
1. What could break in 6 months?
2. What would confuse a new team member?
3. What's the hidden complexity cost?
4. What pattern inconsistencies exist?
5. What would I do differently?

OUTPUT FORMAT:
# Code Style Review - TASK_{TASK_ID}
## Review Summary
| Metric | Value |
|--------|-------|
| Overall Score | X/10 |
| Assessment | APPROVED/NEEDS_REVISION/REJECTED |
| Blocking Issues | X |
| Serious Issues | X |
| Minor Issues | X |

## The 5 Critical Questions
[Answer each with file:line references]

## Blocking Issues
### Issue 1: [Title]
- File: [path:line]
- Problem: [Description]
- Impact: [What breaks]
- Fix: [Solution]

## Serious Issues
[Same format]

## Technical Debt Assessment
Introduced: [New debt]
Net Impact: [Direction]

## Verdict
Recommendation: [APPROVE/REVISE/REJECT]
Key Concern: [Biggest issue]
```

---

### Step 3: Invoke Code Logic Reviewer

**Prompt Template**:

```
Review TASK_{TASK_ID} for business logic correctness and failure modes.

See .claude/agents/code-logic-reviewer.md for full mandate.

CRITICAL:
- Find ≥3 failure modes
- Answer 5 paranoid questions explicitly
- Trace complete data flows
- Question requirements themselves

THE 5 PARANOID QUESTIONS:
1. How does this fail silently?
2. What user action causes unexpected behavior?
3. What data makes this produce wrong results?
4. What happens when dependencies fail?
5. What's missing that requirements didn't mention?

OUTPUT FORMAT:
# Code Logic Review - TASK_{TASK_ID}
## Review Summary
| Metric | Value |
|--------|-------|
| Overall Score | X/10 |
| Assessment | APPROVED/NEEDS_REVISION/REJECTED |
| Critical Issues | X |
| Serious Issues | X |
| Failure Modes Found | X |

## The 5 Paranoid Questions
[Answer each with scenarios]

## Failure Mode Analysis
### Failure Mode 1: [Name]
- Trigger: [What causes this]
- Impact: [Severity]
- Current Handling: [How code handles]
- Recommendation: [Fix]

[≥3 failure modes required]

## Critical Issues
[Same format as style review]

## Edge Case Analysis
| Edge Case | Handled | Concern |
|-----------|---------|---------|
| Null input | YES/NO | [Issues] |
| Rapid clicks | YES/NO | [Issues] |

## Verdict
Recommendation: [APPROVE/REVISE/REJECT]
Top Risk: [Biggest concern]
```

---

### Step 4: Synthesize Findings

```markdown
# Combine issues by severity

Blocking = StyleReview.Blocking + LogicReview.Critical
Serious = StyleReview.Serious + LogicReview.Serious
Minor = StyleReview.Minor + LogicReview.Moderate

# Determine verdict

IF Blocking > 0: "❌ CHANGES REQUIRED"
ELSE IF Serious ≥ 3: "⚠️ APPROVED WITH RECOMMENDATIONS"
ELSE: "✅ APPROVED"
```

---

### Step 5: Create code-review.md

```markdown
# Code Review - {TASK_ID}

**Reviewers**: code-style-reviewer + code-logic-reviewer
**Status**: {VERDICT}

## Executive Summary

| Category        | Count |
| --------------- | ----- |
| Blocking Issues | X     |
| Serious Issues  | X     |
| Minor Issues    | X     |
| Failure Modes   | X     |

**Key Strengths**: [Top 3 positives]
**Key Concerns**: [Top 3 issues]

---

## The 10 Critical Questions

### Style Questions (Maintainability)

1. **6-month breakage**: {Answer}
2. **New member confusion**: {Answer}
3. **Hidden complexity**: {Answer}
4. **Pattern inconsistencies**: {Answer}
5. **Alternative approaches**: {Answer}

### Logic Questions (Correctness)

1. **Silent failures**: {Answer}
2. **Unexpected behavior**: {Answer}
3. **Wrong results**: {Answer}
4. **Dependency failures**: {Answer}
5. **Missing requirements**: {Answer}

---

## Issues & Recommendations

### Blocking Issues

[Combined from both reviews]

**Issue 1**: {Title}

- File: {path:line}
- Category: {Style|Logic}
- Problem: {Description}
- Fix: {Solution}

### Serious Issues

[Same format]

### Minor Issues

[Brief list]

---

## Failure Mode Analysis

{LogicReview.FailureModes}

---

## Pattern Compliance

| Pattern | Status   | Style Concern | Logic Concern |
| ------- | -------- | ------------- | ------------- |
| Signals | ✅/⚠️/❌ | {Concern}     | {Concern}     |
| Types   | ✅/⚠️/❌ | {Concern}     | {Concern}     |
| Errors  | ✅/⚠️/❌ | {Concern}     | {Concern}     |

---

## Technical Debt

Introduced: {List}
Net Impact: {POSITIVE|NEUTRAL|NEGATIVE}

---

## Overall Verdict

**Recommendation**: {APPROVE|APPROVE WITH RECOMMENDATIONS|CHANGES REQUIRED}
**Confidence**: {HIGH|MEDIUM|LOW}
**Conditions**: [If any blocking issues]

---

**Signatures**: code-style-reviewer + code-logic-reviewer
**Date**: {DATE}
```

---

## ✅ COMPLETION

Present to user:

```
✅ Phase 9 Complete: Dual Code Review

Deliverable: code-review.md
Files Reviewed: {N}
Issues: {X} blocking, {Y} serious, {Z} minor
Verdict: {FINAL_VERDICT}

Next: /phase-10-modernization {TASK_ID}
```

---

## 💡 KEY POINTS

1. **Two reviewers** = Comprehensive coverage
2. **10 questions** = Adversarial analysis
3. **File:line citations** = Actionable feedback
4. **Honest scoring** = Realistic expectations
5. **Combined verdict** = Clear decision

**Goal**: Find problems before production, not approve code.
