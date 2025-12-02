<div dir="rtl">
# 🎯 نقاط رئيسية للفيديو - Context Engineering Deep Dive

## 📌 Key Messages للجمهور

### 1. Context Engineering هو المستقبل

**بالعربي المصري:**

> "زمان كنا بنكتب [prompt] واحد ونستنى. دلوقتي لازم نبني نظام كامل من المعلومات - ده اسمه [Context Engineering]."

**النقطة التقنية:**

- [Prompt Engineering] = Single LLM Call
- [Context Engineering] = Multi-Agent System with Memory, Tools, and Validation

### 2. إزاي بنحل مشكلة الـ AI اللي بينسى

**المشكلة:**

```
اليوزر: "اكتب component بـ Angular"
AI: *يكتب*
اليوزر: "متنساش الـ standalone"
AI: *يعدل*
اليوزر: "والـ signals"
AI: *يعدل*
اليوزر: "والـ control flow الجديد"
... 😫
```

**الحل (من الـ chatmode):**

```markdown
# Frontend Developer Agent

## CORE PRINCIPLES

- Standalone components only - no NgModules
- Control flow: Use @if, @for, @switch
- Signals: Prefer input(), output(), viewChild()
- Change detection: OnPush required
```

**بالعربي:**

> "بدل ما نكرر نفس الكلام كل مرة، حطينا كل الـ [best practices] في ملف واحد. الـ [AI] بيقراه تلقائي!"

---

## 🎭 الـ Agent Personas - كل واحد ليه شخصيته

### Project Manager 🪃

**الشخصية:** المحلل الدقيق
**بيعمل إيه:**

- بيفهم طلب اليوزر
- بيحوله لـ [SMART Requirements]
- بيكتب [BDD Acceptance Criteria]

**مثال من الملف:**

```markdown
### SMART Requirements Quality

Each requirement MUST be:

- **Specific**: Exact feature with no ambiguity
- **Measurable**: Clear success criteria

- **Achievable**: Technically feasible
- **Relevant**: Ties to business objective
- **Time-bound**: Completion estimate provided
```

### Software Architect 🏗️

**الشخصية:** المهندس الباحث

**القاعدة الذهبية:**

> "Your superpower is INVESTIGATION, not ASSUMPTION."

**بالعربي:**

> "الـ [Architect] بتاعنا مش بيخترع. بيبحث الأول في الـ [codebase]، يشوف إيه موجود، ويبني عليه!"

**مثال:**

```markdown
# Before proposing ANY implementation:

1. Use Glob to find similar files
2. Read 2-3 examples
3. Extract patterns
4. Verify in library source
5. THEN propose architecture
```

### Team Leader 👥

**الشخصية:** المشرف الصارم
**القاعدة:**

> "Don't trust - VERIFY!"

**الـ 3 Modes:**

```
MODE 1: DECOMPOSITION → Creates tasks.md
MODE 2: ASSIGNMENT + VERIFICATION → Loop per task
MODE 3: COMPLETION → inal verification
```

**بالعربي:**

> "لما الـ [developer] يقول خلصت، الـ [Team Leader] مش بيصدقه! بيروح يتأكد بنفسه - بيشوف الـ [git commit] موجود؟ الملف اتعمل فعلاً؟"

---

## 🔄 الـ Workflow Visualization

### Flowchart للفيديو

```
┌─────────────────────────────────────────────────────────────┐
│                    /orchestrate "task"                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  🪃 Orchestrator: Analyze task type, create TASK_ID         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  📋 Project Manager: Create task-description.md             │
│     - SMART Requirements                                     │
│     - BDD Acceptance Criteria                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  ✋ USER VALIDATION: "APPROVED" or Feedback                  │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        [Research?]     [UI/UX?]       [Architecture]
              │               │               │
              ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────┐
│  🏗️ Software Architect: Create implementation-plan.md       │
│     - Evidence-based design                                  │
│     - No hallucinated APIs                                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  ✋ USER VALIDATION: "APPROVED" or Feedback                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  👥 Team Leader MODE 1: Decompose → tasks.md                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  🔄 LOOP: For each task                                      │
│     1. Team Leader: Assign to Developer                      │
│     2. Developer: Implement + Git Commit                     │
│     3. Team Leader: VERIFY (git + file + status)             │
│     4. If PASS → Next task                                   │
│     5. If FAIL → Escalate                                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  👥 Team Leader MODE 3: Final Verification                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  🎯 USER CHOICE: "tester" / "reviewer" / "both" / "skip"    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  🧪 QA Phase: Testing + Code Review                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  🎉 COMPLETE: All deliverables in task-tracking/TASK_ID/    │

└─────────────────────────────────────────────────────────────┘
```

---

## 💡 الـ Aha Moments للفيديو

### Moment 1: Anti-Hallucination

**العرض:**

```markdown
❌ AI might generate:
@Property({ primary: true }) // This doesn't exist!

✅ Our system requires:
// Investigation: Read entity.decorator.ts:145
@Neo4jEntity('User') // ✓ Verified at line 145
```

**بالعربي:**

> "الـ [AI] العادي ممكن يخترع [decorators] مش موجودة. نظامنا بيجبره يتحقق الأول!"

### Moment 2: Atomic Tasks

**العرض:**

```markdown
❌ WRONG:
Task: "Implement entire landing page"
Result: AI claims it's done but 3/7 sections missing

✅ CORRECT:

Task 1: "Create HeroSection component"
Task 2: "Create AboutSection component"
...
→ Each task verified separately!
```

**بالعربي:**

> "بدل ما نديله شغل كبير وهو يضيعنا، بنقسم لـ [tasks] صغيرة وبنتحقق من كل واحدة!"

### Moment 3: Evidence Citations

**العرض:**

```markdown
# Every decision has a source:

**Pattern Choice**: Use signal inputs
**Evidence**:

- Source: angular-best-practices.md:45-67
- Example: chat.component.ts:23 uses input<T>()
- Documentation: Angular 17+ recommends signals
```

**بالعربي:**

> "مش بس بيقول 'استخدم [signals]'... لا، بيقولك ليه وبيديك [reference]!"

---

## 📊 Statistics للفيديو

### أرقام من المشروع

- 📁 **12 chatmode files** - شخصيات مختلفة
- 📁 **13 prompt files** - مراحل مختلفة
- 🔄 **8+ phases** في الـ workflow الكامل
- ✅ **2 validation gates** - تحكم اليوزر
- 🔍 **3 verification modes** للـ Team Leader
- 📋 **35+ completed tasks** في الـ task-tracking

### فوائد النظام

| Metric            | Before          | After    |
| ----------------- | --------------- | -------- |
| Hallucinated APIs | كتير 😭         | Zero ✅  |
| Incomplete Tasks  | 40%+            | <5%      |
| Context Loss      | كل conversation | Never    |
| User Control      | Minimal         | Full     |
| Traceability      | None            | Complete |

---

## 🎬 Suggested B-Rll Scenes

1. **فتح VS Code** → Show chatmodes folder
2. **Scroll through chatmode file** → Highlight key sections
3. **Terminal showing git log** → Verification in action
4. **task-tracking folder** → All the generated documents
5. **Side-by-side comparison** → Without vs With Context Engineering
6. **Animation** → Agent icons passing tasks to each other

---

## 🗣️ Quotes للفيديو

### من الـ Research

> "Context engineering is the next phase, where you architect the full context, which in many cases requires going beyond simple prompting into more rigorous methods."
> — Prompt Engineering Guide

> "Building effective AI agents requires substantial tuning of system prompts and tool definitions. Don't underestimate the effort required."
> — Context Engineering Deep Dive

### من Andrej Karpathy

> "Prompt enginering is dead. Long live context engineering."

### من تجربتنا

> "The biggest mistake is trusting AI to self-report completion. Always verify."

---

## 📝 Script Notes

### افتتاحية قوية

ابدأ بسؤال: "مين فيكم جرب يشتغل على مشروع كبير مع AI وحس إنه بيتوه؟"

### وسط الفيديو

استخدم analogies كتير:

- "زي فريق عمل حقيقي"
- "زي مصنع فيه خط إنتاج"
- "زي موظف جديد محتاج onboarding"

### النهاية

ركز على الـ actionable takeaways - إيه اللي يقدروا يعملوه بكرة!

</div>
