# Context - TASK_2025_011

## User Intent

Eliminate unnecessary complexity in session management by removing duplicate storage and unsupported features.

## Problem Statement

Current session management architecture **mirrors Claude CLI sessions** in Ptah's own storage, leading to:

1. **Duplicate storage**: Ptah copies session data from `.claude_sessions/`
2. **Sync issues**: Old message format bugs when sessions get out of sync
3. **Unsupported features**: UI allows deleting sessions when Claude CLI doesn't support it
4. **Over-engineering**: Entire session management package with its own UI components

## User Requirements

**Delete and Simplify**:

- Remove the entire session management package (`libs/frontend/session`)
- Remove duplicate session storage mechanisms
- Remove session deletion features (CLI doesn't support this)
- Reduce sidebar complexity

**Keep Minimal**:

- Small component on empty chat screen (first landing) with:
  - Sessions list (read from Claude CLI directly)
  - New session button (calls Claude CLI)

**Architecture Goal**: Use `.claude_sessions/` as **single source of truth**, rely on Claude CLI commands for all session operations.

## Conversation Summary

User requested architectural analysis and detailed refactoring plan for simplifying session management to use Claude CLI as single source of truth.

## Date

2025-11-21
