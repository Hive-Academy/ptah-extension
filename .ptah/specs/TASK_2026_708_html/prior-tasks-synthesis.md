# Prior-tasks synthesis — free HTML for the agent UI (TASK_2026_708_html)

Question this file answers: the user feels Ptah's fixed component schema for agent UI
(`ptah-ui` blocks, the `ptah_surface_update` catalog, the declarative dashboard) kills the
agent's creativity compared with letting the agent write a free HTML/CSS/JS file. This file
records what earlier tasks already decided, built, proved, rejected, or left in backlog, so
the work is not redone.

Method: read the 15 named task folders under `.ptah/specs/` in the main checkout. Preferred
`task.md`, `context.md`, `research-report.md`, `task-description.md`, `decisions.md`, and
verdict or spike files. Skipped `batch-*-report.md` and per-batch reviews. Citations use
`file:line` relative to `.ptah/specs/`. Quoted text is verbatim from the source. Any claim
this lane did not check is marked **UNVERIFIED**.

## 1. Summary

- Ptah's agent-UI channel is schema-only today. The agent writes a `ptah-ui` fenced block
  (TASK_2026_610) or calls `ptah_surface_update` (TASK_2026_538). Both convert to the fixed
  `dashboard-spec` contract, pass a fail-closed Zod validator, and render through
  `libs/frontend/declarative-dashboard`. No agent HTML and no agent scripts render anywhere.
- The user approved this schema-only channel: on 2026-10-04 (fence decision, custom
  templates deferred) and again for TASK_2026_623, which restates "No raw agent HTML, no
  agent scripts (TASK_2026_490/493/494)" (`TASK_2026_623_3492/context.md:101`).
- The same user's product vision (2026-09-20) also demands that Ptah host MCP Apps —
  third-party HTML+JS in sandboxed frames ("Ptah must host MCP Apps and let users author
  them", `TASK_2026_490_583c/context.md:23`). That track was never abandoned. The broker
  behind it was proven (TASK_2026_496, verdict PASS), the containment design was fully
  prepared (TASK_2026_497), and the security precondition shipped (TASK_2026_491).
- Nothing proves that a sandboxed free-HTML artifact works in Electron. The 497 containment
  spike was never run. `blob:` was rejected as an origin fix. The candidates are a
  `ptah-mcp://` custom-protocol iframe or a `WebContentsView` with an ephemeral partition
  (`TASK_2026_497_debb/containment-comparison.md:427-432` for the blob rejection;
  comparison matrix in the same file).
- MCP Apps requires `allow-scripts allow-same-origin` in the sandbox frame (apps.mdx:475,
  cited in `TASK_2026_610_6a10/research-report.md:24`). Under the standing no-scripts rule,
  the strongest sandbox option for agent HTML — option (b), a sandboxed iframe — is
  display-only ("Here the standing rule decides: no scripts, so (b) is display-only",
  `TASK_2026_610_6a10/research-report.md:75`).
- Free agent HTML is parked, not rejected. Agent-registered HTML templates (610 revision 1
  part 4) are deferred with an explicit revisit trigger: "Revisit as a separate task after
  fence usage is measured [user]" (`TASK_2026_610_6a10/task-description.md:157`), and parked
  again in 623 (`context.md:96`).

## 2. Timeline

Status and date come from `task.md` frontmatter unless noted. "—" means the folder holds no
date this lane verified.

| Task | Date | Status (task.md) | What was decided / built | Key evidence |
| ---- | ---- | --------------- | ------------------------ | ------------ |
| TASK_2026_298 | — | backlog, refactoring | Origin design conversation "would generative UI / AG-UI give Ptah anything real?". AG-UI closed as an internal event type. Egress-only leaf lib if ever used. The task's own subject (participant unification) is unrelated. | `context.md:199-230` |
| TASK_2026_490_583c | 2026-09-20/21 | done, RESEARCH | Generative-UI research, 6 revisions. CopilotKit rejected. MCP Apps host moved "Defer, blocked" to "Priority 1" under the user's product vision. Declarative dashboards chosen. Dual-connection broker rejected. Revision 6 security corrections. | `research-report.md:14-24, 130-145, 229-230, 270-274, 384-434`; `context.md:16-26` |
| TASK_2026_491_e0da | — | done, BUGFIX | Electron origin-aware session permission handlers and shell CSP (`frame-src 'none'`). Subframe requests always denied. An adversarial review returned REJECT with 3 blocking findings. All fixed in place. | `context.md`; `TASK_2026_490_583c/defect-register.md:26-43` |
| TASK_2026_494_ca38 | — | done, FEATURE | Verdict on chat visual output: "Planned: yes. Implemented in the coding chat: no." Charts in the coding chat reuse the declarative renderer, not third-party HTML. | `research-chat-visual-output-history.md` |
| TASK_2026_495_2d9f | — | backlog, FEATURE | Pinned apps backlog design only: SQLite storage, deterministic refresh, budgets, text-only delivery, no secrets. Not built. | `context.md` |
| TASK_2026_496_fc4a | 2026-09-21 | done, RESEARCH | Gate 0 spike, verdict PASS. A single-owner MCP broker works: Ptah owns the only upstream connection and re-exposes the server in-process. One mandatory condition proved: `strictMcpConfig: true`. | `spike-report.md:1-14, 308-322` |
| TASK_2026_497_debb | 2026-09-21 | done, RESEARCH | Containment comparison prepared: iframe vs `WebContentsView`, 17 attack fixtures, 7 isolation controls with assertions, spike harness design. The live spike was designed but **not run**; the document itself says "Backlog / Prepared (Pre-Spike Complete)". | `containment-comparison.md`; `agent-output-researcher-expert.md` |
| TASK_2026_520_9c2e | — | backlog, BUGFIX | Peripheral: absolute workstation paths and account names in `.ptah/specs` (CWE-200). Not read in detail. | `TASK_2026_490_583c/defect-register.md:14` |
| TASK_2026_521_3d8b | — | backlog, BUGFIX | `strictMcpConfig` is set nowhere on main. A settings-file MCP server with a matching name starts a second upstream and bypasses `canUseTool` — "an authorization bypass, not a performance problem". Reachability on main must be established first. | `context.md` |
| TASK_2026_522_c6b1 | — | backlog, BUGFIX | Peripheral: e2e profile fix. Contents not read. **UNVERIFIED** relevance. | `task.md` frontmatter only |
| TASK_2026_538_3ccf | 2026-09-23 | done, FEATURE | Surface contract v2 built: forms, lists, selects, two-way state, actions allowlist, `ptah_surface_update`, `ptah_surface_get_state`. 14 deferred items recorded. | `context.md`; `future-enhancements.md` |
| TASK_2026_610_6a10 | created 2026-10-03 | done, FEATURE | "A2UI-shaped generative UI in the coding chat". User decisions 2026-10-04: the agent authors visuals as a `ptah-ui` fenced block, not a tool call. A2UI v0.9 accepted only at the `ptah_surface_update` boundary. Custom HTML templates deferred. Sandbox option (c) — declarative tree with style tokens — chosen. | `task-description.md:85-97, 149-174`; `research-report.md`; `context.md` |
| TASK_2026_623_3492 | 2026-10-09 | in_progress, FEATURE | "Agent-controlled display panel with composable DaisyUI surfaces". Declarative only. Parked: "A2UI v0.9 adapter (610 former PR E) and agent-written HTML templates (610 part 4)" (`context.md:96`). | `context.md:9-19, 94-106` |
| TASK_2026_498_5513 | — | done, devops | Unrelated: npm/Nx dependency migration. Skipped. | — |
| TASK_2026_499_a31f | — | done, devops | Unrelated: ESM and NestJS 12 migration. Skipped. | — |

Referenced outside the folder list: TASK_2026_519_4f1a (backlog, BUGFIX — the CDP automation
window shares `session.defaultSession` with the trusted shell, real today,
`TASK_2026_490_583c/defect-register.md:13`), TASK_2026_593/594/595/532/493 (cited by 610 and
623, folders not read by this lane, **UNVERIFIED**).

## 3. Decisions already made (free HTML / sandboxed iframes / MCP Apps)

Each entry gives the decision, the reason, the source, and who decided it.

**D1. No raw agent HTML. No agent scripts.** Standing project rule, restated by every later
task. Reasons: agent content is untrusted. `libs/frontend/markdown` is the single sanitizer
chokepoint. Revision 6 adds that even the declarative path needs an action allowlist, Zod
validation of every value, no `innerHTML`, URL scheme limits, and host mediation of every
action. Sources: `TASK_2026_610_6a10/context.md:130` ("No raw agent HTML rendered without
the template gate, no agent scripts ever (TASK_2026_490/493/494)");
`TASK_2026_623_3492/context.md:101`;
`TASK_2026_490_583c/research-report.md:391-400`;
`TASK_2026_610_6a10/task-description.md:681` ("No agent scripts, event handlers, URLs or
network requests from agent content [project: TASK_2026_490/493/494]"). Who: user-endorsed
standing rule (chain 490/493/494).

**D2. The dashboard path emits a JSON spec from a fixed catalog, not HTML.** Verbatim:
"The agent emits a JSON spec from a fixed catalog (chart, table, stat, list, form). The
agent does not write HTML for this path." Reason: the Zod validator is the trust boundary,
and the host controls every rendered kind. Source:
`TASK_2026_490_583c/research-report.md:229-230` (Revision 3, a separate page). Who: user
decision.

**D3. CopilotKit: do not adopt (later: not as the chat core).** Reasons recorded: peer
range needs Angular 22 while Ptah was on 21.2.6. Its assistant renderer puts `marked` output
into `innerHTML` with no sanitizer, which breaks the single-chokepoint rule. The custom
transport is documented as Enterprise. 72 packages. Threads, memory and analytics need a
hosted service. Sources: `TASK_2026_490_583c/research-report.md:18, 26-39, 145`. Who: lane
synthesis, checked by the orchestrator. The user changed the criteria in Revision 2 but
kept the rejection.

**D4. AG-UI: closed as an internal event type. Egress only if ever.** Reasons:
`FlatStreamEventUnion` carries `parentToolUseId`, `blockIndex`, `workflowRunId`, compaction
and background-agent events. AG-UI has no counterpart for 10 of 20 Ptah event kinds. The
JSON-RPC schema already covers capability negotiation and bidirectional HITL, so AG-UI buys
only interop with other people's frontends. Sources:
`TASK_2026_298/context.md:199-230`; `TASK_2026_490_583c/research-report.md:19, 41-52`. Who:
design-conversation verdict, confirmed by 490.

**D5. A2UI: pilot (Revision 1) → Priority 3 (Revision 2) → v0.9 accepted only at the
`ptah_surface_update` boundary (610) → adapter parked (623).** Reasons for the narrowing:
A2UI is declarative, so it fits the fixed catalog without a sandbox. But the full renderer
adds a second markdown path (`@a2ui/markdown-it`) and its OnPush, zoneless and CSP behavior
were not verified. The boundary adapter keeps the existing Zod validator as the only trust
boundary and caps the tool-schema growth at 500 tokens. Sources:
`TASK_2026_490_583c/research-report.md:22, 54-77, 136-145`;
`TASK_2026_610_6a10/task-description.md:93, 539-616`;
`TASK_2026_623_3492/context.md:96`. Who: user (Revision 2 priority, 610 Gate 1 decisions,
623 parking).

**D6. MCP Apps host: "Defer, blocked" (Revision 1) → "Priority 1" (Revision 2).** Revision 1
blockers: `frame-src 'none'` in the webview CSP
(`apps/ptah-extension-vscode/src/services/webview-html-generator.ts:276`), and Ptah sees
only `{ name, status }` of third-party MCP servers
(`session-mcp-status-callback-registry.ts:8`), so a host cannot read tool `_meta` or call
`resources/read`. Revision 2 reversed the priority under the user's product vision: "Ptah
must host MCP Apps and let users author them" (`context.md:23`). Sources:
`TASK_2026_490_583c/research-report.md:23, 89-105, 136-145`; `context.md:16-26`. Who: user
(vision) after lane analysis.

**D7. Dual-connection broker rejected. Single-owner broker chosen.** Reason: two upstream
connections create a second authorization path. The host must own the only upstream and
re-expose the server in-process. Source: `TASK_2026_490_583c/research-report.md:270-274`
(Revision 4). Confirmed by the 496 spike. Who: lane synthesis inside a user-approved plan.

**D8. Dashboard track first: "no third-party HTML, no broker, no migration" (Revision 4,
sequence A). Charts in the coding chat reuse the declarative renderer (sequence C).**
Verbatim: "charts in the coding chat (reuse the declarative renderer, not third-party
HTML)" (`research-report.md:314-315`). Echoed in 494: "Reuse the proven declarative
renderer, not arbitrary third-party HTML" (`critique-engineering.md:157`, quoted in
`TASK_2026_494_ca38/research-chat-visual-output-history.md`). Who: orchestrator synthesis.
Revision 5 was an orchestrator proposal the user did not approve ("The user did not approve
it", `research-report.md:327`).

**D9. `_meta.ui.csp` can never add `script-src` sources, `unsafe-inline`, `unsafe-eval`,
wildcards, `frame-src` or navigation.** Reason: app metadata comes from the third-party app.
The host owns a baseline CSP that an app cannot relax. Metadata can only add origins, only
for `connect-src` and resource domains, and each origin must pass a host allowlist. Source:
`TASK_2026_490_583c/research-report.md:402-406`. Who: lane security correction (Revision 6),
binding for TASK_2026_497.

**D10. `blob:` is not an origin-separation fix.** Reason: a `blob:` URL keeps its creator's
origin when the frame has `allow-same-origin`. The real distinct origin is a custom protocol
with one origin per server, app and version. Source:
`TASK_2026_490_583c/research-report.md:430-432`;
`TASK_2026_497_debb/containment-comparison.md` (blob rejected. apps.mdx:475 requires
`allow-scripts allow-same-origin`). Who: lane security correction.

**D11. A text fallback for every UI-linked tool is a Ptah product requirement.** It is
stricter than the MCP Apps spec. Source:
`TASK_2026_490_583c/research-report.md:433-434`. Who: lane correction, adopted as a product
requirement.

**D12. `strictMcpConfig: true` is mandatory for the broker.** Reason: without it, a
settings-file server with the same name starts a second upstream process and takes the name
in `mcpServerStatus()`. The rejected two-connection state arrives by default, not by choice.
Source: `TASK_2026_496_fc4a/spike-report.md:10-14`. Who: lane-proved mandatory condition
(experiment A6).

**D13. Agent-registered custom catalog templates (agent-written HTML/CSS) deferred.**
Recorded reasons: host sources remove most of their token saving because the repeated cost
was data rows. Templates "also extend the 'no agent HTML' rule (TASK_2026_490/493/494) and
need an approval UI and a per-workspace store". Revisit trigger: "as a separate task after
fence usage is measured [user]". Sources:
`TASK_2026_610_6a10/task-description.md:152-157`; `context.md:66-74`. Who: user decision,
2026-10-04, tagged `[user]`.

**D14. The 610 authoring channel is a fenced block, not a tool. Fence blocks are
display-only with no write-back.** Reasons: "agent output stays in context and is resent on
every request, and JSON is about 60% syntax" (`task-description.md:96`), and coding sessions
get no new tool schema (zero tool-schema delta, Req 5.10). Blocks allow only local view
actions — sort, filter, page, expand — and "None of them sends anything to the host or the
agent" (`task-description.md:487-491`). Sources:
`TASK_2026_610_6a10/task-description.md:87-97, 149, 166-167, 487-491`. Who: user decision
2026-10-04.

**D15. Sandbox option (c) — a declarative tree with style tokens — chosen over (a) Shadow
DOM + DOMPurify and (b) a sandboxed iframe.** Reasons: (a) is style encapsulation, not a
security boundary. (b) is the only option that allows arbitrary HTML, but without
`allow-scripts` it is display-only under the no-scripts rule. (c) was chosen first, with
the accepted cost: "Less 'unique HTML' expressiveness; the agent cannot invent a layout
outside the catalog". Sources: `TASK_2026_610_6a10/research-report.md:11, 67-71, 75`. Who:
lane recommendation accepted at Gate 1.

**D16. Consent and permission screens are never agent-driven.** Reason: "An agent must not
author the screen that approves the agent's install." The plugin install consent dialog and
the permission card are security contracts. Source:
`TASK_2026_490_583c/research-report.md:86-87`. Who: lane decision table (Revision 1), never
reversed.

## 4. PROVEN vs OPEN

### PROVEN (with evidence)

- **Broker feasibility — TASK_2026_496, verdict PASS.** Verbatim: "Ptah can own the only
  upstream connection to a third-party MCP server and hand that same server to the vendor
  agent SDK again as an in-process SDK server" (`spike-report.md:3-5`). Tool names stay
  `mcp__<server>__<tool>`, `canUseTool` still runs, and the host keeps tool `_meta`, the
  resource list and the resource bodies. Exit criteria A1–A5 all PASS
  (`spike-report.md:308-322`). Mandatory condition A6 proved by experiment:
  `strictMcpConfig: true` (`spike-report.md:10-14`).
- **What 496 does NOT prove** (`spike-report.md:362-394`): JSON Schema→Zod conversion (the
  largest unproved piece), OAuth, HTTP and SSE transports, other vendor SDKs (they need a
  loopback proxy), and concurrency. **UNVERIFIED** whether any of these was proved later.
- **Security precondition — TASK_2026_491 shipped.** Origin-aware session permission
  handlers and a shell CSP with `frame-src 'none'`. Subframe requests are always denied. The
  `img-src` amendment `'self' https: data: blob:` keeps marketplace icons and markdown
  images loading. An adversarial review returned REJECT with 3 blocking findings. All were
  fixed in place (`TASK_2026_490_583c/defect-register.md:26-43`).
- **Token cost measurements.** The `ptah_surface_update` tool schema measured 65,264
  characters ≈ 16.3k tokens (`TASK_2026_610_6a10/research-report.md:34`, citing
  `TASK_2026_595_1c01/measurement.md` — file not read by this lane, **UNVERIFIED**). Making
  the surface tools Apps-only cut the coding `tools/list` to 54,471 characters on Electron
  (`TASK_2026_610_6a10/task-description.md:72-73`).
- **Sanitizer behavior.** Markdown links were removed from display text because DOMPurify's
  `ALLOWED_URI_REGEXP` permits `data:` and `http:` URIs
  (`TASK_2026_610_6a10/research-report.md:32`).
- **The fence channel is normatively specified.** Grammar (EBNF), fail-closed atomic
  fallback, unforgeable mount rules against TASK_2026_532 defects, host sources
  (`$diff`, `$tests`, `$usage`), and an 8,192-byte cap that keeps one block near 2k tokens
  (`TASK_2026_610_6a10/task-description.md:305-472`).

### OPEN (backlog / deferred / blockers)

- **The 497 live containment spike never ran.** It needs: registration of the `ptah-mcp`
  privileged scheme, a Playwright Electron harness
  (`apps/ptah-electron-e2e/src/mcp-app-containment.spec.ts`), and four measurements: PID
  separation, postMessage latency, `WebContentsView` layout synchrony, memory footprint
  (`TASK_2026_497_debb/containment-comparison.md:255-296`). The harness and 17 fixtures are
  ready.
- **strictMcpConfig on main — TASK_2026_521, backlog.** The broker's mandatory condition is
  defeated by any settings-file server with a matching name. Reachability on main must be
  established before the broker is safe to build.
- **Pinned apps — TASK_2026_495, backlog.** Design only.
- **CDP session sharing — TASK_2026_519, backlog.** The CDP automation window shares
  `session.defaultSession` with the trusted shell. Real today
  (`TASK_2026_490_583c/defect-register.md:13`).
- **Agent-written HTML templates.** Deferred in 610 (D13), parked in 623
  (`context.md:96`). The revisit trigger is fence usage measurement.
- **A2UI v0.9 boundary adapter (610 part 4 / PR E).** Parked in 623
  (`context.md:96`). Sequenced behind TASK_2026_594's catalog bump when active.
- **Surface contract deferred items.** 14 items in
  `TASK_2026_538_3ccf/future-enhancements.md`, including the not-built `surface:release`
  RPC (returned to TASK_2026_539, `TASK_2026_610_6a10/task-description.md:158`).
- **Display panel — TASK_2026_623, in progress.** Declarative only. It respects the
  standing rules and parks the free-HTML items (`context.md:94-106`).
- **No marketplace `ui://` app was ever found.** "Whether an MCP server in the Ptah
  marketplace registries ships a `ui://` app today. Not examined."
  (`TASK_2026_490_583c/research-report.md:125`). **UNVERIFIED** since 2026-09-20.
- **`srcdoc` and `blob:` origin behavior inside a VS Code webview: unknown**
  (`research-report.md:126`). The Electron-first scope makes this secondary.

## 5. Why the current path is schema-only, and does the reason still hold?

The primary reason is a user decision, recorded verbatim:

> "The agent emits a JSON spec from a fixed catalog (chart, table, stat, list, form). The
> agent does not write HTML for this path."
> — `TASK_2026_490_583c/research-report.md:229-230` (Revision 3, user decision)

The standing rule behind it:

> "No raw agent HTML rendered without the template gate, no agent scripts ever
> (TASK_2026_490/493/494)"
> — `TASK_2026_610_6a10/context.md:130`; restated in
> `TASK_2026_610_6a10/task-description.md:681` and `TASK_2026_623_3492/context.md:101`

The accepted tradeoff, chosen knowingly:

> "(c) … Less 'unique HTML' expressiveness; the agent cannot invent a layout outside the
> catalog"
> — `TASK_2026_610_6a10/research-report.md:71`

A second, economic reason: "agent output stays in context and is resent on every request,
and JSON is about 60% syntax" (`TASK_2026_610_6a10/task-description.md:96`). This motivated
the compact fence grammar rather than any verbose format.

Does the reason still hold? Split it into three parts:

1. **The technical blocker is gone.** Revision 1 deferred the MCP Apps host because of
   `frame-src 'none'` and invisible third-party frames. TASK_2026_491 shipped the CSP and
   permission handlers, and TASK_2026_496 proved the broker that makes `_meta` and
   resources visible. In Electron, hosting a third-party frame is no longer blocked by
   code that exists today.
2. **The policy still holds.** "No raw agent HTML, no agent scripts" is a deliberate
   standing rule the user re-approved for 623, not a technical limitation. MCP Apps requires
   `allow-scripts allow-same-origin` (apps.mdx:475), so an interactive sandbox conflicts
   with the rule. Under the rule, a sandboxed iframe is display-only
   (`TASK_2026_610_6a10/research-report.md:75`).
3. **The proof of safe containment is still missing.** No spike has shown that a
   `ptah-mcp://` iframe or a `WebContentsView` actually holds hostile HTML in Electron. 497
   prepared everything but ran nothing.

Conclusion: the schema-only path was chosen for security policy plus context cost, with a
CSP blocker that has since been removed. A "sandboxed free-HTML artifact" feature would not
reopen a dead decision, but it must (1) either stay display-only or win an explicit user
decision to relax the no-scripts rule inside the sandbox, and (2) run the 497 containment
spike first. The smallest experiment was already proposed by 610: "a 20-line
`<iframe sandbox srcdoc>` in the existing chat webview, checking CSS variable injection and
height" (`TASK_2026_610_6a10/research-report.md:93`). **UNVERIFIED** whether anyone ran it.

## 6. Reusable assets

A "sandboxed free-HTML artifact" feature can start from all of this:

- **496 spike package.** Broker bootstrap, assertions A1–A6, exit criteria table,
  environment pinning method, and the mandatory `strictMcpConfig` condition
  (`TASK_2026_496_fc4a/spike-report.md`).
- **497 containment package.** The iframe vs `WebContentsView` matrix across 10 dimensions.
  The origin scheme `ptah-mcp://<server-id>--<app-id>--<version-hash>/index.html`. 17
  attack fixtures in `TASK_2026_497_debb/fixtures/`. 7 Electron isolation controls with
  executable assertions (`nodeIntegration: false`, `contextIsolation: true`, `sandbox:
  true`, `webSecurity: true`, `will-navigate` block, window-open deny, permission denial —
  `containment-comparison.md:178-251`). The Playwright Electron harness design and the 4
  metrics (`containment-comparison.md:255-296`).
- **491 shipped code.** Origin-aware session permission handlers, the shell CSP generator,
  and the `img-src` amendment. Reusable by any frame-hosting feature.
- **The DOMPurify pipeline.** `libs/frontend/markdown` single chokepoint: class allowlist,
  style policy, forbidden tags and attributes, containment root
  (`TASK_2026_610_6a10/task-description.md:51-57`).
- **Surface contracts.** `libs/shared/src/mcp-apps-contracts` (`dashboard-spec/2`,
  `dashboard-catalog/2` and later), the fail-closed Zod validator, `ptah_surface_update` /
  `ptah_surface_get_state`, the actions allowlist, and `surface-text-fallback.ts`
  (TASK_2026_538).
- **610 fence channel.** The normative `ptah-ui` grammar, parser and converter requirements,
  fail-closed fallback with reason line, unforgeable-mount rules, host sources, lazy-load
  and zero-tool-delta gates. A free-HTML artifact could ride the same fence, fallback and
  identity rules (`TASK_2026_610_6a10/task-description.md:305-472, 618-702`).
- **610 A2UI mapping.** The component mapping table and the Req 4.1 verification method
  (pin the raw `server_to_client.json` commit before design)
  (`TASK_2026_610_6a10/research-report.md`; `task-description.md:539-574`).
- **MCP Apps knowledge base.** The sandboxed iframe plus postMessage JSON-RPC sandbox-proxy
  relay (apps.mdx:475), the client matrix (Claude, Claude Desktop, VS Code Copilot, M365
  Copilot, Goose, Postman, MCPJam, ChatGPT, Cursor, Archestra, PostHog Code), recorded in
  the 490 and 610 lane reports.

## Decisions

Decision-record entries the orchestrator can import directly:

1. Do not re-research CopilotKit, AG-UI ingest, or the MCP Apps client matrix. All three
   are closed with citations (D3, D4, D6 above).
2. Treat "no raw agent HTML, no agent scripts" as the standing rule of record. Any
   free-HTML proposal must state which part it relaxes, and why
   (`TASK_2026_610_6a10/context.md:130`; `TASK_2026_623_3492/context.md:101`).
3. The schema-only fence channel is user-approved and normative. Do not undo it to add
   HTML (D2, D13, D14).
4. Free HTML is parked, not rejected. The revival path is: (a) run the 497 containment
   spike, (b) choose a display-only sandbox (no scripts) or win an explicit user exception
   to the no-scripts rule, and (c) revisit "as a separate task after fence usage is
   measured" (`TASK_2026_610_6a10/task-description.md:157`).
5. MCP Apps hosting remains a user product goal (Priority 1). Its preconditions are met —
   broker proven (496), security shipped (491) — except `strictMcpConfig` on main (521).
6. Any new catalog work must respect TASK_2026_594 (semantic kinds, never class names) and
   TASK_2026_595 (surface tools stay Apps-only)
   (`TASK_2026_623_3492/context.md:102-105`).

## Unknowns

- Whether the 497 containment spike or the 20-line `<iframe sandbox srcdoc>` experiment
  ever ran. No evidence in the 15 folders. **UNVERIFIED**.
- `strictMcpConfig` reachability on main (TASK_2026_521 open). **UNVERIFIED**.
- JSON Schema→Zod conversion for the broker — 496's largest unproved piece. **UNVERIFIED**.
- Whether any marketplace MCP server ships a `ui://` app today. "Not examined" in 490.
  **UNVERIFIED**.
- `TASK_2026_623_3492/decisions.md` was read only to line 113 of 190. The unread part
  covers display-panel design rulings. No free-HTML decision was seen in the read part.
  **UNVERIFIED** beyond line 113.
- TASK_2026_493_9f58 (trust boundary tests), TASK_2026_532 (unforgeable mount defects),
  TASK_2026_594/595/539 are cited by the read folders but were not in this lane's folder
  list. Their contents are **UNVERIFIED**.
- TASK_2026_522_c6b1 (e2e profile) was not read. Its relevance to free HTML is
  **UNVERIFIED**.
- The 497 containment-comparison's final metric block ends the file at "4. Memory
  Footprint:" (line 296 of 297). The last line was not read. **UNVERIFIED** (low risk).

Skipped folders, one line each: TASK_2026_498_5513 (npm/Nx dependency migration —
unrelated), TASK_2026_499_a31f (ESM and NestJS 12 — unrelated), TASK_2026_520_9c2e (paths
in specs, CWE-200 — peripheral security hygiene), TASK_2026_522_c6b1 (e2e profile —
peripheral), TASK_2026_298 (participant refactoring — unrelated, but its context.md holds
the AG-UI verdict used in D4).