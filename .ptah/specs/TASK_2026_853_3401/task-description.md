# Requirements - TASK_2026_853_3401

## Context

TASK_2026_710_html (PR #789) lets an agent publish one sandboxed HTML artifact with
`ptah_artifact_publish`. Today the card shows only inside the tool-call row
(`libs/frontend/chat/src/lib/components/molecules/tool-execution/tool-call-item.component.ts:103-112`).
In a long turn it sits under many other tool rows. The assistant reply does not show it.

**Open** and **Full screen** on that card can fail. The card finds its record in all store buckets
(`tool-call-item.component.ts:178-181`, `artifact.store.ts:34-40`). The open action uses the active
tab id (`tool-call-item.component.ts:183-191`). The sheet passes only `records()[tabId]` to the panel
(`display-sheet.component.ts:115-117`). The publish scope is `getSessionTabId(caller) ?? caller`
(`protocol-dispatcher.ts:2365-2378`). When the record bucket is not the active tab id, the panel
shows "The artifact could not be displayed. It is not loaded in this tab."
(`display-panel.component.ts:164,221`). The exact producing path is not confirmed yet.

The Display sheet sits between the transcript and the composer
(`chat-view.component.html:219`, `chat-session-layout.component.ts:11`). Open, it takes 40% of the
chat height; in "full" mode it takes all of it (`display-sheet.component.ts:49-50`) and hides the
transcript. The user wants a right-side sidebar that can detach into its own Electron window.

## Classification

- Type: FEATURE. One bug fix (A) plus new display behaviour (B-D) and one decision gate (E).
- Estimate: XL. It crosses the MCP tool, RPC contract, platform-core port, Electron main process,
  a new window, settings, and the chat layout used by several surfaces.
- Priority: not defined here.

## Scope

In scope:

- A: root cause and fix of "not loaded in this tab", with a regression test.
- B: auto-open of a newly published artifact in the display surface, and a user setting to turn it off.
- C: an artifact card in the assistant reply flow, at the end of the turn.
- D: the Display surface as a right-side, resizable, collapsible sidebar; detach into an Electron
  child window; re-attach; remembered bounds; clean close on quit.
- E: a recorded decision, with evidence, on a bounded inline preview; build it only if the decision is "yes".
- Electron visual review (evidence list below).

Out of scope:

- Changes to the artifact sandbox, CSP, bridge messages or publish tool schema — fixed by TASK_2026_710.
- Declarative dashboard surfaces in chat tabs and `surface:release` — owned by TASK_2026_539_67f5.
- New features or polish for the VS Code extension and the TUI — Electron first (CLAUDE.md). They must compile only.
- Multiple detached windows, or one detached window per tab — not requested. Follow-up task if needed.
- Artifact editing, export or revision history UI — not requested.

## Requirements

### 1. A — Open always shows the card's artifact

Requirement: chat user — Open and Full screen on any artifact card — the artifact of that card shows.

1. When the producing path is found, the task folder shall record it with file:line evidence.
2. When the user clicks Open on a card whose record bucket differs from the active tab id, the
   display surface shall select and render that artifact, not the "not loaded in this tab" text.
3. When the user clicks Full screen on such a card, the artifact shall show in full screen.
4. When a regression test runs the failing scenario from criterion 2, it shall fail on `main`
   and pass on this branch.
5. When the record truly does not exist (deleted, never loaded, list failed), the surface shall
   show a clear error with a Retry action, and the card shall not claim it can open.

### 2. B — Auto-open on publish

Requirement: chat user — a newly published artifact opens by itself — the user sees it at once.

1. When `ptah_artifact_publish` succeeds in a session and the setting is on, the display surface
   for that session shall open (attached or detached) with the new artifact selected.
2. When the setting is off, publish shall not open or focus the surface; the card and the item
   count shall still update.
3. When the publishing session is not the visible tab, auto-open shall not switch tabs or steal
   focus from the chat input; the artifact shall be selected when the user opens that tab.
4. When the user changes the setting, the new value shall persist across an app restart.
5. When several artifacts publish in one turn, the surface shall show the latest one and keep the others listed.

### 3. C — Card in the reply flow

Requirement: chat user — artifact cards appear at the end of the assistant reply — no need to open tool rows.

1. When a turn publishes one or more artifacts, the reply shall show one card per artifact after
   the turn's final assistant text, in publish order.
2. When the user clicks Open or Full screen on that card, the behaviour shall match section 1.
3. When the session is reloaded or resumed, the reply cards shall render again.
4. When a surface has no display dock (subagent view, CLI lane), the card shall be read-only, as today.

### 4. D — Right sidebar, detachable window

Requirement: chat user — Display tabs (artifacts, turn summary, ptah-ui surfaces) in a sidebar
right of the chat, or in a separate window — the transcript stays visible.

1. When the Display surface is open and attached, it shall render to the right of the chat
   column and shall not cover the transcript or composer.
2. When the user drags the sidebar edge, the width shall change within a minimum and maximum,
   and the width shall persist across restart.
3. When the user collapses the sidebar, the chat shall take the full width, and a visible
   control with the item count shall reopen it. Keyboard and screen-reader access shall remain.
4. When the user clicks Detach in Electron, a separate window shall open with the same Display
   tabs and selection, and the sidebar shall leave the main window.
5. While detached, a new artifact, turn summary or ptah-ui surface, a theme change, and a tab
   switch in the main window shall show in the detached window without a manual refresh.
6. While detached, chat input, streaming, tab switching and other main-window UI shall work as before.
7. When the user clicks Re-attach or closes the detached window, the sidebar shall return to the
   main window with the current selection.
8. When the detached window reopens, it shall use its last bounds; when those bounds are off all
   current displays, it shall open on a visible display.
9. When the app quits, the detached window shall close with no error dialog, orphan process or
   lost settings; when the main window closes, the detached window shall close too.
10. The detached window shall use `contextIsolation: true`, `nodeIntegration: false`,
    `sandbox: true`; every IPC message from it shall pass the same sender validation as
    `ipc-bridge.ts:315`; any preload addition shall be listed and justified in the plan.
11. Artifacts in the detached window shall keep the TASK_2026_710 sandbox and bridge unchanged.
12. When VS Code or CLI receives the detach request, it shall return a "desktop app only"
    result, and the UI shall hide or disable Detach there.
13. Surfaces that host the sheet today (chat view, session embed, canvas, command center) shall
    keep a working Display surface; any change in their layout shall be reported.

### 5. E — Inline preview decision gate

Requirement: product owner — a decision on a lazy, height-capped inline preview — no unbounded renderer memory.

1. The plan shall record the decision (yes or no) with evidence: measured or cited renderer
   memory per live artifact frame, and the TASK_2026_710 "one live viewer" rule
   (`TASK_2026_710_html/implementation-plan.md:165`).
2. When the decision is yes, at most 2 inline previews shall be live at once; older ones shall be
   static cards; each preview shall be height-capped and load only when scrolled into view.
3. When the decision is no, no inline frame shall be added, and the reason shall be in the plan.

## Non-functional requirements

- Security: TASK_2026_710 sandbox kept (script-only iframe, opaque origin, no network, CSP,
  nonce-checked bridge with theme, height and http(s)-allowlisted open-link only).
- Contract: host and UI talk through `libs/shared/src/lib/types/rpc.types.ts` and
  `libs/backend/rpc-handlers`; DI and RPC guard specs updated for each new registration.
- Host capability: the detach window is a port in `libs/backend/platform-core` with an
  Electron adapter; VS Code and CLI adapters return "desktop app only".
- Angular: standalone, OnPush, signals, `inject()`; no `[innerHTML]` with untrusted content.
- Bundle: the display panel stays out of the initial chunk set (`display-sheet.component.ts:5-9`).
- Compatibility: every host (Electron, VS Code, CLI/TUI) typechecks and its tests pass.

## Stakeholders

| Stakeholder | What they need | How they judge it |
| --- | --- | --- |
| Electron chat user | See published artifacts without hunting | Artifact visible after publish; Open never fails |
| Agent author | Publish result reaches the user | Card in reply; auto-open |
| Maintainers | No security regression, hosts compile | Sandbox specs and guard specs pass |

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Fix A patches the symptom, not the scope-id path | MEDIUM | HIGH | Architect records the producing path with evidence before design (criterion 1.1) |
| Second window widens IPC attack surface | MEDIUM | HIGH | Reuse sender validation; review preload diff; security review before push |
| Detached window state drifts from main window | MEDIUM | MEDIUM | Tester covers criterion 4.5 events with specs |
| Layout move breaks canvas/command-center selectors (`canvas-rail-board.component.ts:62`) | MEDIUM | MEDIUM | Architect lists every sheet host; tests run for each |
| Auto-open steals focus mid-typing | LOW | MEDIUM | Criterion 2.3; visual check |

## Visual-review evidence (Electron only)

Screenshots, each in Anubis (dark) and Anubis Light:

1. Sidebar attached on the right, artifact selected, transcript visible.
2. Sidebar collapsed, with the reopen control.
3. Detached window next to the main window, same selection.
4. Auto-open right after a real publish.
5. Artifact card at the end of the assistant reply.
6. Full screen from the reply card (bug A scenario).

## Open questions

- Setting default: assumed ON (the user said "can turn this off"). Reversible; the user can confirm.

## Decisions

- Auto-open default ON. Options: on/off. Evidence: request wording in `context.md` goal B. Reversible.
- One detached window, not per tab. Options: one/per tab. Evidence: request says "a separate window". Reversible.

## Handoff

- Next specialist: software-architect.
- Why: the shape is the question (scope-id path, layout move, window port and sync).
