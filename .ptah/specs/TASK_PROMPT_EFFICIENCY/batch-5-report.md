# Batch 5 — OpenCode harness-sync target

Adds an `opencode` harness target so Ptah's 15 subagents reach OpenCode, and so
an MCP server installed for OpenCode persists in the project config instead of
living only for the lifetime of one Ptah-spawned session.

---

## 1. Verified OpenCode format facts

The installed CLI on this machine is **opencode v2.0.12**
(`~/AppData/Roaming/npm/node_modules/@opencode/cli`). Docs alone were not
trusted here, because the v1 and v2 documentation contradict each other on the
agent directory. Every fact below is either quoted from a source URL or observed
live against the running server on 2026-09-22, and the live observations win.

### Sources

| # | Source | Used for |
|---|---|---|
| S1 | <https://opencode.ai/docs/agents/> | frontmatter keys, `mode: subagent` semantics |
| S2 | <https://opencode.ai/v2/docs/agents/> | v2 frontmatter, deprecated legacy fields |
| S3 | <https://opencode.ai/docs/cli/> | `opencode agent create --path` default directory |
| S4 | <https://opencode.ai/docs/config/> | `opencode.json` location, `mcp` remote example |
| S5 | <https://opencode.ai/config.json> (the published JSON Schema) | authoritative `McpRemoteConfig` / `McpLocalConfig` / `AgentConfig` shapes |
| S6 | Live probe of opencode v2.0.12 via `opencode api GET /api/agent` and `GET /api/config` | everything marked **verified live** |

### Agent file format

**Directory — the docs conflict, and BOTH spellings actually work.**

- S3 documents `opencode agent create --path` as defaulting to
  "`global or .opencode/agent based on the prompt`" — **singular**.
- S2 (v2 docs) shows `.opencode/agents/<name>.md` — **plural**.
- **Verified live:** probe agents were written to `.opencode/agent/` *and*
  `.opencode/agents/` in the same project; `GET /api/agent` returned **both**.
  v2.0.12 scans both directories.

Ptah writes the **singular `.opencode/agent/<id>.md`**, matching S3's documented
project default and the task's specification. A user already keeping agents in
the plural directory is unaffected.

**Frontmatter — verified live, three findings:**

| Finding | Evidence |
|---|---|
| `description` + `mode: subagent` is sufficient; the filename becomes the agent id | probe `ptah-probe-min.md` loaded with `mode=subagent`, description intact |
| **Unknown keys are tolerated** — `name`, `source: ptah`, `target-cli` did not prevent loading | probe `ptah-probe-marked.md` loaded, `description` and `mode` preserved |
| **`model: opus` makes OpenCode DROP THE AGENT ENTIRELY** | probe `ptah-probe-modeltier.md` was absent from `GET /api/agent` in the same query where its two siblings in the same directory loaded |

That third finding is the single most important one in this batch. The repo's
real sources (e.g. `.claude/agents/backend-developer.md`) carry `model: opus`.
OpenCode wants a resolvable `provider/model` pair (S1: e.g.
`anthropic/claude-sonnet-4-20250514`); a Claude tier word is not one, and the
failure is **silent and total** — not a degraded model, not a default, the agent
simply does not exist. So `model` is **never emitted**, and the subagent
inherits the session model. This is the same decision `CodexAgentTransformer`
made for the same reason, and it is pinned by two tests.

`AgentConfig` keys per S5: `model, variant, temperature, top_p, prompt, tools,
disable, description, mode, hidden, options, color, steps, maxSteps, permission`.
S2 additionally warns: *"Do not use legacy top-level fields such as
`temperature`, `top_p`, `prompt`, `permission`, `tools`, `disable`, or
`maxSteps` in new V2 agent configuration."* Ptah emits none of them — only
`description`, `mode`, and its two ownership markers.

### MCP config format

Project config is **`opencode.json` in the project root** (S4: *"Project config
has the highest precedence among standard config files"*). Confirmed live: the
server listed the project `opencode.json` as a loaded config document.

`McpRemoteConfig` per S5 (`additionalProperties: false`, required `type` + `url`):

```json
{ "mcp": { "ptah": { "type": "remote", "url": "https://…", "enabled": true } } }
```

`McpLocalConfig` per S5 diverges from every other JSON target Ptah writes:

```json
{ "mcp": { "x": { "type": "local", "command": ["npx","-y","pkg"], "environment": {"A":"b"} } } }
```

Three divergences, all schema-enforced:

1. `type` is **required**, and its values are `remote` / `local` — not Ptah's
   `http` / `sse` / `stdio`.
2. A local server's `command` is **one array** holding executable *and*
   arguments. There is **no `args` key**.
3. The environment is **`environment`**, not `env`.

**Flat `mcp.<name>` vs nested `mcp.servers.<name>` — both accepted.** Verified
live: writing the flat form and reading `GET /api/config` back showed opencode
had normalized it into `mcp.servers.<name>` with `enabled: true` rewritten to
`disabled: false`; writing the nested form passed through unchanged. Ptah writes
the **flat** form because it is the only one S5 documents, and because it is
already the shape Ptah's own spawn path puts in `OPENCODE_CONFIG_CONTENT` (per
`opencode-context-probe.md`). Two Ptah writers agreeing on one shape beats
matching an internal representation.

`enabled` is deliberately never written: it defaults to true and is not modelled
by `hashMcpConfig`, so emitting it would make every entry read back differently
from how it was written and be rewritten on every reconcile pass.

---

## 2. Files added / changed

### Added

| File | What |
|---|---|
| `libs/backend/harness-sync/src/lib/targets/transformers/opencode-agent-transformer.ts` | `.opencode/agent/<id>.md` writer. `description` + `mode: subagent` + `source: ptah` marker; body via `transformAgentBody(content, 'opencode')`; `model` never emitted |
| `libs/backend/harness-sync/src/lib/targets/transformers/opencode-agent-transformer.spec.ts` | 12 tests incl. real round-trip of `.claude/agents/backend-developer.md`, idempotent re-transform, and two `model`-omission regression tests |
| `libs/backend/harness-sync/src/lib/targets/mcp/opencode-mcp-facet.spec.ts` | 15 tests: schema, flat-vs-nested, round-trip/no-op hashing, other keys preserved, concurrency |

### Changed — `libs/backend/harness-sync`

| File | What |
|---|---|
| `targets/mcp/mcp-json-format.ts` | new `McpJsonDialect` (`standard` \| `opencode`); `configToJson` gained an optional 4th `dialect` param; `jsonToConfig` now accepts `local`/`remote`, array `command`, and `environment` **unconditionally** — same one-reader-for-every-dialect rule the file already applied to `serverUrl` |
| `targets/mcp/json-mcp-facet.ts` | new optional `dialect` option, passed to `configToJson` |
| `targets/mcp/mcp-facet.registry.ts` | `opencode` case (`opencode.json`, `rootKey: 'mcp'`, `includeType`, `dialect: 'opencode'`) + `MCP_FACET_TARGETS` entry |
| `targets/rival-targets.ts` | `createOpencodeTarget`, registered in `createRivalTargets`; doc matrix row; documented why `skills` and `commands` are `unsupported` |
| `targets/transformers/transform-rules.ts` | `CLI_TOOL_MAPPINGS.opencode` (`opencode run --agent`, verified from `opencode run --help`) |
| `manifest/harness-manifest.builder.ts` | added `opencode` to the local target-id set — without it an MCP intent for opencode is silently dropped from the desired state |
| `src/index.ts` | exports `createOpencodeTarget`, `OpencodeAgentTransformer`, `McpJsonDialect` |

### Changed — `libs/shared`

| File | What |
|---|---|
| `types/harness-sync.types.ts` | `HARNESS_TARGET_IDS` += `'opencode'` |
| `types/mcp-directory.types.ts` | `McpInstallTarget` += `'opencode'`; documented its config location and dialect |
| `types/cli-skill-sync.types.ts` | `CliTarget` Extract += `'opencode'` (`CliType` already contained it) |
| `types/rpc/rpc-harness.schemas.ts` | `installTargets` zod enum += `'opencode'` |

Facet matrix for the new target: `agents: supported`, `mcp: supported`,
`skills: unsupported`, `commands: unsupported`.

- **skills** is *not* a gap: OpenCode discovers `.claude/skills` and
  `.agents/skills` itself, and Ptah already fills both for other targets. A
  third co-owner of `.agents/skills` would duplicate every skill for no
  behavioural change. The probe confirms OpenCode already sees every Ptah skill.
- **commands** is left unsupported rather than guessed. OpenCode has a command
  concept (`Config.command`, `GET /api/command`), but its project-level
  discovery rules were not established, and declaring a directory the CLI may
  not read is the exact failure the Codex `commands` row already records.

---

## 3. Test and lint results

```
npx nx run-many -t test,lint -p harness-sync --output-style=static
```

- **test — PASS.** `Test Suites: 48 passed, 48 total. Tests: 414 passed, 414 total.`
- **lint — PASS.** `5 problems (0 errors, 5 warnings)`. All five warnings are
  pre-existing and in files this batch did not touch
  (`gitignore-writer.ts`, `harness-preflight.service{,.spec}.ts`,
  `codex-project-trust.ts`, and `workspace-target.ts` `max-lines`).

`ptah_get_diagnostics` scoped to all ten changed/added files: **0 errors, 0 warnings.**

---

## 4. BLOCKING — two one-line fixes needed in libs I do not own

Widening `HarnessTargetId` and `McpInstallTarget` breaks two exhaustive
`Record<>` maps outside this batch's ownership (`libs/backend/harness-sync/**`
and `libs/shared/**`). Both are hard TS2741 compile errors, confirmed by
`ptah_get_diagnostics`, and **both must be applied before the repo type-checks**:

1. `libs/frontend/marketplace/src/lib/harness/harness-health.model.ts:76`
   — `TARGET_LABELS: Readonly<Record<HarnessTargetId, string>>` needs
   `opencode: 'OpenCode',`
2. `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts:57`
   — `Record<McpInstallTarget, string>` needs an `opencode` label.

(A third error surfaced in the same scan,
`harness-health.store.spec.ts:672` — `Type 'string' is not assignable to type
'HarnessWriteFailure'` — is **pre-existing and unrelated** to target ids; it
belongs to other in-flight work on this branch.)

---

## 5. Soft gaps left deliberately — opencode will not be reachable everywhere yet

These compile fine and fail quietly. None is in a lib I own; each needs one
literal added. Listed so the follow-up batch has the full set:

| Location | Consequence |
|---|---|
| `libs/backend/rpc-handlers/.../harness-rpc.schema.ts:102` zod enum, and **`:117` `.max(6)`** | `harness:reconcile` rejects `targets: ['opencode']`; the `.max(6)` now rejects a caller naming all seven targets |
| `libs/backend/rpc-handlers/.../mcp-directory-rpc.schema.ts:62` | uninstall for opencode rejected |
| `libs/backend/rpc-handlers/.../external-plugin-mcp.service.ts:109,115` | plugin-declared MCP servers never reach opencode |
| `libs/backend/cli-agent-runtime/.../mcp-install.service.ts:85` `ALL_TARGETS` | a bare uninstall leaves the opencode entry behind |
| `libs/backend/cli-agent-runtime/.../cli-adapter.utils.ts:453` `ROLE_TRANSFORM_TARGETS` | opencode role blocks skip `transformAgentBody` |
| `libs/backend/vscode-lm-tools/.../harness-namespace.builder.ts:201` and `.../tool-description.builder.ts:1513` | the `ptah_harness_install_mcp_server` tool boundary rejects opencode, and the model never sees it as an option |
| `libs/backend/vscode-lm-tools/.../ptah-mcp-slots.ts:159` `SLOT_SPECS` | Ptah's own MCP server is not persistently declared into `opencode.json` (it still arrives per-spawn via `OPENCODE_CONFIG_CONTENT`) |
| `apps/ptah-cli/.../mcp.ts:82` `VALID_TARGETS`, `router.ts:1733,1750` help strings | `ptah mcp --target opencode` rejected |

---

## 6. Could not verify

- **`.opencode/agent` vs `.opencode/agents` precedence.** Both load; what
  happens when the *same agent id* exists in both was not tested.
- **Whether `opencode` is detected by `IHarnessCliDetector`.** The target calls
  `detector.isInstalled('opencode')`; `CliType` already contains `'opencode'`
  and `harness-cli-detector.ts` falls through to the real probe for any id that
  is not `claude`/`vscode`, so this should work — but the adapter registration
  lives in `cli-agent-runtime` (not owned here) and was not exercised end to end.
- **The written `opencode.json` was never loaded by a real OpenCode session.**
  The dialect is verified against the published schema and against live
  normalization of an equivalent hand-written file, not against a file this
  facet produced.
- **`GET /api/agent` returns `[]` when no model provider resolves.** Agent
  listing in a sandbox without credentials is empty even for built-ins, and the
  service caches aggressively; the conclusive probes were run against the
  authenticated background service with an explicit `location[directory]`.
- **OpenCode's project-level command discovery** — not investigated, hence
  `commands: 'unsupported'`.

All probe artifacts written outside the worktree (`~/.opencode/agent`,
`~/.opencode/agents`, a temp project) were removed; `~/.opencode` is back to
containing only `bin`.
