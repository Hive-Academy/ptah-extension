# Countdown tile implementation report

## Completed

- Reworked the prompt-cache tile to match the Context tile's card, ring-left layout, label, large tabular value, and muted sub-line.
- Added a 44px remaining-TTL SVG ring with normal, low-time, and expired colors; kept the shared one-second clock and destruction release.
- Added live mm:ss / h:mm:ss countdowns, an Expired state, idle-compaction countdown with the 60-second lateness cutoff, and minute-granularity accessible text.
- Updated tile and parent specs for formatting, ring fill/color thresholds, expiry, idle visibility, aria wording, and the col-span-2 host.

## Decisions

- Round positive countdown time up to the next second so a positive remainder stays visible as 00:01. Reversible; based on the requested countdown and existing ceil-minute behavior.
- Use singular "minute" at one minute in aria text. Reversible; improves spoken grammar while retaining whole-minute updates.

## Verification

- Focused Jest: 3 suites, 8 tests passed. Jest reported a worker teardown warning after the successful run.
- `nx typecheck @ptah-extension/chat-ui --parallel=1`: passed.
- `nx lint @ptah-extension/chat-ui --parallel=1`: passed.
- Scoped ptah diagnostics: no errors in edited files. The broader diagnostic scope reports existing errors in unrelated sibling files.

## Files written

- `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-cache-tile.component.ts`
- `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-cache-tile.component.spec.ts`
- `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.spec.ts`
- `.ptah/specs/TASK_2026_698_4146/batch-countdown-report.md`
