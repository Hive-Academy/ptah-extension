# Implementation report — TASK_2026_199

## Defect 1 — spawnable-CLI enum desync

### Single source of truth

`libs/shared/src/lib/types/agent-process.types.ts:49`

```ts
export const SYSTEM_CLI_TYPES = ['codex', 'copilot', 'cursor', 'antigravity', 'opencode', 'pi'] as const;

export type SystemCliType = (typeof SYSTEM_CLI_TYPES)[number];
export type CliType = SystemCliType | 'ptah-cli';
```

`CliType` is now _derived_ from the const, so the type and every runtime
enumeration cannot drift. Three consumers were converted:

| file                                    | change                                                                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool-description.builder.ts:513`       | `enum: [...SYSTEM_CLI_TYPES]` + rewritten `cli` description                                                                                    |
| `agent-tool.dispatcher.ts:49`           | `z.enum(SYSTEM_CLI_TYPES)`; the `as CliType \| undefined` cast and the `CliType` import are gone (the parsed value is already `SystemCliType`) |
| `agent-process-manager.service.ts:1200` | `new Set<string>(SYSTEM_CLI_TYPES)`                                                                                                            |

`ptah-cli` stays out of `SYSTEM_CLI_TYPES` on purpose — those agents are
selected by `ptahCliId`, and `cli: "ptah-cli"` must keep failing validation.
There is a test for that.

The HTTP MCP path (`protocol-dispatcher.ts:574`) never validated `cli` at all —
it destructures `cli?: string` and passes it through. No change needed there;
noted so nobody assumes a second gate exists.

### Repo-wide audit of `'codex'`/`'copilot'`/`'cursor'` triples

Excluding `node_modules` and `.ptah/specs`.

**Stale — fixed by this task**

| site                                                                     | why                                                                                                                                                         |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/vscode-lm-tools/…/tool-description.builder.ts:513`         | MCP schema rejected 3 of 6 real adapters                                                                                                                    |
| `libs/backend/vscode-lm-tools/…/agent-tool.dispatcher.ts:49`             | same, at the stdio dispatcher                                                                                                                               |
| `libs/backend/cli-agent-runtime/…/agent-process-manager.service.ts:1200` | also dropped the 3 newer CLIs out of `getPreferredCli()`                                                                                                    |
| `libs/backend/agent-sdk/…/prompt-harness/ptah-core-prompt.ts:356`        | told the model "Available: codex, copilot, ptah-cli" — the same defect in prose. Now names all seven and points at `ptah_agent_list`. One-line factual fix. |

**Stale — reported, NOT fixed (out of scope)**

| site                                                              | finding                                                                                                                                                                                                               |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/frontend/tribunal-panel/…/tribunal-discovery.service.ts:37` | ~~`CLI_FAMILIES` offers only codex/copilot/cursor as tribunal lanes~~ — **FIXED in follow-up, see "Tribunal panel lanes" below.**                                                                                     |
| `libs/backend/agent-generation/…/transform-rules.ts:79`           | An `antigravity` transform rule exists but `multi-cli-agent-writer.service.ts:35-37` registers only three transformers (copilot/codex/cursor) and there is no `AntigravityAgentTransformer`. The rule is dead config. |

**Intentional — left alone**

| site                                                                                                                                                                                                       | why it is correct                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/ptah-electron/…/cli-agent-sync.ts:88`, `apps/ptah-extension-vscode/…/cli-agent-sync.ts:81`, `libs/backend/rpc-handlers/…/wizard-generation-rpc.handlers.ts:356`                                      | These filter agent-generation targets, and `MultiCliAgentWriterService` genuinely has exactly three transformers. Correct _today_; they become stale the moment the antigravity transformer above is written.                                                                |
| `libs/backend/cli-agent-runtime/…/cli-plugin-sync.service.ts:37` + `libs/shared/…/cli-skill-sync.types.ts:19`                                                                                              | A different four-member domain (`CliTarget` = CLIs with a skill installer: codex/copilot/cursor/antigravity). opencode and pi have no installer. Already derived from one shared union.                                                                                      |
| `libs/shared/…/mcp-directory.types.ts:19`, `tool-description.builder.ts:1327`, `harness-namespace.builder.ts:109`, `apps/ptah-cli/…/commands/mcp.ts:86`, `chat-ui/…/mcp-directory-browser.component.ts:33` | `McpInstallTarget` = `vscode\|claude\|cursor\|copilot` — MCP _config file_ targets, not spawnable CLIs (note `vscode` and `claude`, which are not CLI adapters). Same shape of literal duplication as Defect 1, but a separate domain; flagged as a future dedup, not a bug. |
| `libs/backend/cli-agent-runtime/…/cli-detection.service.ts:203`                                                                                                                                            | `['codex','cursor','opencode','pi']` = the adapters that implement `ensureTokensFresh()`. Copilot and antigravity do not. The loop also guards on `adapter?.ensureTokensFresh`, so it is correct and self-limiting.                                                          |
| `libs/frontend/chat/…/agent-orchestration-config.component.ts:885,998`                                                                                                                                     | Already the **complete** six-value set (`codex\|copilot\|cursor\|antigravity\|opencode\|pi`) — not stale, just a hand-written duplicate of `SystemCliType`. Candidate for a follow-up import from `@ptah-extension/shared`.                                                  |
| same file `:921` (`onReasoningEffortSelect`), `:985` (`toggleAutoApprove`)                                                                                                                                 | Narrower on purpose — only those CLIs have the corresponding settings control.                                                                                                                                                                                               |

## Defect 2 — Antigravity adapter

Schema was captured from the real binary first; see
[`stream-json-capture.md`](./stream-json-capture.md). No event name in the
parser was invented.

### What changed in `antigravity-cli.adapter.ts`

- `runSdk` now passes `--output-format stream-json`.
- `handleLine` is a JSONL event loop over `init` / `step_update` / `result`,
  delegating to `handleStepUpdate` and `handleResult`.
  - `step_type: 'tool'` + `ACTIVE` → `tool-call` (`toolName`, `toolArgs`,
    `toolInput`, `toolCallId` = `step_index`)
  - `step_type: 'tool'` + `DONE` → `tool-result` carrying `tool_info.output`
  - `step_type: 'agent_response'` with `text_delta` → `text`
  - `user_input` / `checkpoint` / `unknown` → no segment
  - `result` `SUCCESS` → a usage `info` segment only (`result.response`
    duplicates the deltas already streamed); non-`SUCCESS` → `error`
  - unrecognized `event` name → `info` with the raw line, rather than dropped
- Non-JSON lines fall back to being emitted verbatim as `text` — the only
  surviving plain-text path.
- **`NARRATION_PREFIX` is deleted.** No shim, no `// removed` comment.
- **No `thinking` segments are emitted at all.** `agy` never streams reasoning
  text; it reports only `usage.thinking_tokens`, and `text_delta` is the only
  `*_delta` field in the binary. The old regex was inferring "thinking" from
  ordinary English prose.
- `LINE_BUF_CAP` 64 KB → 1 MB. A single stream-json line carries a whole tool
  output; the old cap was sized for plain text and would have truncated real
  `list_dir` / `view_file` results.

### Session id — `resolveSessionId` deleted

The task asked whether the stream carries the conversation id. **It does**:
`{"event":"init","conversation_id":"917bf234-…","init":{…}}`. So the
mtime-scanning `resolveSessionId()` — which enumerated
`~/.gemini/antigravity-cli/conversations/*.db` and races when two agents run
concurrently — is gone, along with its `readdirSync`/`statSync` imports and
`spawnStartMs`. The id is captured from the first event that carries one
(`init`, else a `step_update`, else `result`), so it is available **mid-run**
rather than only after close. `AgentProcessManager` reads
`sdkHandle.getSessionId()` right after `runSdk()` returns and re-reads it on
exit, so it now gets a real value on the first read too.

### `--effort` — wired

Adapter allowlists `low|medium|high` (agy's documented values) and drops
anything else, matching `CodexCliAdapter`'s `CODEX_REASONING_EFFORTS` shape.

To keep that from being dead code, `AgentProcessManager.resolveReasoningEffort`
now handles `antigravity`: the in-chat effort selection (an existing,
user-driven setting — no new config key, no new UI) is clamped onto agy's
three-value scale by `mapEffortToAgy` (`minimal|low`→`low`, `medium`→`medium`,
`high|xhigh|max`→`high`). The Antigravity settings pane stays model-only.

### `--mode accept-edits|plan` — deliberately NOT wired

`CliCommandOptions` has no plan/accept-edits field and nothing anywhere in the
repo sets one; the nearest existing concept is `autoApprove`, which already maps
to `--dangerously-skip-permissions`. Adding a `mode` option would mean adding a
field no caller populates, which the task explicitly forbids ("Do not add
options that no caller sets"). Flagging it here instead: if plan mode becomes a
product requirement, it needs a `CliCommandOptions.executionMode` field plus a
manager-side resolver, and `pi-cli.adapter.ts` (`--mode rpc`) shows the wiring
pattern.

## Follow-up — Tribunal panel lanes

Reported first as a gap, then fixed on request: the Tribunal "Assemble the
panel" step showed only Codex, Copilot, Cursor and the ptah-cli providers, so
Antigravity/opencode/Pi were unreachable even when installed.

`CLI_FAMILIES` in `tribunal-discovery.service.ts` gained the three missing
entries, with a doc comment tying it to `TribunalRunService.spawnArgsFor` —
whose `switch` already had arms for all seven, which is exactly how the two
drifted apart.

Model lists needed a second source. Codex and Copilot resolve through
`provider:listModels` via `modelProviderId`, but the three new CLIs own their
catalogs (`agy models` returns labels like `Gemini 3.1 Pro (High)`, which IS the
`--model` value). So a family now declares **either** `modelProviderId` **or**
`cliModelKey`, and `cliModelKey` routes to `agent:listCliModels` — an RPC that
already returned all six CLI slices and simply had no tribunal consumer.

`listModelsFor` now returns `TribunalModelOption = Pick<ProviderModelInfo,'id'|'name'>`
rather than the full `ProviderModelInfo`. The lane picker only ever renders
`id` and `name`, and `CliModelOption` has no `contextLength` / `supportsToolUse`
/ `description` — narrowing the type avoids fabricating those three fields.
`step-panel-preview.component.ts` follows the narrower type.

Cursor is unchanged: it still declares neither source and renders no model
picker. It has a `cursorModel` entry in `agent:listCliModels`, so wiring
`cliModelKey: 'cursor'` would work — left alone because it is a behaviour change
nobody reported.

```
> nx lint tribunal-panel   ✔ All files pass linting
> nx test tribunal-panel   Test Suites: 7 passed, 7 total   Tests: 104 passed, 104 total
```

Tests added to `tribunal-discovery.service.spec.ts`: the three lanes are always
emitted with the adapters' own display names; antigravity flips to `available`
on `installed: true`; all three carry `cliModelKey` and no `modelProviderId`;
`listModelsFor` calls `agent:listCliModels` and returns only that CLI's slice;
and an RPC failure yields `[]`.

## Also verified — `resolveDirectSpawn` with a real `.exe`

`agy` is installed at `C:\Users\abdal\AppData\Local\agy\bin\agy.exe` (a 175 MB
Go binary, not an npm shim) and is **not** on PATH as `antigravity`;
`resolveCliPath('agy')` finds it, so detection works.

`resolveDirectSpawn` (`cli-adapter.utils.ts:309`) short-circuits on anything
that is not a `.cmd`:

```ts
if (process.platform !== 'win32' || !binaryPath.toLowerCase().endsWith('.cmd')) {
  return { command: binaryPath, prefixArgs: [] };
}
```

So a real `.exe` is returned unchanged and handed straight to `cross-spawn`,
which spawns it via `CreateProcess` — the correct path, and `child.pid` is the
real `agy` process that `taskkill /T` walks from. **No defect.** The adapter's
comment at the old line 367-369 was the only thing wrong: it asserted `agy` "is
typically an npm `.cmd` shim". That comment has been rewritten to describe both
cases. There is already a test (`passes binaryPath through to spawnCli when
provided`) covering an `.exe` path.

## Verification

### Lint

```
> nx run-many -t lint -p shared cli-agent-runtime vscode-lm-tools agent-sdk --skip-nx-cache

✖ 17 problems (0 errors, 17 warnings)

 NX   Successfully ran target lint for 4 projects
```

All 17 warnings are pre-existing `no-explicit-any` / `no-empty-function` hits in
`mcp-response-formatter.ts` and `chrome-launcher-browser-capabilities.ts` —
files this task did not touch. Zero errors.

### Unit tests

```
> nx run-many -t test -p shared cli-agent-runtime vscode-lm-tools agent-sdk --skip-nx-cache

shared             Test Suites: 33 passed, 33 total    Tests: 444 passed, 444 total
cli-agent-runtime  Test Suites: 30 passed, 30 total    Tests: 690 passed, 690 total
vscode-lm-tools    Test Suites: 38 passed, 38 total    Tests: 746 passed, 746 total
agent-sdk          Test Suites:  1 failed, 66 passed, 67 total
                   Tests:        1 failed, 873 passed, 874 total
```

**One test fails, and it is pre-existing and unrelated.**

```
● SdkQueryRunner › runOneShot — one-shot auth override (input.auth)
  › derives env / settingSources / beta flag from the override, not this.authEnv

  expect(received).toBeUndefined()
  Received: ""

  352 |  expect(env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined();
```

Confirmed pre-existing by stashing this task's only agent-sdk edit (a one-line
prompt string) and re-running: still `Tests: 1 failed, 14 skipped, 15 total`.
Not caused by, and not fixable within, this task.

Targeted runs of the new/changed suites:

```
antigravity-cli.adapter.spec.ts   Tests: 27 passed, 27 total
agent-tool.dispatcher.spec.ts     Tests:  9 passed,  9 total
agent-process-manager "getPreferredCli"  Tests: 5 passed
```

### Tests added

- `agent-tool.dispatcher.spec.ts` (new file) — `it.each([...SYSTEM_CLI_TYPES])`
  so a future seventh adapter is covered automatically; an explicit
  `cli: 'antigravity'` case; unknown CLI rejected with
  `ptah_code: 'mcp_invalid_tool_args'` and no dispatch; `ptah-cli` rejected.
- `agent-process-manager.service.spec.ts` — `it.each(['antigravity','opencode','pi'])`
  honoured as a preferred CLI, plus a disabled-preferred-CLI case that still
  falls through to auto-detect.
- `antigravity-cli.adapter.spec.ts` — fixtures copied from the real capture:
  tool `ACTIVE`→`tool-call` / `DONE`→`tool-result` with the observed
  `tool_info` shape; incremental `text_delta` pair; structural steps (including
  the thinking-only `agent_response` with `thinking_tokens` and no text)
  producing zero segments; `SUCCESS` result emitting usage only; non-`SUCCESS`
  result emitting `error`; a malformed/truncated-JSON line falling back to
  verbatim `text`; an unknown event name surfacing as `info`; `--effort`
  accepted for `high` and dropped for `xhigh`; `--output-format stream-json` in
  argv; session id captured from `init` mid-run, from `step_update` as fallback,
  and `undefined` when absent. The old mtime `readdirSync`/`statSync` mocks and
  the narration-heuristic tests are deleted.
