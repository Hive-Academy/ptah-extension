# P2 review fix: live gate and secrets

## Finding 7 — live gate

- Persisted a Zod validated repository gate record with first `connectedAt`, latest `verifiedAt`, bot login, attesting maintainer, timestamp, and exact permission list in the operator settings JSON. Existing settings reads remove the gate metadata before parsing (`libs/backend/review-core/src/lib/persistence/review-settings.store.ts:15`, `:32`, `:91`). Regression: `review-settings.store.spec.ts` round trip and clear.
- `review:updateSettings` requires a current successful GitHub `/user` check, repository matching identity, and an allowlisted attestor before enabling live mode. Live `review:rerun` repeats the identity check; token replace and clear erase the gate (`libs/backend/rpc-handlers/src/lib/handlers/review-rpc.handlers.ts:61`, `:102`, `:125`, `:157`). Regression: `review-rpc.handlers.spec.ts` live rejection and token clearing; suite 25/25.
- Electron's `mayPublish` checks token presence, gate attestation, repository, and current maintainer allowlist before a mutation (`apps/ptah-electron/src/di/phase-2-libraries.ts:408`). The existing head, eligibility and policy checks remain. Permission attestation is an operator statement; fine-grained PAT permission verification is not claimed.
- Live enable, pause resume, and live rerun dialogs require the explicit permission checkbox. The settings drawer records the maintainer's login and sends the attestation in the Zod RPC payload (`libs/frontend/review-runs-ui/src/lib/components/review-confirm-dialog.component.ts:12`, `review-settings-drawer.component.ts:27`, `review-runs.store.ts:174`). Frontend store suite 11/11.

## Secret storage and finding 9

- Added optional storage mode to the platform secret port and exposed Electron safeStorage availability (`libs/backend/platform-core/src/interfaces/secret-storage.interface.ts:10`, `libs/backend/platform-electron/src/implementations/electron-secret-storage.ts:39`). `review:getSettings` and successful `review:getBotIdentity` report only `encrypted` or `plaintext`; the drawer persistently warns on plaintext (`libs/backend/review-contracts/src/lib/review-rpc.schema.ts:24`, `libs/frontend/review-runs-ui/src/lib/components/review-settings-drawer.component.ts:38`). Secret storage suite 29/29.
- Electron review environment returns the stored bot token to publication redaction without logging it (`apps/ptah-electron/src/services/review/electron-review-environment.ts:33`), wired by `phase-2-libraries.ts:432`. Environment suite 7/7.
- First successful connection time persists in the gate record; later successful checks update `verifiedAt` only (`review-rpc.handlers.ts:88`). OAuth scopes display only when GitHub supplies them (`review-settings-drawer.component.ts:39`).

## Decisions

- Stored gate metadata in the existing settings JSON to avoid a database migration. The Zod RPC schema lives in `review-contracts` and the optional storage mode lives in `platform-core`; these two files were necessary contract edits beyond the named allowed paths.
- Operator attests Pull requests: Read and write, Contents: Read, and Metadata: Read. No claim of verified fine-grained PAT permissions.
- Linux without keyring keeps the existing plaintext fallback and displays its state to the operator.

## Verification and remaining checks

- Focused Jest: RPC 25/25, frontend store 11/11, settings persistence 1/1, Electron environment 7/7, Electron secret storage 29/29.
- Scoped Ptah TypeScript diagnostics could not complete: worker exceeded its heap limit. Orchestrator should run scoped typecheck and all four Electron DI/surface guards, then inspect the Electron settings and rerun dialogs and perform a canary dry run. No Electron screenshot was possible because starting the host was prohibited for this lane.
