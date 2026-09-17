# Batch 5 report — TASK_2026_402_a5c7 (Component 10)

Executor: `backend-developer`. Worktree
`D:\projects\ptah-extension\.claude-worktrees\agent-messaging`, branch
`feat/agent-two-way-messaging`, on top of `3190973e0`. Nothing committed, no stash, no
checkout, no `nx reset`, no edit to `batches.md`.

Status: **BATCH_5_DONE**. Tasks 5.1 – 5.5 implemented with real code — no stubs, no
`TODO`, no skipped or deleted assertions. Both handed-over items from Batch 4 were taken,
and the second one turned out to hide a live defect in Batch 4's own router.

---

## Files

### MODIFIED — `vscode-lm-tools`

- `...\code-execution\mcp-core\tool-description.builder.ts` — `buildAgentSteerTool`
  DELETED; `buildAgentMessageTool()` and `buildAgentReportTool()` added, plus the shared
  `MAX_AGENT_MESSAGE_LENGTH`.
- `...\mcp-core\tool-description.builder.spec.ts` — 6 new tests: names, required-key
  sets, every mode enumerated, the `DISCARDED` warning, "no `agentId` property on
  `ptah_agent_report`", and a word-boundary vendor check over `SYSTEM_CLI_TYPES`.
- `...\mcp-core\protocol-dispatcher.ts` — `AgentMessageArgsSchema` / `AgentReportArgsSchema`
  (`.strict()`); `case 'ptah_agent_steer'` replaced by `ptah_agent_message` and
  `ptah_agent_report`; both tools added to `tools/list`; `AgentMessageError` narrowed with
  `instanceof` so its `code` reaches the caller.
- `...\mcp-core\protocol-dispatcher.spec.ts` — 6 new tests (see Task 5.5).
- `...\mcp-core\mcp-response-formatter.ts` — `formatAgentSteer` REPLACED by
  `formatAgentMessage` + `formatAgentReport`; `formatAgentList`'s Ptah CLI row now
  appends `messaging: <mode>`.
- `...\mcp-core\mcp-response-formatter-extra.spec.ts` — the two `formatAgentSteer` tests
  rewritten into 6 for the two new formatters.
- `...\mcp-core\mcp-response-formatter.spec.ts` — 2 new capability-cell tests.
- `...\mcp-stdio\tool-builders.ts` — `MCP_MVP_TOOL_NAMES` 7 → 8;
  `buildMcpAgentSteerTool` → `buildMcpAgentMessageTool` + `buildMcpAgentReportTool`.
- `...\mcp-stdio\index.ts` — barrel follows the rename and gains the report builder.
- `...\mcp-stdio\agent-tool.dispatcher.ts` — `AgentSteerSchema` replaced by
  `AgentMessageSchema` + `AgentReportSchema` (the same shapes the HTTP surface uses);
  `TOOL_NAMES` 6 → 7; `handleSteer` → `handleMessage` + `handleReport`; a fourth
  constructor parameter `callerAgentId`.
- `...\mcp-stdio\agent-tool.dispatcher.spec.ts` — 9 new tests.
- `...\mcp-stdio\stdio-mcp-server.service.ts` — reads `PTAH_MCP_HOST_AGENT_ID` and passes
  it to the dispatcher, mirroring the existing `PTAH_MCP_HOST_SESSION_ID` treatment.
- `...\mcp-stdio\stdio-mcp-server.service.spec.ts` — R-3: the file carries
  `agent_steer` and is not in the plan's list. Tool tuple updated, the steer routing test
  rewritten, and a new test that `agent_report` refuses with `unattributed-caller` when
  the transport named no agent.
- `...\code-execution\types.ts` — `AgentNamespace.steer` → `message(...)` returning
  `AgentMessageOutcome`; new `report(...)` returning `AgentReportDelivery`.
- `...\namespace-builders\agent-namespace.builder.ts` — `steer` → `message` (returns the
  outcome), new `report` backed by Batch 4's `deliverAgentReport`; that dependency's
  return type tightened from a structural `reason?: string` to `AgentReportDelivery`.
- `...\namespace-builders\agent-namespace.builder.spec.ts` — shape test updated, steer
  delegation test rewritten to assert the outcome is returned, 2 new `report` tests.
- `...\namespace-builders\system-namespace.builders.ts` — see "Plan deviations".

### MODIFIED — `rpc-handlers`

- `...\handlers\agent-rpc.handlers.ts` — **handed-over item 1**: `resumePtahCliSession`
  now reserves ONE agent id and passes it to both halves of the resume.
- `...\handlers\agent-rpc.handlers.resume-parent-session.spec.ts` — the process-manager
  mock gains `reserveAgentId`, plus a new regression test that the SAME reserved id
  reaches `registry.spawnAgent` and `spawnFromSdkHandle`.

### MODIFIED — `cli-agent-runtime`

- `...\cli-agents\agent-report-router.service.ts` — **handed-over item 2**: the limits are
  now MEASURED, and the burst counter was split from the identical-repeat ring.
- `...\cli-agents\agent-report-router.service.spec.ts` — 1 new regression test.

### MODIFIED — `apps/ptah-cli`

- `...\src\cli\commands\mcp-serve.spec.ts`,
  `...\src\cli\session\session-describe.builder.spec.ts`,
  `...\tests\e2e\mcp-serve.e2e.spec.ts` — R-3: the tool-name tuples and their lengths.
  The e2e case `mcp_agent_steer_free_cli` became `mcp_agent_message_free_cli` with the
  new argument shape; its license assertion is unchanged.

---

## Task 5.1 — the two tools replace `ptah_agent_steer`

`buildAgentSteerTool` is deleted. No alias survives on either surface, and no preset
allow-list entry was added here — `builtin-presets.ts` is Batch 7's Task 7.1, and it must
land or the preset silently blocks both new tools.

Neither description names a vendor. Both point the reader at `ptah_agent_list` for
capability, which is what Req 8.2 asks for and what keeps the description true on a
machine with a different CLI set. `vendor-roster-drift.spec.ts` is unmodified and green;
on top of it, the two new description tests assert no `SYSTEM_CLI_TYPES` member appears —
as a **word-boundary** match, not a substring, because `pi` is two letters and a substring
test would fire on ordinary English.

`ptah_agent_message`'s description spells out all four modes and says in capitals that
`interrupt-resume` DISCARDED the interrupted turn's work (R-11). `ptah_agent_report`'s
says it returns `"delivered": false` with a reason rather than a false success.

## Task 5.2 — strict schemas and dispatch

Both surfaces validate the identical shapes, following the `WebSearchArgsSchema` +
`describeZodIssues` + `toolErrorResponse` precedent:

```
AgentMessageSchema = { agentId: string.min(1), message: string.min(1).max(102_400) }.strict()
AgentReportSchema  = { message: string.min(1).max(1_048_576), summary: string.min(1).max(200)? }.strict()
```

`MAX_AGENT_REPORT_LENGTH` is imported from `cli-agent-runtime` rather than re-declared, so
the tool boundary and the router's enforcing check cannot drift.

`MAX_AGENT_MESSAGE_LENGTH` did not exist and had to be chosen. It is `100 * 1024`, the
same value as `MAX_TASK_LENGTH` on `agent_spawn` in the very same dispatcher — a message
to a live agent is the same kind of payload as the task it was started with. It is
exported from `tool-description.builder.ts` and consumed by both surfaces, so one edit
moves both.

**`strict()` is load-bearing here, not decoration.** The retired tool took an
`instruction` key, so a model working from stale guidance will send one. Non-strict, that
key would be dropped and `message` would fail `min(1)` — or worse, on a schema with a
default, the call would report a mode for a message that had no body. Rejected, it is a
one-line correction. Pinned on both surfaces.

**`ptah_agent_report` takes no `agentId`, and `strict()` is what enforces it.** A supplied
`agentId` is REJECTED, not ignored: ignoring it would silently convert an attempt to
report as another agent into a successful self-report, which is exactly the forgeable
identity the design refuses. The error text says so in words.

### The honest limit of `_callerAgentId`

Identity comes from `request._callerAgentId`, parsed by Batch 4 from the `/agent/{id}` URL
segment. As the doc comment on `extractCallerAgentId` states, the MCP HTTP server binds
localhost and checks no credential, so this closes the confused-deputy case — an agent
cannot name a different agent in its arguments — but it is **attribution, not
authentication**. Any same-user process that can reach the port can construct the URL. I
did not widen that claim anywhere in the code or the tool text.

### The stdio surface has no URL

The stdio server answers over a pipe, so there is no `/agent/{id}` segment to read. Rather
than invent an argument (which would reintroduce the forgeable id) or expose a tool that
can never work, `AgentToolDispatcher` takes a fourth constructor parameter and
`StdioMcpServerService` fills it from `PTAH_MCP_HOST_AGENT_ID` — the exact treatment the
file already gives `PTAH_MCP_HOST_SESSION_ID` three lines above, including the
set-but-empty-reads-as-absent rule. Same trust level: set by the launching process, not
settable by the calling model. Nothing sets that variable today, so on stdio
`agent_report` refuses with `unattributed-caller` — which is a true statement of the
situation, and is pinned by a test.

## Task 5.3 — response shapes and formatters

`ptah_agent_message` → `{ agentId, mode, detail? }`. `formatAgentMessage` prints the mode
AND a sentence per mode, because a bare `queue-next-turn` does not tell a model that its
message has not been read yet. `interrupt-resume`'s sentence is the R-11 warning;
`unsupported`'s says NOTHING was delivered.

`ptah_agent_report` → `{ delivered, reason?, parentSessionId? }`. The heading itself
differs — `Report Delivered` versus `Report NOT Delivered` — so a refusal cannot be
skim-read as a success.

`AgentMessageError` maps to `isError: true` with its `code` in the text on both surfaces,
so Batch 3's three states (`not_found`, `restored`, `not_running`) stay three different
next actions rather than one failure string. The stdio surface additionally puts the code
in `structuredContent.state`.

`formatAgentList`: the system-CLI cell was already `messaging: <mode>` (Batch 2). The Ptah
CLI row now appends the same field to its `provider: …, ptahCliId: …` cell, reading
`messagingMode` off the same `CliDetectionResult` the router reads — Req 5.2. The row set
is still `cliDetectionService.detectAll()`, so no uninstalled vendor is listed.

## Task 5.4 — namespace and the tool-name lists

`AgentNamespace.steer` is gone. `message` returns the outcome instead of `void`, which was
the whole point: a `Promise<void>` cannot carry "nothing was delivered".

`report` is backed by Batch 4's optional `deliverAgentReport`. Absent wiring **throws a
named error** rather than returning `delivered: false`. That distinction is deliberate: a
missing host registration is a bug the calling agent can do nothing about, while every
`reason` value is a state it can act on. Folding one into the other would teach a model to
retry a host misconfiguration.

Stdio tool tuple: **8, not 9.** The plan says 9. On disk the tuple was 7
(`agent_spawn|status|read|steer|stop|list` + `session_submit`), so removing one and adding
two gives 8. Verified by reading the file, and the count is asserted in four specs.

## Task 5.5 — spec sweep

- `tool-description.builder.spec.ts` — 6 new.
- `protocol-dispatcher.spec.ts` — 6 new: both tools on `tools/list` and
  `ptah_agent_steer` absent; delegation + mode rendering; the `instruction` rejection;
  identity taken from the URL; a supplied `agentId` rejected; `unattributed-caller` when
  the URL named none; a router refusal rendered as a refusal.
- `mcp-stdio\agent-tool.dispatcher.spec.ts` — 9 new, mirroring the HTTP set.
- `stdio-mcp-server.service.spec.ts` — tuple, routing, and the stdio refusal.
- `mcp-response-formatter*.spec.ts` — 8 new.
- `agent-namespace.builder.spec.ts` — shape + 3.
- `vendor-roster-drift.spec.ts` — **unmodified and green.**

---

## Handed-over item 1 — the resume path had no reserved id

Batch 4 called it a three-line fix. **The claim is correct**, and I verified it on disk
before acting rather than taking it on trust: `resumePtahCliSession`
(`agent-rpc.handlers.ts`) called `ptahCliRegistry.spawnAgent(...)` and then
`agentProcessManager.spawnFromSdkHandle(...)` with no `agentId`, so the handle — and the
MCP URL baked into it — existed before the record's id was minted. A resumed Ptah CLI
agent therefore got the workspace-only URL and would have been an `unattributed-caller` to
every `ptah_agent_report` it made, silently, on both sides.

Both receiving parameters already exist (Batch 4 added `agentId?` to the registry's spawn
options and `agentId?: AgentId` to `spawnFromSdkHandle`'s meta), so the fix is one
`reserveAgentId()` call and two argument additions. It is pinned by a new test that
asserts the same reserved value reaches both call sites — the one assertion that would
have caught the omission.

## Handed-over item 2 — the burst limits, and the defect they were hiding

**The values are now measured, and Batch 4's honesty about them was worth the trouble.**

Batch 4 could not read the Claude channel's limits because the CLI is a bun-compiled
native binary and `@anthropic-ai/claude-agent-sdk` carries no `crossSessionInbound`
literal at all (confirmed: `grep -c` returns 0 in both `sdk.mjs` and `sdk.d.ts`). It is
readable anyway — the JS bundle sits as plain text inside the executable. Read off
`~/.local/share/claude/versions/2.1.268`:

```
{ bucketCapacity: 30, refillPerSecond: 0.5, dedupWindowMs: 30000,
  maxSelfHops: 10, maxChainLength: 28, maxTrackedSenders: 256 }
```

with the size check `if (framedLength > 1048576) throw messageTooLarge`, and the matching
user-facing strings `sender exceeded the peer message rate limit`, `identical to the
previous message from this sender` and `cross-session message exceeds the line cap`. The
measurement procedure is recorded in a comment above the constants so it can be repeated.

What changed:

| Constant | Batch 4 | Now | Basis |
| --- | --- | --- | --- |
| `MAX_AGENT_REPORT_LENGTH` | 1 048 576 | 1 048 576 | **confirmed** — the literal in the CLI's own size check |
| `AGENT_REPORT_BURST_LIMIT` | 5 (chosen) | **30** (measured) | `bucketCapacity: 30`, `refillPerSecond: 0.5` = 30 per 60 s sustained |
| `AGENT_REPORT_BURST_WINDOW_MS` | 60 000 | 60 000 | unchanged; it is the denominator that makes the above true |
| `AGENT_REPORT_HISTORY_SIZE` | 8 (chosen) | **8, deliberately kept** | see below |

Two honest caveats, both written into the code:

1. Claude's guard is a **token bucket** (burst 30, then one every two seconds); this
   router is a **sliding window** (30, then nothing until the window clears). Identical
   sustained rate, identical burst ceiling, different recovery curve. Adopting a second
   rate-limiter shape would be a larger change than the accuracy is worth, so the
   difference is recorded rather than removed.
2. `AGENT_REPORT_HISTORY_SIZE` is left at 8 and is now documented as **deliberately
   stricter** than the channel. Claude compares against the single immediately-previous
   body within 30 s — its own refusal string says "identical to the PREVIOUS message". An
   8-entry ring also catches an A-B-A alternation, which is the shape a stuck agent
   actually produces. Loosening a real protection to match a symmetry nothing needs would
   be the wrong trade.

### The defect raising the limit exposed

Raising the limit from 5 to 30 made a latent bug reachable: **the burst counter and the
identical-repeat ring were the same list.** `recentEntries()` read `this.history`, which
`remember()` truncates to `AGENT_REPORT_HISTORY_SIZE` (8) on every write. So
`recent.length` could never exceed 8 and **any burst limit above 8 could never fire** — at
30, the rate limit would have been dead code that looked live and was pinned by a test
that only ever exercised 5.

Fixed by giving the two concerns two structures: `burstTimestamps` (numbers, pruned by the
window) and `recentBodies` (the 8-entry body ring). That is also strictly better for
memory: bodies are capped at 1 MiB each, and only the ring holds bodies now. A new
regression test asserts `AGENT_REPORT_BURST_LIMIT > AGENT_REPORT_HISTORY_SIZE` and that
`HISTORY_SIZE + 2` deliveries all count against the budget — the assertion that would have
caught it.

This is an edit to a Batch 4 file. I made it because the orchestrator's brief explicitly
handed me these constants, and because changing the number without changing the structure
would have shipped a rate limit that does nothing.

---

## Verification

Run from the worktree root. Full output read from files; no `| tail` masking an exit code.

### Typecheck — clean

```
npx nx run-many -t typecheck -p @ptah-extension/vscode-lm-tools @ptah-extension/rpc-handlers ptah-cli
  NX   Running target typecheck for 3 projects     <- 3, as asked
  NX   Successfully ran target typecheck for 3 projects
  (exit 0)

npx nx run-many -t typecheck -p @ptah-extension/cli-agent-runtime   # re-run after the router edit
  NX   Successfully ran target typecheck for project @ptah-extension/cli-agent-runtime
  (exit 0)
```

### Tests

```
npx nx run-many -t test -p @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools @ptah-extension/rpc-handlers
  NX   Running target test for 3 projects          <- 3, as asked
  vscode-lm-tools     46 suites, 1053 tests passed, 0 failed
  cli-agent-runtime   54 suites, 733 passed, 1 skipped, 1 FAILED
  rpc-handlers        94 suites, 2723 passed, 31 skipped, 2 FAILED
  exit 1
```

Three failures, none in a file this batch touches, all of them wall-clock:

| Suite | Assertion | Why |
| --- | --- | --- |
| `agent-process-manager.service.spec.ts` | `elapsedMs < 500`, got 623 | a perf budget, measured while three nx runs shared the machine |
| `voice-rpc.handlers.spec.ts` | 5 s jest timeout | real `os.tmpdir()` I/O |
| `setup-rpc.handlers.spec.ts` | 5 s jest timeout | makes a REAL network call — the log line is `Request timeout for https://raw.githubusercontent.com/.../agent-pack-manifest.json` |

Re-run on a quiet machine, both projects are fully green:

```
npx nx test @ptah-extension/cli-agent-runtime --skip-nx-cache
  54 suites passed, 734 passed, 1 skipped, 0 failed      (exit 0)

npx nx test @ptah-extension/rpc-handlers --skip-nx-cache --runInBand
  94 suites passed, 2725 passed, 31 skipped, 0 failed    (exit 0)
```

(An intermediate parallel re-run of `rpc-handlers` failed a DIFFERENT suite —
`skills-sh-legacy-adoption.spec.ts`, again a 5 s timeout on real filesystem work. A
different suite failing each time, and all of them green serially, is what identifies
these as worker-contention flakes rather than regressions. The 31 skips are pre-existing.)

### `ptah-cli` — the nx target cannot run in this worktree

```
npx nx run-many -t test -p ptah-cli
  ptah-cli:copy-wasm FAILED
  WASM file not found: D:\...\.claude-worktrees\agent-messaging\node_modules\web-tree-sitter\web-tree-sitter.wasm
  exit 130 — ptah-cli:test never ran
```

**This is a pre-existing worktree limitation, not a Batch 5 regression.** The worktree has
**no `node_modules` directory at all** (`ls node_modules` → No such file or directory);
every package resolves upward to `D:\projects\ptah-extension\node_modules`. `copy-wasm`
builds its source path from the workspace root, so in a worktree it looks in a directory
that does not exist. `ptah-cli:test` `dependsOn` it, so the target is blocked before any
test runs. Nothing in this batch touches that script, and `ptah-cli:typecheck` passes.

Run directly against the same jest config, bypassing the blocked build chain:

```
npx jest --config apps/ptah-cli/jest.config.cjs --runInBand --testPathPatterns "(mcp-serve|session-describe)"
  Test Suites: 2 passed, 2 total
  Tests:       27 passed, 27 total                       (exit 0)
```

The full unit suite, same way:

```
npx jest --config apps/ptah-cli/jest.config.cjs --runInBand
  Test Suites: 65 passed, 1 failed, 1 skipped, 67 total
  Tests:       981 passed, 4 failed, 3 skipped, 988 total
```

The 4 failures are one suite and they are all the same guard, all explained by the
bypass: `build-embedder-worker`/`build-integrity-worker` "requires a build -- run
`nx run ptah-cli:build-embedder-worker`". Running jest directly skips the `dependsOn`
build chain, which is exactly the chain `copy-wasm` blocks. They are not code failures and
they are not this batch's — no assertion about agent messaging is among them.

`apps\ptah-cli\tests\e2e\mcp-serve.e2e.spec.ts` is NOT reached by the `test` target — it
belongs to the separate `e2e` target (`jest.e2e.config.cjs`), which is not in this batch's
verification list and needs live CLI vendors. Its tool tuple and the renamed
`mcp_agent_message_free_cli` case were updated and typecheck cleanly, but **they have not
been executed**. Recorded as untested, not as passed.

### Lint

```
npx nx run-many -t lint -p @ptah-extension/vscode-lm-tools @ptah-extension/rpc-handlers @ptah-extension/cli-agent-runtime
  NX   Running target lint for 3 projects
  cli-agent-runtime   38 problems (0 errors, 38 warnings)
  vscode-lm-tools     21 problems (0 errors, 21 warnings)
  rpc-handlers        19 problems (0 errors, 19 warnings)
  NX   Successfully ran target lint for 3 projects       (exit 0)
```

Zero errors. `cli-agent-runtime` 38 and `vscode-lm-tools` 21 are the **identical counts
Batch 4 reported**, so this batch added no warning to either. Four warned files are ones
this batch edited, and every warning is pre-existing in kind:

| File | Warning | Line count at HEAD → now |
| --- | --- | --- |
| `mcp-response-formatter.ts` | two `no-explicit-any`, at `:86` and `:287` | pre-existing `json2md` block types, untouched |
| `protocol-dispatcher.ts` | `max-lines` | 2 026 → 2 132 |
| `tool-description.builder.ts` | `max-lines` | 1 739 → 1 794 |
| `agent-rpc.handlers.ts` | `max-lines` | 1 047 → 1 058 |

All three `max-lines` files were already far past the 700-line soft ceiling before this
batch; none crossed it because of this work. `agent-report-router.service.ts` grew 325 →
407 and stays well under. No file created by this batch is warned.

### The batch's own acceptance checks

- `vendor-roster-drift.spec.ts` green **without modification**. ✔
- Both tools present on BOTH surfaces' tool lists, each pinned by its own test. ✔
- Grep `libs\backend\vscode-lm-tools` and `apps\ptah-cli` for `ptah_agent_steer` /
  `agent_steer`: **zero live references.** Five textual hits remain and all five are
  deliberate:
  - `ptah-system-prompt.constant.ts:228` — Batch 7's file, as the batch text allows.
  - three doc comments explaining why the new schemas are `strict()` (they name the
    retired tool as the reason a stale `instruction` key shows up).
  - one spec assertion, `expect(names).not.toContain('ptah_agent_steer')`.
  - `apps\ptah-cli\docs\jsonrpc-schema.md:506` — a prose doc, Batch 7's file list.

---

## Plan deviations

- **The stdio tool tuple is 8, not the plan's 9.** Counted on disk; see Task 5.4.
- **`MAX_AGENT_MESSAGE_LENGTH` had to be chosen** (the plan names the symbol but no
  value). `100 * 1024`, matching `MAX_TASK_LENGTH` in the same file. Stated rather than
  quietly picked.
- **`system-namespace.builders.ts` was edited** — two lines, and it is in no batch's file
  list. `HELP_DOCS` documented `ptah.agent.steer(agentId, instruction)` as a live method.
  Renaming the namespace method without it leaves an agent-facing API document describing
  a method that no longer exists, so a code-execution call to `ptah.agent.steer(...)`
  fails at runtime for a reason the document caused. Batch 7's grep does not catch it (the
  text is `steer(`, not `agent_steer`). I replaced it with `message` and `report` and am
  reporting it rather than leaving a doc that breaks calls. Batch 2 had already touched
  this file for a compile fix, so the precedent exists.
- **`AgentNamespaceDependencies.deliverAgentReport`'s return type was tightened** from the
  structural `{ delivered; reason?: string; parentSessionId? }` to `AgentReportDelivery`.
  Required: the namespace method returns the closed-union type, and a `string` reason does
  not assign to it. The alternative was widening `AgentNamespace.report`, which would have
  let a caller invent a refusal reason no test covers. Still a type-only import.
- **`agent-report-router.service.ts` (+ spec) was edited** — a Batch 4 file. See
  "Handed-over item 2"; the orchestrator's brief assigned these constants to this batch,
  and the number could not be corrected without also correcting the structure.
- **Four specs outside the named list were touched, each because this batch made an
  assertion false**: `stdio-mcp-server.service.spec.ts` (R-3 names it),
  `mcp-response-formatter.spec.ts` and `-extra.spec.ts` (the deleted formatter),
  `agent-rpc.handlers.resume-parent-session.spec.ts` (its mock manager needed
  `reserveAgentId`). None was deleted or weakened; each gained assertions.
- **`agent-tool.dispatcher.spec.ts` gained `import 'reflect-metadata'`.** Its subject now
  value-imports `@ptah-extension/cli-agent-runtime` for the `AgentMessageError`
  `instanceof` narrowing, and that barrel reaches tsyringe decorators on import. Same
  line, same reason, as the one at the top of `vendor-roster-drift.spec.ts`.

## Out-of-scope observations

1. **`apps\ptah-extension-vscode\assets\harnesses\tribunal-conductor.json:36` still lists
   `ptah_agent_steer`** in an `enabledTools` allow-list. It is in **no batch's file list** —
   Batch 7 owns `builtin-presets.ts` and the markdown, not this asset. Left alone, the
   tribunal-conductor harness silently blocks both new tools, which is the same invisible
   failure Task 7.1 exists to prevent. Batch 7 should take it, and its repo-wide grep will
   surface it.
2. **`ptah-cli:copy-wasm` cannot succeed in a git worktree** (see Verification). It makes
   `nx test ptah-cli` unrunnable for every batch in this worktree, not just this one. The
   fix is for the script to resolve `web-tree-sitter` through `require.resolve` rather than
   a workspace-root join. Not touched — it is a devops change outside this batch.
3. **Three test suites in `rpc-handlers` / `cli-agent-runtime` are load-sensitive** and
   fail non-deterministically under parallel workers: a 500 ms wall-clock perf budget, and
   two 5 s jest timeouts on real filesystem and real network work. `setup-rpc.handlers.spec.ts`
   reaching `raw.githubusercontent.com` in a unit test is the one worth fixing.
4. **Nothing sets `PTAH_MCP_HOST_AGENT_ID`.** The stdio surface's reporting path is
   therefore correct but inert until some launcher sets it. That is honest today (it
   refuses rather than guessing), but if stdio-hosted agents are ever expected to report,
   whoever spawns `ptah mcp-serve` has to pass it.

## Left undone

- **Assumption A1 is still unsettled**, exactly as Batch 4 left it. This batch makes the
  run possible — `ptah_agent_report` is now reachable on both surfaces — but it needs a
  live spawned agent against a live chat session, watching for the
  `'[SdkMessageTransformer] Rendering inbound peer message'` debug line. Batch 8.
- **`apps\ptah-cli\tests\e2e\mcp-serve.e2e.spec.ts` was updated but not executed.**
- **`builtin-presets.ts` (Batch 7 Task 7.1) is not done**, by design. Until it is, the
  preset allow-list blocks both new tools.
