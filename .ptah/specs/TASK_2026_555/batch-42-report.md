# Batch 42 report — TASK_2026_555 (track B)

**Author:** antigravity CLI lane  
**Batch:** 42 — System prompt drawer D-SP; deletes `enhanced-prompts-config` (atomic, D14)

---

## 1. Summary of Changes

Batch 42 implements the System Prompt slide-over drawer (Drawer D-SP, pattern map rows A14–A18, P6) and executes the atomic retirement (D14) of `EnhancedPromptsConfigComponent`:

1. **Created `SystemPromptDrawerComponent` (D-SP)**:
   - Modal slide-over drawer built on `NativeDrawerComponent` (`@ptah-extension/ui`), styled consistently with connection and voice detail drawers (`max-w-lg`).
   - Single body with no tabs (P6):
     - **A14**: Metadata display showing the `generatedAt` timestamp and detected project stack summary (`frameworks`, `languages`, `projectType`).
     - **A15**: Regenerate flow with **S-confirm** (inline confirmation block before triggering regeneration) and inline daisyUI progress bar (Gap G5) for operations lasting up to 120 s.
     - **A16**: Download flow with **D15 fix**: a `{success:false}` or failed RPC surfaces an alert banner (`role="alert"`), eliminating silent failures.
     - **A17**: Expandable prompt preview rendered through `MarkdownBlockComponent` (`@ptah-extension/markdown`), preserving the single DOMPurify + marked XSS chokepoint (never `[innerHTML]`).
     - **A18**: Empty-state guidance displayed when no prompt has been generated yet ("Run the Setup Wizard to generate an AI-enhanced system prompt tailored to your project."), with Regenerate and Download buttons disabled.
     - **Footer**: `Regenerate` (outline) + `Download` (ghost) + `Close` (ghost).
2. **Updated `AgentBehaviourSectionComponent`**:
   - Added a `Details` column header (`th.text-right`) and an icon button (`data-testid="agent-behaviour-prompt-details"`, `ChevronRight`) in the "System prompt mode" row to open Drawer D-SP.
   - Rows 2, 3, and 4 maintain empty cells for table alignment.
   - Deferred drawer mounting via `@defer (when drawerOpen())` to preserve initial bundle constraints (under 3.5 MB error budget).
   - Reloads prompt status when the drawer emits `(changed)`.
3. **Updated `AdvancedSettingsComponent` and Specs (D14 Atomic Deletion)**:
   - Removed `<ptah-enhanced-prompts-config />` from `AdvancedSettingsComponent` template and its import.
   - Deleted `enhanced-prompts-config.component.ts` and `enhanced-prompts-config.component.spec.ts`.
   - Updated `advanced-settings.component.spec.ts` to assert that `ptah-enhanced-prompts-config` is null and verify the new 5-card layout order.
   - Confirmed no remaining references or barrel re-exports exist across the repository.

---

## 2. Files Changed, Created, and Deleted

| Status | File Path | Lines | Description |
|---|---|---|---|
| **CREATED** | `libs/frontend/chat/src/lib/settings/pro-features/system-prompt-drawer.component.ts` | 431 | Drawer D-SP implementing capabilities A14–A18, S-confirm, G5 progress, D15/F1/F2 error handling, and V1 RotateCw/Download icons |
| **CREATED** | `libs/frontend/chat/src/lib/settings/pro-features/system-prompt-drawer.component.spec.ts` | 412 | Comprehensive unit tests (14 specs) for Drawer D-SP covering metadata, empty state, markdown preview, S-confirm regenerate, D15/F1/F2 error handling, close, and V1 footer icons |
| **DELETED** | `libs/frontend/chat/src/lib/settings/pro-features/enhanced-prompts-config.component.ts` | — | Retired component (D14 atomic deletion) |
| **DELETED** | `libs/frontend/chat/src/lib/settings/pro-features/enhanced-prompts-config.component.spec.ts` | — | Retired component spec (regression test carried over to drawer spec) |
| **MODIFIED** | `libs/frontend/chat/src/lib/settings/pro-features/agent-behaviour-section.component.ts` | 420 | Added Details column/drawer trigger, V2a fixed error sentences without errorText, and V2b non-wrapping prompt status layout |
| **MODIFIED** | `libs/frontend/chat/src/lib/settings/pro-features/agent-behaviour-section.component.spec.ts` | 413 | Comprehensive unit tests (26 specs) including V2a assertions that host detail never reaches alerts or toasts |
| **MODIFIED** | `libs/frontend/chat/src/lib/settings/advanced-settings.component.ts` | 250 | Removed `ptah-enhanced-prompts-config` import and template element |
| **MODIFIED** | `libs/frontend/chat/src/lib/settings/advanced-settings.component.spec.ts` | 196 | Removed stub and import; asserted `ptah-enhanced-prompts-config` is absent (D14) |

All non-spec files comply with the repo ceiling of ≤ 700 lines.

---

## 3. Preservation of Capabilities (A14–A18)

| Item | Capability | Verdict & Implementation | Source Location |
|---|---|---|---|
| **A14** | Generated-at timestamp and detected stack summary | **Preserved in drawer body.** `generatedAt` formatted via `toLocaleString()`; `detectedStackSummary` joins frameworks, languages, and project type. | `system-prompt-drawer.component.ts:117-133` (template), `:275-290` (computed signals) |
| **A15** | Regenerate prompt with confirmation and progress up to 120 s | **Preserved with S-confirm.** Clicking "Regenerate" opens an inline confirm block (`data-testid="regenerate-confirm"`, P8). When confirmed, invokes `enhancedPrompts:regenerate {workspacePath: '.', force: true}` with 120 s timeout; displays inline `progress.progress-primary` bar (G5) and spinner. On `{success:false}` or RPC error, surfaces failure alert and skips status reload. On success, re-reads status and emits `(changed)`. | `system-prompt-drawer.component.ts:135-181` (template), `:340-381` (methods) |
| **A16** | Download prompt as `.md` file | **Preserved with D15 fix.** Invokes `enhancedPrompts:download`. If the RPC fails or returns `{success:false}` (including user cancellation), an alert banner is surfaced (`role="alert"`, `data-testid="system-prompt-drawer-error"`), preventing silent failures. | `system-prompt-drawer.component.ts:221-236` (template), `:383-405` (method) |
| **A17** | View / Hide generated prompt preview | **Preserved via markdown block.** Toggle button with `aria-label="Toggle Prompt Preview"`. Fetches prompt content via `enhancedPrompts:getPromptContent` on first expansion and renders through `<ptah-markdown-block [content]="content" />` (never `[innerHTML]`). | `system-prompt-drawer.component.ts:183-207` (template), `:407-434` (method) |
| **A18** | Empty-state guidance | **Preserved.** When `!hasGeneratedPrompt()`, displays "Run the Setup Wizard to generate an AI-enhanced system prompt tailored to your project." Regenerate and Download buttons are disabled. | `system-prompt-drawer.component.ts:208-216` (template), `:224, 237` (disabled bindings), `:269-273` (computed) |

---

## 4. Persisted Writes Changed

| Action | RPC Method & Parameters | Persistent Store Key / Target | Runtime Reader |
|---|---|---|---|
| **Regenerate prompt (A15)** | `enhancedPrompts:regenerate {workspacePath: '.', force: true}` (120 s timeout) | Writes markdown prompt to `.ptah/analysis/enhanced-prompt.md` and metadata to `.ptah/analysis/enhanced-prompt.json` | `enhancedPrompts:getStatus`, `enhancedPrompts:getPromptContent`, and backend agent prompt builder (`libs/backend/agent-sdk/src/lib/helpers/assemble-system-prompt.ts`) |
| **Download prompt (A16)** | `enhancedPrompts:download {workspacePath: '.'}` | User-selected `.md` file via host save dialog (`SaveDialogProvider.showSaveAndWrite`) | User filesystem |

*Note: The on/off mode toggle (`enhancedPrompts:setEnabled`) remains in the "Agent behaviour" card row 1 as moved in Batch 41.*

---

## 5. Verification Results

All required verification checks passed:

### 1. Typecheck and Lint
```bash
npx nx run-many -t typecheck,lint -p @ptah-extension/chat
```
- **Result:** Exit code 0 (`Successfully ran targets typecheck, lint for project @ptah-extension/chat`).
- 0 lint errors, 0 typecheck errors.

### 2. Targeted Unit Test Suites
```bash
npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/settings/pro-features/system-prompt-drawer.component.spec.ts libs/frontend/chat/src/lib/settings/pro-features/agent-behaviour-section.component.spec.ts libs/frontend/chat/src/lib/settings/advanced-settings.component.spec.ts --maxWorkers=2
```
- **Result:** Exit code 0 (`Test Suites: 3 passed, 3 total; Tests: 53 passed, 53 total`).
  - `system-prompt-drawer.component.spec.ts`: 14 passed, 14 total.
  - `agent-behaviour-section.component.spec.ts`: 26 passed, 26 total.
  - `advanced-settings.component.spec.ts`: 13 passed, 13 total.

---

## 6. Coding Standards and Engineering Hygiene

- **ChangeDetectionStrategy.OnPush**: Used on all components.
- **Signals + `inject()`**: Standard Angular 22 standalone pattern used throughout.
- **No `[innerHTML]`**: Prompt preview strictly uses `MarkdownBlockComponent` (`@ptah-extension/markdown`).
- **Error Handling**: Standardized fixed error sentences across all drawer failure states; never surfaces raw backend/RPC error text into the alert banner (F1).
- **Cancellation Handling**: User cancellation from file save dialog (`Save cancelled by user`) surfaces no error alert and no success alert (F2).
- **Typing Integrity**: Zero `@ts-ignore`, zero new `as any`.
- **Bundle Hygiene**: Drawer is loaded lazily inside `@defer (when drawerOpen())` and is **not** re-exported from `libs/frontend/chat/src/lib/settings/index.ts`.
- **Accessibility**: Full keyboard reachability, visible focus rings, native focus trap inside `NativeDrawerComponent`, correct ARIA roles (`role="dialog"`, `role="alert"`, `role="status"`, `role="group"`), and `aria-label`s preserved.

---

## 7. Deviations

None. All pattern map requirements (rows A14–A18, P6 drawer, S-confirm, D14 atomic deletion, and D15 error handling) were followed.

---

## 8. Copy for User Review

The following user-facing strings were added or updated:
1. **Regenerate Confirmation Note**:
   > "Regenerate replaces your current project system prompt with fresh guidance tailored to your project. This may take up to 2 minutes."
2. **Drawer Subtitle**:
   - Ready state: "Project-tailored system prompt for AI sessions"
   - Empty state: "No prompt generated yet"
   - Loading state: "Loading system prompt…"
3. **Fixed Error Alert Sentences (F1)**:
   - Status failure: `"Could not load the system prompt status."`
   - Regenerate failure: `"Could not regenerate the system prompt."`
   - Download failure: `"Could not download the system prompt."`
   - Preview failure: `"Could not load the prompt preview."`

---

## 9. Revise Round 1 (F1, F2, F3)

Address orchestrator review feedback:

1. **F1 (D15 / No raw error text in UI alert banners)**:
   - In `system-prompt-drawer.component.ts`, removed the dynamic `errorText` extraction helper.
   - Introduced four fixed user-facing error sentence constants:
     - `PROMPT_STATUS_LOAD_FAILED = 'Could not load the system prompt status.'`
     - `PROMPT_REGENERATE_FAILED = 'Could not regenerate the system prompt.'`
     - `PROMPT_DOWNLOAD_FAILED = 'Could not download the system prompt.'`
     - `PROMPT_PREVIEW_LOAD_FAILED = 'Could not load the prompt preview.'`
   - Ensured no raw host/RPC error string or exception message leaks into `role="alert"`.
   - Updated and added spec assertions in `system-prompt-drawer.component.spec.ts` asserting exact fixed sentences and verifying absence of raw host strings.

2. **F2 (Cancel is not failure)**:
   - When the user cancels file download dialog, the backend returns `{ success: false, error: 'Save cancelled by user' }` (`enhanced-prompts-rpc.handlers.ts:631`).
   - Defined `DOWNLOAD_CANCELLED_BY_USER = 'Save cancelled by user'` with comment referencing line 631.
   - Guarded in `downloadEnhancedPrompt`: if `result.data.error === DOWNLOAD_CANCELLED_BY_USER`, the method returns quietly without setting any error alert.
   - Added unit test in `system-prompt-drawer.component.spec.ts` asserting `error` signal remains null on cancel.

3. **F3 (Author designation)**:
   - Set author in `batch-42-report.md` to `antigravity CLI lane`.

---

## 10. Revise Round 2 (V1, V2a, V2b)

Address orchestrator review feedback:

1. **V1 (Drawer Footer Action Icons)**:
   - In `system-prompt-drawer.component.ts`:
     - Replaced rotated `ArrowLeft` icon with `RotateCw` from `lucide-angular` on the Regenerate button.
     - Replaced `ExternalLink` icon with `Download` from `lucide-angular` on the Download button.
     - Removed obsolete `ArrowLeft` and `ExternalLink` imports and properties.
   - In `system-prompt-drawer.component.spec.ts`:
     - Added test suite `footer action icons (V1)` asserting that `RotateCwIcon === RotateCw` and `DownloadIcon === Download`.

2. **V2a (Eliminate Raw Host Error Text in `AgentBehaviourSectionComponent`)**:
   - In `agent-behaviour-section.component.ts`:
     - Removed `errorText` helper function completely.
     - Replaced raw host error text in load alerts (:357, :371) and toast messages (:382, :384, :406, :407) with fixed sentences matching the actions:
       - System prompt status load failure: `'Could not load the system prompt status.'`
       - System prompt mode write failure: `'Could not save the system prompt mode.'`
       - Dynamic workflows load failure: `'Could not load the dynamic workflows setting.'`
       - Dynamic workflows write failure: `'Could not save the dynamic workflows setting.'`
   - In `agent-behaviour-section.component.spec.ts`:
     - Added specs for thrown Errors, structured failures (`{success:false, error: 'host detail'}`), and RPC errors.
     - Asserted that `'host detail'` is never leaked to alert banners or toasts.

3. **V2b (System Prompt Mode Row Wrapping Fix)**:
   - In `agent-behaviour-section.component.ts` (template):
     - Placed the badge on its own line (`<div><span class="badge ...">...</span></div>`).
     - Placed "Active for all sessions" / "Standard system prompt" as a `text-xs opacity-70 text-base-content-muted whitespace-nowrap` line below it.
     - Completely prevents mid-phrase wrapping ("Active for / all sessions") at any viewport width.

4. **Verification**:
   - `npx nx run-many -t typecheck,lint -p @ptah-extension/chat`: 0 errors, 0 warnings.
   - Targeted unit tests: 53 passed, 53 total across 3 suites.
   - Non-spec file length ceilings:
     - `system-prompt-drawer.component.ts`: 431 lines ($\le 700$).
     - `agent-behaviour-section.component.ts`: 420 lines ($\le 700$).
     - `advanced-settings.component.ts`: 250 lines ($\le 700$).

