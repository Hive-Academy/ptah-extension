# Implementation Plan Addendum — Get ready pre-steps (TASK_2026_ONBOARDING)

This addendum extends `implementation-plan.md` (approved at Gate 2) and
`implementation-plan.addendum-pr832.md` (approved, including "Post-merge revalidation
(2026-10-28)") with the Get ready pre-steps from `design-spec.md` §12. The user approved §12 on
2026-10-28, including decisions 12.D1–12.D9 and lane items 12.L1–12.L7 (`context.md`, "Design gate
for Get ready"). Where this addendum and the earlier documents disagree on the pre-steps, this
addendum wins. Everything it does not mention stays as approved.

**Revision r1 (2026-10-28, after codex review r0 REVISE; orchestrator decisions in `context.md:56-59`):**

1. The approved §12.2 destination wins. The stage-1 named-account link opens the Claude
   (Subscription) drawer on its Accounts tab. B1b adds one public input, `requestedDrawer`, to
   `ProvidersSettingsComponent` (component 11, RD6). It is the only API change to a reused settings
   component. The former "focus Connections" deviation is removed.
2. No screenshot waivers. Every stage-1, stage-2, banner and strip state is captured in all four
   themes from deterministic mocked-RPC fixtures that B1c adds to
   `libs/frontend/webview-e2e-harness` (component 12). A missing capture reports the visual gate
   UNMET; B1c does not pass on unit specs alone (R24).

**Revision r2 (2026-10-28, last round, after codex review r1 REVISE and user decisions in
`context.md:60-70`):**

1. Stage 2 gains `checking` (new fixture `checking-ambient`: only the ambient RPC unanswered, strip
   "Checking", no banner) and `error` (error banner) captures in all four themes. The total is 80
   (component 12, B1c, L-R11, handoff). The UNMET rule is unchanged.
2. `error-local` uses a function resolver returning `rpcError('detect failed')` and asserts the
   local-cause sentence (component 12).
3. The screenshot step runs the webview build and the harness Nx `e2e` target with a spec filter
   under `node scripts/verify.mjs --exec`, as the user allowed for screenshot steps only
   (`context.md:66-68`), with explicit artifact paths (Verification matrix delta). It stays outside
   `npm run verify`.
4. "Visual layer" is reconciled with the approved §13 (`context.md:63-65`): the four theme ids,
   Lucide names per B1c surface, reuse of `ptah-provider-mark` / `ptah-brand-mark` /
   `ptah-monogram-tile`, the glass surface roles, the inherited fallbacks, and a contrast sweep
   over the other scenes and the `rose` / `moonstone` accents at the B1c visual gate
   (`context.md:69-70`). A5 is corrected (all four themes are eager), and A6 and A7 are added. R27,
   R28 and L-R10 are updated.

Citations are at `main` `35203f1d8` (the worktree base), read in
`/home/amun/ptah-extension/.claude-worktrees/onboarding-module`. Files that B1 creates do not exist
yet; they are cited by plan section (for example "plan §C3"). Abbreviations: `S/` =
`libs/shared/src/lib/types/`, `C/` = `libs/frontend/core/src/lib/`, `CH/` =
`libs/frontend/chat/src/lib/settings/`, `O/` = `libs/frontend/onboarding/src/lib/`. Design lane
items are written `12.L1`–`12.L7` so that they do not collide with the plan's `L1`–`L17`.

## Inputs and constraints

- Requirements used: `context.md` (scope addition, D10, D11, Get ready design gate),
  `design-spec.md` §1.1–§1.3 and §12, `prototype/index.html` (Home: strip, then h1, lede, Claude
  banner, resume banners; `:276-296`), `prototype/screenshots/get-ready-*.png`, `implementation-plan.md`
  (A1–A3, C2, C3, file plan, batches, verification matrix), `implementation-plan.addendum-pr832.md`
  (budget rule `:512-528`).
- Hard rules: no backend change, only the existing RPCs `agent:detectClis` and
  `provider:getAmbientClaudeStatus` (via `ClaudeAmbientStatusService`). Electron first. VS Code and
  the TUI must keep compiling. The existing settings components are reused unchanged, except for one
  additive input on `ProvidersSettingsComponent` (`requestedDrawer`, RD6, approved by the
  orchestrator in `context.md:56-58`). The 4 MB
  initial webview budget holds (`apps/ptah-extension-webview/project.json:63-68`, `maximumError: 4mb`).
- Corrections applied. In each case either source or a higher-ranked spec rule outranks a §12 detail.
  Each one is written up under Decisions.
  1. §12.2 says the named-account link "opens the Claude (Subscription) drawer on its Accounts tab,
     as `ProvidersSettingsComponent.openAccountSignIn()` does". That method is `protected`
     (`CH/providers/providers-settings.component.ts:1224`). The component has only the inputs
     `requestedProviderId`, which opens the setup wizard (`:1028-1047`), and `focusTarget`
     (`:579-583`), which can only focus a region (`:1050-1083`). §12.5 (`design-spec.md:439`) says
     "no new inputs, outputs or services". Resolution: the approved §12.2 destination wins
     (`design-spec.md:397`; orchestrator decision `context.md:56-58`). B1b adds one minimal public
     input, `requestedDrawer`, that opens the Accounts drawer through the existing `openDrawer`
     (component 11, RD6). §12.5's "no new inputs" sentence is the artifact that changes, by exactly
     this input.
  2. §12.4 uses `?tab=providers|cli` on stage 2. §1.1 reserves `tab` for the hidden, validated
     session binding, and the plan's `ONBOARDING_QUERY.tab` carries that meaning (plan §C2).
     Resolution: the stage-2 key is `area` (RD7).
  3. §12.4 says to "add the two child paths to the `onboarding` entry in `webview-surface.types.ts`".
     That registry has no child-path structure (`S/webview-surface.types.ts:44-150` holds only ids,
     aliases and predicates). Child URLs are built in core `onboarding-routes.ts` (plan §C2).
     Resolution: an `onboardingReadyTarget` builder goes there (RD17).
  4. §12.9 describes `ReadyStrip` as a "horizontal stepper mode of `OnboardingStepper`". The stepper
     is created in B2, after the pre-steps land (RD1), and its completed items are links (§2). Strip
     items are never links (§12.6). Resolution: `ReadyStrip` is its own presentational component. It
     keeps the spec name, markers and collapse rule (RD8).
  5. The §12.3 banner and spec D12.D9 are read together for entry: every mount runs detect plus
     `read(false)`. Re-check runs detect plus `read(true)` (RD9).
- Design handoff used: `design-spec.md` §12. Component names are used verbatim (`ClaudeReadinessStore`,
  `ReadyClaudeStep`, `ReadySettingsStep`, `ClaudeReadinessBanner`, `CommandCopyRow`, `ReadyStrip`).
- Missing decision-critical input: none. Every open point below has one answer that the evidence
  supports. None of them re-opens a user decision.

## What changes, in one paragraph

Two lazy child routes are added under `/onboarding`: `ready` (stage 1, Claude Code) and
`ready/settings` (stage 2, Providers and tools). They are matchable only in Electron. The flag
`ptah.onboarding.v1` gains an optional `ready` sub-object. The first-run guard targets
`/onboarding/ready` until `ready.claudeAt` or `ready.skippedAt` exists, and otherwise targets Home.
Re-entry still opens Home. A root-provided `ClaudeReadinessStore` derives one of five states
(checking, ready, missing, signed-out, error) from `ProvidersSettingsStateService.cliDetection()`
and `ClaudeAmbientStatusService.view()`. Stage 1, a non-dismissable banner (stage 2 and Home), and
a three-item `ReadyStrip` (stage 1, stage 2 and Home) render that state. Stage 2 embeds the existing
`ptah-providers-settings` and `ptah-cli-orchestration-matrix` inside `@defer`; the only change to
them is the additive `requestedDrawer` input on providers, so the named-account link can open the
Claude Accounts drawer (RD6). It
provides the two page-scoped services those components inject and renders the settings toast. The
components reach onboarding through a new narrow entry, `@ptah-extension/chat/settings-embed`, so the
eager chat barrel does not grow. The Claude install and sign-in commands move into one core
constant. The settings Credentials tab and the core setup-dialog message read that constant (spec
12.D4, 12.L6). Two batches are inserted between B1 and B2: **B1b** (core constant, settings
alignment, chat embed entry, route builder, `requestedDrawer` input) and **B1c** (the pre-steps in
onboarding, plus the mocked-RPC capture fixtures in the e2e harness). B5a gains
the approved Settings row "Check Claude Code" (12.L4). B5b's e2e spec asserts the new first-run
target.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `CliDetectionResult` has `cli`, `installed`, `path?` and `version?` | `S/agent-process.types.ts:414-418` | Stage 1 reads the row with `cli === 'claude'`. It reads `installed`, `path` and `version` only |
| `'claude'` is a member of `SYSTEM_CLI_TYPES`; `CliType = SystemCliType \| 'ptah-cli'` | `S/agent-process.types.ts:81-90`, `:94` | The row selector is the literal `'claude'`, which typecheck verifies |
| `agent:detectClis` takes `params: void` and returns `{ clis: CliDetectionResult[] }` | `S/rpc.types.ts:1397-1400` | No new RPC is needed |
| The host handler invalidates its cache on every call, then detects each adapter in turn | `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:1013-1022`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts:107-135` | A detect is a real re-probe of all CLIs and can take seconds. Overlapping calls share one in-flight promise (`:111-116`) (R20) |
| The frontend calls `agent:detectClis` in three places: `ProvidersSettingsStateService.redetectClis()` (the settings owner), `task-agent-discovery.service.ts:53` and `host-inventory.cache.ts:41` (both private to their features) | `C/services/providers-settings-state.service.ts:836-850`; `libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.ts:53`; `libs/frontend/chat/src/lib/services/vitals/host-inventory.cache.ts:41` | Onboarding reuses `redetectClis()` (spec §12.2). It writes the shared `cliDetection` section that the embedded matrix also shows, then re-reads orchestration, CLI agents and CLI models |
| `redetectClis()` returns `Promise<boolean>`; `cliDetection` is a section view (`status: unloaded\|loading\|ready\|error`, `data`) | `C/services/providers-settings-state.service.ts:168-169`, `:836-850`; `C/services/providers-settings-sections.ts:31-41` | The store reads `cliDetection()` for checking, error and data, and does not keep its own copy |
| A section read drops superseded replies. It keeps the previous data on error. A value read in another workspace shows as `unloaded` | `C/services/providers-settings-sections.ts:44-55`, `:85-106` | Race-free by construction. The store treats `unloaded` as checking (mount always starts a read) and treats `error` as error, never using the retained data |
| `ClaudeAmbientStatusService` is root-provided and is **inert unless Electron** (`enabled = VSCodeService.isElectron`). It has `view(): { status: inert\|idle\|checking\|ready; result; localFailure }` and `read(refresh)`, which never throws, applies only the latest reply, and has a 30 s timeout | `C/services/claude-ambient-status.service.ts:14`, `:25-29`, `:49-59`, `:71-80`, `:83-109` | Stage 1, the banner and the strip are Electron only. In VS Code the service makes no RPC (VS Code behaviour below) |
| `ProviderAmbientClaudeStatus { state: connected\|signed-out\|unknown; checkedAt; reason?: cli-missing\|timeout\|unreadable }`; "`unknown` is never read as signed out" | `S/provider-account.types.ts:263-293` | Spec 12.D7 is a contract. `unknown` without a `reason` maps to error (RD10) |
| Both services are exported from `@ptah-extension/core` (re-export at `providers-settings-state.service.ts:96-99`; barrel `export *` at `libs/frontend/core/src/index.ts:7`) | as cited | Onboarding imports them from the core barrel, which is already an allowed dependency |
| `ptah-providers-settings` is standalone OnPush with inputs `requestedProviderId`, `focusTarget` (`ProvidersSettingsFocusTarget` includes `'connections'`) and output `requestedProviderConsumed`. It injects root services. `ngOnInit` calls `state.open()`, `accounts.open('claude')` and `ambient.read(false)` | `CH/providers/providers-settings.component.ts:67-72`, `:82-83`, `:579-592`, `:1085-1090`; anchor `data-focus="connections"` `:224` | Can be embedded with no inputs. No existing input opens a drawer: `focusTarget` only focuses a region or opens a popover or catalog (`:1050-1083`) (RD6). Its own `read(false)` touches the shared ambient view (R21) |
| `openAccountSignIn()` is `protected`. It finds the Claude CLI connection by kind (`isClaudeCli` → `connectionKind(...) === 'claude-cli'`, `:602-604`) and calls `openDrawer(claude.id, 'accounts')`; it is a no-op when no Claude connection exists | `CH/providers/providers-settings.component.ts:1219-1235` | Opening the Accounts drawer from outside needs one new input (correction 1, component 11) |
| `protected openDrawer(providerId: string, tab: ConnectionDrawerTabId = 'overview')` records the opener, sets `drawerTab` and `drawerId`, and refreshes the connection setup. `ConnectionDrawerTabId = 'overview' \| 'accounts' \| 'credentials' \| 'models' \| 'advanced'` | `CH/providers/providers-settings.component.ts:1210-1217`; `CH/providers/connection-drawer/connection-kind.ts:11` | `requestedDrawer` reuses `openDrawer` unchanged |
| The deep-link input pattern: `requestedProviderId` is handled by a constructor `effect` with a per-request guard (`openedFor`), reset when the input clears, opening under `untracked` | `CH/providers/providers-settings.component.ts:1028-1047` | `requestedDrawer` copies this pattern |
| Connection ids are not provider ids by contract: "derived only from non-secret connection metadata, never from the provider id" | `CH/providers/connection-drawer/connection-kind.ts:4-8`, `:37-49` | The request names the connection kind, not an id; the component resolves the id as `openAccountSignIn` does |
| `providers-settings.component.spec.ts` exists, with Electron and inert-host suites for named Claude accounts and a `claude-cli` connection fixture | `CH/providers/providers-settings.component.spec.ts:1055`, `:1097`, `:1148`, `:1252` | The `requestedDrawer` cases go into these suites |
| `ptah-cli-orchestration-matrix` has **no inputs and no `ngOnInit`**. It injects `ProvidersSettingsStateService` and `SettingsSaveFeedbackService`. Its settings host calls `state.open()` and defers it | `CH/ptah-ai/cli-orchestration-matrix.component.ts:175`, `:1137`, `:1164-1165`; host `CH/ptah-ai/orchestration-settings.component.ts:75-76`, `:328-329` | The stage-2 CLI tabpanel must call `state.open()` itself (RD5) |
| The matrix children `ptah-agent-orchestration-config` (Re-detect → `state.redetectClis()`) and `ptah-add-cli-instance-modal` both inject `SettingsSaveFeedbackService` | `CH/ptah-ai/agent-orchestration-config.component.ts:371-372`, `:578-584`; `CH/providers/add-cli-instance-modal.component.ts:378-379` | Same page-scope need |
| **Page-scoped DI.** `SettingsComponent` provides `SettingsSaveFeedbackService` and `{ provide: PROVIDER_MODELS_LOADER, useClass: ProvidersModelsLoader }` and renders `<ptah-settings-toast />`. These are the only two `@Injectable()` (non-root) classes under `CH/` | `CH/settings.component.ts:110-113`; `CH/settings.component.html:241`; `CH/feedback/settings-save-feedback.service.ts:56-66`; `CH/providers/providers-models-loader.service.ts:7-8`; grep `@Injectable()` under `CH/` → 2 hits | The components cannot be embedded outside the settings shell unless the host supplies both providers and the toast (RD4) |
| `PROVIDER_MODELS_LOADER` is exported from `@ptah-extension/ui` | `libs/frontend/ui/src/lib/native/provider-model-picker/provider-models-loader.port.ts:48`; imported so at `CH/settings.component.ts:21` | Onboarding may import it (`type:feature` → `type:ui` is allowed) |
| The chat settings barrel exports only `SettingsComponent` and `AgentOrchestrationConfigComponent`. Its comment says a re-export there "keeps them in the eager bundle" | `CH/index.ts:1-11`; `libs/frontend/chat/src/index.ts:14` | Do not widen the chat barrel. Add a narrow secondary entry (RD3) |
| Precedent for a narrow chat entry: `@ptah-extension/chat/inspector`, a one-file entry consumed by `canvas` | `libs/frontend/chat/src/inspector.ts:1-4`; `tsconfig.base.json:46-48`; `libs/frontend/canvas/src/lib/canvas-rail/canvas-inspector-dock.component.ts:9` | The new `settings-embed` entry follows it. Chat is never lazy-imported by path, so no `checkDynamicDependenciesExceptions` entry is needed (`eslint.config.mjs:279-292`) |
| Settings mounts providers in `@defer (on immediate)` with an `aria-busy` placeholder and a Reload-on-error block (`reloadWindow()` → `location.reload()`) | `CH/settings.component.html:164-198`; `CH/settings.component.ts:296-298` | Stage 2 copies this pattern (spec §12.5). The placeholder keeps the harness's settle wait working |
| `credentials-tab.component.ts`: `CLAUDE_LOGIN = 'claude login'` and `CLAUDE_INSTALL = 'npm install -g @anthropic-ai/claude-code'`, plus the literal `claude login` in the doc comment, the template text and the copy label | `CH/providers/connection-drawer/credentials-tab.component.ts:91`, `:93`, `:105`, `:134`, `:411-414` | The spec 12.D4 alignment touches these 5 places and the spec at `credentials-tab.component.spec.ts:346-357` (`:351`, `:354` assert `claude login`) |
| A third copy of the same commands is in core's setup-dialog message | `C/services/providers-connection-setup.service.ts:255` | Built from the same constant (RD15) |
| The e2e harness asserts only the npm install text and the testid `credentials-copy-login` | `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.table.ts:1551-1556` | Unaffected if the testid ids and the npm string are kept |
| The clipboard copy pattern, with the fallback "Select the command and copy it" | `CH/providers/connection-drawer/credentials-tab.component.ts:592-598` | `CommandCopyRow` uses the same API and the spec's fallback copy |
| OS platform in the webview: `WebviewConfig.platform` (`'darwin'\|'win32'\|'linux'`), set by the Electron preload | `C/services/vscode.service.ts:25-26`; `apps/ptah-electron/src/preload.ts:46`; consumer precedent `electron-shell.component.ts:652` | Default install tab: `win32` → Windows, anything else → macOS / Linux |
| An external link is a plain `<a target="_blank" rel="noopener noreferrer">`. Electron's window-open handler opens it with `shell.openExternal` after a safety check | `CH/providers/connection-drawer/kimi-code-login-progress.component.ts:77`; `apps/ptah-electron/src/windows/main-window.ts:45-49`, `:86-89` | The docs link needs no new IPC |
| PATH: `fixPath()` runs once at Electron bootstrap and always unions `~/.local/bin` (among others) on macOS/Linux. It is a no-op on Windows | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/fix-path.ts:100-130`, fallback dirs `:30-45`; `apps/ptah-electron/src/activation/bootstrap.ts:283`; `which`/`where` lookup at `libs/backend/agent-sdk/src/lib/detector/claude-cli-path-resolver.ts:216-223` | Evidence for 12.L5. The restart hint matters on Windows and when an install directory outside the fallback set was added after launch. The approved copy stays |
| Gated deep link into a surface: `AppStateManager.openMarketplace()` → `requestSurface(surface, subPath)`; `setCurrentView` has no sub-path | `C/services/app-state.service.ts:1157-1160`, `:579-596`, `:980-991` | The 12.L4 Settings row uses a new gated `openOnboardingReady()` of the same shape (B5a) |
| `navigateToSurface(id, subPath)` builds the tree with `createUrlTree` | `C/routing/surface-router.service.ts:137-163` | Used through `requestSurface`. No string URLs |
| `setCurrentView` returns early when the surface is already current | `C/services/app-state.service.ts:983-989` | Inside onboarding, stage ↔ Home moves use the Angular `Router` / `routerLink`, never `setCurrentView` |
| Electron main window `minWidth: 800` | `apps/ptah-electron/src/windows/main-window.ts:125` | The 400px narrow screenshots cannot come from resizing the window (screenshot plan, Assumption A4) |
| The webview e2e harness is Playwright over the real webview build. `test.use({ useAppBuild: true })` serves `dist/apps/ptah-extension-webview`, and startup throws if no build exists | `libs/frontend/webview-e2e-harness/src/lib/test-fixtures.ts:32-44`, `:61-74`; `src/lib/fixture-server.ts:154-163` | State captures come from the harness, not from staging the developer machine (component 12) |
| RPC mocking: `installPostMessageBridge` stubs `acquireVsCodeApi` (`postmessage-bridge.ts:58-90`). `installRpcAutoResponder(page, fixtures)` answers `rpc:call` with `rpc:response`; a function value is a per-call resolver; `rpcError(message)` answers `success: false`; **an unfixtured method is never answered** | `src/lib/scenarios/marketplace/marketplace.fixtures.ts:98`, `:111-113`, `:129-160`, `:180-239`; convention stated at `settings/settings.fixtures.ts:21-23` | `checking` = leave both readiness RPCs unanswered; `error` = `rpcError` or an `unknown` ambient reply |
| Electron host emulation: `installHost(page, 'electron', initialView)` injects the preload's `ptahConfig` (`isElectron: true`, `platform: 'win32'`) | `marketplace.fixtures.ts:35-51`, `:73-84` | `ClaudeAmbientStatusService` is enabled, so the ambient RPC is sent |
| Settings fixtures already answer every RPC the embedded providers page and matrix fire, including `agent:detectClis` and `provider:listAccounts`; `bootSettings` seeds the theme through `localStorage['ptah-theme-v2']` | `settings/settings.fixtures.ts:630`, `:741`, `:830-835`, `:867-911` | The onboarding fixtures extend `baseSettingsFixtures()` and override the two readiness RPCs |
| Theme ids `ptah-glass` and `ptah-glass-light` exist; the theme hint key is `ptah-theme-v2`. Existing harness visual specs use only `anubis` and `anubis-light` | `C/services/theme.service.ts:19-20`, `:200`; `plan-limits/plan-limits-visual.e2e.spec.ts:59` | The onboarding capture matrix adds the two glass ids |
| Capture precedent: one helper settles the page (no `aria-busy`), parks the pointer and disables animations | `settings/settings-capture.ts:19-31`; `waitForSettled` at `settings.fixtures.ts:917-924` | `checking` cannot use the settle wait (it is `aria-busy` by design); a dedicated helper is needed |
| `@axe-core/playwright` is a root dev dependency | `package.json:217` | Axe runs per capture in the same spec |
| Ambient reply shape: `{ ok: true, status: { state, checkedAt, reason? } }`; anything else is a local failure | `C/services/claude-ambient-status.service.ts:83-105` | Fixture replies use this shape |
| The harness project has only `typecheck` and `e2e` targets; its lib tsconfig excludes `*.spec.ts` | `libs/frontend/webview-e2e-harness/project.json:7-25`; `tsconfig.lib.json:8-13` | `npm run verify` typechecks the fixture files; capture runs are an explicit step, not part of verify |

## Architecture decision

- Chosen approach: a self-contained `ready/` feature folder inside the new onboarding lib. Its only
  inputs are root services that already exist in core (`ProvidersSettingsStateService`,
  `ClaudeAmbientStatusService`, `VSCodeService`). It touches the base design at four points: the
  flag schema (`ready` slice), the guard target, the Home template (strip, banner, footer link) and
  the route tree. Stage 2 reuses the settings components through a narrow chat entry and a local
  page scope. The shared command strings live in `@ptah-extension/core`.
- Rationale: every input the stages need is already a root signal in core. Detection is the
  settings-owned `redetectClis()` (spec §12.2). Ambient status has a single owner by contract
  (`claude-ambient-status.service.ts:43-48`). The only non-root needs of the embedded components are
  the two page-scoped services, which this plan supplies. No backend, shared-type or host change is
  required.
- Rejected alternatives:
  - A new onboarding-owned `agent:detectClis` caller (as `task-agent-discovery.service.ts:53` does).
    It would fork detection state from the matrix shown on stage 2, which would then display a
    different "installed" verdict from the stage-1 panel.
  - Exporting the settings components from the chat barrel. This contradicts `CH/index.ts:1-7` and
    risks the initial bundle.
  - A compact onboarding re-implementation of the provider and CLI lists. The user rejected it in
    spec 12.D6.
  - Persisting the Claude state. The user rejected it in spec §12.4.
- Assumptions:
  - A1: B1 builds the flag schema, guard, tracker, Home, shell and routes exactly as plan §A3/§C3/§A2
    describe. Check: B1c starts by reading those B1 files. If B1 deviated, B1c adapts the same
    contracts and records the deviation.
  - A2: `@defer (on immediate)` in an onboarding template splits the reused components into their
    own chunk, as it does in settings. Check: B1c's grep gates (below) plus the PR build that CI
    runs. No local build (CLAUDE.md).
  - A3: the harness boot with the Electron host config, the real app build and no
    `localStorage['ptah.onboarding.v1']` lands on `/onboarding/ready` through the B1c guard, and a
    seeded flag record reaches Home and stage 2 by clicks. Check: B1c's visual spec asserts the URL
    and the stage-1 chip text before every capture; a mismatch fails the spec, it never captures.
  - A4: the 400px captures use Playwright `page.setViewportSize` in the harness (Chromium has no
    800px window minimum, unlike `main-window.ts:125`). Check: the spec asserts the viewport width
    before the narrow captures.
  - A5: a glass theme seeded in `localStorage['ptah-theme-v2']` is applied before first paint, as
    the plain ids are today. All four ids are eager themes (`theme.service.ts:185`), so no deferred
    sheet is involved. Check: the capture helper waits for `data-theme` (and `data-glass` for the
    glass ids) on the document root before capturing.
  - A6: the scene and accent hint keys `ptah-scene` and `ptah-accent` (`theme.service.ts:72-73`,
    `:90-91`), seeded in `localStorage` before `goto`, select the scene and accent at boot, as
    `ptah-theme-v2` selects the theme. Check: the helper asserts `data-scene` / `data-accent` on the
    root (`:276-282`) before the sweep captures; if the hints are not read at boot, the helper sets
    them through the app's theme controls instead.
  - A7: Chromium honours `prefers-reduced-transparency: reduce` emulated through CDP
    `Emulation.setEmulatedMedia`. Check: the helper evaluates
    `matchMedia('(prefers-reduced-transparency: reduce)').matches` before capturing; if it is
    false, the capture is reported unavailable (gate UNMET), not replaced.
- Effect on existing code: additive except five places. (1) The credentials-tab command strings
  change: the sign-in command becomes `claude`, approved in 12.D4 and 12.L6. (2) The core setup
  message reads the constant. (3) The guard's redirect target and its specs change. (4) The base
  plan's B1 webview routing expectations change from `/onboarding` to `/onboarding/ready` for
  first run. (5) `ProvidersSettingsComponent` gains one additive input, `requestedDrawer`
  (component 11); with the input absent its behaviour is unchanged. No other component under `CH/`
  changes behaviour, inputs, outputs or providers.

## Integration with the base plan's design

### Flag shape and migration (`O/first-run/onboarding-flag.service.ts`, plan §A3/§C3)

```ts
export interface OnboardingReadyFlag {
  readonly claudeAt?: string;    // ISO datetime: stage 1 left by Continue in state `ready`
  readonly settingsAt?: string;  // stage 2 left by "Continue to setup"
  readonly skippedAt?: string;   // either stage left by "Continue anyway" or "Skip for now" (latest wins)
}
export interface OnboardingFlag {
  readonly shownAt?: string;
  readonly dismissedAt?: string;
  readonly completedAt?: string;
  readonly ready?: OnboardingReadyFlag;            // NEW (spec 12.D1, 12.L2)
}
// OnboardingFlagService additions
markReady(key: keyof OnboardingReadyFlag): void;    // read-modify-write of the whole record
```

- Parsing: the top level stays a zod `strictObject` (plan §A3). An unknown top-level key still
  makes the record unreadable, which means no redirect. `ready` is parsed **leniently and on its
  own**. If it is not an object of optional ISO datetimes, it is dropped (read as `{}`) and the
  three top-level fields are kept. A malformed `ready` therefore never costs the user `shownAt` and
  never triggers a redirect.
- Migration of an existing v1 value: none is written. A v1 record without `ready` parses
  unchanged, and `ready` reads as `{}`. Because `shownAt` is already set, the guard does not fire,
  so a user who has already seen onboarding never sees stage 1 automatically. That matches 12.D2:
  only first run targets stage 1. A user with no record (fresh install, or an upgrade from a
  pre-onboarding build) gets the stage-1 redirect once (spec §12.4, rows 1–2). Downgrade: a record
  carrying `ready` fails a B1-only strict schema and is read as unreadable, so there is no redirect
  and no loop. B1 and B1c ship in one PR, so no released build has the B1-only schema.
- Writes: every `mark*` method (B1's `markShown`, `markDismissed` and `markCompleted`, and the new
  `markReady`) merges into the record it reads. No method drops another's fields. A `markReady`
  write failure is swallowed. It does not set B1's `suppressed` flag, because `ready` does not
  affect eligibility and cannot cause a redirect loop. The strip may show a stale "Next", which is
  acceptable.
- The flag service stays storage-only. It does not compute route targets.

### Guard target (`O/first-run/onboarding-first-run.guard.ts`, plan §C3)

- Eligibility is unchanged: Electron, `isFirstRunEligible()` (no `shownAt`, storage ok, not
  suppressed).
- Target: `router.createUrlTree(['/onboarding', 'ready'])` when `flag().ready` has neither
  `claudeAt` nor `skippedAt`; otherwise `['/onboarding']` (spec §12.4, row 1; 12.L1).
- The tracker is unchanged. Its rows already test the **first segment** `onboarding` (plan §C3 table:
  `NavigationStart` "first segment is `onboarding`", `NavigationEnd` "`urlAfterRedirects` first
  segment is `onboarding`"). `/onboarding/ready` therefore commits `shownAt` on arrival. Plan §A3's
  phrase "whose URL is `/onboarding`" is read as "first segment `onboarding`". B1c adds a tracker
  spec row for `/onboarding/ready`.
- `initial-navigation.ts` is unchanged. Its settle check compares the first segment (plan §A3,
  `:117-125`, `:121`). B1c adds a spec case for a restored `/chat` that settles on `/onboarding/ready`.

### Re-entry (spec 12.D2)

Unchanged from plan §A3: the menu "Setup" and Settings "Run onboarding again" call
`setCurrentView('onboarding')` and land on Home. The flag is ignored. Home's footer adds "Review
Claude Code and settings", which links to `/onboarding/ready` (Electron only). B5a adds the
approved Settings row "Check Claude Code" (12.L4), which calls `AppStateManager.openOnboardingReady()`.
That method is gated by `canSwitchViews()` and routed through `requestSurface('onboarding',
onboardingReadyTarget().subPath)`, the same shape as `openMarketplace` (`app-state.service.ts:1157-1160`).

### Routes (`O/onboarding.routes.ts`)

| Path (under `/onboarding`) | Component | Guards / providers | Query read |
| --- | --- | --- | --- |
| `ready` | `ReadyClaudeStep` | `canMatch: [onboardingReadyHostGuard]` on a componentless parent `ready` | none |
| `ready/settings` | `ReadySettingsStep` | inherits the parent `canMatch`. Route providers: `SettingsSaveFeedbackService`, `{ provide: PROVIDER_MODELS_LOADER, useClass: ProvidersModelsLoader }` | `area?` (`providers` \| `cli`, any other value → `providers`) |

- `onboardingReadyHostGuard: CanMatchFn` returns `true` in Electron. Otherwise it returns
  `createUrlTree(['/onboarding'])`, so in VS Code a deep link, a restored URL or a stray link lands
  on Home (spec §12.2, "the stage is not shown at all").
- The children are in the onboarding chunk, as all of `ONBOARDING_ROUTES` is (plan §A2). The two
  heavy settings components sit in `@defer` blocks inside `ReadySettingsStep`, so they are a
  separate deferred chunk.
- Route `data: { crumb: 'Get ready' }` on the parent. The shell renders "Onboarding / Get ready",
  with the first crumb going to Home (spec §12.1 and §12.4, "Back to chat" row).
- Ordering in the file: `ready` is declared before `**` (plan §A2 keeps `**` → `''` last).

### Progress strip, warning banner, Home

- `ReadyStrip` appears on stage 1, stage 2 and Home (above the h1). It does not appear on the
  Analyze, New project or Team builder routes (spec §12.6).
- `ClaudeReadinessBanner` appears on stage 2 (above the tablist) and on Home (after the lede,
  before the resume banners; prototype `index.html:281-296`) whenever the state is `missing`,
  `signed-out` or `error`. Stage 1 shows its own panel, not the banner. Neither appears in VS Code.
- Home mounts call `ClaudeReadinessStore.refresh(false)`. In VS Code the store does nothing.

## Contracts

### Core: Claude Code commands (`C/services/claude-code-commands.ts`, NEW)

```ts
export const CLAUDE_CODE_SIGN_IN_COMMAND = 'claude';                         // spec 12.D4
export const CLAUDE_CODE_NPM_INSTALL_COMMAND = 'npm install -g @anthropic-ai/claude-code';
export const CLAUDE_CODE_SETUP_DOCS_URL = 'https://code.claude.com/docs/en/setup';
export type ClaudeCodeInstallTab = 'unix' | 'windows' | 'npm';
export interface ClaudeCodeInstallCommand {
  readonly id: 'unix' | 'powershell' | 'cmd' | 'npm';
  readonly tab: ClaudeCodeInstallTab;
  readonly label: string;      // spec §12.2 install table "Label" column, verbatim
  readonly command: string;    // spec §12.2 install table "Command" column, verbatim
}
export const CLAUDE_CODE_INSTALL_COMMANDS: readonly ClaudeCodeInstallCommand[];  // 4 rows, spec order
```

The `npm` row's `command` is `CLAUDE_CODE_NPM_INSTALL_COMMAND`. Exported from
`C/services/index.ts`, which is re-exported by the core barrel (`libs/frontend/core/src/index.ts:1`).
Data only: no Angular, no I/O.

### Core: route builder (`C/routing/onboarding-routes.ts`, B1 file, additive in B1b)

```ts
export type OnboardingReadyArea = 'providers' | 'cli';
export type OnboardingReadyOpen = 'claude-accounts';
export const ONBOARDING_READY_QUERY = { area: 'area', open: 'open' } as const;
export function onboardingReadyTarget(
  stage?: 'claude' | 'settings', area?: OnboardingReadyArea, open?: OnboardingReadyOpen,
): OnboardingTarget;
//   'claude' (default) → { subPath: ['ready'], queryParams: {} }
//   'settings'          → { subPath: ['ready','settings'], queryParams: { area?, open? } } (only the given keys)
export function parseOnboardingReadyArea(value: unknown): OnboardingReadyArea;        // anything else → 'providers'
export function parseOnboardingReadyOpen(value: unknown): OnboardingReadyOpen | null;  // anything else → null
```

`OnboardingTarget` is the plan's type (plan §C2). `ONBOARDING_QUERY` is not changed. `area` and
`open` are separate keys (RD7). The named-account link is
`onboardingReadyTarget('settings', 'providers', 'claude-accounts')`.

### Chat: drawer request input (`CH/providers/providers-settings.component.ts`, MODIFY in B1b)

```ts
/** A deep link that opens a connection drawer on a tab. Only the Claude Accounts drawer is requestable. */
export interface ProvidersSettingsDrawerRequest {
  readonly connection: 'claude-cli';   // a ConnectionKind value (connection-kind.ts:9), resolved like openAccountSignIn
  readonly tab: 'accounts';            // a ConnectionDrawerTabId member (connection-kind.ts:11)
}
readonly requestedDrawer = input<ProvidersSettingsDrawerRequest | null>(null);   // next to focusTarget (:583)
```

The type is exported from the component file and re-exported by `settings-embed.ts`. It is the only
API change to a reused settings component (RD6).

### Chat: narrow embed entry (`libs/frontend/chat/src/settings-embed.ts`, NEW; path `@ptah-extension/chat/settings-embed`)

```ts
export { ProvidersSettingsComponent, type ProvidersSettingsDrawerRequest } from './lib/settings/providers/providers-settings.component';
export { CliOrchestrationMatrixComponent } from './lib/settings/ptah-ai/cli-orchestration-matrix.component';
export { SettingsSaveFeedbackService } from './lib/settings/feedback/settings-save-feedback.service';
export { ProvidersModelsLoader } from './lib/settings/providers/providers-models-loader.service';
export { SettingsToastComponent } from './lib/settings/feedback/settings-toast.component';
```

A header comment states the page-scope contract: a host that embeds either component must
provide `SettingsSaveFeedbackService` and `PROVIDER_MODELS_LOADER`, and must render
`<ptah-settings-toast />`, as `CH/settings.component.ts:110-113` and `.html:241` do. The entry must be
imported only from `O/ready/`. `libs/frontend/chat/src/index.ts` and `CH/index.ts` stay unchanged.

### Onboarding: readiness (`O/ready/claude-readiness.store.ts`, NEW)

```ts
export type ClaudeReadinessState = 'checking' | 'ready' | 'missing' | 'signed-out' | 'error';
export type ClaudeReadinessErrorCause = 'timeout' | 'unreadable' | 'local';   // copy variants, spec §12.2
export interface ClaudeReadinessView {
  readonly state: ClaudeReadinessState;
  readonly errorCause: ClaudeReadinessErrorCause | null;   // non-null only for 'error'
  readonly path: string | null;                            // from the Claude row; null unless installed
  readonly version: string | null;
}
export interface ClaudeReadinessInputs {
  readonly detection: ProvidersSettingsSection<readonly CliDetectionResult[]>;   // cliDetection()
  readonly ambient: ClaudeAmbientStatusView;                                      // view()
}
export function deriveClaudeReadiness(input: ClaudeReadinessInputs): ClaudeReadinessView;  // pure

@Injectable({ providedIn: 'root' })
export class ClaudeReadinessStore {
  readonly available: boolean;                        // VSCodeService.isElectron, read once
  readonly view: Signal<ClaudeReadinessView>;        // computed from the two root signals
  readonly rechecking: Signal<boolean>;              // a Re-check started here is in flight
  refresh(fresh: boolean): Promise<ClaudeReadinessState>;  // detect + ambient.read(fresh); resolves with the settled state
}
```

Derivation, first match wins (spec §12.2 table, made exact):

| UI state | Condition |
| --- | --- |
| `checking` | `detection.status` is `unloaded` or `loading`, or `ambient.status` is `checking` or `idle` |
| `missing` | the `claude` row has `installed === false`, or `ambient.result?.state === 'unknown' && reason === 'cli-missing'` |
| `error` | `detection.status === 'error'`, or no `claude` row in `ready` data, or `ambient.localFailure`, or `ambient.result.state === 'unknown'` with reason `timeout`, `unreadable` or none |
| `signed-out` | the row is installed and `ambient.result.state === 'signed-out'` |
| `ready` | the row is installed and `ambient.result.state === 'connected'` |

`errorCause`: ambient `timeout` → `timeout`; ambient `unreadable` → `unreadable`; anything else →
`local`, which covers a detect failure, `localFailure`, a missing row and `unknown` without a
reason. `refresh(true)` is Re-check, running `redetectClis()` and `ambient.read(true)` in parallel.
`refresh(false)` is the mount read, running `redetectClis()` and `ambient.read(false)` (RD9). When
`available` is false, `refresh` resolves immediately and makes no call.

### Onboarding: components (all standalone, OnPush, signals, `@if`/`@for`)

```ts
// O/ready/command-copy-row.component.ts
CommandCopyRow   inputs: command: string (required), copyLabel: string (required, the aria-label)
                 behaviour: mono <code> (selectable, wraps); Copy → navigator.clipboard.writeText;
                 "Copy" → "Copied" for 2 s (timer cleared on destroy and on a new copy);
                 announces "Command copied" through OnboardingAnnouncerService (plan B1 shell);
                 on clipboard rejection shows "Select the text and copy it." inline; focus stays on the button
// O/ready/ready-strip.component.ts
ReadyStrip       inputs: current: 1 | 2 | 3; claude: ClaudeReadinessState; settings: 'next' | 'done' | 'skipped'
                 pure presentational; <ol aria-label="Setup progress">, aria-current="step" on the current item
// O/ready/claude-readiness-banner.component.ts
ClaudeReadinessBanner inputs: state: ClaudeReadinessState; placement: 'home' | 'settings'
                 renders only for missing | signed-out | error; role="status"; one action → routerLink /onboarding/ready
// O/ready/ready-claude-step.page.ts         ReadyClaudeStep   (route 'ready')
// O/ready/ready-settings-step.page.ts      ReadySettingsStep (route 'ready/settings')
// O/ready/onboarding-ready-host.guard.ts   onboardingReadyHostGuard: CanMatchFn
// O/ready/ready-strip-state.ts             readyStripSettingsWord(flag, onHome): 'next' | 'done' | 'skipped' (pure, RD11)
```

## Component specifications

### 1. Claude Code command constant and settings alignment (core + chat)

- Purpose: one source for the Claude Code install and sign-in commands, so that settings and
  onboarding cannot drift (spec 12.D4, 12.L6).
- Responsibilities:
  - Declare the constant (Contracts).
  - Change `credentials-tab.component.ts`:
    - `:91` and `:93` import `CLAUDE_CODE_SIGN_IN_COMMAND` and `CLAUDE_CODE_NPM_INSTALL_COMMAND`.
    - The `:134` text becomes "Run `<code>{{ signInCommand }}</code>` in your terminal and follow the
      browser prompts; if the CLI is missing, install it first."
    - The `:412` label becomes `'sign-in command'`, so the aria-label reads "Copy sign-in command".
    - The doc comment at `:105` is updated.
    - The `id`s `login` and `install` and the testids `credentials-copy-login` and
      `credentials-copy-install` are kept.
  - Build the `providers-connection-setup.service.ts:255` message from the same constants: "Run
    claude in your terminal and follow the browser prompts, then choose Check again. If missing,
    install with npm install -g @anthropic-ai/claude-code." (RD15).
- Verified contracts and entry points: the cited lines in Codebase evidence. The spec assertions
  are at `credentials-tab.component.spec.ts:351` and `:354`.
- Dependencies: core ← chat (`type:feature` → `type:core`, `eslint.config.mjs` type rules). The
  constant has no dependencies.
- Integration points: credentials tab (Electron and VS Code settings, since the webview is shared),
  the core setup dialog message and onboarding stage 1.
- Failure behaviour: not applicable (constants).
- Quality requirements: the sign-in command is exactly `claude` and the npm command is unchanged,
  so harness `settings-reachability.table.ts:1551-1556` keeps passing.
- Verification seam: `credentials-tab.component.spec.ts`, where `:351`/`:354` assert the constants
  and the copy button writes `CLAUDE_CODE_SIGN_IN_COMMAND`. A new `claude-code-commands.spec.ts`
  checks 4 rows with distinct ids, tabs in the order unix, windows, windows, npm, and the npm row
  equal to the npm constant.
- Files: CREATE `libs/frontend/core/src/lib/services/claude-code-commands.ts` (+`.spec.ts`).
  MODIFY `libs/frontend/core/src/lib/services/index.ts`,
  `libs/frontend/core/src/lib/services/providers-connection-setup.service.ts` (+ its spec only if
  it asserts the message; it does not at `35203f1d8`),
  `libs/frontend/chat/src/lib/settings/providers/connection-drawer/credentials-tab.component.ts`
  (+`.spec.ts`).

### 2. Chat settings embed entry

- Purpose: make the two reused settings components and their page-scope services importable by
  the lazy onboarding lib without growing the eager chat barrel.
- Responsibilities: re-exports only (Contracts: five values plus the `ProvidersSettingsDrawerRequest`
  type), a header comment with the page-scope contract, and a tsconfig path.
- Verified contracts and entry points: the component and service classes at
  `providers-settings.component.ts:579`, `cli-orchestration-matrix.component.ts:1137`,
  `settings-save-feedback.service.ts:66`, `providers-models-loader.service.ts:8` and
  `settings-toast.component.ts:111`. The precedent is `chat/src/inspector.ts`
  (`tsconfig.base.json:46-48`).
- Dependencies: none new. Consumers: only `O/ready/`.
- Integration points: `@ptah-extension/chat/settings-embed`.
- Failure behaviour: if an embedded component later gains a third page-scoped injectable, the embed
  fails with a `NullInjectorError` when that subtree renders (R19). The header comment and RD4's
  spec are the guard.
- Quality requirements: the initial bundle must not grow. Gate:
  `git grep -n "@ptah-extension/chat/settings-embed" -- 'libs/**' 'apps/**'` lists only files under
  `libs/frontend/onboarding/src/lib/ready/`, and `git diff main -- libs/frontend/chat/src/index.ts
  libs/frontend/chat/src/lib/settings/index.ts` is empty.
- Verification seam: chat `lint` and `typecheck` (the new file compiles), onboarding typecheck
  (B1c), and the gates above.
- Files: CREATE `libs/frontend/chat/src/settings-embed.ts`. MODIFY `tsconfig.base.json` (one path,
  after B1's onboarding paths).

### 3. Ready route builder (core)

- Purpose: one builder for the pre-step URLs, used by the B5a Settings row and the onboarding
  pages (RD17).
- Responsibilities: `onboardingReadyTarget`, `parseOnboardingReadyArea`, `parseOnboardingReadyOpen`
  and `ONBOARDING_READY_QUERY` (Contracts).
- Verified contracts and entry points: `OnboardingTarget` (plan §C2, created in B1), exported
  through `C/routing/index.ts`, which B1 extends.
- Dependencies: none.
- Integration points: `AppStateManager.openOnboardingReady()` (B5a), `ReadyClaudeStep` (named
  account link) and `ReadySettingsStep` (`area` parse).
- Failure behaviour: an unknown `area` reads as `providers`; an unknown `open` reads as `null`.
  Neither is thrown or echoed.
- Quality requirements: no string concatenation of URLs.
- Verification seam: `onboarding-routes.spec.ts` covers both stages, both areas, an unknown area,
  `open: 'claude-accounts'` in and out, an unknown `open`, and an empty query when `area` and `open`
  are omitted.
- Files: MODIFY `libs/frontend/core/src/lib/routing/onboarding-routes.ts` (+`.spec.ts`), and
  `C/routing/index.ts` if B1 lists exports by name.

### 4. Flag `ready` slice and guard target (onboarding first-run)

- Purpose: record pre-step progress in the single v1 record, and send first run to stage 1 (spec
  12.D1, 12.L1, 12.L2).
- Responsibilities: the schema with lenient `ready`, merge writes, `markReady`, and the guard target
  rule ("Integration with the base plan's design").
- Verified contracts and entry points: plan §A3/§C3 (B1 files). `VSCodeService.isElectron`
  (`vscode.service.ts:182-184`).
- Dependencies: unchanged (Angular, zod, core). Nothing here may import chat, setup-wizard or
  `O/ready/` (addendum-pr832 `:524-528` rule, extended).
- Integration points: the guard on `chat` (`app.routes.ts`, B1), the tracker, the stages
  (`markReady`) and the strip (`flag().ready`).
- Failure behaviour: a storage read failure means no redirect (B1). A `ready` write failure is
  swallowed and navigation proceeds. A malformed `ready` is dropped on read.
- Quality requirements: the eager `/services` entry adds no import beyond B1's.
- Verification seam:
  - Flag service spec: a v1 record without `ready` is kept unchanged. `ready` is preserved by
    `markDismissed`. `markReady` merges. A malformed `ready` is dropped and the top-level fields are
    kept. An unknown top-level key leaves the record unreadable and makes no redirect. A
    `markReady` write failure does not suppress.
  - Guard spec: eligible with `ready` empty → `/onboarding/ready`. `ready.claudeAt` or
    `ready.skippedAt` → `/onboarding`. VS Code → `true`.
  - Tracker spec: a row for an `/onboarding/ready` arrival commits `shownAt`.
- Files: MODIFY `O/first-run/onboarding-flag.service.ts` (+spec), `O/first-run/onboarding-first-run.guard.ts`
  (+spec), `O/first-run/onboarding-first-run.tracker.spec.ts`.

### 5. `ClaudeReadinessStore` and `deriveClaudeReadiness`

- Purpose: the single derived Claude readiness for the stages, the banner and the strip.
- Responsibilities: derive the state, run mount and Re-check reads, and expose `rechecking`. It
  persists nothing (spec §12.4).
- Verified contracts and entry points: `ProvidersSettingsStateService.cliDetection` and
  `redetectClis()` (`providers-settings-state.service.ts:168-169`, `:836-850`);
  `ClaudeAmbientStatusService.view` and `read(refresh)` (`claude-ambient-status.service.ts:59`,
  `:71-80`); `ProvidersSettingsSection` (`providers-settings-sections.ts:31-41`).
- Dependencies: core only, in the direction onboarding → core.
- Integration points: `ReadyClaudeStep`, `ReadySettingsStep`, `OnboardingHomeComponent`,
  `ClaudeReadinessBanner` and `ReadyStrip`.
- Failure behaviour: both reads never throw. `redetectClis` resolves `false` on failure, and
  `readSection` catches. Failures surface only as `error` with a fixed copy variant, never as host
  text. Stale replies are dropped by the owners (section generation; ambient `seq`). Mount reads
  overlap safely with the embedded providers page's own `read(false)` and with matrix Re-detect,
  because the latest reply wins (R21).
- Quality requirements: no timers, polling or constructor I/O. No RPC when `available` is false.
  Before any RPC, it waits for a settle of at most 30 s per source (the ambient timeout is 30 s; the
  default RPC timeout is 30 s, `claude-rpc.service.ts:23`).
- Verification seam: `deriveClaudeReadiness` table tests with one case per table row, plus
  precedence cases (missing beats error; an installed row with ambient `cli-missing` gives missing;
  a detect error with ambient `connected` gives error; `unknown` without a reason gives error with
  cause `local`; a missing `claude` row gives error). Store spec: `refresh(true)` calls
  `redetectClis` and `read(true)`; `refresh(false)` calls `read(false)`; `available` false makes
  zero calls; `rechecking` is true only during a refresh.
- Files: CREATE `O/ready/claude-readiness.store.ts` (+`.spec.ts`).

### 6. `ReadyClaudeStep` (stage 1, `/onboarding/ready`)

- Purpose: show whether `claude` is installed and signed in, guide the install or sign-in (D10),
  and let the user continue or skip (D11).
- Responsibilities:
  - Top bar: crumb Onboarding / Get ready, then `ReadyStrip` (current 1).
  - h1 "Check Claude Code", focused on entry (plan `OnboardingFocusService`).
  - Status panel: chip, definition list, the state block, and the action row. Copy is verbatim
    from spec §12.2.
  - Install block: an OS tablist with roving tabindex, arrows that wrap, and the default tab taken
    from `config().platform` (`win32` → Windows, otherwise macOS / Linux). Each tab shows one or two
    `CommandCopyRow`s from `CLAUDE_CODE_INSTALL_COMMANDS`, the PATH hint (12.L5) and the docs link
    `CLAUDE_CODE_SETUP_DOCS_URL` (`target="_blank" rel="noopener noreferrer"`).
  - Sign-in block: a `CommandCopyRow` with `CLAUDE_CODE_SIGN_IN_COMMAND`, and the named-account line
    linking to `onboardingReadyTarget('settings', 'providers', 'claude-accounts')`, which opens the
    Claude (Subscription) drawer on its Accounts tab in stage 2 (RD6).
  - Error block: the cause variant and a `<details>` "Install or sign in by hand" with the docs
    link.
  - The line under the panel for non-ready states (D11).
- Actions: in state `ready`, **Continue** calls `markReady('claudeAt')` and goes to
  `/onboarding/ready/settings`. In any other state, including checking (12.D8), **Continue anyway**
  calls `markReady('skippedAt')` and goes to the same place. **Re-check** runs `store.refresh(true)`;
  while it runs, the button is disabled and reads "Checking...", and the panel has `aria-busy`.
  Focus stays on the button. The announcer says "Claude Code is ready", "Claude Code is still not
  installed", "Claude Code is still not signed in" or, for error, "Ptah still could not check
  Claude Code" (RD16).
- Mount: `store.refresh(false)`.
- Verified contracts and entry points: as in components 1, 3, 4 and 5; `VSCodeService.config()`
  (`vscode.service.ts:95`, `platform` at `:25-26`).
- Dependencies: core (store inputs, constants, builder) and the B1 shell services. No chat import.
- Integration points: the guard's first-run target, the Home footer, banner actions and the B5a
  Settings row.
- Failure behaviour: the error state with copy variants. A clipboard failure uses the inline
  fallback. A failed `markReady` write still navigates.
- Quality requirements: spec §12.7. One h1; status region polite; chips never colour alone; 32px
  Copy and list targets; 36px page buttons; `:focus-visible` gold ring; WCAG 2.2 AA pairs as
  measured in §12.7. Spec §12.8: at 400px the commands stack, the definition list is one column
  below 480px, and the action row is a full-width group.
- Verification seam: a page spec with mocked core services. It checks:
  - every state renders its chip, lines, block and actions (checking, ready, missing, signed-out,
    and error for each of the 3 causes);
  - Continue writes `claudeAt` and Continue anyway writes `skippedAt`, each navigating to `settings`;
  - Re-check calls `refresh(true)`, is disabled while it runs, and announces;
  - the default OS tab for `win32`, `darwin`, `linux` and `undefined`;
  - arrow keys wrap the tablist;
  - the docs link has `rel="noopener noreferrer"` and an `https:` href;
  - the signed-out named-account link targets `ready/settings` with `area=providers` and
    `open=claude-accounts`;
  - h1 focus on entry.
- Files: CREATE `O/ready/ready-claude-step.page.ts` (+`.spec.ts`).

### 7. `ReadySettingsStep` (stage 2, `/onboarding/ready/settings`)

- Purpose: let the user connect providers and review CLI tools in the existing settings
  components (spec §12.5, 12.D6).
- Responsibilities:
  - Strip (current 2), then the banner (`placement: 'settings'`).
  - A "Settings area" tablist: Providers and CLI tools. The initial tab comes from
    `parseOnboardingReadyArea(area)`.
  - The Providers tabpanel shows `@defer (on immediate) { <ptah-providers-settings
    [requestedDrawer]="drawerRequest()" /> }`. `drawerRequest` is a page signal seeded once from the
    URL: `{ connection: 'claude-cli', tab: 'accounts' }` (a module constant, stable identity) when
    `area` parses to `providers` and `parseOnboardingReadyOpen(open)` is `'claude-accounts'` (the
    stage-1 named-account link); otherwise `null`. Any tablist change sets it to `null`, so a
    remount of the Providers panel never reopens the drawer. `focusTarget` is not bound.
  - The CLI tabpanel shows `@defer (on immediate) { <ptah-cli-orchestration-matrix /> }`. On mount
    it calls `void state.open()` once per mount (RD5), mirroring `orchestration-settings.component.ts:328-329`.
  - Each defer block has an `aria-busy` placeholder and the Reload-on-error fallback, copied from
    `settings.component.html:164-198`, with `document.defaultView.location.reload()`.
  - `<ptah-settings-toast />` once at the page root.
  - Footer line "More options (voice, search, lane guards) are in Settings after setup."
  - Actions: **Back** goes to `/onboarding/ready`. **Skip for now** calls `markReady('skippedAt')`
    and goes to `/onboarding`. **Continue to setup** calls `markReady('settingsAt')` and goes to
    `/onboarding`.
- Mount: `store.refresh(false)`.
- Route providers: `SettingsSaveFeedbackService` and
  `{ provide: PROVIDER_MODELS_LOADER, useClass: ProvidersModelsLoader }` (RD4). They are scoped to
  this route, so the toast and its timer live exactly as long as the page, the same lifetime as in
  `settings-save-feedback.service.ts:63-64`.
- Verified contracts and entry points: as in Codebase evidence (component selectors, inputs,
  injections, settings defer pattern).
- Dependencies: onboarding → `@ptah-extension/chat/settings-embed`, `@ptah-extension/ui`
  (`PROVIDER_MODELS_LOADER`) and `@ptah-extension/core`. All are allowed by `type:feature` rules.
  The import is static, but the components render only inside `@defer`.
- Integration points: the embedded components keep their own loading, empty, error, drawer and
  modal states (spec §12.5). The matrix's Re-detect writes the same `cliDetection` section, so the
  banner reacts.
- Failure behaviour: a chunk load failure shows the Reload block. Section read failures stay
  inside each component's own retry UI. A failed flag write still navigates.
- Quality requirements: the tablist follows the a11y rules of §12.7, and the tabpanels are focusable
  (`tabindex=0`). The initial bundle is unchanged (gates in component 2). A drawer or modal opened
  inside the embed returns focus to its opener, which is existing behaviour.
- Verification seam: a page spec. Both embedded components are replaced with stubs through
  `TestBed.overrideComponent` and the defer blocks are played through. It checks:
  - the tablist and keyboard behaviour, and `area` parsing (providers, cli, junk);
  - `requestedDrawer` is the Accounts request only with `area=providers&open=claude-accounts`,
    `null` for every other query (including `open` without `area=providers` and a junk `open`),
    and `null` after a tab change;
  - the CLI tab mount calls `state.open()`;
  - the actions write `settingsAt` or `skippedAt` and navigate;
  - the banner shows for missing, signed-out and error and hides for checking and ready;
  - `SettingsSaveFeedbackService` and `PROVIDER_MODELS_LOADER` resolve from the tabpanel's element
    injector. This pins the page-scope contract, R19.

  Real embedding is checked by the harness captures (component 12), including the Claude drawer
  opened on Accounts by the named-account link, and by the Electron visual review, which also opens
  the "Add a Ptah CLI instance" modal.
- Files: CREATE `O/ready/ready-settings-step.page.ts` (+`.spec.ts`).

### 8. `ClaudeReadinessBanner`, `ReadyStrip`, `CommandCopyRow`, `onboardingReadyHostGuard`, `readyStripSettingsWord`

- Purpose: presentational pieces, the Electron-only host guard and the strip-word rule.
- Responsibilities: as in Contracts.
  - Banner copy is verbatim from §12.3. It cannot be dismissed, has a full 1px `--need` border and a
    10% wash, a filled "!" glyph and no side stripe.
  - Strip markers follow §12.6: gold ring for current, filled green with a check for ready or done,
    filled `--need` with "!" for needs attention. The state words are real text. Below 720px the
    non-current items collapse to their markers.
  - `readyStripSettingsWord`: `done` when `settingsAt` is present and not older than `skippedAt`.
    `skipped` only on Home, when `skippedAt` is present and newer than `settingsAt`. Otherwise
    `next` (RD11).
- Verified contracts and entry points: tokens from the spec header (`bg-surface-1`,
  `text-state-need`, and so on). No new token.
- Dependencies: Angular, `RouterLink` and the core builder.
- Integration points: stage 1, stage 2 and Home.
- Failure behaviour: the copy row falls back on a clipboard failure. The host guard redirects to
  Home outside Electron.
- Quality requirements: §12.7 contrast and targets. The reduced-motion rule is the existing global
  one.
- Verification seam: one spec each.
  - Banner: renders for 3 states, has the right action label per placement, links to `/onboarding/ready`.
  - Strip: `aria-current`, the state words, the marker class per state, and the narrow collapse class.
  - Copy row: writes the clipboard, "Copied" lasts 2 s, the timer is released on destroy, there is a
    fallback on rejection, and the aria-label is applied.
  - Host guard: Electron → `true`; otherwise a `UrlTree` to `/onboarding`.
  - `readyStripSettingsWord`: each timestamp ordering, on Home and off Home.
- Files: CREATE under `O/ready/`: `claude-readiness-banner.component.ts`, `ready-strip.component.ts`,
  `command-copy-row.component.ts`, `onboarding-ready-host.guard.ts` and `ready-strip-state.ts`,
  each with a `.spec.ts`.

### 9. Home, routes and shell (B1 files, additive)

- Purpose: put the pre-steps into the approved structure.
- Responsibilities:
  - Routes: the `ready` parent with `canMatch`, `data.crumb` and the two children.
  - Shell: render `data.crumb` as the second crumb when present.
  - Home, Electron only:
    - the strip (current 3, item 1 the live state, item 2 from `readyStripSettingsWord(flag,
      true)`);
    - the banner (`placement: 'home'`) after the lede and before the resume banners;
    - the footer link "Review Claude Code and settings" to `/onboarding/ready`;
    - `store.refresh(false)` on mount.

    In VS Code, none of these render and no read runs.
- Verified contracts and entry points: plan §A2 route table, plan file plan rows for
  `onboarding-shell.component.ts` and `onboarding-home.component.ts`.
- Dependencies: onboarding internal and core.
- Integration points: B5a later wires the resume banners into Home (additive, after B1c).
- Failure behaviour: none new. Store failures appear only as banner state.
- Quality requirements: Home's tiles and status chips are untouched (plan B1 acceptance holds).
- Verification seam:
  - Home spec: in Electron, the strip, banner and footer link are present and the mount refresh
    runs. In VS Code, all three are absent and no refresh runs. The banner sits before the resume
    region.
  - Routes spec (in Home or a new `onboarding.routes.spec.ts`): `ready` and `ready/settings` resolve
    in Electron and redirect to `''` outside it.
- Files: MODIFY `O/onboarding.routes.ts`, `O/shell/onboarding-shell.component.ts` (+spec),
  `O/home/onboarding-home.component.ts` (+spec).

### 10. Settings row "Check Claude Code" and `openOnboardingReady()` (B5a delta)

- Purpose: the approved 12.L4 re-entry to stage 1 from Settings.
- Responsibilities: `AppStateManager.openOnboardingReady(): void`. It is gated by
  `canSwitchViews()` and calls `requestSurface('onboarding', onboardingReadyTarget().subPath)`. It
  sits next to `openMarketplace` and mirrors it (`app-state.service.ts:1157-1160`). The Settings
  row appears next to "Run onboarding again" and only when `isElectron`.
- Verified contracts and entry points: `requestSurface` (`app-state.service.ts:579-596`),
  `canSwitchViews` (`:981`).
- Dependencies: core and chat. Both are already B5a projects.
- Integration points: `CH/settings.component.ts` and `.html` (B5a already adds "Run onboarding
  again").
- Failure behaviour: while disconnected or loading it is a no-op (same as `openMarketplace`).
- Quality requirements: the row is absent in VS Code.
- Verification seam: app-state spec (gated no-op; navigates to `['onboarding','ready']`) and
  settings spec (the row is present only in Electron and calls the method).
- Files: MODIFY (in B5a) `libs/frontend/core/src/lib/services/app-state.service.ts` (+spec),
  `libs/frontend/chat/src/lib/settings/settings.component.ts`, `.html` (+spec).

### 11. `ProvidersSettingsComponent.requestedDrawer` (chat, B1b)

- Purpose: let a host open the Claude (Subscription) drawer on its Accounts tab, the approved §12.2
  destination of the stage-1 named-account link (RD6).
- Responsibilities:
  - Declare `readonly requestedDrawer = input<ProvidersSettingsDrawerRequest | null>(null)` next to
    `focusTarget` (`:583`) and export the request type (Contracts).
  - React with a constructor `effect`, copying the `requestedProviderId` pattern
    (`:1028-1047`): a per-request guard string (`${connection}:${tab}`) reset to `''` when the
    input is `null`; return while the request equals the guard; return while
    `state.connections().status !== 'ready'` (the request waits for the list, and the guard is not
    yet set); then set the guard and, under `untracked`, find the connection with `isClaudeCli`
    (`:602-604`, as `openAccountSignIn` does at `:1225`) and call the existing
    `openDrawer(claude.id, request.tab)` (`:1210-1217`).
  - When `accountsAvailable` is false (not Electron, `:586`), the effect returns without reading
    anything; the Accounts tab does not exist there (D34 comment `:585`).
  - No other behaviour change: no new output, popover, wizard or focus logic. `openDrawer` records
    the opener and the existing close path restores focus as today.
- Verified contracts and entry points: `openDrawer` and `ConnectionDrawerTabId` (Codebase
  evidence), `requestedProviderId` effect (`:1028-1047`), `focusTarget` (`:583`,
  `afterRenderEffect` `:1050-1083`, unchanged), `isClaudeCli` (`:602-604`).
- Dependencies: none new.
- Integration points: `ReadySettingsStep` binds it (component 7); Settings binds nothing, so the
  settings page is unaffected.
- Failure behaviour: no Claude connection in a loaded list → no-op (guard set, same as
  `openAccountSignIn`'s early return). A connections read error → the effect keeps waiting; the
  component's own retry UI applies. Closing the drawer while the same request stays bound does not
  reopen it.
- Quality requirements: the drawer's existing a11y and focus return apply unchanged.
- Verification seam: `CH/providers/providers-settings.component.spec.ts`, in the named-accounts
  suites (`:1055`, Electron `:1148`, inert `:1252`; `claude-cli` fixture `:1097`):
  - in Electron, setting `requestedDrawer` to the Accounts request with connections ready opens the
    drawer for the Claude connection with the Accounts tab selected;
  - set before the connection list is ready, it opens once the list becomes ready, exactly once;
  - closing the drawer while the request stays bound does not reopen it; clearing and setting it
    again does;
  - with the input absent (`null`), no drawer opens and the existing deep-link cases are unchanged;
  - on the inert host, the request opens nothing.
- Files: MODIFY `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts`
  (+`providers-settings.component.spec.ts`).

### 12. Ready-state capture fixtures (e2e harness, B1c)

- Purpose: produce every required screenshot deterministically, in all four themes, from mocked
  RPC replies, independent of whether Claude is installed on the capturing machine (R24).
- Responsibilities:
  - `onboarding-ready.fixtures.ts`:
    - `READINESS_FIXTURES: Record<ReadinessFixtureId, Record<string, unknown>>`, keyed
      `'checking' | 'checking-ambient' | 'ready' | 'missing' | 'signed-out' | 'error-timeout' |
      'error-unreadable' | 'error-local'`. Each entry overrides only `agent:detectClis` and
      `provider:getAmbientClaudeStatus`:

      | Id | `agent:detectClis` | `provider:getAmbientClaudeStatus` |
      | --- | --- | --- |
      | `checking` | key deleted → never answered | key deleted → never answered |
      | `checking-ambient` (stage 2) | `claude` row installed (answered, so the embedded settings regions settle) | key deleted → never answered |
      | `ready` | `{ clis: [{ cli: 'claude', installed: true, path, version }, …] }` | `{ ok: true, status: { state: 'connected', checkedAt } }` |
      | `missing` | `claude` row `installed: false` | `{ ok: true, status: { state: 'unknown', checkedAt, reason: 'cli-missing' } }` |
      | `signed-out` | `claude` row installed | `{ ok: true, status: { state: 'signed-out', checkedAt } }` |
      | `error-timeout` | `claude` row installed | `{ ok: true, status: { state: 'unknown', checkedAt, reason: 'timeout' } }` |
      | `error-unreadable` | `claude` row installed | `{ ok: true, status: { state: 'unknown', checkedAt, reason: 'unreadable' } }` |
      | `error-local` | **function resolver** `() => rpcError('detect failed')` (`marketplace.fixtures.ts:111`) | `connected` |

      The rows map to the derivation table (component 5). `error-local` relies on the precedence
      "a detect error with ambient `connected` gives error". It must be a resolver: the error
      marker is honoured only for resolver returns (`marketplace.fixtures.ts:209-235`), while a
      static value is sent as a successful reply (`:238-242`), which `redetectClis()` would read as
      data with no `clis` (`providers-settings-state.service.ts:836-842`). Its capture asserts the
      local-cause sentence "Ptah could not ask this computer about Claude Code." (Failure behaviour
      table). `checking` and `checking-ambient` rely on the responder never answering an
      unfixtured method (`marketplace.fixtures.ts:238-240`); each capture is taken once the
      "Checking" chip or strip word shows, well inside the 30 s client timeouts.
    - `bootOnboardingReady(page, url, { theme, readiness, flag? })`: `installCspStub`,
      `installPostMessageBridge`, `installHost(page, 'electron', 'chat')`,
      `installRpcAutoResponder(page, { ...baseSettingsFixtures(), ...READINESS_FIXTURES[readiness] })`
      with the deleted keys removed, then `localStorage` seeds for `ptah-theme-v2` and, when given,
      `ptah.onboarding.v1`, then `page.goto` (mirrors `bootSettings`, `settings.fixtures.ts:867-911`).
      With a seeded flag the guard does not fire; Home is entered with
      `bridge.inject({ type: 'switchView', payload: { view: 'onboarding' } })`, as `bootSettings`
      enters Settings (`settings.fixtures.ts:902`).
    - `ONBOARDING_THEMES = ['ptah-glass', 'ptah-glass-light', 'anubis', 'anubis-light'] as const`.
  - `onboarding-ready-capture.ts`: like `settings-capture.ts:19-31`, writing to
    `.ptah/specs/TASK_2026_ONBOARDING/screenshots/ready/<view>-<theme>-<w>x<h>.png`. It parks the
    pointer, disables animations, waits for the theme (A5), and settles every region except the
    readiness panel and the strip, so `checking` (which is `aria-busy` by design) can be captured. It runs
    `@axe-core/playwright` on each capture and writes the violations next to the image.
  - `onboarding-ready-visual.e2e.spec.ts` (`test.use({ useAppBuild: true })`): the capture matrix
    below. Before each capture it asserts the URL and the visible state text (chip, banner action
    or strip word), so a wrong state fails instead of being captured.
- Capture matrix (each × 4 themes):

  | View | Fixtures and path | Captures |
  | --- | --- | --- |
  | Stage 1 in each of the seven stage-1 readiness ids (excluding `checking-ambient`) | no flag → guard → `/onboarding/ready` | 7 × 4 = 28 |
  | Stage 2 Providers with banner | `missing`; stage 1 Continue anyway | 4 |
  | Stage 2 Providers, no banner | `ready`; stage 1 Continue | 4 |
  | Stage 2 CLI tools with banner | `signed-out`; Continue anyway, CLI tools tab | 4 |
  | Stage 2 Claude drawer on Accounts | `signed-out`; stage 1 named-account link | 4 |
  | Stage 2 Providers, `checking`: strip item 1 "Checking", **no banner** | `checking-ambient`; stage 1 Continue anyway (12.D8) | 4 |
  | Stage 2 Providers, `error`: error banner with "Fix Claude Code" | `error-timeout`; stage 1 Continue anyway | 4 |
  | Home banner `missing` / `signed-out` / `error-timeout`, strip "Needs attention" + "Skipped" | flag `{ shownAt, ready: { skippedAt } }` | 3 × 4 = 12 |
  | Home `ready`, strip "Ready" + "Done", no banner | flag `{ shownAt, ready: { claudeAt, settingsAt } }` | 4 |
  | Home `checking`, banner hidden | flag as above, `checking` | 4 |
  | Narrow 400px: stage 1 `missing`, stage 2 Providers | `setViewportSize` (A4) | 2 × 4 = 8 |

  Total: 80 four-theme captures. The same spec also runs the "Visual layer" extras: 2
  reduced-transparency captures (stage 2 Providers `missing`, both glass themes, A7) and the
  30-run contrast sweep (other scenes and accents on the two glass themes, A6).
  Home is reached through `switchView` (re-entry, plan §A3) or the stage-2 actions,
  never by URL strings.
- Verified contracts and entry points: Codebase evidence rows for the harness (bridge, responder,
  `rpcError`, `installHost`, `baseSettingsFixtures`, theme key, capture precedent, axe).
- Dependencies: Playwright and the harness's own helpers only. It imports nothing from
  `@ptah-extension/onboarding`; state text is asserted as literals from spec §12.
- Integration points: run by the coordinator or visual-reviewer as an explicit screenshot step
  (Verification matrix delta), not by `npm run verify`.
- Failure behaviour: any assertion or capture failure fails the run. **If any capture in the matrix
  is unavailable, the visual gate is reported UNMET and B1c does not pass on unit specs alone.**
  There is no "not captured" outcome.
- Quality requirements: deterministic data (fixed `checkedAt`, path, version, `platform: 'win32'`
  from the host config); axe reports per capture; no wall-clock waits.
- Verification seam: `npm run verify` typechecks the fixture and capture files
  (`tsconfig.lib.json` excludes the `.e2e.spec.ts`); the capture run is the behavioural check.
- Files: CREATE under `libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/`:
  `onboarding-ready.fixtures.ts`, `onboarding-ready-capture.ts`,
  `onboarding-ready-visual.e2e.spec.ts`.

## Integration architecture

- Data flow:
  1. Boot to chat in Electron with no `shownAt` → the guard reads `flag().ready` →
     `UrlTree('/onboarding/ready')` → the lazy onboarding chunk loads → `onboardingReadyHostGuard`
     → `ReadyClaudeStep`.
  2. The tracker commits `shownAt` on the `NavigationEnd` whose first segment is `onboarding`.
  3. Stage-1 mount → `store.refresh(false)` → `redetectClis()` (`agent:detectClis`, then the
     orchestration, CLI-agent and CLI-model rereads) and `ambient.read(false)`
     (`provider:getAmbientClaudeStatus`) in parallel → the root signals update → `view()`
     recomputes.
  4. Continue or Continue anyway → `markReady` → `ready/settings` → the deferred embeds render →
     `ptah-providers-settings.ngOnInit` → `state.open()` and its own `ambient.read(false)`.
  5. Continue to setup or Skip → `markReady` → Home → the mount refresh → the banner.
  6. Signed-out named-account link → `ready/settings?area=providers&open=claude-accounts` → stage 2
     seeds `drawerRequest` → `ptah-providers-settings[requestedDrawer]` → once `connections()` is
     ready, `openDrawer(claudeConnection.id, 'accounts')` → Accounts tab (`provider:listAccounts`,
     existing).
- State or persistence:
  - Persisted: only `ptah.onboarding.v1.ready.*` timestamps, owned by `OnboardingFlagService`.
  - Live state stays in the existing root services (settings state, ambient status). The store
    keeps only `rechecking`.
  - Page-scoped services live on the `ready/settings` route.
- External boundaries:
  - Host replies are validated by their owners. The ambient reply passes through `isAmbientStatus`
    (`claude-ambient-status.service.ts:115-124`). Detection goes through `requireRpcData`, which
    throws a fixed message (`providers-settings-sections.ts:118-130`).
  - The `area` and `open` queries are validated with allow-lists.
  - The docs URL is a constant `https:` URL that Electron opens externally after
    `isSafeExternalUrl`.
  - Clipboard writes only constant strings.
- Failure and rollback:
  - Every failure falls into the `error` state, the Reload block, or each embed's own retry. No step
    blocks progress (D11).
  - Flag write failures never block navigation.
  - Rollback is to revert B1c, then B1b. B1's guard then targets `/onboarding` again, and a record
    that has `ready` stays readable with the lenient parse (if B1c is kept) or reads as unreadable
    (if it is not), which means no redirect.
- Observability: the existing `[ClaudeAmbientStatusService]` "degradation-audit" comment path and
  the host's `RPC: agent:detectClis` debug logs (`agent-rpc.handlers.ts:1017`, `:1023`). No new
  logging, and no host text reaches the UI.

## VS Code and TUI behaviour

- VS Code webview (`isElectron` false):
  - The first-run guard returns `true`, as in B1.
  - `onboardingReadyHostGuard` redirects `/onboarding/ready*` to Home.
  - Home renders no strip, no banner and no footer link.
  - `ClaudeReadinessStore.available` is false and it makes no RPC. `ClaudeAmbientStatusService` is
    inert anyway (`:52-55`).
  - The B5a Settings row is hidden.
  - The only visible change is the Credentials tab copy: `claude` replaces `claude login`. It is the
    same shared component (spec 12.D4).
- VS Code host and Electron main: no change.
- TUI and CLI: no change. They keep their own `claude login` strings
  (`apps/ptah-cli/src/cli/commands/init.ts:204`, `:483`, `:503`;
  `apps/ptah-tui/src/components/settings/AuthSection.tsx`). This is out of scope under
  Electron-first (R23).

## Architecture-level quality requirements

- Functional: each §12.2 state renders the exact §12.2 copy. Continue anyway is available in every
  non-ready state. Re-check is detect plus `read(true)`. The banner shows only on stage 2 and Home,
  only for missing, signed-out and error, and clears as soon as the derived state is `ready`. First
  run lands on `/onboarding/ready` exactly once. Re-entry lands on Home.
- Performance:
  - The initial webview bundle does not change (component 2 gates; the chat barrel diff is empty).
  - The two embeds load only on stage 2, through `@defer`.
  - There are no timers except the 2 s "Copied" reset, which is released on destroy and on a new
    copy.
- Security:
  - No host error text is rendered.
  - Only constant commands are copied.
  - The external link has an `https:` href and `noopener noreferrer`.
  - The query allow-list is enforced.
- Maintainability:
  - Onboarding's eager `/services` graph gains no import of chat, setup-wizard or `O/ready/`. Gate:
    `git grep -n "@ptah-extension/chat\|@ptah-extension/setup-wizard\|/ready/" -- libs/frontend/onboarding/src/services.ts libs/frontend/onboarding/src/lib/first-run`
    returns nothing.
  - The command strings exist only in the constant module. Gate:
    `git grep -n "claude login\|@anthropic-ai/claude-code" -- 'libs/frontend/**/*.ts' ':!*.spec.ts'`
    returns only `claude-code-commands.ts`.
- Testability: every derivation row, every stage action and flag write, every default-tab rule, the
  page-scope DI contract, and both host modes (Electron and VS Code) are covered by unit specs. The
  real embed is covered by the Electron visual review.

## Visual layer (design-spec §13)

The user approved §13 and its 66 `prototype/screenshots/v2-*` captures as the visual target
(`context.md:63-65`; `design-spec.md:504-630`). §13 is visual only: copy, state logic, routing and
flags stay as written above (`design-spec.md:506`). Where §13 and this addendum disagree on
visuals, §13 wins, except where source contradicts it (icon registration, below).

- **Themes** (`design-spec.md` §13.1; verified `C/services/theme.service.ts:100-104`, all four in
  `EAGER_THEMES` `:185`):

  | Label | Theme id | `data-glass` / `data-glass-mode` |
  | --- | --- | --- |
  | Glass dark (default, `theme.service.ts:219`) | `ptah-glass` | `on` / `dark` |
  | Glass light | `ptah-glass-light` | `on` / `light` |
  | Plain dark | `anubis` | absent |
  | Plain light | `anubis-light` | absent |

  Stock `dark` and `light` are not the product pair (13.D1). Every screenshot requirement in this
  addendum means exactly these four ids.
- **Scope.** Every UI batch implements §13 for the surfaces it creates or changes:
  - B1c: stage 1, stage 2 wrapper, `ClaudeReadinessBanner`, `ReadyStrip`, `CommandCopyRow`, Home
    strip and banner;
  - B1b: none visual beyond the Credentials copy;
  - B2–B5b: their own surfaces, per §13, for the base plan's screens (stepper, Home cards, Analyze,
    New project, team builder, resume strip, dock).

  The embedded `ptah-providers-settings` and `ptah-cli-orchestration-matrix` stay unchanged apart
  from the `requestedDrawer` input (RD6). Glass reaches them only through the wrapping tabpanel and
  the theme tokens they already use. Never edit them for glass.
- **Icons** (§13.2; every file below verified in `node_modules/lucide-angular/icons/`). All icons are
  decorative: `aria-hidden="true"`, not focusable, always next to a text label (13.D3). No
  icon-only buttons.

  | B1c surface | Lucide names |
  | --- | --- |
  | `ReadyStrip` items 1 / 2 / 3 | `terminal`, `plug-zap`, `route`; state badge (17px, stroke 3) `check` (ready/done), `triangle-alert` (needs action), `loader` (checking) |
  | Page title tile (44px, 38px below 480px) | stage 1 `terminal`; stage 2 `plug-zap` |
  | Stage-1 status chip (1.1em) | `loader` Checking; `circle-check` Ready; `download` Not installed; `log-in` Not signed in; `circle-alert` Could not check |
  | `ClaudeReadinessBanner` | `triangle-alert`; action `download` (missing), `log-in` (signed out), `refresh-cw` (error); stage-2 "Fix Claude Code" `terminal` |
  | Buttons | Re-check `refresh-cw`; `CommandCopyRow` Copy `copy` → `check` after copy; docs link `external-link` |

  B2–B5b take their names from the same §13.2 table (Home cards `scan-search` / `folder-plus` /
  `users`, `arrow-right`, resume `loader` / `play`, chips, section glyphs).
  Registration: §13.2 says icons "register through the app's existing Lucide provider". Source has
  none (no `LucideAngularModule.pick`, `provideLucide` or `LUCIDE_ICONS` under `libs/` or `apps/`).
  Resolution: source wins on mechanism. Each component imports `LucideAngularModule` and the
  PascalCase exports it uses and binds them through `[img]`, as `CH/settings.component.html:189-193`
  and `cli-orchestration-matrix.component.ts:1138-1146` do. The rendered glyphs are the §13 names,
  so the visual target is unchanged. The icons are tree-shaken into the onboarding lazy chunk.
- **Provider marks** (§13.2 "Provider icons and fallback", 13.D2). Reuse the vendored components in
  `libs/frontend/ui`; vendor, hand-draw or add no logo, and add no `.svg` file:
  - `ptah-provider-mark` (`libs/frontend/ui/src/lib/native/provider-mark/provider-mark.component.ts:67`;
    inputs `providerId`, `fallback`, `size` at `:103-110`);
  - `ptah-brand-mark` (`libs/frontend/ui/src/lib/native/brand-mark/brand-mark.component.ts:105`,
    `size="md"`: 32px tile per §13.2) and its fallback `ptah-monogram-tile`
    (`brand-mark/monogram-tile.component.ts:112`, `label` required `:122`);
  - imported from `@ptah-extension/ui` (precedent `libs/frontend/marketplace/src/lib/ui/target-marks.component.ts:7-12`,
    `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-cost-summary.component.ts:2`)
    or the narrow `@ptah-extension/ui/brand-mark` entry (`tsconfig.base.json:250`). The ui barrels
    must stay pure `export *` lists (`libs/frontend/ui/src/index.ts:29-33`).
  B1c renders no provider row of its own (stage 2 embeds settings, which already draw marks), so the
  first users are the base batches that list providers or CLIs. Nominative use only (§13.2 licensing
  rules).
- **Glass recipe** (§13.3, 13.D4). Onboarding adds no CSS token, class or component for glass; it
  only sets `data-glass-surface` on its own elements, and `styles.css` section 2 supplies the recipe
  (roles documented at `apps/ptah-extension-webview/src/styles.css:2585-2588`; precedent
  `canvas-lane-view.component.ts:148`):

  | Surface role | B1c elements | Recipe (per §13.3) |
  | --- | --- | --- |
  | `chrome` | top bar, current strip item pill, `ClaudeReadinessBanner` (adds a 70% state-colour border) | `--glass-fill`, `--glass-blur` 16px, `--glass-line`, `--glass-edge-top`, `--glass-shadow` |
  | `content` | status panel, stage-2 tabpanel frame, command box | stable fill, no blur (`styles.css:2936`), `--glass-fill-raised`, `--glass-line`, `--glass-shadow` |
  | `tile` | title icon tile, chips, `CommandCopyRow` rows | `--glass-fill-tile`, no blur (`:2943`), `--glass-line-strong`, inset `--glass-glint` on icon tiles |
  | `overlay` | none in B1c (base-plan reply dock only) | `--glass-fill-overlay`, `--glass-blur-overlay` 22px |

  Plain themes have no `data-glass`, so every `--glass-*` rule is dormant and the same markup
  renders on `--b1..b3` with 1px borders and no blur. Text never relies on `backdrop-filter` for
  legibility.
- **Fallbacks** (§13.4), inherited with no onboarding rule:
  - `prefers-reduced-transparency: reduce` and `prefers-contrast: more` make every fill opaque,
    remove the filter, hide the scene and raise borders (`styles.css:2716-2745`);
  - `forced-colors: active` maps every `[data-glass-surface]` to `Canvas` / `CanvasText` with a 1px
    border (`styles.css:2757-2770`); icons keep `forced-color-adjust: auto`;
  - `prefers-reduced-motion: reduce` stops the `loader` spin while the "Checking" text stays
    (`styles.css:2775-2781`).

  The B1c capture matrix adds one reduced-transparency capture per glass theme (stage 2 Providers
  `missing`, with `prefers-reduced-transparency: reduce` emulated through CDP
  `Emulation.setEmulatedMedia`; Assumption A7), matching
  the approved `v2-providers-missing-reduced-transparency-glass-*` specimen: 2 captures, counted in
  the visual gate but not in the four-theme total.
- **Contrast.** §13.5 measured the default `aurora` scene and `gold` accent only (13.D5): 0 failures
  in all four themes. The user scoped the rest to the implementation visual gate
  (`context.md:69-70`). B1c's gate therefore adds a contrast sweep in the harness: three views
  (stage 1 `missing`, stage 2 Providers with banner, Home with banner) × the two glass themes × the
  other scenes `ember`, `tide`, `horizon` (gold) and the accents `rose`, `moonstone` (aurora) =
  30 axe `color-contrast` runs with captures. Scene and accent are seeded through their hint keys
  `ptah-scene` and `ptah-accent` (`theme.service.ts:72-73`, `:90-91`; Assumption A6). Criterion:
  WCAG 2.2 AA (4.5:1 text, 3:1 large text and glyphs), including the `--need`/state-ink banner over
  glass. A violation is a finding to fix; the gate stays unmet while one is open.
- **Screenshots.** Every UI batch captures each required view in the four theme ids above, with axe
  per state and theme. For B1c the matrix, fixtures and step are component 12 and the Verification
  matrix delta.

## Batch placement

New order (strictly serial, as in plan "Batches"): **B1 → B1b → B1c → B2 → B3a → B3b → B4a → B4b →
B5a → B5b**.

Why this placement:

- After B1: B1c edits five B1 artefacts: the flag service, guard, routes, shell and Home. B1b's
  route builder extends B1's `onboarding-routes.ts`, and B1b's tsconfig path follows B1's paths.
  B1b and B1c therefore cannot start before B1.
- Before B2: nothing in B1b or B1c needs B2. `ReadyStrip` is standalone (RD8). Putting the pre-steps
  before B2 has three benefits:
  1. Every later batch, and the B5b e2e spec, is written against the final first-run target
     (`/onboarding/ready`), not a temporary one.
  2. The Home template reaches its final layout (strip, banner, footer link) before B5a adds the
     resume banners, so B5a rebases additively.
  3. The flows behind the three cards (B3a–B4b) never depend on readiness. D11 forbids blocking
     them, so delaying the pre-steps until after them would buy nothing.
- Naming: "B0b" would suggest a batch before B1, but both new batches need B1. They are named B1b
  and B1c.
- Why two batches: B1b touches `core`, `chat` and `tsconfig.base.json` and has no onboarding file.
  B1c touches only `onboarding`, webview specs and the new harness capture fixtures (component 12,
  owned by B1c). The split keeps each verification row narrow and lets B1b's settings changes (the
  copy alignment, 12.L6, and the `requestedDrawer` input, RD6) be reviewed on their own, outside the
  onboarding lib.

### B1b — Claude Code commands constant, settings alignment, embed entry, ready route builder

- Files:
  - CREATE `libs/frontend/core/src/lib/services/claude-code-commands.ts` (+spec) and
    `libs/frontend/chat/src/settings-embed.ts`.
  - MODIFY `libs/frontend/core/src/lib/services/index.ts`,
    `libs/frontend/core/src/lib/services/providers-connection-setup.service.ts`,
    `libs/frontend/core/src/lib/routing/onboarding-routes.ts` (+spec),
    `libs/frontend/core/src/lib/routing/index.ts` (only if B1 exports by name),
    `libs/frontend/chat/src/lib/settings/providers/connection-drawer/credentials-tab.component.ts`
    (+spec), `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts`
    (+`providers-settings.component.spec.ts`; `requestedDrawer`, component 11) and
    `tsconfig.base.json` (one path).
- File-disjointness: disjoint from every batch except `onboarding-routes.ts` and `routing/index.ts`
  (B1 creates them, B5a's `core` index edit removes `generationRouteBinding`) and `tsconfig.base.json`
  (B1). `providers-settings.component.ts` is in no other batch. Order: after B1, before B5a. Each
  edit is additive.
- Executor: frontend-developer.
- Acceptance:
  - The constant holds the 4 install rows, sign-in `claude` and the docs URL, matching spec §12.2
    verbatim.
  - The credentials tab shows and copies `claude` and the unchanged npm command. Its testids and
    `id`s are unchanged.
  - The core setup message uses the constants.
  - `onboardingReadyTarget`, `parseOnboardingReadyArea` and `parseOnboardingReadyOpen` behave as in
    Contracts.
  - `requestedDrawer` opens the Claude drawer on Accounts through `openDrawer`, and with the input
    absent the component behaves exactly as before (component 11). It is the only API change to the
    component.
  - The chat barrels are unchanged, and `settings-embed` has no importer yet.
  - The "Maintainability" command-string grep shows only the constant module.
- Specs to write or update: `claude-code-commands.spec.ts` (new); `credentials-tab.component.spec.ts`
  (`:346-357` asserts the constants); `onboarding-routes.spec.ts` (ready builder cases, including
  `open`); `providers-settings.component.spec.ts` (the `requestedDrawer` cases of component 11).
- Verify (each header must read "for N projects", with N equal to the list length):
  - (F) `npm run verify -- -p @ptah-extension/core,@ptah-extension/chat,ptah-extension-webview`
  - (L) `npm run verify -- -t lint,typecheck -p ptah-electron`
- Screenshots: Electron, Settings → Providers → Claude (Subscription) drawer → Credentials, in the
  four theme ids `ptah-glass`, `ptah-glass-light`, `anubis` and `anubis-light` (4). They show `claude` and the
  npm command. The view holds static strings, so a live capture is deterministic. The
  `requestedDrawer` path is captured in B1c (component 12, "Stage 2 Claude drawer on Accounts"),
  where onboarding first binds it. A missing capture reports the gate UNMET.

### B1c — Get ready pre-steps (stages, store, banner, strip, flag slice, guard target)

- Files:
  - CREATE under `libs/frontend/onboarding/src/lib/ready/`: `claude-readiness.store.ts`,
    `ready-claude-step.page.ts`, `ready-settings-step.page.ts`, `claude-readiness-banner.component.ts`,
    `ready-strip.component.ts`, `command-copy-row.component.ts`, `onboarding-ready-host.guard.ts` and
    `ready-strip-state.ts`, each with a `.spec.ts`.
  - MODIFY `O/first-run/onboarding-flag.service.ts` (+spec), `O/first-run/onboarding-first-run.guard.ts`
    (+spec), `O/first-run/onboarding-first-run.tracker.spec.ts`, `O/onboarding.routes.ts`,
    `O/shell/onboarding-shell.component.ts` (+spec) and `O/home/onboarding-home.component.ts` (+spec).
  - CREATE under `libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/`:
    `onboarding-ready.fixtures.ts`, `onboarding-ready-capture.ts` and
    `onboarding-ready-visual.e2e.spec.ts` (component 12). B1c owns these fixtures.
  - MODIFY `apps/ptah-extension-webview/src/app/webview-routing.spec.ts` and `app.spec.ts`, where
    the first-run expectation becomes `/onboarding/ready`, plus a case for `ready.claudeAt` →
    `/onboarding`. Also the `initial-navigation` spec, if B1 created one, with a case for a restored
    `/chat` that settles on `/onboarding/ready`.
- File-disjointness: the `ready/` files and the harness `scenarios/onboarding/` files are new and
  owned only by B1c. The B1 files listed above are
  edited later by B3a, B3b and B4b (`onboarding.routes.ts`, + their routes) and by B5a
  (`onboarding-home.component.ts` resume wiring; `webview-routing.spec.ts` legacy cases). Order:
  after B1b, before B2. Later edits are additive (ownership delta below).
- Executor: frontend-developer.
- Acceptance, per §12 state (Electron, with mocked core services in specs):
  - **checking**: "Checking" chip with a pulsing dot, skeleton bars (`sr` "Checking"), left text
    "Checking your computer...", and only "Continue anyway". The panel has `aria-busy`.
  - **ready**: "Ready" chip, path and version in mono, "Yes. Your Claude account is connected.",
    and **Continue** (primary). It writes `ready.claudeAt` and goes to `/onboarding/ready/settings`.
  - **missing**: "Not installed" chip and its three lines. The install block shows the OS tablist
    with the default from `platform` and 4 commands across 3 tabs, each with a working Copy, the
    "Copied" state for 2 s and the "Command copied" announcement. It shows the PATH hint and the
    docs link. Actions are **Re-check** and "Continue anyway". The D11 line is under the panel.
  - **signed-out**: "Not signed in" chip, path, version, "No. Sign in to use Claude Code.", and a
    sign-in block with the `claude` command row. The named-account link goes to
    `/onboarding/ready/settings?area=providers&open=claude-accounts`, where the Claude
    (Subscription) drawer opens on its Accounts tab (`requestedDrawer`, RD6). Actions are
    **Re-check** and "Continue anyway".
  - **error**: "Could not check" chip, the cause variant sentence (timeout, unreadable or local),
    and the block "Ptah could not read Claude Code" with `<details>` "Install or sign in by hand"
    and the docs link. Actions are **Re-check** and "Continue anyway".
  - **Continue anyway**, in every non-ready state including checking: writes `ready.skippedAt` and
    goes to `/onboarding/ready/settings`.
  - **Re-check** = `redetectClis()` plus `ClaudeAmbientStatusService.read(true)`. The button is
    disabled and reads "Checking..." while it runs. Focus stays on it. The result is announced.
  - **Stage 2**:
    - the Providers and CLI tools tabs embed the real components (unchanged apart from
      `requestedDrawer`), inside `@defer` with a placeholder and a Reload fallback, plus the toast;
    - the named-account request opens the Accounts drawer once; a tab change clears it;
    - Skip for now writes `skippedAt` and goes to Home; Continue to setup writes `settingsAt` and
      goes to Home; Back goes to stage 1;
    - the banner shows for missing, signed-out and error, with the action "Fix Claude Code".
  - **Home**:
    - the strip comes before the h1, and the banner (actions "Install Claude Code", "Sign in" or
      "Check again") comes before the resume region;
    - the footer link "Review Claude Code and settings" is present;
    - the banner clears without a flag write once a re-read returns `ready`.
  - **Guard**: first run with an empty `ready` goes to `/onboarding/ready`, and `shownAt` is written
    once on arrival. With `claudeAt` or `skippedAt` it goes to `/onboarding`. A second boot goes to
    chat.
  - **VS Code**: `/onboarding/ready*` lands on Home. Home has no strip, banner or link. There are
    zero `agent:detectClis` and `provider:getAmbientClaudeStatus` calls from onboarding.
  - **Budget gates**: the component 2 grep (only `O/ready/` imports `settings-embed`) and the
    Maintainability `/services` grep both pass. Both embeds sit inside `@defer`.
- Specs to write: every new `.spec.ts` listed under Files, plus the updated B1 specs. Cases are as in
  each component's Verification seam. The harness visual spec is component 12.
- Verify:
  - (F) `npm run verify -- -p @ptah-extension/onboarding,ptah-extension-webview,@ptah-extension/webview-e2e-harness`
    (the harness has only `typecheck` among the verify targets, `project.json:7-25`)
  - (L) `npm run verify -- -t lint,typecheck -p ptah-electron`
- Screenshots (visual gate), from the harness fixtures of component 12: every view in its capture
  matrix, in the four themes plain dark (`anubis`), plain light (`anubis-light`), glass dark
  (`ptah-glass`) and glass light (`ptah-glass-light`), with the Electron host config. That is 80
  captures: stage 1 in all seven readiness states (checking, ready, missing, signed-out and the
  three error causes), stage 2 in checking (strip, no banner), ready (no banner), missing,
  signed-out and error (banner), both tabs, the Claude drawer on Accounts,
  Home in each banner and strip state, and the two 400px views. Axe runs on every capture (spec
  §12.7 implementation gate). The same run adds the "Visual layer" extras: 2 reduced-transparency
  captures and the 30-run contrast sweep over the other scenes and accents. The §13 icons and glass
  surface roles must be visible in the glass captures and fall back cleanly in the plain ones; the
  visual-reviewer compares them with the approved `v2-*` captures.
  - The coordinator or visual-reviewer runs the capture as an explicit screenshot step (Verification
    matrix delta). It is not part of `npm run verify`.
  - The Electron visual review still opens the real embed live (drawer, "Add a Ptah CLI instance"
    modal, R19) and records R21 and R25.
  - **No waivers.** If any capture is unavailable, the visual gate is reported UNMET, and B1c does
    not pass on unit specs alone.

### Changed base batches

- **All UI batches (B1, B1c, B2, B3a, B3b, B4b, B5a)**: implement §13 for their own surfaces
  ("Visual layer"). Their screenshot sets are captured in the four theme ids `ptah-glass`,
  `ptah-glass-light`, `anubis` and `anubis-light`. No verification command changes: the styling
  lives in the same projects.
- **B2**: no change in content. `OnboardingStepper` stays as in the plan, plus §13. `ReadyStrip`
  does not depend on it.
- **B3a, B3b, B4b**: no change in content. `onboarding.routes.ts` now already contains `ready`. Their
  route additions go before `**`, next to it.
- **B5a**:
  - Adds component 10: `openOnboardingReady()` in `app-state.service.ts` (+spec), and the Settings row
    "Check Claude Code" in `settings.component.ts`/`.html` (+spec).
  - The Home resume wiring keeps the B1c order: Claude banner, then resume banners.
  - Acceptance adds two items: Settings "Check Claude Code" opens `/onboarding/ready` in Electron and
    is absent in VS Code; "Run onboarding again" still opens Home.
  - The verification row is unchanged, since core and chat are already in B5a (F).
- **B5b**: `apps/ptah-electron-e2e/src/specs/onboarding/onboarding.spec.ts` asserts that a
  first-run redirect lands on `/onboarding/ready`, that stage 1 Continue anyway → stage 2 Skip for
  now reaches Home, and that the menu re-entry lands on Home. It is authored only; running it needs
  the user's permission. The verification row is unchanged (`ptah-electron-e2e` lint and typecheck
  are already listed).

## Shared-file ownership table delta

| File | B1 | B1b | B1c | B2 | B3a | B3b | B4a | B4b | B5a | B5b |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `libs/frontend/onboarding/src/lib/onboarding.routes.ts` | create | — | + `ready` parent, 2 children | — | + analyze | + analyze/*, guidance | — | + new-project, team-builder | — | — |
| `libs/frontend/onboarding/src/lib/home/onboarding-home.component.ts` (+spec) | create | — | + strip, banner, footer link, mount refresh | — | — | — | — | — | wire resume banners (after the Claude banner) | — |
| `libs/frontend/onboarding/src/lib/first-run/onboarding-flag.service.ts`, `onboarding-first-run.guard.ts` (+specs), `onboarding-first-run.tracker.spec.ts` | create | — | `ready` slice; target rule; ready row | — | — | — | — | — | — | — |
| `libs/frontend/onboarding/src/lib/shell/onboarding-shell.component.ts` (+spec) | create | — | + `data.crumb` | — | — | — | — | — | — | — |
| `libs/frontend/core/src/lib/routing/onboarding-routes.ts` (+spec) | create | + ready builder | — | — | — | — | — | — | — | — |
| `libs/frontend/core/src/lib/routing/index.ts` | + exports | + ready exports (if named) | — | — | — | — | — | — | adjust | — |
| `tsconfig.base.json` | + onboarding paths | + `chat/settings-embed` | — | — | — | — | — | — | — | — |
| `libs/frontend/core/src/lib/services/app-state.service.ts` (+spec) | — | — | — | — | — | — | — | — | + `openOnboardingReady()` (with the plan's rename) | — |
| `libs/frontend/chat/src/lib/settings/settings.component.ts`/`.html` | — | — | — | — | — | — | — | — | + "Run onboarding again", + "Check Claude Code" | — |
| `apps/ptah-extension-webview/src/app/webview-routing.spec.ts`, `app.spec.ts` | + guard cases | — | first-run target → `/onboarding/ready` | — | — | — | — | — | legacy cases | — |
| `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts` (+spec) | — | + `requestedDrawer` input (RD6) | — | — | — | — | — | — | — | — |
| `libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/*` (fixtures, capture helper, visual spec) | — | — | create (component 12) | — | — | — | — | — | — | — |

## Import audit delta (the executor confirms each with `ptah_code_search_symbols` before writing)

- B1b: `ProvidersSettingsComponent`, `CliOrchestrationMatrixComponent`, `SettingsSaveFeedbackService`,
  `ProvidersModelsLoader` and `SettingsToastComponent` exist at the paths in Contracts, and they
  are re-exported **in B1b**. `ProvidersSettingsDrawerRequest` is created in B1b in
  `providers-settings.component.ts` and re-exported as a type. Inside that file, `input`, `effect`
  and `untracked` are already imported, and `openDrawer`, `isClaudeCli` and `accountsAvailable` are
  members (`:1210`, `:602`, `:586`). `OnboardingTarget` exists (B1).
- B1c: from `@ptah-extension/core`: `ProvidersSettingsStateService`, `ClaudeAmbientStatusService`,
  `type ClaudeAmbientStatusView`, `VSCodeService`, the `CLAUDE_CODE_*` constants,
  `onboardingReadyTarget`, `parseOnboardingReadyArea` and `parseOnboardingReadyOpen` (B1b).
  - `ProvidersSettingsSection` is the section type. Confirm it is exported from core; if it is not,
    type the store input structurally (`{ status; data }`) and do not add a core export in B1c.
  - `CliDetectionResult` comes from `@ptah-extension/shared`.
  - `PROVIDER_MODELS_LOADER` comes from `@ptah-extension/ui`.
  - The five embed values and the `ProvidersSettingsDrawerRequest` type come from
    `@ptah-extension/chat/settings-embed` (B1b).
- B1c harness files: `installHost`, `installRpcAutoResponder`, `rpcError`
  (`scenarios/marketplace/marketplace.fixtures.ts:73`, `:129`, `:111`), `baseSettingsFixtures`
  (`scenarios/settings/settings.fixtures.ts:830`), `installPostMessageBridge`
  (`postmessage-bridge.ts:58`), `installCspStub` (`csp-stub.ts`), `test`/`expect`
  (`test-fixtures.ts:61`, `:89`), `AxeBuilder` from `@axe-core/playwright`. No import from any
  `@ptah-extension/*` app lib.
- B5a: `onboardingReadyTarget` (B1b).

## Verification matrix delta

The method, (F)/(L) split and exclusions are as in plan "Verification matrix". Confirm that each
header reads "Running target(s) … for N projects".

| Batch | Changed projects | Dependents added | (F) command | (L) command | Single host specs |
| --- | --- | --- | --- | --- | --- |
| B1b | core (constant, setup message, route builder), chat (credentials tab, `requestedDrawer` input, new entry file), root `tsconfig.base.json` | core: additive export plus one string, so its frontend dependents compile through the webview typecheck (same reasoning as plan B1). chat: internal change, one additive optional input, plus a new entry; the barrel is unchanged, so its importers (canvas, command-center, harness-builder, mcp-apps-page, setup-wizard, tribunal-panel) see no API change. webview → electron (implicit, `apps/ptah-electron/project.json:7`) | `npm run verify -- -p @ptah-extension/core,@ptah-extension/chat,ptah-extension-webview` | `npm run verify -- -t lint,typecheck -p ptah-electron` | — |
| B1c | onboarding, webview (specs), webview-e2e-harness (capture fixtures) | → webview → electron; the harness has no dependents | `npm run verify -- -p @ptah-extension/onboarding,ptah-extension-webview,@ptah-extension/webview-e2e-harness` | `npm run verify -- -t lint,typecheck -p ptah-electron` | — |
| B5a | unchanged (core and chat already listed) | unchanged | unchanged | unchanged | unchanged |
| B5b | unchanged | unchanged | unchanged | unchanged | unchanged |

Exclusions for B1b and B1c:

- `ptah-extension-vscode` and `ptah-cli`: neither imports `@ptah-extension/core`,
  `@ptah-extension/chat` or the onboarding lib (`apps/ptah-extension-vscode/project.json:7` is
  implicit on `rpc-handlers` only). The shared webview is covered by `ptah-extension-webview`.
- `ptah-tui`: no Angular surface.
- `ptah-electron-e2e` and `ptah-video-studio`: no file edited here.
- `@ptah-extension/webview-e2e-harness` in B1b: its assertions (`settings-reachability.table.ts:1551-1556`)
  depend on the npm string and the testid, which are both unchanged. It is not re-run. In B1c it is a
  changed project and is in the (F) command, where only its `typecheck` target applies.

Screenshot step (B1c visual gate; not a verify row). The user allowed a webview build plus the
`webview-e2e-harness` e2e capture for screenshot steps only, under `node scripts/verify.mjs
--exec`, never inside `npm run verify`, and no other build, serve or e2e use (`context.md:66-68`).
The coordinator or visual-reviewer runs, in order, from the worktree root:

1. `node scripts/verify.mjs --exec --task onboarding-ready-webview-build -- npx nx run ptah-extension-webview:build`
   → `dist/apps/ptah-extension-webview` (`apps/ptah-extension-webview/project.json` build
   `outputPath`), which `useAppBuild` serves (`fixture-server.ts:154-163`).
2. `node scripts/verify.mjs --exec --task onboarding-ready-captures -- npx nx run @ptah-extension/webview-e2e-harness:e2e --skip-nx-cache -- onboarding-ready-visual`
   → the harness `e2e` target (`project.json:14-25`: `nx:run-commands`, `cwd`
   `libs/frontend/webview-e2e-harness`, `npx playwright test --config=playwright.config.ts`).
   The trailing `onboarding-ready-visual` is forwarded to `playwright test` as its file filter.
   Check: the list reporter shows only `onboarding-ready-visual.e2e.spec.ts` tests; if any other
   spec runs, stop and report the forwarding failure instead of capturing.

Artifacts: the PNGs and axe JSON go to
`.ptah/specs/TASK_2026_ONBOARDING/screenshots/ready/` (resolved from the capture helper's own file
location, like `settings-capture.ts:19`, so independent of `cwd`); Playwright's failure output goes
to `libs/frontend/webview-e2e-harness/test-results/` (default under the target `cwd`). Chromium
must be installed (`playwright.config.ts:12-14`). If the build or the capture cannot run, the
visual gate is reported UNMET. It is never waived.

If a pre-push hook or CI flags any of these projects, add it to the (L) command of the batch at
fault.

## Failure behaviour (additions)

| Situation | Behaviour |
| --- | --- |
| `agent:detectClis` fails or times out (30 s) | `cliDetection` → `error` → state `error`, cause `local` ("Ptah could not ask this computer about Claude Code."), unless ambient says `cli-missing` (→ missing) |
| Ambient read times out on the host (`unknown/timeout`) or locally (`localFailure`) | `error` with cause `timeout` or `local`. It is never `signed-out` (12.D7) |
| Detection succeeded but has no `claude` row | `error`, cause `local` (RD10) |
| Workspace switch during onboarding | The section view shows `unloaded` → `checking` until the next mount refresh, or until the matrix and providers re-read. Nothing stale is shown as current |
| The embedded chunk fails to load | Reload block (`location.reload()`), the same as Settings |
| Clipboard denied | Inline "Select the text and copy it." The command text stays selectable |
| Flag write fails (`markReady`) | Navigation proceeds and the strip may show "Next". There is no suppression and no loop |
| Malformed `ready` in storage | Dropped on read. The top-level fields are kept |
| Non-Electron host reaches `/onboarding/ready*` | Redirected to Home by `onboardingReadyHostGuard` |
| A late reply after a newer Re-check | Dropped by the owning services (section generation, ambient `seq`) |

## Host impact (additions)

| Host | Reference | Change | Smallest change to keep compiling and working |
| --- | --- | --- | --- |
| Electron renderer | onboarding `ready/*`, Home, guard target | New stages, banner and strip | B1c |
| Electron and VS Code renderers (shared settings) | `credentials-tab.component.ts:91-93`, `:105`, `:134`, `:412`; `providers-connection-setup.service.ts:255` | Sign-in copy `claude login` → `claude` (12.D4, 12.L6) | B1b. Testids unchanged |
| VS Code webview | `onboardingReadyHostGuard`; Home Electron gating | None visible except the Credentials copy | — |
| Electron main, VS Code host, backend RPC | — | None | — |
| TUI, CLI | `apps/ptah-tui`, `apps/ptah-cli` | None (they keep `claude login`) | — (R23) |

## Risks (new)

| # | Risk | Likelihood / impact | Mitigation |
| --- | --- | --- | --- |
| R19 | A future page-scoped injectable under `CH/` breaks the stage-2 embed at runtime (`NullInjectorError` when a drawer or modal opens), while typecheck stays green | Low / Medium | The `settings-embed.ts` header states the contract. The B1c spec resolves both providers from the tabpanel injector. The visual review opens the drawer and the add-instance modal |
| R20 | Every Home and stage mount re-runs a sequential, cache-busting detection of all CLIs plus three settings re-reads. Home shows "Checking" (banner hidden) for seconds | Medium / Low | Spec-mandated, so the banner is never stale (§12.3). The host deduplicates concurrent detects (`cli-detection.service.ts:111-116`). Continue anyway is always available (12.D8). If measured cost is high, a follow-up could re-read only when the section is older than N seconds (needs a user decision) |
| R21 | The embedded providers page calls `ambient.read(false)` on mount and on drawer close (`providers-settings.component.ts:1089`, `:1240-1241`). The shared view goes to `checking`, so the banner and strip blink | Medium / Low | Accepted: latest-wins semantics keep the result correct. The visual review records whether the blink is visible. If it is, a follow-up could have the banner hold its last verdict while `checking` (copy and behaviour change, needs approval) |
| R22 | The initial-bundle budget regresses if `settings-embed` is imported eagerly | Low / High | The B1b and B1c grep gates, an unchanged chat barrel, and the `/services` grep. The CI build enforces the 4 MB error budget |
| R23 | The TUI and CLI still say `claude login` while settings and onboarding say `claude` | Certain / Low | Out of scope (Electron first). Listed for a follow-up task |
| R24 | The `missing`, `signed-out`, `error` and `checking` screenshots cannot be produced on a machine where Claude is ready | Medium / Medium | Removed as a machine dependency: every state comes from the mocked-RPC fixtures of component 12 (B1c), in all four themes, with axe per capture. A3 and A4 are harness assertions, not launch overrides. **No waivers:** if any capture is unavailable, the visual gate is reported UNMET and B1c does not pass on unit specs alone |
| R25 | The embedded components' root `h-full overflow-y-auto` (`providers-settings.component.ts`, template root) creates nested scrolling inside the onboarding page | Medium / Low | Visual review at default size and at 400px. Any fix stays in the onboarding tabpanel CSS (no styling change to the component) |
| R27 | The §13 visuals (icons, glass surface tags) drift from the approved `v2-*` captures during B1c | Low / Low | §13 is approved (`context.md:63-65`), so B1c builds with it from the start ("Visual layer"). The 80 harness captures are compared with the `v2-*` set by the visual-reviewer. Visual-only rework stays inside the `O/ready/` files |
| R28 | Glass surfaces drop text or the state-ink banner contrast below AA on scenes or accents §13.5 did not measure (`ember`, `tide`, `horizon`; `rose`, `moonstone`) | Medium / Medium | §13.5 measured `aurora`/`gold` with 0 failures. The B1c contrast sweep (30 axe runs, "Visual layer") covers the rest at the implementation visual gate (`context.md:69-70`). The reduced-transparency fallback is opaque. `ptah-glass` is the default theme (`theme.service.ts:219`), so this is the most-seen rendering |
| R26 | Plan R5 (a first-run user without credentials) changes: stage 2 now offers Providers before Home | — / positive | Recorded. Plan L10's candidate hint becomes unnecessary for Electron |

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| RD1 | Two new batches B1b and B1c, after B1 and before B2 | (a) chosen; (b) one batch "B0b"; (c) after B2, with the strip as a stepper mode | B1c edits five B1 artefacts. Nothing needs B2. Later batches and e2e should see the final guard target. The split keeps core and chat verification apart from onboarding | Yes |
| RD2 | The command constant lives in `@ptah-extension/core` (`C/services/claude-code-commands.ts`) | (a) core; (b) `@ptah-extension/shared` (forces all host checks; no non-webview consumer is in scope); (c) chat (onboarding would import chat's main barrel for a string) | All three consumers (core `:255`, chat credentials tab, onboarding) may depend on core under the `type:*` rules. Core is already a dependency of each | Yes |
| RD3 | The settings components reach onboarding through a new narrow entry `@ptah-extension/chat/settings-embed` | (a) chosen; (b) export from the chat barrel; (c) copy the components | `CH/index.ts:1-7` forbids barrel growth for bundle reasons. The `chat/inspector` precedent (`tsconfig.base.json:46-48`). User hard rule: reuse unchanged | Yes |
| RD4 | `ReadySettingsStep`'s route provides `SettingsSaveFeedbackService` and `PROVIDER_MODELS_LOADER` → `ProvidersModelsLoader`, and the page renders `<ptah-settings-toast />` | (a) chosen; (b) provide them at root (changes their documented page lifetime); (c) a `provideSettingsPageScope()` helper (one consumer, and SettingsComponent would stay unchanged anyway) | `settings.component.ts:110-113`; these are the only two `@Injectable()` under `CH/` | Yes |
| RD5 | The CLI tabpanel calls `ProvidersSettingsStateService.open()` when it mounts | (a) chosen; (b) the page calls `open()` once (it duplicates providers' own `open()` when Providers is first) | The matrix has no init (`cli-orchestration-matrix.component.ts:1137-1200`). Its settings host calls `open()` (`orchestration-settings.component.ts:328-329`) | Yes |
| RD6 | (b) Add a minimal public input, `requestedDrawer: ProvidersSettingsDrawerRequest \| null` (`{ connection: 'claude-cli'; tab: 'accounts' }`), to `ProvidersSettingsComponent` in B1b. Stage 2 binds it from `?area=providers&open=claude-accounts`, and it opens the Claude (Subscription) drawer on Accounts through the existing `openDrawer`. Approved by the orchestrator (`context.md:56-58`): the approved §12.2 destination wins over reuse-unchanged | (a) focus Connections with `focusTarget` (rejected: does not open the approved drawer, review r0 finding 1); (b) chosen; (c) `{ providerId: string; tab: ConnectionDrawerTabId }` (rejected: onboarding would hard-code a connection id the component itself never relies on, `connection-kind.ts:4-8`, and the API would cover every drawer and tab with one consumer) | `design-spec.md:397` (drawer on Accounts), `:439` ("no new inputs", the sentence that changes); `openAccountSignIn` is protected (`:1219-1235`); `openDrawer(providerId, tab)` (`:1210`); deep-link effect pattern (`:1028-1047`). The input is the only API change to a reused settings component | Yes |
| RD7 | The stage-2 query key is `area`, not `tab` | (a) `area`; (b) `tab`, as in §12.4 | Spec §1.1 and plan §C2 reserve `tab` for the validated hidden session binding. Both positions are recorded. §12.4's key is the artifact that changes | Yes |
| RD8 | `ReadyStrip` is its own presentational component | (a) chosen; (b) a strip mode on `OnboardingStepper` (B2), which would force B1c after B2 and mix link and non-link semantics | Spec §2: completed steps are links. §12.6: strip items are not links. The spec name and visual rules are kept | Yes |
| RD9 | Every mount (stage 1, stage 2, Home) runs `redetectClis()` plus `read(false)`. Re-check runs `redetectClis()` plus `read(true)` | (a) chosen; (b) mount uses cached `agent:getConfig.detectedClis` | §12.3: "re-read (`read(false)` plus detect) each time Home or stage 2 mounts". 12.D9: entry uses the cached ambient read | Yes |
| RD10 | No `claude` row in a successful detect, or `unknown` without a `reason`, derives `error` (cause `local`) | (a) error; (b) missing | The contract makes `reason` optional (`provider-account.types.ts:289-293`). A missing row is not evidence of absence. 12.D7: never guess a negative | Yes |
| RD11 | Strip item 2 shows "Done" when `settingsAt` is present and not older than `skippedAt`. It shows "Skipped" only on Home, when `skippedAt` is newer. Otherwise it shows "Next" | (a) chosen; (b) "Skipped" whenever `skippedAt` exists (shows "Skipped" on stage 2 after stage-1 Continue anyway) | Spec §12.4 shares one `skippedAt` between both stages (12.D1 shape is approved), so the word needs a rule | Yes |
| RD12 | `ready` is parsed leniently and on its own. Writes merge. A `markReady` failure is swallowed without suppression | (a) chosen; (b) a strict `ready` (one bad field would make the record unreadable and lose `shownAt` semantics) | Plan §A3 storage rules. `ready` does not affect eligibility | Yes |
| RD13 | `ready` routes `canMatch` only in Electron, otherwise redirect to Home | (a) chosen; (b) render a "not available" screen | §12.2: "Host `inert` (not Electron): the stage is not shown at all". The same `isElectron` source as the first-run guard | Yes |
| RD14 | The 12.L4 Settings row uses a new gated `AppStateManager.openOnboardingReady()` in B5a | (a) chosen; (b) the row calls `SurfaceRouterService.navigateToSurface` directly (bypasses readiness gating and workspace settlement) | Precedent `openMarketplace` (`app-state.service.ts:1157-1160`, `requestSurface` `:579-596`). Settings and app-state are already B5a files | Yes |
| RD15 | The core setup-dialog message (`providers-connection-setup.service.ts:255`) is also built from the constant | (a) chosen; (b) leave it (settings would then show `claude login` in one place and `claude` in another) | 12.D4's purpose is "cannot drift". Same lib as the constant | Yes |
| RD16 | The Re-check announcement for `error` is "Ptah still could not check Claude Code" | (a) chosen; (b) silence | §12.2 lists announcements for ready, missing and signed-out only. §12.7 requires the finished result to be announced | Yes (copy) |
| RD17 | Ready URLs come from `onboardingReadyTarget` in core `onboarding-routes.ts`, not from a child list in `webview-surface.types.ts` | (a) chosen; (b) add a child-path registry to the shared surface types | The shared registry has no child structure (`S/webview-surface.types.ts:44-150`). Plan §C2 owns onboarding URL builders. There are three consumers (B5a row, stage 1 link, stage 2 parse) | Yes |
| RD18 | Screenshot states come from mocked-RPC fixtures in `libs/frontend/webview-e2e-harness` (component 12), owned by B1c; a missing capture makes the visual gate UNMET | (a) chosen; (b) stage states on the capturing machine (PATH, `CLAUDE_CONFIG_DIR`) with a "not captured" fallback (rejected: review r0 finding 2 and `context.md:59`, no waivers); (c) unit specs as evidence (rejected: they cannot show glass contrast, icons or layout) | Responder, `rpcError` and unanswered-method behaviour (`marketplace.fixtures.ts:111`, `:129-160`, `:238-240`); Electron host config (`:35-51`); settings fixtures (`settings.fixtures.ts:830`); theme key (`theme.service.ts:200`) | Yes |

## Lane-introduced constraints

These go beyond spec §12, the user decisions and the base plan. Each is reversible and listed for
the reviewer.

| # | Constraint | Why |
| --- | --- | --- |
| L-R1 | New narrow entry `@ptah-extension/chat/settings-embed` (5 value re-exports plus 1 type), imported only under `O/ready/` | RD3. Budget |
| L-R2 | `ReadySettingsStep` route-scoped providers plus the toast | RD4. Page-scope contract |
| L-R3 | One additive input, `requestedDrawer`, on `ProvidersSettingsComponent`, plus the `open` query key, so the named-account link opens the approved Accounts drawer | RD6. Approved §12.2 destination wins (`context.md:56-58`) |
| L-R4 | Query key `area` | RD7 |
| L-R5 | The `ReadyStrip` word rule for item 2 | RD11 |
| L-R6 | The core setup message is aligned to the constant | RD15. Extends 12.L6 by one string in the same lib |
| L-R7 | Error Re-check announcement copy | RD16 |
| L-R8 | `AppStateManager.openOnboardingReady()` | RD14. Implements 12.L4 |
| L-R10 | Four-theme screenshot sets (`ptah-glass`, `ptah-glass-light`, `anubis`, `anubis-light`) for every UI batch; icons imported per component through `[img]` (source has no Lucide provider, unlike §13.2's wording); the contrast sweep and reduced-transparency captures in B1c | User instruction (`context.md:51-54`), approved §13 (`context.md:63-65`), contrast scope (`context.md:69-70`) |
| L-R11 | 80 harness captures (component 12) with axe per capture; the capture run is an explicit coordinator step | RD18. No waivers (`context.md:59`) |
| L-R9 | Grep gates for `settings-embed` importers, the onboarding `/services` graph and the command strings | Budget and drift guards that are checkable without a build |

## Team-leader handoff

- Recommended executors: frontend-developer for B1b and B1c. Both are Angular webview code with no
  backend logic. B1c also authors the harness capture fixtures (component 12). After B1c, the
  coordinator or visual-reviewer runs the explicit capture step (80 captures across the four
  themes, axe per capture) and a live Electron review of the embed; a second review runs after
  B5b's e2e is authored if the user permits running it.
- Complexity: MEDIUM. There is no new contract with the host. The risk sits in the page-scope DI
  of the embed, in bundle hygiene, and in the exact state derivation. All three have unit seams and
  grep gates.
- Dependencies and ordering: B1 → B1b → B1c → B2. B1c imports B1b's constant, builder and embed
  entry. B5a's delta needs B1b's builder.
- Parallel-safe work: none. The base plan keeps batches strictly serial, and B1b and B1c share
  `onboarding-routes.ts` consumers and the `tsconfig.base.json` ordering.
- Files affected:
  - CREATE: `libs/frontend/core/src/lib/services/claude-code-commands.ts` (+spec);
    `libs/frontend/chat/src/settings-embed.ts`; under `libs/frontend/onboarding/src/lib/ready/`:
    `claude-readiness.store.ts`, `ready-claude-step.page.ts`, `ready-settings-step.page.ts`,
    `claude-readiness-banner.component.ts`, `ready-strip.component.ts`,
    `command-copy-row.component.ts`, `onboarding-ready-host.guard.ts` and `ready-strip-state.ts`
    (each +spec); under `libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/`:
    `onboarding-ready.fixtures.ts`, `onboarding-ready-capture.ts` and
    `onboarding-ready-visual.e2e.spec.ts` (B1c).
  - MODIFY:
    - core: `libs/frontend/core/src/lib/services/index.ts`,
      `libs/frontend/core/src/lib/services/providers-connection-setup.service.ts`,
      `libs/frontend/core/src/lib/routing/onboarding-routes.ts` (+spec),
      `libs/frontend/core/src/lib/routing/index.ts` (conditional) and
      `libs/frontend/core/src/lib/services/app-state.service.ts` (+spec, B5a).
    - chat: `libs/frontend/chat/src/lib/settings/providers/connection-drawer/credentials-tab.component.ts`
      (+spec), `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts`
      (+spec, `requestedDrawer`, B1b) and `libs/frontend/chat/src/lib/settings/settings.component.ts`/`.html` (+spec, B5a).
    - root: `tsconfig.base.json`.
    - onboarding (B1 files): `first-run/onboarding-flag.service.ts` (+spec),
      `first-run/onboarding-first-run.guard.ts` (+spec), `first-run/onboarding-first-run.tracker.spec.ts`,
      `onboarding.routes.ts`, `shell/onboarding-shell.component.ts` (+spec) and
      `home/onboarding-home.component.ts` (+spec).
    - webview app: `apps/ptah-extension-webview/src/app/webview-routing.spec.ts`, `app.spec.ts` and
      the initial-navigation spec (if present).
    - e2e: `apps/ptah-electron-e2e/src/specs/onboarding/onboarding.spec.ts` (B5b, authored).
  - REWRITE: none.
- Verification points:
  - The two new matrix rows, with header counts checked.
  - The grep gates: the `settings-embed` importers, the onboarding `/services` and `first-run`
    graph, the command strings, and an empty chat barrel diff.
  - `credentials-tab.component.spec.ts:346-357` updated.
  - The derivation table tests (one case per row plus the precedence cases).
  - VS Code-mode specs show zero readiness RPCs.
  - Screenshots in plain dark and light and glass dark and light: 4 for B1b (live Electron) and 80
    for B1c (harness mocked-RPC fixtures, Electron host config), with axe per capture. Any missing
    capture reports the visual gate UNMET; B1c does not pass on unit specs alone.
  - `providers-settings.component.spec.ts` covers `requestedDrawer` (opens Accounts; absent input
    changes nothing), and the B1c stage-2 spec covers the request binding and its clearing.
  - The B1c (F) header lists 3 projects, including `@ptah-extension/webview-e2e-harness`.
  - The §13 icons, provider-mark reuse and glass surface roles are applied, with the plain-theme,
    reduced-transparency and forced-colors fallbacks checked, and the contrast sweep clean
    ("Visual layer").
  - No `build`, `serve`, `e2e` or `package` target is run locally (CLAUDE.md).
