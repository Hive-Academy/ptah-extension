# TASK_2026_364 — review gate

Reviewer: review-gate session (Claude), with an independent Codex CLI review
(agent `58146cd4`, CLI session `01a07db4-9b68-7bc0-81e7-abf04c8225ca`).
Date: 2026-09-07. Read-only: no source file, no `task.md`, nothing but this
document was written.

Work under review is committed on `fix/empty-assistant-bubbles` as three
commits:

- `ece7ff623` feat(vscode-lm-tools): let an MCP caller state its workspace in the URL (Batches A + B)
- `3c2f3e569` fix(cli-agent-runtime): scope the agent registry to the calling workspace (Batch C)
- `a2c28d3a1` fix(vscode-lm-tools): refuse an anonymous MCP call in a multi-root window (Batch D)

---

## 1. Acceptance criteria

Criteria extracted from `task.md`, `context.md` §Scope, `implementation-plan.md`
§3 and §5, and `batches.md`.

| #   | Criterion                                                                                                                                   | Verdict     | Evidence                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1 | Request-scoped caller workspace identity: `callerWorkspaceRoot` on the ALS context, `/workspace/{encoded}` parsed off the URL, threaded into `runWithMcpRequestContext`, new tier 1 of the resolver, grammar pinned by a spec | **PARTIAL** | `mcp-request-context.ts:34,66`; `http-server.handler.ts:266-273`; `protocol-dispatcher.ts:175-181`; `workspace-root-resolver.ts:53-56`. Grammar pinned by `http-server.handler.spec.ts:452-536` incl. reversed-order rejection. Gap: `/session/{id}/workspace/{root}/extra` is illegal under the documented closed grammar but still yields a session-scoped parse (see M5). |
| AC2 | Every external consumer WRITES the scoped URL; `/workspace/...` still reads back as transport `http`                                          | **PARTIAL** | All six named consumers genuinely call it: `codex-cli.adapter.ts:591`, `cursor-cli.adapter.ts:316`, `copilot-sdk.adapter.ts:329`, `opencode-cli.adapter.ts:378`, `antigravity-cli.adapter.ts:367`, `ptah-cli-spawn-options.service.ts:177`; `.mcp.json` writer at `http-mcp-server.service.ts:710`. `/sse` hazard pinned on both twins (`ptah-mcp-slots.spec.ts:302,315,354`; `ptah-mcp-url.spec.ts:32`). Gap: a production bare URL remains — B3. |
| AC3 | Agent surface scoped through a `platform-core` port, dependency direction preserved, `normalizeWorkspaceRoot` moved, registered in two app roots and not the CLI host, no-registration fallback identical to before | **PARTIAL** | Port `caller-workspace-resolver.interface.ts`; token `platform-core/src/di/tokens.ts:107`; impl `mcp-caller-workspace-resolver.ts`; zero `vscode-lm-tools` imports in `cli-agent-runtime`; `apps/ptah-electron/src/activation/workspace-root-key.ts` gone, importers on `@ptah-extension/shared`; registered at `phase-2-libraries.ts:120` and `phase-3-storage.ts:151`, absent from `cli-engine/container.ts`; optional last ctor param `agent-process-manager.service.ts:319`. Gap: the fallback is NOT identical — B2. |
| AC4 | Anonymous MCP call + >1 folder open ⇒ refusal naming the folders; non-MCP callers untouched; single-folder and CLI hosts never see it; refusal reaches the caller | **PARTIAL** | Gate `isMcpRequestInFlight()` (`mcp-request-context.ts:81`), refusal `mcp-caller-workspace-resolver.ts:111-124`, propagated deliberately at `agent-process-manager.service.ts:1961-1967`, surfaced to the caller by `protocol-dispatcher.ts:190-200` as a JSON-RPC error carrying the message verbatim. Nine specs pin the non-refusal cases. Gap: it covers `spawn`/`status` only — `read`/`steer`/`stop` bypass resolution entirely (M1).                        |
| AC5 | The five verification cases of `implementation-plan.md` §5 are pinned by tests                                                                | **PARTIAL** | (3) `mcp-caller-workspace-resolver.spec.ts:154`; (4) `agent-process-manager.workspace-scope.spec.ts:202`; (5) `ptah-mcp-slots.spec.ts:354`. (1) and (2) are pinned compositionally, not as the plan specified: `agent-process-manager.workspace-scope.spec.ts:143` stubs the resolver and drives private `validateWorkingDirectory`, never a session map or `spawn()`; no test spans URL decode → resolver → spawn. |
| AC6 | Three composition roots still resolve; ctor change breaks no positional construction                                                          | **SATISFIED** | Optional last param with `= null` default (`agent-process-manager.service.ts:319-320`); positional call sites updated (`agent-process-manager.restore.spec.ts:59-70`, `.service.spec.ts:350,1884`, `workspace-scope.spec.ts:67`). Codex ran the three DI smoke specs in isolation: 24 / 6 / 4 tests, all pass.                                                          |

### Verification I ran myself

- `npx nx run-many -t test -p @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools @ptah-extension/shared @ptah-extension/platform-core --skip-nx-cache` → **all 4 projects green** (1254 / 658 / 534 / 1008 tests).
- `npx nx run-many -t test -p ptah-extension-vscode ptah-electron ptah-cli` → vscode and electron green; `ptah-cli` failed. Re-run alone reduced to **one** failure, `apps/ptah-cli/src/cli/output/formatter.spec.ts:100` (`expect(text).toMatch(/\x1b\[/)`). That is a TTY/colour-detection assertion, unrelated to this task; the other three failures in the first run were 154–195 s timeouts under load. **Not a TASK_2026_364 regression**, but the ptah-cli suite is environment-fragile.
- Working tree clean before and after (`git status --short` empty).

---

## 2. Codex raw verdict

`VERDICT: NEEDS_WORK`

Codex reported six findings — three "High" (internal `getStatus()` consumer
regressed; declared root is the working directory, not the containing folder;
`read`/`steer`/`stop` unscoped) and three "Medium" (URL grammar half-parse;
surviving bare one-shot MCP URL; shared normalizer folds case unconditionally).
It marked AC1–AC5 NOT SATISFIED and AC6 SATISFIED, and confirmed that the
refusal is production-reachable and is **not** swallowed anywhere.

---

## 3. My adjudication

I opened every file Codex named and confirmed the claim at the line before
carrying it. All six of its findings are mechanically real. I disagree with its
severity grading in three places and with several of its AC verdicts, which read
"NOT SATISFIED" for gaps I judge partial rather than absent.

| Codex claim                                                              | My check                                                                                                                                                                                                              | Carried as                    |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 1. `sdk-callbacks.ts` reads a now-filtered `getStatus()` outside MCP      | **CONFIRMED.** I found this independently before reading Codex's output. Its supporting detail is right: `resolveParentSessionId` at `:242` is unfiltered (`service.ts:902` walks the whole map), so only the re-persist is lost. | **B1 — blocker**              |
| 2. Resolver returns the declared *working directory*, not the open folder | **CONFIRMED** at `mcp-caller-workspace-resolver.ts:66` (`return declared;`). Real narrowing. But it is the documented, deliberate choice (the worktree case, pinned at spec `:85`), not an accident.                     | **M2 — medium, not blocking** |
| 3. `read` / `steer` / `stop` unscoped                                     | **CONFIRMED** — `service.ts:852, 957, 1126` read `this.agents.get(...)` directly. No batch report claimed otherwise, so it is not a false claim; it is an inconsistency the by-id error message actively misstates.       | **M1 — medium**               |
| 4. `/session/{id}/workspace/{root}/extra` half-parses                     | **CONFIRMED** — `extractCallerSessionId` (`:246`) has no terminality requirement while `extractCallerWorkspaceRoot` (`:272`) does. Degrading to session scope is safe, so this is cosmetic against the doc comment.        | **M5 — minor**                |
| 5. Bare one-shot MCP URL survives                                         | **CONFIRMED** at `sdk-query-runner.service.ts:501`, and `input.cwd` is in hand two calls up (`:381-386`). Codex cited `:497`; the literal is at `:501`.                                                                  | **B3 — blocker**              |
| 6. Shared `normalizeWorkspaceRoot` folds case unconditionally             | **CONFIRMED** — `workspace-root-key.ts:44-48` lowercases always, whereas `path-containment.ts:33` folds only on win32. Also no `path.resolve`, so a relative `workingDirectory` cannot match an absolute scope key.        | **M4 — medium**               |

**Claims I add that Codex missed.**

- **B2** — the "no registration ⇒ unchanged" contract is broken for `getStatus()`.
  `batch-c.report.md` states the unregistered path is "character-for-character
  the old resolution". That holds for `getWorkspaceRoot()` / `validateWorkingDirectory`,
  but **not** for the list form: `resolveScopedWorkspaceRoot()`
  (`service.ts:1961`) falls to `this.workspace.getWorkspaceRoot()` even with no
  resolver, so `getStatus()` (`:805-836`) now filters on the process-global root
  where it previously returned everything. Same root cause as B1.
- **M3** — `resolveSessionWorkspaceRoot()` in `ptah-api-builder.service.ts:835-843`
  passes `getCallerWorkspaceRoot` into the resolver **unvalidated**, while the
  agent path validates the declared root against the open folders with
  `isPathWithinRoots`. A stale `.mcp.json` therefore makes all 17 root-capable
  namespace sites resolve silently against a folder that is no longer open —
  the exact failure mode this task exists to close, left open on the path tools.
  `batch-d.report.md` flags this as deliberately out of scope; it is worth
  recording that the deferral was made after the tier was already shipped
  (Batch C wired it, `ptah-api-builder.service.ts:838`).

**Claims I soften.** Codex's AC1/AC2/AC3/AC5 "NOT SATISFIED" are too absolute.
Every named deliverable of each batch is present and tested; the failures are
one surviving consumer (AC2), one contract overclaim (AC3), one grammar edge
(AC1) and two tests that pin their case compositionally rather than end to end
(AC5). I record those as PARTIAL.

---

## 4. Blockers

### B1 — `getStatus()` filtering silently drops the non-active workspace's agents on the internal session-remap path

`libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts:237` and `:248`

```ts
const remappedAgentIds = new Set(
  (agentProcessManager.getStatus() as AgentProcessInfo[])
    .filter((a) => a.parentSessionId === tabId)
```

`remapAgentProcessManagerParents` is **not** an MCP call, so
`McpCallerWorkspaceResolver.resolveCallerWorkspaceRoot()` returns `undefined`
and `resolveScopedWorkspaceRoot()` (`agent-process-manager.service.ts:1961`)
falls to `this.workspace.getWorkspaceRoot()` — the process-global active folder.
`getStatus()` then filters to that folder (`:830-833`).

Failure: two workspaces open in Electron, the user has focused window B, and a
chat session in window A resolves its tab id to a real SDK session UUID.
`getStatus()` returns only B's agents, `remappedAgentIds` is empty, and the
early return at `:244` skips the `persistCliSessionReference` loop at `:260-268`
for every one of A's exited CLI agents. Their session references keep the
pre-resolution parent id, so on resume the agent cards reference ids the read
path cannot serve — the "agent went dark" failure this task was filed to close,
reintroduced on a different path. Nothing logs it.

Untestable today by construction: `sdk-callbacks.spec.ts:222` mocks
`getStatus: jest.fn(() => agents)`, so the filter never runs in that suite.

Fix shape: give the manager an explicitly unscoped internal accessor for
bookkeeping consumers, and leave the caller-scoped `getStatus()` to the MCP
surface.

### B2 — the "unregistered port ⇒ behaviour unchanged" contract does not hold for the list form

`libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:1961-1967`

```ts
private resolveScopedWorkspaceRoot(): string | undefined {
  return (
    this.callerWorkspaceResolver?.resolveCallerWorkspaceRoot() ??
    this.workspace.getWorkspaceRoot() ??
    undefined
  );
}
```

With no resolver registered — the CLI host, and every non-MCP caller in the two
app hosts — this still yields the provider root, and `getStatus()` filters on it
(`:805-836`). Before this task the list was unfiltered. `batch-c.report.md`
asserts the unregistered path is "character-for-character the old resolution",
which is true only of `getWorkspaceRoot()`. The task's own spec at
`agent-process-manager.workspace-scope.spec.ts:126` (`"getStatus() scoped by the
provider root hides nothing the provider owns"`) passes only because its seeded
agents all live under the provider root; the case that matters — an agent
outside it — is at `:133` and is asserted only for the `providerRoot: undefined`
host. B1 is the concrete consequence.

### B3 — a production Ptah MCP consumer still emits a bare, anonymous URL

`libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:501`

```ts
return {
  ptah: {
    type: 'http',
    url: `http://localhost:${port}`,
  },
};
```

`buildOneShotMcpServers` is called at `:381` from the same method that already
holds `input.cwd` and passes it to `buildOneShotHooks(input.cwd)` at `:386`. The
one-shot SDK query (`runOneShot`, `:237` — the engine behind `InternalQuery`,
used by skill-synthesis, agent-generation and the harness builder) therefore
reaches the MCP server anonymously, with `permissionMode: 'bypassPermissions'`.

Two consequences, both introduced or left open by this task:

1. AC2's "every external consumer" is false; its path-resolving tool calls still
   land on the process-global tier — the original defect, unfixed for this caller.
2. In a two-folder window its `ptah_agent_*` calls now hit the Batch D refusal
   and hard-fail, where before they merely answered for the wrong folder.

Fix shape: pass `input.cwd` through and build the URL with the same helper the
other six consumers use.

---

## 5. Non-blocking findings, recorded

- **M1** — `ptah_agent_read` / `steer` / `stop` are unscoped (`service.ts:852, 957, 1126`),
  so an anonymous caller in a two-folder window is refused for `status` but served
  for `read`. The by-id refusal text ("Ask again from its own workspace to read or
  manage it", `:818-822`) tells the caller something that is not true.
- **M2** — the declared root is the caller's **working directory**, and the
  resolver returns it verbatim (`mcp-caller-workspace-resolver.ts:66`) rather than
  the open folder that contains it. A CLI spawned in `repo/packages/a` can no
  longer spawn into `repo/packages/b`, and a git worktree placed **outside** the
  open folder is refused outright. Deliberate and documented, but a real narrowing
  that no report states as a cost.
- **M3** — `ptah-api-builder.service.ts:838` feeds the declared root into the
  namespace resolver with no open-folder validation, while the agent path
  validates. A stale `.mcp.json` silently points the path tools at a closed
  folder. `context.md` had recorded those 17 sites as "not a bug, verified"; this
  task changed them.
- **M4** — `libs/shared/src/lib/utils/workspace-root-key.ts:44-48` folds case
  unconditionally (`path-containment.ts:33` folds only on win32) and never
  resolves, so on a case-sensitive filesystem `/repo/Foo` and `/repo/foo` merge,
  and a relative or symlinked `workingDirectory` can hide an agent from its own
  owner.
- **M5** — `/session/{id}/workspace/{root}/extra` is outside the "CLOSED" grammar
  documented at `http-server.handler.ts:250-264` but is still parsed as
  session-scoped, because `extractCallerSessionId` (`:246`) has no terminality
  requirement. Safe degradation; the doc comment overstates the guarantee.
- **Doc drift** — `batch-c.report.md` says `apps/ptah-electron/src/activation/workspace-root-key.ts`
  was DELETED; commit `3c2f3e569` kept it as a re-export and TASK_2026_365 deleted
  it later. End state at HEAD is correct.
- **Environment** — `apps/ptah-cli/src/cli/output/formatter.spec.ts:100` asserts an
  ANSI escape and fails when stdout is not a TTY. Unrelated to this task, but it
  makes `nx test ptah-cli` unreliable as a gate signal.

---

## 6. Final verdict

**NEEDS_WORK.**

The task's headline promise is delivered and well tested: the caller can state
its workspace in the URL, the agent surface resolves caller → session →
provider through a clean `platform-core` port with the dependency direction
intact, the anonymous multi-root call is refused by name, and the refusal
reaches the caller as a real error instead of being swallowed. All four
libraries and the three composition roots are green.

It cannot move to done because scoping was applied to a **shared** method rather
than to the MCP surface, and one consumer was missed:

- **B1** turns a fix for silent misattribution into a new silent data loss on the
  internal session-remap path, in exactly the two-workspace scenario the task
  documents, with no test able to see it.
- **B2** is the contract violation that makes B1 possible, and it contradicts an
  explicit claim in `batch-c.report.md`.
- **B3** leaves a production MCP client anonymous while `input.cwd` sits in the
  same method, which both falsifies AC2 and hands that client a hard failure it
  did not have before.

M1–M5 should be recorded on the task (or split out) but do not need to block on
their own.
