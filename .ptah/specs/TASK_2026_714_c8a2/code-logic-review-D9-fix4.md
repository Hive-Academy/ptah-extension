# Code Logic Review: D9 fix 4 (Codex resume history)

Score: 6/10. Verdict: APPROVE with required follow-ups (no blocking defect in the changed code). Blocking 0, Serious 2, Moderate 3.

## 1. ancestorThreadId (Serious: pin drift)
- The pinned schema in the repo does NOT contain it. `libs/backend/codex-runtime/src/lib/protocol/codex-app-server-protocol.schema.json:23371-23488` (`ThreadListParams`) lists archived, cursor, cwd, excludedThreadIds, limit, modelProviders, originators, searchTerm, sectionId, sortDirection, sortKey, sourceKinds, useStateDbOnly. A grep for "ancestor" in the file has no hit.
- The only evidence is the lane report: types generated from the 0.165.0 binary outside the repo, plus a live call whose 1,219-byte response returned the child. `codex-app-server-process.ts:227` sends `experimentalApi: true`, so the parameter is probably experimental-gated and left out of the stable export in `manifest.json` (schemaSha256 127cc06b...). That is plausible but unproven in-repo.
- `codex-protocol-methods.ts:102` adds a field the pinned contract and its sha do not describe. If a server ignored it, the call would still work: an unfiltered page of 20 plus cursor paging, with the parent-chain filter at `codex-session-history.ts:192-202`. Ignoring it is safe. A server that rejected it would fall into the WARN and root-only fallback, so child cards would be lost without a visible error.
- Fix: regenerate the schema with the experimental flag, or note in the manifest/pin data that this field was verified live against 0.165.0 only. Add a gated live probe, since the sample was removed.

## 2. Limit 20, pagination and the 1 MB cap
- Child pages are not missed. `pages()` follows `nextCursor` up to 100 pages (`codex-session-history.ts:77-89`) and rejects stalled cursors. Both `archived` values are queried (`:157-181`). A descendants-only filter returns grandchildren too, and the closure loop at `:192-202` handles chains.
- The frame is NOT guaranteed under the cap. The observed average is about 15.5 KB per row (1,555,547 bytes for 100 rows), so 20 rows is about 310 KB. 20 rows with large previews could still exceed 1,048,576 bytes (`codex-app-server-process.ts:26,328`), because the cap is on bytes and the limit is on rows. In that case the process is killed. The root is returned, but the process is dead, so child cards are lost with only a WARN. This is probabilistic, not eliminated.
- Serious: the same cap still hits the root-critical path, which has no fallback. `thread/read` with `includeTurns:true` (`:117-119`), `thread/turns/list` with `itemsView:'full'` and `limit:100` (`:123-126`), and `thread/items/list` with `limit:100` (`:136-139`) can each exceed 1 MB on a long session (100 full turns with command output). That gives HISTORY_FAILED and a killed process, the same failure class as gap 1 but on the root. Fix options: lower the turns limit to about 20 and the items limit to about 25, and/or raise `FRAME_BYTES` for the response direction only to 8 or 16 MB while keeping `QUEUED_BYTES` bounded. The 1 MB cap is the better fix point for responses. Note the stdout buffer is a fixed `Buffer.alloc(FRAME_BYTES)` at `:134`, so raising it is cheap, and the outbound check at `:516` would need to stay at 1 MB. The cap should become a separate inbound constant.

## 3. Fallback correctness
- Aborts propagate: `assertOpen()` runs first in the catch (`:166`) and throws on close or abort. OK.
- Root is hydrated before discovery (`:152`), so root history is preserved. OK.
- Not silent: a WARN is logged with the code and the Zod issue paths via the cause-chain walk. Issue paths contain no values, but `JSON.stringify(cause.issues)` is only safe if issues carry just path and code (as the spec fixtures do). Confirm `CodexProtocolError.issues` never includes message text or received values.
- Moderate: WARN can fire twice, once per archived value, not once. A non-process failure on `archived:false` is followed by `archived:true`, so children can be partially listed with only a WARN. The user cannot distinguish "no children" from "list failed". Consider one aggregated WARN, and a `partial` marker on the snapshot.
- Moderate: after a `processFailure` return, the process is already dead. A process-level failure in `thread/list` is caught as `CodexSessionHistoryError('processFailure')` by `from()`. Non-process classes such as requestRejected, stalledCursor and pageLimitExceeded continue to child hydration, and a later `thread/read` failure for a child still throws (`hydrateThread`, `:102-110`), which turns the whole call into HISTORY_FAILED. That is inconsistent with "auxiliary". Child hydration errors should degrade to a WARN too, if the intent is root-only fallback.

## 4. Sub-agent card rehydration
- Path: `codex-session-history.ts` threads, then `codex-history-projector.ts:65-103` (`threadsById`, `spawnAgent` item `receiverThreadIds`, `createsParentCycle`), which links child turns to the spawn item. Child ordering is by `createdAt` and then id, and the root is first. This works only if the child is discovered and hydrated. With the targeted list it is (per the live 1,219-byte sample). I did not run it, so a live Electron resume is still required.
- Hydration checks `parentThreadId` equality between the list row and the `thread/read` row (`:104-108`). A mismatch throws malformedPage, which now fails the whole history (see section 3).

## 5. Loosening `source` to any string
- `codex-protocol-schemas.ts:461-466`: `string` is now first in the union, so `z.enum` is subsumed. I found no non-spec consumer of `thread.source` in `codex-runtime` or `agent-sdk/codex-app-server`. TS type widens to `string | {custom} | {subAgent}`. Low risk. Moderate: the same loosening should be considered for other enum-typed server labels, since this class of drift can recur, and a new server label no longer throws, so tolerance is now blanket.

## Leftover dependencies on removed files
- No code or spec under `libs/` or `apps/` references `thread-list-sample.json` or `codex-thread-list-live.spec.ts`. Minor: the comment in `codex-session-history.spec.ts` ("the captured native list response is covered in the validator spec") is false now. `codex-protocol-validator.spec.ts:87` uses a synthetic `historyThread` with `source:'appServer'`, and the captured 100-row oversized and the targeted sample no longer have any test. There is no regression test for "source = unseen string label" or the `subAgent.thread_spawn` shape, so the loosened union and the core live finding are unpinned. Add a small synthetic (non-user) fixture.

## Issues
- Serious 1: `ancestorThreadId` absent from the pinned schema (see 1).
- Serious 2: the 1 MB inbound cap remains the root cause for thread/read and turns/items lists on long sessions (see 2). The fix only shrinks the child list page.
- Moderate: child `thread/read` failure aborts the whole history (3). Double WARN and partial lists (3). Stale spec comment and missing test coverage for the new source shape (5, leftovers).

## Suggested fixes
1. Separate inbound frame cap (8 to 16 MB) from the outbound cap in `codex-app-server-process.ts:26,134,328,516`, and lower the turns and items page limits.
2. Wrap `hydrateThread` for children in try/catch with an assertOpen check and a WARN, keeping the root.
3. Document or regenerate the experimental schema containing `ancestorThreadId`.
4. Add a synthetic fixture test for string-label `source` and the `subAgent.thread_spawn` object.
