# Follow-up Research — opencode CLI Adapter (TASK_2026_160)

Researched 2026-07-17. Primary sources: `opencode.ai/docs/*` (fetched live), `github.com/anomalyco/opencode` source (`packages/opencode/src/config/config.ts`, default branch, matches the v1.18.x release train), GitHub Issues/Releases via `gh api`. Repo was formerly `sst/opencode`; issue links from both slugs redirect to `anomalyco/opencode`. Latest release found: **v1.18.3**, published 2026-07-16.

Current code reviewed: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts` (`configureMcpServer`/`cleanupMcpEntry` read-merge-write `<cwd>/opencode.json`; `resolveOpencodeNativeBinary` gated behind `if (!options.binaryPath)` at line 476) and `cli-adapter.utils.ts` (`resolveCliPath`, `spawnCli`, `resolveDirectSpawn`).

---

## Topic 1 — Concurrency-safe MCP config

**Headline: FIXABLE — use `OPENCODE_CONFIG_CONTENT` (inline JSON env var), zero shared-file writes. Confidence: high (verified against upstream source, not just docs).**

### 1. CLI flag / env var for a private MCP config

No `--mcp-config` flag exists, and `opencode run` has **no `--config` flag at all** (confirmed against the full flag list in `opencode.ai/docs/cli/`: `--command, --continue/-c, --session/-s, --fork, --share, --model/-m, --agent, --file/-f, --format, --title, --attach, --password/-p, --username/-u, --dir, --port, --variant, --thinking, --auto`). Config overrides are env-var only:

- **`OPENCODE_CONFIG=<path>`** — points to an alternate config _file_. Doc example (`opencode.ai/docs/config/`):
  ```
  export OPENCODE_CONFIG=/path/to/my/custom-config.json
  opencode run "Hello world"
  ```
- **`OPENCODE_CONFIG_CONTENT=<json-string>`** — inline config, **no file needed at all**. Confirmed directly in source, `packages/opencode/src/config/config.ts`:
  ```ts
  if (process.env.OPENCODE_CONFIG_CONTENT) {
    const source = 'OPENCODE_CONFIG_CONTENT';
    const next = yield * loadConfig(process.env.OPENCODE_CONFIG_CONTENT, { dir: ctx.directory, source });
    yield * merge(source, next, 'local');
  }
  ```
- **`OPENCODE_CONFIG_DIR=<dir>`** — alternate directory for agents/commands/modes/plugins (not needed for our case).
- **`OPENCODE_DISABLE_PROJECT_CONFIG`** — exists in source (gates the project-config load loop) but is undocumented on the public docs site; not needed for our fix but confirms the loader is env-var-driven end to end.

Source: `opencode.ai/docs/cli/`, `opencode.ai/docs/config/` (fetched 2026-07-17), `github.com/anomalyco/opencode` `packages/opencode/src/config/config.ts` (fetched via `gh api` same day).

### 2. Precedence & merge behavior (verified against source, not just docs prose)

Exact merge order, read directly from `config.ts` (line numbers as of the fetched commit):

1. Remote config (`.well-known/opencode`)
2. Global config (`~/.config/opencode/opencode.json`)
3. **`OPENCODE_CONFIG`** file (`Flag.OPENCODE_CONFIG`, line ~401)
4. Project config — `opencode.json`/`opencode.jsonc`, walked up to nearest `.git` (line ~406, skipped entirely if `OPENCODE_DISABLE_PROJECT_CONFIG` is set)
5. `.opencode/` directory configs (line ~421)
6. **`OPENCODE_CONFIG_CONTENT`** inline JSON (line ~468) — **merged LAST**, i.e. highest precedence of all file/env sources

Merging is **`mergeDeep` from `remeda`** (`import { mergeDeep } from "remeda"`, line 7; `mergeDeep(target, source)`, line 42) — a genuine recursive/deep merge, not whole-file replacement. Docs confirm in prose: _"Configuration files are merged together, not replaced... Later configs override earlier ones only for conflicting keys."_ This means nested maps like `mcp` are merged key-by-key: our `mcp.ptah` entry from `OPENCODE_CONFIG_CONTENT` combines with whatever `mcp.*` entries already exist in the project's `opencode.json` — **it does not clobber the user's other MCP servers**, and because it's env-scoped per child process, **two concurrent `opencode` invocations never see each other's config at all** (each process gets its own `OPENCODE_CONFIG_CONTENT` in its own env). This directly eliminates the race — there is no shared file to read-merge-write or ref-count.

Point 2's "can we point at a per-agent temp config file" — yes via `OPENCODE_CONFIG`, but `OPENCODE_CONFIG_CONTENT` is strictly better here: no filesystem write/cleanup/temp-dir management at all, and its higher precedence means it always wins over a conflicting project-level `mcp.ptah` key (unlikely to exist, but the ordering makes us robust to it either way — the last-merged env-based config always wins).

### 3. Remote (`type: "remote"`) MCP servers — still supported

`opencode.ai/docs/mcp-servers/` (fetched 2026-07-17) confirms the schema unchanged from what the adapter already emits:

```json
{ "mcp": { "my-remote-server": { "type": "remote", "url": "https://...", "headers": {...} } } }
```

No `enabled` key was mentioned in the current remote-server example on the docs page (it appeared only under `local`'s "Additional options: `cwd`, `timeout`, `enabled`" in the fetch); the adapter currently sets `enabled: true` on a remote entry — harmless (extra key is ignored/or accepted, `enabled` is a legitimate MCP-server field per the docs' general description) but not verified as documented specifically for `remote`. Docs did **not** mention "Streamable HTTP" as a distinct type label — only `local`/`remote`, consistent with the adapter's current `type: 'remote'` usage.

No per-directory `.opencode/`-scoped or session-scoped MCP enable/disable mechanism was found beyond the `tools: { "server*": false }` glob-based disable and per-agent MCP allowlists — neither is a concurrency primitive, both still key off the merged config.

### 4. Recommendation (ranked)

**#1 — Per-run `OPENCODE_CONFIG_CONTENT`, no shared-file writes, no ref-counting.** Concrete adapter change:

```ts
// Remove configureMcpServer/cleanupMcpEntry's read-merge-write of <cwd>/opencode.json entirely.

private buildMcpConfigContent(port: number): string {
  return JSON.stringify({
    mcp: {
      ptah: { type: 'remote', url: `http://localhost:${port}`, enabled: true },
    },
  });
}

// in runSdk(), replace the configureMcpServer(...)/cleanupMcpEntry(...) calls with an env var
// passed straight into spawnCli — spawnCli already merges options.env over process.env
// (cli-adapter.utils.ts:53-60), so this requires zero new spawn plumbing:

const env: Record<string, string> = {};
if (options.mcpPort) {
  env['OPENCODE_CONFIG_CONTENT'] = this.buildMcpConfigContent(options.mcpPort);
}
const child = spawnCli(binary, args, {
  cwd: options.workingDirectory,
  env,
});
```

No `readFile`/`writeFile`/`existsSync` on `opencode.json` is needed anywhere in the adapter anymore — delete `configureMcpServer`, `cleanupMcpEntry`, `mcpConfigPath`, and the `done.then(() => cleanupMcpEntry(...))` call. Two agents in the same `workingDirectory` each get their own `OPENCODE_CONFIG_CONTENT` in their own child-process env; opencode's loader deep-merges each process's own `mcp.ptah` on top of the (untouched) shared project file, in-memory, per process. No cleanup step is required since nothing was written to disk.

**#2 (fallback only if `OPENCODE_CONFIG_CONTENT` is ever found not to work in practice)** — same idea via a per-run temp file + `OPENCODE_CONFIG=<tmpfile>` (e.g. `path.join(os.tmpdir(), 'ptah-opencode-' + randomUUID() + '.json')`, deleted in a `finally`). Strictly more moving parts (temp-file lifecycle, cleanup-on-crash) for no benefit over #1, since #1 needs no file I/O at all — only worth doing if inline JSON hits an env-var length limit (Windows `CreateProcess` env block cap is generous, ~32K per var practically higher; a single MCP entry JSON string is a few hundred bytes, not a concern).

**#3 (last resort, not recommended)** — static `Map<workingDirectory, number>` ref-count guard around the existing read-merge-write, only removing the `mcp.ptah` key when the count hits 0. Not needed given #1 exists and is verified against source; flagging only because the task asked for a sketch if no flag/env existed — one does.

**Caveat**: I verified the merge order and `mergeDeep` semantics directly against `anomalyco/opencode`'s `config.ts` source on the default branch as of 2026-07-17, which tracks the v1.18.x release line (latest tag v1.18.3, 2026-07-16). I did not build/run opencode locally to empirically confirm `OPENCODE_CONFIG_CONTENT` end-to-end — this is source-verified, not execution-verified. Recommend a quick smoke test (`OPENCODE_CONFIG_CONTENT='{"mcp":{"ptah":{"type":"remote","url":"http://localhost:9"}}}' opencode run "..." --format json`, check `opencode mcp list` output or a startup log line) before removing the file-based path in one shot.

---

## Topic 2 — Windows binary resolution

**Headline: `/bin/sh.exe` bug (#2447) is FIXED (Sept 2025); a DIFFERENT, currently-open class of Windows binary-resolution bugs persists through v1.17.19–v1.18.3 (through 2026-07-16) — keep and strengthen the native-exe fallback, matching Codex's always-resolve pattern. Confidence: high on "not fully fixed"; medium on "identical bug on `.cmd`" (inferred, not directly evidenced).**

### 1. Is the wrapper bug fixed?

The _specific_ symptom in the adapter's current comment — PowerShell's `.ps1` wrapper invoking `/bin/sh.exe`, which doesn't exist on stock Windows — was tracked as **`anomalyco/opencode` #2447** ("How to install OpenCode easily on Windows"), opened 2025-09-06, closed 2025-09-08 with: _"Closing since npm install was addressed by: https://github.com/sst/opencode/pull/2419"_. So yes, that exact bug is fixed, dating to opencode's pre-1.0 era (repo was `sst/opencode` then).

However a **different, still-open** class of Windows binary bugs has recurred on every recent release train:

- **#4195** (2025-11-11) — pnpm-installed Windows build fails the same way, described as a variant of the sh.exe problem.
- **#27963** — "Corrupted executable on Windows" (opencode-ai v1.15.3, still **open**), and referenced as a likely duplicate root cause of...
- **#28920** (opened 2026-05-22, **still open** as of last update 2026-06-26) — "Windows x64 npm install v1.15.9: opencode.ps1 points to wrong opencode.exe path causing CLI execution failure." The `.ps1` at `%APPDATA%\npm\opencode.ps1` line 14 references `$basedir/node_modules/opencode-ai/bin/opencode.exe`, but v1.15.9 places the real binary at `$basedir/node_modules/opencode-ai/node_modules/opencode-windows-x64/bin/opencode.exe`. A commenter noted `npm update -g` (vs. a clean `npm i -g`) can mask the bug because a stale exe lingers at the old path.
- **#36737** (opened 2026-07-13, **still open**, most recent of the batch) — "Windows: opencode-ai@1.17.19 global npm install leaves 479-byte placeholder opencode.exe when postinstall is blocked." When npm's script-allowlisting blocks `postinstall.mjs` (common under `--ignore-scripts` / `allowScripts` hardening, which is plausible in CI or locked-down corporate images), the top-level `bin/opencode.exe` stays a 479-byte stub while the real 184MB binary sits correctly at `opencode-ai/node_modules/opencode-windows-x64/bin/opencode.exe`. Symptom: `"The specified executable is not a valid application for this OS platform"` / `"Unsupported 16-bit application"`.

**Net**: the original reported bug is fixed; the broader "opencode.exe at the path the wrapper points to may be wrong/missing/corrupt on Windows" problem is _not_ — it has reproduced on 4 different releases spanning Nov 2025 through Jul 2026 (most recent 3 days before this research date), with no linked fix PR/release note found for #28920 or #36737 as of v1.18.3.

**Does it reproduce on `.cmd` (what our adapter actually spawns)?** I could not find a GitHub issue that explicitly reproduces on the `.cmd` wrapper rather than `.ps1` — every issue I found quotes the `.ps1` error path. This is an **inferred, not directly evidenced** claim: npm's `bin`-field shim generation (`cmd-shim`) emits `.cmd`, `.ps1`, and a POSIX shell script from the _same_ `bin` target path in `package.json`, so a wrong/missing/placeholder target binary (the #28920/#36737 root cause) would almost certainly break `.cmd` identically — but I did not find a source-level confirmation of this, and did not have a Windows box with `opencode-ai@1.17.x`/`1.18.x` installed to reproduce directly. Treat "the `.cmd` path is equally exposed" as the safest assumption, not a verified fact.

### 2. Current recommended install for Windows

From `opencode.ai/docs/` (fetched 2026-07-17): `npm install -g opencode-ai`, `choco install opencode`, `scoop install opencode`, `mise use -g github:anomalyco/opencode`, Docker, or a standalone binary from the GitHub Releases page. Notably, **the docs themselves recommend WSL** "for better performance and full compatibility with OpenCode's features" — a signal that native-Windows install is still treated as second-class as of this release train, consistent with the open issues above.

The native platform package name is unchanged: **`opencode-windows-x64`** (and `opencode-windows-arm64`), confirmed live in the #28920/#36737 bug reports against v1.15.9 and v1.17.19 — matches the adapter's `OPENCODE_WINDOWS_PACKAGES` map exactly, no rename.

One structural detail worth folding in: per #36737, when postinstall succeeds normally, npm copies the real binary to the **top-level** `<opencode-ai>/bin/opencode.exe` (this is what the `.cmd`/`.ps1` wrapper's hardcoded relative path points at) — a location the adapter's `resolveOpencodeNativeBinary()` does **not** currently check. That's fine: when postinstall succeeds, the shim already works and no fallback is needed. The adapter's existing candidates (`node_modules/opencode-ai/node_modules/opencode-windows-x64/bin/opencode.exe` via `require.resolve('opencode-ai/package.json')`, plus the `require.resolve('opencode-windows-x64/package.json')` and `%APPDATA%\npm\...` variants) target exactly the **nested "real" platform-package binary** that #28920/#36737 show is still valid even when the top-level wrapper target is broken/placeholder/misdirected. No change needed to the candidate list itself — only to when it's consulted.

### 3. Recommended gate change

Match `CodexCliAdapter.resolveCodexNativeBinary()`'s pattern exactly: it is called **unconditionally** (`libs/backend/cli-agent-runtime/.../codex-cli.adapter.ts:474`, `const nativeBinaryPath = resolveCodexNativeBinary(options.binaryPath);`), passing the detected CLI path in as a resolution _hint_ (used to derive sibling `node_modules` candidates), and overrides only `if (nativeBinaryPath)` is truthy — it doesn't gate on whether `options.binaryPath` was set at all.

Recommendation is **option (a)**, reframed to mirror Codex precisely rather than a blunt "always prefer regardless": **on win32, always attempt native-binary resolution and prefer it when found — pass `options.binaryPath` into the resolver as a hint instead of gating on its absence.**

```ts
// resolveOpencodeNativeBinary already accepts detectedCliPath — thread it through
// unconditionally instead of gating on `!options.binaryPath`:
function resolveOpencodeNativeBinary(detectedCliPath?: string): string | undefined {
  // ...unchanged body; detectedCliPath already feeds the cliDir-based candidates.
}

// in runSdk():
let binary = options.binaryPath ?? 'opencode';
const native = resolveOpencodeNativeBinary(options.binaryPath); // no `!options.binaryPath` guard
if (native) {
  binary = native;
}
```

Rationale:

- **Not (c) "drop as dead code"** — the specific `/bin/sh.exe` bug is fixed, but #28920 and #36737 show the underlying class of "the wrapper's target binary is wrong/corrupt/placeholder on Windows" is actively reproducing on the current release train (most recent report 4 days before this research), so the fallback still earns its keep — arguably _more_ now, since #36737's root cause (blocked postinstall script leaving a placeholder) is exactly the scenario where preferring the nested platform-package binary over the top-level wrapper target saves the run.
- **Not (b) "retry only on ENOENT/`/bin/sh` error"** — fragile: #36737's failure mode is a Windows loader error ("not a valid application for this OS platform" / "Unsupported 16-bit application"), not a spawn-time `ENOENT`, and matching on stderr text for `/bin/sh` is already the wrong bug (that one's fixed). Detecting the current bug class reliably via error-string matching means keeping pace with whatever exact Windows loader message each new report contributes — brittle. Since the manager unconditionally sets `binaryPath` today (making today's gate unreachable dead code per the task's own framing), and `existsSync` is cheap, unconditional resolve-and-prefer is simpler and strictly safer.
- Matches the established in-repo precedent (Codex) rather than inventing a third pattern, and needs a one-line change (drop the `if (!options.binaryPath)` wrapper around the existing `resolveOpencodeNativeBinary()`/assignment block at `opencode-cli.adapter.ts:475-481`).

**Caveat**: I did not find a release note or changelog entry confirming #28920/#36737 are fixed in v1.18.0–v1.18.3 (2026-07-14 to -16) — both issues show `state: open` as of my last check. If they get fixed in a near-future release, the unconditional-prefer approach is still safe (it only overrides when the native `.exe` file actually `existsSync`s at a known-good path — a fixed wrapper and a working fallback both just resolve to the same binary), so this recommendation doesn't need revisiting even if upstream fixes land.

---

## Sources

- https://opencode.ai/docs/cli/ (fetched 2026-07-17)
- https://opencode.ai/docs/config/ (fetched 2026-07-17)
- https://opencode.ai/docs/mcp-servers/ (fetched 2026-07-17)
- https://opencode.ai/docs/ (fetched 2026-07-17)
- https://github.com/anomalyco/opencode/blob/main/packages/opencode/src/config/config.ts (fetched via `gh api` 2026-07-17; mirrors v1.18.x release line)
- https://github.com/anomalyco/opencode/issues/2447 (closed 2025-09-08, fixed by https://github.com/sst/opencode/pull/2419)
- https://github.com/anomalyco/opencode/issues/4195 (2025-11-11)
- https://github.com/anomalyco/opencode/issues/27963 (open)
- https://github.com/anomalyco/opencode/issues/28920 (opened 2026-05-22, open as of 2026-06-26)
- https://github.com/anomalyco/opencode/issues/36737 (opened 2026-07-13, open)
- https://github.com/anomalyco/opencode/releases (v1.18.3, 2026-07-16 = latest at research time)
- Local: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts`, `codex-cli.adapter.ts`, `cli-adapter.utils.ts`
