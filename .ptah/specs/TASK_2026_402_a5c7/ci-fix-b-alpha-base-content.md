# CI fix B: alpha base-content

Replaced both `text-base-content/80` and `text-base-content/90` in `peer-session-send-dialog.component.ts` with `text-base-content-muted`. The webview defines that single secondary text tier in `apps/ptah-extension-webview/tailwind.config.js` as `oklch(var(--bcm, var(--bc)) / <alpha-value>)`, with per-theme `--bcm` values and a full-contrast fallback. No second semantic muted tier is defined, so both sites use the same token; the acceptance caveat's other legibility classes were unchanged.

Verification:

- Tests: exit code 0; header confirmed `Running target test for 2 projects`. Chat: 71 suites passed, 1,138 tests passed, 2 skipped. Webview: 8 suites passed, 149 tests passed. Total: 79 suites passed, 1,287 tests passed, 2 skipped.
- Typecheck: exit code 0; `@ptah-extension/chat` completed successfully.
- Could not do: nothing.

