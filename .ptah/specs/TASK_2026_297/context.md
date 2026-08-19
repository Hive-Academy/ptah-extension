# Context

## Where this came from

Found during TASK_2026_296 Batch 2, which added a Zod schema to
`agent:resumeCliSession`. The schema rejected what `ptah agent-cli resume`
sends. Investigating whether B2 had broken a working command showed it was
never working — so B2 changed nothing except where and how it fails.

`../TASK_2026_296/tasks.md` §Follow-ups F1 records the finding. This task is
that follow-up.

## The defect

Two gates that contradict each other.

**Gate 1 — the CLI allowlist** (`apps/ptah-cli/src/cli/commands/agent-cli.ts:131-141`):

```ts
export function validateCliAgent(cli: string | undefined): AllowlistedCli | null {
  if (!cli) return null;
  switch (cli) {
    case 'glm':
      return cli;
    default:
      return null;
  }
}
```

`CLI_AGENT_ALLOWLIST = ['glm'] as const` (`:48`), and `--cli` is a
`requiredOption` on `resume` and `stop` (`router.ts:734`, `:748`). So the literal
string `'glm'` is the only value that reaches an RPC call.

**Gate 2 — the wire type** (`libs/shared/src/lib/types/agent-process.types.ts:62-73`):

```ts
export const SYSTEM_CLI_TYPES = ['codex', 'copilot', 'cursor', 'antigravity', 'opencode', 'pi'] as const;
export type CliType = SystemCliType | 'ptah-cli';
```

`'glm'` is not in it. Which is why `agent-cli.ts:324` reads
`cli: allowed as unknown as CliType`. **A single cast would not compile** — the
types do not overlap. The double cast is the code admitting the value is wrong
and silencing the compiler rather than fixing it.

**Downstream.** `AgentProcessManager.doSpawn` calls
`cliDetection.getDetection(cli)` (`agent-process-manager.service.ts:323`), which
is `detectAll().find(r => r.cli === cli)`. `detectAll()` enumerates the six
system CLIs, so `find` returns `undefined` and `:335` throws
`"glm CLI is not installed. Install it and run authentication before using."`

**The allowlist permits exactly one value, and that value is the one the backend
cannot route.**

## The second bug in the same call

`agent-cli.ts:325` — `task: opts.task ?? ''`.

This is the exact defect class TASK_2026_296 exists to remove: a producer
inventing a value for a field it cannot fill. `--task` is documented as optional
with default `""`, but `agent:resumeCliSession` means "resume this session AND
give it this work" — the sole in-app caller,
`AgentMonitorStore.resumeAgentWithMessage` (`agent-monitor.store.ts:1321-1336`),
always passes a real message. An empty task is a caller that lost its prompt.

`AgentResumeCliSessionParamsSchema` (added by TASK_2026_296 B2) puts `.min(1)`
on `task`, and **that is correct** — do not weaken the schema to accommodate the
CLI. Fix the CLI.

## What the backend already does right — do not change it

`agent-rpc.handlers.ts:779-811` is complete and correct:

```ts
let ptahCliId = params.ptahCliId;
if (params.cli === 'ptah-cli' && !ptahCliId) {
  ptahCliId = await this.resolveDefaultPtahCliId();
}
if (params.cli === 'ptah-cli' && ptahCliId) {
  result = await this.resumePtahCliSession({ ...params, ptahCliId }, workspaceRoot);
} else if (params.cli === 'ptah-cli') {
  throw new Error('No Ptah CLI agents configured. Add one in Agent Orchestration settings.');
} else {
  /* system-CLI spawn path */
}
```

- `resolveDefaultPtahCliId()` (`:931`) picks the first agent that is `enabled && hasApiKey`.
- `resumePtahCliSession()` (`:854`) spawns through `ptahCliRegistry.spawnAgent` and records `cli: 'ptah-cli'` + `ptahCliId`.
- A missing provider produces a clear, actionable error.

**No backend change is in scope.** The fix is entirely in `apps/ptah-cli` plus
documentation.

## The conceptual error to fix, not just the symptom

`--cli glm` is a **user-facing allowlist label**. `CliType` is a **wire type**.
They are different vocabularies, and the bug is that the code conflated them
with a cast instead of translating between them.

GLM is a **`ptah-cli` provider** — an Anthropic-compatible endpoint (Z.AI GLM)
addressed by `ptahCliId`. `agent-process.types.ts:59-60` states this explicitly:

> `ptah-cli` is deliberately NOT a member: those agents are user-configured
> Anthropic-compatible providers selected by `ptahCliId`, not a binary name.

So the fix is an explicit mapping from allowlist label → `{ cli, ptahCliId? }`,
with the cast deleted. Once a real mapping function exists, the compiler is
telling the truth again and a seventh label cannot be added without deciding
what it maps to.

## Scope

### 1. `resume` — make it work (the whole point)

- Map the allowlist label to `cli: 'ptah-cli'` on the wire. **Delete `as unknown as CliType`.**
- Add an optional `--ptah-cli-id <id>` flag. When omitted, send nothing and let
  `resolveDefaultPtahCliId()` do its job — that path is already implemented and
  already produces a good error when no provider is configured. Do **not**
  re-implement resolution in the CLI.
- **`--task` becomes required non-empty.** Validate it the way `<id>` is already
  validated at `:308-311` — write to stderr, return `ExitCode.UsageError` (2).
  **Delete `?? ''`.**

### 2. `stop` — the allowlist gate is cosmetic

`runStop` (`:268-299`) requires `--cli`, validates it, then calls `agent:stop`
with `{ agentId }` only — `cli` is never sent. So `stop` works, but forces the
user to type a flag that reaches nothing, and rejects with exit 3 if they
type anything else. Decide and implement one of: make `--cli` optional on
`stop`, or keep it and document that it is a client-side guard only. State the
reason in the code. **Do not silently leave it as-is.**

### 3. `models list --cli glm` — hardcoded degenerate branch

`runModelsList` (`:253-264`) calls the RPC, then for the scoped case discards
the result and emits a hardcoded `{ cli: 'glm', models: [] }`. The unscoped
branch reports only `codex` and `copilot` even though `AgentListCliModelsResult`
covers more. `jsonrpc-schema.md` §11.4 already admits "the scoped `glm` path
returns an empty array today". Either wire it to the real per-provider model
list or make the emptiness explicit and honest in both code and docs.

### 4. Documentation — four places, one of which ships

- `apps/ptah-cli/README.md:214-226` — command table.
- `apps/ptah-cli/docs/jsonrpc-schema.md` §11 (§11.4, §11.5, §11.6) — the full reference.
- `apps/ptah-cli/CLAUDE.md` — the `--cli glm` guideline.
- `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-cli-usage/SKILL.md`
  (~`:398-404`, `:614-620`, `:626-740`) — **this ships to users as a skill that
  teaches an agent how to drive the CLI.** It currently teaches a command that
  cannot succeed. Highest-priority doc fix.

### 5. Tests that would have caught this

`agent-cli.spec.ts:586` mocks the RPC, so it asserts the _call shape_ and never
the outcome. That is why a permanently-failing command stayed green.

Add at least one test per fixed subcommand that exercises the real handler —
or, if full wiring is impractical, assert the exact wire payload against
`AgentResumeCliSessionParamsSchema` so the CLI cannot send something the
boundary rejects. **A test that mocks the transport must not be the only
coverage of a value the transport validates.**

## Phase 2 — the allowlist itself is inverted (user decision, 2026-08-19)

Phase 1 fixed the _translation_ (`glm` → `cli: 'ptah-cli'`) and deliberately left
`CLI_AGENT_ALLOWLIST` alone. Investigating why `glm` was the only entry showed
the list is not a policy at all.

### How it got this way

`ptah agent-cli` shipped with **two** entries (`0c76acb3f`, TASK_2026_104 batch 7):

```ts
export const CLI_AGENT_ALLOWLIST = ['glm', 'gemini'] as const;
```

At that commit `CliType` was
`'gemini' | 'codex' | 'copilot' | 'cursor' | 'ptah-cli'` — so **`gemini` was
real and routable; `glm` never was.** The original author noticed the anomaly and
worked around it rather than fixing it (the commit's own comment says `glm` is
absent from the `agent:listCliModels` payload, so it emits an empty list).

Then `2ef1abdde` ("remove gemini from shared cli types") and `da4ef44c3`
("remove gemini from agent-cli allowlist and mcp targets") deleted Gemini. That
removed the entry that worked and left the one that never did. **The
single-entry allowlist is an accident of subtraction**, and the docs then
described that accident as deliberate policy: "Only `glm` is supported."

### Why it is now actively wrong

`CliDetectionService` (`cli-detection.service.ts:38-45`) registers **six working
adapters** — `codex`, `copilot`, `cursor`, `antigravity`, `opencode`, `pi` —
each with its own spec, and Copilot with a dedicated `CopilotPermissionBridge`.
**Nothing is blocked at the runtime layer.**

So the allowlist blocks all six CLIs that work and permits one that does not
exist. The "copilot and cursor are blocked due to Windows spawn issues"
rationale in `README.md` and `SKILL.md` is **stale** — it outlived its cause and
was never revisited when the adapters landed.

### Scope of phase 2

**The user's direction: stop blocking anything, and stop pretending `glm` is a CLI.**

1. **Accept every real target.** `--cli` accepts the six `SYSTEM_CLI_TYPES` plus
   `ptah-cli`. Derive the accepted set from `SYSTEM_CLI_TYPES` — do NOT
   re-list the names by hand, or a seventh adapter will be unreachable from the
   CLI exactly the way these six were.
2. **`glm` becomes a deprecated alias** for `cli: 'ptah-cli'`, kept only because
   it is documented in four places including a skill that ships to users. It
   must emit a deprecation notice on stderr pointing at
   `--cli ptah-cli [--ptah-cli-id <id>]`. If the reviewer prefers a hard removal,
   that is defensible — the command never worked, so no script can depend on it
   succeeding — but the alias is the cheaper courtesy.
3. **Delete the "blocked for Windows spawn reasons" claim** everywhere it
   appears. It is false. Do not replace it with a softer version; say what is
   true, which is that every registered adapter is selectable.
4. **`models list` gets its scoped branch back for system CLIs.** With the
   allowlist widened, `--cli codex` is a real query `agent:listCliModels` can
   answer. Keep the `supported: false` answer only for `ptah-cli`/`glm`, where
   the RPC still structurally cannot answer.
5. **Rename what is left.** "Allowlist" is now the wrong word for a total map of
   valid targets. `validateCliAgent` / `CLI_AGENT_ALLOWLIST` /
   `cli_agent_unavailable` describe a gate that no longer gates. Rename to
   reflect that it _resolves a target_, and keep the `cli_agent_unavailable`
   `ptah_code` on the wire (it is a documented error code) even if the internal
   names change.

Keep the `Record<…, CliAgentTarget>` totality property from phase 1 — it is what
makes a future target impossible to add without declaring its wire meaning.

## Explicitly out of scope

- **Any backend change.** `agent-rpc.handlers.ts`, `AgentProcessManager`,
  `CliDetectionService` and `CliType` are all correct. If the fix seems to need
  one, stop and re-read §"What the backend already does right".
- **Weakening `AgentResumeCliSessionParamsSchema`.** `.min(1)` on `task` and
  `cliSessionId` is correct. The CLI is what is wrong.
- **Widening `CliType` to include `'glm'`.** That would make the vocabulary
  confusion permanent and put a provider label in a binary-name union.
- ~~**Adding entries to `CLI_AGENT_ALLOWLIST`.**~~ **Superseded by phase 2.** This
  was correct for phase 1 and is no longer the boundary. The "separate audited
  change" the code asks for at `agent-cli.ts:45-47` is phase 2, and this file is
  the audit: the list blocks six working adapters and permits one that does not
  exist.

## Acceptance criteria

- `ptah agent-cli resume <id> --cli glm --task "..."` reaches
  `resumePtahCliSession` and returns `agent_cli.resumed`, or fails with the
  backend's own actionable error when no provider is configured.
- No `as unknown as` cast remains in `agent-cli.ts`.
- No `?? ''` remains in `agent-cli.ts`.
- Every wire payload the CLI sends satisfies `AgentResumeCliSessionParamsSchema`,
  proven by a test rather than by inspection.
- The four documentation sites agree with the implemented behaviour, and the
  shipped SKILL.md no longer documents an unreachable command.
- `stop` and `models list` either work as documented or are documented as they
  actually behave — with the reason recorded in code.

## Verification

```
npx nx run-many -t typecheck -p ptah-cli,shared,rpc-handlers,cli-agent-runtime
npx nx run-many -t test      -p ptah-cli,rpc-handlers
npx nx run-many -t lint      -p ptah-cli
```
