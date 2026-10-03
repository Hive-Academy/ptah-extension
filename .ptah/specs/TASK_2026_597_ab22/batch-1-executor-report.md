# Batch 1 executor report — TASK_2026_597_ab22

Batch: Codex lane config builder (S1a, component 1). Executor: backend-developer (Claude subagent, no CLI lanes).

## Headline

Both files are in place with real logic and specs. All 42 new tests pass, and lint and typecheck pass. The scoped
test target fails on 5 existing tests. Those tests cover files that the concurrent Batch 5 is editing, not files in
this batch. An offline probe of the bundled codex 0.155.1 binary changed the user-server key form (see Plan deviations).

## Tasks

| Task                                    | State                      | Evidence                                                                                                                                                                                                             |
| --------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0 `npm ci` in the worktree            | DONE (by the orchestrator) | `node_modules/@openai/codex-sdk` (0.155.1) and `node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe` are present. `package.json` and `package-lock.json` are not modified (git status). |
| 1.1 User MCP server name reader         | DONE                       | `codex-user-mcp-servers.ts` + spec, 7 cases passing                                                                                                                                                                  |
| 1.2 `buildCodexLaneConfig` pure builder | DONE                       | `codex-lane-config.builder.ts` + spec, 35 cases passing                                                                                                                                                              |

## Files

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-user-mcp-servers.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-user-mcp-servers.spec.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-lane-config.builder.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-lane-config.builder.spec.ts`

No other file was touched. The `cli-adapters/index.ts` barrel was not widened: no consumer exists until Batch 4 imports
the files by relative path.

## Contracts (for Batch 4 / Batch 8 / Batch 11)

- `readCodexUserMcpServerNames(workspaceRoot: string, options?: CodexTrustOptions): Promise<{ names: string[]; warnings: string[] }>`
  - Async, because it reuses the harness-sync `CodexTomlMcpFacet.inspect`.
  - `options` is for specs only.
- `buildCodexLaneConfig(input: CodexLaneConfigInput): { entries: string[]; warnings: string[] }`
  - Input fields: `variant`, `autoCompactTokens`, `toolOutputTokenLimit`, `webSearch`, `reasoningEffort?`, `mcpPort?`,
    `workingDirectory`, `agentId?`, `userMcpServerNames`, `developerInstructions?`, `codexVersion?`,
    `resendRoleOnResume?`.
  - `resendRoleOnResume` exists only so the spec can test the `false` case. Callers leave it unset.
- Exported constants: `CODEX_RESUME_RESENDS_ROLE = true`, `CODEX_VERIFIED_VERSIONS = ['0.155', '0.160']` and
  `CODEX_PTAH_TOOL_TIMEOUT_SEC = 960`.
- The builder stays pure: the caller reads the server names and passes them in, and the caller merges both `warnings`
  lists into the lane log.

## Stack observed

- Nx lib `@ptah-extension/cli-agent-runtime`:
  - test runs Jest (`project.json` `test`, `jest.config.ts` maps `vscode` to the repo mock);
  - lint runs ESLint;
  - typecheck runs `tsc --noEmit -p tsconfig.lib.json`.
- No DI is used in these files: plain functions only, matching `ptah-mcp-url.ts`.
- harness-sync owners come from the `@ptah-extension/harness-sync` barrel (`src/index.ts:200-213`):
  - `CodexTomlMcpFacet` (`configPath`, `inspect`) supplies both paths, and `inspect` turns ENOENT into `missing` and
    other read failures into `error`;
  - `codexProjectTrusted` supplies the trust rule;
  - `CodexTrustOptions` is the options type.
- The files import neither `vscode-core` nor `tsyringe`, and add no path literal.

## Verification

Command: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime --parallel=2`

```
√  nx run @ptah-extension/cli-agent-runtime:typecheck
√  nx run @ptah-extension/cli-agent-runtime:lint
Test Suites: 5 failed, 74 passed, 79 total
Tests:       5 failed, 1 skipped, 1528 passed, 1534 total
Failed tasks: - @ptah-extension/cli-agent-runtime:test
```

- The new specs, run alone with `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts .../cli-adapters/codex`,
  both pass (2 suites, 42 tests).
- `npx eslint .../cli-adapters/codex` finds no problems.

The 5 failing tests are outside Batch 1. Nothing imports the new files (grep), so they cannot cause these failures:

- `CodexCliAdapter › rejects an oversized role before the Codex client is constructed`
- `AntigravityCliAdapter › rejects an oversized role before writing the MCP entry or spawning`
- `CopilotSdkAdapter › surfaces the command-line guard error from spawnCli for an oversized role`
- `ptah-cli spawn path › delivers a 64 KiB role over the initialize request, never argv or env`
- `PtahCliRegistry.spawnAgent › ordering › hands the resolved policy to the spawn-option assembly`
  (`assembleSpawnOptions.mock.calls[0][7]` is now `undefined`)

All five match Batch 5's uncommitted edits in the same worktree:

- the role cap in `cli-adapter.utils.ts` and `lane-role-condenser.ts` makes an "oversized" role fit;
- the signature change in `ptah-cli-spawn-options.service.ts` and `ptah-cli-registry.ts` moves the policy argument.

Batch 5 owns these specs. I left them unchanged.

## Plan deviations

1. **User-server disables are emitted as ONE inline table, placed before `mcp_servers.ptah.*`.**
   - Plan :514 specifies `mcp_servers."<name>".enabled=false`.
   - I checked this offline with the bundled `codex.exe` 0.155.1. Each probe ran `codex -c ... mcp list --json` against
     a scratch `CODEX_HOME`, made no model call and read no user config.
   - Codex splits an override KEY on every `.` and does not honour quotes:
     - `mcp_servers."foo".enabled=false` gives `invalid transport in mcp_servers."foo"`, and the whole config fails to
       load;
     - `mcp_servers.'a.b'.enabled=false` fails the same way;
     - a name that contains a dot cannot be addressed by a dotted key at all.
   - The override VALUE is parsed as TOML and is deep-merged with the file layers:
     `mcp_servers={"a.b"={enabled=false}}` disables `a.b` and leaves `foo` alone.
   - Overrides apply in order to one table:
     - a later `mcp_servers={...}` REPLACED an earlier `mcp_servers.ptah.url` (ptah disappeared);
     - dotted ptah keys placed after it extend it (ptah kept, with `tool_timeout_sec: 960.0`).
   - The builder therefore emits `mcp_servers={"<name>"={enabled=false},...}`. Names are quoted with TOML basic-string
     rules, which still meets the quoting requirement. The entry comes immediately before `mcp_servers.ptah.url`.
     Every other key keeps the plan's order.
   - I also loaded the full emitted key set, including `web_search="disabled"`, `developer_instructions` with escapes,
     and the user-server table, in the same probe. The config loaded.
2. **The reader returns only names it can read exactly.**
   - The same probe showed that disabling a server Codex did NOT load (`zzz`) fails the whole config.
   - So the reader:
     - honours workspace trust exactly as Codex does;
     - unquotes `"x y"`;
     - skips, with a warning, any name it cannot read exactly. `parseMcpServerTables` splits `[mcp_servers."a.b"]`
       into `"a`.
   - The plan intent stays the same: an odd config produces no disables and a warning.
3. **0 or invalid numbers.**
   - 0 omits a key silently.
   - A negative, fractional, NaN or infinite count omits the key and adds a warning naming the key. The builder does
     not throw.
   - An `mcpPort` of 0 or absent means "no port", matching the adapter's existing `if (options.mcpPort)`.
   - A port outside 1-65535 emits no ptah keys and adds a warning.

## Risks and edge cases handled

- **Unreadable user config** (edge case; Tasks 1.1, 4.2): an unreadable file gives no names from that file and one
  warning, and the reader never throws.
  - Spec: a directory at the home path, and a directory at the trusted workspace path. Home names are kept in the
    second case.
  - A missing file gives no names and no warning.
- **Version unknown or outside `CODEX_VERIFIED_VERSIONS`:** the builder adds a warning and still emits every key.
  - Specs: `0.170.2`, and `0.15.9` (not a false prefix match for `0.155`).
  - Unknown inputs: `undefined`, `''`, `'unknown'`.
  - Verified versions are silent: `0.155.1`, `0.160.0`, `codex-cli 0.160.3`.
- **Resume without role:** `resendRoleOnResume: false` with `variant: 'resume'` omits `developer_instructions` and
  keeps `model_auto_compact_token_limit`. The first turn still carries the role. With the shipped constant (`true`),
  resume output is byte-equal to first-turn output.
- **Dead flag:** the spec asserts that `tool_search_always_defer_mcp_tools`, `enabled_tools` and `max_depth` never
  appear.
- **R9.7 concurrency and purity:** the builder keeps no module state and does not mutate its input. Names are deduped
  and sorted, so input order cannot change the output. Concurrent builds produce byte-equal output for equal input
  (spec).
- **TOML quoting:**
  - quote, backslash, `\b \t \n \f \r`, C0 controls, DEL, C1 controls and U+2028/U+2029 are escaped as `\uXXXX`;
  - a lone surrogate becomes `\uFFFD`;
  - other Unicode stays raw.
- **D9 assumption:** the batch reuses the harness-sync owners only and adds no platform port.
- **N-A (Batch 4):** not in this batch. The builder emits `web_search`, `approval_policy` and `model_reasoning_effort`
  as config entries. Batch 4 must remove the matching thread options, or they will override these.

## Out-of-scope observations

- Batch 4: the reader runs per spawn and costs two small file reads. Its `warnings` need to go to the lane log next to
  the builder's warnings.
- Batch 4 and Batch 8: the whole emitted set passed this probe. A name the reader trusts could still be one Codex does
  not load, for example a server declared only inside a profile or under a different trust spelling. Task 4.2/4.3's
  "config rejected, retry with essential keys only" path is the backstop for that case. The essential keys should
  leave out the `mcp_servers={...}` entry.
- Batch 18: the TOML writer may need the same naive-split caution if it ever emits overrides. Its file edits are
  unaffected.

## Fix round 1

Source: `batches.md` § "Batch 1 fix round 1" and `batch-1-code-logic-review.md`. I edited only the four files under
`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/`. Nothing was suppressed. I did not run any
git stash, checkout or reset, and made no commit.

### F1: safe integers only (M1)

- `validCount` now uses `Number.isSafeInteger(value) && value >= 0`. The comment explains the `1e21` → `1e+21`
  float trap.
- Spec cases:
  - `1e21`, `Number.MAX_SAFE_INTEGER + 1` and `-Infinity` omit the key with a warning naming it. They join the earlier
    `-1`, `1.5`, `NaN` and `+Infinity` cases.
  - `-0` omits the key silently.
  - `Number.MAX_SAFE_INTEGER`, the value just under the limit, is emitted as `9007199254740991`.

### F2: unparsed declarations are reported (M2)

- The reader now reads the file text itself. The path comes from the harness-sync `CodexTomlMcpFacet.configPath`;
  ENOENT means missing, and any other read error gives the existing warning.
- It runs `parseMcpServerTables` on that text, then scans the same text for two kinds of line:
  - a header-looking `mcp_servers` line that the scanner does not match, `^\[mcp_servers\.[^\]]+\]$`;
  - a top-level `mcp_servers…=` or `mcp_servers.<x>…=` key.
- Each such line gives one warning that quotes the line (cut at 120 characters) and says those servers stay enabled.
  No name is guessed.
- Specs:
  - a trailing-comment header (`[mcp_servers.docs] # added by hand`) is warned with the line quoted, and `docs` is not
    in `names`;
  - odd spacing, `[[mcp_servers.arr]]`, a bare `[mcp_servers]` and a top-level dotted key each give one warning;
  - a clean config, sub-tables included, gives no warning.

### F3: every emitted value is parsed as TOML (M3)

- Dependency check: `smol-toml` is in `node_modules` only as a transitive package. It is not declared in the root
  `package.json` (grep), so I did not use it. The spec carries a strict, minimal TOML 1.0 value checker for the forms
  the builder emits:
  - booleans;
  - decimal integers, with floats and exponents rejected and the safe range checked;
  - basic strings, with every escape class, raw control characters and DEL rejected, surrogate escapes rejected, and
    lone surrogates rejected;
  - single-line inline tables with bare or quoted keys, no trailing comma and no duplicate keys.
- The checker is proven strict by 11 rejection cases: `1e+21`, `1.5`, `9007199254740992`, a raw newline, a raw DEL,
  `\ud800`, `\q`, an unterminated string, a trailing comma, a duplicate key and a raw lone surrogate.
- `parseEntries` splits each entry the way Codex does: the key path is everything left of the first `=`, and it must be
  bare and dotted. It then parses each value.
- Round-trip assertions:
  - the full default config maps exactly to the expected object, including the inline `mcp_servers` table and the URL;
  - all five efforts round-trip, with `web_search="disabled"` and `MAX_SAFE_INTEGER`;
  - an instruction string holding every escape class (quote, backslash, `\t \n \r \b \f`, C0, DEL, C1, U+2028/2029,
    Latin, astral) round-trips byte-equal;
  - lone surrogates come back as U+FFFD;
  - nine odd server names (`a.b`, `quo"te`, `back\slash`, a tab, `single'q`, `é`, `x y`, `[bracket]`, `eq=name`)
    round-trip through `mcp_servers={...}`, with `ptah` dropped.

### F4: purity spec without `Promise.all`

- The spec makes repeated, interleaved synchronous calls (a, b, a, b, … ×5) with distinct inputs:
  - every `a` output is byte-equal to the first `a`, and every `b` output to the first `b`;
  - the `a` output differs from `b` and does not contain b's server name.
- The input object is snapshotted with `JSON.stringify` before the call and compared after it. The snapshot includes
  duplicate names and `ptah`.

### F5: resume spec asserts presence

- With the constant `true`, both first-turn and resume outputs `toContain` the exact `developer_instructions=…` entry,
  and the two outputs are still equal.
- The `resendRoleOnResume: false` case still asserts absence on resume. A separate case asserts presence on the first
  turn.

### F6: trust scope (probe result: Codex DOES trust subdirectories and worktrees through the repo root)

The probe ran from Git Bash against the bundled `codex.exe` 0.155.1 with `codex mcp list --json`. Each run used a
scratch `CODEX_HOME` under `C:\Users\Public\codexprobe*` (deleted afterwards), made no model call, and never touched the
real `~/.codex`. Trust keys were written the way Codex writes them, as lowercased Windows paths.

| Trust entry                     | cwd                                    | Project servers loaded    |
| ------------------------------- | -------------------------------------- | ------------------------- |
| repo root R                     | R                                      | R                         |
| repo root R                     | R/sub                                  | R, R/sub                  |
| repo root R                     | R/sub/deeper (no config of its own)    | R, R/sub                  |
| repo root R                     | worktree W of R (`git worktree add`)   | W                         |
| worktree W only, main untrusted | W                                      | W                         |
| R/sub only                      | R/sub                                  | R/sub (not R)             |
| R/sub only                      | R/sub/deeper (with its own config)     | R/sub (not R, not deeper) |
| none (untrusted repo)           | U/sub, worktree of U                   | none                      |
| non-git P                       | P                                      | P                         |
| non-git P trusted               | P/sub, P/c (child with its own config) | none                      |

What I implemented in `codex-user-mcp-servers.ts`. No harness-sync file was edited, and no git process is run.

- **Git root:** the nearest ancestor of the working directory that holds a `.git` entry, either a directory or a file.
- **Layers:** every directory from the git root down to the working directory. Without a `.git`, the only layer is the
  working directory itself.
- **When a layer is read:** if `codexProjectTrusted` holds for the exact layer, OR for the git root, OR for a worktree's
  main repository root. The main root is found by following the `.git` file's `gitdir:` to that directory's
  `commondir`; the result is used only if it resolves to a directory named `.git`.
- **Safe direction:** anything that cannot be followed counts as untrusted. Examples: a `.git` file with no
  `commondir` (a submodule), or an unreadable pointer.
- **Where the probe is recorded:** the probe table and the rule are in the file header.
- **Specs:** six cases.
  - A trusted root covers root and sub.
  - Trust on a subdirectory only covers that layer.
  - An untrusted repo reads no layer.
  - A worktree is trusted through its main root (fixture `.git` file plus `commondir`).
  - A submodule-style `.git` file stays untrusted.
  - Outside git there is no walk-up.

Residual risk: Codex's `project_root_markers` setting can change the marker away from `.git`.

> CORRECTED in fix round 2. This line first said that custom markers were "the safe direction". That was wrong. With
> `[".codex"]`, Codex stops trusting layers through the git root, so the round 1 reader over-trusted, and the
> resulting disables failed the config. The reader now reads no workspace layer when the markers are custom (see
> Fix round 2).

### Verification

- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime --parallel=2` exited 0:

  ```
  √  nx run @ptah-extension/cli-agent-runtime:lint
  √  nx run @ptah-extension/cli-agent-runtime:test
  √  nx run @ptah-extension/cli-agent-runtime:typecheck
   NX   Successfully ran targets test, lint, typecheck for project @ptah-extension/cli-agent-runtime
  ```

  The 5 failures outside this batch reported in round 0 no longer appear.

- The Batch 1 specs alone (`npx jest -c libs/backend/cli-agent-runtime/jest.config.ts cli-adapters/codex/`) give
  2 suites and 76 tests passing.
- `npx eslint` on the four files is clean, and `npx prettier --check` passes after `--write`.

### Files changed in this round

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-lane-config.builder.ts` (F1)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-lane-config.builder.spec.ts` (F1, F3, F4, F5)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-user-mcp-servers.ts` (F2, F6)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-user-mcp-servers.spec.ts` (F2, F6)

## Fix round 2

Source: `batch-1-code-logic-review.md` § Round 2, defect R2-1 (Moderate). R2-2 (minor) is handled as a header note. I
edited only the two reader files under `cli-adapters/codex/`. I did not run any git stash, checkout or reset, and made
no commit.

### R2-1: a custom `project_root_markers` no longer over-trusts

- `collectFrom` now returns the text it read, or `null` when the file is missing or unreadable.
- `readCodexUserMcpServerNames` passes the home text to a new `customRootMarkersLine`. That function looks only at
  top-level lines, meaning lines before the first `[` header, for `project_root_markers = …` with the key bare or
  quoted. It returns the line unless the value is exactly `[".git"]` or `['.git']`, allowing for spacing, an optional
  trailing comma and a trailing comment.
- Some forms are treated as custom on purpose, because that direction reads fewer layers:
  - extra markers;
  - an empty list;
  - a multi-line array.
- When the markers are custom and a workspace is given:
  - the reader reads no workspace layer;
  - it adds one warning that names the setting and quotes the line ("…sets project_root_markers ("…"), so the reader
    cannot tell which project layers Codex trusts; workspace MCP servers stay enabled in the lane.");
  - home servers are still read.
- File header:
  - The new rule is stated, and custom markers are explicitly "NOT a safe case".
  - The `.git` constant's comment now says it is the default marker only.
  - R2-2 is documented as a known gap: symlink and junction working directories are not canonicalised, which
    over-trusts if Codex canonicalises a linked trust entry.
- My round 1 report line that called custom markers "the safe direction" is corrected in place, with a note.

### Own offline probe (confirms the reviewer)

The probe ran from Git Bash against the bundled `codex.exe` 0.155.1. It used a scratch `CODEX_HOME` under
`C:\Users\Public\codexprobe3*` (deleted afterwards), made no model call and never touched the real `~/.codex`. Repo R
held `.codex/config.toml` at R (`rootsrv`) and at R/sub (`subsrv`). Only R was trusted, and the cwd was R/sub.

| Home `project_root_markers` | Servers loaded  | With `mcp_servers={"rootsrv"={enabled=false},"subsrv"={enabled=false}}` |
| --------------------------- | --------------- | ----------------------------------------------------------------------- |
| absent                      | rootsrv, subsrv | loads                                                                   |
| `[".git"]`                  | rootsrv, subsrv | loads                                                                   |
| `[".codex"]`                | subsrv only     | `failed to load bootstrap configuration … in mcp_servers.rootsrv`       |

With the fix, the third row produces no workspace names and one warning, so no disable is emitted for `rootsrv`.

### Specs added (`codex-user-mcp-servers.spec.ts`, F6 block, `project_root_markers (R2-1)`)

- These custom values each read no layer, keep the home server, and give exactly one warning that quotes the setting
  line:
  - `[".codex"]`
  - `[".git", ".hg"]`
  - `[]`
  - an unterminated multi-line `[`
- The default spelled `[".git"]`, and `[ '.git' ] # default`, keep the `.git` layer rule (`rootsrv`, `subsrv`, no
  warning).
- An absent setting keeps the `.git` layer rule.
- A `project_root_markers` key inside a `[profiles.other]` table is not treated as the top-level setting.

### Verification

- The Batch 1 specs alone give 2 suites and 84 tests passing (76 before this round, plus 8).
- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime --parallel=2` exited 0:

  ```
  √  nx run @ptah-extension/cli-agent-runtime:lint
  √  nx run @ptah-extension/cli-agent-runtime:test
  √  nx run @ptah-extension/cli-agent-runtime:typecheck
   NX   Successfully ran targets test, lint, typecheck for project @ptah-extension/cli-agent-runtime
  ```

- Prettier `--write` was applied to the four files.

### Files changed in this round

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-user-mcp-servers.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-user-mcp-servers.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\.ptah\specs\TASK_2026_597_ab22\batch-1-executor-report.md` (round 1 "safe direction" line corrected; this section)

### R2-2: symlink and junction working directories are canonicalised (added to round 2 on coordinator request)

The round 2 header recorded this as a "known gap". It is no longer a gap.

**Offline probe.** The probe ran from Git Bash against the bundled `codex.exe` 0.155.1. It used a scratch
`CODEX_HOME` under `C:\Users\Public\codexprobe4*` (deleted afterwards), made no model call and never touched the real
`~/.codex`. The junction J → R was created with `fs.symlinkSync(target, path, 'junction')` from node, because MSYS
mangles the `/J` switch of `cmd //c mklink /J`. Repo R held configs at R (`rootsrv`) and R/sub (`subsrv`).

| Trust entry | cwd                  | Servers loaded  |
| ----------- | -------------------- | --------------- |
| real R      | J/sub                | rootsrv, subsrv |
| real R      | J                    | rootsrv         |
| real R/sub  | J/sub                | subsrv          |
| link J      | J/sub, J, real R/sub | none            |
| link J/sub  | J/sub                | none            |

Codex canonicalises the working directory and compares the real path with the trust keys as written. A key that names
a link never matches. The round 2 reader compared the unresolved link path, so a link-named trust entry made it
over-trust. That was the unsafe case.

**Fix (`codex-user-mcp-servers.ts`).**

- `trustedProjectLayers` resolves the working directory with `realpathSync.native` before the `.git` walk and before
  any trust comparison. Every ancestor of a real path is itself real, so the layers and the git root need no second
  resolution.
- The worktree main root taken from `commondir` is also resolved with `realpathSync.native` before its trust check.
- When a resolution throws, that path counts as untrusted, and a warning names it ("Could not resolve the lane working
  directory (…); its workspace MCP servers stay enabled in the lane.").
- Trust comparison still goes through harness-sync `codexProjectTrusted`, with its separator and case folding, on the
  resolved path. That matches the probe: real path against the key as written.
- The header's "Known gap" paragraph is replaced by a "Symlinks and junctions" section that holds the probe table and
  the rule.

**Specs added (`symlinked or junction working directories (R2-2)`).**

- A junction to a trusted repo, with the cwd at `link/sub`, reads the real layers (`rootsrv`, `subsrv`) with no
  warning.
- A trust entry that names the link does not trust the untrusted target: no names and no warning. This is the case
  that over-trusted before the fix.
- An unresolvable working directory (does not exist) still reads home servers, returns no workspace names and gives
  one "Could not resolve the lane working directory" warning.
- The spec's temp root is now taken through `realpathSync.native`, so trust keys written by the spec name the real
  directory even when the OS temp path is itself a link.

**Verification.**

- The Batch 1 specs alone give 2 suites and 87 tests passing.
- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime --parallel=2` exited 0:

  ```
  √  nx run @ptah-extension/cli-agent-runtime:lint
  √  nx run @ptah-extension/cli-agent-runtime:test
  √  nx run @ptah-extension/cli-agent-runtime:typecheck
   NX   Successfully ran targets test, lint, typecheck for project @ptah-extension/cli-agent-runtime
  ```

**Files:** the same two reader files listed above (`codex-user-mcp-servers.ts` and `codex-user-mcp-servers.spec.ts`),
plus this report.

## Fix round 3 (K1: degradation-audit orphaned suppression)

No git command was run, and `batches.md` was not edited.

### Cause

The audit flagged two lines in `codex-user-mcp-servers.ts`:

```
codex-user-mcp-servers.ts:354 [catch-return-sentinel] catch swallows error and returns a literal
codex-user-mcp-servers.ts:356 [orphaned-suppression] degradation-audit marker did not attach to any flagged catch/.catch() site
```

The `catch` in `collectFrom` IS a flagged site (catch-return-sentinel). Its marker sat below the
`if (errorCode(error) === 'ENOENT') return null;` line instead of first in the catch block, so it did not attach.

### Fix

- I moved the marker to the first line of that catch block, which is the convention used in harness-sync
  `codex-project-trust.ts`.
- The reason now covers both returns: a missing config declares no servers, and an unreadable one yields no disables
  plus a warning; neither may stop the lane.
- There is no logic change: the same statements run in the same order. Only the comment moved and was reworded.
- No other marker in the four files was flagged.

### Evidence

- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1`:
  - exit 0;
  - findings under `cli-adapters/codex/`: 0 (`grep -c 'cli-adapters/codex/'` → 0);
  - `orphaned-suppression` anywhere in the output: 0;
  - tail: `degradation-audit: TOTAL 293 unsuppressed site(s)`.
- Batch 1 specs (`npx jest -c libs/backend/cli-agent-runtime/jest.config.ts cli-adapters/codex/`):

  ```
  Test Suites: 2 passed, 2 total
  Tests:       87 passed, 87 total
  ```

- `npx prettier --check` on the folder: all files use Prettier code style.

### File

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-user-mcp-servers.ts` (comment position and wording only)
