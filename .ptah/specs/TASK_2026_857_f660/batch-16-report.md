# Batch 16 report

## Tasks and evidence

- **16.1 — Queue and DI:** Added `NextTurnReminderQueue` with 200-entry pending and alias bounds, 600-character text cap, replace-on-put, one-time take, synchronous alias-aware discard, SDK session rekeying, and subscription disposal. The new spec covers replacement, bounds, both put/rekey orders, rotation, discard after rekey, missing discard, and disposal. Added `SDK_NEXT_TURN_REMINDER_QUEUE` and singleton registration.
- **16.2 — Hook drain:** The main-thread `UserPromptSubmit` path takes the reminder synchronously after the subagent gate, joins it after the handoff pointer with a blank line, and returns the unchanged `{ continue: true }` output when neither exists. A queue failure is reported by error type only and cannot fail the turn. Hook specs cover one-time drain, subagent isolation, empty output, pointer combination, and failure continuation. No await was added.

## Paths touched

- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\agent-sdk\src\lib\helpers\next-turn-reminder.queue.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\agent-sdk\src\lib\helpers\next-turn-reminder.queue.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\agent-sdk\src\lib\helpers\user-prompt-submit-hook-handler.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\agent-sdk\src\lib\helpers\user-prompt-submit-hook-handler.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\agent-sdk\src\lib\di\tokens.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\agent-sdk\src\lib\di\register.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\.ptah\specs\TASK_2026_857_f660\batch-16-report.md`

## Risks handled

- **R1/R7:** Stayed within Batch 16's six assigned agent-sdk files; no B5 or concurrent lane files changed. Scoped verification passed, so no foreign failure was observed.
- **R5 (Gate 2 carry-forward):** `discard(tabId)` removes the reminder under the aliased SDK ID, allowing B18's Disable reset to cancel a pending reminder. The queue does not own B18's cancellation epoch; B18 must guard late writes before calling `put`.
- **R9:** Added no new cross-lib edge. The queue is registered in the existing shared agent-sdk registration function with the existing registry token. Batch 16 lists no host typecheck command; later host gates cover host composition.
- **R12/privacy:** Reminder text remains in memory only and never enters logs or persistence. The only new deliberate swallow has a `degradation-audit: reported` comment and logs only the built-in error class.

## Verification

- Scoped `ptah_get_diagnostics` over all six source/spec files: **0 errors, 0 warnings; clean coverage**.
- `npm run verify -- -p @ptah-extension/agent-sdk 2>&1 | Select-Object -Last 40`: **exit 0; 3/3 tasks succeeded** (lint, test, typecheck). Tail:

  ```text
  NX   3 tasks: 3 succeeded
  Run duration:      2m 15s
  Cache:             0/3 hit (0%)
  [verify 2026-10-30T18:33:23.494Z] lock released after 141.1s, exit code 0
  ```

## Decisions

- **Use one bounded alias map plus a bounded pending map.** Options: keep aliases after take, or remove them with the reminder. The plan requires a later `put(tabId)` to reach the real SDK ID, so aliases persist until evicted or disposed. Evidence: Component 15 and D-7; reversible.
- **Keep the newest reminder when tab and real keys both exist at resolution.** Options: always prefer tab, always prefer real, or prefer the latest put. The queue contract says a put replaces stale pending text; latest put preserves that rule across rekey. Evidence: Component 15; reversible.
- **Drain before awaiting the existing pointer.** Options: drain before or after pointer. Taking first keeps the queue operation synchronous on the hook path and leaves the existing bounded pointer lookup intact. Evidence: Component 15's synchronous-drain requirement and `user-prompt-submit-hook-handler.ts`; reversible.

## Issues outside scope

None observed. No host typecheck is listed for Batch 16. No matching skill loader was exposed in this lane's tool list; repository instructions and the task plan were used directly.
