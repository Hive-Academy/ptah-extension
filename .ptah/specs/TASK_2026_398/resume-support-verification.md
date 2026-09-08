## Verdict

**PARTIALLY CONFIRMED** — every locally verifiable resume mechanism is real (Codex, Copilot, Antigravity, and the Claude Agent SDK used by `ptah-cli`), and Cursor's current official SDK documentation also defines `Agent.resume(id, options)`, but the `opencode` and `pi` binaries are not installed here, so the claim that *all* adapters really resume cannot be confirmed; Pi's own adapter explicitly says its RPC-mode use of `--session` is unverified.

The deletion is therefore not fully justified by the available evidence. It removes demonstrably false warnings for supported CLIs, but there is still no machine-level proof for every CLI covered by the blanket claim.

## Per-CLI table

| CLI | passes id (file:line) | vendor mechanism | flag verified how | installed here | steer | resume | verdict |
|---|---|---|---|---|---|---|---|
| `codex` | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts:640-642` | Calls `codex.resumeThread(resumeSessionId, threadOptions)` and then runs a turn on that thread. | `codex-cli 0.153.4`; `codex resume --help` accepts positional `[SESSION_ID]` and says it may be a UUID or session name. The current first-party SDK source also defines `resumeThread(id: string, options)` and states that it resumes a persisted conversation: https://github.com/openai/codex/blob/main/sdk/typescript/src/codex.ts | Yes | **No** — `supportsSteer()` returns false (`codex-cli.adapter.ts:473-475`). The handle separately supports post-turn continuation on the same SDK thread (`codex-cli.adapter.ts:737-739`). | **Yes, verified.** | **SUPPORTED / REACHABLE.** Registered at `cli-detection.service.ts:50`; installed detection passes, and the manager routes `resumeSessionId` to it (`agent-process-manager.service.ts:373-417,461-470`). |
| `copilot` | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/copilot-sdk.adapter.ts:297-312` | Spawns a new `copilot` process with one argv token, `--resume=<id>`, plus `-p <prompt>`. | `GitHub Copilot CLI 1.0.80`; `copilot --help` defines `-r, --resume[=value]`, accepting a session ID/task ID/ID prefix/name, and its example is exactly `copilot --resume=<session-id>`. | Yes, but configured **disabled** (`C:\Users\abdal\.ptah\settings.json` has `disabledClis=copilot`). | **No** — `supportsSteer()` returns false (`copilot-sdk.adapter.ts:206-208`). After a session id is captured, the handle supports a later turn by spawning a new resumed child (`copilot-sdk.adapter.ts:453-455`), which is continuation/resume, not live steering. | **Yes, verified.** | **SUPPORTED, NORMALLY GATED.** Registered at `cli-detection.service.ts:52-55`. `ptah_agent_spawn` rejects a disabled CLI (`agent-namespace.builder.ts:189-197`), although the direct `agent:resumeCliSession` RPC does not repeat that disabled-list check and routes to the manager at `agent-rpc.handlers.ts:800-808`. |
| `cursor` | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cursor-cli.adapter.ts:331-333` | Calls the in-process `@cursor/sdk` method `sdk.Agent.resume(agentId, agentOptions)`; it does **not** spawn `cursor-agent` (`cursor-cli.adapter.ts:2-7`). | `cursor-agent` is absent, so no local help/runtime test was possible. The current first-party Cursor SDK documentation defines `Agent.resume(agent_id, options)` and says it reattaches by agent ID and continues after process restart: https://cursor.com/docs/sdk/python (the SDK bridge documentation says the first-party TypeScript SDK exposes the same resume protocol). The repo locks `@cursor/sdk` 1.0.13 (`package-lock.json:4807-4829`), but dependencies are not installed in this worktree, so that pinned runtime was not exercised. | No according to detection; this adapter deliberately reports not installed when no Cursor API key is resolvable (`cursor-cli.adapter.ts:207-220`). `cursor-agent` is also not on PATH. | **No** — `supportsSteer()` returns false (`cursor-cli.adapter.ts:232-234`). Its live SDK handle can send a later turn on the same agent (`cursor-cli.adapter.ts:386-388`), which is continuation, not mid-run steer. | **Interface says yes; local execution unverified.** | **UNVERIFIED HERE.** Registered at `cli-detection.service.ts:57`, but the missing-key detection result makes the manager reject it before `runSdk` (`agent-process-manager.service.ts:373-387`). |
| `antigravity` | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts:463-465` | Spawns `agy` with two argv elements: `--conversation`, `<id>`; the prompt is later passed as `--print <prompt>`. | `agy 1.1.27`; `agy --help` says `--conversation  Resume a previous conversation by ID`. The adapter's two-token shape matches a value-taking Go flag. | Yes | **No** — `supportsSteer()` returns false (`antigravity-cli.adapter.ts:192-194`). | **Yes, verified.** | **SUPPORTED / REACHABLE.** Registered at `cli-detection.service.ts:58`; installed detection passes and no disabled setting was found for it. |
| `opencode` | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:401-415` | Spawns `opencode run --format json ... --session <id> <prompt>`. | Could not run `opencode --help`: `Get-Command opencode` returned `NOT_FOUND`. A source reference and an adapter unit test prove argv construction, not vendor behavior. | No | **No** — `supportsSteer()` returns false (`opencode-cli.adapter.ts:260-262`). No `supportsContinuation`/`continue` handle is declared. | **UNVERIFIED.** | **UNVERIFIED / UNREACHABLE HERE.** Registered at `cli-detection.service.ts:59`, but detection returns not installed and the manager rejects before launch (`opencode-cli.adapter.ts:231-256`; `agent-process-manager.service.ts:373-387`). |
| `pi` | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/pi-cli.adapter.ts:354-369` | Spawns a new process as `pi --mode rpc -a ... --session <id>`. | Could not run `pi --help`: `Get-Command pi` returned `NOT_FOUND`. Most importantly, the adapter itself says the assumption that RPC mode honors `--session` is **UNVERIFIED** (`pi-cli.adapter.ts:57-59,366-368`). The unit test proves only that argv contains the flag. | No | **Yes in the adapter** — installed detection would report true and `supportsSteer()` returns true (`pi-cli.adapter.ts:174-192`); it writes a `{"type":"steer","message":...}` request to the live RPC child's stdin (`pi-cli.adapter.ts:500-503`). `ptah_agent_list` shows `steer: no` here because absent-binary detection returns `supportsSteer: false` (`pi-cli.adapter.ts:161-166`), not because the adapter lacks steering. | **UNVERIFIED.** Its continuation path starts a new child with the captured session id (`pi-cli.adapter.ts:505-509`), distinct from live steering. | **UNVERIFIED / UNREACHABLE HERE.** Registered at `cli-detection.service.ts:60`, but missing-binary detection blocks launch. This is the largest unresolved risk to the claim. |
| `ptah-cli` | `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:704-757`, specifically `:746` | Passes `resume: options.resumeSessionId` in the `@anthropic-ai/claude-agent-sdk` `query()` options. | The repo pins Agent SDK 0.3.150 (`package-lock.json:1694-1704`). The locally installed `claude 2.1.259` help defines `-r, --resume [value]` as “Resume a conversation by session ID”; Anthropic's first-party Agent SDK material likewise uses the `resume` option with a session id: https://platform.claude.com/cookbook/claude-agent-sdk-05-building-a-session-browser | `ptah 0.2.5` and `claude 2.1.259` are installed. Two `ptahCliAgents` configs are enabled locally; registry exposure additionally requires an API key (`agent-namespace.builder.ts:258-268`). | Discovery reports **No** (`agent-namespace.builder.ts:262-265`; also `agent-rpc.handlers.ts:835-845`). Nevertheless its SDK handle supports live-process **continuation** through the prompt mailbox (`ptah-cli-registry.ts:821-829`). This is not `supportsSteer` and does not contradict `steer: no`. | **Yes, verified.** | **SUPPORTED / GATED.** A configured agent must exist, be enabled, and have an API key; `spawnAgent` rejects disabled/missing-key configs (`ptah-cli-registry.ts:578-605`). This path bypasses `doSpawnSdk`, so the deleted warning never executed for `ptah-cli` (`agent-namespace.builder.ts:143-187`). |

All six system adapters are actually registered (`cli-detection.service.ts:50-60`); none is dead code. Reachability is then constrained by detection (`agent-process-manager.service.ts:373-387`) and, for the MCP namespace's ordinary spawn path, `disabledClis` (`agent-namespace.builder.ts:189-197`). Custom `ptah-cli` agents have their own enabled/API-key gate.

The capability names must not be collapsed:

- **Steer** means sending input into an agent while its current process/turn is still running. Only Pi declares this, through its RPC stdin message. Its absent-binary detection explains why the current list says `steer: no`.
- **Continue** means asking a process/SDK handle that Ptah still retains to perform another turn after the prior turn ends. Codex, Cursor, Copilot-after-session-capture, Pi-after-session-capture, and `ptah-cli` expose handle continuation in different ways.
- **Resume** means creating/reopening a vendor session from a persisted CLI-native id, potentially in a new process. It is the fallback once the retained process record is gone. The follow-up component tries `agent:continue` first and falls back on `not_found`/`released` to session resume (`agent-continue-input.component.ts:201-229,256-280`). Thus `steer: no` says nothing by itself about persisted-session resume support.

## Was the warning ever true?

**No verified CLI made the warning true.** It was definitely false for Codex and Antigravity: both satisfy the warning's old `request.cli !== 'copilot'` condition, both receive the id, and both have a real vendor resume interface on this machine. It would also have been false for Cursor at the interface level, although Cursor is unreachable in this environment. The `ptah-cli` resume mechanism is real too, but its custom-registry route never passed through the deleted block.

However, **I cannot prove that the warning was never true for every CLI**. `opencode` and `pi` are not installed, so their exact current flags could not be tested. Pi is specifically unresolved: the source admits that `--session` is only known from the interactive/JSON flag table and may not be honored in `--mode rpc`. If Pi RPC mode ignores or rejects `--session`, then the warning was correct for Pi, the broad “all adapters honor it” justification is false, and deleting the signal outright was wrong for that case.

Evidence that would falsify the all-supported conclusion is any of:

1. `pi --mode rpc --session <real-finished-session-id>` rejecting the flag or starting without the prior conversation;
2. `opencode run --session <real-finished-session-id> ...` rejecting the exact two-token form or starting a fresh session;
3. an installed pinned Cursor SDK rejecting `Agent.resume(id, options)` or returning a fresh agent without retained history;
4. an end-to-end resumed turn returning a different vendor session id/history despite accepting the flag.

The fair disposition is therefore **PARTIALLY CONFIRMED**, not `CLAIM CONFIRMED` and not `CLAIM REFUTED`: the investigation found no false resume mechanism, but two uninstalled vendors (especially Pi RPC mode) prevent the universal claim from being established.

## Command output

Actual lines relied on from this machine on 2026-09-08:

```text
> codex --version
codex-cli 0.153.4

> codex --help
resume            Resume a previous interactive session (picker by default; use --last to continue
                  the most recent)

> codex resume --help
Usage: codex resume [OPTIONS] [SESSION_ID] [PROMPT]
Arguments:
  [SESSION_ID]
          Session id (UUID) or session name. UUIDs take precedence if it parses. If omitted, use
          --last to pick the most recent recorded session
```

```text
> copilot --version
GitHub Copilot CLI 1.0.80.

> copilot --help
  -r, --resume[=value]                  Resume from a previous session
                                        (optionally specify existing session ID,
                                        task ID, ID prefix, or name; name
                                        matching is exact, case-insensitive)

  # Resume a specific session by ID
  $ copilot --resume=<session-id>
```

```text
> agy --version
1.1.27

> agy --help
  -c                              Short alias for --continue
  --continue                      Continue the most recent conversation
  --conversation                  Resume a previous conversation by ID
  --print                         Run a single prompt non-interactively and print the response
```

```text
> claude --version
2.1.259 (Claude Code)

> claude --help
  -c, --continue                        Continue the most recent conversation in
                                        the current directory
  -r, --resume [value]                  Resume a conversation by session ID, or
                                        open interactive picker with optional
                                        search term
```

```text
> ptah --version
0.2.5

> ptah --help
  session                 manage chat sessions (start / resume / send / list /
                          stop / delete / rename / load / stats / validate)
```

```text
> Get-Command codex,copilot,agy,opencode,pi,cursor-agent,ptah
codex        FOUND      C:\Users\abdal\AppData\Roaming\npm\codex.ps1
copilot      FOUND      C:\Users\abdal\AppData\Roaming\npm\copilot.ps1
agy          FOUND      C:\Users\abdal\AppData\Local\agy\bin\agy.EXE
opencode     NOT_FOUND
pi           NOT_FOUND
cursor-agent NOT_FOUND
ptah         FOUND      C:\Users\abdal\AppData\Roaming\npm\ptah.ps1
```

```text
> read C:\Users\abdal\.ptah\settings.json (only agentOrchestration.disabledClis)
disabledClis=copilot

> read C:\Users\abdal\.ptah\settings.json (only non-secret ptahCliAgents fields)
ptahCliAgents.count=2
enabled=True; provider=ollama-cloud
enabled=True; provider=claude-cli
```

An attempted `ptah agent-cli detect --human` did not yield another detection snapshot because that separately installed Ptah CLI could not bootstrap its own provider auth in this shell:

```text
No authentication configured. Set a provider API key or sign in to a provider, then retry.
```

## What I could not verify

- **opencode:** not installed (`Get-Command opencode` returned nothing). I could not inspect `opencode run --help` or resume a real completed session. Its `--session <id>` behavior is **UNVERIFIED**.
- **Pi:** not installed (`Get-Command pi` returned nothing). I could not inspect its flag table or, crucially, prove that `--mode rpc` honors `--session <id>`. This is **UNVERIFIED**, and the adapter's own comment records the same uncertainty.
- **Cursor local runtime:** `cursor-agent` is not installed and the SDK adapter reports unavailable without an API key. Current first-party documentation confirms that `Agent.resume(id, options)` is a real interface, but I could not execute the repo's pinned `@cursor/sdk` 1.0.13 or prove retained history on this machine. Runtime behavior is **UNVERIFIED HERE**.
- I did not spend tokens or mutate vendor session stores by performing live model turns. Consequently, help/API verification proves accepted interface shape, not an end-to-end history assertion. A vendor could accept a resume argument yet regress internally; only the real-session tests listed above would detect that.
