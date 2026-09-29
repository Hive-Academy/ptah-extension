# Implementation Plan - TASK_2026_576_e16a

Overhaul of the git review experience: reliability fixes for root causes 1-14 (RC1-RC14), then a new
Electron review surface, a host-agnostic change-set card, and a VS Code native review path.

All paths are absolute under `D:/projects/ptah-extension/`, written as `D:/projects/ptah-extension/<path>`
in the file lists. In prose and evidence they are repo-relative (`libs/...`). Line numbers were read on
2026-09-29 at `main` (`722d921ab`).

Rule tags used throughout:

- `[user-requested]` — the user asked for it (`context.md`, `task-description.md` Gate 1, `design-spec.md` Gate 1.7).
- `[project-rule: <source>]` — the repository already requires it.
- `[lane-proposed]` — this plan adds it. It needs Gate 2 approval like the rest of the plan.

---

## Inputs and constraints

- Requirements used:
  - `.ptah/specs/TASK_2026_576_e16a/context.md` (Gate decisions)
  - `task-description.md` (Gate 1 APPROVED)
  - `parity-inventory.md` (4 removals approved at Gate 1)
  - `design-spec.md` and `prototype/README.md` (Gate 1.7 APPROVED)
  - `research-report.md`, `task-description-review.md`, `design-spec-review.md`
  - `research_notes/In app editor alternatives/git-backend-root-causes.md`
  - Lane evidence, spot-checked against source before use: `investigation/arch-lane-chat-card.md` (Glm) and `investigation/arch-lane-vscode-di.md` (antigravity)
- Corrections applied to the handed-down inputs:
  1. **RC10 hook premise (research-report Q4).** The research says Ptah's `WorktreeRemove` hook never fires, because Ptah's worktrees are "git-based, not WorktreeCreate-hook-owned". The source contradicts that premise: Ptah registers a `WorktreeCreate` hook, and that hook itself creates the worktree (`worktree-hook-handler.ts:152-260` calls `gitInfo.addWorktree` at 199-203). By the maintainer's own quoted rule, `WorktreeRemove` is the counterpart for exactly those worktrees. Neither reading is proven. The plan therefore implements both paths, and each is idempotent (Component 12). See Assumption A5.
  2. **Status-badge AA fix (design-spec §13a).** The design proposed per-theme hex overrides tuned to `anubis`/`anubis-light`. The webview ships 34 themes: `styles.css:119-150` states that "the other 32 daisyUI themes are compiled into the deferred `theme-extra.css`", and per-theme `--bcm` values follow at `styles.css:151+`. A two-theme hex override would leave 32 themes unfixed. Component 18 fixes the badge without theme-specific colours and records this as a clarification with a default.
  3. **Eager-import removal pattern.** The orchestrator brief implies a new mechanism. The repository already has one: the narrow `/services` entry point (`eslint.config.mjs:227-253`, invariant I-3 of TASK_2026_187; `libs/frontend/skill-synthesis-ui/src/services.ts:1-20`). Component 16 reuses it.
  4. **Requirement 3.2 measurement.** `research-report.md` already records the real-build measurement for `@pierre/diffs` 1.5.1 (JavaScript regex engine, fine-grained grammars) and for `@codemirror/merge`, with the choice and its reason. That satisfies Requirement 3.2 as written. The plan adds a re-measurement gate once the real adapter exists (Component 17), and does not ask for a second benchmark before P3.
- Design handoff used: `design-spec.md` §0-§15 and `prototype/README.md`. Component names come from design-spec §15: `ReviewShellComponent`, `ReviewCanvasComponent`, `CommitComposerComponent`, `TaskWorktreeViewComponent`, `HistoryTimelineComponent`.
- Missing decision-critical input: none that blocks design. Two choices the user may want to make are listed under Clarifications Needed. The plan proceeds with the recommended defaults.
- Repository instruction files: there is no root `CLAUDE.md` and no per-lib `CLAUDE.md` (searched `libs/**` and `apps/**`). `CONVENTIONS.md` is the authority. Its rules:
  - barrel ≤150 lines, §3;
  - layer rule, §8;
  - naming suffixes, §6;
  - `Symbol.for` tokens, §4;
  - one `register*Services`, §5;
  - synchronous idempotent `dispose()`, §9.

---

## Codebase evidence

| Evidence                                                                                                                                                                               | Location                                                                                                                                                                                                                     | Architectural implication                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default git timeout is 10 s. The worktree timeout is 300 s. The output cap is 64 MiB. The gate allows at most 4 processes.                                                             | `libs/backend/vscode-core/src/utils/exec-git.ts:10-24`                                                                                                                                                                       | The RC2/RC8 constants live beside these. The default stays for reads.                                                                                    |
| Forced env is `LC_ALL=C`, `LANG=C`, `GIT_OPTIONAL_LOCKS=0`.                                                                                                                            | `exec-git.ts:399-403`                                                                                                                                                                                                        | Error classification can match C-locale stderr (index.lock, not-a-repo).                                                                                 |
| Calls with a timeout above 60 s wait in the `background` gate lane.                                                                                                                    | `exec-git.ts:573-585`                                                                                                                                                                                                        | Commits with a long timeout move to the background lane. Risk R6.                                                                                        |
| On timeout: SIGTERM, then tree kill, then SIGKILL after a grace period. There is no cancel input.                                                                                      | `exec-git.ts:642-665`                                                                                                                                                                                                        | Add `signal?: AbortSignal` and `onOutput?`. Lock recovery goes after the kill.                                                                           |
| `GitInfoService.execGit` invalidates the read cache from `isMutatingGitCommand(args)`, which reads `args[0]`.                                                                          | `git-info.service.ts:149-177, 2911-2919`                                                                                                                                                                                     | A leading `-c k=v` would read as a mutation. The classifier must skip `-c` pairs (Component 5).                                                          |
| Status runs without `-z`. The parser splits on spaces and tabs. `u` rows become `M`. Unknown codes become `M`.                                                                         | `git-info.service.ts:602-606, 3072-3162`                                                                                                                                                                                     | RC4/RC12: replace with a porcelain-v2 `-z` parser in a new file.                                                                                         |
| A status failure or throw returns `files: []` without `statusUnavailable`. `isGitRepo` turns any throw into `false`.                                                                   | `git-info.service.ts:608-618, 660-676, 2882-2900`                                                                                                                                                                            | RC3: tri-state repo probe plus reason codes.                                                                                                             |
| `discardChanges` parses porcelain v1 with `substring(3).trim()`.                                                                                                                       | `git-info.service.ts:872-939`                                                                                                                                                                                                | RC4: reuse the `-z` parser.                                                                                                                              |
| `commit` has no timeout. The hash regex misses `root-commit` and `detached HEAD`.                                                                                                      | `git-info.service.ts:946-979`                                                                                                                                                                                                | RC1/RC2: hook timeout, hook output, fixed hash parse.                                                                                                    |
| `DIFF_FLAGS = ['-U3','--no-color','--no-ext-diff']` feeds both reading the patch and applying it.                                                                                      | `git-info.service.ts:105`                                                                                                                                                                                                    | RC7: pin prefixes and `--no-textconv` here.                                                                                                              |
| `checkout` treats any `status --porcelain` output as dirty, including untracked files. It uses `checkout -b` with no `--`.                                                             | `git-info.service.ts:2394-2437`                                                                                                                                                                                              | RC9 and RC14 rewrite.                                                                                                                                    |
| `getLastCommit` passes `ref` bare to `git log`. `validatePathSegment` only rejects `..`.                                                                                               | `git-info.service.ts:2205-2216, 2824-2847`                                                                                                                                                                                   | RC14: new ref guard.                                                                                                                                     |
| `--end-of-options` is already used once.                                                                                                                                               | `libs/backend/vscode-core/src/services/git-review-reader.service.ts:291`                                                                                                                                                     | Established pattern for RC14.                                                                                                                            |
| The worktree RPCs ignore `params.workspaceRoot`. `resolveRoot` exists.                                                                                                                 | `libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.ts:287-311, 317-330, 343-350, 406-414`                                                                                                                          | RC10 scoping reuses `resolveRoot`.                                                                                                                       |
| `GitRpcHandlers.METHODS` feeds the manifest-coverage invariant.                                                                                                                        | `git-rpc.handlers.ts:119-146`; `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:14-21, 191-196`                                                                                                                   | New methods need a manifest entry. The union of entries must equal `RPC_METHOD_NAMES`.                                                                   |
| Capabilities are a closed list. `editorLauncher` and `fileViewer` exist.                                                                                                               | `libs/backend/rpc-handlers/src/lib/host-profile/capabilities.ts` (`RPC_CAPABILITIES`)                                                                                                                                        | Adding `fileEditor` gives least privilege for the spot-editor write path.                                                                                |
| The typed registry and runtime name map both need entries for every RPC.                                                                                                               | `libs/shared/src/lib/types/rpc.types.ts:692` (`RpcMethodRegistry`), `:3750-3775` (name map), `:4003` (`RPC_METHOD_NAMES`)                                                                                                    | Every new RPC gets three edits in shared.                                                                                                                |
| The `git:` and `command:` prefixes are already allowed.                                                                                                                                | `libs/backend/vscode-core/src/messaging/rpc-handler.ts:62, 70`                                                                                                                                                               | New RPCs stay under `git:`, `file:` and `editor:`. No new prefix.                                                                                        |
| The renderer RPC default is 30 s. The client drops late replies.                                                                                                                       | `libs/frontend/core/src/lib/services/rpc-call.util.ts:127-133, 185-210`                                                                                                                                                      | RC8: pass explicit timeouts derived from the backend constants.                                                                                          |
| The command allowlist is the `ptah.` prefix plus two exact entries.                                                                                                                    | `libs/backend/rpc-handlers/src/lib/handlers/command-rpc.handlers.ts:29, 35-40, 122-127`                                                                                                                                      | Requirement 5.5 holds by construction for `ptah.review.*`.                                                                                               |
| No `vscode.git` API use, no `vscode.diff`, no `TextDocumentContentProvider` exists.                                                                                                    | lane Q3, negative search; spot-checked                                                                                                                                                                                       | Component 21 introduces a Ptah-owned HEAD content provider.                                                                                              |
| Path containment helper.                                                                                                                                                               | `libs/backend/platform-core/src/utils/path-containment.ts:64` (`isPathWithinRoots`)                                                                                                                                          | Requirement 5.6 and the `file:saveContent` containment check.                                                                                            |
| `GitInfoService` is transient in VS Code and CLI, and a singleton `useValue` in Electron.                                                                                              | `apps/ptah-extension-vscode/src/di/phase-3-handlers.ts:58-60`; `libs/backend/cli-engine/src/lib/container.ts:445-447`; `apps/ptah-electron/src/di/phase-4-handlers.ts:117-120`                                               | RC13 fix.                                                                                                                                                |
| `instanceCachingFactory` has precedent.                                                                                                                                                | `libs/backend/auth-providers/src/lib/providers/register-providers.ts:63-67`                                                                                                                                                  | RC13 uses the same idiom.                                                                                                                                |
| The watcher uses non-recursive `fs.watch` on HEAD, index and refs, arms only files that exist, and follows `gitdir:` but not `commondir`.                                              | `apps/ptah-electron/src/services/git-watcher.service.ts:294-323, 346-373, 520-580`                                                                                                                                           | RC5 rewrite.                                                                                                                                             |
| `IWorkspaceWatcher` is recursive, batched and overflow-signalling. It is backed by `@parcel/watcher` in Electron.                                                                      | `libs/backend/platform-core/src/interfaces/workspace-watcher.interface.ts:87-191`; lane Q6: `libs/backend/platform-electron/src/workspace-watch/parcel-watcher-engine.ts:28`                                                 | RC5 reuses this port for the gitdir and commondir. There is no new watch engine and no Windows-only code path.                                           |
| Watcher construction site.                                                                                                                                                             | `apps/ptah-electron/src/activation/boot-heavy-services.ts:403-410`                                                                                                                                                           | Constructor signature stays.                                                                                                                             |
| Git read errors are a closed code set, never stderr.                                                                                                                                   | `libs/shared/src/lib/types/rpc/rpc-git.types.ts:299-322, 438-459`                                                                                                                                                            | New failure codes follow the same closed-set rule.                                                                                                       |
| `statusUnavailable` is only `'output-too-large'`.                                                                                                                                      | `rpc-git.types.ts:104-117`                                                                                                                                                                                                   | RC3 widens it.                                                                                                                                           |
| The eager import of git-ui services, the Monaco provider and the Monaco asset copy.                                                                                                    | `apps/ptah-extension-webview/src/app/app.config.ts:13, 62-67, 208-211, 285-287`; `apps/ptah-extension-webview/project.json:22-26`                                                                                            | P3/P4 removal points.                                                                                                                                    |
| Narrow `/services` entry-point precedent, and a lint exemption list for it.                                                                                                            | `eslint.config.mjs:227-253`; `libs/frontend/skill-synthesis-ui/src/services.ts:1-20`; `tsconfig.base.json:87-88`                                                                                                             | Component 16 pattern.                                                                                                                                    |
| Push-handler services gate on `startListening` or have no side effects when unarmed, except `WorktreeService`.                                                                         | `libs/frontend/git-ui/src/lib/services/git-status.service.ts:244-277`; `git-branches.service.ts:189-212`; `worktree.service.ts:297-336`                                                                                      | Keeping them eager (narrow entry) preserves behaviour. A lazy relay would have to special-case `WorktreeService`.                                        |
| Existing native-dialog alertdialog contract: showModal (top layer), focus on Cancel, Escape cancels, Tab trapped, focus restored, no backdrop dismiss.                                 | `libs/frontend/git-ui/src/lib/diff-view/diff-view.component.ts:482-567, 1159-1181, 1784-1830`                                                                                                                                | Item 6 resolution (Component 25).                                                                                                                        |
| The `ui` lib prefers CDK-free `native` components. `NativePopoverComponent` is "popover without CDK FocusTrap".                                                                        | `libs/frontend/ui/src/index.ts:16-27`                                                                                                                                                                                        | `[project-rule]` source for item 6.                                                                                                                      |
| The git-ui barrel doc says "Depends on core and shared only — never on chat, ui or editor". It already imports `@ptah-extension/markdown`.                                             | `libs/frontend/git-ui/src/index.ts:1-11`; `file-view/file-view.component.ts:16`                                                                                                                                              | The doc comment is already stale. This plan permits `git-ui → ui` (type:feature → type:ui is legal, `eslint.config.mjs:364-373`) and keeps "never chat". |
| Nx tags: chat, chat-ui and git-ui are `scope:webview`/`type:feature`; ui is `type:ui`; core is `type:core`.                                                                            | lane Q5; `libs/frontend/git-ui/project.json` (tags)                                                                                                                                                                          | The card in chat-ui can use ui. git-ui can use ui. chat already imports git-ui dynamically.                                                              |
| Core-defined port tokens provided by chat in the app composition root.                                                                                                                 | `libs/frontend/core/src/lib/tokens/file-link-opener.token.ts:32-41`; `app.config.ts:186-196`                                                                                                                                 | The `AGENT_FEEDBACK_SENDER` port follows this. git-ui never imports chat.                                                                                |
| Turn end: `SdkAdapterEvents.onTurnEnded` gives the notifier `{sessionId, cwd, ...}`.                                                                                                   | `libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-events.service.ts:188`; `libs/backend/rpc-handlers/src/lib/handlers/session-lifecycle-notifier.ts:58-65, 116-141`; `libs/shared/src/lib/types/sdk-hook.types.ts:115-123` | The change-set recorder subscribes to the same bus.                                                                                                      |
| Turn start: `UserPromptSubmitCallbackRegistry` gives `{prompt, sessionId, workspaceRoot, timestamp}` and has `register()`.                                                             | `libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-callback-registry.ts:8-23`; `callback-registry.base.ts:22`; token `SDK_USER_PROMPT_SUBMIT_CALLBACK_REGISTRY`, `libs/backend/agent-sdk/src/lib/di/tokens.ts:105`   | Supplies the baseline snapshot for per-turn diffs.                                                                                                       |
| The notifier is registered as a singleton and activated once `WEBVIEW_MANAGER` exists.                                                                                                 | `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts:49, 58-61`                                                                                                                                                | The recorder is registered and activated beside it.                                                                                                      |
| Session metadata store rule: "Nothing unbounded goes in the blob". Bulk data goes under its own key (`ptah.agentOutput:<agentId>`). It uses `PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE`. | `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:20-30, 153, 246, 403`                                                                                                                                              | Change sets go under their own key per session, `ptah.turnChangeSets:<sessionId>`.                                                                       |
| Transcript iteration and the per-message bubble.                                                                                                                                       | lane Q7: `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html:34-60`                                                                                                                   | Card insertion point.                                                                                                                                    |
| `StrictChatMessage.timestamp`.                                                                                                                                                         | `libs/shared/src/lib/types/messages/session.ts:16`                                                                                                                                                                           | Card-to-turn join by time window. See Assumption A7.                                                                                                     |
| Curator pattern: `IProviderAuthResolver.resolve`. On `ProviderAuthError` it rides the active provider. On `ProviderQuotaError` it stops. The result is discriminated.                  | `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:53-141, 229-255, 417-443`                                                                                                              | Commit-message generator template.                                                                                                                       |
| `InternalQueryService.execute` wraps `SdkQueryRunner.runOneShot`. `USER_ACTION_QUERY_LANE` is the ungoverned lane for user clicks.                                                     | `libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts:120`; `internal-query-concurrency-gate.ts:25-33`; `sdk-query-runner.service.ts:133-150, 263`                                                        | The generator calls `internalQuery.execute({ lane: USER_ACTION_QUERY_LANE, ... })`.                                                                      |
| The editor launch path handles Windows `.cmd` shims through the cross-spawn `_parse` path. It never uses `shell:true`.                                                                 | lane Q7: `libs/backend/platform-core/src/utils/editor-launcher-detection.ts:218-228, 342-356, 550-568`; `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts:160-177`                                       | Requirement 11.3 reuses the launcher. No new spawn path.                                                                                                 |
| Electron opens https in the system browser.                                                                                                                                            | `apps/ptah-electron/src/windows/main-window.ts:46, 80`                                                                                                                                                                       | "Open PR" is a validated `https:` anchor. No new RPC.                                                                                                    |
| The Electron renderer CSP is `script-src 'self'`, `style-src 'unsafe-inline'` and `worker-src 'self' blob:`.                                                                           | `apps/ptah-electron/scripts/copy-renderer.js:156-169`                                                                                                                                                                        | Pierre and Shiki must not need `eval`. See Assumption A2.                                                                                                |
| `file:viewContent` is a contained, sanitized read with a 2 MiB cap.                                                                                                                    | `libs/backend/rpc-handlers/src/lib/handlers/file-view-rpc.handlers.ts:1-185`; `libs/shared/src/lib/types/rpc/rpc-misc.types.ts:163-226`                                                                                      | The spot-editor write mirrors this contract, in a separate handler.                                                                                      |
| Pierre 1.5.1: `lineDiffType` is `'word-alt'` (default), `'word-line'`, `'word'`, `'char'` or `'none'`.                                                                                 | `pierrecomputer/pierre` `packages/diffs/src/types.ts:418, 458-462` (read via `gh api`; `main` is at `version: 1.5.1`; tag `diffs-v1.5.1` exists)                                                                             | Item 5: set `lineDiffType: 'word'`.                                                                                                                      |
| Pierre emits a hunk-separator slot `hunk-separator-<type>-<hunkIndex>` only when there are collapsed lines before the hunk. Annotation slots are `annotation-<side>-<lineNumber>`.     | `packages/diffs/src/renderers/DiffHunksRenderer.ts:2406-2408, 2456-2500`; `utils/getLineAnnotationName.ts`                                                                                                                   | Hunk toolbar hosting needs a fallback slot (Component 17).                                                                                               |
| Pierre `parseDiffFromFile(oldFile, newFile)` builds a patch from two strings.                                                                                                          | `packages/diffs/src/utils/parseDiffFromFile.ts`                                                                                                                                                                              | Skills clone-diff migration (Requirement 8.3).                                                                                                           |
| Axe helper precedent.                                                                                                                                                                  | `apps/ptah-landing-page-e2e/src/support/axe.ts`                                                                                                                                                                              | The Electron e2e axe helper copies its shape.                                                                                                            |
| Electron e2e and CI run on `ubuntu-latest` only.                                                                                                                                       | `.github/workflows/electron-e2e.yml:36`, `.github/workflows/ci.yml:36`                                                                                                                                                       | Cross-platform evidence for RC5 and Requirement 11.3 needs a new OS matrix job.                                                                          |
| Large-file split rule: the original keeps every public method and delegates, so it becomes a facade.                                                                                   | `.claude/skills/humanize-library/references/refactor-recipes.md:79-96`                                                                                                                                                       | `GitInfoService` gains collaborators and stays the public surface.                                                                                       |
| The vscode-core barrel is already 169 lines, over the §3 limit.                                                                                                                        | `libs/backend/vscode-core/src/index.ts` (counted)                                                                                                                                                                            | New vscode-core collaborators stay internal. Only types that cross a lib boundary are exported. See the Maintainability constraints.                     |

---

## Architecture decision

- **Chosen approach.** Keep `GitInfoService` as the public facade. Move every new git responsibility into small collaborators under `libs/backend/vscode-core/src/services/git/`:
  - write lock
  - `-z` status parser
  - ref guard
  - repo-operation reader
  - worktree admin
  - history reader
  - GitHub PR reader

  RPC contracts grow in `libs/shared` only. The Electron UI is rebuilt inside the existing lazy `git-ui` lib:
  - a four-tab review shell
  - a Pierre renderer adapter in a secondary entry point
  - a CodeMirror 6 spot editor

  Only the push-handler services stay eager, through a narrow `@ptah-extension/git-ui/services` entry. The host-agnostic change-set card has three parts:
  - a presentational component in `chat-ui`
  - a store and actions in `chat`
  - a backend recorder that persists per-turn snapshots under its own storage key

  VS Code gets `ptah.review.*` commands and a Ptah-owned HEAD content provider, so it does not depend on `vscode.git` for diffs.

- **Rationale.**
  - Every surface consumes the P1 result contracts, so the contracts land first and ship alone `[user-requested: Gate 1 default 2]`.
  - Collaborators rather than more lines in a 3,163-line file `[project-rule: refactor-recipes.md:79-96]`.
  - Narrow `/services` entry `[project-rule: eslint.config.mjs:227-253]`.
  - The port-token boundary keeps git-ui free of chat `[project-rule: file-link-opener.token.ts:32-41; task NFR]`.
- **Rejected alternatives.**
  1. _Lazy push relay in the app instead of `/services`._ It moves more bytes, but it is a new pattern and needs a message queue. `WorktreeService` also acts on pushes while unarmed (`worktree.service.ts:297-336`), so the relay would have to force a load for that type anyway. The established pattern already satisfies Requirement 3.1 because services have no selectors.
  2. _A new `libs/frontend/diff-renderer` lib._ It has only two consumers (git-ui canvas, skill-synthesis clone drawer). A secondary entry point in git-ui (`@ptah-extension/git-ui/diff-renderer`) gives the same lazy boundary without eight new project files.
  3. _Pierre `CodeView` owning the whole multi-file list._ Angular would lose the per-file sticky headers, the file-level state and the parity-required file rows. The default is an Angular-owned file list with one Pierre instance per mounted file. The choice is confirmed by the spike in Component 17 (Assumption A9).
  4. _Angular CDK Dialog and FocusTrap for confirmations_ (design-spec §2). It adds new CDK usage against `ui/src/index.ts:16-27`, and the native `<dialog>` pattern already meets every requirement in the spec, including the top layer (`diff-view.component.ts:498-515`).
  5. _Git-status diff alone to detect per-turn changes._ It misses a rewrite that keeps the numstat of an already-dirty file unchanged. Mtime and size fingerprints close that gap.
  6. _Relying only on the SDK `WorktreeRemove` hook (or only on detection)._ The evidence conflicts (Correction 1). Both idempotent paths are cheap.
- **Assumptions.** Each is resolved by the check named in its row.

| ID  | Assumption                                                                                                                                                          | Check that resolves it                                                                                                                                                            | Owner / when           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| A1  | Pierre's separator rule (`DiffHunksRenderer.ts:2406-2408`) and slot names are the same at tag `diffs-v1.5.1` as on `main`.                                          | Read the two files at the tag. The Component 17 spec asserts exactly one toolbar host per hunk on a fixture that has a hunk at line 1 and two adjacent hunks.                     | P3 renderer batch      |
| A2  | Pierre and Shiki (JS engine) run under `script-src 'self'`, with no `eval` or `new Function`, in the Electron CSP and in the VS Code webview (skills drawer).       | `grep -E "new Function\|eval\\("` over the built lazy chunks. Load one diff in both hosts with the devtools console open.                                                         | P3 renderer batch      |
| A3  | `vscode.changes` at 1.100 takes `(title, [resource, original?, modified?][])`.                                                                                      | Read `extHostApiCommands.ts` at the `1.100.0` tag around line 466. The research verified that the command exists, not its argument shape.                                         | P3 VS Code batch       |
| A4  | `ChatStore.sendOrQueueMessage(content, options)` (`chat.store.ts:227-232`) can target a specific session, or the session's tab can be activated first.              | Read `SendMessageOptions` and the tab-switch API in `libs/frontend/chat`.                                                                                                         | P4 feedback-port batch |
| A5  | The SDK calls Ptah's `WorktreeRemove` hook for worktrees created by Ptah's `WorktreeCreate` hook.                                                                   | Not needed for correctness: Component 12 detects removal independently. Record which path fired in logs during QA.                                                                | P2 QA                  |
| A6  | `UserPromptSubmitPayload.workspaceRoot` is the directory the SDK session runs in (the worktree when sessions run in one).                                           | Read `user-prompt-submit-hook-handler.ts`. If it is the main root, the recorder takes the baseline from `SessionMetadata.workingDirectory` (`session-metadata-store.ts:107-111`). | P3 recorder batch      |
| A7  | Replayed transcript messages carry the SDK JSONL timestamps, so the time-window join places a persisted card correctly.                                             | Read `session-history-replayer.service.ts` (`replay`, around line 191). If not, the join falls back to "after the last assistant message before the next user message".           | P3 card batch          |
| A8  | `@angular/build:application` `statsJson: true` writes an esbuild metafile with `outputs[].inputs`.                                                                  | Build once with `statsJson` and inspect `stats.json`.                                                                                                                             | P3 eager-assert batch  |
| A9  | An Angular file list plus one Pierre `VirtualizedFileDiff` per mounted file keeps the Requirement 6.2 fixture responsive while sharing the canvas scroll container. | Spike on the 200-file and 10,000-line fixture. On failure, switch to Pierre `CodeView` with Angular overlays through annotation slots.                                            | P4 first canvas batch  |
| A10 | `gh pr view <branch> --json number,title,state,isDraft,reviewDecision,statusCheckRollup,url` is supported by the `gh` versions users have.                          | Run it against `gh` ≥2.20. Parse defensively (unknown fields ignored, missing fields map to `unknown`).                                                                           | P5 task-view batch     |
| A11 | VS Code-family targets in `editor-launcher-detection.ts` accept `--merge <local> <remote> <base> <result>`.                                                         | Read the target definitions. Only targets that declare `mergeArgs` get a merge launch; the rest open the file.                                                                    | P5 conflict batch      |
| A12 | `@codemirror/state` `EditorState.lineSeparator` preserves CRLF round-trips when set to the detected separator.                                                      | Unit spec: open a CRLF file, edit, save, and compare bytes.                                                                                                                       | P4 spot-editor batch   |

- **Effect on existing code.**
  - Replaced:
    - `GitDockComponent` and its tab strip, `SourceControlPanelComponent`, `DiffViewComponent`
    - `FileViewComponent`, the `GitReview*` panel, `WorktreeSectionComponent`
    - `DiffTabsService`, `MonacoLoaderService`, `monaco-theme.ts`
    - the Monaco dependencies, asset copy and provider
    - the non-recursive `fs.watch` handles in `GitWatcherService`
    - the porcelain-v1 discard parse
    - the transient `GitInfoService` registration on VS Code and CLI

    Replacements happen only after the parity tests pass (Component 29).

  - Left alone:
    - the process gate
    - the `applyHunks` safety ladder (`git-info.service.ts:1559-1936`), apart from the lock wrapper and DIFF_FLAGS
    - the review reader's merge-base logic
    - the status single-flight
    - `OpenInButtonComponent`, `BranchPickerDropdownComponent`, `StashPopoverComponent` (re-hosted)
    - the VS Code file-link path
    - all RPC names that exist today

---

## Component specifications

Components are grouped by the approved phases. P1 ships as its own PR `[user-requested: Gate 1 default 2]`.

### P1 — Reliability core (RC1-RC8)

#### 1. Shared git contracts, P1 subset

- Purpose: carry git's real outcome across the RPC boundary.
- Responsibilities:
  - In `rpc-git.types.ts`:
    - Add `GitMutationFailureCode = 'LOCKED' | 'HOOK_FAILED' | 'TIMEOUT' | 'CANCELLED' | 'GIT_ERROR'`.
    - Add an optional `code?: GitMutationFailureCode` to `GitStageResult`, `GitUnstageResult`, `GitDiscardResult`, `GitCommitResult`, `GitCheckoutResult`, `GitStashMutationResult`, `GitPushResult`, `GitPullResult` and `GitFetchResult`.
    - `GitCommitResult` gains `hookOutput?: string`, `exitCode?: number` and `subject?: string`.
    - Replace the inline `statusUnavailable?: 'output-too-large'` with `statusUnavailable?: GitStatusUnavailableReason`, where `GitStatusUnavailableReason = 'output-too-large' | 'timeout' | 'error' | 'locked'`.
  - Create `libs/shared/src/lib/constants/git-operation.constants.ts`:
    - `GIT_HOOK_TIMEOUT_MS = 600_000`
    - `GIT_FETCH_TIMEOUT_MS = 300_000`
    - `GIT_RPC_TIMEOUT_MARGIN_MS = 15_000`
    - `GIT_INDEX_LOCK_RETRY_DELAYS_MS = [100, 200, 400, 800, 1600] as const`
    - `GIT_LOCKED_MESSAGE = 'Another git process is using this repository.'`
    - a helper `gitRpcTimeoutFor(backendMs: number): number` that returns `backendMs + GIT_RPC_TIMEOUT_MARGIN_MS`.
- Verified contracts and entry points:
  - `GitInfoResult` `rpc-git.types.ts:104-117`; result interfaces at `:229-270, 466-510, 589-594`.
  - The constants folder exists (`libs/shared/src/lib/constants/workspace-scan.constants.ts:88`).
- Dependencies: none (L0). vscode-core (L1) and frontend core read these constants, so frontend and backend never disagree `[project-rule: CONVENTIONS.md §8]`.
- Integration points:
  - `GitInfoService` fills the fields.
  - `SourceControlPanelComponent`, `GitStatusService` and `GitBranchesService` read them.
- Failure behaviour: all new fields are optional. Older clients ignore them and older backends omit them.
- Quality requirements: no raw stderr in `error` for `LOCKED`. The message is `GIT_LOCKED_MESSAGE` `[user-requested: Req 1.8]`. `hookOutput` carries hook output verbatim: it is output the user asked to see (NFR security bullet 3).
- Verification seam: a type-level spec in shared (`rpc-git.types.spec.ts` if present, else a new `git-operation.constants.spec.ts`) asserts:
  - the reason union;
  - `gitRpcTimeoutFor(600_000) === 615_000`;
  - the retry delays sum to 3,100 ms.
- Files:
  - MODIFY `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-git.types.ts`
  - CREATE `D:/projects/ptah-extension/libs/shared/src/lib/constants/git-operation.constants.ts`
  - CREATE `D:/projects/ptah-extension/libs/shared/src/lib/constants/git-operation.constants.spec.ts`
  - MODIFY `D:/projects/ptah-extension/libs/shared/src/index.ts` (or the constants barrel it re-exports; one line)

**Resolved constants (orchestrator item 1).**

- Hook-running commands get 10 min. Scope: commit, checkout/switch, stash apply/pop, merge/rebase/cherry-pick continue and abort, pull, push. Pre-push and post-merge hooks run on push and pull, so both count as hook-running. `[lane-proposed]`
- Fetch gets 300 s, the existing backend value (`git-info.service.ts:1004-1007, 1095-1098`).
- Every renderer call gets the backend timeout plus 15 s.
- index.lock: 5 retries with 100/200/400/800/1,600 ms backoff, 3.1 s total. The review suggested a 2,000-3,000 ms window; the extra 100 ms lets the last attempt finish.
- Diff size limit: 2 MiB per side (Component 13), the same cap as `FILE_VIEW_MAX_BYTES` (`rpc-misc.types.ts:226`), so there is one "largest single file the renderer receives" rule. `[lane-proposed]`

#### 2. exec-git: cancellation, streaming, lock classification

- Purpose: let long git calls be cancelled and observed, and classify lock failures.
- Responsibilities:
  - Add `signal?: AbortSignal` to `ExecGitOptions`. On abort, use the same `terminate()` path as a timeout and reject with `GitCancelledError`.
  - Add `onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void`, called per decoded chunk. The decoding uses a streaming `TextDecoder` so multibyte characters split across chunks decode correctly.
  - Export a pure `isIndexLockFailure(stderr: string): boolean` matching `/Unable to create '.*index\.lock': File exists/` (C locale, `exec-git.ts:399-403`).
  - Export `GitTimeoutError` so callers can tell a timeout from a spawn error. Today it is a plain `Error` (`exec-git.ts:663-665`).
- Verified contracts and entry points: `ExecGitOptions` at `exec-git.ts:405-446`; `runGitChild` at `:592-725`; `terminate` at `:642-652`.
- Dependencies: none new.
- Integration points: Component 3 (retry), Component 5 (timeouts), Component 30 (streaming and cancel).
- Failure behaviour:
  - Abort after exit does nothing.
  - Abort before spawn rejects without spawning and releases the gate slot.
  - Tree kill as today.
- Quality requirements: the gate-release invariants are unchanged. The existing `exec-git.spec.ts` must stay green.
- Verification seam: `exec-git.spec.ts` gains cases for:
  - abort mid-run (child killed, `GitCancelledError`, slot released);
  - `onOutput` receiving a UTF-8 multibyte character split across two chunks;
  - `isIndexLockFailure` true/false table.
- Files:
  - MODIFY `D:/projects/ptah-extension/libs/backend/vscode-core/src/utils/exec-git.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/vscode-core/src/utils/exec-git.spec.ts`

#### 3. `GitRepoWriteLock` (RC6)

- Purpose: run Ptah git mutations for one repository one after another, and absorb short index.lock contention.
- Responsibilities:
  - `run<T>(workspacePath, body: () => Promise<T>): Promise<T>`. It is a FIFO promise chain per normalized `workspacePath`, using the case and separator folding from `git-rpc.handlers.ts:304-311`.
  - Reentrance is refused. `AsyncLocalStorage` (node `async_hooks`) records the keys held by the current async context. A nested `run` on a held key throws `GitReentrantLockError` synchronously. Without this check, a nested call would deadlock.
  - `execWrite(args, cwd, options)`: wraps a single mutating spawn. On `isIndexLockFailure(stderr)` it retries per `GIT_INDEX_LOCK_RETRY_DELAYS_MS`. If the lock persists it returns `{ code: 'LOCKED' }`. It never retries any other failure.
  - The clock and sleep are injectable for deterministic specs.
- **Mutex scope (orchestrator item 2).** A whole public operation runs inside one `run()`: every spawn it makes, its reads-before-writes and its rollback. Locked operations:
  - `stageFiles`, `unstageFiles`, `discardChanges` (status read, checkout, clean)
  - `commit`, `checkout`/`switch` (including stash and switch)
  - `applyHunks` (snapshot, write-tree, apply check, apply, verify, rollback — the whole ladder at `git-info.service.ts:1559-1892`)
  - `stashApply`/`stashPop`/`stashDrop`, `pull`
  - merge/rebase/cherry-pick continue and abort (P5)

  Not locked:
  - reads (`getGitInfo`, `diffFile`, `readPatch`, numstat, review reads)
  - `push` and `fetch`: they write no index, and a 5-10 min network call must not block staging;
  - worktree add, remove and prune: they write admin directories, not this worktree's index.

  **No-deadlock rule:** a locked body calls only private helpers and read methods, never another locked public method. The reentrance check turns a violation into an immediate, test-visible error.

- Verified contracts and entry points: the mutating call sites listed at `git-info.service.ts:799-1122, 1559-1892, 2394-2567`.
- Dependencies: exec-git (Component 2). Internal to vscode-core, so no barrel export.
- Integration points: every locked `GitInfoService` method (Component 5).
- Failure behaviour:
  - The body's rejection propagates.
  - The chain continues. A failed operation never blocks the next.
  - `LOCKED` maps to `GIT_LOCKED_MESSAGE`.
- Quality requirements: no timers remain after `run` settles. The retry sleep uses `setTimeout(...).unref()`.
- Verification seam: `git-write-lock.spec.ts` with fake timers covers:
  - two concurrent `run`s serialize;
  - a rejected body does not poison the chain;
  - reentrance throws;
  - lock retry schedule; after persistence the result is `LOCKED` with no stderr.

  Real-git: `git-info.service.write-lock.real-git.spec.ts` covers:
  - two parallel `applyHunks` on the same file, both succeeding one after the other (Risk-table row 6);
  - a held `.git/index.lock` (created by the test) gives `LOCKED` after about 3.1 s, then succeeds when the file is removed.

- Files:
  - CREATE `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-write-lock.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-write-lock.spec.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.write-lock.real-git.spec.ts`

#### 4. Porcelain v2 `-z` status parser (RC4, extended in P2 for RC12)

- Purpose: parse git status without C-quoting, in one pure module.
- Responsibilities:
  - `parseStatusV2Z(output: string): { branch: GitBranchInfo; files: GitFileStatus[] }`.
  - Headers are NUL-terminated `# branch.*` records.
  - Type `1` records.
  - Type `2` records: the path, then the next NUL field is `origPath`.
  - `u` records (P2: `status: 'U'`, `conflict`).
  - `?` and `!` records.
  - The `<sub>` field (P2: `submodule: true` when it starts with `S`).
  - `T` becomes typechange (P2: `status: 'T'`).
  - No trimming of path bytes.
- Verified contracts and entry points: replaces `parseBranchInfo`/`parseFileStatus`/`mapStatusCode` (`git-info.service.ts:3028-3162`). Its caller is `computeGitInfo` (`:588-678`). Discard reuses it through `status --porcelain=v2 -z -- <paths>`.
- Dependencies: shared types only.
- Integration points: Component 5.
- Failure behaviour: an unparseable record is skipped and counted. `computeGitInfo` logs the count once per workspace. It never throws.
- Quality requirements: the parser is O(n) over the output and allocates no per-line regex.
- Verification seam:
  - `git-status-parser.spec.ts`: table-driven over literal NUL-separated fixtures with `café.txt`, CJK, Arabic, `a"b`, `a\b`, a leading space, a trailing space, a rename and an unmerged row.
  - Real-git spec `git-info.service.paths.real-git.spec.ts` (Requirements 1.5 and 1.6) covers:
    - status names;
    - numstat counts present;
    - diffFile, stage, unstage and discard succeed on each name;
    - discarding a staged rename.
- Files:
  - CREATE `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-status-parser.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-status-parser.spec.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.paths.real-git.spec.ts`

#### 5. `GitInfoService` facade, P1 changes (RC1-RC4, RC6, RC7)

- Purpose: apply the P1 fixes behind the unchanged public surface.
- Responsibilities:
  - **RC4.**
    - Status becomes `['status','--porcelain=v2','-z','--branch','--untracked-files=all']` parsed by Component 4.
    - Numstat keys (already `-z`, `:2944-2956`) now match.
    - `discardChanges` classifies tracked and untracked paths with the same parser (`-- <paths>`). For renames it discards both `path` and `origPath` with `git restore --staged --worktree --source=HEAD -- <origPath> <path>` for staged renames. For non-staged changes it keeps `checkout --`. No `.trim()` on paths.
  - **RC7.**
    - `DIFF_FLAGS = ['-U3','--no-color','--no-ext-diff','--no-textconv','--src-prefix=a/','--dst-prefix=b/']`.
    - Explicit prefixes override `diff.noprefix`, `diff.srcPrefix` and `diff.dstPrefix`, and `--no-textconv` defeats textconv drivers.
    - `isMutatingGitCommand` must skip leading `-c <k>=<v>` pairs before reading the verb. This is a guard for later callers; P1 adds no `-c`.
  - **RC3.**
    - `isGitRepo` becomes the private `probeRepo(): 'yes' | 'no' | 'unknown'`:
      - exit 0 with `true` means `yes`;
      - exit 128 with stderr matching `/not a git repository/i` means `no`;
      - anything else, including throw, timeout and missing git binary, means `unknown`.
    - The public `isGitRepo(): Promise<boolean>` stays for its other callers and returns `probe === 'yes'`.
    - `computeGitInfo` returns `{ isGitRepo: true, files: [], statusUnavailable }` for `unknown`, and for a status that exits non-zero or throws. The reason is:
      - `timeout` for `GitTimeoutError`;
      - `locked` when `isIndexLockFailure`;
      - `error` otherwise;
      - `output-too-large` as today.
  - **RC2.**
    - `commit`, `checkout`, `runStashMutation` (apply/pop), `pull` and `push` pass `timeoutMs: GIT_HOOK_TIMEOUT_MS`. `fetch` passes `GIT_FETCH_TIMEOUT_MS`.
    - `commit` records the `stat` (ino and mtimeMs) of `<gitdir>/index.lock` just before a timeout or abort kill, where `gitdir` comes from `git rev-parse --git-dir`, cached per workspace.
    - After the child tree has exited, if `index.lock` still exists with the same ino and mtime, it is removed and the removal is logged.
    - Only `commit` gets this recovery: git holds `index.lock` for the whole pre-commit and commit-msg hook run, so no other process can have created that file while ours held it. A kill outside a hook never leaves our lock behind.
  - **RC1.**
    - `commit` returns `{ success:false, code:'HOOK_FAILED', hookOutput: stdout+stderr, exitCode }` when git exits non-zero after running hooks. It returns `code: 'TIMEOUT'` or `code: 'CANCELLED'` on those paths.
    - The hash and subject come from `git rev-parse --short HEAD` and `git log -1 --format=%s`, run after success, instead of the regex (`:967`).
  - **RC6.** Wrap the locked methods listed in Component 3.
- Verified contracts and entry points:
  - methods at `git-info.service.ts:588-678, 799-979, 989-1122, 2394-2437, 2520-2567, 2882-2900`;
  - the private exec seams at `:2911-2942`.
- Dependencies: Components 1-4.
- Integration points: `GitRpcHandlers` (unchanged signatures), the watcher (`computeGitInfo` through `refreshGitInfo`), and every host.
- Failure behaviour: every mutation still resolves a result and never throws to the handler (existing contract).
- Quality requirements: `git-info.service.ts` must not grow in net lines. The parser deletion (about 140 lines) offsets the wrapper additions. Any new private helper over about 40 lines goes to a collaborator file `[project-rule: refactor-recipes.md:79-96]`.
- Verification seam: real-git specs, each creating a temp repo with `git init` and set user config:
  - `git-info.service.hooks.real-git.spec.ts`:
    - a failing pre-commit hook gives `HOOK_FAILED`, the message untouched (caller-side), hook output present;
    - a hook that sleeps 60 s completes;
    - an aborted commit mid-hook leaves no `index.lock`.

    The 60 s case is tagged `slow` and runs in CI only.

  - `git-info.service.diff-config.real-git.spec.ts` (Requirement 1.9): `diff.noprefix=true`, custom `diff.srcPrefix`/`dstPrefix`, and a textconv driver. In each case stage, unstage and revert of a hunk succeed.
  - `git-info.service.status-unavailable.spec.ts` (mocked exec): timeout, error and lock reasons, and the `unknown` probe never reports `isGitRepo:false`.
- Files:
  - MODIFY `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.spec.ts` (the classification table gains `-c` cases)
  - CREATE `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.hooks.real-git.spec.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.diff-config.real-git.spec.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.status-unavailable.spec.ts`

#### 6. Electron git watcher redesign (RC5; orchestrator item 3)

- Purpose: see every ref, index and HEAD change on every OS, including linked worktrees, files created after start, and writes by lock-and-rename.
- Responsibilities:
  - Replace the `fs.watch` handles (`watchFile`/`watchDirectory`, `git-watcher.service.ts:294-323, 520-580`) with **one recursive `IWorkspaceWatcher` subscription on the common git dir**. The common dir is read from `<gitdir>/commondir`, resolved relative to gitdir; when that file is absent it is gitdir itself. In a linked worktree, the own gitdir `<common>/worktrees/<name>` lies beneath the common dir, so one subscription covers both.
  - Options:
    - `excludeDirNames: ['objects','logs','hooks','lfs','modules','rr-cache','fsmonitor--daemon']`
    - `excludeGlobs: ['**/*.lock']`: git's lock-then-rename produces an event for the final name, so the `.lock` intermediate is noise.
    - `excludeSegmentRules: []`
    - `nestedRepoDetection: false`
    - `minBatchIntervalMs: 250`
  - Watching directories through `@parcel/watcher` survives rename (no inode pinning), sees files that did not exist at start, and sees nested refs.
  - A pure `classifyGitDirChange(absPath, ownGitDir, commonDir): GitChangeKind | 'worktree-admin' | null` in a new file:
    - own gitdir `HEAD`, `ORIG_HEAD`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `REBASE_HEAD`, `AUTO_MERGE`, `rebase-merge/**`, `rebase-apply/**` map to `'head'`;
    - own `index` maps to `'index'`;
    - own `FETCH_HEAD`, common `packed-refs` and `refs/**` map to `'refs'`, except `refs/stash`, which maps to `'refs-stash'`;
    - common `worktrees/**` outside the own gitdir maps to `'worktree-admin'`;
    - everything else maps to `null`.
  - `'worktree-admin'` calls the existing `scheduleNestedRootsRefresh()` (and the RC10 removal detection in Component 12).
  - An `overflow` batch schedules one refresh with causes `['head','index','refs']`.
  - The workspace-root subscription (`:466-497`) is unchanged.
- Verified contracts and entry points:
  - `IWorkspaceWatcher.watch` at `workspace-watcher.interface.ts:185-191`;
  - options at `:87-142`;
  - `scheduleGitOpsRefresh` (`git-watcher.service.ts:830`), `scheduleNestedRootsRefresh` (`:632`), `resolveGitDir` (`:346-373`);
  - `GitChangeKind` at `libs/shared/src/lib/types/messages/git-status.ts:18-24`, unchanged.
- Dependencies: the port is already injected (constructor `:253-257`). No DI change.
- Integration points: `git:status-update` pushes with `causes` feed Component 15 (RC11) and the UI.
- Failure behaviour:
  - Subscription failure: warn, then fall back to the workspace feed plus explicit refreshes (the existing degradation pattern at `:486-495`).
  - Overflow triggers a rescan. The design never adds a poll.
- Quality requirements:
  - Windows stays green: one engine for all OSes, and the existing `apps/ptah-electron-e2e/src/specs/git-watcher.spec.ts` must pass unchanged `[user-requested: Risk row 5]`.
  - One subscription per armed workspace, released in `stop()` (`:409-451`).
  - No per-file timers `[project-rule: runtime-cost working rule]`.
- Verification seam:
  - `git-dir-change-classifier.spec.ts` (pure table, including linked-worktree paths and `refs/remotes/origin/x`).
  - `git-watcher.service.spec.ts` updated to drive the gitdir subscription through `libs/backend/platform-core/src/testing/mocks/workspace-watcher.mock.ts` (`fire(kind, ...paths)`).
  - New real-git spec `git-watcher.real-git.spec.ts` (Requirement 1.7) runs the in-process adapter used by `run-workspace-watcher-contract.ts` and performs a real `git add`, `git commit`, a nested ref write, a `packed-refs` rewrite, `MERGE_HEAD` creation and a linked-worktree commit. It asserts a `git:status-update` for each within 3 s. It runs in the CI OS matrix (Component 9).
- Files:
  - MODIFY `D:/projects/ptah-extension/apps/ptah-electron/src/services/git-watcher.service.ts`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-electron/src/services/git-watcher.service.spec.ts`
  - CREATE `D:/projects/ptah-extension/apps/ptah-electron/src/services/git-dir-change-classifier.ts`
  - CREATE `D:/projects/ptah-extension/apps/ptah-electron/src/services/git-dir-change-classifier.spec.ts`
  - CREATE `D:/projects/ptah-extension/apps/ptah-electron/src/services/git-watcher.real-git.spec.ts`

#### 7. Frontend RC1 / RC3 / RC8 in the current dock

P1 ships before the redesign, so these fixes land in today's components.

- Purpose: never discard a git result, never show stale data as clean, and never time out before the backend does.
- Responsibilities:
  - **RC1.**
    - `SourceControlPanelComponent.onStageFile/onUnstageFile/onDiscardFile/onStageAll/onUnstageAll` await the result.
    - On `!(result.success && result.data?.success)` they set a per-row or per-section error signal (dismissible, cleared by the next success) and always call `gitStatus.refresh()` afterwards.
    - `onCommit` checks `result.data?.success`. On failure it keeps the message and shows `hookOutput` in a `<pre>` region with `role="log"`. On success it shows the hash and subject and clears the message.
  - **RC3.**
    - `GitStatusService.applyGitInfo` keeps the previous `files`, `branch` and `isGitRepo` for the target workspace when `statusUnavailable` is set and a previous good entry exists. It exposes `staleReason` (`timeout|error|locked|output-too-large`) and `isStale`.
    - The panel shows "Git status is unavailable (<reason>) — showing the last known changes" and marks the list stale instead of hiding it.
    - "Not a Git repository" appears only when a result says `isGitRepo:false` with no `statusUnavailable`.
  - **RC8.**
    - `GitBranchesService` push, pull and fetch call `rpcCall(..., gitRpcTimeoutFor(GIT_HOOK_TIMEOUT_MS))`. Fetch uses `GIT_FETCH_TIMEOUT_MS`.
    - Checkout and stash callers use the hook timeout.
    - The existing in-progress flags remain (`git-dock-header.component.ts:151, 171, 191, 202-209`).
- Verified contracts and entry points:
  - `source-control-panel.component.ts:457-496` (root-cause doc, confirmed by task-description-review);
  - `git-status.service.ts:300-328`;
  - `git-branches.service.ts:534-538, 562-571`;
  - `rpc-call.util.ts:185-210`.
- Dependencies: Component 1 constants and types.
- Integration points: backend Component 5 results.
- Failure behaviour: transport failure (`success:false`) shows the transport error. It is never treated as git success.
- Quality requirements: error text is the backend's `error` (no absolute paths per NFR-8), or `GIT_LOCKED_MESSAGE`. The hook output region is keyboard-scrollable.
- Verification seam:
  - `source-control-panel.component.spec.ts`: replace the `{success:true}` commit mock (`:48`) with `{success:true, data:{success:false, code:'HOOK_FAILED', hookOutput:'lint failed'}}`. Assert the message is kept, the output is shown and there is no success state. Assert `refresh()` runs after every mutation.
  - `git-status.service.spec.ts`: the stale-keep cases.
  - `git-branches.service.spec.ts`: the timeout argument.
  - E2E (Requirement 1.2 with a real hook): new `apps/ptah-electron-e2e/src/specs/git/commit-hook-failure.spec.ts`.
- Files:
  - MODIFY `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/source-control/source-control-panel.component.ts`
  - MODIFY `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/source-control/source-control-panel.component.spec.ts`
  - MODIFY `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/source-control/source-control-file.component.ts`
  - MODIFY `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-status.service.ts`
  - MODIFY `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-status.service.spec.ts`
  - MODIFY `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-branches.service.ts`
  - MODIFY `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-branches.service.spec.ts`
  - MODIFY `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-stash.service.ts` (stash timeouts)
  - CREATE `D:/projects/ptah-extension/apps/ptah-electron-e2e/src/specs/git/commit-hook-failure.spec.ts`

#### 8. RC8 / RC1 handler pass-through

- Purpose: make sure `GitRpcHandlers` forwards the new result fields and does not trim them away.
- Responsibilities: audit `registerGitCommit` (`git-rpc.handlers.ts:552`) and the stage, unstage, discard and checkout handlers. They return the service result object unchanged, so there are no shape rewrites.
- Verified contracts and entry points: `git-rpc.handlers.ts:552, 922`.
- Dependencies: Component 5.
- Failure behaviour: unchanged.
- Verification seam: `git-rpc.handlers.spec.ts` asserts that `hookOutput` and `code` reach the RPC result.
- Files:
  - MODIFY `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.ts` (only if a handler reshapes the result)
  - MODIFY `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.spec.ts`

#### 9. Cross-platform real-git CI job

- Purpose: produce OS evidence for Requirement 1.7 (and Requirement 11.3 in P5), because the current CI is Linux-only (`ci.yml:36`, `electron-e2e.yml:36`).
- Responsibilities: a new job `git-real-git` in `ci.yml`:
  - matrix `os: [ubuntu-latest, windows-latest, macos-latest]`;
  - runs `npx nx test vscode-core --testPathPattern=real-git` and `npx nx test ptah-electron --testPathPattern=real-git`;
  - skips the `slow` tag except on `ubuntu-latest`.
- Verified contracts and entry points: `.github/workflows/ci.yml:36`.
- Dependencies: Components 3-6 specs.
- Failure behaviour: the job fails the PR.
- Verification seam: the job itself.
- Files:
  - MODIFY `D:/projects/ptah-extension/.github/workflows/ci.yml`

### P2 — Reliability hardening (RC9-RC14)

#### 10. Ref guard (RC14)

- Purpose: stop any user-supplied ref or path from being read as a git option.
- Responsibilities:
  - `assertSafeRef(ref)` throws `GitInvalidRefError` for:
    - an empty ref;
    - a leading `-`;
    - control characters;
    - whitespace;
    - `..`, `@{` (except the literal `stash@{N}` built internally), `~^:?*[\` in branch names.

    For `getLastCommit` a separate `assertSafeRevision` allows `HEAD`, SHAs, `^`/`~` suffixes and `name^{commit}`, but never a leading `-`.

  - Call sites, each with `--end-of-options` before refs, or `--` before paths:
    - `getLastCommit` (`log -1 --format=... --end-of-options <ref>`)
    - `checkout`/`switch`
    - `addWorktree` (branch)
    - `removeWorktree` (`worktree remove [--force] -- <path>`)
    - the new `git:log` (Component 33)
    - the PR reader (Component 31)
  - The `validatePathSegment` comment (`:2809-2811`) is corrected.
- Verified contracts and entry points: `git-info.service.ts:2205-2216, 2394-2437, 2813-2847, 719-793`; precedent `git-review-reader.service.ts:291`.
- Dependencies: none.
- Failure behaviour: the result is `{success:false, error:'Invalid branch name'}` (existing copy at `:2404`), or the existing empty result for `getLastCommit`.
- Verification seam: `git-ref-guard.spec.ts` (table), plus one spec per call site in `git-info.service.ref-guard.real-git.spec.ts`. `--output=/tmp/x` and `-b` are refused, and no file is written.
- Files:
  - CREATE `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-ref-guard.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-ref-guard.spec.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ref-guard.real-git.spec.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ts`

#### 11. Branch switching (RC9)

- Purpose: switch branches like `git switch` does, without losing work.
- Responsibilities:
  - Backend `checkout(workspacePath, branch, { createNew, force, stash, track })`. The existing positional parameters stay for the facade; the `GitCheckoutParams` fields are added.
  - Uses `git switch`:
    - `createNew` skips the dirty guard and runs `switch -c --end-of-options <b>`, which carries changes including untracked files.
    - For an existing branch there is no pre-check with `status --porcelain`. It runs `switch --end-of-options <b>`. If git refuses with "would be overwritten", the result is `{dirty:true, conflictingPaths}`, parsed from git's list.
    - `stash:true` runs `stash push --include-untracked -m "ptah: before switching to <b>"`, then switch. If the switch fails, it runs `stash pop` and returns the error. On success it returns `stashRef`.
    - `force:true` runs `switch --discard-changes` and stays available as a secondary confirmed action.
    - `track:true` with remote ref `origin/x`: if local `x` exists it runs `switch x`, otherwise `switch --track origin/x`. HEAD is never detached.
  - Frontend `BranchPickerDropdownComponent` gets "Stash & switch" (primary) and "Cancel". "Discard & switch" sits behind a second confirmation. Remote rows pass `track:true`. The create-branch error shows the reason (`branch-picker-dropdown.component.ts:171-182`).
  - Types: `GitCheckoutParams` gains `stash?: boolean; track?: boolean`. `GitCheckoutResult` gains `conflictingPaths?: string[]; stashRef?: string`.
- Verified contracts and entry points: `git-info.service.ts:2394-2437`; `rpc-git.types.ts:579-594`; `branch-picker-dropdown.component.ts:39-55, 85-110, 158-182`.
- Dependencies: Components 3 and 10.
- Failure behaviour: switch failure after stash triggers pop. If the pop fails, the result carries both errors and the stash stays, so nothing is lost.
- Verification seam: `git-info.service.switch.real-git.spec.ts` (Requirement 2.1) covers:
  - create with untracked files carried over;
  - an overwrite conflict gives `dirty` and paths;
  - stash and switch;
  - remote tracking with no detach (asserts `symbolic-ref HEAD`).

  `branch-picker-dropdown.component.spec.ts` is updated.

- Files:
  - MODIFY `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.switch.real-git.spec.ts`
  - MODIFY `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-git.types.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.ts` (pass the new params)
  - MODIFY `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/branch-picker/branch-picker-dropdown.component.ts`
  - MODIFY `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/branch-picker/branch-picker-dropdown.component.spec.ts`

#### 12. Worktree administration (RC10)

- Purpose: stop agent worktrees from polluting repositories and piling up, show their state, and scope the RPCs.
- Responsibilities:
  - **Exclude on create.** `AgentWorktreeAdmin.ensureExcluded(workspacePath)` runs when an `addWorktree` target lies under `AGENT_WORKTREE_DIR`:
    - `git check-ignore -q -- .claude-worktrees/`;
    - if not ignored, resolve `git rev-parse --git-path info/exclude` (commondir-aware) and append `/.claude-worktrees/`, idempotently.
  - **Remove.** The `WorktreeRemove` hook handler (`worktree-hook-handler.ts:274-345`) checks that `worktree_path` is listed by `git worktree list` for `input.cwd` and lies under `<main>/.claude-worktrees/`. It then calls `gitInfo.removeWorktree(main, path, {force:true})` followed by `pruneWorktrees(main)`. A locked worktree is never force-removed; it is logged and left in place.
  - **Detect** (orchestrator: poll/watch). `GitWatcherService` (Electron) re-lists worktrees:
    - on `'worktree-admin'` classifications (Component 6);
    - piggybacked on the status refresh at most once per 30 s, with a last-run timestamp and no free-running timer.

    Any listed worktree that is `prunable` and under `.claude-worktrees/` triggers `git worktree prune`, and a `git:worktreeChanged {action:'removed', path}` broadcast for each path that disappeared from the list. VS Code and CLI rely on the hook path plus the `prunable` label.

  - **Labels.** `parseWorktreeList` (`libs/shared/src/lib/utils/git.utils.ts:43-57`) reads the `locked [reason]` and `prunable [reason]` lines. `GitWorktreeInfo` gains `locked?`, `lockReason?`, `prunable?` and `prunableReason?`.
  - **Scoping.**
    - `GitWorktreesParams = GitWorkspaceScopedParams`.
    - `GitAddWorktreeParams` and `GitRemoveWorktreeParams` extend `GitWorkspaceScopedParams`.
    - The handlers use `resolveRoot` (`git-rpc.handlers.ts:287-311`).
    - The frontend `WorktreeService` passes `workspaceRoot`.
  - `removeWorktree` uses `worktree remove [--force] -- <path>`. `pruneWorktrees` is new.
- Verified contracts and entry points:
  - `worktree-hook-handler.ts:117-122, 274-345`;
  - `git-info.service.ts:697-793`;
  - `git-rpc.handlers.ts:317-460`;
  - `rpc-git.types.ts:120-188`;
  - `AGENT_WORKTREE_DIR` at `libs/shared/src/lib/constants/workspace-scan.constants.ts:88`.
- Dependencies: Components 3, 6 and 10. `agent-sdk` already injects `TOKENS.GIT_INFO_SERVICE` (`worktree-hook-handler.ts:121`).
- Failure behaviour:
  - An exclude write failure is warned and does not block the add.
  - A hook removal failure is logged and the hook still returns `continue: true`, as today (`:340`).
  - A failed prune leaves the list labelled `prunable`.
- Verification seam:
  - `git-info.service.worktrees.real-git.spec.ts` (Requirement 2.2) covers:
    - the exclude line is written once, and `.claude-worktrees/` is absent from `status` and from `add -- .`;
    - a locked worktree is labelled;
    - an `rm -rf` worktree is labelled prunable, then prune removes the admin entry;
    - the RPCs act on the given root.
  - `worktree-hook-handler.spec.ts`: the remove path. `git.utils.spec.ts`: the new lines.
  - `git-watcher.service.spec.ts`: removal broadcast.
- Files:
  - CREATE `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/agent-worktree-admin.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.worktrees.real-git.spec.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ts`
  - MODIFY `D:/projects/ptah-extension/libs/shared/src/lib/utils/git.utils.ts` (+ its spec)
  - MODIFY `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-git.types.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/worktree-hook-handler.ts` (+ spec)
  - MODIFY `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.ts` (+ spec)
  - MODIFY `D:/projects/ptah-extension/apps/ptah-electron/src/services/git-watcher.service.ts`
  - MODIFY `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/worktree.service.ts` (+ spec)

#### 13. Repository operation, conflicts, size limit, LFS (RC12)

- Purpose: know when a merge, rebase or cherry-pick is in progress and which paths conflict, and never ship oversized blobs.
- Responsibilities:
  - `readRepoOperation(workspacePath)` runs one spawn: `git rev-parse --git-path MERGE_HEAD --git-path CHERRY_PICK_HEAD --git-path rebase-merge --git-path rebase-apply`. It then stats each path; the paths are worktree-aware because git resolves them.
  - `GitInfoResult.operation?: { kind: 'merge' | 'rebase' | 'cherry-pick'; conflictedPaths: string[] }`, where `conflictedPaths` come from `u` records (Component 4). It is computed only when there is `u` status or when the stat finds a marker.
  - The parser produces `status: 'U'` with `conflict: { kind: 'content' | 'delete-modify' | 'add-add' | 'symlink' | 'submodule' }`:
    - `DU`/`UD` map to delete-modify;
    - `AA` maps to add-add;
    - mode `120000` in m1, m2 or m3 maps to symlink;
    - a `<sub>` starting with `S` maps to submodule;
    - otherwise content.

    `GitFileStatus.status` gains `'U' | 'T'`, and `submodule?: boolean`.

  - Size limit: `GIT_DIFF_MAX_SIDE_BYTES = 2 * 1024 * 1024` in shared. `readBlob` passes `maxOutputBytes` and maps `GitOutputLimitError` to `{outcome:'too-large', byteLength}`. `readWorktreeBlob` stats first. `GitReviewReaderService.readBlob` uses the same limit instead of 64 MiB.
  - LFS: a side whose blob is ≤1 KiB and starts with `version https://git-lfs.github.com/spec/v1` becomes `{outcome:'lfs-pointer', oid, size}`.
  - `GitBlobRead` gains both outcomes. `patch` is `null` for either.
  - `applyHunks` refuses both outcomes with `BINARY_UNSUPPORTED`.
- Verified contracts and entry points:
  - `git-info.service.ts:1197-1264` (readBlob), `:2022-2054` (readWorktreeBlob), `:1628-1646` (binary refusal);
  - `git-review-reader.service.ts:383-387`;
  - `rpc-git.types.ts:318-322`.
- Dependencies: Component 4.
- Integration points: the P5 banner, the P3 card (Conflicted row), and the P4 canvas labelled rows (Requirement 6.10).
- Failure behaviour: if the operation read fails, `operation` is omitted. The status itself is still valid.
- Quality requirements: at most one extra spawn per status, and only when needed.
- Verification seam: `git-info.service.operation.real-git.spec.ts` (Requirement 2.4) covers:
  - a merge conflict, a rebase conflict and a cherry-pick conflict, including inside a linked worktree;
  - unmerged entries reported as `U`, not `M`;
  - a 3 MiB file gives `too-large`;
  - an LFS pointer (a committed pointer file, no LFS install needed) is labelled.
- Files:
  - CREATE `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-repo-operation.reader.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-status-parser.ts` (+ spec)
  - MODIFY `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-review-reader.service.ts` (+ spec)
  - MODIFY `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-git.types.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.operation.real-git.spec.ts`
  - MODIFY the frontend `switch`es over `GitFileStatus['status']`, to be found by typecheck: `source-control-file.component.ts`, `changed-file-tree.ts`

#### 14. One `GitInfoService` per host (RC13)

- Purpose: make cache invalidation from the worktree hook, the task sweep and the file-link policy visible to the next `git:*` RPC.
- Responsibilities: change both registrations to `useFactory: instanceCachingFactory((c) => new GitInfoService(c.resolve(TOKENS.LOGGER)))`.
- Verified contracts and entry points: `phase-3-handlers.ts:58-60`; `cli-engine/src/lib/container.ts:445-447`; precedent `register-providers.ts:63-67`.
- Dependencies: tsyringe (existing).
- Failure behaviour: none new.
- Verification seam: each host's container smoke spec (`apps/ptah-extension-vscode/src/di/container.smoke.spec.ts:135`, and the CLI container spec) asserts `resolve(TOKENS.GIT_INFO_SERVICE) === resolve(TOKENS.GIT_INFO_SERVICE)`.
- Files:
  - MODIFY `D:/projects/ptah-extension/apps/ptah-extension-vscode/src/di/phase-3-handlers.ts`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-extension-vscode/src/di/container.smoke.spec.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/cli-engine/src/lib/container.ts`
  - MODIFY the CLI container spec that registers the token (found by `grep GIT_INFO_SERVICE libs/backend/cli-engine`)

#### 15. Scoped, queued diff refresh (RC11)

- Purpose: refresh only the affected diffs, and never drop a refresh request.
- Responsibilities:
  - `DiffTabsService` refresh on `git:status-update`:
    - if `causes` include `head`, `index`, `refs` or `initial`, or `causes` is absent, refresh all open diffs;
    - otherwise refresh only diffs whose path, or origPath, is in the payload's `files` or was in the previous file set.
  - A refresh requested while the same key is refreshing sets `rerunRequested`. On settle, one more run happens. This replaces the drop at `diff-tabs.service.ts:488`.
  - The same logic moves verbatim into the canvas `ReviewDiffService` in P4 (Component 24), with the same spec cases.
- Verified contracts and entry points: `diff-tabs.service.ts:201-221, 395-415, 468-517`; `GitStatusUpdatePayload.causes` at `git-status.ts:38-50`.
- Dependencies: Component 6 causes.
- Failure behaviour: a failed refresh keeps the previous content (existing rule, parity §7 row "Diffs revalidate").
- Verification seam: `diff-tabs.service.spec.ts` cases:
  - a workspace-only cause refreshes 1 of 3 diffs;
  - an index cause refreshes all;
  - a request during a refresh gives exactly one trailing run.
- Files:
  - MODIFY `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/diff-tabs.service.ts`
  - MODIFY `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/diff-tabs.service.spec.ts`

### P3 — Foundation

#### 16. Eager-import removal through `@ptah-extension/git-ui/services`

- Purpose: keep push routing while no git UI code sits in the eager bundle (Requirement 3.1).
- Responsibilities:
  - New entry `libs/frontend/git-ui/src/services.ts` exports only the four `MESSAGE_HANDLERS` services: `GitStatusService`, `GitBranchesService`, `WorktreeService` and `DiffTabsService`. In P4, `DiffTabsService` is replaced by `ReviewDiffService`.
  - The pattern copies `skill-synthesis-ui/src/services.ts`, including its doc block.
  - tsconfig path `@ptah-extension/git-ui/services`.
  - `app.config.ts:62-67` imports from `@ptah-extension/git-ui/services`.
  - If lint requires it, add the subpath to `checkDynamicDependenciesExceptions` (`eslint.config.mjs:248-253`), with the same comment rationale.
  - New script `apps/ptah-extension-webview/scripts/assert-eager-bundle.mjs`:
    - reads `dist/apps/ptah-extension-webview/index.html` and follows static `import` statements from its module scripts to build the eager closure;
    - fails if any eager file contains `ptah-git-`, `ptah-diff-view`, `ptah-review-`, `ptah-spot-editor`, `ptah-commit-composer`, `ptah-task-worktree`, `ptah-history-timeline` or `ptah-conflict-banner`;
    - prints the gzip size of `main.js` and of the whole closure;
    - is exposed as an Nx target `verify-eager-bundle` depending on `build`.
- Verified contracts and entry points: `app.config.ts:62-67, 208-211`; `eslint.config.mjs:227-253`; `tsconfig.base.json:87-88, 101`.
- Dependencies: none new.
- Integration points: `workspace-coordinator.service.ts:122`, `electron-shell.component.ts:372` and `file-link-router.service.ts:121` keep their dynamic imports of the full barrel.
- Failure behaviour: the script exits non-zero with the offending file and selector.
- Quality requirements: `main.js` gzip ≤ base commit (NFR bundle). The research baseline is 383.9 KB gz (`research-report.md` evidence row 3).
- Verification seam:
  - `git-status-message-routing.spec.ts` and `git-dock-arming-identity.spec.ts` import from `@ptah-extension/git-ui/services`, with every assertion unchanged (Requirement 3.1).
  - The `verify-eager-bundle` target runs in CI after the webview build.
- Files:
  - CREATE `D:/projects/ptah-extension/libs/frontend/git-ui/src/services.ts`
  - MODIFY `D:/projects/ptah-extension/tsconfig.base.json`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-extension-webview/src/app/app.config.ts`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-extension-webview/src/app/git-status-message-routing.spec.ts`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-extension-webview/src/app/git-dock-arming-identity.spec.ts`
  - CREATE `D:/projects/ptah-extension/apps/ptah-extension-webview/scripts/assert-eager-bundle.mjs`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-extension-webview/project.json` (target)
  - MODIFY `D:/projects/ptah-extension/eslint.config.mjs` (only if lint requires)

#### 17. Pierre renderer adapter and hunk mapping (Requirements 3.2, 3.3; orchestrator item 5)

- Purpose: one Angular host for `@pierre/diffs` that renders a git patch with Angular-owned, accessible hunk controls.
- Responsibilities:
  - Dependency: `"@pierre/diffs": "1.5.1"`, exact version with no caret `[user-requested: Req 3.2]`.
  - `pierre-config.ts`:
    - `preferredHighlighter: 'shiki-js'`;
    - a fine-grained language map from file extension to a `() => import('shiki/langs/<lang>.mjs')` lazy loader, registered through Pierre's `registerCustomLanguage` for the languages first rendered, as the research measured;
    - two themes mapped from `[data-theme-mode]` (`styles.css:109-117`);
    - **`lineDiffType: 'word'`**: marks only changed word regions. The rejected values are `'word-alt'` (the default, which joins regions across one character) and `'word-line'` (one highlight per line), per `types.ts:458-462` `[user-requested: Gate 1.7 open item 2]`;
    - `diffStyle` taken from the persisted `diff.renderSideBySide` setting;
    - `hunkSeparators: 'line-info'`;
    - `expandUnchanged: false`.
  - `PierreDiffHostComponent`, standalone and OnPush:
    - input `patch: string` (the verbatim `GitDiffFileResult.patch`), OR `oldText`/`newText` for in-memory diffs through `parseDiffFromFile`;
    - input `hunks: GitHunkRef[]`;
    - output `hunkHosts: Signal<ReadonlyArray<{ index: number; slotName: string }>>`.
  - It instantiates the vanilla `FileDiff` imperatively (never inside a template), and disposes it on destroy and on input change.
  - **Hunk-index mapping.** Pierre hunk `i` is git hunk `i` (both keep `@@` order: research evidence rows 53 and 57). The adapter verifies that `pierreHunks.length === hunks.length` and that each `additionStart/deletionStart` equals `modifiedStart/originalStart`. On a mismatch it emits `mappingError` and the canvas renders the file read-only with a "hunk actions unavailable" note. It never guesses.
  - **Toolbar host slot.** Use `hunk-separator-<type>-<i>` when Pierre rendered a separator for hunk `i` (read from its post-render hunk data). Otherwise use the annotation slot `annotation-additions-<modifiedStart>` (for a pure-deletion hunk, `annotation-deletions-<originalStart>`), registered as a Pierre line annotation. This is needed because separators are skipped when no collapsed lines precede the hunk (`DiffHunksRenderer.ts:2406-2408`). Angular renders one light-DOM `<div [attr.slot]="host.slotName">` per hunk, so controls stay outside the shadow root `[user-requested: design-spec §0]`.
  - **CRLF specification.**
    - Ptah passes Pierre the exact bytes of `git diff` output. CR characters stay inside line bodies and are never stripped or normalized.
    - Hunk line counts come from `@@` headers. Pierre parses headers and not content, so counts are unaffected by CRLF.
    - Rendering hides a trailing `\r` visually through Pierre's own tokenizer, and the adapter does not pre-process.
    - The Requirement 3.3 spec asserts this on a CRLF file committed with `core.autocrlf=false`, and on one with `autocrlf=true`.
  - Secondary entry `libs/frontend/git-ui/src/diff-renderer.ts` exports `PierreDiffHostComponent` and `TextDiffViewComponent`, a thin two-string wrapper for Requirement 8.3. tsconfig path `@ptah-extension/git-ui/diff-renderer`.
- Verified contracts and entry points:
  - `GitDiffFileResult.patch/hunks` (`rpc-git.types.ts:371-395`);
  - `splitPatch` and `parseHunkRefs` (`git-info.service.ts:1484-1533`);
  - Pierre `types.ts:418-462`, `DiffHunksRenderer.ts:2406-2500`, `getLineAnnotationName.ts`, `parseDiffFromFile.ts`.
- Dependencies: `@pierre/diffs` (lazy only), shared types. No core import.
- Integration points: `ReviewCanvasComponent` (P4), `LazyDiffViewComponent` (P4, Component 28).
- Failure behaviour:
  - A chunk load failure shows the lazy loading/error state from parity §7 ("Loading diff editor…" successor) with Retry.
  - A mapping mismatch makes the file read-only, as above.
- Quality requirements:
  - The Pierre chunk is not in the eager closure (Component 16 script).
  - The realistic first diff is ≤ research figure ×1.15, that is 189 KB gz ×1.15 ≈ 217 KB gz. Measured by the eager script's lazy report. `[lane-proposed]` tolerance.
- Verification seam (Requirement 3.3):
  - `pierre-hunk-mapping.real-git.spec.ts` in git-ui with a jsdom Pierre parse, or parse-only if Pierre's parser is DOM-free. It generates real `git diff` patches in a temp repo for a multi-hunk file, a rename (`-M`) and a CRLF file. It asserts one-to-one ordinal and start mapping against `parseHunkRefs` from a shared test helper.
  - `pierre-diff-host.component.spec.ts`: exactly one toolbar host per hunk, including a hunk at line 1 and two adjacent hunks (A1).
  - Manual A2 check recorded in the batch report.
- Files:
  - MODIFY `D:/projects/ptah-extension/package.json` (add `@pierre/diffs` 1.5.1)
  - CREATE `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/renderer/pierre-config.ts`
  - CREATE `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/renderer/pierre-diff-host.component.ts`
  - CREATE `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/renderer/pierre-diff-host.component.spec.ts`
  - CREATE `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/renderer/text-diff-view.component.ts`
  - CREATE `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/renderer/pierre-hunk-mapping.real-git.spec.ts`
  - CREATE `D:/projects/ptah-extension/libs/frontend/git-ui/src/diff-renderer.ts`
  - MODIFY `D:/projects/ptah-extension/tsconfig.base.json`

#### 18. File-status badge with AA contrast (orchestrator item 4, design-spec §13a)

- Purpose: fix the A/M/D/R/C/U/T badge contrast once, in the one location every surface uses.
- Responsibilities:
  - `FileStatusBadgeComponent` (selector `ptah-file-status-badge`, inputs `status` and `conflictKind?`) in `libs/frontend/ui/src/lib/native/file-status-badge/`:
    - a tinted chip: `bg-base-300`, `text-base-content` letter, `font-semibold`, and a 2 px left border in the status hue;
    - an `aria-label` with the full word (Added, Modified, …);
    - `title` text.
  - Contrast comes from the text on `base-300`. That is the pair the repository already gates across themes (`base-content-muted.spec.ts`, `styles.css:119-150`), so it holds in every theme, not only in anubis. The hue is decoration: the letter carries the meaning.
  - `git-ui` (tree, headers, task and history rows) and `chat-ui` (the card) use it. The existing badges in `source-control-file.component.ts:219-275` and `git-review-file-row.component.ts:178-222` are deleted with their components in Component 29.
  - The design's §0 override classes (`.err-solid-text`, `.ok-solid-text`, `.diff-add-text`, `.diff-del-text`) go into `styles.css`. They are scoped to `[data-theme='anubis']` and `[data-theme='anubis-light']` exactly as the design measured `[user-requested: Gate 1.7]`. Other themes keep daisyUI's stock pairing, which is today's behaviour.
- Verified contracts and entry points: `libs/frontend/ui/src/index.ts:1-39` (star barrel, native domain); `native/index.ts`; `styles.css:109-150`.
- Dependencies: ui is `type:ui`, and both git-ui and chat-ui are `type:feature`, which may depend on `type:ui` (`eslint.config.mjs:364-373`).
- Integration points: every file row.
- Failure behaviour: none.
- Quality requirements: WCAG AA for the letter in both anubis themes (axe) and by construction in the other 32.
- Verification seam:
  - `file-status-badge.component.spec.ts`: labels per status.
  - Extend `apps/ptah-extension-webview/src/app/base-content-muted.spec.ts`, or add a sibling spec, to assert that `base-content` on `base-300` is ≥4.5:1 for every theme in the picker.
  - Axe in Component 24 and Component 20 e2e.
- Files:
  - CREATE `D:/projects/ptah-extension/libs/frontend/ui/src/lib/native/file-status-badge/file-status-badge.component.ts`
  - CREATE `D:/projects/ptah-extension/libs/frontend/ui/src/lib/native/file-status-badge/file-status-badge.component.spec.ts`
  - CREATE `D:/projects/ptah-extension/libs/frontend/ui/src/lib/native/file-status-badge/index.ts`
  - MODIFY `D:/projects/ptah-extension/libs/frontend/ui/src/lib/native/index.ts`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-extension-webview/src/styles.css`
  - CREATE `D:/projects/ptah-extension/apps/ptah-extension-webview/src/app/status-badge-contrast.spec.ts`

#### 19. Turn change-set recorder, store and RPC (backend for Requirements 4.1, 4.2, 4.7)

- Purpose: produce and persist one change set per agent turn, with no dependence on a live stream.
- Responsibilities:
  - `TurnChangeSetRecorder` (rpc-handlers, `src/lib/chat/change-set/`).
  - **Turn start.** It subscribes to `UserPromptSubmitCallbackRegistry.register` and captures a baseline for the session's directory (A6):
    - `getGitInfo` gives the file entries;
    - `fs.stat` (mtimeMs and size) for each changed path, bounded to 2,000 paths.
    - The baseline is held in a Map keyed by sessionId and deleted when the turn ends. At most one entry per live session.
  - **Turn end.** It subscribes to `SdkAdapterEvents.onTurnEnded` and takes the after-snapshot the same way. A path is changed if:
    - its status, origPath or numstat differs;
    - it appears or disappears;
    - or its mtime or size differs.
  - Counts come from `git diff HEAD --numstat -z -- <changed paths>`, or from the empty-tree SHA on an unborn HEAD. Untracked additions use the existing untracked counter (`git-info.service.ts:2958-2986`), exposed through a new facade method `readChangeSetNumstat(workspacePath, paths)`.
  - Empty set: no record, no push (Requirement 4.2).
  - Otherwise it builds a `TurnChangeSet`:
    - `{ sessionId, workspaceRoot, turnStartedAt, turnEndedAt, files: TurnChangeSetFile[] (≤500, plus truncatedCount), totals, countsUnavailable }`;
    - `TurnChangeSetFile = { path, origPath?, status: 'A'|'M'|'D'|'R'|'U', additions: number|null, deletions: number|null }`.
  - It persists through `TurnChangeSetStore` and broadcasts `git:turnChangeSet`.
  - `TurnChangeSetStore` (`*Store`, pure I/O, `CONVENTIONS.md` §6): key `ptah.turnChangeSets:<sessionId>` in `PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE`. It keeps the most recent 100 change sets per session, `[lane-proposed]` bound.
  - RPC `git:turnChangeSets { sessionId }` returns `{ changeSets: TurnChangeSet[] }`, in the new handler class `GitChangeSetRpcHandlers` (manifest entry, `requires: []`).
  - Registered as a singleton next to `SessionLifecycleNotifier` (`register-shared-rpc-handlers.ts:49`) and resolved in `activateSessionLifecycleNotifier` (`:58-61`), so it is active wherever turn events reach a webview.
- Verified contracts and entry points: `user-prompt-submit-callback-registry.ts:8-23`; `callback-registry.base.ts:22`; `sdk-adapter-events.service.ts:188`; `session-lifecycle-notifier.ts:58-65`; `session-metadata-store.ts:20-30, 153, 403`; `manifest.ts:14-21`.
- Dependencies: agent-sdk tokens (`SDK_TOKENS.SDK_ADAPTER_EVENTS`, `SDK_TOKENS.SDK_USER_PROMPT_SUBMIT_CALLBACK_REGISTRY`), `TOKENS.GIT_INFO_SERVICE`, `TOKENS.WEBVIEW_MANAGER`, `PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE`. This is L4 → L3/L1/L0.5 per `CONVENTIONS.md` §8.
- Integration points:
  - shared types in a new `rpc-change-set.types.ts`;
  - `MESSAGE_TYPES.GIT_TURN_CHANGE_SET = 'git:turnChangeSet'` plus a payload-map entry;
  - Component 20 consumes both.
- Failure behaviour:
  - A non-git directory records nothing.
  - An after-status that is unavailable records nothing and logs once. Without a trustworthy file list there is no card.
  - A numstat failure records files with null counts and `countsUnavailable: true`, which renders "counts unavailable" (Requirement 4.4).
  - A storage failure is warned; the push still happens, so the live card still shows.
  - A missing baseline (app started mid-turn) compares against an empty baseline, marks `baselineMissing: true`, and the card shows all dirty files.
- Quality requirements: two `getGitInfo` calls per turn; both join the single-flight. No timers.
- Verification seam:
  - `turn-change-set-recorder.spec.ts` (fake git and events) covers:
    - no change gives no push;
    - an Edit of an already-dirty file with the same numstat is caught by mtime;
    - a delete through Bash is caught;
    - truncation at 500;
    - null counts.
  - `turn-change-set.store.spec.ts`: bound of 100 and round-trip.
  - `git-change-set-rpc.handlers.spec.ts`.
  - The manifest invariant spec stays green.
- Files:
  - CREATE `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/chat/change-set/turn-change-set-recorder.service.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/chat/change-set/turn-change-set-recorder.service.spec.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/chat/change-set/turn-change-set.store.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/chat/change-set/turn-change-set.store.spec.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/git-change-set-rpc.handlers.ts` (+ spec)
  - MODIFY `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/index.ts`
  - CREATE `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-change-set.types.ts`
  - MODIFY `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc.types.ts`
  - MODIFY `D:/projects/ptah-extension/libs/shared/src/lib/types/messages/message-constants.ts`
  - MODIFY `D:/projects/ptah-extension/libs/shared/src/lib/types/messages/payload-map.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ts` (`readChangeSetNumstat` delegate)

#### 20. Change-set card, store and actions (frontend for Requirements 4 and 5.1-5.4)

- Purpose: show one card per turn that changed files, on both hosts, from persisted data.
- Responsibilities:
  - **chat-ui `ChangeSetCardComponent`** (presentational, standalone, OnPush):
    - inputs `changeSet`, `host: 'electron' | 'vscode'`, `reconciled: ReadonlySet<string>`, `conflicted: ReadonlySet<string>`;
    - outputs `review`, `openFile(path)`, `openScm`.
    - Markup per design-spec §4.1 and §5: the whole row is a button with no nested controls. It uses `ptah-file-status-badge`; the Conflicted badge uses `.err-solid-text`; "counts unavailable" and "No longer changes HEAD" states.
  - **chat `ChangeSetStore`** (root service, `MESSAGE_HANDLERS` for `git:turnChangeSet` in the app composition root):
    - `Map<sessionId, TurnChangeSet[]>`, loaded once per session switch with `git:turnChangeSets`;
    - reconciliation is **one** `git:info` per session view (deduped, 5 s freshness). It runs on session open, on `session:turnEnded`, and on Electron `git:status-update` for the active session, debounced to 1 s. A file absent from the current status is reconciled; a `U` status is conflicted.
    - There are no per-card observers or timers `[project-rule: runtime-cost working rule]`.
  - **chat `ChangeSetActionsService`.**
    - On VS Code (`VSCodeService.isElectron === false`, `vscode.service.ts:171`) it calls `command:execute` with `ptah.review.openChanges`, `ptah.review.openDiff`, `ptah.review.openMerge` or `ptah.review.openScm`, passing `args: [{ workspaceRoot, files | path }]`.
    - On Electron it reveals the dock the same way `file-link-router.service.ts:94-137` does, then dynamically imports `@ptah-extension/git-ui` and calls `ReviewNavigationService.openChangeSet({ workspaceRoot, files, ownerSessionId })` or `.openFile(path)` (Component 24).
    - A failed action shows an inline card error.
  - **Transcript.** `chat-transcript.component.html:34-60` inserts a `@defer (when changeSetsFor(msg).length)` block after the last assistant message of a turn. The join rule: a card belongs after the last message with `timestamp ≤ turnEndedAt` and `> turnStartedAt` (A7). The `when` trigger has no per-item observer, unlike `on viewport`, and keeps the card chunk lazy.
- Verified contracts and entry points: lane Q7 transcript lines; `file-link-router.service.ts:94-169`; `vscode.service.ts:171`; `CommandExecuteParams` (`rpc-misc.types.ts:311-326`, lane Q2).
- Dependencies:
  - chat → chat-ui, ui, core; git-ui dynamic only (existing edge).
  - chat-ui → ui.
- Integration points: Components 19, 21 and 24.
- Failure behaviour:
  - `git:turnChangeSets` failure: live cards only, logged.
  - Reconcile failure: cards show recorded counts with no reconciled marks. They never show zeros.
- Quality requirements:
  - Eager growth limited to the store and actions services. The card component is deferred.
  - Axe clean in both themes.
  - Every row is keyboard reachable with a visible focus ring.
- Verification seam:
  - `change-set-card.component.spec.ts`: states for Requirements 4.1, 4.3 and 4.4.
  - `change-set.store.spec.ts`: persisted load, push merge, reconcile, no card for zero files.
  - `change-set-actions.service.spec.ts`: VS Code command names and args; Electron path.
  - E2E `apps/ptah-electron-e2e/src/specs/git/change-set-card.spec.ts`: an agent turn that edits two files produces a card; reopening the session renders it (Requirement 4.7).
  - VS Code e2e in `apps/ptah-extension-vscode-e2e`: the card "Review all" opens a multi-diff (Requirement 5.1).
- Files:
  - CREATE `D:/projects/ptah-extension/libs/frontend/chat-ui/src/lib/molecules/change-set/change-set-card.component.ts` (+ spec)
  - MODIFY `D:/projects/ptah-extension/libs/frontend/chat-ui/src/index.ts`
  - CREATE `D:/projects/ptah-extension/libs/frontend/chat/src/lib/services/change-set/change-set.store.ts` (+ spec)
  - CREATE `D:/projects/ptah-extension/libs/frontend/chat/src/lib/services/change-set/change-set-actions.service.ts` (+ spec)
  - MODIFY `D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html`
  - MODIFY `D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts`
  - MODIFY `D:/projects/ptah-extension/libs/frontend/chat/src/index.ts`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-extension-webview/src/app/app.config.ts` (`MESSAGE_HANDLERS` for the store)
  - CREATE `D:/projects/ptah-extension/apps/ptah-electron-e2e/src/specs/git/change-set-card.spec.ts`

#### 21. VS Code `ptah.review.*` commands and HEAD content provider (Requirement 5)

- Purpose: open VS Code's own diff, changes, merge and SCM views from the card, with no git UI in the webview.
- Responsibilities:
  - `ReviewCommands` registers four commands:
    - `ptah.review.openChanges(args)`
    - `ptah.review.openDiff(args)`
    - `ptah.review.openMerge(args)`
    - `ptah.review.openScm()`
  - Each command validates its args, for example `{workspaceRoot: string, files: {path, origPath?, status}[]}` (at most 500 files):
    - `workspaceRoot` must equal one of `vscode.workspace.workspaceFolders` (normalized);
    - each path is resolved and checked with `isPathWithinRoots`;
    - on failure the command throws `Error('Path is outside the workspace.')`, so `command:execute` reports failure (Requirement 5.6).
  - Left side for tracked files is `ptah-git-head:/<rel>?root=<folderIndex>`, served by `PtahGitHeadContentProvider`. That provider calls `GitInfoService` `git show HEAD:<rel>` through a new facade method `readHeadText(workspacePath, rel)`, capped at 2 MiB and read-only. Because it is Ptah's own provider, it works without `vscode.git` (Requirement 5.7). Added files use `undefined` as the left side and deleted files use `undefined` as the right side (A3).
  - `openChanges` runs `vscode.changes` with the title `Agent changes (N files)`. If that throws, it falls back to per-file `vscode.diff` in sequence (Requirement 5 NFR fallback).
  - `openMerge` runs `git.openMergeEditor` with the file URI. If the git extension is missing or the call throws, it falls back to `vscode.open`.
  - `openScm` runs `workbench.view.scm`.
  - `package.json`: declare the four commands under `contributes.commands` and hide them from the palette with `menus.commandPalette` entries `{ "command": "ptah.review.*", "when": "false" }`. There is one entry per command, following the existing `menus.commandPalette` block at `:144-169`.
  - The `command:execute` allowlist is **not** changed (Requirement 5.5).
- Verified contracts and entry points:
  - `command-rpc.handlers.ts:29, 35-40`;
  - registration pattern `apps/ptah-extension-vscode/src/commands/license-commands.ts:210-227` and activation `activation/post-init.ts:31-34` (lane Q1);
  - `path-containment.ts:64`;
  - `package.json:15-17, 74-169`;
  - VS Code 1.100 commands (research evidence rows 58-60).
- Dependencies: `TOKENS.GIT_INFO_SERVICE` (RC13 singleton).
- Integration points: Component 20 VS Code actions.
- Failure behaviour: refusal throws a sanitized message, with no absolute path. A provider read failure returns empty content with a status-bar warning, so the user still sees the right side.
- Quality requirements: the VSIX gets no new assets (Requirement 5.8).
- Verification seam:
  - `review-commands.spec.ts` (mocked `vscode` API) covers:
    - an outside path is refused;
    - added and deleted sides;
    - the fallback when `vscode.changes` rejects;
    - merge fallback.
  - `ptah-git-head-content-provider.spec.ts`.
  - The allowlist spec in rpc-handlers asserts the list is unchanged.
  - VS Code e2e scenario (Requirement 5.1-5.4).
- Files:
  - CREATE `D:/projects/ptah-extension/apps/ptah-extension-vscode/src/commands/review-commands.ts` (+ spec)
  - CREATE `D:/projects/ptah-extension/apps/ptah-extension-vscode/src/commands/ptah-git-head-content-provider.ts` (+ spec)
  - MODIFY `D:/projects/ptah-extension/apps/ptah-extension-vscode/src/core/ptah-extension.ts` (or `activation/post-init.ts`, whichever calls `registerCommands`)
  - MODIFY `D:/projects/ptah-extension/apps/ptah-extension-vscode/package.json`
  - MODIFY `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ts` (`readHeadText`)

### P4 — Electron review canvas, spot editor, Monaco removal, parity

#### 22. Agent feedback port (Requirements 6.7, 11.2)

- Purpose: let git-ui send a message to a chat session without importing chat.
- Responsibilities:
  - Core token `AGENT_FEEDBACK_SENDER: InjectionToken<IAgentFeedbackSender>` with `send(target: { sessionId: string } | 'active', text: string): Promise<{ sent: boolean; error?: string }>`.
  - The chat implementation `ChatAgentFeedbackSender` uses `ChatStore.sendOrQueueMessage` (`chat.store.ts:227-232`). It activates the target session's tab first when needed (A4).
  - Provided in `app.config.ts` next to `FILE_LINK_OPENER` (`:186-196`).
- Verified contracts and entry points: `file-link-opener.token.ts:32-41`; `app.config.ts:186-196`.
- Dependencies: core ← chat (provider), core ← git-ui (consumer).
- Failure behaviour: `sent:false` keeps the drafts and shows the error.
- Verification seam: `chat-agent-feedback-sender.spec.ts`; a git-ui spec with a fake sender.
- Files:
  - CREATE `D:/projects/ptah-extension/libs/frontend/core/src/lib/tokens/agent-feedback-sender.token.ts`
  - MODIFY `D:/projects/ptah-extension/libs/frontend/core/src/index.ts` (one export line)
  - CREATE `D:/projects/ptah-extension/libs/frontend/chat/src/lib/services/agent-feedback/chat-agent-feedback-sender.service.ts` (+ spec)
  - MODIFY `D:/projects/ptah-extension/libs/frontend/chat/src/index.ts`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-extension-webview/src/app/app.config.ts`

#### 23. `ReviewShellComponent` (design-spec §3; parity §1, §2)

- Purpose: the dock body, a four-tab shell with a header and a conflict-banner host. It replaces `GitDockComponent`.
- Responsibilities:
  - Keeps the lazy-mount contract (`electron-shell.component.ts:366-392` switches to `m.ReviewShellComponent`).
  - Arms and disarms the status and branch services on mount and unmount, and detects editor targets (parity §1 rows 2-3).
  - Loading, not-a-repo and stale states (RC3).
  - The header is the existing `GitDockHeaderComponent` re-hosted: branch picker, stash popover, Open-in, fetch/pull/push.
  - Tabs use `NativeTabGroupComponent` (`native-tab-group.component.ts:71, 136-151`) with Changes (count), Commit, Task and History.
  - The conflict-banner slot sits above the tabs.
  - Each tab body is lazy (`@defer (on immediate)` for Changes; `@defer (when activeTab() === 'commit')` and so on).
  - Container width comes from one `ResizeObserver` on the shell host (design-spec §6.1a). There is one observer in total, not one per row, and it is disconnected on destroy.
- Verified contracts and entry points: `git-dock.component.ts:44-294` (behaviour to preserve), `git-dock-header.component.ts`, `electron-shell.component.ts:366-392`.
- Dependencies: git-ui → ui (native tab group, popover) — the new edge. git-ui never depends on chat.
- Integration points: `ReviewNavigationService` (Component 24) selects the tab and scope.
- Failure behaviour: a failed tab chunk shows Retry, which mirrors `dockLoadFailed` (`electron-shell.component.ts:366-388`).
- Quality requirements: standalone, OnPush, signals `[project-rule: task NFR Angular; git-dock.component.ts:220]`.
- Verification seam:
  - `review-shell.component.spec.ts` ports the `git-dock.component.spec.ts` and `git-dock.mount.spec.ts` cases.
  - `git-dock-arming-identity.spec.ts` targets `ReviewShellComponent`.
  - E2E `git-dock.spec.ts` updated.
  - Axe on the shell.
- Files:
  - CREATE `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/review-shell/review-shell.component.ts` (+ spec)
  - MODIFY `D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`
  - MODIFY `D:/projects/ptah-extension/libs/frontend/git-ui/src/index.ts`
  - MODIFY `D:/projects/ptah-extension/libs/frontend/git-ui/project.json` (only if an implicit dependency must be declared)
  - MODIFY `D:/projects/ptah-extension/apps/ptah-extension-webview/src/app/git-dock-arming-identity.spec.ts`

#### 24. `ReviewCanvasComponent` and `ReviewDiffService` (Requirement 6; parity §3, §7, §9)

- Purpose: review every change in one virtualized scroll, deciding hunk by hunk.
- Responsibilities:
  - **Changed-file tree.**
    - Staged and Changes sections, collapsible folders (reuse `changed-file-tree.ts`), `FileStatusBadgeComponent`, `+N/−N`.
    - Row actions: stage, unstage, and discard with confirmation. Discard now confirms `[user-requested: parity §3 row "designer decides"]`.
    - Open-in, and viewed marks in branch mode (key `gitReview.viewed.v1`, `git-review.service.ts:9`).
    - Filter.
    - The resizable rail (reuse `RailResizeHandleComponent`); collapsed and width state persist through `ElectronLayoutService`.
    - Stacks below 520 px of shell width.
    - Keyboard: roving tree navigation, next and previous file.
  - **Comparison bar.**
    - Working tree / Staged / Branch review… (base and head from the review toolbar) and Historical (from the History tab).
    - Split/Unified toggle persisted as `diff.renderSideBySide` through `settings:get/set` (`diff-view.component.ts:1444-1495`).
    - Totals, `flex-wrap`.
  - **Continuous diff.**
    - Angular file list, one entry per file with a sticky header (path, rename-from, hunk count, chips).
    - One `IntersectionObserver` for the list, with a rootMargin of one viewport, mounts `PierreDiffHostComponent` for near-visible files and unmounts far ones. Placeholders use estimated heights from line counts, then measured heights cached per file (A9).
    - Labelled rows (binary, LFS, submodule, conflicted, too large) never mount Pierre (Requirements 6.2 and 6.10).
    - Per-file scroll position is preserved (parity §7 "view state").
  - **Hunk toolbar** (slotted, Component 17):
    - "Hunk i of n", Previous/Next, and actions by comparison:
      - worktree: Accept = stage, Reject = revert with confirmation;
      - staged: Unstage;
      - branch and historical: none, shown `aria-disabled`.
    - Roving tabindex, with Left/Right between buttons (`diff-view.component.ts:249-345`).
    - Refused state: sanitized reason chip with `animate-glow-urgent`, a forced re-read, and no action on a renumbered hunk (Requirement 6.6, `STALE_SNAPSHOT` token rules from `diff-tabs.service.ts:593-607`).
  - **`ReviewDiffService`** (the successor to `DiffTabsService`, exported from `/services`):
    - diff cache keyed by `(comparison, path, origPath)`;
    - lazy `git:diffFile` for mounted files only;
    - revalidation on `git:status-update` and `file:content-changed` with the RC11 scoping and trailing queue (Component 15);
    - `applyHunks` through `git:applyHunks`, then a fresh read.
  - **`ReviewNavigationService`**: `openChangeSet({ workspaceRoot, files, ownerSessionId })`, `openFile(path, line?)`, `openHistorical(sha)` and `openStashFile(...)`. It sets the tab, scope and target.
  - **Draft comments.** Selecting lines, or pressing the gutter comment action, creates a draft. `ReviewCommentDraftStore` is a root service holding an in-memory Map keyed by `ownerSessionId ?? workspaceRoot`, so drafts survive the canvas closing within the app session (Requirement 6.7). The footer bar "✎ N draft comments" and "Send to agent" produce one message: for each draft, the path, `Lstart-Lend`, and the quoted lines in a fenced block. It is sent through `AGENT_FEEDBACK_SENDER` to `ownerSessionId` or `'active'`. On `sent:true` the drafts clear.
- Verified contracts and entry points: parity §3, §7 and §9 rows (each with file:line); `git:applyHunks` contract `rpc-git.types.ts:412-459`; `git-review.service.ts:9, 90-95, 199`.
- Dependencies: Components 17, 18, 22, 25.
- Integration points: Component 20 (Electron card), the file-link router (spot editor), History and Stash (historical).
- Failure behaviour:
  - Read failure: opaque error row with Retry. Failed reads are never shown as content (parity §7).
  - Apply failure: the backend sentence next to the hunk, then a re-read.
  - Transport failure: a generic sanitized message.
- Quality requirements:
  - On the 200-file and 10,000-line fixture: scroll stays at ≥50 fps on the e2e perf spec (`perf-m1-diff-redisplay.spec.ts` successor) and there are no long tasks >200 ms during a scroll sweep `[lane-proposed thresholds, measured not guessed; recorded as evidence]`.
  - The list has one observer, released on destroy.
- Verification seam:
  - Unit specs per component and service, porting the cases from `diff-view.component.spec.ts`, `diff-tabs.service.spec.ts`, `source-control-*.spec.ts` and `git-review-*.spec.ts`.
  - E2E successors: `hunk-apply-real-rpc.spec.ts`, `hunk-widget-mouse.spec.ts` (slot controls), `glyph-margin-visual.spec.ts` (gutter markers), `hunk-revert-top-layer.spec.ts`, `diff-view-state.spec.ts`, `git-review-controls.spec.ts`, `git-rail-collapse.spec.ts`, `perf-m1-diff-redisplay.spec.ts`.
  - New `review-canvas-large.spec.ts` (Requirement 6.2) and `review-comments.spec.ts` (Requirement 6.7).
  - Axe dark and light.
- Files (all CREATE unless noted):
  - `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/review-canvas/review-canvas.component.ts` (+ spec)
  - `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/review-canvas/changed-file-tree.component.ts` (+ spec)
  - `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/review-canvas/comparison-bar.component.ts` (+ spec)
  - `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/review-canvas/file-diff-section.component.ts` (+ spec)
  - `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/review-canvas/hunk-toolbar.component.ts` (+ spec)
  - `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/review-canvas/draft-comments-bar.component.ts` (+ spec)
  - `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/review-diff.service.ts` (+ spec)
  - `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/review-navigation.service.ts` (+ spec)
  - `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/review-comment-draft.store.ts` (+ spec)
  - MODIFY `D:/projects/ptah-extension/libs/frontend/git-ui/src/services.ts` (swap `DiffTabsService` → `ReviewDiffService`)
  - e2e files under `D:/projects/ptah-extension/apps/ptah-electron-e2e/src/specs/git/` (listed above)
  - CREATE `D:/projects/ptah-extension/apps/ptah-electron-e2e/src/support/axe.ts` (copy of the landing-page helper shape)

#### 25. `GitConfirmDialogComponent` (orchestrator item 6)

- **Decision.** Use no Angular CDK Dialog or FocusTrap. Extract the existing native `<dialog>` alertdialog into one git-ui component.
  - `[project-rule: libs/frontend/ui/src/index.ts:16-27]` prefers CDK-free `native` components and names avoiding CDK FocusTrap for the popover.
  - The existing pattern already delivers every contract the design lists (`diff-view.component.ts:482-567, 1159-1181, 1784-1830`): a top-layer `showModal()`, `role="alertdialog"`, labelled and described, focus on the safe choice, Escape through the `cancel` event, a Tab trap between its focusables, focus restored to the invoker, and no backdrop dismiss.
  - This supersedes design-spec §2's CDK line. The recorded conflict is below.
- Purpose: one confirmation primitive for every destructive action: reject hunk, discard file, drop stash, abort operation, remove worktree, disk conflict (Reload/Overwrite), replace-unsaved, and open outside the workspace.
- Responsibilities:
  - inputs `title`, `description`, `confirmLabel`, `cancelLabel`, `tone: 'danger' | 'warning'`;
  - outputs `confirmed`, `cancelled`;
  - `open(invoker: HTMLElement)`.
  - The danger confirm uses solid `btn-error` with `.err-solid-text` (design §0).
- Verified contracts and entry points: as cited.
- Failure behaviour: if the element unmounts while open, it closes through the same path (`diff-view.component.ts:1159-1161`).
- Verification seam: `git-confirm-dialog.a11y.spec.ts` ports every case of `diff-view/diff-view-dialog.a11y.spec.ts` (285 lines). The top-layer e2e is `hunk-revert-top-layer.spec.ts`.
- Handoff conflict record: the design says CDK Dialog and FocusTrap; the repository rule and the existing pattern say native `<dialog>`. Resolution: native. The design's behavioural contract is fully kept; only the implementation primitive changes. The prototype `app.js` behaviour is the acceptance reference.
- Files:
  - CREATE `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/shared/git-confirm-dialog.component.ts`
  - CREATE `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/shared/git-confirm-dialog.a11y.spec.ts`

#### 26. Stash and history-historical wiring

This ties parity §5 to the canvas.

- Purpose: open stash and commit diffs as read-only historical comparisons in the canvas.
- Responsibilities: `GitStashService.openStashFileDiff` (`git-stash.service.ts:357-398`) routes to `ReviewNavigationService.openStashFile` instead of `DiffTabsService`. The stash popover stays in the header (parity §5 keep).
- Verified contracts and entry points: `git-stash.service.ts:357-398`; `stash-popover.component.ts:158-172`.
- Failure behaviour: unchanged.
- Verification seam: `git-stash.service.spec.ts` updated.
- Files:
  - MODIFY `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-stash.service.ts` (+ spec)

#### 27. Spot editor (Requirement 7) and `file:saveContent`

- Purpose: make a one-file edit without leaving Ptah. It is not an IDE.
- Responsibilities:
  - **Frontend `SpotEditorComponent`** (CodeMirror 6):
    - pinned exact versions of `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language` and `@codemirror/language-data`. Languages load lazily through `LanguageDescription.matchFilename`.
    - It is a mode of the Changes tab (design §3.3).
    - The header has Back to review, path, a Read-only badge, Edit, the Markdown Preview/Source toggle (disabled over 512 KB, `file-view.component.ts:32`, preview through the existing markdown pipe) and Save.
    - Opens at the linked line and column.
    - Chat links open read-only by default `[user-requested: design §7]`.
    - Opening a second file with unsaved changes prompts first (Requirement 7.4, Component 25).
    - Blocked state, Open-in, and the outside-workspace confirmation are kept (`file-view.component.ts:102-192`).
    - Line separator: detect CRLF or LF on load and set `EditorState.lineSeparator` (A12).
    - UTF-16 files are read-only.
  - **Disk conflict.**
    - `file:viewContent` success gains `sha256` (of the raw bytes) and `bom: boolean`.
    - Save sends `expectedSha256`. A mismatch returns `conflict`, and the dialog offers Reload (default) or Overwrite, which resends with `overwrite: true`.
    - A `file:content-changed` push for the open file with no local edits reloads silently. With edits, it marks the file stale.
  - **Backend `FileEditRpcHandlers`** (new capability `fileEditor`, Electron `true`, others default `false`):
    - `file:saveContent { path, workspaceRoot?, content, expectedSha256, overwrite? }`.
    - Resolves through `FileLinkRootPolicy.resolveForView`. Outside-roots, symlink-escape, non-file and missing targets are refused (no create). Content over `FILE_VIEW_MAX_BYTES` is refused.
    - The current bytes' sha256 is compared unless `overwrite`.
    - Writes UTF-8 (BOM re-added when `bom`) atomically: temp file in the same directory, then rename.
    - Returns `{ success: true, sha256 } | { success: false, reason: 'conflict' | 'outside-roots' | 'not-found' | 'not-a-file' | 'too-large' | 'invalid-request' | 'unwritable', error }`. Messages are fixed sentences, the same rule as `file-view-rpc.handlers.ts:13-22, 44-56`.
  - `FileViewReaderService` is kept as the read path (parity §8).
- Verified contracts and entry points:
  - `file-view-rpc.handlers.ts:61-185`; `FileViewContentResult` `rpc-misc.types.ts:193-217`;
  - `capabilities.ts` `RPC_CAPABILITIES`; manifest entry pattern `manifest.ts:185-196`;
  - `file-link-router.service.ts:94-137` (Electron link target).
- Dependencies: git-ui → `@codemirror/*` (lazy chunk); rpc-handlers → `FileLinkRootPolicy` (same lib).
- Integration points: `FileLinkRouterService.openInDock` calls `ReviewNavigationService.openFile` (replacing `DiffTabsService.openFileView`, `file-link-router.service.ts:121-123`).
- Failure behaviour: every refusal leaves the buffer unchanged and shows a fixed sentence. A failed write never truncates the target, because of the atomic rename.
- Quality requirements: the editor chunk is lazy. Save round-trips CRLF and BOM byte-for-byte (spec).
- Verification seam:
  - `spot-editor.component.spec.ts`: modes, conflict dialog, replace prompt, markdown limit, blocked state.
  - `file-edit-rpc.handlers.spec.ts`: containment, symlink escape, conflict, overwrite, BOM, atomicity (a rename failure leaves the original).
  - E2E successors: `file-view-tab.spec.ts` and `agent-file-links.spec.ts`.
  - New `spot-editor-save.spec.ts` (Requirements 7.2 and 7.3).
- Files:
  - CREATE `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.ts` (+ spec)
  - CREATE `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/spot-editor/codemirror-setup.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/file-edit-rpc.handlers.ts` (+ spec)
  - CREATE `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/file-edit-rpc.schema.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/host-profile/capabilities.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/file-view-rpc.handlers.ts` (`sha256`, `bom`)
  - MODIFY `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-misc.types.ts`
  - MODIFY `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc.types.ts`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-electron/src/rpc-host-profile.ts` (`fileEditor: true`)
  - MODIFY `D:/projects/ptah-extension/libs/frontend/chat/src/lib/services/file-link-router.service.ts` (+ spec)
  - MODIFY `D:/projects/ptah-extension/package.json` (CodeMirror packages, exact versions)

#### 28. Monaco removal and packaging (Requirements 8 and 5.8)

- Purpose: ship no Monaco, and ship no editor-only assets in the VSIX.
- Responsibilities:
  - Remove `monaco-editor` and `ngx-monaco-editor-v2` from root `package.json`, including the `overrides.monaco-editor` block referenced at `apps/ptah-electron/scripts/prune-dist-deps.js:17-36`.
  - Remove `provideMonacoEditor` (`app.config.ts:13, 285-287`) and the asset glob (`project.json:22-26`).
  - Remove the `.vscodeignore` Monaco lines (`:47-49`).
  - Update the comments in `prune-dist-deps.js` and `copy-renderer.js` that mention Monaco.
  - `packaged-deps.spec.ts` asserts that `monaco-editor` and `ngx-monaco-editor-v2` are absent from the root manifest, the Electron manifest and the packaged `node_modules` listing, and that no `assets/monaco` exists in the renderer output (Requirement 8.2).
  - **Skills drawer (Requirement 8.3).** `LazyDiffViewComponent` imports `@ptah-extension/git-ui/diff-renderer` dynamically and creates `TextDiffViewComponent` (unified only). It keeps its imperative lazy boundary and its loading and error states (`lazy-diff-view.component.ts:1-19, 161-184`).
  - **VSIX editor-only chunks (Requirement 5.8).**
    - The webview build sets `statsJson: true` (A8).
    - `assert-eager-bundle.mjs` (Component 16) also writes `dist/apps/ptah-extension-webview/electron-only-chunks.json`: the output chunks whose inputs lie only under `libs/frontend/git-ui/src/lib/{spot-editor,review-canvas,review-shell}/**` or `node_modules/@codemirror/**`.
    - `scripts/copy-webview.js` skips those files for the VSIX.
    - Pierre chunks stay, because the skills drawer uses them on both hosts, so they do not "exist only for those surfaces".
- Verified contracts and entry points: `app.config.ts:13, 285-287`; `project.json:17-36`; `.vscodeignore:47-49`; `packaged-deps.spec.ts:131-132`; `scripts/copy-webview.js` (invoked at `apps/ptah-extension-vscode/project.json:99`).
- Dependencies: Components 17, 24 and 27 must be complete, and Component 29's parity gates must be green before deletion.
- Failure behaviour: build-time failures only.
- Verification seam:
  - `packaged-deps.spec.ts`.
  - New `lazy-diff-view.component.spec.ts`: renders, keeps the lazy boundary, and asserts no static import of git-ui in the file (parity §11 last row).
  - `vscode-e2e` packaging test: VSIX listing has no `@codemirror` chunk.
- Files:
  - MODIFY `D:/projects/ptah-extension/package.json`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-extension-webview/src/app/app.config.ts`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-extension-webview/project.json`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-extension-vscode/.vscodeignore`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-electron/src/config/packaged-deps.spec.ts`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-electron/scripts/prune-dist-deps.js`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-electron/scripts/copy-renderer.js` (comment only)
  - MODIFY `D:/projects/ptah-extension/scripts/copy-webview.js`
  - MODIFY `D:/projects/ptah-extension/libs/frontend/skill-synthesis-ui/src/lib/components/clones/lazy-diff-view.component.ts`
  - CREATE `D:/projects/ptah-extension/libs/frontend/skill-synthesis-ui/src/lib/components/clones/lazy-diff-view.component.spec.ts`

#### 29. Parity migration and old-surface deletion (Requirement 13)

- Purpose: prove every `keep`/`move` row before anything old is deleted.
- Responsibilities:
  - A parity matrix file `parity-tests.md` in the task folder maps each `keep`/`move` row of `parity-inventory.md` to the passing successor test (file:line). Only then are these deleted:
    - `git-dock/*` (except `rail-resize-handle.*` and `git-dock-header.*`, which are re-hosted)
    - `source-control/*` components (keep `changed-file-tree.ts`)
    - `diff-view/*`, `file-view/*`, `review/git-review-*.component.*`, `worktree/worktree-section.*`
    - `services/diff-tabs.service.*`, `services/monaco-loader.service.ts`, `services/monaco-theme.*`
    - `types/diff-tab.types.ts` (after moving the still-used types)
  - The approved removals (4 rows) are deleted with no successor test `[user-requested: Gate 1 default 1]`.
  - Barrel `libs/frontend/git-ui/src/index.ts` is rewritten to the new surface and stays ≤150 lines `[project-rule: CONVENTIONS.md §3]`. Its doc comment becomes "depends on core, shared, ui and markdown — never on chat".
  - `WorkspaceCoordinatorService` (`workspace-coordinator.service.ts:117-129`) resolves `ReviewDiffService`/`GitReviewService` from the new barrel.
- Verified contracts and entry points: `parity-inventory.md` sections 1-12.
- Dependencies: all P4 components.
- Failure behaviour: the team-leader blocks the deletion batch while any row lacks a green test `[user-requested: Risk row 8]`.
- Verification seam: the matrix plus a CI run of `nx run-many -t test,lint,typecheck -p git-ui chat chat-ui skill-synthesis-ui ptah-extension-webview` and the Electron e2e `specs/git/*`.
- Files:
  - DELETE the files listed above under `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/`
  - REWRITE `D:/projects/ptah-extension/libs/frontend/git-ui/src/index.ts`
  - MODIFY `D:/projects/ptah-extension/libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts` (+ spec)
  - CREATE `D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/parity-tests.md`

### P5 — Workflow surfaces

#### 30. Commit composer (Requirement 9) and commit-message generator

- Purpose: commit staged changes with a generated or typed message and live hook output.
- Responsibilities:
  - **`CommitComposerComponent`** (Commit tab):
    - staged count;
    - "Generate message" (outline) and Commit (primary, disabled when there are no staged files or the message is empty);
    - a streamed hook log (`role="log"`, `aria-live="polite"`, max height with scroll);
    - on failure: an alert "Commit blocked by <hook>. Message kept.", with the log kept open;
    - on success: `shortHash` and `subject` with the message cleared;
    - a Cancel button while running.
  - **Backend streaming.**
    - `git:commit` accepts `operationId`.
    - `GitInfoService.commit` passes `onOutput` and an `AbortSignal` registered in an `OperationRegistry` (a Map keyed by operationId, deleted on settle).
    - `GitWorkflowRpcHandlers` broadcasts `git:operationOutput { operationId, stream, chunk }`, throttled to one push per 100 ms with at most 16 KiB per push. The backend keeps a 256 KiB tail for `hookOutput`.
    - `git:cancelOperation { operationId }` aborts the operation (Component 5 lock recovery applies).
  - **`CommitMessageGenerator`** (agent-sdk, `src/lib/commit-message/`):
    - Input: `readStagedPatch(workspacePath)`, a new facade method: `git diff --cached` with DIFF_FLAGS, capped at 48 KiB with a truncation note.
    - Auth: `IProviderAuthResolver.resolve('')` where `''` resolves to the active provider (`sdk-internal-query.curator-llm.ts:73-75`). `ProviderAuthError` rides the active provider with auth `undefined`. `ProviderQuotaError` returns `unavailable: 'rate-limited'`. `[user-requested: curator-style fallback, context.md research decisions]`
    - Execution: `internalQuery.execute({ lane: USER_ACTION_QUERY_LANE, model: 'haiku', maxTurns: 1, prompt, systemPromptAppend, abortController })` with a 45 s abort.
    - Output: the last assistant text is taken, trimmed to a conventional subject (≤72 chars) and body.
    - Result: discriminated `{ status: 'generated', message } | { status: 'unavailable', reason: 'no-staged-changes' | 'no-provider' | 'rate-limited' | 'unreachable' | 'empty' | 'timeout' }`. It never collapses "failed" into `''` `[project-rule: curator F1/F8 rationale, sdk-internal-query.curator-llm.ts:105-141]`.
  - RPC `git:generateCommitMessage { workspaceRoot }` in `GitWorkflowRpcHandlers`. The renderer timeout is 75 s.
- Verified contracts and entry points: `git-info.service.ts:946-979`; curator refs above; `USER_ACTION_QUERY_LANE` (`internal-query-concurrency-gate.ts:33`); `SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE`/`SDK_PROVIDER_AUTH_RESOLVER` (`tokens.ts:73, 90`).
- Dependencies: rpc-handlers → agent-sdk (existing edge, e.g. `agent-rpc.handlers.ts`).
- Integration points: `GitStatusService` staged count; RC1 result contract.
- Failure behaviour: generation unavailable shows "Message generation unavailable — type your own." and the field stays editable (Requirement 9.2). The commit path is independent of generation.
- Quality requirements: no provider call without a user click. Nothing commits without Commit (Requirement 9.1).
- Verification seam:
  - `commit-message-generator.spec.ts`: each discriminant, the auth fallback, and the quota stop.
  - `git-workflow-rpc.handlers.spec.ts`: streaming throttle and cancel.
  - `commit-composer.component.spec.ts`.
  - E2E `commit-composer.spec.ts` with a real hook that prints three lines over 2 s. Assert they arrive before completion (Requirement 9.3).
- Files:
  - CREATE `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/commit/commit-composer.component.ts` (+ spec)
  - CREATE `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/commit-message/commit-message-generator.service.ts` (+ spec)
  - CREATE `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/commit-message/commit-message-prompt.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/di/tokens.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/di/register.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/agent-sdk/src/index.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/git-workflow-rpc.handlers.ts` (+ spec)
  - CREATE `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/git-workflow-rpc.schema.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-operation.registry.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ts`
  - MODIFY shared: `rpc-git.types.ts` (new params and results), `rpc.types.ts`, `message-constants.ts`, `payload-map.ts`

#### 31. Task / worktree view and PR/CI status (Requirement 10)

- Purpose: show where the task branch stands locally and on GitHub.
- Responsibilities:
  - **`TaskWorktreeViewComponent`**:
    - Branch panel: branch, upstream, ahead/behind; the branch-details content moved from the popover.
    - PR panel: number and title, a state badge, review decision, CI passing/failing/pending counts, and an "Open PR" anchor (`target="_blank" rel="noopener noreferrer"`, href must be `https:`). Electron routes it to the browser through `main-window.ts:80, 46`.
    - When `gh` is unavailable: one muted line with no alert styling (Requirement 10.4).
    - Worktrees panel: rows are switch buttons, and Remove is a sibling icon button. This fixes the nested-button defect (parity §4 note). Add form. Locked and prunable badges.
    - Refresh icon.
  - **Refresh policy** (Requirement 10.5): on tab open, after a push completes, and on manual refresh. While the Task tab is visible, at most once per 60 s, with a single timer owned by the component, cleared on hide and destroy. The backend also caches per `(root, branch)` for 60 s.
  - **`GitHubPrStatusReader`** (vscode-core, `services/git/`):
    - spawns `gh pr view --json number,title,state,isDraft,reviewDecision,statusCheckRollup,url -- <branch>`. The branch is checked by `assertSafeRef`, which forbids a leading `-`.
    - `cwd` = workspace; env `GH_PROMPT_DISABLED=1`, `GH_NO_UPDATE_NOTIFIER=1`, `NO_COLOR=1`, `GH_PAGER=cat`, `GIT_TERMINAL_PROMPT=0`; timeout 15 s; spawned through the host `IProcessSpawner` when given, else cross-spawn (the same injection pattern as `GitInfoService`, `git-info.service.ts:356-371`).
    - Outcome mapping:
      - ENOENT → `gh-missing`;
      - stderr `/gh auth login|not logged in/i` → `unauthenticated`;
      - `/none of the git remotes.*GitHub host/i` → `not-github`;
      - `/no pull requests found/i` → `{ pr: null }`;
      - timeout → `timeout`;
      - else `error`.
    - The rollup is reduced to counts.
  - RPC `git:prStatus { workspaceRoot }` in `GitWorkflowRpcHandlers`. The backend resolves the current branch itself and never trusts a client branch.
- Verified contracts and entry points: parity §2 and §4 rows; `worktree.service.ts`; `main-window.ts:46, 80`; no existing `gh` use (lane Q8).
- Dependencies: Components 10 and 12.
- Failure behaviour: every unavailable reason is quiet and the rest of the view works. There are no repeated prompts, because the env disables them.
- Quality requirements: at most one `gh` spawn per minute per branch.
- Verification seam:
  - `github-pr-status.reader.spec.ts`: a fake spawner with each stderr fixture and a JSON fixture; asserts the env and argv.
  - `task-worktree-view.component.spec.ts`: throttle with fake timers, states.
  - Worktree e2e successor of `worktree-section.component.spec.ts` rows.
- Files:
  - CREATE `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/task/task-worktree-view.component.ts` (+ spec)
  - CREATE `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/github-pr-status.reader.ts` (+ spec)
  - MODIFY `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ts` (`getPrStatus` delegate)
  - MODIFY `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/git-workflow-rpc.handlers.ts`
  - MODIFY shared: `rpc-git.types.ts`, `rpc.types.ts`

#### 32. Conflict banner (Requirement 11)

- Purpose: when an operation is in progress, name it and offer the ways out.
- Responsibilities:
  - **`ConflictBannerComponent`** above the tabs, driven by `GitInfoResult.operation` (Component 13). Bordered card per design §11.
    - "Ask agent to resolve" sends through `AGENT_FEEDBACK_SENDER` (`'active'`) a message naming the operation and the conflicted paths.
    - "Open in editor" sends `editor:openMerge { workspaceRoot, path, target }`.
    - "Abort" confirms first (Component 25), then calls `git:operationAbort`.
    - "Continue" appears only when `conflictedPaths` is empty and calls `git:operationContinue`.
    - Delete/modify, symlink and submodule conflicts show "Open folder" instead of "Open in editor" (Requirement 11.6).
  - **Backend.**
    - `git:operationAbort` and `git:operationContinue` re-detect the operation server-side and never take a kind from the client.
    - Abort: `merge --abort`, `rebase --abort`, `cherry-pick --abort`.
    - Continue: merge → `commit --no-edit`; rebase and cherry-pick → `--continue` with env `GIT_EDITOR=true`.
    - Both run under the write lock with the hook timeout.
  - **`editor:openMerge`**:
    - `GitInfoService.materializeConflictStages(path)` writes stages `:1:`, `:2:` and `:3:` to `git rev-parse --git-path ptah-merge/<hash>/` (base, local, remote).
    - A launcher target whose definition declares `mergeArgs` (A11) gets `--merge <local> <remote> <base> <result>` through the existing `spawnEditorProcess`. That path already handles Windows `.cmd` shims without `shell: true` (lane Q7).
    - Other targets open the file.
    - The temp stage files are removed when the operation ends: on abort, on continue, or at the next status that shows no operation.
- Verified contracts and entry points: `editor-launcher-detection.ts:218-228, 342-356, 550-568`; `off-thread-process-spawner.ts:160-177`; `EditorRpcHandlers` (`editor-rpc.handlers.ts:50-79`, lane Q7); manifest `editorLauncher` capability `manifest.ts:185-190`.
- Dependencies: Components 3, 13, 22 and 25; platform-core `IEditorLauncher` gains optional `openMergeTool?`, implemented in `ElectronEditorLauncher`.
- Failure behaviour:
  - Abort or continue failure: the sanitized error in the banner; the banner stays until git reports no operation.
  - Launcher failure: the existing editor-launch error status line (parity §2).
- Quality requirements: the Windows `.cmd` path is proven in the OS-matrix job (Component 9 adds `editor-merge.real.spec.ts` with a fake `code.cmd` shim that records argv).
- Verification seam:
  - `conflict-banner.component.spec.ts`: states for Requirements 11.1-11.6.
  - `git-info.service.operation-actions.real-git.spec.ts`: abort and continue for each kind.
  - `electron-editor-launcher.spec.ts`: merge args.
  - `editor-merge.real.spec.ts` on Windows, macOS and Linux.
- Files:
  - CREATE `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/conflict/conflict-banner.component.ts` (+ spec)
  - MODIFY `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.operation-actions.real-git.spec.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/git-workflow-rpc.handlers.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/editor-rpc.handlers.ts` (+ spec)
  - MODIFY `D:/projects/ptah-extension/libs/backend/platform-core/src/interfaces/` (the `IEditorLauncher` file — locate with `grep "interface IEditorLauncher"`)
  - MODIFY `D:/projects/ptah-extension/libs/backend/platform-core/src/utils/editor-launcher-detection.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-editor-launcher.ts` (+ spec)
  - CREATE `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/editor-merge.real.spec.ts`
  - MODIFY shared: `rpc-git.types.ts`, `rpc-misc.types.ts` (editor types), `rpc.types.ts`

#### 33. History timeline (Requirement 12)

- Purpose: show the task branch's own commits and the stashes.
- Responsibilities:
  - **`HistoryTimelineComponent`**:
    - a Stashes section (list, apply, pop, and drop with confirmation, per-file stash diff routed to the canvas; parity §5 keep);
    - "Commits since <base>", newest first: short hash, subject, author, relative time;
    - selecting a commit calls `ReviewNavigationService.openHistorical(sha)`, which uses `git:reviewChanges { base: '<sha>^', head: '<sha>' }` read-only. A root commit shows "Initial commit — open in editor" instead;
    - the empty state "No commits yet on this branch.";
    - on the base branch itself, "Recent commits" (last 50).
  - **Backend `git:log`** (`GitWorkflowRpcHandlers` → `GitHistoryReader`):
    - resolves the base: `git symbolic-ref --short refs/remotes/origin/HEAD`, else local `main`, else `master`;
    - then `git log --format=%H%x00%h%x00%s%x00%an%x00%ct%x00 -z --max-count=200 --end-of-options <base>..HEAD`;
    - returns `{ base: string | null, commits: GitLogEntry[] }`.
- Verified contracts and entry points: `git:reviewChanges` (`rpc-git.types.ts:30-57`; reader `git-review-reader.service.ts:291`); stash RPCs `rpc-git.types.ts:493-538`.
- Dependencies: Components 10, 24 and 26.
- Failure behaviour: base unresolved → "Recent commits". Log failure → error row with Retry.
- Verification seam:
  - `git-history.reader.real-git.spec.ts`: a branch with 3 commits over main; no own commits; detached HEAD; `origin/HEAD` absent.
  - `history-timeline.component.spec.ts`.
- Files:
  - CREATE `D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/history/history-timeline.component.ts` (+ spec)
  - CREATE `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-history.reader.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-history.reader.real-git.spec.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ts` (`getLog` delegate)
  - MODIFY `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/git-workflow-rpc.handlers.ts`
  - MODIFY shared: `rpc-git.types.ts`, `rpc.types.ts`

---

## Integration architecture

- **Data flow.**
  1. **Mutation (every host).**
     - UI calls `rpcCall('git:*', params, gitRpcTimeoutFor(...))`.
     - `GitRpcHandlers` or `GitWorkflowRpcHandlers` validate with zod (`git-rpc.schema.ts` pattern) and call `resolveRoot`.
     - `GitInfoService` method → `GitRepoWriteLock.run` → `execWrite` (index.lock retry) → exec-git (gate, timeout, signal).
     - The result carries git's outcome and code. The UI shows it and calls `git:info`.
  2. **Status push (Electron).**
     - A git dir change reaches the `IWorkspaceWatcher` batch, then `classifyGitDirChange` and `scheduleGitOpsRefresh`.
     - `refreshGitInfo` → `computeGitInfo` (`-z` parse, operation read) produces `git:status-update {causes, files, operation, statusUnavailable}`.
     - That push reaches `GitStatusService`, `GitBranchesService`, `ReviewDiffService` (scoped refresh) and `ChangeSetStore` (reconcile).
  3. **Turn change set (all hosts with a webview).**
     - UserPromptSubmit → baseline.
     - Stop hook → `SdkAdapterEvents.onTurnEnded` → after-snapshot → diff → `TurnChangeSetStore.save` + `git:turnChangeSet` push.
     - `ChangeSetStore` → the deferred card.
     - On session open: `git:turnChangeSets` then one reconcile `git:info`.
  4. **Card actions.**
     - VS Code: `command:execute` → `ptah.review.*` → `vscode.changes` or `vscode.diff` with `ptah-git-head:` left sides; or `git.openMergeEditor`; or `workbench.view.scm`.
     - Electron: dock reveal → dynamic `git-ui` → `ReviewNavigationService`.
  5. **Hunk accept or reject.**
     - `ReviewDiffService.apply` → `git:applyHunks {hunkIndices from the Pierre ordinal = git ordinal, snapshotToken}` → locked ladder.
     - On success, re-read. On refusal, show the reason and re-read.
  6. **Comments and conflict "Ask agent".** git-ui → `AGENT_FEEDBACK_SENDER` (core port) → chat implementation → `ChatStore.sendOrQueueMessage`.
- **State or persistence.**
  - Change sets: `ptah.turnChangeSets:<sessionId>` in workspace state storage, at most 100 per session. The store owns them for the session's lifetime.
  - Draft comments: in memory, app-session lifetime (Requirement 6.7).
  - Viewed marks: webview state `gitReview.viewed.v1` (unchanged).
  - Layout: `diff.renderSideBySide` and `editorLauncher.lastTarget` through settings (unchanged).
  - Recorder baselines: in memory per live session, deleted at turn end.
  - Operation registry: in memory, deleted on settle.
  - PR status cache: in memory, 60 s.
- **External boundaries.**
  - Every new RPC validates params with zod at the handler, following the `git-rpc.schema.ts` pattern.
  - Every `workspaceRoot` goes through `resolveRoot`. Every path is contained by `isPathWithinRoots` or `FileLinkRootPolicy`.
  - Every user ref goes through `assertSafeRef` and `--end-of-options`.
  - Every spawn uses argv arrays, never a shell. `gh` gets a non-interactive env.
  - The VS Code commands validate their `args` themselves, because `command:execute` passes them through untyped.
  - No raw stderr reaches the UI except hook output. That exception is user-requested.
- **Failure and rollback.**
  - The locked `applyHunks` keeps its restore ladder.
  - A commit timeout or cancel removes only an `index.lock` that our own killed child held.
  - Stash-and-switch pops the stash when the switch fails.
  - An atomic save keeps the original when the rename fails.
  - A watcher subscription failure degrades to explicit refreshes.
  - Recorder failures produce no card, never a wrong card.
  - A Pierre mapping mismatch makes the file read-only.
- **Observability.**
  - `Logger.warn` once per workspace for parser skips, subscription failures, lock recoveries (with path under the gitdir only), recorder skips and PR-reader non-quiet errors.
  - The `verify-eager-bundle` output (gz sizes) is recorded per P3 and P4 PR in the task folder (`bundle-measurements.md`).
  - TTI: the `startup-tti.spec.ts` second-boot figure is recorded before P3 (base) and after P4 in `bundle-measurements.md`.

---

## Architecture-level quality requirements

- **Functional.** Every acceptance criterion in Requirements 1-13 maps to at least one named spec in the Test strategy table below. P1 is releasable alone.
- **Performance.**
  - Eager `main.js` gzip ≤ base commit. Removing the git-ui components is expected to shrink it by about 41 KB gz (research Q1).
  - `initial` budget: warning at 2.5 MB, error at 3.5 MB (`project.json:57-62`), must still pass the error limit. The warning is pre-existing (`research-report.md` evidence row 3).
  - Pierre lazy cost ≤ 217 KB gz for a first realistic diff.
  - At most one extra git spawn per status refresh.
  - Two status reads per agent turn.
  - At most one `gh` call per minute.
  - The canvas passes the Requirement 6.2 fixture thresholds in Component 24.
  - TTI no worse than base on the same machine.
- **Security.** No new non-`ptah.` command in the allowlist. Every path and root contained. Refs guarded. The write RPC gated behind a new Electron-only capability. Fixed-sentence errors. No `eval` in shipped chunks (A2).
- **Maintainability.**
  - `git-info.service.ts` does not grow in net lines. New logic goes into `services/git/*` collaborators, which are not exported from the vscode-core barrel. That barrel is already at 169 lines, over the §3 limit; this task adds no lines to it.
  - New shared types go in the existing rpc type files, or in one new `rpc-change-set.types.ts`.
  - The git-ui barrel stays ≤150 lines.
  - git-ui never imports chat, enforced by review and a lint `no-restricted-imports` addition if the team-leader chooses.
  - Barrel export style `[project-rule: CONVENTIONS.md §3]`.
- **Testability.**
  - Every RC has a real-git or behavioural spec.
  - Every parity `keep`/`move` row has a successor test before deletion.
  - Axe finds no critical or serious violations in dark and light for the review shell, canvas, spot editor, composer, task view, banner, history and the change-set card.

### Test strategy per requirement

| Requirement               | Spec(s)                                                                                                                                             | Level              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1.1 RC1 mutations         | `source-control-panel.component.spec.ts` (P1), `changed-file-tree.component.spec.ts` (P4)                                                           | unit               |
| 1.2 RC1 commit hook       | `git-info.service.hooks.real-git.spec.ts`; e2e `commit-hook-failure.spec.ts`                                                                        | real-git + e2e     |
| 1.3 RC2 timeouts and lock | `git-info.service.hooks.real-git.spec.ts` (60 s, slow; abort leaves no lock); `exec-git.spec.ts`                                                    | real-git           |
| 1.4 RC3                   | `git-info.service.status-unavailable.spec.ts`; `git-status.service.spec.ts`                                                                         | unit               |
| 1.5-1.6 RC4               | `git-status-parser.spec.ts`; `git-info.service.paths.real-git.spec.ts`                                                                              | unit + real-git    |
| 1.7 RC5                   | `git-dir-change-classifier.spec.ts`; `git-watcher.real-git.spec.ts` (OS matrix); e2e `git-watcher.spec.ts` unchanged                                | real-git × 3 OS    |
| 1.8 RC6                   | `git-write-lock.spec.ts`; `git-info.service.write-lock.real-git.spec.ts`                                                                            | unit + real-git    |
| 1.9 RC7                   | `git-info.service.diff-config.real-git.spec.ts`                                                                                                     | real-git           |
| 1.10 RC8                  | `git-branches.service.spec.ts` (timeout args); e2e fetch against a slow local remote (a `file://` remote with a `pre-receive` sleep of 35 s)        | unit + e2e         |
| 2.1 RC9                   | `git-info.service.switch.real-git.spec.ts`; `branch-picker-dropdown.component.spec.ts`                                                              | real-git + unit    |
| 2.2 RC10                  | `git-info.service.worktrees.real-git.spec.ts`; `worktree-hook-handler.spec.ts`; `git.utils.spec.ts`                                                 | real-git           |
| 2.3 RC11                  | `diff-tabs.service.spec.ts` (P2), `review-diff.service.spec.ts` (P4)                                                                                | unit               |
| 2.4 RC12                  | `git-info.service.operation.real-git.spec.ts`                                                                                                       | real-git           |
| 2.5 RC13                  | container smoke specs (VS Code, CLI)                                                                                                                | unit               |
| 2.6 RC14                  | `git-ref-guard.spec.ts`; `git-info.service.ref-guard.real-git.spec.ts`                                                                              | real-git           |
| 3.1                       | routing specs + `verify-eager-bundle`                                                                                                               | build              |
| 3.2                       | `research-report.md` (done) + lazy-size check in `bundle-measurements.md`                                                                           | build              |
| 3.3                       | `pierre-hunk-mapping.real-git.spec.ts`; `pierre-diff-host.component.spec.ts`                                                                        | real-git           |
| 4.x                       | `turn-change-set-recorder.service.spec.ts`, `change-set.store.spec.ts`, `change-set-card.component.spec.ts`; e2e `change-set-card.spec.ts`          | unit + e2e         |
| 5.x                       | `review-commands.spec.ts`, `ptah-git-head-content-provider.spec.ts`, allowlist spec; VS Code e2e scenario; VSIX listing check                       | unit + e2e         |
| 6.x                       | canvas unit specs; e2e successors + `review-canvas-large.spec.ts`, `review-comments.spec.ts`; axe                                                   | unit + e2e         |
| 7.x                       | `spot-editor.component.spec.ts`, `file-edit-rpc.handlers.spec.ts`; e2e `spot-editor-save.spec.ts`, `agent-file-links.spec.ts`                       | unit + e2e         |
| 8.x                       | `packaged-deps.spec.ts`, `lazy-diff-view.component.spec.ts`, build output check                                                                     | unit + build       |
| 9.x                       | `commit-message-generator.service.spec.ts`, `git-workflow-rpc.handlers.spec.ts`, `commit-composer.component.spec.ts`; e2e `commit-composer.spec.ts` | unit + e2e         |
| 10.x                      | `github-pr-status.reader.spec.ts`, `task-worktree-view.component.spec.ts`                                                                           | unit               |
| 11.x                      | `conflict-banner.component.spec.ts`, `git-info.service.operation-actions.real-git.spec.ts`, `editor-merge.real.spec.ts` (OS matrix)                 | unit + real × 3 OS |
| 12.x                      | `git-history.reader.real-git.spec.ts`, `history-timeline.component.spec.ts`, `git-stash.service.spec.ts`                                            | real-git + unit    |
| 13                        | `parity-tests.md` matrix                                                                                                                            | gate               |
| NFR a11y                  | axe (dark + light) in the e2e of each surface; `git-confirm-dialog.a11y.spec.ts`; `status-badge-contrast.spec.ts`                                   | e2e + unit         |

### Bundle and TTI verification steps

1. Before P3: on the base commit, run `NX_DAEMON=false npx nx build ptah-extension-webview --configuration=production --skip-nx-cache`, then `node apps/ptah-extension-webview/scripts/assert-eager-bundle.mjs --report-only`. Record the `main.js` gzip and closure gzip in `bundle-measurements.md`. Run `apps/ptah-electron-e2e/src/specs/perf/startup-tti.spec.ts` twice and record the second boot.
2. After Component 16: `verify-eager-bundle` passes, and `main.js` gz ≤ step 1.
3. After Component 17: record Pierre's lazy chunk sizes. First realistic diff ≤ 217 KB gz.
4. After Component 28: no `assets/monaco` in `dist/apps/ptah-extension-webview`. `electron-only-chunks.json` is present. The VSIX listing has no `@codemirror` chunk. `packaged-deps.spec.ts` passes.
5. End of P4: TTI rerun on the same machine; the second boot must be no worse than step 1.

---

## Risks

| Risk                                                                                                           | Likelihood | Impact | Mitigation in this plan                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1: Pierre slot or separator internals differ at `diffs-v1.5.1`, or change on a later bump.                    | MEDIUM     | HIGH   | Exact pin. A1 check. The adapter owns the slot logic in one file. The mapping spec and the one-host-per-hunk spec gate any version bump.                                            |
| R2: Pierre needs `eval` under CSP (A2).                                                                        | LOW        | HIGH   | Checked in the first renderer batch. Documented fallback `@codemirror/merge` (Requirement 3.2) before any canvas batch starts.                                                      |
| R3: The watcher rewrite regresses Windows.                                                                     | MEDIUM     | HIGH   | Same engine the workspace feed already uses on Windows. The existing e2e is unchanged. OS-matrix real-git job.                                                                      |
| R4: The write lock deadlocks.                                                                                  | LOW        | HIGH   | Non-reentrant with `AsyncLocalStorage` detection (loud error). Rule: locked bodies call only private helpers. Two-parallel-apply spec.                                              |
| R5: Lock recovery deletes another process's `index.lock`.                                                      | LOW        | HIGH   | Only for commit, only when the lock existed at kill time with the same ino and mtime after our tree exited. Recovery is logged.                                                     |
| R6: Hook-timeout calls enter the gate's background lane (`exec-git.ts:578-582`) and wait behind watcher reads. | MEDIUM     | LOW    | The lane is fairness only. If a commit waits more than 1 s to start under load in the real-git spec, add an explicit `lane` option to `ExecGitOptions`. This is not built up front. |
| R7: The card-to-turn join misplaces cards on replay (A7).                                                      | MEDIUM     | MEDIUM | A fallback join rule. An e2e reopen test.                                                                                                                                           |
| R8: The per-turn baseline runs in the wrong directory for worktree sessions (A6).                              | MEDIUM     | MEDIUM | Checked in the recorder batch, with a `workingDirectory` fallback.                                                                                                                  |
| R9: `gh` output drifts.                                                                                        | LOW        | LOW    | Defensive parsing. Unknown maps to `error`, shown quietly.                                                                                                                          |
| R10: Monaco removal drops a capability.                                                                        | MEDIUM     | MEDIUM | Component 29's matrix gate.                                                                                                                                                         |
| R11: `/services` narrow entry trips the Nx lazy-load lint.                                                     | LOW        | LOW    | Add it to `checkDynamicDependenciesExceptions` with a comment (existing practice).                                                                                                  |
| R12: The VSIX chunk filter wrongly drops a shared chunk.                                                       | LOW        | HIGH   | Only chunks whose every input is under the listed Electron-only paths are dropped. A VS Code e2e smoke opens the skills diff drawer.                                                |

---

## Team-leader handoff

- **Recommended executors.**
  - backend-developer: Components 1-5, 8, 10-14, 19, 30 (backend half), 31 (reader), 32 (backend), 33 (reader). Node, git and tsyringe work in vscode-core, rpc-handlers and agent-sdk.
  - backend-developer: Components 6 and 12 (watcher half). Electron main-process service.
  - frontend-developer: Components 7, 15-18, 20, 22-27, 29, 30-33 (UI halves). Angular in git-ui, chat, chat-ui, ui and core.
  - backend-developer: Component 21. VS Code extension-host code.
  - devops-engineer: Components 9 and 28 (package.json, project.json, packaging scripts, CI job). Also the `verify-eager-bundle` target wiring in Component 16.
  - senior-tester: the real-git and e2e specs where the component owner does not write them, the axe runs, `parity-tests.md` and `bundle-measurements.md`.
- **Complexity: HIGH.** 33 components across 12 projects, two hosts, a renderer swap and a watcher rewrite. P1 alone is MEDIUM.
- **Dependencies and ordering** (component level only).
  - P1:
    - Component 1 comes before Components 2-8.
    - Component 2 comes before 3; Component 3 comes before 5; Component 4 comes before 5.
    - Component 5 comes before 7 (types only; can start on the Component 1 types), 8 and 9.
    - Component 6 is independent of Components 3-5.
  - P2 starts after the P1 PR merges:
    - Component 10 comes before 11, 12, 31 and 33.
    - Component 4 comes before 13.
    - Components 14 and 15 are independent.
  - P3:
    - Component 16 is independent (first frontend item).
    - Component 17 needs A1 and A2 resolved before Component 24.
    - Component 18 comes before 20 and 24.
    - Component 19 comes before 20.
    - Component 21 is independent (backend track).
  - P4:
    - Component 25 comes before Components 24, 27, 31 and 32.
    - Component 22 comes before the comment work in 24 and before 32.
    - Component 23 comes before 24.
    - Components 24 and 27 come before 28 and 29.
    - Component 29 is last in P4.
  - P5: needs P4's shell (Component 23) and P2's Components 12 and 13. Components 30-33 are mutually independent except for shared `git-workflow-rpc.handlers.ts`, which serializes their backend halves (below).
- **Parallel-safe work.**
  - P1: Component 6 (ptah-electron) runs in parallel with Components 2-5 (vscode-core).
  - P1: Component 7 (git-ui) can start once Component 1 lands.
  - P3: backend track (19, 21) runs in parallel with frontend track (16, 17, 18). Component 20 waits for 19's shared types only.
  - P4: Component 27's backend half (`file-edit-rpc.*`, capabilities and manifest) runs in parallel with Components 23-25.
  - P5: the frontend components (30-33 UI) are file-disjoint. Their backend halves all touch `git-workflow-rpc.handlers.ts`, `git-info.service.ts` and `rpc-git.types.ts`, so they must be serialized or batched together.
  - **Serialization hot spots:**
    - `git-info.service.ts` (Components 5, 10-13, 19, 21, 30-33)
    - `rpc-git.types.ts`, `rpc.types.ts`
    - `manifest.ts`
    - `app.config.ts` (16, 20, 22, 28)
    - `package.json` (17, 27, 28)
- **Files affected** (grouped; exact paths are in each component above).
  - CREATE:
    - vscode-core: `services/git/{git-write-lock, git-status-parser, git-ref-guard, agent-worktree-admin, git-repo-operation.reader, git-operation.registry, github-pr-status.reader, git-history.reader}.ts` (+ specs), and the eight real-git spec files.
    - ptah-electron: `git-dir-change-classifier.ts` (+ spec), `git-watcher.real-git.spec.ts`.
    - shared: `constants/git-operation.constants.ts`, `types/rpc/rpc-change-set.types.ts`.
    - rpc-handlers: `chat/change-set/*`, `handlers/{git-change-set-rpc, git-workflow-rpc, file-edit-rpc}.handlers.ts` (+ schemas and specs).
    - agent-sdk: `commit-message/*`.
    - VS Code app: `commands/{review-commands, ptah-git-head-content-provider}.ts`.
    - git-ui:
      - entry points `src/services.ts`, `src/diff-renderer.ts`
      - `lib/renderer/*`, `lib/review-shell/*`, `lib/review-canvas/*`
      - `lib/services/{review-diff, review-navigation, review-comment-draft}`
      - `lib/shared/git-confirm-dialog*`, `lib/spot-editor/*`, `lib/commit/*`, `lib/task/*`, `lib/conflict/*`, `lib/history/*`
    - ui: `native/file-status-badge/*`.
    - chat-ui: `molecules/change-set/*`.
    - chat: `services/change-set/*`, `services/agent-feedback/*`.
    - core: `tokens/agent-feedback-sender.token.ts`.
    - platform-electron: `editor-merge.real.spec.ts`.
    - webview app: `scripts/assert-eager-bundle.mjs`, `status-badge-contrast.spec.ts`.
    - e2e: the new specs listed, and `support/axe.ts`.
    - task folder: `parity-tests.md`, `bundle-measurements.md`.
  - MODIFY:
    - `exec-git.ts`, `git-info.service.ts`, `git-review-reader.service.ts`
    - `git-rpc.handlers.ts`, `editor-rpc.handlers.ts`, `file-view-rpc.handlers.ts`, `register-shared-rpc-handlers.ts`, `manifest.ts`, `capabilities.ts`, `handlers/index.ts`
    - `worktree-hook-handler.ts`, agent-sdk `tokens.ts`/`register.ts`/`index.ts`
    - `git.utils.ts`, `rpc-git.types.ts`, `rpc-misc.types.ts`, `rpc.types.ts`, `message-constants.ts`, `payload-map.ts`
    - `git-watcher.service.ts`
    - `phase-3-handlers.ts`, `cli-engine/container.ts`, VS Code `package.json`, `ptah-extension.ts`/`post-init.ts`
    - `IEditorLauncher` interface, `editor-launcher-detection.ts`, `electron-editor-launcher.ts`, `rpc-host-profile.ts`
    - existing git-ui services and components kept through P1/P2
    - `electron-shell.component.ts`, `file-link-router.service.ts`, `workspace-coordinator.service.ts`, `chat-transcript.component.{html,ts}`
    - barrels of chat, chat-ui, core, ui native
    - `lazy-diff-view.component.ts`
    - `app.config.ts`, webview `project.json`, `styles.css`, the two routing specs
    - `tsconfig.base.json`, `eslint.config.mjs` (conditional), root `package.json`
    - `.vscodeignore`, `packaged-deps.spec.ts`, `prune-dist-deps.js`, `copy-renderer.js`, `scripts/copy-webview.js`
    - `.github/workflows/ci.yml`
  - REWRITE: `libs/frontend/git-ui/src/index.ts`.
  - DELETE (P4, after the parity gate): the git-ui files listed in Component 29.
- **Verification points.**
  - Confirm the assumptions A1-A12 in the batch named in their table before building on them.
  - The manifest invariant spec (union equals `RPC_METHOD_NAMES`, disjoint) after every RPC addition.
  - `nx run-many -t typecheck,test,lint -p <changed projects>`, scoped per batch `[project-rule: agent-lanes §6]`.
  - Real-git specs on all three OSes before the P1 PR merges (Component 9).
  - `verify-eager-bundle` and the `bundle-measurements.md` rows at P3 and P4.
  - Axe dark and light per new surface.
  - Visual-reviewer screenshots against `prototype/` in dark and light before each UI PR merges `[project-rule: agent-lanes §6 UI code]`.
  - `parity-tests.md` complete before the Component 29 deletion batch.
  - The `command:execute` allowlist unchanged, by diff.
  - Batches are file-disjoint, with ≤6 files and ≤2 libs each `[user-requested: orchestrator brief]`. The serialization hot spots above constrain the order.

## Lane-introduced constraints

These rules are introduced by this plan (tag `lane-proposed`). They are not user requests and not existing project rules. They need Gate 2 approval.

| Constraint                                                                                | Where              | Rationale                                                                                             |
| ----------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| Hook-running git commands get a 10 min timeout; renderer timeouts are backend + 15 s.     | Components 1, 5, 7 | Requirement 1.3 names 60 s hooks. 10 min covers slow CI-style pre-push hooks and bounds a stuck hook. |
| index.lock retry of 5 attempts, 3.1 s total.                                              | Components 1, 3    | Review finding 2 asked for a concrete, testable profile.                                              |
| Diff side limit of 2 MiB.                                                                 | Component 13       | Matches `FILE_VIEW_MAX_BYTES`, one renderer-input rule.                                               |
| Write-lock scope: whole operation; push, fetch and worktree ops excluded; non-reentrant.  | Component 3        | Orchestrator item 2. Avoids 5 min network calls blocking staging.                                     |
| Change sets capped at 500 files per turn and 100 turns per session; separate storage key. | Component 19       | Follows the "nothing unbounded in the blob" rule.                                                     |
| Status badge as a neutral chip with a hue accent, instead of per-theme solid overrides.   | Component 18       | 34 themes (Correction 2). See Clarifications.                                                         |
| git-ui may depend on `@ptah-extension/ui`. The barrel doc comment is corrected.           | Components 18, 23  | Reuse `NativeTabGroupComponent`; the doc comment was already stale (markdown import).                 |
| `fileEditor` capability, Electron-only write RPC.                                         | Component 27       | Least privilege. The viewer handler stays read-only.                                                  |
| Pierre lazy-size tolerance +15% over the research figure.                                 | Component 17       | Gives the bundle re-measurement a pass/fail line.                                                     |
| Canvas scroll thresholds (≥50 fps, no >200 ms long task) on the Requirement 6.2 fixture.  | Component 24       | Makes "responsive" in Requirement 6.2 measurable.                                                     |
| Commit-message generation rides the active provider, with no new setting.                 | Component 30       | Simplest fit for the curator pattern. See Clarifications.                                             |

## Clarifications Needed

The plan proceeds with the recommended defaults. Changing either default changes only the named component.

1. **Status-badge treatment (design-spec §13a, orchestrator item 4).** The webview offers 34 themes, and the design's hex overrides were measured for two.
   - (Recommended) Neutral chip: `base-content` letter on `base-300`, with a coloured 2 px accent. It passes AA in every theme by construction. Its look differs slightly from the prototype's solid coloured badges.
   - Solid coloured badges with the design's per-theme overrides for `anubis` and `anubis-light` only. The other 32 themes keep today's failing pairs.
   - Solid coloured badges with overrides measured for all 34 themes, gated by a new contrast spec. This takes about one extra batch.
2. **Commit-message provider (Requirement 9).**
   - (Recommended) Ride the active provider through `IProviderAuthResolver.resolve('')`, with the curator's auth-fallback and quota-stop rules. No new setting.
   - Add a `ptah.git.commitMessageProvider` setting like `memory.curatorProvider`, with fallback to the active provider. This adds one setting and a settings-UI row.
