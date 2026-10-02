# P2 Phase-End Logic Review — Round 1 (fix verification) — TASK_2026_576_e16a

Scope: commits `00f21739b` (backend fixes) and `c9a316661` (branch-picker files only; diff-tabs.service.ts is reviewed separately). Read-only review; no source edits.

Method: both fix diffs were read in full. The refusal parser and the unmerged-record parsing were exercised against a real git in a throwaway directory: a stage-3-symlink merge conflict rebuilt via `git update-index --cacheinfo`, and untracked-blocker switch refusals with a path containing embedded single quotes (`it's a 'single' quote.txt`) plus a list-form refusal. The JavaScript `split`-with-limit semantics were executed in node, not reasoned about.

## Verdict: APPROVED

All four findings the fix commits targeted are resolved. One round-0 finding (2) is retracted: its premise was wrong JavaScript semantics, and the round-1 rejection was correct. One new minor finding; it does not block.

## Per-finding status

### Finding 1 (MAJOR — discard cannot clear untracked blockers) — RESOLVED

- Backend (`git-info.service.ts`): new `parseSwitchRefusal` (`git-info.service.ts:282`) recognises both refusal shapes, and `runSwitch` (`discarding` flag, force path only) returns `{ dirty: true, conflictingPaths, error }` with the move-or-delete message on a refused discard. No untracked file is ever deleted — `checkout --force` is gone from the flow, per the chosen design.
- Frontend (`branch-picker-dropdown.component.ts`): the dirty test drops `!mode.force`, so a refused discard re-prompts; `discardRefusal` (set only when `mode.force`) shows the reason, hides the Discard button and leaves Stash & switch as the only action.
- Verified against real git: the single-line form `error: Untracked working tree file '<path>' would be overwritten by merge.` and the list form `The following untracked working tree files would be overwritten by checkout:` both parse to the correct path list with `untracked: true`. A path with embedded single quotes is captured exactly — the greedy `'(.+)'` takes the text up to the last `' would be overwritten by`, and node compared the captured bytes with the real filename: equal. `"` in a filename is impossible on Windows, and on other platforms git C-quotes it, which the same greedy pattern still captures.

### Finding 2 (MINOR — stage-3 symlink mode never compared) — REJECTED-AGREED (round-0 finding retracted)

The round-1 rejection is correct, and my round-0 analysis was wrong. I conflated Python's `maxsplit` (which merges the remainder into the last element) with JavaScript's `split` limit (which splits everything and truncates the result). Executed in node:

- `'a b c d e f g'.split(' ', 6)` → `["a","b","c","d","e","f"]` — truncated, not merged.
- On the real unmerged record `u UA N... 000000 000000 120000 120000 <h1> <h2> <h3> link` (rebuilt with `git update-index --add --cacheinfo 120000,<sha>,link` and a real merge), the parser's exact algorithm — `pathStart(record, 10)` then `record.substring(0, start).split(' ', 6).slice(3)` — yields `["000000","000000","120000"]`. m3 IS extracted, `stageModes.includes(SYMLINK_MODE)` is true, and the entry is classified `symlink` as the plan requires. No defect exists at `git-status-parser.ts:241`.

### Finding 3 (MINOR — silent empty worktrees list on malformed params) — RESOLVED

`git-rpc.handlers.ts:325` logs `[GitRpc] git:worktrees called with invalid params` before the documented empty-list return. Matches the `resolveRoot` warning pattern; spec updated.

### Finding 4 (MINOR — exclude line negation on `!`-prefixed folder) — REJECTED-AGREED

My round-0 finding was wrong: the constructed line always starts with `/` (the anchored prefix), and gitignore negation requires `!` as the first character, so a `!x/` prefix can never turn the line into a negation. The added real-git spec (`git-info.service.worktrees.real-git.spec.ts`) pins this.

### Finding 5 (MINOR — `stashRef` dropped; user never told) — RESOLVED

`branch-picker-dropdown.component.ts:338` shows a dismissible stash notice (label, SHA tooltip, "find them in Stashes"), keeps the picker open, focuses Dismiss, and clears the notice on any close (`isOpen` effect) and on every new checkout attempt. Both outcomes are spec-covered (stashed, and no-stash-needed → close).

### Finding 6 (MINOR — no git version gate) — RESOLVED

`isGitTooOldForSwitch` (`git-info.service.ts:314`) + `GIT_TOO_OLD_MESSAGE` (`:308`) classify both old-git failure strings (`'switch' is not a git command`, `unknown option .end-of-options'`) on every `runSwitch` path, and `agent-worktree-admin.ts:125` applies the same gate to `worktree add`'s `--end-of-options`. `revParseLine` uses no `--end-of-options` (verified: `:257`, `:258` pass plain args), so no path is left ungated.

## New findings

### N1. MINOR — stash notice label can name the wrong entry when the stash stack is shared

- File: `libs/frontend/git-ui/src/lib/branch-picker-dropdown.component.ts:338` (`label: 'stash@{0}'`).
- Scenario: the stash stack (`refs/stash`) is shared across the main checkout and every worktree of a repository. The label is correct at the moment of the switch, but if another worktree or session pushes a stash before the user reads the notice, `stash@{0}` names that newer entry. The SHA in the tooltip stays exact, so the damage is a possibly misleading ordinal in the message text.
- Suggested fix: derive the ordinal from `stash list` at render time, or word the notice without the ordinal ("Changes stashed — newest entry in Stashes") and rely on the SHA.

## Verified clean in the fixes

- `discarding: true` is passed only by the force branch; the plain and stash `runSwitch` calls keep `false`, so their errors stay git's own text.
- `runSwitch` returns the raw outcome untouched when the lock was not acquired (`code !== 'COMPLETED'` early return) and when `parseSwitchRefusal` finds no paths — no message is invented for unrelated failures.
- The blocked panel flow: a confirmed discard that is refused re-prompts with paths and reason, hides Discard, focuses the Stash button; `confirmingDiscard` is reset; a later plain refusal of the same branch shows the full option set again.
- The stash notice cannot outlive the picker: cleared on close (isOpen effect), on any new checkout, and the no-stash success closes immediately as before.

Remaining uncertainty: the old-git classification strings were checked against git's documented messages, not against a git older than 2.23 (none available here).