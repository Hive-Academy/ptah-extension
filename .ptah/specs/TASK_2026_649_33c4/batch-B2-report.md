# Batch B2 report

## Files changed

- `libs/frontend/chat/src/lib/tokens/session-embed-chrome.token.ts`: added the D8 `SessionEmbedChrome` type and injection token byte-identically from `decisions.md`.
- `libs/frontend/chat/src/index.ts`: appended only the exact D8 barrel export line from `decisions.md`.
- `libs/frontend/chat/src/lib/components/templates/session-embed.component.ts`: added a `chrome` input with the `full` default and supplied its value through `SESSION_EMBED_CHROME` in the child injector beside `SESSION_CONTEXT`. Projection and visible-tab registration remain intact.
- `libs/frontend/chat/src/lib/components/templates/session-embed.component.spec.ts`: asserted the default `full` value and added a `bare` value case that also checks visible-tab registration and cleanup.

## Decisions

- Provide the string token with a factory that reads the input when the child injector resolves it. This follows the existing factory pattern for `retainRailTranscript`, and the `chrome` input is set before the hosted view is created. Reversible within the embed component.
- Keep the exact D8 token text and barrel export from `decisions.md` to avoid a cross-branch conflict with task 677. The token bytes were checked against the fenced code block after writing.

## Verification and remaining work

- No Nx, Jest, TypeScript, build, serve, or end-to-end commands were run, as directed. The orchestrator owns those checks.
- Scoped `ptah_get_diagnostics` was requested after edits, but its TypeScript compiler check remained unavailable after two 45-second attempts; it reported the files unchecked, with no pass or fail result.
- No changes were made to ChatView, app configuration, app shell, or WorkflowTabLauncherService.
