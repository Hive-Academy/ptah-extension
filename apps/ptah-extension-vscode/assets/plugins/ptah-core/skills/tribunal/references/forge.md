# Forge — build & cross-review

Give the same coding task to every panelist, each in its **own isolated git worktree**, run **round-robin cross-vendor review** of the resulting diffs, then judge and **merge the winner**. This is the flagship move: it turns vendor diversity into the best available implementation of a well-specified change.

Read [vendor-panel.md](vendor-panel.md) first — Forge is that spine with worktree isolation and a code-review round instead of a critique round.

> **Forge changes files.** Confirm the task scope with the user and never auto-merge to `main`. Each panelist commits only inside its own throwaway worktree.

---

## Why worktrees (not in-place)

The house rule is to prefer in-place work over worktrees for ordinary single-agent tasks. **Forge is the documented exception:** N vendors mutate the _same_ files _simultaneously_, so they MUST be physically isolated or they corrupt each other. `ptah_git_worktree_add` + a per-spawn `workingDirectory` gives each panelist its own checkout; worktrees are removed at the end.

## Flow

```
discover panel → announce → worktree per panelist → parallel implement → round-robin cross-review → judge → merge winner → cleanup
```

### Step 1 — Discover, scope, announce

Build the panel (vendor-panel.md §1–2). Restate the coding task and **explicit acceptance criteria**. Announce the panel and the cost (panel × ~2 rounds). Get the user's go-ahead — this writes code.

### Step 2 — One worktree per panelist

```
for panelist Pk:
  branch       = "tribunal/forge/<slug>/" + Pk.label-slug
  { worktreePath } = ptah_git_worktree_add({ branch, createBranch: true })
  ptah_agent_spawn({
    task: <fully self-contained task + acceptance criteria + "commit your work in this directory">,
    ...Pk.spawnArgs,
    workingDirectory: worktreePath,
    taskFolder
  })
```

Poll and read each (vendor-panel.md §3). On timeout: resume where supported (ptah-cli / copilot), respawn for codex. A panelist that fails twice is dropped with a note.

### Step 3 — Round-robin cross-vendor review

- For each `Pk`, capture its diff against the base (`git diff` in its worktree).
- **Assignment:** `Pk` reviews `P(k+1 mod n)`'s diff — every diff gets exactly one peer reviewer, no one reviews their own work.
- Anonymize (vendor-panel.md §4): the reviewer sees "Implementation A", not the author's brand.
- Spawn each reviewer **in its own worktree** with the peer's diff inlined, asking for a structured review:

```
Review this implementation against the task and acceptance criteria:
## Correctness  — does it meet the criteria? bugs?
## Tests        — adequate coverage? do they actually run?
## Risk         — edge cases, regressions, security concerns
## Verdict      — ship / revise / reject + the single biggest issue
```

### Step 4 — Judge → merge → cleanup (you)

- **Judge (peer arbiter):** rank the implementations using the cross-reviews + your own read against the acceptance criteria. For a large panel or multi-criterion rubric, fan out per-criterion judging with the `Agent`/`Task` tool, then aggregate. Do not just count votes — weigh evidence.
- **Surface before merge:** present the ranked verdict, each implementation's diff summary, and the winning branch to the user. Wait for confirmation.
- **Merge:** check out / cherry-pick the winning branch onto the user's working branch. **Never** auto-merge to `main`.
- **Cleanup:** `ptah_git_worktree_remove({ path, force: true })` for every worktree, then `ptah_git_worktree_list` to confirm none are orphaned. Loser branches may be kept for audit until the user confirms otherwise.

---

## Guidance

- **Specify acceptance criteria up front.** Forge is only as good as the task definition — vague tasks produce incomparable diffs.
- **Disjoint or shared files?** Forge assumes all panelists touch overlapping files (hence worktrees). If the task is genuinely file-disjoint, the `orchestration` skill's parallel CLI delegation is the cheaper fit — say so.
- **One review round.** Each diff gets one peer reviewer; add a second round only if the first surfaced a correctness dispute worth resolving. Tell the user the added cost.
- **Cleanup is mandatory.** Always remove worktrees, even on failure — leave the repo clean. Confirm with `ptah_git_worktree_list`.
- **Merge safety.** Winner merges to the user's active branch only, after they've seen the diffs; never to `main`, never without sight.
