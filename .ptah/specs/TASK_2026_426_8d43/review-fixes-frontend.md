# CodeRabbit review fixes — frontend lane (PR #500)

Six of the seven findings were valid against the current code and are fixed. One
(**G**) was valid in its concern but wrong in its prescribed remedy, which
contradicts a documented repository decision; it is fixed to the limit that
decision allows, and the remainder is recorded as a follow-up.

Every fix is pinned by a test that was **run against the pre-fix production
code and observed to fail**, then run again after. Evidence per finding below.

## A — `loadDetail` request token (valid, fixed)

`libs/frontend/skill-synthesis-ui/src/lib/services/skill-clones-state.service.ts`

The entry key alone cannot separate two requests for the SAME entry, and that
pair is not hypothetical: `saveCloneBody` reloads the entry it just wrote, so a
click plus a save reload are routinely in flight together. Added
`detailRequestToken` (monotonic, bumped at the start of every `loadDetail`) and
`isCurrentDetailRequest(key, token)`. A reply now writes `detail`, `error` or
`detailLoading` only while it is the outstanding request on BOTH axes.
`clearDetail` bumps the token as well, so a request abandoned by a close cannot
land on a later reopen of the same entry — which the key reset alone permitted,
because the reopen restores exactly the key the abandoned request was filed
under.

Tests (`skill-clones-state.service.spec.ts`):

- `ignores the FIRST reply when two loads of the SAME entry land in reverse order`
  — before: FAIL (`detail.body` was `'# stale'`, expected `'# new'`); after: PASS.
- `ignores a request abandoned by clearDetail even when the same entry is reopened`
  — before: FAIL; after: PASS.

## B — positive guard in `catch`, suppression comment deleted (valid, fixed)

Same file. The `catch` no longer early-returns; the handling runs inside
`if (isCurrentDetailRequest(...))` and the block falls through. The
`// degradation-audit: reported` marker was therefore **deleted** — with the
flagged pattern gone it would have been an orphaned marker, which the audit
reports as a violation in its own right. The explanatory prose was kept as a
plain comment (it explains why a superseded failure is dropped), without the
`degradation-audit:` token.

Test: `does not let a superseded same-entry FAILURE clear the current detail` —
before: FAIL; after: PASS.

Audit: `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`
→ exit 0, `libs/frontend/skill-synthesis-ui: 5 ok (baseline 5)`, no
`orphaned-suppression`.

## C — the deep-link request is now workspace-bound (valid, fixed)

`libs/frontend/core/src/lib/services/app-state.service.ts`

`_skillsDivergedRequest` changed from `signal<boolean>` to
`signal<string | null>` holding the workspace path the request was raised for.
`consumeSkillsDivergedRequest()` still clears unconditionally (one-shot
preserved) but answers `true` only when the stored path equals the active one.
The divergence the deep link points at belongs to one workspace's Library;
carried into another it would filter on something the user never saw.

Test (`app-state.service.spec.ts`):
`drops a diverged-clones request the user left behind by switching workspace` —
before: FAIL; after: PASS. The existing one-shot test still passes unchanged.

## D — second activation now reaches the child (valid, fixed)

`skill-synthesis-tab.component.ts`, `clones/skill-clones-view.component.ts`

`_clonesDivergedFilter` is a `number` token incremented per activation, and the
child input is `divergedFilterRequest = input<number>(0)` (renamed from
`divergedFilterRequested`, because "requested" reads boolean and the value is
now a token). A boolean already `true` produced no signal change, so a second
deep link while the tab stayed mounted did nothing at all.

Tests:

- `skill-synthesis-tab.component.spec.ts` →
  `re-applies the diverged filter on a SECOND deep link while still mounted`
  (clears the filter by hand without leaving the Library, then re-activates).
- `skill-clones-view.component.spec.ts` →
  `re-applies the filter on a SECOND deep link after the user cleared it`.

Both before: FAIL (verified against a boolean-equivalent saturating token);
after: PASS.

## E — `actionsLocked` includes `loading()` (valid, fixed)

`clones/skill-clones-view.component.ts`. A clone-list refresh replaces every
row, so a write started mid-refresh was authorised against rows that may
already be gone — including the eligibility the bulk confirmation counted.
`loading()` is now the first term. The refresh button's
`[disabled]="loading() || actionsLocked()"` became redundant and is now just
`actionsLocked()`.

Test: `locks the bulk controls while the clone list is still being read` (holds
the initial `refreshClones` pending) — before: FAIL on the bulk control; after:
PASS.

## F — `openSkillsDivergedClones()` respects `canSwitchViews()` (valid, fixed)

`app-state.service.ts`. Guarded at the top. Previously the view switch was
dropped while loading or disconnected but the request survived, so the filter
fired later against whatever surface the user reached next.

Test: `raises no diverged-clones request while view switches are blocked` —
before: FAIL; after: PASS.

## G — modal lifecycle (concern valid, prescribed remedy declined)

`clones/bulk-rebase-confirm.component.ts` (+ new spec)

**The concern is real**: this is a destructive-batch confirmation and it had no
dismissal path other than the Cancel button, no initial focus and no focus
restoration.

**The prescribed remedy is not available here.** `showModal()` is rejected for
Electron dialogs in this repository on purpose — `update-dialog.component.ts`
states it: the top layer competes with the native file-ops dialogs the Electron
e2e specs guard, and `ptah-confirmation-dialog` (the canonical destructive
confirm) is class-driven for the same reason. Every daisyUI modal in this lib
and in `libs/frontend/chat` follows that convention. jsdom 29 also implements
only `HTMLDialogElement.open` — no `showModal`, `close` or `cancel` event — so a
native-modal lifecycle here would be polyfilled in tests rather than verified.
An Angular CDK Dialog migration is not a contained change either: it would
either introduce a second modal mechanism beside the repository's, or move every
daisyUI modal at once, which is a separate task.

**What was done instead**, within the convention:

- Escape cancels (`(keydown.escape)` on the dialog).
- Backdrop click cancels (`<form method="dialog" class="modal-backdrop">`, the
  pattern already used in `skill-synthesis-tab.component.ts`).
- Focus starts on Cancel — the safe control — via `afterNextRender`, which also
  gives the Escape handler a focus target inside the dialog.
- Focus returns to the opener on destroy.
- `confirmed` and `cancelled` outputs unchanged; `busy` still locks Confirm
  alone.

New spec `bulk-rebase-confirm.component.spec.ts` (5 tests). Against the pre-fix
component: 3 failed (initial focus, Escape, backdrop), 2 passed (confirm,
focus-restore trivially); after: 5 pass.

**Follow-up recommended, not done here**: a focus TRAP, and folding the inline
reconcile modal in `skill-clones-view.component.ts` into this component. Tab can
still leave this dialog, exactly as it can leave `ptah-confirmation-dialog` and
`ptah-update-dialog`. Trapping needs one shared modal primitive that all the
repository's daisyUI modals adopt together — half-migrating this one would leave
two modal mechanisms in one view, which is worse than the current consistent
state. The component header records this.

## Files

- MODIFIED `libs/frontend/core/src/lib/services/app-state.service.ts` — C, F
- MODIFIED `libs/frontend/core/src/lib/services/app-state.service.spec.ts`
- MODIFIED `libs/frontend/skill-synthesis-ui/src/lib/services/skill-clones-state.service.ts` — A, B
- MODIFIED `libs/frontend/skill-synthesis-ui/src/lib/services/skill-clones-state.service.spec.ts`
- MODIFIED `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts` — D
- MODIFIED `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.spec.ts`
- MODIFIED `libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts` — D, E
- MODIFIED `libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.spec.ts`
- MODIFIED `libs/frontend/skill-synthesis-ui/src/lib/components/clones/bulk-rebase-confirm.component.ts` — G
- CREATED `libs/frontend/skill-synthesis-ui/src/lib/components/clones/bulk-rebase-confirm.component.spec.ts` — G

No `project.json` touched, no `nx reset`, no commit. `libs/backend/**` and
`libs/frontend/thoth-shell/**` untouched.

## Verification

- `npx nx run-many -t test -p @ptah-extension/skill-synthesis-ui @ptah-extension/core @ptah-extension/thoth-shell --skip-nx-cache`
  → `Running target test for 3 projects` (N = 3). core 668/668, thoth-shell 5/5,
  skill-synthesis-ui 428/428. `Successfully ran target test for 3 projects`.
- `npx nx run-many -t typecheck lint -p <same 3> --skip-nx-cache` → success.
  One pre-existing warning: `skill-synthesis-tab.component.ts` `max-lines`
  (1175 > 700), warn-level, present before this change.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` →
  exit 0, `libs/frontend/skill-synthesis-ui: 5 ok (baseline 5)`.
- `npx nx format:write` run over the ten touched files.
- Not applicable: no e2e run (Electron e2e needs a built app and touches
  surfaces outside this lane); no visual verification of the focus behaviour in
  a real browser — it is covered by unit assertions on `document.activeElement`.

## H — the Skills tab now honours `reconcileProtected` (backend finding C, frontend half)

`SkillSynthesisSaveCloneBodyResult.reconcileProtected` says a surface "must not
claim an unqualified success when it is `false`". The editor did exactly that:
one `Saved "<slug>".` toast for both outcomes.

**The result had to reach the surface first.**
`SkillClonesStateService.saveCloneBody` returned `Promise<void>` — it awaited the
RPC purely for its rejection and threw the result away. It now returns
`Promise<SkillSynthesisSaveCloneBodyResult>`; the detail reload still happens
before the return, so the drawer's exit from edit mode is unchanged.

**Toast tier.** The local `ClonesToast` union carried `success | error | info`
and no warning. The write DID succeed, so `error` would be a lie, and `info`
does not read as something to act on. I added a fourth member, `warning`, bound
to daisyUI's `alert-warning` beside the three bindings already there
(`alert-warning` is established in this repo — `tasks-ui`, `setup-wizard`,
`marketplace`, `memory-curator-ui`, `workspace-indexing` all use it). That is
one more tier on the existing toast, not a second notification mechanism; no
shared primitive and no token was added.

**Copy.** `reconcileProtected: true` keeps `Saved "<slug>".` byte-for-byte — the
normal path is untouched. `false` gets:

> Saved "deep-research", but a later sync may replace it — History keeps a
> snapshot you can restore.

Three facts, in that order: it was written, it is at risk, it is recoverable.
Neither "sidecar" nor "reconcileProtected" appears — the user cannot act on
either word. "History" is the drawer's own label for the snapshot list, so the
sentence names a place the user can actually reach. The recovery claim holds on
both sides of the risk: this save's own `.history/<historyTs>` snapshot exists
now, and the fast-forward branch itself calls `snapshotDirToHistory` before
copying upstream over the edit (`user-layer-mirror.service.ts:1382`), so the
user's text is snapshotted at the moment it is replaced.

The reconciler is untouched, as instructed.

**Tests** (`skill-clones-view.component.spec.ts`, +2 → 430 total):

- `reports a protected save as a plain success` — asserts the message is exactly
  `Saved "deep-research".` and the tone is `alert-success`, so the normal path
  cannot drift.
- `warns that an unprotected save may not survive the next sync` — asserts all
  three facts are present, the tone is `alert-warning` and NOT `alert-error`,
  and that `refreshClones` still ran twice (a warning, not a failure).

Both submit through the real editor (`clone-body-editor-save`) via a new
`editAndSave` helper that avoids `whenStable()`, which would wait out the
toast's own 3-second dismissal timer.

**Before / after** — with the branch neutralised in `onSaveBody` so both
outcomes take the plain-success arm, specs unchanged:

```
● SkillClonesViewComponent — body save › warns that an unprotected save may not survive the next sync
Tests: 1 failed, 44 passed, 45 total
```

After: 430/430 across the project.

`metadataIncomplete` is deliberately NOT consumed — it was outside the scope I
was given. It is still unrendered, so a save whose bookkeeping failed reports a
plain success today. That is the remaining half of backend finding B.

### Files (H)

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/frontend/skill-synthesis-ui/src/lib/services/skill-clones-state.service.ts` — `saveCloneBody` returns the write result
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts` — `warning` toast tier + the `reconcileProtected` branch in `onSaveBody`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.spec.ts` — `saveResult()` factory, `editAndSave` helper, 2 branch tests

### Verification (H)

- `npx nx run-many -t test -p @ptah-extension/skill-synthesis-ui --skip-nx-cache`
  → `Running target test for project @ptah-extension/skill-synthesis-ui`,
  27 suites / **430 tests passed** (428 before, +2).
- `npx nx run-many -t typecheck lint -p @ptah-extension/skill-synthesis-ui --skip-nx-cache`
  → `Successfully ran targets typecheck, lint`. Lint: 0 errors, the one
  pre-existing `max-lines` warning on `skill-synthesis-tab.component.ts`
  (1175 > 700), unchanged in count by this edit.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`
  → **exit 0**, `libs/frontend/skill-synthesis-ui: 5 ok (baseline 5)`, no
  orphaned suppression. No `catch` was added.
- `npx nx format:write` over the three files — no reformatting needed; tests
  re-run after it, still 430/430.
- No `project.json` edited, no `nx reset`, no commit. `libs/backend/**`,
  `libs/shared/**` and `libs/frontend/core/**` untouched by this piece.
