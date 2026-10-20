# Batch A1 — core attention model

## Files changed

- Created `libs/frontend/core/src/lib/services/attention.types.ts`
- Created `libs/frontend/core/src/lib/services/notification.service.ts`
- Created `libs/frontend/core/src/lib/services/notification.service.spec.ts`
- Created `libs/frontend/core/src/lib/tokens/attention-action-dispatcher.token.ts`
- Updated `libs/frontend/core/src/lib/services/index.ts`
- Updated `libs/frontend/core/src/index.ts`

## Public API for A2–A4

- `AttentionItem`: keyed source snapshot with `generation`, `kind`, `source`, workspace and session ownership, `severity`, `actions`, `actionable`, `soundEligible`, and optional `presentationKey`.
- `AttentionKind`: `'permission' | 'question' | 'lane-permission' | 'failure' | 'warning' | 'info' | 'success'`.
- `AttentionAction`: `{ id: string; label: string; disabledReason?: string }`.
- `AttentionSoundCue`: `{ sequence: number; key: string }`.
- `attentionRequestKey(workspacePath: string, kind: AttentionKind, requestId: string): string`; `attentionConditionKey(workspacePath: string, conditionKey: string): string`.
- `NotificationService` signals: `needsYou`, `badgeCount`, `recentNotices`, `snackbars`, `canClearAll`, `soundCue`. Mutations: `upsert(item: AttentionItem): void`, `resolve(key: string, generation?: number): void`, `dismissPresentation(key: string): void`, `dismissRecent(key: string): void`, `clearAll(): void`, `setSnackbarSuppressed(key: string, suppressed: boolean): void`, `pauseAll(): void`, `resumeAll(): void`, `pauseSnackbar(key: string): void`, `resumeSnackbar(key: string): void`.
- `ATTENTION_ACTION_DISPATCHER: InjectionToken<AttentionActionDispatcher>`; `dispatch(key: string, generation: number, actionId: string): Promise<boolean>`.
- Timing constants: `ATTENTION_RECENT_LIMIT = 75`, `ATTENTION_SOUND_BURST_MS = 350`, `ATTENTION_SOUND_COOLDOWN_MS = 2000`.

The model gives request rows and snackbars separate lifetimes. Clear all hides Recent failure/warning rows and their transient snackbars while preserving live request rows and snackbars. A repeated key/generation does not replay sound. The source sets `soundEligible`; the shell still applies the persisted mute setting. There is no finished-turn kind or finished-turn producer.

## Verification

- `npx nx typecheck @ptah-extension/core --parallel=1`: **failed** (Nx reported `ngc` nonzero; filtered output did not retain its diagnostic). A direct `npx ngc --noEmit --project libs/frontend/core/tsconfig.lib.json` check subsequently returned `NGC_EXIT=0`. The scoped Ptah diagnostic check found no errors in A1 files; it did report errors in existing sibling specs.
- `npx nx test @ptah-extension/core --parallel=1 -- --maxWorkers=2`: **passed**, 43 suites / 1,292 tests.
- After final timer fix, targeted Jest spec: **passed**, 1 suite / 8 tests.
- `npx nx lint @ptah-extension/core --parallel=1`: **passed**, 0 errors / 14 warnings in existing files.
- Degradation audit: **294 before → 294 after** unsuppressed sites.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Model receives source snapshots and exposes signals | Core service vs feature-owned ledger. Plan A1 and component specification require core ownership; later batches own source adapters. | Yes |
| Clear all retains live request presentations | Clear live snackbar vs retain it. Decision #16 and approved design require retention; a regression test covers both live rows and snackbars. | Yes |
| A changed `presentationKey` restores an individually dismissed request snackbar | Restore on every repeated snapshot vs only on material change. Design says repeated events remain deduped and material changes may restore presentation. | Yes |
| One timeout schedules all transient expiries | One per notice vs one for the service. The view can hold up to 75 Recent notices; one timer bounds runtime work and pause/resume preserves remaining time. | Yes |

## Not done

- Chat source adapters, action dispatch implementation, bell and snackbar presentation, host notifications, and routing are assigned to later batches.
- The Nx typecheck target's initial nonzero result remains unexplained by its filtered output, although the same `ngc` command completed successfully on direct execution after the edits.
