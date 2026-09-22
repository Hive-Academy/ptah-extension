# Batch D-i Part 5 Repair Report: Provider Consumer Assignments — TASK_2026_523_c3df

Repair of `ProviderConsumerAssignmentsComponent` after an interrupted lane run. Scope: `provider-consumer-assignments.component.ts` and its colocated spec only.

## State found

- The component file was 695 lines, larger than the 623 lines the task described. The interrupted run had already made edits, but the file compiled and all 26 existing spec cases passed at the baseline.
- The fabricated timeout fallback was present at the reported site: `enhanceTimeoutMeta` returned `{ value: 120000, default: 120000, min: 15000, max: 600000 }` whenever the judging read had not landed.
- All three `?? 'global'` provenance guesses were present: `makeRow` provider scope, `makeRow` model scope, and `timeoutScope`.
- The `rows` computed read each section's `data` with `?? ''` fallbacks and no status check. A not-loaded section rendered empty-string values as effective assignments.
- The deep-link input `initialEditingConsumerId` was read once in the constructor, so later changes were ignored.
- The spec's `scopeEntry` mock fabricated a `'global'` entry for every unknown key. This masked defect 2. I changed the mock to return the real entry or `null`. This change is part of the repair, not a break.
- One test failure appeared during the repair. It was my own new spec case: I expected the display name `Anthropic`, but `formatProviderDisplayName('anthropic')` resolves to lowercase `anthropic`. I corrected the expected string. No pre-existing test was broken by the interrupted edit.

## Defects fixed

### Defect 1 — fabricated timeout metadata

- Removed the `{ 120000, 120000, 15000, 600000 }` fallback. `timeoutMeta` (was `enhanceTimeoutMeta`) now returns `judging().data?.enhanceTimeoutMs ?? null` only.
- The whole Enhancement time limit block is gated on `@if (row.id === 'judging-enhancement' && timeoutMeta(); as meta)`. When the backend payload is absent, no number renders, and the Edit limit button does not render.
- Because the Judging & enhancement row also gates on section load (defect 3), an unloaded judging section renders the row-level not-loaded state with its own Retry button. That Retry calls `state.refreshJudging()`.
- The `timeoutDraftSec` seed literal `120` is now `0`; it is only a draft seed, and `editTimeout()` seeds it from the backend value. `editTimeout()` and `isTimeoutSaveDisabled` are guarded when `timeoutMeta()` is null.
- `timeoutMinSec`, `timeoutMaxSec`, `timeoutDefaultSec` and `timeoutEffectiveSec` derive from the payload only (`?? 0` when unrendered).
- Pinned by spec: `renders no timeout number while the judging read has not landed` (asserts no `timeout-effective-display`, no `timeout-edit-button`, no `Time limit:` and no `120` in the rendered text).
- Pinned by spec: `derives the timeout range and default from the backend payload only` (payload `{ value: 60000, default: 45000, min: 30000, max: 90000 }` renders `Time limit: 60 seconds` and `Allowed: 30–90 seconds (default 45 seconds)`).

### Defect 2 — unknown provenance rendered as Global

- All three `?? 'global'` occurrences now fall back to `'mixed'`. `SettingScopeRowComponent` renders `'mixed'` as the **Mixed sources** badge, per Decision 6: never substitute a guessed group scope. I did not modify `SettingScopeRowComponent`.
- The spec mock no longer fabricates a `'global'` entry for unknown keys.
- Pinned by spec: `renders Mixed sources when the scope source is unknown` (memory keys with entries show `From Global · All Ptah apps`; the lane provider badge and the timeout badge show `Mixed sources`).

### Defect 3 — all six rows built from empty-string defaults regardless of section status

- `rows` now passes each row's source section to `makeRow`. The row carries `sectionStatus` (`ProvidersSettingsSection.status`), `loaded` (`data !== null`), and `retryKey` (`'memory' | 'lanes' | 'judging'`).
- This consumes the state service's distinction directly: `data === null` is not loaded; ready data with empty strings is loaded and empty and renders as an effective assignment.
- A row with no data renders name, helper copy, a not-loaded block (`consumer-notloaded-{id}`) with `Loading…` while loading, or `Could not load this section. Retry.` plus a Retry button otherwise. The effective summary, scope strips, and Edit button do not render. `toggleEdit()` refuses to open an editor for an unloaded row.
- A row with data but section status `'error'` (stale previous data) renders a reload strip with the same copy and Retry.
- `retrySection()` re-reads only the requested section: `refreshMemory`, `refreshLanes`, or `refreshJudging`.
- Pinned by spec: `renders a not-loaded state with retry when a section read has not landed` (row order intact, no summary, no Edit, retry calls `refreshMemory` and nothing else).
- Pinned by spec: `renders Loading without retry while a section is loading`.
- Pinned by spec: `renders an effective empty assignment when the section is loaded and empty` (pins the not-loaded versus loaded-and-empty distinction).

### Deep-link reactivity (also required)

- `initialEditingConsumerId` is now applied in an `effect()`. Each new non-null value applies once (`appliedDeepLinkId`), so a user cancel is not fought and a stale value does not re-open an editor.
- Pinned by spec: `applies the deep-link input reactively after mount` (input set after mount opens the editor; a later different value switches it).

## Untouched

- `toPickerModel` and `toBackendJudgeModel` are byte-identical to the state I received. Their four pinning spec cases still pass unchanged.
- The six rows remain in the fixed canonical order: memory-curator, archaeologist, synthesis, judge, replay, judging-enhancement.
- `ProviderModelPickerComponent` from `@ptah-extension/ui` is still the only selector; the picker was not modified.
- `SettingScopeRowComponent` was not modified.
- No `index.ts` barrel was created. No file outside the component and its spec was touched.

## Verification

All Nx commands ran with `NX_DAEMON=false` and `NX_CACHE_DIRECTORY=D:\projects\ptah-extension\.nx\verify-cache-glm`.

1. Baseline before repair: `npx nx test chat --testFile=provider-consumer-assignments.component.spec.ts` → `Tests: 26 passed, 26 total`.
2. After repair, same command → `Tests: 33 passed, 33 total` (26 kept, 7 added; one added case needed a display-name correction).
3. `npx nx typecheck chat` → `NX Successfully ran target typecheck for project @ptah-extension/chat`, exit 0. One earlier run failed with errors in `libs/frontend/core/src/lib/services/providers-settings-state.service.ts` (TS2339 `name`/`hasApiKey`/`baseUrlOverridden`, TS2345 on `ProvidersExternalAuth`). That file is the other lane's work in progress; a re-run after their edit landed passed. I did not fix those errors. No error ever pointed at `provider-consumer-assignments.component.ts` or its spec.
4. `npx nx lint chat` → `NX Successfully ran target lint for project @ptah-extension/chat`, exit 0.
5. `npx nx test chat --skip-nx-cache` (full suite) → `Test Suites: 91 passed, 91 total`, `Tests: 2 skipped, 1490 passed, 1492 total`. Jest also printed its usual worker teardown warning, pre-existing behavior of the suite.
6. One transient Nx failure occurred: a plugin worker (`project-json`) exited before load, while the other lane ran Nx concurrently. A retry passed. This is environment, not code.

## Deviations

- Provenance unknown renders as the **Mixed sources** badge, the state `SettingScopeRowComponent` already supports. The task named Decision 6 and that component; no separate "Unknown" badge was added.
- A not-loaded section hides the Edit button and scope strips, because editing or showing provenance of values that were never read would be more invention of the same kind. Retry replaces them.
- An error section that still holds previous data renders values plus a reload strip instead of blanking them. This follows the design spec's rule that loading or re-reading does not erase the last saved configuration.

## Not done

- The component is now 794 lines, above the 700-line soft ceiling (was 695 at baseline). The honest states added the lines. A split would need an orchestrator-owned decision; I did not split a component I was asked to repair in place.
- The other lane's files (`libs/frontend/core`, `providers-settings.component.ts`) were read but never modified, as instructed.
- No git operations were performed.

## Clarifications Needed

None. All three defects, the deep-link change, and the scope limits resolved cleanly from the implementation plan, the design spec, and the state service source.