# B3a — tab records and proposal hydration

## Files changed

- `libs/frontend/harness-builder/src/lib/services/harness-builder-records.service.ts` — New builder-owned Zod storage for versioned per-tab user snapshots and stack profiles, plus one draft pointer per workspace and mode. Canonical root and tab keys, invalid-record removal, draft replacement, tab clearing and orphan sweep are included.
- `libs/frontend/harness-builder/src/lib/services/harness-builder-records.service.spec.ts` — Covers record isolation, invalid version/key/shape deletion, stack validation, draft replacement and orphan clearing.
- `libs/frontend/harness-builder/src/lib/services/harness-proposal-hydration.service.ts` — New tab-bound SDK-session hydration with generation guards, buffered and deduplicated live pushes, turn-start ordering, user-choice precedence and stable-ID list merges. It never requests a workspace-latest proposal.
- `libs/frontend/harness-builder/src/lib/services/harness-proposal-hydration.service.spec.ts` — Covers late T1 writes after T3, unattributed and user-choice precedence, overlapping reads, buffered push de-duplication, foreign pushes, workspace isolation and list preservation.

## Verification

- `ptah_ast_analyze` reported `parseStatus: ok` and zero error nodes for all four new files.
- Typecheck, lint and Jest were not run: the batch caller explicitly reserved those checks for the orchestrator.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Store the draft pointer by canonical workspace and workflow mode, with its tab ID in the validated value | One pointer per workspace and mode; one mutable pointer for all workspaces | Design §11 note 9 defines a draft as the kept workflow-tagged tab, and B3a requires one draft pointer with workspace isolation | Yes |
| Keep `HarnessRpcService` unchanged | Add another proposal wrapper; use its existing typed `getProposal(sessionId)` | Existing facade lines 300–310 already provide exactly the session-scoped request needed by hydration | Yes |
| Apply unattributed revisions before attributed turns; insert a user choice after all turns at or before its `chosenAt` | Sort by save time; use captured turn start | Implementation plan line 34 and D9 forbid a late older write from winning; design §5.4 requires strict later-turn precedence | Yes |
| Merge list entries by stable identity before calling the shared config merge helper | Replace each list wholesale; preserve omitted identities | Design §5.4 rule 2 requires stable-ID merge; shared `mergeHarnessConfigUpdates` replaces several arrays | Yes |

## Not done

- Existing state, workflow and message-handler integration remains for B4c and the other assigned batches.
- Orchestrator verification remains pending.

## Fix round 2: degradation audit

- `harness-builder-records.service.ts:234`: Persist failure now logs the caught error through `LoggingService.error` and still returns `false`.
- `harness-proposal-hydration.service.ts:138`: Initial proposal restore failure now logs the caught error and still sets the error status.
- `harness-proposal-hydration.service.ts:181`: Proposal retry failure now logs the caught error and still sets the error status.
- `harness-helper.service.ts:94`: Helper request failure now logs the caught error and retains the plain sidebar error and `false` return.
- `harness-helper.service.ts:170`: Preview commit failure now logs the caught error and retains the visible result, plain error, and `false` return.
- Updated the three corresponding service specs to provide an `error` logger mock. The orchestrator reported harness-builder typecheck, lint, and tests passing before this fix round. No checks were run in this lane, per instruction.
