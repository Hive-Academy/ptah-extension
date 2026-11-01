# B13b lane report

## Files changed

- `libs/frontend/chat/src/lib/services/session-inspector/session-inspector.store.ts`: reads the host's `tokenCount` through `sessionTokenTotal`, resolves turns with host precedence and paging awareness, derives context with shared trust and percent helpers, and tracks background workspace revisions for cached models.
- `libs/frontend/chat/src/lib/services/session-inspector/session-inspector.store.spec.ts`: covers absent and present host token totals, F2 and both F6 forms, four turns precedence cases, a background stats update, and workspace removal.
- `.ptah/specs/TASK_2026_856_d668/lane-report-B13b.md`: this report.

## Verification

- Required lane check: `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="session-inspector.store" | Select-Object -Last 60` passed (`NX 1 task: 1 succeeded`, exit 0).
- Changed project typecheck: `npm run verify -- -t typecheck -p @ptah-extension/chat | Select-Object -Last 60` passed (`NX 1 task: 1 succeeded`, exit 0).
- Scoped `ptah_get_diagnostics` was unavailable after two 45-second attempts; the successful project typecheck supplies the TypeScript verification.

## Decisions

- A missing host `tokenCount` stays unknown even when token classes are present. Host `turnCount` is accepted only when it is a finite non-negative integer, including zero.
- When host turns are absent, a fully loaded history uses the loaded user-turn count, including zero; a paging cursor keeps turns unknown.
- Context requires a same-model trusted capacity. The store computes percent from `contextUsed` and that window, ignoring an untrusted `contextPercent` field.
- The cached model reads `backgroundTabsRevision()` before cross-workspace lookup so background updates and workspace removal invalidate it.

## Anything not done

- Visual inspection was unavailable: there was no active browser session, and this lane forbids starting a serve or dev target. No claim about rendered appearance is made.
