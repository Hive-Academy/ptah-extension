# Batch 43 report — TASK_2026_555 (track B)

**Author:** antigravity CLI lane  
**Batch:** 43 — Output style (A19–A25): list → matrix with "Active" radio column, editor → drawer (D-OS), CLI parity in `<details>`

---

## 1. Summary of Changes

Batch 43 redesigns the Output Style capability on the Advanced tab to match the approved prototype patterns (`table-xs` matrix P4, section card P2, slide-over drawer P6, collapsed `<details>` P9, inline S-confirm P8) and enforces D15 save feedback and error sanitization:

1. **Section Card Shell (`OutputStyleConfigComponent`)**:
   - Replaced custom border container with standard section card styling (`card bg-base-200 border border-base-300 p-3`, P2).
   - Card header contains Palette icon, title, styles count, and primary action "New style" (`btn btn-primary btn-xs`, A21).
   - Replaced in-place list/editor view swap with permanent matrix list and lazily deferred Drawer D-OS (`@defer (when view() === 'editor')`).
   - Wired active style selection to `SettingsSaveFeedbackService.saveGeneric` with Undo on standard selection (D15). Parity selections confirm first and offer no Undo (A24).

2. **Matrix Table & Parity `<details>` (`OutputStyleListComponent`)**:
   - Converted `<ul>` list into P4 matrix (`table table-xs`, A19, G7) with `role="radiogroup"`:
     - **Active column**: Radio input (`role="radio"`, `class="radio radio-xs radio-primary"`).
     - **Name column**: Style name with success Check icon when active.
     - **Tier column**: Status and tier outline badges (`badge badge-outline badge-xs text-base-content`, A20), respecting deviation #6 (colour on border/dot only).
     - **Description column**: Style description, E4/M1 shadow reason, immutable reason, and inline delete confirmation (P8).
     - **Actions column**: Edit button (opens Drawer D-OS) and Delete button (A22).
   - Preserved all inline alert banners (A23) for missing active style (E5/N1 with "Clear the selection"), collision (E4), fallback injection (Req 5.4 with "Copy to this project"), and invalid files list with "Rewrite it here".
   - Encapsulated command-line parity into a collapsed `<details>` element (P9, A24) with parity checkbox, tier selection dropdown, written path confirmation, and parity warning.
   - Implemented inline confirmation (P8, S-confirm) for parity writes: selecting a style with parity enabled prompts the user with the exact relative display path before writing settings outside Ptah, with no Undo.

3. **Drawer D-OS (`OutputStyleEditorComponent`)**:
   - Converted the create/edit sub-view into Drawer D-OS (P6) powered by `NativeDrawerComponent` (`widthClass="w-full max-w-lg"`).
   - Header displays Palette icon, title ("New style" / "Edit style" / "Rewrite style file"), and subtitle.
   - Body contains repair notice (A23), form error alert, overwrite conflict prompt, and form inputs.
   - Implemented Gap G6: Instructions markdown editor features "Edit" | "Preview" tabs using `NativeTabGroupComponent`. The preview is rendered through `MarkdownBlockComponent` (DOMPurify chokepoint, zero `[innerHTML]`).
   - Footer provides primary "Save style" and ghost "Cancel" buttons.
   - Fixed error copy: Never exposes raw host or RPC error strings (`result.error`, `data.error`, `error.message`). Displays fixed sentence `"Could not save the output style."` (D15).

---

## 2. Files Changed

| Status | File Path | Lines | Description |
|---|---|---|---|
| **MODIFIED** | `libs/frontend/chat/src/lib/settings/output-style/output-style-config.component.ts` | 198 | P2 card shell with primary "New style" button, `saveGeneric` with Undo, bare catch error handling, and deferred Drawer D-OS mount |
| **MODIFIED** | `libs/frontend/chat/src/lib/settings/output-style/output-style-list.component.ts` | 611 | P4 matrix table with "Active" radio column, transparent disabled ghost action buttons (V3), outline badges, and parity section integration |
| **ADDED** | `libs/frontend/chat/src/lib/settings/output-style/output-style-parity-section.component.ts` | 208 | P9 parity `<details>`, tier selection, P8 parity S-confirm dialog, success status, and warning banner |
| **MODIFIED** | `libs/frontend/chat/src/lib/settings/output-style/output-style-editor.component.ts` | 560 | Drawer D-OS implementation with pinned `border-t border-base-300 px-4 py-3` footer (V4), `rows="5"` textarea, NativeTabGroup tabs, and fixed error copy |
| **MODIFIED** | `libs/frontend/chat/src/lib/settings/output-style/output-style-list.component.spec.ts` | 401 | Unit tests for P4 matrix table, radio semantics, parity S-confirm & cancel, and fixed error copy |
| **MODIFIED** | `libs/frontend/chat/src/lib/settings/output-style/output-style-editor.component.spec.ts` | 386 | Unit tests for Drawer D-OS header/footer, NativeTabGroup tabs, fixed error copy, and markdown preview |

All non-spec files comply with the repo file ceiling of ≤ 700 lines:
- `output-style-config.component.ts`: 198 lines
- `output-style-editor.component.ts`: 560 lines
- `output-style-list.component.ts`: 611 lines
- `output-style-parity-section.component.ts`: 208 lines
- `output-style.store.ts`: 311 lines

---

## 3. Preservation of Capabilities (A19–A25)

| Item | Capability | Verdict & Implementation | Source Location |
|---|---|---|---|
| **A19** | Output style matrix with "Active" radio column | **Preserved.** P4 `table.table-xs` with `role="radiogroup" aria-label="Active output style"`. Radio buttons carry `role="radio"` and keep radiogroup semantics. Saved via `SettingsSaveFeedbackService.saveGeneric` with Undo (when parity is off). | `output-style-list.component.ts:182-273`, `output-style-config.component.ts:124-159` |
| **A20** | Tier badges and status badges | **Preserved with deviation #6.** Badges use outline styling (`badge badge-outline badge-xs text-base-content`). Colour is applied to borders and dots only: Built-in, You, Project, Plugin, Overridden, and "Drops default coding instructions". | `output-style-list.component.ts:223-242` |
| **A21** | "New style" action | **Preserved.** P2 card header primary action `btn btn-primary btn-xs` opens Drawer D-OS in create mode. | `output-style-config.component.ts:60-70` |
| **A22** | Edit and Delete actions per row | **Preserved.** Edit opens Drawer D-OS. Delete triggers P8 inline confirm (`role="alertdialog"`) in the row, with disabled-with-reason for immutable styles. S-confirm, no Undo. | `output-style-list.component.ts:258-324` |
| **A23** | Banners: write error, missing-active, collision, fallback, invalid files | **Preserved verbatim.** Missing-active provides "Clear the selection"; fallback provides "Copy to this project"; invalid files list provides "Rewrite it here". Error alerts display fixed copy without raw host strings. | `output-style-list.component.ts:98-180`, `:327-370` |
| **A24** | Command-line parity `<details>` | **Preserved.** P9 collapsed `<details>` "Command-line parity". When ticked, selecting a style prompts an inline P8 confirm with the exact relative display path before writing settings outside Ptah, and provides no Undo. | `output-style-list.component.ts:373-518`, `output-style-config.component.ts:140-153` |
| **A25** | Output style editor as Drawer D-OS | **Preserved.** Modal slide-over drawer built on `NativeDrawerComponent` (`widthClass="w-full max-w-lg"`). Contains Name, Description, Where to save (tier radios), Keep default instructions toggle, and Instructions with `NativeTabGroupComponent` "Edit" \| "Preview" tabs (Gap G6). Footer has "Save style" and "Cancel". Replaces in-place view swap. | `output-style-editor.component.ts:80-327`, `output-style-config.component.ts:94-106` |

---

## 4. Persisted Writes Changed

| Action | RPC Method & Parameters | Persistent Store Key / Target | Runtime Reader |
|---|---|---|---|
| **Activate style (A19 / A24)** | `outputStyle:activate { name, parity? }` | State storage key `outputStyle`; plus `.claude/settings*.json` if parity requested | Backend prompt builder (`assemble-system-prompt.ts`), `outputStyle:getActive`, `OutputStyleStore`, Claude CLI |
| **Save style (A25)** | `outputStyle:save { tier, name, description, keepCodingInstructions, body, ... }` | Markdown file in `~/.claude/output-styles/<name>.md` (user tier) or `.claude/output-styles/<name>.md` (project tier) | `outputStyle:list`, `outputStyle:get`, `OutputStyleStore`, agent prompt builder |
| **Delete style (A22)** | `outputStyle:delete { name, tier }` | Deletes file from disk in user or project output-styles folder | `outputStyle:list`, `outputStyle:getActive` |
| **Copy to project tier (A23)** | `outputStyle:copyToProject { name }` | Writes copy of user-tier style into `.claude/output-styles/<name>.md` | `outputStyle:list`, `outputStyle:getActive` |

---

## 5. Verification Results

### 1. Typecheck and Lint
```bash
npx nx run-many -t typecheck,lint -p @ptah-extension/chat
```
- **Result:** Exit code 0 (`Successfully ran targets typecheck, lint for project @ptah-extension/chat`).
- 0 lint errors, 0 typecheck errors.

### 2. Targeted Unit Test Suites
```bash
npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/settings/output-style/output-style-list.component.spec.ts libs/frontend/chat/src/lib/settings/output-style/output-style-editor.component.spec.ts libs/frontend/chat/src/lib/settings/output-style/output-style.store.spec.ts libs/frontend/chat/src/lib/settings/advanced-settings.component.spec.ts --maxWorkers=2
```
- **Result:** Exit code 0 (`Test Suites: 4 passed, 4 total; Tests: 77 passed, 77 total`).
  - `output-style-list.component.spec.ts`: 22 passed, 22 total.
  - `output-style-editor.component.spec.ts`: 24 passed, 24 total.
  - `output-style.store.spec.ts`: 20 passed, 20 total.
  - `advanced-settings.component.spec.ts`: 11 passed, 11 total.

---

## 6. Coding Standards and Engineering Hygiene

- **ChangeDetectionStrategy.OnPush**: Used across all three components.
- **Signals + `inject()`**: Angular 22 standalone architecture with `signal`, `computed`, and `linkedSignal`.
- **No `[innerHTML]`**: Instructions markdown preview renders strictly via `MarkdownBlockComponent` (`@ptah-extension/markdown`).
- **Error Copy Sanitization**: Action failures (activation, saving, deletion, copying) map to single fixed user sentences; never surfaces raw host error text or exception messages into `role="alert"`.
- **Bundle & Accessibility**: Drawer D-OS is lazily loaded via `@defer (when view() === 'editor')`. No new barrel re-exports added. Visible focus rings, native focus trapping, and ARIA roles (`role="radiogroup"`, `role="radio"`, `role="alert"`, `role="status"`, `role="alertdialog"`, `role="group"`) maintained.

---

## 7. Deviations

None. Implemented rows A19–A25, patterns P2/P4/P6/P8/P9, Gap G6 (tabbed editor with `NativeTabGroupComponent`), Gap G7 (matrix Active radio column), and D15 save feedback and error rules.

---

## 8. Copy for User Review

1. **Parity Confirmation Prompt (A24, P8)**:
   > "Write style to `<parityDisplayPath>` for `claude`? This modifies the file outside Ptah." [Confirm] [Cancel]
2. **Drawer Subtitle**:
   - Create mode: "Create a new output style"
   - Edit mode: "Modify output style"
   - Repair mode: "Rewrite invalid style file"
3. **Fixed Error Sentences (D15)**:
   - Activation failure: `"Could not change the active output style."`
   - Editor save failure: `"Could not save the output style."`
   - Delete failure: `"Could not delete the output style."`
   - Copy failure: `"Could not copy the output style to the project."`

---

## 9. Revise Round 1 (V3, V4, V5)

### Summary of Revise Fixes

1. **V3 (Disabled Action Buttons)**:
   - **Issue**: In `anubis-light` theme, disabled Edit and Delete action buttons on built-in style rows rendered as filled grey circles due to DaisyUI's default `.btn:disabled` background fill.
   - **Fix**: Replaced classes with `btn btn-ghost btn-xs btn-square disabled:bg-transparent disabled:border-transparent disabled:opacity-40 text-base-content`.
   - **Outcome**: In all themes (including `anubis-light`), disabled action buttons now look like enabled ghost icon buttons with 40% reduced opacity and zero background fill or borders. ARIA attributes and descriptive titles explaining immutability are fully preserved.

2. **V4 (Editor Drawer D-OS Footer & Textarea Sizing)**:
   - **Issue**: "Save style" was flush against the drawer's left edge below the textarea and cut off; "Cancel" was floating bottom-right. The Instructions textarea forced page-level scrolling at 1024x768.
   - **Fix**:
     - Matched `pro-features/system-prompt-drawer.component.ts` footer layout: enclosed in `@if (isOpen())` with `border-t border-base-300 px-4 py-3`, primary "Save style" button and ghost "Cancel" button.
     - Removed redundant outer `p-4` inside the drawer body container (`space-y-4 text-xs text-base-content`) since `ptah-native-drawer` already provides standard padding.
     - Sized the Instructions textarea to `rows="5"` so the footer remains pinned, prominent, and fully visible at 1024x768 without page-level scrollbars.
   - **Outcome**: The drawer footer is cleanly partitioned by a top border, and the drawer body scrolls independently when content overflows.

3. **V5 (Unused Variable Lint Warning)**:
   - **Issue**: `'error' is defined but never used` in `output-style-config.component.ts` at lines 158 and 170.
   - **Fix**: Switched `catch (error: unknown)` to bare `catch {}`.
   - **Outcome**: Zero `@typescript-eslint/no-unused-vars` warnings across all modified files.

4. **Headroom & Repo File Ceiling**:
   - **Extraction**: Extracted `OutputStyleParitySectionComponent` (`libs/frontend/chat/src/lib/settings/output-style/output-style-parity-section.component.ts`, 208 lines) to encapsulate the command-line parity `<details>` panel, tier dropdown, inline S-confirm alertdialog, written confirmation, and warning alerts.
   - **Line counts**:
     - `output-style-config.component.ts`: 198 lines (≤ 700)
     - `output-style-editor.component.ts`: 560 lines (≤ 700)
     - `output-style-list.component.ts`: 611 lines (≤ 700, ample headroom below ceiling)
     - `output-style-parity-section.component.ts`: 208 lines (≤ 700)
     - `output-style.store.ts`: 311 lines (≤ 700)
   - **Quality**: Verified zero native DOM event binding collisions (`@angular-eslint/no-output-native`).

### Revise Verification Results

- **Nx Lint & Typecheck**:
  ```bash
  npx nx run-many -t typecheck,lint -p @ptah-extension/chat
  ```
  - Exit code: 0 (`Successfully ran targets typecheck, lint for project @ptah-extension/chat`).
  - 0 errors, 0 warnings in modified files.
- **Jest Unit Test Suites**:
  ```bash
  npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/settings/output-style/output-style-list.component.spec.ts libs/frontend/chat/src/lib/settings/output-style/output-style-editor.component.spec.ts libs/frontend/chat/src/lib/settings/output-style/output-style.store.spec.ts libs/frontend/chat/src/lib/settings/advanced-settings.component.spec.ts --maxWorkers=2
  ```
  - 4 test suites passed, 77/77 tests passed:
    - `output-style-list.component.spec.ts`: 22 passed
    - `output-style-editor.component.spec.ts`: 24 passed
    - `output-style.store.spec.ts`: 20 passed
    - `advanced-settings.component.spec.ts`: 11 passed

