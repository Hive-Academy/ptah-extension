# Implementation plan: PtahCode live demo (Phases 1–3)

Approved scope: `spike-report.md` §12, batches B1–B9. Phase 4 (remove `council-demo.component.ts` and the hero device mock) is NOT approved. Keep all existing landing sections.

This file is the shared contract between lanes. Do not change a contract on your own. If a contract does not work, stop and report it to the coordinator.

## Directory layout and ownership

| Batch | Owner files (only these) |
| --- | --- |
| B1 runtime | `libs/web/landing/src/lib/live-demo/runtime/**` |
| B2 contract | `libs/web/landing/src/lib/live-demo/scenario/**`, `libs/web/landing/src/lib/live-demo/scenarios/chat-tool-call.json`, `libs/web/landing/src/lib/live-demo/scenarios/chat-tool-call.scenario.generated.ts`, `scripts/landing/generate-live-demo-types.mjs` |
| B3 copy step | `scripts/landing/build-live-demo.mjs`, `scripts/landing/check-live-demo.mjs`, `scripts/landing/live-demo-static-server.mjs`, `apps/ptah-landing-page/project.json`, `scripts/do-build.sh`, `.github/workflows/deploy-landing.yml`, `.do/app.yaml` (only if needed) |
| B4+B5 recorder, sanitizer | `apps/ptah-electron/src/replay/**`, `apps/ptah-electron/src/ipc/ipc-bridge.ts` (tap lines only), `apps/ptah-electron/esbuild.config.cjs` (define only), `apps/ptah-electron/scripts/sanitize-replay-scenario.mjs` |
| B6 scenarios | `libs/web/landing/src/lib/live-demo/scenarios/{tribunal-council,multi-agent,command-center}.json` and their `*.scenario.generated.ts` |
| B7 section | `libs/web/landing/src/lib/sections/live-demo/**`, `libs/web/landing/src/lib/live-demo/live-demo-catalog.ts`, `libs/web/landing/src/lib/landing-page.component.ts` (one import + one tag) |
| B8 media | `scripts/landing/capture-live-demo-media.mjs`, `apps/ptah-landing-page/public/assets/live-demo/**` |

## Scenario format (JSON, one file per scenario)

Path: `libs/web/landing/src/lib/live-demo/scenarios/<id>.json`. `<id>` matches `^[a-z0-9-]+$`.

```jsonc
{
  "id": "chat-tool-call",
  "title": "Short title",
  "timeBase": 1793476800000,          // epoch ms that all recorded timestamps are relative to
  "config": {                         // merged over the default window.ptahConfig (Electron shape)
    "initialView": "chat",            // "chat" | "command-center"
    "workspaceRoot": "/workspace/acme-app",
    "workspaceName": "acme-app"
  },
  "rpc": { "<method>": <response data> },                       // answer = { success: true, data }
  "rpcCases": { "<method>": [ { "match": { /* subset of params */ }, "data": <data> } ] }, // optional, checked before rpc
  "rpcErrors": { "<method>": { "error": "text", "errorCode": "OPTIONAL" } },             // optional
  "timeline": [ { "at": 0, "message": { "type": "chat:chunk", "payload": { } } } ]      // host->webview, "at" = ms after playback start, ascending
}
```

Rules:

- All data is synthetic: workspace `/workspace/acme-app`, branch `demo`, fake UUID v4 ids. No real paths, names, emails, hosts, tokens or private code.
- Every tab id and session id is a valid UUID v4.
- `rpc:response` never appears in `timeline`. RPC responses are never inside a `batch`.
- A chat turn emits `turn_state` `phase: "generating"` before the assistant `message_start`, and `message_complete` before the terminal `turn_state` `phase: "idle"`.
- Timestamps: the runtime shifts every numeric value in `rpc`, `rpcCases` and `timeline` messages that lies in `[timeBase, timeBase + 86_400_000]` by `(Date.now() - timeBase)` at load. Use `timeBase`-relative values for all recorded times.
- `attention:getSnapshot` = `{ "notices": [] }`. `provider:getPlanLimits` = `{ "generatedAt": <timeBase>, "owners": [], "sessionOwners": {} }` (or real owners).

## Contract addition: session open (decided by the coordinator after B1)

The app had no host message that opens the first session tab (`batch-b1-notes.md` §"Exact session-open path"). Fix, owned by the B1 lane:

- `libs/shared/src/lib/types/messages/payload-map.ts`: `ViewChangedPayload` gets optional `sessionId?: string` and `sessionName?: string`.
- `libs/frontend/core/src/lib/services/app-state.service.ts` `handleMessage` (`switchView`): when `view === 'chat'` and `sessionId` is a non-empty string, call the existing `requestOpenSession({ sessionId, name: sessionName })` (it routes through `SessionOpenBridgeService` → `requestCanvasSession`). Otherwise the old behavior is unchanged. Add spec cases.
- Scenario field `bootMessages?: ReplayMessage[]`: the runtime injects them once after ready, before autoplay, then waits until the app answered the resulting RPC calls (quiet period again) before playback starts. Each scenario opens its session with `bootMessages: [{ "type": "switchView", "payload": { "view": "chat", "sessionId": "<uuid>", "sessionName": "<name>" } }]`.
- Timeline payloads carry the scenario `sessionId` and NO `tabId`. The app routes `chat:chunk` and `session:turnEnded` to the tab by `sessionId` (`batch-b1-notes.md` "Follow-up"). No storage seeding, no `initialSessionId`.

## Runtime (B1) contract

- Source: TypeScript in `libs/web/landing/src/lib/live-demo/runtime/`. Entry `replay-bridge.entry.ts` installs everything as a side effect. The copy step bundles it with esbuild to one classic IIFE script `/demo/replay-bridge.js`. Only type imports from `@ptah-extension/shared` are allowed (they are erased). No Angular imports.
- Query params of the iframe page: `scenario=<id>` (validated by the regex, default `chat-tool-call`), `autoplay=0|1` (default 1), `speed=<number>` (default 1).
- Fetches `scenarios/<id>.json` relative to `document.baseURI` (`/demo/scenarios/<id>.json`).
- Installs before Angular and before the inline theme script: `window.vscode` (`postMessage`, `getState`, `setState` with in-memory state seeded with `theme-v2: ptah-glass`), `acquireVsCodeApi()` (once), `window.ptahConfig` (Electron shape from `apps/ptah-electron/src/preload.ts:35-51`, no `initialSessionId`), `window.ptahClipboard` no-op stub.
- Replaces `window.localStorage` and `window.sessionStorage` with in-memory `Storage` objects, so the demo never reads or writes the landing origin storage and each load starts fresh. No storage seeding of internal app keys.
- Opens the scenario session only through RPC answers and host messages (for example `session:list`, `workspace:switch`, `session:load`, `chat:resume`, `agentSession:opened`), never through internal storage keys.
- Network: `fetch`, XHR, `WebSocket`, `EventSource`, `navigator.sendBeacon` allow only same-origin URLs under the document base. The demo CSP (B3) blocks declarative loads.
- Ready: playback starts when `ptah-root` has rendered child elements AND no `rpc:call` arrived for 300 ms, with a hard cap of 8 s after `DOMContentLoaded`. Record `readyAt`.
- Playback engine: play, pause, setSpeed, restart (restart = `location.reload()` with the same query), `state` = `{ scenario, ready, playing, complete, elapsed, duration, speed }`, `misses` list (unanswered RPC, unknown outbound type, blocked network, scenario load error). `window.__ptahReplay` exposes them.
- Parent control channel: accept `{ source: 'ptah-replay-control', cmd: 'play'|'pause'|'speed'|'restart', value? }` only when `event.origin === location.origin` AND `event.source === window.parent` AND `window.parent !== window`.
- State channel: on each state change (and at most every 250 ms while playing) post `{ source: 'ptah-replay-state', state }` to `window.parent` with `targetOrigin = location.origin`, only when embedded.

## Copy step (B3) contract

- Nx target `ptah-landing-page:build-demo` runs `node scripts/landing/build-live-demo.mjs`. It depends on `ptah-landing-page:build` and `ptah-extension-webview:build` (production).
- Script options: `--webview-dist <dir>` (default `dist/apps/ptah-extension-webview/browser`), `--out <dir>` (default `dist/ptah-landing-page/browser/demo`).
- Output: the webview build without `.map` files; `index.html` with `<base href="/demo/">`, the bridge `<script src="replay-bridge.js"></script>` as the first script in `<head>`, and a CSP meta: `default-src 'none'; script-src 'self' 'sha256-…' (one hash per inline script); style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self'; frame-src 'none'; base-uri 'self'; form-action 'none'`. Google font URLs replaced by self-hosted font files (copy from `libs/frontend/webview-e2e-harness/src/lib/fonts`). `replay-bridge.js` bundled from the B1 entry. `scenarios/<id>.json` copied from the scenarios folder, plus `scenarios/index.json` (list of ids).
- `check-live-demo.mjs`: Playwright smoke test. Serves a folder (default `dist/ptah-landing-page/browser`) with `live-demo-static-server.mjs`, opens `/demo/?scenario=<id>` for each scenario, waits for `state.complete`, and fails on any miss, console error, console warning, page error, or request outside the server origin. Writes a JSON summary.
- `scripts/do-build.sh` and `deploy-landing.yml` build the webview and run the copy step after the landing build, and assert that `demo/index.html`, `demo/replay-bridge.js` and `demo/scenarios/index.json` exist.

## Landing section (B7) contract

- Component `ptah-live-demo-section` in `libs/web/landing/src/lib/sections/live-demo/`. Insert after `<ptah-hero />` in `landing-page.component.ts`. Remove nothing.
- Catalog `live-demo-catalog.ts`: `tribunal-council` ("Tribunal Council"), `multi-agent` ("Multi-agent orchestration"), `command-center` ("Command Center").
- Media per scenario (B8): `/assets/live-demo/<id>.jpg` (poster, 1440×900) and `/assets/live-demo/<id>.webm` (mobile video).
- SSR-safe: render the poster at SSR. Create the iframe only in the browser, on click, or when visible on a ≥1024 px viewport without `prefers-reduced-motion` and without Save-Data. Below 768 px show the video (muted, playsinline, controls, `preload="none"`) instead of the iframe.
- iframe: `src="/demo/?scenario=<id>"`, `title="PtahCode live demo replay"`, `sandbox="allow-scripts allow-same-origin"`, `loading="lazy"`. Tab change reloads the iframe with the new id.
- Controls: play/pause, speed 1×/2×/4×, restart, progress bar from `ptah-replay-state`. Accept state messages only when `event.origin === location.origin` and `event.source === iframe.contentWindow`. Pause when the section leaves the viewport or the document is hidden.
- Text: heading "See PtahCode work", badge "Replay of a recorded PtahCode session", CTA "Download PtahCode" to `/download`. Use "PtahCode" in all new text.
- Accessibility: tabs with `role="tablist"` and arrow keys, labelled buttons, visible focus, contrast AA in the dark theme.

## Repository rules for every lane

- Read `/home/amun/ptah-extension/CLAUDE.md`. Work only in `/home/amun/ptah-extension/.claude-worktrees/feat-landing-live-demo-65fe00d920b7`. Edit only your owner files.
- Never commit, push, stash, reset, restore or checkout. Only the coordinator commits.
- Verify only with `npm run verify -- -t <target> -p <your project>` (scoped). The lock queue can be long: it prints a line every minute, so do not stop it. No `build`/`serve`/`dev`/`e2e`/`package` Nx targets. No workspace-wide commands.
- Electron first. Use "PtahCode" in new user-visible text.
