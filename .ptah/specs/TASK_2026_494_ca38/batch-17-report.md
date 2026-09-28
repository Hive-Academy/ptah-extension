# Batch 17 report: Electron shell Apps tab (Task 17.1)

Executor: frontend-developer (fallback executor). No git command was run.

## Status: implemented, but one existing spec fails (decision needed)

The Apps tab is implemented and its new spec passes 5/5. One spec pin cannot hold as written. The pin says the
existing `electron-shell.config-gate.spec.ts` stays green with no edits. But that spec's test
`shows the workspace app shell and Chat, Tasks, Tribunal, Analytics tabs in order` (`:197-226`) pins the old
four-tab row:

- titles `['Chat','Tasks','Tribunal','Analytics']` (`:207-212`);
- text (`:213-218`);
- aria-selected with 4 entries (`:219-224`);
- `toHaveLength(4)` (`:225`).

Adding the Apps tab, which Req 1.1 and this batch require, breaks the test by construction. The file is outside
this batch's ownership, so I did not edit it.

Minimal fix for the owner of that file:

- insert `'Apps'` second in both arrays at `:207-212` and `:213-218`;
- add a fifth `'false'` to the aria-selected list at `:219-224`;
- change `toHaveLength(4)` to `toHaveLength(5)` at `:225`;
- update the test title at `:197` to read "Chat, Apps, Tasks, Tribunal, Analytics".

The other 13 config-gate tests and all of `electron-shell.activity-placement.spec.ts` pass unchanged.

## Requirements and spec pins

All paths below are relative to `libs/frontend/chat/src/lib/components/templates/`.

| Requirement | Evidence |
| --- | --- |
| Replace ONLY the Apps slot comment with a tab button, following the Tasks pattern | `electron-shell.component.ts:137-147`: `role="tab"`, `class="tab gap-1.5 no-drag"`, `[class.tab-active]`/`[attr.aria-selected]` bound to `appState.currentView() === 'apps'`, `title="Apps"`, `(click)="openApps()"`, a `w-3.5 h-3.5` lucide icon, and the label "Apps". This matches the Tasks button, now at `:148-158`, attribute for attribute. |
| `AppWindow` import | `electron-shell.component.ts:39`; field `readonly AppWindowIcon = AppWindow;` at `:394` (beside the other icon fields) |
| `openApps()` calls `setCurrentView('apps')` | `electron-shell.component.ts:415-417` (after `openTasks()`) |
| Nothing else moves | The diff touches only the four spots above. Chat, Tasks, Tribunal and Analytics are unchanged. |
| No `text-base-content/NN` alpha classes | None added. The Apps tab's classes are exactly `tab gap-1.5 no-drag`, asserted at `electron-shell.apps-tab.spec.ts:141-154`. |
| Pin: order Chat, Apps, Tasks, Tribunal, Analytics | `electron-shell.apps-tab.spec.ts:134-139` (titles, text, 5 tabs) |
| Pin: absent without workspace folders | `electron-shell.apps-tab.spec.ts:156-165`. It checks there is no tablist and no Apps button, then that the tab reappears when folders return. |
| Pin: click calls `setCurrentView('apps')` | `electron-shell.apps-tab.spec.ts:167-172`: called once, with `'apps'`, and `setLayoutMode` is not called |
| Pin: `aria-selected` follows `currentView() === 'apps'` | `electron-shell.apps-tab.spec.ts:174-199`: `'apps'` gives only the Apps tab `true` plus `tab-active`; `'tasks'` gives the Apps tab `false` |
| Pin: config-gate and activity-placement specs green, no edits | activity-placement: green. config-gate: 13/14 green, and 1 fails by construction (see above). |

Spec notes:

- The spec uses the stubs from `electron-shell.config-gate.spec.ts:74-129`:
  - the ngx-markdown mock;
  - the layout, appState and surfaceRouter stubs;
  - `overrideComponent` with `CUSTOM_ELEMENTS_SCHEMA`.
- The `VSCodeService` stub sets `isElectron: true`, following the B16 note.
- The spec never drives real router navigation: the click is asserted at the `setCurrentView` boundary. So the
  late-host-config ruling (not a B17 risk) needs nothing more here.

## Icon choice

The icon is `AppWindow` from `lucide-angular`, as the plan named at implementation-plan.md:342-343. Its typings
exist at `node_modules/lucide-angular/icons/app-window.d.ts`.

The prototype does not name a lucide icon. `prototype/index.html:54` draws a hand-made inline SVG: a top bar over two
panels, which is visually closer to lucide `LayoutPanelTop`. Its other tabs also use illustrative SVGs, not the
shell's real icons. For example, Tasks there is a check-square, while the shell uses `ClipboardList`. So the plan's
icon stands.

## Verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/chat --skip-nx-cache`:
  - lint: pass.
  - typecheck: pass. It was re-run without jest passthrough args, because the first run passed `--maxWorkers=2`
    through to tsc. Result: `Successfully ran targets lint, typecheck for project @ptah-extension/chat`.
  - test: `Test Suites: 1 failed, 105 passed, 106 total`; `Tests: 1 failed, 2 skipped, 1626 passed, 1629 total`.
    The single failure is `ElectronShellComponent configuration gate › shows the workspace app shell and Chat,
    Tasks, Tribunal, Analytics tabs in order` (see above).
- Targeted run, `npx jest -c libs/frontend/chat/jest.config.ts .../templates/electron-shell --maxWorkers=2`:
  - 4 suites, 24 tests: 23 passed and 1 failed (the same config-gate test).
  - `electron-shell.apps-tab.spec.ts`: 5/5 pass.
  - activity-placement and notification-center: pass.
- `npx tsc -p libs/frontend/chat/tsconfig.spec.json --noEmit` shows 249 errors, all pre-existing, and 0 in any
  electron-shell file. Every error is in a file this batch did not touch. The largest groups are:
  - `services/chat-store/compaction-lifecycle.service.spec.ts` (66);
  - `services/message-sender.service.spec.ts` (33);
  - `services/chat-store/session-loader.service.spec.ts` (24);
  - `templates/chat-view.component.spec.ts` (17, e.g. `:1342`);
  - `organisms/tab-bar.component.spec.ts` (11, e.g. `:170`);
  - the 8 known cross-lib baseline errors in `core/src/testing/mock-rpc-service.ts` (4) and
    `git-ui/src/lib/services/monaco-loader.service.ts` (4).

  No new errors were added.

## Notes for the visual review (R10, dark and light, against `prototype/`)

- The Apps tab sits second in the `tabs-lifted electron-tabs` row. When it is active it gets the same
  `tab-active` treatment as its siblings; the prototype draws that as an underline, and the real DaisyUI lifted
  style may differ from the prototype's approximation.
- The icon is lucide `AppWindow` (a window frame with a title bar), not the prototype's top-bar-and-two-panels
  SVG. Check that it reads clearly at 14px in both themes.
- Check the tab row width at narrow window sizes now that there are five tabs. The row sits between two
  `flex-1` spacers.
- Check keyboard access: the tab is a native `<button>`, so Tab reaches it and Enter or Space activates it. It is
  in DOM order, between Chat and Tasks.

## Config-gate edit (coordinator-approved follow-up)

The coordinator approved this edit: Req 1.1 overrides the "config-gate stays green with no edits" pin. The edit is
confined to one test in `electron-shell.config-gate.spec.ts`, which now spans `:197-229`. The other 13 tests are
untouched.

Before:

```ts
it('shows the workspace app shell and Chat, Tasks, Tribunal, Analytics tabs in order', () => {
expect(tabs.map((tab) => tab.title)).toEqual(['Chat', 'Tasks', 'Tribunal', 'Analytics']);
expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['Chat', 'Tasks', 'Tribunal', 'Analytics']);
expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false']);
expect(shell().querySelectorAll('[role="tab"]')).toHaveLength(4);
```

After:

```ts
it('shows the workspace app shell and Chat, Apps, Tasks, Tribunal, Analytics tabs in order', () => {
expect(tabs.map((tab) => tab.title)).toEqual(['Chat', 'Apps', 'Tasks', 'Tribunal', 'Analytics']);
expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['Chat', 'Apps', 'Tasks', 'Tribunal', 'Analytics']);
expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false', 'false']);
expect(shell().querySelectorAll('[role="tab"]')).toHaveLength(5);
```

The source keeps its multi-line array layout. The arrays are shown on one line here only to keep the diff short.

Verification after the edit:

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/chat --skip-nx-cache` exited 0:
  `Successfully ran targets lint, typecheck, test for project @ptah-extension/chat`.
- `npx jest -c libs/frontend/chat/jest.config.ts .../templates/electron-shell --maxWorkers=2`:
  `Test Suites: 4 passed, 4 total`; `Tests: 24 passed, 24 total`. The four suites are apps-tab, config-gate,
  activity-placement and notification-center.

Batch 17 is now fully green.
