# Video Script Content Patterns

## Purpose

Engage viewers through visual demonstration of features backed by real code.

## Video Types

### 1. Product Demo (2-5 min)

**Goal**: Show product in action
**Sources**: Working features, UI components, real usage

### 2. Feature Tutorial (5-10 min)

**Goal**: Teach how to use specific feature
**Sources**: Implementation code, usage patterns

### 3. Technical Explainer (3-7 min)

**Goal**: Explain how something works
**Sources**: Architecture docs, implementation plans

### 4. Problem-Solution (2-4 min)

**Goal**: Show problem → solution journey
**Sources**: Task context.md, before/after states

### 5. Release Announcement (1-2 min)

**Goal**: Announce new features
**Sources**: Recent task completions, new code

## Investigation Protocol

```bash
# Feature Understanding
Read(libs/<feature>/CLAUDE.md)
Read(task-tracking/TASK_XXXX/context.md)      # The story

# Visual Elements
Glob(libs/frontend/**/components/**/*.ts)     # UI components
Read(apps/*/CLAUDE.md)                        # App structure

# Code for B-Roll
Grep("<key-pattern>", libs/<feature>)
Read(libs/<feature>/src/**/*.service.ts)      # Key implementations
```

## Video Script Template

````markdown
# Video Script: [Title]

## Metadata

- **Length**: [Target duration]
- **Type**: [Demo | Tutorial | Explainer | Announcement]
- **Audience**: [Developer | Decision Maker | Both]

---

## HOOK (0:00-0:15)

### Visual

[What's on screen - specific UI element or code]

### Narration

"[Opening line that addresses the pain point]"

- Source: task-tracking/TASK_XXXX/context.md

### Action

[What happens on screen]

---

## PROBLEM (0:15-0:45)

### Visual

[Show the problem - old way, frustration, complexity]

### Narration

"[Describe the problem developers face]"

- Source: context.md user intent

### B-Roll Needs

- [ ] [Specific code to show]
- [ ] [UI element demonstrating pain]

---

## SOLUTION INTRO (0:45-1:15)

### Visual

[Product reveal - first look]

### Narration

"[Introduce the solution - what it is]"

- Source: CLAUDE.md product description

### Key Visual

[Hero shot of the product]

---

## DEMO (1:15-3:00)

### Segment 1: [Feature]

**Visual**: [Specific interaction]
**Narration**: "[What we're showing and why it matters]"
**Code Callout**:

```typescript
// From: libs/[feature]/src/...
// Key code to highlight on screen
```
````

### Segment 2: [Feature]

**Visual**: [Next interaction]
**Narration**: "[Next benefit]"
**Code Callout**: [...]

### Segment 3: [Feature]

**Visual**: [Next interaction]
**Narration**: "[Next benefit]"

---

## PROOF (3:00-3:30)

### Visual

[Results, metrics, outcome]

### Narration

"[Specific results and benefits]"

- Source: Task completion metrics from registry.md

### Data Points

- [Metric 1]: [Value] - Source: [task reference]
- [Metric 2]: [Value] - Source: [code reference]

---

## CTA (3:30-4:00)

### Visual

[Next step - install button, docs link, etc.]

### Narration

"[Clear call to action with specific next step]"

### On-Screen

- URL: [actual link]
- Button: [action text]

---

## B-ROLL SHOT LIST

| Timestamp | Description            | Source      |
| --------- | ---------------------- | ----------- |
| 0:15      | [Code snippet]         | libs/[path] |
| 1:20      | [UI interaction]       | [component] |
| 2:00      | [Architecture diagram] | CLAUDE.md   |

## TECHNICAL REQUIREMENTS

### Code Snippets Needed

1. [Description] - File: [path]
2. [Description] - File: [path]

### UI Screenshots/Recordings

1. [Description] - Component: [name]
2. [Description] - Feature: [name]

### Diagrams to Create

1. [Description] - Source: [reference]

```

## Narration Guidelines

### Pacing
- **Hook**: Fast, punchy
- **Problem**: Empathetic, relatable
- **Solution**: Confident, clear
- **Demo**: Deliberate, step-by-step
- **CTA**: Enthusiastic, actionable

### Language
- Use "you" not "we" (except when referring to company)
- Active voice
- Specific, not vague
- Technical terms from actual codebase

### Timing Rules
- 1 sentence = 5-8 seconds spoken
- Code on screen = 3-5 seconds minimum
- UI interaction = show completion
- Don't rush transitions

## Anti-Patterns

**DON'T**:
- Show code that doesn't compile
- Reference features that don't exist
- Use vague superlatives ("amazing", "incredible")
- Rush through technical content
- Skip showing the problem

**DO**:
- Use real working code
- Show actual UI
- Be specific about benefits
- Pause on important points
- Ground claims in evidence
```
