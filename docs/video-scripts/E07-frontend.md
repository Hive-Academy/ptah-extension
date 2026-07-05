# E07 — The Frontend — Full Script

**Length:** 11–13 min · **Trial day:** Day 14 / 100 · **Runtime:** Ptah Desktop (Electron) · **Orchestrator:** Kimi (open weight, Ollama Cloud)
**Goal:** Build the Angular task board, auth, billing screens, and a polished GSAP-animated marketing landing page — design system first, UI pieces in parallel on the Canvas, all wired to E05's SSE backend.
**Controlling thesis:** A design-system-led, signal-based Angular app, built in parallel by open-weight agents on the Canvas, wired to the real API from E05.

## Pre-record checklist

- Full backend (E04–E06) green and running locally; NestJS server confirms SSE stream works.
- Angular web shell from E02 present, no UI code yet beyond the shell.
- Brand inputs ready: working name "TaskFlow", a primary color token (e.g. #4F46E5 indigo), and a rough logo or wordmark stub.
- Canvas tile layout pre-arranged: at least three tiles open (design system, task board, landing page).
- `ui-ux-designer`, `angular-frontend-patterns`, `angular-gsap-animation-crafter` skills confirmed installed.
- `angular-3d-scene-crafter` installed if you plan to show the optional 3D hero beat.
- A second browser tab already open on the running API to demo realtime board updates at the end.
- Planted smells from E04–E06 left in place (E08 will catch them); DO NOT clean them up before filming.
- Pre-test the GSAP landing page animation in the Angular dev server so the scroll reveal works on first take.

## Assets / overlays

- "Day 14 / 100" trial counter.
- Design-system board overlay: token grid (colors, type scale, spacing).
- Canvas multi-tile split-screen capture label: "3 agents · parallel UI work."
- "before / after polish" side-by-side for the landing page hero.
- GSAP animation scroll-capture (screen recording of the finished hero).
- Realtime board "two-tab" capture showing tasks updating live.

---

### [00:00–00:20] Cold open

- **VISUAL:** Ptah Desktop chat in foreground; open-weight model badge visible in the corner. On the right half of the screen, a blank Angular shell — just a white page with a toolbar placeholder.
- **ON-SCREEN (lower-third):** "Day 14 / 100"
- **VO:** "The backend's done. Auth, multi-tenancy, tasks, billing — all green. But right now, TaskFlow looks like this." Beat. "Today we add the front end."

### [00:20–01:10] Context: what we're building today

- **VISUAL:** A quick split showing the three screens that need to exist: the live task board, the auth flow (login/register), and the billing/upgrade screen. Sketch or wireframe thumbnails are fine — no polish yet.
- **VO:** "Three screens, one landing page, and a design system to hold them together. We're not designing in isolation — every component needs to talk to the real API we built. The task board hooks into the SSE stream from episode five, auth gates hit the real JWT endpoints, and the billing screens call the subscription flow from episode six. Let's start where every good UI starts: a design system."
- **ON-SCREEN:** Bullet list: "1 — Design system · 2 — Task board + auth + billing · 3 — Landing page · Canvas: parallel"

### [01:10–03:00] Beat 1 — Design system with `ui-ux-designer`

- **VISUAL:** Ptah Desktop chat. User types a prompt invoking `ui-ux-designer`. Skill activates; streaming output begins.
- **VO:** "The `ui-ux-designer` skill takes a product brief and outputs a design system — tokens, type scale, component specs. I'm giving it the TaskFlow name, the primary indigo, and a short personality brief: focused, fast, no clutter."
- **VISUAL:** Streaming output resolves into a design-system artifact: color palette block, type scale table, spacing tokens, and a short component spec (button variants, input states, card). Camera slow-push on the token grid.
- **ON-SCREEN:** Design-system board overlay animates in.
- **VO:** "The output is a named token set, a type scale, and a component vocabulary. Every piece of UI we build today pulls from this — the same palette, the same button variants."
- **VISUAL:** Cut to the project files — a `design-system.ts` tokens file and a short README written by the skill.
- **VO:** "Those tokens go straight into the Angular workspace. Every component we generate today imports from them."

### [03:00–05:30] Beat 2 — Canvas multi-tile: task board, auth screens, billing screen in parallel

- **VISUAL:** Canvas opens. Three tiles side by side: Tile 1 labelled "Task board," Tile 2 "Auth screens," Tile 3 "Billing / upgrade." Each tile has its own chat thread and a streaming indicator.
- **ON-SCREEN (lower-third):** "3 agents · parallel UI work"
- **VO:** "Instead of building one screen at a time, I open the Canvas and run three agents at once. Each tile owns one surface."
- **VISUAL:** Tile 1 stream: `angular-frontend-patterns` generates a signal-based task board component — `BoardComponent`, smart/dumb split, `TaskCardComponent`, OnPush everywhere, reading from an injectable `BoardStore` backed by the SSE stream.
- **VO:** "Tile one: `angular-frontend-patterns`. The skill enforces signal-based state, OnPush change detection, and a clean smart-dumb split. The `BoardComponent` is the smart container — it owns the store. `TaskCardComponent` is dumb — it takes inputs and emits outputs. The SSE stream from episode five plugs in here without any ceremony."
- **VISUAL:** Tile 2 stream: auth screens — login, register, and a tenant-aware route guard. Signals, reactive forms, validation feedback.
- **VO:** "Tile two: auth. Login, register, and the tenant-context guard that makes sure every route after login is scoped to the right workspace. The forms pattern from the skill keeps validation errors on screen correctly — no double-submit ghosts, no stale states."
- **VISUAL:** Tile 3 stream: billing screen — plan comparison card, upgrade button wired to the checkout flow from E06, current plan indicator.
- **VO:** "Tile three: billing. The plan cards, the upgrade CTA that hands off to the checkout flow we built in episode six, and a current-tier badge. It's the last piece of glass between the user and the subscription state machine."
- **VISUAL:** All three tiles show green checks — components generated. A quick `nx run-many -t typecheck` passes across all three.
- **VO:** "All three pass typecheck. Three screens, in parallel, using the same token set, same patterns, same conventions."
- **ON-SCREEN:** "Tiles 1–3: green"

### [05:30–07:00] Beat 3 — Wire the task board to the live SSE stream

- **VISUAL:** Split view: Ptah Desktop on the left (code/chat), two browser tabs on the right showing the TaskFlow app.
- **VO:** "Before we move to the landing page, let's make sure this is actually alive. The task board wires to the SSE endpoint, not a mock — so I want to see a task move in real time."
- **VISUAL:** In Tab 1 of the browser, user creates a new task. In Tab 2, the board updates instantly — the card appears without a reload.
- **ON-SCREEN:** "Live · SSE stream from E05"
- **VO:** "A task created in one tab, live in another — no polling, no page reload. The SSE stream from episode five is the backbone, and the signal store in the board component picks up every event automatically."
- **VISUAL:** Camera close on the new card appearing.
- **VO:** "That confirms the architecture is connected end to end."

### [07:00–10:00] Beat 4 — Landing page with `angular-gsap-animation-crafter`

- **VISUAL:** New tile (or full-screen chat) — user invokes `angular-gsap-animation-crafter`.
- **VO:** "Now the marketing page. `angular-gsap-animation-crafter` builds scroll-driven GSAP animations inside Angular components. I'm handing it the design tokens we set earlier and a brief: hero headline, feature highlights, a CTA section."
- **VISUAL:** Streaming output — an Angular route, a `HeroComponent`, a `FeaturesSection`, scroll-timeline animations specified via GSAP `ScrollTrigger`, all using the token set.
- **VO:** "The skill scaffolds a standalone Angular route, wires GSAP `ScrollTrigger` to each section, and includes a `prefers-reduced-motion` check."
- **VISUAL:** Open the Angular dev server; scroll through the landing page. Hero headline animates in, feature cards stagger on scroll, CTA section pins briefly.
- **ON-SCREEN:** GSAP scroll-capture begins.
- **VO:** "A scroll-animated hero, token-consistent. Every animated element maps back to the design system because the skill reads the tokens directly."
- **VISUAL:** [OPTIONAL — toggle on/off for recording] If using `angular-3d-scene-crafter`: a second chat turn asks for a 3D hero element. A Three.js / WebGL scene renders inside the hero section — a subtle rotating glyph or abstract mesh in the brand color.
- **VO (if 3D is included):** "There's also `angular-3d-scene-crafter`. If your product warrants a 3D hero element, the skill scaffolds a Three.js scene that integrates with the Angular lifecycle and uses the same design tokens. For TaskFlow I'm keeping it minimal — a subtle rotating glyph in the brand color."
- **VISUAL:** Before/after side-by-side: the plain shell page vs the finished GSAP landing page.
- **ON-SCREEN:** "Before / After" overlay.
- **VO:** "Before and after. Same Angular shell. The animation is real GSAP with `ScrollTrigger`, not CSS transitions."

### [10:00–11:00] Beat 5 — CLI delegation: component scaffolding

- **VISUAL:** Back in Ptah Desktop chat. Orchestrator spawns a CLI agent for component scaffolding work — generating additional `nx g component` calls and story file stubs.
- **ON-SCREEN (lower-third):** "Spawn → Poll → Read"
- **VO:** "While the landing page was building, I had the orchestrator delegate the boilerplate — remaining component files, story stubs, barrel exports — to a CLI agent. Same pattern we've used all series: orchestrator plans, CLI agent executes."
- **VISUAL:** CLI agent result streams into the chat; a quick file-tree overlay shows new component files added.
- **VO:** "A dozen component files, all following the `angular-frontend-patterns` conventions, none hand-typed."

### [11:00–12:00] Close green: full build and realtime confirm

- **VISUAL:** Terminal (or Ptah's xterm panel): `nx run-many -t lint typecheck build` runs across the Angular app.
- **VO:** "Let's close this one green. Lint, typecheck, build — the full pass across everything we built today."
- **VISUAL:** All tasks pass. Green matrix.
- **ON-SCREEN:** "lint: ✓ · typecheck: ✓ · build: ✓"
- **VO:** "Clean. Task board live on SSE, auth screens wired, billing screens connected, landing page animated."
- **VISUAL:** Final sweep: scroll the landing page one more time, then show the live task board in the browser.
- **VO:** "A signal-based Angular app and an animated landing page, built in parallel by open-weight agents."

### [12:00–13:00] CTA / End screen

- **VISUAL:** End card over a split: landing page left, task board right.
- **VO:** "That's episode seven. The app has a front end now — task board, auth, billing, and a landing page, all connected to the real backend. Next episode we stop and review everything we've built: code quality, business logic, and security. Three separate reviewers, one codebase. I'll see you in episode eight."
- **ON-SCREEN:** End card — "Next: Quality Gate: Triple Review" · "Day 16 / 100" · subscribe/playlist link.

---

## Shot list (quick capture summary)

1. Cold open: Desktop chat + open-weight badge + blank Angular shell.
2. Three-screen brief overlay (wireframe thumbnails).
3. `ui-ux-designer` skill invoke — streaming output.
4. Design-system token grid close-up (color, type, spacing).
5. Canvas three-tile split-screen with all three streams running.
6. Tile-by-tile close-ups: board code, auth code, billing code.
7. `nx run-many -t typecheck` pass (green matrix).
8. Two-tab realtime reveal: task created → board updates.
9. `angular-gsap-animation-crafter` invoke and streaming output.
10. Dev-server scroll-capture: landing page GSAP animation.
11. (Optional) `angular-3d-scene-crafter` 3D hero scene.
12. Before/after overlay: shell vs finished landing page.
13. CLI agent spawn → poll → read for component scaffolding.
14. Final `nx run-many -t lint typecheck build` green matrix.
15. End card.

## [VERIFY] flags

- Confirm the exact Ptah Desktop invocation path for `ui-ux-designer` skill — slash command, chat prompt, or skill panel — and that its output includes named design tokens in a format the Angular workspace can import directly.
- Confirm Canvas multi-tile behavior: verify three simultaneous agent streams are stable and that each tile can independently invoke a different skill (`angular-frontend-patterns` in one, a plain chat in another).
- Confirm `angular-frontend-patterns` generates signal-based, OnPush components with a smart/dumb split that compiles under strict TypeScript in the Nx workspace from E02.
- Confirm `angular-gsap-animation-crafter` installs GSAP as a dependency and emits `ScrollTrigger`-based animations that run in the Angular dev server without manual patching.
- Confirm `angular-3d-scene-crafter` is available as a shipped skill (it is listed as optional in the bible — if not present in the recording build, cut the 3D beat entirely and update the shot list).
- Confirm the SSE endpoint from E05 is reachable from the Angular dev server (CORS, proxy config) so the two-tab realtime demo works on first take.
- Confirm CLI agent spawning for `nx g component` scaffolding works headlessly via `ptah_agent_spawn` from within the desktop app.
- Confirm `angular-3d-scene-crafter` does not include trademarked third-party names in any non-JS asset that would violate the VS Code Marketplace scanner (relevant if the skill ships markdown).
