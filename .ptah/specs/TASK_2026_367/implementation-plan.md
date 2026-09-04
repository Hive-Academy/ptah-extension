# TASK_2026_367 — Implementation Plan

Architect: software-architect. Date: 2026-09-02. Branch: `fix/log-defects-367`.

Inputs read: `context.md`, `research-report.md`, `research-report-harness.md`,
root `CLAUDE.md`. Every contract below cites the line that was read in the
current working tree.

---

## 0. Constraints that shaped this design

### 0.1 Files no batch may touch

**Group A — another person's uncommitted work (never touch):**

- `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts`
- `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts`
- `libs/backend/agent-sdk/src/lib/types/sdk-types/content-block-contract.spec.ts`
- `apps/ptah-electron-e2e/src/specs/chat/empty-assistant-envelope.spec.ts`

Reading Group A is allowed. `claude-sdk.types.ts` is read by this plan for the
`SpawnedProcess` / `SpawnOptions` contract only.

**Group B — the 236 files on `feat/native-agent-loop-pi-ai` (TASK_2026_362).**
Computed with `git diff --name-only main...feat/native-agent-loop-pi-ai`. The
files in Group B that this plan would otherwise have modified are:

| Group B file                                                                                                                                                              | Consequence for this plan                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `libs/backend/agent-sdk/src/index.ts`                                                                                                                                     | The public barrel cannot gain an `OffThreadProcessSpawner` export. See D-7a.                                                                                                   |
| `libs/backend/agent-sdk/src/lib/di/register.ts`                                                                                                                           | No new agent-sdk DI registration. Not needed — see D-7a.                                                                                                                       |
| `apps/ptah-electron/src/di/phase-2-libraries.ts`, `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`, both `expected-resolvable.ts`, both `container.smoke.spec.ts` | No new DI token may be introduced. Every design below reuses an existing token.                                                                                                |
| `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`                                                                                                                         | `ChatAbortResult` cannot gain `alreadyEnded`. See D-5a.                                                                                                                        |
| `libs/shared/src/lib/types/agent-adapter.types.ts`                                                                                                                        | `IAgentAdapter.interruptSession` cannot change its return type. See D-5a.                                                                                                      |
| `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`                                                                                                  | `abortSession` cannot change. See D-5a.                                                                                                                                        |
| `libs/backend/vscode-lm-tools/**` (`index.ts`, `protocol-dispatcher.ts`, `slow-tool-warning.ts`, `ptah-tool-catalog.ts`, `mcp-http/*`, `di/register.ts`)                  | The PulseMCP removal touches `tool-description.builder.ts`, `harness-namespace.builder.ts` and `ptah-api-builder.service.ts` only. None of the three is in Group B — verified. |
| `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`, `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts`                                             | Both carry mojibake. Both are excluded from the C7c sweep.                                                                                                                     |

Verified clean (zero Group B entries): `libs/backend/cli-agent-runtime/**`,
`libs/backend/vscode-core/**`, `libs/backend/memory-curator/**`,
`libs/backend/harness-sync/**`, `libs/frontend/chat/**`,
`libs/frontend/marketplace/**`, `libs/shared/src/lib/types/rpc.types.ts`,
`libs/shared/src/lib/types/mcp-directory.types.ts`,
`libs/backend/agent-sdk/src/lib/helpers/**`,
`libs/backend/agent-sdk/src/lib/message-transform/stream-event.transformer.ts`,
`libs/backend/platform-core/src/index.ts` and
`libs/backend/platform-core/src/interfaces/**` (the only platform-core entry in
Group B is `src/file-settings-keys.ts`).

### 0.2 Out of scope — state it, do not batch it

1. **`[MCP] slow tool` for browser tools.** Page-bound, and the warning code
   moved to `slow-tool-warning.ts` on the TASK_2026_362 branch (Group B).
2. **C6c, the harness blocked set (`blocked: 12`).** No change. Research
   proved the behaviour is working as designed: `blocked = missing ∩ foreign`
   is the documented mechanism, the reconciler already de-duplicates the WARN
   per unchanged set (`harness-reconciler.service.ts:112`, `loggedBlockedSets`),
   and the consent dialog is TASK_2026_306 Batch 9. `harness-sync/CLAUDE.md`
   names "reclassify `blocked` out of `missing`" as the documented WRONG fix.
   **No batch, no log-level change, no file edit.**
3. **Codex CLI spawn latency.** `codex-cli.adapter.ts` runs `@openai/codex-sdk`
   in process and never calls `spawnCli`. Its internal subprocess launch is
   outside Ptah's control, so the largest measured lag (2166–2923 ms on the
   four codex tribunal rounds) is **not** addressed by C7a. Stated so nobody
   reads C7a as a fix for it.
4. **The `PluginLoaderService.resolvePluginPaths` "dedupe".** Dropped, with
   evidence. The two calls per spawn are not the same computation:
   `resolvePluginPaths` (`plugin-loader.service.ts:828`) resolves the
   enabled-only list for `assembleSpawnOptions`, and `resolveCurrentPluginPaths`
   (`:1140`) resolves the harness-inclusive list for the preflight source
   resolver (`plugin-config-source-resolver.ts:173`). Each does one
   `fs.existsSync` per plugin — three per call in the observed session. That is
   microseconds, not a 2 s stall. A memo cache would add an invalidation problem
   for no measurable gain.
5. **The `e`-acute and non-breaking-space mojibake families.** Excluded from the
   C7c sweep: both have a real false-positive risk (legitimate accented text,
   legitimate non-breaking space) and neither appears in the corpus.

### 0.3 Repo rules applied throughout

`catch (error: unknown)` then narrow with `instanceof Error`. Zod at external
boundaries only. Public-barrel-only imports across libs. The facade rule when a
class grows a collaborator. `max-lines` soft ceiling 700. RPC dual-registration
for any new method. Never `nx test a b c` — always `npx nx run-many -t test -p ...`.

---

## 1. C1 — one shared stderr classifier

### Component boundary

A new pure module inside `cli-agent-runtime`, next to the adapters that already
own the duplicated regex. It is a leaf: no DI, no logger, no I/O.

### Verified contract

- Four adapters carry a byte-identical regex and use it the same way:
  `antigravity-cli.adapter.ts:534`, `opencode-cli.adapter.ts:488`,
  `pi-cli.adapter.ts:422`, `copilot-sdk.adapter.ts:374`. All four then call
  `segment.emit({ type: isError ? 'error' : 'info', content: … })`.
- The fifth site logs every stderr line at ERROR unconditionally:
  `ptah-cli-registry.ts:728-731` —
  `stderr: (data: string) => { this.logger.error(...) }`.
- `codex-cli.adapter.ts` has no raw stderr path (it uses `@openai/codex-sdk`
  in process). It is **not** a call site.

### Files

- **CREATE** `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-stderr-severity.ts`
- **CREATE** `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-stderr-severity.spec.ts`
- **MODIFY** the four adapters listed above (replace the inline regex with the import).
- **MODIFY** `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:728-731`.

Name check: `cli-stderr-severity.ts` names the concept, not a bag. It passes the
nameability test (no `utils`, `helpers`, `common`, `misc`).

### API

```ts
/** How a CLI child's stderr line should be treated. */
export type CliStderrSeverity = 'error' | 'info';

/** Classify one already-trimmed, ANSI-stripped stderr line. */
export function classifyCliStderr(line: string): CliStderrSeverity;
```

The regex stays private to the module. One definition, five readers.

### Data flow and log-level mapping

- Four adapters: `segment.emit({ type: classifyCliStderr(cleaned), … })` —
  behaviour unchanged, duplication removed.
- `ptah-cli-registry.ts`: `classifyCliStderr(data) === 'error'` →
  `this.logger.warn(...)`; otherwise → `this.logger.debug(...)`. **Never
  `logger.error`.** A child's stderr line is the child's diagnostic, not the
  host's failure.

Why `warn` and not `error` even on a match: research proved the three observed
lines are benign CLI notices, and the classifier is a keyword heuristic. A
heuristic must not be able to mint an ERROR.

### Failure behaviour

A benign line containing "timeout" or "denied" is demoted to `warn` rather than
promoted — the classifier can only lower the ceiling. An empty or whitespace
line classifies `info`; the adapters already guard with `if (!cleaned) return`.

### Spec that pins it

`cli-stderr-severity.spec.ts`:

- `classifyCliStderr('[claude-code:unrecognized_model] {"model":"glm-5.2:cloud"}')` is `'info'`.
- The connector notice line (`claude.ai connectors are disabled because ANTHROPIC_API_KEY …`) classifies `'info'`.
- `classifyCliStderr('Error: ENOENT')` is `'error'`.
- Word-boundary behaviour: `'terminated'` does not match `'abort'`.

`libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-spawn-model.spec.ts`
(existing) gains: **the `stderr` callback never calls `logger.error`**; a benign
line reaches `logger.debug`; a matching line reaches `logger.warn`.

---

## 2. C2 — the "Spawned headless agent" model

### Verified contract

- The correct locals are resolved once at `ptah-cli-registry.ts:613-621`:
  `const tier: ModelTier = options?.modelTier ?? 'sonnet'` (`:613`), then
  `const model = modelOverride || agentConfig.selectedModel?.trim() || spawnFromTiers || ''`
  (`:617-621`).
- They are already logged correctly at `:662-672` ("Building spawn options",
  `modelTier: tier, sdkModel: model`).
- The defect is a second, wrong resolution at `:813-815`:
  `const effectiveTiers = this.resolveEffectiveTiers(agentConfig, provider);`
  `const providerModel = effectiveTiers?.sonnet ?? provider.staticModels?.[0]?.id ?? 'default';`
  consumed by the log at `:816-818`.

### Files

- **MODIFY** `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:813-818`.

### Change

Delete lines 813-815 entirely. Replace the log line with:

```ts
this.logger.info(`[PtahCliRegistry] Spawned headless agent "${agentConfig.name}" (${id}) ` + `with model ${model || '(unresolved)'} (tier: ${tier})`);
```

`model` already encodes the override, `selectedModel` and tier precedence
(`:616-621`), so no second concept of "provider model" is needed.

### Failure behaviour

When no model resolves, `model` is `''` and the existing warn at `:626-630`
already fires. The log then reads `with model (unresolved) (tier: opus)`, which
is the honest report.

### Spec that pins it

`ptah-cli-registry-spawn-model.spec.ts`: spawning with `{ modelTier: 'opus' }`
against a config whose tiers are
`{ sonnet: 'kimi-k2.7-code:cloud', opus: 'glm-5.2:cloud' }` asserts the
"Spawned headless agent" message contains `glm-5.2:cloud` and `tier: opus`, and
does **not** contain `kimi-k2.7-code:cloud`.

---

## 3. C3 — OAuth discovery failure becomes an actionable UX

### Verified contract

- `discoverAuthServerMetadata` throws a bare `Error` at
  `mcp-oauth-metadata.ts:128-130`: `No OAuth authorization-server metadata found
for ${base}. The server may not support OAuth discovery.`
- The RPC handler catches, logs, and returns `{ success: false, error: err.message }`
  at `mcp-directory-rpc.handlers.ts:754-762`. **Nothing is swallowed on the
  wire.** The `RpcHandler` "succeeded" debug line is transport-level and stays.
- The result type is
  `McpDirectoryConnectOAuthResult { success; serverKey?; error? }` at
  `mcp-directory.types.ts:407-413`.
- The component already renders the failure: `oauth-surface.component.ts:477-481`
  sets `connectError`, rendered by the template at `:98-108`.
- The RPC registry lives in `libs/shared/src/lib/types/rpc.types.ts`:
  `RpcMethodRegistry` entries at `:1190-1252` and the
  `RPC_METHOD_ENTRIES: Record<RpcMethodName, true>` mirror at `:3352`+ (the
  `mcpDirectory:*` block is at `:3479-3494`). Both must gain the new method or
  the `_MissingRpcMethodNames` check at `:3770-3774` fails to compile.
- `'mcpDirectory:'` is already in `ALLOWED_METHOD_PREFIXES` (`rpc-handler.ts:75`).
  **No runtime-guard change is needed.**

### Files

- **MODIFY** `libs/backend/cli-agent-runtime/src/lib/mcp-directory/oauth/mcp-oauth-metadata.ts` — add and throw `OAuthDiscoveryError`.
- **MODIFY** `libs/backend/cli-agent-runtime/src/lib/mcp-directory/index.ts` — export the error class and the probe entry point.
- **MODIFY** `libs/backend/cli-agent-runtime/src/lib/mcp-directory/oauth/mcp-oauth.service.ts` — add `probeDiscovery(serverUrl)`.
- **MODIFY** `libs/shared/src/lib/types/mcp-directory.types.ts` — additive `reason` plus the probe params and result types.
- **MODIFY** `libs/shared/src/lib/types/rpc.types.ts` — register `mcpDirectory:probeOAuthDiscovery` in both places.
- **MODIFY** `libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.ts` — classify by error name; register the probe method with a Zod schema.
- **MODIFY** `libs/frontend/marketplace/src/lib/oauth-surface.component.ts` — hint plus debounced probe.
- **CREATE** `libs/backend/cli-agent-runtime/src/lib/mcp-directory/oauth/mcp-oauth-metadata.spec.ts`.
- **CREATE or EXTEND** `libs/frontend/marketplace/src/lib/oauth-surface.component.spec.ts`.

### The named error

```ts
export const OAUTH_DISCOVERY_ERROR_NAME = 'OAuthDiscoveryError';

export class OAuthDiscoveryError extends Error {
  override readonly name = OAUTH_DISCOVERY_ERROR_NAME;
  constructor(readonly serverUrl: string) {
    super(`No OAuth authorization-server metadata found for ${serverUrl}. ` + `The server may not support OAuth discovery.`);
  }
}
```

Classification is by **`instanceof` first, `name` second**. The `name` fallback
is required, not decoration: an error crossing an esbuild bundle boundary or a
`structuredClone` loses its prototype, and the repo already matches
`PROVIDER_AUTH_ERROR_NAME` and `PROVIDER_QUOTA_ERROR_NAME` by name for exactly
that reason. Never match by message substring.

### The additive wire field

```ts
/** Why a connectOAuth attempt failed. Absent on success and on unclassified failures. */
export type McpOAuthFailureReason = 'no-oauth-discovery' | 'other';

export interface McpDirectoryConnectOAuthResult {
  success: boolean;
  serverKey?: string;
  error?: string;
  /** Present only when `success` is false. */
  reason?: McpOAuthFailureReason;
}
```

Purely additive. Every existing consumer keeps compiling. Do **not** widen the
union speculatively: `'registration-failed'` and `'callback-timeout'` have no
classifier and no UI copy, so adding them now would ship two dead arms.

### The pre-submit probe

New method `mcpDirectory:probeOAuthDiscovery`.

```ts
export interface McpDirectoryProbeOAuthDiscoveryParams {
  serverUrl: string;
}
export interface McpDirectoryProbeOAuthDiscoveryResult {
  /** True when authorization and token endpoints were discovered. */
  supported: boolean;
  reason?: McpOAuthFailureReason;
}
```

The handler validates `serverUrl` with Zod, using the same URL rule
`ConnectOAuthSchema` already applies (boundary rule), calls
`oauthService.probeDiscovery`, and returns
`{ supported: false, reason: 'no-oauth-discovery' }` on `OAuthDiscoveryError`.
**The probe never opens a browser and never registers a client.** It runs only
the metadata fetch that `mcp-oauth.service.ts` already performs as its first
step.

### Frontend data flow

1. `onUrlInput` (`oauth-surface.component.ts:416`) writes `urlInput`.
2. A new `discoveryHint = signal<'none' | 'probing' | 'needs-api-key'>('none')`.
3. A debounced effect (400 ms, cancelled on further input and on destroy
   through the existing `destroyed` flag) calls the probe when the URL parses
   as an absolute `https:` URL. A URL that does not parse resets the hint to
   `'none'` and issues no call.
4. On `{ supported: false, reason: 'no-oauth-discovery' }` the template shows an
   inline note next to the URL field: **"This server does not publish OAuth
   discovery metadata. It probably needs an API key instead. Check the server's
   documentation."**
5. The failure branch of `connect()` (`:476-481`) shows the same sentence when
   `result.data.reason === 'no-oauth-discovery'`, instead of the raw `error`
   string.

The Connect button is **never disabled** by the probe. A curated
`OAUTH_SUGGESTIONS` server whose probe is rate-limited must still be
connectable. The probe is advisory only.

### Failure behaviour

A probe transport failure leaves the hint at `'none'` and surfaces no error. A
probe is a hint, and a failed hint is silence, not an alarm. The probe result is
discarded if `urlInput()` changed while it was in flight — compare the URL
captured before the call.

### Specs that pin it

- `mcp-oauth-metadata.spec.ts`: a server with no metadata endpoints rejects with
  an error whose `name` is `'OAuthDiscoveryError'`.
- `mcp-directory-rpc.handlers.spec.ts`: `connectOAuth` against a throwing
  service returns `{ success: false, reason: 'no-oauth-discovery' }`; an
  unrelated `Error` returns `reason: 'other'`; `probeOAuthDiscovery` returns
  `{ supported: false, reason: 'no-oauth-discovery' }` and rejects a non-URL
  param through Zod.
- The compile check for the RPC registry is already enforced by
  `rpc.types.ts:3770-3774`. No new spec is needed for it.
- `oauth-surface.component.spec.ts`: typing a URL debounces to exactly one probe
  call; a `no-oauth-discovery` probe renders the API-key hint; a `connect()`
  failure with `reason: 'no-oauth-discovery'` renders the same hint instead of
  the raw message.

---

## 4. C4 — chunked map and reduce curation

### Decision D-4: fork the pattern into `memory-curator`. Do not promote it.

Three verified reasons.

1. **The input shapes differ.** `TranscriptWindowReader.open()`
   (`transcript-window.reader.ts:1-95`) reads **JSONL through an I/O seam** and
   indexes role-bearing turns. The curator receives an **already-rendered
   string** — `ROLE: content` records joined on `\n\n`, per
   `clamp-transcript.ts:56-61`. A shared engine would have to carry both, which
   is the abstraction the root `CLAUDE.md` warns against.
2. **`memory-contracts` is the wrong home.** Its `src/index.ts` exports types,
   tokens and null implementations only — every entry is `export type` except
   `MEMORY_CONTRACT_TOKENS`, `KNOWLEDGE_AGENT_TOKEN` and the `Null*` classes. A
   windowing engine is behaviour, not a contract. Putting it there turns a
   zero-dependency port lib into a utility lib.
3. `memory-curator` and `skill-synthesis` are sibling leaves with no dependency
   between them. A shared lib for one 200-line pure module is a third project to
   tag, register and maintain.

What is forked is the **pattern**, not the code: pure, deterministic,
index-addressed windows with an explicit omission marker.

### Verified contract

- The single chokepoint is `MemoryCuratorService.clampForModel`
  (`memory-curator.service.ts:337-352`), called once from `doCurate`
  (`:363-366`) before `this.llm.extract(transcript, input.signal)` (`:388`).
- `CURATOR_TRANSCRIPT_MAX_CHARS = 32 * 1024` (`clamp-transcript.ts:48`), head
  share `0.25` (`:54`), record separator `'\n\n'` (`:61`).
- `ICuratorLLM` (`memory-contracts/src/lib/curator-llm.port.ts:77-93`) has
  `extract(transcript, signal)` and `resolve(drafts, related, signal)`.
  **Neither signature changes.**
- Worst observed case: `originalChars: 366540, keptChars: 32336` (8.8 percent).

### Files

- **CREATE** `libs/backend/memory-curator/src/lib/curator-llm/transcript-windows.ts`
- **CREATE** `libs/backend/memory-curator/src/lib/curator-llm/transcript-windows.spec.ts`
- **MODIFY** `libs/backend/memory-curator/src/lib/memory-curator.service.ts` (`clampForModel` becomes `windowForModel`; the `doCurate` extract step becomes a loop)
- **MODIFY** `libs/backend/memory-curator/src/lib/memory-curator.service.spec.ts`
- `clamp-transcript.ts` is **unchanged**. It stays the last-resort guard.

### The new module

```ts
/** One record of the transcript, addressed by its zero-based index. */
export interface TranscriptRecord {
  readonly index: number;
  readonly text: string;
}

/** A bounded, record-index-addressed slice, ready to send to the curator model. */
export interface CuratorWindow {
  readonly text: string; // never longer than maxChars
  readonly recordIndices: readonly number[];
  readonly windowIndex: number; // zero-based, for the omission marker
  readonly windowCount: number;
}

/** Compress tool_use and tool_result bodies inside one record. Pure. */
export function compressToolNoise(transcript: string): string;

/** Split on the record separator. Never splits inside a record. Pure. */
export function splitTranscriptRecords(transcript: string): TranscriptRecord[];

/** Deterministic, non-overlapping, record-boundary windows. Pure. */
export function buildCuratorWindows(records: readonly TranscriptRecord[], options: { maxChars: number; maxWindows: number }): CuratorWindow[];
```

`compressToolNoise` truncates a `tool_result` body to 600 characters and a
`Bash` command to 80, with an explicit truncation marker — the exact figures
`TranscriptWindowReader`'s own turn renderer uses, so there is one number to
reason about across the two libs. A record longer than `maxChars` on its own is
character-truncated with a marker rather than dropped: an empty window burns an
LLM call for nothing.

### Data flow in `doCurate`

```
raw transcript
  -> compressToolNoise                                   (pure, no LLM)
  -> if length <= CAP:  ONE window                       (today's cost exactly)
  -> else: clampTranscript(compressed, CAP * MAX_WINDOWS) (last-resort guard)
           -> splitTranscriptRecords
           -> buildCuratorWindows({ maxChars: CAP, maxWindows: MAX_WINDOWS })
  -> for each window (sequential, abort-checked): llm.extract(window.text, signal)
  -> union the drafts, drop exact-duplicate (subject, content) pairs
  -> ONE llm.resolve(unionedDrafts, related, signal)
```

Constants, in `transcript-windows.ts`:

- `CURATOR_WINDOW_MAX_CHARS = CURATOR_TRANSCRIPT_MAX_CHARS` — imported, not
  re-declared. One number.
- `CURATOR_MAX_WINDOWS = 8`.

### The LLM-call budget, stated explicitly

**Maximum 9 LLM calls per PreCompact firing: 8 `extract` plus 1 `resolve`.**
Today it is 2. The common case — a transcript that fits after compression —
stays at **exactly 2**: one window, one extract, one resolve. Ordinary sessions
cost nothing more.

Coverage for the observed worst case: 8 times 32 KB is 262 144 characters of
_compressed_ text. The 366 540-character sample is tool-heavy, so compression is
expected to bring it inside the budget. If it does not, `clampTranscript` still
applies at `CAP * MAX_WINDOWS` and coverage rises from 8.8 percent to at least
71 percent. The `clampTranscript` WARN keeps firing in that case, which is
correct: it now signals that a session exceeded even the chunked budget.

### Failure behaviour

- A window's `extract` throwing **abandons the run** through the existing
  `recordCuratorError(input.sessionId, error, 'extract')` path
  (`memory-curator.service.ts:390-392`). Never silently curate a partial
  transcript: a partial extraction that looks complete is worse than a recorded
  failure.
- A window returning `status: 'stalled'` stops the loop and takes the existing
  `recordCuratorStall` path. A stall is a cooldown, so the remaining windows
  would all stall too.
- `input.signal.aborted` is checked **between** windows, not only inside the
  adapter, so an abort during a long chunked run stops promptly.
- Zero drafts across every window takes the existing empty-stats path,
  unchanged.

### Specs that pin it

`transcript-windows.spec.ts`:

- Every window satisfies `window.text.length <= maxChars`, on a corpus that
  includes one record larger than `maxChars`.
- Windows do not overlap, and their `recordIndices` concatenate to a strictly
  ascending sequence. No record is served twice and none is dropped silently.
- `maxWindows` is respected exactly, and the omission is reported.
- `compressToolNoise` is idempotent and never lengthens its input.
- Determinism: two calls on the same input produce identical windows.

`memory-curator.service.spec.ts`:

- A transcript under the cap produces **exactly one** `extract` call and one
  `resolve` call. This is the no-regression assertion.
- A 400 KB transcript produces at most 8 `extract` calls and exactly one
  `resolve`, and the resolve receives the union of every window's drafts.
- An `extract` rejection on window 3 records a curator error and issues no
  `resolve`.
- An abort signalled after window 2 stops the loop.

---

## 5. C5a — `chat:abort` on an already-ended session

### Verified contract

- `SessionControlService.endSession` warns and returns when no record exists:
  `session-control.service.ts:118-124` —
  `Cannot end session - not found: ${sessionId}`, then `return;`. Return type
  `Promise<void>`.
- `SdkAgentAdapter.interruptSession` (`sdk-agent-adapter.ts:1010-1014`) awaits
  it and returns `Promise<void>`.
- `ChatSessionService.abortSession` (`chat-session.service.ts:847-886`) awaits
  `sdkAdapter.interruptSession(sessionId)` and then returns `{ success: true }`
  **unconditionally**.
- The frontend has **no retry loop**. `ConversationService.abortCurrentMessage`
  (`conversation.service.ts:125-231`) has a re-entry guard `_isStopping`
  (`:127-130`) released in `finally` (`:229`). The loop is the user: on
  `result.success` the method deliberately does **not** idle the tab
  (`:203-207`, TASK_2026_360), because the backend is expected to emit the
  ordered terminal `turn_state`. When the session is already gone, no such event
  ever arrives, the spinner never clears, and the user presses Stop again. That
  is the observed three attempts.

### Decision D-5a: split C5a into a deliverable half and a blocked half

The wire change needs `ChatAbortResult` (`rpc-chat.types.ts:282`),
`IAgentAdapter.interruptSession` (`agent-adapter.types.ts:252`) and
`ChatSessionService.abortSession`. **All three are Group B files.** The
root-cause fix therefore cannot ship in full on this branch.

**C5a-now (this task).** Two changes, neither touching a Group B file, that
close the observed loop.

1. `SessionControlService.endSession` returns a typed outcome instead of `void`,
   and stops warning about the benign case.

   ```ts
   export type EndSessionOutcome = 'ended' | 'already-ended';
   async endSession(sessionId: SessionId): Promise<EndSessionOutcome>
   ```

   The not-found branch logs at **`info`** with
   `[SessionLifecycle] Session already ended, nothing to interrupt` and returns
   `'already-ended'`. Widening a `void` return is backward compatible:
   `SdkAgentAdapter.interruptSession` keeps its `Promise<void>` signature
   (Group B pins it) and ignores the value for now. Nothing else changes shape.

2. `ConversationService.abortCurrentMessage` gains a **stale-session guard**. A
   new private `_lastAbortedSessionId = signal<string | null>(null)` is set
   immediately before the RPC. On entry, if
   `sessionId === this._lastAbortedSessionId()`, the method skips the RPC and
   calls `idleAbortedTabLocally(abortedTabId, sessionId)` directly. The signal
   is cleared whenever `currentSessionId()` changes to a different id.

   This is the actual root cause on the frontend — stale session state driving a
   repeat abort — and it clears the spinner on the second press with no wire
   field.

**C5a-later (batch B12, blocked).** When TASK_2026_362 lands on `main`:

- `ChatAbortResult` gains `alreadyEnded?: true`.
- `IAgentAdapter.interruptSession` returns `Promise<{ alreadyEnded: boolean }>`.
- `ChatSessionService.abortSession` returns
  `{ success: true, alreadyEnded: true }` when the adapter reports it.
- `ConversationService` treats `result.data.alreadyEnded` exactly like the
  existing failure branch: call `idleAbortedTabLocally` and do not wait for a
  `turn_state` that will never come.

The design is complete here, so B12 is a mechanical batch the moment it
unblocks.

### Files (C5a-now)

- **MODIFY** `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts`
- **MODIFY** `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts`
- **MODIFY** `libs/frontend/chat/src/lib/services/chat-store/conversation.service.spec.ts`
- **CREATE or EXTEND** `session-control.service.spec.ts` in the same folder.

### Specs that pin it

- `session-control.service.spec.ts`: `endSession` on an unregistered id resolves
  `'already-ended'`, calls no teardown, and **does not call `logger.warn`**.
- `conversation.service.spec.ts`: pressing abort twice for the same `sessionId`
  issues **exactly one** `chat:abort` RPC, and the second press idles the tab
  locally. Changing `currentSessionId()` between presses issues a second RPC.

---

## 6. C5b — `Interrupt failed for session …: {}`

### Root cause, verified

This is not a call-site defect. It is a `Logger` defect.

- The call site is correct: `session-control.service.ts:227-230` passes
  `err instanceof Error ? err : new Error(String(err))`.
- `Logger.warn(message, ...args)` (`logger.ts:121-123`) forwards to
  `log(level, message, args)` (`:203`).
- `log()` serializes each argument with `JSON.stringify(arg)` when it is a
  non-null object (`logger.ts:207-217`). An `Error`'s `message`, `stack` and
  `name` are **non-enumerable**, so `JSON.stringify(new Error('x'))` is `'{}'`.
  That is the `{}` in the log, exactly.
- `Logger` already has correct error handling. `serializeArgs`
  (`logger.ts:364-386`) branches on `arg instanceof Error` and keeps `message`,
  `stack` and `name`. **It is dead code: it has no caller.** Verified by grep —
  the only occurrence is the definition.

The helper exists, is right, and is not wired. Fixing the call site alone would
leave every other `logger.warn(msg, error)` and `logger.debug(msg, error)` in
the repo printing `{}`.

### Files

- **MODIFY** `libs/backend/vscode-core/src/logging/logger.ts`
- **CREATE** `libs/backend/vscode-core/src/logging/logger.error-args.spec.ts`

### Change

Extract a module-private `formatLogArg(arg: unknown): string` and use it in the
mapper inside `log()`:

```ts
function formatLogArg(arg: unknown): string {
  if (arg instanceof Error) {
    return JSON.stringify({
      name: arg.name,
      message: arg.message,
      stack: arg.stack,
    });
  }
  if (typeof arg === 'object' && arg !== null) {
    try {
      return JSON.stringify(arg);
    } catch {
      return '[Unserializable]';
    }
  }
  return String(arg);
}
```

Then **delete the dead private `serializeArgs`** (`logger.ts:358-386`). Per the
root `CLAUDE.md`, unused code is deleted, not renamed and not re-exported. Its
`Error` branch moves into `formatLogArg`, so no behaviour is lost.

`session-control.service.ts:227-230` needs **no change**. It becomes correct
once the Logger is.

### Failure behaviour

An `Error` with a circular `cause` still serializes, because only three scalar
fields are read. A non-Error object that throws inside `JSON.stringify` still
yields `'[Unserializable]'`, as today.

### Spec that pins it

`logger.error-args.spec.ts`: `logger.warn('boom', new Error('kaput'))` writes a
line containing `kaput`, `Error` and a stack fragment, and **not** the literal
`{}`. A second case asserts a plain object still serializes as before, so the
change is additive.

---

## 7. C5c — `content_block_start` with no active message (LATE batch)

### Verified contract

- `onContentBlockStart` returns `[]` after warning when
  `state.getMessageId(context)` is falsy:
  `stream-event.transformer.ts:281-289`.
- `onMessageStart` is what sets it: `state.setMessageId(context, messageId)` at
  `:142`, with the id fallback chain
  `message?.id || sdkMessage.uuid || 'stream-msg-' + Date.now()` at `:131-132`.
  It also clears the context's tool-call ids (`:148`) and, for the root context
  only, flips the turn phase through `helpers.turnState.markGenerating`
  (`:171-176`).
- `transform()` already holds `sdkMessage` in scope (`:31`), so it can pass it
  down.

### Decision D-5c: synthesize `message_start`. Do not buffer.

Dropping the block is **data loss, not noise**. For a `tool_use` block the early
return skips `state.setToolCallId(context, blockIndex, contentBlock.id)`
(`:317`) and the `ToolStartEvent`. The matching `content_block_delta` and the
later `tool_result` then have no anchor, so the tool call never appears in the
UI. Five WARNs in one log mean five missing blocks.

Buffering is rejected: it needs a `message_start` that may never arrive, plus a
flush trigger and a bound, and it delays every block behind a speculative wait.

Synthesizing is deterministic, needs no new state, and reuses the id fallback
that already exists.

### Files

- **MODIFY** `libs/backend/agent-sdk/src/lib/message-transform/stream-event.transformer.ts`
- **CREATE** `libs/backend/agent-sdk/src/lib/message-transform/stream-event.synthesized-start.spec.ts`

**`assistant-message.transformer.ts` is not touched.** This batch runs last, so
it builds on the committed TASK_2026_366 state
(`a4dcc9d9e fix(agent-sdk,shared): suppress empty assistant message envelopes`).

### Change

`transform()` passes `sdkMessage` into `onContentBlockStart`. At the top of
`onContentBlockStart`:

```ts
let currentMessageId = state.getMessageId(context);
const prelude: FlatStreamEventUnion[] = [];

if (!currentMessageId) {
  helpers.logger.debug('[SdkMessageTransformer] content_block_start arrived before message_start; ' + 'synthesizing one so the block is not dropped', { context: context || 'root', blockType });
  prelude.push(...this.onMessageStart({ type: 'message_start', message: {} }, sdkMessage, context, parentToolUseId, state, helpers, sessionId));
  currentMessageId = state.getMessageId(context);
}
```

Every later `return [x]` in the method becomes `return [...prelude, x]`.

Reusing `onMessageStart` rather than hand-rolling the event is deliberate. It
gives the same id fallback, the same tool-call-id clearing, the same
`MessageStartEvent` shape and the same root-context turn-phase flip. One
definition of "a message starts".

The WARN becomes a DEBUG because the condition is now handled, not tolerated.

### Failure behaviour

A real `message_start` arriving afterwards for the same context opens a second
message with its own id, because `onMessageStart` overwrites `setMessageId`.
That is correct if the SDK genuinely started a new message, and produces one
extra short message envelope if it did not. This is the residual risk in the
risk table. The spec below asserts no duplicate `tool_start` and exactly one
open message at `message_stop`.

### Spec that pins it

`stream-event.synthesized-start.spec.ts`:

- `content_block_start` with `content_block: { type: 'tool_use', id, name }` and
  no prior `message_start` emits `[message_start, tool_start]`, not `[]`, and
  `state.getMessageId(ctx)` is set afterwards.
- The same holds for a `text` block and a `thinking` block.
- `logger.warn` is **not** called. `logger.debug` is.
- Synthesize, then deliver a real `message_start`, then `message_stop`: exactly
  one `message_complete` is emitted and `tool_start` fires once.
- The normal order — `message_start` then `content_block_start` — emits no
  synthesized prelude. This is the no-regression assertion.

---

## 8. C6a — coalesce concurrent preflight, credit any recent pass

### Verified contract

- `ensure()` resolves the root, checks `throttled(workspaceRoot)`, then stamps
  `this.lastPassAt.set(workspaceRoot, Date.now())` **before** the pass:
  `harness-preflight.service.ts:124-137`.
- `throttled()` compares against `minIntervalMs`, default
  `DEFAULT_PREFLIGHT_MIN_INTERVAL_MS = 60_000` (`:84`, `:266-269`).
- The budget is a real cancellation: `runBounded` races the reconcile against a
  `setTimeout` and calls `controller.abort()` (`:215-264`).
  `DEFAULT_PREFLIGHT_TIMEOUT_MS = 1500` (`:76`).
- A **timed-out** pass stamps `lastPassAt` exactly like a successful one, so the
  workspace is throttled for 60 s on the strength of a pass that did no work.
- `HarnessReconcilerService` already publishes every completed pass:
  `this.emitter.emit('health', health)` (`:441`) and a public subscribe that
  returns an unsubscribe (`:155-156`). `HarnessHealth` carries `workspaceRoot`
  and `mode` (`:432-440`).

### Files

- **MODIFY** `libs/backend/harness-sync/src/lib/preflight/harness-preflight.service.ts`
- **CREATE** `libs/backend/harness-sync/src/lib/preflight/harness-preflight.coalesce.spec.ts`

No budget change. `DEFAULT_PREFLIGHT_TIMEOUT_MS` stays 1500.

### Change 1 — one in-flight promise per workspace root

```ts
private readonly inFlight = new Map<string, Promise<HarnessHealth | null>>();
```

After the throttle check and the stamp, `ensure()` checks `inFlight`. A hit
returns the existing promise. A miss stores the new one and deletes it in a
`finally`. Two callers then share one `AbortController`, one budget timer and
one hash walk, instead of racing two passes over the same directories.

`options.force === true` bypasses the **throttle**, not the coalescer. Forcing
must not be able to start a second concurrent pass on the same root.

### Change 2 — credit any completed pass

In the constructor:

```ts
this.unsubscribeHealth = reconciler.onHealth((health) => {
  this.lastPassAt.set(health.workspaceRoot, Date.now());
});
```

Any pass the reconciler completes — preflight, full, or a
`HarnessPropagationService.propagate` — now counts toward the throttle. A
session starting seconds after a full pass skips its own preflight instead of
paying a 1500 ms budget to re-derive the same answer.

Add a `dispose()` that calls the unsubscribe, so a disposed service does not
keep a listener on a longer-lived reconciler.

### What this deliberately does not change

The `lastPassAt` stamp for a **timed-out** pass stays. Removing it would make a
workspace whose harness cannot be hashed in 1500 ms retry at every session start
forever, which is the exact cost the throttle exists to bound. The timeout log
stays at `info` (`:146-152`): it is an honest report of a bounded operation that
ran out of budget, not an error.

### Failure behaviour

If the reconcile rejects, the shared promise would reject for every joined
caller. It cannot: `runBounded` already swallows every rejection into `null`
(`:225-241`). The `finally` delete still runs.

### Specs that pin it

`harness-preflight.coalesce.spec.ts`:

- Two `ensure()` calls for the same root, the second issued while the first is
  pending, invoke `reconciler.reconcile` **once**, and both resolve to the same
  value.
- Two calls for **different** roots invoke it twice.
- `ensure({ force: true })` while a pass is in flight for the same root joins it
  rather than starting a second.
- Emitting a `health` event for a root makes the next `ensure()` for that root
  return `null` without calling `reconcile`.
- After the in-flight promise settles, a `force: true` call starts a new pass.
  The map is cleaned up.

---

## 9. C6b — remove `PulseMcpRegistrySource`

### Verified contract

- `McpRegistryProvider implements IMcpRegistrySource`
  (`mcp-registry.provider.ts:117`). **It is the official-registry source, not an
  aggregator.** It has no fan-out to remove. The research note asking to "verify
  the aggregate fan-out in `mcp-registry.provider.ts`" is answered: there is
  none.
- The real aggregate fan-out is `harness-namespace.builder.ts:741-760`:
  `Promise.all([official, smithery, pulse])`, merged round-robin at `:748` and
  reported at `:760`.
- The source registry is `McpRegistrySourceRegistry`
  (`mcp-registry-source.registry.ts`), a plain `Map<McpRegistrySourceId, …>`.
  Removing a registration removes the source with no other coupling.
- `McpRegistrySourceId` union: `mcp-registry-source.interface.ts:19`.
  `McpRegistrySourceKind` union: `mcp-directory.types.ts:195`. Both list
  `'pulsemcp'`.
- No frontend file references PulseMCP. Verified by grep across `libs/frontend`
  and `apps`.

### Files

**DELETE:**

- `libs/backend/cli-agent-runtime/src/lib/mcp-directory/pulsemcp-registry.source.ts`
- `libs/backend/cli-agent-runtime/src/lib/mcp-directory/pulsemcp-registry.source.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/mcp-directory/pulsemcp-wire.constants.ts`

**MODIFY:**

- `libs/backend/cli-agent-runtime/src/lib/mcp-directory/index.ts` — remove the exports at `:18-29`.
- `libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-registry-source.interface.ts:19` — the union becomes `'official' | 'smithery'`.
- `libs/shared/src/lib/types/mcp-directory.types.ts:195` — the same narrowing.
- `libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.ts` — drop the import (`:44`), the field (`:124`), the construction and registration (`:178-181`), and the `getPopular` branch (`:491-493`).
- `libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.spec.ts` — drop the PulseMCP cases.
- `libs/backend/rpc-handlers/src/lib/harness/ai/harness-workflow-prompt.service.ts:49` — prompt text.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts:1306-1310` — tool description.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts` — `:254`, `:278`, `:399`, the `Promise.all` at `:741-760`, and the stale comment at `:690`.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts` — `:104`, `:740-742`.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.spec.ts`
- `libs/backend/cli-agent-runtime/CLAUDE.md` — remove PulseMCP from the mcp-directory description. Record that `v0beta` returned `410 Gone` and that `v0.1` is a key-gated business API, so the source was removed rather than repointed.

### Failure behaviour

`searchMcpRegistry` continues on two sources. The degraded-result path is
unchanged: it already reports per-source outcomes, and two sources is a valid
set. Narrowing both string unions is a compile-time change, so a missed consumer
fails the build instead of passing `'pulsemcp'` to an empty map.

### Spec that pins it

`harness-namespace.builder.spec.ts`: `searchMcpRegistry` fans out to exactly two
sources, the merged list is drawn round-robin from both, and the source report
contains exactly `official` and `smithery`.

`mcp-directory-rpc.handlers.spec.ts`: `getPopular` with an unknown `source`
falls back to the official registry and never throws.

---

## 10. C6c — the harness blocked set: NO CHANGE

Stated explicitly so it is not batched, not log-tweaked and not "fixed".

`blocked = missing ∩ foreign` is the documented mechanism from TASK_2026_306.
The backend repair (`HarnessBlockedRepairService` plus the quarantine
convention) is shipped. Only the consent dialog — that task's Batch 9 — is
outstanding. The WARN is already de-duplicated per unchanged set:
`loggedBlockedSets` (`harness-reconciler.service.ts:112`) and `logBlocked`
(`:885`). That is why the log shows `Blocked set unchanged since the last full
pass` rather than a repeating alarm.

`harness-sync/CLAUDE.md` names reclassifying `blocked` out of `missing` as the
documented **wrong** fix: it reintroduces the divergence where `doctor --fix`
reports "in sync" and a following `doctor` reports "23 missing".

**No file in `harness-sync` changes for C6c.**

---

## 11. C7a — off-thread spawn for `cli-agent-runtime`

### Decision D-7a: reuse the existing DI token. No barrel export, no new token.

`libs/backend/agent-sdk/src/index.ts` is a Group B file, so
`OffThreadProcessSpawner` cannot be added to the public barrel. It does not need
to be:

- `SDK_TOKENS.SDK_PROCESS_SPAWNER = Symbol.for('SdkProcessSpawner')` already
  exists (`agent-sdk/src/lib/di/tokens.ts:51`).
- It is already registered as a singleton with
  `{ useClass: OffThreadProcessSpawner }` (`agent-sdk/src/lib/di/register.ts:314-318`).
- `SDK_TOKENS` is already on the public barrel (`agent-sdk/src/index.ts:64`),
  and `cli-agent-runtime` already imports it (`wiring/agent-events.spec.ts:21`).
- Every host calls `registerSdkServices`: `cli-engine/container.ts:642`, and
  both `phase-2-libraries.ts` composition roots. The token therefore resolves in
  the VS Code, Electron and CLI hosts alike.

So `cli-agent-runtime` injects an existing token and needs only a **type**. It
declares its own structural port. This is the `HARNESS_PREFLIGHT_TOKEN` pattern
(`agent-sdk/src/index.ts:243-247`) applied in the other direction. There is no
composition-root edit, no `expected-resolvable.ts` edit and no Group B file.

### C7a splits into two batches by risk

`spawnCli` and the SDK's `spawnClaudeCodeProcess` seam are **not** the same
contract, so one edit cannot fix both.

Verified difference: the SDK's `SpawnedProcess`
(`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:5479-5515`) has `stdin`,
`stdout`, `killed`, `exitCode`, `kill`, and `on`/`once`/`off`. It has **no
`stderr` stream and no `pid`**. All four adapters use both:
`child.stderr?.on('data', …)` (`antigravity:533`, `opencode:483`, `pi:413`,
`copilot:365`) and `killProcessTree(child.pid)`. Further, the worker spawns with
plain `require('node:child_process').spawn`
(`off-thread-process-spawner-source.ts:65`, `:126-131`) and hardcodes
`windowsHide: true` with no `detached`, while `spawnCli`
(`cli-adapter.utils.ts:154-177`) uses `cross-spawn` for Windows `.cmd` wrappers,
sets `detached` on POSIX for tree-kill, and sets `windowsHide: false` when
`needsConsole` is requested for ConPTY.

### 11a — Batch B8: the SDK query seam (medium risk, largest single win)

`PtahCliRegistry`'s `queryFn({ … })` call at `ptah-cli-registry.ts:684-738`
passes no `spawnClaudeCodeProcess`, so it takes the blocking default. This is
the one path that spawns `claude.exe` — 253 MB, 1850 to 1975 ms of synchronous
`CreateProcessW`, per `off-thread-process-spawner.ts:1-20`.

**Files:**

- **CREATE** `libs/backend/cli-agent-runtime/src/lib/spawn/sdk-process-spawner.port.ts`
- **MODIFY** `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts`
- **CREATE** `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-off-thread-spawn.spec.ts`

**Port (structural, type-only):**

```ts
import type { SpawnOptions, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';

export interface ISdkProcessSpawner {
  spawn(options: SpawnOptions, hooks?: { onStderr?: (data: string) => void }): SpawnedProcess;
}
```

It is typed against the SDK's own published types, which both libs already
depend on, so the compiler checks the structural match with
`OffThreadProcessSpawner.spawn` (`off-thread-process-spawner.ts:445-448`) at the
injection site.

**Wiring:** `PtahCliRegistry` gains
`@inject(SDK_TOKENS.SDK_PROCESS_SPAWNER) private readonly processSpawner: ISdkProcessSpawner`
and, inside the `options` object at `:684-738`:

```ts
spawnClaudeCodeProcess: (spawnOptions) =>
  this.processSpawner.spawn(spawnOptions, { onStderr: handleChildStderr }),
```

`handleChildStderr` is the C1 classifier callback that replaced the blanket
`logger.error` at `:728-731`. Handing it down explicitly is mandatory: once a
custom spawner is supplied, the SDK skips its own stderr piping. That is rule 3
of the spawner's file header (`off-thread-process-spawner.ts:31-36`), and the
same reason `SdkQueryRunner.useOffThreadSpawner`
(`sdk-query-runner.service.ts:194-200`) does it.

**Failure behaviour:** unchanged from `SdkQueryRunner`'s path.
`PTAH_SDK_INLINE_SPAWN=1`, or a worker that throws, falls back to inline spawn
(`off-thread-process-spawner.ts:446-465`) — blocking, but working.

**Spec:** `ptah-cli-registry-off-thread-spawn.spec.ts` asserts that the
`Options` object handed to `queryFn` carries a `spawnClaudeCodeProcess`
function, that calling it delegates to the injected spawner, and that the
`onStderr` hook it passes is the classifier callback (a benign line reaches
`logger.debug`).

### 11b — Batch B9: `spawnCli` and `probeCliVersion` (heavy)

Doing this properly means extending the worker protocol. All four gaps must
close together, or the change is a regression on Windows.

**Files:**

- **CREATE** `libs/backend/platform-core/src/interfaces/process-spawner.interface.ts`
- **MODIFY** `libs/backend/platform-core/src/index.ts` (one `export type` line)
- **MODIFY** `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts`
- **MODIFY** `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner-source.ts`
- **MODIFY** `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.spec.ts`
- **MODIFY** `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts`
- **MODIFY** `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.spec.ts`
- **MODIFY** the four adapters and `cli-detection.service.ts`

**The port, in `platform-core` (type-only, no DI token):**

```ts
export interface ProcessSpawnRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** POSIX: make the child a process-group leader so a tree kill can reach it. */
  readonly detached?: boolean;
  /** Windows: give the child its own hidden console. ConPTY needs one. */
  readonly needsConsole?: boolean;
}

export interface SpawnedProcessHandle {
  readonly stdin: NodeJS.WritableStream;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream | null;
  /** Resolves with the child's pid once the spawning thread reports it. */
  readonly whenSpawned: Promise<number | null>;
  readonly pid: number | undefined;
  readonly killed: boolean;
  readonly exitCode: number | null;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: 'exit', l: (code: number | null, s: NodeJS.Signals | null) => void): void;
  on(event: 'error', l: (e: Error) => void): void;
  once(event: 'exit', l: (code: number | null, s: NodeJS.Signals | null) => void): void;
  once(event: 'error', l: (e: Error) => void): void;
  off(event: 'exit', l: (code: number | null, s: NodeJS.Signals | null) => void): void;
  off(event: 'error', l: (e: Error) => void): void;
}

export interface IProcessSpawner {
  spawnProcess(request: ProcessSpawnRequest): SpawnedProcessHandle;
}
```

`platform-core` is tagged `["scope:shared","type:util"]` and declares its own
types, so it gains no dependency on `agent-sdk`. `OffThreadProcessSpawner`
declares `implements IProcessSpawner`, which makes the conformance
compile-checked, and keeps its existing `spawn()` method for the SDK seam
unchanged.

**Windows command resolution stays on the host.** The `cross-spawn` parser is a
pure function: it creates no process, and it is reachable as a deep import.
Verified empirically in this tree:
`require('cross-spawn/lib/parse')('foo.cmd', ['a b'], {})` returns
`command: 'C:\WINDOWS\system32\cmd.exe'`,
`args: ['/d','/s','/c','"foo.cmd ^"a^ b^""']` and
`options.windowsVerbatimArguments: true`. `cross-spawn@7.0.6` publishes
`files: ["lib"]` and no `exports` map, so the subpath resolves. The host parses,
then sends the already-resolved `{ command, args, windowsVerbatimArguments }` to
the worker. The worker keeps using plain `node:child_process.spawn`. Do not add
a `require` from an `eval`-created worker: it would not resolve reliably in a
bundled Electron app.

**Worker protocol additions** (`off-thread-process-spawner-source.ts`), all
additive so the existing SDK path is unaffected: `detached`, `windowsHide` and
`windowsVerbatimArguments` on the spawn message, plus a
`stderrMode: 'stream' | 'callback' | 'ignore'` selector. The `pid` already
travels on the existing `{ type: 'spawned', pid }` message (`:138-141`); the
host now exposes it as both `pid` and `whenSpawned`.

**`spawnCli` signature:**

```ts
export function spawnCli(
  binary: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    needsConsole?: boolean;
    detached?: boolean;
    spawner?: IProcessSpawner;
  },
): SpawnedProcessHandle;
```

With no `spawner` it behaves exactly as today — `crossSpawn` inline, wrapped in
a handle adapter. `CliDetectionService`, which is `@injectable()` and constructs
all six adapters in its constructor (`cli-detection.service.ts:24-49`), injects
`SDK_TOKENS.SDK_PROCESS_SPAWNER` and passes it to each adapter's constructor.
`probeCliVersion` takes the same optional parameter.

**`killProcessTree` and the pid.** Today `child.pid` is available synchronously.
Off-thread it is not. Every tree-kill path must `await handle.whenSpawned`
before calling `killProcessTree`. `WorkerBackedProcess` already queues a kill
that arrives before the pid lands (`off-thread-process-spawner.ts:24-30`), so
`kill()` itself stays safe. Only the **tree** kill needs the pid, and that is
the one call site to change.

**Failure behaviour:** any worker failure falls back to inline spawn, which is
today's behaviour exactly. `PTAH_SDK_INLINE_SPAWN=1` disables the whole
mechanism for a worker-hostile host without a rebuild.

**Specs:**

- `off-thread-process-spawner.spec.ts` gains: a `.cmd` target on Windows
  round-trips through the parsed command; `stderr` arrives as a stream when
  `stderrMode: 'stream'`; `whenSpawned` resolves with a pid; `detached` is
  forwarded.
- `cli-adapter.utils.spec.ts` gains: `spawnCli` with no `spawner` uses
  `crossSpawn` (the no-regression assertion); with a fake spawner it delegates
  and forwards `detached` and `needsConsole`; `probeCliVersion` returns the
  first stdout line through a fake spawner, and `undefined` on timeout.

**B9 is the descope candidate.** If time runs short, ship B8 alone: it addresses
the 253 MB binary, which is the dominant cost the mechanism was built for.

---

## 12. C7b — `pendingTaskIds` buffer

### Verified contract

- `setTaskId` is a silent no-op when the record is absent:
  `subagent-registry.service.ts:411-421` — `store.getRaw(toolCallId)` returns
  `undefined`, it logs at debug, then returns.
- `register()` already consumes a pending value in exactly this shape:
  `subagent-registry.service.ts:97-100` —
  `registration.teammateName ?? this.store.consumePendingTeammateName(registration.toolCallId)`,
  merged onto the record at `:110`.
- The store's precedent: the `pendingTeammateNames` map
  (`subagent-state-store.ts:71`), `markPendingTeammateName` (`:227-229`),
  `consumePendingTeammateName` (`:235-241`), `peekPendingTeammateName`
  (`:247-249`), cleared in `clear()` (`:139`).
- The ordering is by construction: `system-message.transformer.ts:223-225` says
  the `SubagentStart` hook "tends to fire after `task_started`".
- **Observation worth recording:** `pendingTeammateNames` has no TTL sweep.
  `cleanupExpired` (`subagent-state-store.ts:302-338`) sweeps `registry` and
  `clearedToolCallIds` only, so an unconsumed teammate name lives until
  `clear()`. `pendingTaskIds` is therefore built **with** a TTL sweep rather
  than copying that gap. Fixing the teammate map is out of scope for this task.
  It is noted here so it is not lost.

### Files

- **MODIFY** `libs/backend/vscode-core/src/services/subagent-registry/subagent-state-store.ts`
- **MODIFY** `libs/backend/vscode-core/src/services/subagent-registry.service.ts`
- **CREATE** `libs/backend/vscode-core/src/services/subagent-registry/subagent-state-store.pending-task-id.spec.ts`

### Change

Store:

```ts
private readonly pendingTaskIds = new Map<string, { taskId: string; at: number }>();

markPendingTaskId(toolCallId: string, taskId: string): void;
consumePendingTaskId(toolCallId: string): string | undefined;   // single-consume
```

`clear()` clears it (`:133-141`). `cleanupExpired()` (`:302`) evicts entries
older than the existing `TTL_MS`, reusing the same constant and the same
`lazyCleanup()` cadence, so there is one expiry policy.

Service:

- The miss branch of `setTaskId` calls
  `this.store.markPendingTaskId(toolCallId, taskId)` before returning, and its
  log stays at `debug` with a `buffered: true` field.
- `register()` merges it alongside the teammate name:
  `const taskId = registration.taskId ?? this.store.consumePendingTaskId(registration.toolCallId);`
  then `...(taskId ? { taskId } : {})` in the record literal at `:104-113`.

### Failure behaviour

A `task_started` whose `SubagentStart` never fires leaves one buffered entry,
evicted by the TTL sweep. A `taskId` present on the registration wins over the
buffer: history replay must not be overwritten by a stale stream value.
Single-consume prevents a re-registration under the same `toolCallId` from
picking up a taskId that belonged to the previous run.

### Spec that pins it

`subagent-state-store.pending-task-id.spec.ts`:

- `setTaskId` before `register` results in a registered record that carries the
  `taskId`, and `logger.debug` reports that it was buffered.
- The buffer is consumed once: a second `register` with the same `toolCallId`
  gets no `taskId`.
- `registration.taskId` wins over a buffered value.
- An entry older than `TTL_MS` is gone after `lazyCleanup()`.
- The normal order — `register` then `setTaskId` — writes the record directly
  and buffers nothing. This is the no-regression assertion.

---

## 13. C7c — the mojibake sweep

### Corpus, measured in this working tree

The prescribed `git grep -l` for the double-encoded prefix over
`libs/**/*.ts` and `apps/**/*.ts` returns **68 files**. A byte-level census
found a **second corruption family that the prefix filter misses**: the
double-encoded right arrow, in 34 files, **3 of which contain no instance of the
prescribed prefix at all**. Including it, the corpus is:

| Family             | Mojibake codepoints    | Intended | Occurrences (repo-wide, `.ts`) |
| ------------------ | ---------------------- | -------- | ------------------------------ |
| em dash            | `U+00E2 U+20AC U+201D` | `U+2014` | 339                            |
| right arrow        | `U+00E2 U+2020 U+2019` | `U+2192` | 122                            |
| ellipsis           | `U+00E2 U+20AC U+00A6` | `U+2026` | 7                              |
| en dash            | `U+00E2 U+20AC U+201C` | `U+2013` | 7                              |
| right single quote | `U+00E2 U+20AC U+2122` | `U+2019` | 1                              |
| left single quote  | `U+00E2 U+20AC U+02DC` | `U+2018` | 1                              |
| left double quote  | `U+00E2 U+20AC U+0153` | `U+201C` | 1                              |
| right double quote | `U+00E2 U+20AC U+009D` | `U+201D` | 1                              |
| bullet             | `U+00E2 U+20AC U+00A2` | `U+2022` | 1                              |
| minus sign         | `U+00E2 U+02C6 U+2019` | `U+2212` | 1                              |

Every sequence is the UTF-8 encoding of the intended character read as CP1252
and re-encoded. The map is the same one `console-text.ts:41-54`
(`MOJIBAKE_REPAIRS`) already uses at the console mirror, minus its `e`-acute and
non-breaking-space entries (see 0.2 item 5).

### File set

**68 files to repair.** The exact list is written to
`.ptah/specs/TASK_2026_367/mojibake-file-list.txt`, one path per line. The
executor **re-derives** it at run time rather than trusting the snapshot.

**3 files excluded, and why:**

| Excluded file                                                       | Occurrences | Reason                                                      |
| ------------------------------------------------------------------- | ----------- | ----------------------------------------------------------- |
| `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`            | 2           | Group B (TASK_2026_362)                                     |
| `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts` | 4           | Group B (TASK_2026_362)                                     |
| `libs/backend/vscode-core/src/logging/console-text.ts`              | 13          | Holds the corrupt bytes on purpose. It is the repair table. |

`libs/backend/vscode-core/src/logging/console-text.spec.ts` is also on the
never-touch list. It carries no matching bytes today, so it needs no exclusion,
but list it anyway so a later edit cannot be swept.

### Method — mechanical, reviewed as a diff

1. Write a **throwaway** script at the repo root, `tmp-mojibake-repair.cjs`,
   holding the ten pairs above as explicit `String.fromCharCode(...)` sequences.
   Never write them as literal pasted characters: the editor that produced the
   corruption would reproduce it.
2. The script derives its file list at run time:
   - enumerate `git ls-files -- libs apps` and keep `.ts` files;
   - drop everything in `git diff --name-only main...feat/native-agent-loop-pi-ai`;
   - drop `console-text.ts` and `console-text.spec.ts`;
   - keep files that contain at least one sequence.
3. Read each file as UTF-8, apply the ten replacements longest-first (all are
   three characters, so order is not load-bearing, but keep the rule), and write
   back as UTF-8 **with no BOM and with the file's existing line endings
   preserved**.
4. Print a per-file replacement count and the total. Expected total across the
   68 files: **461** — 481 repo-wide, minus 2, 4 and 13 in the excluded three.
5. **Review the whole diff before staging.** Every hunk must be a punctuation
   change inside a string literal or a comment. A hunk that touches an
   identifier, an import path or a regular expression is a bug in the script,
   not a repair.
6. **Delete `tmp-mojibake-repair.cjs`.** It does not ship.

The sweep changes **string literals and comments only**. It creates no file,
deletes no file and touches no logic.

### Verification

Run the prescribed count over `libs/**/*.ts` and `apps/**/*.ts`. It must report
exactly the excluded set and nothing else:

```
apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:2
libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:4
libs/backend/vscode-core/src/logging/console-text.ts:13
```

Add a second check for the arrow family that the prefix grep cannot see: re-run
the script in a `--dry-run` mode and assert it reports 0 remaining outside the
excluded set.

Then run
`npx nx run-many -t lint -p @ptah-extension/vscode-core @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime`
and a full `npm run typecheck:all`, because the sweep spans many projects.

---

## 14. Batch handoff

The batches are file-disjoint. Every batch names its own files, and no two
batches in the same wave share a file.

| Batch   | Item                                                           | Complexity     | Depends on                                     | Projects (`project.json` names)                                                                                                  |
| ------- | -------------------------------------------------------------- | -------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **B1**  | C1 stderr classifier plus C2 spawn log line                    | **medium**     | —                                              | `@ptah-extension/cli-agent-runtime`                                                                                              |
| **B2**  | C6a preflight coalesce plus external-pass credit               | **medium**     | —                                              | `@ptah-extension/harness-sync`                                                                                                   |
| **B3**  | C6b PulseMCP removal                                           | **mechanical** | —                                              | `@ptah-extension/cli-agent-runtime`, `@ptah-extension/rpc-handlers`, `@ptah-extension/vscode-lm-tools`, `@ptah-extension/shared` |
| **B4**  | C4 chunked map and reduce curation                             | **heavy**      | —                                              | `@ptah-extension/memory-curator`                                                                                                 |
| **B5**  | C7b `pendingTaskIds` buffer                                    | **mechanical** | —                                              | `@ptah-extension/vscode-core`                                                                                                    |
| **B6**  | C5b Logger error serialization plus C5a-now                    | **medium**     | —                                              | `@ptah-extension/vscode-core`, `@ptah-extension/agent-sdk`, `@ptah-extension/chat`                                               |
| **B7**  | C3 OAuth typed reason plus discovery probe                     | **heavy**      | B3                                             | `@ptah-extension/cli-agent-runtime`, `@ptah-extension/rpc-handlers`, `@ptah-extension/shared`, `@ptah-extension/marketplace`     |
| **B8**  | C7a-1 `PtahCliRegistry` off-thread SDK spawn                   | **medium**     | B1                                             | `@ptah-extension/cli-agent-runtime`                                                                                              |
| **B9**  | C7a-2 off-thread `spawnCli` and `probeCliVersion`              | **heavy**      | B1, B8                                         | `@ptah-extension/platform-core`, `@ptah-extension/agent-sdk`, `@ptah-extension/cli-agent-runtime`                                |
| **B10** | C5c synthesized `message_start` (**LATE**)                     | **medium**     | scheduled late                                 | `@ptah-extension/agent-sdk`                                                                                                      |
| **B11** | C7c mojibake sweep (**LAST, own batch, touches nothing else**) | **mechanical** | every other batch                              | many — verify with `npm run typecheck:all`                                                                                       |
| **B12** | C5a-later `alreadyEnded` wire field                            | **medium**     | **BLOCKED** on TASK_2026_362 merging to `main` | `@ptah-extension/shared`, `@ptah-extension/rpc-handlers`, `@ptah-extension/agent-sdk`, `@ptah-extension/chat`                    |

### Waves

- **Wave 1 (parallel, six executors):** B1, B2, B3, B4, B5, B6. Verified
  disjoint. B1 and B3 are both in `cli-agent-runtime` but share no file: B1 owns
  the four adapters, `ptah-cli-registry.ts` and the new classifier, while B3
  owns `mcp-directory/**`. B5 and B6 are both in `vscode-core` but share no
  file: B5 owns `services/subagent-registry*`, and B6 owns `logging/logger.ts`.
- **Wave 2 (parallel):** B7, which needs B3's edits to `mcp-directory/index.ts`
  and `mcp-directory.types.ts` landed first, and B8, which needs B1's classifier
  callback in `ptah-cli-registry.ts`.
- **Wave 3:** B9, after B8 — both touch `ptah-cli-registry.ts` and the adapters.
  B10 runs in parallel: it is disjoint, and it is kept late by decision.
- **Wave 4:** B11 alone.
- **Deferred:** B12.

### Why B10 is late

The user's decision in `context.md`: the transformer fix builds on the committed
TASK_2026_366 state and must not run while related transformer work is in
flight. It touches `stream-event.transformer.ts` only, and never
`assistant-message.transformer.ts`.

### Why B11 is last and alone

Three of its 68 files are also owned by other batches:
`session-control.service.ts` (B6), `ptah-cli-registry.ts` (B1, B8, B9) and
`logger.ts` (B6). Running the sweep last, and deriving the file list at run
time, makes the overlap a non-issue.

---

## 15. Test and lint commands per batch

Never `nx test a b c`. Always `run-many`. Read the
`Running target test for N projects` header and confirm `N`.

```bash
# B1
npx nx run-many -t test -p @ptah-extension/cli-agent-runtime
npx nx run-many -t lint -p @ptah-extension/cli-agent-runtime

# B2
npx nx run-many -t test -p @ptah-extension/harness-sync
npx nx run-many -t lint -p @ptah-extension/harness-sync

# B3
npx nx run-many -t test -p @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers @ptah-extension/vscode-lm-tools @ptah-extension/shared
npx nx run-many -t lint -p @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers @ptah-extension/vscode-lm-tools @ptah-extension/shared

# B4
npx nx run-many -t test -p @ptah-extension/memory-curator
npx nx run-many -t lint -p @ptah-extension/memory-curator

# B5
npx nx run-many -t test -p @ptah-extension/vscode-core
npx nx run-many -t lint -p @ptah-extension/vscode-core

# B6
npx nx run-many -t test -p @ptah-extension/vscode-core @ptah-extension/agent-sdk @ptah-extension/chat
npx nx run-many -t lint -p @ptah-extension/vscode-core @ptah-extension/agent-sdk @ptah-extension/chat

# B7
npx nx run-many -t test -p @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/marketplace
npx nx run-many -t lint -p @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/marketplace

# B8
npx nx run-many -t test -p @ptah-extension/cli-agent-runtime
npx nx run-many -t lint -p @ptah-extension/cli-agent-runtime

# B9
npx nx run-many -t test -p @ptah-extension/platform-core @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime
npx nx run-many -t lint -p @ptah-extension/platform-core @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime

# B10
npx nx run-many -t test -p @ptah-extension/agent-sdk
npx nx run-many -t lint -p @ptah-extension/agent-sdk

# B11 — spans many projects, so run the whole gate
npm run typecheck:all
npx nx run-many -t lint -p @ptah-extension/vscode-core @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers
npm run test

# Final gate, before the task closes
npm run lint:all
npm run typecheck:all
npm run test
```

---

## 16. Risk table

| #   | Risk                                                                                                    | Likelihood  | Impact   | Batch  | Mitigation                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------- | ----------- | -------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | B9's off-thread `spawnCli` breaks Windows `.cmd` wrapper resolution, so every rival CLI stops detecting | Medium      | **High** | B9     | `cross-spawn/lib/parse` runs on the host, and the already-resolved command goes to the worker. Verified working in this tree. Pinned by a spec. Inline fallback through `PTAH_SDK_INLINE_SPAWN=1`.                                                         |
| R2  | B9 breaks `killProcessTree` because `pid` is no longer available synchronously                          | Medium      | High     | B9     | `whenSpawned: Promise<number \| null>` on the handle. Every tree-kill site awaits it. `kill()` itself already queues a pre-pid kill (`off-thread-process-spawner.ts:24-30`).                                                                               |
| R3  | B9 breaks ConPTY shell execution by forcing `windowsHide: true`                                         | Medium      | High     | B9     | `needsConsole` travels on the new spawn request and maps to `windowsHide: false`. Asserted by a spec.                                                                                                                                                      |
| R4  | B10's synthesized `message_start` produces a duplicate short message when a real one follows            | Medium      | Medium   | B10    | Reusing `onMessageStart` keeps one definition of "a message starts". A spec asserts one `message_complete` and one `tool_start` on the synthesize-then-real order. If the UI regresses, revert to a debug log and `return []`, which is today's behaviour. |
| R5  | B4 multiplies curator spend on large sessions                                                           | High        | Medium   | B4     | Hard cap of 8 windows, so at most 9 LLM calls per firing. Tool-noise compression runs first. The common case stays at exactly 2 calls, pinned by a spec.                                                                                                   |
| R6  | B4 changes `doCurate` control flow, and a partial extraction is persisted as complete                   | Low         | High     | B4     | A window failure abandons the whole run through the existing `recordCuratorError` path. Never persist a partial extraction. Pinned by a spec.                                                                                                              |
| R7  | B6's Logger change alters the format every log consumer reads                                           | Medium      | Low      | B6     | Only the `Error` branch changes. Non-Error arguments serialize exactly as before, pinned by a spec. `console-text.ts` is untouched.                                                                                                                        |
| R8  | B3 narrows two string unions, and a missed consumer fails to build                                      | Low         | Low      | B3     | That is the intended behaviour: a compile error beats a silent lookup miss. Run `npm run typecheck:all` before the batch closes.                                                                                                                           |
| R9  | B7's debounced probe fires one request per keystroke, or leaks past destroy                             | Medium      | Low      | B7     | A 400 ms debounce guarded by the existing `destroyed` flag. The result is discarded if the URL changed while in flight. A spec asserts exactly one call.                                                                                                   |
| R10 | B11 corrupts a non-string occurrence — an identifier, an import path, a regular expression              | Low         | High     | B11    | Explicit `String.fromCharCode` byte map, no literal pasted characters. Per-file counts printed. **The whole diff is reviewed.** Then `npm run typecheck:all` and `npm run test`.                                                                           |
| R11 | B11 rewrites line endings or adds a BOM across 68 files                                                 | Medium      | Medium   | B11    | Read and write as UTF-8 with no BOM, preserving existing line endings. `git diff --stat` must show only the expected hunk counts.                                                                                                                          |
| R12 | C5a is not fully fixed on this branch, because the wire field is blocked                                | **Certain** | Medium   | B12    | The frontend stale-session guard closes the observed loop now. B12 is fully designed and mechanical once TASK_2026_362 merges.                                                                                                                             |
| R13 | The 2166 to 2923 ms lag is on the codex path, which C7a does not touch                                  | **Certain** | Medium   | B8, B9 | Stated in 0.2 item 3. C7a addresses the `claude.exe` and rival-CLI paths (300 to 900 ms observed), not codex. Do not report C7a as closing the codex lag.                                                                                                  |
| R14 | A batch touches a Group A or Group B file                                                               | Low         | **High** | all    | Section 0.1 lists both sets. Every executor runs `git status --short` before and after, and confirms the four Group A files are untouched. No `git add -A`, no `git stash`, no commit by an executor.                                                      |
| R15 | B8's `SDK_PROCESS_SPAWNER` token does not resolve in one of the three hosts                             | Low         | Medium   | B8     | Verified: all three call `registerSdkServices` (`cli-engine/container.ts:642` and both `phase-2-libraries.ts`), which registers the token at `agent-sdk/src/lib/di/register.ts:314-318`.                                                                   |

---

## 17. Coverage check against the request

| Item                                                                   | Batch                       | Status                                                                     |
| ---------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------- |
| C1 shared stderr classifier, five sites, warn and debug map            | B1                          | Designed                                                                   |
| C2 reuse `tier` and `model`, delete the recomputation                  | B1                          | Designed                                                                   |
| C3 `OAuthDiscoveryError`, typed `reason`, UI hint, debounced probe     | B7                          | Designed                                                                   |
| C4 chunked map and reduce, fork-or-promote decided, budget stated      | B4                          | Designed (D-4)                                                             |
| C5a distinguishable already-ended result, frontend stops re-issuing    | B6 (now) plus B12 (blocked) | Designed. Half is blocked by Group B (D-5a).                               |
| C5b serialize `name`, `message` and `stack`, reuse the existing helper | B6                          | Designed. The root cause is the Logger, not the call site.                 |
| C5c behaviour when a content block arrives first                       | B10                         | Designed (D-5c: synthesize)                                                |
| C6a coalesce plus credit any recent pass, no budget raise              | B2                          | Designed                                                                   |
| C6b remove `PulseMcpRegistrySource` plus docs                          | B3                          | Designed                                                                   |
| C6c blocked-set WARN                                                   | —                           | **NO CHANGE**, stated in section 10                                        |
| C7a off-thread spawn, export-or-port decided, codex out of scope       | B8 plus B9                  | Designed (D-7a). The `resolvePluginPaths` dedupe is dropped with evidence. |
| C7b `pendingTaskIds` mirroring `pendingTeammateNames`                  | B5                          | Designed, with a TTL sweep the precedent lacks                             |
| C7c mojibake sweep, mechanical method plus verification                | B11                         | Designed. A second corruption family was found and included.               |
