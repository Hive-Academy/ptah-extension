# Settings page defects

## 1. Narrow container

- **Root cause:** `libs/frontend/chat/src/lib/settings/settings.component.html:17` wrapped every settings tab in `max-w-4xl` (56rem). The CLI matrix, background roles, and session-budget grid all sat inside that cap.
- **Fix:** The shell is now `w-full max-w-screen-2xl` (96rem) with the same horizontal padding. The providers tab comment that named `max-w-4xl` was updated. Form grids stay responsive; they were already `sm:grid-cols-2` inside the page.
- **Files:** `settings.component.html`, `providers-settings.component.ts` (comment only).

## 2. Lag when changing providers

- **Root cause:** `libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-picker.component.ts` loaded the model catalogue from an effect that read both the provider and the model inputs, and `onProviderChange` loaded again. A model change, and the parent echoing the provider just selected, each started another `provider:listModels` round trip.
- **Fix:** `loadModels` records the provider it is fetching. The effect skips when that provider is already loaded or in flight. Retry still calls `loadModels` directly. Last-write-wins (`loadGeneration`) is unchanged.
- **Files:** `provider-model-picker.component.ts`.

## 3. Raw CLI stdout on the page

- **Root cause:** Probe text reached the page in three places.
  - `cliVersionLabel` in `cli-matrix-rows.ts` returned the whole `--version` string when it had no version token, and the matrix put `row.version` in the version tooltip (`cli-orchestration-matrix.component.ts`, version span).
  - `cliModelDisplay` rendered a saved model value as-is, including a multi-line `models` probe.
  - `ProviderModelPickerComponent.loadModels` assigned `result.error` and `Error.message` straight into the alert, and listed every catalogue entry. `CliModelEffortPopoverComponent.modelOptions` did the same for `agent:listCliModels`.
- **Fix:** `isCliProcessDump` treats a newline, a string longer than 180 characters, or a leading `usage:` / `error:` / `warning:` / `stdout` / `stderr` line as process output. Version labels keep a version token and otherwise show nothing. Model cells show "Model unavailable". The picker and the CLI model popover drop those entries and show "Could not load models for this provider." or the existing "The model list could not be loaded." Short status sentences (`auth failed`, `transport down`) still render. The probe and `provider:listModels` handlers already log the raw text; this change does not add a second log.
- **Files:** `cli-matrix-rows.ts`, `cli-matrix-rows.spec.ts`, `cli-orchestration-matrix.component.ts`, `cli-model-effort-popover.component.ts`, `provider-model-picker.component.ts`.

## 4. Provider icons

- **Root cause:** The matrix provider column and the provider `<select>`s rendered names only. The shared mark is `ProviderMarkComponent` (`ptah-provider-mark`) at `libs/frontend/ui/src/lib/native/provider-mark/provider-mark.component.ts`. The Analytics quota cards (`provider-account-card.component.ts`) bind `[providerId]` and let that component resolve the glyph.
- **Fix:** The matrix provider cell (wide column and the narrow fold) and both provider selectors (the shared picker, and the add/edit Ptah CLI instance modal) render that same component. Instance rows pass `providerId`. System rows pass the CLI id. There is no new icon table: unknown ids use the component's own fallback (`Terminal` on matrix rows, `Bot` on the selectors, the same default the quota cards leave unset). The effort column was not edited.
- **Files:** `cli-orchestration-matrix.component.ts`, `provider-model-picker.component.ts`, `add-cli-instance-modal.component.ts`.

## Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat,@ptah-extension/ui --parallel=1`
  - `@ptah-extension/ui` typecheck: pass
  - `@ptah-extension/ui` lint: pass
  - `@ptah-extension/chat` lint: pass
  - `@ptah-extension/chat` typecheck: fail. Errors name `grokReasoningEffort` and `antigravityReasoningEffort` on `CliEffortSettingKey` (`cli-matrix-rows.ts`), which are not fields of `ProvidersOrchestration`. Those keys were added by the parallel effort-column edit. Also a pre-existing error in `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:1310` (`cacheReported` is read-only). Neither is from the width, lag, stdout, or icon edits.
- Later `npx nx test` calls did not start: Nx plugin workers exited before connect. Specs were run with the project Jest configs instead (`--coverage=false`, `--maxWorkers=2`).
  - `provider-model-picker.component.spec.ts`: 66 passed.
  - `cli-model-effort-popover.component.spec.ts`: passed.
  - `add-cli-instance-modal.component.spec.ts`: passed.
  - `cli-matrix-rows.spec.ts`: 1 failed, `exposes effort cells for Antigravity and Grok` — `row('grok')` is not in the prototype fixture. That test belongs to the parallel effort edit.
  - `cli-orchestration-matrix.component.spec.ts`: the narrow-provider truncation test failed once because the icon wrapper dropped `truncate`, then passed after the class was restored. One remaining failure, `shows versions, providers and the CLI defaults`, expects no Antigravity effort control. That expectation is the parallel effort edit, not this layout change.
- The full `nx run-many -t test` for these two projects was not run.

## Decisions

- Cap the page at `max-w-screen-2xl` rather than an uncapped full bleed, so the two-column budget fields stay readable on very wide monitors.
- Reuse `ProviderMarkComponent` only, the same component the Analytics quota cards use. No icon map was added. The component's own tables resolve the id; unknown ids fall back inside that component. `BrandMarkComponent` was not added.
- Process dumps are replaced with a fixed sentence. One-line messages of 180 characters or fewer stay, so existing picker specs keep their assertions.
- Effort-column types and templates were left as the other edit had them.

## Not done

- Chat project typecheck is red because of the in-progress effort keys and an unrelated `cacheReported` assignment.
- Two specs that assert the old "no effort for Antigravity/Grok" behaviour fail while that parallel edit is in the same files.
- Nx test could not be launched after the typecheck run.
- No browser pass. The webview was not started.
