# Attention cards — revision round 1

## Defects fixed

| Defect | Change | Spec cases |
| --- | --- | --- |
| Session line fabricated a name from the request kind | `libs/frontend/notification-center/src/lib/notification-center.component.ts:116-118` and `notification-snackbar.component.ts:142-144` now use `item.sessionTitle || 'Session unavailable'`. The kind remains in its separate label. | `notification-center.component.spec.ts:105` and `notification-snackbar.component.spec.ts:47` render requests without `sessionTitle` and assert that the main line reads `Session unavailable` while the kind label remains visible. |
| Snackbar visibility broke the retained 3/1 contract | `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:96-103` initializes the desktop limit to three and changes it to one only when viewport width is at most 900px. Height no longer changes the limit. | `notification-snackbar.component.spec.ts:119` checks three cards plus overflow at 1200px; `:177` checks one card at exactly 900px; `:193` checks that a 600px tall, 1200px wide viewport keeps both available cards visible and that opening the bell hides them. |

## Decisions

- Kept the existing top-right placement and `--ptah-snackbar-top` offset. The prior two-card cap was the only overlap mitigation; restoring three cards removes that mitigation. No alternative placement was introduced in this scoped revision, so Electron Stats overlap still needs visual review.
- Kept `+N more` as the overflow route to the bell and the existing panel-open suppression.

## Verification and limits

`git diff --check` found no whitespace errors. Scoped `ptah_get_diagnostics` found no errors in the four changed notification-center files; it reported five existing BigInt target errors in shared sibling files. Nx, Jest, TypeScript, lint, build, and Electron visual checks were not run, as instructed.
