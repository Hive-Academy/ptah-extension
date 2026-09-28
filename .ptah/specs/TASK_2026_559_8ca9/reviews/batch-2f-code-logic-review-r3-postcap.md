# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Requested verdict | APPROVE |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 |

Post-cap independent review r3 of Batch 2f after the bounded F1 correction. F1 is fixed: neither the candidate set nor fallback reads the caller-aware workspace API. The injected platform provider is independently host-owned in all three registrations. F2, F3 and F4 remain fixed. No new defect was reproduced.

The score is 8 rather than 6 because the previously reproduced write-destination trust failure is closed, including the real worktree junction and extended Windows spellings. It is not 9–10: packaged hosts and concurrent filesystem mutation were not exercised, and the existing formatter caps and screenshot transcript work remain deferred. These limits are not additional findings.

Scope: the named current dispatcher, its spec, and HTTP service, with the budget helper, approval handler, session-aware wrapper, provider implementations, registration/composition sites and outliner wiring. Read both prior reviews, executor report (including deviations and both corrections), context Decisions 2/3/7, Batch 2f requirements/notes and CONVENTIONS.md. No task-description.md, implementation-plan.md or code-style-review.md exists in this task folder. `ptah_search_files` returned no AGENTS.md; native discovery found no applicable AGENTS.md/CLAUDE.md. No direct Ptah file-read or Write tool was listed, so native reads and writing were used. No production edits, git operations, or raw session-log reads.

Evidence abbreviations below are worktree-relative:

- **D**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`
- **S**: adjacent `protocol-dispatcher.spec.ts`
- **B**: adjacent `tool-result-budget.ts`
- **H**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts`
- **API**: `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`

## Verification

From the requested worktree root, ran once:

`node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache`

Exit **0**, all three targets successful, **26.2 seconds**; output tailed. Scoped `ptah_get_diagnostics` on both production files reported **0 errors, 0 warnings**. The local Nx run is the checkout-specific evidence; no broader project checks were run.

Independent in-memory probes transpiled the actual dispatcher, tool definitions, formatter, budget helper, reducers/token modules and AsyncLocalStorage. Shared constants were loaded from source. Unrelated CLI runtime classes and the execution engine were stubbed; surface dispatch was not exercised by those probes. Filesystem writes/mkdir/pruning were intercepted. These validate dispatcher behavior and intended write destinations, not packaged-host operation. No probe wrote outside the worktree or contacted a UNC share. The existing scoped suite additionally exercised real temporary spools and the real execution engine (S:2186, S:2273, S:2725).

- Actual dispatcher plus helper rejected six declarations: outside absolute path, parent-segment escape, unlisted subfolder, existing worktree `node_modules` junction, ordinary UNC and extended UNC. Each performed one helper invocation and one intercepted write under the first host folder. The real junction target is `D:\projects\ptah-extension\node_modules`, outside this worktree.
- Ordinary, `\\?\` and `\\.\` spellings of the second known folder selected that second folder, not the first. A throwing provider selected system temp. Caller-aware `workspace.getInfo` was instrumented and called **zero** times.
- Additional source-extracted, unmodified root-function probes covered mixed case, trailing separators, collapsed parent segments within a known root, relative/absent declaration, unknown extended local path, ordinary/extended/device UNC, and absent/empty/throwing/null/malformed provider results. All selected the expected host record or temp. A known UNC record matched lexically; no UNC path reached realpath.
- Empty/short success returned unchanged, zero helper calls. A 4,000-character CJK result exceeded the token budget and invoked the helper once.
- Oversized screenshot caption invoked the helper once and stayed within 8,000 chars; its 40,000-character image block was identical, including MIME type. A throwing transcript observer did not change success.
- execute_code success invoked the helper once. An injected execution timeout survived both a throwing callback and throwing error logger. The scoped regression uses a real engine timeout (S:2725).
- A 50,000-character approval input remained intact and parseable, with zero helper calls. Unknown tool names containing a path, newline, 100,000 characters, `__proto__`, null, object, or empty string each emitted one dedicated metric labelled `<unknown>`.
- AST traversal found **56** createToolSuccessResponse calls, **all awaited**, and exactly **two** budgetToolText call sites: central text and screenshot caption. No current model-facing success bypass or double-budget route was found (D:1366, D:2259, D:2506).
- **1,152 configurations** (128 namespace subsets × three IDE values × three SQLite values) produced identical serialized tools/list responses on repeated calls; every advertised ceiling matched the table, with approval excluded (D:324, D:584).

The first standalone probe-loader attempt failed to resolve a dotted TypeScript filename before reaching assertions; the corrected loader completed all checks above. No failed product test was hidden by that harness correction.

## Prior r1 and r2 findings

| Finding | r1 outcome | r2 outcome | r3 status | Evidence / impact |
| --- | --- | --- | --- | --- |
| F1: caller root authorizes automatic spool write | Blocking | Not fixed: caller-aware getInfo used as authority and fallback | **fixed** | D:2337 gets only platform folders; D:2342 returns the matching host record; D:2345 falls back to first folder or temp. H:260/H:380 inject and forward the actual platform provider. Outside/junction/UNC probes no longer redirect writes. |
| F1 Windows extended-local canonicalization limit | Not isolated | Recorded with F1 remediation | **fixed** | D:2368, D:2391, D:2410 normalize prefixes before comparison; normal, extended and device spellings selected the second host record. |
| F2: approval/mixed response text bypasses declared budget | Serious | Fixed | **fixed** | D:585 omits approval's ceiling; D:776 preserves control JSON; D:1366 budgets caption, D:1377 preserves image. Reproduced large control input and oversized caption. |
| F3: observer replaces screenshot success or execution error | Serious | Fixed | **fixed** | D:1358 and D:2482/D:2486 guard callbacks/error logging. Throwing-observer probes preserve image and actionable execution error. |
| F4: arbitrary rejected name enters new telemetry | Moderate | Fixed | **fixed** | D:449 derives allowlist from definitions; D:652 uses sanitized identity, D:662/D:670 emit it. Seven malformed/unknown variants remained `<unknown>`. |

## Real composition: source of authority

H:260 injects `PLATFORM_TOKENS.WORKSPACE_PROVIDER`; H:380 passes that same instance into the sole production dispatcher invocation (H:371).

| Host | Registration | Folder authority | Consequence |
| --- | --- | --- | --- |
| VS Code | `libs/backend/platform-vscode/src/registration.ts:77` constructs VscodeWorkspaceProvider; :78 registers it | `libs/backend/platform-vscode/src/implementations/vscode-workspace-provider.ts:67` maps `vscode.workspace.workspaceFolders` | MCP declaration/session does not supply these records. |
| Electron | `libs/backend/platform-electron/src/registration.ts:150` constructs ElectronWorkspaceProvider; :154 registers it | `libs/backend/platform-electron/src/implementations/electron-workspace-provider.ts:78` copies its stored folders | Active-folder selection and MCP attribution do not replace the folder list. |
| CLI | `libs/backend/platform-cli/src/registration.ts:77` constructs CliWorkspaceProvider; :81 registers it | `libs/backend/platform-cli/src/implementations/cli-workspace-provider.ts:72` copies its stored folders; constructor resolves configured workspace/CWD at :64 | MCP declaration/session does not supply the list. |

The session-aware proxy is local to API construction (API:525), not registered over the platform token. Its actual implementation changes only getWorkspaceRoot, delegating other members (`session-aware-workspace-provider.ts:24`). D:2334 no longer reaches this API at all. Thus the r2 self-authorizing path and its caller-aware fallback are both removed.

Composition roots register the platform first: VS Code `apps/ptah-extension-vscode/src/di/phase-0-platform.ts:44` before LM tools at `phase-2-libraries.ts:116`; Electron `apps/ptah-electron/src/di/phase-0-platform.ts:46` before `phase-3-storage.ts:134`; CLI `libs/backend/cli-engine/src/lib/container.ts:403` before :774. `vscode-lm-tools/src/lib/di/register.ts:90` registers the shared server singleton. H:290/H:296/H:379 retain optional shared-parser outliner wiring; `workspace-intelligence/src/di/register.ts:172` registers that parser. No extra outliner lifetime or new provider registration is introduced.

## Five logic questions

### 1. How does this fail silently?

No new silent failure reproduced. Unrecognized declarations now fall back to a trusted host folder (D:2345), and spool failure is disclosed in the trailer (B:381, B:492). Reduction preserves the full **formatted input** on successful spool (B:260, B:479), not data already removed by an upstream formatter.

### 2. What user action produces unexpected behaviour?

None reproduced within the corrected scope. Selecting the second known folder, including Windows extended spellings, selects that host record (D:2375); selecting an unlisted subfolder or outside junction uses the first folder (D:2345). Without a valid declaration, first-folder selection is the explicit requested fallback, even if another folder is currently active. Screenshot callback failure no longer removes the image (D:1358).

### 3. What input data produces a wrong answer?

No new wrong answer reproduced. Empty/short and token-dense strings take the correct budget branches (D:2289, D:2310). Approval preserves approved input, and tools/list makes no ceiling promise for it (D:585, D:777). The requested untrusted path spellings no longer become write authority (D:2369, D:2375).

### 4. What happens when a dependency fails?

A missing/throwing provider yields no known folders and system-temp fallback (D:2349, D:2355, D:2345), independently of caller-aware getInfo. Failed local realpath retains lexical identity (D:2393); UNC skips realpath (D:2392). Existing budget/spool error handling returns capped text with an explicit failure trailer (B:214, B:492, B:541). Guarded observers cannot replace the revised outcomes (D:2449). One telemetry emission **attempt** per call is guaranteed by finally (D:658); a broken logger cannot guarantee durable storage.

### 5. What is missing that the requirements never mentioned?

No additional reproduced shipping defect. Future multiple-text-block producers would need an aggregate budget policy; current success constructors have only one model-facing text block (D:1382, D:2267). Packaged-host smoke tests and concurrent folder/symlink mutation remain untested. These are residual uncertainty, not invented failure modes.

## Failure modes

None reproduced in this r3 scope. Root selection was checked against independent platform records and exercised through the actual dispatcher/helper, plus the source-extracted edge matrix. Budget routing, observer isolation, telemetry identity and repeated-list bytes were checked as detailed above. Actual packaged host startup and live concurrent filesystem stress were not run.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

None reproduced. No style/naming findings are included.

## Data flow

1. HTTP service supplies its platform provider — **OK** (H:260, H:380); API's session wrapper is separate (API:525).
2. tools/call binds request-local attribution — **OK** (D:228); that attribution is a selector, not the trusted folder source.
3. Tool work returns formatted success — **OK**: 56 awaited central success calls and one mixed screenshot constructor (D:1366, D:2259).
4. Text passes one budget decision — **OK**: within-budget identity pre-check, otherwise one helper invocation (D:2289, D:2299). This retains the previously accepted optimization, not a literal helper call on every success.
5. Root matching uses exact canonical equality and returns the host record — **OK** (D:2375); unrecognized declaration uses first provider folder or temp (D:2345).
6. Helper reduces, fits, spools raw formatted input and appends recovery/failure information — **OK** (B:246, B:260, B:381).
7. Central callback receives model text; response-local WeakMap records counts — **OK** (D:2260, D:2270). Screenshot's separate transcript remains deferred Batch 17 behavior (D:1357).
8. finally emits one dedicated debug metric with allowlisted identity — **OK** (D:449, D:658); this is not a claim of one total log line across all old handlers.
9. tools/list stamps stable metadata from the same budget table — **OK** (D:584); approval is explicitly exempt.

## Requirements fulfilment

| Requirement | Status | Gap / evidence |
| --- | --- | --- |
| Trusted spool authority and fallback | COMPLETE | Platform provider only; all requested root reproductions pass. D:2334. |
| Exact root equality; host record returned | COMPLETE | D:2375; second-root and prefix probes pass. |
| Model-facing success text budgeted once | COMPLETE | One budget decision per success text; oversized helper once, small identity branch. D:2283. Accepted deviation from literal helper invocation. |
| execute_code success budget | COMPLETE | D:2506; probe and scoped suite. |
| Images untouched; mixed caption budget | COMPLETE | D:1366, D:1377; byte-identical image probe. |
| Truthful approval exception | COMPLETE | D:585, D:776; intact control JSON. |
| Central callback sees model text | COMPLETE | D:2260; S:2186. Screenshot transcript re-encode remains Batch 17. |
| Dedicated debug metric per call, including errors | COMPLETE | D:658; probes assert exactly one per exercised call. |
| Unknown tool identity cannot leak into new metric | COMPLETE | D:449; seven malformed/unknown probes. |
| Metadata preservation and repeated byte stability | COMPLETE | D:566/D:589 spread existing keys; S:2798; 1,152 configurations. |
| Browser-content pin and outliner wiring | COMPLETE | S:2432; H:290/H:379. Existing upstream caps are not removed by this batch. |

Implicit requirements not addressed by this bounded batch: future aggregate multi-block budgeting and live concurrent filesystem mutation hardening. No present defect in either was reproduced.

Retained limits from r1/r2: browser formatter caps both sections before budgeting (`mcp-response-formatter.ts:1473`); execute serialization caps at 50 KiB (`code-execution.engine.ts:478`, :503). The spool preserves what reaches the helper, not all original page/execution data. Browser follow-up and screenshot transcript/default-format work remain the already scheduled later work, not new r3 regressions. Historical pre-extraction byte parity was not established: no historical snapshot was supplied and no git operations were performed. Repeated-call equality validates current determinism only.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty/short result | YES | Identity result, zero helper calls; D:2289 | Intentional optimization |
| Under chars but over tokens | YES | CJK probe invokes helper once; D:2310 | None reproduced |
| Oversized JSON/log/execute success | YES | Scoped tests plus dispatcher probes; S:2186/S:2234 | Upstream caps remain |
| Image plus huge caption | YES | Caption once, image unchanged; D:1366 | Separate transcript deferred |
| Oversized approval | YES | Whole control JSON, no ceiling; D:585 | Explicit exception |
| Outside/parent/subfolder/junction | YES | Exact membership, trusted fallback; D:2375 | Actual node_modules junction checked |
| Ordinary/extended/device UNC | YES | Lexical comparison; D:2392/D:2411 | No live network test |
| Second folder / case / trailing separators / local prefixes | YES | Correct host record selected; D:2390/D:2410 | None reproduced |
| Missing/empty/throwing/malformed provider | YES | Temp fallback; D:2349 | No caller-API fallback |
| Callback/error logger throws | YES | Guarded revised paths; D:2449/D:2482 | Not every old log site audited as a new feature |
| Repeated tool lists | YES | 1,152 stable configurations; D:324 | Historical parity unverified |
| Concurrent identical request ids | Static only | ALS + response WeakMap + exclusive create; D:228/D:2244/B:479 | No live concurrency stress |

## Verdict

- **Recommendation: APPROVE**
- **Confidence: HIGH** for closing F1 and preserving the tested Batch 2f behavior; host execution and concurrency limits are stated above.
- **Top risk:** static registration tracing is not a packaged-host smoke test, and existing upstream caps still bound what can be recovered from a spool.
- **What a robust implementation would add:** a retained composition-level root regression using the HTTP dependency wiring; packaged-host smoke coverage; the already planned upstream-cap and screenshot-transcript follow-ups. No further bounded correction is requested by this review.

