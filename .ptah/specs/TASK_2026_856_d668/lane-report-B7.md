# B7 lane report

## Files changed

- `libs/frontend/chat-ui/src/lib/atoms/token-badge.component.ts`: uses `messageTokenTotal` for four-class message usage; renders `—` and `Token usage unavailable` when the computed total is invalid.
- `libs/frontend/chat-ui/src/lib/atoms/token-badge.component.spec.ts`: verifies four-class total, rendered badge, tooltip, invalid message usage, and a `NaN` numeric total.
- `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.ts`: preserves `null` in rounded context percentage and displays any known value, including `0%`.
- `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.spec.ts`: verifies that `null` hides the context badge and known zero remains visible through lane updates.

## Lane check

`npm run verify -- -t test -p @ptah-extension/chat-ui -- --testPathPatterns="token-badge|compact-rail-card" | Select-Object -Last 60`: passed, 1 Nx task succeeded, no cache hit.

Scoped `ptah_get_diagnostics`: no errors in the four changed files. It reported 13 errors in sibling files, including other chat-ui specs, frontend-core test infrastructure, and shared types; these files are outside B7 scope.

## Decisions

- Used the shared `messageTokenTotal` and `isValidTokenCount` exports from `@ptah-extension/shared` so invalid totals have one consistent unavailable state. Existing valid number and legacy count behavior stays intact.
- Kept the rail input as `number | null` and tested the badge through Angular's rendered DOM.
- Read the local `angular-frontend-patterns` skill file. A CLI skill loader was unavailable in this session.

## Not done

- A browser screenshot of the live Angular UI was not available: this lane may not run build or serve targets or create an HTML artifact outside the scoped files. The targeted Angular component tests rendered and checked the affected DOM states.
- The 13 diagnostics in files outside this lane's scope were left untouched.
