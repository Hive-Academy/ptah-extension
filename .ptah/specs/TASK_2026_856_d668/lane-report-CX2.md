# Lane CX2 report

Status: complete.

## Files changed

- `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts`: use shared `contextFillTokens` for published `lastTurnContextTokens`.
- `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.live-stats.spec.ts`: pin F1, F3, F7 and F11 with concrete token counts.
- `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`: skip every sidechain record before checking for a compact boundary or assistant frame; use shared `contextFillTokens` for the snapshot.
- `libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts`: pin F1, F9, F13 and F14 with concrete token counts.

## Changed fixtures

No existing fixture's expected payload changed. New cases cover sidechain assistant and compact-boundary records in the main transcript; those records now leave the latest main frame intact.

## Test result

`npm run verify -- -t test -p @ptah-extension/agent-sdk -- --testPathPatterns="stream-transformer.live-stats|session-history-reader.service"`: passed (`NX 1 task: 1 succeeded`). Focused regressions: 7 passed. Scoped TypeScript diagnostics: 0 errors. `git diff --check` on the four changed source/spec files: passed.

## Decisions

- Kept live capture, proxy delta override, subagent guard and compaction clearing intact; only the published numerator uses the shared function.
- Applied the sidechain skip before the compact-boundary check so a sidechain boundary cannot erase a main frame, while a main boundary still clears the snapshot.
- Used a native capacity route in the live spec to establish the SDK-native 1,000,000-token window and its 13% result.

## Not done

Project-wide lint and typecheck were outside this lane's scope. A skill invocation mechanism was unavailable in this lane; the supplied repository guidance was applied directly.
