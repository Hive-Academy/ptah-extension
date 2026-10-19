# Batch B5b report

## Files written

- D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\execution\inline-agent-bubble.component.ts
- D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\execution\inline-agent-bubble.component.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\execution\subagent-tile.component.ts
- D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\execution\subagent-tile.component.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\utils\message-summary.utils.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\.ptah\specs\TASK_2026_685_64f4\reports\batch-B5b.md

## Evidence by task

- B5b.1: The bubble subscribes to the store entry signal and stamps `treeFor(toolCallId)` through its existing `nodeTemplate`. It retains and releases the key, uses record tool counts when the tree is empty, exposes a click-only Load agent output action for restored output, and suppresses old summary children when the tree exists. Removed the transcript button, viewer dependency, icon, and handler. Specs cover live tree precedence, count, absence of duplicate summary and transcript button, loading on click, and retain/release.
- B5b.2: The tile takes recursive tool count and latest activity from store roots when present, then record toolUses and lastToolName. Spec covers both states.
- B5b.3: Added a parent-only tool/file count spec. Transcript specs cover a top-level turn chip, an agent tile before agent_start has supplied a record, in-place opening, and store output arriving after the parent message is finalized. Read `transcript-agent-facts.ts` without changing it.

## Risks

- Risk 10: The main bubble transcript button and viewer dependency are removed as authorized; no alternate transcript RPC path was added.
- Risk 12: Nested agent chips are lost when their nodes exist only in the store tree. `collectTurnAgentFacts` traverses only parent message trees and active trees; `turnAgentKeysOf` likewise reads message trees. Top-level agent nodes remain in the parent tree and keep their chip. This needs a follow-up decision and implementation outside B5b file ownership.

## Decisions

- Use the reactive `entries()` signal to invalidate `treeFor(key)` reads. This follows the committed store API; alternative was copying execution state into the component. Reversible.
- Keep existing parent children as the empty-store fallback so summary-chunk text remains visible per P3. Store roots take precedence when available. Reversible.
- Show Load agent output for a completed bubble with no store tree, and keep history loading and terminal empty states from showing another Load action. This follows P2 and store history states. Reversible.

## Clarifications Needed

1. For nested agent chips lost after B4, should the transcript rebuild nested chip facts from the store tree? Options: **(Recommended) Rebuild nested chips from store roots** and retain the parent-turn association; keep only top-level chips; restore nested agent nodes to the parent tree. The first option preserves the pre-B4 chip capability without duplicating execution output.

## Verification

- No test, typecheck, lint, build, serve, e2e, or package command was run, per lane instruction.
- `ptah_ast_analyze` returned parseStatus ok for all six changed TypeScript files.
- Scoped `ptah_get_diagnostics` was requested twice; its TypeScript compiler backend remained unavailable after each 45-second window, leaving six files unchecked. The team leader should run the scoped chat checks.

