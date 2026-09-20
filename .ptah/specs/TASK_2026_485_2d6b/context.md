# Context — ElectronStateWorkerProtocolError on every agent output persist

## Symptom, from a real host log

```
[ERROR] [electron RPC] Failed to persist CLI session reference after retries
ElectronStateWorkerProtocolError: Worker message contains a non-cloneable JSON value
```

## Cause — traced to a single literal

`libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts:428-432`

```ts
await metadataStore.saveAgentOutput(info.agentId, {
  stdout: persistedOutput.stdout,
  segments: persistedOutput.segments,
  streamEvents: persistedOutput.streamEvents,
});
```

All three fields are optional, so an absent one becomes an own key whose value
is `undefined`. Twelve lines earlier, the `ref` literal at `:394-409` uses
conditional spreads specifically to avoid this. The bulk literal does not.

The throw sites are the final `throw` after every accepted type is handled:
`libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.ts:680-685`
and `:829-832`. They are reachable only when `typeof value` is `'undefined'`,
`'function'`, `'symbol'` or `'bigint'`. Cycles, non-plain objects and non-finite
numbers each throw their own distinct message, so the reported text rules those
out. The top-level value is already guarded at
`electron-state-storage.ts:143-145`, which is why it must be a nested own
property.

## Second defect, same area

`shouldRetry` at `agent-events.ts:440-443` excludes only
`"Parent session not found"`, so this deterministic serialisation failure is
retried three times before the log line at `:457-460`. A deterministic failure
should not be retried at all.

## Third, worth fixing while you are there

The error message is misleading. `undefined` IS structured-cloneable. This is a
JSON-compatibility guard wearing the word "cloneable", which sends debuggers
hunting for a `Map` that is not there. Rename it to say what it means.
