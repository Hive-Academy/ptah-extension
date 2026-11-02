# Implementation Plan - TASK_2026_ONBOARDING_SHARING

## Inputs and constraints

- Requirements: the spawner's brief (user decisions: one PR for parts A, B and C; a marked block in the root `CLAUDE.md`). No `context.md` or `task-description.md` exists. The brief stands in for them.
- Root `CLAUDE.md` rules: Electron first, VS Code and TUI must keep compiling, scoped `npm run verify` only, no build/serve/e2e runs unless asked.
- Design handoff: none. The UI follows the existing onboarding tiles and DaisyUI patterns.

## Codebase evidence

| Evidence | Location | Implication |
| --- | --- | --- |
| The fingerprint hashes every top-level name and type, plus the bytes of the lock and manifest files | `agent-generation/.../analysis-fingerprint.ts:81-102`, list at `:9-46` | Untracked local files break freshness. Needs a v2 algorithm. |
| The algorithm is the literal `'sha256-v1'` | `multi-phase.types.ts:173`, `shared/.../rpc-setup.types.ts:167`, `analysis-run-checkpoint.ts:63-71` | Widen to a v1 or v2 union and keep v1 readable. |
| A run is stale when it is older than 7 days (`expired`) | `analysis-freshness.service.ts:19,173-175` | Change this policy (see decision A3). |
| The freshness check compares raw-byte sha256 per phase | `analysis-freshness.service.ts:183-204`; hash taken at `multi-phase-analysis.service.ts:644` | Compare after EOL normalisation. |
| The run finishes here | `multi-phase-analysis.service.ts:415` (`checkpoint.finish()`), `analysis-run-checkpoint.ts:297` | Hook the CLAUDE.md block in after `finish()` when the run completed. |
| `wizard:load-analysis` handler | `setup-rpc.handlers.ts:869-895`; frontend `wizard-rpc.service.ts:645`, `analysis-step.store.ts:149` | "Use it" reuses this RPC. No new method. |
| `wizard:analysis-status` exists but the frontend never calls it | `setup-rpc.handlers.ts:475-484`, `rpc.types.ts:1137` | Add a client method only. |
| The wrong file name is cited | `setup-rpc.handlers.ts:1084` (`project-profile.md`) | Fix to `01-project-profile.md`. |
| `workspace:addFolder` opens a dialog with only `openDirectory` | `workspace-rpc.handlers.ts:220-223`; the port allows `createDirectory` (`electron-user-interaction.ts:222-230`) | Add `createDirectory`. This creates a folder from the picker with no contract change. |
| Frontend workspace API | `electron-layout.service.ts:125-135,317,357,518` | The onboarding switcher wraps it. |
| "Open folder" sends a VS Code command | `setup-status.store.ts:207-214` | In Electron, route it to `addFolder()`. |
| The `harness:initialize` response pins `workspaceRoot` | `rpc-harness.types.ts:239-251`; `isWorkspaceEffectivelyEmpty()` at `harness-workspace-context.service.ts:237` | Add an `workspaceEffectivelyEmpty` field to the response for the new-project warning. |
| `SendMessageOptions` already accepts files and images | `chat-types.ts:23-32`; the harness sends through `harness-session.controller.ts:390,586`; `send(text)` at `:69` | Only the harness API needs an options argument. |
| Attachment state is private to chat-input | `chat-input.component.ts:905-922` (`_selectedFiles`, `_pastedImages`, `_imageAttachmentError`) | Extract it into a reusable service. |

## Architecture decision

- **A1. Shareable files.** At completion, `AnalysisStorageService` writes two files.
  - `.ptah/analysis/.gitignore`: `*/generation-manifest.json`, `*/enhanced-prompt.*`, `generation-manifest.json`.
  - `.ptah/analysis/.gitattributes`: `* text eol=lf`.
  - Each file is written only when absent, so user edits are kept.
- **A2. Fingerprint `sha256-v2`.** It hashes:
  - the sorted names of top-level **directories** that are not excluded, not dot-prefixed, and not matched by a literal name or `name/` line in the root `.gitignore`;
  - the name and LF-normalised bytes of each `ROOT_METADATA_FILES` entry present.
  - Top-level loose files and dotfiles (`.env`, `.idea`, notes) no longer count.
  - Freshness recomputes with the algorithm the manifest recorded, so v1 runs still qualify on their own machine.
  - Rejected: `git ls-files`. agent-generation has no git port, a new port would need three host adapters, and the check would fail outside a git repo.
- **A3. No wall-clock expiry.** A matching fingerprint plus matching output hashes are the real signal.
  - Drop the `expired` check and its reason. Remove `ANALYSIS_MAX_AGE_MS`.
  - The UI shows "analysed N days ago" from `analyzedAt`.
  - Reversible: the constant can return as a soft warning.
  - **User decision (2026-11-01):** show the age as relative text ("today", "1 day ago",
    "12 days ago") with an age colour that signals staleness by time alone:
    0–7 days = success token, 8–30 days = warning token, > 30 days = error token. Use the
    theme's semantic tokens (no raw colours) and keep a text label next to the colour
    (e.g. a `title`/sr-only "analysed 12 days ago, consider re-running") so colour is not
    the only signal. The fingerprint/output status (fresh/stale + reason) stays separate.
    Put the bucket logic in a small pure function with a unit spec.
- **A4. EOL-tolerant hashes.** A phase matches when sha256 of the raw bytes, or of the bytes with CRLF replaced by LF, equals the stored hash. Phase files are written LF-normalised.
- **A5. CLAUDE.md block.** A new `AnalysisClaudeMdLinker` (agent-generation) maintains this block in `<ws>/CLAUDE.md`:

  ```
  <!-- ptah:analysis:begin -->
  @.ptah/analysis/<slug>/01-project-profile.md
  ...
  @.ptah/analysis/<slug>/04-elevation-plan.md
  <!-- ptah:analysis:end -->
  ```

  - It writes the block after a completed run. It also writes it from `wizard:load-analysis` when the loaded run is `completed`; this is the "Use it" step for a cloned run.
  - When several slugs exist, the latest valid run wins. The block names exactly one slug.
  - It never reuses `HarnessConfigStore.writeClaudeMdToWorkspace`.
- **B1. Workspace switching.** A new `OnboardingWorkspaceStore` (onboarding) sits on `ElectronLayoutService`. Home gets a `WorkspaceHeaderComponent` with the current folder, a list of open folders, "Open folder…" and "New folder…".
  - Both actions call `addFolder()`. The dialog now has `createDirectory`.
  - In VS Code the header is read-only and keeps today's command.
- **B2. Switching is limited to entry screens.** The switcher is enabled only on Home and the path entry pages.
  - Inside a running flow the header is read-only and says "Return to Home to switch folder".
  - When the active workspace path changes, stores scoped to the workspace reset: `AnalysisStepStore.resetForWorkspace()` and `SetupWizardStateService.reset()`.
- **B3. First-run flag stays global.** `ptah.onboarding.v1` means "show onboarding once". The analysis-found card is per workspace and needs no flag.
- **C1. Attachments.** `ComposerAttachmentsService` (component-scoped, in `@ptah-extension/chat`) and `AttachmentTrayComponent` (chips, drop zone, pick buttons) are extracted. chat-input and the three onboarding inputs use them.
  - Chosen over chat-ui because the service needs `ClaudeRpcService` for `file:pick` and chat-input already lives in chat.
- **C2. Attachments are not persisted.** They clear when the message sends. After a failed send they stay in the tray so the user can retry. Restore and resume flows do not bring them back. A hint states this: "Attachments are not saved if you leave this page".

## Component specifications

### 1. Analysis sharing core (backend)

- **Responsibilities:**
  - fingerprint v2 (A2);
  - schema union for v1 and v2;
  - freshness policy (A3, A4);
  - `.gitignore` and `.gitattributes` writer (A1);
  - LF writes.
- **Files (MODIFY):**
  - `libs/backend/agent-generation/src/lib/services/{analysis-fingerprint.ts, analysis-freshness.service.ts, analysis-storage.service.ts}`
  - `.../services/wizard/{analysis-run-checkpoint.ts, multi-phase-analysis.service.ts}`
  - `.../types/multi-phase.types.ts`
  - `libs/shared/src/lib/types/rpc/rpc-setup.types.ts`: algorithm union; remove `'expired'`.
  - Specs: `analysis-fingerprint.spec.ts`, `analysis-freshness.service.spec.ts`, `analysis-storage.service.spec.ts`.
- **Failure behaviour:**
  - A missing or unreadable root `.gitignore` means no ignore filtering.
  - An unreadable manifest keeps today's `unreadable` result.
  - A failed `.gitignore` or `.gitattributes` write is logged as a warning and does not fail the run.
- **Verification seam:** unit specs.
  - Adding `.env` or `.idea` leaves the v2 digest unchanged.
  - Adding a new `src2/` directory changes it.
  - A CRLF copy passes.
  - A run 30 days old with a matching fingerprint is `fresh`.
  - A v1 manifest is still evaluated with v1.

### 2. AnalysisClaudeMdLinker (backend, new)

- **Purpose:** keep the marked block in the root `CLAUDE.md`.
- **API:** `link(workspaceRoot, slug, phaseFiles): Promise<{ written: boolean; error?: string }>`.
- **Behaviour:**
  - Reads `CLAUDE.md` through `IFileSystemProvider` and replaces only the text between the markers.
  - If the markers are absent, it appends the block after a blank line. If the file is absent, it creates it.
  - It keeps the file's existing EOL style.
  - If only one marker is found, or the begin marker comes after the end marker, it does not write and returns an error.
- **Wiring:**
  - Called after `checkpoint.finish()` when the lifecycle is `completed` (`multi-phase-analysis.service.ts:415`).
  - Called in the `wizard:load-analysis` handler after a successful load of a `completed` run.
  - Registered with `AGENT_GENERATION_TOKENS` next to `ANALYSIS_FRESHNESS_SERVICE`, in the same registration file. The DI phase must be confirmed when the existing token is located.
  - Update `expected-resolvable.ts` if the smoke list enumerates agent-generation tokens.
- **Failure behaviour:** a write error never fails the analysis or the load. It is logged.
  - Assumption: `MultiPhaseAnalysisResponse` or `loadMultiPhase` can carry an optional `claudeMdLinkError?: string`. The implementer must check the shape of `loadMultiPhase`. If no response field fits, logging only is acceptable.
- **Files:**
  - CREATE `.../services/analysis-claude-md-linker.ts` and its spec.
  - MODIFY `agent-generation` DI registration and the `setup-rpc.handlers.ts` load handler.
  - MODIFY `setup-rpc.handlers.ts:1084` to fix the file name.
- **Verification seam:** linker spec cases:
  - file absent;
  - file present without markers;
  - replace between markers while the outside bytes stay identical;
  - malformed markers mean no write;
  - CRLF file.
  - A handler spec checks that load triggers the linker.

### 3. Workspace dialog and emptiness (backend, small)

- **Changes:**
  - Add `'createDirectory'` to `workspace-rpc.handlers.ts:221`.
  - Add `workspaceEffectivelyEmpty: boolean` to `HarnessInitializeResponse`, filled by the `harness:initialize` handler (`harness-rpc.handlers.ts:370`).
- **Failure behaviour:** if the emptiness check throws, report `false`. No warning is shown and nothing is blocked.
- **Files (MODIFY):** `workspace-rpc.handlers.ts`, `harness-rpc.handlers.ts`, `rpc-harness.types.ts`, and the specs next to each.

### 4. Analysis-found card (frontend)

- **Responsibilities:**
  - Add `WizardRpcService.getAnalysisStatus()`.
  - Add an `AnalysisFoundCardComponent` on Home: "Analysis found · fresh/stale (reason) · analysed N days ago" with **Use it** (`AnalysisStepStore` loads by slug, then routes to analyze-done) and **Re-run**.
  - Status `missing` hides the card.
  - An RPC error hides the card and logs.
- **Files:**
  - MODIFY `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts` and its spec.
  - CREATE `libs/frontend/onboarding/src/lib/home/analysis-found-card.component.ts` and its spec.
  - MODIFY `onboarding-home.component.ts` and `analysis-step.store.ts` (`resetForWorkspace`, `useAnalysis(slug)`).

### 5. Workspace targeting (frontend)

- **Responsibilities:**
  - `OnboardingWorkspaceStore`: folders, active folder, `canSwitch`, `switchTo(index)`, `openFolder()`, `createFolder()`. A dialog cancel is detected when the active path is unchanged, and is a no-op.
  - `WorkspaceHeaderComponent` on Home and on the entry pages of new-project and team-builder.
  - New-project intake shows a "Folder is not empty" confirm when `workspaceEffectivelyEmpty === false`.
  - "Analyze another project" is a tile action: open or switch folder, then go to analyze.
  - An effect on the active path resets the workspace-scoped stores (B2).
  - Fix `setup-status.store.ts` `openFolder()`: in Electron, delegate to `ElectronLayoutService.addFolder()`.
- **Files:**
  - CREATE in `libs/frontend/onboarding/src/lib/shell/`: `onboarding-workspace.store.ts`, `workspace-header.component.ts`, and their specs.
  - MODIFY: `onboarding-home.component.ts`, `new-project-intake.page.ts`, `team-builder-start.page.ts`, `chat-ui/.../setup-status.store.ts` and its spec.

### 6. Attachment extraction and reuse (frontend)

- **`ComposerAttachmentsService`** (component-provided):
  - `files`, `images`, `error` signals;
  - `onPaste`, `onDrop`, `pickFiles`, `pickImages`, `remove`, `clear`;
  - `toSendOptions(): Pick<SendMessageOptions,'files'|'images'>`.
  - Limits come from `image-media-type.ts`.
- **`AttachmentTrayComponent`:** chips, error text and pick buttons.
- **chat-input:** delegates to the service and tray. Existing specs must stay green without changing what they assert.
- **Harness API:** `HarnessModeSession.send(text, options?)`. `HarnessSessionStart` gains `attachments?`, which `firstSend` passes through. The intake hash dedupe stays text-only.
- **Onboarding inputs:** intake, team-builder start and answer-dock host the tray.
- **Files:**
  - CREATE `libs/frontend/chat/src/lib/services/composer-attachments.service.ts` and `libs/frontend/chat/src/lib/components/molecules/attachment-tray/attachment-tray.component.ts`, both with specs. Export both from the chat index.
  - MODIFY `chat-input.component.ts`, `harness-session.controller.ts` and its spec, `new-project-intake.page.ts`, `team-builder-start.page.ts`, `answer-dock.component.ts`, and the specs of each.

## Integration architecture

- **Data flow:**
  1. The analysis completes.
  2. LF phase files are written.
  3. The manifest is written with v2.
  4. The `.gitignore` and `.gitattributes` files are written.
  5. The linker updates `CLAUDE.md`.
  6. On a clone, Home calls `wizard:analysis-status`, then the card, then "Use it", then `wizard:load-analysis`, then the linker.
- **State:**
  - Analysis state is file-owned per workspace.
  - Frontend stores reset when the active path changes.
  - Attachments live only as long as their component.
- **Not a git repo:** no impact. v2 uses the filesystem only. The `.gitignore` files are harmless.
- **Switch mid-flow:** blocked by the UI (B2). The `ProposalFlowStore` mismatch checks remain the backstop.

## Testing and verification

- **Backend:** `npm run verify -- -p @ptah-extension/agent-generation,@ptah-extension/rpc-handlers,@ptah-extension/shared`.
- **Frontend:** `npm run verify -- -p @ptah-extension/chat,@ptah-extension/chat-ui,@ptah-extension/harness-builder,@ptah-extension/onboarding,@ptah-extension/setup-wizard`.
- **Hosts:** `npm run verify -- -t typecheck,test -p ptah-electron,ptah-extension-vscode,ptah-tui`.
- **E2E (worth adding, not run unless the user asks):**
  - `libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/`: a fixture for the analysis-found card (fresh and stale), a workspace-header visual, and a tray-with-chips visual on intake.
  - `apps/ptah-electron-e2e/src/specs/onboarding/onboarding.spec.ts`: switch folder, then the Home card updates.

## Team-leader handoff

- **Executors:**
  - Components 1–3: backend-developer.
  - Components 4–6: frontend-developer.
- **Complexity:** HIGH, because the PR covers three features across 8 projects. Each component is medium.
- **Ordering:**
  - 1 and 3 change the shared types first.
  - 2 depends on 1, because it touches the same storage and multi-phase files.
  - 4 depends on 1 (the shared status type) and on 2 (the load handler).
  - 5 depends on 3.
  - 6 is independent.
- **File-disjoint batches:**
  - **B1, backend:** components 1, 2 and 3. They share `setup-rpc.handlers.ts` and `multi-phase-analysis.service.ts`.
  - **B2, frontend attachments:** component 6 (chat, harness-builder, and the onboarding inputs' attachment edits). Run it after B3, because both touch `new-project-intake.page.ts` and `team-builder-start.page.ts`.
  - **B3, frontend workspace and card:** components 4 and 5.
  - Parallel-safe: B1 and B2. B3 runs after B1.
- **Assumptions to resolve:**
  - The file that registers the agent-generation DI token.
  - Whether the `loadMultiPhase` response can carry `claudeMdLinkError`.
  - Whether `ElectronLayoutService` can be injected in VS Code. Guard it with `VSCodeService.config().isElectron` (`vscode.service.ts:151`).
