# Code Logic Review — `TASK_2026_538_3ccf`

## Summary

Verdict: NEEDS_REVISION

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 1 |
| Failure modes found | 2 coverage failure modes |

Scope: Batch 14 only. Read all five submitted specs, the requested task documents and earlier review, and traced their production registration, state, broadcast, adapter and RPC/MCP seams. Read the earlier defensive-case tests and their harness. No existing `code-style-review.md` was present in the discovered task artifacts. No applicable AGENTS.md/CLAUDE.md was found in the checked ancestor paths; the supplied project guidance applies.

The adapter assertions and Electron lifecycle composition are substantive. The central Req 7.4 composition acceptance criterion is still untested: calling two methods on one locally held service does not show that two independently constructed consumers share it. This separates 6 from the sound 7–8 band. The genuine delivery regression coverage and passing tests separate it from 3–4. Findings concern missing regression protection, not a claim that today's production wiring is broken.

### Independent verification

- Read-only `git status --short` confirmed exactly the five named Batch 14 source paths: two modified adapter specs and three new composition specs. The shared and vscode-lm-tools Batch 15 specs were excluded.
- Compared each existing adapter spec's complete original body from its first `describe` through EOF against the current file using `git show HEAD:<path>`: both bodies remain unchanged. Additions are imports and appended blocks at `apps/ptah-electron/src/ipc/webview-manager-adapter.spec.ts:114` and `libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.spec.ts:130`.
- Ran Jest once per owning project config with `--testPathPatterns=(surface-composition|webview-manager-adapter)\.spec\.ts$ --runInBand`: Electron **2 suites / 12 tests passed**, VS Code **1 / 3 passed**, CLI **2 / 12 passed**. Total **5 suites / 27 tests**, including 14 pre-existing tests and 13 additions. Resolved Jest from the parent checkout via `require.resolve('jest/bin/jest')`; an initial literal worktree node_modules launcher failed before executing tests.
- No build or workspace-wide checks. The known `better-sqlite3-packaging` and `shell-csp` suites were outside the pattern and were not rerun. Their earlier failures are recorded in `batch-14-report.md:190`.
- Scoped `ptah_get_diagnostics` to the three composition paths. It first reported an unavailable, still-running check; the follow-up returned 2,131 errors across the transitive compiler graph, including Electron shim/type-environment problems. This is not a clean diagnostic result, nor evidence attributing those errors to Batch 14. The project-configured targeted Jest runs passed; the executor's typecheck/lint results remain reported evidence (`batch-14-report.md:179`).
- Mutation sensitivity below is reasoned from executable call paths; no mutation was executed and no source file was edited.

## Five logic questions

### 1. How does this fail silently?

The review gate can pass while a production consumer has no store or reads a different store. VS Code writes and reads the same `state` variable (`apps/ptah-extension-vscode/src/di/surface-composition.spec.ts:128`, `:140`, `:162`, `:175`); CLI does likewise (`libs/backend/cli-engine/src/lib/surface-composition.spec.ts:118`, `:128`, `:146`, `:159`). Neither resolves the MCP builder or surface RPC handler. Regressing the optional injection at `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts:481` or `libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:127` would escape these assertions. See F1.

### 2. What user action produces unexpected behaviour?

An agent creates a form and the UI reads it, or the UI changes a value and the agent reads it. Those are precisely the required actions in `task-description.md:284`; the specs substitute internal service calls, so a lost routing id or disconnected consumer could make the actual action return unavailable/not-found while tests pass. Electron's two cases only create surfaces and await delivery (`apps/ptah-electron/src/di/surface-composition.spec.ts:107`, `:160`), so neither direction is tested there either.

### 3. What input data produces a wrong answer?

The valid profile/form data at `apps/ptah-extension-vscode/src/di/surface-composition.spec.ts:71` never travels through either external parser or the MCP request context. A regression in translating caller scope at `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:1685`, or routing params at `libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:175`, could address the wrong record without affecting these tests. This is an untested composition failure, not an observed wrong answer from the current implementation.

### 4. What happens when a dependency fails?

Delivery failures are meaningfully asserted: a live-enumerated Electron surface whose bridge returns false produces failed/0/1 (`apps/ptah-electron/src/ipc/webview-manager-adapter.spec.ts:166`); no host followed by late registration produces no-surface then delivered (`apps/ptah-electron/src/di/surface-composition.spec.ts:100`); native-window destruction produces no-surface and no send (`:176`). Missing state and missing submit runtime are omitted from the CLI host spec (`libs/backend/cli-engine/src/lib/surface-composition.spec.ts:38`). Earlier unit/integration coverage exists, with limits detailed under F2.

### 5. What is missing that the requirements never mentioned?

No new behavioral requirement is needed: the omitted round trips and missing-store cases are explicit in `task-description.md:284` and `batches.md:1970`. A useful additional precision is that an integration seam must include the consumers' production injection, not merely manually supply both with the same service. The relevant injection points are `ptah-api-builder.service.ts:481` and `surface-rpc.handlers.ts:127` (full paths above). Also, the Electron composition asserts only the message type (`apps/ptah-electron/src/di/surface-composition.spec.ts:134`); the report's claim of an exact IPC payload (`batch-14-report.md:86`) is stronger than that assertion. Exact forwarding is checked separately at the adapter boundary (`webview-manager-adapter.spec.ts:145`), so this is a limitation rather than a separate acceptance defect.

## Failure modes

### F1 — SERIOUS: Direct service calls cannot prove shared MCP/RPC composition

- Trigger: a consumer's injection, namespace wiring, routing translation, or registration breaks while the service itself still works.
- Symptom: Batch 14 remains green although actual tool/UI calls cannot exchange state.
- Evidence: VS Code `apps/ptah-extension-vscode/src/di/surface-composition.spec.ts:89` returns only a service; its singleton assertion at `:116` resolves the same token twice. CLI `libs/backend/cli-engine/src/lib/surface-composition.spec.ts:96` also returns only a service. Electron `apps/ptah-electron/src/di/surface-composition.spec.ts:88` contains delivery-only cases. Required coverage: `task-description.md:284`, `implementation-plan.md:796`, `batches.md:1954`.
- Current handling: acknowledged as a gap but reported complete in `batch-14-report.md:50`, `:96`. Imports and registration are real; the claimed two consumers are absent from execution. These are useful service/DI tests, not a composition round trip.
- Recommendation: retain the valid assertions and add both real consumer directions on all three hosts. Resolve the actual RPC handler through the same container; send messages through real `RpcHandler.handleMessage`. Exercise the real MCP namespace/tool handling and response mapping with trusted caller scope. Assert exact routing id, surface id, revision and updated value across the boundary. Include a wiring check using the production API builder so a manually injected shared service does not conceal a broken builder injection.

### F2 — MODERATE: Required CLI defensive composition cases are missing

- Trigger: the host lacks the state token, or resolves a handler without the submit-turn token.
- Symptom: there is no host-level assertion that optional DI resolution succeeds and produces the promised terminal error/result rather than throwing at construction or returning the wrong wire shape.
- Evidence: `libs/backend/cli-engine/src/lib/surface-composition.spec.ts:96` always registers state and `:114` contains only two normal-state tests. The omission is explicit at `:38` and `batch-14-report.md:110`. Required cases are in `batches.md:1928` and `:1970`.
- Current handling: delegated to older tests which directly construct the consumers rather than resolving their optional dependencies in a host container.
- Recommendation: add a minimal CLI container variant without state registration, resolve/register the real consumer, and call both MCP tools plus valid surface RPC methods. Assert non-rejecting error replies and exact unavailable wording. Separately keep the state registration but omit submit-turn registration, submit through RPC, and assert rejected/session-unavailable plus a terminal `surface:operation` result. Misconfiguration is defensive and earlier behavioral coverage exists, so this is Moderate rather than Serious.

## Blocking issues

None established in this test-only batch.

## Serious issues

### F1: Req 7.4 remains unfulfilled on every host

- File: `apps/ptah-extension-vscode/src/di/surface-composition.spec.ts:125`; `libs/backend/cli-engine/src/lib/surface-composition.spec.ts:115`; `apps/ptah-electron/src/di/surface-composition.spec.ts:88`.
- Scenario: either production consumer stops using the registered store.
- Impact: maintainers receive passing composition tests for a broken primary agent/UI interaction.
- Fix: add the actual two-consumer round trips described in F1. Recording the gap does not waive the explicit acceptance criterion.

## Moderate and minor issues

- **F2, Moderate:** missing defensive host cases at `libs/backend/cli-engine/src/lib/surface-composition.spec.ts:114`; add the container-based omission variants above.
- No independent minor logic defect established. Exact Electron composition payload checking would strengthen the existing test, but is not counted as another failure mode.

## Testability finding and smallest correction

The direct named exports really are missing: `libs/backend/vscode-lm-tools/src/index.ts:86` exports broadcast/state but not `buildSurfaceNamespace`/`SurfaceNamespace`; `libs/backend/rpc-handlers/src/index.ts:9` omits `SurfaceRpcHandlers`. The tester was right to avoid prohibited deep imports and to report the production-edit scope boundary. That is an acceptable escalation, not an acceptable final coverage position.

The claimed RPC impossibility is too strong. The public RPC barrel exports the host-profile API (`libs/backend/rpc-handlers/src/index.ts:91`), which exports both `RPC_HANDLER_MANIFEST` and `resolveRpcHandlerPlan` (`src/lib/host-profile/index.ts:8`, `:23`). The surface manifest entry carries the actual constructor (`src/lib/host-profile/manifest.ts:148`). A minimal test can select the surface step for the real host profile, require it to exist, and call `container.resolve(step.ctor).register()`. This exercises the actual manifest selection and decorated constructor without initializing every other handler or bridge. `resolveRpcHandlerPlan` itself performs no container resolution (`src/lib/host-profile/register-rpc-surface.ts:95`); the full graph is only needed by `registerRpcSurface` (`:145`).

Smallest practical follow-up: use that existing RPC seam, and approve narrow public exports for the real surface namespace builder/types and MCP tool-call helper if required by the host harness. A named `SurfaceRpcHandlers` export is a reasonable convenience but not technically necessary. Add tests that run named tool calls through the real helper/namespace and RPC calls through the selected real handler, with the shared store registered by `registerVsCodeLmToolsServices`. To claim literal dispatcher-level wire coverage, also traverse the production dispatcher/request context; invoking only the namespace should be labeled accurately. Preserve a production API-builder injection test (or resolve it in the harness with unrelated dependencies stubbed), because manually passing the service bypasses `ptah-api-builder.service.ts:481` and `:869`. No full Electron app boot or database is needed to test the surface slice.

### Verified earlier fallback coverage

| Claimed case | Existing evidence | What it proves / does not prove |
| --- | --- | --- |
| MCP missing store | `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/surface-namespace.builder.spec.ts:295` | Real namespace resolves both valid calls to unavailable with exact host wording (`:311`, `:315`). No host DI or MCP envelope. |
| MCP unavailable maps to isError | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/surface-tools.spec.ts:259`, `:285` | Both reply mappers set isError using synthetic unavailable outcomes. This is separate coverage, not a missing-store tool round trip. |
| RPC missing store | `libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.spec.ts:161` | Real RPC read/action return the unavailable error. Harness constructs real RpcHandler and SurfaceRpcHandlers directly with undefined state (`src/test-utils/surface-rpc-harness.ts:204`) and calls handleMessage (`:212`). No optional DI resolution. |
| No submit-turn service | `libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.submit.spec.ts:170` | RPC submit rejects session-unavailable and operation lookup is terminal. Same direct-construction harness omits submitTurn at `src/test-utils/surface-rpc-harness.ts:209`. |

Thus the report's statement that earlier tests pin the underlying behaviors is substantially correct. Its assertion that these make the specified host cases complete is not. No production bug in those fallback implementations was demonstrated by this review.

## Data flow

1. **OK, partial host composition:** real core registration and `registerVsCodeLmToolsServices` register the singleton and lazy host provider (`libs/backend/vscode-lm-tools/src/lib/di/register.ts:116`, `:127`). Unrelated logger/context/storage dependencies are stubs; the surface service is not mocked.
2. **F1 gap at ingress:** production MCP uses dispatcher → API surface namespace → service (`protocol-dispatcher.ts:1680`, `ptah-api-builder.service.ts:867`, full paths above). Batch 14 enters at service.applyAgentUpdate and skips these edges.
3. **OK, Electron push:** real `pushSurfaceChange` invokes real broadcast (`libs/backend/vscode-lm-tools/src/lib/surface/surface-push.ts:22`), whose host lookup occurs on each invocation (`dashboard-namespace.builder.ts:134`, full path above). The late-registration test at `apps/ptah-electron/src/di/surface-composition.spec.ts:119` observes the newly registered adapter.
4. **OK, Electron lifetime:** real getter rejects a destroyed native window (`apps/ptah-electron/src/activation/bootstrap.ts:140`) and supplies a live destruction callback (`:145`). Real adapter enumeration and real IPC sending consult it (`apps/ptah-electron/src/ipc/webview-manager-adapter.ts:73`; `ipc-bridge.ts:188`, `:167`). Production bootstrap uses this getter at `bootstrap.ts:339`.
5. **OK, CLI delivery:** real adapter returns no surfaces (`libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.ts:51`); broadcast returns no-surface (`dashboard-namespace.builder.ts:158`). The composed state remains readable at `libs/backend/cli-engine/src/lib/surface-composition.spec.ts:128`.
6. **F1 gap at read/change exit:** production RPC parses, routes and translates results (`libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:164`, `:169`). Specs instead call read/change/describeForAgent directly.
7. **F2 gap on unavailable dependencies:** production optional dependencies are declared at `surface-rpc.handlers.ts:127`, `:129`; the CLI composition never resolves this consumer with either token absent.

### Mutation sensitivity, reasoned from the code

| Counterfactual regression | Would these tests fail? | Evidence |
| --- | --- | --- |
| Capture absent WEBVIEW_MANAGER before late registration | YES | Electron early then live assertions at `surface-composition.spec.ts:114`, `:130` require the provider to re-resolve. |
| Restore the old getter with send only and no destruction checks | YES | Same native window remains referenced; Electron test `:176` would get delivered from the fake send instead of expected no-surface at `:185`. This closes the original bootstrap-getter scenario. |
| Adapter returns true despite bridge false | YES | Electron adapter spec `:180` expects failed/0/1. |
| Broadcast drops or changes supplied payload | YES at adapter boundary | Electron adapter spec `:145` compares the full object. |
| CLI advertises a surface | YES | CLI adapter spec `:152` would receive delivered rather than no-surface. |
| MCP builder supplies undefined instead of its injected service | NO | None of the five specs invokes the builder's namespace creation (`ptah-api-builder.service.ts:867`). |
| Surface RPC registration becomes a no-op or injects a separate store | NO | No Batch 14 spec resolves/registers/calls SurfaceRpcHandlers; direct service reads still succeed. |

The Batch 2 destroyed-window finding is closed for the delivery chain tested here. This is not a full bootstrap invocation: a future edit disconnecting the getter at the bootstrap call site would require a bootstrap-specific test. The current call site was verified at `apps/ptah-electron/src/activation/bootstrap.ts:341`.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Task 14.1 / Req 11.1, 11.4 / R7 Electron broadcast outcomes and type assignment | COMPLETE | Real broadcast + adapter; bridge is a controlled boundary fake (`webview-manager-adapter.spec.ts:131`, `:166`, `:190`). |
| Task 14.2 / Req 11.2, 11.4 / R7 CLI no-surface and type assignment | COMPLETE | Real broadcast + adapter (`cli-webview-manager-adapter.spec.ts:146`, `:157`). Tool text is not asserted by this adapter test. |
| Task 14.3 / Req 7.4 bidirectional shared-store composition | PARTIAL | Real registration/singleton; neither consumer executed (F1). |
| Task 14.4 / A1 and Batch 2 getter regression | COMPLETE | Real late registration, getter, bridge and adapter (`apps/ptah-electron/src/di/surface-composition.spec.ts:100`, `:155`). |
| Plan Req 7 row: Electron MCP/RPC round trips too | MISSING | Both Electron cases stop at delivery (F1). |
| Task 14.5 CLI retained state with no-surface | COMPLETE | `libs/backend/cli-engine/src/lib/surface-composition.spec.ts:115`. |
| Task 14.5 and carry-forward: missing store / missing submit service | MISSING at host level | Older boundary tests verified; no host DI omission variant (F2). |
| Preserve original adapter assertions | COMPLETE | Both original describe bodies verified unchanged. |

Implicit requirements not addressed: no additional behavioral requirement identified; the important gaps are explicit requirements.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Host absent, then registered late | YES | Electron composition `:107` then `:123` | A1 covered. |
| Native window destroyed but reference retained | YES | Electron composition `:176` | Required getter regression covered. |
| Enumerated surface rejects delivery | YES | Electron adapter spec `:166` | Real broadcast classifies controlled bridge failure. |
| CLI has no renderer but state persists | YES | CLI composition `:118` through `:131` | Actual MCP text reply not traversed. |
| Singleton token resolved repeatedly | YES | VS Code composition `:116` | Does not prove independent consumers share it. |
| Missing state token in host container | NO | CLI composition always registers it | F2; older direct-construction tests exist. |
| Missing submit-turn token in host container | NO | No surface RPC handler constructed here | F2; older RPC settlement test exists. |
| Wrong consumer routing/store wiring | NO | Both read/write calls share local state variable | F1. |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the coverage findings and targeted test results; no claim of a clean full compiler graph.
- Top risk: the batch can pass while real MCP and RPC consumers cannot exchange state, despite that being its explicit acceptance criterion.
- What a robust implementation would add: real bidirectional consumer tests on all three host containers, optional-dependency omission variants on CLI, and accurate completion/coverage wording. Keep the passing adapter and Electron lifecycle tests.


---

# Re-review after revision round 1

# Code Logic Review — `TASK_2026_538_3ccf`

## Summary

Verdict: APPROVED

Batch 14, revision 1. **F1 and F2 are closed.** The new tests exercise actual consumers, decorated RPC construction, and the registered API builder. Approval is for the documented tool-helper/namespace-to-RPC composition boundary, not a full application boot or per-host HTTP/MCP transport test.

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 new substantiated failures |

The score rises from 6 because independently constructed consumers now exchange state, and CLI optional dependencies are tested through real RPC resolution. It remains below 9 because assertion completeness varies by host and the composition intentionally stops short of full transport/bootstrap coverage. These are bounded verification limitations, not evidence of a remaining composition defect.

### Scope and verification

- Read the revised three composition specs in full, the production barrel, `batch-14-report.md:240` onward, approval in `context.md:98`, and the prior findings in `code-logic-review-batch-14.md:75`. Reused the earlier full adapter-spec review and verified preservation of their original describe bodies against HEAD again. Traced the new calls into the real helper, namespace, registration, API builder, manifest and RPC handler. No source edits or git writes.
- Read-only `git status --short` confirms the five Batch 14 specs plus **one production file**, `libs/backend/vscode-lm-tools/src/index.ts`. Batch 15 is outside this review. The production diff is exactly 22 appended lines of comments and named exports; no implementation changed.
- Independently ran Jest using each owning project's config and `--testPathPatterns=(surface-composition|webview-manager-adapter)\.spec\.ts$ --runInBand`. Electron: **2 suites, 14 tests passed**. VS Code: **1 suite, 6 tests passed**. CLI: **2 suites, 16 tests passed**. Total: **5 suites, 36 tests passed**, including all nine revision additions.
- Scoped `ptah_get_diagnostics` to the changed backend barrel: **0 errors, 0 warnings**, TypeScript compiler source. This is not a claim to have rechecked every host's complete compiler graph. The executor separately records the four projects' typecheck/lint results at `batch-14-report.md:365`.
- No build or workspace-wide checks. The known Electron `better-sqlite3-packaging` and `shell-csp` suites were excluded by the targeted pattern, not rerun or counted as passing.
- No mutation was executed. The mutation conclusions below follow the actual call paths and assertions; no source was altered for probing.

## Five logic questions

### 1. How does this fail silently?

The previous silent coverage failure is removed. RPC is now independently resolved from each container rather than handed the test's service: VS Code `apps/ptah-extension-vscode/src/di/surface-composition.spec.ts:122`, Electron `apps/ptah-electron/src/di/surface-composition.spec.ts:69`, CLI `libs/backend/cli-engine/src/lib/surface-composition.spec.ts:126`. If it uses an absent or separate empty store, the forward reads cannot return the agent-created record, and reverse changes cannot produce the asserted revision/value. Remaining assertion precision is described under Minor M1; no new silent runtime failure was demonstrated.

### 2. What user action produces unexpected behaviour?

No unexpected behavior was observed in the requested create/read/change/read flows. Real named update calls feed real RPC reads on all hosts (`apps/ptah-extension-vscode/src/di/surface-composition.spec.ts:232`, `apps/ptah-electron/src/di/surface-composition.spec.ts:265`, `libs/backend/cli-engine/src/lib/surface-composition.spec.ts:215`). Real RPC changes then feed named get-state calls (`:285`, `:307`, `:257`, respectively). The separate Electron live/destroyed-window tests remain effective at `apps/ptah-electron/src/di/surface-composition.spec.ts:156` and `:213`.

### 3. What input data produces a wrong answer?

No wrong answer was found for the fixtures. Exact routing/surface identity and revision 1 are asserted in forward reads; reverse calls assert revision 2 and the new value. Only the VS Code forward read also checks the complete expected data model (`apps/ptah-extension-vscode/src/di/surface-composition.spec.ts:248`, `:266`). Electron and CLI forward reads omit content-value assertions (`apps/ptah-electron/src/di/surface-composition.spec.ts:286`; `libs/backend/cli-engine/src/lib/surface-composition.spec.ts:236`). The reverse text assertions are substring checks rather than a full structured response comparison; see M1. Host-specific cross-routing attacks are not added here; the transport scope boundary remains outside this batch.

### 4. What happens when a dependency fails?

The new CLI missing-state test resolves the real handler without the state token and gets exact, non-rejecting RPC error objects for read/change (`libs/backend/cli-engine/src/lib/surface-composition.spec.ts:302`, `:330`, `:342`). Both real MCP helper calls are awaited and checked against exact `isError: true` replies (`:306`, `:318`); rejection would fail the async test. With state but no submit-turn service, RPC returns exact rejected/session-unavailable wording (`:381`, `:393`) and the same operation subsequently reads terminal rejected (`:403`). Existing adapter tests still cover refused sends; Electron composition still covers late registration and destroyed windows (`apps/ptah-electron/src/di/surface-composition.spec.ts:151`, `:167`, `:222`).

### 5. What is missing that the requirements never mentioned?

No additional behavior is needed to accept this revision. The important limit is explicit: tests use `handleSurfaceToolCall`/`buildSurfaceNamespace`, not the full MCP dispatcher/AsyncLocalStorage path (`apps/ptah-extension-vscode/src/di/surface-composition.spec.ts:45`; `libs/backend/cli-engine/src/lib/surface-composition.spec.ts:29`). This matches the corrective seam proposed in `code-logic-review-batch-14.md:93`. Separate existing transport tests construct a real HTTP server and dispatcher (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.surface.spec.ts:103`); those were inspected, not rerun here. The API-builder wiring check is shared-class coverage on VS Code, not duplicated host boot coverage.

## Failure modes

No new Blocking, Serious or Moderate failure mode was substantiated. Scope examined: six Batch 14 paths, real state registration, per-host profile-to-manifest selection, actual RPC injection/registration, tool helper/namespace mapping, API-builder injection, and CLI missing-collaborator branches. All targeted specs pass. Residual uncertainty: complete host bootstrap, HTTP/MCP envelope/ALS composition per host, and exhaustive content serialization are not exercised by these five files.

### F1 — CLOSED: Real consumers now share the registered store

Each host calls the real `resolveRpcHandlerPlan` using its real host profile, requires the surface step to exist, then executes `container.resolve(step.ctor).register()`:

| Host | Registration evidence | Forward/reverse boundary evidence |
| --- | --- | --- |
| VS Code | `apps/ptah-extension-vscode/src/di/surface-composition.spec.ts:114` | Named tool call at `:232`; real RPC read at `:242`; real change at `:285`; tool read at `:304`. |
| Electron | `apps/ptah-electron/src/di/surface-composition.spec.ts:61` | Named tool call at `:265`; real RPC read at `:275`; real change at `:307`; tool read at `:326`. |
| CLI | `libs/backend/cli-engine/src/lib/surface-composition.spec.ts:118` | Named tool call at `:215`; real RPC read at `:225`; real change at `:257`; tool read at `:272`. |

The selected production manifest entry references `SurfaceRpcHandlers` (`libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:148`). The planner derives the constructor from that entry (`libs/backend/rpc-handlers/src/lib/host-profile/register-rpc-surface.ts:118`); its real constructor injects state/RPC tokens (`libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:124`). These tests do not replace that constructor or pass it a hand-picked service.

The namespace **is** constructed by its real factory with the container-resolved service; it is not itself a tsyringe service. That factory usage matches production `PtahAPIBuilder` (`libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts:867`). The separate builder test closes the otherwise-bypassed injection edge: `apps/ptah-extension-vscode/src/di/surface-composition.spec.ts:362` resolves `TOKENS.PTAH_API_BUILDER`, invokes `builder.build().surface.update`, and then reads the independently resolved state at `:374`. Registration points to the real class (`libs/backend/vscode-lm-tools/src/lib/di/register.ts:84`), whose real injection is at `ptah-api-builder.service.ts:481`. The unrelated dependency stubs at spec `:337` do not supply a fake surface consumer, store, or builder. A missing or separate builder store would fail this test.

Testing that one shared builder class once is sufficient for this correction: all three fixtures invoke the same registration function, while each host separately exercises its profile/manifest RPC selection. This does not certify that every future change to a full app composition root will be caught.

### F2 — CLOSED: Defensive results now cross the consumer boundaries

At `libs/backend/cli-engine/src/lib/surface-composition.spec.ts:293`, a minimal container omits `registerVsCodeLmToolsServices`; resolving the real RPC handler exercises optional injection of absent state. MCP's pure factory receives undefined state and both real tool-helper paths execute. Exact replies are asserted at `:313`, `:325`, `:336` and `:355`.

At `:362`, the normal state registration remains and submit-turn registration is omitted. The surface is created through the real tool helper, then the handler receives a real `surface:action` message. The exact rejected result and detail are asserted at `:393`. The follow-up `surface:operation` uses the same operation id and asserts success plus rejected status at `:403`. It proves terminal settlement; it does not compare the operation lookup's complete reason/detail, despite the comment saying "SAME settled outcome". That precision improvement belongs to M1, not a reopened F2.

## Blocking issues

None.

## Serious issues

None open. Prior F1 is closed with the evidence above.

## Moderate and minor issues

### M1 — Minor: Assertion completeness is narrower than the report's blanket wording

- File: `apps/ptah-electron/src/di/surface-composition.spec.ts:286`; `libs/backend/cli-engine/src/lib/surface-composition.spec.ts:236`; reverse assertions at `apps/ptah-extension-vscode/src/di/surface-composition.spec.ts:311`, Electron `:333`, CLI `:279`; terminal lookup at CLI `:409`.
- Scenario/impact: an isolated content-projection defect could evade an individual host's forward test, or a terminal lookup could retain rejected status with incorrect reason/detail. Forward Electron/CLI tests assert identity/revision but no content value; reverse responses assert revision/value substrings but not complete identity. Thus `batch-14-report.md:288` overgeneralizes the exactness of every direction.
- Recommendation: optionally assert the initial stat/data-model value in the Electron/CLI RPC reads, assert surface identity alongside reverse value/revision, and include session-unavailable reason/detail in the terminal lookup. Update report wording to describe the actual assertions.
- Why non-blocking: the common RPC read projection's data model is already asserted in the VS Code real-consumer test (`:265`), all hosts prove reverse value transfer, and CLI separately asserts exact submit failure wording (`:393`). No host-specific projection implementation or observed wrong result was found. The prior missing-composition and missing-terminal-branch findings are resolved.

## Production export and boundary check

`context.md:98` authorizes the narrow export change. The only production delta is `libs/backend/vscode-lm-tools/src/index.ts:109`: named factory/helper/tool-name exports and associated types. The extra `SurfaceUpdateOutcome`, `SurfaceGetStateOutcome`, and `SurfaceToolName` types are directly related public signatures, not unrelated scope expansion. No `SurfaceRpcHandlers` export was added.

All new export targets are within the same library (`index.ts:121`, `:126`, `:130`); consumers use the package aliases (`apps/ptah-extension-vscode/src/di/surface-composition.spec.ts:67`, Electron `:37`, CLI `:48`). No cross-library deep import or new runtime-family dependency is introduced. The namespace continues to import runtime validation from the designated shared contracts subpath (`libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/surface-namespace.builder.ts:3`). The backend barrel was already reaching this namespace through its exported API builder (`index.ts:6`; `ptah-api-builder.service.ts:92`), so exposing a name does not newly make a browser-safe types module depend on Zod. No shared type-only module or shared barrel changed. This respects the scoped zod-free decision in `context.md:88`; it does not imply that the backend barrel itself is zod-free.

## Data flow

1. **OK:** minimal host container invokes real core/library registration; state and builder remain registered singletons (`libs/backend/vscode-lm-tools/src/lib/di/register.ts:84`, `:127`).
2. **OK:** the real namespace receives that resolved service; `handleSurfaceToolCall` invokes update/getState and maps the reply (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/surface-tool-handlers.ts:96`). No outcome mock stands in for it.
3. **OK:** validated agent write commits through the namespace into that service (`libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/surface-namespace.builder.ts:124`). Delivery stays real; Electron lifecycle behavior is retained separately.
4. **OK:** host profile selects the production manifest constructor, then container resolution independently injects state into the RPC handler (per-host helper evidence above).
5. **OK:** `RpcHandler.handleMessage` reaches real parsing/read/change code (`libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:164`, `:169`); tests assert cross-consumer read/write results.
6. **OK:** namespace getState reads through `describeForAgent` (`surface-namespace.builder.ts:194`, full path above), and real reply mapping exposes the committed revision/value.
7. **OK:** absent state reaches the actual RPC exception-to-error boundary; absent submit service returns session-unavailable and settles the operation (`surface-rpc.handlers.ts:300`, `:324`; CLI spec `:403`).

### Mutation sensitivity — evidence, not executed probes

| Hypothetical regression | Expected failure |
| --- | --- |
| Remove/disable the surface manifest entry for a host | Its helper throws because the surface step is absent: VS Code `:117`, Electron `:64`, CLI `:121` in the composition specs. |
| Change RPC injection to an absent or separate empty store | Forward RPC reads fail found/identity assertions; reverse changes cannot return revision 2. RPC's injection is `surface-rpc.handlers.ts:127`; tests are identified in the F1 table. |
| Namespace ignores the registered service and writes elsewhere | The independently injected RPC reader finds no matching surface; all forward tests fail. |
| API builder supplies undefined or a separate service | VS Code builder outcome at `:369` or independent state read at `:375` fails. Unlike revision 0, the real builder is resolved and invoked. |
| Make RPC's state dependency required | CLI missing-state construction at `:302` rejects during resolution, failing the test before its error-response assertions. |
| Missing submit runtime leaves the operation pending/unknown | CLI lookup assertions at `:409`–`:411` fail. |
| Remove Electron getter destruction checks | Retained Electron test at `:222` receives the wrong delivery classification or observes a send at `:223`. |

All abbreviated spec locations in this table refer to the three full paths in the F1 table. These conclusions cover the stated mutations; they do not claim exhaustive mutation coverage.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Req 7.4 / F1: MCP-helper write to RPC read on three hosts | COMPLETE | Real consumers; full transport/ALS intentionally separate. Minor content assertion precision noted in M1. |
| Req 7.4 / F1: RPC write to MCP-helper read on three hosts | COMPLETE | Revision 2 and changed values observed; complete response equality not asserted. |
| Production API-builder injection | COMPLETE | Real container-resolved builder reaches independently resolved state, VS Code spec `:362`. Shared-class check rather than three app boots. |
| Req 7.4 / F2: missing store replies | COMPLETE | Both tool replies and read/change RPC replies checked exactly, CLI spec `:306`. |
| Batch 11 carry-forward / F2: missing submit-turn service | COMPLETE | Exact submit rejection and terminal operation result, CLI spec `:381`, `:403`. |
| A1 / Batch 2 destroyed-window regression | COMPLETE | Real getter, bridge and adapter retained, Electron spec `:156`, `:192`. |
| Req 11 / adapter delivery and structural typing | COMPLETE | Existing Batch 14 adapter additions retained; both suites pass. |
| Approved narrow production scope | COMPLETE | Only appended local exports, backend index `:109`; no shared/zod-free module changes. |

Implicit requirements not addressed: none newly identified. Full runtime boot and network-envelope coverage are explicitly outside the composition slice reviewed here.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Late Electron host registration | YES | Real provider observes newly registered adapter, Electron spec `:158`–`:170` | No full bootstrap invocation. |
| Destroyed but referenced window | YES | Native fake flips destroyed; real getter/bridge classify no-surface, Electron `:213` | Existing scope retained. |
| CLI has no renderer | YES | Real adapter and stored state, CLI `:157` | Full TUI not booted. |
| Consumer connected to absent/separate store | YES | Independent RPC resolution plus fresh cross-consumer writes | Builder edge separately checked once. |
| No state service | YES | Optional RPC DI plus exact real tool/RPC errors, CLI `:293` | MCP factory is supplied undefined; this is not a missing-state API-builder boot test. |
| No submit-turn service | YES | Real action then terminal operation lookup, CLI `:362` | Reason/detail equality on lookup is a minor improvement. |
| Serialization preserves every field | NO, not exhaustive | Exact VS Code data model and reverse value/revision checks | M1; not a new observed runtime defect. |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for F1/F2 closure and targeted results.
- Top risk: overstating these focused composition tests as complete host boot or transport coverage; the source comments now state their actual boundary.
- What a robust implementation would add: the minor exact-content/identity and terminal-reason assertions in M1. No further production implementation change is required by this review.
