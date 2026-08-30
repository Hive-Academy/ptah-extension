# TASK_2026_327 — Renderer: bounded caches, safe restore, coherent monitor cap

Source: regression review of TASK_2026_323 (R1–R7, commits 0087a4bb3, 96174bd3e,
acaf2a23c).

## Findings to fix

1. **`nodesById` / `fingerprintsById` grow without bound.**
   `libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.ts:90-93`,
   `:319-321`, `:471-505`, `:610-617`. Entries for messages evicted at
   `STREAMING_EVENT_CAP` are never removed.
   Required: after each build, drop entries whose node id is no longer present in the
   rebuilt tree (or prune on the cap-eviction cascade using `messageEventIds`).
   Spec: stream past the cap several times, assert both maps stay bounded.

2. **Tab restore diverges between loaders.**
   `libs/frontend/chat-state/src/lib/tab-manager.service.ts:1951-1967` vs
   `libs/frontend/chat-state/src/lib/tab-workspace-partition.service.ts:508-518`.
   Required: one shared `sanitizeRestoredTab()` in `tab-persistence.ts` used by
   both loaders: coerce `streaming | resuming | switching | awaiting-background` →
   `loaded`, null `streamingState`, `attachedBinding`, `queuedContent`,
   `queuedOptions`. Spec: both loaders, both fields.

3. **2000-event monitor cap blanks old message bodies and tool inputs.**
   `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:1720-1747` feeding
   `libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts:94-113`.
   Required: when trimming non-landmark deltas, fold the dropped `text_delta` /
   `tool_delta` content into the surviving landmark (a synthetic `text_delta` per
   message with the concatenated text, and the final tool input on `tool_start`), so
   the tree renders the same content. Spec: cap → build tree → no empty message body,
   tool input present.

4. **`flushUpdatesSync()` unscoped dead code** —
   `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:93-95`.
   Required: delete it and its delegate spec, or add `originTabId`.

5. **Render-throttle destroy spec is weak** —
   `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.render-throttle.spec.ts:230-237`.
   Required: capture the component's rAF handle, replay it after `fixture.destroy()`,
   assert no new render.

6. **`eventsByMessage` keeps a stale object after backfill** —
   `libs/frontend/chat-types/src/lib/chat-types.ts:241-274` same-id branch.
   Required: on a same-id update, replace the object inside the
   `eventsByMessage` bucket too. Spec: after `backfillAgentStartToolId`, both maps
   return the same reference.

## Constraints

- OnPush, signals, `inject()`. No `[innerHTML]`.
- Do not change `BatchedUpdateService.flushSync` semantics.

## Verify

```bash
npx nx run-many -t test -p @ptah-extension/chat-execution-tree @ptah-extension/chat-streaming @ptah-extension/chat-state @ptah-extension/chat @ptah-extension/chat-types
npx nx run-many -t typecheck -p @ptah-extension/chat-streaming @ptah-extension/chat-state @ptah-extension/chat @ptah-extension/chat-types
```
