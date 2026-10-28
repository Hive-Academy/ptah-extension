# Frontend implementation — `TASK_2026_701_9e4b`, batch 24

**Verdict**: COMPLETE. Scoped verify: 5 of 6 tasks passed. The one failure is the accepted
pre-existing `ptah-extension-webview:lint` (D19, circular dependency at `app.routes.ts:224`).

**Tasks completed**: 24.1. This covers the consent dialog local-files section, the install report
counters and the `KeptItemsRepairPromptComponent`.

## Files

All paths are under `libs/frontend/marketplace/src/lib/`.

- MODIFIED `external-consent-dialog.component.ts`
  - Adds the local-files section, C1 rows and C4 bulk bar.
  - Resets choices per plan.
  - `confirmed` now emits decisions.
  - Adds the "Install failed" copy, "Retry install", the keyboard trap and `aria-busy`.
- MODIFIED `external-consent-dialog.component.spec.ts`
  - The 14 existing cases are kept.
  - Adds the failure/Retry case, the local-files section cases (7) and the keyboard trap cases (3).
- MODIFIED `external-install-report.component.ts`
  - Adds the Written/Kept/Shadowed/Skipped counters and the Kept list with reasons.
  - Adds a "Review and replace…" button per repairable family.
  - Adds C10.
- CREATED `external-install-report.component.spec.ts` (8 cases).
- CREATED `kept-items-repair-prompt.component.ts`, which contains:
  - `KeptItemsRepairPromptComponent`;
  - `MarketplaceKeepReplaceComponent`, the marketplace-local copy of C1 (A-share);
  - `ModalFocusTrap`;
  - the shared copy helpers.
- CREATED `kept-items-repair-prompt.component.spec.ts` (13 cases plus 2 helper cases).
- MODIFIED `external-marketplaces.component.ts`
  - Sends `localItemDecisions`.
  - Hosts the repair prompt.
  - Drops replaced items from the report.
  - Sets C10 to Electron only through `VSCodeService.isElectron`.
- MODIFIED `external-marketplaces.component.spec.ts`
  - Adds 3 cases: decisions sent, failed confirm keeps the dialog with Retry, and the repair route end to end.

No other file was edited.

## Quality requirements -> evidence

| Requirement | Where |
| --- | --- |
| Every existing consent block stays | `external-consent-dialog.component.ts`: re-approval banner, footprint, scripts, MCP verbatim plus env names, skipped files, shadowed (`:350`). The markup is unchanged apart from one added sentence in the banner (`:202`). The 14 existing spec cases pass unchanged. |
| New section after the shadowed block, before the error | Section at `:366-455`, error at `:458-466`. Spec "sits after the shadowed block and before the error" checks the text order. |
| Label suffix only when N > 0 | `confirmText` `:590-600`: "Install X" / "Update X" + " and replace N file(s)". Spec covers N = 0, 1 and 4. |
| Rows with the four reasons + "Edited Library copy" + agent-source | `localItemCopy` near the top of the file (unowned / owned-edited with the `recordedVersion` note / unreadable / library-clone "Keep my copy"/"Replace (rebase)" / agent-source) |
| Forced Keep for unreadable | `isForced` `:608`, `decisionOf`, `setDecision`, `setAll` skip it. C1 sets `aria-disabled` on Replace (`kept-items-repair-prompt.component.ts:171` ff.). Specs cover click and Replace all in both the dialog and the prompt. |
| Re-approval resets to Keep | `decisions = linkedSignal({ source: this.plan, computation: () => ({}) })` `:557`. The banner adds "Every choice is reset to Keep." `:202`. Spec "resets every choice to Keep on re-approval". |
| `confirmed` emits decisions keyed by `approvalId` | `output<Record<string, FileDecision>>()` `:523`, `confirm()` `:633`. The parent forwards them as `localItemDecisions`, and only when the plan listed items (`external-marketplaces.component.ts:860-877`). Specs cover the dialog and the parent. |
| Modal keyboard trap | `ModalFocusTrap` (`kept-items-repair-prompt.component.ts:255-310`): focus goes to the first stop after render, Tab/Shift+Tab wrap, and focus returns to the opener on destroy. Dialog `onKeydown` `:642`: Escape cancels, but not while busy. Specs cover the wrap, Escape and focus restore. |
| Failed confirm keeps the dialog open with "Retry install" | Parent keeps `pendingPlan` on failure (unchanged). `confirmText` returns 'Retry install' `:594`. Dialog `callout` copy: "Install failed. … Ptah removes what it wrote … then retry." `:461`. The parent spec checks that Retry re-sends the same decisions. |
| Busy state | `aria-busy` `:146`, rows and bulk disabled while busy |
| Counters Written/Kept/Shadowed/Skipped | `external-install-report.component.ts:191-199`, `<dl>` markup. The existing header and named skipped/shadowed lists are kept, so the storefront spec stays green. |
| "Kept (your files were not changed)" + reasons incl. "Kept: changed since approval" | `:113-150`, plus a note for unreadable and changed-since-approval |
| "Review and replace…" opens the prompt | Report `reviewKept` emit at `:146`. Parent `openRepair` `:937` opens `<ptah-kept-items-repair-prompt>` (`:467`). |
| Repair prompt bound to the opening family | `familyItems` `:537` filters by `family()`. The dialog carries `data-family`. The replace label comes from `familyReplaceLabel`. The `it.each` spec covers skills.sh `tailwind-v4/SKILL.md`, plugin-enable `release-notes/SKILL.md` + forced-Keep `release.md`, and plugin-agent `.claude/agents/release-manager.md` (Keep checked, "Replace 1 file"). |
| Prompt calls `plugins:replace-kept-items` via ClaudeRpcService | `confirm()` `:640-670`, with an explicit timeout (`MARKETPLACE_RPC_TIMEOUTS.PLUGIN_INSTALL_MS`). Zero replacements: "Close without replacing" makes no call. Result rows show Replaced, or Kept with a reason. |
| C10 (Electron) | Report `:154-160` and prompt, shown only when `showLibraryNotice && libraryPass === 'failed'`. The parent passes `isElectron()` (`:583`). |
| Agreement fixtures from `@ptah-extension/shared/testing` | `makeLibraryAgreementFixtures()` is used in all four specs (Acme Toolkit, Ptah Release Kit, tailwind-v4 names and agents) |
| Angular rules | Standalone, OnPush, `inject()`, `input()`/`output()`, `signal`/`computed`/`linkedSignal`. No `[innerHTML]`. No `any`, `@ts-ignore` or `as unknown as`. Imports go only through `@ptah-extension/{core,shared,chat-ui}`. |
| Never render raw errors | Repair prompt: a thrown error gets fixed copy, and a per-item `error` is shown only as "Kept: could not replace". Specs check that `EACCES` and `socket` are absent. The dialog shows the RPC's user-facing `result.error` inside fixed design copy. See open issue 2. |

## Decisions

- **Where C1 lives.** A-share wants a marketplace-local C1 copy, but the batch allows only
  `kept-items-repair-prompt.component.ts` as a new source file. So `MarketplaceKeepReplaceComponent` and
  `ModalFocusTrap` are exported from that file, and the consent dialog imports them.
  - Other options: a separate `marketplace-keep-replace.component.ts`, which is outside the file list, or
    duplicating the markup in two templates.
  - Reversible: yes. Move them into their own file, or into `@ptah-extension/ui` at the third use.
- **The repair route skips the `external` family.** The backend refuses `external` approval ids on
  `plugins:replace-kept-items` (`plugin-rpc.handlers.ts:113-123`, `KEPT_REPORT_FAMILIES`, R1-3/A30).
  So the install report offers "Review and replace…" only for `skills-sh` / `plugin-enable` /
  `plugin-agent` kept items, and not for unreadable ones. External-family kept items are listed with
  their reason, and changed-since-approval says "Install again to review it." (prototype copy).
  - Other option: show the button for every family. It would always fail for external items.
  - Reversible: yes. See `REPAIRABLE_FAMILIES`.
- **Copy for `agent-source` rows.** The design has no copy for these rows. I used the badge "Workspace
  agent" and the note "An agent in this workspace has the same name as the plugin's agent. If you keep
  it, the plugin's agent stays shadowed."
  - Reversible: yes.
- **Escape is ignored while the install runs.** This matches the disabled Cancel and X buttons. Before
  this change, Escape closed the dialog mid-install.
  - Reversible: yes.
- **Updates after a replace.** When the replace succeeds, the parent removes the replaced items from
  `lastInstall().kept`, so the report counters update.

## Verification

Command (run once):
`npm run verify -- -p @ptah-extension/marketplace,ptah-extension-webview`

- `exit 1`
- `NX   6 tasks: 5 succeeded, 1 failed`
- `✖ nx run ptah-extension-webview:lint`. The full log has a single error:
  `224:7 error Circular dependency between "ptah-extension-webview" and "@ptah-extension/command-center"`.
  This is the accepted D19 failure.
- The marketplace lint, test and typecheck targets and the webview test and typecheck targets passed. The
  dynamic output style printed no "Running target … for N projects" header. The 6-task total covers 3
  targets for each of the 2 requested projects.
- `ptah_get_diagnostics` reports no errors in the changed files. The errors it lists in sibling files
  already existed.

## Plan deviations

- Plan (b) says "Review and replace…" opens (h) from the install report. Because of the backend refusal
  described above, it opens only for non-external families. A real external install reports only
  `external` kept items, so in practice this report shows no button today. The prompt is fully built and
  tested for all three no-dialog families, ready for the Batch 25 installed-view note and other entry
  points.
- The design 3.3 failed-install report ("Written before the failure: N. Removed again: N.") is not
  rendered. `ExternalInstallResult` has no failure shape, and a failed confirm stays in the dialog
  instead (plan (g)).
- The "N other files are new or unchanged and install without a question." line is not rendered. The plan
  gives no reliable count: `fileCount` is per plugin file, while `localItems` are per target copy.

## Open issues

1. Orchestrator decision. An external install's kept items cannot be replaced afterwards except by
   installing again. This is how the backend behaves (A30), but it should be confirmed against design 3.3.
   The design says the install report offers "Review and replace…", and the backend refuses that route
   for external ids.
2. The consent dialog still shows the RPC's `result.error` string, and a thrown `Error.message` via the
   existing `messageOf`, inside the fixed "Install failed. … then retry." copy. This keeps the existing
   spec "renders an error without dismissing the dialog" passing, and it carries the design's
   `(<reason>)`. A stricter rule would map errors to fixed copy in the parent. That is a one-line change
   in `confirmInstall` if reviewers want it.
3. `external-marketplaces.component.ts` grows from 974 to 1036 lines; it was already over the C13 cap.
   The additions are only the hosting code.
