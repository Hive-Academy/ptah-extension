# P3 independent code-logic review

Score: **5/10**. Verdict: **REVISE** (role verdict: NEEDS_REVISION).
**2 Blocking, 1 Serious, 0 Moderate, 3 confirmed failure modes.**

Scope: TASK_2026_701_9e4b, Batches 19–25, supplied p3-be.patch, p3-fe.patch and the setup-wizard entry/routing hunks of p3-sw.patch. Citations below are post-change paths relative to the worktree. This is a targeted static review, not approval of every file in these large patches.

## Findings

1. **Blocking — external-install replacements happen after the last Library refresh.**

   **Location:** `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts:727` (also :722, :754, :1042).

   **Failure scenario:** An external plugin supplies an agent whose workspace source already exists. The user explicitly chooses Replace. The handler first activates the plugin and awaits propagation, including the Library pass, then applies the approved replacement. The agent-source branch writes the new source at `libs/backend/rpc-handlers/src/lib/handlers/marketplace/install-local-items.service.ts:284`. Nothing in the external-confirm path requests another pass; its response instead returns the earlier `activation.libraryPass`.

   **Impact:** The report can say the item was replaced and the Library updated while the Library still contains the pre-replacement agent. This is a silent failure of the requested shared write/Library behavior. It also affects rebased clones whose metadata/catalog and propagated target copies need the post-write pass. A later unrelated refresh may heal it, but the install itself has not completed the promised flow.

   **Reader trace:** `libs/backend/harness-sync/src/lib/propagation/harness-propagation.service.ts:139` awaits the user-layer refresh before reconciliation. Electron's pass mirrors, reconciles and syncs the catalog at `apps/ptah-electron/src/activation/plugin-activation.ts:598`, :601 and :609, then broadcasts at :619. All of that precedes the replacement in this handler. The no-dialog replacement route already handles the required post-write pass at `plugin-rpc.handlers.ts:1167`.

   **Suggested fix:** After applying external plan decisions, run an awaited pass when replacements occurred, and report the result of that final pass. Keep primary install success if that pass fails, with `libraryPass: 'failed'`. Add an ordering/behavior case that replaces an agent source and verifies that the subsequent mirror/catalog read sees its new bytes; the existing mocked confirm case at `plugin-rpc.handlers.spec.ts:1822` establishes install-before-replace but does not establish refresh-after-replace.

2. **Blocking — Marketplace inventory never consumes Library-change notifications, leaving successful-looking stale rows.**

   **Location:** `libs/frontend/marketplace/src/lib/data/marketplace-inventory.store.ts:377` and :387; `libs/frontend/marketplace/src/lib/pages/skills/installed-skills-page.component.ts:535`.

   **Failure scenario:** Load Skills & Plugins once, then generate a workspace agent with the same slug as a plugin agent, or change plugin/Library state elsewhere in the same workspace. The backend broadcasts `library:changed`, but neither the Marketplace inventory nor installed page subscribes to `LibraryChangeFeed`. The store reloads for workspace-generation changes (:377) or explicit Marketplace notifications (:411). Returning to the page only calls `ensure`, which does nothing for an already-ready slice (:387).

   **Impact:** The new shadow/provenance/orphan facts remain stale until a manual refresh or another local action. The row and inspector continue presenting the old state as ready; a failed background Library pass also has no push-driven C10 notice on this page. This is separate from D41's known adopt-response C10 gap.

   **Evidence:** The feed publishes at `libs/frontend/marketplace/src/lib/services/library-change-feed.ts:59`; the only production consumer found in these two frontend libraries is `libs/frontend/skill-synthesis-ui/src/lib/services/skill-clones-state.service.ts:169`. The installed view derives its facts from cached clones at `installed-skills-page.component.ts:449` and :457. Those clones are only fetched in the inventory's plugin loader at `marketplace-inventory.store.ts:480`. The feed's own contract at `library-change-feed.ts:24` explicitly describes installed-view/inventory consumers that are not wired.

   **Suggested fix:** Subscribe the inventory to the feed, invalidate/reload previously requested relevant slices, retain workspace/request-generation guards, and expose a root-scoped failed-pass notice to the installed page. Test a same-workspace push both while the page is mounted and after it has been visited and unmounted; also test a foreign-root failure and a workspace switch during the read.

3. **Serious — D40 consent failure copy renders raw filesystem/backend errors.**

   **Location:** `libs/frontend/marketplace/src/lib/external-marketplaces.component.ts:883` and `libs/frontend/marketplace/src/lib/external-consent-dialog.component.ts:461`.

   **Failure scenario:** The external install fails with EACCES/ENOSPC during a local file write or removal. The installer rethrows the filesystem exception at `libs/backend/plugin-marketplace/src/lib/install/external-plugin-installer.service.ts:326` (the initial removal at :304 can also throw). The handler logs and rethrows it at `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts:1448`. The RPC envelope serializes its original message at `libs/backend/vscode-core/src/messaging/rpc-handler.ts:252`. The frontend assigns that string to `consentError` and interpolates it into the dialog.

   **Impact:** Users see internal error text, including absolute local paths and OS details, despite the no-raw-errors requirement. Angular interpolation escapes markup but does not redact error content. This establishes the leak D40 explicitly asked this review to check; it does not claim an observed credential leak.

   **Suggested fix:** Render fixed actionable consent-failure copy, or map an allowlisted error code to safe copy. Keep the original diagnostic in backend logs. Apply the same rule to the thrown-error branch at `external-marketplaces.component.ts:901`. Verify with an error containing a sentinel absolute path that the path never appears in the dialog.

## Five logic questions

1. **How does this fail silently?** Findings 1 and 2: a prior refresh status is reported for later writes, and cached Marketplace facts remain ready after a push.
2. **What user action produces unexpected behavior?** Choosing Replace for an external plugin agent can leave the Library on its previous bytes (finding 1). Visiting Marketplace, generating elsewhere, and returning preserves stale shadow/orphan facts (finding 2).
3. **What input data gives a wrong answer rather than an error?** An existing agent source with a matching approval digest and a different plugin version exercises finding 1; a same-slug workspace/plugin agent exposes finding 2.
4. **What happens when a dependency fails, times out, or returns a wrong shape?** Ordinary install I/O failures reach raw UI copy (finding 3). Malformed Library pushes are explicitly rejected at `library-change-feed.ts:67`; expired/cross-root approvals are rejected at `local-item-approvals.ts:124`. No dynamic malformed-response or timeout experiment was run.
5. **What is missing that requirements did not spell out?** A replacement is not complete at the final filesystem write: its final mirror/catalog pass and notification must describe those bytes. The external route needs the same ordering guarantee already present in the no-dialog route (finding 1).

## Write-to-reader audit

- External plugin files: `external-plugin-installer.service.ts:320` writes files and :329 records the install; `plugin-rpc.handlers.ts:1031` saves enablement before :1042 requests propagation.
- Approved agent source: `install-local-items.service.ts:284` writes the workspace agent; Electron mirror/catalog consumption is described in finding 1. The missing post-write pass is the identified break.
- Approved clone: `clone-rebase.service.ts:129` invokes the mirror write, then :136 clears registry divergence/pending state. External confirmation still needs to propagate the final result (finding 1).
- Approved destination repairs: `install-local-items.service.ts:177` passes the server-held digest to repair. The no-dialog caller requests a final pass at `plugin-rpc.handlers.ts:1171`; the external caller does not.
- Config-home adoption: `plugin-rpc.handlers.ts:1217` adopts before requesting reconciliation at :1222 and returning the reread status at :1238. D41 already tracks the UI handling gap; it is not a new finding here.

## Verification and limits

Read the task carrier, context, relevant requirements/plan and Batches 19–25, D34/D39/D40/D41, root instructions, patch hunks and post-change source around the traced paths. Read approval-registry and replacement-service logic and the clone-rebase flow, and inspected RPC schemas, feed/state guards, installed-page loading and the setup-wizard composition entry/routing change. No P3 code-style review was present in the discovered review files; no style findings are included.

No source edits, git operations, installs, builds or test suites were run. Batch verification claims are recorded in `batches.md`, but were not independently reproduced. Scoped `ptah_get_diagnostics` for the replacement service and Library feed returned **unavailable**: its TypeScript check exceeded 45 seconds and left both files unchecked. This is not a clean diagnostic result. `ptah_code_search_symbols` returned zero hits for RpcHandler; file search/native targeted reads were used to locate the serializer.

The review does not certify every file in the supplied patches, all host wiring, or adversarial filesystem races/symlink containment. Those remain verification limits, not invented defects. Score 5 reflects concrete cross-layer gaps despite implemented approval binding and request guards; it is below 7–8 because the user-facing write/refresh contract is incomplete, and above 3–4 because the examined approval and boundary mechanisms exist and the confirmed defects have localized fixes.

## Decisions

- **D41 exclusions:** Do not re-report kept-file row/inspector notes, the turned-off edited-copy footer, or adopt-result C10 handling. Options: reopen them or respect the recorded follow-up. Evidence: decisions.md D41. Reversible: yes.
- **D40 error policy:** Recommend fixed/allowlisted copy, rather than preserving arbitrary RPC reason text. Evidence: the complete filesystem-error-to-dialog trace in finding 3 and D40's explicit review condition. Reversible: yes; this report does not change code.
- **Severity:** Findings 1–2 are Blocking under the role's definition of a silent failure that misleads a user; finding 3 is Serious for a probable dependency failure with unsafe error presentation. Options: downgrade stale-display failures or apply the supplied definition. Evidence: cited producer/consumer paths. Reversible: yes.
- **Scope:** Deliver a revision verdict on confirmed failures, not broad approval of unread files. Options: infer correctness from passing batch claims or report static-review limits. Evidence: supplied large patches, no-test constraint and unavailable diagnostics. Reversible: yes through follow-up review.

