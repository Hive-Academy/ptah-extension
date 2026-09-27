# Code Logic Review — `TASK_2026_559_8ca9` — Lane K closing security review

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 4/10 |
| Assessment | NEEDS_REVISION |
| Closing verdict | **REVISE** |
| Blocking issues | 4 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 5 |

The CLI command follows O2's normal RPC flow, but the complete lane does not yet enforce current, durably stored consent. Independent probes reproduced stale authorization after another process revokes, authorization surviving a failed grant write, false vet coverage for excluded files, and a displayed-target replacement race. These are execution and reporting defects, not style issues. The working resolver, fixed invocation, host gating and failure disclosures distinguish this from the 1–2 band; the consent violations prevent the 5–6 band.

Paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-k`. Abbreviations: **WI** = `libs/backend/workspace-intelligence/src`; **EC** = `WI/diagnostics/external-checkers`; **RH** = `libs/backend/rpc-handlers/src/lib`; **CLI** = `apps/ptah-cli/src/cli`; **CARD** = `libs/frontend/chat/src/lib/settings/ptah-ai/go-vet-consent-config.component.ts`; **FMT** = `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts`. These abbreviations expand every file:line anchor below.

Reviewed the lane against base `1eab01c35`, ending at `2ff8aded0`, including Batch 37b3 (`4748709a6`). Read the complete consent command, RPC, store, resolver, checker, membership/parser, runner, reaper and card implementations; traced the affected provider, formatter, namespace, host and router paths, their surrounding code and regression evidence. Large unrelated router/host/formatter portions were not exhaustively audited; this is a security review of the lane, not approval of those entire subsystems. Read context, language plan, O2, batch/executor documents and prior reviews. The external gate document named in the request and the local O2 copy have identical SHA-256 `662E5849B750786A5D8202F73C65F3F6C87FB5877D62172671C864CE7EFF1091`. No task-description.md or plain implementation-plan.md exists in this task; implementation-plan-languages.md supplies the plan. `ptah_search_files` returned no AGENTS.md; CONVENTIONS.md and supplied project guidance were consulted. No applicable lane style review was discovered.

## Verification

- Ran the requested five-project Nx test/lint/typecheck command once, cache disabled, using PowerShell `nx.cmd`, quoted target/project arguments and an OS-temp log instead of `tail`. The initial unquoted invocation was rejected by PowerShell before Nx started. The actual Nx run completed in **5m 43s: 52 tasks successful, one failed**. All selected lint/typecheck targets and workspace-intelligence, chat, CLI and Electron tests succeeded. Only `@ptah-extension/rpc-handlers:test` failed: `harness-skill-selection-rpc.service.spec.ts:113`, the named pre-existing temp-state case (expected no state file, found one); 112 suites/3,294 tests passed in that project. Electron's stress-bundle failure did not occur in this run. No failed suite was rerun. Log: `C:/Users/abdal/AppData/Local/Temp/lane-k-closing-nx.log`.
- Scoped `ptah_get_diagnostics` to config.ts and go-vet-checker.ts. It returned **unavailable: compiler still running after 45 seconds**, not a pass. The completed Nx typechecks above provide the compiler evidence instead.
- Independent OS-temp probe `C:/Users/abdal/AppData/Local/Temp/lane-k-close-probe.cjs` transpiles and loads the actual TS store, CLI storage, checker, membership and RPC implementations. It uses real temporary directories/files, the actual containment/scoped-storage predicates, controlled binary identities and a fake successful checker runner. DI decorators/irrelevant barrels are isolated. No real Go binary is executed. Latest fixture: `C:/Users/abdal/AppData/Local/Temp/lane-k-close-NFATxU`.
- Probe results: persisted revoke deleted the key, revoker read `off`, existing instance read `on`, next checker invoked the runner once; unrelated old-instance update restored the revoked key. A grant whose real filesystem write failed still read `on` and invoked the runner. Both `IGNORED.GO` and `package documentation` returned `checked/ok` and no notChecked entries. A real directory replacement plus changed injected binary between GET and SET returned success/on and stored the new binary.
- Go is absent, so real-Go hostile behavior remains unverified here. Membership findings combine executed implementation probes with the primary Go source cited below; they are not represented as real-Go execution. Visual closure relies on the existing measured re-review plus current source inspection, not a new browser run.

## Batch 37b3 assessment

**Normal contract: satisfied.** `CLI/commands/config.ts:572` GETs before changing; `:579` captures the returned root, `:582` sends it, and `:604` displays the identical value. The root is not taken from a separate caller option at SET time. `CLI/router.ts:382` routes an explicit action to `executeGoVet`; `config.ts:175` rejects unknown/inherited action names with 2. Supported success returns 0 (`:553`, `:611`); unsupported/refused changes return 1 with the fixed stderr prefix (`:648`); transport failures become 5 (`:155`). Wrong successful SET state is rejected at `:599`. JSON uses the shared NDJSON encoder (`CLI/output/formatter.ts:53`); human fallback prints the same payload (`:204`). A refused change emits no config.goVet success notification. An unsupported status does emit its truthful supported:false notification before returning 1, as O2 describes.

`config.spec.ts`'s go-vet cases test the dispatch/fields and refusals with formatter and engine doubles; they do not establish cross-process persistence or actual command-line parser error behavior for missing/extra arguments. No silent enable path from `--auto-approve`, generic config settings or repository files was found: the grant branch requires an explicit go-vet action, and the store consumes only its dedicated host-state record (`config.ts:143`, `EC/go-vet-consent-store.ts:166`). `--config` selects the host data directory; the guard denies consent when that directory resolves inside the checked root (`CLI/router.ts:190`, `EC/go-vet-consent-store.ts:270`). O2 explicitly excludes an actor already authorized to write arbitrary host state or execute shell commands from its threat model.

**Harness deferral: acceptable for the isolated lane, not evidence of completed integration.** `batch-37b3-executor-report.md:8` records the absent Batch 27 harness and integration-branch handoff. `batches.md:4316` still requires b37b.ts and `:4345` requires exact final key membership. Carry its activation and `HONESTY_CHECKS['typeCheck:go']` work to integration before Batch 38 can pass; do not advertise the missing fragment as tested or complete. This deferral does not excuse findings 1–4.

## Security checklist

PASS is limited to the cited boundary; adjacent FAIL rows qualify the overall guarantee.

| Item | PASS/FAIL | Evidence |
| --- | --- | --- |
| Default denied; exact registered-root storage; no active/global fallback | PASS | `EC/go-vet-consent-store.ts:159`, `:250`; malformed/read failures become off. |
| Repository settings or CLI permission flags silently grant | PASS | Dedicated key at `EC/go-vet-consent-store.ts:34`, read at `:166`; explicit action branch at `CLI/commands/config.ts:143`; data-directory containment at store `:270`. |
| Durable grant failure cannot authorize | **FAIL** | Finding 2; CLI storage mutates memory before persist; next check consumes it. |
| Revoke deletes and reads back in the same instance | PASS | `RH/handlers/diagnostics-consent-rpc.handlers.ts:193`, `:237` checks value and key absence before success. |
| Revoke prevents subsequent runs in every existing CLI host | **FAIL** | Finding 1; cached delegate bypasses durable revocation and can restore it. |
| Stored grant invalidates on current root/binary metadata change | PASS | `EC/go-vet-consent-store.ts:224`, `:230`, `:234`; O2's null-inode and metadata identity limitations apply. |
| Displayed root/binary identity remains the grant target | **FAIL** | Finding 4; GET/SET bind a pathname, not the displayed physical identity. |
| Binary search uses cleaned absolute PATH, no implicit cwd/PATHEXT search | PASS | `EC/go-binary-resolver.ts:114`, `:161`, `:201`; canonical workspace/user-data candidates rejected, rejected candidates do not stop search. |
| Windows executable selection excludes .cmd/.bat | PASS | Resolver `:201`, `:213`; absolute executable adapter coverage in off-thread-process-spawner.spec.ts. |
| Static outward input junction cannot select a different module | PASS | `EC/go-vet-checker.ts:470`, `:475`, `:480`; cwd is canonical module at `:635`. Concurrent filesystem replacement remains a separate seam. |
| Fixed argv/no shell; complete environment allowlist | PASS | `EC/go-vet-checker.ts:99`, `:383`, `:633`; `EC/checker-runner.ts:186`; adapter passes env through at `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts:705`. |
| Timeout/output cap/cancellation request tree termination | PASS | Runner `:155`, `:173`, `:182`; handle fallback in finally `:113`; default reaper error observer `:129`. This promises a stop request, not verified death. |
| No real Go execution during ordinary syntax checking without consent | **FAIL** | Local gate `EC/go-vet-checker.ts:598`; cached/failed-write consent defects in findings 1–2 undermine the end-to-end assertion. |
| Actual Go file membership credited truthfully | **FAIL** | Finding 3; excluded extension/package cases are credited. |
| Unmapped findings/truncation survive provider/namespace/formatter | PASS | Checker `:671`, provider `:848`, namespace `:242`, FMT `:1265`; localization gap is finding 5. |
| No bare clean or type-check claim when vet is off/failed | PASS for traced renderer paths | FMT `:868`, `:877`, `:1253`, `:1297`; provider retains syntax-only approximation. False *vetted-file* claims remain finding 3. Raw coverage.clean alone is not the complete vet verdict. |
| VS Code does not expose this capability or consent card | PASS | `RH/host-profile/host-profile.ts:83`; manifest `:408`; VS Code expected-absent methods `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts:59`; card mounted in Electron block of settings.component.html. VS Code uses `vscode.languages.getDiagnostics()` at platform-vscode provider `:57`. |
| Fixed audit data avoids paths/raw process output | PASS | `EC/go-vet-checker.ts:528`; consent handler `:214`, hash `:290`; kill-failure observer logs only hash. |

## Prior findings: VERIFIED / OPEN

| Prior finding | Status | Current evidence and scope |
| --- | --- | --- |
| 37a Blocking 1: false file membership | **OPEN** | Original missing/build-tag/cgo cases have fixes and regression assertions (`EC/go-vet-checker.spec.ts:560`, `:578`; membership `:221`). Closure is incomplete: finding 3 reproduces additional excluded files still credited. |
| 37a Blocking 2: outward junction escapes consent root | **VERIFIED** | Canonical file/root containment (`EC/go-vet-checker.ts:558`, `:470`, `:475`), regressions `go-vet-checker.spec.ts:638`, `:670`, `:690`. This verifies the reported static junction escape, not atomic protection against a later filesystem swap. |
| 37a Blocking 3: out-of-root positions erase findings | **VERIFIED** | Parser counts unmapped (`EC/go-vet-output.ts:140`); checker forces findings (`go-vet-checker.ts:698`); formatter discloses (`FMT:1269`). Original regressions at checker spec `:732`, `:759`. Finding 5 is a remaining package attribution edge, not erased global findings. |
| 37a Moderate / 37b1a reaper follow-up | **VERIFIED** | Runner finally fallback `EC/checker-runner.ts:113`, observer `:129`; reaper `libs/backend/platform-core/src/utils/process-tree-reaper.ts:75`; non-ESRCH regression in reaper spec `:160`. Timeout wording says stop requested at checker `:249`. |
| 37b1a Moderate: >50 Go files disagree with syntax cap | **VERIFIED** | Vet receives checked slice at provider `:677`, `:690`; omitted sibling findings filtered at `:462`; regression in language-aware-diagnostics-provider.spec.ts `:1568`. |
| 37b2 visual 1: dark On badge contrast | **VERIFIED** | CARD `:142` now outline/base-content; measured re-review in visual-review-37b2.md reports dark 13.76:1 and light 14.92:1. |
| 37b2 visual 2: error text contrast | **VERIFIED** | CARD `:223` base-content/error-tint chip; re-review reports 12.85:1 dark, 12.90:1 light. |
| 37b2 visual 3: undersized toggle target | **VERIFIED** | CARD `:159` min-height/min-width label target; re-review measures 32×24 px in both themes/viewports. |
| 37b2 visual 4: conflicting pending badge/toggle | **VERIFIED** | CARD `:318`, `:330` pending/Saving labels; re-review screenshots show both confirmation and in-flight save. |

Visual residual: trusted keyboard Tab focus-ring verification remains open in the existing visual review. No new visual defect is asserted here.

## Five logic questions

### 1. How does this fail silently?

A different process's revoke is invisible to a cached storage delegate, and an unrelated write can resurrect it (finding 1). A failed grant write still changes the value the checker reads (finding 2). Successful package output credits files Go never selected (finding 3).

### 2. What user action produces unexpected behaviour?

Running `ptah config go-vet off` while a CLI/TUI host stays open can leave its next vet run authorized (`EC/go-vet-consent-store.ts:166`, finding 1). Confirming an old card after a re-clone or toolchain change can authorize a different physical target (`RH/handlers/diagnostics-consent-rpc.handlers.ts:179`, finding 4).

### 3. What input data produces a wrong answer?

An uppercase `.GO` file or a `package documentation` file beside a valid Go package is credited after a successful run despite exclusion (membership `:241`, finding 3). A real package directory ending `_test` is mapped to its sibling when attributing an unmapped finding (`EC/go-vet-output.ts:186`, finding 5).

### 4. What happens when a dependency fails?

Missing binary/spawner, nonzero exit, malformed/analyzer output and resource limits are disclosed (`EC/go-vet-checker.ts:590`, `:608`, `:642`, `:652`, `:662`). Provider exceptions preserve other language results (`language-aware-diagnostics-provider.ts:851`). Persistence failure is reported to the RPC caller but does not roll back CLI storage memory (finding 2). Kill failure invokes an observer and retains stop-request wording, rather than claiming confirmed termination.

### 5. What is missing that the requirements never mentioned?

The state port lacks a durable, fresh cross-process consent transaction. O2's displayed-root string token omits root/binary generation binding (findings 1, 2, 4). Package membership approximation omits Go's extension/package-name exclusions (finding 3). There is also no atomic filesystem identity guarantee through the off-thread launch boundary: checker gate `:598` precedes sending command/cwd to a worker (`off-thread-process-spawner.ts:295`), which receives no consent identity token. No exploit through that final kernel-launch interval is claimed or separately counted; it needs an explicit trust/race contract and a delayed-launch regression when addressing finding 4.

## Failure modes — numbered findings

### 1. Blocking — revocation is stale across running CLI instances

- **Disposition: fix-now.**
- **Anchor:** `EC/go-vet-consent-store.ts:166`; `libs/backend/platform-cli/src/implementations/cli-state-storage.ts:26` and `:48`; actual delegate registration `libs/backend/cli-engine/src/lib/container.ts:455`.
- **Trigger:** Host A starts with consent on. A second CLI invocation opens the same workspace/data directory and successfully executes off. A then receives another diagnostics request.
- **Symptom/impact:** The disk key is absent and the revoker reports off, but A still authorizes the next vet invocation. A subsequent unrelated state update can persist its old whole object and restore the grant on disk.
- **Current handling:** Store.read is called each run, but delegate.get reads the object loaded only at construction. The per-handler setChain does not coordinate separate processes. The probe returned diskHasKey:false, revoker:off, existing:on, runner calls:1; unrelated update restored the key.
- **Fix:** Give consent a fresh durable read and serialized cross-process update/revoke semantics, or route every consent operation through one authoritative owner. Prevent stale whole-state snapshots from restoring removed consent. Test a persistent CLI/TUI host plus separate on/off invocations, then an unrelated write; fresh processes alone are insufficient.

### 2. Blocking — a failed grant write remains an effective in-memory grant

- **Disposition: fix-now.**
- **Anchor:** `libs/backend/platform-cli/src/implementations/cli-state-storage.ts:35`; `EC/go-vet-consent-store.ts:200`; `RH/handlers/diagnostics-consent-rpc.handlers.ts:195`; checker gate `EC/go-vet-checker.ts:598`.
- **Trigger:** Grant through a long-lived CLI-engine RPC host while its workspace-state write fails (disk full, permission failure, invalid storage parent). Request diagnostics afterwards in that host.
- **Symptom/impact:** SET reports persist-failed, yet the checker can execute using a grant that was never durably stored. The probe caused an actual filesystem failure using a file where the storage parent directory should be; grant rejected, store read on, checker invoked the runner once.
- **Current handling:** update mutates data before persist; rejection does not restore the prior object. The handler returns a fixed refusal but does not invalidate the effective grant. The existing throwing-write spec replaces update entirely (`diagnostics-consent-rpc.handlers.spec.ts:463`), so it misses mutate-then-fail behavior.
- **Fix:** Publish a grant to readers only after durable commit, restore/invalidate the in-memory value on failure, and fail closed on uncertain persistence. Exercise failure after memory mutation with the actual delegate, then check and restart. Avoid a rollback that can overwrite another process's change; solve with finding 1's transaction model.

### 3. Blocking — Go-excluded files are still reported as vetted

- **Disposition: fix-now.**
- **Anchor:** `EC/go-vet-checker.ts:549`, `:490`, `:695`; `EC/go-file-membership.ts:187`, `:221`, `:241`.
- **Trigger:** A valid package contains ordinary a.go plus `IGNORED.GO`, or a separate documentation.go with `package documentation`. Request the excluded file. A successful package vet provides empty output.
- **Symptom/impact:** Both probes returned status checked, outcome ok, that excluded file in checkedFiles and no notChecked entry. The formatter then claims a file was vetted even though Go did not analyze it; syntax checking cannot substitute for the promised vet coverage.
- **Current handling:** The checker lowercases the extension; membership never verifies exact `.go`, and the scanner discards the package identifier after validating its shape. All otherwise ordinary headers become member.
- **Evidence for Go's selection:** [Go build implementation](https://go.dev/src/go/build/build.go#L1450) rejects unknown extensions case-sensitively; [package selection](https://go.dev/src/go/build/build.go#L939) skips package documentation. This is primary-source inference for the Go side plus executed replay of Ptah's transformation, not a claimed real-Go test.
- **Fix:** Require the actual directory-entry extension accepted by Go and retain/exclude the documentation package name. Add both regressions with another buildable file in the same directory; continue reporting uncertainty for any membership not proven. Keep the existing constraint/cgo/readability protections.

### 4. Blocking — GET/SET can authorize a replaced folder or binary without a fresh display

- **Disposition: fix-now.**
- **Anchor:** `RH/handlers/diagnostics-consent-rpc.handlers.ts:145`, `:179`, `:185`, `:191`; `EC/go-vet-consent-store.ts:188`; CARD `:458`, `:497`; `CLI/commands/config.ts:607`.
- **Trigger:** Open the consent confirmation for root A/binary X. Before Allow reaches SET, another process replaces A at the same pathname or changes the resolved binary to Y. The path string and frontend scope key remain unchanged.
- **Symptom/impact:** SET compares only pathname equality and creates a brand-new record using the new root identity and binary. It returns on rather than demanding a refreshed confirmation. The card/CLI retains the old GET binary path in the success view. The probe physically replaced the root directory, changed the binary resolver answer, and received success/on with the new binary stored.
- **Current handling:** Existing *stored* grants become stale correctly on the next read. That protection does not bind an in-flight grant to what GET displayed; grant captures fresh facts and blesses them. This is a gap in O2's string-token design as well as its implementation, not noncompliance with the literal pathname comparison step.
- **Fix:** Return a host-issued grant token binding root realpath/id and binary identity at GET; require and revalidate it at SET, refresh/reconfirm on mismatch, and return the committed identity for display. Recheck binary identity after an awaited persistence operation before reporting on. Define how queued off-thread launch uses that authorization without silently transferring it to changed paths.

### 5. Moderate — real package names ending `_test` lose unmapped-finding attribution

- **Disposition: carry-to-38.**
- **Anchor:** `EC/go-vet-output.ts:184`, `:186`; `EC/go-vet-checker.ts:677`, `:688`.
- **Trigger:** The module has a real `foo_test` package directory. Its vet output has package ID `example.com/m/foo_test` and an outside-root adjusted diagnostic position.
- **Symptom/impact:** packageDirForId strips `_test` unconditionally and returns module/foo. The actual foo_test requested file remains credited while an unrelated foo package may be excluded. The probe confirms the wrong directory. Global unmappedFindings and outcome findings remain visible, so this is not a bare-clean or erased-diagnostic regression.
- **Current handling:** Legitimate suffix names and synthetic test-package variants are conflated. Existing tests exercise bracketed synthetic IDs, not the ambiguous real name (`go-vet-checker.spec.ts:777`).
- **Fix:** Preserve exact real package matches first, or conservatively disqualify all candidate packages when a test variant cannot be distinguished. Add real foo_test and bracketed external-test cases together before Batch 38.

## Blocking issues

Findings **1–4** above block acceptance: current consent, durable grant, honest file coverage, and displayed execution-target binding respectively. Each includes the failing scenario, source evidence and required fix. Do not carry these as completed Lane K work.

## Serious issues

None separately established.

## Moderate and minor issues

Finding **5** is Moderate and may carry to Batch 38 because the global finding is still disclosed. The absent b37b activation and trusted-keyboard/real-Go checks are explicit verification obligations, not manufactured runtime defects.

## Data flow

1. **Electron display → SET:** scope-key/GET sequence discards stale workspace responses, explicit Allow sends displayed pathname (CARD `:374`, `:421`, `:458`). **GAP:** physical identity/binary replacement with the same pathname, finding 4.
2. **CLI → SET:** explicit status/on/off; GET root reused for SET and notification (`CLI/commands/config.ts:572`). **OK** normal action/exit/JSON contract; inherited persistence and identity gaps remain.
3. **RPC → store:** capability-gated manifest, strict params, active registered root comparison, serialized instance writes (`RH/handlers/diagnostics-consent-rpc.handlers.ts:60`, `:125`, `:176`). **GAP:** queue/readback is not a cross-process transaction; findings 1–2.
4. **Store → gate:** root metadata and resolved binary judged each check (`EC/go-vet-consent-store.ts:219`, checker `:598`). **GAP:** consent value itself comes from a stale or uncommitted delegate cache.
5. **Files → invocation:** canonical containment and bounded package planning (`EC/go-vet-checker.ts:460`). **GAP:** excluded-file membership, finding 3; static outward-junction regression repaired.
6. **Invocation → child:** fixed canonical command/argv/env and bounded runner (`:631`, runner `:186`), actual adapter preserves args/env (`off-thread-process-spawner.ts:705`). **OK** no caller flag/shell injection; off-thread identity interval noted above.
7. **Child → result:** failures are qualified; unmapped counts/truncation survive (`EC/go-vet-output.ts:108`, checker `:642`). **GAP:** package attribution, finding 5.
8. **Result → user:** provider merges syntax/TS/vet, forwards checker fields, formatter adds top-of-answer qualifiers (`WI/diagnostics/language-aware-diagnostics-provider.ts:803`, namespace `:242`, FMT `:868`). **OK** for off/failed/unmapped/truncated disclosure; it cannot repair upstream false checkedFiles.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Batch 37b3 root/exit/JSON normal flow | COMPLETE | Persistence/identity defects are shared downstream. |
| Current stored consent before every run | PARTIAL | Findings 1–2. |
| Consent bound to root and binary changes | PARTIAL | Stored-record checks work; in-flight confirmation does not bind displayed identity, finding 4. |
| Revoke deletion and readback | PARTIAL | Same-instance verification works; other running hosts and stale whole-object writes violate it. |
| Clean PATH, Windows executable, fixed argv/env, bounded runner | COMPLETE for inspected implementation | Real Go and native POSIX execution not verified here. |
| Honest vet coverage and no type-check promotion | PARTIAL | Excluded-file claims and package attribution, findings 3 and 5; formatter type-check/off/failure qualification works. |
| Electron/CLI wiring; VS Code exclusion | COMPLETE for inspected paths | Requested checks and prior host-shaped tests support wiring; no installed-Go end-to-end run. |
| Matrix b37b activation/final honesty gate | MISSING in this lane, deferred | Must land on integration before Batch 38. |

Implicit requirements not addressed: cross-process durable consent freshness, atomic visibility of failed grants, and identity-bound pending confirmations.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Missing/malformed/read-error consent | YES | Store returns off (`:163`). | Actual cached failed-write grant is a different path. |
| Static root/binary change after grant | YES | Stale judgment (`store:224`). | Null inode and metadata-only identity are O2 limitations. |
| Another process revokes | NO | Cached CLI data remains on. | Finding 1. |
| Grant persistence fails after memory mutation | NO | Rejection does not remove effective grant. | Finding 2. |
| Target replaced while confirmation remains open | NO | Same pathname passes SET. | Finding 4. |
| Missing/tagged/cgo/oversized files | YES for covered regressions | Conservative membership/skipped entries. | Other excluded files still fail, finding 3. |
| More than 50 files / 20 packages / 500 findings | YES | Bounded inputs and disclosed omissions/truncation. | Package execution may inspect sibling files; result cap is not an execution sandbox. |
| Timeout, overflow, cancel, spawn/output failure | YES | Failed/unchecked answer, stop requested where applicable. | No assertion of confirmed process death. |
| Real `_test` package with unmapped position | NO | Maps to suffix-stripped sibling. | Finding 5; global finding survives. |
| VS Code host | YES | Capability false, family absent, existing language-server provider retained. | No Ptah vet execution claimed there. |

## Verdict

- **Recommendation: REVISE.**
- **Confidence: HIGH** in findings 1–4's reproduced Ptah behavior and source-backed exclusion semantics; MEDIUM in whole-runtime assurance without Go or new browser/native POSIX runs.
- **Top risk:** a user can receive a successful revocation or failed grant response while a subsequent check still executes vet under an effective grant the durable store no longer contains.
- **What a robust implementation would add:** durable cross-process consent transactions; commit-before-publish grant semantics; physical root/binary confirmation tokens; complete conservative membership exclusions; ambiguity-safe package attribution; integration activation and Go-enabled hostile regression execution.

