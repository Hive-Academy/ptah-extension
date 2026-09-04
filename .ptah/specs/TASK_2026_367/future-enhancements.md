# TASK_2026_367 — Future enhancements

Items the task deliberately left open. Each one is a review finding, a plan
decision, or an executor note; none blocks the task.

## Blocked on another task

- **B12 — `chat:abort` reports `alreadyEnded` on the wire.** Fully designed in
  `implementation-plan.md` §5 (C5a-later). Blocked because `ChatAbortResult`
  (`rpc-chat.types.ts`), `IAgentAdapter.interruptSession`
  (`agent-adapter.types.ts`) and `ChatSessionService.abortSession` are all on
  branch `feat/native-agent-loop-pi-ai` (TASK_2026_362). Apply once 362 merges
  to `main`: the backend already returns `'already-ended'` from
  `SessionControlService.endSession` (ec431d4cc) and the frontend already idles
  locally on a repeat press (ecf62776b), so B12 is the wire field plus one
  branch in `ConversationService`.
- **Mojibake in the two 362 files.** `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`
  (2 occurrences) and `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts`
  (3) were excluded from the B11 sweep. Run the same ten-pair map on them after
  362 merges. `console-text.ts` keeps its 10 on purpose (it is the repair table).

## Review findings accepted as LOW

- **`FakeSdkProcessSpawner` cannot fail typecheck on drift**
  (`libs/backend/cli-agent-runtime/src/lib/ptah-cli/testing/fake-sdk-process-spawner.ts`).
  It derives its signature from the port it guards and uses `as never` /
  `as unknown as` inside. Give it an independently written concrete signature
  against the published SDK types and real Node stream/EventEmitter doubles.
  (codex, code-review-antigravity-fix-f2.md)
- **`spawnProcess` fallback routes are not pinned directly**
  (`libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts`).
  `PTAH_SDK_INLINE_SPAWN=1` and a synchronous worker-construction throw fall
  back inline through the shared `launch()`, but the only escape-hatch spec
  goes through the SDK `spawn()` seam. Add two `spawnProcess` regressions. Also
  narrow the plan wording: an ASYNCHRONOUS worker failure emits `error`, it
  does not fall back. (codex, code-review-claude-wave3.md)
- **`cross-spawn`'s ENOENT hook is not replicated on the worker path.** A
  missing `.cmd` target surfaces as a non-zero exit instead of an `error`
  event. No caller reads `error.code` today (`detect()` resolves with `which`
  first; `probeCliVersion` returns `undefined` on either). Worth knowing before
  one does. (B9 report §9)

## Noted in the plan, out of scope here

- **`pendingTeammateNames` has no TTL sweep** (`subagent-state-store.ts`).
  `cleanupExpired` sweeps `registry` and `clearedToolCallIds` only. The new
  `pendingTaskIds` map got a sweep; the older map should get the same one.
  (plan §12)
- **`oauth-surface.component.ts` is 749 lines**, past the 700 soft ceiling
  after B7. Warn-level. A split would not pass the nameability test yet; take a
  deliberate look if it grows again. (B7 report)
- **Codex CLI spawn latency.** The largest measured lag (2166–2923 ms per codex
  spawn) is in `@openai/codex-sdk`'s in-process subprocess launch and is
  outside Ptah's spawn path. Needs the SDK's own opt-in, if any. (plan §0.2)
- **Harness blocked set (`blocked: 12`).** Working as designed; the consent
  dialog is TASK_2026_306 Batch 9. (research-report-harness.md)
- **Curator coverage on real transcripts.** B4's 71 % worst-case coverage
  figure is computed on a synthetic 366 KB transcript; measure `compressToolNoise`
  on a real tool-heavy session once one is captured. (B4 report)
