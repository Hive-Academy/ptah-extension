# TASK_2025_198: Auth Settings UX Redesign — Provider Tiles + Claude Auth Consolidation

## User Request

1. Rename main tab "Claude Auth" → "Ptah Providers"
2. Convert provider dropdown (`<select>`) to selectable tiles/cards
3. Combine Claude API Key + OAuth under a single "Claude" tile (alongside provider tiles)
4. Maintain existing internal code structure and logic — frontend template changes only

## Task Type: REFACTORING (UX restructuring)

## Complexity: Medium

## Workflow: Partial (Architect → Team-Leader → Developers → QA)

## Current Structure

- **Tab**: "Claude Auth" in `settings.component.html`
- **Auth method buttons**: Provider | API Key | Auto | OAuth (4 `join-item` buttons)
- **Provider dropdown**: `<select>` with ngModel, populated from `authState.availableProviders()`
- **Providers**: OpenRouter, Moonshot, Z.AI, GitHub Copilot, OpenAI Codex
- **Claude auth**: API Key section (lines 426-521) and OAuth section (lines 311-424) are separate

## Key Files

- `libs/frontend/chat/src/lib/settings/auth/auth-config.component.html` (620 lines)
- `libs/frontend/chat/src/lib/settings/auth/auth-config.component.ts` (330 lines)
- `libs/frontend/chat/src/lib/settings/settings.component.html` (tab layout)
- `libs/frontend/chat/src/lib/settings/settings.component.ts` (tab logic)

## Constraints

- No backend changes
- No changes to AuthStateService signals/methods
- No changes to RPC calls or provider registry
- Keep all existing functionality (save/test, delete, replace, OAuth flows)
- DaisyUI 4.12 + TailwindCSS 3.4 classes
