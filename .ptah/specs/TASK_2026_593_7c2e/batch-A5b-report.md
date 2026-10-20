# Batch A5b — ledger removal

## Result

- Deleted `libs/frontend/notification-center/src/lib/notification-ledger.service.ts`.
- Removed its public export from `libs/frontend/notification-center/src/index.ts`. The `NotificationSnackbarComponent` export remains, per decision #25.
- No `notification-ledger.service.spec.ts` exists, so no spec was deleted.

## Importer search

Searched the entire worktree with `rg -n --hidden` for `NotificationLedgerService|notification-ledger`, excluding `node_modules`, `dist`, `.ptah`, and `.git`.

- Before: `libs/frontend/notification-center/src/lib/notification-ledger.service.ts:122` (declaration) and `libs/frontend/notification-center/src/index.ts:4` (barrel export). No other importer, including specs or apps.
- After: no matches. The service path no longer exists.

## Parity inventory checked

Checked every row in `parity-inventory.md` that names the ledger file: lines **10–12, 14–19, 38–39, 41–43, and 61**.

- Read-all and per-completion dismiss (10–11), successful/neutral completion entries (15, 38): approved removals; the new model uses dismissible Recent notices and `clearAll` for those notices.
- Pending permission/question rows (12), unroutable rows (41), surface ownership (42), per-tab fan-out (43): mapped to the shared Needs you model and request identity/navigation. `NotificationService.needsYou` is the core projection consumed by `NotificationCenterStore`.
- Workspace labels/grouping (14): workspace context moves to attention rows; completion grouping is retired.
- Recent cap and burst merge (16–17): `NotificationService` defines `ATTENTION_RECENT_LIMIT = 75` and `ATTENTION_SOUND_BURST_MS = 350`; its cap applies only to Recent entries, preserving live requests.
- Root announcer and voice-aware sound (18–19, 61): mapped to shell attention announcement and sound presentation; the core service exposes `soundCue`, and the inventory requires the voice-session guard.
- Failed turns (39): mapped to failure attention items, snackbar and Recent notice, with host delivery gated by settings.

The inventory records the replacement or approved removal for each ledger capability. Some inventory rows describe planned source integrations and verification, so this deletion does not by itself establish that all those flows are complete.

## Verification and limits

- Post-edit whole-worktree search: zero matches for `NotificationLedgerService|notification-ledger` under the stated exclusions. AC 8/22 ledger import condition satisfied.
- Scoped `ptah_get_diagnostics` on `index.ts`: no diagnostics in the requested file. It reported two unrelated TS2737 BigInt target errors in `libs/shared/src/lib/types/capability-id-codec.ts:262–263`.
- Did not run Nx, Jest, or tsc, as instructed; the orchestrator owns those checks.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Remove the ledger now | Delete versus retain: whole-worktree search found no importers beyond its own barrel export; plan row A5b assigns deletion; parity inventory accounts for its capabilities. | Yes |

## Not done

No test suite or build was run. No files outside batch A5b scope and this report were edited.
