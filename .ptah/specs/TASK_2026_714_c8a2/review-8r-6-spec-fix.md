Verdict: APPROVE
Score: 9/10
Review family: kimi-code (implementer: codex)

## Defects

None.

## Checked

- The late-publisher test still requires admission before the stream failure and still checks the logged rejection. The added `textDelta` yield at `codex-chat-adapter.spec.ts:363-373` preserves that intent and satisfies `require-yield`.
- The failed-interrupt test retains its original overlap assertions at `codex-chat-adapter.spec.ts:1163-1174`. Its new rejection and session-close assertions match the now-active follow-up turn. The gate is released and publication is awaited in `finally` at `:1200-1203`.
- The native harness stores and awaits the real `streamEventsToWebview` completion promise at `codex-chat-native-contract.spec.ts:442-446,502-505`. It uses no polling or sleep. The existing lifecycle, terminal-state, thread, stop, and compact assertions remain intact.
- The new completion promises use explicit resolver types. The changed hunks contain no `any`, `as unknown as`, `@ts-ignore`, eslint disable, readonly mock assignment, private bracket access, or excess typed-literal properties.
- No spec change hides a production defect. The fixes account for the approved admission-before-publication contract.
- Read-only source and diff inspection only. Per lane rules, no tests, lint, typecheck, diagnostics, build, Nx, or npm command was run.
