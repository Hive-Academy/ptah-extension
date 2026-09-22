# Batch D-i Part 5 Report: Provider Consumer Assignments — TASK_2026_523_c3df

Implementation of `ProviderConsumerAssignmentsComponent` and its colocated test suite for Batch D-i, part 5.

## Files changed

- **CREATED** [`libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts`](file:///D:/projects/ptah-extension/libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts) — Standalone Angular 22 OnPush component managing the six background-consumer rows in fixed canonical order and the enhancement timeout setting. (696 lines, under the 700-line ceiling).
- **CREATED** [`libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.spec.ts`](file:///D:/projects/ptah-extension/libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.spec.ts) — 26 unit test cases covering row ordering, mandatory helper copy, sentinel translation in both directions, inline editing isolation, unavailable provider readiness handling, draft preservation, timeout bounds and validation, timeout notices, scope strips, and accessibility.

## Rows

The component renders six background-consumer rows in exact, immutable order. Rows are not sorted by provider ID or availability.

| # | Consumer Name | Settings Keys Written | Write Path / RPC Method | Default Tier | Tool Use Required | Helper Copy |
|---|---|---|---|---|---|---|
| 1 | **Memory curator** | `memory.curatorProvider`<br>`memory.curatorModel` | `ProvidersSettingsStateService.saveSettings({ memory: { ... } }, context)` → `memory:setTriggers` | `haiku` | `false` | None |
| 2 | **Archaeologist lane** | `skillSynthesis.archaeologist.provider`<br>`skillSynthesis.archaeologist.model` | `ProvidersSettingsStateService.saveSettings({ lanes: { archaeologist: { ... } } }, context)` → `skillSynthesis:setLanes` | `haiku` (or from lane DTO) | `true` (`lane.toolUse === 'required'`) | None |
| 3 | **Synthesis lane** | `skillSynthesis.synthesis.provider`<br>`skillSynthesis.synthesis.model` | `ProvidersSettingsStateService.saveSettings({ lanes: { synthesis: { ... } } }, context)` → `skillSynthesis:setLanes` | `haiku` (or from lane DTO) | `false` | None |
| 4 | **Judge lane** | `skillSynthesis.judge.provider`<br>`skillSynthesis.judge.model` | `ProvidersSettingsStateService.saveSettings({ lanes: { judge: { ... } } }, context)` → `skillSynthesis:setLanes` | `haiku` (or from lane DTO) | `false` | None |
| 5 | **Replay lane** | `skillSynthesis.replay.provider`<br>`skillSynthesis.replay.model` | `ProvidersSettingsStateService.saveSettings({ lanes: { replay: { ... } } }, context)` → `skillSynthesis:setLanes` | `haiku` (or from lane DTO) | `false` | None |
| 6 | **Judging & enhancement** | `skillSynthesis.judgeProvider`<br>`skillSynthesis.judgeModel` | `ProvidersSettingsStateService.saveSettings({ judging: { ... } }, context)` → `skillSynthesis:updateSettings` | `haiku` | `false` | “Used for judging and for Enhance now on skills, agents, and commands. The Judge lane is configured separately above.” |

Editing any of these rows mutates only its specific domain keys and never mutates the active main route or auth keys.

## Sentinel

`ProviderModelPickerComponent` spells inherit as `''`. In the backend, `resolveJudgeModel` (`model-resolver.ts:171`) recognizes only the literal `'inherit'` and passes any other string (including empty `''`) verbatim to the provider, which would silently break skill enhancement.

`ProviderConsumerAssignmentsComponent` owns the translation at its binding:

- **Read direction (backend to picker)**: `toPickerModel(model)` converts `'inherit'` to `''`. An explicit model ID (e.g. `'claude-3-5-sonnet'`) is preserved verbatim.
  - Pinned by spec: `pure function toPickerModel maps "inherit" to empty string`
  - Pinned by spec: `READ direction: adapts stored "inherit" to picker sentinel "" for Judging & enhancement`
  - Pinned by spec: `READ direction: preserves explicit model name when stored in Judging & enhancement`
- **Write direction (picker to backend)**: `toBackendJudgeModel(model)` converts `''` or whitespace to `'inherit'`. An explicit model ID is preserved and trimmed.
  - Pinned by spec: `pure function toBackendJudgeModel maps empty or whitespace string to "inherit"`
  - Pinned by spec: `WRITE direction: maps picker "" sentinel to backend "inherit" upon save`
  - Pinned by spec: `WRITE direction: writes explicit model string when selected in picker`

## Timeout field

The **Enhancement time limit** field is placed directly beneath the Judging & enhancement editor.

- **Backend-owned bounds**: The UI never invents the range. Bounds are derived dynamically from `ProvidersSettingsStateService.judging().data?.enhanceTimeoutMs`:
  - `minSec`: `Math.round(enhanceTimeoutMs.min / 1000)` (15 seconds)
  - `maxSec`: `Math.round(enhanceTimeoutMs.max / 1000)` (600 seconds)
  - `defaultSec`: `Math.round(enhanceTimeoutMs.default / 1000)` (120 seconds)
  - `effectiveSec`: `Math.round(enhanceTimeoutMs.value / 1000)` (120 seconds)
- **Pre-edit display**: Displays the current effective duration (`Time limit: 120 seconds`) even before editing, with helper copy: *“Maximum time allowed for one enhancement attempt.”*
- **Validation**: Rejects inputs below `minSec` or above `maxSec` with the exact message: `Must be between 15 and 600 seconds.`, disabling the Save limit button.
- **Save conversion**: Input is gathered in seconds and converted to milliseconds (`sec * 1000`) before calling `saveSettings({ judging: { enhanceTimeoutMs: ms } })`, matching `SkillSynthesisSettingsWriteDto`.
- **Timeout notification**: When `timeoutNotice` is input (e.g. from an abort in an enhancement attempt), the component renders:
  `Enhancement stopped after {seconds} seconds. No changes were saved.`
  along with a **Retry** button (emits `retryEnhancementRequested`) and a **Change time limit** button (expands the timeout editor and focuses the input).

## Unavailable provider

When a user selects a provider in the inline editor that is not ready or not connected:

1. **Readiness message**: Renders the exact one-line copy from `design-spec.md`'s state table:
   - `needs-key`: “Add an API key to connect {provider}.”
   - `unauthenticated`: “Your credential is missing or expired; authenticate again.”
   - `unreachable`: “Could not reach {provider}; check the connection and retry.”
   - `not-installed`: “Install {CLI} to use this connection.”
   - `not-configured` (or missing/unknown): “Set up {provider} when you are ready.”
2. **Set up deep link**: Renders a button `Set up {provider}` that emits `setupProviderRequested(providerId)`.
3. **Draft preservation**: The user's selection in `ProviderModelPickerComponent` is retained in component state (`currentDraft`) and not discarded or reset.
4. **No unexplained disabled Save**: Save is disabled while the drafted provider is unavailable, and the readiness message is displayed immediately adjacent to Save, explaining why saving is blocked.

## Accessibility

- **Control height**: All buttons and inputs observe the `min-h-9` (36 px) minimum control height and ≥24 px target size requirement.
- **Focus appearance**: Interactive elements carry visible 2 px focus rings: `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content`.
- **Contrast**: Text uses `text-base-content` on `bg-base-100`, borders use `border-base-content-muted`, and card containers use `bg-base-200/40` with an opaque `bg-base-100` inset for scope rows.
- **Semantic structure**: DaisyUI utility classes and semantic HTML (`button`, `input`, `label`, `h2`, `h3`, `h4`, `section`); no deprecated `NativeButton` or `NativeRadio` usage.
- **Accessible names**: All action buttons include the consumer or field name in `aria-label` (e.g. `aria-label="Edit Memory curator"`).
- **Safe rendering**: Zero `[innerHTML]` bindings; all strings are interpolated safely through Angular template expressions.

## Verification

All commands executed with `NX_DAEMON=false` and `NX_CACHE_DIRECTORY=D:\projects\ptah-extension\.nx\verify-cache`:

1. **Unit tests (`@nx/jest`)**:
   ```powershell
   npx nx test chat --testFile=provider-consumer-assignments.component.spec.ts
   ```
   Output:
   ```
   PASS chat libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.spec.ts
     ProviderConsumerAssignmentsComponent
       1. Fixed Order and Header Copy
         √ renders heading copy and description (232 ms)
         √ renders exactly six rows in fixed canonical order (48 ms)
         √ renders mandatory helper copy on Judging & enhancement only (42 ms)
       2. Sentinel Translation (Pinned in Both Directions)
         √ pure function toPickerModel maps "inherit" to empty string (30 ms)
         √ pure function toBackendJudgeModel maps empty or whitespace string to "inherit" (33 ms)
         √ READ direction: adapts stored "inherit" to picker sentinel "" for Judging & enhancement (61 ms)
         √ READ direction: preserves explicit model name when stored in Judging & enhancement (39 ms)
         √ WRITE direction: maps picker "" sentinel to backend "inherit" upon save (42 ms)
         √ WRITE direction: writes explicit model string when selected in picker (43 ms)
       3. Inline Editing and Row Isolation
         √ expands one inline editor at a time and closes previous on switching (42 ms)
         √ cancels edit and discards draft when Cancel is clicked (33 ms)
         √ saves lane draft to lanes patch (36 ms)
         √ saves memory curator draft to memory patch (36 ms)
       4. Unavailable Provider and Draft Preservation
         √ shows exact state-table copy for not-configured provider and preserves draft (49 ms)
         √ emits setupProviderRequested with provider id when Set up button is clicked (40 ms)
         √ renders needs-key readiness message for provider requiring key (46 ms)
         √ renders not-installed readiness message for CLI provider (33 ms)
         √ renders unreachable readiness message when probe failed (36 ms)
         √ renders unauthenticated readiness message when credential expired (33 ms)
       5. Enhancement Time Limit Control
         √ displays effective seconds before editing from backend data (22 ms)
         √ derives bounds from backend enhanceTimeoutMs rather than inventing range (29 ms)
         √ validates against backend bounds and shows validation error on out-of-range (40 ms)
         √ saves timeout converted to milliseconds and emits timeoutSaved (28 ms)
         √ handles timeoutNotice by showing alert and Retry/Change time limit links (30 ms)
       6. Scope Provenance and Accessibility
         √ renders scope row for provider, model, and timeout (22 ms)
         √ complies with min-h-9 (36 px) control heights and focus outline classes on buttons (27 ms)

   Test Suites: 1 passed, 1 total
   Tests:       26 passed, 26 total
   Snapshots:   0 total
   Time:        3.35 s
   ```

2. **Typecheck (`npx ngc`)**:
   ```powershell
   npx nx typecheck chat
   ```
   Output:
   ```
   > nx run @ptah-extension/chat:typecheck
   > npx ngc --noEmit --project libs/frontend/chat/tsconfig.lib.json
   Successfully ran target typecheck for project @ptah-extension/chat
   ```
   Zero errors.

3. **Lint (`@nx/eslint`)**:
   ```powershell
   npx nx lint chat
   ```
   Output:
   ```
   > nx run @ptah-extension/chat:lint
   Linting "@ptah-extension/chat"...
   19 problems (0 errors, 19 warnings)
   Successfully ran target lint for project @ptah-extension/chat
   ```
   Zero errors and zero warnings across both new files (`provider-consumer-assignments.component.ts` and `provider-consumer-assignments.component.spec.ts`). All 19 warnings pre-existed in untouched files in the repository.

## Deviations

None. The component implements the exact contracts specified in `design-spec.md` and `implementation-plan.md`.

## Not done

- Not mounted into `SettingsComponent` yet (per task objective, mounting and entry point transitions are owned by the atomic Batch D-ii / D-iii).
- No export barrel created in `libs/frontend/chat/src/lib/settings/providers/` (orchestrator creates this once).

## Clarifications Needed

None. All requirements resolved cleanly from codebase evidence and specifications.
