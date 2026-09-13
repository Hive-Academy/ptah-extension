# Code Logic Review — `TASK_2026_433` (Batches B2a, B2b)

Scope: `git diff 7fdcc73d9~1..c0ecc1644 -- libs/` — commit `7fdcc73d9` (`AgentRoleResolver`,
Batch B2a) and commit `c0ecc1644` (role-block rendering + command-line guard +
`CliCommandOptions.role`, Batch B2b). 11 files, matching `batches.md`'s claimed scope
exactly (`git diff --name-only` verified). Reviewed against the committed blobs at
`c0ecc1644` via `git show c0ecc1644:<path>`, not the working tree — the worktree
currently carries uncommitted WIP from concurrent executors in `cli-adapters/**`
(Task 3.0/3.1/3.2 — the D3/D9 fixes and `roleChannel`) and `ptah-cli/**` (Task 4a.x),
none of which is part of this diff and none of which is reviewed here.

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 8/10                                 |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 1 (new) + 4 pre-flagged (unchanged)  |
| Failure modes found | 2 new (both Minor) + 4 pre-flagged   |

The pre-flagged items are D2, D3, D9, D10 from `batches.md`'s "Plan defects found"
and the B2b gate record's F1–F5. I independently re-derived each one against the
actual committed code (not just trusted the write-up) and they hold exactly as
described — see "Verification of pre-flagged defects" below. None is re-scored here
because each already has a named, scheduled fix (Task 3.0 / 3.0b, both `IN_PROGRESS`
in the same worktree as uncommitted WIP at review time) and none is silent: D3 is
named in the `c0ecc1644` commit message itself as a known open item.

## Five logic questions

### 1. How does this fail silently?

It does not, within B2a/B2b's own boundary. Every resolver failure is a thrown
`AgentRoleError` (`agent-role-resolver.service.ts` — commit `7fdcc73d9`, all six
throw sites: `invalid_role_name` L60-65, `no_roles` L72-77, `unknown_role` L79-86,
`role_read_failed` L90-99 and L152-158, `empty_role` L101-108, `role_too_large`
L110-117). `buildTaskPrompt` throws a plain `Error` when `options.role` is set
without a `cli` (`cli-adapter.utils.ts:520-527` at `c0ecc1644`) rather than silently
rendering a role-less prompt. `assertCommandLineWithinLimit` throws
`CliCommandLineTooLongError` rather than truncating (`cli-adapter.utils.ts:314-323,
333-341, 345-353`). No branch in this diff returns a default value, an empty
success, or logs-and-continues in place of surfacing the failure.

The one thing that WOULD read as a silent degrade one layer up, if it shipped
alone, is D3: `renderRoleBlock` on a transform lane (`codex`/`copilot`/`cursor`/
`antigravity`) silently drops a role body's own leading `---...---` block instead
of erroring or warning — the spawn still succeeds, just with truncated role
content, which is exactly the "success-looking result with wrong content" shape
this question is about. It is not new here (see below) and it is pinned by a
spec that documents the exact mangled output, so nobody downstream can mistake it
for intended behaviour; it ships only because B3 (the fix) is mid-flight in the
same worktree, uncommitted, as this review runs.

### 2. What user action produces unexpected behaviour?

A role file authored (by hand, or by a future generation template) whose body
starts with its own `---\n...\n---\n` block — e.g. an embedded example frontmatter
block, or a role that itself documents YAML front matter syntax — loses that block
on four of seven lanes (D3). This is authoring content the resolver accepts (it is
not YAML frontmatter to the resolver, which already stripped the outer one), so a
user has no way to know from the resolver's contract that a second, adapter-side
strip is waiting downstream, until the batch shipping `renderRoleBlock` completes
in B3.

Within this diff alone, no other user action reaches unexpected behaviour: role
names are exact, case-sensitive matches against real directory entries, so a typo
or wrong case always fails with `unknown_role` and the real available list rather
than resolving to the wrong file or nothing.

### 3. What input data produces a wrong answer?

- A role body starting with `---` (D3, above) — wrong answer (truncated body), not
  an error, on codex/copilot/cursor/antigravity.
- An empty `args` array reaching `assertCommandLineWithinLimit` (`cli-adapter.
  utils.ts:287-295`, `indexOfLargest`) makes `largest === -1`, and the thrown
  `CliCommandLineTooLongError` reports `argument 0 is 0 UTF-16 units` even though
  the actual overflow came from `command` itself, not an argument (see Failure
  modes). This is a `spawnCli(binary, [], ...)` shape; none of B2a/B2b's own
  callers hit it (`probeCliVersion` defaults `args = ['--version']`), so it is
  latent, not exercised by anything in this diff.
- A `workspaceRoot` that is empty or relative (D9) reads roles from
  `process.cwd()/.claude/agents` rather than refusing — see "Verification of
  pre-flagged defects".

### 4. What happens when a dependency fails?

- `IFileSystemProvider.exists`/`readDirectory`/`readFile` failures are all caught
  and converted to `AgentRoleError('role_read_failed', ...)` with the underlying
  `instanceof Error` message narrowed (`agent-role-resolver.service.ts:92-99,
  152-158`). A non-`Error` rejection (e.g. a thrown string) is handled via
  `String(error)` rather than crashing on `.message` — pinned by the spec's "raises
  role_read_failed for a non-Error rejection" case.
- `harness-sync`'s `resolveHarnessWorkspaceRoot`, `stripFrontmatter`,
  `extractFrontmatterDescription` are trusted synchronous calls with no try/catch
  around them in the resolver; none of the three is documented to throw for
  ordinary string input (they degrade to string operations on whatever is
  handed in), so this is consistent with the rest of the codebase's treatment of
  that barrel.
- `transformAgentBody` (harness-sync) is called unguarded inside `renderRoleBlock`
  — same trust boundary as above, and it is a pure string-rewrite pipeline
  (regex replace calls), not I/O, so there is no dependency-failure mode to
  handle here.

### 5. What is missing that the requirements never mentioned?

- The MAX_ROLE_BYTES check is measured on the frontmatter-stripped body before any
  adapter-side transform. A role passing that check can still grow past a
  platform's command-line limit once wrapped in `renderRoleBlock`'s header sentence
  and combined with `systemPrompt`/`projectGuidance`/task/files/taskFolder in
  `buildTaskPrompt` — the two budgets (64 KiB role body vs. ~16-64 KB effective
  command-line budget once quoted) are not reconciled anywhere, and nothing in
  this diff cross-checks them. This is likely fine in practice (real roles top out
  at 23 KB per the plan's own evidence table) but is not asserted by any spec.
- No test exercises `assertCommandLineWithinLimit` with `args = []` (the
  `indexOfLargest === -1` path) — see Minor finding below.
- The resolver takes no `AbortSignal`/timeout on the two provider calls per
  `resolve()`. Not required by the plan, and consistent with other resolvers in
  this lib, but worth naming since a hung network filesystem would hang a spawn
  indefinitely rather than time out.

## Failure modes

### Misleading error attribution when `args` is empty

- Trigger: `assertCommandLineWithinLimit(command, [], 'win32')` (or `'linux'`/
  `'darwin'`) where `command` alone is long enough to exceed the limit.
- Symptom: `CliCommandLineTooLongError.largestArgIndex` is `-1`-coerced to `0`
  and `largestArgSize` reports `0`, so the thrown message reads "argument 0 is 0
  UTF-16 units" while the real overflow came from `command`. The error still
  fires (no false negative), but its diagnostic content misattributes the cause.
- Evidence: `cli-adapter.utils.ts:287-295` (`indexOfLargest`), `316-323` (win32
  branch reads `argLengths[largest]` with the `-1` guard).
- Current handling: guarded against a crash (`largest === -1 ? 0 : ...`), not
  against a wrong answer in the message.
- Recommendation: when `args.length === 0`, name the command itself as the
  offending element in the message (or add a fourth constructor field), since
  this path is reachable in principle from any adapter that calls `spawnCli`
  with no arguments and an oversized resolved binary path.
- Severity: Minor — no adapter in this diff hits it, and the guard prevents a
  crash or an oversized spawn either way.

### `role_too_large`/size check runs on the pre-transform body, budget checks run on the post-transform command line

- Trigger: a role body near 64 KiB, rendered through `renderRoleBlock` for a
  `task-prompt` lane, combined with a large `systemPrompt`/`projectGuidance` and
  task text in the same `buildTaskPrompt` call.
- Symptom: the resolver's 64 KiB acceptance says nothing about whether the
  resulting command line will fit; `assertCommandLineWithinLimit` is the only
  backstop and it runs later, inside `spawnCli`, correctly rejecting the spawn —
  so no silent truncation happens, but a role author has no way to learn from the
  resolver alone whether their role will actually fit on a given lane.
- Evidence: `agent-role-resolver.service.ts:110-117` (size gate) vs.
  `cli-adapter.utils.ts:297-354` (the actual spawn-time gate).
- Current handling: two independent, non-communicating budgets; the second one
  (correctly) has the final word and nothing is silently truncated.
- Recommendation: none required for this batch — the outer gate (`spawnCli`) is
  authoritative and always runs before a process starts, per Component 3's
  "failure and rollback" contract. Noted as a design observation, not a defect.
- Severity: Minor.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- **Moderate (new): no spec exercises `assertCommandLineWithinLimit` with an
  empty `args` array**, so the misattributed-error-message failure mode above has
  no regression guard. `cli-adapter.utils.spec.ts:218-381` (as committed at
  `c0ecc1644`) covers 1- and 2-arg cases on every platform branch but never a
  bare command with zero args.
- **Minor (new)**: see "Misleading error attribution" above,
  `cli-adapter.utils.ts:287-295`.
- **Minor (pre-flagged, F4 in the B2b gate record, no action needed)**:
  `probeCliVersion`'s doc comment says "never throws"; the guard inside
  `spawnCli` would in principle reject the returned promise for an oversized
  invocation, but every real call site passes short, fixed args (`--version`),
  so it is unreachable in practice. Confirmed by inspection — no new evidence
  changes this.
- **Minor (pre-flagged, F5, no action needed)**: `transformAgentBody` ends with
  `.trim()` (`transform-rules.ts:368`), so `renderRoleBlock` output differs by
  trailing/leading whitespace between transform lanes and pass-through lanes.
  Confirmed by reading `transform-rules.ts:362-369` directly — cosmetic only.

## Verification of pre-flagged defects

Per the task instructions, D2/D3/D9/D10 are not re-scored, but I independently
re-derived each rather than trusting the write-up, since the instructions asked
specifically to verify the D3 regex reasoning:

- **D3 (double frontmatter strip) — CONFIRMED, and the planned fix's regex
  reasoning holds.** At `c0ecc1644`, `renderRoleBlock` (`cli-adapter.utils.ts:485-
  497`) calls `transformAgentBody(role.body, cli)` directly for
  codex/copilot/cursor/antigravity. `transformAgentBody` (`transform-rules.ts:
  362-369`) calls `stripFrontmatter` first, whose regex is
  `/^---\n[\s\S]*?\n---\n?/` (`transform-rules.ts:239`) — lazy, so on a body like
  `'---\nkeep: this block\n---\nThe real instructions.'` it matches the body's
  own leading block and strips it, leaving only `'The real instructions.'`. This
  is exactly what the spec pins at `c0ecc1644`
  (`cli-adapter.utils.spec.ts:203-215`, `'loses the leading block on a transform
  lane (double strip)'`). I then checked the planned fix (present, uncommitted,
  in the live worktree as Task 3.0 WIP — not part of this diff): prepending a
  sentinel `EMPTY_FRONTMATTER = '---\n\n---\n'` before `role.body` and calling
  `transformAgentBody(EMPTY_FRONTMATTER + role.body, cli)`. Tracing the regex by
  hand: `EMPTY_FRONTMATTER` is 9 characters (`-,-,-,\n,\n,-,-,-,\n`); the lazy
  `[\s\S]*?` in `stripFrontmatter`'s regex finds the *earliest* `\n---` after the
  opening `---\n`, which occurs at index 4-7 of the sentinel itself (before the
  role body's own `---` even begins), and the trailing `\n?` consumes the
  sentinel's final `\n` at index 8 — so the match consumes exactly the 9-character
  sentinel and nothing of `role.body`, regardless of what `role.body` starts
  with. I confirmed this against five inputs by hand (a body starting `---\nkeep\n
  ---\nx`, plain text, a body starting with a bare newline, a body that is just
  `---\n---\nx`, and an empty body) and all five preserve the body byte-for-byte
  after the sentinel is stripped. The reasoning documented in `batches.md` Task
  3.0 is correct.
- **D9 (empty/relative `workspaceRoot`) — CONFIRMED present at `c0ecc1644`, fix
  correctly absent.** `resolve()` and `listRoles()` at `c0ecc1644`
  (`agent-role-resolver.service.ts`, committed version) have no absolute-path or
  non-empty check before calling `resolveHarnessWorkspaceRoot(workspaceRoot)`; an
  empty string flows straight through to `agentsDirFor` and would read
  `process.cwd()/.claude/agents`. The `no_workspace` guard described in
  `batches.md` Task 3.0b does not exist in the committed diff — it is present
  only in the uncommitted working tree (Task 3.0b, `IN_PROGRESS`), correctly out
  of scope for B2a/B2b.
- **D2/D10 (`.cmd` budget mismodelling) — confirmed by re-reading, not
  re-derived from scratch** (the libuv quoting algorithm reimplementation in
  `libuvQuotedLength` was independently re-verified against several hand-traced
  cases — a trailing backslash before a quote, a bare backslash with no quote,
  an embedded quote — and matches libuv's `quote_cmd_arg` reverse-walk behaviour
  in every case traced). D2's mitigation (the `.cmd`/`.bat` branch dropping to
  8,191) is present and correctly triggers on `/\.(cmd|bat)$/i` case-
  insensitively, pinned by `cli-adapter.utils.spec.ts:287-314` (`c0ecc1644`).
  D10 remains an accepted, documented gap (cross-spawn's own `^`-escaping for
  the `.cmd` shim path is not modelled), unchanged from the write-up.

## Data flow

1. `AgentRoleResolver.resolve(workspaceRoot, role)` — name regex checked first,
   zero FS calls on failure (verified: `fs.totalCalls() === 0` in the traversal
   spec cases). OK.
2. `resolveHarnessWorkspaceRoot(workspaceRoot)` → `agentsDirFor` → `listRoleFiles`
   (`exists` then `readDirectory`, filtered to `FileType.File` + `.md`, sorted).
   OK for a valid root; silently wrong for an empty/relative root (D9, tracked,
   out of scope).
3. Exact case-sensitive match against the listing; `sourcePath` built only from
   the matched entry's real filename, never from the raw `role` argument. OK —
   this is the traversal defence and it is enforced before path construction, not
   after.
4. `readFile(sourcePath)` → `stripFrontmatter` (single strip) → empty-body check
   → UTF-8 byte-length check → `extractFrontmatterDescription(raw)` →
   `AgentRoleDefinition`. Each gate short-circuits on failure with the
   available-roles list attached. OK.
5. `CliCommandOptions.role` carries the definition into `buildTaskPrompt`, which
   places `renderRoleBlock(role, cli)` between system context and the tool
   policy, throwing if `role` is set with no `cli`. Role-less path is unchanged
   byte-for-byte (verified by the "byte-identical" spec case). OK, with D3 as
   the known gap on 4 of 7 lanes inside `renderRoleBlock` itself.
6. `spawnCli` runs `assertCommandLineWithinLimit(binary, args)` before any
   `spawner`/`cross-spawn` branch, so an oversized command line never reaches an
   OS-level spawn attempt. OK, with D10 as the known measurement gap on the
   `.cmd` shim path.

No step in this diff loses, duplicates, or reads stale data; every failure point
converts to a typed error before any side effect (file write, process spawn)
would occur.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| 2a.1 `listRoles`/`resolve` contract, error taxonomy, no-cache | COMPLETE | D9 (workspace-root guard) scheduled next batch, not required for 2a.1 |
| 2a.2 DI token + barrel export | COMPLETE | — |
| 2b.1 `renderRoleBlock`/`buildTaskPrompt` ordering | PARTIAL | D3 double-strip on 4 lanes; pinned by spec, fix scheduled (Task 3.0) |
| 2b.2 `assertCommandLineWithinLimit` + `CliCommandLineTooLongError` | COMPLETE | D2/D10 accepted, documented gaps; empty-`args` message attribution (new, Minor) |
| 2b.3 `CliCommandOptions.role` only, no `roleChannel` yet | COMPLETE | — |
| Role-less byte identity | COMPLETE | Verified by spec and by direct reading |
| No silent role-less fallback | COMPLETE | Every failure throws a typed error |

Implicit requirements not addressed: cross-checking the 64 KiB role-body budget
against the eventual command-line budget (see "What is missing" above); a
regression spec for the empty-`args` error-attribution case.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Missing `.claude/agents` dir | YES | `listRoles` → `[]`; `resolve` → `no_roles` | none |
| `../x`, `..`, `.hidden`, `a/b`, `a\b`, empty, 101 chars, space | YES | `invalid_role_name`, zero FS calls | none |
| Case mismatch (`Backend-Developer` vs `backend-developer`) | YES | `unknown_role` | none |
| Frontmatter-only file | YES | `empty_role` | none |
| Body of exactly 64 KiB / 64 KiB+1 | YES | accept / `role_too_large` | none |
| CRLF body | YES | normalized to LF via `stripFrontmatter` | none |
| Body starting with its own `---` block | PARTIAL | resolver preserves it (single strip, verified); `renderRoleBlock` mangles it on 4 lanes | D3, tracked |
| Sub-package `workspaceRoot` | YES | resolves via `resolveHarnessWorkspaceRoot` | none |
| Empty/relative `workspaceRoot` | NO | reads `process.cwd()/.claude/agents` | D9, tracked |
| Read failure after listing (race) | YES | `role_read_failed`, narrowed message | none |
| Non-`Error` rejection | YES | `String(error)` fallback | none |
| Win32 command line at limit-1/limit/limit+1, incl. `.cmd`/`.bat` | YES | exact-value spec, independently re-verified | none |
| Linux/darwin arg-byte limits at boundary | YES | exact-value spec | ARG_MAX/env bytes not modelled (F3, pre-flagged) |
| `args = []` reaching the budget guard | PARTIAL | guarded against crash | misattributed error message (new, Minor) |
| Role set without `cli` in `buildTaskPrompt` | YES | throws, no silent role-less render | none |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: D3 (role bodies with a leading `---` block are silently truncated on
  4 of 7 lanes) is a real, user-visible correctness bug that ships if B3's Task
  3.0 does not land before this reaches a user-facing surface — it is fully
  tracked and pinned by a spec, so the risk is schedule risk, not an unknown.
- What a robust implementation would add: a spec for `assertCommandLineWithinLimit`
  with `args = []`; a cross-check (even just a code comment or a follow-up test)
  reconciling the 64 KiB role-body budget against the command-line budget so a
  future reader does not assume the resolver's accept is a guarantee of
  spawnability on every lane.
