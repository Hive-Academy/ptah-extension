Verdict: REVISE

Reviewed `implementation-plan.md` against the worktree code. The architecture is sound: a separate bounded RPC, `DocFile` kept closed, the shared util for `cliVersionLabel`, and a typed `entries` listing. Three issues would break or stall implementation, so the verdict is REVISE.

## Findings

1. **Serious. The containment design needs filesystem operations the injected port does not have.**
   - B1 (plan lines 17-19) requires `lstat`, `realpath`, a bounded read of at most 1 MiB+1 bytes, an opened-handle identity recheck and a `finally` close.
   - `TaskIndexService` reaches the disk only through `IFileSystemProvider` (`task-index.service.ts:135`, `:253`, `:371`).
   - That interface exposes only `readFile`, `readFileBytes`, `readDirectory`, `stat` and `exists` (`libs/backend/platform-core/src/interfaces/file-system-provider.interface.ts:22-74`).
   - Electron's `stat` calls `fs.stat`, which follows links (`libs/backend/platform-electron/src/implementations/electron-file-system-provider.ts:66-79`). A symlink or junction therefore reads as `File` or `Directory`, and no `lstat` or `realpath` exists.
   - `FileType.SymbolicLink` exists (`libs/backend/platform-core/src/types/*.ts:30-35`), but `stat` can never return it.
   - `readFile` is unbounded, so the 1 MiB cap can only be enforced after the whole file is read.
   - Fix: the plan must pick one route and name its files.
     - (a) Extend the port with `lstat`, `realpath` and a bounded read. This needs the `platform-core` interface, the shared contract suite in `libs/backend/platform-core/src/testing/contracts/`, the Electron adapter and every other adapter or mock. It also pulls in `platform-electron`, `platform-cli` and `cli-engine` verification.
     - (b) Add a small new port to `task-specs` for a safe bounded read, with an Electron adapter binding. `task-specs` is otherwise host-neutral: it imports only `path`, `tsyringe` and `vscode-core`.
     - Whichever is chosen, add the DI binding and update `expected-resolvable.ts`.
     - The plan currently says "No new DI binding is needed" (line 13). That is wrong for either route.
   - The real-filesystem junction tests in the Risks section need a fixture strategy. Windows junction creation needs no elevation, but symlink creation can.

2. **Serious. The new RPC contradicts AC 3a on how rejection is reported.**
   - AC 3a (task-description.md:46) requires the rejection to be "an explicit state".
   - The plan's Zod rule (line 15) is the regex `/^[a-z0-9][a-z0-9._-]*\.md$/` plus explicit rejections of `.`/`..`, separators, absolute paths, NUL and decoded traversal. An invalid shape returns `INVALID_PARAMS`.
   - Traversal, absolute, UNC and `..` inputs would therefore become a thrown RPC error and never reach the `rejected` state.
   - The UI would also have to cope with a thrown error instead of a state for any real folder entry whose name has uppercase letters, spaces or a non-`.md` extension.
   - Fix: let the schema accept a bounded string (min 1, max 255). Let the service classify and return `rejected` for bad name, extension or traversal, and `directory`, `missing` and the other states. Keep `INVALID_PARAMS` only for a missing or non-string field or an invalid `taskId`.
   - Also state how the client decides which entries get the Read action. Mirror the allowlist in a shared pure predicate so the UI and backend cannot drift.

3. **Serious. B1 omits registry and baseline files that a new RPC method touches.**
   - `tasks:getArtifact` is registered in more places than the plan lists:
     - `libs/shared/src/lib/types/rpc.types.ts:2626` (method type) and `:3817` (method-name map)
     - `libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts:347`, whose header says "Any change to this baseline requires a Gate 2 exception in TASK_2026_610"
     - `libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts` (the guard that reads the baseline)
     - `apps/ptah-electron/src/replay/scenario-sanitizer.ts:294` (read-only method allowlist)
   - The plan names `rpc.types.ts` but not the `:3817` map, the baseline, its contract spec or the sanitizer.
   - Fix: name each file and state whether the baseline gains `tasks:readFolderMarkdown`, which needs the Gate 2 exception, or is regenerated via `scripts/generate-host-source-registry-baseline.ts`. Decide whether the method belongs in the sanitizer's read-only list.
   - The `tasks:` prefix is already in `ALLOWED_METHOD_PREFIXES` (`libs/backend/vscode-core/src/messaging/rpc-handler.ts:91`), so no prefix change is needed. Say so.
   - `rpc-surface.spec.ts` has no per-method `tasks:` assertion. It derives the surface and compares counts (`:79-80`). The instruction to "change only explicit assertions" is correct. State that it is likely a no-edit file with a run-only check.

4. **Moderate. Stale VS Code references.**
   - The plan says to update the "VS Code equivalent" of `rpc-surface.spec.ts` and to verify `ptah-extension-vscode` (lines 13, 45).
   - `apps/` has no VS Code app: only `ptah-docs`, `ptah-electron`, `ptah-electron-e2e`, `ptah-extension-webview` and the landing page projects.
   - `npm run verify -- -p ptah-extension-vscode` would fail on an unknown project.
   - Fix: remove those references. Add `ptah-electron-e2e` only if its tasks specs change. `apps/ptah-electron-e2e/src/specs/tasks/tasks-list-visual.spec.ts` uses `tasks:getArtifact`. Do not run e2e without a user request.

5. **Moderate. Directory open and "Open folder" are unverified.**
   - B3 says the folder action "uses host capability where available, otherwise explicit unavailable state". design-spec.md:56 requires `prototype/` to be an expandable listing or an Open folder action.
   - The plan never verifies that `FILE_LINK_OPENER` can open a directory. The existing `openArtifact` only builds `root/.ptah/specs/<folder>/<file>` (`tasks-store.service.ts:1360-1380`).
   - AC 3 requires directories to be "navigable or openable".
   - Fix: either verify what `FILE_LINK_OPENER` does for a directory path (cite it), or choose the in-UI expandable listing. A listing needs another typed RPC, or `entries` with child names, and the plan does not cover that. Choose one and record it.

6. **Moderate. Batch coupling and ordering are underspecified.**
   - B4 owns `tasks-view.component.ts`. B5 owns the detail component, which `tasks-view.component.ts` hosts and binds inputs to. A detail input or output change in B5 forces edits in B4's file.
   - Fix: add a rule that B5 does not change the detail selector or public API used by `tasks-view`. Alternatively, make B5 depend on B4, or list the single integration touchpoint explicitly.
   - "B4 depends on B2" has no stated reason. B2 touches discovery and chat only. Remove it or justify it. If B4's card/Start work consumes discovery, say so.
   - B3 edits `tasks-store.service.ts` (2,575 lines). B4's parity rows (single status, bulk, sweep, reindex, excluded states) also list this file as the home, without modifying it. Make explicit that B4 must not edit the store. Otherwise it collides with B3.
   - B2 touches `libs/shared/src/index.ts` and B1 touches shared types, but no file overlaps (B1 lists `rpc.types.ts`, `task-spec.types.ts` and `rpc-tasks.types.ts`). If B1 also adds a shared allowlist predicate (finding 2), keep it out of `index.ts` or assign it to B1.
   - Per-batch scoped verify commands are missing. They sit only in a global list. Add them per batch, for example B1 verifies `shared`, `task-specs`, `rpc-handlers`, `ptah-electron`. Name the jest files each batch must pass.

7. **Moderate. The dependency from `rpc-handlers` to `task-specs`.**
   - The plan changes `task-specs` to return typed states. The handler must map them without leaking absolute paths or raw errors.
   - `readArtifact` today swallows all errors to `null` (`task-index.service.ts:371-383`).
   - Hardening it so it "preserves the missing `{file,content:null}` contract" is fine. But `readArtifact` has no state to distinguish unreadable from missing, and the plan does not say what a link, oversize or binary file returns on that path.
   - Fix: specify it. A suggested route is to collapse to `content:null` plus a logged warning.

8. **Minor. `cliVersionLabel` boundaries are correct but need two additions.**
   - Verified:
     - `shared` has tags `scope:shared,type:util` (`libs/shared/project.json:6`).
     - `chat` has `scope:webview,type:feature` (`libs/frontend/chat/project.json:7`).
     - `tasks-ui` has `scope:webview,type:feature,platform:angular` (`libs/frontend/tasks-ui/project.json:7`).
     - `markdown` has `scope:shared,type:ui` (`libs/frontend/markdown/project.json:7`), so tasks-ui already imports a shared-scope lib.
     - `tasks-ui` does not import `@ptah-extension/chat`, so there is no cycle.
   - A feature importing a util is fine, and moving the helper to `shared` is correct. The plan's tag claim at line 19 is accurate.
   - Gap: the plan says "move `isCliProcessDump` if required". It is exported at `cli-matrix-rows.ts:315` and used at `:342` and `:408`. Decide it now: move it with `cliVersionLabel` and re-import in chat. Do not duplicate it.
   - Gap: the empty-label branch needs an exact test. `task-agent-discovery.service.ts:75-76` falls back when the version is falsy. Normalization must happen before that check, so an empty label never reaches the template `Run through codex .`.
   - Check that `libs/shared/src/index.ts` exports are consistent with `libs/shared/src/index.zod-free.spec.ts`.

9. **Minor. Phase 2 seam is clean.**
   - The outline is prose only, with no Phase 2 code, RPC or types in Phase 1. The placeholder has no controls and its input contract is `selectedTaskId` and `workspaceRoot`. This meets AC 7.
   - Consider removing the exact Phase 2 RPC names (`tasks:runs:*`) from a Phase 1 plan. They look like a commitment but are only an outline.

10. **Minor. The markdown requirements are met.**
    - `variant='auto'` exists (`markdown-block.component.ts:51-58`). The plan binds it for the carrier and the document reader, and retains marked/DOMPurify.
    - It includes a "no unsanitized `[innerHTML]`" test and a safe-scheme link test. No gap.
    - One addition: the theme-aware variant is only "binding" tested in Jest. The light-theme contrast risk relies on the manual Electron screenshots, which the plan acknowledges. Fine.

## Parity check

All 24 inventory rows (the plan's mapping table also lists 24 capabilities) map to a Phase-1 file and a Jest spec. There are no silent removals and "Proposed Removals: None" is carried through.

- The plan folds in the `task-description-review.md` corrections: row 15 uses `tasks:updateMetadata`, and Start also calls `autocomplete:commands`.
- Row 30 (disk-change feed) points at `tasks-changed-feed.service.ts`, which is not in any batch's edit list. That is fine as it is "keep", but confirm `tasks:changed` also invalidates the new folder store state (B3 should name it).
- Row 24 (Start via chat prefill) maps to `task-card.component.ts`, in B4. The spec files for `task-start.service` and `task-prompt-context.service` are named as proof but never edited, which is fine.

## Lane-introduced constraints

Constraints not traceable to the user request, task-description.md, the approved design spec or the project rules:

- **Reject all symlinks and junctions, including in-folder links** (Decisions table, last row). AC 3a requires rejecting links that resolve outside the folder; design-spec.md:56 says "symlink/junction escape". Rejecting benign in-folder links is stricter and is the lane's choice. It is defensible and reversible, but the plan presents it as following AC 3a. Flag it for the user or relabel it as a lane decision.
- **Direct-child lowercase `.md` only, 1 MiB cap.** design-spec.md:117 records this as `[lane-proposed]` and the approved spec adopted it. Uppercase `README.md` or `.markdown` files read as rejected. Acceptable, but record it as a decision.
- **Bounded read of 1 MiB+1 bytes, fatal UTF-8 decode and NUL means binary.** This is an implementation detail with no source in the requirements. Acceptable under AC 3a "binary state", but it adds new exported behavior to `readArtifact` (finding 7).
- **Hardening of existing `readArtifact` and `task.md` reads.** Not in the requirements ("extend contracts only for file types `getArtifact` cannot read"). It is scope growth into a working read path. Keep only if it is cheap, or drop it and note the residual risk.
- **`TaskSpecDetail.entries` with kind `file|directory|symlink|other`.** A new contract field. It is justified by AC 2 (actual file and directory states) but the plan should say it is the minimal shape.
- **Fixed pixel layout values** (220px lanes, 58px rail, 242px, 248px/268px, 290px max-height). They come from the approved design spec revision log, per the plan's Decisions row, so they are traceable. Not a lane invention.
- **Phase 2 RPC names `tasks:runs:*` and reuse-key description.** Not required by Phase 1, and stated as an outline only. Fine, but nothing in Phase 1 may implement it.

## Citation spot-check (13)

| # | Citation | Result |
| --- | --- | --- |
| 1 | `libs/shared/project.json:7` tags `scope:shared,type:util` | Tag is on line 6; content correct. |
| 2 | `libs/frontend/chat/project.json:7` tags `scope:webview,type:feature` | Correct. |
| 3 | `libs/frontend/tasks-ui/project.json:7` tags | Correct (also `platform:angular`). |
| 4 | `cli-matrix-rows.ts:307-333` `VERSION_TOKEN`, `isCliProcessDump`, `cliVersionLabel` | Correct (`:307`, `:315`, `:327`). |
| 5 | `task-agent-discovery.service.ts:74-76` | Correct. `:75` is the version branch, `:76` the fallback text. |
| 6 | `task-spec.contract.ts:93-131` `DOC_FILES` | Content correct, but the array starts at `:120` and `DocFile` is `:142`. Range is slightly off. |
| 7 | `tasks-rpc.schema.ts:85-89` getArtifact params closed over `DOC_FILES` | Correct. |
| 8 | `rpc-tasks.types.ts:75-88` result type | Correct (the comment starts near `:80`). |
| 9 | `tasks-rpc.handlers.ts:671-691` getArtifact handler | Correct (`:673`, `:687`). |
| 10 | `task-index.service.ts:587-594` `listArtifacts` loses type | Correct. |
| 11 | `markdown-block.component.ts:51-58` `variant` input | Correct. |
| 12 | `tasks-store.service.ts:1254-1281` | `getArtifact` call area; consistent with the store (`:1255` per parity). |
| 13 | `task-start.service.ts:45,120` | Not opened; cited from the task-description.md (`:32`, `:120`). Unverified by me. |

## Re-review (round 1)

Verdict: REVISE

One remaining Serious item (a missed implementer of the extended port). Everything else from round 0 is fixed. The fix is one file plus one verify target.

### Per-finding status

| # | Round-0 finding | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Serious: port lacks containment operations | PARTIAL | The plan now extends `IFileSystemProvider` (B1) with `lstat`, `realpath` and `readFileBoundedNoFollow`. It names the interface, mock, shared contract suite, self spec, and the Electron and CLI adapters and specs. Both existing bindings are cited (`platform-electron/src/registration.ts:113-115`, `platform-cli/src/registration.ts:67-69`), so there is no new token. `Glob libs/backend` confirms there is no `platform-vscode` project, so the "no VS Code adapter" claim holds. The plan no longer claims `task-specs` uses Node `fs` directly. Windows junction: `fs.lstat().isSymbolicLink()` is true for junctions, and the plan rejects all links plus the `path.relative` check on `realpath`. The TOCTOU handling (handle identity and size recheck "where supported", rejecting a changed target, and a real-filesystem junction test) is acceptable. **Gap (new Serious):** `libs/backend/lane-routing/src/lib/matrix/capability-matrix.store.spec.ts:52` declares `class MemoryFiles implements IFileSystemProvider`. Making the three methods required breaks that spec's typecheck. The file is not in B1's file list and `@ptah-extension/lane-routing` is not in B1's verify list. Fix: either add the file to B1 and add lane-routing to the verify list, or declare the new methods in a way that does not break existing implementers. A grep of `implements IFileSystemProvider` and `: IFileSystemProvider = {` finds only this one extra implementer. |
| 2 | Serious: AC 3a rejection lost at Zod boundary | FIXED | Zod validates shape only (`file: string 1..255`, taskId, workspaceRoot). Traversal, separators, absolute, drive, UNC, NUL, encoded and uppercase names, and non-md names classify to `state:'rejected'` in the service. The plan says "A normal rejection must reach the UI as a state, never as a thrown RPC validation error". The shared predicate is also used by the UI. `listFolderEntries` has a `rejected` state too. |
| 3 | Serious: RPC registry omissions | FIXED | Grep of the worktree for `tasks:getArtifact` (excluding `.ptah`) finds: `task-spec.contract.ts` (comment), `host-source-registry.baseline.ts`, `rpc.types.ts`, `tasks-store.service.ts`, `task-detail.component.ts` (comment), `task-index.service.ts` (comment), `tasks-rpc.schema.ts`, `tasks-rpc.handlers.ts`, `tasks-rpc.handlers.spec.ts`, `scenario-sanitizer.ts`, and the e2e spec `tasks-list-visual.spec.ts`. The plan's "RPC registration census" lists every one. B1 owns the functional edits (both `rpc.types.ts` sites, schema, handler METHODS and registration, scenario sanitizer and spec). B3 owns the store. The baseline is inspected only, with a stated reason, and the e2e mock is conditional. `tasks:` prefix already allowed, so no prefix edit. |
| 4 | Moderate: stale VS Code references | FIXED | Removed per the revision log. The verify list uses real projects only (platform-core, platform-electron, platform-cli, shared, task-specs, rpc-handlers, cli-engine, ptah-electron). |
| 5 | Moderate: unverified directory open | FIXED | `tasks:listFolderEntries` is added with bounds (depth 4, 200 entries, `too_many` state), symlink rejection and sanitizer registration. It cites `file-link-router.service.ts:105-127`. |
| 6 | Moderate: batch coupling and order | FIXED | B1 owns shared types and the predicate. B2 alone owns `libs/shared/src/index.ts` and exports the predicate after B1. B3 alone owns the store. B4 owns the shell and `tasks-view`. B5 owns detail and does not edit `tasks-view`. Dependencies are stated (B3 after B1/B2, B4 after B2, B5 after B1/B3). The write sets are disjoint or ordered. |
| 7 | Moderate: existing `readArtifact` states | FIXED | Hardening of `readArtifact` and `task.md` is dropped, with the residual risk listed. The new handler maps only the new RPC states. |
| 8 | Minor: CLI helper | FIXED | `isCliProcessDump` moves with the label. The empty-label branch is exact. `index.zod-free.spec.ts` is added. |
| 9 | Minor: Phase 2 naming | FIXED | Names are marked outline only, with nothing in Phase 1. |
| 10 | Minor: markdown theme | FIXED | Shared `variant='auto'` is kept and an Electron dark/light screenshot gate is added. |

### New problems introduced by the revision

- Serious: the `MemoryFiles` implementer described in finding 1 above. No other new Blocking or Serious problems.
