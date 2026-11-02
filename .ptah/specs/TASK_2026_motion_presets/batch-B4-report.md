# Batch B4 — Marketplace motion

## Changed files

- `shell/marketplace-motion-key.ts` and `.spec.ts`: pending-target page/source key and ordered index; one G1 switch.
- `shell/marketplace-shell.component.ts`, `.html`, `.spec.ts`: route stage around the page outlet and early direction check.
- `pages/overview/overview-page.component.ts`, `pages/servers/{server-source-host,installed-servers-page}.component.ts`, `pages/skills/{skill-source-host,installed-skills-page}.component.ts`, `pages/connectors/connectors-page.component.ts`: routed page host motion entries.
- `pages/servers/{provider-list-view,server-detail}.component.{ts,html}` and their specs: nested detail stages, docked/drawer close hooks, and server tab panels.
- `pages/connectors/{connectors-page,connector-detail}.component.{ts,html}` and the connectors page spec: nested stages, full-page branch panels, drawer close hook, and detail host motion.
- `pages/skills/{installed-skills-page,skill-detail}.component.ts` and installed-skills-page spec: nested stages, close hooks, and detail host motion.

## Design notes

- Every Marketplace outlet has a route stage as its direct parent. The shell uses the pending target URL; detail stages use the pending child parameter under the list route. Page/source order supplies forward or back direction before activation.
- Each routed page and detail host declares `ptah-motion-panel`, `animate.enter`, and `animate.leave`. Connector list/full-page branches and the three server tab bodies have their own panels. The drawer header stays outside each detail stage.
- The existing B2 stage and B1 preset classes govern motion and reduced-motion behavior. No transport or store behavior changed.
- Follow-up padding audit: the shell and all six detail route stages have no padding. Padding stays on routed page/detail panel wrappers. The shell spec stubs now put `p-6` on their panel hosts, and check that the stage has no `p-6`.

## G1 flag

- `MARKETPLACE_LEAVE_CLONE` in `libs/frontend/marketplace/src/lib/shell/marketplace-motion-key.ts` is the single B4 switch passed to all seven route stages as `[motionLeaveClone]`.
- Default: `false`, as the plan recommends before G1 is known. Set it to `true` only if the Electron G1 check shows a routed host leave does not stay visible. This lane cannot run Electron, so G1 remains open.

## Detail-to-list exit

- Docked inspector and drawer hosts in the provider, connector, and skill views declare `animate.leave="ptah-motion-leave"`. The connector drawer now leaves the `@if` block on detail→list so the leave hook runs.
- A visible drawer exit still needs the B1 CSS rule below: NativeDrawer uses a `display: contents` host and a top-layer popover, so animation on the host alone cannot move its visible panel. The inspector is glass-bearing and the current B1 glass selector cuts its exit in every theme. The close hooks are implemented; visual closure is **not verified**.

## Needs from B1

- Add a scoped preset exit rule for the native drawer's visible `.ptah-drawer-panel` when its owning `ptah-native-drawer.ptah-motion-leave` host leaves; keep the popover backdrop and panel visible until the exit completes. The host has `display: contents`, so the existing global `.ptah-motion-leave` rule does not animate the panel.
- Scope the inspector glass cut selector to `:root[data-glass='on']`. The current `:has([data-glass-surface], [class*='backdrop-blur'])` cuts the docked inspector in all scenes because the descendant attribute is always present. In an active glass scene, keep the user-approved cut exit and transform-only entrance. Animate the drawer **panel** only; its blurred backdrop is a separate sibling and must keep glass-safe behavior.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use one Marketplace constant to pass `motionLeaveClone` to seven stages, default false. | Per-stage flags or true before G1. | Plan component 3b and G1; B2 input defaults false. | Yes. |
| Use the core route's documented page/source order for the pending key. | Read settled shell signal. | Plan component 5; shell signal changes at `NavigationEnd`. | Yes. |
| Add close hooks to the owning templates and request the visible popover CSS from B1. | Edit `NativeDrawerComponent` outside B4 scope. | Drawer host is `display: contents`; task limits edits to Marketplace and reserves styles.css for B1. | Yes. |
| Keep stage layout and strengthen the routed shell test. | Move padding from a stage. | The audited Marketplace stages have no padding; the leaving panel uses `position: absolute; inset: 0`. | Yes. |

## Verification

- Focused `npm run verify -- -t test -p @ptah-extension/marketplace -- --testPathPatterns="marketplace-shell|marketplace-motion-key|provider-list-view|connectors-page|installed-skills-page|server-detail"`: **NX 1 task: 1 succeeded**; duration 30.6s, cache 0/1. The first run failed only in the new key spec because a direct `RouterStateSnapshot` constructor needs router internals; fixed and rerun passed.
- Full `npm run verify -- -p @ptah-extension/marketplace`: **NX 3 tasks: 3 succeeded** (lint, test, typecheck); duration 2m 48s, cache 0/3.
- `ptah_get_diagnostics` was called on five edited TypeScript files. Its TypeScript check exceeded 45 seconds and returned them unchecked; the required full verify will supply the typecheck result.
- No live render check: this lane cannot start Electron, build, serve, or run e2e under the task rules. The named `angular-frontend-patterns` skill could not be loaded because this host lists no skill-loading tool or catalogue. Repository guidance and the approved plan were used.
- Follow-up test checks one panel after each real shell route switch and checks back and forward directions at `ActivationEnd`. Its `ptah_get_diagnostics` call also exceeded 45 seconds and returned the changed spec unchecked.
- Follow-up focused `npm run verify -- -t test -p @ptah-extension/marketplace -- --testPathPatterns="marketplace-shell|marketplace-motion-key|provider-list-view|connectors-page|installed-skills-page|server-detail"`: **NX 1 task: 1 succeeded**; duration 39.1s, cache 0/1.
- Follow-up full `npm run verify -- -p @ptah-extension/marketplace`: **NX 3 tasks: 3 succeeded** (lint, test, typecheck); duration 1m 49s, cache 0/3.

## Revise round 1

### Defect fixes

1. **Inspector exit size.** `apps/ptah-extension-webview/src/styles.css` now puts `position: absolute`, `inset: 0`, and `z-index: 1` only on `.ptah-motion-stage > .ptah-motion-leave`. The global leave animation stays in place. This keeps docked inspector hosts in normal layout when they close (`pages/servers/provider-list-view.component.html:133`, `pages/skills/installed-skills-page.component.ts:398`). The CSS contract spec checks both selectors.
2. **Skills list height.** `shell/marketplace-shell.component.html:105` gives the shell stage a fixed `h-full` and a flex column with `min-h-0`. The installed skills host at `pages/skills/installed-skills-page.component.ts:120` can now resolve its `h-full`, so its inner `overflow-y-auto` list can scroll. Other Marketplace hosts remain normal flex items in the same scroller.
3. **First-render motion.** `pages/connectors/connectors-page.component.ts` and `.html:1-24` gate list/detail branch entry until after the first render. `pages/servers/server-detail.component.ts` and `.html:251,310,399` gate tab entry until the user switches tabs. The routed host still handles the first entry.
4. **Connector branch overlap.** `pages/connectors/connectors-page.component.html:1` puts both full-page and list branches directly under a local `ptahMotionStage`. The stage owns direction and the leaving branch is positioned within it.
5. **Route behavior tests.** `shell/marketplace-motion-key.ts` defines an injectable `MARKETPLACE_LEAVE_CLONE` token and one `MARKETPLACE_LEAVE_CLONE_DEFAULT` value, provided by `shell/marketplace-shell.component.ts`. Default is `false`; change only that default after Electron G1 if needed. Shell tests now cover one replay on a detail parameter change, list return cleanup, rapid navigation, the clone path with true, and exact direction readings.
6. **Source list drift.** `shell/marketplace-motion-key.spec.ts` reads the core route source arrays and checks every parsed source has the expected motion index. The production lists remain local because core is outside this batch.
7. **Glass drawer exit.** `apps/ptah-extension-webview/src/styles.css` cuts the visible drawer panel exit under `:root[data-glass='on']`; other themes keep the panel exit animation. `apps/ptah-extension-webview/src/app/motion-presets.spec.ts` asserts both rules.

### Stage-child audit

`MotionStageDirective` adds `ptah-motion-stage` to its host; `MotionRouteStageDirective` uses it as a host directive. I checked all `ptah-motion-leave` uses under `libs/frontend` before changing the selector.

- **Direct stage children:** Marketplace shell page hosts; Marketplace routed detail hosts in provider, connector and skill stages; connector list and full-page branches in the new local stage; Marketplace server tab panels after the wrapper change; Settings main tab panels and output-style preview/editor panels; provider wizard step panels and credential-mode panels; Thoth tab panels; route leave clones appended by `MotionRouteStageDirective`.
- **Outside stages by design:** Marketplace docked inspector and native drawer hosts in provider, connector and skill pages. They keep the leave animation in normal flow. The native drawer panel has its own exit rule.
- **Nested under stage but not direct:** Settings connection drawer tab panels (`libs/frontend/chat/src/lib/settings/providers/connection-detail-drawer.component.ts:86-122`) and voice drawer tab panels (`libs/frontend/chat/src/lib/settings/ptah-ai/voice-details-drawer.component.ts:62-74`) sit inside a `[data-tab-body]` wrapper projected into `NativeTabGroup`'s stage. They now leave in normal flow; they do not receive absolute positioning. This is outside B4 edit scope and needs the Settings lane to review the tab swap visually. The Marketplace server detail had the same shape; this revision removed its wrapper and put `pt-3` on each panel (`pages/servers/server-detail.component.html:248-556`).

The two earlier “Needs from B1” CSS items are present in this worktree now. This revision adds the glass-only drawer cut and stage-child positioning. The nested Settings tab panels remain an unmet direct-child condition outside B4 scope; I have listed them so the coordinator can ask the Settings lane to make the panels direct stage children if an overlap is required.

### Verification

- Marketplace test `npm run verify -- -t test -p @ptah-extension/marketplace`: first run **NX 1 task failed** (2 new test assumptions); corrected the reused-route fixture and clone completion assertion. Rerun **NX 1 task: 1 succeeded**, duration 1m 54s, cache 0/1. The first run had 70 passing suites and 1 failing suite; the rerun passed.
- Marketplace and webview full verify `npm run verify -- -p @ptah-extension/marketplace,ptah-extension-webview`: first run **NX 6 tasks: 5 succeeded, 1 cached, 1 failed**, duration 2m 56s. The only failure was `ptah-extension-webview:test`, where `no-alpha-base-content.spec.ts` found `text-base-content/70` in `libs/frontend/chat-ui/src/lib/atoms/motion-style-picker.component.ts:70`, a B8 file outside this lane. I sent the finding to the B8 agent. After that class was removed, the rerun passed: **NX 6 tasks: 6 succeeded**, duration 4m 54s, cache 0/6.
- Visual check: Electron cannot run under this lane's rules; no live Marketplace screenshot was available. The design reference was the approved motion plan and its G1 requirement.
- Skill discovery: the CLI reported no `angular-frontend-patterns` skill, so I used the repository guidance and existing motion directives.

## Revise round 2

### Root causes

- **D3:** The wide full-detail branch and its routed `ptah-connector-detail` host both declared `ptahMotionEnter`. The nested transforms and opacity multiplied on card open; both also declared leave motion.
- **D8:** Marketplace pages share the shell's `main` scroll container. Route changes replaced the page panel without resetting `main.scrollTop`, so the next page inherited the previous page's offset.

### Changes

- `libs/frontend/marketplace/src/lib/pages/connectors/connector-detail.component.ts:93-98`: removed routed-host enter and leave hooks while retaining its panel class for route-stage replay.
- `libs/frontend/marketplace/src/lib/pages/connectors/connectors-page.component.html:4-7,292-305`: the wide branch owns its entrance and exit; the compact/regular drawer's route-stage body owns the connector entrance, gated after first render. The drawer host keeps its exit animation. Each card-open path now configures one `ptahMotionEnter` target.
- `libs/frontend/marketplace/src/lib/pages/connectors/connectors-page.component.spec.ts:515-537`: compact and wide navigation specs assert the single configured entrance target and the routed detail placement. Angular/Jest does not expose the native CSS animation frame, so this is a template-level motion assertion plus real routing.
- `libs/frontend/marketplace/src/lib/shell/marketplace-shell.component.ts:201-230`: on a page or source change, offset any direct leaving panel by the negative scroll amount, then reset `main.scrollTop` to zero. Detail and query-only navigation retain the current offset.
- `libs/frontend/marketplace/src/lib/shell/marketplace-shell.component.spec.ts:256-275`: asserts the entering page starts at zero, a leaving panel keeps its prior viewport offset, and detail navigation preserves scroll.

## Decisions

- Keep `MARKETPLACE_LEAVE_CLONE_DEFAULT = false`; Electron gate G1 already passed. Wide detail exit remains on the branch and drawer exit remains on the drawer host.
- Reset scroll only for Marketplace page/source changes. Reposition the leaving panel before resetting the shared scroller so its leave remains anchored, matching the N4 review evidence.

## Verification

- Required command: `npm run verify -- -p @ptah-extension/marketplace`. Final exact Nx summary: `NX   3 tasks: 3 succeeded` (lint, test, typecheck; exit 0). The first run failed on a Jest animation-observation assumption and an un-narrowed route union; both were corrected before the passing rerun.
- Ptah diagnostics timed out after 45 seconds; the passing Nx typecheck covered the changed Marketplace TypeScript and Angular template.
- I inspected the existing Electron N1 open and N4 leave screenshots against the requested single entrance and stable leaving-page position. I could not render a fresh Electron result or inspect a post-change screenshot: this lane forbids build, serve and e2e targets, and the available Electron bundle predates these edits. Runtime animation timing and the exact leave position therefore still need a fresh visual check.

