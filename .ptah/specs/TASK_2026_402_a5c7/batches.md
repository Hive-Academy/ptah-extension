# Batches - TASK_2026_402_a5c7

Total tasks: 24 | Batches: 8 | Complete: 2/8

**Worktree (ALL work happens here, never in the repo root):**
`D:\projects\ptah-extension\.claude-worktrees\agent-messaging`
Branch `feat/agent-two-way-messaging`, based on `origin/main` 2327e9db0.

**Universal executor rules (repeat in every batch prompt):**

- Work ONLY inside the worktree path above. Absolute Windows paths for every Read/Write.
- **Do not commit. Do not `git stash`. Do not `git checkout`. Do not run `npx nx reset`.**
  Another executor may share this worktree; `nx reset` kills their daemon mid-run. No
  `project.json` is edited by this plan, so no reset is needed.
- Do not edit `batches.md` — the team-leader owns task state.
- Tests are `npx nx run-many -t test -p <project.json name>` — NEVER `nx test A B`. Read the
  `Running target test for N projects` header and confirm N is the number you asked for.
- Project names: `@ptah-extension/agent-sdk`, `@ptah-extension/cli-agent-runtime`,
  `@ptah-extension/vscode-lm-tools`, `@ptah-extension/shared`, `@ptah-extension/rpc-handlers`,
  `@ptah-extension/chat-streaming`, `@ptah-extension/chat`, `ptah-cli` (verified in each
  `project.json`).
- Only touch the files your batch owns. If a change appears to need a file another batch owns,
  stop and report it instead of widening.

---

## Plan validation

Status: **PASSED WITH RISKS**

Every line reference the plan depends on was re-read on disk in this worktree before batching.

| Plan claim | On-disk check | Result |
| --- | --- | --- |
| `buildFlagSettings` at `sdk-query-options-builder.ts:358`; chat consumes at `:795` | present at `:358`, `:795` | OK |
| `extraArgs` conditional spread at `sdk-query-options-builder.ts:890-892` | `'replay-user-messages': null` at `:891` | OK |
| `ptah-cli-registry.ts:730` second `buildFlagSettings` site | `settings: buildFlagSettings({ outputStyleName: … })` present in the `queryFn` options block | OK |
| `cli-adapter.interface.ts:105` `supportsSteer(): boolean` | exact | OK |
| `agent-process-manager.service.ts` `steer()` ~`:983` with checks at `:985/:989/:998/:1005` | `steer(agentId, instruction): void` with the three throws and `if (!adapter?.supportsSteer())` at `:1005` | OK |
| `continueConversation()` at `:1033`, `AgentContinueError` codes | exact | OK |
| `http-server.handler.ts` `extractCallerSessionId` `:245-249`, closed grammar with terminal `/workspace` | exact, and the header comment states the terminal rule | OK |
| `sdk-message-transformer.ts:206` unconditional replay drop | exact, with the comment explaining why the drop exists | OK |
| `agent-namespace.builder.ts:264` synthesised `supportsSteer: false` for Ptah CLI rows | exact | OK |
| `agent-rpc.handlers.ts:840` `supportsSteer: false` | exact | OK |
| `builtin-presets.ts` allow-list contains `ptah_agent_steer` | exact (line 40-41 region) | OK |
| Cursor `activeRun` at `:277/:284/:342`, `supportsContinuation` `:386`, `continue` `:387` | exact | OK |

Two corrections to the plan's own bookkeeping, both handled below as R-3 and R-4.

### Assumptions

- **A0** — the SDK forwards a string `Options.settings` verbatim. **HOLDS statically; the live
  spawn-log grep is still owed.** Batch 1 read `node_modules\@anthropic-ai\claude-agent-sdk\sdk.mjs`
  at the exact code path: `settings` is merged into the SAME map as `extraArgs` and emitted as
  `--settings <value>` untouched (the merge helper only alters the map for a `sandbox` option,
  which is not set here), and the SDK's own `{`-to-`}` check classifies the emitted string as
  inline JSON rather than a file path. Two consequences recorded: `options.settings` OVERWRITES
  any `extraArgs.settings` key — never set both — and an `extraArgs` value of `null` becomes a
  bare flag while a string becomes `--key value`, which is what `--replay-user-messages` and
  `--name` rely on. The byte-for-byte no-regression contract is pinned by a unit test, not a log
  line. The runtime `Spawning Claude Code:` grep could not run headless; it moves to Batch 8
  (Task 8.1) as an acceptance item. No fallback settings file was built.
- **A1** — the CLI preserves a caller-supplied `origin` on the replayed user message.
  **STILL OPEN — Component 7's `SessionInboundCallbackRegistry` contingency remains live and
  Batch 4 Task 4.4 must decide it.** Batch 1 could not resolve it (it needs two live sessions and
  a real `SendMessage`) and offered no fabricated evidence. What it left instead is the decision
  procedure: `[SdkMessageTransformer] Rendering inbound peer message` at `debug` with
  `{ label, isReplay }`, and the replay-drop log now carries `{ originKind }`. If the injected
  turn logs `originKind: undefined`, A1 is false and the contingency is the answer. Observed in
  the existing fixtures, a replayed turn carries `isReplay: true`, `uuid`, `session_id`,
  `parent_tool_use_id: null` and NO `origin` key — which is the shape the "replay with no origin
  still returns `[]`" test pins, and is consistent with either outcome. Either way only the
  producer moves: the tool contract, the shared type and the frontend are unaffected.
- **A2** — left conditional, untestable headless for the same reason as A1. It is now a one-line
  change inside `buildExtraArgs`, which is the seam Task 1.1 asked to be left behind.
- **A2 (original wording)** — a peer turn arrives as a replay regardless of
  `--replay-user-messages`. Unverified; resolution recorded above and carried to Batch 8.
- **A3** — antigravity and opencode handles still carry no `continue`. **CONFIRMED by Batch 2,
  re-read on disk in this worktree.** Both handles return exactly
  `{ abort, done, onOutput, onSegment, getSessionId, getPid }`; neither carries `continue` nor
  `supportsContinuation`. Those two names appear only in `pi-cli.adapter.ts:505-506`,
  `codex-cli.adapter.ts:737-738`, `copilot-sdk.adapter.ts:453-454` and
  `cursor-cli.adapter.ts:386-387`. Both therefore declare
  `{ steer: false, interrupt: false, continuation: false }` → `messagingMode: 'none'`, exactly as
  the plan predicted. Nothing downstream needs to change.
- **A4** — an SDK host does not observe hold/refuse/expiry notices for messages it sent.
  Out of scope; nothing in any batch depends on it.

### Risks

| # | Risk | Severity | Mitigation |
| --- | --- | --- | --- |
| R-1 | Batch 2 replaces `CliDetectionResult.supportsSteer` with `messagingMode`, but three consumers live in files owned by later batches (`agent-process-manager.service.ts:1005`, `agent-namespace.builder.ts:264`, `agent-rpc.handlers.ts:840`). Left alone, Batch 2 lands a repo that does not typecheck. | HIGH | Batch 2 **owns the minimal compile-fix edit at exactly those three call sites** and nothing else in those files. Batches 3/4/5 then take over each file in turn. Safe because Batch 2's only concurrent peer is Batch 1, which touches none of them. Stated on Task 2.3. **Outcome: the R-1 list was INCOMPLETE by four.** `cli-detection.service.ts:125`, `mcp-response-formatter.ts:499`, `system-namespace.builders.ts:307` and `tribunal-panel\...\tribunal-discovery.service.spec.ts:18` also read the deleted field. Batch 2 gave each the same one-line mechanical treatment and reported it rather than widening silently; none is a Batch 1 file, so no collision. `tribunal-panel` sits outside the four verification projects and was verified separately (16 suites, 333 tests green). |
| R-2 | Batches 1 and 2 both edit `libs/shared` and both run `nx run-many -t test -p @ptah-extension/shared` concurrently in one worktree. | MEDIUM | Files are disjoint (`execution/stream.ts` + `ai-provider.types.ts` vs `agent-process.types.ts`) and named per batch so neither widens. No `nx reset`, no `--skip-nx-cache`. If a shared-project test run collides, re-run it — do not reset. Stated on Tasks 1.3 and 2.1. |
| R-3 | The plan's Component 11 file list is **incomplete**: `libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-system-prompt.constant.ts` and `...\mcp-stdio\stdio-mcp-server.service.spec.ts` also contain `ptah_agent_steer` and are named nowhere in the plan. A retired tool name surviving in the system prompt is the exact failure Component 11 exists to prevent. | HIGH | The prompt constant is added to Batch 7 (Task 7.2); the stdio spec is added to Batch 5 (Task 5.4). Batch 7's verification is a repo-wide grep that must return zero live references. |
| R-4 | The plan says "locate all three `PtahAPIBuilder` construction sites (VS Code, Electron, CLI)". On disk there is **one** `buildAgentNamespace(...)` call — `ptah-api-builder.service.ts:563` — behind a single DI singleton registered once at `vscode-lm-tools\src\lib\di\register.ts:81`. The real risk is inverted: one wiring line, but three hosts whose containers must be able to resolve the new `AgentReportRouter`. | MEDIUM | Task 4.6 wires `deliverAgentReport` at the single site using the lazy-resolver precedent already in that file, then verifies each of the VS Code, Electron and CLI host registrations reaches `cli-agent-runtime`'s `register.ts`. An unresolvable dependency must degrade to a clear error, per the `HarnessMcpInstaller` rule in `vscode-lm-tools/CLAUDE.md`. |
| R-5 | Components 6 and 10 both edit `agent-namespace.builder.ts`. | HIGH | Batches 4 and 5 are strictly sequential and **must never be spawned concurrently**. Restated in both batch headers. |
| R-6 | The `supportsSteer` blast radius is wider than the plan's "consumers are contained" line: ~10 spec files assert it (every adapter spec, `agent-process-manager.service.spec.ts:218/220/240/823`). | MEDIUM | Task 2.4 updates each assertion to the new capability shape. Assertions are rewritten, never deleted, and never `.skip`ped. |
| R-7 | `--name` reaching a CLI older than the version floor is a spawn failure, i.e. a naming feature that costs sessions. | MEDIUM | Task 1.2: `buildSessionName` returns `undefined` rather than throwing, the caller omits the key and logs `warn`, and the flag is emitted from ONE place that can be made conditional in one edit. Version floors documented in Batch 7. |
| R-8 | `agent-process-manager.service.ts` is already large; `sendToAgent` + the pending queue may push it past the 700-line soft ceiling. | LOW | Task 3.1: apply the facade rule — extract `AgentMessageRouter` as an injected collaborator with that exact name (no `helpers`/`utils`). `AgentProcessManager.sendToAgent` keeps its name and signature. Do not split the lifecycle methods out. |
| R-9 | `crossSessionInbound: 'accept'` lets any same-user process inject a user turn into a session running with permission checks off, and covers only sessions Ptah starts. | MEDIUM (accepted) | Not designed around — documented. Batch 7 must state plainly that a Claude session Ptah did not start keeps the silent hold-then-expire behaviour and needs its own `--settings`. |
| R-10 | A trademarked AI product name entering a non-JS file under `apps\ptah-extension-vscode\assets\**` permanently burns the extension id. | HIGH | Batch 7 expresses capability by MODE only and directs the reader to `ptah_agent_list`. Verification: grep the three asset reference files for `copilot|codex|claude|openai|anthropic` and `vendor-roster-drift.spec.ts` must pass. |
| R-11 | `interrupt-resume` discards the interrupted turn's partial work. | LOW (accepted) | Named back to the caller on every response (Task 5.3's formatter) and documented in Batch 7. Never reported as a silent success. |

### Edge cases

- A peer message with empty text is dropped by the existing empty-text guard
  (`user-message.transformer.ts:96-104`) — expected, handled in Task 1.4.
- A replay with no `origin` still returns `[]` — pinned by a test in Task 1.4, because a
  blanket un-drop double-renders every typed prompt.
- `origin.name` absent → neutral peer label, message still shown. **Never** `origin.from`
  (sender-authored, forgeable). Task 1.4 and Task 6.3.
- `/workspace/{root}/agent/{id}` must be **rejected**, not half-parsed — Task 4.2.
- Missing `_callerAgentId` → `delivered: false, reason: 'unattributed-caller'`, never a guess —
  Task 4.5.
- A completed-but-alive continuation-capable agent is queued, not errored, and the `detail`
  says so — Task 3.2.
- Over-cap pending queue is **refused at the caller** with `mode: 'unsupported'`, never
  silently dropped — Task 3.3.
- Pi is `supportsMcp = false`, so Component 6 must not regress it — Task 4.3.

---

## Batch 1: Flag settings, session name, inbound peer on the SDK stream (Group α) — IN_PROGRESS

- Components: 1, 2, 8
- Recommended executor: `backend-developer` sub-agent
- Fallback executor: `claude` sub-agent with the same prompt
- Execution mode: sequential (one executor, tasks in order)
- Rationale: SDK options serialisation, a transformer branch that must NOT double-render, and a
  pump signature change — judgment-heavy and silent-failure prone. A CLI lane would happily
  un-drop every replay.
- Tasks: 4 | Depends on: none
- **Runs in parallel with Batch 2. File-disjoint: Batch 1 owns `libs\backend\agent-sdk\**` plus
  exactly `libs\shared\src\lib\types\execution\stream.ts` and
  `libs\shared\src\lib\types\ai-provider.types.ts`. It must not touch
  `libs\shared\src\lib\types\agent-process.types.ts` (Batch 2 owns it).**

### Task 1.1: `buildFlagSettingsArg` — the one serializer of the flag tier — IN_PROGRESS

- File: `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts`,
  `...\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.output-style.spec.ts`,
  `...\libs\backend\agent-sdk\src\index.ts`
- Plan reference: implementation-plan.md Component 1 (lines 189-225)
- Pattern to follow: the existing `buildFlagSettings` at `sdk-query-options-builder.ts:358`
- Contract:
  - `export const CROSS_SESSION_INBOUND_VALUES = ['accept', 'hold', 'refuse'] as const;`
  - `export type CrossSessionInbound = (typeof CROSS_SESSION_INBOUND_VALUES)[number];`
  - `export function buildFlagSettingsArg(sessionConfig?: OutputStyleActivationFields, crossSessionInbound?: string): string`
  - Second arg typed `string` **deliberately** — validated against the closed set and **omitted**
    with a `logger.warn` when it does not match. An unrecognised value is worse than none: the
    CLI then holds every inbound message even when a higher-precedence source says `accept`.
  - It builds no settings object of its own — it calls `buildFlagSettings` and
    `JSON.stringify`s the result. `buildFlagSettings` stays the ONE object builder and keeps
    its frozen-constant identity return.
  - Carry a comment stating why the string form is used: the installed `Settings` interface has
    no `crossSessionInbound` key and no index signature. **No cast, no `@ts-ignore`, no temp
    file.** `Options.settings?: string | Settings` makes the string type-legal.
- Consumption site in this batch: `sdk-query-options-builder.ts:795`, passing `'accept'`.
- Quality requirement: for a session with no style and no inbound value, the emitted string must
  equal `JSON.stringify(PTAH_DISABLE_SDK_AUTO_MEMORY)` **byte for byte**.
- Spec update: `sdk-query-options-builder.output-style.spec.ts` asserts the literal source text
  `settings: buildFlagSettings(sessionConfig)` and `not.toContain('settings: PTAH_DISABLE_SDK_AUTO_MEMORY')`
  at `:156-163`. Update that ONE wiring guard to the new call shape. Do not touch the other
  assertions — the G4/G4b rules and the frozen-identity check must stay green untouched.
- Validation notes: **A0** — after the edit, start one session and grep the SDK's
  `Spawning Claude Code:` log for `--settings {"autoMemoryEnabled"...`. Report what you saw.
  **A2** — while here, note whether making `--replay-user-messages` unconditional is needed;
  if Task 1.4's testing says yes, it is a one-line change in the merged object from Task 1.2.

### Task 1.2: `buildSessionName` + merged `extraArgs` — IMPLEMENTED-when-verified — IN_PROGRESS

- File: CREATE `...\libs\backend\agent-sdk\src\lib\helpers\session-name.builder.ts` and
  `...\session-name.builder.spec.ts`; MODIFY `...\helpers\sdk-query-options-builder.ts`;
  MODIFY `...\libs\backend\agent-sdk\src\index.ts`
- Depends on: Task 1.1 (same file region)
- Plan reference: implementation-plan.md Component 2 (lines 227-258)
- Contract: `buildSessionName(input: { role: string; taskId?: string; workspaceLabel?: string; uniqueSuffix: string }): string | undefined`.
  Composition `ptah-<workspaceLabel>-<role>[-<taskId>]-<uniqueSuffix>`, lower-cased, non-`[a-z0-9-]`
  collapsed to `-`, length-capped. `uniqueSuffix` = first 6 chars of the session routing id /
  agent id — already unique per session, so uniqueness is guaranteed, not hoped for.
- Implementation detail — **the load-bearing one**: `extraArgs` is today emitted ONLY inside the
  checkpointing spread at `sdk-query-options-builder.ts:890-892`
  (`...((enableFileCheckpointing ?? true) ? { extraArgs: { 'replay-user-messages': null } } : {})`).
  `--name` **cannot be appended beside it** — a user who disables checkpointing would lose their
  session name. Restructure into ONE merged `extraArgs` object.
- Failure behaviour: returns `undefined` when inputs sanitise to nothing; caller omits the key
  and logs at `warn`. A naming problem never costs a session (R-7).
- Quality requirement: the name is agent-facing text and must name **no vendor**
  (`vendor-roster-drift.spec.ts`). A Ptah CLI agent's user-chosen name is user data — slugify
  it, never enumerate it in a description string.
- Note: the second consumption site (`ptah-cli-registry.ts:730` and the spawn options at
  `:700-753`) is **NOT yours** — it belongs to Batch 4, which owns that file. Export both
  `buildFlagSettingsArg` and `buildSessionName` from `agent-sdk`'s public barrel so
  `cli-agent-runtime` can consume them there.

### Task 1.3: `origin` passthrough on the injection path — IN_PROGRESS

- File: `...\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-stream-pump.service.ts`;
  `...\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`;
  `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\libs\shared\src\lib\types\ai-provider.types.ts`
- Depends on: none within the batch
- Plan reference: implementation-plan.md Component 8 (lines 495-543)
- Contract: `SessionStreamPump.sendMessage(sessionId, content, files?, images?, options?: { origin?: SDKMessageOrigin })`,
  forwarded to `SdkMessageFactory.createUserMessage`, which **already accepts `origin`** and
  defaults `{ kind: 'human' }` (`sdk-message-factory.ts:49`). Matching optional on
  `AIMessageOptions` in `ai-provider.types.ts` so `IAIProvider.sendMessageToSession` can carry it.
- Validation notes: R-2 — you own `ai-provider.types.ts` in `libs/shared`; you do **not** own
  `agent-process.types.ts`. Do not widen.

### Task 1.4: the peer branch in the transformer — IN_PROGRESS

- File: `...\libs\backend\agent-sdk\src\lib\sdk-message-transformer.ts`;
  `...\libs\backend\agent-sdk\src\lib\message-transform\user-message.transformer.ts` (+ its spec);
  `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\libs\shared\src\lib\types\execution\stream.ts`
- Depends on: Task 1.3
- Plan reference: implementation-plan.md Component 8
- Contract:
  - `MessageStartEvent` gains `inboundPeer?: { readonly label: string }` — optional and additive;
    no existing producer or consumer changes.
  - `label = origin.name ?? 'peer session'`. **Never `origin.from`** — sender-authored and
    forgeable by any same-user process; `verifiedPeerPid` does not exist on Windows. An absent
    name renders the neutral label and the message is still shown.
  - The origin check sits **ahead of BOTH** existing paths: the live-user branch at
    `sdk-message-transformer.ts:159` and the replay drop at `:206`.
  - **The replay drop stays for `origin.kind !== 'peer'`.** It is load-bearing:
    `--replay-user-messages` is on and the frontend adds the user bubble optimistically
    (`message-sender.service.ts:386-397`), so a blanket un-drop double-renders every typed
    prompt. This is the single most likely way to break this batch.
  - Log at `debug` both when a peer message renders and when a replay drops, so Assumption A1
    is answerable from the log alone.
- Tests required: a replay with `origin.kind === 'peer'` produces the event triple with the
  label; a replay **without** an origin still produces `[]`; a live user message with a peer
  origin produces the labelled triple; a peer origin with no `name` produces the neutral label.

### Batch 1 verification

```bash
npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/shared
npx nx run-many -t typecheck -p @ptah-extension/agent-sdk @ptah-extension/shared
npx nx run-many -t lint -p @ptah-extension/agent-sdk @ptah-extension/shared
```

- Named specs that must pass: `sdk-query-options-builder.output-style.spec.ts` (only the one
  wiring guard changed), `session-name.builder.spec.ts` (new),
  `user-message.transformer.spec.ts`, `sdk-message-transformer` specs.
- Report the observed `--settings` spawn-log line (A0) and what `origin` looked like on the
  replay path (A1).

### Batch 1 executor prompt

    You are assigned Batch 1 of TASK_2026_402_a5c7.
    Worktree (work ONLY here): D:\projects\ptah-extension\.claude-worktrees\agent-messaging
    Task folder: D:\projects\ptah-extension\.claude-worktrees\agent-messaging\.ptah\specs\TASK_2026_402_a5c7

    1. Read batches.md (Batch 1, marked IN_PROGRESS) and implementation-plan.md
       Components 1, 2 and 8, plus the Plan validation section for the risks
       and assumptions this batch carries (A0, A1, A2, R-2, R-7).
    2. Implement Tasks 1.1 through 1.4 in order, with real code. No stubs, no
       placeholders, no TODO markers, no skipped tests.
    3. You own libs\backend\agent-sdk\** plus EXACTLY these two shared files:
       libs\shared\src\lib\types\execution\stream.ts and
       libs\shared\src\lib\types\ai-provider.types.ts. Another executor is
       working concurrently in this same worktree on
       libs\shared\src\lib\types\agent-process.types.ts and
       libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\**.
       Do not touch those. If you believe you must, stop and report it.
    4. Do NOT commit. Do NOT git stash or git checkout. Do NOT run npx nx reset
       (it would kill the other executor's daemon). Do not edit batches.md.
    5. Verification:
       npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/shared
       npx nx run-many -t typecheck -p @ptah-extension/agent-sdk @ptah-extension/shared
       npx nx run-many -t lint -p @ptah-extension/agent-sdk @ptah-extension/shared
       Confirm the "Running target test for N projects" header says 2.
    6. Report each task's completion with evidence, the absolute path of every
       file created or modified, what you observed for assumptions A0 and A1,
       and how you handled each risk listed above.

---

## Batch 2: Capability contract + Cursor `interrupt` (Group β) — IN_PROGRESS

- Components: 3, 4
- Recommended executor: `backend-developer` sub-agent
- Fallback executor: `claude` sub-agent with the same prompt
- Execution mode: sequential (one executor, tasks in order)
- Rationale: replacing a shared boolean across six adapters and ~10 spec files, plus a run
  cancellation that must not race the whole-agent abort. Getting a `capabilities()` row wrong is
  invisible until a vendor silently reports the wrong mode.
- Tasks: 4 | Depends on: none
- **Runs in parallel with Batch 1. File-disjoint: Batch 2 owns
  `libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\**` plus exactly
  `libs\shared\src\lib\types\agent-process.types.ts`, plus the three named compile-fix lines in
  R-1. It must not touch `libs\shared\src\lib\types\execution\**` or
  `libs\shared\src\lib\types\ai-provider.types.ts` (Batch 1 owns them).**

### Task 2.1: the shared capability types — IN_PROGRESS

- File: `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\libs\shared\src\lib\types\agent-process.types.ts`
- Plan reference: implementation-plan.md Component 3 (lines 260-308)
- Contract:
  - `export type AgentMessagingMode = 'steer' | 'interrupt-resume' | 'queue-next-turn' | 'unsupported';`
  - `export type AgentMessagingCapability = 'steer' | 'interrupt' | 'queue' | 'none';`
  - `CliDetectionResult.messagingMode: AgentMessagingCapability` **replaces**
    `supportsSteer: boolean` at `:179`. The old field is deleted, not deprecated.
- Validation notes: R-2 — this is the only `libs/shared` file you own.

### Task 2.2: `CliAdapter.capabilities()` + `SdkHandle.interrupt` — IN_PROGRESS

- File: `...\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cli-adapter.interface.ts`
- Depends on: Task 2.1
- Contract:
  - `CliAdapter.capabilities(): { readonly steer: boolean; readonly interrupt: boolean; readonly continuation: boolean }`
    **replaces** `supportsSteer(): boolean` at `:105`. Removed from the interface and from all
    six adapters — an adapter that does not implement it is a compile error, and that is the
    point (a seventh adapter is forced to answer the question).
  - `SdkHandle.interrupt?: () => Promise<void>` — "abort the CURRENT run/turn without ending the
    session/agent, then resolve once torn down. **Distinct from `abort`**, which ends the whole
    handle." Document that distinction in the interface comment.
  - `SdkHandle.supportsInterrupt?: () => boolean`.
- Validation notes: **A3** — before writing the antigravity and opencode rows, re-read
  `antigravity-cli.adapter.ts:593-601` and `opencode-cli.adapter.ts:547-554` and confirm neither
  carries `continue` / `supportsContinuation`. Report what you found.

### Task 2.3: the six adapter declarations + the three consumer compile fixes — IN_PROGRESS

- File: `...\cli-adapters\{pi,codex,copilot-sdk,cursor,antigravity,opencode}-cli.adapter.ts`
  (note: the Copilot file is `copilot-sdk.adapter.ts`), plus the three named lines only:
  `...\cli-agents\agent-process-manager.service.ts:1005`,
  `...\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.ts:264`,
  `...\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.ts:840`
- Depends on: Task 2.2
- Matrix (from steering-research Q1/Q3, re-verified against the handles):

  | Adapter | steer | interrupt | continuation | Handle changes |
  | --- | --- | --- | --- | --- |
  | pi | true | false | true | none |
  | cursor | false | **true** | true | Task 2.4 |
  | codex | false | false | true | none |
  | copilot | false | false | true | none |
  | ptah-cli | false | false | true | none |
  | antigravity | false | false | false | none |
  | opencode | false | false | false | none |

  Every `detect()` result construction site that emitted `supportsSteer: false` now emits the
  corresponding `messagingMode`.
- **R-1, read this carefully:** the three consumer lines above live in files owned by LATER
  batches. You own **only** the minimal edit that keeps each compiling, and nothing else in
  those files:
  - `agent-process-manager.service.ts:1005` — `adapter?.supportsSteer()` becomes the
    `capabilities().steer` equivalent. `steer()` is **not** deleted here; Batch 3 deletes it.
  - `agent-namespace.builder.ts:264` — the synthesised `supportsSteer: false` for Ptah CLI rows
    becomes `messagingMode: 'queue'`, read from the same declaration the router will read
    (Req 5.2). Do not touch anything else in this file.
  - `agent-rpc.handlers.ts:840` — same mechanical replacement.

### Task 2.4: Cursor `interrupt` — the one new mechanism — IN_PROGRESS

- File: `...\cli-adapters\cursor-cli.adapter.ts` (+ `cursor-cli.adapter.spec.ts`)
- Depends on: Task 2.3
- Plan reference: implementation-plan.md Component 4 (lines 310-335)
- Contract: `interrupt` cancels `activeRun` (declared `:277`, assigned `:342`) and resolves once
  the stream consumer unwinds. `continue` at `:387` re-enters `runTurn` on the SAME `agent`
  object, so the follow-up lands on the same agent id and session.
- Failure behaviour: no active run → resolve immediately (the router then falls through to
  `queue-next-turn`, which is the honest outcome). `cancel()` rejecting → log and surface in the
  tool `detail`; the mode reported is `unsupported` with the reason, **never a false
  `interrupt-resume`**.
- Quality requirement: must not race the whole-agent abort path at `:284-288` — `interrupt` sets
  no abort signal and touches only `activeRun`.
- Tests: fake `Agent`/`Run`; `interrupt()` cancels the active run, the stream consumer unwinds,
  and a subsequent `continue()` calls `agent.send` on the same agent object.
- **R-6:** ~10 spec files assert `supportsSteer` (every adapter spec plus
  `agent-process-manager.service.spec.ts:218,220,240,823`). Rewrite each assertion to the new
  capability shape. Never delete an assertion, never `.skip` one.

### Batch 2 verification

```bash
npx nx run-many -t test -p @ptah-extension/cli-agent-runtime @ptah-extension/shared @ptah-extension/vscode-lm-tools @ptah-extension/rpc-handlers
npx nx run-many -t typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/shared @ptah-extension/vscode-lm-tools @ptah-extension/rpc-handlers
npx nx run-many -t lint -p @ptah-extension/cli-agent-runtime @ptah-extension/shared
```

- A repo-wide grep for `supportsSteer` must return **zero** hits outside intentional git history.
- Every adapter spec and `agent-process-manager.service.spec.ts` green.

### Batch 2 executor prompt

    You are assigned Batch 2 of TASK_2026_402_a5c7.
    Worktree (work ONLY here): D:\projects\ptah-extension\.claude-worktrees\agent-messaging
    Task folder: D:\projects\ptah-extension\.claude-worktrees\agent-messaging\.ptah\specs\TASK_2026_402_a5c7

    1. Read batches.md (Batch 2, marked IN_PROGRESS) and implementation-plan.md
       Components 3 and 4, plus the Plan validation section for risks R-1, R-2,
       R-6 and assumption A3.
    2. Implement Tasks 2.1 through 2.4 in order, with real code. No stubs, no
       placeholders, no TODO markers, no skipped or deleted assertions.
    3. You own libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\**
       plus EXACTLY libs\shared\src\lib\types\agent-process.types.ts, plus the
       three single-line compile fixes named in Task 2.3 and nothing else in
       those three files. Another executor is working concurrently in this same
       worktree on libs\backend\agent-sdk\** and on
       libs\shared\src\lib\types\execution\stream.ts and ai-provider.types.ts.
       Do not touch those. If you believe you must, stop and report it.
    4. Do NOT commit. Do NOT git stash or git checkout. Do NOT run npx nx reset
       (it would kill the other executor's daemon). Do not edit batches.md.
    5. Verification: the four-project test, typecheck and lint run-many commands
       in the "Batch 2 verification" section. Confirm the "Running target test
       for N projects" header says 4. Then grep the repo for supportsSteer and
       confirm zero live hits.
    6. Report each task's completion with evidence, the absolute path of every
       file created or modified, what you found for assumption A3, and how you
       handled R-1 and R-6.

---

## Batch 3: `sendToAgent` — the mode router and pending queue — PENDING

- Component: 5
- Recommended executor: `backend-developer` sub-agent
- Fallback executor: `claude` sub-agent
- Execution mode: sequential
- Rationale: lifecycle logic with three distinct failure states that must stay distinguishable,
  a queue with a flush seam, and a turn-settle race. Exactly the class of work where a CLI lane
  returns something that compiles and silently reports success for undelivered messages.
- Tasks: 3 | Depends on: Batch 2 (COMPLETE, commit `586b1a400`)
- **Runs in parallel with Batch 6 as wave 2.** File-disjoint: Batch 3 owns `cli-agent-runtime\**`
  plus exactly `libs\shared\src\lib\types\agent-process.types.ts`; Batch 6 owns
  `libs\shared\src\lib\types\execution\{agent,schemas,factories}.ts`, `chat-streaming\**` and the
  chat message bubble. Same shared-worktree rules as wave 1: no `nx reset`, no `git stash`, no
  commit, no `batches.md` edit.
- Read from Batch 2's report before starting: the router should take
  `caps = handleCaps ?? adapterCaps`, where `handleCaps` comes from `handle.supportsInterrupt?.()`,
  `handle.supportsContinuation?.()` and the presence of `handle.steer`, and `adapterCaps` from
  `adapter.capabilities()`. `bestMessagingCapability` is exported from the `cli-adapters` barrel —
  call it rather than re-deriving a mode. `AgentProcessManager.steer()` is intact and still routed
  through `capabilities().steer`; this batch deletes it.
- Files owned: `...\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts`
  (+ its spec); possibly CREATE `...\cli-agents\agent-message-router.service.ts` (+ spec);
  `libs\shared\src\lib\types\agent-process.types.ts` (adds `AgentMessageOutcome` only — Batch 2
  has already landed its change to this file).

### Task 3.1: `sendToAgent` replaces `steer` — PENDING

- Plan reference: implementation-plan.md Component 5 (lines 337-393)
- Contract: `sendToAgent(agentId: string, message: string): Promise<AgentMessageOutcome>` where
  `AgentMessageOutcome = { mode: AgentMessagingMode; detail?: string }` (shared type).
  `AgentProcessManager.steer()` is **deleted, not deprecated**.
- Selection order, from `caps = handleCaps ?? adapterCaps`:
  1. turn in flight AND `caps.steer` AND `handle.steer` present → call it → `'steer'`.
  2. turn in flight AND `caps.interrupt` AND `handle.interrupt` present → `interrupt()`, await
     the current turn's settle, then `continueConversation` → `'interrupt-resume'`.
  3. `caps.continuation` → turn in flight: park on the pending queue and return
     `'queue-next-turn'`; otherwise call `continueConversation` directly and return
     `'queue-next-turn'`.
  4. otherwise `'unsupported'`, `detail` naming the CLI and the reason.
- **No branch anywhere on a CLI name** (Req 4.7). The handle wins when present; the adapter
  declaration is the fallback.
- The three preserved failure states (today at `:985`, `:989-996`, `:998-1002`):
  `AgentMessageError('not_found')`; `AgentMessageError('restored')` carrying
  `restoredRecordMessage` and its `resume_session_id` recovery hint;
  `AgentMessageError('not_running')` naming the status.
- **R-8:** if this pushes the file past the 700-line soft ceiling, extract `AgentMessageRouter`
  as an injected collaborator with that exact name. `AgentProcessManager.sendToAgent` keeps its
  name and signature and delegates. Do not split the lifecycle methods out. No `helpers`/`utils`.

### Task 3.2: current-turn tracking — PENDING

- Depends on: Task 3.1
- Contract: `TrackedAgent.currentTurnDone: Promise<number>`, written in `trackSdkHandle` from
  `sdkHandle.done` and re-written in `continueConversation` from `outcome.done`.
  `interrupt-resume` awaits it. **Without this the router races `continueConversation`'s `busy`
  check** — that is the whole reason the field exists.
- `continueConversation()` and its `AgentContinueError` codes are **left exactly as they are**
  (`:1033-1134`). The queue sits in front of it.
- Edge case: a completed-but-alive continuation-capable agent is **not** an error — it queues,
  and the `detail` says the agent finished its turn and this message starts a new one.

### Task 3.3: the bounded pending queue — PENDING

- Depends on: Task 3.2
- Contract: `TrackedAgent.pendingMessages: string[]`, capped at 8, in-memory, cleared on record
  teardown, never persisted. `handleExit` — the single settle point, reached from `:644-647`
  (first turn) and `:1120-1133` (continued turn) — shifts and dispatches one entry through
  `continueConversation` after the status settles.
- Over-cap is **refused at the caller** with `mode: 'unsupported'` and a reason. Never silently
  dropped. Nothing returns a success the caller would act on when nothing was delivered.
- Observability: log the selected mode with the agent id and CLI at `info`.
- Tests: one per row of the Batch 2 capability matrix against fake handles; the three unroutable
  states; the queue (park while running, flush on exit, refuse over cap, refuse over size).

### Batch 3 verification

```bash
npx nx run-many -t test -p @ptah-extension/cli-agent-runtime @ptah-extension/shared
npx nx run-many -t typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/shared
npx nx run-many -t lint -p @ptah-extension/cli-agent-runtime
```

- `agent-process-manager.service.spec.ts` green with a case per mode and per failure state.
- Grep: no occurrence of a CLI vendor name inside the routing logic.

---

## Batch 4: Child identity on the MCP URL + `AgentReportRouter` — PENDING

- Components: 6, 7
- Recommended executor: `backend-developer` sub-agent
- Fallback executor: `claude` sub-agent
- Execution mode: sequential
- Rationale: one URL grammar written in `cli-agent-runtime` and parsed in `vscode-lm-tools` —
  one author must own both halves, or the grammar drifts and half-parses. Plus delivery limits
  that must refuse honestly.
- Tasks: 6 | Depends on: Batches 1, 2, 3
- **R-5: must NOT run concurrently with Batch 5 — both edit `agent-namespace.builder.ts`.**
- Files owned: `...\cli-agents\cli-adapters\ptah-mcp-url.ts`; the six spawn call sites
  (`codex-cli.adapter.ts:597`, `copilot-sdk.adapter.ts:329`, `cursor-cli.adapter.ts:323`,
  `opencode-cli.adapter.ts:378`, `antigravity-cli.adapter.ts:367`,
  `ptah-cli-spawn-options.service.ts:177`); `cli-adapter.interface.ts` (`CliCommandOptions.agentId`);
  `agent-process-manager.service.ts`; `ptah-cli\ptah-cli-registry.ts`;
  `ptah-cli\helpers\ptah-cli-spawn-options.service.ts`; `mcp-http\http-server.handler.ts` (+ spec);
  `mcp-core\types\mcp-protocol.types.ts`; `namespace-builders\agent-namespace.builder.ts`;
  CREATE `...\cli-agents\agent-report-router.service.ts` (+ spec); `cli-agent-runtime\src\lib\di\{tokens.ts,register.ts}`;
  `cli-agent-runtime\src\index.ts`; `vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts`.

### Task 4.1: `ptahMcpServerUrl` grows an agent segment — PENDING

- Plan reference: implementation-plan.md Component 6 (lines 395-441)
- Contract: `ptahMcpServerUrl(port, workingDirectory, agentId?)` →
  `http://localhost:PORT/agent/{encodeURIComponent(agentId)}/workspace/{encodeURIComponent(root)}`.
  Agent segment **leads**, workspace stays **terminal** — the same ordering rule
  `/session/{id}/workspace/{root}` already follows.
- `ptahMcpServerUrl` stays the ONE spawn-side URL builder. Its file-writer twin `ptahMcpUrl` in
  `ptah-mcp-slots.ts` gains **no** agent segment (a persistent config entry belongs to no agent)
  but must keep grammar parity.
- `encodeURIComponent` only, never hand-rolled escaping — a literal `/sse` in a URL changes how
  `harness-sync`'s `inferTransportType` classifies a written entry on read-back.

### Task 4.2: server-side parse — PENDING

- Depends on: Task 4.1
- File: `...\mcp-http\http-server.handler.ts` (+ `http-server.handler.spec.ts`);
  `...\mcp-core\types\mcp-protocol.types.ts`
- Contract: workspace extractor becomes
  `^(?:\/session\/[^/?]+|\/agent\/[^/?]+)?\/workspace\/([^/?]+)\/?(?:\?.*)?$`; new
  `extractCallerAgentId(url)` matching `^\/agent\/([^/?]+)`; `MCPRequest._callerAgentId?: string`
  assigned exactly where `_callerSessionId` is assigned today (`:337-344`).
- **Edge case that must be a spec row:** `/workspace/{root}/agent/{id}` is **rejected**, not
  half-parsed. Add rejection rows alongside the accept rows in `http-server.handler.spec.ts`.

### Task 4.3: thread the agent id through the six spawn paths — PENDING

- Depends on: Task 4.2
- Contract: `CliCommandOptions.agentId?: string`, passed by `doSpawnSdk` at the `runSdk` call
  (`agent-process-manager.service.ts:468-481`); each adapter forwards it to `ptahMcpServerUrl`.
- `doSpawnSdk` already mints `AgentId.create()` at `:435`, **before** `runSdk` at `:468` — the
  rival-CLI path needs no new plumbing. `spawnFromSdkHandle` mints at `:524`, **after** the
  handle and its URL exist, so the Ptah CLI path needs the id **reserved by the caller**:
  - `AgentProcessManager.reserveAgentId(): string` — a thin wrapper over `AgentId.create()`.
  - `spawnFromSdkHandle`'s `meta` gains `agentId?: string`, using `meta.agentId ?? AgentId.create()`.
  - `buildAgentNamespace.spawn` reserves the id before `registry.spawnAgent(...)` and passes it
    to both, so the Ptah CLI path has ONE id minted once and available to its MCP URL.
  - `PtahCliSpawnOptions` / `assembleSpawnOptions` gain `agentId?` and thread it to
    `ptah-cli-spawn-options.service.ts:177`.
- Failure behaviour: an absent agent id yields **today's exact URL**, byte for byte.
- Pi is `supportsMcp = false` (`pi-cli.adapter.ts:150`) — confirm nothing regresses there.
- While in `ptah-cli-registry.ts`: switch its `settings: buildFlagSettings({...})` site to
  `buildFlagSettingsArg` with `'accept'`, and add the `--name` `extraArgs` entry using
  `buildSessionName` — both imported from `@ptah-extension/agent-sdk`'s public barrel (Batch 1
  Task 1.2 deliberately left this second consumption site to you). Without it, Requirements 1.1
  and 1.2 cover only half the fleet.

### Task 4.4: `AgentReportRouter` — PENDING

- Depends on: Task 4.3
- File: CREATE `...\cli-agents\agent-report-router.service.ts` (+ `.spec.ts`)
- Plan reference: implementation-plan.md Component 7 (lines 443-493)
- Contract:
  - `deliver(input: { agentId: string; message: string; summary?: string }): Promise<AgentReportDelivery>`
    where `AgentReportDelivery = { delivered: boolean; reason?: string; parentSessionId?: string }`.
  - Envelope handed to the model: `<agent-report agent-id="…" agent="…" cli="…">…</agent-report>`,
    mirroring the CLI's own inbound wrapper so there is one mental model across vendors.
  - `origin: { kind: 'peer', from: 'ptah-agent:<agentId>', name: '<cli> · <agent label>' }`,
    passed through `IAIProvider.sendMessageToSession` (`ai-provider.types.ts:281-285`) — the
    port already exists; **no new port, no new lib**. `gateway-chat-bridge.ts:200` is the
    precedent for a backend lib driving a chat session this way.
  - Parent resolution reads `tracked.info.parentSessionId`, set at spawn
    (`agent-process-manager.service.ts:447`, `:535`). Liveness via
    `IAgentAdapter.isSessionActive(sessionId)`.
  - Limits copied from the Claude channel, not invented: body cap **1,048,576** characters, a
    per-sender burst limit, a bounded queue with identical-repeat suppression. Over-limit is
    refused at the caller with a reason.
- Refusal reasons, each its own test: `unattributed-caller` (unknown agent id or absent
  `_callerAgentId`), `no-parent-recorded`, `parent-session-not-active`. **It never reports a
  delivery it did not make.**
- Validation notes: **A1** — this is where the assumption gets settled empirically. Inject one
  report into a live chat session and log `sdkMessage.origin` at `sdk-message-transformer.ts:206`.
  If the CLI does not preserve the caller-supplied origin, implement the contingency named in
  the plan: a `SessionInboundCallbackRegistry` DI fan-out modelled verbatim on
  `SessionMcpStatusCallbackRegistry`. **Only the producer changes** — the tool contract, the
  shared type and the frontend do not. Report which path you took and why.

### Task 4.5: the tile segment — PENDING

- Depends on: Task 4.4
- File: `...\cli-agents\agent-process-manager.service.ts` (public `recordAgentNote(agentId, segment)`)
- Contract: one synthetic `'info'` `CliOutputSegment` on the existing `AgentOutputDelta`
  (`agent-process.types.ts:207-216,239-248`, emitted at `agent-process-manager.service.ts:1544`,
  broadcast at `wiring\agent-events.ts:184-186`). **No new frontend plumbing.**
- The tile segment is written **only on a successful delivery**, so the tile cannot show a
  report the parent never received.
- Log every refusal with its reason at `warn` — a refused report is otherwise invisible on the
  parent side.

### Task 4.6: DI registration and host wiring — PENDING

- Depends on: Task 4.5
- File: `cli-agent-runtime\src\lib\di\{tokens.ts,register.ts}`; `cli-agent-runtime\src\index.ts`;
  `vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts`
- **R-4, corrected from the plan:** the plan asks you to find three `PtahAPIBuilder`
  construction sites. There is **one** `buildAgentNamespace(...)` call —
  `ptah-api-builder.service.ts:563` — behind a single DI singleton registered at
  `vscode-lm-tools\src\lib\di\register.ts:81`. So wire `deliverAgentReport` there, once, using
  the lazy-resolver precedent already in that file (`getPtahCliRegistry`).
- **Then verify the part that actually varies:** confirm the VS Code, Electron and CLI host
  container bootstraps each register `cli-agent-runtime`'s `register.ts` so the lazy resolve
  succeeds in all three products. A host left unwired makes `ptah_agent_report` work in one
  product and not another. Report the three registration sites you checked, by absolute path.
- Absent wiring must degrade to a **clear error**, per the `HarnessMcpInstaller` rule in
  `vscode-lm-tools/CLAUDE.md` — never a silent no-op.

### Batch 4 verification

```bash
npx nx run-many -t test -p @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools @ptah-extension/shared
npx nx run-many -t typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools @ptah-extension/shared
npx nx run-many -t lint -p @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools
```

- `http-server.handler.spec.ts` green including the new rejection rows.
- `agent-report-router.service.spec.ts` green: one test per refusal reason, the size cap, the
  burst limit, the repeat suppression, and a happy path asserting **exactly one**
  `sendMessageToSession` with the peer origin and **exactly one** tile segment.
- One spec per adapter asserting the URL it hands its vendor.

---

## Batch 5: `ptah_agent_message` and `ptah_agent_report` on both MCP surfaces — PENDING

- Component: 10
- Recommended executor: `backend-developer` sub-agent
- Fallback executor: `claude` sub-agent
- Execution mode: sequential
- Rationale: two dispatchers, two formatters and strict Zod at an external boundary, where a
  schema that falls back to a default instead of erroring is a requirement violation that still
  passes a smoke test.
- Tasks: 5 | Depends on: Batches 3 and 4
- **R-5: must NOT run concurrently with Batch 4 — both edit `agent-namespace.builder.ts`.**
- Files owned: `...\mcp-core\tool-description.builder.ts`, `...\mcp-core\protocol-dispatcher.ts`,
  `...\mcp-core\mcp-response-formatter.ts`, `...\mcp-stdio\tool-builders.ts`,
  `...\mcp-stdio\agent-tool.dispatcher.ts`, `...\mcp-stdio\stdio-mcp-server.service.spec.ts`,
  `...\code-execution\types.ts`, `...\namespace-builders\agent-namespace.builder.ts` (+ spec),
  `libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.ts`,
  `apps\ptah-cli\src\cli\commands\mcp-serve.spec.ts`,
  `apps\ptah-cli\src\cli\session\session-describe.builder.spec.ts`,
  `apps\ptah-cli\tests\e2e\mcp-serve.e2e.spec.ts`.

### Task 5.1: retire `ptah_agent_steer`, add the two tools — PENDING

- Plan reference: implementation-plan.md Component 10 (lines 585-650)
- `buildAgentSteerTool()` (`tool-description.builder.ts:653-675`) is **deleted**. No alias
  survives: two tools that both claim to instruct an agent is forbidden, and the preset
  allow-list has to be edited either way, so an alias buys nothing.
- Descriptions name **no vendor** (`vendor-roster-drift.spec.ts` must still pass) and direct the
  reader to `ptah_agent_list` for capability.
- Both tools must appear on **BOTH** surfaces' tool lists. Single-surface exposure is treated as
  a bug in this repo.

### Task 5.2: strict schemas and dispatch — PENDING

- Depends on: Task 5.1
- Pattern to copy: `WebSearchArgsSchema` `.strict()` + `describeZodIssues` + `toolErrorResponse`
  at `protocol-dispatcher.ts:849-866`. An invalid value is an MCP tool **ERROR**, never a
  fallback.
- Schemas (both surfaces):
  - `AgentMessageSchema = z.object({ agentId: z.string().min(1), message: z.string().min(1).max(MAX_AGENT_MESSAGE_LENGTH) }).strict()`
  - `AgentReportSchema = z.object({ message: z.string().min(1).max(MAX_AGENT_REPORT_LENGTH), summary: z.string().min(1).max(200).optional() }).strict()`
  - `MAX_AGENT_REPORT_LENGTH = 1_048_576`, matching the Claude channel's body cap.
- **`ptah_agent_report` takes no `agentId`** — the caller is identified by `_callerAgentId` from
  the URL (Batch 4). That is the whole point of Req 6.2; accepting a sender-supplied id would
  reintroduce the forgeable identity the design rejects.
- HTTP: replace `case 'ptah_agent_steer'` at `protocol-dispatcher.ts:809-820`.
  stdio: `MCP_MVP_TOOL_NAMES` (`tool-builders.ts:32-40`), `buildMcpMvpTools` (`:137-147`),
  `AgentToolDispatcher.TOOL_NAMES` (`agent-tool.dispatcher.ts:170-177`), the switch at `:188-204`,
  and the `AgentSteerSchema` at `:75-80`.

### Task 5.3: response shapes and formatters — PENDING

- Depends on: Task 5.2
- `ptah_agent_message` → `{ agentId, mode, detail? }`, rendered by `formatAgentMessage`
  (replacing `formatAgentSteer`) as a short block naming the mode and — **for
  `interrupt-resume`** — stating that the interrupted turn's partial work was discarded (R-11).
- `ptah_agent_report` → `{ delivered, reason?, parentSessionId? }`.
- `formatAgentList` capability cell at `mcp-response-formatter.ts:499` becomes
  `messaging: <steer|interrupt|queue|none>`; the Ptah CLI row appends the same field to its
  existing `provider: …, ptahCliId: …` cell and reads `messagingMode` from the **same
  declaration the router uses** (Req 5.2). The row set stays `cliDetectionService.detectAll()` —
  no vendor is listed as available that is not installed.
- `AgentMessageError` maps to `isError: true` with its state in the text, so the three states
  from Batch 3 stay distinguishable to the calling agent.

### Task 5.4: namespace + the tool-name lists — PENDING

- Depends on: Task 5.3
- `AgentNamespace` (`code-execution\types.ts:234-…`; builder `agent-namespace.builder.ts:112-345`,
  `steer` at `:231-233`): `steer` → `message(agentId, message): Promise<AgentMessageOutcome>`;
  new `report(input): Promise<AgentReportDelivery>` backed by the optional structural dependency
  `deliverAgentReport?` on `AgentNamespaceDependencies` that Batch 4 wired.
- **R-3:** `...\mcp-stdio\stdio-mcp-server.service.spec.ts` carries `ptah_agent_steer` and is
  **not** in the plan's file list — update it. Same for the three `apps\ptah-cli` spec files;
  the stdio name tuple grows to 9.

### Task 5.5: spec sweep — PENDING

- Depends on: Task 5.4
- `tool-description.builder.spec.ts` (both tools present, no vendor name);
  `protocol-dispatcher.spec.ts` (dispatch + schema rejection);
  `mcp-stdio\agent-tool.dispatcher.spec.ts` and the stdio tool-list specs;
  `mcp-response-formatter.spec.ts` (capability cell + the two new formatters);
  `agent-namespace.builder.spec.ts`; `vendor-roster-drift.spec.ts` runs **unchanged** and must
  still pass.

### Batch 5 verification

```bash
npx nx run-many -t test -p @ptah-extension/vscode-lm-tools @ptah-extension/rpc-handlers ptah-cli
npx nx run-many -t typecheck -p @ptah-extension/vscode-lm-tools @ptah-extension/rpc-handlers ptah-cli
npx nx run-many -t lint -p @ptah-extension/vscode-lm-tools @ptah-extension/rpc-handlers
```

- `vendor-roster-drift.spec.ts` green without modification.
- Grep `libs\backend\vscode-lm-tools` and `apps\ptah-cli` for `ptah_agent_steer` / `agent_steer`:
  zero hits (`ptah-system-prompt.constant.ts` is Batch 7's, so it may still hit there).

---

## Batch 6: Peer-message render in chat — PENDING

- Component: 9
- Recommended executor: `frontend-developer` sub-agent
- Fallback executor: `claude` sub-agent
- Execution mode: sequential
- Rationale: Angular signals, OnPush, a template variant and the markdown chokepoint — the one
  UI surface in the task, and the one place a second sanitizer could be introduced by accident.
- Tasks: 3 | Depends on: Batch 1 (COMPLETE, commit `79c35a72d`) — `MessageStartEvent.inboundPeer`
  is landed on `main`-of-this-branch and needs nothing further.
- **Pulled forward: runs in parallel with Batch 3 as wave 2.** File-disjoint from Batch 3 (which
  owns `cli-agent-runtime\**` and `libs\shared\...\agent-process.types.ts`) and from Batches 4
  and 5. It edits `libs\shared\src\lib\types\execution\{agent,schemas,factories}.ts`, which no
  other batch after Batch 1 touches. Same shared-worktree rules as wave 1: no `nx reset`, no
  `git stash`, no commit, no `batches.md` edit.
- Files owned: `libs\shared\src\lib\types\execution\agent.ts`, `...\execution\schemas.ts`,
  `...\execution\factories.ts`; `libs\frontend\chat-streaming\src\lib\accumulator-core.service.ts`,
  `...\message-finalization.service.ts`;
  `libs\frontend\chat\src\lib\components\organisms\message-bubble.component.{html,ts}`.

### Task 6.1: the shared field — PENDING

- Plan reference: implementation-plan.md Component 9 (lines 545-583)
- Contract: `ExecutionChatMessage` gains `inboundPeer?: { readonly label: string }` **alongside**
  `role: 'user'`. **The `MessageRole` union is NOT widened.** Widening it would force every
  consumer of the three-value union and its Zod mirror (`execution\schemas.ts:27,96-103`) to
  handle a fourth case for a difference that is purely presentational. The optional field is the
  smaller, reversible change. Update `createExecutionChatMessage` (`factories.ts:26`) and the
  Zod mirror together.

### Task 6.2: carry it through the write path — PENDING

- Depends on: Task 6.1
- `accumulator-core.service.ts:244` is the single `switch (event.eventType)` write path;
  `message_start` is at `:245`.
- `message-finalization.service.ts:266-280` — the `role === 'user'` branch already copies
  `messageStartEvent.imageCount` onto the message. Follow that exact pattern for `inboundPeer`.
- Confirm (do not change) that `agent-monitor-tree-builder.service.ts:406` and
  `streaming-indexes.ts:179` need no new case — `message_start` is already handled there.

### Task 6.3: the third bubble variant — PENDING

- Depends on: Task 6.2
- The bubble branches on `message().inboundPeer` **inside the existing user arm** of
  `@if (message().role === 'assistant') { … } @else { … }` at
  `message-bubble.component.html:1`. Same layout; distinct accent and icon; the header shows the
  label instead of the literal `You` at `:199`; a caption states the sender is **unverified**.
- The body goes through the existing `<markdown>` binding at `:230`/`:236` — unchanged.
  **No second sanitizer, no `[innerHTML]`.**
- Add a `data-testid` for the peer bubble, following the `data-testid="chat-user-message"`
  precedent at `:205`. E2E selects by test id, never by a styling class (commit `2b07ce2fe`).
- OnPush, signals, `inject()`. The peer accent must meet contrast in **both** themes.
- Edge cases: an empty label renders the neutral peer label; a message with `inboundPeer` and no
  body is never produced (the backend guard drops it).

### Batch 6 verification

```bash
npx nx run-many -t test -p @ptah-extension/chat-streaming @ptah-extension/chat @ptah-extension/shared
npx nx run-many -t typecheck -p @ptah-extension/chat-streaming @ptah-extension/chat @ptah-extension/shared
npx nx run-many -t lint -p @ptah-extension/chat-streaming @ptah-extension/chat
```

- Accumulator unit test (the field survives the write path); finalization unit test (the field
  reaches `ExecutionChatMessage`); a component test asserting the peer bubble renders the label
  and routes the body through `<markdown>`.

---

## Batch 7: Harness text, preset allow-list and docs — PENDING

- Component: 11
- Recommended executor: **CLI lane** — Ptah CLI Claude agent
  `ptahCliId pc-effaa2c4-0d41-4e95-980a-89d3bf971b4d` (fallback `cli: codex`)
- Fallback executor: `technical-content-writer` sub-agent, or `backend-developer` if the lane
  returns anything that fails the trademark grep
- Execution mode: sequential (single lane; the files are small but the rename must be total)
- Rationale: this is the one batch that is transcription rather than judgment — a mechanical
  rename across 15 files plus content bullets that the plan already dictates verbatim. No
  design decisions, no runtime behaviour. `builtin-presets.ts` is an allow-list edit, not prose,
  but it is a two-line change with a spec behind it.
- Tasks: 3 | Depends on: Batch 5 (final tool names)
- Files owned:
  `libs\backend\rpc-handlers\src\lib\harness\config\builtin-presets.ts`;
  `libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-system-prompt.constant.ts`;
  `.claude\skills\ptah-cli-usage\references\{agent-cli,internal-mcp,mcp-serve}.md`;
  `apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\ptah-cli-usage\references\{agent-cli,internal-mcp,mcp-serve}.md`;
  `apps\ptah-docs\src\content\docs\agents\cli-agents.md`;
  `apps\ptah-docs\src\content\docs\mcp-and-skills\{ptah-tools,driving-ptah-via-mcp}.md`;
  `apps\ptah-cli\docs\jsonrpc-schema.md`;
  `libs\backend\cli-agent-runtime\CLAUDE.md`, `libs\backend\agent-sdk\CLAUDE.md`,
  `libs\backend\vscode-lm-tools\CLAUDE.md`.
- **Added 2026-09-12, found by Batch 5:**
  `apps\ptah-extension-vscode\assets\harnesses\tribunal-conductor.json` — a SECOND
  `enabledTools` allow-list, the same shape as `builtin-presets.ts` and owned by no batch. It
  named `ptah_agent_steer` and neither replacement, so the tribunal conductor harness would
  have silently lost both new tools. **Already fixed** on this branch beside the Batch 5
  commit; listed here so Batch 7's totality check finds it rather than re-reporting it. It is
  the only harness asset that names a `ptah_agent_*` tool — verified by grep over
  `assets\harnesses\`.

### Task 7.1: the preset allow-list — PENDING

- File: `libs\backend\rpc-handlers\src\lib\harness\config\builtin-presets.ts`
- `enabledTools.ptah` is an **allow-list**. Replace `'ptah_agent_steer'` with
  `'ptah_agent_message'` and add `'ptah_agent_report'`. Without this the preset silently blocks
  both new tools — the failure is invisible until an agent's tool call is refused.

### Task 7.2: total rename — PENDING

- Depends on: Task 7.1
- **R-3:** `libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-system-prompt.constant.ts`
  contains `ptah_agent_steer` and is named nowhere in the plan. It is agent-facing prose in a
  `.ts` file — rename it here.
- Rewrite every `ptah_agent_steer` / `agent_steer` reference in the owned files above.
- Verification: `grep -rn "ptah_agent_steer\|agent_steer"` over `libs`, `apps` and `.claude`
  returns **zero** live hits.

### Task 7.3: the guidance content — PENDING

- Depends on: Task 7.2
- Write these points, and only these points (they are dictated by the plan, not by you):
  - **Peer discovery:** `ListAgents` / `SendMessage` are available to Ptah SDK sessions and reach
    Claude sessions only. Rival CLIs are not Claude sessions, bind no inbox socket, and never
    appear in `ListAgents`.
  - **Per-CLI capability:** direct the reader to `ptah_agent_list`. **Never a fixed roster.**
  - **Waiting:** `notify_when_idle`, with BOTH limits — only the main conversation may subscribe
    (a subagent that subscribes gets the whole call refused, message included), and it reaches
    sessions on this machine only. For rival-CLI children the equivalent is `ptah_agent_status`
    with a matched interval, never a tight loop.
  - **Version floors:** CLI **2.1.234** on native Windows / **2.1.224** elsewhere for
    cross-session messaging; **2.1.224** for `crossSessionInbound`; **2.1.236** for
    `notify_when_idle`; SDK **0.3.150** pinned, with `origin.fromMode` (SDK 0.3.234) explicitly
    out of reach and nothing depending on it.
  - **Modes:** `interrupt-resume` **discards the interrupted turn's partial work**; `steer` and
    `queue-next-turn` do not.
  - A completed continuation-capable agent keeps its process alive by design and is still
    messageable — intended, not a leak.
  - **R-9, state it plainly:** `crossSessionInbound: 'accept'` means any same-user process that
    reaches a Ptah session's socket can inject a user turn into a session running with
    permission checks off. Ptah covers **only the sessions it starts**. A developer's own
    `claude` terminal, or any Claude session Ptah did not start, keeps the default
    hold-then-expire behaviour and will still silently lose messages across a class mismatch —
    such a session needs its own `--settings`.
- **R-10, BLOCKING constraint:** the files under
  `apps\ptah-extension-vscode\assets\plugins\**` are non-JS files inside the shipped extension.
  They must **not** gain a trademarked AI product name — `copilot`, `codex`, `claude`, `openai`,
  `anthropic`. Writing "for codex children, use queue-next-turn" into one of them is exactly the
  change that permanently burns the extension id. Express capability by **mode** and look it up
  at runtime via `ptah_agent_list` — which is what the requirement asks for anyway, so the two
  constraints agree.

### Batch 7 verification

```bash
npx nx run-many -t test -p @ptah-extension/rpc-handlers @ptah-extension/vscode-lm-tools
npx nx run-many -t lint -p @ptah-extension/rpc-handlers @ptah-extension/vscode-lm-tools
```

- Repo-wide grep for `ptah_agent_steer` / `agent_steer` → zero live hits.
- Grep the three files under `apps\ptah-extension-vscode\assets\plugins\**` for
  `copilot|codex|claude|openai|anthropic` → zero hits.
- `vendor-roster-drift.spec.ts` green.

---

## Batch 8: Empirical acceptance run — PENDING

- Recommended executor: `senior-tester` sub-agent
- Fallback executor: none — this batch cannot be delegated to a CLI lane; it needs live vendors
  and a running product.
- Execution mode: sequential
- Rationale: the acceptance cases are not unit tests. They are the A5/A6/A8 re-runs from
  `research-report.md` Appendix A plus per-vendor mode checks, and they are the only evidence
  that the CLI actually delivers with `accept`.
- Tasks: 1 | Depends on: Batches 1-7 (all code landed and committed)
- Deliverable: `test-report.md` in the task folder.

### Task 8.1: acceptance cases — PENDING

1. Spawn a Ptah CLI agent under full auto; from a prompting-class peer, `SendMessage` to it. The
   agent's transcript shows the message within one turn boundary. (Req 1.1 — the A5/A6 case.)
2. The reverse: a `bypassPermissions` child messages the main chat; the chat receives it.
   (Req 1.2.)
3. `~\.claude\sessions\<pid>.json` shows `nameSource !== 'derived'` and a role-plus-task name;
   two concurrent sessions in one workspace have different names. (Req 2.1, 2.2.)
4. One `ptah_agent_message` per installed vendor; the reported mode matches that vendor's
   `ptah_agent_list` capability cell. (Req 5.2.)
5. A rival-CLI child calls `ptah_agent_report`; the message appears in the spawning session's
   chat labelled with the agent, and on that agent's tile. (Req 6.1, 6.4.)
6. Both tools appear on `tools/list` for the HTTP surface **and** the stdio surface.
   (Req 7.1, 7.2.)
- Also record the resolution of A0 (the `--settings` spawn-log line), A1 (peer origin survived
  the replay, or the contingency path was taken) and A2 (replay independent of the flag).

### Batch 8 verification

```bash
npm run typecheck:all
npm run lint:all
npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools @ptah-extension/shared @ptah-extension/rpc-handlers
npx nx run-many -t test -p @ptah-extension/chat-streaming @ptah-extension/chat
npx nx run-many -t test -p ptah-cli
```

- Read every `Running target test for N projects` header and confirm N is 5, 2 and 1.
- `test-report.md` records each of the six cases with its evidence, including the two that
  cannot pass without a live vendor installed — an uninstalled vendor is recorded as untested,
  never as passed.

---

## Batch 9: The user's session name reaches the registry name and the title — PENDING

Added 2026-09-12. Requirement 9.

- Requirement: task-description.md §9
- Recommended executor: `backend-developer` sub-agent
- Fallback executor: `claude` sub-agent
- Execution mode: sequential
- Rationale: two SDK surfaces carry a name and they are easy to confuse. One author
  must own both, or the registry name and the title drift apart and a peer reads one
  while the user reads the other.
- Tasks: 4 | Depends on: Batch 1
- **R-7: must NOT run concurrently with Batch 4 or Batch 5 — Batch 4 edits
  `libs/shared`, and task 9.1 adds a field to the same lib.**
- Files owned: `libs\shared\src\lib\types\ai-provider.types.ts`;
  `libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts` (+ its specs);
  `libs\backend\agent-sdk\src\lib\helpers\session-name.builder.ts` (+ spec);
  `libs\backend\agent-sdk\src\lib\session-metadata-store.ts`;
  the `rename` call path that reaches it.

### Task 9.1: `AISessionConfig` carries the name — PENDING

- Contract: `readonly sessionName?: string` on `AISessionConfig`, documented as the
  user-facing name and as OPTIONAL because a new tab has none yet.
- Do not reuse `tabId` for this. A tabId is a UUID v4 and identifies nothing to a human.

### Task 9.2: the registry name uses it, with a fallback — PENDING

- Depends on: 9.1
- File: `sdk-query-options-builder.ts`, `buildExtraArgs`.
- Contract: `role: sessionName ?? 'chat'`. `buildSessionName` already slugifies the
  role and already caps the head, so no new sanitising belongs here.
- The uniqueness suffix stays the LAST part. `buildSessionName` truncates the head
  only, and that rule is load-bearing — trimming the tail trades a long name for a
  colliding one.
- Spec rows required: a name with spaces and punctuation; a name that slugifies to
  nothing (falls back, session still starts, `warn` logged); a name long enough to
  force head truncation, asserting the suffix survives intact.

### Task 9.3: the session title carries the raw name — PENDING

- Depends on: 9.1
- Contract: `Options.title = sessionName` for a NEW session only. On resume the
  persisted title wins — the SDK says so at `sdk.d.ts:1871-1877` — so setting it
  there is a silent no-op and must not be written as if it works.
- The title is raw, not slugified. It is read by humans.

### Task 9.4: a UI rename follows through to the session title — PENDING

- Depends on: 9.3
- `SessionMetadataStore.rename` (`session-metadata-store.ts:1036`) is the existing
  chokepoint. The SDK's exported `renameSession(sessionId, title, options?)` is
  called from the path that owns it — NOT from the store, which must stay a
  metadata store with no SDK dependency.
- **The registry name does not follow a rename.** `--name` is fixed at spawn and no
  documented API changes it; `rename_session` sets the TITLE. Write this limit into
  the doc comment on `buildSessionName`, where the next reader will meet it.
- A failed `renameSession` is logged and swallowed. A rename is a convenience; it
  must never fail the user's rename in the UI.

### Batch 9 verification

```bash
npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/shared
npx nx run-many -t typecheck -p @ptah-extension/agent-sdk @ptah-extension/shared
```

- Confirm the `Running target test for N projects` header says 2.
- Then start a real session and read `~/.claude/sessions/<pid>.json`: `nameSource`
  must not be `derived`, and `name` must contain the slugified user name.

---

## Batch 10: Address another session by name — PENDING

Added 2026-09-12. Requirement 10.

- Requirement: task-description.md §10
- Recommended executor: `researcher-expert` for task 10.1, then `backend-developer`
- Execution mode: sequential
- Tasks: 3 | Depends on: Batches 1 and 9
- **BLOCKED until task 10.1 answers the mechanism question.** Do not write the
  transport before the measurement exists.

### The cited `research-report.md` does not exist — confirmed 2026-09-12

`task-description.md` cites `research-report.md` §1.1, §1.3, §3.1, §6, §7.7, §7.9 and
Appendices A1-A8 throughout. **That file is not in this folder, not in git history,
and not recoverable.**

This was checked properly, not assumed. The rest of this folder WAS recovered from the
orchestration session transcript, so the same method was tried here: every `Write`
tool call across every session transcript on this machine ending in
`research-report.md` was enumerated, and not one targets `TASK_2026_402_a5c7`.
`steering-research.md` was recovered because it was genuinely written to disk under
`TASK_2026_393`; this one never was. The appendices are REFERENCED 13 times in the
orchestration transcript and written nowhere.

What this does and does not cost:

- **Costs:** Appendices A5 and A6 (two measured message-loss incidents) and A8 (the
  `crossSessionInbound: 'accept'` fix landing on the first try) are now second-hand.
  They are the origin story of this task and cannot be re-read.
- **Does NOT cost:** the fix itself is independently verified.
  `sdk-query-options-builder.auto-compact-argv.spec.ts` runs the real pinned SDK and
  asserts `crossSessionInbound: "accept"` reaches the actual CLI argv. The premise is
  corroborated by evidence that still exists.

Treat any claim sourced only to `research-report.md` as unverified. Do not cite it as
though it can be checked.

### Task 10.1: establish how a turn is delivered — ANSWERED 2026-09-12, see `research-report-addressing.md`

- The SDK exports `listSessions()` and `renameSession()` but **no peer-send
  function**. Verified against the pinned `@anthropic-ai/claude-agent-sdk` 0.3.150
  `sdk.d.ts` on 2026-09-12.
- The registry record carries `messagingSocketPath` (a Windows named pipe here),
  `peerProtocol: 1` and `peerFeatures: ["notify_idle","artifact_yield"]`. That
  protocol is not public SDK surface.
- Deliverable: `research-report-addressing.md` in this folder, recording which route
  actually delivers a turn from Ptah's own process, measured, with the CLI and SDK
  versions it was measured at. Appendix A5 and A6 of this task are the reason the
  bar is delivery and not a `success: true` at the sender.
- If no route delivers, that is a valid answer and Batch 10 stops there.

### Task 10.2: a peer session list — PENDING

- Depends on: 10.1
- Built from the session registry, never from Ptah-side bookkeeping. Ptah does not
  know about sessions it did not start.
- A row states the human-readable name, the workspace, and whether it is reachable.
  An unreachable session is shown as unreachable, never omitted silently and never
  offered as if it works.
- The cross-workspace decision is made explicitly here and written down.

### Task 10.3: send, and report the outcome honestly — PENDING

- Depends on: 10.2
- The outcome distinguishes accepted-by-transport from delivered. Reporting the
  first as the second is the exact defect this whole task exists to fix.
- Any new RPC namespace needs BOTH `libs/shared/.../rpc.types.ts` and
  `ALLOWED_METHOD_PREFIXES` in `rpc-handler.ts:46`. The dual-registration rule is
  not optional.

### Batch 10 verification

- Two live sessions in one workspace. Send from one, and confirm the turn ARRIVES in
  the other — read the receiving session, do not trust the sender's return value.
- Repeat with the receiver stopped, and confirm the failure is reported as a failure.

---

## Batch 11: The peer-session picker — PENDING

Added 2026-09-12. Requirement 11. **Batch 10 shipped two RPC methods no human
can reach; this is the correction.**

- Requirement: task-description.md §11
- Recommended executor: `frontend-developer` sub-agent
- Execution mode: sequential
- Tasks: 3 | Depends on: Batch 10 (the RPC surface it calls)
- **R-8: file-disjoint from every remaining batch.** Batch 8 is an acceptance run
  and writes no source. Nothing else is open. This batch may run alone at any time.

### Task 11.1: a facade over the two RPC methods — PENDING

- File: CREATE `libs\frontend\core\src\lib\services\peer-session.facade.ts` (+ spec),
  exported from that lib's `src/index.ts`.
- Pattern to copy: `agent-discovery.facade.ts` in the same folder. It is the closest
  existing shape — a facade over an RPC namespace that returns a discovered list.
  Read it before writing a new one.
- Signals, not `BehaviorSubject`. `inject()`, not constructor params.
- The facade returns what the backend returned. It must NOT re-derive reachability,
  re-apply a workspace filter, or narrow `acceptanceCaveat` away. Every one of those
  decisions is already made and justified on the backend; making it twice is how the
  two answers drift.

### Task 11.2: the picker component — PENDING

- File: CREATE under `libs\frontend\ui\src\lib\native\peer-session-picker\`.
- Pattern to copy: `libs\frontend\ui\src\lib\native\provider-model-picker\` — the
  existing picker in this exact folder, built on the `dropdown` / `popover` / `option`
  primitives beside it. Do not introduce a new overlay mechanism; Floating-UI
  primitives are already the house style here.
- `ChangeDetectionStrategy.OnPush` is mandatory. Standalone component.
- An unreachable row renders disabled WITH its reason, never hidden (criterion 2).
- A cross-workspace row is visibly marked from `inCurrentWorkspace` (criterion 3).
- Refresh on open (criterion 6).

### Task 11.3: the send affordance and its honest result — PENDING

- Host surface: `libs\frontend\chat` — the orchestrator that owns a session's
  chrome. Confirm against `libs/frontend/chat/CLAUDE.md` before placing it; if the
  smart/dumb split puts the presentational half in `chat-ui`, follow that split
  rather than fighting it.
- **The result must read `accepted`, never `delivered`**, and `acceptanceCaveat`
  must be SHOWN, not logged (criterion 4). The backend makes this hard to get wrong
  — the field is required even on refusals — but a UI can still render a checkmark
  and the word "sent" over it, and that would rebuild the exact defect this task
  exists to fix.
- `costsATurn` and `modelMayDecline` are surfaced BEFORE the send (criterion 5).
- No `[innerHTML]` on any message text. Route through `libs/frontend/markdown` if
  it needs rendering at all — it is the single XSS chokepoint.

### Batch 11 verification

```bash
npx nx run-many -t test -p @ptah-extension/core @ptah-extension/ui @ptah-extension/chat --parallel=1
npx nx run-many -t typecheck -p @ptah-extension/core @ptah-extension/ui @ptah-extension/chat --parallel=1
```

- Read the `Running target test for N projects` header and confirm N is 3.
- A `visual-reviewer` pass is worth having here: this surface's whole job is telling
  a user something honest about a thing that may not have arrived, and that is a
  claim made in pixels, not in types.

---

## Execution order summary

| Wave | Batches | Mode | Note |
| --- | --- | --- | --- |
| 1 | Batch 1 (α) + Batch 2 (β) | parallel, two `backend-developer` sub-agents | **DONE** — `79c35a72d`, `586b1a400` |
| 2 | Batch 3 + Batch 6 | parallel: `backend-developer` + `frontend-developer` | Batch 6 pulled forward — it depends only on Batch 1, and the two are file-disjoint |
| 3 | Batch 4 | sequential | **never with Batch 5** (R-5) |
| 4 | Batch 5 | sequential | **never with Batch 4** (R-5) |
| 5 | Batch 7 | sequential (CLI lane) | needs Batch 5's final tool names |
| 6 | Batch 8 | sequential (`senior-tester`) | after all code is committed; also resolves A0's live spawn-log grep and A1 |

Added 2026-09-12:

| Wave | Batches | Mode | Note |
| --- | --- | --- | --- |
| 3b | Batch 9 | sequential | **never with Batch 4 or 5** (R-7) — all three touch `libs/shared` |
| 7 | Batch 10 task 10.1 | sequential (`researcher-expert`) | BLOCKING research; 10.2 and 10.3 do not start until it lands |
| 8 | Batch 10 tasks 10.2, 10.3 | sequential | only if 10.1 found a route that delivers |
