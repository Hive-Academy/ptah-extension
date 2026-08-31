# @ptah-extension/harness-sync

[Back to Main](../../../CLAUDE.md)

## Purpose

One concern: **reconcile the user layer into the harness directories AI tools
actually read**, as idempotent, manifest-owned copies.

`~/.ptah/user/{skills,commands}` and `~/.ptah/user/agents/<workspace-key>` are
the single editable source, plus `~/.ptah/mcp-installed.json` for MCP servers.
Skills and commands are per-machine; agents are per-workspace, because the setup
wizard tailors them per project (see "The agent clone is keyed by WORKSPACE").
Everything downstream is a derived, hash-gated copy that a manifest proves Ptah
owns.
`HarnessReconciler.reconcile(ws)` is the ONE entry point — every host, RPC
handler and trigger calls it, and calling it twice costs a directory walk.

Replaces four separate fan-outs that each had their own idea of ownership:
`SkillJunctionService` (agent-sdk, Batch 1), `CliPluginSyncService`
(cli-agent-runtime), `MultiCliAgentWriterService` (agent-generation) and the
`mcp-directory` installers (Batch 2). All four are deleted.

## Target × facet matrix

| Target          | skills                     | commands                     | agents                          | mcp                                  |
| --------------- | -------------------------- | ---------------------------- | ------------------------------- | ------------------------------------ |
| **claude**      | `.claude/skills/<slug>/**` | `.claude/commands/<slug>.md` | source-managed `.claude/agents` | `{ws}/.mcp.json`                     |
| **codex**       | `.agents/skills/<slug>/**` | — **unsupported**            | `.codex/agents/<id>.toml`       | `~/.codex/config.toml` ‡             |
| **copilot**     | `.github/skills/<slug>/**` | — **unsupported**            | `.github/agents/<id>.agent.md`  | `~/.copilot/mcp-config.json` †       |
| **cursor**      | `.cursor/skills/<slug>/**` | `.cursor/commands/<slug>.md` | `.cursor/agents/<id>.md`        | `{ws}/.cursor/mcp.json`              |
| **antigravity** | `.agents/skills/<slug>/**` | — **unsupported**            | — **unsupported**               | `~/.gemini/config/mcp_config.json` § |
| **vscode**      | — **unsupported**          | — **unsupported**            | — **unsupported**               | `{ws}/.vscode/mcp.json`              |

§ **Antigravity is TWO PRODUCTS, and this file is the one the CLI reads.** The
Antigravity EDITOR also documents a workspace config at
`{ws}/.agents/mcp_config.json`. The `agy` CLI does not read it — measured three
ways: `agy mcp list` reported `No MCP servers configured` with that exact file
on disk and listed a server the moment the same entry went into the global file;
the CLI's bundled docs
(`~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/mcp_servers.md`)
define a Global and a Plugin scope and no workspace one; and the `agy` binary
carries string literals for `.agents/skills`, `.agents/rules`,
`.agents/hooks.json`, `.agents/plugins`, `.agents/workflows` and
`.agents/agents`, and none for `.agents/mcp_config.json`. The reconciler
therefore stays on the global file, which is also correct for a user INSTALL (a
machine-wide choice). `CodeExecutionMCP` writes BOTH for Ptah's own server, so
the editor gets it too; the workspace file has no other writer.

‡ **Codex reads TWO config files and MERGES them**, and this is the one the
RECONCILER writes. `CodexTomlMcpFacet` takes a `scope` — `'home'` (the default,
what the registry builds and what the matrix above describes) or `'workspace'`
for `{ws}/.codex/config.toml`. Which one is right is a question about the
SERVER, not about Codex: a server the user INSTALLED is a machine-wide choice
and belongs in home, while Ptah's OWN server is bound to one workspace's Ptah
process and is registered per workspace by `CodeExecutionMCP`. `codex --help`
and `codex doctor` name only the home file, which is misleading and cost one
wrong conclusion; verified on codex-cli 0.150.1 by adding
`{ws}/.codex/config.toml` and watching `codex doctor` go from `MCP servers 1`
to `2`. A project-scoped file is honoured **only for a TRUSTED project** — the
same probe in an untrusted temp repo ignored it silently, which is what
`codexProjectTrusted` exists to detect so a writer can fall back to the home
file rather than write one Codex discards.

† **Copilot reads THREE MCP sources, and this is only the one Ptah installs
into.** `copilot mcp --help` lists user `~/.copilot/mcp-config.json`, workspace
`.mcp.json` **or** `.github/mcp.json`, and plugins. The home file is the right
target for a USER-installed server, because an install is per machine and the
install surface fans it out per target — but it is wrong as a description of
what Copilot can read, and that distinction matters: `CodeExecutionMCP`
deliberately does NOT write `~/.copilot/mcp-config.json` for Ptah's own server,
because Copilot already picks it up from the `{ws}/.mcp.json` written for
Claude. Verified with `copilot mcp list`, which prints
`Workspace servers: ptah (http)` with no Copilot-specific file on disk.

Every cell is reported per target in `HarnessTargetHealth.facets`, so an
artifact a tool genuinely cannot accept reads as `unsupported` rather than as a
permanently missing count nobody can act on (defect 12). `source-managed` is
different: the target's directory is editable input, so Ptah deliberately does
not write it, record it in a manifest, or reap it.

**Two columns are gated on user consent now: `agents` (TASK_2026_286) and
`skills` (TASK_2026_316).** The claim used to stop at agents, reasoning that
skills and commands "are content the user installed or authored on purpose — a
plugin toggle, a `SKILL.md` they wrote, a harness-builder run" and so needed no
gate. **That premise was true only of the workspace where the install
happened, and false of every other workspace on the machine** —
`~/.ptah/user/skills` is one directory per MACHINE, and the mirror is
create-if-absent, so enabling a plugin once, in one project, cloned its skills
into a base every later workspace inherited unconditionally, on any stack, with
no per-workspace question ever asked. That is the whole of the bug
TASK_2026_316 fixes. Either gate dropping an entry REAPS it, because both
facets are manifest-owned:

| Gate                                 | Scope         | Lives in                                                  | Set by                                                               |
| ------------------------------------ | ------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| `state.json` → `agentSyncEnabled`    | workspace     | `{ws}/.ptah/harness/state.json`                           | the setup wizard, via `AgentSyncGate.enable`                         |
| `PluginConfigState.disabledAgentIds` | per agent     | workspace state (plugin config)                           | the user, keyed by slug like `disabledSkillIds`                      |
| `state.json` → `skillSyncMode`       | workspace     | `{ws}/.ptah/harness/state.json`                           | the user via `SkillSyncGate.select` / `.enableAll`, or the migration |
| `state.json` → `enabledSkillSlugs`   | per selection | `{ws}/.ptah/harness/state.json` (only under `'selected'`) | the user, via the same call                                          |

See "The agents consent gate and its migration" below for the absent-flag rule
for agents, and "The skills selection gate and its migration" for skills —
both load-bearing halves.

**Why unsupported and source-managed cells are not gaps** — `unsupported` is
an upstream limit, while `source-managed` identifies editable input Ptah must
leave alone:

- **Claude agents are source-managed.** `{ws}/.claude/agents` is a SOURCE the
  user-layer mirror reads FROM. Writing generated agents back closes a
  source→target→source loop where every reconcile re-mirrors its own output;
  Ptah therefore never writes, manifests, or reaps it.
- **Codex commands.** Codex rejects project-scoped prompts; the prompt
  directory is home-only upstream (openai/codex#9848).
- **Copilot commands.** No documented project prompt directory
  (github/copilot-cli#2829).
- **Antigravity commands.** `agy`'s customization surface is Rules, Skills,
  Plugins, Hooks and MCP. There is no slash-command concept to target.
- **Antigravity agents.** `agy` documents no subagent format. A transformer
  would have to invent a layout the CLI does not read.
- **VS Code skills/commands/agents.** VS Code is an editor, not a CLI agent
  harness. It is a target here solely because `.vscode/mcp.json` is a real MCP
  surface the install RPC has always offered.

## Antigravity MCP: one file, two writers (TASK_2026_285)

`~/.gemini/config/mcp_config.json` is the only harness file written from OUTSIDE
this lib as well as inside it. The reconciler installs the USER's servers into
it; `AntigravityCliAdapter` (`cli-agent-runtime`) overwrites Ptah's OWN server
entry in it for the duration of a spawn and RESTORES what it found after `done`;
and `CodeExecutionMCP` (`vscode-lm-tools`) keeps that entry there persistently
while its HTTP server runs. Three writers, one key each — see the partition
table below.

`{ws}/.agents/mcp_config.json` — the Antigravity EDITOR's workspace config — is
written by `CodeExecutionMCP` alone and is not a harness file this lib
reconciles. See the § note under the matrix for why the CLI cannot use it.

This cell used to read `— unsupported`, justified as "user-installed servers are
not offered for `agy` by the install surface, so there is no intent to
reconcile". That was circular: they were not offered because `McpInstallTarget`
could not express them. `agy` reads a real MCP config file that Ptah was already
writing, so the only thing genuinely missing was the ability to say so.

**Both writers go through the same facet.** `createMcpFacet('antigravity')` owns
the path, the schema, the atomic write and the lock; the adapter calls
`facet.write` / `facet.remove` instead of its own read-modify-write. The
dependency direction is the allowed one — `cli-agent-runtime` → `harness-sync`,
never back — which is why the facet is exported from the barrel.

**The keys are partitioned, and neither writer may reap the other's.**

| Key                           | Owner              | Lifetime              | Who may remove it               |
| ----------------------------- | ------------------ | --------------------- | ------------------------------- |
| `ptah` (`PTAH_SPAWN_MCP_KEY`) | `CodeExecutionMCP` | while its server runs | `CodeExecutionMCP`, on `stop()` |
| a key in the manifest         | the reconciler     | until intent dropped  | the reconciler's removal sweep  |
| anything else                 | the user           | forever               | nobody here                     |

**`ptah` used to be adapter-owned and one spawn long. It is not any more.**
`CodeExecutionMCP` now keeps a PERSISTENT `ptah` entry in every detected CLI's
config for as long as its HTTP server is up, so that an `agy` (or `codex`)
session the USER starts has Ptah tools rather than only the ones Ptah spawns.
`AntigravityCliAdapter` still overwrites the key with its own run's port before
a spawn — its port and the persistent one differ only while a run is in flight —
but its cleanup now **RESTORES what the run found instead of deleting**. An
unconditional delete would silently revoke the persistent registration every
time a Ptah-spawned agent finished. Restoring needs no knowledge of the other
writer: absent means nobody owned the key, and removing it is exactly the old
behaviour.

Each half falls out of a rule that already existed, which is why this is a
partition rather than a special case. The reconciler only ever touches keys the
desired state NAMES or the manifest OWNS, and `ptah` is in neither — so it is
not written, not reaped, and not even reported (a `ptah` row in `harness doctor`
would be a finding nobody could clear, for a file Ptah wrote on purpose). The
adapter only ever addresses the single key `PTAH_SPAWN_MCP_KEY`. It no longer
deletes the `mcpServers` map when that map looks empty, which was safe only
while Ptah was its sole writer.

The one overlap is a user installing a server whose key is literally `ptah`.
That is the ordinary collision rule — a desired key an unowned entry occupies is
`foreign` and `blocked`, never overwritten.

### The lock deadline FAILS the mutation; it does not write unlocked (TASK_2026_332)

`acquireFileLock` retries with backoff until `maxWaitMs` (2 s for an MCP config,
short because one caller is a CLI SPAWN and a user waiting on `agy` must not pay
five seconds for somebody else's reconcile). It used to return an unheld handle
on expiry and `withFileLock` **ran the task anyway** — so two hosts contending
for longer than the deadline both proceeded unlocked and lost each other's key,
silently. That is the exact failure the section above describes, restored
through the one door the lock left open.

The bound itself is right: blocking forever on a stale lock is worse than a rare
lost update, which is why it exists. So the fix was the DECISION at expiry, not
a longer timeout. `withFileLock` now throws `FileLockTimeoutError`, naming the
file and the wait duration. Affordable because every caller already treats a
failed mutation as transient and retries on its own schedule — `applyMcpFacet`
records a `writeFailed` row that the next `mode: 'full'` pass re-attempts,
`AntigravityCliAdapter` documents its spawn-time write as non-fatal and the next
spawn rewrites it, and `CodeExecutionMCP` logs and keeps no ownership record so
a later call retries. What is traded away is liveness for ONE mutation under
real cross-process contention.

Two things deliberately did NOT change. **`acquireFileLock` still returns an
unheld handle** rather than throwing, because `acquireWorkspaceLock` builds on
it and the reconciler inspects `lock.acquired` to proceed degraded on purpose.
And **an uncreatable lock DIRECTORY is not a timeout** (`reason:
'no-lock-directory'`): nobody holds anything, and that directory is the one the
guarded file lives in, so the caller's own write is about to fail and report the
real permission problem — masking it with a lock error would make that two
errors for one cause. Pinned by `lock/file-lock.spec.ts`.

**Atomicity was not enough, so there is a lock.** `atomicWriteWithRetry`
guarantees no reader sees half a file; it guarantees nothing about two writers
that each READ, each edit their own key, and each rename their own copy over the
top. The second rename wins whole and the first key is gone — silently, with no
torn file and nothing in any health report. The workspace lock cannot cover this
one: the file is in `$HOME`, and two open workspaces hold two different
workspace locks over one shared config anyway. So `targets/mcp/mcp-config-lock.ts`
keys a lock by the CONFIG FILE, and every facet mutation — JSON and Codex TOML
alike — reads and writes inside it. The mechanism is `lock/file-lock.ts`,
extracted from `workspace-lock.ts`, which is now just the per-workspace policy
over it.

**The schema is `agy`'s, not the JSON dialect's.** Root key `mcpServers`, no
`type` discriminant, `{command,args,env}` for stdio — and a remote server keyed
**`serverUrl`**, not `url`. That is documented by the CLI itself, in
`~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/mcp_servers.md`,
and an entry written with `url` parses without an endpoint and silently never
connects. `JsonMcpFacet` takes a `urlKey` for exactly this; `jsonToConfig`
accepts both spellings unconditionally so a hand-written `agy` server still
reads back as a remote server. Transport inference is deliberately identical for
both spellings (the URL decides) — classifying every `serverUrl` as `sse` would
make an `http` install hash differently on read-back and be rewritten on every
pass.

**Codex and Antigravity share `{ws}/.agents/skills`.** Each keeps its own
manifest and declares the other a co-owner, so each accepts the other's
manifest as proof of Ptah ownership AND records its own entry for a path the
sibling wrote. Without the first half, whichever CLI was installed second would
find the directory full of files it could not prove it wrote and freeze on them
as foreign; without the second, its ownership would be borrowed and would
evaporate the moment the sibling left a partial reconcile.

## The agents consent gate and its migration (TASK_2026_286)

`buildAgents()` returns `[]` when the workspace has not consented, and agents
are manifest-owned, so an empty desired state is a REAP rather than a skip. That
is correct when a user turns an agent off — and it is exactly why the DEFAULT
cannot be `false`. A flag that defaulted off would make the first routine
reconcile after an upgrade delete every `.codex/agents/*.toml`,
`.github/agents/*.agent.md` and `.cursor/agents/*.md` Ptah had ever written, in
every existing workspace, silently, reported as an ordinary clean pass.

So an ABSENT flag is resolved from evidence, once, by `state/agent-sync-gate.ts`:

| `agentSyncEnabled` | Any per-target manifest owns an `agent` entry? | Result  |
| ------------------ | ---------------------------------------------- | ------- |
| `true`             | —                                              | `true`  |
| `false`            | —                                              | `false` |
| absent             | yes                                            | `true`  |
| absent             | no                                             | `false` |

**Prior propagation IS prior consent.** Those files exist because a previous
version of Ptah put them there and the user has been living with them; a
workspace with no agent entries in any manifest has nothing to lose and starts
gated. The resolved value is then PERSISTED, so the evidence walk runs once and
the answer cannot flip later just because a reap emptied the manifests.

Four properties worth not re-deriving:

- **Manifests are read for every id in `HARNESS_TARGET_IDS`**, not just the
  targets the current host registered. The evidence is on disk; a CLI host
  registering fewer targets than the extension did must not read the same
  workspace as un-propagated and gate it.
- **`verify()` resolves the gate but never persists it.** A derived decision is
  a write, and asking what state the harness is in must not change it — a badge
  that polls must not be able to record a consent decision for the user.
- **`persist()` never overwrites a recorded flag.** It is the migration step,
  not a way to revoke consent.
- **The gate is DEFAULTED into `HarnessReconcilerService`, not nullable**,
  unlike `HarnessGitignoreWriter`. An absent `.gitignore` writer means one less
  file is maintained; an absent gate would mean the facet propagates ungated in
  any host that forgot to wire it, which is the defect the gate exists to close.

The wizard is what opens it. `wizard:submit-selection` →
`propagateGeneratedAgents` calls `AgentSyncGate.enable(workspaceRoot)` BEFORE
`propagate()`, because the reconciler resolves the gate at the top of the pass:
granting afterwards would leave the agents that run just generated sitting in
the user layer until some later trigger fired. `enable` also records
`wizardCompletedAt`, which is the difference between "the user asked for this"
and "the migration inferred it".

`disabledAgentIds` is the per-agent half, and it is deliberately shaped exactly
like `disabledSkillIds`: same key (the source filename minus `.md`), same raw
membership test, so one saved config keys both without a second canonicalisation
rule to keep in step. It reaches the builder through `IHarnessSourceResolver`
like every other source fact — `HarnessPluginConfigReader` gained one optional
field and `PluginLoaderService` still satisfies it STRUCTURALLY, with no import
either way.

## The agent clone is keyed by WORKSPACE (TASK_2026_365)

`~/.ptah/user/{skills,commands}` are per-MACHINE stores of per-machine content:
a skill a user installed once is the same skill in every project. **Agents are
not.** The setup wizard tailors each one to a project's stack and architecture,
and names the result after the ROLE — `backend-developer`,
`frontend-developer` — so two projects produce two different files under one
name. `~/.ptah/user/agents` was flat, so they had one destination.

`mirrorAgents` is create-if-absent and could not overwrite. `reconcileFileClone`
could: when the source hash differs from the sidecar and the clone is
unmodified, it fast-forwards. So every activation, folder change, plugin toggle
and content download in workspace B rewrote the clone to B's agents, and the
next pass in A copied them into A's `.codex/agents` and `.github/agents`.

The measured signature, from `~/.ptah/user/agents/.history/frontend-developer/`:
two snapshots six seconds apart, one 15784 bytes (an Angular project) and one
17432 (a React one), plus a `figma-designer` history directory for an agent the
first project has never had. **The cost is not only churn.** The shared clone
held the React agent for those six seconds; a reconcile inside that window would
have written another project's agents into this repository's rival-CLI
directories.

`agentsRoot` is therefore `~/.ptah/user/agents/<workspace-key>`, and the key is
`userLayerAgentDirName(root)` in **`@ptah-extension/shared`** — `agent-generation`
writes the directory and this lib reads it, neither may import the other, and
`shared` is the one bridge (the same reason the origin-sidecar schema is there).
Four properties worth not re-deriving:

- **The hash is hand-rolled FNV-1a, not `node:crypto`.** `libs/shared` is
  imported by `libs/frontend/**`, so a `crypto` import in that barrel reaches the
  webview bundle.
- **Case folds on `win32` only**, exactly as `codexProjectTrusted` does and for
  its reason: separator collapses cannot invent a match between two real
  directories, and case folding can — on ext4 `/a/App` and `/a/app` are two
  workspaces.
- **`PluginConfigSourceResolver.resolve(ws)` applies the scope**, on the
  read-failure path as well as the success path, so a transient plugin-loader
  failure cannot hand the builder the unscoped base.
- **The reader and the writer must derive the key from the SAME root.**
  `resolveAgentMirrorSource` returns `resolveHarnessWorkspaceRoot(ws)` for
  exactly this. A host passing its raw folder would mirror into a directory the
  reconciler never reads, and agents are manifest-owned, so the reconciler would
  then reap every copy it has.

**The migration seeds; it never reaps.** On the first pass for a workspace, when
the scoped directory does not exist and the flat base holds clones,
`UserLayerMirrorService.seedLegacyAgents` copies them in. The mirror and
reconcile that follow converge that seed onto `{ws}/.claude/agents`, which is
the truth for that project; a workspace with no `.claude/agents` keeps exactly
what it had, now private to it. It copies `.md` clones and their sidecars and
NOT `.history` — that history is the interleaved record of every workspace on
the machine, so copying it into one project would assert an edit trail that
project never had. The flat originals are never deleted, on the quarantine
precedent.

### Consent gates the MIRROR now, not only the propagation

`buildAgents()` has been gated since TASK_2026_286, but every host passed
`agentSourceDir: {ws}/.claude/agents` unconditionally — a fact
`TASK_2026_286/context.md:18` recorded and did not fix. So any repository that
ships `.claude/agents` populated the machine-wide user layer on its first
activation, whoever wrote those files, and whether or not the setup wizard had
ever run. Each clone was written with `pluginId: null`, which the plugin-origin
gate never filters.

`resolveAgentMirrorSource(root, gate)` is the ONE implementation of that
decision, because there are THREE hosts and both of its rules fail silently when
one drifts. Two rules about the gate itself:

- **It reads `AgentSyncGate.resolve`, never `state.agentSyncEnabled` directly.**
  An absent flag is answered from manifest evidence, and the mirror runs BEFORE
  the reconcile that persists that answer — so reading the raw flag would skip
  the mirror on the first pass after an upgrade and hand the reconciler an empty
  desired state, which is a reap.
- **A `null` gate reads as CONSENTED.** An unresolvable token is a wiring gap,
  not a consent answer, and mirroring only ever creates clones. The reconciler
  resolves the gate itself before it can delete anything, so the unknown answer
  falls to the non-destructive side.

The gate is taken as `AgentConsentReader`, a one-method structural interface, so
a host or a spec does not construct a manifest store to answer it.

Pinned by `state/agent-workspace-scope.spec.ts` (both halves) and
`agent-generation`'s `user-layer/user-layer-agent-scope.spec.ts` (two workspaces
stay apart, and the seed).

## The skills selection gate and its migration (TASK_2026_316)

The `agents` gate above closes one hole; skills had a bigger one, because
`~/.ptah/user/skills` is one directory per MACHINE and the mirror is
create-if-absent — enable a plugin once, in one workspace, and its skills are
cloned there permanently, and `buildSkills` had only a denylist
(`disabledSkillIds`), never an allowlist. Fixed as three gates in
`buildSkills`, evaluated OUTERMOST FIRST, and all three a conjunction:

1. **The per-workspace selection** — `SkillSyncGate`
   (`state/skill-sync-gate.ts`). The only level that can speak for a skill with
   no plugin above it at all: a hand-authored `SKILL.md`, a promoted synth
   skill, a `skills.sh` install. `'all'` propagates everything the user layer
   offers; `'selected'` propagates only the recorded `enabledSkillSlugs`, keyed
   exactly like `disabledSkillIds` (raw directory name, no case folding).
2. **Plugin enablement, as an outer gate over the user-layer base** (Batch 1,
   `manifest/plugin-origin-gate.ts`). A user-layer clone carries its origin in
   the `.ptah-origin.json` sidecar `UserLayerMirrorService` writes beside it;
   `createPluginOriginGate` reads it before the clone is treated as desired
   state. Four rules, each a refusal to delete: no sidecar, or `pluginId:
null`, is never filtered — nothing above a user-authored clone can speak for
   it; an opt-out plugin (`ptah-harness-*`, `ptah-skillssh-*`) is filtered only
   by `disabledPluginIds`, because it is never in `enabledPluginIds` to begin
   with; a bundled or external plugin is filtered by absence from the
   overlay — and only when the overlay is KNOWN, because an unreadable overlay
   read literally would assert every plugin on the machine disabled and empty
   every skill directory it manages in one silent pass. This is also what
   closes the second defect found while fixing the first: unchecking a plugin
   had stopped removing its skills, because `disabledPluginIds` was tested only
   inside the overlay loop and the user-layer base loop had no plugin-id
   concept at all.
3. **`disabledSkillIds`**, unchanged — the per-skill toggle documented in
   `skill-toggles.md`.

**The migration is the load-bearing half, with more force than the agents
one.** Skills are the largest artifact family by count, so a mode that
defaulted to `'selected'` with an empty allowlist would not merely stop new
propagation — the first routine reconcile after the upgrade would delete every
`.claude/skills/*`, `.agents/skills/*`, `.github/skills/*` and
`.cursor/skills/*` Ptah had ever written, in every existing workspace,
silently, reported as an ordinary clean pass. So an ABSENT `skillSyncMode` is
never a bare `'selected'`, resolved by `SkillSyncGate.resolve` from the same
kind of evidence walk as `agentSyncEnabled`'s:

| `skillSyncMode` | Any per-target manifest owns a `skill` entry? | Result                        |
| --------------- | --------------------------------------------- | ----------------------------- |
| `'all'`         | —                                             | `'all'`                       |
| `'selected'`    | —                                             | `'selected'`                  |
| absent          | yes                                           | `'all'`                       |
| absent          | no                                            | `'selected'`, empty allowlist |

Prior propagation IS prior consent; a workspace with no skill entries has
nothing to lose and starts gated with nothing selected, which is the intended
behaviour for a genuinely new workspace (U2) and not a special case of the
migration. The resolved value is PERSISTED so the walk runs once — `verify()`
resolves the gate but never persists it, and `persist()` never overwrites a
recorded mode, exactly as `agentSyncEnabled`'s migration works and for the same
reason.

`select(cwd, slugs)` and `enableAll(cwd)` are the user-driven surface — unlike
`persist()`, both overwrite a recorded mode, because that is the difference
between the migration inferring an answer and the user actually giving one.
Reached from `harness:set-skill-selection` / `harness:get-skill-selection`
(RPC) and `ptah skill select [slug...] | --all` / `ptah skill selection` (CLI,
Batch 5) — neither resolves `SkillSyncGate` out of DI directly, which is what
keeps the extension, the CLI/TUI and the Marketplace badge on one
implementation of what a workspace propagates.

**The origin-sidecar schema and both opt-out prefixes
(`HARNESS_PLUGIN_ID_PREFIX`, `SKILLS_SH_PLUGIN_ID_PREFIX`) live in
`@ptah-extension/shared`, not `agent-generation` (Task 1.1 decision).**
`UserLayerMirrorService` (`agent-generation`) writes the sidecar and reaps
against it; this lib only reads it — and `harness-sync` must never import
`agent-generation`, the reconciler is a leaf and that lib is upstream of it.
The alternative was a second copy of the filename and the `pluginId` field, and
`ptah-harness-` was already spelled twice independently (here and in
`agent-sdk`'s `plugin-loader.service.ts`) before this task started — standing
evidence that copies of these constants drift rather than stay in step.
`shared` is the one place both libs may depend on, so the format moved there
instead of adding a third copy.

**Unselected slugs are not reported in `HarnessHealth` (Task 4.3 decision).**
The selection is applied when the desired state is BUILT, in `buildSkills`
above — an unselected skill never enters `expected`, `missing` or `foreign`,
because it never becomes a candidate in the first place. Reporting it as
anything would put a permanent amber count in front of a user for a state they
chose on purpose, with no action that clears it short of selecting the skill —
indistinguishable from a real gap. `disabledSkillIds` already sets this
precedent: a disabled skill isn't reported as `missing` either.

## The desired state is a function of the ROOT (TASK_2026_346)

`IHarnessSourceResolver.resolve(workspaceRoot?)` takes the root the pass is
FOR. `HarnessReconcilerService` passes it from `reconcile` (both modes) and
from `verify`, already normalized by `resolveHarnessWorkspaceRoot` — the same
value the lock, the manifests and the gates are keyed on. Nothing below the
reconciler entry point may ask a host "which folder is open".

**Why it is not optional in practice.** The default resolver reads
`PluginLoaderService`, which reads an `IStateStorage` that on Electron is a
PROXY delegating to the ACTIVE workspace. Active is the right scope for a
caller answering a click; it is the wrong scope for a caller reconciling a root
it was handed, and with two folders open the two are routinely different. The
captured sequence (`tmp/logs/log.log`): `workspace:addFolder property-hub`
(`:1109`) fires the folder-change pass for **qa3elhamor**, `workspace:switch`
(`:1122`) flips storage to **property-hub** before that pass reaches its source
resolve, and the pass then wrote 44 property-hub skill copies into qa3elhamor
(`:1225`, 11 per target across claude/codex/copilot/antigravity) and recorded
every one in qa3elhamor's manifests. Switching back reaped all 44 (`:1647`) —
correctly, because they are manifest-owned and the now-correct desired state
does not name them. Every tab switch tore down and re-materialised the other
folder's harness. The removal rules were never wrong; the state handed to them
described the wrong workspace.

**The reader half.** `HarnessPluginConfigReader`'s three methods take the same
optional root, and `PluginLoaderService` honours it through one private
`storageFor(root)`: no root → the injected storage (unchanged); a root with a
single-scope storage → the injected storage, because a one-workspace host has
one storage which IS the answer for every root; a root with a workspace-scoped
storage (`IWorkspaceScopedStateStorage`, probed structurally from
`platform-core`) → that root's own storage, or the DEFAULT EMPTY config when
the host has none registered for it. The `{ws}/.ptah/plugins` scan is scoped
the same way. A host wiring the reader through a lambda must forward the
argument; Electron's `phase-2-libraries.ts` is the one that has to.

**An unscoped reader is answered by FORWARDING, not by an empty state.**
Returning `empty` for a reader that cannot scope looks like the safe direction
and is not: an empty `overlayPluginPaths` drops every overlay-only skill
(skills.sh roots, workspace-scoped `ptah-harness-*`) out of the desired state,
and skills are manifest-owned, so the "safe" fallback REAPS them. Forwarding a
root a reader ignores leaves that reader exactly as it behaved before, which is
the only fallback here that removes nothing. Absence of `overlayPluginPathsKnown`
is still the non-reaping signal for the separate question of the plugin FILTER;
the two are not interchangeable.

## Boundaries

**Belongs here**:

- Desired-state construction from the user layer + plugin overlay + disabled ids
  - recorded MCP intents
- The per-workspace consent gate for `agents`, and its evidence-based migration
- The single managed-manifest format, its atomic store, and the workspace lock
- `IHarnessTarget` and its six implementations
- The copy engine (recursive copy, Windows retry, `unlink`-not-`rm` removal)
- The per-CLI markdown rewrites (`skill-transform.ts`) and agent transformers
- The per-target MCP config-file adapters (`IHarnessMcpFacet`)
- `HarnessHealth` production

**Does NOT belong**:

- Deciding WHAT a skill is or mirroring plugin sources into the user layer —
  that is `agent-generation`'s `UserLayerMirrorService`
- Reading plugin config from disk — the lib takes an `IHarnessSourceResolver`
- Probing for installed CLIs — the lib takes an `IHarnessCliDetector`, adapted
  from `cli-agent-runtime`'s `CliDetectionService` in host wiring. That
  direction is mandatory: `cli-agent-runtime` depends on THIS lib for its MCP
  install surface, so this lib must never depend back on it.
- Deciding to pass Ptah's OWN MCP server to a spawned CLI — the adapters in
  `cli-agent-runtime/cli-adapters/` do that at spawn time, and this lib
  reconciles USER-installed MCP entries only. One exception, and it is about
  MECHANISM not policy: `AntigravityCliAdapter` writes its ephemeral entry into
  a file this lib also owns, so it borrows this lib's facet to do it rather than
  becoming a second writer with its own format. See the two-writer section
  below.
- RPC surface (`rpc-handlers`), platform specifics (`platform-*`)
- Anything that removes artifacts because a host is shutting down

## Public API

`HarnessReconcilerService` (`reconcile`, `verify`, `remove`), `HarnessPropagationService`
(`propagate`), `HarnessPreflightService` (`ensure`), `HarnessManifestBuilder`,
`ManagedManifestStore`, `ClaudeTarget`, `WorkspaceHarnessTarget`,
`McpIntentStore`, `HarnessGitignoreWriter`, `HarnessStateStore`, `AgentSyncGate`,
`resolveAgentMirrorSource` (the ONE agent-mirror decision all three hosts make —
scope the root, gate on consent; see TASK_2026_365 below).
Ports: `IHarnessTarget`, `IHarnessSourceResolver` (`resolve(workspaceRoot?)` —
see "The desired state is a function of the root" below), `IHarnessCliDetector`,
`IHarnessMcpFacet`, `IHarnessAgentTransformer`, `IUserLayerRefresher`,
`IHarnessContentGate`.

**Callers use `HarnessPropagationService`, not the reconciler.** `reconcile` is
the primitive; `propagate` is the operation. It refreshes the user layer and
THEN reconciles, and every emit site in the codebase goes through it — the
repropagation ports, the harness/plugin/wizard RPC handlers, the CLI boot pass.
Calling `reconcile` directly from a trigger is a bug in waiting, because the
desired state IS `~/.ptah/user`: a trigger that changed an upstream source has
changed nothing the reconciler can see, so a bare reconcile propagates the
PREVIOUS state and reports a clean pass. The two exceptions are host activation
(which already mirrors, by hand, in the right order) and `plugins:save-config`
(which passes `skipUserLayerRefresh` because enabling a plugin changes the
FILTER, never a source's contents).
Targets: `createCodexTarget`, `createCopilotTarget`, `createCursorTarget`,
`createAntigravityTarget`, `createVscodeMcpTarget`, `createRivalTargets`.
Transforms: `transformSkillMarkdown`, `CodexAgentTransformer`,
`CopilotAgentTransformer`, `CursorAgentTransformer`, `transformAgentContent`.
MCP: `createMcpFacet`, `createAllMcpFacets`, `hashMcpConfig`, `mcpEntryKey`,
`PTAH_SPAWN_MCP_KEY`, `withMcpConfigLock`, `codexProjectTrusted`.
Workspace: `resolveHarnessWorkspaceRoot`.
Lock: `acquireWorkspaceLock`, `serializePerWorkspace`, `acquireFileLock`,
`withFileLock`, `serializeByKey`. Hashing: `hashDir`, `hashFile`, `hashContent`
(the first two are ASYNC and take a `ContentHashOptions` — there is deliberately
no synchronous variant, see "Preflight semantics" below). Cancellation:
`HarnessPassAbortedError`, `isPassAbortedError`. Rules: `isReservedSlug`,
`canonicalSlug`.
Wiring: `createPluginConfigSourceResolver`, `createStaticSourceResolver`,
`ALL_HARNESS_TARGET_FACTORIES`, `registerHarnessSyncServices`,
`HARNESS_SYNC_TOKENS`.

Wire types (`HarnessHealth`, `HarnessTargetHealth`, `HarnessTargetId`,
`HARNESS_TARGET_IDS`, `HarnessCollision`) live in `@ptah-extension/shared`
because the `harness:health` RPC and the Marketplace badge cross into the
webview. So do **`summarizeHarnessHealth()`** and **`blockedTargetPaths()`**
(the `missing ∩ foreign` derivation — see the blocked-path condition below).
`summarizeHarnessHealth()` is a pure reducer from a report
to `{ level: 'ok' | 'degraded' | 'error' | 'unknown', …counts }`. It is in
`shared` and not here because three consumers must never disagree about what
"healthy" means: the Marketplace badge, `ptah harness doctor`'s exit code, and
the `harness:healthChanged` push. Its rule: any `writeFailed` is `error`; any
`missing` or `sources !== 'ok'` is `degraded`; undetected targets are excluded
from every count, because an uninstalled Codex is not a gap. Collisions and
foreign paths are counted but deliberately do NOT raise the level — a collision
is a source-authoring problem and a foreign path is a file Ptah is correctly
refusing to touch, and treating either as a malfunction would leave a
permanently amber badge nobody can clear.

## Internal Structure

- `manifest/harness-manifest.builder.ts` — desired state; user layer is the
  base, plugin dirs overlay additively, user layer wins. Also derives
  `sourceRoots`, the directories a legacy junction is allowed to point into
- `manifest/slug-rules.ts` — Windows reserved names + case-collision canon
- `manifest-store/managed-manifest.ts` — `{ws}/.ptah/harness/<target>.manifest.json`
- `fs/windows-retry.ts` — the ONE retry rule (EBUSY/EPERM/EACCES/ENOTEMPTY, 3
  attempts, backoff), in an async flavour for the copy engine and a synchronous
  one for the persistence writers
- `fs/atomic-write.ts` — `atomicWriteWithRetry`: temp + rename + retry. Every
  file this lib OWNS lands through it
- `targets/link-ownership.ts` — is a symlink at a desired path Ptah's leftover
  junction, or the user's own link?
- `lock/file-lock.ts` — the lock MECHANISM: `O_EXCL` create, stale reclaim,
  in-process queue, and "FAIL past the deadline" (see below)
- `lock/workspace-lock.ts` — the per-workspace POLICY over it:
  `{ws}/.ptah/harness/.lock`
- `targets/harness-target.port.ts` — `detect → preflightKeys → plan → apply → verify`
- `targets/claude-target.ts` — `.claude/skills/**`, `.claude/commands/*.md`, `.mcp.json`
- `targets/workspace-target.ts` — the one engine behind all five rival targets
- `targets/rival-targets.ts` — the five target CONFIGURATIONS (see the matrix above)
- `targets/copy-engine.ts` — copy + Windows EBUSY/EPERM retry + transforming copy
- `targets/skill-transform.ts` — the three markdown rewrites a rival CLI needs
- `targets/transformers/` — per-CLI agent format + the shared `transform-rules`
- `targets/mcp/` — `IHarnessMcpFacet`, the JSON and Codex-TOML adapters, the
  facet registry (one definition per config file), the facet planner, and
  `mcp-config-lock.ts` (the per-config-file lock every mutation holds)
- `workspace/workspace-root.ts` — `resolveHarnessWorkspaceRoot` (E14)
- `health/harness-health.ts` — the ONE plan → `HarnessTargetHealth` reduction,
  in two flavours: `plannedTargetHealth` (no apply happened) and
  `appliedTargetHealth` (plan + apply result). The `missing ∩ foreign`
  derivation is NOT here — see `blockedTargetPaths` below
- `gitignore/gitignore-writer.ts` — the managed `.gitignore` block (E23)
- `gitignore/harness-state-store.ts` — `{ws}/.ptah/harness/state.json`, the
  per-workspace memory of decisions the USER made (as opposed to the manifests
  next to it, which record what PTAH wrote)
- `state/agent-sync-gate.ts` — the `agents` consent gate over that same file,
  the absent-flag migration that reads the manifests for evidence, and
  `resolveAgentMirrorSource` (the host-facing agent-mirror decision)
- `reconciler/harness-reconciler.service.ts` — the facade
- `propagation/harness-propagation.service.ts` — refresh + reconcile; the ONE
  call an emit site makes
- `preflight/harness-preflight.service.ts` — the bounded session-start check,
  plus `IHarnessContentGate`
- `sources/` — the `IHarnessSourceResolver`, `IHarnessCliDetector` and
  `IUserLayerRefresher` ports, the default plugin-config adapter, and the MCP
  intent store

### How a session start reaches this lib

`agent-sdk` must never import `harness-sync`, so the session path declares what
it needs instead: `HARNESS_PREFLIGHT_TOKEN` + `IHarnessPreflight` live in
`agent-sdk/src/lib/harness/harness-preflight.port.ts`, and
`HarnessPreflightService` satisfies that shape STRUCTURALLY, with no import
either way. Each host binds them in one line:

```ts
container.register(HARNESS_PREFLIGHT_TOKEN, {
  useToken: HARNESS_SYNC_TOKENS.PREFLIGHT,
});
```

Two consumers inject it optionally: `SessionQueryExecutor` (every interactive,
gateway and resumed SDK session) and `AgentProcessManager.doSpawn` (every rival
CLI). Both guard the call in a `try/catch` even though the port promises never
to throw — they sit inside blocks whose failure path aborts a session.

Three properties make it safe on EVERY session start, and all three are pinned
by `preflight/harness-preflight.service.spec.ts`: it races a timer and CANCELS
the losing pass (see "Preflight semantics" below — this was "lets it finish in
the background" until TASK_2026_323); it throttles per workspace root
(`minIntervalMs`, 60 s) so the skill-synthesis drain's dozens of nightly
one-shot sessions do not each pay for a walk of `~/.ptah/user`; and it resolves
the caller's cwd to the workspace root first (E14).

## What triggers a pass

Every row calls `HarnessPropagationService.propagate` unless noted. Nothing in
this table is a teardown — there is no trigger that removes artifacts because a
host is shutting down.

| Trigger                      | Where it fires                                                                                                                          | Mode        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Host activation              | `phase-2-libraries.ts` (VS Code, Electron), `bootstrap/harness-boot.ts` (CLI/TUI) — after `ensureContent()` is AWAITED, then the mirror | `full`      |
| Workspace folder change      | `propagateHarness` in each host's `plugin-activation.ts`                                                                                | `full`      |
| Content download completed   | the download callback in each host's `wire-runtime.ts`                                                                                  | `full`      |
| Session start                | `SessionQueryExecutor` + `AgentProcessManager.doSpawn`, via `HarnessPreflightService`                                                   | `preflight` |
| Plugin enable/disable        | `plugins:save-config` — passes `skipUserLayerRefresh`, because a toggle changes the FILTER and not a source's contents                  | `full`      |
| Plugin install/uninstall     | `plugins:install-external`, `plugins:uninstall-external`                                                                                | `full`      |
| Skill promotion / demotion   | `SkillPromotionService` → repropagation port                                                                                            | `full`      |
| Enhancement apply / revert   | `SkillEnhancerService`                                                                                                                  | `full`      |
| Harness-builder create/apply | `harness:create-skill`, `harness:apply`                                                                                                 | `full`      |
| Wizard submit                | `wizard:submit-selection` — GRANTS `agentSyncEnabled` first, then propagates                                                            | `full`      |
| Per-agent disable            | `plugins:save-config` (`disabledAgentIds`) — same path and same mode as a skill or plugin toggle                                        | `full`      |
| Manual repair                | `harness:reconcile` RPC, `ptah harness doctor --fix`                                                                                    | `full`      |
| Manual inspection            | `harness:health` RPC, `ptah harness doctor`                                                                                             | `preflight` |
| Uninstall                    | `harness:remove` RPC, `ptah harness remove --yes` → `reconciler.remove`                                                                 | —           |

### Preflight semantics, and its blind spot

Preflight compares desired SOURCE hashes against the manifest and stats each
owned path. It does not re-hash target directories. Three properties make that
safe to run on every single session start, all pinned by
`preflight/harness-preflight.service.spec.ts`: it races a timer and CANCELS the
losing pass; it throttles per workspace root (60 s) so the skill-synthesis
drain's nightly one-shot sessions do not each pay for a walk of `~/.ptah/user`;
and it resolves the caller's cwd to the workspace root first (E14).

#### Cancellation, and the commit point that makes it safe (TASK_2026_323 / B8)

**The losing pass used to be left running, and that was the bug.** The stated
reason — "it holds the workspace lock and is mid-copy, so aborting it would
leave a target half populated with no manifest entry for what landed" — is true
of the APPLY phase and false of everything before it. A preflight spends almost
all of its time hashing: `HarnessManifestBuilder.build` walks `~/.ptah/user` and
digests every byte of every skill, and then each detected target's `plan` (and,
on the no-drift path, its `verify`, which IS `plan`) re-hashes every managed copy
on disk. That is one source walk plus up to six target walks, per session start
and per rival-CLI agent spawn, and it was synchronous — `readdirSync` +
`lstatSync` + `readFileSync` + sha256, recursive to depth 20. In Electron the
backend shares its event loop with every `BrowserWindow`, so a walk that outlives
its session is measured in frozen UI. Three chat tabs with CLI agents is the
reported symptom.

Two mechanisms, in `abort/pass-abort.ts`:

- **Async and yielding.** `hash/content-hash.ts` is `fs/promises` throughout,
  yields via `setImmediate` once per directory and every 64 files, and takes a
  `ContentHashOptions.signal`. There is deliberately **no synchronous variant
  left** — a second spelling of this walk is how the blocking one grows back.
  The one-level `readdirSync` listings in `HarnessManifestBuilder.listSkillSlugs`
  / `listMarkdownFiles` are the deliberate exception: a handful of stat calls per
  candidate whose cost does not grow with file size.
- **A per-target commit point.** `HarnessReconcilerService.reconcileTarget` mints
  a `HarnessPassSignal` per target and calls `commit()` immediately before the
  first manifest write. Before it, an abort abandons the target and nothing has
  been written; after it, the signal is detached and that target finishes
  regardless. It is **per target, not per pass**, because each target persists
  its own manifest right after its own apply — a pass-wide commit would let one
  target needing one write make the other five uncancellable, which is most of
  the hashing being cancelled. Pinned by
  `reconciler/harness-reconciler.cancellation.spec.ts`.

Three consequences worth not re-deriving:

- **An aborted pass records nothing** — no `lastHealth`, no `health` event, no
  manifest — so nothing downstream can mistake it for a completed one.
  `HarnessPassAbortedError` is the ONE error `reconcileTarget` re-throws instead
  of converting into a `writeFailed` row; reporting a session's expired budget
  as a target malfunction would turn the badge red for a non-problem.
- **The 60 s throttle stamp is deliberately KEPT on an aborted pass.** Clearing
  it would make a workspace too large to hash inside the budget redo the whole
  walk on the very next session start and abort again, forever. The next pass
  past the throttle re-runs it, and every `mode: 'full'` trigger is unbounded
  anyway.
- **The gate migrations (`agentSyncEnabled`, `skillSyncMode`) do NOT commit the
  pass**, even though they write `state.json`. Each is one atomic write of a
  decision derived from manifest evidence a cancelled pass cannot have changed,
  so "state.json written, pass abandoned" is consistent and the next pass
  re-derives the same answer. Committing there would make the first preflight in
  every new workspace uncancellable — precisely the workspace with the most
  hashing to do.

**The blind spot is deliberate and worth knowing.** Because preflight never
re-hashes a target, a hand-edit to a managed COPY is invisible to it. The copy
is corrected by the next `mode: 'full'` pass, which is every activation. MCP
keys are fragments inside a shared config file with no path to stat, so they are
hash-compared only. `.gitignore` maintenance is likewise `full`-only: preflight
is deliberately blind to whether a target is DETECTED, so it could not name the
right directories even if it wanted to.

## The `.gitignore` managed block (E23)

Every artifact this lib writes is a derived copy of `~/.ptah/user`. Committing
one is committing a build output. At the end of every `full` pass the reconciler
writes a block into `{ws}/.gitignore`, fenced by `# ptah:harness:begin` /
`# ptah:harness:end`, listing the directories of DETECTED targets only.

Four rules, and the reason for each:

- **Everything outside the markers is preserved byte-for-byte.** The block is
  spliced by index rather than by splitting and re-joining lines, so a file with
  mixed line endings or no trailing newline comes back unchanged.
- **A path any existing rule already talks about is never restated.**
  `git check-ignore` needs a git binary this lib does not have, so the test is a
  path-prefix comparison, in BOTH directions, against the rules in the file
  MINUS our own block. The subtraction is load-bearing: without it the second
  pass finds every pattern "already ignored" (by us) and empties the block the
  first pass wrote — and now that our own line COVERS a candidate rather than
  merely equalling it, the result would oscillate rather than settle.
  The downward direction (`.claude/*` covers `.claude/commands/`) saves a
  redundant line. The **upward** direction is the one that matters: a rule
  living inside the candidate — `!.claude/skills/video-showcase/**` — means
  that subtree is managed deliberately, and appending a blanket
  `.claude/skills/` after it re-ignores the whole directory, because git cannot
  re-include a file whose parent is excluded. This repo's own `.gitignore` is
  exactly that shape, and the original literal line match wrote the blanket
  rule into it. Leading `!`, `/` and `**/`, and trailing `/`, `/*` and `/**`,
  are all normalized away first. Non-anchored rules that match at any depth
  (`skills/`) still under-match, which costs a redundant line and never a
  dropped file.
- **A deleted block stays deleted.** Absence alone cannot distinguish "never
  written" from "written and removed", so `gitignoreBlockWritten` and
  `gitignoreBlockRemovedByUser` are recorded in `state.json`. Toggling
  `harness.manageGitignore` is the documented undo, and it clears BOTH flags —
  clearing only the deletion would let the very next pass re-derive it from the
  surviving `gitignoreBlockWritten`, and the toggle would do nothing at all.
- **MCP config files are never ignored.** `.mcp.json`, `.cursor/mcp.json`,
  `.vscode/mcp.json` and `~/.codex/config.toml` are configuration teams commit
  on purpose, which happen to carry a Ptah-owned fragment. Only whole
  directories of skill/command/agent copies are listed. `IHarnessTarget.managedDirs()`
  is what each target declares, and no target's MCP facet contributes to it.

`.claude/agents` is absent because it is `source-managed` in the matrix: it is
an editable SOURCE holding files the user authored, so Ptah must not write,
manifest, reap, or ignore it.

## Settings

Both are read by the HOST and handed down as a lambda. This lib does not depend
on `platform-core` and is not going to start; the default for each lives here,
once, so two hosts cannot drift.

| Key                          | Default                               | Read by                               | Consumed by                                |
| ---------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------------ |
| `harness.preflightTimeoutMs` | `DEFAULT_PREFLIGHT_TIMEOUT_MS` (1500) | `readPreflightTimeoutMs` in each host | `HarnessPreflightDeps.readTimeoutMs`       |
| `harness.manageGitignore`    | `DEFAULT_MANAGE_GITIGNORE` (true)     | `readManageGitignore` in each host    | `HarnessGitignoreDeps.readManageGitignore` |

**Neither gate for the `agents` facet is a setting, deliberately, and the same
is true of `skillSyncMode`.** `agentSyncEnabled` and `skillSyncMode` are
per-WORKSPACE decisions the user made, so both live in
`{ws}/.ptah/harness/state.json` beside the `.gitignore` decisions rather than in
`~/.ptah/settings.json` — a user-global "sync agents" (or "sync skills") toggle
would either propagate into every project on the machine or silently mean
nothing in most of them. For skills that IS the reported bug, restated as a
setting instead of a mechanism. `disabledAgentIds` lives in the workspace
plugin config with `disabledSkillIds` and `disabledPluginIds`, for the same
reason those do. Consequently none of these is read by a host or handed down as
a lambda.

Both settings above are declared in `platform-core`'s `FILE_BASED_SETTINGS_KEYS` and read with
**section `'ptah'` and a DOTTED key**, not section `'harness'`. Only the `'ptah'`
section routes to `~/.ptah/settings.json`; the original readers used section
`'harness'`, which fell through to `vscode.workspace.getConfiguration('harness')`
— a section no `contributes.configuration` declares — so reads returned
`undefined` and writes were discarded with no error. Neither key has an entry in
`FILE_BASED_SETTINGS_DEFAULTS`, deliberately: an unset key reads as `undefined`,
which every reader already spells "use the lib default", and restating the
default there would be the second copy that drifts.

## Health semantics — the one classification

**`verify()` IS `plan()` plus `plannedTargetHealth()`.** Not a second walk with
its own rules. A target that re-derives classification in `verify` is the defect
this section exists to prevent: `harness doctor --fix` reported "Harness in sync
across 5 targets" and exited 0, and `harness doctor` over the untouched tree one
second later reported "23 missing across 5 targets" and exited 1 — because
`plan` called an unowned desired path `foreign` and counted no gap while
`verify` called the same path `missing` and counted no refusal, and neither ever
converged. `plan()` never writes, so calling it from `verify()` costs the same
hashing the second walk did and makes the two answers one answer by
construction.

Four terms, and each answers a different question:

| Term      | Question                        | Rule                                                                                                                      |
| --------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `found`   | is it installed?                | desired, owned, hashes match — `plan.unchanged`                                                                           |
| `missing` | is the harness whole?           | **desired but not owned on disk, REGARDLESS OF WHY** — planned writes (minus the ones that succeeded) plus `plan.blocked` |
| `foreign` | what is Ptah refusing to touch? | exists, unowned, and either occupies a desired path or sits undesired in a managed directory                              |
| `adopted` | what did Ptah take over?        | unowned, PROVEN ours, overwritten with current output                                                                     |

`blocked` — a desired path an unowned file occupies — is a subset of `foreign`
and is counted in `missing` too. Reporting it in only one place is what let the
two code paths differ; reporting it in both is what makes them agree. `.claude/skills/orchestration`
written by the user is a refusal AND a gap, and a user needs to be told both.

**A key in an MCP config file that Ptah does not want is not reported at all.**
Only a COLLISION is — the user already has a server under a key the desired
state asks for. `.vscode/mcp.json` holding four servers a user installed by hand
is an ordinary config file, and listing them opened `ptah harness doctor` with
four findings nobody could action.

### `missing` with `writeFailed: 0` — the blocked-path condition (TASK_2026_306)

A steady-state pass can report a permanent shortfall and a perfect write record
at the same time. That is not a contradiction and it is not a bug:

```
[WARN] [harness-sync] Reconcile finished with gaps: … missing=13, foreign=19, writeFailed=0
```

`tmp/logs/coldstart-306.log:844`, a real Electron cold start, twice in one boot
with identical counts — the signature of a CONVERGED state, not a stuck retry.

**`writeFailed: 0` was never evidence that those writes succeeded.** A blocked
path is filtered out BEFORE `plan.writes` is built: `targets/claude-target.ts:189-194`
does `scanned.push(relPath); continue;` on a `foreign` outcome, and
`workspace-target.ts:164-166` and `targets/mcp/mcp-facet-planner.ts:107-108` do
the same. Nothing was ever enqueued, so the failure counter is structurally
incapable of ever counting one. The thirteen are REFUSALS — Ptah declining to
overwrite a file it cannot prove it wrote (E9) — reported as `missing` because
the artifact genuinely is not installed.

The condition is made legible by a second log line, emitted from
`HarnessReconcilerService.logBlocked` only when the set is non-empty, naming
every blocked path, its per-path reason, and the one user action that clears it
(**move** the occupant aside — never delete it — then re-run
`ptah harness doctor --fix`). That action also names the Dashboard home's
**"Your harness is short"** card, because a log line cannot be clicked and the
card is where the same list can be read without a terminal. The card is named
as a place to READ, and it carries exactly ONE control: a route into the
consent dialog (TASK_2026_306 Batch 9 / Task 11.2). The card itself still
performs no repair and captures no consent — the per-path checkboxes live in
the dialog, they arrive with nothing ticked, and `harness:repairBlocked` is
sent only the paths the user actually ticked. The card had no control at all
until the dialog existed, on the rule that a button opening nothing is worse
than no button. The summary line above it is unchanged, and `summarizeHarnessHealth` still reads
`degraded` — the harness really is incomplete. Nothing about this closes the
gap; it stops spelling a refusal as a gap of unknown cause.

**The WARN is emitted once per SET, not once per pass (TASK_2026_346).** `full`
turned out not to be rare: activation, the content-download callback, every
workspace-folder change and every plugin toggle are all `full`, and one captured
Electron session emitted the identical twelve-path object five times
(`tmp/logs/log.log:1286, 1290, 1315, 1824, 2154`). A blocked set is a CONVERGED
steady state, so a repetition carries no news. `logBlocked` therefore remembers
the set per workspace root — sorted `target|relPath|reason`, so target
registration order cannot read as a change — and WARNs only on first sight or a
real change. An unchanged set leaves `debug` "Blocked set unchanged since the
last full pass"; a set that empties leaves "Blocked set is now empty", because
otherwise the last thing the log said about a since-repaired workspace would be
that twelve paths were blocked. The memory is per PROCESS and deliberately not
persisted. Keyed per root so a folder switch is not read as a change in either
folder.

**`blocked` is DERIVED, never transmitted, and the derivation lives in
`@ptah-extension/shared`.** `blockedTargetPaths()` sits in
`shared/.../harness-sync.types.ts` beside `summarizeHarnessHealth`, for that
function's exact reason: more than one consumer reads it and they must never
disagree. This lib's reconcile log is one consumer and the webview health card
is another, and a frontend lib cannot import a backend lib — so a copy here
would have forced the card to write a second intersection, which is the whole
failure mode being avoided. It is `missing ∩ foreign` over the existing payload,
which is exactly `plan.blocked` because every planner pushes into both lists in
one step and a desired path is either written or blocked, never both. There is
no `blocked` wire field and there should not be one: adding it would be a second
producer of a set the consumers already agree on. Import the function — the
reconcile log, `ptah harness doctor` and the health card must not each grow
their own intersection.

**Do NOT "fix" this by excluding `blocked` from `missing`.** That is the
documented non-converging regression: `harness doctor --fix` reports "in sync"
and exits 0 while `harness doctor` over the identical untouched tree reports the
same paths as gaps and exits 1, forever. See the four-term table above.

#### The 13 are of UNKNOWN provenance — `SkillJunctionService` did not write them

The obvious hypothesis is wrong, and it has already cost one investigation. The
premise "these are Ptah's own orphaned copies, unadoptable only because
`.claude/skills` never got a `.ptah-managed.json` sidecar" is **false**. Three
independent facts, each sufficient alone:

1. **`SkillJunctionService` LINKED skills and only COPIED commands.** The one
   filesystem write for a skill was `createJunction(sourcePath, linkPath)` — no
   `cp -r`, no fallback branch, no "if the junction fails, copy instead". A real
   directory is not a possible output of that function.
   `git e107e6f89^:libs/backend/agent-sdk/src/lib/helpers/skill-junction.service.ts:304-356`
2. **It refused to touch occupied paths**, logging
   `Skipping ${skillName}: real directory exists (likely SDK-created)`. The
   legacy code already suspected non-Ptah provenance and deferred to it.
   `git e107e6f89^:.../skill-junction.service.ts:336-343`
3. **Even a surviving junction would not be blocked today.**
   `targets/claude-target.ts:480-486` migrates one whose target resolves inside a
   declared source root, and `~/.ptah/plugins` / `~/.ptah/skills` are declared
   (`sources/plugin-config-source-resolver.ts:55`).

The asymmetry was correct design, not an accident: a link is self-identifying,
so only the copied COMMANDS needed an out-of-band ownership record. That is why
the sidecar story explains `.claude/commands` and explains nothing about the 13
skill directories.

At least three non-Ptah candidates fit and the evidence does not discriminate
between them: the Claude Code SDK itself; the pre-TASK_2026_288
`npx skills add --agent claude-code` path, which wrote straight into
`{ws}/.claude/skills`
(`libs/backend/rpc-handlers/src/lib/harness/io/harness-skill-install.service.ts:17-25`);
or the user, by hand. **Nothing shows any of them is Ptah's.**

Consequently **content matching is not a valid ownership proof here** and must
not be added as one. A content match proves the _skill_ is the same skill, not
that _Ptah wrote this directory_ — and both non-Ptah install paths produce
matching content by construction, so the heuristic would be maximally confident
exactly where it is least entitled to be. Consent is the only ownership proof
available, which is why the planned repair is gated on it.

The reconcile log still states the manual remedy, and it is still the right one
for a user who does not want the repair: **move** the occupant aside — not
delete it — then re-run `ptah harness doctor --fix`. Move is reversible and
delete is not, and `--fix` writes Ptah's copy into whatever gap the move leaves.

##### The wording is guarded by an ALLOWLIST, in `shared` (TASK_2026_309)

**SIX** surfaces say how a blocked path gets cleared — this lib's reconcile
WARN, the Marketplace popover, the Dashboard card, the repair dialog,
`HarnessHealthStore`'s repair-failure message, and
**`HarnessRepairPathResult.reason`** — and each must say MOVE. The guard used
to be a DENYLIST of eight regexes, and only two surfaces carried even that:
"purge", "wipe", "drop", "nuke", "clear out" and "get rid of" all passed it,
and "remove the occupant" would have shipped on the others with a green suite.
It is now an exact-match allowlist in
`libs/shared/src/lib/types/harness-blocked-wording.ts`
(`HARNESS_BLOCKED_APPROVED_ACTIONS`, `HARNESS_BLOCKED_APPROVED_PROSE`,
`HARNESS_REPAIR_REASONS`, `harnessBlockedWordingViolations`), which is `shared`
for `summarizeHarnessHealth`'s exact reason: a frontend lib cannot import this
one, and private copies of the sentence is how the wordings drifted apart.

**`reason` is PROSE, not data, and that is what hid it.** Every value
`HarnessBlockedRepairService` puts in that field (`blocked-repair.service.ts`
:230, :318, :334, :399, :406) is a Ptah-authored sentence, rendered
unconditionally at `harness-repair-dialog.component.ts:276-280`. The first
version of the guard never saw one, because the only `reason` any spec
exercised was an invented fixture passed as `data` — and `data` is struck
before the residue is judged. So the five literals are on the allowlist and
pinned from BOTH sides: `blocked-repair.service.spec.ts` asserts the service
emits them, and `harness-repair-dialog.spec.ts` renders them and asserts the
dialog stays clean. Neither half is sufficient alone. The two templates
(`move-failed`, `restore-failed`) approve only the fixed HEAD — the tail is
`describeError(error)`, which is the OS talking.

**Brittleness is the feature.** Any rewording of these strings — the action,
the WARN's `note`, either per-path `reason`, a repair `reason`, a button label
or an outcome line — fails its surface spec, so the new wording gets
re-approved by a human editing the allowlist rather than re-scanned by a regex
it happens to slip past. Adding a legitimate phrasing means editing
`HARNESS_BLOCKED_RECONCILE_STEPS`, `HARNESS_REPAIR_REASONS` or
`HARNESS_BLOCKED_APPROVED_PROSE`; there is no other door.

**Two denylists survive underneath it, and both are sound in that position
only.** `containsDestructiveVerb` runs on the residue AFTER the approved
sentences are struck, so it can only ever ADD a failure and can never grant
permission — which is what makes it safe and is exactly what the guard it
replaced was not. It exists because the residue rule needs four consecutive
words (below that, "Claude Code" and "13 blocked paths" would each need
approving), so a two-word button label like "Delete these" is structurally
invisible to it. The same function is turned on the ALLOWLIST itself, so a
destructive verb cannot become approved wording by being typed into that file
— the one path the two-sided pin cannot close on its own. `read it before you
discard anything` is the single sanctioned exemption.

#### Consent-gated repair + the quarantine convention — BACKEND SHIPPED (Batch 8), consent UI PLANNED (Batch 9)

**The repair is real code.** `HarnessBlockedRepairService`
(`lib/repair/blocked-repair.service.ts`) is the repair; the convention it writes
into is `lib/quarantine/quarantine.ts`. Decided by the user on 2026-08-22
(TASK_2026_306 / U1–U4). **The consent DIALOG does not exist yet** — see the
Consent row below. Every other row in this table describes shipped behaviour.

| Rule     | Value                                                                                                                                                                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Location | `.claude/skills/.ptah-quarantine/<name>-<timestamp>` — alongside the occupant, so the move is same-volume. Not `~/.ptah/` (a workspace on `D:` and a home on `C:` is the common Windows case), not the recycle bin (opaque)                                                                                               |
| Naming   | UTC compact to the MILLISECOND (`alpha-20260823T141530123`), with a `-2`, `-3` … suffix for a residual collision. The timestamp is what a human reads to find their directory, so a collision suffixes rather than re-rolls                                                                                               |
| Scanning | **Never scanned.** `isQuarantineEntry` is called from `ClaudeTarget.scanTargetDirs` and `WorkspaceHarnessTarget.scanForeignDirs`, and `QUARANTINE_DIR_NAME` is in `IGNORED_ENTRY_NAMES` so no source walk or hash sees it either                                                                                          |
| Cleanup  | **Never automatic.** No TTL, no sweep, no "older than N days" job, and no UI button offering one — an expiry policy silently converts a reversible operation into a destructive one on a timer                                                                                                                            |
| Git      | Already ignored: the quarantine lives inside a directory `managedDirs()` puts in the managed `.gitignore` block (E23)                                                                                                                                                                                                     |
| Consent  | **PLANNED (Batch 9) — there is no dialog.** The BACKEND half is shipped: `harness:repairBlocked` takes a per-path selection and has no bulk shape. The surface that collects it — one dialog, per-path checkboxes, defaulting to none selected — is unstarted. Until it lands, the only caller is a direct RPC invocation |

**The order, and why every step is where it is.** Move the occupant to
quarantine and PROVE it moved (destination present, source gone), then run one
ordinary full pass. The write is the reconciler's, not a second writer — which
is what makes "a failed move means no write at that path" STRUCTURAL rather than
a branch somebody has to remember: an occupant still in place is still unowned,
so `planEntry` returns `'foreign'` and `targets/claude-target.ts:189-194` drops
the path before `plan.writes` is built. **The refusal that caused the defect is
the same refusal that makes the repair safe.** A path the pass did not write —
`missing` after the apply — gets its occupant back; if the restore itself fails,
the error names the quarantine path, because at that point the directory exists
in exactly one place.

**There is no `rm` on the repair path.** The move phase takes the workspace lock
and RELEASES it before the write pass — it has to, or it would deadlock the pass
— so the restore window is not exclusive by construction. Rather than delete
whatever sits on the destination on the strength of an argument about a lock
that is not held, the restore MOVES the obstruction aside into the quarantine
exactly as the original occupant was, and reports it as `supersededPath`. The
restore phase re-takes the lock, so the window is both narrow and non-lethal.
The one surviving deletion is the second half of the cross-volume `EXDEV`
fallback, which deletes only what it has already copied.

**Every per-path step is in its own `try`.** On Windows an `EPERM`/`EBUSY` from
an editor or an antivirus scanner holding one directory open is the expected
failure, not an exotic one, and a repair of thirteen paths that dies on the
third is worse than one that repairs twelve and names the one it could not.

**Unreachable from activation.** The dependency runs repair → reconciler, so
nothing on the activation path can arrive here. `HARNESS_SYNC_TOKENS.BLOCKED_REPAIR`
is held by exactly one caller: `harness:repairBlocked`, in
`rpc-handlers/.../harness-health-rpc.service.ts`. A blocked MCP fragment key
(`.mcp.json#github`) is refused — it is a key inside a config file the user also
writes, not a file, so there is nothing to move aside.

### Legacy adoption

An unowned file at a desired path is normally `foreign` forever (E9). Three
proofs, and only these three, promote it to a write:

1. **Byte identity.** Content already equals what this pass would produce — the
   signature of a manifest write that failed after a successful apply.
2. **A legacy `.ptah-managed.json`.** The rival installers' `{skills:[],commands:[]}`
   in the target directory, and `SkillJunctionService`'s
   `{ "<file>.md": {source,size,mtimeMs} }` in `.claude/commands`. The file IS a
   record of ownership; it is adopted, then deleted.
3. **The writer signature**, agents only, answered by
   `IHarnessAgentTransformer.isPtahOutput`. `source: ptah` in the frontmatter for
   the markdown formats; a `# source: ptah` comment — or, for files that predate
   it, a top-level `name` key plus a `developer_instructions` multi-line
   string — for Codex TOML.

Every adoption lands in `adopted`, for the same reason every deletion lands in
`removed`: taking over a file no manifest owned must not be invisible.

Skills and commands carry no signature and never will — they are copies of
user-layer markdown, so a stale copy is indistinguishable from a file the user
wrote. A drifted `.claude/skills/<slug>` with no legacy manifest therefore stays
foreign, is counted missing, and is LISTED by the doctor so the user can move it
out of the way. That is the correct answer, not a gap in the mechanism.

## Health surface

- **`harness:health`** `{ refresh?: boolean }` → `{ health, summary, cached }`.
  Serves the reconciler's cached report by default — that report is produced by
  every activation and every session preflight, so it is both current and free.
  A cached report for a DIFFERENT workspace root is not a hit; the reconciler is
  one singleton per host and its cache holds whichever workspace ran last
  (E12/E13). With no cache it calls **`reconciler.verify()`**.

  **`verify()` is not `reconcile({ mode: 'preflight' })`, and the distinction is
  load-bearing.** Preflight is a cheap DRIFT TEST that falls through to a full
  apply the moment it finds drift, and it takes the workspace lock. Asking what
  state the harness is in must not change it, and a badge that polls must not be
  able to take the lock out from under a session that is mid-copy. `verify()`
  writes nothing, locks nothing and repairs nothing — which is why
  `IHarnessTarget.verify` loads its own manifest rather than being handed one.

- **`harness:reconcile`** `{ mode?, targets? }` → `{ health, summary }`. The
  manual repair. Defaults to `full` — the button means "actually fix it".
- **`harness:remove`** `{ confirm: true }` → `{ health, summary, removed }`.
  `confirm` is `z.literal(true)` at the schema, so reaching the method IS the
  confirmation.
- **`harness:repairBlocked`** `{ paths: [{ target, relPath }] }` →
  `{ paths, repaired, health, summary }`. The consent-gated repair (Batch 8).
  Per-path only — there is deliberately no bulk shape, because the selection IS
  the ownership claim. An empty list is legal and is a complete no-op: no move,
  no pass, not one byte written. A path outside the reconciler's CURRENT blocked
  set is refused, re-derived here rather than trusted from the caller's report,
  which is what stops this being a general-purpose "move this directory"
  primitive. `harness:` was already in `ALLOWED_METHOD_PREFIXES`, so the runtime
  half of the dual registration came free with the namespace.
- **`harness:healthChanged`** push, payload `HarnessHealthChangedPayload`.
  Edge-triggered on the SUMMARY, not per pass: preflight runs on every session
  start, so a per-pass push would be a webview message per session for a badge
  that did not move. The comparison key excludes `generatedAt`, `durationMs` and
  `reason` (which change every pass) and includes the workspace root (so
  switching windows re-pushes even when both are equally healthy).

All four live in `rpc-handlers`, in `harness/health/harness-health-rpc.service.ts`,
registered through the `HarnessRpcHandlers` facade. **The push is emitted from
there and not from this lib**: `harness-sync` cannot broadcast — it depends on
`shared` and `vscode-core` only, deliberately — and giving it a webview
messenger to satisfy a badge would be new capability in a lib whose whole point
is that it has none. The reconciler exposes `onHealth`; the transport concern
stays on the `rpc-handlers` side of the boundary.

### `ptah harness doctor`

`ptah harness doctor [--fix] [--json]` prints a row per target — detected,
per-facet support, expected/found/missing/foreign/writeFailed/overwritten — then
the PATHS behind those counts grouped by kind (missing, foreign, adopted,
removed; 20 per group, then `+N more`), then the sources status and the summary
label. `--fix` runs a full reconcile first.

The path lists are not decoration. `foreign` entries are ones Ptah is
deliberately refusing to touch, so the only way to clear them is for the user to
move or delete the file — which they cannot do from a count.

**It exits 1 when the harness is degraded or in error**, which is a deliberate
divergence from `ptah spec doctor` (that one exits 0 even when it finds
problems, because it reports on a tree still being authored). This doctor is
meant to be usable as a CI gate on harness drift. The verdict comes from
`summarizeHarnessHealth`, never from re-deriving the rule at the call site.

`ptah harness remove --yes` is E22's user-facing half. `--yes` is required and
is the first confirmation flag in this CLI.

## Dependencies

**Internal**: `@ptah-extension/shared`, `@ptah-extension/vscode-core` (Logger).
**External**: `tsyringe`, `zod`, `eventemitter3`.

Deliberately NOT `agent-sdk`. The reconciler replaces a service that lived
inside that 10-concern lib; making it depend on it would put a leaf downstream
of a monolith for the sake of three method calls. `HarnessPluginConfigReader` is
structural, so `PluginLoaderService` satisfies it with no import either way.
**`agent-sdk` must never import this lib.**

## Design decisions worth not re-litigating

- **Copies, never junctions.** A copy survives host death, needs no privilege,
  behaves the same on every OS, and can be hash-compared. NTFS junctions were
  torn down on deactivate (leaving `ptah tui`, the CLI, the gateway and a plain
  `claude` with nothing), `rm -r` follows them into the source, and Windows
  commands had to be copies anyway — two mechanisms, two manifests, one
  directory.
- **Never remove on deactivate.** Removal happens only when a source disappears
  or the user disables it, and only for manifest-owned paths. There is no
  teardown path in this lib, on purpose.
- **Manifests live outside the target dirs.** `.claude/commands/.ptah-managed.json`
  was visible to foreign tools as a slash command, and `.claude/skills/` had
  nowhere to put one. First run adopts the legacy file, then deletes it.
- **Flat skill namespace, first-wins, collisions REPORTED not renamed.** A
  skill's identity is its frontmatter `name`, which other skills reference in
  prose; and `disabledSkillIds` is keyed by directory name with no derivable
  migration. Namespacing on copy would break both silently.
- **Source wins over local edits.** A hand-edit inside `.claude/skills/foo` is
  overwritten and reported in `overwrittenLocalEdit`. Edits belong in the user
  layer; silently honouring them would fork the two copies forever.
- **A corrupt manifest reads as empty.** That reclassifies previously-owned
  paths as foreign, so the reconciler refuses to touch files it can no longer
  prove it wrote. Safe direction.
- **A manifest that could not be WRITTEN is an `error`, and the next pass
  recovers by adopting.** `ManagedManifestStore.save` returns a boolean and the
  reconciler pushes a failure against `.ptah/harness/<target>.manifest.json` into
  `writeFailed`, so the badge goes red instead of reporting a clean pass whose
  ownership record does not exist. Recovery is the other half: a desired path
  that exists, is in NO manifest, and whose content hash already equals what this
  pass would write is ADOPTED rather than frozen as foreign — in `claude-target`
  against the desired hash, in `workspace-target` against the TRANSFORMED output
  hash (`hashTransformedDirSync`, which lives beside `copyDirectoryTransformed`
  so the two cannot drift). Adoption is safe precisely because writing would have
  produced those bytes. A path whose content DIFFERS is adopted only when it can
  prove authorship another way — a legacy `.ptah-managed.json`, or (agents only)
  `IHarnessAgentTransformer.isPtahOutput` — and otherwise stays foreign, which is
  still E9. See "Legacy adoption" above.
- **Only Ptah's own symlinks are unlinked.** `SkillJunctionService` leftovers
  have to go before a copy can land at the same path, but "unlink any symlink at
  a desired path" also deletes the link a user made to their own checkout. The
  test is the TARGET, not the shape: a link is migrated only when it resolves
  inside a declared source root — the user layer, the plugin overlay, and
  `HarnessSourceLayout.legacyLinkRoots` (`~/.ptah/plugins` and `~/.ptah/skills`,
  filled in by `defaultHarnessSourceLayout`). Anything else is reported `foreign`
  and left exactly where it is, which is what `workspace-target` has always done.
  Every unlink that DOES happen is recorded in `removed`.
- **The home reap demands proof of ownership, not a name prefix.** Copilot
  resolves agents home-first, so a stale `~/.copilot/agents/ptah-x.md` shadows
  the workspace copy and must be reaped (E19) — but a `ptah-` prefix is not
  evidence Ptah wrote the file. Two proofs, either sufficient: the writer
  signature `source: ptah` in the frontmatter (what `rewriteFrontmatter` emits,
  and what the deleted `MultiCliAgentWriterService` emitted before it), or a name
  of the form `<prefix><id>` where `id` is an agent the desired state or the
  manifest names. A user's own `ptah-notes.agent.md` survives, and every reap
  lands in `removed`.
- **Every file this lib owns is written atomically AND with the Windows retry.**
  Four of the five persistence writers had temp+rename without the retry, which
  is backwards for the failure it guards against: a `renameSync` losing to an
  antivirus scanner is EPERM, and the manifest that never landed is the worst
  outcome available. `fs/atomic-write.ts` is the one way, and it throws rather
  than logging so each caller keeps its own right answer.
- **Rival copies are TRANSFORMED, so a manifest entry carries two hashes.**
  Rival CLIs reject frontmatter Claude accepts (`allowed-tools`, an unquoted
  `description:` containing a colon, a `name` that differs from its folder), so
  a copy never hashes equal to its source. `ManagedEntry.hash` is the OUTPUT
  hash and `sourceHash` is the SOURCE hash; comparing the first detects a
  hand-edited copy, comparing the second detects a changed upstream. Byte-copy
  targets omit `sourceHash`.
- **Do NOT write a Codex `features` key beside a server entry. One was built,
  measured end to end, and deleted.** `targets/mcp/codex-tool-search-flag.ts`
  wrote `features.tool_search_always_defer_mcp_tools = false` on the belief that
  a registered server is useless without it — Codex defers MCP tools out of the
  model's eager tool list, and that key is what `CodexCliAdapter` sends
  in-process. Tested against a live Ptah MCP server on codex-cli 0.150.1 with
  `codex exec`: the eager list was empty with the flag in the project config,
  with it in the home config, and without it at all — and with NO flag anywhere,
  a session asked to search its tools called `ptah_workspace_analyze` and got a
  result. The flag moves nothing (`codex features list` reports it with stage
  `removed`), and the registration alone is sufficient. If eager listing ever
  matters, the lever is the AGENTS.md Ptah already propagates, not a config key.
- **`codexProjectTrusted` (`targets/mcp/codex-project-trust.ts`) exists because
  Codex ignores an untrusted project's config SILENTLY.** A project-scoped
  `{ws}/.codex/config.toml` is merged only when the home config records
  `[projects.'<path>'] trust_level = "trusted"` — measured as `MCP servers 2` in
  a trusted workspace against `MCP servers 1` in an untrusted one, with no
  warning either way. The reader lets a writer pick the scope Codex will
  actually read (`CodeExecutionMCP` falls back to the home file for an untrusted
  root) instead of writing a file that is discarded. Three rules: it is
  READ-ONLY, because trust grants Codex the right to run commands in a directory
  and recording that for the user would be Ptah answering a question asked of
  them; every ambiguity reads as NOT trusted, which costs a home-scoped entry
  that works rather than a workspace one that is ignored; and **case is folded
  per FILESYSTEM, never unconditionally.** Separators and a trailing separator
  normalize on every platform — those collapses cannot invent a match. Case
  folding can: on ext4 `/a/App` and `/a/app` are two directories, and folding
  would read trust granted to a sibling as this project's. It is therefore
  enabled for `win32` (Codex records paths LOWERCASED there, so an exact
  comparison would report every Windows project untrusted) and `darwin` (APFS
  and HFS+ are case-insensitive by default), and disabled everywhere else. The
  `caseInsensitive` option overrides it, which is also how one CI host proves
  all three behaviours.
- **`~/.codex` is the DEFAULT, not the rule — `CODEX_HOME` relocates it, and
  `codex-home.ts` is the one place that decides.** Verified on codex-cli
  0.150.1: `CODEX_HOME=/tmp/xyz codex doctor` reports
  `config.toml /tmp/xyz/config.toml` — directly inside the override, with no
  nested `.codex`. The variable is not exotic (~80 references in the `codex`
  binary against 2 for `XDG_CONFIG_HOME`), and relocating a dotfile directory is
  ordinary on Linux and macOS. `CodexTomlMcpFacet` (home scope) and
  `codexProjectTrusted` both resolve through `codexHomeDir`, because a facet
  writing one path while the trust reader read another would be a bug that only
  appears on a machine with the variable set. An explicit `homeDir` PINS the
  resolution and suppresses the env lookup, which is what keeps every spec that
  pins it hermetic; no host passes `homeDir`, so production always gets the
  environment's answer.
- **Codex MCP is spliced between marker comments, not round-tripped.**
  `~/.codex/config.toml` is a file the user hand-edits — model preferences,
  sandbox policy, comments explaining why. No TOML library in this repo
  preserves comments and key order across a parse/serialize cycle, so a
  round-trip would silently reformat the user's whole config the first time
  Ptah installed one server. Each Ptah table is fenced by
  `# ptah:begin <name>` / `# ptah:end <name>`; everything outside a fence is
  preserved byte-for-byte.
- **The workspace-root walk stops below the home directory.** `~/.ptah` is the
  USER LAYER, and it is also a root marker. Without the boundary, a workspace
  under the home directory with no marker of its own would resolve to the home
  directory, and the reconciler would copy the user layer into `~/.claude/skills`
  and write a manifest into `~/.ptah/harness`. The marker that makes Ptah's own
  home look like a workspace is the one Ptah put there.
- **MCP intents live in the file the old tracker already wrote.**
  `~/.ptah/mcp-installed.json` was bookkeeping for uninstall; it is now the
  desired state. Same path, same format, so upgrading users lose nothing and
  nothing already written becomes foreign.
- **The SDK's `plugins:` channel works, and we deliberately do not use it.**
  Measured against `@anthropic-ai/claude-agent-sdk@0.3.150` on 2026-08-18
  (Batch 3 spike, throwaway script, not committed). The findings, so nobody
  re-runs it:
  - `plugins: [{ type: 'local', path }]` maps to a `--plugin-dir <path>` CLI
    argument, and the bundled CLI loads it. With `settingSources: []` and a cwd
    holding no `.claude` at all, `~/.ptah/plugins/ptah-core` produced
    `skills: ["ptah-core:orchestration", …]` and
    `slash_commands: ["ptah-core:orchestrate", …]`.
  - **No `.claude-plugin/plugin.json` is required.** The CLI infers the plugin
    name from the directory name and reads `skills/` and `commands/` directly.
    Synthesizing a manifest changed nothing but the enumeration order.
  - **Everything it registers is plugin-QUALIFIED**, and that is what rules it
    out as an additive optimisation. Passing `plugins:` ALONGSIDE the copies
    this lib writes registers each artifact twice: the same run reported both
    `orchestration` and `ptah-core:orchestration`, and both `/orchestrate` and
    `/ptah-core:orchestrate` — 12 skills became 19. That is duplicated skill
    budget in every system prompt, two names for one thing in the model's
    choice set, and a qualified command name that the shipped content's own
    `/orchestrate` references do not match.
  - Copies stay the baseline regardless, because they are the ONLY mechanism a
    plain `claude` binary, a rival CLI, `ptah tui` and the gateway can all read.
    So the choice was never "copies or plugins" — it was "copies, or copies
    plus a second registration of the same content".
  - Consequently the dead `pluginPaths` parameter was DELETED rather than
    completed. It was threaded through seven `agent-sdk` files and three
    external producers and consumed by exactly two log statements. `pluginPaths`
    survives only where it is genuinely read: `discoverPluginSkills` (prose in a
    system prompt) and `MirrorSources` (the user-layer mirror).

## Edge cases and their status

Codes are from `.ptah/specs/TASK_2026_278/context.md`.

| #          | Case                                            | Status                                                                                                                                                                                                                         |
| ---------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E1         | Host deactivates mid-session                    | Closed — no teardown path exists                                                                                                                                                                                               |
| E2/E3      | Sources missing / download in flight            | Closed — `sources: 'sources-missing' \| 'pending-download'`, no throw                                                                                                                                                          |
| E9         | User's own `.claude/skills/foo`                 | Closed — reported `foreign`, never touched                                                                                                                                                                                     |
| E10        | Hand-edited managed copy                        | Closed — overwritten + `overwrittenLocalEdit`                                                                                                                                                                                  |
| E11        | Two hosts reconcile concurrently                | Closed — file lock + in-process queue                                                                                                                                                                                          |
| E12        | Workspace folder change                         | Closed — new ws gets a full `propagate` (mirror THEN reconcile, because `{ws}/.claude/agents` is a per-workspace source), old ws untouched. **No teardown on folder REMOVAL, deliberately** — see "Never remove on deactivate" |
| E13        | Two workspaces open                             | Closed — per-workspace manifest, per-workspace SOURCES (`resolve(workspaceRoot)`, TASK_2026_346) and a per-workspace AGENT CLONE (`agents/<workspace-key>`, TASK_2026_365)                                                     |
| E20        | Reserved names / case collisions                | Closed — reported, skipped                                                                                                                                                                                                     |
| E21        | Antivirus/locked file on Windows                | Closed — 3× retry, then `write-failed`; manifest records only applied entries                                                                                                                                                  |
| E5         | Disable / demote → reaped everywhere            | Closed — manifest-owned only, all six targets                                                                                                                                                                                  |
| E14        | Rival CLI spawned with cwd = sub-folder         | Closed — `resolveHarnessWorkspaceRoot` at the reconciler entry                                                                                                                                                                 |
| E17        | Rival CLI not installed                         | Closed — `detected: false`, nothing written; installing later populates                                                                                                                                                        |
| E18        | Codex MCP                                       | Closed — fenced `[mcp_servers.*]` blocks, user's other servers byte-preserved                                                                                                                                                  |
| E19        | Copilot home-vs-workspace precedence            | Closed — `ptah-`/`ptahsynth-` home copies reaped, user files kept                                                                                                                                                              |
| E22        | Uninstall / `ptah harness remove`               | Closed — `reconciler.remove(ws)`; Batch 4 exposes it                                                                                                                                                                           |
| E4         | Synth skill promoted mid-session                | Closed (Batch 3) — `SkillPromotionService` emits, both port impls propagate                                                                                                                                                    |
| E15        | Harness-builder skill created                   | Closed (Batch 3) — `harness:create-skill` propagates after `createSkillPlugin`                                                                                                                                                 |
| E16        | Enhancement apply / revert                      | Closed (Batch 3) — enhancer emits, port propagates all three kinds                                                                                                                                                             |
| E24        | Cron / gateway / curator sessions               | Closed (Batch 3) — preflight in the shared session path; live MCP port                                                                                                                                                         |
| E6, E7, E8 | User-layer divergence/reaping                   | Closed (Batch 1b) — source-layer, in `agent-generation`'s `user-layer-*.spec.ts`                                                                                                                                               |
| E23        | `.gitignore` managed block                      | Closed (Batch 4) — `gitignore/gitignore-writer.spec.ts` + `reconciler/harness-reconciler.gitignore.spec.ts`                                                                                                                    |
| E25        | Shipped content path literals                   | Closed in Batch 0                                                                                                                                                                                                              |
| E26        | Agents propagated with no user consent          | Closed (TASK_2026_286) — `agentSyncEnabled` + `disabledAgentIds`; an ABSENT flag resolves from manifest evidence, never to a bare `false`                                                                                      |
| E27        | Skills propagated with no per-workspace consent | Closed (TASK_2026_316) — `skillSyncMode` + `enabledSkillSlugs` + the plugin-origin gate over the user-layer base; an ABSENT mode resolves from manifest evidence, never to a bare `'selected'`                                 |
| E28        | Two workspaces' agents collide on one slug      | Closed (TASK_2026_365) — `agents/<workspace-key>`, seeded from the flat base and never reaped; the mirror is gated on the same consent as the propagation                                                                      |

### Where each edge case is pinned

| #            | Spec file                                                                                                                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1, E5       | `reconciler/harness-reconciler.idempotency-removal.spec.ts`                                                                                                                                                                                   |
| E2, E3       | `reconciler/harness-reconciler.sources-health.spec.ts`                                                                                                                                                                                        |
| E4, E15, E16 | `propagation/harness-propagation.service.spec.ts`                                                                                                                                                                                             |
| E9, E10      | `reconciler/harness-reconciler.foreign-edits.spec.ts`                                                                                                                                                                                         |
| E11          | `reconciler/harness-reconciler.concurrency.spec.ts`, `lock/workspace-lock.spec.ts`                                                                                                                                                            |
| E12, E13     | `reconciler/harness-reconciler.workspace-isolation.spec.ts` (the target paths) and **`reconciler/harness-reconciler.workspace-scoped-sources.spec.ts`** (the SOURCES), plus `agent-sdk/.../plugin-loader.service.spec.ts` for the loader half |
| E14          | `workspace/workspace-root.spec.ts` (including the case-insensitive home boundary on win32)                                                                                                                                                    |
| E17          | `targets/rival-targets.detection.spec.ts`                                                                                                                                                                                                     |
| E18          | `targets/mcp/codex-toml-mcp-facet.spec.ts`                                                                                                                                                                                                    |
| E19, E5      | `targets/rival-targets.reap.spec.ts`                                                                                                                                                                                                          |
| E20          | `manifest/slug-rules.spec.ts`                                                                                                                                                                                                                 |
| E21          | `reconciler/harness-reconciler.write-failure.spec.ts`, `fs/atomic-write.spec.ts`                                                                                                                                                              |
| E22          | `reconciler/harness-reconciler.remove.spec.ts`                                                                                                                                                                                                |
| E23          | `gitignore/gitignore-writer.spec.ts`, `reconciler/harness-reconciler.gitignore.spec.ts`                                                                                                                                                       |
| E24          | `preflight/harness-preflight.service.spec.ts`                                                                                                                                                                                                 |
| E26          | `reconciler/harness-reconciler.agent-consent.spec.ts` (the gate, the wizard grant, and THE MIGRATION), `manifest/harness-manifest.builder.spec.ts` (the two filters)                                                                          |
| E27          | `reconciler/harness-reconciler.plugin-gate.spec.ts` (the plugin-origin gate over the user-layer base), `reconciler/harness-reconciler.skill-consent.spec.ts` (the selection gate and its migration)                                           |
| E28          | `state/agent-workspace-scope.spec.ts` (the reader scope and the writer decision), `shared/.../user-layer-agents.spec.ts` (the key), `agent-generation/.../user-layer-agent-scope.spec.ts` (two workspaces stay apart, and the seed)           |
| —            | Codex/Antigravity shared dir: `targets/rival-targets.shared-dir.spec.ts`                                                                                                                                                                      |
| —            | **Antigravity MCP schema + the `ptah`/manifest/user key partition: `targets/mcp/antigravity-mcp-facet.spec.ts`**                                                                                                                              |
| —            | **Install → spawn → cleanup → uninstall, and a concurrent reconcile + spawn: `reconciler/harness-reconciler.antigravity-mcp.spec.ts`**                                                                                                        |
| —            | **The adapter side of the same rule: `cli-agent-runtime/.../antigravity-cli.adapter.mcp.spec.ts`**                                                                                                                                            |
| —            | Legacy manifest adoption: `reconciler/harness-reconciler.migration.spec.ts`                                                                                                                                                                   |
| —            | **`reconcile` and `verify` agree; adoption; blocked = foreign + missing; user MCP servers are not findings: `reconciler/harness-reconciler.verify-agreement.spec.ts`**                                                                        |
| —            | Manifest-save failure + adoption recovery: `reconciler/harness-reconciler.manifest-recovery.spec.ts`                                                                                                                                          |
| —            | Symlink migration vs. the user's own link: `targets/claude-target.symlink-migration.spec.ts`                                                                                                                                                  |
| —            | Workspace-folder change runs the FULL pass: `apps/ptah-electron/.../plugin-activation.spec.ts`                                                                                                                                                |
| —            | Health surface + push: `rpc-handlers/.../harness-health-rpc.service.spec.ts`                                                                                                                                                                  |
| —            | `ptah harness doctor` exit codes: `apps/ptah-cli/.../harness.spec.ts`                                                                                                                                                                         |

### The original defect inventory

Numbers are from `context.md`. Every one is closed by a mechanism above, not by
a patch at the site where it was found.

| #    | Defect                                                                    | Closed by                                                                                             |
| ---- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1, 2 | Junctions torn down on deactivate; never created for CLI/TUI/gateway/cron | Copies, and no teardown path exists in this lib                                                       |
| 3    | `ensureContent()` race                                                    | `ensureContent()` AWAITED before the mirror, plus `IHarnessContentGate` in preflight                  |
| 4, 5 | Promotion / repropagation missed `.claude/skills`                         | One reconciler, all targets, one `propagate`                                                          |
| 6    | Harness-builder skills never CLI-synced                                   | Mirrored into the user layer (Batch 1b), so they are ordinary desired state                           |
| 7    | Deleted upstream never reaped                                             | Manifest-owned removal + user-layer reaping                                                           |
| 8    | Divergence reconcile only on download                                     | Runs every activation (Batch 1b)                                                                      |
| 9    | Two manifest formats; one deleted on deactivate                           | ONE format, outside the target dirs, never deleted                                                    |
| 10   | No cross-process lock                                                     | `{ws}/.ptah/harness/.lock` + in-process queue                                                         |
| 11   | `.claude/agents` was both source and target                               | Source only; the reconciler writes nothing into it                                                    |
| 12   | Missing per-CLI capabilities                                              | Reported as `unsupported` per facet; codex MCP + antigravity/cursor gaps filled where upstream allows |
| 13   | Hardcoded `mcpServerRunning: false`                                       | Live MCP port passed (Batch 3)                                                                        |
| 14   | Rival CLI cwd = sub-folder                                                | `resolveHarnessWorkspaceRoot` at the reconciler entry                                                 |
| 15   | No `.gitignore` entries                                                   | The managed block (E23)                                                                               |
| 16   | No verification, no health surface                                        | `HarnessHealth` + `harness:health` + badge + doctor                                                   |
| 17   | Stale path literals in shipped content                                    | Fixed in Batch 0                                                                                      |
| 18   | The three deleted services had no specs                                   | They are deleted; this lib is spec'd per the matrix above                                             |

**Documented unsupported (today)**:

- The preflight fast path compares desired hashes to the manifest and stats each
  owned path; it does NOT re-hash target directories. A hand-edit to a managed
  copy is therefore invisible to preflight and is corrected by the next
  `mode: 'full'` pass (every activation). That is the deliberate cost of making
  a session-start check cheap enough to always run. MCP keys are fragments
  inside a shared config file, so they are hash-compared only — there is no path
  to stat.
- Codex, Copilot and Antigravity carry no commands, and Antigravity no agents.
  See the matrix above for why each is an upstream limit rather than a gap.
- The Codex TOML reader understands basic strings, arrays of basic strings and
  `env`/`headers` sub-tables. An exotic hand-written entry still reports its
  NAME — which is what ownership and `listInstalled` need — with a degraded
  config rather than failing the pass.

## Guidelines

- `catch (error: unknown)`, narrow with `instanceof Error`.
- Zod at the file boundary (`ManagedManifestSchema`); trust internal types past it.
- `plan()` must never write. `apply()` is the only phase allowed to touch disk.
- **`verify()` must be `plan()` + `plannedTargetHealth()`, and nothing else.** A
  second disk walk with its own rules is how the two reports came to contradict
  each other over an unchanged tree. `plan()` not writing is what makes this
  safe; keep it that way.
- **A desired path Ptah refuses to write goes in `blocked`, which means it is
  reported as BOTH `foreign` and `missing`.** `missing` is "desired but not
  owned on disk", regardless of why. Never report one without the other.
- **A new agent transformer must implement `isPtahOutput`.** Without it every
  copy the previous pipeline wrote is unadoptable and its target freezes on
  files Ptah itself produced. Answer for your OWN format, accept the
  predecessor's signature too, and never answer from the file NAME.
- Record a manifest entry ONLY after its write succeeded.
- **Never call `writeFileSync` on a file this lib owns.** Use
  `atomicWriteWithRetry` (`fs/atomic-write.ts`). A plain write is not atomic, and
  a temp+rename without `fs/windows-retry.ts` loses to any scanner holding the
  target open — that combination is what made a lost manifest freeze a whole
  target. The rule covers the manifests, `state.json`, the MCP intent store,
  both MCP facets and `.gitignore`.
- **Never scope one side of an artifact root without the other.** The agent
  clone lives under `userLayerAgentDirName(root)`; the mirror WRITES it and this
  lib READS it, and a reader keyed on a different spelling of the root sees an
  empty directory. Agents are manifest-owned, so an empty desired state is a
  DELETION of every propagated copy, reported as an ordinary clean pass. Both
  sides resolve through `resolveHarnessWorkspaceRoot` for exactly this reason.
- **Never let a new gate default to OFF for an artifact kind that is already on
  disk.** Everything this lib writes is manifest-owned, so "not in the desired
  state" means DELETED. An absent flag must resolve from evidence of what Ptah
  already wrote, and the resolved answer must then be persisted so the evidence
  check runs once. `state/agent-sync-gate.ts` is the worked example; copy its
  shape rather than inventing a second migration idiom.
- **Never delete something because its NAME looks like Ptah's.** Ownership comes
  from the manifest, from a content hash, from a resolved link target, or from
  the `source: ptah` writer signature. Every deletion outside the workspace, and
  every migrated unlink inside it, is reported in `removed`.
- Remove directories with `rm -r` only for manifest-owned paths, and only after
  any junction at that path has been `unlink`ed — and only unlink a junction
  `link-ownership.ts` says points into a declared source root.
- Resolve `HARNESS_SYNC_TOKENS.TARGET` with `resolveAll`, never `resolve`.
- A new rival CLI is an entry in `rival-targets.ts` plus (if its agent format is
  novel) one transformer. Do not subclass `WorkspaceHarnessTarget` — the
  behaviour is meant to stay in one place.
- A new MCP config file is one entry in `mcp/mcp-facet.registry.ts`. The
  registry is the single definition each file has; targets and the install
  surface both read it, which is what stops a writer and a lister disagreeing.
- **Never add a SECOND writer to an MCP config file. Route it through the
  facet.** A module that hand-rolls its own read-modify-write on a file this lib
  also writes will lose an entry — not corrupt it, lose it, silently — because
  atomic writes serialize nothing. If a spawn path needs its own ephemeral
  entry, it takes the facet and a reserved key, as `AntigravityCliAdapter` does
  with `PTAH_SPAWN_MCP_KEY`. And never remove a key you did not write, including
  by deleting a server map that "looks empty".
- A target that gains a skill/command/agent directory must return it from
  `managedDirs()`. `WorkspaceHarnessTarget` derives it from the same three
  option fields the plan is built from, so a new rival CLI gets it free; a
  bespoke target has to remember. Never return an MCP config path from it.
- Never re-derive "is the harness healthy". Call `summarizeHarnessHealth` from
  `@ptah-extension/shared`. Three consumers depend on that rule being one rule.
  Same rule, same place, for **`blockedTargetPaths`** (`missing ∩ foreign`):
  never write the intersection inline, here or in a webview.
- **Never let a spec touch the real home directory.** Every facet and rival
  target factory takes a `homeDir` override; pass a temp one. A spec that
  writes to `~/.codex/config.toml` or `~/.claude/skills` corrupts the developer's
  own harness (this happened once, during Batch 2 — see the workspace-root
  boundary note above).

## Cross-Lib Rules

Used by: `rpc-handlers` (the harness RPC surface + the health service),
`cli-engine`, `cli-agent-runtime` (MCP install), and the app layers.
`apps/ptah-cli` reaches it only through the RPC transport, never by resolving a
token — which is what keeps `ptah harness doctor`, the TUI's `/harness` and the
Marketplace badge on one implementation.
Forbidden imports: `agent-sdk`, `agent-generation`, `cli-agent-runtime`,
`platform-{cli,electron,vscode}`, anything under `libs/frontend`.
