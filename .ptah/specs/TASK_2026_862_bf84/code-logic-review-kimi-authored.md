Implementer family: kimi
Review family: codex
Verdict: APPROVE (Round 3)
Score: 4/10 (original review; historical)

## Scope and evidence

Reviewed the Kimi-authored file list against `context.md`, `task-description.md`, the implementation plan, root `CLAUDE.md`, and the existing provisional logic review. Traced the validator and translator through process and lane consumers; inspected runtime selection, chat adapter, model resolution, evidence tooling, Dependabot, and changed test assertions. Referenced consumer paths outside the review list only to establish impact.

Scoped `ptah_get_diagnostics` returned zero errors for the protocol schemas, translator, and validator spec; a larger request timed out. No tests, builds, Nx commands, installs, or mutating git commands were run, as requested. Static diagnostics cannot detect finding 3. The Dependabot configuration uses version 2, groups, and an `@openai/codex*` allow pattern; its four directories match manifests declaring those packages. No removed `platform` property read or static Codex model allowlist was found. Host-supplied `resolveRuntime` remains the adapter's first choice. Unknown requests receive a JSON-RPC error in the process dispatcher, while unknown notifications are caught and ignored there. Protocol error formatting bounds issue details without raw payload values.

Three Serious failures separate this from a 5–6 score: two future-protocol cases surface errors or terminate a session, and the new validator spec cannot run. Meaningful validation and fallback structure separate it from a foundation-level 1–2 score. Runtime behavior after fixes remains unverified because execution was prohibited.

## Five logic questions

1. **How does this fail silently?** `codex-protocol-methods.ts:88-94` discards malformed model entries without a diagnostic, so an all-invalid page looks like a valid empty catalog. The start probe prints a selected source before open and can mislabel a fallback (`scripts/codex-start-probe.ts:199-204,239-249`).
2. **What user action produces unexpected behaviour?** Starting a chat or lane with a newer Codex emitting a new item type produces a visible runtime error (`codex-event-translator.ts:307-311`); a new nested command action can terminate the process (`codex-protocol-schemas.ts:150-169,243-249`).
3. **What input data produces a wrong answer?** An all-invalid model list produces an empty successful catalog (`codex-protocol-methods.ts:88-94`). An open-time fallback produces an incorrect probe source (`scripts/codex-start-probe.ts:199-204,239-249`).
4. **What happens when a dependency fails or changes shape?** A malformed required field gets a bounded protocol error. A future `commandActions[].type` is rejected as invalid params, and the process failure path closes the runtime (`codex-protocol-schemas.ts:150-169`; `codex-protocol-validator.ts:260-266`).
5. **What is missing that the requirements never mentioned?** End-to-end tests of future items through the lane, nested variants through the process reader, and selection-to-open fallback. The new validator spec also needs valid Jest registration (`codex-protocol-validator.spec.ts:583-635`).

## Findings

1. **Serious — Future item types become user-visible runtime errors.** `libs/backend/codex-runtime/src/lib/codex-event-translator.ts:307-311`. A newer Codex sends `item/started` or `item/completed` with an unrecognized `item.type`. The tolerant `item` schema accepts it, but `knownItem.safeParse` fails and the translator emits an `error` event. The lane consumer turns that into a visible “Codex reported a runtime error” segment (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-events.ts:148-149,170-175`). The new translator spec at `codex-event-translator.spec.ts:1054-1065` locks in this behavior. **Required fix:** Treat unknown item types as unsupported evidence or a bounded diagnostic instead of an error event; retain errors for malformed required fields of known items. Assert the behavior through the lane consumer with subsequent successful turn completion.

2. **Serious — A future nested command action invalidates the entire frame.** `libs/backend/codex-runtime/src/lib/codex-protocol-schemas.ts:150-169,243-249`. `commandActions` is an array of a closed discriminated union; the literal `unknown` branch does not accept a future type. One new action inside an otherwise valid `commandExecution` item makes `validateCodexFrame` reject the known notification (`codex-protocol-validator.ts:260-266`), and the app-server process failure path closes the runtime (`libs/backend/codex-runtime/src/lib/codex-app-server-process.ts:375-381`). **Required fix:** Accept or individually skip unrecognized nested action variants while retaining required-field checks for known variants, and test a future action at the process boundary. Apply the same bounded treatment to other nested variants meant to be forward compatible.

3. **Serious — The new validator spec registers a test inside a test.** `libs/backend/codex-runtime/src/lib/codex-protocol-validator.spec.ts:583-635`. The test opened at line 583 lacks its closing `});` before the next `it(` at line 608; line 635 closes the outer test. Jest rejects nested test registration, so the suite fails and the optional-notification-enum test never runs. Type diagnostics show no error. **Required fix:** Close the first test before line 608, rebalance the closing delimiter at line 635, and run the scoped spec when tests are permitted.

4. **Moderate — Malformed model entries disappear without a protocol-drift signal.** `libs/backend/codex-runtime/src/lib/codex-protocol-methods.ts:88-94`. `.catch(undefined)` plus filtering silently drops invalid entries; an all-invalid page returns a successful empty catalog indistinguishable from no models. The new test at `codex-protocol-validator.spec.ts:549-581` asserts filtering but not observability. **Required fix:** Emit a bounded, redacted count or schema-code diagnostic and distinguish an all-invalid page from a valid empty catalog without logging payloads.

5. **Moderate — The start probe reports a pre-open selection as the launched binary.** `scripts/codex-start-probe.ts:199-204,239-249`. The probe prints source, version, and reason from `selectForOpen` before `CodexRuntime.open`, which selects again and can switch to the bundle after an installed-binary method failure (`libs/backend/codex-runtime/src/lib/codex-runtime.ts:275-276,320-325`). A bundled launch can be labeled installed. **Required fix:** Read the selection snapshot after open and print the source/version/reason actually used, including fallback and failure cases.

## Decisions

- **Verdict:** REVISE. The two forward-compatibility failures and non-runnable new spec are Serious by the role's visible-failure criteria. This decision is reversible after source and test fixes.
- **Unknown request handling:** Do not flag the validator's `unknownMethod` throw alone. The process dispatcher catches an unknown request and sends JSON-RPC `-32601`; unknown notifications are ignored. This follows the end-to-end dispatch path and is reversible if an uncovered host path bypasses it.
- **Dependabot:** Do not flag schema or update scope. Official GitHub Dependabot option documentation supports `directories`, groups, and `allow` patterns, and the directories match the reviewed package manifests. This is reversible if GitHub validation reports a concrete error.

## Round 2

Verdict: REVISE

| Round-1 finding | Resolved? | Evidence |
| --- | --- | --- |
| 1. Future item types produce runtime errors | **Yes, for the behavior.** | `libs/backend/codex-runtime/src/lib/codex-protocol-schemas.ts:507-514` accepts an unknown item only when its type is outside the known set; `codex-event-translator.ts:295-310` then ignores it. `codex-event-translator.spec.ts:1055-1066` checks that a later turn completion still emits a terminal. There is no new lane-consumer assertion, so execution through that consumer remains unverified. |
| 2. Future nested command action invalidates the frame | **No — Serious.** | `codex-protocol-schemas.ts:195-202` makes `commandActions` tolerant, and `codex-protocol-methods.ts:257` uses it for approval requests. But the `commandExecution` item still uses `z.array(commandAction)` at `codex-protocol-schemas.ts:321-328`. `item` cannot fall through to its unknown-type branch for a known `commandExecution` (`codex-protocol-schemas.ts:486-514`). Thus `item/started` at `codex-protocol-methods.ts:415` rejects the future action as `invalidParams`, and `codex-app-server-process.ts:376-380` fails the process. The new assertion at `codex-protocol-validator.spec.ts:678-689` expects that rejected frame to parse, so it would fail when run. Use `commandActions` in the known item schema while keeping the known-action required-field check. |
| 3. Validator spec registers a nested test | **Yes, structurally.** | The first model test closes at `codex-protocol-validator.spec.ts:582`; the next test closes at line 596, and the optional-enum test closes at line 623. The enclosing `describe` closes at line 652. Jest was not run under this lane's read-only restrictions. |
| 4. Invalid model entries vanish without a signal | **Partially — residual Minor.** | `codex-protocol-methods.ts:93-105` now returns `skippedCount` and rejects an all-invalid page, distinguishing it from a valid empty catalog. `codex-context.ts:1020-1038` reads only `data` and `nextCursor`; it neither logs nor otherwise surfaces `skippedCount`. A partial page can still lose entries silently. Log a bounded count at this caller without payload data. |
| 5. Probe labels a pre-open binary as launched | **Yes.** | `scripts/codex-start-probe.ts:240-247` prints the selection only after `open`, using `selectionSnapshot.current()`. The snapshot updates after selection and installed-to-bundled fallback at `select-codex-executable.ts:122-145`, so a successful fallback is labeled with the launched source/version/reason. |

### New Blocking or Serious findings

None beyond the unresolved finding 2. In particular, the unknown-item branch excludes malformed known item types (`codex-protocol-schemas.ts:507-514`), and the unknown-server-request path still replies with JSON-RPC `-32601` (`codex-app-server-process.ts:391-417`). No raw payload logging was introduced by the reviewed fixes.

### Verification and decision

Scoped `ptah_get_diagnostics` for the changed `codex-runtime` files returned zero errors. An initial call that also included `scripts/codex-start-probe.ts` selected the scripts compilation context and reported 461 cross-project/rootDir errors; it is not evidence of a Codex runtime regression. The caller reported that scoped runtime and spec typechecks pass. I did not run tests, builds, Nx, verification, installation, or state-changing git commands, as instructed. Static source tracing is enough to establish finding 2; the new spec assertion is currently inconsistent with the schema.

**Decision:** Keep REVISE because the still-closed `commandExecution.commandActions` boundary can terminate a session on a future action. This is reversible by applying the tolerant schema at that item boundary and running the scoped spec when permitted. No additional user-reserved decision arose. Skill discovery/loading was unavailable in this host; no skill steps were inferred.

## Round 3

Verdict: APPROVE

| Check | Result | Evidence |
| --- | --- | --- |
| Finding 2: nested command actions | **Resolved.** | The `commandExecution` item now uses `commandActions` (`codex-protocol-schemas.ts:321-327`), as the approval request already does (`codex-protocol-methods.ts:251-257`). `tolerantServerVariants` drops only action types outside the known set while its known variant parse still rejects a `read` action missing `name` or `path` (`codex-protocol-schemas.ts:127-143,175-202`). The assertions at `codex-protocol-validator.spec.ts:655-709` follow those paths and should pass by inspection. |
| Residual model-list Minor | **Acceptably covered.** | `codex-app-server-process.ts:289-297` compares raw and parsed model counts and logs only a capped count and fixed reason when entries are skipped; an all-invalid page is rejected by `codex-protocol-methods.ts:93-105`. No payload values are logged. |
| One-line change and consumers | **No new issue found.** | The tolerant helper's output is still the known `commandAction` array (`codex-protocol-schemas.ts:141-143`), so the item's inferred `commandActions` output type stays the same. Repository text search found no production consumer reading that item field; `codex-event-translator.ts:586-604` emits tool events from the other item fields. `ptah_get_diagnostics` for the schema and validator spec returned zero errors with clean coverage. The caller reports scoped `tsc` for the runtime lib and spec passed; this lane did not run it. |

This is a source-level re-review only. Tests and builds were prohibited, so runtime behavior remains unexecuted here. The Ptah symbol index was empty, `ptah_lsp_references` resolved against the main checkout, and native text search was used for consumer discovery.
