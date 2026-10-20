# Batch A6 — shared attention wire

## Files changed

- Created `libs/shared/src/lib/types/messages/attention.ts` and `attention.spec.ts`.
- Created `libs/shared/src/lib/types/rpc/rpc-attention.types.ts`.
- Updated `libs/shared/src/lib/types/messages/message-constants.ts`, `payload-map.ts`, `index.ts`, and `schemas.ts`.
- Updated `libs/shared/src/lib/types/rpc.types.ts`.

## Exported contract for A7 and B lanes

- `MESSAGE_TYPES.ATTENTION_CHANGED = 'attention:changed'`; payload map entry is `AttentionChangedPayload`.
- `MESSAGE_TYPES.ATTENTION_OPEN_TARGET = 'attention:openTarget'`; payload map entry is `AttentionOpenTargetPayload`.
- `AttentionTarget`: opaque `workspaceId`, `sessionId`, optional `tabId`, optional `surfaceMode`. The wire rejects slash/backslash paths in identifiers. A7 must resolve the workspace ID to its local workspace before calling its focus router.
- `AttentionNotice`: `key`, nonnegative integer `generation`, `kind` (`permission` | `question` | `lane-permission`), bounded `title` (1–120 chars), nonnegative integer `occurredAt`, and nullable `target`.
- `AttentionChangedPayload`: `{ change: 'upsert', notice }` or `{ change: 'resolve', key, generation }`.
- `AttentionOpenTargetPayload`: `{ key, generation, target }`. A7 should recheck that key/generation is pending before opening.
- `AttentionTargetSchema`, `AttentionNoticeSchema`, `AttentionChangedPayloadSchema`, and `AttentionOpenTargetPayloadSchema` are exported through `messages/index.ts`. All object variants are strict and reject extra fields, including question, prompt, tool input/arguments, raw errors, secrets, and file paths. The title is the approved display title, truncated by the producer; it is not stripped.
- `AttentionGetSnapshotParams = Record<string, never>` and `AttentionGetSnapshotResult = { notices: readonly AttentionNotice[] }` are re-exported from `rpc.types.ts`. Its registry and runtime name map include `attention:getSnapshot`. B2 owns the request/response Zod schema, handler, manifest, and host RPC allowlist.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Carry only opaque workspace/session/tab IDs in routing payloads; A7 resolves the workspace ID locally | Send a workspace path; use an opaque ID | A6 privacy whitelist excludes file paths; plan §3 calls for a sanitized route and A7 owns routing | Yes |
| Allow a 120-character display title and reject longer titles at the boundary | Unbounded title; bounded title | Decision #21 requires the truncated session title in host notices; plan §3 assigns truncation to the host text builder | Yes |
| Use one strict discriminated changed push and a separate strict open-target push | Separate upsert/resolve message types; one changed type | Approved plan §3 names `attention:changed` upsert/resolve and `attention:openTarget`; existing `schemas.ts` uses Zod discriminated unions | Yes |

## Verification and remaining integration

`ptah_ast_analyze` reported clean syntax for the new files and `schemas.ts`. It still reports parser recovery on the pre-existing large `rpc.types.ts` (also present before editing). No Nx, Jest, TypeScript compiler, or diagnostics command was run because the orchestrator reserved the single shared check slot. The new privacy spec is written but has not been executed.

A7 must consume the exported push schemas and resolve opaque workspace IDs. B2 must add the strict snapshot RPC boundary schema and registration. The host producer must truncate titles and use the generic fallback before creating `AttentionNotice`.
