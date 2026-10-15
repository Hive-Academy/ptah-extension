# Batch S — shared contract

## Files changed

- `libs/shared/src/lib/types/messages/payload-map.ts` — added optional resync seed events and per-context complete block counts.
- `libs/shared/src/lib/types/messages/schemas.ts` — validates both new snapshot fields and limits them to resync snapshots.
- `libs/shared/src/lib/types/messages/chat-stream-snapshot.spec.ts` — covers valid seeds and counts, deferred-only counts, invalid placement, and malformed values.
- `libs/shared/src/lib/types/rpc/rpc-chat.types.ts` — added resume history metadata and viewport resync request fields.

## Exact contract

- `ChatStreamSnapshotPayload.liveSeed?: readonly FlatStreamEventUnion[]` — ordered seed applied after history rebuild and before later live events, only with `resyncRequired: true`.
- `ChatStreamSnapshotPayload.liveSeedBlocks?: Readonly<Record<string, number>>` — complete block count keyed by projected context `messageId`, including deferred anchors, only with `resyncRequired: true`.
- `ChatStreamSnapshotPayloadSchema.liveSeed: z.array(z.unknown()).optional()`.
- `ChatStreamSnapshotPayloadSchema.liveSeedBlocks: z.record(z.string().min(1), z.number().int().nonnegative()).optional()`.
- The schema rejects either seed field when `resyncRequired !== true`.
- `ChatResumeParams.historyBlockOwners?: true` — opt-in for a webview load with an early claim.
- `ChatResumeResult.historyBlockOwners?: Readonly<Record<string, string>>` — decimal event index to source JSONL API `message.id`, for complete replay block events on the returned page.
- `ChatResumeResult.historySyntheticToolResults?: readonly number[]` — indices of synthesized `tool_result` events, sent with opted-in owners, possibly empty.
- `ChatSetStreamViewportParams.resyncTabIds?: readonly string[]` — tabs needing a fresh resync snapshot now or on next reveal.

## Checks

Each command was run once under `.check-lock`, which was removed afterward.

`npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/messages/chat-stream-snapshot.spec.ts --coverage=false --maxWorkers=2` — **PASS**. Tail:

```text
Test Suites: 1 passed, 1 total
Tests:       7 passed, 7 total
Snapshots:   0 total
Time:        2.302 s
Ran all test suites matching libs/shared/src/lib/types/messages/chat-stream-snapshot.spec.ts.
```

`npx nx typecheck @ptah-extension/shared --parallel=1` — **PASS**. Tail:

```text
> nx run @ptah-extension/shared:typecheck
> tsc --noEmit --project libs/shared/tsconfig.lib.json
NX   Successfully ran target typecheck for project @ptah-extension/shared
NX   Nx Cloud encountered some problems
This Nx Cloud organization has been disabled due to exceeding the FREE plan. (code: 401)
EXIT_CODE=0
```

`npx nx lint @ptah-extension/shared --parallel=1` — **PASS**. Tail:

```text
✖ 6 problems (0 errors, 6 warnings)
NX   Successfully ran target lint for project @ptah-extension/shared
NX   Nx Cloud encountered some problems
This Nx Cloud organization has been disabled due to exceeding the FREE plan. (code: 401)
EXIT_CODE=0
```

The six lint warnings are in untouched shared files. Scoped post-edit diagnostics also found zero errors.

## Decisions

- Kept `liveSeedBlocks` valid without `liveSeed`: the addendum explicitly permits a deferred anchor with no seed events (`implementation-plan-addendum.md:852-854`).
- Used the existing `ChatStreamSnapshotPayloadSchema` refine pattern for the resync-only rule (`schemas.ts:204-234`) and existing optional RPC interface style (`rpc-chat.types.ts:245-358`).
- Kept the viewport request on the existing RPC params type; the plan states no new method or registry change (`implementation-plan.md:221-227`).

## Open

- None within Batch S. Host and webview behavior belongs to Batches B and F.
