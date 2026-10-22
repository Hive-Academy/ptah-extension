# Current pipeline inventory: how an agent shows visual output in Ptah today

Task: TASK_2026_710_html — inventory of every path where agent output becomes UI, the
Electron security posture around embedding agent HTML, and where a sandboxed free-HTML
artifact would plug in. Evidence is file:line from this worktree
(`D:\projects\ptah-extension\.claude-worktrees\agent-html-freedom`). Electron is the
priority host. Items not confirmed by a direct read are marked **UNVERIFIED**.

## Summary

- Every agent-output-to-UI path today runs through a fixed schema or a sanitizer. No
  path lets agent-authored HTML, CSS or JS execute inside the Electron app shell.
- Two fixed catalogs carry the structured paths: the `ptah-ui` chat fence DSL
  (converted to `dashboard-catalog/4`, 21 kinds) and the `ptah_surface_update` /
  `ptah_dashboard_propose_spec` JSON tools (`dashboard-catalog/3`, 19 kinds, plus the
  v1 read-only dashboard contract). Both are plain text only: an unknown key rejects
  the whole document.
- Chat markdown is the one place agent HTML survives, as an inert DOMPurify subset:
  no `script`/`style`/`iframe`/`form`/`input`/`dialog`, class allowlist, no
  positioning styles, wrapped in a `contain: layout paint` root.
- The Electron shell is locked down for embedding: `contextIsolation`, `sandbox`,
  `nodeIntegration: false`; build-time CSP with `frame-src 'none'`, `script-src
  'self'`; no custom protocol handlers; no `<webview>`; a navigation guard that
  cancels every non-same-document navigation. No in-app preview of a local
  agent-written HTML file exists today.
- The only screen where arbitrary HTML renders today is the agent-driven CDP
  `BrowserWindow` (`ElectronBrowserCapabilities`), and the namespace layer restricts
  it to `http:`/`https:`. Ranked plug-in points: that window seam (least change,
  separate OS window), then the display panel (best embedded fit; needs a new catalog
  kind, a validator branch, one sandboxed host component and a CSP `frame-src`
  carve-out).

## Paths: agent output → UI

| # | Path | Agent emits | Validation | Render | Free HTML possible? | Limits |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Chat assistant markdown | Markdown with limited HTML | DOMPurify `'full'` deny-list: `libs/frontend/markdown/src/lib/provide-markdown-rendering.ts:200-284` (`FORBID_TAGS` :230-252, `FORBID_ATTR` :253-278, class allowlist :42-69, positioning-style drop :79-116, containment root :223-225) | ngx-markdown `<markdown>` + `SurfaceMarkdownPipe`, driven by `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-message-text.component.ts:63-80` | Partial — inert HTML subset only (tables, details, SVG, kbd, inline style minus positioning) | No `script`, `style`, `dialog`, `iframe`, `object`, `embed`, `form`, `input`, `textarea`, `select`, `button`; `on*` handlers and popover family dropped; class tokens limited to a pipeline allowlist; `data:`/`https:`/`mailto:`/`tel:` URIs (:281-283) |
| 2 | ` ```ptah-ui ` inline fence | The ptah-ui DSL grammar (EBNF: `.claude/skills/ptah-surface-authoring/references/ptah-ui.md:27-96`) with host sources `$diff` `$tests` `$usage` `$agents` `$limits` | Shared pipeline: `libs/shared/src/mcp-apps-contracts/ptah-ui-fence.ts:21` (`segmentPtahUi`), `ptah-ui-pipeline.ts:49` (`compilePtahUiBlock`), `:80` (`resolveCompiledPtahUiBlock`), parser/converter in the same folder; converted block validated as `dashboard-catalog/4` by the surface zod schemas | `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-block.component.ts:48-70` → `SurfaceRendererComponent` from `libs/frontend/declarative-dashboard` | No — fixed catalog, plain text | 8,192 bytes / 200 lines per fence; 200 components, depth 8, 50 children, 4 grid columns (ptah-ui.md:167); 21 kinds in catalog/4 (surface-catalog.ts:20,69-84) |
| 3 | ` ```ptah-ui display [id] ` fence | Same DSL, sent to the side display panel; id replaces a surface in place (ptah-ui.md:14-15) | Same as row 2 plus id rules: `^[A-Za-z0-9][A-Za-z0-9._-]*$`, ≤128 chars, `ptah.*` reserved (ptah-ui.md:19-23) | `libs/frontend/chat-ui/src/lib/organisms/display-panel/display-panel.component.ts` (read-only interaction :48-60); Electron dock sheet (`chat-view.dock.spec.ts:697`); surfaces compiled via `display-surfaces` (`ptah-ui-block.component.ts:37-40`) | No | Display surfaces are read-only: no selection, no submit (display-panel.component.ts:53-60); invalid display block leaves the panel unchanged |
| 4 | `ptah_surface_update` MCP tool (Apps page and chat) | JSON: `dashboard-spec/2` + `dashboard-catalog/3` document, or patch ops (`set-data`, `add-component`, `replace-component`, `set-title`, …) | Zod schemas `libs/shared/src/mcp-apps-contracts/surface.schemas.ts` (strict JSON boundary, :1-80) + the one boundary validator `libs/shared/src/mcp-apps-contracts/surface.validator.ts:1-37` (iterative preflight walk, byte budget, version pair, zod parse, semantic checks); all-or-nothing (`surface-tools.ts:218-219`) | `libs/frontend/declarative-dashboard/src/lib/components/surface-renderer.component.ts` + `surface-node.component.ts` (all components in that folder); backend state `libs/backend/vscode-lm-tools/src/lib/surface/surface-state.service.ts`, `surface-agent-mutations.ts` | No — "You emit JSON from a FIXED catalog; you never write HTML, CSS or a template" (`surface-tools.ts:185-186`) | 19 kinds (surface-catalog.ts:62): layout `section, stack, grid, card`; input `text, select, radio-group, checkbox`; display `stat, line-chart, bar-chart, table, list, alert, badge, progress, radial-progress, divider, text-block`; strings ≤2,000; 200 components; 100 inputs; 1,000 rows; revision staleness; per-session and per-host store caps (surface-tools.ts:220-223) |
| 5 | `ptah_dashboard_propose_spec` MCP tool | JSON: read-only v1 dashboard spec (`dashboard-spec/1` + `dashboard-catalog/1`) | v1 validator `dashboard-spec.validator.ts` (referenced at surface.validator.ts:3-4) | Same declarative-dashboard renderer; v1 renderables supported (trust-boundary.spec.ts:39-42) | No | Read-only dashboards only; v1 ids reserved (`ptah:` prefix, surface-tools.ts:217) |
| 6 | Apps page | Conversation on the Apps page; the system prompt directs the agent to build with `ptah_surface_update` and read state with `ptah_surface_get_state` | Same as row 4; prompt contract `libs/frontend/mcp-apps-page/src/lib/apps-system-prompt.ts:11-32` | `libs/frontend/mcp-apps-page` app panel beside the chat (exact page component **UNVERIFIED**) | No | Interactive surfaces (inputs, `surface.submit`, `dashboard.select`) — still fixed catalog, plain text |
| 7 | ` ```mermaid ` fence in chat | Mermaid diagram source | `libs/frontend/chat-ui/src/lib/organisms/mermaid/mermaid-diagram.component.ts:11-12,73` — compiled SVG sanitized with a DOMPurify SVG profile | `mermaid-diagram.component.ts`; segmented by `ptah-ui-message-text.component.ts:15,35` | No | SVG subset only; extracted CSS sanitized; no script |
| 8 | Canvas (Orchestra) | Nothing direct — the canvas is a session board, not an agent-artifact surface | n/a — `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:44-60` (Rail board of session tiles; recent "canvas open timeouts" fix concerns session open, not HTML) | Canvas detail = transcripts and lane views (`canvas-detail/canvas-detail-transcript.component.ts`, `canvas-lane-view.component.ts`); reuse of the chat transcript components **UNVERIFIED** | No | Agent output inside canvas detail goes through the same chat rendering as rows 1-3 |
| 9 | Browser window (agent-driven CDP window) | `navigate` / `click` / `type` / `evaluate` / `screenshot` calls through the browser namespace tools | URL gate at the namespace layer: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/browser-namespace.builder.ts:155-181` — only `http:` and `https:` schemes | `apps/ptah-electron/src/services/electron-browser-capabilities.ts` — separate `BrowserWindow` (:382-392), CPD debugger attach (:394), navigate (:65-112), screenshot (:114-138) | Yes — arbitrary remote pages render, but in a separate OS window, not embedded in the app | `file:` blocked, so a local agent-written `index.html` cannot be opened this way; 5/15-min inactivity timeout, 30-min max lifetime (:29-32); sandboxed window, no preload; tool names as exposed in the Electron profile **UNVERIFIED** |

Component catalog sizes (rows 2 and 4): `dashboard-catalog/3` = 19 kinds;
`dashboard-catalog/4` = /3 plus `accordion` (layout), `avatar` (display) and the
`stat.trend` / `stat.spark` fields (`surface-catalog.ts:62,69-84`; full kind list with
one JSON example each: `.claude/skills/ptah-surface-authoring/references/catalog.md`).

## Electron security posture (embedding agent HTML)

- **Main window webPreferences**: `apps/ptah-electron/src/windows/main-window.ts:123-129`
  — `preload.js`, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
  `webSecurity: true`.
- **Navigation guard**: `main-window.ts:71-84` — `will-navigate` cancels every
  non-same-document navigation (including relative `file:` links from rendered
  markdown, see comment :56-66); `setWindowOpenHandler` denies all window opens and
  hands only known-safe schemes to `shell.openExternal` (`openExternalSafely`
  :44-48; the exact `isSafeExternalUrl` scheme list is **UNVERIFIED**).
- **Permission policy**: `installPermissionPolicy` wired at `main-window.ts:136-139`
  (contents **UNVERIFIED**; `apps/ptah-electron/src/windows/permission-policy.spec.ts`
  exists).
- **Renderer CSP**, injected at build time by
  `apps/ptah-electron/scripts/copy-renderer.js:159-172`:
  `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' https: data: blob:; font-src 'self' https://fonts.gstatic.com data:; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-src 'none'; form-action 'none'`.
  **`frame-src 'none'`** means no iframe of any origin can be embedded in the shell
  today. Inline scripts are lifted into sha256-named files (`copy-renderer.js:84`,
  `:123-135`). The static splash `apps/ptah-electron/src/assets/preparing-workspace.html:6-7`
  carries its own `default-src 'none'` policy.
- **Custom protocols**: none — no `protocol.handle`, `registerFileProtocol` or
  `registerSchemesAsPrivileged` in `apps/ptah-electron/src` (grep: no matches).
- **`<webview>` tag**: none in source (grep hits only old task-spec research notes).
- **iframe / srcdoc in frontend libs**: none in the chat, display or dashboard
  surfaces. The only iframe precedents live in the separate web app, not the Electron
  shell: a sandboxed srcdoc email preview
  (`libs/web/admin/src/lib/marketing/components/email-preview-frame/email-preview-frame.ts:22,86,91`,
  DOMPurify-cleaned body) and a YouTube embed
  (`libs/web/members/src/lib/learning/youtube-player.ts:150,273`).
- **Declarative-dashboard hard guard**: `libs/frontend/declarative-dashboard/src/lib/trust-boundary.spec.ts:370`
  statically scans the whole lib for `innerHTML`, `outerHTML`,
  `insertAdjacentHTML`, `bypassSecurityTrust`, `DomSanitizer` and `<iframe` — the lib
  must keep no HTML sink at all; producer text renders literally with no element
  created from it (:20-33, :71-77).
- **Agent-driven browser window**: `electron-browser-capabilities.ts:382-392` —
  `BrowserWindow` with `contextIsolation: true, nodeIntegration: false, sandbox: true,
  webSecurity: true`, no preload; scheme restriction is enforced one layer up at
  `browser-namespace.builder.ts:155-181` (http/https only).
- **Local HTML preview in-app today**: not possible — `file:` is blocked for the
  browser namespace, the shell navigation guard cancels `file:` navigations
  (`main-window.ts:56-66`), and no protocol serves project files.
- Secondary host (VS Code extension, not priority): the webview CSP lives at
  `apps/ptah-extension-vscode/src/services/webview-html-generator.ts` (around line
  270, per the cross-reference in `copy-renderer.js:147-155`) — **UNVERIFIED** by
  direct read.

## Plug-in points for a sandboxed free-HTML artifact (ranked)

1. **Browser-capabilities window** — least change, separate OS window. The sandboxed
   window already exists (`electron-browser-capabilities.ts:382-392`); the only guard
   to touch is the http/https gate at `browser-namespace.builder.ts:170-181`, widened
   with a path-confined carve-out (a vetted `file:` root or a new
   `ptah-artifact://`-style URL). No shell CSP change. Costs: not embedded in the
   app; the 5/15/30-min lifetime caps apply.
2. **Display panel surface** — best embedded fit. The panel already hosts
   id-addressed, replaceable surfaces (`display-panel.component.ts`;
   ptah-ui.md:14-15). Needed guards: a new surface kind (the catalog rejects unknown
   keys, and "No kind has a `class`, `style` or `html` field" — catalog.md:7), a
   validator branch in `surface.schemas.ts` / `surface.validator.ts`, one dedicated
   host component with a sandboxed `<iframe sandbox srcdoc>` (or a custom protocol
   once one exists), an exemption in the `trust-boundary.spec.ts:370` static scan for
   that single component, and a `frame-src` carve-out in `copy-renderer.js:170`.
3. **Apps page panel** — same mechanism as 2, but interactive; also needs the kind
   documented in `apps-system-prompt.ts`. Same validator and CSP changes, more
   surface area because inputs and actions exist around it.
4. **Canvas tab / new shell tab** — most new code: a tab host plus everything from 2.
   The canvas itself is the wrong shape (a session board,
   `orchestra-canvas.component.ts:44-60`).
5. **Chat markdown relaxation** — rejected: wrong layer. The sanitizer's deny list
   exists precisely to keep agent HTML inert inside the trusted shell
   (`provide-markdown-rendering.ts:230-252`).

## Decisions

- **D1 — Classification: canvas is not an agent-visual-output path.** Options:
  treat canvas as a plug-in point vs. a session board. Evidence:
  `orchestra-canvas.component.ts:44-60` shows tiles are sessions; the recent
  "canvas open timeout" work is session open. Reversible.
- **D2 — Ranking: browser-capabilities window first for least change, display panel
  first for embedded UX.** Options: separate window, display panel, Apps page,
  canvas tab, markdown relaxation. Evidence: window seam exists
  (`electron-browser-capabilities.ts:382-392`) with one gate to widen; display
  pipeline is id-replaceable but sits behind four guards (catalog/validator, static
  HTML-sink scan, CSP `frame-src 'none'`, sandboxed host component). Reversible.
- **D3 — Any embedded artifact must render through a dedicated sandboxed iframe host
  component, never through the markdown sanitizer or a new catalog field on existing
  kinds.** Evidence: markdown forbids `iframe` outright
  (`provide-markdown-rendering.ts:244`), and `trust-boundary.spec.ts:370` forbids any
  HTML sink in the dashboard lib — both guards stay intact if the artifact is one
  isolated component. Reversible.

## Unknowns

- Exact Apps page panel component (render side of row 6) — **UNVERIFIED**.
- `isSafeExternalUrl` scheme list definition — **UNVERIFIED** (call site
  `main-window.ts:45`).
- `installPermissionPolicy` contents — **UNVERIFIED**.
- VS Code webview CSP details (`webview-html-generator.ts`) — **UNVERIFIED**
  (secondary host).
- MCP browser tool names as registered in the Electron app profile — **UNVERIFIED**.
- Whether canvas detail reuses the chat transcript components for ptah-ui blocks —
  **UNVERIFIED**.
- Exact store-limit values behind `describeSurfaceLimits()` and
  `SURFACE_STORE_LIMITS` — not read in this pass.