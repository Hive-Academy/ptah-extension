# Phase 2 frontend review fixes

## M1 Context percentage gate

- `libs/frontend/chat/src/lib/services/session-inspector/session-inspector.store.ts:139` and `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:273` now use `sessionContextCue(live).known` before calculating a context percentage. Unknown context stays `null`.
- Regression cases at `session-inspector.store.spec.ts:118` and `compact-session-card.component.spec.ts:831` cover a live window that differs from its trusted window.

## M2 Restored session turns

- `libs/frontend/chat/src/lib/services/session-inspector/session-inspector.store.ts:102` returns `null` when a restored session has no host turn count and no loaded messages.
- Regression case at `session-inspector.store.spec.ts:166` covers the empty restored tab.

## M3 Background reconcile

- `libs/frontend/chat/src/lib/settings/pro-features/system-prompt-drawer.component.ts:398,407,463` uses a background option for coarse reconciliation, leaving `isLoading` false and the body mounted during the RPC. Initial open and manual checks retain their loading behavior.
- Regression case at `system-prompt-drawer.component.spec.ts:558` holds the status RPC pending and verifies the metadata node remains mounted and the loading body is absent.

## Verification

Ran `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="session-inspector.store|compact-session-card|system-prompt-drawer" | Select-Object -Last 60` (exit 0). Last result lines:

```text
 NX   1 task: 1 succeeded
 Run duration:      15.0s
 Cache:             0/1 hit (0%)
 Critical path:     14.9s (1 task)
 [verify 2026-10-30T22:37:27.748Z] lock released after 27.4s, exit code 0
```

Scoped `ptah_get_diagnostics` was attempted twice after edits; both calls reported the TypeScript compiler unavailable because the check was still running after 45 seconds, leaving six files unchecked by that tool.

## Decisions

- Keep the existing `contextFillPercent` values in the inspector and compact card after applying `sessionContextCue(...).known`. The pinned F2 specs expect 65% from 130,000 of 200,000 tokens while their fixture's host `contextPercent` is 0. Using the cue's `percent` directly would change those expected numbers. Reversible: yes.
- Use an optional `background` argument on `loadStatus` and `checkRegenerate`. The coarse effect is the only background caller; the existing initial and manual callers use the default. Reversible: yes.

## Not done

No work outside M1, M2 and M3 or the six allowed source and spec files. The scoped diagnostics tool did not return a TypeScript result; the required focused Jest verify command passed.
