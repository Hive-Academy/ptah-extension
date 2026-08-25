# Batch 2 Implementation Report — TASK_2026_315

**Findings**: A3 (`.mcp.json` path asymmetry + one-shot registration), A4 (workspaceRoot scoping leak)
**Executor**: `backend-developer`
**Status**: COMPLETE — all Batch 2 verification gates green
**Git**: no commits created (team-leader commits after review)

---

## Files changed (8, all inside Batch 2's "Files touched" list)

| File                                                                                                                      | Change                                                            |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-http\http-mcp-server.service.ts`      | Task 2.1 — path tracking + re-registration on workspace change    |
| `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-http\http-mcp-server.service.spec.ts` | Task 2.2 — new section 5 (6 tests), header doc updated            |
| `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\code-symbol.store.ts`                                     | Task 2.3 — `workspaceClause` tri-state for count/search/purgeJunk |
| `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\code-symbol.store.spec.ts`                                | Task 2.3 — 8 stub-DB tests + 3 native-gated behavioural tests     |
| `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\memory.store.ts`                                          | Task 2.3 — tri-state contract documented (no behaviour change)    |
| `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\memory.store.spec.ts`                                     | Task 2.3 — 3 tests pinning the `stats` tri-state                  |
| `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\memory-rpc.handlers.ts`                            | Task 2.3 — `resolveReadScope` + `purgeJunk` refusal               |
| `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\memory-rpc.handlers.spec.ts`                       | Task 2.3 — 10 boundary tests                                      |

Not opened: `workspace-rpc.handlers.ts`, `sdk-agent-adapter.ts` (Batch 1), anything under `libs/frontend/tasks-ui/**` (concurrent Batch 3). No new files created — every spec was extended in place.

---

## Task 2.1 — `.mcp.json` register/unregister path symmetry

### How the written path is now tracked

`private registeredInMcpJson = false` is replaced by two fields:

```ts
private registeredMcpJsonPath: string | null = null;  // the file we actually wrote
private registeredPort: number | null = null;         // the port recorded in it
```

`registerInMcpJson(mcpJsonPath, port)` now takes its target as an argument instead of
re-resolving it, and sets both fields **only after** the `writeFileSync` succeeds.
`unregisterFromMcpJson()` reads `registeredMcpJsonPath` and never calls
`getMcpJsonPath()` — that re-resolution was the second half of A3, and it is gone.

`clearRegistration()` nulls both fields, and is called on exactly three paths: after a
successful key removal, when the tracked file no longer exists, and when the tracked file
has no `ptah` key. It is deliberately **not** called when the rewrite throws — the old code
kept its flag set on that path so a later `stop()` retries, and that semantic is preserved.

### How re-registration on workspace change works

Two mechanisms, and both are needed:

1. **Push** — the constructor subscribes to `IWorkspaceProvider.onDidChangeWorkspaceFolders`
   and calls `syncMcpJsonRegistration()`. That method compares the current
   `getMcpJsonPath()` against the tracked path; if they differ it unregisters from the
   tracked path and, when a new root and a live port exist, registers in the new one. It
   returns immediately when `registeredMcpJsonPath === null`, so a host that never called
   `ensureRegisteredForSubagents` still never touches the user's disk (the Bug #9 rule the
   existing "stop() without prior register does not read .mcp.json" test pins). The
   subscription is disposed in `disposeAsync()`.
2. **Pull** — `ensureRegisteredForSubagents()` is no longer one-shot. It is now idempotent
   per `(path, port)`: same file and same port → no write; different file → unregister the
   old, register the new. This matters because that method is called on every chat-session
   start from four sites (`chat-session.service.ts:404,:529`, `chat-ptah-cli.service.ts:109,:162`,
   `gateway-chat-bridge.ts:603`) plus `bringUpSubsystems`, so even a host whose workspace
   event does not fire converges on the next session.

Fixing only the unregister would have left the stated purpose of the mechanism broken —
`angular-3d-showcase` never got an entry at all in the captured log, so subagents spawned
there could not discover the Ptah MCP server. Both halves are fixed and both are tested.

Zero folders is handled explicitly: `getMcpJsonPath()` returns `null`, so
`syncMcpJsonRegistration` unregisters from the tracked path and does not re-register. A
subsequent `stop()` then writes nothing (asserted).

### Proof the hand-authored file is preserved

The read-merge-write at what was `:218` is unchanged in shape and now carries a comment
saying why. Both directions were tested against a real path-keyed in-memory disk (the spec
now backs the mocked `fs` with a `Map<string, string>`, so per-file state is genuine rather
than a single shared return value).

Test `a hand-authored .mcp.json survives register + unregister with only the ptah key touched`
seeds `/wsA/.mcp.json` with:

```json
{ "$schema": "…", "mcpServers": { "my-own-server": { "type": "stdio", "command": "node", "args": ["x.js"] } } }
```

then registers, switches the root to `/wsB`, and stops. After the full cycle the file's
`mcpServers` is **exactly** `{ "my-own-server": … }` — the user's server intact, `ptah`
gone — and the unrelated top-level `$schema` key is still present, which is the assertion
that proves this is a merge and not a rewrite.

---

## Task 2.2 (TEST DELIVERABLE) — observed fail-then-pass evidence

Six tests added under `CodeExecutionMCP — .mcp.json path symmetry across a workspace switch`.
The named one is `stop() after a workspace switch removes ptah from the ORIGINAL root's .mcp.json`
(register against A → set folders to B → `stop()` → assert A has no `ptah` key), and its
companion is the hand-authored-file test above.

**Revert procedure** (fix backed up, three targeted edits reintroducing both halves of A3:
one-shot guard in `ensureRegisteredForSubagents`, emptied `syncMcpJsonRegistration`, and
`unregisterFromMcpJson` resolving through `getMcpJsonPath()` again), then restored from the
backup and re-verified — `grep -c TEMP-REVERT` returns 0.

**With the fix reverted: 5 of 6 new tests failed** (`Tests: 5 failed, 28 passed, 33 total`).
Observed message for the named test:

```
● CodeExecutionMCP — .mcp.json path symmetry across a workspace switch
  › stop() after a workspace switch removes ptah from the ORIGINAL root's .mcp.json

  expect(received).toEqual(expected) // deep equality

  - Expected  - 1
  + Received  + 6

  - Object {}
  + Object {
  +   "ptah": Object {
  +     "type": "http",
  +     "url": "http://localhost:51820",
  +   },
  + }

    at Object.<anonymous> (…/http-mcp-server.service.spec.ts:769:37)
```

Companion (hand-authored file) failure — the user's file keeps a dead `ptah` entry forever:

```
● … › a hand-authored .mcp.json survives register + unregister with only the ptah key touched
  @@ -4,6 +4,10 @@
        "command": "node",
        "type": "stdio",
      },
  +   "ptah": Object {
  +     "type": "http",
  +     "url": "http://localhost:51820",
  +   },
    }
```

The other three reverted failures cover the first half of A3 (`Expected: {"ptah": …}
Received: undefined` for root B — the second workspace never registered) and the
last-folder-removed case.

**With the fix restored: `Tests: 33 passed, 33 total`.**

The sixth test (`a workspace change without a prior registration never touches disk`) passes
both before and after by design — it is the guard against widening the fix into a regression,
not a repro.

---

## Task 2.3 — workspaceRoot scoping

### Root cause, which is narrower and more precise than the spec assumed

The store branch at `memory.store.ts:616-618` is not itself defective. The defect is one
line up the stack, at `memory-rpc.handlers.ts:270`:

```ts
const workspaceRoot = params?.workspaceRoot ?? undefined;
```

`??` treats `null` as nullish, so an explicit `null` collapses into `undefined`. The webview
sends `{ workspaceRoot: workspaceRoot ?? null }`
(`libs/frontend/memory-curator-ui/src/lib/services/memory-rpc.service.ts:187`), i.e. it
**always** says `null` when no folder is open. That deliberate "global/unscoped memories"
request was being rewritten into "no filter" at the boundary — which is exactly why the log
shows `[memory] stats: {}` (the logged `workspaceRoot` was `undefined`, so `JSON.stringify`
dropped the key).

### The tri-state is preserved, not collapsed

`undefined` = no filter, `null` = `WHERE workspace_root IS NULL`. Both meanings survive, and
`memory.store.ts` now carries an explicit doc comment naming all three states and the one
legitimate `undefined` caller (the whole-database sweep in
`apps/ptah-electron/src/integration/wizard-seed.integration.spec.ts`, which calls `store.stats()`
with no argument five times — this is why the store signature was **not** made required).
`memory.store.spec.ts` pins all three states against captured SQL and bound args, so the
distinction is now enforced by tests rather than by convention.

### Read paths are SCOPED; the destructive path is REFUSED

`MemoryRpcHandlers.resolveReadScope()` resolves the tri-state once:

- explicit `string` → that workspace
- explicit `null` → `null`, verbatim
- omitted → `workspaceProvider.getWorkspaceRoot() ?? null`

**Why not refuse on the read paths** (tasks.md Task 2.3 is titled "Refuse **or** scope"):
two shipped callers legitimately omit the key and would break — `ptah memory stats`
(`apps/ptah-cli/src/cli/commands/memory.ts:240` sends `{}`) and the TUI Memory panel
(`apps/ptah-tui/src/components/thoth/MemoryPanel.tsx:97` sends `{}`). Both are outside this
batch's files. Scoping answers them correctly instead of erroring at them, and still makes a
cross-workspace union unreachable from any RPC call. The reasoning, including the rejected
option, is recorded in the doc comment on `resolveReadScope`.

`memory:purgeJunk` is destructive and **does** follow the `purgeBySubjectPattern` refusal
precedent verbatim — see the next section.

### `codeSymbols.search` (`:302`) and `purgeJunk` (`:401`) — checked, and BOTH share the leak

Asked to check and state the finding: **both share it, and both are fixed.**

- **`codeSymbols.search`** — the handler passed `validated.workspaceRoot ?? undefined`, the
  same `??` collapse, and the webview _omits_ the key entirely when no folder is open
  (`memory-state.service.ts:338`: `...(workspaceRoot !== undefined ? { workspaceRoot } : {})`).
  It therefore listed symbols from every indexed workspace into a no-workspace UI. Now routed
  through `resolveReadScope`.
- **`codeSymbols.purgeJunk`** — worse than a count leak. `undefined`/`null` meant "delete junk
  symbols in EVERY workspace", **and** the `isAuthorizedWorkspace` check was itself skipped for
  those two values, so the unscoped delete ran unauthorized. Now refused with
  `RpcUserError(..., 'INVALID_PARAMS')` for both `undefined` and `null`, mirroring
  `purgeBySubjectPattern:341-346`; the authorization check that follows is now unconditional.
  Nothing shipped regresses: the only caller (`memory-curator-tab.component.ts:466-475`)
  early-returns when there is no root and always passes a concrete string.

`null` is refused for `purgeJunk` (rather than scoped) because `code_symbols.workspace_root`
is never NULL — `CodeSymbolInsert.workspaceRoot` is a required `string` — so a `null`-scoped
purge has no legitimate target at all.

### Store-level fix in `code-symbol.store.ts`

`count`, `search` and `purgeJunk` all used `workspaceRoot !== undefined && workspaceRoot !== null`,
which folded `null` into `undefined`. That is a second, independent copy of the same leak:
even after fixing the boundary, `count(null)` would still have counted every workspace — and
`null` is precisely what the webview sends. All three now go through one `workspaceClause()`
helper implementing the same tri-state as `MemoryStore.stats`. `search` moved from
`workspace_root = ?` to `workspace_root IS ?`, which is identical for a non-null string in SQLite.

Blast radius checked: `MemoryRpcHandlers` is the **only** consumer of `CodeSymbolStore` in the
entire repo (`grep CODE_SYMBOL_STORE|CodeSymbolStore` across `libs` + `apps`), so the semantic
change is fully contained.

### Left alone, deliberately

- `memory:list` (`:150`) and `memory:search` (`:174`) carry the same `?? undefined` shape.
  Not in Task 2.3's acceptance criteria and not in the cited line ranges, so **not changed** —
  flagged here as an adjacent finding for Batch 7 rather than fixed as scope creep. There is
  an existing test (`passes undefined workspaceRoot to search.searchRich when param is absent
(global search)`) asserting the current behaviour, so changing it is a deliberate decision,
  not a drive-by.
- `skillSynthesis:listCandidates`, `cron:list`, `gateway:*` — global by design, untouched.
- `resolveRoot` in `tasks-rpc.handlers.ts` — untouched.

---

## Commands run, with results

| Command                                                                                                                        | Result                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx nx test vscode-lm-tools --skip-nx-cache`                                                                                  | PASS — 42 suites, **822 tests** (was 816 before this batch)                                                                                                            |
| `npx jest --config libs/backend/vscode-lm-tools/jest.config.ts --testPathPatterns http-mcp-server.service.spec` (fix REVERTED) | **FAIL — 5 failed, 28 passed, 33 total** (see message above)                                                                                                           |
| same, fix RESTORED                                                                                                             | PASS — **33 passed, 33 total**                                                                                                                                         |
| `npx nx test memory-curator --skip-nx-cache`                                                                                   | PASS — 23 suites passed / 2 skipped, 365 passed / 60 skipped                                                                                                           |
| `npx jest --config .../memory-curator/jest.config.ts --testPathPatterns "code-symbol.store.spec\|memory.store.spec"`           | PASS — 34 passed, 21 skipped                                                                                                                                           |
| `npx nx test rpc-handlers --skip-nx-cache`                                                                                     | PASS — 87 suites, 2433 passed / 31 skipped                                                                                                                             |
| `npx jest --config .../rpc-handlers/jest.config.ts --testPathPatterns memory-rpc.handlers.spec`                                | PASS — 56 passed                                                                                                                                                       |
| `npx nx run-many -t test lint typecheck -p vscode-lm-tools memory-curator rpc-handlers --skip-nx-cache`                        | **Successfully ran targets test, lint, typecheck for 3 projects**                                                                                                      |
| `npx nx run-many -t lint … \| grep <my files>`                                                                                 | no output — **0 lint findings in any file I touched** (the 45 warnings across the 3 projects are all pre-existing `max-lines` / unused-import warnings in other files) |
| `npx prettier --check <all 8 touched files>`                                                                                   | PASS after one `--write` pass on the two vscode-lm-tools files                                                                                                         |
| `grep -c TEMP-REVERT http-mcp-server.service.ts`                                                                               | `0` — revert scaffolding fully removed                                                                                                                                 |

Typecheck note: during the revert experiment `tsc` caught `TS2345: Argument of type 'string | null'
is not assignable to parameter of type 'string'` from unreachable-code narrowing loss — an artefact
of how I staged the revert, not of the fix. The final tree typechecks clean.

---

## Environment caveat the reviewer should know

`libs/backend/memory-curator/src/lib/code-symbol.store.spec.ts` is **native-gated**: its
`describe` probes `better-sqlite3` at load and skips wholesale when the binary cannot load.
On this machine it cannot — `postinstall` rebuilds `better_sqlite3.node` against Electron's
ABI, so plain Node reports `The module '…better_sqlite3.node' …` and all of that suite skips.
This is pre-existing: all 9 tests in that file were already skipping before this batch.

Rather than leave the A4 store fix covered only by tests that never run, I added a second,
**ungated** `describe` (`CodeSymbolStore — workspaceRoot tri-state (SQL shape)`, 8 tests) that
drives the store against a SQL-capturing stub connection and asserts the emitted predicate and
bound arguments for `count`/`search`/`purgeJunk` across all three states. Those 8 execute here
and in CI. The 3 native behavioural tests I also added (real rows in a real temp DB, two
workspaces) run wherever the native module loads — they are the belt to the stub tests' braces.

---

## Acceptance criteria

**Task 2.1**

- [x] Unregister targets the exact path written, after a root change or after zero folders
- [x] Switching workspaces registers in the new root and unregisters from the old
- [x] Read-merge-write at `:218` preserved — hand-authored servers and unrelated top-level keys survive both directions
- [x] No workspace open at shutdown still unregisters cleanly (tested; the follow-up `stop()` writes nothing)

**Task 2.2**

- [x] Fails before, passes after — verified by actual revert, failure message reproduced above
- [x] Companion test asserting a pre-existing unrelated server key is untouched
- [x] Extended the existing spec file; no new file

**Task 2.3**

- [x] `memory:stats` with no workspace no longer returns a cross-workspace union
- [x] `workspaceRoot: null` still returns exactly the global/unscoped memories
- [x] Same treatment applied to `codeSymbols.count`
- [x] `codeSymbols.search` and `purgeJunk` checked — both DO share the leak, both fixed (search scoped, purgeJunk refused)
- [x] `skillSynthesis:listCandidates` / `cron:list` / `gateway:*` untouched

**Constraints**

- [x] Windows absolute paths for every Read/Write
- [x] No `platform-{vscode,electron,cli}` import — `IWorkspaceProvider` / `IDisposable` ports only
- [x] `catch (error: unknown)` with `instanceof Error` narrowing (unchanged from the existing handlers)
- [x] No stubs, no `// TODO`, no placeholder returns
- [x] No git commits created

---

# Post-review revision

**Trigger**: `code-logic-review-batch-2.md` — Task 2.1 APPROVED and committed as `3cfba7b`;
Task 2.3 NEEDS_REVISION with 2 critical issues.
**Decision built to** (user's, not re-litigated): add an explicit
`scope: 'all' | 'workspace'` parameter alongside `workspaceRoot` on `memory:stats` and
`memory:searchSymbols`.

## What I got wrong, stated plainly

The reviewer is right, and the criticism of my method is the part worth keeping. I ran a
careful blast-radius check on the destructive path (`purgeJunk` — sole caller, its exact
early-return, verified) and did not run the equivalent check on the two **read** paths I
changed, even though they are driven from several sites in the same component behind a
shipped scope toggle. Both regressions were the same wrong-scope class as A4 itself, from
the opposite direction, and both were silent:

- `memory:searchSymbols` — the Memory tab **omits** `workspaceRoot` for all-scope
  (`memory-state.service.ts`). My `resolveReadScope` read an omitted key as "use
  `getWorkspaceRoot()`", so an all-workspaces symbol search silently narrowed to one.
- `memory:stats` — the tab sends an **explicit `null`** for all-scope. My fix preserved
  that `null` verbatim, turning the grand total into "unscoped rows only" and making
  `codeIndex` a hard `0` — because `code_symbols.workspace_root` is never NULL, the very
  fact my own `purgeJunk` refusal rests on.

The root cause is one field carrying four meanings. Absent meant both "no folder open" and
"all workspaces"; `null` meant both "global/unscoped rows" (the dashboard tile) and "all
workspaces" (the Memory tab). No amount of care inside `resolveReadScope` could have told
them apart — the information was not on the wire.

## The fix: `scope` on the wire

New `MemoryQueryScope = 'all' | 'workspace'` in
`D:\projects\ptah-extension\libs\shared\src\lib\types\rpc\rpc-memory.types.ts`, added as an
optional field to `MemoryStatsParams` and `MemorySearchSymbolsParams`.

`resolveReadScope(scope, workspaceRoot)` now takes an unambiguous input:

| `scope`       | `workspaceRoot` | store scope                             | meaning                        |
| ------------- | --------------- | --------------------------------------- | ------------------------------ |
| `'all'`       | ignored         | `undefined` (no predicate)              | every workspace                |
| `'workspace'` | `'D:/ws'`       | `'D:/ws'`                               | that workspace                 |
| `'workspace'` | `null`          | `null` → `WHERE workspace_root IS NULL` | global / unscoped rows only    |
| `'workspace'` | omitted         | `getWorkspaceRoot() ?? null`            | current workspace, else global |

`scope: 'all'` is now the **only** input that can produce a cross-workspace union, and it
only happens when a caller asks for one. The store-level tri-state is untouched — `undefined`
= no filter, `null` = `IS NULL` — exactly as the reviewer confirmed correct.

**Zod at the boundary, optional with a defined default.** `MemoryQueryScopeSchema =
z.enum(['all','workspace']).default('workspace')`, reused by the new
`MemoryStatsParamsSchema` and by `MemorySearchSymbolsParamsSchema`. `memory:stats` had no
Zod validation at all before; it does now. Callers that send neither field keep working and
get the workspace-scoped answer **by explicit default rather than by accident** — which was
the specific ask. An unknown scope value is rejected with `INVALID_PARAMS` (tested, both
endpoints).

**Frontend encodes scope once.** `resolveScopedWorkspaceRoot()` in `memory-state.service.ts`
now returns `scope` alongside `workspaceRoot`, so all four RPCs it drives read it from one
place instead of three ad-hoc encodings. `loadStats` forwards it as a second argument;
`loadSymbols` puts it in the params object. This is the reviewer's "single shared frontend
helper" point, implemented in the helper that already existed.

## Blast-radius check, re-run the way it should have been

Exhaustive enumeration (`MemoryRpcService` consumers, `.stats(` call sites, `searchSymbols(`
call sites, and raw `'memory:stats'` / `'memory:searchSymbols'` RPC strings across all of
`libs` + `apps`):

### `memory:stats` — 4 call sites

| #   | Call site                                                                                          | Sends now                                   | Result                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `libs\frontend\memory-curator-ui\...\memory-state.service.ts:302` `loadStats`, **workspace** scope | `(root, 'workspace')`                       | that workspace. Unchanged                                                                                                                                                                      |
| 2   | same, **all** scope                                                                                | `(null, 'all')`                             | **cross-workspace union restored** — Issue 2 fixed                                                                                                                                             |
| 3   | `libs\frontend\dashboard\...\thoth-status.service.ts:286`                                          | `(workspaceInfo()?.path ?? null)`, no scope | defaults `'workspace'`. With a folder: that workspace. Without: `null` → global/unscoped. Never a union — the A4 fix, and its own comment ("null falls back to global counts") stays accurate  |
| 4   | `apps\ptah-cli\...\memory.ts:240` and `apps\ptah-tui\...\MemoryPanel.tsx:97`                       | `{}`                                        | default `'workspace'` + omitted root → `CliWorkspaceProvider.getWorkspaceRoot()` = cwd. The narrowing the reviewer judged correct, now the result of an explicit default. Both typecheck clean |

### `memory:searchSymbols` — 1 call site, 2 modes

| #   | Call site                                                        | Sends now                                     | Result                                    |
| --- | ---------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------- |
| 5   | `memory-state.service.ts:350` `loadSymbols`, **workspace** scope | `{ workspaceRoot: root, scope: 'workspace' }` | that workspace. Unchanged                 |
| 6   | same, **all** scope                                              | `{ scope: 'all' }` (root omitted)             | **spans every workspace** — Issue 1 fixed |

No other consumer exists. `MemoryRpcService` is injected in exactly three places
(`thoth-status.service.ts`, `memory-curator-tab.component.ts`, `corpus-list.component.ts`);
the latter two use only `purgeJunk` / corpus methods.

### Scope-toggle interaction — the thing I missed last time

`memory-curator-tab.component.ts:424-435` `onWorkspaceSwitch` skips all three refetches when
`scopeFilter() === 'all'`, on the stated invariant _"in 'all' scope the data is
cross-workspace and identical before/after a switch"_. My first revision made that comment
false. With `scope: 'all'` on the wire it is **true again** — all-scope stats, symbols and
list are genuinely workspace-independent — so the skip is correct and the comment needs no
edit. Verified by reading it, not assumed.

### Not affected, verified explicitly

`CodeSymbolStore.searchSymbols(query, limit, workspaceRoot?)` — the hybrid BM25+vector
method behind `ptah.code.searchSymbols`, `ICodeSymbolReader`, `code-symbol-prompt-injector.ts`
and `electron-ide-capabilities.ts` — is a **different method** from `CodeSymbolStore.search(params)`
and I never touched it. It takes `workspaceRoot?: string` (no null in the type) and branches
on truthiness. Five call sites, all unaffected.

## Tests added for the all-scope path

Neither side had one, which is why this reached review. Now both do.

Backend, `memory-rpc.handlers.spec.ts` (+7):

- `scope:'all'` produces the cross-workspace union (`store.stats(undefined)`, `count(undefined)`)
- `scope:'all'` ignores an explicit `workspaceRoot` rather than narrowing
- `scope:'workspace'` with no folder open still means global/unscoped, not a union
- unknown scope value rejected with `INVALID_PARAMS` (stats)
- `scope:'all'` symbol search spans every workspace
- `scope:'all'` symbol search spans every workspace **even with no folder open**
- unknown scope value rejected with `INVALID_PARAMS` (searchSymbols)

Frontend, `memory-state.service.spec.ts` (+3, and 2 existing assertions updated to the new
two-argument `stats` call):

- `loadStats()` in all-scope sends `scope:'all'` so the total stays cross-workspace
- `loadSymbols()` in all-scope **omits** `workspaceRoot` AND sends `scope:'all'`
- `loadSymbols()` in all-scope works with no workspace open

## `memory:list` / `memory:search` — recommendation, not a change

**Recommendation: yes, adopt `scope` — as a follow-up task, not here.** Reasoning:

- Their current all-scope behaviour is **correct**: `refresh()`/`search()` omit
  `workspaceRoot` for all-scope, and the handlers read an omitted key as "no filter". The
  Memory tab is fine today.
- The real gap is elsewhere: `apps\ptah-tui\...\MemoryPanel.tsx:104` calls `memory:list`
  with `{ limit: 50 }` and no root, and the CLI does the same — so those two get a
  cross-workspace list. Same A4 class, lower severity (a list, not a headline count), and
  in files outside this batch.
- Changing them means deleting or rewriting the existing test that pins today's contract,
  `memory-rpc.handlers.spec.ts:219` _"passes undefined workspaceRoot to search.searchRich
  when param is absent (global search)"_. Retiring a deliberately-written assertion is a
  decision for whoever owns that follow-up, not a drive-by from me — which is exactly the
  discipline I failed to apply to the read paths the first time.

If adopted, it should use the same `MemoryQueryScopeSchema` with the same `'workspace'`
default so all four endpoints read identically.

## `.mcp.json` non-atomic write — framing confirmed

I agree with the reviewer's framing: `fs.writeFileSync` with no temp-file + rename means a
crash or a disk-full between truncate and completion can leave a user-owned `.mcp.json`
truncated, after which every subsequent `JSON.parse` in both register and unregister throws
into the catch, logs, and leaves the file broken with no repair path but a manual edit.

It is **pre-existing** (the write predates A3 and Task 2.1 did not change its atomicity),
**out of Task 2.1's acceptance criteria**, and correctly recorded as a follow-up rather than
a blocker. What Task 2.1 _did_ have to get right — that a throw must not desync
`registeredMcpJsonPath` from disk — it does: the fields are only mutated after a successful
write, so a failed write leaves the record intact and a later `stop()` retries. The reviewer
verified this independently. A temp-file + rename hardening pass is worth its own small task
given the file is explicitly user-owned.

## Files changed in this revision (7)

| File                                                                                                       | Change                                                                                                     |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc\rpc-memory.types.ts`                             | `MemoryQueryScope` + `scope?` on both param types                                                          |
| `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\memory-rpc.schema.ts`               | `MemoryQueryScopeSchema` (default `'workspace'`), `MemoryStatsParamsSchema`, `scope` on the symbols schema |
| `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\memory-rpc.handlers.ts`             | `resolveReadScope(scope, workspaceRoot)`; Zod validation added to `memory:stats`; `scope` logged           |
| `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\memory-rpc.handlers.spec.ts`        | +7 scope tests                                                                                             |
| `D:\projects\ptah-extension\libs\frontend\memory-curator-ui\src\lib\services\memory-rpc.service.ts`        | `stats(workspaceRoot?, scope?)`                                                                            |
| `D:\projects\ptah-extension\libs\frontend\memory-curator-ui\src\lib\services\memory-state.service.ts`      | `resolveScopedWorkspaceRoot` returns `scope`; both loaders forward it                                      |
| `D:\projects\ptah-extension\libs\frontend\memory-curator-ui\src\lib\services\memory-state.service.spec.ts` | +3 all-scope tests, 2 updated assertions, header doc                                                       |

`purgeJunk` untouched, as instructed. `code-symbol.store.ts`, `memory.store.ts` and their
specs untouched — the store-level tri-state was verified correct and is not in question.

## Commands run, with results

| Command                                                                                                                                    | Result                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `npx jest --config .../rpc-handlers/jest.config.ts --testPathPatterns memory-rpc.handlers.spec`                                            | PASS — 63 passed (was 56; +7)                                                      |
| `npx nx test memory-curator-ui --skip-nx-cache`                                                                                            | PASS — 16 suites, 170 passed                                                       |
| `npx nx run-many -t test lint typecheck -p vscode-lm-tools memory-curator rpc-handlers shared memory-curator-ui dashboard --skip-nx-cache` | **Successfully ran targets test, lint, typecheck for 6 projects**                  |
| — rpc-handlers                                                                                                                             | 87 suites, 2440 passed / 31 skipped (was 2433; +7)                                 |
| — shared                                                                                                                                   | 43 suites, 1101 passed                                                             |
| — vscode-lm-tools                                                                                                                          | 42 suites, 822 passed (Task 2.1, already committed — no regression)                |
| — memory-curator                                                                                                                           | 23 suites passed / 2 skipped, 365 passed / 60 skipped                              |
| — memory-curator-ui                                                                                                                        | 16 suites, 170 passed                                                              |
| — dashboard                                                                                                                                | 3 suites, 37 passed                                                                |
| `npx nx run-many -t typecheck -p ptah-cli ptah-tui --skip-nx-cache`                                                                        | **Successfully ran typecheck for 2 projects** — the two `{}` callers still compile |
| `npx nx run-many -t lint ... \| grep <changed files>`                                                                                      | no output — **0 lint findings in any file changed in this revision**               |
| `npx prettier --check <all 7 changed files>`                                                                                               | PASS — all use Prettier code style                                                 |

No git commit created.

## Review issues — disposition

| Issue                                                                 | Status                                                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Critical 1 — `codeSymbols.search` breaks all-workspaces symbol search | FIXED via `scope: 'all'`; 3 backend + 2 frontend tests                                 |
| Critical 2 — `memory:stats` all-scope degrades to global-only         | FIXED via `scope: 'all'`; 4 backend + 1 frontend test                                  |
| Serious 3 — read-path blast radius not checked                        | ADDRESSED — full enumeration above, 6 call sites + the scope-toggle interaction        |
| Moderate 4 — stub-DB tests assert SQL text back at the impl           | ACKNOWLEDGED, unchanged — reviewer judged the combination acceptable and non-blocking  |
| Moderate 5 (FM3) — `.mcp.json` non-atomic write                       | AGREED as pre-existing / out of scope / follow-up; state-desync half confirmed handled |
| FM5 — CLI `memory stats` narrows to cwd                               | Behaviour kept, now an explicit Zod default rather than an accident                    |
