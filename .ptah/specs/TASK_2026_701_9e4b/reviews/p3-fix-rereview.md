# P3 fix-round re-review

Scope: L1, L2, L3, D41(c), and the S1/S2 extraction only. Reviewed the supplied fix patch, previous logic review, fix reports, and changed source context. Paths below are relative to the worktree; line numbers refer to current source.

1. **L1 — RESOLVED.** `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts:720` awaits replacement decisions before checking the replaced list. At :729 it retains the activation result only when nothing was replaced; otherwise it awaits a full `reconcileHarness` pass and returns that pass's `libraryPass` at :760. The pass uses the default options (no skipped user-layer refresh) at :1184. Failed propagation and thrown errors become `failed` at :1195 and :1202 without changing primary install success. The added handler cases cover ordering and final-pass failure. They use mocked propagation, so they do not independently demonstrate actual Electron mirror/catalog bytes.

2. **L2 — RESOLVED.** `libs/frontend/marketplace/src/lib/data/marketplace-inventory.store.ts:432` consumes `LibraryChangeFeed`. Its handler at :552 clears the command-discovery cache and reloads previously requested slices through :491. The existing slice/workspace generation checks at :522 reject superseded replies. Library clones retain their response `scopeRoot` at :598; failed-pass state is updated only after a publishing plugins read whose root matches the push (:556). Workspace changes clear that state (:421). The installed page mounts the C10 notice at `libs/frontend/marketplace/src/lib/pages/skills/installed-skills-page.component.ts:142`.

3. **L3 — RESOLVED.** `libs/frontend/marketplace/src/lib/external-marketplaces.component.ts:888` and :906 set only a boolean for failed RPC envelopes and thrown errors. `libs/frontend/marketplace/src/lib/external-consent-dialog.component.ts:458` renders fixed failure/retry copy; the input at :523 no longer accepts backend error strings. Neither confirm failure branch interpolates the raw error into the dialog.

4. **D41c — RESOLVED.** `libs/frontend/marketplace/src/lib/pages/skills/plugin-config-home-notice.component.ts:233` captures the action's workspace generation and :245 forwards the successful response's `libraryPass` before reloading inventory. `libs/frontend/marketplace/src/lib/data/marketplace-inventory.store.ts:467` rejects old-workspace responses and records `failed` for Electron. `libs/frontend/marketplace/src/lib/pages/skills/installed-library-stale-notice.component.ts:20` renders the non-fatal C10 notice from this state, including when adoption succeeded but its Library pass failed.

5. **S1/S2 extraction — RESOLVED.** Compared the removed handler helpers with `libs/backend/rpc-handlers/src/lib/handlers/marketplace/plugin-local-items.service.ts`. Planning retains root handling, slug fallback, approval lifetime, and plan attachment (:92). Decision application retains plan-only IDs, default Keep, unknown-ID reporting, and error fallback (:132, :233). Save reporting preserves newly enabled/undenied selection, source identity, item families, and optional-report degradation (:185, :261, :284). The shared kind-to-reason map at `libs/backend/rpc-handlers/src/lib/handlers/marketplace/marketplace-local-items.service.ts:354` matches the removed map. Constructor injection and shared singleton registration are wired at `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts:226` and `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts:105`. No behavioral regression identified from the extraction.

## New Blocking/Serious defects

None identified in the scoped fixes.

## Review limits

Static review only. No git commands, builds, tests, or verification runs were performed. Implementer verification claims were not independently reproduced. Approval is limited to this fix round, not the deferred P3 gaps or a runtime/visual certification.

Verdict: APPROVED — 9/10
