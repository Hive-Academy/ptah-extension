# Code Style Review - TASK_2026_685 phase B-backend

Scope: 2d1910965 (B1), f8cc7fa24 + 3330e805f (B2a), ecae2eeab + aa1d41dd9 (B2b). Source read, not edited.

Score: 7/10. Verdict: CHANGES REQUESTED (0 Blocking, 3 Moderate, 4 Minor).

## Boundary / convention checks (PASS)
- Cross-lib imports use barrels only (`@ptah-extension/shared`, `@ptah-extension/agent-sdk`); no deep paths, no eslint-disable, no console.*, no `any` / ts-ignore / `as unknown as`.
- Registration is complete: `RpcMethodRegistry` (rpc.types.ts ~1204), `RPC_METHOD_ENTRIES` (~3883), handler `METHODS` list, and the `subagent:` prefix is already in ALLOWED_METHOD_PREFIXES (vscode-core rpc-handler.ts:85), so no allowlist change is needed. New param/result types live in `subagent-registry.types.ts` (domain split), not appended to rpc.types.ts beyond the two registry rows.
- Zod at the boundary: `SubagentHistoryPageSchema` (subagent-rpc.schema.ts:97-104), parsed with safeParse and mapped to `RpcUserError` (handlers.ts registerHistoryPage). Cursor is validated by a canonical round-trip in `parseHistoryCursor`.
- DI: `@inject(SDK_TOKENS.SDK_SESSION_HISTORY_READER)` matches the token used by sibling adapters (sdk-transcript-reader.adapter.ts:14).
- Naming: kebab-case files; the schema/handler follow the existing `subagent-rpc.*` split. B1 is a minimal two-line root-only guard, consistent with the surrounding code.

## Moderate

1. Error classification by message string across a package boundary.
   `session-history-reader.service.ts` (3330e805f, catch block): `error.message === 'Invalid agent id'`; `subagent-rpc.handlers.ts` registerHistoryPage: `/^(Invalid agent id|Invalid tool call id|Invalid sessionId format:)/.test(error.message)`. Handler behaviour silently depends on three English strings in another lib; reword one and it degrades to PERSISTENCE_UNAVAILABLE. Also these ids are already validated by the Zod schema in the handler, so the regex path is mostly a re-validation. Fix: a typed error (e.g. `SdkError` subclass or a `code`) exported from agent-sdk, checked with `instanceof`/`code`.

2. Hand-maintained `eventTypes` set plus unchecked casts in the page module.
   `subagent-history-page.ts:6-12` re-lists the `FlatStreamEventUnion['eventType']` members; a new event type compiles but is rejected as an invalid cursor (and `payload[1] as ...` at the cursor parser, `{ id, eventType } as FlatStreamEventUnion` in `parseHistoryCursor`, and `as FlatStreamEventUnion` in the clip cases for tool_start/tool_result) bypass type checking. Fix: declare `Record<FlatStreamEventUnion['eventType'], true>` (compile-time exhaustive, same trick as `RPC_METHOD_ENTRIES`) and make `historyCursor` take `Pick<FlatStreamEventUnion,'id'|'eventType'>` so the fake-event cast goes away.

3. Growth of an already oversized file and an inline policy block.
   `session-history-reader.service.ts` is 1306 lines; B2a added ~100 more, including the tail-window algorithm (line ~197-211: scan for last message_start, advance to boundary) and a `10_000` literal used twice, inline in a nested loop of `readSubagentEvents` (about 60 lines, 4 nesting levels). The cap and the message-boundary slicing are pure logic and belong in a small helper (e.g. `retainTailByMessage(events, cap)`) next to `session-replay.service.ts` or the new pure module, with a named constant (the page module already has `HISTORY_PAGE_MAX_EVENTS`; two unrelated caps with no shared home). Same direction for `MAX_*_BYTES` constants exported from a handlers-folder module.

## Minor
- `SubagentEventsReadResult` (session-history-reader.service.ts:115) is consumed by rpc-handlers but not re-exported in agent-sdk `src/index.ts`; the handler relies on inference. Export it for a stable public surface.
- Handler depends on the concrete `SessionHistoryReaderService` class (type import) rather than a narrow interface; acceptable because siblings do the same, but a one-method port would simplify the handler spec mocks.
- `subagent-history-page.ts` has no role suffix and lives with handlers; consider `subagent-history-page.util.ts` or the repo's equivalent. `registerHistoryPage` is ~30 lines inline in a 422-line handlers file; fine today, extract the body into the pure module if it grows further.
- `HISTORY_CURSOR_STALE` / `PERSISTENCE_UNAVAILABLE` codes: confirm they are members of the `RpcUserError` code union (not verified here by running a typecheck).

## Five questions (brief)
1. Six months: new FlatStreamEventUnion member breaks cursors silently (item 2); message-string coupling (item 1).
2. Misread: two different caps (10,000 events vs 2000 per page) and two byte budgets with no stated relation.
3. Cost: dense multi-statement lines in new code plus a long nested reader method.
4. Inconsistent: other subagent handlers have no inline error-regex mapping; typed errors are the norm elsewhere.
5. Different: typed error, exhaustive record for event types, extracted tail-window helper.
