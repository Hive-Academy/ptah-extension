# Harness workflow drafts — D16 design

> **Status: SUPERSEDED for implementation (D18).** Not implemented in TASK_2026_652_7284. The
> user requirements (D16, D17) move to TASK_2026_649, where the builders run on normal chat
> tabs; there a draft is the kept workflow-tagged tab and its session. Reuse the requirements,
> the dialog/card UX, the abort-failure rule and the edge cases below; re-derive storage and
> restore on the tab model.

## Scope and evidence

This is a frontend design, with no production code changed. D16 in `decisions.md` requires a Save as draft / Discard / Cancel decision before **leaving** an active workflow; plain Stop remains a pause. The affected code is `libs/frontend/harness-builder/src/lib/` throughout unless a path is explicitly qualified.

* `services/harness-workflow.service.ts:59-68,225-254,521-558` stores one **active** record under a single `localStorage` key. `startWorkflow` writes a new active identity (`:293-318`); `dispose` clears the active key (`:477-503`). A `draft: true` field in that record would therefore be overwritten or cleared.
* The existing restore path mints a new correlation and surface, binds the old session, replays `chat:resume` without `activate`, and restores pending questions (`services/harness-workflow.service.ts:568-616,632-697`). The message handler fetches `harness:get-proposal` for each session (`services/harness-workflow-message.handler.ts:88-149`).
* `abort()` reports failure through `failTurn` and resolves (`services/harness-workflow.service.ts:421-424,445-465`); `abortAndDispose()` still disposes (`:511-515`). `isProcessing` uses session liveness (`:216-223`).
* Builder Start over sometimes bypasses its confirm (`components/harness-builder-view.component.ts:724-740`) and then calls `abortAndDispose` (`:760-764`); the existing modal and warning are at `:428-462,539-548`. Stop calls `abort` alone (`:751-753`).
* Setup Hub prompts only for a conflicting mode (`components/setup-hub.component.ts:1098-1135,1396-1437`), then `requestAndNavigate` can dispose again (`services/harness-workflow-request.service.ts:21-47`). The legacy relay enters that same service (`services/harness-workflow-message.handler.ts:49-85`).
* Proposal data is stored by workspace and session, merged on save, with 30-day pruning (`libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.ts:22,46-104,113-119,167-216`). Builder state exposes its current preview (`services/harness-builder-state.service.ts:85,179-195`) and reset clears it (`:603-638`).

## Decisions and answers to the eight design questions

1. **Storage.** Add one separate `ptah.harness.draft.v1.<encoded workspace root>` slot per workspace, leaving `ptah.harness.workflow.v1` for the active record. The draft record has the existing mode, session ID(s), root and bubbles, plus `savedAt`, `lastActivityAt`, and a snapshot of the visible preview (`Partial<HarnessConfig>` and completion flag). Write the draft successfully **before** clearing the active record. A later workflow can overwrite the active key without touching the draft. Saving a second draft atomically replaces the existing slot through `localStorage.setItem`; the dialog explicitly says the previous draft for that workspace will be replaced. If persistence throws or read-back validation fails, keep the workflow active, report a safe error, and do not claim it was saved. Do not delete a backend chat session or proposal on either Save or Discard; Discard here means dropping the harness workflow record and surface, matching current Start over, not deleting historical chats.
2. **Resume.** Extract `restoreRecord(record, workspaceRoot)` from `rehydrate()` and call it for both boot recovery and Resume. It must mint a fresh surface/correlation, bind the session, restore bubbles, replay history without activation, and let `HarnessWorkflowMessageHandler` hydrate every proposal session. On success, write the draft record into the active slot and remove the draft slot; on failed history lookup, leave the draft intact and show Retry/Delete, without activating an empty builder. If another workflow is active, show the **same** three-way dialog first. Discard closes the active workflow, then resumes the selected draft. If Save targets the **same** root, it replaces the selected draft after an explicit warning; the selected old draft can no longer be resumed, so stay in the Hub with the newly saved draft card. If Save targets a different pinned root, keep the selected draft and remain in the Hub; the newly saved draft belongs to its original workspace. Cancel changes nothing. This explicit result avoids silently swapping or losing the only draft.
3. **Abort failure (FU-17).** On either leaving choice, call `chat:abort` only when `isProcessing()` is true. Change the leave operation to return whether abort succeeded; it must dispose and continue navigation even if abort failed or threw. Show a persistent, dismissible **warning** in the destination view: “The workflow was closed, but the agent may still be running because Stop failed.” Never render the raw RPC error. For Save, the durable draft write must succeed before any abort/dispose; abort failure does not delete it. Plain Stop keeps its current behavior and shows the existing error in the builder. Guard concurrent leave clicks with one in-flight transition.
4. **Dialog.** Add `HarnessLeaveDialogComponent` under `components/` as one standalone OnPush presentational component. It receives context text, busy state, and the existing-draft replacement warning through `input()` and emits `save`, `discard`, and `cancel` through `output()`. Reuse it in both builder and Setup Hub; remove their old confirm markup and handlers, including the builder's no-confirm shortcut. Use the current DaisyUI `surface-3`/`btn` pattern, `role="dialog"`, `aria-modal`, `aria-labelledby`, initial focus and a focus trap, Escape = Cancel, and focus return to the triggering button. The parent owns the pending action and performs the selected transition. No second confirmation follows a choice.
5. **Resume draft card.** Add `HarnessDraftCardComponent` under `components/`, rendered immediately after the Setup Hub hero and before Quick Actions (`components/setup-hub.component.ts:268-323`). Match the existing rounded card, `surface` and badge styles. It shows mode, workspace label, last activity (or saved date), saved date and bubble count, with Resume and Delete draft buttons. The component receives a validated summary and emits actions; Setup Hub owns the read/refresh and navigation. Delete asks a simple, accessible confirm in the card and removes only that workspace's draft. Only the current workspace's card is shown. A blank root shows no card.
6. **Cross-mode contract.** `HarnessWorkflowRequestService` has no UI. Change `requestAndNavigate` to accept an explicit resolved `replacementChoice` when an active workflow in another mode would be replaced; with no choice, it returns `cancelled` and changes nothing. Setup Hub obtains the choice through its dialog **before** calling this service, avoiding two prompts. Same-mode requests continue navigating to the existing builder. The legacy `HARNESS_OPEN_WORKFLOW` relay currently calls without a view (`services/harness-workflow-message.handler.ts:49-85`); its documented safe default is Cancel on a conflicting active mode, with a safe informational message directing the user to Setup Hub. It must not silently discard or change modes. If no workflow is active, the relay keeps its current navigation behavior.
7. **Backend/host.** No backend RPC change is needed: `chat:resume` supplies the transcript and `harness:get-proposal` supplies the preview (`services/harness-workflow.service.ts:667-697`; `services/harness-workflow-message.handler.ts:113-132`). Keep the backend proposal record; because the store prunes at 30 days, the draft's preview snapshot is a local fallback if proposal hydration returns null. No host change is needed for the **current webview's** per-workspace storage and reload behavior; this follows the existing active-workflow `localStorage` pattern. Electron uses one main BrowserWindow (`apps/ptah-electron/src/windows/main-window.ts:115-132`). VS Code can create multiple independent panels (`apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts:104-128,140-164`), so this design cannot prove a single draft *across panels or webview origins*. A strict cross-panel guarantee requires host-owned workspace storage and a shared RPC, outside the allowed file scope. Treat that as a product limitation to resolve before claiming global one-draft semantics.
8. **Edges.** Never display or resume a draft with a different `workspaceRoot`; draft keys are scoped to the verified current root. A missing chat session leaves the draft available for Retry/Delete and explains that the transcript cannot be restored; never silently start a new agent. A null session during initial `chat:start` cannot yet be a resumable chat: keep the dialog open with Save disabled and a “Waiting for the chat session to start” explanation until the session resolves or start fails; Discard and Cancel remain available. Reload with a dialog open restores the still-active workflow because no choice was committed. Resume while another agent is processing first prompts, then aborts only for Save/Discard. A failed abort still lets the user leave and displays the warning. A failed draft write keeps the old draft and current workflow intact.

## Proposed contracts

```ts
type LeaveChoice = 'save-draft' | 'discard';
type LeaveResult =
  | { status: 'left'; abortFailed: boolean }
  | { status: 'save-failed'; reason: 'storage' | 'session-pending' };

interface HarnessDraftSummary {
  readonly workspaceRoot: string;
  readonly mode: HarnessWorkflowMode;
  readonly savedAt: number;
  readonly lastActivityAt: number;
  readonly bubbleCount: number;
}

// HarnessWorkflowService, root-provided. Full draft shape stays private.
readonly draftForWorkspace: Signal<HarnessDraftSummary | null>;
readonly leaveWarning: Signal<string | null>;
leaveActive(choice: LeaveChoice): Promise<LeaveResult>;
resumeDraft(workspaceRoot: string): Promise<'resumed' | 'missing' | 'wrong-workspace' | 'history-unavailable'>;
deleteDraft(workspaceRoot: string): boolean;
clearLeaveWarning(): void;

// HarnessWorkflowRequestService. Choice is supplied by a visible caller.
requestAndNavigate(
  data: HarnessOpenWorkflowPayload,
  replacementChoice?: LeaveChoice,
): Promise<HarnessWorkflowRequestOutcome>;

// HarnessLeaveDialogComponent; input()/output() signals, not decorators.
context = input.required<'start-over' | 'new-project' | 'switch-mode' | 'resume-draft'>();
replacesDraft = input(false);
busy = input(false);
save = output<void>();
discard = output<void>();
cancel = output<void>();

// HarnessDraftCardComponent.
draft = input.required<HarnessDraftSummary>();
resume = output<void>();
delete = output<void>();
```

The draft record validator checks every field, finite timestamps and the exact root. Prefer a root-scoped key derived from `encodeURIComponent(root)` and retain the root inside the record as a collision/mismatch check. Refresh the current draft summary when the workspace-root signal changes; the existing `rehydrateStarted` one-shot flag (`services/harness-workflow.service.ts:157-158,245-254`) is for active recovery and cannot drive draft-card visibility. Preview snapshot is local data only; on resume, reset old state, initialize for the selected workspace, apply the saved preview, then allow session proposal hydration to refresh it. The handler's existing generation guard (`services/harness-workflow-message.handler.ts:88-149`) prevents a response from an old surface applying to the resumed surface. The restore path must report replay failure instead of only logging it, and must clean up the newly allocated surface on failure without removing the draft. Serialize Save/Discard/Resume transitions so concurrent clicks or a relay cannot race them.

## Action flows

| Entry | Decision and operation | Destination |
| --- | --- | --- |
| Builder Start over | Always open shared dialog; Save writes draft, aborts if processing, disposes; Discard aborts if processing and disposes; Cancel closes dialog | Setup Hub after Save/Discard; builder after Cancel |
| Setup Hub new-project intake | On conflicting active workflow, shared dialog; resolved choice goes to `requestAndNavigate`; no duplicate service prompt | New Project builder after Save/Discard, existing workflow after Cancel |
| Cross-mode `requestAndNavigate` | Caller supplies choice; service refuses conflicting replacement without it | Requested builder on choice; unchanged on missing choice |
| Legacy `HARNESS_OPEN_WORKFLOW` | Same mode opens current workflow; conflicting mode defaults to Cancel with guidance | Current workflow retained |
| Setup Hub Resume draft | If active, same dialog; Discard then restore selected draft; Save replaces selected draft only for the same root, with a stated warning; Cancel stays | Restored builder, updated Hub draft, or unchanged |
| Builder Stop | Existing `abort()` only | Builder with transcript and preview retained |
| Setup Hub Delete draft | Small confirm; remove current workspace's draft key only | Hub, no card |

## File-disjoint implementation batches

The batches assign each file to one owner; later batches consume earlier public contracts and do not edit their files. These are implementation handoff boundaries, not work performed by this document.

| Batch | New / changed files (all under `libs/frontend/harness-builder`) | Tests to add in that batch |
| --- | --- | --- |
| 1 — persistence and transitions | Change `src/lib/services/harness-workflow.service.ts`; change `src/lib/services/harness-workflow.service.spec.ts` | Per-workspace slot, second-draft replacement, storage failure preserves current/old draft, abort failure still leaves with warning, no abort when idle, different root, reload before choice, failed history keeps draft, successful restore moves to active, pending session gating, preview fallback. |
| 2 — reusable UI pieces | New `src/lib/components/harness-leave-dialog.component.ts`, `harness-leave-dialog.component.spec.ts`, `harness-draft-card.component.ts`, `harness-draft-card.component.spec.ts` | Dialog outputs, focus/Escape/Cancel and replacement copy; card summary, Resume/Delete and delete confirmation. |
| 3 — entry points | Change `src/lib/components/harness-builder-view.component.ts`, `harness-builder-view.component.spec.ts`, `src/lib/components/setup-hub.component.ts`, `setup-hub.component.spec.ts`, `src/lib/services/harness-workflow-request.service.ts`, `harness-workflow-request.service.spec.ts`, `src/lib/services/harness-workflow-message.handler.ts`, `harness-workflow-message.handler.spec.ts` | Every leave path prompts once; Stop does not prompt; same-mode relay preserves flow; conflicting relay cancels safely; Save/Discard continue despite failed abort and expose warning; Resume with active workflow follows selected branch; preview hydration uses saved snapshot when backend record expired. |

After each batch, run **sequentially**, only for the changed project:

```text
npx nx run-many -t typecheck,lint -p @ptah-extension/harness-builder --parallel=1
npx nx test @ptah-extension/harness-builder --parallel=1 --maxWorkers=2
```

No build, serve or end-to-end run is part of this plan. Check affected specs and diagnostics after edits. For manual review in the running app, use both dark and light themes: start an active Configure Harness run and take each leaving path; verify focus/Escape, the replacement warning, an idle workflow, Stop preserving the transcript, abort failure warning, one draft card per workspace, date and bubble count, resume after reload with transcript and preview, deletion, and a workspace switch. In VS Code, additionally test a restored panel and a second independent panel; record the cross-panel storage limitation. In Electron, test window reload and reopening the workspace.

## Risks and unresolved boundary

* The existing active slot is global and `rehydrate()` clears it on a workspace mismatch (`services/harness-workflow.service.ts:568-577`). Keep this behavior for active recovery, but draft operations must never clear a different workspace's draft. A workspace switch while an active workflow is pinned needs explicit root comparison before Save and Resume.
* The backend proposal's 30-day retention means a draft preview must have the local snapshot fallback. The saved snapshot should be validated before applying; session history and backend proposal may legitimately diverge after a long pause.
* `localStorage` can be unavailable or quota-limited. Save must fail visibly and leave the current workflow in place. Cross-panel or cleared-webview persistence cannot be guaranteed with frontend-only files; host storage is required if “one per workspace” means global across simultaneous VS Code panels.
* Existing `chat:abort` failures may leave a backend agent running. Warning copy must state uncertainty, and the transition must still complete. No raw RPC errors, workspace secrets or full transcript should appear in logs or warning text.

## Orchestrator amendments (user-approved 2026-10-15, D17)

- **Resume while another workflow is active, choice Save = swap.** Read the selected draft into
  memory first, then write the active workflow as the workspace's draft, abort it if processing,
  dispose it, and restore the in-memory draft into the active slot. If the draft write fails,
  nothing changes. Restore the in-memory draft only after the new draft write succeeded. The
  draft slot then holds the new draft, so the old one cannot go back there. If its restore
  fails, keep the old record in the active slot so a reload retries it, and report the failure. The dialog copy for this context
  says the current workflow becomes the draft (no "replaces your draft" warning).
  This replaces answer 2's "stay in the Hub with the newly saved draft card" branch.
- **Storage:** webview storage only (no host store). The VS Code multi-panel limit is a recorded
  follow-up (FU-18).
- Implementation batches are numbered 26 (persistence and transitions), 27 (UI pieces),
  28 (entry points) in batches.md.
