Verdict: APPROVE
Score: 9/10
Review family: codex (implementer: coordinator, claude)

1. None.

Checked

- `libs/backend/codex-runtime/src/lib/codex-app-server-process.ts:65-68,580-608`: the guard recognizes numeric exits, signal-only exits and an observed exit; `fail()` and the rest of `close()` have no remaining exitCode-only branch. The context registers its child exit/close listener before the process listener (`libs/backend/codex-runtime/src/lib/codex-context.ts:127-139`), so the guard preserves the pending method in that event ordering.
- `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts:345-374,417-426,483-495,520-525,635-693`: a `kill()` request sets only `killedFlag`; neither `signalCode` nor `exitObserved` becomes true at request time. The worker handle records them on a real exit or a synthesized terminal event; the inline handle reads Node's exit code and records its exit event. A worker-loss signal can be synthesized before OS death, but that path also emits an error/exit and the process failure handler runs, so it does not turn a deliberate live-child close into an exit-classified pending rejection. Node's local `child_process.d.ts:192-229` distinguishes `killed` from termination and declares `exitCode`/`signalCode` separately.
- `libs/backend/codex-runtime/src/lib/codex-app-server-process.ts:65-68`: TypeScript's `in` operator narrows the absent optional properties to `unknown`; the comparisons used here are valid under strict typing without casts, `any`, suppressions or lint disables. Static inspection only; typecheck was prohibited by the lane rules.
- `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts:133-155,343-353,2258-2274`: the new case leaves `exitCode` null, sets `signalCode`, holds `thread/start`, emits signal-only close, and checks the typed config rejection and method. The fake's `final` avoids a second close in this case; other cases leave `signalCode` null. Stream ends, stdin closure, context close and listener cleanup cover the test's handles. Tests were prohibited by the lane rules.
