# PR804 CodeRabbit follow-up: spot-editor reload races

- Branch: `fix/attention-coderabbit-followup` (worktree `.claude-worktrees/attention-coderabbit-followup`), base commit `7ce426499`
- Scope held: `libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.ts` and `spot-editor.component.spec.ts` only
- CodeRabbit comments: **4350386543** (post-confirmation edits lost by `reload(true)`) and **4350386562** (read held across a completed save corrupts the loaded baseline)

## Finding verification (both confirmed against current source)

### 4350386543 — confirmed

`reload(true)` runs from a confirmed Discard answer (`onDialogConfirmed`/`onDialogSecondary` → `spot-editor.component.ts:673`, `:711`). The apply-time guard was `(this.modified() || this.saving()) && !discardEdits`, so with `discardEdits === true` it never protected the buffer. The dialog closes before the read starts, the editor stays editable, and edits typed while `reader.read` awaited were overwritten by `mountDocument` (old line 828). The buffer content at apply time could not distinguish pre-confirmation edits (covered by the confirmation) from post-confirmation edits (not covered).

### 4350386562 — confirmed

`reload` captures the loaded state (`current`, baseline H0) and bumps `readSeq` once; `save` completing during the read sets the live baseline to H1 (`this.file.set({ ...current, content, sha256: result.sha256 })`, old line 764) but does not touch `readSeq`. At apply time `seq === this.readSeq` still held, and after `markSaved` cleared `modified`/`saving` the apply path ran `this.file.set(result)` with the pre-save H0 result. When the read captured the same bytes as H0, the same-sha early return then left a corrupted baseline (H0 content and hash under a clean H1 buffer), so the next save sent `expectedSha256: H0` and faulted against the H1 on disk. When the read captured other disk bytes, `mountDocument` additionally wiped the saved buffer.

## Fixes

### Fix 1 — a confirmed discard covers only the buffer as it stood at confirmation

`reload` captures `discardText = discardEdits ? this.handle?.text() : null` before the read. At apply time, a fresh result that no longer matches that text means the buffer moved after the confirmation, so `discardEdits` is demoted and the existing dirty-keep branch takes over (buffer kept, stale mark raised when the disk bytes differ, baseline untouched). A failed or blocked read keeps the discard answer, so the confirmed reload still reports its failure through the error status and Retry recovers, exactly as before.

### Fix 2 — reject a read whose captured baseline a completed save replaced

In the apply path, after the dirty-keep branch and before any state mutation: `if (this.file()?.sha256 !== current.sha256) return;`. Only `save` can change the live hash between capture and apply without bumping `readSeq` (`open` bumps it, a concurrent `reload` bumps it, a failed save leaves it alone), so the check is exact. The dropped read needs no replacement: the save's own echo push (`file:content-changed`) reloads the file, as the existing same-bytes short-circuit comment at the mount already documents.

## Decisions

| Decision | Options | Evidence | Reversibility |
| --- | --- | --- | --- |
| Detect post-confirmation edits by comparing buffer text captured at reload start with the buffer at apply time (Fix 1) | (a) text comparison in `reload`; (b) read-only lock on the editor while a confirmed reload is in flight; (c) change counter in the CodeMirror handle | (b) fights the `editable` signal/effect and the user's focus with no existing pattern; (c) edits `codemirror-setup.ts`, outside the allowed scope; (a) needs no new state, uses the verified `SpotEditorHandle.text()` API (`codemirror-setup.ts:250`), and `markSaved` provably leaves the text unchanged (`codemirror-setup.ts:253-258`) so a save during the read cannot fake a change | Single guarded block; delete it to revert |
| Demote the discard only for fresh results (Fix 1) | (a) demote for any result; (b) demote only for fresh results | A failed read never mounts, so the demotion matters only for fresh results; keeping the discard for failures preserves the existing read-error banner and Retry recovery uniformly (existing test `a failed confirmed reload leaves the editor read-only; Retry restores editing...`) | Condition is one `result.status === 'fresh'` term |
| Treat an undone post-confirmation edit as still discarded | (a) content comparison; (b) change-event counting | Content is the user-visible contract: after undo the buffer equals the state the confirmation covered, and the CodeMirror baseline comparison (`codemirror-setup.ts:220`) already defines dirtiness by content | Content equality is the demotion predicate; no event state exists |
| Reject the stale read outright, including a result that happens to carry the post-save bytes (Fix 2) | (a) reject whenever the baseline moved; (b) accept a result whose hash matches the new baseline | (b) needs a second mount/undo-history trade-off for no benefit: the save's echo push re-reads and the same-sha short-circuit keeps undo history; (a) is one deterministic line | Single guarded return |
| No stale mark when the rejected read carried different disk bytes | (a) mark stale from the dropped result; (b) mark nothing | A stale mark from a dropped read could predate the save that won; the next save's conflict check is the authoritative surface, and the echo push re-reads | Follows from the rejection decision |

## Regression tests added (`spot-editor.component.spec.ts`, held-read describe)

1. `keeps edits typed after the discard confirmation while its read is in flight` — 4350386543; also asserts the next save still sends the captured baseline hash (`expectedSha256: SHA_A`).
2. `still discards when the post-confirmation typing is undone before the read lands` — the explicit-discard boundary: content back to the confirmed state, discard stands.
3. `keeps post-confirmation edits when the confirmed read fails; Retry restores editing` — failures recover: read-error banner, read-only, Retry remounts usability with the typed buffer, stale mark and original baseline intact.
4. `drops a read whose captured baseline a completed save replaced; the next save uses the saved hash` — 4350386562; the discriminator asserts the second save carries `expectedSha256: SHA_B` (the hash the save produced), which fails on the unfixed code.
5. `keeps the saved buffer when the read held across a save answers with newer disk bytes` — 4350386562 data-loss variant: the saved buffer survives a result that would otherwise mount over it.

Red/green evidence: with both guards temporarily neutralized, exactly these three key tests failed — `drops a read whose captured baseline a completed save replaced; the next save uses the saved hash`, `keeps edits typed after the discard confirmation while its read is in flight`, `keeps the saved buffer when the read held across a save answers with newer disk bytes` (`3 failed, 55 passed, 58 total`); with the guards restored, all 58 pass. The two companion tests (undo boundary, failure recovery) pass in both states because they pin behavior the guards do not change.

All 53 pre-existing assertions pass unchanged, including the dirty-read/Retry protections (`keeps the buffer and the dirty flag when the disk bytes are unchanged`, `keeps the buffer, the dirty flag and the loaded hash when the disk moved on`, `the confirmed Discard and reload still replaces the dirty buffer`, `a failed confirmed reload leaves the editor read-only; Retry restores editing without adopting the new disk version`, `a same-sha read held across a newer disk-change push keeps the stale mark`) and the conflict-secondary reload tests.

## Verification (exact commands and results)

Run from the worktree root, one heavy check at a time, changed project only:

1. `npx jest -c libs/frontend/git-ui/jest.config.ts libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.spec.ts --coverage=false --maxWorkers=2` → `Test Suites: 1 passed, 1 total / Tests: 58 passed, 58 total` (a pre-existing, unrelated `console.warn` about CodeMirror language loading under jsdom dynamic import appears in the log; the suite passes).
2. `npx nx typecheck @ptah-extension/git-ui --parallel=1` → `Successfully ran target typecheck`.
3. `npx nx lint @ptah-extension/git-ui --parallel=1` → `Successfully ran target lint`.

`git status --short`: only the two in-scope files modified (+176/−1). No commit, push, branch, stash or worktree operations were performed.

## Limitations

- The rejection in Fix 2 does not surface the dropped read's disk information; the next save's conflict check (or the echo push in production) is the only surface for it. Tests hold the read so no push arrives; production relies on the documented save echo.
- The ambiguous interleaving where a save attempt (not a completed save) races a confirmed discard reload is unchanged pre-existing behavior and was left alone, per the bounded scope.
- Fix 1 compares buffer text, not change events: a typed-then-retyped identical buffer is treated as unchanged. This matches how the editor itself defines dirtiness (content vs baseline).
- Visual review in Electron was not run; the change touches no template or styling.

## Gate 0.1 record (as reported by the orchestrator)

Lanes enabled from memory preference; codex disabled, Glm unknown availability chosen implementer, Grok confirmed room chosen different-family reviewer; no document gates for bounded correction.