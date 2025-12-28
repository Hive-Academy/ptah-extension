# Task Context - TASK_2025_031

## User Intent

Full refactoring of `tool-call-item.component.ts` with specialized components for different tool types, including a proper TodoWrite display component, **plus TypewriterService integration** for streaming text effects.

## Conversation Summary

- User observed that `tool-call-item.component.ts` (702 lines) handles too many concerns
- Current TodoWrite tool displays raw JSON instead of a proper task list UI
- Analysis identified these decomposition opportunities:
  - `tool-call-header.component.ts` - Icon, name badge, description, status, duration
  - `tool-input-display.component.ts` - Parameter display with expand/collapse
  - `tool-output-display.component.ts` - Formatted output with syntax highlighting
  - `todo-list-display.component.ts` - Specialized display for TodoWrite tasks
  - `file-path-link.component.ts` - Clickable file paths (reusable atom)
- TodoWrite structure: `{ todos: [{ content, status, activeForm }] }`
- Status values: `pending`, `in_progress`, `completed`

### Enhancement: TypewriterService Integration

- **New Requirement**: Add TypewriterService to create character-by-character typewriter effects during streaming
- **Problem**: Currently shows blocks of text at once during streaming instead of smooth typewriter animation
- **Solution**: Create TypewriterService using RxJS (interval, concat, map, take, repeat) to reveal text progressively
- **Integration Point**: Hook into typing-cursor component to display typewriter effects with streaming
- **Service API**:
  - `type({ word, speed, backwards })` - Core typing animation
  - `typeEffect(word)` - Full effect cycle (type forward → pause → type backward → pause)
  - `getTypewriterEffect(titles)` - Cycle through multiple strings with typewriter animation

## Technical Context

- Branch: ak/fix-chat-streaming (current)
- Created: 2025-11-30
- Type: REFACTORING
- Complexity: Medium

## Execution Strategy

REFACTORING workflow:

1. software-architect → Design component decomposition
2. USER VALIDATES
3. team-leader MODE 1 → Decompose into batches
4. team-leader MODE 2 (loop) → Assign, verify, commit
5. team-leader MODE 3 → Final verification
6. USER CHOOSES QA
7. modernization-detector → Future enhancements
