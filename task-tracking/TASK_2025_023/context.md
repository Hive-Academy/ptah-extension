# TASK_2025_023: Complete Purge & Revolutionary Nested UI Rebuild

## User Intent

After 5 months of building Ptah, the user discovered that the core architecture has multiple parallel systems that don't work together. Rather than patching, they want a **complete purge and rebuild** with a revolutionary vision:

**Build the FIRST VS Code extension that can display nested agent orchestration visually** - something NO other Claude Code extension can do.

## The Problem

### Backend Issues

- Multiple parallel CLI management systems (Print mode vs Interactive mode)
- In-memory SessionManager duplicating .jsonl files
- Complex SessionProcess with state machine that blocks RPC
- InteractiveSessionManager that's half-wired
- 5 months of accumulated complexity that doesn't work

### Frontend Issues

- UI wired to two unfinished backend systems
- Complex signal hierarchies across multiple services
- No component looks or behaves as intended
- Standard flat chat interface like every other extension

## The Vision

### What Every Other Extension Does (Wrong)

- Flat, linear chat interfaces
- When agent spawns sub-agent → all streams into ONE window
- No nesting, no hierarchy, no visual organization
- Claude's native VS Code extension has this limitation

### What Ptah Will Do (Revolutionary)

**Recursive, nested UI components** that display agent orchestration visually:

```
┌─ Message Bubble ────────────────────────────┐
│ 🤖 Claude                                   │
│ "I'll help implement this..."               │
│                                             │
│ ┌─ Agent Card (collapsible) ──────────────┐ │
│ │ 🔧 software-architect                   │ │
│ │ Done • 5m • 80.6k tokens                │ │
│ │ ┌─ Nested Agent Card ─────────────────┐ │ │
│ │ │ 🔧 frontend-developer              │ │ │
│ │ │ +32 tool uses                      │ │ │
│ │ └─────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

Like Claude CLI's terminal output, but with RICH Angular components.

## Technical Approach

### Backend: Simple ClaudeProcess (~100 lines)

```typescript
// Spawn per message with --output-format stream-json --verbose
// stdin.write(message + '\n'); stdin.end();
// Parse stdout JSONL directly
// No complex state machines, no in-memory duplication
```

### Frontend: Recursive Component Architecture

- **Tailwind CSS** - Utility-first styling
- **DaisyUI** - Pre-built components (collapse, card, badge, accordion)
- **ngx-markdown** - Rich markdown rendering
- **Angular Signals** - Real-time nested updates

### Key Data Structure

```typescript
interface ExecutionNode {
  id: string;
  type: 'message' | 'agent' | 'tool' | 'thinking';
  status: 'streaming' | 'done' | 'error';
  content: string | null;
  stats?: { tokens: number; duration: number; toolUses: number };
  children: ExecutionNode[]; // RECURSIVE!
  isCollapsed: boolean;
}
```

## Success Criteria

1. Send message → see response stream in nested UI
2. Agent spawns sub-agent → displays as nested card
3. Tool calls → display as collapsible badges
4. Sequential thinking → collapsible thought blocks
5. Switch sessions → see history with nested structure preserved
6. Resume session → continue conversation

## User Quote

> "i'm playing and counting very hard on the ui/ux part most of the extensions can't have a complex ui/ux... there are no current extension for claude code... that will show an agent execution inside a main chat execution... we need to completely start off from ground up"

---

Created: 2025-11-25
Status: In Progress
Owner: orchestrator
