# TASK_2026_278 — Batches

Workflow: Full (Analyze done → Plan → **user validation** → Implement → Verify). Each batch ends green (`typecheck:all`, affected tests) and independently shippable.

## Batch 0 — Stop the bleeding (small, ship first)

- Remove `removeAllManagedJunctions()` + `cleanupManifest()` from `SkillJunctionService.deactivateSync()` (keep unsubscribe only).
- Await `ensureContent()` before `activateSkillJunctions` in both `wire-runtime.ts`; re-run junctions after post-download mirror.
- `'skill'` repropagation → also re-run junctions (Electron + cli-engine).
- Fix `orchestrate.md:19,40` + other `.claude/skills/...` literals in `assets/plugins/ptah-core/**`; regenerate `content-manifest.json`.
- Owner: backend-developer. Tests: `skill-junction.service.spec.ts` (new), `skill-repropagation.spec.ts` update.

## Batch 1 — `harness-sync` lib: manifest, reconciler, Claude target

- Scaffold `libs/backend/harness-sync` (tsyringe `register.ts`, `HARNESS_SYNC_TOKENS`, `index.ts` barrel, CLAUDE.md).
- `HarnessManifestBuilder` from `~/.ptah/user` + enabled/disabled ids + `ptah-harness-*` (after Batch 1b mirror fix).
- `ManagedManifest` single format + atomic write + `{ws}/.ptah/.harness.lock` file lock.
- `HarnessReconciler.reconcile(ws, {mode:'full'|'preflight'})` → `HarnessHealth`.
- `ClaudeTarget` (copies for skills/commands; agents untouched as source). Migration: remove legacy junctions + old `.ptah-managed.json` on first run.
- Wire into VS Code + Electron activation; delete `SkillJunctionService`.
- Owner: software-architect (port contract review) → backend-developer. Tests: E1,E2,E3,E9,E10,E11,E12,E13,E20,E21.

## Batch 1b — Source-layer correctness (user-layer)

- Mirror `ptah-harness-*` into user layer with sidecar.
- Reap deleted-upstream clones (non-diverged) / mark `orphaned`.
- Divergence reconcile on every activation; rebase for synth + agent clones.
- Unify `activeRoot`/`candidatesDir`.
- Owner: backend-developer. Tests: E6,E7,E8,E15 (source half).

## Batch 2 — Rival targets + MCP facet

- Move copy engine + transformers into `codex/copilot/cursor/antigravity` targets; add codex `~/.codex/config.toml` MCP writer, antigravity agents transformer; commands where CLI supports.
- Delete `CliPluginSyncService`, `CliSkillManifestTracker`, `MultiCliAgentWriterService`, host `cli-*-sync.ts` files; `mcp-directory` installers become target MCP facets.
- Owner: backend-developer. Tests: E5,E14,E17,E18,E19,E22.

## Batch 3 — Triggers everywhere + preflight

- Repropagation port → `reconcile`; add promotion/demotion emit in `skill-promotion.service.ts`; harness-builder emit; plugin enable/disable/install/uninstall emit.
- Session-start preflight in `SessionQueryExecutor` shared path + rival `AgentProcessManager` spawn.
- ptah-cli / TUI / gateway-thoth / cron hosts call reconcile at boot; cron/curator/content-gen get live MCP port.
- SDK `plugins:` spike → keep or delete `pluginPaths` threading.
- Owner: backend-developer. Tests: E4,E16,E24.

## Batch 4 — Health surface + gitignore + docs

- `ptah harness doctor [--fix]` (ptah-cli + TUI), `harness:health` + `harness:reconcile` RPC (dual-registration rule), Marketplace/Harness panel badge (frontend-developer, `messaging`-style signal store).
- `.gitignore` managed block + opt-out setting.
- CLAUDE.md updates (root index, harness-sync, agent-sdk, cli-agent-runtime, agent-generation).
- Owner: backend-developer + frontend-developer. Tests: E23,E25 + RPC specs.

## Verify

- code-logic-reviewer + code-style-reviewer on each batch; senior-tester final pass over the E1–E25 matrix; manual: kill VS Code mid-session, run `ptah tui` in same ws, confirm `/orchestrate` loads.
