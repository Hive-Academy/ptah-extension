# Review fix 1 report

## Critical: file replacement race
- `libs/backend/rpc-handlers/src/lib/handlers/file-view-rpc.handlers.ts:129-147,204-232,323-362`: each RPC opens once, validates the handle with `fstat`, checks post-open realpath containment and pathname identity (`dev`/`ino`, or size and timestamps when `ino=0`), then reads and sniffs through that handle. Directory and size checks use handle metadata. The handle closes in `finally`; refusals use fixed messages.
- `libs/backend/rpc-handlers/src/lib/handlers/file-view-rpc.handlers.spec.ts:131-164`: adversarial replacement with an outside symlink for both methods.

## Major: detached window focus
- `libs/frontend/chat/src/lib/services/display-window/display-window-sync.service.ts:39-43,107-172`: source focus versions select the most recently activated bound source; unbind or a closed tab falls back to another live source.
- `libs/frontend/chat/src/lib/components/templates/display-sidebar-wiring.ts:60-73` and `libs/frontend/command-center/src/lib/components/command-center-page.component.ts:65-70,97-103,420-425`: host focus and pointer activation advance the source signal; chat listeners release on destroy.
- `libs/frontend/chat/src/lib/services/display-window/display-window-sync.service.spec.ts:394-420`: ChatView → Command Center → ChatView and focused tab closure fallback.

## Major: visual report classification
- `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.ts:46-53`: added charts, graphs, plots, diagrams, infographics, visualizing, visual representations and overview pages to the visual request matcher. Existing compact guidance and Codex wording stay in place.
- `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.spec.ts:113-129`: five requested positive and five negative phrases.

## Minor: missing root
- `libs/frontend/chat/src/lib/services/file-link-router.service.ts:111-113`: relative display links lacking a workspace root and document base use the existing git-review navigation.
- `libs/frontend/chat/src/lib/services/file-link-router.service.spec.ts:123-131`: no-root regression.

## Decisions
- Preserve last-bound selection until a source receives focus; then follow the most recently activated source. This keeps the initial detached snapshot available and is reversible.
- Treat absolute paths as eligible for the display path even without a document base, since the backend root policy authorizes or refuses them. Reversible.

## Verification
- Source and spec locations inspected. No npm, nx, Jest, Node, or process-based diagnostics were run, as requested; CI must verify compilation and tests. No skill-loading tool was available to this lane.
