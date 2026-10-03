# Batch 49b report: component defects pinned by the Batch 49 scenes (TASK_2026_555, track B)

Author: started by the antigravity lane (toast, partial; stopped at its 429 quota), finished in-process by the
Advanced owner (frontend-developer). Same-side. Worktree
`D:\projects\ptah-extension\.claude-worktrees\task-555-advanced-search-voice`. Chat lib only; no harness file edited,
no `batches.md` edit, no commit or stash.

**Status: the scene spec is green, 24/24 with `--repeat-each=3` (Esc 6/6, D15 6/6, captures 12/12).**

## 1. The lane's partial edit

The lane added a `MutationObserver` on `document.body` (`subtree: true`) while a toast was visible, plus a `bottom-24`
class. **Replaced**, not kept, for three reasons:
- the selector included `[data-testid="native-modal-dialog"]`, which is the always-present `<dialog>` element, so any
  mounted modal (open or not) would lift the toast;
- a body-wide subtree observer fires on every DOM change (chat streaming included) while the toast is up;
- 96 px does not clear the setup wizard's footer when it wraps (105 px).

Its spec cases were replaced with ones for the new rule.

## 2. Fixes (file:line)

All paths under `libs/frontend/chat/src/lib/settings/`.

| # | Defect | Fix |
|---|---|---|
| 1 | Failed activate leaves the clicked radio checked | `output-style/output-style-list.component.ts:579` `syncActiveRadios(selected)` writes the saved selection back to the radio elements (scoped to the host element). `output-style/output-style-config.component.ts:179` calls it with `store.activeName()` after `saveGeneric` settles: success, failure or refusal. This is the same pattern as Batch 45 (`checkbox.checked = signal()` after the save) |
| 2 | Cancelled parity confirm leaves the clicked radio checked | `output-style-list.component.ts:572` (`cancelParitySelection`) and `:598` (`onParityToggled`, which also drops a pending choice) call `syncActiveRadios()` |
| 3a | Import confirm ignores Esc | `advanced-settings.component.ts:101` `(keydown.escape)`, `:212` `cancelImport(event?)`: stopPropagation only when the confirm was open, close it, and return focus to Import with `afterNextRender` (the button is disabled while the confirm is open). Cancel is focused when the confirm opens (`#importCancel` + effect) |
| 3b | Output-style Delete confirm ignores Esc | `output-style-list.component.ts:319` / `:341`, `:666` `cancelDelete(opener, event?)`: stopPropagation, close, focus the row's Delete button. Cancel is focused on open (`#deleteCancel` viewChild + effect) |
| 3c | Allow-localhost confirm ignores Esc | `pro-features/mcp-port-config.component.ts:173`, `:436` `cancelEnableLocalhost(event?)`: same shape as 3a. Focus returns to the checkbox after it is enabled again. Cancel is focused on open |
| 3d | (found by the first scene run) ElevenLabs clear confirm: Esc also reached D-VOICE's `onPanelKeydown`, which closes the drawer, so focus intermittently went to the drawer opener (2 of 3 Electron runs) | `ptah-ai/elevenlabs-panel.component.ts:149`, `:531` `cancelClear(event?)` stops propagation. This is the brief's "stopPropagation only when the confirm handled Esc" rule, applied to the one existing confirm that sits inside a drawer |
| 4 | Toast covers drawer footers for up to 8 s | `feedback/settings-toast.component.ts:23` (decision in section 3) |

Dead code removed from `output-style-list.component.ts` to stay under 700 lines: `onParityToggle(event)`,
`onParityTierChange(event)` and `parityTiers`. No template or spec referenced them; the parity section has its own
handlers. `isActive` now delegates to a module function, `isActiveStyle`, which the sync shares.

## 3. Toast placement decision

When a NativeDrawer is open, the toast is lifted above the footer using pure CSS:
`[body:has(ptah-native-drawer_[role=dialog])_&]:bottom-28`. Tailwind emits
`body:has(ptah-native-drawer [role=dialog]) .… { bottom: 7rem }`; I checked this rule in the built `styles.css`.

- The drawer's `role="dialog"` panel only exists while the drawer is open (`@if (isOpen())`), so a closed drawer host
  does not lift the toast. Every drawer is covered, including the Providers connection drawer and setup wizard, the
  system prompt drawer, D-OS and D-VOICE. The selector's specificity beats `bottom-6` without toggling a class.
- 112 px clears a 57 px footer and the wizard's 105 px wrapped footer.
- **No observer, timer or JS.** It reacts when a drawer opens or closes while a toast is showing.
- NativeModal needs no rule: it uses `<dialog>.showModal()`, which puts it in the top layer above any fixed element.
- Unchanged: `role` and `aria-live`, Undo and Dismiss, and `SettingsSaveFeedbackService`. The change is limited to the
  `feedback/` folder (plus a `data-testid="settings-toast-region"` on the wrapper). `settings.component.html` was not
  touched, which keeps the merge with track A small.
- Measured with a temporary probe spec (Electron, a save inside D-VOICE; the probe was deleted afterwards):

| Viewport | Toast bottom | Footer top | Result |
|---|---|---|---|
| 1024×768 | 656 | 711 | Close clicked through, Undo enabled |
| 600×700 | 588 | 643 | Close clicked through, Undo enabled |

  With the drawer closed, the toast went back to 24 px from the bottom. 4/4 passed (`--repeat-each=2`).

## 4. Unit specs (new cases)

| Spec | Case |
|---|---|
| `feedback/settings-toast.component.spec.ts` | Region has `bottom-6` plus the lift class, and keeps role status. The lift condition matches only when a drawer host contains a `role=dialog` panel |
| `output-style/output-style-list.component.spec.ts` | Cancelled parity confirm puts the radios back. `syncActiveRadios` after a refused activate, and with an explicit name. Delete confirm: Cancel focused on open; Esc closes it, focuses Delete and does not reach `body`; Cancel returns focus |
| `advanced-settings.component.spec.ts` | Import confirm: Cancel focused; Esc closes it, focuses Import, does not reach `body`, and makes no RPC |
| `pro-features/mcp-port-config.component.spec.ts` | Localhost confirm: Cancel focused; Esc closes it, the checkbox stays off and gets focus, Esc does not reach `body`, and nothing is written |
| `ptah-ai/elevenlabs-panel.component.spec.ts` | Existing Esc case extended: a bubbling Esc does not reach the panel host |

## 5. Verification

| Check | Result |
|---|---|
| `npx jest -c libs/frontend/chat/jest.config.ts --maxWorkers=2` on toast, output-style, advanced-settings, mcp-port, elevenlabs | 8 suites, **178 passed** |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/chat --skip-nx-cache` | "Successfully ran targets typecheck, lint" |
| `npx eslint` on every touched file | 0 errors, **0 warnings** (no new warnings) |
| Line counts (non-spec) | output-style-list 693, elevenlabs-panel 673, mcp-port-config 508, advanced-settings 275, output-style-config 222, settings-toast 63 (all ≤ 700) |
| `npx nx build ptah-extension-webview` | success |
| Scene spec run 1 (`--repeat-each=3 --workers=2`) | 22 passed, 2 failed. Import, Delete and Localhost Esc passed and D15 passed 6/6; the ElevenLabs clear confirm failed in 2 of 3 Electron runs (fix 3d) |
| Scene spec run 2, after 3d | **24 passed (1.5 m)**: focus 6/6 "all pass", D15 6/6 "all pass", captures and fold 12/12 |

Captures: the scene runs rewrote only the Batch 49 `current-*` names listed in the Batch 49 report (section 7). The
probe took no screenshots, and no other `current-*` or `baseline-*` file changed.

## 6. Notes

- `git checkout -- …/settings-toast.component.spec.ts` was used once to put the lane's spec back to HEAD before I
  rewrote it. It is a working-tree restore of a file this batch owns; nothing was staged, committed or stashed.
- No config spec was added for `output-style-config.component.ts:179`. It is a one-line call, covered by the list spec
  for `syncActiveRadios` and by the D15 scene.
- Out of scope, not touched: the web-search and go vet confirms handle Esc but do not stop propagation. Neither is
  inside a drawer, so nothing else closes today.
