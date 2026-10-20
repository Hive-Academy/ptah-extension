# Host attention context label fix

## Changes

- `libs/frontend/chat/src/lib/services/chat-attention-host-message-handler.service.ts:185-192,208`: host projections use the permission, question, or lane permission kind label as the row title. The existing safe session-title filter supplies context after the local provider; a filtered title leaves provider-only context. Workspace resolution and its `Unknown workspace` fallback remain unchanged.
- `libs/frontend/chat/src/lib/services/chat-attention-host-message-handler.service.spec.ts:70-123`: added local, remote, lane permission, unsafe-title, and default-title assertions. The local and remote cases assert that the session title appears in context and not in the row title.

## Push path checked

- `libs/backend/agent-sdk/src/lib/permission/host-attention-coordinator.ts:280-289` creates the host notice with `sessionTitle: this.title(record?.name)`; `libs/backend/rpc-handlers/src/lib/handlers/attention-rpc.handlers.ts:52-58` maps that to `AttentionNotice.title` for snapshots.
- Repository search for `attention:changed`, `ATTENTION_CHANGED`, and `sessionTitle` found the frontend push consumer and test payloads, but no backend `attention:changed` producer in this checkout. The handler's push path uses the same `upsertProjection` as snapshots, so the title mapping applies to either input.

## Decisions

- Use a kind-to-label mapping in the host projection. Options were to keep `notice.title` or use the in-app kind labels. The schema at `libs/shared/src/lib/types/messages/schemas.ts:27-35` permits only the three mapped kinds, and the in-app source at `libs/frontend/chat/src/lib/services/chat-attention-source.service.ts:63-81` supplies the matching fallback labels. This is reversible. The handler retains `notice.title` and omits context for any future unrecognized kind.
- Keep the existing safe-title filter and provider/workspace logic. This avoids changing the prior privacy and workspace behavior. This is reversible.

## Verification and remaining work

- Scoped `ptah_get_diagnostics` found no diagnostics in either edited file. It reported 253 errors in sibling files in the same project.
- No nx, Jest, tsc, lint, or build command was run, as instructed. The orchestrator owns test execution.

## CodeRabbit round

1. **Fixed — host unpartitioned owner path.** `libs/frontend/chat/src/lib/services/chat-attention-host-message-handler.service.ts:178-187,229-243` now accepts an active/local renderer root only after a tab or session lookup validates ownership and `workspaceIdFromPath(root)` matches the target ID. No target ID is used as a path. Cases for active root, renderer root, unmatched root, mismatched session, and remote target are in `chat-attention-host-message-handler.service.spec.ts:88-145`.
2. **Fixed — single-segment Unix paths.** Shared `attention-context.util.ts:1-3` rejects whole tokens such as `/tmp` and `/etc` while preserving `CI/CD` and `and/or`. Host cases are in `chat-attention-host-message-handler.service.spec.ts:155-169`.
3. **Fixed — host assembled cap.** `attention-context.util.ts:5-8` truncates the joined context to 80 characters with an ellipsis; host uses it at `chat-attention-host-message-handler.service.ts:195`. Spec: `chat-attention-host-message-handler.service.spec.ts:171-179`.
4. **Fixed — malformed tool name.** `chat-attention-source.service.ts:144` checks `typeof` before trimming. Spec: `chat-attention-source.service.spec.ts:214-221`.
5. **Fixed — expanded shared unsafe filter.** `attention-context.util.ts:1-3` handles single-segment and home-relative Unix paths, relative file paths with extensions, and AKIA/ghp_/xoxb- prefixes. Both sources import it (`chat-attention-host-message-handler.service.ts:15`, `chat-attention-source.service.ts:8`). Source title and question cases are in `chat-attention-source.service.spec.ts:180-213`.
6. **Fixed — source assembled cap.** `chat-attention-source.service.ts:150-151` uses the shared context joiner. Spec: `chat-attention-source.service.spec.ts:222-231`.
7. **Partial — unpartitioned canvas bridge.** `notification-focus-coordinator.service.ts:47-48` now reports a failed tab request as `cap-reached`; `notification-focus-coordinator.service.spec.ts:94-101` covers that result. The already-tiled focus behavior is in `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:438-455`: it calls `focusTile` only when `adoptTab` returns a non-null ID. Fixing that requires editing the canvas consumer, outside this lane's allowed files. The bridge's boolean result also conflates cap refusal, workspace mismatch, and timeout (`libs/frontend/core/src/lib/services/app-state.service.ts:1317-1320`); a precise outcome needs a richer bridge contract outside this lane's scope.

The final scoped `ptah_get_diagnostics` call timed out before checking the seven edited TypeScript files; an earlier call found only two pre-existing diagnostics in `chat-attention-source.service.spec.ts` at the then-current lines 270 and 292 (the `useClass` TestBed overload). No nx, Jest, tsc, lint, or build command was run.
