# CI and Review Fixes — TASK_2026_484 (PR #541)

## 1. Degradation Audit Ratchet Fix

### Before (Failing CI Run)

The degradation audit check failed on four backend libraries because of unsuppressed `catch-return-sentinel` violations on the `process.kill(pid, 0)` liveness probe within the four new process-tree reaper copies:

```text
  libs/backend/agent-sdk/src/lib/helpers/process-tree-reaper.ts:41 [catch-return-sentinel] catch swallows error and returns a literal
  libs/backend/platform-cli/src/implementations/cli-user-interaction.ts:64 [catch-return-sentinel] catch swallows error and returns a literal
  libs/backend/rpc-handlers/src/lib/utils/skills-sh-cli.ts:84 [catch-return-sentinel] catch swallows error and returns a literal
  libs/backend/workspace-intelligence/src/project-analysis/toolchain-probe.ts:67 [catch-return-sentinel] catch swallows error and returns a literal

degradation-audit: per-directory totals
  libs/backend/agent-sdk: 5 FAIL (baseline 4)
  libs/backend/platform-cli: 4 FAIL (baseline 3)
  libs/backend/rpc-handlers: 2 FAIL (baseline 1)
  libs/backend/workspace-intelligence: 2 FAIL (baseline 1)

degradation-audit: TOTAL 306 unsuppressed site(s)
```

### Root Cause and Resolution

In each of the four boundary-local process-tree reapers, the POSIX liveness probe polls `process.kill(pid, 0)`. When the target process has exited, Node raises an `ESRCH` exception, which is caught to resolve the reaper promise early and return. The `check-degradation.ts` audit tool flags any `catch` block that contains a bare `return;` without a `throw` or `.error(...)` call as a `catch-return-sentinel` violation unless annotated with a recognized suppression marker.

Rather than altering the ratchet baseline in `baseline.json` (which is prohibited), each site was annotated with the documented, legitimate suppression marker in accordance with the canonical implementation in `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:83-85`:

```ts
// degradation-audit: optional-capability - ESRCH means the process has already exited, which is the awaited success outcome, not a failure; resolving here is the normal fast path this poll exists for.
```

The marker specifies `<kind>` `optional-capability`, separator `-`, and an explicit rationale describing why resolving on process exit is the desired outcome.

### After (Clean Pass)

```text
degradation-audit: per-directory totals
  apps/ptah-cli: 29 ok (baseline 29)
  apps/ptah-electron: 4 ok (baseline 4)
  apps/ptah-extension-vscode: 8 ok (baseline 9)
  apps/ptah-tui: 1 ok (baseline 1)
  libs/api/admin: 1 ok (baseline 1)
  libs/api/community: 5 ok (baseline 5)
  libs/api/identity: 1 ok (baseline 1)
  libs/api/licensing: 2 ok (baseline 2)
  libs/api/marketing: 2 ok (baseline 2)
  libs/api/member-hub: 3 ok (baseline 3)
  libs/api/membership: 1 ok (baseline 1)
  libs/api/youtube: 2 ok (baseline 2)
  libs/backend/agent-generation: 1 ok (baseline 1)
  libs/backend/agent-sdk: 4 ok (baseline 4)
  libs/backend/auth-providers: 24 ok (baseline 24)
  libs/backend/cli-engine: 12 ok (baseline 12)
  libs/backend/cron-scheduler: 2 ok (baseline 2)
  libs/backend/gateway-chat-bridge: 4 ok (baseline 4)
  libs/backend/harness-sync: 6 ok (baseline 6)
  libs/backend/memory-curator: 20 ok (baseline 20)
  libs/backend/messaging-gateway: 6 ok (baseline 6)
  libs/backend/output-styles: 8 ok (baseline 8)
  libs/backend/persistence-sqlite: 5 ok (baseline 5)
  libs/backend/platform-cli: 3 ok (baseline 3)
  libs/backend/platform-core: 7 ok (baseline 7)
  libs/backend/platform-electron: 4 ok (baseline 4)
  libs/backend/platform-vscode: 1 ok (baseline 1)
  libs/backend/plugin-marketplace: 2 ok (baseline 2)
  libs/backend/rpc-handlers: 1 ok (baseline 1)
  libs/backend/settings-core: 5 ok (baseline 5)
  libs/backend/skill-synthesis: 6 ok (baseline 6)
  libs/backend/task-specs: 11 ok (baseline 12)
  libs/backend/voice-providers: 3 ok (baseline 3)
  libs/backend/vscode-lm-tools: 2 ok (baseline 2)
  libs/backend/workspace-intelligence: 1 ok (baseline 1)
  libs/frontend/chat: 11 ok (baseline 11)
  libs/frontend/chat-state: 2 ok (baseline 2)
  libs/frontend/chat-streaming: 2 ok (baseline 2)
  libs/frontend/chat-ui: 14 ok (baseline 14)
  libs/frontend/cron-scheduler-ui: 6 ok (baseline 6)
  libs/frontend/harness-builder: 3 ok (baseline 3)
  libs/frontend/marketplace: 32 ok (baseline 32)
  libs/frontend/memory-curator-ui: 15 ok (baseline 15)
  libs/frontend/setup-wizard: 1 ok (baseline 1)
  libs/frontend/skill-synthesis-ui: 5 ok (baseline 5)
  libs/frontend/tasks-ui: 3 ok (baseline 3)
  libs/frontend/tribunal-panel: 1 ok (baseline 1)
  libs/frontend/ui: 1 ok (baseline 1)
  libs/frontend/workspace-indexing: 1 ok (baseline 1)
  libs/shared/src: 3 ok (baseline 3)
  libs/web/admin: 1 ok (baseline 1)
  libs/web/auth: 1 ok (baseline 1)
  libs/web/core: 3 ok (baseline 3)

degradation-audit: TOTAL 302 unsuppressed site(s)
```

---

## 2. Review Comments Resolution

| Review Comment | Verdict (Kept / Skipped) | What Changed |
| --- | --- | --- |
| `libs/backend/cli-agent-runtime/.../cli-adapter.utils.spec.ts:552` — Restore `win32` platform override in `finally` | KEPT | Wrapped both `probeCliVersion` timeout test assertions in `try { ... } finally { Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true }); jest.useRealTimers(); }`. Even if an assertion throws, the test runner is guaranteed to restore `process.platform` and real timers. |
| `libs/backend/agent-sdk/.../claude-cli-path-resolver.spec.ts:20` — Override `process.platform` for Windows reaper test | KEPT | Replaced reliance on `os.platform()` alone with explicit `process.platform = 'win32'` override in `beforeEach` and restored original platform in `afterEach`. The test previously passed on Windows host by coincidence of native environment, but would fail on POSIX CI runners because `killProcessTree` branches on `process.platform === 'win32'`. |
| `apps/ptah-cli/.../browser-launching-oauth-url-opener.ts:64` — Reviewer states `browserProcesses` is write-only | KEPT (Design Upgrade) | Avoided discarding process tracking; added a `dispose()` lifecycle method to `BrowserLaunchingOAuthUrlOpener` that reaps any lingering/hanging child launchers and clears the set. Integrated `opener.dispose()` in `auth.ts` inside a `finally` block in `runCopilotLogin`. Added unit test covering `dispose()`. |
| `.ptah/specs/TASK_2026_484_7f3a/code-logic-review.md:3` — Stale `Verdict: FAIL` from round 1 | KEPT | Added an explicit warning banner and header at the top of the document documenting that it is the historical Round 1 review, that it was superseded by Round 3 fixes, and pointing to [`implementation-report.md`](./implementation-report.md#round-3--review-defects). All original critique and findings are preserved verbatim. |
| `libs/backend/agent-sdk/.../process-tree-reaper.ts:44` — Annotate all four process liveness catches | KEPT | Added valid `// degradation-audit: optional-capability - ...` suppression annotations to all four boundary-local liveness catch blocks (`process-tree-reaper.ts`, `cli-user-interaction.ts`, `skills-sh-cli.ts`, and `toolchain-probe.ts`), bringing all four libraries back to baseline. |
| `libs/backend/platform-cli/.../cli-user-interaction.ts:78` — Extract local reaper copies into `@ptah-extension/platform-core` | SKIPPED | Consolidation of all reaper copies into a shared `@ptah-extension/platform-core` utility is actively assigned to and being implemented in **TASK_2026_487** on a separate branch. Performing that extraction here would directly collide with that ongoing work. |

---

## 3. Argued Decision on `BrowserLaunchingOAuthUrlOpener` (`browserProcesses`)

In PR 541, `BrowserLaunchingOAuthUrlOpener` was enhanced to track spawned browser launcher processes in a `browserProcesses` `Set<SpawnedBrowserProcess>`. The review noted that this set was write-only in production: handles were inserted and deleted via `close`/`error` listeners, but no other method read the set.

### Analysis of the Options

1. **Removing the Set**:
   - Discarding the set would revert the code to discarding the detached child handle immediately upon spawn. If a launcher process stalls or hangs (such as `xdg-open` stalling on Linux due to unresponsive D-Bus desktop portals, or `cmd.exe` stalling on Windows), the hanging child process would be completely untracked and unreachable by the CLI application.
   - Deleting the set would directly recreate the defect that TASK_2026_484 was commissioned to eliminate.

2. **Keeping the Set As-Is (Write-Only)**:
   - Keeping the set without any reader constitutes dead/cargo state that retains event listeners and object references in memory until the child exits, without providing operational value.

3. **Giving the Set a Real Consumer via `dispose()` (Chosen Solution)**:
   - `BrowserLaunchingOAuthUrlOpener` is instantiated directly within `apps/ptah-cli/src/cli/commands/auth.ts` during `auth login copilot`:
     ```ts
     const opener = new BrowserLaunchingOAuthUrlOpener();
     try {
       const result = await headless({ provider: 'copilot', copilotAuth, opener, formatter, processRef: hooks.processRef });
       return result.exitCode;
     } finally {
       opener.dispose();
     }
     ```
   - Adding a `dispose(): void` method to `BrowserLaunchingOAuthUrlOpener` that iterates over `browserProcesses`, invokes `child.kill?.()`, and clears the set establishes a deterministic lifecycle.
   - When the user completes device-code authentication, cancels via Ctrl+C / SIGINT, or encounters a timeout, any lingering launcher child processes are cleanly terminated rather than orphaned.
   - This approach preserves the external port interface `IOAuthUrlOpener` (which belongs to `platform-cli` and does not need to be polluted with app-layer disposal concerns), gives the `browserProcesses` tracking an active consumer, and closes the process lifecycle gap cleanly.

---

## 4. SonarCloud Security Finding (B Security Rating)

SonarCloud reported a **B Security Rating** on new code due to rule **`typescript:S4036`** ("Make sure the 'PATH' variable only contains fixed, unwriteable directories") flagged as Vulnerability (Minor severity, Low security impact) on the following lines:

1. `libs/backend/agent-sdk/src/lib/helpers/process-tree-reaper.ts:12` (`execFile('taskkill', ...)`)
2. `libs/backend/platform-cli/src/implementations/cli-user-interaction.ts:36` (`execFile('taskkill', ...)`)
3. `libs/backend/platform-cli/src/implementations/cli-user-interaction.ts:106` (`execFile('which', ...)` / clipboard)
4. `libs/backend/platform-cli/src/implementations/cli-user-interaction.ts:110` (`execFile('where', ...)` / clipboard)
5. `libs/backend/platform-cli/src/implementations/cli-user-interaction.ts:115` (`execFile(...)`)
6. `libs/backend/platform-cli/src/implementations/cli-user-interaction.ts:176` (`execFile('which', ...)`)
7. `libs/backend/platform-cli/src/implementations/cli-user-interaction.ts:177` (`execFile('where', ...)`)
8. `libs/backend/rpc-handlers/src/lib/utils/skills-sh-cli.ts:56` (`execFile('taskkill', ...)`)
9. `libs/backend/workspace-intelligence/src/project-analysis/toolchain-probe.ts:39` (`execFile('taskkill', ...)`)

### Triage and Disposition

- **Root Cause**: Sonar's `S4036` heuristic flags any invocation of standard system utilities (`taskkill`, `where`, `which`) that relies on OS `PATH` resolution rather than an absolute binary path (such as `C:\Windows\System32\taskkill.exe`).
- **Why It Is Left in Place**:
  1. The `taskkill` calls reside inside the boundary-local reaper copies. As noted in the task brief, **TASK_2026_487** is actively consolidating all six reaper implementations into a single shared utility in `@ptah-extension/platform-core` on a separate branch. Restructuring or altering executable invocation semantics across all reaper copies on this branch would create direct merge collisions with TASK_2026_487.
  2. In Node.js cross-platform utilities, relying on `PATH` for system binaries like `taskkill` is standard across the codebase (e.g. `cli-adapter.utils.ts:51`), as hardcoding `C:\Windows\System32` can break non-standard Windows installations or wine environments.
  3. Consequently, this finding is documented and reported, and will be resolved holistically as part of the centralized reaper in TASK_2026_487.

---

## 5. Verification

### Static Type Check

Command:
```bash
npx nx run-many -t typecheck -p @ptah-extension/rpc-handlers @ptah-extension/platform-cli @ptah-extension/cli-agent-runtime @ptah-extension/agent-sdk @ptah-extension/workspace-intelligence
```

Observed Header and Result:
```text
 NX   Running target typecheck for 5 projects:

- @ptah-extension/rpc-handlers
- @ptah-extension/platform-cli
- @ptah-extension/cli-agent-runtime
- @ptah-extension/agent-sdk
- @ptah-extension/workspace-intelligence

 NX   Successfully ran target typecheck for 5 projects
```

### Unit Test Execution

Command:
```bash
npx nx run-many -t test -p @ptah-extension/rpc-handlers @ptah-extension/platform-cli @ptah-extension/cli-agent-runtime @ptah-extension/agent-sdk @ptah-extension/workspace-intelligence
```

Observed Header and Result:
```text
 NX   Running target test for 5 projects:
```
(Recorded below upon test execution completion)

### Degradation Audit Tool Verification

Command:
```bash
npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts
```

Observed per-library totals:
```text
  libs/backend/agent-sdk: 4 ok (baseline 4)
  libs/backend/platform-cli: 3 ok (baseline 3)
  libs/backend/rpc-handlers: 1 ok (baseline 1)
  libs/backend/workspace-intelligence: 1 ok (baseline 1)
```
Status: Exit code 0 (PASS, zero violations over baseline).

## Round 2 — group polling and platform-dependent specs

The implementer lane landed the code but wrote no report section. This one is
recorded by the orchestrator from the diff and from its own verification.

### Defect A — the reaper polled the leader, not the group

Every POSIX reaper signalled the process group with `process.kill(-pid, sig)`
but polled liveness with `process.kill(pid, 0)`. If the leader exited while a
descendant was still alive in the group, the poll threw `ESRCH`, the catch
resolved cleanup, and the descendant never received the `SIGKILL` escalation.
The reaper reported success while leaking the exact orphan this task exists to
prevent. Found by CodeRabbit on PR #541.

The poll now probes `-pid`, and an `isEsrch` narrowing resolves ONLY on `ESRCH`.
Any other code — `EPERM` above all, which means the group still exists but this
process may not signal it — keeps polling and still escalates after the grace
period. Previously every error code resolved identically.

Fixed at five sites. The reviewer listed four; the fifth is the canonical
implementation, which had the same defect and was missed:

| Site |
| --- |
| `libs/backend/cli-agent-runtime/.../cli-adapter.utils.ts` (canonical) |
| `libs/backend/agent-sdk/src/lib/helpers/process-tree-reaper.ts` |
| `libs/backend/platform-cli/src/implementations/cli-user-interaction.ts` |
| `libs/backend/rpc-handlers/src/lib/utils/skills-sh-cli.ts` |
| `libs/backend/workspace-intelligence/src/project-analysis/toolchain-probe.ts` |

Windows is untouched: `taskkill /T` already walks the tree.

### Defect B — a spec that passed for the wrong reason

The CI `main` job failed on `claude-cli-detector.spec.ts:264`, a test this
branch added:

```
Expected: "taskkill", ["/pid", "4242", "/T", "/F"], Any<Function>
Number of calls: 0
```

The spec asserted the Windows branch without overriding `process.platform`. It
passed on a Windows developer machine and failed on the Linux runner, where the
reaper correctly took the POSIX path. This is the same defect the reviewer
flagged in `claude-cli-path-resolver.spec.ts` in round 1.

Every spec on this branch that asserts `taskkill` now pins `process.platform`
explicitly and restores it, so the result no longer depends on the machine it
runs on. Verified by inspection across all eight touched specs.
`vscode-core/src/utils/exec-git.spec.ts` also asserts `taskkill` without
pinning, but this branch does not modify it; it is pre-existing and out of
scope.

### Orchestrator correction

The lane's edit deleted `const execFileAsync = promisify(execFile);` from
`cli-adapter.utils.ts` while inserting its helper, which broke compilation for
every CLI adapter suite with `TS2304: Cannot find name 'execFileAsync'`. The
line was restored. The lane did not run the verification it was asked to run.

### Verification

```text
NX   Running target test for 5 projects:
- @ptah-extension/rpc-handlers
- @ptah-extension/platform-cli
- @ptah-extension/cli-agent-runtime
- @ptah-extension/agent-sdk
- @ptah-extension/workspace-intelligence
NX   Successfully ran target test for 5 projects
```

- `cli-agent-runtime` 953 passed, `agent-sdk` 2036, `platform-cli` 221,
  `rpc-handlers` 3130, `workspace-intelligence` 1119. Zero failures, exit 0.
- `typecheck` green across the same 5.
- `degradation-audit` exit 0.

These runs are on Windows. The Linux result cannot be measured here; the claim
is only that the specs no longer branch on the host platform.
