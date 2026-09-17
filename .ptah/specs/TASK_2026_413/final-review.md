# Final Review — TASK_2026_413 (Commits feb980285, 3ddc00d40, cfc7513e3)

## Summary

| Metric                 | Value              |
| ---------------------- | ------------------ |
| Overall score          | 8/10               |
| Verdict                | APPROVE_WITH_FIXES |
| Critical issues        | 0                  |
| High severity issues   | 1                  |
| Medium severity issues | 1                  |
| Low severity issues    | 2                  |
| Total findings         | 4                  |

Scope reviewed:

- **Commit `feb980285`**: Read-only file and markdown tab in the Electron git dock (Batch 8b)
- **Commit `3ddc00d40`**: Security remediation (deny-list keyed on real path, `resolveForHostReveal`, launch error sanitization)
- **Commit `cfc7513e3`**: Agent file links routed into the viewer (Batch 8c-2)

---

## Findings by Severity

### HIGH-1: Phantom E2E Spec Claims to Test Tool-Call Chip and Dock Reload Restore, but Tests Neither

- **Severity**: HIGH
- **Status**: PROVED
- **File & Line**: [`apps/ptah-electron-e2e/src/specs/git/agent-file-links.spec.ts:329-373`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/apps/ptah-electron-e2e/src/specs/git/agent-file-links.spec.ts#L329-L373)
- **Evidence**:
  The test title and comments claim to test two distinct acceptance criteria:
  ```typescript
  test('a tool-call file chip opens a tab, and a renderer reload restores the dock (A6/A7, D10)', async ({
    mainWindow,
    ui,
  }) => {
  ```
  However, in the test body:
  1. **Tool-call chip click is missing**: Lines 351-356 push standard assistant text (`assistantText(sessionId, AGENT_MARKDOWN)`) containing markdown links `[a](src/a.ts:12:3)`. It then executes `await bubble.getByRole('link', { name: 'a', exact: true }).click()`. This is an identical markdown anchor click to test 1. No tool call event is dispatched, no tool-call chip (`FilePathLinkComponent` / `[data-testid="file-path-link"]`) is ever rendered, and no chip click is tested.
  2. **Dock reload restoration is omitted**: Lines 364-372 state in a comment:
     ```typescript
     // Deliberately NOT asserted here: that the dock re-mounts after a bare
     // page.reload(). Dock-state restore is proven by
     // `git source-control rail`, which relaunches the whole app — the path the
     // persisted `electron-layout` state is actually designed for.
     const urlBefore = mainWindow.url();
     await mainWindow.reload();
     await mainWindow.waitForLoadState('domcontentloaded');
     await expect(mainWindow.locator('ptah-root')).toBeAttached();
     expect(mainWindow.url()).toBe(urlBefore);
     ```
     The test explicitly declines to assert that the dock or any file tab restores after reload, asserting only that `<ptah-root>` is attached and the URL did not change.
- **Why It Is Wrong**:
  This is a phantom test that provides false confidence. It purports to satisfy Batch 8c-2 AC 21 ("FilePathLink... open in the Electron viewer") and A6/A7/D10 ("dock state restores across reload"), but exercises neither. If `FilePathLinkComponent` integration breaks in the Electron shell, this e2e spec will remain green.
- **Smallest Correct Fix**:
  In `agent-file-links.spec.ts`, dispatch a real tool-call event payload (e.g. `tool_use` with a file path) that mounts `FilePathLinkComponent`, click the rendered chip (`[data-testid="file-path-link"]` or `ptah-file-path-link span[title]`), and assert that a dock tab opens. If dock restore across reload is already tested elsewhere, update the test title to accurately state what it verifies (e.g., `'preserves window url across document reload'`).

---

### MEDIUM-1: Credential Deny-List Evaded on macOS Due to Case-Sensitivity Mismatch with APFS

- **Severity**: MEDIUM
- **Status**: PROVED
- **File & Line**: [`libs/backend/rpc-handlers/src/lib/handlers/file-link-root-policy.ts:98-102, 147-151, 185-187`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/backend/rpc-handlers/src/lib/handlers/file-link-root-policy.ts#L98-L102) and [`libs/backend/rpc-handlers/src/lib/handlers/file-link-root-policy.spec.ts:151-156`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/backend/rpc-handlers/src/lib/handlers/file-link-root-policy.spec.ts#L151-L156)
- **Evidence**:
  In `file-link-root-policy.ts`:

  ```typescript
  function segmentsOf(value: string, platform: NodeJS.Platform): string[] {
    const normalized = value.replace(/\\/g, '/');
    const cased = platform === 'win32' ? normalized.toLowerCase() : normalized;
    return cased.split('/').filter((segment) => segment.length > 0);
  }
  ```

  And `directoryPrefixes` is defined without the `/i` flag:

  ```typescript
  directoryPrefixes: [/^\.(ssh|gnupg|aws|azure|kube|docker)([._-]|$)/],
  ```

  The comment at lines 98-101 (and test comment at `file-link-root-policy.spec.ts:151-152`) states:

  > "Written in lower case WITHOUT the `i` flag on purpose: `segmentsOf` already lower-cases on win32, so these stay case-insensitive there and case-SENSITIVE on posix, where `.SSH` is a genuinely different directory."

  On macOS (`process.platform === 'darwin'`), the default filesystem (APFS) is **case-insensitive and case-preserving**. On macOS:
  - `platform !== 'win32'`, so `segmentsOf` does **not** convert the path to lowercase.
  - A path such as `~/.AWS/config`, `~/.DOCKER/config.json`, `~/.KUBE/config`, or `~/.SSH/config` produces uppercase segments (`['.AWS', 'config']`).
  - `CREDENTIAL_DENY_LIST.directories` fails strict string comparison (`'.AWS' !== '.aws'`).
  - `CREDENTIAL_DENY_LIST.directoryPrefixes` regex lacks `/i`, failing `.test('.AWS')`.
  - `CREDENTIAL_DENY_LIST.basenames` checks `config` and `config.json`, neither of which is in `basenames`.
  - `isCredentialPath('/Users/user/.AWS/config', 'darwin')` returns `false`!

- **Why It Is Wrong**:
  On macOS, `/Users/user/.AWS/config` is the exact same file on disk as `/Users/user/.aws/config`. An agent link to `~/.AWS/config` bypasses the credential deny-list on Darwin, allowing credentials and tokens to be opened or revealed without denial.
- **Smallest Correct Fix**:
  Normalize case on Darwin as well as Windows, or add the `/i` flag to directory prefix matching and lowercase candidate segments when checking `CREDENTIAL_DENY_LIST.directories` on case-insensitive platforms:
  ```typescript
  const isCaseInsensitive = platform === 'win32' || platform === 'darwin';
  const cased = isCaseInsensitive ? normalized.toLowerCase() : normalized;
  ```

---

### LOW-1: `directoryPrefixes` Regex Over-Matches Common Non-Credential Dot-Docker Files

- **Severity**: LOW
- **Status**: PROVED
- **File & Line**: [`libs/backend/rpc-handlers/src/lib/handlers/file-link-root-policy.ts:102, 185-187`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/backend/rpc-handlers/src/lib/handlers/file-link-root-policy.ts#L102)
- **Evidence**:
  In `file-link-root-policy.ts`:
  ```typescript
  directoryPrefixes: [/^\.(ssh|gnupg|aws|azure|kube|docker)([._-]|$)/],
  ```
  In `isCredentialPath`:
  ```typescript
  for (const pattern of CREDENTIAL_DENY_LIST.directoryPrefixes) {
    if (segments.some((segment) => pattern.test(segment))) return true;
  }
  ```
  `segments` includes every path component, including the terminal file basename.
  For any file located outside the workspace (e.g. in home or temp) named `.docker-compose.yml`, `.docker-compose.yaml`, or `.docker.env`:
  - `segment` is `.docker-compose.yml`.
  - `/^\.(ssh|gnupg|aws|azure|kube|docker)([._-]|$)/.test('.docker-compose.yml')` matches because `.docker` is followed by `-`.
  - `isCredentialPath` evaluates to `true`.
- **Why It Is Wrong**:
  `.docker-compose.yml` is an ordinary compose configuration file, not a credential directory. When referenced outside registered workspace roots (e.g. in `~` or scratch temp folders), opening it in an external editor is blocked because it is misclassified as an SSH/AWS credential directory.
- **Smallest Correct Fix**:
  Only test directory prefix patterns against ancestor directory segments (`segments.slice(0, -1)`), or test the leaf segment against `pattern` only if known to be a directory, and exempt standard files like `^\.docker-compose`:
  ```typescript
  const dirSegments = segments.slice(0, -1);
  for (const pattern of CREDENTIAL_DENY_LIST.directoryPrefixes) {
    if (dirSegments.some((segment) => pattern.test(segment))) return true;
  }
  ```

---

### LOW-2: Deny-List Misses Renamed Multi-Segment Config Dirs and File Backup Extensions

- **Severity**: LOW
- **Status**: PROVED
- **File & Line**: [`libs/backend/rpc-handlers/src/lib/handlers/file-link-root-policy.ts:71-145`](file:///D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/backend/rpc-handlers/src/lib/handlers/file-link-root-policy.ts#L71-L145)
- **Evidence**:
  1. `CREDENTIAL_DENY_LIST.directories` contains multi-segment runs: `'.config/gcloud'`, `'.config/gh'`, `'.config/git'`.
     However, `directoryPrefixes` only matches `/^\.(ssh|gnupg|aws|azure|kube|docker)([._-]|$)/`.
     If a user has backup directories like `~/.config/gh.bak/hosts.yml` or `~/.config/gcloud.bak`, they do not match `directoryPrefixes` or `directories`.
     Because `hosts.yml` is not in `basenames`, `~/.config/gh.bak/hosts.yml` (containing GitHub personal access tokens) is not recognized as a credential path.
  2. `CREDENTIAL_DENY_LIST.files` matches exact terminal runs: `.npmrc`, `.git-credentials`, `.netrc`, `.pgpass`.
     A backup script that produces `~/.npmrc.bak`, `~/.git-credentials.old`, or `~/.netrc.backup` will not match `files` (because of `endsWithRun`), nor `basenames` (which lacks these stems).
- **Why It Is Wrong**:
  While single-segment directories (`.ssh`, `.aws`) and common keys (`id_rsa`, `credentials`) are guarded against backup renames, multi-segment config directories (`gh`, `gcloud`) and file-level secrets (`.npmrc`, `.git-credentials`) can still be leaked via common backup naming patterns.
- **Smallest Correct Fix**:
  Add `gcloud` and `gh` to `directoryPrefixes` (e.g. matching `gh` or `gcloud` under `.config`), and add `/^\.(npmrc|git-credentials|netrc|pgpass)(\.|$)/i` to `CREDENTIAL_DENY_LIST.basenames`.

---

## Detailed Audit Results

### 1. Test Honesty

- **`apps/ptah-electron-e2e/src/specs/git/agent-file-links.spec.ts:329-373`**: Finding HIGH-1 above. The test claims in its title to exercise tool-call chips and dock reload restoration, but does neither.
- **`apps/ptah-electron-e2e/src/specs/git/file-view-tab.spec.ts:145`**: Prior to commit `cfc7513e3`, the selector was `'Close readme.md'`, which could not match the rendered button `'Close file readme.md'`. Fixed in commit `cfc7513e3`.
- **`apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.spec.ts:172-252`**: Verified honest. Following finding HIGH-2 in the previous review, the test now instantiates a real `FileLinkRootPolicy` against real files created in temp directories, verifying that out-of-root files reach modal confirmation while credentials and invalid path forms are rejected without confirmation.
- **`libs/frontend/git-ui/src/lib/services/diff-tabs.service.spec.ts:1138-1165`**: Proves that stale responses cannot overwrite newer ones by managing two unresolved promises and verifying that the newer `requestId` wins.
- **`libs/frontend/git-ui/src/lib/file-view/file-view.component.spec.ts:163-184`**: Proves Monaco cursor clamping against fake Monaco line counts.
- **`libs/frontend/git-ui/src/lib/file-view/file-view.component.spec.ts:308-314`**: Performs source inspection to assert absence of `[innerHTML]` in `FileViewComponent`.

### 2. Security Fixes Verification

- **Real-Path Containment**: Commit `3ddc00d40` replaced lexical root checking with `this.isInsideRegisteredRoots(resolution.realPath)`. Containment against realpath'd workspace roots and worktrees prevents symlink escapes into `~/.ssh`.
- **Host Reveal Policy (`resolveForHostReveal`)**: Correctly enforces:
  1. Form check on input path.
  2. Absolute path enforcement (`no-base-root` for relative paths).
  3. `realpath` resolution.
  4. Form check re-applied to `realPath` (preventing junction escapes to UNC shares).
  5. Credential deny-list checked on both `lexical` and `realPath`.
  6. File kind check (regular file or directory if allowed).
- **External Open Policy (`resolveForExternalOpen`)**: Retains narrow root boundaries (`registered ∪ home ∪ temp`).
- **Path Attack Resistances**:
  - Symlink/junction chains resolve to canonical targets through `nodeFs.realpath`.
  - Symlinked workspace roots are resolved via `realpathAll(registered)` before containment comparison.
  - Clean lexical forms resolving to dirty real targets (UNC / devices) are intercepted at `resolveLinkedFilePath:372` and `resolveForHostReveal:328`.

### 3. End-to-End Link Path

- **Marked Extension & DOMPurify**: Marked rewrites file links to `data-ptah-file-href` with `href="#"`. DOMPurify permits `data-ptah-file-href` and `ptah-file-link` while stripping `data-ptah-file-links` via `FORBID_ATTR`.
- **Capture Listener**: `provideMarkdownFileLinks` installs a capture-phase listener that only activates within elements having an ancestor with `data-ptah-file-links`. Anchors inside `<pre>` and `<code>` are ignored. Thenables are properly awaited and caught regardless of Zone.js or cross-realm origins.
- **Context Isolation**: `FileLinkRouterService.resolveContext` starts searching at `origin?.closest('markdown, [markdown]')?.parentElement ?? origin`. This guarantees that agent-authored markdown attributes cannot forge `data-ptah-link-document` or `data-ptah-tab-id`.
- **Host Routing**:
  - Electron: Lazily imports `@ptah-extension/git-ui`, sets layout mode to `working-tree`, and opens a read-only tab in `DiffTabsService`.
  - VS Code: Dispatches `file:open` RPC with line, column, and workspace root.

### 4. Dock Tab State and Correctness

- **Shared Tab Model**: `EditorTab` cleanly models either `diff` or `view`.
- **Tab Strip Integration**: Switching tabs, keyboard navigation, and closing tabs work uniformly across mixed diff and view tabs.
- **Monaco Lifecycle**: `FileViewComponent` creates Monaco in `afterNextRender` outside Angular, disposes previous models on tab switch, and completely cleans up the editor, model, and theme observer on destroy.
- **Readable Refusal State**: When backend policy blocks a file (e.g. `outside-roots`), the tab renders a readable alert message and offers an external editor button (if allowed) protected by a confirmation modal, avoiding blank editor states.

### 5. Repository Conformance

- **Module Boundaries**: Frontend packages strictly avoid importing backend packages.
- **Angular Standards**: `ChangeDetectionStrategy.OnPush`, signal inputs/outputs, and `inject()` are consistently utilized. No manual Zone dependencies.
- **Error Handling**: Strict `catch (error: unknown)` narrowing. RPC endpoints (`editor-rpc.handlers.ts`, `file-rpc.handlers.ts`) return fixed sanitized messages without leaking system error strings or paths.
- **Template Hygiene**: Zero `[innerHTML]` bindings outside the marked/DOMPurify library.
- **DI Configuration**: Providers are registered in the correct phases and app configs.

---

## Verdict

**APPROVE_WITH_FIXES** (Score: 8/10).
The architecture, security containment, and cross-surface integration are robust and well-designed. The 4 findings above (1 high phantom e2e test, 1 medium macOS case-sensitivity gap, and 2 low deny-list adjustments) should be addressed before merging to main.
