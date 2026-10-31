## Verdict

REVISE — 8/10

Review family: kimi-code. Implementer family: grok.

The malformed-binding fix and the new regression spec close finding 1. The forbidden assertions are gone from the new native spec. One new generic type predicate is not valid TypeScript and blocks that spec from typechecking.

## Findings

1. **Medium — The unconstrained predicate type is not assignable to its `object` parameter.**
   - **Location:** `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.native.spec.ts:106-109`
   - `hasConsumedMethods<B>(value: object, ...): value is B` leaves `B` unconstrained. `B` can be a primitive, so it is not assignable to `object`. TypeScript reports TS2677 on this declaration. The spec cannot typecheck or run.
   - **Suggested fix:** Declare `hasConsumedMethods<B extends object>`. The same constraint on `requireConsumed<B extends object>` keeps the helper contract explicit. No assertion operator is needed.

## Checked

- **Finding 1 is closed.** Only `null`, `undefined`, and `''` return no identity at `gateway-chat-bridge.ts:1026-1028`. A nonempty invalid id returns an error at `gateway-chat-bridge.ts:1029-1034`. The turn exits through `failTurnBeforeSession` at `gateway-chat-bridge.ts:515-529`, before profile resolution or session startup.
- The new spec at `gateway-chat-bridge.native.spec.ts:914-945` enables native startup and asserts one generic reply, no profile resolve, no resume, no start, no binding write, and an unchanged malformed binding. Without the fix, the native new-session branch would reach profile resolution and the replacement start, so the spec would fail.
- **Finding 2 is otherwise closed.** The new native spec contains no `as unknown as`, `as any`, `as never`, `@ts-ignore`, or `eslint-disable`. The consumed `Pick` types and `AssertAssignable` checks retain compile checks for the harness surface. After the generic constraint is added, the method-presence branding does not hide a new harness defect in the reviewed surface.
- The bound identity still flows from `readBoundSessionIdentity` through `prepareTurn`, `openStream`, and `tryFallbackStart`. A throwing lookup fails closed. An absent lookup keeps the legacy Claude fallback. A fresh turn omits `existingIdentity`.
- Cancellation guards, typed D14a handling, MCP fields, lifecycle notices, the watchdog, and the preparation deadline remain present. The new spec has no fake timers or persistent real timers. Its only timer is an awaited zero-delay helper.
- No tests, lint, typecheck, build, Nx command, or diagnostics ran. This review was read-only as required. The new specs remain unexecuted.
