# Handoff — ptah-cli headless integration investigation

**Status:** open. Active blocker: ptah-cli 0.1.1's `session start --task` does not execute turns headlessly.

**Audience:** any agent or human picking this up in a fresh session. You have permission to read everything under `/home/anubis/Desktop/fixing-openclaw/` and run commands on this host. The user has the ptah-cli source code available for inspection — that's where the answers live.

**Don't change without asking:** live secrets in `.env` (Discord OAuth client/secret, GitHub PAT). The `~/.claude/.credentials.json` file (mode 0600). The shared specs repo schema.

---

## TL;DR — what's actually broken

The openclaw control plane delegates orchestration runs (continuation loop + dispatch worker) to a host-side `ptah-bridge.service` so that ptah uses the desktop's auth state. The bridge plumbing is correct end-to-end. The blocker is **inside ptah-cli itself**: when invoked headlessly with `ptah --json --auto-approve session start --profile claude_code --task "..."`, ptah-cli **never spawns the underlying `claude` binary** and **never produces assistant output**, even though:

- `~/.claude/.credentials.json` exists (471 bytes, mode 0600, contains `claudeAiOauth` token from a recent `claude /login`).
- `ptah auth status` reports `authMethod: claudeCli`, `claudeCliInstalled: true`, `codexAuthenticated: true`.
- Same command in the desktop ptah works.

The CLI emits exactly one event then exits 0:

```json
{ "jsonrpc": "2.0", "method": "session.created", "params": { "session_id": "<uuid>", "tab_id": "<uuid>" } }
```

`ptah session list` after the call returns `total: 0` — the session isn't even persisted properly. The headless `--task` flag is documented as "with --task, streams a turn" but in 0.1.1 it doesn't.

---

## What was actually verified today

| Hypothesis                                              | Result                      | Evidence                                                                                                                      |
| ------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Claude CLI is missing                                   | **wrong**                   | `which claude` → `~/.local/bin/claude`, version 2.1.119                                                                       |
| Claude CLI auth is missing                              | **wrong**                   | `~/.claude/.credentials.json` (note leading dot) exists, contains `claudeAiOauth`                                             |
| ptah's settings file is wrong                           | wrong                       | shared with desktop via bind mount; identical bytes                                                                           |
| ptah is unable to find ptah-cli's own deps              | wrong                       | strace shows axios, gpt-tokenizer, tsyringe all loading                                                                       |
| ptah-cli `session start --task` actually invokes claude | **wrong — this is the bug** | strace captures every `execve` in the process tree; the only spawns are `node` and `ptah` itself. **No `claude` subprocess.** |
| ptah-cli persists the session                           | wrong                       | `ptah session list` immediately after returns `total: 0`                                                                      |

The earlier setup.sh probe checked `~/.claude/credentials.json` (no dot). The actual file has a leading dot: `~/.claude/.credentials.json`. That cosmetic bug led us to think Claude was unauthed when it wasn't. Fixing the probe path is one trivial follow-up; **but the deeper issue is that even with correct auth, ptah-cli doesn't drive turns**.

---

## Reproduction (~30 seconds, runs locally)

```bash
# These commands assume you're on the Anubis host. ptah is installed via nvm,
# so you need to source it first.
source ~/.nvm/nvm.sh
PTAH=$(which ptah)

# 1) Confirm the auth state ptah sees
$PTAH auth status 2>&1 \
  | grep -oE '"authMethod":"[^"]*"|"claudeCliInstalled":[a-z]+|"copilotAuthenticated":[a-z]+|"codexAuthenticated":[a-z]+'
# Expect: authMethod=claudeCli, claudeCliInstalled=true

# 2) Try to actually run a turn
timeout 30 $PTAH --json --auto-approve session start \
    --profile claude_code \
    --task "Reply with the single word: hello." 2>&1
# Bug: only emits session.created, no assistant text, exits 0.

# 3) Confirm the session wasn't persisted
$PTAH session list 2>&1 | head
# Bug: total: 0

# 4) strace what ptah is actually doing
rm -f /tmp/ptah-strace.log
timeout 30 strace -f -e trace=execve,openat -s 256 -o /tmp/ptah-strace.log \
    $PTAH --json --auto-approve session start \
        --profile claude_code \
        --task "Reply with the single word: hello." \
    > /tmp/ptah-stdout.log 2>&1
grep -oE 'execve\("[^"]+"' /tmp/ptah-strace.log | sort -u
# Bug: only node and ptah itself; no `claude` execve. The CLI never calls claude.
```

Compare with the desktop ptah on the same host: same settings.json, same Claude CLI auth file, but produces a real reply. **The difference must be in how each entry point dispatches the turn after `session.created`.**

---

## Where to look in the ptah-cli source

The user has the source. Inspect these (paths inside `@hive-academy/ptah-cli`, version 0.1.1, installed by setup.sh into the host's nvm node_modules):

```
/home/anubis/.nvm/versions/node/v24.15.0/lib/node_modules/@hive-academy/ptah-cli/
```

Specific things to grep for:

1. **The `session start` command handler** — search for `"session"` in command registration. Should be in something like `src/cli/sessionCommand.ts` or similar. Find the `--task` branch.
2. **What the desktop calls that the CLI doesn't.** Look for code paths that:
   - Read the session ID after `session.created`
   - Push the user message into the agent runtime
   - Wait for streamed assistant chunks
   - Call out to a "model client" or "provider" abstraction
     The desktop calls these. Verify whether `session start --task` in the CLI calls them.
3. **The agent runtime / orchestrator class.** Probably named `AgentService`, `Orchestrator`, `SessionManager`, `ChatEngine`, or similar. Find where it actually invokes the LLM. In the desktop it's wired up in app startup; in the CLI it may be wired only for the long-lived `ptah interact` subcommand.
4. **The `--profile claude_code` codepath.** Is `claude_code` a profile that uses the Claude CLI subprocess? Or is it just a system-prompt preset that picks the wrong driver? Worth verifying by checking what `enhanced` does differently.
5. **`ptah interact` (persistent JSON-RPC over stdio).** This subcommand is for "continuous bidirectional stream". It may be the only path that actually drives turns. If so, the headless story for `session start --task` was never finished.

A focused 30-minute pass: `cd` into the installed ptah-cli, `grep -rn "session.start" src/`, then trace the call chain.

---

## Hypothesized root cause

Most likely (ranked):

1. **`session start --task` is incomplete in 0.1.1.** It allocates a session and emits `session.created`, but doesn't kick off turn execution. The desktop has a separate process or worker that consumes session creations and drives them; the CLI doesn't ship with that worker.
2. **The CLI's agent runtime is gated behind `ptah interact`.** Both `session start --task` and `run --task` are convenience wrappers that emit telemetry only; the actual chat engine is only mounted in the persistent `ptah interact` mode.
3. **A missing dependency injection wiring.** Tsyringe is in the loaded modules; if the agent service's container registration is conditional on Electron startup (vs. CLI), the CLI never gets the service registered, but `session start` doesn't fail loudly — it just no-ops.

The strace evidence rules out auth issues, missing binaries, missing files, missing config.

---

## What we already built that depends on this getting fixed

The whole openclaw-control orchestration loop is wired to call ptah headlessly:

| File                                        | Role                                                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `openclaw-control/daemon/src/invoker.ts`    | Spawns `ptah --json session start --task <prompt>` for every dispatch (or POSTs to bridge in production).   |
| `openclaw-control/daemon/src/ptahBridge.ts` | HTTP client for the host-side bridge. Streams the response.                                                 |
| `scripts/ptah-bridge.mjs`                   | Host-side HTTP server. Translates container paths → host paths, spawns ptah on the host.                    |
| `scripts/ptah-bridge.service.tmpl`          | Systemd user-service template. setup.sh phase 13 renders it and starts the service.                         |
| `setup.sh` phase 13                         | Installs ptah on the host (auto, via npm), renders the systemd unit, enables the service, probes ptah auth. |

All of this is **architecturally correct and verified end-to-end** — the bridge accepts auth'd requests, translates paths, spawns ptah on the host with the right cwd, captures stdout, exits cleanly. The only thing that doesn't work is what ptah does with the prompt once it's launched.

In other words: **once `ptah session start --task` works, the rest of our stack just works.** Nothing in our code needs to change.

---

## Possible workarounds (if upstream is slow to fix)

Pick one based on how much code surgery is acceptable:

### A — Fork ptah-cli, fix the `session start --task` path, depend on the fork

User has the source. The fix is likely small (wire up the agent runtime in CLI startup the same way it's wired in Electron). Publish as `@<your-org>/ptah-cli-fork` and update the bridge's `PTAH_BIN` env to point at the fork. Lowest blast radius if the fix is small.

### B — Drive ptah through `ptah interact` instead of `session start --task`

Hypothesis: the persistent `ptah interact` mode actually works because it has a real long-lived agent runtime. Modify `scripts/ptah-bridge.mjs`:

- On startup, spawn one persistent `ptah interact` subprocess.
- For each `/invoke` request, write the JSON-RPC `session.send` command to the subprocess's stdin, read until the `session.complete` event, return.
- Health-check the subprocess; restart on death.

This is essentially "the daemon mode I suggested earlier as a tier-3 ptah feature, but built into our bridge instead". Gets the team unblocked without touching ptah-cli source.

### C — Skip ptah entirely for orchestration, talk to Claude directly

Replace `ptahBridge.ts` with a Claude-CLI client that spawns `claude --print "$prompt"` (or whatever Claude's headless mode looks like). Lose ptah's skill catalog, MCP integration, memory layering — but gain a working orchestration loop today. The Discord chat path is already on this model (it bypasses ptah and hits Ollama directly), so this is just extending the same logic to orchestration.

This is probably the **right tactical choice** while the user investigates upstream. The architectural cost is that orchestration becomes "Claude calls a script in a workspace" rather than "ptah runs an agent run with a full harness". For one-shot phase prompts (`task-description.md`, `implementation-plan.md`, `tasks.md`) that's actually fine — the prompts are bounded and don't need MCP.

### D — Drive Claude via the Anthropic SDK directly

Like C but using Anthropic's API SDK and the OAuth token from `~/.claude/.credentials.json`. Same tradeoff. Slightly less coupling to the Claude CLI binary's flag surface.

My recommendation: **B for the next 1–2 days while the user investigates upstream, then either A (fork + fix) or accept C as the long-term path**. C is a perfectly reasonable architecture; it's just narrower than the original "ptah for everything" vision.

---

## Concrete next steps for a fresh session

In order:

1. **Read the relevant files I've referenced** above (`invoker.ts`, `ptahBridge.ts`, `ptah-bridge.mjs`, `setup.sh` phase 13). 5 minutes. Confirms the bridge plumbing.
2. **Re-run the strace reproduction** in this doc. Confirms the bug is still present (versions of ptah may have moved).
3. **`cd /home/anubis/.nvm/versions/node/v24.15.0/lib/node_modules/@hive-academy/ptah-cli/`** and grep for the session-start handler. Find the codepath that handles `--task`. Compare with what the desktop does.
4. **Decide between workaround B, C, or fix-upstream**. If fix-upstream, draft a PR; the user has the source.
5. **If workaround B (subprocess pool of `ptah interact`), the change is in `scripts/ptah-bridge.mjs` only**. The daemon side doesn't change. Add a one-line note to `docs/OPENCLAW_CONTROL.md` describing the bridge's internals.

**Smaller cleanup item:** fix the credential-path probe in `setup.sh` phase 13. It checks `~/.claude/credentials.json` (no dot); should check `~/.claude/.credentials.json` (with dot). Unrelated to the headless bug, but cosmetically misleading and contributed to today's wrong diagnosis.

---

## Inventory of what was committed today

Five commits, all on `main`, all pushed to `origin/Hive-Academy/hive-claw`:

| SHA       | Subject                                                                              | Effect                                                                  |
| --------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `c8ca9fe` | `docs(control): catch up docs + tooling for slices 9–11 + leader/follower bootstrap` | Docs catch-up, setup.sh extended, scripts/templates added               |
| `3e7ba48` | `revert(compose): drop per-container ptah-config volume; restore host bind mount`    | Undid an architectural mistake; ~/.ptah is bind-mounted from host again |
| `7583584` | `feat(bot-bridge): route Discord @mention chat through LLM_PROVIDER, not ptah`       | **Discord chat works.** Bot replies via Ollama, no ptah dependency.     |
| `2cb2e6e` | `feat(invoker): host-side ptah-bridge — daemon delegates orchestration to host ptah` | Bridge built, daemon wired, env vars set.                               |
| `3bbd113` | `feat(setup): wire ptah-bridge into setup.sh — auto-install + render + start`        | setup.sh phase 13 fully automates bridge install on any machine.        |

After today's work, **Discord chat is fully functional** and **orchestration plumbing is correct**; only the upstream ptah-cli bug blocks the orchestration loop end-to-end.

---

## Files to load first in the new session

- `docs/HANDOFF-ptah-cli.md` ← this doc
- `docs/OPENCLAW_CONTROL.md` ← canonical control-plane doc
- `docs/ARCHITECTURE.md` ← multi-machine topology
- `openclaw-control/daemon/src/invoker.ts` ← daemon's spawn point
- `openclaw-control/daemon/src/ptahBridge.ts` ← HTTP client for the bridge
- `scripts/ptah-bridge.mjs` ← host-side bridge implementation
- `scripts/ptah-bridge.service.tmpl` ← systemd unit template
- `setup.sh` phase 13 ← auto-install logic

Then run the reproduction in the "Reproduction" section above and pick a workaround path.
