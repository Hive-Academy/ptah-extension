# CI fix: two failing Electron e2e specs — `TASK_2026_523_c3df`

## The two failures

Both specs failed because this branch deliberately changed what they assert.

**Failure A — `apps/ptah-electron-e2e/src/specs/settings/settings.spec.ts:19`.**
`'settings renders'` asserted `[data-testid="settings-section-auth"]` is
visible after `ui.goto('settings')`. That test id belonged to the old
Authentication tab editor. The branch replaced that editor with the
consolidated Providers page: the tab id `claude-auth` is retained, but it now
renders `ptah-providers-settings` (`libs/frontend/chat/src/lib/settings/
settings.component.html:73-112`). The test id `settings-section-auth` no
longer exists anywhere in the tree, so the locator resolved to 0 and
`toBeVisible()` timed out.

**Failure B — `apps/ptah-electron-e2e/src/specs/thoth/skills.spec.ts:294`.**
`'Settings lane pickers render, enumerate providers, and a pinned lane renders
pinned'` asserted `[data-testid="skills-lane-picker"]` `toHaveCount(4)`. Plan
Decision 9 row 6 (`implementation-plan.md:313`) removed the four picker mounts
from `SkillSettingsPanelComponent` ("REMOVE the four picker mounts. Unrelated
synthesis policy stays."); lane provider/model selection moved to the Providers
settings page's Background models section
(`ProviderConsumerAssignmentsComponent`). This is the exact duplicate of the
webview scenario I moved in the earlier phase of this task (see
`ci-fix-e2e-and-copy-report.md`); the same assertion, same fixtures, same
`data-lane` attributes — so it gets the same treatment.

One blocker from the phase-1 report no longer exists: the production
`PROVIDER_MODELS_LOADER` gap is fixed on this branch
(`providers-settings.component.ts:33` now provides the token with
`useClass: ProvidersModelsLoader`, which calls `provider:listModels` through
`ClaudeRpcService` — `providers-models-loader.service.ts:11-15`). The
`NG0201` defect that killed the editor block in phase 1 cannot occur anymore,
which is what makes the coverage move landable here.

## What each now asserts

**Failure A — same test, coverage moved to the page that replaced the section:**

```typescript
await expect(page.locator('ptah-settings')).toBeVisible();
await expect(page.locator('ptah-providers-settings')).toBeVisible();
await expect(page.locator('[data-testid="assignments-heading"]')).toBeVisible();
await expect(page.locator('[data-testid="settings-back"]')).toBeVisible();
```

The old assertion proved the default tab actually mounted content, not just a
shell. The new set proves the same against what exists now:

- `ptah-providers-settings` — the new default tab's root mounts;
- `assignments-heading` (`provider-consumer-assignments.component.ts:157`) — a
  stable test id for real content inside that page's Background models
  section, so a blank or half-broken page still fails this test;
- `settings-back` — unchanged.

All four are stable test ids that exist on the new page. No text matching.
Tab navigation is separately covered by the two unchanged Web Search tests in
the same file, which click the "Search & Voice" tab — that leg is not weakened.

**Failure B — full port of the committed webview move
(`libs/frontend/webview-e2e-harness/src/lib/scenarios/thoth/
skills-lane-pickers.e2e.spec.ts`), adapted to this harness's `ui` driver.**
The test keeps the thoth → Skills → Settings leg, then drives the real user
path the panel now exposes:

1. assert `ptah-skill-settings-panel` mounts **zero**
   `ptah-provider-model-picker` (`toHaveCount(0)` — a guard against a
   half-removal, kept from the webview version) and still renders
   `[data-testid="skills-lanes-section"]` with the
   "Manage synthesis in Providers" button;
2. click that button — the panel's real deep-link
   (`skill-settings-panel.component.ts:421-424`:
   `requestSettingsTab({tab:'providers', section})` +
   `setCurrentView('settings')`);
3. wait for `[data-testid="provider-consumer-assignments"]`, assert all six
   `consumer-row-*` cards render and `consumer-summary-synthesis` is visible
   (rows render their summary only once the section read lands);
4. open `consumer-editor-synthesis` (with the documented one-shot
   deep-link race fallback: click `consumer-edit-synthesis` if the auto-open
   lost the race) and assert:
   - `picker-synthesis` count 1 — the shared
     `ProviderModelPickerComponent` (batches B1.9/B1.10) mounts on the
     Providers page;
   - `option[value="moonshot"]` → text `Moonshot (Kimi)` — registry
     enumeration;
   - provider value `moonshot` and model value `kimi-k2` — the pinned-lane
     case that regressed under commit 9e42f9c81 (the old test's core
     assertion, preserved verbatim against the new mount);
5. open `consumer-editor-judge` and assert provider value `''` — the
   documented inherit default for an untouched lane.

Because the Electron fake RPC listener answers **every** method (unmocked
methods get namespace empty defaults, which do not satisfy shapes like
`settings:get`), the test mocks everything `ProvidersSettingsStateService.
refresh()` fans out over when the Providers page opens — the same fixture set
the webview version uses: `auth:getEffectiveRoute`, `config:getScopes`,
`config:model-get`, `config:effort-get`, `ptahCli:list`, `settings:get`,
`agent:getConfig`, `auth:getApiKeyStatus`, `auth:getAuthStatus`,
`provider:listCustomEntries`, string resolvers for `llm:getProviderBaseUrl`,
`provider:getModelTiers` and `provider:listModels`, plus the four skills reads.
Without this, rows sit in the not-loaded state and `toggleEdit` refuses to
open an editor.

The now-unused `LANE_IDS` constant was deleted (its only consumer was the
removed test). `SETTINGS_FIXTURE`, `LANES_FIXTURE` and `makeCandidate` remain
in use by the three unchanged tests.

## Coverage lost

None. Two shifts to record precisely:

- The per-lane loop that asserted a picker per lane (`data-lane` attribute,
  four pickers mounted at once) asserted the existence of mounts this branch
  removed by design. The assertions that mattered — registry enumeration,
  pinned lane renders pinned, untouched lane renders inherit — are asserted
  one-for-one against the new mounts on the Providers page.
- The `settings-section-auth` assertion proved the old authentication editor
  rendered. That section no longer exists; the proof target is now
  `assignments-heading` on the consolidated Providers page. If deeper
  "Settings renders" coverage is wanted later, it belongs on the Providers
  page's own specs, not on this shell-level smoke test.

## Verification

Environment: worktree `D:\projects\ptah-extension\.claude-worktrees\
task-523-group-d`; `NX_DAEMON=false`,
`NX_CACHE_DIRECTORY=D:\projects\ptah-extension\.nx\verify-ci-electron`,
`NX_ISOLATE_PLUGINS=false`. No `npm install` (junction untouched).

The harness **did run locally** — a real Electron app per test, on this
Windows display (no xvfb needed on Windows). The build chain ran first
because the worktree `dist` was missing `preload.js` and `renderer/`:

| Check | Command | Result |
|---|---|---|
| typecheck | `npx nx run ptah-electron-e2e:typecheck` | success — `tsc --noEmit` clean, exit 0 |
| lint | `npx nx run ptah-electron-e2e:lint` | success — `15 problems (0 errors, 15 warnings)`, all pre-existing in files I did not touch |
| electron build | `npx nx build-dev ptah-electron` | success — main, preload, 5 workers + wasm, exit 0 (34.2s) |
| renderer copy | `npx nx copy-renderer-dev ptah-electron` | success — webview bundle built from current branch source and copied to `dist/apps/ptah-electron/renderer`, exit 0 |
| rewritten tests | `node ..\..\node_modules\@playwright\test\cli.js test --config=playwright.config.ts -g "settings renders\|Skills deep-link"` (cwd `apps/ptah-electron-e2e`) | **2 passed (33.2s)** |
| full files | `node ..\..\node_modules\@playwright\test\cli.js test --config=playwright.config.ts src/specs/settings/settings.spec.ts src/specs/thoth/skills.spec.ts` | **7 passed (2.4m)** — settings 3/3, skills 4/4, including the three unchanged neighbouring tests |

Observed output of the filtered run (truncated to the result lines):

```
  ok 1 src\specs\settings\settings.spec.ts:20:7 › Settings › settings renders (15.5s)
  ok 2 src\specs\thoth\skills.spec.ts:351:7 › Thoth — Skills tab › Skills deep-link opens the Providers page where the shared picker enumerates providers and a pinned lane renders pinned (13.4s)

  2 passed (33.2s)
```

The full-files run passed the same two tests again plus `toggle persists
(round-trip)`, `two providers can be selected at once`, `candidate table +
stats render`, `filter switches candidate set`, `promote opens modal and
confirms` — nothing adjacent broke.

## Deviations

- The Electron moved test mirrors the committed webview version, but keeps
  this harness's own idioms (`ui.openTab`, `ui.mockRpc` statics + string
  resolvers compiled in the main process) rather than the webview harness's
  `addInitScript` auto-responder.
- The `settings renders` test mocks nothing new: the base `ui` fixture's
  fake listener already answers every Providers-page read, and the section
  header renders regardless of row load state. The deeper loaded-state
  coverage lives in the moved skills test, which mocks the full read set.
- The working tree carries another lane's concurrent edits to
  `draft-verification.service.ts`, `provider-auth-resolver.ts`,
  `provider-setup-wizard.component.ts` (and their specs) plus two task
  reports. I touched none of them; the renderer build includes those edits
  as a consequence of building from the shared worktree, which is orthogonal
  to these specs.

## Not done

- Nothing from the assigned scope. Both changed specs ran locally and
  passed; no display limitation applied.
- The full `electron-e2e` suite was not run — the task scoped verification to
  the specs I changed.

## Clarifications Needed

None.

## Follow-up: non-spec references

Two more artifacts referenced the removed `settings-section-auth` test id and
would fail at runtime. Both now point at what the page renders. No production
source was touched.

### `apps/ptah-electron-e2e/src/docs-screenshots/workspace-settings.shot.ts`

- **What it targeted:** the test 'settings landing page and theme picker'
  asserted `[data-testid="settings-section-auth"]` is visible after
  `ui.goto('settings')`, then captured `settings-overview`. On this branch that
  locator resolves to 0 and the test fails, so the docs screenshot is never
  taken.
- **What it targets now:** `ptah-providers-settings` and
  `[data-testid="assignments-heading"]` — the same anchors the rewritten
  'settings renders' spec uses. The tab id `claude-auth` is retained and renders
  the consolidated Providers page; the shot therefore shows what a reader now
  sees when they open Settings. The shot name `settings-overview` is kept, so
  existing docs references to that PNG stay valid.
- **Addition:** the test now waits up to 10s for the first
  `[data-testid="provider-connection-card"]` (best-effort, `.catch(() =>
  undefined)`) before the 1.5 s settle and the capture. Purpose: the Providers
  page fills its sections over async reads; without the wait the shot can
  paint skeletons. A profile with no configured connection still shoots.
- **Ran it:** the docs-screenshots pass ran filtered to this file
  (`node ..\..\node_modules\@playwright\test\cli.js test
  --config=docs-screenshots.config.ts src/docs-screenshots/workspace-settings.shot.ts`)
  — **3 passed (1.6m)**, including the edited test. The real app booted with a
  throwaway docs profile; the new anchors resolved and `settings-overview.png`
  was written. The run also rewrites the other PNGs of the file
  (workspace-switcher, recent-workspaces, agents-orchestration, theme-toggle,
  setup-new-project); I restored all six with `git restore` so the worktree
  stays clean — the captures were verification evidence, not a docs delivery.

### `apps/ptah-electron-e2e/src/showcase/settings-tour.scene.ts`

- **What it targeted:** the beat at line 210 opened on the Authentication
  section — `const authSection = page.locator('[data-testid="settings-section-auth"]')`,
  narrated script line 2 ("Use whatever AI you already pay for. Connect any
  provider you like — it all starts right here."), spotlighted it for 1.8 s
  when visible.
- **What it targets now:** the connection list — the heart of the consolidated
  Providers tab. Target is the first `ptah-provider-connection-card` when the
  profile has one, otherwise `#providers-connections-heading` (the "Your
  connections" section heading, which always renders). The `say(2, {target,
  during: spotlight-if-visible})` shape is unchanged, so narration, captions
  and the shot manifest behaviour stay as before.
- **Step meaning, stated plainly:** no step lost its meaning. The old beat
  walked the heart of the Providers tab; that heart is now the connection list,
  and the beat still walks it. The narration line needs no change — "Connect
  any provider you like" describes the new section directly. No replacement
  step was invented and no step was dropped.
- **Docblock:** the "Selector notes" at lines 31-40 now list the new chrome
  (`ptah-providers-settings`, `#providers-connections-heading`,
  `provider-connection-card`) instead of `settings-section-auth`, and the tab
  list in the file docblock reads Providers, Agent Orchestration, Advanced,
  Search & Voice.

### Two pre-existing mismatches, corrected and disclosed

Both are wrong on `origin/main` too — not caused by this branch — and both made
the scene silently skip a beat through its visibility guard while the
voiceover described the control. Fixing them is one word each and makes the
footage match the narration:

1. `TAB_LABELS` entry 3 was `'Pro Features'`; the visible tab label is
   `'Advanced'` (verified on main with `git show origin/main`). `tourTab`'
   `isVisible` guard skipped the click, so the scene narrated the Advanced-tab
   line over whatever tab was open. Now `'Advanced'`.
2. The data-portability beat ("Pop back to the Providers tab") clicked
   `'Providers'`, but Export/Import live in the Advanced tab's block — also on
   main. The `exportBtn` guard skipped the beat every run. Now clicks
   `'Advanced'`.

No scene step was invented beyond these two one-word corrections. A reader of
this report should read them as corrections of recorded narration/footage
mismatches, not new content.

### Verification

| Check | Command | Result |
|---|---|---|
| typecheck | `npx nx run ptah-electron-e2e:typecheck` (env as above) | success, exit 0 |
| lint | `npx nx run ptah-electron-e2e:lint` | success — `15 problems (0 errors, 15 warnings)`, all pre-existing in files I did not touch |
| docs shots | filtered `docs-screenshots.config.ts` run on `workspace-settings.shot.ts` | **3 passed (1.6m)** — includes the edited test; PNGs restored afterwards |

### Not done

- **The scene itself was not recorded.** The showcase harness boots the real,
  authenticated developer profile (`showcase-launcher.ts:124-126` reuses the
  default Electron user-data dir), needs the local docker backend
  (`NODE_ENV=development` dev API URLs), the single-instance lock free, a
  display that hosts the 1080p frame, and the transcode pipeline. Booting this
  branch's build against the real profile also migrates whatever database it
  opens — the failure mode recorded in `docs-fixtures.ts` (TASK_2026_291). I
  did not accept that side effect for a marketing capture. The scene is
  verified by typecheck, lint, and by the docs-screenshots run, which proves
  the same page renders the same anchors in the real app.
- Director targets degrade by design when an element is absent
  (`boxOf` swallows `boundingBox` failures and captions without a box), so a
  profile with zero connections still films the beat; that path was reasoned,
  not observed.