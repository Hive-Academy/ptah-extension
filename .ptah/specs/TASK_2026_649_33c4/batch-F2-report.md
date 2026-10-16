# Batch F2 correction report

## N1 — Windows pinned root

- `harness-workflow-request.service.ts:77-83` exposes the raw active workspace path while retaining the canonical key; `harness-builder-view.component.ts:355` uses the raw path when a VS Code tab has no workspace path. The initialize response check already canonicalizes both roots (`harness-builder-view.component.ts:483`).
- `workspace-authorization.ts:6-30` adds one root equality/open-folder lookup using the platform path implementation, normalized resolved paths, case folding only on Windows, and trailing separator handling. `harness-rpc.handlers.ts:373-398,501-513` uses the matching open folder's original path for initialize context, response, and apply writes. `harness-proposal-store.service.ts:209` uses the same equality rule for stored roots. `harness-rpc.schema.ts:73,208,217` uses Windows path rules when the host is Windows.
- Specs: `harness-rpc.handlers.spec.ts:634` (Windows initialize); `workspace-authorization.spec.ts:36` (root equality); `harness-proposal-store.service.spec.ts:85` (stored case); `harness-builder-view.component.spec.ts:305` (null workspace path and raw RPC root). Existing apply specs were updated for the new open-folder guard.

## N2 — Unattributed revision precedence

- `harness-proposal-hydration.service.ts:365-391` reapplies a user's selected field after an unattributed revision touches it. Revision order remains unchanged; a later attributed turn can still supersede a choice.
- Spec: `harness-proposal-hydration.service.spec.ts:155` covers attributed turns on both sides of the choice followed by a later unattributed write.

## N3 — Resume composer and Hub status

- `harness-workflow-request.service.ts:58,75,247-258` retains the resumed intake per tab and requests composer prefill. ChatInput's existing `restoreContentToInput` guard leaves nonempty typed text unchanged; the builder displays the retained summary at `harness-builder-view.component.ts:209,336`, so a refused prefill does not lose the intake. `setup-hub.component.ts:1366-1377,1489,1511` clears stale Hub errors on landed/resumed navigation, including intake entry, and does not report resume as an error.
- Specs: `harness-workflow-request.service.spec.ts:204-226` (retained intake and no Hub error); `harness-builder-view.component.spec.ts:318` (visible intake); `setup-hub.component.spec.ts` (resumed navigation clears stale error).

## N4 — Get-proposal authorization

- `harness-rpc.handlers.ts:928-938` resolves a requested root against open folders before resolving or touching the proposal store. The store receives the open folder's own path. A non-open root throws.
- Spec: `harness-rpc.handlers.spec.ts:1190` covers a mixed-case Windows root with trailing separator and a non-open root rejected before `store.get`; the existing initialize non-open-root spec remains at `:620`.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep the resumed intake visible on its builder page while requesting composer prefill | Read/append through a public chat draft API; retain the intake on the builder | `ComposerDraftStore` is internal to chat and not exported by its public API; `ChatInput.restoreContentToInput` refuses to replace nonempty text, while ChatView consumes the request. This preserves typed text and keeps the intake available without editing chat outside scope. | Yes |
| Use exact open-folder equality for pinned roots and the folder's original spelling for operations | Containment check; equality check | `isAuthorizedWorkspace` permits descendants; pinned workspace operations require one open folder. The existing workspace authorization utility is the local place for the shared equality helper. | Yes |

## Verification

- Project tests/build/typecheck were not run, per the explicit orchestrator rule.
- Scoped `ptah_get_diagnostics` was called after edits, but the TypeScript service timed out after 45 seconds and returned no diagnostics. Sampled AST analysis reported zero syntax errors. The orchestrator should run the changed specs.

## Clarifications Needed

None.
