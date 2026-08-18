# Code Style Review - TASK_2026_256

## Review Summary

| Metric          | Value                                |
| --------------- | ------------------------------------- |
| Overall Score   | 8/10                                  |
| Assessment      | APPROVED                              |
| Blocking Issues | 0                                      |
| Serious Issues  | 0                                      |
| Minor Issues    | 2                                      |
| Files Reviewed  | 10 (2 new, 8 modified)                |

This is a structural extraction and it does what the task brief asked: it
landed on the real seam, not an arbitrary line cut.

## The 5 Critical Questions

### 1. What could break in 6 months?

Not much from this split itself. The one thing to watch: `SkillStageWorkers`
is a duck-typed port (`analyzeSession`, `backfillEmbeddings`, `readSettings`)
and `start()` hands over `this` (`skill-synthesis.service.ts:273`,
`this.stageHandlers?.registerStageHandlers(this)`). Nothing enforces that
`SkillSynthesisService` keeps satisfying that interface structurally beyond
normal TypeScript structural typing — fine today, but if a future edit
renames `analyzeSession` on the service without touching the port, the error
surfaces at the `registerStageHandlers(this)` call site rather than at the
method itself. Minor, and exactly the tradeoff a cycle-avoiding port implies.

### 2. What would confuse a new team member?

Very little. The one place a newcomer might stumble: `TRIGGER_EVAL_MEASURED_REASON`
sits in `stage-handlers.service.ts:99` with a comment admitting it belongs
next to `TRIGGER_EVAL_SKIP_REASONS` in `gates/trigger-eval.service.ts` instead
(`REPLAY_REASONS.measured` is the precedent it should match). That's a
pre-existing, explicitly-filed follow-up carried over verbatim from the old
file — not introduced by this split — so a reader who goes looking for the
gate's own success token in the gate's own file will not find it, but the
comment tells them why and where.

### 3. What's the hidden complexity cost?

None added. If anything the split reduces it: `SkillSynthesisService` lost
five constructor injections it no longer needs (`SKILL_DRAIN_SERVICE`,
`SESSION_ARCHAEOLOGIST_SERVICE`, `JUDGE_PANEL_SERVICE`,
`REPLAY_VALIDATOR_SERVICE`, `TRIGGER_EVAL_SERVICE`) in exchange for one
(`SKILL_STAGE_HANDLERS_SERVICE`) — net four fewer things a reader of that
class's signature has to hold in their head. `SkillStageHandlersService`'s
own constructor is exactly 8 parameters (`stage-handlers.service.ts:130-177`),
right at the repo's flagged threshold but not over it, and every one of the
six is either the logger, the store, or one of the five collaborators the
task brief explicitly named as belonging together (four of them optional
LLM-lane gates that travel as a set for a documented reason — see CLAUDE.md's
conditional-registration rule). Splitting further would separate collaborators
that are only meaningful together.

### 4. What pattern inconsistencies exist?

None found. Both classes follow the lib's `@inject(TOKEN, {isOptional:true})`
+ `import type` convention identically to how `SkillSynthesisService` used
it before the split (compare `stage-handlers.service.ts:139-177` against the
pre-split constructor in `git diff`). Both are `kebab-case.ts` files. The
class name `SkillStageHandlersService` and token
`SKILL_STAGE_HANDLERS_SERVICE: Symbol.for('PtahSkillStageHandlersService')`
(`di/tokens.ts:112`) match the `Skill{Noun}Service` / `Symbol.for('Ptah...')`
pattern used by every sibling in `di/tokens.ts`. `candidate-body.ts` is a
free function file (`readCandidateBodyFile`), matching the existing
`cosine-similarity.ts` precedent in the same lib (a small, shared, non-class
helper gets its own file rather than living inside a class).

### 5. What would I do differently?

Nothing structural. The only thing I'd nudge: `TRIGGER_EVAL_MEASURED_REASON`
relocation (already filed as a known one-line follow-up, not this task's to
fix) and, if the lib ever needs to trim `SkillStageHandlersService`'s
constructor further, the three phase-3 gates (`judgePanel`, `replayValidator`,
`triggerEval`) are the one group that could plausibly become a single
injected "gates" record — but doing that now would be premature; there is no
second consumer of that grouping yet.

## Blocking Issues

None.

## Serious Issues

None.

## Minor Issues

- `stage-handlers.service.ts:92-99` — `TRIGGER_EVAL_MEASURED_REASON` still
  lives beside the handler instead of with the gate's own reason tokens in
  `gates/trigger-eval.service.ts`. Pre-existing, explicitly filed as a
  follow-up in both the file's own comment and the implementation report; not
  a regression from this split, just noting it survived the move unresolved.
- `stage-handlers.service.ts` constructor sits at exactly 8 parameters — at
  the repo's flagged threshold, not over it. No action needed; noted for
  awareness if a future task adds a ninth collaborator to this class instead
  of grouping the existing optional gates.

## File-by-File Analysis

### `libs/backend/skill-synthesis/src/lib/queue/stage-handlers.service.ts` (new, 879 lines)

**Score**: 9/10
**Issues Found**: 0 blocking, 0 serious, 1 minor (the stale constant location, see above)

**Analysis**: One coherent subject — stage dispatch — and it reads that way.
The file opens with a docblock that states its own reason for existing
(`:1-39`), which is unusual discipline for an extraction and makes the file
legible without needing the sibling service open. `registerStageHandlers`
(`:216`) is a straight, flat sequence of conditional registrations mirroring
the six stages 1:1 — no indirection, no premature abstraction over the
per-gate outcome mappings (the report's stated reason for keeping the six
mappings separate — "the FACT that selects them differs in kind per gate" —
holds up on reading each one; unifying them would in fact have required
re-deriving that fact from outside the gate that owns it).

**Specific Concerns**:
1. `TRIGGER_EVAL_MEASURED_REASON` (`:99`) — see Minor Issues.
2. None else. Every private helper (`enqueueArchaeology`, `enqueueCandidateGates`,
   `enqueueGate`, `gateTarget`, `gateClusterSessionIds`, `recordVerdictFallback`,
   `candidateBody`, `withClaimHeartbeat`) is used by exactly the stage methods
   that need it and nothing is exported that doesn't have to be.

### `libs/backend/skill-synthesis/src/lib/candidate-body.ts` (new, 47 lines)

**Score**: 8/10
**Issues Found**: 0 blocking, 0 serious, 0 minor

**Analysis**: Small (31 lines of actual code past the docblock), but it earns
the file: it has two callers in two different files
(`skill-synthesis.service.ts:785` for the embedding backfill,
`stage-handlers.service.ts:754` for the gate body) with neither being a
natural parent of the other, so a shared module is the only place that avoids
either an import cycle or a third copy. The docblock is honest about scope —
it says explicitly that `skill-promotion.service.ts` and
`skill-curator.service.ts` still carry their own copies and that folding
those in is a separate, filed cleanup, rather than silently leaving the
reader to wonder why there are still three implementations of essentially the
same file-read in the lib.

**Specific Concerns**: None.

### `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts` (2027 → 1232 lines)

**Score**: 8/10
**Issues Found**: 0 blocking, 0 serious, 0 minor

**Analysis**: This is the test that matters most for the task's stated goal —
does `start()` read as the registration seam now — and it does.
`start()` (`:264`) opens with `this.stageHandlers?.registerStageHandlers(this)`
as its very first statement, ahead of both early returns, with a comment
block immediately above explaining why the ordering matters
(`:265-272`). A reader no longer has to page past six stage protocols and
their outcome mappings to find the one line that makes the queue drain at
all — that line is now visibly the first thing the method does. The file's
own top docblock (`:1-42`) was rewritten to match: it names
`stage-handlers.service.ts` and TASK_2026_256 explicitly rather than leaving
a stale description of the six stages living inline.

The class docstring for `stageHandlers` (`:242-254`) is a legible handoff of
ownership: it says in one place that this class owns only the three workers
it hands over, and the new file owns the drain and every gate.

**Specific Concerns**: None found. No orphaned imports, no dead code, no
leftover references to the removed handler methods — confirmed by grep across
the file for `readCandidateBodyFile` (one remaining use, the backfill caller,
correctly imported from the new shared module) and by the lint/typecheck
results below.

### `libs/backend/skill-synthesis/CLAUDE.md`

**Score**: 8/10
**Issues Found**: 0 blocking, 0 serious, 0 minor

**Analysis**: The new `src/lib/queue/stage-handlers.service.ts` bullet
matches the density and style of every other "Internal Structure" entry in
this file — it names what the class owns, why it doesn't inject
`SkillSynthesisService` (the tsyringe cycle), and how the port crosses the
boundary. The `candidate-body.ts` bullet correctly cross-references both
callers and the still-open cleanup. The registration-seam paragraph in
"Drain semantics" was updated to say `start()` delegates to
`SkillStageHandlersService.registerStageHandlers()` and now records that the
ordering is pinned by a named spec, verified by mutation — accurate, not
just present, and it names the actual mechanism rather than a vague "this is
handled."

**Specific Concerns**: None.

## Pattern Compliance

| Pattern                    | Status | Concern                                    |
| --------------------------- | ------ | ------------------------------------------- |
| `kebab-case.ts` file names   | PASS   | None                                        |
| DI token `UPPER_SNAKE` + `Symbol.for(...)` | PASS | None |
| `@inject(TOKEN, {isOptional:true})` + `import type` for cross-module ports | PASS | None |
| One barrel, internals under `src/lib/` | PASS | New exports match the lib's existing convention of exporting every top-level service |
| Constructor injection count | PASS (at the edge) | `SkillStageHandlersService` is exactly 8, the flagged threshold, not over it |
| Comment/invariant carry-over on move | PASS | Every documented rule (force:true, dependsOn null, no queueItemId string, drain never throws, conditional registration) moved with its full explanatory docblock intact |

## Technical Debt Assessment

**Introduced**: None. `candidate-body.ts` slightly increases file count for a
47-line module, but that's the honest cost of breaking a two-caller tie
without an import cycle, not debt.

**Mitigated**: The task's own stated debt — the registration seam buried
among six unrelated stage protocols, and the outcome-mapping contract
expressed six times inside a file whose main subject was something else — is
resolved. `skill-synthesis.service.ts` is back to a size where the six
concerns it now owns (lifecycle, settings, `analyzeSession`, RPC-backing
methods) are legible as one class's job.

**Net Impact**: Debt reduced. Constructor injection count on the surviving
service dropped by four; the largest spec file's growth pressure moves with
the handlers it tests, off the file that owns lifecycle.

## Verdict

**Recommendation**: APPROVE
**Confidence**: HIGH
**Key Concern**: None blocking. The one thing worth a maintainer's future
attention is the pre-existing, already-filed `TRIGGER_EVAL_MEASURED_REASON`
placement — not introduced here, not this task's to fix.

## What Excellence Would Look Like

This is close to it. A 10/10 version would additionally relocate
`TRIGGER_EVAL_MEASURED_REASON` next to `TRIGGER_EVAL_SKIP_REASONS` in the
gate's own file while it had the diff open (a one-line, zero-risk change the
report itself identifies), and would fold `skill-promotion.service.ts` /
`skill-curator.service.ts`'s duplicate `readCandidateBodyFile` copies into
the new shared module now that a shared home exists — both are explicitly
scoped out as separate follow-ups rather than silently ignored, which is the
right call for a task whose brief was behaviour-preserving structural work,
but doing them would have made this the last commit that ever needs to touch
this particular duplication.
