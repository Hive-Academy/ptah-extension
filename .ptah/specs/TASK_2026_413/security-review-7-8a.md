# Security and Logic Review — TASK_2026_413 (Batches 7, 8a, 8c-1)

## Summary

| Metric                 | Value              |
| ---------------------- | ------------------ |
| Overall score          | 7/10               |
| Assessment             | APPROVE_WITH_FIXES |
| Critical issues        | 0                  |
| High severity issues   | 2                  |
| Medium severity issues | 2                  |
| Low severity issues    | 1                  |
| Total findings         | 5                  |

Scope reviewed:

- **Batch 8a backend**: Commit [`53ade1083`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/backend/rpc-handlers/src/lib/handlers/workspace-file-path.ts) (`workspace-file-path.ts`, `file-link-root-policy.ts`, `file-view-rpc.handlers.ts`, `editor-rpc.handlers.ts`, `navigation-policy.ts`, `main-window.ts`, VS Code [`file-rpc.handlers.ts`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.ts), DI manifests, and all associated unit/smoke specs).
- **Batch 7 rail**: Commit [`53b1dbea0`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/core/src/lib/services/electron-layout.service.ts) (`electron-layout.service.ts`, `rail-resize-handle.component.ts`, `git-dock.component.ts`, `git-dock-header.component.ts`, and `git-rail-collapse.spec.ts`).
- **Batch 8c-1 markdown**: Commit [`f6f53b093`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/markdown/src/lib/file-link-target.ts) (`file-link-target.ts`, `markdown-file-links.ts`, `marked-extensions.ts`, `provide-markdown-rendering.ts`, `file-link-opener.token.ts`, and test suites).

---

## Findings by Severity

### HIGH-1: Symlink in Registered Workspace Escapes to Credentials in Home and Bypasses Deny-List

- **Severity**: HIGH
- **File & Line**: [`libs/backend/rpc-handlers/src/lib/handlers/file-link-root-policy.ts:213-225`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/backend/rpc-handlers/src/lib/handlers/file-link-root-policy.ts#L213-L225)
- **Evidence**:
  In [`FileLinkRootPolicy.resolveForExternalOpen`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/backend/rpc-handlers/src/lib/handlers/file-link-root-policy.ts#L192-L226):

  ```typescript
  const resolution = await resolveLinkedFilePath(
    request,
    {
      registered,
      listWorktrees: (root) => this.listWorktrees(root),
      extra,
    },
    { allowDirectory: options.allowDirectory ?? false },
  );

  if (resolution.kind === 'rejected') return resolution;

  // The deny-list guards the WIDENING only. A path that matched a registered
  // workspace root is project content and stays openable.
  const widened = extra.some((root) => root === resolution.root);
  if (!widened) return resolution;

  if (isCredentialPath(resolution.lexicalPath) || isCredentialPath(resolution.realPath)) {
    return { kind: 'rejected', reason: 'outside-roots' };
  }
  ```

  In [`resolveLinkedFilePath`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/backend/rpc-handlers/src/lib/handlers/workspace-file-path.ts#L347-L404):
  `resolution.root` is determined by **lexical** match against `authorized = [...registered, ...extra]`.
  When a symlink or junction exists inside a registered workspace `W` (e.g. `W/project_note.md -> ~/.ssh/id_ed25519`):
  1. Lexically, `W/project_note.md` matches `W`, so `resolution.root` is `W`.
  2. In Step 5 (realpath containment), `realTarget` is resolved to `~/.ssh/id_ed25519`. Since `homedir` is in `extra` (part of `authorized`), `matchRoot(realTarget, realRoots)` finds `homedir` and containment passes.
  3. `resolveLinkedFilePath` returns `{ kind: 'file', lexicalPath: 'W/project_note.md', realPath: '~/.ssh/id_ed25519', root: W, ... }`.
  4. In `resolveForExternalOpen`, line 213 checks `const widened = extra.some((root) => root === resolution.root)`. Because `resolution.root` is `W` (which is in `registered`, not in `extra`), `widened` evaluates to `false`!
  5. Line 214 immediately returns `resolution` with success, completely skipping `isCredentialPath(resolution.realPath)`.

- **Concrete Exploit**: An attacker (or untrusted cloned repo) plants a symlink `docs/readme.md -> ~/.ssh/id_ed25519`. An agent suggests viewing `docs/readme.md`. The user triggers Open In. `resolveForExternalOpen` skips the deny-list because the lexical root is `W`. The external AI-enabled editor is launched with the private key path.
- **Minimal Fix**:
  Check whether `realPath` is outside the registered workspace roots, or unconditionally verify `isCredentialPath(resolution.realPath)`:
  ```typescript
  const realPathInRegistered = registered.some((root) => isPathWithinRoots(resolution.realPath, [root]));
  if (!realPathInRegistered) {
    if (isCredentialPath(resolution.lexicalPath) || isCredentialPath(resolution.realPath)) {
      return { kind: 'rejected', reason: 'outside-roots' };
    }
  }
  ```

---

### HIGH-2: VS Code `file:open` Hard-Rejects Absolute Paths in Sibling Repositories, Contradicting Orchestrator Decision 3 (Masked by Mocked Spec)

- **Severity**: HIGH
- **File & Line**: [`apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.ts:133-140`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.ts#L133-L140) and [`apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.spec.ts:161-179`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.spec.ts#L161-L179)
- **Evidence**:
  `context.md` Orchestrator Decision 3 states:

  > "Risk 3 resolved without a regression. VS Code `file:open` for an absolute path outside registered roots does not refuse. It shows the same modal confirm with the absolute path, subject to the deny-list, then opens. Relative paths still resolve only under a checked root."

  And `file-rpc.handlers.ts:15-18` documents:

  > "2. An absolute path outside the open folders is not refused, it is CONFIRMED. Refusing would regress a case that works today (a link into an unregistered sibling repo)..."

  However, in [`file-rpc.handlers.ts:133-140`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.ts#L133-L140):

  ```typescript
  const external = await this.linkPolicy.resolveForExternalOpen({ path: requested }, { allowDirectory: true });
  if (external.kind === 'rejected') {
    return { kind: 'refused', message: MESSAGE.notResolvable };
  }

  const confirmed = await this.confirmOutsideWorkspace(external.lexicalPath);
  ```

  `resolveForExternalOpen` is bounded to `[registered, os.homedir(), os.tmpdir()]`.
  If an absolute path points to an unregistered sibling repo located outside home/tmp (e.g. `D:\other-repo\src\index.ts` when homedir is `C:\Users\...`, or `/opt/repos/other-repo`), `resolveForExternalOpen` rejects with `outside-roots`.
  `file-rpc.handlers.ts` immediately treats `external.kind === 'rejected'` as fatal and returns `{ kind: 'refused', message: MESSAGE.notResolvable }`. The user is NEVER shown the confirmation modal!

  In [`file-rpc.handlers.spec.ts:166`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.spec.ts#L166):

  ```typescript
  resolveForExternalOpen.mockResolvedValue(file(OUTSIDE));
  ```

  The unit test mocked `resolveForExternalOpen` to return a synthetic file result for `OUTSIDE = '/other/repo/x.ts'`, concealing the fact that the real `FileLinkRootPolicy` rejects any path outside registered roots + home + temp.

- **Concrete Scenario**: A user opens workspace `D:\projects\ptah-extension` on Windows. The agent emits a file link `D:\projects\other-repo\main.ts`. Instead of displaying the modal warning allowing the user to confirm opening the file, VS Code shows an error message refusing to open it.
- **Minimal Fix**:
  For VS Code `file:open`, provide a resolution method or option in `FileLinkRootPolicy` (e.g. `resolveForVsCodeOpen`) that allows arbitrary absolute paths outside roots subject to `checkLinkedPathForm` and `isCredentialPath`, so `confirmOutsideWorkspace` can actually be reached for sibling repositories as mandated.

---

### MEDIUM-1: Directory-Name Variations in `CREDENTIAL_DENY_LIST` Evade Directory Matching

- **Severity**: MEDIUM
- **File & Line**: [`libs/backend/rpc-handlers/src/lib/handlers/file-link-root-policy.ts:59-74, 131-151`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/backend/rpc-handlers/src/lib/handlers/file-link-root-policy.ts#L59-L74)
- **Evidence**:
  `CREDENTIAL_DENY_LIST.directories` uses exact segment matching:
  `containsRun(segments, segmentsOf(entry, platform))`.
  For AWS credentials, the files inside `~/.aws/` are named `credentials` or `config`.
  If a user or script backs up their AWS credentials to `~/.aws.bak/credentials` or `~/.aws_old/credentials`:
  - `segmentsOf` produces `['.aws.bak', 'credentials']`.
  - Directory check: `.aws.bak` does not match `.aws`.
  - File check: `credentials` is not in `CREDENTIAL_DENY_LIST.files`.
  - Basename check: `credentials` is not in `CREDENTIAL_DENY_LIST.basenames` (only `id_rsa*`, `*.pem`, `*.key`, `\.env$`, etc.).
    Therefore, `isCredentialPath('~/.aws.bak/credentials')` returns `false`.
- **Concrete Exploit**: An agent links to `~/.aws.bak/credentials` or `~/.aws-backup/credentials`. The credential deny-list permits it, allowing `editor:openFile` with scope `external-link` to hand the credential file to an external editor.
- **Minimal Fix**:
  Add prefix regex or segment prefix matching for sensitive directories (e.g. `/^\.(aws|ssh|gnupg|azure|kube|docker)(\.|$|-|_)/i`) and include sensitive credential basenames like `/^credentials(\.|$)/i`, `/^known_hosts$/i`, and `/^authorized_keys$/i` in `CREDENTIAL_DENY_LIST.basenames`.

---

### MEDIUM-2: `markdown-file-links.ts` Async Handler May Cause Unhandled Promise Rejection Under Cross-Realm / Zone.js Promises

- **Severity**: MEDIUM
- **File & Line**: [`libs/frontend/markdown/src/lib/markdown-file-links.ts:135-139`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/markdown/src/lib/markdown-file-links.ts#L135-L139)
- **Evidence**:
  In `interceptFileLinkActivation`:
  ```typescript
  try {
    const pending = handler.handleMarkdownFileLink(target, anchor);
    if (pending instanceof Promise) void pending.catch(reportHandlerFailure);
  } catch (error: unknown) {
    reportHandlerFailure(error);
  }
  ```
  The check `pending instanceof Promise` strictly requires the native global `Promise` constructor. In the Angular webview shell (`apps/ptah-extension-webview`), Zone.js is active (`ZoneAwarePromise`), or if a handler returns a standard `PromiseLike`/thenable from an external library/iframe, `pending instanceof Promise` returns `false`.
  If that thenable/promise rejects, the rejection is unhandled and escapes `reportHandlerFailure`.
- **Concrete Scenario**: A router in the webview shell returns an async promise that rejects on an RPC failure. Because `pending instanceof Promise` evaluates to `false`, the rejection is unhandled in the browser console.
- **Minimal Fix**:
  Use standard thenable detection:
  ```typescript
  if (pending && typeof (pending as PromiseLike<void>).then === 'function') {
    void (pending as PromiseLike<void>).then(undefined, reportHandlerFailure);
  }
  ```

---

### LOW-1: `EditorRpcHandlers` Surfaces Raw `error.message` Across RPC Boundary on Launch Failure

- **Severity**: LOW
- **File & Line**: [`libs/backend/rpc-handlers/src/lib/handlers/editor-rpc.handlers.ts:172-178, 182-188`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/backend/rpc-handlers/src/lib/handlers/editor-rpc.handlers.ts#L172-L178)
- **Evidence**:
  ```typescript
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      '[editor RPC] launch failed',
      error instanceof Error ? error : new Error(message),
    );
    return { success: false, error: message };
  }
  ```
  When `launcher.openFile` fails (e.g. process spawn failure), `error.message` is returned to the caller in `EditorOpenResult.error`. This leaks host binary paths, command arguments, or system error messages to the renderer, violating the project standard that RPC boundaries return sanitized errors.
- **Concrete Scenario**: A missing editor executable causes `spawn C:\Users\user\AppData\... ENOENT`, exposing internal filesystem structure to the frontend.
- **Minimal Fix**:
  Return a fixed sentence (e.g. `'Failed to launch the requested editor.'`), keeping detailed error information strictly inside `this.logger.warn`.

---

## Verified Safe Implementations

The following security properties were verified by code tracing:

1. **`file:viewContent` Boundary & Containment**:
   - `checkLinkedPathForm` executes before any I/O: successfully rejects UNC shares (`\\`, `//`), NT device namespaces (`\\.\`, `\\?\`), Win32 drive-relative paths (`C:foo`), root-relative paths (`/foo`, `\foo`), alternate data streams (`a.ts:stream`), and control characters (C0 & DEL).
   - Lexical path resolution collapses `..` segments and checks containment via `isPathWithinRoots`.
   - Realpath containment is enforced _after_ resolution, preventing symlink and directory junction escapes outside registered workspace roots.
   - Bounded read reads `FILE_VIEW_MAX_BYTES + 1` (2 MiB), safely catching concurrent file growth after `stat`.
   - Encoding verification validates BOM first, then sniffs for NUL in the first 8000 bytes, then enforces strict UTF-8 decoding. Non-text and binary files fail closed.
   - All failure messages are fixed constants from `FAILURE_MESSAGE`; no raw `error.message` or unauthenticated filesystem paths are returned.

2. **Electron `navigation-policy.ts`**:
   - `isSameDocumentNavigation` only allows same-document reloads on `file:` protocol where `origin` and `pathname` match identically.
   - Non-matching `file:` URLs are prevented and never passed to `shell.openExternal`.
   - `isSafeExternalUrl` restricts external browser navigation strictly to `http:`, `https:`, and `mailto:`.
   - `setWindowOpenHandler` denies all window creation (`{ action: 'deny' }`).
   - Query and hash changes are permitted only within the currently loaded document.

3. **Batch 8c-1 Markdown Link Capture**:
   - Opt-in marker lookup starts at `host.parentElement.closest('[data-ptah-file-links]')`, ensuring that agent-authored markdown inside `<markdown>` cannot opt itself in.
   - DOMPurify permissive sanitizer adds `data-ptah-file-links` to `FORBID_ATTR`, stripping any attempted injection.
   - Anchors inside `pre` and `code` tags are ignored by `interceptFileLinkActivation`.
   - Non-file schemes (`javascript:`, `data:`, `vbscript:`, `http:`, etc.) are rejected by `parseFileLinkHref`.

4. **Batch 7 Rail Persistence and Clamp**:
   - Clamp range `[160, 480]` is enforced on keyboard input, pointer drag, signal updates, and state restoration.
   - Corrupt, non-numeric, or out-of-range values in persisted state fall back safely to defaults or clamped bounds.
   - CSS `max-width: calc(100% - 12rem)` ensures the diff editor pane retains at least 12rem (192px) of space at narrow dock widths.
   - Historical review mode (`branch-review`) is completely decoupled from the working-tree rail signals and layout.

5. **Test Rigor & Honesty**:
   - Electron E2E (`git-rail-collapse.spec.ts`) strictly asserts default 1200x800 window size and ~700px dock width without artificial widening.
   - Uses real pointer movements, real DOM clicks, and real application restart verification.
