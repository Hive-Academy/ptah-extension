# Code Logic Review - TASK_2026_315 Batch 2

## Review Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall Score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Critical Issues     | 2              |
| Serious Issues      | 1              |
| Moderate Issues     | 2              |
| Failure Modes Found | 5              |

Task 2.1 (`.mcp.json` path symmetry, A3) is solid: both halves of the defect are
genuinely fixed, the fix is well tested (I ran the suite and confirmed 33/33
pass), disposal is wired, and the read-merge-write contract is proven to
survive a hand-authored file. Task 2.3 (A4, workspaceRoot scoping) correctly
fixes the specific bug it was scoped to (`memory:stats` / `codeSymbols.count`
returning a cross-workspace union with no workspace open) and the tri-state is
genuinely preserved at the store level. But the read-path fix for
`memory:searchSymbols` (`codeSymbols.search`) and a second-order effect on
`memory:stats` itself **silently break a real, currently-shipped, user-facing
"search/stats across all workspaces" feature** that the developer's own report
explicitly preserved for the sibling `memory:list`/`memory:search` endpoints —
and did not notice shares the exact same mechanism for `codeSymbols.search`
and for `memory:stats`'s "all" scope path. This is not hypothetical: it is
reachable from an existing, tested UI control with an existing code comment
asserting the now-false invariant.

## The 5 Paranoid Questions

### 1. How does this fail silently?

A user in the Memory tab (Electron) sets the scope filter to **"all"** —a real
UI toggle, `onScopeFilterChange` → `MemoryStateService.setScopeFilter('all')`
(`memory-curator-tab.component.ts:510-512`). This is documented, in the
component itself, as meaning "cross-workspace" data:
`memory-curator-tab.component.ts:426-428`:

```ts
// In 'all' scope the data is cross-workspace and identical before/after a
// switch, so there is nothing new to fetch — skip the round trips.
if (this.state.scopeFilter() === 'all') return;
```

After this batch:

- **Symbols**: `loadSymbols()` (`memory-state.service.ts:336-338`) still omits
  `workspaceRoot` for `'all'` scope, exactly as before. But `codeSymbols.search`
  is now routed through `resolveReadScope`, which treats an omitted key as
  "use `workspaceProvider.getWorkspaceRoot()`" — i.e. the **current**
  workspace, not "every workspace". The Symbols list silently narrows from a
  cross-workspace result set to a single-workspace one. Nothing errors, no
  test catches it, and the UI's own switch-skip optimization above is now
  actively wrong (skipping a refetch that would, if it ran, return different —
  narrower — data anyway).
- **Stats**: `loadStats()` (`memory-state.service.ts:291`) sends an _explicit_
  `null` for `'all'` scope (`memory-state.service.spec.ts:9-10` pins this as
  intentional: _"loadStats() honors the same scope decision (passes `null` in
  `'all'` mode...)"_). Before this batch, the handler's `params?.workspaceRoot
?? undefined` collapsed that `null` into `undefined` — which, by the very
  same collapse that IS the A4 bug, accidentally delivered the correct
  cross-workspace total. After the fix, `resolveReadScope` preserves the
  explicit `null` verbatim, so `'all'` scope stats now query
  `workspace_root IS NULL` instead of "every workspace". For `codeIndex`
  specifically this is a hard `0` in every case, since
  `code_symbols.workspace_root` is never NULL (the very fact this batch's own
  `purgeJunk` refusal relies on). For the memory tiers it silently reports only
  the global/unscoped subset instead of the true grand total.

Both are silent: no error, no log warning, no failing assertion — a stat tile
just quietly reports a smaller, wrong number, and a symbol search just quietly
returns fewer, wrong-scope results.

### 2. What user action causes unexpected behavior?

Toggling the Memory tab's scope filter to "All workspaces" and then either
searching Symbols or looking at the Stats tile. Both regressed by this batch,
neither is mentioned in the report, neither has a test.

### 3. What data makes this produce wrong results?

Any machine with more than one indexed workspace in
`~/.ptah/state/ptah-dev.sqlite` (exactly the log scenario TASK_2026_315 is
about — `property-hub` and `angular-3d-showcase` in the same session). "All
scope" symbol search now returns only the active workspace's rows; "all
scope" stats now returns zero code-symbols and only unscoped memories.

### 4. What happens when dependencies fail?

`IWorkspaceProvider.getWorkspaceRoot()` throwing or misbehaving is not a
realistic failure mode here (it's a plain accessor). The more relevant
dependency failure is `fs.writeFileSync` in `registerInMcpJson` /
`unregisterFromMcpJson` throwing mid-write (task explicitly asked this be
checked): the try/catch means `registeredMcpJsonPath`/`registeredPort` are
**not** mutated on a throw, so state stays consistent with disk and a later
`stop()`/`ensureRegisteredForSubagents()` retries — that part is right. What
is not addressed (pre-existing, not this batch's scope) is that
`writeFileSync` itself is not atomic (no temp-file+rename); a crash mid-write
can still leave a truncated/corrupt `.mcp.json`. Not a regression introduced
here, but a real gap this batch had the opportunity to note and did not.

### 5. What's missing that the requirements didn't mention?

The report verified blast radius meticulously for `purgeJunk` (the one caller,
its exact early-return) but did not perform the equivalent check for the READ
paths it touched (`memory:stats`, `memory:searchSymbols`) against the SAME
component's other consumption modes (`loadStats`, `loadSymbols`) — specifically
the `'all'` scope branch that both of those methods special-case. Tasks.md's
own precedent ("Left alone, deliberately" section, adjacent finding on
`memory:list`/`memory:search`) shows the team is aware this ambiguity exists
and chose to preserve it for two of four affected endpoints while breaking it
for the other two, without stating that decision anywhere.

## Failure Mode Analysis

### Failure Mode 1: `codeSymbols.search` "all scope" silently narrows to one workspace

- **Trigger**: Memory tab scope filter set to `'all'`, then a symbol search is
  performed (or any of the effects at `memory-curator-tab.component.ts:376-381`
  fire `loadSymbols()`).
- **Symptoms**: Symbol results only for the currently active workspace,
  presented as if they were the "all workspaces" result set the UI just asked
  for. No error, no indicator.
- **Impact**: Serious/Critical — user believes they searched every indexed
  workspace and did not; for someone auditing junk symbols or debugging what's
  indexed, this is a wrong-answer bug, exactly the class of defect this whole
  task exists to eliminate (A4 was itself "silent wrong scope").
- **Current handling**: None — `resolveReadScope` has no way to distinguish
  "no workspace open" from "user explicitly asked for all workspaces"; both
  arrive as an omitted key.
- **Recommendation**: Either (a) leave `codeSymbols.search`'s omitted-key
  semantics as "no filter" (matching `memory:list`/`memory:search`'s
  documented precedent) and instead fix the narrower, real A4 defect at the
  UI layer by having `memory-state.service.ts` pass an explicit `null` when no
  folder is open and `'workspace'` scope resolves to nothing (mirroring what
  `loadStats` already does), or (b) add an explicit third wire value / separate
  RPC param that distinguishes "all" from "unset", and keep `resolveReadScope`
  for the genuinely-ambiguous "unset" case only.

### Failure Mode 2: `memory:stats` "all scope" silently drops to global-only

- **Trigger**: Memory tab scope filter set to `'all'`; `loadStats()` fires
  (ngOnInit, scope-filter effect, indexing-completion effect).
- **Symptoms**: `codeIndex` in the stats tile is always `0` in "all" scope
  (was previously the true cross-workspace total); memory tier counts silently
  shrink to the unscoped-only subset.
- **Impact**: Critical — this is the exact `[memory] stats: {}` /
  cross-workspace-union failure class A4 was written to fix, just re-appearing
  from the opposite direction (under-counting instead of over-counting) for a
  path this batch did not consider.
- **Current handling**: None.
- **Recommendation**: Same options as Failure Mode 1 — either restore
  "all means no filter" for stats and push the no-workspace-open resolution
  into the caller, or introduce a real tri-state-plus-"all" wire contract.

### Failure Mode 3: `.mcp.json` write is non-atomic (pre-existing, unaddressed)

- **Trigger**: Process crash / disk-full / permission error between opening
  the file for write and the write completing.
- **Symptoms**: A `.mcp.json` left truncated or partially written; the next
  `JSON.parse(fs.readFileSync(...))` in `registerInMcpJson`/
  `unregisterFromMcpJson` throws, caught by the outer try/catch, logged, and
  the file is left corrupted with `registeredMcpJsonPath` unchanged (so a
  retry will try to parse the same broken file again and fail again).
- **Impact**: Moderate — user's `.mcp.json` (a hand-authored file per A3's own
  premise) could end up corrupted with no recovery path other than manual
  edit. Not introduced by this batch, and not asked for in Task 2.1's
  acceptance criteria, but the task prompt explicitly asked "what happens if
  writeFileSync throws mid-cycle" and the report does not address it.
- **Current handling**: Caught and logged; no corruption-repair, no
  temp-file+rename pattern.
- **Recommendation**: Out of this batch's scope to fix; worth a follow-up
  finding rather than a blocker here.

### Failure Mode 4: Stub-DB tests assert the implementation back at itself

- **Trigger**: N/A — a coverage-quality concern, not a runtime one.
- **Symptoms**: The 8 new `code-symbol.store.spec.ts` stub-DB tests
  (`describe('CodeSymbolStore — workspaceRoot tri-state (SQL shape)')`) assert
  literal substrings of the SQL the implementation itself emits (e.g.
  `expect(prepared[0]).toContain('WHERE workspace_root IS NULL')`). A future
  refactor that changes the SQL text while preserving semantics (e.g.
  `workspace_root IS NULL` → `workspace_root IS NULL /* comment */`, or a
  `CASE` rewrite) would fail these tests for a reason unrelated to the
  contract they're meant to protect, or — more worryingly — a refactor that
  silently reverts the fix but keeps matching substrings would still pass.
- **Impact**: Moderate. The report is honest about this being the weakest
  coverage in the batch. I agree with that self-assessment, and note that
  combined with the native-gated behavioral tests (which do assert real
  row-level effects, not string shape) the net coverage is acceptable, but not
  as strong as it looks from the "8 new tests" count alone.
- **Current handling**: Mitigated by the 3 native-gated behavioral tests that
  do assert real outcomes (`store.count('/ws/a')` etc.), which run wherever
  `better-sqlite3` loads natively.
- **Recommendation**: Acceptable as delivered; flagging for awareness, not
  blocking.

### Failure Mode 5: CLI/TUI `memory:stats` behavior changes from "global union" to "cwd-scoped" with no announcement

- **Trigger**: `ptah memory stats` (CLI) or the TUI Memory panel, both of
  which send `{}` (`apps/ptah-cli/src/cli/commands/memory.ts:239-241`,
  `apps/ptah-tui/src/components/thoth/MemoryPanel.tsx:94-98` — confirmed by
  direct read).
- **Symptoms**: Before this batch, these commands returned the sum across
  _every_ workspace ever indexed on the machine (the A4 bug, but also the
  CLI's only available behavior). After: `resolveReadScope` resolves the
  omitted key to `CliWorkspaceProvider.getWorkspaceRoot()`, which — verified in
  `cli-workspace-provider.ts:65-70,80-82` — always resolves to `process.cwd()`
  or `--workspace`, never `undefined`. So `ptah memory stats` now reports only
  the current directory's workspace stats.
- **Impact**: This is a **behavior change**, but I judge it correct and an
  improvement (a CLI user typing `ptah memory stats` almost certainly wants
  their current project's stats, not a global union) — consistent with the
  report's framing. Flagging only because it is a real, visible change in CLI
  output that isn't called out as a compatibility note anywhere (no CHANGELOG,
  no doc update). Not a blocker.
- **Current handling**: N/A — this is the intended new behavior.
- **Recommendation**: No code change needed; consider a one-line doc/changelog
  note since `ptah memory stats` output size will visibly shrink for anyone
  who was relying on (or confused by) the old union behavior.

## Critical Issues

### Issue 1: `codeSymbols.search`'s fix breaks the "all workspaces" symbol search feature

- **File**: `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:317-357` (`resolveReadScope` applied at `:339`)
- **Scenario**: User selects scope `'all'` in the Memory tab and searches
  Symbols. `libs/frontend/memory-curator-ui/src/lib/services/memory-state.service.ts:336-338`
  omits `workspaceRoot` deliberately (mirrors `memory:list`/`memory:search`'s
  documented "global search" contract, pinned by the existing test
  `memory-rpc.handlers.spec.ts:219` — _"passes undefined workspaceRoot to
  search.searchRich when param is absent (global search)"_).
- **Impact**: Silent, wrong, narrower results presented as the requested
  cross-workspace set. No test, frontend or backend, exercises this path
  end-to-end, so nothing catches it.
- **Evidence**: `resolveReadScope`'s doc comment
  (`memory-rpc.handlers.ts:143-166`) frames the omitted case purely as "the
  host's current workspace root, or null" — it never considers "the caller
  explicitly wants every workspace", which is exactly what the omitted key
  means for its sibling `memory:list`/`memory:search` endpoints one method
  away in the same file.
- **Fix**: Either revert `codeSymbols.search`'s routing through
  `resolveReadScope` (matching the "left alone, deliberately" precedent
  already applied one section down for `memory:list`/`memory:search`), pushing
  the actual A4 fix for symbols to the frontend call site instead (send `null`
  explicitly when `'workspace'` scope has no root, as `loadStats` already
  does) — or introduce a real "all" signal at the wire boundary so the RPC
  layer can distinguish it from "unset".

### Issue 2: `memory:stats`'s "all scope" silently degrades from a cross-workspace total to a global-only (often-zero) one

- **File**: `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:296-315`
- **Scenario**: `memory-state.service.ts:282-299` (`loadStats`) sends an
  explicit `null` for `'all'` scope — pinned as intentional by
  `memory-state.service.spec.ts:9-10`. Before this fix, the handler's `??`
  collapse turned that `null` into `undefined`, which — via the same bug this
  batch fixes — happened to deliver the correct "every workspace" total for
  the `'all'`-scope UI case. `resolveReadScope` now preserves the `null`
  verbatim, converting it into "global/unscoped rows only".
- **Impact**: The Stats tile's `codeIndex` field becomes a hard `0` under
  "all" scope always (`code_symbols.workspace_root` is never `NULL` — the
  same fact the batch's own `purgeJunk` refusal is built on), and the memory
  tier counts silently shrink to whatever has a `NULL` workspace_root instead
  of the true grand total.
- **Evidence**: `memory.store.ts:611-642` tri-state doc comment; the
  fresh tests at `memory.store.spec.ts` pin `null` → `WHERE workspace_root IS
NULL` and `undefined` → no predicate, exactly the two states now reachable —
  but no test exercises `loadStats`'s specific `null`-for-`'all'`-scope
  contract end to end against this handler.
- **Fix**: Same two options as Issue 1 — treat this as a UI/wire contract gap
  between "all scope" and "global/unscoped", not purely a backend
  responsibility. At minimum, this needs to be surfaced and decided
  deliberately rather than shipped as a side effect.

## Serious Issues

### Issue 3: Report's blast-radius check for the read paths is narrower than its check for the destructive path

- **File**: `.ptah/specs/TASK_2026_315/batch-2-report.md:220-221`
- **Scenario**: The report states, for `purgeJunk`: _"Nothing shipped
  regresses: the only caller (`memory-curator-tab.component.ts:466-475`)
  early-returns when there is no root and always passes a concrete string."_
  This claim is verified true (confirmed independently by reading the
  component). But the equivalent verification was not performed — or at least
  not reported — for the two READ paths this same task changed
  (`memory:stats`, `memory:searchSymbols`), both of which are called from
  multiple sites in the same component with a scope toggle the purgeJunk
  claim never had to consider.
- **Impact**: This is why Issues 1 and 2 shipped undetected — the review
  methodology applied rigorously to the destructive path was not applied to
  the read paths, even though the read paths were explicitly the subject of
  Task 2.3's acceptance criteria ("Also check whether `codeSymbols.search`...
  share the leak; fix them if they do").
- **Fix**: Re-run the same blast-radius check against every call site of
  `MemoryRpcService.stats` and `.searchSymbols` (not just `.purgeJunk`),
  including the scope-filter interaction, before merging.

## Data Flow Analysis

```
Memory tab "all" scope toggle
        │
        ▼
MemoryStateService.resolveScopedWorkspaceRoot()
        │
        ├── loadStats():        scoped.workspaceRoot(undefined) ?? null  ──►  { workspaceRoot: null }
        │                                                                        │
        │                                                            memory-rpc.handlers.ts:303
        │                                                            resolveReadScope(null) → null  [GAP 1]
        │                                                            store.stats(null) = "global only"
        │                                                            (was: undefined = true union, pre-fix)
        │
        └── loadSymbols():      ...(workspaceRoot !== undefined ? {workspaceRoot} : {})  ──►  {} (omitted)
                                                                          │
                                                              memory-rpc.handlers.ts:339
                                                              resolveReadScope(undefined)
                                                                → getWorkspaceRoot() ?? null  [GAP 2]
                                                              codeSymbols.search({workspaceRoot: '<current ws>'})
                                                              (was: undefined = true union, pre-fix)
```

### Gap Points Identified:

1. **GAP 1** — `resolveReadScope` cannot tell "no workspace open, default
   scope" from "explicit global scope request sent as `null`". Both look
   identical once at the RPC boundary.
2. **GAP 2** — `resolveReadScope` cannot tell "no workspace open" from
   "explicit `'all'` scope request sent by omission". Both look identical as
   an absent key.
3. Neither gap is a new architectural flaw — both existed before this batch
   too, in a different form (the collapse bug happened to make the `'all'`
   scope case work by accident). The fix correctly closes the _intended_
   defect (no-workspace-open) but reopens it in reverse for the _deliberate_
   all-scope case, because the RPC contract has no way to express "all" as
   distinct from "unset".

## Requirements Fulfillment

| Requirement                                                                       | Status   | Concern                                                                                                                               |
| --------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A `memory:stats` call with no workspace no longer returns a cross-workspace union | COMPLETE | Verified true for the default/no-folder-open path                                                                                     |
| `workspaceRoot: null` still returns exactly the global/unscoped memories          | COMPLETE | Verified — but this now also silently applies to the `'all'`-scope UI path that did not intend it                                     |
| Same treatment applied to `codeSymbols.count`                                     | COMPLETE | Verified via `workspaceClause` + tests                                                                                                |
| `codeSymbols.search` and `purgeJunk` checked — both share the leak, both fixed    | PARTIAL  | `purgeJunk` fix is correct and well-verified; `codeSymbols.search`'s fix breaks the deliberate `'all'`-scope search feature (Issue 1) |
| `skillSynthesis:listCandidates` / `cron:list` / `gateway:*` untouched             | COMPLETE | Confirmed untouched                                                                                                                   |
| `.mcp.json` register/unregister path-symmetric (A3)                               | COMPLETE | Verified thoroughly, tests pass, hand-authored-file survival proven                                                                   |
| Windows absolute paths, `catch (error: unknown)`, no stubs, hexagonal boundary    | COMPLETE | No `platform-{vscode,electron,cli}` imports found in any of the 8 files; no new stubs                                                 |

### Implicit Requirements NOT Addressed:

1. The "all scope" cross-workspace search/stats feature in the Memory tab is
   an implicit requirement that predates this task and was not named in
   `context.md`/`tasks.md`, but it is a real, tested, currently-shipped
   feature that this batch's own file set (`memory-rpc.handlers.ts`) directly
   interacts with. "Do not regress anything shipped" implicitly covers it.
2. No CHANGELOG/doc note that `ptah memory stats` (CLI/TUI) output narrows
   from a global union to the current directory's workspace — a real,
   user-visible behavior change, judged correct here but unannounced.

## Edge Case Analysis

| Edge Case                                              | Handled       | How                                                                          | Concern                                                                                 |
| ------------------------------------------------------ | ------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `memory:stats` with no workspace open, default scope   | YES           | `resolveReadScope` → `getWorkspaceRoot() ?? null`                            | None — this is the actual A4 bug and it's fixed                                         |
| `memory:stats` with `'all'` scope selected             | NO            | `resolveReadScope` preserves the explicit `null` verbatim                    | Silently degrades to global-only (Issue 2)                                              |
| `memory:searchSymbols` with `'all'` scope selected     | NO            | `resolveReadScope` resolves the omitted key to the current workspace         | Silently narrows to one workspace (Issue 1)                                             |
| `purgeJunk` with omitted/`null` workspaceRoot          | YES           | Explicit `RpcUserError('INVALID_PARAMS')`, unconditional authorization check | None — correctly fixed and well tested                                                  |
| `.mcp.json` workspace switch A → B                     | YES           | `syncMcpJsonRegistration` push mechanism, verified by passing test           | None                                                                                    |
| `.mcp.json` last folder removed                        | YES           | `getMcpJsonPath()` → null, unregister without re-register, verified          | None                                                                                    |
| `.mcp.json` hand-authored file with user's own servers | YES           | Read-merge-write preserved, verified by passing test with `$schema` too      | None                                                                                    |
| `.mcp.json` write throws mid-cycle                     | PARTIAL       | State (`registeredMcpJsonPath`) not mutated on throw, so retry is safe       | File itself could still be left corrupted (non-atomic write); pre-existing, unaddressed |
| CLI/TUI `memory:stats` / no `--workspace` given        | YES (changed) | Now scopes to `process.cwd()` instead of global union                        | Behavior change judged correct but unannounced                                          |

## Integration Risk Assessment

| Integration                                     | Failure Probability   | Impact                                          | Mitigation                                                 |
| ----------------------------------------------- | --------------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| Memory tab "all" scope ↔ `memory:searchSymbols` | HIGH (100% when used) | Silent wrong-scope results                      | None currently; needs Issue 1 fix                          |
| Memory tab "all" scope ↔ `memory:stats`         | HIGH (100% when used) | Silent under-count, `codeIndex` always 0        | None currently; needs Issue 2 fix                          |
| `.mcp.json` writer ↔ user-owned file            | LOW                   | Corruption on crash mid-write (pre-existing)    | Try/catch prevents state desync; no atomic-write hardening |
| CLI `memory stats` ↔ `CliWorkspaceProvider`     | LOW                   | Output narrows to cwd — correct but unannounced | None needed; documentation only                            |

## Verdict

**Recommendation**: REVISE

**Confidence**: HIGH

**Top Risk**: The `codeSymbols.search` and `memory:stats` fixes silently break
the Memory tab's "all workspaces" scope toggle — a real, currently shipped,
tested feature — while the developer's own report demonstrates full awareness
of exactly this ambiguity (it is the reason `memory:list`/`memory:search` were
deliberately left untouched) but did not apply the same reasoning to the two
endpoints it did touch that share the identical mechanism.

Task 2.1 (`.mcp.json`, A3) is approved as delivered — I found no issues in it
beyond a pre-existing, out-of-scope non-atomicity note. Task 2.3 (A4) needs a
revision pass specifically on the `'all'`-scope interaction for
`memory:stats` and `memory:searchSymbols` before this batch should land; the
purgeJunk refusal and the store-level tri-state fix are both correct and
well-tested as they stand.

## What Robust Implementation Would Include

- A wire-level distinction between "workspace unset because nothing is open"
  and "workspace unset because the user explicitly asked for every
  workspace" — e.g. a `scope: 'all' | 'workspace'` parameter alongside
  `workspaceRoot`, rather than overloading the presence/absence and
  nullability of a single field to carry three-to-four meanings across
  different endpoints inconsistently.
- A single shared frontend helper (used by `refresh`, `search`, `loadStats`,
  `loadSymbols` alike) so `'all'` scope is encoded identically for every RPC
  call it drives, instead of three different encodings (`{}`-omitted for
  list/search/symbols, explicit `null` for stats) that only stayed
  behaviorally equivalent by accident of the pre-fix bug.
- An integration-level test (or at least a documented manual check) exercising
  the Memory tab's scope toggle against the real RPC handlers, not just
  frontend-mocked and backend-mocked unit tests in isolation — the gap here
  exists precisely because both sides tested their own contract assumptions
  without a test asserting they still agree with each other.
- Atomic writes (temp file + rename) for `.mcp.json`, given it is explicitly
  called out as a user-owned file with a blocking, non-transactional write.

## Re-review after revision

**Scope of this pass**: Task 2.3 only (A4, workspaceRoot scoping). Task 2.1
(`.mcp.json`) is out of scope — already approved and committed as `3cfba7b`.
The findings above are preserved verbatim as the record of what was wrong;
everything below verifies the fix against source, not against the developer's
report.

### What I checked, and how

I read `memory-rpc.handlers.ts`, `memory-rpc.schema.ts`, `rpc-memory.types.ts`,
`memory-rpc.service.ts`, and `memory-state.service.ts` in full, traced the real
call path for both `loadStats()` and `loadSymbols()` from the UI signal down to
`resolveReadScope`, diffed every touched file against `HEAD` (not against the
report's prose) to confirm the store files and `memory:list`/`memory:search`
are byte-for-byte untouched, and independently re-ran the test suites rather
than trusting the reported counts:

- `npx jest --config libs/backend/rpc-handlers/jest.config.ts --testPathPatterns memory-rpc.handlers.spec` → **63 passed, 63 total** (report claimed 63; confirmed).
- `npx nx test memory-curator-ui --skip-nx-cache` → **170 passed, 170 total** (report claimed 170; confirmed).
- `npx nx run-many -t typecheck -p ptah-cli ptah-tui shared rpc-handlers memory-curator-ui dashboard --skip-nx-cache` → clean, confirming the two `{}`-sending callers (`apps/ptah-cli/src/cli/commands/memory.ts:240`, `apps/ptah-tui/src/components/thoth/MemoryPanel.tsx:97`) still compile against the new required-shape schema.

### Critical 1 — `codeSymbols.search` all-scope narrowing — CLOSED

`memory-rpc.handlers.ts:372-375` now calls `resolveReadScope(validated.scope,
validated.workspaceRoot)`, and `resolveReadScope` (`:189`) returns `undefined`
unconditionally when `scope === 'all'`, before it ever looks at
`workspaceRoot`. `memory-state.service.ts:350-353` (`loadSymbols`) sends
`scope: scoped.scope` and omits `workspaceRoot` for all-scope
(`resolveScopedWorkspaceRoot` returns `workspaceRoot: undefined` at `:161`
when `scope === 'all'`). Traced end to end: all-scope search now reaches
`CodeSymbolStore.search({ workspaceRoot: undefined, ... })`, which is the
"no predicate" branch — a genuine cross-workspace union, not the
current-workspace narrowing the first revision shipped. Confirmed by a fresh
test run, not just by reading the assertion: `scope:'all' spans every
workspace (undefined = no predicate)` and its no-folder-open sibling both pass
against the real handler.

### Critical 2 — `memory:stats` all-scope degrading to global-only — CLOSED

`memory-rpc.handlers.ts:333-341`: `resolveReadScope` is called with
`validated.scope` before `this.store.stats(workspaceRoot)` and
`this.codeSymbols.count(workspaceRoot)`. `memory-state.service.ts:298-302`
(`loadStats`) sends `scopedRoot = null` **and** `scope: 'all'` together in
all-scope mode. Traced: `resolveReadScope('all', null)` hits the `scope ===
'all'` branch first and returns `undefined` — the explicit `null` the tab
sends is never reached, so it can no longer collapse into "global/unscoped
only". `codeIndex` is no longer forced to `0` in all-scope; it gets the true
cross-workspace count. Verified by source trace, and independently by the
passing test `scope:'all' produces the cross-workspace union (undefined = no
predicate)` against the real `resolveReadScope`/`store.stats` call.

### Direction 2 (no-workspace-open path) — still fixed, not re-broken

Checked both directions as asked. With `scope` omitted (Zod default
`'workspace'`) and `workspaceRoot` omitted, `resolveReadScope('workspace',
undefined)` still falls to
`this.workspaceProvider.getWorkspaceRoot() ?? null` — the exact A4 fix,
untouched by the `scope` branch which only short-circuits on `'all'`. The
original defect (cross-workspace union with no folder open) cannot recur
through this path: reaching `undefined` now requires `scope === 'all'`
explicitly, which no caller sends except the Memory tab's own toggle.

### Default genuinely preserves existing callers — confirmed by typecheck + trace

`ptah memory stats` (`memory.ts:240`) and `MemoryPanel.tsx:97` (via
`MemoryPanel.tsx:94-98` `loadStats`) both send `{}`. `MemoryStatsParamsSchema`
requires neither field; `MemoryQueryScopeSchema` defaults to `'workspace'`
inside `.parse({})`. Traced: `resolveReadScope('workspace', undefined)` →
`CliWorkspaceProvider.getWorkspaceRoot()` (verified in the original review at
`cli-workspace-provider.ts:65-70,80-82` to always return `process.cwd()` or
`--workspace`, never `undefined`) → cwd-scoped stats, same behavior this
review already judged correct. A required `scope` would have broken both
callers by rejecting `{}`; the `.default('workspace')` on
`MemoryQueryScopeSchema` is what keeps them green, confirmed here by a clean
typecheck of both apps against the new schema.

### Zod boundary — sound, single default site

`memory:stats` had **no** Zod schema before this batch (confirmed by reading
the pre-revision handler, which read `params?.workspaceRoot ?? undefined`
straight off the wire) — it has one now
(`MemoryStatsParamsSchema`). `MemoryQueryScopeSchema =
z.enum(['all','workspace']).default('workspace')` is defined once in
`memory-rpc.schema.ts` and imported by both `MemoryStatsParamsSchema` and
`MemorySearchSymbolsParamsSchema` — one default site, not two copies that
could drift. An invalid value is rejected, not silently defaulted: confirmed
by the passing tests `rejects an unknown scope value` for both `memory:stats`
and `memory:searchSymbols`, which assert `INVALID_PARAMS` and that the
downstream store method was never called — Zod's `z.enum` only applies
`.default()` to a **missing** key, not to a key present with a bad value, and
the test suite pins that distinction rather than assuming it.

### Tri-state and the fourth-combination question

Store-level tri-state (`undefined` = no filter, `null` = `WHERE
workspace_root IS NULL`) is untouched — confirmed by diffing
`code-symbol.store.ts` and `memory.store.ts` against `HEAD`: zero lines
changed in this revision, exactly as the report claims. `resolveReadScope`
composes with it by strict precedence, not by inventing a fourth state:
`scope === 'all'` short-circuits to `undefined` **unconditionally** — line
`:189` returns before `workspaceRoot` is even inspected. So `scope: 'all'`
plus an explicit `workspaceRoot` is reachable at the wire (Zod does not
reject the combination) but is well-defined, not ambiguous: `workspaceRoot`
is discarded and `'all'` wins. This is deliberately tested
(`scope:'all' ignores an explicit workspaceRoot rather than narrowing`), and
no production caller ever sends both — `resolveScopedWorkspaceRoot()` in the
frontend returns `workspaceRoot: undefined` whenever `scope === 'all'`
(`:161`), so the combination is theoretical at today's call sites. Worth
naming as a residual soft spot (a future caller could send both and get
silent precedence rather than a validation error), but not a defect: it is
the same "explicit intent wins over a stale companion field" shape as
`purgeBySubjectPattern`'s own contract, and it is covered by a test, unlike
the original A4 gap which had none.

### `purgeJunk` — untouched, confirmed by diff

`git diff HEAD` on `memory-rpc.handlers.ts` shows no lines touching the
`memory:purgeJunk` handler beyond what was already reviewed and approved in
the first pass (the refusal-on-null/undefined logic and the unconditional
`isAuthorizedWorkspace` check). The revision's stated files-changed list (7
files) does not include `code-symbol.store.ts`, and the purgeJunk block in
the handler is identical to what this review already approved.

### Frontend encodings — unified, not quadrupled

Before this revision there were three encodings of "all" (`{}`-omitted for
list/search/symbols, explicit `null` for stats) that only agreed by accident
of the pre-fix bug — this review's own "What Robust Implementation Would
Include" section named exactly this gap. `resolveScopedWorkspaceRoot()`
(`memory-state.service.ts:156-168`) now returns `{ workspaceRoot, scope }` as
one unit; `loadStats` and `loadSymbols` both destructure it and forward
`scope` verbatim rather than re-deriving it. `refresh()`/`search()`
(`memory:list`/`memory:search`) still use the pre-existing `workspaceRoot`
convention and do not send `scope` at all — confirmed correct, not a fourth
encoding, because those two endpoints were deliberately left alone (see
below) and still read an omitted key as "no filter," which is what `refresh`/
`search` send. Two endpoints on the new `scope` contract, two endpoints on the
old (compatible) contract — not four inconsistent shapes.

### `memory:list` / `memory:search` — confirmed unchanged, recommendation is sound

`git diff HEAD` on `memory-rpc.handlers.ts` shows zero lines touching the
`memory:list` or `memory:search` handler bodies. The recommendation to adopt
`scope` there too, as a follow-up rather than a drive-by, is the right call:
their current all-scope behavior (omitted key → no filter) is already
correct and shipped, so changing it now would be scope creep against an
already-passing contract test
(`memory-rpc.handlers.spec.ts:219`), not a fix. Flagging the CLI/TUI's
`memory:list` cross-workspace list as the same A4 class at lower severity is
an honest, correctly-scoped observation, not a dodge.

### Scope-toggle interaction — verified by direct read, not assumed

`memory-curator-tab.component.ts:424-428` still reads:

```ts
// In 'all' scope the data is cross-workspace and identical before/after a
// switch, so there is nothing new to fetch — skip the round trips.
if (this.state.scopeFilter() === 'all') return;
```

This comment was the first revision's own indictment (Failure Mode 1 quoted
it as now-false). With `scope: 'all'` genuinely reaching both `memory:stats`
and `memory:searchSymbols` unconditionally, the invariant the comment asserts
is true again — confirmed by reading the current file, not by trusting the
report's claim that it is.

### Residual, non-blocking observations

1. `scope: 'all'` + an explicit `workspaceRoot` is a reachable-but-unused wire
   combination that resolves by silent precedence rather than a Zod
   `.refine()` rejecting it outright. No current caller triggers it and it is
   tested, so this is a note for future callers, not a defect in this batch.
2. The CLI/TUI's `memory:list` cross-workspace list (same A4 mechanism, lower
   severity) remains open as a named follow-up, correctly out of this batch's
   file set.
3. The `.mcp.json` non-atomic write (Failure Mode 3 / Moderate) and the
   stub-DB SQL-shape tests (Failure Mode 4 / Moderate) are unchanged and
   remain accurate as originally recorded — neither was in scope for this
   revision and neither regressed.

### Verdict

**APPROVED.** Both Critical issues are closed, verified by source trace and
by independently re-run tests rather than by trusting the report. The
no-workspace-open fix (the actual A4 defect) is intact in both directions.
The Zod boundary is sound: validated, single default site, invalid values
rejected. The tri-state is untouched at the store level and composes with
`scope` by well-defined (tested) precedence. `purgeJunk` is byte-for-byte
unchanged. The frontend now has one encoding of scope intent instead of
three-to-four. `memory:list`/`memory:search` are confirmed untouched and the
recommendation to defer their `scope` adoption is sound. Task 2.3 is ready to
land.
