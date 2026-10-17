# Phase 4 visual-fix logic review — TASK_2026_684_a11d

Commit: `bbdd5d431` · Round: 1 visual-fix logic review · Reviewer family: codex · Implementer family: claude

| Prior visual item | Status | Evidence |
| --- | --- | --- |
| 1. SERIOUS — editor top and controls off-screen | **FIXED** | `libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.ts:179-230` caps the editor and scrolls its body while keeping the heading, close control, and kind picker outside that body. The cap is computed from the row's viewport position at `:618-625`; `decision-model-row.popover.ts:19-26` chooses the available side. |
| 2. MODERATE — URL error shifts the field upward | **FIXED** | `decision-model-row.popover.ts:23-26` prefers room below the row when at least 280 px is available. The editor's capped body scrolls at `decision-model-row.component.ts:227-230`, so adding the inline error at `decision-model-row.base-url-field.component.ts:52-61` changes body content without moving the fixed header or the field's popover anchor. |
| 3. MODERATE — inline validation claims a failed save | **FIXED** | `decision-model-row.view.ts:406-420` strips the save-failure lead only for inline hints. Host save failures still use the full shared sentence through `hostSaveSentence` at `:77-89` and `decision-model-row.component.ts:737-749`. |
| 4. MODERATE — Remove stored key shown without a known stored key | **FIXED** | `decision-model-row.view.ts:475-484` reads `apiKeyStored` only for the saved keyed kind; `decision-model-row.component.ts:500-510` offers Remove only for `true`. After a successful removal, `write()` re-reads status at `:751-752`; `removeKey()` then focuses the key input at `:706-722`. A failed re-read clears status at `:573-590`, so the control disappears rather than claiming a key still exists. The custom key's origin check remains at `:511-518` and `decision-model-row.view.ts:459-468`. |
| 5. MINOR — Tab leaves the editor | **FIXED** | `decision-model-row.popover.ts:29-57` wraps Tab at the last enabled control and Shift+Tab at the first or focused panel. The row wires this at `decision-model-row.component.ts:140-148,628-632`; Escape closes through `libs/frontend/ui/src/lib/native/popover/native-popover.component.ts:293-302` and focus returns to the trigger at `decision-model-row.component.ts:608-615`. A separate initial-focus defect is below. |
| 6. MINOR — model field lacks examples | **FIXED** | `decision-model-row.view.ts:57-71` supplies Ollama Cloud and custom placeholders; `decision-model-row.component.ts:292-309` binds them without assigning a model value. |

## New defects

1. **MINOR — opening the editor does not initially announce its dialog to assistive technology.** The new `role="dialog"` and `aria-modal="true"` are on the child editor (`libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.ts:182-190`), but the shared popover focuses its *parent* panel on open (`libs/frontend/ui/src/lib/native/popover/native-popover.component.ts:100-108,202-229`). The row has no `(opened)` focus handoff (`decision-model-row.component.ts:140-148`). A keyboard or screen-reader user opening it initially lands outside the dialog role, so its label and modal context may not be announced until they Tab into a child. **Fix:** focus the editor itself with `tabindex="-1"` when opened (or place the dialog role on the focused panel), and include that initial focus target in the Shift+Tab wrap logic.

## Five logic questions

1. **Silent failure:** A successful key deletion followed by a failed status read shows an unreachable row and hides Remove (`decision-model-row.component.ts:573-590,706-722,751-752`); it does not claim the old key remains. The initial dialog announcement gap is defect 1.
2. **Unexpected user action:** Opening by keyboard focuses the outer panel instead of the dialog (`native-popover.component.ts:202-229`; defect 1).
3. **Wrong answer from input:** A stored custom key applies to the draft only at the saved origin (`decision-model-row.component.ts:511-518`; `decision-model-row.view.ts:459-468`); typed or stored keys still enforce D4 through `endpointFieldError` (`decision-model-row.view.ts:390-403`).
4. **Dependency failure:** A malformed save response fails unless `success === true` (`decision-model-row.component.ts:733-749`); a failed post-write read makes status unknown (`:573-590`). Catalog parser invariants remain in `libs/frontend/chat/src/lib/settings/providers/decision-model-suggestions.ts:138-159` and were unchanged by this commit.
5. **Unstated case:** The dialog role needs an initial focus target inside its subtree; the shared popover currently focuses its parent (`native-popover.component.ts:228`; defect 1).

## Verification and score

**7/10.** The six visual findings are addressed in code, with a remaining minor accessibility behavior gap. This is above 5–6 because save validation, key state, D4, and catalog invariants remain intact; it is below 9–10 because opening the modal does not put focus in its dialog subtree and no visual or runtime verification was performed. Read-only review only; no tests, builds, or network calls. Scoped `ptah_get_diagnostics` was unavailable after its 45-second TypeScript check.

Verdict: REVISE
