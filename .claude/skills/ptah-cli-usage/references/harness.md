# Ptah CLI — `ptah harness`

Covers the harness subcommands, the canonical onboarding walkthrough, the
JSON-RPC notifications the harness lifecycle emits, and the two
filesystem verbs (`doctor`, `remove`) that reconcile harness copies on
disk.

---

## 1. What it is

`ptah harness` scaffolds and applies project harness presets — the
configuration bundle that drives sub-agent fan-out, skill activation, and
document generation. Router wiring: `apps/ptah-cli/src/cli/router.ts`.
All subcommands dispatch through shared `HarnessRpcHandlers`, so VS Code,
Electron, and the CLI behave identically.

---

## 2. Subcommand summary

| Subcommand            | Purpose                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `init`                | Create the `.ptah/` scaffolding (pure mkdir, no DI; idempotent — emits `changed:false`).                         |
| `status`              | Inspect `.ptah/` contents (pure fs.readdir, no DI). Emits `harness.status`.                                      |
| `scan`                | Run `harness:initialize`. Emits `workspace_context`, `available_agents`, `available_skills`, `existing_presets`. |
| `apply --preset <id>` | Apply a stored harness preset via `harness:apply`.                                                               |
| `preset save <name>`  | Persist a `HarnessConfig` (read from `--from <path>`) via `harness:save-preset`.                                 |
| `preset load`         | Emit `harness.preset.list` via `harness:load-presets`.                                                           |
| `chat`                | Alias for `ptah session start --scope harness-skill` (full streaming surface).                                   |
| `analyze-intent`      | Analyze a free-form intent via `harness:analyze-intent`; emits `harness.intent.analysis`.                        |
| `design-agents`       | Design sub-agents via `harness:design-agents`.                                                                   |
| `generate-document`   | Generate a project document via `harness:generate-document` (`--kind prd` or `--kind spec`).                     |
| `doctor`              | Report harness health; `--fix` reconciles first. Exits **1** when degraded (see §5).                             |
| `remove`              | Delete every manifest-owned harness copy in the workspace. Requires `--yes`.                                     |

---

## 3. End-to-end walkthrough

The canonical onboarding flow — bootstrap a workspace, design agents,
apply a preset, then run a Team-Leader-flavored chat session:

```bash
# 1. Scaffold the .ptah/ tree (idempotent).
ptah harness init --dir .

# 2. Inspect what was created.
ptah harness status
# stdout: harness.status { dirs: [...], files: [...] }

# 3. Run a full workspace scan — emits four notifications:
#      workspace_context, available_agents, available_skills, existing_presets
ptah harness scan

# 4. (Optional) Generate a PRD from the current workspace.
ptah harness generate-document --kind prd
# stdout: harness.document.stream { chunk: "..." } × N
# stdout: harness.document.complete { path: ".ptah/specs/<id>/prd.md" }

# 5. Analyze a free-form intent (used for downstream design-agents).
ptah harness analyze-intent --intent "add a CSV importer with progress UI"
# stdout: harness.intent.analysis { task_type, complexity, suggested_agents, ... }

# 6. Design sub-agents from the analyzed intent + workspace context.
ptah harness design-agents --workspace
# stdout: harness.agent.designed { name, role, model_tier } × N

# 7. Persist the resulting HarnessConfig as a named preset.
ptah harness preset save my-importer --from ./harness-config.json \
  --description "CSV importer w/ progress"

# 8. Apply the preset to the workspace (writes .ptah/agents/*.md).
ptah harness apply --preset my-importer

# 9. Drive the actual Team-Leader-flavored session, auto-approving every
#    permission gate (mandatory for unattended runs).
ptah --auto-approve harness chat --task "implement the importer per the preset" \
  --profile harness-skill
```

`--auto-approve` is a **global** flag: it goes before `harness`, not
after `chat`. Subcommand-local options (`--task`, `--profile`, `--from`,
`--preset`, `--kind`, `--dir`) go after the subcommand.

---

## 4. Resulting JSON-RPC trail

`harness chat` is a streaming command — it tunnels through the same
`session start` machinery, so the agent-turn spine in
`references/jsonrpc.md` applies. The notifications unique to the harness
lifecycle:

```
harness.initialized       (scan complete; workspace_context + agents + skills loaded)
harness.intent.analysis   (analyze-intent result)
harness.agent.designed    (per designed sub-agent)
harness.preset.saved      (preset save complete)
harness.preset.list       (preset load result)
harness.applied           (apply complete; written file list)
harness.document.stream   (generate-document streaming chunks)
harness.document.complete (generate-document final path + summary)
harness.doctor            (doctor / doctor --fix report)
```

`harness chat` overlays these on top of the standard
`agent.thought → agent.tool_use → agent.tool_result → agent.message`
stream — every chat turn the Team Leader prompt invokes the SDK's
built-in `Task` tool to fan out to designed sub-agents, and each
sub-agent emits its own nested stream prefixed with the parent turn id.

---

## 5. `ptah harness doctor` and `ptah harness remove`

These two are filesystem verbs, not agent commands: they walk
`~/.ptah/user`, hash-compare against the per-target manifests, and copy
or unlink.

### `ptah harness doctor [--fix] [--json]`

Calls `harness:health`, or `harness:reconcile` under `--fix`, and emits
one `harness.doctor` notification: a per-target table (detected,
per-facet support, expected / found / missing / foreign / writeFailed /
overwritten), then in `--human` mode the paths behind those counts
grouped by kind (missing, foreign, adopted, removed — 20 per group, then
`+N more`; `--json` always carries the full arrays), then sources status
and a summary line.

The path lists are load-bearing: a `foreign` entry is one Ptah is
deliberately refusing to touch, so clearing it means the **user** moving
the file, which they cannot do from a count.

**It exits `1` when the harness is degraded or in error** — any detected
target missing entries, `sources !== 'ok'`, or a write failure. This is
deliberate: the command is meant to work as a CI gate on harness drift.
An offline run reports `pending-download` / `sources-missing`, which
grades as degraded, so the exit code is still `1`.

Note the local `--json` on this subcommand: it forces machine output even
after an earlier `--human`, so `ptah harness doctor --json` is correct
here in addition to the global `ptah --json harness doctor`.

### `ptah harness remove --yes`

Deletes every manifest-owned harness copy in the workspace via
`harness:remove`. `--yes` is **required** — there is no prompt, because
the CLI's default mode is machine output on a pipe.
