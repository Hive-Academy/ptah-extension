## Files changed

- `libs/backend/worker-runtime/src/lib/worker-methods.ts` and `worker-methods.spec.ts`: protocol-backed remote table and parse → authorize → handler → result dispatch.
- `libs/backend/worker-runtime/src/lib/worker-authorizer.ts` and `worker-authorizer.spec.ts`: machine, workspace and session grant checks with uniform refusal.
- `libs/backend/worker-runtime/src/lib/worker-session-index.ts` and `worker-session-index.spec.ts`: grant-limited session lookup and refresh.
- `libs/backend/worker-runtime/src/lib/in-process-rpc.ts` and `in-process-rpc.spec.ts`: local RPC envelope and nested result validation, fixed-copy error mapping, redacted local logging.
- `libs/backend/worker-runtime/src/lib/worker-host-profile.ts` and `worker-host-profile.spec.ts`: worker host profile.
- `libs/backend/worker-runtime/src/lib/capabilities/worker-capabilities.ts` and `worker-capabilities.spec.ts`: capability rows and remote surface mapping.
- `libs/backend/worker-runtime/src/index.ts`: exports of the new units.

## Decisions

- **Decision:** Reuse `WORKER_METHOD_SCHEMAS` and `REMOTE_METHODS` from `worker-protocol`. **Options:** duplicate schemas or reference the protocol. **Evidence:** the protocol already owns strict params and result schemas; the method-table drift spec compares these names. **Reversible:** yes.
- **Decision:** Inject remote handlers and the session-list lookup through narrow ports. **Options:** bind backend services now or defer their assembly to the worker service batches. **Evidence:** Batch 16 names the table, authorizer, index, and adapter; subsequent batches own the driver, permissions, and service. **Reversible:** yes.
- **Decision:** Mark only core chat/session methods supported remotely; mark all other capability rows with a reason. **Options:** imply local CLI RPC capabilities are remotely callable or describe the Phase 1 wire surface. **Evidence:** W6 lists ten remote methods and C6 requires the documented supported set to equal that table. **Reversible:** yes.
- **Decision:** Keep the worker profile inside `scope:extension` imports. **Options:** import the CLI profile or duplicate its current capability values through the public `rpc-handlers` profile API. **Evidence:** `eslint.config.mjs` restricts extension dependencies; Round 6 defers CLI profile parity to Task 19.2. **Reversible:** yes.

## Spec coverage

- Authorization before handlers, outside and nonexistent refusal, inside resource: `WORKER_METHODS %s authorizes before invoking a handler`, `uses identical refusal for excluded and missing sessions`, `only scans granted workspaces and refreshes after a miss`.
- Protocol method parity and invalid params: `matches the protocol remote surface`, `rejects invalid params and unknown methods before handlers`.
- Per-method nested failures: `InProcessRpc %s treats nested failure as a failure` for `chat:start`, `chat:continue`, `chat:abort`.
- `session:list` result validation: `validates session:list result shape`.
- Fixed allow-list wire copy and local raw error logging: `logs redacted raw errors and returns only fixed copy`.
- Worker profile constants: `uses the headless worker profile`.
- Capability and remote surface drift: `covers every host capability and the Electron enabled capability rows`, `keeps the documented remote surface equal to the method table`.

## Not done / Clarifications Needed

- `npm run verify` and Jest were not run in this lane, as instructed. The orchestrator runs scoped verify. `npx tsc --noEmit -p libs/backend/worker-runtime/tsconfig.lib.json` passed before the final adapter schema refinement; the scoped Ptah diagnostics call timed out while its TypeScript check was still running.
- Task 19.2 owns in-process profile parity with `createCliRpcHostProfile`; this batch does not import `cli-engine`.
- Concrete handler assembly, session driver, permission handling, and worker service are later batches.

## Orchestrator corrections (verify)

- `worker-methods.spec.ts`: two handler-map casts changed to `as unknown as WorkerHandlers` (TS2352).
- `jest.config.ts`: `setupFiles: ['reflect-metadata']`, `vscode` mock mapping, and a local
  `__mocks__/wasm-bundle-dir.ts` mapping (copied from `thoth-runtime`). The worker host profile
  imports the `@ptah-extension/rpc-handlers` barrel, which loads tsyringe services, `vscode` and
  workspace-intelligence.
- For the Phase D reviewer: this barrel import makes worker-runtime load the full rpc-handlers
  graph. Check whether a narrower import is possible.
- Result: `npm run verify -- -p @ptah-extension/worker-runtime` passed (16 suites, 38 tests).
