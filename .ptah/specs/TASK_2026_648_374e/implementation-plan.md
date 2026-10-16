# TASK_2026_648_374e — embeddable normal chat session

Design only, based on the 2026-10-15 worktree. No production code, build, test, server or commit was run for this plan. The [parity inventory](./parity-inventory.md) is the preserve list. This plan covers the remaining Phase 1 UI; #732 already delivered session-scoped, persisted `ptah_harness_propose_config`, `harness:get-proposal`, the New Project seed response and multi-session hydration (`TASK_2026_652_7284/completion-report.md`, sections 1–3). Do not reimplement those pieces. D16–D18 in `TASK_2026_652_7284/decisions.md` move Save as draft / Discard to 649 on normal tabs; `draft-workflow-plan.md` is the behavior reference, not a 648 implementation batch.

## Verified current state

1. **The pre-629 tile path is gone.** The earlier research's `canvas-tile.component.ts` references are stale. The current rail board owns one or two focus panes (`libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:152-177`), each `CanvasFocusAreaComponent` owns header and lane navigation (`canvas-rail/canvas-focus-area.component.ts:33-70`), and its orchestrator lane hosts `CanvasDetailTranscriptComponent` (`canvas-detail/canvas-lane-view.component.ts:67-69`). No `canvas-tile.component.ts` exists in the current canvas source tree. This changes the extraction point: use `CanvasDetailTranscriptComponent`, not the pre-629 tile.
2. **The actual injector recipe is small and specific.** `CanvasDetailTranscriptComponent` creates an environment injector for `ChatViewComponent` with `SESSION_CONTEXT`, `SESSION_VISIBLE`, `SESSION_FOCUSED`, `RAIL_MIN_CONTENT_WIDTH`, `SESSION_START_GUARD`, `SURFACE_ACTIVE`, rail retention and optional card actions (`canvas-detail/canvas-detail-transcript.component.ts:33-96`). It registers/unregisters the tab in the visible viewport (`:97-108`) and destroys the child injector (`:129-131`). Its short unavailable-agent notice is canvas-specific (`:110-126`). The embed should own the reusable injector/visibility lifetime; canvas still owns guard, lane actions and notice policy.
3. **`ptah-chat-view` already composes the whole session.** It contains streamed and finalized `ptah-chat-transcript` with history actions (`libs/frontend/chat/src/lib/components/templates/chat-view.component.html:79-100`), permission/questions (`:166-178`), and `ptah-chat-input` (`:244-247`). The input includes attachments, model, effort, voice, stop, queue and MCP state (`components/molecules/chat-input/chat-input.component.ts:191-201,257-259,296-426`). Its contextual mode reads DI signals (`components/templates/chat-view.component.ts:273-285,843-902`). Embedding the whole view retains these features and avoids a parallel transcript/composer.
4. **Tabs persist, but workflow identity does not exist.** `TabState` lives in `libs/frontend/chat-types/src/lib/chat-types.ts:603-659`; `TabManagerService.createTab` and `openSessionTab` create ordinary tabs (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:885-976`). Persistence projects all normal fields except explicitly transient keys (`chat-state/src/lib/tab-persistence.ts:83-89,103-136`) and restore sanitizes external JSON (`:233-269`). Add `workflow` as validated, persisted metadata. `tab-manager.service.ts` is already over 3,000 lines; put tag rules and index storage in a small collaborator, exposing only thin facade methods.
5. **Normal navigation and composer prefill have a precedent.** `TaskPromptBridgeService` creates a tab, navigates to chat, asks a mounted canvas to adopt the tab in grid mode and prefills the target composer (`libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.ts:53-99`). The workflow launcher uses that navigation/prefill sequence, but awaits `SurfaceRouterService.navigateToSurface('chat')` before creating the tab so a cancelled leave cannot create an orphan. The frontend already uses that navigation result pattern (`libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.ts:50-63`). First-message framing can be stored with `TabManagerService.setFirstMessagePreamble` (`chat-state/src/lib/tab-manager.service.ts:1914`; `chat-types/src/lib/chat-types.ts:694-701`). A visible editable prompt and hidden preamble are distinct fields.
6. **The tab bar filters claims.** `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.ts:92-139,197-199` renders normal tabs and hides claimed ones. The sidebar renders `session:list` rows separately (`components/templates/app-shell.component.html:251-365`); a tab-only tag would disappear from the history row after the tab closes. Persist a small workspace/session-to-kind index alongside tab metadata so the badge is available when the session is reopened. It holds no transcript, prompts, proposal or secret.
7. **The parallel builder path is still live.** `HarnessWorkflowService` owns a claimed surface and history replay (`libs/frontend/harness-builder/src/lib/services/harness-workflow.service.ts:581-614`). Its view still has private transcript, permission cards and textarea (`components/harness-builder-view.component.ts:196-380`), while the #732 proposal consumer filters by persisted session IDs and hydrates through `harness:get-proposal` (`services/harness-workflow-message.handler.ts:90-120,152-173`). That consumer is configure-only today (`:155-156`), so 649 must attach it for New Project as well. 648 exposes the host contract but does not switch or delete the builder view.
8. **Defects are current.** Backend live delivery checks `visibleTabIds` (`libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.service.ts:164-180`); the frontend viewport declares registered visible tabs (`libs/frontend/chat/src/lib/services/stream-viewport-controller.service.ts:75-87`). Live chunks check the claimed surface (`chat/src/lib/services/chat-message-handler.service.ts:514-529`), but snapshot resync writes to chat store by tab ID (`:563-589`). `applyConfig` awaits and discards `harness:apply` success (`harness-builder/src/lib/components/harness-builder-view.component.ts:806-859`). See the defect resolution below.

## Component and service contracts

Place the reusable component in `@ptah-extension/chat` (`scope:webview`, `type:feature`). This library already owns `ChatViewComponent` and the session DI tokens. Canvas and harness-builder are downstream feature consumers; neither chat nor chat-state imports harness-builder. Use standalone Angular components, OnPush, `inject()`, signals, `input()`/`output()` and content projection. No constructor injection, decorator inputs/outputs or module.

| Library | Current `project.json` tags | Role and allowed direction |
| --- | --- | --- |
| `@ptah-extension/chat-types` | `scope:webview`, `type:util` | Own the `WorkflowKind` union and persisted `TabState` field; no feature imports. |
| `@ptah-extension/chat-state` | `scope:webview`, `type:data-access` | Validate and persist workflow metadata; import chat-types, never a feature library. |
| `@ptah-extension/chat` | `scope:webview`, `type:feature` | Own the embed, normal-tab launcher and badges; depend on chat-state/chat-types and existing chat utilities. |
| `@ptah-extension/canvas` and `@ptah-extension/harness-builder` | `scope:webview`, `type:feature` | Consume chat's public embed/launcher contracts; canvas changes in 648, harness-builder consumes them in 649. No import back from chat into either consumer. |

The repository's Nx boundary rule allows a `type:feature` library to depend on feature, data-access, UI and util libraries, while `type:data-access` depends only on data-access and util libraries (`eslint.config.mjs:407-418`). The scope tags keep these dependencies inside the webview boundary (`eslint.config.mjs:295-297`).

```ts
// chat-types: persisted, public tab metadata. A phase's sessionId/status stays
// authoritative in the wizard manifest; workflow is a display/host tag only.
export type WorkflowKind =
  | 'harness-configure'
  | 'harness-new-project'
  | 'setup-wizard-phase'
  | 'setup-agent-generation'
  | 'setup-project-prompt';

export interface TabState {
  workflow?: WorkflowKind;
  // Existing fields unchanged.
}

// chat-state facade; implementation delegates validation/index updates to a
// focused WorkflowSessionIndexService instead of enlarging tab-manager logic.
class TabManagerService {
  setWorkflow(tabId: string, workflow: WorkflowKind): void;
  workflowForSession(sessionId: string, workspacePath: string): WorkflowKind | null;
  forgetWorkflowSession(sessionId: string, workspacePath: string): void;
  // Existing createTab/openSessionTab/attachSession remain the normal lifecycle.
}

// chat feature, implementation is ptah-session-embed.
class SessionEmbedComponent {
  readonly tabId = input.required<string>();  // tab ID, never SDK session ID
  readonly visible = input(true);              // parent surface and host visibility
  readonly focused = input(true);
  readonly minContentWidth = input<number | null>(null);
  readonly startGuard = input<SessionStartGuard | null>(null);
  readonly cardActions = input<SessionCardActions | null>(null);
  readonly retainRailTranscript = input(false);
  readonly addonOpen = input(false);
  readonly addonTitle = input('Workflow details');
  readonly addonDismissed = output<void>();
}

// Projected from a feature host into the same session shell:
// <div sessionHeader>...</div>
// <div sessionAddon>...</div>
// The default body is exactly one ChatViewComponent in the scoped child injector.

export interface WorkflowTabOpenRequest {
  workflow: WorkflowKind;
  title: string;
  visiblePrompt?: string;       // editable ptah-chat-input prefill
  firstMessagePreamble?: string; // backend-only framing on the first send
}
export type WorkflowTabOpenResult =
  | { outcome: 'landed'; tabId: string }
  | { outcome: 'cancelled' | 'failed' };
class WorkflowTabLauncherService {
  open(request: WorkflowTabOpenRequest): Promise<WorkflowTabOpenResult>;
}
```

The embed creates/destroys its child environment injector once per component, supplying the current `tabId` and signal inputs to the same tokens as the canvas recipe. An `effect` registers `tabId` while the parent surface is active and unregisters it on cleanup. Keep registration owner-aware if two embeds can transiently render the same tab: the current `Set` API (`tab-manager.service.ts:2988-3002`) is not reference counted, so a second host must not be left invisible when the first unmounts. A small reference count in the visibility owner or a single-render invariant with tests is required before moving registration. Projected content stays in the feature host's declaration injector; it receives the tab ID explicitly and does not rely on the chat child's injector. Use named `ng-content` slots for header and add-on, and a sensible default header-free body for the existing canvas focus header. Keep canvas's canvas-specific unavailable-agent notice in its wrapper.

The add-on is beside the chat on wide panes and becomes an accessible overlay or stack below the conversation when narrow; it must not shrink the composer below its usable width or cover the send/stop controls. `addonOpen` governs visual/inert state, and `addonDismissed` lets the feature host own the toggle. The host decides the panel content and data lifecycle. No timer, polling loop or per-card observer is part of this component. The existing chat view continues to own transcript, message stream, permissions, questions, input, stats, dock and scroll behavior.

`WorkflowSessionIndexService` stores only a bounded, schema-checked map of `{workspacePath, sessionId, kind}` in webview storage. Populate it when a tagged tab receives its SDK session ID (`attachSession`/resume/rebind), and read it when `openSessionTab` recreates a tab from a sidebar row. Preserve the entry when a tab closes, remove it when the corresponding session is deleted, and never infer a kind from a title. Validate stored keys/kinds before use; ignore malformed/unknown values. A write failure leaves the in-memory tab tag working and exposes a nonsecret warning for history-badge persistence. Workspace path is the partition key; a session ID alone is insufficient. Keep index storage separate from #732's backend proposal store and from the 649 draft slot.

`WorkflowTabLauncherService` validates its public request, awaits chat navigation, creates a normal tab, tags it immediately, sets the optional first-message preamble, asks the mounted canvas to adopt it when grid layout is active, and sends prefill to the composer scoped to that tab. It returns the tab ID only after these steps. On navigation cancel/failure it creates no tab. It does not call `chat:start` itself: the normal `ptah-chat-input` sends the first turn, obtains/attaches the session ID, and keeps the existing `chat:continue`/abort path. It does not claim the tab or set `surfaceMode`. It must not log seed text or backend error bodies. A caller that needs an immediate start may request it in 649 through the normal tab sender after the tab exists; do not create a private transport in 648.

## 649 handoff: harness add-ons on normal tabs

1. `HarnessWorkflowRequestService` remains the single entry adapter for Setup Hub and the legacy `HARNESS_OPEN_WORKFLOW` relay. In 649, resolve leave/draft choice before launching a replacement, obtain the existing Configure Harness contextual prompt or the returned New Project seed, then call `WorkflowTabLauncherService.open` with `harness-configure` or `harness-new-project`. The launcher owns tab/navigation/prefill; the harness feature owns mode semantics. Do not route through `requestHarnessWorkflow`/surface mode once that migration is complete. Retain the compatibility relay until its callers are migrated.
2. Render `ptah-session-embed [tabId]="tabId"` in the workflow tab host. Project the builder's title/summary/workspace warning, Stop/Start over and panel toggle into `[sessionHeader]`. Project intake recap, stack profile, config preview, Apply, preset actions, health and the wired harness AI actions into `[sessionAddon]`. Use `tab.workflow` to select the add-on, never a separate chat transport. The ordinary canvas focus header/tab bar/sidebar also displays a short workflow badge, so a workflow session remains recognizable when the panel is closed.
3. Bind proposal state to the tab's **SDK** session ID after `attachSession`, not its frontend tab ID. Reuse #732's `harness:get-proposal` and session-filtered hydration for all session IDs belonging to that workflow. The add-on accepts accepted proposals in Configure Harness **and** New Project. Preserve the field-aware merge and the 30-day backend retention behavior. Show an explicit unavailable/expired preview state when a proposal cannot be loaded; do not attribute another tab's proposal to the active tab.
4. Preserve the complete intake, workspace pin, stack choices, preview, Apply, preset, health and existing AI endpoints listed in the inventory. `harness:apply` success must display the returned result and written-file list (epic defect 3). 649 implements D16–D18 Save as draft / Discard on leaving actions, with plain Stop pausing and keeping the transcript; use `draft-workflow-plan.md` for swap-on-Resume and webview-storage behavior. 648 adds no draft UI.
5. Setup Wizard phases later use the same `WorkflowTabLauncherService` and `setup-*` tags; the manifest, not the tab tag, records phase status and SDK session ID. 650/651 own the wizard migration and independent generation semantics.

## Defect resolution boundary

- **Defect 1, no live stream:** A 649 builder turn is sent from a real tab, and its visible embed registers that tab ID. `StreamViewportController` includes it in `visibleTabIds`; `ChatStreamDeliveryCoordinator` can deliver live chunks to that ID. 648 must implement and test embed visibility registration. No backend delivery change is needed for the builder after 649. The old claimed builder remains affected until migrated.
- **Defect 2, snapshot bypasses claim:** A 649 builder uses no claim and no `surfaceMode`. Both the live path and the snapshot resync path address the same normal tab, so the bypass no longer diverts builder output. 648 does not modify `ChatMessageHandlerService` snapshot routing; claimed Tribunal/Apps surfaces retain their existing behavior. If 649's regression test finds a remaining snapshot fault, fix it in that phase rather than suppressing snapshots globally.
- **Defect 3, Apply feedback:** 649 add-on work owns this, not the shared embed.

## File-disjoint implementation batches

These are implementation handoff boundaries; no batch has been executed. Each path belongs to one batch. Later batches consume public exports from earlier batches. Include only changed projects in checks; do not run workspace-wide targets.

| Batch | Files to create/change | Focused tests and acceptance |
| --- | --- | --- |
| 1 — workflow metadata | Change `libs/frontend/chat-types/src/lib/chat-types.ts`; add `libs/frontend/chat-state/src/lib/workflow-session-index.service.ts` and `.spec.ts`; change `chat-state/src/lib/tab-manager.service.ts`, `tab-persistence.ts`, `tab-manager.persistence.spec.ts`, `tab-manager.lifecycle.spec.ts`, `src/index.ts` | Unknown stored kind sanitizes to plain tab; tag survives tab save/restore, session attach, close/reopen and workspace switch; delete clears index; storage failure does not lose in-memory tag. Keep tab-manager methods thin. |
| 2 — shared embed | Add `libs/frontend/chat/src/lib/components/templates/session-embed.component.ts` and `.spec.ts`; change `chat/src/lib/components/index.ts`; change `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts` and `.spec.ts` | Same `ptah-chat-view`/`ptah-chat-input` and transcript render inside embed; projection and DI tokens scope by tab; canvas guard/lane actions/retention/notices stay; visibility unregisters on hide, tab change and destroy; duplicate host lifetime covered. |
| 3 — launch and badges | Add `libs/frontend/chat/src/lib/services/workflow-tab-launcher.service.ts` and `.spec.ts`; change `chat/src/lib/services/index.ts`; change `chat/src/lib/components/organisms/tab-bar.component.ts` and `.spec.ts`; change `chat/src/lib/components/templates/app-shell.component.ts`, `.html`, and `app-shell.organization.spec.ts`; change `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.ts`, `canvas-rail-card.component.ts` and their existing specs | Navigation cancel creates no tab; grid and single layouts prefill the right tab, and first send uses preamble once; workflow badge appears in tab bar, sidebar session row and rail card/header, with accessible label; ordinary sessions retain their current layout/actions. |

After **each** batch, run sequentially for that batch's changed projects (omit `chat-types` from `test`, because its `project.json` has no test target). Use the exact project set for that batch:

```text
# Batch 1
npx nx run-many -t typecheck,lint -p @ptah-extension/chat-types @ptah-extension/chat-state --parallel=1
npx nx test @ptah-extension/chat-state --parallel=1 --maxWorkers=2

# Batch 2
npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/canvas --parallel=1
npx nx test @ptah-extension/chat --parallel=1 --maxWorkers=2
npx nx test @ptah-extension/canvas --parallel=1 --maxWorkers=2

# Batch 3
npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/canvas --parallel=1
npx nx test @ptah-extension/chat --parallel=1 --maxWorkers=2
npx nx test @ptah-extension/canvas --parallel=1 --maxWorkers=2
```

These checks are for implementers, not evidence of a run. Check `ptah_get_diagnostics` on edited source after each batch. Jest should use `jest-preset-angular`. A final combined check is unnecessary if every batch's changed projects pass and no later edit touches earlier files.

## Manual review in the running app

When an implementer has an already-running app, inspect dark and light themes in VS Code and Electron: open a normal chat and a tagged test tab in single and rail layouts; verify advanced input controls, streaming transcript, permission/question cards, stop/queue, history, stats and compaction; switch canvas focus and split panes while streaming; hide/reopen the add-on, keyboard-focus its close control and confirm the composer stays usable at narrow widths. Reload and reopen the SDK session from the sidebar; confirm the workflow badge survives and never appears on an unrelated workspace's session. Confirm the rail card/header, tab bar and session list labels are readable in both themes. Builder-specific Apply and draft flows are 649 manual checks.

## Risks and limits

- The current visible tab set is not reference counted (`chat-state/src/lib/tab-manager.service.ts:2988-3002`). Moving its registration into a reusable embed must prevent one duplicate host from unregistering another's live tab. Avoid per-tab timers or observers to solve this; use a single owner policy or reference count with cleanup.
- The canvas wrapper currently owns its own unavailable-agent notice and `CanvasDetailService` actions (`canvas-detail/canvas-detail-transcript.component.ts:82-126`). Retain that behavior when reducing the wrapper; an embed must not import canvas.
- A workflow tab's tag is local webview metadata. The sidebar index survives ordinary reload/close in that storage, but it does not synchronize two independent VS Code webview panels. D17 explicitly accepts webview storage for drafts and records the multi-panel limit as FU-18; the workflow badge has the same limit. Do not claim cross-panel persistence.
- The new tag is untrusted when restored from localStorage. Sanitize unknown values; do not render arbitrary values as a badge or use them to select a component. The workflow add-on must validate proposal session ownership and workspace pin before Apply.
- A seed/preamble can contain workspace details. Keep it out of logs and error toasts. If navigation or prefill fails, report a safe failure and leave an inspectable normal tab only if the tab was already created; no silent detached surface.
- #732's proposal writer/store and 30-day retention are already tested in its completion report. 648 verifies only the new UI contracts; 649 verifies proposal binding and expiry from the new tab.

## Decisions

| Decision | Options considered | Evidence | Reversible? |
| --- | --- | --- | --- |
| Extract the current canvas **detail transcript injector** into chat's `SessionEmbedComponent`, leaving canvas header/lane specifics in canvas | Old `canvas-tile` extraction; duplicate chat input/transcript; current injector extraction | #730 current source at `canvas-detail-transcript.component.ts:33-108`; `chat-view.component.html:79-100,244-247`; no old tile file | Yes, component boundary can be adjusted without changing persisted data |
| Store a narrow workflow kind on `TabState` plus workspace/session index for closed-tab sidebar badges | Tab-only tag; backend session schema change | Tab persistence `tab-persistence.ts:83-136`; sidebar uses independent `session:list` rows (`app-shell.component.html:251-319`) | Yes, versioned/validated local index can be migrated or removed later |
| Launch through normal tab + existing composer prefill and first-message preamble, after successful chat navigation | Surface-mode start; hidden automatic first turn | `task-prompt-bridge.service.ts:53-99`, `tab-manager.service.ts:1914`, epic decision 2, defects 1–2 | Yes, launcher contract can add an explicit start policy in 649 without changing chat transport |
| Keep claim/registry services and all existing builder capabilities through 648 | Remove parallel path now; retain until migration | Epic context:60; `harness-workflow.service.ts:581-614`; D18 | Yes, migration/removal decision belongs to 649 parity review |

## Proposed Removals

None in 648. No user-visible builder or wizard capability is removed by this plan.
