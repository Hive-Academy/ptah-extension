# Voice page polish proposal (grok)

Build on the radial 2D canvas, the DOM plate, and the chat stats that already exist. No new scene framework, no new layout, no new color system. Design system applied: daisyUI themes `anubis` and `anubis-light` in `apps/ptah-extension-webview/tailwind.config.js` (lines 80–221). Contrast criterion: WCAG 2.2 AA — text 1.4.3 at 4.5:1, non-text state graphics 1.4.11 at 3:1. Ratios below were computed from sRGB relative luminance against the stage fills named in that file. Decorative orbits are exempt from 1.4.11 and are called out as such.

This file is a proposal. It does not authorize implementation, and it does not replace Gate 1.7.

## 1. What exists today

**Canvas scene.** `ptah-command-scene` (`libs/frontend/command-center/src/lib/scene/command-scene.component.ts:67–92`) hosts one `<canvas>` plus an overflow chip. Palettes are eight named gradients per theme (`31–50`). `paletteName` (`52–65`) maps root and tribunal to gold, lanes/phases/children to silver, and provider ids to teal, plum, red, jade, or blue. Sprites are built off-thread of the frame loop by `SpriteCache.get` (`sprite-cache.ts:64–228`): radial face, rim, inner disc, root monogram `P`, tribunal shield, or `PROVIDER_BRAND_ART` paths. DPR is clamped to 1–2 (`sprite-cache.ts:86`, `command-scene.component.ts:312`, `command-scene-renderer.ts:181–184`). `layoutScene` (`scene-layout.ts:57–157`) keeps a radial layout: root at `(0.5w, 0.485h)`, radius 62 or 77, delegates on ellipses `0.235/0.225` and `0.405/0.365` or `0.425/0.385`, at most 23 non-root nodes (`107`). `CommandSceneRenderer.draw` (`command-scene-renderer.ts:173–332`) paints, in order, 48 static dots, 3 orbit ellipses, parent bezier links, at most 16 gold particles on running edges, cached sprites, a live state arc, a root voice ring, and a dashed selection ring. The rAF loop runs only while voice is listening, thinking, or speaking, or a node is `running`/`starting`, and `prefers-reduced-motion` is off (`159–170`, `331`). A hidden document cancels the frame (`121–126`). DOM labels move with `translate3d` and skip writes when unchanged (`297–308`). A FPS meter updates every 500 ms (`323–328`).

**Overlay.** `ptah-command-overlay` (`command-overlay.component.ts:38–175`) places a label button per node (provider mark or monogram, Lucide state icon from `command-state-icon.ts:12–45`) and a hover/pin card (`119–173`) that repeats label, provider, and state. Open/close delays are 150 ms and 200 ms (`29–30`). The card anchor is positioned by the renderer (`101–114`, `311–321`).

**Work list.** `ptah-command-work-list` (`command-work-list.component.ts:28–98`) is a bordered list of the same mark, label, provider, and state. Selection is a warning border. Empty copy is inline (`91–95`).

**Side panel.** The page rail (`command-center-page.component.ts:319–377`) shows a selected-work section (kind, label, one sentence, state badge, `326–345`), pending input, the latest reply, and the work list. It does not show cost, tokens, context, or duration.

**Composer and voice dock.** `ptah-command-session-controls` (`command-session-controls.component.ts:14–75`) is the text field, Send, Start new, and Status. `ptah-command-voice-hud` (`command-voice-hud.component.ts:19–133`) is the mic button, title, a five-bar input meter, Mute, Stop, and Interrupt. The page passes `inputLevel` only (`command-center-page.component.ts:310`); `outputLevel` is painted on the canvas voice ring and is not in the dock. Header chrome (`132–184`) is the voice-ready chip, a session-id badge, and Voice settings. The stage caption (`222–241`) is “Live orchestration”, status, node count, “01 / Voice command”, and “Select a sphere for status”.

**Start view (open PR #757, not this worktree).** `ptah-command-center-start` in `.claude-worktrees/command-center-session-start/.../command-center-start.component.ts:14–111` is a heading, New session, Recent/All, a current-session row, and a two-column card grid. Each card is a name plus `relativeTime(lastActivityAt)` (`139–146`). `ChatSessionSummary` (`libs/shared/src/lib/types/execution/node.ts:229–264`) already carries `messageCount`, `tokenUsage`, `isActive`, `livePhase`, and `organization.childCount`. It does not carry `providerId` or cost. Restored provider identity is TASK_2026_695 and is not on this type yet.

**Stats the page can already see.** `CommandCenterProjectionSource.tabProvider` (`command-center-projection.source.ts:42–51`) reads `tab.liveModelStats` and `tab.sessionStats.modelUsageList` only to resolve a provider id. `TabState.sessionStats` (`libs/frontend/chat-types/src/lib/chat-types.ts:714–757`) is the backend snapshot: `totalCost`, four token classes, `tokenCount`, `agentSessionCount`, `durationMs`, `provisional`. `liveModelStats` is the context badge source, not an accounting total. Chat renders that snapshot with `ptah-session-stats-summary` (`session-stats-summary.component.ts:78–241`, template `session-stats-summary.component.html:13–120`), `formatCost` / `formatTokens` / `formatDuration` (`session-stats-format.ts:7–46`), `sessionContextCue` (`session-stats-view.ts:39–56`), `ptah-cost-badge` (`cost-badge.component.ts:32–50`), `ptah-token-badge` (`token-badge.component.ts:27–37`), `ptah-context-ring` (`context-ring.component.ts:3–33`), and `ptah-duration-badge` (`duration-badge.component.ts:15–25`). A missing figure is an em dash or “cost unavailable”, never zero.

## 2. Polish ideas

### (a) Canvas visual tweaks

**1. Theme-switched state rings.**  
What the user sees: the arc around each sphere keeps its meaning (running sweep, full ring, dashed queue, awaiting diamond, done check, failed cross) and uses the theme’s state ink instead of one set of bright hexes.  
Why: on `anubis` those hexes pass 3:1; on `anubis-light` the same hexes fall to 1.46–2.52:1 and the state disappears into the cream stage. See section 4.  
Reuse: stroke branch in `command-scene-renderer.ts:342–349`. Inks already chosen for these themes: dark `--state-ink-run/need/err/done/idle` `#3b82f6` `#f97316` `#ef4444` `#16a34a` `#9ca3af` (`tailwind.config.js:111–115`); light `#2a56c6` `#8f5200` `#b4232a` `#13713a` `#6b6570` (`189–193`). Voice ring (`421–430`) gets the same table: listening → run, thinking → the blue already used for thinking only if it passes (it does not on light: `#8ebcff` is 1.63:1), speaking → need, error → err, muted/stopped → idle. Resolve the six strings when `theme` changes. Do not read CSS variables inside `draw`.  
Size S. Risk low. The radial geometry stays.

**2. Quiet orbit guides on light.**  
What the user sees: the three ellipses stay in place and become visible on the cream stage at the same quiet weight they have on dark.  
Why: light orbit stroke `#cbc3d5` (`command-scene-renderer.ts:193`) is 1.43:1 on light `base-200`. Dark `#504b68` is 2.10:1 on `#1a1a20`, which is the intended decorative weight.  
Reuse: the light link stroke already in the same function, `#aaa1b1` (`210`), measures 2.08:1 on light `base-200`. Use that for light orbits. Dots stay `#625d73` (`187`), 5.28:1, which matches dark dots `#9d93ae` at 5.95:1.  
Size S. Risk low. Decorative, not a state cue.

**3. Cached voice halo, same pulse.**  
What the user sees: while listening or speaking, the root sphere’s glow breathes with the mic or speaker level. Reduced motion stays a fixed ring.  
Why: the pulse exists (`439–455`) as a live stroke radius. A pre-rendered halo reads as light, not as a second ring fighting the voice arc.  
Reuse: the radial glow already baked in `sprite-cache.ts:133–147` (alpha 0.2, stops at `palette.rim`). NEW: one halo canvas per palette name, not per node, drawn with `drawImage` scaled by the existing `inputLevel` / `outputLevel` (0–1, already clamped, times at most 4px of the current pulse). No `createRadialGradient` and no `shadowBlur` in `draw`.  
Size M. Risk medium: an extra image on the root only. Cap it there.

**4. Active link, same curve.**  
What the user sees: the bezier from a parent to a `running` or `starting` child is a slightly heavier state-ink stroke. Idle links stay 1px. The gold particle (max 16) stays.  
Why: motion already says “work is moving” (`239–266`); the stroke still uses one color for every edge (`210`), so the eye cannot see which edge is live when particles are off (reduced motion sets `active` false, so particles disappear).  
Reuse: the same bezier (`211–225`) and the state-ink table from idea 1. Width 2 only for that edge. No glow filter.  
Size S. Risk low.

**5. Tribunal progress stays an arc; the fraction moves to the card.**  
What the user sees: a tribunal sphere keeps the outer arc of completed phases (`397–410`). The hover card and the selected panel say “3 of 5 phases” in text.  
Why: the arc has no number. Canvas `fillText` in the frame loop would fight the sprite cache and the label DOM.  
Reuse: `node.phases` is already on `SceneNode` (`scene-layout.ts:25`) and the completion count is already computed (`398–400`). Render the fraction in the overlay card (`command-overlay.component.ts:139–160`), not on the canvas.  
Size S. Risk low.

**6. Stage backdrop sprite.**  
What the user sees: the same dots and ellipses, stable while spheres animate.  
Why: dots and orbits are static for a given size and theme, but they are rebuilt every active frame (`187–208`).  
Reuse: `SpriteCache`’s offscreen canvas (`124–129`). NEW: one backdrop canvas inside `CommandSceneRenderer`, rebuilt only when width, height, DPR, or theme changes. `draw` blits it once, then links, sprites, and rings.  
Size M. Risk medium: must rebuild on resize (`command-scene.component.ts:307–315`) or the guides drift.

Provider artwork on spheres is already shipped (`sprite-cache.ts:190–217` via `PROVIDER_BRAND_ART` / `PROVIDER_BRAND_SLUGS`). Do not draw those paths again in the frame loop. Light theme correctly flattens mark fills to `#2f241b` (`214`), which is 12.66:1 on light `base-200`. Brand fills are not measured per slug, so they stay flattened on light. Dark keeps `part.fill`.

### (b) Stats reused from main chat

**7. Collapsed session strip on the stage.**  
What the user sees: under “Live orchestration”, the same chips as chat’s collapsed bar: model, Context %, Tokens, Cost, agents, duration. Unknown stays “—” or “cost unavailable”. A provisional snapshot keeps the “~” estimate treatment.  
Why: the stage currently shows only status and a node count (`command-center-page.component.ts:222–231`). The numbers are already on the root tab.  
Reuse: `ptah-session-stats-summary` with `isStatsCollapsed` default true (`session-stats-summary.component.ts:172`, template `13–120`). Inputs are the root tab’s `sessionStats`, `liveModelStats`, and `sessionBudget` (`chat-types.ts:714–728`). Formatters `formatCost`, `formatTokens`, `formatDuration` (`session-stats-format.ts:7–46`). Context label from `sessionContextCue` (`session-stats-view.ts:39–56`), which returns `—` unless capacity evidence matches. Agent count from `agentCountOf` (`session-stats-view.ts:112–115`), hidden at zero. Do not sum messages or model rows (snapshot comment, `rpc-session.types.ts:350–353`).  
Size M. Risk medium: the summary is wide. Keep the collapsed strip; do not mount the per-model table or the plan-limit tiles on this page in this phase (`limits` input stays null, `session-stats-summary.component.ts:116`).  
NEW wiring only: the page reads the root tab fields the projection source already touches (`command-center-projection.source.ts:42–51`). No new accounting.

**8. Context ring beside the root label.**  
What the user sees: a 28px ring next to the orchestrator label when context is known, gold under 80%, need-ink from 80%, error-ink from 95%. Unknown shows no ring, and the chip from idea 7 shows “—”.  
Why: the percent is easier to see on the sphere the user is already watching than in a corner chip alone.  
Reuse: `ptah-context-ring` (`context-ring.component.ts:3–33`), `size` 28, `percent` from `sessionContextCue(...).percent`. The component already drops its transition under `prefers-reduced-motion` (`21`). Ink tokens `--state-ink-err`, `--state-ink-need`, `--ptah-gold` are inside that component (`32–33`).  
Size S. Risk low. Omit the ring when `percent` is null so we never draw 0% for unknown.

**9. Child tab stats on the hover card and the selected panel.**  
What the user sees: a delegated sphere’s card shows that child session’s cost badge, token badge, and duration when that child’s tab has a snapshot. The parent strip does not change.  
Why: a parent total hides which delegate spent the tokens.  
Reuse: `ptah-cost-badge` (`cost-badge.component.ts:32–50`), `ptah-token-badge` (`token-badge.component.ts:27–37`), `ptah-duration-badge` (`duration-badge.component.ts:15–25`). Data is `TabState.sessionStats` for the tab id already stored on the projection child (`command-center-projection.source.ts:124–136`). `CommandWorkNode` has no cost field (`command-center.store.ts:26–35`); do not add a fake one. Absent snapshot renders the badge’s unavailable state.  
Size M. Risk medium: join node id to tab id in the page, not in the sprite.  
NEW join only.

### (c) Overlay, work list, side panel

**10. One detail body for hover and selection.**  
What the user sees: the pin card and the rail “Selected work” section show the same rows: mark, label, provider, state icon, phase fraction (idea 5), and the child stats (idea 9).  
Why: today the card (`command-overlay.component.ts:130–160`) and the rail (`command-center-page.component.ts:326–345`) can disagree, and the rail has no mark.  
Reuse: `ptah-provider-mark` / `ptah-monogram-tile` and `stateIcon` / `stateColor` (`command-state-icon.ts:12–45`), already used by the overlay and the work list.  
Size S. Risk low.

**11. Work-list freshness.**  
What the user sees: under the state, “updated 2m 5s ago” while the node is running, and the state icon keeps its spin.  
Why: the list is the accessible twin of the canvas and currently has no time (`command-work-list.component.ts:66–87`).  
Reuse: `node.updatedAt` (`command-center.store.ts:34`), formatted with `formatDuration` (`session-stats-format.ts:34–46`) as elapsed since `updatedAt`, not as `SessionStatsEntry.durationMs`. Those are different facts. Hide the clause when `updatedAt` is absent.  
Size S. Risk low. Tick the label at most once a second from the page clock (`command-center-clock.ts:3`), not from the canvas frame.

**12. Counts that the projection already has, plus the speaker meter.**  
What the user sees: the stage caption gains “3 running · 1 waiting” beside the node count. The voice dock grows a second five-bar meter labeled Speaker while `voiceState === 'speaking'`.  
Why: node count does not say who needs the user. The canvas already pulses on `outputLevel`; the dock does not show it.  
Reuse: states on `projection().nodes` (`command-center-page.component.ts:228–230`). Meter markup `command-voice-hud.component.ts:48–63`. `outputLevel` is already an input of the scene (`command-center-page.component.ts:208`) and of the store.  
Size S. Risk low.

### (d) Start view

**13. Session cards use the summary fields they already receive.**  
What the user sees: each card keeps the name and the relative time, and adds message count, a token total when `tokenUsage` is present, an Active badge when `isActive` is true, and the live phase when `livePhase` is set. The current-session row gets the same meta.  
Why: the cards are name and time only (`command-center-start.component.ts:96–107`) while `ChatSessionSummary` (`node.ts:229–264`) already has `messageCount`, `tokenUsage`, `isActive`, and `livePhase`.  
Reuse: `formatTokens` (`session-stats-format.ts:18–26`) on `tokenUsage.input + output + cacheRead + cacheCreation` only when `tokenUsage` is defined; otherwise omit the token clause (do not print 0). `relativeTime` stays (`139–146`). `ptah-token-badge` if the start view can import `@ptah-extension/chat-ui`; otherwise the same `formatTokens` string.  
Size S. Risk low. This file lives on PR #757’s worktree. Touch it only when that branch is the implementation base.

**14. Provider mark on a card when the id exists.**  
What the user sees: a `ptah-provider-mark` at the leading edge of the card, or a monogram when the id is unknown.  
Why: chat rows already identify the vendor this way (`command-work-list.component.ts:51–61`).  
Reuse: `ProviderMarkComponent` and `PROVIDER_BRAND_SLUGS` (`provider-mark.component.ts:66–84`).  
Size S once a provider id is on the summary. Risk: blocked. `ChatSessionSummary` has no `providerId` in this tree or in the PR #757 worktree (`node.ts:229–264`). TASK_2026_695 is the source. Do not invent an id from the session name.

## 3. Canvas performance and quality

The renderer is already the right shape: one 2D context, sprites prepared outside the loop, rAF stopped when idle, DPR capped at 2, labels transformed only when dirty, document-hidden cancels the frame. Every canvas idea stays inside that shape.

| Idea | How it fits | Rule |
| --- | --- | --- |
| 1 State inks | Same `arc` calls in `drawStatus` / `drawVoiceRing` | Six color strings captured when the theme input changes. No `getComputedStyle` in `draw`. State is not part of the sprite signature (`sprite-cache.ts:98–110`), so a state change does not rebuild artwork. The running sweep stays a live arc (`354–361`). |
| 2 Light orbits | One `strokeStyle` swap | No extra geometry. |
| 3 Halo | One extra `drawImage` on the root | Halo canvas built like `SpriteCache.get` (`124–147`), keyed by theme + palette name + DPR. Scale with the level already clamped at `439–445`. `reducedMotion` keeps scale at 1 and the loop stopped (`162–163`). |
| 4 Active link | Same bezier, width 2 | No `shadowBlur`, no second glow pass. Particle cap stays 16 (`242`). |
| 5 Phase fraction | DOM only | No `fillText` in `draw`. Glyphs stay inside the sprite (`191–224`). |
| 6 Backdrop | One blit per frame | Rebuild on resize (`307–315`) or theme change, not per frame. Dots and orbits leave the per-frame path. |

Shared rules for all of the above:

- **Sprite cache.** Node artwork stays in `SpriteCache`. `prune` (`52–62`) already drops departed nodes. Theme change already clears the map (`65–68`). Do not cache the animated state arc or the selection dash; those are the only reasons the frame loop exists.
- **Offscreen pre-render.** Gradients, brand paths, the shield, and the new halo are painted into an offscreen canvas. `draw` only `drawImage`s them (`267–277`).
- **Dirty region.** Do not add a dirty-rect clear. Sprites include a glow larger than the sphere (`133–147`), links cross the stage, and a partial clear will leave trails. At ≤23 nodes (`scene-layout.ts:107`) a full `clearRect` (`186`) is the correct budget. The idle path already skips frames entirely (`331`).
- **Frame skip.** The meter already records frame ms (`323–328`). If that time exceeds 8 ms, drop the particle loop on the next frame before dropping sprites or rings. 8 ms leaves headroom inside a 16.7 ms frame for Angular. Do not skip the state arc: it is the status cue.
- **DPR.** Keep the existing clamp of 1–2 in the three sites above. The backdrop and the halo use that same DPR. Resize sets the buffer once; `draw` must not assign `canvas.width`.
- **Reduced motion.** `recomputeActive` is false, so rAF stops (`162–163`). Rings draw a full or dashed static arc (`354`, `439`). DOM spins are already gated (`command-overlay.component.ts:96–98`, `command-work-list.component.ts:79–83`). The context ring transition is already off (`context-ring.component.ts:21`). New motion uses the same flag.
- **No layout thrash.** `draw` may read `clientWidth` / `clientHeight` once (`178–179`). Do not read `offsetWidth` of labels in the frame; measurement stays in the resize observer (`281–288`) and `layoutScene`. Label style writes stay behind the existing equality check (`297–308`). The work-list clock does not run on the canvas frame (idea 11).

## 4. Dark and light

Tokens only, from `tailwind.config.js`. Stage surface is `base-200`: dark `#1a1a20` (line 103), light `oklch(93.982% 0.007 61.449)` which converts to `#efeae6` (line 181). Body text stays `base-content` (`#e8e6e1` dark, `oklch(23.574% 0.066 313.189)` light). Muted text stays `--bcm`, already measured in that file: dark 6.06:1 / 5.66:1 / 5.01:1 on base-100 / 200 / 300 (lines 106–109); light 6.03:1 / 5.39:1 / 5.01:1 (lines 184–187). Do not put stats text on `secondary` gold. `#d4af37` on light base is about 1.76:1 here, and `styles.css` already records plain gold at 4.10:1 on `anubis-light`, under 4.5:1 for text.

Canvas pairs measured for this proposal (stage = dark `#1a1a20` or light `#efeae6`):

| Paint | Where | On dark base-200 | On light base-200 | Use |
| --- | --- | --- | --- | --- |
| `#eb6d75` `#f2bb65` `#75c9a5` `#87b9dc` | State arcs, renderer 344–349 | 5.75, 9.96, 8.79, 8.25 | 2.52, 1.46, 1.65, 1.76 | Dark only. Fail 3:1 on light. |
| `#67d5c6` `#8ebcff` `#e5bd79` `#8e8993` | Voice ring, 423–430 | 9.82, 8.90, 9.80, 5.07 | 1.48, 1.63, 1.48, 2.86 | Dark only. |
| `#3b82f6` `#f97316` `#ef4444` `#16a34a` `#9ca3af` | Dark state inks, tailwind 111–115 | 4.71, 6.18, 4.60, 5.25, 6.82 | 3.08, 2.35, 3.15, 2.76, 2.13 | Dark rings. Not text on light. |
| `#2a56c6` `#8f5200` `#b4232a` `#13713a` `#6b6570` | Light state inks, tailwind 189–193 | 2.68, 2.78, 2.65, 2.85, 3.07 | 5.42, 5.21, 5.47, 5.09, 4.73 | Light rings. These pass 4.5:1 as small text on light base-200. |
| `#f4efe3` / `#554a45` | Selection, renderer 282 | 15.09 / 2.02 | 1.04 / 7.17 | Already theme-switched. Keep. |
| `#504b68` / `#cbc3d5` | Orbits, 193 | 2.10 / 10.15 | 6.90 / 1.43 | Decorative. Light `#cbc3d5` is too faint; idea 2. |
| `#6b6388` / `#aaa1b1` | Links, 210 | 3.11 / 6.96 | 4.67 / 2.08 | Keep. Light orbits borrow `#aaa1b1`. |
| `#2f241b` | Light mark ink, sprite-cache 214 | 1.15 | 12.66 | Light artwork only. |
| `#fff3ce` | Dark root `P`, sprite-cache 192 | 15.64 | 1.08 | Dark root only. |

`ptah-cost-badge` must keep `ok-solid-text` on the success fill. The component records `text-success-content` on `badge-success` at 2.64:1 in `anubis` (`cost-badge.component.ts:27–29`). Chip labels in the stats summary use `text-base-content` on tinted backgrounds for the same reason (`session-stats-summary.component.html:25–28`). Header “Ptah / Engineering” uses `text-state-need` (`command-center-page.component.ts:137–139`): that is `#f97316` in the dark theme (6.18:1 on base-200, passes) and must be the light ink `#8f5200` (5.21:1) when the theme is `anubis-light`. DaisyUI already swaps the variable with the theme; do not hard-code the dark orange into the light page.

## 5. Phased plan

**Phase 1 — quick wins.** DOM and the two color swaps. No new sprites.

- Idea 1 and idea 2 in `command-scene-renderer.ts` (stroke tables only).
- Idea 7 in `command-center-page.component.ts`, reading root-tab stats next to `CommandCenterProjectionSource`.
- Idea 10 and idea 5’s text in `command-overlay.component.ts` and the selected section of `command-center-page.component.ts`.
- Idea 11 in `command-work-list.component.ts` plus `command-center-clock.ts`.
- Idea 12’s counts in the stage caption.
- Idea 13 on the PR #757 start component, only if that branch is the base.

Files: `command-scene-renderer.ts`, `command-center-page.component.ts`, `command-overlay.component.ts`, `command-work-list.component.ts`, `command-center-clock.ts`, and conditionally `command-center-start.component.ts`.

**Phase 2 — canvas quality and the dock meter.**

- Ideas 3, 4, and 6 in `sprite-cache.ts` (halo factory) and `command-scene-renderer.ts` (backdrop, active stroke, halo blit).
- Idea 12’s speaker meter in `command-voice-hud.component.ts`; pass `outputLevel` from the page.
- Idea 8, the context ring, beside the root label in `command-overlay.component.ts`.

**Phase 3 — per-delegate accounting.**

- Idea 9, the node-to-tab stats join, in `command-center-projection.source.ts` (expose the child tab’s snapshot; do not recompute it) and the card from idea 10.
- Idea 14 after TASK_2026_695 puts a provider id on the session summary.
- Only if the FPS meter shows frames over 8 ms after Phase 2: the particle skip in `command-scene-renderer.ts`. Do not add it speculatively.

## Decisions

1. **Proposal only.** The spawn asked for `proposal-grok.md` and forbade every other write. A Gate 1.7 prototype waits until a phase is chosen. Options were: write the skill’s `prototype/` now, or stop at the proposal. Evidence: the task deliverable line names this file alone. Reversible: a later lane can build the prototype from Phase 1.
2. **Keep the radial 2D scene.** Options were a new layout or a WebGL scene. Evidence: `layoutScene` (`scene-layout.ts:114–146`) and the note that TASK_2026_689 was reverted for replacing this motion. Reversible: no.
3. **Unknown stats stay unknown.** Options were showing 0. Evidence: `SessionStatsEntry` (`rpc-session.types.ts:350–369`) and `ptah-cost-badge` (`cost-badge.component.ts:19–24`). Reversible: no, it would misreport unpriced providers.
4. **Light rings use the light state inks; dark rings use the dark state inks.** Options were one shared bright hex, or new colors. Evidence: section 4. Reversible: yes, the strings live in one table.
5. **Light provider artwork stays `#2f241b`.** Options were full-color `part.fill` on cream. Evidence: fills are not measured per slug; `#2f241b` is 12.66:1 (`sprite-cache.ts:214`). Reversible: yes, after a per-slug contrast pass.
6. **“Updated” elapsed is not session duration.** Options were labeling `now - updatedAt` as duration. Evidence: `CommandWorkNode.updatedAt` (`command-center.store.ts:34`) versus `SessionStatsEntry.durationMs` (`rpc-session.types.ts:446–447`). Reversible: copy only.
7. **No provider mark on start cards until TASK_2026_695.** Options were guessing a provider from the session name. Evidence: `ChatSessionSummary` has no provider field (`node.ts:229–264`). Reversible: yes, when the field exists.

## Not recommended

- A new renderer, WebGL, Three.js, or a non-radial layout. The current loop already stops when idle and the user kept this motion.
- Dirty-rectangle clearing. Glows and beziers cross the cleared region; trails are worse than a full clear at this node cap.
- `shadowBlur` or per-frame gradients. They miss the 8 ms budget and duplicate the sprite cache.
- Baking state or voice level into `SpriteCache` signatures. A running arc would rebuild the atlas every frame.
- Recomputing cost or tokens from messages, trees, or model rows. The snapshot contract forbids it (`rpc-session.types.ts:350–353`).
- Printing `$0.00` or `0%` when the snapshot or the context cue is missing.
- A sparkline on this page. `ptah-dashboard-sparkline` (`libs/frontend/declarative-dashboard/src/lib/components/dashboard-sparkline.component.ts:31`) needs a numeric series. Neither `CommandWorkNode` nor `SessionStatsEntry` has one.
- Replacing work-list marks with `ptah-agent-avatar`. The avatar (`agent-avatar.component.ts:137–194`) repeats the provider mark and adds another status ring on top of the Lucide state icon the list already spins.
- Canvas text for stats. Labels are DOM so they remain selectable, accessible, and out of the frame loop.
- Widening the voice page with the stats summary’s plan-limit tiles, lane subtotals, or the per-model table. Those belong to the chat sidebar (`session-stats-summary.component.ts:113–116`). The collapsed chips are the matching surface.
