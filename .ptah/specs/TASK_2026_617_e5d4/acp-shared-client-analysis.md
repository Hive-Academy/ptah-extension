# TASK_2026_617_e5d4 — Shared ACP client transport: difficulty assessment

Analysis only. No code was changed. Evidence: the Grok probe (`grok-probe.md`, measured on
grok 1.0.46, win32), the adapter folder
(`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/`), the message router
and the process manager, and the TASK_2026_591 context (opencode serve design).

Headline: a shared ACP client is a **moderate, mostly one-time** cost. The protocol core is
small, one existing adapter (Pi) already proves the pattern of a bespoke long-lived stdin RPC
channel, and the router/manager need no structural change because they are capability-driven.
Vendor #1 (Grok) carries the setup cost; vendor #2+ is a fraction of it.

---

## 1. Proposed layering and the interfaces to add

### Shape

Three layers, one direction of dependency:

1. **`AcpConnection`** — vendor-neutral v1 JSON-RPC over stdio. Owns framing
   (newline-delimited JSON), the request-id map, pending-request promises, the
   agent-to-client request handler (permission prompts), notification dispatch, and the
   `session/update` → `CliOutputSegment` mapping for the standard update kinds.
2. **`AcpVendorProfile`** — a small record with function members per vendor: spawn
   command/flags, session-new parameters (cwd, `mcpServers`, `_meta`), an extension
   notification filter, a permission-policy hook, and a quirk table. Grok's profile carries
   `--no-leader` (mandatory: through `--leader`, the MCP child got the leader's env and cwd —
   `grok-probe.md` §3) and ignores every `_x.ai/*` notification (`grok-probe.md` §5).
3. **`AcpCliVendorAdapter implements CliAdapter`** — the thin shell the manager already calls.
   It composes a connection from the profile and exposes the `SdkHandle`, following the
   structure of `PiCliAdapter` (the closest existing analogue: a long-lived child driven over
   stdin RPC, session captured up front, turn-level `done`).

Placement. Put layers 1 and 2 in
`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/acp/`, beside the adapters.
That library's tags are `scope:extension` / `type:feature`
(`libs/backend/cli-agent-runtime/project.json`) and it already imports `platform-core`
(`killProcessTree`, `IProcessSpawner`) and `shared`, not `vscode-core`, in adapter code
(`cli-adapter.utils.ts` imports; `opencode-cli.adapter.ts:78`); the router and manager import
`vscode-core` (`agent-message-router.service.ts:22`, `agent-process-manager.service.ts:14`),
but the ACP files must not, so the transport stays host-agnostic and any future CLI-lane
runtime can reuse it. Only if a second host (headless CLI/TUI) needs the same transport should
it be promoted to its own library (tags `scope:shared`, `type:util`, like
`platform-core`, `project.json` shown above) — not before, per the repository rule against
speculative libraries (TASK context; one implementation, one location).

### Interfaces to add (sketch)

```ts
// cli-adapters/acp/acp-connection.ts
export interface AcpClientCapabilities {
  readonly fs?: boolean;        // readTextFile/writeTextFile offered
  readonly terminal?: boolean;
}

export interface AcpPromptContentBlock { readonly type: 'text'; readonly text: string; }

export interface AcpNewSessionParams {
  readonly cwd: string;
  readonly mcpServers: readonly AcpMcpServer[]; // stdio {command,args,env[]} | http {url,headers}
  readonly meta?: Record<string, unknown>;      // vendor _meta, e.g. Grok yoloMode
}

export interface AcpPromptResult {
  readonly stopReason: 'end_turn' | 'cancelled' | vendor string;
  readonly meta?: { readonly sessionId?: string; readonly usage?: AcpPromptUsage };
}

export interface AcpConnectionHandlers {
  /** Agent-to-client requests: session/request_permission, fs/*, etc. */
  readonly onRequest: (req: AcpJsonRpcRequest) => Promise<unknown>;
  /** session/update and every other notification (vendor extensions included). */
  readonly onNotification: (n: AcpJsonRpcNotification) => void;
  readonly onStderr?: (line: string) => void;
  readonly onExit?: (code: number | null, signal: string | null) => void;
}

export class AcpConnection {
  constructor(
    spawn: SpawnedProcessHandle,        // platform-core handle, same as spawnCli
    handlers: AcpConnectionHandlers,
  ) {}
  initialize(capabilities: AcpClientCapabilities): Promise<AcpInitializeResult>;
  newSession(params: AcpNewSessionParams): Promise<{ sessionId: string; result: unknown }>;
  prompt(sessionId: string, content: readonly AcpPromptContentBlock[]): Promise<AcpPromptResult>;
  /** Notification, no id — session stays addressable (grok-probe.md §5: 21 ms). */
  cancel(sessionId: string): void;
  setConfigOption?(sessionId: string, configId: string, value: unknown): Promise<void>;
  loadSession?(sessionId: string, cwd: string, mcpServers: readonly AcpMcpServer[]):
    Promise<{ sessionId: string }>; // caller must discard replayed history
  closeSession?(sessionId: string): Promise<void>;
  getPid(): number | undefined;
  dispose(): Promise<void>;           // best-effort close, then killProcessTree
}

/** Standard session/update kinds, mapped in ONE shared place. */
export function mapSessionUpdate(
  update: AcpSessionUpdate,
  emit: (segment: CliOutputSegment) => void,
  emitOutput: (text: string) => void,
): void;
// agent_message_chunk → text delta; agent_thought_chunk → thinking delta;
// tool_call → tool-call segment; tool_call_update → tool-result (or tool-result-error)
// available_commands_update, session_info_update → ignored (or info segment).

// cli-adapters/acp/acp-vendor-profile.ts
export interface AcpVendorProfile {
  readonly vendor: string;
  /** Spawn command, args and env; always include the safety flags. */
  buildSpawn(binaryPath: string, options: CliCommandOptions, mode: 'first-run' | 'resume'):
    { readonly command: string; readonly args: readonly string[]; readonly env?: NodeJS.ProcessEnv };
  /** Grok: buildSpawn must contain --no-leader (grok-probe.md §3) — pin with a spec. */
  buildSessionNewParams(options: CliCommandOptions): Omit<AcpNewSessionParams, 'cwd'>;
  /** Default 'select first allow option' / fail with a reason; adapter may override. */
  resolvePermissionRequest?(req: AcpJsonRpcRequest): Promise<unknown> | undefined;
  /** Profile-level hook for queue/MCP/status notifications. Default: ignore unknown. */
  mapExtensionUpdate?(n: AcpJsonRpcNotification): CliOutputSegment[] | undefined;
  parseModelList?(initialize: AcpInitializeResult): CliModelInfo[] | undefined;
  /** Documented, per-profile turn quirks the shared client must not generalise. */
  readonly quirks: {
    readonly queuedPromptsAutoStartAfterCancel: boolean; // Grok: true — grok-probe.md §5.3
    readonly loadReplaysHistory: boolean;                // Grok: true — grok-probe.md §5
    readonly preferNativeQueue?: boolean;                // Grok: true
  };
}
```

The `CliOutputSegment` and `FlatStreamEventUnion` types already exist in
`@ptah-extension/shared` (`cli-adapter.interface.ts:8-16`); nothing new goes into `shared`
except, optionally, the `'grok'` `CliType` value (`libs/shared/src/lib/types/agent-process.types.ts:79-81`,
and the brand list at `libs/shared/src/lib/types/cli-skill-sync.types.ts:29`).

### The Grok profile in numbers (from the probe)

| Concern | What the profile must do | Evidence |
| --- | --- | --- |
| Spawn | `grok agent --always-approve --no-leader stdio` | `grok-probe.md` §5, §3 |
| Initialize | Send `protocolVersion: 1` + clientCapabilities; read model list from `_meta.modelState` | §5 `initialize` |
| New session | `{cwd, mcpServers, _meta:{yoloMode}}`; `session/new.mcpServers` accepts stdio + http with headers | §4, §5 |
| Update mapping | Standard kinds only; ignore `_x.ai/*`; `_x.ai/mcp/*` optional info segments | §5 |
| Permission | `session/request_permission` arrives as a JSON-RPC request when `--always-approve` is absent; auto-answer or forward | §5 Permissions |
| Cancel | `session/cancel` notification; resolves on the running prompt's response (21 ms) | §5 Cancel |
| Resume across process death | `session/load` (replays history — discard) or `session/resume` | §5 `session/load` |
| Models | `initialize._meta.modelState.availableModels[]` (structured), not `grok models` text | §6 |

---

## 2. Build the minimal client vs adopt the official SDK

Measured facts:

- No ACP package is in `package.json` or `node_modules` (root deps checked: only
  `@anthropic-ai/claude-agent-sdk`, `@anthropic-ai/sdk`, `@cursor/sdk`, `@openai/codex-sdk`
  for the agent surface).
- The official TypeScript SDK is **`@agentclientprotocol/sdk`** (v1.6.1 at the time of this
  search, zero runtime dependencies, ships types); `@zed-industries/agent-client-protocol`
  is deprecated and renamed into it. Licence: Apache-2.0 (Zed states ACP is Apache-licensed;
  the sibling adapters are Apache-2.0). The SDK's own package licence should be re-verified
  at install time — flagged here as an assumption.
- **ACP v2 is a published draft that may break incompatibly in any SDK release** (its own
  README warning). Grok 1.0.46 speaks v1 (`protocolVersion: 1`, `grok-probe.md` §5).

| Option | Pros | Cons |
| --- | --- | --- |
| Adopt `@agentclientprotocol/sdk` | Correct framing, ids, and typed v1 schema for free; schema updates ride its releases; 0 dependencies; permissive licence | A new supply-chain pin inside a VS Code/Electron bundle; its strict typed schema may fight vendor looseness (unknown `sessionUpdate` values, `_meta` piggyback) — **assumption to verify** against the Grok transcripts; v2 churn pressure over time; `esbuild` build config of `cli-agent-runtime` (`project.json` external list) must carry it |
| Build a minimal v1 client | Matches the repository precedent exactly: `PiCliAdapter` already embeds a bespoke JSONL-over-stdin RPC client of comparable size (`pi-cli.adapter.ts:321-500`); total scope is a few hundred lines; every claim verifiable against the probe transcripts; no new dependency | Schema types are hand-written and drift without a fixture; no free protocol upgrades when v2 stabilises |

Recommendation: **build the small v1 client in-house**, behind the `AcpConnection` boundary
named above, and keep the official SDK as a known replacement if v2 support becomes a
requirement. The protocol surface Ptah needs is narrow (4 methods + 1 notification + 1
agent-to-client request), the Grok behaviour is already measured, and the repository has
twice avoided an in-process or third-party agent runtime where a small channel suffices
(`pi-cli.adapter.ts:16-19` documents the in-process-SDK ESM failure;
TASK_2026_591 chose `run` over `serve` for Phase 1). The boundary keeps that decision cheap
to reverse.

---

## 3. Mapping the shared handle to `SdkHandle`, and what the router/manager need

The `SdkHandle` contract (`cli-adapter.interface.ts:97-147`) maps to one long-lived ACP
process per spawned agent:

| `SdkHandle` member | ACP realisation | Notes |
| --- | --- | --- |
| `abort` (AbortController) | `dispose()` — best-effort `session/close`, then `killProcessTree(getPid())` | Same shape as `PiCliAdapter`'s `killChild` (`pi-cli.adapter.ts:338-349`) |
| `done` | Resolves with 0 when the **current** `session/prompt` response returns `stopReason: 'end_turn'`; 1 on connection death or non-zero child exit | Per-turn `done`, like `runTurn` in `pi-cli.adapter.ts:367-500` |
| `getSessionId` / `onSessionResolved` | Synchronous after `session/new` (`grok-probe.md` §5) | Manager writes it to the record via `captureSessionId` (`agent-process-manager.service.ts:924-930`) |
| `getPid` | The long-lived child's pid, always available | Keeps `killProcess` on the tree-kill branch (`agent-process-manager.service.ts:2551-2555`) instead of `waitForSdkSettle` |
| `onOutput` / `onSegment` | `createBufferedEmitter` channels fed from `mapSessionUpdate` + filtered extension notifications | Same emitters as every adapter (`cli-adapter.utils.ts`, `createBufferedEmitter`) |
| `steer` | **Not implemented** for Grok (no mid-turn injection observed; `grok-probe.md` §5.5) | Router then prefers interrupt |
| `interrupt` + `supportsInterrupt` | Send `session/cancel`; resolve on the cancelled prompt's response | Router's `interruptAndResume` awaits exactly this (`agent-message-router.service.ts:170-209`) |
| `supportsContinuation` / `continue` | Another `session/prompt` on the same session; returns a new `done` | Matches `continueConversation`'s shape (`agent-process-manager.service.ts:1846-1885`) |
| `setAgentId` | No-op pass-through (permission routing id, as Copilot uses it) | `agent-process-manager.service.ts:893` |

Router impact: **none.** The router is explicitly capability-driven and never branches on a
CLI name (`agent-message-router.service.ts:10-19`, `resolveCapabilities` at 336-359). With
`{ steer: false, interrupt: true, continuation: true }`, a mid-turn message takes
`interrupt-resume` (cancel, await settle, re-submit) — the honest mapping for a CLI whose
queue survives a cancel and auto-starts (`grok-probe.md` §5.3), because the re-submitted
prompt lands after the cancelled one, as user intent implies.

Manager impact: small.

- **Type plumbing (required):** add `'grok'` to `SYSTEM_CLI_TYPES`
  (`libs/shared/src/lib/types/agent-process.types.ts:79-81`), the brand list
  (`cli-skill-sync.types.ts:29`), adapter registration (`cli-detection.service.ts:56-73`),
  lane-spawn policy, model-list service, and tribunal discovery — the same list the task's
  `context.md` Phase 1 records for a Pi-style adapter.
- **Lifecycle (no change):** `done` → `handleExit`, `currentTurnDone`, idle release, stop,
  timeout and `disposeAll` all already work off the generic handle surface
  (`agent-process-manager.service.ts:949-973`, `2202-2216`, `2534-2575`). Idle release after
  `SDK_IDLE_RELEASE_MS` kills the ACP child; the next entry is then `resume_session_id`, whose
  gate re-spawns through `prepareSdkHandleSpawn` → `session/load` inside the adapter's resume
  mode. `loadSession` replay must be discarded (measured: `grok-probe.md` §5) — a profile
  quirk, not manager code.
- **One subtle behaviour to document, not change:** for a continuation-capable handle the
  budget guard survives the turn (`agent-process-manager.service.ts:2311-2313`) and a guard
  steer without `handle.steer` is logged and skipped, while the stop threshold still applies
  (`1045-1054`). That is the correct Grok behaviour; no edit needed.

The only genuinely new manager-adjacent work is in the adapter: the lifecycle that Pi does per
turn (spawn → prompt → settle → kill) becomes spawn once → `initialize` → `session/new` →
prompt per turn → keep process (idle release stays the reaper). That is the single biggest
design change versus today's adapters, and it is bounded by the idle/TTL machinery that
already exists.

---

## 4. Maintenance cost and risk

### Shared vs per-vendor

| Shared (once) | Per-vendor (each) |
| --- | --- |
| JSON-RPC framing, request-id map, timeouts | Spawn command, flags, env (Grok `--no-leader`) |
| `initialize` / `session/new` / `prompt` / `cancel` sequence | Session-new params incl. MCP entries and `_meta` |
| `session/update` → `CliOutputSegment` standard mapping | Extension notification policy (`_x.ai/*` ignored) |
| Permission request handling (auto-answer / bridge) | Auth surface (Grok OAuth cached token; unauth path unmeasured) |
| Connection lifecycle, dispose, tree-kill | Resume flavour (`session/load` vs flags) |
| Fake agent fixture and contract specs | Model list source, quirk table |

### Test strategy

- **One scripting fake ACP agent** (a small Node fixture binary speaking newline-delimited
  JSON-RPC) drives every vendor profile. The pattern exists: `pi-cli.adapter.spec.ts:237`
  pins the exact spawn args; `cursor-cli.adapter.spec.ts:842` pins capabilities. The fake
  replays scenarios keyed to the probe transcripts (queued second prompt, cancel within
  milliseconds, permission request, replayed `load` history).
- **Contract specs per profile** assert spawn args (including `--no-leader`), session-new
  params, capability declarations, and quirk flags — the compile-error rule
  (`capabilities()` and `roleChannel` required, `cli-adapter.interface.ts:205`,
  `cli-adapter.interface.ts:212`) already blocks silent drift.
- **One behavioural spec suite against a real CLI** (Grok, when installed) pinned to the
  probe's measured invariants; the fake fixture is derived from, and kept in step with, those
  transcripts.

### Protocol negotiation and vendor drift

- `initialize` echoes `protocolVersion`; refuse a session when the agent's version is
  neither the one sent nor the next known integer (`grok-probe.md` §5: Grok answers `1`).
  Unknown-value tolerance is the rule, not strictness: unknown `sessionUpdate` kinds and
  unknown methods are ignored or surfaced as info segments, never fatal — the probe
  demonstrated an agent that mixes protocol families (`server/discover` at
  `protocolVersion "2026-07-28"` rejected by the stub without a turn failure).
- Drift is contained inside the profile and the quirk table: version-gated flags
  (`supportsStandalone` precedent, `opencode-cli.adapter.ts:503-521`), and a capabilities
  probe recorded at `detect()` time.
- Unknown-method handling for vendor extensions: probe with a real method list at runtime;
  never call an unverified `_x.ai/*` method (nothing beyond the documented methods was
  verified for Grok, `grok-probe.md` "Not established").

### Effort table

Relative unit: vendor #1 as observed scope ≈ 1.0 (with the shared layer built).

| Work item | Relative effort | Reused later |
| --- | --- | --- |
| `AcpConnection` (framing, ids, permission hook, dispose) | ~0.35 of vendor #1 scope | fully |
| `session/update` → segment mapping (standard kinds) | ~0.10 | fully |
| Fake agent fixture + shared contract suite | ~0.20 | fully |
| Manager/type plumbing (`CliType`, registration, detection) | ~0.05 | ~90% |
| Grok profile (spawn, session-new, `_x.ai/*` filter, quirks) | ~0.30 | pattern only |
| **Vendor #1 (Grok), total** | **1.0** | — |
| **Each additional vendor, total** | **~0.25** | — |

That ~0.25 per later vendor is the profile record, its quirk table, its contract specs, and a
probe session. It covers only vendors that implement ACP v1 well; a vendor whose ACP surface
is weak (partial `mcpServers`, no queue or cancel semantics) pushes its cost toward vendor #1.

### Named risks

1. **Unstable spec edge** — ACP v2 is a draft; a future Grok (or Gemini) release could
   negotiate v2 or change field shapes. Contained by the version gate and fixture reruns.
2. **Vendor extensions** — `_x.ai/queue/*`, `_x.ai/mcp/*`, `_x.ai/session/*` carry
   information the model flow depends on (queue position, MCP readiness). Ignoring them is
   proven safe for parsing but loses visibility; exposing them is per-profile code that can
   break silently.
3. **Auth flows** — the unauthenticated path (`authMethods`, `authenticate`), `XAI_API_KEY`
   mode, and expired-token behaviour were not measured (`grok-probe.md` "Not established").
   The first real failure will be an auth failure the adapter cannot classify yet.
4. **MCP differences** — Grok routes MCP tools through `search_tool`/`use_tool` as
   `<server>__<tool>` and spends an extra model call on the first turn; whether a
   many-tool Ptah MCP server behaves there is unmeasured. This is the highest-value
   unverified behaviour in the whole plan, because the Ptah MCP route is why ACP was chosen.
5. **Windows process handling** — the long-lived child plus its grandchildren (the MCP
   children it spawns) need tree-kill on dispose; `killProcessTree` is the established
   primitive (`opencode-cli.adapter.ts:641-647`, `agent-process-manager.service.ts:2551-2555`).
   Residual: whether `session/cancel` kills the shell child of a running tool is unmeasured
   (`grok-probe.md` §5.4) — a cancelled turn may leave a detached grandchild.
6. **Queue-semantics variance** — Grok queues prompts natively and auto-starts them after a
   cancel; a vendor with a native steer instead would invert the router's choice. The
   capability declaration and the router already handle either, but the interrupt-resume
   message ("partial work DISCARDED", `agent-message-router.service.ts:203-208`) must stay
   truthful per vendor — a quirk-table note, not logic.
7. **Provider-side errors** — exit codes and error events for auth/quota/5xx were not
   captured for either Grok transport (`grok-probe.md`), so the lane-limit classifier has no
   Grok wordings yet.

---

## 5. Which existing adapters could migrate to ACP later, and whether it pays

| Adapter | Transport today | ACP migration | Verdict |
| --- | --- | --- | --- |
| `opencode` | One-shot `opencode run --format json` per turn (`opencode-cli.adapter.ts:554-728`); the `opencode serve` design in TASK_2026_591 was the long-lived alternative | opencode ships an ACP surface (community and editor integrations run it over ACP) | **Highest value.** Its capabilities are all `false` today (`opencode-cli.adapter.ts:289-291`); an ACP profile would give it queue + interrupt without the separately-designed `serve` HTTP surface. Migrate when TASK_2026_591 Phase 2 reopens, after measuring its ACP surface like Grok's |
| `codex` | In-process `@openai/codex-sdk` (`codex-cli.adapter.ts`), continuation supported | An ACP adapter exists in the ecosystem | **Low value.** The SDK already gives continuation and MCP; ACP would replace a working in-process surface with a spawned one for no capability gain |
| `cursor` | In-process `@cursor/sdk`, `interrupt+continuation` (`cursor-cli.adapter.ts:272-273`) | Not needed | **No.** Capabilities already match what ACP would offer |
| `copilot` | In-process SDK (`copilot-sdk.adapter.ts`), continuation | Not needed | **No.** same as Codex |
| `pi` | Bespoke stdin RPC (`pi-cli.adapter.ts`) | Pi is not an ACP agent | **No.** Its native `steer` (`pi-cli.adapter.ts:204-206`) is richer than ACP's queue; migration is a regression |
| `antigravity` | Plain-text print mode | No ACP surface | **No.** |
| `ptah-cli` | In-process agent SDK (`@anthropic-ai/claude-agent-sdk`) | `@agentclientprotocol/claude-agent-acp` exists | **No.** In-process SDK is proven; an ACP bridging process adds a failure point |

Keep the current transports as fallbacks: yes, for every adapter on this list, and in
particular for Grok — keep one-shot `grok -p` as the fallback transport and the
`detect()` probe surface, exactly as the probe recommends (`grok-probe.md` §"Recommendation").
The ACP surface for a new vendor is measured thinly; the fallback keeps a lane usable when
the ACP handshake cannot answer (auth, version, MCP). The manager already supports an
adapter falling back internally, because everything downstream reads the handle, not the
transport.

---

## Bottom line

One shared `AcpConnection` plus per-vendor profiles is a sound fit for this repository: the
router and manager already consume exactly the surface ACP can fill (`agent-message-router.service.ts:336-359`),
Pi's adapter is the in-repo precedent for a long-lived stdin RPC child
(`pi-cli.adapter.ts`), and the Grok probe shows the protocol delivers two of the three
messaging modes natively plus per-session MCP injection. Vendor #1 is the whole set-up cost;
vendor #2+ inherits a fake agent fixture, a segment mapper, and a profile template. The
highest-value unknown is whether a full Ptah MCP server works under Grok's
`search_tool`/`use_tool` indirection — measure that first after Grok lands.

## Open Questions for the User

1. **In-process permission UX**: when `--always-approve` is absent, should Grok's
   `session/request_permission` be auto-answered ("first allow option", as the probe did),
   forwarded to the frontend permission bridge (the Copilot path), or refused with a lane
   error? This decides whether the shared client needs the permission bridge hook at all.
   *(Recommended: auto-answer in vendor #1, forward through a profile hook later.)*
2. **Queue semantics for mid-turn Grok messages**: prefer `interrupt-resume` (cancel 21 ms,
   discard partial work — the router's current best mechanism for `steer:false,
   interrupt:true`), or declare `interrupt: false` so mid-turn messages park as
   `queue-next-turn` and finish their partial work? The probe supports either.
   *(Recommended: keep `interrupt: true`; the native queue still receives the resumed
   prompt.)*
3. **Build the client in-house vs adopt `@agentclientprotocol/sdk`** (§2). The analysis
   recommends in-house behind an `AcpConnection` boundary. Confirm before the
   implementation plan.
4. **Scope of vendor #2**: is opencode's ACP surface the intended next target (replacing the
   TASK_2026_591 `serve` design), or is Gemini CLI first? It changes whether the profile
   layer is designed for "resume across process death" (`session/load`) as a first-class
   requirement or as a later addition.