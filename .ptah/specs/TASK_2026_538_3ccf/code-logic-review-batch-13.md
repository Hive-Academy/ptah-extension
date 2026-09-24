# Code Logic Review — `TASK_2026_538_3ccf`

## Summary

Verdict: NEEDS_REVISION

| Metric | Value |
| --- | --- |
| Overall score | 4/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 2 |
| Serious issues | 1 |
| Moderate issues | 1 |
| Failure modes found | 4 |

Scope: Batch 13, Tasks 13.1–13.3. Reviewed the nine named implementation/test files, Batch 12 handoff, Batch 13 report, Req 8, and the relevant plan/validation sections. Traced the HTTP entry, namespace, service, publisher, reader and logger dependencies to verify the new tools end to end. Concurrent Batch 11 RPC and submit-turn revisions were excluded. No source was edited and no git command or build was run.

The operation mapping, optional service wiring, argument-key rejection and normal revision/delivery reporting work. However, the new state reader relies on request metadata that the HTTP boundary does not reliably establish, and delivery/observer failures can disclose raw exceptions or discard committed outcomes. These are material integration failures, not grounds to reject the contract design itself. That separates 4/10 from the foundational 1–2 band; the demonstrated trust/outcome failures prevent the sound 7–8 band. Evidence: F1–F4 below.

Path shorthand used throughout:

- `C/` = `libs/backend/vscode-lm-tools/src/lib/code-execution/`
- `S/` = `libs/backend/vscode-lm-tools/src/lib/surface/`
- `K/` = `libs/shared/src/mcp-apps-contracts/`

### Verification evidence

- Ran `npx nx run-many -t test -p @ptah-extension/vscode-lm-tools --runInBand --testPathPatterns='surface-tools.spec.ts|protocol-dispatcher.spec.ts|ptah-api-builder.service.spec.ts|surface-namespace.builder.spec.ts|dashboard-propose-spec.tool.spec.ts|dashboard-surface-bridge.spec.ts' --outputStyle=static --skip-nx-cache`, with Nx daemon/cloud disabled: **6 suites, 153 tests passed; exit 0**.
- Scoped `ptah_get_diagnostics` to the changed surface-tools and API-builder paths: TypeScript compiler reported **0 errors, 0 warnings**.
- Executed **8 additional Jest probes** in this project's Jest environment, using a process-local read hook to append test code in memory to `surface-tools.spec.ts`. Production modules were loaded unchanged; no temporary spec or source file was written. The final probes passed in groups of 5, 2 and 1. Two earlier harness attempts failed TypeScript checking before tests ran; the harness types were corrected. The additional-run shell wrappers reported exit 1 with the Node config-module warning despite passing Jest summaries; the latter two runs also explicitly returned `results.success: true`. Treat these as assertion evidence, not clean shell-command exits.
- The probes reproduced F1–F4, checked real dispatcher rejection of both forged argument keys, checked both missing-service outcomes, and compiled the advertised update schema with Ajv against valid create/replace/patch/delete inputs.
- Native reads were used because no Ptah file-read tool was exposed. `ptah_search_files` found no AGENTS.md; targeted native instruction-file discovery found no applicable instruction files. No existing `code-style-review.md` was present in the discovered task folder.
- Residual scope: no provider/client acceptance smoke test, host application launch, build, or concurrent Batch 11 verification. Targeted Jest is evidence for these modules, not proof of every runtime composition.

## Five logic questions

### 1. How does this fail silently?

The anonymous HTTP caller can receive another session's state as a normal success by putting `_callerSessionId` in the JSON-RPC envelope. No tool argument is forged, so strict argument validation cannot catch it. The HTTP handler preserves the body field when its URL contains no session; the dispatcher then treats it as trusted context (F1; `C/mcp-http/http-server.handler.ts:368`, `C/mcp-core/protocol-dispatcher.ts:200`, `:1675`).

Ordinary delivery failure is correctly an MCP tool error, with committed revision, text and “do not resend” preserved (`C/mcp-core/surface-tool-handlers.ts:56`; existing real-service test `C/mcp-core/surface-tools.spec.ts:309`). F3 can replace this otherwise correct answer after the commit.

### 2. What user action produces unexpected behaviour?

A valid update whose UI send takes over the slow-tool threshold can commit, then return a generic JSON-RPC error if warning logging fails. The committed revision and retry instruction disappear. A throwing transcript callback similarly converts an accepted update into a failure (`C/mcp-core/protocol-dispatcher.ts:558`, `:2008`; F3).

An agent budgeting a structure read using the description's 256 KiB claim can receive substantially more text (`C/mcp-core/surface-tools.ts:224`; F4).

### 3. What input data produces a wrong answer?

- A bare-URL HTTP request containing `_callerSessionId: "victim"` returns the victim's state instead of the anonymous answer (F1).
- A valid surface containing 40 stat values of 2,000 U+2028 characters produces a 481,755-byte structure answer, contradicting the advertised 262,144-byte bound (F4). No raw separator characters were printed.
- Flattening deliberately accepts a superset: `{operation:"create"}` passes the advertised JSON Schema but fails Zod. That is not itself a finding: required fields are accurately described and the real namespace remains authoritative (`C/mcp-core/surface-tools.ts:101`, `:124`; `K/surface.schemas.ts:536`; `C/namespace-builders/surface-namespace.builder.ts:99`).

### 4. What happens when a dependency fails?

Missing surface service returns the specified `isError: true` unavailable text for both scoped tools (`C/namespace-builders/surface-namespace.builder.ts:119`, `:180`; handler mapping at `C/mcp-core/surface-tool-handlers.ts:62`, `:76`). The independent real-dispatcher probes confirmed this.

A host lookup/enumeration exception is turned into a failed delivery, but its raw message is preserved through the MCP text (F2). A logger or transcript callback exception can replace an otherwise complete response (F3). An indefinitely unsettled send has no delivery deadline in the publisher's `Promise.all` (`C/namespace-builders/dashboard-namespace.builder.ts:164`); no timeout policy was specified for this batch, so this remains an explicit uncertainty, not an invented timeout finding.

### 5. What is missing that the requirements never mentioned?

The contract needs an explicit boundary rule stripping client-supplied internal routing metadata before populating ALS (F1). Observability callbacks must be non-authoritative after a mutation commits (F3). Descriptions need to distinguish the input surface byte budget from the escaped read-result budget (F4). The existing plan's trusted-context and committed-result promises depend on all three.

## Failure modes

### F1 — Body-supplied routing metadata reaches the new surface tools [Blocking]

- Trigger: POST to the bare MCP URL, without `/session/{id}`, containing a top-level `_callerSessionId`.
- Symptom: `ptah_surface_get_state` returns another session's state as success.
- Evidence: `C/mcp-http/http-server.handler.ts:361`, `:368`, `:369`; `C/mcp-core/protocol-dispatcher.ts:198`, `:200`, `:1674`; `C/namespace-builders/surface-namespace.builder.ts:175`, `:181`.
- Current handling: the parsed body is cast to MCPRequest; the HTTP handler only overwrites the session field when the URL supplies one. The new dispatcher case correctly reads ALS, but ALS already contains the forged value.
- Recommendation: remove reserved identity fields from the parsed envelope, then assign transport-derived metadata unconditionally, including undefined for absent URL scope. Keep argument validation strict. Add HTTP-through-dispatcher tests for anonymous and workspace-only URLs.
- Reproduction: seeded the real service with a surface in session `victim`; started the real `startHttpServer` on port 0 with the real dispatcher and namespace; posted this body to `/`:
  `{"jsonrpc":"2.0","id":"forged","method":"tools/call","_callerSessionId":"victim","params":{"name":"ptah_surface_get_state","arguments":{"surfaceId":"review"}}}`.
  HTTP returned 200, no tool error, and the seeded `private-surface-value`. The server was closed in finally.
- Attribution: the HTTP defect predates Batch 13. It is an integration blocker for the newly exposed surface state/anonymous-caller contract, not a claim that the dispatcher reads identity from tool arguments.

### F2 — Host delivery exceptions leak verbatim into tool results [Blocking]

- Trigger: `SurfacePushHostProvider.getHost()` or host enumeration throws an Error containing internal details.
- Symptom: the MCP error text includes the raw exception message.
- Evidence: `C/namespace-builders/dashboard-namespace.builder.ts:147`, `:154`; `S/surface-push.ts:22`; `C/namespace-builders/surface-namespace.builder.ts:151`; `C/mcp-core/surface-tool-handlers.ts:59`; `C/mcp-core/protocol-dispatcher.ts:1679`.
- Current handling: the transport captures `error.message` as delivery.reason; the namespace embeds it in outcome.reason; the new handler returns that reason unchanged. The service's defensive catch also retains raw error text (`S/surface-state.service.ts:692`).
- Recommendation: make delivery reasons agent-safe at the publisher boundary; retain raw exceptions only in guarded internal logging. Preserve the committed revision, delivered/total counts, rendering and “do not resend”. Also sanitize unexpected surface exceptions at the dispatcher boundary instead of using the shared raw-message/stack response.
- Reproduction: real service + namespace + dispatcher, valid create, `getHost: () => { throw new Error("review-private-host-detail"); }`. Result was `isError: true`, contained “committed revision 1” and “do not resend”, **and contained `review-private-host-detail` verbatim**.
- Attribution: the unsafe delivery reason originates in existing dependencies; Batch 13 exposes it unchanged at its MCP boundary. This violates the review's explicit no-raw-error requirement.

### F3 — Observability failures override a committed surface outcome [Serious]

- Trigger: logger.debug throws at entry; logger.warn throws after a slow call; or onToolResult throws while constructing a success response.
- Symptom: valid requests reject before dispatch, or a committed update returns a generic error with no committed-state guidance.
- Evidence: `C/mcp-core/protocol-dispatcher.ts:185`, `:558`, `:561`, `:1680`, `:2008`, `:1880`, `:223`. The real output manager can rethrow appendLine failures (`libs/backend/vscode-core/src/api-wrappers/output-manager.ts:147`, `:151`).
- Current handling: only the namespace/service logger is wrapped (`C/namespace-builders/surface-namespace.builder.ts:86`; `S/surface-log.ts:18`). The dispatcher uses the raw logger outside that protection. Success notification happens before the response is returned; its exception enters a catch that calls the same callback again.
- Recommendation: guard entry, timing and catch-path logging, and guard result-notification callbacks independently. Once the surface outcome exists, preserve it even if notification/logging fails. Add regression tests at `handleMCPRequest`, not just the namespace.
- Reproductions:
  - Throwing debug: real get_state route rejected with `review-debug-fault` before returning any MCP response.
  - Real create with send delayed 2,100 ms then returning false, and warning logger throwing: store subsequently read as found, but MCP response was `error.code: -32603`; committed revision and “do not resend” were absent.
  - Real create with no attached host and a throwing transcript callback: store read as found, but MCP response became an internal error.
- The raw message/stack exposure on these catch paths is counted under F2, not as another finding. Existing staleness guards still prevent applying the same patch twice; the defect is lost outcome/recovery information, not demonstrated duplicate writes.

### F4 — Structure description advertises the input budget as the output bound [Moderate]

- Trigger: valid structure text expands when line separators are escaped.
- Symptom: a successful structure read exceeds the tool description's claimed maxSurfaceBytes bound.
- Evidence: `C/mcp-core/surface-tools.ts:223`, `:224`; `S/surface-state-reader.ts:205`, `:209`, `:369`, `:385`; `K/surface-catalog.ts:104`, `:114`, `:117`.
- Current handling: the reader correctly checks maxStateReadBytes after escaping. The description instead says the returned component tree is within maxSurfaceBytes.
- Recommendation: describe maxSurfaceBytes as the validated source-surface budget; say the escaped structure response uses maxStateReadBytes. Keep both numbers interpolated. Test semantic accuracy with an expanding valid structure, not only that constants occur in the string.
- Reproduction: real service/namespace, 40 stat nodes with values `String.fromCharCode(0x2028).repeat(2000)`. Create accepted. Input: **241,647 bytes**; structure output: **481,755 bytes**; advertised structure bound: **262,144 bytes**; real read bound: **561,152 bytes**. Read remained complete and within the correct read bound; there was no reader overflow.

## Blocking issues

### F1 — Establish trusted routing metadata before ALS

- File: `C/mcp-core/protocol-dispatcher.ts:200`, `:1675`; prerequisite fix at `C/mcp-http/http-server.handler.ts:368`.
- Scenario: anonymous HTTP caller supplies reserved metadata in the envelope.
- Impact: surface state outside the anonymous caller's intended scope is disclosed.
- Fix: discard body metadata and populate scope only from the transport, even when absent; prove anonymous reads and writes remain anonymous through real HTTP.

### F2 — Sanitize delivery and unexpected-failure text

- File: `C/mcp-core/surface-tool-handlers.ts:59`; dependency origin `C/namespace-builders/dashboard-namespace.builder.ts:154`; generic escape hatch `C/mcp-core/protocol-dispatcher.ts:223`, `:1887`.
- Scenario: host lookup, enumeration, or dispatcher-side observer fails.
- Impact: internal exception text/stack reaches the agent-facing response.
- Fix: use stable public failure reasons and guarded internal diagnostics, preserving committed-state reporting.

## Serious issues

### F3 — Make dispatcher observability non-throwing

- File: `C/mcp-core/protocol-dispatcher.ts:185`, `:561`, `:2008`.
- Scenario: output channel or transcript callback fails before/after a valid surface operation.
- Impact: tool availability or committed-result reporting depends on an unrelated observer.
- Fix: independently guard observers across the complete dispatch path and test actual committed outcomes under injected failures.

## Moderate and minor issues

- **F4, Moderate:** inaccurate structure-output budget wording, `C/mcp-core/surface-tools.ts:224`; correct the input/output distinction using the demonstrated expansion.
- No additional minor finding. Existing tests demonstrate ordinary mapping and wiring; missing adversarial coverage is part of F1–F4, not separately counted.

## Data flow

1. **GAP F1:** JSON HTTP body becomes MCPRequest; optional URL stamping leaves untrusted metadata intact when the URL lacks a session (`C/mcp-http/http-server.handler.ts:368`).
2. **OK given trustworthy metadata:** request context binds ALS; the new tool caller contains only getCallerSessionId() and request.id.toString() (`C/mcp-core/protocol-dispatcher.ts:198`, `:1674`). It does not copy scope from tool arguments.
3. **OK:** handlers forward arguments to the namespace; strict validation precedes scope/service checks (`C/mcp-core/surface-tool-handlers.ts:89`; `C/namespace-builders/surface-namespace.builder.ts:99`, `:164`).
4. **OK:** the optional service is passed into surface; v1 gets the bridge when present or the direct broadcaster when absent (`C/ptah-api-builder.service.ts:481`, `:861`, `:867`). Missing-service scoped tools return unavailable.
5. **OK normal outcomes / GAP F2 on exceptional reasons:** namespace obtains the committed result, awaits its delivery and renders the returned view; failed delivery remains committed (`C/namespace-builders/surface-namespace.builder.ts:121`, `:130`, `:141`). Unsafe delivery.reason crosses into public text at `:151`.
6. **OK mapping:** accepted/render-only/found/not-found become successful tool replies; rejected/unavailable/delivery-failed become tool errors (`C/mcp-core/surface-tool-handlers.ts:48`, `:72`; dispatcher `:1678`).
7. **GAP F3:** callback/timing log after the surface result can replace it (`C/mcp-core/protocol-dispatcher.ts:2008`, `:558`).
8. **OK reader enforcement / GAP F4 description:** the actual read bound applies after escaping, while tool prose names the source budget for the returned structure (`S/surface-state-reader.ts:209`, `:385`; `C/mcp-core/surface-tools.ts:224`).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Req 8.1: update rendering, id and committed revision | PARTIAL | Normal mapping works at handlers:49; F3 can erase a committed result. |
| Req 8.2: authoritative validation and no writes on rejection | COMPLETE | Namespace validates first at surface-namespace.builder:99; real dispatcher rejects forged sessionId/tabId argument keys. |
| Req 8.3: bounded read and complete per-surface state | COMPLETE | Reader enforces actual bound at surface-state-reader:209; handler preserves its text at surface-tool-handlers:75. F4 concerns prose, not enforcement. |
| Req 8.4: trusted caller scope | PARTIAL | New case reads only context at protocol-dispatcher:1675, but F1 disproves trust at HTTP intake. |
| Req 8.5: anonymous matrix | PARTIAL | Correct absent-metadata branches at surface-namespace.builder:105 and :175; HTTP body spoof bypasses them. |
| Req 8.6: committed state + delivery result, safe retry advice | PARTIAL | Handler:59 preserves normal failure text; F2 leaks raw reasons and F3 can discard the whole result. |
| Req 8.6b: generated schema and catalog-derived description | PARTIAL | Values and branch schemas derive correctly at surface-tools:54/:130/:196; F4 misstates what the structure bound covers. |
| Req 8.7: dashboard_propose_spec coexistence | COMPLETE for Batch 13 wiring | Builder:861 selects real v1 bridge; bridge:10 records into the same service; targeted bridge/dashboard tests pass. |
| Req 7.4 defensive missing service | COMPLETE for scoped calls | Namespace:119/:180 and handler mappings return unavailable; independent real-dispatcher probes passed. |
| Always-on tools, annotations | COMPLETE | Dispatcher:310–314; surface-tools:206/:234; tools/list tests at protocol-dispatcher.spec:1871. |
| Throwing logger cannot alter outcome / no raw error leaks | MISSING end-to-end | F2 and F3. Namespace-only protection does not cover the dispatcher. |

Implicit requirements not addressed: transport metadata provenance and observer failure isolation (F1/F3).

### Assessment of the two deviations

**Flattened update schema: acceptable deliberate over-approximation, not exact equivalence.** The current outer operation branches reuse identical shared property schemas and have no optional branch-only fields (`K/surface.schemas.ts:536`). Flattening preserves those properties and recursive definitions, gives the correct four operation values, and documents per-operation requirements (`C/mcp-core/surface-tools.ts:76`, `:95`, `:101`, `:117`). Ajv accepted valid examples of all four operations; no current valid-input rejection was found. It also accepts incomplete/cross-operation combinations that Zod rejects. The backend remains authoritative, as required. The description must not be interpreted as proof of JSON Schema equivalence. Live client compatibility of the chosen representation remains untested.

**Additional API-builder tests: justified and useful.** The two tests prove the bridge receives the service and forwards proposal arguments, and the missing-service branch selects the direct broadcaster (`C/ptah-api-builder.service.spec.ts:584`, `:611`). Namespace builders are mocked here; therefore these tests prove wiring selection rather than full host composition. Real bridge/namespace suites and the independent dispatcher probes supplement them.

**Catalog/text and comments:** the 548 KiB maximum and 40 KiB floor are interpolated at `C/mcp-core/surface-tools.ts:226` and `:228`, from `K/surface-catalog.ts:117` and `S/surface-state-reader.ts:131`. Batch 4 semantics are stated at surface-tools:175–188, consistent with `K/surface-patch.ts:170`/:201 and `K/surface-bindings.ts:268`. The corrected message comments accurately preserve the defensive v1 fallback (`libs/shared/src/lib/types/messages/message-constants.ts:170`, `:179`; builder:861). The service registration backing the normal branch is at `libs/backend/vscode-lm-tools/src/lib/di/register.ts:127`.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Valid create/replace/patch/delete schema forms | YES | Ajv and Zod checks over all four; surface-tools:130 | Live client smoke test remains outside scope. |
| Missing branch-required fields | YES at runtime | Namespace:99; strict branch schemas | Flattened advertised schema intentionally permits a superset. |
| sessionId/tabId in tool args | YES | Strict validation; namespace:99/:164 | Does not cover envelope metadata, F1. |
| Anonymous caller without forged metadata | YES | Namespace:105/:175 | Existing real-service tests and targeted probes cover normal matrix. |
| Anonymous caller with forged envelope metadata | NO | HTTP:368 retains it | F1. |
| Missing service | YES | Namespace:119/:180 | Scoped tools return named MCP errors. |
| Failed send and repeated stale patch | YES normally | Real-service test surface-tools.spec:309 | F3 can hide the result; it does not defeat stale-write protection. |
| Not-found read | YES | Handler:74 returns useful success text | No false claim of a found surface. |
| Host lookup throws | NO for confidentiality | Broadcast:154 captures raw message | F2. |
| Logger/notification callback throws | NO | Dispatcher:185/:561/:2008 | F3. |
| Large escaped structure | YES for enforcement, NO for description | Reader:209/:385 | F4. |
| v1 service present/absent | YES | Builder:861–863; bridge:10 | Comment qualification is accurate. |

## Verdict

Verdict: NEEDS_REVISION

- Recommendation: REVISE
- Confidence: HIGH for the four reproduced failures; MEDIUM for unexecuted provider/host integration.
- Top risk: the new state tool treats body-injected routing metadata as trusted for a caller whose HTTP URL is anonymous.
- What a robust implementation would add: transport-owned metadata initialization; agent-safe failure reasons; non-throwing dispatcher logging and transcript callbacks; accurate escaped-output budget wording; persistent regression tests for each reproduced path.



---

# Re-review after revision round 1

﻿# Code Logic Review - `TASK_2026_538_3ccf`

## Summary

Revision 1 re-review of Batch 13. **Verdict: APPROVED**

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 remaining in reviewed scope |

All four findings in `code-logic-review-batch-13.md` are closed. The score reflects reproduced transport, error and observer behavior, rather than the author's verification claims. It is above the 5-6 band because no demonstrated correctness gap remains; it is below 9 because live provider/client schema acceptance and full product integration were not exercised.

Paths below are repository-relative. `C/` means `libs/backend/vscode-lm-tools/src/lib/code-execution/`; `S/` means `libs/backend/vscode-lm-tools/src/lib/surface/`; `K/` means `libs/shared/src/mcp-apps-contracts/`.

Scope: the original Batch 13 review plus the revision's HTTP handler, surface namespace, dispatcher guards, descriptions and new integration spec. Read the revision report, original review, requirements and handoff; inspected the revision against the previously reviewed complete files. No code-style review exists in this task folder. Concurrent Batch 11 changes are excluded. No source files or git state were edited.

## Revision findings and verification

| Prior finding | Resolution and evidence | Result |
| --- | --- | --- |
| F1 Blocking: body-supplied caller identity | `C/mcp-http/http-server.handler.ts:372` removes all three reserved fields; lines 379-381 assign only URL-derived values, including undefined. Real HTTP tests at `C/mcp-core/protocol-dispatcher.surface.spec.ts:161`, :192 and :211 cover forged bodies on / and /workspace/ws-plain, attacker URL versus victim, and legitimate victim access. Independent HTTP probes verified session, agent and workspace together on anonymous, workspace-only, session/workspace and agent/workspace URLs. | CLOSED |
| F2 Blocking: private exception text | `C/namespace-builders/surface-namespace.builder.ts:156` uses fixed public delivery text; :165 also replaces nested delivery.reason. `C/mcp-core/surface-tool-handlers.ts:103` catches unexpected namespace failures and :114 returns fixed guidance. The exact getHost exception 'review-private-host-detail' stays out of the response while revision and retry guidance survive (`protocol-dispatcher.surface.spec.ts:236`; `surface-tools.spec.ts:396`). Throwing warning during unexpected-error handling is covered at `surface-tools.spec.ts:424`. | CLOSED |
| F3 Serious: observability changes outcome | Entry debug (:185), slow warning (:565), catch logging (:220/:1887), error callback (:1894) and success callback (:2024) use runObserver (:2040) in `C/mcp-core/protocol-dispatcher.ts`. Tests at `protocol-dispatcher.surface.spec.ts:254`, :273 and :300 pass. An independent real 2.1-second failed delivery preserves committed revision 1 and do-not-resend text when slow warn throws. | CLOSED |
| F4 Moderate: incorrect structure bound | `C/mcp-core/surface-tools.ts:224` distinguishes the 256 KiB input surface from escaped returned text, then derives 548 KiB/561152 bytes and the 40 KiB reader minimum from constants (:228). The 40-stat, 2,000-separators-per-stat reproduction passes: output exceeds maxSurfaceBytes, remains within maxStateReadBytes and contains no raw separator (`surface-tools.spec.ts:356`). Constants: `K/surface-catalog.ts:104`, :117; `S/surface-state-reader.ts:131`. | CLOSED |

### Verification performed

- Targeted Jest through `nx run-many -t test -p @ptah-extension/vscode-lm-tools --runInBand --skip-nx-cache`, restricted with testPathPatterns to ten files: surface-tools, protocol-dispatcher, protocol-dispatcher.surface, ptah-api-builder.service, surface-namespace.builder, dashboard-propose-spec.tool, dashboard-surface-bridge, http-server.handler, http-mcp-server.service and mcp-request-context. **10 suites, 268 tests passed; exit 0.**
- **7 additional independent Jest probes passed; exit 0.** Injected into the real integration spec through a temporary in-memory read hook; no test/source file was changed. Four HTTP scope cases, two non-surface observer cases, one real slow surface delivery. Two initial probe-only host-stub type errors were corrected before execution; those attempts ran no tests and were not product defects.
- Requested diagnostics for the HTTP handler and new integration spec: TypeScript compiler reported **0 errors, 0 warnings**.
- Searched production and test references to all three reserved metadata names, including repository callers. No production HTTP sender relying on those body fields was found.
- No build, workspace-wide tests, live provider session or product launch was run.

## Five logic questions

### 1. How does this fail silently?

No reproduced silent-success failure remains in these paths. Delivery failure retains an error result, committed revision and rendered fallback (`C/mcp-core/surface-tool-handlers.ts:60`; `C/namespace-builders/surface-namespace.builder.ts:156`). Observer failures are intentionally swallowed without changing the already determined result (`C/mcp-core/protocol-dispatcher.ts:2040`); they can lose telemetry, not the tool outcome.

### 2. What user action produces unexpected behaviour?

The original forged-body action now behaves according to the URL scope, including anonymous behavior when no session segment exists (`C/mcp-http/http-server.handler.ts:379`). A legitimate caller using /session/victim still reads its stored value (`C/mcp-core/protocol-dispatcher.surface.spec.ts:211`). This is routing attribution, not authentication against an arbitrary local client that can choose a URL; that pre-existing trust model is explicit at `C/mcp-http/http-server.handler.ts:264`.

### 3. What input data produces a wrong answer?

No reproduced wrong answer remains. Large escaped structure output now agrees with the advertised read bound (`C/mcp-core/surface-tools.ts:224`; `surface-tools.spec.ts:356`). The flattened schema is intentionally broader than runtime validation: incomplete or cross-operation combinations can pass client schema checking but are rejected by the authoritative namespace validator (`C/mcp-core/surface-tools.ts:124`; `C/namespace-builders/surface-namespace.builder.ts:102`). This is not exact schema equivalence.

### 4. What happens when a dependency fails?

Absent service returns typed unavailable results for scoped calls (`C/namespace-builders/surface-namespace.builder.ts:122`, :193). Failed delivery reports a committed mutation without encouraging resend (:144). Unexpected namespace exceptions become fixed text asking the caller to read before retrying (`C/mcp-core/surface-tool-handlers.ts:91`). Throwing synchronous observers cannot replace these responses (`C/mcp-core/protocol-dispatcher.ts:2040`). A delivery timeout/cancellation redesign is not introduced by this revision.

### 5. What is missing that the requirements never mentioned?

Compatibility of reserved metadata removal needed an explicit caller audit. SDK interactive sessions construct the session URL at `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1531`. External-agent URLs carry agent/workspace scope at `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/ptah-mcp-url.ts:55`; Ptah CLI uses that helper at `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts:191`. Stdio separately receives launch context at `C/mcp-stdio/stdio-mcp-server.service.ts:317` and :331. No in-repository body-only caller regression was found. Unknown third-party clients were not tested.

## Failure modes

No remaining reproducible failure mode was found in the revision scope. Closure evidence is listed above.

The explicitly deferred shared dispatcher catch still returns raw exception message/stack for other paths (`C/mcp-core/protocol-dispatcher.ts:227`, :1903). This remains a separate security follow-up; this verdict does not approve that behavior or claim dispatcher-wide sanitization.

## Blocking issues

None remaining in scope.

## Serious issues

None remaining in scope.

## Moderate and minor issues

None requiring revision. Residual verification limits are live client schema compatibility and unknown external body-metadata consumers, not demonstrated defects.

## Data flow

1. **OK:** HTTP strips body metadata and stamps URL scope (`C/mcp-http/http-server.handler.ts:372`).
2. **OK:** dispatcher binds request context (:200) and passes getCallerSessionId plus request id, never argument scope (`C/mcp-core/protocol-dispatcher.ts:1680`).
3. **OK:** namespace validates before anonymous/missing-service handling (`C/namespace-builders/surface-namespace.builder.ts:102`, :179).
4. **OK:** mutation outcome and delivery outcome remain separate; public failure detail is fixed while committed revision is retained (:144).
5. **OK:** accepted/render-only and found/not-found map to success; rejected/unavailable/delivery-failed map to MCP tool errors (`C/mcp-core/surface-tool-handlers.ts:53`, :60, :77).
6. **OK:** unexpected surface errors are sanitized before generic dispatcher catches (:103).
7. **OK:** common success and exception callbacks run once under guards (`C/mcp-core/protocol-dispatcher.ts:2024`, :1894). Typed tool-error responses retain their existing policy of no onToolResult callback (:1690, :1921); this revision does not promise notification for every response.

## Requirements fulfilment

| Requirement | Status | Evidence / qualification |
| --- | --- | --- |
| Req 8: caller scope and cross-tab isolation | COMPLETE | HTTP boundary :372; dispatcher :1685; real HTTP tests :161/:192/:211. |
| Strict argument validation and anonymous behavior | COMPLETE | Namespace :102/:179 and :108/:188; scoped identity never comes from args. |
| Honest MCP outcomes and committed delivery failure | COMPLETE | Handler :53/:60/:77; namespace :156. |
| Generated schema, catalog limits and semantics | COMPLETE | surface-tools :130/:224; F4 reproduction :356. Flattening remains an intentional over-approximation. |
| Always-on tools, optional service | COMPLETE | Dispatcher :317; API builder :867; namespace :122/:193. |
| v1 coexistence and comment truth | COMPLETE | API builder :850 chooses bridge with service and legacy fallback otherwise. Message constants :170/:179 accurately qualify that distinction. |
| Synchronous observer isolation | COMPLETE | Dispatcher :2040; surface and non-surface probes pass. |

Implicit requirements not addressed: live third-party MCP client compatibility is not established by these tests. The known generic error disclosure remains separately tracked outside scope.

### Judgement of the original deviations

- **flattenOperationUnion:** accepted as an intentional over-approximation, not equivalent validation. It preserves current branch property schemas and definitions (:76/:95), accurately describes operation-dependent requirements (:101), and leaves runtime validation authoritative. Prior independent Ajv checks accepted all four valid operation shapes; the relevant implementation is unchanged. Future optional or differently constrained shared branch fields would require re-evaluation.
- **Extra API builder wiring tests:** accepted. `C/ptah-api-builder.service.spec.ts:584` verifies the v1 bridge and injected surface service; :612 covers absent service. They exercise composition behavior directly and passed again.

## Edge cases

| Case | Handled | Evidence / remaining concern |
| --- | --- | --- |
| Forged session/agent/workspace body fields | YES | HTTP :372; four independent real HTTP probes. |
| Legitimate session/workspace and agent/workspace URL | YES | Existing HTTP grammar tests and independent probes preserve URL values. |
| Attacker session requests victim surface | YES | protocol-dispatcher.surface.spec :192 returns no victim content. |
| getHost throws private detail | YES | :236 preserves commitment and hides exception. |
| Entry debug, slow warn or callback throws | YES | :254/:273/:300; independent real slow delivery. |
| Non-surface success or exception with throwing observers | YES | Same response text/status as baseline; exactly one callback in both independent probes. |
| Typed surface error callback | EXISTING POLICY | No callback, unchanged; dispatcher :1690/:1921. |
| 40-stat expanding structure | YES | surface-tools.spec :356; corrected 548 KiB answer bound. |
| Missing service / anonymous caller | YES | Namespace :122/:188/:193; targeted suites pass. |
| Provider-specific advertised-schema acceptance | NOT VERIFIED | No live provider/client launch. |

## Verdict

Verdict: APPROVED

- Recommendation: APPROVE
- Confidence: HIGH for F1-F4 closure and examined regressions.
- Top risk: the explicitly deferred generic dispatcher error disclosure remains outside the surface path.
- What a robust implementation would add: separately close that disclosure and exercise the advertised schema with supported live clients before claiming universal provider compatibility.

