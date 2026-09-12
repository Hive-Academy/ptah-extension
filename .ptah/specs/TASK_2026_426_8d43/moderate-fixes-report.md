# Moderate fixes — `TASK_2026_426_8d43`

Scope: the three MODERATE findings in `code-logic-review.md` § *Moderate and
minor issues*, plus their entries under § *Failure modes*. Two were real defects
and are fixed at the root cause with red-before regression tests. The third is
**not a defect** in the dimension the review recommended fixing; the evidence is
below, and the parameter it names now earns its place a different way.

Everything is inside `libs/frontend/skill-synthesis-ui`. No backend file, no
`project.json`, no `nx reset`, no commit. `clone-bulk-rebase.service*.ts` was not
opened.

## Verdict

| # | Finding | Outcome |
| - | ------- | ------- |
| 1 | In-progress draft silently discarded | FIXED — draft seeded once, conflict stated |
| 2 | Editor offered for an orphaned clone | NOT A DEFECT — orphans are writable and user-owned; the parameter is now used for the selection condition instead |
| 3 | Empty body returns a developer-facing message | FIXED in the UI; schema untouched |

## 1. An in-progress draft is silently discarded — FIXED

**What it was.** `draft = linkedSignal(() => this.value())`
(`clone-body-editor.component.ts`) re-seeded on ANY `value()` change. The view
reloads the open entry's detail after applying an enhancement proposal
(`skill-clones-view.component.ts:571-575`), so `body()` changed under an open
editor and the typed text was replaced with no prompt. This is the same class of
loss the task exists to prevent, so it is fixed at the source of truth rather
than by suppressing the reload.

**The fix.** The editor now holds ONE value describing its whole state — the
`text` the user has, the `seed` that text came from, and the latest `incoming`
stored body — and the `linkedSignal` computation adopts an incoming body only
while the draft is still untouched (`text === seed`):

- First read: seed from `value()`. This is "seed once when edit mode opens" — the
  editor is created by `@if (editing())` in the drawer, so its first read *is*
  the moment edit mode opens.
- Untouched draft + new body: adopt it. This is the deliberate post-save reload
  the original comment described, and it is preserved.
- Typed draft + new body: keep the user's text, record `incoming`.

Because the text is kept rather than dropped, the user has to be told. A
`role="alert"` notice (`clone-body-editor-conflict`) appears when
`incoming !== seed && incoming !== text` — the stored body genuinely moved, and
to something other than what the user holds. Both halves are load-bearing:

- Without `incoming !== seed`, a user who merely emptied the textarea would be
  told the file had changed underneath them. That false positive was caught by
  the empty-draft tests, not by reasoning.
- Without `incoming !== text`, the reload following the user's OWN save (which
  arrives equal to their text) would flash a conflict on the way out of edit
  mode.

The notice states what each control now does: Save replaces the new stored body
with theirs, Cancel discards theirs and shows the new one. Both remain enabled —
the point is an informed choice, not a block.

**Regression evidence** (`clone-body-editor.component.spec.ts`, describe *draft
ownership against a background body change*, 5 tests).

Before — computation reverted to the old unconditional re-seed, nothing else
changed:

```
● draft ownership … › KEEPS the typed text when the stored body changes underneath
● draft ownership … › TELLS the user the stored body moved, and keeps Save available
● draft ownership … › emits the user’s text, not the incoming body, when they Save through it
Test Suites: 1 failed, 25 passed, 26 total
Tests:       3 failed, 412 passed, 415 total
```

The first failure is the defect verbatim: the textarea read
`# rewritten by the enhancement` where the user had typed `# my unsaved work`.
The third is its consequence — that text is what a Save would have written.

After: all 5 green, including the two that pin the behaviour the re-seed existed
for (an untouched draft still adopts a reload; the user's own save is not
reported as a conflict).

## 2. The editor offered for an orphaned clone — NOT A DEFECT

The review's recommendation was "at minimum exclude `orphaned === true`,
matching the rule `eligibleForBulkRebase` already applies". I did not do that,
because the two rules are about different things and the shared contract says so
explicitly.

`CloneSummary.orphaned` (`libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts`,
the field's own note):

> `orphaned` means "there is no longer an upstream to pick", so the Rebase
> action is meaningless and the clone is now **effectively user-owned**.

An orphan's upstream is gone; its own file in `~/.ptah/user` is present,
writable, and `skillSynthesis:saveCloneBody` accepts a write to it — the handler
refuses on the CLONE file's absence (`written: false`), never on orphanhood.
Withholding the editor there would refuse a write the backend honours, on the
entry a user is *most* likely to hand-edit, since nothing upstream will ever
reconcile it again. `eligibleForBulkRebase` excludes orphans for the opposite
reason: rebase needs an upstream that no longer exists.

The review's failure-mode entry pairs orphaned with "externally deleted", and
that is where the two part company. Nothing in `CloneSummary` reports that the
clone FILE is missing, so no client-side gate for it is possible; that case is
already refused safely by the handler, which creates nothing. The cost is a late
refusal after typing — a real but minor annoyance, not a data-safety issue, and
not fixable from the summary the list hands the UI.

**What I changed instead.** The parameter now carries the condition the view was
re-spelling: `canEditCloneBody(clone: CloneSummary | null, body)` returns
`clone !== null && body !== null`, and `canEditSelectedBody` in
`skill-clones-view.component.ts` is a straight call with no extra `c !== null`
term. One home for the rule, per the repository's stated reason for the module
existing. The deliberate orphan decision is documented on the function and
pinned by a test, so nobody "fixes" it later from the review alone.

**Evidence** (`clone-action-gating.spec.ts`, describe `canEditCloneBody`):

Before — signature reverted to `clone: CloneSummary` with the body-only body:

```
● canEditCloneBody › refuses when no entry is selected, even with a body still held
Test Suites: 1 failed, 25 passed, 26 total
Tests:       1 failed, 414 passed, 415 total
```

After: green. A second test asserts an orphaned entry with a loaded body IS
editable while `eligibleForBulkRebase` still excludes it — that one passes both
before and after by design; it records a decision rather than proving a fix, and
is labelled as such in the spec.

## 3. An empty body returned a developer-facing message — FIXED IN THE UI

**Schema untouched.** `skills-synthesis-rpc.schema.ts:417` `.min(1)` still
stands, for the reason given: an emptied clone is reconciled outward as an empty
entry into every harness directory.

**The fix.** The floor is mirrored client-side so that refusal is never reached.
The rule lives in `clone-action-gating.ts`, not in the component:

```ts
export function cloneBodyDraftRefusal(draft: string): string | null
```

It returns the reason rather than a boolean, so a caller cannot disable a control
without having the explanation to hand. Whitespace-only counts as empty —
`.min(1)` would ACCEPT `'   '`, and a clone whose whole body is three spaces is
the same mistake with a worse outcome, because it validates and publishes. That
is a small tightening beyond the schema, deliberately client-side only.

The editor renders it: Save is `[disabled]="!canSave()"`, and `onSave()`
re-checks before emitting, so a programmatic click cannot push an empty body
past the affordance.

**Accessibility.** The reason is not conveyed by the disabled state or by
colour. It renders as a `role="status"` paragraph, so its appearance is announced
when the draft becomes empty — a disabled button takes no focus, so
`aria-describedby` alone would never be read out. The button also points at it
(and at the conflict notice, when both apply) via `aria-describedby`, following
the pattern already established at
`clone-bulk-toolbar.component.ts:54-56`, `:64-72`.

**Regression evidence** (`clone-body-editor.component.spec.ts`, describe *empty
draft*, 5 tests + 3 unit tests on `cloneBodyDraftRefusal`).

Before — `canSave` reverted to `() => !this.saving()`:

```
● empty draft › disables Save on an emptied draft and states why in plain language
● empty draft › treats a whitespace-only draft as empty
● empty draft › emits NOTHING when Save is activated on an empty draft
● empty draft › never offers Save on an entry that arrived empty
Test Suites: 1 failed, 25 passed, 26 total
Tests:       4 failed, 411 passed, 415 total
```

The third failure is the defect: an empty string was emitted to the view, which
is what reached the RPC and produced
`Invalid parameters for skillSynthesis:saveCloneBody`.

After: all green. The fifth test asserts Save re-enables and the reason
disappears once text returns, so the gate is not one-way.

## Files

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-body-editor.component.ts`
  — draft seeded once and owned by the user; conflict notice; empty-draft gate
  with an announced reason; `onSave()` guard.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-action-gating.ts`
  — `canEditCloneBody` accepts and uses `clone` (null-selection condition, orphan
  decision documented); new `cloneBodyDraftRefusal` + `EMPTY_BODY_REASON`.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts`
  — `canEditSelectedBody` no longer re-spells the selection condition.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-body-editor.component.spec.ts`
  — 10 new tests (draft ownership, empty draft).
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-action-gating.spec.ts`
  — 5 new tests (null selection, orphan decision, draft refusal).

Nothing was added to `src/index.ts`: `cloneBodyDraftRefusal` has one caller
inside the library, and widening the public API for it would be gratuitous.

## Verification

All three commands run in this worktree, unscoped by file, after the final edit.

```
npx nx run-many -t test -p @ptah-extension/skill-synthesis-ui --skip-nx-cache
  Running target test for project @ptah-extension/skill-synthesis-ui:   (1 project)
  Test Suites: 26 passed, 26 total
  Tests:       418 passed, 418 total          (403 before this batch, +15)

npx nx run-many -t typecheck -p @ptah-extension/skill-synthesis-ui --skip-nx-cache
  Successfully ran target typecheck

npx nx run-many -t lint -p @ptah-extension/skill-synthesis-ui --skip-nx-cache
  ✖ 1 problem (0 errors, 1 warning) — Successfully ran target lint
```

The single lint warning is pre-existing and in a file this batch does not touch:
`skill-synthesis-tab.component.ts` `max-lines` (1175 > 700).

No e2e run: `apps/ptah-electron-e2e` needs a packaged desktop build, which is
outside this batch. The DOM contract it binds is unchanged — no existing
`data-testid` was renamed or removed; two were added
(`clone-body-editor-conflict`, `clone-body-editor-empty-reason`).

## Out-of-scope observations

- **`skill-clones-view.component.ts:233`** (card lock) untouched, per instruction.
- **`CloneBulkRebaseService.reset()`** left in place, per instruction.
- **`reapDeletedUpstream` lock** untouched — backend, pre-existing.
- **The conflict notice offers no "load the new body" action.** Cancel already
  does exactly that (leave edit mode, read-only render shows the new body), so a
  third control would be a second route to the same place. Worth a look only if
  the copy tests badly.
- **The drawer's `submittedBody` success signal compares text, not identity.** If
  a background reload happened to bring the stored body to exactly the text the
  user submitted while their save was still in flight, edit mode would close as
  if their save had landed. It writes nothing wrong and the body on disk equals
  their text either way, so it is cosmetic — but it is the one remaining place
  where "the reload matched" is read as "my write succeeded". Not touched: it
  predates this batch and is outside these three findings.
