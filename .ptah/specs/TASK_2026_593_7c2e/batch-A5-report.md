# Batch A5 — shell mounts

## Files changed

- `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`: mounted one snackbar host next to the Electron global bell and announcer; connected its input/output to the bell's open state.
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts` and `app-shell.component.html`: mounted one VS Code snackbar host outside the retained row, gated it off in Electron, connected it to the retained bell, and removed eager ledger injection. The snackbar's overflow action returns to chat to open a detached bell.
- `libs/frontend/chat/src/lib/components/templates/electron-shell.notification-center.spec.ts` and `app-shell.notification-center.spec.ts`: assert the single bell and snackbar mounts and bindings.
- `libs/frontend/chat/src/lib/components/templates/app-shell.retained-chrome.spec.ts`: removed ledger-era completion assertions; preserves retained row coverage and verifies a persistent snackbar host plus bell opening and panel-state wiring.
- `libs/frontend/chat/src/lib/components/templates/app-shell.previous-sessions.spec.ts` and `app-shell.auth-redirect.spec.ts`: removed ledger imports and mocks.
- `libs/frontend/notification-center/src/index.ts`: exported `NotificationSnackbarComponent`; retained the ledger export for A5b.

## Verification

- `npx nx typecheck @ptah-extension/chat --parallel=1`: **failed** only in A7-owned `libs/frontend/chat/src/lib/services/chat-attention-host-message-handler.service.ts` at lines 86 (TS2345, `attention:getSnapshot` absent from `RpcMethodRegistry`) and 91 (TS2590 twice). No A5 file diagnostic appeared. The scoped `ptah_get_diagnostics` service twice timed out after 45 seconds, so it provided no additional result.
- Requested template Jest run: 19 suites and 215 tests passed; four retained-chrome tests initially failed because the shell queried a component reference as an element. The query now explicitly reads `ElementRef`. A focused rerun passed 11/11 retained-chrome tests, including the new open-state interaction. The four other changed shell specs passed 33/33 tests in a separate focused run. The entire template directory was not rerun after the fix.
- `npx nx lint @ptah-extension/chat --parallel=1`: passed with 65 warnings, zero errors.
- No-alpha Jest spec: passed, 11/11 tests.
- Degradation audit: **296 unsuppressed sites** versus baseline **294** (exit 1). A5 added no catch/fallback site; `app-shell.component.ts` retains its pre-existing silent `.catch(() => {})`. The excess sites are outside the A5 edits; no baseline was changed.
- A targeted search found no `NotificationLedgerService` or `notification-ledger` references in the A5 shell components or their shell specs.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Observe the bell button's `aria-expanded` attribute to drive `panelOpen` | A3's bell has no public open-state input/output, and A5 cannot edit its component. The accessible attribute changes on every open/close path, including Escape and outside click. One observer per active shell is disconnected with the Angular effect cleanup. | Yes, replace when the bell exposes a public signal/output. |
| Keep the VS Code snackbar outside the retained row and gate it with `!isElectron` | The bell row detaches on standalone surfaces, while the shell announcer already lives outside it. Electron embeds `AppShellComponent` and owns its own global bell. This leaves one host per active shell. | Yes. |

## Remaining

- A5b owns ledger file and barrel export removal.
- A7/shared wire owner must resolve the `attention:getSnapshot` typecheck errors before the chat project typecheck can pass.
