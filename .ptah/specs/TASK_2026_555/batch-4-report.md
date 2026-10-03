# Batch 4 report — D8 spawn reader reads the file store (TASK_2026_555)

**Status: COMPLETE.** Task 4.1 done. The BLOCKED check ran first and returned
**NOT BLOCKED**, with the trace below.

## BLOCKED check (required first): would the fix drop values stored only in VS Code settings?

**Finding: NOT BLOCKED.** No product-offered path ever put the four fixed keys into VS Code
settings.json, so nothing a supported surface wrote can be lost.

Trace (file:line, all in the worktree):

- Writer: `agent:setConfig` → `setAgentOrchestration` writes
  `setConfiguration('ptah', 'agentOrchestration.<name>')`
  (`libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.ts:1037-1043`; the read helper at
  `:1020-1030` uses the same form).
- Routing: a read/write reaches the file store only when
  `section === 'ptah' && isFileBasedSettingKey(key)`
  (`libs\backend\platform-vscode\src\implementations\vscode-workspace-provider.ts:80-82` read,
  `:100-109` write; any other section falls to `vscode.workspace.getConfiguration(section)` at
  `:83-84`, i.e. VS Code settings.json). Every key the four fixed reads use is file-routed
  (`libs\backend\platform-core\src\file-settings-keys.ts:162-172`: `codexModel`, `copilotModel`,
  `cursorModel`, `antigravityModel`, `opencodeModel`, `piModel`, `codexReasoningEffort`,
  `copilotReasoningEffort`, `piReasoningEffort`, `codexAutoApprove`, `copilotAutoApprove`).
  So the UI-written values always landed in `~/.ptah/settings.json` — and the pre-fix reader,
  which passed `('ptah.agentOrchestration', '<key>')`, never saw them. That is the bug.
- VS Code manifest: `apps\ptah-extension-vscode\package.json:252-267` contributes only
  `ptah.agentOrchestration.preferredAgentOrder`, `.maxConcurrentAgents` and `.sdkIdleReleaseMs`.
  None of the four fixed key families is contributed, so the VS Code Settings UI never offered
  them and no Ptah code wrote them to settings.json.
- Migrations: `migrateAgentOrchestrationSettings`
  (`agent-rpc.handlers.ts:1076-1129`) copies legacy **stateStorage** values into the file store
  (it calls `setConfiguration('ptah', stateKey, …)` at `:1111`, i.e. the file route) and never
  reads VS Code settings.json. `libs\backend\settings-core\src` has no `agentOrchestration`
  migration at all (grep: no matches). Nothing needed to move, because no writer ever wrote these
  keys to the host config.
- Residual edge (documented, not silent): a hand-edited **uncontributed** key such as
  `ptah.agentOrchestration.codexModel` in settings.json (VS Code flags it "Unknown Configuration
  Setting") was readable by the pre-fix reader and is not read after the fix. No supported surface
  ever produced such a value, and the plan (`implementation-plan.md:271-288`) prescribes exactly
  this reader form. The new spec pins the post-fix property explicitly (host config is not
  consulted for these file-routed keys), so the behaviour change is asserted, not hidden.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-spawn-environment.service.ts`
  — the four `('ptah.agentOrchestration', '<key>')` reads now use `('ptah', 'agentOrchestration.<key>')`:
  `piReasoningEffort` (resolveReasoningEffort, pi branch), `codex/copilotReasoningEffort`
  (effort fallback), `copilotAutoApprove` (resolveAutoApprove), and `MODEL_CONFIG_KEYS[cli]`
  (resolveModel). Defaults unchanged (`''`/`true`).
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-spawn-environment.settings-routing.spec.ts`
  — the one regression spec. Its fake workspace provider honours the real rule
  (`section === 'ptah' && isFileBasedSettingKey(key)` → file map; otherwise a host-config map
  keyed by the full dotted path), with separate read and write routing, exactly like the real
  providers. 7 cases: a value written with the writer's key form reaches `resolveModel('codex')`;
  the same for `copilotReasoningEffort`; the UI effort still wins; pi effort passes through raw;
  `copilotAutoApprove` reads from the file store; defaults (`undefined`/`true`/`undefined`) hold
  when the store is empty; and the host config is not consulted for these keys.
- NOT MODIFIED `agent-process-manager.service.spec.ts` — its `getConfiguration` stub
  (`:302-323`) normalises both key forms (it looks up `agentOrchestration.<key>` via `fullKey` at
  `:316-318`), so it stays green after the fix. It cannot *detect* the bug — which is precisely why
  the plan asks for a new spec that honours the real routing rule instead. No change needed; no
  existing assertion was edited.

## Verification

Command (Batch 4 verify, foreground):

```
npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-agent-runtime
```

Result: **typecheck, test and lint all succeeded** (run duration 36.6 s; nx reports all 3 targets
green).

A second run intended to execute only the new spec (`npx nx test @ptah-extension/cli-agent-runtime
--testPathPattern=…`) did not forward the pattern and ran the full suite instead — which makes it
usable as the full-suite evidence: **69 suites, 1250 passed, 1 skipped, 0 failed** (1 snapshot
passed). The known flake `capabilities/claude-approval.reader.spec.ts` passed in both runs.

Gate G: not applicable — no commit was made (git stays with the team-leader), and Batch 4 is
serialised before Batch 16 in the batch order.

## Plan deviations

None. The four reads were replaced exactly as `implementation-plan.md:271-288` (Component 3)
prescribes, matching the sibling reads at `agent-spawn-environment.service.ts:196-256`
(`sdkIdleReleaseMs`, `maxConcurrentAgents`, `disabledClis`, `preferredAgentOrder`).

## Risks handled

- **Silent loss of VS Code-stored values** — ruled out by the BLOCKED trace above.
- **Defaults changed** — pinned unchanged by the spec's defaults case.
- **The old spec masking the fix** — analysed and reported above (normalising stub, left
  untouched); the new spec is the bug detector.

## Not done

Nothing within Batch 4 scope. Out-of-scope observations: none.