# TASK_2026_224 — unstaged edits landing in commits

**Type:** BUGFIX
**Severity:** Medium — silently commits work the author did not stage
**Origin:** surfaced three times during `TASK_2026_200` (batches 3, 4, 5)

---

## 1. Observed behaviour

During TASK_2026_200 every commit used an explicit pathspec
(`git commit -F msg -- <paths>`) because a second session was committing to the
same branch. On three of those commits the pre-commit hook left **a staged delta
the pathspec commit did not capture** — and on one earlier occasion a
pathspec-less `git commit` swept three unrelated `TASK_2026_173` files into the
commit.

## 2. What it is NOT

Ruled out empirically before changing anything:

- **Not a formatter disagreement.** `npx nx format:check --files=<flagged files>`
  exits 0, and `npx prettier --check` reports "All matched files use Prettier
  code style". Nx's formatter and prettier 3.8.3 agree. The committed files were
  already prettier-clean.
- **Not line-ending churn.** `.gitattributes` pins `* text=auto eol=lf` with
  explicit CRLF exceptions for `*.bat` / `*.cmd` / `*.ps1`. Residual ` M` flags
  on untouched files are CRLF-only, no content delta.

## 3. Root cause — two independent mechanisms

### 3.1 `git commit -- <paths>` commits the working tree, not the index

**This is the one that actually caused the observed symptom**, and it is git
behaviour, not lint-staged's. A pathspec argument to `git commit` means
`--only`: it commits the **working-tree** content of those paths and bypasses
the index for them. It also leaves every other staged path staged, which is
exactly the "leftover staged delta" that was reported three times.

Proven directly. `.husky/pre-commit` was staged, then a marker line was appended
**without staging it**, then committed with an explicit pathspec:

```
staged version contains marker: 0
working tree contains marker:   1
→ committed version contains marker: 1     ← swept in
```

The initial hypothesis in this task was that lint-staged's `--no-stash` did this.
The probe **disproved that**: the sweep happens at `git commit` time regardless.

### 3.2 `--no-stash` is a real but separate hazard

`.husky/pre-commit` ran `npx lint-staged --no-stash --concurrent false`.
lint-staged is 16.4.0, where `--no-stash` **implies `--no-hide-partially-staged`**:
tasks run against the full working tree rather than staged-only content, and the
post-task `git add` stages whatever is on disk. That can stage unstaged edits
even without a pathspec commit.

This was not demonstrated to be the cause of the observed incidents. It is fixed
because the lint-staged docs warn against it and it is a live hazard in a repo
with concurrent writers — not because it explained the symptom.

`--concurrent false` is unrelated and retained: `.lintstagedrc.mjs` documents it
as the guard against parallel `nx` processes OOMing.

## 4. Fix

1. **Remove `--no-stash`** from `.husky/pre-commit`, restoring lint-staged's
   default (hide unstaged changes → format staged content → restore).
2. **Document the `git commit -- <paths>` semantics** at the hook, since that is
   the mechanism that actually bit and it is counter-intuitive: a pathspec commit
   is `--only` and takes working-tree content.

**Working rule for pathspec commits**: verify `git diff -- <paths>` is empty
before committing. If it is not, the unstaged edits in those paths will be
committed.

### Known trade-off on (1)

The default path stashes and restores. If another process writes those files
inside that window the restore can conflict and lint-staged aborts, recovering
from its backup stash. Real risk in multi-agent sessions — but it fails **loudly
and recoverably**, where the previous behaviour failed **silently**. If
`--no-stash` turns out to have been guarding a real stash failure (it carried no
explanatory comment), the next step is `--no-hide-partially-staged` alone,
keeping the backup stash.

## 5. Acceptance criteria

1. `--no-stash` is gone; `--concurrent false` is retained.
2. The `git commit -- <paths>` working-tree semantics are documented where a
   future committer will see them.
3. Auto-formatting on commit still works.

## 6. Note on process

The first commit of this fix (`b7ac07dce`) carries a stray
`# PROBE-UNSTAGED-MARKER-224` comment — the probe line, swept in by the very
behaviour being investigated. It is removed in the follow-up commit. Left in
history deliberately as the reproduction.
