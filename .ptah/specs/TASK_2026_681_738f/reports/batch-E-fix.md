# Batch E fix report

## Changes

- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:860,926-932,1103-1108`: describe both compact behaviors accurately; derive forced and user compact states separately; suppress the inspector whenever a compact card is shown.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:8-29,278`: keep the full session region mounted, hidden and inert for a user-selected compact tab. A forced card still tears down that region. The inspector gate uses the corrected `hostsInspector` state.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts:193-194,528,2431-2498`: check hidden transcript and composer, element identity across full/compact/full, inspector restoration, and both expand paths. Existing forced-card assertions still check that no transcript mounts.

## Verification

- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts --coverage=false --maxWorkers=1`: 1 suite passed, 85 tests passed.
- Scoped `ptah_get_diagnostics` after edits reported 266 project TypeScript errors. The reported errors in `chat-view.component.spec.ts` are at lines 1424-2168, outside the edits; no reported error points to the new spec lines or changed TypeScript lines. The HTML file was unrecognised by that diagnostic tool. The focused Jest run rendered the changed template successfully.

## Decisions

- **Compact state:** Use separate `forcedCard` and `userCompact` computeds, with `showCompactCard` as their union. Alternatives were a single gate with template checks or always retaining the session region. The task requires retained DOM for user compact and teardown for Rail hosts; this is reversible.
- **Inspector visibility:** Gate `hostsInspector` on `showCompactCard` and preserve its stored docked-open choice. Alternatives included redirecting Answer through expansion. The hidden full view has no visible question card, so removing the inspector while the card is shown prevents the dead Answer target; this is reversible.
