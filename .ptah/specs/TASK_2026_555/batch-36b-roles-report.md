# Batch 36b, stream 2 report: policy bar and background roles (Gate V 36 fixes)

Executor: frontend-developer (in-process). Date: 2026-10-02. Worktree: track A, head `e75a1cf31`. Nothing staged or
committed. No `git stash`, restore, checkout, reset or clean. `batches.md` not edited. Every Playwright run used
`--workers=2`.

Scope: `gate-v36-code-logic-review-33-36.md` (S-1, M-1, M-2, m-1, FM-1 to FM-4, Q3) and `visual-review-gate-v36.md`
(V36-2 for these files, V36-6, V36-8). Stream 1 (CLI matrix, popovers, modals, `libs/frontend/ui`) ran at the same time.

Paths are relative to `libs/frontend/chat/src/lib/settings/`.

## 1. Files

| Change | File | Lines | What |
| --- | --- | --- | --- |
| MODIFIED | `ptah-ai/agent-orchestration-config.component.ts` | 298 → 305 | m-1, V36-8, V36-2 |
| MODIFIED | `ptah-ai/orchestration-settings.component.ts` | 150 → 173 | M-1 consumption, V36-2 |
| MODIFIED | `providers/provider-consumer-assignments.component.ts` | 385 → 434 | S-1, M-2, M-1 hand-off, V36-6, V36-2 |
| MODIFIED | `providers/provider-consumer-rows.ts` | 246 → 266 | V36-6 / D16 row fields |
| MODIFIED | `settings.component.html` | 1 line | M-1 binding, approved by main; only this binding |
| MODIFIED | specs: the four above + `settings.component.spec.ts` | | one or more cases per fix (section 2) |

Every non-spec file is at most 434 lines (limit 700). No new `any`, `as any`, `@ts-ignore` or `[innerHTML]`. Every new
message is a fixed sentence. All components stay standalone, OnPush and signal-based.

## 2. Findings → fix → spec

| Finding | Fix (file:line) | Spec |
| --- | --- | --- |
| **S-1 / FM-1**: the enhancement time limit save failed silently | `provider-consumer-assignments.component.ts:399` `saveTimeout()` now saves through `SettingsSaveFeedbackService` (toast, Undo). "Saved" comes from this write's own result: `accepted && commit().status === 'saved'`, read inside its own `write()`. On a refused, failed or throwing write the editor stays open, the input goes back to the read-back limit, and the fixed `role="alert"` sentence `TIMEOUT_NOT_SAVED` (`:23`, rendered `:193`) shows. `writeTimeout()` (`:428`) emits `timeoutSaved` only on its own confirmed save, and also serves Undo. Q3: ms are `Math.round`ed. | `provider-consumer-assignments.component.spec.ts`: success + Undo (the case before `:635`), `:635` refused, `:651` failed commit after an earlier `saved` (no host text), `:671` throw, and the alert clears when the user types again |
| **M-1 / FM-2**: a repeated in-tab deep link to the same role was ignored | The roles table emits `deepLinkOpened` (`provider-consumer-assignments.component.ts:230`, `:263`) once the role's popover is open. It never toggles an already-open popover shut. `orchestration-settings.component.ts:99/137/143`: `focusTargetConsumed` fires once the section is focused and, for a role, its popover is open (either order). `settings.component.html:151` binds it to `orchestrationTarget.set(null)`, so a repeat goes null → `judge` and applies again: the details re-open, the section takes focus, and the popover opens. Batch 35 rule kept: a later normal visit has a null target and opens nothing (the existing `settings.component.spec` R3 case still passes). | `orchestration-settings.component.spec.ts:154-198` (4 cases, incl. re-open after the user closed the details); `provider-consumer-assignments.component.spec.ts:876`; `settings.component.spec.ts:362` |
| **M-2 / FM-3**: Esc on a role popover during a save dropped focus to `<body>` | The cell trigger is `[attr.aria-disabled]` while saving, never natively disabled (`provider-consumer-assignments.component.ts:91`, CELL style `aria-disabled:` variants `:20`). `toggleEdit()` refuses to open while busy (`:314`). The deep-link effect waits for the save to end. This is the Batch 36 order-popover approach. | `provider-consumer-assignments.component.spec.ts:504` (aria-disabled, focusable, click ignored), `:518` (Esc while saving → focus on the cell; still there after the save resolves), `:893` (deep link waits for the save) |
| **m-1 / FM-4**: a stale `commit()` hid the order popover's own error | `savePreferredOrder()` records this move's own outcome inside its `write()` (`agent-orchestration-config.component.ts:276`). The popover sentence follows it (`:286`), not `commit()`. It does not depend on stream 1's new `save()` return value. | `agent-orchestration-config.component.spec.ts:284` (refused, with an earlier `saved` commit), `:297` (throw) |
| **V36-6**: empty Scope column | Column removed (`provider-consumer-assignments.component.ts:61`, colspans 3→2 / 4→3). The scope badges render inline after the Provider & model cell only when `row.scopeShown` (`:127`): an override, or Mixed sources when the source is unknown (Decision 6). `hasOverride` is now passed to `ptah-setting-scope-row`. Before, it was never passed, so a real override could not have shown its badge. Same for the time-limit badge. Row fields: `provider-consumer-rows.ts:74`, `:97` (`ScopeSource`), `:161`. | `provider-consumer-rows.spec.ts:78`; `provider-consumer-assignments.component.spec.ts:703`, `:740` |
| **V36-8**: axe `heading-order` in the order popover | `<h3>` → `<p id="policy-order-title">` (`agent-orchestration-config.component.ts:87`); `aria-labelledby` unchanged. | `agent-orchestration-config.component.spec.ts:308` |
| **V36-2** (these files): helper text below 12 px | `text-xs` for: "Order:" (`agent-orchestration-config.component.ts:63`), the chips (`:67`), arrows (`:70`), "off", the popover helper (`:116`), the order and re-detect errors, the empty state; roles summary list (`orchestration-settings.component.ts:75`); roles helper copy, the Judging helper, the popover note, the reload line, and the time-limit helpers (`provider-consumer-assignments.component.ts`). Kept at 11 px, as the review accepts: `btn-xs` labels and the `table-xs` column headings. | `agent-orchestration-config.component.spec.ts:317`; `provider-consumer-assignments.component.spec.ts:757`; `orchestration-settings.component.spec.ts:200` |

### Failure modes: all four fixed; none accepted

FM-1 → S-1, FM-2 → M-1, FM-3 → M-2, FM-4 → m-1, as above. Review Q3 (float seconds): handled with `Math.round` on the
ms. NaN already blocks Save through the range check. I am not accepting any remaining item.

One residual note, not a defect: on a failed time-limit save both the toast (alert, carrying the details) and the inline
sentence are announced. The order popover does the same since Batch 33.

## 3. Counts

- Targeted jest: `npx jest -c libs/frontend/chat/jest.config.ts --maxWorkers=2` over `provider-consumer*`,
  `agent-orchestration-config`, `orchestration-settings`, `settings.component.spec` → **5/5 suites, 160/160 tests**.
  The `NG0953 Unexpected emit for destroyed OutputRef` console warnings come from `NativePopoverComponent`'s `opened`
  emit (ui lib, not mine).
- New or changed spec cases: policy bar +4, roles table +9 new / 4 rewritten, rows +1 / 1 rewritten, container +6,
  settings +1.
- `npx nx run chat:typecheck` → success. `npx nx run chat:lint` → **0 errors, 30 warnings, none in my files** (all in
  files I did not touch).
- `npx nx build ptah-extension-webview` → success, initial total **3.46 MB** (after stream 1 fixed a temporary TS2353
  in `cli-orchestration-matrix.component.ts:408`). This build is the strict template type-check for my template changes.

## 4. Playwright (orchestration scenes + visual spec, `--workers=2`)

Command: `npx playwright test --config=playwright.config.ts src/lib/scenarios/settings/settings-orchestration.e2e.spec.ts
src/lib/scenarios/settings/settings-visual.e2e.spec.ts --reporter=list --workers=2` → **14 passed, 22 failed**.

- **Passed (mine):** roles collapsed by default, the role "Set up" deep link to Providers, the order popover (move,
  focus, Esc, Undo), the judge deep link (roles open + popover + focus return), cell pick, on/off, edit modal. The
  fold measurement ran in all four combinations (section 5).
- **Failed, not mine (stream 1, in progress at run time):** every failure is focus not entering an opened `<dialog>`.
  This covers the add-instance and tier-mapping modals (18 scenes, both hosts) and the visual smoke at
  `settings-visual.e2e.spec.ts:591` (the Providers catalog modal search is not focused). Cause: the in-progress V36-1
  change in `libs/frontend/ui/.../native-modal.component.ts`. I reported it to stream 1, who confirmed and changed it to
  `display:none` plus `inert` while closed. They re-run these scenes after their rebuild. I did not re-run them on their
  final tree.
- Captures: I backed up all 96 `current-*` to `%TEMP%\b36b-roles-shots-backup` before the run. The 11
  non-orchestration `current-*` files the smoke rewrote were restored byte-for-byte. The 44
  `current-orchestration-*` were re-taken. The roles-open captures show no Scope column and 12 px helper text; the
  order-popover capture is unchanged in look.

## 5. Fold (roles summary bottom, budget 660 px)

| Host / theme | policy bar | matrix header | first row | roles summary | Result |
| --- | --- | --- | --- | --- | --- |
| vscode / anubis | 125 | 206 | 247 | **639** (was 643) | PASS (enforced) |
| vscode / anubis-light | 125 | 206 | 247 | **639** (was 643) | PASS (enforced) |
| electron / anubis | 165 | 270 | 313 | **775** (was 779) | bar/header/row PASS; summary over, not enforced yet (`ORCHESTRATION_ELECTRON_ROLES_FOLD_ENFORCED = false`) |
| electron / anubis-light | 165 | 270 | 313 | **775** (was 779) | as above |

My files did not grow the page: the policy bar height is unchanged with 12 px text, and the summary moved up 4 px in
both hosts. The run was on stream 1's tree before its matrix changes landed (Uninstalled collapse, V36-7). The
Electron summary therefore still depends on stream 1's changes, which main says will be enforced.

## 6. Out of scope (seen, not touched)

- `settings-save-feedback.service.ts` is being changed by stream 1 (`save()` returns `'saved' | 'failed' | 'refused'`).
  My S-1 and m-1 fixes track the outcome inside their own `write()` closures, so they work with the old and the new
  signature. They can switch to the return value later if wanted.
- No harness file was changed. A Playwright scene for the repeated in-tab deep link (M-1) would need a way to raise a
  second pending-tab request from the harness, which the routing-map entries do not offer today. The jest coverage in
  section 2 stands in for it.
