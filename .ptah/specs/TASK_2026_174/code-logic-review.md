# Code Logic Review — TASK_2026_174 (Adversarial Security Mode)

**VERDICT: SHIP-WITH-NITS.** The shell allowlist is sound — I threw whitespace,
trailing dots, null bytes, homoglyphs, ADS, drive-relative, UNC, 8.3 short
names, and shell metacharacters at `isAllowedShell` and every one fails closed,
because the guard is an _exact-string allowlist_, not a denylist. The `cwd`
containment and the two-sided (boundary + sink) shell check are correctly wired
and the tests genuinely assert at `pty.spawn`, satisfying AC2. No blocking
issue. The nits below are bounded, mostly **INHERITED** from
`isAuthorizedWorkspace`'s pre-existing normalization, and none of them expands
the primitive beyond the `args=[]` / cwd-only bound the research report pins.

| Metric                         | Value                                   |
| ------------------------------ | --------------------------------------- |
| Overall Score                  | 8.5/10                                  |
| Assessment                     | APPROVED (ship with the 4 nits tracked) |
| Critical Issues                | 0                                       |
| Serious Issues                 | 0                                       |
| Moderate Issues                | 1 (INHERITED, newly relied upon)        |
| Minor Issues                   | 3                                       |
| Attacks attempted and DEFEATED | 18                                      |

---

## Attacks attempted against the guard — all DEFEATED

### Shell allowlist (`shell-allowlist.ts`)

The design decision that kills almost every attack: `WIN_SHELLS`/`POSIX_SHELLS`
are **exact-string sets**. A value passes only if it is byte-identical (modulo
win32 `.toLowerCase()`) to a listed bare name. Any decoration — a separator, a
suffix, a prefix, a stray byte — makes it a different string, and a different
string is not in the set. That is fail-closed by construction.

| #   | Attack input                                                     | Platform   | Result                                                              | Why it fails                                                                                                                                           |
| --- | ---------------------------------------------------------------- | ---------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `'cmd.exe '` (trailing space)                                    | win32      | REJECTED                                                            | `'cmd.exe '` ∉ set (exact match)                                                                                                                       |
| 2   | `' cmd.exe'` (leading space)                                     | win32      | REJECTED                                                            | not in set                                                                                                                                             |
| 3   | `'cmd.exe.'` (trailing dot)                                      | win32      | REJECTED                                                            | not in set (Win32 would strip the dot, but the allowlist never sees a match to strip)                                                                  |
| 4   | `'cmd.exe\0'` (null byte)                                        | win32      | REJECTED                                                            | not in set                                                                                                                                             |
| 5   | `'BASH'`, `'Zsh'`                                                | posix      | REJECTED                                                            | posix is case-sensitive; and case-sensitive FS wouldn't resolve them anyway — fail-closed                                                              |
| 6   | `'сmd.exe'` (Cyrillic `с`)                                       | win32      | REJECTED                                                            | `toLowerCase()` keeps it Cyrillic; ≠ ASCII `cmd.exe`. No shell name contains a Turkish-İ-sensitive char, so `toLowerCase()` has no homoglyph collision |
| 7   | `'C:cmd.exe'` (drive-relative, no separator)                     | win32      | REJECTED                                                            | `'c:cmd.exe'` ∉ set                                                                                                                                    |
| 8   | `'cmd.exe:evil'` (ADS, no separator)                             | win32      | REJECTED                                                            | not in set                                                                                                                                             |
| 9   | `'CMD~1.EXE'` (8.3 short name)                                   | win32      | REJECTED                                                            | not in set                                                                                                                                             |
| 10  | `'\\\\?\\C:\\...\\cmd.exe'`, `'\\\\host\\share\\bash.exe'` (UNC) | win32      | REJECTED                                                            | contains `\` → early false                                                                                                                             |
| 11  | `'/bin/bash'`, `'./bash'`, `'/tmp/evil/bash'`                    | posix      | REJECTED                                                            | contains `/` → early false (basename would be `bash`, but the separator check runs first)                                                              |
| 12  | `'bash; rm -rf ~'`, `'bash&calc'`, `'$(x)'`                      | any        | REJECTED                                                            | not in set — and moot anyway: `pty.spawn(name, [], …)` is `posix_spawn`/`CreateProcess`, no shell interpolation of the program name                    |
| 13  | `'bash'` on win32 / `'cmd.exe'` on posix                         | cross      | REJECTED                                                            | correct per-platform split                                                                                                                             |
| 14  | `''` (empty string)                                              | any        | REJECTED by allowlist; also `'' \|\| default` → default at the sink | double safe                                                                                                                                            |
| 15  | `null`, `42`, `['bash']`, `{}` for `shell`                       | via schema | REJECTED                                                            | `z.string().optional()` rejects non-string/non-undefined → `parse` returns `null`                                                                      |
| 16  | unexpected `process.platform` (`freebsd`, `aix`, `android`)      | —          | Falls to POSIX branch — CORRECT (those use posix shell names)       | no unhandled-platform hole                                                                                                                             |

**Platform default arg timing (Q2):** `platform: NodeJS.Platform =
process.platform` is a _default parameter_, evaluated at each call, not frozen at
module load. Both production call sites (`terminal-rpc.schema.ts:31`,
`pty-manager.service.ts:75`) call `isAllowedShell(s)` with one arg, so the live
`process.platform` is used every time. Correct.

**Separator check vs exact-match (Q3):** on both platforms the exact-string set
is the real gate; the `/`,`\` early-reject is belt-and-suspenders. There is no
Windows path form (`C:cmd`, `\\?\`, ADS, short name) that passes, because none of
those strings is _itself_ a member of `WIN_SHELLS`. Confirmed sound on both OSes.

### cwd containment (`workspace-authorization.ts`)

| #   | Attack input                                                  | Result                                                                                       | Why it fails                                                                                                                      |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 17  | `'/ws/root/../../../etc'`                                     | REJECTED                                                                                     | `normalize` calls `path.resolve` first, collapsing `..` to `/etc` _before_ the contains check                                     |
| 18  | `'/ws/root'` sibling `'/ws/root-evil'` vs folder `'/ws/root'` | REJECTED                                                                                     | the `root + '/'` boundary in `isContainedIn` stops the prefix-sibling match (`'/ws/root-evil'.startsWith('/ws/root/')` === false) |
| —   | trailing-separator `'/ws/root/'`                              | handled                                                                                      | `normalize` strips `/+$`                                                                                                          |
| —   | empty-string `cwd:''`                                         | check skipped, but `'' \|\| wsRoot \|\| homedir()` → safe default, never the attacker string | safe                                                                                                                              |

**Boundary integrity (Q6):** both the schema refine and the sink import the
**same** `isAllowedShell` from `@ptah-extension/platform-core` — no duplicated
literal, cannot drift. I grepped every caller of `IPtyHost.create` /
`ptyManager.create`: the only production caller is the RPC handler (wired through
`PLATFORM_TOKENS.PTY_HOST` at `phase-4-handlers.ts:182`). The binary IPC bridge
(`ipc-bridge.ts:437-458`) calls only `write`/`resize`/`onData`/`onExit`/
`disposeAll`, never `create`. So there is no path to the sink that skips the
schema today. Confirmed.

**Error hygiene (Q7):** the two handler rejects and the sink reject are all
fixed strings that do not echo the rejected `shell`/`cwd` — see the one leak nit
(N3) for the _re-throw_ path.

**Test integrity (Q8):** `pty-manager.service.spec.ts` mocks `node-pty` and
asserts `mockSpawn` (`pty.spawn`, the real sink) is **not** called for `'rm'`
and `'/tmp/evil/bash'`, and called exactly once for an allowlisted shell. That
is a genuine spawn-site assertion, not an RPC-return check — AC2 is satisfied for
real, not nominally. The handler spec independently asserts `ptyManager.create`
is not called at the boundary. Both layers are covered.

---

## Findings

### F1 — MODERATE, INHERITED (newly load-bearing): `cwd` containment is lexical, not real-path — symlink/junction inside the workspace escapes the check

- **File**: `libs/backend/rpc-handlers/src/lib/utils/workspace-authorization.ts:11-17` (`normalize`)
- **Provenance**: The `resolve → forward-slash → lowercase → strip-trailing`
  normalization and the `isContainedIn` boundary predate this task; they are
  `isAuthorizedWorkspace`'s existing behaviour, extracted verbatim into the
  shared `normalize` helper. **INHERITED.** What is _new_ is that TASK_2026_174
  makes this normalization a **security containment boundary for a process
  spawn** (`isAuthorizedTerminalCwd`), a load it did not carry when it only
  gated session-workspace authorization.
- **Concrete input**: workspace folder `/ws/root`; an attacker (with workspace
  write, e.g. via a separate `fs:*` RPC) creates a junction/symlink
  `/ws/root/out` → `/some/other/dir`, then calls
  `terminal:create { cwd: '/ws/root/out' }`. `normalize` uses `path.resolve`,
  **not** `fs.realpath`, so `/ws/root/out` is lexically inside `/ws/root` and
  the check PASSES; `pty.spawn` then runs with the OS-resolved cwd outside the
  workspace.
- **Impact (bounded honestly)**: cwd-only. Args are still `[]`; `shell` is still
  allowlisted. The escalation is "shell starts in a directory outside the
  workspace" — the Windows DLL-sideload setup the research report names. But note
  the impact is **already largely available without the symlink**: the AC-chosen
  policy allows the workspace root _and the entire home directory_ as cwd, so an
  attacker who can drop a malicious DLL into the workspace or home already has the
  sideload cwd without any symlink. The symlink escape is therefore _strictly
  weaker than the primitive the policy already permits_ — which is why this is
  MODERATE, not SERIOUS.
- **Fix**: if real containment is wanted, resolve the candidate with
  `fs.realpath`/`fs.realpathSync.native` before comparison — but that adds a
  filesystem dependency `rpc-handlers` deliberately avoids (plan §2, Decision 1
  "Resolve-and-verify … rejected for P2"). Given the impact is dominated by the
  already-permitted home/workspace-root cwd, the honest recommendation is to
  **document** in the PR that cwd containment is lexical and does not defeat
  symlinks, and leave real-path hardening as a follow-up. Do not block on it.

### F2 — MINOR, INHERITED: `.toLowerCase()` normalization over-accepts on a case-sensitive filesystem

- **File**: `libs/backend/rpc-handlers/src/lib/utils/workspace-authorization.ts:15`
- **Input**: workspace folder `/workspace`; attacker passes `cwd: '/WORKSPACE/x'`
  on Linux. Both fold to `/workspace/x` / `/workspace`, so the check PASSES even
  though `/WORKSPACE/x` may be a _different real directory_ than `/workspace/x`.
- **Impact**: negligible. Case-folding cannot reach an _arbitrary_ path — `..` is
  collapsed by `path.resolve` before the lowercase, so the candidate must still
  be a case-variant of something genuinely under the workspace root. To exploit,
  `/WORKSPACE` must exist as a distinct dir (needs write to `/`), and impact is
  still cwd-only. INHERITED from `isAuthorizedWorkspace`. Flag only.
- **Fix**: drop `.toLowerCase()` on posix (case-fold only on win32). Out of scope
  here — changing shared normalization risks the session-handler callers.

### F3 — MINOR: re-thrown `node-pty` spawn error crosses the RPC boundary and can reveal filesystem state

- **File**: `libs/backend/rpc-handlers/src/lib/handlers/terminal-rpc.handlers.ts:106-113`
- **Input**: an allowlisted request whose `cwd` passes containment but does not
  exist on disk (e.g. a home-relative dir that was deleted). `pty.spawn` throws;
  the `catch` re-throws `error.message` verbatim, which node-pty populates with
  the offending path/errno. That string returns to the renderer as `raw.error`.
- **Impact**: minor info-leak — lets the caller probe existence of paths via
  spawn-error deltas. The renderer already knows what it sent, so the delta is
  small, but errno/path text is more than the fixed-message rejects elsewhere
  leak. Consistent with the CLAUDE.md "never expose raw error.message to clients"
  intent (stated for NestJS, same principle here).
- **Fix**: log the raw message host-side (already done at `:109`) and re-throw a
  fixed `'terminal:create: failed to spawn'`. Note this changes the two
  CHARACTERIZATION tests at `:210-247` that assert `raw.error === 'spawn failed'`
  / `'boom'` — those pin the _old_ pass-through behaviour, so they would need
  updating, which is why this is a nit to weigh, not a mandate.

### F4 — MINOR (defence-in-depth asymmetry): the sink guards `shell` but not `cwd`

- **File**: `apps/ptah-electron/src/services/pty-manager.service.ts:75` (guards
  `shell`), vs the absence of any cwd check in `create()`.
- **Observation**: `shell` is validated in two places (handler + sink), so a
  future second caller of `create` still cannot pick an arbitrary executable.
  But `cwd` containment lives **only** in the handler
  (`terminal-rpc.handlers.ts:81-88`). If a second caller of `IPtyHost.create` is
  ever added (the research report's "containment is one flag deep" concern, §8),
  it would inherit the `shell` guard but **silently** get unbounded `cwd`. Today
  there is exactly one caller, so this is not exploitable — it is a latent
  asymmetry, not a live bug.
- **Fix**: none required now. If future-proofing is wanted, the sink could reject
  a `cwd` that is neither absolute nor existing, or the containment predicate
  could be pushed toward the sink. Track, don't block.

---

## Constraint compliance (carrier rules)

| Rule                                                    | Status                                                                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catch (error: unknown)` + `instanceof Error` narrowing | PASS — handler `:106-108`, sink `kill`/`disposeAll` narrow correctly                                                                              |
| Zod at the boundary                                     | PASS — `terminal-rpc.schema.ts`; both `create` and `kill` route through it (AC4)                                                                  |
| No `@ts-ignore`                                         | PASS — the `as unknown as Error` logger casts are the lib's pre-existing logging idiom (a separate TASK_2026_171 follow-up), not new suppressions |
| Reject, never silently substitute a bad `shell`         | PASS — schema returns `null` → structured throw; sink throws                                                                                      |
| Spawn-site assertion (AC2)                              | PASS — `pty-manager.service.spec.ts` asserts on mocked `pty.spawn`                                                                                |
| `cwd` outside workspace+home rejected (AC3)             | PASS — `isAuthorizedTerminalCwd`, with the F1/F2 lexical caveats                                                                                  |
| No `pty` capability added elsewhere                     | PASS — no host-profile change in the diff                                                                                                         |

## What a maximally-hardened version would add (none blocking)

- `fs.realpath` on `cwd` before containment (closes F1).
- Fixed-message spawn-error reject (closes F3).
- A sink-side `cwd` sanity check mirroring the `shell` one (closes F4).
- Case-fold `cwd` only on win32 (closes F2).

All four are defence-in-depth refinements on an already-sound guard whose live
attack surface is a single already-privileged renderer-JS caller with an
`args=[]`, cwd-restricted, allowlisted-executable primitive. Ship it, track the
nits.
