# Batch 40 report — TASK_2026_555

Author: Glm lane

## Files changed

| File | Change |
|---|---|
| `libs/frontend/chat/src/lib/settings/license/license-status-card.component.ts` | MODIFY — became the full "Membership & data" P2 section card (rows A1-A7), with the P12 membership-key popover, the P8 inline log-out confirm, and `[membership-actions]` / `[membership-notices]` slots for the projected A8/A9 actions |
| `libs/frontend/chat/src/lib/settings/license/license-status-card.component.spec.ts` | CREATE — 14 specs covering badges, one-primary, A2 alert copy, profile row, log-out confirm flow, key popover S-verify flow, key never persisting on close |
| `libs/frontend/chat/src/lib/settings/advanced-settings.component.ts` | MODIFY — Export/Import moved into the projected slots; Import gains the P8 inline confirm (S-confirm) and a result-sourced outcome line (D15); standalone Data Portability card removed (folded into the membership card) |
| `libs/frontend/chat/src/lib/settings/advanced-settings.component.spec.ts` | MODIFY — deviation, see below; the confirm gate + slot projection broke the batch-39 one-click assertions |

Non-spec sources are ≤ 700 lines: `license-status-card.component.ts` 669, `advanced-settings.component.ts` 252.

## Rows A1-A9

| Row | How it is met |
|---|---|
| A1 badges | `license-status-card.component.ts:271-303` — outline `badge-xs` with `text-base-content`; colour only on the dot/icon: `bg-success` dot for Active, `bg-warning` dot for Needs Attention, `text-secondary` Sparkles for Builder (deviation #6). Community badge is plain outline. |
| A2 key-not-active alert | `license-status-card.component.ts:306-344` — `role="alert"` with `border-warning/40 bg-warning/10` and `text-warning` AlertTriangle; body copy is verbatim, ending "Ptah's local features remain available either way."; outline "Re-enter Membership Key" (`data-testid="membership-key-alert-action"`) opens the key popover. Shown for `isCommunity && (reason === 'no_license' \|\| 'expired')`. |
| A3 profile row | `license-status-card.component.ts:347-382` — initials circle (`bg-primary/20 text-primary`), display name, email, and a ghost Log Out button (icon `text-error`, text `text-base-content`, `aria-label="Remove membership key and log out"`). |
| A4 Log out | P8 inline confirm `license-status-card.component.ts:383-433` (`role="group"`, confirm `btn btn-outline btn-xs border-error`, no Undo). `confirmLogout()` calls `license:clearKey`; success just closes the confirm (the window reloads host-side, so no success UI exists — S-confirm, D15); a failed write keeps the confirm open with the failure inline (`data-testid="logout-error"`, `role="alert"`). Replaced `ConfirmationDialogService` per G12. |
| A5 membership key popover | P12 popover at `license-status-card.component.ts:90-238` — `ptah-native-popover` (bottom-end, transparent backdrop), single password field with show/hide, help text. S-verify: local format check `/^ptah_lic_[a-f0-9]{64}$/` then `license:setKey`; success is shown only from the write's own result and keeps the existing "Membership activated! Plan: X. Reloading..." copy; server rejection / RPC error / thrown error all land in the inline `role="alert"` line. Every close route (X, Esc, backdrop via `(closed)`) runs `closeKeyPopover()` which resets input/error/success/visibility, so a typed key never persists in component state. |
| A6 one primary action | Community header: `Create Account` is the single `btn-primary`; `Enter Membership Key` (popover trigger) and `Explore Ptah Builders` are ghost. Member header: `Manage Membership` is the single `btn-primary`. Specs assert `querySelectorAll('.btn-primary').length === 1` per state. |
| A7 plan text | `license-status-card.component.ts:437-441` — `planDescription()` as `text-xs text-base-content-muted` under the profile block. |
| A8 Export | Stays a header outline `btn-xs` action inside the `[membership-actions]` slot (`advanced-settings.component.ts:50-67`), `aria-label="Export settings"` kept (harness safe-list #80), spinner while `isExporting()`. |
| A9 Import | Same slot; `aria-label="Import settings"` kept (#81). Click opens the P8 inline confirm (S-confirm, no Undo); confirming runs the platform-aware write and the outcome line is set **only from the write's own result** (D15). Electron: `settings:import` result errors → `role="alert"` "Import finished with errors: …"; clean import → `role="status"` "Settings imported."; `cancelled` → silent. VS Code: `command:execute ptah.importSettings` shows its own host dialogs and a cancel is indistinguishable from success at the RPC layer, so only an execution failure is reported here. |

## Preserve-list check

| Capability | Verdict | Location |
|---|---|---|
| `ptah-license-status-card` selector | stays | unchanged (`license-status-card.component.ts:55`) |
| Membership badge, status, user identity, plan text | stays | `license-status-card.component.ts:271-303`, `:347-441` |
| Key-not-active warning + re-enter | stays | `:306-344` |
| Log out (confirm) | stays | `:383-433` (now inline instead of the dialog service, per G12) |
| Enter membership key + format check + server verify | stays | `:90-238`, `submitLicenseKey()` `:572-611` |
| Create Account / Manage Membership / Explore Ptah Builders | stays | `openSignup()` / `openPricing()` unchanged (`:544-548`, `:658-662`) |
| Export settings / Import settings (incl. Electron `settings:export`/`settings:import` and VS Code `ptah.exportSettings`/`ptah.importSettings`) | stays | `advanced-settings.component.ts:168-252` |
| `aria-label="Export settings"` / `aria-label="Import settings"` | stays | `advanced-settings.component.ts:59`, `:73` |
| Enhanced prompts / output style / workflows / MCP port / VS Code LM children | unchanged | `advanced-settings.component.ts:140-144` |
| `modelChanged` → CLI re-detect | stays | forwarded unchanged (`:144`, `:153`) |

## Persisted-settings writes changed

None. The batch changes no persisted-settings write: the same RPCs are used as before — `license:setKey`, `license:clearKey`, `command:execute` (`ptah.exportSettings`, `ptah.importSettings`, `ptah.openSignup`, `ptah.openPricing`), `settings:export`, `settings:import`. No store keys were added, removed or repointed, and no runtime reader changed.

## Verify results

| Command | Result |
|---|---|
| `npx nx run @ptah-extension/chat:typecheck --skip-nx-cache` | PASS (after fixing two TS2322 in the import outcome: `result.error ?? 'Import failed. Please try again.'`) |
| `npx nx run @ptah-extension/chat:lint` | PASS — 0 errors, 30 warnings, all pre-existing and none in batch files |
| `npx nx run @ptah-extension/chat:test -- --maxWorkers=2 --testPathPattern=license-status-card` | the `--testPathPattern` extra args do not reach Jest through the nx target (it ran all suites), so the targeted run was done directly: `npx jest -c jest.config.ts --testPathPatterns=license-status-card` → **14/14 passed**; `advanced-settings` → **11/11 passed** |
| full suite `npx nx run @ptah-extension/chat:test -- --maxWorkers=2` | PASS — Test Suites: 129 passed, 129 total; Tests: 2 skipped, 2136 passed, 2138 total |

Jest prints its usual "worker process has failed to exit gracefully" teardown note; it predates this batch (also present before these changes) and is not caused by the new specs.

## Deviations from the pattern map

1. **`advanced-settings.component.spec.ts` modified beyond the 3-file list.** Batch 39's spec stubbed the license card without `ng-content` and asserted a one-click import. The A9 confirm gate and the `[membership-actions]`/`[membership-notices]` projection broke those assertions, so the spec had to be updated to keep the suite green (LicenseStub projects `<ng-content />`, import tests click through the confirm).
2. **Import failure feedback is an inline `role="alert"` line in the card, not an alert toast.** `SettingsSaveFeedbackService` (outside this batch's file list, so not modifiable) has no alert-only entry — its generic success contract is "Saved {label}." — and on VS Code a user cancel is indistinguishable from a successful import at the RPC layer, so any toast would be dishonest or lying-by-success. The inline outcome matches the shipped credentials-tab precedent.
3. **Log out failure is inline in the confirm (P8), not a toast**, for the same no-alert-only-entry reason; success reloads the window host-side, so no success UI exists at all (this matches the pattern map's own note for A4).
4. **`as never` casts removed** from the `settings:export` / `settings:import` calls — both methods are in the RpcMethodRegistry, so the casts were unnecessary; typecheck confirms.
5. **The standalone Data Portability card was removed** (folded into "Membership & data" per this batch's own definition) and its description copy "Export or import your settings, API keys, and preferences." dropped with it.
6. **Visual source**: the task named `prototypes/final/providers.html`, which does not exist in the prototypes folder; `prototypes/final/index.html` (Providers prototype with #popoverMainAgent, the alert shape and #toastContainer) and `orchestration.html` were used as the visual sources instead.
7. **Spec-only**: the popover is stubbed in the license-card spec (same shape as the web-search config spec, plus `placement`/`hasBackdrop`/`backdropClass` inputs) because jsdom has no real Floating-UI positioning; the real `NativePopoverComponent` ships unchanged.

## Copy needing user review

- Import confirm: "Import replaces your current settings, API keys and preferences with the contents of a settings export file you choose next."
- Import outcomes: "Settings imported." / "Import finished with errors: {joined errors}" / "Import failed: {message}" / "Import failed. Please try again."
- Log out confirm: "Remove your membership key and log out? You can enter a new key after reloading."
- Log out failure fallback: "Log out failed. Please try again." (and "Log out failed: {message}" for thrown errors)
- Key format error: `Invalid format. Key must start with "ptah_lic_" followed by 64 hex characters.`
- Key help text (popover): `Starts with "ptah_lic_" followed by 64 hex characters.`
- Key success (pre-existing, kept): "Membership activated! Plan: {plan}. Reloading..."