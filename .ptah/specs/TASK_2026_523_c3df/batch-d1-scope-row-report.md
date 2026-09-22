# Batch D1 — SettingScopeRowComponent report

Task: `TASK_2026_523_c3df` · Batch D-i, part 2 (the setting scope row) · 22 September 2026

## Files changed

- CREATED `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\providers\setting-scope-row.component.ts` — presentational scope row: source strip, override and clear actions, clear-target preview, credential line.
- CREATED `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\providers\setting-scope-row.component.spec.ts` — 21 tests over every state, the write-honesty rule, intents, and accessibility.

Nothing else was created in `settings/providers/`. No barrel, no other file touched, nothing outside the batch scope, no git commands run.

## Component API

Selector `ptah-setting-scope-row`; standalone, `ChangeDetectionStrategy.OnPush`, signal inputs and `output()` intents. It performs no RPC call and owns no persistence.

Inputs:

| Input | Type | Default | Purpose |
| --- | --- | --- | --- |
| `fieldName` | `string` | `''` | Included in button accessible names where labels repeat. |
| `scope` | `SettingScope \| 'mixed' \| null` | `null` | Winning source, `mixed` for a group with no shared scope, `null` for nothing stored. |
| `hasOverride` | `boolean` | `false` | True when the winning layer is an override. |
| `supportedTargets` | `readonly SettingScope[]` | `[]` | Write targets the backend supports. Unknown targets hide the actions. |
| `fallbackPreview` | `{ scope: SettingScope; value: unknown } \| null` | `null` | DTO preview for the clear review. |
| `fallbackValueLabel` | `string \| null` | `null` | Parent-preformatted fallback value, rendered verbatim. |
| `workspaceName` | `string \| null` | `null` | Workspace badge and workspace fallback preview. |
| `workspaceCrossApp` | `boolean` | `false` | Renders "(All Ptah apps)" instead of "(Desktop)". |
| `defaultLabel` | `string \| null` | `null` | Copy for "nothing stored"; defaults to "App default · Not configured". |
| `credentialSource` | `'machine-secret-store' \| 'host-supplied' \| 'not-a-secret' \| null` | `null` | Credential discriminator from `ScopedSettingEntry`. |
| `credentialDescription` | `string \| null` | `null` | Host-supplied credential copy; overrides the default. |
| `hasIntermediateAppLayer` | `boolean` | `false` | Shows **Use global value** beside **Clear override**. |
| `showCopyGlobal` | `boolean` | `false` | Host-gated **Copy global value to this workspace**. |
| `disabled` | `boolean` | `false` | Disables the action buttons. |
| `disabledReason` | `string \| null` | `null` | Explanatory copy kept visible beside disabled controls. |

Outputs (each `output<void>`, no side effects in the component):

| Output | Meaning |
| --- | --- |
| `overrideRequested` | Open the override editor (host preselects the write target). |
| `clearRequested` | Clear the winning override — maps to `target: 'nearest'`. |
| `useGlobalRequested` | Return to the global value — maps to `target: 'all-above-global'`. |
| `copyGlobalRequested` | Copy the global value into this workspace. |

Types `SettingScopeDisplay`, `CredentialSource` and `ScopeFallbackPreview` are exported from the component file. `SettingScope` is imported from `@ptah-extension/shared`; nothing was redeclared.

## States

One line per state the scope affordance spec defines, and how this row renders it.

- **Source strip, visible collapsed and editing** — the row is the strip: `flex flex-wrap items-center gap-2 rounded-md bg-base-100 px-2 py-1 text-xs`.
- **From Global** — outline badge, `Globe` icon, "From Global · All Ptah apps".
- **From App** — outline badge, `Cpu` icon, "From App · Desktop".
- **From Workspace** — outline badge, `Folder` icon, "From Workspace · {workspaceName} (Desktop)", or "(All Ptah apps)" when `workspaceCrossApp` is set.
- **Nothing stored** — plain badge "App default · Not configured", or the host's `defaultLabel` verbatim; never "From Global".
- **Mixed sources** — badge "Mixed sources" with no icon and no override or clear action; a guessed group scope is never rendered. Individual field strips are the parent's job.
- **Inherited value with a supported target** — secondary outline button "Override for this workspace" (or "Override for this app" when workspace is unsupported). No button when targets are empty.
- **Override present** — ghost button **Clear override** beside the source badge plus the preview "Will use {value} from {source}." shown before the action is taken.
- **Intermediate App layer remains** — **Use global value** ghost button beside Clear override.
- **Copy global value** — ghost button shown only when the host sets `showCopyGlobal`.
- **supportedTargets `['global']`** — every override, clear, use-global and copy control is hidden; only the source strip renders. Scope is honest about writes.
- **Credential** — separate muted line "Credential: stored on this machine" (or the host description); absent for `not-a-secret`.
- **Disabled** — buttons get `disabled`, and `disabledReason` text stays visible; the control's explanation is not removed.

The raw fallback value renders only as a displayable primitive; anything else renders as "the previous value". For keys whose stored value is diagnostic (the stored auth method), the parent passes `fallbackValueLabel`, per implementation plan Decision 1.

## Accessibility

- **36 px control height** — every button carries `min-h-9`; asserted in the spec by class and by daisyUI `btn-sm min-h-9` sizing.
- **Target ≥ 24 px** — text buttons with `min-h-9` and button padding exceed 24 px width and height.
- **2 px visible focus outline** — every button carries `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content` on `bg-base-100`; asserted by test.
- **Keyboard operation** — all controls are native `<button type="button">` elements: Enter and Space activate them natively, and they sit in the normal tab order.
- **Accessible names** — `aria-label` appends the field name ("Override for this workspace: {field}") when `fieldName` is set; asserted by test.
- **Contrast** — classes come from the spec's measured pairs: `text-base-content` on `bg-base-100` for text, `border-base-content-muted` for control boundaries, the spec's status-badge class string for the badge, and no colour-only state.
- **Icons** — `lucide-angular` glyphs are `aria-hidden="true"`; the badge text carries the accessible name. The Mixed badge has no icon at all.
- **Disabled state** — the explanatory text (`disabledReason`) renders beside disabled buttons; the control's explanation is never removed.

## Verification

Environment of every Nx command: `NX_DAEMON=false`, `NX_CACHE_DIRECTORY=D:\projects\ptah-extension\.nx\verify-cache`.

- `npx nx run @ptah-extension/chat:typecheck` — "Successfully ran target typecheck for project @ptah-extension/chat" (13.8 s). Three NG8107 warnings printed, all in pre-existing files outside this batch (`chat-ui`, `chat` molecules, `memory-curator-ui`); no warning from the new files.
- `npx nx run @ptah-extension/chat:lint` — "Successfully ran target lint for project @ptah-extension/chat"; "18 problems (0 errors, 18 warnings)", all pre-existing in other files. Neither new file appears.
- `npx nx run @ptah-extension/chat:test` — "Test Suites: 87 passed, 87 total / Tests: 2 skipped, 1369 passed, 1371 total" (50 s). Jest printed one worker-teardown warning, which exists on this target before this change. The new suite (21 tests) is inside the total.

## Deviations

- **Fallback value rendering.** The spec's "Will use {value} from {source}." needs the value as copy. The row renders `fallbackValueLabel` when the parent supplies it, and otherwise formats only primitives, with "the previous value" for anything else. Reason: raw stored values such as the stored auth method are diagnostic-only and must never render (plan Decision 1), and the parent owns domain copy.
- **No live region in the row.** The design spec allows one polite live region per operation; save/clear announcements belong to the host composition, so the row renders the preview as plain text. Stated here so the parent lane accounts for it.

## Not done

- No `index.ts` barrel in `settings/providers/` — the orchestrator writes it after every component exists.
- No mount and no edits to `settings.component.ts` or any existing settings file.
- No work in `libs/frontend/core`.
- **"Save to" radio group** is not in this component: the design spec places it "within an editor", and this row's inventory responsibility is source strips, override actions and target review. The editor compositions (wizard step 5, the picker host) own the radio group and the affected-override reviews for Use global value.
- The inline review copy for **Use global value** ("Removes {listed overrides}; the Desktop app override also affects its other workspaces.") needs the list of affected overrides, which only the state service has; the parent renders that review.

## Clarifications Needed

None — the batch was not blocked.