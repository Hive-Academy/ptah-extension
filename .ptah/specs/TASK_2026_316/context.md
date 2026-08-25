# Context — TASK_2026_316

## The report

> Any new workspace or project I open directly syncs all of our skills without
> waiting for the user to choose and install ones from the plugins dropdown.
> I was working on a React application and for some reason the application
> synced all of the other skills for Angular and other tech stacks I don't use
> or plan to use.

Observed in Electron, on a freshly-opened workspace: `.agents/skills/`,
`.claude/skills/` and `.github/skills/` each populated with the full bundled
catalogue — `angular-3d-scene-crafter`, `angular-frontend-patterns`,
`angular-gsap-animation-crafter`, `ddd-architecture`, `nestjs-backend-patterns`,
`nestjs-deployment`, `nx-workspace-architect`, `saas-platform-patterns` and the
rest — in a project that uses none of them.

## What actually happens

The propagation is correct per its own contract. The contract is the problem.

1. **The desired state is user-global.** `defaultHarnessSourceLayout()`
   (`libs/backend/harness-sync/src/lib/sources/plugin-config-source-resolver.ts:46`)
   points `skillsRoot` at `~/.ptah/user/skills`. That directory is one per
   machine, not one per workspace.

2. **The only skill filter is opt-out.**
   `HarnessManifestBuilder.buildSkills`
   (`libs/backend/harness-sync/src/lib/manifest/harness-manifest.builder.ts:175-193`)
   reads `const disabled = new Set(sources.disabledSkillIds)` and claims every
   slug not in it. There is no allowlist, and no per-workspace question is
   asked of a user-layer skill at all.

3. **Activation reconciles unconditionally, in every host.**
   `reconcileHarness(container, workspaceRoot, reason)` with `mode: 'full'`
   (`apps/ptah-electron/src/activation/plugin-activation.ts:406`), wired from
   `phase-2-libraries.ts`; the same call exists in the VS Code host and in
   `libs/backend/cli-engine/src/lib/bootstrap/harness-boot.ts`. Opening the
   workspace is the whole trigger.

4. **The user layer accumulates and never shrinks on disable.** The mirror is
   create-if-absent and is fed by `buildMirrorSources`
   (`apps/ptah-electron/src/activation/plugin-activation.ts:90-114`) from
   `resolvePluginPaths(config.enabledPluginIds)`. Enable `ptah-angular` once, in
   one workspace, and its skills are cloned into `~/.ptah/user/skills`
   permanently. Every workspace opened afterwards — on any host, including
   `ptah tui` and the headless CLI — gets them.

So the React workspace never enabled anything. It inherited the union of every
selection ever made on that machine.

## The second defect, found while confirming the first

**Unchecking a bundled plugin does not remove its skills any more.** Three
facts compose into it:

- `disabledPluginIds` is tested only inside the OVERLAY loop
  (`harness-manifest.builder.ts:195-198`). The user-layer base loop above it
  has no plugin-id concept at all — a mirrored clone carries its origin in a
  sidecar, and the builder never reads it.
- Removing an id from `enabledPluginIds` removes its path from
  `resolveCurrentPluginPaths()`, so the overlay drops it — but the clone in
  `~/.ptah/user/skills` is untouched, and the clone is the base.
- The user-layer reaper deliberately keeps it. `classifyUpstream`
  (`libs/backend/agent-generation/src/lib/services/user-layer/user-layer-orphan-reaper.ts:123-127`)
  returns `check-plugin-dir` for a clone whose `pluginId` is not in the scanned
  set, and the plugin directory under `~/.ptah/plugins` still exists. Disabled
  is distinguished from uninstalled on purpose (`buildMirrorSources`'
  `pluginsBasePath` doc comment says so in as many words), and "disabled" means
  "keep the clone".

Each of the three is defensible alone. Together they mean the Configure
modal's plugin checkbox is, for skills, a no-op after first enable.

`apps/ptah-docs/src/content/docs/plugins/skill-toggles.md:38` documents the old
truth:

| Plugin state | Skill state | Result                                                      |
| ------------ | ----------- | ----------------------------------------------------------- |
| Disabled     | Enabled     | Nothing is junctioned — plugin enablement is the outer gate |

That row has been false since TASK_2026_278 replaced `SkillJunctionService`
with the reconciler. The whole page is also still written in terms of junctions.

## Why the existing per-skill toggle is not the answer

`disabledSkillIds` works and is genuinely per-workspace (it lives in the plugin
config in `WORKSPACE_STATE_STORAGE`). It is the wrong shape for this problem in
two ways:

- **It is a denylist.** Silencing the bundled catalogue in a new workspace means
  ticking off every skill by hand, and every skill added to the user layer
  afterwards — a promoted synth skill, a new bundled plugin, a `skills.sh`
  install — is absent from the denylist and propagates again. The list can never
  be finished.
- **It is keyed to a flat global namespace.** That is correct for its job
  (see the skill-toggles doc) and irrelevant to "does THIS project want THIS
  skill".

## The precedent to copy: `AgentSyncGate`

TASK_2026_286 solved exactly this problem for the `agents` facet, and the
reasoning transfers verbatim except for one clause. From
`libs/backend/harness-sync/src/lib/state/agent-sync-gate.ts:4-9`:

> Skills and commands are content the user installed or authored on purpose: a
> plugin toggle, a `SKILL.md` they wrote, a harness-builder run. Agents were the
> one artifact kind that propagated with no gate at all.

The premise is true of the workspace where the install happened, and false of
every other workspace on the machine — which is the whole of this report. The
`agents` gate is `{ws}/.ptah/harness/state.json` → `agentSyncEnabled`, resolved
from manifest evidence when absent, persisted once, granted by the setup wizard.

**The migration rule is the load-bearing half and applies with more force
here.** Skills are manifest-owned, so an empty desired state is a REAP, not a
skip. A `skillSyncMode` that defaulted to `'selected'` with an empty allowlist
would not merely stop propagating — the first routine reconcile after the
upgrade would delete every `.claude/skills/*`, `.agents/skills/*`,
`.github/skills/*` and `.cursor/skills/*` Ptah had ever written, in every
existing workspace, silently, reported as an ordinary clean pass. Skills are
the largest artifact family by count, so this is the worst version of the
failure `AgentSyncGate` exists to prevent. **Prior propagation is prior
consent**: absent flag + any manifest owning a `skill` entry resolves to
`'all'`.

## Decisions taken (user, 2026-08-23)

**U1 — Both fixes, sequenced.** Batch 1 restores the plugin gate; Batch 2 adds
the per-workspace allowlist on top. Two shippable halves — Batch 1 alone makes
the Configure modal's plugin checkbox mean something again, which is the
smaller half of the complaint and can ship without any new state.

**U2 — A new workspace propagates nothing, and says so.** No skills are copied
until the user picks. Surfaced by a Dashboard card and a route into the existing
**Configure Ptah Skills** modal, not by silence. Explicitly rejected:
auto-selecting by workspace analysis (more machinery, guesses wrong, and a wrong
guess is indistinguishable from the bug being reported), and carrying the
previous workspace's selection over (that reproduces the complaint exactly
whenever two projects use different stacks).

## Constraints carried in from the existing design

- **Never let a new gate default to OFF for an artifact kind already on disk.**
  `libs/backend/harness-sync/CLAUDE.md`, Guidelines. `AgentSyncGate` is the
  named worked example; copy its shape rather than inventing a second migration
  idiom.
- **Manifests are read for every id in `HARNESS_TARGET_IDS`**, not only the
  targets the current host registered. A CLI host registering fewer targets than
  the extension did must not read a propagated workspace as un-propagated.
- **`verify()` resolves the gate but never persists it.** A derived decision is
  a write, and the health badge polls `verify()`.
- **`persist()` never overwrites a recorded flag.** It is the migration step,
  not a way to revoke consent.
- **Callers use `HarnessPropagationService.propagate`, not `reconcile`.** The
  two documented exceptions are host activation and `plugins:save-config`
  (`skipUserLayerRefresh`, because a toggle changes the FILTER and not a
  source's contents). A skill-selection save is the same shape as a plugin
  toggle and takes the same exception.
- **The gate is DEFAULTED into the reconciler, not nullable**, so a host that
  forgets to wire it cannot propagate ungated.

## Out of scope

- Changing what the user-layer mirror collects, or making `~/.ptah/user` itself
  per-workspace. The user layer is deliberately one editable source; this task
  gates what leaves it.
- Commands. `~/.ptah/user/commands` has the same ungated shape and a far smaller
  blast radius (a slash command the user never types costs nothing but a name in
  a menu). Worth a follow-up, not worth coupling to this one.
- The `agents` facet, which is already gated.
- Reworking `disabledSkillIds`. It keeps working and keeps its meaning; the new
  allowlist composes with it as an outer gate, exactly as plugin enablement
  composes with skill toggles today.
