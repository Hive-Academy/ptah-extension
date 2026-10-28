# Requirements review — TASK_2026_701_9e4b

## Verdict

APPROVED

## Round 2 re-review

Verdict: APPROVED

Gate 1 requirements review: **0 Blocking, 0 Serious, 0 Moderate outstanding findings in this round**. R1 and R2 satisfy their requested changes. The Round 1 and original reviews below are historical; their verdicts, counts and earlier requirements line numbers do not describe the current revision.

Scope: only Round 1 findings R1/R2, updated PM1, new PM14, and contradictions introduced by those edits. Paths without a directory prefix refer to this task folder. This approves the revised requirements, not an implementation.

### R1/R2 status

| Finding | Status | Section / criterion evidence and assessment |
| --- | --- | --- |
| R1 — Serious: user-edited managed files outside the plugin guard | **Fixed** | Requirement 8's local-item definition includes managed paths whose bytes differ from Ptah's last recorded write, distinguishes unmodified managed artifacts, includes rival targets and destinations outside the clone store, and limits PM1's exclusion to item 1 (`task-description.md:390-406`). Criteria 8.5/5b require default keep, reporting and an explicit replacement route for edited owned content; unowned-path refusal alone is expressly insufficient (:408-424). New 8.5f requires per-family edited-managed-file fixtures for external plugins, community skills, Ptah plugin enable and the plugin-agent mirror, a rival-target fixture, byte-identical preservation and an unmodified-propagation control (:425-433). The data-safety NFR (:499-506), risk (:536), PM14 (:557) and parity row (`parity-inventory.md:102`) carry the same protection. This satisfies every part of R1's Exact change. |
| R2 — Moderate: pack subfolder/Library contradiction | **Fixed** | Criteria 3.2 and 3.3 now qualify Library membership and live refresh by the harness-root target (`task-description.md:218-228`). New 3.2a preserves files at the explicit subfolder target, requires the host-appropriate warning, forbids a Library-membership promise and requires a test (:221-225), matching the four host/target cases in 2.6 (:196-205). The pack-target parity row preserves this alternative (`parity-inventory.md:61`). This satisfies R2's Exact change without removing the subfolder capability. |

### Decisions review

| Decision | Judgment | Evidence, options and scope |
| --- | --- | --- |
| PM1 (updated) | **Agree** | The choice remains Claude-source-only versus every wizard-derived copy for item 1; the revision expressly prevents that choice from excluding owned-but-edited rival copies from item 8 (`task-description.md:544`, :401-406, :425-433). This respects the distinction between the user's wizard-source request (`context.md:25-29`) and plugin local-file guard (:46-50). It is a reversible lane-proposed implementation boundary, not a new user decision or an item 8 scope reduction. |
| PM14 (new) | **Agree** | Protecting edited managed content instead of retaining automatic rewrite/report follows the user's plugin guard (`context.md:48-49`). The cited manifest distinguishes the recorded destination hash from the transformed source hash and identifies hand-edited copies (`libs/backend/harness-sync/src/lib/manifest-store/managed-manifest.ts:41-54`). PM14 and 8.5f use the last recorded write, preserving ordinary propagation for unmodified artifacts (`task-description.md:425-433`, :557). This is a reversible lane-proposed safety rule implementing a user-requested outcome; it neither removes replacement nor requires an additional user decision. |

### Contradiction and failure checks

No new finding in the scoped edits. The five logic questions were checked as requirements obligations:

1. **Silent failure:** edited managed destinations must stay byte-identical and be reported as kept; ownership alone cannot authorize an overwrite (8.5b/5f, `task-description.md:415-433`).
2. **Unexpected user action:** choosing a subfolder for a pack preserves that target and discloses its visibility limits on both hosts (3.2a, :221-225); installing or enabling after editing a managed copy requires explicit replacement (8.5/5f, :408-433).
3. **Wrong-answer input:** comparing a transformed rival copy with its source hash could misclassify edits. The new contract compares current bytes with the last recorded destination write (:394-400, :425-433), consistent with `managed-manifest.ts:41-54`.
4. **Dependency failure or stale data:** unreadable local content stays kept and changed-after-plan content requires re-approval (8.5c/5e, :434-443). The expanded local-item definition makes these existing safeguards apply to edited managed destinations too.
5. **Previously unspecified case:** owned-but-edited files outside the clone store now have explicit protection and per-family fixtures (:401-405, :425-433); explicit subfolder pack installs now have a host-specific acceptance case (:221-228).

Verification: checked the revised criteria, NFR, risk, PM1/PM14, R1/R2 response rows (`task-description.md:598-603`) and affected parity rows against the two Exact changes. Rechecked the manifest hash/policy citation at `managed-manifest.ts:41-54`. No build, test, lint, serve or e2e command ran. Implementation mechanisms and execution of the required fixtures remain for implementation/testing gates; settled findings were not reopened.

## Round 1 re-review

Verdict: REVISE

Gate 1 remains open: **0 Blocking, 1 Serious, 1 Moderate outstanding findings**. Eight of the original ten findings are fixed; findings 1 and 5 are partially fixed. The original review below is retained as historical evidence; its counts, score and old requirements line numbers do not describe this revision.

Review scope: the ten responses at `task-description.md:546-563`, the changed acceptance criteria, PM1/PM3/PM6 and PM10–PM13, and preservation consistency in `parity-inventory.md`. No settled item is reopened except where the revision supplies new evidence of a remaining defect. Paths without a directory prefix refer to this task folder.

### Per-finding status

| Original finding | Status | Current evidence and assessment |
| --- | --- | --- |
| 1 — plugin overwrite coverage (Serious) | **Not fixed — partial** | Req 8 family/action table and 8.5–5e now cover alternate entry points, cancellation, unreadable content, clone rebase and changed content (`task-description.md:356-415`). However, the new definition at :384-389 restricts local files to those Ptah cannot prove it wrote. Criterion 8.5b repeats that restriction (:398-405). User edits to an owned destination remain outside this guard; see R1. |
| 2 — primary failures treated as refresh failures (Serious) | **Fixed** | Req 8.10 expressly returns primary failure, retains cleanup/error/retry and forbids success reporting; 8.10a limits non-fatal refresh to a successful primary operation (:441-453). Req 1.13 and 3.7 carry the same distinction into wizard/pack outcomes (:166-168,233-238). Failed write, removal and refresh have separate required tests. |
| 3 — orphan/agreement contradiction (Moderate) | **Fixed** | Req 8.8 distinguishes active and shadowed entries; 8.8b retains edited orphaned clones, their former plugin label and an explicit exception to active agreement (:425-435). Req 8.7 addresses duplicate slugs (:418-421). |
| 4 — incomplete live refresh (Moderate) | **Fixed** | The family/action matrix plus req 8.2/2a/2b covers applicable install/remove/toggle actions, an already-open Library and stale workspace replies (:356-373). Req 8.8 explicitly includes community-skill rows (:425-431); the toggle-refresh risk is acknowledged at :503. |
| 5 — host/target contradictions (Moderate) | **Not fixed — partial** | Req 2.6 establishes all four host/target cases (:196-205); 3.1 excludes explicit subfolders (:214-217); 5.1 gives truthful model-origin wording for each host (:282-286). Req 3.2 still unconditionally promises Library visibility for pack installs (:218-219), although packs share the explicit subfolder choice. See R2. |
| 6 — rubric permission gating (Moderate) | **Fixed** | Req 6.2 now requires relevance AND permission/ability; 6.3 includes this rule in the agreement test; 6.6 supplies the unknown-capability fallback and 6.7 a disallowed-capability case (:314-330). |
| 7 — incomplete parity preservation (Moderate) | **Fixed** | Req 1.14 preserves source status/model selection/backend warnings (:169-172); inventory :46-47,54 names them. Req 8.12 (:457-463) and inventory :87-92 retain upgrade disclosure, re-approval explanation, text-only commands, env names only, no MCP execution, busy/error/cancel behavior and focused regression coverage. |
| 8 — stale decisions and fallback ambiguity (Moderate) | **Fixed** | Req 1.5 rejects unconfirmed replacement while 1.6 explicitly admits create-only fallback (:135-143). Req 1.12 covers appeared/changed targets at write time, resume, retry and packs (:158-165); req 8.5e adds plan re-approval (:413-415). PM10 correctly labels this safety elaboration as lane-proposed (:521). Its protection must also apply to the files omitted by R1. |
| 9 — inaccurate citations (Minor) | **Fixed** | The dialog label is now :64-65 (`task-description.md:25`); inventory :34 cites the resume condition at handler :480 and :74 locates action errors at component :180-187, matching the original spot checks. PM1 now cites the managed manifest and reconciler separately (:512), rather than claiming the propagation comment establishes ownership. The ownership source does not establish protection of edited owned files; that is R1, not another citation typo. |
| 10 — false legacy/kept provenance (Moderate) | **Fixed** | Req 3.4/3.9–11 assigns unknown/legacy origins to Workspace file, records wizard origin only on actual writes, retains prior origin for kept/unchanged files, and requires legacy and kept-pack fixtures (:223-249). Req 3.5 preserves known wizard origin after hand edits (:228-229). |

### Outstanding findings

1. **R1 — Serious — an owned file with user edits falls outside the revised plugin guard.**  
   **Evidence:** `context.md:48-49` requires the item 1 guard whenever a plugin file replaces a differing local file; it does not exempt user edits to previously managed files. The revision defines a local item using ownership at `task-description.md:384-389`, then applies the no-consent keep/refusal rule only to items Ptah does not own at :398-405. The data-safety NFR explicitly repeats the ownership exclusion for local skills/commands at :471-475. Ownership is not proof that current bytes are unedited: `libs/backend/harness-sync/src/lib/manifest-store/managed-manifest.ts:41-54` records the hash of what Ptah wrote and explicitly distinguishes a hand-edited managed copy, whose documented existing policy is “rewrite and report it.” Inventory :101 preserves refusal of *unowned* files only.  
   **Failure/impact:** a Marketplace action that propagates a plugin update to a previously managed local skill/command or rival target can follow the existing ownership policy and overwrite a user's later edit without a keep/replace decision while satisfying these narrowed criteria. This is a requirements gap demonstrated by the new ownership rationale, not a claim that a new implementation has already shipped. It is the unresolved part of original finding 1.  
   **Exact change:** define protected local content to include user-modified files even when their path remains in Ptah's managed manifest. Distinguish an unmodified managed artifact (eligible for ordinary propagation) from an owned artifact whose current bytes differ from Ptah's last recorded write. Require default keep and an explicit replacement route for the latter across all scoped installer families, including destinations outside the Library clone store; add a per-family managed-file-edited-after-install fixture and cover it in the parity row/NFR. Do not rely on the unowned-path repair API alone to prove this case is protected. Preserve PM1's wizard-derived-copy exclusion only within item 1; it must not narrow item 8.

2. **R2 — Moderate — pack installs retain the subfolder/Library contradiction.**  
   **Evidence:** `task-description.md:176-190` gives wizard and pack output the harness-root default plus an explicit subfolder alternative. Req 2.6 (:200-205) says that Electron/subfolder output is not listed in Library. Req 3.1 explicitly exempts subfolder wizard runs (:214-217), but req 3.2 (:218-219) promises Library visibility whenever a pack install completes, and 3.3 (:220-222) inherits that promise. Inventory :61,108-110 preserves the target choice.  
   **Failure/impact:** a user selecting the permitted subfolder target for a pack cannot obtain both the required non-Library result and the unqualified Library visibility promised by 3.2. This is the remaining portion of original finding 5, not a request to remove the target choice.  
   **Exact change:** qualify req 3.2 and its live-refresh implication in 3.3 by the harness-root target, matching 3.1/2.6. Add an explicit subfolder-pack acceptance case that preserves the files there, shows the host-appropriate warning and does not promise Library membership.

### Changed decisions review

All seven PM choices below are **lane-proposed**, implementing user outcomes or preservation constraints. D3 is the user decision; Electron-first/scoped verification remain project rules. No new user permission is needed to correct R1/R2 while preserving scope.

| Decision | Judgment | Evidence / limits |
| --- | --- | --- |
| PM1 (updated) | **Agree for item 1; do not use it to narrow item 8.** | `context.md:25-29` names Claude source files. The revised decision expressly preserves item 8 scope (`task-description.md:512`). Manifest ownership supports derived-file management, but is not a safety guarantee for a user-edited managed copy (`managed-manifest.ts:41-54`). R1 repairs the inconsistency between that scope promise and req 8's new definition. |
| PM3 (updated) | **Agree.** | Create-only fallback preserves the existing no-preview capability and U1 default keep; an unconfirmed replace request is rejected, not silently downgraded (req 1.5/1.6, :135-143; decision :514). This is a reversible implementation choice. |
| PM6 (updated) | **Agree.** | The decision at :517 explicitly identifies host copy as a lane interpretation of D3 and retains model-origin disclosure in VS Code (req 2.6 and 5.1). It does not remove the shared model capability or add a VS Code Library. |
| PM10 (new) | **Agree.** | Keeping appeared/changed content instead of trusting stale consent implements default keep (req 1.12/8.5e; :521). Comparison mechanism remains the architect's choice; the acceptance result is content-based. |
| PM11 (new) | **Agree.** | Unknown permission data does not authorize capability instructions; the fallback applies to generated references, not disabling installed skills (req 6.6/6.7; :326-330,522). This is a defensible, reversible interpretation of rubric 8. |
| PM12 (new) | **Agree.** | Req 8.5d (:408-412) requires explicit replace consent and routes it through the existing rebase flow after successful installation, retaining clone history and divergence handling. Keep preserves the clone. The choice at :523 authorizes no direct overwrite or removal of the existing rebase capability. |
| PM13 (new) | **Agree.** | A community skill source label makes the item 8 agreement rule observable (req 8.4, :377-380; decision :524) and preserves the source distinction already inventoried at `parity-inventory.md:72,76`. This elaborates provenance rather than removing plugin/pack labels. |

### Parity and logic checks

The previously omitted controls and consent guarantees are explicitly retained at `parity-inventory.md:46-47,54,87-92`. The new rows preserve primary failure behavior (:97-99), toggle refresh (:100), repair (:102) and edited orphan state (:103). No additional silent removal was identified in the reviewed rows. However, the new unowned-path row (:101) is insufficient for R1, and the retained subfolder choice (:61,108-110) exposes R2.

1. **Silent failure:** primary operation errors now remain errors (req 8.10); the remaining success-looking risk is a plugin operation overwriting a managed local edit under the ownership exclusion (R1).
2. **Unexpected user action:** choosing the explicit subfolder target for a pack conflicts with the Library success promise (R2).
3. **Wrong answer from input data:** a manifest-owned path with locally changed bytes is treated differently from an unowned local edit despite both containing user changes (R1). Unknown/legacy provenance is now specified (req 3.9–11).
4. **Dependency failure/timeout/malformed response:** the revised criteria distinguish primary failure from downstream refresh failure and require error visibility (req 8.10/10a,3.7). Workspace-stale replies are discarded (8.2b). No new timeout or payload handling implementation was evaluated.
5. **Missing case:** the per-family guard tests must include a modified *owned* destination, not only a foreign path or an edited clone. The subfolder-pack result also needs a direct acceptance case.

### Verification, decisions and limits

Decision: preserve the original review as history and make this section authoritative for round 1, rather than rewriting old evidence as if it had been gathered against this revision. Reversible: yes. Decision: retain the requested protection and target choice in R1/R2 rather than seek permission to remove either. Evidence: `context.md:25-32,46-50`.

Reviewed the revised requirements and parity inventory, original findings, context and D3. Used targeted AST inspection of the newly cited manifest/reconciler/repair files and free-text source evidence for ownership versus edited content. The original citation corrections were compared with the prior recorded spot checks; this round does not repeat an independent whole-source or eight-citation audit. Runtime correctness, full rebase behavior and every installer destination remain architecture/implementation checks. No source was edited and no git/build/test/lint/serve/e2e command was run. Only this review deliverable was updated.

## Original Gate 1 review (historical)

The following findings, score, tables and citations describe the pre-revision document. Their resolution is recorded in the round 1 table above.


Gate 1 document review: 0 Blocking, 2 Serious, 7 Moderate, 1 Minor findings. Approval is withheld because findings 1–2 permit loss of requested protection or misleading failure handling. This is not an implementation verdict.

Score: 5/10. All eight requested topics have numbered acceptance criteria, which separates this from a foundationally wrong requirements document. Contradictory outcomes and incomplete coverage of destructive paths prevent the 7–8 band. Evidence follows; no finding is inferred merely from the score.

Paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment`. Task documents without a directory prefix are in `.ptah/specs/TASK_2026_701_9e4b/`.

## Findings

1. **Serious — item 8's overwrite guard is narrower than the requested install flow.**  
   **Evidence:** `context.md:46-50` requires the guard when a plugin file replaces a differing local file. `task-description.md:296-298` includes external plugins, community skills and Ptah plugins, including enable/disable. But its only actionable collision/decision criterion, `task-description.md:309-314`, is conditional on the external consent dialog being shown and defines local files as workspace agent files or edited Library clones. It gives no equivalent protection contract for the other entry points, and no explicit replace outcome. `libs/frontend/marketplace/src/lib/external-consent-dialog.component.ts:22-29` confirms this is specifically the external-plugin two-call flow, not a universal install surface.  
   **Impact:** an implementation can satisfy 8.5 while another installation or activation path overwrites local work. Local skill files are also omitted from the definition without evidence that they cannot be replacement destinations.  
   **Exact change requested:** make the default-keep decision and enforcement contract apply to every scoped install/update/enable path that can replace a local file, regardless of which UI is used. Enumerate the actual collision destinations during architecture; do not exclude local skill files by definition. Specify keep, explicit replace, cancellation, unreadable-file and no-decision outcomes, with a criterion for each installer family. If a path provably cannot replace local content, document that invariant and verify it. Keep/replace for edited clones must also say whether replacement bypasses or invokes the existing rebase flow.

2. **Serious — non-fatal refresh is expanded to failed installs and removals.**  
   **Evidence:** `task-description.md:325-327` groups “install, uninstall or refresh fails partway” under a non-fatal contract and says the next pass heals the Library. The existing installer instead rethrows a failed write after cleanup at `libs/backend/plugin-marketplace/src/lib/install/external-plugin-installer.service.ts:276-296`; uninstall awaits filesystem removal and record removal at `:353-354`. The consent UI retains a visible second-call error at `libs/frontend/marketplace/src/lib/external-consent-dialog.component.ts:289-292,340-343`.  
   **Impact:** a disk-full install or failed removal could be presented as a completed install with a deferred refresh problem. Catalog reconciliation cannot reconstruct payload bytes that never installed.  
   **Exact change requested:** split 8.10 into primary-operation failure and post-operation mirror/catalog failure. Preserve the actual install/uninstall error, existing cleanup and retry/consent behavior, and prohibit a success report for an unsuccessful primary operation. Only a successfully completed primary operation may retain its success while a downstream refresh fails. Specify what the UI reports in both cases and test failed write, failed removal and failed refresh separately. No requirement to redesign installer transactions is implied.

3. **Moderate — orphan preservation contradicts the cross-view agreement invariant.**  
   **Evidence:** `task-description.md:299-302` explicitly retains edited clones as orphaned after uninstall. `:318-322` then forbids any plugin-provenance Library entry whose plugin is missing from Marketplace. An orphan from an uninstalled plugin necessarily has that historical origin.  
   **Impact:** satisfying the absolute agreement rule may delete an edited clone or erase its provenance; retaining it violates the rule.  
   **Exact change requested:** define agreement for installed/enabled/active items separately from historical orphaned clones. Require preserved edited clones to remain labelled with their former plugin and orphaned/not-installed state, and exclude them explicitly from the active-install invariant. Include uninstall-with-edits and duplicate-slug/shadowed cases. Do not resolve this by deleting the capability.

4. **Moderate — Marketplace refresh does not have a complete observable acceptance contract.**  
   **Evidence:** `context.md:48-50` requires refresh after install and removal and agreement between views. `task-description.md:178-185` covers an already-open Library only for wizard runs and packs. `:296-302` includes enable/disable in root resolution but only install/uninstall in the refresh criterion; `:318-322` checks agreement only “after a refresh.” `parity-inventory.md:73` promises Library refresh on Marketplace removal.  
   **Impact:** the backend catalog can update while an open Library remains stale, or a toggle can leave stale active entries, yet the written criteria pass after manual refresh.  
   **Exact change requested:** add a matrix covering external plugins, community skills and Ptah plugins across install/remove and applicable enable/disable actions. Require an already-open Electron Library to update without manual refresh, with workspace-switch responses discarded. Explicitly include community-skill rows in the agreement criterion rather than quantifying only plugin rows.

5. **Moderate — host and target exceptions conflict with unconditional criteria.**  
   **Evidence:** `task-description.md:162-165` permits a subfolder target and says those agents do not appear in Library; `:178-180` unconditionally requires every generated agent to appear after an Electron run. `:198-199` prohibits naming Library in VS Code, but `:162-165` mandates a Library warning and `:232-234` mandates “from your Library setting” with no host qualification. D3 at `decisions.md:7` settles Library availability, not contradictory copy requirements.  
   **Impact:** a valid subfolder run fails the refresh criterion; a shared preview cannot satisfy all required VS Code wording simultaneously.  
   **Exact change requested:** qualify Library visibility criteria by the chosen harness-root target. Add a host/target behavior table: Electron/harness-root, Electron/explicit subfolder, VS Code/harness-root and VS Code/explicit subfolder. Keep model value/origin disclosure in VS Code using truthful shared-setting terminology; apply Library-specific wording only where it exists. Label the no-Library-copy rule as the lane's implementation of D3, not the user's verbatim decision.

6. **Moderate — rubric rule 8 is weakened from permission gating to relevance.**  
   **Evidence:** `task-description.md:262-263` maps rubric 8 to references “relevant to the agent's role.” The actual rule says an agent only receives capabilities it may use and must not load instructions it cannot invoke: `.claude/skills/skill-creator/references/prompt-authoring-rubric.md:50-53`. Relevance does not imply permission or availability.  
   **Impact:** a prompt may recommend a relevant skill that the receiving role cannot invoke while passing requirement 6.2.  
   **Exact change requested:** require both role relevance and permitted/available capabilities; specify behavior when capability information is unavailable, and add a representative disallowed-capability case. PM5 may keep a static prompt plus drift test, but the agreement test must cover the actual rule, not the weaker paraphrase.

7. **Moderate — the parity inventory does not explicitly preserve several live controls and consent guarantees.**  
   **Evidence:** `parity-inventory.md:43-54` omits the sidebar generation-model picker and source-status display, mounted at `libs/frontend/setup-wizard/src/lib/components/agent-selection-list.component.ts:42-51`. Its dialog rows `parity-inventory.md:48-52` omit the backend warning rendered at `agent-preview-dialog.component.ts:54-55`. The broad consent row `parity-inventory.md:81` does not identify upgrade/version disclosure, approval-expired explanation, exact MCP command rendering with environment names only, or busy/error/cancel behavior. These exist at `libs/frontend/marketplace/src/lib/external-consent-dialog.component.ts:91-99,117-126,214-232,289-317,345-348`.  
   **Impact:** “keep files/scripts/MCP servers” can be implemented while removing the re-approval explanation, leaking environment values, changing command text, losing cancellation semantics, or dropping adjacent controls. No actual removal has yet occurred; the preservation contract is incomplete.  
   **Exact change requested:** add explicit keep rows and focused regression criteria for these capabilities. Preserve verbatim text interpolation for untrusted command lines, environment names without values, no automatic MCP execution, rejected-approval explanation, busy protection, visible install error, and cancel emitting no install request. Preserve model selection/source status and backend warnings on both live preview surfaces. These are existing capabilities, not new feature requests.

8. **Moderate — the confirmed-preview contract leaves stale content and the safe fallback ambiguous.**  
   **Evidence:** `task-description.md:128-136` rejects a call that skips preview but also permits “Generate without preview”; it binds decisions, not the observed file contents. `parity-inventory.md:31` adds target root to the signature, but says nothing about a file created or edited after preview. Current preview only uses `lstat`, not bytes, at `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts:1223-1243`; the existing gate is tab-bound at `:480-501`.  
   **Impact:** a previously missing target can become a user-authored file before writing, or a replace decision can apply to a newer edit; the desired safety behavior is unspecified. The no-preview button can also be implemented as either always rejected or an unrestricted bypass.  
   **Exact change requested:** distinguish an explicit create-only/default-keep fallback from an unconfirmed replacement request. Add acceptance cases for a target appearing or changing between preview and write, including retry/resume and pack/plugin install. Require revalidation or keep/reconfirmation before overwriting newly changed content. Leave hashing/locking implementation to the architect. Tag this as a lane-proposed safety elaboration of U1, not an extra user decision.

9. **Minor — several citations are wrong or too narrow to support their claim.**  
   **Evidence:** `task-description.md:25` cites `agent-preview-dialog.component.ts:62-64` for the overwrite label, but the label is at `:64-65`. `parity-inventory.md:69` cites `installed-skills-page.component.ts:126-135` for inline action errors; those lines are search-box markup, and the error is at `:180-187`. `parity-inventory.md:32` locates `!resume` at wizard handler line 479; it is line 480. PM1's comment citation, `task-description.md:374`, explains mirror/reconcile at handler lines 1762-1768 but does not demonstrate manifest ownership.  
   **Exact change requested:** correct these citations and add the actual reconciler/manifest evidence for PM1 if retaining that rationale. The citation table records checked and unverified claims separately.

10. **Moderate — legacy and kept-file provenance have no truthful fallback criterion.**  
    **Evidence:** `task-description.md:186-191` requires Setup wizard provenance for generated files. Its risk row at `:366` says requirement 3.4 provides a fallback for agents generated before markers existed; 3.4 does not state that exception. `:178-180` also calls items generated even when the source was kept.  
    **Impact:** an old generated file with no provenance marker cannot reliably be distinguished from a hand-written one; selecting and keeping a pack/user file must not relabel it as wizard output.  
    **Exact change requested:** add explicit unknown/legacy provenance fallback to Workspace file, record wizard origin only after an actual wizard write, retain prior origin on keep/unchanged outcomes, and preserve known wizard origin after hand edits. Test a legacy unmarked file and a pack-authored file kept during generation.

## Scope coverage

| Context item | Requirements coverage | Review result |
| --- | --- | --- |
| 1. Default-keep source guard, including packs (`context.md:25-29`) | 1.1–1.11, both preview and pack surfaces, VS Code included | Present; clarify stale-content and fallback contract (8). Default keep and pack coverage are not dropped. |
| 2. Root alignment (`:30-32`) | 2.1–2.5, pack default included | Present; reconcile explicit subfolder exception (5). |
| 3. Refresh/provenance/empty state (`:33-36`) | 3.1–3.8 | Present; qualify root and provenance fallback (5, 10). |
| 4. Clone edits/regeneration (`:37-39`) | 4.1–4.6 | Preserves edited body and divergence; mirror check supports this. Plugin orphan agreement still conflicts (3). |
| 5. Shared model setting (`:40-41`) | 5.1–5.5 | Explicit shared choice is authorized; fix host wording (5). |
| 6. Prompt rubric (`:42-43`) | 6.1–6.5 | Partial semantic alignment; rule 8 is weaker (6). |
| 7. Grade expectations (`:44-45`) | 7.1–7.3, both completion surfaces | Covered; Electron-only copy is a defensible lane interpretation of D3. |
| 8. Marketplace harmony (`:46-55`) | 8.1–8.11 | All headings present, but guard, failures, orphan agreement and refresh need changes (1–4). |

## Citation check

Checked against the current worktree, not the historical research snapshot. The table contains 15 spot checks. Broad code correctness is not certified.

| Document citation / claim | Actual current evidence | Result |
| --- | --- | --- |
| Requirements :24, wizard overwrite badge | `libs/frontend/setup-wizard/src/lib/components/agent-selection.component.ts:549-552` | Correct. |
| Requirements :25, sidebar overwrite badge at :62-64 | `libs/frontend/setup-wizard/src/lib/components/agent-preview-dialog.component.ts:62-65` | Range cuts off the actual label; use :64-65. |
| Requirements :130, preview-required gate | `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts:480-501` | Correct with tab-bound/non-resume qualification. |
| Requirements :31/:165, subfolder mismatch | Same handler `:1123-1131` | Correct; root comparison and warning present. |
| Inventory :26, existence-only overwrite flag | Same handler `:1223-1243` | Correct; lstat success sets true, all errors set false. |
| Inventory :32, !resume at :479 | Same handler `:480` | Wrong line; :479 is a closing brace. |
| Requirements :374, rival manifest ownership | Same handler `:1762-1768` | Partially supported: mirror/reconcile documented; manifest ownership not established here. |
| Requirements :39/:305, no plugin-agent mirror | `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts:363-373` | Correct; plugin skills and commands only. |
| Requirements :211, retain edits on source change | Same mirror `:1676-1696` | Correct for the cited reconciliation branch; edited clone is marked diverged. |
| Inventory :42, solid warning-fill contrast | `libs/frontend/setup-wizard/src/lib/components/agent-selection.component.ts:497-499,514-526` | Correct comment and classes; contrast measurements not remeasured. |
| Inventory :52, focus/keyboard behavior | `libs/frontend/setup-wizard/src/lib/components/agent-preview-dialog.component.ts:109-144` | Correct; current trap enumerates buttons only, so new controls need integration. |
| Inventory :45, stale preview reply discarded | `libs/frontend/setup-wizard/src/lib/components/agent-selection-list.component.ts:307-344` | Correct; sequence guard and preview-required reopening present. |
| Inventory :69, action error at :126-135 | `libs/frontend/marketplace/src/lib/pages/skills/installed-skills-page.component.ts:180-187` | Wrong location; :126-135 is search markup. |
| Inventory :82, shadowed-skills disclosure | `libs/frontend/marketplace/src/lib/external-consent-dialog.component.ts:261-287` | Correct. |
| Inventory :86, reinstall removes previous tree | `libs/backend/plugin-marketplace/src/lib/install/external-plugin-installer.service.ts:272-296` | Correct; tree removal precedes writes, write failure is rethrown after cleanup. |

## Decisions review

All PM decisions are **lane-proposed**, even when they implement a user-requested outcome. D3 itself is **user-requested/user-decided**. Agreement below does not certify uncited code outside the checked paths.

| Decision | Agree/disagree and evidence |
| --- | --- |
| PM1 | **Agree with scope; disagree with the strength of the cited rationale.** U1 explicitly names `.claude/agents/<id>.md` (`context.md:25-29`), so excluding rival derived copies does not itself narrow that request. Handler `:1762-1768` supports propagation but not manifest ownership. Do not extend this exclusion to item 8's local plugin-file collisions. Preserve existing rival protections; no authorization to remove them is inferred. |
| PM2 | **Agree.** Harness-root default plus explicit subfolder choice satisfies `context.md:30-32` while preserving the existing target option. Current mismatch is confirmed at wizard handler `:1123-1131`. Fix contradictory visibility/copy criteria (5). |
| PM3 | **Agree.** Keeping existing content without replacement consent follows U1's default keep (`context.md:25-29`). Clarify the permitted fallback versus rejection (8). |
| PM4 | **Agree.** The user explicitly allows making sharing visible instead of separating it (`context.md:40-41`). This is a reversible product choice, not removal of an authorized capability. Host wording needs correction (5). |
| PM5 | **Agree on static rules plus a drift test; disagree with the rule-8 mapping.** The user requests alignment, not runtime loading (`context.md:42-43`). Structure-specific rubric exclusions are defensible, but relevance cannot replace permission gating (`prompt-authoring-rubric.md:50-53`). A representative generation check remains appropriate; no broad template rewrite is required. |
| PM6 | **Agree as a lane interpretation, not a literal user instruction.** D3 (`decisions.md:7`) excludes VS Code Library. Avoiding grade/divergence guidance toward an unavailable UI is defensible. D3 does not itself say all shared-setting provenance must disappear; resolve the wording conflict (5). |
| PM7 | **Agree.** Plugin agents are explicit in `context.md:46-50`. Current mirror loop `:363-373` lacks them, so this is required capability work rather than scope expansion. |
| PM8 | **Agree, with transparent categorization.** `context.md:35-36,48-49` specifically requests wizard/workspace and plugin provenance, not a separate pack label. Workspace file is accurate for packs; no reviewed evidence establishes an existing pack-specific Library label being removed. Keep pack identity/status capabilities on the pack surfaces (`parity-inventory.md:53-54`). |
| PM9 | **Agree as planning metadata.** Eight separately accepted topics (`context.md:25-55`) justify reassessing effort. `task-description.md:60-64` leaves the machine-owned carrier unchanged. No source behavior or user capability changes. |

None of PM1–PM9 requires inventing a new user decision to proceed. Removing existing consent disclosure, clone preservation, or source protections would be a user-reserved/security-relevant change; the resolution here is to preserve them, not authorize removal.

## Rule provenance

| Rule | Classification and evidence |
| --- | --- |
| Per-file default keep, pack protection, root alignment, shared-setting disclosure, rubric alignment and grade expectations | **User-requested:** `context.md:25-45`. |
| Marketplace same root, install/remove refresh, plugin provenance, guard and view agreement | **User-requested:** `context.md:46-55`. |
| Desktop-only Library, no VS Code Library view, VS Code compilation and wizard guard | **User-requested/user-decided:** `decisions.md:7`. |
| Electron-first feature work and Electron-only visual review | **Project-rule:** `CLAUDE.md:26-38`. Dark/light coverage in requirements :344-346 is a **lane-proposed** verification detail. |
| Scoped verification through npm run verify; no workspace-wide checks; dependent hosts keep compiling | **Project-rule:** `CLAUDE.md:8-24,35-36,109-111`. This document review runs no tests/builds. |
| Harness-root default with optional subfolder, shared model retained, no-preview keep | **Lane-proposed** choices implementing user outcomes: PM2–PM4. |
| Three exact provenance labels, pack/legacy category, before-completion sync, RPC rejection spelling | **Lane-proposed** contract details: requirements :128-130,178-199 and PM8. Correct gaps rather than attributing these details to the user. |
| Static prompt/drift-test mechanism, exact regex/date-output test, role mapping | **Lane-proposed:** requirements :246-270 and PM5; rubric supplies the referenced authoring rules, not this test design. |
| Enable/disable coverage, shadowing equivalence, orphan exception, agent counts/names | **Lane-proposed** elaborations of item 8: requirements :296-324. Their active/installed/orphan semantics must be consistent. |
| Stale-content revalidation requested in this review | **Lane-proposed** safety elaboration of default keep, not a new user scope item. |

## Five logic questions

1. **How can failure look like success?** Requirement 8.10 can hide primary install/removal failures behind deferred healing (finding 2); logging a refresh failure alone also leaves no immediate explanation for stale Library entries.
2. **What user action produces unexpected behavior?** Uninstalling a plugin with edited clones creates an orphan that violates 8.8 (3); choosing the explicitly offered subfolder target contradicts the universal Library visibility promise (5).
3. **What input gives a wrong answer rather than an error?** An unmarked legacy generated file or a kept pack file can receive invented wizard provenance (10); a relevant but disallowed capability passes the weakened rubric criterion (6).
4. **What if a dependency fails, times out or returns an invalid shape?** Existing write errors are rethrown and consent expiry is represented explicitly; requirements must preserve both. Safe no-preview behavior must be distinguished from replacement consent (2, 7, 8). Invalid payload handling was not independently audited in this document review.
5. **What necessary case was never stated?** Content changing after confirmation, enable/disable live refresh, and the distinction between installed/active/shadowed/orphaned items (3, 4, 8).

Eight concrete failure modes considered: unguarded alternate installer, failed install masked as refresh, failed removal masked as refresh, edited orphan violating view agreement, stale open Library after a toggle, overwrite after target content changes, false provenance for kept/legacy content, and disallowed capability inclusion.

## Decisions

- Review the supplied requirements and parity inventory, without editing them or implementation. Options: requirements gate versus implementation approval. Evidence: the explicit Gate 1 assignment and named artifact. Reversible: yes.
- Treat D3 as authoritative over the older open VS Code question in `context.md:61-65`. Options: reopen visibility or apply the recorded user decision. Evidence: `decisions.md:7`. Reversible only by a later user decision.
- Recommend preserving existing orphan/consent behavior rather than resolving contradictions through removal. Options: preservation with explicit state semantics versus removal. Evidence: requirements :299-302 and current consent implementation cited above. Reversible: document wording yes; no removal authorized.

## Verification and limits

Read the task carrier, requirements, context, decisions, parity inventory, research report and root CLAUDE.md. Checked the rubric and current source excerpts using AST summaries and line-level reads; the consent component was read in full. No source was edited. No git, build, test, lint, serve or e2e commands were run.

This is a document review, not approval of partially inspected implementation files. The table records the spot-check scope; unlisted citations, every installer family's implementation, manifest collision policy, runtime refresh ordering, visual contrast measurements and test execution were not exhaustively verified. No implementation plan or test report was assumed to exist. The native source-read tool truncated two oversized read attempts; neither partial result was used as evidence, and all reported source claims use subsequent bounded reads.
