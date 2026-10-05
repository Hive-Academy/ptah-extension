## Backend implementation — `TASK_2026_596_0a19`, batch 15

**Tasks completed**: 15.1 (provider RPC handlers and schema), 15.2 (`PlanLimitsBroadcaster` and activation)

**Files** (all under `libs/backend/rpc-handlers/**`; nothing else touched):

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\rpc-handlers\src\lib\handlers\provider-rpc.schema.ts` — `ProviderGetPlanLimitsSchema` (strict; optional `providerId`, `sessionIds`/`ownerKeys` capped at `PLAN_LIMITS_MAX_IDS` = 200, `refresh`).
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\rpc-handlers\src\lib\handlers\provider-rpc.handlers.ts` — `'provider:getPlanLimits'` added to `METHODS` (:125); `registerPlanLimits()` (:252); `provider:getAccountUsage` reads through `PlanUsageService` via discovery (:197); injects `PlanLimitsSnapshotService` (:159).
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\rpc-handlers\src\lib\services\plan-limits-snapshot.service.ts` — one snapshot assembler shared by the RPC and the push (see deviation 1).
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\rpc-handlers\src\lib\handlers\plan-limits-broadcaster.ts` — `PlanLimitsBroadcaster`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\rpc-handlers\src\lib\register-shared-rpc-handlers.ts` — registers both singletons (:70-71); `activateSessionLifecycleNotifier` resolves the broadcaster (:99).
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\rpc-handlers\src\lib\handlers\index.ts` — exports `PlanLimitsBroadcaster`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\rpc-handlers\src\lib\handlers\provider-rpc.handlers.spec.ts` — 9 new cases, plus the `getPlanLimits` registration assertion.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\rpc-handlers\src\lib\handlers\provider-rpc.custom-entries.spec.ts` — new constructor argument, plus the `wasm-bundle-dir` mock.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\rpc-handlers\src\lib\services\plan-limits-snapshot.service.spec.ts` — 5 cases.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\rpc-handlers\src\lib\handlers\plan-limits-broadcaster.spec.ts` — 8 cases, fake timers.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\rpc-handlers\src\lib\register-shared-rpc-handlers.activation.spec.ts` — 3 cases. They use the real library registrations in host order.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\rpc-handlers\src\lib\register-shared-rpc-handlers.spec.ts` — the barrel mock now lists the two new classes, plus the `wasm-bundle-dir` mock.

**Stack observed**:

- **DI:** tsyringe. `@injectable` with `@inject` tokens, and `registerSingleton` in `registerSharedRpcHandlers`. Source: `register-shared-rpc-handlers.ts`, `services/cli-model-list.service.ts`.
- **Validation:** zod `.strict()` schemas, parsed at the top of each handler. Source: `provider-rpc.schema.ts`.
- **Logger:** `TOKENS.LOGGER`, with debug lines that carry only error names. This follows the `plan-limit-owner-discovery.service.ts` and `lane-limit-lookup.service.ts` pattern.
- **Push pattern:** `session-lifecycle-notifier.ts`, using the `WebviewBroadcaster` interface.
- **Wiring:** the manifest entry `provider` has `requires: []` (`host-profile/manifest.ts:263-268`), so `METHODS` is registered on every host.

### Per-task evidence

**15.1**

- `provider:getPlanLimits`:
  - zod-validated (`ProviderGetPlanLimitsSchema.parse(params ?? {})`) and added to `METHODS`.
  - It calls `discoverTargets({selectedProviderId, sessionIds, ownerKeys})`.
  - It returns `{generatedAt, owners, sessionOwners}`.
  - `sessionOwners` holds every session the ledger has seen, plus each requested session not seen yet, as `{ownerKey:null, modelScope:null}`.
- **Read/known split (binding):** `ownerSnapshot()` (`plan-limits-snapshot.service.ts:146`).
  - It resolves `kind:'known'` snapshots unchanged and calls `getOwnerSnapshot` only for `kind:'read'`.
  - Spec `reads only read owners and passes known snapshots through unread`: one reader call, made with the read target, and the known snapshot is returned as-is.
- **Deadline:**
  - `readOwner()` (:155) gives every owner its own `AbortController` with a `LIMIT_LOOKUP_DEADLINE_MS` (3 s) timer, which is `unref`'d and cleared in `finally`. All owners run under `Promise.all`.
  - When a read times out or fails, the owner is still listed as `service-unavailable`, carrying the ledger's windows, owner evidence and cooldown (`unreadSnapshot`).
  - Discovery is not wrapped again; it bounds each source itself.
  - Spec `reads owners in parallel, each bounded by its own 3 s deadline`: two reads that never answer are both still pending at 2 999 ms, and both settle at 3 000 ms. That proves they run in parallel.
  - **Measured bound:** about one discovery deadline plus one read deadline, **about 6 s worst case**. Reads are never serialised per owner.
- **`provider:getAccountUsage`:**
  - It goes through `ownerSnapshotForProvider(providerId)`: discovery with `selectedProviderId`, then the `origin:'selected-provider'` entry, then the same read/known rule.
  - A non-Codex provider with a reader now answers from that reader.
    - Spec `answers a non-Codex provider with a reader instead of provider-unsupported` (ollama-cloud gives `available` with owner and windows).
  - No owner on the route gives `provider-unsupported`.
  - Codex legacy fields:
    - After the owner read has completed (`available` or `stale`), the Codex service result is spread first. It is called with `refresh:false` and answered from the cache the reader just filled.
    - The additive `owner`, `windows`, `ownerEvidence`, `windowSetEstablished` and `cooldown` follow.
    - Spec `reads the Codex owner through PlanUsageService and keeps every legacy field`: `quota.primary`, `quota.secondary`, `account`, `activity` and `fetchedAt` are all present. The read gets `refresh:true`; the legacy call gets `refresh:false`.
- **F71 / R4:**
  - The F71 spec reads three owners:
    - one with a `provider-key` ref;
    - one with a `ptah-cli-key` ref, whose reader throws an error quoting both fake keys;
    - an Antigravity owner whose reader throws an error quoting a fake CSRF token and an email.
  - `JSON.stringify(result)` contains none of the three secrets, no `credentialRef`, no `ptah-cli-key` and no email pattern. The debug log calls contain none of the secrets either.
  - Snapshot-service spec: a failed read logs only the error name.
- `rpc-allowlist.spec.ts` passes (manifest partitions `RPC_METHOD_NAMES`).

**15.2**

- `PlanLimitsBroadcaster`:
  - It subscribes to `ledger.onChange` in its constructor.
  - It has one 500 ms timer (`PLAN_LIMITS_PUSH_DELAY_MS`). The first change arms it; changes that arrive while it is armed join the same push.
  - It sends `MESSAGE_TYPES.PLAN_LIMITS_CHANGED` with `PlanLimitsSnapshotService.currentSnapshot()`. That is the last RPC scope, without a refresh.
  - A generation guard sends only the newest of two overlapping pushes.
  - A failed snapshot or broadcast is debug-logged with its error name and not retried.
  - `dispose()` is synchronous and idempotent: it clears the timer and unsubscribes.
  - It edits no app files.
- Broadcaster spec, 8 cases:
  - subscribe on construct;
  - burst folded into one push at 500 ms;
  - steady stream still pushes every 500 ms with at most 1 timer alive;
  - overlap keeps only the newest push;
  - broadcast failure is logged once and not retried;
  - snapshot failure is logged and nothing is broadcast;
  - `dispose` x2 clears the timer and the listener;
  - a snapshot that settles after `dispose` is dropped.

### Binding carry-forwards — how each was closed

1. **`provider:getPlanLimits` drift (since Batch 1):**
   - The method is now in `ProviderRpcHandlers.METHODS`. The manifest entry `provider` (`requires: []`) is enabled on every host, so `registerRpcSurface` registers it on VS Code, Electron and the CLI. No platform needed it in `excluded`.
   - `verifyRpcRegistration` diffs `RPC_METHOD_NAMES` against the registered methods, so `missingHandlers` no longer contains it.
   - Evidence:
     - `rpc-allowlist.spec.ts` (`assertManifestInvariants(RPC_METHOD_NAMES)`) passes. It throws "missing an owner" for any unclaimed registry method.
     - The provider spec `registers exactly the methods it declares on METHODS` now asserts that `provider:getPlanLimits` is registered.
2. **Ledger startup (Task 15.2):**
   - `activateSessionLifecycleNotifier` resolves `PlanLimitsBroadcaster`, which injects `AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER`. The ledger's constructor loads persisted state and subscribes to the plan-limit registry and the quota store.
   - This function is already called at all three host hooks:
     - `apps/ptah-extension-vscode/src/di/phase-3-handlers.ts:93`. Phase 0 platform `STATE_STORAGE` → phase 2 `registerAuthProvidersServices`:151, `registerSdkServices`:152, `registerCliAgentRuntimeServices`:208 → phase 3.
     - `apps/ptah-electron/src/activation/bootstrap.ts:415`. Phase 2 at `phase-2-libraries.ts:196/201/297`; `STATE_STORAGE` verified at `bootstrap.ts:320`.
     - `libs/backend/cli-engine/src/lib/container.ts:840`. `registerPlatformCliServices`:421, auth:651, sdk:655, runtime:712.
   - No app files were edited.
   - Spec `constructs the ledger singleton at activation, subscribed to stream and proxy evidence`, in the activation spec, runs the real library registrations in host order and checks:
     - the ledger's persisted key is read 0 times before activation and exactly 1 time after;
     - `onRateLimit` and `onSuccess` are subscribed once each;
     - `PlanLimitLedgerService.prototype.onChange` is called once, on the container's ledger instance;
     - a `turn-start` sent through the real `SDK_SESSION_PLAN_LIMIT_REGISTRY` registers the session in the ledger.
   - The third case shows that a `recordCooldown` on the ledger reaches the webview as one `planLimits:changed` push, and that the push lists that owner.
3. **Real `AgentProcessManager` in the VS Code and ptah-cli hosts:**
   - I chose the host-level check, because the app smoke specs are outside this batch's files.
   - Spec `the REAL AgentProcessManager resolves afterwards and shares the activated ledger`:
     - After the library registrations in host order and activation, `TOKENS.AGENT_PROCESS_MANAGER` resolves to the real class (`constructor.name === 'AgentProcessManager'`, not a stub).
     - Its `planLimits` is the same ledger instance, and `getStatus()` returns `[]`.
     - No second ledger is constructed (persisted key still read exactly once).
   - This composition matches the VS Code and CLI orders above. Both hosts register `PLATFORM_TOKENS.STATE_STORAGE` in their platform phase: `platform-vscode/src/registration.ts:63`, `platform-cli/src/registration.ts:68`. That happens before the libraries, and so before the ledger can first be resolved.
   - Supporting runs:
     - cli-agent-runtime `register.agent-process-manager.smoke.spec.ts`: 8/8 pass.
     - App smoke specs: VS Code 35/35 and Electron 18/18 pass.
     - ptah-cli smoke: see Verification.
4. **Discovery read/known and the deadline arithmetic:** see 15.1.
5. **R4/F71:**
   - RPC response: see the F71 spec under 15.1.
   - Push: it carries the same `PlanLimitsSnapshot` built by the same service (owner refs only).

**Verification**:

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/rpc-handlers`, foreground, no extra flags:
  - It passed on the first full run: typecheck ✓, test ✓, lint ✓. Test counts: **141 suites passed, 4091 tests passed, 7 skipped**. Lint: 0 errors.
  - It was re-run after one added assertion. That re-run failed in 7 suites, all of them TypeScript errors inside `libs/backend/vscode-lm-tools/.../mcp-response-formatter.ts`. The Batch 14 codex lane was editing that file at the time (TS2440, TS2304 "limitReason", an unterminated regex at :1898). Batch 15 does not cause these. The suites fail because `rpc-allowlist.spec` and the activation spec import that lib transitively.
  - Batch 15 suites alone (`register-shared-rpc-handlers*`, `plan-limits-broadcaster`, `plan-limits-snapshot.service`, `provider-rpc*`, `rpc-allowlist`, `verify-and-report`): 149 tests passed. Only the two suites that import vscode-lm-tools were blocked, by the same lane errors.
  - FINAL RE-RUN: see the addendum below.
- Lint warnings on changed files:
  - The only one is `max-lines` on `provider-rpc.handlers.ts`, 770 counted lines.
  - It is pre-existing: the HEAD version already warns at 720. It is a warning, not an error.
- Host activation check: `npx nx run-many -t typecheck -p ptah-extension-vscode ptah-electron ptah-cli` → "Successfully ran target typecheck for 3 projects".
- App DI smoke specs:
  - `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts`: 35/35.
  - `apps/ptah-electron/src/di/container.smoke.spec.ts`: 18/18.
  - `libs/backend/cli-agent-runtime/src/lib/di/register.agent-process-manager.smoke.spec.ts`: 8/8.
  - `apps/ptah-cli/src/di/container.smoke.spec.ts` (`-c apps/ptah-cli/jest.config.cjs`) failed to compile, on the same in-flight `vscode-lm-tools` errors. See the addendum.

**Verification addendum: final re-run, after the Batch 14 lane's edits settled** (`tsc -p vscode-lm-tools/tsconfig.lib.json` exit 0, no lane writes for 4 minutes):

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/rpc-handlers` passes: typecheck ✓, test ✓, lint ✓ ("Successfully ran targets typecheck, test, lint").
  - Test counts: **141/141 suites, 4091 passed, 7 skipped**. The 4091 matches the first run because the extra `getPlanLimits` assertion was added to an existing test, not as a new test.
- `apps/ptah-cli/src/di/container.smoke.spec.ts` passes: **10/10**.
- So the app DI smoke specs all pass: VS Code 35/35, Electron 18/18, ptah-cli 10/10, cli-agent-runtime manager smoke 8/8.
- The Batch 15 activation spec (real `AgentProcessManager`) passes inside the 141 suites.

**Plan deviations**:

1. **Extra file `services/plan-limits-snapshot.service.ts`** (inside `rpc-handlers`).
   - The RPC handler and the broadcaster both need the same discovery-based snapshot, and the push must reuse the scope of the last request.
   - The alternative was to have `ProviderRpcHandlers` inject the broadcaster. That would make the handler depend on `TOKENS.WEBVIEW_MANAGER`, and the broadcaster would read state owned by the handler.
   - With two real consumers, one assembler that both inject is the smaller design.
   - It is registered next to the broadcaster in `registerSharedRpcHandlers`.
2. **The push repeats the full last scope**, not only the last provider id. That scope is provider, `sessionIds` and `ownerKeys`.
   - The plan names only the provider id. The store replaces its snapshot on push (Component 13), so a push that dropped the session and owner-key owners would remove tiles the view had just loaded.
   - `refresh` is never repeated.
3. **`provider:getAccountUsage` runs full discovery** and takes the `selected-provider` entry. It does not build the owner itself.
   - The route and owner rules (claude-cli session, API key `unsupported-auth`, stored-key providers) are private to `PlanLimitOwnerDiscoveryService`, and this batch may not edit `cli-agent-runtime`.
   - Cost: the other discovery sources also run. Each is bounded at 3 s and runs in parallel.
   - If the selected-provider source itself times out, the method answers `provider-unsupported`. A timeout cannot be told apart from "no owner" through the public API.
4. **A failure to activate is contained.**
   - If resolving `PlanLimitsBroadcaster` throws at activation, the error is logged through `TOKENS.LOGGER.error` and startup continues. The comment at the site explains this.
   - The two existing turn listeners are resolved first and still fail loudly.
   - Reason: Electron re-throws activation errors (`bootstrap.ts:416-422`), so without this a plan-limit DI fault would stop the whole app from booting.
5. **Push timing:** the first change arms the single timer, and later changes join it. The timer is not re-armed on each change, so a steady stream of changes cannot hold the push back indefinitely. Decision 7 asks for "at most one per 500 ms", which this meets.
6. **Spec plumbing:** six specs gained a `jest.mock` of `workspace-intelligence/src/ast/wasm-bundle-dir`. This is the established precedent in `diagnostics-consent-rpc.handlers.spec.ts:19-26`. The `cli-agent-runtime` barrel, which the new service imports for `CLI_AGENT_RUNTIME_TOKENS`, reaches `import.meta.url`, and CommonJS ts-jest cannot parse it.

**Out-of-scope observations**:

- `register-shared-rpc-handlers.spec.ts` previously mocked `./handlers` without `GitChangeSetRpcHandlers`, which registered `undefined`. I added it to the mock along with the new class.
- When a session's plan-limit registry subscriber runs against a stubbed `SDK_SESSION_LIFECYCLE_MANAGER` (`{}`), it throws "this.sessions.find is not a function". I saw this only in the activation spec's stubbed composition. It is not reachable in the hosts, which register the real manager.
- The ptah-cli smoke spec and the full rpc-handlers suite need to be re-run after Batch 14 lands, as the run rules say for whichever batch commits second.
