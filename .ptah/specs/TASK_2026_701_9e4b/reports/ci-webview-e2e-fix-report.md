# CI fix: Webview E2E, marketplace visual parity (electron)

Failing run: 40589091317 (head 30818d87e). Test:
`marketplace-visual.e2e.spec.ts:177`, "marketplace-shell at 720/1100/1750" (electron only).

## Root cause

This was a missing harness fixture. Production code was not at fault.

1. In Batch 25, `readPlugins` began reading the Library copies in parallel with the plugin catalogue. See `libs/frontend/marketplace/src/lib/data/marketplace-inventory.store.ts:576-583`, which awaits `Promise.all([catalog…, this.readLibraryClones()])`.
2. `readLibraryClones` runs only in Electron: `:592` returns early unless `isElectron`. It calls `rpc.call('skillSynthesis:listClones', {})` at `:594`. This is why the vscode variant passes.
3. `baseMarketplaceFixtures()` had no answer for `skillSynthesis:listClones`. That is `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/marketplace.fixtures.ts`, `baseMarketplaceFixtures`. The harness convention leaves an unfixtured method unanswered, so the call waits out the default 30 s RPC timeout (`libs/frontend/core/src/lib/services/claude-rpc.service.ts:135`).
4. Until then the `plugins` inventory slice stays in `loading`. The default marketplace page is Overview, which reads the `plugins` slice (`overview-page.component.ts:52-57`). Its "Skills & plugins" KPI binds `[state]="skillsState()"` (`overview-page.component.html:80`). `skillsState` combines the `plugins` / `community` / `marketplaces` slices (`overview-page.component.ts:196-197`).

**Element that stayed busy:** the `<ptah-stat-card data-kpi="skills">` root. It renders `[attr.aria-busy]="state() === 'loading'"` (`libs/frontend/marketplace/src/lib/ui/stat-card.component.ts:74`). That is the single `[aria-busy="true"]` match `waitForSettled` counted for 5 s. The 30 s timeout is far beyond the 5 s settle window.

The production failure path is correct. After the timeout, `readLibraryClones` degrades to `NO_LIBRARY_COPIES` (`:595`/`:600-605`) and the slice settles. So no production change was needed.

I also checked the other new Electron reads:
- `plugin-config-home-notice.component.ts:236` and the `skill-detail` loading state only render on the Installed skills page or the detail page. They are not on the default Overview.
- `installed-library-stale-notice.component.ts` makes no RPC; it reads the `libraryPassFailed` signal.
- The `LibraryChangeFeed` effect only reloads when a change event arrives, and none is sent in this scenario.

## Files changed

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment\libs\frontend\webview-e2e-harness\src\lib\scenarios\marketplace\marketplace.fixtures.ts`
  - Added `'skillSynthesis:listClones': libraryClonesFixture(workspaceFolders[0])` to `baseMarketplaceFixtures()`.
  - Added the exported `libraryClonesFixture(scopeRoot)`, typed as `SkillSynthesisListClonesResult` via `import type` from `@ptah-extension/shared`. The harness already does this in `plan-limits.fixtures.ts`.
  - The fixture is an empty Library scoped to the active workspace folder.

No production files changed. The orchestrator's 3 comment-only edits in `libs/frontend/marketplace` were left untouched.

## Verification

`npm run verify -- -p @ptah-extension/marketplace,@ptah-extension/webview-e2e-harness`

```
NX   5 tasks: 5 succeeded, 5 cached
lock released after 4.8s, exit code 0
```

The first run printed `NX   5 tasks: 5 succeeded`. Two later runs were only to read the task list, and both were full cache hits. The e2e target was **not** run locally, per the task rules.

## Decisions

- **Fixture versus production change.** I chose to add the fixture.
  - The options were: (a) add a harness fixture, or (b) change production so the plugins slice does not wait on the clones read.
  - Evidence: the production code already degrades on failure and timeout (`marketplace-inventory.store.ts:595-605`). The real Electron host registers `skillSynthesis:listClones` (`libs/shared/src/lib/types/rpc.types.ts:2069`, `:3457`). The harness doc on `baseMarketplaceFixtures` and `pluginSkillsResolver` treats a new production read without an answer as a missing fixture.
  - Reversible: yes.
- **Empty clone list, not the `library-agreement` shared fixture.** The visual-parity captures should not gain shadow or orphan marks. An empty Library is the realistic state for a fresh workspace. `scopeRoot` equals the active folder, so the store's scope check (`:551-552`) matches.
  - Reversible: yes.

## Open issues

- The e2e itself was not run locally. Only CI can confirm that the electron variant now settles.
- Out of scope (observation): in production, the Electron plugins slice blocks on `skillSynthesis:listClones` for up to the 30 s default timeout if the host is slow or never answers. The clone read is decoration only. A shorter per-call `timeout`, or not awaiting it before the catalogue state settles, would bound that. This was not changed here.
