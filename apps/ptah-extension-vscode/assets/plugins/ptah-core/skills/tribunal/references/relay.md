# Relay — orchestrate one task across CLI lanes (no subagents)

Run a **single, well-defined task** through orchestration's phased pipeline — plan → architect → implement → review — but execute every phase on a **CLI vendor lane** instead of a `Task`-tool subagent. The Conductor is the only in-process reasoner and the **sole spawner**; each phase's output is persisted to a `.ptah/specs/TASK_[ID]/` folder so the run is auditable and resumable.

Read [vendor-panel.md](vendor-panel.md) first — Relay is that spine, but each lane gets a **different** prompt (one per phase) instead of the same question, and the lanes run as a **sequential pipeline** rather than a parallel panel.

> **Relay changes files.** It runs in-place on the user's active branch by default (no worktrees), so confirm the task scope and never commit without the user's sight. Each lane writes a deliverable to disk and never commits.

---

## Relay vs the homogeneous moves

|                 | Council / Forge / Race            | Relay                                          |
| --------------- | --------------------------------- | ---------------------------------------------- |
| Prompt per lane | **Same** prompt to every panelist | **Different** prompt per lane (one per phase)  |
| Shape           | Parallel panel                    | Sequential pipeline (baton-passed)             |
| Signal          | Diversity / disagreement          | Specialization + one cross-vendor review phase |
| Output          | A cited verdict message           | `.ptah/specs/TASK_[ID]/` artifacts + a summary |
| Isolation       | Worktree per lane (Forge/Race)    | In-place; worktree only if a phase fans out    |

Relay is **orchestration's spine on tribunal's transport**: it deletes orchestration's subagent tier (team-leader + specialist developers) and pushes all execution onto CLI lanes. Reach for it when you want orchestration's structured, phased delivery but want the work done by external vendors — with cross-vendor review baked into the pipeline.

## Topology — two tiers, no subagents

```
Tier 1: Conductor (you)
  ├── sole reasoner, synthesizer, and SOLE spawner
  ├── owns ALL user checkpoints (CLI lanes can't call AskUserQuestion)
  └── spawns one CLI lane per phase, feeds each artifact to the next
Tier 2: CLI vendor lanes (codex / copilot / cursor / ptah-cli providers)
  └── each runs ONE phase, writes its deliverable to a fixed .md path, never commits
```

No `Task`-tool subagents take part. CLI lanes share no context and have no UI channel — every spawn prompt must be **fully self-contained** (absolute paths, acceptance criteria, the prior phase's artifact path) and must carry an explicit `**Deliverable**: <absolute path>` line, or the lane will dump output into its reply and skip the file.

## The spec folder (borrowed from orchestration)

Persist the run exactly as orchestration does:

1. Read `.ptah/specs/registry.md`, find the highest `TASK_ID`, increment.
2. `mkdir .ptah/specs/TASK_[ID]`.
3. Write `context.md` with the user intent, the chosen lanes, and `mode: tribunal-relay`.
4. Each phase writes its deliverable to the file named below.

| Phase        | CLI lane (heuristic)                               | Deliverable file           |
| ------------ | -------------------------------------------------- | -------------------------- |
| Plan / scope | reasoning-strong lane (`modelTier: 'opus'`) as PM  | `task-description.md`      |
| Architecture | same strong lane, prompted as architect            | `implementation-plan.md`   |
| Implement    | best coder lane (codex / strong ptah-cli)          | code in-place + `tasks.md` |
| Review       | **a different vendor family** than the implementer | `code-logic-review.md`     |

The review lane MUST be a different vendor family from the implementer — that is Relay's one tribunal signal: genuine cross-vendor review instead of a self-review.

## Flow

```
init spec folder → build lane roster → announce → relay phases (spawn → poll → read → checkpoint) → verify → synthesize
```

### Step 1 — Init & announce

Build the lane roster (vendor-panel.md §1–2 — but assign lanes to _roles_, not max family spread). Create the spec folder + `context.md`. Restate the task with **explicit acceptance criteria**. Announce the lanes, the phase count, and the cost (one paid call per phase, more if a phase fans out). Get the go-ahead — this writes code.

### Step 2 — Relay the baton, phase by phase

For each phase, in order:

```
ptah_agent_spawn({
  task: <self-contained prompt
         + acceptance criteria
         + "read the prior artifact at <abs path>"
         + "**Deliverable**: write to <abs path>; reply only `WROTE: <path>` + one-line headline">,
  ...lane.spawnArgs,        # cli / ptahCliId + modelTier
  taskFolder: <spec folder>,
  files: [...relevant absolute paths]
})
# poll ptah_agent_status every ~8s until status != "running"
# ptah_agent_read → then Read the .md it wrote
```

The artifact written by phase N becomes an **input path** in phase N+1's prompt — that is the relay baton. On timeout: resume (ptah-cli / copilot via `resume_session_id`), respawn (codex). A lane that fails twice is dropped with a note; reassign its phase to another lane rather than blocking the pipeline.

### Step 3 — Checkpoints stay with you

CLI lanes cannot ask the user — **you** run every gate, exactly as orchestration:

- After `task-description.md` (Checkpoint 1) and `implementation-plan.md` (Checkpoint 2): present the document path + a short summary as a **plain message** (not `AskUserQuestion`), and wait for `APPROVED` / feedback before relaying the next phase.
- If a lane returns a `## Clarifications Needed` block instead of its deliverable, surface those questions via `AskUserQuestion`, then re-spawn the same lane with a `## User Decisions` section in the prompt.

### Step 4 — Verify & synthesize (you)

Read every deliverable, run the project's tests/build/lint on the implemented change, and produce a final summary that **cites which lane produced what** and links each artifact. You own quality: if the review lane flagged a real issue, relay a fix phase before declaring done. Present the diff and wait for the user before any commit; never auto-merge to `main`.

---

## Guidance

- **Relay is heterogeneous, not a panel.** It bends tribunal's "diversity is the signal" thesis on purpose — the diversity here is the cross-vendor _review_ phase, not N answers to one question. Use Council/Forge/Race when you want competing answers to the _same_ prompt.
- **In-place by default.** One task, one branch — no worktrees. Only add a worktree if you fan a single high-stakes phase to multiple vendors (a Forge-style sub-round); say so and note the added cost.
- **Specify acceptance criteria up front.** A vague task produces a vague `task-description.md` and the whole relay inherits the fuzz.
- **Keep synthesis and decisions to yourself.** Lanes do phase work; you arbitrate, verify, and gate. Never let a lane commit.
- **Resume over respawn** on timeout where the vendor supports it — the spec folder + `context.md` make a relay resumable across sessions (point a fresh run at the existing `TASK_[ID]`).
