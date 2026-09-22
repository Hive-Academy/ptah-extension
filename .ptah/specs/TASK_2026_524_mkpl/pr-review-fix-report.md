# PR #569 review findings — resolution report

All four findings were verified against the current code first. All four were
still unresolved and all four were fixed. Nothing was skipped.

---

## Finding 1 — Dashboard dialog accessibility

**Verified unresolved.** The `<dialog>` at `skill-selection-card.component.ts`
had only `aria-label` — no `role`, no `aria-modal`, no Escape route.

**Changed** — `libs/frontend/dashboard/src/lib/components/skill-selection-card/skill-selection-card.component.ts`:

- `:129-135` — the `<dialog>` now carries `role="dialog"`, `aria-modal="true"`
  and `(document:keydown.escape)="onPickerEscape()"`. The class-driven
  `modal-open` pattern is kept; `showModal()` is NOT used.
- `:213-223` — new `protected onPickerEscape(): void` that calls
  `onPickerClosed()` only when `this.pickerOpen()` is true, so a document-wide
  Escape with the picker closed triggers no refresh RPC.

**New spec case** — `skill-selection-card.spec.ts`, inside the
`the dialog chrome the card now owns` describe:

- `closes on Escape pressed anywhere in the document, and is a no-op while closed`
  — opens the picker with the existing `openPicker()` helper, dispatches
  `keydown` with key `Escape` on `document` and asserts the dialog closed and
  `harness:get-skill-selection` re-read; a second Escape with the picker closed
  asserts zero new RPC calls.

## Finding 2 — Connected view re-derives Apps rows on `connectorServers` change

**Verified unresolved.** `loadApps()` read `this.connectorServers()` once, after
`mcpDirectory:listInstalled` resolved, and stored the merged result in the
writable `appGroups` signal. A later input change was invisible until
`refreshTrigger` fired.

**Changed** — `libs/frontend/marketplace/src/lib/connected-surface.component.ts`:

- `:309-334` — new private `installedServers = signal<readonly InstalledMcpServer[] | null>(null)`;
  `appGroups` is now a `computed` that returns `[]` while `installedServers()`
  is `null`, else builds `toConnectorRows(entries, installed.map(s => s.serverKey))`
  from `this.connectorServers()` and returns
  `groupInstalledServers([...installed, ...connectors])`.
- `:497-515` (`loadApps`) — the success path sets `installedServers` instead of
  `appGroups.set`, and calls `decorateAppStatuses(installed)`. BOTH error paths
  (the `!result.isSuccess()` branch and the `catch`) now do
  `installedServers.set(null)` instead of `appGroups.set([])`.
- `:644-678` (`decorateAppStatuses`) — now takes the `installed` array, derives
  the groups from `this.appGroups()` at entry, and the stale-publication guard
  became `if (this.installedServers() !== installed) return;` instead of the
  old `appGroups() !== groups` identity check — a computed re-evaluates into a
  new array whenever `connectorServers` changes, so the old check would have
  dropped valid statuses. `appStatuses` stays keyed by group key, so a
  re-derived group list still finds its status. The `beginLoad`/`isStale`
  per-group generation guard is untouched.

**New spec case** — `connected-surface.component.spec.ts`:

- `re-derives the Apps rows when the connectorServers input changes` — after
  the initial load of one disk server, `fixture.componentRef.setInput('connectorServers', [...])`
  makes a new connector (`Gmail`) appear in the Apps group with no new
  `mcpDirectory:listInstalled` call, and a connector whose `serverKey` (`ptah`)
  is already installed is not duplicated. Reuses the existing `create`, `settle`,
  `titlesIn` and `methodsCalled` helpers.

## Finding 3 — Hub spec coverage for the Skills tab

**Verified unresolved.** No test clicked a section tab and asserted the chip
strip swap.

**Changed** — `libs/frontend/marketplace/src/lib/marketplace-hub.component.spec.ts`,
`section strip` describe:

- New case `mounts the Skills chips and unmounts the Apps ones when the Skills
  tab is clicked` — after `createComponent()`, finds the tab whose trimmed text
  is `Skills` via the existing `tabs()` helper (`[data-testid="native-tab"]`),
  clicks it, runs `detectChanges()` + `whenStable()` + `detectChanges()`, then
  asserts `[data-testid="skills-chips"]` is present and
  `[data-testid="apps-chips"]` is absent. Both test ids exist in the component
  templates (`skills-section.component.ts:77`, `apps-section.component.ts:43`),
  so no template was edited.

## Finding 4 — Partial config allowlist

**Verified unresolved.** `applyCatalogConfig` passed `config.enabledPluginIds`
straight into `deriveSelection`; the type declares it required, but
`PluginCatalogService` stores the host answer as-is, so a `{}` answer makes it
`undefined` at runtime and `.filter` throws inside the `loadPlugins` try —
which lands the panel in its error branch and clears the catalogue.

**Changed** — `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.ts`
(`applyCatalogConfig`, around `:1079`):

- `config.enabledPluginIds ?? []` — an absent allowlist now reads as "nothing
  opted in".

**New spec case** — `plugin-catalog-panel.component.spec.ts`, in the
`per-workspace skill selection` describe:

- `keeps the plugin list when the host answers plugins:get-config with {}` —
  `plugins:list-available` answers one plugin, `plugins:get-config` answers
  `ok({})` (no cast needed; the responder factory returns `unknown`), and the
  panel renders the plugin row with `error()` null, `isLoading()` false, and no
  `.text-error` element. Follows the existing `setResponder`/`mount` helpers.

---

## New spec case names

| Spec file | New case |
|---|---|
| `skill-selection-card.spec.ts` | `closes on Escape pressed anywhere in the document, and is a no-op while closed` |
| `connected-surface.component.spec.ts` | `re-derives the Apps rows when the connectorServers input changes` |
| `marketplace-hub.component.spec.ts` | `mounts the Skills chips and unmounts the Apps ones when the Skills tab is clicked` |
| `plugin-catalog-panel.component.spec.ts` | `keeps the plugin list when the host answers plugins:get-config with {}` |

## Verification

### `npx tsc -p libs/frontend/marketplace/tsconfig.lib.json --noEmit`

Clean exit, no output.

### `npx tsc -p libs/frontend/chat-ui/tsconfig.lib.json --noEmit`

Clean exit, no output.

### `npx tsc -p libs/frontend/dashboard/tsconfig.lib.json --noEmit`

Clean exit, no output.

### `npx nx run-many -t test -p @ptah-extension/marketplace @ptah-extension/chat-ui @ptah-extension/dashboard --skip-nx-cache`

Header and summary (verbatim):

```
 NX   Running target test for 3 projects:

- @ptah-extension/marketplace
- @ptah-extension/chat-ui
- @ptah-extension/dashboard

√  nx run @ptah-extension/chat-ui:test
√  nx run @ptah-extension/dashboard:test
√  nx run @ptah-extension/marketplace:test

 NX  Successfully ran target test for 3 projects
```

Per-project jest summaries (verbatim, `--output-style=static`):

```
>  nx run @ptah-extension/chat-ui:test
Test Suites:  29 passed, 29 total
Tests:        224 passed, 224 total

>  nx run @ptah-extension/dashboard:test
Test Suites:  8 passed, 8 total
Tests:        74 passed, 74 total

>  nx run @ptah-extension/marketplace:test
Test Suites:  13 passed, 13 total
Tests:        281 passed, 281 total
```

The touched suites also ran standalone: `connected-surface.component.spec.ts`
18 passed (17 before + 1 new) and `marketplace-hub.component.spec.ts` 13
passed (12 before + 1 new), confirming each new case executes.

### `npx nx run-many -t lint -p @ptah-extension/marketplace @ptah-extension/chat-ui @ptah-extension/dashboard --skip-nx-cache`

```
 NX   Running target lint for 3 projects:

- @ptah-extension/marketplace
- @ptah-extension/chat-ui
- @ptah-extension/dashboard

√  nx run @ptah-extension/marketplace:lint
√  nx run @ptah-extension/chat-ui:lint
√  nx run @ptah-extension/dashboard:lint

 NX  Successfully ran target lint for 3 projects
```

## Files touched (all within the allowed scope)

1. `libs/frontend/dashboard/src/lib/components/skill-selection-card/skill-selection-card.component.ts`
2. `libs/frontend/dashboard/src/lib/components/skill-selection-card/skill-selection-card.spec.ts`
3. `libs/frontend/marketplace/src/lib/connected-surface.component.ts`
4. `libs/frontend/marketplace/src/lib/connected-surface.component.spec.ts`
5. `libs/frontend/marketplace/src/lib/marketplace-hub.component.spec.ts`
6. `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.ts`
7. `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.spec.ts`