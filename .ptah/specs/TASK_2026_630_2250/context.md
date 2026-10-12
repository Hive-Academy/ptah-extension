# Context - TASK_2026_630_2250 (Display panel follow-ups)

Source task: `TASK_2026_623_3492` (branch `feat/task-623-display-panel`). Decision numbers below refer to that
task's `decisions.md`. Evidence paths are relative to the repository root.

## Follow-up items (decision #161)

| # | Item | Source | Notes |
| - | ---- | ------ | ----- |
| 1 | Populated surfaces on screen, and the panel at 300/960 px against `prototype/screenshots/` | #155(b), #158, #160 | Turn summary card, dock with surfaces, display strip pills, expanded display chip, `$agents`, atoms (trend pill, sparkline, avatar, accordion), dark and light, the real `pending` word, a numeric Tokens/Cost/Time tile, hidden display-panel tabpanels. **Done.** Gate 3 re-check on a fresh build of `abb512aec` (`visual-review-populated.md`, 2026-10-12): PASS. Trend pill and avatar text ≥ 5.08:1 in anubis, anubis-light and retro; a passing `npm test` shows as passed on the recap and turn summary; collapsed headers show no ` ```ptah-ui ` fence text; the applied chip reads "In display"; the resize handle is a native `<button role="separator">` with keyboard resize; the panel at 300/960 px matches the prototype family with no overflow. Remaining minor notes (not blocking): host turn summary tiles render collapsed while the prototype shows them expanded (confirm intent); collapsed group headers show raw inline-code backticks and "1 files" plural drift; the pre-existing session header metrics strip clips near 892 px. Note: `ptah-electron:build` does not run `copy-renderer`; run `node apps/ptah-electron/scripts/copy-renderer.js` after a build before a visual check. |
| 2 | Accessibility landmarks | #151, #159(a) | Code-output blocks need unique `role="region"` labels (axe `landmark-unique`, 15 hits). The expanded turn-summary chip has a `section[aria-label]` and an inner `role="region"` that collide (`turn-summary-chip.component.ts:133`, `:178-179`). Moderate. |
| 3 | Shared `ptah-file-path-link` wraps long paths instead of truncating | #128 | `design-spec.md:140` wants wrapping. Shared atom, so check every consumer. |
| 4 | Move the dock wiring out of `chat-view.component.ts` into a `chat-view-dock.ts` helper | #113(a), #133(b) | `chat-view.component.ts` is 1,886+ lines. Behaviour-preserving. |
| 5 | Forget a closed chat tab's dock state | #115 | `DisplayDockState.forgetTab` on tab close. |
| 6 | Width-aware row estimate for code output (only if needed) | #121(a), #154(c) | Today a vertical-scroll `max-h-48` fallback is accepted. Do only if users report it. |
| 7 | CLI lanes report real context use | #16, #28 | `$agents` shows `context` "unavailable" for CLI lanes today. Needs the lane to report a known limit. |
| 8 | Item counts and totals on the expanded display chip | #63 | Needs a user or designer decision first. |
| 9 | Edit meta line range and Write new-file vs overwrite flag | #127, #132 | Both need a new data source from the tool result. |

## Partially pinned acceptance criteria (Mode 3 traceability)

Each criterion below has some evidence, but part of it has no spec. Add the missing spec cases.

| Criterion | Missing case |
| --------- | ------------ |
| R1.10 turn summary never auto-opens the panel | Assert the dock stays closed after `setSummaries` / the transcript publishes summaries. |
| R2.10 copy and storage hold the raw fence only | Message copy and code-block copy of a display fence return the raw fence text. |
| R9.6 chat-narrow chip totals wrap under the title | A spec for the chip wrap at chat-narrow width (today only a visual check on a cloned node). |
| NFR Security, imitating chip markup produces no surface | Inject `<ptah-ui-display-chip>` markup in agent text and assert no chip or surface is created. |

## Small corrections

- `libs/frontend/declarative-dashboard/src/lib/components/dashboard-avatar.component.spec.ts` tags its cases
  "(R4.8)" and "(R4.7)"; they cover R4.5. Fix the titles.

## Recorded elsewhere, not part of this task

- Markdown `scrollable-region-focusable` (axe serious, 9 hits on `.ptah-markdown-root`) predates TASK_2026_623;
  it belongs to the markdown library owners (#159(b)).
- Chat-view `heading-order` (#151).
- Optional `$tasks` host source proposal (#65).

## Rules for whoever runs this task

Follow `CLAUDE.md` memory-safe verification: changed projects only, `--parallel=1`, Jest `--maxWorkers=2`, one
heavy check at a time, no build/serve/dev/e2e/package unless the user asks.
