# @ptah-extension/harness-sync

[Back to Main](../../../CLAUDE.md)

## Purpose

One concern: **reconcile the user layer into the harness directories AI tools
actually read**, as idempotent, manifest-owned copies.

`~/.ptah/user/{skills,commands,agents}` is the single editable source, plus
`~/.ptah/mcp-installed.json` for MCP servers. Everything downstream is a
derived, hash-gated copy that a manifest proves Ptah owns.
`HarnessReconciler.reconcile(ws)` is the ONE entry point — every host, RPC
handler and trigger calls it, and calling it twice costs a directory walk.

Replaces four separate fan-outs that each had their own idea of ownership:
`SkillJunctionService` (agent-sdk, Batch 1), `CliPluginSyncService`
(cli-agent-runtime), `MultiCliAgentWriterService` (agent-generation) and the
`mcp-directory` installers (Batch 2). All four are deleted.

## Target × facet matrix

| Target          | skills                     | commands                     | agents                         | mcp                                |
| --------------- | -------------------------- | ---------------------------- | ------------------------------ | ---------------------------------- |
| **claude**      | `.claude/skills/<slug>/**` | `.claude/commands/<slug>.md` | — **unsupported**              | `{ws}/.mcp.json`                   |
| **codex**       | `.agents/skills/<slug>/**` | — **unsupported**            | `.codex/agents/<id>.toml`      | `~/.codex/config.toml`             |
| **copilot**     | `.github/skills/<slug>/**` | — **unsupported**            | `.github/agents/<id>.agent.md` | `~/.copilot/mcp-config.json`       |
| **cursor**      | `.cursor/skills/<slug>/**` | `.cursor/commands/<slug>.md` | `.cursor/agents/<id>.md`       | `{ws}/.cursor/mcp.json`            |
| **antigravity** | `.agents/skills/<slug>/**` | — **unsupported**            | — **unsupported**              | `~/.gemini/config/mcp_config.json` |
| **vscode**      | — **unsupported**          | — **unsupported**            | — **unsupported**              | `{ws}/.vscode/mcp.json`            |

Every cell is reported per target in `HarnessTargetHealth.facets`, so an
artifact a tool genuinely cannot accept reads as `unsupported` rather than as a
permanently missing count nobody can act on (defect 12).

**Why the unsupported cells are unsupported** — each is an upstream limit, not
a gap to fill later:

- **Claude agents.** `{ws}/.claude/agents` is a SOURCE the user-layer mirror
  reads FROM. Writing generated agents back closes a source→target→source loop
  where every reconcile re-mirrors its own output.
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
it; `AntigravityCliAdapter` (`cli-agent-runtime`) writes Ptah's OWN server into
it before every spawn and removes that entry after `done`.

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

| Key                           | Owner           | Lifetime             | Who may remove it              |
| ----------------------------- | --------------- | -------------------- | ------------------------------ |
| `ptah` (`PTAH_SPAWN_MCP_KEY`) | the CLI adapter | one spawn            | the adapter, after `done`      |
| a key in the manifest         | the reconciler  | until intent dropped | the reconciler's removal sweep |
| anything else                 | the user        | forever              | nobody here                    |

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

## Boundaries

**Belongs here**:

- Desired-state construction from the user layer + plugin overlay + disabled ids
  - recorded MCP intents
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
`McpIntentStore`, `HarnessGitignoreWriter`, `HarnessStateStore`.
Ports: `IHarnessTarget`, `IHarnessSourceResolver`, `IHarnessCliDetector`,
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
`PTAH_SPAWN_MCP_KEY`, `withMcpConfigLock`.
Workspace: `resolveHarnessWorkspaceRoot`.
Lock: `acquireWorkspaceLock`, `serializePerWorkspace`, `acquireFileLock`,
`withFileLock`, `serializeByKey`. Hashing: `hashDirSync`,
`hashFileSync`, `hashContent`. Rules: `isReservedSlug`, `canonicalSlug`.
Wiring: `createPluginConfigSourceResolver`, `createStaticSourceResolver`,
`ALL_HARNESS_TARGET_FACTORIES`, `registerHarnessSyncServices`,
`HARNESS_SYNC_TOKENS`.

Wire types (`HarnessHealth`, `HarnessTargetHealth`, `HarnessTargetId`,
`HARNESS_TARGET_IDS`, `HarnessCollision`) live in `@ptah-extension/shared`
because the `harness:health` RPC and the Marketplace badge cross into the
webview. So does **`summarizeHarnessHealth()`** — a pure reducer from a report
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
  in-process queue, and "proceed unlocked past the deadline"
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
  `appliedTargetHealth` (plan + apply result)
- `gitignore/gitignore-writer.ts` — the managed `.gitignore` block (E23)
- `gitignore/harness-state-store.ts` — `{ws}/.ptah/harness/state.json`, the
  per-workspace memory of decisions the USER made (as opposed to the manifests
  next to it, which record what PTAH wrote)
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
by `preflight/harness-preflight.service.spec.ts`: it races a timer and lets the
losing pass finish in the background (never cancelled — it holds the workspace
lock mid-copy); it throttles per workspace root (`minIntervalMs`, 60 s) so the
skill-synthesis drain's dozens of nightly one-shot sessions do not each pay for
a walk of `~/.ptah/user`; and it resolves the caller's cwd to the workspace root
first (E14).

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
| Wizard submit                | `wizard:submit-selection`                                                                                                               | `full`      |
| Manual repair                | `harness:reconcile` RPC, `ptah harness doctor --fix`                                                                                    | `full`      |
| Manual inspection            | `harness:health` RPC, `ptah harness doctor`                                                                                             | `preflight` |
| Uninstall                    | `harness:remove` RPC, `ptah harness remove --yes` → `reconciler.remove`                                                                 | —           |

### Preflight semantics, and its blind spot

Preflight compares desired SOURCE hashes against the manifest and stats each
owned path. It does not re-hash target directories. Three properties make that
safe to run on every single session start, all pinned by
`preflight/harness-preflight.service.spec.ts`: it races a timer and lets the
losing pass finish in the background (never cancelled — it holds the workspace
lock mid-copy); it throttles per workspace root (60 s) so the skill-synthesis
drain's nightly one-shot sessions do not each pay for a walk of `~/.ptah/user`;
and it resolves the caller's cwd to the workspace root first (E14).

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

`.claude/agents` is absent for the same reason it is `unsupported` in the
matrix: it is a SOURCE holding files the user authored, and it must stay tracked.

## Settings

Both are read by the HOST and handed down as a lambda. This lib does not depend
on `platform-core` and is not going to start; the default for each lives here,
once, so two hosts cannot drift.

| Key                          | Default                               | Read by                               | Consumed by                                |
| ---------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------------ |
| `harness.preflightTimeoutMs` | `DEFAULT_PREFLIGHT_TIMEOUT_MS` (1500) | `readPreflightTimeoutMs` in each host | `HarnessPreflightDeps.readTimeoutMs`       |
| `harness.manageGitignore`    | `DEFAULT_MANAGE_GITIGNORE` (true)     | `readManageGitignore` in each host    | `HarnessGitignoreDeps.readManageGitignore` |

Both are declared in `platform-core`'s `FILE_BASED_SETTINGS_KEYS` and read with
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

| #          | Case                                    | Status                                                                                                                                     |
| ---------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| E1         | Host deactivates mid-session            | Closed — no teardown path exists                                                                                                           |
| E2/E3      | Sources missing / download in flight    | Closed — `sources: 'sources-missing' \| 'pending-download'`, no throw                                                                      |
| E9         | User's own `.claude/skills/foo`         | Closed — reported `foreign`, never touched                                                                                                 |
| E10        | Hand-edited managed copy                | Closed — overwritten + `overwrittenLocalEdit`                                                                                              |
| E11        | Two hosts reconcile concurrently        | Closed — file lock + in-process queue                                                                                                      |
| E12        | Workspace folder change                 | Closed — new ws gets a full `propagate` (mirror THEN reconcile, because `{ws}/.claude/agents` is a per-workspace source), old ws untouched |
| E13        | Two workspaces open                     | Closed — per-workspace manifest                                                                                                            |
| E20        | Reserved names / case collisions        | Closed — reported, skipped                                                                                                                 |
| E21        | Antivirus/locked file on Windows        | Closed — 3× retry, then `write-failed`; manifest records only applied entries                                                              |
| E5         | Disable / demote → reaped everywhere    | Closed — manifest-owned only, all six targets                                                                                              |
| E14        | Rival CLI spawned with cwd = sub-folder | Closed — `resolveHarnessWorkspaceRoot` at the reconciler entry                                                                             |
| E17        | Rival CLI not installed                 | Closed — `detected: false`, nothing written; installing later populates                                                                    |
| E18        | Codex MCP                               | Closed — fenced `[mcp_servers.*]` blocks, user's other servers byte-preserved                                                              |
| E19        | Copilot home-vs-workspace precedence    | Closed — `ptah-`/`ptahsynth-` home copies reaped, user files kept                                                                          |
| E22        | Uninstall / `ptah harness remove`       | Closed — `reconciler.remove(ws)`; Batch 4 exposes it                                                                                       |
| E4         | Synth skill promoted mid-session        | Closed (Batch 3) — `SkillPromotionService` emits, both port impls propagate                                                                |
| E15        | Harness-builder skill created           | Closed (Batch 3) — `harness:create-skill` propagates after `createSkillPlugin`                                                             |
| E16        | Enhancement apply / revert              | Closed (Batch 3) — enhancer emits, port propagates all three kinds                                                                         |
| E24        | Cron / gateway / curator sessions       | Closed (Batch 3) — preflight in the shared session path; live MCP port                                                                     |
| E6, E7, E8 | User-layer divergence/reaping           | Closed (Batch 1b) — source-layer, in `agent-generation`'s `user-layer-*.spec.ts`                                                           |
| E23        | `.gitignore` managed block              | Closed (Batch 4) — `gitignore/gitignore-writer.spec.ts` + `reconciler/harness-reconciler.gitignore.spec.ts`                                |
| E25        | Shipped content path literals           | Closed in Batch 0                                                                                                                          |

### Where each edge case is pinned

| #            | Spec file                                                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1, E5       | `reconciler/harness-reconciler.idempotency-removal.spec.ts`                                                                                                            |
| E2, E3       | `reconciler/harness-reconciler.sources-health.spec.ts`                                                                                                                 |
| E4, E15, E16 | `propagation/harness-propagation.service.spec.ts`                                                                                                                      |
| E9, E10      | `reconciler/harness-reconciler.foreign-edits.spec.ts`                                                                                                                  |
| E11          | `reconciler/harness-reconciler.concurrency.spec.ts`, `lock/workspace-lock.spec.ts`                                                                                     |
| E12, E13     | `reconciler/harness-reconciler.workspace-isolation.spec.ts`                                                                                                            |
| E14          | `workspace/workspace-root.spec.ts` (including the case-insensitive home boundary on win32)                                                                             |
| E17          | `targets/rival-targets.detection.spec.ts`                                                                                                                              |
| E18          | `targets/mcp/codex-toml-mcp-facet.spec.ts`                                                                                                                             |
| E19, E5      | `targets/rival-targets.reap.spec.ts`                                                                                                                                   |
| E20          | `manifest/slug-rules.spec.ts`                                                                                                                                          |
| E21          | `reconciler/harness-reconciler.write-failure.spec.ts`, `fs/atomic-write.spec.ts`                                                                                       |
| E22          | `reconciler/harness-reconciler.remove.spec.ts`                                                                                                                         |
| E23          | `gitignore/gitignore-writer.spec.ts`, `reconciler/harness-reconciler.gitignore.spec.ts`                                                                                |
| E24          | `preflight/harness-preflight.service.spec.ts`                                                                                                                          |
| —            | Codex/Antigravity shared dir: `targets/rival-targets.shared-dir.spec.ts`                                                                                               |
| —            | **Antigravity MCP schema + the `ptah`/manifest/user key partition: `targets/mcp/antigravity-mcp-facet.spec.ts`**                                                       |
| —            | **Install → spawn → cleanup → uninstall, and a concurrent reconcile + spawn: `reconciler/harness-reconciler.antigravity-mcp.spec.ts`**                                 |
| —            | **The adapter side of the same rule: `cli-agent-runtime/.../antigravity-cli.adapter.mcp.spec.ts`**                                                                     |
| —            | Legacy manifest adoption: `reconciler/harness-reconciler.migration.spec.ts`                                                                                            |
| —            | **`reconcile` and `verify` agree; adoption; blocked = foreign + missing; user MCP servers are not findings: `reconciler/harness-reconciler.verify-agreement.spec.ts`** |
| —            | Manifest-save failure + adoption recovery: `reconciler/harness-reconciler.manifest-recovery.spec.ts`                                                                   |
| —            | Symlink migration vs. the user's own link: `targets/claude-target.symlink-migration.spec.ts`                                                                           |
| —            | Workspace-folder change runs the FULL pass: `apps/ptah-electron/.../plugin-activation.spec.ts`                                                                         |
| —            | Health surface + push: `rpc-handlers/.../harness-health-rpc.service.spec.ts`                                                                                           |
| —            | `ptah harness doctor` exit codes: `apps/ptah-cli/.../harness.spec.ts`                                                                                                  |

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
