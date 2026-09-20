# Context

## What the user said

The user has never accepted a synthesized skill. Their words: "we have
agent-lanes, orchestration and other skills, but the suggested skills so far do
not meet my criteria at all." They asked whether solid skills can be generated
against that criteria, or whether the effort should move to enhancing the
assets they already wrote.

## Measured state, 2026-09-18

Queried read-only against `~/.ptah/state/ptah.sqlite`.

| Measure                                           | Value        |
| ------------------------------------------------- | ------------ |
| Candidates                                        | 2,433        |
| Promoted                                          | 0            |
| Suggestions accepted                              | 1 of 17      |
| `skill_registry` rows with `clone_status='synth'` | 1            |
| Candidates judged                                 | 105 of 2,433 |
| Candidates scoring at or above 6.0                | 44           |
| Invocations of a synthesized skill                | 0            |
| Invocations of hand-authored assets               | 2,790        |

Judge criterion means over the 105 scored rows:

| Population               | n   | Composite | Generalization |
| ------------------------ | --- | --------- | -------------- |
| Template fallback bodies | 60  | 2.93      | 1.33           |
| Model-synthesized bodies | 45  | 7.28      | 6.96           |

## The two root causes

**1. The generator is instructed to produce the wrong shape.**
`skill-synthesizer.service.ts:246` says: prefer a short "## Steps" list, and add
"## Gotchas" only when there are non-obvious pitfalls.
`skill-synthesizer.service.ts:242` says: strip workspace-specific paths, file
names, identifiers, and one-off details.

The exemplars break both rules. `agent-lanes` carries 8 sections and 5 decision
tables, and is grounded in `ptah_agent_spawn`, `ptahCliId` and `agentId`. Its
value comes from that grounding. Under the current rubric it would score low on
generalization.

**2. The cluster path is fed pooled candidate bodies, not trajectories.**
`skill-curator.service.ts:464-467` builds `ClusterMemberInput[]` from
`readCandidateBody(m)`. Pooling 100 shallow checklists averages them. The
largest clusters hold 111, 108 and 98 sessions, and their output is
indistinguishable from single-session output.

## The standard already exists, and the generator drifted from it

`libs/backend/skill-synthesis/CLAUDE.md` states the rule:
`SkillSynthesizerService.buildSystemPrompt()` encodes skill-creator best
practices. "Keep it aligned with `ptah-core/skills/skill-creator`."

It is not aligned. `.claude/skills/skill-creator/SKILL.md:22` lists what a skill
provides, and the third item is:

> Domain expertise - Company-specific knowledge, schemas, business logic

`skill-synthesizer.service.ts:242` instructs the model to do the opposite:

> Generalize: strip workspace-specific paths, file names, identifiers, and
> one-off details.

`skill-creator` never asks for that. Nor does it ask for a two-section document.
Its structural guidance is progressive disclosure: a lean `SKILL.md` under 500
lines, with detail in `references/`, `scripts/` and `assets/`
(`skill-creator/SKILL.md:47-101`, `:114-201`). Our generator emits one flat file
and has no data model for a reference directory
(`SYNTHESIZED_SKILL_JSON_SCHEMA`, `skill-synthesizer.service.ts:68-77`).

So do NOT invent a new rubric. Derive both the generator prompt and the judge
rubric from `skill-creator`, which the repository already treats as the
standard, and use the exemplars as worked examples of it. Two concrete sources:

- **Generator prompt**: `skill-creator/SKILL.md` Core Principles (`:25-45`),
  Anatomy (`:47-101`), Progressive Disclosure (`:114-201`), and the writing
  guidelines (`:299-320`). Keep the concision rule — it is correct and the
  exemplars obey it. Drop the strip-the-grounding rule and the two-section rule.
- **Judge rubric**: `skill-creator/SKILL.md` Step 5 Validate (`:328-336`) is
  already a checklist a reviewer can apply: frontmatter parses, `name` matches
  the directory, `description` states what AND when in third person under 1024
  characters, every referenced path exists, no auxiliary files. Score those
  first, then the structural criteria in
  `.ptah/specs/TASK_2026_471_b3d1/skill-quality-criteria.md`.

This also decides an open design question. A skill is a DIRECTORY, not a string.
Any rubric that rewards references and progressive disclosure requires the
generator to emit more than `{name, description, body}`. Widening that schema is
part of this task, not a follow-up.

## Track A evidence — memory

Full detail in `.ptah/specs/TASK_2026_471_b3d1/forensics-memory-quality.md`.

| Measure                                     | Value                 |
| ------------------------------------------- | --------------------- |
| Memories                                    | 36,252                |
| Memory chunks                               | 38,952                |
| Distinct subjects                           | 27,354                |
| Subjects used exactly once                  | 23,723 (86.7 percent) |
| Memories that ever received a merge         | 620 (1.71 percent)    |
| Retrieval precision, four realistic queries | 4.5 relevant of 20    |

**Retrieval.** `fts-query.util.ts:35-37` joins every token with `OR` and removes
only the four FTS5 keywords. The query "what did we decide about the judge
threshold" becomes `"what" OR "did" OR "we" OR ... OR "threshold"*`. Every chunk
matches "the". The database holds 22 memories that define judge thresholds and
none of them ranked. With stopwords removed and `AND` joining, the same query
against the same uncleaned database returned 5 relevant results of 5.

**Merge.** `memory-curator.service.ts:606-612` calls
`store.list({ limit: 200 })`, which is ordered by recency-decayed salience, then
filters by exact case-sensitive subject equality. In a 36,252-row workspace the
merge candidate list is empty for any subject older than a few days. 81 distinct
subjects exist for commitlint rules alone.

**Not in this task, recorded so it is not lost.** Roughly 55 percent of the
corpus is ephemeral work log rather than durable knowledge, and `kind='event'`
rows are close to 100 percent so. Stored `salience` clusters above 0.70 for 85.5
percent of rows, so the ranking expression behaves as a recency filter. Both are
real, both are larger changes, and neither blocks Track A.

## What is explicitly out of scope

- **Automatic promotion.** It cannot fire: `SkillInvocationTracker.recordInvocation`
  has no production caller, every candidate has `success_count = 0`, and the
  recurrence check runs before the judge check. Do not repair it in this task.
  Nothing should promote until the generator produces something worth promoting.
- **TypeSafe or any external judgment vendor.** See
  `.ptah/specs/TASK_2026_471_b3d1/implementation-plan.md`. There is no outcome
  label to calibrate against, and the current rubric asks the wrong question. A
  better judge of the wrong question is worth nothing.
- **The template fallback path.** 60 of 105 judged bodies are raw trajectory
  fallbacks that the rubric cannot pass. Stop sending them to the judge. That is
  a one-line guard, not a redesign.

## The disagreement to resolve by measurement

The analysis in `skill-quality-criteria.md` recommends retiring autonomous
generation outright, on the grounds that a session log cannot yield an operating
contract. That limit is real for a single session.

The counter-argument is that nobody has yet run the generator with a prompt that
permits the exemplar shape, and that the 45 model-synthesized bodies already
average 7.28 under a rubric that rewards the wrong properties. One experiment
settles it. Run the experiment before retiring anything.

## Suggested shape of the work

1. Replace the generator prompt. Permit sections, decision tables, `Never` rules
   and named failure modes. Stop instructing the model to strip grounding.
2. Replace the judge rubric with the 5-criterion version in
   `skill-quality-criteria.md`, and re-derive the threshold. `judge_score` stays
   a float in 1-10, so no migration is required.
3. Stop judging template fallback bodies.
4. Feed `synthesizeFromCluster` real trajectories.
5. Run the experiment over 5 clusters. Score blind against the exemplar rubric.
6. Decide: continue, or retire the generator and keep archaeology as an evidence
   miner.

Steps 1 to 3 are cheap and independent. Step 4 is the larger one. Do not start
step 4 before the experiment shows steps 1 to 3 moved the score.
