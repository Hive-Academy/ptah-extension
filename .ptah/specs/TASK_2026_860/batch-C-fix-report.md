# Batch C fix round

## Root causes and changes

1. The `+N more` assertion assumed every card was a tab stop. The rail uses a roving `tabStop`, and the card passes it through to the overflow button. Updated `canvas-rail-card.component.spec.ts` to assert `tabIndex` is `-1` when `tabStop` is false and `0` when true, in both densities.
2. The board already passes `railStates` to the rail. The board test replaced that rail with a stub that rendered `tiles()` in stored order, so its DOM could never show grouped order. Updated the stub in `canvas-rail-board.component.spec.ts` to use the same `groupRailTiles` helper as the real rail. The test now checks displayed order and the existing stored-slot-preserving move assertion.

## Test result

`npm run verify -- -t test -p @ptah-extension/canvas -- --testPathPatterns=canvas-rail` passed in the foreground: 1 Nx task succeeded, exit code 0 (2026-11-02).

Scoped `ptah_get_diagnostics` found one pre-existing TypeScript error at `canvas-rail-board.component.spec.ts:2305` (`Element.click`) and sibling errors; none came from these edits. No rendered UI screenshot was taken because this round changed test fixtures and assertions only, and the requested verification was test-only.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep the overflow button in the card's roving tab-stop chain | Always tabbable, or follow `tabStop` | Design spec calls for roving focus; the card and chat-ui components already pass `tabStop` to the overflow button. | Yes |
| Make the board test stub group displayed tiles | Change board production code, or correct test stub | Board template passes states to the real rail; real rail groups with `groupRailTiles`; only the test stub rendered stored order. | Yes |

Skill discovery/loading was unavailable in this lane; repository patterns and the task design spec supplied the implementation guidance.
