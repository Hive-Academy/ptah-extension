# Code logic review — PR #943 (`e02299b88`)

**Score: 4/10. Verdict: REVISE.** The main content paths have useful bounds and validation, but a file replacement race crosses the filesystem authorization boundary and the detached window does not follow focus. This is below the 5–6 band because the first issue is a security boundary failure; it is above the 1–2 band because the ordinary file, dock, and viewer flows are implemented and bounded. Confidence: medium. I inspected the changed-file list for `main...HEAD`, task intent and plan, and the relevant end-to-end source paths. I did not run npm/nx/Jest/Node as instructed. Scoped `ptah_get_diagnostics` was unavailable after its 45-second compiler timeout, so CI remains the verification source. No skill-loading tool was available to this lane.

## Findings

### Critical — Resolved-file authorization can be bypassed during a replacement race

- **Evidence:** `libs/backend/rpc-handlers/src/lib/handlers/workspace-file-path.ts:364-399` checks the result of `realpath` and `stat`, then `libs/backend/rpc-handlers/src/lib/handlers/file-view-rpc.handlers.ts:194-225,324-350` opens that pathname twice without binding either handle to the checked file. `file:viewContent` does the same at `file-view-rpc.handlers.ts:105-130`.
- **Failure:** An in-workspace symlink or directory can be swapped between the realpath check and either open. The second open can read a different target, including a file outside the authorized roots. Binary reads return its bytes as base64 if the replacement has a permitted signature; text reads return decoded content. The size cap limits volume but does not preserve authorization.
- **Fix:** Open once under a handle, verify the opened file's identity and containment using a platform-safe handle-based approach, then perform stat, sniff and bounded read on that same handle. Account for Windows junctions and directory replacement; a second pathname `realpath` check alone still leaves a race. Add an adversarial replacement test for both RPC methods.

### Major — Detached Display follows mount order instead of the focused session

- **Evidence:** `libs/frontend/chat/src/lib/services/display-window/display-window-sync.service.ts:105-115,143-152` makes the last `bindSource` the active source and switches only when that source is unbound. Main ChatView binds at `libs/frontend/chat/src/lib/components/templates/display-sidebar-wiring.ts:60-62`; Command Center binds at `libs/frontend/command-center/src/lib/components/command-center-page.component.ts:411-417`. Neither binding passes a focus signal.
- **Failure:** When both views are mounted, focusing the older view does not change the detached window's source. It keeps showing the latest mounted view, violating D2. A stale child action may be rejected as belonging to the other tab, but the desired session never becomes visible.
- **Fix:** Track a focus/activation signal for each source and select the focused one. Rebind or recompute on focus changes and tab closure; test switches in both directions while the child is open.

### Major — Report classifier misses ordinary requests for a visual representation

- **Evidence:** `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.ts:46-53,85-91` recognizes a small vocabulary of `report` and `visual` phrases. `routeSurfaceRequest` at lines 60-73 emits only compact `ptah-ui` guidance for all other prompts, and `surfaceHookGuidance` at lines 80-82 adds no current-turn guidance for them.
- **Failure:** A request such as “Plot our test results as a chart” or “Show what we accomplished as an infographic” is a visual representation under context item 6, yet neither regex matches it. The agent receives compact-summary guidance rather than the HTML-artifact instruction at the decision point.
- **Fix:** Expand or replace phrase matching with intent handling that covers chart/plot/diagram/infographic and common paraphrases. Add positive and negative natural-language cases; keep the Electron gate and Codex no-skill-lookup wording.

### Minor — A supported file link with no usable root opens a dead Display item

- **Evidence:** `libs/frontend/chat/src/lib/services/file-link-router.service.ts:104-119` routes a supported extension whenever a registered dock exists and supplies `context.workspaceRoot ?? ''`. `libs/frontend/chat/src/lib/services/display-dock/display-dock.state.ts:183-193` stores and selects it. `libs/backend/rpc-handlers/src/lib/handlers/workspace-file-path.ts:333-352` rejects relative paths without an authorized base.
- **Failure:** In a session with a registered dock but no workspace root, a relative `.md`, image or PDF link opens a retryable viewer that can never succeed; retry repeats the same invalid request. The old git-review path is skipped.
- **Fix:** Before opening a Display file, require a usable root or document base for relative paths. Otherwise use the existing fallback or show a specific missing-root message instead of a retryable read error.

## Five logic questions

1. **How does this fail silently?** The detached source can remain stale with no error because `bindSource` uses insertion order (`display-window-sync.service.ts:143-152`); the window displays a valid but wrong session.
2. **What user action produces unexpected behavior?** Focusing an already mounted chat view while Command Center remains mounted does not move the detached display (same lines).
3. **What input produces a wrong answer?** “Plot our test results as a chart” classifies as compact (`ptah-ui-hint.ts:46-53,85-91`), contrary to the HTML artifact requirement.
4. **What happens when a dependency fails?** The viewer shows a retry control (`display-file-viewer.component.ts:14-18,54-79`), but missing workspace context is permanent across retries (`file-link-router.service.ts:115`). Diagnostics did not complete, so CI evidence is still needed.
5. **What requirement case is underspecified?** Focus ownership when main ChatView and Command Center coexist is not represented in the `DisplayWindowSource` contract (`display-window-sync.service.ts:105-115,143-152`), though D2 requires it.

## Decisions and scope

- **Decision:** Treat filesystem replacement as blocking. Options were accepting realpath plus later open or binding validation and reading to one handle; the latter is required by the authorized-root contract and is reversible.
- **Decision:** Score 4/10 from the security boundary and D2 failure, while avoiding a speculative CSP finding. The PDF viewer creates a Blob with the RPC-supplied sniffed MIME (`display-file-viewer.component.ts:66-73`) and the shell permits `frame-src blob:` (`apps/ptah-electron/scripts/copy-renderer.js:169`); I did not establish an in-app path that produces a `text/html` blob frame. This remains a security review question, not a confirmed defect.
- **Checked:** Child sender validation still checks registered webContents, trusted document and main frame (`apps/ptah-electron/src/ipc/ipc-bridge.ts:376-409`). The file viewer revokes its object URL on selection cleanup and destruction (`display-file-viewer.component.ts:41-49,83-88`), mounts only the active file viewer through the panel, and uses the shared markdown component. Binary sniffing excludes SVG and checks a type-specific cap before the full bounded read (`file-view-binary.ts:64-87`; `file-view-rpc.handlers.ts:204-245`). The dock stores file metadata rather than bytes (`display-dock.state.ts:90-104,183-193`). The backend action schema uses the same select/fullscreen/view-state/attach discriminants as the shared action type (`display-window-rpc.handlers.ts:39-48`).
- **Residual uncertainty:** No cross-platform Electron PDF rendering or live focus-switch test was run in this read-only lane. The compiler diagnostics call timed out. I did not establish a complete absence of other defects across all 86 changed paths.
