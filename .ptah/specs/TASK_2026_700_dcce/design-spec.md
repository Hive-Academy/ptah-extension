# Command Center Voice â€” visual specification

## Basis and gate

The approved TASK_2026_678_9083 Command Center prototype supplies the composition, sphere language, warm stage, rail and dock. The authoritative app colors are `apps/ptah-extension-webview/tailwind.config.js` themes `anubis` and `anubis-light`; fonts are from `apps/ptah-extension-webview/src/styles.css`. `parity-inventory.md` is the capability contract. The prototype in this task folder is for Gate 1.7 user approval before production implementation. These screens show presentation and representative interactions; they do not simulate RPC persistence, input audio, or permission handling.

## Layout

At 1440 x 900, use 22px horizontal gutters, a 78px header, a 16px deck gap and a 336px rail. The stage has a 600px minimum height and 16px radius. The dock is one integrated bar 14px below the stage. At 900px, use a 260px rail and 570px stage. At 720px, place the rail below the stage and dock. At 480px, use a 500px stage, two-column stats and one-column recent cards. The 480px capture is a stress case below the Electron window's supported 800px minimum width (`apps/ptah-electron/src/windows/main-window.ts:119`); retain its plate clamping and edge clearance. The title remains on one line. Values: approved TASK_2026_678 composition, app theme tokens, and prototype responsive rules.

The dock has three rows at 900px: mic/title with waveform beside the status text only while speaking; Mute/Stop/Status/Resume last; then a full-width command field. At 720px and below it has four rows: mic/title with speaking waveform; Mute/Stop/Status; full-width command field; full-width Resume last/Start new. The field never shrinks to a fragment. The voice speaker meter appears only while speaking. Source: prototype responsive dock and live voice state.

The stage reserves an opaque header band: 72px at widths of at least 1100px, with caption and four stats cells on one row; 144px below 1100px; and 154px at 480px, with caption and stats on two rows. The scene rectangle starts at band bottom + 10px, so stats cannot cover nodes. Keep the approved sphere size and position by centering it in that rectangle. Cost and token wording retains the live provisional/known-subtotal semantics. The root plate adds the context ring; the foot holds selection guidance and overflow counts. Source: approved 678 render, prototype scene bounds, and live session stats.

The rail places selected work first, pending action/question/Tribunal next when present, and delegated work last. Child-session rows sit at the root level and indent their owned lanes, agents and Tribunal groups beneath them according to parentSessionId ownership. A persisted child without a live tab remains a selectable row with unknown state and no fabricated provider or freshness. At widths above 720px, the grid stretches the rail to the combined stage and dock height. The upper cards keep natural height. Delegated Work is flex: 1 1 auto; min-height: 0; overflow-y: auto. Show no scrollbar or cue when rows fit; when they clip, show a scroll cue and fade the visible last row. Below 720px the rail follows the stage and dock at natural height. Empty work uses the existing guidance. Source: prototype CSS and review S1.

The header holds the Ptah tile, serif title, session pill, context warning, provider chip, Voice settings and theme action. The session pill shows Session plus the first eight sessionId characters or new; status is separate. Header context chip and Ptah root plate both read the same contextCue() value from current marked tab liveModelStats. If unknown, both show "Context unknown" and the plate has no ring. At 70% or above, both show the warning cue. Preview and Demo are prototype-only and hidden in final-look captures. Source: command-center-page.component.ts contextCue() and approved prototype.

The start view renders the current session once, before the recent grid; exclude coordinator.currentSessionId from recent cards. The current card uses currentStats()?.totalCost (or knownSubtotalOf(currentStats()) when totalCost is unavailable), currentStats()?.tokenCount, messages and relative activity; show provisional and known-subtotal wording as the live start component does. Recent cards use ChatSessionSummary: provider mark/fallback, name, updated time for valid lastActivityAt, message/token figures, Active only when isActive, and the livePhase wording when present: generating, awaiting background, sleeping, idle or failed. No progress or age bars. Only the card matching recordedSessionId gets the Command Center mark. History unavailable appears per card only when hasTranscript is false. Retry session list appears only after session:list fails. Unknown providers use a monogram and raw provider id. Sources: ChatSessionSummary, command-center-start.component.ts currentCost/cardFigures/phaseLabel, and prototype.

## Tokens and source

| Role | Dark `anubis` | Light `anubis-light` | Source |
| --- | --- | --- | --- |
| Page `base-100` | `#131317` | `oklch(97.788% 0.004 56.375)` | Tailwind theme |
| Card `base-200` | `#1a1a20` | `oklch(93.982% 0.007 61.449)` | Tailwind theme |
| Stage `base-300` | `#242430` | `oklch(91.586% 0.006 53.44)` | Tailwind theme |
| Primary ink `base-content` | `#e8e6e1` | `oklch(23.574% 0.066 313.189)` | Tailwind theme |
| Secondary ink `--bcm` | `66.509856% 0.007403 31.090978` | `48.955188% 0.044796 348.478612` | Tailwind theme |
| Brand gold `secondary` | `#d4af37` | `oklch(58% 0.132 75)` | Tailwind theme |
| Small-label gold `secondary-focus` | `#92400e` is for focus fills; use `secondary` on dark | `oklch(50% 0.12 72)` | Tailwind theme; light text contrast adjustment |
| Running `--state-ink-run` | `#3b82f6` | `#2a56c6` | Tailwind theme |
| Awaiting `--state-ink-need` | `#f97316` | `#8f5200` | Tailwind theme |
| Failed `--state-ink-err` | `#ef4444` | `#b4232a` | Tailwind theme |
| Completed `--state-ink-done` | `#16a34a` | `#13713a` | Tailwind theme |
| Stopped/idle `--state-ink-idle` | `#9ca3af` | `#6b6570` | Tailwind theme |
| Focus | `#69b3ff` | `#2a56c6` | Approved 678 prototype |

Panel border is the approved 678 `--border` (`#d4af3730` dark, `#6a627044` light). Stage edge glow, dotted halo, bevel and shadows remain from that prototype. Do not use `text-base-content/NN` for text. In production, use the app's `text-base-content-muted` tier and keep state hue on icons, rings and borders when text contrast is insufficient.

## Typography and component grammar

Use Cinzel 600 at 20px for the header and 500 at 28px for the selected-work name; the start title is 28px. Inter 12â€“13px carries body and controls. JetBrains Mono 10â€“11px carries eyebrow, section labels, badges, stats and metadata. Sources: `styles.css`, `docs/design-system/ptah-content-brand.md`, and the approved prototype. Buttons use the app's ghost/outline secondary pattern; the pending Approve or start-view New session is the one primary action in its surface. Status is an action because it sends a status turn; current state remains a badge. The pending action card uses a separate warm border and stays legible above the list.

## Icon assignments

Use `lucide-angular` equivalents with decorative instances `aria-hidden`, matching the Chat/Tribunal pattern of icon plus label. The glyph paths in the standalone prototype represent these Lucide names.

| Element | Lucide icon |
| --- | --- |
| Voice provider/settings/theme | `AudioLines`, `Settings`, `Sun` / `Moon` |
| Mic, mute, speaker, stop | `Mic`, `MicOff`, `Volume2`, `Square` |
| Command send, Status, New, Resume, sessions | `Send`, `Activity`, `Plus`, `Play`, `History` |
| Ptah plate, CLI lane, Tribunal, child session | `Sparkles`, `Terminal`, `Shield`, provider artwork or monogram |
| Running, awaiting, completed, failed, stopped | `LoaderCircle`, `Diamond`, `Check`, `X`, `Slash` |
| Cost, tokens, agents, duration/context | `Coins`, `Hash`, `Bot`, `Clock3` / `CircleGauge` |
| Pending tool, question, close/retry | `ShieldAlert`, `MessageCircleQuestion`, `X` / `RotateCcw` |

Provider labels come from the node provider field. Known IDs use their registered provider artwork and label; an unknown ID uses a monogram and the raw ID without an inferred vendor name. Tribunal satellites carry Builder, Challenger and Judge role chips. New provider registrations are required for CircleGauge, Clock3, Coins, Diamond, MicOff, Bot, Sparkles, Terminal, Shield, Activity, Play, Send, Plus, Square, Check and X. AudioLines, History, LoaderCircle, MessageCircleQuestion, RotateCcw, ShieldAlert, Slash, Volume2 and Hash already appear in the app icon provider; verify the provider registry when implementing.

## Canvas 2D scene grammar

Keep the radial root/delegated/phase graph. Ptah is the gold sphere with a bright outer ring and dotted voice halo; the `Ptah Â· HEAD OF ENGINEERING` DOM plate sits below it. Root context is an additional small semantic ring at the plate when verified. Lanes use colored state rings, running elapsed arcs, and cached provider-mark sprites; Tribunal satellites retain their role chips. Orbital curves and an inner edge glow join the panel to the app's cards. Dense scenes hide nonessential plates and show `Off canvas: N completed Â· N other`; the complete list remains in the rail. Resolve CSS inks once on theme change, cache sphere sprites and gradients, cap canvas DPR at 2, request animation frames only during voice, running, hover or transitions, and stop on hidden tab. Reduced motion freezes rotation, pulsing, state-icon spin and hover-card transitions while leaving states and hit areas visible. In the real layoutScene, accept a scene rectangle with top equal to the reserved header band plus 10â€“20px clearance and bottom equal to stage height minus 62px for the foot. Place the root at the rectangle midpoint. Clamp both radial axes against its available half height/width. Clamp DOM plate tops to scene top + 6px and horizontal edges to at least 8px from the canvas edge. Place the Ptah plate directly below its sphere and keep 12px between plates. At 480px, reserve 164px from the stage top for the two-row stats band and 10px clearance. Apply these bounds before dense-node packing and overflow counts, including the 24-node case. The existing renderer at `scene/command-scene-renderer.ts` is the implementation baseline. The live `scene/command-scene.component.ts` has pointer move/leave and selection but no drag-to-tilt handler, so drag-to-tilt and FPS readout from 678 are absent here.

A child session is a 58px silver sphere, matching the live scene child diameter and palette in `scene/command-scene.component.ts`: dark lit/mid/dark/rim `#e8e6f0/#898ba5/#41445d/#f1eff8`, light `#fafaff/#c4c5d2/#777a91/#9c9eb2`. Its second thin silver ring distinguishes it from a CLI lane; a dashed 70px orbit carries its owned lane satellites, with edges terminating at the child rather than Ptah. The 70px orbit follows the Tribunal satellite spacing pattern in `scene/scene-layout.ts`; the child remains in the root orbit. Plates show `label`, its own `providerId` artwork or monogram when known, and `state`. Persisted children with no live tab use the projected "Child session" fallback, "Provider unknown," unknown state, a dashed silver ring and no live-tab cue. Name/provider/state are from `work-projection.ts:108-190`; ownership follows parentSessionId. This child-owned orbital grouping and rail nesting are presentation changes to the current root-orbit/flat-list renderer.

## Interaction and accessibility

Canvas stays `aria-hidden`; DOM plates and the delegated list expose equivalent names, states, counts and selection. Plate Enter/Space pins a card, Escape dismisses it, and the delegated list keeps Arrow Up/Down wrap, Enter selection, roving tabindex and focus restoration. Hover preview opens after 150ms and closes after 200ms, retaining the bridge to the card. Child selection is available from its sphere, plate and Delegated Work row, with the same keyboard selection as other nodes. The selected card shows label, state, provider when known, `updatedAt` freshness when available, and child session statistics only when the live tab supplies them; a live `tabId` permits the informational "Live tab available" line, while no `tabId` reads "No live tab." There is no child tab open/focus control in the current Command Center page, node detail, or work list, so the prototype shows no such button. Pending actions use explicit native buttons. Tribunal Confirm requires focused click/Enter/Space and never accepts a voice affirmative or an ordinary question answer. An assertive pending announcement is separate from one polite delegated-state/status live region. Dock mic and speaker meters expose labels and numeric values; speaker meter appears only while speaking. The prototype is a static illustration of those paths; implementation must preserve the existing guards, retry semantics and state ownership in the parity inventory.

## Contrast checks

WCAG AA normal and 10px mono text target 4.5:1; state graphics and control boundaries target 3:1. Chromium measurements on the composed backgrounds use prototype/check-revision-contrast.js. Dark/light ratios: root plate metadata and context 11.98/13.57, lane plate metadata 13.89/14.21, Off canvas chip 13.89/14.21, rail eyebrow on translucent card 8.32/5.43, rail detail metadata 14.03/14.99, delegated-row metadata 14.03/14.99, and 9px stat labels 13.89/14.21. Approve text on its fill measures 8.80/6.15. Light small gold eyebrow text uses secondary-focus instead of secondary; rail labels use that token, while light Approve uses white text on its measured dark-gold fill. State rings/icons on stage measure dark/light: running 4.17/5.03, awaiting 5.47/4.83, failed 4.07/5.07, completed 4.65/4.73 and stopped 6.04/4.38 against the stage. The new child plate metadata and unknown child plate metadata both measure 13.89/14.21 dark/light; the selected child live-tab line measures 14.03/14.99. The unknown plate keeps full-opacity text; the sphere alone is dimmed. These meet the 4.5:1 text criterion. The silver ring uses #898ba5 on the dark stage and #777a91 on the light stage, measuring 4.60/3.28 against the stage; it meets the 3:1 non-text criterion. State and name are also given as text. Recheck hover and disabled surfaces in production after exact theme composition.

## Parity mapping

Every inventory capability remains in scope. Rows below follow `parity-inventory.md` order.

| # | Capability in inventory | New location / behavior |
| --- | --- | --- |
| 1 | Breadcrumb and title | Header brand tile, eyebrow and Cinzel title |
| 2 | Voice/provider chip | Header provider pill with both model names, readiness, settings action and accessible label |
| 3 | Session chip | Header session pill with short ID/new and live status |
| 4 | Context chip/warning/ring | Header verified context pill, orange cue at 70%; root plate ring |
| 5 | Voice settings and denied mic recovery | Header Settings button and recovery toast/status |
| 6 | Dismissible toasts and retries | Stage toast layer above canvas, outside dock; close and Retry speech/Decline controls in live UI |
| 7 | Start new/all/recent switch | Start hero actions and recent-session section |
| 8 | Current session card | Left start card with currentStats()?.totalCost or knownSubtotalOf(currentStats()), tokenCount, messages and activity; Command Center mark only if this ID matches recordedSessionId |
| 9 | Recent session cards | Right start grid excluding currentSessionId; mark/monogram, updated time, figures, isActive/livePhase when present, Command Center only on matching recordedSessionId; per-card history note only when hasTranscript is false; no age bars |
| 10 | Start loading/empty/error/restore | Start grid loading/empty/error state slot; Retry only after session:list failure; disable restore actions while switching |
| 11 | Stage caption/counts/hint | Stage header live caption and stage foot selection hint; node/running/waiting counts in caption |
| 12 | Stats strip | Four cells in reserved header band, preserving provisional/known-subtotal labels and clearing the scene rectangle |
| 13 | Canvas radial graph/theme/halo | Framed stage Canvas 2D under DOM overlay; silver child spheres stay on the root orbit and own satellite orbits for their projected work |
| 14 | Canvas click and hover | Sphere hit targets; click selects, pointer hover opens one detail |
| 15 | Accessible node plates | DOM overlay plates with provider/fallback, icon, edge and selection; child plates use their own provider and state, with "Provider unknown" only when absent |
| 16 | Hover preview timing | DOM hover card/bridge at 150ms open and 200ms close; Escape |
| 17 | Pinned detail/focus restore | Rail selected card and overlay card close; return focus to plate/list row |
| 18 | Overflow counts | Stage foot off-canvas chip plus delegated-list count line |
| 19 | Canvas unavailable fallback | Rail and dock remain; list-only guidance in stage slot |
| 20 | Selected-work details | First rail card: serif name, badge and available projection/provider, task, elapsed, phase, freshness and child figures; child shows live-tab availability only when tabId exists and "No live tab" otherwise; root omits repeated body; Task appears only when it differs from subtitle |
| 21 | Delegated-work list | Scrollable third rail card stretches into remaining stage-plus-dock height; all non-root nodes, marks, state icons, freshness and count, with child-owned nodes nested under each child. Scroll cue and last-row fade appear only when rows clip |
| 22 | Delegated keyboard navigation | Same list rows with Arrow Up/Down wrap, Enter, roving tab and `aria-current` |
| 23 | Empty guidance/off-canvas line | Delegated card empty copy and count footer |
| 24 | Pending compact cue/scroll | Pending cue near stage/dock edge at narrow widths; scroll card into view |
| 25 | Tool permission | Warm action-required rail card with scoped title, description and explicit Approve/Deny |
| 26 | Ordinary question | Same rail card variant with choices, typed answer, Submit, rejection and timeout state |
| 27 | Permission priority/scoping | Single pending-card slot; permission precedes question/roster; root-session copy |
| 28 | Tribunal roster | Pending-card variant with mode, rounds, objective, lanes, roles, Confirm/Decline |
| 29 | Tribunal confirm guard | Explicit focused Confirm button only; no voice/ordinary answer route |
| 30 | Tribunal decline/timeout/retry | Same pending card plus toast/retry action; invalid proposals disable Confirm |
| 31 | Typed command | Integrated dock field and Send, empty/in-flight guard and retained draft on failure |
| 32 | Start new and Status | Dock actions; Status can reopen from start view before sending |
| 33 | Mic/mute/stop/interrupt | Dock mic tile, Mute/Unmute and Stop button with speaking interrupt state |
| 34 | Mic/speaker meters | Dock waveform and numeric accessible meters; speaker only while speaking |
| 35 | Voice recovery states | Dock title/subtitle, provider pill and header recovery for all listed capture/provider states |
| 36 | Status and Tribunal guidance | Dock support line under command field and Status action response |
| 37 | Safe replies/failures | Stage toast or rail notice with safe fixed text and available Retry |
| 38 | Live announcements | One polite region for delegated transitions and session status, including child starting/running/completed/failed transitions from status-narrator.ts; assertive pending card |
| 39 | Reduced motion | CSS and scene motion gates for spin, hover and canvas animation |

## Proposed additions

| Addition for approval | Current behavior | Reason |
| --- | --- | --- |
| Open or focus a child session tab from the selected card when `tabId` exists | Child node selection only sets Command Center selection; no child tab action is rendered in the page, node detail or work list | `work-projection.ts` already projects `tabId`, but a new button and coordinator route would need product approval; omit the control when `tabId` is absent |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep 678 radial visual grammar | Replace scene / adapt approved scene | User chose the approved renders; context.md | Yes |
| Reserve a stage-header band for stats | Overlay / reserved band | Narrow and 24-node review captures showed overlay collisions | Yes |
| Use a full start view | Start overlay / own view | Parity inventory requires all/recent/current cards | Yes |
| Use darker light gold for small labels | Brand secondary / secondary-focus | Measured secondary at 3.67:1 on card; theme provides focus value | Yes |
| Remove drag hint and FPS | Keep as prototype-only / remove | `command-scene.component.ts` has no drag handling or FPS UI | Yes |
| Keep Status as a button | Badge / button | Live action sends a status turn per parity inventory | Yes |

## Deviations from the target renders

- The start view is new because the approved 678 renders begin inside a session while the real page has new, current and recent session flows.
- The header has context, Voice settings and warning affordances because the live page exposes them; the 70% cue needs a visible position.
- The stage header holds cost, tokens, agents and duration because they are existing live data and should share the frame with the scene.
- The dock adds Status and a speaker meter because both are live capabilities; speaker meter is visible only while speaking.
- The 678 FPS and drag-to-tilt text are removed because the real Canvas 2D component does not implement them.
- Exact color values and fonts follow the app themes and typography; the light gold label becomes darker to meet AA.

## Lane-introduced constraints

None. All behavior constraints above derive from the project, user request or parity inventory.

