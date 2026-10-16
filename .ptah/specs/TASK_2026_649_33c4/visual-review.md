# Visual Review - TASK_2026_649_33c4

**Verdict: CHANGES REQUIRED** (template assessment: REJECTED, 5/10, because one visual-breaking
functional defect was reproduced five times).

## Summary

| Metric | Value |
| ------ | ----- |
| Overall score | 5/10 |
| Assessment | CHANGES REQUIRED (REJECTED under the template, one visual-breaking issue) |
| Visual breaking | 1 |
| Serious | 2 |
| Moderate | 5 |
| Minor | 7 |
| Viewports tested | 1280x800, 1280x600, 1280x480, 700x600, 432x760, 400x760 (emulated via `page.setViewportSize`, see Environment) |
| Screenshots taken | 78 (kept) in `visual/` |
| Components tested | Setup Hub home, builder page (header, embedded chat, sidebar, peek bar and sheet), leave dialog, Hub intake modal, Hub conflict confirm |

## Environment

- Build verified: the running Electron app is the dev build of this worktree
  (renderer URL `file:///D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/dist/apps/ptah-electron/renderer/index.html`).
  It was driven through CDP `http://127.0.0.1:9333` with Playwright `connectOverCDP`.
  Nothing was built, started or closed. I did not diff the bundle against the source tree. The code
  paths I quote (`harness-builder-view.component.ts`, `harness-builder-leave-dialog.component.ts`)
  match the rendered DOM exactly (the `inert` attribute bindings and the dialog's own inert loop
  are both visible in the DOM), so the bundle is the code under review.
- Scripts live in `D:\tmp\ptah-649-visual\scripts` (outside the repo). Screenshots:
  `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\.ptah\specs\TASK_2026_649_33c4\visual\`.
- Viewport: Electron `Browser.getWindowForTarget` is not supported, so sizes were set with
  Playwright's viewport emulation (reset on disconnect; verified back to 892x735 at the end). The
  sizes are an audit selection (docked wide, short window, narrow sheet), not a support contract.
  The spec's 720 px breakpoint is a host-width rule; the app shell keeps a `min-w-[400px]` content
  region next to a 32 px workspace rail, so a "400 px host" is a 432 px viewport. I recorded 400 px
  as well (screenshots `90/91/92-light-narrow400-*`); at 400 the shell itself clips the header's
  Back button by 20 px, which is a shell limit, not a builder defect.
- Safety: the throwaway workspace `D:\tmp\ptah-649-visual\ws` was registered with the app's
  `workspace:registerFolder` RPC (the native Add Folder dialog cannot be driven over CDP) and
  selected from the Workspaces rail. All builder runs and the one Apply ran there. At the end I
  discarded my builder sessions, switched the active workspace back to `ptah-final-run-ws`,
  removed the `ws` entry from the rail (the folder on disk remains), and restored the dark theme
  `anubis` (the starting theme). The window is back at 892x735.
- Side effects of Apply (disclosed, not reverted): Apply wrote 5 files, three of them user-level,
  not only into the workspace: `C:\Users\abdal\.ptah\harnesses\tiny-ts-web.json` (a new saved preset,
  the Hub now says "4 saved"), `C:\Users\abdal\.ptah\plugins\ptah-harness-ts-web-conventions\`,
  and `C:\Users\abdal\.ptah\settings.json` (`harness.lastApplied: "tiny-ts-web"`,
  `harness.lastAppliedAt`). The workspace got `ws\.claude\CLAUDE.md` and `ws\.claude\agents\ts-web-dev.md`.
  The user may want to delete the preset `tiny-ts-web` and that plugin folder.
- Real chat turns: 3 short ones (AI Team Builder x2, New Project x1), about $0.6 total in the stats
  strips. Streaming worked, so provider auth is present.
- Expectation sources: design-spec.md (sections 3, 5, 6, 7.1, 8, 9, 10), decisions.md D1, D8, D10-D12,
  `prototype/` and `prototype/screenshots/`. No repository-wide a11y policy was found, so WCAG 2.2 AA
  applies (4.5:1 text, 3:1 non-text, 24x24 targets); the 44 px peek height in the spec is guidance.

## Checklist

| # | Item | Dark | Light | Result | Screenshot |
| - | ---- | ---- | ----- | ------ | ---------- |
| 1 | Setup Hub home unchanged | checked | checked | PASS. Cards, hero, theme as today; no draft card (D10). | `10-dark-hub-home`, `80-light-hub-home`, `05-ws-switched` |
| 2 | AI Team Builder: open from Hub, shared chat + sidebar, send, stream, proposal in sidebar preview | checked | page only | PASS. Embed (`ptah-session-embed`) plus `aside#builder-sidebar`; no session header and no inspector in the DOM (D8 ok). Streaming skeleton, then reply with `ptah harness propose config`; sidebar Preview showed Persona + "1 Skill(s)". Note: the agent said it proposed an agent too, but the preview lists no agent (agent-side, not verified). | `11`, `12`, `13`, `14` (dark); `81-light-builder` |
| 3 | Apply in throwaway workspace; result banner | checked | no | PASS (success banner "Applied to ws, 5 files written", file list, "Health: 1 missing across 6 targets", Copy list, Open in Dashboard, Dismiss result). Error banner NOT TESTED (see below). | `15`, `16` |
| 4 | Drafts: Save, Discard, resume via Hub card | checked | dialog only | PASS with defect: Save as draft goes to Hub; the Hub card (Create AI Team) resumes it with the "Draft resumed" strip; Discard starts clean. FAIL: Cancel / Escape leaves the header inert (finding 1). | `30`, `32`, `33`, `37`, `38`, `39`, `40`, `41`, `35` |
| 5 | Reload restore | checked | no | PASS with notes. After `page.reload()` the app lands on the Chat view (no route persistence) with the flagged tab "AI Team Builder" + workflow badge; re-entering through the Hub card restores the same tab, the full transcript and the Preview (Persona + Skill). The "Applied" banner is not restored (Apply shows again, expected for a transient result). | `20`, `21`, `22` |
| 6 | New Project from Hub with intake; first message carries the seed | checked | no | PASS. Intake modal, then builder page "New Project Setup" with the seed turn and Stack profile; agent streamed and asked an `Input needed` question. | `42`, `43`, `44` |
| 7 | Two-way builder switch; leave dialog; no stuck state | checked | no | PASS for Hub, FAIL for builder header. New Project -> Create AI Team opens "Open the AI Team Builder?" over the builder page; Cancel, Discard both behave; Hub cards still work after Cancel (intake opens and closes). AI Team Builder -> Start New Project shows the Hub confirm "Open leave choices for AI Team Builder?" then "Start the New Project?"; Cancel, Hub cards still work. After every Cancel the builder header is inert (finding 1). | `50`-`59` |
| 8 | D11 sidebar scroll (1280x600, 1280x480, 700x600 sheet) | PASS | PASS | PASS (numbers below). Header strip fixed, body scrolls. | `60-*`, `61-*` |
| 9 | Items 1, 2, 4, 8 in both themes; contrast and focus of dialog and sidebar controls | done | done | Dialog contrast and focus PASS. Preset select edge and focus ring FAIL (finding 3). | `82`-`87`, `95`, `96` |
| 10 | Compare with `prototype/` | - | - | DEVIATES (moderate, see Prototype fidelity). | - |

D11 measurements (`#builder-sidebar` scroll body; `h2` "Configuration" `top` unchanged after scrolling):

| Viewport | Theme | scrollHeight / clientHeight | scrollTop after wheel | Header strip | Page scroll |
| -------- | ----- | --------------------------- | --------------------- | ------------ | ----------- |
| 1280x600 | dark | 1238 / 455 | 783 | fixed (top 113 before and after) | none |
| 1280x480 | dark | 1238 / 335 | 903 | fixed | none |
| 700x600 sheet | dark | 1094 / 419 | 675 | fixed | none inside builder |
| 1280x600 | light | 1077 / 455 | 622 | fixed | none |
| 1280x480 | light | 1077 / 335 | 742 | fixed | none |
| 700x600 sheet | light | 973 / 419 | 554 | fixed | none inside builder |

Last section ("Session") bottom edge was exactly at the viewport bottom after scrolling in all six
cases, so the whole sidebar is reachable. The scroll body class is `flex-1 min-h-0 overflow-y-auto`
and every ancestor up to the route host has `min-h-0` / `overflow-hidden` (DOM chain recorded).

## Findings by severity

### Visual breaking

#### 1. After the leave dialog is dismissed (Cancel, Escape, backdrop), the whole builder header stays `inert` and focus is lost

- File: `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts:104`
  (`<div class="shrink-0" [attr.inert]="dialogOpen() ? '' : null">`) interacting with
  `libs/frontend/harness-builder/src/lib/components/harness-builder-leave-dialog.component.ts:168-196`
  (`ngAfterViewInit` stores `wasInert` and sets `sibling.inert = true`; `ngOnDestroy` restores `sibling.element.inert = sibling.wasInert`).
- Viewports affected: all (1280x800 docked, 1280x480, 700x600, 432x760); both themes.
- Screenshots: `34-dark-after-escape-stuck.png`, `35-dark-after-cancel-header-inert.png`; the dialog before it: `30-dark-leave-dialog.png`.
- Problem: the dialog's own inert loop runs after the view's `[attr.inert]` binding has already
  set the header wrapper to inert, so it records `wasInert = true` for the header wrapper. When the
  dialog closes, Angular removes the attribute (binding becomes `null`), then the dialog's
  `ngOnDestroy` sets `inert = true` again; nothing clears it. DOM proof after Cancel:
  `document.querySelectorAll('[inert]')` returns `DIV.shrink-0` (the header wrapper, 1216x57 at
  y=40), `elementFromPoint` over "Start over" returns `PTAH-HARNESS-BUILDER-VIEW`,
  `button.closest('[inert]')` is true, a real mouse click on "Start over" does not open the dialog,
  and Playwright's own click times out with "ptah-harness-builder-view intercepts pointer events".
  `document.activeElement` is `BODY` afterwards, so the spec's "focus returns to the trigger" also fails
  (the trigger is inert, so `.focus()` is a no-op). Reproduced via Cancel button (x3), Escape (x2)
  and in the switch dialog opened from the Hub.
- Impact: after opening and cancelling the leave choices, the user can no longer use "Hide panel",
  "Start over" or the Back (x) button, and at narrow widths the peek bar (it lives in the same
  wrapper), which is the only way to open the configuration sheet. They must leave through the
  top nav and re-enter the builder. Keyboard users are stranded in the page body. The same wrapper
  also hides the two-way-switch Cancel path from item 7 (the Hub is fine, the builder page is not).
- Fix: have a single owner of inertness. Either drop the `[attr.inert]` bindings from the view
  (header wrapper at line 104, `main` at 241, sidebar wrappers at 249 and 267) and let the dialog
  manage it, or drop the dialog's sibling loop and keep only the view bindings. If the dialog loop
  stays, restore with `inert = false` for elements it did not mark itself, or capture `wasInert`
  before the binding changes. Add a test that opens and cancels the dialog and asserts
  `document.querySelector('[inert]')` is null and focus is back on the trigger.

### Serious

#### 2. A session that has no saved proposal shows "Saved configuration unavailable ... has expired or was cleared"

- File: `libs/frontend/harness-builder/src/lib/services/harness-proposal-hydration.service.ts:398-401`
  (status becomes `'unavailable'` whenever `revisions.size === 0`, no snapshot and `bound.sessionIds.size > 0`),
  rendered by `libs/frontend/harness-builder/src/lib/components/harness-config-preview.component.ts:50`.
- Viewports: all; both themes.
- Screenshots: `51-dark-switch-dialog.png` and `54-dark-resume-newproject-after-cancel.png` (New Project, agent mid-turn),
  `81-light-builder.png` (AI Team Builder after one answer with no proposal), `91-dark-narrow432-sheet.png`.
- Problem: on first open the Preview correctly says "No configuration yet". After any re-entry
  (leave to the Hub and come back, or restore) of a session whose agent has not proposed anything yet,
  the Preview switches to a warning-style card: "The configuration saved for this session has expired or
  was cleared, so the preview is empty." with a button "Ask the agent to propose it again". Nothing was
  saved, nothing expired, and in screenshot `54` the agent is still running and asking its first question.
- Impact: misleading error state on the main surface of the feature; the button invites a
  second proposal request while the agent is working; users will think work was lost.
- Fix: map "no revisions and no snapshot" to the normal empty state; reserve `unavailable` for the
  case where a snapshot or revision was known to exist and failed to load (the spec's `hydr=unavailable`
  scenario).

#### 3. Preset select edge and focus ring are far below 3:1 (the spec's `border-base-content/50` is not taking effect)

- File: `libs/frontend/harness-builder/src/lib/components/sidebar/builder-presets-section.component.ts`
  (the select carries `select select-sm select-bordered w-full border-base-content/50`; the computed
  border colour is still DaisyUI's 20% alpha edge). Class string recorded from the DOM.
- Viewports: all; both themes.
- Screenshots: `86-light-builder-sidebar-bottom.png`, `96-light-preset-select-focus.png`, `96-dark-preset-select-focus.png`, `95-light-sidebar-focus.png`.
- Problem: computed `border-top-color` is `oklch(0.91586 0.006 53.44)` in light and
  `oklch(0.925 0.007 88.6 / 0.2)` in dark. Measured against the surrounding surface: about 1.2:1 in the
  light theme and 1.75:1 in dark. The focus outline on the select is the same colour at 0.2 alpha:
  1.75:1 in dark, near invisible in light (screenshot `96-light`). Every other sidebar button shows a solid
  2 px outline (gold in dark `oklch(0.77 0.14 91)`, plum in light `oklch(0.48 0.127 0)`, offset 2 px), so the
  select is the only control with no visible ring. This is exactly the problem design-spec section 9
  says the `/50` edge was meant to fix.
- Impact: WCAG 1.4.11 (non-text contrast 3:1) and 2.4.7/2.4.11 (focus visible) failures on the control
  that loads presets; low-vision users cannot see the field or its focus.
- Fix: raise specificity or use an explicit utility (for example `!border-base-content/50` or a
  `select-bordered` override in the sidebar), and set `focus-visible:outline-primary` (or the
  gold/plum ring used elsewhere) on the select.

### Moderate

#### 4. Narrow peek bar is missing the status the spec requires, and the sheet shows two "Configuration" headers

- File: `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts` (peek button, lines 213-229) and the sidebar header strip (`harness-builder-sidebar.component.ts`).
- Viewports: under 720 px (700x600, 432x760).
- Screenshots: `91-dark-narrow432-sheet.png`, `60-dark-sidebar-700x600-top.png`; prototype `prototype/screenshots/dark-narrow-400-sheet-open.png`.
- Problem: spec section 8 asks for a right-aligned status in the peek bar ("Ready to apply", "Applied", "Apply failed", "Needs your answer"). The peek bar shows only "Configuration / No configuration yet / chevron". Even while the chat showed an `Input needed` card (`60-dark-sidebar-700x600-top.png`, 700x600), no "Needs your answer" appeared. A repo search finds neither string in `libs/frontend/harness-builder/src`. The wide header's "ready" dot on the closed toggle (spec section 3) is also absent. In the open sheet the peek bar "Configuration" and the sidebar's own strip "Configuration  0 agents, 0 skills" both render (the spec hides the strip under 720 px: "the peek bar is the header there").
- Impact: a user with the sheet closed gets no cue that the agent is waiting for them or that Apply is ready; the doubled header wastes 48 px of a short sheet.
- Fix: add the status text and dot per spec section 8 and 3; hide the sidebar header strip when `sheet` is true.

#### 5. Icons from the approved prototype are missing; glyphs replace them

- File: `harness-builder-view.component.ts` header (lines 150-190: text "Hide panel", `↻`, `×`), sidebar header, Preview rows, helper cards.
- Screenshots: `11-dark-builder-initial.png`, `14-dark-builder-after.png` against `prototype/screenshots/dark-configure-building-wide.png` and `light-sidebar-full-configure-ai-helpers.png`.
- Problem: the prototype uses Lucide icons (panel-right, rotate-ccw, x, settings in "Configuration", icons on the Preview rows, helper cards and a trash icon in Discard). The build renders plain text, the Unicode glyphs `↻` and `×`, and chevron characters `⌃`/`⌄`. The Discard button shows a small red `×` (not a trash). The status block of Apply is plain text without the check-circle icon and tinted panel.
- Impact: visual hierarchy is flatter than the approved design; glyph rendering differs by font. Not blocking.
- Fix: use the project's Lucide sprite/icons as the prototype does.

#### 6. The empty AI Team Builder chat shows the generic welcome with unrelated quick prompts

- Screenshot: `11-dark-builder-initial.png`.
- Problem: spec section 4 expects an empty chat with the normal placeholder and guidance in the sidebar. The embedded chat shows the full Ptah welcome ("GET STARTED" categories and prompts such as "Orchestrate a feature", "Bootstrap SaaS workspace", "Add Angular component"). Clicking one would send a non-builder prompt to a builder session. The first-step guidance exists in the sidebar ("No configuration yet. Start by telling the agent ...").
- Impact: the builder page invites off-task prompts; also it fills the whole chat on short windows.
- Fix: decide whether the embed should render a builder-appropriate empty state (an embed input) or accept as documented behaviour; if accepted, record it in decisions.md.

#### 7. At a short window with a pending question card the composer is pushed out of the chat region

- Viewport: 1280x480 (dark), also footer row clipped at 1280x600 and 700x600.
- Screenshots: `61-dark-sidebar-1280x480-scrolled-bottom.png`, `60-dark-sidebar-1280x600-top.png`, `60-dark-sidebar-700x600-top.png`.
- Problem: `ptah-session-embed` is 383 px tall at 1280x480 but the composer textarea sits at top 484, bottom 545, so it is below the viewport (480). At 1280x600 the composer fits but the model/mode footer row is cut. Observed with the AskUserQuestion card open. I did not compare against the normal Chat view at the same height, so the cause may be in the shared chat; the builder page is where the 600 px height is bounded.
- Impact: the user cannot reach the message box at about 480 px height until the question is answered.
- Fix: let the transcript region shrink and scroll (`min-h-0`) inside the embed so the composer keeps its place; verify on the plain Chat view at 480 px.

#### 8. Sidebar session toggle is 18 px tall

- Screenshot: `95-dark-sidebar-focus.png` (area at the bottom of the sidebar).
- Problem: the "SESSION" summary button measures 294x18 and the embedded stats "Expand stats" button 18x18. The spec asks for 24x24 targets. The WCAG 2.5.8 spacing exception probably covers both (nothing else within 24 px), but the spec's own number is not met.
- Fix: raise to `min-h-6` (24 px), preferably 32 px like the other controls.

### Minor

- Config summary says "0 agents, 0 skills" in the header strip and the Preview meta while the Skills card reads "1 Skill(s), 1 custom" (`14-dark-builder-after.png`). The summary counts selected items, the card counts the generated custom skill.
- "Hide panel" toggle: visible text "Hide panel", accessible name "Hide configuration panel" (`harness-builder-view.component.ts:133-137`), which does not contain the visible label (WCAG 2.5.3 label in name). Align the text or the name.
- Hub conflict confirm (D12 b1): the button "Open leave choices" uses the red destructive style (`57-dark-newproject-conflict-dialog.png`), but it only opens the leave dialog. Copy is as specified; the red styling suggests data loss. It is the Hub's existing confirm style, so the style change would need your approval under D10.
- Seed text is a run-on: "Who it's for: Not sure Stack: Recommend for me" on one line, platform "Node / TypeScript" (selected in the intake) is missing from it (`44-dark-newproject-streaming.png`).
- Leave dialog buttons render 32 px tall at 432 px although the classes include `min-h-10`; the `min-[460px]:` pair does not take effect because DaisyUI `btn-sm` sets the height (`92-dark-narrow432-leave-dialog.png`). 32 px still passes 24 px.
- No top-nav tab is highlighted while the builder page is open (`11-dark-builder-initial.png`); the Hub tab is only highlighted on the Hub.
- "Draft resumed" and the Apply result are plain text strips (no icon/heading) versus the prototype's headed notices (`38-dark-draft-resumed.png` against `prototype/screenshots/dark-configure-draft-resumed.png`).

## Prototype fidelity

- Approved prototype: `.ptah/specs/TASK_2026_649_33c4/prototype/index.html` and `prototype/screenshots/`.
- Fidelity assessment: DEVIATES (structure and behaviour match, finish and a few components do not).
- Matches: page anatomy (header with title, badge, panel toggle, Start over, Back; chat left, 336 px sidebar right); sidebar section order (Apply, Stack profile for New Project, Preview, AI helpers, Presets, Session); partial-state Apply as an outline button with "Writes into ws" (single primary button rule respected); leave dialog structure, copy, button order (Cancel focused first, Discard, Save as draft primary), focus trap and 420 px panel (`30` against `prototype/screenshots/dark-leave-dialog-start-over.png`); "Draft resumed" notice; New Project Stack profile; narrow layout with peek bar and sheet; compact badge and icon-only header actions under 720 px.
- Deviations: findings 4 and 5 (peek status, ready dot, doubled header, icons); status panels without the tinted icon block; Preview shows only Persona and Skills rows because the agent only proposed those, so Agents / System prompt / MCP rows and chevron rows were not exercised; the "Applied" result renders as a bordered success box plus file list as in the prototype, but without the tinted check header.
- Not exercised: gate states needing fixtures (`apply=blocked`, `apply=error`, `init=error`, `hydr=failed`, `page=missing`, `page=wrongkind`, pin badge, grid cap), see Not testable.
- No before/after comparison is needed (a prototype exists).

## Viewport results

| Viewport | Screen | Elements checked | Status | Screenshot |
| -------- | ------ | ---------------- | ------ | ---------- |
| 1280x800 | Hub, builder, New Project | layout, header, docked sidebar, composer | OK | `10`, `11`, `44` |
| 1280x600 | builder (New Project) | docked sidebar scroll, header fixed | OK (footer row of composer clipped) | `60-dark-sidebar-1280x600-top`, `61-*` |
| 1280x480 | builder | sidebar scroll OK; composer pushed out (finding 7) | partial | `61-dark-sidebar-1280x480-scrolled-bottom` |
| 700x600 | builder | peek bar, sheet, sheet scroll | OK, but doubled header (finding 4) | `60-*-700x600-top`, `61-*-700x600-scrolled-bottom` |
| 432x760 | builder | closed peek bar, sheet, dialog stacked buttons | OK | `90`, `91`, `92` (dark and light) |
| 400x760 | builder (light) | shell clips Back button by 20 px (shell `min-w-[400px]` after a 32 px rail) | shell limit | `90-light-narrow400-closed`, `93-light-narrow400-closed-header-check` |

Outside this task: at 700 px and below the app shell top nav wraps/overflows and the document is
horizontally scrollable (`documentElement.scrollWidth` 722; offenders are the `electron-tabs` and the
shell header, none inside the builder). Visible in `91-dark-narrow432-sheet.png`.

## Component and interaction results

| Component | States tested | Status | Screenshot |
| --------- | ------------- | ------ | ---------- |
| Leave dialog | open, initial focus (Cancel), Tab cycle and trap, Escape, Cancel, Save, Discard, unstarted-session note, narrow stack, dark and light | works, but leaves header inert (finding 1) | `30`, `31`, `41`, `82`-`84`, `87`, `92-*` |
| Header controls | default, Start over, Back | blocked after dialog dismiss (finding 1) | `35` |
| Apply section | partial, applying, applied with file list and health line | OK | `14`, `15`, `16` |
| Preview | empty, proposal, "unavailable" | false unavailable (finding 2) | `11`, `14`, `54` |
| AI helpers / Presets | disabled "Needs a persona" text, select focus | select edge/focus fail (finding 3) | `85`, `86`, `96` |
| Hub intake and conflict confirm | open, fill, submit, conflict confirm, cancel | OK; Hub cards usable after each cancel | `42`, `43`, `57`, `59` |
| Sidebar scroll | wheel scroll at 3 sizes x 2 themes | OK | `60-*`, `61-*` |

## Design system compliance

| Token expected | Observed | Where |
| -------------- | -------- | ----- |
| Field edge `border-base-content/50` (spec 5.1, 9) | `oklch(.916 .006 53)` light, `oklch(.925 .007 88.6 / .2)` dark | preset select (finding 3) |
| Error text base-content, error colour on icon and border only (decision 14) | complies where seen (no apply error rendered) | - |
| Focus ring 2 px offset 2 | gold (dark) / plum (light) on buttons and dialog; select alpha 0.2 | sidebar, dialog |
| Section label `text-[10.5px]` uppercase muted | 10.5 px / 600, 5.48:1 light, 5.71:1 dark | sidebar h3 |

## Accessibility audit

Contrast (computed colours, composited backgrounds):

| Pair | Dark | Light |
| ---- | ---- | ----- |
| Dialog title | 12.46:1 | 13.33:1 |
| Dialog body (14 px) | 5.07:1 | 5.06:1 |
| Cancel / Discard text | 12.46:1 | 13.33:1 |
| Cancel / Discard edge vs panel | 4.18:1 | 3.13:1 |
| Save as draft text | 4.82:1 | 6.81:1 |
| Sidebar section label (10.5 px) | 5.71:1 | 5.48:1 |
| Sidebar meta (11 px muted) | 5.71:1 | 5.48:1 |
| Unavailable card body (12 px) | 5.65:1 | 5.39:1 |
| Helper title, "Needs a persona" | 13.89:1 | 14.21:1 |
| Preset select edge | 1.75-1.85:1 (fail) | about 1.2:1 (fail) |

- Focus order and ring: the dialog traps Tab (Cancel, Discard, Save, back to Cancel) and Escape closes it; each stop shows a solid 2 px ring (`31`, `83`, `84`). Cancel opens focused but without a ring when the dialog was opened with the mouse (`:focus-visible` false, expected). After dismissal focus goes to `BODY` (finding 1). All nine sidebar controls I tabbed show a ring except the select (finding 3).
- Structure: `h1` "AI Team Builder", `h2` "Configuration", `h3` per section; landmarks `header`, `main`, `aside[Configuration]`, four `section`s with `aria-labelledby`; dialog has `role=dialog`, `aria-modal=true`, `aria-labelledby`, `aria-describedby`; toggle and peek have `aria-controls="builder-sidebar"` and `aria-expanded`.
- Target size: header buttons 28x32 / 32x32, dialog buttons 32 px, peek bar 44 px; under 24 px only the Session toggle (294x18) and "Expand stats" (18x18) (finding 8).
- Body text: sidebar copy 11-14 px (spec sizes); not raised.

## Visual performance

- Loading states: streaming shows the chat skeleton and a stop button before content (`13`); the sheet opens without layout shift in my captures.
- No layout shift was observed when the proposal arrived: the Apply section appears above Preview and pushes it down by about 100 px (`13` to `14`). It happens while the user is reading the chat, not under a click target.
- Console: one Angular NG0914 warning (zoneless with Zone.js loaded); no errors.

## Not testable / not done

- Apply error banner, `apply=blocked`, `init=error`, `hydr=failed`, `page=missing` and `page=wrongkind` cards, pin badge ("Targeting ..."), launch-error notice: they need a failing backend or a second workspace switch mid-build; forcing them would risk the user's data.
- Hub warning for a failed `chat:abort` (D12 a1) and the malformed-relay line (D12 c1): need a failing abort or a crafted relay message.
- Hub in light theme and the Hub conflict confirm in light were not captured. Light coverage: Hub (`80`), builder (`81`), dialog and focus (`82`-`84`), sidebar scroll, narrow sheet.
- Setup Hub "Create AI Team" label in light theme looks low contrast (`80-light-hub-home.png`); not measured, not scored, since D10 freezes the Hub design.
- Platform resizing via the Electron window (`Browser.setWindowBounds`) is not exposed; emulation was used instead.

## Verdict

- Recommendation: REVISE (CHANGES REQUIRED)
- Confidence: HIGH (the key defect was reproduced five times with DOM evidence, and the root cause is visible in the code)
- Key concern: after the leave dialog is dismissed the builder header, including the narrow peek bar, is permanently inert (finding 1). Fix the double inert ownership and the misleading "Saved configuration unavailable" card (finding 2), then the select contrast (finding 3). D11 passed and the Hub home is unchanged.
