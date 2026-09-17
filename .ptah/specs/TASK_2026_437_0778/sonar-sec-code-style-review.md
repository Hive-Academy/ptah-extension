# Code Style Review — `TASK_2026_437_0778` (SonarCloud security fix, PR #510)

## Summary

| Metric          | Value    |
| --------------- | -------- |
| Overall score   | 8/10     |
| Assessment      | APPROVED |
| Blocking issues | 0        |
| Serious issues  | 0        |
| Minor issues    | 2        |
| Files reviewed  | 2        |

## Scope

Read-only review of the two uncommitted files named in the brief, diffed against
`HEAD` in `D:\projects\ptah-437`:

1. `libs/backend/platform-electron/src/workspace-watch/workspace-watch-host-rss-sampler.js`
2. `libs/backend/agent-sdk/src/lib/internal-query/network-backoff.ts`

Compared against the precedent commit `7fc258681` (`resolveGitExecutable()` in
`apps/ptah-electron/src/services/git-watcher.stress.harness.ts`). `eslint` and
`prettier --check` ran clean on both files (no output / "All matched files use
Prettier code style!"). No tests were run, per instructions.

## Five style questions

### 1. What breaks when requirements change in six months?

If Windows ever ships PowerShell 7 (`pwsh.exe`) only, or a future Windows image
relocates `WindowsPowerShell\v1.0`, `WINDOWS_POWERSHELL_PATH` in
`workspace-watch-host-rss-sampler.js:34-40` stops resolving and the sampler fails
loudly at `execFileSync` (`workspace-watch-host-rss-sampler.js:78-82`) — an
acceptable, visible failure, not silent drift. The `SystemRoot` fallback
(`'C:\\Windows'`) covers the one case where the env var is absent. On POSIX,
`POSIX_PS_CANDIDATES` (`:41`) is a fixed two-item list; a hypothetical distro
that ships `ps` only via `busybox` or a non-listed path throws the same loud
error via `resolvePsExecutable()` (`:52-64`). This mirrors the precedent's own
tradeoff (fixed location vs. PATH walk) and is called out explicitly in the new
comment block (`:29-32`), so the six-month reader is warned rather than
surprised.

### 2. What would a new team member misread here?

Nothing forces a misread. The comment block at `workspace-watch-host-rss-sampler.js:25-33`
explicitly answers the question a reader would otherwise ask — "why does this
file not walk PATH like the git harness does" — before it is asked. In
`network-backoff.ts:99-103`, a reader might initially wonder why a jitter
source needs four lines of justification; the answer is in the comment itself
(it forecloses the Sonar false positive), so the apparent overkill is
self-documenting.

### 3. What does this cost to maintain that a simpler shape would not?

`workspace-watch-host-rss-sampler.js` now carries two resolution strategies
(eager constant for Windows, lazy-and-cached function for POSIX) for what is
conceptually one problem — "find the absolute path of the OS tool for this
platform." The asymmetry is justified (Windows path is a compile-time-known
constant; POSIX needs a real existence check across two candidates) but it is
a second shape a maintainer must hold in their head, on top of the precedent's
third shape (`resolveGitExecutable()`'s PATH walk). Three different resolution
strategies across two files for the same Sonar rule is a mild but real
maintenance tax; each is locally justified, none is unified.

### 4. Where is this inconsistent with the rest of the repository?

- `network-backoff.ts:103` introduces the repository's first `NOSONAR`
  comment (verified via repo-wide grep — no other match in `libs/` or `apps/`).
  There is no documented convention for when `NOSONAR` is the right tool vs. a
  SonarCloud-side "won't fix"/"false positive" resolution on the issue itself,
  so this line sets precedent by itself rather than following one.
- The two files solve the same Sonar rule family (S4036 spawn-with-PATH,
  S2245 weak-PRNG) with different suppression mechanisms: the `.js` file
  redesigns the code so the finding no longer applies (absolute path, no
  suppression comment needed); the `.ts` file keeps the flagged call and
  suppresses the finding inline. Both are legitimate responses to their
  respective rules (S4036 has a real fix — resolve the absolute path; S2245 on
  `Math.random()` for non-cryptographic jitter is normally a justified
  suppress-in-place, not a redesign), so the divergence tracks the rule, not
  inconsistent judgment. Still, a reader skimming only the diff stat could
  wonder why one file "fixed" the issue and the other "suppressed" it; the
  network-backoff.ts comment (`:99-102`) makes the reasoning explicit, which
  compensates for the lack of a stated project-wide policy.
- The `.js` sampler comment names its precedent file by path (`:30-31`),
  matching the pattern the precedent commit itself used when it named
  `libs/backend/vscode-core/src/utils/exec-git.ts` as prior art. Good, and
  consistent with how this repo threads cross-references through comments
  rather than a wiki.

### 5. What would you have done differently, and why is that better rather than merely other?

I would have added one sentence to the `network-backoff.ts` comment (or a
short note in the task folder) recording that this is the repository's first
`NOSONAR` and pointing at where the convention should live if a second one
ever appears — e.g. "first use of NOSONAR in this repo; if this pattern
repeats, promote the justification format here into a shared note." That is
better than leaving future authors to discover the precedent by grepping, the
same gap this review had to close by hand. This is a suggestion, not a
blocker — the comment as written is fully sufficient to justify the specific
line, which is the bar that matters for the PR to merge.

## Blocking issues

None.

## Serious issues

None.

## Minor issues

- `libs/backend/platform-electron/src/workspace-watch/workspace-watch-host-rss-sampler.js:34-40` —
  `WINDOWS_POWERSHELL_PATH` is computed unconditionally at module load on every
  platform (Linux/macOS included), even though it is only read inside the
  `win32` branch (`:77-84`). Cheap (`path.win32.join` + one env read, no I/O),
  so no runtime cost worth gating, but a reader on Linux sees a Windows-only
  constant built eagerly with no platform guard next to it, which reads as an
  oversight until they trace usage. Consider lazily deriving it inside the
  `win32` branch, mirroring the lazy-and-cached POSIX path, for shape
  symmetry.
- `libs/backend/agent-sdk/src/lib/internal-query/network-backoff.ts:103` — the
  `NOSONAR` directive is appended to the same line as the assignment it
  already explains three lines above (`:99-102`). SonarCloud's own convention
  places `NOSONAR` on the flagged line, which this satisfies, but stacking a
  4-line prose comment directly above a line that then repeats a condensed
  version of the same justification after `NOSONAR` is mild duplication.
  Folding the rule id into the block comment (e.g. "Sonar typescript:S2245 —
  see justification above") without repeating "non-security jitter" a second
  time would read cleaner. Not worth blocking on; the redundancy costs a
  reader two seconds, not correctness.

## File-by-file

### workspace-watch-host-rss-sampler.js

Score 8/10 — 0 blocking, 0 serious, 1 minor. The S4036 fix is sound: both
platforms now spawn an absolute, OS-owned path rather than a bare command name
resolved via PATH search. It correctly diverges from the git-watcher
precedent's PATH-walk shape (`git-watcher.stress.harness.ts:35-60`, commit
`7fc258681`) because PowerShell and `ps` have fixed install locations while
`git` does not — the comment at `:29-32` states this reasoning rather than
leaving it implicit, which is the right amount of justification for a
deliberate divergence from prior art. `resolvePsExecutable()` (`:52-64`)
correctly caches, correctly narrows with `stat.isFile()` (not just existence),
and fails loudly with a message naming both candidates, matching the
precedent's "fail loudly, name what was searched" contract. The one nit is the
eager, unguarded `WINDOWS_POWERSHELL_PATH` computation on non-Windows
platforms (see Minor issues) — cosmetic, not a correctness or security gap.

### network-backoff.ts

Score 8/10 — 0 blocking, 0 serious, 1 minor. The S2245 suppression is
technically correct (`Math.random()` here is jitter on a wait-window bound by
`NETWORK_BACKOFF_MAX_MS`, never a credential, token, id, or anything an
attacker gains from predicting — `:99-102` states exactly this, which is the
substance a NOSONAR justification needs) and proportionate to the file's own
comment density — the file already carries an unusually thorough module-level
doc comment (`:1-60`) with a dedicated "## Jitter" section (`:34-39`), so a
4-line inline justification is consistent with, not disproportionate to, the
surrounding prose. It is the first `NOSONAR` in the repository (confirmed by
grep), which is a reasonable place for a first precedent to land: single
occurrence, fully self-contained justification, doesn't leak into a shared
convention file that would need separate governance. The only friction is
mild duplication between the block comment and the condensed end-of-line
justification (see Minor issues).

## Pattern compliance

| Repository rule or nearby convention                                            | Status               | Evidence                                                                                                           |
| ------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `catch (error: unknown)`, narrow before `.message`                              | PASS                 | `workspace-watch-host-rss-sampler.js:116-123` already narrows via `error && error.message`; unchanged by this diff |
| Absolute-path resolution for spawned OS binaries (established by `7fc258681`)   | PASS                 | `workspace-watch-host-rss-sampler.js:34-40, 52-64`                                                                 |
| Fail loudly on missing binary, matching existing caller contract                | PASS                 | `workspace-watch-host-rss-sampler.js:61-63`, matches doc comment `:47-50`                                          |
| Cross-reference prior art by file path in comments (established by `7fc258681`) | PASS                 | `workspace-watch-host-rss-sampler.js:30-31`                                                                        |
| No undocumented suppression comments                                            | PASS (new precedent) | `network-backoff.ts:99-103` — justified inline, no separate policy doc exists yet                                  |
| Prettier / ESLint clean                                                         | PASS                 | `npx eslint` clean, `npx prettier --check` clean on both files                                                     |
| File size ceiling (~700 soft, ~1000 hard look)                                  | PASS                 | Both files well under threshold                                                                                    |

## Maintenance debt

- Introduced: two more OS-binary-resolution shapes (eager Windows constant,
  lazy-cached POSIX lookup) alongside the existing `resolveGitExecutable()`
  PATH-walk shape; the repository's first `NOSONAR` comment with no written
  policy for when to reach for it again.
- Retired: two bare, PATH-searched `execFileSync` calls (`powershell`, `ps`)
  that were the actual S4036 finding.
- Net: security posture improves (the injection surface these calls exposed
  is closed); a small amount of pattern proliferation is added in exchange,
  each instance individually justified in its own comment.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: none blocking — the only material future-facing gap is that
  `network-backoff.ts:103` sets a repo-wide `NOSONAR` precedent with no
  written policy for reuse; worth a one-line note somewhere if it recurs, not
  worth reopening this PR for.
- What a 10/10 version would do differently: guard `WINDOWS_POWERSHELL_PATH`
  construction behind the `win32` check for shape symmetry with the POSIX
  branch; de-duplicate the `NOSONAR` line's condensed justification against
  the block comment immediately above it; add a one-line pointer (in the
  comment or the task folder) marking this as the repo's first `NOSONAR` so a
  second occurrence has somewhere to check for the expected format.
