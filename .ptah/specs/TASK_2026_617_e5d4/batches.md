# Batches - TASK_2026_617

Total tasks: 27 | Batches: 9 | Complete: 4/9

Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-617-grok-acp` (branch `feat/task-617-grok-acp`).
Every path below is absolute inside this worktree. Never touch the main checkout.
`ADP` = `D:\projects\ptah-extension\.claude-worktrees\task-617-grok-acp\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters`.

Plan: `implementation-plan.md` (Components 1-7), as amended by its final section
"Batch 0 results → plan amendments". Where they differ, the amendments win. Batch 0 (probes) is DONE:
`acp-batch0-probe.md` and `acp-batch0-fixtures/`.

Recorded defaults (the orchestrator's prompt and the plan fix the ordering, so no clarification was needed):
dependency order SDK → layer → runner → settings → union flip → adapter; one phase review after each phase;
no batch uses live grok.

## Pre-batch gate (orchestrator or team-leader, before Batch 1 starts)

- The worktree has **no `node_modules`**. Run `npm ci` in the worktree root before any verify command. Batch 1's
  executor may run it; it is not a git operation.
- The branch base `0b6686d15` is 38 commits behind `origin/main`. The upstream drift in plan-touched files is
  small (`agent-process.types.ts`: one doc comment; `agent-process-manager.service.ts`: unrelated). Merging
  `origin/main` is git work, so the team-leader owns it. Recommended: merge before Batch 8 (which edits shared
  types) and in any case before the PR. Not blocking for Batches 1-7.

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- A1 Ptah MCP works through `search_tool`/`use_tool`: verified (Batch 0 P1, `mcpToolCount: 59`, report delivered).
- A2 `allow_once` covers every gated request, MCP `use_tool` included: verified (P2, 3 requests).
- A3 `session/resume` restores context with no replay: verified (P2). `session/load` replays with `_meta.isReplay`.
- A4 Grok's real updates pass SDK zod validation: verified offline (P3, 6 transcripts, 0 errors). Re-proved in
  the repository by Task 3.2's fixture spec and Task 4.3's runner spec.
- A5 The ESM-only SDK loads in Jest (CJS) and in the VS Code, Electron, CLI and TUI bundles: unverified; checked
  by Task 1.1 (Jest) and Batch 2's builds. On failure, take Decision 1's fallback (moduleNameMapper for Jest, or
  the in-house client behind `AcpConnectionApi`) and report it. Do not redesign.
- SDK 1.7.0 exposes `setSessionConfigOption` (`dist/acp.d.ts:1142`) and `ResumeSessionRequest.mcpServers?`:
  verified from the npm tarball for this decomposition.
- `--reasoning-effort` on `grok agent stdio`: unverified (only `-m` was probed, and it is ignored). Not relied on:
  effort goes through `session/set_config_option {configId:"reasoning_effort"}` (amendment 4, Task 9.1).

| Risk                                                                                                                                                                                                                                                                                                                                                                                                  | Severity | Mitigation                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1 `CliAdapter.name` is typed `CliType` (`cli-adapter.interface.ts:190`), so `GrokCliAdapter` cannot compile before `'grok'` joins `SYSTEM_CLI_TYPES`. The plan's suggested order (Component 6 before 7) does not typecheck.                                                                                                                                                                          | HIGH     | Re-ordered: the union flip and its exhaustive consumers land in Batch 8; the adapter and its registration land in Batch 9. Batch 8 leaves `grok` in the union without an adapter for one commit. If an existing spec asserts that every `SYSTEM_CLI_TYPES` member has a registered adapter, Batches 8 and 9 merge into one (the executor reports it, and the team-leader re-scopes). |
| R2 The plan's Component 7 file list misses exhaustive consumers that break typecheck once `'grok'` joins the union: `cli-orchestration-matrix.component.ts:28` (`Record<SystemCliType>`), `cli-permission-notes.ts:23` (`Record<Exclude<CliType,'copilot'>>`), `chat-view.component.ts:91` (`Record<CliType, string>`). It also misses spec literals of `AgentListCliModelsResult` and per-CLI lists. | HIGH     | Added to Task 8.5 (production) and Task 8.6 (specs).                                                                                                                                                                                                                                                                                                                                 |
| R3 Batch 8 is an atomic exception to the 6-file / 2-lib limit: the union flip breaks every exhaustive site at once.                                                                                                                                                                                                                                                                                   | MEDIUM   | Everything movable was moved out: the `grokModel` key goes to Batches 5-7, the adapter and registration to Batch 9. One sequential executor and one multi-project verify.                                                                                                                                                                                                            |
| R4 Derived strings change: the spawn tool description, the system prompts (`ptah-system-prompt.constant.ts:244`, `ptah-core-prompt.ts:283`) and the ptah-cli `--cli` selector all derive from `SYSTEM_CLI_TYPES`. A measured byte or snapshot spec may shift.                                                                                                                                         | MEDIUM   | Batch 8 verify includes `@ptah-extension/vscode-lm-tools`, `@ptah-extension/agent-sdk` and `ptah-cli`. Task 8.6 updates the measurements with the real new values, never by loosening assertions.                                                                                                                                                                                    |
| R5 A reject ends the whole Grok turn (`cancelled` + `PermissionRejected`), not just one tool.                                                                                                                                                                                                                                                                                                         | MEDIUM   | Task 3.2 `mapStopReason` and Task 4.3 turn-local refusal tracking yield `done` 1 plus "permission refused for <title>". The default policy never rejects (allow-once), and `--always-approve` stays a fallback flag only.                                                                                                                                                            |
| R6 `-m` is ignored by `grok agent stdio`, so a configured model would be silently dropped.                                                                                                                                                                                                                                                                                                            | MEDIUM   | Tasks 4.3 and 9.1 apply the model via `session/set_config_option`. `-32602` fails the first turn with a named message. Task 9.2 pins that argv has no `-m`.                                                                                                                                                                                                                          |
| R7 A resumed session without `mcpServers` loses Ptah MCP.                                                                                                                                                                                                                                                                                                                                             | MEDIUM   | Task 4.3 passes the profile's `mcpServers` on `session/resume` too; the spec asserts it.                                                                                                                                                                                                                                                                                             |
| R8 Test-helper code under `src/` is compiled by `tsconfig.lib.json` (it includes `src/**/*.ts` and excludes only `*.spec.ts`/`*.test.ts`).                                                                                                                                                                                                                                                            | LOW      | Task 4.2: `fake-acp-agent.ts` uses no jest globals and no SDK runtime import, so the lib typecheck and the dependency-checks lint stay clean.                                                                                                                                                                                                                                        |
| R9 No live Grok is possible (the quota is exhausted for about 24 h).                                                                                                                                                                                                                                                                                                                                  | LOW      | Every batch uses fake peers and fixtures. Live verification (spawn, report, mid-turn message → next turn, stop, idle release → resume) moves to post-merge QA.                                                                                                                                                                                                                       |
| R10 The worktree has no `node_modules` and is 38 commits behind main.                                                                                                                                                                                                                                                                                                                                 | LOW      | Pre-batch gate above.                                                                                                                                                                                                                                                                                                                                                                |
| R11 The settings matrix renders one more row (Grok), so this is a UI change.                                                                                                                                                                                                                                                                                                                          | LOW      | Mode 3 requires before/after screenshots (dark and light) of the Orchestration matrix; the "before" comes from the base commit. Recorded for QA.                                                                                                                                                                                                                                     |

Edge cases:

- Permission rejected → `done` 1, a named error, not silent: Tasks 3.2 and 4.3.
- `allow_once` absent → `allow_always` plus an `info`; then `reject_once`; then `cancelled`: Task 3.3.
- Unknown model id (`-32602`) → failed first turn before any prompt: Tasks 4.3 and 9.1.
- Rate limited (`-32003`, data a string or an object) → failed turn; `retry_state` notifications are ignored: Tasks 4.3 and 9.1.
- Not signed in (`-32000` on `session/new`) → "Grok is not signed in…": Tasks 4.3 and 9.1.
- Resume unsupported or failing → `session/new` plus an `info`, with `resumeRestoresContext: false`: Task 4.3.
- `session/load` replay → drop updates whose `_meta.isReplay === true`: Task 4.3.
- Process exit mid-turn → `done` 1 plus "<displayName> exited (code N) during the turn"; exit while idle → the handle closes silently: Task 4.3.
- Handshake hang → a 30 s timeout, kill, `done` 1: Task 4.3.
- An exited pid is never returned by `getPid()`: Tasks 3.1 and 4.3.
- Non-JSON stdout or a stderr line over 64 KiB → no crash; truncated with a marker: Task 3.1.
- `session/update` never produces an `error` segment: Task 3.2.

## Batch 1: ACP SDK loader and library dependency wiring — COMPLETE (commit d9b964db0)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: a second backend-developer run that applies Decision 1's fallback
- Execution mode: sequential
- Rationale: the Jest/ESM interop needs judgement mid-flight (A5), and the loader and its config are coupled.
- Tasks: 2 | Depends on: pre-batch gate (`npm ci`)
- Phase: 1 (ACP layer) | Phase review: at the end of Batch 4

### Task 1.1: AcpSdkLoader, AcpConnectionApi and connectAcp — COMPLETE

- File: `ADP\acp\acp-sdk-loader.ts`, `ADP\acp\acp-sdk-loader.spec.ts`
- Plan reference: implementation-plan.md:165-219 (Decision 1, Component 1); amendment 4 (`setSessionConfigOption`)
- Pattern to follow: `ADP\codex-cli.adapter.ts:187-204` (cached string-literal dynamic import, successes only)
- Quality requirements: the only module with SDK runtime values; `import type` elsewhere; `AcpUnavailableError`
  with an actionable message; `ndJsonStream` with `maxMessageBytes` of 8 MiB.
- Validation notes: A5 (Jest). `AcpConnectionApi` = initialize, newSession, resumeSession, loadSession,
  setSessionConfigOption, prompt, cancel, plus the closed/close signal the runner needs.
- Implementation details: the spec loads the real SDK under Jest, and a second spec walks `ADP\acp\` and fails on
  any non-`import type` reference to `@agentclientprotocol/sdk` outside this file.

### Task 1.2: dependency and Jest wiring — COMPLETE

- Depends on: Task 1.1
- File: `D:\projects\ptah-extension\.claude-worktrees\task-617-grok-acp\package.json`, `...\package-lock.json`,
  `...\libs\backend\cli-agent-runtime\package.json`, `...\libs\backend\cli-agent-runtime\jest.config.ts`,
  `...\libs\backend\cli-agent-runtime\tsconfig.spec.json`
- Plan reference: implementation-plan.md:174-177, 209-219
- Pattern to follow: `libs\backend\tool-output-reducers\jest.config.ts:15-16` and its `tsconfig.spec.json` (`allowJs`)
- Quality requirements: pin `@agentclientprotocol/sdk` 1.7.0 (the version probed); install it with npm so the
  lockfile is regenerated, not hand-edited; `transformIgnorePatterns: ['node_modules/(?!@agentclientprotocol/)']`.
- Validation notes: zod 4.6.5 satisfies the peer range (plan row 76). The `@nx/dependency-checks` lint requires the
  library `package.json` entry.
- Implementation details: if Jest still cannot load it, apply Decision 1 fallback 1 (moduleNameMapper) and report.

### Batch 1 verification

- Every listed artifact exists and contains the required work.
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-agent-runtime` passes (output tailed).
- No per-batch review.
- A5 (Jest half) is proven by the loader spec.

### Batch 1 results (binding on Batches 3, 4 and 9)

Verified by the team-leader: the scoped `typecheck,test,lint` passed (`--skip-nx-cache`); the loader spec passed 9/9
on its own; the real ESM SDK loads under Jest through `transformIgnorePatterns` and `allowJs`, with no
moduleNameMapper fallback. A5 (Jest half) is proven.

Deviations from the plan, accepted:

- D1 `connectAcp(stream, handlers)` is **async** (`Promise<AcpConnectionApi>`) and calls `loadAcpSdk()` itself;
  it takes no SDK module argument. Callers `await connectAcp(...)` and handle `AcpUnavailableError` from it (the
  runner reports it as a failed turn, `done` 1). The exported surface is `loadAcpSdk`, `connectAcp`,
  `AcpConnectionApi` (with `signal: AbortSignal` and `closed: Promise<void>`), `AcpByteStream`
  (`{readable, writable}` seen from the client), `AcpClientHandlers` (= SDK `Client`), `AcpSdkModule`,
  `AcpUnavailableError` and `ACP_MAX_MESSAGE_BYTES`.
- D2 The SDK boundary check is the `SDK runtime import boundary` describe inside `acp-sdk-loader.spec.ts`, not a
  separate spec file. It walks every `.ts` file under `ADP\acp\` (specs, `__fixtures__` and `fake-acp-agent.ts`
  included) except the loader and its spec. It flags value imports, value re-exports, `import()`, `require()`,
  and the inline form `import { type X } from '@agentclientprotocol/sdk'`.

Rules that follow for Batch 3 and 4 executors:

- Reference the SDK only as `import type { X } from '@agentclientprotocol/sdk'` (or `export type { ... }`). Never
  write `import { type X }`; the boundary check fails on it.
- Specs and test helpers must not import SDK runtime values (no `ClientSideConnection`, `ndJsonStream`,
  `RequestError` or schemas). A spec that needs a real SDK connection gets one through `connectAcp(...)` over
  in-memory `TransformStream`s, as `acp-sdk-loader.spec.ts` does with its raw peer. Task 3.2's negative-control
  check of SDK zod validation ("Error handling notification") must also run through `connectAcp`, not through a
  direct schema import.
- Task 4.4's barrel re-exports the loader's surface listed in D1, with types re-exported as `export type`.

## Batch 2: host bundle externals for the ACP SDK — COMPLETE (commit 0ba619bcc)

- Recommended executor: devops-engineer (sub-agent)
- Fallback executor: backend-developer
- Execution mode: sequential
- Rationale: build and packaging config only, five one-line additions beside the `@openai/codex-sdk` precedent. It
  is one rollback unit across three apps (a justified exception to the 2-lib limit: the pattern is identical, and
  the A5 proof needs all hosts).
- Tasks: 3 | Depends on: Batch 1
- Phase: 1 | Phase review: at the end of Batch 4

### Task 2.1: Electron external plus dependency — COMPLETE

- File: `...\apps\ptah-electron\package.json`, `...\apps\ptah-electron\project.json`
- Plan reference: implementation-plan.md:169-172, 215-216
- Pattern to follow: `apps\ptah-electron\project.json:40`, `apps\ptah-electron\package.json:15`
- Quality requirements: the same version as the library; `validate-deps` must pass.
- Validation notes: TASK_2026_394 (an undeclared external breaks the published app).
- Implementation details: add it to the esbuild `external` array and to `dependencies`.

### Task 2.2: CLI external plus dependency — COMPLETE

- File: `...\apps\ptah-cli\package.json`, `...\apps\ptah-cli\project.json`
- Pattern to follow: `apps\ptah-cli\project.json:45`, `apps\ptah-cli\package.json:55`
- Same fields as Task 2.1.

### Task 2.3: TUI external — COMPLETE

- File: `...\apps\ptah-tui\project.json`
- Pattern to follow: `apps\ptah-tui\project.json:34` (external only; the TUI declares no codex dependency either)

### Batch 2 verification

- `npx nx run ptah-extension-vscode:build-esbuild`, `npx nx run ptah-electron:validate-deps`,
  `npx nx run ptah-cli:build-esbuild`, `npx nx run ptah-tui:build` all pass (output tailed).
- The SDK appears in each `external` array and, for Electron and CLI, in `dependencies` at exactly `1.7.0`.
- Re-scoped by the team-leader after Batch 1: the bundle half of A5 cannot be observed yet. No host entry point
  reaches `acp-sdk-loader.ts` until the adapter is registered in Batch 9, so esbuild drops it. During the Batch 1
  commit the pre-commit `ptah-electron:validate-deps` passed without listing the SDK. Batch 2 proves the config is
  in place and every build passes. The inlining and external checks move to Batch 9 verification. Do not add an
  import solely to force the SDK into a bundle.

### Batch 2 results

Verified by the team-leader: the five config edits are on disk as listed; `@agentclientprotocol/sdk` is `1.7.0` in
the root `package.json`, `libs\backend\cli-agent-runtime\package.json`, both app manifests, `package-lock.json` and
`node_modules`. The four verify targets passed (`--skip-nx-cache`, then a cached re-run with exit 0 each).
`validate-deps` lists the SDK under "in package.json but not detected in bundle", as expected until Batch 9.

## Batch 3: process transport, update mapper, permission policy — COMPLETE (commit 1b2ad5f30)

- Recommended executor: CLI lanes x 3, one per task
- Fallback executor: backend-developer (sub-agent), sequential
- Execution mode: parallel
- Rationale: three independent pure or leaf modules with disjoint files, no shared barrel (the barrel is Batch 4),
  each describable in one self-contained prompt.
- Binding constraints: "Batch 1 results" above (D1 async `connectAcp`, D2 boundary check, `import type` only, specs
  reach the SDK through `connectAcp`). Every lane prompt must copy those rules verbatim.
- Tasks: 3 | Depends on: Batch 1
- Phase: 1 | Phase review: at the end of Batch 4

### Task 3.1: AcpProcessTransport — COMPLETE

- File: `ADP\acp\acp-process-transport.ts`, `ADP\acp\acp-process-transport.spec.ts`
- Plan reference: implementation-plan.md:221-248
- Pattern to follow: `ADP\pi-cli.adapter.ts:321-349`, `:399`; `ADP\cli-adapter.utils.ts:93-130`, `:296-330`, `:673`
- Quality requirements: manual Node→Web stream bridge (no `Readable.toWeb`); write only while `stdin.writable`;
  `getPid()` live-only; idempotent `kill()`; every listener removed on exit; no timers.
- Validation notes: edge cases for oversized stderr and a spawn error (`exited` = `{code:null, signal:'error'}`).
- Implementation details: the spec uses a real `node -e` echo child; `killProcessTree` is mocked.

### Task 3.2: AcpSessionUpdateMapper plus mapStopReason plus fixtures — COMPLETE

- File: `ADP\acp\acp-session-update-mapper.ts`, `ADP\acp\acp-session-update-mapper.spec.ts`,
  `ADP\acp\__fixtures__\grok-*.ndjson` (11 files copied unchanged from
  `D:\projects\ptah-extension\.claude-worktrees\task-617-grok-acp\.ptah\specs\TASK_2026_617_e5d4\acp-batch0-fixtures\`)
- Plan reference: implementation-plan.md:250-277, 333-346; amendments 2, 5, 7
- Pattern to follow: segment type `libs\shared\src\lib\types\agent-process.types.ts:401-439`; the guard's tool names
  `libs\backend\cli-agent-runtime\src\lib\cli-agents\lane-budget-guard.ts:25-32`
- Quality requirements: pure and never throws; no update ever yields `error`; 64 KiB content cap. `mapStopReason`
  implements the stop-reason table plus the refused-permission row (`cancelled` + refused this turn + not aborted
  → 1 plus "permission refused for <title>").
- Validation notes: the fixtures are probe envelopes `{ms, dir, msg}`; unwrap `msg` where `dir === "in"`. Grep the
  copied fixtures for an unscrubbed home path or token before committing; report any hit instead of editing data.
- Implementation details: the fixture spec maps every inbound `session/update` and asserts the segment shapes,
  plus 0 SDK "Error handling notification" calls over the six transcripts named in amendment 7, with a negative
  control.

### Task 3.3: AcpPermissionPolicy — COMPLETE

- File: `ADP\acp\acp-permission-policy.ts`, `ADP\acp\acp-permission-policy.spec.ts`
- Plan reference: implementation-plan.md:279-301; amendment 2
- Pattern to follow: SDK `zPermissionOptionKind` and `RequestPermissionOutcome` shapes (plan lines 109-111)
- Quality requirements: select by `kind`, never by id. `autoApprove !== false`: allow_once → allow_always (+info)
  → reject_once → cancelled. `autoApprove === false`: reject_once → cancelled, plus an info naming the title.
  Return whether the answer refused, so the runner can track it.
- Validation notes: R5. The table-driven spec includes Grok's real option list
  (`always-allow`/`allow-once`/`reject-once`/`reject-always`) and an MCP `use_tool` request (kind `other`).

### Batch 3 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-agent-runtime` passes.
- Each lane report lists its files; the team-leader confirms the file disjointness.

### Batch 3 results (binding on Batch 4)

Executors: 3.1 the Glm ptah-cli lane, 3.2 a codex lane (effort high), 3.3 an opencode lane. 3.3 first started on
antigravity; that lane was stopped by user instruction before it wrote anything, and the same prompt was respawned
on opencode. Later lanes use opencode, never antigravity.

Verified by the team-leader: the files are disjoint, and nothing outside the batch's files changed. All 11 fixtures are
byte-identical to `acp-batch0-fixtures\` (`cmp`). Fixture scrub: the only `API_KEY` hit is the env-var name
`XAI_API_KEY` inside a skill description; there is no home path and no token. The scoped `typecheck,test,lint` passed
(`--skip-nx-cache`). The ACP specs ran 49/49: loader 9, transport 3, mapper 18, policy 19. The lanes' claimed counts
(12/27/28) were inflated, but the transport spec's 3 tests cover every required assertion.

Exported API that Batch 4 must consume, as shipped:

- `acp-process-transport.ts`: `spawnAcpProcess: AcpTransportFactory`, `AcpSpawnOptions {command, args, cwd, env?,
spawner?: IProcessSpawner, onStderrLine?}`, `AcpProcessTransport {stream: AcpByteStream, getPid(), exited:
Promise<AcpProcessExit>, kill()}`, `AcpProcessExit {code, signal}`. The factory returns synchronously, queues
  stdin writes until the async spawn resolves, and ends stdin when the SDK closes the writable.
- `acp-session-update-mapper.ts`: `createAcpSessionUpdateMapper({extractExitCode?})` → `{ map(update: SessionUpdate)
→ {output, segments} }` (keeps a per-instance tool-kind map, so one mapper per session);
  `mapStopReason({stopReason, aborted, refusedPermissionTitle?, displayName}) → {exitCode: 0|1, segment?}`.
- `acp-permission-policy.ts`: `decideAcpPermission(request, {autoApprove?}) → {response, refused, info?,
toolTitle?}`. The runner records `toolTitle` (or a fallback) when `refused` is true and feeds it to
  `mapStopReason` as `refusedPermissionTitle` for that turn only.

Known item for the Phase 1 review (not a check failure): in `acp-process-transport.ts`, `onChildError` settles `exited`
and closes the readable but does not run `detachListeners`; teardown relies on a `close` event that a failed spawn
may never emit (plan: "every listener removed on exit"). Also noted: the opencode lane reports that the P1
transcript has no `session/request_permission`, while P2 shows `ptah__ptah_agent_list` gated. This does not change
the policy.

## Batch 4: vendor profile contract, session runner, fake ACP peer — COMPLETE (commit eff0a4292; Phase 1 review fixes 6163b042e; reviews: code-logic-review.md APPROVED, code-style-rereview.md APPROVED)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh run with this section and the Batch 3 files
- Execution mode: sequential
- Rationale: the one stateful unit; the contract, runner, helper and barrel are tightly coupled.
- Binding constraints: "Batch 1 results" above. The runner awaits `connectAcp(...)` (D1) and maps
  `AcpUnavailableError` to a failed turn; the spec drives the fake agent through `connectAcp`, never an SDK import.
- Tasks: 4 | Depends on: Batches 1 and 3
- Phase: 1 (last batch) | Phase review: code-logic plus style (a new extension seam, `AcpVendorProfile`)

### Task 4.1: AcpVendorProfile contract — COMPLETE

- File: `ADP\acp\acp-vendor-profile.ts`
- Plan reference: implementation-plan.md:303-315; amendments 3, 4
- Quality requirements: data plus small functions only; `vendor: CliType`; `resumeStrategy: 'resume' | 'load' |
'resume-then-load' | 'none'`; add `sessionConfig?(options) → Array<{configId, value}>`; `buildSpawn` returns
  argv only.

### Task 4.2: fake ACP agent (test helper) — COMPLETE

- Depends on: Task 4.1
- File: `ADP\acp\__fixtures__\fake-acp-agent.ts`
- Plan reference: implementation-plan.md:386-402
- Quality requirements: a raw JSON-RPC peer over in-memory `TransformStream`s; scriptable: ext notifications,
  `isReplay` replay on load, permission requests, a held prompt, `cancelled` on cancel, close mid-turn, error
  replies (`-32003` with string and with object data, `-32000`, `-32602`), and an advertised `configOptions` list.
- Validation notes: R8. No jest globals and no SDK runtime import. The Batch 1 boundary check walks this file;
  use `import type { X }` only (see "Batch 1 results").

### Task 4.3: createAcpSessionHandle (the runner) — COMPLETE

- Depends on: Tasks 4.1 and 4.2
- File: `ADP\acp\acp-session-handle.ts`, `ADP\acp\acp-session-handle.spec.ts`
- Plan reference: implementation-plan.md:316-402; amendments 2-6
- Pattern to follow: `ADP\cursor-cli.adapter.ts:353-439` (handshake inside the first turn); `ADP\pi-cli.adapter.ts`
  (process handle); `cli-adapter.utils.ts:37-58`, `:533-559`
- Quality requirements: `done` never rejects. No `steer`, `interrupt` or `supportsInterrupt`. The handshake timer
  is the only timer. The model and effort config is applied after session setup and before the first prompt, only
  for advertised `configId`s. `mcpServers` is passed on resume. Policy refusals are tracked per turn and fed to
  `mapStopReason`.
- Validation notes: every edge case in this file's list that names Task 4.3; R6, R7.
- Implementation details: spec scenarios = the plan's list (lines 389-402) plus the refused permission → 1 with
  the named error; `set_config_option -32602` → 1 before any prompt; `-32003` with string and object data;
  `-32000` on `session/new`; resume carries `mcpServers`; load drops `isReplay` updates.

### Task 4.4: ACP folder barrel — COMPLETE

- Depends on: Task 4.3
- File: `ADP\acp\index.ts`
- Quality requirements: type exports plus `createAcpSessionHandle` and the loader's public surface; no SDK
  runtime re-export.

### Batch 4 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-agent-runtime` passes.
- After the commit: return NEEDS REVIEW for Phase 1 (Batches 1-4, code-logic plus style).

### Batch 4 results

Executor: backend-developer (sub-agent). One NOT ACCEPTED round: the scoped `typecheck,test,lint` passed, but the
pre-commit `nx affected -t lint` failed on `degradation-audit:lint`. The audit's `cli-agent-runtime` baseline is 0,
and the batch added 5 `promise-catch-sentinel` sites (`fake-acp-agent.ts:118,202,268`,
`acp-session-handle.ts:224,498`). A fresh backend-developer fixed all 5 by restructuring the code: no suppression
marker, no baseline edit. After the fix: the audit is clean, the scoped `typecheck,test,lint` passes, and the ACP
specs pass 84/84 (`acp-session-handle.spec.ts` 35) under `--detectOpenHandles`. Rule for later batches: run
`npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1` before handing back; the
scoped lint does not include it.

Deviations from the plan, accepted for now and listed for the Phase 1 review:

1. `buildSpawn(options)` returns argv only (`readonly string[]`, per this batch's own spec). The binary is passed
   separately as `AcpSessionHandleConfig.command`. **No `env` reaches the transport**, so the child inherits
   `process.env`. Batch 9 must confirm that Grok needs no per-lane env (`XAI_API_KEY` is inherited).
2. `describeError(failure: AcpRequestFailure)` gets `method`, `code`, `message`, `data`, `configId`,
   `configValue`, `advertisedValues` and `options`; `readAcpErrorDetail(data)` is exported for profiles.
3. A rejected model lists the advertised select values from `configOptions`, not
   `session/new.models.availableModels` (they match in the Grok fixture).
4. There is no `extMethod` handler. The SDK answers an unhandled agent request with `-32601` itself, and throwing a
   `RequestError` would need an SDK runtime import.
5. Every first-turn setup failure kills the child. A failed prompt (for example `-32003`) keeps the session open
   for the next message.
6. The runner kills the child when the ACP connection closes while the process is still alive.

### Phase 1 review — COMPLETE

- `code-logic-review.md`: APPROVED, 7/10, 0 blocking and 0 serious findings.
- `code-style-review.md`: REVISE, 7/10. A revise round followed, committed in `6163b042e`; the re-review in
  `code-style-rereview.md` is APPROVED, 8.5/10.
- The team-leader verified the revise round:
  - scoped `typecheck,test,lint` pass (`--skip-nx-cache`);
  - the degradation audit is clean;
  - the ACP specs pass 91/91.

The revise round supersedes Batch 4 deviation 1 and part of Task 9.1:

- `buildSpawn(options)` now returns `AcpSpawnSpec { args, env? }`. `spawnSpec.env` reaches the transport, which
  `spawnCli` merges over `process.env`.
- `alwaysApproveFlag` is **removed** from `AcpVendorProfile`. Task 9.1 builds argv without it: `['agent',
'--no-leader', 'stdio']`. The `--always-approve` fallback stays documented in the Grok profile file and is not
  wired.
- `isExtensionNotification` is now optional.
- `buildMcpServers` and `sessionConfig` return readonly arrays.
- `AcpSessionHandleConfig` and `AcpSpawnOptions` take an optional `logger`. The logger is imported as a type only
  from `@ptah-extension/vscode-core`, which goes against plan line 189 ("not even as a type"). The style re-review
  accepted it, with the codex and cursor adapters as precedent; the logic review did not object.
- New timing constants: `EXIT_DRAIN_GRACE_MS` (500 ms) and `ACP_CANCEL_GRACE_MS` (1.5 s).
- `tsconfig.lib.json` excludes `src/**/__fixtures__/**`.

Carried into Batch 9 (binding):

- Never log env values or argv; both may carry API keys. Log context stays limited to `command`, `pid` and
  `error.message` (style M2).
- The real Grok `describeError` wording for `-32003` (string and object data), `-32000` and `-32602` ("Grok
  rejected model '<m>' (from <modelSource>)" plus the advertised values) lands in the Grok profile, with a spec
  that uses the `grok-p3-*` fixture payloads. Phase 1 verified those rows only against a stub (logic review,
  Moderate).
- Optional minor: turn `onUnexpectedTurnError` in `acp-session-handle.ts` into a `const` defined above `continue`
  (style M1).
- Deferred to post-merge QA or a later task: stdin backpressure is ignored (logic Minor, `acp-process-transport.ts`).

## Batch 5: grokModel setting, part 1 — shared contract and file key — IN_PROGRESS

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh run
- Execution mode: sequential
- Rationale: additive optional fields that compile without `'grok'` in the union (User Decision 1).
- Tasks: 2 | Depends on: none (may run after Batch 4 for a clean phase boundary)
- Phase: 2 (Grok lane) | Phase review: at the end of Batch 9

### Task 5.1: shared RPC types — IN_PROGRESS

- File: `...\libs\shared\src\lib\types\rpc\rpc-auth.types.ts`, `...\libs\shared\src\lib\types\rpc\rpc-agents.types.ts`
- Plan reference: implementation-plan.md:462-477
- Pattern to follow: `rpc-auth.types.ts:461` (`agentOrchestration.antigravityModel`); `rpc-agents.types.ts:118`, `:231`
- Quality requirements: `grokModel?: string` on the config and set-config types; do **not** add `grok` to
  `AgentListCliModelsResult` here (that is Batch 8).

### Task 5.2: file settings key — IN_PROGRESS

- File: `...\libs\backend\platform-core\src\file-settings-keys.ts`
- Pattern to follow: `file-settings-keys.ts:193`, `:513`

### Batch 5 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/platform-core` passes.

## Batch 6: grokModel setting, part 2 — export list and RPC get/set — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh run
- Execution mode: sequential
- Tasks: 2 | Depends on: Batch 5
- Phase: 2 | Phase review: at the end of Batch 9

### Task 6.1: settings export list — PENDING

- File: `...\libs\backend\agent-sdk\src\lib\types\settings-export.types.ts`
- Pattern to follow: `settings-export.types.ts:77`

### Task 6.2: agent RPC get/set — PENDING

- File: `...\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.ts`
- Pattern to follow: `agent-rpc.handlers.ts:354`, `:525-526`
- Validation notes: write path for the Mode 3 trace: RPC set → `agentOrchestration.grokModel` → read by
  `MODEL_CONFIG_KEYS` (Batch 8) → `options.model` → profile `sessionConfig` (Batch 9).

### Batch 6 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers` passes.

## Batch 7: grokModel setting, part 3 — frontend settings state and fixtures — PENDING

- Recommended executor: frontend-developer (sub-agent)
- Fallback executor: backend-developer
- Execution mode: sequential
- Tasks: 2 | Depends on: Batch 5
- Phase: 2 | Phase review: at the end of Batch 9

### Task 7.1: providers settings state — PENDING

- File: `...\libs\frontend\core\src\lib\services\providers-settings.types.ts`,
  `...\libs\frontend\core\src\lib\services\providers-settings-state.service.ts`,
  `...\libs\frontend\core\src\lib\services\providers-commit.service.ts`
- Pattern to follow: `providers-settings.types.ts:68`, `providers-settings-state.service.ts:768`,
  `providers-commit.service.ts:193`
- Validation notes: the persisted-settings write path (Mode 3 trace); the existing state-service spec at `:2024`
  enumerates the model fields, so update it if it fails.

### Task 7.2: e2e harness settings fixture — PENDING

- File: `...\libs\frontend\webview-e2e-harness\src\lib\scenarios\settings\settings.fixtures.ts`
- Pattern to follow: `settings.fixtures.ts:176`

### Batch 7 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core @ptah-extension/webview-e2e-harness` passes.

## Batch 8: SYSTEM_CLI_TYPES gains 'grok', with every exhaustive consumer (atomic) — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer plus frontend-developer in sequence inside the same uncommitted batch
- Execution mode: sequential
- Rationale: one compile unit (R3). The frontend edits are registry rows. The adapter is registered in Batch 9 (R1).
- Tasks: 6 | Depends on: Batches 5-7 (the `grokModel` key must exist for `MODEL_CONFIG_KEYS` and the matrix row)
- Phase: 2 | Phase review: at the end of Batch 9

### Task 8.1: shared union and model-list result — PENDING

- File: `...\libs\shared\src\lib\types\agent-process.types.ts`, `...\libs\shared\src\lib\types\rpc\rpc-agents.types.ts`
- Plan reference: implementation-plan.md:457, 462-463
- Implementation details: `'grok'` appended to `SYSTEM_CLI_TYPES`; `grok: CliModelOption[]` added to
  `AgentListCliModelsResult`.

### Task 8.2: runtime spawn policy and model key — PENDING

- File: `...\libs\backend\cli-agent-runtime\src\lib\cli-agents\lane-spawn-policy.ts` (+ `lane-spawn-policy.spec.ts`),
  `...\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-spawn-environment.service.ts`
- Plan reference: implementation-plan.md:436-437, 460-461
- Implementation details: `mapEffortToGrok` (minimal→low, low|medium|high|xhigh kept, max→xhigh, else undefined)
  plus `case 'grok'`; `grok: 'grokModel'` in `MODEL_CONFIG_KEYS`; no effort key.

### Task 8.3: CLI model list — PENDING

- File: `...\libs\backend\rpc-handlers\src\lib\services\cli-model-list.service.ts` (+ its spec)
- Pattern to follow: `cli-model-list.service.ts:40-46`, `:74-84`

### Task 8.4: tribunal discovery and run — PENDING

- File: `...\libs\frontend\tribunal-panel\src\lib\services\tribunal-discovery.service.ts`,
  `...\libs\frontend\tribunal-panel\src\lib\services\tribunal-run.service.ts` (+ the discovery spec if it enumerates)
- Pattern to follow: `tribunal-discovery.service.ts:53-67`; `tribunal-run.service.ts:418-439`

### Task 8.5: chat settings rows and labels — PENDING

- File: `...\libs\frontend\chat\src\lib\settings\ptah-ai\cli-matrix-rows.ts`,
  `...\libs\frontend\chat\src\lib\settings\ptah-ai\cli-orchestration-matrix.component.ts`,
  `...\libs\frontend\chat\src\lib\settings\ptah-ai\cli-permission-notes.ts`,
  `...\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts`
- Plan reference: implementation-plan.md:467-468; R2
- Quality requirements: the matrix row `{ name: 'Grok', provider: 'xAI', modelKey: 'grokModel', effortKey: null }`
  plus `'grokModel'` in `CliModelSettingKey`. Install guide: `command: null`, and a note to put `grok` on PATH,
  sign in with `grok login`, then Re-detect (no invented install command). Permission note: badge 'Allow once',
  tone 'info', detail "Ptah answers each Grok permission request with allow-once; nothing is persisted.", and
  `'grok'` added to `PENDING_USER_REVIEW_IDS` (new copy, per the file's own convention). `CLI_LABELS` gets 'Grok'.

### Task 8.6: enumerating specs and derived measurements — PENDING

- File: the specs that fail on the flip, expected among:
  `chat\...\cli-matrix-rows.spec.ts`, `cli-orchestration-matrix.component.spec.ts`,
  `cli-model-effort-popover.component.spec.ts`, `agent-orchestration-config.component.spec.ts`,
  `core\...\providers-settings-state.service.spec.ts:504`,
  `skill-synthesis-ui\...\agent-model-editor.component.spec.ts:166`,
  `rpc-handlers\...\agent-rpc.handlers.resume-parent-session.spec.ts:709-718`, and any byte or snapshot
  measurement in vscode-lm-tools, agent-sdk or ptah-cli (R4)
- Quality requirements: add `grok` where a list enumerates CLIs; update measured values to the real new values;
  never weaken an assertion or skip a test.

### Batch 8 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers @ptah-extension/tribunal-panel @ptah-extension/chat @ptah-extension/core @ptah-extension/skill-synthesis-ui @ptah-extension/vscode-lm-tools @ptah-extension/agent-sdk ptah-cli` passes (output tailed).
- R1 check: report any spec requiring a registered adapter for every union member.

## Batch 9: Grok profile, GrokCliAdapter and registration — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh run
- Execution mode: sequential
- Rationale: the profile, adapter and registration are coupled, all in one library.
- Tasks: 3 | Depends on: Batches 4 and 8
- Phase: 2 (last batch) | Phase review: code-logic plus style (a new public adapter export and a new setting).
  The visual evidence for the matrix row is recorded for QA (R11).

### Task 9.1: GrokAcpProfile — PENDING

- File: `ADP\grok\grok-acp-profile.ts`, `ADP\grok\grok-acp-profile.spec.ts`
- Plan reference: implementation-plan.md:409-426; amendments 2-5
- Quality requirements: argv `['agent', ...(alwaysApproveFlag ? ['--always-approve'] : []), '--no-leader', 'stdio']`;
  `alwaysApproveFlag: false`; `resumeStrategy: 'resume'`; `buildMcpServers` (http entry when `mcpPort` is set, else
  `[]`); `sessionConfig` → model (`configId:"model"`) and effort (`configId:"reasoning_effort"`, via
  `mapEffortToGrok`); `isExtensionNotification` `/^_?x\.ai\//`; `describeError` covers `-32003` (string and object
  data), `-32000`, and `-32602` "unknown model id" with the model source.
- Validation notes: R6. The spec uses fixture error payloads from `grok-p3-*.ndjson`.

### Task 9.2: GrokCliAdapter — PENDING

- Depends on: Task 9.1
- File: `ADP\grok-cli.adapter.ts`, `ADP\grok-cli.adapter.spec.ts`
- Plan reference: implementation-plan.md:427-451; amendment 1
- Pattern to follow: `ADP\pi-cli.adapter.ts:150-261` (detect), `:166-197`
- Quality requirements: `supportsMcp: true`; `capabilities()` `{steer:false, interrupt:false, continuation:true}`;
  a `grok models` parser (8 s timeout, never throws); `ensureTokensFresh` (`~/.grok/auth.json` or `XAI_API_KEY`).
  The spec pins argv: `--no-leader` present, `stdio` last, no `--leader`, no `--always-approve`, no `-m`, no
  `--reasoning-effort`. A handle smoke test runs with the fake agent.

### Task 9.3: registration — PENDING

- Depends on: Task 9.2
- File: `ADP\index.ts`, `...\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-detection.service.ts` (+ its
  spec if it enumerates adapters)
- Pattern to follow: `cli-detection.service.ts:72-77`, `:242`
- Implementation details: export, register, the init log string, and `grok` in the `refreshCliTokens` list.

### Batch 9 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers ptah-cli` passes.
- A5 (bundle half, moved here from Batch 2): after `npx nx run ptah-extension-vscode:build-esbuild` the VS Code
  `main.mjs` inlines the SDK (grep for `ClientSideConnection`); `npx nx run ptah-electron:validate-deps` lists
  `@agentclientprotocol/sdk` as a detected and declared external; `npx nx run ptah-cli:build-esbuild` and
  `npx nx run ptah-tui:build` keep it external.
- After the commit: return NEEDS REVIEW for Phase 2 (Batches 5-9, code-logic plus style).

## Completion notes (for Mode 3)

- Parity: N/A (no surface replaced; one adapter added).
- Visual: before/after screenshots (dark and light) of the Orchestration CLI matrix; the "before" comes from the
  base commit (R11).
- Write-path trace: `grokModel` from the providers commit → `agent-rpc` set → `agentOrchestration.grokModel` →
  `MODEL_CONFIG_KEYS` → `options.model` → `session/set_config_option {configId:"model"}`.
- Deferred to post-merge QA (quota): live spawn, `ptah_agent_report`, mid-turn message → queued next turn, stop,
  idle release → `resume_session_id`.
