# Layout measurement — TASK_2026_690 (new build, Batches 1-4)

Date: 2026-10-17. Dev app built from `feat/chat-layout-display-sheet` at `2cb6b5980`, CDP port 9370,
dark theme. Viewport emulated with Playwright `setViewportSize`. Scripts: `.ptah/tmp/measure-heights.mjs`,
`.ptah/tmp/states.mjs`, `.ptah/tmp/sheet.mjs`. Screenshots: `.ptah/tmp/shot-*.png` (not committed).

## Build failure (HANDOFF section 2)

- `nx build-state-storage-worker ptah-electron --verbose` passes alone (1.6 s).
- The real blocker was `rebuild-native`: `EBUSY ... copyfile better_sqlite3.node -> prebuilds/win32-x64.node`.
  Every worktree junctions the same `node_modules`, and the 687 Electron app had that native file loaded.
  The module was already built for Electron 44.4.3, so the rebuild skipped `rebuild-native`.

## Results

| State | Vertical scrollers in the session column | Composer form bottom / layout bottom |
| --- | --- | --- |
| Orchestrator lane, empty session, 1440x900 | empty-state block only (`ch 505`, `sh 687`); `chat-scroll-container` does not scroll | 862 / 900 (38 px = Peer / Claude CLI footer row) |
| Orchestrator lane, session with content, 1440x900 | `chat-scroll-container` only (`ch 505`, `sh 1431`) | 862 / 900 |
| Orchestrator lane, 795x735 (real window) | one transcript scroller | 697 / 735 |
| Sheet peek (about 40%) and full height | transcript keeps one scroller; full height keeps the composer visible | 862 / 900 |
| Sub-agent lane (side by side 1440, stacked 760) | tool card `div.px-3.pb-2.max-h-80.overflow-y-auto` (`ch 319`) | no composer in this lane |

Every ancestor of the composer from `ptah-chat-session-layout` up to `body` has `clientHeight == scrollHeight`
and ends at the host bottom. No element is taller than its parent.

## Conclusion

The user's screenshot came from the old build (Batches 1+3). In the new build there is one transcript
scroller and no gap under the composer in the orchestrator lane. The outer scrollbar next to the
DISPLAY rail left with the rail (Batch 4). No code change is needed for the reported symptom.

Open observation (not in the user's report): in a sub-agent lane the agent card caps at 320 px
(`max-h-80`) with its own scroller, and empty space stays under it.
