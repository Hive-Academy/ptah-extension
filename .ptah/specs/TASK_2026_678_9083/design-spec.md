# Voice Command Center — visual specification, revision 3

Status: Gate 1.7 prototype pending review. Scope: Electron page, one ordinary Ptah chat session, only that session's descendants. Binding sources: `task-description.md` rev 3, `context.md`, and `design-spec-review.md`. Visual system: Ptah Egyptian sacred tech (`.claude/skills/technical-content-writer/DESIGN-SYSTEM.md`) and app `anubis` themes (`apps/ptah-extension-webview/tailwind.config.js`). Rendering uses only Canvas 2D and CSS transforms.

## Experience and layout

An illuminated gold and obsidian Ptah sphere anchors an orbital instrument. Only descendants of the dedicated chat session appear: CLI lanes, child sessions and Tribunal groups. Voice command and concise work state dominate; no transcript wall.

Desktop ≥1100px: 72px header, `minmax(0,1fr) 336px` stage/rail grid with 16px gap, stage height `max(600px,100vh - 246px)`; 720–1099px rail 280px/stage 540px; under 720px stack at stage 460px, under 480px stage 360px [lane-proposed, app 4px rhythm]. Stage header and foot reserve 66px/42px. Rail height tracks stage plus dock and only its work list scrolls. The 56px mic orb is the dock's primary visual affordance; session action is secondary. Header has session, provider settings and prototype controls. Stop remains actionable in every voice state. AC16 restart offer names both “Resume last session” and “Start new”; the prototype previews the appropriate action for its chosen state.

Canvas owns shaded spheres, orbit/edge light and rings. DOM owns icon/name plates, HUD, pending card, accessible mirrored list and recovery action. The pending card stays in the rail and does not obscure the scene.

## Token table

Core values come from the app themes and Ptah design system; [lane-proposed] effects derive from those values. Production fonts are Cinzel display, Inter body, JetBrains Mono metadata (`tailwind.config.js`). Prototype uses local system fallbacks due to the one-file/no-network requirement.

| Token | Dark | Light | Source |
|---|---|---|---|
| page / panel / stage | `#131317` / `#1a1a20` / `#242430` | `#fbf9f7` / `#f4f0ee` / `#eae6e4` | app theme; light CSS approximates theme OKLCH in standalone prototype |
| text / gold | `#e8e6e1` / `#d4af37` | `#302c38` / `#80551a` | app theme / derived light gold, adjusted for 4.5:1 |
| running / awaiting / failed / done / stopped text inks | `#65a9ff` / `#ffb86b` / `#ff7f85` / `#36c76b` / `#9ca3af` | `#2a56c6` / `#8f5200` / `#a51e2a` / `#13713a` / `#6b6570` | [lane-proposed] legible variants of app state inks |
| hero lit / shadow / rim | `#f8db91` / `#211811` / `#d4af37` | `#ffe6aa` / `#443024` / `#80551a` | [lane-proposed] from brand gold |
| blue lit / shadow / rim | `#98d5ff` / `#11233e` / `#5caafa` | `#d4edff` / `#355171` / `#2a56c6` | [lane-proposed] from running ink |
| teal lit / shadow / rim | `#a6eee1` / `#14332e` / `#4dd6c1` | `#d7fff4` / `#375b51` / `#237967` | [lane-proposed] from scarab teal |
| plum lit / shadow / rim | `#d7bdff` / `#302443` / `#aa86ea` | `#efe3ff` / `#55486d` / `#7654a8` | [lane-proposed] OpenCode |
| red lit / shadow / rim | `#ffc4c4` / `#3f1923` / `#ef707b` | `#ffe0dc` / `#5d2b30` / `#b4232a` | [lane-proposed] Antigravity |
| jade lit / shadow / rim | `#cbf4a7` / `#26381c` / `#9cdb65` | `#e4f8c4` / `#506c3b` / `#568b32` | [lane-proposed] Glm |
| silver lit / shadow / rim | `#f0e9dd` / `#33323d` / `#c0b9ca` | `#fffaf1` / `#5e555d` / `#746a74` | [lane-proposed] child sessions |
| voice idle / listening / thinking / speaking / muted / error | `#d4af37` / `#4dd6c1` / `#5caafa` / `#f8db91` / `#9ca3af` / `#ef4444` | `#80551a` / `#237967` / `#2a56c6` / `#80551a` / `#6b6570` / `#b4232a` | [lane-proposed] brand/state mapping |
| orbit / edge / node line | `#77718555` / `#7f8bba66` / `#ffffff33` | `#6a627077` / `#52627d77` / `#392c3a44` | [lane-proposed] neutral alpha |
| HUD / tooltip / card | `#1a1a20df` / `#242430f5` / `#242430ed` | `#f4f0eef0` / `#eae6e4f5` / `#eae6e4f2` | [lane-proposed] theme surfaces |
| border / elevation | `#d4af3730` / `0 18px 52px #0008` | `#6a627044` / `0 18px 52px #44302424` | [lane-proposed] |
| radii / blur | 12px panel, 6px button, 4px badge / 16px | 16px panel, 32px button, 16px badge / 16px | theme radii; blur [lane-proposed] |
| motion | 150ms fast, 300ms normal, 800ms edge travel, `cubic-bezier(.2,.8,.2,1)` | same | theme durations; travel/ease [lane-proposed] |

Hover/pressed/disabled use border opacity 65%/90%/20%, tint 8%/14%/0%. Focus is a 2px running-ink outline with 3px offset. Selection is a separate offset dashed halo, leaving Ptah's voice-state ring visible. Labels live in DOM below/alongside spheres, never inside them.

## Scene grammar and states

One Canvas 2D layer paints 48 dots, three orbit ellipses, quadratic Bézier edges, ≤16 particles, cached sphere and glow sprites, status rings and selection. Palette map: Codex blue, Grok teal, OpenCode plum, Antigravity red, Glm jade, child session silver, Tribunal gold, Ptah gold with a distinct 154px scale and voice ring [lane-proposed, token table]. Each CLI orb has an inlaid provider mark drawn from the app's `PROVIDER_BRAND_ART` paths with `new Path2D(d)` into its cached sprite. Brand and hue jointly identify the lane; the status halo remains outside the face. A provider ID resolves through `PROVIDER_BRAND_SLUGS` before model or display name: a GLM lane on Ollama Cloud shows the Ollama mark, while a Z.ai provider shows `zdotai`. Unknown IDs render a two-letter monogram on the same vendor-color disc, mirroring `ptah-monogram-tile`. Ptah keeps its gold/obsidian hero orb and `P` mark. Sphere sprites include radial light at upper left, dark crescent, rim and specular highlight. Ptah diameter 154px desktop/124px narrow; delegate 58px nominal; Tribunal 70px with three branded 25px participant satellites. Child sessions use their parent provider's mark and their own name chip (`Codex · Builder`); Tribunal satellites pair each parent's provider mark with Builder, Challenger and Judge chips in the collision-managed overlay and mirrored list. Back occupants draw first. Drag tilts the apparent orbit plane ±18° [lane-proposed].

At N=24, eight nodes take the inner ellipse (`rx=.235W,ry=.225H`) and fifteen the outer (`rx=.425W,ry=.385H`); Ptah sits at `.5W,.485H`. Inner/outer perspective scales `.72/.78`; a five-pass pair separation enforces sphere radius sum +12px and a Ptah keep-out of sphere radius +111px. Positions clamp inside the stage header/foot. For smaller sets use `rx=.405W,ry=.365H`; never place a sphere inside Ptah's voice ring plus a 12px gap. Stage aspect ratio drives both axes, filling wide stages. N>24: collapse oldest completed scene items into a count chip; all work remains in the list; active/awaiting/failed items retain scene priority [lane-proposed].

DOM labels use `translate3d` and four candidate sides. Reject any label rectangle intersecting a sphere's ring/halo exclusion circle (Ptah radius +32px; delegate +12px) or another label +6px. Ptah's plate starts 36px below its sphere and cannot cover its voice ring. Hide a label when no legal position exists; never obscure a sphere. At N>12 show Ptah, selected, awaiting, failed, and up to five other labels in list order; hide Tribunal participant chips with their parent label when space runs out. Full provider marks, names and statuses remain in the keyboard list and hover tooltip. The prototype's list is the text alternative for all 24 scene nodes.

Queued ring is dashed, running a rotating arc, awaiting an amber diamond, completed a check, failed a cross, stopped a slash. Tribunal core carries a phase arc and three participant satellites; nested rows give names and terminal states. Ptah has a separate voice ring even when selected: idle steady gold; listening teal with mic-level pulse; thinking rotating blue arc; speaking warm segmented TTS pulse; muted grey interrupted; error red segmented. A Ptah question adds an awaiting diamond and awaiting text in the rail. Shapes and words reinforce hue.

## Voice, input and session behavior

Barge-in while Ptah speaks queues the next user turn; it does not abort the current chat turn. Stop aborts the turn and playback. Mute stops mic capture only. Bound narration to one concise update per material lifecycle change, coalesce duplicates, and cap the speech backlog; show the same status as a DOM toast. Echo suppression during playback shows `Playing Ptah audio`. Tool approval requires click or keyboard Approve/Deny; voice cannot approve. Questions allow voice or typed answer. Microphone denied, provider missing, transcription failure, playback failure and chat-turn failure each show distinct recovery controls; never expose raw errors/secrets. New starts one dedicated session; Resume restores that identity and graph.

## Angular binding

`CommandCenterPageComponent` is standalone and OnPush. `CommandCenterStore` holds immutable signal snapshots for `sessionId`, `sessionStatus`, `voiceState`, `inputLevel`, `outputLevel`, `muted`, `nodes`, `edges`, `selectedId`, `pendingInput`, `provider`, `toast`, `theme`, `reducedMotion`; it filters descendants by the dedicated root chat ID. `CommandSceneComponent` owns the canvas via `viewChild`; `CommandSceneRenderer` holds a separate mutable projection/sprite state. `CommandOverlayComponent` owns DOM labels/tooltip, while voice HUD, pending input, list and session controls are presentational standalone components with `input()`/`output()`. Canvas resolves provider IDs with `PROVIDER_BRAND_SLUGS`, reads `PROVIDER_BRAND_ART` and rasterizes its paths into offscreen sprites. Both records live in `@ptah-extension/ui`'s vendored TypeScript brand-mark source, but `lib/native/brand-mark/index.ts` currently exports only `BrandMarkComponent`; add public exports for both records before production import. Keep vendor path data in TypeScript only per the vendored file's Marketplace scanner rule; the standalone prototype may inline them. DOM chips and list use the already exported `<ptah-brand-mark [brandSlug] [label] size>` component and its monogram fallback.

Use `inject()`, `afterNextRender` for canvas setup, `effect()` on `theme()` for CSS token resolution and sprite rebuild, and `DestroyRef` for observers, listeners, rAF and caches. The renderer runs with `NgZone.runOutsideAngular` for the zone fallback; no frame-driven signals or change detection. It writes overlay `style.transform` directly inside rAF. Enter Angular on semantic events only. Host calls use `ClaudeRpcService` and `MESSAGE_HANDLERS`, never direct transport.

## Performance budget

Target 60 FPS, floor 30 FPS at 24 total scene nodes on integrated GPU, 1280×720; Electron acceptance also requires p95 **draw ≤8ms**. One canvas, DPR cap 2; detached-canvas cache keyed by theme/palette/size/brand slug/monogram contains sphere, glow and face mark. A provider mark is parsed with `Path2D` only on cache miss. The hot loop uses `drawImage`, paths, rings, edges and DOM transforms; no `getComputedStyle`, gradient creation, `shadowBlur` or `fillText`. Resolve CSS tokens only at setup, theme change or resize. Caps: 24 scene nodes, 24 edges, 16 particles, 48 backdrop dots. Meter updates at ≤2 Hz and says `FPS idle` after rAF stops. An idle voice with no running work renders on demand; live voice, drag or running work keeps rAF active. Hidden page pauses; reduced motion removes drift, particles and pulses and renders once. `ResizeObserver` handles size; `DestroyRef` handles route teardown. Sprite/backing target ≤24MB at DPR 2.

Measured after the brand-face revision in headless Chromium on this machine at 1440×900 viewport, stage backing 1044×654, DPR 1: **16–33 FPS** and p95 draw **2.6–3.7ms** across two themes and three 2.2–3.0-second warm samples at N=24. The headless sample does not consistently clear the 30 FPS floor; browser scheduling is visible because draw time stays below 4ms. This is not an Electron or integrated-GPU measurement. The prototype renders each active frame at browser rAF cadence; acceptance needs an Electron hardware run and profiling before claiming the floor. An optional 30 Hz tier is deferred until that profiling proves useful.

## Accessibility and contrast

WCAG 2.2 AA: text ≥4.5:1, meaningful UI boundaries and large text ≥3:1. DOM list mirrors all scene nodes and provides keyboard selection, visible focus, live status, text command fallback and reduced motion. Primary actions target ≥44×44px; plate meta, rail meta and HUD subtext have an 11px minimum [lane-proposed]. Disabled controls use theme panel/muted ink, not black fill; Stop is never disabled while a turn can be aborted.

Measured sRGB solid-surface pairs (foreground/background): dark text `#e8e6e1/#1a1a20` 13.89:1; muted `#b8b6bd/#1a1a20` 8.63; gold `#d4af37/#242430` 7.29; running `#65a9ff/#242430` 6.33; done `#36c76b/#242430` 6.96; stopped `#9ca3af/#242430` 6.04. Light text `#302c38/#f4f0ee` 12.02; muted `#625d69/#f4f0ee` 5.64; gold `#80551a/#eae6e4` 5.24; running `#2a56c6/#eae6e4` 5.22; done `#13713a/#eae6e4` 4.91; stopped `#6b6570/#eae6e4` 4.55. Existing measured amber/red card pairs remain ≥6.01. Recheck composited translucent surfaces in Electron.

## Decisions

| Decision | Options | Evidence | Reversible |
|---|---|---|---|
| Orbital deck with gold hero | flat graph / orbital deck | User wants stunning pseudo-3D spheres; Ptah brand | Yes |
| DOM labels and mirrored rail | canvas text / DOM | Review Serious 1, keyboard access | Yes |
| Independent voice ring and selection halo | one / two rings | Review Serious 5 | Yes |
| Cached Canvas 2D sprites | graphics library / Canvas 2D | User restriction and N=24 | No in this scope |
| Provider marks as cached orb faces | generic circles / shipped paths | Existing `PROVIDER_BRAND_ART`, user request | Yes |
| Failure persists in demo | overwrite / persist | AC14/21, review Moderate 9 | Yes |

## Deferred

Gate 1.7 cross-side approval remains pending. Prototype levels, statuses, recovery actions and tool approval are simulated; production RPC and audio integration remain implementation work. The prototype illustrates a retry/permissions/settings action but the host must wire each to the correct capability and account for access denial. Headless browser numbers do not replace Electron p95 draw and GPU measurement. The optional 30 Hz edge-only tier, precise live VAD/TTS level scaling, bounded speech-queue duration and composited contrast audit wait for integrated audio and target hardware. The light stage could gain stronger decorative separation after implementation visual review. Regular-chat duplicate-session guard (AC25) is host behavior outside this isolated page.

