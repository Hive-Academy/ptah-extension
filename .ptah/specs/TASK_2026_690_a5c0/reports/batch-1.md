# Batch 1 — Height and centering

## Changed files

- `libs/frontend/chat/src/lib/components/templates/chat-session-layout.component.ts:4`: new standalone, OnPush flex layout with projection slots and the shared 758px content-width token. Default projection retains the header and other ChatView-owned children; named slots preserve the transcript, controls and composer order.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:36,206`: import and render the layout component. Line count remains unchanged.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:5,25,100,127,270`: clip the main flex column, project the existing transcript and controls, center the controls, and keep the composer in normal flow. The transcript `@for` and ChatView's view queries remain in ChatView's template.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.css:65`: remove duplicate transcript scroll geometry from the parent component; the transcript owns that rule under Angular style encapsulation.
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.css:36,45,54`: replace the scroller's competing `height: 100%` with `flex: 1 1 0%`; center transcript content with the shared width token and override the nested answer's 600px cap within this transcript.
- `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts:543,583,852`: use the shared width token for the composer card and status row.
- `libs/frontend/chat/src/lib/components/templates/chat-session-layout.component.spec.ts:1`: projection, parent view-query/loop, and host geometry contract specs.

## Height chain

Before: Electron shell `h-screen` → app host `flex-1 min-h-0 overflow-hidden` → app content `flex-1 overflow-hidden` → chat host `height:100%` → main chat column `flex-1` without `min-h-0` → session wrapper `flex-1 min-h-0` → transcript wrapper and host `flex-1 min-h-0` → transcript scroller `flex-1` plus `height:100%` → composer `flex-shrink-0`. The 100% scroller height competed with the composer for the session height.

After: The app chain and chat host stay bounded as above. The main chat column is `flex-1 min-h-0 overflow-hidden`; the projected session layout is `flex:1 1 0%`, `min-height:0`, `overflow:hidden`; the transcript wrapper is `flex-1 min-h-0 overflow-hidden`; the transcript host remains `flex-1 min-h-0`; its original scroller node is `flex:1 1 0%`, `min-height:0`, `overflow-y:auto`, with no fixed or percentage height. Controls and composer are normal-flow flex siblings below it. The existing `ptahPaneSwitchEnter` binding, prepend anchor and `#messageContainer` remain on that same scroller element.

The width token is 758px. At a 1440px chat width, the transcript and composer columns cap at 758px and center. At 760px, each uses the available width minus 24px of symmetric side space (736px). The answer is limited by the transcript column instead of its nested 600px class.

`app-shell.component.html` was left unchanged. Its active content already has `overflow-hidden` (`:804`) and the chat wrapper has `h-full` (`:835`); the audit's proposed `min-h-0` additions are conditional under review note N3. Source inspection alone does not prove overflow there, and no running-app measurement was available. The Electron right DISPLAY rail remains for Batch 4.

## Line counts

`wc -l` equivalent (physical lines): `chat-view.component.ts` **2080 → 2080**; `chat-transcript.component.ts` **1376 → 1376**. The latter was not edited.

## Verification and DOM measurements for orchestrator

Specs added but not run, per lane instruction. Scoped `ptah_get_diagnostics` found no errors in requested changed TypeScript files; it reported 266 diagnostics in sibling files. No tests, build, lint, typecheck command, app launch or rendered measurement was run.

In the running app, measure normal chat at 1440px and 760px widths with short/long transcripts and a multiline composer:

1. `document.scrollingElement`, `body`, Electron app host, app main/content/chat wrapper, `ptah-chat-view`, `.cs-shell`, its main column, and `ptah-chat-session-layout`: record `clientHeight`, `scrollHeight`, computed `height`, `minHeight`, `overflowY`, and bounding `top/bottom`. Confirm no ancestor becomes the transcript's vertical scroll owner. If app main/content overflows, revisit N3 with that measurement.
2. `[sessionTranscript]`, `ptah-chat-transcript`, `[data-testid="chat-transcript-scroller"]`, `[sessionControls]`, `[sessionComposer]`, and `[data-testid="chat-composer"]`: record `clientHeight`, `scrollHeight`, `scrollTop`, computed `flex`, `minHeight`, `height`, `overflowY`, and bounds. Confirm only the transcript scroller has `scrollHeight > clientHeight` for a long transcript, and the composer bottom meets the session layout bottom without an empty region. The editable textarea may scroll internally.
3. `.chat-scroll-content`, `.cs-answer`, composer card `.chat-composer-column`, and composer status `.chat-composer-column`: record left/right bounds and computed `maxWidth`; check matching centered column edges at 1440px and 760px. Account for inner bubble padding when comparing answer text edges.
4. Switch sessions with different transcript lengths: confirm `[data-testid="chat-transcript-scroller"]` retains the `ptah-pane-switch-enter` class on entrance, the same scroll element hosts the prepend directive, and first-frame restored `scrollTop` matches the saved reading position. Check reduced-motion mode as well.

## Decisions

- **Projection slots:** use default plus named `<ng-content>` slots, keeping ChatView's content and queries in its own view. Rendering children inside the layout component would sever those queries. Evidence: review note N4 and existing ChatView template/query ownership. Reversible.
- **App shell:** defer its `min-h-0` change until a rendered measurement demonstrates overflow. Evidence: app content clipping and review note N3. Reversible.
- **Shared width:** define one 758px variable on the session layout and consume it in transcript and composer styling; the existing 600px answer cap is overridden inside the transcript. Evidence: prior 758px composer and 600px answer declarations, and the plan's shared-width requirement. Reversible.
