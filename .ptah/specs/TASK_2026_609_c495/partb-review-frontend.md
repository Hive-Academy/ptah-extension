# Part B Code Logic Review — frontend slice

Verdict: Changes required — lifecycle and stale-response defects, plus silent reconcile failures.
Score: 6/10

Reviewed individually with `git show`: `045293092` (B-3a), `b4f8d4b31` (B-3b), `165881e4a` (B-4), `7be71f54e` (B-6). Source remained unchanged. Locations below are workspace-relative.

Validation: inspected the requested plan sections, changed production code, selected regression cases, and the directly used HarnessHealthStore. One read-only, in-memory Node probe extracted actual TypeScript methods and reproduced findings 1, 2, 4 and the state-inference failure in 5. No files were created by that probe. No Nx suite or browser run was performed; this is not a visual or backend review.

| Checklist | Result / evidence |
| --- | --- |
| PR1: backend file size | Outside this frontend slice. |
| PR2: snapshots | Guard accurately separates non-Claude copies from Claude/MCP overwrite-only paths; filesystem guarantees outside scope. |
| PR3–PR4: exclusive restore, marker/slug validation | Backend guarantees outside scope; frontend distinguishes conflict, copy failure and missing snapshot. |
| PR5: consent | Pass: sync-disabled restore does not reconcile or enable consent; source destination and sync-off copy precede Restore. |
| PR6: preview fidelity | Frontend re-previews on confirmation and requires reconfirmation when definite paths change; selection controls are frozen while open. Actual file-set fidelity is backend scope. Lifecycle issue: finding 6. |
| PR7: fresh reconcile guard | Normal busy/read-error/null-report paths block saves and syncs; all relevant callers invoke the guard first. Destruction is not safely handled: finding 1. |
| PR8: concurrent shared-contract edits | Outside this frontend slice. |
| PR9: scoped settings | Loaded workspaceRoot is sent verbatim; backend persistence outside scope. Late replies corrupt frontend workspace state: finding 2. |
| PR10: before screenshots | Not verified; screenshot provenance outside permitted reads. |
| PA-1 / PA-2 / PA-3 | Backend injection, shared selection rule and RPC registry tests outside this slice. |
| PA-4 | Pass: existing NativeModalComponent is reused. |
| PA-5 | Frontend reloads models on workspaceRoot changes; response isolation remains defective (finding 2). Backend assumptions not revalidated. |
| Review fix 1 | Request path preserved; frontend stale-response issue remains. Backend queue/path checks outside scope. |
| Review fix 2 | Destination `.claude/agents/<slug>.md`, ownership, git visibility and retained snapshot disclosed before Restore; finish-restore and sync-disabled branches present. |
| Review fix 3 | Whole-workspace notice and all-facet localEdit grouping present; Cancel normally writes nothing. Findings 1, 3 and 5 qualify this result. |
| Review fix 4 / B-6 classification | Pass: labels use server classification/shared classifier; listCliModels feeds only datalists. Unlisted confirmation sends confirmUnlisted; unsupported rows disabled; save refusals retain prior displayed values. |
| Review fix 5 / wizard | No submission before confirmation; failure offers explicit Generate without preview. Definite-set comparison matches the accepted plan; conditional-only changes intentionally do not require reconfirmation. |
| Review fix 6 | Unreadable-record note, unknown date and no-snapshot states rendered; backend marker validation outside scope. |
| B-6 resolved design point | Isolated guard failures retain draft + Retry; mutable-store inference can instead discard it (finding 5). No save is allowed by that misclassification. |
| B-6 post-save sync | Findings 3–4: skipped reconciles and per-file failures lack the required retry notice. |
| Preserve list | Desktop gating, Refresh, tabs/filter/bulk controls, card outputs and drawer remain structurally present. Original generation body retained as confirmGenerate. Existing tests inspected selectively, not executed or exhaustively audited. |
| AI output / duplicate actions | No new innerHTML binding in reviewed components; interpolation used. Normal Save/Generate double clicks are phase/loading guarded; guard rejects re-entry. Late requests and destruction remain problematic. |

## Findings

1. **Serious — destroying the guard during its health read can still authorize a save.**
   **Location:** `libs/frontend/skill-synthesis-ui/src/lib/components/clones/reconcile-guard.ts:273`, `:288`, `:300`; caller `libs/frontend/skill-synthesis-ui/src/lib/components/clones/agent-model-editor.component.ts:761`.
   **Scenario:** Start model Save, then leave the Agents tab while fresh health is pending. Destruction calls settle(false), but there is no resolver yet. When health returns without local edits, confirm returns true and the editor continues to setAgentModel and reconcile after destruction. If edits exist, ask instead creates a promise/modal on an already destroyed component and never settles. The in-memory probe returned true after ngOnDestroy. Tabs are not locked during this read (`skill-clones-view.component.ts:226`).
   **Fix:** Track destruction/request invalidation, check it immediately after every awaited read, and return false before either auto-approval or ask. Also stop the editor's pending mutation chain when its component is destroyed. Add deferred-health tests for both edited and unedited reports.

2. **Serious — a late save response can overwrite the new workspace's model snapshot.**
   **Location:** `libs/frontend/skill-synthesis-ui/src/lib/components/clones/agent-model-editor.component.ts:204`, `:219`, `:814`.
   **Scenario:** A save for workspace A commits, its response is delayed, and the workspace changes to B. The workspace effect successfully loads B. When A's save response arrives, applySaved replaces B's machine/workspace maps with A's response while retaining B's workspaceRoot, lists and other classifications. The UI now presents A's workspace overrides as B's, and subsequent editing can copy them into B. The probe reproduced a `/B` snapshot containing A's workspace map. Similarly, a pre-save load can finish after applySaved and restore an older displayed value; loadSeq orders loads only.
   **Fix:** Capture workspace identity and a mutation/load revision for each operation; discard responses belonging to an older workspace or revision. Pass that identity into applySaved and invalidate older loads on successful writes. Bind/reject drafts across workspace changes as well. Test delayed saves and loads around a switch.

3. **Moderate — a saved model can silently miss its reconcile when another pass is running.**
   **Location:** `libs/frontend/skill-synthesis-ui/src/lib/components/clones/agent-model-editor.component.ts:817`, `:843`; dependency `libs/frontend/marketplace/src/lib/harness/harness-health.store.ts:152`.
   **Scenario:** After this save's guard succeeds, another card or surface starts a reconcile while setAgentModel is pending. That pass may have already read the old settings. The save completes, but reconcile returns immediately because a pass is active; error is still null, so reportReconcile removes the notice. Provider copies can remain on the old model indefinitely without the promised Sync retry. The possibility that the active pass sees the save is not a guarantee.
   **Fix:** Queue a fresh pass after the active pass, or return an explicit skipped/result outcome and show “Saved; provider copies not updated” with Sync. Merely joining the earlier pass does not guarantee it includes this save. This is a functional Moderate issue, not only missing copy.

4. **Moderate — per-file reconcile failures are treated as successful post-save/post-restore syncs.**
   **Location:** `libs/frontend/skill-synthesis-ui/src/lib/components/clones/agent-model-editor.component.ts:843`; `libs/frontend/skill-synthesis-ui/src/lib/components/clones/quarantined-agents-panel.component.ts:414`, `:450`.
   **Scenario:** Reconcile returns a valid health report containing writeFailed (for example, a provider agent file is read-only), with no transport error. The editor clears its notice and offers no in-row retry; Finish restore announces updated provider copies. The regular Sync handler already counts writeFailed (`skill-clones-view.component.ts:637`), proving that null store.error is insufficient. The probe produced a null model notice for an EACCES writeFailed report.
   **Fix:** Evaluate the returned health report's writeFailed entries as well as RPC errors. Show partial-failure paths/reasons and retain a retry action; avoid success wording for unfinished restore synchronization.

5. **Moderate — guard failure can be misclassified as Cancel, losing the draft and Retry.**
   **Location:** `libs/frontend/skill-synthesis-ui/src/lib/components/clones/agent-model-editor.component.ts:825`, `:838`, `:768`; `libs/frontend/skill-synthesis-ui/src/lib/components/clones/reconcile-guard.ts:280`.
   **Scenario:** The guard's fresh read returns no report, so its unverified modal opens with error null. Before the user closes it, HARNESS_HEALTH_CHANGED supplies a valid report (for example, the workspace finishes opening). The store accepts that report (`harness-health.store.ts:274`). runGuard now sees wasBusy=false, error=null and a changed non-null report, labels this failed check cancelled, and clears the typed value. A later successful refresh can similarly erase evidence of a read error. Thus the team-leader's claim that misclassification only goes toward “unverified” is false, although neither direction allows a mutation.
   **Fix:** Preserve an operation-specific guard outcome/reason rather than infer it from mutable global state after dismissal. If the guard API must remain boolean, expose a stable per-invocation outcome alongside it. Test recovery while the unverified modal remains open.

6. **Moderate — wizard destruction does not invalidate an in-flight confirmation preview.**
   **Location:** `libs/frontend/setup-wizard/src/lib/components/agent-selection.component.ts:1024`, `:1045`.
   **Scenario:** Confirm Generate starts the second preview; the component is then destroyed before its response returns. Only cancelPreview increments previewRequest, and the component has no destruction cleanup. The late reply still passes the sequence check and calls confirmGenerate, submitting generation after the wizard surface has gone away. An initial preview can also update a destroyed component, though that branch does not submit.
   **Fix:** Invalidate previewRequest on destruction and check DestroyRef.destroyed before continuing into submission. Add a deferred confirmation-preview regression proving destruction causes no submitAgentSelection call.
