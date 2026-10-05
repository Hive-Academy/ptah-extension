# Completion report - TASK_2026_609_c495 (team-leader Mode 3, Task B-7.3)

Date: 2026-10-04 | Branch `fix/task-609-subagent-setup` | HEAD `dc5bc09f3` (matches `origin`, PR #635) | Base `f314a4f8a` (#634)

## Verdict

Checks 2-4 pass. Check 1 passes for every required state, but the B-FIX-3 contrast fix has no rendered evidence yet: re-capture 6 modal screenshots (recommended below, not run). Open items: FU-1..FU-10, plus the minor notes listed. FU-2 and FU-3 were recorded with the owner "before the PR merges", so Gate 3 has to decide on them.

## Commit and batch ledger

- `git log --oneline f314a4f8a..HEAD` shows 33 commits. All 33 SHAs named in batches.md pass `git merge-base --is-ancestor <sha> HEAD`. Batch headers that still show pre-rebase SHAs (Part A 1a/1/2, B-1..B-4) are mapped to post-rebase SHAs in the B-7.2 list at batches.md:1189-1208.
- Part A: 3a `43a330406`, 3b `3c2c52284`, 4 `4071ff138`, B1a `ba965aa1c`, B1 `c2c4f9951`, B2 `62f1ad576`, A-FIX-1 `841263730`, A-FIX-2 `dc2e2b3fd`, A-FIX-3 `c1a631b21`, A-FIX-4 `bd05497c8`.
- Part B: B-1 `b3dc1b83a`, B-1b `2b9af459f`, B-2a `ec2387def`, B-2b `3a08ff540`, B-2c `4b1fa6135`, B-3a `045293092`, B-3b `b4f8d4b31`, B-4 `165881e4a`, B-5a `e7a347322`, B-5c `d28ce1337`, B-5b `67cca83f8`, B-5c2 `8fffc0652`, B-5d `48877e550`, B-5e `89fb3c5d3`, B-5f1 `4fe3cae22`, FU-4 `6d9dcba5e`, B-5g `846d6f3f2`, B-5f2/3/4 `15d845bd2`, B-6 `7be71f54e`, B-FIX-1 `603808f5c`, B-FIX-2 `1fa2b6cc8`, B-FIX-3 `7dca3b7cc`, CI-FIX `dc5bc09f3`.
- B-0 and B-7.1 are evidence only and have no commit.
- Reviews:
  - Part A went code-logic-review.md (4/10), then code-logic-rereview.md (5/10), then code-logic-recheck.md (6/10). A-FIX-4 is fixed. A-FIX-3 has a residual, accepted by the user as FU-5 with no further rounds.
  - Part B reviews: partb-review-lanes.md 8/10, partb-review-backend.md 5/10, partb-review-frontend.md 6/10, visual-b7-report.md 7/10. The fix round followed, then partb-recheck.md: APPROVED WITH NOTES 9/10, with 8/8 findings FIXED and no new findings.
- Scoped checks before each commit are recorded per batch in batches.md. harness-sync tests keep the known 17-test baseline plus capability-policy C3, which also fails on main. CI-FIX: the degradation audit exits 0, and typecheck and lint pass on 4 projects (cifix-executor-report.md:27-33).

## Check 1 - Before/after screenshots, both themes

Folder: `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\.ptah\specs\TASK_2026_609_c495\screenshots\`

- Before (B-0, base `21c27d17f`, 1280x800, visual-b0-report.md:8): `before-agents-{dark,light}.png`, `before-wizard-{dark,light}.png`. All 4 are present.
- After (B-7.1, same viewport and method, visual-b7-report.md:7): 34 files, 17 states x 2 themes, every state in both themes.
  - Required pairs `after-agents-*` and `after-wizard-*` are present.
  - Required extra states (implementation-plan.md:166, batches.md:1183) and their files:

    | Required state | Files |
    | --- | --- |
    | Missing chip | `after-agent-card-chips-missing-failed-*` |
    | Edited chip | `after-agent-card-chips-edited-*` |
    | Guard modal | `after-reconcile-guard-*` |
    | Quarantine panel, with `source-restored` | `after-quarantine-panel{,-viewport}-*` |
    | Gate-disabled copy | `after-quarantine-gate-disabled-*`, `after-quarantine-restore-confirm-gate-disabled-*` |
    | Not-owned label | `after-agent-card-not-owned-*` |
    | Model section with an inherited row | `after-agent-model-inherited-*` |
    | Model overrides and edit form | `after-agent-model-overrides-*`, `after-agent-model-edit-form-*` |
    | Wizard preview modal and its warning | `after-wizard-preview-modal-*`, `after-wizard-preview-warning-*` |
- Staleness: the after screenshots were taken at 00:36, before B-FIX-3 (`7dca3b7cc`, about 00:52). That commit changed the overwrite and warning messages from `text-warning` to a solid `bg-warning text-warning-content` fill in both themes (bfix3-executor-report.md:83-96). The partb re-check did not measure contrast (partb-recheck.md:26). So for visual Serious 1 (~2.46:1, visual-b7-report.md:61-64), the only evidence on disk shows the defect, not the fix.
- **Re-capture is needed for evidence.** I recommend it but did not run it. Use the visual-reviewer with the B-7.1 harness (`b0-capture/` repointed, 1280x800). Re-capture these 3 states in light and dark:
  - `after-reconcile-guard`
  - `after-wizard-preview-modal`
  - `after-wizard-preview-warning`

  That is 6 files. Dark is included because the fill also changed there. Measure contrast from computed styles, not pixels: target 4.5:1 or better for `text-warning-content` on `bg-warning`. Keep the pre-fix files as `*-prefix.png` or overwrite them; either way, record which.

## Check 2 - Preserve list (implementation-plan.md:146-154), row by row on HEAD

Abbreviations:
- V = `libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts`
- C = `.../clones/clone-card.component.ts`
- A = `libs/frontend/setup-wizard/src/lib/components/agent-selection.component.ts`

| Preserve item | Status | Evidence (HEAD `dc5bc09f3`) |
| --- | --- | --- |
| Electron-only notice, Refresh, legend, tabs, diverged filter, bulk rebase | KEPT | The plan's `:123-250` has shifted, but the structure is intact. Notice: V:151. Refresh button: V:173-175. Legend: V:181-182. Tab group: V:231-233. Diverged filter and bulk toolbar: V:236-243. Bulk confirm: V:362-367. New harness calls are gated by `onAgentTab = isElectron() && currentKind()==='agent'` (V:569-570) at V:582, V:612, V:618, V:632 and V:664, and the panel and guard render only inside `@if (onAgentTab())` (V:312-323). |
| Card open / Enhance / Rebase / Keep | KEPT | Outputs are unchanged: `opened, enhance, revert, rebase, keep` (C:329-333; base diff shows the same `opened`/`enhance` context lines). The view binds them unchanged (V:301-305). New inputs default to empty: `notOwned` = `false` (C:321), `modelGuard` = `null` (C:327), and `syncChips` renders nothing when empty (C:17-19). The model editor renders only for `kind==='agent' && modelGuard()` (C:227). |
| Detail drawer, history, revert, scorecard; empty copy | KEPT | `git diff 21c27d17f HEAD` is empty for `clone-detail-drawer.component.ts`, `scorecard-detail.component.ts`, `clone-bulk-toolbar.component.ts` and `bulk-rebase-confirm.component.ts`. The drawer is still bound at V:328-346. The empty `<p data-testid="clones-empty">` (V:274-283) still holds only the loading or empty copy. The quarantine panel renders after the grid, outside that `<p>` (V:312-318). |
| Wizard selection + Generate + submit-selection + progress | KEPT | The Generate button (A:483) now opens the preview: `onGenerateAgents` A:1003. Confirm (A:594) goes to `onConfirmPreview` A:1019, which re-previews at A:1035 and reconfirms when the preview changed, then calls `confirmGenerate()` A:1024/1059. `confirmGenerate` (A:1083-1148) holds the previous body: the `isGenerating` guard, `wizardRpc.submitAgentSelection` (A:1101), and `setCurrentStep('generation')` (A:1146). The RPC client `previewGeneration` is at `wizard-rpc.service.ts:89`, and `submitAgentSelection` is unchanged at `:116`. |
| Existing specs: any edited assertion carries a one-line reason | KEPT | `agent-selection.component.spec.ts`: each re-sequenced test carries `// Generation now starts only after preview confirmation.` (e.g. :336, :356, :367, :384, :406, :423, :442). `skill-clones-view.component.spec.ts` has one removed line, an import widened from `signal` to `computed, signal`, which is not an assertion. Other Part B spec diffs only add lines. |

`parity-inventory.md` is marked "Superseded by narrowed scope (context.md); kept for reference" (line 1). The narrowed scope consolidates no surface, so the preserve list above is the parity instrument. No capability was removed, and no `remove-proposed` decision applies.

## Check 3 - Write-path trace

### `agentGeneration.models`

- Registration: a file-based key at `libs/backend/platform-core/src/file-settings-keys.ts:177-179`. The workspace override `workspace.<hash>.agentGeneration.models` is routed by `SCOPED_SETTING_PREFIX_PATTERN`. There is one `AgentModelSettings` instance per host, and each is registered only inside the `if (scopeResolver)` block:
  - `platform-vscode/.../vscode-settings-registration.ts:129`
  - `platform-electron/.../electron-settings-registration.ts:101`
  - `platform-cli/.../cli-settings-registration.ts:104`
- Key derivation: `libs/backend/settings-core/src/scope/workspace-scope-resolver.ts`.
  - `normalizeActivePath` (:16-31) applies `path.resolve` and lower-cases the drive letter on win32.
  - The key is `workspace.<sha256(norm)[0:16]>.agentGeneration.models` (:34-39).
  - `writeForPath` and `inspectForPath` (:189-226) throw on an empty or unnormalisable path, so there is no global fallback.
- Save (B-5g): `skills-synthesis-rpc.handlers.ts`.
  - `setAgentModel` calls `requireActiveWorkspace(parsed.workspaceRoot)` (:1683), which compares `resolveHarnessWorkspaceRoot(requested) === resolveHarnessWorkspaceRoot(agentScope())` exactly (:2369-2371, :2402-2415).
  - It re-checks after the list read (:1718), then calls `settings.update(workspaceRoot, slug, provider, value, scope)` (:1722).
  - `AgentModelSettings.update` (`settings-core/src/repositories/agent-model-settings.ts:138-176`) resolves the physical key before queueing.
    - Workspace scope: `inspectForPath(...).key`, then `resolver.writeForPath`.
    - Machine scope: `store.writeGlobal('agentGeneration.models')`.
    - There is one promise queue per physical key (:181-193), and other slugs, providers and the other layer are left as they are.
- Emission to rival CLIs (B-5f1):
  - `HarnessReconcilerService.reconcile` and `verify` resolve `resolveHarnessWorkspaceRoot(cwd)` once (`harness-reconciler.service.ts:173`, `:194`, `:271`), then pass that root to `sourceResolver.resolve(workspaceRoot)` (:202, :384).
  - `PluginConfigSourceResolver.readAgentModels` (`plugin-config-source-resolver.ts:275-283`) calls `agentModelsFactory()?.layersForPath(workspaceRoot)` with that same resolved root.
  - The getter is wired on all three hosts: `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:187`, `apps/ptah-electron/src/di/phase-2-libraries.ts:274` and `libs/backend/cli-engine/src/lib/container.ts:681`.
  - Save and emission therefore address the same physical key: both use `resolveHarnessWorkspaceRoot` and then the same `normalizeActivePath`.
  - The editor reads with `getAgentModels` → `layersForPath(workspaceRoot)` (:1638) through the same `requireActiveWorkspace`.
- Side effects: the handler never reconciles; the UI reconciles after a save. No environment variables are touched. A host without the factory gets `agentModels` undefined, so its output is byte-identical (B-5f1 result, batches.md:1098).
- Divergence found (new, low severity): **FU-10**.
  - The Claude-side reader (Part A 3b), `orchestrator.service.ts:771` → `readAgentModelLayers(options.workspacePath)` (:1090-1093), receives the wizard's raw `workspaceRoot` (`wizard-generation-rpc.handlers.ts:733`, `:879`). It does not receive `resolveHarnessWorkspaceRoot(...)`.
  - When the opened folder is not its harness root (a nested folder whose ancestor holds `.git`/`.ptah`), the Agents-tab editor saves under the harness root's key, while generation reads the folder's key. A Claude model set in the editor is then not applied by the wizard in that folder.
  - The rival emission is unaffected. The preview already warns that rivals sync from the harness root (`wizard-generation-rpc.handlers.ts:489-495`).
  - Fix: resolve the root in `readAgentModelLayers`, or pass the harness root.
- Known and accepted: FU-7. A Windows path that differs only in case (other than the drive letter) hashes to a different `workspace.<hash>` key. The handler's exact comparison (:2410) refuses a case-different request, but does not unify the keys.

### Restored source file (option 1)

- `skillSynthesis:restoreQuarantinedAgent` (`skills-synthesis-rpc.handlers.ts:1566-1588`) takes its root from `quarantineWorkspaceRoot()` (`resolveHarnessWorkspaceRoot(agentScope())`, :2369-2371), never from the webview.
- The mirror then:
  - computes `quarantineLocation(workspaceRoot)` (`user-layer-mirror.service.ts:419-433`);
  - refuses a non-absolute root;
  - sets `agentSourceDir = join(workspaceRoot, '.claude', 'agents')`.
- The write happens in `user-layer-seed-quarantine.ts`:
  - The slug is validated before any join (:780-786).
  - `dest = join(agentSourceDir, '<slug>.md')` (:800).
  - The snapshot bytes are written to `.<slug>.md.ptah-restore-<hex>.tmp` with `wx` and verified, then placed exclusively by `placeExclusive` (:907): a hard link, falling back to a `COPYFILE_EXCL` copy.
  - A published `dest` is never unlinked (B-FIX-2). A changed or partial `dest` returns `conflict` and names the snapshot (:915-928).
  - An existing different file is a `conflict` and is left untouched (:844-866).
  - `logger.info` records the slug, outcome and path (:787-792).
- Runtime reader: the same `<harnessRoot>/.claude/agents` is the mirror's agent source (`user-layer-mirror.service.ts:432`, read at :1391/:2007). The next mirror or reconcile pass clones it into the scoped user layer. The listing reports `source-restored` until the scoped clone exists (:737-753).
- Side effects: the response reports `agentSync` read-only (`readAgentSync`, :2378-2393). Nothing grants consent. The UI runs `harness:reconcile` only when the gate is enabled or unknown, after the guard.

## Check 4 - Open follow-ups (one line each)

| ID | Item | Severity / owner |
| --- | --- | --- |
| FU-1 | Claude target (`claude-target.ts:381`) and MCP fragments (`mcp-facet-planner.ts:184`) overwrite a hand-edited owned copy with no `.history` snapshot. Extend the snapshot-then-write rule, and widen the guard sentence and the `localEdit` doc. | Moderate; next harness-sync task |
| FU-2 | Move the generation preview helpers out of `wizard-generation-rpc.handlers.ts`, now 1112 lines against max-lines 700, into `wizard-generation.preview.ts`. | Maintainability; recorded "before the PR merges" |
| FU-3 | (remaining) Split the Agents-tab harness wiring out of `skill-clones-view.component.ts` (967 lines), and add the view-level wiring spec: `getAgentModels` mock, `modelGuard` only on the desktop Agents tab, models reloaded on Refresh and tab entry. `AgentModelsStore` extraction is done in `7dca3b7cc`. | Maintainability and test gap; recorded "before the PR merges" |
| FU-4 | Agent model on `HarnessPlanWrite`. | CLOSED `6d9dcba5e` |
| FU-5 | A-FIX-3 residual: a transient failure in the hash read only, with a sentinel-bearing recorded hash, can still delete a retired tree (`artifact-retirement.ts` hash read vs readability read). Fix: a strict retirement digest. | Blocking-class but narrow; user-accepted, disclose at Gate 3 |
| FU-6 | Visual moderates: the model section makes cards about 2.5x taller and pushes actions below the fold; badges wrap in 2-column cards; the edit form is cramped. The editor's own `text-warning` messages (`agent-model-guard-failed`, `sync-failed`) are still about 2.4:1 in light (bfix3-executor-report.md:141). | Moderate UX/a11y |
| FU-7 | Windows path case splits the `workspace.<hash>` key (needs a rehash migration). Model-read failures are silent in `plugin-config-source-resolver.ts:283` (no logger) and in the registration paths. | Moderate; separate task |
| FU-8 | `wizard:preview-generation` labels a foreign (not-owned) existing copy as "overwrite". | Moderate |
| FU-9 | Wizard `onConfirmPreview` re-preview has no guard against the component being destroyed. | Moderate |
| FU-10 | (new, this report) The Claude override reads the wizard's raw folder key, while the editor saves under the harness-root key (Check 3). | Low |
| Note R-1 | partb-recheck.md:24: untouched copy plus unwritable history has no dedicated regression. The B-FIX-1 fail-safe trade-off (the update fails and is retried) is covered only by the rename-failure spec. | Minor, test gap |
| Note R-2 | B-5g: the 15 s CLI model-list timeout path (`AGENT_MODEL_LIST_TIMEOUT_MS`, `skills-synthesis-rpc.handlers.ts:279`, `:2459`, giving `lists = null`) has no spec. | Minor, test gap |
| Note R-3 | `skills-synthesis-rpc.handlers.ts` is 3137 lines (was 2762). The agent-model methods (~380 lines) are the natural extraction. | Maintainability |
| Note R-4 | B-6 note (3): the unlisted confirmation is inline rather than a modal, and the in-row Sync does not emit to the view. | Minor, by design |
| Note R-5 | Visual minors: mixed filled and plain chips; a disabled Cursor "Edit" pill in light looks like a filled button. | Minor |

## Validation risk / resolution (Part B)

| Risk | Resolution |
| --- | --- |
| PR1: `workspace-target.ts` growth | Additions kept minimal; FU-4 moved the model onto `HarnessPlanWrite`. The pre-existing max-lines warning remains. |
| PR2 / PR7: snapshot before overwrite; guard wording | Workspace targets snapshot by detach-then-exclusive-publish (B-FIX-1, re-check FIXED). The Claude target and MCP fragments remain open as FU-1, and the guard wording is per-target accurate. |
| Restore never deletes user files | B-FIX-2: a published `dest` is never unlinked (re-check FIXED). |
| Model saved to the wrong workspace | Server-side exact-root check before and after the list read. The UI ticket, epoch and revision drop stale replies (B-FIX-3, re-check FIXED). FU-7 and FU-10 remain. |
| Guard approves after teardown | Per-call `approved | cancelled | unverified` outcome (B-FIX-3, re-check FIXED). |
| AC8: hosts without the factory are byte-identical | B-5d and B-5f1 specs (batches.md:1069, :1098). |
| Light-theme contrast on new modals | Fixed in code (`7dca3b7cc`). Rendered evidence is pending the re-capture (Check 1). |

## Recommended QA for Gate 3

1. **Recommended: visual re-capture (visual-reviewer), 6 modal screenshots, light + dark, with computed-style contrast.** This is the only unevidenced fix of a Serious finding, and it is cheap.
2. Optional: senior-tester for R-1 and R-2, plus the FU-3 view wiring spec. These are test-only gaps on paths the re-check reasoned about but did not execute.
3. Not recommended: another logic review. Part B was re-checked 9/10 with no new findings, and Part A's residual is user-accepted (FU-5).
4. Gate 3 should decide FU-2 and FU-3 (both recorded "before the PR merges"), either now or as named follow-ups. It should also disclose FU-5 and FU-10 in the PR description.
