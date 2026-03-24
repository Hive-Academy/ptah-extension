# TASK_2025_192: Session Sidebar Search & Filter

## Task Type: FEATURE

## Workflow: Minimal (frontend-developer direct)

## Created: 2026-03-13

## User Request

Add client-side session search/filter to the sidebar with:

1. Search by session name (text input)
2. Filter by date range (from/to date inputs)
3. Change page size from 10 to 30
4. Filtering works on all loaded sessions including "Load More" batches

## Scope

- Frontend-only change (no backend modifications)
- Client-side filtering via Angular computed signals
- UI: search input + date range filter in sidebar header
- Page size change: 10 → 30

## Key Files

- `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts` - Sidebar UI
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.html` - Sidebar template
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts` - Pagination logic

## Design Decisions (from conversation)

- Client-side filtering (not server-side) — 30 sessions is negligible payload
- Computed signal filtering on top of loaded sessions
- "Load More" loads next 30, all loaded sessions are filterable
