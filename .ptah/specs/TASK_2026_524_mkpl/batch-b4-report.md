# Batch B4 — cleanup — COMPLETE

Spec 11 of `implementation-plan.md` plus the B4 row of the handoff table.
Libs touched: `dashboard`, `chat-ui`, `chat`, `apps/ptah-electron-e2e`.
`libs/frontend/marketplace` and `libs/frontend/core` were read only, per the
batch constraint.

## Files changed

DELETED

- `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-browser-modal.component.ts`
- `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-browser-modal.component.spec.ts`
- `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-status-widget.component.ts`

MODIFIED

- `libs/frontend/dashboard/src/lib/components/skill-selection-card/skill-selection-card.component.ts`
  — rehosted onto `PluginCatalogPanelComponent`; the card now owns the dialog
  chrome. Doc comment updated to say the chrome is the card's and the body is
  not.
- `libs/frontend/dashboard/src/lib/components/skill-selection-card/skill-selection-card.spec.ts`
  — the file is `skill-selection-card.spec.ts`, **not**
  `skill-selection-card.component.spec.ts` as the plan's file list names it.
  Existing cases kept verbatim apart from the word "modal" → "picker"; one new
  `describe` block (2 cases) pins the chrome the card now owns.
- `libs/frontend/chat-ui/src/index.ts` — dropped the
  `PluginBrowserModalComponent` and `PluginStatusWidgetComponent` exports.
- `libs/frontend/chat/src/lib/components/index.ts` — dropped the same two names
  from the deprecated `@ptah-extension/chat-ui` re-export block (`:124-125`).
- `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.spec.ts`
  — one doc comment re-pointed from the deleted modal spec to
  `plugin-catalog-panel.component.spec.ts`.
- `libs/frontend/chat-ui/src/lib/atoms/skeleton-block.component.ts` — one doc
  comment marked the widget as since-deleted.
- `apps/ptah-electron-e2e/src/specs/marketplace/marketplace.spec.ts` — the
  "component really mounted" assertion moved from `Open MCP Registry` to the
  three section tabs.
- `apps/ptah-electron-e2e/src/specs/marketplace/external-marketplace.spec.ts` —
  `openPluginsSurface` → `openSkillsMarketplaces`,
  `PLUGIN_STATUS_WIDGET_MOCKS` → `PLUGIN_CATALOG_MOCKS`, header comment
  rewritten. Every `external-*` testid and copy assertion untouched.
- `apps/ptah-electron-e2e/src/showcase/marketplace-tour.scene.ts` — rewritten
  for the section/chip hub.
- `apps/ptah-electron-e2e/src/showcase/scripts/marketplace-tour.json` — one line
  dropped, indices renumbered, a `note` key added.

## Spec 11 — what the card renders now

```
@if (pickerOpen()) {
  <dialog class="modal modal-open" aria-label="Configure Ptah Skills">
    <div class="modal-box max-w-2xl relative">
      <button …data-testid="skill-selection-card-close" aria-label="Close plugin browser" (click)="onPickerClosed()"><lucide X/></button>
      <ptah-plugin-catalog-panel (saved)="onPickerClosed()" />
    </div>
    <button class="modal-backdrop" type="button" aria-label="Close plugin browser" (click)="onPickerClosed()"></button>
  </dialog>
}
```

`onPickerClosed()` is byte-for-byte unchanged (`pickerOpen.set(false)` + the
`harness:get-skill-selection` re-read). The dialog stays a SIBLING of the
`<section data-testid="skill-selection-card">`, so the "this card contains no
checkboxes" assertion still holds and the picker still outlives the card. The
panel carries its own "Configure Ptah Skills" header and the
`{enabled}/{total} enabled` line, so the card adds no header of its own.

## Remaining-reference grep

Repo-wide (excluding `node_modules`, `.ptah`, `.claude-worktrees`, `dist`,
`.git`) for `PluginBrowserModalComponent`, `PluginStatusWidgetComponent`,
`ptah-plugin-browser-modal`, `ptah-plugin-status-widget`,
`PluginsSurfaceComponent`, `ptah-plugins-surface`, `MARKETPLACE_PROVIDERS`,
`ComingSoonPlaceholderComponent`, plus the two file stems:

**Zero code, template, selector, import, barrel or test references remain.**
Five prose hits survive, all in libs this batch may not edit:

| File:line                                                                | Text                                                                                                                           | Why it was left                                                                                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/frontend/core/src/lib/services/plugin-catalog.service.ts:22-23`    | "`PluginStatusWidgetComponent` fetches both on `ngOnInit`, and `PluginBrowserModalComponent` fetches both again when it opens" | **Genuinely stale** — present tense about two deleted components. `core` is off-limits to B4 by the batch constraint. See "Handover" below. |
| `libs/frontend/core/src/lib/services/plugin-catalog.service.spec.ts:307` | "`PluginStatusWidgetComponent` mounted per transcript"                                                                         | Same; describes the historical motivation for the session-wide cache, reads acceptably as history.                                          |
| `libs/frontend/marketplace/src/lib/skills-section.component.ts:28`       | "the line that `PluginsSurfaceComponent` **used to own**"                                                                      | Past tense, correct as history. `marketplace` is read-only for B4.                                                                          |
| `libs/frontend/marketplace/src/lib/sections.registry.ts:19`              | "**Replaces** the seven-tile `MARKETPLACE_PROVIDERS` registry"                                                                 | Past tense, correct as history. Read-only for B4.                                                                                           |
| `libs/frontend/chat-ui/.../plugin-catalog-panel.component.spec.ts:3`     | "ported from `plugin-browser-modal.component.spec.ts` when the modal body became…"                                             | Deliberate provenance; left as written by B1.                                                                                               |

No `CLAUDE.md` anywhere under `libs/frontend` mentions any of the eight symbols
(checked with a markdown-scoped grep) — nothing to fix there.

## e2e

`marketplace.spec.ts` — the old assertion was `getByRole('button', { name:
'Open MCP Registry' })`, which the new hub never renders. Replaced with the
three section tabs, scoped to `ptah-marketplace-hub` because the app shell's
own top nav is also a `role="tab"` tablist and an unscoped lookup matches it
first. The aria-selected-on-Connected check was deliberately NOT added: a
persisted `marketplaceActiveProvider` legitimately opens `apps` or `skills`, and
this test exists to prove the lazy chunk mounted, not to re-test AC5 (which
`marketplace-section.spec.ts` and `marketplace-state.service.spec.ts` own).

`external-marketplace.spec.ts` — `openSkillsMarketplaces` is:

```ts
await ui.goto('marketplace');
const hub = ui.page.locator('ptah-marketplace-hub');
await hub.getByRole('tab', { name: 'Skills' }).click();
await hub.locator('[data-source-id="marketplaces"]').click();
await expect(ui.page.locator('ptah-external-marketplaces')).toBeVisible();
await expect(ui.page.locator('[data-testid="marketplace-source"]')).toBeVisible();
```

Selectors verified against B3's source, not against `batch-b3-report.md` prose:
tabs are `NativeTabGroupComponent`'s `role="tab"` buttons labelled from
`MARKETPLACE_SECTIONS` (`sections.registry.ts:50,56,67`); chips are plain
buttons carrying `data-testid="marketplace-chip"` and
`[attr.data-source-id]` (`skills-section.component.ts:78-86`,
`apps-section.component.ts:52-53`). `data-source-id` was chosen over the
visible label because the label "Marketplaces" collides with the
external-marketplace surface's own copy.

The `PLUGIN_STATUS_WIDGET_MOCKS` rename is not cosmetic: the landmine is real
and moved. `SkillsSectionComponent`'s header reads the plugin catalogue for its
`{enabled}/{total} enabled` line, so `plugins:get-config` and
`plugins:list-available` still have to be mocked — the mock set is unchanged,
only its name and the comment explaining it.

## Showcase scene and script

The scene is rewritten around a `TourStop = { section, sourceId }`:
`{ Apps, mcp-registry }` then `{ Skills, community }`, which keeps script lines
3 and 4 accurate (official MCP registry / community skills) with no re-write.
`tourProviderGrid` → `tourSections` spotlights the three tabs, which keeps line
2 ("every provider in one place") honest. The `Back to providers` click is
gone — the next stop selects its own tab. All `isVisible().catch(() => false)`
soft guards preserved.

Beat diff against `scripts/marketplace-tour.json`:

| Old index | Line                                    | Old beat                        | New index   | New beat            |
| --------- | --------------------------------------- | ------------------------------- | ----------- | ------------------- |
| 0-2       | hook, warmup, breadth                   | `say(0..2)`                     | 0-2         | unchanged           |
| 3-4       | MCP registry, community skills          | `say(3+i)` per provider         | 3-4         | `say(3+i)` per stop |
| 5         | "hover to size up any item"             | `say(5)` per visit              | 5           | unchanged           |
| 6         | "even more providers are landing soon"  | `say(6)` over the Composio tile | **dropped** | —                   |
| 7         | "the full Marketplace is a Pro feature" | **never spoken** (pre-existing) | 6           | still never spoken  |
| 8         | closer                                  | `say(8)`                        | 7           | `say(7)`            |

Only the Composio line was dropped — it is the one line whose referent the
Composio coming-soon tile was, and D1 deleted that tile. The never-spoken
Pro-feature line at old index 7 was already unreferenced before this task and
is **kept, not revived** — removing it would be an editorial change outside
B4's remit, and it is documented in the new `note` key on the script so the
next reader does not mistake it for a beat B4 forgot. The plan's fallback
suggestion of "drop beats 6-8" was not followed literally: beat 8 is the
closer and has real footage under it, so dropping it would end the video on a
listing hover rather than on its own payoff line.

**Narration must be re-generated.** `narrate.mjs` writes one clip per script
index and `Director.say` maps beat → `wav/{index+1}.wav`, so removing a line
shifts the closer from `wav/9.wav` to `wav/8.wav` and leaves a stale
`wav/9.wav`. No audio was re-recorded here (out of B4's scope and not
requested); the next `narrate` pass for `marketplace-tour` regenerates from
the edited JSON and fixes the mapping. Until it runs, a capture using the old
`durations.json`/`wav/` set will play the wrong clip on the closer.

## Verification

| Command                                                                                                                                                                                    | Result                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx nx run-many -t test -p @ptah-extension/chat-ui @ptah-extension/chat @ptah-extension/dashboard @ptah-extension/marketplace @ptah-extension/core --skip-nx-cache --output-style=static` | **PASS** — header `NX Running target test for 5 projects`, footer `Successfully ran target test for 5 projects`. chat-ui 29/29 suites, 223 tests; core 32/32, 813; dashboard 8/8, 73; marketplace 13/13, 279; chat 91/91, 1494 passed + 2 skipped. **0 failed anywhere.** B3's blocking `parseMarketplaceTarget` regression is gone — `libs/frontend/core/src/index.ts:11` re-exports `./lib/marketplace/marketplace-section` again.            |
| `npx nx run-many -t lint -p` (same five) `--skip-nx-cache`                                                                                                                                 | **PASS** — `Successfully ran target lint for 5 projects`. Only `chat` prints anything: 19 problems, **0 errors, 19 warnings**, every one pre-existing in files B4 did not touch (`chat-input`, `inline-agent-bubble`, `app-shell`, `chat-view*`, `session-loader`, `provider-setup-wizard`, `agent-orchestration-config`, `ptah-cli-config`). chat-ui's warning count dropped by one — the deleted modal's `max-lines` warning is gone with it. |
| `npx tsc -p apps/ptah-electron-e2e/tsconfig.spec.json --noEmit`                                                                                                                            | **PASS** — exit 0, no output.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `npx tsc -p apps/ptah-electron-e2e/tsconfig.json --noEmit`                                                                                                                                 | **Ran, but proves nothing** — that config is `"files": []`, `"include": []` with a project reference. The real coverage is the `.spec.json` above, whose `include` is `["src/**/*.ts", "playwright.config.ts"]` and therefore covers both e2e specs AND the showcase scene. Reported here because the batch brief named `tsconfig.json`.                                                                                                        |

The e2e specs themselves were **not executed**: they drive a real Electron
build via Playwright and are not part of any of the five `nx` targets above.
Their correctness rests on the typecheck plus selectors read out of B3's
source. Same for the showcase scene, which is a capture run, not a test.

Zero `as any`, zero `@ts-ignore`, zero `eslint-disable` added.

## Deviations

1. **The dashboard spec file is `skill-selection-card.spec.ts`**, not
   `…component.spec.ts` as the plan's file list says. Edited the file that
   exists.
2. **The modal backdrop is a `<button>`, not the `<div>` spec 11 writes.**
   `@angular-eslint/template/click-events-have-key-events` and
   `interactive-supports-focus` are **errors** (not warnings) under the
   `dashboard` lint config, and a `<div (click)>` failed both — the deleted
   modal lived in `chat-ui`, which does not enforce them. A `<button
type="button" class="modal-backdrop">` is focusable and keyboard-operable,
   keeps the daisyui class doing the layout, and still answers a
   `.modal-backdrop` query. Confirmed: `dashboard:lint` is green.
3. **Two new spec cases added to the dashboard card.** Spec 11's whole point is
   that the chrome moved into this card; without a test, a future edit could
   drop the dialog and leave the catalogue rendered flat on the dashboard with
   nothing failing. No existing case was weakened or removed.
4. **`openPluginsSurface` renamed to `openSkillsMarketplaces`** (and the mock
   constant renamed) rather than kept under a now-false name. Mechanical; all
   8 call sites updated.
5. **Closer beat kept.** See the showcase section — the plan's "drop beats 6-8"
   fallback would have removed the payoff line, which has live footage.
6. **Two `chat-ui` doc comments fixed** beyond the named file list
   (`mcp-directory-browser.component.spec.ts`,
   `skeleton-block.component.ts`) — both cited a file this batch deleted, and
   both are in a lib B4 owns.

## Handover / out-of-scope observations

- `libs/frontend/core/src/lib/services/plugin-catalog.service.ts:22-23` still
  describes `PluginStatusWidgetComponent` and `PluginBrowserModalComponent` in
  the present tense. It is the one genuinely misleading leftover. `core` is
  outside B4's ownership, so it is left for whoever next edits that file; the
  two names should become `SkillsSectionComponent`'s header and
  `PluginCatalogPanelComponent`.
- `workspace-coordinator.service.spec.ts:493,506,513` (flagged by B2) still
  seeds the retired ids `'skills-sh'` / `'official-mcp'`. Id-agnostic, still
  passes, still dead grammar. Not touched (`chat` lib, but not B4's row).
- `libs/frontend/chat/src/lib/components/index.ts` is still a `@deprecated`
  re-export block for four `chat-ui` symbols. Shrinking it further was not
  B4's row.
- The `chat` and `marketplace` jest runs print "A worker process has failed to
  exit gracefully". Pre-existing teardown leak, both runs report 0 failed.
