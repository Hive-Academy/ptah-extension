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
Tier 2: CLI vendor lanes (any installed CLI adapter or configured ptah-cli provider)
  └── each runs ONE phase, writes its deliverable to a fixed .md path, never commits
```

No `Task`-tool subagents take part. CLI lanes share no context and have no UI channel — every spawn prompt must be **fully self-contained** (absolute paths, acceptance criteria, the prior phase's artifact path) and must carry an explicit `**Deliverable**: <absolute path>` line, or the lane will dump output into its reply and skip the file.

## The spec folder (borrowed from orchestration)

Persist the run exactly as orchestration does:

1. Scan the `.ptah/specs/TASK_*` folders, take the highest `NNN` for the current year, increment, zero-pad. Never derive the ID from `registry.md` — it is generated and can be stale.
2. `mkdir .ptah/specs/TASK_[ID]`.
3. Write `context.md` with the user intent, the chosen lanes, and `mode: tribunal-relay`.
4. Each phase writes its deliverable to the file named below.

| Phase        | CLI lane (heuristic default)                      | Deliverable file           |
| ------------ | ------------------------------------------------- | -------------------------- |
| Plan / scope | reasoning-strong lane (`modelTier: 'opus'`) as PM | `task-description.md`      |
| Architecture | same strong lane, prompted as architect           | `implementation-plan.md`   |
| Implement    | strongest coding lane discovered                  | code in-place + `tasks.md` |
| Review       | **a different lane** than the implementer         | `code-logic-review.md`     |

That is the _default_ when the user says nothing. Relay's roster is an **assignment, not a discovery** — when the user names who does what, see [Pinning the roster](#pinning-the-roster-per-phase-lane-assignment) below and honor it verbatim.

The review lane MUST NOT be the lane that implemented, and should be a **different vendor family** — that is Relay's one tribunal signal: genuine cross-vendor review instead of a self-review.

---

## Pinning the roster (per-phase lane assignment)

Unlike Council/Forge/Race — where duplicate vendor families collapse in favour of maximum spread — Relay's lanes have **different jobs**, so the same family may legitimately appear twice on different models (e.g. `codex` plans, `codex` on another model judges). Take the user's assignment as given; do not re-pick it by family spread.

### Addressing a lane — what actually goes into `ptah_agent_spawn`

**Never hardcode the vendor list — including the one in this document.** The set of CLI adapters and configured providers grows between releases, and every user's machine differs. `ptah_agent_list` is the only source of truth for what can be spawned right now; the live `cli` enum is on the `ptah_agent_spawn` tool schema. Any vendor named below is an **example**, not the roster.

There are exactly **two kinds of lane**, and every vendor is one or the other:

| Lane kind                                                | Addressed by                                 | Model selection                                                                                                                      |
| -------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **System CLI** — an installed binary/SDK adapter         | `{ cli: '<value from the live enum>' }`      | Optional `model: '<id>'` override; omit for the user's configured default. Ids come from that CLI's own model list                   |
| **Ptah CLI provider** — a user-configured provider agent | `{ ptahCliId: '<id from ptah_agent_list>' }` | `modelTier: 'opus' \| 'sonnet' \| 'haiku'` lets the provider's tier mapping resolve it; a raw `model: '<id>'` overrides that mapping |

Read the rows of `ptah_agent_list` and map them straight across: entries of type `cli` with status `installed` become the first kind, entries of type `ptah-cli` with status `available` become the second (their `ptahCliId` and `provider` are printed in the capabilities column).

**Claude is not a special case.** It appears as a ptah-cli provider entry like any other — e.g. a lane named _claude fable_ on provider _Claude (Subscription)_ — and is addressed by its `ptahCliId` exactly as an Ollama Cloud or Z.AI lane would be. If a run needs a Claude phase and no such entry is listed, the user adds the provider in settings; the alternative is the Conductor writing that phase in-process (or a `Task` subagent), which is fine but is **not an outside opinion** and must be labelled as such in the final summary.

Two practical notes that do generalize:

- **Resume support varies by adapter.** Check `ptah_agent_status` for a `CLI Session ID` before assuming you can resume; where there is none, respawn.
- **Never invent model ids from memory.** Read them off `ptah_agent_list` / the provider's model catalog. If the user named a model the lane does not offer, say so rather than silently substituting one.

### The constraints that survive pinning

1. **The judge lane is never the implement lane.** Same lane + same model reviewing itself is not review.
2. **Prefer a different vendor family for the judge.** Same family on a different model is allowed when the user asks for it — but state plainly in the summary that the review was same-family, because it is a weaker signal than a cross-vendor one.
3. **Every user checkpoint stays with the Conductor.** No lane, Claude-provider or otherwise, gets to gate.
4. **Announce the full roster before spending** — phase, lane, model, one paid call each.

### Worked example

> "codex plans, Claude architects, Ollama GLM implements, codex on a different model judges"

Resolve each named vendor against `ptah_agent_list` **first** — then build the announcement table:

| Phase        | Lane                   | `spawnArgs`                                                       | Deliverable                |
| ------------ | ---------------------- | ----------------------------------------------------------------- | -------------------------- |
| Plan         | Codex                  | `{ cli: 'codex' }`                                                | `task-description.md`      |
| Architecture | Claude                 | `{ ptahCliId: '<the Claude provider entry>', modelTier: 'opus' }` | `implementation-plan.md`   |
| Implement    | Ollama Cloud GLM       | `{ ptahCliId: '<the Ollama Cloud entry>', model: 'glm-…' }`       | code in-place + `tasks.md` |
| Judge        | Codex, different model | `{ cli: 'codex', model: '<another id from codex's model list>' }` | `code-logic-review.md`     |

Announce it as that table, get the go-ahead, then relay. Constraint 1 holds (Codex never implemented); constraint 2 is satisfied by family (GPT judging GLM).

If a named vendor is missing from discovery — not installed, or the provider is not configured yet — **say which one and stop for the user's call**. Offer the substitutes that _are_ listed rather than picking one silently: the roster is the user's design, and quietly swapping a lane changes the result they asked for.

When the implement phase is the risky one, run the implement + judge pair as a [Crucible](crucible.md) loop instead of a single review pass — same lanes, but with a frozen rubric, a defect contract and a hard round cap.

## Flow

```
init spec folder → build lane roster → announce → relay phases (spawn → poll → read → checkpoint) → verify → synthesize
```

### Step 1 — Init & announce

Build the lane roster — if the user pinned phases to lanes, use [Pinning the roster](#pinning-the-roster-per-phase-lane-assignment) verbatim; otherwise derive it from vendor-panel.md §1–2, assigning lanes to _roles_ rather than maximizing family spread. Record the roster (phase → lane → model) in `context.md`. Create the spec folder. Restate the task with **explicit acceptance criteria**. Announce the roster table, the phase count, and the cost (one paid call per phase, more if a phase fans out). Get the go-ahead — this writes code.

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

The artifact written by phase N becomes an **input path** in phase N+1's prompt — that is the relay baton. On timeout: resume via `resume_session_id` where `ptah_agent_status` reports a `CLI Session ID`, otherwise respawn. A lane that fails twice is dropped with a note; reassign its phase to another lane rather than blocking the pipeline.

### Step 3 — Checkpoints stay with you

CLI lanes cannot ask the user — **you** run every gate, exactly as orchestration:

- After `task-description.md` (Checkpoint 1) and `implementation-plan.md` (Checkpoint 2): present the document path + a short summary as a **plain message** (not `AskUserQuestion`), and wait for `APPROVED` / feedback before relaying the next phase.
- If a lane returns a `## Clarifications Needed` block instead of its deliverable, surface those questions via `AskUserQuestion`, then re-spawn the same lane with a `## User Decisions` section in the prompt.

### Step 4 — Verify & synthesize (you)

Read every deliverable, run the project's tests/build/lint on the implemented change, and produce a final summary that **cites which lane produced what** and links each artifact. You own quality: if the review lane flagged a real issue, relay a fix phase before declaring done. When the implement phase is the risky one and you expect more than a single fix pass, run that phase as a [Crucible](crucible.md) loop instead of ad-hoc fix relays — it gives you a frozen rubric, a defect contract, and a hard round cap rather than an open-ended patch cycle. Present the diff and wait for the user before any commit; never auto-merge to `main`.

---

## Guidance

- **Relay is heterogeneous, not a panel.** It bends tribunal's "diversity is the signal" thesis on purpose — the diversity here is the cross-vendor _review_ phase, not N answers to one question. Use Council/Forge/Race when you want competing answers to the _same_ prompt.
- **The roster is the user's call.** Phase-to-lane assignment is the main dial on this move. When it is pinned, spawn exactly what was named — same family twice, specific model ids, a Claude lane — and only push back where a stated constraint breaks (a lane judging its own work).
- **In-place by default.** One task, one branch — no worktrees. Only add a worktree if you fan a single high-stakes phase to multiple vendors (a Forge-style sub-round); say so and note the added cost.
- **Specify acceptance criteria up front.** A vague task produces a vague `task-description.md` and the whole relay inherits the fuzz.
- **Keep synthesis and decisions to yourself.** Lanes do phase work; you arbitrate, verify, and gate. Never let a lane commit.
- **Resume over respawn** on timeout where the vendor supports it — the spec folder + `context.md` make a relay resumable across sessions (point a fresh run at the existing `TASK_[ID]`).
