# Batches - TASK_2026_712_5d7c

Total tasks: 43 | Batches: 43 | Complete: 0/43

## Authority, execution and notation

- Mode 1 decomposition only. Approved architecture revision 1 and its APPROVED review are the technical inputs. Requirements revision 1, design revision 2, their cross-side approvals, parity inventory and recorded decisions remain authoritative. Older pending-gate sentences in source documents do not reopen passed Gates 1/1.7/2.
- WORKTREE = `D:/projects/ptah-extension/.claude-worktrees/provider-accounts` (below, W). TASK = `D:/projects/ptah-extension/.claude-worktrees/provider-accounts/.ptah/specs/TASK_2026_712_5d7c` (below, T). Every file entry beginning `W/` expands to that exact absolute worktree path; it is not a path relative to the main checkout. Every report entry beginning `T/` expands to that exact absolute task path. Executor prompts MUST expand these prefixes before dispatch. This notation does not authorize directory-wide editing.
- **No commits, pushes, branch changes, staging, stash, reset, worktree creation or other git mutation.** The user's task-specific instruction overrides the role's commit expectations. COMPLETE here means on-disk verification, scoped checks, and a recorded uncommitted file/diff checkpoint, never committed or release-ready. Do not invent commit SHAs. Main remains untouched.
- Every batch has one task (its functional seam), at most six writable code/config/spec files, at most two changed projects. All batches are sequential. Later reuse of a file is intentional sequential ownership, not parallel safety. Implementation reports and team-leader state edits are not additional production-file ownership.
- Recommended executor for every bounded code batch: **CLI lane, capable TypeScript implementation, currently Grok CLI preferred (xAI family)**. This is the supplied live roster, not a vendor ranking. Actual execution family is **unassigned until dispatch**; record actual lane/model/family in each report and checkpoint. Codex/Copilot are disabled; OpenCode/Glm at limit; Antigravity exhausted; do not force-spawn. Recheck live eligibility before eventual dispatch. Fallback: another enabled, installed different-family lane of suitable capability with confirmed room, then an eligible same-family alternative, then orchestrator-approved specialist subagent with the precise unavailability reason recorded. Do not silently enable a disabled lane. No agents are spawned by this decomposition.
- UI batches 31–33 and 42 prefer the same capable live lane with Angular skill; fallback frontend-developer only if the lane lacks needed UI capability or is unavailable, with the reason and actual execution family recorded. Rendered review is a later visual-reviewer assignment, Electron only, currently permission-held.
- Review family: independent **in-process code-logic-reviewer of a different family from the actual implementer** (expected Anthropic versus xAI; verify, do not infer family from an agent's role name). New public API also gets independent code-style review. If the families are the same, orchestrator must record a specific availability exception and label evidence weaker; a reviewer never approves its own implementation.
- Every batch reads its plan references, this validation section, preceding reports for its dependencies, and the parity rows it can affect. No broad rediscovery of the repository. Read/AST existing files before editing. New files are real functional implementations, not TODO/STUB/PLACEHOLDER scaffolds. Do not create parallel V2/Legacy systems or an alternate stream protocol.

## Mandatory eventual lane prompt (repeat verbatim, then expand ownership and command)

All edits and checks must stay inside D:/projects/ptah-extension/.claude-worktrees/provider-accounts; main is untouched. Electron first. No TUI or VS Code feature/polish; visuals Electron only. Shared changes keep affected dependent hosts compiling through minimum compatibility corrections and require scoped dependent-host tests/typecheck. Only changed projects plus affected dependent hosts may be checked. Nx --parallel=1, Jest --maxWorkers=2, one heavy check at a time across ALL lanes. No workspace-wide checks; no build/serve/dev/e2e/package unless the user asks. No credential/.env reads, live login/logout/inference, external actions, user questions, app launch/screenshots or git mutation. Mocked process/query/filesystem fixtures and temporary directories only for tests. Do not edit task.md or batches.md. No raw credential, identity, path, environment, prompt or CLI-output logging. Implement all owned functional work, not stubs. Keep live named auth/query launch fail-closed; tests inject seams, never shipping authorization bypasses. Stop and report an ownership/contract blocker instead of silently editing extra files. Return each task's evidence, absolute files, actual execution family, checks and risk outcomes to the assigned report path. You create no commits.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Strict serial ownership and Claude before Codex | User specifies ordinary sequencing, Claude first and bounded assignments; plan 316–325 identifies shared mutable integration files. Chosen serial contracts → registry → SDK/resources → entry points → RPC/UI → Claude checkpoint → Codex. Parallel implementation is not worth concurrent registry/contract edits or verification contention. | Yes, only independent finalized-contract tests could later be parallelized with one check lock. |
| No-commit checkpoints replace commit gates | Context, decisions D8 and current instruction prohibit git mutation. Record base HEAD 0fc0c3a09, batch input/output file hashes and patch checkpoints instead of SHA milestones. | Only explicit later authorization can change this. |
| System tuple activation is late | Adding a discriminant early breaks exhaustive consumers; prepare existing maps/config and real adapter first, then activate tuple and registration together. Preparatory tables may explicitly type their extra supported `claude` key while preserving existing exhaustiveness; no fake adapter registration or unimplemented path. | Yes; changes stay uncommitted. |
| Codex phase is a conditional assignment | Requirements phase order requires Claude non-Codex acceptance first; mocked technical proof cannot satisfy installed compatibility/rendered/release holds. Batches 36–43 are planned but not dispatchable while the Claude exit gate is unmet. | Gate evidence or an explicit scope/order decision can change readiness, not reviewer inference. |
| Fail closed, no automatic abandoned-lease recovery | Plan 136 expressly excludes PID/age-only stealing. Unresolved reservations block their own physical route, not unrelated routes. | A later separately approved recovery contract is needed. |
| Existing files are extended | Plan evidence and scoped path inventory confirm integration sources exist; proposed account files are new. Latest inspected migration is 0055, so reserve 0056 provisionally and recheck at Batch 4. | Rename only a not-yet-created migration when a concurrent number is claimed. Never renumber an applied migration. |
| SEQ-B02: declaration-only Batch 2 may be dispatched before Batch 1 acceptance | Alternatives: hold all dependent work, or permit only the three-file token seam. Choose the bounded sequencing exception: B01-V2 records fresh shared typecheck/lint, 122 suites / 3748 passing tests and clean scoped diagnostics; host-verification-disposition.md:76–94 permits consideration of this exception but does not itself grant it. Batch 2 defines backend contracts and token identifiers only; its existing files contain token constants/type exports, not registration. This changes implementation order only, not dependency acceptance. | Yes. Stop on any scope/runtime expansion or invalidated shared input; the full Batch 1/2 host gates and P1-A acceptance remain held. No further batch is authorized. |

## Plan validation

Status: PASSED WITH RISKS. No unavoidable plan contradiction found. No heavy checks or production edits performed in decomposition.

Assumptions (4, all unverified installed-runtime holds):

- A1: deployed Claude status reports canonical directory and authMethod. Batch 6 proves strict fixtures; authorized installed evidence remains required. No fabricated email/org fields.
- A2: empty-prompt accountInfo can progress before any conversation-bearing query/prompt. Batches 10, 17, 20 and 22 prove mocked ordering and teardown. Installed compatibility remains required; never bootstrap by releasing a prompt.
- A3: selected user-state locator and effective project/local/managed auth precedence. Batches 6, 8, 13 and 14 reject indeterminate/conflicting source, expose unsupported requested imported user MCP/approvals, preserve project trust and explicit Ptah MCP. Do not invent selected `.claude.json` locations. Installed evidence remains required.
- A4: Codex file-store isolation and official-command outputs. Batches 36–40 use versioned fixtures and refuse unproved concurrent stores, including ambient reservations. Installed evidence remains required; keyring/auto/ephemeral are not certified.

| Risk | Severity | Mitigation / resolution checkpoint |
| --- | --- | --- |
| Host-global env or later spread overrides selected routing | HIGH | Batch 8 applies final pure helper at completed main/one-shot env; Batch 9 applies it after safe lane env; Batch 14 covers model/control; Batch 22 proves host env unchanged. |
| Conversation or resume data precedes identity/durable linkage | HIGH | Batches 10/17/20 implement empty gate, conversation-free bootstrap, own-final-query check, both awaited writes and failure teardown. Batch 22 matrix. |
| Resume trusts CLI index absence/current default | HIGH | Batches 3/16/18/19/21 validate authoritative registry binding, malformed-versus-absent distinction, all internal resume/child routes. |
| Cross-process mutation/aliasing and stranded lease | HIGH | Batches 4–7 transactions, physical identity, tombstones, operation IDs/epochs; no await inside SQL transaction; retain uncertain reservation. |
| Wrong owner/query/cache or invented allowance | HIGH | Batches 12/15/23/24 preserve event-time identity, own-query reads, dedup known owners, isolated unknowns, old-epoch discard and bounded disposal. |
| SDK extraction drops native permissions/MCP/continuation | HIGH | Batches 9/11/22/34 compare native options and handle semantics, preserve callbacks and exact advertised continuation-only messaging. |
| DI cycle/eager SQLite/forgotten package or export wiring | HIGH | Batches 2/7/8/11/27/30/35; SDK imports token port only, lazy auth registration before persistence; expected-resolvable and host smoke checks. |
| RPC/notifications expose paths or accept authoritative caller bindings | HIGH | Batches 1/25–29 strict schemas, host/workspace capability, sanitized snapshots, CAS/idempotency and out-of-order recovery. |
| Tuple/config/namespace/host parity drift | MEDIUM | Batches 24/26/28/30/34/35 derivation and serialization tests plus scoped dependent-host gates; original seven lanes retained. |
| UI source tests mistaken for rendered proof or authorization | HIGH | Batches 29–35 and 42/43 test mocked actions; separate held Electron visual gate, release gate and A1–A4 ledger. No task completion while evidence absent. |
| Codex singleton/proxy/refresh uses other home | HIGH | Batches 36–43 scoped pool, refresh reservations/generation, App Server home match, token/proxy/catalog/MCP/rollout context and identity-only aggregation. |

Edge cases: canonical aliases and replacement (5); DB busy/failed commit/two connections (4–7); timeout/cancel/late success/abandoned reservation (6/10/17/20); deleted/renamed/default-changed/retargeted/unknown binding (16/18–22); no-parent lane and real SDK ID (16/19/20); cost handoff/slash/rewind/fork/children (18/21/22); no-open-query and stale owner response (15/23/24); duplicate transcript roots (12/24); no accounts and stale UI snapshot/unconfirmed write (29–33); unverified Codex store and late refresh after logout (36–41). Each numbered batch task owns its named case.

## Scoped verification and checkpoint protocol (applies to every batch)

### One command per batch

The commands below call this PowerShell session function; it is command text for the orchestrator, NOT a new repository script/file. Run from W only. It serializes targets and avoids inventing tests/lint for token-only projects. Before running, the orchestrator resolves the named project.json files and confirms target availability. If a named non-token project lacks a target, record that exact limitation and use its existing scoped test/typecheck mechanism; do not substitute a build or claim a skipped gate passed.

```powershell
function Verify-ProviderAccountsBatch {
  param([string[]]$Projects, [string[]]$Hosts)
  $all = @($Projects + $Hosts | Select-Object -Unique)
  foreach ($project in $all) {
    & npx nx typecheck $project --parallel=1
    if ($LASTEXITCODE -ne 0) { throw "typecheck failed: $project" }
    if ($project -eq '@ptah-extension/auth-providers-tokens') { continue }
    & npx nx lint $project --parallel=1
    if ($LASTEXITCODE -ne 0) { throw "lint failed: $project" }
    & npx nx test $project --parallel=1 --maxWorkers=2 --coverage=false
    if ($LASTEXITCODE -ne 0) { throw "tests failed: $project" }
  }
}
```

- `$H = @('ptah-electron','ptah-cli','ptah-tui','ptah-extension-vscode','ptah-extension-webview')` is the explicit affected host set for shared/default runtime or frontend-core/chat changes. Add the actual named CLI-engine dependent project only if dependency evidence identifies it, record its exact project name and targets before dispatch, and never run an inferred/workspace-wide set. No unnamed project checks. Tests/typecheck of affected intermediary libraries follow actual dependency evidence; if extra writable compatibility files exceed ownership, stop for a separate bounded correction batch.
- Every batch command below uses its named changed projects plus `$H` because these seams are shared across these hosts; duplicate names are removed. Do not parallelize this function or run it while another lane owns the heavy-check lock. Capture one foreground execution, filter/retain header, failures and summary, and link full log in report rather than re-run for output. A scoped missing-test-project limitation is not evidence of a default runtime test; ensure mocked host smoke coverage exists at Phase exit.
- Focused Jest may diagnose a failing owned spec only with `npx jest -c <absolute-owned-project>/jest.config.ts <absolute-owned-specs> --coverage=false --maxWorkers=2`; it does not replace required project/affected-host gates unless the orchestrator records an evidence-backed scoped equivalent.
- `ptah_get_diagnostics` after edits MUST pass absolute WORKTREE file paths, never unscoped main-root diagnostics. An unavailable diagnostics tool result is recorded honestly; it does not replace the named native scoped checks.

### Uncommitted checkpoint / report contract

Before a batch, capture read-only status and changed-file inventory, base HEAD, and hashes of owned inputs. After it, independently inspect AST/source and all changed paths, mark task IMPLEMENTED only when substantive work exists, run its one command, and compare owned file diffs and unrelated input hashes. Record a batch-numbered checkpoint in the implementation report: exact absolute paths, input/output hashes, read-only cumulative `git diff --binary` plus untracked-file snapshots (git diff alone omits new files), own-batch delta, check output/log path, actual executor family, risk disposition and preserved capabilities. Do not stage or commit. Team-leader records checkpoint identifier/report path in the batch header when COMPLETE. A failed check or unresolved risk leaves IN_PROGRESS; extra/missing files are a rejection, not a silent scope expansion. Reviews consume checkpoint diffs, including untracked content, not imaginary commit ranges. Reports are inputs to later verification; this decomposition creates none of them.

At each implementation phase's last batch, stop for one combined independent code-logic review; add style for new exported APIs. No per-batch review. One fix round: Blocking/Serious and Moderate that can break lane config or lose data, then one fix-only re-review; other Moderate/Minor become explicitly named deferred issues. Fix ownership must again obey six-file/two-project bounds. No acceptance from reports alone.

## Batch 1: Safe shared account vocabulary — COMPLETE (D11; host gates via CI per D8a)

- Recommended executor: CLI lane, bounded schema/type capability; actual executor Grok 4.7 / xAI. Acceptance verifier: in-process OpenAI; this is not the independent phase review.
- Execution mode: sequential. Depends on: none. Phase: P1-A Foundation. Phase review: code-logic + style at Batch 7.
- Task 1.1 — IN_PROGRESS. Own exactly:
  - CREATE W/libs/shared/src/lib/types/provider-account.types.ts
  - CREATE W/libs/shared/src/lib/types/provider-account.schemas.ts
  - CREATE W/libs/shared/src/lib/types/provider-account.schemas.spec.ts
  - MODIFY W/libs/shared/src/index.ts
  - MODIFY W/libs/shared/src/schemas.ts — fifth-file ownership authorized by parent for executor correction; preserve the zod-free main barrel.
- Verification checkpoint B01-V1: NOT ACCEPTED; batch and Task 1.1 remain IN_PROGRESS. Verification findings returned in team-leader final transcript (report-file writing prohibited by the active role instruction); requested T/implementation-verification-batch-01.md was not created. Four original files independently inspected and hashes match implementation report; schemas remain unavailable from the public schema barrel. Executor must add public re-export and a public-entry import regression in the owned spec; no deep cross-project imports. Correct label blacklist to bounded display text per plan 122, not a path/CLI policy. Binding shape matches plan 117; no preference-based binding redesign assigned.
- Scoped checks B01-V1: shared typecheck/lint/test pass (122 suites, 3745 tests; six lint warnings); all five host typechecks pass. Host lint passes except webview circular-boundary error at app.routes.ts:224:7. All five host test projects have failures/blocked suites (exact totals/logs in verification report). Electron/CLI/TUI/VSCode test targets require forbidden builds; direct existing Jest-config runs were diagnostic alternatives, not passing equivalents. No builds or bypass flags used. Host infrastructure/unchanged-source blockers require separately bounded orchestrator disposition, not silent scope expansion. No commit, release, rendered-review or phase-review acceptance.
- Correction verification checkpoint B01-V2: **NOT ACCEPTED (retained host gates)**; Batch 1 and Task 1.1 remain IN_PROGRESS; COMPLETE count remains 0/43. All five owned files were independently inspected through AST and source; all five current Git blob hashes match the updated implementation report before and after checks. Actual implementer Grok 4.7 / xAI; correction verifier OpenAI, not the independent phase reviewer. HEAD unchanged at `0fc0c3a09d104517e4a19a7ece73ddcc0ed788d1`; no production edits or git mutations. The index AST parser reported a recovered parse; native source inspection and the executed TypeScript check, not that AST result, establish compilation.
- B01-V2 correction findings RESOLVED: public schemas export is present at W/libs/shared/src/schemas.ts:28; the spec imports schema values from `@ptah-extension/shared/schemas` at W/libs/shared/src/lib/types/provider-account.schemas.spec.ts:8–20, mapped to that public entry at W/tsconfig.base.json:235. Main barrel adds only the plain types export at W/libs/shared/src/index.ts:32; no new zod dependency there. Display labels are 1–64 code units, trimmed, without C0/DEL controls (W/libs/shared/src/lib/types/provider-account.types.ts:139–147), not path/command-policy text; public-entry tests accept `Research & Development`, `Work: Europe`, `Team/A`, and `Büro work`, and reject overlength/control/blank/padded text (owned spec:226–253). Strict excess-authority-key rejection and malformed-present-binding versus absence remain implemented and tested. Binding schema is unchanged from the correction input; no redesign.
- B01-V2 fresh shared checks: targets inspected in W/libs/shared/project.json:19–34 and W/nx.json:24–63 before execution; no build dependencies on these targets. Bash executed serially, each with `NX_DAEMON=false NX_NO_CLOUD=true`, `--parallel=1 --skip-nx-cache`: `npx nx typecheck @ptah-extension/shared`, then `npx nx lint @ptah-extension/shared`, then `npx nx test @ptah-extension/shared --maxWorkers=2 --coverage=false`. All real exit codes 0; logs confirm target execution, skipped cache and successful completion. Scoped `ptah_get_diagnostics` on the five absolute owned paths also returned clean coverage, 0 errors / 0 warnings; this supplements, not replaces, the native checks. Tests: **122 suites / 3748 tests passed**; lint: 0 errors / 6 warnings outside the five owned files. The earlier 3745 count is pre-correction evidence only. Full logs: T/verification-batch-01-correction-shared-typecheck.log, T/verification-batch-01-correction-shared-lint.log, T/verification-batch-01-correction-shared-test.log. One heavy check at a time; no host reruns, build targets, skip hooks, build bypass flags, app launches or external operations.
- B01-V2 retained host evidence (NOT newly executed): all five prior host typecheck logs show success; prior host lint logs show success except W/apps/ptah-extension-webview/src/app/app.routes.ts:224:7 (circular boundary with `@ptah-extension/command-center`; T/verification-batch-01-ptah-extension-webview-lint.log:8). Every host test gate remains unresolved: Electron 22 failed / 44 passed / 1 skipped suites (66 of 67), 22 failed / 1018 passed / 3 skipped tests; CLI 41 failed / 27 passed / 1 skipped suites (68 of 69), 9 failed / 418 passed / 2 skipped tests; TUI 2 failed / 24 passed suites, 1 failed / 345 passed tests; VSCode 10 failed / 6 passed suites, 1 failed / 94 passed tests; webview 7 failed / 12 passed suites, 400 passing tests but suite-load failures. Exact retained logs: T/verification-batch-01-ptah-electron-test-direct.log:1943–1944; T/verification-batch-01-ptah-cli-test-direct.log:3070–3071; T/verification-batch-01-ptah-tui-test-direct.log:107–108; T/verification-batch-01-ptah-extension-vscode-test-direct.log:345–346; T/verification-batch-01-ptah-extension-webview-test.log:206–207. Direct Jest diagnostics for the four build-dependent hosts are not passing equivalents of their Nx test gates.
- B01-V2 blocker classification: all five retained test logs report unresolved `marked` mapping to worktree `node_modules/marked/lib/marked.umd.js` (Electron/CLI/VSCode:6, TUI:21, webview:9). Four build-dependent hosts also report missing distribution artifacts (Electron:174 onward; CLI:777 onward; TUI:2; VSCode:220); building or bypassing those gates is not authorized. Electron additionally reports missing `node_modules/electron/path.txt` and `package.json` (retained Electron log:702,901). These are observed test infrastructure/artifact failures and the webview source lint cycle, outside owned correction scope. Host files are absent from the task's changed-source inventory, but **no clean-base execution evidence exists here: not baseline-proven, not waived, not passed**. Prior host success/failure evidence predates the correction and remains explicitly historical.
- B01-V2 uncommitted owned checkpoint, ordered blob IDs: W/libs/shared/src/index.ts `f9576b99890b669535344ee873ae47945b89f630`; W/libs/shared/src/schemas.ts `687ae01a1755689d89b76222f5672dbccdd80177`; W/libs/shared/src/lib/types/provider-account.types.ts `44a71bd5b7c0f7b70295980fc2020760adf84ecc`; W/libs/shared/src/lib/types/provider-account.schemas.ts `7d6c48d1963a42c3ddf6f3113f3020e372f9a8b6`; W/libs/shared/src/lib/types/provider-account.schemas.spec.ts `e038c7010dc6cc4a20acadadeb45bb41bb43a70c`. Tracked diff consists of the two additive exports; three new files remain untracked. Updated executor report contains their correction content and hash ledger; this checkpoint does not claim the prior tracked patch alone contains untracked files.
- **Next action (B01-V2):** return to orchestrator for separately bounded disposition of the named host infrastructure/artifact/lint gates, retaining Batch 1 IN_PROGRESS / NOT ACCEPTED. Do not send the same schema corrections back to the executor or repeat the known-failing host suites. The corrected shared vocabulary is additive with no consumer activation, so there is no newly found technical defect preventing preparatory additive Batch 2 work, but its recorded dependency on accepted Batch 1 is not satisfied; any sequencing decision belongs to the orchestrator and must explicitly carry these unresolved gates, never call the full gate clean or mark Batch 1 COMPLETE. No batch-state promotion, waiver, commit or phase-review acceptance is granted here. Independent P1-A logic/style review remains due only after Batch 7. No verification report markdown was written, per the active role instruction; full findings are returned in the verifier transcript.
- Plan reference: 112–124; pattern: existing provider-profile types/schema and public barrel. Contract: bounded opaque IDs/labels, provider/scope discriminants, omitted/ambient/named request, safe state/result codes, sanitized summary, versioned binding known/unknown evidence. No public path/env/epoch/owner-authoritative input; corrupt binding differs from absence.
- Acceptance: schema roundtrip; reject excess path/env/binding authority, invalid provider/scope/revision, malformed binding; public summary serializes no secrets/raw identity/directory. No system tuple activation yet.
- Verification command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/shared') -Hosts $H`
- Report: T/implementation-report-batch-01.md. Boundary viability: additive usable contracts only, all old consumers unchanged.

## Batch 2: Token-only backend admission port — COMPLETE (D11; host gates via CI per D8a)

- Executor: Grok CLI, TypeScript DI/contracts; execution sequential; family xAI. Orchestrator dispatch under SEQ-B02; source work only, verification deferred to orchestrator. No check was run by the advisory decision.
- Depends on: 1. Phase: P1-A. Phase review: code-logic + style at 7. **SEQ-B02 relaxes implementation ordering only, not this acceptance dependency.** Batch 1 / Task 1.1 remain IN_PROGRESS and B01-V2 NOT ACCEPTED; COMPLETE count remains 0/43. Batch 2 is eligible for later bounded dispatch, not accepted or started by this advisory.
- Task 2.1 — IN_PROGRESS. Own exactly:
  - CREATE D:/projects/ptah-extension/.claude-worktrees/provider-accounts/libs/backend/auth-providers-tokens/src/lib/provider-account-admission.port.ts
  - MODIFY D:/projects/ptah-extension/.claude-worktrees/provider-accounts/libs/backend/auth-providers-tokens/src/lib/tokens.ts
  - MODIFY D:/projects/ptah-extension/.claude-worktrees/provider-accounts/libs/backend/auth-providers-tokens/src/index.ts
- Plan 117–120, 238; pattern existing token-only auth exports. Define backend-only closed readonly ClaudeAccountRoute union, resolved resource context and admission/action service interfaces with explicit reservation lifecycle. No index signature/AuthEnv bag, concrete auth-providers import or UI route exposure. Named route comes only from implementation validation, not caller structural typing.
- SEQ-B02 hard boundary: interfaces, type aliases, type-only imports/exports and token identifiers following existing `Symbol.for` constants only. Those constants identify ports; they do not register or resolve services. No concrete admission/action implementation, runtime validation function, resource acquisition, constructor side effect, DI registration/resolution, host/SDK consumer wiring, environment application, tuple activation, persistence or auth action. Do not modify Batch 1 files or any infrastructure/config/package/lockfile/host file; do not touch marked mapping, dist artifacts, Electron installation or the webview lint cycle. If the seam requires another file or executable behavior, stop for orchestrator disposition instead of extending the exception.
- Acceptance: token types compile, type-level callers cannot pass arbitrary env/path through public selection; no eager service resolution or new dependency cycle. Token-only project has typecheck, not invented lint/test targets. Inspect source/type contracts independently; typecheck alone does not establish untrusted-caller admission. No runtime consumer may trust structural typing as certification.
- Interim declaration checkpoint command (future execution only): `npx nx typecheck @ptah-extension/auth-providers-tokens --parallel=1`. Existing configuration is W/libs/backend/auth-providers-tokens/project.json:18–23, invoking `tsc --noEmit --project libs/backend/auth-providers-tokens/tsconfig.lib.json`; this target has no build prerequisite, and W/nx.json:24–63 supplies no typecheck build dependency. The project declares no test/lint targets. Scoped diagnostics on the three absolute owned paths supplement the future typecheck. Record an interim checkpoint, never COMPLETE or full acceptance from this command alone.
- Full acceptance command RETAINED: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/auth-providers-tokens') -Hosts $H`. It serializes token typecheck then host typecheck/lint/test per the existing function, Electron first. For each explicit affected host (`ptah-electron`, `ptah-cli`, `ptah-tui`, `ptah-extension-vscode`, `ptah-extension-webview`), the existing commands are `npx nx typecheck <host> --parallel=1`, `npx nx lint <host> --parallel=1`, `npx nx test <host> --parallel=1 --maxWorkers=2 --coverage=false`. These are retained obligations, NOT instructions to run prohibited build dependencies: four host test targets require builds, so full execution remains held pending separate authorization/disposition. Direct Jest diagnostics are not passing substitutes. Batch 1 host disposition/remediation and passing required affected-host checks for both batches must be resolved before Batch 2 COMPLETE or P1-A foundation acceptance; no phase/host/release claim while open.
- Holds unchanged: historical host failures remain not baseline-proven, not waived, not passed; retained typecheck successes do not cure test/lint holds. All host verification, subscription release/enablement, A1–A4 installed-runtime compatibility, abandoned reservation limitations, and Electron dark/light rendered evidence holds remain unresolved. This exception grants no install, build, baseline run, infrastructure correction, live auth/inference or external action permission.
- Handoff: orchestrator may later dispatch only this batch after checking lane eligibility and marking Batch 2 / Task 2.1 IN_PROGRESS. Expand and repeat the Mandatory eventual lane prompt above; read B01-V2, T/implementation-report-batch-01.md, T/host-verification-disposition.md:76–94 and this SEQ-B02 boundary. Assign one capable TypeScript contracts lane, serially, with exactly these three absolute code paths; record actual family. Use Batch 1 input hashes from B01-V2 to detect drift; do not rewrite those inputs. Future verification uses only the interim token command and scoped diagnostics under the single heavy-check lock. Return substantive contract/source evidence, absolute changed paths, own delta/input-output hashes and any blockers. No git mutation, checks with build prerequisites or extra file ownership. A failed/expanded seam returns to hold, not a bypass.
- Report: T/implementation-report-batch-02.md. Boundary: no runtime registration until implementation exists. **Stop after this declaration-only batch and return to team-leader; SEQ-B02 authorizes no Batch 3–43, runtime continuation or phase acceptance.** A later sequencing decision is required before any further dispatch while Batch 1 remains unaccepted.
- B02-V1 bounded verification checkpoint: **INTERIM DECLARATION CHECK PASSED / NOT ACCEPTED OVERALL**. Report, SEQ-B02 decision, approved plan 117–120/135–136 and host disposition 76–94 read independently. Actual implementer Grok 4.7 / xAI; declaration checkpoint verifier OpenAI, not an independent phase review. Batch 1 / Task 1.1 and Batch 2 / Task 2.1 remain IN_PROGRESS; COMPLETE count stays 0/43. No commit, phase acceptance or subsequent dispatch.
- B02-V1 source inspection: all three owned files have clean AST parses (zero error nodes) and were read in full. The port contains only type-only imports, interfaces/type aliases and an ambient `export declare const ...: unique symbol` at W/libs/backend/auth-providers-tokens/src/lib/provider-account-admission.port.ts:27. Its computed keys and `typeof` references at 32/49 occur only in interfaces; no runtime symbol value or property access is emitted by those declarations. Named routes have exactly the plan's backend fields plus this phantom brand; the route/resource unions are readonly, with no index signature or env bag. Requests accept shared selection/scope and attempt IDs, not caller-authoritative routes/paths/epochs. Run release/retain match reservation/operation/epoch keys; no age/PID reclamation API. Action signatures return shared code/summary types; no implementation, resource acquisition, registration, host consumer or environment/persistence mutation exists.
- B02-V1 public-port finding: W/libs/backend/auth-providers-tokens/src/index.ts:3–31 exports every port/request/result/route/resource/reservation type with `export type`; the shared dependency is also `import type` from its public root. Consumers can name the port, call its methods and narrow returned resources using package-root types without deep imports or runtime symbol references. Future validated producers can use a local type assertion to those public types without obtaining the brand. **The brand is phantom, not runtime admission proof**: the future implementation must validate/certify/reserve before asserting a route, never import/use the declared symbol as a runtime value or test for its presence. The module's wording about carrying/attaching/asserting the symbol is not an implementation instruction. No runtime admission is established by this checkpoint. No actionable declaration-source correction found by inspection; no additional fixture/compiler command authorized or run.
- B02-V1 tokens: tracked diff preserves every old token member and appends only `SDK_PROVIDER_ACCOUNT_ADMISSION: Symbol.for('SdkProviderAccountAdmission')` and `SDK_PROVIDER_ACCOUNT_ACTIONS: Symbol.for('SdkProviderAccountActions')` at W/libs/backend/auth-providers-tokens/src/lib/tokens.ts:67/72. No concrete auth-providers/zod dependency is added. This is source evidence of dependency direction, not a runtime cycle/host compatibility claim.
- B02-V1 uncommitted checkpoint: HEAD remains `0fc0c3a09d104517e4a19a7ece73ddcc0ed788d1`; tracked input blobs from HEAD match report (`src/index.ts` `2574f6a7bedc74d48649485958a0987247f38343`, `src/lib/tokens.ts` `4b46ab12488d8996d7f85c9c881764b1933f834f`). Owned output blobs independently match report: W/libs/backend/auth-providers-tokens/src/index.ts `83616178020b8991abc495fd07d1b1c1afa7c754`; W/libs/backend/auth-providers-tokens/src/lib/tokens.ts `a03c1a8fbbfa77e30b2549a95832029004a3ad65`; W/libs/backend/auth-providers-tokens/src/lib/provider-account-admission.port.ts `165277f7bb773cca5b7dffa289f4f2a521c39935` (new/untracked; not represented by tracked diff). All five shared Batch 1 inputs independently match the B01-V2 hashes above and the B02 report. Read-only git commands only; no object writes or other git mutations.
- B02-V1 checks: parent discovered peers (ListAgents is unavailable in this verifier's listed tools), coordinated the busy `card-design-v3` owner, and relayed confirmed free slot / peer hold before execution. One foreground native command, exactly `npx nx typecheck @ptah-extension/auth-providers-tokens --parallel=1`, exited **0**; log shows actual `tsc --noEmit --project libs/backend/auth-providers-tokens/tsconfig.lib.json`, successful target completion, 2.5 seconds and 0/1 cache hits. Non-failing Nx Cloud disabled/free-plan code 401 warning is retained, not concealed or repaired. Log: T/verification-batch-02-tokens-typecheck.log. Then serial `ptah_get_diagnostics` on exactly the three owned absolute files returned typescript-compiler / clean coverage, **0 errors / 0 warnings**, no omitted sibling diagnostics. Parent notified to release the heavy slot after both completed. No other verification target, build, install, host rerun, live operation or implementation occurred. All three B02 outputs and five B01 inputs were rehashed afterward and remain identical to the recorded blobs; HEAD unchanged. Project target and Nx defaults confirm no typecheck build prerequisite; no token lint/test target exists.
- **Next action (B02-V1):** return to orchestrator; this exception ends at this declaration checkpoint. No actionable declaration correction is required from this bounded inspection/check. Do not mark either batch/task COMPLETE, start Batch 3, wire runtime consumers or infer full foundation acceptance. Retained affected-host typecheck/lint/test obligations still require separately bounded host disposition/remediation; historical failures remain not baseline-proven, not waived or passed, and four host test targets remain build-held. Release/subscription enablement, A1–A4 installed compatibility, abandoned reservations and Electron dark/light rendered evidence remain open. P1-A independent logic/style review is still due at Batch 7, not performed here. No task carrier or production edits; only this existing ledger and the permitted native command log were written.

## Batch 3: Binding transport contracts without changing legacy routing — COMPLETE (Codex; types-only, CI gate per D8a)

- Recommended executor: CLI lane, shared compatibility; sequential; actual family unassigned.
- Depends on: 1–2. Phase P1-A; review at 7.
- Task 3.1 — PENDING. Own exactly:
  - MODIFY W/libs/shared/src/lib/types/provider-profile.types.ts
  - MODIFY W/libs/shared/src/lib/types/provider-profile.schemas.ts
  - MODIFY W/libs/shared/src/lib/types/agent-adapter.types.ts
  - MODIFY W/libs/shared/src/lib/types/agent-process.types.ts
  - CREATE W/libs/shared/src/lib/types/provider-account-binding.spec.ts
- Plan 116–124, 189–193; pattern existing start/resume/slash profiles and persisted CLI reference. Add optional typed binding/linkage and selection fields; preserve AuthEnv finite credential keys. Carry binding version/run/linkage, never canonical directory in public references. Do not add claude to SYSTEM_CLI_TYPES until Batch 26.
- Acceptance: old unbound records parse unchanged; malformed present binding refuses; rename-independent ID survives start/resume/slash/reference roundtrip; no required field breaks current callers.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/shared') -Hosts $H`
- Report: T/implementation-report-batch-03.md.

## Batch 4: Registered forward-only account migration — COMPLETE (Codex; CI gate per D8a; phase review at 7) (renumbered 0056→0058 after main merge: 0056/0057 taken)

- Recommended executor: CLI lane, SQLite migration/tests; sequential; actual family unassigned.
- Depends on: 1–3. Phase P1-A; review at 7.
- Task 4.1 — PENDING. Own exactly:
  - CREATE W/libs/backend/persistence-sqlite/src/lib/migrations/0058_provider_accounts.ts
  - CREATE W/libs/backend/persistence-sqlite/src/lib/migrations/0058_provider_accounts.spec.ts
  - MODIFY W/libs/backend/persistence-sqlite/src/lib/migrations/index.ts
- Plan 131–140; pattern 0055 and sqlite-lane-outcome transaction precedent. Recheck next unused migration number before creating; if changed, report proposed exact replacement paths for ownership update first. Static tables/indexes for profiles, selections, tombstones, operation reservations, run bindings/leases; unique physical route, revisions/epochs/idempotency. No credentials/raw identities.
- Acceptance: fresh/upgrade/repeated migration, uniqueness and referential constraints, rollback, two-connection busy handling, isolated temp DB; no data/credential migration. Registry explicitly imports/registers migration.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/persistence-sqlite') -Hosts $H`
- Report: T/implementation-report-batch-04.md.

## Batch 5: Real canonical routes and transactional account store — COMPLETE (Codex; CI gate per D8a; phase review at 7)

- Recommended executor: CLI lane, filesystem/SQLite correctness; sequential; actual family unassigned.
- Depends on: 4. Phase P1-A; review at 7.
- Task 5.1 — PENDING. Own exactly:
  - CREATE W/libs/backend/auth-providers/src/lib/accounts/provider-account-route.ts
  - CREATE W/libs/backend/auth-providers/src/lib/accounts/provider-account-route.spec.ts
  - CREATE W/libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts
  - CREATE W/libs/backend/auth-providers/src/lib/accounts/provider-account.store.spec.ts
  - MODIFY W/libs/backend/auth-providers/package.json
- Plan 128–140; pattern public SQLite transaction/prepared statements and db-path profile location. Add persistence-sqlite internal dependency using current version convention. Realpath/physical identity and immutable canonical fingerprint; no blanket lowercasing. Transactional CAS/add/remove/selections/reservations/bindings and retained tombstones; no async transaction across processes/network.
- Acceptance: two connections racing add/admit/auth/select/remove, aliases/junction/case-sensitive distinctions, route replacement, ambient collision, busy/failure rollback, no age/PID lock stealing. Failed Add deletes only its newly owned empty directory; never external content. Stuck route does not block unrelated route.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/auth-providers') -Hosts $H`
- Report: T/implementation-report-batch-05.md.

## Batch 6: Claude official actions and fail-closed source certification — COMPLETE (Codex; CI gate per D8a; live commands release-held; phase review at 7)

- Recommended executor: CLI lane, backend process state-machine/testing; sequential; actual family unassigned.
- Depends on: 2/5. Phase P1-A; review at 7.
- Task 6.1 — PENDING. Own exactly:
  - CREATE W/libs/backend/auth-providers/src/lib/accounts/provider-account.service.ts
  - CREATE W/libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.ts
  - CREATE W/libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts
  - CREATE W/libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.spec.ts
  - CREATE W/libs/backend/auth-providers/src/lib/accounts/provider-account-auth-env.spec.ts
- Plan 142–156, 95–106. Pattern detector launch descriptor/process-spawner port. Implement label-only Add beside profile DB, list/rename/remove/default/independent selections and official argument-array status/login/logout/cancel through injected ports. Default writes both selections atomically; Add never selects. Status certifies directory/authMethod, not invented email/org. Source precedence refuses unknown/conflicting helpers/cloud/token/Console; finite certified selector clearing. No execution of apiKeyHelper.
- Acceptance (adds review R1): result text never passes raw or credential-shaped dependency output; only closed codes map to safe sentences. Full not-signed-in/pending/cancelled/failed/disconnected/signed-in/signed-out machine, operation ID/epoch CAS, busy active lease, 10s status/logout and 5min login deadlines/2s grace, cancel/late-close/recheck, restart pending unresolved, safe duplicate copy, no raw output. Mock child only. Live named command authorization is fail-closed without shipping bypass; ambient unchanged.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/auth-providers') -Hosts $H`
- Report: T/implementation-report-batch-06.md.

## Batch 7: Lazy registry/action DI and public package exports — COMPLETE (Codex; P1-A accepted, see D14)

- Recommended executor: CLI lane, backend DI/wiring; sequential; actual family unassigned.
- Depends on: 1–6. Phase P1-A last batch; **STOP for combined code-logic + public-API style review of Batches 1–7**.
- Task 7.1 — PENDING. Own exactly:
  - MODIFY W/libs/backend/auth-providers/src/lib/di/register.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/di/register.spec.ts
  - MODIFY W/libs/backend/auth-providers/src/index.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/accounts/provider-account.service.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/accounts/provider-account.store.spec.ts
- Plan 137/140/238; pattern existing token-based registration. Register real account implementation/actions behind token, lazily resolve persistence because Electron registers auth before DB. Disposal owns processes/reservations with no automatic uncertain release. Exports contain only intended API, not secrets.
- Acceptance: resolve after phased startup, no eager DB read on register, fake DB busy safely refused, supported service surfaces executable through injected doubles, disposal retains uncertain lease. No SDK→concrete auth cycle. Review risks: alias/CAS/auth exclusion/release boundary/public authority.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/auth-providers') -Hosts $H`
- Report: T/implementation-report-batch-07.md. Review artifact: T/code-logic-review-phase-p1-a.md; style T/code-style-review-phase-p1-a.md. Review full new-file snapshots and cumulative owned diff from base, not git commit ranges.

## Batch 8: Final child-env route application in SDK constructors — COMPLETE (Codex; CI gate per D8a; phase review at 11)

- Recommended executor: CLI lane, SDK env isolation; sequential; actual family unassigned.
- Depends on: accepting P1-A review. Phase P1-B Execution primitives; review at 11.
- Task 8.1 — PENDING. Own exactly:
  - CREATE W/libs/backend/agent-sdk/src/lib/helpers/claude-account-route-env.ts
  - CREATE W/libs/backend/agent-sdk/src/lib/helpers/claude-account-route-env.spec.ts
  - MODIFY W/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts
  - MODIFY W/libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts
  - MODIFY W/libs/backend/agent-sdk/src/lib/helpers/index.ts
  - MODIFY W/libs/backend/agent-sdk/src/index.ts
- Plan 163/168–170. Implement pure named-only helper, apply AFTER completed main env at 1331–1346 and one-shot env at 600–615. Clone env, set selected CLAUDE_CONFIG_DIR then clear enumerated certified conflicting selectors; never change HOME/USERPROFILE/XDG/process.env/AuthEnv. Root export existing runner/helper deliberately, no cross-lib deep import.
- Acceptance: polluted base env cannot override named route; ambient/omitted main+one-shot byte-equivalent including preconfigured dir. Safe native allowlist remains untouched. No one-shot autoapproval substitute. Helper input only admission route, no arbitrary deletion/env options.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/agent-sdk') -Hosts $H`
- Report: T/implementation-report-batch-08.md.

## Batch 9: Shared real native lane option/permission/handle extraction — COMPLETE (Codex; CI gate per D8a; phase review at 11)

- Recommended executor: CLI lane, capable SDK lifecycle refactor; sequential; actual family unassigned.
- Depends on: 8. Phase P1-B; review at 11.
- Task 9.1 — PENDING. Own exactly:
  - CREATE W/libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts
  - CREATE W/libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.spec.ts
  - CREATE W/libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-options.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts
- Plan 164–172; pattern registry 807–1008/1345–1400. Extract complete native option builder, exact permission mapping and existing stream/handle loop into callable runtime-local seams; registry USES them now, not a dead new runner. `runInteractive` remains prompt/options forwarding only. Apply named env after buildSafeEnv, no later overwrite. Keep seeded native mailbox unchanged.
- Acceptance: native options parity (MCP/hooks/role/cwd/output-style/strict policy/settings/extraArgs/replay/persistence/executable/stderr); YOLO only explicit existing mapping, others canUseTool bridge; per-turn settlement once, queued continuation, replay/setAgentId, abort cleanup. Supports continuation true, steer/interrupt false, Ptah MCP preserved. No fake PtahCliConfig.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/cli-agent-runtime') -Hosts $H`
- Report: T/implementation-report-batch-09.md.

## Batch 10: Empty-until-commit prompt primitive — COMPLETE (Codex; CI gate per D8a; phase review at 11)

- Recommended executor: CLI lane, async iterator/concurrency testing; sequential; actual family unassigned.
- Depends on: 8. Phase P1-B; review at 11.
- Task 10.1 — PENDING. Own exactly:
  - CREATE W/libs/backend/agent-sdk/src/lib/helpers/named-account-prompt-gate.ts
  - CREATE W/libs/backend/agent-sdk/src/lib/helpers/named-account-prompt-gate.spec.ts
  - MODIFY W/libs/backend/agent-sdk/src/lib/helpers/index.ts
  - MODIFY W/libs/backend/agent-sdk/src/index.ts
- Plan 185–188. Functional caller-owned AsyncIterable starts empty; explicit admission commit releases held input, early next waits, reject/close drops rather than drains and wakes readers. Follow-up pushes require fresh approval. API models one admission/lifecycle clearly, no runtime bypass.
- Acceptance: zero yielded content before commit, close/abort before/after wait, late commit refused, queued content dropped, no hung waiter/double settlement; native createPromptMailbox untouched. Wiring into runtime occurs in 17/20, not a placeholder implementation here.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/agent-sdk') -Hosts $H`
- Report: T/implementation-report-batch-10.md.

## Batch 11: Constructible Claude adapter and runtime runner registration — IMPLEMENTED (Codex; awaiting P1-B phase review)

- Recommended executor: CLI lane, adapter/DI SDK capability; sequential; actual family unassigned.
- Depends on: 9–10. Phase P1-B last; **STOP for code-logic + style review Batches 8–11**.
- Task 11.1 — PENDING. Own exactly:
  - CREATE W/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts
  - CREATE W/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.spec.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/di/register.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/di/register.ptah-cli-registry.smoke.spec.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts
- Plan 160–177. Real adapter uses extracted options/execution with empty native auth, actual session/agent/role/capability policy, resolved model/effort. Constructibility-only detector reuses executable/query loader; no status or inference on list. Service registration creates real runner. System detection roster not activated until 26; adapter can be directly unit-tested now.
- Acceptance: missing binary/SDK isolated detection result; real handle capabilities, supported model/effort and precedence, unsupported not applied, modelTier ignored; native path still green. Authenticated named routes require admission, not optional caller env. Review extraction permissions/cleanup/env and no alternative protocol.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/cli-agent-runtime') -Hosts $H`
- Report: T/implementation-report-batch-11.md. Reviews T/code-logic-review-phase-p1-b.md and T/code-style-review-phase-p1-b.md.

## Batch 12: Bound Claude transcript/history/import/stats roots — IMPLEMENTED (Codex; D16 reduced import scope; review at 15)

- Recommended executor: CLI lane, account-scoped filesystem readers; sequential; actual family unassigned.
- Depends on: P1-B review. Phase P1-C Resources; review at 15.
- Task 12.1 — PENDING. Own exactly:
  - MODIFY W/libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts
  - MODIFY W/libs/backend/agent-sdk/src/lib/session-importer.service.ts
  - MODIFY W/libs/backend/agent-sdk/src/lib/session-stats/session-stats-reader.service.ts
  - CREATE W/libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.account-context.spec.ts
- Plan 204–206/213–214. Explicit resource context selects `<config>/projects`, workspace+route cache, bound import source. Omitted reader retains its own current ambient algorithm. Imported binding is persisted linkage, never current selection inference.
- Acceptance: two roots same workspace, symlink/root dedup/caps, no named→ambient fallback, account-correct rewind/stats/import, distinct routes sharing owner do not merge transcripts; dispose caches/listeners. Missing requested root gives explicit unavailable result.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/agent-sdk') -Hosts $H`
- Report: T/implementation-report-batch-12.md.

## Batch 13: Selected output styles and truthful imported user-state support — IMPLEMENTED (Codex; review at 15)

- Recommended executor: CLI lane, resource context/policy; sequential; actual family unassigned.
- Depends on: 12. Phase P1-C; review at 15.
- Task 13.1 — PENDING. Own exactly:
  - MODIFY W/libs/backend/output-styles/src/lib/output-style-discovery.service.ts
  - MODIFY W/libs/backend/output-styles/src/lib/output-style-file.writer.ts
  - MODIFY W/libs/backend/output-styles/src/lib/output-style-session-activation.service.ts
  - CREATE W/libs/backend/output-styles/src/lib/output-style-account-context.spec.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/mcp-directory/claude-user-mcp.reader.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/capabilities/claude-approval.reader.ts
- Plan 207–208; pattern existing exact activation lifecycle file. Account context passed to discovery/activation/writer; workspace styles unchanged. Selected user MCP/approval source needs verified locator; no fake HOME/.claude.json or ambient approval inheritance. Explicit Ptah MCP remains usable.
- Acceptance: selected writes/readback use same root, project assets remain workspace-owned, requested unavailable imported resource returns unsupported, no ambient file written for named context, no credential/plugin copying. Cover MCP/approval cases in runner integration suite Batch 22 as well as scoped existing tests.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/output-styles','@ptah-extension/cli-agent-runtime') -Hosts $H`
- Report: T/implementation-report-batch-13.md.

## Batch 14: Account-scoped model and quota control probes — IMPLEMENTED (Codex; D17 +session-registry; review at 15)

- Recommended executor: CLI lane, SDK control calls/cache disposal; sequential; actual family unassigned.
- Depends on: 8/12/13. Phase P1-C; review at 15.
- Task 14.1 — PENDING. Own exactly:
  - MODIFY W/libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts
  - MODIFY W/libs/backend/agent-sdk/src/lib/helpers/plan-limits/session-quota-probe.service.ts
  - CREATE W/libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.accounts.spec.ts
  - CREATE W/libs/backend/agent-sdk/src/lib/helpers/plan-limits/session-quota-probe.accounts.spec.ts
- Plan 169/173–174/209–211. Completed probe env passes same helper, route/version/provider/epoch model key, single-flight/refcount disposal. Matching query accountInfo/usage, never latest unrelated query, API credential fallback or shared native model cache.
- Acceptance: two accounts, empty/unknown supportedModels, old epoch late result discarded, no-open-session/service-unavailable, bounded empty-prompt calls disposed on timeout, foreign auth scrubbed, no detection inference. Installed A1–A3 still held.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/agent-sdk') -Hosts $H`
- Report: T/implementation-report-batch-14.md.

## Batch 15: Owner-correct Claude plan cache and source handles — IMPLEMENTED (Codex; awaiting P1-C phase review)

- Recommended executor: CLI lane, identity/usage correctness; sequential; actual family unassigned.
- Depends on: 14. Phase P1-C last; **STOP code-logic review Batches 12–15**, style for changed exported resource/owner interfaces.
- Task 15.1 — PENDING. Own exactly:
  - MODIFY W/libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/quota/readers/plan-usage-reader.types.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/quota/readers/claude-plan-usage.reader.ts
  - CREATE W/libs/backend/auth-providers/src/lib/quota/provider-owner.accounts.spec.ts
  - CREATE W/libs/backend/auth-providers/src/lib/quota/plan-usage.accounts.spec.ts
- Plan 209–214; pattern trimmed email+organization hash, owner-scoped cache. PlanOwnerTarget internal route/source handle points to matching query; public summary no raw identity. Codex singleton owner behavior unchanged in Phase 1.
- Acceptance: same identity/two dirs one owner, changed email/org separate, unknown route/run-specific without last-known promotion, ambient retained, stale same-owner policy only, late epoch/source mismatch discarded, no-open-query unavailable, disposal/capacity. Review all account-resource fallback edges and persisted style writes.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/auth-providers') -Hosts $H`
- Report T/implementation-report-batch-15.md. Reviews T/code-logic-review-phase-p1-c.md and T/code-style-review-phase-p1-c.md.

## Batch 16: Authoritative durable binding and session metadata linkage — IMPLEMENTED (D20: part A 91b86e380, 16b-A ea27188eb, 16b-B 738ae99ef)

- D20 split: part A = metadata linkage + run-binding commit/read; 16b-A = migration 0059 `provider_account_session_links`; 16b-B = `attachSdkSession` / `lookupBySdkSession`. Two-store admission coordination and the importer change (implementation-report-batch-16.md § Exact importer handoff) move to Batch 17. Batch 12 named-import refusal stays until then.

- Recommended executor: CLI lane, transactional admission/persistence; sequential; actual family unassigned.
- Depends on: P1-C review. Phase P1-D Admission; review at 22.
- Task 16.1 — PENDING. Own exactly:
  - MODIFY W/libs/backend/auth-providers/src/lib/accounts/provider-account.service.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts
  - MODIFY W/libs/backend/agent-sdk/src/lib/session-metadata-store.ts
  - CREATE W/libs/backend/agent-sdk/src/lib/session-metadata-store.account-binding.spec.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/accounts/provider-account.store.spec.ts
- Plan 184–192/195. Registry authoritative binding commit and real SDK session attachment; metadata detail/parser/projection validated immutable linkage. Expose awaitable write/read, not fire-and-forget completion persistence. Resolve server binding before legacy classification; unavailable lookup refuses.
- Acceptance (D16 addition): persisted import linkage per route; the same SDK sessionId from two routes neither merges nor is skipped silently; Batch 12 named-import refusal is lifted only by this linkage.
- Acceptance: both writes succeed before admission result; either failure produces no prompt, no unbound resumable record; unknown baseline persists and cannot resume; old absent records remain ambient; malformed present record refuses. No directory leaks in references.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/auth-providers','@ptah-extension/agent-sdk') -Hosts $H`
- Report T/implementation-report-batch-16.md.

## Batch 17: SDK named bootstrap and final-query admission — PENDING

- Recommended executor: CLI lane, high-capability SDK lifecycle/concurrency; sequential; actual family unassigned.
- Depends on: 10/14/16. Phase P1-D; review at 22.
- Task 17.1 — PENDING. Own exactly:
  - MODIFY W/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts
  - MODIFY W/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts
  - MODIFY W/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts
  - MODIFY W/libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts
  - CREATE W/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts
- Plan 184–188/192–196. Empty, fixed control-only query has no conversation/system-role/history/transcript/attachments/name/resume/fork data. Verify bootstrap identity, fully close it, then final policy query with OWN empty gate; own accountInfo compares bootstrap/stored baseline; await registry AND session linkage before commit. Runner remains launch funnel, not universal policy assembly.
- Acceptance: strict call order/zero yielded messages on every failure; final usable fresh unknown permitted only with authenticated certified route and persisted unknown; known mismatch never downgraded; resume unknown refused before conversation options; timeout/cancel closes gate before query, deny permission waits, settle once, await child termination before lease release. If child close unproved retain reservation. Ambient has no new control call/gate.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/agent-sdk') -Hosts $H`
- Report T/implementation-report-batch-17.md.

## Batch 18: Central main-session fresh/resume/slash routing — PENDING

- Recommended executor: CLI lane, main orchestration/account lifecycle; sequential; actual family unassigned.
- Depends on: 12–17. Phase P1-D; review at 22.
- Task 18.1 — PENDING. Own exactly:
  - MODIFY W/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts
  - MODIFY W/libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts
  - CREATE W/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.account-binding.spec.ts
- Plan 183/190–197 and current central start/resume/child funnel. Resolve selection/admission before account-sensitive model/output-style/MCP. Named choice applies only to compatible native provider, never overwrites intentional API-key route. Explicit ambient bypasses selection; old truly unbound session ignores new defaults. Authenticated continuation uses original binding.
- Acceptance: new main selection vs lane independent, rename/default unchanged, remove/retarget/signed-out/different or unknown identity refuse, auto/explicit/slash resume and rewind/fork/fresh-context handoff gated before cost/context; authoritative lookup beats CLI index lacking profile. Preserve conversation on refusal, no recovery chooser/fallback.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/rpc-handlers') -Hosts $H`
- Report T/implementation-report-batch-18.md. If actual slash router lives elsewhere, stop to normalize that single ownership path before editing; do not invent a replacement service.

## Batch 19: Lane persisted references and resume classification — PENDING

- Recommended executor: CLI lane, lane lifecycle persistence; sequential; actual family unassigned.
- Depends on: 16–18. Phase P1-D; review at 22.
- Task 19.1 — PENDING. Own exactly:
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-resume-gate.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts
  - CREATE W/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.account-binding.spec.ts
- Plan 189–197/198. Carry immutable binding into run options, handle/reference restore and SDK ID linkage including parentless lanes. Account gate precedes existing cost/resume gate. Completion events remain output persistence, never admission correctness.
- Acceptance: restored/idle-release/explicit session resume use registry linkage, no parent needed; corrupt vs absent, changed defaults/labels, unavailable registry, deleted route. Old late completion cannot kill replacement; no named failure retries ambient. Original cap/other lane behavior unchanged.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/cli-agent-runtime') -Hosts $H`
- Report T/implementation-report-batch-19.md.

## Batch 20: Named Claude lane gated dispatch and queued-turn validation — PENDING

- Recommended executor: CLI lane, async SDK lane admission; sequential; actual family unassigned.
- Depends on: 17/19. Phase P1-D; review at 22.
- Task 20.1 — PENDING. Own exactly:
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-options.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.spec.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.spec.ts
- Plan 164–175/184–194. Named system adapter uses same two-query admission sequence and durable linkage, typed route, new empty gate; configured native registry retains original seeded mailbox and ambient behavior. Do not duplicate control protocol/transformer.
- Acceptance: no task-derived options before bootstrap approval, no first prompt before both writes/final accountInfo, no post-auth-change queued message; close/drop/settle once/deny permissions/dispose, uncertain child retains lease. Rename unaffected; deleted bound metadata blocks subsequent turns while already-running immutable snapshot remains. Continuation only, not steer/interrupt.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/cli-agent-runtime') -Hosts $H`
- Report T/implementation-report-batch-20.md.

## Batch 21: Separate child-chat binding inheritance — PENDING

- Recommended executor: CLI lane, child-session orchestration; sequential; actual family unassigned.
- Depends on: 18–20. Phase P1-D; review at 22.
- Task 21.1 — PENDING. Own exactly:
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.port.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts
  - CREATE W/libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.accounts.spec.ts
  - MODIFY W/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts
  - MODIFY W/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.account-binding.spec.ts
- Plan 103/193/195/198. Compatible child inherits parent's explicit binding; SDK subagent remains same query route. Incompatible provider uses existing resolution, not forged Claude binding. Default changes do not capture bound descendants.
- Acceptance: parent-selected A/default switched B still child A; deleted/unknown/changed parent binding refuses before content; child teardown lease isolation; non-account providers/default child unaffected.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/cli-agent-runtime','@ptah-extension/rpc-handlers') -Hosts $H`
- Report T/implementation-report-batch-21.md.

## Batch 22: Claude pre-prompt and resume acceptance matrix — PENDING

- Recommended executor: CLI lane, adversarial contract tests; sequential; actual family unassigned.
- Depends on: 17–21. Phase P1-D last; **STOP combined code-logic review Batches 16–22**.
- Task 22.1 — PENDING. Own exactly (tests only):
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.account-binding.spec.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.spec.ts
  - MODIFY W/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts
  - MODIFY W/libs/backend/agent-sdk/src/lib/helpers/claude-account-route-env.spec.ts
- Plan 197, requirements acceptance 3–5/8/10/17/18. Matrix simultaneous distinct main/lane, ambient three env outcomes, rename/default/remove/retarget/signout/reauth same/different/unknown, malformed legacy, storage failure at each write, own-query vs stale identity, every-await cancellation, parentless restored lane, permission/MCP policy and prompt non-disclosure. A2 mocked evidence explicitly separate from live compatibility.
- Acceptance: tests fail if a prompt yields early, a transcript-bearing bootstrap appears, a later env spread wins, lease releases before child close, or old unknown is relabelled. No production fixes hidden in this test-only ownership; return defect to its bounded owner.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/agent-sdk','@ptah-extension/cli-agent-runtime') -Hosts $H`
- Report T/implementation-report-batch-22.md. Review T/code-logic-review-phase-p1-d.md; review includes new prompt gates, all write paths, internal callers and actual extraction, not merely test counts.

## Batch 23: Lane owner discovery reads the owning route/query — PENDING

- Recommended executor: CLI lane, quota discovery; sequential; actual family unassigned.
- Depends on: accepting P1-D review/15. Phase P1-E Public integration; review at 28.
- Task 23.1 — PENDING. Own exactly:
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-owner.resolver.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-owner-read.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-lane-plan-limits.ts
  - CREATE W/libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-owner-read.accounts.spec.ts
- Plan 209–214. Match immutable source handle/epoch, retain ambient observed owner and correct unknown semantics; no arbitrary newest native query. Existing configured native lane accounting remains.
- Acceptance: known same-owner dedup, distinct/unknown separation, no matching query unavailable, stale response disposal, failed read never known-cache promotion. No inference to discover limits.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/cli-agent-runtime') -Hosts $H`
- Report T/implementation-report-batch-23.md.

## Batch 24: Historical Claude ledger identity and preparatory CLI display maps — PENDING

- Recommended executor: CLI lane, usage and typed display compatibility; sequential; actual family unassigned.
- Depends on: 12/23. Phase P1-E; review at 28.
- Task 24.1 — PENDING. Own exactly:
  - MODIFY W/libs/backend/usage-analytics/src/lib/sources/claude-ledger.source.ts
  - CREATE W/libs/backend/usage-analytics/src/lib/sources/claude-ledger.accounts.spec.ts
  - MODIFY W/libs/frontend/chat/src/lib/services/session-stats/session-stats-source.ts
  - MODIFY W/libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-rows.ts
- Plan 206/209/214/264–268. Ledger roots and event keys include route+session/event; preserve event-time owners, no retroactive unknown merge. Prepare meaningful Claude display/config/account row definitions before tuple activation with explicit forward-key typing and no fake detected installation; other rows unchanged.
- Acceptance: duplicate discovery once per physical route, two dirs same owner aggregate quota not transcripts, ambient retained, source map old members exhaustive and ready for real Claude row, model/effort/account distinct.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/usage-analytics','@ptah-extension/chat') -Hosts $H`
- Report T/implementation-report-batch-24.md.

## Batch 25: Shared account RPC and configuration contracts — PENDING

- Recommended executor: CLI lane, public RPC schema/API; sequential; actual family unassigned.
- Depends on: 1/3/23. Phase P1-E; review at 28.
- Task 25.1 — PENDING. Own exactly:
  - CREATE W/libs/shared/src/lib/types/rpc/rpc-provider-accounts.types.ts
  - MODIFY W/libs/shared/src/lib/types/rpc.types.ts
  - MODIFY W/libs/shared/src/lib/types/rpc/rpc-agents.types.ts
  - MODIFY W/libs/shared/src/lib/types/rpc/rpc-auth.types.ts
  - MODIFY W/libs/shared/src/index.ts
  - CREATE W/libs/shared/src/lib/types/rpc/rpc-provider-accounts.spec.ts
- Plan 235–237/264–268. Strict provider-prefixed list/add/rename/remove/status/startSignIn/cancelSignIn/signOut/setSelection/setDefault contracts, snapshot notifications, expected revision/request/operation IDs, optional account selection in spawn. Add claudeModel/claudeReasoningEffort get/set keys. Manifest/registry declarations resident in these files wired consistently, no unused API declarations.
- Acceptance: old callers unchanged; public account input only ID/sentinel/provider/scope/workspace, no route/env/owner/binding authority. Resume conflicting account invalid. Config roundtrip and unsupported values truthful. No account UI capability implied on other hosts.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/shared') -Hosts $H`
- Report T/implementation-report-batch-25.md. If actual shared method-manifest/registry is a separate source, stop and supply its exact path for a bounded ownership adjustment; do not omit registry coverage or exceed six files.

## Batch 26: Activate real system Claude roster with typed runtime policy — PENDING

- Recommended executor: CLI lane, tuple/detection/policy integration; sequential; actual family unassigned.
- Depends on: 11/20/24/25 and prepared exhaustive display consumers in 30 (execute 30 preparation before activating this batch). Phase P1-E; review at 28.
- Task 26.1 — PENDING. Own exactly:
  - MODIFY W/libs/shared/src/lib/types/agent-process.types.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.service.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-spawn-policy.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.account-binding.spec.ts
- Plan 160/171/259–268. Add `claude` to SYSTEM_CLI_TYPES once consumers prepared; register actual adapter beside existing seven, map configured model/effort/policy preserving defaults/preferred order/disabled set/cap1..100. Exact policy file path must match existing source before dispatch; ownership adjustment only, not newly guessed subsystem.
- Acceptance: previous seven still installed/detected/spawned as before; missing Claude SDK isolated; signed-out does not mean uninstalled; cap/preference/unknown ID tests; native route safe env; no named live query despite release hold.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/shared','@ptah-extension/cli-agent-runtime') -Hosts $H`
- Report T/implementation-report-batch-26.md. All tuple-dependent hosts must pass at this activation boundary; no temporarily broken exhaustive compilation accepted.

## Batch 27: Account RPC handlers, host capability and registration — PENDING

- Recommended executor: CLI lane, RPC authorization/DI; sequential; actual family unassigned.
- Depends on: 7/25/26. Phase P1-E; review at 28.
- Task 27.1 — PENDING. Own exactly:
  - CREATE W/libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts
  - CREATE W/libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.schema.ts
  - MODIFY W/libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts
  - MODIFY W/libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts
  - MODIFY W/libs/backend/rpc-handlers/src/lib/host-profile/host-profile.ts
  - MODIFY W/apps/ptah-electron/src/rpc-host-profile.ts
- Plan 230–241. Service-domain safe codes translated at RPC layer, no vscode-core import into neutral account services. Workspace/provider authority and Electron-only account-management capability; capabilities absent false elsewhere. Revision snapshot and broadcast via existing host infrastructure after commit only; exact partition/manifest registration, shutdown disposal.
- Acceptance: fake account service all actions, invalid params zero side effects, wrong host/workspace/provider denied, idempotent Add/action, stale revision, safe redaction, one event/revision, no live launch. If a separate allowlist/manifest implementation must change, return exact path and schedule bounded follow-up before endpoint is accepted; no silently registered-but-inaccessible method.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/rpc-handlers','ptah-electron') -Hosts $H`
- Report T/implementation-report-batch-27.md.

## Batch 28: Agent RPC/MCP account argument and namespace parity — PENDING

- Recommended executor: CLI lane, public spawn wiring; sequential; actual family unassigned.
- Depends on: 25–27. Phase P1-E last; **STOP code-logic + style review Batches 23–28 and preparation Batch 30**.
- Task 28.1 — PENDING. Own exactly:
  - MODIFY W/libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.schema.ts
  - MODIFY W/libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts
  - MODIFY W/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-args.schema.ts
  - MODIFY W/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts
  - MODIFY W/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts
  - MODIFY W/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts
- Plan 235–241/263–268. Carry optional account selection without serialization loss, reject incompatible or conflicting resume selection before spawn. Enum derived from tuple; descriptions truthful about SDK continuation/MCP and modelTier Ptah-only. Agent RPC config mappings include Claude keys.
- Acceptance: existing relevant project suites plus Batch 34 focused public drift tests must prove namespace/stdio serialization. No hand-copied eight-vendor list, no path/env API, account-management capability not needed for preserved ambient run. Review public authority and quota changes.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/rpc-handlers','@ptah-extension/vscode-lm-tools') -Hosts $H`
- Report T/implementation-report-batch-28.md. Reviews T/code-logic-review-phase-p1-e.md and T/code-style-review-phase-p1-e.md.

## Batch 29: Authoritative frontend account state and notification owner — PENDING

- Recommended executor: CLI lane, Angular state/RPC; sequential; actual family unassigned.
- Depends on: accepting P1-E review. Phase P1-F Electron surface; review at 35.
- Task 29.1 — PENDING. Own exactly:
  - CREATE W/libs/frontend/core/src/lib/services/provider-accounts-state.service.ts
  - CREATE W/libs/frontend/core/src/lib/services/provider-accounts-state.service.spec.ts
  - MODIFY W/libs/frontend/core/src/index.ts
  - MODIFY W/libs/frontend/core/src/lib/services/providers-settings-state.service.ts
  - MODIFY W/libs/frontend/core/src/lib/services/providers-settings.types.ts
- Plan 244–257/264; pattern existing Providers pending/saved/unconfirmed state. One state owner over ClaudeRpcService and multi-provider MESSAGE_HANDLERS; real notification registration must be attached through current exported provider mechanism, not just declared. Snapshot revisions ignore old events; reconnect re-fetch, timeout unconfirmed re-read. Config state includes Claude model/effort.
- Acceptance: mocked full account actions, no optimistic signed-in, independent main/lane/default atomic snapshot, duplicate/out-of-order responses, disconnected/retry, selection clears only committed result, listener disposal. If existing MESSAGE_HANDLERS registration lives in another file, identify and replace one nonessential owned config file with exact registration path before dispatch; do not ship unwired state.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/core') -Hosts $H`
- Report T/implementation-report-batch-29.md.

## Batch 30: Prepare exhaustive avatar/discovery maps before tuple activation — PENDING

- Recommended executor: CLI lane, minimal typed UI compatibility; sequential; actual family unassigned.
- Depends on: 3/11. **Execution position: after 25, before 26, despite numeric label.** Phase P1-E; reviewed at 28.
- Task 30.1 — PENDING. Own exactly:
  - MODIFY W/libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.ts
  - MODIFY W/libs/frontend/chat-ui/src/lib/atoms/agent-avatar/agent-marks.ts
- Plan 263/268. Prepare real Claude label/mark using existing assets, preserving existing exhaustive members and old native provider distinctions. Use explicit future-key typing while tuple remains seven; remove misleading orchestrator-only comment deliberately. No detection results fabricated and no new UI surface here.
- Acceptance: both projects compile before AND after real tuple activation; previous marks/discovery preserved, no replacement of native provider identity. Existing suites pass.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/tasks-ui','@ptah-extension/chat-ui') -Hosts $H`
- Report T/implementation-report-batch-30.md. This dependency is intentional and must be honored by orchestrator, not treated as a cycle.

## Batch 31: Controlled account chooser and label-only Add modal — PENDING

- Recommended executor: CLI lane, Angular controlled components; UI fallback reason as defined above; sequential; actual family unassigned.
- Depends on: 29. Phase P1-F; review at 35.
- Task 31.1 — PENDING. Own exactly:
  - CREATE W/libs/frontend/chat/src/lib/settings/providers/accounts/account-chooser.component.ts
  - CREATE W/libs/frontend/chat/src/lib/settings/providers/accounts/add-account-dialog.component.ts
  - CREATE W/libs/frontend/chat/src/lib/settings/providers/accounts/account-chooser.component.spec.ts
  - CREATE W/libs/frontend/chat/src/lib/settings/providers/accounts/add-account-dialog.component.spec.ts
- Plan 250–256, design 3.1/3.2/3.6. Inputs authoritative profiles/scope; emit ambient/ID or bounded label intent. Reuse project modal patterns, label only, no path chooser/login/process/RPC in rows. Empty chooser ambient only plus exact no-accounts text.
- Acceptance: cancel/success focus returns, keyboard/escape, no implicit selection after Add, main vs lane scoped intent, duplicate safe copy, pending/error announcements. Angular mocks only; no production mock-outcome selector. Anubis dark/light tokens and exact design copy.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/chat') -Hosts $H`
- Report T/implementation-report-batch-31.md.

## Batch 32: Native account details drawer and complete access actions — PENDING

- Recommended executor: CLI lane, Angular accessibility/state integration; sequential; actual family unassigned.
- Depends on: 29/31. Phase P1-F; review at 35.
- Task 32.1 — PENDING. Own exactly:
  - CREATE W/libs/frontend/chat/src/lib/settings/providers/accounts/account-details-drawer.component.ts
  - CREATE W/libs/frontend/chat/src/lib/settings/providers/accounts/account-details-drawer.component.spec.ts
- Plan 251–255, design 3.4–3.6. NativeDrawerComponent, accessible name Account details for [label], Overview/Access/Profile tabs, existing focus trap/Escape/backdrop/reduced-motion. Emit status/login/cancel/logout/rename/default/remove; do not hide actions due to release hold, explain safe held outcome.
- Acceptance: every signed-in/out/pending/cancelled/failed/disconnected/release-held/busy state, pending Cancel only, hidden panel excluded from focus, opener restored, no path/email/org/token. Exact default toast and metadata-only removal confirmation, unavailable resume no recovery chooser. Drawer close does not implicitly cancel sign-in.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/chat') -Hosts $H`
- Report T/implementation-report-batch-32.md.

## Batch 33: Electron Accounts composition and future main/lane controls — PENDING

- Recommended executor: CLI lane, Angular UI integration; sequential; actual family unassigned.
- Depends on: 31/32. Phase P1-F; review at 35.
- Task 33.1 — PENDING. Own exactly:
  - CREATE W/libs/frontend/chat/src/lib/settings/providers/accounts/accounts-section.component.ts
  - CREATE W/libs/frontend/chat/src/lib/settings/providers/accounts/accounts-section.component.spec.ts
  - MODIFY W/libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts
  - MODIFY W/libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-rows.ts
  - MODIFY W/libs/frontend/core/src/lib/services/provider-accounts-state.service.ts
  - MODIFY W/libs/frontend/core/src/lib/services/provider-accounts-state.service.spec.ts
- Plan 249–257/264. Accounts after Connections before catalog; preserve main routing map/cards/setup wizard. Guard isElectron AND host capability. Real state owner; independent next-main/Claude-lane selectors, actual Claude system spawn/config account control, model/effort semantic fields. Scoped selection does not hijack deliberately chosen API provider or in-flight run.
- Acceptance: mocked Add/status/sign-in/cancel/sign-out/rename/remove/default and main/lane choices through state seam, empty/error/retry/stale, active count only positive, nested Manage stops card click. Responsive >=960,640–959,<640/embedded400, semantic tokens/light neutral focus and toast foreground. No horizontal overflow source tests; rendered proof still held. If actual launch control is outside matrix, identify exact source and split wiring into bounded follow-up before acceptance, not a decorative unused account field.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/chat','@ptah-extension/core') -Hosts $H`
- Report T/implementation-report-batch-33.md.

## Batch 34: Public CLI selection/serialization and schema drift tests — PENDING

- Recommended executor: CLI lane, CLI/MCP contract tests; sequential; actual family unassigned.
- Depends on: 26/28/33. Phase P1-F; review at 35.
- Task 34.1 — PENDING. Own exactly:
  - MODIFY W/apps/ptah-cli/src/cli/commands/agent-cli.ts
  - MODIFY W/apps/ptah-cli/src/cli/commands/agent-cli.spec.ts
  - MODIFY W/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.spec.ts
  - MODIFY W/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.spec.ts
  - CREATE W/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-accounts.spec.ts
- Plan 265–268, inventory system CLI rows. CLI selector from tuple plus ptah-cli, optional account sentinel/ID serialized through dispatcher/namespaces. Local CLI session index lacks profile field; do not infer ambient from it or add authoritative client binding.
- Acceptance: original seven plus claude, ptah-cli separate, old callers, ptahCliId precedence, modelTier unchanged, explicit effort precedence/unsupported truthful, resume conflicting account refusal, list/message capabilities match handle, dispatch forwards optional account. No live CLI execution.
- Command: `Verify-ProviderAccountsBatch -Projects @('ptah-cli','@ptah-extension/vscode-lm-tools') -Hosts $H`
- Report T/implementation-report-batch-34.md.

## Batch 35: Host DI/RPC surface and Claude exit evidence checkpoint — PENDING

- Recommended executor: CLI lane, scoped host smoke tests; sequential; actual family unassigned.
- Depends on: 29/31–34. Phase P1-F last; **STOP code-logic + style review Batches 29/31–35; visual gate HELD**.
- Task 35.1 — PENDING. Own exactly:
  - MODIFY W/apps/ptah-extension-vscode/src/di/expected-resolvable.ts
  - MODIFY W/libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.spec.ts
  - MODIFY W/libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.activation.spec.ts
  - MODIFY W/libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts
  - CREATE W/libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.spec.ts
- Plan 238–241/323–325. The new handler suite proves all account actions, capability/workspace refusal, CAS/idempotency, sanitized snapshots and notification ordering; Batch 27 must also extend its existing registered-handler test coverage before its own checkpoint. Expected-resolvable account token after existing shared registrations, exact method registry/manifest/allowlist partition, Electron capability true/non-Electron false, unchanged ambient native provider and existing lanes. Minimal host compatibility only; no VS Code feature or polish.
- Acceptance: host smoke and public registry exactness, package/exports/DI no eager DB, every applicable Claude requirement and inventory row mapped to a passing test/checkpoint. Cross-check OLD surface at base 0fc0c3a09 against inventory before verifying every keep/move row; an omitted capability is a blocker, not assumed removed. Trace each persisted selection/write as specified below. No mock success claims for installed runtime or screenshots.
- Command: `Verify-ProviderAccountsBatch -Projects @('ptah-extension-vscode','@ptah-extension/rpc-handlers') -Hosts $H`
- Report T/implementation-report-batch-35.md. Reviews T/code-logic-review-phase-p1-f.md and T/code-style-review-phase-p1-f.md. Later visual-reviewer artifact T/visual-review.md requires separately authorized Electron launch; it must include dark/light keyboard/focus, >=960,640–959,<640 and embedded400 screenshots/contrast compared with T/prototype/index.html.

## Claude exit gate — NOT SATISFIED / Codex dispatch held

Batches 36–43 are defined, not authorized to start by their existence. Before Phase 2, orchestrator must have accepting P1 reviews, scoped checks and capability-by-capability evidence for all non-Codex Phase 1 acceptance. A1–A3 installed compatibility, rendered Electron evidence, and user-reserved subscription enablement/release remain open. Technical mock proof does not waive these. Do not imply visual evidence or user authorization from Gate 1/1.7/2. If holds prevent full Phase 1 acceptance, stop Phase 2 dispatch and report remaining holds; do not rewrite requirement phase ordering or silently remove actions. Existing ambient behavior stays available; live named auth-command/query launch stays held. A later authorized compatibility/visual session must not run implicitly as a batch check.

## Batch 36: Codex official account commands and store admission — MOVED to TASK_2026_715_6cba (re-plan on Codex App Server)

- Recommended executor: CLI lane, Codex auth/store backend; sequential; actual family unassigned.
- Depends on: **satisfied Claude exit gate**, 6/7. Phase P2-A Codex services; review at 39.
- Task 36.1 — PENDING. Own exactly:
  - CREATE W/libs/backend/auth-providers/src/lib/accounts/codex-account-command.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.spec.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/accounts/provider-account-auth-env.spec.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/accounts/provider-account.service.ts
- Plan 152/216–227. Official login/login status/logout with selected CODEX_HOME, same state machine/reservations/release seam. Certify effective file store via supported config; do not rewrite existing user's store. Global store guard includes ambient/unknown reservations; unproved keyring/auto/ephemeral second concurrent account refused, not assumed globally shared or isolated.
- Acceptance: two-home mocked commands, wrong/unknown store, ambient collision, cancel/status-after-cancel/busy and redaction. A4 fixtures not installed evidence. No live credential commands.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/auth-providers') -Hosts $H`
- Report T/implementation-report-batch-36.md.

## Batch 37: Per-home Codex resolver/auth service pool and refresh serialization — MOVED to TASK_2026_715_6cba (re-plan on Codex App Server)

- Recommended executor: CLI lane, auth lifecycle/pool concurrency; sequential; actual family unassigned.
- Depends on: 36. Phase P2-A; review at 39.
- Task 37.1 — PENDING. Own exactly:
  - MODIFY W/libs/backend/auth-providers/src/lib/providers/codex/codex-home-resolver.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/providers/codex/codex-auth.service.ts
  - CREATE W/libs/backend/auth-providers/src/lib/providers/codex/codex-account-scope-pool.ts
  - CREATE W/libs/backend/auth-providers/src/lib/providers/codex/codex-account-scope-pool.spec.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/providers/codex/codex-provider.types.ts
- Plan 220–223. Optional explicit immutable home context in pool; ambient singleton constructor behavior preserved. Refcount home/epoch handles; one refresh per home, registry reservation, unique-temp atomic rename/re-read generation. No new OAuth protocol/credential copying.
- Acceptance: distinct home auth/token paths, same home refcount, stale refresh after signout/new epoch discarded, watchers/debounce disposed, no host process.env.CODEX_HOME write, unrelated route usable. Test fixtures only.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/auth-providers') -Hosts $H`
- Report T/implementation-report-batch-37.md.

## Batch 38: Codex scoped App Server usage, proxy and registration — MOVED to TASK_2026_715_6cba (re-plan on Codex App Server)

- Recommended executor: CLI lane, Codex transport/pool DI; sequential; actual family unassigned.
- Depends on: 37. Phase P2-A; review at 39.
- Task 38.1 — PENDING. Own exactly:
  - MODIFY W/libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/providers/codex/codex-account.schemas.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/providers/register-providers.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/providers/codex/codex-account-scope-pool.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/providers/codex/codex-account-scope-pool.spec.ts
- Plan 220–228. All App Server children use explicit home and initialize home check; proxy pool key home/account epoch and selected scoped provider route. Ambient registration retained. Raw tokens never in public profile, no matching home means unavailable not fallback.
- Acceptance: mocked two-home transport/proxy simultaneous, initialize mismatch refuses, service/pool disposal, refresh invalidates only same route; no wrong-home cache. Actual account schema recognizes observed email only, no invented stable account ID/org.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/auth-providers') -Hosts $H`
- Report T/implementation-report-batch-38.md.

## Batch 39: Codex verified-identity owner aggregation — MOVED to TASK_2026_715_6cba (re-plan on Codex App Server)

- Recommended executor: CLI lane, owner/cache tests; sequential; actual family unassigned.
- Depends on: 38. Phase P2-A last; **STOP code-logic + style review Batches 36–39**.
- Task 39.1 — PENDING. Own exactly:
  - MODIFY W/libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/quota/provider-owner.accounts.spec.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/quota/plan-usage.accounts.spec.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/providers/codex/codex-account-scope-pool.spec.ts
- Plan 224–227. New known Codex owner hash provider+normalized observed email WITHOUT home. Unknown route-specific; historical home-qualified evidence remains historical, no invented merge/migration. Validate source/epoch before cache response.
- Acceptance: same account two homes one allowance/tile, distinct proven accounts separate, failed read unknown not cached known, ambient observed owner retained, stale async result ignored. Review global store guard, refresh/write/read tracing and source match.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/auth-providers') -Hosts $H`
- Report T/implementation-report-batch-39.md. Reviews T/code-logic-review-phase-p2-a.md and T/code-style-review-phase-p2-a.md.

## Batch 40: Codex lane selected-home catalog/MCP/rollout/spawn/resume — MOVED to TASK_2026_715_6cba (re-plan on Codex App Server)

- Recommended executor: CLI lane, Codex adapter integration; sequential; actual family unassigned.
- Depends on: accepting P2-A review. Phase P2-B Codex integration; review at 43.
- Task 40.1 — PENDING. Own exactly:
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-model-catalog.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-user-mcp-servers.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-rollout-usage.reader.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.spec.ts
- Plan 221–228. Explicit scope reaches getAuthPath/ensureTokensFresh/model probe/cache/trusted MCP, CODEX_HOME child env, thread start/resume and sessionsDir cost reader. Immutable binding and identity preflight before prompt/transcript; existing SDK continuation protocol unchanged.
- Acceptance: two homes no cross token/MCP/catalog/rollout, no global env assignment, resume original profile after default/rename, unknown/deleted/retarget/mismatched store refuses; legacy HOME/.codex/current resolver discrepancies retained where acceptance requires. Other adapters/Claude Phase 1 unchanged.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/cli-agent-runtime') -Hosts $H`
- Report T/implementation-report-batch-40.md.

## Batch 41: Codex main route and historical analytics context — MOVED to TASK_2026_715_6cba (re-plan on Codex App Server)

- Recommended executor: CLI lane, main/analytics integration; sequential; actual family unassigned.
- Depends on: 40. Phase P2-B; review at 43.
- Task 41.1 — PENDING. Own exactly:
  - MODIFY W/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts
  - MODIFY W/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.account-binding.spec.ts
  - MODIFY W/libs/backend/usage-analytics/src/lib/sources/codex.source.ts
  - CREATE W/libs/backend/usage-analytics/src/lib/sources/codex.accounts.spec.ts
- Plan 221–228, main applicability decision 102. Selected Codex scope supplies matched provider/proxy and immutable run context; deliberate non-Codex provider not overridden. Analytics reads bound sessionsDir, route/session event dedup and event-time owner; no rewriting past unattributable evidence.
- Acceptance: two named Codex main/lane routes aligned auth/proxy/usage/spawn/resume, default ambient preservation, strict authoritative continuation, history accounting same-owner/different-home separation of events with quota aggregation. Do not add another provider implementation.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/rpc-handlers','@ptah-extension/usage-analytics') -Hosts $H`
- Report T/implementation-report-batch-41.md.

## Batch 42: Reuse Electron Accounts surface for Codex — MOVED to TASK_2026_715_6cba (re-plan on Codex App Server)

- Recommended executor: CLI lane, Angular provider-parameterized UI; sequential; actual family unassigned.
- Depends on: 36–41. Phase P2-B; review at 43.
- Task 42.1 — PENDING. Own exactly:
  - MODIFY W/libs/frontend/core/src/lib/services/provider-accounts-state.service.ts
  - MODIFY W/libs/frontend/core/src/lib/services/provider-accounts-state.service.spec.ts
  - MODIFY W/libs/frontend/chat/src/lib/settings/providers/accounts/accounts-section.component.ts
  - MODIFY W/libs/frontend/chat/src/lib/settings/providers/accounts/accounts-section.component.spec.ts
  - MODIFY W/libs/frontend/chat/src/lib/settings/providers/accounts/account-details-drawer.component.spec.ts
  - MODIFY W/libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-rows.ts
- Plan 230/249/256, requirements Phase 2. Same provider-parameterized section/actions/chooser, not copied Codex UI. Separate provider/scope selections; unsupported store reason visible without raw config/path. Generic shared contracts already support Codex; no unnecessary second API family.
- Acceptance: add/status/mocked sign-in/cancel/sign-out/default/remove and independent main/lane selections for Codex, no change to Claude fixtures/copy, busy/release-held/unsupported store, dark/light token and keyboard unit cases. No live launch or screenshot implied.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/core','@ptah-extension/chat') -Hosts $H`
- Report T/implementation-report-batch-42.md.

## Batch 43: Final Codex/Claude parity and release-hold regression matrix — MOVED to TASK_2026_715_6cba (re-plan on Codex App Server)

- Recommended executor: CLI lane, adversarial account integration tests; sequential; actual family unassigned.
- Depends on: 40–42. Phase P2-B last; **STOP combined code-logic review Batches 40–43 and Electron visual gate**.
- Task 43.1 — PENDING. Own exactly (tests):
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.spec.ts
  - MODIFY W/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.account-binding.spec.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.spec.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/providers/codex/codex-account-scope-pool.spec.ts
  - MODIFY W/libs/backend/auth-providers/src/lib/quota/plan-usage.accounts.spec.ts
- Plan 227/307/320–325. Cover ambient and named store reservations, same/different/unknown owners, multi-home child env, auth refresh/signout race, failed durable binding/close, default/rename/remove, Claude unchanged, all original lanes/default hosts. Assert release policy cannot be bypassed by public input/test configuration.
- Acceptance: every parity inventory keep/move row rechecked against old base surface then mapped to actual passing tests; no unapproved removal. All dependent-host scoped tests/typechecks and own project lint pass. Final report records hold statuses honestly; a mocked matrix cannot prove A1–A4 or rendered UI.
- Command: `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/cli-agent-runtime','@ptah-extension/auth-providers') -Hosts $H`
- Report T/implementation-report-batch-43.md. Review T/code-logic-review-phase-p2-b.md, style only for any new public API introduced in this phase, and later authorized T/visual-review.md. All changes remain uncommitted.

## Explicit execution order and phase checkpoints

1. P1-A: 1 → 2 → 3 → 4 → 5 → 6 → 7 → independent logic/style acceptance.
2. P1-B: 8 → 9 → 10 → 11 → independent logic/style acceptance.
3. P1-C: 12 → 13 → 14 → 15 → independent logic/style acceptance.
4. P1-D: 16 → 17 → 18 → 19 → 20 → 21 → 22 → independent logic acceptance.
5. P1-E: 23 → 24 → 25 → **30 preparation** → 26 activation → 27 → 28 → independent logic/style acceptance. Numeric Batch 30 is intentionally preparation, not a future dependency cycle.
6. P1-F: 29 → 31 → 32 → 33 → 34 → 35 → independent logic/style acceptance, then held Electron visual/compatibility/authorization gates. Do not dispatch Codex while Claude exit unmet.
7. P2-A (conditional): 36 → 37 → 38 → 39 → independent logic/style acceptance.
8. P2-B (conditional): 40 → 41 → 42 → 43 → independent logic acceptance and applicable style/visual checks. Final QA requires every hold disposition, not just code.

Batch report paths are assigned inputs for eventual verification, not files written in this advisory invocation. Before dispatching any batch whose exact implementation source was directory-qualified in the plan (notably slash/policy, method registries and frontend notification provider), the orchestrator must normalize that existing filename read-only and update only that batch's bounded ownership if needed. This is mechanical file normalization, not permission to omit wiring, expand architecture or leave stubs. At every intermediate checkpoint existing ambient/default behavior remains viable; new named execution stays authorization-held until all prerequisites and external holds clear.

## Persisted write-path acceptance ledger (must be completed with file:line/tests)

| Write / scope | Authoritative runtime reader / side effect | Required proof |
| --- | --- | --- |
| Label-only Add → profile DB plus `provider-accounts/<provider>/<id>/` beside DB | Registry resolve/canonical route → selected command/SDK env | Empty owned directory, no credential copy, canonical alias/replacement check; 4–7. |
| Per-workspace main selection | Native-compatible central main start before model/output-style/MCP resources → resolved binding | Omitted fresh uses choice, explicit ambient skips, API provider untouched, existing runs unchanged; 18/29/33. |
| Per-workspace/provider lane selection and explicit spawn ID/sentinel | Public CLI/MCP/RPC serialization → manager → admission → actual adapter | Explicit override/ambient, wrong provider refusal, no dropped optional value; 19/20/25/28/34. |
| SetDefault transaction updates both future selections | Authoritative snapshot updates both cells; readers above | Both atomic; no hidden third default, no legacy/bound capture; 5/6/29/33. |
| Registry binding/lease and session/ref linkage | Restore/auto/explicit/slash/cost-handoff/rewind/fork/child authoritative lookup | Both durable writes awaited pre-prompt, real SDK ID attachment, unknown/malformed/absent distinction; 16–22. |
| Auth operation ID/state/revision/epoch | Status/action CAS, run exclusion, model/resource/owner invalidation | Late success cannot overwrite cancelled/new generation; close awaited, uncertain lease retained; 6/14/17/20/36–39. |
| Rename/remove/tombstone | Summary/selection re-read; bound continuation registry lookup | Rename label only; remove clears future choices atomically, leaves credentials/files/live snapshot, blocks later resume; 5/6/18–22/33. |
| User output-style write/activation | Discovery/activation using SAME immutable selected root; project styles workspace scoped | No named write to ambient root or invisible fallback; 13/18. |
| Claude/Codex model/effort settings | Typed config get/set → frontend settings state → runtime policy → shared option builder | Explicit/configured/inherited precedence, unsupported not falsely applied, modelTier unchanged; 11/24–29/34. |
| Codex supported new-home file-store configuration and scoped refresh | Effective store certification → home pool/token/App Server/proxy/SDK/catalog/MCP/rollout | No rewriting old user's store, global reservation guard, unique temp generation CAS, no host env mutation; 36–41. |
| Event-time usage/ledger owner | Owner-correct dashboard/cache and historical source readers | Same proven identity aggregates, unknown stays route/run-specific, no retroactive reattribution; 15/23/24/39/41. |

## Completion / QA handoff holds

- **Subscription release/onboarding authorization OPEN.** Only live new named auth-command/query launches are held; existing ambient Claude provider behavior is preserved. No config switch, test injection, reviewer, document gate or completion report can grant user-reserved authorization.
- **A1–A4 OPEN.** Fixtures and mock SDK calls are technical evidence only. Authorized installed compatibility must establish status/source/directory, empty-query admission, user-state/effective precedence and Codex supported store isolation. No credentials inspection or live provider operation is authorized by these batches.
- **Rendered Electron evidence OPEN.** Later explicit launch permission required; dark/light, focus/keyboard, contrast, exact viewport bands/embedded400, approved prototype comparison. No launch/screenshots during decomposition or ordinary lane checks.
- **Abandoned reservation recovery deliberately unsupported.** No automatic reclaim. Uncertain reservations unavailable by route; not a task-completion claim of a recovery capability.
- **No removals approved.** At completion compare base surface against inventory, then every keep/move row with passing evidence; all actions/default native provider/other seven lanes/native model+effort, quota/home readers and host compatibility retained. Missing inventory coverage or failed preserved capability blocks completion.
- Final QA recommendation: independent senior-tester acceptance audit plus different-family code-logic review and Electron visual-reviewer after launch permission; public API style reviews already due by phase. Do not declare TASK COMPLETE while any mandatory compatibility, rendered evidence, parity or write-path proof is missing. No commits or pushes as a side effect of QA.
