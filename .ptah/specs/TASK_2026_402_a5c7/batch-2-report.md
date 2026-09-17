# Batch 2 report — TASK_2026_402_a5c7 (Group β: Components 3, 4)

Executor: `backend-developer`. Worktree
`D:\projects\ptah-extension\.claude-worktrees\agent-messaging`, branch
`feat/agent-two-way-messaging`. Nothing committed, no stash, no checkout, no `nx reset`.

Status: **BATCH_2_DONE**. Tasks 2.1, 2.2, 2.3, 2.4 all implemented with real code; no stubs,
no TODO markers, no skipped or deleted assertions.

---

## Files created / modified (absolute paths)

Nothing was created. All changes are modifications.

### Task 2.1 — shared capability types

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\libs\shared\src\lib\types\agent-process.types.ts`
  — adds `AgentMessagingMode` and `AgentMessagingCapability`; replaces
  `CliDetectionResult.supportsSteer: boolean` with
  `messagingMode: AgentMessagingCapability`. The old field is **deleted**, not deprecated.

### Task 2.2 — the adapter contract

- MODIFIED `...\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cli-adapter.interface.ts`
  — `CliAdapter.supportsSteer(): boolean` **replaced** by
  `capabilities(): AgentMessagingCapabilities` (required, so a seventh adapter is a compile
  error until it answers); new `AgentMessagingCapabilities` interface; `SdkHandle.interrupt?:
  () => Promise<void>` and `SdkHandle.supportsInterrupt?: () => boolean`, with the comment
  stating the distinction from `abort` (interrupt ends the CURRENT run, `abort` ends the whole
  handle); new pure `bestMessagingCapability(caps)` collapsing a declaration to the single best
  mechanism in the router's own preference order.
- MODIFIED `...\cli-adapters\index.ts` — barrel exports `AgentMessagingCapabilities` (type) and
  `bestMessagingCapability` (value).

### Task 2.3 — six adapter declarations + consumer compile fixes

- MODIFIED `...\cli-adapters\pi-cli.adapter.ts`
- MODIFIED `...\cli-adapters\codex-cli.adapter.ts`
- MODIFIED `...\cli-adapters\copilot-sdk.adapter.ts`
- MODIFIED `...\cli-adapters\cursor-cli.adapter.ts`
- MODIFIED `...\cli-adapters\antigravity-cli.adapter.ts`
- MODIFIED `...\cli-adapters\opencode-cli.adapter.ts`

Each drops `supportsSteer()`, declares `capabilities()` with a comment naming the vendor-surface
reason, and every `detect()` construction site now emits
`messagingMode: bestMessagingCapability(this.capabilities())` — so a detection row and the
router read the SAME declaration and cannot drift. Matrix as landed, matching the plan:

| Adapter | steer | interrupt | continuation | `messagingMode` |
| --- | --- | --- | --- | --- |
| pi | true | false | true | `steer` |
| cursor | false | **true** | true | `interrupt` |
| codex | false | false | true | `queue` |
| copilot | false | false | true | `queue` |
| antigravity | false | false | false | `none` |
| opencode | false | false | false | `none` |

Ptah CLI rows are synthesised, not adapter-backed, and emit `messagingMode: 'queue'`.

Design note: the capability is a property of the vendor surface, not of installation, so an
uninstalled CLI reports its real capability rather than a fabricated `none`. Pi's not-installed
row therefore reads `steer`. This is deliberate and pinned by a test.

### Task 2.4 — Cursor `interrupt`

- MODIFIED `...\cli-adapters\cursor-cli.adapter.ts` — `runSdk` now tracks `activeTurn` beside
  `activeRun` and starts every turn (first turn AND `continue`) through one `startTurn` seam.
  `interrupt` cancels `activeRun` and awaits that turn so the stream consumer has unwound before
  it resolves. It touches neither `abortController` nor `agent.close()`, so it cannot race the
  whole-agent abort path — the agent object and `agentId` stay live, and `continue` re-enters
  `runTurn` on the SAME agent (asserted). No active run resolves immediately. A rejecting
  `cancel()` is logged and **rethrown**, so the router reports `unsupported` with the reason
  rather than a false `interrupt-resume`. The turn-settled bookkeeping clears `activeRun` only
  when the newest turn settles, so an older turn cannot erase a live run.
- MODIFIED `...\cli-adapters\cursor-cli.adapter.spec.ts` — new
  `describe('interrupt() — cancel the run, keep the agent')` with four tests: `supportsInterrupt()`
  is true; interrupt cancels the active run, `done` resolves, the abort signal stays unset,
  `close()` is never called, and a following `continue()` calls `agent.send` on the same agent
  (`Agent.create` called once, `getSessionId()` unchanged); no run in flight resolves and cancels
  nothing; a failing `cancel()` rejects without aborting the handle.

### Spec assertions rewritten (R-6) — never deleted, never `.skip`ped

- `...\cli-adapters\pi-cli.adapter.spec.ts`
- `...\cli-adapters\codex-cli.adapter.spec.ts`
- `...\cli-adapters\copilot-sdk.adapter.spec.ts`
- `...\cli-adapters\cursor-cli.adapter.spec.ts`
- `...\cli-adapters\antigravity-cli.adapter.spec.ts`
- `...\cli-adapters\opencode-cli.adapter.spec.ts`
- `...\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.spec.ts`
- `...\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\mcp-response-formatter.spec.ts`
- `...\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-stdio\stdio-mcp-server.service.spec.ts`
- `...\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.spec.ts`
- `...\libs\frontend\tribunal-panel\src\lib\services\tribunal-discovery.service.spec.ts`

Every `expect(result.supportsSteer).toBe(x)` became an assertion on the concrete
`messagingMode` value; every `adapter.supportsSteer()` assertion became a full
`toEqual({ steer, interrupt, continuation })` on `capabilities()`, which asserts strictly more
than the boolean it replaced. `agent-process-manager.service.spec.ts` mock adapters now carry a
`capabilities` jest mock, and the steer-routing test drives it with
`capabilities.mockReturnValue({ steer: true, ... })`.

---

## R-1 — how the three consumer compile fixes were handled

Each is the minimal edit that keeps the file compiling, and nothing else in that file:

- MODIFIED `...\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts`
  — line 1005 only: `if (!adapter?.supportsSteer())` → `if (!adapter?.capabilities().steer)`.
  `steer()` itself is untouched; Batch 3 deletes it.
- MODIFIED `...\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.ts`
  — line 264 only: synthesised `supportsSteer: false` → `messagingMode: 'queue'`.
- MODIFIED `...\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.ts`
  — line 840 only: same mechanical replacement.

## Deviations — the R-1 list was incomplete

R-1 named three consumers. Four more production sites referenced the deleted field and would
have left the repo not typechecking, so each got the same one-line mechanical treatment. None of
them is a Batch 1 file (Batch 1 owns `agent-sdk/**`, `execution/stream.ts`,
`ai-provider.types.ts`), so there was no collision. Reporting rather than widening silently:

- MODIFIED `...\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-detection.service.ts:125`
  — the detection-error fallback row now emits
  `messagingMode: bestMessagingCapability(adapter.capabilities())` (the adapter is in scope, so
  a failed probe still reports the vendor's real capability instead of guessing). One import
  line added.
- MODIFIED `...\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\mcp-response-formatter.ts:499`
  — `Capabilities: agent.supportsSteer ? 'steer: yes' : 'steer: no'` →
  `Capabilities: \`messaging: ${agent.messagingMode}\``. This site is listed as a Component 3
  integration point in the plan but appears in no batch's file list.
- MODIFIED `...\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\system-namespace.builders.ts:307`
  — a tool-description doc line, `returns: [{ …, supportsSteer }]` → `{ …, messagingMode }`.
  Required by the zero-live-hits grep; no vendor name involved (R-10 unaffected).
- MODIFIED `...\libs\frontend\tribunal-panel\src\lib\services\tribunal-discovery.service.spec.ts:18`
  — a `CliDetectionResult` fixture in a **frontend** lib, outside the four verification
  projects. Verified separately (below).

Second deviation, smaller: `bestMessagingCapability` is a function living in
`cli-adapter.interface.ts` rather than a separate file. It is the contract's own precedence rule
and belongs beside the declaration it collapses; splitting it into a ~10-line second file would
have failed the repository's own anti-fragment guardrail.

## A3 — re-verified on disk, confirmed

Both handles were re-read in this worktree before their rows were written.
`antigravity-cli.adapter.ts` returns
`{ abort, done, onOutput, onSegment, getSessionId, getPid }` and `opencode-cli.adapter.ts`
returns the same six fields. **Neither carries `continue` nor `supportsContinuation`.** A
repo-wide grep for those two names across the six adapters returns hits only in
`pi-cli.adapter.ts:505-506`, `codex-cli.adapter.ts:737-738`, `copilot-sdk.adapter.ts:453-454`
and `cursor-cli.adapter.ts:386-387`. Both therefore declare
`{ steer: false, interrupt: false, continuation: false }` → `messagingMode: 'none'`, as the plan
predicted.

## R-2 — shared-file collision

Only `agent-process.types.ts` was touched in `libs/shared`. `execution/stream.ts` and
`ai-provider.types.ts` show as modified in `git status` — those are Batch 1's, not mine.
No `nx reset`, no `--skip-nx-cache`, no re-run collision occurred.

---

## Verification (verbatim)

### `npx nx run-many -t typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/shared @ptah-extension/vscode-lm-tools @ptah-extension/rpc-handlers`

```
 NX   Running target typecheck for 4 projects:

- @ptah-extension/cli-agent-runtime
- @ptah-extension/shared
- @ptah-extension/vscode-lm-tools
- @ptah-extension/rpc-handlers

> nx run @ptah-extension/shared:typecheck
> tsc --noEmit --project libs/shared/tsconfig.lib.json

> nx run @ptah-extension/cli-agent-runtime:typecheck
> tsc --noEmit --project libs/backend/cli-agent-runtime/tsconfig.lib.json

> nx run @ptah-extension/vscode-lm-tools:typecheck
> tsc --noEmit --project libs/backend/vscode-lm-tools/tsconfig.lib.json

> nx run @ptah-extension/rpc-handlers:typecheck
> tsc --noEmit --project libs/backend/rpc-handlers/tsconfig.lib.json

 NX   Successfully ran target typecheck for 4 projects
```

Header reads **4 projects**.

### `npx nx run-many -t test -p @ptah-extension/cli-agent-runtime @ptah-extension/shared @ptah-extension/vscode-lm-tools @ptah-extension/rpc-handlers`

```
 NX   Running target test for 4 projects:

- @ptah-extension/cli-agent-runtime
- @ptah-extension/shared
- @ptah-extension/vscode-lm-tools
- @ptah-extension/rpc-handlers

> nx run @ptah-extension/shared:test  [existing outputs match the cache, left as is]
Test Suites: 56 passed, 56 total
Tests:       1363 passed, 1363 total
Time:        49.932 s

> nx run @ptah-extension/cli-agent-runtime:test
Test Suites: 51 passed, 51 total
Tests:       1 skipped, 669 passed, 670 total
Time:        347.058 s

> nx run @ptah-extension/rpc-handlers:test
Test Suites: 93 passed, 93 total
Tests:       31 skipped, 2711 passed, 2742 total
Time:        419.58 s

> nx run @ptah-extension/vscode-lm-tools:test
Test Suites: 46 passed, 46 total
Tests:       1008 passed, 1008 total
Time:        435.803 s

 NX   Successfully ran target test for 4 projects

Nx read the output from the cache instead of running the command for 1 out of 4 tasks.
```

Header reads **4 projects**. The 1 skipped test in `cli-agent-runtime` and the 31 in
`rpc-handlers` are pre-existing; this batch skipped nothing. `@ptah-extension/shared:test` came
from cache — its `tsc` typecheck above ran fresh against my edit and passed, and no spec in
`libs/shared` referenced the removed field.

### `npx nx run-many -t lint -p @ptah-extension/cli-agent-runtime @ptah-extension/shared`

```
✖ 37 problems (0 errors, 37 warnings)

 NX   Successfully ran target lint for 2 projects
```

**0 errors.** All 37 are pre-existing warnings (`no-non-null-assertion` in specs,
`no-empty-function` at `pi-cli.adapter.ts:396`, `max-lines` on `ptah-cli-registry.ts` at 1048
lines). No warning originates in this batch's new code; the files I touched were formatted with
the repository's prettier before linting.

### Extra: the frontend lib outside the four-project set

```
> nx run @ptah-extension/tribunal-panel:test
Test Suites: 16 passed, 16 total
Tests:       333 passed, 333 total

 NX   Successfully ran targets test, typecheck for project @ptah-extension/tribunal-panel
```

### `supportsSteer` grep — zero live hits

`grep -rn "supportsSteer" --include=*.ts --include=*.html --include=*.json libs apps` returns
**nothing**. `git grep -n "supportsSteer"` returns hits in exactly one file, a historical task
record and not code:

```
.ptah/specs/TASK_2026_398/resume-support-verification.md:11,12,13,14,15,16,17
```

That is the "intentional history" exemption in the Batch 2 verification criterion. Zero
production files, zero spec files.

### `git status --short` — my files

```
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.spec.ts
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/copilot-sdk.adapter.spec.ts
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/copilot-sdk.adapter.ts
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cursor-cli.adapter.spec.ts
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cursor-cli.adapter.ts
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/index.ts
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.spec.ts
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/pi-cli.adapter.spec.ts
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/pi-cli.adapter.ts
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts
 M libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts
 M libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.spec.ts
 M libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts
 M libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/stdio-mcp-server.service.spec.ts
 M libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.spec.ts
 M libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts
 M libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts
 M libs/frontend/tribunal-panel/src/lib/services/tribunal-discovery.service.spec.ts
 M libs/shared/src/lib/types/agent-process.types.ts
```

The working tree also shows Batch 1's files (`libs/backend/agent-sdk/**`,
`libs/shared/src/lib/types/ai-provider.types.ts`,
`libs/shared/src/lib/types/execution/stream.ts`, and two new `session-name.builder*` files).
Those are the concurrent executor's; I did not touch them.

---

## Notes for the batches downstream

- Batch 3's router should read `caps = handleCaps ?? adapterCaps` where `handleCaps` comes from
  `handle.supportsInterrupt?.()` / `handle.supportsContinuation?.()` / presence of `handle.steer`,
  and `adapterCaps` from `adapter.capabilities()`. Both agree today; the drift test Component 3
  asks for belongs in Batch 3's contract-test seam.
- `bestMessagingCapability` is exported from the `cli-adapters` barrel, so any later consumer
  needing a `messagingMode` from a live adapter should call it rather than re-deriving.
- `AgentProcessManager.steer()` is intact and still routed through
  `capabilities().steer`; Batch 3 deletes it when `sendToAgent` lands.
