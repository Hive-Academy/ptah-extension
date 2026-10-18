# Fix round report — TASK_2026_691_1da5

## Files changed

- `libs/frontend/command-center/src/lib/components/command-center-projection.source.ts`
- `libs/frontend/command-center/src/lib/components/command-center-projection.source.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-overlay.component.ts`
- `libs/frontend/command-center/src/lib/components/command-overlay.component.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-work-list.component.spec.ts`

## Items

1. **S2 provider fallback:** `command-center-projection.source.ts:42-51` selects a usage row matching `liveModelStats.model`, then `sessionModel`, then `overrideModel`; `:134` and `:243` use the same helper for child tabs and the root. It returns undefined without a model or matching row and never reads the costliest row by position or `sessionStats.model`. `command-center-projection.source.spec.ts:72-96` places a higher-cost, different-provider row first and verifies the root uses its own model's provider; `:108-110` covers an empty list. Existing live child and root assertions remain at `:~155-260`.
2. **S1 restored-history limit:** `command-center-projection.source.spec.ts:98-106` verifies a matching row with a null provider ID returns undefined. The history reader at `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:1153-1161` has no provider evidence, so genuinely restored history can still show a monogram. Backend and other libraries were outside this fix round.
3. **Plate label ellipsis:** `command-overlay.component.ts:73-83` keeps the provider mark outside an inner `min-w-0 truncate` label span. `command-overlay.component.spec.ts:402-410` checks that structure.
4. **Escape during open delay:** `command-overlay.component.ts:382-391` accepts Escape while the open timer is pending, sets the dismissed hover ID, and cancels the timer. `command-overlay.component.spec.ts:387-400` verifies the preview stays closed after the delay and can reopen after hover ends.
5. **Requested coverage:** `command-work-list.component.spec.ts:146-170` checks each visible state word and distinct Lucide icon groups; `:172-187` checks `animate-spin` with reduced motion off and on. `command-center-projection.source.spec.ts:91-96` checks an unknown `ptahCliId` falls back to the `ptah-cli` mark; `:108-110` checks an empty usage list. The Escape delay test is at `command-overlay.component.spec.ts:387-400`.

## Checks

- `npx nx typecheck command-center --parallel=1 --output-style=static`: `Successfully ran target typecheck for project @ptah-extension/command-center`.
- `npx nx lint command-center --parallel=1 --output-style=static`: `Successfully ran target lint for project @ptah-extension/command-center`.
- Targeted Jest for the three changed specs, `--coverage=false --maxWorkers=2`: `Test Suites: 3 passed, 3 total`; `Tests: 37 passed, 37 total`.

## Decisions

- **Model source:** Chose `liveModelStats.model → sessionModel → overrideModel` over `sessionStats.model` or the first usage row. `TabState` declares these own-tab fields at `libs/frontend/chat-types/src/lib/chat-types.ts:746-770`; the review shows usage rows are aggregate and cost sorted. Reversible.
- **Unknown provider:** Chose undefined/monogram when the matching row lacks provider evidence, rather than guessing from another model. The history reader explicitly lacks that evidence. Reversible if a persisted tab-level provider source is added later.
