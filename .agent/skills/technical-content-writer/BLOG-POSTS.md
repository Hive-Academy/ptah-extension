# Blog Post Content Patterns

## Purpose

Educate developers, demonstrate expertise, drive organic traffic through technical accuracy.

## Blog Post Types

### 1. Feature Deep Dive

**When**: New feature shipped, need to explain how it works
**Investigation**: Implementation-plan.md, actual code, task context

### 2. Problem-Solution Story

**When**: Showcasing how product solves real problem
**Investigation**: Task context.md (the "why"), implementation journey

### 3. Technical Tutorial

**When**: Teaching users to accomplish something
**Investigation**: Actual code examples, working patterns from codebase

### 4. Architecture Explainer

**When**: Explaining design decisions
**Investigation**: CLAUDE.md files, implementation plans, task history

### 5. Lessons Learned / Postmortem

**When**: Sharing engineering insights
**Investigation**: Task history, bug fixes, refactoring tasks

## Investigation Protocol

```bash
# Find the story
Read(task-tracking/TASK_XXXX/context.md)      # The problem
Read(task-tracking/TASK_XXXX/task-description.md)  # Requirements
Read(task-tracking/TASK_XXXX/implementation-plan.md)  # Solution approach

# Find the code
Read(libs/<library>/CLAUDE.md)                # Library overview
Glob(libs/<library>/src/**/*.service.ts)      # Implementation
Grep("<pattern>", libs/<library>)             # Specific patterns

# Find related work
Grep("<feature>", task-tracking/registry.md)  # Related tasks
```

## Blog Post Structure

```markdown
# [Benefit-Driven Title]: [Technical Specificity]

## Hook (Opening paragraph)

- Start with the problem (from task context.md)
- Make reader feel understood
- Promise the solution

## The Problem (2-3 paragraphs)

- Detailed problem description (from context.md user intent)
- Why existing solutions fail
- Specific pain points developers face

## Our Approach (2-3 paragraphs)

- High-level solution (from implementation-plan.md)
- Why we chose this approach
- Key technical decisions

## How It Works (Main content)

### Section 1: [Concept]

- Explanation with code example from codebase
- Real interface/type from libs/

### Section 2: [Concept]

- Another code example
- Usage pattern from actual implementation

### Section 3: [Concept]

- Integration example
- Working code that compiles

## Results (Proof section)

- Metrics from task completion
- Before/after comparison
- User impact

## Getting Started

- Installation/setup (from CLAUDE.md)
- Quick example (from actual code)
- Link to documentation

## Conclusion

- Recap the value
- CTA for next action
```

## Code Example Standards

```typescript
// GOOD: Real code from codebase
// File: libs/frontend/chat/src/lib/services/chat.store.ts
@Injectable({ providedIn: 'root' })
export class ChatStore {
  readonly messages = signal<Message[]>([]);
  // ... actual implementation
}

// BAD: Pseudo-code
class ChatStore {
  messages: any; // pseudo implementation
}
```

## Writing Guidelines

### Voice & Tone

- Second person singular: "you" not "we"
- Technical but accessible
- Confident, not salesy
- Show don't tell

### Structure

- Short paragraphs (3-4 sentences max)
- Clear heading hierarchy (H1 > H2 > H3)
- Code blocks with syntax highlighting
- Bullet points for lists

### SEO Considerations

- Use terminology from actual codebase
- Include specific technical terms
- Answer questions developers search for
- Internal links to documentation

## Title Formulas

```
[Benefit]: [How We Did It]
"Real-Time Streaming Chat: Building a TypeWriter Effect with Angular Signals"

[Problem] → [Solution]
"From CLI to GUI: How We Built a Visual Interface for Claude Code"

How [Product] [Achievement]
"How Ptah Achieves Sub-100ms Message Rendering with Signal-Based Architecture"

[Number] [Things] for [Outcome]
"5 Patterns We Used to Build a Responsive AI Chat Interface"
```

## SEO Metadata Template

```markdown
**Title**: [60 chars max, benefit + technical specificity]
**Meta Description**: [155 chars, problem + solution + CTA]
**Keywords**: [From actual codebase terminology]
**URL Slug**: [lowercase-hyphenated-technical-terms]
```
