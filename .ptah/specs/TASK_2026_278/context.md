# TASK_2026_278 — Harness reconciler

## User intent

> All of our CLI tools and the Claude main Agent SDK should be getting all of our harness (tools, MCP servers, skills and subagents). The junction part is not stable and buggy. Design a solution that avoids these issues for good and makes sure the harness is properly populated to all connected CLI agents. This is a core feature — cover all edge cases, including when skill-synthesis trajectory work updates our skill plugins.

Trigger incident (2026-08-18): agent invoked `/orchestrate`, the command told it to `Read .claude/skills/orchestration/SKILL.md`, file "does not exist". Root cause: junctions had been removed by `SkillJunctionService.deactivateSync()` (`libs/backend/agent-sdk/src/lib/helpers/skill-junction.service.ts:414`) and no host had recreated them yet. `.claude/commands/orchestrate.md` survived because commands are _copies_ on Windows.

## Current state (verified 2026-08-18)

Pipeline today: `~/.ptah/plugins/<id>` + `~/.ptah/skills` (synth) + `{ws}/.claude/agents` → `UserLayerMirrorService` → `~/.ptah/user/{skills,agents,commands}` → three unrelated fan-outs:

| Fan-out                      | Mechanism                                                                      | Targets                                                                                            | Lifecycle                                                                                         | File                                                          |
| ---------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `SkillJunctionService`       | NTFS junction / dir symlink (skills), copy-on-Win / symlink-on-Unix (commands) | `{ws}/.claude/{skills,commands}`                                                                   | created at VS Code/Electron activation, **deleted on deactivate**; never for CLI/TUI/gateway/cron | `agent-sdk/.../skill-junction.service.ts:264,414,900`         |
| `CliPluginSyncService`       | copy + `.ptah-managed.json`                                                    | `{ws}/.agents/skills` (codex+antigravity), `.github/skills` (copilot), `.cursor/{skills,commands}` | activation + wizard; `cleanupAll()` has **zero callers**; hash tracker never consulted            | `cli-agent-runtime/.../cli-plugin-sync.service.ts:76-145`     |
| `MultiCliAgentWriterService` | transform + raw write                                                          | `.codex/agents/*.toml`, `.github/agents/*.agent.md`, `.cursor/agents/*.md`                         | activation, hash-gated per CLI                                                                    | `agent-generation/.../multi-cli-agent-writer.service.ts:49`   |
| MCP directory                | config write                                                                   | `{ws}/.mcp.json`, `.cursor/mcp.json`, `~/.copilot/mcp-config.json`, `.vscode/mcp.json`             | install/uninstall RPC                                                                             | `cli-agent-runtime/.../mcp-directory/*` — **no codex writer** |
| SDK `plugins:`               | —                                                                              | —                                                                                                  | `pluginPaths` threaded through 4 services, only logged, never passed                              | `sdk-query-options-builder.ts:699,706-794`                    |

### Defect inventory (each becomes an acceptance test)

1. Junctions removed on deactivate → any session between hosts sees no skills.
2. No junctions ever for ptah-cli / TUI / gateway / thoth / cron hosts.
3. Race: `ensureContent()` is fire-and-forget; `activateSkillJunctions` runs before download completes; post-download mirror is **not** followed by junction re-run (`apps/ptah-electron/src/activation/wire-runtime.ts:170-196`). Cold offline first run → zero skills until restart.
4. Promoted synthesized skill (`skill-promotion.service.ts:260-285` → `~/.ptah/skills/<slug>`) fires **no repropagation**; reaches workspace only on next activation.
5. Repropagation `'skill'` event refreshes rival CLIs but **not** `.claude/skills` (`apps/ptah-electron/src/activation/skill-repropagation.ts:37-40`) — new/renamed skill dir invisible to Claude until restart.
6. Harness-builder skills (`~/.ptah/plugins/ptah-harness-*`) never mirrored to user layer → junctioned via overlay only, **never CLI-synced**, no divergence tracking (`harness-fs.service.ts:54-103`; `skill-junction.service.ts:448-520`).
7. Deleted upstream skill/command/agent never reaped from `~/.ptah/user` (`user-layer-mirror.service.ts:739-861` iterate source slugs only) → propagated forever.
8. Divergence reconcile only when a download actually happened (`wire-runtime.ts:180-182`); synth/agent clones can never be rebased (`skills-synthesis-rpc.handlers.ts:1886-1903` returns null for `pluginId: null`).
9. Two `.ptah-managed.json` formats; Claude-commands manifest deleted on deactivate → next host treats Ptah's own copies as user files and refuses to update them (`skill-junction.service.ts:427-441,758-765`).
10. No cross-process lock; rival manifest read-modify-write races drop entries → later "foreign entry" skips.
11. `.claude/agents` is a _source_ (mirror create-if-absent, `user-layer-mirror.service.ts:1391-1399`) while `.claude/skills` is a _target_; hand-edits to `.claude/agents/x.md` after first mirror are ignored until a non-cached download.
12. Codex: no MCP config writer, no commands. Copilot: no commands. Antigravity: no agents.
13. Cron / memory-curator / wizard content-gen sessions hardcode `mcpServerRunning:false` → no Ptah MCP tools (`cron-scheduler/.../job-runner.ts:216`).
14. Rival CLIs spawned with cwd = monorepo sub-folder never see `{ws}/.agents/skills` etc. (installers write workspace root only).
15. Ptah writes no `.gitignore` entries — every artifact lands untracked-but-visible in the user's tree.
16. No verification, no health surface — every failure above is silent.
17. Stale relative literals in shipped content: `assets/plugins/ptah-core/commands/orchestrate.md:19,40` and `.claude/skills/...` refs in `ui-ux-designer/SKILL.md:150,173,176`, `orchestration/references/strategies.md:422,455,533,545,564`, `agent-catalog.md:638,677,699`.
18. `SkillJunctionService`, `CliPluginSyncService`, `CliSkillManifestTracker` have no spec files.

## Target design

### Principles

- **One source, one manifest, one reconciler, N adapters.** `~/.ptah/user/` is the single editable source. Everything downstream is a derived, hash-gated copy owned by a manifest.
- **Copies, never links.** No junctions/symlinks anywhere. Copies survive host death, work for any tool, no NTFS/`rmSync`-follows-junction hazards.
- **Reconcile is idempotent and cheap.** Content-hash per artifact; a no-op reconcile is a directory walk + hash compare, safe to run before every session.
- **Never remove on deactivate.** Removal only on explicit disable / uninstall / upstream deletion, and only manifest-owned entries.
- **Every host reconciles.** VS Code, Electron, ptah-cli, TUI, gateway/thoth, cron all call the same `HarnessReconciler.reconcile(ws)`; plus a preflight in the shared session-start path.
- **Verify and surface.** Reconcile returns `HarnessHealth`; missing artifacts are visible, not silent.

### Lib: `libs/backend/harness-sync/` (new, one concern: reconcile)

```
src/lib/
  manifest/    harness-manifest.builder.ts     desired state from ~/.ptah/user + settings (mcp) + enabled/disabled ids
  reconciler/  harness-reconciler.service.ts   plan → apply → verify; per-workspace file lock
  targets/     harness-target.port.ts          IHarnessTarget { id, detect(ws), diff(desired, actual), apply(plan), verify() }
               claude-target.ts                {ws}/.claude/{skills,commands,agents}  (+ optional SDK plugins: option, see spike)
               codex-target.ts                 {ws}/.agents/skills, .codex/agents/*.toml, ~/.codex/config.toml mcp
               copilot-target.ts               .github/{skills,agents}, ~/.copilot/mcp-config.json
               cursor-target.ts                .cursor/{skills,commands,agents,mcp.json}
               antigravity-target.ts           .agents/skills (+ agents transformer)
  manifest-store/ managed-manifest.ts          ONE format: {version, owner:'ptah', entries:{[relPath]:{hash,source,kind}}}, atomic write, file-locked
  health/      harness-health.ts               per target: expected/found/missing/foreign/skipped
  gitignore/   gitignore-writer.ts             idempotent managed block in {ws}/.gitignore (opt-out setting)
```

Absorbs and deletes: `agent-sdk/helpers/skill-junction.service.ts`, `cli-agent-runtime/cli-agents/cli-skill-sync/*`, `agent-generation/cli-agent-transforms/multi-cli-agent-writer.service.ts` (transformers move here), `apps/*/activation/{skill-repropagation,cli-skill-sync,cli-agent-sync}.ts`, `cli-engine/thoth/cli-skill-repropagation.ts`. MCP installers in `mcp-directory/` become the `mcp` facet of each target (add codex).

### Reconcile triggers

| Trigger                                                                            | Where                                                                                        |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Host activation (after `ensureContent()` **awaited**, then mirror, then reconcile) | all 5 hosts                                                                                  |
| Content download completed (`!fromCache`)                                          | download callback                                                                            |
| `plugins:save-config`, plugin enable/disable, external install/uninstall           | RPC handlers                                                                                 |
| Skill promotion / demotion (synth)                                                 | `skill-promotion.service.ts` → repropagation port                                            |
| Enhancement apply / revert (skill/agent/command)                                   | `skill-enhancer.service.ts:497,627`                                                          |
| Harness-builder create/apply                                                       | `harness-rpc.handlers.ts:343,470` (after mirroring `ptah-harness-*` into user layer)         |
| Workspace folder change                                                            | `IWorkspaceProvider.onDidChangeWorkspaceFolders`                                             |
| **Session-start preflight** (hash-only fast path, applies if drift)                | `SessionQueryExecutor` / options builder shared path; also rival `AgentProcessManager` spawn |
| Manual                                                                             | `ptah harness doctor --fix`, `harness:reconcile` RPC                                         |

### Source-layer fixes (prerequisites for correctness)

- Mirror `ptah-harness-*` plugin dirs into `~/.ptah/user/skills` like any plugin (with sidecar).
- Reap user-layer clones whose upstream disappeared **if not diverged** (diverged → mark `orphaned:true`, keep, surface in UI).
- Run divergence reconcile on every activation, not only `!fromCache`.
- Allow rebase for synth clones (upstream = `~/.ptah/skills/<slug>`) and agent clones (upstream = `.claude/agents/<slug>.md`).
- Make `.claude/agents` direction explicit: it stays a **source** for wizard/harness-authored agents; the reconciler writes rival-CLI agents from user layer and writes **nothing** into `.claude/agents` (avoid source/target loop). Hand-edits detected by hash on every activation, not only on download.
- Unify `activeRoot()` / `candidatesDir` roots in `skill-md-generator.ts:55-63`.

### SDK integration

- Spike: pass `plugins: [{type:'local', path: '~/.ptah/user'}]` (synthesize `.claude-plugin/plugin.json` there) and check whether current `@anthropic-ai/claude-agent-sdk` discovers skills/commands/agents. If yes → Claude target may skip skill/command copies for SDK sessions but **must still copy** for the raw `claude` binary spawned by ptah-cli and for CLI/TUI users; keep copies as the baseline, `plugins:` as an additive optimization. Delete dead `pluginPaths` threading either way.
- Cron / curator / content-gen: pass live MCP port instead of hardcoded `false`.

### Edge-case matrix (must each have a test)

| #   | Case                                                                                   | Expected                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Host deactivates while another host / CLI is running                                   | artifacts remain; second host reconciles no-op                                                                                              |
| E2  | Session starts before first download finished                                          | preflight blocks on `ensureContent()` (bounded timeout), then reconciles; health reports `pending-download` if offline                      |
| E3  | Cold offline first run, no `~/.ptah/plugins`                                           | health `sources-missing`; no crash; next online activation heals                                                                            |
| E4  | Synth skill promoted mid-session                                                       | repropagation event → reconcile → present in all targets without restart                                                                    |
| E5  | Synth skill demoted / plugin disabled / skill disabled                                 | reaped from all targets (manifest-owned only); health shows removed                                                                         |
| E6  | Upstream plugin update with un-edited clone                                            | fast-forward, all targets updated (hash change)                                                                                             |
| E7  | Upstream update with diverged clone                                                    | clone kept, `pendingSourceHash` set, targets carry the clone; UI shows divergence; rebase/keep RPC works for plugin, synth and agent clones |
| E8  | Upstream skill deleted                                                                 | non-diverged clone reaped everywhere; diverged clone kept + `orphaned`                                                                      |
| E9  | User's own real `{ws}/.claude/skills/foo` (not manifest-owned)                         | never touched; health `foreign`                                                                                                             |
| E10 | User hand-edits a Ptah-managed copy in a target dir                                    | overwritten on next reconcile (source wins) **and** logged; edits belong in user layer — surfaced as hint                                   |
| E11 | Two hosts reconcile the same workspace concurrently                                    | file lock (`{ws}/.ptah/.harness.lock`, stale-lock timeout); manifest never loses entries                                                    |
| E12 | Workspace folder change                                                                | old ws untouched (no reap), new ws reconciled                                                                                               |
| E13 | Two workspaces open, different plugin configs                                          | per-workspace manifest; no cross-talk                                                                                                       |
| E14 | Rival CLI spawned with cwd = sub-folder                                                | spawn passes workspace root as cwd or target adapter writes to nearest CLI-discoverable root; documented per CLI                            |
| E15 | Harness-builder skill created                                                          | mirrored to user layer, reaches Claude **and** rival CLIs                                                                                   |
| E16 | Enhancement of skill/agent/command                                                     | all targets updated; revert restores                                                                                                        |
| E17 | Rival CLI not installed                                                                | target skipped; health `target-absent`; installing later + reconcile populates                                                              |
| E18 | Codex MCP                                                                              | `~/.codex/config.toml` `mcp_servers` written/removed with manifest ownership; user's other servers untouched                                |
| E19 | Copilot home-vs-workspace precedence                                                   | home copies reaped as today; verified in health                                                                                             |
| E20 | Windows path length / reserved names / case-insensitive collisions between skill slugs | reconcile reports, does not corrupt                                                                                                         |
| E21 | Antivirus/locked file on Windows during copy                                           | retry with backoff, then health `write-failed`, never partial manifest                                                                      |
| E22 | Extension uninstall / `ptah harness remove`                                            | manifest-owned entries removed from all targets; user files and user layer untouched                                                        |
| E23 | `.gitignore`                                                                           | managed block added once; respected if user removes it (setting)                                                                            |
| E24 | Cron / gateway / curator sessions                                                      | preflight runs; Ptah MCP configured; health logged                                                                                          |
| E25 | Shipped content path literals                                                          | no `.claude/skills/...` relative Read instructions remain in `assets/plugins/**`                                                            |

### Non-goals

- Changing skill authoring format or the user-layer editing UX.
- Marketplace consent flow (`plugin-marketplace`) — unchanged, only its uninstall now triggers reconcile.

## Acceptance

- `SkillJunctionService` deleted; no `symlinkSync`/`junction` in `libs/backend`.
- Every host (VS Code, Electron, ptah-cli, TUI, gateway/thoth, cron) calls `HarnessReconciler.reconcile`; session-start preflight exists in the shared path.
- All 25 edge cases have specs; `harness-sync` ≥ 90% line coverage.
- `ptah harness doctor` prints per-target expected/found/missing; `harness:health` RPC + Marketplace panel badge.
- Defects 1–18 above each closed with a test or explicit "documented unsupported" note in `libs/backend/harness-sync/CLAUDE.md`.
- Root `CLAUDE.md` module index + `libs/backend/harness-sync/CLAUDE.md` written.
