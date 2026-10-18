# Voice page (Command Center) polish proposal — GLM

Author: GLM lane. Date: 2026-10-18. No code changes; this file is the deliverable.

Scope rule from the user: build on what exists. Keep the radial layout and the motion.
No redesign from scratch. Every idea cites a real component, store, signal or stat.

---

## 1. What exists today

All paths are relative to the repository root. PR #757 files are in the
`.claude-worktrees/command-center-session-start` worktree.

### Canvas scene

| Piece | Where | What it does |
| --- | --- | --- |
| Scene host | `libs/frontend/command-center/src/lib/scene/command-scene.component.ts:94-381` | Owns canvas, DPR (`:174`, `:312`), resize (`:307-316`), reduced-motion media query (`:295-296`, `:322-324`), hover hit-test (`:326-357`), visibility pause (`:318-320`). |
| Palettes | `command-scene.component.ts:31-50` | Seven sphere palettes per theme; provider-to-palette mapping `:52-65`. |
| Renderer | `libs/frontend/command-center/src/lib/scene/command-scene-renderer.ts:33-461` | Snapshot-in pattern `:74-132`; draw loop `:173-332`; starfield `:67-72`, `:187-192`; three orbit ellipses `:193-208`; bezier links `:210-226`; flow particles (max 16) `:239-266`; sprite blit `:267-278`; dashed selection ring `:281-295`; label transforms written only on change `:296-322`; FPS+ms meter `:323-330`; redraw re-arms only while `active` `:331`, `:159-171`. |
| Status art | `command-scene-renderer.ts:334-412` | Per-state arc colors `:342-349` (hardcoded hex), running rotation `:353-356`, awaiting arrow `:366-373`, done/cross glyphs `:374-396`, tribunal phase-progress arc `:397-411`. |
| Voice ring | `command-scene-renderer.ts:414-460` | Color per voice state `:421-430`, dash per state `:432-438`, mic/speaker level pulse `:439-445`. |
| Radial layout | `libs/frontend/command-center/src/lib/scene/scene-layout.ts:57-440` | Orbits `:129-156`, five collision passes `:157-188`, fallback packing `:211-280`, lane satellites `:281-298`, label search `:299-417`, overflow chip `:422-439`, 23-node cap `:107`. |
| Sprite cache | `libs/frontend/command-center/src/lib/scene/sprite-cache.ts:33-229` | Offscreen pre-render once per signature `:98-121`, `:124-227`; glow `:133-148`, face gradient `:149-166`, inner disc `:179-188`, provider brand artwork `:190-218`, monogram fallback `:219-225`; prune `:52-62`; theme switch clears `:65-69`. |

### DOM overlay

`libs/frontend/command-center/src/lib/components/command-overlay.component.ts`:
one plate per node `:40-105` (selection border `:44`), provider marks `:74-81`,
state icon + color `:88-102`; hover/pin card `:111-174`; FloatingUI positioner
`:212-219`, `:268-272`; open/close delays `:29-30`; provider resolution
`:307-320`. Imports `ProviderMarkComponent`, `MonogramTileComponent`,
`PROVIDER_BRAND_SLUGS`, `PROVIDER_MARKS` `:15-21`.

### Work list

`libs/frontend/command-center/src/lib/components/command-work-list.component.ts`:
rows `:39-97` (provider mark `:51-61`, state `:66-87`), live-region announcements
`:36-38`, `:133-145`, arrow-key navigation `:168-190`.

### Side panel (rail)

`libs/frontend/command-center/src/lib/components/command-center-page.component.ts`:
selected-node section `:326-346`, pending-input card `:347-357`, latest reply
`:358-364`, work-list region `:365-377`; grid stage+rail `:52-128`; header
`:132-185` (session badge `:173-176`); stage captions `:222-242`; toast with
`border-l-4` tone accents `:245-291`; dock `:293-318`.

### Composer and voice dock

- Composer: `command-session-controls.component.ts:20-52` (text input + send), buttons `:53-66`, hint `:68-74`.
- Voice dock: `command-voice-hud.component.ts` — mic button `:25-43`, level meter bars `:48-64` (thresholds `:147`), mute/stop/interrupt `:65-89`, error and missing-provider states `:91-131`, title/subtitle `:159-184`.

### Start view (PR #757, open)

`.claude-worktrees/command-center-session-start/libs/frontend/command-center/src/lib/components/command-center-start.component.ts`:
current-session card `:60-81`, session cards `:88-108` (name + relative time only),
`relativeTime` helper `:139-146`, expand toggle `:34-42`.

### State language and data

- `command-state-icon.ts:12-46` — Lucide icon and daisyUI text class per state.
- `command-center.store.ts:91-142` — signals: `sessionStatus :100`, `voiceState :103`, `inputLevel :109`, `outputLevel :112`, `nodes :118`, `selectedId :124`, `provider :133`, `theme :139`, `reducedMotion :142`. `CommandWorkNode` carries `updatedAt` (`:34`).
- `command-center-projection.source.ts` — reads `TabManagerService`, `ChatStore`, `AgentMonitorStore` `:80-83`; provider from `liveModelStats.contextCapacity` or `sessionStats.modelUsageList` `:42-52`; CLI lanes with `task`, `displayName`, `startedAt` `:148-163`; SDK subagents `:164-176`; tribunal runs with lanes and phases `:177-231`.

### Main-chat sources available for reuse

- `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts` — snapshot-only rule `:63-75`; `LiveModelStats` (context percent) `:49-60`; `totalCost :222`, `agentCount :232`, `durationMs :235`, `tokensLabel :238-241`; context label and 70% warning `:182-201`; imports `CostBadgeComponent :16`, `formatCost/formatDuration/formatTokens :33-37`, helpers `agentCountOf`, `durationMsOf`, `sessionContextCue`, `tokenDetailsText` `:40-43`.
- `libs/frontend/chat-ui/src/lib/atoms/cost-badge.component.ts:32-79` — cost chip with "cost unavailable" fallback and the measured `ok-solid-text` ink `:26-30`.
- `libs/frontend/ui/src/lib/native/provider-mark/provider-mark.component.ts:55-120` — mark resolution and sizes.
- `libs/frontend/ui/src/lib/native/brand-mark/monogram-tile.component.ts:15-19`, `:111-139` — fallback tiles.
- `libs/shared/src/lib/types/execution/node.ts:229-251` — `ChatSessionSummary`: `messageCount :235`, `lastActivityAt :239`, `tokenUsage :241`.
- Theme tokens: `apps/ptah-extension-webview/tailwind.config.js` — `anubis :80-148`, `anubis-light :149-222`, state inks `--state-ink-run/need/err/done/idle` `:111-115` and `:189-193`.

---

## 2. Polish ideas

13 ideas. Size: S (≤ a day), M (a few days), L (a week or more). Risk: low / medium / high.

### Group (a) — Canvas visual tweaks

**A1. State-ink colors from the theme tokens**
- User sees: status arcs and the voice ring use the same colors as the work list state text, in both themes.
- Why: today the arcs use hardcoded hex (`command-scene-renderer.ts:342-349`, `:421-430`). The blue `#87b9dc` is not the anubis `info` `#3b82f6`, and the light theme keeps dark-theme values. One color language helps the user map sphere to list row.
- Reuses: `--state-ink-run/need/err/done/idle` tokens (`tailwind.config.js:111-115`, `:189-193`); the renderer already receives `theme` in every snapshot (`command-scene-renderer.ts:16-26`). NEW: one `resolveStateInks()` that reads `getComputedStyle` once per theme change and caches five strings.
- Size: S. Risk: low.
- Performance: see section 3, rule R1.

**A2. Provider-tinted links with direction chevrons**
- User sees: each bezier fades from the parent sphere rim color to the child rim color; a small chevron near the child end points the delegation direction.
- Why: with several lanes all links look identical (`command-scene-renderer.ts:210-226`). Provider color already identifies spheres (`command-scene.component.ts:52-65`); extending it to links makes the graph readable at a glance.
- Reuses: `SCENE_PALETTES` rim values (`command-scene.component.ts:31-50`), `paletteName` mapping `:52-65`, existing bezier math `command-scene-renderer.ts:216-225`. NEW: one `Map` of cached `CanvasGradient` objects, cleared in `setSnapshot`; chevrons are two short strokes.
- Size: M. Risk: low.
- Performance: R2.

**A3. Hover halo on the sphere under the pointer**
- User sees: a thin solid ring appears around the hovered sphere, before the 150 ms card delay opens the plate card (`command-overlay.component.ts:29`).
- Why: today hover gives no canvas feedback until the card opens; the ring confirms the hit target in dense inner orbits.
- Reuses: `hoveredNodeId` already flows to the page (`command-center-page.component.ts:210`); the selection ring drawing (`command-scene-renderer.ts:281-295`) is the pattern. NEW: one input binding page → scene, one field in `SceneRenderSnapshot`.
- Size: S. Risk: low.
- Performance: R3.

**A4. Speaking ripples on the root sphere**
- User sees: while Ptah speaks, one or two faint rings expand from the root sphere and fade, driven by the output level.
- Why: the voice page should feel alive while it talks; today only the thin ring radius moves (`command-scene-renderer.ts:439-458`).
- Reuses: `outputLevel` signal (`command-center.store.ts:112`), `voiceState :103`, ring stroke colors `command-scene-renderer.ts:421-430`; `speaking` already keeps the scene in the continuous `active` redraw state (`:159-171`, `:331`). NEW: two arcs, radius from `root.radius + 16` to `+64`, alpha 0.35 → 0.
- Size: S. Risk: low.
- Performance: R4.

**A5. Elapsed-time arc for running lanes**
- User sees: a faint second arc under the status arc fills clockwise and saturates over five minutes, so a long-running lane reads as "almost full circle".
- Why: voice users cannot watch the rail; a stalled lane needs a glance-level signal. Nodes already carry `updatedAt` (`command-center.store.ts:34`), filled from agent start times (`command-center-projection.source.ts:162`).
- Reuses: the tribunal phase-progress arc proves the geometry (`command-scene-renderer.ts:397-411`); `updatedAt` on `CommandWorkNode` `:34`. NEW: `elapsed = drawTime - updatedAt` mapped to a 0..1 arc at radius + 10, alpha 0.5.
- Size: M. Risk: low.
- Performance: R5.

### Group (b) — Main-chat stats reused on the Voice page

**B1. Session stats chip strip under the stage caption**
- User sees: beside "Live orchestration · status · N nodes" (`command-center-page.component.ts:222-232`) a compact chip row: cost, tokens, agents, session duration — the same four facts as the chat sidebar.
- Why: a voice session runs many turns; the user needs spend and footprint without leaving the page.
- Reuses: the root tab's stats snapshot — the projection source already reads the same tab store (`command-center-projection.source.ts:80-83`, `:89-91`); `CostBadgeComponent` (`cost-badge.component.ts:32-79`) with `totalCost` semantics (`session-stats-summary.component.ts:222`); `formatTokens`, `formatDuration` (`session-stats-summary.component.ts:33-37`); `agentCountOf`, `durationMsOf` (`:40-43`). NEW: one small presentational component in command-center; it renders snapshot values or "—", never derives totals (rule at `session-stats-summary.component.ts:63-75`).
- Size: M. Risk: low — command-center already depends on chat, chat-state, chat-streaming and chat-ui (`command-center-projection.source.ts:1-14`), so the import direction is legal.
- Performance: DOM only, no canvas cost.

**B2. Context-percent chip with the 70% warning**
- User sees: a "context 42%" chip next to the session badge (`command-center-page.component.ts:173-176`); at 70% or more it turns warning-colored; an unknown window shows "context —".
- Why: compaction risk is the main silent failure of long voice sessions; the chat badge already encodes this (`session-stats-summary.component.ts:182-201`).
- Reuses: root tab `liveModelStats` with `contextPercent` (`session-stats-summary.component.ts:49-60`; read pattern `command-center-projection.source.ts:43-44`); threshold and unknown-window suppression `:196-201`. NEW: chip markup only.
- Size: S. Risk: low.

**B3. Rich hover card: task line and last activity**
- User sees: the node card gains the CLI lane's task first line and an "updated 3m ago" line (`command-overlay.component.ts:111-174`).
- Why: today the card repeats what the plate already says; the task text is the one fact the user actually wants.
- Reuses: `agent.task` and `displayName` already flow into the projection (`command-center-projection.source.ts:159-160`); `updatedAt` (`command-center.store.ts:34`); `relativeTime` pattern (`command-center-start.component.ts:139-146`). NEW: two template lines; move `relativeTime` into a shared helper file.
- Size: S. Risk: low. Card fade already respects reduced motion (`command-overlay.component.ts:123`).

### Group (c) — Overlay, work list, side panel polish

**C1. State accent border on plates and work rows**
- User sees: a 3 px left border on each plate and row in the state color, in the same style as the page toast (`command-center-page.component.ts:247-251`).
- Why: state reads peripherally; a voice user glances between turns and should not parse text.
- Reuses: toast `border-l-4` pattern (`command-center-page.component.ts:247-251`); `stateColor` mapping (`command-state-icon.ts:30-46`). NEW: an 8-line `stateBorder` sibling map using daisyUI `border-success`-family utilities.
- Size: S. Risk: low.

**C2. Selected-node panel upgrade**
- User sees: the side panel (`command-center-page.component.ts:326-346`) gains a provider mark, the node task or last activity, and — for the root — the same chips as B1.
- Why: keyboard users live in this panel; today it shows less than the hover card.
- Reuses: `knownProvider` / `providerName` (`command-overlay.component.ts:307-320`), `ProviderMarkComponent` / `MonogramTileComponent` (`:15-21`), B1's chip component. NEW: panel template restructure only.
- Size: M. Risk: medium — must keep the `aria-label="Selected work"` semantics and not disturb the pending-input card above it (`:347-357`).

**C3. Work-list rows: relative time and overflow counts**
- User sees: each row gains "3m ago"; the section header gains the same "+N completed · +N more" counts the canvas chip already computes (`scene-layout.ts:422-439`).
- Why: the rail list is the authoritative list; today it hides the overflow information the canvas shows.
- Reuses: `updatedAt` (`command-center.store.ts:34`), `relativeTime` (`command-center-start.component.ts:139-146`), `overflowCompleted` / `overflowOther` already in `SceneLayout` (`scene-layout.ts:28-37`, `:111-115`); the page already reads the scene layout (`command-center-page.component.ts:429-435`). NEW: one work-list input for the overflow counts.
- Size: S. Risk: low.

### Group (d) — Start view polish (PR #757)

**D1. Session cards with provider mark and activity meter**
- User sees: each card (`command-center-start.component.ts:88-108`) gains a provider mark and a six-bar activity meter sized by recency, in the voice HUD meter's visual language (`command-voice-hud.component.ts:48-64`, `:147`).
- Why: the cards are the first screen a returning voice user sees; today they carry less than a chat tab title. `ChatSessionSummary` already has `messageCount`, `lastActivityAt` and `tokenUsage` (`libs/shared/src/lib/types/execution/node.ts:229-241`).
- Reuses: `ProviderMarkComponent` (`provider-mark.component.ts:66-120`); HUD meter bar pattern (`command-voice-hud.component.ts:48-64`); session fields (`node.ts:235-241`); `MonogramTileComponent` fallback (`monogram-tile.component.ts:111-139`). NEW: provider resolution for a summary — depends on TASK_2026_695 landing provider ids on restored sessions (`context.md:29-30`).
- Size: M. Risk: medium — blocked on TASK_2026_695 for the provider id; the meter works without it.

**D2. Current-session card with live stats chips**
- User sees: the "Current" card (`command-center-start.component.ts:60-81`) shows cost and tokens chips from the live session snapshot, so the user can decide to resume or start fresh.
- Why: resuming a nearly full session is a bad start; the number belongs on the decision point.
- Reuses: `CostBadgeComponent` (`cost-badge.component.ts:32-79`), `formatTokens` (`session-stats-summary.component.ts:33-37`), the same tab-store read as B1. NEW: one input on the start component for the current tab snapshot.
- Size: M. Risk: low.

---

## 3. Canvas performance and quality rules

The renderer already has the right shape: a snapshot-in pattern, an `invalidate()`
gate (`command-scene-renderer.ts:129-132`), continuous redraw only while `active`
(`:331`, `:159-171`), hidden-page pause (`:121-127`), and a built-in FPS + frame-ms
meter (`:323-330`). Every idea below must keep that shape.

- **R1 (A1 token colors).** Resolve the five state inks with `getComputedStyle`
  once per theme change, inside `setSnapshot` or the theme effect in
  `command-scene.component.ts:166-206`. Never resolve inside `draw`. Arcs stay
  live strokes; sprites are untouched. Cost per frame: zero extra.
- **R2 (A2 link gradients).** Build each `CanvasGradient` in `setSnapshot`, keyed
  by `parentId→childId`, cleared on the next snapshot. Per frame the link draw
  only swaps `strokeStyle` for the cached object. Chevrons: two `moveTo/lineTo`
  strokes per link. Node cap is 23 (`scene-layout.ts:107`), so ≤ 22 links. This
  is far below any budget. No dirty-rect needed.
- **R3 (A3 hover halo).** Hover changes call `invalidate()` once; the halo is one
  `arc` stroke per frame while a node is hovered. Hover alone does not set
  `active`, so no continuous loop starts (`command-scene-renderer.ts:159-171`).
  DPR: the transform is already set per frame (`:181-185`); the arc uses CSS
  pixels and inherits it.
- **R4 (A4 ripples).** Ripples draw only while `voiceState === 'speaking'`, which
  already keeps the scene `active` (`:159-171`). Two arcs per frame. Reduced
  motion: skip the ripples entirely; the static ring stays (`:439-445` already
  gates pulse by `reducedMotion`).
- **R5 (A5 elapsed arc).** One extra `arc` stroke per running node per frame.
  A running node already keeps the scene `active` (`:167-170`). The elapsed value
  comes from the draw timestamp — no timer, no extra invalidations. Guard the
  optional `updatedAt` (`command-center.store.ts:34`). Reduced motion: the arc is
  informational, not animated motion; keep it, and it fills by wall-clock state.
- **Sprite caching.** All sphere art stays in `SpriteCache` — pre-rendered once
  per (theme, palette, size, dpr, slug) signature (`sprite-cache.ts:98-121`), on
  an offscreen canvas (`:124-227`), pruned on node exit (`:52-62`). No idea in
  this proposal adds per-frame sprite work. New static art must follow the class
  comment: prepared once per snapshot, never assembled in the render loop
  (`sprite-cache.ts:32`).
- **Frame skipping.** Keep the `invalidate` + `active` gate exactly as is. Any new
  effect may draw only inside `draw`; none may install its own
  `requestAnimationFrame` loop.
- **Dirty rect.** Not used, on purpose. The frame is one full clear (`:186`) plus
  starfield, three orbits, ≤ 22 links, ≤ 23 sprite blits and a few dozen strokes.
  That is well under 2 ms measured by the meter (`:323-330`); a dirty-rect system
  would cost more in complexity than it saves. See "Not recommended".
- **DPR.** Canvas pixels = CSS size × dpr capped at 2, set only in `resize`
  (`command-scene.component.ts:307-316`); sprites bake at the same capped dpr
  (`sprite-cache.ts:86`, `:125-131`). All new strokes use CSS-pixel coordinates
  under the per-frame transform (`command-scene-renderer.ts:181-185`); never
  multiply by dpr in drawing code.
- **Frame budget.** Target: keep the measured frame time under 2 ms at the
  23-node cap, so the 16.6 ms frame budget still holds with the DOM overlay
  above. The meter already reports FPS and ms (`:323-330`); wire it during review
  (the renderer exposes `setMeter :117-119`).
- **No layout thrash.** Canvas-side label positions are written as
  `translate3d` strings only when they change (`:296-322`). New DOM (chips, card
  lines) binds to signals only; the page already measures overlay labels in
  `afterEveryRender` (`command-center-page.component.ts:505-540`) and that path
  must not gain per-frame reads.

---

## 4. Dark and light theme notes

- Tokens only. Every new color comes from the daisyUI themes: state inks
  `--state-ink-run/need/err/done/idle` (`tailwind.config.js:111-115` dark,
  `:189-193` light), `success/warning/error/info` pairs (`:122-136`, `:197-210`),
  surfaces `base-100/200/300` (`:102-104`, `:180-182`). No new hex values enter
  the CSS; the only new hex removal is A1 deleting the renderer's hardcoded arc
  colors in favor of the tokens.
- Canvas neutrals (starfield `:187`, orbit stroke `:193`, link stroke `:210`) keep
  their per-theme pairs today; A2 replaces the link stroke with palette gradients,
  so links inherit the theme-paired palettes (`command-scene.component.ts:31-50`)
  instead of a fixed hex. The orbit and starfield neutrals stay as they are.
- Contrast: plate text is `base-content` on `bg-base-100/95`
  (`command-overlay.component.ts:43`), which holds in both themes. The state text
  classes reused from `command-state-icon.ts:30-46` are the same classes the work
  list already ships, so their contrast is unchanged. The cost chip must be reused
  as-is: its `ok-solid-text` ink exists because the stock pairing measured 2.64:1
  on `anubis` success (`cost-badge.component.ts:26-30`); restyling it would
  reintroduce that failure.
- The light theme is the risk case for canvas alphas: A4 ripple alpha 0.35 on the
  cream base (`tailwind.config.js:180`) must stay ≥ 3:1 against `base-200` or be
  raised; the A5 elapsed arc at alpha 0.5 uses the token ink, which is
  contrast-safe by construction (`:189-193`).
- `darkTheme: 'anubis'` (`tailwind.config.js:241`) means the renderer's `theme`
  input must continue to come from the store signal (`command-center.store.ts:139`);
  no canvas code may read the theme attribute itself.

---

## 5. Phased plan

### Phase 1 — quick wins (all S, low risk)

1. A1 token state inks — `command-scene-renderer.ts`, `command-scene.component.ts`.
2. A3 hover halo — `command-scene-renderer.ts`, `command-scene.component.ts`, `command-center-page.component.ts`.
3. B2 context chip — `command-center-page.component.ts` (+ controller read of the root tab).
4. C1 state accent borders — `command-overlay.component.ts`, `command-work-list.component.ts`, `command-state-icon.ts`.
5. C3 row time + overflow counts — `command-work-list.component.ts`, `command-center-page.component.ts`.
6. B3 card task + last activity — `command-overlay.component.ts`, shared `relativeTime` helper.

### Phase 2 — the visible canvas upgrade

1. A2 link gradients + chevrons — `command-scene-renderer.ts`, `command-scene.component.ts`.
2. A4 speaking ripples — `command-scene-renderer.ts`.
3. B1 stats chip strip — new `command-session-stats` component in `components/`, wired in `command-center-page.component.ts` and the controller.
4. C2 selected-node panel upgrade — `command-center-page.component.ts`.
5. D1 start cards (meter part works now; provider mark lands with TASK_2026_695) — `command-center-start.component.ts` (PR #757 worktree).

### Phase 3 — depth

1. A5 elapsed arcs — `command-scene-renderer.ts` (data already flows; no model change).
2. D2 current-card stats — `command-center-start.component.ts` (PR #757 worktree).
3. Wire the renderer FPS meter for the review checklist — `command-scene-renderer.ts`, `command-center-page.component.ts`.

No file in `scene/` changes its public contract except `SceneRenderSnapshot`
gaining `hoveredId` (A3). `scene-layout.ts` is not modified by any idea.

---

## Decisions

- **Canvas colors come from theme tokens, resolved at snapshot time.** Options:
  keep hardcoded hex (free, but wrong in `anubis-light` and off-brand in `anubis`)
  vs resolve CSS variables per theme change. Evidence: the state-ink tokens exist
  for exactly this (`tailwind.config.js:111-115`) and the DOM state classes already
  use them (`command-state-icon.ts:30-46`). Reversible: yes, one function.
- **Reuse `CostBadgeComponent` and the summary helpers instead of new formatting.**
  Evidence: `formatUsdCost`, `formatTokens`, `formatDuration` are shared
  single-sources (`cost-badge.component.ts:7`, `session-stats-summary.component.ts:33-43`),
  and the summary's "never derive totals" rule (`:63-75`) prevents the voice page
  from inventing numbers the chat page contradicts. Reversible: yes.
- **No dirty-rect engine.** The scene redraws only while `active`
  (`command-scene-renderer.ts:159-171`, `:331`) and the node cap is 23
  (`scene-layout.ts:107`). A measured budget under 2 ms makes the complexity a
  net loss. Reversible: yes, but expensive to unwind.
- **Hover feedback is canvas-drawn, not a DOM clone.** The hit-test path already
  emits `hoveredNodeId` (`command-scene.component.ts:326-363`); drawing one ring
  costs one stroke, while a DOM clone would add measurement and FloatingUI work.
  Reversible: yes.
- **`relativeTime` moves to a shared helper** rather than being copied into the
  overlay and work list. Evidence: it already exists in the start component
  (`command-center-start.component.ts:139-146`) and three surfaces now need it.
  Reversible: yes.

## Not recommended

- **Importing `DashboardSparklineComponent` into command-center.** It lives in
  `declarative-dashboard` (`dashboard-sparkline.component.ts:10-16`) and reads
  `--dp-*` variables that only exist inside a dashboard renderer root; the
  dependency direction is also wrong for a page-level import. The D1 meter reuses
  the voice HUD bar pattern instead, which is already on this page.
- **Dirty-rect rendering.** See the decision above; no measured need.
- **WebGL, PixiJS, or a physics layout.** Violates the user's rule: keep the radial
  layout and motion, no new framework. TASK_2026_689 was reverted for less
  (`context.md:14-15`).
- **Moving node labels into the canvas.** DOM plates carry focus, ARIA and the
  FloatingUI card anchor (`command-overlay.component.ts:40-105`); canvas text
  would drop keyboard and screen-reader access for a marginal visual gain.
- **Per-model cost breakdown on the Voice page.** `SessionModelBreakdownComponent`
  is right for the chat sidebar and too dense for a glance surface; keep the four
  summary chips (B1) instead.
- **Auto-narrating stats over TTS.** The voice loop has a status narrator
  (`voice/status-narrator.ts`); reading cost or context numbers unprompted would
  add noise to every turn. Stats stay visual; narration stays on state changes.

---

*End of proposal. No repository files were modified; this document is the only
file written.*