# Code Style Review — `TASK_2026_403_403b`

Scope: the six commits after `2327e9db0` on `fix/task-id-suffix`
(`git diff 2327e9db0..HEAD`), 69 files. Reviewed against root `CLAUDE.md`,
`libs/backend/task-specs/CLAUDE.md`, `libs/backend/vscode-core/CLAUDE.md`
("Counting a degradation" / "When a `catch` may degrade"), and
`implementation-plan.md`. Verification commands actually run (not merely
read): `npx nx run-many -t test -p @ptah-extension/task-specs
@ptah-extension/skill-synthesis @ptah-extension/shared` (56+18+69 suites, all
green), `npx nx run-many -t typecheck` on the same three plus
`vscode-lm-tools` (clean), `npx nx run degradation-audit:lint`
(`libs/backend/task-specs: 12 ok (baseline 12)`), `npm run manifest:check`
(up to date), `npm run validate-skill` (0 errors), and `npx eslint` on the
three new/changed source files (clean).

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------ |
| Overall score   | 8/10                                 |
| Assessment      | APPROVED WITH NOTES                  |
| Blocking issues | 0                                    |
| Serious issues  | 1                                    |
| Minor issues    | 2                                    |
| Files reviewed  | 69 (diff) + 8 read for pattern comparison |

## Five style questions

### 1. What breaks in six months?

Nothing in the reviewed lib surface. The one latent break is doc drift, not
code: `.codex/agents/frontend-developer.toml` still opens its task-specs
section with `## Task specs folder (\`TASK_YYYY_NNN/\`)` (unchanged; verified
`git diff 2327e9db0..HEAD -- .codex/agents/frontend-developer.toml` is empty)
while its 14 siblings were rewritten to the new `TASK_YYYY_NNN_xxxx` /
cross-checkout rule (`.codex/agents/backend-developer.toml:46-52` etc., byte-
identical to `.claude/agents/*.md`). A Codex session running the
frontend-developer persona reads a stale rule and reintroduces exactly the
collision this task exists to fix — for one persona, on one CLI. See Serious-1.

### 2. What would a new team member misread?

Nothing structural. The comments are unusually explicit about *why*, not just
*what* — `git-task-folder-visibility.service.ts:1-31` states the two-source
design and the "nothing throws" contract before a single method appears, and
`task-folder-visibility.port.ts:1-12` explains the port's reason for existing
in terms of the actual incidents (`context.md`'s TASK_2026_392/400/393
evidence) rather than abstract SOLID language. The one place a reader could
stumble is `task-writer.service.ts`'s comment at the `visibility` call site
claiming "the port is allowed to spawn git" as the reason a per-attempt
re-fetch would be wasteful — accurate, but it assumes the reader already knows
`VISIBILITY_CACHE_TTL_MS` exists 60 s out, which is stated in the port's own
file, not here. Not a defect, just a one-hop cross-reference.

### 3. What does this cost to maintain?

Two new files (`id-suffix.ts` at 7 lines, `task-folder-visibility.port.ts` at
44 lines) plus one 353-line service. `id-suffix.ts` is small by the letter of
the ~150-line-file guardrail but passes its actual test (nameability, single
responsibility: "own the discriminator and its own validation regex") and the
plan explains why it is not folded into `id-allocator.ts` (keep the allocator
at zero imports and trivially pure — `id-allocator.ts:1-13`'s docblock,
verified by reading the file: it imports only `TASK_ID_SUFFIX_RE`). That is a
deliberate single-purpose split, not a fragment created to dodge a line count.
The real cost is breadth, not depth: 5 constructor call sites gained a 4th
argument across 6 spec files plus one CLI spec (11 sites total, all updated —
none left on the old arity, verified by grep), and every one of the 8 doc/prompt
locations named in the plan's component-8 table was found edited and
byte-identical to its renderer source. That is the cost the plan itself
budgeted for ("MEDIUM... the risk is breadth"), and it was paid in full except
for the one file outside the plan's own table (Serious-1).

### 4. Where is this inconsistent with the rest of the repository?

It isn't, on the axes that matter. The mirrored-symbol pattern
(`SDK_PROCESS_SPAWNER_TOKEN = Symbol.for('SdkProcessSpawner')` at
`git-task-folder-visibility.service.ts:81`) is character-for-character the
same string as `SDK_TOKENS.SDK_PROCESS_SPAWNER` in
`libs/backend/agent-sdk/src/lib/di/tokens.ts:51`, and is the *third* use of
this exact convention in the tree — `skill-synthesis/src/lib/di/tokens.ts:48-64`
already mirrors two `agent-sdk` symbols the same way, with the same
`{isOptional: true}` shape and the same "a typo resolves null, not an error"
warning in its doc comment. This is an established, documented convention
being reused correctly, not a new one that needs a note. The `DEGRADATION_REPORTER`
injection (`git-task-folder-visibility.service.ts:174-175`) reproduces
`backup.service.ts:180`'s exact comment and shape ("Optional because
`register*Services` does not register it — the reporter is bound by
`vscode-core`'s platform-agnostic registration"). The port + token + `NoOp`
shape (`task-folder-visibility.port.ts`) is a line-for-line structural copy of
`task-index.port.ts` (interface, token comment, `@injectable()` NoOp, same
placement — token beside the interface, not in `di/tokens.ts`, which
`di/tokens.ts:9-11`'s own comment calls out explicitly).

### 5. What would you have done differently, and why is that better?

I would have driven the component-8 replacement from a single source list
that explicitly enumerated `.codex/agents/*.toml` alongside `.claude/agents/*.md`
rather than editing 14 of 15 by whatever mechanism found them (the missed file
uses a structurally different, pre-existing condensed template — its
divergence predates this task, but a listing-based approach would have
surfaced "1 of 15 has no matching anchor" as a loud gap instead of a silent
one). That is a five-minute fix, not a design change; see Serious-1.

## Blocking issues

None.

## Serious issues

### One of fifteen `.codex/agents/*.toml` files was not updated

- File: `.codex/agents/frontend-developer.toml:39`
- Problem: still reads `## Task specs folder (\`TASK_YYYY_NNN/\`)` — the
  pre-suffix folder-name shape — while all 14 sibling `.codex/agents/*.toml`
  files (and all 15 `.claude/agents/*.md` files) were rewritten with the
  byte-identical new bullet (`.codex/agents/backend-developer.toml:46-52`,
  confirmed identical across all 14 via diff-content hash). `git diff
  2327e9db0..HEAD -- .codex/agents/frontend-developer.toml` is empty — this
  file was not touched at all in this branch.
- Impact: this file already used a divergent, condensed template before this
  task (it has no "Allocate a new id" bullet at all, only the heading), so the
  editing pass that caught the other 14 evidently matched on a text anchor
  this file never had. A Codex session invoking the frontend-developer persona
  is told the folder is named `TASK_YYYY_NNN/` with no cross-checkout scan —
  the exact defect this task exists to close, live for one persona on one CLI.
  Neither `contract.guard.spec.ts` (scans `*.md` in task-folder position, not
  `.codex/**/*.toml` headings) nor `validate-skill` (checks 11 markdown files
  under `.claude/skills/orchestration`) catches this, so nothing in CI will
  flag it.
- Fix: apply the same replacement made to the other 14 `.codex/agents/*.toml`
  files to `frontend-developer.toml`'s task-specs section (adapting to its
  condensed style, the way the plugin's `SKILL.md` copy was deliberately
  reworded rather than copied verbatim — `implementation-plan.md:477` already
  anticipated that this copy "reads differently").

## Minor issues

- `task-writer.service.ts`'s new comment above `beyondWorkspace` states "the
  port is allowed to spawn git" as justification for fetching it once; the
  60 s TTL that actually makes a second `create` in the same minute free is
  documented only in `git-task-folder-visibility.service.ts`, one file away.
  A one-clause cross-reference would save the next reader a hop.
- `libs/backend/task-specs/CLAUDE.md`'s "Internal Structure" list now runs to
  11 bullets for what is still a single cohesive lib; not a violation of
  anything stated, but worth a glance next time a ninth file is added to make
  sure the list keeps being read rather than skimmed.

## File-by-file

### `libs/backend/task-specs/src/lib/id-allocator.ts`

Score 10/10 — 0/0/0. Stays a pure, zero-import function exactly as its own
docblock and `libs/backend/task-specs/CLAUDE.md`'s "Pure functions take
strings (no I/O)" guideline require; the one behavioural change (emit line,
`id-allocator.ts:43`) is the only line touched beyond the new `suffix`
parameter and its validation.

### `libs/backend/task-specs/src/lib/id-suffix.ts`

Score 9/10 — 0/0/0. 7 lines, but passes the guardrail's actual test
(nameable, single-purpose, deliberately separated so the allocator stays
import-free per the CLAUDE.md rationale, not created to duck a size cap).

### `libs/backend/task-specs/src/lib/task-folder-visibility.port.ts`

Score 10/10 — 0/0/0. A structural copy of `task-index.port.ts`'s
port+token+NoOp shape, including token placement beside the interface per
`di/tokens.ts:9-11`'s own stated convention.

### `libs/backend/task-specs/src/lib/git-task-folder-visibility.service.ts`

Score 9/10 — 0/0/1 (the cross-reference note above). Every one of the five
documented failure branches is independently guarded, each with a
`// degradation-audit: reported — <code>` marker plus a
`degradation.report()` call whose `code` is typed as a closed
`VisibilityDegradationCode` union (`:110-114`) rather than a bare string —
stronger than the CLAUDE.md rule requires, since an interpolated code cannot
even type-check. `execGit`, `parseWorktreeList`, and `IProcessSpawner` are all
pulled from their existing barrels with no new lib edge (`vscode-core` and
`shared` were both already declared dependencies before this task —
confirmed against `git show 2327e9db0:libs/backend/task-specs/CLAUDE.md`).
Verified: 4 degrading catches added, `degradation-audit:lint` still reports
`libs/backend/task-specs: 12 ok (baseline 12)` — none leaked into the count.

### `libs/backend/task-specs/src/lib/task-writer.service.ts`

Score 9/10 — 0/0/1 (comment cross-reference note). The union is fetched once
before the retry loop and unioned with a fresh local scan and a fresh
`randomIdSuffix()` per attempt, exactly as specified; no new `catch` was
added, matching the plan's claim that the port never throwing means this
method needs none.

### `libs/backend/task-specs/src/lib/di/{tokens,register}.ts`, `src/index.ts`

Score 10/10 — 0/0/0. `GitTaskFolderVisibility` is registered as a singleton
in the one shared `registerTaskSpecsServices`, called by all three hosts
(`apps/ptah-electron/src/di/phase-2-libraries.ts`,
`apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`, and
`libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts:145` for
the CLI) — confirmed by grep that no `apps/**` file binds anything new. The
barrel exports both the port and its two implementations, including the NoOp
that the CLI's own spec needs as a fixture.

### `libs/backend/skill-synthesis/src/lib/subagent-metrics-extractor.ts`

Score 10/10 — 0/0/0. Both regexes widen exactly as specified; the case-
insensitive dedup is preserved but the returned string is no longer forced to
uppercase, closing the two-producer disagreement the plan identified against
`skill-scorecard.service.ts`'s `taskIdFromVerdictSource`. This lib still does
not import `task-specs`, matching its stated boundary.

### `libs/shared/src/lib/types/task-spec.contract.ts`

Score 10/10 — 0/0/0. Both renderers (`renderSpecsReadme`,
`renderTaskSpecAgentBlock`) carry the new rule; both are pinned by new
assertions in `task-spec.contract.spec.ts` that check for the specific new
phrases (`origin/main`, `git worktree list`, `TASK_YYYY_NNN_xxxx`, etc.).

### 15× `.claude/agents/*.md`

Score 10/10 — 0/0/0. Byte-identical replacement across all 15, confirmed by
hashing each file's added-lines diff.

### 14× `.codex/agents/*.toml` (excludes `frontend-developer.toml`)

Score 10/10 — 0/0/0 for the 14 that were touched; byte-identical to the
`.claude/agents/*.md` replacement.

### `.codex/agents/frontend-developer.toml`

Score 4/10 — 1 serious (S-1 above), 0/0. Not touched by this branch at all;
now the one place in the repo that still states the pre-suffix folder shape.

### `.claude/skills/orchestration/SKILL.md`,
### `apps/.../assets/plugins/ptah-core/skills/orchestration/SKILL.md`

Score 10/10 — 0/0/0 each. The plugin copy was deliberately reworded rather
than copied verbatim, matching the plan's own note that "this copy already
reads differently from `.claude`" (`implementation-plan.md:477`) — the
substantive rule (scan union, suffix, exclusive `mkdir`, never rename) is
present in both, in each file's own voice.

### `task-tracking.md`, `relay.md` (both `.claude` and plugin copies)

Score 10/10 — 0/0/0. Byte-identical mirrors, confirmed by diff comparison.

### `registry-generator.service.ts`, `tool-description.builder.ts`

Score 10/10 — 0/0/0. The generated registry banner and the MCP tool
description both restate the new format without over-explaining it inline —
appropriately terse for a comment that ships to every user's `registry.md`.

### `content-manifest.json`

Score 10/10 — 0/0/0. Regenerated (not hand-edited — confirmed `npm run
manifest:check` reports up to date against the current hash); the three
plugin-asset edits that required it were made first.

### 11× `new TaskWriterService(...)` call sites (6 lib spec files + 1 CLI spec)

Score 10/10 — 0/0/0. All 11 pass a 4th argument (`NoOpTaskFolderVisibility`
or a purpose-built fake); none left on the old 3-arity signature.

## Pattern compliance

| Repository rule or nearby convention                                            | Status | Evidence |
| --------------------------------------------------------------------------------- | ------ | -------- |
| Hexagonal: backend libs depend on ports, adapters live in `platform-{cli,electron,vscode}` | PASS | `git-task-folder-visibility.service.ts` types against `IFileSystemProvider`/`IProcessSpawner` from `platform-core`; no `node:child_process` import anywhere in the diff |
| No new lib dependency edge for `task-specs`                                       | PASS | `vscode-core` and `shared` were already declared deps pre-task (`git show 2327e9db0:libs/backend/task-specs/CLAUDE.md:48`); `CLAUDE.md` Dependencies section unchanged by this diff |
| Cross-lib symbol mirroring, `{isOptional: true}`, no import edge                    | PASS | `git-task-folder-visibility.service.ts:81` matches `agent-sdk/src/lib/di/tokens.ts:51` character-for-character; precedent `skill-synthesis/src/lib/di/tokens.ts:48-64` |
| Port + token + NoOp seam placement (token beside interface)                       | PASS | `task-folder-visibility.port.ts` mirrors `task-index.port.ts`; `di/tokens.ts:9-11` states the convention explicitly |
| `catch (error: unknown)`, narrow with `instanceof Error`                          | PASS | `git-task-folder-visibility.service.ts:237,264,290,311`, `describe()` helper at `:350-352` |
| Degradation: positive+negative path both required, marker + literal code          | PASS | 4 catches, all marked, `VisibilityDegradationCode` closed union prevents interpolation; `degradation-audit:lint` unchanged at baseline 12 |
| Zod at external boundaries                                                        | N/A — plan explicitly reasons Zod is not warranted here (git stdout parsed by two pure functions with shape filtering, never joined into a path) | `implementation-plan.md` "External boundaries" |
| File size / facade rule (~150-line floor, nameability)                            | PASS | `id-suffix.ts` (7 lines) and `task-folder-visibility.port.ts` (44 lines) both pass the nameability test; not size-driven splits |
| Naming: `I`-prefix ports, `kebab-case.ts` files, `{platform}-{capability}.ts` adapters | PASS | `ITaskFolderVisibility`, `git-task-folder-visibility.service.ts` |
| RPC dual-registration                                                             | N/A — no new RPC namespace | — |
| Prompt/doc byte-identical replication (`.claude/agents/*.md`)                     | PASS | 15/15 identical |
| Prompt/doc byte-identical replication (`.codex/agents/*.toml`)                    | FAIL | 14/15; `frontend-developer.toml` untouched (Serious-1) |
| Commit messages: conventional-commit style                                        | PASS | `feat(task-specs):`, `fix(skill-synthesis):`, `docs(task-specs):` × 3, all imperative, scoped, with body explaining why |

## Maintenance debt

- Introduced: one new port + one new git-backed service (both narrow, both
  following existing seam shapes), one 7-line pure helper, a required 4th
  constructor parameter on `TaskWriterService` (paid off across all 11 call
  sites), and a widened regex pair in `skill-synthesis`.
- Retired: nothing removed; the change is additive by design (no
  `allocateTaskIdV2`, no compatibility flag, no migration — confirmed against
  the plan's explicit "NOT ADDED" list and the actual diff).
- Net: small increase in surface area for a real, evidenced defect (three
  documented id collisions in `context.md`), paid down with test coverage
  (56/18/69 suites green) and a CI-neutral degradation footprint. The one
  unpaid item is the `.codex/agents/frontend-developer.toml` gap.

## Verdict

- Recommendation: APPROVE (with the one Serious item fixed before or
  immediately after merge — it is a single-file, low-risk doc edit, not a
  reason to hold the branch)
- Confidence: HIGH
- Key concern: `.codex/agents/frontend-developer.toml` still teaches the
  pre-suffix, single-checkout allocation rule and nothing in CI will catch a
  recurrence of this specific gap.
- What a 10/10 version would do differently: drive the component-8 doc sweep
  from an explicit file enumeration (as the plan's table did for
  `.claude/agents/*.md`) rather than a text-anchor-based edit, so a
  structurally divergent file surfaces as a visible gap instead of a silent
  skip; and land a regression check (even a simple grep in `validate-skill`
  or `contract.guard.spec.ts`) that fails when any `.codex/agents/*.toml`
  disagrees with the renderer's allocation bullet, the way `.claude/agents/*.md`
  effectively does today.
