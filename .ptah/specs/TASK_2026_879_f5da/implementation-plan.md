# Implementation Plan - TASK_2026_879_f5da

Written by the codex software-architect lane and saved here by the orchestrator. No source files were edited, and no builds or tests were run.

## Inputs and constraints

Requirements come from `.ptah/specs/TASK_2026_879_f5da/context.md` and `task.md`. Electron is the priority host. Angular changes must use standalone OnPush components, signals, and `inject()`. New RPC boundaries must validate inputs with Zod. Cross-library imports must use public aliases.

The lane had no skill-loading tool. `.claude/skills/ptah-surface-authoring/SKILL.md` was inspected as repository evidence, not loaded as an operating skill.

## Current state per requirement

| Requirement | Verified current state | Design consequence |
| --- | --- | --- |
| Unified display | `DisplayPanelItem` has `summary`, `surface`, and `artifact` variants in `libs/frontend/chat-ui/src/lib/organisms/display-panel/display-panel.component.ts:41-55`; the dock has matching selection variants in `libs/frontend/chat/src/lib/services/display-dock/display-dock.state.ts:24-28`. Chat file links call `ReviewNavigationService.openFile` in `libs/frontend/chat/src/lib/services/file-link-router.service.ts:105-126`; its `file` target belongs to the git review shell in `libs/frontend/git-ui/src/lib/services/review-navigation.service.ts:51-66`. | Supported chat file clicks should enter Display state instead of replacing the git sidebar. |
| Markdown, images, PDF, HTML | The git spot editor reads through `FileViewReaderService`/`file:viewContent` (`libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.ts:83-84`; `libs/frontend/git-ui/src/lib/services/file-view-reader.service.ts:58-70`) and renders markdown preview (`spot-editor.component.ts:330`). Backend `file:viewContent` bounds and decodes text, rejecting binary (`libs/backend/rpc-handlers/src/lib/handlers/file-view-rpc.handlers.ts:108-128,224-245`). The HTML viewer accepts only the artifact URL shape (`libs/frontend/chat-ui/src/lib/organisms/artifacts/artifact-viewer.component.ts:33-38`). | Keep the text RPC and artifact protocol; add a separate bounded binary view path. |
| Dock and detach | `ElectronDisplayWindowHost` already creates a sandboxed, context-isolated child with web security and a navigation guard, loading the renderer with `?ptahWindow=display` (`apps/ptah-electron/src/windows/display-window.ts:117-155,215-300`). It registers the child sender ID (`:257`) and pushes state (`:327`). `DisplayWindowSync` publishes dock snapshots (`libs/frontend/chat/src/lib/services/display-window/display-window-sync.service.ts:307-333,396-407`). IPC validates sender/main frame and restricts child RPC (`apps/ptah-electron/src/ipc/ipc-bridge.ts:372-408,463-475`). | Extend the existing window and state/action channel. |
| Summary unlink | The panel defines a summary strip key and input (`display-panel.component.ts:29-33,320-325`). The chat summary chip has an “Open in panel” action (`libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-summary-chip.component.ts:166-176`); the dock stores summary navigation (`display-dock.state.ts:235-240`). | Remove the summary from Display selection and strip and remove the card action. |
| Pin | The panel documents pin as preventing scroll and focus moves on new or updated surfaces (`display-panel.component.ts:328-329`); dock auto-open paths check `pinned` (`display-dock.state.ts:371-421`). | Retain behavior and clarify the control. |
| Reports | `ptah-surface-authoring` already calls for `ptah_artifact_publish` for substantial reports, dashboards, and prototypes, with self-contained HTML and no remote assets (`.claude/skills/ptah-surface-authoring/SKILL.md:28-30`). The Electron prompt hint emphasizes ptah-ui and says to load the skill (`libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.ts:10-14`). Routing reminders use skill-table fallback responses (`libs/backend/rpc-handlers/src/lib/chat/host-routing/routing-reminder.format.ts:29-51`). | Update live prompt and routing guidance as well as skill text. |

## Architecture decision

Use one tab-scoped **display item** discriminated union with these kinds:

- `surface`: existing ptah-ui surface payload.
- `artifact`: existing HTML artifact record.
- `markdown-file`, `image-file`, `pdf-file`: a normalized path, workspace root, title, and revision/read status.

Every item has a namespaced stable key. Derive the strip from published surfaces, artifact records, and explicitly opened files; select by item key. A repeated click on the same file selects its existing entry. File items hold addresses and status, **not bytes**.

The dock owns item lifetime, selection, pin state, and surface view state per chat tab. The main renderer is the single state writer. The detached renderer receives serializable snapshots and returns typed actions. Closing the child resumes docked presentation with the current selection.

The git review shell should retain explicit review/edit operations. Embedding it in Display would bring editing and git scope into a viewer. Widening `file:viewContent` would break its deliberate binary refusal. A second detached state store would permit competing selections.

## Component contracts and data flow

### File clicks and dock state

On Electron, `FileLinkRouterService` should route supported markdown (`.md`, `.markdown`), raster image, and PDF links to a new `DisplayDockState.openFile`, carrying its existing workspace and source-document context. Relative markdown links use that source document as their base (`file-link-router.service.ts:30,174-176`). Explicit review/edit commands and unsupported file types retain their current navigation.

A direct click opens Displays and selects the file even when Pin is active: Pin governs automatic publication. Keep one entry per normalized workspace-root/path/kind. Release file entries when the chat tab closes. Existing `openSurface` and `openArtifact` callers (`display-dock.state.ts:163-179`) should use the unified selection contract.

### Secure reads and viewers

Markdown continues through `file:viewContent` and `FileLinkRootPolicy.resolveForView` (`file-view-rpc.handlers.ts:87`; `file-link-root-policy.ts:300`). Add a distinct typed binary-view RPC or opaque local-content URL for image/PDF content. At the backend boundary, Zod-parse path and root; authorize an open workspace; apply lexical and realpath containment, including `isInsideRoot` semantics; reject directories and symlink escapes; cap size; and check content signatures against a small MIME allowlist. Do not trust the renderer’s MIME, extension alone, or a supplied `file://`, `http(s)://`, or data URL. Errors must not expose realpaths or secrets. A missing or changed file shows a retryable error in its panel.

`DisplayPanelComponent` renders by kind: existing `SurfaceRendererComponent` for ptah-ui (`display-panel.component.ts:292-299`), existing sandboxed `ArtifactViewerComponent` for HTML (`:274-280`), the shared sanitized markdown component for markdown, and dedicated image/PDF viewers. Mount only the active expensive viewer. Image object URLs must be revoked on item change, close, and destroy. Exclude SVG until it has a safe sanitization path. Do not render raw HTML or load remote resources.

**Recommend pdf.js** for PDF. A locally bundled worker and explicit viewer offer control over embedded behavior, network access, and dock sizing. Chromium’s built-in viewer may depend on extension resources outside Ptah’s custom protocol and CSP. A repository search found no pdf.js package, so implementation must add and pin it and verify that CSP allows only its local worker. PDF links must not fetch remote content; external links, if exposed, must use the existing allowlisted external-open flow. Confirm pdf.js behavior in Electron before release.

### Dock and detached mode

Extend `libs/frontend/chat/src/lib/services/display-window/display-window-wire.ts` snapshots with file-item metadata and remove summary fields. Reuse `DisplayWindowSync` and `ElectronDisplayWindowHost`. The child sends selection, pin, and close actions; the main renderer applies them and republishes state. Validate action discriminants, tab IDs, and item keys at IPC/RPC boundaries.

Keep `IpcBridge`’s trusted sender and main-frame check (`ipc-bridge.ts:372-408`) and narrow child method allowlist (`:463-475`). If the child needs the new binary RPC, allowlist exactly that method and enforce the same backend root policy. Fetch content only for the active item in each window. Never broadcast bytes or object URLs in snapshots. A detached-window failure leaves the dock usable; a content-read failure remains local to its item.

### Summary and Pin

Remove summary from `DisplayPanelItem`, the strip, dock selection, detached wire, and the chip’s “Open in panel” output, button, and caller wiring. Keep the summary card and its details in the transcript. Center the card inside the chat content column with a bounded max width, without centering the whole transcript. Delete summary-only panel code once references are gone.

Label Pin **“Keep current view”** with tooltip **“New or updated displays will not switch items or scroll this panel.”** Explicit user actions still switch items. Update keyboard tab and screen-reader tests after removing the summary pill.

### Report requests and skills

Revise `.claude/skills/ptah-surface-authoring/SKILL.md`, `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.ts`, its no-skill/Codex counterpart, and the relevant host-routing reminder and skill-selection path. For a substantial report or visual/representational request, the agent should discover and load `ptah-surface-authoring` plus available design/data-visualization skills, gather verified data, publish an attractive self-contained HTML artifact through `ptah_artifact_publish`, and give a short chat description. Keep ptah-ui for compact host-verified summaries.

Preserve the skill’s 2 MiB limit, inline resources, theme response, and no-network rules (`SKILL.md:28-30`). Locate the actual skill suggestion/auto-load hook before changing it: `routing-reminder.format.ts` proves fallback formatting, not that it alone controls loading. Regression tests should exercise report-versus-compact routing and actual hook behavior, including a host without skill-file lookup.

## Risks and verification seams

Risks are path and symlink escape, oversized or spoofed binary files, a PDF worker blocked by CSP, remote PDF/image loads, stale cross-window snapshots, broader child RPC privileges, and regression of git review editing.

Backend boundary tests should cover traversal, symlinks, size, content signatures, and generic errors. Frontend tests should cover file-click routing, explicit clicks versus Pin, viewer URL cleanup, missing files, summary removal, and dock/detach selection sync. IPC tests should cover sender identity and the child allowlist. Verify image and PDF rendering under the actual Electron CSP before release; source inspection alone cannot establish it.

If a new handler or service is registered, update `apps/ptah-electron/src/di/container.smoke.spec.ts`, `expected-resolvable.ts`, `rpc-surface.spec.ts`, and `surface-composition.spec.ts`, plus the shared RPC manifest and handler allowlist. If an existing handler gains only a method, container registration guards may need no edit; RPC surface and composition assertions still need the method. Extend `apps/ptah-electron/src/ipc/ipc-bridge.display-window.spec.ts` for the child allowlist. Check dependency direction before adding imports, and export cross-library symbols through public indices.

## Ordered file-disjoint implementation batches

The task explicitly requests batches, overriding this role’s ordinary team-leader decomposition boundary. File ownership below is disjoint. These commands are for implementers after coding; resolve actual Nx project names before running them.

| Batch | Executor | Exclusive file ownership | Scoped verify command |
| --- | --- | --- | --- |
| 1. Binary file contract and Electron IPC | backend-developer | `libs/shared/src/lib/types/rpc/` file-view contract/manifest; `libs/backend/rpc-handlers/src/lib/handlers/file-view-rpc.handlers.ts`, root policy if needed, and specs; `apps/ptah-electron/src/ipc/ipc-bridge.ts`, `ipc-bridge.display-window.spec.ts`; Electron DI registration and the four DI/RPC guard specs if affected. | `npm run verify -- -p shared rpc-handlers ptah-electron` |
| 2. Display state and chat-link route | frontend-developer | `libs/frontend/chat/src/lib/services/display-dock/` and tests; `file-link-router.service.ts` and tests; relevant chat public index. Remove summary selection here. | `npm run verify -- -p chat` |
| 3. Unified panel and content viewers | frontend-developer | `libs/frontend/chat-ui/src/lib/organisms/display-panel/`, including `display-panel.component.ts`, `display-surfaces.ts` if needed, new file/image/PDF viewers and specs; relevant chat-ui public index; `package.json` and lockfile for pdf.js. Remove summary panel UI here. | `npm run verify -- -p chat-ui` |
| 4. Detached renderer synchronization | frontend-developer; backend-developer only if host adjustment is needed | `libs/frontend/chat/src/lib/services/display-window/`, `libs/frontend/chat/src/lib/components/templates/display-window/` and specs; `apps/ptah-electron/src/windows/display-window.ts` and spec only if necessary. | `npm run verify -- -p chat ptah-electron` |
| 5. Chat summary layout and callers | frontend-developer | `libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-summary-chip.component.ts` and spec; `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-turn-summaries.ts`, `chat-view.component.ts`, `display-sidebar-wiring.ts` and their tests. | `npm run verify -- -p chat chat-ui` |
| 6. Report skill and live routing | backend-developer | `.claude/skills/ptah-surface-authoring/SKILL.md`; `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.ts` and specs; `libs/backend/rpc-handlers/src/lib/chat/host-routing/routing-reminder.format.ts` and specs; the actual skill suggestion/auto-load hook and tests after locating it. | `npm run verify -- -p agent-sdk rpc-handlers` |

## Decisions

- **Reuse the existing dock and detached-window channel** instead of creating another manager. Evidence: `display-window.ts:215-327`, `display-window-sync.service.ts:307-333`. Reversible.
- **Keep text RPC and add bounded binary access** instead of widening `file:viewContent`. Evidence: `file-view-rpc.handlers.ts:108-128,224-245`. Reversible.
- **Use pdf.js** instead of Chromium’s built-in viewer for control under Ptah’s CSP. Package and worker feasibility require Electron verification. Reversible.
- **Remove summary state** instead of merely hiding its pill. Evidence: `display-dock.state.ts:24-28`, `display-panel.component.ts:29-33`. Reversible.

## Open questions


## Addendum (orchestrator, 2026-11-04): requirement 7 — Command Center

Not covered by the lane analysis above; added after the user request in context.md item 7.

- The Command Center embeds chat through `session-embed.component.ts:116-120` with a host-supplied
  dock and shows displays in its own rail tab (`command-rail-display.component.ts`,
  `command-center-page.component.ts:200`). It has no Detach.
- Target: the Command Center rail mounts the same unified `DisplayPanelComponent` over the same
  `DisplayDockState` contract, so file, image, PDF, artifact and ptah-ui items behave the same, and
  it offers the same Dock/Detach control through `DisplayWindowSync`.
- Open point for the batch owner: one detached display window per app (follows the active chat tab
  or Command Center session) versus one per host surface. Default: one per app, following the
  focused surface, as in TASK_2026_853_3401 (multiple windows were out of scope there).
- Batch 7 (frontend-developer, after batches 2-4): `libs/frontend/command-center/src/lib/components/
  command-rail-display.component.ts` + spec, `command-center-page.component.ts` wiring,
  `libs/frontend/chat/src/lib/components/templates/session-embed.component.ts` host-dock wiring.
  Verify: `npm run verify -- -p chat,command-center`.
