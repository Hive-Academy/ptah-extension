# Research Report - TASK_2026_610_6a10

## Question

- Decision this supports: scope of the A2UI adapter (part 3), the sandbox for agent-authored templates (part 4), whether a "first coding agent" claim is defensible, and the tool-schema budget for `ptah_render` (part 2).
- Question: what is the A2UI v0.9 wire format, how much of it maps to our surface contract, which sandbox fits, who already renders agent UI in a coding chat, and what does the tool schema cost in context.
- Bounds: A2UI was read through a2ui.org pages fetched via WebFetch (a summarising fetcher, not raw spec JSON). The a2ui-project GitHub schema files were NOT read, so field-level claims need a raw-schema check before the adapter is designed. VS Code webview nested-iframe behaviour was not tested. Not examined: Lit/Angular renderer internals, AG-UI, A2A transport, v1.0 candidate.

## Answer

Build the adapter as a strict, lossy-by-design subset of A2UI v0.9 (createSurface, updateComponents, updateDataModel, deleteSurface; Text/Row/Column/Card/Button/TextField/CheckBox/List-style kinds) onto the existing surface v2 contract. Choose option (c), a declarative tree with style tokens, for part 4 first. Option (a) Shadow DOM plus a CSS allowlist is what the repo already half-built and is the weakest guarantee. Option (b) is the only one that allows arbitrary HTML, and the cost is its host-specific nested-iframe work. Do not claim "first coding agent with A2UI" in a generic form: MCP Apps (agent-authored UI in chat) already ships in Cursor, VS Code Copilot and Goose. A2UI-specific rendering in a coding agent was not found, but absence is unproven.

## Evidence

| Claim | Source | Date | Verified how |
| --- | --- | --- | --- |
| v0.9 server-to-client messages are `createSurface` (surfaceId, catalogId required; theme, sendDataModel optional), `updateComponents` (surfaceId, flat `components`), `updateDataModel` (surfaceId, `path` JSON Pointer default `/`, `value`; omitted value deletes), `deleteSurface` (surfaceId) | https://a2ui.org/specification/v0.9-a2ui/ and https://a2ui.org/reference/messages/ | undated (reference page labels v0.9.1 "Current", v1.0 "Candidate") | read via WebFetch summary |
| Components are an adjacency list: `{id, component:"Text", ...props}`; one component must have id `root`; children are ComponentId references or a template `{componentId, path}` over a data list | same spec page | undated | WebFetch summary |
| Binding uses JSON Pointer (RFC 6901); absolute `/x` or relative inside templates; props are `Dynamic*` types = literal, `{path}`, or `FunctionCall` `{call, args}` | same | undated | WebFetch summary |
| Catalog negotiation: client sends `a2uiClientCapabilities` with `supportedCatalogIds` and optional `inlineCatalogs` via transport metadata; `createSurface.catalogId` is required; basic catalog at `catalogs/basic/catalog.json` | same | undated | WebFetch summary |
| Client-to-server: `action` {name, surfaceId, sourceComponentId, timestamp, context} and `error` {code, surfaceId, path, message}; with `sendDataModel` the full data model is attached as `a2uiClientDataModel` | same | undated | WebFetch summary |
| v0.8 to v0.9: explicit `version:"v0.9"` on each message; explicit `createSurface` replaces implicit creation by `beginRendering`/first update; flat `{component:"Text"}` replaces wrapped `{Text:{}}`; `updateDataModel` `contents` op array replaced by `path`+`value`; "Standard" catalog renamed "Basic"; custom catalogs the intended primary use; `checks` array of named functions for validation; prompt-first design (schema in the system prompt) | https://www.copilotkit.ai/blog/a2ui-whats-new-in-google-generative-ui-spec ; WebSearch result quoting ant-design x-card COMMANDS.md (v0.8 vs v0.9) | undated | WebFetch plus WebSearch, two secondary sources, not the repo diff |
| A2UI spec gives no guidance on untrusted HTML/XSS; trust is left to the client catalog | https://a2ui.org/specification/v0.9-a2ui/ | undated | WebFetch summary (absence claim, weak) |
| MCP Apps (`io.modelcontextprotocol/ui`, `ui://` resources, sandboxed iframe, postMessage JSON-RPC) is supported by Claude, Claude Desktop, VS Code GitHub Copilot, M365 Copilot, Goose, Postman, MCPJam, ChatGPT, Cursor, Archestra, PostHog Code | https://modelcontextprotocol.io/extensions/client-matrix (community-maintained) and https://modelcontextprotocol.io/extensions/apps/overview | undated | read both |
| Cursor 2.6 shipped MCP Apps rendering in the agent chat | https://forum.cursor.com/t/cursor-2-6-mcp-apps/153482 | undated in snippet | WebSearch result only, page not opened |
| A2UI adopters: CopilotKit/AG-UI, ADK, AG2; CopilotKit has a VS Code extension that previews A2UI catalog components (a dev tool, not a coding-agent chat) | https://docs.copilotkit.ai/generative-ui-specs/a2ui ; https://docs.showcase.copilotkit.ai/ag2/vs-code-extension | undated | WebSearch snippets only |
| MCP Apps in VS Code uses a nested iframe on an allowed frame domain | WebSearch summary of https://www.sean-weldon.com/blog/2026-06-11-building-interactive-uis-in-vs-code-with-mcp-apps-marlene-mhangami-liam-hampton-github | 2026-06-11 | secondary, unverified detail |
| Our catalog: layout `section, stack, grid, card`; input `text, select, radio-group, checkbox`; display `stat, line-chart, bar-chart, table, list` | `libs/shared/src/mcp-apps-contracts/surface-catalog.ts:25-47`, `dashboard-catalog.ts:57-63` | 2026-10-03 | read |
| Our versions: `dashboard-spec/2`, `dashboard-catalog/2` (594 plans `/3`) | `surface-catalog.ts:11-12`; context.md coordination note | 2026-10-03 | read |
| Our ops: `set-data`, `remove-data`, `add-component`, `replace-component`, `remove-component`, `set-title`; operations `create`/`replace`/`patch`/`delete` | `surface.schemas.ts:500-557` | 2026-10-03 | read |
| Our data paths are dot-separated identifiers (`^[A-Za-z_][A-Za-z0-9_-]*$`, max 8 segments, proto denylist), not JSON Pointer; actions are a fixed id allowlist (`dashboard.*`, `surface.submit`) | `surface-catalog.ts:59-69`, `:36-41` | 2026-10-03 | read |
| Display text is plain text only; markdown was removed because DOMPurify's `ALLOWED_URI_REGEXP` permits `data:`/`http:` | `dashboard-catalog.ts` doc comment (revision 1 note), citing `libs/frontend/markdown/src/lib/provide-markdown-rendering.ts:72` | 2026-10-03 | read |
| Markdown pipeline already sanitises with DOMPurify (`dompurify ^3.3.3`): class allowlist, `style` dropped if it contains `/*` or `\` or declares position/inset/top/right/bottom/left/z-index, plus a containment-root wrapper; own comment says the whole-attribute drop avoids a "parser trap" and a deny-list "race" | `libs/frontend/markdown/src/lib/provide-markdown-rendering.ts` (hook, ~lines 30-130), `package.json:161` | 2026-10-03 | read |
| Current `ptah_surface_update` serialized definition is 65,264 chars (about 16.3k tokens at chars/4); `ptah_dashboard_propose_spec` 1,613; `ptah_surface_get_state` 2,217; whole tools/list 123k chars apps vs 54k coding | `.ptah/specs/TASK_2026_595_1c01/measurement.md` | 2026-10-03 | read; token figure is chars/4, not a tokenizer |
| DOMPurify 3.3.2 and earlier have a mutation-XSS CVE when output is reinserted into wrapper contexts; keep the pin at or above 3.3.2 | https://osv.dev/GHSA-h8r8-wccr-v5f2 (and releasealert listing) | undated | WebSearch snippet |

## Options

### Mapping table (question 2)

| A2UI item | Our kind / operation | Gap |
| --- | --- | --- |
| `createSurface` {surfaceId, catalogId} | surface `operation:'create'` with envelope | catalogId must equal a supported catalog id string, else reject. `theme` and `sendDataModel`: ignore theme (we use theme tokens); `sendDataModel` maps to our state-read tool, not push. Lossless for id and catalog. |
| `updateComponents` flat list with `root` | `add-component` / `replace-component` ops on a nested tree (`children` per node) | Structural gap: adjacency list vs nested tree. Converter must build a tree, reject cycles, orphans, duplicate ids, missing `root`, and enforce `maxTreeDepth`, `maxChildrenPerNode`. Doable, lossless for tree-shaped input; DAG reuse of one id by two parents must be rejected. |
| `updateDataModel` {path JSON Pointer, value} | `set-data` / `remove-data` (dot path) | Pointer `/a/b` to `a.b` works only for segments matching our segment pattern; array indices, `~0/~1` escapes and keys with other characters are rejected. Max depth 8. Omitted value maps to `remove-data`. |
| `deleteSurface` | `operation:'delete'` | Lossless. |
| `Text` | `text` display? We have no plain static text kind in the 13 listed; `stat`/`list` do not fit | New kind needed (static text/heading) or reject. Biggest functional gap. Text must stay plain text (see markdown removal). |
| `Row` / `Column` | `stack` direction horizontal/vertical, `gap` | Lossless subset; A2UI `justify`/`align` unmapped (drop or reject). |
| `Card` | `card` | Lossless. |
| `List` with template children `{componentId, path}` | `list` (data-driven items) is a display kind, not a template container | Template iteration with relative paths has no equivalent; reject, or expand server-side against the current data model (loses live re-render). |
| `Button` + `action` | action allowlist ids (`dashboard.*`, `surface.submit`) | A2UI action names are free-form; we only allow ids. Map `name` through a fixed table or reject unknown. Event context is host-built, never agent-supplied. |
| `TextField` | `text` input | Binding by `path` maps to our binding; two-way local write matches `surface-bindings.ts`. `checks` named functions: map `required`/`email`/length only if our validator has them, else reject. |
| `CheckBox` | `checkbox` | Lossless. |
| `ChoicePicker`/select-like | `select`, `radio-group` | Lossless if options are literal. |
| `Image`, `Icon`, `Video`, `AudioPlayer` | none | Reject (URL channel; `https:` allowlist only, fetch/privacy concern). |
| `Tabs`, `Modal`, `Divider`, `Slider`, `DateTimeInput` | none | Reject or new kinds later; Modal is an overlay risk. |
| `FunctionCall` (`formatString`, etc.) | none | Reject in v1; `formatString` would need a safe evaluator. |
| `theme` | theme tokens | Ignore. |
| `inlineCatalogs` from client | none | We would advertise one fixed `supportedCatalogIds` entry (our catalog); never accept agent inline catalogs without the part-4 approval gate. |
| `error` client message | tool error text | Map validator errors to A2UI `error` shape so A2UI-aware agents self-correct. |
| Our `stat`, `line-chart`, `bar-chart`, `table`, `list` | no A2UI basic-catalog equivalent | These are the value of our catalog; expose them as a custom catalog id (`ptah-dashboard-catalog/N`), which is what v0.9 custom catalogs are for. |

Lossless now: createSurface, deleteSurface, Card, Row/Column, CheckBox, select-like, TextField (basic), data updates on simple paths. Needs a new kind: static Text/heading (plus maybe Divider). Reject: media components, Modal, FunctionCall, templated children, inline catalogs, free-form action names.

### Sandbox options (question 3)

| Option | Fit here | Cost to adopt | Known failure mode |
| --- | --- | --- | --- |
| (a) Shadow DOM + DOMPurify HTML subset + CSS property allowlist | `libs/frontend/markdown` already has the DOMPurify setup, class allowlist and position denial | Moderate: write a CSS parser/serialiser rather than the current string splitting | Shadow DOM is style encapsulation, not a security boundary. Same-origin: no CSP isolation, shared event loop. CSS is a real channel: `url()`, `@import`, `image-set()`, `cursor:url()` leak via requests; attribute-selector plus `background:url()` exfiltrates attribute values; `position:fixed` and large `z-index` overlay the chat (the repo's own comments admit the deny-list is "a race"). Making CSS safe means parsing it to a property+value allowlist with no `url()`, at which point you have built option (c) in a worse form. DOMPurify has had mXSS advisories (>=3.3.2 needed). |
| (b) One shared iframe, `sandbox` without `allow-scripts`, `srcdoc`, CSP `default-src 'none'; style-src 'unsafe-inline'; img-src data:` | Strongest isolation for arbitrary HTML; same model as MCP Apps | High and host-specific: nested iframe inside VS Code webview and Electron renderer, height messaging needs script (none allowed, so use fixed or ResizeObserver from parent is impossible cross-origin: measure via `sandbox="allow-same-origin"` only, which weakens it) or accept scroll boxes; theme tokens must be injected as CSS variables into srcdoc; one frame per surface is heavy, one shared frame needs serial rendering | Without scripts: no auto-resize, no actions/events, no selection capture; the template is display-only. With scripts: you are back to agent-script execution, which standing decisions (TASK_2026_490/493/494) forbid. VS Code nested-iframe constraints (frame ancestors, CSP of the webview) were NOT tested. |
| (c) Declarative tree of existing primitives plus style tokens, no HTML | Matches the standing decisions (semantic kinds, no class names, charts via declarative renderer) and the Claude Code mods approach in context.md; reuses the validator as trust boundary | Low-moderate: add a few kinds (text, divider, badge, key-value, code block) and a token set (colour role, size, emphasis, density) to catalog v3, sequenced with 594 | Less "unique HTML" expressiveness; the agent cannot invent a layout outside the catalog. Mitigation: the "template" in part 4 becomes a registered composition of primitives with `{slot}` data bindings, cached per workspace. |

## Disagreements

- "Sandboxed iframe makes agent HTML safe" (MCP Apps docs) vs this repo's standing rule of no agent scripts: MCP Apps relies on scripts running inside the sandbox plus a postMessage bridge. A no-script iframe is safer but loses interactivity and sizing. Here the standing rule decides: no scripts, so (b) is display-only.
- v0.9 "prompt-first, richer schema" (CopilotKit post) vs our fail-closed atomic validator: A2UI expects tolerance; we reject the whole spec on any unknown kind. Keep ours; return A2UI-shaped `error` for self-correction.
- "First coding agent": MCP Apps matrix lists Cursor, VS Code Copilot, Goose, PostHog Code as rendering UI in agent chat. Defensible only as narrower claims (for example, "first coding agent with a first-party A2UI-subset adapter plus tokenised agent templates"), and only after checking the A2UI repo and community renderer list, which this pass did not do.

## Local consequences

- `libs/shared/src/mcp-apps-contracts/`: adapter belongs in a new file beside `surface.validator.ts`; it emits our `SurfaceUpdateRequest` and never bypasses the zod validator. Catalog changes (static text, tokens) bump `dashboard-catalog` and must sequence with TASK_2026_594's `/3`.
- `surface-bindings.ts` / `surface-data-model.ts`: JSON Pointer to dot-path translator with strict rejection (indices, escapes, depth over 8).
- `libs/frontend/markdown/.../provide-markdown-rendering.ts`: do not extend its string-based `style` handling into a CSS sanitiser; it was explicitly designed as a bounded deny-list. If option (a) is ever chosen, it needs a parser, not this hook.
- Coding profile tool list: adding `ptah_render` is the only schema cost. Baseline coding profile is 54,471 chars (about 13.6k tokens) on Electron; `ptah_surface_update` alone is 65,264 chars (about 16.3k tokens), larger than the whole coding list.
- Estimate (not measured): a minimal `ptah_render` with `{surfaceId?, spec | a2ui messages[]: array of objects, templateId?, data?}` and `additionalProperties` left to the on-demand skill for the catalog is roughly 600-1,500 chars (about 150-400 tokens), 2% or less of `ptah_surface_update`. The saving only holds if validation errors, not the schema, teach the catalog. Measure it with `ptah_count_tokens` once drafted.
- Claim copy (README/marketing): do not state "first" without the narrower qualifier above.

## Unknowns

- Raw a2ui-project schema files (`server_to_client.json`, `basic_catalog.json`): exact basic-catalog component list, props, ChoicePicker/Tabs names, `Dynamic*` shapes. Smallest experiment: fetch the schema files from GitHub raw and diff against the mapping table.
- Whether any coding agent renders A2UI proper (not MCP Apps): not found in search; "A2UI in the World" page was not opened.
- Cursor 2.6 and VS Code MCP Apps details rest on search snippets; open the forum post and VS Code docs before citing in public copy.
- VS Code webview nested sandboxed iframe: CSP and frame-ancestors behaviour in our webview untested; smallest experiment is a 20-line `<iframe sandbox srcdoc>` in the existing chat webview, checking CSS variable injection and height.
- Token estimates use chars/4; no tokenizer count of either schema.
