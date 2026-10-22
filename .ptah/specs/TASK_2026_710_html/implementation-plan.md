# Implementation Plan - TASK_2026_710_html

## Inputs and constraints

- Requirements: `context.md`, `external-research.md`, `current-pipeline-inventory.md`, `prior-tasks-synthesis.md` in this task folder; `TASK_2026_497_debb/containment-comparison.md` and its fixtures; headings of `TASK_2026_623_3492/design-spec.md` and `implementation-plan.md`; `.claude/skills/ptah-surface-authoring/SKILL.md`.
- `task.md` is absent in this task folder. The user's objective and fixed decisions settle the scope; no decision depends on that file.
- Design only. No implementation or verification command was run. The user explicitly requires file-disjoint batches, so the batch breakdown here supersedes the generic architect role's handoff rule.
- Electron first. The new surface alone may execute inline scripts, with no network, under an opaque-origin iframe. The existing `ptah-ui` and declarative surface contracts remain unchanged.

## Requirements and acceptance criteria

1. An Electron agent can call `ptah_artifact_publish` with a nonempty title and exactly one of `html` or `path`. The call publishes one immutable, self-contained HTML page of at most 2 MiB UTF-8 and returns an opaque id, revision, saved path, and viewer reference. Invalid input, a path outside the trusted workspace, symlink escape, non-HTML content, or a missing session fails as a tool error without a partial record.
2. The artifact belongs to the trusted MCP caller's workspace and session/routing id, never to ids supplied by the agent. A reload restores its card and viewer; replacing a named artifact creates a new immutable revision. No user content appears in logs or errors.
3. Electron shows a titled card in the chat transcript and opens the artifact in the existing display dock or a full-screen viewer. The frame uses `sandbox="allow-scripts"`, no `allow-same-origin`, no forms or popups, and an asset URL. It receives theme tokens and can send bounded height and an external-link request only. All bridge messages pass strict Zod schemas and `event.source === iframe.contentWindow`; stale-frame messages are ignored.
4. Response CSP denies all network, including fetch/XHR/WebSocket, remote images, fonts, frames, forms, and workers. It permits inline scripts/styles and only `data:`/`blob:` images. The shell CSP gains only `frame-src ptah-artifact:`; its other directives and the Electron navigation guard remain intact.
5. A failed publish, missing file, blocked link, crashed frame, or invalid message displays a safe card/viewer error or remains an MCP tool error. Existing `ptah-ui` fences, display panel tabs, and declarative dashboards behave as before.
6. VS Code and CLI/TUI list the tool with a clear host-unavailable result or a saved-path fallback that is safe and truthful; all hosts typecheck. They do not create a frame or widen CSP.

### Out of scope

Multi-file sites, remote assets, agent-to-host tool calls, arbitrary IPC, form submission, downloads, MCP Apps `ui://`, VS Code rendering, TUI rendering, HTML sanitizer changes, and a new declarative catalog kind.

## Preserve list

| Existing behavior | Evidence | Preserve action |
| --- | --- | --- |
| `ptah-ui` inline and `display [id]` fences, validation limits, invalid-block fallback | `current-pipeline-inventory.md:38-39`; `ptah-ui-message-text.component.ts`; `display-surfaces.ts` | Do not change parser, converter, catalog `/4`, or fence semantics. |
| `ptah_surface_update` and dashboard `/3` validation and interactive Apps surfaces | `current-pipeline-inventory.md:40-42`; `surface-tools.ts:178-261` | Add a separate artifact tool and store; do not accept HTML in surface schemas. |
| Display panel summary, tabs, read-only surfaces, keyboard behavior, view state | `display-panel.component.ts:30-60,257-486`; 623 design headings §§2,5,7,8 | Add artifact tab/viewer as a sibling item; retain summary and surface paths. |
| Markdown DOMPurify and dashboard HTML-sink guard | `current-pipeline-inventory.md:37,65-69` | No raw HTML in Angular; iframe lives in `chat-ui`, outside declarative dashboard. |
| Shell CSP outside `frame-src` and top-level navigation/open guard | `copy-renderer.js:159-172`; `main-window.ts:43-83` | Preserve directives and guard; link bridge reuses `isSafeExternalUrl` in main process. |

## Codebase evidence

| Evidence | Location | Implication |
| --- | --- | --- |
| Electron main window has preload, context isolation, no Node integration, sandbox and web security | `apps/ptah-electron/src/windows/main-window.ts:115-139` | Keep these settings and test child-frame inheritance/permission policy. |
| Shell has `frame-src 'none'` | `apps/ptah-electron/scripts/copy-renderer.js:159-172` | One exact scheme exception is needed. |
| Safe external URL filter is in the main-window navigation policy | `main-window.ts:43-83`; `windows/navigation-policy.ts` | Route requested links through the same allowlist, not renderer `window.open`. |
| MCP tool list includes surface tools; coding profile excludes Apps-only tools | `protocol-dispatcher.ts:503-555` | Add artifact publish to the common tool set, not `APPS_ONLY_TOOL_NAMES`. |
| Angular message handlers use a router multi-provider | `libs/frontend/core/src/lib/services/message-router.types.ts:17-50`; `chat-message-handler.service.ts:72-93` | Register one artifact notification handler via `MESSAGE_HANDLERS`. |
| Platform core exports workspace resolver and path guards | `libs/backend/platform-core/src/index.ts:154,189-190` | Put an artifact persistence port here; validate caller workspace at the boundary. |
| Existing browser namespace only admits HTTP(S) | `current-pipeline-inventory.md:44`; `browser-namespace.builder.ts:155-181` | Agent screenshot verification needs a separate controlled preview path; do not silently widen browser navigation. |
| Nx tags constrain direction | `platform-core/project.json:6`, `platform-electron/project.json:6`, `vscode-lm-tools/project.json:6`, `chat-ui/project.json:6` | Shared contract/port, Electron adapter, extension-domain tool, webview component; no Electron import in shared code. |

## Architecture decision

Use `ptah-artifact://<opaque-id>/index.html`, registered before Electron readiness as a standard, secure privileged scheme. The main-process protocol handler maps only a registry id to a stored file; it never treats URL path or host as a filesystem path. Serve bytes with `text/html; charset=utf-8`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and a **response CSP header**: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src 'none'; media-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'`. Include `navigate-to 'none'` only if Chromium honors it; sandbox and main-window guards remain the enforced navigation controls. Disable protocol fetch API unless Electron's iframe loading empirically requires it. No `allow-forms` or `allow-same-origin`.

The artifact is a separate record, not a `dashboard-catalog` node. The tool resolves the caller's workspace/session, persists atomically, then emits a metadata-only `artifact:published` notification with id, title, revision, session/routing id, and viewer URL. The webview validates that notification, filters it by current session, stores only metadata, and reloads records through a scoped RPC query. The frame never receives the host preload API. The page sees only postMessage theme tokens. Host accepts only `height` (finite, clamped 160–1600 px, throttled per frame) and `open-link` (HTTP(S) URL, explicit user gesture if feasible, passed to the existing main-process allowlist). The host sends to the exact `contentWindow`, with `targetOrigin: '*'` because the sandbox origin is opaque; a per-frame nonce is included and required both ways. `event.origin === 'null'` alone is insufficient authentication.

**Alternative comparison:** `srcdoc` and host-created `blob:` complicate CSP/origin reasoning and persistence; `file:` exposes path handling and would demand broader shell CSP; `WebContentsView` loses the current dock layout and bridge simplicity. The 497 spike analyzed a privileged per-app origin with `allow-same-origin` for MCP Apps. This artifact has a single immutable id per URL and deliberately omits `allow-same-origin`; reuse its seven controls and fixtures, not its storage/origin assumptions. The existing app `file:` origin never becomes the artifact origin.

## Phase 0 gate: Electron containment spike

Before product work, adapt the 497 corpus into an Electron Playwright spec under `apps/ptah-electron-e2e`. Run each fixture through the intended protocol and exact iframe sandbox/CSP in a test shell; keep the original fixtures unchanged. The 497 report says the spike was prepared, not run. Baseline assertions: `nodeIntegration=false`, `contextIsolation=true`, `sandbox=true`, `webSecurity=true`, top-level `will-navigate` cancellation, `setWindowOpenHandler` denial, and subframe permission denial. Inspect current `permission-policy.ts` because the 497 report's historical warning may be stale.

Pass only if the fixture matrix shows: no `require`, `process`, preload/IPC bridge or parent DOM access; no app cookies/storage/IndexedDB read; no successful remote fetch, XHR, WebSocket or image request (also inspect network requests, not only JS errors); no top navigation or popup; no form, permission, or CSP widening; theme arrives; height is clamped; valid link opens only through allowlist; forged source/nonce/type/oversize/flooded messages do nothing. The shell remains responsive under the resource-exhaustion fixture. Fail closed and stop integration on any miss. `metadata-inject-csp.html` and `metadata-wildcard-origin.html` are adapted to prove author meta tags cannot weaken the response header. `cross-origin-storage-read.html` must expect opaque-origin storage access to throw or reveal no app data, rather than the earlier per-origin storage assumption.

Automate pure URL, size/path, CSP-string, and bridge-schema tests with Jest. Automate the actual frame, permission, network, popup and navigation checks in the Electron Playwright spec. A manual packaged-Electron check remains necessary for custom-scheme registration order, dev/prod asset loading, OS external-link handoff, focus/keyboard behavior, and visible theme/full-screen sizing. Capture pass/fail evidence per fixture before Batch 2 proceeds.

## Component specifications

### 1. Shared contract and platform port

- **Purpose:** immutable artifact metadata, publish input and bridge/RPC schemas; persistence boundary.
- **Contract:** Zod strict objects; title length and 2 MiB byte cap; exactly one `html`/`path`; ids generated by host; scoped list/read/publish in a new `IArtifactStore` port and token. Store methods accept trusted caller context, not agent-provided workspace/session ids.
- **Failure:** typed invalid-input/not-found/unsupported errors; no partial record.
- **Verification:** schema edge cases, unauthorized ids and oversized UTF-8; platform-core typecheck.
- **Files:** `libs/shared/src/mcp-apps-contracts/artifact.schemas.ts` (new), `libs/backend/platform-core/src/interfaces/artifact-store.interface.ts` (new), `libs/backend/platform-core/src/di/tokens.ts` (modify), `libs/backend/platform-core/src/index.ts` (modify). Confirm actual token file location before editing.

### 2. Electron store and protocol

- **Purpose:** own bytes, durable metadata and narrow asset delivery.
- **Storage:** per-workspace/per-session under Ptah-managed application data, not the project tree; sanitize display/file names, generate random id, write temporary file then atomic rename; index by workspace/session/id. For `path`, resolve relative to trusted workspace, reject `..`, symlinks/reparse escapes with realpath and `isInsideRoot`, read once with size limit, then copy bytes. The protocol can read only committed records. Remove abandoned temp files on startup; bound total storage with explicit eviction policy after the first slice's per-artifact cap.
- **Protocol:** register scheme before `app.whenReady()`, register handler on the main window's session before navigation. Reject unknown id/path/method with a generic 404; no redirect, no file URL, no protocol handler for arbitrary assets. Response CSP is authoritative; no permissive `srcdoc` policy.
- **Failure:** missing/corrupt file yields error card/404, never fallback to `file:`; protocol lookup cannot disclose paths.
- **Verification:** store traversal/symlink/atomicity specs; protocol header and unknown-id tests; Phase 0 Electron spec.
- **Files:** `libs/backend/platform-electron/src/artifacts/electron-artifact-store.ts` (new), `libs/backend/platform-electron/src/registration.ts` (modify), `apps/ptah-electron/src/artifacts/artifact-protocol.ts` (new), `apps/ptah-electron/src/main.ts` (modify), `apps/ptah-electron/scripts/copy-renderer.js` (modify), `apps/ptah-electron/src/di/phase-3-storage.ts` (modify). Use the verified `PLATFORM_TOKENS` port; `platform-electron` has no separate `di/tokens.ts` today.

### 3. Publish tool and cross-host behavior

- **Purpose:** expose publish once to coding agents through the existing MCP dispatcher.
- **Contract:** `ptah_artifact_publish {title, html | path}`; Zod preflight before file I/O; derive workspace/routing/session from trusted MCP caller. Electron gets the store adapter. VS Code/CLI return a structured unsupported/saved-path result only if they actually persist safely; no false success. Tool is in common coding profile, subject to existing MCP namespace/contract checks.
- **Integration:** definition in MCP core, dispatch case and dependency port in `ProtocolHandlerDependencies`; no import from Electron in `vscode-lm-tools`. Notify only after committed publish. Add tool to contract sweep and caller spoof tests.
- **Failure:** tool error with concise sanitized message; unsupported host is explicit.
- **Verification:** published bytes, path guards, caller isolation, absent-port result, tools/list in coding and Apps profiles.
- **Files:** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/artifact-tools.ts` (new), `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/artifact-tool-handlers.ts` (new), `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (modify), `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts` (modify), `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts` (modify).

### 4. Host notification and scoped query

- **Purpose:** make published records durable and visible in the correct conversation.
- **Contract:** metadata-only `artifact:published` event and `artifact:list` RPC with trusted session scope. Follow the existing RPC surface contract and `RpcUserError` conventions; update allowlist and host-specific registration. On reconnect, query records; do not rely solely on a transient notification.
- **Failure:** invalid or stale session yields empty/not-found without leaking other sessions; notification failure leaves persisted artifact available on refresh.
- **Verification:** RPC surface and composition guards for Electron, VS Code and CLI; session isolation and resync tests.
- **Files:** `libs/backend/rpc-handlers/src/lib/handlers/artifact-rpc.handlers.ts` (new), `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts` (modify), `libs/backend/rpc-handlers/src/index.ts` (modify), `libs/shared/src/lib/types/rpc.types.ts` (modify), `libs/backend/vscode-core/src/messaging/rpc-handler.ts` (modify), `apps/ptah-electron/src/di/phase-4-handlers.ts` (modify), `apps/ptah-electron/src/di/rpc-surface.spec.ts` (modify), `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts` (modify), `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts` (modify). The host profile manifest must partition the new method and the runtime allowlist must admit its prefix.

### 5. Angular card, viewer and theme bridge

- **Purpose:** render metadata in chat and a single sandboxed viewer in the existing dock/full-screen layout.
- **Components:** `ArtifactCardComponent`, `ArtifactViewerComponent`, `ArtifactThemeBridgeService`, and a signal-backed artifact store. Standalone, OnPush, `inject()`/`input()`/`output()`. Card title/path/status is text. Viewer sets `iframe.src` to the validated protocol URL, `title`, sandbox and referrer policy; never `[innerHTML]`. Keep frame creation bounded to active viewer (avoid one live iframe per chat card); cleanup message listener on destroy. Theme service sends a fixed allowlist of Ptah CSS variables after load and theme changes; validate iframe message source, nonce and Zod payload, clamp height and route links through host RPC. Full-screen uses the same viewer instance contract.
- **Integration:** subscribe via `MESSAGE_HANDLERS`, not a raw host transport; dock receives an artifact item alongside summary/surfaces. Preserve existing tab key semantics and focus restoration.
- **Failure:** unloaded, missing and crashed frame show accessible error with saved path; no attempt to render HTML in shell.
- **Verification:** component specs for source/nonce rejection, theme update, height clamp, link allowlist, cleanup, dock keyboard/focus; manual Electron full-screen and reduced-motion check.
- **Files:** `libs/frontend/chat-ui/src/lib/organisms/artifacts/artifact-card.component.ts` (new), `libs/frontend/chat-ui/src/lib/organisms/artifacts/artifact-viewer.component.ts` (new), `libs/frontend/chat-ui/src/lib/organisms/artifacts/artifact-theme-bridge.service.ts` (new), `libs/frontend/chat-ui/src/lib/organisms/display-panel/display-panel.component.ts` (modify), `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-message-text.component.ts` (modify only if transcript card insertion point requires it), `libs/frontend/chat/src/lib/services/artifact-message-handler.service.ts` (new), `apps/ptah-extension-webview/src/app/app.config.ts` (modify).

### 6. Agent guidance and self-check

- **Purpose:** tell agents when to use the separate surface and how to review it.
- **Guidance:** `ptah-ui` remains the default for concise host-backed summaries; use artifact for a substantial visual page/dashboard/prototype. Author one self-contained `index.html` with semantic HTML, keyboard operation, responsive layout, inline CSS/JS, data/blob images only, no network. Call publish, then visually self-check desktop and narrow screenshots via existing `ptah_browser_*` tools before presenting; inspect errors and revise. The browser namespace currently accepts HTTP(S), so a temporary local preview of the same bytes can support screenshot review; it is a visual check, not proof of sandbox isolation. Do not widen the namespace to arbitrary `file:` or custom schemes without a separate reviewed design.
- **Failure:** if browser tools are unavailable, report that visual verification was not performed; do not claim a screenshot.
- **Verification:** prompt/skill text assertions and manual agent trial.
- **Files:** `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts` (modify), `.claude/skills/ptah-surface-authoring/SKILL.md` (modify), `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring/SKILL.md` (modify; generated asset source/sync relationship must be checked before editing).

## Integration architecture

1. Agent calls MCP tool. Shared schema validates input; caller context supplies workspace/session. Platform port stores bytes and metadata atomically. Tool emits metadata notification after commit.
2. Angular handler validates event and updates signal store; a scoped RPC list repairs missed events. Chat card opens dock/full-screen viewer. Viewer requests the protocol URL; main process maps id to committed bytes and sets response CSP.
3. On frame load, bridge sends validated theme and nonce. Frame may report height or request an external HTTP(S) link. Host checks source and nonce, clamps/rate-limits; main process rechecks URL allowlist. Destroying viewer removes listener and frame.
4. Storage persists across app reload per workspace/session. The protocol response never exposes a file path. Logs include opaque id and error class only.
5. Rollback: disable/remove the new MCP tool, protocol registration, `frame-src` exception and UI; persisted HTML remains inert data and can be removed by a dedicated cleanup migration. No existing dashboard schema migration is needed.

## Batches and scoped verification

Batch ownership is file-disjoint. Names below are exact intended paths; the two RPC registration paths and `platform-electron` token path are explicitly conditional on seam confirmation before implementation. Keep each batch to at most eight files. Each test command is a future verification instruction, not a command run for this design.

| Batch / executor | Exact files (N = new, M = modified) | Nx projects | Scoped verification |
| --- | --- | --- | --- |
| **1. Phase 0 spike**, Electron/security | N `apps/ptah-electron-e2e/src/specs/artifacts/artifact-containment.spec.ts`; N `apps/ptah-electron/src/artifacts/artifact-containment.spec.ts` | `ptah-electron-e2e`, `ptah-electron` | Jest named pure-logic spec with `--maxWorkers=2`; Electron Playwright named containment spec only after the test harness has the candidate protocol. Manual packaged-Electron checklist. No later batch merges before pass. |
| **2. Contract/port**, backend | N `libs/shared/src/mcp-apps-contracts/artifact.schemas.ts`; N `libs/shared/src/mcp-apps-contracts/artifact.schemas.spec.ts`; N `libs/backend/platform-core/src/interfaces/artifact-store.interface.ts`; M `libs/backend/platform-core/src/di/tokens.ts`; M `libs/backend/platform-core/src/index.ts` | `shared`, `platform-core` | `npx nx test shared --parallel=1`; `npx nx typecheck platform-core --parallel=1` |
| **3. Electron persistence**, backend | N `libs/backend/platform-electron/src/artifacts/electron-artifact-store.ts`; N `libs/backend/platform-electron/src/artifacts/electron-artifact-store.spec.ts`; M `libs/backend/platform-electron/src/registration.ts`; M `apps/ptah-electron/src/di/phase-3-storage.ts` | `platform-electron`, `ptah-electron` | `npx nx test platform-electron --parallel=1`; `npx nx typecheck ptah-electron --parallel=1` |
| **4. Protocol/CSP**, Electron | N `apps/ptah-electron/src/artifacts/artifact-protocol.ts`; N `apps/ptah-electron/src/artifacts/artifact-protocol.spec.ts`; M `apps/ptah-electron/src/main.ts`; M `apps/ptah-electron/scripts/copy-renderer.js` | `ptah-electron` | `npx nx test ptah-electron --parallel=1`; manual packaged protocol check |
| **5. Publish tool**, backend | N `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/artifact-tools.ts`; N `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/artifact-tool-handlers.ts`; N `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/artifact-tools.spec.ts`; M `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`; M `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`; M `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts` | `vscode-lm-tools` | `npx nx test vscode-lm-tools --parallel=1`; `npx nx typecheck vscode-lm-tools --parallel=1` |
| **6. RPC contract/allowlist**, backend | N `libs/backend/rpc-handlers/src/lib/handlers/artifact-rpc.handlers.ts`; M `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`; M `libs/backend/rpc-handlers/src/index.ts`; M `libs/shared/src/lib/types/rpc.types.ts`; M `libs/backend/vscode-core/src/messaging/rpc-handler.ts`; M `apps/ptah-electron/src/di/phase-4-handlers.ts` | `rpc-handlers`, `shared`, `vscode-core`, `ptah-electron` | `npx nx test rpc-handlers --parallel=1`; `npx nx typecheck ptah-electron --parallel=1` |
| **6a. RPC guards**, backend | M `apps/ptah-electron/src/di/rpc-surface.spec.ts`; M `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`; M `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts` | `ptah-electron`, `ptah-extension-vscode`, `cli-engine` | Named RPC specs with Jest `--maxWorkers=2`; `npx nx typecheck cli-engine --parallel=1` |
| **7. UI and bridge**, frontend | N `libs/frontend/chat-ui/src/lib/organisms/artifacts/artifact-card.component.ts`; N `libs/frontend/chat-ui/src/lib/organisms/artifacts/artifact-viewer.component.ts`; N `libs/frontend/chat-ui/src/lib/organisms/artifacts/artifact-theme-bridge.service.ts`; N `libs/frontend/chat-ui/src/lib/organisms/artifacts/artifact-viewer.component.spec.ts`; M `libs/frontend/chat-ui/src/lib/organisms/display-panel/display-panel.component.ts`; M `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-message-text.component.ts` | `chat-ui` | `npx nx test chat-ui --parallel=1`; `npx nx typecheck chat-ui --parallel=1` |
| **8. UI event wiring**, frontend | N `libs/frontend/chat/src/lib/services/artifact-message-handler.service.ts`; N `libs/frontend/chat/src/lib/services/artifact-message-handler.service.spec.ts`; M `apps/ptah-extension-webview/src/app/app.config.ts` | `chat`, `ptah-extension-webview` | `npx nx test chat --parallel=1`; `npx nx typecheck ptah-extension-webview --parallel=1` |
| **9. DI/host parity**, backend | M `apps/ptah-electron/src/di/container.smoke.spec.ts`; M `apps/ptah-electron/src/di/expected-resolvable.ts`; M `apps/ptah-electron/src/di/surface-composition.spec.ts`; M `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts`; M `apps/ptah-extension-vscode/src/di/expected-resolvable.ts`; M `apps/ptah-extension-vscode/src/di/surface-composition.spec.ts`; M `apps/ptah-cli/src/di/container.smoke.spec.ts`; M `apps/ptah-cli/src/di/expected-resolvable.ts` | `ptah-electron`, `ptah-extension-vscode`, `ptah-cli` | Named DI specs with Jest `--maxWorkers=2`; `npx nx typecheck ptah-cli --parallel=1` |
| **10. CLI composition/guidance**, backend | M `libs/backend/cli-engine/src/lib/surface-composition.spec.ts`; M `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts`; M `.claude/skills/ptah-surface-authoring/SKILL.md`; M `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring/SKILL.md` | `cli-engine`, `vscode-lm-tools`, `ptah-extension-vscode` | Named prompt/CLI composition specs with Jest `--maxWorkers=2`; `npx nx typecheck cli-engine --parallel=1` |

The executor should add any missing project-local export/barrel or registration file to its **same owning batch**, keeping the eight-file ceiling; the team leader may split a batch, but should not have two lanes edit one file. Check Nx target names in project.json before running commands. The Phase 0 Playwright command is explicitly requested as the gate; no workspace-wide or unrelated e2e run is planned.

## Risks and rollback

- **Protocol privilege and CSP:** a scheme registered too late, a missing response CSP, or an accidental `allow-same-origin` defeats the design. Gate with packaged Electron, response-header assertions and hostile fixtures. Roll back by removing scheme/frame exception and hiding cards.
- **Subframe permissions:** 497 documented a historical inheritance bug. Verify current `permission-policy.ts` in the spike; fail gate on any child grant.
- **Path and storage:** symlink races, unbounded revision growth and partial writes can leak or exhaust resources. Copy after realpath checks, use atomic commit, cap bytes and count; revisit aggregate quota before broad release.
- **Bridge spoofing/flood:** opaque origins require source plus nonce and strict bounds; throttle height updates and clean listeners.
- **Screenshot mismatch:** HTTP preview is only a visual approximation of the sandboxed artifact. Final manual Electron review and containment tests remain required.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Dedicated protocol asset URL | protocol / `srcdoc` / `blob:` / `file:` | t3code precedent in `external-research.md`; Electron shell CSP and 497 comparison | Yes, behind viewer URL resolver |
| Separate artifact model, no catalog kind | separate / extend `/3` or `/4` | fixed catalogs and trust-boundary spec in inventory | Yes, without schema migration |
| Opaque-origin iframe with inline JS and zero network | selected / `allow-same-origin` / script-free | fixed user decision; 497 storage assumptions do not apply | User-reserved policy; do not reopen |
| Store copied immutable bytes in managed data | managed copy / direct workspace file | path traversal and reload requirements; protocol must not read arbitrary paths | Yes, with record migration |
| Metadata event plus scoped list RPC | both / event-only | missed-event recovery and existing router model | Yes |
| No custom-scheme browser namespace widening | local HTTP visual preview / scheme widening | `browser-namespace.builder.ts:155-181` only admits HTTP(S) | Yes, after separate security review |

## Lane-introduced constraints

- One artifact is at most 2 MiB, one `index.html`, immutable per published revision; no external assets or worker.
- Host generated ids, opaque URL host, 160–1600 px height bounds, one live viewer frame per active artifact, and bounded bridge message rate.
- Copy workspace-path input into managed storage instead of serving source file in place.
- A transient event must be paired with scoped reload; notification failure does not invalidate commit.

## Unknowns

- The verified port token lives in `platform-core/src/di/tokens.ts`; the Electron adapter registers through `platform-electron/src/registration.ts`. Confirm whether its registration is owned by phase 0 or phase 3 before changing phase 3. RPC methods live in `shared/src/lib/types/rpc.types.ts`, with handler ownership in `rpc-handlers/src/lib/host-profile/manifest.ts`.
- Determine whether the current Electron permission policy already blocks child frames; the 497 warning predates the current `installPermissionPolicy` call.
- Confirm whether Electron custom scheme registration needs `supportFetchAPI` for iframe navigation in the shipped Electron version; prefer false and record the Phase 0 outcome.
- Confirm the source-of-truth for the packaged `ptah-surface-authoring` skill, then edit/sync both copies without changing unrelated guidance.
- Measure a representative large dashboard for frame memory and resize cost, and decide an aggregate workspace/session quota before release beyond the 2 MiB per-artifact cap.
