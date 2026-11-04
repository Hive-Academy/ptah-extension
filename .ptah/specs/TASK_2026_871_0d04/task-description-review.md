Verdict: APPROVED

Review of `task-description.md` and `parity-inventory.md`. No Blocking or Serious findings. Minor corrections are listed for the next revision.

## Findings

1. Minor - `parity-inventory.md:15` (row "Single-task status change"). The backing RPC is listed as `tasks:updateStatus`. The lib never calls it. `TasksStore.updateStatus` goes through `tasks:updateMetadata` (`libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts:1523` comment; `palette-entries.ts:219`). The contract type `tasks:updateStatus` exists (`libs/shared/src/lib/types/rpc.types.ts:2635`) but the frontend has no call site. Fix the row to say `tasks:updateMetadata` followed by `tasks:board`.
2. Minor - `parity-inventory.md:24` (row "Start via chat prefill"). The backing list omits `autocomplete:commands`. `task-prompt-context.service.ts:166` calls it to build the prompt context. Add it to the row.
3. Minor - `task-description.md:13` and `:70`. The citation `task-start.service.ts:32` points at the class doc header. The "no status write" rule is at `task-start.service.ts:45`, and the chat prefill call is at `:120`. Cite `:45`.
4. Minor - `task-description.md:11`. The claim "uses marked/DOMPurify" cites `markdown-block.component.ts:16`. That line is a doc comment that says ngx-markdown. The sanitizer is wired in `provide-markdown-rendering.ts` (`DOMPurify` imported at line 3, and `SANITIZE`). Cite the wiring line rather than the comment. The claim itself is correct.
5. Minor - `task-description.md:21`. The new read for extra files and `prototype/` states no file-size cap, symlink/junction handling, or extension allowlist. The risk is mentioned at `:58-59` and the validation requirement at `:21`, but acceptance criterion 3 has no testable "path outside the task folder, or symlink escape, is rejected" case. Add one negative criterion. This also covers the scope risk below.
6. Minor - `task-description.md:46` (acceptance criterion 6). It does not say what Tasks shows when `cliVersionLabel` returns `''`. The helper returns an empty string for a process dump (`cli-matrix-rows.ts:327-330`). Without a rule, the sentence could render "Run through codex ." Specify a fallback, such as the existing no-version text at `task-agent-discovery.service.ts:76`.
7. Minor - `task-description.md:47` (acceptance criterion 7). Phase-1 and phase-2 behaviour share one criterion. Split it so Phase 1 can be accepted and closed without TASK_2026_358 outcomes. The phase-2 clauses are acceptable only as requirements-only, as D4 says.

## Coverage of the user request

- Poor styling and app design language: criterion 1 and the Phase 1 scope bullet 1. Evidence is the chat shell tokens at `app-shell.component.html:117`. Criterion 1 is partly subjective ("readable controls"). The `parity-inventory` and visual review gate it adequately, so I do not rate it above Minor.
- Disconnected from spec folders: criteria 2 and 3. Backed by the evidence that artifacts list all entries (`task-index.service.ts:587`) while `getArtifact` is closed to `DocFile` (`task-spec.contract.ts:93`, `rpc.types.ts:2626`).
- Markdown rendering: criterion 4 plus the theme-aware prose requirement. The "Tasks selects no variant" claim is true (`task-detail.component.ts` has no `variant` binding).
- TASK_2026_606_b6b7: criterion 6 and the scope bullet on moving `cliVersionLabel`. Verified that today the Tasks discovery service uses the raw `cli.version` (`task-agent-discovery.service.ts:74`).
- TASK_2026_358 as phase 2 (D4): in scope as requirements, out of scope for phase 1 implementation. The run-surface reservation is covered in criterion 7.

## Parity inventory check

The inventory covers every RPC and surface the lib uses. The set found in code is: `tasks:board`, `get`, `getArtifact`, `create`, `updateMetadata`, `bulkUpdateStatus`, `bulkUpdateLabel`, `getViews`, `saveViews`, `reindex`, `generateRegistry`, `sweepFinished`, `tasks:changed`, `session:listForTasks`, `agent:detectClis`, `autocomplete:agents` and `autocomplete:commands`. The only gaps are items 1 and 2 above.

Remove-proposed rows: none, and `## Proposed Removals` states "None". No user approval is needed.

## Citation spot-check

Eighteen citations from `task-description.md` and eight inventory rows were checked.

task-description.md:
- `tasks-view.component.ts:119`, `:165`, `:565`: OK (shell, layout `join`, `ptah-task-board`).
- `app-shell.component.html:117`: OK (`bg-surface-1 border-surface-border`).
- `cli-matrix-styles.ts:14`: OK.
- `task-detail.component.ts:601`, `:609`, `:460`, `:630`: OK.
- `task-presentation.ts:379` (`WORKFLOW_ARTIFACTS` from `DOC_FILES`): OK.
- `task-spec.contract.ts:93`: OK (doc block of the `DocFile` area).
- `task-index.service.ts:587` (`listArtifacts`): OK. `:362` (`getArtifact` doc): OK.
- `rpc.types.ts:2626` (`tasks:getArtifact`) and `:2624` (list entry): OK.
- `markdown-block.component.ts:51` (`variant 'invert' | 'auto'`): OK.
- `update-dialog.component.ts:57`: OK.
- `cli-matrix-rows.ts:327`: OK.
- `task-agent-discovery.service.ts:74`: OK.
- `markdown-block.component.ts:16` and `provide-markdown-rendering.ts:11`: line exists but is a comment (item 4).
- `task-start.service.ts:32`: header only (item 3).

parity-inventory.md:
- Rows 7, 9, 10, 13, 20, 21, 22, 24, 27, 28, 30: the cited lines hold the expected symbols. Examples are `task-board.component.ts:178` (`onKeyDown`), `keyboard-target.ts:31` (`TEXT_ENTRY_SELECTOR`), `tasks-store.service.ts:1255` (`readDocument`), `:1361` (artifact guard), `:1312` (sweep RPC), `tasks-changed-feed.service.ts:31`, `task-bulk-bar.component.ts:305` (`selectAllMatching`), `task-session-links.service.ts:219`, `task-command-palette.component.ts:101`.
- Row 15: wrong backing RPC (item 1).
- Row 24: omitted RPC (item 2).
- Row 30 cites `tasks-store.service.ts:2360` for the board refresh. The call is at `:1085` (`tasks:board`). `:2360` is another area. I confirmed `:1086` is the `surfaceOpen` / `tasks:changed` region, so the row is close, but `:2360` is a board-fetch call whose purpose I did not confirm. Treat as unverified.

## Lane-introduced constraints

Requirement-level rules that the user did not state, tagged by origin:

- Both light and dark themes plus narrow-width Electron layouts (scope bullet 1, criterion 1): lane-proposed. The user asked for the app design language. Light/dark is implied by the existing theme system, so it is reasonable.
- "No untrusted content uses unsanitized `[innerHTML]`" and the URL-scheme allowlist (criterion 4, NFR): project-rule and security-aligned. The shared renderer already sanitizes. Treat as a guard, not new scope.
- Reuse of shared marked + DOMPurify (NFR, Decisions): project-rule, because it is the existing renderer.
- Keyboard and screen-reader usability and confirmation flows (criterion 8): lane-proposed. It is an accessibility floor tied to the parity inventory's keyboard capabilities.
- Public-index-only cross-library imports and signal/OnPush Angular style (NFR): project-rule.
- "Strict TypeScript, typed validated RPC boundaries" (NFR): project-rule.
- Start stays a chat-prefill with no automatic status write (out of scope): project-rule. `task-start.service.ts:45` forbids restoring it.
- Run-panel placeholder with no working controls in phase 1 (criterion 7): user-requested (D4).
- Phase 2 content-hash cache key and "dispatch order must not affect it" (scope, criterion 7): user-requested via TASK_2026_358, which the user asked to include. These are inherited from the task carrier, not invented.
- Extra files such as `decisions.md` and `prototype/` shown in the folder view (scope, criterion 2): user-requested ("disconnected from the actual spec folders"). A new RPC is the lane's proposed mechanism and is arguably design. It is flagged below.
- "Directories are navigable or openable as folders" (criterion 3): lane-proposed. The existing code has no directory handling, so this is a new capability.

## Scope risks

- A new RPC for extra files is the largest scope risk. It must stay path-constrained. Require the task id to match `TASK_YYYY_NNN_xxxx`, a file name allowlist or `prototype/`-relative path normalization, rejection of `..`, absolute paths, symlinks and junctions, a size cap, and binary detection. The description requires validation (`:21`) but gives no testable negative cases (item 5).
- `prototype/` listing can expose arbitrary nested files. Keep it to listing and open-in-editor only. Do not read content inline unless the file type is allowlisted.
- Phase 2 is requirements-only text, but its size (XL) can pull persistence work into the Phase 1 PR. The out-of-scope list already blocks this. Keep the Phase 1 acceptance gate separate (item 7).
- The inventory test column refers to existing spec files. The revamp will change most template structure, so snapshots or selectors in those specs will need updates. This does not change scope but needs planning.
