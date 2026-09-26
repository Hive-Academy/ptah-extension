# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Requested verdict | REVISE |
| Blocking issues | 1 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 1 |

Round 2, Batch 2f. **F1 is not fixed in the production composition:** the alleged host-owned root is obtained through the caller-aware API, then added to the trusted set. F2, F3 and F4 are fixed. The central budget routing, mixed screenshot response, metadata and new telemetry passed the checks below.

6/10 reflects working budget enforcement and three repaired findings, but an unresolved automatic filesystem-write trust boundary. That excludes the sound 7–8 band. The improvements over round 1's two serious defects distinguish this from the previous 5/10.

Scope: the complete current dispatcher, its named spec and HTTP service; relevant budget helper, approval handler, workspace namespace/resolver/provider, analyzer/service methods and host registrations. Read round 1, the executor report including deviations/revision, context Decisions 2/3/7, and the batch requirements, notes and plan risks. No task-description.md, implementation-plan.md or code-style-review.md exists in this task folder. Ptah file search returned no AGENTS.md; no direct file-read tool was listed, so native reads were used. Repository CONVENTIONS.md was read. No production edits, git operations or raw session-log reads.

Abbreviations below, all relative to this worktree:

- **D**: libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts
- **S**: the adjacent protocol-dispatcher.spec.ts
- **B**: the adjacent tool-result-budget.ts
- **H**: libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts
- **API**: libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts
- **Core**: libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/core-namespace.builders.ts
- **Resolver**: libs/backend/vscode-lm-tools/src/lib/code-execution/workspace-root-resolver.ts
- **Analyzer**: libs/backend/workspace-intelligence/src/composite/workspace-analyzer.service.ts
- **Workspace**: libs/backend/workspace-intelligence/src/workspace/workspace.service.ts

## Round 1 findings

| Finding | Status | Evidence and outcome |
| --- | --- | --- |
| F1 — caller root authorizes spool destination | **not fixed** | D:2334, :2338, :2352 trust workspace.getInfo(); API:525, :953 and Core:113 make that API caller-aware. Reproduced outside-root, parent-segment, subfolder and junction selection through the composed path. |
| F2 — approval and screenshot text bypass declared ceiling | **fixed** | D:583 exempts only approval_prompt from the ceiling; D:780 preserves its control response. D:1365 budgets screenshot caption, D:1376 preserves image bytes, D:1388 records counts. Oversized approval and screenshot probes pass, including webview allow/deny variants. |
| F3 — observers replace screenshot success / execution failure | **fixed** | Screenshot callback guarded at D:1357; execute_code error logger/callback guarded at D:2477, :2481. Throwing callbacks and throwing debug/warn/error loggers preserved the tested tool outcome. |
| F4 — rejected raw names enter new telemetry | **fixed** | D:447 derives identity from definitions at D:333; D:656 uses it for debug and slow warn. Seven malformed/unknown-name variants map to '<unknown>'; forced slow-call probe also passes. |

## Verification

- From the worktree root, ran the requested command once:
  `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache`.
  Tailed output; exit **0**, all three targets successful, **24.7 seconds**. No workspace-wide checks.
- Scoped ptah_get_diagnostics on both production paths: **0 errors, 0 warnings**. The worktree-local Nx run supplies checkout-specific verification.
- In-memory Node/TypeScript probes loaded the actual dispatcher, definitions, formatter, reducer/token modules, budget helper and AsyncLocalStorage. Unrelated agent runtime/engine dependencies were stubbed. Filesystem mkdir/write/prune operations were intercepted; **no spool was written outside the worktree and no UNC share was contacted**.
- F1 reproduction additionally composed the actual workspace-root resolver, session-aware provider and workspace namespace. It executed source-extracted, unmodified analyzer/service methods (`getCurrentWorkspaceInfo`, `getProjectInfo`, `computeWorkspaceInfo`, `analyzeRoot`) with deterministic detector/filesystem dependencies. Cache plumbing was bypassed; detectors did not perform real workspace analysis. This reproduces the root propagation and write destination, not an end-to-end packaged-host exploit.
- Used the existing worktree **node_modules junction**, whose real target is `D:projectsptah-extension
ode_modules`, for the requested link variant. Its realpath is outside the trusted worktree; the composed call nevertheless selected its spool subdirectory.
- Oversized approval input returned **50,050 chars** unchanged, zero budget-helper calls. Both webview allow and deny returned intact parseable control JSON. Approval advertises no ceiling (D:585).
- Oversized screenshot caption returned **2,147 chars**, **one** helper invocation and **one** intercepted spool write; its 40,000-character image data and MIME block remained identical (D:1365, :1376).
- execute_code success returned **2,116 chars**, one helper invocation; an injected execution timeout plus throwing callback/error logger retained the timeout and recovery guidance (D:2472).
- Empty success preserved the empty string with zero helper invocations. A 4,000-character token-dense CJK success invoked the helper once despite fitting the char ceiling (D:2309).
- Unknown-name probes: path, newline-bearing name, 100,000-character string, __proto__, null, object and empty string. Each produced one dedicated debug metric with '<unknown>'. A deterministic clock forced the slow warning and verified the same sanitized name (D:667, :676).
- AST audit: **56 createToolSuccessResponse calls, all awaited**, and **two budgetToolText callers** (central response and screenshot). No current success producer with a second independently budgeted model-facing text block was found (D:1350, :2253, :2501).
- **1,152 tools/list configurations**: 128 subsets of seven namespaces × three IDE values (undefined/false/true) × three SQLite values. Every repeated serialized response matched; every listed name was recognized by the allowlist. The full set contains **55 tools**. A sentinel _meta key survived eager/budget stamping on all 55 (D:550, :583).
- Historical byte parity limitation: no pre-extraction source snapshot was supplied and this review performed no git operations. Therefore this verifies the current extracted list, its deterministic composition and gating, not a byte comparison against a historical checkout. Do not treat repeated-call equality as proof of historical equality.
- No packaged VS Code/Electron/CLI smoke or live concurrency stress was run. Host wiring was traced statically.

## Five logic questions

### 1. How does this fail silently?

A successful oversized result can write raw output under an unapproved declared root while the implementation describes it as host-owned. workspace.getInfo() reflects that same caller root, so the root becomes its own authority at D:2338. The trailer reports a path, but no refusal identifies the trust failure. See F1.

### 2. What user action produces unexpected behaviour?

Call an oversized success tool through an MCP URL declaring an arbitrary absolute root, a subfolder that is not an open workspace, or an existing junction under a known folder. The composed dispatcher selects that root for spooling instead of the actual open folder (D:2334; API:953; Resolver:45).

Throwing transcript observers no longer remove the tested screenshot or replace the execution error (D:1357, :2481).

### 3. What input data produces a wrong answer?

The wrongly trusted value is the root, not the reduced text: an unapproved root that workspace analysis can describe is returned in WorkspaceInfo.path and appended to the allowlist (Workspace:403; Analyzer:419; D:2338). The fixed-host test double in S:2497 hides this composition.

The tested token-dense, empty, approval and mixed-image inputs behaved as described above (D:2288, :1365, :780).

### 4. What happens when a dependency fails?

If getWorkspaceFolders throws, knownWorkspaceFolders returns [] (D:2368). That does **not** neutralize F1: the caller-aware hostRoot is still appended at D:2338. When both root sources fail, the isolated probe selects system temp (D:2344).

The budget helper retains its nonthrowing failure/trailer behavior (B:214, :260, :492). Throwing callback and telemetry logger probes preserved the tested outcomes (D:667, :2444, :2481). A thrown dispatch with no response still emitted one error metric (D:664). One emission **attempt** is guaranteed; a failing logger cannot guarantee durable log storage.

### 5. What is missing that the requirements never mentioned?

A distinct **trusted host-root dependency** is required. A session-aware convenience API is not an authority for validating the session's own declaration (API:525; D:2352). Root validation also needs a composed regression, rather than a stub that always returns an unrelated fixed host path (S:2497).

The approval machine-control exception is now explicit in code and truthful in metadata (D:575, :585). Screenshot transcript re-encoding remains the previously scheduled Batch 17 work; D:1356 still formats a separate transcript string before budgeting the model caption. This is not counted as a new round 2 finding.

## Failure modes

### F1 — Caller-aware workspace API launders the declared root into the trusted set (Blocking)

- **Trigger:** a tools/call success exceeds its budget, and the request declares an unapproved absolute workspace root for which the workspace API returns info.
- **Symptom:** raw tool output is spooled beneath the declared destination, including an outside directory or junction target; the call still returns normal success.
- **Evidence:** D:2334 calls hostWorkspaceRoot; D:2352 reads ptahAPI.workspace.getInfo; D:2338 appends that result to known folders. API:525 creates the session-aware provider; API:953 resolves the declared root first; Core:113 forwards it to analysis. Resolver:45 returns the declaration without trusted-folder validation. Workspace:403 and Analyzer:419 retain that path. B:475 creates the selected spool directory and B:479 writes raw output.
- **Current handling:** canonical equality and returning the host's record are sound only when every candidate is independently trusted. The appended workspace.getInfo result is not. The fallback at D:2344 trusts it too, so deleting only known.push(hostRoot) would not fix the issue. Lookup runs before validation, so the revision's “never touch an unknown UNC share” claim also cannot hold across the production analyzer.
- **Reproduction:** the real composed resolver/namespace/analyzer methods propagated each declaration and the real helper attempted these intercepted destinations:
  - `<WT>/../outside-review-probe` → `D:projectsptah-extension.claude-worktreesoutside-review-probe.ptah	mpmcp-out<generated>.txt`.
  - `<WT>/libs/backend`, absent from the known-folder list → its own spool directory, rather than the host root.
  - `<WT>/node_modules` → its own spool directory; real junction target is outside WT.
  - `\servershare` → that share's spool directory (all network-related effects mocked).
- **Why the new specs pass:** S:2497 makes getInfo return a fixed hostRoot. Production's getInfo instead resolves the request context. The unit test tests the validator with an authority the actual composition does not supply.
- **Recommendation:** resolve allowed roots and fallback from the injected platform provider or another explicit host-owned/session-owned record API. Never add caller-derived workspace.getInfo to the trusted set or use it as trusted fallback. Validate before invoking caller-root workspace analysis. Retain canonical handling and system-temp fallback, and add the real composition regression.

## Blocking issues

### F1 — Unapproved automatic spool write remains reachable

- **File:** libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:2338
- **Scenario:** the caller-aware “host root” repeats an unapproved URL root, including a junction outside the known workspace.
- **Impact:** raw output can be persisted outside the intended host-owned workspace or to a caller-selected share using host permissions. This is not a demonstrated arbitrary-file overwrite or remote privilege escalation; exclusive filenames remain intact.
- **Fix:** replace the source of authority and fallback as described in F1; test through the session-aware namespace composition.

## Serious issues

None reproduced in the revised batch.

## Moderate and minor issues

No additional independently reproduced shipping failure is counted. In the isolated fixed-host probe, `\?D:...libs` failed to match the ordinary spelling of the same known folder: isUncPath treats the extended local prefix as UNC and skips realpath (D:2403, :2416). This is a canonicalization limit to address alongside F1, not a second production wrong-workspace finding: today's caller-aware getInfo masks it by admitting the declared spelling itself.

## Data flow

1. Request context binds caller attribution — **OK for attribution**, not an authorization decision (D:228).
2. Tool executes and produces formatted success — **OK** across the 56 awaited central callers and screenshot caption branch (D:1365, :2253).
3. Char/token pre-check — **OK**: matches the helper identity condition; within-budget strings return unchanged (D:2309; B:231).
4. Root resolution — **GAP F1**: caller-aware getInfo becomes trusted root and fallback (D:2334, :2338, :2344).
5. Reduction, cut, spool and trailer — **OK for the selected input/destination**, with honest write failure handling (B:246, :260).
6. Response and observers — **OK for revised paths**: budgeted central text, intact image block, guarded callback/error observers (D:2260, :1376, :2481).
7. Telemetry — **OK**: response-local WeakMap counts, allowlisted identity, one debug attempt in finally (D:447, :664, :720).
8. Transport composition — **OK wiring**, but wired dependencies do not fix F1's mistaken authority choice (H:371, :380).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Model-facing success text budget routing | COMPLETE | Identity pre-check handles small output; helper once for oversized output. Literal helper invocation on every success remains the accepted deviation. D:2288. |
| Inline image preserved | COMPLETE | Image block unchanged; screenshot text separately budgeted. D:1365, :1376. |
| Approval control response truthful | COMPLETE | Whole JSON, no advertised char maximum. D:585, :780. |
| Central callback matches model text | COMPLETE | D:2260; separate screenshot transcript change remains Batch 17. |
| Safe spool-root authority | MISSING | F1 survives production composition. D:2338. |
| One dedicated debug metric including errors | COMPLETE | D:664; tested success, error and throw. |
| New metric excludes caller-provided unknown identity | COMPLETE | D:447; normal and forced-slow probes. |
| Metadata preservation / repeated-call byte stability | COMPLETE | 1,152 current configurations and sentinel test; D:320, :550, :583. |
| Historical extraction byte parity | PARTIAL | Historical source unavailable without forbidden git operations; current gating/list construction verified. |
| Allowlist and current list share definitions | COMPLETE | Single builder, full capabilities/no disabled namespaces at D:449. No separate name table to drift today. |
| workspaceProvider reaches every dispatcher host | COMPLETE | One production invocation, H:371; existing provider injection H:262 passed at H:380. |
| Outliner wiring and browser pin | COMPLETE | H:290, :296, :379; existing browser regression ran in scoped tests. |

Host registration evidence: PLATFORM_TOKENS.WORKSPACE_PROVIDER is registered in platform-vscode/src/registration.ts:78, platform-electron/src/registration.ts:154 and platform-cli/src/registration.ts:81. Their composition roots run before LM-tool registration: VS Code phase-0-platform.ts:44 then phase-2-libraries.ts:116; Electron phase-0-platform.ts:46 then phase-3-storage.ts:134; cli-engine/src/lib/container.ts:403 then :774. The shared CodeExecutionMCP singleton is registered at vscode-lm-tools/src/lib/di/register.ts:90. The new dispatcher dependency is forwarded through that one shared server, not separate unwired host builders.

Implicit requirement still unmet: spool authorization must be independent of the caller value it validates.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty/short text | YES | Identity branch, zero helper calls | Intentional optimization, D:2288 |
| Under chars but over tokens | YES | Dense-text probe reduced once | D:2309 |
| Huge success / execute_code | YES | One helper invocation and spool | Earlier formatter/serialize caps remain pre-existing limits |
| Image plus oversized caption | YES | One caption budget; image identical | D:1365 |
| Approval auto-allow / webview allow / deny | YES | Whole parseable control JSON | Explicit exception, D:585 |
| Throwing callback / debug / warn / error logger | YES | Tested revised observer boundaries | Not a claim that every old tool-specific log is guarded |
| Malformed/huge unknown name | YES | Fixed telemetry label | Raw rejection response remains unchanged |
| Declared subfolder of a known folder | NO | Composed getInfo admits it | F1 |
| Existing junction under known folder pointing outside | NO | Real node_modules junction selected | F1 |
| Outside path / parent segments / UNC | NO | Caller-root authority reused | F1 |
| Mixed case / trailing separators | YES | Fixed-host probe selects the known record | D:2410 |
| Extended local prefix | NO | Isolated canonical equality misses normal spelling | Folded into F1 remediation; production masking explained above |
| Nonexistent known folder | YES | Lexical identity retained | Host-owned record authorizes creation; not a separate defect |
| getWorkspaceFolders throws | NO for trust | [] returned, but caller-aware hostRoot still trusted | F1; fixed-host probe safely falls back |
| Both root lookups fail | YES | Temp fallback | D:2344 |
| Concurrent / repeated request ids | Static only | ALS, WeakMap, exclusive creation | No live stress performed |

## Verdict

- **Recommendation: REVISE**
- **Confidence: HIGH** for F1 and the revised dispatch behavior; historical parity and packaged-host execution remain explicitly limited.
- **Top risk:** an untrusted declared root is reintroduced as trusted through the caller-aware workspace API.
- **What a robust implementation would add:** a platform-owned root/folder authority; a trusted fallback independent of workspace.getInfo; a composed root-resolution regression covering outside paths, subfolders, junctions and UNC; extended-prefix normalization tests.

