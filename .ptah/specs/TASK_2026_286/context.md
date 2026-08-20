# Context

## How this was found

The question asked was simple: when do skills and subagents actually get
installed? The expectation was "skills when the user installs them from the
plugins modal, subagents when they run the setup wizard".

For skills that turned out to be exactly what the code does.
`getWorkspacePluginConfig()` defaults `enabledPluginIds` to `[]`, nothing seeds
it, every writer is a user action, and `buildMirrorSources` passes
`resolvePluginPaths(config.enabledPluginIds)`. A downloaded plugin sits in
`~/.ptah/plugins` and reaches zero targets until the user enables it.

For agents it was not. `HarnessManifestBuilder.buildAgents()` listed every `.md`
under `~/.ptah/user/agents` with no filter at all — no `disabledAgentIds`, no
workspace-level flag, nothing analogous to what `buildSkills()` honours. And
`buildMirrorSources` passes `agentSourceDir: {ws}/.claude/agents`
unconditionally, so any agent file in the workspace entered the user layer and
then every rival CLI's agent directory.

A search for a "wizard has completed" flag found none. It did not exist.

## Why the migration is the whole task

`buildAgents()` returning `[]` is not a skip. Agents are manifest-owned, so an
empty desired state is a REAP — which is correct when a user turns an agent off,
and catastrophic as a default.

A flag defaulting to `false` would have made the first routine reconcile after
the upgrade delete every `.codex/agents/*.toml`, `.github/agents/*.agent.md` and
`.cursor/agents/*.md` Ptah had ever written, in every existing workspace,
silently, and report it as an ordinary clean pass. Nobody would have connected
the deletion to an upgrade.

So an absent flag is never a bare `false`. It resolves from evidence:

| `agentSyncEnabled` | Any manifest owns an `agent` entry? | Result      |
| ------------------ | ----------------------------------- | ----------- |
| `true` / `false`   | —                                   | as recorded |
| absent             | yes                                 | `true`      |
| absent             | no                                  | `false`     |

Prior propagation IS prior consent — those files exist because a previous
version put them there and the user has been living with them. A workspace with
no agent entries has nothing to lose and starts gated.

## Decisions worth not re-litigating

- **Manifests are read for every id in `HARNESS_TARGET_IDS`**, not just the
  targets the current host registered. The evidence is on disk; a CLI host
  registering fewer targets than the extension did must not read an
  already-propagated workspace as virgin and reap it.
- **The resolved value is persisted once**, inside the workspace lock, before
  any target runs — so the evidence walk cannot flip later just because a reap
  emptied the manifests.
- **`verify()` resolves but never persists.** A derived decision is a write, and
  asking what state the harness is in must not change it. A badge that polls
  must not be able to record a consent decision on the user's behalf.
- **`persist()` never overwrites a recorded flag.** It is the migration step,
  not a way to revoke consent.
- **The gate is a DEFAULTED constructor param on `HarnessReconcilerService`, not
  nullable** like `HarnessGitignoreWriter`. An absent `.gitignore` writer means
  one less file maintained; an absent gate would mean the facet propagates
  ungated in any host that forgot to wire it — the exact defect the gate exists
  to close.
- **The mirror stays unconditional.** `{ws}/.claude/agents` continues to be
  pulled into `~/.ptah/user/agents`; that is the user's own source. The gate
  sits at the reconciler, so nothing is lost when consent is granted later.

## Known gap

`disabledAgentIds` has no UI. `plugins:save-config` accepts only
`disabledSkillIds` and `disabledPluginIds`, so the per-agent toggle is
persistable and honoured but unreachable from the webview. The workspace-level
gate works end to end via the wizard.

## Where it lives

- `libs/backend/harness-sync/src/lib/state/agent-sync-gate.ts`
- `libs/backend/harness-sync/src/lib/gitignore/harness-state-store.ts`
  (`agentSyncEnabled`, `wizardCompletedAt`)
- `libs/backend/harness-sync/src/lib/manifest/harness-manifest.builder.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts`
  (grants consent BEFORE `propagate()`, because the reconciler resolves the gate
  at the top of the pass)

Pinned by `reconciler/harness-reconciler.agent-consent.spec.ts`.
