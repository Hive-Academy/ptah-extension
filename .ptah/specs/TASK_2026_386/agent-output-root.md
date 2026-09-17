# Scope D implementation report

## Result

Implemented the external-editor launcher backend and the single standalone
`OpenInButtonComponent`. The component is exported and ready to mount, but no
change-set, file-row, dock-header, or workspace-header owner file was touched.

## Port and target shape

`IEditorLauncher` exposes:

```ts
detect(): Promise<EditorTarget[]>;
openFile(target: EditorTarget, filePath: string, line?: number): Promise<void>;
openWorkspace(target: EditorTarget, workspaceRoot: string): Promise<void>;
```

`EditorTarget` carries a stable `id`, `displayName`, and the verified launch
route: either `executablePath` or the supported `deepLinkScheme`. Target IDs are
a closed union, and RPC callers send only that ID. The handler re-detects and
looks up the ID before launching, so a renderer-provided string can never
become a command.

## Detection and launch behavior

- Shared detection runs in two passes: all PATH matches first, then verified
  per-platform install candidates. A candidate is returned only after its path
  exists. The order is stable and is not changed by the remembered choice.
- Electron checks the four configured editor commands and verified Windows,
  macOS, or Linux install candidates. It spawns verified binaries with argv.
  For the two supported URI families, a verified application install can fall
  back to `vscode://` or `cursor://` through `shell.openExternal`.
- VS Code excludes its own host editor from `detect()`. Opening the host target
  uses `workspace.openTextDocument` plus `window.showTextDocument`; other
  detected targets use the process spawner.
- CLI uses only verified binaries and the process spawner; it has no deep-link
  fallback.
- File paths, workspace roots, and executable paths must be absolute and are
  normalized before use. RPC paths must also be contained by a current
  workspace root. Launches use argv and never a shell string.

## RPC and compatibility behavior

Added `editor:detectTargets`, `editor:openFile`, and `editor:openWorkspace`, with
Zod schemas for every argument shape. The `editor:` namespace is present in
both the shared registry and `ALLOWED_METHOD_PREFIXES`.

Electron's legacy `file:open` now uses `IEditorLauncher`. It reads the global
`editorLauncher.lastTarget` setting; an installed remembered target wins,
otherwise VS Code remains the default. `notifyFileOpened` fires only after the
launcher succeeds.

The launcher token is registered in phase 2 of both VS Code and Electron,
after the shared off-thread process spawner exists. Handler registrations and
the expected-resolvable/expected-absent manifests were updated accordingly.

## Files created

- `libs/backend/platform-core/src/interfaces/editor-launcher.interface.ts`
- `libs/backend/platform-core/src/utils/editor-launcher-detection.ts`
- `libs/backend/platform-core/src/utils/editor-launcher-detection.spec.ts`
- `libs/backend/platform-cli/src/implementations/cli-editor-launcher.ts`
- `libs/backend/platform-cli/src/implementations/cli-editor-launcher.spec.ts`
- `libs/backend/platform-electron/src/implementations/electron-editor-launcher.ts`
- `libs/backend/platform-electron/src/implementations/electron-editor-launcher.spec.ts`
- `libs/backend/platform-vscode/src/implementations/vscode-editor-launcher.ts`
- `libs/backend/platform-vscode/src/implementations/vscode-editor-launcher.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/editor-rpc.schema.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/editor-rpc.handlers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/editor-rpc.handlers.spec.ts`
- `libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts`
- `libs/frontend/git-ui/src/lib/open-in/open-in-button.component.spec.ts`

## Files changed

- Platform-core: `src/di/tokens.ts`, `src/index.ts`, `src/file-settings-keys.ts`
- Adapter barrels: `platform-cli/src/index.ts`, `platform-electron/src/index.ts`,
  `platform-vscode/src/index.ts`
- Shared contract: `libs/shared/src/lib/types/rpc.types.ts`,
  `libs/shared/src/lib/types/rpc/rpc-editor.types.ts`
- RPC: `rpc-handlers/src/index.ts`, handler barrel, host manifest,
  `file-open-rpc.handlers.ts`, and its spec
- Runtime guard: `vscode-core/src/messaging/rpc-handler.ts`
- VS Code DI: phase 2, phase 3, expected-resolvable, expected-absent
- Electron DI: phase 2, phase 4, expected-resolvable
- Git UI barrel: `libs/frontend/git-ui/src/index.ts`

## Verification

The shared `.nx/workspace-data` directory was locked by other active worktrees.
Initial aggregate attempts timed out, and `npx nx reset` failed with `EPERM`.
Final verification used `NX_DAEMON=false` and the temporary isolated
`NX_WORKSPACE_DATA_DIRECTORY=.nx-open-in-launcher`; that generated directory
was removed afterward.

Commands and results:

```text
npx jest --config <each affected project config> <new/changed specs> --runInBand
PASS: 7 focused suites, 26 tests.

npx nx run-many -t lint typecheck -p @ptah-extension/git-ui @ptah-extension/platform-core @ptah-extension/platform-electron @ptah-extension/platform-vscode @ptah-extension/platform-cli @ptah-extension/rpc-handlers @ptah-extension/vscode-core --outputStyle=stream --parallel=1
PASS: "Running targets lint, typecheck for 7 projects" and successful completion.
Lint emitted only pre-existing warnings in untouched files.

npx nx run-many -t test -p @ptah-extension/git-ui @ptah-extension/platform-core @ptah-extension/platform-electron @ptah-extension/platform-vscode @ptah-extension/platform-cli @ptah-extension/rpc-handlers @ptah-extension/vscode-core
PASS: "Running target test for 7 projects"; 210 suites passed, 4,588 tests
passed, 31 skipped, 13 todo.
Jest emitted its existing forced-worker-exit/open-handle warning after several
project suites, but the command completed successfully with no failed suite.

git diff --check
PASS: no whitespace errors.
```

## Commits

- `4a871cae8 feat(platform): add external editor launcher adapters`
- `d10ac5432 feat(rpc): expose detected editor launching`
- `951aab029 feat(git-ui): add open-in split button`

## Still to mount

`OpenInButtonComponent` still needs mounting by the later owner batches in the
change-set header, per-file rows, git dock header, and workspace header. Those
files were explicitly out of scope and remain untouched.
