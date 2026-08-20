# E05 — The Tasks Engine — Full Script

**Length:** 11–13 min · **Trial day:** Day 8 / 100 · **Runtime:** Ptah Desktop (Electron) · **Orchestrator:** Kimi (open weight, Ollama Cloud)
**Goal:** Build Tasks CRUD plus real-time SSE updates on a resilient service architecture — and spotlight background workspaces, Rewind/fork, and the in-app Monaco/xterm/git editor.
**Controlling thesis:** Resilience patterns are easier to add at the start than retrofit later — and Ptah keeps building while you're working somewhere else.

## Pre-record checklist

- Auth + tenancy from E04 merged and green (all lint/test/build passing).
- A second throwaway workspace folder ready (`TaskFlow-billing-prep`) to demo background switching.
- Two browser tabs pre-staged pointing at the TaskFlow dev server (different tenant logins) for the real-time reveal.
- Pre-run the SSE endpoint dry run so the event stream format is known on camera.
- Stage the design-fork moment: have both approaches sketched in notes (optimistic vs server-authoritative) so the Rewind demo is tight and rehearsed.
- Keep the background build long enough (test + lint) to switch away, do something in the second workspace, and switch back — pre-time this.
- CLI agent (ptah-cli or codex) pre-tested for DTO/validation scaffolding task.

## Assets / overlays

- Real-time two-tab split capture (task created in Tab A appears in Tab B).
- Fork before/after split: optimistic update approach vs server-authoritative approach.
- Background-workspace "still streaming" badge overlay.
- Editor close-up shot: Monaco code view, xterm terminal, git diff panel.
- Trial-day counter "Day 8 / 100".

---

### [00:00–00:20] Cold open

- **VISUAL:** Ptah Desktop chat open. Open-weight model badge visible. The file tree shows the auth and tenancy modules from E04 — clean, green.
- **ON-SCREEN (lower-third):** "Day 8 / 100"
- **VO:** "This is the feature users actually touch. Not the auth plumbing, not the tenant policies — the task board. It needs to handle concurrent edits, deliver updates in real time, and not fall over when a side-effect fails. So we wire it with retries, domain events, and a live SSE stream from the start."

### [00:20–01:10] Context handoff from E04

- **VISUAL:** Briefly show the E04 session state — ZenStack policies, tenant middleware, green test run.
- **VO:** "Episode Four gave us tenant isolation enforced at the data layer. The Tasks engine plugs directly into that foundation — it gets tenant scoping for free, domain events from the E03 design, and a clean service boundary to build on."
- **ON-SCREEN (lower-third):** "Continuing from E04 merged auth + tenancy"

### [01:10–02:30] Design the module — resilient-nestjs-patterns

- **VISUAL:** Kimi's response streams in after the prompt. It references `resilient-nestjs-patterns` and lays out the module design.
- **VO:** "The skill driving this episode is `resilient-nestjs-patterns`. It encodes five patterns we need: domain service layering, service orchestration, event-driven architecture, retry and fallback, and dynamic modules. The orchestrator reads the domain events we wired in E03 — `TaskCreated`, `TaskMoved`, `TaskCompleted` — and designs the module around them."
- **VISUAL:** Architecture output visible: Controller → TaskService → TaskDbService → domain events → SSE emitter. Clean layering diagram.
- **VO:** "The layering is strict. Controller handles HTTP, TaskService owns business logic and emits domain events, TaskDbService handles persistence through the ZenStack-scoped client. No service imports another service. Events are the only coupling."
- **ON-SCREEN:** Architecture callout: "Controller → Service → DbService · events decouple layers"

### [02:30–04:00] Build CRUD + wire domain events

- **VISUAL:** Code streams in — the `CreateTask`, `UpdateTask`, `MoveTask` commands; the TaskService event emissions. The SSE controller endpoint appears.
- **VO:** "CRUD comes first. Create, read, update, move — each command validates inputs with Zod, executes through the service, and emits a domain event. The SSE controller subscribes to those events and streams them to connected clients. When Tenant Alpha creates a task in one browser tab, their other tab sees it in under a second."
- **VISUAL:** CLI agent delegated via `ptah_agent_spawn` (`ptah-cli`): "Scaffold the DTO classes, Zod validation schemas, and unit test stubs for the Tasks module." Spawn → Poll → Read cycle.
- **VO:** "The boilerplate — DTOs, validation schemas, unit test stubs — goes to a CLI agent. Spawn, poll, read. The orchestrator stays on the business logic and event wiring."
- **ON-SCREEN (lower-third):** "CLI delegate: ptah-cli · DTOs + test stubs"

### [04:00–05:40] The design fork — Rewind in action

- **VISUAL:** Kimi proposes optimistic client updates (client updates UI immediately, reconciles on server response). Presenter pauses.
- **VO:** "Kimi proposes optimistic updates — the client reflects the change immediately and reconciles if the server disagrees. That works, but it adds reconciliation logic and can produce conflicting state under concurrent edits. I want to look at the other path before committing."
- **VISUAL:** Rewind/fork action triggered in the Ptah chat. [VERIFY exact UI path for initiating a fork/Rewind in Ptah Desktop.] The conversation branches — same tab, same tile. The previous assistant turn remains accessible.
- **VO:** "This is Rewind. I fork the conversation from before Kimi made that design choice. Same tile, same session — Ptah creates a transparent fork, not a new workspace. I ask it to design the alternative: server-authoritative updates, SSE as the source of truth, no client reconciliation logic."
- **VISUAL:** Second design streams in. Split-screen overlay: optimistic (left) vs server-authoritative (right).
- **ON-SCREEN:** Fork before/after split overlay.
- **VO:** "Side by side: optimistic is simpler to implement but fragile under concurrent edits. Server-authoritative is slightly more latency-sensitive but the SSE stream is the single source of truth — no reconciliation, no conflicts. For a task board with collaborative editing, I'll go with the server-authoritative fork. You can decide which trade-off fits your case."
- **VISUAL:** Fork resolved — presenter continues on the server-authoritative branch.
- **VO:** "Rewind let me try the alternative, compare, and keep the one I wanted — without leaving the session or losing context."

### [05:40–07:00] Background workspaces — the Tasks build keeps running

- **VISUAL:** Long test + lint run kicks off in the xterm terminal. Progress visible.
- **VO:** "The full test suite for the Tasks module is running — integration tests, lint, type-check. This will take a while. I'm not going to wait for it."
- **VISUAL:** Switch to the second workspace in Ptah Desktop. [VERIFY exact path for switching workspaces while a session runs in the other.] Second workspace opens — `TaskFlow-billing-prep` folder.
- **ON-SCREEN:** Background-workspace "still streaming" badge appears in the corner, indicating the Tasks build is still running.
- **VO:** "Background workspaces. I've switched to a fresh folder where I'll start sketching the billing layer for Episode Six. The Tasks build is still running — the indicator shows it. Ptah kept streaming the test output in the background."
- **VISUAL:** Do a few quick notes in the second workspace — a prompt about billing tiers, a quick memory note. Then switch back to the Tasks workspace.
- **VO:** "A few billing notes. Now back to Tasks."
- **VISUAL:** Return to the Tasks workspace. The test run has advanced or completed. Output visible.
- **ON-SCREEN:** Background-workspace "still streaming" badge replaced by green check.
- **VO:** "The session kept running while I was in the other workspace. That's background workspaces — a real parallel build, not a tab pause."

### [07:00–08:20] In-app editor spotlight

- **VISUAL:** Open a generated Tasks module file in the Monaco editor inside Ptah Desktop.
- **VO:** "A quick look at the editor. Everything we've been building streams into files, but sometimes you need to read the code as code."
- **VISUAL:** Monaco editor shows the `TaskService` implementation. Syntax highlighting, IntelliSense active.
- **VO:** "Monaco is built in — full editor, full language intelligence. I can read the service, jump to definitions, and make a quick inline edit without leaving the app."
- **VISUAL:** Make a small manual edit in Monaco — add a missing null check on the task owner field. Save.
- **VO:** "Small fix — a null check before the test run."
- **VISUAL:** Switch to the integrated xterm terminal panel. Run a targeted test for that file.
- **VO:** "Then the terminal — same app, same window. Run the unit test for that file."
- **VISUAL:** Test passes. Switch to the git panel.
- **VO:** "And the git panel shows the diff. Monaco edit, xterm test, git diff — without leaving Ptah Desktop."
- **ON-SCREEN (lower-third):** "Monaco + xterm + git · in-app editor"
- **VISUAL:** Git panel shows the staged diff cleanly.

### [08:20–09:40] Retry + fallback — resilience layer

- **VISUAL:** Code for the notification side-effect handler — a post-task-creation hook that notifies other team members.
- **VO:** "One more pattern from `resilient-nestjs-patterns`: retry and fallback. The Tasks engine emits a `TaskCreated` event that triggers a notification side-effect — send a heads-up to team members. That side-effect will occasionally fail. External calls do."
- **VISUAL:** Retry decorator / wrapper applied around the notification call. Exponential backoff configured.
- **VO:** "We wrap it with retry — exponential backoff, three attempts. If all three fail, the fallback queues it for a scheduled retry rather than crashing the request. The task is still created. The notification is best-effort. The system degrades gracefully."
- **ON-SCREEN:** Code callout: `@Retry({ attempts: 3, backoff: 'exponential' })` on the handler.
- **VO:** "Critical path succeeds, side-effects retry independently. Domain events decouple them — the TaskService doesn't know or care if the notification succeeded."

### [09:40–11:00] The real-time reveal — two browser tabs

- **VISUAL:** Two browser tabs side by side on screen. Both logged in as Tenant Alpha (different sessions). The task board is empty on both.
- **VO:** "Two tabs, same tenant, both connected to the SSE stream. I create a task in Tab A."
- **VISUAL:** Type a task name in Tab A, submit. The task appears in Tab A's board.
- **VISUAL:** Switch camera focus to Tab B. The same task appears within a second, with no refresh.
- **VO:** "Tab B. No polling, no WebSocket — SSE, one-directional, low overhead. The task appeared without a page refresh. That's the domain event flowing from the TaskService through the SSE controller to every connected client in this tenant."
- **ON-SCREEN:** Real-time two-tab callout overlay.
- **VO:** "Move the task to 'In Progress' in Tab A — `TaskMoved` event — and Tab B updates."
- **VISUAL:** Drag or update the task status in Tab A. Tab B updates.

### [11:00–11:50] Close green — full build pass

- **VISUAL:** `nx run-many -t lint test build` in the xterm terminal. All targets green.
- **VO:** "Full green — lint, unit tests, integration tests, build. The Tasks engine is live, real-time, and handling failures gracefully. Day eight: CRUD, domain events driving an SSE stream, retry on the flaky path, and Monaco, xterm, and the git panel all working together inside the app."
- **ON-SCREEN (lower-third):** "Day 8 / 100 · Build: green"

### [11:50–12:40] CTA / End screen

- **VISUAL:** Ptah chat, Tasks module green in the file tree. End card.
- **VO:** "A Tasks engine with real-time updates, resilience patterns, and a design fork we could evaluate before committing. Next episode: billing. Tiers, a webhook-driven subscription state machine, and we'll drive the live test checkout through the browser from inside Ptah. I'll see you in Episode Six."
- **ON-SCREEN:** End card — "Next: Monetize: Billing + Webhooks" · "Day 11 / 100" · subscribe/playlist link.

---

## Shot list (quick capture summary)

1. Cold open: Ptah Desktop with open-weight badge, E04 domain tree visible.
2. E04 context handoff — ZenStack policies and green test run.
3. `resilient-nestjs-patterns` module design output — architecture layering diagram.
4. CRUD + domain event code streaming in; SSE endpoint.
5. CLI delegate: `ptah_agent_spawn` → `ptah-cli` for DTOs + test stubs (Spawn → Poll → Read).
6. Rewind/fork trigger — before state (optimistic) and after (server-authoritative) split overlay.
7. Background workspace switch: Tasks build running → switch to `TaskFlow-billing-prep` → switch back. "Still streaming" badge.
8. Monaco editor: `TaskService` file, inline edit, xterm test run, git diff panel.
9. Retry + fallback code: decorator callout on notification handler.
10. Real-time two-tab reveal: task created in Tab A, appears in Tab B. Task moved, Tab B updates.
11. `nx run-many` green build.
12. End card.

## [VERIFY] flags

- Exact Ptah Desktop UI path for triggering Rewind/fork from within a chat session (what the control looks like and where it lives in the Electron UI — do not fabricate a menu name).
- Exact Ptah Desktop path for switching between workspaces while a build session is running in another workspace, and confirm whether the "still streaming" background badge is a real Ptah Desktop overlay or needs to be described generically.
- Confirm whether the integrated Monaco editor, xterm terminal, and git diff panel are co-located in a single Ptah Desktop view (as the `libs/frontend/editor` lib suggests) or launched as separate panels — adjust the editor spotlight section if different.
- Confirm `ptah_agent_spawn` delegate priority order for DTO/test scaffold task: `ptah-cli > codex > copilot` per the bible — call out whichever runs on camera.
- SSE endpoint implementation: confirm Nest's `@Sse()` decorator and `EventEmitter2`-based pattern are the actual approach in the `resilient-nestjs-patterns` skill refs, or adjust VO to be generic.
- Retry decorator syntax (`@Retry`) — confirm whether `resilient-nestjs-patterns` ships a decorator or uses a function wrapper; adjust the code callout accordingly.
- Two-browser-tab real-time demo: confirm the dev server can handle two simultaneous SSE connections from different browser tab sessions under the same tenant in a local dev setup without special config.
