# Context — opencode model picker shows only "Default"

Measured 2026-09-22 on win32. opencode **v2.0.12**, installed at
`C:\Users\abdal\AppData\Roaming\npm\opencode`. Every statement below is observed
output from this machine, not vendor documentation.

This closes the open item in
`.ptah/specs/TASK_2026_465_a25a/opencode-serve-probe.md` ("Adjacent observation
— the model picker"). That probe suspected the shim/native asymmetry between
`listModels` and `runSdk`. **That is not the cause.** The cause is the opencode
2.x background service.

## Symptom

The Agent Orchestration card reports opencode as installed with its version,
and the Model select offers only "Default". No `provider/model` id appears.

## Defect 1 — the probe does not survive a cold background service (primary)

`opencode models` in v2 asks the background server for the list. When that
server is down, the command starts it, exits **0**, and prints **nothing** to
stdout and nothing to stderr. The list appears only on the next call.

```
cycle 1: first=0 second=103
cycle 2: first=0 second=73
cycle 3: first=0 second=73
```

Each cycle ran `opencode service stop`, then `opencode models` twice.
Reproducible three times out of three. `--standalone` does not avoid it: a cold
`opencode models --standalone` also returns zero lines.

`OpencodeCliAdapter.probeModels()`
(`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:312`)
runs the command once. Empty stdout resolves to `undefined` at line 330, and
`listModels()` returns `[]`.

Detection is unaffected, because `opencode --version` prints locally and never
contacts the server. That is why the card says "Installed" while the picker
stays empty.

Not the cause, ruled out by measurement:

- The spawn path. `resolveCliPath('opencode')` returns `opencode.CMD`, and
  `cross-spawn` against it returned 103 lines, exit 0, in 295 ms.
- The 8 s timeout. A warm `opencode models` takes 0.3–0.9 s.
- The `.cmd`-shim / native-`.exe` asymmetry named in TASK_2026_465. The shim
  path works when the server is warm and fails when it is cold, in both cases
  identically to the native binary.

## Defect 2 — the cached empty list is never cleared at startup

`CliDetectionService.refreshCliTokens()`
(`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts:229`)
clears `modelCache` only when `ensureTokensFresh()` returns true.

`OpencodeCliAdapter.ensureTokensFresh()` (`opencode-cli.adapter.ts:365`) reads
two `auth.json` paths. **opencode 2.x writes neither.** Both are absent on this
machine:

```
C:\Users\abdal\.local\share\opencode\auth.json      -> ENOENT
C:\Users\abdal\AppData\Roaming\opencode\auth.json   -> ENOENT
```

Credentials now live in `~/.local/share/opencode/opencode.db` (SQLite), and the
server exposes them at `/api/credential/{credentialID}`. `opencode auth list`
reports `OpenCode  Default  stored` while both files are missing, so the check
returns false for an account that is in fact signed in.

Consequence: the method always reports `stale/unavailable`, the cache is never
invalidated, and defect 1's empty result survives the whole session.

### `opencode auth list` is the right replacement — measured

Run with the background service deliberately stopped:

```
exit=0
stdout=[OpenCode  Default                     stored]
stderr=[]
```

Two properties, both load-bearing:

1. It answers **correctly while the server is cold**, unlike `opencode models`.
   So it is a valid credential probe on its own.
2. It **starts the server as a side effect**. `opencode models` run immediately
   afterwards returned 103 lines on its FIRST call.

`refreshCliTokens()` is called at host activation
(`apps/ptah-electron/src/activation/boot-heavy-services.ts:305`,
`apps/ptah-extension-vscode/src/activation/wire-runtime.ts:125`), well before a
user can open the settings panel. So fixing defect 2 also warms the server for
defect 1 in the normal boot order. The retry stays as the second line of
defence for the orders that are not normal.

## Defect 3 — Re-detect cannot recover the list

`redetectClis()`
(`libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts:1062`)
calls `agent:detectClis`, which does invalidate the backend cache. It never
calls `loadCliModels()` afterwards, so the panel keeps the stale empty arrays.
`loadCliModels()` runs only from `ngOnInit` and after a Cursor API key save.

This affects every CLI agent, not only opencode.

## Proposed fix

1. `probeModels()` — treat exit 0 with empty stdout as "server cold" and run
   the command a second time. One retry covered every measured cycle.
2. `ensureTokensFresh()` — stop reading the two `auth.json` paths. Either read
   the v2 credential store, or ask the running server, or drop the file check
   and keep only the provider env-var signal. Whatever replaces it must not
   report a signed-in account as unavailable.
3. `redetectClis()` — `await this.loadCliModels()` after the detection call.

## Alternative considered for item 1

The background server answers `GET /api/model` with the same 103 entries as
rich JSON (id, providerID, capabilities, cost, context limit) — strictly better
data than the flat `provider/model` lines the CLI prints. It needs the server's
HTTP Basic credential, which `opencode pair` prints and which is not otherwise
available to the host. The retry is the smaller change; the HTTP path is worth
recording, not taking now.
