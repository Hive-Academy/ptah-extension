# P2 fix re-review — TASK_2026_701_9e4b

Scope: supplied `p2-fix-diff.patch` (74501c8d2 + be9f73ef8), the eleven requested findings, and serious regressions in their fix paths. B3/B6/B7/B8 remain deferred under D32; they are not findings here.

**10 FIXED; 1 PARTIAL. Remaining: 1 Blocking, 0 Serious, 0 Moderate; 1 failure mode. New Blocking/Serious defects identified: 0.**

Paths below are relative to the supplied worktree. For compact citations, `BE` means `libs/backend`, `FE` means `libs/frontend/setup-wizard/src/lib`, and `RPC` means `libs/backend/rpc-handlers/src/lib`.

## Per-finding verdicts

| ID | Verdict | Current-source evidence and assessment |
| --- | --- | --- |
| A1 | FIXED | `apps/ptah-cli/src/cli/commands/agent.ts:326` uses `wx`; `:398` rejects non-files, `:403` keeps unreadable destinations, `:418` distinguishes identical from differing content, and `:427` maps an exclusive-create collision to kept. Invoking apply no longer authorizes replacement. |
| A2 | PARTIAL | `BE/agent-generation/src/lib/services/file-writer.service.ts:239` creates exclusively and `:241` keeps collisions. `BE/platform-core/src/agent-pack-download.service.ts:493` publishes with a no-clobber link, with `wx` fallback at `:501`. Replacement rechecks exist at writer `:276` and downloader `:530`, but there is still no shared coordination around recheck plus replacement. The pack-only instance queue at downloader `:294` does not cover writer `:295`. See the remaining blocker below. |
| A3 | FIXED | `apps/ptah-cli/src/cli/commands/agent.ts:212` calls `packInstallChanged`; `:225` derives changed from a written outcome when files exist and otherwise retains the documented compatibility fallback. All-kept/unchanged results no longer inherit fetch-cache semantics. |
| A4 | FIXED | `RPC/handlers/wizard-generation-rpc.handlers.ts:974`, `:984`, `:990`, and `:1010` run/persist/reload Library facts for settled summaries without requiring a tab binding. No-work completion builds result facts at `:897`. `RPC/handlers/wizard-generation-run.supervisor.ts:328` builds status/result for every run, making only tabBinding conditional at `:339`. The extracted pass catches propagation failure and returns failed Library refresh at `RPC/handlers/wizard-generation/generation-library-pass.service.ts:240`; it does not undo file success. |
| B1 | FIXED | `FE/services/generation-preview.store.ts:94` retains the explicit root and submits `{ fileDecisions: {}, target }` after preview failure. Target changes are stored at `:125` and failure handling at `:160` does not clear that choice. `FE/components/agent-selection.component.ts:1043` forwards the resulting decisions into submission at `:1092`. |
| B2 | FIXED | `FE/components/pack-install-prompt.component.ts:354` hands the operation to the root-provided `PackInstallStore` (`FE/services/pack-install.store.ts:68`) before dismissing. That store awaits the RPC and settles outcomes itself at `:127` and `:150`; completion no longer depends on an output listener belonging to the destroyed host. |
| B4 | FIXED | `FE/services/pack-install.store.ts:174` persists terminal file status, outcome, safe failure, target and pack result. Wizard reads it at `FE/components/agent-selection.component.ts:958` and `:982`; sidebar reads the same scoped history at `FE/components/community-packs-panel.component.ts:115`, `:239`, and `:243`. A fresh prompt clears its decision snapshot at `FE/components/pack-install-prompt.component.ts:365`, preserving the default-Keep behavior. |
| B5 | FIXED | Within the named surfaces, raw install errors pass through fixed-copy mapping at `FE/components/pack-install/pack-install-result.ts:114`; raw failed-install detail is logged at `FE/services/pack-install.store.ts:144`. `FE/utils/safe-failure-copy.ts:67` returns only fixed copy or the supplied fixed fallback. Completion rows call the same mapper at `FE/components/completion/outcome-summary.component.ts:223`, rendered at `:127`. Wizard/sidebar render the sanitized stored result (`agent-selection.component.ts:429`; `community-packs-panel.component.ts:119`). This is not a certification of unrelated completion/error surfaces. |
| S1 | FIXED | Preview transitions moved to `FE/services/generation-preview.store.ts:40`; install operation/result transitions moved to `FE/services/pack-install.store.ts:69`. Agent selection delegates at `FE/components/agent-selection.component.ts:1037` and `:1042`. Backend post-run consent/propagation/divergence moved to `RPC/handlers/wizard-generation/generation-library-pass.service.ts:95`, called by handler `:984` and registered at `RPC/register-shared-rpc-handlers.ts:78`. Existing host-file size alone is not re-raised. |
| S2 | FIXED | `RPC/handlers/setup/pack-install.service.ts:146` and `RPC/handlers/wizard-generation/generation-preview.service.ts:242` now declare actual collaborators in constructors. Optional capabilities use explicit optional tokens (`:155` / `:250` respectively). Their container injection and generic lookup helpers are removed by the patch. This addresses the dependency-declaration finding; host runtime resolution was not independently exercised. |
| M1 | FIXED | Shared result types/conversion/counting/notices now live in `FE/components/pack-install/pack-install-result.ts:33`, `:58`, `:96`, `:120`, and `:148`. The prompt imports only the request type at `FE/components/pack-install-prompt.component.ts:23`; sidebar imports shared utilities at `FE/components/community-packs-panel.component.ts:17`, rather than obtaining them from the dialog implementation. |

## Remaining original blocker: A2 replacement race

Both operations can preview existing bytes H and obtain valid replacement decisions. The wizard's final read returns H (`BE/agent-generation/src/lib/services/file-writer.service.ts:276`); the pack's final read also returns H (`BE/platform-core/src/agent-pack-download.service.ts:530`). Both guards pass. One commits new bytes, then the other's ordinary write/rename replaces those bytes (`file-writer.service.ts:295`; `agent-pack-download.service.ts:540`). Both can report written, although the second replaced content that its decision never covered.

The downloader queue is local to that service (`agent-pack-download.service.ts:294`); it cannot serialize the wizard writer. Even two calls to the wizard writer have no equivalent destination lock. This is the unresolved original Blocking finding, **not a new regression**. Documenting the external-editor/process race (`file-writer.service.ts:266`; downloader `:518`) does not satisfy A2's separate requirement to coordinate Ptah writers.

Required completion: share destination coordination across the two writers, put the final baseline read and mutation inside it, and test two replacement callers with the same baseline. Preserve the documented external-process limitation. Existing interleaving coverage exercises create-only callers (`file-writer.service.spec.ts:420`) and an edit before the second read (`:450`; `agent-pack-download.service.spec.ts:861`), not two replacements that both pass their final read.

## New Blocking or Serious defects

None identified in the inspected fix paths. This is a scoped static conclusion, not an exhaustive approval of every surrounding host file or runtime DI graph.

## Five logic questions

1. **Silent failure:** A2 lets both writers report success while the later replacement loses the earlier result (`file-writer.service.ts:295`; downloader `:540`).
2. **Unexpected user action:** Overlapping wizard and pack replacements against the same destination can trigger A2. Navigating away during pack installation now leaves a service-owned operation that settles independently (`FE/services/pack-install.store.ts:118`, `:150`).
3. **Wrong-answer input:** Two different replacement bodies with the same valid baseline hash both pass before either mutation; the checks at writer `:286` and downloader `:534` do not make the subsequent mutation conditional atomically.
4. **Dependency failure:** Install rejection becomes a persisted failed result and safe copy (`FE/services/pack-install.store.ts:132`, `:149`). Propagation rejection becomes a failed Library pass (`RPC/handlers/wizard-generation/generation-library-pass.service.ts:240`). Malformed runtime RPC payloads and process-exit recovery were not independently exercised.
5. **Missing contract:** The scope of replacement coordination needs to distinguish Ptah writers from external editors. A2 already requests the former; the new comments document only the latter (`file-writer.service.ts:266`; downloader `:518`). No new scope decision is needed to finish A2.

## Evidence, limits, and decisions

Reviewed the original findings, executor reports, D32, task requirements/context and relevant plan provisions; inspected the patch and current implementations for the cited paths, including exclusive-create adapters and interleaving specs. Larger host files were read in targeted sections, not exhaustively; no approval of their unexamined code is implied.

No tests, builds, installs, git operations or source edits were performed. Backend report records 70 successful verification tasks; frontend report records 8 passing suites/118 tests and successful scoped typecheck/lint. Those are executor-reported results, not checks repeated here. Scoped diagnostics on the deliverable returned unavailable: no requested file could be checked (0 analyzed). This supplies no source-verification evidence.

Decision: retain A2 as PARTIAL rather than accept the documented race as full closure. Evidence: original A2 explicitly requires shared Ptah-writer coordination, and the two current mutation sites remain independent. Reversible upon implementation and re-review. All D32 deferrals remain excluded.

**Score: 6/10.** Most scoped fixes address their reported paths, separating this from the previous 3–4 band. The remaining data-loss race prevents the 7–8 sound-implementation band.

Verdict: REVISE
