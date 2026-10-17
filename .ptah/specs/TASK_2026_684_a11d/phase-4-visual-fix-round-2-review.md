# Phase 4 visual fix, round 2 of 2 — TASK_2026_684_a11d

Commit: `eda548d2c094640e93971adcd6d2151ef98b73e3` · Reviewer family: codex · Implementer family: claude

| Prior finding | Status in code | Evidence |
| --- | --- | --- |
| 7. Base URL field moves up when an error appears above the row | **FIXED for the reported 900/1531 px layouts** | The Base URL field always renders a `min-h-8` error slot; only its child alert is conditional (`libs/frontend/chat/src/lib/settings/providers/decision-model-row.base-url-field.component.ts:52-65`). The two-line errors at the reviewed widths replace reserved space instead of adding it. Narrower panels remain a new defect below. |
| 8. Save requires inner scrolling when the capped editor shows an error | **FIXED for the reported layout** | Save and the footer are siblings after the sole `overflow-y-auto` body (`libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.ts:229-232,349-369`). The body has `min-h-0`, so it shrinks inside the dialog's `max-height` while Save remains outside it (`:190-192,229-231`). A smaller cap remains a new defect below. |

## New defects

1. **MODERATE — the reserved error slot is not enough at narrow webview widths.** `decision-model-row.base-url-field.component.ts:52-65` sets a **minimum** of 32 px, while the fixed error sentences can occupy more than two `text-xs` lines when the editor is narrowed by `max-w-[calc(100vw-2rem)]` (`decision-model-row.component.ts:190`). Then the slot grows, and a popover positioned above the row moves its Base URL field upward again. The changed spec asserts the class and alert presence, but not rendered height (`decision-model-row.endpoint.spec.ts:385-405`). **Fix:** reserve the measured maximum error height at supported narrow widths, or keep the above-placed dialog's top fixed as the text grows; verify geometry in a narrow host panel.

2. **MODERATE — the fixed footer can exceed the dialog's minimum height cap.** `decision-model-row.popover.ts:11-16,21-29` allows a 160 px cap. The dialog has 16 px padding and four 8 px gaps, while its label, kind picker, and Save consume at least 16 + 32 + 32 px (`decision-model-row.component.ts:190-192,210-228,350-362`; `decision-model-key-field.component.ts:20,25-26`). That leaves at most 32 px for both the body and footer. The footer sentence can wrap past two lines in a narrow panel (`decision-model-row.component.ts:541-549,364-369`), so fixed children overflow the cap and Save/footer visibility is no longer guaranteed in a short viewport. **Fix:** size the cap for actual fixed chrome, or put the footer text into the scrolling body while keeping Save in a footer that is guaranteed to fit; verify a short, narrow viewport.

## Five logic questions

1. **Silent failure:** A failed save cannot look successful through a malformed response: `write()` requires `success === true` (`decision-model-row.component.ts:736-754`). The responsive overflow has no programmatic failure signal (new defects 1–2).
2. **Unexpected user action:** Typing an invalid URL in a narrow, above-placed editor can move the field despite the slot (`decision-model-row.base-url-field.component.ts:52-65`; new defect 1).
3. **Wrong answer from input:** The template does not change selection data; `canSave()` still checks `endpointError()` and the saved origin before permitting the write (`decision-model-row.component.ts:514-530`). The existing `storedKeyBoundTo()` origin comparison is unchanged (`decision-model-row.view.ts:460-469`).
4. **Dependency failure:** A failed status read clears the status (`decision-model-row.component.ts:576-594`); a failed or malformed write returns an error (`:736-754`). Neither path changed in this commit. The catalog and inline hint parser are also outside this diff (`decision-model-suggestions.ts`; `decision-model-row.view.ts:391-420`).
5. **Missing requirement:** The visual acceptance sizes did not specify a narrow host panel or short viewport. Those dimensions expose the two remaining layout limits (`decision-model-row.component.ts:190-192`; `decision-model-row.popover.ts:11-29`).

## Verification and score

**6/10.** The reported desktop layouts are addressed, including Save as the last enabled Tab stop: `wrapEditorTab()` queries all enabled controls in DOM order (`decision-model-row.popover.ts:31-60`), and Save now follows the body (`decision-model-row.component.ts:349-362`). Focus on open remains on the dialog (`decision-model-row.component.ts:140-148,183-192`). The score is below 7–8 because the two responsive geometry limits remain, and above 3–4 because save, validation, key binding, and the reviewed desktop paths remain coherent. The changed specs check DOM structure and Tab wrapping but do not measure rendered geometry (`decision-model-row.component.spec.ts:709-758`; `decision-model-row.endpoint.spec.ts:385-405`). Read-only review; no tests or builds were run. Scoped `ptah_get_diagnostics` reported no errors in the three changed source files; it reported 266 errors in sibling files.

Verdict: REVISE
