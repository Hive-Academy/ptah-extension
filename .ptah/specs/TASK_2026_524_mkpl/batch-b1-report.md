# Batch B1 report — TASK_2026_524_mkpl

**Status: completed.** Lib `@ptah-extension/chat-ui` only. Specs 3 and 4 of
`implementation-plan.md` implemented. The modal and the status widget are still
present and still exported — B4 deletes them.

## Files changed

CREATED

- `D:\projects\ptah-extension\libs\frontend\chat-ui\src\lib\molecules\setup-plugins\installed-mcp-groups.ts`
  — `InstalledServerGroup`, `groupInstalledServers`, `mcpTargetLabel`.
- `D:\projects\ptah-extension\libs\frontend\chat-ui\src\lib\molecules\setup-plugins\installed-mcp-removal.ts`
  — `removeInstalledGroup`.
- `D:\projects\ptah-extension\libs\frontend\chat-ui\src\lib\molecules\setup-plugins\installed-mcp-groups.spec.ts`
  — 19 pure cases: grouping identity, target collapse, `configPaths` dedupe,
  origin labelling, and removal routing against a fake rpc.
- `D:\projects\ptah-extension\libs\frontend\chat-ui\src\lib\molecules\setup-plugins\plugin-catalog-panel.component.ts`
  — `PluginCatalogPanelComponent`, selector `ptah-plugin-catalog-panel`.
- `D:\projects\ptah-extension\libs\frontend\chat-ui\src\lib\molecules\setup-plugins\plugin-catalog-panel.component.spec.ts`
  — the five modal cases, ported.

MODIFIED

- `D:\projects\ptah-extension\libs\frontend\chat-ui\src\lib\molecules\setup-plugins\mcp-directory-browser.component.ts`
  — deleted the private `InstalledServerGroup` (`:31-47`), `TARGET_LABELS`
  (`:58-69`), the `installedGroups` body (`:554-584`) and `performRemoval`
  (`:784-848`); imports and calls the two new modules instead. 984 → 806 lines.
- `D:\projects\ptah-extension\libs\frontend\chat-ui\src\index.ts` — new exports.

## Exported symbols (from `libs/frontend/chat-ui/src/index.ts`)

```ts
export { groupInstalledServers, mcpTargetLabel, type InstalledServerGroup } from './lib/molecules/setup-plugins/installed-mcp-groups';
export { removeInstalledGroup } from './lib/molecules/setup-plugins/installed-mcp-removal';
export { PluginCatalogPanelComponent } from './lib/molecules/setup-plugins/plugin-catalog-panel.component';
```

Signatures:

- `groupInstalledServers(servers: readonly InstalledMcpServer[]): InstalledServerGroup[]`
  — total, never throws, preserves first-seen order per `origin+serverKey`.
- `mcpTargetLabel(target: McpInstallTarget): string`
- `removeInstalledGroup(rpc: ClaudeRpcService, group: InstalledServerGroup): Promise<string | null>`
  — `rpc` is a parameter, never injected. Returns a user-facing message on any
  non-success, `null` only on full success, and `null` without calling for
  `removal: 'none'`.

## `PluginCatalogPanelComponent` public API

- Selector `ptah-plugin-catalog-panel`, standalone, `OnPush`, `implements OnInit`.
- **Inputs:** none.
- **Outputs:** `saved = output<string[]>()` — the enabled bundled plugin ids,
  same semantics as the modal's. No `closed`.
- Injects `ClaudeRpcService` and `PluginCatalogService` — exactly what the modal
  already injected, nothing widened.
- Public members the host may read: `availablePlugins`, `selectedIds`,
  `searchQuery`, `isLoading`, `isSaving`, `error`, `saveError`, `pluginSkills`,
  `disabledSkillIds`, `expandedPlugins`, `skillCandidates`,
  `selectedSkillSlugs`, `skillMode`, `skillModeDerived`,
  `skillSelectionAvailable`, `filteredPlugins`, `groupedPlugins`, and the
  methods `loadPlugins()` / `saveConfiguration()` plus the template handlers.
- Save button carries `data-testid="plugin-catalog-save"`.
- Header row renders `{{ catalog.enabledCount() }}/{{ catalog.pluginTotal() }}
enabled` (`data-testid="plugin-catalog-enabled-count"`), replacing what
  `PluginStatusWidgetComponent` showed.
- No `<dialog>`, no `.modal-box`, no `.modal-backdrop`, no `.modal-action`, no
  Cancel, no `XIcon`, no `handleClose()`.

Load-bearing ordering preserved unchanged from the modal:

- the `harness:get-skill-selection` read is started beside `catalog.ensureLoaded()`
  and **applied before and outside** the catalogue `try` (modal `:1118-1147`);
- the catalogue `catch` does **not** call `clearSkillSelection()` (modal
  `:1203-1207`);
- `saveConfiguration()` awaits `catalog.refresh()` before `saveSkillSelection()`
  and before `saved.emit()` (modal `:943-960`); only `this.closed.emit()` was
  dropped.

## Verification

- `npx nx run-many -t test -p @ptah-extension/chat-ui --skip-nx-cache`
  → header `NX Running target test for project @ptah-extension/chat-ui` (1
  project). **Successfully ran target test.**
  Static-output run: **30 suites passed, 30 total; 228 tests passed, 228 total.**
  30 is every `*.spec.ts` in the lib, so both new specs ran and the existing
  `mcp-directory-browser.component.spec.ts` and
  `plugin-browser-modal.component.spec.ts` still pass.
- `npx nx run-many -t lint -p @ptah-extension/chat-ui --skip-nx-cache`
  → **0 errors, 5 warnings.** Pre-existing: `copy-button.component.ts`
  (`no-useless-assignment`), `session-stats-summary.component.ts`,
  `plugin-browser-modal.component.ts`, `mcp-directory-browser.component.ts`
  (all `max-lines`, and the browser's went _down_, 984 → 806 lines). New:
  `plugin-catalog-panel.component.ts` `max-lines` (818/700) — the plan states at
  spec 4 that the panel is ~1000 lines "and that is correct".
- `npx tsc -p libs/frontend/chat-ui/tsconfig.lib.json --noEmit` → clean.
- Zero `as any`, zero `@ts-ignore` added.

## Deviations from the plan

1. **`getTargetLabel` kept as a one-line delegate** on
   `McpDirectoryBrowserComponent` rather than deleted. The template calls it at
   `:277` and `:367`; a template cannot reach a module-level import, and the
   plan forbids widening this component's surface. It now reads
   `return mcpTargetLabel(target);`.
2. **One NUL byte dropped.** The lifted doc comment on `InstalledServerGroup.key`
   contained a literal `\u0000` where a space belongs
   (`` `${origin}\0${serverKey}` ``, byte 855 of the old file — it made `grep`
   treat the file as binary). The moved copy uses a space. Comment text only; no
   behaviour change, and the grouping key itself always used a real space.
3. **The spec's fake rpc uses `as unknown as ClaudeRpcService`.** The real `call`
   is generic over `RpcMethodName`; the fake is structurally narrower, so a
   double assertion is the honest presentation. Not `as any`, not `@ts-ignore`.

## Out-of-scope observations (not touched)

- `PluginBrowserModalComponent` and `PluginStatusWidgetComponent` remain, so the
  modal's ~856-line `max-lines` warning and the duplicated catalogue logic
  persist until B4 deletes them. `chat` and `dashboard` still import both.
- `libs/frontend/chat-ui/CLAUDE.md` does not exist on this branch (only in
  `.claude-worktrees/*`), although `mcp-directory-browser.component.ts:498-502`
  cites "guideline 1" from it. The no-injected-state rule was honoured anyway:
  `removeInstalledGroup` takes the rpc service as a parameter and the panel
  injects only what the modal already did.
