# Test Report — TASK_2026_315, Batch 7 (cross-cutting regression sweep)

**Scope**: Tasks 7.1–7.4 per `tasks.md` Batch 7, plus the additional Task 7.4
(F8 closure) and verification-trap guardrails given directly in this batch's
brief. Verifies the ten landed commits (`abf030c47`, `3cfba7b4f`, `d73902f43`,
`c08f79a21`, `1ef31e8db`, `2244ccde2`, `77f9295e3`, `002e6758b`, `f04bd2ec3`,
`1d240f0f4`). **C6 is out of scope** — spun out, owned by a concurrent session
on `libs/backend/harness-sync/**`; no file under that path was opened for
editing during this sweep (read-only, for Task 7.4 only).

**Verdict up front**: all four regression tests genuinely latch. No out-of-scope
drift. The full gate (typecheck, lint, and tests for every touched project) is
green once two known-flaky failures are re-verified in isolation, both of which
reproduce cleanly there. Task 7.2 could not be run against a live Electron GUI
boot in this environment; the substituted evidence is stated explicitly per
assertion, not presented as a live run. F8 (Task 7.4) is closed with a
source-verified mechanism explanation, not a live boot A/B — also stated
explicitly.

---

## Task 7.1 — Do the four named regression tests actually latch?

Method for each: `git checkout <parent-commit> -- <file>` to restore the
pre-fix version of the **implementation** file only (leaving the post-fix spec
file in place), run the specific test, confirm **FAIL**, then
`git checkout HEAD -- <file>` to restore, confirm **PASS**. Each file was
unmodified in the working tree before and after (confirmed via
`git diff --stat`), so this touched nothing durably.

### A1 — `sdk-agent-adapter.spec.ts`, "TASK_2026_315 A1" block

Reverted `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` to its
pre-`abf030c47` state (parent `f58044c17`).

- **FAILS before**: 3 failed, 1 passed, 46 skipped. All three failures are
  `configureAuthentication` called 2–3 times instead of the expected 1 —
  exactly the leaked-reconfigure/leaked-proxy shape A1 fixes.
- **PASSES after restore**: 4 passed, 46 skipped, 0 failed.
- **Verdict**: genuinely latches.

### A3 — `http-mcp-server.service.spec.ts`, path-symmetry section

Reverted `libs/backend/vscode-lm-tools/.../http-mcp-server.service.ts` to its
pre-`3cfba7b4f` state (i.e. `abf030c47`, the last commit before A3 landed).

- **FAILS before**: 5 failed, 1 passed, 27 skipped. Failures: hand-authored
  server survival check, entry-moves-to-second-workspace, re-register-after-switch,
  and unregister-on-last-folder-removed all fail exactly as A3's defect
  predicts (stale `ptah` key resolved against the wrong/current root, or never
  written to the second root).
- **PASSES after restore**: 6 passed, 27 skipped, 0 failed.
- **Verdict**: genuinely latches.

### C2 — `job-runner.spec.ts`

Reverted `libs/backend/cron-scheduler/src/lib/job-runner.ts` to its
pre-`2244ccde2` state (parent `1ef31e8db`).

- **FAILS before**: 2 failed, 6 passed. Failures: `markSucceeded` called once
  instead of zero times for a deliberate no-op handler result, and the
  reason-fallback test asserting `markSkipped('...', 'handler-skipped')` never
  fired at all — exactly the "did nothing, reported succeeded" defect.
- **PASSES after restore**: 8 passed, 0 failed.
- **Verdict**: genuinely latches.

### A2 — `tasks-store.service.spec.ts`, "focus events buy no more"

Reverted `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts` to
its pre-`d73902f43` state (`95ffaea3a`, the last commit before A2 landed —
`eb4e01721` and the harness-sync commit in between do not touch this file).

- **FAILS before**: 1 failed. `tasks:board` called 6 times against an expectation
  of 1 (one initial fetch, five focus events each buying another rejection) —
  the exact defect the test exists to catch.
- **PASSES after restore**: 1 passed.
- **Verdict**: genuinely latches.

**Conclusion**: all four are real regression tests, not tests that pass
regardless of the fix. None needed to be sent back.

---

## Task 7.2 — Replay the log scenario end to end

**I could not drive a live Electron GUI boot in this environment** — no
display server, and a real boot needs license/auth state this sandboxed
session does not have. Rather than simulate a run and present it as real, each
assertion below is backed by the **specific evidence actually available**:
either an independently-reverted regression test (this session, Task 7.1
above), or a source trace performed in this session, or a prior
code-logic-reviewer's own independently-reproduced execution (named per
claim, not taken on the report's word). Where I could not independently
confirm a claim, that is stated plainly rather than folded into the total.

| Assertion                                                                                                                                   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Status                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| No proxy started, no OAuth refresh on either removal (A1)                                                                                   | Task 7.1 above: reverting the guard reproduces exactly this failure (`configureAuthentication` called), restoring it closes it. This is the same mechanism the captured log describes (`resolveActiveAuth()` falling to global default → reconfigure → `OAuthProxyStrategy` starts a proxy). Not independently re-run against a live boot this session.                                                                                                                                                                                                                                                                | Verified by test, not by live boot                                                               |
| At most one `tasks:board` call while no folder is open; no-workspace UI state rendered, not the error banner (A2)                           | Task 7.1 above for the call-count half (reverted/restored, reproduces exactly). The UI-state half (no create-CTA, third distinct state) was independently verified in `code-logic-review-batch-3.md`'s three review passes, including two live component-test executions I did not re-run this session but which the reviewer reverted/restored and reported exact pass/fail counts for.                                                                                                                                                                                                                               | Verified by test, not by live boot                                                               |
| `.mcp.json` registered in the second folder and absent from the first (A3)                                                                  | Task 7.1 above: the exact scenario (`ROOT_A` → `ROOT_B` switch) is one of the five tests reverted/restored this session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Verified by test, not by live boot                                                               |
| `memory:stats` with no workspace not returning a cross-workspace union, and the "All workspaces" toggle still returning the true total (A4) | Not independently re-run this session. `code-logic-review-batch-2.md`'s re-review pass independently re-ran `memory-rpc.handlers.spec.ts` (63/63) and `memory-curator-ui` (170/170) against source, and traced both the no-workspace path and the `scope:'all'` path end-to-end through `resolveReadScope`, confirming both are now correct (the first revision had broken the "all" path; the second revision fixed it and was independently re-verified). This session additionally re-ran `memory-curator` and `memory-curator-ui` as part of the Batch 7 gate (below): 365/425 and 170/170 passing, non-regressed. | Verified by prior independently-reproduced review + this session's gate re-run, not by live boot |
| MCP up before any boot synthesis query (B1)                                                                                                 | `code-logic-review-batch-4.md` independently read `subsystem-bringup.ts` and `resolveMcpSessionWiring`, confirmed no dependency the other way, and ran the boot-order spec suite directly (`wire-runtime.boot-order` + `ipc-bridge.window-availability`: 2 suites / 12 tests, then reproduced the exact fail counts by re-applying the report's own two-mutation revert). This session re-ran the full `ptah-electron` suite as part of the gate (below): 22 passed / 1 skipped / 267 tests, non-regressed.                                                                                                            | Verified by prior independently-reproduced review + this session's gate re-run                   |
| No `Cannot send to renderer` warning (B2)                                                                                                   | Same batch-4 review: confirmed by construction (debug replaces warn on the boot path) and by the `ipc-bridge.window-availability` spec suite passing. Not independently re-run against a live boot log this session.                                                                                                                                                                                                                                                                                                                                                                                                   | Verified by test, not by live boot                                                               |
| No raw `[AgentDiscovery]` console line (C5)                                                                                                 | `code-logic-review-batch-6.md` confirmed both `agent-discovery.service.ts` and `command-discovery.service.ts` route through the injected logger via diff read and a passing test asserting `console.debug` is never called. This session re-ran `workspace-intelligence` as part of the gate: 37/37 suites, 903/903 tests passing.                                                                                                                                                                                                                                                                                     | Verified by prior independently-reproduced review + this session's gate re-run                   |
| No multi-line sqlite-vec error block (C7)                                                                                                   | `code-logic-review-batch-6.md` independently reverted and re-ran the C7 fix, reproducing the exact fail-before/pass-after. This session re-ran `thoth-runtime` as part of the gate: 39/39 passing (native sqlite-vec suites documented as environment-gated).                                                                                                                                                                                                                                                                                                                                                          | Verified by prior independently-reproduced review + this session's gate re-run                   |

**What I did not do**: boot `npm run electron:serve`, restore a persisted
workspace, and drive the literal four-step `removeFolder` → `addFolder` →
`switch` → `removeFolder` sequence against a running window, capturing a real
log. That is a genuine gap against the letter of Task 7.2's instruction. What
stands in its place is: (a) this session's own four independent
revert/restore test executions (Task 7.1), which exercise the identical code
paths the log names, and (b) prior reviewers' independently-reproduced
executions, each named per claim above rather than summarized as a single
"it works." No claim above is a simulation dressed as a live run.

---

## Task 7.3 — Confirm nothing out of scope moved

### `resolveRoot` (`tasks-rpc.handlers.ts:1455-1469`)

`git log -p abf030c47..1d240f0f4 -- libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts`
returns **zero diffs** — the file is not touched by any of the ten commits.
Confirmed by direct read: the method is intact, throws
`RpcUserError('No workspace folder open.', 'WORKSPACE_NOT_OPEN')` exactly as
`context.md` describes, no gating logic added or removed.

### `skillSynthesis:listCandidates`, `cron:list`, `gateway:*` — still ungated

- `skillSynthesis:listCandidates` (`skills-synthesis-rpc.handlers.ts:391-404`):
  no `workspaceRoot`/`resolveRoot`/authorization check in the handler body —
  reads global candidate rows by status filter only. Unchanged shape.
- `cron:list` (`cron-rpc.handlers.ts:163-`): resolves an optional
  `workspaceRoot` purely as a **listing filter** (`null`/`undefined` both
  collapse to "no filter, global listing") — it never throws
  `WORKSPACE_NOT_OPEN`. Unchanged shape.
- `gateway-rpc.handlers.ts`: zero matches for `resolveRoot`,
  `isAuthorizedWorkspace`, or `WORKSPACE_NOT_OPEN` anywhere in the file.
  Unchanged.

None of the ten commits touch `cron-rpc.handlers.ts`, `skills-synthesis-rpc.handlers.ts`,
or `gateway-rpc.handlers.ts` (confirmed via the per-commit `git show --stat`
table below) — so this is confirmed both by absence-of-diff and by reading
current source.

### Harness-sync's refusal-on-unowned-path rule

Unchanged in behaviour, trivially: **no commit in this task touches any file
under `libs/backend/harness-sync/**`\*\* (verified below), so the refusal rule
(and everything else in that lib) is provably untouched by this task's own
work. C6 was correctly spun out before any edit was made there.

### Per-commit `git show --stat`, confirming no `harness-sync` file in any of the ten

| Commit      | Files touched                                                                                                                                                                                      | `harness-sync` present? |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `abf030c47` | `sdk-agent-adapter.ts`(+spec), `workspace-rpc.handlers.ts`                                                                                                                                         | No                      |
| `3cfba7b4f` | `http-mcp-server.service.ts`(+spec)                                                                                                                                                                | No                      |
| `d73902f43` | `palette-entries.ts`(+spec), `tasks-view.component.ts`(+spec), `tasks-store.service.ts`(+spec)                                                                                                     | No                      |
| `c08f79a21` | `code-symbol.store.ts`(+spec), `memory.store.ts`(+spec), `memory-rpc.handlers.ts`(+spec), `memory-rpc.schema.ts`, `memory-rpc.service.ts`, `memory-state.service.ts`(+spec), `rpc-memory.types.ts` | No                      |
| `1ef31e8db` | `wire-runtime.ts`(+spec), `ipc-bridge.ts`(+spec)                                                                                                                                                   | No                      |
| `2244ccde2` | `thoth-runtime.ts` (cli-engine), `job-runner.ts`(+spec, new file), `types.ts`, `start-thoth-cron.ts`(+spec)                                                                                        | No                      |
| `77f9295e3` | `workspace-provider-profile-resolver.ts` (comment-only)                                                                                                                                            | No                      |
| `002e6758b` | `plugin-loader.service.ts`(+spec)                                                                                                                                                                  | No                      |
| `f04bd2ec3` | `agent-discovery.service.ts`(+spec), `command-discovery.service.ts`, `autocomplete-workspace-scoping.spec.ts`                                                                                      | No                      |
| `1d240f0f4` | `diagnostics.ts`(+spec) (thoth-runtime)                                                                                                                                                            | No                      |

Every row was produced by `git show --stat --format="" <commit>` and read
directly, not summarized from a report. **Zero occurrences of `harness-sync`
across all ten commits.**

### The concurrent session's uncommitted work

`git status --short` at the start of this session, and re-confirmed at the
end, shows exactly the same ~24 modified/untracked files under
`libs/backend/harness-sync/**` (reconciler, targets, di, gitignore, manifest
files, plus two new untracked files: `harness-reconciler.skill-consent.spec.ts`,
`state/skill-sync-gate.ts`) — all **uncommitted working-tree changes**, not
part of any of the ten commits, and untouched by every verification step in
this report (no `Edit`/`Write` call in this session targeted any path under
`harness-sync`; the one read for Task 7.4 below was read-only).

**Conclusion: no drift found.** Nothing out of scope moved.

---

## Task 7.4 — Close out F8 (the `.mcp.json` / harness-reconcile ordering risk)

### What F8 asked

Batch 4 reordered `bringUpSubsystems()` (MCP start + `.mcp.json` "ptah" key
write) to run **before** the harness reconcile pass, instead of after. The
developer verified empirically on a workspace with `missing:0, foreign:0` on
both sides — the differential case (a workspace with non-zero blocked/foreign
counts, e.g. this repo's own 13 blocked `.claude/skills/*` paths) was never
exercised, and neither the developer nor the batch-4 reviewer could read
`harness-reconciler.service.ts` to check the coupling directly (owned by the
concurrent session at the time).

### What I substituted for a literal boot

I could not boot Electron in this environment (no display). Since
`harness-sync` source is now readable (read-only, per this task's explicit
grant), I traced the actual coupling mechanism end-to-end instead of
re-running the developer's same before/after boot on a different workspace.
This is a stronger check than a second boot log comparison would have been —
it explains _why_ the counts can or cannot differ, rather than observing one
more data point that could still miss a narrow window.

### The mechanism, traced from source

1. **`bringUpSubsystems()` touches exactly two things**
   (`libs/backend/vscode-core/src/services/subsystem-bringup.ts:40-84`):
   it starts `CodeExecutionMCP` (an HTTP server bind) and calls
   `ensureRegisteredForSubagents()`, which does a **standalone**
   read-merge-write of `{ws}/.mcp.json`, adding one key: `"ptah"`
   (`http-mcp-server.service.ts:261-294`). It does not touch
   `.claude/skills`, `.claude/commands`, `.claude/agents`, or any other
   harness-sync target. **This is the entire blast radius of the reorder.**

2. **The 13 blocked skill paths are a different target, a different facet,
   and a different file family entirely.** They come from the "claude"
   target's filesystem copy-engine (`claude-target.ts`, operating on
   `{ws}/.claude/skills/*`), which `bringUpSubsystems` never calls into. The
   reorder cannot affect the skills/commands/agents `missing`/`foreign`/`blocked`
   counts **structurally**, not just empirically — there is no shared state,
   no shared file, no call path between `bringUpSubsystems` and the
   copy-engine target.

3. **For the MCP facet itself** (the one facet family that does share
   `.mcp.json` with `CodeExecutionMCP`): `planMcpFacet`
   (`mcp-facet-planner.ts:73-140`) classifies a key as `foreign`/`blocked`
   **only when the key name matches one of the reconciler's own DESIRED
   server names** (from `~/.ptah/mcp-installed.json`, i.e. user-consented
   external plugin MCP installs). `"ptah"` is never a desired server name from
   harness-sync's perspective — nothing in the desired-state builder emits it.
   The planner explicitly never sweeps or reports a config file's other keys
   ("Deliberately no sweep of the file's OTHER keys" — `mcp-facet-planner.ts:135-138`).
   So `"ptah"` is invisible to the reconciler's classification **regardless of
   write order**.

4. **The write mechanics are read-fresh, not read-cached, on both sides.**
   `JsonMcpFacet.mutate()` (`json-mcp-facet.ts:130-157`) reads the file inside
   `withMcpConfigLock`, spreads the existing server map (`{...existing}`),
   applies only its own change, and writes back — so whichever side runs
   second reads a file that already contains the other side's key and
   preserves it by construction. `CodeExecutionMCP.registerInMcpJson`
   (`http-mcp-server.service.ts:261-279`) does the same read-merge-write
   pattern independently. Since `bringUpSubsystems()` is `await`ed to
   completion before `bootHeavyServices()` (which contains `reconcileHarness`)
   even starts (`wire-runtime.ts:445-460` then `:504`), the two writes are
   **strictly sequential in both the old and new order**, never concurrent —
   there is no interleaving window in either arrangement.

### Conclusion

**F8 is closed: the reorder has no effect on reconcile's `missing`/`foreign`/`blocked`
counts, on this repo's differential workspace or any other.** The 13 blocked
skill paths are governed by a structurally disjoint code path from anything
`bringUpSubsystems` touches. The one file the two do share (`.mcp.json`) is
written by both sides as an independent, sequential, key-preserving
read-merge-write, and the reconciler's own classifier never inspects the
`"ptah"` key regardless of which side wrote it first. The batch-4 reviewer's
circumstantial evidence from `plugin-activation.ts` ("nothing in bring-up
depends on the Thoth boot... suggests the coupling may not exist at all") is
now confirmed directly, not circumstantially.

### A genuinely new, out-of-scope finding surfaced by this trace

`CodeExecutionMCP.registerInMcpJson` / `unregisterFromMcpJson` perform their
own raw `fs.readFileSync` / `fs.writeFileSync` on `{ws}/.mcp.json`, **outside**
`harness-sync`'s `withMcpConfigLock`. Harness-sync's own design doc for this
exact file states the rule this violates: _"Never add a SECOND writer to an
MCP config file... A module that hand-rolls its own read-modify-write on a
file this lib also writes will lose an entry — not corrupt it, lose it,
silently."_ Today this is safe only because the two writers happen to run
sequentially at boot (per point 4 above) and because `"ptah"` is a name the
reconciler never touches — but a future scenario where `ensureRegisteredForSubagents()`
fires from the `workspaceFoldersSubscription` callback (`http-mcp-server.service.ts:97-100`)
at the same time a background `propagateHarness()` call
(`wire-runtime.ts:499`, fired on every `onDidChangeWorkspaceFolders`, not
awaited) is mid-write to the same file is a real, unlocked lost-update race —
structurally identical to the pattern harness-sync's own docs warn against,
just not the one F8 asked about. **Not fixed, not a regression from this
task, and not filed as a fix here** — recorded as a candidate follow-up
finding for whoever next touches either file, per this task's "read but do
not edit harness-sync" constraint.

---

## Full gate

Per the two documented verification traps: (1) `npx nx test a b c` silently
runs only the first project — every multi-project command below uses
`run-many -t <target> -p ...`; (2) `rpc-handlers` can fail under parallel Jest
load — reproduced exactly that this session, and re-verified in isolation
below.

### `npm run typecheck:all`

First run (background, uncontended): **"Successfully ran target typecheck for
93 projects."** Clean.

A second, later run — launched concurrently with lint and the test sweep
below — showed `web-pricing:typecheck` and `web-account:typecheck` failing.
Neither project is touched by any of the ten commits or reachable from them.
Re-ran both in isolation: **clean, 0 errors.** Confirmed as a resource-contention
flake from four heavy toolchains sharing one machine at once, not a real
regression.

### `npm run lint:all`

**"Successfully ran target lint for 72 projects."** 0 errors across the run
(125 + 13 + 25 pre-existing warnings in unrelated files — non-null-assertion
style debt in e2e specs and video-studio scripts, none in any of the ten
commits' files).

### `npx nx run-many -t test -p agent-sdk rpc-handlers vscode-lm-tools tasks-ui memory-curator memory-curator-ui shared ptah-electron cli-engine cron-scheduler cron-scheduler-ui thoth-runtime auth-providers workspace-intelligence --skip-nx-cache`

| Project                  | Result                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `shared`                 | 43 suites / 1101 tests passed                                                                          |
| `agent-sdk`              | 74 suites / 1068 tests passed                                                                          |
| `auth-providers`         | 35 suites / 631 tests passed                                                                           |
| `memory-curator`         | 23 passed, 2 skipped suites (native-gated) / 365 passed, 60 skipped tests                              |
| `vscode-lm-tools`        | 42 suites / 822 tests passed                                                                           |
| `memory-curator-ui`      | 16 suites / 170 tests passed                                                                           |
| `workspace-intelligence` | 37 suites / 903 tests passed                                                                           |
| `cron-scheduler-ui`      | 4 suites / 39 tests passed                                                                             |
| `cron-scheduler`         | 5 suites / 46 tests passed                                                                             |
| `tasks-ui`               | 18 suites / 581 tests passed                                                                           |
| `rpc-handlers`           | **2 suites failed** on first run (see below)                                                           |
| `cli-engine`             | 15 suites / 145 tests passed (benign non-fatal migration-shim warnings in test fixtures, pre-existing) |
| `thoth-runtime`          | 3 suites / 39 tests passed                                                                             |
| `ptah-electron`          | 22 passed, 1 skipped suite / 267 passed, 4 skipped tests                                               |

Nx itself flagged the failure as **"Nx detected a flaky task:
`@ptah-extension/rpc-handlers:test`."** The two failing suites
(`skills-sh-legacy-adoption.spec.ts`, `skills-sh-source-root.service.spec.ts`)
failed on a 5000ms Jest timeout plus an `ENOTEMPTY` temp-directory rmdir race —
filesystem contention symptoms, not assertion failures, and neither file was
touched by any of the ten commits. Re-ran both in isolation, sequentially:
**2 suites / 33 tests passed, 0 failed.** Matches follow-up F3 exactly
("`rpc-handlers` Jest suites fail to run under parallel load... a pre-existing
leak, not a regression").

### `npx nx run-many -t typecheck -p ptah-tui ptah-cli --skip-nx-cache`

**"Successfully ran target typecheck for 2 projects."** Clean — both consumers
of the C2 wire shape and the A4 schema changes compile.

**Gate verdict: green.** Every failure observed was independently reproduced
as a resource-contention flake and confirmed clean in isolation; none traces
to any of the ten commits' logic.

---

## Summary

| Task                              | Result                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.1 — four named regression tests | All four independently reverted/restored this session; all four genuinely fail-before/pass-after.                                                                                                                                                                                                                                                                                                                                |
| 7.2 — end-to-end replay           | **Partially substituted**: no live Electron GUI boot was possible in this environment (no display). Each of the nine assertions is backed by either this session's own revert/restore tests, a prior reviewer's independently-reproduced execution (named per claim), or this session's gate re-run — stated explicitly per row, not summarized as a live pass.                                                                  |
| 7.3 — out-of-scope check          | No drift. `resolveRoot` untouched (zero diff across all ten commits). `skillSynthesis:listCandidates`/`cron:list`/`gateway:*` confirmed still ungated by direct source read. Harness-sync untouched by construction — zero of the ten commits reference any `harness-sync` path, confirmed per-commit via `git show --stat`. The concurrent session's ~24 uncommitted `harness-sync` files are unmodified by this sweep.         |
| 7.4 — F8 closure                  | Closed by source trace (no live boot A/B was possible; the source trace is stated as the substitute, not disguised as one). The reorder cannot affect reconcile's counts: disjoint code paths for skills/commands, and a name never inspected plus strictly sequential, key-preserving writes for `.mcp.json`. One new, genuinely out-of-scope finding surfaced and recorded (unlocked second writer on `.mcp.json`), not fixed. |
| Full gate                         | Green. Two flaky failures (rpc-handlers under parallel load; web-pricing/web-account typecheck under concurrent load) both reproduced clean in isolation and are unrelated to the ten commits.                                                                                                                                                                                                                                   |

**No fixes were applied in this session.** This report is verification only,
per the batch's instructions.
