<div dir="rtl">
# 📹 سكريبت فيديو: Context Engineering و الـ Multi-Agent Workflow

## عنوان الفيديو

**"إزاي تبني نظام AI Development متكامل: قصة Ptah Extension و فن الـ Context Engineering"**

---

## ⏱️ تقسيم الفيديو

### المقدمة (0:00 - 3:00)

---

**[Hook - أول 60 ثانية]**

أهلاً بيكم يا جماعة! 👋

لو انت شغال بالـ [GitHub Copilot] وماتعرفش لسه عن الـ [Chat Modes] أو الـ [Sub-Agents]... خليني أقولك إنك بتفوت على نفسك حاجة كبيرة جداً!

الـ [Chat Modes] دي عبارة عن **شخصيات متخصصة** تقدر تعملها للـ [AI] - يعني بدل ما يكون [Copilot] واحد بيعمل كل حاجة، تقدر يكون عندك:

- 🏗️ [Architect Mode] متخصص في التصميم
- 💻 [Developer Mode] متخصص في الكود
- 🧪 [Tester Mode] متخصص في الـ [testing]
- 🔍 [Reviewer Mode] متخصص في الـ [code review]

والـ [Sub-Agents]؟ دول [agents] صغيرة الـ [main agent] بيستدعيها عشان تعمله مهام معينة وترجعله النتيجة!

**طيب إزاي نستفيد من الكلام ده في المشاريع الكبيرة؟** 🤔

هنا بيجي دور الـ **[Context Engineering]** مع الـ **[Prompt Files]**!

لما تدمج الـ [Chat Modes] مع [Prompt Files] مكتوبة صح، بتقدر تبني **[Workflow] متكامل** - كل [agent] يعرف:

- هو مين وإيه دوره
- إيه القواعد اللي يمشي عليها
- إيه الـ [tools] اللي يستخدمها
- مين بيسلمله الشغل ومين بيسلم له

وده بالظبط اللي بنيناه في مشروع **Ptah Extension** - نظام [Multi-Agent Workflow] كامل بيحول طلب بسيط لـ [production-ready code]!

النهاردة هنتكلم عن **[Context Engineering]** - وهي الفرق بين [AI Agent] بيتوه في الشغل، و [AI Agent] بيعرف بالظبط هو بيعمل إيه وليه!

---

**[المشكلة - 30 ثانية]**

خلينا نكون صرحاء...

لو جربت تشتغل على مشروع كبير مع [AI] زي [ChatGPT] أو [Claude]، هتلاقي نفسك بتكرر نفس الكلام كل مرة:

- "متنساش إنك تستخدم [TypeScript]!"
- "متنساش الـ [SOLID Principles]!"
- "اكتب [tests] كمان!"

والـ [AI] بينسى! لأن مفيش [context] محفوظ.

---

### الجزء الأول: ما هو الـ Context Engineering؟ (2:00 - 6:00)

---

**[تعريف الـ Context Engineering]**

طيب يعني إيه [Context Engineering]؟

بص... الـ [Prompt Engineering] كان الطريقة القديمة - إنك تكتب [prompt] حلو و تدي للـ [AI].

لكن الـ [Context Engineering] أعمق من كده بكتير!

الـ [Context Engineering] هو **فن تصميم كل المعلومات اللي الـ [AI] محتاجها عشان يعمل شغله صح**.

دي بتشمل:

1. **[System Prompts]** - الشخصية والقواعد الأساسية
2. **[Task Constraints]** - حدود الشغل
3. **[Tool Descriptions]** - الأدوات المتاحة وإزاي يستخدمها
4. **[Memory Management]** - إزاي يفتكر الحاجات المهمة
5. **[Structured Inputs/Outputs]** - شكل البيانات الداخلة والخارجة

---

**[ليه مهم؟]**

تخيل إنك بتوظف موظف جديد...

لو قلتله "اشتغل" ومشيت - هيتوه!

لكن لو:

- عرفته على الفريق ✅
- شرحتله الـ [workflow] ✅
- ديتله [documentation] ✅
- وضحتله المعايير ✅

هيشتغل صح من أول يوم!

نفس الحكاية مع الـ [AI Agents]!

---

**[الفرق بين Prompt Engineering و Context Engineering]**

| Prompt Engineering    | Context Engineering       |
| --------------------- | ------------------------- |
| [prompt] واحد بسيط    | نظام متكامل من المعلومات  |
| للـ [single LLM call] | للـ [multi-agent systems] |
| مفيش [memory]         | [memory management] كامل  |
| مفيش [tools]          | [tool definitions] واضحة  |
| مفيش [validation]     | [quality gates] محددة     |

---

### الجزء الثاني: نظام Ptah Extension - الـ Workflow الكامل (6:00 - 15:00)

---

**[Overview - خريطة النظام]**

دلوقتي خلينا ندخل في التفاصيل...

في مشروع Ptah Extension، بنينا نظام [multi-agent workflow] متكامل بيحول طلب بسيط زي:

> "عايز feature جديدة للـ chat"

لـ [production-ready code] كامل!

---

**[الـ Agents اللي عندنا]**

عندنا فريق كامل من الـ [AI Agents]:

🪃 **[Workflow Orchestrator]** - المدير العام

- بينسق بين كل الـ [agents]
- بيتابع التقدم
- بيقرر مين يشتغل إمتى

🔍 **[Project Manager / Business Analyst]** - محلل المتطلبات

- بياخد طلب اليوزر
- بيحوله لـ [requirements] واضحة
- بيكتب [acceptance criteria] بصيغة [BDD]

🔎 **[Researcher Expert]** - الباحث

- لو فيه تكنولوجيا جديدة
- بيعمل [research] ويقدم توصيات
- بيجمع [best practices]

🎨 **[UI/UX Designer]** - المصمم

- لو الـ [task] فيها [UI]
- بيصمم الـ [visual specifications]
- بيحضر الـ [assets]

🏗️ **[Software Architect]** - المهندس المعماري

- بيصمم الـ [architecture]
- بيختار الـ [patterns] المناسبة
- بيكتب [implementation plan] مفصل
- **مهم جداً**: بيستخدم [Evidence-Based Design] - مش بيخترع، بيبني على اللي موجود!

👥 **[Team Leader]** - قائد الفريق

- بياخد الـ [implementation plan]
- بيقسمه لـ [atomic tasks]
- بيوزع على الـ [developers]
- بيتحقق من إتمام كل [task]

💻 **[Backend Developer]** و 🎨 **[Frontend Developer]** - المطورين

- بينفذوا الـ [tasks] الموكلة ليهم
- بيعملوا [git commits]
- بيبدأوا من الـ [codebase] الموجود

🧪 **[Senior Tester]** و 🔍 **[Code Reviewer]** - فريق الجودة

- [testing]
- [code review]
- [quality gates]

---

**[الـ Workflow - Step by Step]**

خلينا نشوف الـ [workflow] كامل:

```
Step 1: /orchestrate "Add notification feature"
         ↓
Step 2: Orchestrator → Generates TASK_ID → Creates context.md
         ↓
Step 3: Project Manager → Creates task-description.md
         ↓
Step 4: USER VALIDATION ✋ ← "APPROVED" أو Feedback
         ↓
Step 5: (Optional) Researcher → research-report.md
         ↓
Step 6: (Optional) UI/UX Designer → visual-design-specification.md
         ↓
Step 7: Software Architect → implementation-plan.md
         ↓
Step 8: USER VALIDATION ✋ ← "APPROVED" أو Feedback
         ↓
Step 9: Team Leader MODE 1 → tasks.md (task breakdown)
         ↓
Step 10: Team Leader MODE 2 → Assign Task 1 to Developer
         ↓
Step 11: Developer → Implements → Git Commit
         ↓
Step 12: Team Leader MODE 2 → Verify → Assign Task 2
         ↓
Step 13: (LOOP until all tasks done)
         ↓
Step 14: Team Leader MODE 3 → Final Verification
         ↓
Step 15: USER CHOICE ← "tester" / "reviewer" / "both" / "skip"
         ↓
Step 16: QA Phase → test-report.md / code-review.md
         ↓
Step 17: Modernization Detector → future-enhancements.md
         ↓
🎉 COMPLETE
```

---

### الجزء الثالث: كيف طبقنا Context Engineering؟ (15:00 - 25:00)

---

**[Chatmodes - الشخصيات]**

أول حاجة: الـ **[Chatmodes]**!

كل [agent] عنده ملف `.chatmode.md` بيحدد:

1. **الهوية**: "انت مين؟"
2. **المسؤوليات**: "بتعمل إيه بالظبط؟"
3. **الأدوات**: "إيه اللي تقدر تستخدمه؟"
4. **القواعد الصارمة**: "إيه اللي ممنوع؟"

مثال من الـ [Software Architect]:

```markdown
# Software Architect Agent - Intelligence-Driven Edition

You are an elite Software Architect with mastery of design patterns...

## 🧠 CORE INTELLIGENCE PRINCIPLE

**Your superpower is INVESTIGATION, not ASSUMPTION.**

Before proposing any architecture, you systematically explore
the codebase to understand:

- What patterns already exist?
- What libraries are available?
- What conventions are established?
```

شايفين؟ مش بس بنقوله "انت architect"... لا، بنقوله بالظبط إزاي يشتغل!

---

**[Anti-Hallucination Protocol]**

من أهم الحاجات في الـ [context] بتاعنا: **منع الـ [Hallucination]**!

```markdown
### 🔴 ANTI-HALLUCINATION PROTOCOL

❌ WRONG: Assumed pattern
import { Label, Property } from '@hive-academy/nestjs-neo4j';

@Label('StoreItem') // ← NOT VERIFIED
export class StoreItemEntity {}

✅ CORRECT: Verified pattern
// Investigation: Read entity.decorator.ts:145-286
import { Neo4jEntity, Neo4jProp } from '@hive-academy/nestjs-neo4j';

@Neo4jEntity('StoreItem') // ✓ Verified
export class StoreItemEntity {}
```

كل حاجة الـ [AI] بيقترحها لازم تكون:

- موجودة في الـ [codebase]
- متحقق منها من الـ [source]
- مع [citation] للملف والسطر!

---

**[Prompts - المراحل]**

تاني حاجة: الـ **[Prompts]**!

كل مرحلة ليها [prompt file] خاص:

- `phase1-project-manager.prompt.md`
- `phase2-researcher-expert.prompt.md`
- `phase3-ui-ux-designer.prompt.md`
- `phase4-software-architect.prompt.md`
- `phase5a-team-leader-mode1.prompt.md`
- ... وهكذا

كل [prompt] بيحتوي على:

1. **[Context Variables]**: الـ `TASK_ID`, `USER_REQUEST`, etc.
2. **[Step-by-Step Instructions]**: إيه يعمله بالظبط
3. **[Expected Deliverables]**: إيه الملفات اللي لازم ينتجها
4. **[Quality Gates]**: إزاي نتحقق من الجودة
5. **[Handoff Protocol]**: إزاي يسلم للمرحلة اللي بعده

---

**[Evidence-Based Architecture]**

حاجة مهمة جداً في الـ [architect agent]:

**كل قرار لازم يكون مبني على [evidence]!**

```markdown
**Decision**: Use @Neo4jEntity decorator
**Evidence**:

- Definition: libs/nestjs-neo4j/src/lib/decorators/entity.decorator.ts:145
- Pattern: apps/dev-brand-api/src/app/entities/neo4j/achievement.entity.ts:24
- Examples: 8 entity files follow this pattern

**Decision**: Extend Neo4jBaseEntity
**Evidence**:

- Definition: libs/nestjs-neo4j/src/lib/entities/neo4j-base.entity.ts:12
- Usage: All 8 examined entity files extend this class
```

ده بيضمن إن الـ [AI] مش بيخترع حاجات من دماغه!

---

**[Team Leader - Three Modes]**

الـ [Team Leader] عنده 3 modes:

**MODE 1: DECOMPOSITION**

- بياخد الـ [implementation plan]
- بيقسمه لـ [atomic tasks]
- بينشئ `tasks.md`

**MODE 2: ASSIGNMENT + VERIFICATION**

- بيوزع [task] على [developer]
- بيستنى يخلص
- بيتحقق من الـ [git commit]
- بيتحقق إن الملف موجود فعلاً!

**MODE 3: COMPLETION**

- كل الـ [tasks] خلصت
- [final verification]
- تسليم للـ [QA phase]

---

**[Verification - مش بنصدق حد!]**

من أهم المبادئ في النظام:

**"Trust but Verify"** ❌  
**"Don't Trust - VERIFY"** ✅

```markdown
Team-Leader Verification:

1. git log --oneline -1 → Verify commit exists
2. Read(apps/.../hero-section.component.ts) → Verify file exists
3. Read(tasks.md) → Verify status updated

❌ Developer says: "I completed all 7 sections"
❌ Team-Leader: "Great! Marking all complete" ← WRONG!

✅ Developer says: "I completed Task 1: Hero Section"
✅ Team-Leader: _actually verifies_ → ✅ VERIFIED
```

---

**[Validation Gates - نقاط التحقق]**

عندنا نقطتين مهمين بنوقف فيهم ونسأل اليوزر:

1. **بعد الـ [Project Manager]**:

   - بنعرض الـ [requirements]
   - اليوزر يقول "APPROVED" أو يديك [feedback]

2. **بعد الـ [Software Architect]**:
   - بنعرض الـ [implementation plan]
   - اليوزر يوافق أو يطلب تعديلات

ده بيضمن إن اليوزر عنده [control] على الشغل!

---

### الجزء الرابع: نتايج و Best Practices (25:00 - 30:00)

---

**[النتايج اللي حققناها]**

بالنظام ده حققنا:

✅ **[Consistency]**: كل [task] بتتعمل بنفس الطريقة
✅ **[Traceability]**: كل خطوة موثقة في ملفات
✅ **[Quality]**: [validation gates] و [verification]
✅ **[Scalability]**: تقدر تضيف [agents] جديدة بسهولة
✅ **[Anti-Hallucination]**: الـ [AI] مش بيخترع
✅ **[User Control]**: اليوزر يوافق على الخطوات المهمة

---

**[Best Practices من تجربتنا]**

1. **كل [agent] ليه مسؤولية واحدة**

   - [Single Responsibility Principle]
   - الـ [orchestrator] مش بيكود
   - الـ [developer] مش بيصمم

2. **الـ [context] لازم يكون [explicit]**

   - متقولش "اعمل كود حلو"
   - قول بالظبط إيه المعايير

3. **الـ [verification] مش اختياري**

   - كل [task] لازم تتحقق
   - مفيش "ثقة" - فيه "تحقق"

4. **الـ [handoff] لازم يكون واضح**

   - كل [agent] يعرف مين بعده
   - كل [agent] يعرف إيه يسلمه

5. **الـ [evidence] قبل الـ [implementation]**
   - الـ [architect] يبحث الأول
   - يشوف إيه موجود في الـ [codebase]
   - بعدين يصمم

---

**[Anti-Patterns - اللي لازم نتجنبه]**

❌ **[Over-Engineering]**

```markdown
BAD: "Let's make this generic for future use"
GOOD: Solve today's problem simply
```

❌ **[Vague Instructions]**

```markdown
BAD: "Perform research on the topic"
GOOD: "Perform research by:

1. Breaking down query into 3-5 subtasks
2. Executing web search for EACH subtask
3. Documenting findings"
```

❌ **[Ignoring Error Cases]**

```markdown
BAD: No error handling instructions
GOOD: "If search fails, retry once. If retry fails, document failure."
```

❌ **[Backward Compatibility Trap]**

```markdown
BAD: "Create ComponentV2 alongside ComponentV1"
GOOD: "Replace existing implementation directly"
```

---

### الخاتمة (30:00 - 32:00)

---

**[Recap - ملخص]**

يبقى اتكلمنا النهاردة عن:

1. **[Context Engineering]** - فن تصميم المعلومات للـ [AI]
2. **[Multi-Agent Workflow]** - فريق متكامل من الـ [AI Agents]
3. **[Chatmodes]** - تعريف شخصية كل [agent]
4. **[Prompts]** - تعليمات كل مرحلة
5. **[Verification]** - التحقق من كل حاجة
6. **[Validation Gates]** - نقاط تحكم اليوزر

---

**[Call to Action]**

لو عايز تبني نظام زي ده:

1. **ابدأ بسيط**: [agent] واحد الأول
2. **اكتب [context] واضح**: إيه بالظبط المتوقع
3. **ضيف [verification]**: متصدقش - اتحقق!
4. **كرر وحسن**: [iterate based on behavior]

---

**[النهاية]**

شكراً لمتابعتكم! 🙏

لو الفيديو عجبكم، متنسوش:

- 👍 Like
- 🔔 Subscribe
- 💬 Comment - قولولي إيه رأيكم!

والمشروع موجود على [GitHub] لو حد عايز يشوف الكود!

سلام! ✌️

---

## 📚 مراجع ومصادر

1. [Context Engineering Guide](https://www.promptingguide.ai/guides/context-engineering-guide)
2. [Context Engineering for AI Agents](https://www.promptingguide.ai/agents/context-engineering)
3. [Context Engineering Deep Dive](https://www.promptingguide.ai/agents/context-engineering-deep-dive)
4. Andrej Karpathy on Context Engineering
5. Tobi Lutke on Context Engineering
6. [LangChain: The Rise of Context Engineering](https://blog.langchain.com/the-rise-of-context-engineering/)

---

## 🎬 ملاحظات للإنتاج

### Visual Elements المطلوبة

1. **Diagram للـ Workflow**: رسم بياني يوضح تسلسل الـ agents
2. **Screenshots من الكود**: أجزاء من الـ chatmodes و prompts
3. **Animation للـ verification process**: يوضح الخطوات
4. **Before/After comparison**: بدون context engineering vs معاه

### Sound Effects

- ✅ صوت للـ checkmarks عند الـ verification
- 🎵 Background music هادية
- 🔔 صوت notification عند الـ user validation

### B-Roll Ideas

- Team meetings (representing multi-agent collaboration)
- Code editing في VS Code
- Terminal commands running
- Architecture diagrams

---

## 📝 ملاحظات إضافية

### نقاط للتركيز في الفيديو

1. **الـ Context Engineering مش Prompt Engineering بس** - ده أشمل
2. **الـ Multi-Agent Workflow بيحل مشاكل الـ Single Agent**
3. **الـ Verification ضروري لمنع الـ Hallucination**
4. **الـ User Validation بيدي Control للمستخدم**
5. **الـ Evidence-Based Design بيضمن جودة الـ Architecture**

### أسئلة متوقعة من الجمهور

1. "إزاي أبدأ أبني نظام زي ده؟"
2. "إيه الـ LLM اللي بتستخدموه؟"
3. "كام يوم احتجتوا تبنوا النظام ده؟"
4. "ممكن أستخدمه مع لغات تانية غير TypeScript؟"
5. "إيه الفرق بين ده و GitHub Copilot العادي؟"

</div>
