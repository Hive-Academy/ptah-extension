# Spike report: real-app replay demo on the PtahCode landing page

- Branch / worktree: `feat/landing-live-demo` in `.claude-worktrees/feat-landing-live-demo-65fe00d920b7` (base `bd8aac4d5`).
- Date: 2026-10-31.
- Lanes: codex (bridge, scenario, server, capture), kimi code (protocol and recorder research), antigravity (independent review; grok failed with HTTP 402). The coordinator ran the build and an independent browser check.
- Inputs: `spike/spike-notes.md`, `research-recorder-and-protocol.md`, `spike-review.md`, `spike/evidence/*`.

## 1. Verdict

**Feasible, with changes.** The real production webview SPA booted in a plain Chromium page with no host and no network. It played a hand-made chat turn: user prompt, streamed assistant text, one `Read` tool call with its result, final text, turn complete. The replay bridge answered 28 RPC methods. No RPC method was unanswered, and no external request was made.

The shape that the user approved is correct: a lazy `<iframe src="/demo/">` with the production webview build, a classic-script `replay-bridge.js`, and JSON scenarios. The changes that the full feature needs are in sections 4 and 11.

Evidence (dark theme, 1440×900):

| Stage | Lane capture | Coordinator run |
| --- | --- | --- |
| Boot | `spike/evidence/boot.png` | — |
| Mid-stream (`Read main.ts` tool card) | `spike/evidence/mid-stream.png` | `spike/evidence/coordinator-mid.png` |
| Turn complete | `spike/evidence/complete.png` | `spike/evidence/coordinator-complete.png` |

The coordinator run used the Playwright browser tool, because `ptah_browser_navigate` blocks `localhost` by default (`ptah.browser.allowLocalhost`). In that run, navigation took 1.6 s and the scenario timeline is 2.8 s long. Playback starts 10–18 s late because of a bridge bug (section 4, review B1).

## 2. Measured sizes

Production build: `node scripts/verify.mjs --exec --task webview-build -- npx nx build ptah-extension-webview --configuration=production`. The build passed (exit 0, 3 m 17 s after 18 min in the lock queue). The local 101 MB `dist` folder is mostly source maps and static assets.

| JS + CSS scope (no `.map`) | Raw | gzip | brotli |
| --- | ---: | ---: | ---: |
| Whole build | 23.3 MB (23,329,859 B) | 5.54 MB | 5.50 MB |
| Files requested by the chat scenario (initial load + lazy chunks it used) | 4.07 MB (4,072,288 B) | 1.05 MB | 1.04 MB |

The demo transfers about **1.0 MB compressed** of JS and CSS on first view. The 52 requests also include fonts and images. The webview build uses `outputHashing: "none"` (`apps/ptah-extension-webview/project.json:61-77`), so the demo copy needs revalidation caching, or the copy step must add hashes. A 1 MB load is acceptable for a click-to-play or visible-on-scroll embed on desktop. It is too much for mobile (section 8).

## 3. How the spike works

Files in `task-tracking/landing-live-demo/spike/`:

- `replay-bridge.js` (classic script, about 200 lines). It runs before Angular and before the inline theme script. It defines `window.vscode` (`postMessage`, `getState`, `setState` with in-memory state), `acquireVsCodeApi()`, and `window.ptahConfig` with the Electron shape (`apps/ptah-electron/src/preload.ts:24-51`). It answers `rpc:call` from the scenario `rpc` map with `{type:'rpc:response', correlationId, success, data}` (`libs/frontend/core/src/lib/services/claude-rpc.service.ts:85-92`). It blocks non-static `fetch`, XHR, `WebSocket` and `EventSource`. It plays `timeline` messages as window `MessageEvent`s, the same as the Electron preload (`preload.ts:71-73`). It exposes `window.__ptahReplay` (play, pause, setSpeed, restart, state, misses) and a parent-frame control channel `{source:'ptah-replay-control', cmd, value}`.
- `scenarios/chat-tool-call.json`: an `rpc` map (28 methods) and a `timeline` of `chat:chunk` events and `session:turnEnded`. All data is fake (`/workspace/acme-app`, branch `demo`).
- `serve.mjs`: a dependency-free static server. It serves the build at `/` and the spike files at `/replay/`. It removes the CSP meta, injects the bridge, and rewrites Google font URLs to the font copies in `libs/frontend/webview-e2e-harness/src/lib/fonts`.
- `capture.mjs`: a Playwright script. It records requests, misses, console errors, timings and three screenshots in `evidence/`.

Run: `node task-tracking/landing-live-demo/spike/capture.mjs` (needs the production webview build in `dist/`). Manual: `node task-tracking/landing-live-demo/spike/serve.mjs 4873`, then open `http://localhost:4873/?autoplay=0`.

Reuse: the harness is TypeScript with the tag `scope:webview`, and the landing projects are `scope:landing` / `scope:web` (`eslint.config.mjs:306-329`). The bridge therefore copies only the harness patterns (early bridge install, `MessageEvent` injection, CSP removal, font copies). It does not import the harness.

## 4. What broke, and the status

| Area | What happened | Status |
| --- | --- | --- |
| CSP | The index CSP blocks the injected bridge. | Fixed in `serve.mjs` (meta removed). Production: ship a demo-specific CSP (Electron list from `apps/ptah-electron/scripts/copy-renderer.js:159-173`, `connect-src 'self'`, `frame-ancestors 'self'` as a header). |
| Boot handshake | Electron has no ready message. The plain build has no host `webview-ready` script. | **Bug, open.** The bridge polls `app-root` (`replay-bridge.js:195`), but the root element is `<ptah-root>` (`apps/ptah-extension-webview/src/index.html:185`). The poll always runs to its 10 s fallback, so playback starts 10–18 s late (`run.json` `shellReadyMs: 18721`). Fix: poll `ptah-root`. The app itself paints in about 1.6 s. |
| Missing RPC answers | The first boot had unanswered methods and wrong `update:get-state` / analytics shapes, which caused Angular errors. | Fixed. 28 methods answered, zero misses. |
| Wrong answer shapes (silent) | The coordinator run logged warnings, not errors: `Invalid attention snapshot dropped` (retried, then "retries exhausted"), `provider:getPlanLimits returned a malformed snapshot`, `SurfaceRoutePersistence: Not persisting a route…`. The inspector shows "Usage: Unavailable". | **Open.** The capture counted only `console.error`. The full feature must type-check the scenario (section 7) and fail on these warnings. |
| Auth gating | A missing credential in `auth:getAuthStatus` sends the shell to Settings (`libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:275-305`). | Fixed in the scenario. |
| License gating | None. License is identity-only (`libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts:80-90`). The free `community` answer works. | No action. |
| Routing / base href | Routing is memory-backed, not hash- or path-based (`apps/ptah-extension-webview/src/app/app.config.ts:198-227`). The build has `<base href="/">`. | The spike serves at `/`. Production must rewrite the base to `/demo/` and keep the lazy chunks and worker assets in the same tree. |
| Empty transcript | The Electron shell switches workspace after it creates the first tab, and the requested tab was dropped. | Worked around: the bridge seeds a fixed `localStorage` key (`replay-bridge.js:119-131`). This is fragile, and it races with `initialSessionId` (review B2). Replace in phase 1. |
| Fonts | `styles.css:7` imports Google Fonts. | Rewritten to local copies by `serve.mjs`. Production must self-host the three families. |
| Visual defects | The header chip and the session card say "done" while the message says "Working". The user bubble shows 10:00 PM and the assistant 8:00 PM. The card preview reads "Now The app starts…". | **Open.** Missing `turn_state` events (B3) and the streaming timestamp (m3). The card text is correct ("Now" label + newest block). See section 11. |
| Brand | The app shell still shows "Ptah". | Changes when rebrand PR #871 merges. The demo copy takes the brand from the build. |

## 5. RPC and message list the bridge must answer

Wire format: outbound `{type:'rpc:call', payload:{method, params, correlationId}}`; inbound top-level `{type:'rpc:response', correlationId, success, data?, error?, errorCode?}`. RPC responses must never be inside a `batch` (`libs/frontend/core/src/lib/services/message-router.service.ts:161-180`).

**Answered in the spike (chat boot and playback, 28):** `boot:getReadiness`, `displayWindow:status`, `update:get-state`, `chat:agent-sessions`, `config:models-list`, `config:pricing-get`, `config:effort-get`, `config:autopilot-get`, `auth:getAuthStatus`, `auth:getScope`, `license:getStatus`, `workspace:getInfo`, `workspace:switch`, `ptahCli:list`, `session:list`, `session:load`, `session:status`, `session:cli-sessions`, `chat:resume`, `chat:setStreamViewport`, `attention:getSnapshot`, `artifacts:list`, `provider:getPlanLimits`, `git:info`, `git:branches`, `git:stashList`, `git:lastCommit`, `git:turnChangeSets`.

**Needed by the next scenarios (from research section 1b):**

- Tribunal Council: the standalone Tribunal route is retired and restores to chat (`libs/frontend/core/src/lib/services/app-state.service.spec.ts:623-634`). Replay it as a chat stream with council events. Add `chat:history-page`, `session:stats-batch`, `chat:pending-questions`.
- Multi-agent orchestration: `chat:subagent-query`, `subagent:history-page`, `chat:running-agents`, `session:cli-output-page`, `agent:getLanePlanLimits`, `agent:detectClis`, `agent:getConfig`, `provider:listAccounts`, `provider:getAmbientClaudeStatus`.
- Command Center (Electron-only route, `apps/ptah-extension-webview/src/app/app.routes.ts:203-217`): `session:list`, `session:load`, `chat:resume`, `voice:getProviderConfig`.
- All writes (`chat:start`, `git:commit`, `config:*-set`, …): answer `{success:true}` with the typed empty result, and do nothing. The full list with read/write classes is in `research-recorder-and-protocol.md` section 1c.

**Host → webview pushes used:** `chat:chunk` (`payload {tabId?, sessionId?, event: FlatStreamEventUnion}`, `libs/shared/src/lib/types/execution/stream-background.ts:319`), `session:turnEnded`. **Next:** `batch`, `chat:complete`, `chat:streamSnapshot`, `session:id-resolved`, `session:stats-live`, `session:subagentEnded`, `agent-monitor:spawned|output|exited` (CLI lanes), `permission:request`, `planLimits:changed`.

**Outbound types seen:** `rpc:call`, and the `webview-ready` that the bridge synthesizes.

## 6. Recorder design

1. **Tap point:** the Electron main process in `IpcBridge`, not the preload. It sees both directions in the real delivery order: requests after sender validation (`apps/ptah-electron/src/ipc/ipc-bridge.ts:413-463`), pushes at each `webContents.send('to-renderer', …)` (`:219`, `:329-339`), and responses (`:471-478`).
2. **Output:** a raw capture `{rpc:{[method]: responseData}, timeline:[{at, message}]}` with `at` = `performance.now()` from recorder start. Keep `batch` envelopes and their order. Keep `rpc:response` out of the timeline, because the bridge answers RPC on demand. Save failures as `__rpcEnvelope {success:false, error}`.
3. **Gate:** all three conditions are necessary: `!app.isPackaged`, `NODE_ENV === 'development'`, `PTAH_REPLAY_RECORD=1`. Also add a build constant `__PTAH_REPLAY_RECORDER__` in `apps/ptah-electron/esbuild.config.cjs` (pattern at `:52-71`). It is `false` in production, so minification removes the tap. Write raw output only to an explicit path outside `dist` and `public`.
4. **Sanitize (offline step, `scripts/replay/sanitize-scenario.mjs`):** allow-list of RPC methods and push types (fail closed on unknown ones). Replace home and workspace paths with `/workspace/acme-app`. Replace emails, names, usernames, account labels, hostnames, IPs and URL credentials with fixed fixtures. Redact secret fields and text with `isSecretFieldName()` / `redactSecrets()` (`apps/ptah-electron/src/services/diagnostics/log-redaction.ts:14-54`) plus JWT, GitHub, AWS, Slack, Anthropic, OpenAI, PEM and cookie patterns. Replace tool results, diffs and CLI output with curated text unless the file is on a public allow-list. Normalize timestamps to one fixed base.
5. **Record from a synthetic workspace** (public sample repository, synthetic accounts). Redaction is a second barrier, not the first.
6. **Privacy test (Jest):** scan every key and string of each published scenario. Fail on emails, home paths, non-allow-listed hosts and IPs, credential field names, bearer/JWT/API-key shapes, PEM blocks, large base64, and canary secrets that the sanitizer unit tests insert. Sanitizer unit tests live in `ptah-electron`.
7. **Human review:** each new scenario needs a screenshot review before merge.

## 7. CI guard against protocol drift

Location: `libs/web/landing` (Nx project `web-landing`, `scope:web`). `scope:web` may import `scope:shared` (`eslint.config.mjs:318-329`), so the test can use the shared registry without a webview import.

1. **Runtime Jest test:** for each scenario, each `rpc` key is in `RPC_METHOD_NAMES` (`libs/shared/src/lib/types/rpc.types.ts:3686-3688`). Each timeline `type` is in `Object.values(MESSAGE_TYPES)` (`libs/shared/src/lib/types/messages/message-constants.ts:374-377`). `at` values are non-negative and ordered. Validate payloads with Zod where schemas exist.
2. **Type test:** a generated `*.scenario.generated.ts` holds the JSON as a const value that `satisfies ReplayScenario`, with `rpc: {[M in RpcMethodName]?: RpcMethodResult<M>}`. The `web-landing` typecheck then catches shape drift such as the `provider:getPlanLimits` and `attention:getSnapshot` shapes in section 4. `MessagePayloadMap` (`libs/shared/src/lib/types/messages/payload-map.ts:337-513`) lacks some streaming entries. Add them first, or the type test has gaps.
3. **Boot smoke test (optional, CI e2e job):** run `capture.mjs`-style playback of every scenario against the current webview build. Fail on any miss, console error, or the known "malformed"/"invalid" warnings. This catches behavior drift that types do not show (for example the workspace tab switch).

## 8. Mobile fallback

On viewports below about 768 px, or with `prefers-reduced-data`, show a video instead of the iframe. Render the video with the showcase pipeline:

- The showcase launcher runs real authenticated Electron with no mocks (`apps/ptah-electron-e2e/src/showcase/_harness/showcase-launcher.ts:5-23`). Add a replay mode that loads the same `replay-bridge.js` and scenario, so the video and the live demo show the same data. `Director`, `beats.json` and `shots.json` stay the same.
- Templates: `chat-code-edit.scene.ts` (Council/chat), `canvas-orchestra.scene.ts` (multi-agent), `lane-console-review.scene.ts` (CLI lanes), `dashboard-tour.scene.ts` (navigation pattern for Command Center).
- Pipeline (not run in this spike): `narrate.mjs --scene <slug>` → `nx run ptah-electron-e2e:showcase` (or a per-scene target) → `caption.mjs` → `render-all.mjs --scene <slug>`. CI rendering (`.github/workflows/render-showcase.yml`) accepts uploaded recordings.
- The video can also be the poster: the first frame as a still image, and the loop as a muted preview before the user clicks.

## 9. Landing section UX

- **Placement:** a new section "See PtahCode work" after the hero. It replaces the hand-built `council-demo.component.ts` mock (`libs/web/landing/src/lib/console/`) and the device mock in `hero-device-showcase.component.ts` only in a later, separate change.
- **Frame:** a desktop-window chrome (traffic lights, title "PtahCode") around a 16:10 iframe. Before load: a static poster (WebP from the video) with a play button. Load the iframe when the user clicks, or when the section is visible and the connection is not "save-data". Use `loading="lazy"`, `sandbox="allow-scripts allow-same-origin"` and `title` for accessibility.
- **Scenario tabs:** "Tribunal Council", "Multi-agent orchestration", "Command Center". A tab change posts `{source:'ptah-replay-control', cmd:'load', value:'<scenario>'}` (new command) or reloads the iframe with `?scenario=<id>`.
- **Controls:** play/pause, speed (1×, 2×, 4×), restart, and a progress bar from `__ptahReplay.state` (`elapsed`, `index`, timeline length). The iframe posts state to the parent (new `ptah-replay-state` message), so the parent does not reach into the iframe.
- **Behavior:** autoplay once at 1× when visible. Pause when the section leaves the viewport or the tab is hidden. Respect `prefers-reduced-motion` (no autoplay; show the poster). End with a "Download PtahCode" call to action over the finished frame.
- **Interactivity:** the demo is read-only. The bridge answers writes as no-ops. Show a small "Replay — recorded session" badge so users do not expect a live model.

## 10. Risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Protocol drift | A scenario breaks silently when an RPC or event shape changes (already seen: two malformed answers that only warn). | Section 7 type test + boot smoke test. |
| Internal storage coupling | The seeded tab key breaks when the tab storage format changes. | Replace the seed with host messages or RPC answers (section 11), or a single `ptahConfig` demo flag that the app reads. |
| Same-origin iframe | The message router does not check `event.origin` (`message-router.service.ts:110-115`). The demo shares the landing origin and its `localStorage`. | Serve only curated scenarios. Validate the control channel origin. Prefix or clear demo storage keys. Consider a subdomain such as `demo.ptah.live` for full isolation. |
| Privacy leak in recordings | Paths, names, keys in transcripts or tool output. | Synthetic workspace, fail-closed sanitizer, Jest privacy test, human review. |
| Bundle weight | 1 MB compressed per view, 23 MB total in the deploy. | Load on click/visible only, video on mobile, long-cache with content hashes. |
| Hosting headers | DigitalOcean App Platform static hosting (`.do/app.yaml:48-64`) shows no per-path header support in the repository. | Confirm support for CSP/cache headers on `/demo/`. Fallback: meta CSP (no `frame-ancestors`). |
| SPA catch-all | `index.csr.html` is the App Platform catch-all. A wrong `/demo/` path returns the landing page, not a 404. | Copy step test that `/demo/index.html` exists in the landing dist. |
| Build coupling | The landing deploy must build the webview too (longer CI). | Copy a cached webview artifact. Run the copy only in the landing deploy workflow. |
| Brand drift | The demo shows the brand of the webview build. | Build the demo from `main` after PR #871 merges. |

## 11. Review findings

Independent review: antigravity (Gemini family; the implementer was codex). Full text: `spike-review.md`. Verdict: **feasible with changes**. The coordinator verified B1 and M1 in the source. All findings are in the spike code or the scenario data, not in the approach. They go into phase 1 (B1 runtime, B2 contract). The spike was not changed after the review, because the scope is to stop at this report.

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| B1 | blocker | Ready poll looks for `app-root`, not `ptah-root`. Playback starts 10–18 s late. | Poll `ptah-root`. |
| B2 | blocker | Two session seeds race: `ptahConfig.initialSessionId` (pop-out path, not set by real Electron) and the `localStorage` tab seed. The two runs showed different user prompts. `activeTabId()` can pick a stale tab. | Remove `initialSessionId` and the `localStorage` seed. Open the session with a host message (`agentSession:opened` / `sessionHandoff:opened`) after `workspace:switch`. |
| B3 | blocker | No `turn_state` `generating` at turn start and no `message_complete`, so header, card and inspector show "done" during the stream. | Add both events to the timeline. The recorder captures them automatically. |
| B4 | blocker (production) | `/demo/` hosting needs a build-time copy step: base href, bridge injection, local fonts, CSP. `serve.mjs` does not exist on static hosting. | Phase 1 B3 copy step. |
| M1 | major | `attention:getSnapshot` must be `{notices: []}`. `provider:getPlanLimits` must be `{generatedAt, owners: [], sessionOwners: {}}`. Wrong shapes cause retry loops and "Usage: Unavailable". | Typed scenario (section 7). Capture fails on warnings. |
| M2 | major | Tab id `ptahcode-demo-tab` is not a UUID v4, so `TabId.validate` rejects it (route sync warning). | Use UUID v4 ids. |
| M3 | major | No `event.origin` check in the control listener. The app message router does not check the origin either. | Check origin and source in the bridge. Serve only curated scenarios. |
| M4 | major | The JS network stub does not stop `<img>`, CSS `url()`, workers or `sendBeacon`. | Keep a strict self-only CSP in `/demo/index.html`. |
| m1 | minor | `window.ptahClipboard` is not stubbed. | Add a no-op stub. |
| m2 | minor | RPC answers are keyed by method only. | Add params-keyed overrides, and typed empty defaults. |
| m3 | minor | The streaming bubble shows the viewer's clock until the turn ends (8:00 PM vs 10:00 PM). | Shift scenario timestamps to `Date.now()` at load. |

The review refuted one coordinator finding: "Now The app starts…" is a "Now" label plus the newest text block, not a join bug.

Coordinator finding not in the review: `capture.mjs` counted only `console.error`, so the lane report "zero console errors" hid the warnings.

## 12. Phased implementation plan (file-disjoint batches)

Phase 1 needs the user's approval of this report. Each batch is one lane. Batches in the same phase do not share files.

**Phase 1: replay runtime and contracts**

- **B1 – replay runtime** (`apps/ptah-landing-page/public/demo-replay/replay-bridge.js` or a small `libs/web/replay-runtime` TS library compiled to one classic script): port the spike bridge, fix review B1, B2, M2, M3, m1, m2, m3, add `load` and `ptah-replay-state` messages and a storage-key prefix.
- **B2 – scenario contract and CI guard** (`libs/web/landing/src/lib/live-demo/scenario/*.ts`, `*.spec.ts`): `ReplayScenario` type, runtime Jest test, generated-type test, privacy test. Fix the chat scenario (review B3, M1).
- **B3 – demo copy step** (`apps/ptah-landing-page/project.json`, `scripts/landing/copy-webview-demo.mjs`, `.github/workflows/deploy-landing.yml`): copy the webview build to `dist/ptah-landing-page/browser/demo/`, rewrite base href, inject the bridge and the demo CSP, self-host the fonts, add content hashes or cache rules.

**Phase 2: scenarios and recorder**

- **B4 – recorder** (`apps/ptah-electron/src/ipc/replay-recorder.ts`, `ipc-bridge.ts` tap lines, `esbuild.config.cjs` define): dev-only tap with the triple gate.
- **B5 – sanitizer** (`scripts/replay/sanitize-scenario.mjs` + its tests in `ptah-electron`).
- **B6 – three scenarios** (`libs/web/landing/src/lib/live-demo/scenarios/*.json`): Tribunal Council, multi-agent orchestration, Command Center. Record from a synthetic workspace, sanitize, review screenshots.

**Phase 3: landing section and fallback**

- **B7 – landing section** (`libs/web/landing/src/lib/sections/live-demo/*`): poster, lazy iframe, scenario tabs, play/pause/speed/restart, progress, reduced-motion and visibility rules, "Replay" badge. Add the section to the landing page without removing existing sections yet.
- **B8 – mobile video** (`apps/ptah-electron-e2e/src/showcase/_harness/replay-launcher.ts`, three `*.scene.ts`, scripts JSON): render the three scenarios to WebM/MP4 and the posters.
- **B9 – visual review in a browser** (Electron-first rule: the demo itself runs in a browser iframe): desktop and mobile breakpoints, contrast, focus order.

**Phase 4 (separate approval):** remove the old mocks (`council-demo.component.ts`, the device mock in `hero-device-showcase.component.ts`).

## 13. Decisions and assumptions

- The spike code lives in `task-tracking/landing-live-demo/spike/`, not in `apps/ptah-landing-page/public/`, so the landing build does not ship unfinished files. No landing section changed.
- The evidence PNGs are committed with the spike for the record (about 6 MB). They can be removed before the final PR if the user prefers.
- No `npm run verify` ran: the spike changed no Nx project (only `task-tracking/`).
