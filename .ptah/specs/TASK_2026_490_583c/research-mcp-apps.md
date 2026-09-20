# Research Report — MCP Apps extension (lane 3 of TASK_2026_490)

## Verdict

Implement Ptah as an MCP Apps HOST **later**, not now: the protocol is stable (SEP-1865, 2026-01-26) and well specified, but VS Code's own reference implementation uses a workbench-internal API Ptah cannot call, so Ptah must hand-build the spec's "sandbox proxy" pattern with a plain `<iframe sandbox>` inside its already-sandboxed webview — real, unproven engineering, not a library import. Author MCP Apps from Ptah's own MCP server **now** is lower risk and reuses the same UI Ptah already needs to build (setup wizard, marketplace consent card): the `App`/`AppBridge` classes are framework-agnostic TypeScript, so Angular can drive them directly, and a text fallback is mandatory by spec, so headless CLI/TUI never breaks.

## Status and license

| Field                | Value                                                                                                      | Source                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spec identifier      | SEP-1865, "MCP Apps: Interactive User Interfaces for MCP"                                                  | `ext-apps` repo, `specification/2026-01-26/apps.mdx:3` (cloned to `C:\Users\abdal\AppData\Local\Temp\ext-apps-research`, commit at fetch time `main` HEAD, 2026-09-20)                                                                                                                                                                  |
| Track                | Extensions (built on the general extension mechanism SEP-1724)                                             | `apps.mdx:5`, `apps.mdx:36`                                                                                                                                                                                                                                                                                                             |
| Status               | Stable (2026-01-26)                                                                                        | `apps.mdx:7`                                                                                                                                                                                                                                                                                                                            |
| Created              | 2025-11-21                                                                                                 | `apps.mdx:9`                                                                                                                                                                                                                                                                                                                            |
| Extension identifier | `io.modelcontextprotocol/ui`                                                                               | `apps.mdx:38-40`                                                                                                                                                                                                                                                                                                                        |
| Governing repo       | github.com/modelcontextprotocol/ext-apps                                                                   | repo `homepage`/`repository.url` in `package.json`; also linked from https://modelcontextprotocol.io/extensions/client-matrix                                                                                                                                                                                                           |
| SDK license          | `MIT` per `package.json:license` (verified with `npm view @modelcontextprotocol/ext-apps license` → `MIT`) | repo-root `LICENSE` file states the MCP project is **mid-transition** from MIT to Apache-2.0: new spec/code contributions are Apache-2.0, older MIT-licensed contributions stay MIT unless the author re-licenses. The npm package metadata still reads `MIT`; treat the license as **mixed/transitional**, not a clean single license. |
| SDK version (npm)    | `2.0.0`, published `2026-09-17T12:01:52Z`, `dist` unpacked size `1,484,749` bytes                          | `npm view @modelcontextprotocol/ext-apps version time.modified dist.unpackedSize`                                                                                                                                                                                                                                                       |

**Relationship to MCP-UI (mcpui.dev): parallel, not superseded.** The SEP's own Motivation section credits MCP-UI as the community project that "demonstrated the viability and value of MCP apps" and "developed the bi-directional communication model and the HTML, external URL, and remote DOM content types," naming Postman, HuggingFace, Shopify, Goose, and ElevenLabs as MCP-UI adopters (`apps.mdx:21`). SEP-1865 explicitly "unifies the approaches pioneered by MCP-UI and [OpenAI's] Apps SDK into a single, open standard" (`apps.mdx:23`) — it does not deprecate MCP-UI. The official docs still list `@mcp-ui/client` as a valid host-side implementation path alongside the official `AppBridge` ("Use a framework: `@mcp-ui/client`... **or** Build on AppBridge", https://modelcontextprotocol.io/extensions/apps/overview). MCP-UI's own SDK is expected to add SEP-1865 compatibility during a migration period (`apps.mdx:1580`, "breaking changes from existing solutions, which will be addressed via the MCP-UI SDK during the migration period" — UNVERIFIED whether that migration has shipped as of 2026-09-20).

## Protocol

**UI resources** use the `ui://` scheme and MUST be served with `mimeType: "text/html;profile=mcp-app"` (`apps.mdx:64-101, 267-268`). A tool links to one via `_meta.ui.resourceUri`; `_meta.ui.visibility` controls whether the tool is callable by the model, by the app, or both (default: both).

Tool declaration (`apps.mdx:349-368`):

```json
{
  "name": "get_weather",
  "description": "Get current weather for a location",
  "inputSchema": {
    "type": "object",
    "properties": { "location": { "type": "string" } }
  },
  "_meta": {
    "ui": {
      "resourceUri": "ui://weather-server/dashboard-template",
      "visibility": ["model", "app"]
    }
  }
}
```

Resource read (`resources/read` response, `apps.mdx:235-263`):

```json
{
  "contents": [
    {
      "uri": "ui://weather-server/dashboard-template",
      "mimeType": "text/html;profile=mcp-app",
      "text": "<!DOCTYPE html>...</html>",
      "_meta": {
        "ui": {
          "csp": {
            "connectDomains": ["https://api.weather.com"],
            "resourceDomains": ["https://cdn.jsdelivr.net"]
          },
          "permissions": { "camera": {} },
          "prefersBorder": true
        }
      }
    }
  ]
}
```

**Capability negotiation** happens in `initialize`, under the generic `capabilities.extensions` map defined by SEP-1724. The client (host) MUST send the `mimeTypes` it accepts; a server SHOULD check this before registering UI-linked tools (`apps.mdx:1492-1554`):

```json
{
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "extensions": {
        "io.modelcontextprotocol/ui": { "mimeTypes": ["text/html;profile=mcp-app"] }
      }
    },
    "clientInfo": { "name": "claude-desktop", "version": "1.0.0" }
  }
}
```

The View-to-host channel is a second, separate JSON-RPC 2.0 dialect over `postMessage` (not the server transport). Its own methods use a `ui/` prefix; some names overlap the core protocol (`tools/call`) but travel over `postMessage`, not stdio/HTTP (`apps.mdx:411-468`).

## Host duties checklist

| Duty                                                                                                   | MUST / SHOULD / MAY                               | Notes                                                                          | Source                    |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------- |
| Fetch UI resource via `resources/read` before render                                                   | MUST                                              | Never inline the HTML from elsewhere                                           | `apps.mdx:391`            |
| Enforce restrictive default CSP when `ui.csp` is omitted                                               | MUST                                              | `default-src 'none'; script-src 'self' 'unsafe-inline'; ...connect-src 'none'` | `apps.mdx:275-281`        |
| Construct CSP from declared `connectDomains`/`resourceDomains`/`frameDomains`/`baseUriDomains`         | MUST                                              | Exact directive mapping given in spec                                          | `apps.mdx:1723-1752`      |
| Block connections to undeclared domains                                                                | MUST                                              |                                                                                | `apps.mdx:1756`           |
| Render all View content in a sandboxed iframe                                                          | MUST                                              |                                                                                | `apps.mdx:1698`           |
| Web-based host: wrap the View in an intermediate Sandbox proxy on a **different origin** from the host | MUST                                              | The "double-iframe" pattern                                                    | `apps.mdx:472-474`        |
| Sandbox proxy frame permissions                                                                        | MUST be exactly `allow-scripts allow-same-origin` |                                                                                | `apps.mdx:475`            |
| Host MUST NOT message the View before it sees the View's `initialized` notification                    | MUST                                              |                                                                                | `apps.mdx:485`            |
| Sandbox proxy MUST NOT originate its own requests                                                      | SHOULD NOT                                        | Avoids id collisions                                                           | `apps.mdx:486`            |
| Exclude `visibility: ["app"]`-only tools from `tools/list` sent to the model                           | MUST                                              |                                                                                | `apps.mdx:400`            |
| Reject `tools/call` from a View for a tool not marked `"app"`-visible                                  | MUST                                              | Cross-server app-tool calls are always blocked                                 | `apps.mdx:401-402`        |
| Send `ui/notifications/tool-input` once, after View init, before `tool-result`                         | MUST                                              |                                                                                | `apps.mdx:1106,1118`      |
| Send `ui/notifications/tool-result` when tool execution completes (if View displayed)                  | MUST                                              |                                                                                | `apps.mdx:1145,1155`      |
| Send `ui/notifications/tool-cancelled` on cancellation, any cause                                      | MUST                                              |                                                                                | `apps.mdx:1157-1169`      |
| Send `ui/resource-teardown` before destroying the View, and wait for its response                      | MUST send / SHOULD wait                           | Prevents data loss                                                             | `apps.mdx:1171,1201-1202` |
| Listen for `ui/notifications/size-changed` and resize the iframe when using flexible dimensions        | MUST                                              |                                                                                | `apps.mdx:716-718`        |
| Never switch a View to a display mode it did not declare support for                                   | MUST                                              |                                                                                | `apps.mdx:786`            |
| Return the resulting display mode on every `ui/request-display-mode`                                   | MUST                                              |                                                                                | `apps.mdx:787`            |
| Validate incoming `postMessage` JSON-RPC from the View; reject malformed messages                      | SHOULD                                            |                                                                                | `apps.mdx:1706-1710`      |
| Log View-initiated RPC calls for security review                                                       | SHOULD                                            |                                                                                | `apps.mdx:1710`           |
| Review predeclared HTML for malicious patterns; hash/allowlist resources                               | SHOULD                                            |                                                                                | `apps.mdx:1716-1721`      |
| Warn users when a UI needs external-domain access                                                      | SHOULD                                            |                                                                                | `apps.mdx:1757`           |
| Pass theming via `HostContext.styles.variables` CSS custom properties                                  | SHOULD (optional feature)                         | Not required for MVP conformance                                               | `apps.mdx:791-793`        |
| Request user consent before relaying `ui/message` into the conversation                                | MAY                                               | The only place the spec literally uses the word "consent"                      | `apps.mdx:1032-1034`      |
| Honor `permissions` (`camera`/`microphone`/`geolocation`/`clipboardWrite`) via iframe `allow`          | MAY                                               | Apps must feature-detect, never assume grant                                   | `apps.mdx:170-171`        |
| Prefetch/cache UI resource content                                                                     | MAY                                               |                                                                                | `apps.mdx:392`            |
| Impose CPU/memory resource limits on a View                                                            | SHOULD (implied)                                  | Listed under "Other risks," not a normative MUST                               | `apps.mdx:1763`           |

## SDK

Package: `@modelcontextprotocol/ext-apps`, v2.0.0, MIT (see license caveat above), ~1.45 MB unpacked `dist/`. Sub-path exports (`package.json:exports`):

| Sub-path        | Consumer      | Contents                                                                                                                       | Framework tie         |
| --------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| `.` (`app.js`)  | APP author    | `App` class — plain TS class extending an internal `Protocol`                                                                  | None — vanilla TS/DOM |
| `./react`       | APP author    | React hooks: `useAutoResize`, `useDocumentTheme`, `useHostStyles`                                                              | React-only            |
| `./app-bridge`  | HOST author   | `AppBridge` class — same `Protocol` base as `App`, handles iframe mounting, message relay, tool-call proxying, CSP enforcement | None — vanilla TS/DOM |
| `./server`      | Server author | `getUiCapability`, `RESOURCE_MIME_TYPE`, tool-registration helpers                                                             | None                  |
| `./schema.json` | Anyone        | Generated JSON Schema for the wire types                                                                                       | —                     |

Verified by reading the source directly (`src/app.ts:305` — `export class App extends Protocol<BaseContext>`; `src/app-bridge.ts:305` — `export class AppBridge extends Protocol<BaseContext>`; `src/react/*.ts` — three small hook files, ~66–198 lines each, the only React-specific code in the repo).

**There is no Angular package and no Angular-specific code anywhere in the repo** (grep of the cloned tree found nothing under `src/` or `examples/` referencing Angular). This is not a gap that blocks Ptah: both `App` (app-authoring) and `AppBridge` (host-authoring) are framework-agnostic TypeScript classes operating on the DOM and `postMessage` directly — an Angular service can `new AppBridge(...)` or `new App(...)` and wire its outputs to signals exactly as Ptah already wires other non-Angular SDKs (e.g. `@anthropic-ai/claude-agent-sdk`). The official example directory (`examples/basic-server-{react,vue,svelte,preact,solid,vanillajs}`) confirms the pattern is "any framework or none" (https://modelcontextprotocol.io/extensions/apps/overview, "Framework support" section) — Angular is simply not one of the six starter templates provided.

## Adoption

Per the community-maintained client matrix (https://modelcontextprotocol.io/extensions/client-matrix, fetched 2026-09-20):

| Host                   | MCP Apps support |
| ---------------------- | ---------------- |
| Claude (web)           | Yes              |
| Claude Desktop         | Yes              |
| VS Code GitHub Copilot | Yes              |
| Microsoft 365 Copilot  | Yes              |
| Goose                  | Yes              |
| Postman                | Yes              |
| MCPJam                 | Yes              |
| ChatGPT                | Yes              |
| Cursor                 | Yes              |
| Archestra.AI           | Yes              |
| PostHog Code           | Yes              |

Servers/adopters named in primary sources (distinguish demo from production):

| Server / adopter                                                                                        | Status                                                                                             | Source                                                        |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Excalidraw MCP App                                                                                      | Demo, shown running in Claude on the official overview page                                        | https://modelcontextprotocol.io/extensions/apps/overview      |
| Postman, HuggingFace, Shopify, Goose, ElevenLabs                                                        | Named as **MCP-UI** adopters (predecessor project), not confirmed SEP-1865 adopters                | `apps.mdx:21`                                                 |
| map-server, threejs-server, shadertoy-server, pdf-server, qr-server, system-monitor-server, and 15 more | Official starter/demo servers in the `ext-apps` repo `examples/` directory, not production servers | `github.com/modelcontextprotocol/ext-apps/tree/main/examples` |

UNVERIFIED: no independent, dated source was found listing production (non-demo) MCP servers that ship SEP-1865-conformant apps as of 2026-09-20.

## VS Code webview and Electron feasibility

**This is the load-bearing finding of this report.** VS Code's own MCP Apps rendering for Copilot Chat is implemented **inside VS Code core** (`microsoft/vscode`, not the separate `vscode-copilot-chat` extension repo), in `src/vs/workbench/contrib/chat/browser/widget/chatContentParts/toolInvocationParts/chatMcpAppModel.ts` (fetched directly, 888 lines, commit at fetch time). Key facts read from that file:

- It calls `this._webviewService.createWebviewElement({ origin: this._webviewOrigin, ... })` (line 134) — `IWebviewService` is a **workbench-internal service**, not part of the public `vscode` extension API surface. A third-party extension such as Ptah cannot call it.
- Each MCP server gets a **stable, dedicated webview origin**, persisted via `WebviewOriginStore` for local servers or an in-memory UUID map for agent-host servers (lines 594-624) — this origin separation is what satisfies the spec's "Host and Sandbox MUST have different origins" rule (`apps.mdx:474`), and it is achieved through VS Code's own multi-origin webview infrastructure, the same mechanism extension webviews and notebook outputs already use — not something built new for MCP Apps.
- The server-declared CSP is injected as an HTML `<meta http-equiv="Content-Security-Policy">` tag directly into the resource HTML before `setHtml()` (lines 228-281), using the identical directive-construction logic shown in the spec's own CSP example (`apps.mdx:1733-1744`).
- It patches `window.addEventListener`/`removeEventListener` inside the injected HTML to re-target `postMessage` events at `window.parent` (lines ~300-335) and defines an extra, VS-Code-only notification, `ui/notifications/sandbox-wheel`, to forward scroll-wheel events across the nested-iframe boundary (lines 401, 497-498) — evidence that even VS Code core needs custom glue to bridge its internal nested-webview architecture, this is not a drop-in.

**Consequence for Ptah:** `apps/ptah-extension-webview` is already one Angular SPA delivered as the entire content of a single `vscode-webview://…` iframe (confirmed in `apps/ptah-extension-webview/CLAUDE.md` — no router, no `pushState`, one `MESSAGE_HANDLERS` bus). Ptah cannot reach `IWebviewService` from inside that content; it can only nest a second, hand-built sandboxed iframe _inside its own already-sandboxed webview HTML_, using plain `<iframe sandbox>` + a CSP `<meta>` tag Ptah's own Angular app controls. That is precisely the spec's "Host is a web page" case (`apps.mdx:470-488`), and Ptah would have to implement the sandbox-proxy relay itself — VS Code's implementation cannot be reused or imported.

Two concrete constraints on that hand-built path, both worth testing before committing:

1. **Origin separation vs. the proxy's own permissions are in tension for `srcdoc`.** An `<iframe sandbox srcdoc="...">` **without** `allow-same-origin` gets a forced, unique opaque origin — satisfying the spec's "different origin" MUST — but the spec's sandbox-proxy relay needs `allow-scripts allow-same-origin` together (`apps.mdx:475`), and a `srcdoc` frame with `allow-same-origin` inherits the **same** origin as its parent document, defeating the isolation the spec wants (`developer.mozilla.org` CSP docs + community VS Code webview write-ups converge on this; UNVERIFIED as spec text, this is documented browser behavior, not an MCP Apps spec claim). A `blob:` URL iframe (`URL.createObjectURL(new Blob([html], {type: "text/html"}))`) gets its own unique opaque origin regardless of the `allow-same-origin` flag and is the more common workaround — but this still needs empirical verification inside a real VS Code webview before Ptah commits to it.
2. **Ptah's own webview CSP must add `frame-src` (and `child-src` for older Chromium/Electron builds) to permit the inner frame at all.** Since VS Code webviews run on Electron's bundled Chromium in every one of Ptah's three hosts, `frame-src blob:` (for the blob-URL approach) or `frame-src 'self'` (for `srcdoc`, whose framed-document context Chromium treats as matching the parent's own CSP context) is the likely fix — UNVERIFIED without a real test, because `about:srcdoc` has no URL of its own and CSP `frame-src` matching rules for it are not spelled out authoritatively in one place.

**Electron:** Ptah's Electron renderer is an ordinary Chromium renderer, not a VS Code webview, so it has the full menu: `<iframe sandbox>`, the `<webview>` tag, or `WebContentsView`. Electron's own docs now recommend against the `<webview>` tag: "We do not recommend you to use WebViews, as this tag undergoes dramatic architectural changes that may affect stability of your application... Consider switching to alternatives, like `iframe` and Electron's `WebContentsView`" (`electron/electron`, `docs/tutorial/web-embeds.md`, fetched 2026-09-20). Recommendation for Ptah: use `<iframe sandbox>` in Electron too — it is the same primitive as the VS Code path, keeps one implementation for both desktop targets, and preserves the simple in-document `postMessage` relay the spec assumes. Reserve `WebContentsView` (a separate OS-level view, not a DOM element, positioned by the main process) only for an app that genuinely needs its own cookie jar/session partition (e.g. an OAuth-heavy app) — that trades the simple postMessage bridge for main-process IPC forwarding, materially more engineering, and was not required by anything in Ptah's stated use cases (setup wizard, marketplace consent cards).

## Security

**Threat model** (`apps.mdx:1684-1693`): a malicious server can deliver harmful HTML; a compromised View can try to escape its sandbox, execute unauthorized tools, exfiltrate host data, or run phishing/social-engineering content.

**What a View can never do** (by the sandbox, not by host discipline): access the host DOM or cookies, navigate the parent page, run script outside the sandbox, connect to a domain the CSP does not declare, or call a tool it was not declared `"app"`-visible for — that last one is enforced at the protocol level (`apps.mdx:401-402`), not by a runtime consent prompt.

**Consent for app-initiated tool calls is structural, not interactive, by default.** The spec's only literal use of "consent" covers `ui/message` ("Host MAY request user consent," `apps.mdx:1034`). Tool-call authorization instead comes from the server predeclaring `visibility: ["app"]` at registration time and the host enforcing it mechanically on every `tools/call` from a View — there is no spec-mandated per-call user prompt. A host MAY add one (implementation policy), but that is a host choice layered on top of the spec, not a spec requirement — worth flagging since it means a naive host implementation is spec-conformant while still auto-approving every app-initiated tool call the server declared "app"-visible.

**Compared to A2UI's declarative-only model:** A2UI (https://a2ui.org/) eliminates this attack surface differently — it sends JSON descriptions of components from a fixed, pre-approved catalog, never HTML or executable script, so there is no sandbox to escape because there is nothing executable to sandbox. MCP Apps trades that safety-by-construction for expressive power (arbitrary HTML/CSS/JS, any charting/3D/drawing library) and pays for it with the sandboxing, CSP, and origin-isolation machinery documented above. This is the same tradeoff the sibling lane (`research-ag-ui-a2ui.md`) evaluates from the other side; do not duplicate that analysis here.

## Fit for Ptah: host / author / headless

**(a) Value as a HOST.** The adoption table above shows the ecosystem (Claude, VS Code Copilot, Goose, Postman, Cursor, ChatGPT) already treats MCP Apps as the default way a server ships rich UI. Any MCP server Ptah's marketplace/harness flow installs that ships an app (dashboards, config forms, data explorers per the official examples list) would light up automatically once Ptah is a conformant host — this is the single biggest reason to want the capability eventually. Today, UNVERIFIED whether any of the servers Ptah's own marketplace registry indexes already ship SEP-1865 apps; that is a separate, checkable fact this report did not chase because it was out of scope for a protocol-level lane.

**(b) Value as an APP AUTHOR.** Ptah already runs its own MCP server (`libs/backend/vscode-lm-tools`, the Code Execution MCP server, per `libs/backend/vscode-lm-tools/CLAUDE.md`). Shipping a plugin-install consent card, an OAuth-connect card, or a setup-wizard step as an MCP App from that same server means the identical UI would then render, unmodified, inside Claude Desktop, VS Code Copilot Chat, or any other conformant host — a real "write once" argument that the sibling CopilotKit/AG-UI lanes cannot make, since those are Ptah-only UI frameworks with no cross-host portability story. Authoring is strictly lower-risk than hosting: it needs the `App`/`server` SDK halves only, not the iframe/CSP/origin engineering the host role requires, and Angular can drive `App` directly since it is framework-agnostic (see SDK section).

**(c) Headless CLI/TUI.** The spec makes this Ptah's easiest on-ramp: "If host does not support MCP Apps, tool behaves as standard tool (text-only fallback)" and "Tools MUST return meaningful content array even when UI is available" (`apps.mdx:389, 1558-1559`). A server (including Ptah's own, if it becomes an app author) is required to keep working as a plain text-returning tool for a client that never negotiates the `io.modelcontextprotocol/ui` extension — which describes Ptah's CLI/TUI exactly. No extra CLI-side work is needed beyond not negotiating the extension; the fallback is the server's obligation, not the headless client's.

## Work items

Host implementation (if pursued):

- Build a hand-rolled sandbox-proxy iframe (blob-URL or `srcdoc`, tested empirically inside an actual VS Code webview and inside Electron) satisfying the spec's origin-separation MUST.
- Add `frame-src`/`child-src` (and `blob:`/`self` as verified) to the CSP `<meta>` tag `apps/ptah-extension-webview` already emits.
- Implement the host side of the `postMessage` JSON-RPC dialect: `ui/initialize` handshake, `ui/notifications/tool-input`/`tool-result`/`tool-cancelled`/`size-changed`/`host-context-changed`, `ui/resource-teardown`, `ui/open-link`, `ui/message`, `ui/request-display-mode`, `ui/update-model-context`.
- Extend Ptah's MCP client/negotiation code to advertise `io.modelcontextprotocol/ui` with `mimeTypes: ["text/html;profile=mcp-app"]` in `initialize`.
- Add CSP-from-metadata construction, the restrictive-default CSP, resource hashing/allowlisting, and message validation/logging per the host-duties checklist.
- Route theming through `HostContext.styles.variables` using Ptah's existing design tokens.
- Decide and document a consent policy for `"app"`-visible tool calls, since the spec leaves this to host discretion.
- One shared implementation for VS Code and Electron (`<iframe sandbox>` in both), gated behind `platform-core` so CLI/TUI never attempts it.

App-authoring (if pursued):

- Register `@modelcontextprotocol/ext-apps` server-side helpers (`getUiCapability`) in the existing Code Execution MCP server.
- Build one or more `ui://` resources (plugin-install consent card first, per the user's stated interest) using the framework-agnostic `App` class, driven from Angular.
- Provide the mandatory text-only fallback content for every UI-linked tool.
- Test the same resource rendering correctly in at least one external host (Claude Desktop or VS Code Copilot Chat) to prove portability, not just inside Ptah.

## Risks

Host role:

1. VS Code's own approach cannot be copied; Ptah is building the sandbox-proxy pattern from spec text and community write-ups, with the origin/`srcdoc` nuance in the feasibility section UNVERIFIED until tested — real risk of a broken or falsely-secure implementation.
2. Two separate host implementations (VS Code webview vs. Electron renderer) risk drifting apart despite the shared-primitive recommendation above.
3. The spec is 8 months old (stable since 2026-01-26) with an SDK at v2.0.0 published days before this report — API surface and host expectations could still shift under a young major version.

Authoring role:

1. Trademark/marketplace-scanner risk (`CLAUDE.md`'s VS Code Marketplace rules) if any bundled MCP App HTML or docs mentions competitor product names in non-JS files — needs the same `.vscodeignore` discipline Ptah already applies elsewhere.
2. Divergent host rendering of the same `ui://` resource (theming variables, container-dimension modes, display-mode support) is host-implementation-defined; an app tuned against one host may render oddly in another — UNVERIFIED how much this varies across the hosts in the adoption table.
3. `libs/frontend/markdown` is Ptah's one sanctioned XSS chokepoint for AI/user content; an MCP App resource is raw HTML delivered to a real DOM, which is a materially different trust boundary from markdown-to-HTML rendering — any Ptah-authored app must not casually reuse markdown-sanitizer assumptions.

## Unknowns

- Whether the MCP-UI SDK (`@mcp-ui/client`) has actually completed its migration to SEP-1865 compatibility as of 2026-09-20 (`apps.mdx:1580` describes an intended migration, not a completed one).
- Whether `about:srcdoc`'s CSP `frame-src` matching behaves as `'self'` (or requires an explicit scheme) inside Electron's bundled Chromium version specifically — needs an empirical spike, not just spec/MDN reading.
- Whether any MCP server already indexed by Ptah's own marketplace/harness registries ships a conformant `ui://` app today — a Ptah-repo-specific fact, out of scope for this protocol-level lane.
- The current relationship between `IWebviewService`'s webview-origin scheme and whether a future public `vscode` API might expose an equivalent (would remove the biggest VS Code-side risk above) — no roadmap evidence found either way.

## Sources

- https://modelcontextprotocol.io/extensions/apps/overview (fetched 2026-09-20)
- https://modelcontextprotocol.io/extensions/client-matrix (fetched 2026-09-20)
- github.com/modelcontextprotocol/ext-apps — cloned `--depth 1` to `C:\Users\abdal\AppData\Local\Temp\ext-apps-research`, 2026-09-20; files read directly: `specification/2026-01-26/apps.mdx` (full), `LICENSE`, `README.md`, `package.json`, `src/app.ts`, `src/app-bridge.ts`, `src/react/*.ts`, `src/server/index.ts`
- `npm view @modelcontextprotocol/ext-apps` (license, version, publish time, unpacked size) — run 2026-09-20
- https://code.visualstudio.com/blogs/2026/01/26/mcp-apps-support (fetched 2026-09-20; user-facing only, no implementation detail)
- github.com/microsoft/vscode — `src/vs/workbench/contrib/chat/browser/widget/chatContentParts/toolInvocationParts/chatMcpAppModel.ts` and `chatMcpAppSubPart.ts`, fetched via `gh api repos/microsoft/vscode/contents/...` 2026-09-20
- github.com/electron/electron — `docs/tutorial/web-embeds.md`, fetched 2026-09-20
- https://a2ui.org/ (fetched 2026-09-20, brief comparison only — full A2UI analysis is the sibling lane `research-ag-ui-a2ui.md`)
- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\CLAUDE.md` and `D:\projects\ptah-extension\apps\ptah-extension-webview\CLAUDE.md` (Ptah repo context, read-only)
