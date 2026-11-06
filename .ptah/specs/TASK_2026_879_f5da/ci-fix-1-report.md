# CI fix 1 report

## Failures fixed

1. `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:266`: batches 2–3 left a second `hideAgentSidebar` injection near the dock fields. Removed the duplicate at the former line 556; all uses now reference the single protected declaration.
2. `libs/frontend/command-center/src/lib/components/command-rail-display.component.ts:52`: the selection union also permits `null`, so accessing `surfaceKey` after the file case was unsafe. Narrowed with `kind === 'surface'` and return `null` for the remaining case.
3. `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.spec.ts:98`: the test panel stub lacked the new `files` input bound by DisplaySheet. Added `input<readonly DisplayFileItem[]>([])` using the public chat-ui type.
4. `libs/backend/rpc-handlers/src/lib/handlers/workspace-file-path.ts:129`: the shared form gate rejected URL colons only on Windows, allowing `scheme://` through POSIX path resolution and producing `not-found`. It now rejects URI scheme forms on every platform before any filesystem operation. The handler's existing generic `unsupported-path` message remains unchanged. `workspace-file-path.spec.ts:370` adds file, HTTPS, and data URL cases to the pre-I/O form-gate test.
5. `plugins/ptah-core/skills/ptah-surface-authoring/SKILL.md:3` and `.claude/skills/ptah-surface-authoring/SKILL.md:3`: shortened frontmatter description to 353 characters after `description: `, retaining report and HTML artifact trigger terms. Both complete files were written identically. `content-manifest.json` was untouched.

## Extra breakages fixed

The `ptah-display-panel` stubs in `libs/frontend/chat/src/lib/components/organisms/display-sheet/display-sheet.component.spec.ts:32`, `libs/frontend/chat/src/lib/components/templates/chat-view.dock.spec.ts:116`, and `libs/frontend/chat/src/lib/components/templates/chat-view.keepalive.spec.ts:296` also lacked the `files` input. Each now declares the same typed input. The Command Center and detached-window stubs already had it.

## Verification

Reviewed all six frontend spec stubs of `ptah-display-panel` and the edited lines. Scoped `ptah_get_diagnostics` was requested for eight changed TypeScript files; its TypeScript compiler remained unavailable after 45 seconds and marked all eight unchecked. No npm, Nx, Jest, Node, build, serve, or e2e command was run, as instructed. Visual rendering was not applicable to these CI fixes.

## Decisions

- Put the URL gate in the shared path-form check, because both file-view handlers use it and it already runs before filesystem access. This is reversible.
- Added the input to all affected test stubs because their production panel now accepts `files`. This is reversible.