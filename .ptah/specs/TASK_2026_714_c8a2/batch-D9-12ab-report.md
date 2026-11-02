# D9 batches 12a and 12b report

## Files written

- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\codex-runtime\src\lib\codex-protocol-methods.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\codex-runtime\src\lib\codex-protocol-schemas.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\codex-runtime\src\lib\codex-protocol-validator.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\codex-runtime\src\lib\codex-session-history.ts` (new)
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\codex-runtime\src\lib\codex-session-history.spec.ts` (new)
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\codex-runtime\src\lib\codex-context.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\codex-runtime\src\lib\codex-runtime.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\codex-runtime\src\lib\codex-runtime.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\codex-runtime\src\lib\codex-runtime.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\codex-runtime\src\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\.ptah\specs\TASK_2026_714_c8a2\batch-D9-12ab-report.md` (this report)

## Design

Added pinned-schema request/result validation for `thread/read`, `thread/turns/list`, `thread/items/list`, and `thread/list`. The manifest admits all four. The existing discriminator policy rejects unknown item types. `thread/list` has no parent-thread request filter; the loader scans paged results in the verified home, then selects descendants by parent chain and session ID. It reads metadata first, hydrates legacy turns with `includeTurns`, and pages turns and items for paginated threads. It keeps root first, child threads by creation time, and paged turns/items in ascending server order. Item page timestamps are retained. All cursors are bounded to 100 pages and repeated cursors fail. Typed errors cover missing thread, malformed page, stalled cursor, home mismatch, and process/binary failure. Context reads use existing serialization and disposal checks; runtime reads open and close an ephemeral context. No write, rewind, revert, rollback, or MCP change was added.

## Specs added or extended

- Protocol: manifest admission, `includeTurns`, full/summary `itemsView`, unknown item rejection, and cursor parsing.
- Loader fixture: root/child ordering, every turn/item page, item timestamps, repeated cursor, malformed item page, and missing thread.
- Runtime fake process: read without a turn, closed-context rejection, home mismatch before spawn, ephemeral close, unavailable binary, and rejected read.

## Checks and unconfirmed items

- `git diff --check` passed. `rg.exe` was access denied, so PowerShell was used for text reads.
- No tests, typecheck, lint, build, Nx, npm, or `ptah_get_diagnostics` were run, per the lane's first rules. The coordinator must run the project gates.
- The fixture is hand-built from the pinned schema. Live paginated response and child discovery shape remain **UNCONFIRMED**; no live App Server calls were made. The release gate still needs an authorized pinned-binary capture and packaged Electron reload.
- The exact App Server RPC code for a missing rollout is **UNCONFIRMED**. A rejected `thread/read` or `thread/resume` is currently classified as `threadNotFound`; other process failures use `processFailure`.
- CR/BOM verification: all eleven written files have 0 CR bytes and no UTF-8 BOM, checked with a PowerShell byte count equivalent because `tr` and `wc` are unavailable in this shell.
