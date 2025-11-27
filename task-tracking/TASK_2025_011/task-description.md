# Task Description - TASK_2025_011

## Title

Session Management Simplification - Remove Duplicate Storage & Use Claude CLI as Single Source of Truth

## Objective

Refactor session management architecture to eliminate duplicate storage, remove unsupported features, and establish Claude CLI's `.claude_sessions/` as the single source of truth for all session operations.

## Requirements

### Core Changes

1. **Remove Duplicate Storage**

   - Eliminate Ptah's session storage mechanisms
   - Remove session caching/persistence in extension
   - Use `.claude_sessions/` directory as single source of truth

2. **Remove Unsupported Features**

   - Remove session deletion UI (CLI doesn't support this)
   - Remove any session mutation features not supported by CLI

3. **Remove Over-Engineered Components**

   - Delete `libs/frontend/session` library entirely
   - Remove session management UI from sidebar
   - Remove unnecessary session-related services

4. **Create Minimal Session UI**
   - Small component on empty chat screen showing:
     - Sessions list (read from Claude CLI directly)
     - New session button (calls Claude CLI)

### Technical Architecture

1. **Backend**: Thin SessionProxy service

   - Calls Claude CLI commands directly
   - No storage/caching logic
   - Supported operations:
     - List sessions (`claude --session list` or read `.claude_sessions/`)
     - Show session details (`claude --session show <id>`)
     - Create session (`claude --session create`)
     - Switch session (via CLI parameter)

2. **Frontend**: Minimal session component

   - Single component for empty chat screen
   - Direct VSCode message passing (no library)
   - Operations: list, create only

3. **Message Flow**
   ```
   Webview → VSCode Extension → Claude CLI → VSCode → Webview
   ```

## Acceptance Criteria

1. ✅ `libs/frontend/session` library removed
2. ✅ All duplicate session storage removed
3. ✅ Session deletion features removed
4. ✅ SessionProxy service implemented calling CLI directly
5. ✅ Empty chat screen component with minimal session UI
6. ✅ All tests passing
7. ✅ No breaking changes for active sessions
8. ✅ Documentation updated

## Out of Scope

- Advanced session management features
- Session import/export
- Session analytics
- Session search/filtering beyond CLI capabilities

## Constraints

- Must maintain compatibility with existing `.claude_sessions/` structure
- Cannot add features not supported by Claude CLI
- Must not break active chat sessions
- Must follow Nx workspace architecture patterns

## Success Metrics

- Reduction in codebase size (remove 1000+ lines)
- Elimination of session sync bugs
- Simplified architecture (1 service vs 5+)
- Faster session operations (no caching overhead)

## Task Type

REFACTORING
