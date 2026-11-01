# Code Logic Review 10e.G r1 - TASK_2026_714_c8a2

Score: 9/10. Verdict: APPROVED. Blocking 0, Serious 0, Minor 2.

Scope: read-only. I read the git diffs of codex-lane-composition.ts, codex-lane-composition.spec.ts, codex-runtime-composition.spec.ts and the VS Code container.smoke.spec.ts, plus D29. I did not run verify, tsc or jest (the coordinator is running them).

## Revision items

1. codex-runtime-composition.spec.ts:177-185. Fixed. Packaged win32/x64 now resolves the scope's own Runtime token. The throw assertion moved to packaged linux/x64 and still expects 'parity gate'. The separate-scope assertions (:172-175, runtime not.toBe, ApprovalSink chatSink/laneSink) and the no-spawn assertion are unchanged. No assertion was weakened. The gated-runtime-after-admission test below it is untouched.
2. codex-lane-composition.spec.ts:202-204. Fixed without a cast. The logger is registered under TOKENS.LOGGER and read back with `scope.resolve<Logger>`, which is typed. My grep for `as unknown`, `as any`, `@ts-ignore` and `eslint-disable` found none in the four touched files that this revision added. The `as unknown as Logger` hits at container.smoke.spec.ts:663, 694 and 725 are old code outside this diff.
3. codex-lane-composition.ts:261. The "Unreachable while the shared gate is closed" comment matches the code. `isElectronCodexLaneAdmitted` already includes the shared gate, so the clause is only reachable if P14 opens it. Behaviour is correct: it goes to `resolveGatedCodexRuntime` when the gate is open and to the raw Runtime otherwise.
4. codex-lane-composition.ts:247-250. The info log sits inside the `isElectronCodexLaneAdmitted` branch and only fires when packaged and the shared gate is closed. So it logs:
   - once per `registerElectronCodexLaneFactory` call, and phase-2-libraries.ts:304 calls it once;
   - not when unpackaged, because `isPackaged` is false;
   - not on non-admitted platforms, because the branch is skipped;
   - not when the shared gate is open, because that log would be misleading.
   The spec asserts the message for the packaged and admitted case (:204-207).
5. container.smoke.spec.ts:125-130. The `toMatchObject` on the adapter plus `detect()` with `installed: false` and `messagingMode: 'none'` is stronger than the old `CodexCliAdapter` instanceof check, which is no longer valid because the adapter was deleted. The host is also pinned deterministically (`env: {}`, win32/x64 platform) instead of using the real `process`.

CR bytes: `grep -P '\r'` returns 0 on all four source files and decisions.md.

## Defects

1. Minor, codex-lane-composition.spec.ts:~207. The log is asserted with `toHaveBeenCalledWith` only. There is no assertion that unpackaged and non-admitted rows do NOT log, and none for exactly one call. The "once, and not elsewhere" property is therefore unpinned. Fix: add `else expect(logger.info).not.toHaveBeenCalled()` and use `toHaveBeenCalledTimes(1)` in the admitted-packaged branch.
2. Minor, codex-lane-composition.ts:52-57. The win32/x64 literal duplicates the parity gate's table (the comment points at codex-parity-gate.ts:201-212). The risk is small and documented in the code. Make it a shared export if P14 or other hosts need it.

Out-of-scope notes, not defects: the spec edits at :333, :362, :370 and :404 replace `process.platform` with a platform inferred from the path shape. This is test portability, it is behaviour-neutral, and it is a little heuristic.
