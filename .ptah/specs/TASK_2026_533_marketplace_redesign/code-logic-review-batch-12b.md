# Code Logic Review — `TASK_2026_533` Batch 12b (Workspace-scoped session MCP status, Revision 3 D-4)

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 9/10                                 |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 1                                    |
| Failure modes found | 0 defects (all designed-for paths verified) |

## Scope examined

- `libs/frontend/marketplace/src/lib/data/workspace-session-status.ts` (+spec, both new, full read).
- `libs/frontend/marketplace/src/lib/data/marketplace-inventory.store.ts` diff (full file read around the changed region, `installed`/`newestSessionStatus` slices).
- `marketplace-inventory.store.spec.ts` diff (cases 8-11 + migrated `report`/`record` helpers), `provider-row.spec.ts` diff, `marketplace-shell.component.spec.ts` diff.
- Collaborators traced to source: `SessionMcpStatusRegistry` (`libs/frontend/chat-state/src/lib/session-mcp-status.registry.ts`), `TabManagerService.tabs`/`switchWorkspace` (`tab-manager.service.ts:167,306,683-696,791,843,2326,504-514`), `WorkspaceCoordinatorService` fan-out order (`libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts:166-168`), canvas tile creation (`canvas.store.ts:192-206`), Tribunal conductor tab creation (`tribunal-run.service.ts:170`).
- Ran `NX_DAEMON=false npx nx run @ptah-extension/marketplace:test` (all 28 suites / 740 tests green) and `ptah_get_diagnostics` scoped to the two changed files — only the 6 pre-existing, unrelated TS errors reported by the executor.

## Five logic questions

### 1. How does this fail silently?
Not found. `injectWorkspaceSessionStatus` never throws and has no I/O; every "unknown" case degrades explicitly to `null` (empty `tabs()`, no member key), which is the documented and tested degrade path, not a masked failure.

### 2. What user action produces unexpected behaviour?
Closing the tab whose session is currently the newest drops its connector rows immediately (`workspace-session-status.ts:53-71`, pinned by `marketplace-inventory.store.spec.ts` "drops a session's connector rows when its tab closes", :798+). This is the plan's explicitly accepted behaviour change, not a defect, and is pinned by a spec with no RPC call.

### 3. What input data produces a wrong answer?
None found for the code under review. `newestWorkspaceSessionKey` walks `sessions()` from the end and returns the first member — verified against `SessionMcpStatusRegistry.record` (`session-mcp-status.registry.ts:90-103`), which deletes-then-reinserts on every write, so Map iteration order is genuinely insertion/write order. `peek` (`:79-81`) returns the stored reference unchanged, matching the "no spread, no copy" requirement, and is verified never to fire when `sameKeys` (`workspace-session-status.ts:25-31`) reports the same content (spy assertion, store spec case 6, all passing).

### 4. What happens when a dependency fails?
`TabManagerService.tabs` and `SessionMcpStatusRegistry` are synchronous local signals with no RPC/I/O — there is no dependency-failure surface for this unit. `installed`'s combination with the async `listInstalled` read is unaffected: during a switch, `cells.installed.data()` is `null` (discarded by generation bump) independent of `newestSessionStatus()`, so `installed` renders no rows until the new read lands, verified by store spec case 9 (`scope.switchTo` + `tabs.set([])` + `TestBed.tick()`).

### 5. What is missing that the requirements never mentioned?
The plan's failure table lists "Rapid A -> B -> A" as a required case, but no spec is titled for exactly that sequence. Spec 4 (`workspace-session-status.spec.ts:142-153`, A -> B -> "no session") and store spec case 9/10 (switch + re-report) together exercise the same mechanism (pure re-derivation from `tabs()` and `registry.sessions()`, no cached "was on A" state), so the property holds, but there's no test literally reading "back to A" — a minor traceability gap, not a logic gap (see Moderate below).

## Failure modes

None found with the evidence read. Scope: the new collaborator, its spec, the store rewiring, and every real-store-building spec in the lib. Residual uncertainty: behaviour of `SessionMcpStatusRegistry`'s `MCP_STATUS_MAP_LIMIT` (128-entry LRU) evicting a genuine member session while noise records remain is a pre-existing registry property, unaffected by and out of scope for this batch.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

1. (Minor) No spec is literally titled "rapid A -> B -> A"; coverage is inferred from spec 4's A->B->none sequence and the store's switch specs (cases 9-10), which together prove the same re-derivation property. Suggest a one-line follow-up test for full traceability against the plan's failure table, not required for approval.

## Data flow

1. `TabManagerService.switchWorkspace` swaps `_tabs` synchronously in the coordinator's fan-out (`workspace-coordinator.service.ts:166-167`) — OK, verified in source.
2. `members` computed rebuilds `{tab.id, tab.claudeSessionId≠null}` from `tabs()` with a content-equal comparator — OK; a streaming flush that keeps the same keys does not propagate (verified by spy in spec 6).
3. Outer computed unconditionally reads `registry.sessions()` and `members()` every evaluation (no conditional short-circuit before either read) — OK, no missed-dependency risk.
4. `newestWorkspaceSessionKey` walks from the end of `sessions()` and returns the first member — OK, matches the registry's write-order guarantee.
5. `registry.peek(key)` returns the stored object unchanged — OK, lets the outer computed's default `Object.is` equality suppress downstream propagation when nothing relevant changed.
6. `MarketplaceInventoryStore.installed` combines `newestSessionStatus()?.servers` with the disk read via `toConnectorRows` — OK, re-derives on either input, unchanged code path (not part of this diff).
7. Store's `workspaceEffect`/generation guard discards in-flight `installed` reads across a switch independently of session scoping — OK, the two mechanisms compose correctly (store spec case 9/10).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Pure `newestWorkspaceSessionKey`, walks from end | COMPLETE | none |
| `injectWorkspaceSessionStatus`, injection-context pattern, chat-state only | COMPLETE | none |
| Member set = `tab.id` + non-null `tab.claudeSessionId`, content-equal | COMPLETE | none |
| Outer computed returns `registry.peek` unchanged | COMPLETE | none |
| Reference stability across same-key `tabs()` write; changes on new record | COMPLETE | verified via spy, not just `toBe` |
| Store: `newestSessionStatus` name/type unchanged, `installed` code unchanged | COMPLETE | none |
| Store ≤699 lines, no `SessionMcpStatusRegistry` reference | COMPLETE | 688 lines, confirmed by grep |
| Every real-store spec stubs `TabManagerService` | COMPLETE | 3 of 3 (store spec, provider-row spec, shell spec via shell providers) confirmed by grep across the lib |
| Closed-tab behaviour change pinned | COMPLETE | store-level spec, no RPC |
| Tab-coverage assumption (canvas, Tribunal) stated with file:line | COMPLETE | verified independently against source, both true |
| Specs 1-11 present and green | COMPLETE | 740/740 tests pass in a fresh run |

Implicit requirements not addressed: none found.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| No session anywhere | YES | `null` degrade | none |
| Session of another workspace only | YES | non-member skip | none |
| Switch mid-load | YES | generation guard + tabs() swap compose | none |
| Rapid A->B->A | YES (inferred) | pure re-derivation, no cached state | not literally titled, see Minor #1 |
| tabId push before UUID known | YES | `tab.id` always a member key | none |
| Re-key tabId -> UUID | YES | both keys remain members via same tab | none |
| Tab closed | YES | pinned, no RPC | accepted behaviour change per plan |
| Active workspace removed | YES | `tabs()` -> `[]` -> `null` | none |
| MCP_STATUS_MAP_LIMIT eviction of a member | NOT NEW | pre-existing registry LRU | out of scope for this batch |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none material; the sole gap is a traceability nit (Moderate/Minor #1), not a behavioural defect.
- What a robust implementation would add: one spec literally exercising rapid A->B->A to close the plan's failure-table traceability gap; otherwise no further work indicated.
