# Code Logic Review - TASK_2026_597_ab22, Batch 1 (Codex lane config builder)

## Summary

| Metric              | Value                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Overall score       | 7.5/10                                                                                        |
| Assessment          | APPROVED (no CHANGES REQUIRED blocker; 2 moderate items worth fixing before Batch 4 wires it) |
| Blocking issues     | 0                                                                                             |
| Serious issues      | 0                                                                                             |
| Moderate issues     | 3                                                                                             |
| Failure modes found | 6 (3 moderate, 3 minor)                                                                       |

Scope read in full: `codex-lane-config.builder.ts` (277 lines), `codex-lane-config.builder.spec.ts` (317), `codex-user-mcp-servers.ts` (151), `codex-user-mcp-servers.spec.ts` (127), plus the code they depend on: `harness-sync` `codex-toml-mcp-facet.ts` (`inspect`, `readStatus`, `parseMcpServerTables`, `parseTableHeader`), `codex-project-trust.ts`, and `ptah-mcp-url.ts`.

Independent offline probe (bundled codex 0.155.1, scratch `CODEX_HOME` under `C:\Users\Public`, `mcp list --json`, no model call, real `~/.codex` untouched):

- `mcp_servers={"foo"={enabled=false},"héllo"={enabled=false},"my server"={enabled=false}}` followed by `mcp_servers.ptah.url=...` and `mcp_servers.ptah.tool_timeout_sec=960`: all three user servers `enabled:false`, `ptah` present and enabled. Space and non-ASCII names work. This confirms the builder's order.
- Reverse order (`mcp_servers.ptah.url` first, inline table second): `ptah` is gone from the list. This confirms that the order is load-bearing, and the spec pins it (see below).
- A name Codex did not load (`q"x`) gives `invalid transport` and the whole config fails. This confirms the executor's reason for the reader's exact-name rule.
- `tool_output_token_limit=1e+21` fails with `invalid type: floating point ... expected usize`. This is relevant to finding M1.

Note on probing: PowerShell 5.1 strips embedded double quotes from native-command arguments, which makes a probe look as if the overrides were ignored. Use Git Bash for these probes. This is a tooling trap for whoever runs the AS16 QA check, not a code defect.

## Five logic questions

### 1. How does this fail silently?

- A user server the scanner cannot see is silently left enabled, and the reader emits no warning. `parseMcpServerTables` only recognises headers matching `^\[([^\]]+)\]$` (`codex-toml-mcp-facet.ts:~468`), so `[mcp_servers.foo] # my tool`, `[ mcp_servers.foo ]`, dotted-key (`mcp_servers.foo.command = ...`) and `[mcp_servers]` + inline-table forms never reach `inspection.servers`. The lane then runs with that server loaded: the token burn this task exists to stop. The direction is fail-safe for startup, but the reader's header says it "returns only names it is sure of" and warns about skipped names; it cannot warn about names it never saw. See M2.
- `codex-user-mcp-servers.ts:110-114`: a quoted name with a dot is skipped with a warning (good, no silent loss). A quoted dotted name leaves that server enabled by design.
- Trust is checked for the exact `workspaceRoot` only (`codex-user-mcp-servers.ts:70`). If Codex trusts the repo root and the lane runs in a subdirectory or a git worktree, the reader reports "untrusted" and does not read `.codex/config.toml`. Those servers stay enabled with no warning. Fail-safe for startup, silent for R3.1.

### 2. What user action produces unexpected behaviour?

- A user who hand-edits `config.toml` with trailing comments on table headers loses disable coverage (M2).
- A user whose `config.toml` holds a multi-line string (for example `developer_instructions = """..."""` or a pasted prompt) containing a line that looks like `[mcp_servers.x]` makes the line scanner invent server `x`. The builder then emits `{"x"={enabled=false}}` for a server Codex never loaded, and the probe above shows that is a hard `invalid transport` failure for the whole lane config. It is rare; the Task 4.3 "drop the `mcp_servers={...}` entry" retry is the backstop (AS16). See F5.
- A user server literally named `ptah` is never disabled (`codex-lane-config.builder.ts:215`, `codex-user-mcp-servers.ts:112`). The `mcp_servers.ptah.url` override then merges onto the user's `command` table. This is the same behaviour as before the batch and is a minor edge.

### 3. What input data produces a wrong answer rather than an error?

- `validCount` (`codex-lane-config.builder.ts:~190`) accepts any `Number.isInteger` value. `Number.isInteger(1e21)` is true, and `${1e21}` renders `1e+21`. Codex parses that as a float and rejects the whole config (probe above). Any integer above `Number.MAX_SAFE_INTEGER` can also mis-render and exceed `usize`. This produces a config rejection, not a wrong answer, but it is the "success-looking then fatal" shape. Use `Number.isSafeInteger`. See M1.
- Negative zero, `0`, `NaN`, `Infinity`, `-1`, `1.5`: handled (0 and -0 omit silently; the rest omit with a named warning, no throw). Spec covers `-1, 1.5, NaN, +Infinity` (`builder.spec.ts:205-222`), but not `-Infinity`, `-0` or `1e21`.
- Port: absent or `0` means no ptah keys with no warning; `NaN`, negative, fractional or above 65535 give a warning and no ptah keys (`builder.ts:~145-165`). Correct. A non-number `mcpPort` at runtime (string) hits `isInteger` false and gets a warning. Fine.
- Server names: `userServerNames` dedupes, drops `''` and `ptah`, and sorts by code unit. Names with a quote, backslash, control character, space or non-ASCII are escaped by `tomlBasicString`. A name with a dot goes through the VALUE side (TOML key quoting), so it is addressable, as the probe confirms for space and `é`. Correct.
- `tomlBasicString` (`builder.ts:~235-277`): handles `"`, `\`, `\b \t \n \f \r`, other C0, DEL, C1, U+2028/2029 (escaped as `\uXXXX`), a lone surrogate (becomes U+FFFD), and keeps astral characters raw via `for...of`. Valid TOML 1.0 basic-string output for every branch I traced.

### 4. What happens when a dependency fails?

- Unreadable or missing `config.toml`: `inspect` returns `missing` (ENOENT, no warning) or `error` (anything else, one warning naming the path and the cause). The reader never throws, and a throw from `inspect` is also caught (`codex-user-mcp-servers.ts:84-95`). Home read failure does not block the workspace read, and vice versa. Correct, and tested for a directory in place of the file (`user-mcp.spec.ts:89-111`).
- Malformed TOML: the scanner never throws. It degrades to "fewer names" without a warning (see M2). `codexProjectTrusted` treats unreadable or unparsable trust as untrusted (safe direction).
- Codex version unknown or unsupported: warning, keys still emitted. Regex `(\d+)\.(\d+)` plus an exact `major.minor` membership check, so `0.15.9` is not a prefix match for `0.155` (spec at `builder.spec.ts:245`). `'codex-cli 0.160.3'` is handled. Correct.
- The builder is pure (imports only `ptahMcpServerUrl`, no I/O, no clock, no module state). It does not mutate its input (the `Set` copy is sorted, not `names`). Verified by reading and by `builder.spec.ts:311`.
- Windows argv: each entry becomes one argv string. A value with `"` is safe when spawned without a shell. The direct runner (outside this batch) must not spawn through `cmd.exe` or `shell:true` with these entries, and Batch 5's role cap is what keeps `developer_instructions` under the Windows command-line limit. Not a defect in this batch; flagged for Batch 4.

### 5. What is missing that the requirements never mentioned?

- No validation against a real TOML parser. Every assertion compares the output with a hand-written literal produced by the same author, so a systematic misunderstanding of TOML would pass. The executor's offline probe (which I reproduced) is the real evidence, and it is not captured in a repeatable check. Recommend recording the AS16 probe as a documented QA command (with the Git Bash note above).
- The reader runs two file reads on every spawn and every resume. Batch 4 will likely add the same warnings to the log every turn, including the version-unknown warning. Dedupe at the call site, not here.
- The reader does not report "servers seen but unreadable by the scanner". See M2.

## Failure modes

### F1 - Integer above safe range renders as a float

- Trigger: `autoCompactTokens` or `toolOutputTokenLimit` >= 1e21 (or above `usize`).
- Symptom: `codex ... failed to load bootstrap configuration: invalid type: floating point`. The lane does not start.
- Evidence: `codex-lane-config.builder.ts` `validCount` (`Number.isInteger`); probe with `1e+21`.
- Current handling: emitted as `1e+21`.
- Recommendation: `Number.isSafeInteger`; spec a `1e21` and `Number.MAX_SAFE_INTEGER + 1` case. Batch 2 settings may already clamp the range, in which case this is defence in depth only.

### F2 - Undetected server declarations stay enabled with no warning

- Trigger: header with a trailing comment or inner spaces, dotted-key or inline-table declaration, `[[...]]` forms.
- Symptom: the user's MCP server is still loaded in the lane; schema tokens are not saved.
- Evidence: `parseMcpServerTables` header regex; `codex-user-mcp-servers.ts` only warns for names it received.
- Current handling: silent.
- Recommendation: after the scan, count `mcp_servers` occurrences in the raw text (cheap `/^\s*\[?\s*mcp_servers\b/m` heuristic through `inspect`'s file text, or a harness-sync accessor) and warn when the count of recognised tables is lower. Alternatively, tolerate a trailing comment in the harness-sync header regex (a harness-sync change, outside this batch).

### F3 - Workspace servers not read when Codex trust is resolved at the repo root

- Trigger: lane `workspaceRoot` is a subfolder or git worktree of a trusted repo.
- Symptom: workspace `.codex/config.toml` servers are not disabled, and no warning.
- Evidence: `codex-user-mcp-servers.ts:70`; `codexProjectTrusted` exact-path match.
- Current handling: fail-safe (nothing disabled).
- Recommendation: acceptable for now; note it as a known limit in the Batch 4 hand-off.

### F4 - A hard-rejected disable is possible if the scanner invents a name

- Trigger: a `[mcp_servers.x]` line inside a multi-line string, or an equivalent false positive.
- Symptom: whole lane config fails with `invalid transport`.
- Evidence: the executor's probe and mine (`q"x`).
- Current handling: none in this batch; relies on the Task 4.3 essential-keys retry (AS16).
- Recommendation: keep AS16 and the retry. Add a Batch 4 spec that proves the retry drops only the `mcp_servers={...}` entry.

### F5 - User server named `ptah`

- Trigger: user config has `[mcp_servers.ptah]` with `command`.
- Symptom: merged table has both `command` and `url`.
- Evidence: `builder.ts:215`, `user-mcp.ts:112`.
- Current handling: excluded from disable; override merges.
- Recommendation: minor; leave as is, or warn.

### F6 - Warnings repeated every turn

- Trigger: unknown version or skipped names on every spawn and resume.
- Symptom: log noise. Not a correctness failure.
- Recommendation: Batch 4 should dedupe per lane.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- **M1 (Moderate)** `codex-lane-config.builder.ts` `validCount`: use `Number.isSafeInteger` (F1). Spec gap at `builder.spec.ts:205`: add `-Infinity`, `-0`, `1e21`.
- **M2 (Moderate)** `codex-user-mcp-servers.ts:101-117`: the "never silently wrong" promise holds only for names that reach the loop. Declarations the scanner cannot see leave servers enabled with no warning (F2).
- **M3 (Moderate)** Specs prove string equality, not TOML validity or Codex acceptance. Capture the probe as a documented QA step (AS16) and, in the specs, at least assert that each entry's value side balances quotes and braces for the odd-name cases.
- Minor: `builder.spec.ts:153-157` ("resume carries developer_instructions") only compares resume with first-turn, so it would pass if both omitted the key; the full-list test at `:48` covers this, but assert `toContain` on the key here.
- Minor: `builder.spec.ts:287-299` "purity" wraps a synchronous function in `Promise.all`, which cannot expose shared state; `JSON.stringify(ra) === JSON.stringify(ra2)` is a determinism check, not a concurrency check. The real purity evidence is the code (no module state). Rename or accept.
- Minor: the dead-flag test (`builder.spec.ts:69`) checks one input only. The code has no path that emits the flag, so it is adequate.
- Minor: `PTAH_SERVER_NAME` is defined twice (builder and reader); out of scope for this review (style).
- Minor: reader spec lacks single-quoted names, names with a backslash or quote (should be skipped with a warning), `[mcp_servers."ptah"]` (should be excluded), and a quoted name with a space plus a sub-table (`[mcp_servers."x y".env]`) that I traced by hand and found correct.

## Data flow

1. Caller reads user MCP names: `readCodexUserMcpServerNames(workspaceRoot)`. OK: home file always; workspace file only if exact-path trusted; per-file failure becomes a warning. Gap: see F2, F3.
2. Caller passes names plus settings into `buildCodexLaneConfig`. OK: pure, validated numbers, port range.
3. Builder emits prefix keys, budget keys, web search, approval, effort. OK.
4. Builder emits `mcp_servers={...}` then `mcp_servers.ptah.*`. OK (verified by probe, both orders).
5. Builder emits `developer_instructions` (first turn, or resume while the constant is true). OK.
6. Caller passes `entries` as `--config` args and merges both `warnings` lists. Not in this batch; Batch 4 must handle the Windows argv and the retry.

## Requirements fulfilment

| Requirement                                                             | Status   | Gap                                                                                                                       |
| ----------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| R3.1 disable every user MCP server except ptah, quoted names, read-only | PARTIAL  | Servers the scanner cannot see stay enabled silently (F2); trust resolved on exact path only (F3). Builder side COMPLETE. |
| R3.2 ptah URL and tool timeout 960                                      | COMPLETE | Order verified by probe.                                                                                                  |
| R3.5 dead flag never emitted                                            | COMPLETE | Spec asserts; code has no path.                                                                                           |
| R4.1 / R4.2 budget keys, 0 omits                                        | COMPLETE | Add safe-integer bound (M1).                                                                                              |
| R4.4 resume variant and role constant                                   | COMPLETE | `CODEX_RESUME_RESENDS_ROLE = true` pinned.                                                                                |
| R9.2 timeout constant                                                   | COMPLETE | 960 pinned.                                                                                                               |
| R9.6 version warnings                                                   | COMPLETE | Keys still emitted; prefix trap tested.                                                                                   |
| R9.7 pure and concurrent-safe                                           | COMPLETE | No module state.                                                                                                          |

Implicit requirements not addressed: warning dedupe across turns; a repeatable offline QA probe; behaviour when the user already names a server `ptah`.

## Edge cases

| Case                                              | Handled | How                                                    | Concern                    |
| ------------------------------------------------- | ------- | ------------------------------------------------------ | -------------------------- |
| Missing config file                               | YES     | `missing`, no warning                                  | none                       |
| Unreadable config (EISDIR/EACCES)                 | YES     | warning, other file still read                         | none                       |
| Malformed TOML                                    | PARTIAL | scanner never throws                                   | silent miss (F2)           |
| Name with dot                                     | YES     | skipped with warning in reader; builder would quote it | none                       |
| Name with space or unicode                        | YES     | probe-confirmed                                        | none                       |
| Name with quote or backslash                      | YES     | reader skips with warning; builder escapes             | none                       |
| Untrusted workspace                               | YES     | not read                                               | subdirectory/worktree (F3) |
| Number 0 / negative / fractional / NaN / Infinity | YES     | omit, warn (0 silent)                                  | `1e21` (F1)                |
| Port 0 / undefined / 70000 / NaN                  | YES     | omit; warn for invalid                                 | none                       |
| Resume without role                               | YES     | omitted when constant false                            | none                       |
| Equal input twice / reordered names               | YES     | byte-equal                                             | none                       |

## Verdict

- Recommendation: APPROVE (with M1 fixed in a follow-up edit before Batch 4 lands; M2 and M3 can be tracked)
- Confidence: HIGH on the builder (read in full and probed); MEDIUM on the reader (depends on a scanner owned by harness-sync)
- Top risk: a server the scanner misreads or never sees either stays loaded silently (token burn) or, in the rare false-positive case, hard-fails the lane config; the Task 4.3 retry is the only backstop for the latter.
- What a robust implementation would add: `Number.isSafeInteger` for the counts; a reader warning when the file text mentions more `mcp_servers` declarations than the scanner recognised; trust resolution that matches Codex's repo-root rule; a captured, Git Bash-based `codex mcp list --json` check run at QA; spec cases for `1e21`, `-Infinity`, single-quoted and escaped names, and a quoted `ptah`.

---

# Round 2 (re-review after fix round 1)

Scope: F1-F6 from batches.md "Batch 1 fix round 1", checked against the current content of the four files. I read both specs in full and the new reader (`codex-user-mcp-servers.ts`, 326 lines), and ran `npx jest ... cli-adapters/codex/`: 2 suites, 76 tests pass. I repeated the trust probe offline (Git Bash, bundled codex 0.155.1, scratch `CODEX_HOME` under `C:\Users\Public\rev597b`, `codex mcp list --json`, no model call; the scratch tree was deleted afterwards; the real `~/.codex` was not touched).

| Item                           | Status                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 / M1 safe integers          | FIXED                       | `codex-lane-config.builder.ts:202` now uses `Number.isSafeInteger`. The spec covers `1e21`, `MAX_SAFE_INTEGER + 1`, `-Infinity`, `-0` (silent) and `MAX_SAFE_INTEGER` emitted as plain digits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| F2 / M2 unscanned declarations | FIXED                       | `unscannedDeclarations` (`codex-user-mcp-servers.ts:271-286`) warns, quoting the line, for header-like lines the scanner regex does not match (trailing comment, odd spacing, `[[...]]`, bare `[mcp_servers]`) and for top-level `mcp_servers...=` keys. I traced the regexes: `[mcp_servers.foo.env]` stays silent, `[mcp_servers.foo] # c` warns, and a header with `]` in the name also warns. No name is guessed. The spec asserts the exact warning count and that each line is quoted. Lines inside multi-line strings can over-warn, which is the safe direction.                                                                                                                                                                                                    |
| F3 / M3 TOML round trip        | FIXED                       | The in-spec checker is strict, not a tautology. It rejects floats and exponents (`1e+21`, `1.5`), integers over the safe range, a raw newline, raw DEL, a `\ud800` escape, `\q`, an unterminated string, a trailing comma, duplicate keys and a raw lone surrogate (11 cases, each `toThrow`). `parseEntries` forces the key path to be bare and dotted, which matches the probe fact that Codex splits keys on dots. It is hand-written, so I closed the shared-misreading gap with the real binary: a scratch home config declaring `"a b"`, `"[bracket]"`, `"eq=name"` and `'single q'`, plus the override `mcp_servers={"a b"={enabled=false},"[bracket]"={enabled=false},"eq=name"={enabled=false},"single q"={enabled=false}}`, loaded with all four `enabled:false`. |
| F4 / purity spec               | FIXED                       | `Promise.all` is gone. The spec interleaves distinct inputs a, b, a, b x5, compares byte-equal output per input, checks a differs from b and that b's server name does not leak into a, and snapshots the input (with duplicates and `ptah`) before and after. The builder is synchronous, so this proves no module state, which is all it can prove.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| F5 / resume spec               | FIXED                       | The resume case now asserts `toContain(role)` on both outputs plus equality. The `resendRoleOnResume:false` case still asserts absence on resume and presence on the first turn.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| F6 / trust scope               | NOT SAFE in one case (R2-1) | Matches every default-configuration row I reproduced; over-trusts when `project_root_markers` is customised.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## F6 verification

Probe layout: repo R with `.codex/config.toml` at R, R/sub and R/sub/deeper; a nested repo R/nested/inner with its own `.git`; a worktree W made by `git worktree add`, with its own config. Trust entry for R only, written as Codex writes it (lowercased Windows path).

| Case                                                        | Codex loaded             | Reader's rule                                                         | Match |
| ----------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------- | ----- |
| R trusted, cwd R/sub/deeper                                 | rootsrv, subsrv, deepsrv | git root R trusted, so all three layers                               | yes   |
| R trusted, cwd worktree W                                   | wsrv only                | `.git` file, `commondir` `../..`, main root R trusted, so W           | yes   |
| R trusted, cwd R/nested/inner (own `.git`)                  | nothing                  | git root is inner, a `.git` directory, no worktree pointer, untrusted | yes   |
| Submodule-style `.git` file (no `commondir`)                | n/a (spec)               | `readFileSync` of `commondir` throws, `null`, untrusted               | safe  |
| `.git` pointer unreadable, or main git dir not named `.git` | n/a                      | `null`, untrusted                                                     | safe  |
| Non-git P trusted, cwd P/sub                                | none (executor probe)    | no `.git`, exact layer only                                           | safe  |

Reading the rule (`codex-user-mcp-servers.ts:152-226`): `findGitRoot` stops at the first ancestor holding a `.git` entry; layers run from there to the cwd; a layer is read when the git root (or the worktree's main root) is trusted, else only when the exact layer is. `worktreeMainRoot` needs a `.git` file, a `gitdir:` line, a readable `commondir`, and a result named `.git`; every failure is `null`. With the default root marker I found no way to make it claim trust from a pointer it cannot follow.

### R2-1 (Moderate, new): a custom `project_root_markers` makes the reader over-trust, and the lane config then fails

- Trigger: the user's home `config.toml` sets `project_root_markers` to something other than the default `.git` (for example `[".codex"]`), and the lane runs in a subdirectory of a trusted repo.
- Probe: home config `project_root_markers = [".codex"]` plus a trust entry for R only. With cwd R/sub/deeper, Codex loads only `deepsrv` (its project root becomes the nearest directory holding `.codex`, which R's trust does not cover). The reader still finds `.git` at R, sees R trusted, reads all three layers, and returns `rootsrv`, `subsrv` and `deepsrv`. I then ran `mcp_servers={"deepsrv"={enabled=false},"rootsrv"={enabled=false},"subsrv"={enabled=false}}` from that directory and got `Error: failed to load bootstrap configuration / Caused by: invalid transport`. The lane would not start.
- Evidence: `codex-user-mcp-servers.ts:88` (`GIT_ENTRY` hard-coded) and `:152-176`. The executor report says a user with other markers "gets fewer workspace disables, which is the safe direction". The probe shows the opposite.
- Current handling: none in this batch. The Task 4.3 retry (drop the `mcp_servers={...}` entry) is the only backstop, and it costs that lane every disable.
- Recommendation: in `collectFrom`, which already holds the home text, detect a top-level `project_root_markers` key. If it is present and not exactly `[".git"]`, read no workspace layers and add a warning ("project_root_markers is customised; workspace MCP servers stay enabled"). Add a spec for it. This keeps the file header's rule "anything it cannot resolve counts as untrusted" true.

### Other round 2 notes (minor)

- R2-2: working directories reached through a symlink or junction are not canonicalised. If the trust entry names the link and Codex canonicalises, the reader over-trusts; if it names the real path, the reader under-trusts (safe). Rare; document it in the file header.
- R2-3: the worktree spec builds its `.git` fixtures by hand, but my probe with a real `git worktree add` agrees with it, so this is covered.

## Round 2 assessment

| Metric     | Value                             |
| ---------- | --------------------------------- |
| Score      | 8/10                              |
| Assessment | CHANGES REQUIRED (one small item) |
| Blocking   | 0                                 |
| Serious    | 0                                 |
| Moderate   | 1 (R2-1)                          |

Verdict: CHANGES REQUIRED. F1 to F5 are fixed and properly evidenced, the TOML checker is strict, and I confirmed an odd-name round trip against the real binary. F6's rule is right for every default-configuration case I reproduced, but it claims trust Codex does not grant when `project_root_markers` is customised, and I reproduced the resulting hard config failure. The fix is a few lines in the reader plus one spec; after it, I would approve at 8.5/10 without another probe.

---

# Round 3 (re-review after fix round 2)

Scope: R2-1 (custom `project_root_markers`) and R2-2 (symlink and junction working directories) in `codex-user-mcp-servers.ts` and its spec. The two builder files are unchanged since round 2. `npx jest ... cli-adapters/codex/`: 2 suites, 87 tests pass. I repeated the probes offline (Git Bash, bundled codex 0.155.1, scratch `CODEX_HOME` under `C:\Users\Public\rev597c` and `rev597d`, `codex mcp list --json`, no model call, junctions made with node `fs.symlinkSync(target, path, 'junction')`; scratch trees deleted afterwards; real `~/.codex` untouched).

| Item                               | Status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R2-1 custom `project_root_markers` | FIXED  | `customRootMarkersLine` (`codex-user-mcp-servers.ts`, after `entryExists`) scans only lines before the first `[`, matches `project_root_markers` (bare or quoted key), and returns the line unless the value is exactly `[".git"]` or `['.git']` (optional spacing, trailing comma, trailing comment). A multi-line array (`[`), an empty list and extra markers all fail the default regex, so they count as custom. In `readCodexUserMcpServerNames` a custom value skips the whole layer walk, adds one warning that quotes the line, and still reads home servers. A key under `[profiles.other]` is correctly ignored (it follows a header). The spec covers four custom spellings (each: no layer, home server kept, exactly one warning quoting the setting), the two default spellings, an absent key, and the in-table key. |
| R2-2 symlink and junction          | FIXED  | `trustedProjectLayers` resolves the working directory with `realpathSync.native` before `findGitRoot`, the layer walk and every `codexProjectTrusted` call, and resolves a worktree's main root the same way. An unresolvable path returns no layers and adds a warning (`Could not resolve ...`); it never throws. Spec covers a link to a trusted repo, a trust entry naming the link (nothing read), and a missing working directory (warning, home names kept).                                                                                                                                                                                                                                                                                                                                                                  |

## Probe: no path claims more trust than Codex grants

Layout: repo R (`.codex` at R and R/sub), worktree W of R (own config), junctions J to R, K to R/sub, JW to W. Codex results, and the reader's result by rule:

| Trust entry (as written) | cwd                       | Codex loaded    | Reader (realpath, then trust as written)  | Match |
| ------------------------ | ------------------------- | --------------- | ----------------------------------------- | ----- |
| real R                   | J/sub                     | rootsrv, subsrv | real R/sub, root R trusted: R, R/sub      | yes   |
| real R                   | K (junction to R/sub)     | rootsrv, subsrv | same                                      | yes   |
| real R                   | JW (junction to worktree) | wsrv            | real W, main root R trusted: W            | yes   |
| junction J               | J/sub                     | none            | real path never equals the link key: none | yes   |
| junction J               | real R/sub                | none            | none                                      | yes   |
| junction K               | K                         | none            | none                                      | yes   |
| real R/sub               | K                         | subsrv          | real R/sub exact: R/sub                   | yes   |
| real R/sub               | J/sub                     | subsrv          | same                                      | yes   |
| real W                   | JW                        | wsrv            | real W exact: W                           | yes   |
| junction JW              | JW                        | none            | none                                      | yes   |

Every row agrees, so the reader grants no trust Codex withholds on these paths. Two further probes for the markers rule: a `project_root_markers` set inside a project config (R/.codex/config.toml) changes nothing for the layer walk (Codex still loaded rootsrv and subsrv), so reading only the home file is right; and this Codex version rejects the legacy `profile = "p"` key outright ("legacy `profile = ...` config is no longer supported"), so a profile-scoped marker cannot silently apply here.

## Code review of the new paths

- Failure behaviour is fail-safe: a realpath failure, a missing `commondir`, and an unreadable `.git` pointer each give "untrusted"; nothing throws, so the "a lane must not fail to start" rule holds.
- `realpathSync.native` may return the disk's case and expand 8.3 names on Windows; `codexProjectTrusted` already folds case on win32 and darwin, so the comparison stays consistent with what the probe shows Codex does.
- The warning for an unresolvable working directory fires on every spawn of a lane whose directory has been deleted; that is correct but noisy (dedupe at the Batch 4 call site).

## Residual risks (minor, not blocking)

- R3-1: `customRootMarkersLine` ends the top level at the first line that starts with `[`. A top-level multi-line array of arrays, or a multi-line string with a line starting `[`, placed above a later top-level `project_root_markers` could end the scan early and miss the setting. Rare; the effect is the round 2 failure for that user, and the Task 4.3 retry is the backstop.
- R3-2: `project_root_markers` set through other config layers (system or managed config, `-c` overrides outside the lane config) is not seen. The reader reads the home file only.
- R3-3: a config that spells the default as a multi-line `[` / `".git"` / `]` array is treated as custom: fewer layers read, which is the safe direction.

## Round 3 assessment

| Metric     | Value                                                        |
| ---------- | ------------------------------------------------------------ |
| Score      | 8.5/10                                                       |
| Assessment | APPROVED                                                     |
| Blocking   | 0                                                            |
| Serious    | 0                                                            |
| Moderate   | 0                                                            |
| Minor      | 3 (R3-1 to R3-3, plus the earlier note on repeated warnings) |

Verdict: APPROVED. R2-1 and R2-2 are fixed in the code and pinned by specs that would fail without the fix. The ten junction and worktree cases I reproduced against the real binary agree with the reader, and every unresolvable or unreadable case fails toward "untrusted" with a warning. Batch 1 as a whole (builder, reader, F1 to F6, R2-1, R2-2) has no open blocking, serious or moderate item. The remaining safety net for any case the reader cannot see is the Task 4.3 retry, which drops the `mcp_servers={...}` entry (AS16).
