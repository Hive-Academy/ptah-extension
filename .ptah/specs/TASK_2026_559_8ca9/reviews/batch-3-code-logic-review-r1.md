# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 1 (pre-existing HTTP transport edge case, outside Batch 3) |
| Failure modes found | 1 |

Batch 3 verdict: **APPROVE**. No reproduced defect in the new caller resolver, context addition, list composition, report attribution, or caller-kind telemetry. The moderate observation below is a transport limitation, not a regression introduced by this batch. Both deviations are accepted for this scope.

Paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`. `CORE` means `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core`; `HTTP` means its sibling `mcp-http`; `RUNTIME` means `libs/backend/cli-agent-runtime/src/lib`.

Reviewed all six named production/spec files in full, plus the HTTP entry path, workspace consumers, lane URL construction, and relevant host registration. Read batches.md (including plan risks, Batch 2f behavior and Batch 3 notes), executor report, context decisions 5–6, and the requested research passages. No task-description.md, implementation-plan.md or code-style-review.md exists in this task folder; this is explicitly a plan-free bugfix. Ptah's AGENTS.md search returned no files; native worktree discovery also found no AGENTS.md. Applied the supplied project guidance. No production code or session logs were changed/read respectively; no git operations were performed.

### Verification

Ran once from the worktree root:

`node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache`

- Lint: PASS. Typecheck: PASS.
- Tests: **67 suites passed, 1 failed; 1,539 tests passed, 1 failed**. The failure was `HTTP server lifecycle > logs the started line exactly once even after a port fallback`: `listen EACCES: permission denied ::1:59700`. The suite also reported a worker requiring forced exit. The lifecycle fixture creates a real listener and exercises neighboring ports (`HTTP/http-server.handler.spec.ts:220`); this is not evidence of a caller-identity failure. It remains a failed verification run, not an all-green run, and was not rerun.
- Scoped `ptah_get_diagnostics` on the caller and dispatcher files: typescript-compiler, **0 errors, 0 warnings**.
- All named Batch 3 specs and the Batch 2f F1 spool-trust tests passed in that project run (`CORE/protocol-dispatcher.spec.ts:2528`, `:2878`; `CORE/mcp-request-context.spec.ts`; `CORE/mcp-caller.spec.ts`).
- Additional in-memory reproduction used the actual TypeScript HTTP handler, transpiled with the installed compiler, exposing its private request function only in memory. EventEmitter request/response doubles exercised its body parsing, URL extraction and catch path. No source edits or listener were needed. Results are recorded in F1.

An 8 distinguishes sound batch logic with exercised contracts from the 5–6 band: no batch defect was reproduced. It is below 9 because transport-level malformed encoding remains inconsistent with one plan statement, verification is not wholly green, and packaged-host/report delivery was traced rather than run live.

## Five logic questions

### 1. How does this fail silently?

No new silent failure reproduced. `CORE/protocol-dispatcher.ts:1121` reads only `getCallerAgentId`; absent identity returns an explicit `delivered:false`, `unattributed-caller` at `:1125`. A router refusal remains visibly undelivered, covered at `CORE/protocol-dispatcher.spec.ts:1660`. Observer failures cannot replace the result (`CORE/protocol-dispatcher.ts:696`, `:2494`). F1 is an explicit HTTP error, not success-looking data.

### 2. What user action produces unexpected behaviour?

Calling a malformed percent-encoded MCP URL produces a JSON parse error even with valid JSON: F1 (`HTTP/http-server.handler.ts:274`, `:394`). A caller with a blank agent segment now receives `unattributed-caller`, as intended (`CORE/protocol-dispatcher.spec.ts:1610`); generated agent IDs do not use blank values.

### 3. What input data produces a wrong answer?

None reproduced in the Batch 3 paths. `CORE/mcp-caller.ts:50` reads only the three reserved fields; `:81` accepts only nonblank strings while retaining valid strings verbatim. The branch precedence at `:73` is agent, session, workspace, anonymous. Body-forged reserved fields are stripped before those reads (`HTTP/http-server.handler.ts:372`). List data remains identical across identities (`CORE/protocol-dispatcher.spec.ts:2922`). The raw session/workspace distinction discussed below is deliberate compatibility, not a normalized security principal.

### 4. What happens when a dependency fails?

The resolver has no I/O or asynchronous dependency. Rejected individual tools become `isError:true` responses (`CORE/protocol-dispatcher.ts:2145`), and the telemetry `finally` still runs (`:694`). Logging failure is contained by `runObserver` (`:2494`). Host-folder lookup failure yields an empty known-folder list and then the system temporary directory (`:2394`, `:2390`), never a caller-selected spool destination. Batch 3 adds no timeout, cancellation or background task; it does not change existing dependency timeout behavior.

### 5. What is missing that the requirements never mentioned?

The requirements do not fully distinguish malformed decoded field values from malformed percent encoding. The former reaches the resolver and is handled; the latter fails earlier (F1). Identity is attribution rather than authentication, explicitly documented at `CORE/mcp-caller.ts:17`; no trust decision or tool narrowing is introduced. The stdio service is a separate catalog/dispatcher (`mcp-stdio/stdio-mcp-server.service.ts:136`, `:167`), so this batch does not add an agent-report route to it.

## Failure modes

### F1 — Malformed URL encoding is reported as malformed JSON (moderate, existing, outside batch)

- Trigger: valid JSON-RPC `tools/list`, id `7`, posted to `/agent/%E0%A4%A`, `/session/%`, or `/workspace/%FF`.
- Symptom: HTTP 400, `{jsonrpc:"2.0",id:0,error:{code:-32700,message:"Parse error",data:"URI malformed"}}`; dispatcher callback invoked zero times.
- Evidence: unguarded decoding at `HTTP/http-server.handler.ts:248`, `:274`, `:306`; extraction at `:379`; catch classification at `:394`. `batches.md:113` promises an anonymous caller for malformed URL segments.
- Current handling: the transport catches the URIError alongside JSON parsing failures, drops the original request ID and returns an explicit error. It neither dispatches a tool nor borrows any identity.
- Reproduction: actual handler with request/response doubles, all three URLs above. Controls: `/agent/agent-7/workspace/D%3A%5Cws` returned agent `agent-7`, root `D:\ws`, id `7`; `/` returned anonymous despite forged body/params fields.
- Recommendation: in a transport-owned follow-up, distinguish URI decoding from JSON parsing and pin the chosen malformed-URL policy. If implementing the plan's anonymous fallback, discard the malformed request's attribution atomically rather than retaining a partially decoded identity. Otherwise return an explicit invalid-URL refusal with the parsed request ID and update the plan wording.
- Severity judgment: moderate, because a malformed endpoint is an unusual input, failure is explicit and request-local, generated URLs use `encodeURIComponent`, and no misdelivery or security boundary bypass was reproduced. It does not block this batch's listed-file change.

## Blocking issues

None reproduced in Batch 3.

## Serious issues

None reproduced in Batch 3.

## Moderate and minor issues

- **Moderate F1:** existing transport decoding/classification gap, detailed above. No additional issue count for the same symptom.
- Verification limitation, not a Batch 3 defect: the real-port lifecycle test failed with EACCES (`HTTP/http-server.handler.spec.ts:220`). Investigate that environment/test fixture before representing the required command as green.

## Data flow

1. **OK:** `HTTP/http-mcp-server.service.ts:371` sends requests to the shared dispatcher; the HTTP parser replaces all reserved body fields with URL-derived values (`HTTP/http-server.handler.ts:372`). **F1 gap:** invalid escapes stop before dispatch.
2. **OK:** `CORE/mcp-caller.ts:50` produces a fresh object from this request only. No mutable identity cache, params lookup, inferred agent or previous caller is involved.
3. **OK:** list resolution stays outside AsyncLocalStorage (`CORE/protocol-dispatcher.ts:331`). `buildToolSet` delegates to the existing definitions (`:365`), then eager flags precede result ceilings (`:337`). `approval_prompt` remains exempt (`:621`, `:819`). Caller kind cannot alter the list.
4. **OK:** tools/call resolves once, copies normalized agent ID and the existing raw session/workspace values into a fresh store (`CORE/protocol-dispatcher.ts:235`). `storage.run` scopes it to the async chain (`CORE/mcp-request-context.ts:53`). Concurrent agent contexts and post-call absence are exercised in `CORE/mcp-request-context.spec.ts:149`; no shared assignment of agent identity exists.
5. **OK:** report validation rejects caller-supplied agentId (`CORE/protocol-dispatcher.ts:569`); attribution comes from the context getter only (`:1121`). Delivery is awaited (`:1132`), and explicit refusal is preserved.
6. **OK:** one tool-result debug line adds only the closed callerKind union (`CORE/protocol-dispatcher.ts:696`, `:761`). It adds no IDs or paths; privacy assertions cover all four kinds (`CORE/protocol-dispatcher.spec.ts:3012`). This finding concerns the new telemetry field, not a claim that all pre-existing application logs are identifier-free.
7. **OK:** budget spooling continues to select host-owned folders and treats the raw declared root only as a match candidate (`CORE/protocol-dispatcher.ts:2379`, `:2409`). Batch 2f F1 guards remain exercised, including unknown roots, traversal, subfolders, junctions, UNC and Windows extended paths (`CORE/protocol-dispatcher.spec.ts:2528`).

### Legitimate reporting callers and host wiring

The change does not remove a legitimate identity source: the old transport agent field is copied into the request context before report dispatch (`CORE/protocol-dispatcher.ts:245`, `:1121`).

- Rival lanes mint their ID before `runSdk` and pass it as `agentId` (`RUNTIME/cli-agents/agent-process-manager.service.ts:292`, `:354`). Codex (`cli-adapters/codex-cli.adapter.ts:611`), Copilot (`copilot-sdk.adapter.ts:343`), Cursor (`cursor-cli.adapter.ts:338`), OpenCode (`opencode-cli.adapter.ts:539`, `:609`) and Antigravity (`antigravity-cli.adapter.ts:541`, `:633`) forward that ID to the shared URL builder, relative to `RUNTIME/cli-agents`.
- The builder encodes `/agent/{id}` before the terminal workspace segment (`RUNTIME/cli-agents/cli-adapters/ptah-mcp-url.ts:46`). This matches the HTTP extractor and preserves nonblank IDs exactly.
- Custom Ptah lanes reserve the same ID before building the SDK handle (`libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts:213`, `:236`, `:263`). The registry passes it through (`RUNTIME/ptah-cli/ptah-cli-registry.ts:672`) to `ptah-cli-spawn-options.service.ts:191` under its `helpers` directory.
- The runtime reads the actual listener port through the optional host port (`RUNTIME/cli-agents/agent-spawn-environment.service.ts:384`), registered by `libs/backend/vscode-lm-tools/src/lib/di/register.ts:109`; HTTP composition passes requests to this dispatcher (`HTTP/http-mcp-server.service.ts:371`). Pi explicitly has no MCP support (`RUNTIME/cli-agents/cli-adapters/pi-cli.adapter.ts:306`). A host without an HTTP listener does not acquire reporting support from this batch; the CLI stdio catalog is independent.

These are source traces plus the passing dispatcher attribution tests, not a claim of a fresh packaged-host smoke test.

### Structure assessment

No structural change is required for this batch. The resolver is a pure local module with a type-only protocol import (`CORE/mcp-caller.ts:21`); the existing request-context interface gains one optional readonly field (`CORE/mcp-request-context.ts:39`), preserving its callers. List composition has one explicit insertion point (`CORE/protocol-dispatcher.ts:358`), and neither new runtime registration nor a cross-library deep import is introduced by that module. The unused caller parameter is the deliberately reserved composition input, not missing filtering: User Decision 6 requires every caller to retain the same set. The dispatcher is already large; this review does not prescribe an unrelated extraction.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Precedence and blank/non-string handling | COMPLETE | `CORE/mcp-caller.ts:50`, `:73`, `:81` |
| No params identity or prior-caller borrowing | COMPLETE | Resolver plus HTTP field replacement; in-memory control reproduced |
| Same list across four kinds and repeats | COMPLETE | `CORE/protocol-dispatcher.spec.ts:2922`, three host configurations |
| Definition/eager/budget order and approval exception | COMPLETE | `CORE/protocol-dispatcher.ts:335`, `:621`, `:819` |
| Agent identity bound once and async isolation | COMPLETE | `CORE/protocol-dispatcher.ts:235`; context isolation spec |
| Single report identity source and explicit refusal | COMPLETE | `CORE/protocol-dispatcher.ts:1121`; generated URL paths retained |
| One protected tool-result telemetry line, kind only | COMPLETE | `CORE/protocol-dispatcher.ts:696`, `:761` |
| Host-owned spool root | COMPLETE | `CORE/protocol-dispatcher.ts:2379`; F1 guard suite passed |
| Malformed URL always becomes anonymous | PARTIAL | Decoded malformed fields work; malformed encoding is F1 |
| Required verification command entirely green | PARTIAL | Lint/typecheck pass; one unrelated real-port test fails |

### Judgment of deviations

**Deviation 1 — accept.** Retaining raw session/root values at `CORE/protocol-dispatcher.ts:243` preserves the pre-existing consumer contracts. In particular, the spawn workspace resolver checks a truthy declared root against open folders and refuses it by name (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-caller-workspace-resolver.ts:66`); dropping a whitespace declaration could instead enable an anonymous fallback. The normalized caller describes the attribution kind; these raw fields remain transport inputs, not validated paths. Other workspace resolution already has its own declared/caller/active/provider rules (`workspace-root-resolver.ts:50` in that directory). This acceptance is compatibility-focused, not a blanket claim that all pre-existing workspace fallbacks are safe. HTTP only supplies strings or undefined; non-string raw context values require an out-of-contract in-process caller. The spool trust check is independent and remains host-owned.

**Deviation 2 — accept.** `ptah_agent_spawn` reads `request._callerSessionId` at `CORE/protocol-dispatcher.ts:1007`, exactly the value copied into `callerSessionId` at `:243`. There is no competing params-based identity or second normalization rule. Existing parent fallback/resolution remains in `namespace-builders/agent-namespace.builder.ts:176`. Switching that read to a getter would not change this batch's behavior and is unnecessary to establish the single agent-report identity source.

Implicit requirements not addressed: live packaged-host concurrent report delivery and malformed-URL policy beyond decoded fields. Neither is represented as newly verified here.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty/whitespace/non-string reserved fields | YES | Resolver omits them | Raw session/root compatibility is intentional |
| Agent + session + workspace | YES | Explicit precedence, own values only | HTTP grammar normally excludes simultaneous agent/session |
| Repeated lists | YES | Same ordered builders; byte comparisons | Host configuration changes legitimately change list |
| Concurrent contexts | YES | AsyncLocalStorage.run and interleaved agent test | No live packaged-host stress run |
| Report without agent / forged argument | YES | Explicit refusal / strict schema rejection | No session-as-agent fallback |
| Dependency rejection / throwing observer | YES | Error response / observer containment | Existing dependency-specific timeouts unchanged |
| Unknown or UNC declared spool root | YES | Host-provider match or fallback | No new trust authority |
| Malformed percent encoding | NO | Explicit transport parse error | F1, moderate follow-up |
| stdio request | YES | Separate catalog/dispatcher | No claim of newly added reporting support |

## Verdict

- Recommendation: **APPROVE** Batch 3.
- Confidence: **HIGH** for the changed behavior; **MEDIUM** for packaged-host integration, which was source-traced.
- Top risk: the plan overstates malformed-URL fallback; invalid encoding still fails before caller resolution.
- What a robust implementation would add: a transport-level malformed-encoding policy and regression guard, a deterministic real-port lifecycle test/environment resolution, and packaged-host concurrent reporting smoke evidence. No Batch 3 production revision is required by the reproduced evidence.

