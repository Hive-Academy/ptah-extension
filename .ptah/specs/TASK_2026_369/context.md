# Context

## The block

Found by the opt-in corpus scan in `content-block-contract.spec.ts`
(`PTAH_CORPUS_SPECS=1`). One occurrence across 1,250 transcript files, in this
workspace, on 2026-08-09:

```json
{ "type": "fallback", "from": { "model": "claude-fable-5" }, "to": { "model": "claude-opus-4-8" } }
```

The envelope's `usage.iterations` tells the rest: the first attempt on
`claude-fable-5` produced 142 output tokens before the switch, the second on
`claude-opus-4-8` produced 2,495 and carries `type: "fallback_message"`.

Source record:
`~/.claude/projects/D--projects-ptah-extension/237bbf5e-5996-4bf1-a229-50f8d5b196c8.jsonl`,
line 32.

## Facts that shape the design

- **Ptah did not ask for it.** The SDK's `sdk.d.ts` exposes a `fallbackModel`
  option. Nothing in `libs/backend` sets it. The CLI falls back on its own.
- **The block is the only signal.** There is no sibling `system` record. The
  SDK's own type declarations do not declare the block.
- **Today it is dropped.** `assistant-message.transformer.ts` narrows through
  the `ContentBlock` guards; an unknown type hits the non-throwing
  `unhandled: never` branch and logs a warning. The exhaustiveness check will
  fail the build the moment `FallbackBlock` is added to the union, which is
  the intended forcing function.
- **The same symptom was already visible elsewhere.** The screenshot that
  opened the empty-bubble investigation showed the header chip reading
  `claude-fable-5-1` while the SDK call logged `opus[1m]`. Whether that was a
  fallback or tier resolution, the UI showed the selected model, not the one
  that ran.

## Why not the compaction marker's plumbing

The obvious precedent is `CompactionMarkerComponent`, but its plumbing is wrong
for this. `ConversationRegistry.compactionMarkerFor` holds **one marker per
conversation**, rendered once at `chat-view.component.html:54`. A fallback is
**per message**: one turn can fall back while the next is fine. Copying the
registry shape would pin one stale chip on the whole session.

## Shape

1. **Type.** Add `FallbackBlock { type: 'fallback'; from: { model: string };
to: { model: string } }` to `ContentBlock` in `claude-sdk.types.ts`, plus
   an `isFallbackBlock` guard. Add the block to the corpus fixtures in
   `content-block-contract.spec.ts` (already extracted, see above).
2. **Backend.** In the transformer's block loop, emit a `model_fallback`
   `FlatStreamEvent` carrying `messageId`, `from`, `to`. Register the event in
   the `FlatStreamEventUnion`. It counts as renderable, so the envelope
   suppression must not drop the message.
3. **Frontend.** `StreamingAccumulatorCore` stores it like `thinking_start`;
   `buildMessageNode` emits a `fallback` child node; a chip modeled on
   `CompactionMarkerComponent` renders "Fell back to opus-4-8" inline.

Roughly four files plus specs.

## Priority

Correct to do, not urgent. One occurrence in 89,561 blocks. Do not fold it
into an unrelated branch.
