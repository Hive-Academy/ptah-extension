# Context — TASK_2026_318

## Where this came from

TASK_2026_315 fixed thirteen defects found in one Electron session log. Its
final batch was asked to close out a residual risk (F8: whether moving MCP
bring-up ahead of the heavy boot could affect the harness reconcile). F8 itself
came back clean — but the source trace done to answer it surfaced this,
recorded as F12 in `.ptah/specs/TASK_2026_315/follow-ups.md`.

## The rule being broken

`harness-sync`'s own design note on MCP config files:

> Never add a SECOND writer to an MCP config file... A module that hand-rolls
> its own read-modify-write on a file this lib also writes will lose an entry —
> not corrupt it, lose it, silently.

`CodeExecutionMCP` is that second writer. `registerInMcpJson` and
`unregisterFromMcpJson` in
`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts`
do their own `fs.readFileSync` → `JSON.parse` → mutate → `fs.writeFileSync` on
`{ws}/.mcp.json`, never taking `withMcpConfigLock`.

## Why it is safe today, and why that is not reassuring

Two coincidences, neither of them a design guarantee:

1. **The two writers currently run sequentially at boot.** Verified during
   TASK_2026_315 batch 7's F8 trace.
2. **`"ptah"` is a key the reconciler never inspects.** So even an interleaved
   write has, so far, nothing to lose that anything reads.

Change either — a third trigger, or the reconciler learning to care about the
`ptah` key — and this becomes a live lost-update bug that presents as a
silently missing MCP server rather than as an error.

## How TASK_2026_315 made it worse

This should not be glossed. Commit `3cfba7b` (finding A3) fixed a real defect:
`ensureRegisteredForSubagents` was one-shot behind a boolean, so after a
workspace switch the second workspace never got a `.mcp.json` entry at all and
subagents spawned there could not discover the Ptah MCP server — the entire
stated purpose of the mechanism. The fix added a `workspaceFoldersSubscription`
at `http-mcp-server.service.ts:97-100` so registration follows the active
workspace.

That is the right fix. Its side effect is that
`propagateHarness()` (`apps/ptah-electron/src/activation/wire-runtime.ts:499`)
_also_ fires on `onDidChangeWorkspaceFolders`, and is **not awaited**. So one
user action — adding or removing a folder — can now trigger both writers, which
was not true before A3.

Do not "fix" this by reverting A3's subscription. That would restore a worse
defect.

## Suggested shapes

Two, and the choice is a real decision rather than an obvious one:

- **Route the `CodeExecutionMCP` writes through `withMcpConfigLock`.** Smallest
  change, keeps two writers but makes them safe. Requires `vscode-lm-tools` to
  reach the lock, so check the dependency direction is legal before committing
  to it — `vscode-lm-tools` already depends on `cli-agent-runtime`, but not on
  `harness-sync`.
- **Give `.mcp.json` a single owner.** Have `CodeExecutionMCP` record an intent
  and let the reconciler write it, matching how declared MCP servers already
  work (see the "Declared MCP servers" section of
  `libs/backend/rpc-handlers/CLAUDE.md`, which establishes exactly this
  record-intent-then-reconcile pattern). Larger, but structurally correct and
  removes the class rather than the instance.

## Constraints

- `.mcp.json` is a **user-owned file**. The existing read-merge-write must be
  preserved: a hand-authored file with the user's own servers survives with
  only the `ptah` key touched. TASK_2026_315 has a passing test for this in
  `http-mcp-server.service.spec.ts` — keep it green.
- The write is currently non-atomic (no temp-file + rename), noted as a
  separate pre-existing gap in TASK_2026_315's batch-2 review. Worth folding in
  here if the file is being touched anyway; not required.
- Do not change harness-sync's refusal-on-unowned-path rule.

## Outcome (2026-08-26) — the lock, not an intent

**The choice was real, and "give `.mcp.json` a single owner" is the wrong
shape here.** Recording an intent for the reconciler to write would put an
EPHEMERAL per-session localhost port into `~/.ptah/mcp-installed.json`, which is
the user's DURABLE desired state — so it would persist across sessions with a
dead port and fan out to every detected CLI. `harness-sync`'s own boundary says
so directly: "Deciding to pass Ptah's OWN MCP server to a spawned CLI — the
adapters do that at spawn time, and this lib reconciles USER-installed MCP
entries only."

The documented precedent is one file over, and it is exactly this situation:
`AntigravityCliAdapter` writes its own ephemeral `PTAH_SPAWN_MCP_KEY` into
`~/.gemini/config/mcp_config.json` by borrowing harness-sync's facet. **Borrow
the MECHANISM, keep the POLICY.** So `CodeExecutionMCP` keeps owning the `ptah`
key and the read-merge-write, and both `registerInMcpJson` and
`unregisterFromMcpJson` now run inside `withMcpConfigLock`.

The unregister takes the lock around the WHOLE read/check/delete/write, not just
the write. Deciding `ptah` is present and removing it are two halves of one
decision; a reconcile landing between them would be written over by the copy
read before it.

### Dependency direction

`vscode-lm-tools → harness-sync` is a new direct edge and it is legal.
`harness-sync` depends only on `shared` + `vscode-core`, so there is no cycle,
and `vscode-lm-tools` already depended on harness-sync TRANSITIVELY through
`cli-agent-runtime`. `nx enforce-module-boundaries` passes.

### The signature change, and why it is awaited

`ensureRegisteredForSubagents` had to become `async` — the lock is async. It is
`await`ed at every call site rather than fire-and-forget, because four of the
five START A SESSION immediately afterwards and its subagents discover this
server by reading `.mcp.json`. Fire-and-forget there would have traded a lost
update for a startup race.

| Call site                                        | Treatment                                   |
| ------------------------------------------------ | ------------------------------------------- |
| `ChatSessionService` (start + continue)          | awaited — session follows                   |
| `ChatPtahCliService` (start + continue)          | awaited — CLI spawn follows                 |
| `GatewayChatBridge.resolveSdkContext`            | awaited; existing catch degrades to `false` |
| `bringUpSubsystems`                              | awaited, so a rejection lands in its catch  |
| `onDidChangeWorkspaceFolders` (in-service)       | fire-and-forget + catch — nothing waits     |

The event subscription is the one deliberately un-awaited path: the event has
nowhere to return a promise to, and nothing depends on the re-point.

### Constraints, all held

- The read-merge-write is unchanged. `a hand-authored .mcp.json survives
  register + unregister with only the ptah key touched` still passes.
- harness-sync's refusal-on-unowned-path rule is untouched.
- The non-atomic write was NOT folded in. It is a separate pre-existing gap and
  the lock is what this task is for; changing the write mechanism in the same
  change would have made the diff harder to reason about for no gain here.

### Verified

Two new cases in `http-mcp-server.service.spec.ts`: the register path takes the
lock and writes INSIDE it, asserted on `mock.invocationCallOrder` rather than
mere presence (a lock taken after the write would satisfy `toHaveBeenCalled` and
protect nothing), and the remove path takes the same lock. The spec replaces
`fs` wholesale, so `withMcpConfigLock` is stubbed to run its task through —
which is why the ordering assertion is load-bearing and must not be deleted.

The workspace-switch cases needed a `settleMcpJsonWrites()` drain: the folder
event's re-point is now async, so a synchronous disk assertion after
`setFolders` was reading pre-re-point state.

`lint`, `typecheck` and `test` green across `vscode-lm-tools` (42 suites, 849),
`vscode-core` (22, 365), `rpc-handlers` (88, 2467) and `gateway-chat-bridge`
(2, 64). `nx affected -t typecheck` green across 27 projects.

## Verification note

`npx nx test projA projB projC` silently runs only the FIRST project and exits
0 — the trailing names are parsed as Jest args. Two agents reproduced this
independently during TASK_2026_315. Always use
`npx nx run-many -t test -p projA projB projC`.
