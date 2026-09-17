# Batch 4 report — TASK_2026_402_a5c7 (Components 6 and 7)

Executor: `backend-developer`. Worktree
`D:\projects\ptah-extension\.claude-worktrees\agent-messaging`, branch
`feat/agent-two-way-messaging`. Nothing committed, no stash, no checkout, no `nx reset`,
no edit to `batches.md`.

Status: **BATCH_4_DONE**. Tasks 4.1 – 4.6 implemented with real code — no stubs, no
`TODO`, no skipped or deleted assertions. One task (4.4) carries an open empirical
question that could not be settled without a running host; see **Validation note A1**.

---

## Files

### CREATED

- `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-report-router.service.ts`
  — `AgentReportRouter.deliver()`, the `<agent-report …>` envelope, the peer origin, the
  eight refusal reasons, and the size / burst / identical-repeat limits.
- `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-report-router.service.spec.ts`
  — 15 tests: the happy path (exactly one `sendMessageToSession`, exactly one tile
  segment, the peer origin), attribute escaping, one test per refusal reason, the cap
  boundary (at-cap accepted, cap+1 refused), the burst limit and its window expiry,
  identical-repeat suppression, per-agent keying, and "a refusal spends no burst budget".

### MODIFIED — `cli-agent-runtime`

- `...\cli-agents\cli-adapters\ptah-mcp-url.ts` — `ptahMcpServerUrl(port, workingDirectory, agentId?)`;
  leading `/agent/{encodeURIComponent(id)}`, terminal `/workspace/{root}`.
- `...\cli-agents\cli-adapters\ptah-mcp-url.spec.ts` — 4 new rows including the
  byte-for-byte "absent id changes nothing" row.
- `...\cli-agents\cli-adapters\cli-adapter.interface.ts` — `CliCommandOptions.agentId?: string`.
- `...\cli-agents\cli-adapters\codex-cli.adapter.ts`, `copilot-sdk.adapter.ts`,
  `cursor-cli.adapter.ts`, `opencode-cli.adapter.ts`, `antigravity-cli.adapter.ts`
  — each forwards `options.agentId` to `ptahMcpServerUrl`. `opencode`'s
  `buildMcpConfigContent` and `antigravity`'s `configureMcpServer` gained an `agentId?`
  parameter to carry it.
- the five matching adapter specs (`codex-cli.adapter.spec.ts`,
  `copilot-sdk.adapter.spec.ts`, `cursor-cli.adapter.spec.ts`,
  `opencode-cli.adapter.spec.ts`, `antigravity-cli.adapter.mcp.spec.ts`) — one new test
  each asserting the exact URL that adapter hands its vendor when an id was reserved. The
  pre-existing no-id rows are untouched and still green, which is the byte-for-byte
  guarantee.
- `...\cli-agents\agent-process-manager.service.ts` — `doSpawnSdk` passes its already-minted
  `agentId` into `runSdk`; `spawnFromSdkHandle`'s `meta` gains `agentId?: AgentId` and uses
  `meta.agentId ?? AgentId.create()`; three new public methods: `reserveAgentId()`,
  `findAgentInfo()`, `recordAgentNote()`.
- `...\ptah-cli\helpers\ptah-cli-spawn-options.service.ts` — `assembleSpawnOptions` gains a
  sixth `agentId?` parameter and threads it to `ptahMcpServerUrl`.
- `...\ptah-cli\ptah-cli-registry.ts` — `spawnAgent` options gain `agentId?`;
  `buildFlagSettings` → `buildFlagSettingsArg(..., 'accept', this.logger, ...)`; new
  `extraArgs` with `--name` from `buildSessionName` + `deriveWorkspaceLabel`.
- `...\ptah-cli\ptah-cli-registry-output-style.spec.ts` — settings capture now parses the
  serialized tier; 3 new tests (`crossSessionInbound: 'accept'`, the composed `--name`,
  and the no-id case).
- `...\ptah-cli\ptah-cli-registry-auto-compact-argv.spec.ts` — the four `toEqual` argv
  assertions now include `crossSessionInbound: 'accept'`, which is what the real argv
  carries after this change.
- `...\cli-agents\index.ts` — barrel exports `AgentReportRouter`, its four constants and
  its three types.
- `...\di\tokens.ts` — `CLI_AGENT_RUNTIME_TOKENS.AGENT_REPORT_ROUTER`.
- `...\di\register.ts` — registers `AgentReportRouter` as a singleton beside
  `AGENT_PROCESS_MANAGER`.

### MODIFIED — `vscode-lm-tools`

- `...\mcp-http\http-server.handler.ts` — new `extractCallerAgentId`; the workspace
  extractor grammar widened to `^(?:\/session\/[^/?]+|\/agent\/[^/?]+)?\/workspace\/([^/?]+)\/?(?:\?.*)?$`;
  `_callerAgentId` stamped beside `_callerSessionId`.
- `...\mcp-http\http-server.handler.spec.ts` — 7 new rows, including the two rejections
  (`/workspace/{root}/agent/{id}`, `/other/agent/{id}`) and `/agent/{id}/session/{id}`.
- `...\mcp-core\types\mcp-protocol.types.ts` — `MCPRequest._callerAgentId?: string`.
- `...\namespace-builders\agent-namespace.builder.ts` — `spawn` reserves the id once and
  passes it to BOTH `registry.spawnAgent` and `spawnFromSdkHandle`;
  `PtahCliRegistryLike.spawnAgent` options gain `agentId?`; `AgentNamespaceDependencies`
  gains the optional structural `deliverAgentReport?`.
- `...\namespace-builders\agent-namespace.builder.spec.ts` — the process-manager mock gains
  `reserveAgentId`, and the ptah-cli spawn test now asserts the SAME reserved id reached
  both call sites.
- `...\ptah-api-builder.service.ts` — optional `@inject(CLI_AGENT_RUNTIME_TOKENS.AGENT_REPORT_ROUTER)`;
  `deliverAgentReport` wired into the one `buildAgentNamespace` call, throwing a named
  error when the router is absent.
- `...\ptah-api-builder.service.spec.ts` — the mocked `cli-agent-runtime` barrel now
  carries `CLI_AGENT_RUNTIME_TOKENS` (the decorator dereferences it at class-definition
  time), and the hand-built constructor call gained the new positional argument.

Nothing outside `libs\backend\cli-agent-runtime` and `libs\backend\vscode-lm-tools` was
touched. `libs\shared` was NOT modified.

---

## Task 4.1 — the agent segment on the URL

`ptahMcpServerUrl(port, workingDirectory, agentId?)` →
`http://localhost:PORT/agent/{id}/workspace/{root}`. Agent segment leads, workspace
terminal. `encodeURIComponent` only, on both segments, so the `/sse` read-back rule the
file header describes still holds — pinned by the existing `cannot leak a literal /sse`
test and by a new row that encodes `a/b?c` as an agent id.

Three absence shapes, all pinned:

- no id → today's URL, byte for byte (asserted by comparing the two calls, not by
  restating the string).
- `''` → same as absent. An empty string is not an identity.
- id with no working directory → `/agent/{id}` alone, which the server's
  `extractCallerAgentId` still parses.

`ptahMcpUrl` in `ptah-mcp-slots.ts` was **not** touched: a persistent config entry belongs
to no agent. Its grammar is still a strict subset of the one the parser accepts.

## Task 4.2 — the server-side parse

`extractCallerAgentId` matches `^\/agent\/([^/?]+)` and decodes. `_callerAgentId` is
assigned in the same block as `_callerSessionId`, before `_callerWorkspaceRoot`.

The rejection rows asked for are present and they are true rejections, not half-parses:

| URL | `_callerAgentId` | `_callerWorkspaceRoot` |
| --- | --- | --- |
| `/agent/{id}/workspace/{root}` | `{id}` | `{root}` |
| `/agent/{id}` | `{id}` | `undefined` |
| `/workspace/{root}/agent/{id}` | `undefined` | `undefined` |
| `/other/agent/{id}` | `undefined` | `undefined` |
| `/agent/{id}/session/{id}` | `{id}` | `undefined` |

The last row is worth reading carefully. `extractCallerAgentId` is anchored at the START
only, so it still answers for `/agent/{id}/session/x` — correctly, because the agent
segment IS leading. What that URL does not get is a session id or a workspace root,
because the session segment is not leading and there is no terminal workspace segment. No
spawn produces that shape; the row exists so the behaviour is stated rather than assumed.

## Task 4.3 — the agent id through the six spawn paths

- **Rival CLIs** (`doSpawnSdk`): `AgentId.create()` already ran before `runSdk`, so the
  id is just added to the options object. One line.
- **Ptah CLI** (`spawnFromSdkHandle`): the handle — and therefore its MCP URL — exists
  before the old mint point, so the id is reserved by the caller.
  `buildAgentNamespace.spawn` calls `agentProcessManager.reserveAgentId()` once and hands
  the same value to `registry.spawnAgent({ agentId })` and to
  `spawnFromSdkHandle({ agentId })`. `reserveAgentId()` returns a branded `AgentId`, so a
  raw string cannot be substituted for it at either call site by accident.
- **Pi** is `supportsMcp = false`, so `resolveMcpPort()` returns `undefined`, every
  adapter's MCP block is skipped, and `pi-cli.adapter.ts` never calls `ptahMcpServerUrl`.
  Nothing there was edited and its specs are unchanged and green.

While in `ptah-cli-registry.ts` (the second consumption site Batch 1 left):

- `settings` now goes through `buildFlagSettingsArg(..., 'accept', this.logger, ...)`, so
  a spawned Ptah CLI agent asks the CLI to ACCEPT a peer-injected turn instead of holding
  it. Verified end to end by `ptah-cli-registry-auto-compact-argv.spec.ts`, which parses
  the REAL SDK argv — `crossSessionInbound: "accept"` is on `--settings` in every case.
- `extraArgs['name']` from `buildSessionName({ role: agentConfig.name, workspaceLabel:
  deriveWorkspaceLabel(cwd), uniqueSuffix: agentId.slice(0, 6) })`.

## Task 4.4 — `AgentReportRouter`

Contract as specified: `deliver({ agentId, message, summary? }) → { delivered, reason?,
parentSessionId? }`, envelope `<agent-report agent-id="…" agent="…" cli="…">`, origin
`{ kind: 'peer', from: 'ptah-agent:<id>', name: '<cli> · <label>' }` through
`IAgentAdapter.sendMessageToSession`. No new port, no new lib: `IAgentAdapter extends
IAIProvider`, so `isSessionActive` and `sendMessageToSession` both come off the one
`TOKENS.AGENT_ADAPTER` binding.

Check order — identity, size, attribution, liveness, volume — and the reasons:

| Reason | When |
| --- | --- |
| `unattributed-caller` | no `_callerAgentId`, or no tracked record under it |
| `report-too-large` | body > 1 048 576 chars (checked before any session state is read) |
| `no-parent-recorded` | no parent at spawn, **or** the recorded parent never resolved past a tab id |
| `chat-runtime-unavailable` | no `IAgentAdapter` registered in this host |
| `parent-session-not-active` | `isSessionActive` says no |
| `rate-limited` | 5 delivered reports already inside a 60 s sliding window |
| `duplicate-report` | byte-identical to a recent delivered body (bounded 8-entry ring) |
| `delivery-failed` | `sendMessageToSession` threw; the error's message is logged, not returned |

Every refusal logs at `warn` with its reason, because on the parent side a refused report
leaves no other trace. Every refusal writes **no** tile segment and spends **no** burst
budget — both pinned by tests, the second because otherwise an agent could lock itself out
by retrying into a refusal it could not fix.

Three deviations from the letter of the batch text, all named:

1. **`no-parent-recorded` also covers an unresolved parent.** `parentSessionId` holds the
   frontend tab id until `resolveParentSessionId` backfills the real uuid, so
   `SessionId.safeParse` is used instead of `SessionId.from` (which throws). A tab id
   means there is no session to deliver into, which is what that reason says. Calling it
   `parent-session-not-active` would have been misleading — the session is not inactive,
   it never existed under that id.
2. **Two reasons beyond the three the batch names** — `chat-runtime-unavailable` and
   `delivery-failed`. Both are states the previous list had no home for, and the rule
   "never reports a delivery it did not make" forbids folding either into `delivered:
   true`. Folding them into an existing reason would have made two different situations
   indistinguishable to the calling agent.
3. **The burst numbers are chosen, not measured.** The 1 048 576 body cap comes straight
   from the batch text. The Claude channel's burst window and queue depth are not stated
   anywhere in this task's documents and the CLI's own `cli.js` is extracted at runtime,
   so there was nothing in the repository to read them off. 5 per 60 s and an 8-entry
   repeat ring are the values I picked; 8 matches Batch 3's `MAX_PENDING_MESSAGES`, which
   is the nearest local precedent. All four are exported constants so a measured value can
   replace them in one place.

### Validation note A1 — which path I took, and what is still open

I implemented the **primary** path: the caller-supplied `origin` passed verbatim through
`sendMessageToSession`. I did **not** implement the `SessionInboundCallbackRegistry`
contingency, and I did not empirically settle the assumption, because doing so requires a
running host with a live chat session and a real spawned agent — not something a unit test
or a typecheck can answer.

What the repository does show, and what it does not:

- Batch 1 already wired both ends. `SdkAgentAdapter.sendMessageToSession` forwards
  `options.origin` verbatim (`sdk-agent-adapter.ts:952-967`), `sdk-message-factory.ts:148`
  puts it on the SDK user message, and `sdk-message-transformer.ts:207-225` reads it back
  through `resolveInboundPeerLabel` on both the live and the replay user-turn shapes. So
  the producer, the wire and the consumer all exist and agree.
- What is unproven is the middle: whether the CLI echoes the caller-supplied `origin` back
  on the replayed user message. Everything above it is mine; that hop is the vendor's.
- The observation point the batch names is already there and needs no new code: the
  transformer logs `'[SdkMessageTransformer] Rendering inbound peer message'` at `debug`
  with the resolved label the moment a peer turn is recognised. If that line appears with
  `label: '<cli> · <agent>'` after a real `ptah_agent_report`, the assumption holds. If it
  never appears, the contingency is needed — and per the plan only the producer changes:
  the tool contract, the shared type and the frontend stay as they are.

I am flagging this as the one thing in Batch 4 that a running build has to confirm.

## Task 4.5 — the tile segment

`AgentProcessManager.recordAgentNote(agentId, segment)` pushes onto the existing
`accumulateSegment` funnel, so the note rides the ordinary throttled `AgentOutputDelta`
flush and reaches the tile through `wiring\agent-events.ts` with no new event and no
frontend change. Unknown agent is a deliberate no-op: the only caller resolved the record
moments earlier and only writes after a successful delivery, so a record vanishing in
between is a lifecycle race, not a reporting failure.

The note is written **only** after `sendMessageToSession` resolves. Pinned twice: the
happy path asserts exactly one call, and both `delivery-failed` and every refusal assert
zero.

## Task 4.6 — DI registration and host wiring

`AGENT_REPORT_ROUTER` is registered inside `registerCliAgentRuntimeServices`, so it cannot
be present in one host and missing in another. The three host bootstraps that call it,
verified by reading each file:

1. `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\apps\ptah-extension-vscode\src\di\phase-2-libraries.ts:201`
2. `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\apps\ptah-electron\src\di\phase-2-libraries.ts:255`
3. `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\libs\backend\cli-engine\src\lib\container.ts:638`
   (the container `ptah-cli` and `ptah-tui` boot from)

**R-4 confirmed as corrected.** There is exactly one `buildAgentNamespace(...)` call —
`ptah-api-builder.service.ts:563` — behind the single `TOKENS.PTAH_API_BUILDER` singleton
registered at `vscode-lm-tools\src\lib\di\register.ts:81`. `deliverAgentReport` is wired
there once, with the lazy-closure shape `getPtahCliRegistry` already uses.

Absent wiring is a clear error, not a no-op: the closure throws
`'Agent reporting is unavailable: the CLI agent runtime is not registered in this host…'`
naming the fix. It is a throw rather than a `delivered: false` on purpose — a missing
registration is a host bug, not a state the calling agent can do anything about, and the
refusal reasons are reserved for states it can.

`AgentNamespace.report` was deliberately NOT added: `code-execution\types.ts` and the
`report` method are Batch 5's (Task 5.4), which will consume the `deliverAgentReport`
dependency this batch wired. R-5 respected — `tool-description.builder.ts`,
`protocol-dispatcher.ts`, `mcp-stdio\*` and `agent-rpc.handlers.ts` were not touched.

---

## Verification

Run from the worktree root. Full output read; no `| tail` masking an exit code.

```
npx nx run-many -t test -p @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools @ptah-extension/shared
  NX   Running target test for 3 projects       <- 3, as asked
  shared:           56 suites, 1375 tests passed
  cli-agent-runtime: 54 suites, 733 passed, 1 skipped (the skip is pre-existing)
  vscode-lm-tools:   46 suites, 1022 tests passed
  NX   Successfully ran target test for 3 projects
```

```
npx nx run-many -t typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools @ptah-extension/shared
  NX   Successfully ran target typecheck for 3 projects
```

```
npx nx run-many -t lint -p @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools
  cli-agent-runtime: 38 problems (0 errors, 38 warnings)
  vscode-lm-tools:   21 problems (0 errors, 21 warnings)
  NX   Successfully ran target lint for 2 projects
```

Every warning is pre-existing (`max-lines` on files that were already over, empty arrow
functions in older specs, non-null assertions in older specs). **No warning is in a file
this batch created**, and none of the three `max-lines` counts moved into warning range
because of this batch — `ptah-cli-registry.ts` was 1 076 lines and over the ceiling
before it.

Extra check, beyond the batch's list, because this batch changed two signatures that
downstream projects call:

```
npx nx run-many -t typecheck -p @ptah-extension/rpc-handlers @ptah-extension/cli-engine ptah-extension-vscode ptah-electron ptah-cli
  rpc-handlers        PASS
  cli-engine          PASS
  ptah-extension-vscode PASS
  ptah-cli            PASS
  ptah-electron       FAIL — PRE-EXISTING, unrelated
```

The `ptah-electron` failure is six `Cannot find name 'describe'` / `Cannot find namespace
'jest'` errors in `apps\ptah-electron\src\config\build-artifact-gate.ts`, a file this batch
does not touch (it is not in `git status`) and whose last commit is `941723f69`. It is a
missing `@types/jest` in that app's `tsconfig.app.json`, not a consequence of this work. I
am reporting it rather than fixing it: it is outside this batch's ownership.

### The batch's own acceptance checks

- `http-server.handler.spec.ts` green including both new rejection rows. ✔
- `agent-report-router.service.spec.ts` green: one test per refusal reason, the size cap
  (and its boundary), the burst limit, the repeat suppression, and a happy path asserting
  **exactly one** `sendMessageToSession` with the peer origin and **exactly one** tile
  segment. ✔
- One spec per adapter asserting the URL it hands its vendor — five adapters, five new
  tests, plus the five pre-existing no-id rows still passing. ✔

---

## Out-of-scope observations

1. **`agent-rpc.handlers.ts:873` resumes a Ptah CLI agent without reserving an id.** That
   path calls `registry.spawnAgent(...)` and then `spawnFromSdkHandle(...)` with no
   `agentId`, so a RESUMED Ptah CLI agent gets the pre-existing workspace-only MCP URL and
   will be an `unattributed-caller` to `ptah_agent_report`. That file is Batch 5's, so I
   left it alone. The fix is three lines, identical to the one in
   `agent-namespace.builder.ts`. **Batch 5 should take it**, or resumed agents silently
   lose the ability to report.
2. **`agent-process-manager.service.ts` is now ~2 300 lines** and `max-lines` flags it.
   Batch 3 already applied the facade rule once (`AgentMessageRouter`). This batch added
   three small public methods and did not split further, because the batch text did not
   ask for it and a second extraction mid-task would have collided with Batch 5.
3. **The `--name` composition for a spawn with no reserved id logs at `debug`, not
   `warn`.** See the deviation note below.

## Plan deviations

- **`reserveAgentId(): AgentId`, not `: string`.** The plan says `string`. `AgentProcessInfo.agentId`
  is the branded `AgentId`, so a plain `string` does not assign and the alternative was a
  cast at the assignment site. Branding the return instead makes the compiler enforce that
  the reserved id and the tracked record's id are the same kind of thing. `AgentId` is a
  `string` subtype, so every consumer that wanted a string still gets one.
- **Two new public methods on `AgentProcessManager` the batch did not name.**
  `findAgentInfo(agentId)` and `recordAgentNote(agentId, segment)`. `recordAgentNote` is
  named by Task 4.5. `findAgentInfo` is not, and I added it rather than reuse `getStatus`
  (workspace-scoped and throwing — it would reject the agent's own record and turn a
  refusal into an exception) or `listTrackedAgents` (whose own doc comment says it must
  never be reachable from the MCP tool surface).
- **`assembleSpawnOptions` gained a sixth positional parameter** rather than folding
  `agentId` into `PtahSpawnSessionContext`. That type is explicitly about session ids and
  its doc comment warns they are not interchangeable; an agent id is neither of them.
- **The "could not compose a session name" log is `debug` when no id was reserved and
  `warn` only when one was.** An absent id is a known caller shape (the resume path,
  observation 1 above) with nothing to be unique from — warning on it would fire on every
  resume and would have broken two existing specs that assert `logger.warn` is never
  called on a clean spawn. An id that WAS reserved and still produced no name is a real
  naming problem and still warns.
- **Four specs outside the batch's "Files owned" list were updated**, all because this
  batch's mandated changes made their assertions false. None was deleted or weakened:
  `ptah-cli-registry-output-style.spec.ts` (settings is now a serialized string — parsed,
  then 3 assertions added), `ptah-cli-registry-auto-compact-argv.spec.ts` (four `toEqual`
  sets grew `crossSessionInbound: 'accept'`, which the real argv now carries),
  `agent-namespace.builder.spec.ts` (Batch 5's file — the manager mock needed
  `reserveAgentId`; Batch 3 set the precedent of touching it for a compile fix, and the
  delegation assertion was strengthened, not relaxed), and
  `ptah-api-builder.service.spec.ts` (the mocked barrel needed `CLI_AGENT_RUNTIME_TOKENS`
  as a value, and the hand-built constructor call needed the new argument).

## Left undone

- **The A1 assumption is unsettled.** See the validation note under Task 4.4. It needs one
  run of a real spawned agent calling `ptah_agent_report` against a live chat session,
  watching for the `'[SdkMessageTransformer] Rendering inbound peer message'` debug line.
  Batch 5 puts the tool on both surfaces, which is the first point at which that run is
  possible.
- **The burst-limit numbers are unmeasured** (see Task 4.4 deviation 3).
- **`ptah_agent_report` is not reachable yet.** The router, the identity and the wiring
  exist; the tool, its schema and its dispatch are Batch 5.
