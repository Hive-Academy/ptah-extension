# Batch 8r-4 report

## Files changed

| File | Before | After |
| --- | ---: | ---: |
| `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-adapter.ts` | 817 lines | 686 lines |
| `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-session-controls.ts` | absent | 225 lines |
| `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-adapter.spec.ts` | 1,836 lines | unchanged |

## Moved members

Line ranges below use the source analyzer's zero-based numbering, matching the task's original ranges. New locations are in `codex-chat-session-controls.ts`; delegates are in `codex-chat-adapter.ts`.

| Member | Old lines | New location | Delegate |
| --- | ---: | ---: | ---: |
| `close` | 614–633 | 86–105 | 592–594 |
| `interruptCurrentTurn` | 634–648 | 106–120 | 595–597 |
| `interruptSession` | 649–671 | 121–143 | 598–600 |
| `executeSlashCommand` | 672–685 | 144–157 | 601–605 |
| `compact` | 687–711 | 159–183 | through `executeSlashCommand` |
| `setSessionPermissionLevel` | 713–733 | 185–205 | 606–610 |
| `setSessionModel` | 734–742 | 206–214 | 611–615 |
| `setSessionEffort` | 743–751 | 215–223 | 616–620 |
| `notifyCompaction` | 506–520 | 34–48 | 519–521 |
| `owns`, `isSessionActive`, `canSendFollowUp`, `getSessionToken` | 567–579 | 50–62 | 568–579 |
| `endSession`, `closeSession`, `endSessionIfTokenMatches` | 580–613 | 63–85 | 580–591 |

## Decisions

- Construct one `CodexChatSessionControls` instance in the adapter constructor. A small typed dependency object passes the existing session maps, host ports, error wrappers, and callback getter. The adapter retains shared `session`, `unsupported`, `failure`, and `safe` helpers.
- Moved adjacent session queries and teardown methods to keep session lifecycle behavior together. `TrackedSession` is an internal type export from the new file; the new unit is not exported from the agent-sdk public index.
- Kept existing specs untouched because they exercise the public methods and do not access the moved private members.
- The adapter is still 686 lines, above the requested ~600-line target. Moving further code would cross into opening or turn-stream orchestration and enlarge the new unit's responsibility. The new file is below 300 lines.
- Skill discovery was available, but no matching local backend-refactor skill was found. `rg` could not execute in this environment (access denied), so source text searches used PowerShell `Select-String`.

## Behavior-preservation notes

- Session maps and ports are shared by reference. The original synchronous mutations in `close` still precede its `safe('close', ...)` promise. Context close remains awaited before scope disposal in `finally`.
- Internal teardown and interrupt calls route through bound adapter closures, preserving adapter method lookup and `this` binding. The turn-stream callbacks still target the adapter delegates.
- The control methods retain the original `async` implementations, while delegates return their promises directly. This avoids adding another async wrapper; synchronous throws inside the original async methods remain promise rejections.
- Manual compaction still announces its start before invoking `safe('compact', ...)`, reports callback errors before rethrowing, and publishes completion only after native compact succeeds. The callback getter reads the adapter's current callback at call time.
- Permission aliases, closed-context translation, logger messages and payloads, `stopRequested` ordering, and model/effort settings updates retain their previous branches and await points.
- Both edited TypeScript files parsed cleanly with `ptah_ast_analyze`. No test, typecheck, lint, Nx, build, or diagnostics command was run, as the lane rules prohibit them. Runtime behavior and compilation remain unverified here.

## Coordinator fixes

- Verify F failed (8/18, one cause): TS2554 at `codex-chat-adapter.ts:614` — the
  `executeSlashCommand` delegate passed `(id, command)` to a controls method typed with the full
  3-entry `Parameters<IAgentAdapter['executeSlashCommand']>` tuple. The delegate now forwards
  `...args`. The third argument stays ignored, as on HEAD.
- Restored the `endSessionIfTokenMatches` block comment above the adapter delegate
  (review-8r-4.md note).
- Review: review-8r-4.md APPROVE 9/10 (grok).
