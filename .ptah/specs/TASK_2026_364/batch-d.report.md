# Batch D report — the ambiguity refusal

Executor: backend-developer (Batch D, TASK_2026_364). Date: 2026-08-31.
Status: **COMPLETE**. All verification targets green. Not committed (per instructions).

## What this batch closes

An MCP `tools/call` that carried no `/workspace/{root}` and no `/session/{id}`
segment used to resolve to `undefined`. The consumer then fell back to the
process-global active folder. With several folders open, the caller received a
truthful answer about a workspace it never named. That is the original defect,
still reachable through a stale `.mcp.json` written before Batch B.

An anonymous MCP call with more than one folder open now REFUSES.

## Files changed

| File                                                                                        | Change                                                                         |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-request-context.ts`       | New exported `isMcpRequestInFlight()`                                          |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/index.ts`                     | Barrel export of the new function                                              |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-caller-workspace-resolver.ts`      | New private `refuseAmbiguousAnonymousCall()`, called on the anonymous branch   |
| `libs/backend/platform-core/src/interfaces/caller-workspace-resolver.interface.ts`          | Second `@throws` clause on the port contract (TSDoc only, no signature change) |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-caller-workspace-resolver.spec.ts` | 7 new cases, 1 existing case retargeted                                        |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-request-context.spec.ts`  | 4 new cases                                                                    |

No composition-root change. No DI registration change. No constructor change.

## Where the check went, and why

**In `McpCallerWorkspaceResolver`, not in the consumer.**

The port `ICallerWorkspaceResolver` answers exactly one question: which
workspace is this call about. "The call names no workspace and several are
possible" is an answer to that question, not a consumer concern. Three further
reasons:

1. **Symmetry.** The declared-but-not-open refusal already lives in this class.
   Both refusals share one shape: a caller asked for a workspace we cannot
   honour (the wrong one, or none while several were possible). Splitting the
   pair across two libs would leave a reader hunting for the second half.
2. **One owner.** `AgentProcessManager` is the only consumer today. A check in
   the consumer would have to be repeated by the second consumer, and the port
   exists precisely so that never happens.
3. **The consumer cannot see the discriminator.** `cli-agent-runtime` must not
   import `vscode-lm-tools`, so it cannot call `isMcpRequestInFlight()`. A
   consumer-side check would have to guess from `undefined`, which is the
   ambiguity itself.

The consumer needed no change at all. Batch C already made a throw from the port
propagate through `resolveScopedWorkspaceRoot()` on purpose, so spawn validation
and both `getStatus` forms inherit the refusal.

## How an anonymous MCP call is distinguished from a non-MCP call

This was the crux. `getCallerSessionId()` and `getCallerWorkspaceRoot()` both
return `undefined` in both cases, so neither can tell them apart.

The existing context CAN distinguish them, with one small addition. The
AsyncLocalStorage STORE is the discriminator:

- `protocol-dispatcher.ts:174` wraps every `tools/call` in
  `runWithMcpRequestContext({ callerSessionId, callerWorkspaceRoot }, ...)`.
  The object is always passed, so a store is bound even when both fields are
  absent. `storage.getStore()` is therefore an object.
- Nothing else in the repository calls `runWithMcpRequestContext` (grep over
  `libs` and `apps`, non-spec files: two hits, the definition and that one call
  site). Webview RPC, file watchers, the indexer warm-up and internal calls run
  outside it, so `storage.getStore()` is `undefined`.

The addition is one exported predicate:

```ts
export function isMcpRequestInFlight(): boolean {
  return storage.getStore() !== undefined;
}
```

No new field, no change to `McpRequestContext`, no change to the dispatcher or
the HTTP handler. `isMcpRequestInFlight()` is the first gate in
`refuseAmbiguousAnonymousCall()`, so a watcher with two folders open returns
`undefined` exactly as before.

## The gate, in order

`refuseAmbiguousAnonymousCall()` runs only after the declared and session tiers
both declined, and then returns without throwing unless ALL of the following
hold:

1. `isMcpRequestInFlight()` — this is an MCP `tools/call`, not a watcher.
2. `getWorkspaceFolders().length > 1` — more than one folder is open.

A caller that carried a session id never reaches the check. That is deliberate:
`getStatus` for a Ptah session whose workspace the SDK lifecycle manager does not
know is a resolution MISS, not an unstated workspace, and refusing it would break
a flow the caller has no way to fix from `.mcp.json`. The batch brief names the
open case as "NO `/workspace/` and NO `/session/`", and that is what is
implemented.

The folder-count gate is the constraint that protects the majority of users. With
zero or one folder open the function returns before touching anything, and the
consumer takes the same `?? getWorkspaceRoot() ?? homedir()` path it always took.

## The exact error wording

> The caller did not say which workspace this call is about, and 2 folders are open in this window (D:\projects\ptah-extension, D:\projects\property-hub). Ptah will not guess — answering for one of them would attribute the call to a workspace the caller never named. Re-read the 'ptah' entry in the .mcp.json of the workspace you mean: it now carries a workspace-scoped URL that states the workspace for you.

The folder count and the comma-separated list are interpolated. The tone matches
the existing declared-but-not-open refusal in the same class: it states what the
caller did, states what Ptah refuses to do and why, and ends with the one action
that fixes it.

## Specs required by the brief

| Required case                                   | Spec                                                                                      | Result                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------- |
| Anonymous + two folders ⇒ refuses, naming both  | `refuses an anonymous MCP call when two folders are open, naming both`                    | Asserts both folder paths |
| Anonymous + one folder ⇒ unchanged, no throw    | `does NOT refuse with exactly one folder open — the overwhelming majority case`           | `undefined`, no throw     |
| Anonymous + zero folders ⇒ unchanged            | `does NOT refuse with no folder open at all`                                              | `undefined`, no throw     |
| Not an MCP call + two folders ⇒ unchanged       | `does NOT refuse outside an MCP request — a watcher or webview RPC with two folders open` | `undefined`, no throw     |
| Declared workspace + two folders ⇒ the declared | `does NOT refuse a caller that declared its workspace, with two folders open`             | Returns the declared root |

Three more cases beyond the brief: the refusal names `.mcp.json` and the
workspace-scoped URL; a caller with a session id but an unknown workspace is not
refused; and four cases pin `isMcpRequestInFlight` itself (false outside, true
for an empty context, true for an identified call, false again after the call
settles).

One existing case was retargeted, not deleted: Batch C's
`returns undefined for an anonymous call (no declared root, no session id)` used
two open folders and now reads
`returns undefined for an anonymous call when ONE folder is open`. Its old
two-folder assertion is the exact behaviour this batch changes, and the new
refusal case replaces it.

`vscode-lm-tools` went from 969 tests (Batch C) to 980.

## Verification — verbatim

### Command 1

`npx nx run-many -t typecheck,lint,test -p @ptah-extension/platform-core @ptah-extension/vscode-lm-tools @ptah-extension/cli-agent-runtime`

```
> nx run @ptah-extension/cli-agent-runtime:typecheck
> tsc --noEmit --project libs/backend/cli-agent-runtime/tsconfig.lib.json

> nx run @ptah-extension/vscode-lm-tools:typecheck
> tsc --noEmit --project libs/backend/vscode-lm-tools/tsconfig.lib.json

 NX   Successfully ran targets typecheck, lint, test for 3 projects

Nx read the output from the cache instead of running the command for 4 out of 9 tasks.

 NX   Nx detected  flaky tasks

  @ptah-extension/platform-core:test
  @ptah-extension/cli-agent-runtime:test
```

Per-project test output, from uncached runs of the same target:

```
> nx run @ptah-extension/vscode-lm-tools:test
Test Suites: 46 passed, 46 total
Tests:       980 passed, 980 total

> nx run @ptah-extension/cli-agent-runtime:test
Test Suites: 41 passed, 41 total
Tests:       518 passed, 518 total

> nx run @ptah-extension/platform-core:test
A worker process has failed to exit gracefully and has been force exited. ...
Test Suites: 30 passed, 30 total
Tests:       4 todo, 540 passed, 544 total
 NX   Successfully ran target test for project @ptah-extension/platform-core
```

Lint: `✖ 21 problems (0 errors, 21 warnings)` on `vscode-lm-tools` — the same
pre-existing set Batch A and Batch C both reported (`no-explicit-any` in
`mcp-response-formatter.ts` and `chrome-launcher-browser-capabilities.ts`,
`max-lines` on `protocol-dispatcher.ts`, `tool-description.builder.ts` and
`harness-namespace.builder.ts`). Zero errors. No warning is in a file this batch
touched, and the count did not move.

**On the two flaky tasks.** The first run of command 1 reported
`@ptah-extension/platform-core:test` and `@ptah-extension/cli-agent-runtime:test`
as failed with `1 failed, 517 passed` on the latter. Both passed on an immediate
`--skip-nx-cache` re-run with zero code change, and Nx itself labelled them
flaky. `platform-core` shows the same force-exited worker Batch C recorded.
Batch D changed one TSDoc comment in `platform-core` and nothing at all in
`cli-agent-runtime`, so neither flake is attributable to this work. It is
pre-existing test-teardown noise and is worth its own task.

### Command 2 — all three composition roots

`npx nx run-many -t test -p ptah-extension-vscode ptah-electron ptah-cli`

```
 NX   Running target test for 3 projects:

> nx run ptah-electron:test
Test Suites: 1 skipped, 32 passed, 32 of 33 total
Tests:       4 skipped, 405 passed, 409 total

> nx run ptah-extension-vscode:test
Test Suites: 4 passed, 4 total
Tests:       36 passed, 36 total

> nx run ptah-cli:test
Test Suites: 1 skipped, 65 passed, 65 of 66 total
Tests:       3 skipped, 970 passed, 973 total

 NX   Successfully ran target test for 3 projects
```

The header reads `for 3 projects`, so no project name was silently dropped.

## Scope note — what this batch deliberately did NOT change

`ptah-api-builder.service.ts:resolveSessionWorkspaceRoot()` reads
`getCallerWorkspaceRoot()` directly rather than through the port, so the
PATH-resolving namespace tools (`ptah.files.*`, workspace analysis) do not
inherit this refusal. That is the plan's scope: Batch D names "a
workspace-resolving AGENT tool", and section 4's row is about the agent surface.
Extending the refusal to the path tools would change the behaviour of every
anonymous file read in a multi-root window and belongs in its own task with its
own measurement. Flagged, not done.

## Not done

Nothing else in the brief was left out.
