# P6 Gate 2 cross-side review

Verdict: REVISE

Score: 7/10

Reviewed the approved D42/D52–D54 direction, design, parity inventory, review-r1 and current source. Paths below are relative to the worktree; plan/design/inventory references are in this task folder. MP = `libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.ts`; ST = `libs/frontend/core/src/lib/services/provider-accounts-state.service.ts`; FB = `libs/frontend/chat/src/lib/settings/feedback/settings-save-feedback.service.ts`.

## Findings

### Serious

1. **The promised click-time revision is not preserved across the provider save.** Plan `:204-205` and acceptance 4 (`:339`) claim the Save-click revision, but ST `:390-407` captures the snapshot when `setSelection` is called. MP `:491-499` awaits the provider write first. A pushed account-selection change during that await therefore becomes the expected revision, allowing the older draft to overwrite it without a conflict. Capture the selection revision at Save intent and, after the provider await, stop/reconcile if it changed before synchronously calling `setSelection`; test this race. This can remain frontend-only. Do not claim the existing three-argument service accepts a captured revision.

### Moderate

2. **The partial-save lock contradicts the specified Save predicate.** Plan `:99-100`, `:340-342` require confirmed account refusal to stop model/effort writes and disable Save until the account changes. But `:201-208` only clears the account draft; its OR predicate retains the existing model/effort dirty branch. MP `:353-363` enables Save for either remaining draft, so the next click can save those fields without another account choice, and the assumed disabled-button focus transition does not occur. Specify an explicit refusal lock/reset condition and test provider + account + model/effort drafts together, including B-2 after focus moves away. Keep unconfirmed outcomes distinct.

### Minor

3. **Acceptance 20 is internally impossible as written.** Plan `:368-369` prohibits every other live region in P6 surfaces, while `:253-256` requires a stale `role=status` badge and load-error `role=alert` row, matching approved design `:102-103` and existing `accounts-tab.component.ts:146,163`. Restrict the prohibition to duplicate mutation-feedback announcers; explicitly retain load/stale regions.

## Checks passed and limits

- **Contracts/backend:** The cited service methods, RPC selection parameters, drawer/component inputs and outputs, matrix insertion point, and toast APIs exist. ST `:384-409`, `:543-557`, `:595-605` support ambient/named writes, confirmed refusal, uncertainty refresh and authoritative snapshots. `libs/shared/src/lib/types/rpc/rpc-provider-accounts.types.ts:235-240` supplies both scope and expected revision; `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts:279-285` registers the write. Runtime consumption exists for main (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:719`) and lane (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts:335`). No backend change is needed, with finding 1 resolved in MP.
- **Batches:** P1–P9 contain respectively 3/2/2/4/4/4/2/4/2 files; each wave is file-disjoint. Static contract inspection supports the stated compile order: P2 is additive; P6 removes bindings before P7/P8 remove optional inputs (`account-detail-view.component.ts:337-351`; `add-account-form.component.ts:110-114`); P9 removes old helpers last. However, plan `:408` explicitly postpones P6 tests until P7/P8 are present: that verifies integration, not the isolated P6 commit. No compilation or tests were run.
- **Parity:** Selector capabilities map to P2/P4/P5; list, reads, chips and action feedback to P6; detail/run/resume/terminal/rename/remove to P7; ambient/Add to P8; page badge stays unchanged. No unapproved capability removal found. P6-A4 preserves age information and its timer in tooltip + screen-reader text; P6-A5 retains run counts in detail (approved design `:116`); P6-A6 preserves detail access through Manage on every row (approved design `:98`). D54's two existing-login cues remain accessible. Approved copy removals do not remove actions.
- **Failures/Undo:** Removed selections remain derived placeholders, not local reassignment; unsupported hosts stay absent (ST `:170,221`). Unconfirmed correctly never says “not saved.” Provider → account → model/effort is sound apart from findings 1–2. FB `:121-125` supports merged success text without replacing model/effort Undo; MP `:557-561` confirms Undo restores only model/effort. FB `:208-209` confirms a later `announce` would discard Undo, so retain the single merged toast. Add explicit assertions for Undo scope and account-saved/model-failed behavior.
- **Acceptance/commands:** Criteria cover the carried-over async-focus, persistent-announcement and real Electron zoom requirements and are testable after the contradictions above are fixed. All nine focused Jest commands use the required absolute `node D:/projects/ptah-extension/scripts/verify.mjs -t test -p @ptah-extension/chat -- --testPathPatterns=...` form; quoted multi-pattern arguments are equivalent. This was source review only: no build, test, install or git mutation.
