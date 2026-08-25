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

## Verification note

`npx nx test projA projB projC` silently runs only the FIRST project and exits
0 — the trailing names are parsed as Jest args. Two agents reproduced this
independently during TASK_2026_315. Always use
`npx nx run-many -t test -p projA projB projC`.
