# TASK_2026_365 — Scope the agent user layer by workspace

## The report

> Each time I open Ptah, especially when opening more than one workspace, the
> `.codex/agents/*.toml` files get updated. Only codex, nothing else. Why?

## What is actually happening

Codex is **not** the only target that changes. `.codex/agents` and
`.github/agents` carried the identical write time `08/31/2026 18:23:13`. Only
Codex is VISIBLE, because `.codex/agents/*.toml` are tracked files in this
repository — `git check-ignore --no-index` reports `.gitignore:197 .codex/**`,
but a tracked file ignores the ignore rule. `.github/agents/**`
(`.gitignore:147`) is ignored AND untracked, so the same churn leaves no trace.
`.cursor/agents` is absent because the Cursor CLI is not detected.
`.claude/agents` is `source-managed` and is never written.

## The mechanism

`~/.ptah/user/agents` is ONE directory per machine
(`user-layer-mirror.service.ts:204`). Its source is the PER-WORKSPACE
`{ws}/.claude/agents` (`apps/ptah-electron/.../plugin-activation.ts:182`,
`apps/ptah-extension-vscode/.../plugin-activation.ts:90`). The clone is keyed by
the file name alone (`user-layer-mirror.service.ts:1015`), so two workspaces
whose agents share a slug address one file.

`mirrorAgents` is create-if-absent and cannot overwrite
(`user-layer-mirror.service.ts:1506`). `reconcileFileClone` CAN: when the source
hash differs from the sidecar and the clone is unmodified, it fast-forwards
(`user-layer-mirror.service.ts:1128-1135`). Each workspace therefore overwrites
the other's agents on every activation, folder change, plugin toggle and content
download — every `mode: 'full'` trigger.

## Measured evidence

`~/.ptah/user/agents/.history/frontend-developer/` holds two snapshots six
seconds apart, each recording the clone content that the next write replaced:

```
7:13:28 PM   15784 bytes   this repository (Angular)
7:13:34 PM   17432 bytes   another workspace (React)
```

The two are different products under one name:

```
1788192814720   name: frontend-developer
                "# Frontend Developer Agent - react Edition"
                description: "Frontend developer specializing in modern UI frameworks…"

1788192808087   name: frontend-developer
                "# Frontend Developer"
                description: "Writes and changes user-interface code in this repository…"
```

The history also holds `figma-designer`, an agent this repository does not
contain and never had.

**The consequence is not only a dirty working tree.** The clone held the React
agent between 7:13:28 PM and 7:13:34 PM. A reconcile for this repository inside
that window would have written another project's agents into this repository's
`.codex/agents` and `.github/agents`. The pass at 7:13:35 PM missed it by one
second.

## Why the tailoring does not protect against this

The setup wizard tailors each agent to one project's stack and architecture.
That is the CAUSE, not a protection: the content differs while the file name
does not. An agent is a per-workspace artifact held in a per-machine store.

`TASK_2026_316` documents the same shape for skills — "`~/.ptah/user/skills` is
one directory per MACHINE, and the mirror is create-if-absent" — and answered it
with a consent gate. A gate stops propagation. It does not stop two workspaces
from addressing one file, which is why agents need the key as well.

## The second defect: the mirror runs with no consent

`buildMirrorSources` passes `agentSourceDir: {ws}/.claude/agents`
unconditionally. `TASK_2026_286/context.md:18` already recorded this and fixed
only the propagation half. So:

- Every `.md` under `{ws}/.claude/agents` is cloned into the machine-wide layer,
  whoever wrote it — the wizard, a `git clone` of a repository that ships agents,
  Claude Code itself, or the user by hand.
- Each clone is written with `pluginId: null`, and the plugin-origin gate never
  filters a `null` origin, by design.
- `agentSyncEnabled` gates `buildAgents()` only. It has no effect on the mirror.

A repository that ships `.claude/agents` therefore populates the shared layer on
the first activation, before the wizard has ever run.

## Decisions

**D1 — Key the agent clone, do not delete it.** Reading `{ws}/.claude/agents`
directly as the desired state would be a three-line change and would delete the
whole class of bug. It would also delete the agent clone surface, which ships:
`skillSynthesis:listClones`, `rebaseClone`, `keepClone`, per-agent scorecards and
the divergence UI in `libs/frontend/skill-synthesis-ui`. The key preserves all of
it.

**D2 — The key is `<label>-<hash>`, derived in `libs/shared`.**
`agent-generation` writes the directory and `harness-sync` reads it, and neither
lib may import the other. `libs/shared` is the one bridge, exactly as the
origin-sidecar schema is. The hash is a pure-TypeScript FNV-1a 64, not
`node:crypto`: `libs/shared` is imported by frontend libs, and a `crypto` import
in that barrel reaches the webview bundle.

**D3 — Case folds on win32 only.** Same rule as
`targets/mcp/codex-project-trust.ts`: separator normalization cannot invent a
match, and case folding can. On ext4 `/a/App` and `/a/app` are two workspaces.

**D4 — The migration seeds, and never reaps.** Agents are manifest-owned, so an
empty desired state DELETES every propagated copy. On the first pass for a
workspace, when the scoped directory does not exist and the flat base holds
clones, the flat clones are copied in as the seed. The normal mirror and
reconcile then converge that seed onto the workspace's own
`{ws}/.claude/agents`. A workspace with no `.claude/agents` keeps exactly what it
has today, now private to it.

**D5 — The legacy flat files stay on disk.** They are not deleted, on the
quarantine precedent: cleanup of a user's files is never automatic.

**D6 — The mirror gate reads `AgentSyncGate.resolve`, never the raw flag.**
`resolve` answers an absent flag from manifest evidence. The raw flag is absent
on the first pass after an upgrade, and the mirror runs BEFORE the reconcile that
would persist the derived answer — so reading the raw flag would skip the mirror
and hand the reconciler an empty desired state, which is a reap.
