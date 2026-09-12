# Requirements - TASK_2026_426

## Context

Ptah mirrors plugin-supplied skills, agents and commands into a user layer at
`~/.ptah/user`, and `HarnessReconcilerService` copies that layer out to each AI
tool's harness directory at every application start
(`apps/ptah-electron/src/activation/boot-heavy-services.ts:261`). The workspace
copies are manifest-owned output: when the on-disk hash differs from the
recorded output hash, the reconciler rewrites the file and only reports the
overwrite (`libs/backend/harness-sync/src/lib/targets/workspace-target.ts:525-530`).
Source wins; there is no reverse sync. The user layer is therefore the only
place an edit survives.

When upstream moves and the clone has been modified, the clone sidecar records
`diverged: true` with a `pendingSourceHash`, and `UserLayerMirrorService`
fast-forwards only an unmodified clone. The clone then never advances until a
human resolves it. The Skills tab already offers per-clone resolution in the
detail drawer — "Rebase to upstream"
(`libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-detail-drawer.component.ts:185`),
"Keep mine" (`:203`) and "Revert to this" snapshot
(`:316`) — backed by `UserLayerMirrorService.rebaseClone`
(`libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts:473`)
and `keepClone` (`:484`). Two things are missing. Resolution is one clone at a
time with no way to see how many are diverged: `visibleClones`
(`skill-clones-view.component.ts:341`) filters by kind only, and `CloneSummary`
already carries the `diverged` flag
(`libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts:16`) that nothing on the
list surfaces. And the clone body is render-only — the drawer passes it to
`ptah-markdown-block` (`clone-detail-drawer.component.ts:246`) from a
`body = input<string | null>()` (`:366`), with no editor and no RPC that writes
a user-supplied body.

The observed consequence, measured 2026-09-12: 15 agent clones under
`~/.ptah/user/agents/ptah-extension-f3f2fa6ea9b593a6/` and the `orchestration`
skill clone are stuck diverged, so every application start reverts
`.codex/agents/*.toml` and `.claude/skills/orchestration/**` in the workspace to
stale content. The harness health row does tell the user something happened —
"N local edits replaced from the source"
(`libs/frontend/marketplace/src/lib/harness/harness-target-row.component.ts:124-130`)
— but the text is inert and names no destination. The user's stated intent is to
manage this from the app instead of hand-editing files under `~/.ptah/user`.

## Classification

- Type: FEATURE
- Estimate: M — two capabilities across an existing Angular surface
  (`skill-synthesis-ui`), one existing badge component in `marketplace`, one new
  RPC method plus its handler, and a new write path through the already
  path-guarded user-layer file ops. No new lib, no new port, no schema
  migration.
- Priority: not defined here — the repository defines no priority scale.

## Scope

In scope:

- A bulk "Rebase all diverged" action on the Skills tab clones list that resolves
  every diverged, non-orphaned clone in the active kind in one user gesture.
- A diverged filter and a diverged count rendered on the clones list.
- A navigation from the harness health "N local edits" text into the Skills tab
  clones view.
- A markdown editor for the clone body in the clone detail drawer, with explicit
  save and cancel.
- One new `skillSynthesis:*` RPC method that persists a user-supplied clone body
  into `~/.ptah/user`, registered in both required places (see NFR
  "Compatibility").

Out of scope:

- A diff preview shown before a rebase is applied — offered at Checkpoint 0 and
  declined. The existing `lazy-diff-view.component.ts` stays reserved for the
  history-snapshot and enhancement-preview flows it serves today.
- VS Code host parity for `skillSynthesis:*` — offered and declined.
  `SkillsSynthesisRpcHandlers` stays in
  `apps/ptah-extension-vscode/src/di/expected-absent.ts:38`, so both capabilities
  are Electron-only and must degrade visibly rather than throw in the VS Code
  webview.
- Any reverse sync from a workspace harness copy back into the user layer. The
  workspace copy remains manifest-owned output of `HarnessReconcilerService`.
- Changing how divergence is detected, how `pendingSourceHash` is computed, or
  the reconciler's source-wins rule. This task consumes those, it does not alter
  them.
- Editing a plugin source under `~/.ptah/plugins` — already refused by
  `user-layer-fs-ops.ts:56-61` and it stays refused.

## Requirements

### 1. Bulk divergence resolution

Requirement: A user with many diverged clones — the state that causes the
repeated workspace reverts — resolves all of them in one action instead of
opening each drawer, so the next reconcile stops rewriting stale content.

Acceptance criteria:

1. When at least one clone in the current kind is diverged and not orphaned, the
   clones list shall render a bulk rebase control; when none is, the control
   shall be absent or disabled with a stated reason.
2. When the user triggers the bulk rebase and confirms, the system shall invoke
   the same rebase path used by the per-clone action
   (`skills-synthesis-rpc.handlers.ts:1229` → `UserLayerMirrorService.rebaseClone`)
   once per eligible clone, and shall not invent a second rebase implementation.
3. When the user triggers the bulk rebase, the system shall require an explicit
   confirmation that names the number of clones affected and states that local
   edits in those clones will be replaced by upstream, before any write occurs.
4. When one clone in the batch fails, the system shall continue with the
   remainder and report a per-clone outcome; the batch shall not abort on the
   first failure, and the failed slug shall be named in the reported result.
5. When the batch completes, every clone it succeeded on shall report
   `diverged: false` on the next `skillSynthesis:listClones` response, and the
   diverged count shall drop accordingly without a manual page reload.
6. When a clone is orphaned (`CloneSummary.orphaned`), it shall be excluded from
   the batch, because rebase has no upstream to target.
7. When the bulk action is in flight, controls that would start a second
   conflicting write on the same clones shall be disabled.

### 2. Seeing and reaching diverged clones

Requirement: The user sees how many clones need attention, narrows the list to
them, and arrives at that list from the place the problem is reported.

Acceptance criteria:

1. When the clones list renders, it shall display the count of diverged clones
   for the current kind, derived from `CloneSummary.diverged`.
2. When the user activates the diverged filter, the list shall show only clones
   with `diverged: true`; when the user clears it, the full list for the kind
   shall return.
3. When the diverged filter is active and the set becomes empty after a
   successful rebase, the list shall render an empty state rather than a blank
   region.
4. When the harness health row reports one or more overwritten local edits
   (`harness-target-row.component.ts:124-130`), that report shall be an
   activatable control, keyboard-reachable, with an accessible name that states
   where it leads.
5. When the user activates that control, the application shall open the Thoth
   `'thoth'` view with the Skills tab selected — via the existing
   `AppStateManager.setThothActiveTab('skills')`
   (`libs/frontend/core/src/lib/services/app-state.service.ts:589`) — and the
   clones list shall arrive with the diverged filter already applied.
6. When the host is VS Code, where `skillSynthesis:*` is absent, the control
   shall not present a destination that cannot be reached.

### 3. Editing a clone body in the app

Requirement: The user edits the body of a user-layer clone inside the drawer and
saves it, so the edit lands in `~/.ptah/user` — the only location the reconciler
treats as source — without opening a file manager.

Acceptance criteria:

1. When a clone is selected and its body has loaded, the drawer shall offer an
   edit affordance that replaces the read-only render with an editable text area
   seeded with the current body.
2. When the user saves, the system shall call a single new `skillSynthesis:*` RPC
   with the slug, kind and full body, and the body shall be written to that
   clone's file under `~/.ptah/user`.
3. When the user cancels, no write shall occur and the rendered body shall be
   unchanged.
4. When the save succeeds, the drawer shall re-read the clone detail and render
   the saved body, and the reported `historyCount` shall have increased by one.
5. When the RPC receives a slug, kind or body that fails validation, it shall
   reject with an invalid-params error and perform no write. Validation shall
   reject at minimum: a slug containing a path separator or `..`; a kind outside
   the known `SkillCloneKind` set; a body that is not a string.
6. When the resolved target path is not inside `~/.ptah/user`, or is inside
   `~/.ptah/plugins`, the write shall be refused by
   `UserLayerFsOps.assertUnderUserLayer` (`user-layer-fs-ops.ts:48-63`) and the
   refusal shall surface as an error rather than a silent no-op.
7. When the named clone does not exist in the user layer, the RPC shall reject
   and shall not create a new file at that path.
8. When the write succeeds, the clone's sidecar bookkeeping shall leave the clone
   in a state the next reconcile does not revert: the saved body shall still be
   present in `~/.ptah/user` after a subsequent `HarnessReconcilerService` run.
9. When the host is VS Code, the edit affordance shall not be offered.

## Non-functional requirements

- Security: the new write RPC is a new trust boundary — it is the first
  `skillSynthesis:*` method that accepts arbitrary user-supplied file content
  and a target identifier and turns them into a filesystem write. Its parameters
  shall be validated with a Zod schema at the handler boundary before any path
  is constructed, per the repository's boundary-validation rule. The existing
  `assertUnderUserLayer` guard shall remain the last line of defence, not the
  first: a slug shall never be joined into a path before it has been validated.
  The handler shall not return a raw filesystem error string to the webview.
- Data safety: any write that replaces existing clone content — the bulk rebase
  and the body save — shall take a `.history/<ts>/` snapshot first, using the
  existing snapshot helpers (`user-layer-fs-ops.ts:231`, `:242`), so the
  drawer's "Revert to this" action can recover the prior content. A destructive
  write with no preceding snapshot is a defect.
- Concurrency: a body save and a rebase shall not interleave on the same clone.
  Both shall run under the existing per-slug lock (`withSlugLock`,
  `user-layer-mirror.service.ts:473`). A save issued while a boot-time
  reconcile is running shall either complete under that lock or fail with a
  stated reason — it shall not produce a partially written clone file.
- Compatibility: the new RPC method shall be registered in BOTH
  `libs/shared/src/lib/types/rpc/rpc.types.ts` and the runtime allowlist. The
  `skillSynthesis:` prefix is already present in `ALLOWED_METHOD_PREFIXES`
  (`libs/backend/vscode-core/src/messaging/rpc-handler.ts:81`), so no new prefix
  is required — but the per-method entry in the shared types map is. The VS Code
  host shall continue to activate with `SkillsSynthesisRpcHandlers` absent.
- Accessibility: the diverged filter, the bulk rebase control and the harness
  deep link shall be keyboard-operable and carry accessible names; the bulk
  confirmation shall be reachable and dismissible by keyboard.
- Maintainability: `skill-clones-view.component.ts` is 585 lines and
  `clone-detail-drawer.component.ts` is 437. The soft ceiling is 700 lines. If
  either crosses it, the split shall follow the repository's facade rule
  (extract a nameable collaborator, keep the public component's selector and
  inputs) rather than producing helper fragments.

## Stakeholders

| Stakeholder                  | What they need from this change                                            | How they will judge it                                                                   |
| ---------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Ptah user with stuck clones  | To clear all diverged clones without opening `~/.ptah/user` in an editor    | Workspace `.codex/agents/*.toml` and `.claude/skills/**` stop reverting at every app start |
| Ptah user tuning a skill     | To change a skill or agent body where it survives the next reconcile        | An in-app edit is still present after restarting the app                                   |
| Reviewer of this task        | Criteria checkable without asking the author what was meant                 | Each criterion maps to an observable UI behaviour or a file on disk                        |
| VS Code extension user       | Not to be shown controls that cannot work in their host                     | No broken action and no activation crash in the VS Code webview                             |

## Risks

| Risk                                                                                              | Likelihood | Impact | Mitigation                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bulk rebase discards real user work across many clones at once, with no diff preview in scope       | HIGH       | HIGH   | Confirmation naming the affected count and the replacement consequence (R1.3), plus a mandatory `.history` snapshot per clone before overwrite. Owner: executor |
| An in-app body edit is silently overwritten by the next boot-time reconcile                        | MEDIUM     | HIGH   | R3.8 states the post-reconcile persistence criterion explicitly; senior-tester exercises a save followed by a reconcile run. Owner: senior-tester               |
| Sidecar hash bookkeeping after a body write is wrong, re-marking the clone diverged permanently     | MEDIUM     | HIGH   | Architect specifies which sidecar fields the write path updates; a test asserts `diverged` and `pendingSourceHash` after save + reconcile. Owner: architect     |
| A crafted slug escapes `~/.ptah/user` before the path guard runs                                   | LOW        | HIGH   | Zod validation at the handler boundary before any `join`, plus the existing `assertUnderUserLayer` as the second gate (NFR Security). Owner: backend executor  |
| A body save races the boot-time reconcile and leaves a half-written clone file                     | LOW        | MEDIUM | Route the write through the existing `withSlugLock`; fail with a stated reason rather than writing outside the lock. Owner: architect                           |
| Bulk rebase over many clones blocks the UI with no progress or partial-failure reporting            | MEDIUM     | MEDIUM | R1.4 and R1.7 require per-clone outcomes and disabled conflicting controls during the batch. Owner: frontend executor                                           |

## Open questions

- Should the bulk rebase act on the currently visible kind only, or on every kind
  at once? The list is kind-tabbed (`skill-clones-view.component.ts:315`), and
  these criteria assume the current kind. The architect may widen it if the
  confirmation still names an accurate count.
- Does a saved body need to clear `diverged` (treat the save as an implicit
  "keep mine"), or leave the divergence flag as it was? This decides whether the
  write path reuses `keepClone`'s sidecar update
  (`user-layer-mirror.service.ts:484`). Answerable by the architect from the
  sidecar contract; it does not block starting.
- Whether the deep link should also select a specific clone when the harness
  report names one file, or only apply the filter. The criteria require only the
  filter.

## Handoff

- Next specialist: software-architect
- Why: the shape is the open question — where the new write RPC sits relative to
  `writeEnhancedSkill` and `keepClone`, what sidecar state a user save leaves
  behind, and how the bulk action composes the existing per-clone rebase without
  duplicating it.
