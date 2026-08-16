# Context — TASK_2026_233

## Where this came from

Commit `5cdb14d89` (`feat(vscode): add the crucible move, and discover vendors instead of hardcoding`) added the Crucible move to the `tribunal` skill, made Relay's phase→lane roster pinnable, added a Verified Delegation rule to `orchestration`, and removed every hardcoded vendor list from those two skills in favour of runtime discovery through `ptah_agent_list`.

Two reviewers (`code-logic-reviewer`, `code-style-reviewer`) audited that change. Their blocking and major findings were fixed in the same commit. What follows is the residue: findings that are real but out of that commit's scope, plus two defects found while verifying reviewer claims against source.

The governing principle, for whoever picks this up: **the set of AI CLI vendors is discovered at runtime, never written down.** Adapters ship between releases and every user configures a different provider set. Any list baked into a doc, a description string, or a type union is wrong on somebody's machine. Evidence from this workspace's own `ptah_agent_list`:

```
| Agent        | Type     | Status        | Capabilities                                      |
| cursor       | cli      | not installed | steer: no                                         |
| ollama cloud | ptah-cli | available     | provider: Ollama Cloud, ptahCliId: pc-d8f4e156-…  |
| claude fable | ptah-cli | available     | provider: Claude (Subscription), ptahCliId: pc-76…|
```

No codex. No copilot. Both appear in nearly every hardcoded list in the codebase.

---

## Finding 1 — MCP tool descriptions hardcode provider names (highest value)

**File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts:494-495`, `:529`

```ts
'Supports CLI agents (Codex, Copilot, Cursor, Antigravity, opencode, Pi) ' +
'and Ptah CLI agents (OpenRouter, Moonshot, Z.AI). ' +
```

and, on the `ptahCliId` parameter:

```ts
'Ptah CLI agents are user-configured Anthropic-compatible providers ' +
'(OpenRouter, Moonshot, Z.AI, etc.). When set, cli parameter is ignored.',
```

**Why it matters more than the skill docs did**: a tool description is loaded into every agent's context before it picks a lane, and it reads as authoritative. The ptah-cli list is a hardcoded three that omits Ollama Cloud, Claude, LM Studio, Sakana and anything else in `AnthropicProviderId` (`libs/shared/src/lib/providers/provider-registry.ts:452-462`). An agent that trusts it will not consider a provider the user actually configured.

The CLI list at `:494` is at least generated-adjacent — the `cli` enum below it is built from `[...SYSTEM_CLI_TYPES]`, so the enum stays correct while the prose beside it drifts.

**Fix direction**: derive the prose from the same sources the enum uses (`SYSTEM_CLI_TYPES`, the provider registry), or drop the enumerations entirely in favour of "call `ptah_agent_list` to see what is available". The second is cheaper and cannot drift.

## Finding 2 — `ptah_agent_status` does not document the field every resume path depends on

**File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts:589-592`

```ts
'Returns agentId, status (running/completed/failed/timeout/stopped), ' +
'cli, task, startedAt, duration, and exitCode.',
```

The response also carries `**CLI Session ID:**` when the adapter reports one — `mcp-core/mcp-response-formatter.ts:496-497`, `:532-533`, `:596-597`.

**Why it matters**: both skills were just rewritten to decide resume-vs-respawn by checking `ptah_agent_status` for a `CLI Session ID`, precisely so the decision stops depending on a memorized per-vendor table. A reviewer reading only this description concluded that field never appears and that every resume path in both skills was therefore dead code. It was a false alarm, but a cheap one to prevent.

**Fix direction**: add `cliSessionId` (when present) to the documented return fields.

## Finding 3 — the `.github/skills` clone is stale

**Path**: `.github/skills/tribunal/`, `.github/skills/orchestration/`

These are managed clones of the `ptah-core` plugin skills, tracked by `.ptah-origin.json` with a `sourceHash` / `currentContentHash` pair and a `diverged` flag, reconciled by `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts` (`computeSourceHash` hashes the whole clone directory).

`5cdb14d89` deliberately edited only the plugin source, leaving the clone behind — hand-editing it would fight the reconcile mechanism rather than use it. The clone is now missing Crucible entirely and still carries every hardcoded vendor list the commit removed.

**Fix direction**: re-sync through the skill-clone UI, then confirm `diverged` reads false. Worth checking whether any other cloned skill has silently diverged the same way.

## Finding 4 — `TribunalMove` cannot express two of the five moves

**File**: `libs/frontend/tribunal-panel/src/lib/types/tribunal-ui.types.ts:4`

```ts
export type TribunalMove = 'council' | 'forge' | 'race';
```

Relay and Crucible are skill-only and unreachable from the Tribunal wizard. Relay set that precedent, so this is a deliberate gap rather than a regression — but with two of five moves now missing, the wizard no longer represents the skill.

**Scope if picked up**: the union, `step-pick-move.component.ts`, `tribunal-run.service.ts`, `tribunal-state.service.ts` and their specs. Note Crucible needs a two-role lane picker (executor / judge), not the flat panel builder the other moves share, so this is not a one-line union widening.

## Finding 5 — the sweep only covered two skills

`apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/` holds more than `tribunal` and `orchestration`. One known hit outside the swept set:

- `skills/ptah-cli-usage/SKILL.md:696` — `agent_cli.models { codex, copilot }`. This one may be correct as-is; it appears to name an RPC notification's actual field names rather than advertise a vendor roster. Verify before touching.

`skills/orchestration/references/agent-catalog.md:779` was checked and is fine — it reads `[injected from ptah_agent_list — e.g., "ptah-cli, codex"]`, which is explicitly a placeholder.

**Fix direction**: grep the remaining skills for vendor names presented as authoritative, applying the same test used in the sweep — _an illustration marked as an illustration is fine; an assertion that drives selection is not._

## Finding 6 — pre-commit `nx` instability (environment, not code)

Committing `5cdb14d89` needed four attempts:

1. `Io error. Look inside err_kind for more details.` — raised **after** `validate-deps` printed `Successfully ran target validate-deps for project ptah-electron and 29 tasks`.
2. Identical failure on retry.
3. `npx nx daemon --stop` cleared it, but the resulting cold rebuild exceeded the command timeout and was killed (exit 130).
4. Succeeded once the cache was warm.

Nx also reported `@ptah-extension/shared:build` and `@ptah-extension/agent-sdk:build` as flaky across those runs; `agent-sdk:build` succeeds cleanly when run standalone.

**Why file it**: the hook fails _after_ its real check passes, which invites `--no-verify` as the path of least resistance. Worth confirming whether the IO error is a daemon race on a large working tree — this one had ~40 unrelated files staged at the time — or something reproducible in CI.

---

## Resolution — F1, F2, F5 (2026-08-16)

Findings 1, 2 and 5 are fixed. **3, 4 and 6 are untouched** and are why this
task is still `in_progress`.

### The code layer was wider than the report

The report named two sites in `tool-description.builder.ts`. A grep of
`code-execution/` for vendor names found **six files**, and the worst of them
was not in the report at all:

- `ptah-system-prompt.constant.ts:203`, `:225-229` — an **Available Agents
  table** listing only `codex`, `copilot` and `ptah-cli`, the last one with the
  same hardcoded provider trio. This is worse than the tool description: it
  omits four of the six shipped adapters, and the system prompt is appended to
  every agent's context. Replaced with the two families, the system one
  interpolated from `SYSTEM_CLI_TYPES`, and an explicit instruction that a
  vendor named in any document — including that prompt — is an illustration.
- `system-namespace.builders.ts:233`, `:237` — `ptah.agent` help advertised
  "Codex CLI or Copilot CLI" and typed `cli?: 'codex'|'copilot'`, a two-member
  union against a real six. Now interpolated from `SYSTEM_CLI_TYPES`, and the
  worked example calls `list()` and spawns what it finds instead of naming a
  vendor.
- `mcp-response-formatter.ts:430` — the no-agents-found message told the user to
  install two specific CLIs.
- `agent-namespace.builder.ts:6` — header comment.
- `tool-description.builder.ts:1685` — the `ptah.agent.*` one-liner.
- `tool-description.builder.ts:558` — `modelTier`'s "opus → kimi-k2-thinking for
  Moonshot, opus → glm-5-code for Z.AI" and `model`'s "claude-sonnet-4.6 for
  Copilot". Both were marked `e.g.`, but a per-vendor tier table is precisely
  the memorized mapping the sweep exists to kill, and those model ids drift on
  their own.

### F5 — the sweep found one real defect, not a style issue

Only `ptah-cli-usage` and `humanize-library` were outside the swept set.
`humanize-library`'s two hits are `.cursorrules`, a filename. `ptah-cli-usage`'s
twenty-one hits are almost all legitimate: per-provider auth walkthroughs, real
setting-key names, the `agent-cli` allowlist. But `:689` and `:696` — the two
the report said to verify before touching — are **stale, not merely branded**:
they document `AgentListCliModelsResult` as `codex`, `copilot` when
`rpc-agents.types.ts:123-130` carries six keys (`opencode` and `pi` were added
by TASK_2026_160). Rewritten to describe the shape as one array per system CLI
adapter, so it cannot go stale again.

### The ratchet

`code-execution/vendor-roster-drift.spec.ts` (35 assertions) is what
`5cdb14d89` lacked. It collects every agent-facing string — system prompt,
`ptah.agent` help, both agent tool descriptions, every `ptah_agent_spawn`
parameter description, and the empty `formatAgentList` — and asserts no provider
brand appears in any of them, that the system CLI family matches
`SYSTEM_CLI_TYPES` exactly, that the spawn enum is still the source it was
derived from, and that the derived lists actually evaluated. The last check
matches on `${SYSTEM_CLI_TYPES` rather than a bare `${` because the system
prompt carries TypeScript samples with deliberately escaped interpolations.

**Gates**: `vscode-lm-tools` 798 tests green across 41 suites (763 before),
`nx affected -t typecheck` clean across 91 projects, lint 0 errors.

### Still open

- **F3** — the `.github/skills` clones are still stale; needs the skill-clone
  UI, not a hand-edit.
- **F4** — Relay and Crucible still unreachable from the Tribunal wizard.
  Crucible needs a two-role executor/judge lane picker, so this is its own task.
- **F6** — no `nx` IO error reproduced while committing this work or
  TASK_2026_252 immediately before it. Unreproduced, not fixed.

## Not included here

Everything the reviewers rated blocking or major in the swept files was fixed in `5cdb14d89`: the false `Codex does not support resume` claim (refuted by `codex-cli.adapter.ts:499` calling `codex.resumeThread`), the `ptah-cli > codex > copilot` priority fallbacks in `cli-agent-delegation.md` and `checkpoints.md`, the wrong `ptah_agent_spawn` parameter table, the `ptah_agent_list` response shape that documented a JSON `available_clis` field the tool has never returned, the SKILL.md comparison rows that contradicted Crucible, the ambiguous 2-vs-3 round cap, and the double-negative regression stop.
