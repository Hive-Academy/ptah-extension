# Requirements review - TASK_2026_702_594d

Reviewer: Anthropic cross-side reviewer (requirements written by a codex lane)
Reviewed: `task-description.md`, `parity-inventory.md`, against `context.md`, `decisions.md` and
the code in the `chat-start-screen` worktree.

## Verdict: REVISE

Counts: Blocking 0, Serious 2, Moderate 6, Minor 5.

Most of the documents are sound. The scope matches the request: one primary action, a Lightfall
hero, one `surface-3` checklist, and recent sessions from existing data. The TASK_2026_593 chip is
out of scope. File references are almost all correct. Two problems justify REVISE. The user's
licence decision (#6) is not written as a requirement, and the text still contradicts it. Two
existing actions also have only a conditional "move", with no acceptance criterion.

## Spot-checked references (26 checked, 25 correct)

| Reference | Result |
| --- | --- |
| `orchestra-canvas.component.ts:149-193` dock trigger inside `@if (canvasStore.canAddTile())` | correct |
| `orchestra-canvas.component.ts:138-141` `headerMessage` `role=status` | correct |
| `orchestra-canvas.component.ts:584-628` open / create / cancel / `createBlockReason` | correct |
| `orchestra-canvas.component.ts:85-141` ticker, needs-you `@defer`, layout warnings | correct |
| `canvas-rail-board.component.ts:127-145` empty section, heading, copy | correct |
| `canvas-rail-board.component.ts:147-164` board button `aria-disabled` / reason | correct |
| `canvas-rail-board.component.ts:369-371` `newSessionBlockReason` (running cap only) | correct |
| `canvas-rail-board.component.ts:885-897` `emptyBoardNewSession`, `sessionCreated` | correct |
| `canvas-rail.component.ts:178-194` "No sessions yet" (expanded + sr-only collapsed) | correct |
| `canvas-rail.component.ts:232-261` footer New session + Previous sessions | correct |
| `canvas-rail.component.ts:263-270,320-325` reason line; tile limit before running cap | correct |
| `canvas-rail.component.ts:341-343` `onNewSession` guard | correct |
| `project-setup-card.component.ts:35-63,130-148` warning suppressed until catalog loaded | correct |
| `project-setup-card.component.ts:54-60,150-153` `openMarketplace({page:'skills',...})` | correct |
| `project-setup-card.component.ts:65-110` glass card | correct |
| `chat-empty-state.component.ts:18-23,82-85` `showProjectSetup` gate | correct |
| `chat-empty-state.component.ts:51-91` logo / title / tagline / suggestions | correct |
| `setup-status-widget.component.ts:117-135,229-257` Configure/Update, Generate agents, Project guidance | correct |
| `setup-status-widget.component.ts:80-129` "no-workspace states" | **partly wrong**: the no-workspace / Open Folder branch is at `:61-74` (Minor m1) |
| `chat.store.ts:108-112,210-220` `sessions`, `loadSessions`, `setListQuery` | correct |
| `rpc-setup.types.ts:113-117` `SetupStatusGetResponse` has no scan-completion field | correct (`:113-119`) |
| `styles.css:385-403` `.surface-3` | correct |

Note: the line ranges in `context.md` for the board (`:114-155`, card at `:153`) are stale. The
parity inventory has the right ones (`:127-168`, card at `:166`), so the inventory is the
authoritative reference.

## Findings

### S1 (Serious): the user's licence and rendering decision is not a requirement, and the text contradicts it

Evidence:
- `decisions.md` #6 (user, 2026-10-19): port the shader to **raw WebGL, no Three.js in the chat
  bundle**, and keep Omnedia's MIT notice in the app's third-party notices.
- `task-description.md:59` still says "An npm dependency remains a viable option".
  `:76` still says the decision is "conditional on licence decision". `:67` still says "resolve
  the MIT notice placement" as an open risk. Only the banner at `:81` records the resolution.
- No acceptance criterion requires the notice, or forbids `ngx-lightfall`/`three` in the chat
  bundle. `three@0.185.1` is already in the root `package.json:287`, so it could be imported
  without anyone noticing.
- No third-party notices file exists in the repository today. Only `LICENSE.md` is at the root,
  and there is no `NOTICE`/`THIRD_PARTY*` file under `apps/`. So "the app's third-party notices"
  is a deliverable, and no criterion covers it.

Fix: add a requirement "11. Third-party attribution and rendering dependency":
1. When the hero is shipped, the distributed Electron and VS Code builds shall include Omnedia's
   ngx-lightfall MIT copyright line and permission notice in a third-party notices file. The
   architect chooses the file's location.
2. When the change is merged, no frontend library shall import `three` or `@omnedia/ngx-lightfall`
   for the hero. Check with a grep of the changed libs' imports and `package.json` dependencies.
3. When the ported shader source is read, it shall carry a header comment that names the
   upstream file and the MIT licence.

Also update `:59` and `:76` to match decision #6 (local raw-WebGL port, no npm option), and remove
`:67` or mark it resolved.

### S2 (Serious): Generate agents and Project guidance have only a conditional "move" and no acceptance criterion

Evidence: `setup-status-widget.component.ts:130-146` renders two more actions: "Generate agents"
(`launchGeneration('setup-agent-generation')`) and "Project guidance"
(`launchGeneration('setup-project-prompt')`). They have their own failure line at `:148-152`.
Parity row `parity-inventory.md:106` says "retain access to existing generation actions **if**
replacement removes widget". AC7 (`task-description.md:36`) names only Open Library, Configure,
Update/retry/workspace-not-open, and Run setup. If the checklist replaces the widget, these two
actions can disappear and still pass every criterion. That is a silent removal, which the parity
rules forbid.

Fix: give the two actions an unconditional decision and a location. For example, "move: Agents
row secondary actions" or "move: Project scan row". Or list them under `## Proposed Removals` for
user approval. Then add to AC7: "When agent status has loaded, Generate agents and Project
guidance shall launch their existing generation workflows, and a failed launch shall show the
existing 'Could not open generation' message."

### M1 (Moderate): the Project scan row's ready signal and action are undefined, so the card may never hide

Evidence: `SetupStatusGetResponse` (`rpc-setup.types.ts:113-119`) has `isConfigured`,
`agentCount`, `ruleCount`, `lastUpdated` and `hasClaudeConfig`, but nothing that means "scan
completed". The PM correctly refuses to invent a flag (`task-description.md:65,77`). The effect is
that AC6's "When all three are verifiably ready, it shall hide the card" can never be met. The card
would then stay permanently, which goes against the accepted proposal ("hidden when all are
ready"). "Run setup shall invoke the existing setup path" (`:36`) also does not say which path. The
only setup launcher is `setup-wizard:launch` (`setup-status-widget.component.ts:236`), and that is
the same action as Agents → Configure. Two rows with one identical action is a duplicate action,
which AC10 itself forbids.

Fix: move this out of Risks into `## Open questions`, owned by the architect, and state the
fallback behaviour as a requirement. For example: "If no existing signal confirms project-scan
completion, the Project scan row shall show a non-ready, non-error state, the count shall exclude
it, and [the card shall still hide when Skills and Agents are ready / the card shall remain]." The
orchestrator chooses one, and either choice can be checked. Also name the Run setup target, or
state that Agents and Project scan may share one action with one control.

### M2 (Moderate): hiding the dock trigger removes the popover's anchor, and no risk names this

Evidence: the single name popover is anchored to the dock button. Both are inside the same
`@if (canvasStore.canAddTile())` block (`orchestra-canvas.component.ts:144-149,172-193`), and the
comment at `:144-148` says "Its anchor is this dock button". AC1 hides that trigger on an empty
board, and AC2 still requires "the existing optional-name popover". The approach is feasible, but
it changes where the popover appears and how focus returns. Parity row `:95` says "keep" without
any note about the anchor.

Fix: add a risk: "Popover anchor and focus return move when the dock trigger is hidden". The
architect owns it, and the action is to define the anchor and the focus-return target for board
and rail activation. Extend AC2: "...and on dismiss, focus shall return to the control that opened
it."

### M3 (Moderate): dark/light legibility cannot be checked

Evidence: AC4 (`task-description.md:33`) says "maintain legibility in dark and light themes". The
repository already measures contrast per theme: `project-setup-card.component.ts:23-27` quotes
measured ratios for `anubis` and `anubis-light`. So a checkable bar already exists in the
repository's own practice.

Fix: "When the hero renders in `anubis` and `anubis-light`, text over it shall meet 4.5:1 and
control boundaries and focus rings 3:1 against the brightest beam pixel behind them, measured on
the Gate 1.7 screenshots and in the Electron visual check."

### M4 (Moderate): the single-chat checklist has no narrow-width criterion

Evidence: the shared checklist also goes on the single-chat empty state (in scope, `:16`; AC8).
That state is the default VS Code sidebar layout, and it is built for a compact sidebar
(`chat-empty-state.component.ts:46-48`, "Compact: Sidebar narrow view (< 280px width)"). AC10
covers only the 800px and wide windows.

Fix: add to AC10: "When the single-chat empty state is shown in the VS Code sidebar at 280px
width, the checklist rows, their actions and the count shall stay readable and reachable, with no
horizontal overflow."

### M5 (Moderate): the recent-session cards can follow the dialog's filter

Evidence: `ChatStore.sessions` is the same signal the Previous sessions modal filters
(`chat.store.ts:112` `listQuery`, `:219` `setListQuery`; the loader's query includes `pinned` and
others, `session-loader.service.ts:79-100,247,477-481`). The risk is named (`:66`), but AC9 does
not test it.

Fix: add to AC9: "When the Previous sessions dialog's search or filter is changed and the dialog
is closed, the recent cards shall still show the active workspace's three most recently active
sessions." Also cite the open path the cards must reuse:
`SessionRowActionsService.openSession` (`session-row-actions.service.ts:53-75`, grid branch
`requestCanvasSession`). Add: "When opening fails, the system shall announce the failure and keep
the card."

### M6 (Moderate): the output contract sections are missing

Evidence: the document has no `## Context` section with the current behaviour at file:line, no
`## Open questions`, and no `## Handoff`. It also has no stakeholder table, and its risks have no
likelihood, impact or owner (`task-description.md:61-67`). Readers lose the next-specialist
signal, and the risks have no one to act on them.

Fix: add a short Context section (reuse the parity references), an Open questions section (M1,
plus where the notices file lives), and a Handoff ("ui-ux-designer next, per the context.md flow;
the architect after Gate 1.7"). Add an owner to each risk.

### m1 (Minor): the widget reference is wrong

Parity `:105` cites `setup-status-widget.component.ts:80-129` for the "no-workspace states". The
Open Folder branch is at `:61-74`, and loading is at `:54-60`. Fix the range to `:54-153`.

### m2 (Minor): two pieces of existing content are not inventoried

The feature badges "Auto-detect / VS Code AI / MCP Server" (`project-setup-card.component.ts:94-105`)
and the hieroglyphic footer (`chat-empty-state.component.ts:93-…`) have no rows. Add rows: the
badges as `remove-proposed` (decorative, with emoji) or `move`, and the footer as `keep`.

### m3 (Minor): runtime motion-preference changes are not covered

AC5 does not say what happens when `prefers-reduced-motion` changes while the board is open. Add:
"When the preference changes at runtime, the hero shall switch between animated and static
without a reload."

### m4 (Minor): "coherent" focus order is not checkable

Name the order in AC10: board primary action → checklist actions in row order → recent session
cards → (rail). Also add: "the checklist count shall be exposed as text, not only as a visual
meter".

### m5 (Minor): the hero's surface boundary is implied, not stated

The hero and the recent sessions appear only on the zero-tile board. The VS Code single-chat start
screen gets only the checklist. Say this in Out of scope so the designer does not add the hero
there.

## Check summary

1. Parity: complete and correctly located, except S2 (a conditional move), m2 (two
   uninventoried content items) and m1 (one wrong range). No silent removals other than S2.
2. Acceptance criteria: dark/light (M3), 800px/wide (yes; narrow sidebar M4), Electron + VS Code
   (yes), keyboard/screen reader (yes, sharpen with m4), reduced motion (yes, m3), WebGL fallback
   and context loss (yes), GPU pause when hidden/offscreen/non-empty (yes, AC5).
3. Scope matches the request. There are no invented data sources: recent sessions come from
   `session:list` via `ChatStore`, skills from `PluginCatalogService`, and agents from
   `setup-status:get-status`. Project scan correctly refuses to invent a flag (M1).
4. The TASK_2026_593 needs-you chip is out of scope (`task-description.md:23`) and kept in the
   dock (parity `:109`).
5. Decisions are evidenced with correct references, apart from the stale licence decision (S1).

## Round 1 re-review

Scope: the 13 round-0 findings, any regressions the fixes introduced, and whether the notices
location works for packaging. Read: `task-description-revision-1.md`, the revised
`task-description.md` and `parity-inventory.md`, `apps/ptah-extension-webview/project.json`,
`apps/ptah-electron/electron-builder.yml`, `apps/ptah-electron/project.json`,
`apps/ptah-extension-vscode/project.json`, `apps/ptah-extension-vscode/.vscodeignore` and
`scripts/copy-webview.js`.

### Verdict: REVISE

Counts: Blocking 0, Serious 1 (new), Moderate 1 (new), Minor 1 (new). All 13 original findings are
closed. Only the notices mechanism from the S1 fix still needs work.

### Status of the original findings

| ID | Status | Evidence |
| --- | --- | --- |
| S1 | **Partly fixed**: the dependency and attribution requirements are now present (AC11, `task-description.md:45`; resolved direction `:65`; Decisions row). The chosen notice location does not survive Electron packaging; see R1 below. | `task-description.md:45,65` |
| S2 | Fixed: unconditional `move` rows for Generate agents and Project guidance (parity `:25-26`), and AC7 names both workflows and the "Could not open generation" feedback. | parity `:25-26`; `task-description.md:41` |
| M1 | Fixed: AC6 states the unknown-row rule (excluded from the count, card stays visible), and both questions are in Open questions, owned by the architect. | `:40,79-82` |
| M2 | Fixed: AC2 returns focus to the opener, the parity anchor row is `move`, and a risk with the architect as owner is added. | `:36,72`; parity `:12` |
| M3 | Fixed: AC4 gives 4.5:1 / 3:1 targets in both themes. | `:38` |
| M4 | Fixed: AC10 covers the 280px sidebar. | `:44` |
| M5 | Fixed: AC9 names `SessionRowActionsService.openSession`, is independent of the dialog filter, and keeps the card on failure. | `:43` |
| M6 | Fixed: Context, a risk table with owners, Open questions and Handoff are all present. | `:3-5,69-82`, Handoff |
| m1 | Fixed (`:54-153`). | parity `:23` |
| m2 | Fixed: badges `move`, footer `keep` (`chat-empty-state.component.ts:93-100`). | parity `:22,29` |
| m3 | Fixed: AC5 covers runtime preference changes. | `:39` |
| m4 | Fixed: the focus order and a text count are named. | `:40,44` |
| m5 | Fixed: the Out of scope bullet excludes the hero and recent cards from the single-chat screen. | `:30` |

### New findings

#### R1 (Serious): `apps/ptah-extension-webview/public/THIRD_PARTY_NOTICES.md` is stripped from the Electron installers

Evidence:
- Copying works as far as the webview build. `apps/ptah-extension-webview/project.json:17-21`
  copies `public/**/*` into `dist/apps/ptah-extension-webview/browser`. The VS Code host copies
  that folder with `scripts/copy-webview.js:12-29`, which skips only Electron-only chunks. The
  Electron host copies it with `apps/ptah-electron/scripts/copy-renderer.js:25`.
- **Electron removes it at packaging.** `apps/ptah-electron/electron-builder.yml:28-37` applies
  `'!**/*.md'` and `'!**/{CHANGELOG,HISTORY,AUTHORS,CONTRIBUTORS,NOTICE}*'` to every installer. So
  a `.md` notice in the renderer folder never reaches the shipped app, and AC11's "present in both
  the Electron app and VS Code extension distributions" fails by construction.
- VS Code is also a risk. `.vscodeignore:57-62` excludes `**/LICENSE.md` because licence text
  "triggers marketplace scanner" and "a marketplace rejection burns the extension ID
  permanently". A webview file that contains the full MIT permission text needs the same check.
- The repository already has a working pattern for this exact obligation (TASK_2026_533).
  `brand-icons-notices.txt` is plain text, copied by each host's own build assets
  (`apps/ptah-electron/project.json:104`, `apps/ptah-extension-vscode/project.json:49`). Electron
  ships it as an `extraResources` entry (`electron-builder.yml:116-121`), whose comment says it
  is "shipped as plain text beside the app because the minified renderer bundle strips the comment
  header".

Fix: specify the outcome and leave the mechanism to the architect, as the method requires. Replace
the fixed path in AC11, the resolved direction (`:65`) and the Decisions row with:
"The Omnedia MIT copyright line and full permission notice shall ship in a third-party notices
file in both host distributions. The file shall follow the existing `brand-icons-notices.txt`
pattern (plain text; copied by each host's build assets; Electron `extraResources`), or be added
to that file. It shall not be a `.md` file under the renderer output, which
`electron-builder.yml:33` strips. The VS Code copy shall be checked against the `.vscodeignore`
licence-scanner rule (`:57-62`)." Update the packaging risk mitigation to match.

#### R2 (Moderate): AC11's check needs packaged artifacts, which project rules forbid without the user's request

Evidence: AC11 (`task-description.md:45`) says "inspect both packaged artifacts". The project
`CLAUDE.md` forbids `build` and `package` targets unless the user asks. As written, the criterion
cannot be checked inside the normal flow and will be passed by default.

Fix: make the in-flow check static and defer the artifact check. "Reviewers shall confirm that
the notice file is listed in each host's build assets and the Electron `extraResources`, and is
not matched by any `electron-builder.yml` `files` exclusion or `.vscodeignore` pattern. A
packaged-artifact inspection (`vsce ls`, an unpacked installer listing) is recorded as a
release-time check for the user."

#### R3 (Minor): the consequence of the AC6 fallback should be visible at Gate 1.7

Under the AC6 rule, while no Project scan signal exists the card can never hide, because
"N of 3" tops out at 2. This is a correct and truthful rule, but the user's proposal said
"hidden when all are ready". Add one line to the Handoff: the designer shows the persistent-card
state in the Gate 1.7 prototype so the user sees it and accepts it.

### Regressions checked, none found

- The new Context references (`canvas-rail-board.component.ts:127-164`,
  `orchestra-canvas.component.ts:144-235,584-628`, `project-setup-card.component.ts:35-110`)
  match the code.
- The needs-you chip is still out of scope (`:27`).
- No new data source was invented. AC7 still uses only `setup-wizard:launch` and the existing
  generation workflows.

## Round 2 re-review

Scope: R1-R3 only, read against `task-description-revision-2.md` and the revised
`task-description.md`, with each packaging claim checked in the source.

### Verdict: APPROVED

Counts: Blocking 0, Serious 0, Moderate 0, Minor 1 (advisory, N1).

### R1: resolved

AC11 (`task-description.md:45`), the resolved direction (`:65`), the risk (`:75`) and the
Decisions row (`:91`) now name a plain-text sibling,
`libs/frontend/ui/src/lib/native/brand-mark/lightfall-notices.txt`. Each wiring claim was checked:

- `apps/ptah-electron/project.json:103-107` already has a `brand-icons-notices.txt` asset entry
  (input `libs/frontend/ui/src/lib/native/brand-mark`, output `.`). A sibling entry is the same
  shape.
- `apps/ptah-extension-vscode/project.json:48-52` has the same entry. The output lands at the
  extension dist root. `.vscodeignore` excludes `**/LICENSE.md` but no `*.txt`, so a `.txt`
  notice is not excluded. The marketplace-scanner check still has to be done, and AC11 requires
  it statically.
- `apps/ptah-electron/electron-builder.yml:116-121` ships `brand-icons-notices.txt` as an
  `extraResources` entry. `extraResources` is not filtered by the `files` exclusions at `:28-37`
  (`!**/*.md`, `NOTICE*`). The name `lightfall-notices.txt` would not match those patterns
  anyway.
- `brand-icons-notices.txt:4` says "Generated by scripts/vendor-brand-icons.mjs. Do not edit by
  hand". A separate sibling file is therefore the right choice, rather than appending to that
  file.

### R2: resolved

AC11 now asks for a static check of the notice text, the three declarations, and the `files` and
`.vscodeignore` exclusions during implementation. VSIX and unpacked-installer inspection is a
release-time gate for the packaging owner (`:45,92,97`). This fits the project's no-package-build
rule.

### R3: resolved, with a design change for the user to confirm

AC6 (`:40`) now counts only Skills and Agents ("N of 2 ready"). Project scan becomes an action row
with no done state, and a fully ready card collapses to a one-line "Ready" strip. The strip keeps
Run setup, Generate agents and Project guidance reachable, which also keeps the S2 parity intact
rather than hiding those actions. No stale "of 3" or "hide when all three" text remains; the only
"all three" match is the unrelated popover Decisions row at `:89`. The Handoff (`:97`) puts the
strip in the Gate 1.7 prototype.

### N1 (Minor, advisory): flag the change to the accepted proposal at Gate 1.7

The proposal the user accepted said "progress count ('1 of 3 ready'); hidden when all are ready"
(`context.md`). The revised AC6 changes both: the count is out of 2, and the card collapses
instead of hiding. The change is truthful, and its evidence is solid: `SetupStatusGetResponse`
has no scan-completion field. But it is a departure from a user-accepted proposal. The
orchestrator should name it explicitly in the Gate 1.7 summary, not leave it implicit in the
prototype. No document change is required.

## Scope change 1 review

Scope: the dock removal under decisions #9 and #10, read against
`task-description-scope-change-1.md`, the revised `task-description.md` and `parity-inventory.md`,
and `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:85-246,296-300,584-640`.

### Verdict: APPROVED

Counts: Blocking 0, Serious 0, Moderate 2, Minor 1. The two Moderate findings are about test and
code clean-up after the removal; neither drops a user capability. Fold them into the architect's
plan rather than running another PM round.

### Dock capabilities against the code

| Dock element (`orchestra-canvas.component.ts`) | Parity row | Decision | Acceptance criterion | Result |
| --- | --- | --- | --- | --- |
| Dock row reserving height `:86-89`, closing at `:240`; viewport `:243-247` | `:30` | removed-user-approved; the viewport gains the height | AC1 (`:38`) | covered |
| Ticker `:101-110`, `activity` inject `:299-300`, `openThoth()` `:631-640` | `:31` | removed-user-approved; Thoth stays on its own page | AC12 (`:50`) | covered. The Thoth first-run dismissal is still reachable through `global-config-actions.component.ts:95-96` and `app-shell.component.html:155-169`, so nothing is lost |
| Needs-you `@defer` chip and "All clear" placeholder `:112-121` | `:32` | removed, gated on the TASK_2026_593 merge, last phase | AC13 (`:51`) | covered |
| Chip popover actions (Allow/Deny session and lane, open session) | `:33` | same gate; the bell must cover them first | AC13 | covered |
| Four `canvas-needs-you-queue*.ts` files | `:34` | delete after the gate, no shim | AC13 | covered |
| `writeFailed()` warning `:122-127` | `:35` | move to the inline dismissable notice | AC12 + regression test | covered, exact text kept |
| `readOnlyPaths()` warning `:128-137` | `:36` | move to the inline notice | AC12 | covered, exact text kept |
| `headerMessage` status `:138-142` (set at `:587,610`) | `:14`, `:37` | move to the inline notice | AC3 (`:40`), AC12 | covered |
| Popover `:144-235`: backdrop, `bottom-end` placement, `(closed)`, labelled input, Enter/Escape, Cancel/Create, `surface-3` content | `:12` | move, anchored to the hero (empty board) or the sidebar footer (with tiles) | AC2 (`:39`), including backdrop close and focus return | covered |
| Dock trigger states `:149-193`: `canAddTile` gate, `disabled`, `title`, `aria-label`, `aria-describedby`, unavailable `group` semantics, sr-only reason `:236-238` | `:11` | move to the hero and footer triggers | AC3 | covered |
| Create, cancel and block-reason logic `:584-629` | `:12-14` | keep / move | AC2, AC3 | covered |

Nothing else in `:86-240` goes without a row. The cross-task boundary is consistent: this task owns
`orchestra-canvas.component.ts`, TASK_2026_593 owns the bell (`:30,85`), and only the chip waits
for the merge.

### Findings

#### SC1 (Moderate): e2e and perf specs use the removed dock anchor as their entry point and readiness marker

Evidence: `data-testid="canvas-new-session-anchor"` (`orchestra-canvas.component.ts:176`) is the
click target in `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:32,78,95,126`,
`specs/harness/new-project-question-routing.spec.ts:119,182` and
`src/support/ui-driver.ts:453`. The startup-TTI perf spec uses it as its "canvas interactive"
marker (`specs/perf/startup-tti.spec.ts:56-59`). The webview e2e scenario
`libs/frontend/webview-e2e-harness/src/lib/scenarios/thoth/activity-ticker.e2e.spec.ts:13-19`
documents the ticker as living in the dock. None of these appear in the parity inventory or the
acceptance criteria. Removing the dock breaks them silently, and the TTI measure changes meaning.

Fix (architect or implementer, no PM round needed): add a parity row "e2e/perf entry selector" →
move to the hero and footer triggers. Either keep a stable test id on the invoking trigger, or
update the four specs and `ui-driver.ts`. Redefine the TTI marker explicitly, for example as the
hero New session button on an empty board, and note that the change shifts the baseline. Update
the ticker scenario's doc comment and assertions. Under CLAUDE.md these e2e specs are edited, not
run, unless the user asks.

#### SC2 (Moderate): what happens to the ticker's code after removal is not decided

Evidence: after the removal, the only non-spec consumer of `ActivityTickerComponent` (exported from
`libs/frontend/chat-ui/src/index.ts`, implemented in `molecules/activity-ticker/`) and of
`BackOfficeActivityService.recent()/isIdle()` disappears (`orchestra-canvas.component.ts:103-108,300`).
The service is still registered in `apps/ptah-extension-webview/src/app/app.config.ts:26,395`, so it
keeps buffering activity events with no reader. Decision #9 says that "real failures raise a
failure notice through TASK_2026_593", which suggests TASK_2026_593 may consume the service. The
repository rule is to replace rather than accumulate and to delete unused code.

Fix: the architect records one decision. Either delete `ActivityTickerComponent` and its spec
(plus the service registration, if nothing else reads it), or keep them and name the consumer
(TASK_2026_593's failure notice), with a cross-task note. Add the result as a parity row.

#### SC3 (Minor): the populated-board notice position is unstated

AC12 places the notices "inline" on the board. With tiles present the board is the rail plus pane
container (`canvas-rail-board.component.ts:169-170`). The designer should show where the notice
sits on a populated board so that it neither covers tiles nor causes layout shift. This is a design
matter, not a requirement change.
