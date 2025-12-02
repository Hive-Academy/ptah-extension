# 📹 Video Script: Context Engineering & Multi-Agent Workflow

## Video Title

**"How to Build a Complete AI Development System: The Ptah Extension Story & The Art of Context Engineering"**

---

## ⏱️ Video Structure

### Introduction (0:00 - 2:00)

---

**[Hook - First 30 seconds]**

Hey everyone! 👋

Imagine having an AI Agent that writes code for you... but not just that - a complete team of AI Agents talking to each other, reviewing each other's work, and handing off tasks just like a real development team!

This isn't a dream... this is what we built in the Ptah Extension project.

Today we're going to talk about something crucial in the world of AI Development called **Context Engineering** - it's the difference between an AI Agent that gets lost in the work, and an AI Agent that knows exactly what it's doing and why!

---

**[The Problem - 30 seconds]**

Let's be honest...

If you've ever tried working on a large project with AI like ChatGPT or Claude, you'll find yourself repeating the same things every time:

- "Don't forget to use TypeScript!"
- "Don't forget the SOLID Principles!"
- "Write tests too!"

And the AI forgets! Because there's no persistent context.

---

### Part One: What is Context Engineering? (2:00 - 6:00)

---

**[Defining Context Engineering]**

So what exactly is Context Engineering?

Look... Prompt Engineering was the old way - writing a nice prompt and giving it to the AI.

But Context Engineering is much deeper than that!

Context Engineering is **the art of designing all the information that the AI needs to do its job correctly**.

This includes:

1. **System Prompts** - Personality and basic rules
2. **Task Constraints** - Work boundaries
3. **Tool Descriptions** - Available tools and how to use them
4. **Memory Management** - How to remember important things
5. **Structured Inputs/Outputs** - Data format going in and out

---

**[Why is it Important?]**

Imagine you're hiring a new employee...

If you tell them "work" and walk away - they'll get lost!

But if you:

- Introduce them to the team ✅
- Explain the workflow ✅
- Give them documentation ✅
- Clarify the standards ✅

They'll work correctly from day one!

Same story with AI Agents!

---

**[The Difference Between Prompt Engineering and Context Engineering]**

| Prompt Engineering  | Context Engineering         |
| ------------------- | --------------------------- |
| One simple prompt   | Complete information system |
| For single LLM call | For multi-agent systems     |
| No memory           | Full memory management      |
| No tools            | Clear tool definitions      |
| No validation       | Defined quality gates       |

---

### Part Two: The Ptah Extension System - Complete Workflow (6:00 - 15:00)

---

**[Overview - System Map]**

Now let's get into the details...

In the Ptah Extension project, we built a complete multi-agent workflow that transforms a simple request like:

> "I want a new chat feature"

Into complete production-ready code!

---

**[Our Agents]**

We have a complete team of AI Agents:

🪃 **Workflow Orchestrator** - The General Manager

- Coordinates between all agents

- Tracks progress
- Decides who works when

🔍 **Project Manager / Business Analyst** - Requirements Analyst

- Takes the user's request
- Converts it to clear requirements
- Writes acceptance criteria in BDD format

🔎 **Researcher Expert** - The Researcher

- For new technology
- Does research and provides recommendations
- Gathers best practices

🎨 **UI/UX Designer** - The Designer

- If the task involves UI
- Designs visual specifications
- Prepares assets

🏗️ **Software Architect** - The Architect

- Designs the architecture
- Chooses appropriate patterns
- Writes detailed implementation plan
- **Very Important**: Uses Evidence-Based Design - doesn't invent, builds on what exists!

👥 **Team Leader** - Team Captain

- Takes the implementation plan
- Breaks it into atomic tasks

- Distributes to developers
- Verifies completion of each task

💻 **Backend Developer** and 🎨 **Frontend Developer** - The Developers

- Execute assigned tasks
- Make git commits
- Start from the existing codebase

🧪 **Senior Tester** and 🔍 **Code Reviewer** - Quality Team

- Testing
- Code review
- Quality gates

---

**[The Workflow - Step by Step]**

Let's see the complete workflow:

```
Step 1: /orchestrate "Add notification feature"
         ↓
Step 2: Orchestrator → Generates TASK_ID → Creates context.md
         ↓
Step 3: Project Manager → Creates task-description.md
         ↓
Step 4: USER VALIDATION ✋ ← "APPROVED" or Feedback
         ↓
Step 5: (Optional) Researcher → research-report.md
         ↓
Step 6: (Optional) UI/UX Designer → visual-design-specification.md
         ↓
Step 7: Software Architect → implementation-plan.md
         ↓
Step 8: USER VALIDATION ✋ ← "APPROVED" or Feedback
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

### Part Three: How We Applied Context Engineering (15:00 - 25:00)

---

**[Chatmodes - The Personas]**

First thing: **Chatmodes**!

Each agent has a `.chatmode.md` file that defines:

1. **Identity**: "Who are you?"
2. **Responsibilities**: "What exactly do you do?"
3. **Tools**: "What can you use?"
4. **Strict Rules**: "What's forbidden?"

Example from the Software Architect:

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

See? We're not just telling it "you're an architect"... we're telling it exactly how to work!

---

**[Anti-Hallucination Protocol]**

One of the most important things in our context: **Preventing Hallucination**!

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

Everything the AI suggests must be:

- Present in the codebase
- Verified from the source
- With citation to file and line!

---

**[Prompts - The Phases]**

Second thing: **Prompts**!

Each phase has its own prompt file:

- `phase1-project-manager.prompt.md`
- `phase2-researcher-expert.prompt.md`
- `phase3-ui-ux-designer.prompt.md`
- `phase4-software-architect.prompt.md`
- `phase5a-team-leader-mode1.prompt.md`
- ... and so on

Each prompt contains:

1. **Context Variables**: The `TASK_ID`, `USER_REQUEST`, etc.
2. **Step-by-Step Instructions**: Exactly what to do
3. **Expected Deliverables**: What files must be produced
4. **Quality Gates**: How to verify quality
5. **Handoff Protocol**: How to hand off to the next phase

---

**[Evidence-Based Architecture]**

Something very important in the architect agent:

**Every decision must be based on evidence!**

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

This ensures the AI isn't inventing things from scratch!

---

**[Team Leader - Three Modes]**

The Team Leader has 3 modes:

**MODE 1: DECOMPOSITION**

- Takes the implementation plan
- Breaks it into atomic tasks
- Creates `tasks.md`

**MODE 2: ASSIGNMENT + VERIFICATION**

- Assigns task to developer
- Waits for completion
- Verifies the git commit
- Verifies the file actually exists!

**MODE 3: COMPLETION**

- All tasks complete
- Final verification
- Handoff to QA phase

---

**[Verification - We Don't Trust Anyone!]**

One of the most important principles in the system:

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

**[Validation Gates - Checkpoints]**

We have two important points where we stop and ask the user:

1. **After the Project Manager**:

   - We show the requirements
   - User says "APPROVED" or gives feedback

2. **After the Software Architect**:
   - We show the implementation plan
   - User approves or requests changes

This ensures the user has control over the work!

---

### Part Four: Results & Best Practices (25:00 - 30:00)

---

**[Results We Achieved]**

With this system we achieved:

✅ **Consistency**: Every task is done the same way
✅ **Traceability**: Every step documented in files
✅ **Quality**: Validation gates and verification
✅ **Scalability**: Easy to add new agents
✅ **Anti-Hallucination**: The AI doesn't invent
✅ **User Control**: User approves important steps

---

**[Best Practices from Our Experience]**

1. **Each agent has one responsibility**

   - Single Responsibility Principle
   - The orchestrator doesn't code
   - The developer doesn't design

2. **Context must be explicit**

   - Don't say "write good code"
   - Say exactly what the standards are

3. **Verification is not optional**

   - Every task must be verified
   - No "trust" - there's "verify"

4. **Handoff must be clear**

   - Each agent knows who's next
   - Each agent knows what to hand off

5. **Evidence before implementation**
   - The architect researches first
   - Sees what exists in the codebase
   - Then designs

---

**[Anti-Patterns - What to Avoid]**

❌ **Over-Engineering**

```markdown
BAD: "Let's make this generic for future use"
GOOD: Solve today's problem simply
```

❌ **Vague Instructions**

```markdown
BAD: "Perform research on the topic"
GOOD: "Perform research by:

1. Breaking down query into 3-5 subtasks
2. Executing web search for EACH subtask
3. Documenting findings"
```

❌ **Ignoring Error Cases**

```markdown
BAD: No error handling instructions
GOOD: "If search fails, retry once. If retry fails, document failure."
```

❌ **Backward Compatibility Trap**

```markdown
BAD: "Create ComponentV2 alongside ComponentV1"
GOOD: "Replace existing implementation directly"
```

---

### Conclusion (30:00 - 32:00)

---

**[Recap - Summary]**

So today we talked about:

1. **Context Engineering** - The art of designing information for AI
2. **Multi-Agent Workflow** - A complete team of AI Agents
3. **Chatmodes** - Defining each agent's personality
4. **Prompts** - Instructions for each phase

5. **Verification** - Checking everything
6. **Validation Gates** - User control points

---

**[Call to Action]**

If you want to build a system like this:

1. **Start simple**: One agent first
2. **Write clear context**: Exactly what's expected
3. **Add verification**: Don't trust - verify!
4. **Iterate and improve**: Iterate based on behavior

---

**[The End]**

Thank you for watching! 🙏

If you liked the video, don't forget:

- 👍 Like
- 🔔 Subscribe
- 💬 Comment - Tell me what you think!

The project is on GitHub if anyone wants to see the code!

Peace! ✌️

---

## 📚 References and Sources

1. [Context Engineering Guide](https://www.promptingguide.ai/guides/context-engineering-guide)
2. [Context Engineering for AI Agents](https://www.promptingguide.ai/agents/context-engineering)
3. [Context Engineering Deep Dive](https://www.promptingguide.ai/agents/context-engineering-deep-dive)
4. Andrej Karpathy on Context Engineering
5. Tobi Lutke on Context Engineering
6. [LangChain: The Rise of Context Engineering](https://blog.langchain.com/the-rise-of-context-engineering/)

---

## 🎬 Production Notes

### Required Visual Elements

1. **Workflow Diagram**: Flowchart showing agent sequence
2. **Code Screenshots**: Parts of chatmodes and prompts
3. **Verification Process Animation**: Showing the steps
4. **Before/After Comparison**: Without context engineering vs with it

### Sound Effects

- ✅ Sound for checkmarks during verification
- 🎵 Calm background music
- 🔔 Notification sound during user validation

### B-Roll Ideas

- Team meetings (representing multi-agent collaboration)
- Code editing in VS Code
- Terminal commands running
- Architecture diagrams

---

## 📝 Additional Notes

### Focus Points for the Video

1. **Context Engineering isn't just Prompt Engineering** - It's more comprehensive
2. **Multi-Agent Workflow solves Single Agent problems**
3. **Verification is essential to prevent Hallucination**
4. **User Validation gives Control to the user**
5. **Evidence-Based Design ensures Architecture quality**

### Expected Audience Questions

1. "How do I start building a system like this?"
2. "What LLM are you using?"
3. "How many days did you need to build this system?"
4. "Can I use it with other languages besides TypeScript?"
5. "What's the difference between this and regular GitHub Copilot?"
