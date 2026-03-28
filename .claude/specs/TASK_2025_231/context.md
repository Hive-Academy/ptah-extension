# TASK_2025_231: Electron View Tabs in Navbar

## User Request

Add view tab pills in the Electron global navbar to switch between open views (Chat, Setup Wizard, Settings, Dashboard). Currently setup wizard completely replaces chat with no way back.

## Strategy: FEATURE (Partial)

Architect -> Team-Leader -> Frontend Developer -> QA

## Key Files

- `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.html`
- `libs/frontend/core/src/lib/services/app-state.service.ts`

## Requirements

1. Track "open views" in AppStateManager (chat always open, others open on demand)
2. Add view tab pills in electron-shell navbar showing active views
3. Allow clicking to switch between them
4. Highlight current view, close non-chat views via X button
